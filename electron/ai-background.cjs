const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isCancellation } = require('./diagnostics.cjs');

// Leases cover both renderer workflows (including validation/save between turns)
// and native executions. Finishing one request must not release another's power assertion.
class AiBackground {
  constructor({ powerSaveBlocker, powerMonitor, dataDir, emit = () => {}, diagnostic = () => {}, notify = () => {}, clearNotification = () => {}, now = Date.now }) {
    Object.assign(this, { powerSaveBlocker, powerMonitor, emit, diagnostic, notify, clearNotification, now });
    this.settingsFile = path.join(dataDir, 'ai-background.json');
    this.settings = { preventSleep: true, notifications: true };
    this.leases = new Map();
    this.windows = new Map();
    this.blockerId = null;
    this.healthError = '';
    this.suspended = false;
    this.locked = false;
    this.sequence = 0;
    this.events = [];
    this.closed = false;
    try {
      const value = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
      if (typeof value.preventSleep !== 'boolean' || typeof value.notifications !== 'boolean') throw new Error('Invalid settings');
      this.settings = { preventSleep: value.preventSleep, notifications: value.notifications };
    } catch (error) {
      if (error.code !== 'ENOENT') this.healthError = '后台运行设置无法读取，当前使用默认设置，请重新保存。';
    }
    try { this.locked = powerMonitor.getSystemIdleState(1) === 'locked'; } catch {}
    this.listeners = new Map(['lock-screen', 'unlock-screen', 'suspend', 'resume'].map(name => {
      const listener = () => this.powerEvent(name);
      powerMonitor.on(name, listener);
      return [name, listener];
    }));
  }
  snapshot() {
    return { ...this.settings, active: this.leases.size > 0, protected: this.blockerId !== null && this.powerSaveBlocker.isStarted(this.blockerId),
      locked: this.locked, suspended: this.suspended, healthError: this.healthError };
  }
  changed() { try { this.emit(this.snapshot()); } catch {} }
  report(code, context = {}, checks = []) {
    try { this.diagnostic({ source: 'main', category: 'ai', code, stage: 'background',
      message: code === 'AI_SYSTEM_SUSPEND' ? 'AI 任务期间系统进入睡眠，连接可能中断' : 'AI 后台运行保护异常', context: { ...context, checks } }); } catch {}
  }
  attach(webContents) {
    if (this.windows.has(webContents.id)) return;
    this.windows.set(webContents.id, { webContents, original: webContents.getBackgroundThrottling() });
    this.sync();
  }
  begin(scope, owner, type = 'workflow') {
    if (this.closed) throw new Error('后台运行服务已关闭');
    if (!scope || typeof scope.projectId !== 'string' || !scope.projectId.trim()) throw new Error('后台任务缺少 projectId');
    // Keep structural identifiers only; never retain prompts, page source or snapshot rows.
    const context = {};
    for (const key of ['projectId', 'threadId', 'pageId', 'mindmapId', 'kind', 'workflowPhase', 'targetPageId']) {
      if (typeof scope[key] === 'string') context[key] = scope[key];
    }
    const id = randomUUID(), first = this.leases.size === 0;
    this.leases.set(id, { owner, type, context, sequence: this.sequence, suspended: false });
    this.sync();
    if (first && this.locked) this.notice('running');
    return id;
  }
  end(id, owner, outcome = 'finished') {
    const lease = this.leases.get(id);
    if (!lease) return;
    if (lease.owner !== owner) throw new Error('后台任务不属于当前窗口');
    if (!['finished', 'failed', 'cancelled'].includes(outcome)) throw new Error('未知的后台任务结果');
    this.leases.delete(id);
    this.sync();
    if (!this.leases.size) {
      this.clearNotice();
      if (this.locked) this.notice(outcome);
    }
  }
  releaseOwner(owner) {
    for (const [id, lease] of this.leases) if (lease.owner === owner) this.leases.delete(id);
    this.sync();
    if (!this.leases.size) this.clearNotice();
  }
  detach(owner) {
    this.releaseOwner(owner);
    const window = this.windows.get(owner);
    if (window && !window.webContents.isDestroyed()) window.webContents.setBackgroundThrottling(window.original);
    this.windows.delete(owner);
  }
  sync() {
    const active = this.leases.size > 0;
    try {
      if (active && this.settings.preventSleep) {
        if (this.blockerId === null || !this.powerSaveBlocker.isStarted(this.blockerId)) {
          this.blockerId = this.powerSaveBlocker.start('prevent-app-suspension');
          if (!this.powerSaveBlocker.isStarted(this.blockerId)) throw new Error('Power assertion not started');
        }
      } else if (this.blockerId !== null) {
        this.powerSaveBlocker.stop(this.blockerId);
        this.blockerId = null;
      }
    } catch {
      this.healthError = '系统未能完整启用或释放后台保护，请检查运行诊断。';
      this.report('AI_BACKGROUND_PROTECTION_FAILED');
    }
    // Renderer scheduling must still be enabled if the OS refuses a power assertion.
    for (const [id, window] of this.windows) {
      try {
        if (window.webContents.isDestroyed()) { this.windows.delete(id); continue; }
        window.webContents.setBackgroundThrottling(active ? false : window.original);
      } catch {
        this.healthError = '后台任务调度设置失败，请检查运行诊断。';
        this.report('AI_BACKGROUND_SCHEDULING_FAILED');
      }
    }
    this.changed();
  }
  configure(input) {
    if (!input || typeof input.preventSleep !== 'boolean' || typeof input.notifications !== 'boolean') throw new Error('后台运行设置格式错误');
    const settings = { preventSleep: input.preventSleep, notifications: input.notifications };
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile + '.tmp', JSON.stringify(settings), { mode: 0o600 });
    fs.renameSync(this.settingsFile + '.tmp', this.settingsFile);
    this.settings = settings;
    if (!settings.notifications) this.clearNotice();
    this.healthError = '';
    this.sync();
    return this.snapshot();
  }
  powerEvent(name) {
    if (this.closed) return;
    if (name === 'lock-screen') this.locked = true;
    if (name === 'unlock-screen') this.locked = false;
    if (name === 'unlock-screen') this.clearNotice();
    if (name === 'suspend') this.suspended = true;
    if (name === 'resume') this.suspended = false;
    this.events.push({ name, sequence: ++this.sequence, at: new Date(this.now()).toISOString() });
    this.events = this.events.slice(-16);
    if (name === 'suspend') {
      const reported = new Set();
      for (const lease of this.leases.values()) {
        lease.suspended = true;
        const key = JSON.stringify(lease.context);
        if (!reported.has(key)) this.report('AI_SYSTEM_SUSPEND', lease.context, this.checks(lease.context));
        reported.add(key);
      }
    }
    this.sync();
    if (name === 'lock-screen' && this.leases.size) this.notice('running');
  }
  checks(scope) {
    const leases = [...this.leases.values()].filter(lease => lease.context.projectId === scope?.projectId);
    const start = leases.length ? Math.min(...leases.map(lease => lease.sequence)) : this.sequence;
    return [
      { kind: 'power-protection', status: this.snapshot().protected ? 'active' : this.settings.preventSleep ? 'inactive' : 'disabled' },
      { kind: 'screen-state', status: this.locked ? 'locked' : 'unlocked' },
      { kind: 'system-state', status: this.suspended ? 'suspended' : 'awake' },
      { kind: 'task-suspend', status: leases.some(lease => lease.suspended) ? 'observed' : 'not-observed' },
      ...this.events.filter(event => event.sequence > start).map(event => ({ kind: 'power-event', status: `${event.name}@${event.at}` })),
    ];
  }
  notice(outcome) {
    if (!this.settings.notifications) return;
    const body = { running: 'AI 任务正在后台运行。解锁后可查看进度。', finished: 'AI 本轮任务已结束，请返回 Alex 查看结果。',
      failed: 'AI 任务未完成，请返回 Alex 查看原因和诊断编号。', cancelled: 'AI 任务已停止。' }[outcome];
    try { this.notify({ title: 'Alex · AI 任务', body }); } catch { this.notificationFailed(); }
  }
  notificationFailed() {
    this.healthError = '系统通知未能送达。请检查 Alex 的通知权限与锁屏通知设置；后台保护状态见上方。';
    this.changed();
  }
  clearNotice() { try { this.clearNotification(); } catch {} }
  async run(scope, owner, work) {
    const id = this.begin(scope, owner, 'native');
    let outcome = 'finished';
    try { return await work(); }
    catch (error) {
      const cancelled = isCancellation(error);
      outcome = cancelled ? 'cancelled' : 'failed';
      const checks = this.checks(scope);
      if (error instanceof Error) error.backgroundChecks = checks;
      if (!cancelled && this.leases.get(id)?.suspended) {
        // Correlation, not an assertion that sleep caused the provider's error. Never replay writes.
        const interrupted = new Error(`AI 任务失败。任务期间系统曾进入睡眠，请检查连接后重试。原始错误：${error instanceof Error ? error.message : String(error)}`, { cause: error });
        interrupted.backgroundChecks = checks;
        interrupted.rpcCode = error.rpcCode;
        interrupted.rpcMethod = error.rpcMethod;
        throw interrupted;
      }
      throw error;
    } finally { this.end(id, owner, outcome); }
  }
  close() {
    this.closed = true;
    this.clearNotice();
    for (const [name, listener] of this.listeners) this.powerMonitor.removeListener(name, listener);
    this.leases.clear();
    this.sync();
    this.windows.clear();
  }
}
module.exports = { AiBackground };
