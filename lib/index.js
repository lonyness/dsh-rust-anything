import { readFile } from 'node:fs/promises'
import { dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeRuntime, runtimePath } from './runtime.js'

export const name = 'rust-anything'
export const inject = ['tools', 'skills', 'subprocess', 'workingDirectory', 'sandboxPolicy', 'sandbox', 'approval']

const sdkHint = 'In the SDK, send session/prompt to start a normal DSH turn, enable approvalRequests and handle approval/request.'
const goHint = 'For one hot path with a known workload, prefer mcp__rust-anything__go with the project root and workload argv (e.g. {"root":".","command":["python3","app.py"]}). One approval covers only that invocation, not a later resume or the rest of the migration.'
const intentFields = new Set(['root', 'repo', 'crate', 'out', 'unit', 'function', 'command', 'agent', 'run', 'inputs', 'build', 'args', 'node_args', 'test_command', 'db_reset', 'db_dump', 'force', 'skip_gate'])

// The pinned guide and prompt text offer a standalone CLI install and fallback.
// DSH must never be told to run it: the tools are the only supported path.
const cliFallback = /^If the MCP tools are not available,[\s\S]*?\r?\n\r?\n/m
const withoutCliFallback = text => text.replace(cliFallback, '')

function requireSession(exec) {
  if (!exec?.agent?.session) throw new Error('An active DSH project session is required. ' + sdkHint)
}

async function approve(ctx, tool, publicName, args, exec, lifetime) {
  // The reason goes in the audit log. Identify the operation, targets and workload,
  // not environment maps or entire input payloads. The callId identifies the full call.
  const intent = JSON.stringify(Object.fromEntries(Object.entries(args).filter(([key]) => intentFields.has(key))))
  const action = tool.name === 'go' ? 'profile and record the workload; may build, diff, gate and enable the port' : tool.title ?? tool.name
  const reason = 'Approve one ' + publicName + ' call (' + action + '). It may write files or execute project code. Targets/workload: '
    + (intent.length > 800 ? intent.slice(0, 800) + '… (truncated; review full call arguments)' : intent)
  let decision
  try {
    decision = await ctx.approval.request({ agent: exec.agent, toolName: publicName, callId: exec.callId,
      signal: AbortSignal.any([lifetime, exec.signal]), reason })
  } catch (cause) {
    if (!cause?.message?.includes('outside an open turn')) throw cause
    throw new Error(publicName + ' not run: approval requires an open DSH turn. ' + sdkHint, { cause })
  }
  if (decision !== 'allowed-once') {
    const detail = decision === 'rejected' ? ' (user rejection or session policy "never").' : decision === 'unavailable' ? '. ' + sdkHint : '.'
    throw new Error(publicName + ' not run: DSH approval ' + decision + detail + ' Do not retry through a terminal.')
  }
}

// Only the pinned 3.3.0 engine's text blocks and optional structured object are supported.
function modelText(toolName, content) {
  return content.length ? content.map(block => block.text).join('\n') : '(' + toolName + ' returned no model-visible content)'
}

function toolValue(toolName, result) {
  const { content, structuredContent, isError } = result ?? {}
  if (!Array.isArray(content) || !content.every(b => b?.type === 'text' && typeof b.text === 'string') ||
      (isError !== undefined && typeof isError !== 'boolean') ||
      (structuredContent !== undefined && (!structuredContent || typeof structuredContent !== 'object' || Array.isArray(structuredContent)))) {
    throw new Error(toolName + ': invalid rust-anything 3.3.0 text result')
  }
  if (isError === true) {
    const detail = structuredContent === undefined ? '' : '\n' + JSON.stringify(structuredContent)
    throw new Error(toolName + ' failed: ' + modelText(toolName, content) + detail, { cause: result })
  }
  return structuredContent === undefined ? { content } : { content, structuredContent }
}

export async function apply(ctx) {
  const binary = runtimePath()
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'rust-anything.lifetime')
  const native = nativeRuntime(ctx, binary, lifetime.signal)
  await native.version()
  const list = await native.request('tools/list', {}, undefined, init => {
    if (init.instructions) ctx.inject(['systemPrompt'], inner => {
      inner.systemPrompt.section({ name: 'mcp:rust-anything', order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
        interpolate: false, text: () => init.instructions + '\n' + goHint })
    })
  })
  for (const tool of list.tools) {
    const publicName = 'mcp__rust-anything__' + tool.name
    const hints = tool.annotations
    const readOnly = hints?.readOnlyHint === true && hints.destructiveHint === false && hints.openWorldHint === false
    ctx.tools.register({ name: publicName, description: tool.description, parameters: tool.inputSchema,
      output: { schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: modelText(tool.name, value.content) }] },
      async execute(args, exec) {
        requireSession(exec)
        const params = args !== null && typeof args === 'object' ? structuredClone(args) : {}
        if (!readOnly) await approve(ctx, tool, publicName, params, exec, lifetime.signal)
        return toolValue(tool.name, await native.request('tools/call', { name: tool.name, arguments: params }, exec))
      },
    })
  }

  const { prompts } = await native.request('prompts/list', {})
  const promptNames = prompts.map(prompt => prompt.name)
  ctx.tools.register({ name: 'rust_anything_prompt', description: 'Get an original rust-anything migration prompt (read-only); unit is optional for port_unit only.',
    parameters: { type: 'object', properties: { name: { type: 'string', enum: promptNames }, path: { type: 'string' }, unit: { type: 'string' } }, required: ['name', 'path'], additionalProperties: false },
    output: { schema: { type: 'object', properties: { description: { type: 'string' }, messages: { type: 'array', items: {} } }, required: ['messages'] },
      render: (_args, value) => value.messages.map(message => message.content) },
    async execute(args, exec) {
      const { name, path, unit } = args ?? {}
      if (typeof name !== 'string' || !name.trim()) throw new Error('Prompt name must be a non-empty string')
      if (!promptNames.includes(name)) throw new Error('Unknown prompt name ' + JSON.stringify(name) + '; expected ' + promptNames.join(' or '))
      if (typeof path !== 'string' || !path.trim()) throw new Error('Prompt path must be a non-empty string')
      if (unit !== undefined && (typeof unit !== 'string' || !unit.trim())) throw new Error('Prompt unit must be a non-empty string when supplied')
      if (unit !== undefined && name !== 'port_unit') throw new Error('Prompt ' + name + ' does not accept unit')
      requireSession(exec)
      const result = await native.request('prompts/get', { name, arguments: { path, unit } }, exec)
      return { ...result, messages: (result.messages ?? []).map(message => message?.content?.type === 'text' &&
        typeof message.content.text === 'string'
        ? { ...message, content: { ...message.content, text: withoutCliFallback(message.content.text) } }
        : message) }
    },
  })

  const skill = fileURLToPath(new URL('../skills/rust-anything/SKILL.md', import.meta.url))
  const source = await readFile(skill, 'utf8')
  const header = /^---\r?\nname: rust-anything\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/.exec(source)
  if (!header) throw new Error('Invalid packaged rust-anything skill metadata')
  // Keep the upstream guide on disk; its standalone CLI-install fallback is not a DSH instruction.
  const guide = withoutCliFallback(source.slice(header[0].length)).trim()
  ctx.skills.register({ name: 'rust-anything', description: header[1], provider: name, source: 'bundled',
    resourceBase: { kind: 'directory', path: dirname(skill).split(sep).join('/') },
    content: ['## DSH execution', 'Use mcp__rust-anything__* in the current project. For the original prompts call rust_anything_prompt(name, path, unit?).',
      goHint, 'The CLI examples below describe the engine operations. DSH uses the verified executable: ' + binary,
      'If a tool is unavailable or denied, stop. Never fall back to a terminal, run setup, change PATH or install another CLI.', '', guide].join('\n'),
  })
}
