import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { acknowledgeToolDiscovery } from './fixtures/hermesToolDiscovery';
import { conversationKey } from '../src/services/hermesConversation';
const root = process.cwd();
const { HermesRuntime } = require(path.join(root, 'electron/hermes-runtime.cjs'));
const { callTool, atomicWrite } = require(path.join(root, 'electron/protoflow-mcp.cjs'));
const { read, freezeContext, checkpointFile, resolveExecutionPaths, recoveryIdentity, validateCheckpoint } = require(path.join(root, 'electron/hermes-draft-recovery.cjs'));
const { withContextLockAsync } = require(path.join(root, 'electron/context-transaction.cjs'));
const scope = { projectId: 'recovery-project', kind: 'project', threadId: 'original' };
const account = { status: 'signed-in', userId: 'exact-account', serviceUrl: 'https://service.invalid' };
const source = (text: string) => `export default function Page(){return <Page pfId="root" title="订单"><Text pfId="text">${text}</Text></Page>;}`;
const snapshot = () => ({ projectId: scope.projectId, projectName: '恢复测试', pageSources: { main: source('原始内容') },
  pageCatalog: [{pageId:'main',title:'订单',folderId:'folder'}], designerPages: [{pageId:'main',title:'订单',folderId:'folder'}],
  designerFolders: [{id:'folder',title:'订单',parentFolderId:null}], sitemapBase: [], sitemapOverrides: {folderParents:{},pageFolders:{}}, mindmaps:{nodes:[],links:[]}, projectNotes:[],
  dbTables: [], tableRows: {}, stickyNotes: [], closedLoopIssues: [], projectAgreements: [],
  projectPlan: {summary:'订单',folders:[],pages:[{pageId:'main',title:'订单',folderId:'folder',requirements:'展示订单'}],approved:true,generatedPageIds:[]} });
const input = () => ({ ...scope, workflowPhase:'generating', targetPageId:'main', prompt:'生成订单；使用已确认的字段，不猜测', snapshot:snapshot(), recoveryRevision:'exact-baseline', recoverDraft:true });
function runtimeFixture(dir: string, prompt: (runtime: any, params: any) => any, who = () => account) {
  const runtime = new HermesRuntime({dataDir:dir,emit:()=>{},accountProvider:who});
  runtime.connect = async () => ({});
  runtime.client = { closed:false, close(){}, notify(){}, request: async (method: string, params: any) => {
    if (['session/new','session/load'].includes(method)) { acknowledgeToolDiscovery(params); return {sessionId:'same-native-session',models:{currentModelId:'provider:model',availableModels:[]}}; }
    assert.equal(method,'session/prompt'); return prompt(runtime,params);
  }};
  return runtime;
}
function contextPath(runtime: any) { return resolveExecutionPaths(runtime.sessions.get(conversationKey(scope)).dir,'generating','main').contextFile; }
function stage(runtime: any, text: string) {
  const file=contextPath(runtime);
  callTool(file,'protoflow_get_project_brief',{});
  callTool(file,'protoflow_get_project',{});
  callTool(file,'protoflow_apply_tsx_patch',{pageId:'main',source:source(text)});
}

test('provider retry policy covers server hints, budget, cancellation, quota and unchanged requests', () => {
  for (const file of ['hermes-rate-limit.test.py','hermes-recovery-gateway.test.py']) {
    const result=spawnSync('python3',['-B',path.join(root,'tests',file)],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
});

test('failed real MCP staging survives a runtime restart and resumes exactly once with fresh brief gate', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-draft-recovery-'));
  let firstRun='';
  let runtime=runtimeFixture(dir,(r)=>{stage(r,'候选内容');firstRun=read(contextPath(r)).runId;throw new Error('provider limited');});
  try {
    await assert.rejects(runtime.execute(input()),/provider limited.*候选修改已保存在本机/);
    const frozen=read(contextPath(runtime));assert.equal(frozen.active,false);assert.equal(frozen.operations.length,1);
    assert.match(frozen.snapshot.pageSources.main,/候选内容/);
    assert.throws(()=>callTool(contextPath(runtime),'protoflow_apply_tsx_patch',{pageId:'main',source:source('迟到修改')}),/No active/);
    runtime.close();
    runtime=runtimeFixture(dir,(r,p)=>{
      const current=read(contextPath(r));assert.notEqual(current.runId,firstRun);
      assert.equal(current.sessionId,'same-native-session');assert.equal(current.operations.length,1);
      assert.match(current.snapshot.pageSources.main,/候选内容/);
      assert.match(p.prompt[0].text,/使用已确认的字段，不猜测/);
      assert.match(p.prompt[0].text,/不要重复建表/);
      assert.throws(()=>callTool(contextPath(r),'protoflow_apply_tsx_patch',{pageId:'main',source:source('完成')}),/brief|核对/);
      stage(r,'完成');return {stopReason:'end_turn'};
    });
    const result=await runtime.execute(input());
    assert.equal(result.recoveredDraft,true);assert.equal(result.continuationMerged,true);
    assert.equal(result.operations.length,2); // Original + one incremental edit, not a replay of the original.
    assert.match(result.operations[1].args.source,/完成/);
    assert.equal((await runtime.completeRecovery({...scope,targetPageId:'main',runId:'wrong'})).completed,false);
    assert.equal((await runtime.completeRecovery({...scope,targetPageId:'main',runId:result.runId})).completed,true);
    assert.equal(read(checkpointFile(path.dirname(contextPath(runtime)),'generating','main')).recovery.status,'committed');
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('recovery refuses changed baseline, account, model, scope, contract, and uncertain results without rewriting candidates', () => {
  const identity=recoveryIdentity({scope,sessionId:'s',modelId:'m',environment:{home:'/exact'},account,revision:'v1',skillDigest:'rules',toolVersion:'contract'});
  const checkpoint={operations:[],snapshot:{},targetPageId:'main',recovery:{identity,status:'available'}};
  validateCheckpoint(checkpoint,identity);
  for (const key of ['scope','sessionId','modelId','environment','account','revision','skillDigest','toolVersion']) {
    assert.throws(()=>validateCheckpoint(checkpoint,{...identity,[key]:'changed'}),/变化/);
  }
  assert.throws(()=>validateCheckpoint(checkpoint,{...identity,account:null}),/账号/);
  assert.throws(()=>validateCheckpoint({...checkpoint,recovery:{...checkpoint.recovery,status:'uncertain'}},identity),/执行结果不明/);
  assert.throws(()=>validateCheckpoint({...checkpoint,snapshot:{projectPlan:{generatedPageIds:['main']}}},identity),/已完成/);
});

test('a conflicting retry preserves the checkpoint and does not send a model request', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-conflict-recovery-'));
  let calls=0;
  const runtime=runtimeFixture(dir,r=>{calls++;stage(r,'候选');throw new Error('limited');});
  try {
    await assert.rejects(runtime.execute(input()));
    const file=checkpointFile(path.dirname(contextPath(runtime)),'generating','main'), before=fs.readFileSync(file,'utf8');
    await assert.rejects(runtime.execute({...input(),recoveryRevision:'changed'}),/工程内容或需求已变化/);
    assert.equal(calls,1);assert.equal(fs.readFileSync(file,'utf8'),before);
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('v2 recovery diagnoses exact changed sections and legacy baselines without replacing the saved candidate', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-baseline-v2-'));
  let calls=0;const reports:any[]=[];
  const runtime=runtimeFixture(dir,r=>{calls++;stage(r,'候选');throw new Error('limited');});
  runtime.diagnostic=(report:any)=>reports.push(report);
  const revision=(rows:any)=>JSON.stringify({context:{projectPlan:snapshot().projectPlan,pageSources:snapshot().pageSources},tableRows:rows,widgets:{}});
  const request={...input(),recoveryRevision:revision({school:[{id:'school-1'}]}),recoveryRevisionVersion:2};
  try {
    await assert.rejects(runtime.execute(request),/limited/);
    const file=checkpointFile(path.dirname(contextPath(runtime)),'generating','main'),before=fs.readFileSync(file,'utf8');
    reports.length=0;
    await assert.rejects(runtime.execute({...request,recoveryRevision:revision({school:[{id:'school-2'}]})}),/工程内容或需求已变化.*保留旧草稿，重新生成/);
    const checks=reports.find(r=>r.code==='AI_RUNTIME_FAILED').context.checks;
    assert.deepEqual(checks.filter((c:any)=>c.kind==='draft-baseline-section'),[{kind:'draft-baseline-section',status:'changed',actionKind:'tableRows'}]);
    assert.ok(checks.some((c:any)=>c.kind==='draft-recovery'&&c.status==='conflict'));
    assert.ok(checks.some((c:any)=>c.kind==='draft-origin'&&c.targetId===read(file).runId));
    assert.equal(calls,1);assert.equal(fs.readFileSync(file,'utf8'),before);
    const legacy=read(file);delete legacy.recovery.identity.revisionVersion;delete legacy.recovery.identity.revisionSections;legacy.recovery.status='uncertain';
    atomicWrite(file,legacy);const legacyBytes=fs.readFileSync(file,'utf8');reports.length=0;
    await assert.rejects(runtime.execute(request),/升级前的恢复基线.*不表示你修改了工程.*执行结果不明.*保留旧草稿，重新生成/);
    assert.equal(calls,1);assert.equal(fs.readFileSync(file,'utf8'),legacyBytes);
    const report=reports.find(r=>r.code==='AI_RUNTIME_FAILED');
    assert.equal(report.context.failure.reason,'stale-state');
    assert.ok(report.context.checks.some((c:any)=>c.kind==='draft-recovery'&&c.status==='uncertain'));
    assert.ok(report.context.checks.some((c:any)=>c.kind==='draft-baseline'&&c.actionKind==='revisionVersion'));
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Responses failure evidence survives ACP wrapping and an uncertain retry gives the archive action without rewriting its draft', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-responses-diagnostic-'));
  const reports:any[]=[];let calls=0;
  const runtime=runtimeFixture(dir,r=>{
    calls++;stage(r,'保留的候选');
    const context=read(contextPath(r));
    atomicWrite(path.join(r.recoveryChannelDir,require(path.join(root,'electron/hermes-draft-recovery.cjs')).hash(context.sessionId)+'.json.status'),{
      runId:context.runId,sessionId:context.sessionId,status:'stopped',attempt:1,reason:'partial-response',
      providerCode:'rate_limit_exceeded',providerEvidence:'responses-error-event',
      failure:{reason:'rate-limit',evidence:'runtime-error',retryAfterSeconds:3.976,rateLimitKind:'tokens',tokensRequested:440588},
    });
    throw Object.assign(new Error('Internal error'),{rpcCode:-32603,rpcMethod:'session/prompt'});
  });
  runtime.diagnostic=(report:any)=>reports.push(report);
  try {
    await assert.rejects(runtime.execute(input()),/部分内容/);
    const report=reports.find(r=>r.code==='AI_RUNTIME_FAILED');
    assert.equal(report.context.failure.reason,'rate-limit');
    assert.equal(report.context.failure.tokensRequested,440588);
    assert.ok(report.context.checks.some((c:any)=>c.kind==='provider-response'&&c.status==='rate_limit_exceeded'&&c.actionKind==='responses-error-event'));
    const file=checkpointFile(path.dirname(contextPath(runtime)),'generating','main'),before=fs.readFileSync(file,'utf8');
    reports.length=0;
    await assert.rejects(runtime.execute(input()),/保留旧草稿，重新生成/);
    assert.equal(calls,1);assert.equal(fs.readFileSync(file,'utf8'),before);
    const blocked=reports.find(r=>r.code==='AI_RUNTIME_FAILED');
    assert.equal(blocked.context.failure.reason,'stale-state');
    assert.ok(blocked.context.checks.some((c:any)=>c.kind==='draft-recovery'&&c.status==='uncertain'));
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('host acceptance continuation keeps the original task as durable evidence', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-continuation-evidence-'));let calls=0;
  const runtime=runtimeFixture(dir,r=>{
    calls++;stage(r,calls===1?'初始候选':'修补候选');
    if(calls===2)throw new Error('limited during repair');
    return {stopReason:'end_turn'};
  });
  try {
    const first=await runtime.execute(input()),current=read(contextPath(runtime));
    await assert.rejects(runtime.execute({...input(),prompt:'只修复验收缺口',recoverDraft:false,snapshot:current.snapshot,
      continuation:{sourceRunId:first.runId,operations:first.operations}}),/limited during repair/);
    const checkpoint=read(checkpointFile(path.dirname(contextPath(runtime)),'generating','main'));
    assert.equal(checkpoint.recovery.originalPrompt,input().prompt);
    assert.equal(checkpoint.operations.length,2);
    assert.match(checkpoint.snapshot.pageSources.main,/修补候选/);
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('freeze waits for a cross-process context transaction, preserves its last commit, and fences queued writes', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-fence-recovery-')),file=path.join(dir,'context.json');
  atomicWrite(file,{active:true,runId:'r',workflowPhase:'generating',targetPageId:'main',snapshot:{},operations:[],recovery:{identity:{}}});
  const child=spawn(process.execPath,['-e',`
    const fs=require('fs');const {withContextLock}=require(process.argv[1]);
    withContextLock(process.argv[2],()=>{process.stdout.write('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,180);
      const c=JSON.parse(fs.readFileSync(process.argv[2]));c.operations.push({tool:'last-commit'});fs.writeFileSync(process.argv[2],JSON.stringify(c));});
  `,path.join(root,'electron/context-transaction.cjs'),file],{stdio:['ignore','pipe','pipe']});
  try {
    await new Promise<void>((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject);});
    const frozen=await freezeContext(file,'r','available');
    assert.equal(frozen.operations.length,1);assert.equal(read(file).active,false);
    assert.throws(()=>callTool(file,'protoflow_get_project',{}),/No active/);
    await withContextLockAsync(file,()=>assert.equal(read(file).operations.length,1));
  } finally {child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});

test('explicit regeneration archives the old candidate and starts from current project, with exact account ownership', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-archive-recovery-'));
  let who=account, calls=0;
  const runtime=runtimeFixture(dir,r=>{
    calls++;
    if(calls===1){stage(r,'旧草稿');throw new Error('limited');}
    const context=read(contextPath(r));
    assert.equal(context.operations.length,0);
    assert.match(context.snapshot.pageSources.main,/用户修改/);
    stage(r,'从当前工程完成');return {stopReason:'end_turn'};
  },()=>who);
  try {
    await assert.rejects(runtime.execute(input()));
    const file=checkpointFile(path.dirname(contextPath(runtime)),'generating','main');
    who={...account,userId:'other-account'};
    await assert.rejects(runtime.execute({...input(),archiveDraft:true,recoveryRevision:'new-baseline'}),/其他账号/);
    assert.equal(calls,1);assert.match(read(file).snapshot.pageSources.main,/旧草稿/);
    who=account;
    const latest=snapshot();latest.pageSources.main=source('用户修改');
    const result=await runtime.execute({...input(),snapshot:latest,archiveDraft:true,recoveryRevision:'new-baseline'});
    assert.equal(result.recoveredDraft,undefined);assert.equal(result.operations.length,1);
    const archives=fs.readdirSync(path.dirname(file)).filter(name=>name.startsWith(path.basename(file)+'.archived-'));
    assert.equal(archives.length,1);
    assert.match(read(path.join(path.dirname(file),archives[0])).snapshot.pageSources.main,/旧草稿/);
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('account change before successful model return cannot commit or resume another account candidate', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-account-recovery-'));
  let who=account,calls=0;
  const runtime=runtimeFixture(dir,r=>{
    calls++;stage(r,'原账号候选');who={...account,userId:'other-account'};return {stopReason:'end_turn'};
  },()=>who);
  try {
    await assert.rejects(runtime.execute(input()),/登录账号已变化/);
    const file=checkpointFile(path.dirname(contextPath(runtime)),'generating','main'),checkpoint=read(file);
    assert.equal(checkpoint.recovery.identity.account.userId,account.userId);
    assert.equal(read(contextPath(runtime)).active,false);
    await assert.rejects(runtime.execute(input()),/登录账号已变化/);assert.equal(calls,1);
    await assert.rejects(runtime.completeRecovery({...scope,targetPageId:'main',runId:checkpoint.runId}),/账号/);
    who={...account,serviceUrl:'https://other-service.invalid'};
    await assert.rejects(runtime.completeRecovery({...scope,targetPageId:'main',runId:checkpoint.runId}),/账号/);
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('overflow recovery status cleanup accepts recovered turns while unrecovered delegation fails closed with available draft', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-overflow-status-'));
  const reports:any[]=[];
  let mode:'recovered'|'delegated-end-turn'|'delegated-error'='recovered';
  const runtime=runtimeFixture(dir,r=>{
    stage(r,mode==='recovered'?'压缩后完成':'压缩前草稿');
    const context=read(contextPath(r));
    const statusPath=path.join(r.recoveryChannelDir,require(path.join(root,'electron/hermes-draft-recovery.cjs')).hash(context.sessionId)+'.json.status');
    atomicWrite(statusPath,{
      runId:context.runId,sessionId:context.sessionId,
      status:mode==='recovered'?'recovered':'delegated',
      attempt:1,
      ...(mode==='recovered'?{}:{reason:'native-overflow-recovery'}),
      providerCode:'context_length_exceeded',providerEvidence:'responses-error-event',
      candidateUncertain:false,
      failure:{reason:'context-limit',evidence:'runtime-error'},
    });
    if(mode==='delegated-error'){
      throw Object.assign(new Error('Internal error'),{rpcCode:-32603,rpcMethod:'session/prompt',gatewayOutcome:'admitted_turn_failed'});
    }
    return {stopReason:'end_turn'};
  });
  runtime.diagnostic=(report:any)=>reports.push(report);
  try {
    const ok=await runtime.execute(input());
    assert.equal(ok.operations.length,1);
    assert.match(ok.operations[0].args.source,/压缩后完成/);
    await runtime.completeRecovery({...scope,targetPageId:'main',runId:ok.runId});

    mode='delegated-end-turn';
    reports.length=0;
    await assert.rejects(runtime.execute({...input(),recoveryRevision:'rev-2'}),/上下文超出模型窗口上限.*候选修改已保存在本机，可在原账号和工程中重试/);
    const cp1=read(checkpointFile(path.dirname(contextPath(runtime)),'generating','main'));
    assert.equal(cp1.recovery.status,'available');
    const rep1=reports.find(r=>r.code==='AI_RUNTIME_FAILED');
    assert.equal(rep1.context.failure.reason,'context-limit');

    mode='delegated-error';
    reports.length=0;
    await assert.rejects(runtime.execute({...input(),archiveDraft:true,recoveryRevision:'rev-3'}),/上下文超出模型窗口上限.*候选修改已保存在本机，可在原账号和工程中重试/);
    const cp2=read(checkpointFile(path.dirname(contextPath(runtime)),'generating','main'));
    assert.equal(cp2.recovery.status,'available');
    const rep2=reports.find(r=>r.code==='AI_RUNTIME_FAILED');
    assert.equal(rep2.context.failure.reason,'context-limit');
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('unfinished native tool, ACP mid-turn disconnect, and server-error-budget enforce orthogonal candidate status', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-orthogonal-candidate-'));
  const reports:any[]=[];
  let scenario:'unfinished-tool'|'acp-disconnect'|'server-error-budget'='unfinished-tool';
  const runtime=runtimeFixture(dir,r=>{
    stage(r,`草稿-${scenario}`);
    const context=read(contextPath(r));
    const statusPath=path.join(r.recoveryChannelDir,require(path.join(root,'electron/hermes-draft-recovery.cjs')).hash(context.sessionId)+'.json.status');
    if(scenario==='unfinished-tool'){
      r.onNotification({method:'session/update',params:{sessionId:context.sessionId,_meta:{alex_run_id:context.runId,admission_id:'aid-unfinished-1'},update:{
        sessionUpdate:'tool_call',toolCallId:'native-term-1',title:'terminal',status:'in_progress',
      }}});
      atomicWrite(statusPath,{
        runId:context.runId,sessionId:context.sessionId,status:'stopped',attempt:6,reason:'rate-limit-budget',
        candidateUncertain:false,failure:{reason:'rate-limit',evidence:'runtime-error'},
      });
      throw Object.assign(new Error('Internal error'),{rpcCode:-32603,rpcMethod:'session/prompt'});
    }
    if(scenario==='acp-disconnect'){
      throw Object.assign(new Error('Hermes 进程已退出（code=1）'),{acpDisconnected:true});
    }
    atomicWrite(statusPath,{
      runId:context.runId,sessionId:context.sessionId,status:'stopped',attempt:6,reason:'server-error-budget',
      providerCode:'http_502',providerEvidence:'http-status',candidateUncertain:false,
      failure:{reason:'network',evidence:'runtime-error'},
    });
    throw Object.assign(new Error('Internal error'),{rpcCode:-32603,rpcMethod:'session/prompt',gatewayOutcome:'admitted_turn_failed'});
  });
  runtime.diagnostic=(report:any)=>reports.push(report);
  try {
    await assert.rejects(runtime.execute(input()),/执行结果不明/);
    assert.equal(read(checkpointFile(path.dirname(contextPath(runtime)),'generating','main')).recovery.status,'uncertain');

    scenario='acp-disconnect';
    await assert.rejects(runtime.execute({...input(),archiveDraft:true,recoveryRevision:'r2'}),/执行结果不明/);
    assert.equal(read(checkpointFile(path.dirname(contextPath(runtime)),'generating','main')).recovery.status,'uncertain');

    scenario='server-error-budget';
    reports.length=0;
    await assert.rejects(runtime.execute({...input(),archiveDraft:true,recoveryRevision:'r3'}),/网关或上游持续异常.*重试此页继续/);
    assert.equal(read(checkpointFile(path.dirname(contextPath(runtime)),'generating','main')).recovery.status,'available');
    const rep=reports.find(r=>r.code==='AI_RUNTIME_FAILED');
    assert.equal(rep.context.failure.reason,'network');
    assert.equal(rep.context.failure.retriesExhausted,true);
    assert.equal(rep.context.failure.attempts,6);
  } finally {runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('staged immutable upgrade gate protects external installations and preserves active environment on staging failure', async () => {
  const { VERIFIED_HERMES_COMMIT } = require(path.join(root,'electron/hermes-recovery-native.cjs'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alex-staged-upgrade-'));
  const externalHome=path.join(dir,'external-user-hermes');
  fs.mkdirSync(externalHome,{recursive:true});
  let closeCount=0;
  const runtime=runtimeFixture(dir,(r)=>{stage(r,'升级失败后仍可继续工作');return {stopReason:'end_turn'};});
  const origClose=runtime.close.bind(runtime);
  runtime.close=()=>{closeCount++;origClose();};
  try {
    // 1. User-managed external Hermes refuses in-place mutation without closing live client
    runtime.detect=async()=>({detected:true,home:externalHome,binary:path.join(externalHome,'bin','hermes'),
      installDir:path.join(externalHome,'hermes-agent'),version:'0.23.1',hasConfig:true});
    await assert.rejects(runtime.update(),/用户自行维护的外部 Hermes 环境/);
    assert.equal(closeCount,0);
    assert.equal(runtime.client.closed,false);

    // 2. App-managed Hermes: staging/hash verification failure keeps live client, settings & active checkout intact
    const managedHome=path.join(dir,'hermes-home');
    const activeInstallDir=path.join(managedHome,'hermes-agent');
    const activeBinary=path.join(activeInstallDir,'.hermes','bin',process.platform==='win32'?'hermes.exe':'hermes');
    fs.mkdirSync(path.dirname(activeBinary),{recursive:true});
    fs.writeFileSync(activeBinary,'#!/bin/sh\n',{mode:0o755});
    runtime.settings={home:managedHome,binary:activeBinary};
    atomicWrite(path.join(dir,'runtime.json'),runtime.settings);
    const projectWsBefore=runtime.workspace(scope.projectId);
    runtime.detect=async(inp:any={})=>({
      detected:true,
      home:inp.home||managedHome,
      binary:inp.binary||activeBinary,
      installDir:(inp.binary||'').includes('releases')?path.join(managedHome,'releases',VERIFIED_HERMES_COMMIT,'hermes-agent'):activeInstallDir,
      version:'0.23.1',
      hasConfig:true,
    });
    runtime.prepareStagedRelease=async(_info:any,{slotDir}:any)=>{
      fs.mkdirSync(slotDir,{recursive:true});
      fs.writeFileSync(path.join(slotDir,'tampered.txt'),'incompatible');
    };
    runtime.verifyStagedRelease=async()=>{throw new Error('当前 Hermes 版本尚未适配限流恢复接口（run_agent.py），已停止启动以避免不受控重试');};
    await assert.rejects(runtime.update(),/尚未适配限流恢复接口/);
    assert.equal(closeCount,0);
    assert.equal(runtime.client.closed,false);
    assert.equal(fs.existsSync(path.join(managedHome,'releases',VERIFIED_HERMES_COMMIT,'hermes-agent')),false);
    assert.deepEqual(read(path.join(dir,'runtime.json')),{home:managedHome,binary:activeBinary});

    // Original environment remains immediately usable for generation after rejected upgrade!
    const stillWorks=await runtime.execute(input());
    assert.equal(stillWorks.operations.length,1);

    // 3. Contract check with stubbed stage/connect: workspace hash stays stable across slot paths
    let switchedInput:any=null;
    runtime.prepareStagedRelease=async(_info:any,{slotDir,slotBinary}:any)=>{
      fs.mkdirSync(path.dirname(slotBinary),{recursive:true});
      fs.writeFileSync(slotBinary,'#!/bin/sh\n',{mode:0o755});
      assert.ok(slotDir.includes(VERIFIED_HERMES_COMMIT));
    };
    runtime.verifyStagedRelease=async()=>{};
    runtime.connect=async(inp:any={})=>{
      if(inp.home||inp.binary){
        switchedInput=inp;
        runtime.settings={home:inp.home,binary:inp.binary};
        atomicWrite(path.join(dir,'runtime.json'),runtime.settings);
        runtime.client={closed:false,close(){},notify(){},request:async()=>({})};
      }
      return {version:'0.23.1',home:runtime.settings.home,binary:runtime.settings.binary};
    };
    await runtime.update();
    assert.ok(switchedInput?.binary.includes(path.join('releases',VERIFIED_HERMES_COMMIT,'hermes-agent')));
    assert.equal(runtime.workspace(scope.projectId),projectWsBefore);
    assert.equal(fs.existsSync(activeBinary),true); // Previous slot preserved for rollback
  } finally {origClose();fs.rmSync(dir,{recursive:true,force:true});}
});

test('gateway unknown_execution, session_replay_gap, and unverified -32603 freeze candidate as uncertain while ACP stays connected', async () => {
  const { AcpClient } = require(path.join(root, 'electron/hermes-acp.cjs'));
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-gateway-unknown-'));
  const reports: any[] = [];

  // Part A: Real AcpClient JSON-RPC -32603 frame parsing (ACP process stays alive, error.data redacted)
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill() {},
  });
  const acpClient = new AcpClient('/bin/echo', { home: dir, spawnProcess: () => child });
  const runtime = new HermesRuntime({ dataDir: dir, emit: () => {}, accountProvider: () => account, diagnostic: (r: any) => reports.push(r) });
  runtime.connect = async () => ({});
  runtime.client = acpClient;
  runtime.nativeContextBridge = () => null;

  let rpcErrorFrame: any = null;
  let injectedStatusPatch: any = null;
  let stageLabel = '草稿-unknown';
  const recoveryHash = require(path.join(root, 'electron/hermes-draft-recovery.cjs')).hash;
  child.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      if (!frame.id) continue;
      if (frame.method === 'session/new' || frame.method === 'session/load') {
        acknowledgeToolDiscovery(frame.params);
        acpClient.receive({ id: frame.id, result: { sessionId: 'live-acp-session', models: { currentModelId: 'provider:model', availableModels: [] } } });
      } else if (frame.method === 'session/prompt') {
        stage(runtime, stageLabel);
        if (injectedStatusPatch) {
          const context = read(contextPath(runtime));
          const statusPath = path.join(runtime.recoveryChannelDir, recoveryHash(context.sessionId) + '.json.status');
          atomicWrite(statusPath, { runId: context.runId, sessionId: context.sessionId, ...injectedStatusPatch });
        }
        acpClient.receive({ id: frame.id, error: rpcErrorFrame });
      }
    }
  });

  try {
    const unknownCases = [
      {
        label: 'unknown_execution',
        expectedStatus: 'unknown_execution',
        error: {
          code: -32603,
          message: 'Internal error',
          data: {
            details: 'unknown_execution: do not resend accepted input; a turn in this session was lost when the gateway restarted and its outcome is unknown.',
            secret: 'sensitive-provider-secret',
          },
        },
      },
      {
        label: 'session_replay_gap',
        expectedStatus: 'session_replay_gap',
        error: { code: -32603, message: 'Internal error', data: { details: 'session_replay_gap' } },
      },
      {
        label: 'gateway_disconnected',
        expectedStatus: 'gateway_disconnected',
        error: { code: -32603, message: 'Internal error', data: { details: 'Gateway disconnected; turn outcome is unknown' } },
      },
      {
        label: 'submit_timeout_empty_details',
        expectedStatus: 'gateway_outcome_unknown',
        error: { code: -32603, message: 'Internal error', data: { details: '' } },
      },
    ];

    let revIdx = 0;
    for (const item of unknownCases) {
      revIdx++;
      reports.length = 0;
      stageLabel = `草稿-${item.label}`;
      rpcErrorFrame = item.error;
      let caughtError: any = null;
      await assert.rejects(
        runtime.execute({ ...input(), archiveDraft: revIdx > 1, recoveryRevision: `rev-${revIdx}` }),
        (err: any) => { caughtError = err; return true; },
      );
      assert.equal(acpClient.closed, false, `${item.label} must keep ACP connected`);
      assert.equal(caughtError.data, undefined, 'raw RPC error.data must never be retained');
      assert.equal(JSON.stringify(caughtError).includes('sensitive-provider-secret'), false);
      assert.match(caughtError.message, /执行结果不明/);
      const cp = read(checkpointFile(path.dirname(contextPath(runtime)), 'generating', 'main'));
      assert.equal(cp.recovery.status, 'uncertain', `${item.label} must save candidate as uncertain`);
      const rep = reports.find((r) => r.code === 'AI_RUNTIME_FAILED');
      assert.equal(rep.context.checks[0].kind, 'acp-error');
      assert.ok(rep.context.checks.some((c: any) => c.kind === 'gateway-turn' && c.status === item.expectedStatus));
      assert.equal(JSON.stringify(rep).includes('sensitive-provider-secret'), false);
    }

    // Trusted native terminal failure ('admitted_turn_failed') with zero unfinished tools saves as 'available'
    revIdx++;
    reports.length = 0;
    stageLabel = '草稿-admitted-failed';
    rpcErrorFrame = { code: -32603, message: 'Internal error', data: { details: 'admitted_turn_failed' } };
    await assert.rejects(
      runtime.execute({ ...input(), archiveDraft: true, recoveryRevision: `rev-${revIdx}` }),
      /重试此页继续/,
    );
    assert.equal(acpClient.closed, false);
    const availableCp = read(checkpointFile(path.dirname(contextPath(runtime)), 'generating', 'main'));
    assert.equal(availableCp.recovery.status, 'available');

    // Part B: Intermediate or single-request `.status` (waiting / retrying / recovered / delegated / stopped)
    // followed by an opaque `session/prompt -32603` MUST still freeze as `uncertain` (`.status` is diagnostic only,
    // never whole-turn terminal evidence).
    const statusProbeCases = [
      {
        status: 'waiting',
        patch: { status: 'waiting', attempt: 1, waitSeconds: 4, failure: { reason: 'rate-limit', evidence: 'runtime-error' } },
        expectedFailureReason: 'rate-limit',
      },
      {
        status: 'retrying',
        patch: { status: 'retrying', attempt: 1, waitedSeconds: 4 },
        expectedFailureReason: 'network',
      },
      {
        status: 'recovered',
        patch: { status: 'recovered', attempt: 2, candidateUncertain: false, elapsedSeconds: 4.1 },
        expectedFailureReason: 'network',
      },
      {
        status: 'delegated',
        patch: {
          status: 'delegated',
          attempt: 1,
          reason: 'native-overflow-recovery',
          candidateUncertain: false,
          failure: { reason: 'context-limit', evidence: 'runtime-error' },
        },
        expectedFailureReason: 'context-limit',
      },
      {
        status: 'stopped',
        patch: {
          status: 'stopped',
          attempt: 6,
          reason: 'rate-limit-budget',
          candidateUncertain: false,
          failure: { reason: 'rate-limit', evidence: 'runtime-error' },
        },
        expectedFailureReason: 'rate-limit',
      },
    ];
    for (const probe of statusProbeCases) {
      revIdx++;
      reports.length = 0;
      stageLabel = `草稿-opaque-${probe.status}`;
      injectedStatusPatch = probe.patch;
      rpcErrorFrame = { code: -32603, message: 'Internal error' };
      await assert.rejects(
        runtime.execute({ ...input(), archiveDraft: true, recoveryRevision: `rev-${revIdx}` }),
        /执行结果不明/,
      );
      assert.equal(acpClient.closed, false, `opaque -32603 after ${probe.status} must keep ACP connected`);
      const cp = read(checkpointFile(path.dirname(contextPath(runtime)), 'generating', 'main'));
      assert.equal(cp.recovery.status, 'uncertain', `opaque -32603 after .status=${probe.status} must save as uncertain`);
      const rep = reports.find((r) => r.code === 'AI_RUNTIME_FAILED');
      assert.equal(rep.context.failure.reason, probe.expectedFailureReason, `.status=${probe.status} diagnostic preserved`);
      assert.ok(rep.context.checks.some((c: any) => c.kind === 'gateway-turn' && c.status === 'gateway_outcome_unknown'));
      assert.ok(rep.context.checks.some((c: any) => c.kind === 'provider-retry' && c.status === probe.status));
    }
    // Even with explicit `admitted_turn_failed`, an in-flight `.status` (`waiting` / `retrying`) stays `uncertain`
    for (const inflight of ['waiting', 'retrying'] as const) {
      revIdx++;
      reports.length = 0;
      stageLabel = `草稿-inflight-${inflight}`;
      injectedStatusPatch = { status: inflight, attempt: 2, waitSeconds: 4 };
      rpcErrorFrame = { code: -32603, message: 'Internal error', data: { details: 'admitted_turn_failed' } };
      await assert.rejects(
        runtime.execute({ ...input(), archiveDraft: true, recoveryRevision: `rev-${revIdx}` }),
        /执行结果不明/,
      );
      const cp = read(checkpointFile(path.dirname(contextPath(runtime)), 'generating', 'main'));
      assert.equal(cp.recovery.status, 'uncertain', `in-flight .status=${inflight} must save as uncertain`);
    }
    injectedStatusPatch = null;

    // Part C: Direct runtimeFixture RPC exception injection (no AcpClient frame wrapper, acpStillConnected=true)
    const directDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-gateway-direct-'));
    let directError: any = new Error('unknown_execution: turn lost during gateway restart');
    let directStatusPatch: any = null;
    const directRuntime = runtimeFixture(directDir, (r) => {
      stage(r, '直接注入异常草稿');
      if (directStatusPatch) {
        const context = read(contextPath(r));
        const statusPath = path.join(r.recoveryChannelDir, recoveryHash(context.sessionId) + '.json.status');
        atomicWrite(statusPath, { runId: context.runId, sessionId: context.sessionId, ...directStatusPatch });
      }
      throw directError;
    });
    try {
      await assert.rejects(directRuntime.execute(input()), /执行结果不明/);
      assert.equal(directRuntime.client.closed, false);
      assert.equal(read(checkpointFile(path.dirname(contextPath(directRuntime)), 'generating', 'main')).recovery.status, 'uncertain');

      // Opaque -32603 session/prompt without retryStatus or with waiting/retrying/recovered/delegated also fails closed as 'uncertain'
      directError = Object.assign(new Error('Internal error'), { rpcCode: -32603, rpcMethod: 'session/prompt' });
      await assert.rejects(directRuntime.execute({ ...input(), archiveDraft: true, recoveryRevision: 'direct-2' }), /执行结果不明/);
      assert.equal(directRuntime.client.closed, false);
      assert.equal(read(checkpointFile(path.dirname(contextPath(directRuntime)), 'generating', 'main')).recovery.status, 'uncertain');

      let dIdx = 2;
      for (const st of ['waiting', 'retrying', 'recovered', 'delegated'] as const) {
        dIdx++;
        directStatusPatch = { status: st, attempt: 1, candidateUncertain: false };
        await assert.rejects(
          directRuntime.execute({ ...input(), archiveDraft: true, recoveryRevision: `direct-${dIdx}` }),
          /执行结果不明/,
        );
        assert.equal(directRuntime.client.closed, false);
        assert.equal(
          read(checkpointFile(path.dirname(contextPath(directRuntime)), 'generating', 'main')).recovery.status,
          'uncertain',
          `direct runtimeFixture opaque -32603 after .status=${st} must be uncertain`,
        );
      }
    } finally {
      directRuntime.close();
      fs.rmSync(directDir, { recursive: true, force: true });
    }
  } finally {
    runtime.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unmocked connect() and update() roll back runtime.json from disconnected or connected states and surface failed rollback reconnects', async () => {
  const native = require(path.join(root, 'electron/hermes-recovery-native.cjs'));
  const { VERIFIED_HERMES_COMMIT, SUPPORTED } = native;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-unmocked-switch-'));
  const managedHome = path.join(dir, 'hermes-home');
  const activeInstallDir = path.join(managedHome, 'hermes-agent');
  const slotDir = path.join(managedHome, 'releases', VERIFIED_HERMES_COMMIT, 'hermes-agent');
  const binName = process.platform === 'win32' ? 'hermes.exe' : 'hermes';
  const activeBinary = path.join(activeInstallDir, '.hermes', 'bin', binName);
  const slotBinary = path.join(slotDir, '.hermes', 'bin', binName);
  const stateFile = path.join(dir, 'mock-acp-state.json');
  const fakePython = path.join(dir, 'fake-python.cjs');
  const origPrepareNative = native.prepareNativeRecovery;

  const localHermes = path.join(os.homedir(), '.hermes', 'hermes-agent');
  let hasRealSupportedSources = false;
  try { native.verify(localHermes); hasRealSupportedSources = true; } catch {}

  function populateInstallTree(targetRoot: string, launcherPath: string) {
    fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
    if (hasRealSupportedSources) {
      for (const rel of Object.keys(SUPPORTED)) {
        const dst = path.join(targetRoot, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(localHermes, rel), dst);
      }
    } else {
      fs.mkdirSync(targetRoot, { recursive: true });
    }
    const launcherBody = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Hermes Agent 0.23.1"
  echo "Install directory: ${targetRoot}"
  exit 0
fi
if [ "$1" = "--print-runtime-command" ]; then
  printf '[%s,%s]\\n' '"${process.execPath.replace(/\\/g, '\\\\')}"' '"${fakePython.replace(/\\/g, '\\\\')}"'
  exit 0
fi
exit 1
`;
    fs.writeFileSync(launcherPath, launcherBody, { mode: 0o755 });
  }

  fs.writeFileSync(
    fakePython,
    `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
const args = process.argv.slice(1);
const copyArg = args.find((a) => a.includes('native-recovery') || a.includes('hermes-agent')) || '';
const isStaged = copyArg.includes('staged') || args.some((a) => a.includes('releases')) || (state.currentCopyRole?.[copyArg] === 'staged');
if (!args.includes('acp')) {
  process.stdout.write(JSON.stringify({ ready: true }) + '\\n');
  process.exit(0);
}
const mode = isStaged ? state.slotMode : state.activeMode;
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      if (mode === 'fail-handshake') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: isStaged ? 'staged handshake failed' : 'active rollback handshake failed' } }) + '\\n');
      } else {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } }) + '\\n');
      }
    }
  }
});
`,
    { mode: 0o755 },
  );

  // Note: python command in connect() is invoked as `command[0]` with `['-I', '-c', ...]`,
  // so provide a thin shell wrapper that strips python's `-I -c <script>` and invokes node `fakePython` with remaining args!
  const fakePythonBin = path.join(dir, 'fake-python-bin');
  fs.writeFileSync(
    fakePythonBin,
    `#!/bin/sh
if [ "$1" = "-I" ] && [ "$2" = "-c" ]; then
  shift 3
fi
exec "${process.execPath}" "${fakePython}" "$@"
`,
    { mode: 0o755 },
  );

  function writeLauncher(targetRoot: string, launcherPath: string) {
    populateInstallTree(targetRoot, launcherPath);
    fs.writeFileSync(
      launcherPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Hermes Agent 0.23.1"
  echo "Install directory: ${targetRoot}"
  exit 0
fi
if [ "$1" = "--print-runtime-command" ]; then
  printf '["%s"]\\n' "${fakePythonBin}"
  exit 0
fi
exit 1
`,
      { mode: 0o755 },
    );
  }

  const copyRoles: Record<string, string> = {};
  native.prepareNativeRecovery = async (srcRoot: string, targetDataDir: string) => {
    const out = hasRealSupportedSources
      ? await origPrepareNative(srcRoot, targetDataDir)
      : (() => {
          const fallback = path.join(targetDataDir, 'native-recovery', srcRoot.includes('releases') ? 'staged-copy' : 'active-copy');
          fs.mkdirSync(fallback, { recursive: true });
          return fallback;
        })();
    copyRoles[out] = srcRoot.includes('releases') ? 'staged' : 'active';
    const cur = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    cur.currentCopyRole = copyRoles;
    fs.writeFileSync(stateFile, JSON.stringify(cur));
    return out;
  };

  fs.mkdirSync(managedHome, { recursive: true });
  fs.writeFileSync(path.join(managedHome, 'config.yaml'), 'updates:\n  check: false\n');
  fs.writeFileSync(stateFile, JSON.stringify({ activeMode: 'ok', slotMode: 'fail-handshake', currentCopyRole: {} }));
  writeLauncher(activeInstallDir, activeBinary);

  const runtime = new HermesRuntime({ dataDir: dir, emit: () => {}, accountProvider: () => account });
  runtime.prepareStagedRelease = async (_info: any, { slotDir: sDir, slotBinary: sBin }: any) => {
    writeLauncher(sDir, sBin);
  };
  runtime.verifyStagedRelease = async () => {};

  try {
    // Case 1: Installed, NOT yet connected (wasConnected === false) WITH existing runtime.json -> switch fails
    runtime.settings = { home: managedHome, binary: activeBinary };
    atomicWrite(path.join(dir, 'runtime.json'), runtime.settings);
    const preDetect = await runtime.detect();
    assert.equal(preDetect.detected, true);
    assert.equal(preDetect.connected, false);

    await assert.rejects(runtime.update(), /staged handshake failed/);
    const savedAfterDisconnectedFail = read(path.join(dir, 'runtime.json'));
    const postDetect1 = await runtime.detect();
    assert.deepEqual(savedAfterDisconnectedFail, { home: managedHome, binary: activeBinary });
    assert.equal(savedAfterDisconnectedFail.binary === slotBinary, false, 'savedStagedBinary must be false');
    assert.equal(postDetect1.connected, false, 'must remain disconnected when wasConnected was false');
    assert.equal(postDetect1.binary, activeBinary);
    assert.equal(fs.existsSync(slotDir), false, 'failed staged slot cleaned up');

    // Case 2: Installed, NOT yet connected, WITHOUT prior runtime.json -> switch fails and removes transient runtime.json
    fs.rmSync(path.join(dir, 'runtime.json'), { force: true });
    runtime.settings = {};
    const origDetect = runtime.detect.bind(runtime);
    runtime.detect = async (inp: any = {}) => origDetect(inp.home || inp.binary ? inp : { home: managedHome, binary: activeBinary });
    await assert.rejects(runtime.update(), /staged handshake failed/);
    assert.equal(fs.existsSync(path.join(dir, 'runtime.json')), false, 'must not leave staged runtime.json behind');
    assert.deepEqual(runtime.settings, {});
    runtime.detect = origDetect;

    // Case 3: Connected (running, wasConnected === true) -> switch fails, rollback reconnect to activeBinary SUCCEEDS
    const connectedInfo = await runtime.connect({ home: managedHome, binary: activeBinary });
    assert.equal(connectedInfo.connected, true);
    assert.equal((await runtime.detect()).connected, true);
    const wsBefore = runtime.workspace(scope.projectId);

    await assert.rejects(runtime.update(), /staged handshake failed/);
    const postRollbackOk = await runtime.detect();
    assert.equal(postRollbackOk.connected, true, 'live connection restored to activeBinary');
    assert.equal(postRollbackOk.binary, activeBinary);
    assert.deepEqual(read(path.join(dir, 'runtime.json')), { home: managedHome, binary: activeBinary });

    // Case 4: Connected (running, wasConnected === true) -> switch fails AND rollback reconnect ALSO fails
    const stateDoubleFail = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    stateDoubleFail.activeMode = 'fail-handshake';
    stateDoubleFail.slotMode = 'fail-handshake';
    fs.writeFileSync(stateFile, JSON.stringify(stateDoubleFail));

    await assert.rejects(
      runtime.update(),
      /升级切换失败（staged handshake failed），且恢复原连接失败（active rollback handshake failed）/,
    );
    const postDoubleFail = await runtime.detect();
    assert.equal(postDoubleFail.connected, false, 'must report disconnected when rollback fails');
    assert.deepEqual(read(path.join(dir, 'runtime.json')), { home: managedHome, binary: activeBinary });

    // Case 5: Real unmocked connect() + update() switch succeeds when staged slot is healthy
    const stateHealthy = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    stateHealthy.activeMode = 'ok';
    stateHealthy.slotMode = 'ok';
    fs.writeFileSync(stateFile, JSON.stringify(stateHealthy));
    await runtime.connect({ home: managedHome, binary: activeBinary });
    const upgraded = await runtime.update();
    assert.equal(upgraded.connected, true);
    assert.equal(upgraded.binary, slotBinary);
    assert.deepEqual(read(path.join(dir, 'runtime.json')), { home: managedHome, binary: slotBinary });
    assert.equal((await runtime.detect()).connected, true);
    assert.equal(runtime.workspace(scope.projectId), wsBefore);
    assert.equal(fs.existsSync(activeBinary), true);

    // Case 6: Direct prepareStagedRelease hard-refuses in-place mutation when slotDir === activeInstallDir
    const activeSlotInfo = await runtime.detect();
    assert.equal(path.resolve(activeSlotInfo.installDir), path.resolve(slotDir));
    await assert.rejects(
      HermesRuntime.prototype.prepareStagedRelease.call(runtime, activeSlotInfo, {
        targetCommit: VERIFIED_HERMES_COMMIT,
        slotDir,
        slotBinary,
      }),
      /拒绝就地改写运行环境/,
    );

    // Case 7 & 8: Repeated update() while already running `slotDir` uses UNSTUBBED prepareStagedRelease:
    // neither regenerates launchers nor runs `pm install` on `activeInstallDir`, and preserves live env on verify failure
    runtime.prepareStagedRelease = HermesRuntime.prototype.prepareStagedRelease;
    const launcherWithSentinel = fs.readFileSync(slotBinary, 'utf8') + '\n# sentinel-active-launcher-untouched\n';
    fs.writeFileSync(slotBinary, launcherWithSentinel, { mode: 0o755 });
    const liveClientBeforeRepeat = runtime.client;
    let verifyRuns = 0;
    runtime.verifyStagedRelease = async (_info: any, target: any) => {
      verifyRuns++;
      assert.equal(path.resolve(target.slotDir), path.resolve(slotDir));
      assert.equal(path.resolve(target.slotBinary), path.resolve(slotBinary));
    };

    const repeatedOk = await runtime.update();
    assert.equal(verifyRuns, 1);
    assert.equal(repeatedOk.connected, true);
    assert.equal(repeatedOk.binary, slotBinary);
    assert.equal(runtime.client, liveClientBeforeRepeat, 'live client kept without reconnect');
    assert.equal(runtime.client.closed, false);
    assert.equal(fs.readFileSync(slotBinary, 'utf8'), launcherWithSentinel, 'active launcher not rewritten');

    // Repeated update() where verification FAILS: active slot, launcher, runtime.json, and live client stay 100% untouched
    runtime.verifyStagedRelease = async () => {
      throw new Error('重复升级只读校验未通过，原环境保持不变');
    };
    await assert.rejects(runtime.update(), /重复升级只读校验未通过/);
    assert.equal(fs.existsSync(slotDir), true, 'active slotDir must never be deleted on verify failure');
    assert.equal(fs.readFileSync(slotBinary, 'utf8'), launcherWithSentinel, 'active launcher untouched before/after failed verify');
    assert.deepEqual(read(path.join(dir, 'runtime.json')), { home: managedHome, binary: slotBinary });
    assert.equal(runtime.client, liveClientBeforeRepeat);
    assert.equal(runtime.client.closed, false);
    assert.equal((await runtime.detect()).connected, true);

    // Case 9: If active slotDir is a git repo whose HEAD diverged from targetCommit, repair stages into an
    // independent sibling slot (`releases/<commit>-<id>/hermes-agent`), never mutating `slotDir`
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['init', '-q'], { cwd: slotDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: slotDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: slotDir });
    fs.writeFileSync(path.join(slotDir, 'README-diverged.txt'), 'diverged');
    execFileSync('git', ['add', 'README-diverged.txt'], { cwd: slotDir });
    execFileSync('git', ['commit', '-q', '-m', 'diverged-head'], { cwd: slotDir });

    const allocatedRepairSlots: string[] = [];
    runtime.prepareStagedRelease = async (infoArg: any, target: any) => {
      allocatedRepairSlots.push(target.slotDir);
      assert.notEqual(path.resolve(target.slotDir), path.resolve(infoArg.installDir), 'repair must use independent slot');
      writeLauncher(target.slotDir, target.slotBinary);
    };
    await assert.rejects(runtime.update(), /重复升级只读校验未通过/);
    assert.equal(allocatedRepairSlots.length, 1);
    assert.notEqual(path.resolve(allocatedRepairSlots[0]), path.resolve(slotDir));
    assert.equal(fs.existsSync(allocatedRepairSlots[0]), false, 'failed sibling repair slot cleaned up');
    assert.equal(fs.readFileSync(slotBinary, 'utf8'), launcherWithSentinel, 'active slotBinary still untouched');
    assert.equal(runtime.client.closed, false);
    assert.equal((await runtime.detect()).connected, true);
  } finally {
    native.prepareNativeRecovery = origPrepareNative;
    runtime.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
