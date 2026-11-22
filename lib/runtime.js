import { fileURLToPath } from 'node:url'
import { dirname, posix } from 'node:path'

import pkg from '../package.json' with { type: 'json' }

const engineVersion = '3.3.0'
const protocolVersion = '2025-06-18'
const inspectOutputs = 'Artifacts may already exist. Inspect project outputs before retrying.'

function startupEnv(name) {
  try { return process.env[name] } catch (cause) {
    throw new Error('Cannot read DSH launcher environment setting ' + name, { cause })
  }
}

function limit(name, fallback, max) {
  const raw = startupEnv(name)
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > max || (raw !== undefined && String(value) !== raw)) {
    throw new Error('Invalid DSH launcher setting ' + name + ': expected a decimal integer from 1 to ' + max + ' (no sign, whitespace or leading zero).')
  }
  return { name, value }
}

export function runtimePath(platform = process.platform, arch = process.arch, external) {
  if (platform === 'win32' && arch === 'x64') return fileURLToPath(new URL('../runtime/win32-x64/rust-anything.exe', import.meta.url))
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Unsupported rust-anything platform: ' + platform + '-' + arch)
  if (external === undefined) external = startupEnv('DSH_RUST_ANYTHING_BIN')
  if (typeof external !== 'string' || !posix.isAbsolute(external) || external.includes('\0')) throw new Error('Set DSH_RUST_ANYTHING_BIN to the absolute path of an installed rust-anything ' + engineVersion + ' executable')
  return external
}

// Only trusted startup metadata uses the executable directory. Each model request
// has its own cwd, sandbox, deadline and child processes, including the Unix version check.
export function nativeRuntime(ctx, binary, lifetime) {
  const startupTimeout = limit('DSH_RUST_ANYTHING_STARTUP_TIMEOUT_MS', 15000, 120000)
  const requestTimeout = limit('DSH_RUST_ANYTHING_REQUEST_TIMEOUT_MS', 600000, 3600000)
  const stdout = limit('DSH_RUST_ANYTHING_STDOUT_MAX_BYTES', 16 * 1024 * 1024, 64 * 1024 * 1024)
  const stderr = limit('DSH_RUST_ANYTHING_STDERR_MAX_BYTES', 8192, 65536)

  async function execute(operation, exec, action) {
    const timeout = exec ? requestTimeout : startupTimeout
    const deadline = AbortSignal.timeout(timeout.value)
    const caller = exec ? AbortSignal.any([lifetime, exec.signal]) : lifetime
    const signal = AbortSignal.any([caller, deadline])
    try {
      signal.throwIfAborted()
      let cwd = dirname(binary), policy
      if (exec) {
        if (!exec.agent?.session) throw new Error('An active DSH project session is required')
        cwd = await ctx.workingDirectory.ensure(exec.agent, signal)
        policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session })
      }
      async function run(arg, data) {
        let argv = [binary, arg]
        if (exec && policy.mode !== 'danger-full-access') argv = (await ctx.sandbox.confine(argv, policy, signal)).argv
        signal.throwIfAborted()
        try {
          // Omit env: the DSH subprocess provider supplies its scrubbed environment.
          const child = ctx.subprocess.spawn({ argv, cwd, signal, graceMs: 2000, stdio: {
            stdin: data === undefined ? 'ignore' : { data }, stdout: { maxBytes: stdout.value }, stderr: { maxBytes: stderr.value },
          } })
          const outcome = await child.done
          signal.throwIfAborted()
          if (outcome.exitCode !== 0) {
            const diagnostic = child.collected.stderr.readFrom(0)
            throw new Error('process exited ' + (outcome.exitCode ?? outcome.signal) + (diagnostic.lossy ? ' (stderr truncated)' : '') + ': ' + diagnostic.text)
          }
          const output = child.collected.stdout.readFrom(0)
          if (output.lossy) throw new Error('stdout truncated; incomplete response discarded')
          return output.text
        } catch (cause) {
          const bounds = [timeout, stdout, stderr].map(s => s.name + '=' + s.value).join(', ')
          throw new Error('rust-anything ' + operation + ' (' + arg + '; ' + bounds + '): ' + (cause?.message ?? cause) + '. ' + inspectOutputs, { cause })
        }
      }
      const result = await action(run)
      signal.throwIfAborted()
      return result
    } catch (cause) {
      // The provider can reject, return a nonzero exit, or even resolve normally on abort.
      caller.throwIfAborted()
      if (deadline.aborted) throw new DOMException('rust-anything ' + operation + ' timed out (' + timeout.name + '=' + timeout.value + ' ms). ' + inspectOutputs, 'TimeoutError')
      throw cause
    }
  }

  async function checkVersion(run) {
    if ((await run('--version')).trim() !== 'rust-anything ' + engineVersion) throw new Error('Expected rust-anything ' + engineVersion + ' at ' + binary)
  }
  function version(exec) { return execute('--version', exec, checkVersion) }

  // The pinned server joins workers at EOF: it returns exactly two replies, in either order.
  function request(method, params, exec, onInitialize) {
    const operation = params?.name ? method + ' ' + params.name : method
    return execute(operation, exec, async run => {
      if (exec && process.platform !== 'win32') await checkVersion(run)
      const frames = [
        { id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: pkg.name, version: pkg.version } } },
        { method: 'notifications/initialized' }, { id: 2, method, params },
      ]
      const output = await run('mcp', frames.map(frame => JSON.stringify({ jsonrpc: '2.0', ...frame })).join('\n') + '\n')
      const invalid = detail => new Error('rust-anything ' + operation + ': ' + detail + '. ' + inspectOutputs)
      const lines = output.trimEnd().split('\n', 3)
      if (lines.length !== 2) throw invalid('Expected two MCP replies')
      let replies
      try { replies = lines.map(line => JSON.parse(line)) } catch { throw invalid('Invalid MCP JSON reply') }
      function result(id) {
        const r = replies.find(r => r?.id === id)
        if (r?.jsonrpc !== '2.0' || 'method' in r || ('result' in r) === ('error' in r)) throw invalid('Invalid MCP reply for id ' + id)
        if ('error' in r) {
          if (!Number.isInteger(r.error?.code) || typeof r.error?.message !== 'string') throw invalid('Invalid MCP error for id ' + id)
          throw invalid('MCP error ' + r.error.code + ': ' + r.error.message)
        }
        if (!r.result || typeof r.result !== 'object' || Array.isArray(r.result)) throw invalid('Invalid MCP result for id ' + id)
        return r.result
      }
      const init = result(1)
      if (init.serverInfo?.name !== 'rust-anything' || init.serverInfo.version !== engineVersion) throw invalid('Unexpected rust-anything MCP server identity')
      if (init.protocolVersion !== protocolVersion) throw invalid('Unexpected MCP protocol version; expected ' + protocolVersion)
      const response = result(2)
      onInitialize?.(init)
      return response
    })
  }
  return { version, request }
}
