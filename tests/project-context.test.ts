import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from '../src/services/projectStorage';
import { encodePflowBinary, decodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { applyProjectChanges, prepareProjectChanges, projectRevision, projectContext, undoProjectChange } from '../src/services/hermesProject';
import { projectExecutionBrief } from '../src/services/projectKnowledge';
const { callTool, atomicWrite } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
const agreement = {id:'design-list',kind:'design' as const,title:'列表规范',text:'查询区保持紧凑，新增表单使用右侧抽屉。',pageIds:[]};
function fixture() {
  const payload = createProjectPayload({projectId:'context-test', projectName:'Context',templateId:'blank_project',storageDir:'/tmp/context-test',fileName:'test.pflow',createdAt:'2026-11-05',updatedAt:'2026-11-05',pageCount:0,tableCount:0,stickyCount:0});
  const s = payload.stateSnapshot;
  s.designerFolders = [{id:'purchasing',title:'采购',parentFolderId:null},{id:'sales',title:'销售',parentFolderId:null}];
  s.designerPages = [{pageId:'orders',title:'订单',folderId:'purchasing'},{pageId:'suppliers',title:'供应商',folderId:'purchasing'},{pageId:'sales-list',title:'销售',folderId:'sales'}];
  s.pageSources = Object.fromEntries(s.designerPages.map(page => [page.pageId, `export default function Page(){return <Page pfId="root"><Text pfId="label">${page.title}</Text></Page>}`]));
  s.activePageId = 'orders';
  s.projectPlan = {summary:'已确认采购与销售菜单',folders:[],pages:s.designerPages.map(page => ({...page,requirements:`${page.title}的验收要求`})),approved:true,generatedPageIds:['orders']};
  return payload;
}

test('project agreements are reviewed, survive archive reload, undo, and remain project isolated', () => {
  loadProjectFromBinaryPayload(fixture());
  const base = captureProjectPayload();
  const op = {tool:'protoflow_upsert_project_agreement',args:{agreement}};
  const candidate = prepareProjectChanges(base,[op]);
  assert.equal(candidate.next.stateSnapshot.projectAgreements?.length,1);
  assert.deepEqual(captureProjectPayload().stateSnapshot.projectAgreements,[]);
  applyProjectChanges(base,projectRevision(),[op],undefined,'agreement-change');
  assert.equal(captureProjectPayload().stateSnapshot.projectAgreements?.[0].text,agreement.text);
  const stored = encodePflowBinary(captureProjectPayload());
  undoProjectChange('agreement-change');
  assert.deepEqual(captureProjectPayload().stateSnapshot.projectAgreements,[]);
  loadProjectFromBinaryPayload(decodePflowBinary(stored));
  assert.deepEqual(captureProjectPayload().stateSnapshot.projectAgreements,[agreement]);
  const old = fixture(); delete old.stateSnapshot.projectAgreements;
  loadProjectFromBinaryPayload(old);
  assert.deepEqual(captureProjectPayload().stateSnapshot.projectAgreements,[]);
  assert.throws(() => prepareProjectChanges(base,[{tool:op.tool,args:{agreement:{...agreement,pageIds:['unknown-page']}}}]),/pageId/);
  assert.throws(() => prepareProjectChanges(base,[{tool:op.tool,args:{agreement:{...agreement,kind:'approved'}}}]),/无效/);
});

test('execution briefs retain global rules, scope page/module facts and resolve physical FK contracts', () => {
  const {stateSnapshot:s} = fixture();
  s.projectAgreements = [agreement,{...agreement,id:'sales-rule',pageIds:['sales-list'],text:'销售特有的规则'}];
  s.dbTables = [
    {id:'supplier-id',tableName:'physical_supplier',cnName:'供应商',domain:'测试',description:'',columns:[{id:'supplier-pk',name:'pk',dataType:'BIGINT',nullable:false,isPrimaryKey:true,comment:''}],sharedByMenus:[{pageId:'suppliers',menuTitle:'供应商',accessMode:'读',fieldMappingNote:''}]},
    {id:'order-id',tableName:'physical_order',cnName:'订单',domain:'测试',description:'',columns:[{id:'order-pk',name:'pk',dataType:'BIGINT',nullable:false,isPrimaryKey:true,comment:''},{id:'supplier-fk',name:'supplier_pk',dataType:'BIGINT',nullable:false,isForeignKey:true,references:'physical_supplier(pk)',comment:''}],sharedByMenus:[{pageId:'orders',menuTitle:'订单',accessMode:'读',fieldMappingNote:''}]},
    {id:'sales-id',tableName:'physical_sales',cnName:'销售',domain:'测试',description:'',columns:[{id:'sales-pk',name:'pk',dataType:'BIGINT',nullable:false,isPrimaryKey:true,comment:''}],sharedByMenus:[]},
  ];
  const brief = projectExecutionBrief(s,{pageId:'orders'});
  assert.deepEqual(brief.agreements.map(a=>a.id),['design-list']);
  assert.deepEqual(brief.pageCatalog.map(p=>p.pageId),['orders']);
  assert.deepEqual(brief.tables.map(t=>t.id),['supplier-id','order-id']);
  assert.deepEqual(brief.plan?.progress.generatedPageIds,['orders']);
  assert.ok(!JSON.stringify(brief).includes('export default'));
  assert.deepEqual(projectExecutionBrief(s,{folderId:'purchasing'}).pageCatalog.map(p=>p.pageId),['orders','suppliers']);
  assert.throws(()=>projectExecutionBrief(s,{pageId:'physical_order'}),/未知页面/);
  s.pageSources.orders='export default function Page(){return <Page pfId="root"/>}';
  assert.deepEqual(projectExecutionBrief(s).plan?.progress.generatedPageIds,[]);
});

test('MCP requires rereading durable facts after compaction and never presents staged agreements as confirmed', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'protoflow-context-'));
  try {
    loadProjectFromBinaryPayload(fixture());
    const file=path.join(dir,'context.json');
    const ctx={active:true,projectId:'context-test',kind:'project',threadId:'chat',workflowPhase:'conversation',runId:'r',sessionId:'native-s',requireProjectBrief:true,contextFocus:{pageId:'orders'},confirmedProjectAgreements:[],snapshot:projectContext(),operations:[]};
    atomicWrite(file,ctx);
    assert.throws(()=>callTool(file,'protoflow_upsert_project_agreement',{agreement}),/重新核对/);
    const initial=callTool(file,'protoflow_get_project_brief',{pageId:'orders'});
    assert.equal(initial.sessionId,'native-s');
    callTool(file,'protoflow_upsert_project_agreement',{agreement});
    const reread=callTool(file,'protoflow_get_project_brief',{});
    assert.deepEqual(reread.agreements,[]);
    assert.deepEqual(reread.agreementsAwaitingConfirmation,['design-list']);
    atomicWrite(path.join(dir,'context-epoch.json'),{sessionId:'native-s',epoch:1});
    assert.throws(()=>callTool(file,'protoflow_upsert_project_agreement',{agreement}),/重新核对/);
    callTool(file,'protoflow_get_project_brief',{});
    callTool(file,'protoflow_upsert_project_agreement',{agreement:{...agreement,text:'调整后的规范'}});
    atomicWrite(path.join(dir,'context-epoch.json'),{sessionId:'other-s',epoch:2});
    assert.throws(()=>callTool(file,'protoflow_get_project_brief',{}),/会话标识/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('context bridge fences session identity, blocks compression during work and invalidates stale briefs', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'protoflow-native-context-'));
  try {
    const events:any[]=[];
    const runtime=new HermesRuntime({dataDir:dir,emit:(event:any)=>events.push(event)});
    const scope={projectId:'context-test',kind:'project',threadId:'chat'};
    const {conversationKey}=require(path.join(process.cwd(),'electron/hermes-conversation.cjs'));
    const s={...scope,dir,sessionId:'s',running:false};
    runtime.sessions.set(conversationKey(scope),s);
    runtime.nativeContext=async()=>({sessionId:'s',usage:{used:200,size:1000,compressions:1}});
    await assert.rejects(runtime.context({...scope,sessionId:'other',action:'usage'}),/会话/);
    s.running=true;
    await assert.rejects(runtime.context({...scope,sessionId:'s',action:'compress'}),/任务结束/);
    s.running=false;
    await runtime.context({...scope,sessionId:'s',action:'usage'});
    runtime.acceptContext(s,{sessionId:'s',usage:{used:50,size:1000,compressions:2}});
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'context-epoch.json'),'utf8')).epoch,1);
    const count=events.length;
    runtime.acceptContext(s,{sessionId:'other',usage:{used:1,size:1000}});
    runtime.acceptContext(s,{sessionId:'s',usage:{used:-1,size:1000}});
    assert.equal(events.length,count);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('a native compression counter change fences writes even before the usage subscriber receives it', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'protoflow-compression-fence-'));
  try {
    loadProjectFromBinaryPayload(fixture());
    const countFile=path.join(dir,'count.json'), bridge=path.join(dir,'native-fixture');
    fs.writeFileSync(countFile,'0');
    fs.writeFileSync(bridge,`#!${process.execPath}\nconst fs=require('node:fs');const r=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify({sessionId:r.sessionId,usage:{compressions:JSON.parse(fs.readFileSync(${JSON.stringify(countFile)},'utf8'))}}));`,{mode:0o700});
    const file=path.join(dir,'context.json');
    atomicWrite(file,{active:true,projectId:'context-test',kind:'project',threadId:'chat',workflowPhase:'conversation',runId:'r',sessionId:'native-s',requireProjectBrief:true,
      nativeBridge:{python:bridge,installDir:dir,home:dir},snapshot:projectContext(),operations:[]});
    callTool(file,'protoflow_get_project_brief',{});
    fs.writeFileSync(countFile,'1');
    assert.throws(()=>callTool(file,'protoflow_upsert_project_agreement',{agreement}),/重新核对/);
    callTool(file,'protoflow_get_project_brief',{});
    assert.equal(callTool(file,'protoflow_upsert_project_agreement',{agreement}).staged,true);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
