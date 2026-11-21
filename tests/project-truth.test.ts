import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useProtoStore, type DBTableSchema, type ClosedLoopAuditIssue } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from '../src/services/projectStorage';
import { analyzeProject, projectSpecification } from '../src/services/projectAnalysis';
import { prepareProjectChanges } from '../src/services/hermesProject';
import { validateProjectPayload } from '../src/services/projectValidation';
import { decodePflowBinary, encodePflowBinary, generateUnpackedGitFiles, type PflowProjectMetadata } from '../src/utils/pflowBinaryCodec';
import { ComponentStickyPin } from '../src/components/ComponentStickyPin';
import { CrossModuleFlowView } from '../src/components/CrossModuleFlowView';
import { KnowledgeImpactView } from '../src/components/KnowledgeImpactView';
import { InspectorSidebar } from '../src/components/InspectorSidebar';
import { ClosedLoopAuditView } from '../src/components/ClosedLoopAuditView';
import { DesktopBundleModal } from '../src/components/DesktopBundleModal';
import { ProjectTableData } from '../src/components/ProjectTableData';
import { parsePageSource } from '../src/proto/dsl/parser';
import { walk } from '../src/proto/dsl/tree';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { reviewDatabaseDesign } from '../src/proto/database/designReview';
import { JSDOM } from 'jsdom';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { useHermesStore } from '../src/store/useHermesStore';
import type { HermesDesktopApi, HermesOperation } from '../src/services/hermesClient';

const meta = (id = 'actual-project', templateId: PflowProjectMetadata['templateId'] = 'blank_project'): PflowProjectMetadata => ({ projectId:id, projectName:'真实客户工程', templateId, storageDir:'/tmp/truth', fileName:`${id}.pflow`, createdAt:'2026-10-31', updatedAt:'2026-10-31', pageCount:0, tableCount:0, stickyCount:0 });
const table: DBTableSchema = { id:'entity-customers', tableName:'physical_customers', cnName:'客户档案', domain:'基础资料域 (MDM)', description:'自建客户表', sharedByMenus:[], columns:[{id:'col-id',name:'id',dataType:'VARCHAR(32)',nullable:false,isPrimaryKey:true,comment:'客户标识'},{id:'col-name',name:'customer_name',dataType:'VARCHAR(128)',nullable:false,comment:'客户名称'}] };
const mainSource = `export default function Page(){return <Page pfId="customer-root" title="客户查询"><Table pfId="customer-table" table="entity-customers" columns={[{title:'客户名称',dataIndex:'customer_name'}]} rowActions={[{label:'详情',onClick:()=>navigate('customer-detail')}]} /><Button pfId="broken-link" onClick={()=>navigate('missing-page')}>失效跳转</Button></Page>;}`;
const detailSource = `export default function Page(){return <Page pfId="detail-root" title="客户详情"><Table pfId="detail-table" table="entity-customers" /></Page>;}`;
function fixture(id = 'actual-project') {
  const payload = createProjectPayload(meta(id));
  Object.assign(payload.stateSnapshot, { designerFolders: [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }], activePageId:'customer-list', dbTables:[structuredClone(table)], pageSources:{'customer-list':mainSource,'customer-detail':detailSource}, designerPages:[{pageId:'customer-list',title:'客户查询',folderId:'folder-project-pages'},{pageId:'customer-detail',title:'客户详情',folderId:'folder-project-pages'}], tableRows:{'entity-customers':[{id:'customer-17',customer_name:'用户保存的客户'}]}, stickyNotes:[{id:'note-list',pageId:'customer-list',targetWidgetId:'customer-table',targetWidgetName:'客户表格',index:1,text:'客户名称必须显示完整',compiledRule:'',active:true},{id:'note-detail',pageId:'customer-detail',targetWidgetId:'detail-table',targetWidgetName:'客户详情表',index:1,text:'详情需求记录',compiledRule:'legacy-description',active:false}] });
  return payload;
}
const issue = (): ClosedLoopAuditIssue => ({id:'issue-actual',scope:'module',pageId:'customer-list',moduleTitle:'客户查询',category:'原型组件 ↔ 数据库表脱节',severity:'warning',title:'核对客户名称',brokenChainDesc:'检查客户名称字段',targetWidgetId:'customer-table',targetWidgetName:'客户表格',targetTableId:'entity-customers',aiQuestion:'是否显示完整名称？',status:'open',options:[{id:'option-full',label:'完整显示',description:'显示完整客户名称',stickyPatchText:'完整名称',dbPatchSummary:'无需修改字段'}]});
const text = (renderer: TestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const button = (renderer: TestRenderer.ReactTestRenderer, label: string) => renderer.root.findAllByType('button').find(b => b.children.some(c => typeof c === 'string' && c.includes(label)))!;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function mockHermes(execute: (input: Parameters<HermesDesktopApi['execute']>[0]) => Promise<{text: string; operations: HermesOperation[]}>) {
  useHermesStore.setState(useHermesStore.getInitialState(), true);
  useHermesStore.setState({status:'running'});
  (window as any).protoflowDesktop = {hermes:{
    onEvent: () => () => {},
    session: async (scope: {projectId: string; pageId: string}) => ({...scope, sessionId:`session-${scope.pageId}`, running:false, models:{currentModelId:'test-model', availableModels:[{modelId:'test-model',name:'Test'}]}}),
    sync: async () => ({synced:true}),
    execute: async (input: Parameters<HermesDesktopApi['execute']>[0]) => ({...await execute(input), sessionId:`session-${input.pageId}`,modelId:'test-model',runId:`test-${input.pageId}`}),
  }};
}

// These checks deliberately use table IDs different from physical names and no sample business entities.
test('project analysis reads nested actions and exact IDs without inventing transfers from shared tables', () => {
  const s = fixture().stateSnapshot, result = analyzeProject(s);
  assert.deepEqual(result.navigation.map(n => [n.from,n.to]), [['customer-list','customer-detail']]);
  assert.ok(result.navigation[0].event.includes('rowActions[0]'));
  assert.deepEqual(result.usages.map(u => u.tableId), ['entity-customers','entity-customers']);
  assert.equal(result.transfers.length, 0);
  assert.ok(result.issues.some(i => i.includes('missing-page')));
  s.pageSources['customer-detail'] = detailSource.replace('entity-customers','physical_customers');
  assert.ok(analyzeProject(s).issues.some(i => i.includes('不存在的数据表 physical_customers')));
  assert.equal(analyzeProject(s).usages.length, 1);
});

test('data transfer analysis requires actual component references and bound table IDs', () => {
  const s = fixture().stateSnapshot;
  s.dbTables.push({...structuredClone(table),id:'entity-destination',tableName:'physical_destination'});
  s.pageSources['customer-list'] = `export default function Page(){return <Page pfId="root"><Table pfId="source-grid" id="source" table="entity-customers"/><Table pfId="dest-grid" table="entity-destination"/><Button pfId="transfer" onClick={()=>importPurchaseOrderLines('source','dest-grid')}>转入</Button></Page>;}`;
  const result = analyzeProject(s);
  assert.deepEqual(result.transfers, []);
  assert.ok(result.issues.some(i => i.includes('仅支持采购明细到验收明细')));
  const sample = createProjectPayload(meta('sample', 'customs_erp'));
  assert.ok(analyzeProject(sample.stateSnapshot).transfers.some(t => t.fromTableId === 't_pms_po_item' && t.toTableId === 't_wms_acceptance_detail'));
  s.pageSources['customer-list'] = s.pageSources['customer-list'].replace("'dest-grid'", "'missing-grid'");
  assert.equal(analyzeProject(s).transfers.length, 0);
  assert.ok(analyzeProject(s).issues.some(i => i.includes('缺少有效的来源或目标表')));
});

test('cross-module, knowledge and inspector views follow current project and never mutate or create preview rows on read', () => {
  loadProjectFromBinaryPayload(fixture());
  usePageStore.setState({tableRows:{}});
  const before = captureProjectPayload().stateSnapshot;
  for (const Component of [CrossModuleFlowView, KnowledgeImpactView, InspectorSidebar]) {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Component)); });
    try {
      assert.ok(text(renderer!).includes('客户'));
      for (const sample of ['供应商审批','合格供应商目录','Page 57','海关物资管理系统','已纳入变更影响域监控']) assert.ok(!text(renderer!).includes(sample), sample);
      if (Component === InspectorSidebar) {
        act(() => button(renderer!, '预览数据').props.onClick());
        assert.ok(text(renderer!).includes('尚未加载'));
        act(() => button(renderer!, '工程规格').props.onClick());
        assert.ok(text(renderer!).includes('真实客户工程'));
      }
    } finally { act(() => renderer!.unmount()); }
    assert.deepEqual(captureProjectPayload().stateSnapshot, before);
  }
});

test('table data inspector shows only exact fields and persisted rows, distinguishes empty from unloaded data', async () => {
  loadProjectFromBinaryPayload(fixture());
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(ProjectTableData, {table})); });
  try {
    assert.ok(text(renderer!).includes('用户保存的客户'));
    assert.ok(text(renderer!).includes('customer_name'));
    assert.ok(!text(renderer!).includes('unit_price'));
    act(() => usePageStore.setState({tableRows:{'entity-customers':[{id:'customer-17',name:'不应替代客户字段'}]}}));
    assert.ok(text(renderer!).includes('未提供'));
    assert.ok(!text(renderer!).includes('不应替代客户字段'));
    act(() => usePageStore.setState({tableRows:{'entity-customers':[]}}));
    assert.ok(text(renderer!).includes('暂无预览记录'));
    assert.equal(renderer!.root.findAllByType('button').length, 0);
    act(() => usePageStore.setState({tableRows:{}}));
    assert.deepEqual(usePageStore.getState().tableRows, {});
    await act(async () => { button(renderer!, '加载原型数据').props.onClick(); });
    assert.ok(usePageStore.getState().tableRows['entity-customers'].length > 0);
  } finally { act(() => renderer!.unmount()); }
});

test('exported requirements belong to actual pages, orphan notes are preserved separately, and SPEC contains no sample claims', () => {
  const payload = fixture();
  payload.stateSnapshot.stickyNotes.push({...payload.stateSnapshot.stickyNotes[0],id:'orphan',pageId:'old-deleted-page',text:'不可丢失的旧便签'});
  const files = generateUnpackedGitFiles(payload);
  const main = files.find(f => f.relativePath === 'sticky-notes/customer-list.pins.md')!;
  const detail = files.find(f => f.relativePath === 'sticky-notes/customer-detail.pins.md')!;
  assert.ok(main.content.includes('客户名称必须显示完整'));
  assert.ok(!main.content.includes('详情需求记录'));
  assert.ok(detail.content.includes('详情需求记录'));
  assert.ok(files.find(f => f.relativePath === 'sticky-notes/unresolved.json')!.content.includes('不可丢失的旧便签'));
  assert.ok(files.some(f => f.relativePath === 'database/schema.sql'));
  assert.ok(!files.some(f => /057_|018_|V20261028|\.page\.json/.test(f.relativePath)));
  const spec = projectSpecification(payload);
  assert.equal(files.find(f => f.relativePath === 'SPEC.md')!.content, spec);
  assert.ok(spec.includes('physical_customers'));
  assert.ok(spec.includes('missing-page'));
  assert.ok(spec.includes('old-deleted-page'));
  for (const sample of ['海关物资','验收单','供应商']) assert.ok(!spec.includes(sample));
});

test('all new templates start without fabricated audits or flow events; requirement notes never manufacture compiled rules', () => {
  for (const template of ['blank_project','customs_erp','supply_chain'] as const) {
    const payload = createProjectPayload(meta('new', template));
    assert.deepEqual(payload.stateSnapshot.closedLoopIssues, []);
  }
  assert.equal('resetSandbox' in useProtoStore.getState(), false);
  loadProjectFromBinaryPayload(fixture());
  assert.deepEqual(useProtoStore.getState().flowLogs, []);
  useProtoStore.getState().addStickyRuleToWidget('customer-list','customer-table','新增需求','客户表格');
  assert.equal(useProtoStore.getState().stickyNotes.at(-1)!.compiledRule, '');
  useProtoStore.getState().updateStickyRuleText('note-detail','已修改要求');
  assert.equal(useProtoStore.getState().stickyNotes.find(n => n.id === 'note-detail')!.compiledRule, '');
});

test('legacy audit claims are marked unverified, new Hermes results get durable provenance, invalid targets cannot navigate', () => {
  const payload = fixture();
  payload.stateSnapshot.closedLoopIssues = [{...issue(), targetWidgetId:'deleted-widget', targetTableId:'deleted-table', status:'resolved'}];
  loadProjectFromBinaryPayload(payload);
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(ClosedLoopAuditView)); });
  try {
    assert.ok(text(renderer!).includes('历史记录未核验来源'));
    assert.ok(!text(renderer!).includes('已扫描物理表'));
    assert.equal(button(renderer!, '关联组件已不可用').props.disabled, true);
    assert.equal(button(renderer!, '关联表已不可用').props.disabled, true);
    act(() => useProtoStore.setState({closedLoopIssues:[]}));
    assert.ok(text(renderer!).includes('暂无巡检记录'));
    assert.ok(!text(renderer!).includes('100%'));
  } finally { act(() => renderer!.unmount()); }
  const prepared = prepareProjectChanges(fixture(), [{tool:'protoflow_run_closed_loop_audit',args:{issues:[issue()]}}]);
  const actual = prepared.next.stateSnapshot.closedLoopIssues[0];
  assert.equal(actual.auditOrigin, 'hermes'); assert.ok(Number.isFinite(Date.parse(actual.auditedAt!)));
  assert.deepEqual(decodePflowBinary(encodePflowBinary(prepared.next)).stateSnapshot.closedLoopIssues, [actual]);
  const invalid = structuredClone(prepared.next); invalid.stateSnapshot.closedLoopIssues[0].auditedAt = 'not-a-date';
  assert.throws(() => validateProjectPayload(invalid), /有效巡检时间/);
});

test('file inspector opens with an actual zero diff, tracks added/deleted files and resets its baseline on project switch', () => {
  loadProjectFromBinaryPayload(fixture()); useProtoStore.setState({isBundleModalOpen:true});
  const before = captureProjectPayload().stateSnapshot;
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(DesktopBundleModal)); });
  try {
    act(() => button(renderer!, '本次查看期间').props.onClick());
    assert.ok(text(renderer!).includes('本次查看期间没有变化'));
    for (const fake of ['提交成功','AI 生成提交','模拟','提交历史']) assert.ok(!text(renderer!).includes(fake));
    assert.deepEqual(captureProjectPayload().stateSnapshot, before);
    act(() => usePageStore.setState({pageSources:{...usePageStore.getState().pageSources,'added-page':'export default function Page(){return <Page/>;}'}}));
    assert.ok(text(renderer!).includes('pages/added-page.page.tsx'));
    act(() => {const {['customer-detail']:removed,...rest} = usePageStore.getState().pageSources; usePageStore.setState({pageSources:rest});});
    assert.ok(text(renderer!).includes('删除'));
    act(() => loadProjectFromBinaryPayload(fixture('second-project')));
    // Loading a project closes the modal; reopening must compare to the second project's exact snapshot.
    act(() => useProtoStore.setState({isBundleModalOpen:true}));
    act(() => button(renderer!, '本次查看期间').props.onClick());
    assert.ok(text(renderer!).includes('本次查看期间没有变化'));
  } finally { act(() => renderer!.unmount()); }
});

test('directory export reports only confirmed writes and freezes the exact project snapshot while awaiting the picker', async () => {
  loadProjectFromBinaryPayload(fixture()); useProtoStore.setState({isBundleModalOpen:true});
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(DesktopBundleModal)); });
  try {
    await act(async () => { await button(renderer!, '导出源码目录').props.onClick(); });
    assert.ok(text(renderer!).includes('不支持目录导出'));
    assert.ok(!text(renderer!).includes('源码与工程文件已导出'));
    (window as any).protoflowDesktop = {writeUnpackedGitTree:async () => ({saved:false})};
    await act(async () => { await button(renderer!, '导出源码目录').props.onClick(); });
    assert.ok(!text(renderer!).includes('源码与工程文件已导出'));
    (window as any).protoflowDesktop.writeUnpackedGitTree = async () => {throw new Error('磁盘写入失败');};
    await act(async () => { await button(renderer!, '导出源码目录').props.onClick(); });
    assert.ok(text(renderer!).includes('磁盘写入失败'));
    let complete: (value: unknown) => void, written: any;
    (window as any).protoflowDesktop.writeUnpackedGitTree = (input: any) => {written=input;return new Promise(resolve => {complete=resolve;});};
    let task: Promise<void>;
    act(() => {task = button(renderer!, '导出源码目录').props.onClick();});
    act(() => usePageStore.getState().setPageSource('customer-list',mainSource.replace('客户查询','修改后的名称')));
    await act(async () => {complete!({saved:true,targetDir:'/tmp/export'});await task;});
    assert.equal(written.files.find((f: any) => f.relativePath === 'pages/customer-list.page.tsx').content, mainSource);
    assert.equal(decodePflowBinary(written.binaryBundle.binaryBytes).stateSnapshot.pageSources['customer-list'], mainSource);
    assert.ok(text(renderer!).includes('源码与工程文件已导出'));
  } finally { act(() => renderer!.unmount()); }
});

test('runtime navigation rejects unknown pages without creating phantom source or changing the active page', async () => {
  loadProjectFromBinaryPayload(fixture());
  let runtime: Runtime;
  function Harness() {runtime=useRuntimeController(parsePageSource(mainSource).doc!,'customer-list',false);return null;}
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {renderer = TestRenderer.create(React.createElement(Harness));});
  try {
    // Get the chain's canonical representation from the actual DSL parser.
    const parsed = parsePageSource(`export default function Page(){return <Button pfId="go" onClick={()=>navigate('missing-page')}/>;}`).doc!;
    await act(async () => {await runtime.run(parsed.root.props.onClick,{});});
    assert.equal(useProtoStore.getState().activePageId,'customer-list');
    assert.equal(usePageStore.getState().pageSources['missing-page'],undefined);
    assert.ok(runtime.toasts.some(t => t.type === 'error'));
    const valid = parsePageSource(`export default function Page(){return <Button pfId="go" onClick={()=>navigate('customer-detail')}/>;}`).doc!;
    await act(async () => {await runtime.run(valid.root.props.onClick,{});});
    assert.equal(useProtoStore.getState().activePageId,'customer-detail');
  } finally {act(() => renderer!.unmount());}
});

test('requirement pins use both page and component identities, never show or toggle another page’s notes', () => {
  const payload = fixture();
  payload.stateSnapshot.stickyNotes[1].targetWidgetId = 'customer-table';
  loadProjectFromBinaryPayload(payload);
  useProtoStore.setState({showAllComponentPins:true,activePopoverWidgetId:'customer-table'});
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {renderer=TestRenderer.create(React.createElement(ComponentStickyPin,{widgetId:'customer-table',pageId:'customer-list',widgetTitle:'客户表'}));});
  try {
    assert.ok(text(renderer!).includes('客户名称必须显示完整'));
    assert.ok(!text(renderer!).includes('详情需求记录'));
    act(() => renderer!.root.findByProps({title:'点击切换需求启用/停用状态（不代表已实现）'}).props.onClick());
    assert.equal(useProtoStore.getState().stickyNotes.find(n=>n.id==='note-list')!.active,false);
    assert.equal(useProtoStore.getState().stickyNotes.find(n=>n.id==='note-detail')!.active,false);
  } finally {act(() => renderer!.unmount());}
});

test('audit repair waits for a validated real change; status-only responses and transport failures leave the issue open', async () => {
  const payload = fixture(); payload.stateSnapshot.closedLoopIssues = [issue(), {...issue(),id:'unrelated',pageId:'customer-detail',targetWidgetId:'detail-table'}];
  loadProjectFromBinaryPayload(payload);
  const reply = deferred<{text:string;operations:HermesOperation[]}>(), started = deferred<void>();
  mockHermes(async input => {assert.match(input.prompt,/option-full/); started.resolve(); return reply.promise;});
  let renderer: TestRenderer.ReactTestRenderer, task!: Promise<void>;
  act(() => {renderer = TestRenderer.create(React.createElement(ClosedLoopAuditView));});
  const before = captureProjectPayload().stateSnapshot;
  try {
    await act(async () => {task=button(renderer!, '应用所选方案并修复').props.onClick(); await started.promise;});
    assert.deepEqual(captureProjectPayload().stateSnapshot, before);
    assert.equal(button(renderer!, 'Hermes 执行中').props.disabled, true);
    await act(async () => {reply.resolve({text:'只改状态',operations:[{tool:'protoflow_run_closed_loop_audit',args:{issues:[{...issue(),status:'resolved'}]}}]});await task;});
    assert.ok(text(renderer!).includes('不能标记已解决'));
    assert.deepEqual(captureProjectPayload().stateSnapshot, before);
    mockHermes(async () => {throw new Error('连接失败');});
    await act(async () => {await button(renderer!, '应用所选方案并修复').props.onClick();});
    assert.ok(text(renderer!).includes('连接失败'));
    assert.deepEqual(captureProjectPayload().stateSnapshot, before);
    mockHermes(async () => ({text:'已修改客户列标题',operations:[
      {tool:'protoflow_apply_tsx_patch',args:{pageId:'customer-list',source:mainSource.replace("title:'客户名称'","title:'完整客户名称'")}},
      {tool:'protoflow_run_closed_loop_audit',args:{issues:[{...issue(),status:'resolved',resolvedByOptionId:'option-full'}]}},
    ]}));
    await act(async () => {await button(renderer!, '应用所选方案并修复').props.onClick();});
    assert.match(usePageStore.getState().pageSources['customer-list'],/完整客户名称/);
    assert.equal(useProtoStore.getState().closedLoopIssues.find(i=>i.id===issue().id)!.status,'resolved');
    assert.deepEqual(useProtoStore.getState().closedLoopIssues.find(i=>i.id==='unrelated'),before.closedLoopIssues[1]);
    assert.ok(text(renderer!).includes('已修改客户列标题'));
  } finally {act(() => renderer!.unmount());}
});

test('audit transactions preserve other pages and reject out-of-scope, redirected and no-op repair results', () => {
  const payload = fixture();
  // A historical broken reference outside this scan must remain untouched.
  const other = {...issue(),id:'other-page',pageId:'customer-detail',targetWidgetId:'deleted-widget'};
  payload.stateSnapshot.closedLoopIssues = [issue(), other];
  const scope = {pageId:'customer-list',selectedPfId:null,audit:{kind:'scan' as const,scope:'page' as const,pageId:'customer-list'}};
  const audit = (issues: ClosedLoopAuditIssue[]): HermesOperation => ({tool:'protoflow_run_closed_loop_audit',args:{issues}});
  assert.deepEqual(prepareProjectChanges(payload,[audit([])],scope).next.stateSnapshot.closedLoopIssues,[other]);
  assert.deepEqual(prepareProjectChanges(payload,[audit([])],{...scope,audit:{kind:'scan',scope:'project'}}).next.stateSnapshot.closedLoopIssues,[]);
  assert.throws(()=>prepareProjectChanges(payload,[audit([other])],scope),/范围以外/);
  assert.throws(()=>prepareProjectChanges(payload,[audit([]),audit([])],scope),/一份实际巡检结果/);
  const patch: HermesOperation = {tool:'protoflow_apply_tsx_patch',args:{pageId:'customer-list',source:mainSource}};
  assert.throws(()=>prepareProjectChanges(payload,[patch,audit([])],scope),/巡检只允许/);
  const repair = {...scope,audit:{kind:'repair' as const,issueId:issue().id}};
  assert.throws(()=>prepareProjectChanges(payload,[patch,audit([{...issue(),status:'resolved'}])],repair),/不能标记已解决/);
  assert.throws(()=>prepareProjectChanges(payload,[audit([{...issue(),pageId:'customer-detail',targetWidgetId:'detail-table'}])],repair),/不能更换/);
  assert.throws(()=>prepareProjectChanges(payload,[audit([{...issue(),id:'new-id'}])],repair),/原始 ID/);
  assert.throws(()=>prepareProjectChanges(payload,[patch],repair),/实际巡检结果/);
  assert.deepEqual(payload.stateSnapshot.closedLoopIssues,[issue(),other]);
});

test('audit buttons send distinct project and current-page scan scopes and reject missing model audit results', async () => {
  const payload=fixture(); payload.stateSnapshot.closedLoopIssues=[issue()]; loadProjectFromBinaryPayload(payload);
  const prompts: string[]=[];
  mockHermes(async input => {prompts.push(input.prompt);return {text:'扫描完成',operations:[{tool:'protoflow_run_closed_loop_audit',args:{issues:[]}}]};});
  let renderer: TestRenderer.ReactTestRenderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(ClosedLoopAuditView));});
  try {
    act(()=>button(renderer!,'当前页面').props.onClick());
    await act(async()=>{await button(renderer!,'运行 Hermes 巡检').props.onClick();});
    assert.match(prompts[0],/仅页面 customer-list/);
    act(()=>button(renderer!,'全部项目记录').props.onClick());
    await act(async()=>{await button(renderer!,'运行 Hermes 巡检').props.onClick();});
    assert.match(prompts[1],/当前项目全部页面/);
    act(()=>useProtoStore.setState({closedLoopIssues:[issue()]}));
    mockHermes(async()=>({text:'口头宣称通过',operations:[]}));
    await act(async()=>{await button(renderer!,'运行 Hermes 巡检').props.onClick();});
    assert.ok(text(renderer!).includes('Hermes 未返回巡检结果'));
    assert.deepEqual(useProtoStore.getState().closedLoopIssues,[issue()]);
  } finally {act(()=>renderer!.unmount());}
});

test('audit target navigation uses exact table IDs and pfIds and blocks unavailable pages', () => {
  const payload=fixture();
  payload.stateSnapshot.dbTables=[{...structuredClone(table),id:'wrong-id',tableName:'exact_table_id'}, {...structuredClone(table),id:'exact_table_id'}];
  payload.stateSnapshot.closedLoopIssues=[{...issue(),targetTableId:'exact_table_id'}];
  payload.stateSnapshot.tableRows={};
  payload.stateSnapshot.pageSources=Object.fromEntries(Object.entries(payload.stateSnapshot.pageSources).map(([id,source])=>[id,source.replaceAll('entity-customers','exact_table_id')]));
  loadProjectFromBinaryPayload(payload);
  let renderer: TestRenderer.ReactTestRenderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(ClosedLoopAuditView));});
  try {
    act(()=>button(renderer!,'定位表 physical_customers').props.onClick());
    assert.equal(useProtoStore.getState().selectedTableId,'exact_table_id');
    for(const invalidWidgetId of ['Table','props-only-id']) {
      act(()=>{
        usePageStore.setState({pageSources:{...usePageStore.getState().pageSources,'customer-list':mainSource.replace('pfId="customer-table"','pfId="customer-table" id="props-only-id"')}});
        useProtoStore.setState({closedLoopIssues:[{...issue(),targetWidgetId:invalidWidgetId}]});
      });
      assert.equal(button(renderer!,'关联组件已不可用').props.disabled,true);
    }
    act(()=>useProtoStore.setState({closedLoopIssues:[{...issue(),targetTableId:'physical_customers'}]}));
    assert.equal(button(renderer!,'关联表已不可用').props.disabled,true);
    act(()=>usePageStore.setState({sitemapBase:[{id:'folder-archived',title:'归档',type:'folder',deprecated:true,children:[]}],designerPages:usePageStore.getState().designerPages.map(p=>({...p,folderId:'folder-archived'}))}));
    assert.equal(button(renderer!,'关联组件已不可用').props.disabled,true);
    act(()=>button(renderer!,'关联组件已不可用').props.onClick());
    assert.equal(useProtoStore.getState().activePopoverWidgetId,null);
  } finally {act(()=>renderer!.unmount());}
});

function menuFixture() {
  const payload=fixture();
  payload.stateSnapshot.sitemapBase=[{id:'folder-a',title:'原目录',type:'folder',children:[{id:'menu-list',type:'page',pageId:'customer-list',title:'客户查询'}]},{id:'folder-b',title:'新目录',type:'folder',children:[]}];
  payload.stateSnapshot.designerFolders=[{id:'folder-detail',title:'详情目录',parentFolderId:null}];
  payload.stateSnapshot.designerPages=[{pageId:'customer-detail',title:'客户详情',folderId:'folder-detail'}];
  return payload;
}

test('SPEC and open file diffs follow directory moves and folder edits; download captures fresh state at click time', async () => {
  loadProjectFromBinaryPayload(menuFixture()); useProtoStore.setState({isBundleModalOpen:true});
  let inspector: TestRenderer.ReactTestRenderer, files: TestRenderer.ReactTestRenderer, blob: Blob;
  const originalCreate=URL.createObjectURL, originalRevoke=URL.revokeObjectURL, originalDocument=globalThis.document;
  URL.createObjectURL=value=>{blob=value as Blob;return 'blob:test';}; URL.revokeObjectURL=()=>{};
  globalThis.document={createElement:()=>({click(){}})} as any;
  act(()=>{inspector=TestRenderer.create(React.createElement(InspectorSidebar));files=TestRenderer.create(React.createElement(DesktopBundleModal));});
  try {
    act(()=>{button(inspector!,'工程规格').props.onClick();button(files!,'本次查看期间').props.onClick();});
    const savedHandler=files!.root.findAllByType('button').find(b=>b.props.onClick?.name==='handleDownloadBinaryBundle')!.props.onClick;
    assert.ok(text(inspector!).includes('原目录 / 客户查询'));
    act(()=>usePageStore.getState().moveSitemapItem({kind:'page',id:'customer-list'},'folder-b','actual-project'));
    assert.ok(text(inspector!).includes('新目录 / 客户查询'));
    assert.ok(!text(inspector!).includes('原目录 / 客户查询'));
    assert.ok(text(files!).includes('pages/sitemap-overrides.json'));
    act(()=>usePageStore.setState({designerFolders:[{id:'folder-detail',title:'修改后的详情目录',parentFolderId:null}]}));
    assert.ok(text(inspector!).includes('修改后的详情目录 / 客户详情'));
    act(()=>usePageStore.setState({sitemapBase:usePageStore.getState().sitemapBase.map(f=>f.id==='folder-b'?{...f,title:'再次改名'}:f)}));
    assert.ok(text(inspector!).includes('再次改名 / 客户查询'));
    assert.ok(text(files!).includes('pages/sitemap-base.json'));
    act(()=>useProtoStore.setState({draftAcceptanceHeader:{...useProtoStore.getState().draftAcceptanceHeader,remark:'最新草稿'}}));
    await act(async()=>savedHandler());
    const saved=decodePflowBinary(await blob!.arrayBuffer());
    assert.deepEqual(saved.stateSnapshot.sitemapOverrides,usePageStore.getState().sitemapOverrides);
    assert.deepEqual(saved.stateSnapshot.sitemapBase,usePageStore.getState().sitemapBase);
    assert.equal(saved.stateSnapshot.draftAcceptanceHeader.remark,'最新草稿');
  } finally {act(()=>{inspector!.unmount();files!.unmount();});URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;globalThis.document=originalDocument;}
});

test('browser directory export writes one frozen source/archive snapshot and distinguishes cancellation from disk errors', async () => {
  loadProjectFromBinaryPayload(fixture());useProtoStore.setState({isBundleModalOpen:true});
  const written=new Map<string,string|Uint8Array>();
  const directory=(prefix=''):any=>({name:'picked',getDirectoryHandle:async(name:string)=>directory(prefix+name+'/'),getFileHandle:async(name:string)=>({createWritable:async()=>({write:async(value:string|Uint8Array)=>{written.set(prefix+name,value);},close:async()=>{}})})});
  const picker=deferred<any>();(window as any).showDirectoryPicker=()=>picker.promise;
  let renderer: TestRenderer.ReactTestRenderer, task!:Promise<void>;
  act(()=>{renderer=TestRenderer.create(React.createElement(DesktopBundleModal));});
  try {
    act(()=>{task=button(renderer!,'导出源码目录').props.onClick();});
    act(()=>usePageStore.getState().setPageSource('customer-list',mainSource.replace('客户查询','期间修改')));
    await act(async()=>{picker.resolve(directory());await task;});
    assert.equal(written.get('pages/customer-list.page.tsx'),mainSource);
    const archive=[...written.values()].find(v=>v instanceof Uint8Array) as Uint8Array;
    assert.equal(decodePflowBinary(archive).stateSnapshot.pageSources['customer-list'],mainSource);
    assert.ok(text(renderer!).includes('源码与工程文件已导出'));
    (window as any).showDirectoryPicker=async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'});};
    await act(async()=>{await button(renderer!,'导出源码目录').props.onClick();});
    assert.ok(text(renderer!).includes('已取消目录导出'));
    assert.ok(!text(renderer!).includes('源码与工程文件已导出'));
    const failing=directory();failing.getDirectoryHandle=async()=>{throw new Error('浏览器磁盘写入失败');};
    (window as any).showDirectoryPicker=async()=>failing;
    await act(async()=>{await button(renderer!,'导出源码目录').props.onClick();});
    assert.ok(text(renderer!).includes('浏览器磁盘写入失败'));
    assert.equal(renderer!.root.findAllByProps({role:'alert'}).length,1);
    assert.ok(!text(renderer!).includes('源码与工程文件已导出'));
  } finally {act(()=>renderer!.unmount());}
});

test('knowledge answers, drafts, errors and late responses stay isolated by exact page and project identity', async () => {
  loadProjectFromBinaryPayload(fixture());
  const late=deferred<{text:string;operations:HermesOperation[]}>(), started=deferred<void>();
  let calls=0;
  mockHermes(async input=>{
    assert.equal(input.readOnly,true);
    if(++calls===1)return {text:'仅属于查询页的回答',operations:[]};
    if(calls===2)throw new Error('仅属于详情页的错误');
    started.resolve();return late.promise;
  });
  let renderer:TestRenderer.ReactTestRenderer, task!:Promise<void>;
  act(()=>{renderer=TestRenderer.create(React.createElement(KnowledgeImpactView));});
  const ask=async(question:string)=>{
    act(()=>renderer!.root.findByType('textarea').props.onChange({target:{value:question}}));
    await act(async()=>{await button(renderer!,'用当前工程上下文询问 Hermes').props.onClick();});
  };
  try {
    await ask('查询页问题');assert.ok(text(renderer!).includes('仅属于查询页的回答'));
    act(()=>useProtoStore.getState().setActivePage('customer-detail'));
    assert.ok(!text(renderer!).includes('仅属于查询页的回答'));
    assert.equal(renderer!.root.findByType('textarea').props.value,'');
    await ask('详情页问题');assert.ok(text(renderer!).includes('仅属于详情页的错误'));
    act(()=>useProtoStore.getState().setActivePage('customer-list'));
    assert.ok(!text(renderer!).includes('仅属于详情页的错误'));
    act(()=>renderer!.root.findByType('textarea').props.onChange({target:{value:'等待旧回答'}}));
    await act(async()=>{task=button(renderer!,'用当前工程上下文询问 Hermes').props.onClick();await started.promise;});
    act(()=>useProtoStore.getState().setActivePage('customer-detail'));
    await act(async()=>{late.resolve({text:'不应串入的迟到回答',operations:[]});await task;});
    assert.ok(!text(renderer!).includes('不应串入的迟到回答'));
    act(()=>renderer!.root.findByType('textarea').props.onChange({target:{value:'旧工程草稿'}}));
    act(()=>loadProjectFromBinaryPayload(fixture('another-project')));
    assert.equal(renderer!.root.findByType('textarea').props.value,'');
    assert.ok(!text(renderer!).includes('旧工程草稿'));
  } finally {act(()=>renderer!.unmount());}
});

test('cross-module and knowledge page links cannot navigate to archived or source-less pages', () => {
  const payload=fixture();
  payload.stateSnapshot.sitemapBase=[{id:'folder-archived',title:'归档',type:'folder',deprecated:true,children:[]}];
  payload.stateSnapshot.designerPages[1].folderId='folder-archived';
  payload.stateSnapshot.sitemapBase.push({id:'folder-pending',title:'待实现',type:'folder',children:[{id:'menu-source-less',type:'page',pageId:'source-less',title:'缺失源码页面'}]});
  payload.stateSnapshot.dbTables[0].sharedByMenus.push({pageId:'source-less',menuTitle:'缺失源码页面',accessMode:'READ 查询',fieldMappingNote:'关联记录'});
  loadProjectFromBinaryPayload(payload);
  for(const Component of [CrossModuleFlowView,KnowledgeImpactView]) {
    let renderer:TestRenderer.ReactTestRenderer;
    act(()=>{renderer=TestRenderer.create(React.createElement(Component));});
    try {
      for(const label of ['客户详情','缺失源码页面']) {
        const unavailable=button(renderer!,label);
        assert.ok(unavailable,label);assert.equal(unavailable.props.disabled,true);
        act(()=>unavailable.props.onClick());
        assert.equal(useProtoStore.getState().activePageId,'customer-list');
      }
      if(Component===KnowledgeImpactView) {
        const select=renderer!.root.findByProps({'aria-label':'分析页面'});
        assert.equal(select.findAllByType('option').find(o=>o.props.value==='customer-detail')!.props.disabled,true);
        act(()=>select.props.onChange({target:{value:'source-less'}}));
        assert.equal(useProtoStore.getState().activePageId,'customer-list');
      }
    } finally {act(()=>renderer!.unmount());}
  }
});

test('community starter templates saas_inventory and crm_analytics validate cleanly with no domain-sensitive residue', () => {
  for (const tpl of ['saas_inventory', 'crm_analytics', 'mobile_starter', 'blank_project'] as const) {
    const payload = createProjectPayload({
      projectId: `tpl-${tpl}`,
      projectName: `Starter ${tpl}`,
      storageDir: '/tmp/starter',
      fileName: `${tpl}.pflow`,
      templateId: tpl,
      createdAt: '2026-11-17',
      updatedAt: '2026-11-17',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    const serialized = JSON.stringify(payload);
    for (const forbidden of ['海关', '口岸', '缉私', '报关', '/Users/']) {
      assert.ok(!serialized.includes(forbidden), `${tpl} must not include ${forbidden}`);
    }
    if (tpl === 'crm_analytics') {
      assert.equal(payload.stateSnapshot.dbTables.length, 5);
      assert.equal(Object.keys(payload.stateSnapshot.pageSources).length, 6);
      assert.equal(payload.stateSnapshot.stickyNotes.length, 9);
      assert.equal(payload.stateSnapshot.mindmaps.nodes.length, 1);
      assert.equal(payload.stateSnapshot.projectNotes?.nodes.length, 3);
      assert.ok(payload.stateSnapshot.pageSources['crm-dashboard'].includes('LineChart'));
      assert.ok(payload.stateSnapshot.pageSources['crm-dashboard'].includes('BarChart'));

      // Every page (PC + Mobile) must satisfy strict pageContractErrors with 0 errors
      for (const [pageId, src] of Object.entries(payload.stateSnapshot.pageSources)) {
        const issues = pageContractErrors(src, payload.stateSnapshot.dbTables, {
          tableRows: payload.stateSnapshot.tableRows,
        });
        assert.deepEqual(issues, [], `crm_analytics page ${pageId} contract errors: ${issues.join('; ')}`);
      }

      // Every sticky note must bind to an exact existing pfId on its page
      for (const sn of payload.stateSnapshot.stickyNotes) {
        const parsed = parsePageSource(payload.stateSnapshot.pageSources[sn.pageId]);
        assert.ok(parsed.doc, `failed to parse ${sn.pageId}`);
        const pfIds = new Set<string>();
        walk(parsed.doc.root, (node) => pfIds.add(node.pfId));
        assert.ok(
          pfIds.has(sn.targetWidgetId),
          `sticky note ${sn.id} targetWidgetId ${sn.targetWidgetId} missing on page ${sn.pageId}`
        );
      }

      // ER model must pass reviewDatabaseDesign with 0 tableErrors and 0 relationErrors
      const dbReview = reviewDatabaseDesign(payload.stateSnapshot.dbTables);
      assert.deepEqual(dbReview.tableErrors, []);
      assert.deepEqual(dbReview.relationErrors, []);

      // Must publish cleanly as a Format V5 snapshot with uniqueConstraints & shareable PRD notes
      const prevDOMParser = globalThis.DOMParser;
      globalThis.DOMParser = new JSDOM('').window.DOMParser;
      try {
        loadProjectFromBinaryPayload(payload);
        const published = createPublishedSnapshot('crm-dashboard');
        assert.equal(published.formatVersion, 5);
        assert.equal(published.notes?.length, 2);
      } finally {
        globalThis.DOMParser = prevDOMParser;
      }
    }
  }
});
