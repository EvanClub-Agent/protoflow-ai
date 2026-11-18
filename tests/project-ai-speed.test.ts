import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { useProtoStore, type DBTableSchema, type StickyNoteRule } from '../src/store/useProtoStore';
import { usePageStore, type CustomCompositeBlock } from '../src/proto/store/usePageStore';
import { useHermesStore, buildProtoFlowHermesSkillMarkdown } from '../src/store/useHermesStore';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { captureProjectPayload, createProjectPayload, loadProjectFromBinaryPayload, startProjectPersistence } from '../src/services/projectStorage';
import { projectContext } from '../src/services/hermesProject';
import {
  clearPersistedTurnMetrics,
  discussProject,
  exportProjectAiMetricsReport,
  generateProject,
  MAX_PERSISTED_BATCH_METRICS,
  MAX_PERSISTED_TURN_METRICS,
  projectPlanProgress,
  purgeConversationTelemetry,
  readPersistedBatchMetrics,
  readPersistedTurnMetrics,
  STAGE_TIMING_SEMANTICS,
  useProjectWorkflow,
} from '../src/services/projectWorkflow';
import { batchMetricsStorageKey, projectChatScope } from '../src/services/projectChatHistory';
import { conversationKey } from '../src/services/hermesConversation';
import { getMaterialContracts, MATERIAL_CONTRACT_VERSION, MATERIAL_VALUE_DEFINITIONS } from '../src/proto/registry/materialContract';
import { ACTIONS } from '../src/proto/runtime/actions';

const { callTool, callToolAsync, readExecutionIdentity, atomicWrite, tools: mcpTools } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const { ContextBridgePool } = require(path.join(process.cwd(), 'electron/hermes-context-bridge.cjs'));
const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));

const sampleTable: DBTableSchema = {
  id: 't_order_main',
  tableName: 'order_main',
  cnName: '采购订单主表',
  domain: '业务单据域',
  description: '记录采购订单头信息',
  modeling: { entity: '采购订单', grain: '每张采购单一行', reason: '订单列表与创建共用主表' },
  columns: [
    { id: 'col-order-id', name: 'order_no', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '订单编号' },
    { id: 'col-supplier', name: 'supplier_name', dataType: 'VARCHAR(128)', nullable: false, isPrimaryKey: false, comment: '供应商名称' },
  ],
  sharedByMenus: [
    { pageId: 'page-orders', menuTitle: '采购订单', accessMode: 'CRUD 读写', fieldMappingNote: '列表查询与新建订单' },
  ],
};

const sampleSticky: StickyNoteRule = {
  id: 'sticky-order-1',
  index: 1,
  pageId: 'page-orders',
  targetWidgetId: 'btn-save',
  targetWidgetName: '提交订单',
  text: '点击提交保存采购订单',
  compiledRule: 'submitForm("form-order")',
  active: true,
};

const sampleBlock: CustomCompositeBlock = {
  id: 'block-header',
  name: '单据头区块',
  category: '表单区块',
  description: '复用单据头部信息',
  tsx: '<Card pfId="blk-1" title="单据头" />',
  createdAt: '2026-11-11',
};

function setupProjectFixture(projectId: string) {
  const payload = createProjectPayload({
    projectId,
    projectName: '速度观测测试工程',
    templateId: 'blank_project',
    storageDir: '/tmp',
    fileName: `${projectId}.pflow`,
    createdAt: '2026-11-11',
    updatedAt: '2026-11-11',
    pageCount: 0,
    tableCount: 0,
    stickyCount: 0,
  });
  loadProjectFromBinaryPayload(payload);
  useProtoStore.getState().setViewMode('project_ai');
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
  const scope = { projectId, kind: 'project' as const };
  clearPersistedTurnMetrics(scope);
  try { window.localStorage.removeItem(batchMetricsStorageKey(projectId)); } catch {}
  useAiChatStore.getState().switchConversation(scope);
  useHermesStore.setState({
    status: 'running',
    sessions: {},
    lastMetrics: {},
    runningProjects: {},
    cancelGeneration: {},
    partial: {},
    progress: {},
  });
  useProjectWorkflow.setState({
    running: {},
    runningChat: {},
    status: {},
    lastTurnMetrics: {},
    turnMetricsHistory: {},
    lastBatchMetrics: {},
    batchMetricsHistory: {},
  });
  return scope;
}

function wireMockHermes(hermes: any) {
  const listeners = new Set<(e: any) => void>();
  const origSession = hermes.session;
  const origExecute = hermes.execute;
  const sessionIds = new Map<string, string>();
  return {
    ...hermes,
    onEvent: (fn: (e: any) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    session: async (reqScope: any) => {
      const s = await origSession(reqScope);
      sessionIds.set(conversationKey(reqScope), s.sessionId);
      return s;
    },
    execute: async (input: any) => {
      const planningSessionId = sessionIds.get(conversationKey(input)) ?? `sess-${input.threadId ?? 'root'}`;
      const execSessionId =
        input.workflowPhase === 'generating' && input.targetPageId
          ? `${planningSessionId}-exec-${input.targetPageId}`
          : planningSessionId;
      const taskKey =
        input.workflowPhase === 'generating' && input.targetPageId
          ? JSON.stringify([input.projectId, 'project-page-exec', input.threadId ?? null, input.targetPageId])
          : conversationKey(input);
      const res = await origExecute(input);
      const runId = res.runId ?? 'run-mock';
      const baseEvt = {
        projectId: input.projectId,
        kind: input.kind,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        sessionId: execSessionId,
        planningSessionId,
        execSessionId,
        taskKey,
        ...(input.targetPageId ? { targetPageId: input.targetPageId } : {}),
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
        runId,
      };
      listeners.forEach((fn) => fn({ type: 'run-start', ...baseEvt }));
      listeners.forEach((fn) => fn({ type: 'run-end', ...baseEvt, ...(res.metrics ? { metrics: res.metrics } : {}) }));
      return {
        ...res,
        sessionId: execSessionId,
        planningSessionId,
        execSessionId,
        taskKey,
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
        runId,
      };
    },
  };
}

test('Step 1: buildProtoFlowHermesSkillMarkdown stays byte-identical across table/block/sticky additions and preserves session reuse', async (t) => {
  const emptyProjectMd = buildProtoFlowHermesSkillMarkdown([], [], [], 'project', 'hybrid');
  const populatedProjectMd = buildProtoFlowHermesSkillMarkdown(
    [sampleTable, { ...sampleTable, id: 't_order_item', tableName: 'order_item' }],
    [sampleBlock],
    [sampleSticky, { ...sampleSticky, id: 'sticky-order-2', index: 2 }],
    'project',
    'hybrid',
  );
  assert.equal(emptyProjectMd, populatedProjectMd);
  assert.ok(!emptyProjectMd.includes('Current project has'));
  assert.ok(emptyProjectMd.includes('protoflow_get_project'));

  const emptyMenuMd = buildProtoFlowHermesSkillMarkdown([], [], [], 'menu', 'desktop');
  const populatedMenuMd = buildProtoFlowHermesSkillMarkdown([sampleTable], [sampleBlock], [sampleSticky], 'menu', 'desktop');
  assert.equal(emptyMenuMd, populatedMenuMd);

  // Verify HermesRuntime reuses the live session (no refresh_prompt or session/load) when tables/stickies grow
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-speed-skill-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const events: any[] = [];
  const runtime = new HermesRuntime({
    dataDir: path.join(tmpDir, 'data'),
    emit: (e: any) => events.push(e),
    validateDecodedImage: () => ({ width: 1, height: 1 }),
    deleteHistorySession: async () => {},
  });

  const mockClient = new EventEmitter() as any;
  mockClient.closed = false;
  mockClient.close = () => { mockClient.closed = true; };
  mockClient.notify = () => {};

  let sessionNewCalls = 0;
  let sessionLoadCalls = 0;
  let refreshPromptCalls = 0;
  let activeSessionCwd = '';

  mockClient.request = async (method: string, params: any) => {
    if (method === 'session/new' || method === 'session/load') {
      if (method === 'session/new') sessionNewCalls += 1;
      if (method === 'session/load') sessionLoadCalls += 1;
      activeSessionCwd = params.cwd;
      const binding = params.mcpServers?.[0]?.env?.find((x: any) => x.name === 'PROTOFLOW_TOOL_BINDING')?.value;
      if (binding) {
        atomicWrite(path.join(params.cwd, 'tool-registration.json'), {
          binding,
          tools: mcpTools.map((tool: any) => tool.name),
        });
      }
      return {
        sessionId: params.sessionId ?? 'sess-speed-1',
        models: { currentModelId: 'mock-fast', availableModels: [{ modelId: 'mock-fast', name: 'Mock Fast' }] },
      };
    }
    if (method === 'session/prompt') {
      const meta = { alex_run_id: params._meta?.alex_run_id, admission_id: 'aid-speed-1' };
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: meta,
          update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking...' } },
        },
      });
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: meta,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已完成分析' } },
        },
      });
      return { stopReason: 'end_turn' };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  };

  const fakeHome = path.join(tmpDir, 'hermes-home');
  const fakeInstall = path.join(tmpDir, 'hermes-install');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeInstall, { recursive: true });
  runtime.settings = { home: fakeHome, binary: '/bin/echo' };
  runtime.client = mockClient;
  mockClient.on('notification', (frame: any) => runtime.onNotification(frame));
  runtime.info = {
    detected: true,
    connected: true,
    home: fakeHome,
    binary: '/bin/echo',
    installDir: fakeInstall,
    version: '0.9.0',
    capabilities: { loadSession: true },
  };
  runtime.contextBridge = async () => ({ python: process.execPath, installDir: fakeInstall, home: fakeHome });
  runtime.watchContext = async () => () => {};
  runtime.nativeContext = async (req: any) => {
    if (req.action === 'refresh_prompt') {
      refreshPromptCalls += 1;
      return { sessionId: req.sessionId, requestedEpoch: refreshPromptCalls };
    }
    if (req.action === 'verify_prompt') {
      const content = fs.readFileSync(path.join(activeSessionCwd, 'AGENTS.md'));
      const digest = crypto.createHash('sha256').update(content).digest('hex');
      return {
        sessionId: req.sessionId,
        verified: true,
        appliedSkillDigest: digest,
        expectedSkillDigest: digest,
        promptControlEpoch: refreshPromptCalls,
      };
    }
    return { sessionId: req.sessionId, usage: { available: true, used: 100, size: 128000, compressions: 0 } };
  };

  const scope = setupProjectFixture('speed-reuse');
  await runtime.sync({ ...scope, skillMarkdown: emptyProjectMd });
  const turn1 = await runtime.execute({
    ...scope,
    workflowPhase: 'conversation',
    prompt: '第一轮：空表状态讨论',
    snapshot: projectContext(),
  });
  assert.equal(sessionNewCalls, 1);
  assert.equal(sessionLoadCalls, 0);
  assert.equal(turn1.metrics.sessionCreated, true);
  assert.equal(typeof turn1.metrics.firstOutputMs, 'number');
  assert.equal(typeof turn1.metrics.firstTextMs, 'number');
  assert.ok(turn1.metrics.firstOutputMs <= turn1.metrics.firstTextMs);

  // Simulate tables & stickies added after Turn 1: re-syncing skill markdown must NOT trigger session reload
  useProtoStore.setState({ dbTables: [sampleTable], stickyNotes: [sampleSticky] });
  await runtime.sync({ ...scope, skillMarkdown: populatedProjectMd });
  const turn2 = await runtime.execute({
    ...scope,
    workflowPhase: 'conversation',
    prompt: '第二轮：新增表和便签后继续讨论',
    snapshot: projectContext(),
  });
  assert.equal(sessionNewCalls, 1);
  assert.equal(sessionLoadCalls, 0, 'session/load must not fire when only table/sticky counts changed');
  assert.equal(refreshPromptCalls, 0, 'refresh_prompt must not fire when skill markdown is stable');
  assert.equal(turn2.metrics.sessionReused, true);
  assert.equal(turn2.metrics.sessionReloaded, false);
  assert.equal(events.filter((e) => e.type === 'run-end' && e.metrics).length, 2);
});

test('Step 1: projectContext omits ~243KB static material contracts while preserving dynamic contracts and full MCP contract queries', (t) => {
  const scope = setupProjectFixture('speed-lean-context');
  useProtoStore.setState({ dbTables: [sampleTable], stickyNotes: [sampleSticky] });
  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });

  const staticContractsBytes = Buffer.byteLength(
    JSON.stringify({
      components: getMaterialContracts(),
      materialContractVersion: MATERIAL_CONTRACT_VERSION,
      materialValueDefinitions: MATERIAL_VALUE_DEFINITIONS,
      actions: ACTIONS,
    }),
    'utf8',
  );
  assert.ok(staticContractsBytes > 200_000, `expected static material contracts > 200KB, got ${staticContractsBytes}`);

  const ctx = projectContext();
  const leanBytes = Buffer.byteLength(JSON.stringify(ctx), 'utf8');
  assert.ok(leanBytes < 30_000, `expected lean projectContext < 30KB on small project, got ${leanBytes}`);
  assert.equal('components' in ctx.contracts, false);
  assert.equal('actions' in ctx.contracts, false);
  assert.equal('materialContractVersion' in ctx.contracts, false);
  assert.equal('materialValueDefinitions' in ctx.contracts, false);
  assert.ok(ctx.contracts.sticky);
  assert.ok(ctx.contracts.auditIssue);
  assert.deepEqual(ctx.contracts.tableDomains, ['业务单据域']);
  assert.ok(ctx.contracts.folderIds.includes('folder-proc'));

  // Verify protoflow-mcp still serves complete component, action, DB, sticky, audit, and folder contracts
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-lean-mcp-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const contextFile = path.join(tmpDir, 'context.json');
  atomicWrite(contextFile, {
    ...scope,
    active: true,
    runId: 'run-lean-1',
    workflowPhase: 'conversation',
    snapshot: ctx,
    operations: [],
  });

  const projectRes = callTool(contextFile, 'protoflow_get_project', {});
  assert.ok(Array.isArray(projectRes.contracts.components) && projectRes.contracts.components.length > 20);
  assert.ok(projectRes.contracts.actions);
  assert.equal(projectRes.contracts.materialContractVersion, MATERIAL_CONTRACT_VERSION);
  assert.ok(projectRes.contracts.dbTable);
  assert.ok(projectRes.contracts.dbColumn);
  assert.ok(projectRes.contracts.sticky);
  assert.ok(projectRes.contracts.auditIssue);
  assert.deepEqual(projectRes.contracts.tableDomains, ['业务单据域']);
  assert.ok(projectRes.contracts.folderIds.includes('folder-proc'));

  const contractsRes = callTool(contextFile, 'protoflow_get_contracts', { componentNames: ['Page', 'Table', 'Form'] });
  assert.deepEqual(
    contractsRes.components.map((c: { name: string }) => c.name).sort(),
    ['Form', 'Page', 'Table'],
  );
  assert.ok(contractsRes.actions);
  assert.ok(contractsRes.materialValueDefinitions);
});

test('Step 1: callTool records per-tool metrics to metricsFile without mutating context.json on read-only or failed calls', (t) => {
  const scope = setupProjectFixture('speed-mcp-metrics');
  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  usePageStore.getState().createDesignerPage(
    { pageId: 'page-orders', title: '采购订单', folderId: 'folder-proc' },
    'export default function Page(){return <Page pfId="root" title="采购订单"><Card pfId="card" title="列表"/></Page>}',
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-tool-metrics-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const contextFile = path.join(tmpDir, 'context.json');
  const metricsFile = path.join(tmpDir, 'tool-metrics.jsonl');

  atomicWrite(contextFile, {
    ...scope,
    active: true,
    runId: 'run-metrics-1',
    sessionId: 'sess-m1',
    workflowPhase: 'conversation',
    metricsFile,
    snapshot: projectContext(),
    operations: [],
  });

  // 1. Read-only tool (`protoflow_get_page_tsx`) must NOT mutate context.json
  const beforeRead = fs.readFileSync(contextFile, 'utf8');
  const pageRes = callTool(contextFile, 'protoflow_get_page_tsx', { pageId: 'page-orders' });
  assert.match(pageRes.source, /采购订单/);
  assert.equal(fs.readFileSync(contextFile, 'utf8'), beforeRead, 'read-only call must not rewrite context.json');

  // 2. Failed write tool (`protoflow_apply_tsx_patch` with invalid TSX) must NOT mutate context.json
  callTool(contextFile, 'protoflow_get_project_brief', {});
  const beforeFail = fs.readFileSync(contextFile, 'utf8');
  assert.throws(
    () => callTool(contextFile, 'protoflow_apply_tsx_patch', { pageId: 'page-orders', source: 'export default function Page(){return <UnknownWidget pfId="bad"/>}' }),
    /契约校验失败/,
  );
  assert.equal(fs.readFileSync(contextFile, 'utf8'), beforeFail, 'failed write call must not mutate context.json');

  // 3. Block edit (`protoflow_edit_page_block`) records both requested tool and normalized tool
  const blockRes = callTool(contextFile, 'protoflow_edit_page_block', {
    pageId: 'page-orders',
    targetPfId: 'card',
    mode: 'append_children',
    tsx: '<Button pfId="btn-refresh" onClick={() => toast("已刷新")}>刷新</Button>',
  });
  assert.equal(blockRes.staged, true);

  const lines = fs.readFileSync(metricsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 4);
  assert.equal(lines[0].tool, 'protoflow_get_page_tsx');
  assert.equal(lines[0].ok, true);
  assert.ok(lines[0].resultBytes > 0);
  assert.equal(lines[2].tool, 'protoflow_apply_tsx_patch');
  assert.equal(lines[2].ok, false);
  assert.match(lines[2].error, /契约校验失败/);
  assert.equal(lines[3].tool, 'protoflow_edit_page_block');
  assert.equal(lines[3].normalizedTool, 'protoflow_apply_tsx_patch');
  assert.equal(lines[3].ok, true);
});

test('Step 1: projectWorkflow records complete stage timings, payload sizes, tool breakdown, and retry metrics', async () => {
  const scope = setupProjectFixture('speed-workflow-telemetry');
  const key = conversationKey(scope);
  const allTools = mcpTools.map((tool: { name: string }) => tool.name);

  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  useProtoStore.setState({
    dbTables: [sampleTable],
    projectPlan: {
      summary: '采购订单管理方案',
      folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
      pages: [
        {
          pageId: 'page-orders',
          title: '采购订单',
          folderId: 'folder-proc',
          requirements: '支持填写并提交采购订单',
          dependencies: [],
          acceptanceCases: [
            {
              scenario: '填写表单后点击提交保存订单',
              expected: '订单写入采购订单主表',
              actionPfId: 'btn-submit',
              actionKind: 'submitForm',
              targetId: 'form-order',
              tableId: 't_order_main',
            },
          ],
        },
      ],
      approved: true,
      generatedPageIds: [],
    },
  });

  let executeAttempt = 0;
  (window as any).protoflowDesktop = {
    hermes: wireMockHermes({
      onEvent: () => () => {},
      session: async (reqScope: any) => ({
        ...reqScope,
        sessionId: 'sess-wf-1',
        running: false,
        projectTools: allTools,
        models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
        lastSetup: {
          durationMs: 0.4,
          connectMs: 0.4,
          promptRefreshMs: 0,
          acpSessionRpcMs: 0,
          reused: true,
          reloaded: false,
          created: false,
          reloadReason: null,
        },
      }),
      sync: async () => ({ synced: true, skillDigest: 'digest-v1' }),
      cancel: async () => {},
      execute: async (input: any) => {
        const currentAttempt = executeAttempt++;
        if (input.workflowPhase === 'conversation') {
          return {
            text: '当前项目包含 1 张采购订单主表。',
            operations: [],
            sessionId: 'sess-wf-1',
            runId: 'run-conv-1',
            modelId: 'mock-pro',
            skillDigest: 'digest-v1',
            metrics: {
              totalExecuteMs: 120,
              sessionSetupMs: 5,
              connectMs: 0.5,
              promptRefreshMs: 0,
              acpSessionRpcMs: 0,
              contextBridgeSetupMs: 12,
              sessionReused: true,
              sessionReloaded: false,
              sessionCreated: false,
              reloadReason: null,
              firstOutputMs: 35,
              firstTextMs: 48,
              acpTurnMs: 95,
              unattributedAcpMs: 90.5,
              userWaitMs: 0,
              promptVerifyMs: 8,
              toolExecMs: 4.5,
              toolCallCount: 1,
              failedToolCallCount: 0,
              nativeToolExecMs: 0,
              nativeToolCallCount: 0,
              failedNativeToolCallCount: 0,
              nativeToolBreakdown: {},
              acpToolCallCount: 1,
              toolBreakdown: {
                protoflow_get_project_brief: { count: 1, failedCount: 0, totalMs: 4.5, argBytes: 2, resultBytes: 512 },
              },
              promptBytes: Buffer.byteLength(input.prompt, 'utf8'),
              imageBytes: 0,
              snapshotBytes: Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8'),
              contextJsonBytes: Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8') + 240,
              skillBytes: 4200,
            },
          };
        }
        // Generating phase: attempt 0 forgets submitForm (toast only), triggering host retry; attempt 1 fixes it
        const badSource = `export default function Page(){return (
          <Page pfId="root" title="采购订单">
            <Form pfId="form-order" table="t_order_main">
              <Input pfId="in-no" name="order_no" label="订单编号" />
              <Input pfId="in-sup" name="supplier_name" label="供应商" />
            </Form>
            <Button pfId="btn-submit" onClick={() => toast("仅提示未保存")}>提交订单</Button>
          </Page>
        )}`;
        const goodSource = `export default function Page(){return (
          <Page pfId="root" title="采购订单">
            <Form pfId="form-order" table="t_order_main">
              <Input pfId="in-no" name="order_no" label="订单编号" />
              <Input pfId="in-sup" name="supplier_name" label="供应商" />
            </Form>
            <Button pfId="btn-submit" onClick={() => submitForm("form-order")}>提交订单</Button>
          </Page>
        )}`;
        const isFirstGenAttempt = currentAttempt === 1;
        return {
          text: isFirstGenAttempt ? '已提交初版页面' : '已补齐表单提交绑定',
          operations: [
            {
              tool: 'protoflow_apply_tsx_patch',
              args: { pageId: 'page-orders', source: isFirstGenAttempt ? badSource : goodSource },
            },
          ],
          sessionId: 'sess-wf-1',
          runId: `run-gen-${currentAttempt}`,
          modelId: 'mock-pro',
          skillDigest: 'digest-v1',
          metrics: {
            totalExecuteMs: isFirstGenAttempt ? 310 : 220,
            sessionSetupMs: 1.2,
            connectMs: 0.2,
            promptRefreshMs: 0,
            acpSessionRpcMs: 0,
            contextBridgeSetupMs: 10,
            sessionReused: true,
            sessionReloaded: false,
            sessionCreated: false,
            reloadReason: null,
            firstOutputMs: isFirstGenAttempt ? 42 : 30,
            firstTextMs: isFirstGenAttempt ? 90 : 75,
            acpTurnMs: isFirstGenAttempt ? 280 : 195,
            unattributedAcpMs: isFirstGenAttempt ? 262 : 181,
            userWaitMs: 0,
            promptVerifyMs: 9,
            toolExecMs: isFirstGenAttempt ? 18 : 14,
            toolCallCount: isFirstGenAttempt ? 3 : 2,
            failedToolCallCount: isFirstGenAttempt ? 1 : 0,
            nativeToolExecMs: 0,
            nativeToolCallCount: 0,
            failedNativeToolCallCount: 0,
            nativeToolBreakdown: {},
            acpToolCallCount: isFirstGenAttempt ? 3 : 2,
            toolBreakdown: {
              protoflow_get_project_brief: { count: 1, failedCount: 0, totalMs: 4, argBytes: 24, resultBytes: 600 },
              protoflow_apply_tsx_patch: {
                count: isFirstGenAttempt ? 2 : 1,
                failedCount: isFirstGenAttempt ? 1 : 0,
                totalMs: isFirstGenAttempt ? 14 : 10,
                argBytes: 420,
                resultBytes: 180,
              },
            },
            promptBytes: Buffer.byteLength(input.prompt, 'utf8'),
            imageBytes: 0,
            snapshotBytes: Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8'),
            contextJsonBytes: Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8') + 260,
            skillBytes: 4200,
          },
        };
      },
    }),
  };

  // 1. Conversation turn metrics
  await discussProject(scope.projectId, '查看当前采购表情况');
  // Note: discussProject sets discussionPending=true when a plan exists; restore approved plan before generating
  const convMetrics = useProjectWorkflow.getState().lastTurnMetrics[key];
  assert.ok(convMetrics);
  assert.equal(convMetrics.phase, 'conversation');
  assert.equal(convMetrics.outcome, 'answer');
  assert.equal(convMetrics.sessionReused, true);
  assert.equal(convMetrics.sessionReloaded, false);
  assert.equal(convMetrics.firstOutputMs, 35);
  assert.equal(convMetrics.acpTurnMs, 95);
  assert.equal(convMetrics.unattributedAcpMs, 90.5);
  assert.equal(convMetrics.toolExecMs, 4.5);
  assert.equal(convMetrics.nativeToolExecMs, 0);
  assert.equal(convMetrics.toolCallCount, 1);
  assert.equal(convMetrics.retryCount, 0);
  assert.ok(convMetrics.promptBytes > 0);
  assert.ok(convMetrics.snapshotBytes > 0 && convMetrics.snapshotBytes < 30_000);

  const curPlan = useProtoStore.getState().projectPlan!;
  const { discussionPending: _dp, ...approvedPlan } = curPlan;
  useProtoStore.setState({ projectPlan: { ...approvedPlan, approved: true } });

  // 2. Generating turn + batch metrics (with 1 host acceptance retry)
  await generateProject(scope.projectId);
  const genMetrics = useProjectWorkflow.getState().lastTurnMetrics[key];
  assert.ok(genMetrics);
  assert.equal(genMetrics.phase, 'generating');
  assert.equal(genMetrics.targetPageId, 'page-orders');
  assert.equal(genMetrics.outcome, 'applied');
  assert.equal(genMetrics.retryCount, 1);
  assert.ok(genMetrics.retryMs >= 0);
  assert.equal(genMetrics.acpTurnMs, 475);
  assert.equal(genMetrics.unattributedAcpMs, 443);
  assert.equal(genMetrics.toolCallCount, 5);
  assert.equal(genMetrics.failedToolCallCount, 1);
  assert.equal(genMetrics.toolExecMs, 32);
  assert.equal(genMetrics.promptVerifyMs, 18);
  assert.ok(genMetrics.hostValidationMs >= 0);
  assert.equal(genMetrics.validationMs, Number((genMetrics.promptVerifyMs + genMetrics.hostValidationMs).toFixed(2)));
  assert.equal(genMetrics.toolBreakdown.protoflow_apply_tsx_patch.count, 3);
  assert.equal(genMetrics.toolBreakdown.protoflow_apply_tsx_patch.failedCount, 1);
  assert.ok(genMetrics.applyChangesMs >= 0);
  assert.ok(genMetrics.saveFlushMs >= 0);
  assert.ok(genMetrics.promptBytes > genMetrics.initialPromptBytes, 'retry should add second prompt bytes');

  const batchMetrics = useProjectWorkflow.getState().lastBatchMetrics[scope.projectId];
  assert.ok(batchMetrics);
  assert.equal(batchMetrics.plannedPageCount, 1);
  assert.equal(batchMetrics.completedPageCount, 1);
  assert.equal(batchMetrics.acpTurnMs, 475);
  assert.equal(batchMetrics.unattributedAcpMs, 443);
  assert.equal(batchMetrics.toolExecMs, 32);
  assert.equal(batchMetrics.retryCount, 1);
  assert.equal(batchMetrics.toolCallCount, 5);
  assert.equal(batchMetrics.failedToolCallCount, 1);
  assert.ok(batchMetrics.postGenerationValidationMs >= 0);
  assert.equal(useProjectWorkflow.getState().turnMetricsHistory[key]?.length, 2);
});

test('Step 1 Review Fix 1: metrics file cleanup/read failure never wedges running state or suppresses run-end', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-metrics-fault-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const events: any[] = [];
  const runtime = new HermesRuntime({
    dataDir: path.join(tmpDir, 'data'),
    emit: (e: any) => events.push(e),
    validateDecodedImage: () => ({ width: 1, height: 1 }),
    deleteHistorySession: async () => {},
  });

  const mockClient = new EventEmitter() as any;
  mockClient.closed = false;
  mockClient.close = () => { mockClient.closed = true; };
  mockClient.notify = () => {};
  let activeSessionCwd = '';
  let shouldFailPrompt = false;

  mockClient.request = async (method: string, params: any) => {
    if (method === 'session/new' || method === 'session/load') {
      activeSessionCwd = params.cwd;
      const binding = params.mcpServers?.[0]?.env?.find((x: any) => x.name === 'PROTOFLOW_TOOL_BINDING')?.value;
      if (binding) {
        atomicWrite(path.join(params.cwd, 'tool-registration.json'), {
          binding,
          tools: mcpTools.map((tool: any) => tool.name),
        });
      }
      return {
        sessionId: params.sessionId ?? 'sess-fault-1',
        models: { currentModelId: 'mock-fast', availableModels: [{ modelId: 'mock-fast', name: 'Mock Fast' }] },
      };
    }
    if (method === 'session/prompt') {
      if (shouldFailPrompt) {
        throw new Error('模拟 ACP 连接超时');
      }
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: { alex_run_id: params._meta?.alex_run_id, admission_id: 'aid-fault-1' },
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '清理故障注入下正常完成' } },
        },
      });
      return { stopReason: 'end_turn' };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  };

  const fakeHome = path.join(tmpDir, 'hermes-home');
  const fakeInstall = path.join(tmpDir, 'hermes-install');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeInstall, { recursive: true });
  runtime.settings = { home: fakeHome, binary: '/bin/echo' };
  runtime.client = mockClient;
  mockClient.on('notification', (frame: any) => runtime.onNotification(frame));
  runtime.info = {
    detected: true,
    connected: true,
    home: fakeHome,
    binary: '/bin/echo',
    installDir: fakeInstall,
    version: '0.9.0',
    capabilities: { loadSession: true },
  };
  runtime.contextBridge = async () => ({ python: process.execPath, installDir: fakeInstall, home: fakeHome });
  runtime.watchContext = async () => () => {};
  runtime.nativeContext = async (req: any) => {
    if (req.action === 'refresh_prompt') {
      return { sessionId: req.sessionId, requestedEpoch: 1 };
    }
    if (req.action === 'verify_prompt') {
      const content = fs.readFileSync(path.join(activeSessionCwd, 'AGENTS.md'));
      const digest = crypto.createHash('sha256').update(content).digest('hex');
      return { sessionId: req.sessionId, verified: true, appliedSkillDigest: digest, expectedSkillDigest: digest, promptControlEpoch: 0 };
    }
    return { sessionId: req.sessionId, usage: { available: true, used: 10, size: 128000, compressions: 0 } };
  };

  const scope = setupProjectFixture('speed-fault-isolation');
  await runtime.sync({ ...scope, skillMarkdown: buildProtoFlowHermesSkillMarkdown([], [], [], 'project', 'hybrid') });

  // Inject EACCES on fs.rmSync targeting tool-metrics.jsonl (covers both pre-run cleanup AND finally cleanup!)
  const origRmSync = fs.rmSync;
  let injectedRmFailures = 0;
  (fs as any).rmSync = (targetPath: fs.PathLike, options?: fs.RmOptions) => {
    if (String(targetPath).endsWith('tool-metrics.jsonl')) {
      injectedRmFailures += 1;
      const err: NodeJS.ErrnoException = new Error('EACCES: permission denied, unlink tool-metrics.jsonl');
      err.code = 'EACCES';
      throw err;
    }
    return origRmSync(targetPath, options);
  };
  t.after(() => { (fs as any).rmSync = origRmSync; });

  // 1. Normal completion under pre-run & post-run cleanup failure
  const res1 = await runtime.execute({
    ...scope,
    workflowPhase: 'conversation',
    prompt: '第一轮请求（注入清理失败）',
    snapshot: projectContext(),
  });
  assert.equal(res1.text, '清理故障注入下正常完成');
  assert.ok(injectedRmFailures >= 2, `expected both pre-run and post-run rmSync failures, got ${injectedRmFailures}`);
  const liveSession = runtime.sessions.get(conversationKey(scope));
  assert.equal(liveSession.running, false, 'session.running MUST be released after cleanup failure');
  assert.equal(events.filter((e) => e.type === 'run-end' && e.runId === res1.runId).length, 1, 'run-end MUST be emitted');

  // 2. Prompt failure under cleanup failure also releases running state and records failed telemetry
  shouldFailPrompt = true;
  await assert.rejects(
    () => runtime.execute({
      ...scope,
      workflowPhase: 'conversation',
      prompt: '第二轮异常请求（同时注入清理失败）',
      snapshot: projectContext(),
    }),
    /模拟 ACP 连接超时/,
  );
  assert.equal(liveSession.running, false, 'session.running MUST be released even when prompt and cleanup both fail');
  assert.equal(events.filter((e) => e.type === 'run-end').length, 2, 'run-end MUST be emitted on error turn too');

  // 3. Subsequent request MUST succeed without "该项目已有 AI 任务正在运行"
  shouldFailPrompt = false;
  const res3 = await runtime.execute({
    ...scope,
    workflowPhase: 'conversation',
    prompt: '第三轮恢复请求',
    snapshot: projectContext(),
  });
  assert.equal(res3.text, '清理故障注入下正常完成');
  assert.equal(liveSession.running, false);

  // Verify conversation workspace telemetry-history.jsonl persisted all 3 turns (including ok=false)
  const historyLines = fs.readFileSync(path.join(liveSession.dir, 'telemetry-history.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(historyLines.length, 3);
  assert.equal(historyLines[0].ok, true);
  assert.equal(historyLines[1].ok, false);
  assert.match(historyLines[1].error, /模拟 ACP 连接超时/);
  assert.equal(historyLines[2].ok, true);
});

test('Step 1 Review Fix 2: batch generation records cold-start preflight setup timing and preserves sessionCreated attribution', async () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const scope = setupProjectFixture('speed-batch-cold-start');
  const allTools = mcpTools.map((tool: { name: string }) => tool.name);

  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  useProtoStore.setState({
    dbTables: [sampleTable],
    projectPlan: {
      summary: '双页面冷启动批次计时验证',
      folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
      pages: [
        {
          pageId: 'page-orders',
          title: '采购订单',
          folderId: 'folder-proc',
          requirements: '展示采购订单列表',
          dependencies: [],
          acceptanceCases: [],
        },
        {
          pageId: 'page-suppliers',
          title: '供应商名录',
          folderId: 'folder-proc',
          requirements: '展示供应商列表',
          dependencies: [],
          acceptanceCases: [],
        },
      ],
      approved: true,
      generatedPageIds: [],
    },
  });

  let sessionCalls = 0;
  (window as any).protoflowDesktop = {
    hermes: wireMockHermes({
      onEvent: () => () => {},
      session: async (reqScope: any) => {
        sessionCalls += 1;
        if (sessionCalls === 1) {
          // Reproduce user's supplement experiment: cold initial connect sleeps ~160ms
          await sleep(160);
          return {
            ...reqScope,
            sessionId: 'sess-cold-batch-1',
            running: false,
            projectTools: allTools,
            models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
            lastSetup: {
              durationMs: 160,
              connectMs: 110,
              promptRefreshMs: 0,
              acpSessionRpcMs: 50,
              reused: false,
              reloaded: false,
              created: true,
              reloadReason: 'new_session',
            },
          };
        }
        return {
          ...reqScope,
          sessionId: 'sess-cold-batch-1',
          running: false,
          projectTools: allTools,
          models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
          lastSetup: {
            durationMs: 0.05,
            connectMs: 0.05,
            promptRefreshMs: 0,
            acpSessionRpcMs: 0,
            reused: true,
            reloaded: false,
            created: false,
            reloadReason: null,
          },
        };
      },
      sync: async () => ({ synced: true, skillDigest: 'digest-batch-1' }),
      cancel: async () => {},
      execute: async (input: any) => ({
        text: `已生成 ${input.targetPageId}`,
        operations: [
          {
            tool: 'protoflow_apply_tsx_patch',
            args: {
              pageId: input.targetPageId,
              source: `export default function Page(){return <Page pfId="root" title="${input.targetPageId}"><Card pfId="c1" title="内容"/></Page>}`,
            },
          },
        ],
        sessionId: 'sess-cold-batch-1',
        runId: `run-${input.targetPageId}`,
        modelId: 'mock-pro',
        skillDigest: 'digest-batch-1',
        metrics: {
          totalExecuteMs: 15,
          sessionSetupMs: 0.06,
          connectMs: 0.02,
          promptRefreshMs: 0,
          acpSessionRpcMs: 0,
          contextBridgeSetupMs: 1,
          sessionReused: input.targetPageId !== 'page-orders',
          sessionReloaded: false,
          sessionCreated: input.targetPageId === 'page-orders',
          reloadReason: input.targetPageId === 'page-orders' ? 'new_session' : null,
          firstOutputMs: 5,
          firstTextMs: 8,
          acpTurnMs: 12,
          unattributedAcpMs: 9,
          userWaitMs: 0,
          promptVerifyMs: 1,
          toolExecMs: 3,
          toolCallCount: 1,
          failedToolCallCount: 0,
          nativeToolExecMs: 0,
          nativeToolCallCount: 0,
          failedNativeToolCallCount: 0,
          nativeToolBreakdown: {},
          acpToolCallCount: 1,
          toolBreakdown: {},
          promptBytes: Buffer.byteLength(input.prompt, 'utf8'),
          imageBytes: 0,
          snapshotBytes: Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8'),
          contextJsonBytes: Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8') + 200,
          skillBytes: 4000,
        },
      }),
    }),
  };

  await generateProject(scope.projectId);
  const batch = useProjectWorkflow.getState().lastBatchMetrics[scope.projectId];
  assert.ok(batch);
  assert.equal(batch.completedPageCount, 2);
  assert.ok(batch.preGenerationSetupMs >= 145, `expected preGenerationSetupMs >= 145ms, got ${batch.preGenerationSetupMs}`);
  assert.ok(batch.sessionSetupMs >= 145, `expected batch sessionSetupMs >= 145ms, got ${batch.sessionSetupMs}`);
  assert.ok(batch.sessionSetupMs <= batch.totalBatchMs, `sessionSetupMs (${batch.sessionSetupMs}) must not exceed totalBatchMs (${batch.totalBatchMs})`);
  assert.equal(batch.sessionCreated, true, 'cold batch MUST report sessionCreated=true');
  assert.equal(batch.sessionReused, false, 'cold batch MUST NOT report sessionReused=true');

  // Page 1 must inherit cold-start attribution (not falsely marked as reused), without double-counting sessionSetupMs
  const [page1, page2] = batch.pageMetrics;
  assert.ok(page1.batchPreflightMs >= 145);
  assert.ok(page1.sessionSetupMs < 50, `page1 exclusive sessionSetupMs (${page1.sessionSetupMs}) must not double-count batchPreflightMs`);
  assert.equal(page1.sessionCreated, true, 'page1 must preserve cold-start sessionCreated=true');
  assert.equal(page1.sessionReused, false, 'page1 must NOT falsely claim sessionReused=true after cold batch preflight');
  assert.ok(page1.sessionEvents.some((e) => e.stage === 'batch_preflight' && e.created));

  // Page 2 genuinely reuses the warm session
  assert.equal(page2.batchPreflightMs, 0);
  assert.equal(page2.sessionCreated, false);
  assert.equal(page2.sessionReused, true);
});

test('Step 1 Review Fix 3: acpTurnMs separates unattributedAcpMs/toolExecMs/nativeToolExecMs/userWaitMs, and saveFlushMs separates pure disk flush from applyChangesMs', async (t) => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Part A: HermesRuntime disambiguates acpTurnMs (inclusive) vs unattributedAcpMs + toolExecMs + nativeToolExecMs + userWaitMs (exclusive)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-stage-split-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const runtime = new HermesRuntime({
    dataDir: path.join(tmpDir, 'data'),
    emit: (e: any) => {
      if (e.type === 'question') {
        setTimeout(() => {
          runtime.respondQuestion({ id: e.id, answer: '确认继续' });
        }, 35);
      }
    },
    validateDecodedImage: () => ({ width: 1, height: 1 }),
    deleteHistorySession: async () => {},
  });

  const mockClient = new EventEmitter() as any;
  mockClient.closed = false;
  mockClient.close = () => { mockClient.closed = true; };
  mockClient.notify = () => {};
  let pendingReplyResolve: ((val: any) => void) | null = null;
  mockClient.reply = (_id: any, payload: any) => {
    pendingReplyResolve?.(payload);
    pendingReplyResolve = null;
  };
  let activeSessionCwd = '';

  mockClient.request = async (method: string, params: any) => {
    if (method === 'session/new' || method === 'session/load') {
      activeSessionCwd = params.cwd;
      const binding = params.mcpServers?.[0]?.env?.find((x: any) => x.name === 'PROTOFLOW_TOOL_BINDING')?.value;
      if (binding) {
        atomicWrite(path.join(params.cwd, 'tool-registration.json'), {
          binding,
          tools: mcpTools.map((tool: any) => tool.name),
        });
      }
      return {
        sessionId: params.sessionId ?? 'sess-split-1',
        models: { currentModelId: 'mock-fast', availableModels: [{ modelId: 'mock-fast', name: 'Mock Fast' }] },
      };
    }
    if (method === 'session/prompt') {
      // 1. Model thinks ~45ms
      await sleep(45);
      // 2. Simulate MCP tool execution recording 30ms into tool-metrics.jsonl during session/prompt
      const ctx = JSON.parse(fs.readFileSync(path.join(activeSessionCwd, 'context.json'), 'utf8'));
      fs.appendFileSync(
        ctx.metricsFile,
        JSON.stringify({
          runId: ctx.runId,
          tool: 'protoflow_get_project_brief',
          ok: true,
          durationMs: 30,
          argBytes: 2,
          resultBytes: 256,
        }) + '\n',
      );
      await sleep(30);
      // 3. Simulate user elicitation waiting ~35ms inside session/prompt
      const splitMeta = { alex_control_kind: 'turn', alex_run_id: params._meta?.alex_run_id, admission_id: 'aid-split-1' };
      await new Promise((resolve) => {
        pendingReplyResolve = resolve;
        runtime.onRequest({
          id: 'q-1',
          method: 'elicitation/create',
          params: {
            sessionId: params.sessionId,
            _meta: splitMeta,
            mode: 'form',
            message: '是否继续？',
            requestedSchema: {
              type: 'object',
              properties: { answer: { type: 'string', enum: ['确认继续'] } },
            },
          },
        });
      });
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: splitMeta,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '拆分计时验证完成' } },
        },
      });
      return { stopReason: 'end_turn' };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  };

  const fakeHome = path.join(tmpDir, 'hermes-home');
  const fakeInstall = path.join(tmpDir, 'hermes-install');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeInstall, { recursive: true });
  runtime.settings = { home: fakeHome, binary: '/bin/echo' };
  runtime.client = mockClient;
  mockClient.on('notification', (frame: any) => runtime.onNotification(frame));
  runtime.info = {
    detected: true,
    connected: true,
    home: fakeHome,
    binary: '/bin/echo',
    installDir: fakeInstall,
    version: '0.9.0',
    capabilities: { loadSession: true },
  };
  runtime.contextBridge = async () => ({ python: process.execPath, installDir: fakeInstall, home: fakeHome });
  runtime.watchContext = async () => () => {};
  runtime.nativeContext = async (req: any) => {
    if (req.action === 'refresh_prompt') {
      return { sessionId: req.sessionId, requestedEpoch: 1 };
    }
    if (req.action === 'verify_prompt') {
      const content = fs.readFileSync(path.join(activeSessionCwd, 'AGENTS.md'));
      const digest = crypto.createHash('sha256').update(content).digest('hex');
      return { sessionId: req.sessionId, verified: true, appliedSkillDigest: digest, expectedSkillDigest: digest, promptControlEpoch: 0 };
    }
    return { sessionId: req.sessionId, usage: { available: true, used: 10, size: 128000, compressions: 0 } };
  };

  const scope = setupProjectFixture('speed-stage-split');
  // Also Verify session() preflight before execute() preserves sessionCreated via unconsumedSessionSetup!
  const preSession = await runtime.session(scope);
  assert.equal(preSession.lastSetup?.created, true);
  await runtime.sync({ ...scope, skillMarkdown: buildProtoFlowHermesSkillMarkdown([], [], [], 'project', 'hybrid') });

  const execRes = await runtime.execute({
    ...scope,
    workflowPhase: 'conversation',
    prompt: '验证包含关系与子阶段拆分',
    snapshot: projectContext(),
  });
  const m = execRes.metrics;
  assert.ok(m);
  assert.equal(m.sessionCreated, true, 'runtime.execute must preserve sessionCreated from prior session() call');
  assert.equal(m.toolExecMs, 30);
  assert.equal(m.nativeToolExecMs, 0);
  assert.ok(m.userWaitMs >= 25, `expected userWaitMs >= 25ms, got ${m.userWaitMs}`);
  assert.ok(m.acpTurnMs >= 95, `expected acpTurnMs >= 95ms, got ${m.acpTurnMs}`);
  assert.equal(
    m.unattributedAcpMs,
    Number(Math.max(0, m.acpTurnMs - m.toolExecMs - m.nativeToolExecMs - m.userWaitMs).toFixed(2)),
    'unattributedAcpMs must exclude toolExecMs, nativeToolExecMs, and userWaitMs from acpTurnMs',
  );

  // Part B: projectWorkflow separates applyChangesMs (in-memory state apply) from saveFlushMs (pure flushProjectChanges)
  const allTools = mcpTools.map((tool: { name: string }) => tool.name);
  Object.assign(window, {
    addEventListener: () => {},
    removeEventListener: () => {},
    protoflowDesktop: {
      isElectron: true,
      saveCurrentProject: async () => {
        await sleep(80);
        return { saved: true };
      },
      hermes: wireMockHermes({
        onEvent: () => () => {},
        session: async (reqScope: any) => ({
          ...reqScope,
          sessionId: 'sess-flush-1',
          running: false,
          projectTools: allTools,
          models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
        }),
        sync: async () => ({ synced: true, skillDigest: 'digest-flush' }),
        cancel: async () => {},
        execute: async () => ({
          text: '已生成页面',
          operations: [
            {
              tool: 'protoflow_apply_tsx_patch',
              args: {
                pageId: 'page-orders',
                source: 'export default function Page(){return <Page pfId="root" title="采购订单"><Card pfId="c1" title="订单"/></Page>}',
              },
            },
          ],
          sessionId: 'sess-flush-1',
          runId: 'run-flush-1',
          modelId: 'mock-pro',
          skillDigest: 'digest-flush',
          metrics: {
            totalExecuteMs: 20,
            sessionSetupMs: 0.5,
            connectMs: 0.1,
            promptRefreshMs: 0,
            acpSessionRpcMs: 0,
            contextBridgeSetupMs: 1,
            sessionReused: true,
            sessionReloaded: false,
            sessionCreated: false,
            reloadReason: null,
            firstOutputMs: 4,
            firstTextMs: 7,
            acpTurnMs: 15,
            unattributedAcpMs: 12,
            userWaitMs: 0,
            promptVerifyMs: 1,
            toolExecMs: 3,
            toolCallCount: 1,
            failedToolCallCount: 0,
            nativeToolExecMs: 0,
            nativeToolCallCount: 0,
            failedNativeToolCallCount: 0,
            nativeToolBreakdown: {},
            acpToolCallCount: 1,
            toolBreakdown: {},
            promptBytes: 120,
            imageBytes: 0,
            snapshotBytes: 4000,
            contextJsonBytes: 4200,
            skillBytes: 4000,
          },
        }),
      }),
    },
  });
  const stopPersistence = startProjectPersistence(5000);
  t.after(() => stopPersistence());

  const scopeB = setupProjectFixture('speed-flush-split');
  const keyB = conversationKey(scopeB);
  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  useProtoStore.setState({
    dbTables: [sampleTable],
    projectPlan: {
      summary: '拆分落盘与状态写入验证',
      folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
      pages: [
        {
          pageId: 'page-orders',
          title: '采购订单',
          folderId: 'folder-proc',
          requirements: '展示采购订单',
          dependencies: [],
          acceptanceCases: [],
        },
      ],
      approved: true,
      generatedPageIds: [],
    },
  });

  await generateProject(scopeB.projectId);
  const turnB = useProjectWorkflow.getState().lastTurnMetrics[keyB];
  const batchB = useProjectWorkflow.getState().lastBatchMetrics[scopeB.projectId];
  assert.ok(turnB && batchB);
  assert.ok(turnB.applyChangesMs < 50, `expected applyChangesMs < 50ms (pure CPU apply), got ${turnB.applyChangesMs}`);
  assert.ok(turnB.saveFlushMs >= 70, `expected saveFlushMs >= 70ms (pure 80ms disk flush), got ${turnB.saveFlushMs}`);
  assert.ok(batchB.preGenerationApplyMs < 50);
  assert.ok(batchB.preGenerationFlushMs >= 70);
  assert.ok(batchB.saveFlushMs >= 140, `expected batch saveFlushMs >= 140ms (pre-flush + page flush), got ${batchB.saveFlushMs}`);
});

test('Step 1 Review Fix 4: bounded persistence & export retain normal and error turns across restarts and clean up on chat deletion', async () => {
  const scope = setupProjectFixture('speed-telemetry-persistence');
  const key = conversationKey(scope);
  const allTools = mcpTools.map((tool: { name: string }) => tool.name);
  let shouldThrow = false;

  (window as any).protoflowDesktop = {
    hermes: wireMockHermes({
      onEvent: () => () => {},
      session: async (reqScope: any) => ({
        ...reqScope,
        sessionId: 'sess-persist-1',
        running: false,
        projectTools: allTools,
        models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
      }),
      sync: async () => ({ synced: true, skillDigest: 'digest-p1' }),
      cancel: async () => {},
      execute: async () => {
        if (shouldThrow) throw new Error('模拟上游推理中断');
        return {
          text: '正常返回结果',
          operations: [],
          sessionId: 'sess-persist-1',
          runId: 'run-p1',
          modelId: 'mock-pro',
          skillDigest: 'digest-p1',
        };
      },
    }),
  };

  // 1. Run 1 normal turn + 1 error turn
  await discussProject(scope.projectId, '第一轮正常咨询');
  shouldThrow = true;
  await assert.rejects(() => discussProject(scope.projectId, '第二轮失败请求'), /模拟上游推理中断/);

  // 2. Simulate app restart by wiping Zustand in-memory workflow telemetry
  useProjectWorkflow.setState({
    lastTurnMetrics: {},
    turnMetricsHistory: {},
    lastBatchMetrics: {},
    batchMetricsHistory: {},
  });

  const persistedAfterRestart = readPersistedTurnMetrics(scope);
  assert.equal(persistedAfterRestart.length, 2, 'both normal and error turns must survive restart');
  assert.equal(persistedAfterRestart[0].outcome, 'answer');
  assert.equal(persistedAfterRestart[1].outcome, 'error');
  assert.match(persistedAfterRestart[1].errorMessage ?? '', /模拟上游推理中断/);

  const report = exportProjectAiMetricsReport(scope.projectId, scope);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.timingSemantics, STAGE_TIMING_SEMANTICS);
  assert.equal(report.timingSemantics.retentionLimits.turnHistoryPerConversation, MAX_PERSISTED_TURN_METRICS);
  assert.equal(report.turnHistory.length, 2);
  assert.equal(report.latestTurn?.outcome, 'error');
  assert.deepEqual(readPersistedBatchMetrics(scope.projectId), []);

  // 3. Verify ring buffer cap (55 turns -> retains latest 50)
  shouldThrow = false;
  for (let i = 0; i < 53; i++) {
    await discussProject(scope.projectId, `压力轮次 #${i + 1}`);
  }
  const capped = readPersistedTurnMetrics(scope);
  assert.equal(capped.length, MAX_PERSISTED_TURN_METRICS);

  // 4. Verify deleting a project chat cleans up its persisted turn metrics
  useAiChatStore.getState().newProjectChat(scope.projectId);
  const newIndex = useAiChatStore.getState().loadProjectIndex(scope.projectId);
  const secondChatId = newIndex.activeId;
  const secondScope = projectChatScope(scope.projectId, secondChatId);
  await discussProject(scope.projectId, '新会话中的一轮对话');
  assert.equal(readPersistedTurnMetrics(secondScope).length, 1);

  useAiChatStore.getState().forgetProjectChat(scope.projectId, secondChatId);
  assert.equal(readPersistedTurnMetrics(secondScope).length, 0, 'forgetProjectChat must remove persisted turn metrics');
});

test('Step 1 Round 2 Fix 1: Hermes native tools are timed separately in nativeToolExecMs and never misattributed to unattributedAcpMs', async (t) => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-native-tool-timing-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const runtime = new HermesRuntime({
    dataDir: path.join(tmpDir, 'data'),
    emit: (e: any) => {
      if (e.type === 'question') {
        setTimeout(() => {
          runtime.respondQuestion({ id: e.id, answer: '允许执行' });
        }, 35);
      }
    },
    validateDecodedImage: () => ({ width: 1, height: 1 }),
    deleteHistorySession: async () => {},
  });

  const mockClient = new EventEmitter() as any;
  mockClient.closed = false;
  mockClient.close = () => { mockClient.closed = true; };
  mockClient.notify = () => {};
  let pendingReplyResolve: ((val: any) => void) | null = null;
  mockClient.reply = (_id: any, payload: any) => {
    pendingReplyResolve?.(payload);
    pendingReplyResolve = null;
  };
  let activeSessionCwd = '';
  let turnScenario: 'pure_native_100ms' | 'mixed_native_mcp_wait' = 'pure_native_100ms';

  mockClient.request = async (method: string, params: any) => {
    if (method === 'session/new' || method === 'session/load') {
      activeSessionCwd = params.cwd;
      const binding = params.mcpServers?.[0]?.env?.find((x: any) => x.name === 'PROTOFLOW_TOOL_BINDING')?.value;
      if (binding) {
        atomicWrite(path.join(params.cwd, 'tool-registration.json'), {
          binding,
          tools: mcpTools.map((tool: any) => tool.name),
        });
      }
      return {
        sessionId: params.sessionId ?? 'sess-native-1',
        models: { currentModelId: 'mock-fast', availableModels: [{ modelId: 'mock-fast', name: 'Mock Fast' }] },
      };
    }
    if (method === 'session/prompt') {
      const turnMeta = { alex_control_kind: 'turn', alex_run_id: params._meta?.alex_run_id, admission_id: `aid-native-${params._meta?.alex_run_id}` };
      if (turnScenario === 'pure_native_100ms') {
        // Reproduce exact user experiment: 100ms Hermes native `terminal` tool, 0 protoflow-mcp calls
        mockClient.emit('notification', {
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            _meta: turnMeta,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tc-term-1',
              title: 'terminal: git status --short',
              status: 'in_progress',
            },
          },
        });
        await sleep(105);
        mockClient.emit('notification', {
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            _meta: turnMeta,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'tc-term-1',
              title: 'terminal: git status --short',
              status: 'completed',
            },
          },
        });
        mockClient.emit('notification', {
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            _meta: turnMeta,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '原生终端执行完毕' } },
          },
        });
        return { stopReason: 'end_turn' };
      }

      // Scenario B:
      // 1. Native `tool_search: protoflow_get_project` (args mention `protoflow_`, emitted WITHOUT tool_call_update, closed by next chunk)
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: turnMeta,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-search-1',
            title: 'tool_search: protoflow_get_project',
            status: 'in_progress',
          },
        },
      });
      await sleep(55);
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: turnMeta,
          update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '已找到工具' } },
        },
      });

      // 2. ProtoFlow MCP tool (`protoflow_get_project_brief`) — must count ONLY in toolExecMs, NEVER in nativeToolExecMs
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: turnMeta,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-mcp-1',
            title: 'mcp_protoflow_get_project_brief: {}',
            status: 'in_progress',
          },
        },
      });
      const ctx = JSON.parse(fs.readFileSync(path.join(activeSessionCwd, 'context.json'), 'utf8'));
      fs.appendFileSync(
        ctx.metricsFile,
        JSON.stringify({
          runId: ctx.runId,
          tool: 'protoflow_get_project_brief',
          ok: true,
          durationMs: 25,
          argBytes: 2,
          resultBytes: 128,
        }) + '\n',
      );
      await sleep(25);
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: turnMeta,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tc-mcp-1',
            title: 'mcp_protoflow_get_project_brief: {}',
            status: 'completed',
          },
        },
      });

      // 3. Native `clarify` overlapping with 35ms user elicitation wait — userWaitMs must NOT be double-subtracted as nativeToolExecMs
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: turnMeta,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-clarify-1',
            title: 'clarify: 请确认是否继续',
            status: 'in_progress',
          },
        },
      });
      await new Promise((resolve) => {
        pendingReplyResolve = resolve;
        runtime.onRequest({
          id: 'q-native-overlap',
          method: 'elicitation/create',
          params: {
            sessionId: params.sessionId,
            _meta: turnMeta,
            mode: 'form',
            message: '请确认是否继续',
            requestedSchema: {
              type: 'object',
              properties: { answer: { type: 'string', enum: ['允许执行'] } },
            },
          },
        });
      });
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: turnMeta,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tc-clarify-1',
            title: 'clarify: 请确认是否继续',
            status: 'failed',
          },
        },
      });
      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: turnMeta,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '混合工具回合完成' } },
        },
      });
      return { stopReason: 'end_turn' };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  };

  const fakeHome = path.join(tmpDir, 'hermes-home');
  const fakeInstall = path.join(tmpDir, 'hermes-install');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeInstall, { recursive: true });
  runtime.settings = { home: fakeHome, binary: '/bin/echo' };
  runtime.client = mockClient;
  mockClient.on('notification', (frame: any) => runtime.onNotification(frame));
  runtime.info = {
    detected: true,
    connected: true,
    home: fakeHome,
    binary: '/bin/echo',
    installDir: fakeInstall,
    version: '0.9.0',
    capabilities: { loadSession: true },
  };
  runtime.contextBridge = async () => ({ python: process.execPath, installDir: fakeInstall, home: fakeHome });
  runtime.watchContext = async () => () => {};
  runtime.nativeContext = async (req: any) => {
    if (req.action === 'refresh_prompt') return { sessionId: req.sessionId, requestedEpoch: 1 };
    if (req.action === 'verify_prompt') {
      const content = fs.readFileSync(path.join(activeSessionCwd, 'AGENTS.md'));
      const digest = crypto.createHash('sha256').update(content).digest('hex');
      return { sessionId: req.sessionId, verified: true, appliedSkillDigest: digest, expectedSkillDigest: digest, promptControlEpoch: 0 };
    }
    return { sessionId: req.sessionId, usage: { available: true, used: 10, size: 128000, compressions: 0 } };
  };

  const scope = setupProjectFixture('speed-native-tools');
  await runtime.sync({ ...scope, skillMarkdown: buildProtoFlowHermesSkillMarkdown([], [], [], 'project', 'hybrid') });

  // Assert Scenario A (exact user reproduction: 100ms native tool, toolExecMs = 0)
  const resA = await runtime.execute({
    ...scope,
    workflowPhase: 'conversation',
    prompt: '测试 100ms 原生工具耗时归因',
    snapshot: projectContext(),
  });
  const mA = resA.metrics;
  assert.equal('modelNetMs' in mA, false, 'legacy misleading modelNetMs field must not exist');
  assert.equal(mA.acpToolCallCount, 1);
  assert.equal(mA.toolExecMs, 0);
  assert.equal(mA.nativeToolCallCount, 1);
  assert.equal(mA.failedNativeToolCallCount, 0);
  assert.ok(mA.nativeToolExecMs >= 95, `expected nativeToolExecMs >= 95ms, got ${mA.nativeToolExecMs}`);
  assert.ok(mA.unattributedAcpMs < 25, `100ms native tool must NOT be attributed to unattributedAcpMs (got ${mA.unattributedAcpMs})`);
  assert.equal(mA.nativeToolBreakdown.terminal?.count, 1);

  // Assert Scenario B (tool_search with protoflow_ arg + MCP tool + clarify overlapping userWaitMs)
  turnScenario = 'mixed_native_mcp_wait';
  const resB = await runtime.execute({
    ...scope,
    workflowPhase: 'conversation',
    prompt: '测试混合原生工具、MCP 工具与用户等待互斥归因',
    snapshot: projectContext(),
  });
  const mB = resB.metrics;
  assert.equal(mB.acpToolCallCount, 3);
  assert.equal(mB.toolExecMs, 25);
  assert.equal(mB.nativeToolCallCount, 2, 'tool_search and clarify are native; mcp_protoflow_* is excluded');
  assert.equal(mB.failedNativeToolCallCount, 1);
  assert.equal(mB.nativeToolBreakdown.tool_search?.count, 1, 'tool_search: protoflow_get_project must be classified as native tool_search');
  assert.equal('mcp_protoflow_get_project_brief' in mB.nativeToolBreakdown, false);
  assert.ok(mB.nativeToolExecMs >= 45 && mB.nativeToolExecMs < 85, `nativeToolExecMs (${mB.nativeToolExecMs}) must include ~55ms tool_search and exclude 35ms userWaitMs`);
  assert.ok(mB.userWaitMs >= 25, `expected userWaitMs >= 25ms, got ${mB.userWaitMs}`);
  assert.ok(mB.unattributedAcpMs < 30, `expected unattributedAcpMs < 30ms, got ${mB.unattributedAcpMs}`);
});

test('Step 1 Round 2 Fix 2: full ring buffer retains newest in-memory turn/batch records when localStorage.setItem fails and self-heals later', async (t) => {
  const scope = setupProjectFixture('speed-ringbuffer-write-fault');
  const allTools = mcpTools.map((tool: { name: string }) => tool.name);

  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  const resetApprovedSinglePagePlan = () => {
    useProtoStore.setState({
      dbTables: [sampleTable],
      projectPlan: {
        summary: '环形缓冲满额写失败验证',
        folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
        pages: [
          {
            pageId: 'page-orders',
            title: '采购订单',
            folderId: 'folder-proc',
            requirements: '展示采购订单',
            dependencies: [],
            acceptanceCases: [],
          },
        ],
        approved: true,
        generatedPageIds: [],
      },
    });
    usePageStore.setState({ designerPages: [], pageSources: {} });
  };

  let shouldFailTurn = false;
  (window as any).protoflowDesktop = {
    hermes: wireMockHermes({
      onEvent: () => () => {},
      session: async (reqScope: any) => ({
        ...reqScope,
        sessionId: 'sess-rb-1',
        running: false,
        projectTools: allTools,
        models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
      }),
      sync: async () => ({ synced: true, skillDigest: 'digest-rb' }),
      cancel: async () => {},
      execute: async (input: any) => {
        if (shouldFailTurn) throw new Error('第51轮上游异常');
        if (input.workflowPhase === 'generating') {
          return {
            text: '已生成页面',
            operations: [
              {
                tool: 'protoflow_apply_tsx_patch',
                args: {
                  pageId: input.targetPageId,
                  source: `export default function Page(){return <Page pfId="root" title="采购订单"><Card pfId="c1" title="批次"/></Page>}`,
                },
              },
            ],
            sessionId: 'sess-rb-1',
            runId: 'run-rb-gen',
            modelId: 'mock-pro',
            skillDigest: 'digest-rb',
          };
        }
        return {
          text: '正常返回',
          operations: [],
          sessionId: 'sess-rb-1',
          runId: 'run-rb-conv',
          modelId: 'mock-pro',
          skillDigest: 'digest-rb',
        };
      },
    }),
  };

  // 1. Fill turn history ring buffer to exact cap (50 turns)
  for (let i = 1; i <= MAX_PERSISTED_TURN_METRICS; i++) {
    await discussProject(scope.projectId, `预热轮次 #${i}`);
  }
  const initialFiftyIds = exportProjectAiMetricsReport(scope.projectId, scope).turnHistory.map((m) => m.metricId);
  assert.equal(initialFiftyIds.length, MAX_PERSISTED_TURN_METRICS);

  // 2. Inject localStorage.setItem QuotaExceededError on metrics keys, then run failing Turn 51
  const origSetItem = window.localStorage.setItem.bind(window.localStorage);
  let blockMetricsWrite = true;
  window.localStorage.setItem = (storageKey: string, value: string) => {
    if (blockMetricsWrite && (storageKey.startsWith('protoflow_ai_turn_metrics_v1:') || storageKey.startsWith('protoflow_ai_batch_metrics_v1:'))) {
      throw new Error('QuotaExceededError: simulated disk full');
    }
    return origSetItem(storageKey, value);
  };
  t.after(() => { window.localStorage.setItem = origSetItem; });

  shouldFailTurn = true;
  await assert.rejects(() => discussProject(scope.projectId, '第51轮失败且落盘异常'), /第51轮上游异常/);

  // Exported report MUST keep Turn 51 in turnHistory (matching latestTurn), NOT overwrite with stale 50 disk items!
  const report51 = exportProjectAiMetricsReport(scope.projectId, scope);
  assert.equal(report51.latestTurn?.outcome, 'error');
  assert.match(report51.latestTurn?.errorMessage ?? '', /第51轮上游异常/);
  assert.equal(report51.turnHistory.length, MAX_PERSISTED_TURN_METRICS);
  assert.equal(
    report51.turnHistory.at(-1)?.metricId,
    report51.latestTurn?.metricId,
    'turnHistory must contain latest failed Turn 51 even when localStorage.setItem failed at capacity 50',
  );
  assert.equal(report51.turnHistory.some((m) => m.metricId === initialFiftyIds[0]), false, 'oldest Turn 1 must be evicted');

  // 3. Subsequent Turn 52 while disk is STILL failing must continue from [2..51], NOT revert to stale [1..50]
  shouldFailTurn = false;
  await discussProject(scope.projectId, '第52轮继续写入失败');
  const report52 = exportProjectAiMetricsReport(scope.projectId, scope);
  assert.equal(report52.turnHistory.length, MAX_PERSISTED_TURN_METRICS);
  assert.equal(report52.turnHistory.at(-2)?.metricId, report51.latestTurn?.metricId, 'Turn 51 must survive subsequent Turn 52');
  assert.equal(report52.turnHistory.at(-1)?.metricId, report52.latestTurn?.metricId);

  // 4. Restore localStorage.setItem -> Turn 53 self-heals persisted history on disk (including Turns 51 & 52)
  blockMetricsWrite = false;
  await discussProject(scope.projectId, '第53轮恢复落盘');
  const persistedAfterHeal = readPersistedTurnMetrics(scope);
  assert.equal(persistedAfterHeal.length, MAX_PERSISTED_TURN_METRICS);
  assert.ok(persistedAfterHeal.some((m) => m.metricId === report51.latestTurn?.metricId), 'disk history must self-heal Turn 51');
  assert.ok(persistedAfterHeal.some((m) => m.metricId === report52.latestTurn?.metricId), 'disk history must self-heal Turn 52');

  // 5. Same guarantee for batch ring buffer at full capacity (MAX_PERSISTED_BATCH_METRICS = 20)
  for (let i = 1; i <= MAX_PERSISTED_BATCH_METRICS; i++) {
    resetApprovedSinglePagePlan();
    await generateProject(scope.projectId);
  }
  const initialTwentyBatchIds = exportProjectAiMetricsReport(scope.projectId, scope).batchHistory.map((b) => b.metricId);
  assert.equal(initialTwentyBatchIds.length, MAX_PERSISTED_BATCH_METRICS);

  blockMetricsWrite = true;
  resetApprovedSinglePagePlan();
  await generateProject(scope.projectId);
  const batchReport21 = exportProjectAiMetricsReport(scope.projectId, scope);
  assert.equal(batchReport21.batchHistory.length, MAX_PERSISTED_BATCH_METRICS);
  assert.equal(
    batchReport21.batchHistory.at(-1)?.metricId,
    batchReport21.latestBatch?.metricId,
    'batchHistory must retain Batch 21 when localStorage.setItem fails at cap 20',
  );
  assert.equal(batchReport21.batchHistory.some((b) => b.metricId === initialTwentyBatchIds[0]), false);
});

test('Step 1 Round 2 Fix 3: deleting a project chat purges its batch metrics and falls back latestBatch while preserving other chats', async () => {
  const scopeA = setupProjectFixture('speed-chat-delete-batches');
  const keyA = conversationKey(scopeA);
  const allTools = mcpTools.map((tool: { name: string }) => tool.name);

  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  const resetPlanForNextBatch = () => {
    useProtoStore.setState({
      dbTables: [sampleTable],
      projectPlan: {
        summary: '跨会话批次清理验证',
        folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
        pages: [
          {
            pageId: 'page-orders',
            title: '采购订单',
            folderId: 'folder-proc',
            requirements: '展示采购订单',
            dependencies: [],
            acceptanceCases: [],
          },
        ],
        approved: true,
        generatedPageIds: [],
      },
    });
    usePageStore.setState({ designerPages: [], pageSources: {} });
  };

  (window as any).protoflowDesktop = {
    hermes: wireMockHermes({
      onEvent: () => () => {},
      session: async (reqScope: any) => ({
        ...reqScope,
        sessionId: `sess-${reqScope.threadId ?? 'root'}`,
        running: false,
        projectTools: allTools,
        models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
      }),
      sync: async () => ({ synced: true, skillDigest: 'digest-chat-del' }),
      cancel: async () => {},
      execute: async (input: any) => ({
        text: `已完成 ${input.targetPageId ?? '对话'}`,
        operations: input.workflowPhase === 'generating'
          ? [
              {
                tool: 'protoflow_apply_tsx_patch',
                args: {
                  pageId: input.targetPageId,
                  source: `export default function Page(){return <Page pfId="root" title="采购订单"><Card pfId="c1" title="内容"/></Page>}`,
                },
              },
            ]
          : [],
        sessionId: `sess-${input.threadId ?? 'root'}`,
        runId: 'run-chat-del',
        modelId: 'mock-pro',
        skillDigest: 'digest-chat-del',
      }),
    }),
  };

  // 1. Generate Batch A in default Chat A (id = null)
  resetPlanForNextBatch();
  await generateProject(scopeA.projectId);

  // 2. Create Chat B, run a conversation turn + Generate Batch B in Chat B
  useAiChatStore.getState().newProjectChat(scopeA.projectId);
  const chatBId = useAiChatStore.getState().loadProjectIndex(scopeA.projectId).activeId;
  assert.ok(chatBId);
  const scopeB = projectChatScope(scopeA.projectId, chatBId);
  const keyB = conversationKey(scopeB);

  await discussProject(scopeA.projectId, '会话 B 先沟通一次');
  resetPlanForNextBatch();
  await generateProject(scopeA.projectId);

  const beforeDelete = exportProjectAiMetricsReport(scopeA.projectId, scopeB);
  assert.equal(beforeDelete.batchHistory.length, 2);
  assert.equal(beforeDelete.latestBatch?.conversationKey, keyB);
  assert.equal(readPersistedBatchMetrics(scopeA.projectId).length, 2);

  // 3. Delete Chat B (matching ProjectChatHistory.tsx: forgetProjectChat + purgeConversationTelemetry)
  useAiChatStore.getState().forgetProjectChat(scopeA.projectId, chatBId);
  purgeConversationTelemetry(scopeB);

  // Verify Chat B's turn AND batch metrics (including nested pageMetrics) are completely gone, while Chat A's remain intact!
  assert.equal(readPersistedTurnMetrics(scopeB).length, 0);
  const persistedBatchesAfterB = readPersistedBatchMetrics(scopeA.projectId);
  assert.equal(persistedBatchesAfterB.length, 1, 'persisted batch history must purge Chat B and keep Chat A');
  assert.equal(persistedBatchesAfterB[0].conversationKey, keyA);
  assert.ok(persistedBatchesAfterB[0].pageMetrics.every((m) => m.conversationKey === keyA));

  const reportAfterB = exportProjectAiMetricsReport(scopeA.projectId);
  assert.equal(reportAfterB.conversationKey, keyA);
  assert.equal(reportAfterB.batchHistory.length, 1);
  assert.equal(reportAfterB.batchHistory[0].conversationKey, keyA);
  assert.equal(reportAfterB.latestBatch?.conversationKey, keyA, 'latestBatch must fall back to Chat A batch');
  assert.ok(reportAfterB.turnHistory.length >= 1, 'Chat A turn history must remain intact');

  // 4. Delete Chat A (the last chat with batch history) -> both memory and localStorage batch metrics become completely empty
  useAiChatStore.getState().forgetProjectChat(scopeA.projectId, null);
  assert.deepEqual(readPersistedBatchMetrics(scopeA.projectId), []);
  const reportAfterAll = exportProjectAiMetricsReport(scopeA.projectId);
  assert.equal(reportAfterAll.latestBatch, null);
  assert.deepEqual(reportAfterAll.batchHistory, []);
});

test('Step 2a: MCP apply_tsx_patch, edit_page_block, inspect_page, and get_project_brief return non-blocking acceptance diagnostics while keeping contract gates strict', (t) => {
  const scope = setupProjectFixture('speed-step2a-diagnostics');
  const supplierTable: DBTableSchema = {
    id: 't_supplier',
    tableName: 'supplier_master',
    cnName: '供应商主表',
    domain: '业务单据域',
    description: '已确认供应商档案',
    modeling: { entity: '供应商', grain: '每家供应商一行', reason: '供应商名录与采购订单共用' },
    columns: [
      { id: 'col-sup-id', name: 'supplier_code', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '供应商编码' },
      { id: 'col-sup-name', name: 'supplier_name', dataType: 'VARCHAR(128)', nullable: false, isPrimaryKey: false, comment: '供应商名称' },
    ],
    sharedByMenus: [
      { pageId: 'page-suppliers', menuTitle: '供应商名录', accessMode: 'CRUD 读写', fieldMappingNote: '维护供应商档案' },
    ],
  };
  const orderStatsTable: DBTableSchema = {
    ...sampleTable,
    columns: [
      ...sampleTable.columns,
      { id: 'col-amount', name: 'amount', dataType: 'DECIMAL(12,2)', nullable: false, isPrimaryKey: false, comment: '采购金额' },
    ],
  };

  usePageStore.setState({
    designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
    tableRows: {
      t_supplier: [{ id: 's1', supplier_code: 'SUP-01', supplier_name: '华星光电' }],
      t_order_main: [{ id: 'o1', order_no: 'PO-01', supplier_name: '华星光电', amount: 1200 }],
    },
  });
  usePageStore.getState().createDesignerPage(
    { pageId: 'page-suppliers', title: '供应商名录', folderId: 'folder-proc' },
    'export default function Page(){return <Page pfId="root" title="供应商名录"><Table pfId="tbl-suppliers" table="t_supplier"/></Page>}',
  );
  usePageStore.getState().createDesignerPage(
    { pageId: 'page-orders', title: '采购订单', folderId: 'folder-proc' },
    'export default function Page(){return <Page pfId="root" title="采购订单"/>}',
  );
  useProtoStore.setState({
    dbTables: [supplierTable, orderStatsTable],
    projectPlan: {
      summary: '采购中心分块生成与非阻塞验收诊断验证',
      folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
      pages: [
        {
          pageId: 'page-suppliers',
          title: '供应商名录',
          folderId: 'folder-proc',
          requirements: '展示并维护供应商档案',
          dependencies: [],
          acceptanceCases: [{ scenario: '浏览供应商列表', expected: '展示供应商记录' }],
        },
        {
          pageId: 'page-orders',
          title: '采购订单',
          folderId: 'folder-proc',
          requirements: '复用供应商档案创建采购订单并展示供应商采购金额统计图',
          dependencies: [
            {
              kind: 'reuse',
              sourcePageId: 'page-suppliers',
              sourceTableId: 't_supplier',
              requirement: '采购单关联已确认供应商表',
            },
          ],
          acceptanceCases: [
            {
              scenario: '填写表单后点击提交保存采购订单',
              expected: '订单写入采购订单主表',
              actionPfId: 'btn-submit',
              actionKind: 'submitForm',
              targetId: 'form-order',
              tableId: 't_order_main',
            },
            {
              scenario: '查看各供应商采购金额统计图',
              expected: '绑定采购订单主表展示柱状图',
              chart: { pfId: 'chart-order', tableId: 't_order_main' },
            },
          ],
        },
      ],
      approved: true,
      generatedPageIds: ['page-suppliers'],
    },
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-step2a-diag-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const contextFile = path.join(tmpDir, 'context.json');
  atomicWrite(contextFile, {
    ...scope,
    active: true,
    runId: 'run-step2a-diag',
    sessionId: 'sess-step2a-diag',
    workflowPhase: 'generating',
    targetPageId: 'page-orders',
    requireProjectBrief: true,
    snapshot: projectContext(),
    operations: [],
  });

  callTool(contextFile, 'protoflow_get_project_brief', {});

  // 1. Shell write (`protoflow_apply_tsx_patch`) succeeds mid-turn without throwing, reporting prototype readiness gap
  const shellRes = callTool(contextFile, 'protoflow_apply_tsx_patch', {
    pageId: 'page-orders',
    source: 'export default function Page(){return <Page pfId="root" title="采购订单"/>}',
  });
  assert.equal(shellRes.staged, true);
  assert.equal(shellRes.acceptanceReady, false);
  assert.ok(
    shellRes.pendingAcceptanceIssues.some((msg: string) => msg.includes('页面只有空框架')),
    `expected empty shell diagnostic, got ${JSON.stringify(shellRes.pendingAcceptanceIssues)}`,
  );

  // 2. First incremental block (`protoflow_edit_page_block`) stages form + toast-only button without failing mid-flight
  const partialRes = callTool(contextFile, 'protoflow_edit_page_block', {
    pageId: 'page-orders',
    targetPfId: 'root',
    mode: 'append_children',
    tsx: `<Card pfId="card-form" title="新建采购单">
      <Form pfId="form-order" table="t_order_main">
        <Input pfId="in-no" name="order_no" label="订单编号" />
        <Input pfId="in-sup" name="supplier_name" label="供应商" />
        <Input pfId="in-amt" name="amount" label="采购金额" />
      </Form>
      <Button pfId="btn-submit" onClick={() => toast("仅提示")}>提交订单</Button>
    </Card>`,
  });
  assert.equal(partialRes.staged, true);
  assert.equal(partialRes.acceptanceReady, false);
  assert.ok(partialRes.pendingAcceptanceIssues.some((msg: string) => msg.includes('待绑定来源表')));
  assert.ok(partialRes.pendingAcceptanceIssues.some((msg: string) => msg.includes('不能仅用提示')));
  assert.ok(partialRes.pendingAcceptanceIssues.some((msg: string) => msg.includes('统计图') || msg.includes('chart-order')));

  // 3. `protoflow_inspect_page` is read-only (never rewrites context.json) and returns identical pendingAcceptanceIssues
  const beforeInspect = fs.readFileSync(contextFile, 'utf8');
  const inspectRes = callTool(contextFile, 'protoflow_inspect_page', { pageId: 'page-orders' });
  assert.equal(fs.readFileSync(contextFile, 'utf8'), beforeInspect, 'inspect_page must remain strictly read-only');
  assert.equal(inspectRes.acceptanceReady, false);
  assert.deepEqual(inspectRes.pendingAcceptanceIssues, partialRes.pendingAcceptanceIssues);

  // 4. `protoflow_get_project_brief` exposes `stagedPageReadiness` and exact `stagedChanges`
  const briefRes = callTool(contextFile, 'protoflow_get_project_brief', {});
  assert.ok(briefRes.stagedPageReadiness);
  assert.equal(briefRes.stagedPageReadiness.acceptanceReady, false);
  assert.deepEqual(briefRes.stagedPageReadiness.pendingAcceptanceIssues, partialRes.pendingAcceptanceIssues);
  assert.ok(briefRes.stagedChanges.every((item: any) => item.pageId === 'page-orders'));

  // 5. Hard contract errors STILL fail immediately without mutating context.json
  const beforeContractErr = fs.readFileSync(contextFile, 'utf8');
  assert.throws(
    () =>
      callTool(contextFile, 'protoflow_edit_page_block', {
        pageId: 'page-orders',
        targetPfId: 'form-order',
        mode: 'append_children',
        tsx: '<Input pfId="in-bad" name="non_existent_column" label="非法字段" />',
      }),
    /契约校验失败/,
  );
  assert.equal(fs.readFileSync(contextFile, 'utf8'), beforeContractErr);

  // 6. Subsequent incremental block edits resolve button action, reuse table binding, and bound chart -> acceptanceReady: true
  callTool(contextFile, 'protoflow_edit_page_block', {
    pageId: 'page-orders',
    targetPfId: 'btn-submit',
    mode: 'replace_node',
    tsx: '<Button pfId="btn-submit" onClick={() => submitForm("form-order")}>提交订单</Button>',
  });
  const finalRes = callTool(contextFile, 'protoflow_edit_page_block', {
    pageId: 'page-orders',
    targetPfId: 'root',
    mode: 'append_children',
    tsx: `<Card pfId="card-overview" title="供应商与统计">
      <Table pfId="tbl-sup-ref" table="t_supplier" />
      <BarChart pfId="chart-order" source="table" table="t_order_main" dimension="supplier_name" metrics={[{ field: "amount", label: "采购金额" }]} />
    </Card>`,
  });
  assert.equal(finalRes.staged, true);
  assert.equal(finalRes.acceptanceReady, true, `expected acceptanceReady=true, got ${JSON.stringify(finalRes.pendingAcceptanceIssues)}`);
  assert.deepEqual(finalRes.pendingAcceptanceIssues, []);
});

test('Step 2a Review Fix: merge readiness through real MCP snapshots uses a read-only precheck and never misreports with empty or populated note catalogs', (t) => {
  const homeSource = 'export default function Page(){return <Page pfId="root" title="首页"><Button pfId="go-review" onClick={() => navigate("reviews")}>去审批</Button></Page>}';
  const mergedSource = 'export default function Page(){return <Page pfId="root" title="采购申请"><Button pfId="open" onClick={()=>openDrawer("review-drawer")}>审批</Button><Drawer pfId="drawer-node" id="review-drawer" title="审批"><Text pfId="text">审批内容</Text></Drawer></Page>}';
  const missingDrawerSource = 'export default function Page(){return <Page pfId="root" title="采购申请"><Card pfId="card-new" title="申请（未并入审批）"/></Page>}';
  const navigateOldSource = 'export default function Page(){return <Page pfId="root" title="采购申请"><Button pfId="open" onClick={()=>navigate("reviews")}>审批</Button><Drawer pfId="drawer-node" id="review-drawer" title="审批"><Text pfId="text">审批内容</Text></Drawer></Page>}';

  const runCase = (label: string, withNotes: boolean) => {
    const scope = setupProjectFixture(`speed-step2a-merge-${label}`);
    usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
    usePageStore.getState().createDesignerPage({ pageId: 'home', title: '首页', folderId: 'folder-proc' }, homeSource);
    usePageStore.getState().createDesignerPage(
      { pageId: 'requests', title: '采购申请', folderId: 'folder-proc' },
      'export default function Page(){return <Page pfId="root" title="采购申请"><Card pfId="card-old" title="申请"/></Page>}',
    );
    usePageStore.getState().createDesignerPage(
      { pageId: 'reviews', title: '审批', folderId: 'folder-proc' },
      'export default function Page(){return <Page pfId="root" title="审批"><Card pfId="card-review" title="原审批功能"/></Page>}',
    );
    useProtoStore.setState({
      projectPlan: {
        summary: '把审批收进采购申请的抽屉',
        folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
        pages: [
          { pageId: 'home', title: '首页', folderId: 'folder-proc', requirements: '入口', dependencies: [], acceptanceCases: [] },
          { pageId: 'requests', title: '采购申请', folderId: 'folder-proc', requirements: '在采购申请的审批抽屉中处理原审批功能', dependencies: [], acceptanceCases: [] },
        ],
        approved: true,
        generatedPageIds: ['home'],
        revision: {
          pageId: 'requests',
          merge: { sourcePageId: 'reviews', sourceTitle: '审批', overlayId: 'review-drawer', presentation: 'drawer', plannedOnly: false },
        },
      },
      projectNotes: withNotes
        ? {
            nodes: [{ id: 'note-review', kind: 'note', title: '审批沟通', parentId: null, icon: '📝', updatedAt: '2026-11-04T00:00:00.000Z', content: '<p>审批</p>', tags: [], cover: 'none', pinned: false }],
            links: [{ page: { kind: 'page', pageId: 'reviews' }, targetNodeId: 'note-review' }],
          }
        : { nodes: [], links: [] },
    });

    const snapshot = projectContext();
    // Real AI snapshot: projectNotes is a compact catalog array, not a NoteWorkspace
    assert.ok(Array.isArray(snapshot.projectNotes), `${label}: AI snapshot projectNotes must be a catalog array`);
    assert.equal(snapshot.projectNotes.length, withNotes ? 1 : 0);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `protoflow-step2a-merge-${label}-`));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
    const contextFile = path.join(tmpDir, 'context.json');
    atomicWrite(contextFile, {
      ...scope,
      active: true,
      runId: `run-merge-${label}`,
      sessionId: `sess-merge-${label}`,
      workflowPhase: 'generating',
      targetPageId: 'requests',
      snapshot,
      operations: [],
    });

    // 1. Missing drawer/entry -> real, actionable merge issue
    const missing = callTool(contextFile, 'protoflow_apply_tsx_patch', { pageId: 'requests', source: missingDrawerSource });
    assert.equal(missing.acceptanceReady, false);
    assert.ok(
      missing.pendingAcceptanceIssues.some((msg: string) => msg.includes('弹层内容和打开入口')),
      `${label}: ${JSON.stringify(missing.pendingAcceptanceIssues)}`,
    );

    // 2. Target still navigating to retired menu -> exact actionable issue
    const navigating = callTool(contextFile, 'protoflow_apply_tsx_patch', { pageId: 'requests', source: navigateOldSource });
    assert.ok(navigating.pendingAcceptanceIssues.some((msg: string) => msg.includes('目标页面仍跳转到旧菜单')));

    // 3. Complete drawer + entry -> acceptanceReady with ZERO spurious diagnostics (no TypeError from note catalog)
    const ready = callTool(contextFile, 'protoflow_apply_tsx_patch', { pageId: 'requests', source: mergedSource });
    assert.equal(ready.acceptanceReady, true, `${label}: ${JSON.stringify(ready.pendingAcceptanceIssues)}`);
    assert.deepEqual(ready.pendingAcceptanceIssues, []);
    assert.ok(!JSON.stringify(ready).includes('Cannot read properties'));

    const inspected = callTool(contextFile, 'protoflow_inspect_page', { pageId: 'requests' });
    assert.equal(inspected.acceptanceReady, true);
    assert.deepEqual(inspected.pendingAcceptanceIssues, []);
    const brief = callTool(contextFile, 'protoflow_get_project_brief', {});
    assert.equal(brief.stagedPageReadiness.acceptanceReady, true);

    // 4. Precheck is read-only: staged snapshot keeps source menu, home navigation, and note catalog intact
    const staged = JSON.parse(fs.readFileSync(contextFile, 'utf8')).snapshot;
    assert.ok(Object.hasOwn(staged.pageSources, 'reviews'));
    assert.ok(staged.designerPages.some((page: any) => page.pageId === 'reviews'));
    assert.match(staged.pageSources.home, /navigate\("reviews"\)/);
    assert.ok(Array.isArray(staged.projectNotes));
    assert.equal(staged.projectNotes.length, withNotes ? 1 : 0);
  };

  runCase('empty-notes', false);
  runCase('with-notes', true);
});

test('Step 2a: generating retry preserves full candidate state across real HermesRuntime + protoflow-mcp and commits atomically against original baseline', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-step2a-continuation-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const savedPayloads: any[] = [];
  const runtimeEvents: any[] = [];
  const step2aListeners = new Set<(e: any) => void>();
  const runtime = new HermesRuntime({
    dataDir: path.join(tmpDir, 'data'),
    emit: (e: any) => {
      runtimeEvents.push(e);
      step2aListeners.forEach((fn) => fn(e));
    },
    validateDecodedImage: () => ({ width: 1, height: 1 }),
    deleteHistorySession: async () => {},
  });

  Object.assign(window, {
    addEventListener: () => {},
    removeEventListener: () => {},
    protoflowDesktop: {
      isElectron: true,
      saveCurrentProject: async () => {
        savedPayloads.push(captureProjectPayload());
        return { saved: true };
      },
      hermes: {
        onEvent: (fn: (e: any) => void) => {
          step2aListeners.add(fn);
          return () => {
            step2aListeners.delete(fn);
          };
        },
        session: (reqScope: any) => runtime.session(reqScope),
        sync: (req: any) => runtime.sync(req),
        cancel: (req: any) => runtime.cancel(req),
        execute: (req: any) => runtime.execute(req),
      },
    },
  });
  const stopPersistence = startProjectPersistence(5000);
  t.after(() => stopPersistence());

  const scope = setupProjectFixture('speed-step2a-continuation');
  const key = conversationKey(scope);

  const otherPageSticky: StickyNoteRule = {
    id: 'sticky-sup-1',
    index: 1,
    pageId: 'page-suppliers',
    targetWidgetId: 'tbl-suppliers',
    targetWidgetName: '供应商表格',
    text: '供应商编码唯一',
    compiledRule: 'supplier_code UNIQUE',
    active: true,
  };

  usePageStore.setState({
    designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
    tableRows: {
      t_order_main: [{ id: 'ord-saved-1', order_no: 'PO-001', supplier_name: '华星光电' }],
    },
  });
  usePageStore.getState().createDesignerPage(
    { pageId: 'page-suppliers', title: '供应商名录', folderId: 'folder-proc' },
    'export default function Page(){return <Page pfId="root" title="供应商名录"><Table pfId="tbl-suppliers" table="t_order_main"/></Page>}',
  );
  useProtoStore.setState({
    dbTables: [sampleTable],
    stickyNotes: [otherPageSticky],
    projectPlan: {
      summary: '完整候选状态续修端到端验证',
      folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
      pages: [
        {
          pageId: 'page-suppliers',
          title: '供应商名录',
          folderId: 'folder-proc',
          requirements: '展示供应商信息',
          dependencies: [],
          acceptanceCases: [{ scenario: '查看供应商', expected: '展示列表' }],
        },
        {
          pageId: 'page-orders',
          title: '采购订单',
          folderId: 'folder-proc',
          requirements: '支持维护采购订单与订单明细行，每条明细必须关联采购订单编号，点击提交保存采购单',
          dependencies: [],
          acceptanceCases: [
            {
              scenario: '填写采购订单后点击提交保存采购单',
              expected: '提交表单写入采购订单主表',
              actionPfId: 'btn-submit',
              actionKind: 'submitForm',
              targetId: 'form-order',
              tableId: 't_order_main',
            },
          ],
        },
      ],
      approved: true,
      generatedPageIds: ['page-suppliers'],
    },
  });

  const mockClient = new EventEmitter() as any;
  mockClient.closed = false;
  mockClient.close = () => { mockClient.closed = true; };
  mockClient.notify = () => {};

  let activeSessionCwd = '';
  let promptAttempt = 0;
  let previewEventsBeforeAttempt1 = 0;
  let step2aSessSeq = 0;

  mockClient.request = async (method: string, params: any) => {
    if (method === 'session/new' || method === 'session/load') {
      activeSessionCwd = params.cwd;
      const binding = params.mcpServers?.[0]?.env?.find((x: any) => x.name === 'PROTOFLOW_TOOL_BINDING')?.value;
      if (binding) {
        atomicWrite(path.join(params.cwd, 'tool-registration.json'), {
          binding,
          tools: mcpTools.map((tool: any) => tool.name),
        });
      }
      return {
        sessionId: params.sessionId ?? `sess-step2a-cont-${++step2aSessSeq}`,
        models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
      };
    }
    if (method === 'session/prompt') {
      const attemptIndex = promptAttempt++;
      const contextFile = path.join(activeSessionCwd, 'context.json');

      if (attemptIndex === 0) {
        // Attempt 0: stages child table + preview dataset + DB requirement finding + sticky note + incomplete TSX (toast instead of submitForm)
        callTool(contextFile, 'protoflow_get_project_brief', {});
        callTool(contextFile, 'protoflow_get_project', {});

        const detailTable: DBTableSchema = {
          id: 't_order_detail',
          tableName: 'order_detail',
          cnName: '采购订单明细表',
          domain: '业务单据域',
          description: '记录采购订单物料行明细',
          modeling: { entity: '采购订单明细', grain: '每个订单物料行一行', reason: '一张采购单包含多条采购物料明细' },
          columns: [
            { id: 'col-detail-id', name: 'detail_no', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '明细行号' },
            {
              id: 'col-detail-order-no',
              name: 'order_no',
              dataType: 'VARCHAR(32)',
              nullable: false,
              isPrimaryKey: false,
              isForeignKey: true,
              references: 'order_main(order_no)',
              comment: '所属采购订单编号',
            },
            { id: 'col-item-name', name: 'item_name', dataType: 'VARCHAR(128)', nullable: false, isPrimaryKey: false, comment: '物料名称' },
          ],
          sharedByMenus: [
            { pageId: 'page-orders', menuTitle: '采购订单', accessMode: 'CRUD 读写', fieldMappingNote: '展示与维护订单物料明细' },
          ],
        };
        callTool(contextFile, 'protoflow_upsert_db_table', { table: detailTable });
        callTool(contextFile, 'protoflow_add_preview_scenario', {
          datasets: [
            {
              tableId: 't_order_detail',
              rows: [
                { id: 'det-1', detail_no: 'D-01', order_no: 'PO-001', item_name: 'OLED 模组' },
                { id: 'det-2', detail_no: 'D-02', order_no: 'PO-001', item_name: '驱动芯片' },
              ],
            },
          ],
        });
        callTool(contextFile, 'protoflow_review_db_requirements', {
          sourceId: 'plan:page-orders',
          findings: [
            {
              quote: '每条明细必须关联采购订单编号',
              state: 'declared',
              note: '通过 order_detail.order_no 外键关联 order_main.order_no',
              tableId: 't_order_detail',
              basis: 'foreign:col-detail-order-no',
            },
          ],
        });
        const patchRes = callTool(contextFile, 'protoflow_apply_tsx_patch', {
          pageId: 'page-orders',
          source: `export default function Page(){return (
            <Page pfId="root" title="采购订单">
              <Form pfId="form-order" table="t_order_main">
                <Input pfId="in-no" name="order_no" label="订单编号" />
                <Input pfId="in-sup" name="supplier_name" label="供应商" />
              </Form>
              <Button pfId="btn-submit" onClick={() => toast("暂存草稿")}>提交采购单</Button>
              <Table pfId="tbl-detail" table="t_order_detail" />
            </Page>
          )}`,
        });
        assert.equal(patchRes.acceptanceReady, false, 'Attempt 0 patchRes must surface non-blocking acceptance diagnostic');
        callTool(contextFile, 'protoflow_upsert_sticky_contract', {
          sticky: {
            id: 'sticky-orders-1',
            index: 1,
            pageId: 'page-orders',
            targetWidgetId: 'btn-submit',
            targetWidgetName: '提交采购单',
            text: '点击提交保存采购单主表记录',
            compiledRule: 'submitForm("form-order")',
            active: true,
          },
        });

        mockClient.emit('notification', {
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            _meta: { alex_run_id: params._meta?.alex_run_id, admission_id: `aid-step2a-${attemptIndex}` },
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已创建明细表与页面初稿' } },
          },
        });
        return { stopReason: 'end_turn' };
      }

      // Attempt 1: verify live stores were NOT mutated by Attempt 0, while candidate state IS fully preserved!
      assert.equal(
        useProtoStore.getState().dbTables.some((tbl) => tbl.id === 't_order_detail'),
        false,
        'live dbTables must remain isolated before final atomic commit',
      );
      assert.equal(
        Object.hasOwn(usePageStore.getState().tableRows, 't_order_detail'),
        false,
        'live tableRows must remain isolated before final atomic commit',
      );
      assert.equal(
        useProtoStore.getState().stickyNotes.some((st) => st.id === 'sticky-orders-1'),
        false,
        'live stickyNotes must remain isolated before final atomic commit',
      );
      assert.deepEqual(projectPlanProgress(), ['page-suppliers']);

      const promptText = params.prompt?.[0]?.text ?? '';
      assert.match(promptText, /上一轮候选修改已保留在当前工作区/);
      assert.match(promptText, /不能仅用提示/);

      previewEventsBeforeAttempt1 = runtimeEvents.filter((ev) => ev.type === 'page-preview').length;
      assert.equal(previewEventsBeforeAttempt1, 1, 'Attempt 0 should have emitted 1 preview, and seeding Attempt 1 must not re-emit old ops');

      const brief = callTool(contextFile, 'protoflow_get_project_brief', {});
      assert.equal(brief.stagedChanges.length, 4, 'all 4 staged operations from Attempt 0 must be visible in Attempt 1');
      assert.equal(brief.stagedPageReadiness?.acceptanceReady, false);

      // Candidate table, preview rows, requirement findings, and TSX draft from Attempt 0 are all readable in Attempt 1
      const stagedDetailTable = callTool(contextFile, 'protoflow_get_db_table', { tableId: 't_order_detail' });
      assert.equal(stagedDetailTable.table.cnName, '采购订单明细表');
      const stagedDetailRows = callTool(contextFile, 'protoflow_get_table_rows', { tableId: 't_order_detail' });
      assert.equal(stagedDetailRows.total, 2);
      const stagedPage = callTool(contextFile, 'protoflow_get_page_tsx', { pageId: 'page-orders' });
      assert.match(stagedPage.source, /tbl-detail/);
      const stagedReq = callTool(contextFile, 'protoflow_review_db_requirements', {});
      assert.equal(
        stagedReq.sources.find((r: any) => r.id === 'plan:page-orders')?.findings?.[0]?.tableId,
        't_order_detail',
      );

      // Baseline safety guards from original `base` MUST still block cross-page sticky hijack, other-page edits, and row overwrites
      assert.throws(
        () =>
          callTool(contextFile, 'protoflow_upsert_sticky_contract', {
            sticky: {
              ...otherPageSticky,
              pageId: 'page-orders',
              targetWidgetId: 'btn-submit',
            },
          }),
        /不能覆盖其他页面的已有便签/,
      );
      assert.throws(
        () =>
          callTool(contextFile, 'protoflow_edit_page_block', {
            pageId: 'page-suppliers',
            targetPfId: 'root',
            mode: 'append_children',
            tsx: '<Card pfId="illegal" title="越权"/>',
          }),
        /本轮只生成指定页面/,
      );
      assert.throws(
        () =>
          callTool(contextFile, 'protoflow_add_preview_scenario', {
            datasets: [{ tableId: 't_order_main', rows: [{ id: 'overwrite-1', order_no: 'PO-9', supplier_name: 'X' }] }],
          }),
        /不能覆盖/,
      );

      // Live compression fence MUST still trigger mid-continuation if compressions increment before write
      fs.writeFileSync(countFile, '1');
      assert.throws(
        () =>
          callTool(contextFile, 'protoflow_edit_page_block', {
            pageId: 'page-orders',
            targetPfId: 'btn-submit',
            mode: 'replace_node',
            tsx: '<Button pfId="btn-submit" onClick={() => submitForm("form-order")}>提交采购单</Button>',
          }),
        /重新核对/,
      );
      callTool(contextFile, 'protoflow_get_project_brief', {});

      // Incremental fix ONLY replaces `btn-submit` via `protoflow_edit_page_block` — WITHOUT recreating `t_order_detail`, rows, sticky, or findings!
      const fixRes = callTool(contextFile, 'protoflow_edit_page_block', {
        pageId: 'page-orders',
        targetPfId: 'btn-submit',
        mode: 'replace_node',
        tsx: '<Button pfId="btn-submit" onClick={() => submitForm("form-order")}>提交采购单</Button>',
      });
      assert.equal(fixRes.staged, true);
      assert.equal(fixRes.acceptanceReady, true);
      assert.deepEqual(fixRes.pendingAcceptanceIssues, []);

      mockClient.emit('notification', {
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          _meta: { alex_run_id: params._meta?.alex_run_id, admission_id: `aid-step2a-${attemptIndex}` },
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已在候选草稿上增量修复提交按钮动作' } },
        },
      });
      return { stopReason: 'end_turn' };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  };

  const fakeHome = path.join(tmpDir, 'hermes-home');
  const fakeInstall = path.join(tmpDir, 'hermes-install');
  const countFile = path.join(tmpDir, 'compressions.json');
  const nativeBridgeBin = path.join(tmpDir, 'native-bridge-fixture');
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(fakeInstall, { recursive: true });
  fs.writeFileSync(countFile, '0');
  fs.writeFileSync(
    nativeBridgeBin,
    `#!${process.execPath}\nconst fs=require('node:fs');const r=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify({sessionId:r.sessionId,usage:{available:true,used:200,size:128000,compressions:JSON.parse(fs.readFileSync(${JSON.stringify(countFile)},'utf8'))}}));`,
    { mode: 0o700 },
  );
  runtime.settings = { home: fakeHome, binary: '/bin/echo' };
  runtime.client = mockClient;
  mockClient.on('notification', (frame: any) => runtime.onNotification(frame));
  runtime.info = {
    detected: true,
    connected: true,
    home: fakeHome,
    binary: '/bin/echo',
    installDir: fakeInstall,
    version: '0.9.0',
    capabilities: { loadSession: true },
  };
  runtime.contextBridge = async () => ({ python: nativeBridgeBin, installDir: fakeInstall, home: fakeHome });
  runtime.watchContext = async () => () => {};
  let refreshEpoch = 0;
  runtime.nativeContext = async (req: any) => {
    if (req.action === 'refresh_prompt') {
      refreshEpoch += 1;
      return { sessionId: req.sessionId, requestedEpoch: refreshEpoch };
    }
    if (req.action === 'verify_prompt') {
      const content = fs.readFileSync(path.join(activeSessionCwd, 'AGENTS.md'));
      const digest = crypto.createHash('sha256').update(content).digest('hex');
      return { sessionId: req.sessionId, verified: true, appliedSkillDigest: digest, expectedSkillDigest: digest, promptControlEpoch: refreshEpoch };
    }
    return { sessionId: req.sessionId, usage: { available: true, used: 200, size: 128000, compressions: 0 } };
  };

  await generateProject(scope.projectId);

  // Verify ALL candidate artifacts from Attempt 0 + Attempt 1 were committed atomically and flushed to disk!
  assert.equal(promptAttempt, 2);
  assert.ok(useProtoStore.getState().dbTables.some((tbl) => tbl.id === 't_order_detail'), 't_order_detail from Attempt 0 must be committed');
  assert.equal(usePageStore.getState().tableRows.t_order_detail?.length, 2, 'preview dataset from Attempt 0 must be committed');
  assert.deepEqual(
    usePageStore.getState().tableRows.t_order_main,
    [{ id: 'ord-saved-1', order_no: 'PO-001', supplier_name: '华星光电' }],
    'committed baseline rows in t_order_main must remain intact',
  );
  assert.ok(
    useProtoStore.getState().stickyNotes.some((st) => st.id === 'sticky-orders-1' && st.pageId === 'page-orders'),
    'sticky note from Attempt 0 must be committed',
  );
  assert.equal(
    useProtoStore.getState().stickyNotes.find((st) => st.id === 'sticky-sup-1')?.pageId,
    'page-suppliers',
    'other page sticky ownership must remain intact',
  );
  assert.equal(
    useProtoStore.getState().databaseRequirements.find((r) => r.id === 'plan:page-orders')?.findings[0]?.tableId,
    't_order_detail',
    'DB requirement review findings from Attempt 0 must be committed',
  );
  assert.match(usePageStore.getState().pageSources['page-orders'], /submitForm\(['"]form-order['"]\)/);
  assert.match(usePageStore.getState().pageSources['page-orders'], /table="t_order_detail"/);
  assert.deepEqual(projectPlanProgress(), ['page-suppliers', 'page-orders']);

  // Preview emitted once for Attempt 0 and once for Attempt 1's new edit
  const previewEvents = runtimeEvents.filter((ev) => ev.type === 'page-preview');
  assert.equal(previewEvents.length, 2);
  assert.match(previewEvents[1].preview.source, /submitForm\(['"]form-order['"]\)/);

  // Per-page persistence flushed the complete atomic state
  const latestSaved = savedPayloads.at(-1);
  assert.ok(latestSaved);
  assert.ok(latestSaved.stateSnapshot.dbTables.some((tbl: DBTableSchema) => tbl.id === 't_order_detail'));
  assert.equal(latestSaved.stateSnapshot.tableRows.t_order_detail?.length, 2);
  assert.ok(latestSaved.stateSnapshot.projectPlan.generatedPageIds.includes('page-orders'));

  // Step 2a observability metrics recorded continuation accurately
  const turnMetrics = useProjectWorkflow.getState().lastTurnMetrics[key];
  assert.equal(turnMetrics.retryCount, 1);
  assert.equal(turnMetrics.continuationUsed, true);
  assert.equal(turnMetrics.preservedCandidateOpCount, 4);
  const batchMetrics = useProjectWorkflow.getState().lastBatchMetrics[scope.projectId];
  assert.equal(batchMetrics.continuationPageCount, 1);
});

test('Step 2a: external concurrent edit during continuation retry aborts final commit against original revision with zero partial leakage', async () => {
  const scope = setupProjectFixture('speed-step2a-revision-guard');
  const allTools = mcpTools.map((tool: { name: string }) => tool.name);

  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  useProtoStore.setState({
    dbTables: [sampleTable],
    projectPlan: {
      summary: '并发版本冲突原子拦截验证',
      folders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }],
      pages: [
        {
          pageId: 'page-orders',
          title: '采购订单',
          folderId: 'folder-proc',
          requirements: '填写并提交采购订单',
          dependencies: [],
          acceptanceCases: [
            {
              scenario: '点击提交保存采购订单',
              expected: '写入采购订单主表',
              actionPfId: 'btn-submit',
              actionKind: 'submitForm',
              targetId: 'form-order',
              tableId: 't_order_main',
            },
          ],
        },
      ],
      approved: true,
      generatedPageIds: [],
    },
  });

  let attempt = 0;
  (window as any).protoflowDesktop = {
    hermes: wireMockHermes({
      onEvent: () => () => {},
      session: async (reqScope: any) => ({
        ...reqScope,
        sessionId: 'sess-rev-guard',
        running: false,
        projectTools: allTools,
        models: { currentModelId: 'mock-pro', availableModels: [{ modelId: 'mock-pro', name: 'Mock Pro' }] },
      }),
      sync: async () => ({ synced: true, skillDigest: 'digest-rev-guard' }),
      cancel: async () => {},
      execute: async (input: any) => {
        const cur = attempt++;
        if (cur === 0) {
          return {
            text: '初稿（未绑定 submitForm）',
            operations: [
              {
                tool: 'protoflow_upsert_db_table',
                args: {
                  table: {
                    ...sampleTable,
                    id: 't_leak_guard',
                    tableName: 'leak_guard',
                    cnName: '采购附件候选表',
                    modeling: {
                      entity: '采购订单附件',
                      grain: '每份采购合同附件一行',
                      reason: '独立记录订单附件归档信息',
                    },
                  },
                },
              },
              {
                tool: 'protoflow_apply_tsx_patch',
                args: {
                  pageId: input.targetPageId,
                  source: `export default function Page(){return (
                    <Page pfId="root" title="采购订单">
                      <Form pfId="form-order" table="t_order_main"><Input pfId="in-no" name="order_no" label="单号"/></Form>
                      <Button pfId="btn-submit" onClick={() => toast("未保存")}>提交</Button>
                    </Page>
                  )}`,
                },
              },
            ],
            sessionId: 'sess-rev-guard',
            runId: 'run-rev-0',
            modelId: 'mock-pro',
            skillDigest: 'digest-rev-guard',
          };
        }
        // Simulate user editing the project externally while Attempt 1 is running
        useProtoStore.setState((s) => ({
          stickyNotes: [
            ...s.stickyNotes,
            {
              id: 'user-concurrent-sticky',
              index: 1,
              pageId: 'page-orders',
              targetWidgetId: 'root',
              targetWidgetName: '采购订单页',
              text: '用户并发新增的便签',
              compiledRule: '',
              active: true,
            },
          ],
        }));
        return {
          text: '续修完成',
          operations: [
            {
              tool: 'protoflow_apply_tsx_patch',
              args: {
                pageId: input.targetPageId,
                source: `export default function Page(){return (
                  <Page pfId="root" title="采购订单">
                    <Form pfId="form-order" table="t_order_main"><Input pfId="in-no" name="order_no" label="单号"/></Form>
                    <Button pfId="btn-submit" onClick={() => submitForm("form-order")}>提交</Button>
                  </Page>
                )}`,
              },
            },
          ],
          sessionId: 'sess-rev-guard',
          runId: 'run-rev-1',
          modelId: 'mock-pro',
          skillDigest: 'digest-rev-guard',
        };
      },
    }),
  };

  await assert.rejects(
    () => generateProject(scope.projectId),
    /等待期间工程已修改，AI 结果未应用/,
  );

  // Neither Attempt 0's `t_leak_guard` nor Attempt 1's page source may leak into live stores
  assert.equal(useProtoStore.getState().dbTables.some((tbl) => tbl.id === 't_leak_guard'), false);
  assert.equal(useProtoStore.getState().stickyNotes.some((st) => st.id === 'user-concurrent-sticky'), true);
  assert.deepEqual(projectPlanProgress(), []);
});

// ---------------------------------------------------------------------------
// Step 2b: long-lived context bridge + serialized MCP tool writes
// ---------------------------------------------------------------------------

function createFakeContextBridge(dir: string) {
  const files = {
    log: path.join(dir, 'bridge.log'),
    countFile: path.join(dir, 'compressions.json'),
    crashFile: path.join(dir, 'crash-on.txt'),
    delayFile: path.join(dir, 'delay-ms.txt'),
  };
  fs.writeFileSync(files.countFile, '0');
  fs.writeFileSync(files.log, '');
  const python = path.join(dir, 'fake-hermes-context');
  fs.writeFileSync(
    python,
    `#!${process.execPath}
const fs = require('node:fs');
const cfg = ${JSON.stringify(files)};
const serve = process.argv.includes('--serve');
fs.appendFileSync(cfg.log, (serve ? 'spawn:serve' : 'spawn:oneshot') + '\\n');
const count = () => JSON.parse(fs.readFileSync(cfg.countFile, 'utf8'));
let epoch = 0;
function answer(req) {
  if (req.sessionId === 'broken') return { error: 'Hermes 上下文接口不可用（ValueError），请检查连接或更新 Hermes 后重试' };
  const sid = req.sessionId === 'mismatch' ? 'other-session' : req.sessionId;
  const usage = { available: true, used: 10, size: 1000, compressions: count() };
  switch (req.action) {
    case 'usage': return { sessionId: sid, usage };
    case 'history': return { sessionId: sid, query: req.query, total: 0, offset: req.offset ?? 0, matches: [], nextOffset: null };
    case 'verify_prompt': return { sessionId: sid, verified: true, blocked: false, truncated: false, appliedSkillDigest: 'digest', appliedEpoch: 0, expectedEpoch: req.minEpoch ?? 0 };
    case 'refresh_prompt': epoch += 1; return { sessionId: sid, requestedEpoch: epoch };
    case 'compress': return { sessionId: sid, status: 'compressed', summary: {}, usage };
    default: return { error: 'unknown action' };
  }
}
if (!serve) {
  const req = JSON.parse(fs.readFileSync(0, 'utf8'));
  fs.appendFileSync(cfg.log, 'oneshot:' + req.action + '\\n');
  process.stdout.write(JSON.stringify(answer(req)) + '\\n');
} else {
  let inFlight = 0;
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim()) handle(JSON.parse(line));
    }
  });
  function handle(req) {
    inFlight += 1;
    if (inFlight > 1) fs.appendFileSync(cfg.log, 'OVERLAP\\n');
    fs.appendFileSync(cfg.log, 'serve:' + req.action + '\\n');
    if (fs.existsSync(cfg.crashFile) && fs.readFileSync(cfg.crashFile, 'utf8') === req.action) {
      fs.rmSync(cfg.crashFile);
      process.exit(3);
    }
    const delay = fs.existsSync(cfg.delayFile) ? Number(fs.readFileSync(cfg.delayFile, 'utf8')) : 0;
    setTimeout(() => {
      inFlight -= 1;
      const { requestId, ...rest } = req;
      process.stdout.write(JSON.stringify({ requestId, ...answer(rest) }) + '\\n');
    }, delay);
  }
}
`,
    { mode: 0o700 },
  );
  const lines = () => fs.readFileSync(files.log, 'utf8').split('\n').filter(Boolean);
  return {
    ...files,
    bridge: { python, installDir: dir, home: dir },
    lines,
    serveSpawns: () => lines().filter((l) => l === 'spawn:serve').length,
    oneshotSpawns: () => lines().filter((l) => l === 'spawn:oneshot').length,
    overlaps: () => lines().filter((l) => l === 'OVERLAP').length,
  };
}

test('Step 2b: ContextBridgePool reuses one process, serializes requests, never caches answers, and only replays idempotent reads after transport failure', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-step2b-pool-'));
  const fake = createFakeContextBridge(tmpDir);
  const pool = new ContextBridgePool();
  t.after(() => { pool.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

  // 1. Three sequential usage reads -> exactly one process, and every answer is fresh (no caching)
  const seen: number[] = [];
  for (const value of [0, 1, 2]) {
    fs.writeFileSync(fake.countFile, String(value));
    const answer = await pool.request(fake.bridge, { action: 'usage', sessionId: 's1' });
    assert.equal(answer.mode, 'persistent');
    seen.push(answer.result.usage.compressions);
    assert.equal(answer.coldStart, value === 0, 'only the first request may cold-start the bridge');
  }
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(fake.serveSpawns(), 1);

  // 2. Concurrent callers are strictly serialized and each receives its own answer
  fs.writeFileSync(fake.delayFile, '25');
  const answers = await Promise.all(
    ['甲', '乙', '丙', '丁'].map((query) => pool.request(fake.bridge, { action: 'history', sessionId: 's1', query })),
  );
  assert.deepEqual(answers.map((a: any) => a.result.query), ['甲', '乙', '丙', '丁']);
  assert.equal(fake.overlaps(), 0, 'bridge must never have two requests in flight');
  assert.equal(fake.serveSpawns(), 1);
  fs.rmSync(fake.delayFile);

  // 3. Hermes-level error is passed through unchanged (not treated as transport failure, no fallback)
  const broken = await pool.request(fake.bridge, { action: 'usage', sessionId: 'broken' });
  assert.equal(broken.mode, 'persistent');
  assert.match(broken.result.error, /上下文接口不可用/);
  assert.equal(fake.oneshotSpawns(), 0);

  // 4. Transport failure on an idempotent read -> one-shot fallback, next request respawns the bridge
  fs.writeFileSync(fake.crashFile, 'usage');
  fs.writeFileSync(fake.countFile, '7');
  const fallback = await pool.request(fake.bridge, { action: 'usage', sessionId: 's1' });
  assert.equal(fallback.mode, 'oneshot-fallback');
  assert.equal(fallback.result.usage.compressions, 7);
  assert.equal(fake.oneshotSpawns(), 1);
  const respawned = await pool.request(fake.bridge, { action: 'usage', sessionId: 's1' });
  assert.equal(respawned.mode, 'persistent');
  assert.equal(respawned.coldStart, true);
  assert.equal(fake.serveSpawns(), 2);

  // 5. refresh_prompt mutates the native epoch: never replayed after a transport failure
  fs.writeFileSync(fake.crashFile, 'refresh_prompt');
  await assert.rejects(() => pool.request(fake.bridge, { action: 'refresh_prompt', sessionId: 's1' }), /上下文接口已退出/);
  assert.equal(fake.lines().filter((l) => l === 'oneshot:refresh_prompt').length, 0);

  // 6. compress / watch are never served by the long-lived bridge
  await assert.rejects(() => pool.request(fake.bridge, { action: 'compress', sessionId: 's1' }), /不支持常驻桥接/);
});

test('Step 2b: callToolAsync keeps the live compression fence on every write through the long-lived bridge and records one metric per call', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-step2b-tools-'));
  const fake = createFakeContextBridge(tmpDir);
  const pool = new ContextBridgePool();
  t.after(() => { pool.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

  const scope = setupProjectFixture('speed-step2b-fence');
  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  usePageStore.getState().createDesignerPage(
    { pageId: 'page-orders', title: '采购订单', folderId: 'folder-proc' },
    'export default function Page(){return <Page pfId="root" title="采购订单"><Card pfId="card-0" title="列表"/></Page>}',
  );
  const contextFile = path.join(tmpDir, 'context.json');
  const metricsFile = path.join(tmpDir, 'tool-metrics.jsonl');
  atomicWrite(contextFile, {
    ...scope,
    active: true,
    runId: 'run-step2b-fence',
    sessionId: 's1',
    workflowPhase: 'conversation',
    requireProjectBrief: true,
    nativeBridge: fake.bridge,
    metricsFile,
    snapshot: projectContext(),
    operations: [],
  });
  const append = (pfId: string) =>
    callToolAsync(contextFile, 'protoflow_edit_page_block', {
      pageId: 'page-orders',
      targetPfId: 'root',
      mode: 'append_children',
      tsx: `<Card pfId="${pfId}" title="${pfId}"/>`,
    }, { pool });

  await callToolAsync(contextFile, 'protoflow_get_project_brief', {}, { pool });
  assert.equal((await append('card-1')).staged, true);

  // Compression happens without any subscriber notification -> the very next write must be fenced
  fs.writeFileSync(fake.countFile, '1');
  const beforeFence = fs.readFileSync(contextFile, 'utf8');
  await assert.rejects(() => append('card-2'), /重新核对/);
  assert.equal(fs.readFileSync(contextFile, 'utf8'), beforeFence, 'fenced write must not stage anything');

  await callToolAsync(contextFile, 'protoflow_get_project_brief', {}, { pool });
  assert.equal((await append('card-3')).staged, true);
  const history = await callToolAsync(contextFile, 'protoflow_search_history', { query: '审批' }, { pool });
  assert.equal(history.query, '审批');

  // One long-lived process served every authoritative read; no one-shot spawns
  assert.equal(fake.serveSpawns(), 1);
  assert.equal(fake.oneshotSpawns(), 0);
  assert.equal(fake.lines().filter((l) => l === 'serve:usage').length, 5, 'every brief and every write queried the live count');

  // Exactly one metric line per tool call (internal re-runs are not recorded), with bridge attribution
  const entries = fs.readFileSync(metricsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(entries.map((e: any) => [e.tool, e.ok]), [
    ['protoflow_get_project_brief', true],
    ['protoflow_edit_page_block', true],
    ['protoflow_edit_page_block', false],
    ['protoflow_get_project_brief', true],
    ['protoflow_edit_page_block', true],
    ['protoflow_search_history', true],
  ]);
  assert.match(entries[2].error, /重新核对/);
  assert.ok(entries.every((e: any) => e.nativeQueryCount === 1 && e.nativeBridgeMode === 'persistent'));
  assert.deepEqual(entries.map((e: any) => e.nativeColdStarts), [1, 0, 0, 0, 0, 0]);
  assert.ok(entries.every((e: any) => e.durationMs >= e.nativeQueryMs));

  // Synchronous callers keep the original one-shot behaviour and the same fence
  fs.writeFileSync(fake.countFile, '2');
  assert.throws(
    () => callTool(contextFile, 'protoflow_edit_page_block', { pageId: 'page-orders', targetPfId: 'root', mode: 'append_children', tsx: '<Card pfId="card-sync" title="同步"/>' }),
    /重新核对/,
  );
  assert.equal(fake.oneshotSpawns(), 1);
  const page = JSON.parse(fs.readFileSync(contextFile, 'utf8')).snapshot.pageSources['page-orders'];
  assert.match(page, /card-1[\s\S]*card-3/);
  assert.ok(!page.includes('card-2') && !page.includes('card-sync'));
});

test('Step 2b: the MCP server processes tool calls strictly in arrival order with one long-lived bridge (no lost updates)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-step2b-server-'));
  const fake = createFakeContextBridge(tmpDir);
  fs.writeFileSync(fake.delayFile, '30');

  const scope = setupProjectFixture('speed-step2b-server');
  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  usePageStore.getState().createDesignerPage(
    { pageId: 'page-orders', title: '采购订单', folderId: 'folder-proc' },
    'export default function Page(){return <Page pfId="root" title="采购订单"/>}',
  );
  const contextFile = path.join(tmpDir, 'context.json');
  atomicWrite(contextFile, {
    ...scope,
    active: true,
    runId: 'run-step2b-server',
    sessionId: 's1',
    workflowPhase: 'conversation',
    requireProjectBrief: true,
    nativeBridge: fake.bridge,
    snapshot: projectContext(),
    operations: [],
  });

  const server = spawn(process.execPath, [path.join(process.cwd(), 'electron/protoflow-mcp.cjs'), contextFile], { stdio: ['pipe', 'pipe', 'ignore'] });
  t.after(() => { try { server.kill(); } catch {} fs.rmSync(tmpDir, { recursive: true, force: true }); });

  const frames: any[] = [];
  let buffer = '';
  const total = 6;
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP server answered ${frames.length}/${total} frames`)), 15000);
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.trim()) frames.push(JSON.parse(line));
      }
      if (frames.length >= total) { clearTimeout(timer); resolve(); }
    });
  });
  const call = (id: number, name: string, args: unknown) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const batch = [
    call(1, 'protoflow_get_project_brief', {}),
    ...[1, 2, 3, 4].map((n) => call(n + 1, 'protoflow_edit_page_block', {
      pageId: 'page-orders', targetPfId: 'root', mode: 'append_children', tsx: `<Card pfId="card-${n}" title="区块${n}"/>`,
    })),
    { jsonrpc: '2.0', id: 6, method: 'ping' },
  ];
  // All frames in a single write: an unserialized server would interleave read-modify-write cycles
  server.stdin.write(batch.map((frame) => JSON.stringify(frame)).join('\n') + '\n');
  await done;

  assert.deepEqual(frames.map((f) => f.id), [1, 2, 3, 4, 5, 6], 'responses must follow arrival order');
  assert.ok(frames.slice(0, 5).every((f) => !f.result.isError), JSON.stringify(frames.filter((f) => f.result?.isError)));
  const finalContext = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
  assert.equal(finalContext.operations.length, 4);
  assert.match(finalContext.snapshot.pageSources['page-orders'], /card-1[\s\S]*card-2[\s\S]*card-3[\s\S]*card-4/);
  assert.equal(fake.overlaps(), 0);
  assert.equal(fake.serveSpawns(), 1, 'the MCP process reuses one bridge for all calls');
  assert.equal(fake.oneshotSpawns(), 0);
});

test('Step 2b: HermesRuntime serves usage/verify/refresh through the long-lived bridge, keeps compress one-shot, and restarts the bridge after close', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-step2b-runtime-'));
  const fake = createFakeContextBridge(tmpDir);
  const runtime = new HermesRuntime({
    dataDir: path.join(tmpDir, 'data'),
    emit: () => {},
    validateDecodedImage: () => ({ width: 1, height: 1 }),
    deleteHistorySession: async () => {},
  });
  runtime.contextBridge = async () => fake.bridge;
  t.after(() => { runtime.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

  const usage = await runtime.nativeContext({ action: 'usage', sessionId: 's1' });
  assert.equal(usage.usage.compressions, 0);
  assert.equal(runtime.lastContextBridgeUse.coldStart, true);
  const verified = await runtime.nativeContext({ action: 'verify_prompt', sessionId: 's1', skillFile: path.join(tmpDir, 'AGENTS.md'), minEpoch: 0 });
  assert.equal(verified.verified, true);
  assert.equal(runtime.lastContextBridgeUse.mode, 'persistent');
  assert.equal(runtime.lastContextBridgeUse.coldStart, false);
  const first = await runtime.nativeContext({ action: 'refresh_prompt', sessionId: 's1' });
  const second = await runtime.nativeContext({ action: 'refresh_prompt', sessionId: 's1' });
  assert.equal(second.requestedEpoch, first.requestedEpoch + 1, 'each refresh reaches Hermes; nothing is cached');
  assert.equal(fake.serveSpawns(), 1);

  await assert.rejects(() => runtime.nativeContext({ action: 'usage', sessionId: 'mismatch' }), /其他会话/);

  const compressed = await runtime.nativeContext({ action: 'compress', sessionId: 's1' });
  assert.equal(compressed.status, 'compressed');
  assert.deepEqual(fake.lines().filter((l) => l.startsWith('oneshot:')), ['oneshot:compress']);

  runtime.close();
  await runtime.nativeContext({ action: 'usage', sessionId: 's1' });
  assert.equal(runtime.lastContextBridgeUse.coldStart, true);
  assert.equal(fake.serveSpawns(), 2, 'close() tears the bridge down; the next request starts a fresh one');
});

test('Step 2b Review Fix: a tool call awaiting the bridge never acts on a turn that replaced it (cancel then immediate retry)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-step2b-stale-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const scope = setupProjectFixture('speed-step2b-stale');
  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  usePageStore.getState().createDesignerPage(
    { pageId: 'page-orders', title: '采购订单', folderId: 'folder-proc' },
    'export default function Page(){return <Page pfId="root" title="采购订单"/>}',
  );
  const contextFile = path.join(tmpDir, 'context.json');
  const metricsFile = path.join(tmpDir, 'tool-metrics.jsonl');
  const turn = (runId: string) => ({
    ...scope,
    active: true,
    runId,
    sessionId: 's1',
    workflowPhase: 'conversation',
    requireProjectBrief: true,
    nativeBridge: { python: '/unused-in-this-test', installDir: tmpDir, home: tmpDir },
    metricsFile,
    snapshot: projectContext(),
    operations: [],
  });

  // Controllable bridge: old-turn queries stay pending until released explicitly
  const held: Array<() => void> = [];
  let autoAnswer = false;
  const pool = {
    request: (_bridge: unknown, payload: any) => {
      const answer = () => ({ result: { sessionId: payload.sessionId, usage: { available: true, used: 1, size: 10, compressions: 0 } }, mode: 'persistent', coldStart: false, durationMs: 1 });
      return autoAnswer ? Promise.resolve(answer()) : new Promise((resolve) => held.push(() => resolve(answer())));
    },
  };
  const append = (pfId: string, extra: Record<string, unknown> = {}) =>
    callToolAsync(contextFile, 'protoflow_edit_page_block', {
      pageId: 'page-orders', targetPfId: 'root', mode: 'append_children', tsx: `<Card pfId="${pfId}" title="${pfId}"/>`,
    }, { pool, ...extra });

  atomicWrite(contextFile, turn('run-1'));
  const oldIdentity = readExecutionIdentity(contextFile);
  const oldBrief = callToolAsync(contextFile, 'protoflow_get_project_brief', {}, { pool });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(held.length, 1, 'old brief is waiting on the bridge');

  // Host cancels run-1 and starts run-2 (fresh context.json), user retries immediately
  atomicWrite(contextFile, turn('run-2'));
  autoAnswer = true;
  await assert.rejects(() => append('card-early'), /重新核对/, 'run-2 has not read its brief yet');

  // Release the stale query: the old call must be rejected and must not mark run-2 as verified
  held.shift()!();
  await assert.rejects(() => oldBrief, /所属的 Alex 轮次已结束或已切换/);
  const afterStale = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
  assert.equal(afterStale.runId, 'run-2');
  assert.equal(Object.hasOwn(afterStale, 'briefReadEpoch'), false);
  assert.equal(Object.hasOwn(afterStale, 'briefReadCompressions'), false);
  await assert.rejects(() => append('card-still-gated'), /重新核对/, 'the brief gate of run-2 is still closed');

  // A frame queued for run-1 is rejected before reading or writing anything
  await assert.rejects(() => append('card-old-queued', { expectedIdentity: oldIdentity }), /所属的 Alex 轮次已结束或已切换/);

  // run-2 proceeds normally once its own brief is read
  await callToolAsync(contextFile, 'protoflow_get_project_brief', {}, { pool });
  assert.equal((await append('card-new')).staged, true);
  const finalContext = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
  assert.equal(finalContext.operations.length, 1);
  assert.match(finalContext.snapshot.pageSources['page-orders'], /card-new/);
  assert.ok(!/card-early|card-still-gated|card-old-queued/.test(finalContext.snapshot.pageSources['page-orders']));

  // Stale calls are not attributed to run-2's metrics
  const entries = fs.readFileSync(metricsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(entries.every((e: any) => e.runId === 'run-2'));
  assert.ok(!entries.some((e: any) => /轮次已结束或已切换/.test(e.error ?? '')));
  assert.deepEqual(entries.map((e: any) => [e.tool, e.ok]), [
    ['protoflow_edit_page_block', false],
    ['protoflow_edit_page_block', false],
    ['protoflow_get_project_brief', true],
    ['protoflow_edit_page_block', true],
  ]);
});

test('Step 2b Review Fix: MCP server binds queued frames to the turn active on arrival and rejects them after the host switches turns', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-step2b-stale-server-'));
  const fake = createFakeContextBridge(tmpDir);

  const scope = setupProjectFixture('speed-step2b-stale-server');
  usePageStore.setState({ designerFolders: [{ id: 'folder-proc', title: '采购中心', parentFolderId: null }] });
  usePageStore.getState().createDesignerPage(
    { pageId: 'page-orders', title: '采购订单', folderId: 'folder-proc' },
    'export default function Page(){return <Page pfId="root" title="采购订单"/>}',
  );
  const contextFile = path.join(tmpDir, 'context.json');
  const turn = (runId: string) => ({
    ...scope,
    active: true,
    runId,
    sessionId: 's1',
    workflowPhase: 'conversation',
    requireProjectBrief: true,
    nativeBridge: fake.bridge,
    snapshot: projectContext(),
    operations: [],
  });
  atomicWrite(contextFile, turn('run-1'));

  const server = spawn(process.execPath, [path.join(process.cwd(), 'electron/protoflow-mcp.cjs'), contextFile], { stdio: ['pipe', 'pipe', 'ignore'] });
  t.after(() => { try { server.kill(); } catch {} fs.rmSync(tmpDir, { recursive: true, force: true }); });
  const frames = new Map<number, any>();
  let buffer = '';
  const waiters: Array<() => void> = [];
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim()) { const f = JSON.parse(line); frames.set(f.id, f); }
    }
    waiters.splice(0).forEach((w) => w());
  });
  const waitFor = async (check: () => boolean, label: string) => {
    const deadline = Date.now() + 10000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, 20); });
    }
  };
  const send = (...list: unknown[]) => server.stdin.write(list.map((f) => JSON.stringify(f)).join('\n') + '\n');
  const call = (id: number, name: string, args: unknown) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const edit = (id: number, pfId: string) => call(id, 'protoflow_edit_page_block', { pageId: 'page-orders', targetPfId: 'root', mode: 'append_children', tsx: `<Card pfId="${pfId}" title="${pfId}"/>` });

  send({ jsonrpc: '2.0', id: 0, method: 'ping' });
  await waitFor(() => frames.has(0), 'server ready');

  // run-1: the brief blocks on a slow bridge; its write is queued behind it
  fs.writeFileSync(fake.delayFile, '600');
  send(call(1, 'protoflow_get_project_brief', {}), edit(2, 'card-old'));
  await waitFor(() => fake.lines().includes('serve:usage'), 'run-1 brief in flight');

  // Host cancels run-1 and starts run-2 while run-1 frames are still pending
  atomicWrite(contextFile, turn('run-2'));
  fs.writeFileSync(fake.delayFile, '0');
  send(call(3, 'protoflow_get_project_brief', {}), edit(4, 'card-new'));
  await waitFor(() => [1, 2, 3, 4].every((id) => frames.has(id)), 'all frames');

  for (const id of [1, 2]) {
    assert.equal(frames.get(id).result.isError, true);
    assert.match(frames.get(id).result.content[0].text, /所属的 Alex 轮次已结束或已切换/);
  }
  for (const id of [3, 4]) assert.notEqual(frames.get(id).result.isError, true, JSON.stringify(frames.get(id)));
  const finalContext = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
  assert.equal(finalContext.runId, 'run-2');
  assert.equal(finalContext.operations.length, 1);
  assert.match(finalContext.snapshot.pageSources['page-orders'], /card-new/);
  assert.ok(!finalContext.snapshot.pageSources['page-orders'].includes('card-old'));
  assert.equal(finalContext.briefReadCompressions, 0, 'run-2 brief state came from run-2 itself');
});
