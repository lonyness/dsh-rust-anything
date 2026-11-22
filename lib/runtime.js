import { fileURLToPath } from 'node:url'
import { dirname, posix } from 'node:path'

export function runtimePath(platform = process.platform, arch = process.arch, external = process.env.DSH_RUST_ANYTHING_BIN) {
  if (platform === 'win32' && arch === 'x64') return fileURLToPath(new URL('../runtime/win32-x64/rust-anything.exe', import.meta.url))
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Unsupported rust-anything platform: ' + platform + '-' + arch)
  if (!external || !posix.isAbsolute(external)) throw new Error('Set DSH_RUST_ANYTHING_BIN to the absolute path of an installed rust-anything 3.3.0 executable')
  return external
}

// Only trusted startup metadata uses the executable directory. Every model request
// starts a fresh process in the calling agent's current directory and sandbox.
export function nativeRuntime(ctx, binary, lifetime) {
  async function run(args, data, exec) {
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(exec ? 600000 : 15000), ...(exec ? [exec.signal] : [])])
    let argv = [binary, ...args], cwd = dirname(binary)
    if (exec) {
      if (!exec.agent?.session) throw new Error('An active DSH project session is required')
      cwd = await ctx.workingDirectory.ensure(exec.agent, signal)
      const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session })
      if (policy.mode !== 'danger-full-access') argv = (await ctx.sandbox.confine(argv, policy, signal)).argv
    }
    signal.throwIfAborted()
    const process = ctx.subprocess.spawn({ argv, cwd, signal, graceMs: 2000, stdio: {
      stdin: data ? { data } : 'ignore', stdout: { maxBytes: 16 * 1024 * 1024 }, stderr: { maxBytes: 8192 },
    } })
    const outcome = await process.done
    signal.throwIfAborted()
    if (outcome.exitCode !== 0) throw new Error('rust-anything failed (' + (outcome.exitCode ?? outcome.signal) + '): ' + process.collected.stderr.readFrom(0).text)
    const output = process.collected.stdout.readFrom(0)
    if (output.lossy) throw new Error('rust-anything response exceeded 16 MiB')
    return output.text
  }
  async function version(exec) {
    if ((await run(['--version'], null, exec)).trim() !== 'rust-anything 3.3.0') throw new Error('Expected rust-anything 3.3.0 at ' + binary)
  }
  // The pinned native stdio server processes NDJSON and joins workers at EOF.
  // No shell interpolates arguments and no live server crosses session boundaries.
  async function request(method, params, exec, onInitialize) {
    if (exec && process.platform !== 'win32') await version(exec)
    const frames = [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-rust-anything', version: '3.3.0' } } },
      { method: 'notifications/initialized' }, { id: 2, method, params },
    ]
    const output = await run(['mcp'], frames.map(frame => JSON.stringify({ jsonrpc: '2.0', ...frame })).join('\n') + '\n', exec)
    const replies = output.trim().split(/\r?\n/).map(line => JSON.parse(line))
    const server = replies.find(r => r.id === 1)?.result?.serverInfo
    if (server?.name !== 'rust-anything' || server.version !== '3.3.0') throw new Error('Unexpected rust-anything MCP server identity')
    onInitialize?.(replies.find(r => r.id === 1).result)
    const response = replies.find(r => r.id === 2)
    if (response?.error || !response?.result) throw new Error(response?.error?.message ?? 'Missing MCP response: ' + method)
    return response.result
  }
  return { version, request }
}
