const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');
const { schemas } = require('./upstream-v3.3.0.json');

const prefix = 'mcp__rust-anything__';
const prompts = ['port_unit', 'port_whole_app'];
const safe = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const entry = (name, annotations) => ({ name, annotations, description: 'Test ' + name, inputSchema: { type: 'object', properties: name === 'go' ? { root: { type: 'string' }, command: { type: 'array', items: { type: 'string' } } } : {} } });
const text = text => ({ type: 'text', text });
const exec = { agent: { session: { append: () => assert.fail('plugin must not manufacture a turn') } }, callId: 'call-1', signal: new AbortController().signal };
const hasBinary = process.platform === 'win32' ? process.arch === 'x64' : !!process.env.DSH_RUST_ANYTHING_BIN;

// Run the public entry point. Only DSH services are doubles; neither apply nor its tool definitions are mocked.
async function install(t, { real = false, catalog = [entry('go', { readOnlyHint: false }), entry('analyze', safe)],
  reply = () => ({ content: [text('ok')] }), decide = () => 'rejected' } = {}) {
  const tools = new Map(), skills = [], sections = [], asked = [], spawns = [];
  const state = { tools, skills, sections, asked, spawns, tool: raw => tools.get(prefix + raw) };
  const init = { protocolVersion: '2025-06-18', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'rust-anything', version: '3.3.0' }, instructions: 'Pinned instructions.' };
  function spawn({ argv, cwd, stdio }) {
    const input = stdio.stdin.data;
    const request = input && JSON.parse(input.trim().split('\n').at(-1));
    spawns.push(request || { method: '--version' });
    let stdout;
    if (real) {
      stdout = execFileSync(argv[0], argv.slice(1), { cwd, input, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    } else if (!request) {
      stdout = 'rust-anything 3.3.0';
    } else {
      const result = request.method === 'tools/list' ? { tools: catalog } : request.method === 'prompts/list' ? { prompts: prompts.map(name => ({ name })) } : reply(request);
      stdout = [init, result].map((result, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, result })).join('\n');
    }
    if (request?.method === 'tools/list') state.catalog = stdout.trim().split('\n').map(JSON.parse).find(r => r.id === request.id).result.tools;
    const collector = value => ({ readFrom: () => ({ text: value, lossy: false }) });
    return { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: collector(stdout), stderr: collector('') } };
  }
  const ctx = {
    effect: factory => t.after(factory()),
    inject: (_, register) => register({ systemPrompt: { getSectionOrder: () => 1, section: s => sections.push(s) } }),
    tools: { register: d => { assert.ok(!tools.has(d.name)); tools.set(d.name, d); } },
    skills: { register: s => skills.push(s) },
    approval: { request: q => { asked.push(q); return decide(q); } },
    workingDirectory: { ensure: () => __dirname }, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
    subprocess: { spawn },
  };
  const { apply } = await import('dsh-rust-anything');
  // No binary is run in the synthetic cases. Unix runtimePath still requires an absolute path.
  if (!real && !hasBinary) process.env.DSH_RUST_ANYTHING_BIN = '/mock/rust-anything';
  try { await apply(ctx); } finally { if (!real && !hasBinary) delete process.env.DSH_RUST_ANYTHING_BIN; }
  return state;
}

test('apply registers the pinned catalog, both prompts, and a skill with a resolvable guide',
  { skip: !hasBinary && 'needs the trusted 3.3.0 executable' }, async t => {
  let decision = 'rejected';
  const h = await install(t, { real: true, decide: () => decision });
  assert.deepEqual([...h.tools.keys()], [...Object.keys(schemas).map(n => prefix + n), 'rust_anything_prompt']);
  for (const tool of h.catalog) {
    const d = h.tool(tool.name);
    assert.deepEqual(d.parameters, tool.inputSchema);
    assert.equal(d.description, tool.description);
    if (['analyze', 'map'].includes(tool.name)) {
      const args = { [tool.name === 'analyze' ? 'root' : 'repo']: resolve(__dirname, '../lib') };
      const value = await d.execute(args, exec);
      assert.deepEqual(JSON.parse(value.content[0].text), value.structuredContent);
      assert.deepEqual(d.output.render(args, value), [text(value.content[0].text)]);
    } else {
      const before = h.spawns.length;
      const valid = Object.fromEntries(d.parameters.required.map(k => [k, d.parameters.properties[k].type === 'array' ? ['noop'] : '.']));
      await assert.rejects(d.execute(valid, exec), /not run: DSH approval rejected/);
      assert.equal(h.spawns.length, before, 'denial must not spawn ' + tool.name);
    }
  }
  assert.equal(h.asked.length, 20);
  const prompt = h.tools.get('rust_anything_prompt');
  assert.deepEqual(prompt.parameters.properties.name.enum, prompts);
  for (const [name, extra, match] of [['port_unit', {}, /best first port/], ['port_unit', { unit: 'math.ts' }, /math[.]ts/], ['port_whole_app', {}, /pure Rust app/]]) {
    const args = { name, path: 'toy repo', ...extra };
    const value = await prompt.execute(args, exec);
    assert.match(value.messages[0].content.text, /toy repo/);
    assert.match(value.messages[0].content.text, match);
    assert.doesNotMatch(value.messages[0].content.text, /If the MCP tools are not available/);
    assert.deepEqual(prompt.output.render(args, value), value.messages.map(m => m.content));
  }
  assert.equal(h.asked.length, 20, 'prompts are read-only');
  decision = 'allowed-once';
  await assert.rejects(h.tool('gate').execute({}, exec), /missing .crate./);
  assert.equal(h.asked.length, 20, 'missing required arguments stop before approval');
  await assert.rejects(h.tool('gate').execute({ crate: resolve(__dirname, 'no-such-test-crate') }, exec), error => {
    assert.equal(error.cause.isError, true);
    assert.match(error.cause.structuredContent.code, /\S/);
    return true;
  });
  assert.equal(h.asked.length, 21);
  assert.equal(h.skills.length, 1);
  const skill = h.skills[0];
  assert.equal(skill.name, 'rust-anything');
  assert.equal(skill.source, 'bundled');
  assert.equal(skill.provider, 'rust-anything');
  assert.match(skill.description, /Kotlin, PHP or C#/);
  assert.deepEqual(skill.resourceBase, { kind: 'directory', path: resolve(__dirname, '../skills/rust-anything').split(sep).join('/') });
  assert.ok(skill.content.includes('[whole-app.md](whole-app.md)'));
  assert.ok(readFileSync(join(skill.resourceBase.path, 'whole-app.md'), 'utf8').length > 0);
  assert.ok(skill.content.includes((await import('../lib/runtime.js')).runtimePath()));
  assert.doesNotMatch(skill.content, /If the MCP tools are not available, use the CLI/);
  assert.match(skill.content, /Never fall back to a terminal/);
  // The pinned guide still claims PHP and C# bridges are missing; the injection must correct it.
  assert.match(skill.content, /Languages: TypeScript\/JavaScript, Python, C, Go, Ruby, Java, Kotlin, PHP and C#/);
  assert.doesNotMatch(skill.content, /does not take (PHP|C#) units yet/);
  assert.match(skill.content, /PHP FFI, P\/Invoke for C#/);
  assert.match(skill.content, /top-level functions only/);
  const playbook = join(skill.resourceBase.path, 'playbook.md');
  assert.ok(skill.content.includes(playbook.split(sep).join('/')));
  const guidance = readFileSync(playbook, 'utf8');
  for (const section of ['## 1. Which languages this build handles', '## 2. Compile errors after a port',
    '## 3. Reviewing the boundary: FFI and unsafe', '## 4. Crate and feature fit']) assert.ok(guidance.includes(section), section);
  for (const rule of ['E0382', 'E0499', 'E0515', 'E0277', 'rust_anything_free', 'Guaranteed by', 'rust-version']) assert.ok(guidance.includes(rule), rule);
  assert.equal(h.sections[0].name, 'mcp:rust-anything');
  assert.match(h.sections[0].text(), /Never mark a port done/);
  assert.match(h.sections[0].text(), /mcp__rust-anything__go.*One approval/);
});

test('invalid targets and mistyped optional arguments never prompt, run or silently select defaults', async t => {
  const h = await install(t, { real: false, decide: () => 'allowed-once', catalog: [
    { ...entry('app_replay'), inputSchema: { type: 'object', properties: { repo: { type: 'string' }, build: { type: 'string' }, port: { type: 'integer' }, timeout: { type: 'integer' } }, required: ['repo'] } },
    { ...entry('app_record'), inputSchema: { type: 'object', properties: { repo: { type: 'string' }, run: { type: 'array', items: { type: 'string' } }, port: { type: 'integer' }, timeout: { type: 'integer' }, pace: { type: 'integer' }, traps: { type: 'boolean' }, float_tolerance: { type: 'number' } }, required: ['repo'] } },
    { ...entry('build'), inputSchema: { type: 'object', properties: { abi: { type: 'array', items: { type: 'string', enum: ['x86', 'x86_64'] } } } } },
  ] });
  const before = h.spawns.length;
  for (const [name, args, error] of [
    ...[['./missing.exe'], null, false, '', ' \t'].map(build => ['app_replay', { repo: '.', build }, /app_replay.*build.*string/]),
    ['app_replay', { repo: '.', bulid: './missing.exe' }, /app_replay.*bulid/],
    ['app_replay', { repo: '.', timeout: 1.5 }, /timeout.*integer/],
    ['app_replay', [], /object/], ['app_replay', {}, /repo/],
    ['app_record', { repo: '.', run: 'python app.py' }, /run.*array/],
    ['app_record', { repo: '.', run: ['python', null] }, /run\[1\].*string/],
    ...[{ run: [] }, { run: [''] }, { run: ['  '] }].map(args => ['app_record', { repo: '.', ...args }, /run.*non-empty argv/]),
    ...[['app_replay', { repo: '.', port: 70000 }], ['app_replay', { repo: '.', port: 0 }],
      ['app_record', { repo: '.', port: -1 }], ['app_record', { repo: '.', port: 65536 }],
    ].map(([name, args]) => [name, args, new RegExp(name + '\\.port.*got ' + args.port)]),
    ...[['app_replay', { repo: '.', timeout: -1 }], ['app_record', { repo: '.', timeout: -30 }],
      ['app_record', { repo: '.', pace: -5 }],
    ].map(([name, args]) => [name, args, new RegExp(name + '\\.(timeout|pace).*got -')]),
    ['app_record', { repo: '.', traps: 'false' }, /traps.*boolean/],
    ['app_record', { repo: '.', float_tolerance: Infinity }, /float_tolerance.*number/],
    ['build', { abi: ['invalid'] }, /abi\[0\].*x86/],
  ]) await assert.rejects(h.tool(name).execute(args, exec), error);
  assert.equal(h.asked.length, 0); assert.equal(h.spawns.length, before);
  for (const args of [{ repo: '.' }, { repo: '.', build: '"./a b.exe" --flag' }, { repo: '.', port: 8080, timeout: 0 }]) {
    await h.tool('app_replay').execute(args, exec);
    assert.deepEqual(h.spawns.at(-1).params.arguments, args);
  }
  assert.equal(h.asked.length, 3, 'an intentional baseline, an explicit build or a valid port/timeout still requires a grant');
});

test('go requests approval for that exact workload once; no grant carries to the next call', async t => {
  const args = { root: 'toy repo', command: ['node', 'demo file.js'] };
  const intended = structuredClone(args);
  let allowed = true;
  const h = await install(t, { decide: () => allowed ? 'allowed-once' : 'rejected' });
  const pending = h.tool('go').execute(args, exec);
  args.command[1] = 'changed.js';
  await pending;
  const [q] = h.asked;
  assert.equal(q.toolName, prefix + 'go');
  assert.equal(q.agent, exec.agent);
  assert.equal(q.callId, exec.callId);
  assert.ok(q.signal instanceof AbortSignal);
  for (const part of ['go', 'profile', 'toy repo', 'demo file.js']) assert.ok(q.reason.includes(part));
  assert.equal(h.spawns.filter(r => r.method === 'tools/call').length, 1);
  assert.deepEqual(h.spawns.at(-1).params, { name: 'go', arguments: intended });
  const before = h.spawns.length;
  allowed = false;
  await assert.rejects(h.tool('go').execute(intended, exec), /rejected.*never/);
  assert.equal(h.asked.length, 2);
  assert.equal(h.spawns.length, before);
});

test('missing session, outside-turn SDK calls, never and non-grants cannot execute', async t => {
  let decision;
  const h = await install(t, { decide: () => { if (decision instanceof Error) throw decision; return decision; } });
  const call = () => h.tool('go').execute({}, exec);
  const before = h.spawns.length;
  for (const name of ['go', 'analyze']) await assert.rejects(h.tool(name).execute({}, {}), /active DSH project session/);
  await assert.rejects(h.tools.get('rust_anything_prompt').execute({ name: 'port_unit', path: '.' }), /active DSH project session/);
  assert.equal(h.asked.length, 0);
  decision = new Error('approval.request() outside an open turn: audit events must be turn-enclosed');
  await assert.rejects(call(), new RegExp('open DSH turn.*SDK.*session/prompt.*approvalRequests.*approval/request'));
  decision = new Error('approval audit append failed');
  await assert.rejects(call(), decision);
  for (decision of ['rejected', 'cancelled', 'unavailable', 'allowed-always', true, undefined]) {
    await assert.rejects(call(), new RegExp('not run: DSH approval ' + decision));
  }
  assert.equal(h.spawns.length, before, 'not even a native preflight may run');
});

test('unknown and mutating names with all safe hints still need a one-call grant', async t => {
  let decision = 'rejected';
  const h = await install(t, { catalog: [entry('probe', safe), entry('go', safe)], decide: () => decision });
  const before = h.spawns.length;
  for (const name of ['probe', 'go']) await assert.rejects(h.tool(name).execute({}, exec), /rejected.*Do not retry through a terminal/);
  assert.deepEqual(h.asked.map(q => q.toolName), [prefix + 'probe', prefix + 'go']);
  assert.equal(h.spawns.length, before);
  decision = 'allowed-once';
  await h.tool('probe').execute({}, exec);
  assert.equal(h.asked.length, 3);
  assert.deepEqual(h.spawns.at(-1).params, { name: 'probe', arguments: {} });
});

test('analyze and map require approval if any safety hint is missing, mistyped or reversed', async t => {
  for (const hints of [undefined, null, {}, ...Object.keys(safe).flatMap(key => [
    { ...safe, [key]: undefined }, { ...safe, [key]: String(safe[key]) }, { ...safe, [key]: !safe[key] },
  ])]) {
    const h = await install(t, { catalog: [entry('analyze', hints), entry('map', hints)] });
    const before = h.spawns.length;
    for (const name of ['analyze', 'map']) await assert.rejects(h.tool(name).execute({}, exec), /rejected/);
    assert.deepEqual(h.asked.map(q => q.toolName), [prefix + 'analyze', prefix + 'map']);
    assert.equal(h.spawns.length, before);
  }
});

test('text and structured values round-trip; errors throw with native text and structured diagnostics', async t => {
  let raw;
  const h = await install(t, { reply: () => raw });
  const d = h.tool('analyze');
  assert.deepEqual(d.output.schema, { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false });
  const content = [text('first'), text('第二行🦀')];
  const structuredContent = { items: [{ count: 0 }], ok: false };
  raw = { isError: false, content, structuredContent };
  const value = await d.execute({}, exec);
  assert.deepEqual(value, { content, structuredContent });
  assert.deepEqual(d.output.render({}, value), [text('first\n第二行🦀')]);
  raw = { content: [] };
  assert.deepEqual(await d.execute({}, exec), { content: [] });
  assert.deepEqual(d.output.render({}, raw), [text('(analyze returned no model-visible content)')]);
  raw = { isError: true, content: [text('missing crate'), text('details')], structuredContent: { code: 'invalid_arguments', retryable: false, hint: 'pass crate' } };
  await assert.rejects(d.execute({}, exec), error => {
    assert.match(error.message, /missing crate\ndetails/);
    assert.match(error.message, /invalid_arguments/);
    assert.match(error.message, /"retryable":false/);
    assert.deepEqual(error.cause, raw);
    return true;
  });
  raw = { isError: true, content: [text('python failed (exit code: 9009):')] };
  await assert.rejects(d.execute({}, exec), e => {
    assert.deepEqual(e.cause, raw);
    assert.match(e.message, /9009[\s\S]*Windows Store alias/);
    return true;
  });
  for (raw of [{}, { content: [{ type: 'image' }] }, { content: [text('bad flag')], isError: 'false' }]) {
    await assert.rejects(d.execute({}, exec), /invalid rust-anything 3.3.0 text result/);
  }
});

test('prompt text drops the standalone CLI fallback that DSH forbids', async t => {
  const guide = 'Guide line\nIf the MCP tools are not available, use the CLI, install it and run `rust-anything setup`.\n\nAfter the fallback.';
  const h = await install(t, { reply: () => ({ description: 'pinned', messages: [
    { role: 'user', content: text(guide) },
    { role: 'user', content: { type: 'image', data: 'x', mimeType: 'image/png' } },
  ] }) });
  const value = await h.tools.get('rust_anything_prompt').execute({ name: 'port_unit', path: '.' }, exec);
  assert.equal(value.description, 'pinned');
  assert.equal(value.messages[0].content.text, 'Guide line\nAfter the fallback.');
  assert.deepEqual(value.messages[1].content, { type: 'image', data: 'x', mimeType: 'image/png' });
  assert.equal(h.asked.length, 0);
});

test('invalid prompt name, path or unit is diagnosed before any subprocess starts', async t => {
  const h = await install(t);
  const prompt = h.tools.get('rust_anything_prompt');
  const before = h.spawns.length;
  for (const [args, expected] of [
    [null, /name.*non-empty/], [{ name: '  ' }, /name.*non-empty/], [{ name: 'other' }, /Unknown prompt name.*other/],
    [{ name: 'port_unit' }, /path.*non-empty/], [{ name: 'port_unit', path: ' \t' }, /path.*non-empty/],
    [{ name: 'port_unit', path: 3 }, /path.*non-empty/], ...[null, false, ' ', ''].map(unit => [{ name: 'port_unit', path: '.', unit }, /unit.*non-empty/]),
    [{ name: 'port_whole_app', path: '.', unit: 'x' }, /does not accept unit/],
  ]) await assert.rejects(prompt.execute(args, exec), expected);
  assert.equal(h.spawns.length, before);
  assert.equal(h.asked.length, 0);
});
