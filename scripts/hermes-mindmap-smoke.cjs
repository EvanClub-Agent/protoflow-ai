// Opt-in real inference against an isolated synthetic project. Existing user
// projects/sessions are never opened; only the configured Hermes runtime is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const { JSDOM } = require('jsdom');
const { hermesTestEnvironment } = require('./hermes-test-environment.cjs');
const { HermesRuntime } = require('../electron/hermes-runtime.cjs');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-mindmap-live-'));
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
const result = buildSync({
  stdin: { contents: `export * from './src/services/hermesMindmap'; export * from './src/services/projectStorage'; export { useHermesStore } from './src/store/useHermesStore';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'mermaid', '@mermaid-js/mermaid-zenuml'],
});
const moduleHarness = new Module('hermes-mindmap-live');
moduleHarness.filename = path.join(root, 'scripts/.hermes-mindmap-live.cjs');
moduleHarness.paths = Module._nodeModulePaths(root);
moduleHarness._compile(result.outputFiles[0].text, moduleHarness.filename);
const h = moduleHarness.exports;
const listeners = new Set(), calls = [];
const runtime = new HermesRuntime({ dataDir: dir, emit: event => {
  for (const listener of listeners) listener(event);
  if (event.type === 'session-update' && event.update.sessionUpdate === 'tool_call') {
    calls.push(event.update.title);
    console.log(`Tool: ${event.update.title}`);
  }
  if (event.type === 'permission') runtime.respondPermission({ id: event.id, optionId: null });
  if (event.type === 'question') runtime.respondQuestion({ id: event.id, answer: null });
} });
window.protoflowDesktop = { hermes: {
  onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  session: input => runtime.session(input), sync: input => runtime.sync(input), execute: input => runtime.execute(input), cancel: input => runtime.cancel(input),
} };
const scope = { projectId: 'isolated-mindmap-live', kind: 'mindmap', mindmapId: 'customer-map' };
const timeout = setTimeout(() => { console.error('Real Hermes mindmap test timed out'); runtime.close(); process.exit(1); }, 180000);
(async () => {
  try {
    const payload = h.createProjectPayload({ projectId: scope.projectId, projectName: '客户管理验收工程', templateId: 'blank_project', storageDir: dir, fileName: 'smoke.pflow', createdAt: '2026-11-01', updatedAt: '2026-11-01', pageCount: 0, tableCount: 0, stickyCount: 0 });
    Object.assign(payload.stateSnapshot, {
      designerFolders: [{id:'folder-project-pages', title:'测试目录', parentFolderId:null}],
      mindmaps: { nodes: [{ id: scope.mindmapId, kind: 'mindmap', title: '客户模块', parentId: null, source: '' }, { id: 'other-map', kind: 'mindmap', title: '其他模块', parentId: null, source: 'mindmap\n  其他内容' }], links: [{ page: { kind: 'page', pageId: 'customers' }, targetNodeId: scope.mindmapId }] },
      activePageId: 'customers',
      pageSources: { customers: 'export default function Page(){return <Page pfId="customer-root" title="客户管理"><Table pfId="customer-grid" table="customer-entity" columns={[{title:"客户名称",dataIndex:"customer_name"}]}/></Page>}' },
      designerPages: [{ pageId: 'customers', title: '客户管理', folderId: 'folder-project-pages' }],
      dbTables: [{ id: 'customer-entity', tableName: 't_customer', cnName: '客户档案', domain: '基础资料域 (MDM)', description: '验收数据表', sharedByMenus: [{ pageId: 'customers', menuTitle: '客户管理', accessMode: 'READ 查询', fieldMappingNote: '客户列表' }], columns: [{ id: 'name-column', name: 'customer_name', dataType: 'VARCHAR(100)', comment: '客户名称', nullable: false }] }],
      stickyNotes: [{ id: 'customer-note', pageId: 'customers', targetWidgetId: 'customer-grid', targetWidgetName: '客户表格', text: '待实现需求：客户等级筛选', compiledRule: '', active: true, index: 1 }],
      tableRows: { 'customer-entity': [{ id: 'sample-1', customer_name: '验收测试客户' }] },
    });
    h.loadProjectFromBinaryPayload(payload);
    await runtime.connect(hermesTestEnvironment()); h.useHermesStore.setState({ status: 'running' });
    const before = h.captureProjectPayload().stateSnapshot;
    const diagramType = process.env.PFLOW_HERMES_DIAGRAM_TYPE || 'mindmap';
    const source = await h.generateMindmapWithHermes(scope.projectId, scope.mindmapId, '请根据本工程的实际客户页面，生成所选类型的客户管理图表。必须先使用项目目录、页面源码、便签、表结构、已保存表数据这五类读取工具，脑图包含已实现页面功能、待实现需求、字段与保存的样例数据概况，不超过 15 个节点。不需要向用户提问。', diagramType);
    if (diagramType === 'mindmap') assert.match(source, /^mindmap\b/); else assert.match(source, /flowchart\b/); assert.match(source, /客户/);
    assert.deepEqual(h.captureProjectPayload().stateSnapshot, { ...before, mindmaps: { ...before.mindmaps, nodes: before.mindmaps.nodes.map(node => node.id === scope.mindmapId ? { ...node, source } : node) } });
    for (const tool of ['protoflow_get_project', 'protoflow_get_page_tsx', 'protoflow_get_sticky_notes', 'protoflow_get_db_table', 'protoflow_get_table_rows']) assert.ok(calls.some(call => call.includes(tool)), `Missing actual read: ${tool}`);
    console.log('PASS live Hermes: read actual menu/page/notes/schema/saved rows, validated Mermaid, updated only isolated project mindmap');
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  finally { clearTimeout(timeout); runtime.close(); dom.window.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})();
