import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TestRenderer, { act } from 'react-test-renderer';
import { createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { projectExecutionBrief } from '../src/services/projectKnowledge';
import { reviewDatabaseChanges } from '../src/proto/database/designReview';
import { pageGenerationOrder, reviewPageDependencies, type PageDependency } from '../src/services/projectDependencies';
import { applyStructureOperation } from '../src/services/projectPlan';
import { applyProjectChanges, prepareProjectChanges, projectContext, projectRevision, undoProjectChange } from '../src/services/hermesProject';
import { previewRelationIssues, seedRelatedTables } from '../src/proto/database/previewRelations';
import { generateMockRows } from '../src/proto/runtime/mock';
import { rowsForSource } from '../src/proto/table/model';
import { useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { generateUnpackedGitFiles } from '../src/utils/pflowBinaryCodec';
import { parsePageSource } from '../src/proto/dsl/parser';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { columnDefaultIssue, columnDefaultSql, valuesWithColumnDefaults } from '../src/proto/database/columnDefault';
import { databaseRequirementSources } from '../src/services/databaseRequirementSources';

const link: PageDependency = {kind:'foreignKey', sourcePageId:'catalog', sourceTableId:'volumes', sourceColumnId:'volume-pk',
  tableId:'loans', foreignKeyColumnId:'volume-ref', requirement:'借阅明细引用馆藏登记号'};
const volume: DBTableSchema = {
  id:'volumes', tableName:'library_volume', cnName:'馆藏', domain:'馆藏流通', description:'馆藏书目',
  modeling:{entity:'馆藏',grain:'一册书',reason:'登记馆藏',pendingRules:[{rule:'查询借阅历史',reason:'需等待借阅流水接入'}]},
  columns:[
    {id:'volume-pk',name:'registration_no',dataType:'INTEGER',isPrimaryKey:true,nullable:false,comment:'登记号'},
    {id:'volume-title',name:'title',dataType:'VARCHAR(64)',nullable:false,comment:'书名'},
  ],sharedByMenus:[{pageId:'catalog',menuTitle:'馆藏',accessMode:'CRUD 读写',fieldMappingNote:'登记'}],
};
const loans: DBTableSchema = {
  id:'loans', tableName:'library_loan', cnName:'借阅', domain:'馆藏流通', description:'借阅流水',
  modeling:{entity:'借阅',grain:'一次借阅',reason:'允许同一册书多次借阅'},
  columns:[
    {id:'loan-pk',name:'id',dataType:'VARCHAR(64)',isPrimaryKey:true,nullable:false,comment:'流水标识'},
    {id:'volume-ref',name:'volume_no',dataType:'INTEGER',nullable:false,isForeignKey:true,references:'library_volume(registration_no)',comment:'馆藏登记号'},
  ],sharedByMenus:[],
};
const page = (body: string) => `export default function Page(){return <Page pfId="root">${body}</Page>}`;
function fixture() {
  const payload = createProjectPayload({projectId:'library',projectName:'图书馆',templateId:'blank_project', storageDir:'/tmp',fileName:'library.pflow',createdAt:'2026-11-05',updatedAt:'2026-11-05',pageCount:0,tableCount:0,stickyCount:0});
  const s = payload.stateSnapshot;
  s.designerFolders = [{id:'library-folder',title:'图书馆',parentFolderId:null}];
  s.designerPages = [{pageId:'history',title:'借阅历史',folderId:'library-folder'},{pageId:'catalog',title:'馆藏',folderId:'library-folder'}];
  s.pageSources = {catalog:page('<Table pfId="titles" table="volumes"/>'), history:page('<Table pfId="log" table="loans" sourceForeignKey="volume_no"/><Button pfId="add" onClick={()=>{toast("登记");}}>登记</Button>')};
  s.dbTables = structuredClone([volume,loans]);
  s.activePageId='catalog';
  s.mindmaps={nodes:[{id:'library-map',kind:'mindmap',title:'借阅',parentId:null,source:'flowchart LR\n A[馆藏登记] --> B[查询借阅历史]'}],links:[]};
  s.projectPlan={summary:'查阅选中馆藏的借阅历史',approved:true,folders:[],generatedPageIds:['catalog','history'],
    pages:s.designerPages.map(p=>({...p,requirements:p.title,dependencies:p.pageId==='history'?[link]:[],acceptanceCases:p.pageId==='history'?[{scenario:'选册查看',expected:'只显示该册借阅流水',actionPfId:'add',source:{mindmapId:'library-map',quote:'查询借阅历史'}}]:[]}))};
  return payload;
}

test('library menus use exact upstream column IDs, validate scenarios and block loss of an existing verified binding', () => {
  const payload=fixture(), s=payload.stateSnapshot, plan=s.projectPlan!;
  assert.deepEqual(pageGenerationOrder(plan.pages,[]).map(p=>p.pageId),['catalog','history']);
  assert.equal(reviewPageDependencies(s).links[0].status,'已核对结构与页面绑定');
  assert.equal(reviewPageDependencies(s).cases[0].status,'待业务验收');
  const patch = {tool:'protoflow_apply_tsx_patch',args:{pageId:'history',source:page('<Text pfId="label">历史</Text>')}};
  assert.throws(()=>prepareProjectChanges(payload,[patch]),/已确认来源被破坏/);
  assert.throws(()=>applyStructureOperation(s,'protoflow_revise_project_page',{pageId:'history',requirements:'查阅',dependencies:[{...link,sourcePageId:'missing'}]}),/未知的上游/);
  const fk = s.dbTables[1].columns[1];
  fk.references='library_volume(title)';
  assert.equal(reviewPageDependencies(s).links[0].status,'待建立指定外键');
  s.pageSources.history = page('<Button pfId="add" disabled={true} onClick={()=>{toast("登记");}}>登记</Button><BarChart pfId="stats" source="sample"/>');
  assert.equal(reviewPageDependencies(s).cases[0].status,'待绑定可操作入口');
  plan.pages[0].acceptanceCases!.push({scenario:'借阅统计',expected:'使用流水表',chart:{pfId:'stats',tableId:'loans'}});
  assert.equal(reviewPageDependencies(s).cases[1].status,'图表待绑定约定的数据表');
  assert.deepEqual(reviewPageDependencies(s).sampleCharts,[{pageId:'history',pfId:'stats'}]);
  s.mindmaps.nodes=[];
  assert.equal(reviewPageDependencies(s).cases[0].status,'脑图来源已变化');
  delete s.pageSources.history;
  assert.ok(projectExecutionBrief(s,{pageId:'history'}).tables.some(t=>t.id==='volumes'));
  const added=reviewDatabaseChanges([volume],[volume,loans]);
  assert.equal(added.affectedRules[0].tableId,volume.id);
  assert.deepEqual(added.affectedRules[0].previousRules,volume.modeling!.pendingRules);
});

test('library examples preserve typed keys, empty tables and authored rows; scoped details return only matching loans', async () => {
  const s=fixture().stateSnapshot, tables=s.dbTables;
  const generated = seedRelatedTables(tables,['loans'],{},generateMockRows);
  assert.equal(generated.volumes[0].registration_no,1);
  assert.equal(generated.loans[0].volume_no,1);
  assert.deepEqual(previewRelationIssues(tables,generated),[]);
  assert.deepEqual(seedRelatedTables(tables,['loans'],{volumes:[]},generateMockRows).loans,[]);
  const title={id:'runtime-id',registration_no:0,title:'数学史'};
  const saved={volumes:[title], loans:[{id:'one',volume_no:0},{id:'two',volume_no:0},{id:'wrong-type',volume_no:'0'}]};
  assert.deepEqual(rowsForSource(saved.loans,'volume_no','loans',{tableId:'volumes',row:title},tables).map(r=>r.id),['one','two']);
  assert.deepEqual(rowsForSource(saved.loans,'volume_no','loans',{tableId:'loans',row:title},tables),[]);
  assert.equal(previewRelationIssues(tables,saved)[0].firstRowId,'wrong-type');
  const payload = fixture();
  loadProjectFromBinaryPayload(payload);
  usePageStore.setState({tableRows:{}});
  const snapshot=createPublishedSnapshot('catalog');
  await Promise.resolve();
  assert.equal(snapshot.tableRows.loans[0].volume_no,1);
  assert.deepEqual(usePageStore.getState().tableRows,{});
  usePageStore.setState({tableRows:saved});
  usePageStore.getState().prepareRelatedExamples();
  assert.deepEqual(usePageStore.getState().tableRows,saved);
});

test('a bound picker displays the title and saves the exact numeric source key, including zero, only after valid single selection', async () => {
  loadProjectFromBinaryPayload(fixture());
  usePageStore.setState({tableRows:{volumes:[{id:'row-a',registration_no:0,title:'数学史'},{id:'row-b',registration_no:2,title:'建筑史'}]}});
  const source=page('<Form pfId="form" table="loans"><PickerInput pfId="pick" name="volume_no" overlay="lookup"/></Form><Modal pfId="dialog" id="lookup"><Table pfId="books" table="volumes"/></Modal>');
  const doc=parsePageSource(source).doc!;
  let rt:Runtime, view:TestRenderer.ReactTestRenderer;
  function Harness(){rt=useRuntimeController(doc,'history',false);return null;}
  act(()=>{view=TestRenderer.create(React.createElement(Harness));});
  try {
    act(()=>rt.openPicker('lookup',{targetPfId:'pick',formId:'form',name:'volume_no'},{}));
    act(()=>rt.setSelection('books',['row-a','row-b']));
    const pick=async (key:string)=>{await act(async()=>rt.run({$kind:'actions',calls:[{name:'returnSelection',args:['books','title',key]}]},{}));};
    await pick('registration_no');
    assert.equal(rt!.overlays.length,1);
    act(()=>rt.setSelection('books',['row-a']));
    await pick('id');
    assert.equal(rt!.formValues.form,undefined);
    await pick('registration_no');
    assert.equal(rt!.formValues.form.volume_no,0);
    assert.equal(rt!.pickerValues.pick,'数学史');
    assert.equal(rt!.overlays.length,0);
    await act(async()=>rt.run({$kind:'actions',calls:[{name:'navigate',args:['history','row']}]},{row:{id:'row-a'},tableId:'volumes'}));
    assert.deepEqual(useProtoStore.getState().navigationSource,{tableId:'volumes',rowId:'row-a'});
    useProtoStore.getState().setActivePage('catalog');
    assert.equal(useProtoStore.getState().navigationSource,null);
  } finally {act(()=>view!.unmount());}
});

test('resume commands do not create business requirements; changed mindmaps retain distinct source evidence', () => {
  const s=fixture().stateSnapshot;
  const messages=['原始设计','继续任务','新增借阅需求'].map((text,i)=>({id:'msg-'+i,kind:'project',role:'user',text,
    mindmaps:[{mindmapId:'library-map',title:'借阅',source:i===2?'修订图':'原图'}]}));
  const sources=databaseRequirementSources(s,messages as any);
  assert.deepEqual(sources.filter(r=>r.id.startsWith('map:')).map(r=>r.text),['原图','修订图']);
  assert.ok(!sources.some(r=>r.text==='继续任务'));
});

test('a reviewed library demo scenario is atomic, checks every FK, never overwrites saved rows and can be undone', () => {
  const payload=fixture();
  loadProjectFromBinaryPayload(payload);
  const datasets=[
    {tableId:'loans',rows:[{id:'l1',volume_no:41},{id:'l2',volume_no:41},{id:'l3',volume_no:72}]},
    {tableId:'volumes',rows:[{id:'v1',registration_no:41,title:'数学史'},{id:'v2',registration_no:72,title:'建筑史'}]},
  ];
  const op={tool:'protoflow_add_preview_scenario',args:{datasets}};
  const prepared=prepareProjectChanges(payload,[op]);
  assert.equal(prepared.next.stateSnapshot.tableRows.loans.length,3);
  assert.deepEqual(usePageStore.getState().tableRows,{});
  const broken=structuredClone(op);
  broken.args.datasets[0].rows[1].volume_no=99;
  assert.throws(()=>prepareProjectChanges(payload,[broken]),/l2.*volume_no/);
  const reserved=structuredClone(payload);reserved.stateSnapshot.tableRows.volumes=[];
  assert.throws(()=>prepareProjectChanges(reserved,[op]),/不能覆盖/);
  applyProjectChanges(payload,projectRevision(),[op],undefined,'library-scenario');
  assert.equal(createPublishedSnapshot('catalog').tableRows.loans.length,3);
  undoProjectChange('library-scenario');
  assert.deepEqual(usePageStore.getState().tableRows,{});
});

test('native project tools reject uncited or stale mindmap evidence, then stage a typed cross-table demo without modifying the authoring store', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'protoflow-library-'));
  try {
    const payload=fixture(), plan=payload.stateSnapshot.projectPlan!;
    loadProjectFromBinaryPayload(payload);
    const file=path.join(dir,'context.json');
    const {callTool,atomicWrite}=require(path.join(process.cwd(),'electron/protoflow-mcp.cjs'));
    atomicWrite(file,{active:true,kind:'project',projectId:'library',workflowPhase:'conversation',runId:'r',requirePageEvidence:true,
      snapshot:{...projectContext(),selectedMindmapIds:['library-map']},operations:[]});
    const draft=structuredClone(plan);
    draft.pages[1].acceptanceCases=[{scenario:'读书目',expected:'显示书名'}];
    const bad=structuredClone(draft);
    delete bad.pages[0].acceptanceCases![0].source;
    assert.throws(()=>callTool(file,'protoflow_set_project_plan',{plan:bad}),/引用所选脑图/);
    bad.pages[0].acceptanceCases![0].source={mindmapId:'library-map',quote:'未出现'};
    assert.throws(()=>callTool(file,'protoflow_set_project_plan',{plan:bad}),/无法定位/);
    assert.ok(callTool(file,'protoflow_set_project_plan',{plan:draft}).staged);
    const datasets=[
      {tableId:'volumes',rows:[{id:'vol-a',registration_no:0,title:'工程史'}]},
      {tableId:'loans',rows:[{id:'loan-a',volume_no:0},{id:'loan-b',volume_no:0}]},
    ];
    assert.ok(callTool(file,'protoflow_add_preview_scenario',{datasets}).staged);
    const staged=callTool(file,'protoflow_get_table_rows',{tableId:'loans'});
    assert.deepEqual(staged.rows.map((r:{volume_no:number})=>r.volume_no),[0,0]);
    assert.throws(()=>callTool(file,'protoflow_add_preview_scenario',{datasets}),/不能覆盖/);
    assert.deepEqual(usePageStore.getState().tableRows,{});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('new rows and DDL share quoted and historical text defaults; a server-only expression aborts the write', () => {
  const payload=fixture(), table=payload.stateSnapshot.dbTables[1];
  const status={id:'state-field',name:'status',dataType:'VARCHAR(16)',nullable:false,comment:'借阅状态',defaultValue:"'todo'"};
  table.columns.push(status);
  loadProjectFromBinaryPayload(payload);
  assert.ok(usePageStore.getState().snapshotPreviewRows().loans.every(row=>row.status==='todo'));
  const row=usePageStore.getState().insertRow('loans',{volume_no:41});
  assert.equal(row.status,'todo');
  assert.equal(valuesWithColumnDefaults(table,{status:'done'}).status,'done');
  for (const literal of ['todo','草稿']) {
    const historical={...status,defaultValue:literal};
    assert.equal(columnDefaultSql(historical),`'${literal}'`);
    assert.equal(valuesWithColumnDefaults({...table,columns:[historical]},{}).status,literal);
  }
  table.columns[table.columns.length - 1] = {...status,defaultValue:'草稿'};
  const ddl=generateUnpackedGitFiles(payload).find(f=>f.relativePath==='database/schema.sql')!;
  assert.match(String(ddl.content),/DEFAULT '草稿'/);
  assert.match(columnDefaultIssue({...status,defaultValue:'NULL'})!,/非空/);
  assert.throws(()=>valuesWithColumnDefaults({...table,columns:[{...status,defaultValue:'make_status()'}]},{}),/需要数据库执行/);
  assert.equal(valuesWithColumnDefaults({...table,columns:[{...status,defaultValue:"'it''s valid'"}]},{}).status,"it's valid");
});
