// Run only via run.ps1. Starts the exact Electron/CLI entry used by Desktop's official dsh.cmd.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, constants, copyFileSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { model, plan, provider, sha } from './model.mjs';
const {RA_RUN:root, RA_NODE:node, RA_RUSTC:rustc, DSH_HOME:home} = process.env;
const [archive, expectedHash] = process.argv.slice(2);
assert.ok(process.versions.electron && process.platform==='win32' && process.arch==='x64' && root && node && rustc);
assert.ok(isAbsolute(archive) && /\.tgz$/i.test(archive) && /^[0-9a-f]{64}$/.test(expectedHash));
assert.equal(home,join(root,'home')); assert.ok(!existsSync(home),'refusing an existing home');
const repo = join(root,'样例 é🦀'), cases = join(repo,'rust','app-cases'), report = join(cases,'replay-report.md');
assert.equal(realpathSync(process.cwd()),realpathSync(repo)); assert.equal(readdirSync(repo).length,0);
const packages = join(dirname(process.execPath),'resources','app.asar','dsh','node_modules','@deepseek-ai');
const cli = ['--expose-internals',join(packages,'dsh-desktop-host','lib','cli.js')];
const sessionId = randomUUID(), steps = plan(repo,node,sessionId), name = 'dsh-rust-anything';
const env = {...process.env, RA_SESSION:sessionId, RA_PACKAGES:packages}; // already allow-listed by run.ps1
const json = file => JSON.parse(readFileSync(file,'utf8'));
const save = (leaf,value) => writeFileSync(join(root,leaf), JSON.stringify(value,null,2)+'\n');
const commands = [];
function run(label, exe, args, timeout=60000) {
  commands.push({exe,args,cwd:repo}); save('commands.json',commands);
  const p = spawnSync(exe,args,{cwd:repo,env,encoding:'utf8',windowsHide:true,timeout,maxBuffer:8*1024*1024});
  writeFileSync(join(root,label+'.stdout'),p.stdout ?? ''); writeFileSync(join(root,label+'.stderr'),p.stderr ?? '');
  if(p.error) throw p.error;
  assert.equal(p.status,0,`${label} failed; see ${label}.stderr/stdout: ${(p.stderr||p.stdout||'').slice(-1000)}`);
  return p.stdout.trim();
}
const text = path => readFileSync(path,'utf8');
function snapshot(dir=repo) {
  const files = {};
  for(const file of readdirSync(dir).sort()) {
    const path = join(dir,file), stat = lstatSync(path,{bigint:true}); assert.ok(!stat.isSymbolicLink(),'unexpected link in sample');
    const key = relative(repo,path);
    if(stat.isDirectory()){files[key+sep]='directory'; Object.assign(files,snapshot(path));}
    else { assert.ok(stat.isFile()); files[key]={sha256:sha(readFileSync(path)),mtimeNs:String(stat.mtimeNs)}; }
  }
  return files;
}
function turnProof(s, events) {
  const by = t => events.filter(e=>e.type===t);
  const one = t => {const a=by(t); assert.equal(a.length,1,`expected one ${t} in ${s.phase}`); return a[0]};
  const start=one('turn/start'), end=one('turn/end'), call=one('tool/call'), result=one('tool/result');
  assert.equal(end.data.turn,start.data.turn); assert.equal(end.data.reason.kind,'completed');
  assert.equal(call.data.turn,start.data.turn); assert.equal(result.data.turn,start.data.turn);
  assert.equal(call.data.name,s.name); assert.equal(call.data.callId,s.callId); assert.deepEqual(JSON.parse(call.data.arguments),s.args);
  assert.ok(by('assistant/message').some(e=>e.data.message.content.some(b=>b.type==='tool-call' && b.id===s.callId && b.name===s.name)));
  assert.equal(result.data.message.toolCallId,s.callId); assert.ok(start.seq<call.seq && call.seq<result.seq && result.seq<end.seq);
  const asked=by('approval/asked'), decided=by('approval/decided'); assert.equal(asked.length,s.outcome?1:0); assert.equal(decided.length,asked.length);
  if(s.outcome){
    assert.equal(asked[0].data.toolName,s.name); assert.equal(asked[0].data.callId,s.callId);
    assert.ok(asked[0].data.id); assert.equal(decided[0].data.id,asked[0].data.id); assert.equal(decided[0].data.outcome,s.outcome);
    assert.ok(call.seq<asked[0].seq && asked[0].seq<decided[0].seq && decided[0].seq<result.seq);
  }
  const error=result.data.message.isError===true, payload=result.data.message.content.map(b=>b.text??'').join('\n');
  assert.equal(error,s.outcome==='rejected',`${s.phase}: ${payload.slice(0,1200)}`);
  if(error) assert.match(payload,/rejected/i); // Not a protocol/unavailable/sandbox error standing in for a rejection.
  if(s.phase==='skill') assert.match(payload,/mcp__rust-anything__/);
  if(s.phase==='prompt'){assert.ok(payload.includes(repo)); assert.match(payload,/count_symbols/);}
  if(s.phase==='analyze') assert.match(payload,/counter\.py/);
  if(s.phase==='record-allow'){const r=JSON.parse(payload); assert.equal(r.cases,2); assert.equal(r.inputs,2); assert.deepEqual([r.noisy,r.unstable,r.timed_out],[[],[],[]]);}
  if(s.phase==='replay-allow'){const r=JSON.parse(payload); assert.deepEqual([r.passed,r.total,r.skipped,r.failures],[2,2,0,[]]);}
  return {phase:s.phase,turn:start.data.turn,callId:s.callId,tool:s.name,seq:[start.seq,call.seq,...asked.map(e=>e.seq),...decided.map(e=>e.seq),result.seq,end.seq],approval:asked[0]?.data.id??null,outcome:s.outcome??null,error};
}
async function main(){
  const staged=join(root,'candidate.tgz'); copyFileSync(archive,staged,constants.COPYFILE_EXCL);
  assert.equal(sha(readFileSync(staged)),expectedHash,'copied candidate differs; no install');
  const pre=JSON.parse(run('packed-manifest',join(process.env.SystemRoot,'System32','tar.exe'),['-xOf',staged,'package/package.json']));
  assert.equal(pre.name,name); assert.equal(typeof pre.version,'string'); assert.ok(pre.dsh?.bundle?.patch);
  for(const key of ['dependencies','optionalDependencies','peerDependencies','bundledDependencies','bundleDependencies']) assert.equal(Object.keys(pre[key]??{}).length,0,`unexpected ${key}: review before installation`);
  assert.ok(!Object.keys(pre.scripts??{}).some(s=>/^(preinstall|install|postinstall|prepare|prepublish|pnpm:devPreinstall)$/i.test(s)),'unexpected lifecycle script');
  const dsh=json(join(packages,'dsh','package.json')); assert.equal(dsh.name,'@deepseek-ai/dsh');
  const pnpm=json(join(dirname(process.execPath),'resources','runtime','primary-runtime','dependencies','pnpm','package.json')).version;
  const versions={candidate:pre.name+'@'+pre.version,archive,sha256:expectedHash,dsh:dsh.version,electron:process.versions.electron,hostNode:process.versions.node,pnpm,fixtureNode:run('node-version',node,['--version']),node,rustc,compiler:run('rustc-version',rustc,['-Vv']),profile:'sdk',home,repo,sessionId};
  save('versions.json',versions); save('plan.json',steps);
  writeFileSync(join(repo,'counter.py'),'def count_symbols(value):\n    return len(value)\n');
  writeFileSync(join(repo,'count.cjs'),`require('node:fs').appendFileSync(require('node:path').join(__dirname,'original-runs.jsonl'),JSON.stringify(process.argv.slice(2))+'\\n');\nconsole.log(Array.from(process.argv[2]).length);\n`);
  writeFileSync(join(repo,'inputs.jsonl'),[{name:'ascii',args:['abc']},{name:'unicode',args:['é🦀']}].map(v=>JSON.stringify(v)).join('\n')+'\n');
  writeFileSync(join(repo,'count.rs'),`use std::io::Write;\nfn main(){ let s=std::env::args().nth(1).unwrap(); let trace=std::env::current_exe().unwrap().parent().unwrap().join("rust-runs.txt"); writeln!(std::fs::OpenOptions::new().append(true).create(true).open(trace).unwrap(), "{}", s).unwrap(); println!("{}",s.chars().count()); }\n`);
  run('compile',rustc,['count.rs','-o','correct.exe']); // build only; do not execute either sample before its approval
  assert.ok(!existsSync(cases) && !existsSync(join(repo,'original-runs.jsonl')) && !existsSync(join(repo,'rust-runs.txt')));
  run('profile-init',process.execPath,[...cli,'--profile','sdk','--dump-default-config']);
  run('install',process.execPath,[...cli,'plugin','--profile','sdk','add','file:'+staged.replaceAll('\\','/')],120000);
  const pkg=join(home,'profiles','sdk','node_modules',name), installed=realpathSync(pkg), escape=relative(realpathSync(home),installed);
  assert.ok(escape && !escape.startsWith('..') && !isAbsolute(escape));
  assert.deepEqual(json(join(pkg,'package.json')),pre); assert.equal(sha(readFileSync(staged)),expectedHash);
  const engine=join(pkg,'runtime','win32-x64','rust-anything.exe'); versions.engineSha256=sha(readFileSync(engine));
  assert.equal(versions.engineSha256,'7cf46ddfcc987f3ccd5bb501130254b765fb3690b0494ba1a65b84f872254183','unexpected pinned upstream Windows engine bytes');
  versions.engine=run('engine-version',engine,['--version']); assert.equal(versions.engine,'rust-anything 3.3.0'); save('versions.json',versions);
  // JSON is a YAML document. This launch overlay changes no permission, no profile layer and no current DSH settings.
  const patch=join(root,'sdk-only.patch.yml'); writeFileSync(patch,JSON.stringify([
    {id:'session-persistence-jsonl',config:{root:join(home,'sessions'),compression:'none'}},
    {id:'agent-instructions',disabled:true},{id:'skill-filesystem',disabled:true},
    {insert:[{id:'qa-fixed-model',name:new URL('./model.mjs',import.meta.url).href}]},
  ],null,2));
  const {JsonRpcLineTransport}=await import(pathToFileURL(join(packages,'dsh-sdk-protocol','lib','index.js')));
  const args=[...cli,'--profile','sdk','--patch',patch]; commands.push({exe:process.execPath,args,cwd:repo}); save('commands.json',commands);
  const [stdout,stdin,stderr]=['sdk-host.ndjson','sdk-client.ndjson','sdk.stderr'].map(f=>openSync(join(root,f),'wx'));
  const host=spawn(process.execPath,args,{env,cwd:repo,windowsHide:true,stdio:['pipe','pipe',stderr]});
  const closed=once(host,'close'); closed.catch(()=>{}); host.stdin.on('error',()=>{});
  host.stdout.on('data',data=>writeSync(stdout,data));
  const out=new Writable({write(chunk,encoding,done){writeSync(stdin,chunk); host.stdin.write(chunk,encoding,done)}});
  const rpc=new JsonRpcLineTransport(host.stdout,out), ask=(method,params,ms=75000)=>rpc.request(method,params,AbortSignal.timeout(ms));
  let active, phaseEvents=[], numAnswered=0, anomaly; const records=[], all=[];
  rpc.onNotification((method,params)=>{if(method==='session.event' && params.sessionId===sessionId){all.push(params.event); phaseEvents.push(params.event)}});
  rpc.onRequest(async(method,p)=>{
    // Bind to an actual DSH-emitted call (full arguments, not substrings of reason) in the one open phase and session.
    try {
      assert.equal(method,'approval/request'); assert.equal(p.sessionId,sessionId); assert.ok(active?.outcome);
      assert.equal(p.callId,active.callId); assert.equal(p.toolName,active.name); assert.equal(numAnswered,0); assert.ok(!anomaly);
      const calls=phaseEvents.filter(e=>e.type==='tool/call'); assert.equal(calls.length,1); const c=calls[0].data;
      assert.equal(c.callId,p.callId); assert.equal(c.name,p.toolName); assert.deepEqual(JSON.parse(c.arguments),active.args);
      const asked=phaseEvents.filter(e=>e.type==='approval/asked'); assert.equal(asked.length,1); assert.equal(asked[0].data.callId,c.callId);
      assert.equal(phaseEvents.filter(e=>e.type==='turn/start').length,1); assert.equal(phaseEvents.filter(e=>e.type==='turn/end').length,0);
      numAnswered++; return {outcome:active.outcome};
    } catch(e){anomaly??=e; return {outcome:'rejected'}}
  });
  rpc.start();
  try {
    const init=await ask('initialize',{provider,model,cwd:repo,approvalRequests:true}); assert.equal(init.serverInfo.name,'deepseek-harness-sdk-runtime'); save('initialize.json',init);
    const where=await ask('session/working-directory/get',{sessionId}); assert.equal(realpathSync(where.cwd),realpathSync(repo));
    for(const s of steps){
      active=s; phaseEvents=[]; numAnswered=0; const denied=s.outcome==='rejected', before=denied?snapshot():null;
      if(denied) save(s.phase+'-before.json',before);
      const receipt=await ask('session/prompt',{sessionId,contentBlocks:[{type:'text',text:s.prompt}]}); assert.ok(receipt.messageId);
      await ask('session/wait',{sessionId}); active=undefined; if(anomaly) throw anomaly;
      assert.equal(numAnswered,s.outcome?1:0); const proof=turnProof(s,phaseEvents);
      if(denied){const after=snapshot(); save(s.phase+'-after.json',after); assert.deepEqual(after,before,'a rejected call changed the sample tree');}
      if(s.phase==='record-deny'){assert.ok(!existsSync(join(repo,'rust')) && !existsSync(join(repo,'original-runs.jsonl')) && !existsSync(join(repo,'rust-runs.txt')));}
      if(s.phase==='record-allow'){
        const runs=text(join(repo,'original-runs.jsonl')).trimEnd().split('\n').map(line=>JSON.parse(line)[0]); assert.deepEqual([...new Set(runs)].sort(),['abc','é🦀']);
        for(const [label,n] of [['ascii','3'],['unicode','2']]) assert.equal(text(join(cases,label+'.stdout')).trimEnd(),n);
        assert.ok(!existsSync(join(repo,'rust-runs.txt')) && !existsSync(report)); save('record-files.json',snapshot(cases));
      }
      if(s.phase==='replay-allow'){
        assert.deepEqual(text(join(repo,'rust-runs.txt')).trimEnd().split(/\r?\n/).sort(),['abc','é🦀']);
        assert.ok(text(report).trim().length>0); save('replay-files.json',snapshot(cases));
      }
      records.push({...proof,receipt:receipt.messageId}); save('turns.json',records);
    }
    assert.equal(new Set(records.filter(r=>r.approval).map(r=>r.approval)).size,5,'one fresh approval ID per mutating call');
  } finally {
    active=undefined;
    try { await ask('shutdown',{},12000); } finally {
      host.stdin.end(); const timeout=AbortSignal.timeout(15000);
      const kill=()=>{if(host.pid && host.exitCode===null && !host.signalCode) spawnSync(join(process.env.SystemRoot,'System32','taskkill.exe'),['/PID',String(host.pid),'/T','/F'],{windowsHide:true,timeout:5000})};
      timeout.addEventListener('abort',kill,{once:true}); try {const [code,signal]=await closed; assert.equal(signal,null); assert.equal(code,0,'SDK host did not shut down cleanly');}
      finally { timeout.removeEventListener('abort',kill); rpc.close(); for(const fd of [stdout,stdin,stderr])closeSync(fd); }
    }
  }
  const logs=join(home,'sessions'); const paths=readdirSync(logs,{recursive:true}).filter(f=>basename(dirname(f))===sessionId && /^session(?:\.v\d+)?\.jsonl$/.test(basename(f)));
  assert.equal(paths.length,1); const logfile=join(logs,paths[0]), [header,...disk]=text(logfile).trimEnd().split('\n').map(JSON.parse);
  assert.equal(header.id,sessionId); assert.equal(realpathSync(header.cwd),realpathSync(repo));
  const audit=new Set(['turn/start','turn/end','tool/call','tool/result','approval/asked','approval/decided']);
  const facts=events=>events.filter(e=>audit.has(e.type)).map(({type,seq,data})=>({type,seq,data}));
  assert.deepEqual(facts(disk),facts(all),'wire evidence and persisted session disagree');
  const summary={status:'PASS',...versions,archiveCopy:staged,logfile,logSha256:sha(readFileSync(logfile)),caseOutputs:{ascii:text(join(cases,'ascii.stdout')).trimEnd(),unicode:text(join(cases,'unicode.stdout')).trimEnd()},replayReport:report,turns:records,visual:'not observed; Manager data and installed assets only'};
  save('result.json',summary); console.log(JSON.stringify({status:summary.status,result:join(root,'result.json'),versions,sessionLog:logfile},null,2));
}
try{await main()}catch(e){save('failure.json',{status:'FAIL',message:e.message,stack:e.stack,root,sessionId}); console.error(e.stack); process.exitCode=1;}
