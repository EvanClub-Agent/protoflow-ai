import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectPayload } from '../src/services/projectStorage';
import { projectDiagnosticContext } from '../src/services/projectDiagnosticContext';
import { captureRuntimeError, installRuntimeDiagnostics } from '../src/services/runtimeDiagnostics';
import { ProjectAutosave } from '../src/services/projectAutosave';
const {DiagnosticCollector,cleanContext,cleanText,failureReason}=require(path.join(process.cwd(),'electron/diagnostics.cjs'));
const {parseNativeFailure,nativeFailureEvidence}=require(path.join(process.cwd(),'electron/hermes-failure.cjs'));

const input={source:'renderer',category:'ai',code:'AI_GENERATION_REJECTED',stage:'validation',message:'验收失败',context:{projectId:'project-A',runId:'run-A',targetPageId:'approval',checks:[{kind:'foreignKey',tableId:'expense-items',status:'待绑定引用表'}]}};
function collector(t:any,options:any={}){const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pflow-diagnostic-'));const create=(extra:any={})=>new DiagnosticCollector({dataDir,serverUrl:'http://127.0.0.1:9999',appVersion:'0.0.5',enabled:false,...options,...extra});const c=create();t.after(()=>{c.close();fs.rmSync(dataDir,{recursive:true,force:true});});return{c,create,dataDir};}
test('diagnostics persists before upload, retries across restart with the same installation and report ID',async t=>{
 const requests:any[]=[];let offline=true;
 const fakeFetch=async(url:string,options:any)=>{requests.push({url,body:JSON.parse(options.body),headers:options.headers});if(offline)throw new Error('offline');return {status:200,ok:true,json:async()=>url.endsWith('/installations')?{registered:true}:{stored:true,id:JSON.parse(options.body).id}};};
 const {c,create,dataDir}=collector(t,{fetchImpl:fakeFetch});const id=c.capture(input);assert.ok(id);assert.equal(c.snapshot().items[0].state,'pending');
 assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir,'diagnostics',id+'.json'),'utf8')).report.id,id);
 c.configure({enabled:true});await c.flush();assert.equal(c.snapshot().items[0].state,'pending');c.close();
 offline=false;const restarted=create();t.after(()=>restarted.close());await restarted.retry();assert.equal(restarted.snapshot().items[0].state,'uploaded');
 assert.equal(requests.at(-1).body.id,id);assert.equal(requests[0].body.id,requests[1].body.id);assert.equal(requests[0].body.token,requests[1].body.token);
 assert.equal(requests.at(-1).body.context.projectId,'project-A');assert.equal(requests.at(-1).body.context.runId,'run-A');
 assert.equal(JSON.stringify(restarted.snapshot()).includes(requests[0].body.token),false);
});
test('diagnostics redacts secrets and drops raw prompts, rows, source, and unapproved context fields',t=>{
 const {c}=collector(t);c.capture({...input,message:'Authorization: Bearer top-secret password=hidden sk-testtoken https://example.test/?key=123 /Users/alice/project',context:{...input.context,prompt:'private prompt',tableRows:{secret:'row'},pageSources:'private source',id:'wrong-project',checks:[{kind:'foreignKey',tableId:'expense-items',requirement:'private prose'}]}});
 const body=JSON.stringify(c.snapshot());for(const value of ['top-secret','hidden','sk-testtoken','example.test','alice','private','wrong-project'])assert.equal(body.includes(value),false,value);
 assert.equal(c.snapshot().items[0].report.context.checks[0].tableId,'expense-items');
 assert.deepEqual(cleanContext({id:'not-project-id',projectId:'x'.repeat(257),runId:'correct-run'}),{runId:'correct-run'});
 assert.equal(cleanText('token=abc'), '[redacted]');
});
test('diagnostics bounds duplicate storms and retention; storage errors never replace business errors',t=>{
 let now=Date.now();const {c,dataDir}=collector(t,{now:()=>now});const first=c.capture(input);assert.equal(c.capture(input),first);
 for(let i=0;i<210;i++)c.capture({...input,context:{runId:'run-'+i}});assert.equal(c.snapshot().items.length,200);assert.equal(c.snapshot().dropped,11);
 now+=8*86400000;c.prune();assert.equal(c.snapshot().items.length,0);
 fs.rmSync(path.join(dataDir,'diagnostics'),{recursive:true,force:true});assert.equal(c.capture(input),null);assert.match(c.snapshot().healthError,/无法写入/);
});
test('diagnostics enforces the upload byte budget for large multi-byte structural evidence',t=>{
 const {c}=collector(t);
 const check=Object.fromEntries(['kind','status','pageId','sourcePageId','sourceTableId','sourceColumnId','tableId','foreignKeyColumnId','actionPfId','actionEvent','actionKind','targetId','index'].map(k=>[k,'中'.repeat(170)]));
 assert.ok(c.capture({...input,context:{checks:Array.from({length:100},()=>check),boundTableIds:Array.from({length:100},(_,i)=>`table-${i}`)}}));
 const report=c.snapshot().items[0].report;assert.ok(Buffer.byteLength(JSON.stringify(report))<=60*1024);assert.ok(report.context.checks.length<100);
});
test('diagnostics never recreates a record pruned during an in-flight upload',async t=>{
 let now=Date.now();let release!:()=>void;
 const {c,dataDir}=collector(t,{now:()=>now,fetchImpl:async(url:string,o:any)=>{
   if(url.endsWith('/reports'))await new Promise<void>(resolve=>{release=resolve;});
   return{status:200,ok:true,json:async()=>url.endsWith('/installations')?{registered:true}:{stored:true,id:JSON.parse(o.body).id}};
 }});
 const id=c.capture(input);c.configure({enabled:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof release,'function');now+=8*86400000;c.prune();release();await c.flush();
 assert.equal(c.snapshot().items.length,0);assert.equal(fs.existsSync(path.join(dataDir,'diagnostics',id+'.json')),false);
});
test('diagnostics rejects malformed acknowledgments, quarantines permanent failures and continues later reports',async t=>{
 let status=400;const calls:string[]=[];
 const {c}=collector(t,{fetchImpl:async(url:string,o:any)=>{calls.push(url);return{status:url.endsWith('/installations')?200:status,ok:url.endsWith('/installations')||status===200,json:async()=>url.endsWith('/installations')?{registered:true}:{stored:true,id:'wrong-id'}};}});
 c.capture(input);c.capture({...input,context:{runId:'run-B'}});c.configure({enabled:true});await c.flush();assert.ok(c.snapshot().items.every((e:any)=>e.state==='rejected'));
 status=200;c.capture({...input,context:{runId:'run-C'}});await c.flush();assert.equal(c.snapshot().items.find((e:any)=>e.report.context.runId==='run-C').state,'pending');
 assert.equal(calls.filter(url=>url.endsWith('/reports')).length,3);
});
test('diagnostics classifies handled save failures and ignores cancellation, without throwing on a broken bridge',async()=>{
 const before=globalThis.window;const events:any[]=[];
 (globalThis as any).window={protoflowDesktop:{diagnostics:{capture:async(input:any)=>{events.push(input);return 'diagnostic-id';}}}};
 try{
   await captureRuntimeError(new Error('已停止生成，未应用修改'),{category:'ai',code:'AI_TURN_FAILED',stage:'execute'});assert.equal(events.length,0);
   const now=new Date().toISOString();const payload=createProjectPayload({projectId:'project-save',projectName:'private project',templateId:'blank_project',storageDir:'/tmp',fileName:'test.pflow',createdAt:now,updatedAt:now,pageCount:0,tableCount:0,stickyCount:0});
   const failure=new Error('disk full');const autosave=new ProjectAutosave({capture:()=>payload,write:async()=>{throw failure;},onSaved:()=>{},delay:10000});autosave.opened(payload);autosave.changed();await assert.rejects(autosave.flush(),e=>e===failure);autosave.dispose();
   assert.equal(events.at(-1).code,'PROJECT_SAVE_FAILED');assert.equal(events.at(-1).context.projectId,'project-save');assert.equal(JSON.stringify(events).includes('private project'),false);
   (window as any).protoflowDesktop.diagnostics.capture=async()=>{throw new Error('broken transport');};assert.equal(await captureRuntimeError(new Error('render failed'),{category:'renderer',code:'REACT_RENDER_FAILED',stage:'react'}),null);
 }finally{(globalThis as any).window=before;}
});
test('diagnostics global handlers capture uncaught errors and rejected promises and remove listeners',async()=>{
 const before=globalThis.window;const events:any[]=[];const listeners=new Map<string,Function>();
 (globalThis as any).window={addEventListener:(key:string,fn:Function)=>listeners.set(key,fn),removeEventListener:(key:string)=>listeners.delete(key),protoflowDesktop:{diagnostics:{capture:async(input:any)=>{events.push(input);return 'id';}}}};
 try{const stop=installRuntimeDiagnostics(()=>({projectId:'location-project',pageId:'location-page'}));const e=new Error('failed');listeners.get('error')!({error:e});listeners.get('unhandledrejection')!({reason:e});listeners.get('unhandledrejection')!({reason:new Error('second')});await Promise.resolve();assert.equal(events.length,2);assert.deepEqual(events[0].context,{projectId:'location-project',pageId:'location-page'});stop();assert.equal(listeners.size,0);}finally{(globalThis as any).window=before;}
});
test('diagnostics preserves dependency IDs and actual page bindings without scenario text or business rows',()=>{
 const now=new Date().toISOString();const p=createProjectPayload({projectId:'diagnostic-project',projectName:'private project',templateId:'blank_project',storageDir:'/tmp',fileName:'test.pflow',createdAt:now,updatedAt:now,pageCount:0,tableCount:0,stickyCount:0});
 const s=p.stateSnapshot;s.pageSources={approval:'export default function Page(){return <Page pfId="root"><Table pfId="list" table="other-table" /></Page>}',source:'export default function Page(){return <Page pfId="root"/>}'};
 s.dbTables=[{id:'source-table',tableName:'physical_table',cnName:'private label',domain:'基础资料域 (MDM)',description:'private prose',sharedByMenus:[{pageId:'source',menuTitle:'private menu',accessMode:'READ 查询',fieldMappingNote:'private mapping'}],columns:[]}];
 s.projectPlan={summary:'private plan',folders:[],approved:true,pages:[{pageId:'approval',title:'private title',folderId:'folder',purpose:'private purpose',dataEntities:[],dependencies:[{kind:'reuse',sourcePageId:'source',sourceTableId:'source-table',requirement:'private requirement'}],acceptanceCases:[{scenario:'private scenario',expected:'private expected',actionPfId:'button',actionEvent:'onClick',actionKind:'navigate',targetId:'source'}]}]};
 s.tableRows={'other-table':[{id:'business-id',name:'private row'}]};const before=JSON.stringify(s);const d=projectDiagnosticContext(s,'approval');
 assert.deepEqual(d.boundTableIds,['other-table']);assert.equal(d.checks?.[0].sourceTableId,'source-table');assert.equal(d.checks?.[0].status,'待绑定来源表');assert.equal(d.checks?.[1].actionPfId,'button');assert.equal(JSON.stringify(d).includes('private'),false);assert.equal(JSON.stringify(s),before);
});

test('diagnostics keeps legitimate task-suspend evidence while redacting real credentials',()=>{
 assert.equal(cleanText('task-suspend'), 'task-suspend');
 assert.equal(cleanText('sk-test-secret Bearer private'), '[redacted] [redacted]');
 assert.deepEqual(cleanContext({checks:[{kind:'task-suspend',status:'not-observed'}]}),{checks:[{kind:'task-suspend',status:'not-observed'}]});
 assert.equal(failureReason(new Error('模型服务触发每分钟 Token 限流，本轮生成未完成。')),'rate-limit');
});

test('diagnostics snapshots the main-process account and device before offline upload, restart or account switch',async t=>{
 let account:any={status:'signed-in',userId:'account-A',username:'alice',displayName:'Alice'};
 const requests:any[]=[];
 const {c,create}=collector(t,{accountProvider:()=>account,device:{hostname:'workstation-A',osRelease:'7.0.0',osVersion:'Linux'},fetchImpl:async(url:string,o:any)=>{requests.push(JSON.parse(o.body));return{status:200,ok:true,json:async()=>url.endsWith('/installations')?{registered:true}:{stored:true,id:JSON.parse(o.body).id}};}});
 const spoofed={...input,account:{status:'signed-in',userId:'forged',username:'forged',displayName:'forged'},device:{hostname:'forged'}};
 const first=c.capture(spoofed);
 account={status:'signed-in',userId:'account-B',username:'bob',displayName:'Bob'};
 const second=c.capture(spoofed);assert.notEqual(first,second,'deduplication must not merge different accounts');
 account={status:'signed-out'};const third=c.capture(input);c.close();
 const restarted=create();t.after(()=>restarted.close());restarted.configure({enabled:true});await restarted.flush();
 const byId=(id:string)=>requests.find(r=>r.id===id);
 assert.equal(byId(first).account.userId,'account-A');assert.equal(byId(second).account.userId,'account-B');assert.deepEqual(byId(third).account,{status:'signed-out'});
 assert.equal(byId(first).device.hostname,'workstation-A');assert.ok(!JSON.stringify(requests).includes('forged'));
 assert.equal(restarted.snapshot().items.length,3);
});

function nativeLine(at:string,body:string,session='session-A'){return `${at} WARNING [${session}] agent.conversation_loop: ${body}`;}
test('native failure evidence matches the exact turn/session and exports only known numeric rate-limit evidence',()=>{
 const start=new Date(2026,10,13,14,41,11).getTime(),end=new Date(2026,10,13,14,42,12).getTime();
 const rate='API call failed attempt 3/3 error_type=APIError: Rate limit reached private-model tokens per min (TPM): Limit 1000000, Used 625675, Requested 440588. Please try again in 3.976s. sk-private-secret https://private.example';
 const final='API call failed after 3 retries. provider=private model=private msgs=219 tokens=~514,092';
 const lines=[nativeLine('2026-11-13 14:40:00,000',rate),nativeLine('2026-11-13 14:42:06,680',rate),nativeLine('2026-11-13 14:42:06,687',final),nativeLine('2026-11-13 14:42:10,000','API call failed attempt 3/3: Unauthorized','session-B'),nativeLine('2026-11-13 14:42:13,000','API call failed after 3 retries. msgs=999 tokens=~999')];
 const evidence=parseNativeFailure([lines.join('\n')],{sessionId:'session-A',startedAt:start,endedAt:end});
 assert.equal(evidence.reason,'rate-limit');assert.equal(evidence.rateLimitKind,'tokens');assert.equal(evidence.tokenLimit,1000000);assert.equal(evidence.tokensUsed,625675);assert.equal(evidence.tokensRequested,440588);assert.equal(evidence.retryAfterSeconds,3.976);assert.equal(evidence.messageCount,219);assert.equal(evidence.estimatedTokens,514092);assert.equal(evidence.attempts,3);assert.equal(evidence.retriesExhausted,true);assert.ok(!JSON.stringify(evidence).includes('private'));
 const options={sessionId:'session-A',startedAt:start,endedAt:end};
 assert.equal(parseNativeFailure([lines[1]],options),null,'a recovered warning is not root-cause evidence');
 const last=[lines[1],nativeLine('2026-11-13 14:42:07,000','API call failed attempt 3/3: an unknown failure'),nativeLine('2026-11-13 14:42:08,000',final)].join('\n');
 const other=parseNativeFailure([last],options);assert.equal(other.reason,'unclassified');assert.equal(other.tokensRequested,undefined,'earlier throttling must not survive a newer failure');
 assert.equal(parseNativeFailure([lines.join('\n')],{...options,sessionId:'session-C'}),null);
 assert.deepEqual(cleanContext({failure:{...evidence,prompt:'private'},metrics:{acpTurnMs:59855.89,promptBytes:1205,rawPrompt:'private',negative:-1}}).metrics,{acpTurnMs:59855.89,promptBytes:1205});
});

test('native failure log reading is bounded and missing/rotated files do not replace the business error',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'native-evidence-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const options={home,sessionId:'session-A',startedAt:new Date(2026,10,13,14,41).getTime(),endedAt:new Date(2026,10,13,14,43).getTime()};
 assert.deepEqual(await nativeFailureEvidence(options),{logStatus:'unavailable'});
 fs.mkdirSync(path.join(home,'logs'));fs.writeFileSync(path.join(home,'logs/agent.log'),'x'.repeat(600*1024)+'\n'+nativeLine('2026-11-13 14:42:06,680','API call failed attempt 3/3: connection error')+'\n'+nativeLine('2026-11-13 14:42:06,687','API call failed after 3 retries. msgs=2 tokens=~30'));
 const result=await nativeFailureEvidence(options);assert.equal(result.reason,'network');assert.equal(result.logStatus,'matched');assert.equal(result.messageCount,2);
 assert.deepEqual(await nativeFailureEvidence({...options,sessionId:'other-session'}),{logStatus:'no-match'});
});
