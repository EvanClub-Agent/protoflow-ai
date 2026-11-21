import type { HermesChatConversation, HermesProjectConversation, HermesTaskScope } from './hermesConversation';
import { tr } from '../i18n/runtime';
import type { DBTableSchema } from '../store/useProtoStore';
export type HermesImageAttachment = HermesChatConversation & {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
}
export interface HermesImageInput {
  name: string;
  mimeType: HermesImageAttachment['mimeType'];
  data: string;
}
export interface HermesModel {
  modelId: string;
  name: string;
  description?: string;
}
export interface HermesReasoning {
  sessionId: string;
  modelId: string;
  current: string;
  wire: string;
  generalLevels: boolean;
  levels: string[];
}
export interface HermesSessionSetupMetrics {
  durationMs: number;
  connectMs: number;
  promptRefreshMs: number;
  acpSessionRpcMs: number;
  reused: boolean;
  reloaded: boolean;
  created: boolean;
  reloadReason: string | null;
}
export type HermesSession = HermesTaskScope & {
  sessionId: string;
  projectTools?: string[];
  skillDigest?: string | null;
  running: boolean;
  models: { currentModelId: string; availableModels: HermesModel[] };
  lastSetup?: HermesSessionSetupMetrics;
}
export interface HermesEnvironment {
  detected: boolean;
  connected?: boolean;
  home: string;
  binary: string;
  version: string;
  error?: string;
}
export type HermesManagementSection = 'accounts' | 'models' | 'skills' | 'history' | 'memory' | 'tools' | 'plugins' | 'schedules' | 'channels' | 'diagnostics' | 'logs' | 'backup' | 'settings';
export interface HermesInstallation {
  needsResume?: boolean;
  selectedRuntime?: 'managed' | 'legacy-managed' | 'external';
  previousExternal?: { home: string; binary: string };
  status: 'idle' | 'running' | 'cancelling' | 'cancelled' | 'interrupted' | 'error' | 'success';
  phase: string;
  completed: number;
  total: number;
  message: string;
}
export interface HermesOperation {
  tool: string;
  args: Record<string, unknown>;
}
export interface HermesToolMetricSummary {
  count: number;
  failedCount: number;
  totalMs: number;
  argBytes: number;
  resultBytes: number;
}
export interface HermesNativeToolMetricSummary {
  count: number;
  failedCount: number;
  totalMs: number;
}
export interface HermesExecuteMetrics {
  totalExecuteMs: number;
  sessionSetupMs: number;
  connectMs: number;
  promptRefreshMs: number;
  acpSessionRpcMs: number;
  contextBridgeSetupMs: number;
  sessionReused: boolean;
  sessionReloaded: boolean;
  sessionCreated: boolean;
  reloadReason: string | null;
  priorSessionSetup?: HermesSessionSetupMetrics | null;
  firstOutputMs: number | null;
  firstTextMs: number | null;
  /** Inclusive wall-clock duration of ACP `session/prompt` (includes `unattributedAcpMs`, `toolExecMs`, `nativeToolExecMs`, and `userWaitMs`; do NOT sum with sub-stages). */
  acpTurnMs: number;
  /** Provider-request retries only; never a replay of a complete ACP turn. */
  providerRetryCount?: number;
  providerWaitMs?: number;
  /** Unattributed ACP duration inside `session/prompt` after subtracting `toolExecMs`, `nativeToolExecMs`, and `userWaitMs` (includes model inference, ACP gateway scheduling, and any uninstrumented internal work). */
  unattributedAcpMs: number;
  /** Duration spent waiting for user question/permission responses inside `session/prompt`. */
  userWaitMs: number;
  promptVerifyMs: number;
  /** MCP tool execution duration inside `protoflow-mcp.cjs` (sub-stage of `acpTurnMs`). */
  toolExecMs: number;
  toolCallCount: number;
  failedToolCallCount: number;
  /** Hermes native tool execution duration (e.g. terminal, search_files, tool_search) observed via ACP tool lifecycle, excluding `toolExecMs` and `userWaitMs`. */
  nativeToolExecMs: number;
  nativeToolCallCount: number;
  failedNativeToolCallCount: number;
  nativeToolBreakdown: Record<string, HermesNativeToolMetricSummary>;
  acpToolCallCount: number;
  toolBreakdown: Record<string, HermesToolMetricSummary>;
  /** Authoritative Hermes context reads (compression count / history) issued by protoflow-mcp tools; time is inside `toolExecMs`. */
  contextQueryCount?: number;
  contextQueryMs?: number;
  /** Context bridge process cold starts during this turn's tool calls (0 when the long-lived bridge was reused). */
  contextColdStarts?: number;
  /** How the per-turn `verify_prompt` was served: `persistent` bridge or `oneshot-fallback`; null when not run or overridden. */
  promptVerifyBridgeMode?: string | null;
  promptVerifyColdStart?: boolean | null;
  promptBytes: number;
  imageBytes: number;
  snapshotBytes: number;
  contextJsonBytes: number;
  skillBytes: number;
}
export interface HermesExecutionContinuation {
  /** Exact prior result whose original task evidence should be carried forward. */
  sourceRunId?: string;
  operations: HermesOperation[];
  requirementFindings?: import('../proto/database/requirementReview').RequirementSubmission[];
  initialBaseline?: {
    pageIds: string[];
    stickyOwners: Record<string, string>;
    tableRowIds: string[];
    validationBase: unknown;
  };
}
export type HermesFailureCode =
  | 'PAGE_VALIDATION_FAILED'
  | 'DRAFT_RECOVERY_CONFLICT'
  | 'PROVIDER_RATE_LIMIT_BUDGET'
  | 'PROVIDER_SERVER_ERROR_BUDGET'
  | 'PROVIDER_QUOTA_EXHAUSTED'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_REQUEST_TOO_LARGE'
  | 'PROVIDER_REJECTED'
  | 'CONTEXT_OVERFLOW_UNRECOVERED'
  | 'GATEWAY_OUTCOME_UNKNOWN'
  | 'ACP_DISCONNECTED'
  | 'USER_CANCELLED'
  | 'RUNTIME_INTERNAL';

export interface HermesFailureEnvelope {
  code: HermesFailureCode;
  failureScope: 'page' | 'shared' | 'unknown';
  terminalConfirmed: boolean;
  candidateStatus: 'available' | 'uncertain' | 'none';
  targetPageId?: string;
}

export interface HermesReply {
  recoveredDraft?: boolean;
  requirementFindings?: import('../proto/database/requirementReview').RequirementSubmission[];
  dependencyFootprint?: import('./dependencyFootprint').DependencyFootprintV3;
  continuationMerged?: boolean;
  text: string;
  operations: HermesOperation[];
  sessionId: string;
  planningSessionId?: string;
  execSessionId?: string;
  taskKey?: string;
  targetPageId?: string;
  clientRequestId?: string;
  runId: string;
  modelId: string;
  skillDigest?: string | null;
  metrics?: HermesExecuteMetrics;
}
export type HermesPermission = HermesTaskScope & {
  id: string;
  toolCall: {
    title?: string;
    rawInput?: unknown;
    content?: { type: string; content?: { type: string; text?: string } }[];
  };
  options: { optionId: string; name: string; kind: string }[];
}
export type HermesQuestion = HermesTaskScope & {
  id: string;
  message: string;
  /** Exact position in this clarify call's complete question list, not all future questions. */
  progress?: { batchId: string; current: number; total: number };
  answerSchema: {
    type: "string" | "array";
    enum?: string[];
    items?: { enum?: string[] };
  };
}
export interface HermesContextUsage {
  available?: boolean;
  used?: number;
  size?: number;
  estimated?: boolean;
  compressions?: number;
  compacting?: boolean;
}
export interface HermesContextResult {
  sessionId: string;
  usage?: HermesContextUsage;
  status?: string;
  summary?: { noop?: boolean; aborted?: boolean; fallback_used?: boolean; headline?: string; token_line?: string };
  query?: string;
  total?: number;
  matches?: { messageId: number; role: 'user' | 'assistant'; sourceSessionId?: string; sourceRole?: string; text: string; truncated: boolean }[];
  nextOffset?: number | null;
}
export interface HermesEvent {
  retry?: { status: 'waiting' | 'retrying' | 'recovered' | 'stopped'; attempt: number; waitSeconds?: number };
  context?: HermesContextUsage;
  reason?: 'connection-lost' | 'closed';
  threadId?: string;
  type: string;
  kind?: 'mindmap' | 'project';
  mindmapId?: string;
  projectId?: string;
  pageId?: string;
  targetPageId?: string;
  sessionId?: string;
  planningSessionId?: string;
  execSessionId?: string;
  taskKey?: string;
  clientRequestId?: string;
  runId?: string;
  id?: string;
  message?: string;
  update?: {
    sessionUpdate: string;
    entries?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[];
    content?: { type: string; text?: string };
    title?: string;
    status?: string;
    currentModelId?: string;
  };
  answerSchema?: HermesQuestion["answerSchema"];
  progress?: HermesQuestion['progress'];
  toolCall?: HermesPermission["toolCall"];
  options?: HermesPermission["options"];
  installation?: HermesInstallation;
  preview?: { targetPageId: string; source: string; sequence: number; dbTables: DBTableSchema[]; tableRows?: Record<string, import('../proto/runtime/mock').Row[]> };
  metrics?: HermesExecuteMetrics;
}
export interface HermesDesktopApi {
  completeRecovery?: (input: HermesTaskScope & { workflowPhase?: 'generating'; targetPageId: string; runId: string }) => Promise<{ completed: boolean }>;
  context: (input: HermesProjectConversation & { sessionId: string; action: 'usage' | 'compress' | 'history'; query?: string; offset?: number }) => Promise<HermesContextResult>;
  saveImages: (input: HermesChatConversation & { images: HermesImageInput[] }) => Promise<HermesImageAttachment[]>;
  readImage: (input: HermesChatConversation & { id: string }) => Promise<HermesImageAttachment & { data: string }>;
  accounts: {
    list: () => Promise<HermesAccountCatalog>;
    saveKey: (input: { key: string; value: string }) => Promise<{ saved: boolean }>;
    removeKey: (input: { key: string }) => Promise<{ removed: boolean }>;
    start: (input: { providerId: string }) => Promise<HermesLogin>;
    openLogin: (input: { sessionId: string }) => Promise<void>;
    poll: (input: { sessionId: string }) => Promise<{ status: 'pending' | 'approved' | 'denied' | 'expired' | 'error' }>;
    submit: (input: { sessionId: string; code: string }) => Promise<{ status: 'approved' }>;
    cancel: (input: { sessionId: string }) => Promise<void>;
    disconnect: (input: { providerId: string }) => Promise<{ disconnected: boolean }>;
  };
  detect: (input?: {
    home?: string;
    binary?: string;
  }) => Promise<HermesEnvironment>;
  connect: (input?: {
    home?: string;
    binary?: string;
  }) => Promise<HermesEnvironment>;
  disconnect: () => Promise<void>;
  session: (input: HermesTaskScope & {
    fresh?: boolean;
    refresh?: boolean;
  }) => Promise<HermesSession>;
  deleteProjectChat: (scope: HermesProjectConversation) => Promise<{ deleted: boolean }>;
  reasoning: (input: HermesChatConversation & { sessionId: string; modelId: string; effort?: string | null }) => Promise<HermesReasoning>;
  setModel: (input: HermesTaskScope & {
    modelId: string;
  }) => Promise<HermesSession>;
  execute: (input: HermesTaskScope & {
    prompt: string;
    workflowPhase?: 'conversation' | 'planning' | 'generating';
    contextFocus?: { pageId?: string; folderId?: string };
    targetPageId?: string;
    clientRequestId?: string;
    rotateSession?: boolean;
    snapshot: unknown;
    continuation?: HermesExecutionContinuation;
    recoveryRevision?: string;
    recoveryRevisionVersion?: 2 | 3;
    recoverDraft?: boolean;
    archiveDraft?: boolean;
    readOnly?: boolean;
    images?: HermesImageAttachment[];
  }) => Promise<HermesReply>;
  cancel: (input: HermesTaskScope) => Promise<void>;
  permission: (input: { id: string; optionId: string | null }) => Promise<void>;
  question: (input: {
    id: string;
    answer: string | string[] | null;
    supplement?: string;
  }) => Promise<void>;
  sync: (input: ({ projectId: string; kind?: never; mindmapId?: never } | { projectId: string; kind: 'mindmap'; mindmapId: string } | HermesProjectConversation) & { skillMarkdown: string }) => Promise<{ synced: boolean; skillFile?: string; skillDigest?: string | null }>;
  update: () => Promise<HermesEnvironment>;
  installGuide: () => Promise<void>;
  installation: () => Promise<HermesInstallation>;
  install: () => Promise<HermesInstallation>;
  repair: () => Promise<HermesInstallation>;
  cancelInstall: () => Promise<HermesInstallation>;
  openInstallLog: () => Promise<void>;
  openManagement: (input: { section: HermesManagementSection }) => Promise<{ opened: boolean }>;
  onEvent: (listener: (event: HermesEvent) => void) => () => void;
}
export function getHermesApi(): HermesDesktopApi {
  const api =
    typeof window !== "undefined"
      ? (
          window as unknown as {
            protoflowDesktop?: { hermes?: HermesDesktopApi };
          }
        ).protoflowDesktop?.hermes
      : undefined;
  if (!api)
    throw new Error(
      tr("AI 功能需要桌面端 Hermes 连接，请使用桌面应用并连接 Hermes", "AI features require a desktop Hermes connection. Open the desktop app and connect Hermes."),
    );
  return api;
}
export interface HermesAccountCatalog {
  providers: { id: string; name: string; flow: 'device_code' | 'pkce' | 'external'; connected: boolean }[];
  keys: { key: string; provider: string; name: string; configured: boolean }[];
}
export interface HermesLogin {
  sessionId: string;
  flow: 'device_code' | 'pkce';
  userCode: string | null;
  expiresIn: number;
}
