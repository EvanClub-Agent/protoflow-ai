import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareProjectChanges } from '../src/services/hermesProject';
import { PageClickTargets } from '../src/proto/axure/interactions';
import { findNode } from '../src/proto/dsl/tree';
import { type ProtoNode } from '../src/proto/types';
import { importAxureRp } from '../src/proto/axure/import';
import { createAxureProject } from '../src/services/axureProject';
import { decodePflowBinary, encodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { loadProjectFromBinaryPayload, normalizeProjectPayload, openRecentProject } from '../src/services/projectStorage';
import { parsePageSource } from '../src/proto/dsl/parser';
import { validateMaterialDoc } from '../src/proto/registry/materialContract';
import { usePageStore } from '../src/proto/store/usePageStore';
import { AntdFieldControl } from '../src/proto/registry/AntdFieldControl';
import { isNode } from '../src/proto/types';

// Independently authored RP11 binary fixture: two identically titled pages,
// one nested below the other, a plain page link, a conditional link and a panel.
const fixture = () => readFileSync('tests/fixtures/axure11-navigation.rp');
test('RP11 imports native IDs, nesting, literal text and only unconditional page links into a reopenable project', async () => {
  const imported = await importAxureRp(fixture());
  assert.equal(imported.version, 11);
  const [a, b] = imported.designerPages;
  assert.equal(a.title, b.title);
  assert.notEqual(a.pageId, b.pageId);
  assert.notEqual(a.folderId, b.folderId);
  assert.equal(imported.designerFolders.find(f => f.id === b.folderId)?.parentFolderId, a.folderId);
  const doc = parsePageSource(imported.pageSources[a.pageId]).doc!;
  assert.deepEqual(validateMaterialDoc(doc), []);
  const [link, conditional, panel] = doc.root.children.filter(isNode)[0].children.filter(isNode);
  assert.equal(link.type, 'Button');
  assert.deepEqual(link.children, [{ kind: 'text', value: '查看 <详情> & {{code}}' }]);
  assert.equal((link.props.layoutFrame as Record<string, unknown>).x, 12);
  assert.deepEqual(link.props.onClick, { $kind: 'actions', calls: [{ name: 'navigate', args: [b.pageId] }] });
  assert.equal(conditional.props.onClick, undefined);
  assert.equal(panel.props.kind, 'placeholder');
  assert.equal(imported.report[0].links, 1);
  assert.match(imported.report[0].warnings.join(' '), /条件.*DynamicPanel/);
  const project = createAxureProject('原型.RP', '/projects', imported);
  const reopened = normalizeProjectPayload(decodePflowBinary(encodePflowBinary(project)));
  assert.equal(reopened.stateSnapshot.activePageId, a.pageId);
  assert.deepEqual(reopened.stateSnapshot.pageSources, imported.pageSources);
  assert.notEqual(createAxureProject('原型.RP', '/projects', imported).meta.storageDir, project.meta.storageDir);
});

test('RP9 imports pages with reused panel state GUIDs, selected options, rich text and a page link', async () => {
  // This independently authored fixture has the same state GUID under two
  // different page packages, as found in native RP 9.0.0.3740 documents.
  const imported = await importAxureRp(readFileSync('tests/fixtures/axure9-scoped-packages.rp'));
  assert.equal(imported.version, 9);
  assert.deepEqual(imported.designerPages.map(p => p.title), ['申请', '预览']);
  const [form, preview] = imported.designerPages;
  assert.equal(preview.pageId, 'rp-page-7e7398aa45caf9a8c7b81b7d2cd46b02');
  const doc = parsePageSource(imported.pageSources[form.pageId]).doc!;
  assert.deepEqual(validateMaterialDoc(doc), []);
  const [select, link] = doc.root.children.filter(isNode)[0].children.filter(isNode);
  assert.equal(select.type, 'Select');
  assert.deepEqual(select.props.options, ['普通', '优先']);
  assert.equal(select.props.initialValue, '优先');
  assert.deepEqual(link.children, [{ kind: 'text', value: '查看详情' }]);
  assert.deepEqual(link.props.layoutFrame, { x:10, y:30, width:80, height:24 });
  assert.deepEqual(link.props.onClick, { $kind: 'actions', calls: [{ name: 'navigate', args: [preview.pageId] }] });
  assert.deepEqual(imported.report[0], { title: '申请', widgets: 2, links: 1, clicks: 1, warnings: [] });
});

test('RP import rejects renamed, unsupported, truncated and corrupt files', async () => {
  await assert.rejects(importAxureRp(new Uint8Array([80, 75])), /二进制源文件/);
  const version = fixture(); version[2] = 10;
  await assert.rejects(importAxureRp(version), /版本为 10/);
  await assert.rejects(importAxureRp(fixture().subarray(0, 3)), /截断/);
  await assert.rejects(importAxureRp(fixture().subarray(0, 80)), /截断/);
  const corrupt = fixture(); corrupt[corrupt.length - 8] ^= 0xff;
  await assert.rejects(importAxureRp(corrupt));
});

test('switching to a newly imported RP project preserves edits in the previous browser session project', async () => {
  const imported = await importAxureRp(fixture());
  const first = createAxureProject('first.rp', '/projects', imported);
  const next = createAxureProject('next.rp', '/projects', imported);
  const id = first.stateSnapshot.activePageId;
  loadProjectFromBinaryPayload(first);
  const edited = first.stateSnapshot.pageSources[id].replace('查看 <详情>', '编辑 <详情>');
  usePageStore.getState().setPageSource(id, edited);
  loadProjectFromBinaryPayload(next);
  assert.notEqual(usePageStore.getState().pageSources[id], edited);
  await openRecentProject(first.meta.projectId);
  assert.equal(usePageStore.getState().pageSources[id], edited);
});

test('RP9 restores nested coordinates, hidden groups, cell order, master instances and both panel states', async () => {
  const imported = await importAxureRp(readFileSync('tests/fixtures/axure9-editable-layout.rp'));
  const source = imported.pageSources[imported.designerPages[0].pageId];
  const doc = parsePageSource(source).doc!;
  assert.deepEqual(validateMaterialDoc(doc), []);
  const [group, table, master, copy, panel] = doc.root.children.filter(isNode)[0].children.filter(isNode);
  assert.equal(group.type, 'PositionedGroup');
  assert.deepEqual(group.props, { x:30, y:45, width:110, height:26, hidden:true });
  const input = group.children.filter(isNode)[0];
  assert.equal(input.type, 'Input');
  assert.equal(input.props.initialValue, '{{params.literal}}');
  assert.deepEqual(input.props.layoutFrame, { x:0, y:0, width:110, height:26 });
  assert.equal(table.type, 'StaticTable');
  assert.deepEqual(table.props.columnWidths, [70,100]);
  assert.deepEqual(table.props.rowHeights, [32,30]);
  const cells = table.children.filter(isNode);
  assert.deepEqual(cells.map(c => c.props.text), ['单号','仓库','001','华东']);
  assert.equal(cells.every(c => c.type === 'StaticTableCell'), true);
  assert.equal(master.children.filter(isNode)[0].props.initialValue, '母版名称');
  assert.notEqual(master.children.filter(isNode)[0].pfId, copy.children.filter(isNode)[0].pfId);
  assert.equal(panel.type, 'DynamicPanel');
  assert.equal(panel.props.activeState, 1);
  assert.deepEqual(panel.children.filter(isNode).map(s => [s.props.label, s.children.filter(isNode)[0].props.initialValue]), [['视图1','状态1'],['视图2','状态2']]);
  assert.deepEqual(imported.report[0].warnings, []);
});

test('RP clicks resolve forward targets in their master instance and reject partially resolved action chains', () => {
  const node = (type: string, pfId: string, children: ProtoNode[] = []): ProtoNode => ({kind:'node',type,pfId,props:{},children});
  const targets = new PageClickTargets();
  const owners = ['a','b'].map(scope => {
    const trigger = node('Button',scope);
    targets.register(scope,'trigger',trigger,[{kind:'hide', guid:'tip'}, {kind:'state', guid:'panel', stateGuid:'two', show:true}]);
    targets.register(scope,'tip',node('Text','tip-' + scope));
    targets.register(scope,'panel',node('DynamicPanel','rp-widget-' + scope,[
      node('PanelState','rp-state-' + scope + '-one'), node('PanelState','rp-state-' + scope + '-two'),
    ]));
    return trigger;
  });
  const ambiguous = node('Button','ambiguous');
  targets.register('c','trigger',ambiguous,[{kind:'navigate',guid:'other-page'}, {kind:'hide',guid:'duplicate'}]);
  targets.register('c','duplicate',node('Text','c1'));
  targets.register('c','duplicate',node('Text','c2'));
  const warnings: string[] = [];
  assert.deepEqual(targets.finish(w => warnings.push(w)),{links:0, clicks:2});
  for (const owner of owners) assert.deepEqual(owner.props.onClick, {$kind:'actions', calls:[
    {name:'hide',args:['tip-' + owner.pfId]}, {name:'switchTab',args:['rp-widget-' + owner.pfId,1]}, {name:'show',args:['rp-widget-' + owner.pfId]},
  ]});
  assert.equal(ambiguous.props.onClick,undefined);
  assert.deepEqual(warnings,['点击目标或面板状态无法唯一定位']);
});

test('Project AI inspects saved RP evidence, stages native replacements and a bound schema, and reopens the reviewed copy', async () => {
  const imported = await importAxureRp(readFileSync('tests/fixtures/axure9-editable-layout.rp'));
  const base = createAxureProject('测试.rp','/projects',imported);
  const { stateSnapshot:s } = base;
  const { pageId, folderId, title } = imported.designerPages[0];
  const original = s.pageSources[pageId];
  const {callTool, atomicWrite} = require(process.cwd() + '/electron/protoflow-mcp.cjs');
  const dir = mkdtempSync(join(tmpdir(),'alex-axure-review-'));
  const file = join(dir,'context.json');
  try {
    atomicWrite(file,{kind:'project', workflowPhase:'conversation', active:true, projectId:base.meta.projectId, runId:'rp-test',
      operations:[], snapshot:{...s, projectMode:base.meta.projectMode}});
    const call = (name:string, args:Record<string,unknown>) => callTool(file,name,args);
    const inspect = (args:Record<string,unknown>) => call('protoflow_inspect_page',{pageId,view:'axure',...args});
    assert.equal(inspect({limit:1}).nextOffset,1);
    const evidence = inspect({limit:60}).records as Record<string,any>[];
    const table = evidence.find(n=>n.type === 'StaticTable')!;
    assert.deepEqual(table.grid.firstRow.map((v: {text:string}) => v.text), ['单号','仓库']);
    assert.deepEqual(table.grid.sampleRow,['001','华东']);
    assert.ok(evidence.some(n=>n.type === 'Input' && n.hidden));
    assert.ok(evidence.some(n=>n.inactiveState));
    assert.equal(inspect({selectedPfId:table.pfId}).records.length,5);
    assert.throws(()=>inspect({selectedPfId:'not-a-widget'}),/pfId/);
    const schema = {id:'inventory', tableName:'t_inventory', cnName:'库存单',domain:'库存', description:'来源于原型表头',sharedByMenus:[],
      modeling:{entity:'库存单',grain:'一张单据一行',reason:'库存单列表按单据展示仓库'},
      columns:[{id:'row-id',name:'row_id',dataType:'BIGINT',nullable:false,isPrimaryKey:true,comment:'优化版新增的内部行标识'}, {id:'doc-number',name:'document_number',dataType:'TEXT',nullable:true,comment:'单号'}, {id:'warehouse',name:'warehouse',dataType:'TEXT',nullable:true,comment:'仓库'}]};
    call('protoflow_get_project',{});
    call('protoflow_upsert_db_table',{table:schema});
    const optimize = (targetPfId:string,tsx:string) => call('protoflow_optimize_axure_block',{pageId,targetPfId,tsx});
    const grid = (tableId:string) => `<Table pfId="${table.pfId}" table="${tableId}" columns={[{title:"单号",dataIndex:"document_number"},{title:"仓库",dataIndex:"warehouse"}]} />`;
    assert.throws(()=>optimize(table.pfId,grid('t_inventory')),/未知表/);
    const result = optimize(table.pfId,grid('inventory'));
    const workingCopy = call('protoflow_inspect_page',{pageId:result.optimizedPageId,view:'axure',selectedPfId:table.pfId});
    assert.equal(workingCopy.sourcePageId,pageId);
    assert.equal(workingCopy.records[0].table,schema.id);
    const input = evidence.find(n=>n.type === 'Input' && n.hidden)!;
    assert.equal(optimize(input.pfId,`<Input pfId="${input.pfId}" placeholder="单号" />`).optimizedPageId,result.optimizedPageId);
    const {operations} = JSON.parse(readFileSync(file,'utf8'));
    assert.deepEqual(operations.map((op:{tool:string}) => op.tool), ['protoflow_upsert_db_table','protoflow_apply_tsx_patch']);
    const candidate = prepareProjectChanges(base,operations,undefined,undefined,true).next;
    const saved = normalizeProjectPayload(decodePflowBinary(encodePflowBinary(candidate))).stateSnapshot;
    assert.deepEqual(base.stateSnapshot.dbTables,[]);
    assert.equal(saved.pageSources[pageId],original);
    assert.equal(saved.designerPages.filter(p=>p.pageId === result.optimizedPageId).length,1);
    assert.equal(saved.designerPages.at(-1)?.folderId,folderId);
    assert.equal(saved.designerPages.at(-1)?.title,title + '（优化版）');
    const root = parsePageSource(saved.pageSources[result.optimizedPageId]).doc!.root;
    const optimizedGrid = findNode(root,table.pfId)!;
    assert.equal(optimizedGrid.type,'Table');
    assert.equal(optimizedGrid.props.table,schema.id);
    assert.deepEqual(optimizedGrid.props.layoutFrame,{...table.frame,literalContent:false});
    assert.equal(findNode(root,input.pfId)?.props.placeholder,'单号');
    assert.deepEqual(saved.tableRows,{});
    assert.equal(saved.dbTables[0].columns.length,3);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('RP9 binary decodes the full ordered click on forward-referenced widgets and the exact panel state', async () => {
  const rp = await importAxureRp(readFileSync('tests/fixtures/axure9-panel-click.rp'));
  const [page, destination] = rp.designerPages;
  const doc = parsePageSource(rp.pageSources[page.pageId]).doc!;
  const [trigger,select,panel] = doc.root.children.filter(isNode)[0].children.filter(isNode);
  assert.deepEqual(panel.children.filter(isNode).map(s => s.props.label), ['浏览','确认']);
  assert.deepEqual([panel.props.pinX,panel.props.pinY,panel.props.pinInFront,panel.props.fitContent],['center','middle',true,true]);
  assert.deepEqual(trigger.props.onClick, {$kind:'actions', calls:[
    {name:'hide', args:[select.pfId]}, {name:'switchTab', args:[panel.pfId,1]}, {name:'show', args:[panel.pfId]},
    {name:'navigate', args:[destination.pageId]},
  ]});
  assert.deepEqual(rp.report[0],{title:'申请',widgets:3,links:1,clicks:1,warnings:[]});
});

test('RP migration scopes nested folders by ID, binds two pages to one table, and restores the exact reviewed source', async () => {
  const {describeChanges,revisionDigest} = await import('../src/services/projectChangeReview');
  const {compactRpReview,expandRpReview} = await import('../src/proto/axure/reviewSource');
  const imported = await importAxureRp(readFileSync('tests/fixtures/axure9-editable-layout.rp'));
  const base = createAxureProject('迁移.rp','/projects',imported), s = base.stateSnapshot;
  const [page] = s.designerPages;
  const branch = 'test-module', sub = 'test-sub', other = 'other-module';
  s.designerFolders.push({id:branch,title:'库存',parentFolderId:page.folderId},{id:sub,title:'查询',parentFolderId:branch},{id:other,title:'库存',parentFolderId:null});
  page.folderId = branch;
  function addCopy(hex:string,folderId:string) {
    const pageId = 'rp-page-'+hex;
    s.designerPages.push({...page,pageId,folderId});
    s.pageSources[pageId] = s.pageSources[page.pageId].replaceAll(page.pageId.slice(8),hex);
    return pageId;
  }
  const second = addCopy('1'.repeat(32),sub), excluded = addCopy('2'.repeat(32),other);
  const db = {id:'stock-id',tableName:'t_stock',cnName:'库存单',domain:'库存',description:'测试',sharedByMenus:[],
    modeling:{entity:'库存单',grain:'每张库存单一行',reason:'登记与查询共用库存单记录'},
    columns:[{id:'pk',name:'row_id',dataType:'BIGINT',nullable:false,isPrimaryKey:true,comment:'内部行标识'},
      {id:'document',name:'document_number',dataType:'TEXT',nullable:true,comment:'单号'},{id:'warehouse',name:'warehouse_name',dataType:'TEXT',nullable:true,comment:'仓库'}]};
  const {callTool,atomicWrite} = require(process.cwd()+'/electron/protoflow-mcp.cjs');
  const dir = mkdtempSync(join(tmpdir(),'alex-rp-module-')), file = join(dir,'state.json');
  try {
    const snapshot = {...s,projectMode:'desktop',axureMigrationScope:{kind:'folder',folderId:branch}};
    const context = {kind:'project',workflowPhase:'conversation',active:true,projectId:base.meta.projectId,runId:'migration',operations:[],snapshot};
    atomicWrite(file,{...context,readOnly:true});
    const call = (name:string,args:Record<string,unknown>={})=>callTool(file,name,args);
    const inventory = (args:Record<string,unknown>={}) => call('protoflow_inspect_axure_project',args);
    const first = inventory({limit:1});
    assert.equal(first.totalPages,2); assert.equal(first.nextOffset,1);
    assert.deepEqual(new Set([first.records[0].pageId,inventory({limit:1,offset:1}).records[0].pageId]),new Set([page.pageId,second]));
    assert.throws(()=>inventory({folderId:branch,pageId:second}),/一个/);
    assert.throws(()=>inventory({pageId:'missing'}),/没有可读取/);
    assert.throws(()=>call('protoflow_upsert_db_table',{table:db}),/read-only/);
    atomicWrite(file,context);
    const binder = (id:string,target:string,mappings:unknown,tableId=db.id) => call('protoflow_bind_axure_table',{pageId:id,targetPfId:target,tableId,mappings});
    const inspect = (id:string)=>call('protoflow_inspect_page',{pageId:id,view:'axure',limit:60}).records.find((n:any)=>n.type==='StaticTable');
    const grid = inspect(page.pageId);
    const mappings = grid.grid.firstRow.map((h:any,i:number)=>({headerPfId:h.pfId,role:'field',columnId:db.columns[i+1].id}));
    assert.throws(()=>binder(page.pageId,grid.pfId,mappings),/表目录/);
    call('protoflow_get_project');
    call('protoflow_upsert_db_table',{table:db});
    assert.throws(()=>call('protoflow_upsert_db_table',{table:{...db,columns:db.columns.slice(0,-1)}}),/只能补充/);
    assert.throws(()=>call('protoflow_upsert_db_column',{tableId:db.id,column:{...db.columns[1],name:'warehouse_id'}}),/只能补充/);
    assert.throws(()=>binder(excluded,grid.pfId,mappings),/超出/);
    assert.throws(()=>call('protoflow_apply_tsx_patch',{pageId:page.pageId,source:s.pageSources[page.pageId]}),/只允许/);
    assert.throws(()=>binder(page.pageId,grid.pfId,mappings.slice(1)),/全部/);
    assert.throws(()=>binder(page.pageId,grid.pfId,[mappings[0],mappings[0]]),/遗漏/);
    assert.throws(()=>binder(page.pageId,grid.pfId,[{...mappings[0],columnId:'document_number'},mappings[1]]),/columnId/);
    assert.throws(()=>binder(page.pageId,grid.pfId,mappings,'t_stock'),/tableId/);
    binder(page.pageId,grid.pfId,[...mappings].reverse());
    assert.equal(binder(page.pageId,grid.pfId,mappings).unchanged,true);
    const secondGrid = inspect(second);
    binder(second,secondGrid.pfId,secondGrid.grid.firstRow.map((h:any,i:number)=>({...mappings[i],headerPfId:h.pfId})));
    assert.equal(inventory().records.every((p:any)=>p.boundCount === 1 && p.bindings[0].tableId === db.id),true);
    const {operations} = JSON.parse(readFileSync(file,'utf8'));
    assert.equal(operations.length,3);
    const packed = await compactRpReview(s.pageSources,operations,revisionDigest);
    assert.ok(packed[1].args.rpSourcePatch);
    assert.deepEqual(await expandRpReview(s.pageSources,JSON.parse(JSON.stringify(packed)),revisionDigest),operations);
    const edited = {...s.pageSources,[page.pageId]:'changed'};
    await assert.rejects(expandRpReview(edited,packed,revisionDigest),/变更/);
    const candidate = prepareProjectChanges(base,operations,undefined,undefined,true).next;
    const review = describeChanges(s,candidate.stateSnapshot,operations);
    assert.equal(review.filter(item=>item.includes('原表头「单号」 → t_stock.document_number')).length,2);
    const saved = decodePflowBinary(encodePflowBinary(candidate)).stateSnapshot;
    assert.deepEqual(saved.dbTables,[db]);
    assert.deepEqual(saved.tableRows,{});
    for (const [id,source] of Object.entries(s.pageSources)) assert.equal(saved.pageSources[id],source);
    assert.equal(saved.designerPages.length,s.designerPages.length+2);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('Axure compatibility materials stay out of default Hermes component list, order after native materials, and preserve Textarea onClick + onChange', async () => {
  const { buildProtoFlowHermesSkillMarkdown } = await import('../src/store/useHermesStore');
  const { COMPONENTS, COMPONENT_MAP } = await import('../src/proto/registry/meta');
  const skill = buildProtoFlowHermesSkillMarkdown([], [], [], 'project', 'desktop');
  const componentsLine = skill.split('\n').find(line => line.startsWith('Components: ')) ?? '';
  assert.equal(componentsLine.includes('AxureCanvas'), false);
  assert.equal(componentsLine.includes('StaticTable'), false);
  assert.equal(COMPONENTS[0].name, 'Page');
  assert.deepEqual(COMPONENT_MAP.Textarea.events?.map(e => e.name), ['onChange', 'onClick']);

  const invalidLeafOutsideCanvas = parsePageSource('export default function Page(){return <Page pfId="p"><VectorShape pfId="v" width={96} height={30} /></Page>}').doc!;
  assert.ok(validateMaterialDoc(invalidLeafOutsideCanvas).some(i => i.path === 'parent' && i.pfId === 'v'));
  const validTextareaClick = parsePageSource('export default function Page(){return <Page pfId="p"><AxureCanvas pfId="c"><Textarea pfId="ta" layoutFrame={{x:0,y:0,width:120,height:60}} onClick={() => toast("ok")} /></AxureCanvas></Page>}').doc!;
  assert.deepEqual(validateMaterialDoc(validTextareaClick), []);
});

test('RP task draft helpers keep edited prompts without duplication, clean up on cancel, and inherit rpQuestionScope on text reply', async () => {
  const { applyRpTaskDraft, clearRpTaskDraft, resolveSubmittedRpMigration } = await import('../src/proto/axure/task');
  const scopeA = { kind: 'page' as const, pageId: 'rp-page-' + 'a'.repeat(32) };
  const scopeB = { kind: 'folder' as const, folderId: 'rp-folder-1' };

  let draft = applyRpTaskDraft({ text: '', rpTask: undefined }, scopeA, '库存登记', false);
  assert.ok(draft.text.includes('页面「库存登记」'));
  // User custom-edits the middle of the generated prompt, then switches scope to a folder:
  draft = { ...draft, text: draft.text.replace('先盘点来源页', '重点关注批次号，先盘点来源页') };
  const switched = applyRpTaskDraft(draft, scopeB, '仓储中心', false);
  assert.ok(switched.text.includes('目录「仓储中心」及子目录（rp-folder-1）'));
  assert.ok(switched.text.includes('重点关注批次号'));
  assert.equal(switched.text.split('范围内从 RP 导入的原型').length - 1, 1, 'must not duplicate preset block');
  assert.equal(clearRpTaskDraft(switched).text, '');

  // Completely custom prompt stays intact when switching scope or cancelling RP mode:
  const custom = applyRpTaskDraft({ ...switched, text: '只转换顶部查询区，保留底部说明' }, scopeA, '库存登记', true);
  assert.equal(custom.text, '只转换顶部查询区，保留底部说明');
  assert.equal(custom.rpTask?.readOnly, true);
  assert.equal(clearRpTaskDraft(custom).text, '只转换顶部查询区，保留底部说明');
  assert.equal(clearRpTaskDraft(custom).rpTask, undefined);

  assert.deepEqual(resolveSubmittedRpMigration(undefined, scopeA), { scope: scopeA, readOnly: false });
  assert.equal(resolveSubmittedRpMigration(undefined, undefined), undefined);
});

test('RP migration supports second-pass table re-binding, flow-reshaped copy inspection, cross-page optimized links, and readable review patches', async () => {
  const { revisionDigest } = await import('../src/services/projectChangeReview');
  const { compactRpReview, formatRpReviewArgs } = await import('../src/proto/axure/reviewSource');
  const imported = await importAxureRp(readFileSync('tests/fixtures/axure9-scoped-packages.rp'));
  const base = createAxureProject('跨页跳转.rp', '/projects', imported);
  const s = base.stateSnapshot;
  const [formPage, previewPage] = s.designerPages;
  // Ensure previewPage has a positioned widget on its imported AxureCanvas so it can be optimized too:
  const previewGuid = previewPage.pageId.slice('rp-page-'.length);
  s.pageSources[previewPage.pageId] = `export default function Page() {\n  return <Page pfId="rp-root-${previewGuid}" title="${previewPage.title}" bg="white"><AxureCanvas pfId="rp-canvas-${previewGuid}"><VectorShape pfId="rp-widget-preview-box" x={12} y={16} width={120} height={32} text="预览标题" /></AxureCanvas></Page>;\n}\n`;

  // Also add an editable StaticTable page (with a distinct GUID) to test re-binding and flow copy inspection:
  const layoutRp = await importAxureRp(readFileSync('tests/fixtures/axure9-editable-layout.rp'));
  const rawTablePage = layoutRp.designerPages[0];
  const tableHex = '3'.repeat(32);
  const tablePage = { ...rawTablePage, pageId: 'rp-page-' + tableHex, folderId: formPage.folderId };
  s.designerPages.push(tablePage);
  s.pageSources[tablePage.pageId] = layoutRp.pageSources[rawTablePage.pageId].replaceAll(rawTablePage.pageId.slice(8), tableHex);

  const db = {
    id: 'orders', tableName: 't_orders', cnName: '申请单', domain: '库存', description: '测试', sharedByMenus: [],
    modeling: { entity: '申请单', grain: '一单一行', reason: '测试二次绑表' },
    columns: [
      { id: 'pk', name: 'id', dataType: 'BIGINT', nullable: false, isPrimaryKey: true, comment: '主键' },
      { id: 'c1', name: 'doc_no', dataType: 'TEXT', nullable: true, comment: '单号' },
      { id: 'c2', name: 'warehouse', dataType: 'TEXT', nullable: true, comment: '仓库' },
    ],
  };

  const { callTool, atomicWrite } = require(process.cwd() + '/electron/protoflow-mcp.cjs');
  const dir = mkdtempSync(join(tmpdir(), 'alex-rp-retarget-'));
  const file = join(dir, 'context.json');
  try {
    atomicWrite(file, {
      kind: 'project', workflowPhase: 'conversation', active: true, projectId: base.meta.projectId, runId: 'run-1',
      operations: [], snapshot: { ...s, projectMode: 'desktop', axureMigrationScope: { kind: 'project' } },
    });
    const call = (name: string, args: Record<string, unknown> = {}) => callTool(file, name, args);
    call('protoflow_get_project');
    call('protoflow_upsert_db_table', { table: db });

    // Migrate formPage FIRST (before previewPage has an optimized copy), then previewPage SECOND:
    const formWidgets = call('protoflow_inspect_page', { pageId: formPage.pageId, view: 'axure', limit: 60 }).records;
    const selectCtrl = formWidgets.find((w: any) => w.type === 'Select')!;
    const optForm = call('protoflow_optimize_axure_block', {
      pageId: formPage.pageId, targetPfId: selectCtrl.pfId,
      tsx: `<Select pfId="${selectCtrl.pfId}" options={["普通","优先"]} initialValue="优先" />`,
    }).optimizedPageId;

    const previewWidgets = call('protoflow_inspect_page', { pageId: previewPage.pageId, view: 'axure', limit: 60 }).records;
    const previewLeaf = previewWidgets.find((w: any) => w.pfId.startsWith('rp-widget-'))!;
    const optPreview = call('protoflow_optimize_axure_block', {
      pageId: previewPage.pageId, targetPfId: previewLeaf.pfId,
      tsx: `<Text pfId="${previewLeaf.pfId}">预览详情</Text>`,
    }).optimizedPageId;

    // Earlier staged optForm must automatically retarget its navigate link from previewPage -> optPreview, while keeping original formPage intact:
    const state1 = JSON.parse(readFileSync(file, 'utf8'));
    assert.match(state1.snapshot.pageSources[optForm], new RegExp(`navigate\\(['"]${optPreview}['"]\\)`));
    assert.match(s.pageSources[formPage.pageId], new RegExp(`navigate\\(['"]${previewPage.pageId}['"]\\)`));

    // Bind tablePage first with index + 1 field, then re-bind in a second pass with 2 fields (and block direct optimize_axure_block Table bypass):
    const grid = call('protoflow_inspect_page', { pageId: tablePage.pageId, view: 'axure', limit: 60 }).records.find((w: any) => w.type === 'StaticTable')!;
    const [h0, h1] = grid.grid.firstRow;
    call('protoflow_bind_axure_table', {
      pageId: tablePage.pageId, targetPfId: grid.pfId, tableId: db.id,
      mappings: [{ headerPfId: h0.pfId, role: 'index' }, { headerPfId: h1.pfId, role: 'field', columnId: 'c2' }],
    });
    assert.throws(() => call('protoflow_optimize_axure_block', {
      pageId: tablePage.pageId, targetPfId: grid.pfId,
      tsx: `<Table pfId="${grid.pfId}" table="${db.id}" columns={[{title:"单号",dataIndex:"doc_no"}]} />`,
    }), /protoflow_bind_axure_table/);
    const rebound = call('protoflow_bind_axure_table', {
      pageId: tablePage.pageId, targetPfId: grid.pfId, tableId: db.id,
      mappings: [{ headerPfId: h0.pfId, role: 'field', columnId: 'c1' }, { headerPfId: h1.pfId, role: 'field', columnId: 'c2' }],
    });
    assert.equal(rebound.staged, true);

    const state2 = JSON.parse(readFileSync(file, 'utf8'));
    const packed = await compactRpReview(s.pageSources, state2.operations, revisionDigest);
    const formatted = formatRpReviewArgs(packed.find(op => op.args.pageId === rebound.optimizedPageId)!.args);
    assert.equal('rpSourcePatch' in formatted, false);
    assert.equal(Array.isArray(formatted.changedTsxLines), true);

    // Reshaping an optimized copy into a pure flow-grid Page keeps inspectAxureProject working with copyLayout === 'flow':
    state2.snapshot.pageSources[optPreview] = `// @alex-axure-source ${previewPage.pageId}\nexport default function Page() {\n  return <Page pfId="flow-root" title="预览（优化版）"><Card pfId="flow-card" title="详情" /></Page>;\n}\n`;
    atomicWrite(file, state2);
    const inv = call('protoflow_inspect_axure_project', { pageId: previewPage.pageId });
    assert.equal(inv.records[0].copyLayout, 'flow');
    assert.equal(call('protoflow_inspect_page',{pageId:optPreview,view:'axure'}).records[0].pfId,'flow-root');
    const copyId = rebound.optimizedPageId;
    const editedColumn = {dataIndex:'warehouse',title:'收货仓库',width:233,sortable:true,align:'right'};
    state2.snapshot.pageSources[copyId] = `// @alex-axure-source ${tablePage.pageId}\nexport default function Page(){
      return <Page pfId="flow"><Card pfId="card"><Table pfId="${grid.pfId}" table="orders" showIndex columns={${JSON.stringify([editedColumn])}} /></Card></Page>}`;
    atomicWrite(file,state2);
    const rebind = (mappings:unknown[]) => call('protoflow_bind_axure_table',{pageId:tablePage.pageId,targetPfId:grid.pfId,tableId:db.id,mappings});
    const warehouse = {headerPfId:h1.pfId,role:'field',columnId:'c2'};
    assert.equal(rebind([{headerPfId:h0.pfId,role:'index'},warehouse]).unchanged,true);
    assert.equal(rebind([{headerPfId:h0.pfId,role:'field',columnId:'c1'},warehouse]).staged,true);
    const savedDoc = parsePageSource(JSON.parse(readFileSync(file,'utf8')).snapshot.pageSources[copyId]).doc!;
    const savedTable = findNode(savedDoc.root,grid.pfId)!;
    assert.deepEqual((savedTable.props.columns as unknown[])[1],editedColumn);
    assert.equal(savedTable.props.layoutFrame,undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('form specs include defaults only from the rendered fields owned by that form', async () => {
  const { formFieldSpecs } = await import('../src/proto/runtime/runtime');
  const doc = parsePageSource(`export default function Page() {
    return (
      <Page pfId="p">
        <Form pfId="f1" table="t_demo">
          <Input pfId="in1" name="warehouse" label="仓库" initialValue="华东总仓" required />
        </Form>
      </Page>
    );
  }`).doc!;
  const specs = formFieldSpecs(doc.root.children.filter(isNode)[0]);
  assert.deepEqual(specs, [{ name: 'warehouse', label: '仓库', required: true, initialValue: '华东总仓' }]);
  const outer = parsePageSource(`export default function Page(){return <Page pfId="p"><Form pfId="outer" fields={[{name:"unused",initialValue:"旧配置"}]}>
    <Form pfId="inner"><Input pfId="status" name="status" initialValue="待审核"/></Form></Form></Page>}`).doc!;
  assert.deepEqual(formFieldSpecs(outer.root.children.filter(isNode)[0]),[]);
});

test('E2E RP flow reshaping: schema-only warning, column action consistency, QueryForm filtering, row-2 查看 navigation, and itemized review', async () => {
  const React = (await import('react')).default;
  const TestRenderer = (await import('react-test-renderer')).default;
  const { act } = await import('react-test-renderer');
  const { installTestDom } = await import('./dom');
  const { RuntimeContextProvider, useRuntimeController } = await import('../src/proto/runtime/runtime');
  const { NodeView } = await import('../src/proto/renderer/NodeView');
  const { useProtoStore } = await import('../src/store/useProtoStore');
  const { useHermesStore } = await import('../src/store/useHermesStore');
  const { useAiChatStore } = await import('../src/store/useAiChatStore');
  const { discussProject, resolveProjectReview } = await import('../src/services/projectWorkflow');
  const { conversationKey } = await import('../src/services/hermesConversation');
  const { projectChatScope } = await import('../src/services/projectChatHistory');
  const { callTool, atomicWrite, tools: mcpTools } = require(process.cwd() + '/electron/protoflow-mcp.cjs');

  const restoreDom = installTestDom();
  const dir = mkdtempSync(join(tmpdir(), 'alex-rp-flow-e2e-'));
  const previousDesktop = (window as unknown as { protoflowDesktop?: unknown }).protoflowDesktop;

  try {
    const imported = await importAxureRp(readFileSync('tests/fixtures/axure9-scoped-packages.rp'));
    const projectPayload = createAxureProject('采购入库ERP.rp', '/projects', imported);
    const projectId = projectPayload.meta.projectId;
    const listGuid = '1'.repeat(32);
    const detailGuid = '2'.repeat(32);
    const listPageId = 'rp-page-' + listGuid;
    const detailPageId = 'rp-page-' + detailGuid;
    const optListPageId = 'rp-optimized-' + listGuid;
    const optDetailPageId = 'rp-optimized-' + detailGuid;
    const folderId = projectPayload.stateSnapshot.designerFolders[0].id;

    projectPayload.stateSnapshot.designerPages = [
      { pageId: listPageId, title: '采购入库台账', folderId, platform: 'desktop' },
      { pageId: detailPageId, title: '入库单详情', folderId, platform: 'desktop' },
    ];
    projectPayload.stateSnapshot.activePageId = listPageId;
    projectPayload.stateSnapshot.pageSources = {
      [listPageId]: [
        'export default function Page() {',
        '  return (',
        `    <Page pfId="rp-root-${listGuid}" title="采购入库台账" bg="white" description="条件或多分支点击未转换（1）">`,
        `      <AxureCanvas pfId="rp-canvas-${listGuid}">`,
        `        <VectorShape pfId="rp-lbl-no" x={20} y={24} width={68} height={24} text="入库单号：" />`,
        `        <Input pfId="rp-in-no" layoutFrame={{ x: 92, y: 20, width: 160, height: 32 }} placeholder="输入单号" />`,
        `        <VectorShape pfId="rp-lbl-wh" x={272} y={24} width={68} height={24} text="收货仓库：" />`,
        `        <Select pfId="rp-sel-wh" layoutFrame={{ x: 344, y: 20, width: 140, height: 32 }} options={['华东仓', '华南仓']} />`,
        `        <Button pfId="rp-btn-query" layoutFrame={{ x: 500, y: 20, width: 68, height: 32 }}>查询</Button>`,
        `        <Text pfId="rp-keep-notice" layoutFrame={{ x: 590, y: 24, width: 180, height: 24 }}>每日凌晨自动对账</Text>`,
        `        <OutlineTree pfId="rp-side-tree" x={0} y={76} width={160} height={360}><TreeItem pfId="rp-tree-1" text="仓储菜单" /></OutlineTree>`,
        `        <DynamicPanel pfId="rp-hidden-panel" x={260} y={140} width={380} height={220} hidden activeState={1}><PanelState pfId="rp-state-1" label="高级筛选弹层" /></DynamicPanel>`,
        `        <AxureWidget pfId="rp-unsupported-1" kind="placeholder" x={800} y={20} width={120} height={32} label="Repeater 尚未转换" />`,
        `        <StaticTable pfId="rp-grid-inbound" x={180} y={84} width={680} height={120} columnWidths={[60, 180, 160, 140, 140]} rowHeights={[36, 40, 40]}>`,
        `          <StaticTableCell pfId="c-h-idx" text="序号" />`,
        `          <StaticTableCell pfId="c-h-no" text="入库单号" />`,
        `          <StaticTableCell pfId="c-h-wh" text="收货仓库" />`,
        `          <StaticTableCell pfId="c-h-view" text="详情操作" />`,
        `          <StaticTableCell pfId="c-h-del" text="行删除" />`,
        `          <StaticTableCell pfId="c-r1-idx" text="1" />`,
        `          <StaticTableCell pfId="c-r1-no" text="RK-20261101" />`,
        `          <StaticTableCell pfId="c-r1-wh" text="华东仓" />`,
        `          <StaticTableCell pfId="c-r1-view" text="查看" onClick={() => navigate('${detailPageId}')} />`,
        `          <StaticTableCell pfId="c-r1-del" text="删除" onClick={() => hide('rp-grid-inbound')} />`,
        `          <StaticTableCell pfId="c-r2-idx" text="2" />`,
        `          <StaticTableCell pfId="c-r2-no" text="RK-20261102" />`,
        `          <StaticTableCell pfId="c-r2-wh" text="华南仓" />`,
        `          <StaticTableCell pfId="c-r2-view" text="查看" onClick={() => navigate('${detailPageId}')} />`,
        `          <StaticTableCell pfId="c-r2-del" text="" />`,
        `        </StaticTable>`,
        `      </AxureCanvas>`,
        '    </Page>',
        '  );',
        '}',
      ].join('\n'),
      [detailPageId]: [
        'export default function Page() {',
        '  return (',
        `    <Page pfId="rp-root-${detailGuid}" title="入库单详情" bg="white">`,
        `      <AxureCanvas pfId="rp-canvas-${detailGuid}">`,
        `        <StaticTable pfId="rp-detail-kv" x={24} y={24} width={480} height={80} columnWidths={[120, 360]} rowHeights={[40, 40]}>`,
        `          <StaticTableCell pfId="d-k1" text="入库单号" />`,
        `          <StaticTableCell pfId="d-v1" text="RK-20261101" />`,
        `          <StaticTableCell pfId="d-k2" text="收货仓库" />`,
        `          <StaticTableCell pfId="d-v2" text="华东仓" />`,
        `        </StaticTable>`,
        `      </AxureCanvas>`,
        '    </Page>',
        '  );',
        '}',
      ].join('\n'),
    };

    loadProjectFromBinaryPayload(projectPayload);
    useProtoStore.getState().setViewMode('project_ai');
    useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
    const chatScope = { projectId, kind: 'project' as const };
    useAiChatStore.getState().switchConversation(chatScope);
    useHermesStore.setState({ status: 'running', sessions: {}, runningProjects: {}, cancelGeneration: {}, partial: {} });

    const inboundTable = {
      id: 't_inbound',
      tableName: 't_wms_inbound',
      cnName: '采购入库单',
      domain: '仓储域',
      description: '采购入库台账与详情共用表',
      modeling: { entity: '采购入库单', grain: '一单一行', reason: '承接入库台账查询与详情查看' },
      sharedByMenus: [],
      columns: [
        { id: 'col_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
        { id: 'col_no', name: 'doc_no', dataType: 'VARCHAR(64)', nullable: false, comment: '入库单号' },
        { id: 'col_wh', name: 'warehouse', dataType: 'VARCHAR(64)', nullable: false, comment: '收货仓库' },
      ],
    };

    let currentAgentHandler: (ctxFile: string, input: any) => void = () => {};
    const listeners = new Set<(event: any) => void>();
    const registeredToolNames = mcpTools.map((t: { name: string }) => t.name);
    (window as unknown as { protoflowDesktop: unknown }).protoflowDesktop = {
      hermes: {
        onEvent: (fn: (event: any) => void) => {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        session: async (sc: any) => ({
          ...sc,
          sessionId: 's-rp-e2e',
          running: false,
          projectTools: registeredToolNames,
          models: { currentModelId: 'm-rp', availableModels: [] },
        }),
        sync: async () => ({ synced: true }),
        execute: async (input: any) => {
          const taskKey = conversationKey(input);
          const runId = 'run-' + Math.random().toString(36).slice(2, 8);
          const baseEvt = {
            projectId: input.projectId,
            kind: input.kind,
            ...(input.threadId ? { threadId: input.threadId } : {}),
            sessionId: 's-rp-e2e',
            planningSessionId: 's-rp-e2e',
            execSessionId: 's-rp-e2e',
            taskKey,
            clientRequestId: input.clientRequestId,
            runId,
          };
          listeners.forEach(fn => fn({ type: 'run-start', ...baseEvt }));
          const ctxFile = join(dir, `${runId}.json`);
          atomicWrite(ctxFile, {
            kind: 'project',
            workflowPhase: input.workflowPhase,
            active: true,
            projectId: input.projectId,
            sessionId: 's-rp-e2e',
            runId,
            contextFocus: input.contextFocus ?? {},
            operations: [],
            snapshot: structuredClone(input.snapshot),
          });
          try {
            currentAgentHandler(ctxFile, input);
            const finalCtx = JSON.parse(readFileSync(ctxFile, 'utf8'));
            return {
              text: '已完成 RP 转换建议，请核对确认单。',
              operations: finalCtx.operations,
              dependencyFootprint: finalCtx.dependencyFootprint,
              sessionId: 's-rp-e2e',
              planningSessionId: 's-rp-e2e',
              execSessionId: 's-rp-e2e',
              taskKey,
              clientRequestId: input.clientRequestId,
              runId,
              modelId: 'm-rp',
            };
          } finally {
            listeners.forEach(fn => fn({ type: 'run-end', ...baseEvt }));
          }
        },
        cancel: async () => {},
      },
    };

    // Pass 1: AI stages ONLY DB schema -> MCP returns rpMigrationProgress warning, and confirmation card explicitly flags "表结构已准备，页面尚未转换"
    let pass1Progress: any;
    currentAgentHandler = (ctxFile) => {
      callTool(ctxFile, 'protoflow_get_project_brief', {});
      callTool(ctxFile, 'protoflow_get_project', {});
      const stagedTbl = callTool(ctxFile, 'protoflow_upsert_db_table', { table: inboundTable });
      pass1Progress = stagedTbl.rpMigrationProgress;
    };
    await discussProject(projectId, '转换入库模块', [], [], {}, undefined, {
      scope: { kind: 'project' },
      readOnly: false,
    });
    assert.equal(pass1Progress.totalScopePages, 2);
    assert.equal(pass1Progress.stagedThisTurnCount, 0);
    assert.equal(pass1Progress.flowReshapedPageCount, 0);
    assert.equal(pass1Progress.unconvertedPages.length, 2);
    const activeThreadKey = () =>
      conversationKey(projectChatScope(projectId, useAiChatStore.getState().loadProjectIndex(projectId).activeId));
    const pass1Msg = useAiChatStore.getState().byConversation[activeThreadKey()]!.at(-1)!;
    assert.ok(
      pass1Msg.projectChangeReview!.items.some(it => it.includes('表结构已准备，页面尚未转换')),
      `expected schema-only notice in review items, got: ${JSON.stringify(pass1Msg.projectChangeReview!.items)}`,
    );
    await resolveProjectReview(projectId, pass1Msg.id, false);

    // Pass 2: Full AI conversion turn — verify inspectAxurePage evidence, guardrails, flow reshaping, review items, and live runtime
    let inspectedPage: any;
    currentAgentHandler = (ctxFile) => {
      callTool(ctxFile, 'protoflow_get_project_brief', {});
      callTool(ctxFile, 'protoflow_inspect_axure_project', {});
      inspectedPage = callTool(ctxFile, 'protoflow_inspect_page', { pageId: listPageId, view: 'axure', limit: 60 });
      callTool(ctxFile, 'protoflow_get_project', {});
      callTool(ctxFile, 'protoflow_upsert_db_table', { table: inboundTable });

      const validFlowSource = (rowActionsExpr: string) => [
        'export default function Page() {',
        '  return (',
        '    <Page pfId="flow-inbound-page" title="采购入库台账（优化版）">',
        '      <Card pfId="card-inbound" title="采购入库查询">',
        '        <Text pfId="rp-keep-notice">每日凌晨自动对账</Text>',
        '        <QueryForm pfId="qf-inbound" target="tbl-inbound" fields={[',
        '          { name: "doc_no", label: "入库单号", placeholder: "输入单号" },',
        '          { name: "warehouse", label: "收货仓库", type: "select", options: ["华东仓", "华南仓"] }',
        '        ]} />',
        '        <Table pfId="tbl-inbound" table="t_inbound" showIndex columns={[',
        '          { title: "入库单号", dataIndex: "doc_no" },',
        '          { title: "收货仓库", dataIndex: "warehouse" }',
        `        ]} rowActions={${rowActionsExpr}} />`,
        '      </Card>',
        '    </Page>',
        '  );',
        '}',
      ].join('\n');

      const validTableMappings = [
        { headerPfId: 'c-h-idx', role: 'index' as const },
        { headerPfId: 'c-h-no', role: 'field' as const, columnId: 'col_no' },
        { headerPfId: 'c-h-wh', role: 'field' as const, columnId: 'col_wh' },
        { headerPfId: 'c-h-view', role: 'actions' as const },
        { headerPfId: 'c-h-del', role: 'pending' as const },
      ];

      // Guard B: Silently dropping rp-side-tree / rp-hidden-panel / rp-unsupported-1 MUST be rejected
      assert.throws(
        () =>
          callTool(ctxFile, 'protoflow_reshape_axure_page', {
            pageId: listPageId,
            source: validFlowSource(`[{ label: "查看", onClick: () => navigate("${detailPageId}", "row") }]`),
            coverage: {
              converted: [
                { sourcePfIds: ['rp-in-no', 'rp-sel-wh'], targetPfId: 'qf-inbound', summary: '合成查询表单' },
                { sourcePfIds: ['rp-grid-inbound'], targetPfId: 'tbl-inbound', summary: '绑定入库表', tableId: 't_inbound', columnMappings: validTableMappings },
              ],
              retained: [{ sourcePfIds: ['rp-keep-notice'], summary: '保留对账说明' }],
            },
          }),
        /禁止静默丢弃/,
      );

      // Guard C: Promoting single-row sample "删除" onto all-row Table.rowActions MUST be rejected
      assert.throws(
        () =>
          callTool(ctxFile, 'protoflow_reshape_axure_page', {
            pageId: listPageId,
            source: validFlowSource(
              `[{ label: "查看", onClick: () => navigate("${detailPageId}", "row") }, { label: "删除", danger: true, onClick: () => deleteRow() }]`,
            ),
            coverage: {
              converted: [
                { sourcePfIds: ['rp-lbl-no', 'rp-in-no', 'rp-lbl-wh', 'rp-sel-wh', 'rp-btn-query'], targetPfId: 'qf-inbound', summary: '零散查询控件合成为 QueryForm' },
                { sourcePfIds: ['rp-grid-inbound'], targetPfId: 'tbl-inbound', summary: '静态表绑定为业务 Table', tableId: 't_inbound', columnMappings: validTableMappings },
              ],
              retained: [{ sourcePfIds: ['rp-keep-notice'], summary: '保留对账说明' }],
              pending: [
                { sourcePfIds: ['rp-side-tree', 'rp-hidden-panel', 'rp-unsupported-1'], reason: '侧栏树、隐藏弹层与 Repeater 占位待确认' },
              ],
            },
          }),
        /删除.*不能直接推广到全表/,
      );

      // Guard D: Localized bind_axure_table rejects mapping row-inconsistent "行删除" column as role="actions"
      assert.throws(
        () =>
          callTool(ctxFile, 'protoflow_bind_axure_table', {
            pageId: listPageId,
            targetPfId: 'rp-grid-inbound',
            tableId: 't_inbound',
            mappings: [
              { headerPfId: 'c-h-idx', role: 'index' },
              { headerPfId: 'c-h-no', role: 'field', columnId: 'col_no' },
              { headerPfId: 'c-h-wh', role: 'field', columnId: 'col_wh' },
              { headerPfId: 'c-h-view', role: 'actions' },
              { headerPfId: 'c-h-del', role: 'actions' },
            ],
          }),
        /各允许一列|缺少逐行一致/,
      );

      // Valid reshape of List Page FIRST (before detail page copy exists -> link will auto-retarget once detail copy is created!)
      callTool(ctxFile, 'protoflow_reshape_axure_page', {
        pageId: listPageId,
        source: validFlowSource(`[{ label: "查看", onClick: () => navigate("${detailPageId}", "row") }]`),
        coverage: {
          converted: [
            {
              sourcePfIds: ['rp-lbl-no', 'rp-in-no', 'rp-lbl-wh', 'rp-sel-wh', 'rp-btn-query'],
              targetPfId: 'qf-inbound',
              summary: '零散单号/仓库输入与查询按钮合并为 QueryForm',
            },
            {
              sourcePfIds: ['rp-grid-inbound'],
              targetPfId: 'tbl-inbound',
              summary: '静态表格转为绑定采购入库单的 Table 并迁移逐行一致的查看动作',
              tableId: 't_inbound',
              columnMappings: [
                { headerPfId: 'c-h-idx', role: 'index' },
                { headerPfId: 'c-h-no', role: 'field', columnId: 'col_no' },
                { headerPfId: 'c-h-wh', role: 'field', columnId: 'col_wh' },
                { headerPfId: 'c-h-view', role: 'actions' },
                { headerPfId: 'c-h-del', role: 'pending', reason: '行删除仅出现在 1/2 条非空样例行，待确认是否逐行开放' },
              ],
            },
          ],
          retained: [{ sourcePfIds: ['rp-keep-notice'], summary: '保留顶部自动对账提示文本' }],
          pending: [
            {
              sourcePfIds: ['rp-side-tree', 'rp-hidden-panel', 'rp-unsupported-1'],
              reason: '左侧目录树、隐藏高级筛选动态面板及未转换 Repeater 占位需业务确认用途',
            },
          ],
        },
      });

      // Incremental edit_page_block on the reshaped copy preserves title, folderId, header, and rpCoverage invariants
      callTool(ctxFile, 'protoflow_edit_page_block', {
        pageId: optListPageId,
        targetPfId: 'card-inbound',
        mode: 'append_children',
        tsx: '<Alert pfId="inbound-tip" type="info" message="支持按仓库筛选后查看对应单据详情" />',
      });

      // Reshape Detail Page SECOND -> List Page's navigate(detailPageId, "row") automatically retargets to optDetailPageId!
      callTool(ctxFile, 'protoflow_reshape_axure_page', {
        pageId: detailPageId,
        source: [
          'export default function Page() {',
          '  return (',
          '    <Page pfId="flow-detail-page" title="入库单详情（优化版）">',
          '      <Card pfId="card-detail" title="入库单详情">',
          '        <Descriptions pfId="desc-inbound" table="t_inbound" bordered items={[',
          '          { label: "入库单号", field: "doc_no" },',
          '          { label: "收货仓库", field: "warehouse" }',
          '        ]} />',
          '      </Card>',
          '    </Page>',
          '  );',
          '}',
        ].join('\n'),
        coverage: {
          converted: [
            { sourcePfIds: ['rp-detail-kv'], targetPfId: 'desc-inbound', summary: '键值静态表转为绑定来源行的 Descriptions' },
          ],
        },
      });
    };

    await discussProject(projectId, '将采购入库台账和详情转换为标准流式物料', [], [], {}, undefined, {
      scope: { kind: 'project' },
      readOnly: false,
    });

    // Check inspectAxurePage nearbyLabel + columnActions evidence
    const inNoRec = inspectedPage.records.find((r: any) => r.pfId === 'rp-in-no');
    assert.deepEqual(inNoRec.nearbyLabel, { pfId: 'rp-lbl-no', text: '入库单号' });
    const gridRec = inspectedPage.records.find((r: any) => r.pfId === 'rp-grid-inbound');
    const viewColAct = gridRec.grid.columnActions.find((c: any) => c.headerPfId === 'c-h-view');
    const delColAct = gridRec.grid.columnActions.find((c: any) => c.headerPfId === 'c-h-del');
    assert.equal(viewColAct.consistentAcrossDataRows, true);
    assert.equal(viewColAct.requiresConfirmation, false);
    assert.equal(delColAct.consistentAcrossDataRows, false);
    assert.equal(delColAct.requiresConfirmation, true);

    // Acceptance Criterion 3: Confirmation review itemizes Converted, Retained, and Pending (including single-row delete & importNotes!)
    const pass2Msg = useAiChatStore.getState().byConversation[activeThreadKey()]!.at(-1)!;
    const reviewItems = pass2Msg.projectChangeReview!.items;
    assert.ok(reviewItems.some(it => it.includes('已转换 ·「采购入库台账」查询表单（qf-inbound）') && it.includes('筛选表格 tbl-inbound')));
    assert.ok(reviewItems.some(it => it.includes('已转换 ·「采购入库台账」表格（tbl-inbound）') && it.includes('原表头「入库单号」 → t_wms_inbound.doc_no') && it.includes('行操作：查看')));
    assert.ok(reviewItems.some(it => it.includes('保留区块 ·「采购入库台账」（rp-keep-notice）：保留顶部自动对账提示文本')));
    assert.ok(reviewItems.some(it => it.includes('待确认 ·「采购入库台账」（rp-side-tree、rp-hidden-panel、rp-unsupported-1）')));
    assert.ok(reviewItems.some(it => it.includes('待确认 ·「采购入库台账」（c-h-del）') && it.includes('1/2')));
    assert.ok(reviewItems.some(it => it.includes('待确认 ·「采购入库台账」') && it.includes('条件或多分支点击未转换')));

    // Confirm and apply review through real host flow (including rpSourcePatch SHA-256 expansion)
    await resolveProjectReview(projectId, pass2Msg.id, true);
    assert.ok(usePageStore.getState().pageSources[optListPageId]);
    assert.ok(usePageStore.getState().pageSources[optDetailPageId]);
    assert.deepEqual(usePageStore.getState().tableRows, {}, 'RP sample cells must never be silently written into business tableRows');

    // Seed two real preview rows to verify live runtime QueryForm filtering & row-2 "查看" navigation
    usePageStore.setState(s => ({
      tableRows: {
        ...s.tableRows,
        t_inbound: [
          { id: 'row-1', doc_no: 'RK-20261101', warehouse: '华东仓' },
          { id: 'row-2', doc_no: 'RK-20261102', warehouse: '华南仓' },
        ],
      },
    }));
    useProtoStore.getState().setActivePage(optListPageId);

    const LivePageHarness: React.FC = () => {
      const currentPageId = useProtoStore(s => s.activePageId);
      const rawSrc = usePageStore(s => s.pageSources[currentPageId]);
      const doc = React.useMemo(() => parsePageSource(rawSrc).doc!, [rawSrc]);
      const rt = useRuntimeController(doc, currentPageId, false);
      return React.createElement(RuntimeContextProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
    };

    const textOf = (inst: any): string =>
      typeof inst === 'string' ? inst : inst.children.map((c: any) => textOf(c)).join('');

    let view!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        view = TestRenderer.create(React.createElement(LivePageHarness));
      });

      // Acceptance Criterion 1: QueryForm filters target Table at runtime
      const getTableRowIds = () =>
        view.root.findAll(el => el.type === 'tr' && typeof el.props['data-row-id'] === 'string').map(el => el.props['data-row-id']);
      assert.deepEqual(getTableRowIds(), ['row-1', 'row-2']);

      const controls = view.root.findAllByType(AntdFieldControl);
      act(() => {
        controls[1].props.onChange('华南仓');
      });
      const [, queryBtn] = view.root.findByProps({ 'data-query-actions': true }).findAllByType('button');
      act(() => {
        queryBtn.props.onClick();
      });
      assert.deepEqual(getTableRowIds(), ['row-2']);

      const [resetBtn] = view.root.findByProps({ 'data-query-actions': true }).findAllByType('button');
      act(() => {
        resetBtn.props.onClick();
      });
      assert.deepEqual(getTableRowIds(), ['row-1', 'row-2']);

      // Acceptance Criterion 2: Clicking "查看" on Row 2 navigates to optDetailPageId and displays Row 2 (NOT Row 1!)
      const row2El = view.root.find(el => el.type === 'tr' && el.props['data-row-id'] === 'row-2');
      const row2ViewBtn = row2El.findAllByType('button').find(b => textOf(b) === '查看')!;
      await act(async () => {
        row2ViewBtn.props.onClick({ stopPropagation() {} });
      });

      assert.equal(useProtoStore.getState().activePageId, optDetailPageId);
      assert.deepEqual(useProtoStore.getState().navigationSource, { tableId: 't_inbound', rowId: 'row-2' });

      const renderedDetailText = textOf(view.root);
      assert.ok(renderedDetailText.includes('RK-20261102'), `expected Row 2 doc_no on detail page, got: ${renderedDetailText}`);
      assert.ok(renderedDetailText.includes('华南仓'), `expected Row 2 warehouse on detail page, got: ${renderedDetailText}`);
      assert.equal(renderedDetailText.includes('RK-20261101'), false, 'must NOT display Row 1 on detail page when Row 2 查看 was clicked');
    } finally {
      if (view) act(() => view.unmount());
    }
  } finally {
    (window as unknown as { protoflowDesktop?: unknown }).protoflowDesktop = previousDesktop;
    rmSync(dir, { recursive: true, force: true });
    restoreDom();
  }
});

test('Regression guards: rowAction wrong-page/missing-row, retained DynamicPanel fidelity on raw RP9, inverted requester/approver bindings, second-pass rowActions rebind, and cross-turn progress', async () => {
  const { printNodeSource } = await import('../src/proto/dsl/printer');
  const { describeChanges } = await import('../src/services/projectChangeReview');
  const { callTool, atomicWrite } = require(process.cwd() + '/electron/protoflow-mcp.cjs');
  const dir = mkdtempSync(join(tmpdir(), 'alex-rp-p1p2-guards-'));
  const ctxFile = join(dir, 'ctx.json');

  try {
    const { callTool: invokeMcp } = require(process.cwd() + '/electron/protoflow-mcp.cjs');

    // Part A: Test P1 #2 (Retained DynamicPanel fidelity) & P1 #3a directly on an UNTOUCHED axure9-editable-layout.rp project!
    const layoutImported = await importAxureRp(readFileSync('tests/fixtures/axure9-editable-layout.rp'));
    const layoutProject = createAxureProject('原生布局夹具.rp', '/projects', layoutImported);
    const rawLayoutPage = layoutProject.stateSnapshot.designerPages[0];
    const rawLayoutDoc = parsePageSource(layoutProject.stateSnapshot.pageSources[rawLayoutPage.pageId]).doc!;
    const [hiddenGroup, rawGrid, master1, master2, rawPanel] = rawLayoutDoc.root.children.filter(isNode)[0].children.filter(isNode);
    assert.equal(rawPanel.type, 'DynamicPanel');
    const [hDoc, hWh] = rawGrid.children.filter(isNode).slice(0, 2);

    const inventoryTable = {
      id: 't_inv',
      tableName: 't_inventory_doc',
      cnName: '库存单',
      domain: '仓储域',
      description: '对应 axure9-editable-layout.rp 原生静态表',
      modeling: { entity: '库存单', grain: '一单一行', reason: '承接单号与仓库列表' },
      sharedByMenus: [],
      columns: [
        { id: 'c_pk', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
        { id: 'c_doc', name: 'document_number', dataType: 'VARCHAR(64)', nullable: false, comment: '单号' },
        { id: 'c_wh', name: 'warehouse', dataType: 'VARCHAR(64)', nullable: false, comment: '仓库' },
      ],
    };

    const layoutCtxFile = join(dir, 'layout-ctx.json');
    atomicWrite(layoutCtxFile, {
      kind: 'project',
      workflowPhase: 'conversation',
      active: true,
      projectId: layoutProject.meta.projectId,
      runId: 'layout-turn-1',
      operations: [],
      snapshot: { ...structuredClone(layoutProject.stateSnapshot), projectMode: 'desktop', axureMigrationScope: { kind: 'project' } },
    });
    const callLayout = (name: string, args: Record<string, unknown> = {}) => invokeMcp(layoutCtxFile, name, args);
    callLayout('protoflow_get_project');
    callLayout('protoflow_upsert_db_table', { table: inventoryTable });

    const flowPanelNode: ProtoNode = {
      ...rawPanel,
      props: Object.fromEntries(Object.entries(rawPanel.props).filter(([k]) => k !== 'x' && k !== 'y')),
    };
    const genuinePanelTsx = printNodeSource(flowPanelNode);
    const buildLayoutFlowSource = (
      retainedWidgetTsx: string,
      colsExpr = '[{ title: "单号", dataIndex: "document_number" }, { title: "仓库", dataIndex: "warehouse" }]',
    ) =>
      [
        'export default function Page() {',
        '  return (',
        '    <Page pfId="flow-raw-layout" title="库存页（优化版）">',
        '      <Card pfId="card-raw-layout" title="库存单列表">',
        `        ${retainedWidgetTsx}`,
        `        <Table pfId="tbl-raw-inv" table="t_inv" columns={${colsExpr}} />`,
        '      </Card>',
        '    </Page>',
        '  );',
        '}',
      ].join('\n');

    const baseLayoutCoverage = (columnMappings: unknown) => ({
      converted: [
        {
          sourcePfIds: [rawGrid.pfId],
          targetPfId: 'tbl-raw-inv',
          summary: '原生静态表绑定库存单表',
          tableId: 't_inv',
          ...(columnMappings !== undefined ? { columnMappings } : {}),
        },
      ],
      retained: [{ sourcePfIds: [rawPanel.pfId], summary: '保留双状态动态面板' }],
      pending: [
        { sourcePfIds: [hiddenGroup.pfId, master1.pfId, master2.pfId], reason: '隐藏分组与母版输入框待确认业务归属' },
      ],
    });
    const validInvMappings = [
      { headerPfId: hDoc.pfId, role: 'field', columnId: 'c_doc' },
      { headerPfId: hWh.pfId, role: 'field', columnId: 'c_wh' },
    ];

    // P1 #2a: Replacing DynamicPanel with plain <Text> of the same pfId MUST fail retained check!
    assert.throws(
      () =>
        callLayout('protoflow_reshape_axure_page', {
          pageId: rawLayoutPage.pageId,
          source: buildLayoutFlowSource(`<Text pfId="${rawPanel.pfId}">假装保留原面板</Text>`),
          coverage: baseLayoutCoverage(validInvMappings),
        }),
      /物料类型已从 DynamicPanel 变为 Text/,
    );

    // P1 #2b: Dropping 2nd PanelState from DynamicPanel MUST fail retained check!
    const truncatedPanelTsx = printNodeSource({ ...flowPanelNode, children: [flowPanelNode.children[0]] });
    assert.throws(
      () =>
        callLayout('protoflow_reshape_axure_page', {
          pageId: rawLayoutPage.pageId,
          source: buildLayoutFlowSource(truncatedPanelTsx),
          coverage: baseLayoutCoverage(validInvMappings),
        }),
      /子节点\/状态数量从 2 变为 1/,
    );

    // P1 #3a: Omitting columnMappings when converting StaticTable -> Table MUST fail!
    assert.throws(
      () =>
        callLayout('protoflow_reshape_axure_page', {
          pageId: rawLayoutPage.pageId,
          source: buildLayoutFlowSource(genuinePanelTsx),
          coverage: baseLayoutCoverage(undefined),
        }),
      /columnMappings/,
    );

    // Valid reshape of untouched binary RP9 page with genuine retained 2-state DynamicPanel succeeds!
    const reshapedLayoutRes = callLayout('protoflow_reshape_axure_page', {
      pageId: rawLayoutPage.pageId,
      source: buildLayoutFlowSource(genuinePanelTsx),
      coverage: baseLayoutCoverage(validInvMappings),
    });
    assert.equal(reshapedLayoutRes.rpMigrationProgress.flowReshapedPageCount, 1);

    // Part B: Multi-page project built on untouched axure9-scoped-packages.rp to verify Progress, P1 #1, P1 #3 (requester/approver swap), and P2 #4
    const scopedImported = await importAxureRp(readFileSync('tests/fixtures/axure9-scoped-packages.rp'));
    const base = createAxureProject('真实夹具回归.rp', '/projects', scopedImported);
    const s = base.stateSnapshot;
    const rootFolderId = s.designerFolders[0].id;
    const [scopedApplyPage, scopedPreviewPage] = s.designerPages;

    const approvalGuid = 'a'.repeat(32);
    const approvalPageId = 'rp-page-' + approvalGuid;
    s.designerPages.push({ pageId: approvalPageId, title: '采购审批列表', folderId: rootFolderId, platform: 'desktop' });
    s.pageSources[approvalPageId] = [
      'export default function Page() {',
      '  return (',
      `    <Page pfId="rp-root-${approvalGuid}" title="采购审批列表" bg="white">`,
      `      <AxureCanvas pfId="rp-canvas-${approvalGuid}">`,
      `        <StaticTable pfId="rp-grid-approval" x={20} y={24} width={520} height={116} columnWidths={[160, 160, 100, 100]} rowHeights={[36, 40, 40]}>`,
      `          <StaticTableCell pfId="ap-h-req" text="申请人" />`,
      `          <StaticTableCell pfId="ap-h-app" text="审核人" />`,
      `          <StaticTableCell pfId="ap-h-ext" text="归属口径" />`,
      `          <StaticTableCell pfId="ap-h-act" text="操作" />`,
      `          <StaticTableCell pfId="ap-r1-req" text="张三" />`,
      `          <StaticTableCell pfId="ap-r1-app" text="李四" />`,
      `          <StaticTableCell pfId="ap-r1-ext" text="A类" />`,
      `          <StaticTableCell pfId="ap-r1-act" text="查看" onClick={() => navigate('${scopedPreviewPage.pageId}')} />`,
      `          <StaticTableCell pfId="ap-r2-req" text="王五" />`,
      `          <StaticTableCell pfId="ap-r2-app" text="赵六" />`,
      `          <StaticTableCell pfId="ap-r2-ext" text="B类" />`,
      `          <StaticTableCell pfId="ap-r2-act" text="查看" onClick={() => navigate('${scopedPreviewPage.pageId}')} />`,
      `        </StaticTable>`,
      `      </AxureCanvas>`,
      '    </Page>',
      '  );',
      '}',
    ].join('\n');

    const approvalTable = {
      id: 't_approval',
      tableName: 't_purchase_approval',
      cnName: '采购审批单',
      domain: '采购域',
      description: '申请人与审核人双字段核验',
      modeling: { entity: '采购审批单', grain: '一单一行', reason: '核验申请人与审核人列绑定及查看跳转' },
      sharedByMenus: [],
      columns: [
        { id: 'ap_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
        { id: 'ap_req', name: 'requester', dataType: 'VARCHAR(64)', nullable: false, comment: '申请人' },
        { id: 'ap_app', name: 'approver', dataType: 'VARCHAR(64)', nullable: false, comment: '审核人' },
      ],
    };

    atomicWrite(ctxFile, {
      kind: 'project',
      workflowPhase: 'conversation',
      active: true,
      projectId: base.meta.projectId,
      runId: 'turn-1',
      operations: [],
      snapshot: { ...structuredClone(s), projectMode: 'desktop', axureMigrationScope: { kind: 'project' } },
    });
    const call = (name: string, args: Record<string, unknown> = {}) => callTool(ctxFile, name, args);
    call('protoflow_get_project');
    call('protoflow_upsert_db_table', { table: inventoryTable });
    call('protoflow_upsert_db_table', { table: approvalTable });

    // --- Progress Guard A: Optimizing ONLY 1 Select widget in place must NOT mark the whole page as flow-reshaped ---
    const applyInspect = call('protoflow_inspect_page', { pageId: scopedApplyPage.pageId, view: 'axure', limit: 60 });
    const applySelect = applyInspect.records.find((r: any) => r.type === 'Select')!;
    const localizedRes = call('protoflow_optimize_axure_block', {
      pageId: scopedApplyPage.pageId,
      targetPfId: applySelect.pfId,
      tsx: `<Select pfId="${applySelect.pfId}" options={["普通","优先"]} initialValue="优先" />`,
    });
    assert.equal(localizedRes.rpMigrationProgress.stagedThisTurnCount, 1);
    assert.equal(localizedRes.rpMigrationProgress.partiallyOptimizedPageCount, 1);
    assert.equal(localizedRes.rpMigrationProgress.flowReshapedPageCount, 0, 'localized 1-widget replacement must NOT count as flow-reshaped whole page');

    // --- P1 #3 (Requester/Approver Swap) & P1 #1 ("查看" Wrong Page / Missing 'row') on approvalPageId ---
    const approvalFlowSource = (colsExpr: string, rowActionsExpr: string) =>
      [
        'export default function Page() {',
        '  return (',
        '    <Page pfId="flow-approval" title="采购审批列表（优化版）">',
        '      <Card pfId="card-approval" title="审批台账">',
        `        <Table pfId="rp-grid-approval" table="t_approval" columns={${colsExpr}} rowActions={${rowActionsExpr}} />`,
        '      </Card>',
        '    </Page>',
        '  );',
        '}',
      ].join('\n');

    const validColsExpr = '[{ title: "申请人", dataIndex: "requester" }, { title: "审核人", dataIndex: "approver" }]';
    const swappedColsExpr = '[{ title: "申请人", dataIndex: "approver" }, { title: "审核人", dataIndex: "requester" }]';

    // P1 #3b: Swapping dataIndex in Table.columns vs columnMappings MUST be rejected!
    assert.throws(
      () =>
        call('protoflow_reshape_axure_page', {
          pageId: approvalPageId,
          source: approvalFlowSource(swappedColsExpr, `[{ label: "查看", onClick: () => navigate("${scopedPreviewPage.pageId}", "row") }]`),
          coverage: {
            converted: [
              {
                sourcePfIds: ['rp-grid-approval'],
                targetPfId: 'rp-grid-approval',
                summary: '审批表转换',
                tableId: 't_approval',
                columnMappings: [
                  { headerPfId: 'ap-h-req', role: 'field', columnId: 'ap_req' },
                  { headerPfId: 'ap-h-app', role: 'field', columnId: 'ap_app' },
                  { headerPfId: 'ap-h-ext', role: 'pending', reason: '归属口径字段待业务确认' },
                  { headerPfId: 'ap-h-act', role: 'actions' },
                ],
              },
            ],
          },
        }),
      /不一致/,
    );

    // P1 #3c: Swapping columnMappings ITSELF ("申请人" -> ap_app/approver, "审核人" -> ap_req/requester) MUST ALSO be rejected!
    assert.throws(
      () =>
        call('protoflow_reshape_axure_page', {
          pageId: approvalPageId,
          source: approvalFlowSource(swappedColsExpr, `[{ label: "查看", onClick: () => navigate("${scopedPreviewPage.pageId}", "row") }]`),
          coverage: {
            converted: [
              {
                sourcePfIds: ['rp-grid-approval'],
                targetPfId: 'rp-grid-approval',
                summary: '审批表转换',
                tableId: 't_approval',
                columnMappings: [
                  { headerPfId: 'ap-h-req', role: 'field', columnId: 'ap_app' },
                  { headerPfId: 'ap-h-app', role: 'field', columnId: 'ap_req' },
                  { headerPfId: 'ap-h-ext', role: 'pending' },
                  { headerPfId: 'ap-h-act', role: 'actions' },
                ],
              },
            ],
          },
        }),
      /字段绑定颠倒/,
    );

    // P1 #1a: "查看" jumping to a WRONG existing page (scopedApplyPage instead of scopedPreviewPage) MUST be rejected!
    assert.throws(
      () =>
        call('protoflow_reshape_axure_page', {
          pageId: approvalPageId,
          source: approvalFlowSource(validColsExpr, `[{ label: "查看", onClick: () => navigate("${scopedApplyPage.pageId}", "row") }]`),
          coverage: {
            converted: [
              {
                sourcePfIds: ['rp-grid-approval'],
                targetPfId: 'rp-grid-approval',
                summary: '审批表转换',
                tableId: 't_approval',
                columnMappings: [
                  { headerPfId: 'ap-h-req', role: 'field', columnId: 'ap_req' },
                  { headerPfId: 'ap-h-app', role: 'field', columnId: 'ap_app' },
                  { headerPfId: 'ap-h-ext', role: 'pending' },
                  { headerPfId: 'ap-h-act', role: 'actions' },
                ],
              },
            ],
          },
        }),
      /跳转目标.*不一致/,
    );

    // P1 #1b: "查看" omitting current-row "row" parameter on navigate MUST be rejected!
    assert.throws(
      () =>
        call('protoflow_reshape_axure_page', {
          pageId: approvalPageId,
          source: approvalFlowSource(validColsExpr, `[{ label: "查看", onClick: () => navigate("${scopedPreviewPage.pageId}") }]`),
          coverage: {
            converted: [
              {
                sourcePfIds: ['rp-grid-approval'],
                targetPfId: 'rp-grid-approval',
                summary: '审批表转换',
                tableId: 't_approval',
                columnMappings: [
                  { headerPfId: 'ap-h-req', role: 'field', columnId: 'ap_req' },
                  { headerPfId: 'ap-h-app', role: 'field', columnId: 'ap_app' },
                  { headerPfId: 'ap-h-ext', role: 'pending' },
                  { headerPfId: 'ap-h-act', role: 'actions' },
                ],
              },
            ],
          },
        }),
      /当前行参数/,
    );

    // Reshape approvalPageId initially with "操作" as pending (so Table has NO rowActions yet, setting up P2 #4!)
    const optApprovalRes = call('protoflow_reshape_axure_page', {
      pageId: approvalPageId,
      source: [
        'export default function Page() {',
        '  return (',
        '    <Page pfId="flow-approval" title="采购审批列表（优化版）">',
        '      <Card pfId="card-approval" title="审批台账">',
        '        <Table pfId="rp-grid-approval" table="t_approval" showIndex={false} columns={[',
        '          { title: "申请人", dataIndex: "requester", width: 220, sortable: true },',
        '          { title: "审核人", dataIndex: "approver" }',
        '        ]} />',
        '      </Card>',
        '    </Page>',
        '  );',
        '}',
      ].join('\n'),
      coverage: {
        converted: [
          {
            sourcePfIds: ['rp-grid-approval'],
            targetPfId: 'rp-grid-approval',
            summary: '初版仅绑定申请人与审核人字段',
            tableId: 't_approval',
            columnMappings: [
              { headerPfId: 'ap-h-req', role: 'field', columnId: 'ap_req' },
              { headerPfId: 'ap-h-app', role: 'field', columnId: 'ap_app' },
              { headerPfId: 'ap-h-ext', role: 'pending', reason: '归属口径待确认' },
              { headerPfId: 'ap-h-act', role: 'pending', reason: '首轮暂缓迁移操作列' },
            ],
          },
        ],
      },
    });
    const optApprovalPageId = optApprovalRes.optimizedPageId;

    // Commit Turn 1 through real host validation gate (prepareProjectChanges)
    const turn1Ctx = JSON.parse(readFileSync(ctxFile, 'utf8'));
    const turn1Review = describeChanges(s, turn1Ctx.snapshot, turn1Ctx.operations, undefined, { kind: 'project' });
    assert.ok(
      turn1Review.some(line => line.includes('仅完成局部原位替换、尚未整页流式重塑') && line.includes(scopedApplyPage.title)),
      `expected localized-only notice in Turn 1 review, got: ${JSON.stringify(turn1Review)}`,
    );
    const committedTurn1 = prepareProjectChanges(base, turn1Ctx.operations, undefined, undefined, true).next;

    // --- Turn 2: Verify cross-turn progress persistence AND P2 #4 second-pass bind_axure_table adding rowActions! ---
    // Also add a 4-column table without pending extra field to test pure 2-pass bind_axure_table (Pass 1: index/fields, Pass 2: actions)
    const twoPassGuid = 'b'.repeat(32);
    const twoPassPageId = 'rp-page-' + twoPassGuid;
    committedTurn1.stateSnapshot.designerPages.push({ pageId: twoPassPageId, title: '入库复核单', folderId: rootFolderId, platform: 'desktop' });
    committedTurn1.stateSnapshot.pageSources[twoPassPageId] = [
      'export default function Page() {',
      '  return (',
      `    <Page pfId="rp-root-${twoPassGuid}" title="入库复核单" bg="white">`,
      `      <AxureCanvas pfId="rp-canvas-${twoPassGuid}">`,
      `        <StaticTable pfId="rp-grid-2pass" x={20} y={20} width={360} height={116} columnWidths={[120, 120, 120]} rowHeights={[36, 40, 40]}>`,
      `          <StaticTableCell pfId="tp-h-doc" text="单号" />`,
      `          <StaticTableCell pfId="tp-h-wh" text="仓库" />`,
      `          <StaticTableCell pfId="tp-h-act" text="查看操作" />`,
      `          <StaticTableCell pfId="tp-r1-doc" text="001" />`,
      `          <StaticTableCell pfId="tp-r1-wh" text="华东" />`,
      `          <StaticTableCell pfId="tp-r1-act" text="查看" onClick={() => navigate('${scopedPreviewPage.pageId}')} />`,
      `          <StaticTableCell pfId="tp-r2-doc" text="002" />`,
      `          <StaticTableCell pfId="tp-r2-wh" text="华南" />`,
      `          <StaticTableCell pfId="tp-r2-act" text="查看" onClick={() => navigate('${scopedPreviewPage.pageId}')} />`,
      `        </StaticTable>`,
      `      </AxureCanvas>`,
      '    </Page>',
      '  );',
      '}',
    ].join('\n');
    // Seed an existing optimized copy of twoPassPageId whose Table already has exact fields [document_number, warehouse] (with custom width 210) and showIndex=false, but NO rowActions:
    const optTwoPassId = 'rp-optimized-' + twoPassGuid;
    committedTurn1.stateSnapshot.designerPages.push({ pageId: optTwoPassId, title: '入库复核单（优化版）', folderId: rootFolderId, platform: 'desktop' });
    committedTurn1.stateSnapshot.pageSources[optTwoPassId] = [
      `// @alex-axure-source ${twoPassPageId}`,
      'export default function Page() {',
      '  return (',
      '    <Page pfId="flow-2pass" title="入库复核单（优化版）">',
      '      <Card pfId="card-2pass">',
      '        <Table pfId="rp-grid-2pass" table="t_inv" showIndex={false} columns={[',
      '          { title: "单号", dataIndex: "document_number", width: 210, sortable: true },',
      '          { title: "仓库", dataIndex: "warehouse" }',
      '        ]} />',
      '      </Card>',
      '    </Page>',
      '  );',
      '}',
    ].join('\n');

    atomicWrite(ctxFile, {
      kind: 'project',
      workflowPhase: 'conversation',
      active: true,
      projectId: committedTurn1.meta.projectId,
      runId: 'turn-2',
      operations: [],
      snapshot: { ...structuredClone(committedTurn1.stateSnapshot), projectMode: 'desktop', axureMigrationScope: { kind: 'project' } },
    });
    call('protoflow_get_project');

    // Turn 2 Progress Check: Stage a new column ONLY -> pages already flow-reshaped in Turn 1 MUST stay in flowReshapedPages (never regressed to unconvertedPages!)
    const colProgressRes = call('protoflow_upsert_db_column', {
      tableId: 't_inv',
      column: { id: 'c_remark', name: 'remark', dataType: 'VARCHAR(128)', nullable: true, comment: '备注' },
    });
    const turn2Prog = colProgressRes.rpMigrationProgress;
    assert.equal(turn2Prog.stagedThisTurnCount, 0);
    assert.ok(
      turn2Prog.flowReshapedPages.some((p: any) => p.pageId === approvalPageId),
      'already flow-reshaped approval page from Turn 1 must NOT regress to unconverted in Turn 2',
    );
    assert.ok(
      turn2Prog.partiallyOptimizedPages.some((p: any) => p.pageId === scopedApplyPage.pageId),
      'partially optimized page from Turn 1 must stay in partiallyOptimizedPages in Turn 2',
    );
    assert.equal(
      turn2Prog.unconvertedPages.some((p: any) => p.pageId === approvalPageId || p.pageId === scopedApplyPage.pageId),
      false,
    );

    // P2 #4: Existing Table has exact fields [document_number, warehouse] and NO rowActions -> binding with role='actions' MUST stage rowActions (NOT return unchanged: true!)
    const secondPassBind = call('protoflow_bind_axure_table', {
      pageId: twoPassPageId,
      targetPfId: 'rp-grid-2pass',
      tableId: 't_inv',
      mappings: [
        { headerPfId: 'tp-h-doc', role: 'field', columnId: 'c_doc' },
        { headerPfId: 'tp-h-wh', role: 'field', columnId: 'c_wh' },
        { headerPfId: 'tp-h-act', role: 'actions' },
      ],
    });
    assert.equal(secondPassBind.staged, true, 'adding role=actions to an existing field-bound Table must NOT return unchanged: true');
    const updatedTwoPassDoc = parsePageSource(JSON.parse(readFileSync(ctxFile, 'utf8')).snapshot.pageSources[optTwoPassId]).doc!;
    const updatedTwoPassTbl = findNode(updatedTwoPassDoc.root, 'rp-grid-2pass')!;
    assert.deepEqual((updatedTwoPassTbl.props.columns as any[])[0], {
      title: '单号',
      dataIndex: 'document_number',
      width: 210,
      sortable: true,
    });
    assert.deepEqual(updatedTwoPassTbl.props.rowActions, [
      {
        label: '查看',
        onClick: { $kind: 'actions', calls: [{ name: 'navigate', args: [scopedPreviewPage.pageId, 'row'] }] },
      },
    ]);

    // Calling a 3rd time with identical mappings (including role='actions') now accurately returns unchanged: true!
    const thirdPassBind = call('protoflow_bind_axure_table', {
      pageId: twoPassPageId,
      targetPfId: 'rp-grid-2pass',
      tableId: 't_inv',
      mappings: [
        { headerPfId: 'tp-h-doc', role: 'field', columnId: 'c_doc' },
        { headerPfId: 'tp-h-wh', role: 'field', columnId: 'c_wh' },
        { headerPfId: 'tp-h-act', role: 'actions' },
      ],
    });
    assert.equal(thirdPassBind.unchanged, true);

    // Also verify P1 #1 target equivalence when destination page gets its verified optimized copy:
    const previewDoc = parsePageSource(committedTurn1.stateSnapshot.pageSources[scopedPreviewPage.pageId]).doc!;
    const previewGuid = scopedPreviewPage.pageId.slice('rp-page-'.length);
    const previewKids = previewDoc.root.children.filter(isNode)[0].children.filter(isNode);
    call('protoflow_reshape_axure_page', {
      pageId: scopedPreviewPage.pageId,
      source: `export default function Page() { return <Page pfId="flow-preview" title="预览（优化版）"><Card pfId="c-prev"><Text pfId="t-prev">预览内容</Text></Card></Page>; }`,
      coverage: {
        converted: previewKids.length
          ? [{ sourcePfIds: [previewKids[0].pfId], targetPfId: 't-prev', summary: '转换预览内容' }]
          : [],
      },
    });
    const optPreviewId = 'rp-optimized-' + previewGuid;
    // Now reshape approvalPageId pointing explicitly to optPreviewId -> recognized as verified copy of scopedPreviewPage.pageId!
    call('protoflow_reshape_axure_page', {
      pageId: approvalPageId,
      source: approvalFlowSource(validColsExpr, `[{ label: "查看", onClick: () => navigate("${optPreviewId}", "row") }]`),
      coverage: {
        converted: [
          {
            sourcePfIds: ['rp-grid-approval'],
            targetPfId: 'rp-grid-approval',
            summary: '补齐查看动作并指向已验证详情优化副本',
            tableId: 't_approval',
            columnMappings: [
              { headerPfId: 'ap-h-req', role: 'field', columnId: 'ap_req' },
              { headerPfId: 'ap-h-app', role: 'field', columnId: 'ap_app' },
              { headerPfId: 'ap-h-ext', role: 'pending' },
              { headerPfId: 'ap-h-act', role: 'actions' },
            ],
          },
        ],
      },
    });
    assert.ok(optApprovalPageId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
