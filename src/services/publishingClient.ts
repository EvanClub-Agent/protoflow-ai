import type { PublishedSnapshot } from './publishedSnapshot';
import { serviceOrigin } from '../../electron/service-origin.json';
import { getAcceptLanguageHeader, td, tr } from '../i18n/runtime';

export interface Publication {
  id: string; projectId: string; title: string; version: number;
  passwordProtected: boolean; expiresAt: string | null; revokedAt: string | null;
  createdAt: string; updatedAt: string; shareUrl: string;
}
export interface PublishInput {
  snapshot: PublishedSnapshot;
  access: { passwordAction: 'keep' | 'set' | 'remove'; password: string; expiresAt: string | null };
  expectedVersion?: number;
}
export interface PublishingUser { id: string; username: string; displayName: string; publisherId?: string }
export interface PublishSettings { url: string; configured: boolean; user: PublishingUser | null; legacy: { publisherId: string; name: string } | null; notice?: string }
export interface PublishingLogin { mode: 'login' | 'register'; username: string; password: string; url?: string }
export type PublishRequest =
  | { action: 'list'; projectId: string }
  | { action: 'create'; input: PublishInput }
  | { action: 'update'; id: string; input: PublishInput }
  | { action: 'revoke'; id: string; expectedVersion: number };
export interface PublishingDesktopApi {
  settings: () => Promise<PublishSettings>;
  accountSettings: () => Promise<PublishSettings>;
  authenticate: (input: PublishingLogin) => Promise<PublishSettings>;
  logout: () => Promise<PublishSettings>;
  legacyChoice: (input: { action: 'link' | 'skip' }) => Promise<PublishSettings>;
  request: (input: PublishRequest) => Promise<unknown>;
}

const BROWSER_SERVER_URL_KEY = 'protoflow_publishing_server_url';
let browserConnection: { url: string; token: string; userId: string } | null = null;
let browserGeneration = 0;

function isLocalNetwork(host: string) {
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  return parts.every(n => n <= 255) && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}
export function publishingOrigin(input: string): string {
  const u = new URL(input.trim());
  if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalNetwork(u.hostname))) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error(tr('发布服务地址必须是 HTTPS 地址（本机 localhost 及内网 IP 允许 HTTP）', 'Publishing server URL must use HTTPS (HTTP is allowed only for localhost and private LAN IPs)'));
  return u.origin;
}
function readBrowserServerUrl(): string {
  if (browserConnection?.url) return browserConnection.url;
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(BROWSER_SERVER_URL_KEY) : null;
    if (saved && saved.trim()) return publishingOrigin(saved.trim());
  } catch { /* ignore storage/invalid URL */ }
  const bundled = typeof serviceOrigin === 'string' ? serviceOrigin.trim() : '';
  return bundled ? publishingOrigin(bundled) : '';
}
function saveBrowserServerUrl(url: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(BROWSER_SERVER_URL_KEY, url);
  } catch { /* ignore */ }
}

export const signedOutPublishing = (): PublishSettings => ({ url: readBrowserServerUrl(), configured: false, user: null, legacy: null });
function checkBrowserGeneration(generation: number) { if (generation !== browserGeneration) throw new Error(tr('发布账号已变化，请重新打开发布窗口', 'Publishing account changed. Please reopen the publish dialog.')); }
function publishingUser(user: any, expectedId?: string): PublishingUser {
  if (!user || typeof user.id !== 'string' || !user.id || typeof user.username !== 'string' || !user.username || typeof user.displayName !== 'string' || !user.displayName || (expectedId && user.id !== expectedId) || (user.publisherId !== undefined && (typeof user.publisherId !== 'string' || !user.publisherId))) throw new Error(tr('发布账号信息无效', 'Invalid publishing account information'));
  return { id: user.id, username: user.username, displayName: user.displayName, ...(user.publisherId ? { publisherId: user.publisherId } : {}) };
}
type PublishingReply<T> = { ok: true; value: T } | { ok: false; error: { message: string; status?: number } };
type PublishingBridge = { [K in keyof PublishingDesktopApi]: (...args: Parameters<PublishingDesktopApi[K]>) => Promise<PublishingReply<Awaited<ReturnType<PublishingDesktopApi[K]>>>> };
async function unwrap<T>(reply: Promise<PublishingReply<T>>): Promise<T> {
  const result = await reply;
  if (!result.ok) throw Object.assign(new Error(td(result.error.message)), { status: result.error.status });
  return result.value;
}
function desktop(): PublishingDesktopApi | undefined {
  const bridge = (window as unknown as { protoflowDesktop?: { publishing?: PublishingBridge } }).protoflowDesktop?.publishing;
  if (!bridge) return undefined;
  const localizeNotice = (s: PublishSettings): PublishSettings => s.notice ? { ...s, notice: td(s.notice) } : s;
  return {
    settings: () => unwrap(bridge.settings()).then(localizeNotice),
    accountSettings: () => unwrap(bridge.accountSettings()).then(localizeNotice),
    authenticate: input => unwrap(bridge.authenticate(input)).then(localizeNotice),
    logout: () => unwrap(bridge.logout()).then(localizeNotice),
    legacyChoice: input => unwrap(bridge.legacyChoice(input)).then(localizeNotice),
    request: input => unwrap(bridge.request(input)),
  };
}
export async function accountSettings(): Promise<PublishSettings> {
  if (desktop()) return desktop()!.accountSettings();
  return publishingSettings();
}
export async function publishingSettings(): Promise<PublishSettings> {
  if (desktop()) return desktop()!.settings();
  if (!browserConnection) return signedOutPublishing();
  const connection = browserConnection, generation = browserGeneration;
  try {
    const data = await http(connection.url, connection.token, '/api/v1/auth/me');
    checkBrowserGeneration(generation);
    return { url: connection.url, configured: true, user: publishingUser(data.user, connection.userId), legacy: null };
  } catch (error) {
    checkBrowserGeneration(generation);
    if ((error as { status?: number }).status !== 401) throw error;
    browserConnection = null;
    return { ...signedOutPublishing(), notice: tr('登录已失效，请重新登录账号', 'Session expired. Please sign in again.') };
  }
}
async function http(url: string, token: string, route: string, method = 'GET', body?: unknown) {
  const response = await fetch(url + route, { method, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000), headers: { 'Accept-Language': getAcceptLanguageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? td(data.error) : tr(`发布服务返回错误 (${response.status})`, `Publishing service error (${response.status})`)), { status: response.status });
  if (data === null) throw new Error(tr('发布服务返回内容无效', 'Publishing service returned an invalid response'));
  return data;
}
export async function authenticatePublishing(input: PublishingLogin): Promise<PublishSettings> {
  if (!input || !['login', 'register'].includes(input.mode) || typeof input.username !== 'string' || typeof input.password !== 'string') throw new Error(tr('请输入用户名与密码', 'Please enter username and password'));
  if (desktop()) return desktop()!.authenticate(input);
  const rawUrl = typeof input.url === 'string' && input.url.trim() ? input.url.trim() : readBrowserServerUrl();
  if (!rawUrl) throw new Error(tr('请先填写自建发布服务地址', 'Please enter the self-hosted publishing server URL first'));
  const url = publishingOrigin(rawUrl);
  const generation = ++browserGeneration;
  const result = await http(url, '', '/api/v1/auth/' + input.mode, 'POST', { username: input.username, password: input.password });
  checkBrowserGeneration(generation);
  const user = publishingUser(result.user);
  if (typeof result.token !== 'string' || !/^pfu_[A-Za-z0-9]+$/.test(result.token)) throw new Error(tr('登录信息无效', 'Invalid sign-in response'));
  saveBrowserServerUrl(url);
  // Browser development keeps the session in memory; desktop uses OS encryption.
  browserConnection = { url, token: result.token, userId: user.id };
  return { url, configured: true, user, legacy: null };
}
export async function logoutPublishing(): Promise<PublishSettings> {
  if (desktop()) return desktop()!.logout();
  const connection = browserConnection; browserGeneration++; browserConnection = null;
  if (connection) {
    try { await http(connection.url, connection.token, '/api/v1/auth/logout', 'POST', {}); }
    catch { return { ...signedOutPublishing(), notice: tr('已退出本机账号；远端会话未确认注销。', 'Signed out locally; remote session revocation could not be confirmed.') }; }
  }
  return signedOutPublishing();
}
export async function chooseLegacyPublishing(action: 'link' | 'skip'): Promise<PublishSettings> {
  if (!desktop()) throw new Error(tr('请在原桌面客户端关联已有分享', 'Please link existing shares in the desktop app'));
  return desktop()!.legacyChoice({ action });
}
async function request(input: PublishRequest): Promise<any> {
  if (desktop()) return desktop()!.request(input);
  if (!browserConnection) throw Object.assign(new Error(tr('请先登录账号后再发布', 'Please sign in before publishing')), { status: 401 });
  const { url, token } = browserConnection, generation = browserGeneration;
  let result: unknown;
  try {
    switch (input.action) {
      case 'list': result = await http(url, token, `/api/v1/publications?projectId=${encodeURIComponent(input.projectId)}`); break;
      case 'create': result = await http(url, token, '/api/v1/publications', 'POST', input.input); break;
      case 'update': result = await http(url, token, `/api/v1/publications/${encodeURIComponent(input.id)}`, 'PUT', input.input); break;
      case 'revoke': result = await http(url, token, `/api/v1/publications/${encodeURIComponent(input.id)}/revoke`, 'POST', { expectedVersion: input.expectedVersion }); break;
    }
    checkBrowserGeneration(generation); return result;
  } catch (error) { checkBrowserGeneration(generation); throw error; }
}
function validatePublication(value: any, projectId: string): Publication {
  if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(value.id) || value.projectId !== projectId || !Number.isInteger(value.version) || value.version < 1 || typeof value.title !== 'string' || typeof value.passwordProtected !== 'boolean' || typeof value.shareUrl !== 'string') throw new Error(tr('发布服务返回了无效或不属于当前项目的发布记录', 'Publishing service returned an invalid publication or one belonging to another project'));
  const url = new URL(value.shareUrl);
  publishingOrigin(url.origin);
  if (url.pathname !== `/p/${value.id}` || url.search || url.hash) throw new Error(tr('发布服务返回的分享链接无效', 'Publishing service returned an invalid share URL'));
  for (const key of ['createdAt','updatedAt','expiresAt','revokedAt']) {
    if (value[key] === null && (key === 'expiresAt' || key === 'revokedAt')) continue;
    if (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key]))) throw new Error(tr('发布记录时间无效', 'Invalid publication timestamp'));
  }
  return value;
}
export async function listPublications(projectId: string): Promise<Publication[]> {
  const result = await request({ action: 'list', projectId });
  if (!Array.isArray(result.items)) throw new Error(tr('发布记录列表无效', 'Invalid publication list'));
  return result.items.map((value: unknown) => validatePublication(value, projectId));
}
export async function savePublication(input: PublishInput, existing?: Publication): Promise<Publication> {
  if (existing && existing.projectId !== input.snapshot.projectId) throw new Error(tr('发布记录不属于当前项目', 'Publication does not belong to the current project'));
  const value = await request(existing ? { action: 'update', id: existing.id, input: { ...input, expectedVersion: existing.version } } : { action: 'create', input });
  return validatePublication(value, input.snapshot.projectId);
}
export async function revokePublication(existing: Publication): Promise<Publication> {
  return validatePublication(await request({ action: 'revoke', id: existing.id, expectedVersion: existing.version }), existing.projectId);
}
