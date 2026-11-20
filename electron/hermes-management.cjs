const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { verify, VERIFIED_HERMES_COMMIT } = require('./hermes-recovery-native.cjs');

// Official dashboard routes, verified against Hermes web/src/App.tsx. Never
// accept an arbitrary URL from the renderer or change the selected profile.
const MANAGEMENT_ROUTES = Object.freeze({
  accounts: '/env', models: '/models', skills: '/skills',
  history: '/sessions', memory: '/system', tools: '/mcp',
  plugins: '/plugins', schedules: '/cron', channels: '/channels',
  diagnostics: '/system', logs: '/logs', backup: '/system', settings: '/config',
});
const INSTALL_STAGES = Object.freeze({
  prerequisites: '检查系统准备情况', repository: '下载 Hermes',
  venv: '准备运行环境', 'python-deps': '安装运行组件',
  config: '准备个人配置', products: '准备可视化管理界面', complete: '完成安装',
});
const STAGE_ORDER = Object.keys(INSTALL_STAGES);
const running = s => s.status === 'running' || s.status === 'cancelling';
function parseManifest(output) {
  const manifest = JSON.parse(output.trim());
  if (manifest.protocol_version !== 1 || !Array.isArray(manifest.stages))
    throw new Error('官方安装器协议已变化，请更新 Alex 后重试');
  const stages = manifest.stages.filter(s => s.needs_user_input === false);
  if (stages.length !== STAGE_ORDER.length || stages.some((s, i) => s.name !== STAGE_ORDER[i]))
    throw new Error('官方安装步骤已变化，请更新 Alex 后重试');
  return stages;
}
function parseStageResult(output, stage) {
  const frames = output.split(/\r?\n/).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const result = frames.findLast(f => f.stage === stage && typeof f.ok === 'boolean');
  if (!result || !result.ok || result.skipped === true)
    throw new Error(`${INSTALL_STAGES[stage]}未完成。请检查网络与磁盘空间后重试。`);
}
function dashboardUrl(origin, section, profile) {
  if (!Object.hasOwn(MANAGEMENT_ROUTES, section)) throw new Error('未知的 AI 管理页面');
  const base = new URL(origin);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password)
    throw new Error('AI 管理服务地址无效');
  const target = new URL(MANAGEMENT_ROUTES[section], base.origin);
  if (profile !== undefined) {
    if (typeof profile !== 'string') throw new Error('Hermes 环境标识无效');
    // Explicit empty scope is also meaningful for a custom HERMES_HOME.
    target.searchParams.set('profile', profile);
  }
  return target.href;
}
function dashboardProfile(html) {
  const value = /window\.__HERMES_DASHBOARD_PROFILE__=("(?:[^"\\]|\\.)*");/.exec(html);
  if (!value) throw new Error('当前 Hermes 管理界面不支持环境绑定，请更新 Hermes 后重试');
  const profile = JSON.parse(value[1]);
  if (typeof profile !== 'string') throw new Error('Hermes 返回了无效的环境标识');
  return profile;
}

class HermesManagement {
  constructor({ runtime, dataDir, emit, spawnProcess = spawn, fetchResource = fetch, platform = process.platform }) {
    Object.assign(this, { runtime, dataDir, emit, spawnProcess, fetchResource, platform });
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.stateFile = path.join(dataDir, 'installation.json');
    this.state = { status: 'idle', phase: '', completed: 0, total: STAGE_ORDER.length + 2, message: '' };
    try {
      const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      // Only a persisted operation, never an old success, can describe a failure.
      if (running(saved)) this.state = { ...this.state, status: 'interrupted', message: '上次安装被中断，点击重试即可继续准备。' };
    } catch {}
    this.dashboard = null;
    this.dashboardStarting = null;
  }
  snapshot() {
    const { home, binary, previousExternal } = this.runtime.settings;
    let selectedRuntime;
    if (home && binary) {
      if (path.resolve(home) !== this.runtime.managedHome) selectedRuntime = 'external';
      else selectedRuntime = path.resolve(binary).startsWith(path.join(this.runtime.managedHome, 'releases') + path.sep) ? 'managed' : 'legacy-managed';
    }
    return { ...this.state, selectedRuntime, previousExternal, needsResume: fs.existsSync(path.join(this.dataDir, 'installation-pending')) };
  }
  progress(patch) {
    this.state = { ...this.state, ...patch };
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state), { mode: 0o600 });
    this.emit({ type: 'installation', installation: this.snapshot() });
  }
  assertIdle() {
    if (running(this.state)) throw new Error('正在准备 Hermes，请等待完成或取消安装');
  }
  assertNoChat() {
    if (this.runtime.connecting || this.runtime.allLoadedSessions().some(s => s.running) || this.runtime.activeProjectRuns.size)
      throw new Error('请先等待连接完成或停止正在生成的 AI 任务');
  }
  startInstall({ repair = false } = {}) {
    if (running(this.state)) return this.snapshot();
    this.assertNoChat();
    this.controller = new AbortController();
    this.progress({ status: 'running', phase: '检查已有安装', completed: 0, total: repair ? 2 : STAGE_ORDER.length + 2, message: '' });
    this.installPromise = (repair ? this.repair(this.controller.signal) : this.install(this.controller.signal)).catch(error => {
      this.progress({ status: this.controller.signal.aborted ? 'cancelled' : 'error',
        message: this.controller.signal.aborted ? '安装已取消。已下载的组件会保留，稍后可以重试。' : error.message });
    });
    return this.snapshot();
  }
  async repair(signal) {
    const info = await this.runtime.detect();
    if (!info.detected) throw new Error('未找到 Hermes，请先自动安装');
    signal.throwIfAborted();
    this.stopDashboard();
    this.runtime.close();
    this.progress({ phase: '修复应用连接与管理组件' });
    await this.command(info.binary, ['pm', 'install', '--extra', 'acp', '--extra', 'web'], info.home, signal, 20 * 60 * 1000);
    signal.throwIfAborted();
    this.progress({ phase: '验证 Hermes 连接', completed: 1 });
    await this.runtime.connect({ home: info.home, binary: info.binary });
    signal.throwIfAborted();
    this.progress({ status: 'success', completed: 2, message: '连接组件已修复，Hermes 已连接。' });
  }
  async cancelInstall() {
    if (!running(this.state)) return this.snapshot();
    this.progress({ status: 'cancelling', message: '正在停止安装…' });
    this.controller.abort();
    await this.installPromise;
    return this.snapshot();
  }
  async install(signal) {
    const pendingFile = path.join(this.dataDir, 'installation-pending');
    const target = this.runtime.managedTarget();
    const { home, installDir: checkout, binary: installedBinary } = target;
    // Older installers could publish the base checkout on PATH. Only reuse the
    // release launcher owned by this Alex build, even when the base still works.
    if (!fs.existsSync(pendingFile) && fs.existsSync(installedBinary)) {
      const info = await this.runtime.detect({ home, binary: installedBinary });
      signal.throwIfAborted();
      if (!info.detected || !this.runtime.isAppManagedInstallation(info)) throw new Error('托管运行时的安装目录校验失败');
      this.verifySource(info.installDir);
      this.progress({ phase: '连接托管运行时' });
      await this.connectManaged(home, installedBinary, signal);
      this.progress({ status: 'success', completed: this.state.total, message: '已连接 Alex 托管运行时。' });
      return;
    }
    if (!['darwin', 'linux', 'win32'].includes(this.platform)) throw new Error('此系统暂不支持自动安装 Hermes');
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    // Resume only the app-owned installation, even if the interrupted products
    // stage already published a PATH launcher. Its profile must stay `home`.
    fs.writeFileSync(pendingFile, '', { mode: 0o600 });
    this.progress({ phase: '获取官方安装程序' });
    const windows = this.platform === 'win32';
    const source = `https://raw.githubusercontent.com/NousResearch/hermes-agent/${VERIFIED_HERMES_COMMIT}/scripts/install.${windows ? 'ps1' : 'sh'}`;
    const response = await this.fetchResource(source, { signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
    if (!response.ok) throw new Error('无法下载官方安装程序，请检查网络连接后重试');
    const script = await response.text();
    if (script.length > 2_000_000 || !script.includes('protocol_version')) throw new Error('官方安装程序格式不兼容，请更新 Alex');
    const scriptPath = path.join(this.dataDir, windows ? 'install.ps1' : 'install.sh');
    fs.writeFileSync(scriptPath, script, { mode: 0o600 });
    const binary = windows ? 'powershell.exe' : '/bin/bash';
    const base = windows
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-HermesHome', home, '-InstallDir', checkout, '-NonInteractive', '-Channel', 'stable', '-Commit', VERIFIED_HERMES_COMMIT]
      : [scriptPath, '--hermes-home', home, '--dir', checkout, '--non-interactive', '--channel', 'stable', '--commit', VERIFIED_HERMES_COMMIT];
    const manifest = await this.command(binary, [...base, windows ? '-Manifest' : '--manifest'], home, signal, 60000);
    const stages = parseManifest(manifest);
    for (const [i, stage] of stages.entries()) {
      signal.throwIfAborted();
      this.progress({ phase: INSTALL_STAGES[stage.name], completed: i });
      // Upstream's products stage also publishes to ~/.local/bin, edits shell
      // startup files or registers Windows User PATH. Alex only needs the web UI.
      if (stage.name === 'products') {
        await this.prepareManagedDashboard(target, signal);
        continue;
      }
      const result = await this.command(binary, [...base, windows ? '-Stage' : '--stage', stage.name, windows ? '-Json' : '--json'], home, signal, 30 * 60 * 1000);
      parseStageResult(result, stage.name);
      if (stage.name === 'repository') this.verifySource(checkout);
    }
    this.progress({ phase: '准备应用连接组件', completed: stages.length });
    await this.command(installedBinary, ['pm', 'install', '--extra', 'acp', '--extra', 'web'], home, signal, 20 * 60 * 1000);
    signal.throwIfAborted();
    this.progress({ phase: '验证 Hermes 连接', completed: stages.length + 1 });
    await this.connectManaged(home, installedBinary, signal);
    fs.unlinkSync(pendingFile);
    this.progress({ status: 'success', completed: this.state.total, message: 'Hermes 已安装并连接。接下来连接 AI 账号，然后选择模型。' });
  }
  verifySource(checkout) { verify(checkout); }
  async prepareManagedDashboard({ home, binary, installDir }, signal) {
    // The python-deps stage's PM publishes this checkout's own launcher.
    const launch = JSON.parse(await this.command(binary, ['--print-runtime-command'], home, signal, 30000));
    if (!Array.isArray(launch) || typeof launch[0] !== 'string' || !path.isAbsolute(launch[0]))
      throw new Error('托管启动器未提供 Python 运行路径');
    const build = [
      'import sys; from pathlib import Path',
      'root = Path(sys.argv[1]); sys.path.insert(0, str(root))',
      'import hermes_bootstrap; from pm.environments import activate_dependencies; activate_dependencies(root)',
      'from hermes_cli.main_web_build import _build_web_ui',
      'raise SystemExit(0 if _build_web_ui(root / "web", fatal=True) and (root / "hermes_cli/web_dist/index.html").is_file() else 1)',
    ].join('\n');
    await this.command(launch[0], ['-I', '-B', '-c', build, installDir], home, signal, 30 * 60 * 1000);
  }
  async connectManaged(home, binary, signal) {
    signal.throwIfAborted();
    this.assertNoChat();
    await this.runtime.connect({ home, binary }, { selectOnSuccess: true, signal });
    this.stopDashboard();
  }
  command(binary, args, home, signal, timeout) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const env = { ...this.runtime.envFor(home), HERMES_HOME: home, HERMES_REPO_URL: 'https://github.com/NousResearch/hermes-agent.git', PYTHONUNBUFFERED: '1' };
      const child = this.spawnProcess(binary, args, { cwd: this.dataDir, stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true, detached: this.platform !== 'win32',
        env });
      let output = '', timedOut = false;
      const stop = () => this.stopChild(child);
      const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
      signal.addEventListener('abort', stop, { once: true });
      const finish = (error) => {
        clearTimeout(timer); signal.removeEventListener('abort', stop);
        if (signal.aborted) reject(new Error('安装已取消'));
        else if (timedOut) reject(new Error(`${this.state.phase}超时，请检查网络后重试`));
        else if (error) reject(new Error(`${this.state.phase}失败，请检查网络、磁盘空间或系统组件后重试`));
        else resolve(output);
      };
      child.stdout.on('data', d => { output = (output + d.toString()).slice(-262144); });
      // Installer output can contain environment values. Never forward it to
      // renderer, persist it, or expose provider credentials in UI errors.
      child.stderr.on('data', () => {});
      child.once('error', finish);
      child.once('close', code => finish(code === 0 ? null : new Error('process failed')));
      if (signal.aborted) stop();
    });
  }
  stopChild(child) {
    if (!child.pid || child.exitCode !== null) return;
    if (this.platform === 'win32') {
      // Only the PID we spawned, never a name/home/global dashboard --stop.
      const killer = this.spawnProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      const timer = setTimeout(() => {
        if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      }, 5000);
      timer.unref();
    }
  }
  async deleteHistorySession(sessionId, identity) {
    await this.dashboardOrigin();
    const dashboard = this.dashboard;
    if (!dashboard?.token || dashboard.identity !== identity) throw new Error('无法核验当前 Hermes 环境，请重新连接后再删除');
    const url = new URL('/api/sessions/' + encodeURIComponent(sessionId), dashboard.origin);
    url.searchParams.set('profile', dashboard.profile);
    const options = {headers:{Authorization:`Bearer ${dashboard.token}`}, redirect:'error', signal:AbortSignal.timeout(45000)};
    const snapshotUrl = new URL(url);
    snapshotUrl.pathname += '/mutation-snapshot';
    const read = await this.fetchResource(snapshotUrl.href, options);
    if (!read.ok) throw new Error(`无法读取 Hermes 会话状态（${read.status}）`);
    const snapshot = await read.json();
    if (snapshot.session_id !== sessionId || typeof snapshot.exists !== 'boolean') throw new Error('Hermes 返回了其他会话的状态');
    if (!snapshot.exists) return;
    if (!Number.isSafeInteger(snapshot.runtime_revision) || !Number.isSafeInteger(snapshot.runtime_generation))
      throw new Error('Hermes 会话版本信息无效，无法删除');
    if (this.dashboard !== dashboard) throw new Error('Hermes 环境已切换，请重新打开会话列表');
    url.searchParams.set('request_id', randomUUID());
    url.searchParams.set('expected_revision', String(snapshot.runtime_revision));
    url.searchParams.set('expected_generation', String(snapshot.runtime_generation));
    const response = await this.fetchResource(url.href, {
      ...options, method:'DELETE',
    });
    if (!response.ok) throw new Error(`Hermes 未能删除会话（${response.status}），请稍后重试`);
    const result = await response.json();
    if (result.already_absent !== true && !(Array.isArray(result.deleted_ids) && result.deleted_ids.includes(sessionId)))
      throw new Error('Hermes 未确认删除所选会话，已保留本地记录');
  }
  async dashboardOrigin() {
    this.assertIdle();
    if (this.dashboardStarting) return this.dashboardStarting;
    this.dashboardStarting = this.startDashboard().finally(() => { this.dashboardStarting = null; });
    return this.dashboardStarting;
  }
  async managementUrl(section) {
    if (!Object.hasOwn(MANAGEMENT_ROUTES, section)) throw new Error('未知的 AI 管理页面');
    const origin = await this.dashboardOrigin();
    if (!this.dashboard || this.dashboard.origin !== origin) throw new Error('管理服务已停止，请重试');
    return dashboardUrl(origin, section, this.dashboard.profile);
  }
  async startDashboard() {
    const info = await this.runtime.detect();
    if (!info.detected) throw new Error('请先自动安装 Hermes，再打开管理页面');
    const identity = JSON.stringify([info.home, info.binary]);
    if (this.dashboard?.identity === identity && this.dashboard.child.exitCode === null && this.dashboard.origin)
      return this.dashboard.origin;
    this.stopDashboard();
    return new Promise((resolve, reject) => {
      // --isolated pins this HERMES_HOME. --port 0 avoids port guessing and
      // the READY sentinel belongs only to our own child process.
      const child = this.spawnProcess(info.binary, ['dashboard', '--host', '127.0.0.1', '--port', '0', '--isolated', '--no-open', '--skip-build'], {
        cwd: this.dataDir, stdio: ['ignore', 'pipe', 'pipe'], detached: this.platform !== 'win32', windowsHide: true,
        env: { ...this.runtime.envFor(info.home), HERMES_HOME: info.home, HERMES_PARENT_PID: String(process.pid), PYTHONUNBUFFERED: '1' },
      });
      const dashboard = { child, identity, origin: null };
      this.dashboard = dashboard;
      let settled = false, preparing = false, buffer = '';
      const fail = message => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (this.dashboard === dashboard) this.dashboard = null;
        this.stopChild(child); reject(new Error(message));
      };
      const timer = setTimeout(() => fail('管理页面准备超时，请检查网络后重试；首次启动可能需要下载界面组件。'), 5 * 60 * 1000);
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/); buffer = lines.pop().slice(-4096);
        for (const line of lines) {
          const match = /^HERMES_DASHBOARD_READY port=(\d+)$/.exec(line);
          if (!match || settled || preparing) continue;
          const port = Number(match[1]);
          if (port < 1 || port > 65535) return fail('Hermes 返回了无效的管理地址');
          preparing = true;
          const origin = `http://127.0.0.1:${port}`;
          // Read the profile and session token only from our own loopback child.
          // An explicit profile prevents the UI from adopting another home.
          void (async () => {
            const response = await this.fetchResource(`${origin}/env`, { redirect:'error', signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error('Hermes 管理页面尚未就绪，请重试');
            const html = await response.text();
            const profile = dashboardProfile(html);
            // This process-local token stays in Electron's main process.
            // Gated dashboards intentionally omit it; never bypass that gate.
            const token = /window\.__HERMES_SESSION_TOKEN__="([^"\r\n]+)";/.exec(html)?.[1];
            if (settled || this.dashboard !== dashboard || child.exitCode !== null) return;
            dashboard.profile = profile; dashboard.origin = origin; dashboard.token = token;
            settled = true; clearTimeout(timer); resolve(origin);
          })().catch(e => fail(e.message));
        }
      });
      child.stderr.on('data', () => {});
      child.once('error', () => fail('无法启动 Hermes 管理页面，请重新检测安装'));
      child.once('close', () => {
        if (this.dashboard === dashboard) this.dashboard = null;
        fail('Hermes 管理页面启动失败，请检查版本或重新安装管理组件');
        this.emit({ type: 'management-stopped' });
      });
    });
  }
  stopDashboard() {
    if (this.dashboard) this.stopChild(this.dashboard.child);
    this.dashboard = null;
  }
  close() {
    this.controller?.abort();
    this.stopDashboard();
  }
}
module.exports = { HermesManagement, MANAGEMENT_ROUTES, dashboardUrl, dashboardProfile, parseManifest, parseStageResult };
