import { readFile } from 'node:fs/promises'
import { dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { nativeRuntime, runtimePath } from './runtime.js'

export const name = 'rust-anything'
export const inject = ['tools', 'skills', 'subprocess', 'workingDirectory', 'sandboxPolicy', 'sandbox', 'approval']

export async function apply(ctx) {
  const binary = runtimePath()
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'rust-anything.lifetime')
  const native = nativeRuntime(ctx, binary, lifetime.signal)
  await native.version()
  const list = await native.request('tools/list', {}, undefined, init => {
    if (init.instructions) ctx.inject(['systemPrompt'], inner => {
      inner.systemPrompt.section({ name: 'mcp:rust-anything', order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
        interpolate: false, text: () => init.instructions })
    })
  })
  for (const tool of list.tools) {
    const publicName = 'mcp__rust-anything__' + tool.name
    ctx.tools.register(createMcpToolDefinition(ctx, {
      name: publicName, rawName: tool.name, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema,
      async call(args, exec) {
        if (!exec.agent?.session) throw new Error('An active DSH project session is required')
        // Only these two v3.3.0 operations are source-only analyses. Other tools
        // may execute project-defined workloads even without a command argument.
        if (tool.name !== 'analyze' && tool.name !== 'map') {
          const decision = await ctx.approval.request({ agent: exec.agent, toolName: publicName, callId: exec.callId,
            signal: AbortSignal.any([lifetime.signal, exec.signal]), reason: 'rust-anything ' + tool.name + ' may write project files or execute project code.' })
          if (decision !== 'allowed-once') throw new Error('DSH approval for ' + tool.name + ': ' + decision)
        }
        return native.request('tools/call', { name: tool.name, arguments: args }, exec)
      },
    }))
  }

  const { prompts } = await native.request('prompts/list', {})
  const promptNames = prompts.map(prompt => prompt.name)
  ctx.tools.register({ name: 'rust_anything_prompt', description: 'Get the original rust-anything MCP migration prompt (read-only).',
    parameters: { type: 'object', properties: { name: { type: 'string', enum: promptNames }, path: { type: 'string' }, unit: { type: 'string' } }, required: ['name', 'path'], additionalProperties: false },
    output: { schema: { type: 'object', properties: { description: { type: 'string' }, messages: { type: 'array', items: {} } }, required: ['messages'] },
      render: (_args, value) => value.messages.map(message => message.content) },
    execute({ name, path, unit }, exec) {
      if (!promptNames.includes(name) || typeof path !== 'string' || (unit !== undefined && typeof unit !== 'string')) throw new Error('Invalid rust-anything prompt arguments')
      return native.request('prompts/get', { name, arguments: { path, unit } }, exec)
    },
  })

  const skill = fileURLToPath(new URL('../skills/rust-anything/SKILL.md', import.meta.url))
  const source = await readFile(skill, 'utf8')
  const header = /^---\r?\nname: rust-anything\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/.exec(source)
  if (!header) throw new Error('Invalid packaged rust-anything skill metadata')
  ctx.skills.register({ name: 'rust-anything', description: header[1], provider: name, source: 'bundled',
    resourceBase: { kind: 'directory', path: dirname(skill).split(sep).join('/') },
    content: ['## DSH execution', 'Prefer mcp__rust-anything__* in the current project. For original prompt templates call rust_anything_prompt(name, path, unit?).',
      'For CLI-only subcommands use the normal DSH shell with its sandbox and approvals. Replace every bare rust-anything in examples with the verified executable: ' + binary,
      'Do not run setup, change PATH, or install another CLI. Never use a shell to retry an operation denied by DSH.', '', source.slice(header[0].length).trim()].join('\n'),
  })
}
