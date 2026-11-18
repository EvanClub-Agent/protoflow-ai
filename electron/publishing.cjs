const fs = require('node:fs');
const path = require('node:path');
const { serviceOrigin } = require('./service-origin.json');

function isLocalNetwork(host) {
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  return parts.every(n => n <= 255) && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}
function origin(input) {
  const url = new URL(String(input ?? '').trim());
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalNetwork(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('发布服务地址必须是 HTTPS 地址，本机及内网 IP 允许 HTTP');
  return url.origin;
}
class PublishingClient {
  constructor({ dataDir, safeStorage, fetchImpl = fetch, serviceUrl = serviceOrigin }) {
    this.file = path.join(dataDir, 'publishing.json');
    this.configFile = path.join(dataDir, 'publishing-config.json');
    this.sessionFile = path.join(dataDir, 'publishing-session.json');
    this.safeStorage = safeStorage;
    this.fetch = fetchImpl;
    const rawDefault = typeof serviceUrl === 'string' ? serviceUrl.trim() : '';
    this.defaultServiceUrl = rawDefault ? origin(rawDefault) : '';
    if (rawDefault && this.defaultServiceUrl !== rawDefault) throw new Error('安装包的发布服务地址无效');
    this.generation = 0;
    this.accountOperation = Promise.resolve();
    this.diagnosticIdentity = { status: 'unknown' };
  }
  readConfiguredUrl() {
    if (!fs.existsSync(this.configFile)) return '';
    try {
      const saved = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      return typeof saved?.url === 'string' && saved.url.trim() ? origin(saved.url.trim()) : '';
    } catch {
      return '';
    }
  }
  writeConfiguredUrl(targetUrl) {
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    const tmp = this.configFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ url: targetUrl }), { mode: 0o600 });
    fs.renameSync(tmp, this.configFile);
  }
  get serviceUrl() {
    return this.readConfiguredUrl() || this.defaultServiceUrl;
  }
  async read() {
    const activeUrl = this.serviceUrl;
    if (!activeUrl || !fs.existsSync(this.file)) return null;
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    // Legacy credentials are bound to their original server. A distribution or
    // user-configured endpoint change must never decrypt or forward another server's token.
    const savedOrigin = origin(value.url);
    if (savedOrigin !== activeUrl) return null;
    const decrypted = await this.safeStorage.decryptStringAsync(Buffer.from(value.encryptedToken, 'base64'));
    return { url: activeUrl, token: decrypted.result };
  }
  signedOut(notice) {
    this.diagnosticIdentity = { status: 'signed-out' };
    return { url: this.serviceUrl, configured: false, user: null, legacy: null, ...(notice ? { notice } : {}) };
  }
  diagnosticAccount() { return { ...this.diagnosticIdentity }; }
  rememberAccount(user) {
    // Only called after a generation-checked response from auth/me or login.
    // publisherId identifies publication ownership, not the signed-in account.
    this.diagnosticIdentity = { status: 'signed-in', userId: user.id, username: user.username, displayName: user.displayName };
    return user;
  }
  checkGeneration(generation) { if (generation !== this.generation) throw new Error('发布账号已变化，请重新打开发布窗口'); }
  mutate(work) {
    const generation = ++this.generation;
    const result = this.accountOperation.catch(() => {}).then(() => { this.checkGeneration(generation); return work(generation); });
    this.accountOperation = result; return result;
  }
  async readSession() {
    const activeUrl = this.serviceUrl;
    if (!activeUrl || !fs.existsSync(this.sessionFile)) return null;
    const saved = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
    if (!saved?.url || origin(saved.url) !== activeUrl || saved.signedOut === true) return null;
    if (typeof saved.userId !== 'string' || !saved.userId || typeof saved.encryptedToken !== 'string') throw new Error('发布登录记录损坏，请退出后重新登录');
    const decrypted = await this.safeStorage.decryptStringAsync(Buffer.from(saved.encryptedToken, 'base64'));
    if (typeof decrypted.result !== 'string' || !/^pfu_[A-Za-z0-9]+$/.test(decrypted.result)) throw new Error('发布登录记录无效，请退出后重新登录');
    return { url: activeUrl, token: decrypted.result, userId: saved.userId, ignoreLegacy: saved.ignoreLegacy === true };
  }
  writeSession(value, generation, explicitUrl) {
    this.checkGeneration(generation);
    const activeUrl = explicitUrl !== undefined ? explicitUrl : this.serviceUrl;
    fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
    const tmp = this.sessionFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...value, ...(activeUrl ? { url: activeUrl } : {}) }), { mode: 0o600 });
    fs.renameSync(tmp, this.sessionFile);
    if (value.signedOut === true) this.diagnosticIdentity = { status: 'signed-out' };
  }
  async secureStorage() {
    if (!await this.safeStorage.isAsyncEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('系统安全存储不可用，无法保存发布登录状态');
  }
  async persistSession(session, generation) {
    await this.secureStorage();
    const encrypted = await this.safeStorage.encryptStringAsync(session.token);
    this.writeSession({ userId: session.userId, encryptedToken: encrypted.toString('base64'), ignoreLegacy: session.ignoreLegacy }, generation, session.url);
  }
  user(value, expectedId) {
    if (!value || typeof value.id !== 'string' || !value.id || typeof value.username !== 'string' || !value.username || typeof value.displayName !== 'string' || !value.displayName || (expectedId && value.id !== expectedId) || (value.publisherId !== undefined && (typeof value.publisherId !== 'string' || !value.publisherId))) throw new Error('发布服务返回了无效的账号信息');
    return { id: value.id, username: value.username, displayName: value.displayName, ...(value.publisherId ? { publisherId: value.publisherId } : {}) };
  }
  async inspectSession(session, generation) {
    const result = await this.call(session, '/api/v1/auth/me');
    this.checkGeneration(generation);
    const user = this.user(result.user, session.userId);
    this.rememberAccount(user);
    let legacy = null;
    if (!user.publisherId && !session.ignoreLegacy) {
      const previous = await this.read();
      if (previous && previous.url === session.url) {
        try {
          const publisher = await this.call(previous, '/api/v1/publisher');
          if (typeof publisher.publisherId !== 'string' || !publisher.publisherId || typeof publisher.name !== 'string') throw new Error('原发布身份信息无效');
          legacy = { publisherId: publisher.publisherId, name: publisher.name };
        } catch (error) { if (error.status !== 401) throw error; }
      }
    }
    this.checkGeneration(generation);
    return { url: session.url, configured: legacy === null, user, legacy };
  }
  async accountSettings() {
    const generation = this.generation;
    const session = await this.readSession(); this.checkGeneration(generation);
    if (!session) return this.signedOut();
    try {
      const result = await this.call(session, '/api/v1/auth/me'); this.checkGeneration(generation);
      return { url: session.url, configured: true, user: this.rememberAccount(this.user(result.user, session.userId)), legacy: null };
    } catch (error) {
      this.checkGeneration(generation);
      if (error.status !== 401) throw error;
      this.writeSession({ signedOut: true }, generation, session.url);
      return this.signedOut('登录已失效，请重新登录账号');
    }
  }
  async settings() {
    const generation = this.generation;
    const session = await this.readSession(); this.checkGeneration(generation);
    if (!session) return this.signedOut();
    try { return await this.inspectSession(session, generation); }
    catch (error) {
      this.checkGeneration(generation);
      if (error.status !== 401) throw error;
      this.writeSession({ signedOut: true }, generation, session.url);
      return this.signedOut('登录已失效，请重新登录账号');
    }
  }
  authenticate(input) {
    this.diagnosticIdentity = { status: 'unknown' };
    return this.mutate(async generation => {
      if (!input || !['login', 'register'].includes(input.mode) || typeof input.username !== 'string' || typeof input.password !== 'string') throw new Error('请输入用户名与密码');
      const requestedUrl = typeof input.url === 'string' && input.url.trim() ? input.url.trim() : this.serviceUrl;
      if (!requestedUrl) throw new Error('请先填写自建发布服务地址');
      const targetUrl = origin(requestedUrl);
      await this.secureStorage(); this.checkGeneration(generation);
      const result = await this.call({ url: targetUrl }, '/api/v1/auth/' + input.mode, 'POST', { username: input.username, password: input.password });
      this.checkGeneration(generation);
      const user = this.user(result.user);
      if (typeof result.token !== 'string' || !/^pfu_[A-Za-z0-9]+$/.test(result.token)) throw new Error('账号服务返回的登录信息无效');
      this.writeConfiguredUrl(targetUrl);
      await this.persistSession({ url: targetUrl, token: result.token, userId: user.id, ignoreLegacy: false }, generation);
      this.checkGeneration(generation);
      this.rememberAccount(user);
      return this.accountSettings();
    });
  }
  logout() {
    this.diagnosticIdentity = { status: 'unknown' };
    return this.mutate(async generation => {
      // Local sign-out always succeeds, even if the server cannot be reached.
      let session;
      try { session = await this.readSession(); } catch { session = null; }
      this.writeSession({ signedOut: true }, generation);
      if (session) {
        try { await this.call(session, '/api/v1/auth/logout', 'POST', {}); }
        catch { return this.signedOut('已退出本机账号；服务器暂不可达，远端会话未确认注销。'); }
      }
      return this.signedOut();
    });
  }
  legacyChoice(input) {
    return this.mutate(async generation => {
      if (!input || !['link', 'skip'].includes(input.action)) throw new Error('请选择已有分享的处理方式');
      const session = await this.readSession(); this.checkGeneration(generation);
      if (!session) throw new Error('请先登录账号');
      if (input.action === 'link') {
        const previous = await this.read(); this.checkGeneration(generation);
        if (!previous) throw new Error('本机没有可关联的原发布身份');
        await this.call(session, '/api/v1/auth/publisher', 'POST', { legacyToken: previous.token });
      }
      await this.persistSession({ ...session, ignoreLegacy: true }, generation);
      return this.settings();
    });
  }
  async call(connection, route, method = 'GET', data) {
    const body = data === undefined ? undefined : JSON.stringify(data);
    if (body && Buffer.byteLength(body) > 20 * 1024 * 1024) throw new Error('发布内容超过 20 MB 限制');
    const response = await this.fetch(connection.url + route, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(typeof result?.error === 'string' ? result.error.slice(0, 300) : `发布请求失败 (${response.status})`), { status: response.status });
    if (!result) throw new Error('发布服务返回内容无效'); return result;
  }
  async request(input) {
    const generation = this.generation;
    const connection = await this.readSession(); this.checkGeneration(generation);
    if (!connection) throw Object.assign(new Error('请先登录账号后再发布'), { status: 401 });
    const state = await this.inspectSession(connection, generation);
    if (!state.configured) throw new Error('请先选择是否关联本机已有分享');
    const send = async (...args) => {
      try { const result = await this.call(connection, ...args); this.checkGeneration(generation); return result; }
      catch (error) { this.checkGeneration(generation); throw error; }
    };
    const base = '/api/v1/publications';
    if (input.action === 'list') {
      if (typeof input.projectId !== 'string' || !input.projectId) throw new Error('项目 ID 无效');
      return send(`${base}?projectId=${encodeURIComponent(input.projectId)}`);
    }
    if (input.action === 'create') return send(base, 'POST', input.input);
    if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(input.id)) throw new Error('发布 ID 无效');
    if (input.action === 'update') return send(`${base}/${input.id}`, 'PUT', input.input);
    if (input.action === 'revoke' && Number.isInteger(input.expectedVersion) && input.expectedVersion > 0) return send(`${base}/${input.id}/revoke`, 'POST', { expectedVersion: input.expectedVersion });
    throw new Error('不支持的发布操作');
  }
}
module.exports = { PublishingClient, origin };
