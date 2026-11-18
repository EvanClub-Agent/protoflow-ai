const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { origin } = require('./publishing.cjs');

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SHA256_REGEX = /^[a-fA-F0-9]{64}$/;
const SAFE_FILENAME_REGEX = /^[A-Za-z0-9._-]+$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function describeUpdateCheckError(error, serverUrl, os, fixedSource = false) {
  const message = error instanceof Error ? error.message : String(error);
  if (error?.name === 'TimeoutError') {
    if (fixedSource) return '连接更新服务超时，请检查网络连接后重试。';
    return `连接更新服务器 ${serverUrl} 超时，请检查服务器是否运行以及当前网络能否访问该地址。`;
  }
  // Node fetch hides socket errors in cause (sometimes an AggregateError).
  // Leave HTTP, manifest and signature validation errors unchanged.
  if (message !== 'fetch failed') return message;
  const codes = new Set();
  const visited = new Set();
  const pending = [error];
  while (pending.length && visited.size < 20) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (typeof current.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(current.code)) codes.add(current.code);
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
  if (fixedSource) {
    if (os === 'macos' && ['EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'EPERM'].some(code => codes.has(code))) {
      return '无法连接更新服务，请检查网络连接，并在 macOS「系统设置 → 隐私与安全 → 本地网络」允许 Alex。';
    }
    return '暂时无法连接更新服务，请检查网络连接后重试。';
  }
  const detail = codes.size ? `（${[...codes].join('、')}）` : '';
  let advice = '请检查更新源地址、服务器状态和当前网络连接。';
  if (codes.has('ECONNREFUSED')) {
    advice = '服务器拒绝连接，请确认更新服务已启动且端口允许访问。';
  } else if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN')) {
    advice = '无法解析服务器域名，请检查地址和 DNS 设置。';
  } else if (codes.has('ETIMEDOUT') || codes.has('UND_ERR_CONNECT_TIMEOUT')) {
    advice = '连接超时，请检查服务器状态、网络路由和防火墙设置。';
  } else if (codes.has('EHOSTUNREACH') || codes.has('ENETUNREACH') || codes.has('EACCES') || codes.has('EPERM')) {
    advice = '网络不可达或访问被阻止，请检查网络路由与访问权限。';
    const host = new URL(serverUrl).hostname;
    if (os === 'macos' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      advice += '在 macOS「系统设置 → 隐私与安全 → 本地网络」允许 Alex；若已开启仍失败，请检查安装包签名。';
    }
  }
  return `无法连接更新服务器 ${serverUrl}${detail}。${advice}`;
}

function normalizePlatform(platform) {
  if (platform === 'win32' || platform === 'windows') return 'windows';
  if (platform === 'darwin' || platform === 'macos') return 'macos';
  return 'linux';
}

function normalizeArch(arch) {
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64';
  if (arch === 'universal') return 'universal';
  return 'x64';
}

function normalizeSemver(raw) {
  const trimmed = String(raw || '').trim().replace(/^[vV]/, '');
  if (!trimmed || trimmed.length > 64 || !SEMVER_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function compareSemver(a, b) {
  const na = normalizeSemver(a);
  const nb = normalizeSemver(b);
  if (!na || !nb) return NaN;
  const ma = SEMVER_REGEX.exec(na);
  const mb = SEMVER_REGEX.exec(nb);
  if (!ma || !mb) return NaN;
  for (let i = 1; i <= 3; i++) {
    const va = Number.parseInt(ma[i], 10);
    const vb = Number.parseInt(mb[i], 10);
    if (va !== vb) {
      return va > vb ? 1 : -1;
    }
  }
  const preA = ma[4] || '';
  const preB = mb[4] || '';
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  const partsA = preA.split('.');
  const partsB = preB.split('.');
  const len = Math.min(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    if (partsA[i] === partsB[i]) continue;
    const isNumA = /^\d+$/.test(partsA[i]);
    const isNumB = /^\d+$/.test(partsB[i]);
    if (isNumA && isNumB) {
      const ia = Number.parseInt(partsA[i], 10);
      const ib = Number.parseInt(partsB[i], 10);
      return ia > ib ? 1 : -1;
    }
    if (isNumA) return -1;
    if (isNumB) return 1;
    return partsA[i] > partsB[i] ? 1 : -1;
  }
  return partsA.length > partsB.length ? 1 : -1;
}

function sanitizeUpdateFileName(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed.length > 180) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null;
  if (path.basename(trimmed) !== trimmed) return null;
  if (!SAFE_FILENAME_REGEX.test(trimmed)) return null;
  return trimmed;
}

function isAssetCompatible(asset, targetOS, targetArch) {
  if (!asset || typeof asset !== 'object') return false;
  const assetOS = normalizePlatform(asset.os);
  if (assetOS !== targetOS) return false;
  const assetArch = normalizeArch(asset.arch);
  if (assetArch === targetArch) return true;
  if (assetArch === 'universal' && targetOS === 'macos') return true;
  if (targetArch === 'arm64' && assetArch === 'x64' && (targetOS === 'windows' || targetOS === 'macos')) {
    return true;
  }
  return false;
}

function extractReleaseManifestContext(releaseOrVersion, asset) {
  let rawVersion = '';
  let rawChannel = '';
  let rawMandatory = false;

  if (releaseOrVersion && typeof releaseOrVersion === 'object') {
    rawVersion = releaseOrVersion.version;
    const relChannel =
      typeof releaseOrVersion.channel === 'string' ? releaseOrVersion.channel.trim().toLowerCase() : '';
    const assetChannel = typeof asset?.channel === 'string' ? asset.channel.trim().toLowerCase() : '';
    if (relChannel && assetChannel && relChannel !== assetChannel) {
      return null;
    }
    rawChannel = relChannel || assetChannel || 'stable';

    const hasRelMandatory = typeof releaseOrVersion.mandatory === 'boolean';
    const hasAssetMandatory = typeof asset?.mandatory === 'boolean';
    if (hasRelMandatory && hasAssetMandatory && releaseOrVersion.mandatory !== asset.mandatory) {
      return null;
    }
    rawMandatory = hasRelMandatory ? releaseOrVersion.mandatory : Boolean(asset?.mandatory);
  } else {
    rawVersion = releaseOrVersion;
    rawChannel = typeof asset?.channel === 'string' && asset.channel.trim() ? asset.channel.trim().toLowerCase() : 'stable';
    rawMandatory = Boolean(asset?.mandatory);
  }

  const cleanVersion = normalizeSemver(rawVersion);
  if (!cleanVersion) return null;
  if (rawChannel !== 'stable' && rawChannel !== 'beta') return null;

  return {
    cleanVersion,
    cleanChannel: rawChannel,
    cleanMandatory: Boolean(rawMandatory),
  };
}

function buildCanonicalAssetManifest(releaseOrVersion, asset) {
  const ctx = extractReleaseManifestContext(releaseOrVersion, asset);
  const cleanFileName = sanitizeUpdateFileName(asset?.fileName);
  const sha256 = String(asset?.sha256 || '').trim().toLowerCase();
  const sizeBytes = Number(asset?.sizeBytes);
  if (!ctx || !cleanFileName || !SHA256_REGEX.test(sha256) || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return null;
  }
  return [
    'protoflow-release-v2',
    ctx.cleanVersion,
    ctx.cleanChannel,
    ctx.cleanMandatory ? 'true' : 'false',
    String(asset.os || '').trim(),
    String(asset.arch || '').trim(),
    String(asset.packageType || '').trim(),
    cleanFileName,
    String(sizeBytes),
    sha256,
  ].join('\n');
}

function verifyAssetManifestSignature(releaseOrVersion, asset, trustedPublicKeyBase64) {
  const canonical = buildCanonicalAssetManifest(releaseOrVersion, asset);
  if (!canonical) return false;
  const pubBase64 = String(trustedPublicKeyBase64 || '').trim();
  const sigBase64 = String(asset?.signature || '').trim();
  if (!pubBase64 || !sigBase64) return false;
  try {
    const rawPub = Buffer.from(pubBase64, 'base64');
    const rawSig = Buffer.from(sigBase64, 'base64');
    if (rawPub.length !== 32 || rawSig.length !== 64) return false;
    const keyObject = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPub]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(canonical, 'utf8'), keyObject, rawSig);
  } catch {
    return false;
  }
}

function signAssetManifest(releaseOrVersion, asset, privateSeedBase64) {
  const canonical = buildCanonicalAssetManifest(releaseOrVersion, asset);
  if (!canonical) {
    throw new Error('Cannot sign invalid asset manifest');
  }
  const seed = Buffer.isBuffer(privateSeedBase64)
    ? privateSeedBase64
    : Buffer.from(String(privateSeedBase64), 'base64');
  const rawSeed = seed.length === 64 ? seed.subarray(0, 32) : seed;
  if (rawSeed.length !== 32) {
    throw new Error('Ed25519 seed must be 32 bytes');
  }
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, rawSeed]),
    format: 'der',
    type: 'pkcs8',
  });
  const pubDer = crypto.createPublicKey(privKey).export({ format: 'der', type: 'spki' });
  const rawPub = Buffer.from(pubDer).subarray(ED25519_SPKI_PREFIX.length);
  const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privKey);
  return {
    signature: sig.toString('base64'),
    signingPublicKey: rawPub.toString('base64'),
  };
}

function detectLinuxContext() {
  const appImagePath = process.env.APPIMAGE ? String(process.env.APPIMAGE) : null;
  let isDebian = false;
  try {
    isDebian = fs.existsSync('/etc/debian_version') || fs.existsSync('/usr/bin/apt');
  } catch {
    isDebian = false;
  }
  return {
    appImagePath,
    isDebian,
    preferPackage: appImagePath ? 'AppImage' : isDebian ? 'deb' : 'AppImage',
  };
}

class DesktopUpdater {
  constructor({
    dataDir,
    appVersion = '0.1.0',
    platform = process.platform,
    arch = process.arch,
    trustedPublicKey = process.env.PROTOFLOW_UPDATE_PUBLIC_KEY || '',
    defaultServerUrl = '',
    fixedUpdateConfig = null,
    getFallbackServerUrl = () => '',
    emit = () => {},
    fetchImpl = fetch,
    openPath = async () => '',
    showItemInFolder = () => {},
    launchDetached = () => {},
    installDeb = async () => { throw new Error('当前安装包未包含自动安装组件，请联系管理员获取新版安装包。'); },
    restartApp = () => {},
  }) {
    this.dataDir = dataDir;
    this.configFile = path.join(dataDir, 'updater.json');
    // Managed distributions that set a non-empty bundled serverUrl own the source,
    // channel and trust root. Open-source builds with empty serverUrl stay unlocked.
    const validatedFixed = fixedUpdateConfig
      ? require('./update-channel.cjs').validateBundledUpdateChannel(fixedUpdateConfig)
      : null;
    this.fixedUpdateConfig = validatedFixed && validatedFixed.serverUrl
      ? Object.freeze({ ...validatedFixed })
      : null;
    this.updatesDir = path.join(dataDir, 'updates');
    this.appVersion = normalizeSemver(appVersion) || '0.1.0';
    this.os = normalizePlatform(platform);
    this.arch = normalizeArch(arch);
    this.trustedPublicKey = String(trustedPublicKey || '').trim();
    this.defaultServerUrl = defaultServerUrl ? origin(defaultServerUrl) : '';
    this.installDeb = installDeb;
    this.restartApp = restartApp;
    this.installing = false;
    this.linuxContext = this.os === 'linux' ? detectLinuxContext() : { appImagePath: null, isDebian: false, preferPackage: '' };
    this.getFallbackServerUrl = getFallbackServerUrl;
    this.emit = emit;
    this.fetch = fetchImpl;
    this.openPath = openPath;
    this.showItemInFolder = showItemInFolder;
    this.launchDetached = launchDetached;

    this.configEpoch = 0;
    this.checkAbort = null;
    this.downloadAbort = null;
    this.activeDownload = null;
    this.latestTaskId = null;

    this.state = {
      status: 'idle', // 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
      currentVersion: this.appVersion,
      os: this.os,
      arch: this.arch,
      preferPackage: this.os === 'windows' ? 'exe' : this.os === 'macos' ? 'dmg' : this.linuxContext.preferPackage,
      isDebian: this.linuxContext.isDebian,
      appImagePath: this.linuxContext.appImagePath,
      serverUrl: '',
      channel: 'stable',
      skippedVersion: '',
      signingPublicKey: this.trustedPublicKey || '',
      hasUpdate: false,
      latestRelease: null,
      recommendedAsset: null,
      platformAssets: [],
      progress: null,
      downloadedAssetId: null,
      downloadedFilePath: null,
      verifiedSha256: null,
      lastCheckedAt: null,
      error: null,
      installGuide: null,
    };
  }

  readConfig() {
    try {
      if (!fs.existsSync(this.configFile)) return {};
      return JSON.parse(fs.readFileSync(this.configFile, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  writeConfig(next) {
    const merged = { ...this.readConfig(), ...next };
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    const tmp = `${this.configFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.configFile);
    return merged;
  }

  resolveServerUrl(explicitUrl) {
    if (this.fixedUpdateConfig) return this.fixedUpdateConfig.serverUrl;
    if (typeof explicitUrl === 'string' && explicitUrl.trim()) {
      return origin(explicitUrl.trim());
    }
    const cfg = this.readConfig();
    if (typeof cfg.serverUrl === 'string' && cfg.serverUrl.trim()) {
      try {
        return origin(cfg.serverUrl.trim());
      } catch {
        // ignore invalid stored URL
      }
    }
    // The bundled distribution channel is independent of prototype publishing.
    const fallback = process.env.PROTOFLOW_UPDATE_URL || this.defaultServerUrl || this.getFallbackServerUrl?.() || '';
    if (typeof fallback === 'string' && fallback.trim()) {
      try {
        return origin(fallback.trim());
      } catch {
        return '';
      }
    }
    return '';
  }

  resolveTrustedPublicKey() {
    if (this.fixedUpdateConfig) return this.fixedUpdateConfig.trustedPublicKey;
    if (this.trustedPublicKey) return this.trustedPublicKey;
    const cfg = this.readConfig();
    if (typeof cfg.trustedPublicKey === 'string' && cfg.trustedPublicKey.trim()) {
      return cfg.trustedPublicKey.trim();
    }
    const envKey = String(process.env.PROTOFLOW_UPDATE_PUBLIC_KEY || '').trim();
    if (envKey) return envKey;
    return '';
  }

  resolveChannel() {
    if (this.fixedUpdateConfig) return this.fixedUpdateConfig.channel;
    return this.readConfig().channel === 'beta' ? 'beta' : 'stable';
  }

  resolveSafeUpdatePaths(version, fileName) {
    const cleanVersion = normalizeSemver(version);
    if (!cleanVersion) {
      throw new Error('更新清单中的版本号格式非法，已拒绝写入本地路径');
    }
    const cleanFileName = sanitizeUpdateFileName(fileName);
    if (!cleanFileName) {
      throw new Error('更新清单中的安装包文件名非法，已拒绝写入本地路径');
    }
    const rootDir = path.resolve(this.updatesDir);
    const versionDir = path.resolve(rootDir, cleanVersion);
    const relVersion = path.relative(rootDir, versionDir);
    if (!relVersion || relVersion.startsWith('..') || path.isAbsolute(relVersion)) {
      throw new Error('更新目录路径越界，已拒绝访问');
    }
    const finalPath = path.resolve(versionDir, cleanFileName);
    const relFile = path.relative(versionDir, finalPath);
    const relRoot = path.relative(rootDir, finalPath);
    if (
      !relFile ||
      relFile.startsWith('..') ||
      path.isAbsolute(relFile) ||
      !relRoot ||
      relRoot.startsWith('..') ||
      path.isAbsolute(relRoot)
    ) {
      throw new Error('安装包目标路径越界，已拒绝访问');
    }
    return { rootDir, versionDir, finalPath, cleanVersion, cleanFileName };
  }

  validateTrustedAsset(releaseOrVersion, asset, expectedClientChannel) {
    if (!asset || typeof asset !== 'object') {
      throw new Error('更新清单缺少有效的安装包信息');
    }
    const rawVersion =
      releaseOrVersion && typeof releaseOrVersion === 'object' ? releaseOrVersion.version : releaseOrVersion;
    const paths = this.resolveSafeUpdatePaths(rawVersion, asset.fileName);
    const versionCmp = compareSemver(paths.cleanVersion, this.appVersion);
    if (!(versionCmp > 0)) {
      throw new Error(
        `目标版本 (v${paths.cleanVersion}) 不高于当前客户端版本 (v${this.appVersion})，已拒绝降级或重放安装`
      );
    }

    const activeChannel = this.fixedUpdateConfig ? this.resolveChannel() : expectedClientChannel || this.resolveChannel();
    const manifestCtx = extractReleaseManifestContext(releaseOrVersion, asset);
    if (!manifestCtx) {
      throw new Error('更新清单中的发布通道或强制更新标记不一致或无效，已阻止安装');
    }
    if (activeChannel === 'stable' && manifestCtx.cleanChannel !== 'stable') {
      throw new Error('当前客户端处于正式版 (stable) 通道，已拒绝非正式版通道的安装包');
    }

    if (!isAssetCompatible(asset, this.os, this.arch)) {
      throw new Error(`安装包架构 (${asset.os}/${asset.arch}) 与当前设备 (${this.os}/${this.arch}) 不兼容，已阻止安装`);
    }
    const sizeBytes = Number(asset.sizeBytes);
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new Error('更新清单缺少有效的文件大小声明 (sizeBytes)，已阻止安装');
    }
    const expectedSha256 = String(asset.sha256 || '').trim().toLowerCase();
    if (!SHA256_REGEX.test(expectedSha256)) {
      throw new Error('更新清单缺少可信的 64 位 SHA-256 校验值，已阻止安装');
    }

    const trustedPub = this.resolveTrustedPublicKey();

    if (!trustedPub) {
      throw new Error('客户端尚未配置可信更新签名公钥，已拒绝未经独立信任链验证的更新包');
    }
    if (!asset.signature) {
      throw new Error('更新清单缺少可信的 Ed25519 数字签名，已阻止安装');
    }
    if (asset.signingPublicKey && asset.signingPublicKey.trim() !== trustedPub) {
      throw new Error('更新清单签名公钥与已绑定的可信公钥不一致，已阻止安装');
    }
    if (
      !verifyAssetManifestSignature(
        {
          version: paths.cleanVersion,
          channel: manifestCtx.cleanChannel,
          mandatory: manifestCtx.cleanMandatory,
        },
        asset,
        trustedPub
      )
    ) {
      throw new Error('更新清单数字签名校验未通过，清单或发布通道可能已被篡改，已阻止安装');
    }

    return {
      ...paths,
      channel: manifestCtx.cleanChannel,
      mandatory: manifestCtx.cleanMandatory,
      sizeBytes,
      expectedSha256,
    };
  }

  snapshot() {
    const cfg = this.readConfig();
    const serverUrl = this.resolveServerUrl();
    const channel = this.resolveChannel();
    const skippedVersion = typeof cfg.skippedVersion === 'string' ? cfg.skippedVersion : '';
    const signingPublicKey = this.resolveTrustedPublicKey();
    return {
      ...this.state,
      serverUrl,
      channel,
      skippedVersion,
      signingPublicKey,
      configEpoch: this.configEpoch,
    };
  }

  pushState(partial) {
    this.state = { ...this.state, ...partial };
    const snap = this.snapshot();
    this.emit(snap);
    return snap;
  }

  configure(input = {}) {
    if (this.fixedUpdateConfig) throw new Error('更新服务由应用内置管理，不支持修改。');
    if (this.installing) throw new Error('正在安装更新，请等待完成后再修改设置');
    const prevCfg = this.readConfig();
    const prevServerUrl = this.resolveServerUrl();
    const prevChannel = prevCfg.channel === 'beta' ? 'beta' : 'stable';
    const prevTrustedKey = this.resolveTrustedPublicKey();

    const updates = {};
    if (input.serverUrl !== undefined) {
      const raw = String(input.serverUrl || '').trim();
      updates.serverUrl = raw ? origin(raw) : '';
    }
    if (input.channel === 'stable' || input.channel === 'beta') {
      updates.channel = input.channel;
    }
    if (typeof input.skippedVersion === 'string') {
      updates.skippedVersion = input.skippedVersion.trim();
    }
    if (typeof input.trustedPublicKey === 'string') {
      updates.trustedPublicKey = input.trustedPublicKey.trim();
      this.trustedPublicKey = updates.trustedPublicKey;
    }
    this.writeConfig(updates);

    const nextServerUrl = this.resolveServerUrl();
    const nextCfg = this.readConfig();
    const nextChannel = nextCfg.channel === 'beta' ? 'beta' : 'stable';
    const nextTrustedKey = this.resolveTrustedPublicKey();

    const sourceChanged =
      (input.serverUrl !== undefined && nextServerUrl !== prevServerUrl) ||
      (input.channel !== undefined && nextChannel !== prevChannel) ||
      (input.trustedPublicKey !== undefined && nextTrustedKey !== prevTrustedKey);

    if (sourceChanged) {
      this.configEpoch += 1;
      if (this.checkAbort) {
        try {
          this.checkAbort.abort();
        } catch {}
        this.checkAbort = null;
      }
      if (this.activeDownload) {
        try {
          this.activeDownload.abortController.abort();
        } catch {}
      } else if (this.downloadAbort) {
        try {
          this.downloadAbort.abort();
        } catch {}
        this.downloadAbort = null;
      }
      this.latestTaskId = null;

      return this.pushState({
        status: 'idle',
        signingPublicKey: nextTrustedKey,
        hasUpdate: false,
        latestRelease: null,
        recommendedAsset: null,
        platformAssets: [],
        downloadedAssetId: null,
        downloadedFilePath: null,
        verifiedSha256: null,
        progress: null,
        installGuide: null,
        error: null,
      });
    }
    return this.pushState({ signingPublicKey: nextTrustedKey, error: null });
  }

  verifyExistingDownload(releaseOrVersion, asset, expectedClientChannel) {
    try {
      const { finalPath, sizeBytes, expectedSha256 } = this.validateTrustedAsset(
        releaseOrVersion,
        asset,
        expectedClientChannel
      );
      if (!fs.existsSync(finalPath)) return null;
      const stat = fs.statSync(finalPath);
      if (!stat.isFile() || stat.size !== sizeBytes) return null;
      const hash = crypto.createHash('sha256').update(fs.readFileSync(finalPath)).digest('hex').toLowerCase();
      if (hash !== expectedSha256) return null;
      return { filePath: finalPath, sha256: hash };
    } catch {
      return null;
    }
  }

  async check(options = {}) {
    if (this.installing) return this.snapshot();
    if (
      options.serverUrl !== undefined ||
      options.channel !== undefined ||
      options.trustedPublicKey !== undefined
    ) {
      this.configure(options);
    }
    const requestEpoch = this.configEpoch;
    const serverUrl = this.resolveServerUrl(options.serverUrl);
    const channel = this.resolveChannel();

    if (!serverUrl) {
      if (this.configEpoch !== requestEpoch) {
        return this.snapshot();
      }
      return this.pushState({
        status: 'idle',
        error: options.silent ? null : '尚未配置版本更新服务地址，请先填写服务器地址或连接发布服务',
      });
    }

    if (this.checkAbort) {
      try {
        this.checkAbort.abort();
      } catch {}
    }
    const checkAbort = new AbortController();
    this.checkAbort = checkAbort;

    this.pushState({ status: 'checking', error: null, installGuide: null });

    try {
      const query = new URLSearchParams({
        currentVersion: this.appVersion,
        os: this.os,
        arch: this.arch,
        channel,
        preferPackage: this.state.preferPackage || '',
      });
      const timeoutSignal = AbortSignal.timeout(20000);
      const signal =
        typeof AbortSignal.any === 'function'
          ? AbortSignal.any([checkAbort.signal, timeoutSignal])
          : checkAbort.signal;

      const response = await this.fetch(`${serverUrl}/api/v1/updates/check?${query.toString()}`, {
        method: 'GET',
        redirect: 'error',
        signal,
      });
      if (this.configEpoch !== requestEpoch || this.checkAbort !== checkAbort || checkAbort.signal.aborted) {
        return this.snapshot();
      }
      const data = await response.json().catch(() => null);
      if (this.configEpoch !== requestEpoch || this.checkAbort !== checkAbort || checkAbort.signal.aborted) {
        return this.snapshot();
      }
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `检查更新失败 (${response.status})`);
      }
      if (!data || typeof data.hasUpdate !== 'boolean') {
        throw new Error('更新服务返回了无效的响应格式');
      }

      const latestRelease = data.latestRelease || null;
      if (latestRelease && !normalizeSemver(latestRelease.version)) {
        throw new Error('更新服务返回了非法的版本号格式');
      }
      if (latestRelease) {
        latestRelease.version = normalizeSemver(latestRelease.version);
        const relChannel = String(latestRelease.channel || 'stable').trim().toLowerCase();
        if (relChannel !== 'stable' && relChannel !== 'beta') {
          throw new Error('更新服务返回了非法的发布通道格式');
        }
        latestRelease.channel = relChannel;
        latestRelease.mandatory = Boolean(latestRelease.mandatory);
      }

      const rawPlatformAssets = Array.isArray(data.platformAssets) ? data.platformAssets : [];
      const platformAssets = rawPlatformAssets.filter((a) => isAssetCompatible(a, this.os, this.arch));
      const recommendedAsset =
        platformAssets.find((asset) => asset.id === data.recommendedAsset?.id) ?? platformAssets[0] ?? null;
      const hasUpdate = Boolean(
        data.hasUpdate && recommendedAsset && latestRelease && compareSemver(latestRelease.version, this.appVersion) > 0
      );
      if (hasUpdate) {
        this.validateTrustedAsset(latestRelease, recommendedAsset, channel);
      }

      let downloadedAssetId = null;
      let downloadedFilePath = null;
      let verifiedSha256 = null;
      if (hasUpdate && latestRelease) {
        const checkAssets = recommendedAsset ? [recommendedAsset, ...platformAssets] : platformAssets;
        for (const asset of checkAssets) {
          const verified = this.verifyExistingDownload(latestRelease, asset, channel);
          if (verified) {
            downloadedAssetId = asset.id;
            downloadedFilePath = verified.filePath;
            verifiedSha256 = verified.sha256;
            break;
          }
        }
      }

      if (this.configEpoch !== requestEpoch || this.checkAbort !== checkAbort || checkAbort.signal.aborted) {
        return this.snapshot();
      }

      return this.pushState({
        status: downloadedFilePath ? 'downloaded' : hasUpdate ? 'available' : 'up-to-date',
        signingPublicKey: this.resolveTrustedPublicKey(),
        hasUpdate,
        latestRelease: hasUpdate ? latestRelease : null,
        recommendedAsset: hasUpdate ? recommendedAsset : null,
        platformAssets: hasUpdate ? platformAssets : [],
        downloadedAssetId,
        downloadedFilePath,
        verifiedSha256,
        progress: null,
        lastCheckedAt: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      if (this.configEpoch !== requestEpoch || this.checkAbort !== checkAbort || checkAbort.signal.aborted) {
        return this.snapshot();
      }
      return this.pushState({
        status: 'error',
        error: describeUpdateCheckError(err, serverUrl, this.os, Boolean(this.fixedUpdateConfig)),
        lastCheckedAt: new Date().toISOString(),
      });
    } finally {
      if (this.checkAbort === checkAbort) {
        this.checkAbort = null;
      }
    }
  }

  async download({ assetId } = {}) {
    if (this.installing) throw new Error('正在安装更新，请等待完成');
    const downloadEpoch = this.configEpoch;
    if (this.activeDownload) {
      if (!this.activeDownload.abortController.signal.aborted && this.activeDownload.epoch === downloadEpoch) {
        throw new Error('已有正在进行的更新包下载任务');
      }
      try {
        await this.activeDownload.promise;
      } catch {
        // previous cancelled download finished cleaning up
      }
    }
    if (this.configEpoch !== downloadEpoch) {
      return this.snapshot();
    }

    const release = this.state.latestRelease;
    if (!release) {
      throw new Error('请先检查新版本后再下载安装包');
    }
    const compatiblePool = [
      ...(Array.isArray(this.state.platformAssets) ? this.state.platformAssets : []),
      ...(Array.isArray(release.assets) ? release.assets : []),
    ].filter((a) => isAssetCompatible(a, this.os, this.arch));

    let asset = null;
    if (assetId) {
      const allAssets = [
        ...(Array.isArray(this.state.platformAssets) ? this.state.platformAssets : []),
        ...(Array.isArray(release.assets) ? release.assets : []),
      ];
      const requested = allAssets.find((a) => a.id === assetId);
      if (!requested) {
        throw new Error('未找到指定的安装包');
      }
      if (!isAssetCompatible(requested, this.os, this.arch)) {
        return this.pushState({
          status: 'error',
          downloadedAssetId: null,
          downloadedFilePath: null,
          verifiedSha256: null,
          progress: null,
          error: `安装包架构 (${requested.os}/${requested.arch}) 与当前设备 (${this.os}/${this.arch}) 不兼容，已阻止下载`,
        });
      }
      asset = requested;
    } else {
      asset =
        (this.state.recommendedAsset && isAssetCompatible(this.state.recommendedAsset, this.os, this.arch)
          ? this.state.recommendedAsset
          : null) ||
        compatiblePool[0] ||
        null;
    }

    if (!asset) {
      return this.pushState({
        status: 'error',
        downloadedAssetId: null,
        downloadedFilePath: null,
        verifiedSha256: null,
        progress: null,
        error: `当前版本 v${release.version} 暂未提供兼容 ${this.os} (${this.arch}) 的安装包`,
      });
    }

    const serverUrl = this.resolveServerUrl();
    const activeChannel = this.resolveChannel();
    let validated;
    try {
      validated = this.validateTrustedAsset(release, asset, activeChannel);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.pushState({
        status: 'error',
        downloadedAssetId: null,
        downloadedFilePath: null,
        verifiedSha256: null,
        progress: null,
        error: message,
      });
    }

    const existing = this.verifyExistingDownload(release, asset, activeChannel);
    if (existing) {
      return this.pushState({
        status: 'downloaded',
        downloadedAssetId: asset.id,
        downloadedFilePath: existing.filePath,
        verifiedSha256: existing.sha256,
        progress: {
          assetId: asset.id,
          fileName: validated.cleanFileName,
          transferredBytes: validated.sizeBytes,
          totalBytes: validated.sizeBytes,
          percent: 100,
          speedBytesPerSec: 0,
        },
        error: null,
      });
    }

    const downloadUrl = asset.downloadUrl || (serverUrl ? `${serverUrl}/api/v1/updates/assets/${asset.id}/download` : '');
    if (!downloadUrl) {
      throw new Error('安装包缺少有效的下载地址');
    }

    const { versionDir, finalPath, cleanFileName, sizeBytes: expectedSizeBytes, expectedSha256 } = validated;
    const taskId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const partPath = `${finalPath}.${taskId}.part`;

    const abortController = new AbortController();
    this.downloadAbort = abortController;
    this.latestTaskId = taskId;

    const taskRecord = {
      taskId,
      epoch: downloadEpoch,
      abortController,
      partPath,
      promise: null,
    };
    this.activeDownload = taskRecord;

    const runDownload = async () => {
      const startedAt = Date.now();
      let lastEmitAt = 0;

      if (this.configEpoch === downloadEpoch && this.latestTaskId === taskId) {
        this.pushState({
          status: 'downloading',
          downloadedAssetId: null,
          downloadedFilePath: null,
          verifiedSha256: null,
          error: null,
          installGuide: null,
          progress: {
            assetId: asset.id,
            fileName: cleanFileName,
            transferredBytes: 0,
            totalBytes: expectedSizeBytes,
            percent: 0,
            speedBytesPerSec: 0,
          },
        });
      }

      let fileStream = null;
      try {
        await fs.promises.mkdir(versionDir, { recursive: true });

        const response = await this.fetch(downloadUrl, {
          method: 'GET',
          signal: abortController.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`下载安装包失败 (${response.status})`);
        }

        const totalBytes = expectedSizeBytes;
        const hasher = crypto.createHash('sha256');

        fileStream = fs.createWriteStream(partPath, { mode: 0o600 });
        let streamError = null;
        const streamErrorPromise = new Promise((_, reject) => {
          fileStream.on('error', (err) => {
            streamError = err;
            reject(err);
          });
        });
        streamErrorPromise.catch(() => {});

        await Promise.race([
          new Promise((resolve) => {
            if (fileStream.fd !== null && fileStream.fd !== undefined) {
              resolve();
              return;
            }
            fileStream.once('open', () => resolve());
          }),
          streamErrorPromise,
        ]);

        let transferredBytes = 0;

        for await (const chunk of response.body) {
          if (abortController.signal.aborted || this.configEpoch !== downloadEpoch || this.latestTaskId !== taskId) {
            throw new Error('已取消下载');
          }
          if (streamError) {
            throw streamError;
          }
          const buf = Buffer.from(chunk);
          hasher.update(buf);
          transferredBytes += buf.length;

          if (transferredBytes > expectedSizeBytes) {
            throw new Error('下载内容超出发布清单声明的大小，已终止下载');
          }

          const canContinue = fileStream.write(buf);
          if (streamError) {
            throw streamError;
          }
          if (!canContinue) {
            await Promise.race([
              new Promise((resolve) => fileStream.once('drain', resolve)),
              streamErrorPromise,
            ]);
          }

          const now = Date.now();
          if (
            this.configEpoch === downloadEpoch &&
            this.latestTaskId === taskId &&
            (now - lastEmitAt >= 100 || (totalBytes > 0 && transferredBytes >= totalBytes))
          ) {
            lastEmitAt = now;
            const elapsedSec = Math.max(0.1, (now - startedAt) / 1000);
            const speedBytesPerSec = Math.round(transferredBytes / elapsedSec);
            const percent = totalBytes > 0 ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : 0;
            this.pushState({
              status: 'downloading',
              progress: {
                assetId: asset.id,
                fileName: cleanFileName,
                transferredBytes,
                totalBytes,
                percent,
                speedBytesPerSec,
              },
            });
          }
        }

        if (abortController.signal.aborted || this.configEpoch !== downloadEpoch || this.latestTaskId !== taskId) {
          throw new Error('已取消下载');
        }
        if (streamError) {
          throw streamError;
        }

        await Promise.race([
          new Promise((resolve, reject) => {
            fileStream.end((err) => (err ? reject(err) : resolve()));
          }),
          streamErrorPromise,
        ]);
        fileStream = null;

        if (transferredBytes !== expectedSizeBytes) {
          throw new Error(
            `安装包字节长度 (${transferredBytes}) 与发布清单声明 (${expectedSizeBytes}) 不符，已阻止安装`
          );
        }

        const computedSha256 = hasher.digest('hex').toLowerCase();
        if (computedSha256 !== expectedSha256) {
          throw new Error('安装包 SHA-256 校验不匹配，文件可能损坏或被篡改，请重试');
        }

        if (abortController.signal.aborted || this.configEpoch !== downloadEpoch || this.latestTaskId !== taskId) {
          throw new Error('已取消下载');
        }

        await fs.promises.rename(partPath, finalPath);
        if (this.os === 'linux' && asset.packageType === 'AppImage') {
          try {
            await fs.promises.chmod(finalPath, 0o755);
          } catch {
            // ignore chmod failure on unsupported filesystems
          }
        }

        if (abortController.signal.aborted || this.configEpoch !== downloadEpoch || this.latestTaskId !== taskId) {
          return this.snapshot();
        }

        return this.pushState({
          status: 'downloaded',
          downloadedAssetId: asset.id,
          downloadedFilePath: finalPath,
          verifiedSha256: computedSha256,
          progress: {
            assetId: asset.id,
            fileName: cleanFileName,
            transferredBytes,
            totalBytes: expectedSizeBytes,
            percent: 100,
            speedBytesPerSec: 0,
          },
          error: null,
        });
      } catch (err) {
        if (fileStream) {
          await new Promise((resolve) => {
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            fileStream.once('close', finish);
            try {
              fileStream.destroy();
            } catch {
              finish();
            }
            setTimeout(finish, 50);
          });
          fileStream = null;
        }
        try {
          if (fs.existsSync(partPath)) {
            await fs.promises.unlink(partPath);
          }
        } catch {
          // ignore cleanup failure
        }
        const aborted = abortController.signal.aborted;
        if (this.configEpoch === downloadEpoch && this.latestTaskId === taskId) {
          return this.pushState({
            status: aborted ? (this.state.hasUpdate ? 'available' : 'idle') : 'error',
            downloadedAssetId: null,
            downloadedFilePath: null,
            verifiedSha256: null,
            progress: null,
            error: aborted ? null : err instanceof Error ? err.message : String(err),
          });
        }
        return this.snapshot();
      } finally {
        try {
          if (fs.existsSync(partPath)) {
            fs.unlinkSync(partPath);
          }
        } catch {
          // ignore
        }
        if (this.activeDownload === taskRecord) {
          this.activeDownload = null;
        }
        if (this.downloadAbort === abortController) {
          this.downloadAbort = null;
        }
      }
    };

    taskRecord.promise = runDownload();
    return taskRecord.promise;
  }

  cancelDownload() {
    if (this.installing) return this.snapshot();
    if (this.activeDownload) {
      this.activeDownload.abortController.abort();
    } else if (this.downloadAbort) {
      this.downloadAbort.abort();
      this.downloadAbort = null;
    }
    return this.pushState({
      status: this.state.hasUpdate ? 'available' : 'idle',
      progress: null,
      error: null,
    });
  }

  reveal() {
    const filePath = this.state.downloadedFilePath;
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('未找到已下载的安装包文件');
    }
    this.showItemInFolder(filePath);
    return { revealed: true, filePath };
  }

  async apply({ expectedAssetId, expectedConfigEpoch } = {}) {
    if (this.installing) throw new Error('正在安装更新，请勿重复操作');
    if ((expectedConfigEpoch !== undefined && expectedConfigEpoch !== this.configEpoch) ||
        (expectedAssetId !== undefined && expectedAssetId !== this.state.downloadedAssetId)) {
      throw new Error('更新内容已改变，请重新检查更新');
    }
    const filePath = this.state.downloadedFilePath;
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('请先下载新版本安装包');
    }
    const release = this.state.latestRelease;
    if (!release) {
      throw new Error('缺少版本发布清单信息，无法执行安装');
    }
    const allAssets = [
      ...(Array.isArray(this.state.platformAssets) ? this.state.platformAssets : []),
      ...(Array.isArray(release?.assets) ? release.assets : []),
    ];
    const asset = allAssets.find((a) => a.id === this.state.downloadedAssetId);
    if (!asset) {
      throw new Error('未找到与已下载安装包匹配的发布清单条目');
    }

    const activeChannel = this.resolveChannel();
    const verified = this.verifyExistingDownload(release, asset, activeChannel);
    if (!verified || path.resolve(verified.filePath) !== path.resolve(filePath)) {
      this.pushState({
        status: 'error',
        downloadedAssetId: null,
        downloadedFilePath: null,
        verifiedSha256: null,
        error: '安装包完整性、大小、通道或签名校验未通过，已阻止启动安装器',
      });
      throw new Error('安装包完整性、大小、通道或签名校验未通过，已阻止启动安装器');
    }

    const pkgType = asset.packageType;

    if (this.os === 'windows') {
      if (pkgType === 'exe') {
        this.launchDetached(filePath, []);
        const guide = {
          action: 'installer-launched',
          platform: 'windows',
          packageType: 'exe',
          filePath,
          title: '已启动 Windows 安装向导',
          steps: [
            'Windows NSIS 安装向导已启动，正在准备退出当前应用以释放文件锁。',
            '在安装向导中点击「下一步 / 安装」即可覆盖升级并保留全部本地工程与 AI 配置。',
          ],
        };
        this.pushState({ installGuide: guide });
        return guide;
      }
      this.showItemInFolder(filePath);
      const guide = {
        action: 'archive-revealed',
        platform: 'windows',
        packageType: pkgType,
        filePath,
        title: '已在资源管理器定位更新压缩包',
        steps: ['请解压该归档包并覆盖原程序目录，然后重新启动 Alex。'],
      };
      this.pushState({ installGuide: guide });
      return guide;
    }

    if (this.os === 'macos') {
      if (pkgType === 'dmg') {
        const openError = await this.openPath(filePath);
        if (openError) {
          this.showItemInFolder(filePath);
        }
        const guide = {
          action: 'dmg-mounted',
          platform: 'macos',
          packageType: 'dmg',
          filePath,
          title: '已打开 macOS 磁盘映像 (.dmg)',
          steps: [
            '在弹出的 Finder 窗口中，将「Alex.app」拖入「Applications (应用程序)」文件夹并选择「替换」。',
            '退出当前旧版应用，再从「应用程序」打开 Alex。首次从旧名称升级时，请改用 Alex 启动。',
          ],
        };
        this.pushState({ installGuide: guide });
        return guide;
      }
      this.showItemInFolder(filePath);
      const guide = {
        action: 'zip-revealed',
        platform: 'macos',
        packageType: 'zip',
        filePath,
        title: '已在 Finder 中显示 macOS 压缩包 (.zip)',
        steps: [
          '双击解压生成的「Alex.app」，将其拖入「Applications (应用程序)」替换旧版本。',
        ],
      };
      this.pushState({ installGuide: guide });
      return guide;
    }

    // Linux: AppImage, deb, tar.gz
    if (pkgType === 'AppImage') {
      if ( normalizeArch(asset.arch) !== this.arch ) {
        throw new Error(`AppImage 目标架构 (${asset.arch}) 与当前运行架构 (${this.arch}) 不一致，已拒绝替换`);
      }
      // Verify ELF machine architecture if binary starts with \x7fELF
      try {
        const header = fs.readFileSync(filePath).subarray(0, 20);
        if (header.length >= 20 && header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
          const eMachine = header.readUInt16LE(18);
          const expectedMachine = this.arch === 'arm64' ? 183 : 62; // EM_AARCH64 = 183, EM_X86_64 = 62
          if (eMachine !== expectedMachine) {
            throw new Error(`AppImage ELF 机器架构与当前 ${this.arch} 进程不兼容，已拒绝替换`);
          }
        }
      } catch (elfErr) {
        if (elfErr instanceof Error && elfErr.message.includes('ELF')) {
          throw elfErr;
        }
      }

      try {
        fs.chmodSync(filePath, 0o755);
      } catch {}
      const currentAppImage = this.linuxContext.appImagePath;
      if (currentAppImage && fs.existsSync(path.dirname(currentAppImage))) {
        try {
          const targetTmp = `${currentAppImage}.${process.pid}.update-tmp`;
          fs.copyFileSync(filePath, targetTmp);
          fs.chmodSync(targetTmp, 0o755);
          fs.renameSync(targetTmp, currentAppImage);
          this.launchDetached(currentAppImage, []);
          const guide = {
            action: 'appimage-replaced',
            platform: 'linux',
            packageType: 'AppImage',
            filePath: currentAppImage,
            title: '已原地更新 AppImage 并启动新版本',
            steps: ['已自动赋予可执行权限并替换原 AppImage 文件，新版即将启动。'],
          };
          this.pushState({ installGuide: guide });
          return guide;
        } catch {
          // Fallback to reveal if current AppImage location is not writable
        }
      }
      this.showItemInFolder(filePath);
      const guide = {
        action: 'appimage-ready',
        platform: 'linux',
        packageType: 'AppImage',
        filePath,
        title: 'AppImage 已就绪并赋予可执行权限',
        steps: [
          '已自动设置 chmod +x 可执行权限，并在文件管理器中为您定位该文件。',
          '您可以直接双击运行新版 AppImage，或在终端执行下方命令启动：',
        ],
        command: `"${filePath}"`,
      };
      this.pushState({ installGuide: guide });
      return guide;
    }

    if (pkgType === 'deb') {
      this.installing = true;
      this.pushState({ status: 'installing', error: null });
      try {
        await this.installDeb(filePath);
        const guide = {
          action: 'deb-installed', platform: 'linux', packageType: 'deb', filePath,
          title: '更新已安装，即将重新启动',
          steps: ['工程已保存，应用将自动重新启动以使用新版本。'],
        };
        this.pushState({ installGuide: guide });
        this.restartApp();
        return guide;
      } catch (error) {
        this.installing = false;
        this.pushState({ status: 'downloaded', error: error.message });
        throw error;
      }
    }

    this.showItemInFolder(filePath);
    const guide = {
      action: 'targz-ready',
      platform: 'linux',
      packageType: 'tar.gz',
      filePath,
      title: 'Linux 归档包 (.tar.gz) 已下载完成',
      steps: ['已在文件管理器中定位该压缩包，您可解压后运行其中的 protoflow-ai 可执行文件：'],
      command: `tar -xzf "${filePath}"`,
    };
    this.pushState({ installGuide: guide });
    return guide;
  }
}

module.exports = {
  DesktopUpdater,
  normalizePlatform,
  normalizeArch,
  normalizeSemver,
  compareSemver,
  sanitizeUpdateFileName,
  isAssetCompatible,
  buildCanonicalAssetManifest,
  verifyAssetManifestSignature,
  signAssetManifest,
};
