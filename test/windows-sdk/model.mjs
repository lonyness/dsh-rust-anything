// Invocation-only test model. No tools, overrides, approval listeners, HTTP or credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
export const name = 'ra-fixed-test-model';
export const inject = ['llm', 'pluginManager'];
export const prefix = 'mcp__rust-anything__', provider = 'ra-scripted-local', model = 'one-call';
const packageName = 'dsh-rust-anything';
const expected = 'analyze bridge refresh record build diff profile go enable disable report bench fuzz shadow map package gate app_record app_replay app_front_door app_wire app_lift'.split(' ').map(x => prefix + x).sort();
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function plan(repo, node, id) {
  const record = {repo, run:[node, 'count.cjs'], inputs:join(repo, 'inputs.jsonl'), traps:false, timeout:10};
  const replay = {repo, build:'./correct.exe', timeout:10};
  return [
    ['skill', 'skill', {name:'rust-anything'}],
    ['prompt', 'rust_anything_prompt', {name:'port_unit', path:repo, unit:'count_symbols'}],
    ['analyze', prefix+'analyze', {root:'.', lang:'python'}],
    ['record-deny', prefix+'app_record', record, 'rejected'],
    ['record-allow', prefix+'app_record', record, 'allowed-once'],
    ['record-deny-again', prefix+'app_record', record, 'rejected'],
    ['replay-allow', prefix+'app_replay', replay, 'allowed-once'],
    ['replay-deny-again', prefix+'app_replay', replay, 'rejected'],
  ].map(([phase,name,args,outcome], index) => ({phase,name,args,outcome,callId:`c${index}_${id}`, prompt:`RA sample ${id}: ${phase}`}));
}

// Run *after* initialize's loader-readiness barrier. Read real Manager results, not the projected plugin_manager tool or raw files alone.
async function inspectDisplay(ctx, root, opts) {
  const bundle = (await ctx.pluginManager.listBundles()).find(b => b.name === packageName);
  const plugins = (await ctx.pluginManager.listPlugins()).filter(p => p.moduleName === packageName);
  const catalog = opts.tools?.filter(t => t.name.startsWith(prefix) || t.name === 'rust_anything_prompt');
  const skill = opts.messages.filter(m => m.source?.kind === 'skill-catalog').flatMap(m => m.source.entries).find(s => s.name === 'rust-anything');
  const details = {};
  for (const locale of ['en','zh-CN']) details[locale] = await ctx.pluginManager.readBundleDetail(packageName, locale);
  writeFileSync(join(root, 'manager.json'), JSON.stringify({bundle,plugins,details}, null, 2));
  writeFileSync(join(root, 'discovery.json'), JSON.stringify({catalog,skill}, null, 2));
  assert.equal(bundle?.installed, true); assert.equal(bundle.enabled, true); assert.equal(bundle.availability, 'profile');
  assert.notEqual(bundle.listedByDefault, false); assert.ok(!bundle.error && !bundle.meta?.error);
  assert.equal(plugins.length, 1); const row = plugins[0];
  assert.equal(row.enabled, true); assert.equal(row.fiberPhase, 'active'); assert.ok(!row.diagnostic && !row.meta?.error);
  assert.ok(bundle.rows.some(r => r.entryId === row.entryId && r.moduleName === packageName));
  const pkg = realpathSync(join(root,'home','profiles','sdk','node_modules',packageName));
  const local = path => { const full = realpathSync(resolve(pkg,path)), r = relative(pkg,full); assert.ok(r && r !== '..' && !r.startsWith('..'+sep) && !isAbsolute(r)); return readFileSync(full) };
  const manifest = JSON.parse(local('package.json')); assert.equal(bundle.version, manifest.version);
  const icon = local(manifest.icon ?? manifest.exports['./icon']); const translated = [];
  for (const locale of ['en', 'zh-CN']) {
    const code = locale === 'en' ? 'en' : 'zh'; const reference = JSON.parse(local(`locale/${code}.json`)).meta;
    assert.ok(reference.title?.trim() && reference.description?.trim()); translated.push(reference.title);
    for (const meta of [bundle.meta,row.meta]) {
      assert.equal(meta.title[code], reference.title); assert.equal(meta.description[code], reference.description);
      const m = /^data:image\/svg\+xml;base64,(.+)$/.exec(meta.icon); assert.ok(m,'manager must deliver a non-generic SVG'); assert.deepEqual(Buffer.from(m[1],'base64'),icon);
    }
    const detail = details[locale]; assert.equal(detail.status,'found'); assert.equal(detail.origin,'locale'); assert.equal(detail.path, reference.detail);
    const md = detail.markdown.trim(); assert.equal(md, local(detail.path).toString('utf8').trim());
    const match = /^!\[([^\]\r\n]+)\]\(([^()\s]+)\)$/.exec(md); assert.ok(match, 'one local feature image per detail');
    assert.match(local(join(dirname(detail.path),match[2])).toString('utf8'), /<svg[\s>]/);
  }
  assert.notEqual(translated[0],translated[1]); assert.notEqual(details.en.path,details['zh-CN'].path);
  assert.deepEqual(catalog.filter(t => t.name.startsWith(prefix)).map(t => t.name).sort(), expected);
  assert.deepEqual(catalog.find(t=>t.name==='rust_anything_prompt').parameters.properties.name.enum.slice().sort(), ['port_unit','port_whole_app']);
  assert.ok(skill?.description?.trim(), 'skill must be advertised in the real model-facing catalog');
}

export async function apply(ctx) {
  const root = process.env.RA_RUN, repo = join(root,'样例 é🦀');
  assert.equal(process.cwd(),repo); assert.equal(process.env.DSH_HOME,join(root,'home'));
  const steps = plan(repo,process.env.RA_NODE,process.env.RA_SESSION);
  const {LlmAdapter} = await import(pathToFileURL(join(process.env.RA_PACKAGES,'dsh-llm','lib','index.js')));
  let i = 0, waiting = false;
  class Scripted extends LlmAdapter {
    async *stream(opts) {
      opts.signal?.throwIfAborted(); assert.equal(opts.provider, provider); assert.equal(opts.model, model); assert.ok(!opts.purpose);
      const s = steps[i]; assert.ok(s,'unexpected model request after planned steps');
      const prompt = opts.messages.filter(m => m.role === 'user' && m.source?.kind === 'user').at(-1);
      assert.ok(prompt?.content.some(b => b.type === 'text' && b.text === s.prompt), 'only the next fixed SDK prompt can trigger a call');
      if (!waiting) {
        if (i === 0) await inspectDisplay(ctx, root, opts);
        assert.ok(opts.tools.some(t=>t.name===s.name), 'target not offered by DSH');
        const args = JSON.stringify(s.args); waiting = true;
        yield {type:'block-start',index:0,blockType:'tool-call'};
        yield {type:'tool-call-delta',index:0,id:s.callId,name:s.name,argumentsDelta:args};
        yield {type:'block-end',index:0,block:{type:'tool-call',id:s.callId,name:s.name,arguments:args}};
        yield {type:'finish',reason:{kind:'tool-calls'}};
      } else {
        assert.ok(opts.messages.some(m=>m.role==='tool' && m.toolCallId===s.callId),'no real result for this specific tool call');
        waiting = false; i++; const text = `Observed ${s.callId}`;
        yield {type:'block-start',index:0,blockType:'text'}; yield {type:'text-delta',index:0,text};
        yield {type:'block-end',index:0,block:{type:'text',text}}; yield {type:'finish',reason:{kind:'stop'}};
      }
    }
  }
  ctx.llm.registerAdapter([provider],new Scripted());
}
