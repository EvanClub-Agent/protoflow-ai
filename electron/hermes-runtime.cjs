const fs = require("node:fs");
const hostFs = (() => {
  if (process.versions?.electron) {
    try { return require("original-fs"); } catch {}
  }
  return fs;
})();
const path = require("node:path");
const os = require("node:os");
const { spawn, execFile } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { AcpClient } = require("./hermes-acp.cjs");
const { tr, isMainEn, getMainLocale } = require("./i18n.cjs");
const { conversationScope, conversationKey } = require('./hermes-conversation.cjs');
const { ChatImages } = require('./chat-images.cjs');
const { atomicWrite, replayCandidateOperations } = require("./protoflow-mcp.cjs");
const { watchStagedPages, createHermesPreviewBridge } = require('./hermes-preview.cjs');
const draftRecovery = require('./hermes-draft-recovery.cjs');
const { withContextLockAsync } = require('./context-transaction.cjs');
const { QuestionProgress } = require('./hermes-question-progress.cjs');
const { ContextBridgePool, PERSISTENT_ACTIONS, readContextScript } = require('./hermes-context-bridge.cjs');
const {
  createEmptyDependencyFootprint,
  verifyDependencyFootprint,
  collectRequirementRecords,
} = require('./generated/material-contract.cjs');
const expand = (p) =>
  p === "~"
    ? os.homedir()
    : p.startsWith("~/")
      ? path.join(os.homedir(), p.slice(2))
      : p;
const runtimeEnv = () => ({
  ...process.env,
  PROTOFLOW_LOCALE: getMainLocale(),
  PATH: [
    path.join(os.homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH || "",
  ].join(path.delimiter),
});
function runCommand(binary, args, home, timeout = 30000, env = {}, baseEnv = runtimeEnv()) {
  return new Promise((resolve) => {
    let output = "";
    let stderr = "";
    let settled = false;
    const child = spawn(binary, args, {
      env: { ...baseEnv, ...env, HERMES_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stderr });
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      done({ ok: false, output: tr("Hermes 命令超时", "Hermes command timed out"), timedOut: true });
    }, timeout);
    child.stdout.on("data", (d) => {
      output = (output + d).slice(-16000);
    });
    child.stderr.on("data", d => { stderr = (stderr + d).slice(-16000); });
    child.on("error", (e) => done({ ok: false, output: e.message }));
    child.on("close", (code) => done({ ok: code === 0, output, exitCode: code }));
  });
}

function describeHermesUpdateError(result) {
  const details = `${result.output}\n${result.stderr}`;
  if (result.timedOut || /timed?\s*out|timeout|Failed to fetch updates|Could not resolve host|unable to access/i.test(details)) {
    return tr(
      'AI 组件更新暂时无法连接下载服务，请稍后重试。软件本身的内网更新不受影响。',
      'AI component update cannot reach the download service right now. Please try again later. Intranet app updates are unaffected.',
    );
  }
  if (/permission denied|access is denied|EACCES/i.test(details)) {
    return tr(
      'AI 组件的安装目录无法写入，请联系管理员处理目录权限后重试。',
      'Cannot write to the AI component installation directory. Please contact your administrator to check directory permissions and retry.',
    );
  }
  return tr(
    'AI 组件更新未完成，请稍后重试。详细原因已保存在 AI 组件的更新日志中。',
    'AI component update did not complete. Please try again later. Details have been saved to the AI component update log.',
  );
}
const roundMs = (value) => Number(Math.max(0, value).toFixed(2));
function safeRemoveFile(targetFile) {
  if (!targetFile) return;
  try {
    fs.rmSync(targetFile, { force: true });
  } catch {}
}
function appendBoundedJsonl(targetFile, record, maxEntries = 50) {
  if (!targetFile) return;
  let tmp = '';
  try {
    let existing = [];
    if (fs.existsSync(targetFile)) {
      existing = fs.readFileSync(targetFile, 'utf8').split('\n').filter(Boolean);
    }
    const next = [...existing.slice(-(maxEntries - 1)), JSON.stringify(record)];
    tmp = `${targetFile}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, next.join('\n') + '\n', { mode: 0o600 });
    fs.renameSync(tmp, targetFile);
  } catch {
    if (tmp) safeRemoveFile(tmp);
  }
}
function writeSkillFileIfChanged(file, content) {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  } catch {}
  fs.writeFileSync(file, content, { mode: 0o600 });
}
function leanSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !snapshot.contracts ||
    typeof snapshot.contracts !== 'object' ||
    Array.isArray(snapshot.contracts)
  ) {
    return snapshot;
  }
  const {
    components: _components,
    materialContractVersion: _materialContractVersion,
    materialValueDefinitions: _materialValueDefinitions,
    actions: _actions,
    ...dynamicContracts
  } = snapshot.contracts;
  return { ...snapshot, contracts: dynamicContracts };
}
function parseAcpToolName(update) {
  const raw = typeof update?.toolName === 'string' && update.toolName.trim()
    ? update.toolName
    : typeof update?.name === 'string' && update.name.trim()
      ? update.name
      : typeof update?.title === 'string' && update.title.trim()
        ? update.title
        : '';
  if (!raw) return 'unknown_native_tool';
  return raw.split(':')[0].trim() || 'unknown_native_tool';
}
function isProtoflowMcpToolName(toolName) {
  return /^(?:mcp[_/.-]+protoflow[_/.-]+|protoflow[_/.-])/.test(toolName);
}
function readToolMetrics(metricsFile, runId) {
  const breakdown = {};
  let toolCallCount = 0;
  let failedToolCallCount = 0;
  let toolExecMs = 0;
  let contextQueryCount = 0;
  let contextQueryMs = 0;
  let contextColdStarts = 0;
  let raw = '';
  const empty = () => ({ toolCallCount, failedToolCallCount, toolExecMs: 0, toolBreakdown: breakdown, contextQueryCount: 0, contextQueryMs: 0, contextColdStarts: 0 });
  try {
    if (!metricsFile || !fs.existsSync(metricsFile)) {
      return empty();
    }
    raw = fs.readFileSync(metricsFile, 'utf8');
  } catch {
    return empty();
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.runId !== runId || typeof entry.tool !== 'string') continue;
      const duration = typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
      const argBytes = typeof entry.argBytes === 'number' && Number.isFinite(entry.argBytes) ? entry.argBytes : 0;
      const resultBytes = typeof entry.resultBytes === 'number' && Number.isFinite(entry.resultBytes) ? entry.resultBytes : 0;
      if (Number.isSafeInteger(entry.nativeQueryCount) && entry.nativeQueryCount > 0) contextQueryCount += entry.nativeQueryCount;
      if (typeof entry.nativeQueryMs === 'number' && Number.isFinite(entry.nativeQueryMs)) contextQueryMs += entry.nativeQueryMs;
      if (Number.isSafeInteger(entry.nativeColdStarts) && entry.nativeColdStarts > 0) contextColdStarts += entry.nativeColdStarts;
      toolCallCount += 1;
      if (!entry.ok) failedToolCallCount += 1;
      toolExecMs += duration;
      const prev = breakdown[entry.tool] || { count: 0, failedCount: 0, totalMs: 0, argBytes: 0, resultBytes: 0 };
      prev.count += 1;
      if (!entry.ok) prev.failedCount += 1;
      prev.totalMs = roundMs(prev.totalMs + duration);
      prev.argBytes += argBytes;
      prev.resultBytes += resultBytes;
      breakdown[entry.tool] = prev;
    } catch {}
  }
  return {
    toolCallCount,
    failedToolCallCount,
    toolExecMs: roundMs(toolExecMs),
    toolBreakdown: breakdown,
    contextQueryCount,
    contextQueryMs: roundMs(contextQueryMs),
    contextColdStarts,
  };
}

function diagnosticToolFailures(metricsFile, runId) {
  try {
    const { failureReason } = require('./diagnostics.cjs');
    return fs.readFileSync(metricsFile, 'utf8').split('\n').flatMap(line => {
      try {
        const entry = JSON.parse(line);
        return entry.runId === runId && entry.ok === false && typeof entry.tool === 'string'
          ? [{ kind:'mcp-tool', actionKind:entry.tool, status:failureReason(entry.error) }] : [];
      } catch { return []; }
    }).slice(-50);
  } catch { return []; }
}
function taskKeyForExecution(scope, workflowPhase, targetPageId) {
  if (scope.kind === 'project' && workflowPhase === 'generating' && typeof targetPageId === 'string' && targetPageId) {
    return JSON.stringify([scope.projectId, 'project-page-exec', scope.threadId ?? null, targetPageId]);
  }
  return conversationKey(scope);
}
function isSessionNotFoundError(error) {
  if (error === null) return true;
  const details = [
    error?.code,
    error?.reason,
    error?.message,
    error?.data?.details,
    error?.data?.reason,
  ]
    .filter(v => typeof v === 'string' && v.length > 0)
    .join(' ');
  return /\bnot_found\b|session[_\s]+not[_\s]+found/i.test(details);
}
const TURN_SESSION_UPDATES = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
]);
const NON_TURN_SESSION_UPDATES = new Set([
  'usage_update',
  'current_model_update',
  'available_commands_update',
  'current_mode_update',
  'config_option_update',
  'session_info_update',
  'user_message_chunk',
]);
function buildFailureEnvelope({
  error,
  cancelled = false,
  acpTurnOutcomeUnknown = false,
  gatewayTurnUncertainty = null,
  hadUnfinishedNativeTools = false,
  retryStatus = null,
  runFailure = null,
  recoverySaved = false,
  uncertainRecovery = false,
  existingCandidateStatus = null,
  targetPageId,
}) {
  const { cleanText, isCancellation } = require('./diagnostics.cjs');
  const candidateStatus = recoverySaved
    ? (uncertainRecovery ? 'uncertain' : 'available')
    : existingCandidateStatus === 'uncertain' || existingCandidateStatus === 'available'
      ? existingCandidateStatus
      : 'none';
  let code = 'RUNTIME_INTERNAL';
  let failureScope = uncertainRecovery ? 'unknown' : 'shared';
  let terminalConfirmed = !uncertainRecovery;
  if (cancelled || isCancellation(error)) {
    code = 'USER_CANCELLED';
    failureScope = 'shared';
    terminalConfirmed = !uncertainRecovery;
  } else if (typeof error?.code === 'string' && error.code.startsWith('DRAFT_RECOVERY_')) {
    code = 'DRAFT_RECOVERY_CONFLICT';
    failureScope = 'shared';
    terminalConfirmed = error.code !== 'DRAFT_RECOVERY_UNCERTAIN';
  } else if (acpTurnOutcomeUnknown || error?.acpDisconnected === true) {
    code = 'ACP_DISCONNECTED';
    failureScope = 'unknown';
    terminalConfirmed = false;
  } else if (
    gatewayTurnUncertainty ||
    hadUnfinishedNativeTools ||
    ['partial-response', 'request-outcome-unknown'].includes(retryStatus?.reason)
  ) {
    code = 'GATEWAY_OUTCOME_UNKNOWN';
    failureScope = 'unknown';
    terminalConfirmed = false;
  } else if (retryStatus?.reason === 'rate-limit-budget') {
    code = 'PROVIDER_RATE_LIMIT_BUDGET';
    failureScope = 'shared';
  } else if (retryStatus?.reason === 'server-error-budget') {
    code = 'PROVIDER_SERVER_ERROR_BUDGET';
    failureScope = 'shared';
  } else if (retryStatus?.reason === 'request-exceeds-token-limit') {
    code = 'PROVIDER_REQUEST_TOO_LARGE';
    failureScope = 'shared';
  } else if (retryStatus?.reason === 'non-transient-limit' || runFailure?.reason === 'quota') {
    code = 'PROVIDER_QUOTA_EXHAUSTED';
    failureScope = 'shared';
  } else if (runFailure?.reason === 'authentication') {
    code = 'PROVIDER_AUTH_FAILED';
    failureScope = 'shared';
  } else if (retryStatus?.reason === 'native-overflow-recovery' || runFailure?.reason === 'context-limit') {
    code = 'CONTEXT_OVERFLOW_UNRECOVERED';
    failureScope = 'shared';
  } else if (retryStatus?.reason === 'provider-rejected' || retryStatus?.reason === 'sdk-retry-budget-unknown') {
    code = 'PROVIDER_REJECTED';
    failureScope = 'shared';
  } else if (runFailure?.reason === 'rate-limit') {
    code = 'PROVIDER_RATE_LIMIT_BUDGET';
    failureScope = 'shared';
  }
  const safeTargetPageId =
    typeof targetPageId === 'string' &&
    targetPageId.length > 0 &&
    targetPageId.length <= 256 &&
    cleanText(targetPageId, 256) === targetPageId
      ? targetPageId
      : undefined;
  return {
    code,
    failureScope,
    terminalConfirmed,
    candidateStatus,
    ...(safeTargetPageId ? { targetPageId: safeTargetPageId } : {}),
  };
}
class HermesRuntime {
  constructor({ dataDir, managedHome = path.join(dataDir, 'hermes-home'), emit, nodeBinary = process.execPath, validateDecodedImage, deleteHistorySession, diagnostic, accountProvider = () => ({ status: 'unknown' }), capturePreviewSnapshot }) {
    this.dataDir = dataDir;
    this.managedHome = path.resolve(managedHome);
    this.deleteHistorySession = deleteHistorySession;
    this.chatImages = new ChatImages(dataDir, validateDecodedImage);
    this.previewCaptureBridge = typeof capturePreviewSnapshot === 'function' ? createHermesPreviewBridge(capturePreviewSnapshot) : null;
    this.emit = emit;
    this.diagnostic = diagnostic;
    this.accountProvider = accountProvider;
    this.recoveryChannelDir = path.join(dataDir, 'request-recovery');
    fs.mkdirSync(this.recoveryChannelDir, { recursive: true, mode: 0o700 });
    this.nodeBinary = nodeBinary;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.settingsFile = path.join(dataDir, "runtime.json");
    try {
      this.settings = JSON.parse(fs.readFileSync(this.settingsFile, "utf8"));
    } catch {
      this.settings = {};
    }
    this.sessions = new Map();
    this.pageSessions = new Map();
    this.activeProjectRuns = new Map();
    this.permissions = new Map();
    this.questions = new Map();
    this.client = null;
    this.connecting = null;
    this.locks = new Map();
    this.cancelVersions = new Map();
    this.lastSessionSetup = new Map();
    this.unconsumedSessionSetup = new Map();
    this.contextPool = new ContextBridgePool({ env: () => this.envFor(this.settings.home || this.managedHome) });
    this.lastContextBridgeUse = null;
  }
  allLoadedSessions() {
    return [...this.sessions.values(), ...this.pageSessions.values()];
  }
  findSessionByAcpId(acpSessionId) {
    if (typeof acpSessionId !== 'string' || !acpSessionId) return undefined;
    for (const s of this.allLoadedSessions()) {
      if (s.sessionId === acpSessionId && s.running) return s;
    }
    for (const s of this.allLoadedSessions()) {
      if (s.sessionId === acpSessionId && s.activeModelOp) return s;
    }
    for (const ps of this.pageSessions.values()) {
      if (ps.sessionId === acpSessionId) return ps;
    }
    for (const s of this.sessions.values()) {
      if (s.sessionId === acpSessionId) return s;
    }
    return undefined;
  }
  isConversationRunning(key) {
    return Boolean(this.sessions.get(key)?.running || this.activeProjectRuns.get(key)?.running);
  }
  eventIdentity(s) {
    const planningSessionId = s.isPageExec
      ? (this.sessions.get(conversationKey(s))?.sessionId ?? s.planningSessionId)
      : s.sessionId;
    const targetPageId = s.isPageExec ? s.targetPageId : s.activeTargetPageId;
    return {
      sessionId: s.sessionId,
      planningSessionId,
      execSessionId: s.sessionId,
      taskKey: s.taskKey ?? conversationKey(s),
      ...(typeof targetPageId === 'string' && targetPageId ? { targetPageId } : {}),
    };
  }
  envFor(home, launcher) {
    const env = runtimeEnv();
    if (home && path.resolve(home) === this.managedHome) {
      // These source/store overrides belong to the shell that started Alex.
      for (const name of ['HERMES_INSTALL_DIR', 'HERMES_INSTALL_ROOT', 'HERMES_RUNTIME_DIR', 'HERMES_WEB_DIST'])
        delete env[name];
      const selected = launcher ?? (this.settings.home === this.managedHome ? this.settings.binary : undefined);
      const binary = selected && path.resolve(selected).startsWith(this.managedHome + path.sep) ? selected : this.managedTarget().binary;
      env.PATH = path.dirname(binary) + path.delimiter + env.PATH;
    }
    return env;
  }
  runCommand(binary, args, home, timeout, env) {
    return runCommand(binary, args, home, timeout, env, this.envFor(home));
  }
  async detect(input = {}) {
    // A saved selection predates managed runtimes. Keep its profile on launch;
    // only a first run without a selection defaults to the private profile.
    const configuredHome = input.home ?? this.settings.home ?? this.managedHome;
    if (typeof configuredHome !== 'string' || !path.isAbsolute(expand(configuredHome)))
      throw new Error(tr("Hermes 配置目录必须是绝对路径", "Hermes home directory must be an absolute path"));
    const home = expand(configuredHome);
    const managed = path.resolve(home) === this.managedHome;
    const sameHome = this.settings.home && path.resolve(home) === path.resolve(expand(this.settings.home));
    const selected = input.binary || (sameHome && this.settings.binary);
    if (selected && (typeof selected !== 'string' || !path.isAbsolute(expand(selected))))
      throw new Error(tr('Hermes 可执行文件必须是绝对路径', 'Hermes executable path must be an absolute path'));
    const candidates = selected
      ? [expand(selected)]
      : managed ? [this.managedTarget().binary]
      : [...(process.platform === 'win32' && process.env.LOCALAPPDATA
          ? [path.join(process.env.LOCALAPPDATA, 'hermes', 'bin', 'hermes.exe')]
          : []), ...runtimeEnv()
          .PATH.split(path.delimiter)
          .map((dir) =>
            path.join(
              dir,
              process.platform === "win32" ? "hermes.exe" : "hermes",
            ),
          ), path.join(home, 'hermes-agent', '.hermes', 'bin', process.platform === 'win32' ? 'hermes.exe' : 'hermes')];
    const binary = candidates.find((p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
    if (!binary)
      return {
        detected: false,
        connected: false,
        home,
        binary: "",
        version: "",
        error: tr("未找到可执行的 Hermes，请先安装或指定正确路径", "Executable Hermes binary not found. Please install Hermes or specify a valid path"),
      };
    const version = await this.runCommand(binary, ["--version"], home);
    if (!version.ok || !/Hermes Agent/.test(version.output))
      return {
        detected: false,
        connected: false,
        home,
        binary,
        version: "",
        error: tr("该路径无法运行 Hermes", "Unable to run Hermes from the specified path"),
      };
    const connected = Boolean(
      this.client &&
      !this.client.closed &&
      (!this.info ||
        (path.resolve(expand(this.info.home || home)) === path.resolve(expand(home)) &&
          path.resolve(expand(this.info.binary || binary)) === path.resolve(expand(binary)))),
    );
    const installDir = /^Install directory: (.+)$/m.exec(version.output)?.[1]?.trim();
    if (managed && (!path.resolve(binary).startsWith(this.managedHome + path.sep) || !this.isAppManagedInstallation({ home, installDir }) ||
        hostFs.realpathSync(binary) !== path.join(hostFs.realpathSync(installDir), '.hermes', 'bin', process.platform === 'win32' ? 'hermes.exe' : 'hermes'))) {
      return { detected: false, connected: false, home, binary, version: '', error: tr('托管启动器未指向 Alex 的安装目录，请重新准备托管运行时', 'Managed launcher does not point to the Alex installation directory; please prepare the managed runtime again') };
    }
    return {
      detected: true,
      connected,
      home,
      binary,
      version: version.output
        .split("\n")[0]
        .replace(/^Hermes Agent\s+/, "")
        .split(" ")[0],
      installDir,
      hasConfig: fs.existsSync(path.join(home, "config.yaml")),
    };
  }
  async connect(input = {}, { signal, selectOnSuccess = false } = {}) {
    if (this.connecting) {
      if (selectOnSuccess || input.home || input.binary) throw new Error(tr('Hermes 正在连接，请稍后再切换环境', 'Hermes is currently connecting; please wait before switching environments'));
      return this.connecting;
    }
    if (this.client && !this.client.closed && !input.home && !input.binary)
      return this.info;
    if (this.activeProjectRuns.size || this.allLoadedSessions().some((s) => s.running))
      throw new Error(tr("请先停止当前 AI 任务再切换 Hermes 环境", "Please stop active AI tasks before switching the Hermes environment"));
    let candidateClient;
    this.connecting = (async () => {
      const info = await this.detect(input);
      if (!info.detected) throw new Error(info.error);
      const selection = { home: info.home, binary: info.binary };
      const previous = this.settings;
      if (this.isAppManagedInstallation(info)) {
        // Remember the exact old profile and launcher, including when upgrading a managed slot.
        const external = previous.home && previous.binary && path.resolve(expand(previous.home)) !== this.managedHome
          ? { home: previous.home, binary: previous.binary } : previous.previousExternal;
        if (external) selection.previousExternal = external;
      }
      const saveSelection = () => {
        atomicWrite(this.settingsFile, selection);
        this.settings = selection;
      };
      // A first manually selected profile remains available for component repair.
      // An install or a change of an existing selection commits only after ACP succeeds.
      const deferSelection = selectOnSuccess || (previous.home && previous.binary &&
        (previous.home !== info.home || previous.binary !== info.binary));
      if (!deferSelection) saveSelection();
      let binary = info.binary, args;
      if (info.installDir) {
        const launch = await this.runCommand(info.binary, ['--print-runtime-command'], info.home);
        let command;
        try { command = JSON.parse(launch.output); } catch {}
        if (!launch.ok || !Array.isArray(command) || !path.isAbsolute(command[0])) throw new Error(tr('Hermes 启动器未提供恢复适配接口', 'Hermes launcher does not expose the recovery adapter interface'));
        const native = require('./hermes-recovery-native.cjs');
        const copy = await native.prepareNativeRecovery(info.installDir, this.dataDir);
        const bootstrap = fs.readFileSync(path.join(__dirname, 'hermes-recovery-gateway.py'), 'utf8');
        const activated = await this.runCommand(command[0], ['-I', '-c', bootstrap, copy], info.home, 120000, { ALEX_RECOVERY_DIR: this.recoveryChannelDir });
        let activation;
        try { activation = JSON.parse(activated.output.trim().split('\n').at(-1)); } catch {}
        if (!activated.ok || activation?.ready !== true) throw new Error(activation?.error || tr('Hermes 限流恢复运行时未能启动', 'Hermes rate-limit recovery runtime failed to start'));
        info.recoverySourceDir = copy;
        info.contextPython = command[0];
        info.recoveryPolicy = 'bounded-provider-v1';
        binary = command[0];
        args = ['-I', '-c', native.launchScript, copy, 'acp'];
      }
      const client = new AcpClient(binary, {
        home: info.home, args,
        env: { ...this.envFor(info.home, info.binary), ALEX_RECOVERY_DIR: this.recoveryChannelDir },
      });
      candidateClient = client;
      const init = await client.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "protoflow", version: "0.1.0" },
        clientCapabilities: { elicitation: { form: {} } },
      });
      if (init.protocolVersion !== 1 || !init.agentCapabilities?.loadSession)
        throw new Error(tr("Hermes ACP 版本不兼容：需要会话恢复支持", "Incompatible Hermes ACP version: session recovery support is required"));
      signal?.throwIfAborted();
      if (deferSelection) saveSelection();
      this.close();
      this.contextPool.options.env = this.envFor(info.home, info.binary);
      this.client = client;
      client.on("notification", (frame) => this.onNotification(frame));
      client.on("request", (frame) => this.onRequest(frame));
      client.on("disconnect", (message, reason) => {
        this.permissions.clear();
        this.questions.clear();
        this.emit({ type: "disconnected", message, reason });
      });
      this.info = {
        ...info,
        connected: true,
        capabilities: init.agentCapabilities,
      };
      if (previous.home !== info.home || previous.binary !== info.binary) this.emit({ type: 'environment-changed' });
      return this.info;
    })()
      .catch((error) => {
        candidateClient?.close();
        throw error;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }
  managedTarget() {
    const { VERIFIED_HERMES_COMMIT } = require('./hermes-recovery-native.cjs');
    const installDir = path.join(this.managedHome, 'releases', VERIFIED_HERMES_COMMIT, 'hermes-agent');
    const binary = path.join(installDir, '.hermes', 'bin', process.platform === 'win32' ? 'hermes.exe' : 'hermes');
    return { home: this.managedHome, installDir, binary };
  }
  isAppManagedInstallation(info) {
    if (!info?.home || !info?.installDir || path.resolve(expand(info.home)) !== this.managedHome) return false;
    try {
      const relative = path.relative(hostFs.realpathSync(this.managedHome), hostFs.realpathSync(info.installDir));
      const parts = relative.split(path.sep);
      return relative === 'hermes-agent' || (parts.length === 3 && parts[0] === 'releases' && parts[2] === 'hermes-agent');
    } catch { return false; }
  }
  workspaceBinaryIdentity(home, binary) {
    if (typeof home === "string" && typeof binary === "string" && home && binary) {
      const managedHome = this.managedHome;
      const resolvedHome = path.resolve(expand(home));
      const resolvedBinary = path.resolve(expand(binary));
      if (
        resolvedHome === managedHome &&
        (resolvedBinary.startsWith(path.join(managedHome, "hermes-agent") + path.sep) ||
          resolvedBinary.startsWith(path.join(managedHome, "releases") + path.sep))
      ) {
        return path.join(home, "hermes-agent", ".hermes", "bin", process.platform === "win32" ? "hermes.exe" : "hermes");
      }
    }
    return binary;
  }
  workspace(projectId) {
    if (typeof projectId !== "string" || !projectId.trim())
      throw new Error(tr("缺少项目 ID", "Missing project ID"));
    const identity = JSON.stringify([
      this.settings.home,
      this.workspaceBinaryIdentity(this.settings.home, this.settings.binary),
      projectId,
    ]);
    const dir = path.join(
      this.dataDir,
      "projects",
      createHash("sha256").update(identity).digest("hex"),
    );
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
  conversationWorkspace(scope) {
    conversationKey(scope);
    // Legacy project-wide session.json is intentionally not reused: its history
    // can contain every menu. Each stable page identity gets an independent ACP cwd.
    const digest = value => createHash('sha256').update(value).digest('hex');
    let folder;
    if (scope.kind === 'project') folder = scope.threadId === undefined ? 'project-planning' : `project-chat-${digest(scope.threadId)}`;
    else if (scope.kind === 'mindmap') folder = `mindmap-${digest(scope.mindmapId)}`;
    else folder = digest(scope.pageId);
    const dir = path.join(this.workspace(scope.projectId), 'conversations', folder);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const skill = path.join(this.workspace(scope.projectId), 'AGENTS.md');
    if (scope.kind === undefined && fs.existsSync(skill)) writeSkillFileIfChanged(path.join(dir, 'AGENTS.md'), fs.readFileSync(skill, 'utf8'));
    return dir;
  }
  fileSkillDigest(file) {
    return fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
  }
  hasNativePromptControl() {
    return Boolean(this.info?.installDir && path.isAbsolute(this.info.installDir)) ||
      this.nativeContext !== HermesRuntime.prototype.nativeContext;
  }
  readSkillState(dir) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'skill-state.json'), 'utf8'));
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }
  writeSkillState(dir, patch) {
    const next = { ...this.readSkillState(dir), ...patch };
    atomicWrite(path.join(dir, 'skill-state.json'), next);
    return next;
  }
  projectToolVersion() {
    // Hermes keeps the stdio server alive between turns, even on session/load.
    const digest = createHash('sha256');
    for (const file of ['hermes-acp-surface.py', 'hermes-context.py', 'hermes-context-bridge.cjs', 'protoflow-mcp.cjs', 'protoflow-db-contract.cjs', 'generated/material-contract.cjs'])
      digest.update(fs.readFileSync(path.join(__dirname, file)));
    return digest.digest('hex');
  }
  // Renderer history follows the project across Hermes installations. If the
  // current installation has no binding, never create an unrelated replacement
  // or report a successful deletion while another installation owns the chat.
  assertProjectChatEnvironment(scope, dir) {
    const root = path.join(this.dataDir, 'projects');
    for (const project of fs.readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const candidate = path.join(root, project.name, 'conversations', path.basename(dir));
      if (candidate === dir) continue;
      const binding = path.join(candidate, 'session.json');
      if (!fs.existsSync(binding)) continue;
      const saved = JSON.parse(fs.readFileSync(binding, 'utf8'));
      if (saved.projectId === scope.projectId && conversationKey(saved) === conversationKey(scope))
        throw new Error(tr('这条会话在其他 Hermes 环境中有记录，请切回原环境后重试', 'This conversation belongs to another Hermes environment; please switch back to the original environment and retry'));
    }
  }
  mcp(dir, binding) {
    return [
      {
        name: "protoflow",
        command: this.nodeBinary,
        args: [
          path.join(__dirname, "protoflow-mcp.cjs"),
          path.join(dir, "context.json"),
        ],
        env: [
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          ...(binding ? [{ name: 'PROTOFLOW_TOOL_BINDING', value: binding }] : []),
          ...(isMainEn() ? [{ name: 'PROTOFLOW_LOCALE', value: 'en-US' }] : []),
        ],
      },
    ];
  }
  async locked(projectId, work) {
    const previous = this.locks.get(projectId) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.locks.set(projectId, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(projectId) === next) this.locks.delete(projectId);
    }
  }
  session(input) {
    return this.locked(input.projectId, () => this.ensureSession(input));
  }
  async ensureSession(input) {
    const setupStartedAt = performance.now();
    const scope = conversationScope(input), { projectId } = scope;
    const { fresh = false, refresh = false } = input;
    if (scope.kind === 'project' && fresh) throw new Error(tr('请通过新建会话保留原项目对话', 'Create a new conversation instead of resetting an existing project chat'));
    const key = conversationKey(scope);
    const connectStartedAt = performance.now();
    await this.connect();
    const connectMs = roundMs(performance.now() - connectStartedAt);
    const previous = this.sessions.get(key);
    // Both menu generation and project generation consume the material contract.
    const usesMaterials = scope.kind !== 'mindmap';
    const version = usesMaterials ? this.projectToolVersion() : undefined;
    const toolsChanged = previous && previous.toolVersion !== version;
    const expectedSkillFile = scope.kind === undefined
      ? path.join(this.workspace(projectId), 'AGENTS.md')
      : path.join(this.conversationWorkspace(scope), 'AGENTS.md');
    const currentSkillDigest = this.fileSkillDigest(expectedSkillFile);
    const nativePrompt = this.hasNativePromptControl();
    const skillChanged = Boolean(previous && (
      (previous.expectedSkillDigest ?? null) !== currentSkillDigest ||
      (nativePrompt && currentSkillDigest !== null && (previous.appliedSkillDigest ?? null) !== currentSkillDigest && !previous.pendingRefreshEpoch && !previous.freshlyCreated)
    ));
    if (previous?.running && (fresh || refresh || toolsChanged || skillChanged)) throw new Error(tr("当前项目有任务正在执行", "A task is currently running in this project"));
    if (previous && !fresh && !refresh && !toolsChanged && !skillChanged) {
      this.lastSessionSetup.set(key, {
        durationMs: roundMs(performance.now() - setupStartedAt),
        connectMs,
        promptRefreshMs: 0,
        acpSessionRpcMs: 0,
        reused: true,
        reloaded: false,
        created: false,
        reloadReason: null,
      });
      return this.publicSession(previous);
    }
    const dir = this.conversationWorkspace(scope),
      savedFile = path.join(dir, "session.json");
    if (scope.kind === 'project' && fs.existsSync(path.join(dir, 'deleted.json'))) throw new Error(tr('这条项目会话已删除，请切换会话', 'This project conversation has been deleted; please switch to another conversation'));
    let saved;
    if (!fresh) {
      try {
        saved = JSON.parse(fs.readFileSync(savedFile, "utf8"));
        if (!saved || typeof saved.sessionId !== 'string' || !saved.sessionId.trim()) throw new Error(tr('会话标识无效', 'Invalid session ID'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(tr('读取当前菜单的 Hermes 会话失败，原记录未覆盖', 'Failed to read the Hermes session for this menu; original record was preserved'));
      }
    }
    if (saved && conversationKey(saved) !== key)
      throw new Error(tr("会话项目或菜单归属不一致", "Session project or menu ownership mismatch"));
    if (scope.kind === 'project' && !saved) this.assertProjectChatEnvironment(scope, dir);
    const reloadReason = !previous
      ? (saved ? 'cold_load' : 'new_session')
      : fresh
        ? 'fresh'
        : refresh
          ? 'refresh'
          : toolsChanged
            ? 'tools_changed'
            : skillChanged
              ? 'skill_changed'
              : 'reload';
    // A failed rebind may already have replaced the gateway's policy. The next
    // attempt must load the saved session, not return its obsolete local receipt.
    this.sessions.delete(key);
    const diskSkillDigest = this.fileSkillDigest(path.join(dir, 'AGENTS.md'));
    const persistedSkill = this.readSkillState(dir);
    let appliedSkillDigest = saved && persistedSkill.sessionId === saved.sessionId && typeof persistedSkill.appliedSkillDigest === 'string'
      ? persistedSkill.appliedSkillDigest
      : null;
    if (saved && previous?.sessionId === saved.sessionId && typeof previous.appliedSkillDigest === 'string') {
      appliedSkillDigest = previous.appliedSkillDigest;
    }
    let pendingRefreshEpoch = saved && persistedSkill.sessionId === saved.sessionId &&
      persistedSkill.targetSkillDigest === diskSkillDigest && Number.isSafeInteger(persistedSkill.pendingRefreshEpoch)
      ? persistedSkill.pendingRefreshEpoch
      : 0;
    let promptRefreshMs = 0;
    if (saved && diskSkillDigest !== null && appliedSkillDigest !== diskSkillDigest && nativePrompt && !pendingRefreshEpoch) {
      const refreshStartedAt = performance.now();
      const refreshed = await this.nativeContext({ action: 'refresh_prompt', sessionId: saved.sessionId });
      promptRefreshMs = roundMs(performance.now() - refreshStartedAt);
      if (!Number.isSafeInteger(refreshed?.requestedEpoch) || refreshed.requestedEpoch <= 0)
        throw new Error(tr('Hermes 未能登记会话指令刷新', 'Hermes failed to register the session instruction refresh'));
      pendingRefreshEpoch = refreshed.requestedEpoch;
      this.writeSkillState(dir, {
        sessionId: saved.sessionId,
        appliedSkillDigest,
        targetSkillDigest: diskSkillDigest,
        pendingRefreshEpoch,
      });
    }
    // A new binding changes the ACP server spec, forcing the gateway to
    // rediscover tools in the SAME session instead of reusing its frozen list.
    const binding = usesMaterials ? randomUUID() : undefined;
    const params = { cwd: dir, mcpServers: this.mcp(dir, binding) };
    const abandonedFile = path.join(dir, 'context.json');
    const abandoned = draftRecovery.read(abandonedFile);
    if (abandoned?.active && abandoned.recovery && !previous?.running) {
      await draftRecovery.freezeContext(abandonedFile, abandoned.runId, 'uncertain');
    }
    const pageRunsDir = path.join(dir, 'page-runs');
    if (scope.kind === 'project' && !this.isConversationRunning(key) && fs.existsSync(pageRunsDir)) {
      for (const entry of fs.readdirSync(pageRunsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pageContextFile = path.join(pageRunsDir, entry.name, 'context.json');
        const pageAbandoned = draftRecovery.read(pageContextFile);
        if (pageAbandoned?.active && pageAbandoned.recovery) {
          await draftRecovery.freezeContext(pageContextFile, pageAbandoned.runId, 'uncertain');
        }
      }
    }
    const acpRpcStartedAt = performance.now();
    const response = saved
      ? await this.client.request(
          "session/load",
          { ...params, sessionId: saved.sessionId },
          120000,
        )
      : await this.client.request("session/new", params, 120000);
    const acpSessionRpcMs = roundMs(performance.now() - acpRpcStartedAt);
    const sessionId = saved ? saved.sessionId : response.sessionId;
    if (saved && response.sessionId !== undefined && response.sessionId !== saved.sessionId)
      throw new Error(tr('Hermes 恢复了其他会话，已保留原记录', 'Hermes restored a different session; original record was preserved'));
    // A new ACP session exists even if tool registration fails below. Remember
    // its exact ID for retries. An explicit menu reset keeps the old binding until successful.
    if (usesMaterials && !saved && !fresh && typeof sessionId === 'string' && sessionId.trim())
      atomicWrite(savedFile, { ...scope, sessionId });
    if (
      typeof sessionId !== "string" || !sessionId.trim() ||
      !response.models ||
      !Array.isArray(response.models.availableModels)
    )
      throw new Error(tr("Hermes 未提供有效会话或模型目录，请更新 Hermes", "Hermes did not return a valid session or model catalog; please update Hermes"));
    let projectTools;
    if (binding) {
      let receipt;
      try { receipt = JSON.parse(fs.readFileSync(path.join(dir, 'tool-registration.json'), 'utf8')); } catch {}
      if (receipt?.binding !== binding || !Array.isArray(receipt.tools) || !receipt.tools.length) {
        throw new Error(tr('Hermes 未加载当前项目工具，请刷新 AI 会话后重试。', 'Hermes did not load the project tools; please refresh the AI session and retry.'));
      }
      projectTools = receipt.tools;
    }
    const restoredPreferredEffort =
      saved &&
      (previous?.sessionId === saved.sessionId && previous.preferredEffort !== undefined
        ? previous.preferredEffort
        : saved.preferredModelId === response.models.currentModelId &&
            (saved.preferredEffort === null ||
              (typeof saved.preferredEffort === 'string' && saved.preferredEffort.trim()))
          ? (saved.preferredEffort === null ? null : saved.preferredEffort.trim())
          : null);
    const state = {
      ...scope,
      sessionId,
      dir,
      binding, toolVersion: version, projectTools,
      expectedSkillDigest: diskSkillDigest,
      appliedSkillDigest: saved ? appliedSkillDigest : null,
      pendingRefreshEpoch: saved ? pendingRefreshEpoch : 0,
      freshlyCreated: !saved,
      models: response.models,
      preferredEffort: restoredPreferredEffort ?? null,
      running: false,
    };
    if (!saved) {
      this.writeSkillState(dir, {
        sessionId,
        appliedSkillDigest: null,
        targetSkillDigest: diskSkillDigest,
        pendingRefreshEpoch: 0,
      });
    }
    this.sessions.set(key, state);
    const priorUnconsumed = this.unconsumedSessionSetup.get(key);
    const setupRecord = {
      durationMs: roundMs(performance.now() - setupStartedAt),
      connectMs,
      promptRefreshMs,
      acpSessionRpcMs,
      reused: false,
      reloaded: Boolean(saved),
      created: !saved,
      reloadReason,
    };
    this.lastSessionSetup.set(key, setupRecord);
    this.unconsumedSessionSetup.set(key, priorUnconsumed ? {
      durationMs: roundMs((priorUnconsumed.durationMs || 0) + setupRecord.durationMs),
      connectMs: roundMs((priorUnconsumed.connectMs || 0) + setupRecord.connectMs),
      promptRefreshMs: roundMs((priorUnconsumed.promptRefreshMs || 0) + setupRecord.promptRefreshMs),
      acpSessionRpcMs: roundMs((priorUnconsumed.acpSessionRpcMs || 0) + setupRecord.acpSessionRpcMs),
      reused: false,
      reloaded: Boolean(priorUnconsumed.reloaded || setupRecord.reloaded),
      created: Boolean(priorUnconsumed.created || setupRecord.created),
      reloadReason: priorUnconsumed.reloadReason ?? setupRecord.reloadReason,
    } : setupRecord);
    if (scope.kind === 'mindmap' || fresh) atomicWrite(savedFile, { ...scope, sessionId });
    return this.publicSession(state);
  }
  deleteProjectChat(input) {
    const scope = conversationScope(input);
    if (scope.kind !== 'project') throw new Error(tr('只能删除项目 AI 会话', 'Only project AI conversations can be deleted'));
    return this.locked(scope.projectId, async () => {
      const key = conversationKey(scope), session = this.sessions.get(key);
      if (this.isConversationRunning(key)) throw new Error(tr('请先停止当前会话的任务', 'Please stop the active task in this conversation first'));
      const dir = this.conversationWorkspace(scope);
      const savedFile = path.join(dir, 'session.json'), marker = path.join(dir, 'deleted.json');
      const identityKey = JSON.stringify([this.settings.home, this.settings.binary]);
      // Some pre-history projects were opened under multiple installations.
      // Remove only the selected installation's verified binding; keep the
      // renderer transcript until no installation still owns this chat.
      if (!fs.existsSync(savedFile)) this.assertProjectChatEnvironment(scope, dir);
      if (!fs.existsSync(marker)) {
        if (session && !fs.existsSync(savedFile)) throw new Error(tr('缺少 Hermes 会话绑定，未删除聊天记录', 'Missing Hermes session binding; chat history was not deleted'));
        if (fs.existsSync(savedFile)) {
          const saved = JSON.parse(fs.readFileSync(savedFile, 'utf8'));
          if (conversationKey(saved) !== key || typeof saved.sessionId !== 'string' || !saved.sessionId.trim() ||
              (session && session.sessionId !== saved.sessionId)) throw new Error(tr('项目会话归属不一致，无法删除', 'Project conversation ownership mismatch; cannot delete'));
          await this.deleteHistorySession?.(saved.sessionId, identityKey);
        }
        const pageRunsDir = path.join(dir, 'page-runs');
        if (fs.existsSync(pageRunsDir) && typeof this.deleteHistorySession === 'function') {
          for (const entry of fs.readdirSync(pageRunsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const pageSessionFile = path.join(pageRunsDir, entry.name, 'session.json');
            if (!fs.existsSync(pageSessionFile)) continue;
            try {
              const pageSaved = JSON.parse(fs.readFileSync(pageSessionFile, 'utf8'));
              if (conversationKey(pageSaved) !== key) continue;
              const pageIds = new Set([
                ...(typeof pageSaved.sessionId === 'string' && pageSaved.sessionId.trim() ? [pageSaved.sessionId] : []),
                ...(Array.isArray(pageSaved.lineage) ? pageSaved.lineage.filter(id => typeof id === 'string' && id.trim()) : []),
              ]);
              for (const pid of pageIds) {
                await this.deleteHistorySession(pid, identityKey).catch(() => {});
              }
            } catch {}
          }
        }
        atomicWrite(marker, {deleted:true});
      }
      for (const [taskKey, ps] of [...this.pageSessions.entries()]) {
        if (conversationKey(ps) === key) {
          ps.stopContext?.();
          this.pageSessions.delete(taskKey);
        }
      }
      this.activeProjectRuns.delete(key);
      this.sessions.delete(key);
      this.cancelVersions.delete(key);
      this.lastSessionSetup.delete(key);
      this.unconsumedSessionSetup.delete(key);
      for (const name of ['session.json','context.json','context.json.footprint.json','context.json.footprint.error','AGENTS.md','tool-registration.json','skill-state.json'])
        fs.rmSync(path.join(dir,name), {force:true});
      fs.rmSync(path.join(dir, 'page-runs'), { recursive: true, force: true });
      try {
        for (const name of fs.readdirSync(dir)) {
          if (name.startsWith('recovery-')) fs.rmSync(path.join(dir, name), { force: true });
        }
      } catch {}
      for (const name of ['tool-metrics.jsonl','telemetry-history.jsonl'])
        safeRemoveFile(path.join(dir,name));
      this.assertProjectChatEnvironment(scope, dir);
      this.chatImages.removeConversation(scope);
      return {deleted:true};
    });
  }
  publicSession(s) {
    const key = conversationKey(s);
    const lastSetup = this.lastSessionSetup.get(key);
    return {
      ...conversationScope(s),
      sessionId: s.sessionId,
      models: s.models,
      running: this.isConversationRunning(key),
      skillDigest: s.appliedSkillDigest ?? null,
      ...(s.kind === 'project' ? { projectTools: s.projectTools } : {}),
      ...(lastSetup ? { lastSetup } : {}),
    };
  }
  async setSessionModelInternal(s, modelId, { reload = true } = {}) {
    const modelOpId = randomUUID();
    s.activeModelOp = { opId: modelOpId, modelId };
    s.changingModel = true;
    try {
      await this.client.request(
        "session/set_model",
        { sessionId: s.sessionId, modelId, _meta: { alex_model_op_id: modelOpId } },
        120000,
      );
      if (!reload) return s.models;
      const response = await this.client.request(
        "session/load",
        { sessionId: s.sessionId, cwd: s.dir, mcpServers: this.mcp(s.dir, s.binding) },
        120000,
      );
      if (response.sessionId !== undefined && response.sessionId !== s.sessionId)
        throw new Error(tr("Hermes 返回了其他会话的模型状态", "Hermes returned model state for a different session"));
      if (!response.models || !Array.isArray(response.models.availableModels))
        throw new Error(tr("Hermes 未返回切换后的模型状态", "Hermes did not return the updated model state"));
      if (response.models.currentModelId !== modelId)
        throw new Error(tr("Hermes 尚未切换到所选模型，请刷新后重试", "Hermes has not switched to the selected model yet; please refresh and retry"));
      s.models = response.models;
      return response.models;
    } finally {
      s.changingModel = false;
      if (s.activeModelOp?.opId === modelOpId) s.activeModelOp = null;
      for (const [id, permission] of this.permissions) {
        if (permission.modelChangeSession === s && (!permission.modelOpId || permission.modelOpId === modelOpId)) {
          try { this.respondPermission({ id, optionId: null }); } catch {}
        }
      }
    }
  }
  setModel(input) {
    return this.locked(input.projectId, () => this.changeModel(input));
  }
  persistConversationPreferredEffort(s) {
    if (!s?.dir || !s.sessionId) return;
    const savedFile = path.join(s.dir, 'session.json');
    if (!fs.existsSync(savedFile)) return;
    try {
      const existing = JSON.parse(fs.readFileSync(savedFile, 'utf8'));
      if (!existing || existing.sessionId !== s.sessionId) return;
      atomicWrite(savedFile, {
        ...existing,
        preferredModelId: s.models?.currentModelId ?? null,
        preferredEffort: s.preferredEffort ?? null,
      });
    } catch {}
  }
  async changeModel(input) {
    const scope = conversationScope(input), { modelId } = input;
    const key = conversationKey(scope);
    if (this.isConversationRunning(key)) throw new Error(tr("请先停止生成，再切换当前会话模型", "Please stop generation before switching the conversation model"));
    await this.ensureSession(scope);
    const s = this.sessions.get(key);
    if (this.isConversationRunning(key)) throw new Error(tr("请先停止生成，再切换当前会话模型", "Please stop generation before switching the conversation model"));
    if (!s.models.availableModels.some((m) => m.modelId === modelId))
      throw new Error(tr("该模型不在 Hermes 当前可用模型列表中", "Selected model is not in Hermes's available model list"));
    await this.setSessionModelInternal(s, modelId, { reload: true });
    s.preferredEffort = null;
    this.persistConversationPreferredEffort(s);
    return this.publicSession(s);
  }
  async applySessionEffort(sessionId, modelId, effort, { requireResetBridge = false } = {}) {
    if (effort === undefined) return undefined;
    if (effort !== null && (typeof effort !== 'string' || !effort.trim())) {
      throw new Error(tr('推理强度无效', 'Invalid reasoning effort'));
    }
    const normalized = effort === null ? null : effort.trim();
    const info = this.info;
    if (!info?.installDir || !path.isAbsolute(info.installDir)) {
      return normalized;
    }
    if (!info.reasoningPython) {
      const launch = await this.runCommand(info.binary, ['--print-runtime-command'], info.home);
      let command;
      try { command = JSON.parse(launch.output); } catch {}
      if (!launch.ok || !Array.isArray(command) || typeof command[0] !== 'string' || !path.isAbsolute(command[0])) {
        if (normalized !== null || requireResetBridge) {
          throw new Error(tr('当前 Hermes 启动器未提供会话设置接口，请更新后重试', 'Current Hermes launcher does not provide the session settings interface; please update and retry'));
        }
        return null;
      }
      info.reasoningPython = command[0];
    }
    const script = fs.readFileSync(path.join(__dirname, 'hermes-reasoning.py'), 'utf8');
    const request = { sessionId, modelId, effort: normalized };
    const result = await new Promise((resolve, reject) => {
      const child = execFile(info.reasoningPython, ['-I','-c',script,info.installDir], {
        env:{...this.envFor(info.home), HERMES_HOME:info.home}, timeout:30000, maxBuffer:128*1024, windowsHide:true,
      }, (error, stdout) => {
        if (error) return reject(new Error(tr('未能连接 Hermes 会话设置，请检查连接后重试', 'Failed to connect to Hermes session settings; please check the connection and retry')));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error(tr('Hermes 返回的推理设置无效', 'Hermes returned invalid reasoning settings'))); }
      });
      child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(request));
    });
    if (result?.error) throw new Error(result.error);
    if (result?.sessionId !== sessionId || result?.modelId !== modelId) {
      throw new Error(tr('Hermes 返回了其他会话或无效的推理设置', 'Hermes returned reasoning settings for another session or in an invalid format'));
    }
    return normalized === null
      ? null
      : (typeof result?.wire === 'string' && result.wire ? result.wire : normalized);
  }
  reasoning(input) {
    return this.locked(input.projectId, async () => {
      const scope = conversationScope(input);
      const key = conversationKey(scope);
      const session = this.sessions.get(key);
      if (!session || scope.kind === 'mindmap' || session.sessionId !== input.sessionId ||
          !input.modelId || session.models.currentModelId !== input.modelId)
        throw new Error(tr('对话或模型已切换，请重新打开推理强度', 'Conversation or model has changed; please reopen reasoning effort settings'));
      if (this.isConversationRunning(key) && Object.hasOwn(input, 'effort')) throw new Error(tr('请等当前回复结束后调整推理强度', 'Please wait for the current response to finish before changing reasoning effort'));
      if (Object.hasOwn(input, 'effort') && input.effort !== null && typeof input.effort !== 'string')
        throw new Error(tr('推理强度无效', 'Invalid reasoning effort'));
      const info = this.info;
      if (!info?.installDir || !path.isAbsolute(info.installDir)) throw new Error(tr('当前 Hermes 未提供推理设置接口，请更新 Hermes 后重试', 'Current Hermes installation does not provide the reasoning settings interface; please update Hermes and retry'));
      if (!info.reasoningPython) {
        const launch = await this.runCommand(info.binary, ['--print-runtime-command'], info.home);
        let command;
        try { command = JSON.parse(launch.output); } catch { /* Older launchers do not expose their runtime. */ }
        if (!launch.ok || !Array.isArray(command) || typeof command[0] !== 'string' || !path.isAbsolute(command[0]))
          throw new Error(tr('当前 Hermes 启动器未提供会话设置接口，请更新后重试', 'Current Hermes launcher does not provide the session settings interface; please update and retry'));
        info.reasoningPython = command[0];
      }
      const script = fs.readFileSync(path.join(__dirname, 'hermes-reasoning.py'), 'utf8');
      const request = { sessionId:session.sessionId, modelId:input.modelId,
        ...(Object.hasOwn(input,'effort') ? {effort:input.effort} : {}) };
      const result = await new Promise((resolve, reject) => {
        const child = execFile(info.reasoningPython, ['-I','-c',script,info.installDir], {
          env:{...this.envFor(info.home), HERMES_HOME:info.home}, timeout:30000, maxBuffer:128*1024, windowsHide:true,
        }, (error, stdout) => {
          if (error) return reject(new Error(tr('未能连接 Hermes 会话设置，请检查连接后重试', 'Failed to connect to Hermes session settings; please check the connection and retry')));
          try { resolve(JSON.parse(stdout)); } catch { reject(new Error(tr('Hermes 返回的推理设置无效', 'Hermes returned invalid reasoning settings'))); }
        });
        child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(request));
      });
      if (result?.error) throw new Error(result.error);
      if (this.info !== info || this.sessions.get(key) !== session ||
          result?.sessionId !== session.sessionId || result.modelId !== session.models.currentModelId ||
          typeof result.current !== 'string' || typeof result.wire !== 'string' || typeof result.generalLevels !== 'boolean' ||
          !Array.isArray(result.levels) || !result.levels.every(level => typeof level === 'string'))
        throw new Error(tr('Hermes 返回了其他会话或无效的推理设置，请重新打开', 'Hermes returned reasoning settings for another session or in an invalid format; please reopen'));
      if (Object.hasOwn(input, 'effort')) {
        session.preferredEffort = input.effort === null ? null : result.wire;
        this.persistConversationPreferredEffort(session);
      }
      return result;
    });
  }
  saveImages(input) {
    const scope = conversationScope(input);
    if (scope.kind === 'project' && fs.existsSync(path.join(this.conversationWorkspace(scope), 'deleted.json')))
      throw new Error(tr('这条项目会话已删除，请切换会话', 'This project conversation has been deleted; please switch to another conversation'));
    return this.chatImages.save(input);
  }
  readImage(input) { return this.chatImages.read(input); }
  async contextBridge() {
    const info = this.info;
    if (!info?.installDir || !path.isAbsolute(info.installDir)) throw new Error(tr('当前 Hermes 未提供上下文接口，请更新后重试', 'Current Hermes installation does not provide the context interface; please update and retry'));
    if (!info.contextPython) {
      const launch = await this.runCommand(info.binary, ['--print-runtime-command'], info.home);
      let command;
      try { command = JSON.parse(launch.output); } catch {}
      if (!launch.ok || !Array.isArray(command) || typeof command[0] !== 'string' || !path.isAbsolute(command[0]))
        throw new Error(tr('当前 Hermes 启动器未提供上下文接口', 'Current Hermes launcher does not provide the context interface'));
      info.contextPython = command[0];
    }
    return { python: info.contextPython, installDir: info.installDir, home: info.home };
  }
  async nativeContext(request) {
    const bridge = await this.contextBridge();
    if (PERSISTENT_ACTIONS.has(request.action)) {
      // Reuses the interpreter/imports only. Each call is a fresh Hermes query;
      // refresh/verify results are never cached across calls or turns.
      let answer;
      try {
        answer = await this.contextPool.request(bridge, request, { timeoutMs: 30000 });
      } catch {
        throw new Error(tr('无法连接 Hermes 上下文接口', 'Failed to connect to the Hermes context interface'));
      }
      this.lastContextBridgeUse = { action: request.action, mode: answer.mode, coldStart: answer.coldStart, durationMs: roundMs(answer.durationMs) };
      const result = answer.result;
      if (!result || typeof result !== 'object') throw new Error(tr('Hermes 上下文响应无效', 'Invalid Hermes context response'));
      if (result.error) throw new Error(result.error);
      if (result.sessionId !== request.sessionId) throw new Error(tr('Hermes 返回了其他会话的上下文', 'Hermes returned context for a different session'));
      return result;
    }
    const script = readContextScript();
    return new Promise((resolve, reject) => {
      const child = execFile(bridge.python, ['-I', '-c', script, bridge.installDir], {
        env: { ...this.envFor(bridge.home), HERMES_HOME: bridge.home }, windowsHide: true,
        timeout: request.action === 'compress' ? 0 : 30000, maxBuffer: 256 * 1024,
      }, (error, stdout) => {
        if (error) return reject(new Error(tr('无法连接 Hermes 上下文接口', 'Failed to connect to the Hermes context interface')));
        try {
          const result = JSON.parse(stdout);
          if (result.error) return reject(new Error(result.error));
          if (result.sessionId !== request.sessionId) return reject(new Error(tr('Hermes 返回了其他会话的上下文', 'Hermes returned context for a different session')));
          resolve(result);
        } catch { reject(new Error(tr('Hermes 上下文响应无效', 'Invalid Hermes context response'))); }
      });
      child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(request));
    });
  }
  acceptContext(s, state) {
    if (!s || state.sessionId !== s.sessionId) return;
    const key = conversationKey(s);
    if (s.isPageExec) {
      if (this.pageSessions.get(s.taskKey) !== s || this.activeProjectRuns.get(key) !== s || !s.running || s.cancelled) return;
    } else {
      if (this.sessions.get(key) !== s) return;
      const activeRun = this.activeProjectRuns.get(key);
      if (activeRun && activeRun !== s && activeRun.running) return;
    }
    const usage = state.usage;
    if (usage) {
      for (const field of ['used', 'size', 'compressions']) if (usage[field] !== undefined &&
          (!Number.isSafeInteger(usage[field]) || usage[field] < 0 || (field === 'size' && usage[field] === 0))) return;
      const changed = usage.compressions !== undefined && s.context?.compressions !== undefined && usage.compressions > s.context.compressions;
      if (changed) {
        s.contextEpoch = (s.contextEpoch || 0) + 1;
        // Separate file: never race the MCP process's staged snapshot/journal writes.
        atomicWrite(path.join(s.dir, 'context-epoch.json'), { sessionId: s.sessionId, epoch: s.contextEpoch });
      }
      s.context = { ...s.context, ...usage, ...(changed ? { compacting: false } : {}) };
      if (usage.available === false) { delete s.context.used; delete s.context.size; delete s.context.estimated; }
    }
    if (typeof state.compacting === 'boolean') s.context = { ...s.context, compacting: state.compacting };
    this.emit({
      type: 'context-update',
      ...conversationScope(s),
      ...this.eventIdentity(s),
      ...(s.running && s.runId ? { runId: s.runId } : {}),
      context: s.context,
    });
  }
  async watchContext(s) {
    const bridge = await this.contextBridge();
    const child = spawn(bridge.python, ['-I', '-c', readContextScript(), bridge.installDir], {
      env: { ...this.envFor(bridge.home), HERMES_HOME: bridge.home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let buffer = '', ready, stopped = false;
    const started = new Promise(resolve => { ready = resolve; });
    const timer = setTimeout(() => {
      if (!s.isPageExec || (this.activeProjectRuns.get(conversationKey(s)) === s && s.running && !s.cancelled)) {
        this.emit({type:'context-error', ...conversationScope(s), ...this.eventIdentity(s), ...(s.running && s.runId ? { runId: s.runId } : {}), message:tr('上下文状态订阅超时，可稍后刷新用量', 'Context status subscription timed out; you can refresh usage later')});
      }
      stop();
    }, 15000);
    const stop = () => { stopped = true; clearTimeout(timer); child.kill(); ready(); };
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 256 * 1024) return stop();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const state = JSON.parse(line);
          if (state.ready) { clearTimeout(timer); ready(); }
          else if (state.error) {
            if (!s.isPageExec || (this.activeProjectRuns.get(conversationKey(s)) === s && s.running && !s.cancelled)) {
              this.emit({ type: 'context-error', ...conversationScope(s), ...this.eventIdentity(s), ...(s.running && s.runId ? { runId: s.runId } : {}), message: state.error });
            }
            stop();
          }
          else this.acceptContext(s, state);
        } catch { stop(); }
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', stop); child.on('close', () => {
      if (!stopped && (!s.isPageExec || (this.activeProjectRuns.get(conversationKey(s)) === s && s.running && !s.cancelled))) {
        this.emit({type:'context-error', ...conversationScope(s), ...this.eventIdentity(s), ...(s.running && s.runId ? { runId: s.runId } : {}), message:tr('上下文状态订阅已断开，可刷新用量；写入前仍会核对压缩次数', 'Context status subscription disconnected; you can refresh usage manually (compression count will still be verified before writes)')});
      }
      clearTimeout(timer); ready();
    });
    child.stdin.on('error', stop);
    child.stdin.end(JSON.stringify({ action: 'watch', sessionId: s.sessionId }));
    s.stopContext = stop;
    await started;
    return stop;
  }
  buildAllowedHistorySessions(scope, s, planningSession = s) {
    if (scope.kind === 'project') {
      if (s?.isPageExec) {
        return [
          { sessionId: s.sessionId, role: 'page_execution', expectedCwd: s.dir },
          ...(Array.isArray(s.lineage)
            ? s.lineage
                .filter(id => typeof id === 'string' && id.trim() && id !== s.sessionId)
                .map(id => ({ sessionId: id, role: 'page_execution_prior', expectedCwd: s.dir }))
            : []),
          { sessionId: planningSession.sessionId, role: 'project_planning', expectedCwd: planningSession.dir },
        ];
      }
      return [{ sessionId: s.sessionId, role: 'project_planning', expectedCwd: s.dir }];
    }
    if (scope.kind === 'mindmap') {
      return [];
    }
    return [{ sessionId: s.sessionId, role: 'menu_session', expectedCwd: s.dir }];
  }
  context(input) {
    return this.locked(input.projectId, async () => {
      const scope = conversationScope(input);
      if (scope.kind !== 'project') throw new Error(tr('此入口仅用于项目 AI', 'This endpoint is only available for project AI'));
      const key = conversationKey(scope);
      const planning = this.sessions.get(key);
      const activeRun = this.activeProjectRuns.get(key);
      if (!planning || (planning.sessionId !== input.sessionId && activeRun?.sessionId !== input.sessionId)) {
        throw new Error(tr('会话已切换，请重新打开上下文', 'Session has changed; please reopen context'));
      }
      if (!['usage', 'history', 'compress'].includes(input.action)) throw new Error(tr('未知上下文操作', 'Unknown context action'));
      const target = activeRun?.running ? activeRun : planning;
      if (input.action === 'compress' && this.isConversationRunning(key)) throw new Error(tr('请等当前任务结束后整理上下文', 'Please wait for the current task to finish before compacting context'));
      const result = await this.nativeContext({ sessionId: target.sessionId, action: input.action,
        ...(input.action === 'history' ? {
          query: input.query,
          offset: input.offset,
          allowedHistorySessions: this.buildAllowedHistorySessions(scope, target, planning),
        } : {}) });
      if (this.sessions.get(key) !== planning) throw new Error(tr('会话已切换，结果已忽略', 'Session has changed; result ignored'));
      if (input.action === 'compress') {
        target.contextEpoch = (target.contextEpoch || 0) + 1;
        atomicWrite(path.join(target.dir, 'context-epoch.json'), { sessionId: target.sessionId, epoch: target.contextEpoch });
      }
      this.acceptContext(target, result);
      return result;
    });
  }
  verifyToolReceipt(dir, binding) {
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(path.join(dir, 'tool-registration.json'), 'utf8')); } catch {}
    if (receipt?.binding !== binding || !Array.isArray(receipt.tools) || !receipt.tools.length) {
      return null;
    }
    return receipt.tools;
  }
  async ensurePageExecutionSession({
    scope,
    planningSession,
    paths,
    taskKey,
    targetPageId,
    recoverCheckpoint = null,
    rotateSession = false,
  }) {
    const setupStartedAt = performance.now();
    const convDir = planningSession.dir;
    const execDir = paths.execDir;
    fs.mkdirSync(execDir, { recursive: true, mode: 0o700 });
    const parentSkill = path.join(convDir, 'AGENTS.md');
    const execSkill = path.join(execDir, 'AGENTS.md');
    if (fs.existsSync(parentSkill)) {
      writeSkillFileIfChanged(execSkill, fs.readFileSync(parentSkill, 'utf8'));
    }
    const desiredModelId = planningSession.models.currentModelId;
    const desiredEffort =
      typeof planningSession.preferredEffort === 'string' && planningSession.preferredEffort.trim()
        ? planningSession.preferredEffort.trim()
        : null;
    const readPersistedAppliedEffort = (record, currentModelId) => {
      if (
        record &&
        (!record.appliedModelId || record.appliedModelId === currentModelId) &&
        (record.appliedEffort === null ||
          (typeof record.appliedEffort === 'string' && record.appliedEffort.trim()))
      ) {
        return {
          known: true,
          effort: record.appliedEffort === null ? null : record.appliedEffort.trim(),
        };
      }
      return { known: false, effort: undefined };
    };
    const persistPageSessionRecord = (sessionId, lineage, appliedModelId, appliedEffort) => {
      draftRecovery.durableWrite(paths.sessionFile, {
        ...scope,
        workflowPhase: 'generating',
        targetPageId,
        sessionId,
        lineage,
        appliedModelId,
        appliedEffort,
      });
    };
    const version = this.projectToolVersion();
    const diskSkillDigest = this.fileSkillDigest(execSkill);
    const nativePrompt = this.hasNativePromptControl();
    const previous = this.pageSessions.get(taskKey);

    let saved = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.sessionFile, 'utf8'));
      if (!parsed || typeof parsed.sessionId !== 'string' || !parsed.sessionId.trim()) {
        throw new Error(tr('子会话标识无效', 'Invalid sub-session ID'));
      }
      saved = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(tr('读取当前页面的 Hermes 子会话失败，原记录未覆盖', 'Failed to read the Hermes sub-session for this page; original record was preserved'));
    }
    if (saved && (conversationKey(saved) !== conversationKey(scope) || saved.targetPageId !== targetPageId)) {
      throw new Error(tr('页面执行会话归属不一致', 'Page execution session ownership mismatch'));
    }
    const priorLineage = Array.isArray(saved?.lineage)
      ? saved.lineage.filter(id => typeof id === 'string' && id.trim())
      : [];

    const toolsChanged = Boolean(previous && previous.toolVersion !== version);
    const skillChanged = Boolean(previous && (
      (previous.expectedSkillDigest ?? null) !== diskSkillDigest ||
      (nativePrompt && diskSkillDigest !== null && (previous.appliedSkillDigest ?? null) !== diskSkillDigest && !previous.pendingRefreshEpoch && !previous.freshlyCreated)
    ));
    const modelChanged = Boolean(previous && previous.models?.currentModelId !== desiredModelId);
    const hasPendingMigration = Boolean(recoverCheckpoint?.recovery?.pendingMigration);

    if (
      previous &&
      saved &&
      previous.sessionId === saved.sessionId &&
      !toolsChanged &&
      !skillChanged &&
      !modelChanged &&
      !hasPendingMigration &&
      !rotateSession
    ) {
      const prevKnown =
        previous.appliedEffortKnown === true &&
        (previous.appliedEffort === null || typeof previous.appliedEffort === 'string');
      const persistedEffort = readPersistedAppliedEffort(saved, desiredModelId);
      const currentKnown = prevKnown || persistedEffort.known;
      const currentAppliedEffort = prevKnown ? previous.appliedEffort : persistedEffort.effort;
      if (!currentKnown || currentAppliedEffort !== desiredEffort) {
        const hadNonNullEffort = typeof currentAppliedEffort === 'string' && currentAppliedEffort.length > 0;
        const applied = await this.applySessionEffort(previous.sessionId, desiredModelId, desiredEffort, {
          requireResetBridge: hadNonNullEffort,
        });
        previous.appliedEffort = applied ?? null;
        previous.appliedEffortKnown = true;
        persistPageSessionRecord(previous.sessionId, priorLineage, desiredModelId, previous.appliedEffort);
      } else if (!prevKnown) {
        previous.appliedEffort = currentAppliedEffort ?? null;
        previous.appliedEffortKnown = true;
      }
      previous.planningSessionId = planningSession.sessionId;
      previous.lineage = priorLineage;
      return {
        session: previous,
        checkpoint: recoverCheckpoint,
        migratedAcrossSessions: false,
        setupRecord: {
          durationMs: roundMs(performance.now() - setupStartedAt),
          connectMs: 0,
          promptRefreshMs: 0,
          acpSessionRpcMs: 0,
          reused: true,
          reloaded: false,
          created: false,
          reloadReason: null,
        },
      };
    }

    this.pageSessions.delete(taskKey);
    let checkpoint = recoverCheckpoint;
    let migratedAcrossSessions = false;

    const runMigrationWal = async (fromSessionId, reason) => {
      // Step 1: Write-ahead migration intent BEFORE calling session/new.
      let pending = checkpoint?.recovery?.pendingMigration;
      if (!pending) {
        pending = {
          opId: randomBytes(16).toString('hex'),
          createBinding: randomUUID(),
          fromSessionId,
          desiredModelId,
          desiredEffort,
          reason,
          createdAt: new Date().toISOString(),
        };
        if (checkpoint) {
          checkpoint = {
            ...checkpoint,
            recovery: {
              ...checkpoint.recovery,
              pendingMigration: pending,
            },
          };
          draftRecovery.durableWrite(paths.checkpointPath, checkpoint);
        }
      }

      // Step 2: Idempotently acquire the single target session.
      const resumingExistingTarget = Boolean(
        typeof pending.toSessionId === 'string' && pending.toSessionId.trim(),
      );
      let targetSessionId = resumingExistingTarget ? pending.toSessionId : null;
      let activeBinding = pending.createBinding || randomUUID();
      let response = null;
      const acpStarted = performance.now();
      if (!targetSessionId) {
        const created = await this.client.request(
          'session/new',
          {
            cwd: execDir,
            mcpServers: this.mcp(execDir, activeBinding),
            _meta: { alex_request_id: pending.opId },
          },
          120000,
        );
        targetSessionId = created?.sessionId;
        if (typeof targetSessionId !== 'string' || !targetSessionId.trim()) {
          throw new Error(tr('Hermes 未返回有效的迁移目标会话', 'Hermes did not return a valid migration target session'));
        }
        pending = { ...pending, toSessionId: targetSessionId };
        if (checkpoint) {
          checkpoint = {
            ...checkpoint,
            recovery: {
              ...checkpoint.recovery,
              pendingMigration: pending,
            },
          };
          draftRecovery.durableWrite(paths.checkpointPath, checkpoint);
        }
        response = created;
      } else {
        activeBinding = randomUUID();
        response = await this.client.request(
          'session/load',
          {
            cwd: execDir,
            sessionId: targetSessionId,
            mcpServers: this.mcp(execDir, activeBinding),
          },
          120000,
        );
      }

      let projectTools = this.verifyToolReceipt(execDir, activeBinding);
      if (!projectTools) {
        // On idempotent `same_create_retry`, Gateway returns the existing snapshot without re-spawning MCP;
        // re-bind explicitly with a fresh binding so `tool-registration.json` is freshly verified.
        activeBinding = randomUUID();
        response = await this.client.request(
          'session/load',
          {
            cwd: execDir,
            sessionId: targetSessionId,
            mcpServers: this.mcp(execDir, activeBinding),
          },
          120000,
        );
        projectTools = this.verifyToolReceipt(execDir, activeBinding);
      }
      if (!projectTools) {
        throw new Error(tr('Hermes 未加载当前页面执行工具，请刷新 AI 会话后重试。', 'Hermes did not load the page execution tools; please refresh the AI session and retry.'));
      }
      if (!response?.models || !Array.isArray(response.models.availableModels)) {
        throw new Error(tr('Hermes 未提供有效会话或模型目录，请更新 Hermes', 'Hermes did not return a valid session or model catalog; please update Hermes'));
      }
      const acpSessionRpcMs = roundMs(performance.now() - acpStarted);

      const state = {
        ...scope,
        isPageExec: true,
        workflowPhase: 'generating',
        targetPageId,
        taskKey,
        planningSessionId: planningSession.sessionId,
        sessionId: targetSessionId,
        dir: execDir,
        binding: activeBinding,
        toolVersion: version,
        projectTools,
        expectedSkillDigest: diskSkillDigest,
        appliedSkillDigest: null,
        pendingRefreshEpoch: 0,
        freshlyCreated: true,
        models: response.models,
        running: false,
        activeModelOp: null,
      };
      this.pageSessions.set(taskKey, state);

      // Step 3: Sync desired model and reasoning effort onto targetSessionId BEFORE switching session.json.
      let appliedTargetModel = pending.desiredModelId || desiredModelId;
      let appliedTargetEffort = null;
      try {
        const targetEffort =
          pending.desiredEffort === undefined
            ? desiredEffort
            : (typeof pending.desiredEffort === 'string' && pending.desiredEffort.trim()
                ? pending.desiredEffort.trim()
                : null);
        if (state.models.currentModelId !== appliedTargetModel) {
          await this.setSessionModelInternal(state, appliedTargetModel, { reload: true });
        }
        appliedTargetModel = state.models.currentModelId;
        if (targetEffort !== null || resumingExistingTarget) {
          appliedTargetEffort = await this.applySessionEffort(targetSessionId, appliedTargetModel, targetEffort);
          appliedTargetEffort = appliedTargetEffort ?? null;
        }
      } catch (step3Error) {
        this.pageSessions.delete(taskKey);
        throw step3Error;
      }

      // Step 4: Atomically switch <execDir>/session.json with bounded lineage (max 20).
      const nextLineage = [
        ...new Set(
          [...priorLineage, pending.fromSessionId].filter(
            id => typeof id === 'string' && id.trim() && id !== targetSessionId,
          ),
        ),
      ].slice(-20);
      persistPageSessionRecord(targetSessionId, nextLineage, appliedTargetModel, appliedTargetEffort);
      state.lineage = nextLineage;
      state.appliedEffort = appliedTargetEffort;
      state.appliedEffortKnown = true;
      this.writeSkillState(execDir, {
        sessionId: targetSessionId,
        appliedSkillDigest: null,
        targetSkillDigest: diskSkillDigest,
        pendingRefreshEpoch: 0,
      });

      // Step 5: Archive pendingMigration into sessionMigrations[] and commit identity.sessionId.
      if (checkpoint) {
        const { pendingMigration: _removed, ...restRecovery } = checkpoint.recovery;
        const completedEntry = {
          ...pending,
          toSessionId: targetSessionId,
          completedAt: new Date().toISOString(),
        };
        checkpoint = {
          ...checkpoint,
          recovery: {
            ...restRecovery,
            identity: {
              ...restRecovery.identity,
              sessionId: targetSessionId,
            },
            sessionMigrations: [...(restRecovery.sessionMigrations || []), completedEntry],
          },
        };
        draftRecovery.durableWrite(paths.checkpointPath, checkpoint);
      }
      migratedAcrossSessions = true;
      return {
        session: state,
        checkpoint,
        migratedAcrossSessions,
        setupRecord: {
          durationMs: roundMs(performance.now() - setupStartedAt),
          connectMs: 0,
          promptRefreshMs: 0,
          acpSessionRpcMs,
          reused: false,
          reloaded: false,
          created: true,
          reloadReason: 'session_migrated',
        },
      };
    };

    if (hasPendingMigration) {
      const pendingFrom = checkpoint.recovery.pendingMigration.fromSessionId || saved?.sessionId || null;
      return runMigrationWal(pendingFrom, checkpoint.recovery.pendingMigration.reason || 'resume_pending_migration');
    }

    if (saved && rotateSession && checkpoint) {
      return runMigrationWal(saved.sessionId, 'compaction_boundary_rotation');
    }

    const persistedSkill = this.readSkillState(execDir);
    let appliedSkillDigest =
      saved && persistedSkill.sessionId === saved.sessionId && typeof persistedSkill.appliedSkillDigest === 'string'
        ? persistedSkill.appliedSkillDigest
        : null;
    if (saved && previous?.sessionId === saved.sessionId && typeof previous.appliedSkillDigest === 'string') {
      appliedSkillDigest = previous.appliedSkillDigest;
    }
    let pendingRefreshEpoch =
      saved &&
      persistedSkill.sessionId === saved.sessionId &&
      persistedSkill.targetSkillDigest === diskSkillDigest &&
      Number.isSafeInteger(persistedSkill.pendingRefreshEpoch)
        ? persistedSkill.pendingRefreshEpoch
        : 0;
    let promptRefreshMs = 0;

    if (saved) {
      const binding = randomUUID();
      const acpStarted = performance.now();
      let response = null;
      let loadNotFound = false;
      try {
        response = await this.client.request(
          'session/load',
          { cwd: execDir, sessionId: saved.sessionId, mcpServers: this.mcp(execDir, binding) },
          120000,
        );
        if (!response) loadNotFound = true;
      } catch (loadError) {
        if (isSessionNotFoundError(loadError)) {
          loadNotFound = true;
        } else {
          throw loadError;
        }
      }
      if (loadNotFound) {
        if (checkpoint) {
          return runMigrationWal(saved.sessionId, 'session_not_found');
        }
        // No uncommitted checkpoint: rotate cleanly to a fresh page session while preserving lineage.
        return runMigrationWal(saved.sessionId, 'session_not_found_clean');
      }
      const acpSessionRpcMs = roundMs(performance.now() - acpStarted);
      if (response.sessionId !== undefined && response.sessionId !== saved.sessionId) {
        throw new Error(tr('Hermes 恢复了其他页面子会话，已保留原记录', 'Hermes restored a different page sub-session; original record was preserved'));
      }
      if (!response.models || !Array.isArray(response.models.availableModels)) {
        throw new Error(tr('Hermes 未提供有效会话或模型目录，请更新 Hermes', 'Hermes did not return a valid session or model catalog; please update Hermes'));
      }
      const projectTools = this.verifyToolReceipt(execDir, binding);
      if (!projectTools) {
        throw new Error(tr('Hermes 未加载当前页面执行工具，请刷新 AI 会话后重试。', 'Hermes did not load the page execution tools; please refresh the AI session and retry.'));
      }
      if (diskSkillDigest !== null && appliedSkillDigest !== diskSkillDigest && nativePrompt && !pendingRefreshEpoch) {
        const refreshStartedAt = performance.now();
        const refreshed = await this.nativeContext({ action: 'refresh_prompt', sessionId: saved.sessionId });
        promptRefreshMs = roundMs(performance.now() - refreshStartedAt);
        if (!Number.isSafeInteger(refreshed?.requestedEpoch) || refreshed.requestedEpoch <= 0) {
          throw new Error(tr('Hermes 未能登记页面子会话指令刷新', 'Hermes failed to register the page sub-session instruction refresh'));
        }
        pendingRefreshEpoch = refreshed.requestedEpoch;
        this.writeSkillState(execDir, {
          sessionId: saved.sessionId,
          appliedSkillDigest,
          targetSkillDigest: diskSkillDigest,
          pendingRefreshEpoch,
        });
      }
      const state = {
        ...scope,
        isPageExec: true,
        workflowPhase: 'generating',
        targetPageId,
        taskKey,
        planningSessionId: planningSession.sessionId,
        sessionId: saved.sessionId,
        lineage: priorLineage,
        dir: execDir,
        binding,
        toolVersion: version,
        projectTools,
        expectedSkillDigest: diskSkillDigest,
        appliedSkillDigest,
        pendingRefreshEpoch,
        freshlyCreated: false,
        models: response.models,
        running: false,
        activeModelOp: null,
      };
      this.pageSessions.set(taskKey, state);
      try {
        if (!checkpoint && state.models.currentModelId !== desiredModelId) {
          await this.setSessionModelInternal(state, desiredModelId, { reload: true });
          let appliedEffort = null;
          if (desiredEffort !== null) {
            appliedEffort = await this.applySessionEffort(state.sessionId, desiredModelId, desiredEffort);
          }
          state.appliedEffort = appliedEffort ?? null;
          state.appliedEffortKnown = true;
          persistPageSessionRecord(
            state.sessionId,
            priorLineage,
            state.models.currentModelId,
            state.appliedEffort,
          );
        } else {
          const persistedEffort = readPersistedAppliedEffort(saved, state.models.currentModelId);
          if (!persistedEffort.known || persistedEffort.effort !== desiredEffort) {
            const hadNonNullEffort =
              typeof persistedEffort.effort === 'string' && persistedEffort.effort.length > 0;
            const appliedEffort = await this.applySessionEffort(
              state.sessionId,
              state.models.currentModelId,
              desiredEffort,
              { requireResetBridge: hadNonNullEffort },
            );
            state.appliedEffort = appliedEffort ?? null;
            state.appliedEffortKnown = true;
            persistPageSessionRecord(
              state.sessionId,
              priorLineage,
              state.models.currentModelId,
              state.appliedEffort,
            );
          } else {
            state.appliedEffort = persistedEffort.effort ?? null;
            state.appliedEffortKnown = true;
          }
        }
      } catch (coldSyncError) {
        this.pageSessions.delete(taskKey);
        throw coldSyncError;
      }
      return {
        session: state,
        checkpoint,
        migratedAcrossSessions: false,
        setupRecord: {
          durationMs: roundMs(performance.now() - setupStartedAt),
          connectMs: 0,
          promptRefreshMs,
          acpSessionRpcMs,
          reused: false,
          reloaded: true,
          created: false,
          reloadReason: !previous ? 'cold_load' : toolsChanged ? 'tools_changed' : skillChanged ? 'skill_changed' : modelChanged ? 'model_changed' : 'reload',
        },
      };
    }

    // First-time creation of per-page execution session (<execDir>/session.json).
    const binding = randomUUID();
    const acpStarted = performance.now();
    const created = await this.client.request(
      'session/new',
      { cwd: execDir, mcpServers: this.mcp(execDir, binding) },
      120000,
    );
    const acpSessionRpcMs = roundMs(performance.now() - acpStarted);
    const sessionId = created?.sessionId;
    if (
      typeof sessionId !== 'string' ||
      !sessionId.trim() ||
      !created.models ||
      !Array.isArray(created.models.availableModels)
    ) {
      throw new Error(tr('Hermes 未提供有效会话或模型目录，请更新 Hermes', 'Hermes did not return a valid session or model catalog; please update Hermes'));
    }
    const projectTools = this.verifyToolReceipt(execDir, binding);
    if (!projectTools) {
      throw new Error(tr('Hermes 未加载当前页面执行工具，请刷新 AI 会话后重试。', 'Hermes did not load the page execution tools; please refresh the AI session and retry.'));
    }
    const state = {
      ...scope,
      isPageExec: true,
      workflowPhase: 'generating',
      targetPageId,
      taskKey,
      planningSessionId: planningSession.sessionId,
      sessionId,
      lineage: [],
      dir: execDir,
      binding,
      toolVersion: version,
      projectTools,
      expectedSkillDigest: diskSkillDigest,
      appliedSkillDigest: null,
      pendingRefreshEpoch: 0,
      freshlyCreated: true,
      models: created.models,
      running: false,
      activeModelOp: null,
    };
    this.pageSessions.set(taskKey, state);
    let initialAppliedEffort = null;
    try {
      if (state.models.currentModelId !== desiredModelId) {
        await this.setSessionModelInternal(state, desiredModelId, { reload: true });
      }
      if (desiredEffort !== null) {
        initialAppliedEffort = await this.applySessionEffort(sessionId, state.models.currentModelId, desiredEffort);
        initialAppliedEffort = initialAppliedEffort ?? null;
      }
    } catch (initModelError) {
      this.pageSessions.delete(taskKey);
      throw initModelError;
    }
    state.appliedEffort = initialAppliedEffort;
    state.appliedEffortKnown = true;
    persistPageSessionRecord(sessionId, [], state.models.currentModelId, initialAppliedEffort);
    this.writeSkillState(execDir, {
      sessionId,
      appliedSkillDigest: null,
      targetSkillDigest: diskSkillDigest,
      pendingRefreshEpoch: 0,
    });
    return {
      session: state,
      checkpoint,
      migratedAcrossSessions: false,
      setupRecord: {
        durationMs: roundMs(performance.now() - setupStartedAt),
        connectMs: 0,
        promptRefreshMs: 0,
        acpSessionRpcMs,
        reused: false,
        reloaded: false,
        created: true,
        reloadReason: 'new_page_session',
      },
    };
  }
  advanceAcpTimeline(s, now = performance.now()) {
    if (!s || typeof s.acpSliceCursor !== 'number') return;
    const delta = Math.max(0, now - s.acpSliceCursor);
    s.acpSliceCursor = now;
    if (delta <= 0) return;
    if (s.userWaitActive) {
      s.userWaitMs = (s.userWaitMs || 0) + delta;
    } else if (s.openNativeTools && s.openNativeTools.size > 0) {
      s.nativeToolExecMs = (s.nativeToolExecMs || 0) + delta;
      const share = delta / s.openNativeTools.size;
      for (const entry of s.openNativeTools.values()) {
        entry.elapsedMs += share;
      }
    }
  }
  recordCompletedNativeTool(s, toolName, elapsedMs, failed) {
    s.nativeToolCallCount = (s.nativeToolCallCount || 0) + 1;
    if (failed) s.failedNativeToolCallCount = (s.failedNativeToolCallCount || 0) + 1;
    const breakdown = s.nativeToolBreakdown || (s.nativeToolBreakdown = {});
    const prev = breakdown[toolName] || { count: 0, failedCount: 0, totalMs: 0 };
    prev.count += 1;
    if (failed) prev.failedCount += 1;
    prev.totalMs = roundMs(prev.totalMs + elapsedMs);
    breakdown[toolName] = prev;
  }
  closeNativeToolEntry(s, id, failed = false) {
    if (!s?.openNativeTools) return;
    const entry = s.openNativeTools.get(id);
    if (!entry) return;
    s.openNativeTools.delete(id);
    this.recordCompletedNativeTool(s, entry.toolName, entry.elapsedMs, Boolean(entry.failed || failed));
  }
  closeAllOpenNativeTools(s, now = performance.now()) {
    if (!s?.openNativeTools || s.openNativeTools.size === 0) return;
    this.advanceAcpTimeline(s, now);
    for (const id of [...s.openNativeTools.keys()]) {
      this.closeNativeToolEntry(s, id, false);
    }
  }
  syncUserWait(s) {
    if (!s) return;
    const now = performance.now();
    this.advanceAcpTimeline(s, now);
    const key = conversationKey(s);
    let activeCount = 0;
    if (s.running && !s.cancelled) {
      for (const q of this.questions.values()) {
        if (q.sessionRef ? q.sessionRef === s : conversationKey(q) === key) activeCount += 1;
      }
      for (const p of this.permissions.values()) {
        if (!p.modelChangeSession && (p.sessionRef ? p.sessionRef === s : conversationKey(p) === key)) activeCount += 1;
      }
    }
    s.userWaitActive = activeCount > 0;
  }
  async execute(input) {
    const executeStartedAt = performance.now();
    const executeWallStartedAt = Date.now();
    const scope = conversationScope(input), { projectId } = scope;
    const { prompt, snapshot, readOnly = false, images = [], workflowPhase, targetPageId } = input;
    const clientRequestId =
      typeof input.clientRequestId === 'string' && input.clientRequestId.trim() && input.clientRequestId.length <= 128
        ? input.clientRequestId.trim()
        : undefined;
    if (
      scope.kind === 'project' &&
      (!['conversation', 'planning', 'generating'].includes(workflowPhase) ||
        (workflowPhase === 'generating' &&
          (snapshot?.projectPlan?.approved !== true ||
            snapshot.projectPlan.discussionPending ||
            !snapshot.projectPlan.pages.some(p => p.pageId === targetPageId))))
    )
      throw new Error(tr('项目任务阶段或已确认方案无效', 'Invalid project workflow phase or unapproved project plan'));
    const key = conversationKey(scope);
    const taskKey = taskKeyForExecution(scope, workflowPhase, targetPageId);
    if (scope.kind === 'mindmap' && (readOnly !== true || !Array.isArray(images) || images.length))
      throw new Error(tr('脑图生成只允许读取项目，不支持页面修改或图片附件', 'Mindmap generation is read-only and does not support page modifications or image attachments'));
    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.projectId !== projectId
    )
      throw new Error(tr("AI 请求缺少指令或项目快照", "AI request is missing prompt or project snapshot"));
    const version = this.cancelVersions.get(key);
    const imageContent = scope.kind === 'mindmap' ? [] : this.chatImages.content(scope, images);
    const runId = randomUUID();
    const normalizedInputSnapshot = leanSnapshot(snapshot);
    const continuationInput = !readOnly && input.continuation && typeof input.continuation === 'object' ? input.continuation : null;
    const canCheckpoint =
      !readOnly &&
      scope.kind === 'project' &&
      workflowPhase === 'generating' &&
      (typeof input.recoveryRevision === 'string' || input.recoveryRevisionVersion === 3);
    const sessionLockStartedAt = performance.now();
    let paths = null;
    let planningSession = null;
    let pageExecSetupRecord = null;
    let postMigrationCheckpoint = null;
    let migratedAcrossSessions = false;
    let archivedOldDraft = false;
    let accountAtStart = null;
    const s = await this.locked(projectId, async () => {
      await this.ensureSession(scope);
      if (imageContent.length && this.info?.capabilities?.promptCapabilities?.image !== true)
        throw new Error(tr('当前 Hermes 连接不支持图片输入，请更新 Hermes 后重新连接', 'Current Hermes connection does not support image input; please update Hermes and reconnect'));
      planningSession = this.sessions.get(key);
      if (version !== this.cancelVersions.get(key))
        throw new Error(tr("已停止生成，未应用修改", "Generation stopped; no changes were applied"));
      if (this.allLoadedSessions().some(item => item.projectId === projectId && item.running))
        throw new Error(tr("该项目已有 AI 任务正在运行", "An AI task is already running for this project"));

      paths = scope.kind === 'project'
        ? draftRecovery.resolveExecutionPaths(planningSession.dir, workflowPhase, targetPageId)
        : {
            execDir: planningSession.dir,
            contextFile: path.join(planningSession.dir, 'context.json'),
            sessionFile: path.join(planningSession.dir, 'session.json'),
            checkpointPath: draftRecovery.checkpointFile(planningSession.dir, workflowPhase, targetPageId),
            legacyCheckpointPath: null,
            isPageExecution: false,
          };

      const abandonedExec = draftRecovery.read(paths.contextFile);
      if (abandonedExec?.active && abandonedExec.recovery) {
        await draftRecovery.freezeContext(paths.contextFile, abandonedExec.runId, 'uncertain');
      }

      accountAtStart = this.accountProvider();
      const environment = { home: this.info?.home, binary: this.info?.binary, version: this.info?.version };
      const parentSkillDigest = this.fileSkillDigest(path.join(planningSession.dir, 'AGENTS.md'));
      const currentToolVersion = scope.kind !== 'mindmap' ? this.projectToolVersion() : undefined;

      const emitPreLockFailure = (preError, existingStatus, diagSessionId) => {
        const failure = {
          reason:
            typeof preError?.code === 'string' && preError.code.startsWith('DRAFT_RECOVERY_')
              ? 'stale-state'
              : require('./diagnostics.cjs').failureReason(preError),
          evidence: 'runtime-error',
        };
        try {
          this.diagnostic?.({
            source: 'main',
            category: 'ai',
            code: 'AI_RUNTIME_FAILED',
            stage: 'execute',
            message: tr('AI 运行时执行失败：', 'AI runtime execution failed: ') + failure.reason,
            stack: String(preError?.stack ?? '').split('\n').slice(1).join('\n'),
            context: {
              ...scope,
              workflowPhase,
              targetPageId,
              runId,
              sessionId: diagSessionId || planningSession.sessionId,
              modelId: planningSession.models.currentModelId,
              failure,
              checks: preError?.recoveryChecks ?? [{ kind: 'draft-recovery', status: 'unavailable' }],
            },
          });
        } catch {}
        if (preError && typeof preError === 'object') {
          preError.failureEnvelope = buildFailureEnvelope({
            error: preError,
            runFailure: failure,
            existingCandidateStatus: existingStatus,
            targetPageId,
          });
        }
      };

      // Handle explicit archiveDraft BEFORE Step 0 eligibility check or page session setup.
      if (canCheckpoint && input.archiveDraft === true && !continuationInput) {
        const { checkpoint: savedCp, file: savedCpFile } = draftRecovery.readCheckpointWithLegacy(paths);
        if (savedCp && savedCp.recovery?.status !== 'committed') {
          const checkIdentity = draftRecovery.recoveryIdentity({
            scope,
            sessionId: planningSession.sessionId,
            modelId: planningSession.models.currentModelId,
            environment,
            account: accountAtStart,
            revision: input.recoveryRevision,
            revisionVersion: input.recoveryRevisionVersion,
            skillDigest: parentSkillDigest,
            toolVersion: currentToolVersion,
          });
          if (
            !checkIdentity.account ||
            JSON.stringify(savedCp.recovery.identity?.account) !== JSON.stringify(checkIdentity.account) ||
            JSON.stringify(savedCp.recovery.identity?.scope) !== JSON.stringify(checkIdentity.scope)
          ) {
            const ownErr = new Error(tr('不能处理其他账号或会话的恢复草稿', 'Cannot process recovery drafts belonging to another account or conversation'));
            emitPreLockFailure(ownErr, savedCp.recovery?.status ?? null, savedCp.recovery?.identity?.sessionId);
            throw ownErr;
          }
          fs.renameSync(savedCpFile, savedCpFile + '.archived-' + randomUUID());
          archivedOldDraft = true;
        }
      }

      // Step 0: Pure read-only pre-mutation eligibility gate before touching any page session or model.
      let step0Checkpoint = null;
      if (canCheckpoint && input.recoverDraft && !input.archiveDraft && !continuationInput) {
        const { checkpoint: rawCp, isLegacyParent } = draftRecovery.readCheckpointWithLegacy(paths);
        if (rawCp && rawCp.recovery?.status !== 'committed') {
          let savedExec = null;
          if (paths.isPageExecution && fs.existsSync(paths.sessionFile)) {
            try {
              savedExec = JSON.parse(fs.readFileSync(paths.sessionFile, 'utf8'));
            } catch {
              const corruptErr = new Error(tr('恢复记录无法读取，已保留原文件，请检查本地工程数据', 'Recovery record cannot be read; original file was preserved. Please check local project data'));
              emitPreLockFailure(corruptErr, rawCp.recovery?.status ?? null, planningSession.sessionId);
              throw corruptErr;
            }
            if (
              conversationKey(savedExec) !== key ||
              savedExec.targetPageId !== targetPageId ||
              typeof savedExec.sessionId !== 'string' ||
              !savedExec.sessionId.trim()
            ) {
              const mismatchErr = Object.assign(new Error(tr('页面执行子会话归属不一致，原候选草稿仍保留', 'Page execution sub-session ownership mismatch; original candidate draft was preserved')), {
                code: 'DRAFT_RECOVERY_IDENTITY',
              });
              emitPreLockFailure(mismatchErr, rawCp.recovery?.status ?? null, planningSession.sessionId);
              throw mismatchErr;
            }
          } else if (!paths.isPageExecution) {
            savedExec = { sessionId: planningSession.sessionId };
          }
          const pm =
            rawCp.recovery?.pendingMigration && typeof rawCp.recovery.pendingMigration === 'object'
              ? rawCp.recovery.pendingMigration
              : null;
          try {
            if (pm) {
              if (typeof pm.fromSessionId !== 'string' || rawCp.recovery?.identity?.sessionId !== pm.fromSessionId) {
                throw Object.assign(new Error(tr('会话迁移预写记录不一致，未自动覆盖当前项目；原候选草稿仍保留', 'Session migration write-ahead record mismatch; current project was not overwritten and original candidate draft was preserved')), {
                  code: 'DRAFT_RECOVERY_IDENTITY',
                });
              }
              if (
                savedExec?.sessionId &&
                ![pm.fromSessionId, pm.toSessionId].filter(Boolean).includes(savedExec.sessionId)
              ) {
                throw Object.assign(new Error(tr('会话已变化，未自动覆盖当前项目；原候选草稿仍保留', 'Session has changed; current project was not overwritten and original candidate draft was preserved')), {
                  code: 'DRAFT_RECOVERY_IDENTITY',
                });
              }
            }
            const step0Identity = draftRecovery.recoveryIdentity({
              scope,
              sessionId: isLegacyParent ? null : (savedExec?.sessionId ?? null),
              modelId: planningSession.models.currentModelId,
              environment,
              account: accountAtStart,
              revision: input.recoveryRevision,
              revisionVersion: input.recoveryRevisionVersion,
              skillDigest: parentSkillDigest,
              toolVersion: currentToolVersion,
            });
            draftRecovery.validateCheckpoint(rawCp, step0Identity, {
              liveSnapshot: normalizedInputSnapshot,
              isLegacyParent,
              skipSessionIdCheck: Boolean(pm),
              targetPageId,
            });
            replayCandidateOperations(normalizedInputSnapshot, rawCp.operations, { workflowPhase, targetPageId });
            step0Checkpoint = rawCp;
          } catch (step0Err) {
            emitPreLockFailure(
              step0Err,
              rawCp.recovery?.status ?? null,
              savedExec?.sessionId || rawCp.recovery?.identity?.sessionId || planningSession.sessionId,
            );
            throw step0Err;
          }
        }
      }

      let execSession;
      if (paths.isPageExecution) {
        const ensured = await this.ensurePageExecutionSession({
          scope,
          planningSession,
          paths,
          taskKey,
          targetPageId,
          recoverCheckpoint: step0Checkpoint,
          rotateSession: Boolean(input.rotateSession),
        });
        execSession = ensured.session;
        postMigrationCheckpoint = ensured.checkpoint;
        migratedAcrossSessions = Boolean(ensured.migratedAcrossSessions);
        pageExecSetupRecord = ensured.setupRecord;
      } else {
        execSession = planningSession;
        execSession.taskKey = taskKey;
        execSession.activeTargetPageId = targetPageId;
      }

      if (version !== this.cancelVersions.get(key))
        throw new Error(tr("已停止生成，未应用修改", "Generation stopped; no changes were applied"));

      execSession.running = true;
      execSession.freshlyCreated = false;
      execSession.runId = runId;
      execSession.boundAdmissionId = null;
      execSession.clientRequestId = clientRequestId;
      execSession.clarifications = [];
      execSession.questionProgress = new QuestionProgress(runId);
      execSession.text = "";
      execSession.thinking = false;
      execSession.cancelled = false;
      execSession.acpSliceCursor = null;
      execSession.userWaitActive = false;
      execSession.userWaitMs = 0;
      execSession.openNativeTools = new Map();
      execSession.anonNativeSeq = 0;
      execSession.nativeToolExecMs = 0;
      execSession.nativeToolCallCount = 0;
      execSession.failedNativeToolCallCount = 0;
      execSession.nativeToolBreakdown = {};
      if (scope.kind === 'project') {
        this.activeProjectRuns.set(key, execSession);
      }
      return execSession;
    });
    const sessionSetupMs = roundMs(performance.now() - sessionLockStartedAt);
    const parentSetup = this.lastSessionSetup.get(key) || {
      durationMs: 0,
      connectMs: 0,
      promptRefreshMs: 0,
      acpSessionRpcMs: 0,
      reused: false,
      reloaded: false,
      created: false,
      reloadReason: null,
    };
    const directSetup = pageExecSetupRecord
      ? {
          durationMs: roundMs((parentSetup.durationMs || 0) + (pageExecSetupRecord.durationMs || 0)),
          connectMs: parentSetup.connectMs || 0,
          promptRefreshMs: roundMs((parentSetup.promptRefreshMs || 0) + (pageExecSetupRecord.promptRefreshMs || 0)),
          acpSessionRpcMs: roundMs((parentSetup.acpSessionRpcMs || 0) + (pageExecSetupRecord.acpSessionRpcMs || 0)),
          reused: Boolean(parentSetup.reused && pageExecSetupRecord.reused),
          reloaded: Boolean(parentSetup.reloaded || pageExecSetupRecord.reloaded),
          created: Boolean(parentSetup.created || pageExecSetupRecord.created),
          reloadReason: pageExecSetupRecord.reloadReason ?? parentSetup.reloadReason ?? null,
        }
      : parentSetup;
    const priorSessionSetup = this.unconsumedSessionSetup.get(key) || null;
    this.unconsumedSessionSetup.delete(key);
    const sessionCreated = Boolean(directSetup.created || priorSessionSetup?.created);
    const sessionReloaded = Boolean(directSetup.reloaded || priorSessionSetup?.reloaded);
    const sessionReused = !sessionCreated && !sessionReloaded && Boolean(directSetup.reused);
    const reloadReason = directSetup.reloadReason ?? priorSessionSetup?.reloadReason ?? null;
    const file = paths.contextFile;
    const metricsFile = path.join(s.dir, "tool-metrics.jsonl");
    const telemetryHistoryFile = path.join(planningSession.dir, "telemetry-history.jsonl");
    const skillFile = path.join(s.dir, 'AGENTS.md');
    let promptBytes = 0;
    let imageBytes = 0;
    let snapshotBytes = 0;
    let contextJsonBytes = 0;
    let skillBytes = 0;
    let contextBridgeSetupMs = 0;
    let acpTurnMs = 0;
    let promptVerifyMs = 0;
    let promptVerifyBridgeMode = null;
    let promptVerifyColdStart = null;
    let runStarted = false;
    let runFailed = false;
    let runErrorMessage = '';
    let runFailure = null;
    let runError = null;
    let recoverySaved = false;
    let retryPoll;
    let retryStatus;
    let hadUnfinishedNativeTools = false;
    let promptDispatched = false;
    let gatewayTurnUncertainty = null;
    let uncertainRecovery = false;
    let channelFile;
    let resumed = false;
    let preview = { close() {}, flush() {} };
    let finalMetrics = null;
    s.promptStartedAt = null;
    s.firstOutputMs = null;
    s.firstTextMs = null;
    s.acpToolCallCount = 0;
    s.seenToolCallIds = new Set();
    const buildExecuteMetrics = () => {
      if (finalMetrics) return finalMetrics;
      const toolStats = readToolMetrics(metricsFile, runId);
      let providerRetryCount = 0, providerWaitMs = 0;
      if (channelFile) {
        try {
          for (const line of fs.readFileSync(channelFile + '.events', 'utf8').split('\n')) {
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.runId !== runId || event.sessionId !== s.sessionId) continue;
            if (event.status === 'retrying') providerRetryCount++;
            if (Number.isFinite(event.waitedSeconds) && event.waitedSeconds >= 0) providerWaitMs += event.waitedSeconds * 1000;
          }
        } catch {}
      }
      const userWaitMs = roundMs(s.userWaitMs || 0);
      const nativeToolExecMs = roundMs(s.nativeToolExecMs || 0);
      const unattributedAcpMs = roundMs(Math.max(0, acpTurnMs - toolStats.toolExecMs - nativeToolExecMs - userWaitMs));
      finalMetrics = {
        totalExecuteMs: roundMs(performance.now() - executeStartedAt),
        sessionSetupMs,
        connectMs: directSetup.connectMs,
        promptRefreshMs: directSetup.promptRefreshMs,
        acpSessionRpcMs: directSetup.acpSessionRpcMs,
        contextBridgeSetupMs,
        sessionReused,
        sessionReloaded,
        sessionCreated,
        reloadReason,
        priorSessionSetup: directSetup.reused ? priorSessionSetup : null,
        firstOutputMs: s.firstOutputMs,
        firstTextMs: s.firstTextMs,
        acpTurnMs,
        providerRetryCount,
        providerWaitMs: roundMs(providerWaitMs),
        unattributedAcpMs,
        userWaitMs,
        promptVerifyMs,
        toolExecMs: toolStats.toolExecMs,
        toolCallCount: toolStats.toolCallCount,
        failedToolCallCount: toolStats.failedToolCallCount,
        nativeToolExecMs,
        nativeToolCallCount: s.nativeToolCallCount || 0,
        failedNativeToolCallCount: s.failedNativeToolCallCount || 0,
        nativeToolBreakdown: { ...(s.nativeToolBreakdown || {}) },
        acpToolCallCount: s.acpToolCallCount,
        toolBreakdown: toolStats.toolBreakdown,
        contextQueryCount: toolStats.contextQueryCount ?? 0,
        contextQueryMs: toolStats.contextQueryMs ?? 0,
        contextColdStarts: toolStats.contextColdStarts ?? 0,
        promptVerifyBridgeMode,
        promptVerifyColdStart,
        promptBytes,
        imageBytes,
        snapshotBytes,
        contextJsonBytes,
        skillBytes,
      };
      return finalMetrics;
    };
    try {
      let baseSnapshot = structuredClone(normalizedInputSnapshot);
      let workingSnapshot = normalizedInputSnapshot;
      let continuation = continuationInput;
      let initialDependencyFootprint = createEmptyDependencyFootprint(workflowPhase ?? null, targetPageId ?? null);
      let initialClarifications = [];
      const identity = draftRecovery.recoveryIdentity({
        scope,
        sessionId: s.sessionId,
        modelId: s.models.currentModelId,
        environment: { home: this.info?.home, binary: this.info?.binary, version: this.info?.version },
        account: accountAtStart,
        revision: input.recoveryRevision,
        revisionVersion: input.recoveryRevisionVersion,
        skillDigest: this.fileSkillDigest(skillFile),
        toolVersion: s.toolVersion,
      });
      let recoveryPrompt = archivedOldDraft
        ? '宿主说明：用户选择保留旧草稿存档，按当前工程重新生成。旧候选尚未应用，请先读取当前工程事实。\n' + prompt
        : prompt;
      let originalPrompt = prompt;
      let originalImages = images;
      if (canCheckpoint && continuation?.sourceRunId) {
        const previous = draftRecovery.read(paths.checkpointPath);
        if (
          !previous ||
          previous.runId !== continuation.sourceRunId ||
          JSON.stringify(previous.recovery?.identity) !== JSON.stringify(identity)
        ) {
          throw new Error(tr('增量修复的原轮次或工程基线不匹配，原候选草稿仍保留', 'Source run or project baseline mismatch for incremental repair; original candidate draft was preserved'));
        }
        if (previous.dependencyFootprint?.version === 3 && previous.baseSnapshot) {
          const fpCheck = verifyDependencyFootprint(previous.baseSnapshot, previous.dependencyFootprint);
          if (!fpCheck.ok) {
            throw Object.assign(new Error(tr('工程内容或需求已变化，未自动覆盖当前项目；原候选草稿仍保留', 'Project content or requirements have changed; current project was not overwritten and original candidate draft was preserved')), {
              code: 'DRAFT_RECOVERY_BASELINE_CHANGED',
            });
          }
        }
        originalPrompt = previous.recovery.originalPrompt;
        originalImages = previous.recovery.images;
        if (previous.baseSnapshot && typeof previous.baseSnapshot === 'object') {
          baseSnapshot = structuredClone(previous.baseSnapshot);
        }
        if (previous.dependencyFootprint?.version === 3) {
          initialDependencyFootprint = structuredClone(previous.dependencyFootprint);
        }
        if (Array.isArray(previous.clarifications) && previous.clarifications.length) {
          initialClarifications = structuredClone(previous.clarifications);
        }
      }
      if (canCheckpoint && postMigrationCheckpoint && !continuation) {
        draftRecovery.validateCheckpoint(postMigrationCheckpoint, identity, {
          liveSnapshot: normalizedInputSnapshot,
          targetPageId,
        });
        const replayedSnapshot = replayCandidateOperations(
          normalizedInputSnapshot,
          postMigrationCheckpoint.operations,
          { workflowPhase, targetPageId },
        );
        if (
          Array.isArray(postMigrationCheckpoint.requirementFindings) &&
          postMigrationCheckpoint.requirementFindings.length &&
          Array.isArray(replayedSnapshot.requirementSources)
        ) {
          replayedSnapshot.databaseRequirements = collectRequirementRecords(
            replayedSnapshot.requirementSources,
            postMigrationCheckpoint.requirementFindings,
            replayedSnapshot.databaseRequirements,
          );
        }
        baseSnapshot = structuredClone(normalizedInputSnapshot);
        workingSnapshot = replayedSnapshot;
        if (postMigrationCheckpoint.dependencyFootprint?.version === 3) {
          initialDependencyFootprint = structuredClone(postMigrationCheckpoint.dependencyFootprint);
        }
        if (Array.isArray(postMigrationCheckpoint.clarifications) && postMigrationCheckpoint.clarifications.length) {
          initialClarifications = structuredClone(postMigrationCheckpoint.clarifications);
        }
        continuation = {
          operations: postMigrationCheckpoint.operations,
          requirementFindings: postMigrationCheckpoint.requirementFindings,
          initialBaseline: {
            pageIds: Object.keys(normalizedInputSnapshot.pageSources ?? {}),
            stickyOwners: Object.fromEntries((normalizedInputSnapshot.stickyNotes ?? []).map(st => [st.id, st.pageId])),
            tableRowIds: Object.keys(normalizedInputSnapshot.tableRows ?? {}),
            validationBase: {
              projectPlan: structuredClone(normalizedInputSnapshot.projectPlan ?? null),
              pageSources: { ...(normalizedInputSnapshot.pageSources ?? {}) },
              dbTables: structuredClone(normalizedInputSnapshot.dbTables ?? []),
              mindmaps: normalizedInputSnapshot.mindmaps ?? { nodes: [], links: [] },
              stickyNotes: structuredClone(normalizedInputSnapshot.stickyNotes ?? []),
              closedLoopIssues: structuredClone(normalizedInputSnapshot.closedLoopIssues ?? []),
              designerPages: structuredClone(normalizedInputSnapshot.designerPages ?? []),
              sitemapBase: normalizedInputSnapshot.sitemapBase ?? [],
            },
          },
        };
        originalPrompt = postMigrationCheckpoint.recovery.originalPrompt;
        originalImages = postMigrationCheckpoint.recovery.images;
        const migrationNote = migratedAcrossSessions
          ? '\n当前在新的执行子会话中恢复，如需回看此前对话或前序页面执行背景，可调用 protoflow_search_history。'
          : '';
        const clarificationNote =
          migratedAcrossSessions && initialClarifications.length
            ? '\n此前本页已确认的澄清结论：' + JSON.stringify(initialClarifications)
            : '';
        recoveryPrompt =
          originalPrompt +
          '\n宿主恢复说明：上轮未提交的候选操作已基于最新工程重放装载。先重新读取项目 brief 和目标页面，核对现有候选，继续补齐未完成项；不要重复建表或重复写演示数据。原始需求仍有效。' +
          migrationNote +
          clarificationNote +
          '\n本轮要求：' +
          prompt;
        resumed = true;
      }
      s.clarifications = structuredClone(initialClarifications);
      const recoveryMetadata = canCheckpoint
        ? {
            version: 1,
            identity,
            originalPrompt,
            images: structuredClone(originalImages),
            status: 'running',
            ownerPid: process.pid,
            ...(postMigrationCheckpoint?.recovery?.sessionMigrations?.length
              ? { sessionMigrations: structuredClone(postMigrationCheckpoint.recovery.sessionMigrations) }
              : {}),
          }
        : undefined;
      const initialOperations = Array.isArray(continuation?.operations)
        ? structuredClone(continuation.operations)
        : [];
      const initialRequirementFindings =
        Array.isArray(continuation?.requirementFindings) && continuation.requirementFindings.length
          ? structuredClone(continuation.requirementFindings)
          : undefined;
      const initialBaseline =
        continuation?.initialBaseline && typeof continuation.initialBaseline === 'object'
          ? continuation.initialBaseline
          : null;
      const allowedHistorySessions = this.buildAllowedHistorySessions(scope, s, planningSession);
      promptBytes = Buffer.byteLength(prompt, 'utf8');
      imageBytes = imageContent.reduce(
        (sum, item) => sum + (typeof item?.data === 'string' ? Buffer.byteLength(item.data, 'utf8') : 0),
        0,
      );
      snapshotBytes = Buffer.byteLength(JSON.stringify(workingSnapshot), 'utf8');
      safeRemoveFile(metricsFile);
      let previewBridge = null;
      if (
        this.previewCaptureBridge && input.previewContext?.meta?.projectId === projectId &&
        scope.kind !== 'mindmap' &&
        !(scope.kind === 'project' && scope.threadId === 'note-assistant')
      ) {
        try {
          previewBridge = await this.previewCaptureBridge.registerTurn(runId);
        } catch {
          previewBridge = null;
        }
      }
      await withContextLockAsync(file, () => {
        if (s.cancelled) throw new Error(tr('已停止生成，未应用修改', 'Generation stopped; no changes were applied'));
        safeRemoveFile(draftRecovery.footprintErrorFile(file));
        atomicWrite(draftRecovery.footprintFile(file), {
          runId,
          dependencyFootprint: initialDependencyFootprint,
        });
        atomicWrite(file, {
          active: true,
          runId,
          ...scope,
          readOnly,
          requireFootprintSidecar: true,
          ...(scope.kind === 'project' ? { workflowPhase, targetPageId } : {}),
          baseSnapshot,
          snapshot: workingSnapshot,
          allowedHistorySessions,
          clarifications: initialClarifications,
          sessionId: s.sessionId,
          planningSessionId: planningSession.sessionId,
          execSessionId: s.sessionId,
          taskKey,
          contextFocus: input.contextFocus,
          confirmedProjectAgreements: workingSnapshot.projectAgreements ?? [],
          ...(scope.kind === 'project' ? { requireProjectBrief: true, requirePageEvidence: true } : {}),
          ...(previewBridge ? { previewBridge, previewContext: input.previewContext } : {}),
          metricsFile,
          operations: initialOperations,
          ...(recoveryMetadata ? { recovery: recoveryMetadata } : {}),
          ...(initialRequirementFindings ? { requirementFindings: initialRequirementFindings } : {}),
          ...(initialBaseline?.pageIds ? { initialPageIds: structuredClone(initialBaseline.pageIds) } : {}),
          ...(initialBaseline?.stickyOwners ? { initialStickyOwners: structuredClone(initialBaseline.stickyOwners) } : {}),
          ...(initialBaseline?.tableRowIds ? { initialTableRowIds: structuredClone(initialBaseline.tableRowIds) } : {}),
          ...(initialBaseline?.validationBase ? { initialValidationBase: structuredClone(initialBaseline.validationBase) } : {}),
        });
      });
      try { contextJsonBytes = fs.statSync(file).size; } catch {}
      try { if (fs.existsSync(skillFile)) skillBytes = fs.statSync(skillFile).size; } catch {}
      const runIdentity = this.eventIdentity(s);
      this.emit({
        type: "run-start",
        ...scope,
        ...runIdentity,
        runId,
        ...(clientRequestId ? { clientRequestId } : {}),
      });
      runStarted = true;
      preview = readOnly
        ? { close() {}, flush() {} }
        : watchStagedPages(
            file,
            { ...scope, ...runIdentity, runId },
            event => this.emit(event),
            () => s.running && !s.cancelled && s.runId === runId,
            initialOperations.length,
          );
      s.stopPreview = () => preview.close();
      if (scope.kind === 'project') {
        const bridgeStartedAt = performance.now();
        try {
          const bridge = await this.contextBridge();
          await withContextLockAsync(file, () => {
            const active = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (s.cancelled || !active.active || active.runId !== runId) throw new Error(tr('已停止', 'Stopped'));
            atomicWrite(file, { ...active, nativeBridge: bridge });
          });
          await this.watchContext(s);
        } catch (error) {
          this.emit({ type: 'context-error', ...scope, ...runIdentity, runId, message: error.message });
        } finally {
          contextBridgeSetupMs = roundMs(performance.now() - bridgeStartedAt);
        }
        if (s.cancelled) throw new Error(tr('已停止生成，未应用修改', 'Generation stopped; no changes were applied'));
      } else if (scope.kind === undefined) {
        const bridgeStartedAt = performance.now();
        try {
          const bridge = await this.contextBridge();
          await withContextLockAsync(file, () => {
            const active = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (s.cancelled || !active.active || active.runId !== runId) return;
            atomicWrite(file, { ...active, nativeBridge: bridge });
          });
        } catch {
          // Non-project menu environments without a native Hermes installDir omit history bridge quietly.
        } finally {
          contextBridgeSetupMs = roundMs(performance.now() - bridgeStartedAt);
        }
        if (s.cancelled) throw new Error(tr('已停止生成，未应用修改', 'Generation stopped; no changes were applied'));
      }
      channelFile = path.join(this.recoveryChannelDir, draftRecovery.hash(s.sessionId) + '.json');
      atomicWrite(channelFile, { active: true, runId, sessionId: s.sessionId });
      let lastRetryEvent = '';
      retryPoll = setInterval(() => {
        if (!s.running || s.cancelled || s.runId !== runId) return;
        if (JSON.stringify(this.accountProvider()) !== JSON.stringify(accountAtStart)) {
          void this.cancel(scope).catch(() => {});
          return;
        }
        try {
          const status = draftRecovery.read(channelFile + '.status');
          if (status?.runId !== runId || status.sessionId !== s.sessionId) return;
          const encoded = JSON.stringify(status);
          if (encoded === lastRetryEvent) return;
          lastRetryEvent = encoded;
          retryStatus = status;
          this.emit({
            type: 'retry-status',
            ...scope,
            ...this.eventIdentity(s),
            runId,
            retry: { status: status.status, attempt: status.attempt, waitSeconds: status.waitSeconds },
          });
        } catch {}
      }, 500);
      retryPoll.unref?.();
      const promptStartedAt = performance.now();
      s.promptStartedAt = promptStartedAt;
      s.acpSliceCursor = promptStartedAt;
      let result;
      try {
        promptDispatched = true;
        result = await this.client.request(
          "session/prompt",
          {
            sessionId: s.sessionId,
            prompt: [{ type: "text", text: recoveryPrompt }, ...imageContent],
            _meta: { alex_run_id: runId },
          },
          null, // Agent turns can outlive any fixed deadline, including while awaiting user input.
        );
      } finally {
        const promptEndedAt = performance.now();
        hadUnfinishedNativeTools = Boolean(s.openNativeTools?.size);
        this.closeAllOpenNativeTools(s, promptEndedAt);
        this.advanceAcpTimeline(s, promptEndedAt);
        s.userWaitActive = false;
        s.acpSliceCursor = null;
        acpTurnMs = roundMs(promptEndedAt - s.promptStartedAt);
      }
      if (result.stopReason !== "end_turn" || s.cancelled)
        throw new Error(
          result.stopReason === "cancelled" || s.cancelled
            ? tr("已停止生成，未应用修改", "Generation stopped; no changes were applied")
            : tr(`Hermes 未正常完成：${result.stopReason}`, `Hermes did not finish normally: ${result.stopReason}`),
        );
      if (hadUnfinishedNativeTools) throw new Error(tr('模型轮次结束，但仍有工具执行结果未确认，未应用修改', 'Model turn ended with unconfirmed tool results; no changes were applied'));
      // Read final request policy state even when ACP failed faster than the UI poll.
      // An unrecovered overflow delegation ('delegated') must also fail closed if no post-compression call succeeded.
      if (channelFile) {
        const terminal = draftRecovery.read(channelFile + '.status');
        if (terminal?.runId === runId && ['waiting', 'retrying', 'stopped', 'delegated'].includes(terminal.status)) {
          throw new Error(tr('模型请求恢复已停止：', 'Model request recovery stopped: ') + (terminal.reason || terminal.status));
        }
      }
      if (JSON.stringify(this.accountProvider()) !== JSON.stringify(accountAtStart)) throw new Error(tr('登录账号已变化，未应用修改', 'Signed-in account changed; no changes were applied'));
      // Close the final synchronous MCP commit window before reading the result.
      // No tool may alter the candidate between this read and host validation.
      await draftRecovery.freezeContext(file, runId, 'available');
      if (s.cancelled) throw new Error(tr('已停止生成，未应用修改', 'Generation stopped; no changes were applied'));
      const context = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        !Array.isArray(context.operations) ||
        context.runId !== runId ||
        conversationKey(context) !== key
      )
        throw new Error(tr("项目工具返回了不匹配的执行标识", "Project tools returned a mismatched execution run ID"));
      if (
        context.footprintCorrupted ||
        (context.requireFootprintSidecar && context.dependencyFootprint?.version !== 3)
      ) {
        const footprintErr = new Error(tr('依赖足迹记录缺失或保存失败，已阻止提交工程修改', 'Dependency footprint record is missing or failed to save; project changes were blocked from committing'));
        footprintErr.footprintCorrupted = true;
        throw footprintErr;
      }
      if (readOnly && context.operations.length) throw new Error(tr('只读请求返回了修改操作', 'Read-only request returned mutation operations'));
      const expectedSkillDigest = this.fileSkillDigest(skillFile);
      if (expectedSkillDigest !== null && this.hasNativePromptControl()) {
        const verifyStartedAt = performance.now();
        let verified;
        this.lastContextBridgeUse = null;
        try {
          verified = await this.nativeContext({
            action: 'verify_prompt',
            sessionId: s.sessionId,
            skillFile,
            minEpoch: s.pendingRefreshEpoch || 0,
          });
        } finally {
          promptVerifyMs = roundMs(performance.now() - verifyStartedAt);
          if (this.lastContextBridgeUse?.action === 'verify_prompt') {
            promptVerifyBridgeMode = this.lastContextBridgeUse.mode;
            promptVerifyColdStart = this.lastContextBridgeUse.coldStart;
          }
        }
        if (!verified?.verified || verified.appliedSkillDigest !== expectedSkillDigest) {
          s.pendingRefreshEpoch = 0;
          this.writeSkillState(s.dir, {
            sessionId: s.sessionId,
            appliedSkillDigest: s.appliedSkillDigest ?? null,
            targetSkillDigest: null,
            pendingRefreshEpoch: 0,
          });
          if (verified?.blocked) {
            throw new Error(tr('Hermes 安全扫描拦截了项目指令（AGENTS.md），规则未生效', 'Hermes security scan blocked project instructions (AGENTS.md); rules did not take effect'));
          }
          if (verified?.truncated) {
            throw new Error(tr('Hermes 截断了项目指令（AGENTS.md），未完整加载全部规则', 'Hermes truncated project instructions (AGENTS.md); not all rules were loaded'));
          }
          throw new Error(tr('Hermes 会话未采用最新项目指令，请刷新或新建会话后重试', 'Hermes session did not apply the latest project instructions; please refresh or start a new session and retry'));
        }
        s.expectedSkillDigest = expectedSkillDigest;
        s.appliedSkillDigest = verified.appliedSkillDigest;
        s.pendingRefreshEpoch = 0;
        this.writeSkillState(s.dir, {
          sessionId: s.sessionId,
          appliedSkillDigest: verified.appliedSkillDigest,
          targetSkillDigest: expectedSkillDigest,
          pendingRefreshEpoch: 0,
        });
      }
      if (s.cancelled) throw new Error(tr('已停止生成，未应用修改', 'Generation stopped; no changes were applied'));
      if (JSON.stringify(this.accountProvider()) !== JSON.stringify(accountAtStart)) throw new Error(tr('登录账号已变化，未应用修改', 'Signed-in account changed; no changes were applied'));
      preview.flushFinal?.(context);
      let metrics;
      try { metrics = buildExecuteMetrics(); } catch {}
      const replyIdentity = this.eventIdentity(s);
      return {
        text: s.text,
        operations: context.operations,
        ...(context.requirementFindings && { requirementFindings: context.requirementFindings }),
        ...(context.dependencyFootprint?.version === 3 ? { dependencyFootprint: context.dependencyFootprint } : {}),
        ...(continuation ? { continuationMerged: true } : {}),
        ...(resumed ? { recoveredDraft: true } : {}),
        runId,
        ...replyIdentity,
        ...(clientRequestId ? { clientRequestId } : {}),
        modelId: s.models.currentModelId,
        skillDigest: s.appliedSkillDigest ?? null,
        ...(metrics ? { metrics } : {}),
      };
    } catch (error) {
      runFailed = true;
      runError = error;
      try {
        const terminal = channelFile ? draftRecovery.read(channelFile + '.status') : null;
        if (terminal?.runId === runId && terminal.sessionId === s.sessionId) retryStatus = terminal;
      } catch {}
      const acpTurnOutcomeUnknown = Boolean(promptDispatched && !s.cancelled && error?.acpDisconnected === true);
      if (promptDispatched && !s.cancelled) {
        const explicitOutcome = typeof error?.gatewayOutcome === 'string' ? error.gatewayOutcome : null;
        if (['unknown_execution', 'session_replay_gap', 'gateway_disconnected', 'gateway_outcome_unknown'].includes(explicitOutcome)) {
          gatewayTurnUncertainty = explicitOutcome;
        } else {
          const errData = error?.data && typeof error.data === 'object' ? error.data : null;
          const signals = [
            error?.code,
            error?.reason,
            error?.message,
            errData?.details,
            errData?.reason,
            errData?.outcome,
          ].filter(v => typeof v === 'string' && v.length > 0);
          if (signals.some(v => /\bunknown_execution\b|unrecovered external turn outcome|lost when the gateway restarted|wait for the lost turn/i.test(v))) {
            gatewayTurnUncertainty = 'unknown_execution';
          } else if (signals.some(v => /\bsession_replay_gap\b/i.test(v))) {
            gatewayTurnUncertainty = 'session_replay_gap';
          } else if (signals.some(v => /Gateway disconnected;\s*turn outcome is unknown|turn outcome is unknown|outcome is unknown/i.test(v))) {
            gatewayTurnUncertainty = 'gateway_disconnected';
          } else if (signals.some(v => /^Hermes 请求超时：session\/prompt\b|^Hermes request timed out:\s*session\/prompt\b/i.test(v))) {
            gatewayTurnUncertainty = 'gateway_outcome_unknown';
          } else if (
            error?.rpcCode === -32603 &&
            error?.rpcMethod === 'session/prompt' &&
            explicitOutcome !== 'admitted_turn_failed' &&
            explicitOutcome !== 'not_sent'
          ) {
            // Single-request `.status` (waiting/retrying/recovered/delegated/stopped) only
            // reflects one provider call and never proves the whole Gateway turn terminated.
            gatewayTurnUncertainty = 'gateway_outcome_unknown';
          }
        }
      }
      uncertainRecovery =
        Boolean(error?.footprintCorrupted) ||
        hadUnfinishedNativeTools ||
        acpTurnOutcomeUnknown ||
        Boolean(gatewayTurnUncertainty) ||
        ['waiting', 'retrying'].includes(retryStatus?.status) ||
        retryStatus?.candidateUncertain === true ||
        ['partial-response', 'request-outcome-unknown'].includes(retryStatus?.reason);
      try {
        const checkpoint = await draftRecovery.freezeContext(file, runId, uncertainRecovery ? 'uncertain' : 'available', s.text, s.clarifications);
        recoverySaved = Boolean(checkpoint);
      } catch (saveError) {
        // Do not erase the original context if checkpoint persistence fails.
        error.message += tr('；恢复记录未能安全写入，原始暂存文件已保留', '; recovery record could not be safely written, original staged file was preserved');
      }
      if (!s.cancelled) {
        runFailure = { reason: require('./diagnostics.cjs').failureReason(error), evidence: 'runtime-error' };
        if (typeof error?.code === 'string' && error.code.startsWith('DRAFT_RECOVERY_')) runFailure.reason = 'stale-state';
        try {
          const native = error?.rpcCode === -32603 && error?.rpcMethod === 'session/prompt'
            ? await require('./hermes-failure.cjs').nativeFailureEvidence({ home: this.info?.home, sessionId: s.sessionId, startedAt: executeWallStartedAt, endedAt: Date.now() })
            : {};
          // Native evidence explains the generic ACP wrapper. A specific local
          // failure (e.g. contract validation) must not be replaced by old logs.
          runFailure = runFailure.reason === 'unclassified' ? { ...runFailure, ...native } : { ...runFailure, logStatus: native.logStatus };
          if (runFailure.reason === 'rate-limit' && error instanceof Error) {
            error.message = runFailure.rateLimitKind === 'tokens'
              ? tr('模型服务触发每分钟 Token 限流，本轮生成未完成。请稍后重试；若反复出现，请检查模型额度及会话上下文大小。', 'Model provider hit the per-minute token rate limit and this turn did not complete. Please retry shortly; if this persists, check your model quota and session context size.')
              : tr('模型服务触发请求限流，本轮生成未完成，请稍后重试。', 'Model provider hit a request rate limit and this turn did not complete. Please retry shortly.');
          }
        } catch { runFailure.logStatus = 'unavailable'; }
        if (['waiting', 'retrying'].includes(retryStatus?.status) && retryStatus.failure && runFailure.reason === 'unclassified') {
          const inflightFailure = require('./diagnostics.cjs').cleanContext({ failure: retryStatus.failure }).failure;
          if (inflightFailure?.reason) runFailure = { ...inflightFailure, evidence: 'runtime-error' };
        }
        if (retryStatus?.status === 'stopped' || retryStatus?.status === 'delegated') {
          const providerFailure = require('./diagnostics.cjs').cleanContext({ failure: retryStatus.failure }).failure;
          if (providerFailure?.reason) runFailure = { ...providerFailure, evidence: 'runtime-error' };
          const messages = {
            'rate-limit-budget': tr('模型服务仍在限流，自动等待已到上限，本轮生成未完成。', 'Model provider is still rate-limited and the automatic wait budget is exhausted; this turn did not complete.'),
            'server-error-budget': tr('模型服务网关或上游持续异常，自动重试已达上限，本轮生成未完成。', 'Model provider gateway or upstream service remained unavailable and automatic retries were exhausted; this turn did not complete.'),
            'request-exceeds-token-limit': tr('本次请求已超过模型服务的 Token 容量，单纯等待无法恢复；需要调整服务容量或另行评估上下文，系统未删减上下文。', 'This request exceeds the model provider token capacity and cannot recover by waiting alone; adjust provider capacity or review context size. Context was not truncated.'),
            'partial-response': tr('模型已返回部分内容，已停止自动重放，需要核对执行结果后继续。', 'Model already streamed a partial response; automatic replay stopped so execution state can be verified before continuing.'),
            'request-outcome-unknown': tr('模型连接中断，服务处理结果尚未确认，已停止自动重放。', 'Model connection dropped before the provider outcome could be confirmed; automatic replay stopped.'),
            'non-transient-limit': tr('模型服务返回无法安全重试的额度限制，请检查服务额度后再继续。', 'Model provider returned a non-transient quota limit that cannot be retried; please check your quota before continuing.'),
            'sdk-retry-budget-unknown': tr('当前模型 SDK 的重试次数不符合恢复策略，已停止叠加重试。', 'Model SDK retry configuration does not match the recovery policy; additional retries were stopped.'),
            'provider-rejected': tr('模型服务明确返回请求失败，本轮已停止；请查看诊断中的服务错误码。', 'Model provider explicitly rejected the request and this turn has stopped; check diagnostics for the provider error code.'),
            'native-overflow-recovery': tr('当前会话上下文超出模型窗口上限，自动压缩后仍无法完成请求；本轮生成已停止。', 'Session context exceeded the model context window and could not complete even after automatic compaction; this turn has stopped.'),
          };
          if (messages[retryStatus.reason] && error instanceof Error) error.message = messages[retryStatus.reason];
          if (['rate-limit-budget', 'request-exceeds-token-limit'].includes(retryStatus.reason)) {
            runFailure = { ...runFailure, reason: 'rate-limit', evidence: 'runtime-error', attempts: retryStatus.attempt,
              retriesExhausted: true, ...(Number.isFinite(retryStatus.retryAfterSeconds) ? { retryAfterSeconds: retryStatus.retryAfterSeconds } : {}) };
          } else if (retryStatus.reason === 'server-error-budget') {
            runFailure = { ...runFailure, reason: providerFailure?.reason || 'network', evidence: 'runtime-error', attempts: retryStatus.attempt,
              retriesExhausted: true, ...(Number.isFinite(retryStatus.retryAfterSeconds) ? { retryAfterSeconds: retryStatus.retryAfterSeconds } : {}) };
          } else if (retryStatus.reason === 'native-overflow-recovery') {
            runFailure = { ...runFailure, reason: 'context-limit', evidence: 'runtime-error', attempts: retryStatus.attempt };
          }
        }
        if (gatewayTurnUncertainty) {
          if (runFailure.reason === 'unclassified') {
            runFailure = { ...runFailure, reason: 'network', evidence: 'runtime-error' };
          }
          if (error instanceof Error && ['unknown_execution', 'session_replay_gap', 'gateway_disconnected'].includes(gatewayTurnUncertainty)) {
            error.message = tr('Hermes 网关连接中断或重启，本轮任务终态未知，已停止自动恢复。', 'Hermes gateway disconnected or restarted; turn outcome is unknown and automatic recovery has stopped.');
          }
        }
      }
      if (recoverySaved && error instanceof Error) error.message += uncertainRecovery
        ? tr(' 候选修改已保存在本机；因中断时存在执行结果不明的操作，无法直接续写半截草稿，请点击下方或右侧的“保留旧草稿，重新生成”按钮继续。', ' Candidate changes were saved locally; because interrupted operations had an uncertain outcome, the partial draft cannot be resumed directly. Click "Archive Old Draft & Regenerate" below or on the right to continue.')
        : tr(' 候选修改已保存在本机，可在原账号和工程中重试此页继续。', ' Candidate changes were saved locally; you can retry this page under the same account and project to continue.');
      if (error && typeof error === 'object') {
        error.failureEnvelope = buildFailureEnvelope({
          error,
          cancelled: Boolean(s.cancelled),
          acpTurnOutcomeUnknown,
          gatewayTurnUncertainty,
          hadUnfinishedNativeTools,
          retryStatus,
          runFailure,
          recoverySaved,
          uncertainRecovery,
          targetPageId,
        });
      }
      runErrorMessage = error instanceof Error ? error.message : String(error);
      if (!s.cancelled) {
        try { this.client.notify("session/cancel", { sessionId: s.sessionId }); } catch {}
      }
      throw error;
    } finally {
      clearInterval(retryPoll);
      if (channelFile) { try { atomicWrite(channelFile, { active: false, runId }); } catch {} }
      const settleNow = performance.now();
      this.closeAllOpenNativeTools(s, settleNow);
      this.advanceAcpTimeline(s, settleNow);
      s.userWaitActive = false;
      s.acpSliceCursor = null;
      let metrics;
      try { metrics = buildExecuteMetrics(); } catch {}
      if (runFailure && !s.cancelled) {
        try { this.diagnostic?.({source:'main',category:'ai',code:'AI_RUNTIME_FAILED',stage:'execute',message:tr('AI 运行时执行失败：', 'AI runtime execution failed: ')+runFailure.reason,
          stack: String(runError?.stack ?? '').split('\n').slice(1).join('\n'),
          context:{...scope,workflowPhase,targetPageId,runId,sessionId:s.sessionId,planningSessionId:planningSession?.sessionId,modelId:s.models.currentModelId,
            failure:runFailure,metrics,durationMs:metrics?.totalExecuteMs,
            checks: [
              ...(Number.isInteger(runError?.rpcCode) ? [{kind:'acp-error',status:String(runError.rpcCode),actionKind:runError.rpcMethod}] : []),
              ...(gatewayTurnUncertainty ? [{kind:'gateway-turn',status:gatewayTurnUncertainty}] : []),
              ...(retryStatus ? [{kind:'provider-retry',status:retryStatus.status,actionKind:retryStatus.reason ?? 'request'}] : []),
              ...(retryStatus?.providerCode ? [{kind:'provider-response',status:retryStatus.providerCode,actionKind:retryStatus.providerEvidence}] : []),
              ...(retryStatus?.errorType ? [{kind:'provider-exception',status:retryStatus.errorType}] : []),
              ...(runError?.recoveryChecks ?? [{kind:'draft-recovery',status:recoverySaved ? (uncertainRecovery ? 'uncertain' : 'saved') : 'unavailable'}]),
            ]}}); } catch {}
      }
      if (metrics) {
        if (this.diagnostic && !s.cancelled && (metrics.failedToolCallCount > 0 || metrics.failedNativeToolCallCount > 0)) {
          try { this.diagnostic?.({source:'main',category:'tool',code:'AI_TOOL_FAILED',stage:'execute',message:tr('本轮存在失败的工具调用', 'Failed tool calls occurred during this turn'),
            context:{...scope,workflowPhase,targetPageId,runId,sessionId:s.sessionId,modelId:s.models.currentModelId,
              toolCallCount:metrics.toolCallCount + metrics.nativeToolCallCount,failedToolCallCount:metrics.failedToolCallCount + metrics.failedNativeToolCallCount,
              checks:[...diagnosticToolFailures(metricsFile,runId),...Object.entries(metrics.nativeToolBreakdown ?? {}).filter(([,v])=>v.failedCount>0).map(([name])=>({kind:'native-tool',status:'failed',actionKind:name}))]}}); } catch {}
        }
        appendBoundedJsonl(telemetryHistoryFile, {
          timestamp: new Date().toISOString(),
          runId,
          ...scope,
          ...(scope.kind === 'project' ? { workflowPhase, targetPageId } : {}),
          sessionId: s.sessionId,
          planningSessionId: planningSession?.sessionId,
          ok: !runFailed && !s.cancelled,
          ...(runErrorMessage ? { error: runErrorMessage.slice(0, 400) } : {}),
          metrics,
        }, 50);
      }
      safeRemoveFile(metricsFile);
      try { this.previewCaptureBridge?.unregisterTurn(runId); } catch {}
      try { preview.close(); } catch {}
      try { s.stopContext?.(); } catch {}
      s.stopContext = undefined;
      s.stopPreview = undefined;
      try {
        if (!runFailed) await draftRecovery.freezeContext(file, runId, 'available', undefined, s.clarifications);
        else if (!recoverySaved) await withContextLockAsync(file, () => {
          const current = draftRecovery.read(file);
          if (current?.runId === runId) draftRecovery.durableWrite(file, { ...current, active: false });
        });
      } catch {}
      const endIdentity = this.eventIdentity(s);
      if (this.activeProjectRuns.get(key) === s) {
        this.activeProjectRuns.delete(key);
      }
      s.running = false;
      s.runId = undefined;
      s.boundAdmissionId = null;
      s.clientRequestId = undefined;
      s.activeTargetPageId = undefined;
      s.questionProgress = undefined;
      s.promptStartedAt = null;
      s.acpSliceCursor = null;
      s.userWaitActive = false;
      s.userWaitMs = 0;
      s.openNativeTools = undefined;
      s.nativeToolExecMs = 0;
      s.nativeToolCallCount = 0;
      s.failedNativeToolCallCount = 0;
      s.nativeToolBreakdown = undefined;
      s.seenToolCallIds = undefined;
      for (const [id, p] of this.permissions) {
        if (!p.modelChangeSession && (p.sessionRef ? p.sessionRef === s : conversationKey(p) === key)) {
          try {
            this.respondPermission({ id, optionId: null });
          } catch {}
        }
      }
      for (const [id, q] of this.questions) {
        if (q.sessionRef ? q.sessionRef === s : conversationKey(q) === key) {
          try {
            this.respondQuestion({ id, answer: null });
          } catch {}
        }
      }
      if (runStarted) {
        try {
          this.emit({ type: "run-end", ...scope, ...endIdentity, runId, ...(metrics ? { metrics } : {}) });
        } catch {}
      }
    }
  }
  async cancel(input) {
    const scope = conversationScope(input), key = conversationKey(scope);
    this.cancelVersions.set(key, (this.cancelVersions.get(key) || 0) + 1);
    const s = this.activeProjectRuns.get(key) || this.sessions.get(key);
    if (!s?.running) return;
    s.cancelled = true;
    this.previewCaptureBridge?.unregisterTurn(s.runId);
    s.stopPreview?.();
    s.stopContext?.();
    const channelFile = path.join(this.recoveryChannelDir, draftRecovery.hash(s.sessionId) + '.json');
    atomicWrite(channelFile, { active: false, runId: s.runId });
    // Notify immediately; acquiring the context lock must not delay cancellation.
    this.client.notify("session/cancel", { sessionId: s.sessionId });
    for (const [id, p] of this.permissions) {
      if (!p.modelChangeSession && (p.sessionRef ? p.sessionRef === s : conversationKey(p) === key)) {
        this.respondPermission({ id, optionId: null });
      }
    }
    for (const [id, q] of this.questions) {
      if (q.sessionRef ? q.sessionRef === s : conversationKey(q) === key) {
        this.respondQuestion({ id, answer: null });
      }
    }
    await draftRecovery.freezeContext(path.join(s.dir, 'context.json'), s.runId, 'available', undefined, s.clarifications);
  }
  async completeRecovery(input) {
    const scope = conversationScope(input);
    const dir = this.conversationWorkspace(scope);
    const phase = input.workflowPhase || 'generating';
    const paths = draftRecovery.resolveExecutionPaths(dir, phase, input.targetPageId);
    const checkpoint = draftRecovery.read(paths.checkpointPath);
    if (!checkpoint || checkpoint.runId !== input.runId) return { completed: false };
    if (
      JSON.stringify(checkpoint.recovery?.identity?.scope) !== JSON.stringify(scope) ||
      checkpoint.targetPageId !== input.targetPageId
    ) {
      return { completed: false };
    }
    const account = this.accountProvider();
    if (
      checkpoint.recovery?.identity?.account?.userId !== account.userId ||
      checkpoint.recovery?.identity?.account?.serviceUrl !== account.serviceUrl ||
      account.status !== 'signed-in'
    ) {
      throw new Error(tr('登录账号已变化，未清理恢复记录', 'Signed-in account changed; recovery record was not cleared'));
    }
    if (this.info) {
      const currentEnv = { home: this.info.home, binary: this.info.binary, version: this.info.version };
      if (JSON.stringify(checkpoint.recovery?.identity?.environment) !== JSON.stringify(currentEnv)) {
        throw new Error(tr('Hermes 环境已变化，未清理恢复记录', 'Hermes environment changed; recovery record was not cleared'));
      }
    }
    if (checkpoint.recovery?.status === 'committed') {
      return { completed: true };
    }
    if (checkpoint.recovery?.status !== 'available') {
      throw new Error(tr('恢复记录状态不是可提交候选，拒绝标记已提交', 'Recovery record is not a committable candidate; refused to mark as committed'));
    }
    draftRecovery.durableWrite(paths.checkpointPath, {
      ...checkpoint,
      recovery: { ...checkpoint.recovery, status: 'committed', committedAt: new Date().toISOString() },
    });
    return { completed: true };
  }
  onNotification(frame) {
    if (frame.method !== "session/update") return;
    const s = this.findSessionByAcpId(frame.params?.sessionId);
    if (!s) return;
    const update = frame.params.update;
    if (!update || typeof update !== 'object') return;
    const meta = frame.params?._meta && typeof frame.params._meta === 'object' ? frame.params._meta : null;

    if (update.sessionUpdate === 'usage_update') {
      if (typeof meta?.alex_run_id === 'string' && s.running && meta.alex_run_id !== s.runId) return;
      this.acceptContext(s, { sessionId: s.sessionId, usage: { used: update.used, size: update.size } });
      return;
    }
    if (update.sessionUpdate === "current_model_update") {
      if (s.models.currentModelId !== update.currentModelId) {
        s.context = {};
        this.acceptContext(s, { sessionId: s.sessionId, usage: { available: false } });
      }
      s.models.currentModelId = update.currentModelId;
      if (!s.isPageExec) {
        this.emit({
          type: "session-update",
          ...conversationScope(s),
          ...this.eventIdentity(s),
          ...(s.running && s.runId ? { runId: s.runId } : {}),
          update,
        });
      }
      return;
    }
    if (NON_TURN_SESSION_UPDATES.has(update.sessionUpdate)) {
      return;
    }

    // Turn output updates MUST strictly prove origin `(alex_run_id, admission_id | alex_slash_reply)`.
    if (!s.running || s.cancelled) return;
    if (!meta || typeof meta.alex_run_id !== 'string' || meta.alex_run_id !== s.runId) return;
    if (meta.alex_slash_reply === true) {
      if (s.boundAdmissionId !== null) return;
    } else if (typeof meta.admission_id === 'string' && meta.admission_id.length > 0) {
      if (s.boundAdmissionId === null) {
        s.boundAdmissionId = meta.admission_id;
      } else if (s.boundAdmissionId !== meta.admission_id) {
        return;
      }
    } else {
      return;
    }

    if (!s.questionProgress || s.questionProgress.runId !== s.runId) {
      s.questionProgress = new QuestionProgress(s.runId);
    }
    s.questionProgress.observe(update);

    if (
      update.sessionUpdate === "agent_message_chunk" &&
      update.content?.type === "text"
    ) {
      s.text += update.content.text;
    }
    if (typeof s.promptStartedAt === "number") {
      const now = performance.now();
      if (
        s.firstOutputMs === null &&
        TURN_SESSION_UPDATES.has(update.sessionUpdate)
      ) {
        s.firstOutputMs = roundMs(now - s.promptStartedAt);
      }
      if (
        s.firstTextMs === null &&
        update.sessionUpdate === "agent_message_chunk" &&
        update.content?.type === "text" &&
        update.content.text
      ) {
        s.firstTextMs = roundMs(now - s.promptStartedAt);
      }
      if (update.sessionUpdate === "tool_call") {
        let isDuplicateStart = false;
        if (typeof update.toolCallId === "string" && update.toolCallId) {
          if (s.seenToolCallIds) {
            if (s.seenToolCallIds.has(update.toolCallId)) isDuplicateStart = true;
            else {
              s.seenToolCallIds.add(update.toolCallId);
              s.acpToolCallCount = (s.acpToolCallCount || 0) + 1;
            }
          }
        } else {
          s.acpToolCallCount = (s.acpToolCallCount || 0) + 1;
        }
        const toolName = parseAcpToolName(update);
        if (!isProtoflowMcpToolName(toolName)) {
          this.advanceAcpTimeline(s, now);
          const callKey = typeof update.toolCallId === "string" && update.toolCallId
            ? update.toolCallId
            : `__anon_${++s.anonNativeSeq}`;
          if (["completed", "failed", "cancelled"].includes(update.status)) {
            if (s.openNativeTools?.has(callKey)) {
              this.closeNativeToolEntry(s, callKey, update.status !== "completed");
            } else if (!isDuplicateStart) {
              this.recordCompletedNativeTool(s, toolName, 0, update.status !== "completed");
            }
          } else if (s.openNativeTools && !s.openNativeTools.has(callKey)) {
            s.openNativeTools.set(callKey, { toolName, elapsedMs: 0, failed: false });
          }
        }
      } else if (update.sessionUpdate === "tool_call_update") {
        if (
          typeof update.toolCallId === "string" &&
          s.openNativeTools?.has(update.toolCallId) &&
          ["completed", "failed", "cancelled"].includes(update.status)
        ) {
          this.advanceAcpTimeline(s, now);
          this.closeNativeToolEntry(s, update.toolCallId, update.status !== "completed");
        }
      } else if (
        (update.sessionUpdate === "agent_thought_chunk" || update.sessionUpdate === "agent_message_chunk") &&
        s.openNativeTools?.size > 0
      ) {
        this.closeAllOpenNativeTools(s, now);
      }
    }
    // Only signal activity. Never send model reasoning text to the renderer or chat history.
    if (update.sessionUpdate === "agent_thought_chunk") {
      if (!s.thinking) {
        s.thinking = true;
        this.emit({
          type: 'session-update',
          ...conversationScope(s),
          ...this.eventIdentity(s),
          runId: s.runId,
          update: { sessionUpdate: 'agent_thought_chunk' },
        });
      }
      return;
    }
    s.thinking = false;
    this.emit({
      type: "session-update",
      ...conversationScope(s),
      ...this.eventIdentity(s),
      runId: s.runId,
      update,
    });
  }
  onRequest(frame) {
    const s = this.findSessionByAcpId(frame.params?.sessionId);
    const meta = frame.params?._meta && typeof frame.params._meta === 'object' ? frame.params._meta : null;
    const rejectReq = (reason = tr(`Alex 无法处理当前会话的请求：${frame.method}`, `Alex cannot handle request for the current session: ${frame.method}`)) => {
      if (typeof this.client?.reject === 'function') {
        this.client.reject(frame.id, reason);
      } else if (typeof this.client?.reply === 'function') {
        this.client.reply(
          frame.id,
          frame.method === 'session/request_permission'
            ? { outcome: { outcome: 'cancelled' } }
            : { action: 'cancel' },
        );
      }
    };
    if (!s || !meta || typeof meta.alex_control_kind !== 'string') {
      rejectReq();
      return;
    }
    const controlKind = meta.alex_control_kind;

    if (frame.method === "elicitation/create") {
      if (
        controlKind !== 'turn' ||
        !s.running ||
        s.cancelled ||
        typeof meta.alex_run_id !== 'string' ||
        meta.alex_run_id !== s.runId ||
        typeof meta.admission_id !== 'string' ||
        !meta.admission_id
      ) {
        rejectReq();
        return;
      }
      if (s.boundAdmissionId === null) {
        s.boundAdmissionId = meta.admission_id;
      } else if (s.boundAdmissionId !== meta.admission_id) {
        rejectReq();
        return;
      }
      const schema = frame.params.requestedSchema;
      const answerSchema = schema?.properties?.answer;
      if (
        frame.params.mode !== "form" ||
        Object.keys(schema?.properties || {}).length !== 1 ||
        !["string", "array"].includes(answerSchema?.type)
      ) {
        this.client.reject(frame.id, "Unsupported question schema");
        return;
      }
      const id = String(frame.id);
      const progress = s.questionProgress?.runId === s.runId ? s.questionProgress?.forQuestion(frame.params.message) : undefined;
      this.questions.set(id, {
        rpcId: frame.id,
        ...conversationScope(s),
        sessionRef: s,
        questionText: typeof frame.params.message === 'string' ? frame.params.message : '',
        answerSchema,
        progress,
        sessionId: s.sessionId,
        runId: s.runId,
      });
      this.syncUserWait(s);
      this.emit({
        type: "question",
        id,
        ...conversationScope(s),
        ...this.eventIdentity(s),
        runId: s.runId,
        message: frame.params.message,
        answerSchema,
        ...(progress ? { progress } : {}),
      });
      return;
    }

    if (frame.method === "session/request_permission") {
      if (controlKind === 'turn') {
        if (
          !s.running ||
          s.cancelled ||
          typeof meta.alex_run_id !== 'string' ||
          meta.alex_run_id !== s.runId ||
          typeof meta.admission_id !== 'string' ||
          !meta.admission_id
        ) {
          rejectReq();
          return;
        }
        if (s.boundAdmissionId === null) {
          s.boundAdmissionId = meta.admission_id;
        } else if (s.boundAdmissionId !== meta.admission_id) {
          rejectReq();
          return;
        }
        const id = String(frame.id);
        this.permissions.set(id, {
          rpcId: frame.id,
          ...conversationScope(s),
          sessionRef: s,
          controlKind: 'turn',
          options: frame.params.options,
          sessionId: s.sessionId,
          runId: s.runId,
        });
        this.syncUserWait(s);
        this.emit({
          type: "permission",
          id,
          ...conversationScope(s),
          ...this.eventIdentity(s),
          runId: s.runId,
          toolCall: frame.params.toolCall,
          options: frame.params.options,
        });
        return;
      }
      if (controlKind === 'model_switch') {
        if (
          s.running ||
          !s.activeModelOp ||
          typeof meta.alex_model_op_id !== 'string' ||
          meta.alex_model_op_id !== s.activeModelOp.opId
        ) {
          rejectReq();
          return;
        }
        const id = String(frame.id);
        this.permissions.set(id, {
          rpcId: frame.id,
          ...conversationScope(s),
          sessionRef: s,
          controlKind: 'model_switch',
          modelOpId: s.activeModelOp.opId,
          modelChangeSession: s,
          options: frame.params.options,
          sessionId: s.sessionId,
        });
        this.syncUserWait(s);
        this.emit({
          type: "permission",
          id,
          ...conversationScope(s),
          ...this.eventIdentity(s),
          toolCall: frame.params.toolCall,
          options: frame.params.options,
        });
        return;
      }
      if (controlKind === 'slash_model_switch') {
        if (
          !s.running ||
          s.cancelled ||
          s.boundAdmissionId !== null ||
          typeof meta.alex_run_id !== 'string' ||
          meta.alex_run_id !== s.runId
        ) {
          rejectReq();
          return;
        }
        const id = String(frame.id);
        this.permissions.set(id, {
          rpcId: frame.id,
          ...conversationScope(s),
          sessionRef: s,
          controlKind: 'slash_model_switch',
          options: frame.params.options,
          sessionId: s.sessionId,
          runId: s.runId,
        });
        this.syncUserWait(s);
        this.emit({
          type: "permission",
          id,
          ...conversationScope(s),
          ...this.eventIdentity(s),
          runId: s.runId,
          toolCall: frame.params.toolCall,
          options: frame.params.options,
        });
        return;
      }
    }
    rejectReq();
  }
  respondPermission({ id, optionId }) {
    const p = this.permissions.get(id);
    if (!p) throw new Error(tr("该授权请求已结束", "This permission request has already ended"));
    if (optionId !== null && !p.options.some((o) => o.optionId === optionId))
      throw new Error(tr("无效授权选项", "Invalid permission option"));
    try {
      this.client.reply(p.rpcId, {
        outcome:
          optionId === null
            ? { outcome: "cancelled" }
            : { outcome: "selected", optionId },
      });
    } finally {
      this.permissions.delete(id);
      this.syncUserWait(p.sessionRef || this.sessions.get(conversationKey(p)));
      this.emit({ type: "permission-resolved", id, ...conversationScope(p) });
    }
  }
  respondQuestion({ id, answer, supplement }) {
    const q = this.questions.get(id);
    if (!q) throw new Error(tr("该问题已结束", "This question has already ended"));
    if (supplement !== undefined && (typeof supplement !== 'string' || !supplement.trim() || answer === null))
      throw new Error(tr('补充说明必须是非空文字，不能与跳过问题一起提交', 'Supplement must be non-empty text and cannot be submitted when skipping the question'));
    let responseAnswer = answer;
    if (answer !== null) {
      const schema = q.answerSchema,
        values = schema.type === "array" ? answer : answer === '' && supplement !== undefined ? [] : [answer];
      if (
        !Array.isArray(values) ||
        (!values.length && supplement === undefined) ||
        values.some((v) => typeof v !== "string" || !v.trim()) ||
        (schema.type === "string" && typeof answer !== "string")
      )
        throw new Error(tr("请输入有效答案", "Please enter a valid answer"));
      const choices =
        schema.type === "array" ? schema.items?.enum : schema.enum;
      if (choices && values.some((v) => !choices.includes(v)))
        throw new Error(tr("答案不在 Hermes 提供的选项中", "Answer is not among the options provided by Hermes"));
      // Hermes clarify explicitly supports a typed "Other" answer. Its ACP
      // adapter exposes offered choices as enum but elicited_answer accepts text
      // (or a JSON string array). Keep enum validation for selections; only the
      // explicit supplement channel carries user-authored text, never fake choices.
      if (supplement !== undefined) {
        responseAnswer = schema.type === 'array'
          ? [...values, supplement]
          : values.length ? `选择：${answer}\n补充说明：${supplement}` : supplement;
      }
    }
    this.client.reply(
      q.rpcId,
      answer === null
        ? { action: "cancel" }
        : { action: "accept", content: { answer: responseAnswer } },
    );
    this.questions.delete(id);
    const session = q.sessionRef || this.sessions.get(conversationKey(q));
    this.syncUserWait(session);
    if (session && session.sessionId === q.sessionId && session.runId === q.runId) {
      session.questionProgress?.resolve(q.progress);
      if (answer !== null) {
        const { cleanText } = require('./diagnostics.cjs');
        const entry = {
          question: cleanText(q.questionText || '', 500),
          answer: Array.isArray(responseAnswer)
            ? responseAnswer.map(v => cleanText(String(v), 500))
            : cleanText(String(responseAnswer), 500),
          answeredAt: new Date().toISOString(),
        };
        session.clarifications = [...(session.clarifications || []).slice(-19), entry];
        if (typeof session.dir === 'string' && session.dir) {
          const ctxFile = path.join(session.dir, 'context.json');
          try {
            const { withContextLock } = require('./context-transaction.cjs');
            withContextLock(ctxFile, () => {
              const cur = draftRecovery.read(ctxFile);
              if (cur?.active && cur.runId === q.runId) {
                atomicWrite(ctxFile, { ...cur, clarifications: session.clarifications });
              }
            });
          } catch {}
        }
      }
    }
    this.emit({ type: "question-resolved", id, ...conversationScope(q) });
  }
  async sync({ projectId, skillMarkdown, kind, mindmapId, threadId }) {
    await this.connect();
    if (kind !== undefined && kind !== 'mindmap' && kind !== 'project') throw new Error(tr('未知的项目指令类型', 'Unknown project instruction kind'));
    if (kind === undefined && mindmapId !== undefined) throw new Error(tr('页面指令不能包含脑图 ID', 'Page instructions cannot include a mindmap ID'));
    const dir = kind === 'project' ? this.conversationWorkspace({ projectId, kind, threadId }) : kind === 'mindmap' ? this.conversationWorkspace({ projectId, kind, mindmapId }) : this.workspace(projectId);
    if (kind === 'project' && fs.existsSync(path.join(dir, 'deleted.json'))) throw new Error(tr('这条项目会话已删除，请切换会话', 'This project conversation has been deleted; please switch to another conversation'));
    if (typeof skillMarkdown !== "string") throw new Error(tr("技能内容无效", "Invalid skill markdown content"));
    // Project instructions are local to this session cwd. Never overwrite global Hermes skills/config.
    const skillFile = path.join(dir, "AGENTS.md");
    writeSkillFileIfChanged(skillFile, skillMarkdown);
    for (const session of this.allLoadedSessions()) {
      if (
        !session.running &&
        session.projectId === projectId &&
        session.kind === kind &&
        (kind !== 'project' || session.threadId === threadId) &&
        (kind !== 'mindmap' || session.mindmapId === mindmapId)
      ) {
        writeSkillFileIfChanged(path.join(session.dir, 'AGENTS.md'), skillMarkdown);
      }
    }
    return { synced: true, skillFile, skillDigest: this.fileSkillDigest(skillFile) };
  }
  async prepareStagedRelease(info, { targetCommit, slotDir, slotBinary }) {
    const activeInstallDir = path.resolve(expand(info.installDir));
    const resolvedSlotDir = path.resolve(slotDir);
    if (resolvedSlotDir === activeInstallDir) {
      throw new Error(tr("暂存区目录不能与当前活动安装目录相同，已拒绝就地改写运行环境", "Staging directory cannot match the active installation directory; refused to overwrite live runtime in place"));
    }
    if (fs.existsSync(resolvedSlotDir)) {
      const head = await this.runCommand("git", ["-C", resolvedSlotDir, "rev-parse", "--verify", "HEAD"], info.home, 15000);
      if (!head.ok || head.output.trim() !== targetCommit) {
        if (resolvedSlotDir === activeInstallDir) {
          throw new Error(tr("当前运行目录与目标暂存槽位冲突且提交不一致，已拒绝就地覆盖", "Active installation directory conflicts with the target staging slot at a different commit; refused to overwrite in place"));
        }
        hostFs.rmSync(resolvedSlotDir, { recursive: true, force: true });
      }
    }
    if (!fs.existsSync(resolvedSlotDir)) {
      const releasesDir = path.join(info.home, "releases");
      fs.mkdirSync(releasesDir, { recursive: true, mode: 0o700 });
      const tempCloneDir = path.join(releasesDir, ".staging-" + randomUUID());
      try {
        const cloned = await this.runCommand(
          "git",
          ["clone", "--no-checkout", activeInstallDir, tempCloneDir],
          info.home,
          5 * 60 * 1000,
        );
        if (!cloned.ok) throw new Error(describeHermesUpdateError(cloned));
        const localHasCommit = await this.runCommand(
          "git",
          ["-C", tempCloneDir, "cat-file", "-e", `${targetCommit}^{commit}`],
          info.home,
          15000,
        );
        if (!localHasCommit.ok) {
          const remoteQuery = await this.runCommand(
            "git",
            ["-C", activeInstallDir, "remote", "get-url", "origin"],
            info.home,
            15000,
          );
          const remoteUrl = remoteQuery.ok && remoteQuery.output.trim()
            ? remoteQuery.output.trim()
            : "https://github.com/NousResearch/hermes-agent.git";
          await this.runCommand("git", ["-C", tempCloneDir, "remote", "set-url", "origin", remoteUrl], info.home, 15000);
          const fetched = await this.runCommand(
            "git",
            ["-C", tempCloneDir, "fetch", "--depth", "1", "origin", targetCommit],
            info.home,
            10 * 60 * 1000,
          );
          if (!fetched.ok) throw new Error(describeHermesUpdateError(fetched));
        }
        const checkedOut = await this.runCommand(
          "git",
          ["-C", tempCloneDir, "checkout", "--force", "--detach", targetCommit],
          info.home,
          2 * 60 * 1000,
        );
        if (!checkedOut.ok) throw new Error(describeHermesUpdateError(checkedOut));
        const verifiedHead = await this.runCommand(
          "git",
          ["-C", tempCloneDir, "rev-parse", "--verify", "HEAD"],
          info.home,
          15000,
        );
        if (!verifiedHead.ok || verifiedHead.output.trim() !== targetCommit) {
          throw new Error(tr("暂存区 Hermes 提交校验不一致，已放弃切换", "Staged Hermes commit verification mismatch; aborted switch"));
        }
        fs.mkdirSync(path.dirname(resolvedSlotDir), { recursive: true, mode: 0o700 });
        fs.renameSync(tempCloneDir, resolvedSlotDir);
      } finally {
        hostFs.rmSync(tempCloneDir, { recursive: true, force: true });
      }
    }
    const launch = await this.runCommand(info.binary, ["--print-runtime-command"], info.home, 30000);
    let currentRuntimeCmd;
    try { currentRuntimeCmd = JSON.parse(launch.output); } catch {}
    if (!launch.ok || !Array.isArray(currentRuntimeCmd) || !path.isAbsolute(currentRuntimeCmd[0])) {
      throw new Error(tr("Hermes 启动器未提供恢复适配接口", "Hermes launcher does not expose the recovery adapter interface"));
    }
    const publishScript =
      "import pathlib, sys; root = pathlib.Path(sys.argv[1]).resolve(); sys.path.insert(0, str(root)); " +
      "from hermes_cli._launchers import ensure_install_launchers; " +
      "written = ensure_install_launchers(root, root / '.hermes' / 'bin'); " +
      "raise SystemExit(0 if written else 1)";
    const published = await this.runCommand(
      currentRuntimeCmd[0],
      ["-I", "-c", publishScript, resolvedSlotDir],
      info.home,
      60000,
    );
    if (!published.ok || !fs.existsSync(slotBinary)) {
      throw new Error(tr("暂存区 Hermes 启动器生成失败，原环境保持不变", "Failed to generate staged Hermes launcher; original environment left unchanged"));
    }
    const deps = await this.runCommand(
      slotBinary,
      ["pm", "install", "--extra", "acp", "--extra", "web"],
      info.home,
      20 * 60 * 1000,
    );
    if (!deps.ok) throw new Error(describeHermesUpdateError(deps));
  }
  async verifyStagedRelease(info, { targetCommit, slotDir, slotBinary }) {
    const resolvedSlotDir = path.resolve(slotDir);
    const head = await this.runCommand("git", ["-C", resolvedSlotDir, "rev-parse", "--verify", "HEAD"], info.home, 15000);
    if (!head.ok || head.output.trim() !== targetCommit) {
      throw new Error(tr("暂存区 Hermes 提交校验未通过，原环境保持不变", "Staged Hermes commit verification failed; original environment left unchanged"));
    }
    const native = require("./hermes-recovery-native.cjs");
    const verifyRoot = fs.mkdtempSync(path.join(this.dataDir, "stage-verify-"));
    const verifyHome = path.join(verifyRoot, "home");
    const verifyRecoveryDir = path.join(verifyRoot, "request-recovery");
    let copy = null;
    let python = null;
    let probeClient = null;
    try {
      fs.mkdirSync(verifyHome, { recursive: true, mode: 0o700 });
      fs.mkdirSync(verifyRecoveryDir, { recursive: true, mode: 0o700 });
      for (const sharedName of ["installs", "tools"]) {
        const src = path.join(info.home, sharedName);
        if (fs.existsSync(src)) {
          fs.symlinkSync(src, path.join(verifyHome, sharedName), process.platform === "win32" ? "junction" : "dir");
        }
      }
      fs.writeFileSync(path.join(verifyHome, "config.yaml"), "updates:\n  check: false\n", { mode: 0o600 });
      copy = await native.prepareNativeRecovery(resolvedSlotDir, verifyRoot);
      const launch = await this.runCommand(slotBinary, ["--print-runtime-command"], info.home, 30000);
      let command;
      try { command = JSON.parse(launch.output); } catch {}
      if (!launch.ok || !Array.isArray(command) || !path.isAbsolute(command[0])) {
        throw new Error(tr("暂存区 Hermes 启动器未提供恢复适配接口", "Staged Hermes launcher does not expose the recovery adapter interface"));
      }
      python = command[0];
      const bootstrap = fs.readFileSync(path.join(__dirname, "hermes-recovery-gateway.py"), "utf8");
      const activated = await runCommand(
        python,
        ["-I", "-c", bootstrap, copy],
        verifyHome,
        120000,
        { ALEX_RECOVERY_DIR: verifyRecoveryDir, HERMES_DISABLE_LAZY_INSTALLS: "1" },
        this.envFor(info.home),
      );
      let activation;
      try { activation = JSON.parse(activated.output.trim().split("\n").at(-1)); } catch {}
      if (!activated.ok || activation?.ready !== true) {
        throw new Error(activation?.error || tr("暂存区 Hermes 限流恢复网关校验未通过", "Staged Hermes rate-limit recovery gateway verification failed"));
      }
      probeClient = new AcpClient(python, {
        home: verifyHome,
        args: ["-I", "-c", native.launchScript, copy, "acp"],
        env: { ...this.envFor(info.home), ALEX_RECOVERY_DIR: verifyRecoveryDir, HERMES_DISABLE_LAZY_INSTALLS: "1" },
      });
      const init = await probeClient.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "protoflow-stage-verify", version: "0.1.0" },
        clientCapabilities: { elicitation: { form: {} } },
      });
      if (init.protocolVersion !== 1 || !init.agentCapabilities?.loadSession) {
        throw new Error(tr("暂存区 Hermes ACP 版本不兼容：缺少会话恢复支持", "Incompatible staged Hermes ACP version: missing session recovery support"));
      }
    } finally {
      try { probeClient?.close(); } catch {}
      if (python && copy) {
        await runCommand(python, ["-I", "-c", native.launchScript, copy, "gateway", "stop"], verifyHome, 15000, {}, this.envFor(info.home)).catch(() => {});
      }
      hostFs.rmSync(verifyRoot, { recursive: true, force: true });
    }
  }
  async update() {
    if (this.allLoadedSessions().some((s) => s.running))
      throw new Error(tr("请停止 AI 任务后再升级", "Please stop active AI tasks before upgrading"));
    const info = await this.detect();
    if (!info.detected) throw new Error(info.error);
    const { VERIFIED_HERMES_COMMIT, VERIFIED_HERMES_VERSION } = require("./hermes-recovery-native.cjs");
    if (!this.isAppManagedInstallation(info)) {
      throw new Error(
        tr(
          `当前连接的是用户自行维护的外部 Hermes 环境（${info.home}），应用不会就地执行在线升级以免破坏受检恢复补丁；请在外部按受支持提交 ${VERIFIED_HERMES_COMMIT.slice(0, 12)}（v${VERIFIED_HERMES_VERSION}）维护环境，当前连接保持可用。`,
          `Connected to a user-maintained external Hermes environment (${info.home}). Alex will not run an in-place online upgrade to avoid breaking verified recovery patches; please maintain the external environment at supported commit ${VERIFIED_HERMES_COMMIT.slice(0, 12)} (v${VERIFIED_HERMES_VERSION}). The current connection remains available.`,
        ),
      );
    }
    const targetCommit = VERIFIED_HERMES_COMMIT;
    const binName = process.platform === "win32" ? "hermes.exe" : "hermes";
    const defaultSlotDir = path.join(info.home, "releases", targetCommit, "hermes-agent");
    const activeInstallDir = path.resolve(expand(info.installDir));
    const activeHead = await this.runCommand(
      "git",
      ["-C", activeInstallDir, "rev-parse", "--verify", "HEAD"],
      info.home,
      15000,
    );
    const activeAtTargetCommit = Boolean(activeHead.ok && activeHead.output.trim() === targetCommit);
    const activeIsDefaultSlot = activeInstallDir === path.resolve(defaultSlotDir);
    const readOnlyCurrentInstall = activeAtTargetCommit || (activeIsDefaultSlot && !activeHead.ok);

    let slotDir;
    let slotBinary;
    if (readOnlyCurrentInstall) {
      // Already running the target release: verify strictly read-only without regenerating
      // launchers or running `pm install` on the live installation directory.
      slotDir = activeInstallDir;
      slotBinary = info.binary;
      await this.verifyStagedRelease(info, { targetCommit, slotDir, slotBinary });
    } else {
      slotDir = activeIsDefaultSlot
        ? path.join(info.home, "releases", `${targetCommit}-${randomUUID().slice(0, 8)}`, "hermes-agent")
        : defaultSlotDir;
      slotBinary = path.join(slotDir, ".hermes", "bin", binName);
      try {
        await this.prepareStagedRelease(info, { targetCommit, slotDir, slotBinary });
        await this.verifyStagedRelease(info, { targetCommit, slotDir, slotBinary });
      } catch (stageError) {
        if (path.resolve(slotDir) !== activeInstallDir) {
          try { hostFs.rmSync(slotDir, { recursive: true, force: true }); } catch {}
        }
        throw stageError;
      }
    }
    if (this.allLoadedSessions().some((s) => s.running))
      throw new Error(tr("请停止 AI 任务后再完成升级切换", "Please stop active AI tasks before completing the upgrade switch"));
    const wasConnected = Boolean(this.client && !this.client.closed);
    if (
      readOnlyCurrentInstall &&
      wasConnected &&
      this.info &&
      path.resolve(expand(this.info.home || info.home)) === path.resolve(expand(info.home)) &&
      path.resolve(expand(this.info.binary || info.binary)) === path.resolve(expand(info.binary))
    ) {
      return this.info;
    }
    const hadSettingsFile = fs.existsSync(this.settingsFile);
    const previousSettingsRaw = hadSettingsFile ? fs.readFileSync(this.settingsFile, "utf8") : null;
    const previousSettings = { ...this.settings };
    const previousInfo = this.info ? { ...this.info } : null;
    const reconnectTarget = {
      home: previousSettings.home || previousInfo?.home || info.home,
      binary: previousSettings.binary || previousInfo?.binary || info.binary,
    };
    const restorePreviousSettings = () => {
      this.settings = { ...previousSettings };
      if (hadSettingsFile && previousSettingsRaw !== null) {
        let parsed;
        try { parsed = JSON.parse(previousSettingsRaw); } catch {}
        if (parsed && typeof parsed === "object") atomicWrite(this.settingsFile, parsed);
        else fs.writeFileSync(this.settingsFile, previousSettingsRaw, { mode: 0o600 });
      } else {
        fs.rmSync(this.settingsFile, { force: true });
      }
    };
    this.close();
    try {
      return await this.connect({ home: info.home, binary: slotBinary });
    } catch (switchError) {
      restorePreviousSettings();
      if (path.resolve(slotDir) !== activeInstallDir) {
        try { hostFs.rmSync(slotDir, { recursive: true, force: true }); } catch {}
      }
      if (wasConnected && reconnectTarget.home && reconnectTarget.binary) {
        try {
          await this.connect(reconnectTarget);
          restorePreviousSettings();
        } catch (rollbackError) {
          this.close();
          restorePreviousSettings();
          const switchMsg = switchError instanceof Error ? switchError.message : String(switchError);
          const rollbackMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          const combined = new Error(tr(
            `Hermes 升级切换失败（${switchMsg}），且恢复原连接失败（${rollbackMsg}）`,
            `Hermes upgrade switch failed (${switchMsg}), and restoring the previous connection also failed (${rollbackMsg})`,
          ));
          combined.cause = switchError;
          combined.rollbackError = rollbackError;
          throw combined;
        }
      }
      throw switchError;
    }
  }
  close() {
    for (const s of this.allLoadedSessions()) {
      s.stopPreview?.();
      s.stopContext?.();
    }
    if (this.client) this.client.close();
    this.client = null;
    if (this.info) this.info = { ...this.info, connected: false };
    this.sessions.clear();
    this.pageSessions.clear();
    this.activeProjectRuns.clear();
    this.permissions.clear();
    this.questions.clear();
    this.lastSessionSetup.clear();
    this.unconsumedSessionSetup.clear();
    this.previewCaptureBridge?.close();
    this.contextPool.close();
  }
}
module.exports = {
  HermesRuntime,
  runCommand,
  runtimeEnv,
  conversationKey,
  taskKeyForExecution,
  buildFailureEnvelope,
  describeHermesUpdateError,
};
