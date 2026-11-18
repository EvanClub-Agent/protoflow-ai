import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from '../src/services/projectStorage';
import { projectContext, projectRevision, undoProjectChange } from '../src/services/hermesProject';
import { runProjectAi } from '../src/services/hermesBridge';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { useAiPreviewStore } from '../src/store/useAiPreviewStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { conversationKey } from '../src/services/hermesConversation';
import { AiStreamingPreview } from '../src/proto/designer/AiStreamingPreview';
import { editPageBlock } from '../src/proto/dsl/editBlock';
import { validateMaterialSource } from '../src/proto/registry/materialContract';
import type { HermesEvent, HermesReply } from '../src/services/hermesClient';
import { installTestDom } from './dom';

const { callTool, atomicWrite } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const { watchStagedPages } = require(path.join(process.cwd(), 'electron/hermes-preview.cjs'));
const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
const source = (body = '') => `export default function Page(){return <Page pfId="root" title="页面">${body}</Page>}`;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const scope = { projectId: 'stream-test', pageId: 'main' };
const key = conversationKey(scope);
const start: HermesEvent = { type: 'run-start', ...scope, sessionId: 'session', runId: 'run' };
const preview = (code: string, sequence: number, targetPageId = 'main'): HermesEvent => ({ ...start, type: 'page-preview', preview: { targetPageId, source: code, sequence, dbTables: [] } });
function fixture() {
  useAiPreviewStore.setState({ runs: {} });
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
  const base = createProjectPayload({ ...scope, projectName: '流式测试', storageDir: '/tmp/stream-test', fileName: 'stream.pflow', templateId: 'blank_project', createdAt: '2026-10-31', updatedAt: '2026-10-31', pageCount: 0, tableCount: 0, stickyCount: 0 });
  base.stateSnapshot.designerFolders = [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }];
  base.stateSnapshot.pageSources = { main: source('<Text pfId="before">原始页面</Text>'), other: source('<Text pfId="other">其他页面</Text>') };
  base.stateSnapshot.designerPages = ['main', 'other'].map(pageId => ({ pageId, title: pageId, folderId: 'folder-project-pages' }));
  base.stateSnapshot.activePageId = 'main';
  loadProjectFromBinaryPayload(base);
  return base;
}
function mockBridge() {
  const listeners = new Set<(event: HermesEvent) => void>();
  const emit = (event: HermesEvent) => listeners.forEach(fn => fn(event));
  let enter!: () => void, finish!: (reply: HermesReply) => void, fail!: (error: Error) => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const result = new Promise<HermesReply>((resolve, reject) => { finish = resolve; fail = reject; });
  (window as any).protoflowDesktop = { hermes: {
    onEvent: (listener: (event: HermesEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    session: async () => ({ ...scope, sessionId: 'session', running: false, models: { currentModelId: 'model', availableModels: [{ modelId: 'model', name: 'Model' }] } }),
    sync: async () => ({ synced: true }),
    execute: async () => { emit(start); enter(); return result; },
    cancel: async () => { fail(new Error('已停止生成，未应用修改')); },
  } };
  useHermesStore.setState({ status: 'running', sessions: {}, runningProjects: {}, runningPageByProject: {}, partial: {}, cancelGeneration: {} });
  return { emit, entered, finish, fail };
}
const reply = (codes: string[]): HermesReply => ({ text: '页面完成', sessionId: 'session', runId: 'run', modelId: 'model', operations: codes.map(code => ({ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'main', source: code } })) });

test('incremental MCP appends/replaces valid blocks and rejects incomplete or invented content without staging', () => {
  fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-tool-')), file = path.join(dir, 'context.json');
  try {
    atomicWrite(file, { active: true, ...scope, runId: 'run', snapshot: projectContext(), operations: [] });
    const edit = (mode: string, targetPfId: string, tsx: string) => callTool(file, 'protoflow_edit_page_block', { pageId: 'main', mode, targetPfId, tsx });
    edit('append_children', 'root', '<Card pfId="card" title="新增"><Text pfId="content">区块一</Text></Card>');
    edit('replace_node', 'content', '<Text pfId="content">已更新</Text>');
    const ctx = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(ctx.operations.length, 2);
    assert.ok(ctx.operations.every((op: any) => op.tool === 'protoflow_apply_tsx_patch'));
    assert.match(ctx.snapshot.pageSources.main, /原始页面/);
    assert.match(ctx.snapshot.pageSources.main, /已更新/);
    assert.deepEqual(validateMaterialSource(ctx.snapshot.pageSources.main), []);
    const before = fs.readFileSync(file, 'utf8');
    for (const [mode, target, block] of [
      ['append_children', 'root', '<Button pfId="bad" imaginary />'],
      ['append_children', 'root', '<Card pfId="unfinished">'],
      ['append_children', 'root', '<Text>缺少标识</Text>'],
      ['append_children', 'root', '<Text pfId="before">重复标识</Text>'],
      ['replace_node', 'card', '<Card pfId="new-id"/>'],
      ['append_children', 'content', '<Text pfId="bad">叶子节点</Text>'],
      ['append_children', 'missing', '<Text pfId="bad">不存在的目标</Text>'],
    ]) {
      assert.throws(() => edit(mode, target, block));
      assert.equal(fs.readFileSync(file, 'utf8'), before);
    }
    atomicWrite(file, { ...ctx, readOnly: true });
    assert.throws(() => edit('append_children', 'root', '<Text pfId="bad"/>'), /read-only/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('native watcher emits accepted blocks before completion and stops on cancellation/foreign context', async () => {
  fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-watch-')), file = path.join(dir, 'context.json');
  const events: HermesEvent[] = [];
  const ctx = { active: true, ...scope, runId: 'run', snapshot: projectContext(), operations: [] };
  atomicWrite(file, ctx);
  const watcher = watchStagedPages(file, { ...scope, sessionId: 'session', runId: 'run' }, (e: HermesEvent) => events.push(e), () => true);
  try {
    callTool(file, 'protoflow_edit_page_block', { pageId: 'main', targetPfId: 'root', mode: 'append_children', tsx: '<Text pfId="live">实时出现</Text>' });
    for (let i = 0; i < 50 && !events.length; i++) await delay(20);
    assert.equal(events.length, 1);
    assert.match(events[0].preview!.source, /实时出现/);
    assert.equal(events[0].runId, 'run');
    watcher.flush(); assert.equal(events.length, 1, 'unchanged content is not replayed');
    const staged = JSON.parse(fs.readFileSync(file, 'utf8'));
    atomicWrite(file, { ...staged, projectId: 'foreign', operations: [...staged.operations, ...staged.operations] });
    watcher.flush(); assert.equal(events.length, 1);
    atomicWrite(file, { ...staged, active: false });
    watcher.flush(); assert.equal(events.length, 1);
    watcher.close();
    atomicWrite(file, { ...staged, operations: [...staged.operations, ...staged.operations] });
    watcher.flush(); assert.equal(events.length, 1);
  } finally { watcher.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('native and renderer streaming previews reject schema-only chart metrics before showing a broken chart', () => {
  fixture();
  const dbTables = [{ id: 'quarters', tableName: 't_quarters', cnName: '季度', domain: '基础资料域 (MDM)' as const, description: '', sharedByMenus: [], columns: [
    { id: 'quarter-col', name: 'quarter', dataType: 'TEXT', nullable: false, comment: '季度' },
    { id: 'profit-col', name: 'profit', dataType: 'DECIMAL', nullable: false, comment: '利润' },
    { id: 'rate-col', name: 'profit_qoq_rate', dataType: 'DECIMAL', nullable: false, comment: '利润环比' },
  ] }];
  const tableRows = { quarters: [{ id: 'quarter-1', quarter: '2026-Q1', profit: 100 }] };
  const good = source('<LineChart pfId="chart" source="table" table="quarters" dimension="quarter" metrics={[{field:"profit",label:"利润"}]}/>');
  const bad = good.replace('field:"profit"', 'field:"profit_qoq_rate"');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-chart-data-')), file = path.join(dir, 'context.json');
  const events: HermesEvent[] = [];
  const ctx = { active: true, ...scope, runId: 'run', snapshot: { pageSources: { main: bad }, dbTables, tableRows }, operations: [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'main', source: bad } }] };
  atomicWrite(file, ctx);
  const watcher = watchStagedPages(file, { ...scope, sessionId: 'session', runId: 'run' }, (event: HermesEvent) => events.push(event), () => true);
  try {
    watcher.flush(); assert.equal(events.length, 0);
    ctx.snapshot.pageSources.main = good;
    ctx.operations.push({ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'main', source: good } });
    atomicWrite(file, ctx); watcher.flush(); assert.equal(events.length, 1);
    const store = useAiPreviewStore.getState();
    store.begin(scope, 'session', tableRows); store.receive(start);
    store.receive({ ...start, type: 'page-preview', preview: { targetPageId: 'main', source: bad, sequence: 1, dbTables } });
    assert.equal(useAiPreviewStore.getState().runs[key].latestPageId, null);
    store.receive(events[0]);
    assert.equal(useAiPreviewStore.getState().runs[key].pages.main.source, good);
    assert.deepEqual(useAiPreviewStore.getState().runs[key].tableRows, tableRows);
  } finally { watcher.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Hermes execute publishes a staged page while the model is still running and cleans up on cancel', async () => {
  fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-runtime-'));
  const events: HermesEvent[] = [];
  const runtime = new HermesRuntime({ dataDir: dir, emit: (event: HermesEvent) => events.push(event) });
  const session = { ...scope, sessionId: 'session', dir, models: { currentModelId: 'model', availableModels: [] }, running: false };
  runtime.sessions.set(key, session);
  runtime.ensureSession = async () => session;
  let finish!: (value: unknown) => void;
  runtime.client = { request: () => new Promise(resolve => { finish = resolve; }), notify: () => {} };
  const task = runtime.execute({ ...scope, prompt: '生成页面', snapshot: projectContext() });
  const rejected = assert.rejects(task, /已停止/);
  try {
    for (let i = 0; i < 50 && !events.some(e => e.type === 'run-start'); i++) await delay(10);
    callTool(path.join(dir, 'context.json'), 'protoflow_edit_page_block', { pageId: 'main', targetPfId: 'root', mode: 'append_children', tsx: '<Text pfId="live">提前显示</Text>' });
    for (let i = 0; i < 50 && !events.some(e => e.type === 'page-preview'); i++) await delay(20);
    assert.equal(session.running, true);
    assert.ok(events.some(e => e.type === 'page-preview'));
    runtime.cancel(scope);
    assert.throws(() => callTool(path.join(dir, 'context.json'), 'protoflow_edit_page_block', { pageId: 'main', targetPfId: 'root', mode: 'append_children', tsx: '<Text pfId="late"/>' }), /No active/);
    finish({ stopReason: 'cancelled' }); await rejected;
    assert.equal(events.at(-1)?.type, 'run-end');
    assert.equal((session as any).stopPreview, undefined);
  } finally { if (session.running) { runtime.cancel(scope); finish({ stopReason: 'cancelled' }); await rejected; } fs.rmSync(dir, { recursive: true, force: true }); }
});

test('preview store rejects stale runs, wrong sessions, invalid materials and reversed updates', () => {
  fixture();
  const store = useAiPreviewStore.getState();
  store.begin(scope, 'session', {});
  store.receive(preview(source(), 1)); assert.equal(useAiPreviewStore.getState().runs[key].latestPageId, null);
  store.receive(start);
  store.receive({ ...preview(source(), 1), sessionId: 'wrong' });
  store.receive({ ...preview(source(), 1), runId: 'old-run' });
  store.receive({ ...preview(source(), 1), projectId: 'other-project' });
  store.receive(preview(source('<Text pfId="x" text="invalid"/>'), 1));
  assert.equal(useAiPreviewStore.getState().runs[key].latestPageId, null);
  store.receive(preview(source('<Text pfId="x">第二块</Text>'), 2));
  store.receive(preview(source(), 1));
  assert.match(useAiPreviewStore.getState().runs[key].pages.main.source, /第二块/);
  store.clear(scope); store.receive(preview(source(), 3));
  assert.equal(useAiPreviewStore.getState().runs[key], undefined);
});

test('text and page blocks appear before final reply without archive/history writes, then commit once and undo together', async () => {
  const base = fixture(), mock = mockBridge();
  const before = projectRevision();
  const task = runProjectAi('生成包含多个区块的页面'); await mock.entered;
  const one = source('<Card pfId="one" title="第一区块"/>');
  const two = editPageBlock(one, 'root', 'append_children', '<Text pfId="two">第二区块</Text>');
  mock.emit(preview(one, 1));
  assert.equal(useAiPreviewStore.getState().runs[key].pages.main.source, one);
  mock.emit({ ...start, type: 'session-update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '正在生成' } } });
  mock.emit({ ...start, type: 'session-update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '第二区块' } } });
  await delay(70);
  assert.equal(useAiChatStore.getState().messages.at(-1)?.text, '正在生成第二区块');
  const persisted = window.localStorage.getItem(`protoflow_ai_chat_v3:${encodeURIComponent(key)}`)!;
  assert.ok(!persisted.includes('正在生成第二区块'));
  mock.emit(preview(two, 2));
  assert.equal(projectRevision(), before);
  assert.deepEqual(captureProjectPayload().stateSnapshot.pageSources, base.stateSnapshot.pageSources);
  assert.equal(usePageStore.getState().history.main, undefined);
  mock.finish(reply([one, two])); await task;
  assert.match(usePageStore.getState().pageSources.main, /第二区块/);
  assert.equal(usePageStore.getState().history.main.past.length, 1);
  assert.equal(useAiPreviewStore.getState().runs[key], undefined);
  assert.equal(useAiChatStore.getState().messages.at(-1)?.text, '页面完成');
  undoProjectChange('run'); assert.equal(usePageStore.getState().pageSources.main, base.stateSnapshot.pageSources.main);
});

test('cancel, provider failure and final validation failure discard previews without changing the project', async () => {
  for (const outcome of ['cancel', 'provider', 'invalid-final']) {
    fixture(); const mock = mockBridge(), before = projectRevision();
    const task = runProjectAi('生成'); const rejected = assert.rejects(task);
    await mock.entered;
    mock.emit(preview(source('<Text pfId="x">预览内容</Text>'), 1));
    assert.ok(useAiPreviewStore.getState().runs[key].pages.main);
    if (outcome === 'cancel') {
      await useHermesStore.getState().stop(scope);
      assert.equal(useAiPreviewStore.getState().runs[key], undefined);
    } else if (outcome === 'provider') mock.fail(new Error('provider disconnected'));
    else mock.finish(reply([source('<Button pfId="x" madeUp />')]));
    await rejected;
    assert.equal(useAiPreviewStore.getState().runs[key], undefined);
    assert.equal(projectRevision(), before);
    mock.emit(preview(source(), 10)); assert.equal(useAiPreviewStore.getState().runs[key], undefined);
  }
});

test('manual edits invalidate a live draft and the final commit preserves the newer source', async () => {
  fixture(); const mock = mockBridge();
  const task = runProjectAi('修改'); const rejected = assert.rejects(task, /等待期间/); await mock.entered;
  mock.emit(preview(source(), 1));
  const manual = source('<Text pfId="manual">手动修改</Text>');
  usePageStore.getState().setPageSource('main', manual);
  mock.emit(preview(source('<Text pfId="x">后续内容</Text>'), 2));
  assert.equal(useAiPreviewStore.getState().runs[key], undefined);
  mock.finish(reply([source()])); await rejected;
  assert.equal(usePageStore.getState().pageSources.main, manual);
});

test('live preview renders staged table fields, stays scoped to its chat and never seeds project rows', async () => {
  const restore = installTestDom();
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    fixture(); const before = projectRevision();
    const table = { id: 'staged-table', tableName: 'staged', cnName: '新表', domain: '基础资料域 (MDM)', description: '', columns: [{ id: 'column', name: 'actual_field', comment: '真实字段', dataType: 'TEXT', nullable: true }], sharedByMenus: [] };
    useAiPreviewStore.getState().begin(scope, 'session', {}); useAiPreviewStore.getState().receive(start);
    const event = preview(source('<Table pfId="table" table="staged-table"/><Form pfId="form" table="staged-table"/>'), 1, 'new-page');
    event.preview!.dbTables = [table]; useAiPreviewStore.getState().receive(event);
    await act(async () => { renderer = TestRenderer.create(React.createElement(AiStreamingPreview, scope)); });
    assert.match(JSON.stringify(renderer!.toJSON()), /真实字段/);
    assert.equal(renderer!.root.findByProps({ 'data-ai-preview-page': 'new-page' }).props.className.includes('pointer-events-none'), true);
    await act(async () => { renderer!.update(React.createElement(AiStreamingPreview, { ...scope, pageId: 'other' })); });
    assert.equal(renderer!.toJSON(), null);
    assert.equal(projectRevision(), before);
    assert.deepEqual(usePageStore.getState().tableRows, {});
  } finally { act(() => renderer?.unmount()); restore(); }
});
