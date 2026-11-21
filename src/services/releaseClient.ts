import { publishingOrigin } from './publishingClient';
import type { DiagnosticReport } from './runtimeDiagnostics';
import { getAcceptLanguageHeader, td, tr } from '../i18n/runtime';

export type StoredDiagnostic = DiagnosticReport & {installationId:string;receivedAt:string};
export function fetchRuntimeDiagnostics(token:string, query:{id:string;category:string;version:string;offset:number;account?:string;device?:string;runId?:string}, signal?:AbortSignal) {
  const params = new URLSearchParams({...query,offset:String(query.offset)});
  return apiJson<{items:StoredDiagnostic[]}>(`/api/v1/admin/diagnostics?${params}`,{token,signal});
}

export type ReleaseOS = 'windows' | 'macos' | 'linux';
export type ReleaseArch = 'x64' | 'arm64' | 'universal';
export type ReleasePackageType = 'exe' | 'dmg' | 'zip' | 'deb' | 'AppImage' | 'tar.gz';
export type ReleaseChannel = 'stable' | 'beta';

export interface DesktopReleaseAsset {
  id: string;
  releaseId: string;
  os: ReleaseOS;
  arch: ReleaseArch;
  packageType: ReleasePackageType;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  externalUrl?: string;
  hosted: boolean;
  downloadUrl: string;
  channel?: ReleaseChannel;
  mandatory?: boolean;
  approved?: boolean;
  approvedByAdminId?: string;
  approvedAt?: string;
  signature?: string;
  signingPublicKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformAdmin {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientUser {
  id: string;
  username: string;
  displayName: string;
  publisherId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopRelease {
  id: string;
  version: string;
  title: string;
  notes: string;
  channel: ReleaseChannel;
  mandatory: boolean;
  published: boolean;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  assets: DesktopReleaseAsset[];
}

export interface ReleaseInput {
  version: string;
  title: string;
  notes: string;
  channel: ReleaseChannel;
  mandatory: boolean;
  published: boolean;
}

export interface AssetLinkInput {
  os: ReleaseOS;
  arch: ReleaseArch;
  packageType: ReleasePackageType;
  fileName: string;
  externalUrl: string;
  sizeBytes: number;
  sha256: string;
}

export interface UpdateDownloadProgress {
  assetId: string;
  fileName: string;
  transferredBytes: number;
  totalBytes: number;
  percent: number;
  speedBytesPerSec: number;
}

export interface InstallGuideInfo {
  action: string;
  platform: ReleaseOS;
  packageType: string;
  filePath: string;
  title: string;
  steps: string[];
  command?: string;
}

export interface DesktopUpdaterState {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'installing' | 'error';
  currentVersion: string;
  os: ReleaseOS;
  arch: ReleaseArch;
  preferPackage: ReleasePackageType | '';
  isDebian: boolean;
  appImagePath: string | null;
  serverUrl: string;
  channel: ReleaseChannel;
  skippedVersion: string;
  signingPublicKey?: string;
  hasUpdate: boolean;
  latestRelease: DesktopRelease | null;
  recommendedAsset: DesktopReleaseAsset | null;
  platformAssets: DesktopReleaseAsset[];
  progress: UpdateDownloadProgress | null;
  downloadedAssetId: string | null;
  downloadedFilePath: string | null;
  verifiedSha256: string | null;
  lastCheckedAt: string | null;
  error: string | null;
  installGuide: InstallGuideInfo | null;
  configEpoch?: number;
}

export interface UpdaterDesktopBridge {
  state: () => Promise<DesktopUpdaterState>;
  check: (input?: { silent?: boolean }) => Promise<DesktopUpdaterState>;
  download: (input?: { assetId?: string }) => Promise<DesktopUpdaterState>;
  cancel: () => Promise<DesktopUpdaterState>;
  apply: (input?: { expectedAssetId: string; expectedConfigEpoch?: number }) => Promise<InstallGuideInfo>;
  reveal: () => Promise<{ revealed: boolean; filePath: string }>;
  openWeb: () => Promise<void>;
  onEvent: (listener: (state: DesktopUpdaterState) => void) => () => void;
}

export function getUpdaterDesktopBridge(): UpdaterDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { protoflowDesktop?: { updater?: UpdaterDesktopBridge } }).protoflowDesktop?.updater;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : idx === 1 ? 1 : 2)} ${units[idx]}`;
}

export function inferAssetTargetFromFileName(fileName: string): {
  os: ReleaseOS;
  arch: ReleaseArch;
  packageType: ReleasePackageType;
} | null {
  const lower = fileName.trim().toLowerCase();
  if (!lower) return null;

  let pkg: ReleasePackageType | null = null;
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) pkg = 'tar.gz';
  else if (lower.endsWith('.appimage')) pkg = 'AppImage';
  else if (lower.endsWith('.deb')) pkg = 'deb';
  else if (lower.endsWith('.dmg')) pkg = 'dmg';
  else if (lower.endsWith('.exe')) pkg = 'exe';
  else if (lower.endsWith('.zip')) pkg = 'zip';
  if (!pkg) return null;

  let os: ReleaseOS;
  if (pkg === 'exe') os = 'windows';
  else if (pkg === 'dmg') os = 'macos';
  else if (pkg === 'deb' || pkg === 'AppImage' || pkg === 'tar.gz') os = 'linux';
  else {
    if (lower.includes('win')) os = 'windows';
    else if (lower.includes('linux')) os = 'linux';
    else os = 'macos';
  }

  let arch: ReleaseArch = os === 'macos' ? 'arm64' : 'x64';
  if (lower.includes('universal')) arch = 'universal';
  else if (lower.includes('arm64') || lower.includes('aarch64')) arch = 'arm64';
  else if (lower.includes('x64') || lower.includes('amd64') || lower.includes('x86_64')) arch = 'x64';

  return { os, arch, packageType: pkg };
}

export function detectBrowserPlatform(): { os: ReleaseOS; arch: ReleaseArch; label: string } {
  if (typeof navigator === 'undefined') {
    return { os: 'macos', arch: 'arm64', label: 'macOS' };
  }
  const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`.toLowerCase();
  if (ua.includes('win')) {
    const arch: ReleaseArch = ua.includes('arm') ? 'arm64' : 'x64';
    return { os: 'windows', arch, label: 'Windows' };
  }
  if (ua.includes('linux')) {
    const arch: ReleaseArch = ua.includes('arm') || ua.includes('aarch64') ? 'arm64' : 'x64';
    return { os: 'linux', arch, label: 'Linux' };
  }
  const arch: ReleaseArch = ua.includes('intel') ? 'x64' : 'arm64';
  return { os: 'macos', arch, label: 'macOS' };
}

export const PLATFORM_LABELS: Record<ReleaseOS, {
  name: string;
  shortName: string;
  badge: string;
  packages: ReleasePackageType[];
  packageLabels: Partial<Record<ReleasePackageType, string>>;
  installSummary: string;
}> = {
  windows: {
    get name() { return tr('Windows 桌面端', 'Windows Desktop'); },
    shortName: 'Windows',
    badge: 'Windows 10 / 11 (64-bit)',
    packages: ['exe', 'zip'],
    get packageLabels(): Partial<Record<ReleasePackageType, string>> {
      return {
        exe: tr('NSIS 安装向导 (.exe)', 'NSIS Installer (.exe)'),
        zip: tr('免安装压缩包 (.zip)', 'Portable Archive (.zip)'),
      };
    },
    get installSummary() {
      return tr(
        '下载 .exe 安装程序后一键启动 NSIS 向导，支持自定义安装目录与原位覆盖升级，自动保留本地工程数据。',
        'Run the .exe installer to launch the NSIS wizard with custom directory and in-place upgrade support while preserving local project data.',
      );
    },
  },
  macos: {
    get name() { return tr('macOS 桌面端', 'macOS Desktop'); },
    shortName: 'macOS',
    get badge() { return tr('Apple Silicon (M系列) / Intel', 'Apple Silicon (M-series) / Intel'); },
    packages: ['dmg', 'zip'],
    get packageLabels(): Partial<Record<ReleasePackageType, string>> {
      return {
        dmg: tr('磁盘映像安装器 (.dmg)', 'Disk Image Installer (.dmg)'),
        zip: tr('应用归档压缩包 (.zip)', 'App Archive (.zip)'),
      };
    },
    get installSummary() {
      return tr(
        '下载并挂载 .dmg 镜像后，将 Alex 拖入 Applications 文件夹替换旧版即可完成升级。',
        'Download and mount the .dmg image, then drag Alex into Applications to install or upgrade.',
      );
    },
  },
  linux: {
    get name() { return tr('Linux 桌面端', 'Linux Desktop'); },
    shortName: 'Linux',
    badge: 'Debian / Ubuntu / AppImage',
    packages: ['deb', 'AppImage', 'tar.gz'],
    get packageLabels(): Partial<Record<ReleasePackageType, string>> {
      return {
        deb: tr('Debian / Ubuntu 软件包 (.deb)', 'Debian / Ubuntu Package (.deb)'),
        AppImage: tr('便携式单文件 (.AppImage)', 'Portable Single-File (.AppImage)'),
        'tar.gz': tr('通用二进制归档 (.tar.gz)', 'Generic Binary Archive (.tar.gz)'),
      };
    },
    get installSummary() {
      return tr(
        'Debian/Ubuntu 推荐使用 sudo apt install ./Alex-*.deb 自动配置系统依赖与图标；其他发行版可直接运行 .AppImage。',
        'On Debian/Ubuntu, run sudo apt install ./Alex-*.deb to configure system dependencies and icons; on other distributions, run the .AppImage directly.',
      );
    },
  },
};

function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl || !baseUrl.trim()) return '';
  return publishingOrigin(baseUrl.trim());
}

async function apiJson<T>(
  route: string,
  options: { method?: string; token?: string; body?: unknown; baseUrl?: string; signal?: AbortSignal } = {}
): Promise<T> {
  const base = normalizeBaseUrl(options.baseUrl);
  const headers: Record<string, string> = {
    'Accept-Language': getAcceptLanguageHeader(),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${base}${route}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
    credentials: 'omit',
    signal: options.signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? td(data.error) : tr(`请求版本服务失败 (${response.status})`, `Release service request failed (${response.status})`));
  }
  if (!data) {
    throw new Error(tr('版本服务返回了空响应', 'Release service returned an empty response'));
  }
  return data as T;
}

export async function fetchPublicReleases(
  baseUrl = '',
  channel = 'all'
): Promise<{ signingPublicKey?: string; latest: DesktopRelease | null; items: DesktopRelease[] }> {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  return apiJson<{ signingPublicKey?: string; latest: DesktopRelease | null; items: DesktopRelease[] }>(
    `/api/v1/updates${query}`,
    { baseUrl }
  );
}

export async function checkPublicUpdate(params: {
  baseUrl?: string;
  currentVersion: string;
  os: ReleaseOS;
  arch: ReleaseArch;
  channel?: ReleaseChannel;
  preferPackage?: string;
  signal?: AbortSignal;
}) {
  const q = new URLSearchParams({
    currentVersion: params.currentVersion,
    os: params.os,
    arch: params.arch,
    channel: params.channel ?? 'stable',
    ...(params.preferPackage ? { preferPackage: params.preferPackage } : {}),
  });
  return apiJson<{
    signingPublicKey?: string;
    currentVersion: string;
    hasUpdate: boolean;
    latestRelease: DesktopRelease | null;
    recommendedAsset: DesktopReleaseAsset | null;
    platformAssets: DesktopReleaseAsset[];
  }>(`/api/v1/updates/check?${q.toString()}`, { baseUrl: params.baseUrl, signal: params.signal });
}

// ============================================================================
// Client User Auth (/api/v1/auth/*)
// ============================================================================

export async function registerClientUser(
  input: { username: string; displayName?: string; password: string },
  baseUrl = ''
): Promise<{ token: string; user: ClientUser }> {
  return apiJson<{ token: string; user: ClientUser }>('/api/v1/auth/register', {
    method: 'POST',
    body: input,
    baseUrl,
  });
}

export async function loginClientUser(
  input: { username: string; password: string },
  baseUrl = ''
): Promise<{ token: string; user: ClientUser }> {
  return apiJson<{ token: string; user: ClientUser }>('/api/v1/auth/login', {
    method: 'POST',
    body: input,
    baseUrl,
  });
}

export async function fetchClientUserMe(token: string, baseUrl = ''): Promise<{ user: ClientUser }> {
  return apiJson<{ user: ClientUser }>('/api/v1/auth/me', { token: token.trim(), baseUrl });
}

export async function logoutClientUser(token: string, baseUrl = ''): Promise<void> {
  await apiJson('/api/v1/auth/logout', { method: 'POST', token: token.trim(), baseUrl });
}

// ============================================================================
// Platform Admin Auth & Release Management (/api/v1/admin/* & /api/v1/releases*)
// ============================================================================

export function isSecureOrLoopbackAdminOrigin(baseUrl = ''): boolean {
  const base = normalizeBaseUrl(baseUrl);
  const rawOrigin =
    base || (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
  if (!rawOrigin) return true;
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol === 'https:') return true;
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

// Confirm the server's network policy without sending credentials before an HTTP
// LAN admin request. The backend checks the actual client IP on every request.
export async function assertAllowedAdminOrigin(baseUrl = ''): Promise<void> {
  if (isSecureOrLoopbackAdminOrigin(baseUrl)) return;
  const origin = normalizeBaseUrl(baseUrl) || window.location.origin;
  publishingOrigin(origin); // HTTP is limited to explicit private IPs / loopback.
  await fetchAdminStatus(baseUrl);
}

export async function fetchAdminStatus(
  baseUrl = ''
): Promise<{ initialized: boolean; hasAdmin?: boolean; bootstrapAllowed?: boolean }> {
  const status = await apiJson<{ initialized: boolean; hasAdmin?: boolean; bootstrapAllowed?: boolean }>('/api/v1/admin/status', {
    baseUrl,
  });
  if (typeof status?.initialized !== 'boolean') throw new Error(tr('管理员状态响应无效，请检查服务地址', 'Invalid admin status response. Please verify the server URL.'));
  return status;
}

export async function loginPlatformAdmin(
  input: { username: string; password: string },
  baseUrl = ''
): Promise<{ token: string; admin: PlatformAdmin }> {
  await assertAllowedAdminOrigin(baseUrl);
  return apiJson<{ token: string; admin: PlatformAdmin }>('/api/v1/admin/login', {
    method: 'POST',
    body: input,
    baseUrl,
  });
}

export async function fetchPlatformAdminMe(token: string, baseUrl = ''): Promise<{ admin: PlatformAdmin }> {
  await assertAllowedAdminOrigin(baseUrl);
  return apiJson<{ admin: PlatformAdmin }>('/api/v1/admin/me', { token: token.trim(), baseUrl });
}

export async function logoutPlatformAdmin(token: string, baseUrl = ''): Promise<void> {
  await assertAllowedAdminOrigin(baseUrl);
  await apiJson('/api/v1/admin/logout', { method: 'POST', token: token.trim(), baseUrl });
}

export async function verifyPublisherToken(token: string, baseUrl = ''): Promise<{ name: string }> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error(tr('请输入有效的发布者凭证 Token', 'Please enter a valid publisher token'));
  return apiJson<{ name: string }>('/api/v1/publisher', { token: trimmed, baseUrl });
}

export async function fetchManagedReleases(
  token: string,
  baseUrl = ''
): Promise<{ items: DesktopRelease[]; signingPublicKey?: string }> {
  await assertAllowedAdminOrigin(baseUrl);
  const res = await apiJson<{ items: DesktopRelease[]; signingPublicKey?: string }>('/api/v1/releases', {
    token: token.trim(),
    baseUrl,
  });
  return {
    items: Array.isArray(res.items) ? res.items : [],
    signingPublicKey: res.signingPublicKey,
  };
}

export async function createManagedRelease(token: string, input: ReleaseInput, baseUrl = ''): Promise<DesktopRelease> {
  await assertAllowedAdminOrigin(baseUrl);
  return apiJson<DesktopRelease>('/api/v1/releases', {
    method: 'POST',
    token: token.trim(),
    body: input,
    baseUrl,
  });
}

export async function updateManagedRelease(token: string, id: string, input: ReleaseInput, baseUrl = ''): Promise<DesktopRelease> {
  await assertAllowedAdminOrigin(baseUrl);
  return apiJson<DesktopRelease>(`/api/v1/releases/${encodeURIComponent(id)}`, {
    method: 'PUT',
    token: token.trim(),
    body: input,
    baseUrl,
  });
}

export async function deleteManagedRelease(token: string, id: string, baseUrl = ''): Promise<void> {
  await assertAllowedAdminOrigin(baseUrl);
  await apiJson(`/api/v1/releases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token: token.trim(),
    baseUrl,
  });
}

export async function addReleaseAssetLink(
  token: string,
  releaseId: string,
  input: AssetLinkInput,
  baseUrl = ''
): Promise<DesktopReleaseAsset> {
  await assertAllowedAdminOrigin(baseUrl);
  return apiJson<DesktopReleaseAsset>(`/api/v1/releases/${encodeURIComponent(releaseId)}/assets/link`, {
    method: 'POST',
    token: token.trim(),
    body: input,
    baseUrl,
  });
}

export async function approveReleaseAsset(
  token: string,
  releaseId: string,
  assetId: string,
  sha256: string,
  baseUrl = ''
): Promise<DesktopReleaseAsset> {
  await assertAllowedAdminOrigin(baseUrl);
  return apiJson<DesktopReleaseAsset>(
    `/api/v1/releases/${encodeURIComponent(releaseId)}/assets/${encodeURIComponent(assetId)}/approve`,
    {
      method: 'POST',
      token: token.trim(),
      body: { sha256: sha256.trim().toLowerCase() },
      baseUrl,
    }
  );
}

export async function deleteReleaseAsset(
  token: string,
  releaseId: string,
  assetId: string,
  baseUrl = ''
): Promise<void> {
  await assertAllowedAdminOrigin(baseUrl);
  await apiJson(`/api/v1/releases/${encodeURIComponent(releaseId)}/assets/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
    token: token.trim(),
    baseUrl,
  });
}

export async function uploadReleaseAsset(
  token: string,
  releaseId: string,
  file: File,
  meta: { os: ReleaseOS; arch: ReleaseArch; packageType: ReleasePackageType },
  onProgress?: (percent: number, loaded: number, total: number) => void,
  baseUrl = ''
): Promise<DesktopReleaseAsset> {
  await assertAllowedAdminOrigin(baseUrl);
  const base = normalizeBaseUrl(baseUrl);
  const url = `${base}/api/v1/releases/${encodeURIComponent(releaseId)}/assets`;
  const form = new FormData();
  form.append('os', meta.os);
  form.append('arch', meta.arch);
  form.append('packageType', meta.packageType);
  form.append('fileName', file.name);
  form.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token.trim()}`);
    xhr.setRequestHeader('Accept-Language', getAcceptLanguageHeader());
    if (onProgress) {
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0) {
          const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(pct, event.loaded, event.total);
        }
      };
    }
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        resolve(data as DesktopReleaseAsset);
      } else {
        reject(new Error(typeof data?.error === 'string' ? td(data.error) : tr(`上传安装包失败 (${xhr.status})`, `Installer upload failed (${xhr.status})`)));
      }
    };
    xhr.onerror = () => reject(new Error(tr('网络异常，上传安装包失败', 'Network error while uploading installer')));
    xhr.onabort = () => reject(new Error(tr('已取消上传', 'Upload cancelled')));
    xhr.send(form);
  });
}
