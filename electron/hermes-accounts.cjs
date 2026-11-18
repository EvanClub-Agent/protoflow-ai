// Official Hermes /api/providers/oauth and /api/env contracts. Provider IDs,
// credential keys and profile identities always come from Hermes metadata.
class HermesAccounts {
  constructor({ management, openExternal }) {
    this.management = management;
    this.openExternal = openExternal;
    this.sessions = new Map();
  }
  async context() {
    await this.management.dashboardOrigin();
    const dashboard = this.management.dashboard;
    if (!dashboard?.token) throw new Error('此 Hermes 环境启用了额外访问授权，请在完整管理页中完成登录');
    return dashboard;
  }
  async request(context, route, method = 'GET', body) {
    if (this.management.dashboard !== context || context.child.exitCode !== null)
      throw new Error('Hermes 环境已变化，请重新打开账号设置');
    const url = new URL(route, context.origin);
    url.searchParams.set('profile', context.profile);
    const response = await this.management.fetchResource(url.href, {
      method, headers: { Authorization: `Bearer ${context.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000), redirect: 'error',
    });
    // Error bodies and provider responses can contain credentials. Expose
    // explicit status only; never echo them to renderer or main-process logs.
    if (!response.ok) throw new Error(`Hermes 账号操作未完成（${response.status}），请检查信息后重试`);
    return response.json();
  }
  async catalog(context) {
    const [oauth, env] = await Promise.all([
      this.request(context, '/api/providers/oauth'), this.request(context, '/api/env'),
    ]);
    if (!Array.isArray(oauth.providers) || !env || typeof env !== 'object') throw new Error('Hermes 账号目录格式不兼容，请更新 Hermes');
    const providers = oauth.providers.map(p => {
      if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || typeof p.status?.logged_in !== 'boolean' || !['device_code', 'pkce', 'external'].includes(p.flow))
        throw new Error('Hermes 账号目录缺少有效标识');
      return { id: p.id, name: p.name, flow: p.flow, connected: p.status.logged_in };
    });
    const keys = Object.entries(env).filter(([, e]) => e.category === 'provider' && e.provider_primary === true && e.is_password === true).map(([key, e]) => {
      if (typeof e.provider !== 'string' || !e.provider || typeof e.provider_label !== 'string' || !e.provider_label || typeof e.is_set !== 'boolean')
        throw new Error('Hermes 密钥目录缺少提供方信息');
      return { key, provider: e.provider, name: e.provider_label, configured: e.is_set };
    });
    return { providers, keys };
  }
  async list() { return this.catalog(await this.context()); }
  async saveKey({ key, value }) {
    this.management.assertNoChat();
    const context = await this.context(), catalog = await this.catalog(context);
    if (!catalog.keys.some(k => k.key === key)) throw new Error('请选择 Hermes 提供的密钥类型');
    if (typeof value !== 'string' || !value.trim() || value.length > 32768 || /[\r\n]/.test(value)) throw new Error('请输入有效的 API 密钥');
    const result = await this.request(context, '/api/env', 'PUT', { key, value: value.trim(), provider_setup: true });
    if (result.ok !== true) throw new Error('Hermes 未确认密钥保存成功');
    return { saved: true };
  }
  async removeKey({ key }) {
    this.management.assertNoChat();
    const context = await this.context(), catalog = await this.catalog(context);
    if (!catalog.keys.some(k => k.key === key)) throw new Error('未知的 Hermes 密钥类型');
    const result = await this.request(context, '/api/env', 'DELETE', { key });
    if (result.ok !== true) throw new Error('Hermes 未确认密钥已移除');
    return { removed: true };
  }
  async start({ providerId }) {
    this.management.assertNoChat();
    const context = await this.context(), catalog = await this.catalog(context);
    const provider = catalog.providers.find(p => p.id === providerId);
    if (!provider || provider.flow === 'external') throw new Error('此登录方式暂不支持应用内授权，可使用该服务的 API 密钥');
    const result = await this.request(context, `/api/providers/oauth/${encodeURIComponent(providerId)}/start`, 'POST', {});
    if (typeof result.session_id !== 'string' || !result.session_id || !['device_code', 'pkce'].includes(result.flow) || typeof result.expires_in !== 'number')
      throw new Error('Hermes 返回了无效的登录会话');
    const url = result.flow === 'pkce' ? result.auth_url : result.verification_url;
    if (typeof url !== 'string' || new URL(url).protocol !== 'https:') throw new Error('Hermes 返回了不安全的授权地址');
    if (result.flow === 'device_code' && typeof result.user_code !== 'string') throw new Error('Hermes 未返回登录验证码');
    this.sessions.set(result.session_id, { context, providerId, url });
    return { sessionId: result.session_id, flow: result.flow, userCode: result.flow === 'device_code' ? result.user_code : null, expiresIn: result.expires_in };
  }
  owned(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error('登录会话已结束，请重新登录');
    return entry;
  }
  async openLogin({ sessionId }) { await this.openExternal(this.owned(sessionId).url); }
  async poll({ sessionId }) {
    const { context, providerId } = this.owned(sessionId);
    const result = await this.request(context, `/api/providers/oauth/${encodeURIComponent(providerId)}/poll/${encodeURIComponent(sessionId)}?wait=25`);
    if (result.session_id !== sessionId || !['pending', 'approved', 'denied', 'expired', 'error'].includes(result.status)) throw new Error('Hermes 登录状态不匹配');
    if (result.status !== 'pending') this.sessions.delete(sessionId);
    return { status: result.status };
  }
  async submit({ sessionId, code }) {
    const { context, providerId } = this.owned(sessionId);
    if (typeof code !== 'string' || !code.trim()) throw new Error('请粘贴授权页面返回的验证码');
    const result = await this.request(context, `/api/providers/oauth/${encodeURIComponent(providerId)}/submit`, 'POST', { session_id: sessionId, code: code.trim() });
    if (result.ok !== true || result.status !== 'approved') throw new Error('授权未完成，请重新获取验证码');
    this.sessions.delete(sessionId);
    return { status: 'approved' };
  }
  async cancel({ sessionId }) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    await this.request(entry.context, `/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`, 'DELETE');
  }
  async disconnect({ providerId }) {
    this.management.assertNoChat();
    const context = await this.context(), catalog = await this.catalog(context);
    const provider = catalog.providers.find(p => p.id === providerId);
    if (!provider || provider.flow === 'external') throw new Error('此账号由外部应用管理');
    const result = await this.request(context, `/api/providers/oauth/${encodeURIComponent(providerId)}`, 'DELETE');
    if (result.ok !== true) throw new Error('Hermes 未确认账号已退出');
    return { disconnected: true };
  }
}
module.exports = { HermesAccounts };
