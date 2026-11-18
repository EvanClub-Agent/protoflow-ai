import { acknowledgeToolDiscovery } from './fixtures/hermesToolDiscovery';
import { setPageMindmapLinks, deleteMindmapNode } from '../src/services/mindmapWorkspace';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HermesEngineModal } from '../src/components/HermesEngineModal';
import { installTestDom } from './dom';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from '../src/services/projectStorage';
import { projectContext } from '../src/services/hermesProject';
import { runProjectAi } from '../src/services/hermesBridge';
import { conversationKey, type HermesMindmapConversation } from '../src/services/hermesConversation';
import { extractMindmapSource, generateMindmapWithHermes, useMindmapAiStore } from '../src/services/hermesMindmap';
import type { HermesDesktopApi, HermesReply, HermesEvent } from '../src/services/hermesClient';
const { HermesRuntime, conversationKey: nativeKey } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
const { callTool, atomicWrite } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));

const generated = 'mindmap\n  root((客户业务))\n    客户档案\n      客户名称';
function fixture(projectId = 'mindmap-hermes') {
  const payload = createProjectPayload({ projectId, projectName: '客户管理工程', templateId: 'blank_project', storageDir: '/tmp', fileName: `${projectId}.pflow`, createdAt: '2026-11-01', updatedAt: '2026-11-01', pageCount: 0, tableCount: 0, stickyCount: 0 });
  Object.assign(payload.stateSnapshot, { designerFolders: [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }],
    mindmaps: { nodes: [{ id: 'map-main', kind: 'mindmap', parentId: null, title: '主脑图', source: 'mindmap\n  原有脑图' }, { id: 'map-other', kind: 'mindmap', parentId: null, title: '另一个模块', source: 'mindmap\n  其他模块' }], links: [] },
    pageSources: { customers: 'export default function Page(){return <Page pfId="root" title="客户档案"><Table pfId="grid" table="entity-customers" /></Page>}' },
    designerPages: [{ pageId: 'customers', title: '客户档案', folderId: 'folder-project-pages' }], activePageId: 'customers',
    dbTables: [{ id: 'entity-customers', tableName: 'physical_customers', cnName: '客户表', domain: '基础资料域 (MDM)', description: '', sharedByMenus: [{ pageId: 'customers', menuTitle: '客户档案', accessMode: 'CRUD 读写', fieldMappingNote: '列表' }], columns: [{ id: 'column-name', name: 'customer_name', dataType: 'VARCHAR(128)', comment: '客户名称', nullable: false }] }],
    tableRows: { 'entity-customers': [{ id: 'row-1', customer_name: '保存的客户' }, { id: 'row-2', customer_name: '另一客户' }] },
    stickyNotes: [{ id: 'requirement', pageId: 'customers', targetWidgetId: 'grid', targetWidgetName: '客户表格', text: '显示完整客户名称', compiledRule: '', index: 1, active: false }],
  });
  loadProjectFromBinaryPayload(payload);
  useMindmapAiStore.setState({ runs: {} });
  useHermesStore.setState(useHermesStore.getInitialState(), true);
  useHermesStore.setState({ status: 'running' });
  return { projectId, kind: 'mindmap', mindmapId: 'map-main' } as const;
}
function mockHermes(execute?: (input: Parameters<HermesDesktopApi['execute']>[0]) => Promise<Partial<HermesReply>>) {
  const calls: any[] = [];
  let emit: (event: HermesEvent) => void = () => {};
  const api = {
    onEvent: (listener: typeof emit) => { emit = listener; return () => {}; },
    session: async (scope: any) => ({ ...scope, sessionId: `session-${conversationKey(scope)}`, running: false, models: { currentModelId: 'test-model', availableModels: [{ modelId: 'test-model', name: 'Test' }] } }),
    sync: async (input: any) => { calls.push(input); return { synced: true }; },
    execute: async (input: any) => {
      calls.push(input);
      return { sessionId: `session-${conversationKey(input)}`, runId: 'test-mindmap-run', modelId: 'test-model', operations: [], text: '```mermaid\n' + generated + '\n```', ...await execute?.(input) };
    },
    cancel: async () => {},
  };
  (window as any).protoflowDesktop = { hermes: api };
  return { calls, emit: (event: HermesEvent) => emit(event) };
}

test('mindmap project tools read exact current pages, inactive notes, schema IDs and paginated saved rows without writes', () => {
  const scope = fixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindmap-tools-')), file = path.join(dir, 'context.json');
  try {
    atomicWrite(file, { active: true, runId: 'read-only', ...scope, readOnly: true, snapshot: projectContext(), operations: [] });
    const before = fs.readFileSync(file, 'utf8');
    const project = callTool(file, 'protoflow_get_project', {});
    assert.equal(project.tableRows, undefined, 'large row data is read through pagination');
    assert.equal(project.pageCatalog[0].title, '客户档案');
    assert.ok(!JSON.stringify(project.sitemap).includes('供应商审批'));
    assert.match(callTool(file, 'protoflow_get_page_tsx', { pageId: 'customers' }).source, /entity-customers/);
    assert.equal(callTool(file, 'protoflow_get_sticky_notes', { pageId: 'customers' }).stickyNotes[0].active, false);
    assert.equal(callTool(file, 'protoflow_get_db_table', { tableId: 'entity-customers' }).table.tableName, 'physical_customers');
    assert.throws(() => callTool(file, 'protoflow_get_db_table', { tableId: 'physical_customers' }), /Unknown tableId/);
    assert.throws(() => callTool(file, 'protoflow_get_sticky_notes', { pageId: '客户档案' }), /Unknown pageId/);
    const first = callTool(file, 'protoflow_get_table_rows', { tableId: 'entity-customers', limit: 1 });
    assert.equal(first.rows[0].customer_name, '保存的客户'); assert.equal(first.nextOffset, 1);
    assert.equal(callTool(file, 'protoflow_get_table_rows', { tableId: 'entity-customers', offset: first.nextOffset }).rows[0].id, 'row-2');
    assert.throws(() => callTool(file, 'protoflow_get_table_rows', { tableId: 'entity-customers', limit: 0 }), /offset\/limit/);
    assert.throws(() => callTool(file, 'protoflow_apply_tsx_patch', { pageId: 'customers', source: '' }), /read-only/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const context = JSON.parse(before); context.snapshot.tableRows = {}; atomicWrite(file, context);
    const missing = callTool(file, 'protoflow_get_table_rows', { tableId: 'entity-customers' });
    assert.equal(missing.hasSavedRows, false); assert.deepEqual(missing.rows, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Hermes generates through a separate read-only mindmap session, validates real Mermaid and changes only the mindmap', async () => {
  const cleanup = installTestDom();
  try {
    const scope = fixture();
    setPageMindmapLinks(scope.projectId, { kind: 'page', pageId: 'customers' }, [scope.mindmapId]);
    const h = mockHermes(async () => {
      // Switching selection during inference must not redirect the result.
      useProtoStore.setState({ selectedMindmapNodeId: 'map-other' });
      assert.throws(() => deleteMindmapNode(scope.projectId, scope.mindmapId), /停止/);
      return {};
    }), before = captureProjectPayload().stateSnapshot;
    const chat = useAiChatStore.getState().byConversation;
    await generateMindmapWithHermes(scope.projectId, scope.mindmapId, '根据客户页面、便签和表数据生成脑图');
    const input = h.calls.find(call => call.prompt);
    assert.equal(input.snapshot.currentMindmap.mindmapId, scope.mindmapId);
    assert.deepEqual(input.snapshot.currentMindmap.relatedPageIds, ['customers']);
    assert.equal(useProtoStore.getState().selectedMindmapNodeId, 'map-other');
    assert.equal(input.kind, 'mindmap'); assert.equal(input.pageId, undefined); assert.equal(input.readOnly, true);
    assert.equal(input.snapshot.tableRows['entity-customers'][0].customer_name, '保存的客户');
    assert.match(input.prompt, /protoflow_get_page_tsx/);
    assert.match(input.prompt, /protoflow_get_sticky_notes/);
    assert.match(input.prompt, /protoflow_get_db_table/);
    assert.equal(h.calls[0].kind, 'mindmap');
    assert.equal(useProtoStore.getState().mindmaps.nodes[0].source, generated);
    assert.deepEqual(captureProjectPayload().stateSnapshot, { ...before, mindmaps: { ...before.mindmaps, nodes: before.mindmaps.nodes.map(node => node.id === scope.mindmapId ? { ...node, source: generated } : node) } });
    assert.equal(useAiChatStore.getState().byConversation, chat);
    assert.equal(useMindmapAiStore.getState().runs[conversationKey(scope)].status, 'done');
  } finally { cleanup(); }
});

test('mindmaps work without any menu page and never synthesize a page ID', async () => {
  const cleanup = installTestDom();
  try {
    const scope = fixture();
    usePageStore.setState({ pageSources: {}, designerPages: [], designerFolders: [], sitemapBase: [] });
    useProtoStore.setState({ activePageId: '' });
    const h = mockHermes();
    await generateMindmapWithHermes(scope.projectId, scope.mindmapId, '画一个规划脑图');
    assert.equal(h.calls.find(call => call.prompt).pageId, undefined);
    assert.equal(useProtoStore.getState().activePageId, '');
  } finally { cleanup(); }
});

test('bad syntax, wrong sessions and unexpected write operations never replace an existing mindmap', async () => {
  const cleanup = installTestDom();
  try {
    for (const reply of [{ text: '```mermaid\nmindmap\n  a\n  b\n```' }, { text: '只有说明没有脑图' }, { sessionId: 'another-session' }, { operations: [{ tool: 'protoflow_apply_tsx_patch', args: {} }] }]) {
      const scope = fixture(); mockHermes(async () => reply);
      const source = useProtoStore.getState().mindmaps.nodes[0].source;
      await assert.rejects(generateMindmapWithHermes(scope.projectId, scope.mindmapId, '生成脑图'));
      assert.equal(useProtoStore.getState().mindmaps.nodes[0].source, source);
      assert.equal(useMindmapAiStore.getState().runs[conversationKey(scope)].status, 'error');
    }
    assert.throws(() => extractMindmapSource('```mermaid\nmindmap\n a\n```\n```mermaid\nmindmap\n b\n```'));
  } finally { cleanup(); }
});

test('cancellation, manual edits, context changes and project switches reject late brain-map results', async () => {
  const cleanup = installTestDom();
  try {
    for (const action of ['stop', 'manual', 'context', 'switch', 'relocate', 'deleted']) {
      const scope = fixture();
      let finish!: () => void, entered!: () => void;
      const gate = new Promise<void>(resolve => { finish = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      mockHermes(async () => { entered(); await gate; return {}; });
      const pending = generateMindmapWithHermes(scope.projectId, scope.mindmapId, '生成脑图');
      await started;
      await assert.rejects(runProjectAi('修改页面'), /已有 AI 任务/);
      if (action === 'stop') await useHermesStore.getState().stop(scope);
      if (action === 'manual') useProtoStore.getState().setMindmapSource(scope.projectId, scope.mindmapId, 'mindmap\n  手动编辑');
      if (action === 'deleted') useProtoStore.setState(state => ({ mindmaps: { ...state.mindmaps, nodes: state.mindmaps.nodes.filter(node => node.id !== scope.mindmapId) } }));
      if (action === 'context') usePageStore.getState().setPageSource('customers', 'export default function Page(){return <Page pfId="root" title="最新页面"/>}');
      if (action === 'relocate') useProtoStore.setState(state => ({ currentProjectMeta: { ...state.currentProjectMeta, fileName: 'another-copy.pflow' } }));
      if (action === 'switch') {
        const other = captureProjectPayload();
        other.meta = { ...other.meta, projectId: 'another-project', fileName: 'another.pflow' };
        loadProjectFromBinaryPayload(other);
      }
      const before = captureProjectPayload().stateSnapshot;
      finish(); await assert.rejects(pending, /已停止|已变化/);
      assert.deepEqual(captureProjectPayload().stateSnapshot, before);
    }
  } finally { cleanup(); }
});

test('mindmap questions and permissions remain visible only in the brain-map workspace', async () => {
  const scope = fixture(), h = mockHermes();
  await useHermesStore.getState().ensureSession(scope);
  h.emit({ type: 'question', ...scope, id: 'brain-question', message: '脑图需补充信息', answerSchema: { type: 'string' } });
  h.emit({ type: 'permission', ...scope, id: 'brain-permission', toolCall: { title: '脑图工具授权' }, options: [] });
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(React.createElement(HermesEngineModal)); });
    assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
    act(() => useProtoStore.getState().setViewMode('mindmap'));
    assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 2);
    act(() => useProtoStore.setState({ selectedMindmapNodeId: 'map-other' }));
    assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
    act(() => useProtoStore.getState().setViewMode('single_page'));
    assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  } finally { act(() => renderer?.unmount()); useHermesStore.setState({ questions: [], permissions: [] }); }
});

test('native brain-map sessions persist separately from even a page named mindmap, restrict writes, stream and cancel with their exact scope', async () => {
  const scope: HermesMindmapConversation = { projectId: 'native-brain', kind: 'mindmap', mindmapId: 'map-main' };
  const page = { projectId: scope.projectId, pageId: 'mindmap' };
  assert.notEqual(conversationKey(scope), conversationKey(page));
  assert.equal(nativeKey(scope), conversationKey(scope));
  assert.throws(() => nativeKey({ ...scope, pageId: 'borrowed' }), /菜单 ID/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-brain-')), events: any[] = [];
  let number = 0;
  const models = { currentModelId: 'test-model', availableModels: [{ modelId: 'test-model' }] };
  const runtime = new HermesRuntime({ dataDir: dir, emit: (event: any) => events.push(event) });
  runtime.connect = async () => ({});
  runtime.client = { close() {}, notify() {}, request: async (method: string, args: any) => {
    acknowledgeToolDiscovery(args);
    if (method === 'session/new') return { sessionId: `session-${++number}`, models };
    if (method === 'session/load') return { models };
    if (method === 'session/prompt') {
      const state = runtime.sessions.get(nativeKey(scope));
      const contextFile = path.join(state.dir, 'context.json');
      assert.equal(callTool(contextFile, 'protoflow_get_project', {}).projectId, scope.projectId);
      assert.throws(() => callTool(contextFile, 'protoflow_upsert_sticky_contract', { sticky: {} }), /read-only/);
      runtime.onNotification({ method: 'session/update', params: { sessionId: args.sessionId, _meta: { alex_run_id: args._meta?.alex_run_id, admission_id: 'aid-mindmap-1' }, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: generated } } } });
      return { stopReason: 'end_turn' };
    }
    return {};
  } };
  try {
    const brain = await runtime.session(scope), menu = await runtime.session(page);
    assert.equal(brain.kind, 'mindmap'); assert.equal(brain.pageId, undefined); assert.notEqual(brain.sessionId, menu.sessionId);
    const another = { ...scope, mindmapId: 'map-other' };
    const otherSession = await runtime.session(another);
    assert.notEqual(otherSession.sessionId, brain.sessionId);
    assert.notEqual(runtime.conversationWorkspace(another), runtime.conversationWorkspace(scope));
    await runtime.sync({ ...another, skillMarkdown: 'other map instructions' });
    await runtime.sync({ projectId: scope.projectId, skillMarkdown: 'page instructions' });
    await runtime.sync({ ...scope, skillMarkdown: 'brain instructions' });
    assert.equal(fs.readFileSync(path.join(runtime.conversationWorkspace(scope), 'AGENTS.md'), 'utf8'), 'brain instructions');
    assert.equal(fs.readFileSync(path.join(runtime.conversationWorkspace(page), 'AGENTS.md'), 'utf8'), 'page instructions');
    assert.equal(fs.readFileSync(path.join(runtime.conversationWorkspace(another), 'AGENTS.md'), 'utf8'), 'other map instructions');
    assert.throws(() => nativeKey({ projectId: scope.projectId, kind: 'mindmap' }), /脑图菜单 ID/);
    const input = { ...scope, prompt: 'generate', snapshot: { projectId: scope.projectId, pageSources: {}, contracts: {} }, readOnly: true };
    await assert.rejects(runtime.execute({ ...input, readOnly: false }), /只允许读取/);
    const result = await runtime.execute(input); assert.equal(result.text, generated); assert.deepEqual(result.operations, []);
    assert.ok(events.some(event => event.type === 'session-update' && event.kind === 'mindmap' && event.pageId === undefined));
    runtime.sessions.clear();
    assert.equal((await runtime.session(scope)).sessionId, brain.sessionId);
    let finish!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    runtime.client.request = async () => { entered(); await gate; return { stopReason: 'end_turn' }; };
    const task = runtime.execute(input); await started;
    runtime.cancel(scope); finish(); await assert.rejects(task, /已停止/);
  } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('one bounded syntax repair uses the same exact map scope and applies only validated source', async () => {
  const cleanup = installTestDom();
  try {
    const scope = fixture();
    const before = captureProjectPayload().stateSnapshot;
    let count = 0;
    const h = mockHermes(async input => {
      count++;
      assert.deepEqual(captureProjectPayload().stateSnapshot, before, 'invalid draft must never be saved during repair');
      assert.equal(input.mindmapId, scope.mindmapId);
      assert.equal(input.readOnly, true);
      return count === 1 ? { text: '```mermaid\nmindmap\n  one\n  two\n```' } : {};
    });
    await generateMindmapWithHermes(scope.projectId, scope.mindmapId, '生成模块脑图');
    assert.equal(count, 2);
    assert.match(h.calls.filter(call => call.prompt)[1].prompt, /校验信息/);
    assert.equal(useProtoStore.getState().mindmaps.nodes[0].source, generated);
    assert.deepEqual(useProtoStore.getState().mindmaps.nodes[1], before.mindmaps.nodes[1]);
  } finally { cleanup(); }
});

test('selected diagram type reaches Hermes; YAML flowcharts are applied to the exact document and a wrong type is repaired once', async () => {
  const cleanup = installTestDom();
  try {
    const scope = fixture(), before = captureProjectPayload().stateSnapshot;
    const flow = '---\nconfig:\n  layout: dagre\n---\nflowchart TB\n  A[客户申请] --> B{审核通过}\n  B -->|通过| C[已确认]';
    let count = 0;
    const h = mockHermes(async () => ++count === 1 ? {} : { text: '```mermaid\n' + flow + '\n```' });
    await generateMindmapWithHermes(scope.projectId, scope.mindmapId, '绘制审批流程', 'flowchart');
    assert.equal(count, 2, 'a valid mindmap still needs correction when a flowchart was selected');
    assert.match(h.calls.find(call => call.prompt).prompt, /用户选择的图表类型：流程图/);
    assert.equal(useProtoStore.getState().mindmaps.nodes[0].source, flow);
    assert.deepEqual(useProtoStore.getState().mindmaps.nodes[1], before.mindmaps.nodes[1]);
    await assert.rejects(generateMindmapWithHermes(scope.projectId, scope.mindmapId, '绘制', 'unknown'), /未知/);
  } finally { cleanup(); }
});
