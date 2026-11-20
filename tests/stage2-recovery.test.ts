import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { acknowledgeToolDiscovery } from './fixtures/hermesToolDiscovery';
import { conversationKey } from '../src/services/hermesConversation';
import { createEmptyDependencyFootprint, verifyDependencyFootprint } from '../src/services/dependencyFootprint';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { useAiPreviewStore } from '../src/store/useAiPreviewStore';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from '../src/services/projectStorage';
import { applyProjectChanges, projectContext, projectRevision } from '../src/services/hermesProject';
import { generateProject } from '../src/services/projectWorkflow';
import { createNoteNode, setPageNoteLinks, updateNoteContent } from '../src/services/notesWorkspace';
import type { ProjectPlan } from '../src/services/projectPlan';

const root = process.cwd();
const { detectTestHermes } = require('../scripts/hermes-test-environment.cjs');
const { HermesRuntime, taskKeyForExecution, buildFailureEnvelope } = require(path.join(root, 'electron/hermes-runtime.cjs'));
const { sanitizeFailureEnvelope, runHermesExecuteIpc } = require(path.join(root, 'electron/hermes-ipc-envelope.cjs'));
const { tools: mcpToolDefs, callTool, callToolAsync, atomicWrite, replayCandidateOperations, readContextFootprint } = require(path.join(root, 'electron/protoflow-mcp.cjs'));
const { read, resolveExecutionPaths } = require(path.join(root, 'electron/hermes-draft-recovery.cjs'));

const registeredToolNames: string[] = mcpToolDefs.map((t: { name: string }) => t.name);
const testAccount = { status: 'signed-in', userId: 'stage2-user', serviceUrl: 'https://service.invalid' };
const validPageSource = (title: string, bodyText = title, extraAction = '') =>
  `export default function Page(){return <Page pfId="root" title="${title}"><Card pfId="card" title="${title}"><Text pfId="txt">${bodyText}</Text>${extraAction}</Card></Page>;}`;

function loadPreloadWithMockIpc(invokeHandler: (channel: string, payload: any) => Promise<any>) {
  const preloadPath = path.join(root, 'electron/preload.cjs');
  let exposedApi: any = null;
  const mockElectron = {
    contextBridge: {
      exposeInMainWorld: (_name: string, api: any) => {
        exposedApi = api;
      },
    },
    ipcRenderer: {
      invoke: (channel: string, payload: any) => invokeHandler(channel, payload),
      on: () => {},
      removeListener: () => {},
    },
  };
  const origLoad = (Module as any)._load;
  delete require.cache[preloadPath];
  (Module as any)._load = function patchedLoad(request: string, parent: any, isMain: boolean) {
    if (request === 'electron') return mockElectron;
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    require(preloadPath);
  } finally {
    (Module as any)._load = origLoad;
    delete require.cache[preloadPath];
  }
  return exposedApi;
}

function setupMultiPageProjectInStores(projectId = 'stage2-proj') {
  const ordersTable = {
    id: 't_orders',
    tableName: 'biz_orders',
    cnName: '订单表',
    domain: '交易域',
    description: '订单主表',
    modeling: { entity: '订单', grain: '每行一单', reason: '订单台账与详情共用' },
    columns: [
      { id: 'col_order_no', name: 'order_no', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '订单号' },
      { id: 'col_amount', name: 'amount', dataType: 'DECIMAL(12,2)', nullable: false, isPrimaryKey: false, comment: '金额' },
    ],
    sharedByMenus: [
      { pageId: 'p1', menuTitle: '订单总览', accessMode: 'READ 查询' as const, fieldMappingNote: '汇总展示' },
      { pageId: 'p2', menuTitle: '订单办理', accessMode: 'CRUD 读写' as const, fieldMappingNote: '新增与查询订单' },
      { pageId: 'p3', menuTitle: '归档中心', accessMode: 'READ 查询' as const, fieldMappingNote: '归档列表' },
    ],
  };
  const plan: ProjectPlan = {
    summary: '多页面订单工作台',
    folders: [{ id: 'f-main', title: '订单管理', parentFolderId: null }],
    pages: [
      { pageId: 'p1', title: '订单总览', folderId: 'f-main', requirements: '查看订单总览' },
      { pageId: 'p2', title: '订单办理', folderId: 'f-main', requirements: '办理并维护订单' },
      { pageId: 'p3', title: '归档中心', folderId: 'f-main', requirements: '查看归档记录' },
    ],
    approved: true,
    generatedPageIds: ['p1'],
  };
  const stickyNotes = [
    { id: 'sticky-p1', pageId: 'p1', targetWidgetId: 'card', targetWidgetName: '订单总览', index: 1, text: '总览说明', compiledRule: '总览说明', active: true },
    { id: 'sticky-p2', pageId: 'p2', targetWidgetId: 'card', targetWidgetName: '订单办理', index: 1, text: '办理说明', compiledRule: '办理说明', active: true },
    { id: 'sticky-p3', pageId: 'p3', targetWidgetId: 'card', targetWidgetName: '归档中心', index: 1, text: '归档说明', compiledRule: '归档说明', active: true },
  ];
  const payload = createProjectPayload({
    projectId,
    projectName: '阶段二测试工程',
    templateId: 'blank_project',
    storageDir: '/tmp',
    fileName: `${projectId}.pflow`,
    createdAt: '2026-11-14',
    updatedAt: '2026-11-14',
    pageCount: 3,
    tableCount: 1,
    stickyCount: 3,
  });
  payload.stateSnapshot = {
    ...payload.stateSnapshot,
    activePageId: 'p1',
    pageSources: {
      p1: validPageSource('订单总览', '总览内容'),
      p2: validPageSource('订单办理', '初始草稿骨架'),
      p3: validPageSource('归档中心', '归档骨架'),
    },
    designerPages: plan.pages.map(p => ({ pageId: p.pageId, title: p.title, folderId: p.folderId })),
    designerFolders: structuredClone(plan.folders),
    dbTables: [ordersTable],
    tableRows: {
      t_orders: [{ id: 'row-1', order_no: 'ORD-001', amount: 100 }],
    },
    stickyNotes: stickyNotes as any,
    projectPlan: structuredClone(plan),
  };
  loadProjectFromBinaryPayload(payload);
  const noteP2 = createNoteNode(projectId, 'note', '订单办理规则', null);
  updateNoteContent(projectId, noteP2, '<p>金额必须大于零</p>');
  setPageNoteLinks(projectId, { kind: 'page', pageId: 'p2' }, [noteP2]);
  const noteP3 = createNoteNode(projectId, 'note', '归档中心说明', null);
  updateNoteContent(projectId, noteP3, '<p>按月归档历史数据</p>');
  setPageNoteLinks(projectId, { kind: 'page', pageId: 'p3' }, [noteP3]);

  useProtoStore.getState().setViewMode('project_ai');
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
  useAiChatStore.getState().switchConversation({ projectId, kind: 'project' });
  useAiPreviewStore.setState({ active: {} } as any);
  useHermesStore.setState({
    status: 'running',
    sessions: {},
    runningProjects: {},
    cancelGeneration: {},
    partial: {},
    lastMetrics: {},
  } as any);

  return {
    scope: { projectId, kind: 'project' as const },
    noteP2,
    noteP3,
    snapshot: structuredClone(projectContext()),
  };
}

function multiPageSnapshot(projectId = 'stage2-proj') {
  return setupMultiPageProjectInStores(projectId).snapshot;
}

function resetWorkflowStores(projectId: string, snap: any) {
  const payload = createProjectPayload({
    projectId,
    projectName: snap.projectName || '阶段二测试',
    templateId: 'blank_project',
    storageDir: '/tmp',
    fileName: `${projectId}.pflow`,
    createdAt: '2026-11-14',
    updatedAt: '2026-11-14',
    pageCount: snap.designerPages.length,
    tableCount: snap.dbTables.length,
    stickyCount: snap.stickyNotes.length,
  });
  payload.stateSnapshot = {
    ...payload.stateSnapshot,
    activePageId: snap.designerPages[0]?.pageId || '',
    pageSources: structuredClone(snap.pageSources),
    designerPages: structuredClone(snap.designerPages),
    designerFolders: structuredClone(snap.designerFolders),
    dbTables: structuredClone(snap.dbTables),
    tableRows: structuredClone(snap.tableRows),
    stickyNotes: structuredClone(snap.stickyNotes),
    projectPlan: structuredClone(snap.projectPlan),
  };
  loadProjectFromBinaryPayload(payload);
  useProtoStore.getState().setViewMode('project_ai');
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
  useAiChatStore.getState().switchConversation({ projectId, kind: 'project' });
  useAiPreviewStore.setState({ active: {} } as any);
  useHermesStore.setState({
    status: 'running',
    sessions: {},
    runningProjects: {},
    cancelGeneration: {},
    partial: {},
    lastMetrics: {},
  } as any);
  return { projectId, kind: 'project' as const };
}

test('Stage 2 Probes 1-6: real Hermes v0.23.1 ACP/Gateway surface isolation, admission_id origin mapping, ACK gate & single-projector drainer', async (t) => {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-detect-'));
  const probeDetector = new HermesRuntime({ dataDir: probeDir, emit: () => {} });
  let runtimePython = '';
  let detected: any;
  try {
    detected = await detectTestHermes(probeDetector);
    if (detected?.detected && detected?.binary && detected?.installDir && fs.existsSync(detected.installDir)) {
      const cmdRes = spawnSync(detected.binary, ['--print-runtime-command'], { encoding: 'utf8', env: { ...process.env, HERMES_HOME: detected.home } });
      if (cmdRes.status === 0) {
        const parsed = JSON.parse(cmdRes.stdout);
        if (Array.isArray(parsed) && typeof parsed[0] === 'string' && fs.existsSync(parsed[0])) {
          runtimePython = parsed[0];
        }
      }
    }
  } finally {
    probeDetector.close();
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
  if (!runtimePython) {
    t.skip('Compatible Hermes fixture required (PFLOW_HERMES_SETTINGS)');
    return;
  }
  const pyRes = spawnSync(runtimePython, ['-I', '-B', path.join(root, 'tests/hermes-stage2-acp.test.py')], {
    env: { ...process.env, HERMES_HOME: detected.home, PFLOW_TEST_HERMES_SOURCE: detected.installDir },
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(pyRes.status, 0, `hermes-stage2-acp.test.py failed:\n${pyRes.stdout}\n${pyRes.stderr}`);
});

test('Probe 7: idle guarded setModel permission routing, spoof rejection, and HermesFailureEnvelope IPC sanitization + preload rehydration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe7-'));
  const emitted: any[] = [];
  const clientReplies: Array<{ id: any; result: any }> = [];
  const clientRejects: Array<{ id: any; message: string }> = [];
  const scope = { projectId: 'probe7-proj', kind: 'project', threadId: 'main-thread' };

  const availableModels = [
    { modelId: 'provider:model-a', name: 'Model A' },
    { modelId: 'provider:model-b', name: 'Model B' },
  ];
  let currentModelId = 'provider:model-a';
  let runtime: any;

  try {
    runtime = new HermesRuntime({
      dataDir: dir,
      emit: (ev: any) => emitted.push(ev),
      accountProvider: () => testAccount,
    });
    runtime.connect = async () => ({});
    runtime.client = {
      closed: false,
      close() {},
      notify() {},
      reply(id: any, result: any) {
        clientReplies.push({ id, result });
      },
      reject(id: any, message: string) {
        clientRejects.push({ id, message });
      },
      request: async (method: string, params: any) => {
        if (method === 'session/new' || method === 'session/load') {
          acknowledgeToolDiscovery(params);
          return {
            sessionId: 'planning-s1',
            models: { currentModelId, availableModels },
          };
        }
        if (method === 'session/set_model') {
          const opId = params?._meta?.alex_model_op_id;
          assert.equal(typeof opId, 'string');
          assert.ok(opId.length > 0);

          // 1) Spoofed requests during idle model switch MUST be rejected immediately without emitting permission:
          runtime.onRequest({
            id: 'spoof-no-meta',
            method: 'session/request_permission',
            params: {
              sessionId: 'planning-s1',
              toolCall: { title: 'Spoof 1' },
              options: [{ optionId: 'allow', name: '允许' }],
            },
          });
          runtime.onRequest({
            id: 'spoof-wrong-kind',
            method: 'session/request_permission',
            params: {
              sessionId: 'planning-s1',
              toolCall: { title: 'Spoof 2' },
              options: [{ optionId: 'allow', name: '允许' }],
              _meta: { alex_control_kind: 'turn', alex_run_id: 'r', admission_id: 'adm-1' },
            },
          });
          runtime.onRequest({
            id: 'spoof-wrong-op',
            method: 'session/request_permission',
            params: {
              sessionId: 'planning-s1',
              toolCall: { title: 'Spoof 3' },
              options: [{ optionId: 'allow', name: '允许' }],
              _meta: { alex_control_kind: 'model_switch', alex_model_op_id: 'wrong-op-id' },
            },
          });
          assert.deepEqual(
            clientRejects.map(r => r.id),
            ['spoof-no-meta', 'spoof-wrong-kind', 'spoof-wrong-op'],
          );
          assert.equal(emitted.filter(e => e.type === 'permission').length, 0);

          // 2) Legitimate guarded idle model_switch permission MUST emit to UI and resolve on user approval:
          runtime.onRequest({
            id: 'valid-model-perm',
            method: 'session/request_permission',
            params: {
              sessionId: 'planning-s1',
              toolCall: { title: '确认切换模型到 Model B' },
              options: [
                { optionId: 'allow-once', name: '确认切换' },
                { optionId: 'deny', name: '取消' },
              ],
              _meta: { alex_control_kind: 'model_switch', alex_model_op_id: opId },
            },
          });
          const permEvents = emitted.filter(e => e.type === 'permission');
          assert.equal(permEvents.length, 1);
          assert.equal(permEvents[0].id, 'valid-model-perm');
          runtime.respondPermission({ id: 'valid-model-perm', optionId: 'allow-once' });
          assert.equal(clientReplies.length, 1);
          assert.deepEqual(clientReplies[0], {
            id: 'valid-model-perm',
            result: { outcome: { outcome: 'selected', optionId: 'allow-once' } },
          });
          currentModelId = params.modelId;
          return { ok: true };
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    };

    const switched = await runtime.setModel({ ...scope, modelId: 'provider:model-b' });
    assert.equal(switched.models.currentModelId, 'provider:model-b');

    // Also verify `model_switch` spoof while `s.running === true` is rejected:
    const planningSession = runtime.sessions.get(conversationKey(scope));
    planningSession.running = true;
    planningSession.activeModelOp = { opId: 'stale-op', modelId: 'provider:model-a' };
    runtime.onRequest({
      id: 'spoof-while-running',
      method: 'session/request_permission',
      params: {
        sessionId: 'planning-s1',
        toolCall: { title: 'Running spoof' },
        options: [{ optionId: 'allow', name: '允许' }],
        _meta: { alex_control_kind: 'model_switch', alex_model_op_id: 'stale-op' },
      },
    });
    assert.ok(clientRejects.some(r => r.id === 'spoof-while-running'));
    planningSession.running = false;
    planningSession.activeModelOp = null;

    // 3) End-to-end IPC sanitization + preload.cjs rehydration check:
    const capturedDiagnostics: any[] = [];
    const desktopApi = loadPreloadWithMockIpc(async (channel, payload) => {
      assert.equal(channel, 'pflow:hermes-execute');
      return runHermesExecuteIpc(
        payload,
        async (cleanPayload: any) => {
          assert.equal(cleanPayload.__ipcEnvelope, undefined);
          const rawErr: any = new Error(
            'Provider rejected at https://api.secret-host.example/v1/chat?api_key=sk-1234567890abcdef with /Users/alice/.hermes/auth.json Bearer sk-secret9999999999',
          );
          rawErr.data = { rawPrompt: '机密业务需求全文', headers: { Authorization: 'Bearer sk-secret9999999999' } };
          rawErr.failureEnvelope = {
            ...buildFailureEnvelope({
              error: rawErr,
              cancelled: false,
              acpTurnOutcomeUnknown: false,
              gatewayTurnUncertainty: null,
              hadUnfinishedNativeTools: false,
              retryStatus: { status: 'stopped', reason: 'provider-rejected' },
              runFailure: { reason: 'provider-rejected' },
              recoverySaved: true,
              uncertainRecovery: false,
              targetPageId: 'p2',
            }),
            rawData: { secret: 'must-not-cross-ipc' },
            promptLeak: '不得泄露提示词',
          };
          throw rawErr;
        },
        (diag: any) => capturedDiagnostics.push(diag),
      );
    });

    await assert.rejects(
      desktopApi.hermes.execute({ ...scope, prompt: '生成订单页' }),
      (rehydrated: any) => {
        assert.deepEqual(rehydrated.failureEnvelope, {
          code: 'PROVIDER_REJECTED',
          failureScope: 'shared',
          terminalConfirmed: true,
          candidateStatus: 'available',
          targetPageId: 'p2',
        });
        const serialized = JSON.stringify({
          message: rehydrated.message,
          envelope: rehydrated.failureEnvelope,
        });
        assert.equal(serialized.includes('sk-'), false);
        assert.equal(serialized.includes('secret-host.example'), false);
        assert.equal(serialized.includes('/Users/alice'), false);
        assert.equal(serialized.includes('must-not-cross-ipc'), false);
        assert.equal(serialized.includes('不得泄露提示词'), false);
        assert.equal((rehydrated.failureEnvelope as any).rawData, undefined);
        return true;
      },
    );

    // Invalid codes or path-like targetPageId are sanitized strictly:
    const sanitized = sanitizeFailureEnvelope({
      code: 'UNKNOWN_CUSTOM_CODE',
      failureScope: 'invalid-scope',
      terminalConfirmed: 1,
      candidateStatus: 'bogus',
      targetPageId: '/Users/alice/secret-page',
      extraSecret: 'leak',
    });
    assert.deepEqual(sanitized, {
      code: 'RUNTIME_INTERNAL',
      failureScope: 'unknown',
      terminalConfirmed: true,
      candidateStatus: 'none',
    });
  } finally {
    runtime?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Probe 8: v3 DependencyFootprint full fact coverage, candidate replay onto latest base, merge dependencies, and sync zero-await commit check', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe8-'));
  const scope = { projectId: 'stage2-proj', kind: 'project' as const, threadId: 'thread-8' };
  let promptCalls = 0;
  let sessionCounter = 0;

  const makeRuntime = (onPrompt: (rt: any, params: any, ctxFile: string) => any) => {
    const rt = new HermesRuntime({
      dataDir: dir,
      emit: () => {},
      accountProvider: () => testAccount,
    });
    rt.connect = async () => ({});
    rt.client = {
      closed: false,
      close() {},
      notify() {},
      reply() {},
      reject() {},
      request: async (method: string, params: any) => {
        if (method === 'session/new') {
          acknowledgeToolDiscovery(params);
          const isExec = String(params.cwd).includes('page-runs');
          return {
            sessionId: isExec ? `exec-p2-${++sessionCounter}` : 'planning-8',
            models: { currentModelId: 'provider:model-a', availableModels: [{ modelId: 'provider:model-a', name: 'Model A' }] },
          };
        }
        if (method === 'session/load') {
          acknowledgeToolDiscovery(params);
          return {
            sessionId: params.sessionId,
            models: { currentModelId: 'provider:model-a', availableModels: [{ modelId: 'provider:model-a', name: 'Model A' }] },
          };
        }
        if (method === 'session/prompt') {
          promptCalls += 1;
          const convDir = rt.sessions.get(conversationKey(scope)).dir;
          const paths = resolveExecutionPaths(convDir, 'generating', 'p2');
          return onPrompt(rt, params, paths.contextFile);
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    };
    return rt;
  };

  let runtime: any;
  try {
    // --- 8a & 8b: P2 reads ONLY get_project_brief (no get_db_table), stages P2 TSX, then pauses ---
    const initialSnap = multiPageSnapshot(scope.projectId);
    runtime = makeRuntime((_rt, _params, ctxFile) => {
      // Notice: ONLY calling `protoflow_get_project_brief` (no `protoflow_get_db_table` or `protoflow_get_project`)!
      callTool(ctxFile, 'protoflow_get_project_brief', { pageId: 'p2' });
      callTool(ctxFile, 'protoflow_apply_tsx_patch', {
        pageId: 'p2',
        source: validPageSource('订单办理', '阶段一候选订单表单'),
      });
      throw new Error('rate limit budget reached');
    });

    await assert.rejects(
      runtime.execute({
        ...scope,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        prompt: '生成页面 p2',
        snapshot: structuredClone(initialSnap),
        recoveryRevisionVersion: 3,
        recoverDraft: true,
      }),
      /候选修改已保存在本机/,
    );
    assert.equal(promptCalls, 1);

    const convDir = runtime.sessions.get(conversationKey(scope)).dir;
    const execPaths = resolveExecutionPaths(convDir, 'generating', 'p2');
    const savedCheckpoint = read(execPaths.checkpointPath);
    assert.equal(savedCheckpoint.recovery.status, 'available');
    assert.equal(savedCheckpoint.dependencyFootprint?.version, 3);
    const checkpointBytesBefore = fs.readFileSync(execPaths.checkpointPath, 'utf8');

    // 8a: P3 adds a brand-new entity table (`t_dup_entity`) with different ID and tableName.
    // Even though P2 never called `get_db_table`, `get_project_brief` exposed the full table catalog!
    const snapWithNewTable = structuredClone(initialSnap);
    snapWithNewTable.dbTables.push({
      id: 't_dup_entity',
      tableName: 'biz_order_extra',
      cnName: '重复订单扩展表',
      domain: '交易域',
      description: '其它页面新增同类实体',
      modeling: { entity: '订单扩展', grain: '每行一单', reason: '测试目录感知' },
      columns: [{ id: 'c1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' }],
      sharedByMenus: [{ pageId: 'p3', menuTitle: '归档中心', accessMode: 'CRUD 读写', fieldMappingNote: '归档读写' }],
    });

    const checkNewTable = verifyDependencyFootprint(snapWithNewTable, savedCheckpoint.dependencyFootprint);
    assert.equal(checkNewTable.ok, false);
    assert.ok(checkNewTable.changedSections.includes('tableCatalog'));

    await assert.rejects(
      runtime.execute({
        ...scope,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        prompt: '生成页面 p2',
        snapshot: snapWithNewTable,
        recoveryRevisionVersion: 3,
        recoverDraft: true,
      }),
      (err: any) => {
        assert.equal(err.failureEnvelope?.code, 'DRAFT_RECOVERY_CONFLICT');
        assert.equal(err.failureEnvelope?.candidateStatus, 'available');
        return true;
      },
    );
    // Must NOT have sent a model request, and must NOT have overwritten the saved candidate!
    assert.equal(promptCalls, 1);
    assert.equal(fs.readFileSync(execPaths.checkpointPath, 'utf8'), checkpointBytesBefore);

    // 8b: Instead of adding a table, P3 finishes its own TSX (`pageSources.p3`), updates its own sticky (`sticky-p3`),
    // and adds preview rows to `t_orders` (P2 never read `t_orders` rows).
    // Recovery MUST succeed and replay P2's candidate onto `latestBaseSnapshot` without clobbering P3!
    const snapWithP3Committed = structuredClone(initialSnap);
    snapWithP3Committed.pageSources.p3 = validPageSource('归档中心', 'P3 已正式提交的归档页面');
    snapWithP3Committed.projectPlan.generatedPageIds = ['p1', 'p3'];
    snapWithP3Committed.stickyNotes = snapWithP3Committed.stickyNotes.map((st: any) =>
      st.id === 'sticky-p3' ? { ...st, text: 'P3 更新后的便签', compiledRule: 'P3 更新后的便签' } : st,
    );
    snapWithP3Committed.tableRows.t_orders.push({ id: 'row-2', order_no: 'ORD-002', amount: 250 });

    const checkP3Independent = verifyDependencyFootprint(
      snapWithP3Committed,
      savedCheckpoint.dependencyFootprint,
    );
    assert.equal(checkP3Independent.ok, true);

    runtime.close();
    runtime = makeRuntime((_rt, _params, ctxFile) => {
      const resumedCtx = read(ctxFile);
      // Verify replayed base inside MCP context preserves BOTH P3's committed changes AND P2's staged candidate!
      assert.match(resumedCtx.snapshot.pageSources.p3, /P3 已正式提交的归档页面/);
      assert.match(resumedCtx.snapshot.pageSources.p2, /阶段一候选订单表单/);
      assert.equal(resumedCtx.snapshot.tableRows.t_orders.length, 2);
      callTool(ctxFile, 'protoflow_get_project_brief', { pageId: 'p2' });
      callTool(ctxFile, 'protoflow_apply_tsx_patch', {
        pageId: 'p2',
        source: validPageSource('订单办理', '阶段二恢复并完成的订单表单'),
      });
      return { stopReason: 'end_turn' };
    });

    const recoveredResult = await runtime.execute({
      ...scope,
      workflowPhase: 'generating',
      targetPageId: 'p2',
      prompt: '生成页面 p2',
      snapshot: structuredClone(snapWithP3Committed),
      recoveryRevisionVersion: 3,
      recoverDraft: true,
    });
    assert.equal(recoveredResult.recoveredDraft, true);
    assert.equal(recoveredResult.continuationMerged, true);
    assert.equal(recoveredResult.dependencyFootprint?.version, 3);

    const replayedFinal = replayCandidateOperations(snapWithP3Committed, recoveredResult.operations, {
      workflowPhase: 'generating',
      targetPageId: 'p2',
    });
    assert.match(replayedFinal.pageSources.p2, /阶段二恢复并完成的订单表单/);
    assert.match(replayedFinal.pageSources.p3, /P3 已正式提交的归档页面/);
    assert.equal(replayedFinal.tableRows.t_orders.length, 2);

    // --- 8c: Merge revision (`sourcePageId: 'p1'`) records source page + allPageSourcesHash ---
    const mergeDir = path.join(dir, 'merge-ctx');
    fs.mkdirSync(mergeDir, { recursive: true });
    const mergeCtxFile = path.join(mergeDir, 'context.json');
    const mergeSnap = structuredClone(initialSnap);
    (mergeSnap.projectPlan as any).revision = {
      pageId: 'p2',
      summary: '将订单总览并入订单办理弹层',
      merge: { sourcePageId: 'p1', targetOverlayId: 'modal-overview', mode: 'modal' },
    };
    atomicWrite(mergeCtxFile, {
      ...scope,
      active: true,
      runId: 'run-merge',
      workflowPhase: 'generating',
      targetPageId: 'p2',
      snapshot: mergeSnap,
      operations: [],
    });
    callTool(mergeCtxFile, 'protoflow_get_project_brief', { pageId: 'p2' });
    const mergeFootprint = readContextFootprint(mergeCtxFile);
    assert.equal(mergeFootprint?.version, 3);
    assert.ok(typeof mergeFootprint.readSet.allPageSourcesHash === 'string');
    assert.ok(mergeFootprint.readSet.pages.p1);

    const mergeBrokenByNav = structuredClone(mergeSnap);
    mergeBrokenByNav.pageSources.p3 = validPageSource(
      '归档中心',
      '带跳转归档',
      '<Button pfId="btn-go" onClick={() => navigate("p1")}>回总览</Button>',
    );
    const mergeVerify = verifyDependencyFootprint(mergeBrokenByNav, mergeFootprint);
    assert.equal(mergeVerify.ok, false);
    assert.ok(mergeVerify.changedSections.includes('pageSources'));

    // --- 8d: Sync zero-await `applyProjectChanges` note & query re-verification ---
    const setupNote1 = setupMultiPageProjectInStores(scope.projectId);
    const noteCtxDir = path.join(dir, 'note-ctx');
    fs.mkdirSync(noteCtxDir, { recursive: true });
    const noteCtxFile = path.join(noteCtxDir, 'context.json');
    const basePayload = captureProjectPayload();
    const baseRev = projectRevision();
    const liveSnap = projectContext(undefined, basePayload);
    atomicWrite(noteCtxFile, {
      ...scope,
      active: true,
      runId: 'run-note-check',
      workflowPhase: 'generating',
      targetPageId: 'p2',
      snapshot: liveSnap,
      operations: [],
    });
    callTool(noteCtxFile, 'protoflow_get_project_brief', { pageId: 'p2' });
    callTool(noteCtxFile, 'protoflow_get_project_notes', { pageId: 'p2' });
    callTool(noteCtxFile, 'protoflow_apply_tsx_patch', {
      pageId: 'p2',
      source: validPageSource('订单办理', '读取笔记后的订单页'),
    });
    const noteCtxAfter = read(noteCtxFile);
    const noteFootprint = readContextFootprint(noteCtxFile);
    assert.equal(noteFootprint?.version, 3);

    // Modifying unrelated note `noteP3` (linked only to `p3`) MUST allow `applyProjectChanges` to succeed!
    updateNoteContent(scope.projectId, setupNote1.noteP3, '<p>归档中心无关笔记修订</p>');
    applyProjectChanges(
      basePayload,
      baseRev,
      noteCtxAfter.operations,
      undefined,
      'chg-note-ok',
      'p2',
      false,
      [],
      undefined,
      { dependencyFootprint: noteFootprint },
    );
    assert.match(usePageStore.getState().pageSources.p2, /读取笔记后的订单页/);

    // Restore exact `basePayload` and verify: (i) modifying `noteP2` OR (ii) adding a new note linked to `p2` throws synchronously!
    loadProjectFromBinaryPayload(basePayload);
    updateNoteContent(scope.projectId, setupNote1.noteP2, '<p>金额改为允许为零</p>');
    assert.throws(
      () =>
        applyProjectChanges(
          basePayload,
          baseRev,
          noteCtxAfter.operations,
          undefined,
          'chg-note-conflict-1',
          'p2',
          false,
          [],
          undefined,
          { dependencyFootprint: noteFootprint },
        ),
      (err: any) => err.code === 'DRAFT_RECOVERY_CONFLICT',
    );

    loadProjectFromBinaryPayload(basePayload);
    const addedNoteP2 = createNoteNode(scope.projectId, 'note', '新增办理补充规范', null);
    updateNoteContent(scope.projectId, addedNoteP2, '<p>新增一条关联到 p2 的笔记</p>');
    setPageNoteLinks(scope.projectId, { kind: 'page', pageId: 'p2' }, [setupNote1.noteP2, addedNoteP2]);
    assert.throws(
      () =>
        applyProjectChanges(
          basePayload,
          baseRev,
          noteCtxAfter.operations,
          undefined,
          'chg-note-conflict-2',
          'p2',
          false,
          [],
          undefined,
          { dependencyFootprint: noteFootprint },
        ),
      (err: any) => err.code === 'DRAFT_RECOVERY_CONFLICT',
    );
  } finally {
    runtime?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Probe 9: Step 0 read-only eligibility gate, 5-step pendingMigration WAL crash recovery, clarifications carry-over, and dual-session late-frame isolation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe9-'));
  const scope = { projectId: 'stage2-proj', kind: 'project' as const, threadId: 'thread-9' };
  const snap = multiPageSnapshot(scope.projectId);
  const events: any[] = [];
  const rpcLog: Array<{ method: string; params: any }> = [];

  let planningModel = 'provider:model-a';
  const availableModels = [
    { modelId: 'provider:model-a', name: 'Model A' },
    { modelId: 'provider:model-b', name: 'Model B' },
  ];
  let gatewayIdempotentMap = new Map<string, string>();
  let execNewCounter = 0;
  let crashMode: 'none' | 'pause-initial' | 'crash-step2-before-persist' | 'crash-step3-set-model' = 'pause-initial';
  let execCurrentModel = new Map<string, string>();
  let capturedRecoveryPrompt = '';
  let runtime: any;

  const createRuntime = () => {
    const rt = new HermesRuntime({
      dataDir: dir,
      emit: (ev: any) => events.push(ev),
      accountProvider: () => testAccount,
    });
    rt.connect = async () => ({});
    rt.client = {
      closed: false,
      close() {},
      notify() {},
      reply() {},
      reject() {},
      request: async (method: string, params: any) => {
        rpcLog.push({ method, params });
        if (method === 'session/new') {
          const isExec = String(params.cwd).includes('page-runs');
          if (!isExec) {
            acknowledgeToolDiscovery(params);
            return { sessionId: 'planning-s9', models: { currentModelId: planningModel, availableModels } };
          }
          const reqId = params?._meta?.alex_request_id;
          if (reqId && gatewayIdempotentMap.has(reqId)) {
            // Simulate Gateway `same_create_retry`: returns existing session WITHOUT re-spawning MCP!
            const existingSid = gatewayIdempotentMap.get(reqId)!;
            return {
              sessionId: existingSid,
              models: { currentModelId: execCurrentModel.get(existingSid) || 'provider:default-other', availableModels },
            };
          }
          const newSid = `exec-s${++execNewCounter}`;
          if (reqId) gatewayIdempotentMap.set(reqId, newSid);
          // Start new migrated session on a different default model so Step 3 (`session/set_model`) MUST execute!
          const initialExecModel = execNewCounter === 1 ? planningModel : 'provider:default-other';
          execCurrentModel.set(newSid, initialExecModel);
          acknowledgeToolDiscovery(params);
          if (crashMode === 'crash-step2-before-persist') {
            throw new Error('ACP dropped right after Gateway created session');
          }
          return {
            sessionId: newSid,
            models: { currentModelId: initialExecModel, availableModels },
          };
        }
        if (method === 'session/load') {
          acknowledgeToolDiscovery(params);
          const sid = params.sessionId;
          const m = sid === 'planning-s9' ? planningModel : (execCurrentModel.get(sid) || planningModel);
          return { sessionId: sid, models: { currentModelId: m, availableModels } };
        }
        if (method === 'session/set_model') {
          if (crashMode === 'crash-step3-set-model' && params.sessionId !== 'planning-s9') {
            throw new Error('ACP failed mid-Step-3 set_model');
          }
          if (params.sessionId === 'planning-s9') planningModel = params.modelId;
          else execCurrentModel.set(params.sessionId, params.modelId);
          return { ok: true };
        }
        if (method === 'session/prompt') {
          const convDir = rt.sessions.get(conversationKey(scope)).dir;
          const paths = resolveExecutionPaths(convDir, 'generating', 'p2');
          const taskKey = taskKeyForExecution(scope, 'generating', 'p2');
          const execS = rt.pageSessions.get(taskKey);

          if (crashMode === 'pause-initial') {
            // Emit a valid turn clarification question and answer it so `clarifications` is persisted in checkpoint!
            rt.onRequest({
              id: 'q-turn-1',
              method: 'elicitation/create',
              params: {
                sessionId: execS.sessionId,
                mode: 'form',
                message: '订单金额保留几位小数？',
                requestedSchema: {
                  properties: {
                    answer: { type: 'string', enum: ['两位小数', '整数'] },
                  },
                },
                _meta: {
                  alex_control_kind: 'turn',
                  alex_run_id: execS.runId,
                  admission_id: 'adm-initial-1',
                },
              },
            });
            rt.respondQuestion({ id: 'q-turn-1', answer: '两位小数', supplement: '按财务标准四舍五入' });
            callTool(paths.contextFile, 'protoflow_get_project_brief', { pageId: 'p2' });
            callTool(paths.contextFile, 'protoflow_apply_tsx_patch', {
              pageId: 'p2',
              source: validPageSource('订单办理', '含两位小数规则的候选页'),
            });
            throw new Error('rate limit budget exhausted');
          }

          // Recovery turn on migrated `exec-s2`: test 9c dual-session & late-frame isolation while active!
          capturedRecoveryPrompt = params.prompt[0].text;

          // Wire stores to runtime events to verify end-to-end filtering across HermesRuntime + useHermesStore + useAiPreviewStore:
          useHermesStore.setState({
            status: 'running',
            sessions: {
              [conversationKey(scope)]: {
                ...scope,
                sessionId: 'planning-s9',
                running: false,
                models: { currentModelId: planningModel, availableModels },
              },
            },
            runningProjects: { [scope.projectId]: true },
            partial: {},
          } as any);
          useAiPreviewStore.getState().begin(scope, 'planning-s9', snap.tableRows, false);
          useAiPreviewStore.getState().receive({
            type: 'run-start',
            ...scope,
            sessionId: execS.sessionId,
            planningSessionId: 'planning-s9',
            execSessionId: execS.sessionId,
            taskKey,
            targetPageId: 'p2',
            runId: execS.runId,
          } as any);

          // Inject stale frame from old `exec-s1`, stale `runId` on `exec-s2`, and mismatched `admission_id`:
          rt.onNotification({
            method: 'session/update',
            params: {
              sessionId: 'exec-s1',
              _meta: { alex_run_id: execS.runId, admission_id: 'adm-stale' },
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'STALE_EXEC_S1' } },
            },
          });
          rt.onNotification({
            method: 'session/update',
            params: {
              sessionId: execS.sessionId,
              _meta: { alex_run_id: 'old-run-id', admission_id: 'adm-old' },
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'STALE_OLD_RUN' } },
            },
          });
          rt.onNotification({
            method: 'session/update',
            params: {
              sessionId: execS.sessionId,
              _meta: { alex_run_id: execS.runId, admission_id: 'adm-good-2' },
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'VALID_CHUNK' } },
            },
          });
          rt.onNotification({
            method: 'session/update',
            params: {
              sessionId: execS.sessionId,
              _meta: { alex_run_id: execS.runId, admission_id: 'adm-spoofed-other' },
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'SPOOFED_ADM' } },
            },
          });

          // Verify forged preview event with wrong runId/execSessionId is ignored by useAiPreviewStore:
          useAiPreviewStore.getState().receive({
            type: 'page-preview',
            ...scope,
            sessionId: 'exec-s1',
            planningSessionId: 'planning-s9',
            execSessionId: 'exec-s1',
            taskKey,
            runId: execS.runId,
            pageId: 'p2',
            title: '订单办理',
            source: validPageSource('订单办理', '被污染的旧预览'),
          } as any);

          assert.equal(execS.text, 'VALID_CHUNK');
          assert.equal(useAiPreviewStore.getState().active[scope.projectId]?.pages?.p2, undefined);
          assert.equal(useHermesStore.getState().sessions[conversationKey(scope)]?.running, false);

          callTool(paths.contextFile, 'protoflow_get_project_brief', { pageId: 'p2' });
          callTool(paths.contextFile, 'protoflow_apply_tsx_patch', {
            pageId: 'p2',
            source: validPageSource('订单办理', '跨会话迁移完成后提交的订单页'),
          });
          return { stopReason: 'end_turn' };
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    };
    return rt;
  };

  try {
    runtime = createRuntime();
    // Initial turn pauses with `available` checkpoint + answered clarification on `exec-s1`:
    await assert.rejects(
      runtime.execute({
        ...scope,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        prompt: '生成订单办理页面',
        snapshot: structuredClone(snap),
        recoveryRevisionVersion: 3,
        recoverDraft: true,
      }),
      /候选修改已保存在本机/,
    );
    const convDir = runtime.sessions.get(conversationKey(scope)).dir;
    const paths = resolveExecutionPaths(convDir, 'generating', 'p2');
    assert.equal(read(paths.sessionFile).sessionId, 'exec-s1');
    const cpInitial = read(paths.checkpointPath);
    assert.equal(cpInitial.recovery.identity.sessionId, 'exec-s1');
    assert.equal(cpInitial.clarifications?.length, 1);
    assert.match(cpInitial.clarifications[0].answer, /两位小数/);

    // --- 9a: Step 0 pure read-only eligibility gate when planning model changed (`model-a -> model-b`) ---
    await runtime.setModel({ ...scope, modelId: 'provider:model-b' });
    const sessionBytesBeforeStep0 = fs.readFileSync(paths.sessionFile, 'utf8');
    const cpBytesBeforeStep0 = fs.readFileSync(paths.checkpointPath, 'utf8');
    rpcLog.length = 0;

    await assert.rejects(
      runtime.execute({
        ...scope,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        prompt: '生成订单办理页面',
        snapshot: structuredClone(snap),
        recoveryRevisionVersion: 3,
        recoverDraft: true,
      }),
      /模型已变化/,
    );
    // Step 0 MUST reject BEFORE touching any page sub-session RPC (`session/new`, `session/set_model`, `session/prompt`):
    const pageRpcsDuringStep0 = rpcLog.filter(
      r => r.params?.sessionId === 'exec-s1' || String(r.params?.cwd || '').includes('page-runs'),
    );
    assert.deepEqual(pageRpcsDuringStep0, []);
    assert.equal(fs.readFileSync(paths.sessionFile, 'utf8'), sessionBytesBeforeStep0);
    assert.equal(fs.readFileSync(paths.checkpointPath, 'utf8'), cpBytesBeforeStep0);

    // Switch planning model back to `provider:model-a` for 9b WAL crash recovery:
    await runtime.setModel({ ...scope, modelId: 'provider:model-a' });

    // --- 9b Crash Point 1: Crash right after Gateway created `exec-s2` (before `toSessionId` is persisted) ---
    crashMode = 'crash-step2-before-persist';
    await assert.rejects(
      runtime.execute({
        ...scope,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        prompt: '生成订单办理页面',
        snapshot: structuredClone(snap),
        recoveryRevisionVersion: 3,
        recoverDraft: true,
        rotateSession: true,
      }),
      /ACP dropped right after Gateway created session/,
    );
    const cpAfterCrash1 = read(paths.checkpointPath);
    assert.equal(cpAfterCrash1.recovery.status, 'available');
    assert.equal(cpAfterCrash1.recovery.pendingMigration?.fromSessionId, 'exec-s1');
    assert.equal(cpAfterCrash1.recovery.pendingMigration?.toSessionId, undefined);
    const savedOpId = cpAfterCrash1.recovery.pendingMigration.opId;
    assert.equal(typeof savedOpId, 'string');
    assert.equal(read(paths.sessionFile).sessionId, 'exec-s1');
    assert.equal(execNewCounter, 2); // exec-s1 + exec-s2

    // --- 9b Crash Point 2: Retry reuses `savedOpId` (Gateway returns `exec-s2` idempotently, zero new sessions!),
    // falls back to `session/load` for fresh MCP binding, then crashes inside Step 3 `session/set_model` ---
    crashMode = 'crash-step3-set-model';
    await assert.rejects(
      runtime.execute({
        ...scope,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        prompt: '生成订单办理页面',
        snapshot: structuredClone(snap),
        recoveryRevisionVersion: 3,
        recoverDraft: true,
      }),
      /ACP failed mid-Step-3 set_model/,
    );
    // Zero orphan sessions created! `toSessionId` is now durably recorded, while `session.json` is STILL `exec-s1`!
    assert.equal(execNewCounter, 2);
    const cpAfterCrash2 = read(paths.checkpointPath);
    assert.equal(cpAfterCrash2.recovery.pendingMigration?.opId, savedOpId);
    assert.equal(cpAfterCrash2.recovery.pendingMigration?.toSessionId, 'exec-s2');
    assert.equal(read(paths.sessionFile).sessionId, 'exec-s1');

    // --- 9b Recovery Completion: Skips `session/new`, loads `exec-s2`, completes Steps 3-5, carries clarifications! ---
    crashMode = 'none';
    rpcLog.length = 0;
    const migratedRes = await runtime.execute({
      ...scope,
      workflowPhase: 'generating',
      targetPageId: 'p2',
      prompt: '生成订单办理页面',
      snapshot: structuredClone(snap),
      recoveryRevisionVersion: 3,
      recoverDraft: true,
    });
    assert.equal(execNewCounter, 2);
    assert.equal(rpcLog.some(r => r.method === 'session/new'), false);
    assert.equal(migratedRes.execSessionId, 'exec-s2');
    assert.equal(migratedRes.recoveredDraft, true);
    assert.equal(migratedRes.text, 'VALID_CHUNK');

    const finalSessionDisk = read(paths.sessionFile);
    assert.equal(finalSessionDisk.sessionId, 'exec-s2');
    assert.deepEqual(finalSessionDisk.lineage, ['exec-s1']);

    const cpAfterSuccess = read(paths.checkpointPath);
    assert.equal(cpAfterSuccess.recovery.pendingMigration, undefined);
    assert.equal(cpAfterSuccess.recovery.identity.sessionId, 'exec-s2');
    assert.equal(cpAfterSuccess.recovery.sessionMigrations?.length, 1);
    assert.equal(cpAfterSuccess.recovery.sessionMigrations[0].fromSessionId, 'exec-s1');
    assert.equal(cpAfterSuccess.recovery.sessionMigrations[0].toSessionId, 'exec-s2');

    // Verify carried-over clarifications AND cross-session migration prompt instructions:
    assert.match(capturedRecoveryPrompt, /新的执行子会话中恢复/);
    assert.match(capturedRecoveryPrompt, /protoflow_search_history/);
    assert.match(capturedRecoveryPrompt, /两位小数/);
    assert.match(capturedRecoveryPrompt, /按财务标准四舍五入/);
  } finally {
    runtime?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Probe 10: post-commit completeRecovery idempotency, 2-round continuation registeredRun pairing, and batch failure triage', async () => {
  // --- 10a: `completeRecovery` after live commit (WriteSet preimage already overwritten in live store) ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe10-'));
  const scope = { projectId: 'probe10-proj', kind: 'project' as const };
  const snap = multiPageSnapshot(scope.projectId);
  let runtime: any;
  try {
    runtime = new HermesRuntime({
      dataDir: dir,
      emit: () => {},
      accountProvider: () => testAccount,
    });
    runtime.connect = async () => ({});
    runtime.client = {
      closed: false,
      close() {},
      notify() {},
      reply() {},
      reject() {},
      request: async (method: string, params: any) => {
        if (method === 'session/new' || method === 'session/load') {
          acknowledgeToolDiscovery(params);
          const isExec = String(params.cwd).includes('page-runs');
          return {
            sessionId: isExec ? 'exec-10a' : 'planning-10a',
            models: { currentModelId: 'provider:m', availableModels: [{ modelId: 'provider:m', name: 'M' }] },
          };
        }
        if (method === 'session/prompt') {
          const convDir = runtime.sessions.get(conversationKey(scope)).dir;
          const paths = resolveExecutionPaths(convDir, 'generating', 'p2');
          callTool(paths.contextFile, 'protoflow_get_project_brief', { pageId: 'p2' });
          callTool(paths.contextFile, 'protoflow_apply_tsx_patch', {
            pageId: 'p2',
            source: validPageSource('订单办理', '已提交到工程的新版页面'),
          });
          return { stopReason: 'end_turn' };
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    };

    const execRes = await runtime.execute({
      ...scope,
      workflowPhase: 'generating',
      targetPageId: 'p2',
      prompt: '生成 p2',
      snapshot: structuredClone(snap),
      recoveryRevisionVersion: 3,
      recoverDraft: true,
    });
    const convDir = runtime.sessions.get(conversationKey(scope)).dir;
    const paths = resolveExecutionPaths(convDir, 'generating', 'p2');
    assert.equal(read(paths.checkpointPath).recovery.status, 'available');

    // First call marks `committed` without re-checking live WriteSet preimages; second call is idempotent!
    const ack1 = await runtime.completeRecovery({
      ...scope,
      workflowPhase: 'generating',
      targetPageId: 'p2',
      runId: execRes.runId,
    });
    const ack2 = await runtime.completeRecovery({
      ...scope,
      workflowPhase: 'generating',
      targetPageId: 'p2',
      runId: execRes.runId,
    });
    assert.deepEqual(ack1, { completed: true });
    assert.deepEqual(ack2, { completed: true });
    assert.equal(read(paths.checkpointPath).recovery.status, 'committed');
  } finally {
    runtime?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- 10b: 2-round same-`turn()` continuation `registeredRun` re-locking & forged reply rejection ---
  const prevWindow = (globalThis as any).window;
  try {
    const wfScope = resetWorkflowStores('probe10b-proj', multiPageSnapshot('probe10b-proj'));
    useProtoStore.setState(s => ({
      projectPlan: {
        ...s.projectPlan!,
        approved: true,
        generatedPageIds: ['p1', 'p3'],
      },
    }));

    const seenClientRequestIds: string[] = [];
    const completedAckCalls: any[] = [];
    let attemptCounter = 0;
    let forgeReplyMode = false;

    const listeners = new Set<(ev: any) => void>();
    (globalThis as any).window = {
      ...(prevWindow || {}),
      protoflowDesktop: {
        hermes: {
          onEvent: (fn: (ev: any) => void) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
          session: async (sc: any) => ({
            ...sc,
            sessionId: 'planning-wf',
            running: false,
            projectTools: registeredToolNames,
            models: { currentModelId: 'm', availableModels: [] },
          }),
          sync: async () => ({ synced: true }),
          completeRecovery: async (ack: any) => {
            completedAckCalls.push(ack);
            return { completed: true };
          },
          cancel: async () => {},
          execute: async (input: any) => {
            seenClientRequestIds.push(input.clientRequestId);
            const runId = `run-attempt-${++attemptCounter}`;
            const execSessionId = `exec-${input.targetPageId}`;
            const taskKey = JSON.stringify([input.projectId, 'project-page-exec', input.threadId ?? null, input.targetPageId]);
            const baseEvt = {
              projectId: input.projectId,
              kind: input.kind,
              ...(input.threadId ? { threadId: input.threadId } : {}),
              sessionId: execSessionId,
              planningSessionId: 'planning-wf',
              execSessionId,
              taskKey,
              targetPageId: input.targetPageId,
              clientRequestId: input.clientRequestId,
              runId,
            };
            listeners.forEach(fn => fn({ type: 'run-start', ...baseEvt }));
            try {
              if (forgeReplyMode) {
                return {
                  text: '伪造响应',
                  operations: [
                    {
                      tool: 'protoflow_apply_tsx_patch',
                      args: {
                        pageId: 'p2',
                        source: validPageSource('订单办理', '完整实现'),
                      },
                    },
                  ],
                  sessionId: execSessionId,
                  planningSessionId: 'planning-wf',
                  execSessionId,
                  taskKey,
                  clientRequestId: input.clientRequestId,
                  runId: 'forged-different-run-id',
                  modelId: 'm',
                };
              }
              // Attempt 1 returns an empty `<Page>` shell (`页面只有空框架`), triggering Attempt 2 (`continuation`) inside the SAME `turn()`!
              const src =
                attemptCounter === 1
                  ? 'export default function Page(){return <Page pfId="root" title="订单办理"/>;}'
                  : validPageSource('订单办理', '第二轮补齐完整卡片内容');
              return {
                text: '已生成',
                operations: [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'p2', source: src } }],
                sessionId: execSessionId,
                planningSessionId: 'planning-wf',
                execSessionId,
                taskKey,
                clientRequestId: input.clientRequestId,
                runId,
                modelId: 'm',
              };
            } finally {
              listeners.forEach(fn => fn({ type: 'run-end', ...baseEvt }));
            }
          },
        },
      },
    };

    await generateProject(wfScope.projectId, 'p2');
    assert.equal(seenClientRequestIds.length, 2);
    assert.notEqual(seenClientRequestIds[0], seenClientRequestIds[1]);
    assert.equal(completedAckCalls.length, 1);
    assert.equal(completedAckCalls[0].runId, 'run-attempt-2');
    assert.equal(completedAckCalls[0].targetPageId, 'p2');

    // Forged `runId` mismatch between `run-start` and `execute()` return MUST be rejected:
    useProtoStore.setState(s => ({
      projectPlan: { ...s.projectPlan!, generatedPageIds: ['p1', 'p3'] },
    }));
    forgeReplyMode = true;
    await assert.rejects(generateProject(wfScope.projectId, 'p2'), /AI 返回了其他会话或未登记轮次的结果/);

    // --- 10c: Batch failure triage (PAGE_VALIDATION_FAILED transitive skip vs shared error immediate stop) ---
    const batchSnap = multiPageSnapshot('probe10c-proj');
    const chainTable = {
      id: 't_chain',
      tableName: 'biz_chain',
      cnName: '链路表',
      domain: '交易域',
      description: '链路共享表',
      modeling: { entity: '链路', grain: '单行', reason: '测试传递跳过' },
      columns: [{ id: 'col_chain_id', name: 'chain_id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' }],
      sharedByMenus: [
        { pageId: 'p-dep1', menuTitle: '下游页一', accessMode: 'CRUD 读写' as const, fieldMappingNote: '写入链路' },
        { pageId: 'p-dep2', menuTitle: '下游页二', accessMode: 'READ 查询' as const, fieldMappingNote: '读取链路' },
      ],
    };
    batchSnap.dbTables = [chainTable as any];
    batchSnap.tableRows = { t_chain: [{ id: 'r1', chain_id: 'C-1' }] };
    const batchPages = [
      { pageId: 'p-fail', title: '上游失败页', folderId: 'f-main', requirements: '上游录入', dependencies: [] },
      {
        pageId: 'p-dep1',
        title: '下游页一',
        folderId: 'f-main',
        requirements: '依赖 p-fail',
        dependencies: [{ sourcePageId: 'p-fail', requirement: '引用上游记录', kind: 'reuse', sourceTableId: 't_chain' }],
      },
      {
        pageId: 'p-dep2',
        title: '下游页二',
        folderId: 'f-main',
        requirements: '传递依赖 p-dep1',
        dependencies: [{ sourcePageId: 'p-dep1', requirement: '继承下游页一记录', kind: 'reuse', sourceTableId: 't_chain' }],
      },
      { pageId: 'p-indep', title: '独立页面', folderId: 'f-main', requirements: '完全独立展示', dependencies: [] },
    ];
    batchSnap.designerFolders = [{ id: 'f-main', title: '主目录', parentFolderId: null }];
    batchSnap.designerPages = batchPages.map(p => ({ pageId: p.pageId, title: p.title, folderId: p.folderId }));
    batchSnap.pageCatalog = batchSnap.designerPages;
    batchSnap.pageSources = Object.fromEntries(batchPages.map(p => [p.pageId, validPageSource(p.title, '初始骨架')]));
    batchSnap.stickyNotes = [];
    batchSnap.projectNotes = [];
    batchSnap.projectPlan = {
      summary: '四页批次分流测试',
      folders: [{ id: 'f-main', title: '主目录', parentFolderId: null }],
      pages: batchPages as any,
      approved: true,
      generatedPageIds: [],
    };

    resetWorkflowStores('probe10c-proj', batchSnap);
    const executedPages: string[] = [];
    let batchFailureMode: 'page-validation' | 'shared-provider-rejected' = 'page-validation';

    const batchListeners = new Set<(ev: any) => void>();
    (globalThis as any).window.protoflowDesktop.hermes = {
      onEvent: (fn: (ev: any) => void) => {
        batchListeners.add(fn);
        return () => batchListeners.delete(fn);
      },
      session: async (sc: any) => ({
        ...sc,
        sessionId: 'planning-batch',
        running: false,
        projectTools: registeredToolNames,
        models: { currentModelId: 'm', availableModels: [] },
      }),
      sync: async () => ({ synced: true }),
      completeRecovery: async () => ({ completed: true }),
      cancel: async () => {},
      execute: async (input: any) => {
        executedPages.push(input.targetPageId);
        const runId = `run-${input.targetPageId}-${executedPages.length}`;
        const execSessionId = `exec-${input.targetPageId}`;
        const taskKey = JSON.stringify([input.projectId, 'project-page-exec', input.threadId ?? null, input.targetPageId]);
        const baseEvt = {
          projectId: input.projectId,
          kind: input.kind,
          sessionId: execSessionId,
          planningSessionId: 'planning-batch',
          execSessionId,
          taskKey,
          targetPageId: input.targetPageId,
          clientRequestId: input.clientRequestId,
          runId,
        };
        batchListeners.forEach(fn => fn({ type: 'run-start', ...baseEvt }));
        try {
          if (input.targetPageId === 'p-fail') {
            if (batchFailureMode === 'shared-provider-rejected') {
              const sharedErr: any = new Error('模型服务明确返回请求失败');
              sharedErr.failureEnvelope = {
                code: 'PROVIDER_REJECTED',
                failureScope: 'shared',
                terminalConfirmed: true,
                candidateStatus: 'none',
                targetPageId: 'p-fail',
              };
              throw sharedErr;
            }
            // Return invalid/unparseable TSX on both initial + retry so `turn()` throws `PAGE_VALIDATION_FAILED`!
            return {
              text: '坏源码',
              operations: [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'p-fail', source: 'export default function Broken(' } }],
              sessionId: execSessionId,
              planningSessionId: 'planning-batch',
              execSessionId,
              taskKey,
              clientRequestId: input.clientRequestId,
              runId,
              modelId: 'm',
            };
          }
          return {
            text: '独立页成功',
            operations: [
              {
                tool: 'protoflow_apply_tsx_patch',
                args: { pageId: input.targetPageId, source: validPageSource('独立页面', '独立页面已成功落盘') },
              },
            ],
            sessionId: execSessionId,
            planningSessionId: 'planning-batch',
            execSessionId,
            taskKey,
            clientRequestId: input.clientRequestId,
            runId,
            modelId: 'm',
          };
        } finally {
          batchListeners.forEach(fn => fn({ type: 'run-end', ...baseEvt }));
        }
      },
    };

    await assert.rejects(
      generateProject('probe10c-proj'),
      (batchErr: any) => {
        assert.equal(batchErr.failureEnvelope?.code, 'PAGE_VALIDATION_FAILED');
        assert.deepEqual(batchErr.failedPageIds, ['p-fail']);
        assert.deepEqual(batchErr.skippedPageIds.sort(), ['p-dep1', 'p-dep2']);
        return true;
      },
    );
    // `p-dep1` and `p-dep2` MUST NOT have been executed, whereas `p-indep` MUST have executed and committed!
    assert.equal(executedPages.includes('p-dep1'), false);
    assert.equal(executedPages.includes('p-dep2'), false);
    assert.equal(executedPages.includes('p-indep'), true);
    assert.ok(useProtoStore.getState().projectPlan?.generatedPageIds.includes('p-indep'));
    assert.match(usePageStore.getState().pageSources['p-indep'], /独立页面已成功落盘/);

    // Now reset and verify `PROVIDER_REJECTED` (shared failureScope) stops the batch immediately without running `p-indep`!
    resetWorkflowStores('probe10c-proj', batchSnap);
    executedPages.length = 0;
    batchFailureMode = 'shared-provider-rejected';
    await assert.rejects(
      generateProject('probe10c-proj'),
      (err: any) => err.failureEnvelope?.code === 'PROVIDER_REJECTED',
    );
    assert.deepEqual(executedPages, ['p-fail']);
    assert.deepEqual(useProtoStore.getState().projectPlan?.generatedPageIds, []);
  } finally {
    (globalThis as any).window = prevWindow;
  }
});

test('Probe 11: [P1] dependencyFootprint read/write failures fail closed across MCP tools, readContextFootprint, freezeContext, and HermesRuntime commit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe11-'));
  try {
    const snap = multiPageSnapshot('probe11-proj');
    const contextFile = path.join(dir, 'context.json');
    const sidecarPath = contextFile + '.footprint.json';

    // --- 11a: Write failure on `.footprint.json` blocks `protoflow_get_page_tsx` BEFORE returning source ---
    atomicWrite(sidecarPath, {
      runId: 'run-11a',
      dependencyFootprint: createEmptyDependencyFootprint('generating', 'p2'),
    });
    atomicWrite(contextFile, {
      active: true,
      runId: 'run-11a',
      projectId: 'probe11-proj',
      kind: 'project',
      workflowPhase: 'generating',
      targetPageId: 'p2',
      requireFootprintSidecar: true,
      baseSnapshot: structuredClone(snap),
      snapshot: structuredClone(snap),
      operations: [],
    });
    const contextBytesBefore = fs.readFileSync(contextFile, 'utf8');

    const origRenameSync = fs.renameSync;
    let blockSidecarRename = true;
    (fs as any).renameSync = (oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (blockSidecarRename && String(newPath) === sidecarPath) {
        const ioErr: any = new Error('EIO simulated footprint disk failure');
        ioErr.code = 'EIO';
        throw ioErr;
      }
      return origRenameSync(oldPath, newPath);
    };
    try {
      assert.throws(
        () => callTool(contextFile, 'protoflow_get_page_tsx', { pageId: 'p1' }),
        /依赖足迹记录保存失败/,
      );
    } finally {
      (fs as any).renameSync = origRenameSync;
    }

    // Read-only / failed call invariant: `context.json` itself was NOT mutated,
    // while `.footprint.error` blocks subsequent tool calls AND `readContextFootprint`!
    assert.equal(fs.readFileSync(contextFile, 'utf8'), contextBytesBefore);
    assert.throws(
      () => callTool(contextFile, 'protoflow_get_page_tsx', { pageId: 'p2' }),
      /依赖足迹记录已损坏或保存失败/,
    );
    assert.throws(
      () => readContextFootprint(contextFile),
      /依赖足迹记录已损坏或保存失败/,
    );

    // --- 11b: Corrupt/unreadable `.footprint.json` NEVER falls back to an older `context.dependencyFootprint` ---
    const contextFile11b = path.join(dir, 'context-11b.json');
    const sidecar11b = contextFile11b + '.footprint.json';
    // Seed a valid footprint covering ONLY `p2`, then copy it as stale `context.dependencyFootprint`
    atomicWrite(contextFile11b, {
      active: true,
      runId: 'run-11b',
      projectId: 'probe11-proj',
      kind: 'project',
      workflowPhase: 'generating',
      targetPageId: 'p2',
      baseSnapshot: structuredClone(snap),
      snapshot: structuredClone(snap),
      operations: [],
    });
    callTool(contextFile11b, 'protoflow_get_page_tsx', { pageId: 'p2' });
    const staleOnlyP2Footprint = readContextFootprint(contextFile11b);
    assert.equal(staleOnlyP2Footprint.version, 3);

    // Put stale `dependencyFootprint` into `context-11b.json`, then corrupt `.footprint.json`
    const ctxWithStale = {
      ...JSON.parse(fs.readFileSync(contextFile11b, 'utf8')),
      dependencyFootprint: staleOnlyP2Footprint,
    };
    atomicWrite(contextFile11b, ctxWithStale);
    fs.writeFileSync(sidecar11b, '{corrupt-sidecar-json', 'utf8');

    assert.throws(
      () => readContextFootprint(contextFile11b),
      /依赖足迹记录已损坏/,
    );
    assert.throws(
      () => callTool(contextFile11b, 'protoflow_get_page_tsx', { pageId: 'p1' }),
      /依赖足迹记录读取失败/,
    );

    // --- 11c: `HermesRuntime.execute` blocks commit and marks checkpoint `uncertain` if footprint fails mid-turn ---
    const rtDir = path.join(dir, 'runtime-data');
    const scope = { projectId: 'probe11-proj', kind: 'project' as const };
    const runtime = new HermesRuntime({
      dataDir: rtDir,
      emit: () => {},
      accountProvider: () => testAccount,
    });
    try {
      runtime.connect = async () => ({});
      runtime.client = {
        closed: false,
        close() {},
        notify() {},
        reply() {},
        reject() {},
        request: async (method: string, params: any) => {
          if (method === 'session/new' || method === 'session/load') {
            acknowledgeToolDiscovery(params);
            const isExec = String(params.cwd).includes('page-runs');
            return {
              sessionId: isExec ? 'exec-11c' : 'planning-11c',
              models: { currentModelId: 'provider:m', availableModels: [{ modelId: 'provider:m', name: 'M' }] },
            };
          }
          if (method === 'session/prompt') {
            const convDir = runtime.sessions.get(conversationKey(scope)).dir;
            const paths = resolveExecutionPaths(convDir, 'generating', 'p2');
            callTool(paths.contextFile, 'protoflow_get_project_brief', { pageId: 'p2' });
            callTool(paths.contextFile, 'protoflow_apply_tsx_patch', {
              pageId: 'p2',
              source: validPageSource('订单办理', '候选页面草稿'),
            });
            // Inject write failure when reading `p1` TSX; model swallows tool error and ends turn anyway!
            const pSidecar = paths.contextFile + '.footprint.json';
            (fs as any).renameSync = (oldPath: fs.PathLike, newPath: fs.PathLike) => {
              if (String(newPath) === pSidecar) {
                const err: any = new Error('ENOSPC footprint full');
                err.code = 'ENOSPC';
                throw err;
              }
              return origRenameSync(oldPath, newPath);
            };
            try {
              assert.throws(() => callTool(paths.contextFile, 'protoflow_get_page_tsx', { pageId: 'p1' }));
            } finally {
              (fs as any).renameSync = origRenameSync;
            }
            return { stopReason: 'end_turn' };
          }
          throw new Error(`Unexpected RPC ${method}`);
        },
      };

      await assert.rejects(
        runtime.execute({
          ...scope,
          workflowPhase: 'generating',
          targetPageId: 'p2',
          prompt: '生成订单办理页面',
          snapshot: structuredClone(snap),
          recoveryRevisionVersion: 3,
          recoverDraft: true,
        }),
        /依赖足迹记录缺失或保存失败，已阻止提交工程修改/,
      );

      const convDir = runtime.sessions.get(conversationKey(scope)).dir;
      const paths = resolveExecutionPaths(convDir, 'generating', 'p2');
      const savedCp = read(paths.checkpointPath);
      assert.equal(savedCp.footprintCorrupted, true);
      assert.equal(savedCp.dependencyFootprint, undefined);
      assert.equal(savedCp.recovery.status, 'uncertain');
    } finally {
      (fs as any).renameSync = origRenameSync;
      runtime.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Probe 12: [P2] regular page/menu conversation protoflow_search_history (menu_session) and project context(history) pass end-to-end against real SessionDB', async (t) => {
  const probeRt = new HermesRuntime({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe12-detect-')),
    emit: () => {},
  });
  let detected: any;
  try {
    detected = await detectTestHermes(probeRt);
  } finally {
    fs.rmSync(probeRt.dataDir, { recursive: true, force: true });
  }
  if (!detected?.detected || !detected.installDir || !fs.existsSync(detected.installDir)) {
    t.skip('Compatible Hermes fixture required (PFLOW_HERMES_SETTINGS)');
    return;
  }

  const launch = spawnSync(detected.binary, ['--print-runtime-command'], {
    env: { ...process.env, HERMES_HOME: detected.home },
    encoding: 'utf8',
  });
  const pythonBin = JSON.parse(launch.stdout)[0];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe12-'));
  const fakeHome = path.join(dir, 'hermes-home');
  fs.mkdirSync(fakeHome, { recursive: true });
  for (const sub of ['installs', 'tools', 'runtime', 'bootstrap-cache']) {
    const srcSub = path.join(detected.home, sub);
    if (fs.existsSync(srcSub)) fs.symlinkSync(srcSub, path.join(fakeHome, sub));
  }
  const runtime = new HermesRuntime({
    dataDir: path.join(dir, 'data'),
    emit: () => {},
    accountProvider: () => testAccount,
  });

  try {
    runtime.settings = { home: fakeHome, binary: detected.binary };
    const menuScope = { projectId: 'probe12-proj', pageId: 'p2' };
    const otherMenuScope = { projectId: 'probe12-proj', pageId: 'p1' };
    const projectScope = { projectId: 'probe12-proj', kind: 'project' as const };
    const menuDir = runtime.conversationWorkspace(menuScope);
    const otherMenuDir = runtime.conversationWorkspace(otherMenuScope);
    const projectDir = runtime.conversationWorkspace(projectScope);
    fs.mkdirSync(menuDir, { recursive: true });
    fs.mkdirSync(otherMenuDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    // Seed real Hermes `SessionDB` (`state.db`) with Gateway-style `local + created_source='acp'` sessions:
    const seedScript = `
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
from pm.environments import activate_dependencies
activate_dependencies(root)
from hermes_state import SessionDB
db_path = Path(sys.argv[2]) / "state.db"
with SessionDB(db_path=db_path) as db:
    db.create_session("menu-sid-p2", source="local", model="m", cwd=sys.argv[3])
    with db._lock, db._conn:
        db._conn.execute("UPDATE sessions SET created_source = 'acp' WHERE id = 'menu-sid-p2'")
    db.append_message("menu-sid-p2", role="user", content="普通页面对话历史：导出须包含报关单号 MENU_TOKEN_8821")
    db.create_session("menu-sid-p1", source="acp", model="m", cwd=sys.argv[4])
    db.append_message("menu-sid-p1", role="user", content="其他菜单隔离词 MENU_TOKEN_8821_OTHER_PAGE")
    db.create_session("proj-sid-plan", source="local", model="m", cwd=sys.argv[5])
    with db._lock, db._conn:
        db._conn.execute("UPDATE sessions SET created_source = 'acp' WHERE id = 'proj-sid-plan'")
    db.append_message("proj-sid-plan", role="assistant", content="项目规划会话结论 PLAN_TOKEN_9900")
`;
    execFileSync(pythonBin, ['-I', '-c', seedScript, detected.installDir, fakeHome, menuDir, otherMenuDir, projectDir], {
      env: { ...process.env, HERMES_HOME: fakeHome, HERMES_DISABLE_LAZY_INSTALLS: '1' },
    });

    runtime.info = {
      detected: true,
      connected: true,
      home: fakeHome,
      binary: detected.binary,
      installDir: detected.installDir,
      contextPython: pythonBin,
      capabilities: { loadSession: true },
    };
    runtime.connect = async () => runtime.info;

    let menuHistoryResult: any = null;
    runtime.client = {
      closed: false,
      close() {},
      notify() {},
      reply() {},
      reject() {},
      request: async (method: string, params: any) => {
        if (method === 'session/new' || method === 'session/load') {
          acknowledgeToolDiscovery(params);
          const sid =
            params.cwd === menuDir
              ? 'menu-sid-p2'
              : params.cwd === projectDir
                ? 'proj-sid-plan'
                : 'other-sid';
          return {
            sessionId: sid,
            models: { currentModelId: 'provider:m', availableModels: [{ modelId: 'provider:m', name: 'M' }] },
          };
        }
        if (method === 'session/prompt') {
          const contextFile = path.join(menuDir, 'context.json');
          menuHistoryResult = await callToolAsync(contextFile, 'protoflow_search_history', {
            query: 'MENU_TOKEN_8821',
          });
          return { stopReason: 'end_turn' };
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    };

    const snap = multiPageSnapshot(menuScope.projectId);
    await runtime.execute({
      ...menuScope,
      readOnly: true,
      prompt: '检索本页此前关于报关单导出的讨论',
      snapshot: structuredClone(snap),
    });

    assert.ok(menuHistoryResult, 'expected protoflow_search_history result in regular menu session');
    assert.equal(menuHistoryResult.total, 1);
    assert.equal(menuHistoryResult.matches[0].sourceSessionId, 'menu-sid-p2');
    assert.equal(menuHistoryResult.matches[0].sourceRole, 'menu_session');
    assert.match(menuHistoryResult.matches[0].text, /MENU_TOKEN_8821/);
    assert.doesNotMatch(JSON.stringify(menuHistoryResult), /OTHER_PAGE/);

    // Also verify `runtime.context({ ..., action: 'history' })` from `ProjectContextPanel` supplies `allowedHistorySessions`:
    const projSession = await runtime.session(projectScope);
    const panelHistory = await runtime.context({
      ...projectScope,
      sessionId: projSession.sessionId,
      action: 'history',
      query: 'PLAN_TOKEN_9900',
    });
    assert.equal(panelHistory.total, 1);
    assert.equal(panelHistory.matches[0].sourceSessionId, 'proj-sid-plan');
    assert.equal(panelHistory.matches[0].sourceRole, 'project_planning');
  } finally {
    runtime.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Probe 13: [P2] page sub-session syncs and persists reasoning effort across creation, reuse, cold-load same-model, and reset to default (null)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe13-'));
  const scope = { projectId: 'probe13-proj', kind: 'project' as const };
  const snap = multiPageSnapshot(scope.projectId);
  const effortSyncCalls: Array<{ sessionId: string; modelId: string; effort: string | null }> = [];

  const createMockRuntime = (modelId = 'provider:m-a', nonReasoningModels: Set<string> = new Set()) => {
    const rt = new HermesRuntime({
      dataDir: dir,
      emit: () => {},
      accountProvider: () => testAccount,
    });
    rt.connect = async () => ({});
    rt.applySessionEffort = async (sessionId: string, targetModelId: string, effort: string | null) => {
      effortSyncCalls.push({ sessionId, modelId: targetModelId, effort });
      if (nonReasoningModels.has(targetModelId) && effort !== null) {
        throw new Error('当前模型不支持这个推理强度');
      }
      return effort;
    };
    rt.client = {
      closed: false,
      close() {},
      notify() {},
      reply() {},
      reject() {},
      request: async (method: string, params: any) => {
        if (method === 'session/new' || method === 'session/load') {
          acknowledgeToolDiscovery(params);
          const isExec = String(params.cwd).includes('page-runs');
          return {
            sessionId: params.sessionId || (isExec ? 'exec-p2-s1' : 'planning-s1'),
            models: {
              currentModelId: modelId,
              availableModels: [
                { modelId: 'provider:m-a', name: 'Model A' },
                { modelId: 'provider:m-b', name: 'Model B' },
                { modelId: 'openai-api:gpt-4.1', name: 'GPT-4.1' },
              ],
            },
          };
        }
        if (method === 'session/prompt') {
          const convDir = rt.sessions.get(conversationKey(scope)).dir;
          const paths = resolveExecutionPaths(convDir, 'generating', 'p2');
          callTool(paths.contextFile, 'protoflow_get_project_brief', { pageId: 'p2' });
          callTool(paths.contextFile, 'protoflow_apply_tsx_patch', {
            pageId: 'p2',
            source: validPageSource('订单办理', '推理强度同步验证'),
          });
          return { stopReason: 'end_turn' };
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    };
    return rt;
  };

  let runtime = createMockRuntime();
  try {
    await runtime.session(scope);
    const planningKey = conversationKey(scope);
    const convDir = runtime.sessions.get(planningKey).dir;
    const paths = resolveExecutionPaths(convDir, 'generating', 'p2');

    const runPageP2 = () =>
      runtime.execute({
        ...scope,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        prompt: '生成 p2',
        snapshot: structuredClone(snap),
      });

    // 1. Initial creation with default (`preferredEffort = null`): 0 calls, records `appliedEffort: null`
    const r1 = await runPageP2();
    assert.equal(r1.metrics?.sessionCreated, true);
    assert.deepEqual(effortSyncCalls, []);
    assert.equal(read(paths.sessionFile).appliedEffort, null);

    // 2. Planning session selects `'high'` -> reused page sub-session MUST sync `'high'`!
    const planningState = runtime.sessions.get(planningKey);
    planningState.preferredEffort = 'high';
    runtime.persistConversationPreferredEffort(planningState);
    const r2 = await runPageP2();
    assert.equal(r2.metrics?.sessionReused, true);
    assert.deepEqual(effortSyncCalls, [
      { sessionId: 'exec-p2-s1', modelId: 'provider:m-a', effort: 'high' },
    ]);
    assert.equal(read(paths.sessionFile).appliedEffort, 'high');

    // 3. Re-running at `'high'` makes 0 redundant calls
    effortSyncCalls.length = 0;
    const r3 = await runPageP2();
    assert.equal(r3.metrics?.sessionReused, true);
    assert.deepEqual(effortSyncCalls, []);

    // 4. Planning session changes `'high' -> 'low'` on reused page sub-session
    planningState.preferredEffort = 'low';
    runtime.persistConversationPreferredEffort(planningState);
    await runPageP2();
    assert.deepEqual(effortSyncCalls, [
      { sessionId: 'exec-p2-s1', modelId: 'provider:m-a', effort: 'low' },
    ]);
    assert.equal(read(paths.sessionFile).appliedEffort, 'low');

    // 5. Planning session resets back to default (`preferredEffort = null`) on reused page sub-session!
    effortSyncCalls.length = 0;
    planningState.preferredEffort = null;
    runtime.persistConversationPreferredEffort(planningState);
    await runPageP2();
    assert.deepEqual(effortSyncCalls, [
      { sessionId: 'exec-p2-s1', modelId: 'provider:m-a', effort: null },
    ]);
    assert.equal(read(paths.sessionFile).appliedEffort, null);

    // 6. Set planning session to `'medium'` (persisted on disk), restart `HermesRuntime` ->
    // cold-load same-model branch MUST restore planning `'medium'` AND sync page sub-session from `null -> 'medium'`!
    effortSyncCalls.length = 0;
    planningState.preferredEffort = 'medium';
    runtime.persistConversationPreferredEffort(planningState);
    runtime.close();

    runtime = createMockRuntime();
    const rCold1 = await runPageP2();
    assert.equal(rCold1.metrics?.sessionReloaded, true);
    assert.deepEqual(effortSyncCalls, [
      { sessionId: 'exec-p2-s1', modelId: 'provider:m-a', effort: 'medium' },
    ]);
    assert.equal(read(paths.sessionFile).appliedEffort, 'medium');

    // 7. Restart `HermesRuntime` again, reset planning `preferredEffort = null` BEFORE cold-loading `p2` ->
    // cold-load same-model branch MUST reset page sub-session from `'medium' -> null`!
    effortSyncCalls.length = 0;
    runtime.close();

    runtime = createMockRuntime();
    await runtime.session(scope);
    const coldPlanning = runtime.sessions.get(planningKey);
    assert.equal(coldPlanning.preferredEffort, 'medium');
    coldPlanning.preferredEffort = null;
    runtime.persistConversationPreferredEffort(coldPlanning);

    const rCold2 = await runPageP2();
    assert.equal(rCold2.metrics?.sessionReloaded, true);
    assert.deepEqual(effortSyncCalls, [
      { sessionId: 'exec-p2-s1', modelId: 'provider:m-a', effort: null },
    ]);
    assert.equal(read(paths.sessionFile).appliedEffort, null);

    // 8. Legacy `session.json` missing `appliedEffort` & `appliedModelId` + non-reasoning model (`openai-api:gpt-4.1`) ->
    // cold-load same-model branch clears override (`effort: null`) without error and upgrades `session.json`!
    effortSyncCalls.length = 0;
    runtime.close();
    fs.writeFileSync(
      paths.sessionFile,
      JSON.stringify({
        ...scope,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        sessionId: 'exec-p2-s1',
        lineage: [],
      }),
      'utf8',
    );
    assert.equal(Object.hasOwn(read(paths.sessionFile), 'appliedEffort'), false);

    runtime = createMockRuntime('openai-api:gpt-4.1', new Set(['openai-api:gpt-4.1']));
    const rColdLegacy = await runPageP2();
    assert.equal(rColdLegacy.metrics?.sessionReloaded, true);
    assert.deepEqual(effortSyncCalls, [
      { sessionId: 'exec-p2-s1', modelId: 'openai-api:gpt-4.1', effort: null },
    ]);
    const upgradedRecord = read(paths.sessionFile);
    assert.equal(upgradedRecord.appliedModelId, 'openai-api:gpt-4.1');
    assert.equal(upgradedRecord.appliedEffort, null);
  } finally {
    runtime.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Probe 14: real local OS-pipe stdio ACP + live Hermes Gateway daemon + MCP stdio + loopback HTTP transport E2E', async (t) => {
  const probeRt = new HermesRuntime({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe14-detect-')),
    emit: () => {},
  });
  let detected: any;
  try {
    detected = await detectTestHermes(probeRt);
  } finally {
    fs.rmSync(probeRt.dataDir, { recursive: true, force: true });
  }
  if (!detected?.detected || !detected.installDir || !fs.existsSync(detected.installDir)) {
    t.skip('Compatible Hermes fixture required (PFLOW_HERMES_SETTINGS)');
    return;
  }

  const capturedChatBodies: any[] = [];
  let menuSearchToolResultsSeen: string[] = [];

  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (req.method === 'GET' && url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'fixture-model', object: 'model', created: 1700000000, owned_by: 'local' }],
        }),
      );
      return;
    }
    if (req.method === 'POST' && url.includes('/chat/completions')) {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', chunk => {
        raw += chunk;
      });
      req.on('end', () => {
        const body = JSON.parse(raw);
        capturedChatBodies.push(body);
        const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
        const lastMsg = messages.at(-1) || {};
        const allUserText = messages
          .filter(m => m.role === 'user')
          .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
          .join('\n');

        const sendReply = (messageObj: any, finishReason = 'stop') => {
          if (body.stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const delta: any = { role: 'assistant' };
            if (messageObj.content) delta.content = messageObj.content;
            if (messageObj.tool_calls) {
              delta.tool_calls = messageObj.tool_calls.map((tc: any, idx: number) => ({
                index: idx,
                id: tc.id,
                type: 'function',
                function: tc.function,
              }));
            }
            res.write(
              `data: ${JSON.stringify({
                id: `chatcmpl-${capturedChatBodies.length}`,
                object: 'chat.completion.chunk',
                created: 1700000000,
                model: 'fixture-model',
                choices: [{ index: 0, delta, finish_reason: null }],
              })}\n\n`,
            );
            res.write(
              `data: ${JSON.stringify({
                id: `chatcmpl-${capturedChatBodies.length}`,
                object: 'chat.completion.chunk',
                created: 1700000000,
                model: 'fixture-model',
                choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
                usage: { prompt_tokens: 96, completion_tokens: 16, total_tokens: 112 },
              })}\n\n`,
            );
            res.end('data: [DONE]\n\n');
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: `chatcmpl-${capturedChatBodies.length}`,
                object: 'chat.completion',
                created: 1700000000,
                model: 'fixture-model',
                choices: [{ index: 0, message: messageObj, finish_reason: finishReason }],
                usage: { prompt_tokens: 96, completion_tokens: 16, total_tokens: 112 },
              }),
            );
          }
        };

        // When Turn 2 asks to invoke real MCP `protoflow_search_history` (either eager or via Hermes v0.23.1 `tool_search` / `tool_call` bridge):
        const toolSpecs: any[] = Array.isArray(body.tools) ? body.tools : [];
        if (
          toolSpecs.length > 0 &&
          allUserText.includes('TRIGGER_REAL_MCP_HISTORY_SEARCH') &&
          !messages.some(m => m.role === 'tool')
        ) {
          const directSearchTool = toolSpecs.find(ts =>
            String(ts?.function?.name || '').includes('protoflow_search_history'),
          );
          if (directSearchTool) {
            sendReply(
              {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_hist_real_1',
                    type: 'function',
                    function: {
                      name: directSearchTool.function.name,
                      arguments: JSON.stringify({ query: 'REAL_WIRE_MENU_TOKEN_2026' }),
                    },
                  },
                ],
              },
              'tool_calls',
            );
            return;
          }
          const toolSearchSpec = toolSpecs.find(ts => ts?.function?.name === 'tool_search');
          const bridgeCallSpec = toolSpecs.find(ts => ts?.function?.name === 'tool_call');
          const catalogDesc = String(toolSearchSpec?.function?.description || '');
          const matchDeferred = catalogDesc.match(/-\s*([^\s:]*protoflow_search_history)\s*:/);
          if (bridgeCallSpec && matchDeferred?.[1]) {
            sendReply(
              {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_hist_real_1',
                    type: 'function',
                    function: {
                      name: 'tool_call',
                      arguments: JSON.stringify({
                        calls: [
                          {
                            name: matchDeferred[1],
                            arguments: { query: 'REAL_WIRE_MENU_TOKEN_2026' },
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
              'tool_calls',
            );
            return;
          }
        }
        for (const m of messages) {
          if (m.role === 'tool' && typeof m.content === 'string' && !menuSearchToolResultsSeen.includes(m.content)) {
            menuSearchToolResultsSeen.push(m.content);
          }
        }
        sendReply({ role: 'assistant', content: `REAL_TRANSPORT_OK_${capturedChatBodies.length}` }, 'stop');
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe14-home-'));
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe14-data-'));
  for (const sub of ['installs', 'tools', 'runtime', 'bootstrap-cache']) {
    const srcSub = path.join(detected.home, sub);
    if (fs.existsSync(srcSub)) fs.symlinkSync(srcSub, path.join(tempHome, sub));
  }
  const prevDisableLazy = process.env.HERMES_DISABLE_LAZY_INSTALLS;
  process.env.HERMES_DISABLE_LAZY_INSTALLS = '1';
  fs.writeFileSync(
    path.join(tempHome, 'config.yaml'),
    [
      'updates:',
      '  check: false',
      'model:',
      '  provider: custom',
      `  base_url: http://127.0.0.1:${port}/v1`,
      '  default: fixture-model',
      '  api_mode: chat_completions',
      'agent:',
      '  max_iterations: 4',
      'compression:',
      '  enabled: false',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(tempHome, '.env'),
    ['OPENAI_API_KEY=fixture-only', 'NO_PROXY=127.0.0.1,localhost', 'no_proxy=127.0.0.1,localhost', ''].join('\n'),
    'utf8',
  );

  const runtime = new HermesRuntime({
    dataDir: tempDataDir,
    emit: () => {},
    accountProvider: () => testAccount,
  });

  try {
    const info = await runtime.connect({ home: tempHome, binary: detected.binary });
    assert.equal(info.connected, true);

    const rawStdioUpdates: any[] = [];
    runtime.client.on('notification', (frame: any) => {
      if (frame?.method === 'session/update') rawStdioUpdates.push(frame);
    });

    const snap = multiPageSnapshot('probe14-proj');
    const menuScope = { projectId: 'probe14-proj', pageId: 'p1' };

    // 1. Real stdio ACP + real Gateway + real MCP stdio `menu_session` `protoflow_search_history`:
    await runtime.execute({
      ...menuScope,
      readOnly: true,
      prompt: '记录菜单导出需求 REAL_WIRE_MENU_TOKEN_2026',
      snapshot: structuredClone(snap),
    });

    rawStdioUpdates.length = 0;
    const menuTurn2 = await runtime.execute({
      ...menuScope,
      readOnly: true,
      prompt: 'TRIGGER_REAL_MCP_HISTORY_SEARCH 请检索本菜单历史中的导出需求',
      snapshot: structuredClone(snap),
    });

    // Verify native `session_search` was stripped from real Gateway ACP agent tool list AND deferred `tool_search` catalog, while MCP `protoflow_search_history` succeeded!
    const firstTurnWithTools = capturedChatBodies.find(b => Array.isArray(b.tools) && b.tools.length);
    const lastToolsSent = (firstTurnWithTools?.tools || []).map(
      (ts: any) => String(ts?.function?.name || ''),
    );
    assert.equal(
      lastToolsSent.some((n: string) => n === 'session_search'),
      false,
      'real Gateway ACP session must not expose native session_search in visible tools',
    );
    const toolSearchCatalogDesc = String(
      (firstTurnWithTools?.tools || []).find((ts: any) => ts?.function?.name === 'tool_search')?.function?.description || '',
    );
    assert.doesNotMatch(
      toolSearchCatalogDesc,
      /\bsession_search\b/,
      'real Gateway ACP session must not expose native session_search in deferred tool_search catalog',
    );
    assert.equal(
      menuSearchToolResultsSeen.length,
      1,
      `Expected 1 MCP search_history tool result; bodies=${JSON.stringify(
        capturedChatBodies.map(b => ({
          stream: b.stream,
          roles: (b.messages || []).map((m: any) => m.role),
          toolCount: (b.tools || []).length,
          sampleTools: (b.tools || []).slice(0, 8).map((ts: any) => ts?.function?.name),
        })),
      )}`,
    );
    assert.match(menuSearchToolResultsSeen[0], /REAL_WIRE_MENU_TOKEN_2026/);
    assert.match(menuSearchToolResultsSeen[0], /\\?"sourceRole\\?":\s*\\?"menu_session\\?"/);

    // 2. Verify real stdio `session/update` wire frames carry `_meta.alex_run_id` and `_meta.admission_id`:
    const run2ChunkFrames = rawStdioUpdates.filter(
      f => f.params?.sessionId === menuTurn2.sessionId && f.params?.update?.sessionUpdate === 'agent_message_chunk',
    );
    assert.ok(run2ChunkFrames.length >= 1, 'expected real stdio agent_message_chunk frames');
    for (const frame of run2ChunkFrames) {
      assert.equal(frame.params._meta?.alex_run_id, menuTurn2.runId);
      assert.equal(typeof frame.params._meta?.admission_id, 'string');
      assert.ok(frame.params._meta.admission_id.length > 0);
    }

    // 3. Real `hermes-reasoning.py` <-> live Gateway RPC sync across page sub-session creation, reuse, and reset (`null`):
    const projectScope = { projectId: 'probe14-proj', kind: 'project' as const };
    const planSession = await runtime.session(projectScope);
    const currentModelId = planSession.models.currentModelId;

    const readGatewayEffort = (sid: string) => {
      const out = execFileSync(
        info.reasoningPython || JSON.parse(execFileSync(info.binary, ['--print-runtime-command'], { env: { ...process.env, HERMES_HOME: tempHome }, encoding: 'utf8' }))[0],
        ['-I', '-c', fs.readFileSync(path.join(root, 'electron/hermes-reasoning.py'), 'utf8'), info.installDir],
        {
          env: { ...process.env, HERMES_HOME: tempHome },
          input: JSON.stringify({ sessionId: sid, modelId: currentModelId }),
          encoding: 'utf8',
        },
      );
      return JSON.parse(out);
    };

    const setHigh = await runtime.reasoning({
      ...projectScope,
      sessionId: planSession.sessionId,
      modelId: currentModelId,
      effort: 'high',
    });
    assert.equal(setHigh.current, 'high');

    const p2Turn1 = await runtime.execute({
      ...projectScope,
      readOnly: true,
      workflowPhase: 'generating',
      targetPageId: 'p2',
      prompt: '预览检查 p2 初始生成配置',
      snapshot: structuredClone(snap),
    });
    assert.equal(p2Turn1.metrics?.sessionCreated, true);
    assert.equal(readGatewayEffort(p2Turn1.execSessionId).current, 'high');

    // Change planning session effort `'high' -> 'low'` and reuse `p2` sub-session over live Gateway:
    await runtime.reasoning({
      ...projectScope,
      sessionId: planSession.sessionId,
      modelId: currentModelId,
      effort: 'low',
    });
    const p2Turn2 = await runtime.execute({
      ...projectScope,
      readOnly: true,
      workflowPhase: 'generating',
      targetPageId: 'p2',
      prompt: '预览检查 p2 复用配置 low',
      snapshot: structuredClone(snap),
    });
    assert.equal(p2Turn2.metrics?.sessionReused, true);
    assert.equal(readGatewayEffort(p2Turn2.execSessionId).current, 'low');

    // Reset planning session back to default (`effort: null`) and reuse `p2` sub-session:
    const resetPlan = await runtime.reasoning({
      ...projectScope,
      sessionId: planSession.sessionId,
      modelId: currentModelId,
      effort: null,
    });
    assert.notEqual(resetPlan.current, 'low');
    const p2Turn3 = await runtime.execute({
      ...projectScope,
      readOnly: true,
      workflowPhase: 'generating',
      targetPageId: 'p2',
      prompt: '预览检查 p2 恢复默认推理档位',
      snapshot: structuredClone(snap),
    });
    assert.equal(p2Turn3.metrics?.sessionReused, true);
    assert.equal(readGatewayEffort(p2Turn3.execSessionId).current, resetPlan.current);
    const convDir = runtime.sessions.get(conversationKey(projectScope)).dir;
    const p2Paths = resolveExecutionPaths(convDir, 'generating', 'p2');
    assert.equal(read(p2Paths.sessionFile).appliedEffort, null);

    // 4. Legacy `session.json` (missing `appliedEffort`) + non-reasoning model (`openai-api:gpt-4.1`) over live Gateway:
    assert.equal(
      planSession.models.availableModels.some((m: any) => m.modelId === 'openai-api:gpt-4.1'),
      true,
      'live Gateway must expose openai-api:gpt-4.1 when OPENAI_API_KEY is configured',
    );
    await runtime.changeModel({ ...projectScope, modelId: 'openai-api:gpt-4.1' });

    const gpt41Settings = await runtime.reasoning({
      ...projectScope,
      sessionId: planSession.sessionId,
      modelId: 'openai-api:gpt-4.1',
    });
    assert.deepEqual(gpt41Settings.levels, []);

    await assert.rejects(
      () =>
        runtime.reasoning({
          ...projectScope,
          sessionId: planSession.sessionId,
          modelId: 'openai-api:gpt-4.1',
          effort: 'low',
        }),
      /当前模型不支持这个推理强度/,
    );

    const gpt41Cleared = await runtime.reasoning({
      ...projectScope,
      sessionId: planSession.sessionId,
      modelId: 'openai-api:gpt-4.1',
      effort: null,
    });
    assert.deepEqual(gpt41Cleared.levels, []);

    // Switch `p2` sub-session to `openai-api:gpt-4.1`, strip `appliedEffort`/`appliedModelId` to mimic legacy `session.json`,
    // and cold-load `p2` through the same-model cold-load branch (`ensurePageExecutionSession`):
    const p2TaskKey = taskKeyForExecution(projectScope, 'generating', 'p2');
    const livePlanningSession = runtime.sessions.get(conversationKey(projectScope));
    await runtime.ensurePageExecutionSession({
      scope: projectScope,
      planningSession: livePlanningSession,
      paths: p2Paths,
      taskKey: p2TaskKey,
      targetPageId: 'p2',
    });
    const preLegacyRecord = read(p2Paths.sessionFile);
    fs.writeFileSync(
      p2Paths.sessionFile,
      JSON.stringify({
        projectId: projectScope.projectId,
        kind: projectScope.kind,
        workflowPhase: 'generating',
        targetPageId: 'p2',
        sessionId: preLegacyRecord.sessionId,
        lineage: preLegacyRecord.lineage || [],
      }),
      'utf8',
    );
    assert.equal(Object.hasOwn(read(p2Paths.sessionFile), 'appliedEffort'), false);

    runtime.pageSessions.clear();
    const coldLegacyLoaded = await runtime.ensurePageExecutionSession({
      scope: projectScope,
      planningSession: livePlanningSession,
      paths: p2Paths,
      taskKey: p2TaskKey,
      targetPageId: 'p2',
    });
    assert.equal(coldLegacyLoaded.setupRecord.reloaded, true);
    assert.equal(coldLegacyLoaded.setupRecord.reloadReason, 'cold_load');
    assert.equal(coldLegacyLoaded.session.models.currentModelId, 'openai-api:gpt-4.1');
    assert.equal(coldLegacyLoaded.session.appliedEffort, null);
    assert.equal(coldLegacyLoaded.session.appliedEffortKnown, true);

    const upgradedP2Record = read(p2Paths.sessionFile);
    assert.equal(upgradedP2Record.appliedModelId, 'openai-api:gpt-4.1');
    assert.equal(upgradedP2Record.appliedEffort, null);
  } finally {
    runtime.close();
    try {
      const stagedBin = runtime.info?.binary || detected.binary;
      execFileSync(stagedBin, ['gateway', 'stop'], {
        env: { ...process.env, HERMES_HOME: tempHome },
        timeout: 15000,
        stdio: 'ignore',
      });
    } catch {}
    if (prevDisableLazy === undefined) delete process.env.HERMES_DISABLE_LAZY_INSTALLS;
    else process.env.HERMES_DISABLE_LAZY_INSTALLS = prevDisableLazy;
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
});

test('Probe 15: prepareNativeRecovery inside real Electron runtime handles app.asar without Invalid package and matches Node fingerprint', async (t) => {
  const probeRt = new HermesRuntime({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe15-detect-')),
    emit: () => {},
  });
  let detected: any;
  try {
    detected = await detectTestHermes(probeRt);
  } finally {
    fs.rmSync(probeRt.dataDir, { recursive: true, force: true });
  }
  const electronBin = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
  );
  if (
    !detected?.detected ||
    !detected.installDir ||
    !fs.existsSync(detected.installDir) ||
    !fs.existsSync(electronBin)
  ) {
    t.skip('Compatible Hermes fixture (PFLOW_HERMES_SETTINGS) and Electron binary required');
    return;
  }

  const { SUPPORTED, prepareNativeRecovery } = require(
    path.join(root, 'electron/hermes-recovery-native.cjs'),
  );
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe15-hermes-src-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-probe15-data-'));

  try {
    for (const rel of Object.keys(SUPPORTED)) {
      const srcFile = path.join(detected.installDir, rel);
      const dstFile = path.join(fixtureRoot, rel);
      fs.mkdirSync(path.dirname(dstFile), { recursive: true });
      fs.copyFileSync(srcFile, dstFile);
    }
    // 1. Top-level `apps/desktop/release/.../app.asar` (Hermes Desktop build artifact)
    const desktopReleaseResources = path.join(
      fixtureRoot,
      'apps/desktop/release/mac-arm64/Hermes.app/Contents/Resources',
    );
    fs.mkdirSync(desktopReleaseResources, { recursive: true });
    fs.writeFileSync(path.join(desktopReleaseResources, 'app.asar'), 'corrupt-or-foreign-asar');

    // 2. `.asar` file inside a non-excluded runtime directory (`assets/`)
    fs.mkdirSync(path.join(fixtureRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'assets/embedded-fixture.asar'), 'raw-non-asar-payload');

    // 3. Nested directory named `apps` (`ui-tui/src/sdk/apps`) must NOT be excluded
    fs.mkdirSync(path.join(fixtureRoot, 'ui-tui/src/sdk/apps'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'ui-tui/src/sdk/apps/keep.txt'), 'keep-nested-apps');

    const electronScript = `
      const assert = require('node:assert/strict');
      const path = require('node:path');
      const origFs = require('original-fs');
      const { prepareNativeRecovery } = require(path.join(process.cwd(), 'electron/hermes-recovery-native.cjs'));
      (async () => {
        assert.ok(process.versions.electron, 'must execute inside Electron runtime');
        const [srcRoot, targetDataDir] = process.argv.slice(1);
        const out1 = await prepareNativeRecovery(srcRoot, targetDataDir);
        const out2 = await prepareNativeRecovery(srcRoot, targetDataDir);
        assert.equal(out1, out2);
        assert.equal(origFs.existsSync(path.join(out1, 'apps')), false);
        assert.equal(
          origFs.readFileSync(path.join(out1, 'assets/embedded-fixture.asar'), 'utf8'),
          'raw-non-asar-payload',
        );
        assert.equal(
          origFs.readFileSync(path.join(out1, 'ui-tui/src/sdk/apps/keep.txt'), 'utf8'),
          'keep-nested-apps',
        );
        process.stdout.write(JSON.stringify({ electronVersion: process.versions.electron, out: out1 }));
      })().catch((err) => {
        console.error(err);
        process.exit(1);
      });
    `;

    const res = spawnSync(electronBin, ['-e', electronScript, fixtureRoot, dataDir], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(res.status, 0, `Electron prepareNativeRecovery failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout.trim());
    assert.ok(parsed.electronVersion.length > 0);

    // Plain Node must compute the exact same fingerprint & reuse the staged directory created by Electron
    const nodeOut = await prepareNativeRecovery(fixtureRoot, dataDir);
    assert.equal(nodeOut, parsed.out);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
