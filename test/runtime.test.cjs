const test = require('node:test');
const assert = require('node:assert/strict');
const { dirname, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const pkg = require('../package.json');
const binary = resolve(__dirname, '../runtime/win32-x64/rust-anything.exe');
const [START, REQUEST, OUT, ERR, BIN] = ['STARTUP_TIMEOUT_MS', 'REQUEST_TIMEOUT_MS', 'STDOUT_MAX_BYTES', 'STDERR_MAX_BYTES', 'BIN'].map(k => 'DSH_RUST_ANYTHING_' + k);
const init = { protocolVersion: '2025-06-18', serverInfo: { name: 'rust-anything', version: '3.3.0' }, capabilities: { tools: {}, prompts: {} } };
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const wire = (...replies) => replies.map(r => JSON.stringify(r)).join('\r\n') + '\r\n';
let nativeRuntime, runtimePath;

test.before(async () => { ({ nativeRuntime, runtimePath } = await import('../lib/runtime.js')); });
test.beforeEach(t => {
  for (const key of [START, REQUEST, OUT, ERR, BIN]) {
    const saved = process.env[key];
    delete process.env[key];
    t.after(() => { if (saved === undefined) delete process.env[key]; else process.env[key] = saved; });
  }
});

// Model the host collector: its read at offset zero returns the bounded UTF-8 tail and a loss flag.
function child(spec, { out = wire(reply(2, {}), reply(1, init)), err = '', exitCode = 0, signal = null, done } = {}) {
  function reader(text, { maxBytes }) {
    const bytes = Buffer.from(text);
    return { readFrom(offset) {
      assert.equal(offset, 0);
      return { text: bytes.subarray(-maxBytes).toString(), nextOffset: bytes.length, lossy: bytes.length > maxBytes };
    } };
  }
  return { done: done ?? Promise.resolve({ exitCode, signal }), collected: { stdout: reader(out, spec.stdio.stdout), stderr: reader(err, spec.stdio.stderr) } };
}
function harness(mcp = child, version = spec => child(spec, { out: 'rust-anything 3.3.0\n' })) {
  const specs = [], confined = [], ensured = [], lifetime = new AbortController();
  const ctx = {
    workingDirectory: { async ensure(agent, signal) { ensured.push({ agent, signal }); return agent.session.cwd; } },
    sandboxPolicy: { resolve: ({ session }) => session },
    sandbox: { async confine(argv, policy, signal) { confined.push({ policy, signal }); return { argv: ['sandbox:' + policy.mode, ...argv] }; } },
    subprocess: { spawn(spec) { specs.push(spec); return (spec.argv.at(-1) === '--version' ? version : mcp)(spec); } },
  };
  return { runtime: nativeRuntime(ctx, binary, lifetime.signal), ctx, lifetime, specs, confined, ensured };
}
const exec = (cwd = resolve('project'), mode = 'read-only', signal = new AbortController().signal) => ({ agent: { session: { cwd, mode } }, signal });
function actionable(error, operation, setting) {
  assert.ok(error.message.includes(operation), error.message);
  assert.ok(error.message.includes(setting), error.message);
  assert.match(error.message, /artifacts may already exist.*inspect project outputs before retrying/i);
  return true;
}

test('Windows pins the bundled executable; Unix requires a trusted absolute POSIX path on a supported architecture', () => {
  process.env[BIN] = '/opt/user choice/rust-anything';
  assert.equal(runtimePath('win32', 'x64', 'overridden'), binary);
  for (const platform of ['linux', 'darwin']) for (const arch of ['arm64', 'x64']) {
    assert.equal(runtimePath(platform, arch), process.env[BIN]);
    for (const bad of [null, '', 'relative/tool', 'C:\\tool.exe', '/nul\0path']) assert.throws(() => runtimePath(platform, arch, bad), /DSH_RUST_ANYTHING_BIN/);
  }
  delete process.env[BIN];
  assert.throws(() => runtimePath('linux', 'x64'), /DSH_RUST_ANYTHING_BIN/);
  for (const [p, a] of [['win32', 'arm64'], ['linux', 'ia32'], ['freebsd', 'x64']]) assert.throws(() => runtimePath(p, a, '/tool'), /Unsupported/);
});

test('startup metadata uses binary cwd, old defaults, standard client identity and out-of-order JSON-RPC replies', async t => {
  const { runtime, specs, ensured, confined } = harness();
  const clock = t.mock.method(AbortSignal, 'timeout');
  const initialized = t.mock.fn();
  await runtime.version();
  assert.deepEqual(await runtime.request('ping', {}, undefined, initialized), {});
  assert.deepEqual(initialized.mock.calls.map(c => c.arguments), [[init]]);
  assert.equal(ensured.length + confined.length, 0);
  assert.deepEqual(specs.map(s => s.argv), [[binary, '--version'], [binary, 'mcp']]);
  assert.equal(specs[0].stdio.stdin, 'ignore');
  const frames = specs[1].stdio.stdin.data.trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(frames, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: init.protocolVersion, capabilities: {}, clientInfo: { name: pkg.name, version: pkg.version } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'ping', params: {} },
  ]);
  assert.ok(specs.every(s => s.cwd === dirname(binary)));
  await runtime.request('ping', {}, exec());
  assert.deepEqual(clock.mock.calls.map(c => c.arguments[0]), [15000, 15000, 600000]);
  for (const s of specs) {
    assert.equal(s.stdio.stdout.maxBytes, 16777216); assert.equal(s.stdio.stderr.maxBytes, 8192);
    assert.ok(!('env' in s), 'must leave child environment scrubbing to DSH');
  }
});

test('only Windows workspace-write unit builds get a target under the approved crate or repository', async t => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', platform));
  const { runtime, specs } = harness(), cwd = 'C:\\projects', e = exec(cwd, 'workspace-write');
  const unit = 'C:\\projects\\one\\unit A', repo = 'C:\\projects\\two';
  const local = unit + '\\.rust-anything\\target', composite = repo + '\\rust\\.rust-anything\\target';
  const forged = { CARGO_TARGET_DIR: 'D:\\shared', PATH: 'D:\\untrusted' };
  for (const [name, args, target] of [
    ['build', { crate: 'one/unit A', env: forged }, local], ['gate', { crate: unit }, local],
    ['report', { crate: unit }, local], ['enable', { crate: unit }, local],
    ['build', { crate: 'two/unit A' }, repo + '\\unit A\\.rust-anything\\target'],
    ['go', { root: 'two', crate: unit }, composite], ['app_wire', { repo }, composite], ['app_lift', { repo }, composite],
    ['enable', { crate: unit, force: true }], ['app_wire', { repo, skip_gate: true }],
    ['app_front_door', { repo }], ['app_record', { repo }], ['analyze', { root: repo }], ['map', { repo }],
    ['record', { crate: unit }], ['fuzz', { crate: unit }], ['unknown', { crate: unit }], ['build', {}],
  ]) {
    const params = { name, arguments: args };
    await runtime.request('tools/call', params, e);
    const spec = specs.at(-1);
    assert.deepEqual(spec.env, target ? { CARGO_TARGET_DIR: target } : undefined, name);
    assert.deepEqual(spec.argv, ['sandbox:workspace-write', binary, 'mcp']);
    assert.equal(spec.cwd, cwd);
    assert.deepEqual(JSON.parse(spec.stdio.stdin.data.trimEnd().split('\n').at(-1)).params, params);
  }
  const params = { name: 'build', arguments: { crate: unit } };
  for (const [method, execution] of [['tools/call', exec(cwd, 'read-only')], ['tools/call', exec(cwd, 'danger-full-access')],
    ['tools/call', undefined], ['prompts/get', e]]) {
    await runtime.request(method, params, execution);
    assert.ok(!('env' in specs.at(-1)), method);
  }
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  await runtime.request('tools/call', params, e);
  assert.ok(specs.slice(-2).every(s => !('env' in s)), 'Unix version check and call retain upstream behavior');
});

test('only canonical in-range launcher settings are accepted; read errors name the setting', () => {
  for (const [key, max] of [[START, 120000], [REQUEST, 3600000], [OUT, 67108864], [ERR, 65536]]) {
    for (const raw of ['', '0', '-1', '+10', '01', ' 1', '1 ', '1\n', '1.5', '1e2', '0x10', 'NaN', 'Infinity', '9007199254740993', String(max + 1)]) {
      process.env[key] = raw;
      assert.throws(harness, e => e.message.includes(key) && e.message.includes(String(max)), key + ': ' + JSON.stringify(raw));
    }
    for (const valid of ['1', String(max)]) { process.env[key] = valid; assert.doesNotThrow(harness); }
    delete process.env[key];
  }
  const original = process.env, denied = new Error('not readable');
  try {
    process.env = new Proxy(original, { get(target, key) { if (key === OUT) throw denied; return target[key]; } });
    assert.throws(harness, e => e.cause === denied && e.message.includes(OUT));
  } finally { process.env = original; }
});

test('explicit higher settings reach the provider; later env changes and model arguments cannot change them', async t => {
  Object.assign(process.env, { [START]: '120000', [REQUEST]: '3600000', [OUT]: '67108864', [ERR]: '65536' });
  const { runtime, specs } = harness();
  const clock = t.mock.method(AbortSignal, 'timeout');
  for (const key of [START, REQUEST, OUT, ERR]) process.env[key] = '1';
  await runtime.version();
  await runtime.request('tools/call', { name: 'analyze', arguments: { [OUT]: 1, env: { [REQUEST]: 1 }, timeoutMs: 1, maxBytes: 1 } }, exec());
  assert.deepEqual(clock.mock.calls.map(c => c.arguments[0]), [120000, 3600000]);
  assert.ok(specs.every(s => s.stdio.stdout.maxBytes === 67108864 && s.stdio.stderr.maxBytes === 65536 && !('env' in s)));
});

test('rejects impostors, malformed/ambiguous responses and JSON-RPC errors before trusting instructions', async () => {
  const first = reply(1, init), second = reply(2, {}), error = { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'method not found' } };
  const cases = [
    [wire(reply(1, { ...init, serverInfo: { name: 'other', version: '3.3.0' } }), second), /identity/],
    [wire(reply(1, { ...init, serverInfo: { name: 'rust-anything', version: '3.3.1' } }), second), /identity/],
    [wire(reply(1, { ...init, protocolVersion: 'other' }), second), /protocol version/],
    [wire({ ...first, jsonrpc: '1.0' }, second), /id 1/], [wire(first, { ...second, jsonrpc: '1.0' }), /id 2/],
    [wire(first, { ...second, id: '2' }), /id 2/], [wire(first, first), /id 2/], [wire(first), /two MCP replies/],
    [wire(first, second, second), /two MCP replies/], [wire(first, { ...error, result: {} }), /Invalid MCP reply/],
    [wire(first, { ...error, error: null }), /Invalid MCP error/], [wire(first, reply(2, null)), /Invalid MCP result/],
    [wire(first, error), /MCP error -32601: method not found/], [wire(first) + '{bad}', /Invalid MCP JSON/],
  ];
  for (const [out, expected] of cases) {
    const { runtime } = harness(s => child(s, { out }));
    let calls = 0;
    await assert.rejects(runtime.request('ping', {}, undefined, () => calls++), expected);
    assert.equal(calls, 0);
  }
  const toolError = { isError: true, content: [{ type: 'text', text: 'invalid arguments' }] };
  const { runtime } = harness(s => child(s, { out: wire(first, reply(2, toolError)) }));
  assert.deepEqual(await runtime.request('tools/call', { name: 'gate' }, exec()), toolError);
});

test('truncated UTF-8 stdout is discarded, even on exit 0; the exact byte boundary succeeds', async () => {
  const result = { text: '🦀' }, out = wire(reply(1, init), reply(2, result)), bytes = Buffer.byteLength(out);
  process.env[OUT] = String(bytes - 1);
  const make = () => harness(s => child(s, { out }));
  const h = make();
  await assert.rejects(h.runtime.request('tools/call', { name: 'app_record' }, exec()), e => {
    assert.match(e.message, /stdout truncated/);
    return actionable(e, 'tools/call app_record', OUT + '=' + (bytes - 1));
  });
  assert.equal(h.specs.filter(s => s.argv.at(-1) === 'mcp').length, 1);
  process.env[OUT] = String(bytes);
  assert.deepEqual(await make().runtime.request('tools/call', { name: 'app_record' }, exec()), result);
});

test('nonzero, signal, synchronous spawn and asynchronous provider failures are actionable without retry', async () => {
  process.env[ERR] = '4';
  for (const [spawn, expected] of [
    [s => child(s, { exitCode: 9, err: 'discarded-TAIL' }), /exited 9 \(stderr truncated\): TAIL/],
    [s => child(s, { exitCode: null, signal: 'SIGTERM' }), /exited SIGTERM/],
    [() => { throw new Error('spawn unavailable'); }, /spawn unavailable/],
    [s => child(s, { done: Promise.reject(new Error('child unavailable')) }), /child unavailable/],
  ]) {
    const h = harness(spawn);
    await assert.rejects(h.runtime.request('tools/call', { name: 'app_record' }, exec()), e => {
      assert.match(e.message, expected); assert.doesNotMatch(e.message, /discarded-/);
      return actionable(e, 'tools/call app_record', ERR + '=4');
    });
    assert.equal(h.specs.filter(s => s.argv.at(-1) === 'mcp').length, 1);
  }
});

test('real startup and model deadlines interrupt the provider and identify the correct setting', async () => {
  for (const [setting, operation] of [[START, '--version'], [REQUEST, 'tools/call app_record']]) {
    process.env[setting] = '15';
    const waiting = s => child(s, { done: delay(1500, { exitCode: 0 }, { signal: s.signal }) });
    const h = setting === START ? harness(child, waiting) : harness(waiting);
    const request = setting === START ? h.runtime.version() : h.runtime.request('tools/call', { name: 'app_record' }, exec());
    await assert.rejects(request, e => { assert.equal(e.name, 'TimeoutError'); return actionable(e, operation, setting + '=15'); });
    assert.equal(h.specs.at(-1).signal.aborted, true);
  }
});

test('disposal and external abort preserve the original reason on both provider success and failure', async () => {
  for (const source of ['plugin', 'caller']) for (const rejects of [false, true]) {
    const controller = new AbortController(), reason = new Error(source + ' cancelled');
    const h = harness(s => {
      (source === 'plugin' ? h.lifetime : controller).abort(reason);
      assert.equal(s.signal.reason, reason);
      return child(s, { done: rejects ? Promise.reject(new Error('provider aborted')) : Promise.resolve({ exitCode: 0 }) });
    });
    const execution = exec(undefined, undefined, controller.signal);
    await assert.rejects(h.runtime.request('ping', {}, execution), e => e === reason);
    const count = h.specs.length;
    await assert.rejects(h.runtime.request('ping', {}, execution), e => e === reason);
    assert.equal(h.specs.length, count, 'no spawn after cancellation');
  }
});

test('disposal during initialization still rejects the completed response', async () => {
  const h = harness(), reason = new Error('disposed during initialization');
  await assert.rejects(h.runtime.request('ping', {}, undefined, () => h.lifetime.abort(reason)), e => e === reason);
});

test('overlapping project calls isolate cwd, sandbox, stdin, cancellation and results', async () => {
  const both = Promise.withResolvers(), gates = new Map();
  const h = harness(s => {
    const gate = Promise.withResolvers(), name = JSON.parse(s.stdio.stdin.data.trimEnd().split('\n').at(-1)).params.name;
    gates.set(name, { gate, spec: s });
    if (gates.size === 2) both.resolve();
    return child(s, { done: gate.promise, out: wire(reply(1, init), reply(2, { cwd: s.cwd, name })) });
  });
  const stopA = new AbortController();
  const a = exec(resolve('work A'), 'workspace-write', stopA.signal), b = exec(resolve('work B'), 'danger-full-access');
  const first = h.runtime.request('tools/call', { name: 'alpha' }, a), second = h.runtime.request('tools/call', { name: 'beta' }, b);
  await both.promise;
  const x = gates.get('alpha'), y = gates.get('beta');
  assert.deepEqual([x.spec.cwd, y.spec.cwd], [a.agent.session.cwd, b.agent.session.cwd]);
  assert.deepEqual(x.spec.argv, ['sandbox:workspace-write', binary, 'mcp']); assert.deepEqual(y.spec.argv, [binary, 'mcp']);
  assert.notEqual(x.spec.signal, y.spec.signal);
  assert.ok(h.ensured.some(e => e.agent === a.agent && e.signal === x.spec.signal));
  assert.ok(h.ensured.some(e => e.agent === b.agent && e.signal === y.spec.signal));
  assert.ok(h.confined.length && h.confined.every(c => c.policy === a.agent.session && c.signal === x.spec.signal));
  const reason = new Error('only alpha cancelled'); stopA.abort(reason);
  assert.equal(y.spec.signal.aborted, false);
  y.gate.resolve({ exitCode: 0 }); x.gate.resolve({ exitCode: 0 });
  await assert.rejects(first, e => e === reason);
  assert.deepEqual(await second, { cwd: b.agent.session.cwd, name: 'beta' });
});

test('missing sessions and sandbox denials never fall back to unsandboxed spawn', async () => {
  const h = harness(), denied = new Error('sandbox denied');
  await assert.rejects(h.runtime.request('ping', {}, { signal: new AbortController().signal, agent: {} }), /active DSH project session/);
  h.ctx.sandbox.confine = async () => { throw denied; };
  await assert.rejects(h.runtime.request('ping', {}, exec()), e => e === denied);
  assert.equal(h.specs.length, 0);
});

test('Unix checks the reported version before each session MCP call, with one deadline for both processes', async t => {
  const saved = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...saved, value: 'linux' });
  t.after(() => Object.defineProperty(process, 'platform', saved));
  const bad = harness(child, s => child(s, { out: 'rust-anything 3.3.1' }));
  await assert.rejects(bad.runtime.request('ping', {}, exec()), /Expected rust-anything 3\.3\.0/);
  assert.deepEqual(bad.specs.map(s => s.argv), [['sandbox:read-only', binary, '--version']]);
  const h = harness(), e = exec();
  for (let i = 0; i < 2; i++) await h.runtime.request('ping', {}, e);
  assert.deepEqual(h.specs.map(s => s.argv.at(-1)), ['--version', 'mcp', '--version', 'mcp']);
  assert.ok(h.specs.every(s => s.cwd === e.agent.session.cwd && s.argv[0] === 'sandbox:read-only'));
  assert.equal(h.specs[0].signal, h.specs[1].signal); assert.equal(h.specs[2].signal, h.specs[3].signal);
  assert.notEqual(h.specs[0].signal, h.specs[2].signal);
});
