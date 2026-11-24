import { compactRpReview, expandRpReview } from '../proto/axure/reviewSource';
import { isEnLocale, tr } from '../i18n/runtime';
import { checkRpTableExtension } from '../proto/axure/schema';
import { axureCatalog, axureScopePages, axureCopyId, type AxureScope } from '../proto/axure/task';
import { buildFigmaMigrationInstructions, figmaCatalog, figmaScopePages, figmaCopyId, type FigmaScope } from '../proto/figma/task';
import { generationEvidenceIssues, pageGenerationOrder, reviewPageDependencies } from './projectDependencies';
import { captureRuntimeError, type DiagnosticContext } from './runtimeDiagnostics';
import { projectDiagnosticContext } from './projectDiagnosticContext';
import { createPublishedSnapshot, publishablePages } from './createPublishedSnapshot';
import { previewRelationIssues } from '../proto/database/previewRelations';
import { projectExecutionBrief } from './projectKnowledge';
import { databaseRequirementSources, isResumeCommand } from './databaseRequirementSources';
import { collectRequirementRecords, type RequirementSubmission } from '../proto/database/requirementReview';
import { batchMetricsStorageKey, notifyChatPurged, projectChatScope, registerChatPurgeHook, turnMetricsStorageKey } from './projectChatHistory';
import { describeChanges, revisionDigest } from './projectChangeReview';
import { validateProjectQuestions } from './projectQuestions';
import { create } from 'zustand';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { useAiChatStore } from '../store/useAiChatStore';
import { useAiPreviewStore } from '../store/useAiPreviewStore';
import { useHermesStore, buildProtoFlowHermesSkillMarkdown } from '../store/useHermesStore';
import { conversationKey, type HermesProjectConversation } from './hermesConversation';
import {
  getHermesApi,
  type HermesExecutionContinuation,
  type HermesFailureEnvelope,
  type HermesImageAttachment,
  type HermesNativeToolMetricSummary,
  type HermesOperation,
  type HermesToolMetricSummary,
} from './hermesClient';
import { verifyDependencyFootprint, type DependencyFootprintV3 } from './dependencyFootprint';
import { newId } from '../utils/identity';
import { saveChatImages, type ChatImageDraft } from './chatImages';
import { captureChatMindmaps, type ChatMindmap } from './projectChatMindmaps';
import { captureProjectPayload, flushProjectChanges } from './projectStorage';
import { applyProjectChanges, prepareProjectChanges, projectContext, projectRevision, stageGeneratingCandidate } from './hermesProject';
import type { PflowBinaryPayload } from '../utils/pflowBinaryCodec';
import type { RequestedPage } from './projectPagePlatform';
import {
  failureDiagnosticNeedsArchiveRestart,
  failureNeedsArchiveRestart,
  finalProjectDraftOperations,
  validateProjectPlan,
  type ProjectPlan,
} from './projectPlan';
import { includesPlanAndSchema, pagePrototypeIssue, planMenuOperations } from './projectPlanMenus';
import { analyzeProject } from './projectAnalysis';
import { pendingProjectAiTasks } from './hermesTaskLock';
import { withAiBackgroundTask } from './aiBackground';

export const MAX_PERSISTED_TURN_METRICS = 50;
export const MAX_PERSISTED_BATCH_METRICS = 20;
export const MAX_RUNTIME_WORKSPACE_METRICS = 50;

export const STAGE_TIMING_SEMANTICS = {
  inclusiveEnvelopes: {
    totalTurnMs: '单轮端到端墙钟耗时（包含会话准备、ACP 调用、宿主校验、状态写入与磁盘落盘）。',
    totalBatchMs: '批量页面生成端到端墙钟耗时（包含批次预备建连、菜单初始化落盘、逐页生成与发布预检）。',
    acpTurnMs: 'ACP session/prompt 往返总包络耗时，内部包含 unattributedAcpMs、toolExecMs、nativeToolExecMs 与 userWaitMs，不可与子阶段直接相加。',
    validationMs: '校验总包络耗时，等于 promptVerifyMs + hostValidationMs（批次级还包含 postGenerationValidationMs）。',
    retryMs: '宿主触发重试轮次的墙钟包络耗时（retryCount > 0 时与重试轮次的 acpTurnMs 重叠，仅作重试代价参考）。',
  },
  exclusiveSubStages: {
    sessionSetupMs: '会话准备净耗时（单轮为 ensureToolsMs + syncMs + runtimeSessionSetupMs + contextBridgeSetupMs；批次级额外加上 preGenerationSetupMs）。',
    unattributedAcpMs: '扣除 protoflow-mcp 工具（toolExecMs）、Hermes 原生工具（nativeToolExecMs）与用户交互等待（userWaitMs）后的未归因 ACP 耗时（含模型推理、ACP 网关调度及未发出通知的内部开销，不等同于纯模型推理耗时）。',
    toolExecMs: 'protoflow-mcp 工具实际执行净耗时（位于 acpTurnMs 内部）。',
    contextQueryMs: 'protoflow-mcp 工具内部向 Hermes 查询权威上下文（写前压缩计数、历史检索）的耗时（位于 toolExecMs 内部）；contextColdStarts 为上下文桥接进程冷启动次数（含 verify_prompt），常驻桥接复用时为 0。',
    nativeToolExecMs: '通过 ACP tool_call 生命周期观测到的 Hermes 原生工具（如 terminal、search_files、tool_search 等，不含 protoflow-mcp 与用户交互等待）执行净耗时（位于 acpTurnMs 内部）。',
    userWaitMs: '模型发起提问或权限确认时等待用户响应的净耗时（位于 acpTurnMs 内部）。',
    promptVerifyMs: 'Hermes 原生系统提示词摘要核验（verify_prompt）净耗时。',
    hostValidationMs: '宿主契约、关联分析、原型结构与业务证据校验净耗时（不含 applyProjectChanges 与落盘）。',
    applyChangesMs: '宿主需求记录归集与内存状态提交（applyProjectChanges）净耗时（不含磁盘落盘）。',
    saveFlushMs: '纯工程落盘（flushProjectChanges）净耗时（不含 applyProjectChanges 与宿主校验）。',
  },
  retentionLimits: {
    turnHistoryPerConversation: MAX_PERSISTED_TURN_METRICS,
    batchHistoryPerProject: MAX_PERSISTED_BATCH_METRICS,
    runtimeWorkspaceJsonlLines: MAX_RUNTIME_WORKSPACE_METRICS,
  },
} as const;

export interface ProjectSessionSetupEvent {
  stage: 'review_preflight' | 'batch_preflight' | 'turn_preflight' | 'execute';
  targetPageId?: string;
  durationMs: number;
  reused: boolean;
  reloaded: boolean;
  created: boolean;
  reloadReason: string | null;
}

export interface ProjectTurnMetrics {
  metricId: string;
  projectId: string;
  conversationKey: string;
  phase: 'conversation' | 'generating';
  targetPageId?: string;
  outcome: 'applied' | 'review' | 'questions' | 'answer' | 'error';
  errorMessage?: string;
  startedAt: string;
  /** Inclusive end-to-end wall-clock turn duration. */
  totalTurnMs: number;
  /** Exclusive setup time inside this turn (`ensureToolsMs + syncMs + runtimeSessionSetupMs + contextBridgeSetupMs`). */
  sessionSetupMs: number;
  /** Batch/review preflight setup time attributed to the first turn of a batch (not added into `sessionSetupMs` to avoid batch double-counting). */
  batchPreflightMs: number;
  ensureToolsMs: number;
  syncMs: number;
  runtimeSessionSetupMs: number;
  contextBridgeSetupMs: number;
  sessionCreated: boolean;
  sessionReloaded: boolean;
  sessionReused: boolean;
  reloadReason: string | null;
  sessionEvents: ProjectSessionSetupEvent[];
  firstOutputMs: number | null;
  firstTextMs: number | null;
  /** Inclusive ACP `session/prompt` duration (`unattributedAcpMs + toolExecMs + nativeToolExecMs + userWaitMs`); do NOT add to sub-stages. */
  acpTurnMs: number;
  /** Unattributed ACP duration inside `acpTurnMs` (`max(0, acpTurnMs - toolExecMs - nativeToolExecMs - userWaitMs)`). */
  unattributedAcpMs: number;
  /** Exclusive MCP tool execution duration inside `acpTurnMs`. */
  toolExecMs: number;
  /** Exclusive Hermes native tool execution duration inside `acpTurnMs`. */
  nativeToolExecMs: number;
  /** Exclusive user question/permission wait duration inside `acpTurnMs`. */
  userWaitMs: number;
  toolCallCount: number;
  failedToolCallCount: number;
  nativeToolCallCount: number;
  failedNativeToolCallCount: number;
  toolBreakdown: Record<string, HermesToolMetricSummary>;
  nativeToolBreakdown: Record<string, HermesNativeToolMetricSummary>;
  /** Authoritative Hermes context reads issued by protoflow-mcp tools (time is inside `toolExecMs`). */
  contextQueryCount: number;
  contextQueryMs: number;
  /** Context bridge process cold starts (tool reads + `verify_prompt`); 0 means the long-lived bridge was reused throughout. */
  contextColdStarts: number;
  retryCount: number;
  /** Inclusive wall-clock duration of retry `runModel` invocations. */
  retryMs: number;
  /** Whether a generating retry continued on top of Attempt 0's preserved candidate state. */
  continuationUsed: boolean;
  /** Count of staged candidate operations preserved into continuation retry. */
  preservedCandidateOpCount: number;
  /** Inclusive validation duration (`promptVerifyMs + hostValidationMs`). */
  validationMs: number;
  /** Exclusive `verify_prompt` duration. */
  promptVerifyMs: number;
  /** Exclusive host-side validation duration (`prepareProjectChanges`, `analyzeProject`, `generationEvidenceIssues`, etc.). */
  hostValidationMs: number;
  /** Exclusive host state-application duration (`collectRequirementRecords` + `applyProjectChanges`) before disk flush. */
  applyChangesMs: number;
  /** Exclusive disk persistence duration (`flushProjectChanges()` ONLY). */
  saveFlushMs: number;
  initialPromptBytes: number;
  promptBytes: number;
  imageBytes: number;
  snapshotBytes: number;
  contextJsonBytes: number;
  skillBytes: number;
}
export interface ProjectBatchMetrics {
  metricId: string;
  projectId: string;
  conversationKey: string;
  startedAt: string;
  totalBatchMs: number;
  plannedPageCount: number;
  completedPageCount: number;
  failedPageId?: string;
  preGenerationSetupMs: number;
  preGenerationApplyMs: number;
  preGenerationFlushMs: number;
  failureFlushMs: number;
  postGenerationValidationMs: number;
  sessionCreated: boolean;
  sessionReloaded: boolean;
  sessionReused: boolean;
  sessionEvents: ProjectSessionSetupEvent[];
  sessionSetupMs: number;
  /** Inclusive ACP `session/prompt` duration across pages (contains `unattributedAcpMs`, `toolExecMs`, `nativeToolExecMs`, `userWaitMs`). */
  acpTurnMs: number;
  /** Unattributed ACP duration across pages (`max(0, acpTurnMs - toolExecMs - nativeToolExecMs - userWaitMs)`). */
  unattributedAcpMs: number;
  /** Exclusive MCP tool execution duration across pages. */
  toolExecMs: number;
  /** Exclusive Hermes native tool execution duration across pages. */
  nativeToolExecMs: number;
  /** Exclusive user wait duration across pages. */
  userWaitMs: number;
  toolCallCount: number;
  failedToolCallCount: number;
  nativeToolCallCount: number;
  failedNativeToolCallCount: number;
  contextQueryCount: number;
  contextQueryMs: number;
  contextColdStarts: number;
  retryCount: number;
  retryMs: number;
  continuationPageCount: number;
  promptVerifyMs: number;
  hostValidationMs: number;
  validationMs: number;
  applyChangesMs: number;
  /** Pure `flushProjectChanges()` duration across pre-batch, pages, and failure persistence. */
  saveFlushMs: number;
  promptBytes: number;
  snapshotBytes: number;
  pageMetrics: ProjectTurnMetrics[];
}
export interface ProjectAiMetricsReport {
  schemaVersion: 1;
  exportedAt: string;
  projectId: string;
  conversationKey: string;
  timingSemantics: typeof STAGE_TIMING_SEMANTICS;
  latestTurn: ProjectTurnMetrics | null;
  latestBatch: ProjectBatchMetrics | null;
  turnHistory: ProjectTurnMetrics[];
  batchHistory: ProjectBatchMetrics[];
}
const nowMs = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
const roundMs = (value: number) => Number(Math.max(0, value).toFixed(2));
const utf8Encoder = new TextEncoder();
const utf8Bytes = (value: string) => utf8Encoder.encode(value).byteLength;
const purgedConversationKeys = new Set<string>();
function mergeToolBreakdown(
  target: Record<string, HermesToolMetricSummary>,
  incoming?: Record<string, HermesToolMetricSummary>,
) {
  if (!incoming) return;
  for (const [tool, stats] of Object.entries(incoming)) {
    const prev = target[tool] ?? { count: 0, failedCount: 0, totalMs: 0, argBytes: 0, resultBytes: 0 };
    target[tool] = {
      count: prev.count + stats.count,
      failedCount: prev.failedCount + stats.failedCount,
      totalMs: roundMs(prev.totalMs + stats.totalMs),
      argBytes: prev.argBytes + stats.argBytes,
      resultBytes: prev.resultBytes + stats.resultBytes,
    };
  }
}
function mergeNativeToolBreakdown(
  target: Record<string, HermesNativeToolMetricSummary>,
  incoming?: Record<string, HermesNativeToolMetricSummary>,
) {
  if (!incoming) return;
  for (const [tool, stats] of Object.entries(incoming)) {
    const prev = target[tool] ?? { count: 0, failedCount: 0, totalMs: 0 };
    target[tool] = {
      count: prev.count + stats.count,
      failedCount: prev.failedCount + stats.failedCount,
      totalMs: roundMs(prev.totalMs + stats.totalMs),
    };
  }
}
function turnMetricIdentity(item: ProjectTurnMetrics): string {
  return item.metricId || `legacy-turn:${item.conversationKey}:${item.startedAt}:${item.phase}:${item.targetPageId ?? ''}:${item.outcome}:${item.totalTurnMs}`;
}
function batchMetricIdentity(item: ProjectBatchMetrics): string {
  return item.metricId || `legacy-batch:${item.projectId}:${item.conversationKey}:${item.startedAt}:${item.plannedPageCount}:${item.completedPageCount}:${item.totalBatchMs}`;
}
function mergeBoundedHistory<T>(
  persisted: readonly T[],
  inMemory: readonly T[] | undefined,
  getId: (item: T) => string,
  maxEntries: number,
  extraItems: readonly T[] = [],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const source of [persisted, inMemory ?? [], extraItems]) {
    for (const item of source) {
      const id = getId(item);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged.slice(-maxEntries);
}
export function readPersistedTurnMetrics(scopeOrKey: HermesProjectConversation | string): ProjectTurnMetrics[] {
  try {
    const key = typeof scopeOrKey === 'string' ? scopeOrKey : conversationKey(scopeOrKey);
    if (purgedConversationKeys.has(key)) return [];
    const raw = globalThis.window?.localStorage?.getItem(turnMetricsStorageKey(key));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ProjectTurnMetrics => Boolean(item && typeof item === 'object' && typeof (item as ProjectTurnMetrics).projectId === 'string' && typeof (item as ProjectTurnMetrics).totalTurnMs === 'number'))
      .slice(-MAX_PERSISTED_TURN_METRICS);
  } catch {
    return [];
  }
}
export function readPersistedBatchMetrics(projectId: string): ProjectBatchMetrics[] {
  try {
    const raw = globalThis.window?.localStorage?.getItem(batchMetricsStorageKey(projectId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ProjectBatchMetrics =>
          Boolean(
            item &&
              typeof item === 'object' &&
              (item as ProjectBatchMetrics).projectId === projectId &&
              typeof (item as ProjectBatchMetrics).totalBatchMs === 'number' &&
              !purgedConversationKeys.has((item as ProjectBatchMetrics).conversationKey),
          ),
      )
      .slice(-MAX_PERSISTED_BATCH_METRICS);
  } catch {
    return [];
  }
}
function purgeInMemoryConversationTelemetry(projectId: string, key: string) {
  purgedConversationKeys.add(key);
  const persistedBatches = readPersistedBatchMetrics(projectId).filter(item => item.conversationKey !== key);
  useProjectWorkflow.setState(state => {
    const { [key]: removedStatus, ...status } = state.status;
    const { [key]: removedTurn, ...lastTurnMetrics } = state.lastTurnMetrics;
    const { [key]: removedHistory, ...turnMetricsHistory } = state.turnMetricsHistory;
    const inMemoryBatches = (state.batchMetricsHistory[projectId] ?? []).filter(item => item.conversationKey !== key);
    const remainingBatches = mergeBoundedHistory(
      persistedBatches,
      inMemoryBatches,
      batchMetricIdentity,
      MAX_PERSISTED_BATCH_METRICS,
    );
    const batchMetricsHistory = { ...state.batchMetricsHistory };
    if (remainingBatches.length) {
      batchMetricsHistory[projectId] = remainingBatches;
    } else {
      delete batchMetricsHistory[projectId];
    }
    const lastBatchMetrics = { ...state.lastBatchMetrics };
    if (lastBatchMetrics[projectId]?.conversationKey === key) {
      const fallbackBatch = remainingBatches.at(-1);
      if (fallbackBatch) {
        lastBatchMetrics[projectId] = fallbackBatch;
      } else {
        delete lastBatchMetrics[projectId];
      }
    }
    return { status, lastTurnMetrics, turnMetricsHistory, batchMetricsHistory, lastBatchMetrics };
  });
}
registerChatPurgeHook(purgeInMemoryConversationTelemetry);
export function purgeConversationTelemetry(scope: HermesProjectConversation) {
  notifyChatPurged(scope.projectId, conversationKey(scope));
}
export function clearPersistedTurnMetrics(scopeOrKey: HermesProjectConversation | string) {
  if (typeof scopeOrKey !== 'string') {
    purgeConversationTelemetry(scopeOrKey);
    return;
  }
  purgedConversationKeys.add(scopeOrKey);
  try {
    globalThis.window?.localStorage?.removeItem(turnMetricsStorageKey(scopeOrKey));
  } catch {}
}
function recordTurnMetrics(key: string, turnMetrics: ProjectTurnMetrics) {
  try {
    purgedConversationKeys.delete(key);
    const inMemory = useProjectWorkflow.getState().turnMetricsHistory[key];
    const persisted = readPersistedTurnMetrics(key);
    const nextHistory = mergeBoundedHistory(
      persisted,
      inMemory,
      turnMetricIdentity,
      MAX_PERSISTED_TURN_METRICS,
      [turnMetrics],
    );
    try {
      globalThis.window?.localStorage?.setItem(turnMetricsStorageKey(key), JSON.stringify(nextHistory));
    } catch {}
    useProjectWorkflow.setState(s => ({
      lastTurnMetrics: { ...s.lastTurnMetrics, [key]: turnMetrics },
      turnMetricsHistory: { ...s.turnMetricsHistory, [key]: nextHistory },
    }));
  } catch {}
}
function recordBatchMetrics(projectId: string, batchMetrics: ProjectBatchMetrics) {
  try {
    purgedConversationKeys.delete(batchMetrics.conversationKey);
    const inMemory = useProjectWorkflow.getState().batchMetricsHistory[projectId];
    const persisted = readPersistedBatchMetrics(projectId);
    const nextHistory = mergeBoundedHistory(
      persisted,
      inMemory,
      batchMetricIdentity,
      MAX_PERSISTED_BATCH_METRICS,
      [batchMetrics],
    );
    try {
      globalThis.window?.localStorage?.setItem(batchMetricsStorageKey(projectId), JSON.stringify(nextHistory));
    } catch {}
    useProjectWorkflow.setState(s => ({
      lastBatchMetrics: { ...s.lastBatchMetrics, [projectId]: batchMetrics },
      batchMetricsHistory: { ...s.batchMetricsHistory, [projectId]: nextHistory },
    }));
  } catch {}
}
export function exportProjectAiMetricsReport(
  projectId: string,
  scope?: HermesProjectConversation,
): ProjectAiMetricsReport {
  const resolvedScope = scope ?? projectChatScope(projectId, useAiChatStore.getState().loadProjectIndex(projectId).activeId);
  const key = conversationKey(resolvedScope);
  const state = useProjectWorkflow.getState();
  const inMemoryTurns = state.turnMetricsHistory[key];
  const persistedTurns = readPersistedTurnMetrics(key);
  const turnHistory = mergeBoundedHistory(
    persistedTurns,
    inMemoryTurns,
    turnMetricIdentity,
    MAX_PERSISTED_TURN_METRICS,
  );
  const inMemoryBatches = state.batchMetricsHistory[projectId];
  const persistedBatches = readPersistedBatchMetrics(projectId);
  const batchHistory = mergeBoundedHistory(
    persistedBatches,
    inMemoryBatches,
    batchMetricIdentity,
    MAX_PERSISTED_BATCH_METRICS,
  );
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    projectId,
    conversationKey: key,
    timingSemantics: STAGE_TIMING_SEMANTICS,
    latestTurn: state.lastTurnMetrics[key] ?? turnHistory.at(-1) ?? null,
    latestBatch: state.lastBatchMetrics[projectId] ?? batchHistory.at(-1) ?? null,
    turnHistory,
    batchHistory,
  };
}

export const useProjectWorkflow = create<{
  running: Record<string, boolean>;
  runningChat: Record<string, string | undefined>;
  status: Record<string, string>;
  lastTurnMetrics: Record<string, ProjectTurnMetrics>;
  turnMetricsHistory: Record<string, ProjectTurnMetrics[]>;
  lastBatchMetrics: Record<string, ProjectBatchMetrics>;
  batchMetricsHistory: Record<string, ProjectBatchMetrics[]>;
}>(() => ({
  running: {},
  runningChat: {},
  status: {},
  lastTurnMetrics: {},
  turnMetricsHistory: {},
  lastBatchMetrics: {},
  batchMetricsHistory: {},
}));
export const buildProjectSharedInstructions = () => `${buildProtoFlowHermesSkillMarkdown(useProtoStore.getState().dbTables, usePageStore.getState().compositeBlocks, useProtoStore.getState().stickyNotes, 'project', useProtoStore.getState().currentProjectMeta.projectMode ?? 'hybrid')}
你是服务整个项目的 Agent。根据用户本轮目标自主决定是否读取目录、源码与数据、直接回答、追问，或组合项目工具。方案中每个页面须声明 dependencies 和 acceptanceCases。按业务来源拆解上下游，已知的关系填写准确来源表及引用列 ID，独立页填空数组，待澄清的来源填 pending。验收场景引用原始脑图 ID 与原文；交互场景除规划稳定的 actionPfId（多事件组件如 MBottomDock、Table 行操作等须同时指定 actionEvent 如 onPrimary / rowActions[0].onClick，或写为 dock.onPrimary）外，还应按动作语义填写 actionKind（submitForm / openOverlay / closeOverlay / navigate / updateRow / deleteRow / returnSelection）及对应的 targetId（目标表单 pfId / 弹层 id / 目标 pageId / 选单表格 pfId）、tableId（绑定的表 ID）与 field（状态字段或来源键字段），后续生成严格复用该 ID 与目标绑定，严禁仅用 toast 或 closeOverlay 代替实际保存或状态变更。取消、返回、退出场景也要绑定准确事件：返回菜单用 navigate 与目标 pageId，关闭弹层用 closeOverlay 与所在弹层 id；不得把业务写入绑在取消事件上，也不得用 toast 假装返回。绑定业务数据的统计图在验收场景填写 chart 的 pfId 和 tableId。需要覆盖业务流程或演示统计图时，用 protoflow_add_preview_scenario 在尚无记录的表中写入明示为演示的场景数据，再绑定页面。使用同一主记录的两条明细与另一条主记录验证筛选，不得把演示数当成用户业务数。不要把提问、建方案或逐页生成当作每次请求的必经之路。
RP 迁移先用 protoflow_inspect_axure_project 在指定页面、目录或全项目按 nextOffset 盘点。结合项目约定区分列表、录入、查询、主单和明细；逐个核对实体及行粒度再选择共享表，同名表头不能证明字段归属。只读分析只给出来源、候选结构、疑问和分批建议。转换任务先用 protoflow_inspect_page（view 为 axure）按页和 pfId 读取证据，按 nextOffset 翻页并核对表头、grid.columnActions 行动作一致性、nearbyLabel 邻近标签、当前及隐藏状态和 importNotes 转换限制。先用 protoflow_get_project 核对表目录，字段依据明确时用 protoflow_upsert_db_table 或 protoflow_upsert_db_column 暂存结构；不能从标题、示例值或字段同名推断主外键、唯一性和必填性，且暂存表结构不等于已完成页面转换（参考工具返回的 rpMigrationProgress）。RP 优化副本默认以标准流式布局为目标：优先调用 protoflow_reshape_axure_page（传入源页 rp-page-... ID，由宿主生成副本 ID 与来源标记；后续可对副本增量调用 protoflow_edit_page_block），将平铺的查询标签/输入框/按钮合成为 QueryForm（target 指向 Table 的 pfId），将业务表格转为绑定真实表的 Table；仅在列动作逐行一致（grid.columnActions 中 consistentAcrossDataRows 为 true 且 requiresConfirmation 为 false，如每行一致的“查看”跳转）时迁入 Table.rowActions（跨页查看使用 navigate(目标页ID, "row") 或行内 openDrawer/openModal 以携带当前行），单行样例动作（如某一行才有的“删除”）严禁直接推广到全表 rowActions。严禁单凭外观静默删掉侧栏 OutlineTree、自定义分页、隐藏 DynamicPanel、未支持占位元件或条件点击警告；所有源页面核心区块必须在 coverage 中逐项交代为 converted（已转换）、retained（保留原控件）或 pending（待确认及原因）。若仅需在原自由画布内做单点替换，仍可使用 protoflow_bind_axure_table 或 protoflow_optimize_axure_block。用户核对候选修改后由宿主应用。
需要用户决定时可用 protoflow_ask_questions 提供真实选项并等待回答。需要持续生成一整套页面时，可用 protoflow_set_project_plan 提交可执行方案；对已有方案的局部调整可用 protoflow_revise_project_page。合并并移除旧菜单须用明确的 merge 描述来源、目标弹层和展示方式，不能靠全量方案省略页面来暗示删除。先查明原有功能和关联。
对具体工作可以直接组合工具：例如调整多个页面、移动已有菜单、创建目录、修改表或便签；不需要先建整套方案。工程修改暂存在同一份候选快照，宿主展示变更供用户确认。只读回答不产生修改。不要声称未确认的操作已经执行。使用当前会话注册的工具名（可能带 MCP 前缀），不要依赖历史消息中的可用工具列表。
只有宿主明确发起已确认方案的单页生成时，才以本轮指定 pageId 为修改范围。读取 dependencyReview、上下游页面和真实来源键。单选引用字段用 returnSelection(表格pfId,显示字段,值字段)，来源行弹层的 Table.sourceForeignKey 指向当前明细表已声明的外键。新建关系后核查 databaseDesignReview 的 affectedRules，按当前来源更新已过时的结构说明，保留待接服务或待业务验证部分。完成可用的组件、交互与弹层并检查结果。${isEnLocale() ? '\nCurrent UI locale is English (en-US). Unless the user explicitly requests Chinese, write all chat replies, clarifying questions/options in protoflow_ask_questions, plan summaries/folder & page titles/requirements/acceptanceCases in protoflow_set_project_plan or protoflow_revise_project_page, project agreements, database cnName/comments, sticky notes, and generated page UI copy in idiomatic English.' : ''}`;
const instructions = buildProjectSharedInstructions;

export function projectPlanProgress() {
  const plan = useProtoStore.getState().projectPlan, sources = usePageStore.getState().pageSources;
  return plan ? plan.pages.filter(page => plan.generatedPageIds.includes(page.pageId) && Object.hasOwn(sources, page.pageId) && !pagePrototypeIssue(sources[page.pageId])).map(page => page.pageId) : [];
}
function assertProject(projectId: string) {
  const s = useProtoStore.getState();
  if (s.isProjectClosed || s.currentProjectMeta.projectId !== projectId) throw new Error(tr('项目已切换，任务已停止', 'Project switched; task stopped'));
}
async function task(projectId: string, work: (scope: HermesProjectConversation, check: () => void) => Promise<void>) {
  assertProject(projectId);
  if (pendingProjectAiTasks.has(projectId) || useHermesStore.getState().runningProjects[projectId]) throw new Error(tr('当前项目已有 AI 任务', 'An AI task is already running for this project'));
  const index = useAiChatStore.getState().loadProjectIndex(projectId);
  const scope = projectChatScope(projectId, index.activeId), key = conversationKey(scope);
  const cancellation = useHermesStore.getState().cancelGeneration[key];
  const check = () => { assertProject(projectId); if (useHermesStore.getState().cancelGeneration[key] !== cancellation) throw new Error(tr('已停止，已完成页面保留，可继续剩余页面', 'Stopped; completed pages preserved. You can resume the remaining pages.')); };
  pendingProjectAiTasks.add(projectId);
  useProjectWorkflow.setState(s => ({ running: { ...s.running, [projectId]: true }, runningChat:{ ...s.runningChat, [projectId]:key }, status: { ...s.status, [conversationKey(scope)]: tr('正在连接 AI…', 'Connecting to AI…') } }));
  try { await withAiBackgroundTask(scope, () => work(scope, check)); }
  catch (error) {
    void captureRuntimeError(error,{category:'ai',code:'PROJECT_WORKFLOW_FAILED',stage:'workflow',message:tr('项目工作流未完成', 'Project workflow did not complete'),context:scope});
    useProjectWorkflow.setState(s => ({ status: { ...s.status, [conversationKey(scope)]: error instanceof Error ? error.message : String(error) } })); throw error;
  }
  finally { pendingProjectAiTasks.delete(projectId); useProjectWorkflow.setState(s => ({ running: { ...s.running, [projectId]: false }, runningChat:{ ...s.runningChat, [projectId]:undefined } })); }
}
async function loadProjectTools(scope: HermesProjectConversation) {
  const session = await useHermesStore.getState().ensureSession(scope);
  if (!Array.isArray(session.projectTools)) throw new Error(tr('当前桌面进程仍使用旧版项目工具。请保存项目、完全退出并重新打开 Alex，再在原对话中重试。', 'Current desktop process is still using legacy project tools. Save your project, quit and reopen Alex, then retry in this conversation.'));
  if (!['protoflow_get_project_brief','protoflow_search_history','protoflow_upsert_project_agreement','protoflow_ask_questions','protoflow_revise_project_page','protoflow_set_project_plan','protoflow_move_sitemap_item','protoflow_apply_tsx_patch'].every(name => session.projectTools!.includes(name))) throw new Error(tr('Hermes 加载的项目工具不完整，请刷新当前会话后重试。', 'Hermes loaded an incomplete set of project tools. Refresh the current session and retry.'));
  return session;
}
type WarmPreparation = {
  api: ReturnType<typeof getHermesApi>;
  promise: ReturnType<typeof loadProjectTools>;
  setup?: Pick<ProjectSessionSetupEvent, 'created' | 'reloaded' | 'reused' | 'reloadReason'>;
};
const warmingSessions = new Map<string, WarmPreparation>();
const warmedSessions = new Map<string, { api: ReturnType<typeof getHermesApi>; sessionId: string; skillMarkdown: string }>();
registerChatPurgeHook((_projectId, key) => { warmedSessions.delete(key); warmingSessions.delete(key); });
function projectSkillMarkdown(session: Awaited<ReturnType<typeof loadProjectTools>>) {
  return instructions() + '\n本会话刚核验的 Alex 项目工具：' + session.projectTools!.join('、')
    + '。若工具延迟加载，先用 tool_search 搜索短名，再用返回的完整工具名调用；不要用过往会话的前缀。';
}
/** Prepare the same session/instructions used by a real turn, without asking the model or changing project data. */
export function warmProjectSession(scope: HermesProjectConversation) {
  const key = conversationKey(scope), api = getHermesApi();
  const pending = warmingSessions.get(key);
  if (pending?.api === api) return pending.promise;
  const state = useHermesStore.getState(), project = useProtoStore.getState();
  if (state.status !== 'running' || project.isProjectClosed || project.currentProjectMeta.projectId !== scope.projectId ||
      state.runningProjects[scope.projectId] || pendingProjectAiTasks.has(scope.projectId)) return Promise.resolve(null);
  const session = state.sessions[key], warmed = warmedSessions.get(key);
  if (session?.projectTools && warmed?.api === api && warmed.sessionId === session.sessionId && warmed.skillMarkdown === projectSkillMarkdown(session))
    return Promise.resolve(session);
  const checkPreparation = () => {
    assertProject(scope.projectId);
    if (getHermesApi() !== api || useHermesStore.getState().status !== 'running' || warmingSessions.get(key) !== entry)
      throw new Error(tr('AI 连接或会话已变化，请重试', 'AI connection or session changed; please retry'));
  };
  const prepare = async () => {
    const prepared = await loadProjectTools(scope);
    checkPreparation();
    const skillMarkdown = projectSkillMarkdown(prepared);
    const synced = await api.sync({ ...scope, skillMarkdown });
    if (!synced.synced) throw new Error(tr('项目指令同步失败', 'Failed to sync project instructions'));
    checkPreparation();
    // Adopt changed instructions now, rather than leaving the rebind on the user's first request.
    const ready = await loadProjectTools(scope);
    checkPreparation();
    // Foreground work waiting on this preparation must retain its cold-start/reload attribution.
    // The second session check alone would report a reuse and hide the first connection.
    const created = Boolean(prepared.lastSetup?.created || ready.lastSetup?.created || (!prepared.lastSetup && !session));
    const reloaded = Boolean(prepared.lastSetup?.reloaded || ready.lastSetup?.reloaded);
    entry.setup = { created, reloaded, reused: !created && !reloaded,
      reloadReason: ready.lastSetup?.reloadReason ?? prepared.lastSetup?.reloadReason ?? (created ? 'cold_connect' : null) };
    warmedSessions.set(key, { api, sessionId: ready.sessionId, skillMarkdown });
    return ready;
  };
  const promise = prepare();
  const entry: WarmPreparation = { api, promise };
  warmingSessions.set(key, entry);
  void promise.finally(() => { if (warmingSessions.get(key) === entry) warmingSessions.delete(key); }).catch(() => {});
  return promise;
}
async function ensureProjectTools(scope: HermesProjectConversation) {
  const pending = warmingSessions.get(conversationKey(scope));
  if (pending?.api === getHermesApi()) {
    // A failed background preparation must not make a real user request permanently fail.
    try { return await pending.promise; } catch { /* Real preflight below reports the current error. */ }
  }
  return loadProjectTools(scope);
}
async function prepareProjectToolsWithMetrics(
  scope: HermesProjectConversation,
  stage: ProjectSessionSetupEvent['stage'],
  targetPageId?: string,
): Promise<{ session: Awaited<ReturnType<typeof ensureProjectTools>>; event: ProjectSessionSetupEvent }> {
  const key = conversationKey(scope);
  const hadClientSession = Boolean(useHermesStore.getState().sessions[key]);
  const pendingWarm = warmingSessions.get(key);
  const joinedWarm = pendingWarm?.api === getHermesApi() ? pendingWarm : undefined;
  const startedAt = nowMs();
  const session = await ensureProjectTools(scope);
  const durationMs = roundMs(nowMs() - startedAt);
  // Only consult `session.lastSetup` when `ensureSession` actually fetched from IPC (`!hadClientSession`),
  // so cached renderer sessions do not re-read a stale `lastSetup` from an earlier cold connect.
  const runtimeSetup = joinedWarm?.setup ?? (!hadClientSession ? session.lastSetup : undefined);
  const created = runtimeSetup ? Boolean(runtimeSetup.created) : !hadClientSession;
  const reloaded = runtimeSetup ? Boolean(runtimeSetup.reloaded) : false;
  const reused = !created && !reloaded && (runtimeSetup ? Boolean(runtimeSetup.reused) : hadClientSession);
  const reloadReason = runtimeSetup
    ? runtimeSetup.reloadReason
    : !hadClientSession
      ? 'cold_connect'
      : null;
  return {
    session,
    event: {
      stage,
      ...(targetPageId !== undefined ? { targetPageId } : {}),
      durationMs,
      reused,
      reloaded,
      created,
      reloadReason,
    },
  };
}
function expectedTaskKeyForTurn(
  scope: HermesProjectConversation,
  phase: 'conversation' | 'generating',
  targetPageId?: string,
) {
  if (phase === 'generating' && typeof targetPageId === 'string' && targetPageId) {
    return JSON.stringify([scope.projectId, 'project-page-exec', scope.threadId ?? null, targetPageId]);
  }
  return conversationKey(scope);
}

function createClientRequestId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : newId('req');
}

function computeTransitiveBlockedPageIds(plan: ProjectPlan, failedIds: Iterable<string>) {
  const blocked = new Set<string>(failedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of plan.pages) {
      if (blocked.has(p.pageId)) continue;
      const depHit = (p.dependencies ?? []).some(d => blocked.has(d.sourcePageId));
      const mergeHit =
        plan.revision?.pageId === p.pageId &&
        plan.revision.merge !== undefined &&
        blocked.has(plan.revision.merge.sourcePageId);
      if (depHit || mergeHit) {
        blocked.add(p.pageId);
        changed = true;
      }
    }
  }
  return blocked;
}

async function turn(scope: HermesProjectConversation, prompt: string, phase: 'conversation' | 'generating', check: () => void,
  { targetPageId, images, mindmaps, originalText, contextFocus, requestedPage, inheritedSessionEvents, restartFromProject, rpMigration, figmaMigration }: { rpMigration?:{scope:AxureScope;readOnly:boolean}; figmaMigration?:{scope:FigmaScope;readOnly:boolean}; restartFromProject?: boolean; requestedPage?: RequestedPage; contextFocus?: {pageId?:string;folderId?:string}; originalText?: string; targetPageId?: string; images?: HermesImageAttachment[]; mindmaps?: ChatMindmap[]; inheritedSessionEvents?: ProjectSessionSetupEvent[] } = {}) {
  check();
  const readOnly = rpMigration?.readOnly ?? figmaMigration?.readOnly;
  const turnStartedAt = nowMs();
  const startedAtIso = new Date().toISOString();
  const chat = useAiChatStore.getState(), key = conversationKey(scope);
  const target = phase === 'generating' ? useProtoStore.getState().projectPlan?.pages.find(page => page.pageId === targetPageId) : undefined;
  if (phase === 'generating' && !target) throw new Error(tr('目标页面不在已确认方案内', 'Target page is not in the approved plan'));
  const priorMessage = phase === 'conversation' ? chat.byConversation[key]?.at(-1) : undefined;
  const priorDraft = priorMessage?.projectChangeReview;
  const priorDecision = priorMessage?.projectReviewDecision;
  chat.addMessage({ ...scope, role: phase === 'conversation' ? 'user' : 'assistant', text: target ? tr(`开始生成「${target.title}」。`, `Generating "${target.title}"…`) : (originalText ?? prompt), status: 'done', images, mindmaps });
  const replyId = chat.addMessage({ ...scope, role: 'assistant', text: tr('正在分析项目…', 'Analyzing project…'), status: 'pending' });
  const base = captureProjectPayload(), revision = projectRevision();
  const focus = targetPageId === undefined ? contextFocus : {pageId:targetPageId};
  const brief = projectExecutionBrief(base.stateSnapshot, focus);
  const requirementSources = databaseRequirementSources(base.stateSnapshot, useAiChatStore.getState().byConversation[key] ?? [], targetPageId);
  let outcome: ProjectTurnMetrics['outcome'] = 'error';
  let errorMessage: string | undefined;
  let diagnosticContext: DiagnosticContext = { ...scope, workflowPhase:phase, targetPageId };
  let diagnosticStage = 'session';
  const sessionEvents: ProjectSessionSetupEvent[] = [...(inheritedSessionEvents ?? [])];
  const batchPreflightMs = roundMs((inheritedSessionEvents ?? []).reduce((sum, ev) => sum + ev.durationMs, 0));
  let priorSetupCreated = false;
  let priorSetupReloaded = false;
  let priorSetupReason: string | null = null;
  let ensureToolsMs = 0;
  let syncMs = 0;
  let runtimeSessionSetupMs = 0;
  let contextBridgeSetupMs = 0;
  let firstOutputMs: number | null = null;
  let firstTextMs: number | null = null;
  let acpTurnMs = 0;
  let unattributedAcpMs = 0;
  let toolExecMs = 0;
  let nativeToolExecMs = 0;
  let userWaitMs = 0;
  let toolCallCount = 0;
  let failedToolCallCount = 0;
  let nativeToolCallCount = 0;
  let failedNativeToolCallCount = 0;
  let contextQueryCount = 0;
  let contextQueryMs = 0;
  let contextColdStarts = 0;
  const toolBreakdown: Record<string, HermesToolMetricSummary> = {};
  const nativeToolBreakdown: Record<string, HermesNativeToolMetricSummary> = {};
  let retryCount = 0;
  let retryMs = 0;
  let continuationUsed = false;
  let preservedCandidateOpCount = 0;
  let promptVerifyMs = 0;
  let hostValidationMs = 0;
  let applyChangesMs = 0;
  let saveFlushMs = 0;
  let initialPromptBytes = 0;
  let promptBytes = 0;
  let imageBytes = (images ?? []).reduce((sum, item) => sum + item.size, 0);
  let snapshotBytes = 0;
  let contextJsonBytes = 0;
  let skillBytes = 0;
  let activeExecuteStartedAt: number | null = null;
  let runModelInvocations = 0;
  let latestFootprint: DependencyFootprintV3 | undefined;
  let previous = '';
  let previousProgress = '';
  let stopPreviewEvents = () => {};
  useHermesStore.setState(s => ({ partial: { ...s.partial, [key]: '' } }));
  const unsubscribe = useHermesStore.subscribe(s => {
    if (activeExecuteStartedAt !== null) {
      if (firstOutputMs === null && ((s.partial[key] && s.partial[key] !== previous) || (s.progress[key] && s.progress[key] !== previousProgress && s.progress[key] !== 'Hermes 正在处理…' && s.progress[key] !== 'Hermes is working…'))) {
        firstOutputMs = roundMs(nowMs() - activeExecuteStartedAt);
      }
      if (firstTextMs === null && s.partial[key] && s.partial[key] !== previous) {
        firstTextMs = roundMs(nowMs() - activeExecuteStartedAt);
      }
    }
    previousProgress = s.progress[key] ?? '';
    if (s.partial[key] && s.partial[key] !== previous) { previous = s.partial[key]; chat.updateMessage(replyId, { text: previous }, { persist: false }); }
  });
  try {
    const ensureStartedAt = nowMs();
    let session;
    try {
      const preparedTools = await prepareProjectToolsWithMetrics(scope, 'turn_preflight', targetPageId);
      session = preparedTools.session;
      if (rpMigration) {
        const required = ['protoflow_inspect_axure_project','protoflow_inspect_page','protoflow_get_project'];
        if (!readOnly) required.push('protoflow_bind_axure_table','protoflow_optimize_axure_block','protoflow_upsert_db_table','protoflow_upsert_db_column');
        if (!required.every(tool => preparedTools.session.projectTools?.includes(tool)))
          throw new Error(tr('当前项目会话尚未加载 RP 迁移工具。请保存工程、重启更新后的 Alex，然后重试。', 'Current project session has not loaded RP migration tools. Save your project, restart the updated Alex app, and retry.'));
      }
      if (figmaMigration) {
        const required = ['protoflow_inspect_figma_project','protoflow_inspect_page','protoflow_get_project'];
        if (!readOnly) required.push('protoflow_reshape_figma_page','protoflow_upsert_db_table','protoflow_upsert_db_column');
        if (!required.every(tool => preparedTools.session.projectTools?.includes(tool)))
          throw new Error(tr('当前项目会话尚未加载 Figma 重构工具。请保存工程、重启更新后的 Alex，然后重试。', 'Current project session has not loaded Figma reshape tools. Save your project, restart the updated Alex app, and retry.'));
      }
      ensureToolsMs = preparedTools.event.durationMs;
      sessionEvents.push(preparedTools.event);
    } catch (ensureErr) {
      ensureToolsMs = roundMs(nowMs() - ensureStartedAt);
      throw ensureErr;
    }
    check();
    const skillMarkdown = projectSkillMarkdown(session);
    skillBytes = utf8Bytes(skillMarkdown);
    const syncStartedAt = nowMs();
    diagnosticContext.sessionId = session.sessionId;
    diagnosticStage = 'sync';
    const sync = await getHermesApi().sync({ ...scope, skillMarkdown });
    syncMs = roundMs(nowMs() - syncStartedAt);
    if (!sync.synced) throw new Error(tr('项目指令同步失败', 'Failed to sync project instructions'));
    check();
    const absorbExecuteMetrics = (
      execMetrics: import('./hermesClient').HermesExecuteMetrics | undefined,
      isRetry: boolean,
      wallClockMs: number,
      reqPromptBytes: number,
      reqSnapshotBytes: number,
    ) => {
      promptBytes += execMetrics?.promptBytes ?? reqPromptBytes;
      if (!isRetry) initialPromptBytes = execMetrics?.promptBytes ?? reqPromptBytes;
      snapshotBytes = Math.max(snapshotBytes, execMetrics?.snapshotBytes ?? reqSnapshotBytes);
      contextJsonBytes = Math.max(contextJsonBytes, execMetrics?.contextJsonBytes ?? 0);
      if (execMetrics?.skillBytes) skillBytes = execMetrics.skillBytes;
      if (execMetrics?.imageBytes) imageBytes = execMetrics.imageBytes;
      if (execMetrics) {
        runtimeSessionSetupMs = roundMs(runtimeSessionSetupMs + execMetrics.sessionSetupMs);
        contextBridgeSetupMs = roundMs(contextBridgeSetupMs + execMetrics.contextBridgeSetupMs);
        if (execMetrics.priorSessionSetup) {
          if (execMetrics.priorSessionSetup.created) priorSetupCreated = true;
          if (execMetrics.priorSessionSetup.reloaded) priorSetupReloaded = true;
          priorSetupReason = priorSetupReason ?? execMetrics.priorSessionSetup.reloadReason;
        }
        sessionEvents.push({
          stage: 'execute',
          ...(targetPageId !== undefined ? { targetPageId } : {}),
          durationMs: execMetrics.sessionSetupMs,
          reused: execMetrics.sessionReused,
          reloaded: execMetrics.sessionReloaded,
          created: execMetrics.sessionCreated,
          reloadReason: execMetrics.reloadReason,
        });
        if (!isRetry) {
          if (execMetrics.firstOutputMs !== null) firstOutputMs = execMetrics.firstOutputMs;
          if (execMetrics.firstTextMs !== null) firstTextMs = execMetrics.firstTextMs;
        }
        const turnAcpMs = execMetrics.acpTurnMs ?? 0;
        const turnToolMs = execMetrics.toolExecMs ?? 0;
        const turnNativeToolMs = execMetrics.nativeToolExecMs ?? 0;
        const turnWaitMs = execMetrics.userWaitMs ?? 0;
        const turnUnattributedMs =
          execMetrics.unattributedAcpMs ??
          roundMs(Math.max(0, turnAcpMs - turnToolMs - turnNativeToolMs - turnWaitMs));
        acpTurnMs = roundMs(acpTurnMs + turnAcpMs);
        unattributedAcpMs = roundMs(unattributedAcpMs + turnUnattributedMs);
        toolExecMs = roundMs(toolExecMs + turnToolMs);
        nativeToolExecMs = roundMs(nativeToolExecMs + turnNativeToolMs);
        userWaitMs = roundMs(userWaitMs + turnWaitMs);
        promptVerifyMs = roundMs(promptVerifyMs + execMetrics.promptVerifyMs);
        toolCallCount += execMetrics.toolCallCount;
        failedToolCallCount += execMetrics.failedToolCallCount;
        nativeToolCallCount += execMetrics.nativeToolCallCount ?? 0;
        failedNativeToolCallCount += execMetrics.failedNativeToolCallCount ?? 0;
        contextQueryCount += execMetrics.contextQueryCount ?? 0;
        contextQueryMs = roundMs(contextQueryMs + (execMetrics.contextQueryMs ?? 0));
        contextColdStarts += (execMetrics.contextColdStarts ?? 0) + (execMetrics.promptVerifyColdStart ? 1 : 0);
        mergeToolBreakdown(toolBreakdown, execMetrics.toolBreakdown);
        mergeNativeToolBreakdown(nativeToolBreakdown, execMetrics.nativeToolBreakdown);
      } else {
        acpTurnMs = roundMs(acpTurnMs + wallClockMs);
        unattributedAcpMs = roundMs(unattributedAcpMs + wallClockMs);
      }
      if (isRetry) {
        retryCount += 1;
        retryMs = roundMs(retryMs + wallClockMs);
      }
    };
    const runModel = async (
      request: string,
      options?: { snapshotPayload?: PflowBinaryPayload; continuation?: HermesExecutionContinuation },
    ) => {
      check();
      const isRetry = runModelInvocations > 0;
      if (isRetry && phase === 'generating') {
        if (latestFootprint?.version === 3) {
          const checkResult = verifyDependencyFootprint(
            { ...projectContext(requestedPage), requirementSources },
            latestFootprint,
          );
          if (!checkResult.ok) throw new Error(tr('项目内容已变化，请基于最新项目重试', 'Project content changed; please retry on the latest project'));
        } else if (projectRevision() !== revision) {
          throw new Error(tr('项目内容已变化，请基于最新项目重试', 'Project content changed; please retry on the latest project'));
        }
      } else if (projectRevision() !== revision) {
        throw new Error(tr('项目内容已变化，请基于最新项目重试', 'Project content changed; please retry on the latest project'));
      }
      runModelInvocations += 1;
      diagnosticContext = {...diagnosticContext,attempt:runModelInvocations-1,runId:undefined,checks:undefined,boundTableIds:undefined};
      const execSnapshot = {
        ...projectContext(requestedPage, options?.snapshotPayload),
        ...(rpMigration && { axureMigrationScope: rpMigration.scope }),
        ...(figmaMigration && { figmaMigrationScope: figmaMigration.scope }),
        requirementSources,
        ...(mindmaps?.length ? { selectedMindmapIds: mindmaps.map(m => m.mindmapId) } : {}),
      };
      const reqPromptBytes = utf8Bytes(request);
      const reqSnapshotBytes = utf8Bytes(JSON.stringify(execSnapshot));
      const priorLastMetrics = useHermesStore.getState().lastMetrics[key];
      stopPreviewEvents();
      useAiPreviewStore.getState().begin(scope, session.sessionId, execSnapshot.tableRows, Boolean(options?.continuation));
      let previewInvalidated = false;
      const validatePreview = () => {
        try {
          check();
          if (phase === 'generating' && latestFootprint?.version === 3) {
            const checkResult = verifyDependencyFootprint(
              { ...projectContext(requestedPage), requirementSources },
              latestFootprint,
            );
            if (!checkResult.ok) throw new Error('项目内容已变化');
          } else if (projectRevision() !== revision) {
            throw new Error('项目内容已变化');
          }
        } catch {
          previewInvalidated = true;
          useAiPreviewStore.getState().clear(scope);
        }
      };
      const clientRequestId = createClientRequestId();
      const expectedTaskKey = expectedTaskKeyForTurn(scope, phase, targetPageId);
      let registeredRun = null as { runId: string; execSessionId: string } | null;
      const offPreview = getHermesApi().onEvent(event => {
        if (
          event.kind !== 'project' ||
          event.projectId !== scope.projectId ||
          event.threadId !== scope.threadId ||
          event.pageId !== undefined ||
          event.mindmapId !== undefined ||
          !['run-start', 'page-preview'].includes(event.type)
        ) {
          return;
        }
        if (event.type === 'run-start') {
          const eventPlanningId = event.planningSessionId ?? event.sessionId;
          const eventExecId = event.execSessionId ?? event.sessionId;
          if (
            registeredRun !== null ||
            event.clientRequestId !== clientRequestId ||
            eventPlanningId !== session.sessionId ||
            event.taskKey !== expectedTaskKey ||
            typeof event.runId !== 'string' ||
            !event.runId ||
            typeof eventExecId !== 'string' ||
            !eventExecId ||
            event.sessionId !== eventExecId ||
            (phase !== 'generating' && eventExecId !== session.sessionId)
          ) {
            return;
          }
          registeredRun = { runId: event.runId, execSessionId: eventExecId };
          diagnosticContext.runId = event.runId;
          validatePreview();
          if (!previewInvalidated) useAiPreviewStore.getState().receive(event);
          return;
        }
        if (
          previewInvalidated ||
          registeredRun === null ||
          event.runId !== registeredRun.runId ||
          event.sessionId !== registeredRun.execSessionId ||
          (event.execSessionId ?? event.sessionId) !== registeredRun.execSessionId
        ) {
          return;
        }
        validatePreview();
        if (!previewInvalidated) useAiPreviewStore.getState().receive(event);
      });
      const offPages = usePageStore.subscribe((next, prev) => {
        if (next.pageSources !== prev.pageSources || next.designerPages !== prev.designerPages || next.designerFolders !== prev.designerFolders ||
            next.sitemapBase !== prev.sitemapBase || next.sitemapOverrides !== prev.sitemapOverrides ||
            next.compositeBlocks !== prev.compositeBlocks || next.tableRows !== prev.tableRows) validatePreview();
      });
      const offProject = useProtoStore.subscribe((next, prev) => {
        if (next.currentProjectMeta !== prev.currentProjectMeta || next.isProjectClosed !== prev.isProjectClosed || next.dbTables !== prev.dbTables ||
            next.stickyNotes !== prev.stickyNotes || next.projectPlan !== prev.projectPlan || next.projectAgreements !== prev.projectAgreements ||
            next.databaseRequirements !== prev.databaseRequirements || next.closedLoopIssues !== prev.closedLoopIssues ||
            next.mindmaps !== prev.mindmaps || next.widgets !== prev.widgets) validatePreview();
      });
      stopPreviewEvents = () => { offPreview(); offPages(); offProject(); };
      const execStartedAt = nowMs();
      if (!isRetry) activeExecuteStartedAt = execStartedAt;
      let result;
      try {
        diagnosticStage = 'execute';
        result = await getHermesApi().execute({
          ...scope,
          clientRequestId,
          workflowPhase: phase,
          ...(readOnly && {readOnly:true}),
          targetPageId,
          contextFocus: focus,
          snapshot: execSnapshot,
          ...(phase === 'generating'
            ? {
                recoveryRevisionVersion: 3 as const,
                recoverDraft: !isRetry,
                archiveDraft: !isRetry && restartFromProject === true,
              }
            : {}),
          ...(options?.continuation ? { continuation: options.continuation } : {}),
          prompt: request,
          images,
        });
      } catch (execError) {
        const wallClockMs = roundMs(nowMs() - execStartedAt);
        activeExecuteStartedAt = null;
        const latestMetrics = useHermesStore.getState().lastMetrics[key];
        absorbExecuteMetrics(
          latestMetrics && latestMetrics !== priorLastMetrics ? latestMetrics : undefined,
          isRetry,
          wallClockMs,
          reqPromptBytes,
          reqSnapshotBytes,
        );
        throw execError;
      } finally {
        offPreview();
      }
      const wallClockMs = roundMs(nowMs() - execStartedAt);
      activeExecuteStartedAt = null;
      if (result.metrics) {
        useHermesStore.setState(s => ({ lastMetrics: { ...s.lastMetrics, [key]: result.metrics! } }));
      }
      absorbExecuteMetrics(result.metrics, isRetry, wallClockMs, reqPromptBytes, reqSnapshotBytes);
      check();
      if (
        registeredRun === null ||
        result.clientRequestId !== clientRequestId ||
        result.runId !== registeredRun.runId ||
        result.sessionId !== registeredRun.execSessionId ||
        result.execSessionId !== registeredRun.execSessionId ||
        result.planningSessionId !== session.sessionId ||
        result.taskKey !== expectedTaskKey ||
        (phase !== 'generating' && registeredRun.execSessionId !== session.sessionId)
      ) {
        throw new Error(tr('AI 返回了其他会话或未登记轮次的结果', 'AI returned output from another session or unregistered turn'));
      }
      if (sync.skillDigest && result.skillDigest && result.skillDigest !== sync.skillDigest) {
        throw new Error(tr('项目会话尚未加载最新指令，请刷新当前会话后重试', 'Project session has not loaded the latest instructions; refresh the session and retry'));
      }
      if (result.dependencyFootprint?.version === 3) {
        latestFootprint = result.dependencyFootprint;
      }
      diagnosticContext = {...diagnosticContext,runId:result.runId,sessionId:result.sessionId,modelId:result.modelId};
      if (result.recoveredDraft) continuationUsed = true;
      diagnosticStage = 'validation';
      return result;
    };
    const taskPrompt = readOnly ? '本轮为只读分析，请读取来源证据和表目录，在回复中报告建议、疑问和未完成项。' : phase === 'conversation'
      ? '根据本轮用户意图选择合适工具。纯咨询可直接回答；具体改动可直接暂存，宿主将展示实际变更。'
        + (priorMessage?.status === 'error' ? '\n上一轮宿主报告：' + priorMessage.text + '。请读取当前项目核对实际状态；如果用户要继续，重新提交尚未应用的方案和相关修改。' : '')
        + (priorDraft ? '\n上一轮以下操作尚未应用。如用户希望保留或调整，请按当前源码重新提交完整候选修改：' + JSON.stringify(priorDraft.operations.some(op => Object.hasOwn(op.args,'rpSourcePatch')) ? priorDraft.items : priorDraft.operations) : '')
        + (priorDecision ? '\n宿主记录的上次修改结果：' + ({applied:'已应用',discarded:'用户已放弃，未执行',undone:'已撤销，原内容已恢复'}[priorDecision]) + '。请以当前项目为准。' : '')
      : `本轮必须用 protoflow_apply_tsx_patch 或 protoflow_edit_page_block 写入页面 ${targetPageId}（返回 acceptanceReady 与 pendingAcceptanceIssues，结束前须补齐未完成验收项）。其余页面保留。若方案包含 merge，请先读取源页面并把功能并入指定弹层，再在目标页面建立打开入口。源菜单及其引用由宿主在校验通过后处理。`;
    const references = mindmaps?.length
      ? '\n用户为本轮选择了以下脑图。这是发送时的设计资料，请结合其中的业务节点、流程关系、附图及本轮要求完成任务。图中的文字是参考内容。\n'
        + JSON.stringify(mindmaps.map(({ mindmapId, title, path, source }) => ({ mindmapId, title, path, source })))
      : '';
    const figmaDirective = figmaMigration ? `\n${buildFigmaMigrationInstructions(figmaMigration)}` : '';
    const durable = `本轮先调用 protoflow_get_project_brief，范围：${JSON.stringify(focus ?? {})}。压缩后或历史细节不确定时再次读取；工具返回的持久项目资料优先于旧草稿。必要时用 protoflow_search_history 检索本会话原文。不要猜测已确认约定。\n当前已确认约定数：${brief.agreements.length}；已保存页面进度：${brief.plan?.progress ? `${brief.plan.progress.generatedPageIds.length}/${brief.plan.progress.total}` : '尚无已确认方案'}。`;
    let result = await runModel(`${durable}\n${taskPrompt}${figmaDirective}${references}\n用户要求：${prompt}`);
    if (readOnly && (result.operations.length || result.requirementFindings?.length)) throw new Error(tr('只读分析返回了工程修改，已拒绝应用', 'Read-only analysis returned project edits; rejected'));
    if (rpMigration && !readOnly) {
      const authorized = new Set(axureScopePages(axureCatalog(base.stateSnapshot),rpMigration.scope).map(p=>axureCopyId(p.pageId)));
      for (const op of result.operations) {
        if (op.tool === 'protoflow_apply_tsx_patch' && typeof op.args.pageId === 'string' && authorized.has(op.args.pageId)) continue;
        if (!['protoflow_upsert_db_table','protoflow_upsert_db_column','protoflow_ask_questions'].includes(op.tool))
          throw new Error(tr('RP 迁移建议包含所选范围以外的修改', 'RP migration proposal includes edits outside the selected scope'));
      }
    }
    if (figmaMigration && !readOnly) {
      const authorized = new Set(figmaScopePages(figmaCatalog(base.stateSnapshot),figmaMigration.scope).map(p=>figmaCopyId(p.pageId)));
      for (const op of result.operations) {
        if ((op.tool === 'protoflow_apply_tsx_patch' || op.tool === 'protoflow_edit_page_block') && typeof op.args.pageId === 'string' && authorized.has(op.args.pageId)) continue;
        if (!['protoflow_upsert_db_table','protoflow_upsert_db_column','protoflow_ask_questions'].includes(op.tool))
          throw new Error(tr('Figma 重构建议包含所选范围以外的修改', 'Figma reshape proposal includes edits outside the selected scope'));
      }
    }
    let activeRequirementFindings: RequirementSubmission[] | undefined = result.requirementFindings;
    const records = () => collectRequirementRecords(requirementSources, activeRequirementFindings, base.stateSnapshot.databaseRequirements);
    if (phase === 'conversation') {
      const question = result.operations.find(op => op.tool === 'protoflow_ask_questions');
      if (question) {
        const valStartedAt = nowMs();
        let questions;
        try {
          if (result.operations.length !== 1) throw new Error(tr('请先提交问题，等待用户回答后再调整方案', 'Submit questions first and wait for user answers before revising the plan'));
          questions = question.args.questions;
          validateProjectQuestions(questions);
          if (projectRevision() !== revision) throw new Error(tr('项目内容已变化，请基于最新项目重试', 'Project content changed; please retry on the latest project'));
        } finally {
          hostValidationMs = roundMs(hostValidationMs + (nowMs() - valStartedAt));
        }
        chat.updateMessage(replyId, { status: 'done', text: result.text.trim() || tr('请确认下方问题。', 'Please confirm the questions below.'), projectQuestions: questions,
          ...(rpMigration && { rpQuestionScope: rpMigration.scope }),
          ...(figmaMigration && { figmaQuestionScope: figmaMigration.scope }) });
        outcome = 'questions';
        return 'questions';
      }
      // An older connected tool can return the whole edit history of the draft.
      result = { ...result, operations: finalProjectDraftOperations(result.operations) };
      const reviewOnly = !result.operations.length && !!result.requirementFindings?.length;
      if (reviewOnly || result.operations.some(op => !['protoflow_set_project_plan', 'protoflow_revise_project_page'].includes(op.tool))) {
        const valStartedAt = nowMs();
        let prepared;
        let review;
        try {
          const collectedRecords = records();
          prepared = prepareProjectChanges(base, result.operations, undefined, undefined, true, collectedRecords, requestedPage);
          if (rpMigration) for (const table of prepared.next.stateSnapshot.dbTables)
            checkRpTableExtension(base.stateSnapshot.dbTables.find(t=>t.id === table.id),table);
          const existingIssues = new Set(analyzeProject(base.stateSnapshot).issues);
          const introduced = analyzeProject(prepared.next.stateSnapshot).issues.filter(issue => !existingIssues.has(issue));
          if (introduced.length) throw new Error(tr('本次修改会产生无效的项目关联：' + introduced.slice(0,4).join('；'), 'Proposed edits introduce invalid project references: ' + introduced.slice(0,4).join('; ')));
          review = {
            ...(requestedPage && { requestedPage }),
            baseDigest: await revisionDigest(revision),
            operations: await compactRpReview(base.stateSnapshot.pageSources, result.operations, revisionDigest),
            requirementRecords: collectedRecords,
            items: [...(reviewOnly ? [tr('保存需求原文与数据库约束的核对结果', 'Save requirement source & database constraint verification')] : []), ...describeChanges(base.stateSnapshot, prepared.next.stateSnapshot, result.operations, prepared.mergedSourceId, rpMigration?.scope), ...prepared.databaseRisks.map(risk => tr(`数据模型待复核 · ${risk}`, `Data model review needed · ${risk}`))],
          };
        } finally {
          hostValidationMs = roundMs(hostValidationMs + (nowMs() - valStartedAt));
        }
        check();
        if (projectRevision() !== revision) throw new Error(tr('讨论期间工程已修改，请基于当前版本重试', 'Project changed during discussion; please retry on the current version'));
        chat.updateMessage(replyId, { status:'done', text: result.text.trim() || tr('请查看本次改动。', 'Please review the proposed changes.'), viaHermes:true,
          sessionId:session.sessionId, modelId:result.modelId, projectChangeReview:review, requirementAudit:prepared.requirementAudit });
        outcome = 'review';
        return 'review';
      }
    } else {
      const initialBaseline: NonNullable<HermesExecutionContinuation['initialBaseline']> = {
        pageIds: Object.keys(base.stateSnapshot.pageSources ?? {}),
        stickyOwners: Object.fromEntries((base.stateSnapshot.stickyNotes ?? []).map(st => [st.id, st.pageId])),
        tableRowIds: Object.keys(base.stateSnapshot.tableRows ?? {}),
        validationBase: {
          projectPlan: structuredClone(base.stateSnapshot.projectPlan ?? null),
          pageSources: { ...(base.stateSnapshot.pageSources ?? {}) },
          dbTables: structuredClone(base.stateSnapshot.dbTables ?? []),
          mindmaps: base.stateSnapshot.mindmaps ?? { nodes: [], links: [] },
          stickyNotes: structuredClone(base.stateSnapshot.stickyNotes ?? []),
          closedLoopIssues: structuredClone(base.stateSnapshot.closedLoopIssues ?? []),
          designerPages: structuredClone(base.stateSnapshot.designerPages ?? []),
          sitemapBase: base.stateSnapshot.sitemapBase ?? [],
        },
      };
      let candidateOperations: HermesOperation[] = [];
      let candidateRequirementFindings: RequirementSubmission[] = [];
      for (let attempt = 0; ; attempt++) {
        const valStartedAt = nowMs();
        let diagnostic = '';
        let prepareFailure: unknown = null;
        try {
          if (
            result.operations.some(
              op =>
                !['protoflow_apply_tsx_patch', 'protoflow_add_preview_scenario', 'protoflow_upsert_db_table', 'protoflow_upsert_db_column', 'protoflow_upsert_sticky_contract'].includes(op.tool) ||
                (op.tool === 'protoflow_apply_tsx_patch' && op.args.pageId !== targetPageId) ||
                (op.tool === 'protoflow_upsert_sticky_contract' &&
                  ((op.args.sticky as { id?: string; pageId?: string })?.pageId !== targetPageId ||
                    base.stateSnapshot.stickyNotes.some(
                      st => st.id === (op.args.sticky as { id?: string })?.id && st.pageId !== targetPageId,
                    ))),
            )
          ) {
            throw new Error(tr('返回操作超出当前页面生成范围', 'Returned operation exceeds the current page generation scope'));
          }
          if (attempt > 0 && result.continuationMerged) {
            candidateOperations = result.operations;
            candidateRequirementFindings = result.requirementFindings ?? [];
          } else {
            candidateOperations = [...candidateOperations, ...result.operations];
            if (result.requirementFindings?.length) {
              const incomingIds = new Set(result.requirementFindings.map(item => item.sourceId));
              candidateRequirementFindings = [
                ...candidateRequirementFindings.filter(item => !incomingIds.has(item.sourceId)),
                ...result.requirementFindings,
              ];
            }
          }
          activeRequirementFindings = candidateRequirementFindings.length
            ? candidateRequirementFindings
            : undefined;
          result = {
            ...result,
            operations: candidateOperations,
            ...(activeRequirementFindings ? { requirementFindings: activeRequirementFindings } : {}),
          };
          try {
            const prepared = prepareProjectChanges(base, candidateOperations, undefined, undefined, false, records(), requestedPage);
            if (!targetPageId || !prepared.changedPages.includes(targetPageId)) {
              diagnostic = tr('本轮未收到目标页面的写入操作', 'No write operation received for the target page in this turn');
            } else {
              diagnostic = pagePrototypeIssue(prepared.next.stateSnapshot.pageSources[targetPageId]);
              if (!diagnostic) {
                diagnostic = generationEvidenceIssues(prepared.next.stateSnapshot, [targetPageId]).join(tr('；', '; '));
              }
              if (!diagnostic && prepared.requirementAudit.conflicts.length) {
                diagnostic = tr('需求正反例与表约束冲突：' + prepared.requirementAudit.conflicts.join('；'), 'Requirement examples conflict with table constraints: ' + prepared.requirementAudit.conflicts.join('; '));
              }
            }
            if (diagnostic && targetPageId) {
              try { diagnosticContext = {...diagnosticContext,...projectDiagnosticContext(prepared.next.stateSnapshot,targetPageId)}; } catch { /* Diagnostic inspection must not change validation behavior. */ }
            }
          } catch (prepErr) {
            prepareFailure = prepErr;
            diagnostic = prepErr instanceof Error ? prepErr.message : String(prepErr);
            if (targetPageId) {
              try { const candidate=stageGeneratingCandidate(base,candidateOperations,records(),targetPageId,requestedPage);
                diagnosticContext={...diagnosticContext,...projectDiagnosticContext(candidate.stateSnapshot,targetPageId)};
              } catch { /* A candidate that violates the material contract cannot be inspected as a valid page. */ }
            }
          }
        } finally {
          hostValidationMs = roundMs(hostValidationMs + (nowMs() - valStartedAt));
        }
        if (!diagnostic) break;
        diagnosticStage = 'validation';
        diagnosticContext.attempt = attempt;
        if (attempt > 0) {
          const validationEnvelope: HermesFailureEnvelope = {
            code: 'PAGE_VALIDATION_FAILED',
            failureScope: 'page',
            terminalConfirmed: true,
            candidateStatus: 'available',
            ...(targetPageId ? { targetPageId } : {}),
          };
          const finalErr =
            prepareFailure instanceof Error
              ? prepareFailure
              : new Error(
                  prepareFailure
                    ? String(prepareFailure)
                    : tr(
                        `AI 没有生成有效页面「${target?.title}」：${diagnostic}。可在右侧单独重试此页。${result.text.trim() ? ' AI 回复：' + result.text.trim().slice(0, 400) : ''}`,
                        `AI did not generate a valid page "${target?.title}": ${diagnostic}. You can retry this page individually on the right.${result.text.trim() ? ' AI reply: ' + result.text.trim().slice(0, 400) : ''}`,
                      ),
                );
          (finalErr as Error & { failureEnvelope?: HermesFailureEnvelope }).failureEnvelope = validationEnvelope;
          throw finalErr;
        }
        let candidatePayload: PflowBinaryPayload | undefined;
        let continuation: HermesExecutionContinuation | undefined;
        if (candidateOperations.length > 0 || candidateRequirementFindings.length > 0) {
          try {
            candidatePayload = stageGeneratingCandidate(base, candidateOperations, records(), targetPageId, requestedPage);
            continuation = {
              sourceRunId: result.runId,
              operations: candidateOperations,
              ...(candidateRequirementFindings.length ? { requirementFindings: candidateRequirementFindings } : {}),
              initialBaseline,
            };
            continuationUsed = true;
            preservedCandidateOpCount = candidateOperations.length;
          } catch {
            candidatePayload = undefined;
            continuation = undefined;
            candidateOperations = [];
            candidateRequirementFindings = [];
            activeRequirementFindings = undefined;
          }
        }
        result = await runModel(
          continuation
            ? `${durable}\n${taskPrompt}\n上一轮候选修改已保留在当前工作区（含已暂存的表结构、演示数据、需求便签、核对记录及目标页面草稿，尚未正式提交）。待补齐项：${diagnostic}。请先读取项目摘要核对约定与已暂存项，再读取当前候选源码和已确认需求，优先用 protoflow_edit_page_block（或按需补表/字段/演示数据/便签）直接增量完成实际修改，无需重复创建已暂存的表与数据。\n${prompt}`
            : `${durable}\n${taskPrompt}\n上一轮：${diagnostic}。该轮操作未应用，请先读取项目摘要核对约定，再读取当前源码和已确认需求，完成实际修改。\n${prompt}`,
          continuation ? { snapshotPayload: candidatePayload, continuation } : undefined,
        );
      }
    }
    if (!result.text.trim() && !result.operations.length) throw new Error(tr('AI 未返回回复或修改', 'AI returned neither a reply nor project edits'));
    const merge = phase === 'generating' && base.stateSnapshot.projectPlan?.revision?.merge;
    let summary = result.text.trim() || tr('已保存项目修改', 'Saved project changes');
    let requirementAudit;
    const applyStartedAt = nowMs();
    try {
      if (result.operations.length) {
        diagnosticStage = 'apply';
        const applied = applyProjectChanges(
          base,
          revision,
          result.operations,
          undefined,
          merge ? result.runId : undefined,
          targetPageId,
          false,
          records(),
          requestedPage,
          phase === 'generating' && result.dependencyFootprint?.version === 3
            ? { dependencyFootprint: result.dependencyFootprint, requirementSources }
            : undefined,
        );
        requirementAudit = applied.requirementAudit;
        if (applied.databaseRisks.length) summary += '\n\n' + tr('数据模型待复核', 'Data Model Review Needed') + '\n' + applied.databaseRisks.join('\n');
      } else if (projectRevision() !== revision) throw new Error(tr('讨论期间项目已变化，请基于最新项目重试', 'Project changed during discussion; please retry on the latest project'));
    } finally {
      applyChangesMs = roundMs(applyChangesMs + (nowMs() - applyStartedAt));
    }
    const flushStartedAt = nowMs();
    diagnosticStage = 'save';
    try {
      await flushProjectChanges();
    } finally {
      saveFlushMs = roundMs(saveFlushMs + (nowMs() - flushStartedAt));
    }
    check();
    chat.updateMessage(replyId, { status: 'done', text: summary, requirementAudit, ...(merge ? {changeId: result.runId, changedDoc: true} : {}), viaHermes: true, engineBadge: `Hermes · ${result.modelId}`, sessionId: result.planningSessionId ?? result.sessionId, modelId: result.modelId });
    if (phase === 'generating' && targetPageId) {
      // Only acknowledge after host validation AND durable project flush.
      // Failure to tidy a checkpoint cannot undo a successfully saved page;
      // completeRecovery never re-validates WriteSet preimages after commit.
      await getHermesApi().completeRecovery?.({ ...scope, workflowPhase: 'generating', targetPageId, runId: result.runId }).catch(() => {});
    }
    outcome = result.operations.length ? 'applied' : 'answer';
    return outcome;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    void captureRuntimeError(error,{category:'ai',code:diagnosticStage==='validation'?'AI_GENERATION_REJECTED':'AI_TURN_FAILED',stage:diagnosticStage,
      message:tr('项目 AI 任务未完成', 'Project AI task did not complete'),context:{...diagnosticContext,durationMs:roundMs(nowMs()-turnStartedAt),toolCallCount,failedToolCallCount}})
      .then(id=>{if(id)chat.updateMessage(replyId,{diagnosticId:id});});
    chat.updateMessage(replyId, { status: 'error', text: errorMessage }); throw error;
  } finally {
    unsubscribe();
    stopPreviewEvents();
    useAiPreviewStore.getState().clear(scope);
    const totalTurnMs = roundMs(nowMs() - turnStartedAt);
    const sessionSetupMs = roundMs(ensureToolsMs + syncMs + runtimeSessionSetupMs + contextBridgeSetupMs);
    const sessionCreated = sessionEvents.some(e => e.created) || priorSetupCreated;
    const sessionReloaded = sessionEvents.some(e => e.reloaded) || priorSetupReloaded;
    const sessionReused = !sessionCreated && !sessionReloaded && sessionEvents.some(e => e.reused);
    const reloadReason = sessionEvents.find(e => e.reloadReason)?.reloadReason ?? priorSetupReason ?? null;
    const validationMs = roundMs(promptVerifyMs + hostValidationMs);
    const turnMetrics: ProjectTurnMetrics = {
      metricId: newId('tm'),
      projectId: scope.projectId,
      conversationKey: key,
      phase,
      ...(targetPageId !== undefined ? { targetPageId } : {}),
      outcome,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      startedAt: startedAtIso,
      totalTurnMs,
      sessionSetupMs,
      batchPreflightMs,
      ensureToolsMs,
      syncMs,
      runtimeSessionSetupMs,
      contextBridgeSetupMs,
      sessionCreated,
      sessionReloaded,
      sessionReused,
      reloadReason,
      sessionEvents,
      firstOutputMs,
      firstTextMs,
      acpTurnMs,
      unattributedAcpMs,
      toolExecMs,
      nativeToolExecMs,
      userWaitMs,
      toolCallCount,
      failedToolCallCount,
      nativeToolCallCount,
      failedNativeToolCallCount,
      toolBreakdown,
      nativeToolBreakdown,
      contextQueryCount,
      contextQueryMs,
      contextColdStarts,
      retryCount,
      retryMs,
      continuationUsed,
      preservedCandidateOpCount,
      validationMs,
      promptVerifyMs,
      hostValidationMs,
      applyChangesMs,
      saveFlushMs,
      initialPromptBytes,
      promptBytes,
      imageBytes,
      snapshotBytes,
      contextJsonBytes,
      skillBytes,
    };
    recordTurnMetrics(key, turnMetrics);
  }
}
export async function discussProject(projectId: string, prompt: string, files: ChatImageDraft[] = [], mindmapIds: string[] = [], contextFocus?: {pageId?:string;folderId?:string}, requestedPage?: RequestedPage, rpMigration?:{scope:AxureScope; readOnly:boolean}, figmaMigration?:{scope:FigmaScope; readOnly:boolean}) {
  if (!prompt.trim() && !files.length && !mindmapIds.length) throw new Error(tr('请输入项目需求，或添加脑图、参考图片', 'Enter project requirements, or attach a mindmap or reference images'));
  return task(projectId, async (scope, check) => {
    const existingPlan = useProtoStore.getState().projectPlan;
    const latest = useAiChatStore.getState().byConversation[conversationKey(scope)]?.at(-1);
    if (!rpMigration && !figmaMigration && !files.length && !mindmapIds.length && !contextFocus && isResumeCommand(prompt) && existingPlan?.approved &&
        !latest?.projectQuestions && !latest?.projectChangeReview && !existingPlan.discussionPending) {
      useAiChatStore.getState().addMessage({ ...scope, role:'user', status:'done', text:prompt });
      return generatePlanPages(scope, check);
    }
    const mindmaps = mindmapIds.length ? captureChatMindmaps(projectId, useProtoStore.getState().mindmaps, mindmapIds) : undefined;
    const images = files.length ? await saveChatImages(scope, files) : undefined;
    check();
    const old = useProtoStore.getState().projectPlan;
    if (!rpMigration && !figmaMigration && old && !old.discussionPending) {
      useProtoStore.setState({ projectPlan: { ...old, discussionPending:true } });
      await flushProjectChanges(); check();
    }
    const defaultPrompt = mindmaps
      ? tr('请根据所选脑图和随附资料，规划项目的目录、菜单和页面原型，给出生成方案。', 'Based on the selected mindmaps and attached materials, plan the project folders, menus, and page prototypes and propose a generation plan.')
      : tr('请结合当前项目分析这些参考图片。', 'Analyze these reference images in the context of the current project.');
    const outcome = await turn(scope, prompt.trim() || defaultPrompt, 'conversation', check, { images, mindmaps, originalText:prompt, contextFocus, requestedPage, rpMigration, figmaMigration });
    const message = outcome === 'questions' ? tr('等待你回答问题', 'Waiting for your answers') : outcome === 'review' ? tr('已准备修改，等待你查看并应用。', 'Changes prepared; waiting for your review.')
      : outcome === 'answer' ? tr('本轮没有提交工程修改。', 'No project changes submitted in this turn.') : tr('已收到新方案，请确认生成范围。', 'New plan received; please confirm the generation scope.');
    useProjectWorkflow.setState(s => ({ status: { ...s.status, [conversationKey(scope)]: message } }));
  });
}
/** Only the latest, visible proposal can be accepted, against its original project state. */
export async function resolveProjectReview(projectId: string, messageId: string, accept: boolean) {
  return task(projectId, async (scope, check) => {
    const chat = useAiChatStore.getState(), key = conversationKey(scope);
    const latest = () => useAiChatStore.getState().byConversation[key]?.at(-1);
    const m = latest(), review = m?.projectChangeReview;
    if (!m || m.id !== messageId || !review) throw new Error(tr('该修改建议已被新的对话取代', 'This change proposal has been superseded by a newer message'));
    const generate = accept && includesPlanAndSchema(review.operations);
    const inheritedEvents: ProjectSessionSetupEvent[] = [];
    if (accept) {
      if (generate) {
        const reviewPreflight = await prepareProjectToolsWithMetrics(scope, 'review_preflight');
        inheritedEvents.push(reviewPreflight.event);
        check();
      }
      const revision = projectRevision(), base = captureProjectPayload();
      if (await revisionDigest(revision) !== review.baseDigest) throw new Error(tr('提出修改后工程已变化，请让 AI 按当前工程重新调整。', 'Project changed after this proposal was created; ask AI to revise based on the current project.'));
      check();
      const operations = await expandRpReview(base.stateSnapshot.pageSources,review.operations,revisionDigest);
      check();
      if (latest()?.id !== messageId) throw new Error(tr('该修改建议已被新的对话取代', 'This change proposal has been superseded by a newer message'));
      applyProjectChanges(base, revision, operations, undefined, messageId, undefined, true, review.requirementRecords, review.requestedPage);
    }
    const acceptedPlan = generate ? useProtoStore.getState().projectPlan : null;
    const message = generate ? tr('已确认方案，目录、菜单和数据表已就绪。', 'Plan confirmed; folders, menus, and tables are ready.') : accept ? tr('已应用本次修改。', 'Changes applied.') : tr('已放弃本次修改。', 'Changes discarded.');
    chat.updateMessage(m.id, {projectChangeReview:undefined, projectReviewDecision:accept ? 'applied' : 'discarded', text:m.text + '\n\n' + message, ...(accept ? {changeId:messageId, changedDoc:true} : {})});
    await flushProjectChanges(); check();
    useProjectWorkflow.setState(s => ({status:{...s.status,[conversationKey(scope)]:message}}));
    if (generate) {
      if (useProtoStore.getState().projectPlan !== acceptedPlan) throw new Error(tr('方案已变化，请重新确认生成范围', 'Plan changed; please reconfirm the generation scope'));
      await generatePlanPages(scope, check, undefined, inheritedEvents);
    }
  });
}
export async function resumePriorPlan(projectId: string) {
  return task(projectId, async (scope, check) => {
    const plan = useProtoStore.getState().projectPlan;
    const last = useAiChatStore.getState().byConversation[conversationKey(scope)]?.at(-1);
    if (!plan?.discussionPending || last?.projectChangeReview) throw new Error(tr('请先处理当前建议', 'Please resolve the current proposal first'));
    const {discussionPending, ...prior} = plan;
    useProtoStore.setState({projectPlan:prior});
    useAiChatStore.getState().addMessage({...scope,role:'user',status:'done',text:tr('沿用原方案。', 'Keep original plan.')});
    await flushProjectChanges(); check();
    useProjectWorkflow.setState(s => ({status:{...s.status,[conversationKey(scope)]:tr('已恢复原方案。', 'Original plan restored.')}}));
  });
}
export async function generateProject(
  projectId: string,
  onlyPageId?: string,
  options?: { restartFromProject?: boolean; restartPageId?: string },
) {
  return task(projectId, (scope, check) =>
    generatePlanPages(scope, check, onlyPageId, [], options?.restartFromProject, options?.restartPageId),
  );
}
async function generatePlanPages(
  scope: HermesProjectConversation,
  check: () => void,
  onlyPageId?: string,
  inheritedEvents: ProjectSessionSetupEvent[] = [],
  restartFromProject = false,
  restartPageId?: string,
) {
  const batchStartedAt = nowMs();
  const batchStartedIso = new Date().toISOString();
  const { projectId } = scope;
  const key = conversationKey(scope);
  const plan = useProtoStore.getState().projectPlan;
  if (!plan) throw new Error(tr('请先通过需求对话形成项目方案', 'Create a project plan via project chat first'));
  validateProjectPlan(plan);
  if (plan.discussionPending) throw new Error(tr('正在讨论新的要求，原方案已暂停。请先确认新方案或明确沿用原方案。', 'New requirements are under discussion and the original plan is paused. Confirm the new plan or restore the original plan first.'));
  if (onlyPageId !== undefined && !plan.approved) throw new Error(tr('请先确认方案', 'Please confirm the plan first'));
  if (onlyPageId !== undefined && plan.revision && onlyPageId !== plan.revision.pageId) throw new Error(tr('此页不在本轮调整范围', 'This page is outside the current revision scope'));
  const targetId = onlyPageId ?? plan.revision?.pageId;
  const initialWorkPages = targetId === undefined ? pageGenerationOrder(plan.pages, projectPlanProgress()) : plan.pages.filter(page => page.pageId === targetId);
  if (!initialWorkPages.length) throw new Error(tr('待生成页面已不在方案中', 'Pending pages are no longer in the plan'));
  const preflightEvents: ProjectSessionSetupEvent[] = [...inheritedEvents];
  let preGenerationSetupMs = roundMs(preflightEvents.reduce((sum, ev) => sum + ev.durationMs, 0));
  let preGenerationApplyMs = 0;
  let preGenerationFlushMs = 0;
  let failureFlushMs = 0;
  let postGenerationValidationMs = 0;
  let plannedPageCount = initialWorkPages.length;
  let failedPageId: string | undefined;
  let completedPageCount = 0;
  const pageMetrics: ProjectTurnMetrics[] = [];
  try {
    const batchEnsureStartedAt = nowMs();
    try {
      const batchPreflight = await prepareProjectToolsWithMetrics(scope, 'batch_preflight');
      preflightEvents.push(batchPreflight.event);
      preGenerationSetupMs = roundMs(preflightEvents.reduce((sum, ev) => sum + ev.durationMs, 0));
    } catch (preflightErr) {
      preGenerationSetupMs = roundMs(preGenerationSetupMs + (nowMs() - batchEnsureStartedAt));
      throw preflightErr;
    }
    check();
    if (useProtoStore.getState().projectPlan !== plan) throw new Error(tr('方案已变化，请重新确认', 'Plan changed; please reconfirm'));
    const workPages = targetId === undefined ? pageGenerationOrder(plan.pages, projectPlanProgress()) : plan.pages.filter(page => page.pageId === targetId);
    if (!workPages.length) throw new Error(tr('待生成页面已不在方案中', 'Pending pages are no longer in the plan'));
    plannedPageCount = workPages.length;
    const retainedGeneratedPageIds = projectPlanProgress();
    const base = captureProjectPayload(), revision = projectRevision();
    const previousIssues = new Set(analyzeProject(base.stateSnapshot).issues);
    const planIdentity = JSON.stringify({ summary: plan.summary, folders: plan.folders, pages: plan.pages, revision: plan.revision });
    const assertPlanUnchanged = () => {
      assertProject(projectId);
      const latest = useProtoStore.getState().projectPlan;
      if (!latest?.approved || latest.discussionPending || JSON.stringify({ summary: latest.summary, folders: latest.folders, pages: latest.pages, revision: latest.revision }) !== planIdentity) {
        throw new Error(tr('生成期间方案已变化，请重新确认方案', 'Plan changed during generation; please reconfirm the plan'));
      }
    };
    const checkPlan = () => {
      check();
      assertPlanUnchanged();
    };
    const preApplyStartedAt = nowMs();
    try {
      const operations = planMenuOperations(base.stateSnapshot, plan, targetId, base.meta.projectMode);
      if (operations.length) applyProjectChanges(base, revision, operations);
      useProtoStore.setState({ projectPlan: { ...plan, approved: true, generatedPageIds: retainedGeneratedPageIds } });
    } finally {
      preGenerationApplyMs = roundMs(nowMs() - preApplyStartedAt);
    }
    const preFlushStartedAt = nowMs();
    try {
      await flushProjectChanges();
    } finally {
      preGenerationFlushMs = roundMs(nowMs() - preFlushStartedAt);
    }
    check();
    let pendingPreflightEvents: ProjectSessionSetupEvent[] | undefined = preflightEvents;
    const failedValidationPages: Array<{
      pageId: string;
      title: string;
      diagnostic: string;
      envelope: HermesFailureEnvelope;
      error: unknown;
    }> = [];
    const skippedDependentPages: Array<{ pageId: string; title: string }> = [];
    let blockedPageIds = new Set<string>();
    const persistBatchFailure = async (
      pageId: string,
      diagnostic: string,
      needsArchiveRestart = false,
    ) => {
      const latest = useProtoStore.getState().projectPlan;
      if (!latest) return;
      useProtoStore.setState({
        projectPlan: {
          ...latest,
          lastGenerationFailure: {
            pageId,
            diagnostic: diagnostic.slice(0, 2000),
            ...(needsArchiveRestart ? { needsArchiveRestart: true } : {}),
          },
        },
      });
      const failFlushStartedAt = nowMs();
      try {
        await flushProjectChanges();
      } finally {
        failureFlushMs = roundMs(failureFlushMs + (nowMs() - failFlushStartedAt));
      }
    };
    for (const page of workPages) {
      checkPlan();
      if (projectPlanProgress().includes(page.pageId)) continue;
      if (blockedPageIds.has(page.pageId)) {
        if (!failedValidationPages.some(item => item.pageId === page.pageId)) {
          skippedDependentPages.push({ pageId: page.pageId, title: page.title });
        }
        continue;
      }
      useProjectWorkflow.setState(s => ({ status: { ...s.status, [key]: tr(`正在生成 ${page.title}（${workPages.indexOf(page) + 1}/${workPages.length}）`, `Generating ${page.title} (${workPages.indexOf(page) + 1}/${workPages.length})`) } }));
      const shouldRestartThisPage =
        restartFromProject &&
        (onlyPageId !== undefined || restartPageId === undefined || restartPageId === page.pageId);
      const beforeTurn = projectRevision();
      const failure = useProtoStore.getState().projectPlan?.lastGenerationFailure;
      const diagnostic =
        failure?.pageId === page.pageId
          ? shouldRestartThisPage && failureNeedsArchiveRestart(failure)
            ? tr('\n（上轮中断草稿已归档，未写入工程；请直接读取当前工程状态完整生成此页。）', '\n(Interrupted draft from the previous run was archived without modifying the project; read the current project state and generate this page completely.)')
            : tr(`\n上次此页未提交，宿主诊断：${failure.diagnostic}`, `\nPrevious attempt for this page was not committed. Host diagnostic: ${failure.diagnostic}`)
          : '';
      const turnInheritedEvents = pendingPreflightEvents;
      pendingPreflightEvents = undefined;
      try {
        await turn(scope, `生成页面「${page.title}」（${page.pageId}）。需求：${page.requirements}${diagnostic}`, 'generating', checkPlan, {
          restartFromProject: shouldRestartThisPage,
          targetPageId: page.pageId,
          inheritedSessionEvents: turnInheritedEvents,
        });
        const metric = useProjectWorkflow.getState().lastTurnMetrics[key];
        if (metric) pageMetrics.push(metric);
        completedPageCount += 1;
      } catch (error) {
        const metric = useProjectWorkflow.getState().lastTurnMetrics[key];
        if (metric) pageMetrics.push(metric);
        assertPlanUnchanged();
        const errText = error instanceof Error ? error.message : String(error);
        const envelope = (error as { failureEnvelope?: HermesFailureEnvelope } | null)?.failureEnvelope;
        const needsArchiveRestart = Boolean(
          envelope?.candidateStatus === 'uncertain' ||
            (envelope?.code === 'DRAFT_RECOVERY_CONFLICT' &&
              !/登录账号|原登录账号|其他账号或会话|signed-in account|original account|another account or session/i.test(errText)) ||
            failureDiagnosticNeedsArchiveRestart(errText),
        );
        let cancelled = false;
        let cancelReason: unknown = null;
        try {
          check();
        } catch (cancelErr) {
          cancelled = true;
          cancelReason = cancelErr;
        }
        const canContinueIndependentPages =
          !cancelled &&
          targetId === undefined &&
          projectRevision() === beforeTurn &&
          envelope?.code === 'PAGE_VALIDATION_FAILED' &&
          envelope.failureScope === 'page' &&
          envelope.terminalConfirmed === true;
        if (canContinueIndependentPages) {
          if (!failedPageId) failedPageId = page.pageId;
          failedValidationPages.push({
            pageId: page.pageId,
            title: page.title,
            diagnostic: errText,
            envelope,
            error,
          });
          blockedPageIds = computeTransitiveBlockedPageIds(
            plan,
            failedValidationPages.map(item => item.pageId),
          );
          continue;
        }
        failedPageId = page.pageId;
        const preservedPriorNeedsArchive =
          cancelled &&
          !shouldRestartThisPage &&
          (errText === '已停止，已完成页面保留，可继续剩余页面' || errText === 'Stopped; completed pages preserved. You can resume the remaining pages.') &&
          failure?.pageId === page.pageId &&
          failureNeedsArchiveRestart(failure);
        const effectiveNeedsArchive = needsArchiveRestart || preservedPriorNeedsArchive;
        if (projectRevision() === beforeTurn) {
          await persistBatchFailure(page.pageId, errText, effectiveNeedsArchive);
        }
        if (cancelled && !effectiveNeedsArchive) {
          throw cancelReason;
        }
        throw error;
      }
    }
    if (failedValidationPages.length > 0) {
      checkPlan();
      const firstFailed = failedValidationPages[0];
      await persistBatchFailure(firstFailed.pageId, firstFailed.diagnostic);
      if (workPages.length === 1) {
        throw firstFailed.error;
      }
      const failedNames = failedValidationPages.map(item => tr(`「${item.title}」`, `"${item.title}"`)).join(tr('、', ', '));
      const skippedNames = skippedDependentPages.map(item => tr(`「${item.title}」`, `"${item.title}"`)).join(tr('、', ', '));
      const summaryStatus = tr(
        `已完成 ${completedPageCount} 页；页面验收未通过：${failedNames}（候选草稿已保留，可单独点击“继续此页”恢复）` +
          (skippedDependentPages.length > 0 ? `；已跳过下游依赖页：${skippedNames}` : '') +
          `。首个问题：${firstFailed.diagnostic}`,
        `Completed ${completedPageCount} page(s); validation failed on: ${failedNames} (candidate draft preserved; click "Resume page" to continue)` +
          (skippedDependentPages.length > 0 ? `; skipped downstream dependent pages: ${skippedNames}` : '') +
          `. First issue: ${firstFailed.diagnostic}`,
      );
      useProjectWorkflow.setState(s => ({ status: { ...s.status, [key]: summaryStatus } }));
      const batchErr = new Error(summaryStatus, {
        cause: firstFailed.error instanceof Error ? firstFailed.error : undefined,
      }) as Error & {
        failureEnvelope?: HermesFailureEnvelope;
        failedPageIds?: string[];
        skippedPageIds?: string[];
      };
      batchErr.failureEnvelope = firstFailed.envelope;
      batchErr.failedPageIds = failedValidationPages.map(item => item.pageId);
      batchErr.skippedPageIds = skippedDependentPages.map(item => item.pageId);
      throw batchErr;
    }
    const postValStartedAt = nowMs();
    let status = '';
    try {
      const newIssues = analyzeProject(captureProjectPayload().stateSnapshot).issues.filter(issue => !previousIssues.has(issue));
      if (newIssues.length) throw new Error(tr(`页面已保存，但项目关联检查发现问题：${newIssues.slice(0, 5).join('；')}。请通过项目对话调整方案后修复。`, `Pages saved, but project reference check found issues: ${newIssues.slice(0, 5).join('; ')}. Adjust the plan via project chat to fix.`));
      const canvases = publishablePages();
      const current = useProtoStore.getState().activePageId;
      const entry = canvases.find(page => page.pageId === current) ?? canvases[0];
      if (!entry) throw new Error(tr('没有可生成发布预览的页面', 'No publishable pages available for preview'));
      let snapshot;
      try { snapshot = createPublishedSnapshot(entry.pageId); }
      catch (error) { throw new Error(tr(`页面已保存，发布预检发现问题：${error instanceof Error ? error.message : String(error)}`, `Pages saved, but publish preflight found issues: ${error instanceof Error ? error.message : String(error)}`)); }
      const dataIssues = previewRelationIssues(snapshot.tables, snapshot.tableRows);
      const review = reviewPageDependencies(captureProjectPayload().stateSnapshot);
      const gaps = review.links.filter(link => link.status !== '已核对结构与页面绑定').length;
      status = tr(
        `已生成发布快照（${snapshot.pages.length} 页）。待核对数据依赖 ${gaps} 项，预览外键异常 ${dataIssues.length} 项，使用内置示例的图表 ${review.sampleCharts.length} 个，业务场景待验收 ${review.cases.length} 项。`,
        `Generated published snapshot (${snapshot.pages.length} page(s)). Unverified data dependencies: ${gaps}, preview FK issues: ${dataIssues.length}, sample-data charts: ${review.sampleCharts.length}, business scenarios pending acceptance: ${review.cases.length}.`,
      );
    } finally {
      postGenerationValidationMs = roundMs(nowMs() - postValStartedAt);
    }
    useProjectWorkflow.setState(s => ({status:{...s.status,[key]:status}}));
  } finally {
    const batchSessionEvents: ProjectSessionSetupEvent[] = [
      ...preflightEvents,
      ...pageMetrics.flatMap(m => m.sessionEvents.filter(e => e.stage !== 'review_preflight' && e.stage !== 'batch_preflight')),
    ];
    const sessionCreated = batchSessionEvents.some(e => e.created) || pageMetrics.some(m => m.sessionCreated);
    const sessionReloaded = batchSessionEvents.some(e => e.reloaded) || pageMetrics.some(m => m.sessionReloaded);
    const sessionReused = !sessionCreated && !sessionReloaded && batchSessionEvents.some(e => e.reused);
    const promptVerifyMs = roundMs(pageMetrics.reduce((sum, m) => sum + m.promptVerifyMs, 0));
    const hostValidationMs = roundMs(postGenerationValidationMs + pageMetrics.reduce((sum, m) => sum + m.hostValidationMs, 0));
    const batchMetrics: ProjectBatchMetrics = {
      metricId: newId('bm'),
      projectId,
      conversationKey: key,
      startedAt: batchStartedIso,
      totalBatchMs: roundMs(nowMs() - batchStartedAt),
      plannedPageCount,
      completedPageCount,
      ...(failedPageId !== undefined ? { failedPageId } : {}),
      preGenerationSetupMs,
      preGenerationApplyMs,
      preGenerationFlushMs,
      failureFlushMs,
      postGenerationValidationMs,
      sessionCreated,
      sessionReloaded,
      sessionReused,
      sessionEvents: batchSessionEvents,
      sessionSetupMs: roundMs(preGenerationSetupMs + pageMetrics.reduce((sum, m) => sum + m.sessionSetupMs, 0)),
      acpTurnMs: roundMs(pageMetrics.reduce((sum, m) => sum + m.acpTurnMs, 0)),
      unattributedAcpMs: roundMs(pageMetrics.reduce((sum, m) => sum + m.unattributedAcpMs, 0)),
      toolExecMs: roundMs(pageMetrics.reduce((sum, m) => sum + m.toolExecMs, 0)),
      nativeToolExecMs: roundMs(pageMetrics.reduce((sum, m) => sum + m.nativeToolExecMs, 0)),
      userWaitMs: roundMs(pageMetrics.reduce((sum, m) => sum + m.userWaitMs, 0)),
      toolCallCount: pageMetrics.reduce((sum, m) => sum + m.toolCallCount, 0),
      failedToolCallCount: pageMetrics.reduce((sum, m) => sum + m.failedToolCallCount, 0),
      nativeToolCallCount: pageMetrics.reduce((sum, m) => sum + m.nativeToolCallCount, 0),
      failedNativeToolCallCount: pageMetrics.reduce((sum, m) => sum + m.failedNativeToolCallCount, 0),
      contextQueryCount: pageMetrics.reduce((sum, m) => sum + (m.contextQueryCount ?? 0), 0),
      contextQueryMs: roundMs(pageMetrics.reduce((sum, m) => sum + (m.contextQueryMs ?? 0), 0)),
      contextColdStarts: pageMetrics.reduce((sum, m) => sum + (m.contextColdStarts ?? 0), 0),
      retryCount: pageMetrics.reduce((sum, m) => sum + m.retryCount, 0),
      retryMs: roundMs(pageMetrics.reduce((sum, m) => sum + m.retryMs, 0)),
      continuationPageCount: pageMetrics.filter(m => m.continuationUsed).length,
      promptVerifyMs,
      hostValidationMs,
      validationMs: roundMs(promptVerifyMs + hostValidationMs),
      applyChangesMs: roundMs(preGenerationApplyMs + pageMetrics.reduce((sum, m) => sum + m.applyChangesMs, 0)),
      saveFlushMs: roundMs(preGenerationFlushMs + failureFlushMs + pageMetrics.reduce((sum, m) => sum + m.saveFlushMs, 0)),
      promptBytes: pageMetrics.reduce((sum, m) => sum + m.promptBytes, 0),
      snapshotBytes: pageMetrics.reduce((max, m) => Math.max(max, m.snapshotBytes), 0),
      pageMetrics,
    };
    recordBatchMetrics(projectId, batchMetrics);
  }
}
