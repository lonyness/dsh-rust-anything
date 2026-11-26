// Needs rustc + a linker. On Unix, set DSH_RUST_ANYTHING_BIN to the trusted v3.3.0 executable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { join } = require('node:path');
const snapshot = require('./upstream-v3.3.0.json');
const suffix = process.platform === 'win32' ? '.exe' : '';
let exe;
test.before(async () => { exe = (await import('../lib/runtime.js')).runtimePath(); });

function fixture(t) {
  const root = fs.mkdtempSync(join(__dirname, '.parity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 4 }));
  return root;
}

function run(cwd, command, args, input, extraEnv) {
  const env = { ...process.env, TEMP: cwd, TMP: cwd, TMPDIR: cwd, RUSTUP_AUTO_INSTALL: '0', ...extraEnv };
  // A cold Windows runner spent more than 60 s on one `rustc` spawn and failed the gate
  // with ETIMEDOUT. The cap only exists to stop a hung child, so give slow machines room.
  const p = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  if (p.error) throw p.error;
  assert.equal(p.status, 0, command + ': ' + p.stderr);
  return p.stdout;
}

// The server finishes pending tool calls on stdin EOF; IDs, not line order, correlate responses.
function rpc(cwd, method, params = {}) {
  const id = 'request';
  const handshake = method === 'initialize' ? [] : [
    { id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parity', version: '1' } } },
    { method: 'notifications/initialized' }
  ];
  const input = [...handshake, { method, params, id }]
    .map(m => JSON.stringify({ jsonrpc: '2.0', ...m })).join('\n') + '\n';
  const responses = run(cwd, exe, ['mcp'], input).trimEnd().split('\n').map(JSON.parse);
  assert.equal(responses.length, handshake.length ? 2 : 1, 'notification must not get a response');
  if (handshake.length) assert.equal(responses.find(r => r.id === 'init')?.result?.serverInfo?.version, '3.3.0');
  const response = responses.find(r => r.id === id);
  assert.equal(response.id, id);
  assert.equal(response.jsonrpc, '2.0');
  return response;
}

function tool(cwd, name, args) {
  const { result, error } = rpc(cwd, 'tools/call', { name, arguments: args });
  assert.equal(error, undefined);
  assert.equal(result.isError, false, result.content[0].text);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}

// Sort only JSON object keys, preserving list order and all strings (including prompt Markdown).
function hash(value) {
  const json = JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  return createHash('sha256').update(json).digest('hex');
}

test('v3.3.0 stdio: full advertised tool and prompt contracts, including argument substitution', t => {
  const cwd = fixture(t);
  assert.equal(run(cwd, exe, ['--version']).trim(), 'rust-anything 3.3.0');
  const init = rpc(cwd, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parity', version: '1' } }).result;
  assert.deepEqual(init.serverInfo, { name: 'rust-anything', version: '3.3.0' });
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.deepEqual(init.capabilities, { tools: {}, prompts: {} });
  assert.deepEqual(rpc(cwd, 'ping').result, {});
  const list = rpc(cwd, 'tools/list').result;
  assert.equal(list.tools.length, 22);
  assert.deepEqual(list.tools.map(x => x.name), Object.keys(snapshot.schemas));
  for (const x of list.tools) assert.equal(hash(x.inputSchema), snapshot.schemas[x.name], x.name);
  assert.equal(hash(list), snapshot.toolList, 'catalog descriptions, annotations, schemas and ordering');
  const prompts = rpc(cwd, 'prompts/list').result;
  assert.deepEqual(prompts.prompts.map(p => p.name), ['port_unit', 'port_whole_app']);
  assert.equal(hash(prompts), snapshot.promptList);
  const examples = [
    ['port_unit', { path: 'toy repo' }, /best first port/],
    ['port_unit', { path: 'toy repo', unit: 'math.ts' }, /math\.ts/],
    ['port_whole_app', { path: 'toy repo' }, /pure Rust app/]
  ];
  // Upstream embeds CRLF guides on Windows; its LF-only body() leaves SKILL.md front matter there.
  // Pin each release's full response rather than stripping that real content difference.
  const expected = snapshot.promptResults[process.platform === 'win32' ? 'win32' : 'unix'];
  examples.forEach(([name, args, match], i) => {
    const prompt = rpc(cwd, 'prompts/get', { name, arguments: args }).result;
    assert.match(prompt.messages[0].content.text, /toy repo/);
    assert.match(prompt.messages[0].content.text, match);
    assert.equal(hash(prompt), expected[i], name + ' full rendered response');
  });
});

test('protocol errors are distinct from structured tool errors', t => {
  const cwd = fixture(t);
  assert.equal(rpc(cwd, 'unknown_method').error.code, -32601);
  const missing = rpc(cwd, 'prompts/get', { name: 'port_unit', arguments: { path: ' ' } });
  assert.equal(missing.error.code, -32602);
  assert.match(missing.error.message, /needs the .path. argument/);
  for (const [name, code, message] of [['gate', 'invalid_arguments', /missing .crate./], ['no_such_tool', 'unknown_tool', /unknown tool .no_such_tool./]]) {
    const { result, error } = rpc(cwd, 'tools/call', { name, arguments: {} });
    assert.equal(error, undefined);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, code);
    assert.equal(result.structuredContent.retryable, false);
    assert.match(result.structuredContent.message, message);
    assert.equal(result.content[0].text, result.structuredContent.message);
  }
});

test('app_record -> app_front_door fallback -> app_replay: distinguish Unicode scalars from UTF-8 bytes', t => {
  const cwd = fixture(t);
  const repo = join(cwd, 'toy repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(join(repo, 'count.cjs'), 'console.log(Array.from(process.argv[2]).length);\n');
  const inputs = join(repo, 'inputs.jsonl');
  fs.writeFileSync(inputs, [{ name: 'ascii', args: ['abc'] }, { name: 'unicode', args: ['é🦀'] }]
    .map(v => JSON.stringify(v)).join('\n') + '\n');
  const rec = tool(cwd, 'app_record', { repo, run: [process.execPath, 'count.cjs'], inputs, traps: false, timeout: 10 });
  assert.equal(rec.cases, 2);
  assert.equal(rec.inputs, 2);
  assert.deepEqual([rec.noisy, rec.unstable, rec.timed_out], [[], [], []]);
  const cases = join(repo, 'rust', 'app-cases');
  for (const [name, n] of [['ascii', 3], ['unicode', 2]]) {
    assert.equal(fs.readFileSync(join(cases, name + '.stdout'), 'utf8').trimEnd(), String(n));
  }
  // Exercise the generated fallback without fetching clap or counting the scaffold itself as a pass.
  const app = join(repo, 'rust', 'app');
  const door = tool(cwd, 'app_front_door', { repo, check: false });
  assert.ok(door.files.includes('src/original.rs'));
  const driver = `#[path="src/original.rs"] mod original;
fn main() -> std::process::ExitCode {
    original::report_fallbacks();
    original::run(&std::env::args_os().skip(1).collect::<Vec<_>>())
}`;
  run(app, 'rustc', ['--edition=2024', '-', '-o', join(repo, 'fallback' + suffix)], driver,
    { CARGO_MANIFEST_DIR: app, RUST_ANYTHING_REPO: repo });
  const fallback = tool(cwd, 'app_replay', { repo, build: './fallback' + suffix, timeout: 10 });
  assert.deepEqual([fallback.passed, fallback.total, fallback.skipped, fallback.failures], [2, 2, 0, []]);
  assert.deepEqual(fallback.build, ['./fallback' + suffix]);
  assert.deepEqual(fallback.fallback.names.toSorted(), ['ascii', 'unicode']);
  t.diagnostic('Generated front-door fallback: 2/2 recorded cases passed via the original.');

  const missing = './absent' + suffix;
  const negative = rpc(cwd, 'tools/call', { name: 'app_replay', arguments: { repo, build: missing, case: 'unicode' } });
  assert.equal(negative.result?.isError, true, 'a nonexistent target must not run the recorded command');
  assert.ok(negative.result.content[0].text.includes(missing));

  // Same interface and exit code for both native builds. Only the counting rule changes.
  for (const [name, count] of [['correct', 's.chars().count()'], ['different', 's.len()']]) {
    fs.writeFileSync(join(repo, 'count.rs'), 'fn main() { let s = std::env::args().nth(1).unwrap(); println!("{}", ' + count + '); }\n');
    run(cwd, 'rustc', [join(repo, 'count.rs'), '-o', join(repo, name + suffix)]);
    const replay = tool(cwd, 'app_replay', { repo, build: './' + name + suffix, timeout: 10 });
    assert.deepEqual(replay.build, ['./' + name + suffix]);
    assert.equal(replay.fallback, null);
    assert.equal(replay.total, 2);
    assert.equal(replay.skipped, 0);
    if (name === 'correct') {
      assert.equal(replay.passed, 2);
      assert.deepEqual(replay.failures, []);
    } else {
      assert.equal(replay.passed, 1);
      assert.equal(replay.failures.length, 1);
      const failure = replay.failures[0];
      assert.equal(failure.case, 'unicode');
      assert.deepEqual(failure.problems.map(p => p.field), ['stdout']);
      assert.match(failure.problems[0].detail, /2/);
      assert.match(failure.problems[0].detail, /6/);
      assert.match(fs.readFileSync(join(cases, 'replay-report.md'), 'utf8'), /unicode/);
      t.diagnostic('Original: abc=3, é🦀=2. Equivalent Rust: 2/2. Byte-length Rust: 1/2; unicode stdout: 2 vs 6.');
    }
  }
});
