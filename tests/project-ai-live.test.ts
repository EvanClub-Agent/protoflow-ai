import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { useAiPreviewStore } from '../src/store/useAiPreviewStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { captureProjectPayload, createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { projectRevision } from '../src/services/hermesProject';
import { discussProject, generateProject, useProjectWorkflow, warmProjectSession } from '../src/services/projectWorkflow';
import { conversationKey } from '../src/services/hermesConversation';
import { projectChatScope } from '../src/services/projectChatHistory';
import type { HermesEvent, HermesReply } from '../src/services/hermesClient';
import { thinkingProgress, toolProgressLabel, THINKING_PROGRESS } from '../src/services/hermesProgress';

const { tools } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const { atomicWrite } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const { watchStagedPages } = require(path.join(process.cwd(), 'electron/hermes-preview.cjs'));
const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
const source = (text: string) => `export default function Page(){return <Page pfId="root" title="订单"><Card pfId="content" title="${text}"/></Page>}`;
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture(id: string) {
  const payload = createProjectPayload({ projectId: id, projectName: '项目实时预览', templateId: 'blank_project',
    storageDir: '/tmp', fileName: `${id}.pflow`, createdAt: '2026-11-12', updatedAt: '2026-11-12', pageCount: 0, tableCount: 0, stickyCount: 0 });
  payload.stateSnapshot.designerFolders = [{ id: 'orders-folder', title: '订单', parentFolderId: null }];
  payload.stateSnapshot.designerPages = [{ pageId: 'orders', title: '订单', folderId: 'orders-folder', platform: 'desktop' }];
  payload.stateSnapshot.pageSources = { orders: source('原页面') };
  payload.stateSnapshot.activePageId = 'orders';
  payload.stateSnapshot.projectPlan = { summary: '展示订单', folders: payload.stateSnapshot.designerFolders,
    pages: [{ pageId: 'orders', title: '订单', folderId: 'orders-folder', requirements: '展示订单内容', dependencies: [],
      acceptanceCases: [{ scenario: '查看订单内容', expected: '展示内容区块' }] }], approved: true, generatedPageIds: [] };
  loadProjectFromBinaryPayload(payload);
  useAiPreviewStore.setState({ runs: {} });
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {}, projectIndexes: {} });
  useAiChatStore.getState().loadProjectIndex(id);
  useAiChatStore.getState().newProjectChat(id);
  const index = useAiChatStore.getState().projectIndexes[id];
  const scope = projectChatScope(id, index.activeId);
  useHermesStore.setState({ status: 'running', sessions: {}, partial: {}, progress: {}, runningProjects: {}, cancelGeneration: {} });
  return scope;
}
function transport(scope: ReturnType<typeof fixture>) {
  const listeners = new Set<(event: HermesEvent) => void>();
  const entered = deferred<void>(), result = deferred<HermesReply>();
  const emit = (event: HermesEvent) => listeners.forEach(listener => listener(event));
  const session = { ...scope, sessionId: 'live-session', running: false, projectTools: tools.map((tool: { name: string }) => tool.name),
    models: { currentModelId: 'mock-model', availableModels: [{ modelId: 'mock-model', name: 'Mock' }] } };
  let lastClientRequestId: string | undefined;
  let lastTaskKey: string | undefined;
  const computeTaskKey = (input?: any) =>
    input?.workflowPhase === 'generating' && input?.targetPageId
      ? JSON.stringify([input.projectId, 'project-page-exec', input.threadId ?? null, input.targetPageId])
      : conversationKey(scope);
  const api = {
    onEvent: (listener: (event: HermesEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    session: async () => session,
    sync: async () => ({ synced: true }),
    execute: async (input?: any) => {
      lastClientRequestId = input?.clientRequestId;
      lastTaskKey = computeTaskKey(input);
      const baseEvt = {
        ...start,
        taskKey: lastTaskKey,
        ...(input?.targetPageId ? { targetPageId: input.targetPageId } : {}),
        ...(lastClientRequestId ? { clientRequestId: lastClientRequestId } : {}),
      };
      emit(baseEvt);
      entered.resolve();
      try {
        const res = await result.promise;
        return {
          ...res,
          planningSessionId: res.planningSessionId ?? session.sessionId,
          execSessionId: res.execSessionId ?? res.sessionId,
          taskKey: res.taskKey ?? lastTaskKey,
          ...(res.clientRequestId ?? lastClientRequestId ? { clientRequestId: res.clientRequestId ?? lastClientRequestId } : {}),
        };
      } finally {
        emit({ ...baseEvt, type: 'run-end' });
      }
    },
    cancel: async () => { result.reject(new Error('已停止')); },
  };
  const start: HermesEvent = { type: 'run-start', ...scope, sessionId: session.sessionId, planningSessionId: session.sessionId, execSessionId: session.sessionId, runId: 'live-run' };
  (window as any).protoflowDesktop = { hermes: api };
  return { api, session, emit, start, entered, result, computeTaskKey,
    preview: (text = '正在搭建的订单') => emit({ ...start, type: 'page-preview', preview: { targetPageId: 'orders', source: source(text), sequence: 1, dbTables: [], tableRows: {} } }),
    reply: (): HermesReply => ({ text: '完成', sessionId: session.sessionId, planningSessionId: session.sessionId, execSessionId: session.sessionId, taskKey: lastTaskKey, ...(lastClientRequestId ? { clientRequestId: lastClientRequestId } : {}), runId: start.runId!, modelId: 'mock-model',
      operations: [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'orders', source: source('完成的订单') } }] }),
  };
}

test('Step 2c: project generation previews before completion, isolates chat/run identities, then commits and clears the draft', async () => {
  const scope = fixture('live-project-success'), mock = transport(scope), key = conversationKey(scope);
  const task = generateProject(scope.projectId);
  await mock.entered.promise;
  const before = projectRevision(), snapshot = captureProjectPayload();
  mock.preview();
  assert.match(useAiPreviewStore.getState().runs[key].pages.orders.source, /正在搭建/);
  for (const patch of [{ threadId: 'another-thread' }, { threadId: undefined }, { sessionId: 'old-session' }, { runId: 'old-run' }, { pageId: 'orders' }]) {
    mock.emit({ ...mock.start, ...patch, type: 'page-preview', preview: { targetPageId: 'orders', source: source('错误内容'), sequence: 99, dbTables: [] } });
  }
  assert.match(useAiPreviewStore.getState().runs[key].pages.orders.source, /正在搭建/);
  assert.equal(projectRevision(), before);
  assert.deepEqual(captureProjectPayload().stateSnapshot, snapshot.stateSnapshot);
  mock.result.resolve(mock.reply()); await task;
  assert.equal(useAiPreviewStore.getState().runs[key], undefined);
  assert.match(usePageStore.getState().pageSources.orders, /完成的订单/);
  assert.ok(useProtoStore.getState().projectPlan?.generatedPageIds.includes('orders'));
});

test('Step 2c: cancellation, provider failure, project edits and project switches discard project previews', async () => {
  for (const outcome of ['cancel', 'provider', 'edit', 'switch']) {
    const scope = fixture(`live-project-${outcome}`), mock = transport(scope), key = conversationKey(scope);
    const task = generateProject(scope.projectId); const rejected = assert.rejects(task);
    await mock.entered.promise; mock.preview();
    const before = captureProjectPayload().stateSnapshot;
    if (outcome === 'cancel') await useHermesStore.getState().stop(scope);
    if (outcome === 'provider') mock.result.reject(new Error('连接中断'));
    if (outcome === 'edit') usePageStore.getState().setPageSource('orders', source('用户修改'));
    if (outcome === 'switch') useProtoStore.setState({ isProjectClosed: true });
    if (outcome === 'edit' || outcome === 'switch') {
      assert.equal(useAiPreviewStore.getState().runs[key], undefined, 'manual changes immediately invalidate the draft');
      mock.preview('迟到事件');
      assert.equal(useAiPreviewStore.getState().runs[key], undefined);
      mock.result.resolve(mock.reply());
    }
    await rejected;
    assert.equal(useAiPreviewStore.getState().runs[key], undefined);
    mock.preview('任务结束后');
    assert.equal(useAiPreviewStore.getState().runs[key], undefined);
    if (outcome === 'cancel' || outcome === 'provider') {
      const after = captureProjectPayload().stateSnapshot;
      assert.deepEqual(after.pageSources, before.pageSources);
      assert.deepEqual(after.tableRows, before.tableRows);
      assert.deepEqual(after.dbTables, before.dbTables);
      assert.deepEqual(after.projectPlan?.generatedPageIds, []);
    }
    if (outcome === 'edit') assert.match(usePageStore.getState().pageSources.orders, /用户修改/);
  }
});

test('Step 2c: native project preview carries staged chart rows and refreshes data without touching saved rows', t => {
  const scope = fixture('live-chart'), key = conversationKey(scope);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-chart-')), file = path.join(dir, 'context.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbTables = [{ id: 'stats', tableName: 'stats', cnName: '统计', columns: [
    { id: 'month-col', name: 'month', dataType: 'TEXT', nullable: false },
    { id: 'amount-col', name: 'amount', dataType: 'DECIMAL', nullable: false },
  ], sharedByMenus: [] }];
  const chart = 'export default function Page(){return <Page pfId="root"><BarChart pfId="chart" source="table" table="stats" dimension="month" metrics={[{field:"amount",label:"金额"}]}/></Page>}';
  const context = { ...scope, active: true, runId: 'chart-run', snapshot: { dbTables, pageSources: { orders: chart }, tableRows: { stats: [{ id: 'one', month: '1月', amount: 10 }] } },
    operations: [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'orders', source: chart } }] };
  const start = { type: 'run-start', ...scope, sessionId: 'chart-session', runId: context.runId };
  useAiPreviewStore.getState().begin(scope, start.sessionId, {});
  useAiPreviewStore.getState().receive(start);
  const events: HermesEvent[] = [];
  const watcher = watchStagedPages(file, { ...scope, sessionId: start.sessionId, runId: start.runId }, (event: HermesEvent) => { events.push(event); useAiPreviewStore.getState().receive(event); }, () => true);
  t.after(() => watcher.close());
  atomicWrite(file, context); watcher.flush();
  assert.equal(useAiPreviewStore.getState().runs[key].tableRows.stats[0].amount, 10);
  context.snapshot.tableRows.stats[0].amount = 20;
  context.operations.push({ tool: 'protoflow_add_preview_scenario', args: { pageId: 'orders', source: '' } });
  atomicWrite(file, context); watcher.flush();
  assert.equal(events.length, 2);
  assert.equal(useAiPreviewStore.getState().runs[key].tableRows.stats[0].amount, 20);
  assert.deepEqual(usePageStore.getState().tableRows, {});
});

test('Step 2c: an incremental retry retains the candidate preview but accepts only the new run', async () => {
  const scope = fixture('live-project-retry'), mock = transport(scope), key = conversationKey(scope);
  const retryEntered = deferred<void>(); let attempts = 0;
  const incomplete = 'export default function Page(){return <Page pfId="root" title="待补齐的订单"/>}';
  mock.api.execute = async (request?: any) => {
    const taskKey = mock.computeTaskKey(request);
    if (++attempts === 1) {
      mock.emit({ ...mock.start, taskKey, targetPageId: request.targetPageId, clientRequestId: request.clientRequestId });
      mock.emit({ ...mock.start, taskKey, targetPageId: request.targetPageId, type: 'page-preview', preview: { targetPageId: 'orders', source: incomplete, sequence: 12, dbTables: [], tableRows: {} } });
      return { ...mock.reply(), taskKey, clientRequestId: request.clientRequestId, operations: [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'orders', source: incomplete } }] };
    }
    assert.ok(request.continuation);
    assert.match(request.snapshot.pageSources.orders, /待补齐的订单/);
    mock.emit({ ...mock.start, taskKey, targetPageId: request.targetPageId, clientRequestId: request.clientRequestId, runId: 'retry-run' });
    retryEntered.resolve();
    const res = await mock.result.promise;
    return { ...res, taskKey, clientRequestId: request.clientRequestId };
  };
  const task = generateProject(scope.projectId);
  await Promise.race([retryEntered.promise, task]);
  assert.equal(useAiPreviewStore.getState().runs[key].pages.orders.source, incomplete);
  mock.preview('上一轮迟到内容');
  assert.equal(useAiPreviewStore.getState().runs[key].pages.orders.source, incomplete);
  mock.emit({ ...mock.start, type: 'page-preview', runId: 'retry-run', preview: { targetPageId: 'orders', source: source('重试补齐'), sequence: 1, dbTables: [], tableRows: {} } });
  assert.match(useAiPreviewStore.getState().runs[key].pages.orders.source, /重试补齐/);
  mock.result.resolve({ ...mock.reply(), runId: 'retry-run' }); await task;
  assert.equal(attempts, 2);
  assert.equal(useAiPreviewStore.getState().runs[key], undefined);
  assert.match(usePageStore.getState().pageSources.orders, /完成的订单/);
});

test('Step 2c: conversation previews are discarded into the existing confirmation flow without applying the draft', async () => {
  const scope = fixture('live-project-review'), mock = transport(scope), key = conversationKey(scope);
  const before = usePageStore.getState().pageSources.orders;
  const task = discussProject(scope.projectId, '调整订单内容');
  await mock.entered.promise; mock.preview();
  assert.ok(useAiPreviewStore.getState().runs[key].latestPageId);
  mock.result.resolve(mock.reply()); await task;
  assert.equal(useAiPreviewStore.getState().runs[key], undefined);
  assert.equal(usePageStore.getState().pageSources.orders, before);
  const reply = useAiChatStore.getState().byConversation[key].at(-1)!;
  assert.ok(reply.projectChangeReview);
});

test('Step 2c: warm-up is shared with immediate submission, sends no prompt, and is retried after failure', async () => {
  const scope = fixture('live-warm'), mock = transport(scope);
  const ready = deferred<void>(); let sessions = 0, syncs = 0, executions = 0;
  mock.api.session = async () => {
    sessions++; await ready.promise;
    return { ...mock.session, lastSetup: { durationMs: 2, connectMs: 1, promptRefreshMs: 0, acpSessionRpcMs: 1,
      created: sessions === 1, reloaded: false, reused: sessions > 1, reloadReason: sessions === 1 ? 'cold_connect' : null } };
  };
  mock.api.sync = async () => { syncs++; return { synced: true }; };
  mock.api.execute = async (input?: any) => {
    executions++;
    const taskKey = mock.computeTaskKey(input);
    mock.emit({ ...mock.start, taskKey, clientRequestId: input?.clientRequestId });
    return { ...mock.reply(), taskKey, clientRequestId: input?.clientRequestId };
  };
  const before = projectRevision();
  const first = warmProjectSession(scope), second = warmProjectSession(scope);
  assert.equal(first, second);
  assert.equal(sessions, 1);
  assert.equal(executions, 0);
  assert.equal(projectRevision(), before, 'preparation does not change the project');
  const submit = discussProject(scope.projectId, '更新页面');
  const submittedRevision = projectRevision();
  assert.equal(sessions, 1, 'foreground preflight shares the pending preparation');
  ready.resolve(); await first;
  assert.equal(projectRevision(), submittedRevision, 'preparation does not change the submitted project');
  await submit;
  assert.equal(useProjectWorkflow.getState().lastTurnMetrics[conversationKey(scope)].sessionCreated, true,
    'a foreground request waiting for preparation retains the actual cold-start attribution');
  assert.equal(sessions, 2, 'one initial session request and one instruction adoption, no duplicate cold request');
  assert.equal(executions, 1);
  await warmProjectSession(scope);
  assert.equal(sessions, 2, 'completed warm-up is reused on remount');
  assert.equal(syncs, 2, 'warm-up sync and the mandatory foreground sync');

  const retryScope = fixture('live-warm-retry'), retry = transport(retryScope);
  let attempts = 0;
  retry.api.session = async () => { if (++attempts === 1) throw new Error('首次连接失败'); return retry.session; };
  await assert.rejects(warmProjectSession(retryScope), /首次连接失败/);
  await warmProjectSession(retryScope);
  assert.equal(attempts, 3);
});

test('Step 2c: thought activity is sanitized and coalesced, while tool progress stays readable', t => {
  const scope = fixture('live-thought'), events: HermesEvent[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-thought-'));
  const runtime = new HermesRuntime({ dataDir: dir, emit: (event: HermesEvent) => events.push(event) });
  t.after(() => { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const session = { ...scope, sessionId: 'thought-session', running: true, runId: 'thought-run', boundAdmissionId: null, text: '' };
  runtime.sessions.set(conversationKey(scope), session);
  const update = (value: unknown) => runtime.onNotification({ method: 'session/update', params: { sessionId: session.sessionId, _meta: { alex_run_id: session.runId, admission_id: 'aid-thought-1' }, update: value } });
  const thought = { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'PRIVATE_REASONING_TEXT' } };
  update(thought); update(thought);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].update, { sessionUpdate: 'agent_thought_chunk' });
  assert.equal(session.text, '');
  update({ sessionUpdate: 'tool_call', title: 'mcp_protoflow_protoflow_edit_page_block', status: 'in_progress' });
  update(thought);
  assert.equal(events.length, 3);
  assert.ok(!JSON.stringify(events).includes('PRIVATE_REASONING_TEXT'));
  assert.equal(toolProgressLabel('mcp_protoflow_protoflow_edit_page_block', 'in_progress'), '暂存页面区块 · 执行中');
  assert.equal(thinkingProgress('Hermes 正在处理…'), THINKING_PROGRESS);
  assert.equal(thinkingProgress('暂存页面区块 · 执行中'), null);
  assert.equal(thinkingProgress('暂存页面区块 · 已完成'), THINKING_PROGRESS);
  session.running = false; update(thought); assert.equal(events.length, 3);
});
