/* Alex 官网脚本：设备识别 + 下载列表渲染。无第三方依赖。 */
(() => {
  'use strict';

  const config = Object.assign(
    { updateServer: '', channel: 'stable' },
    window.ALEX_SITE_CONFIG || {},
  );

  const OS_LABEL = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
  const ARCH_LABEL = {
    macos: { arm64: 'Apple Silicon', x64: 'Intel', universal: '通用版' },
    default: { arm64: 'ARM64', x64: 'x64', universal: '通用版' },
  };
  const PACKAGE_LABEL = {
    dmg: '磁盘映像 .dmg',
    zip: '压缩包 .zip',
    exe: '安装程序 .exe',
    deb: 'Debian / Ubuntu .deb',
    appimage: 'AppImage',
    'tar.gz': '压缩包 .tar.gz',
  };
  // Lower = shown first / preferred for recommendation.
  const PACKAGE_RANK = { dmg: 0, exe: 0, deb: 0, appimage: 1, zip: 2, 'tar.gz': 3 };
  const ARCH_RANK = { arm64: 0, universal: 1, x64: 2 };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------------------------------------------------------------------------
  // Device detection
  // ---------------------------------------------------------------------------
  async function detectDevice() {
    const ua = navigator.userAgent || '';
    const uaData = navigator.userAgentData;
    let os = null;
    let arch = null;

    const platform = (uaData && uaData.platform) || navigator.platform || '';
    if (/mac/i.test(platform) || /Macintosh|Mac OS X/.test(ua)) os = 'macos';
    else if (/win/i.test(platform) || /Windows/.test(ua)) os = 'windows';
    else if (/linux/i.test(platform) && !/Android/i.test(ua)) os = 'linux';
    if (/iPhone|iPad|iPod|Android/i.test(ua)) os = null; // mobile: no desktop recommendation

    if (os && uaData && typeof uaData.getHighEntropyValues === 'function') {
      try {
        const v = await uaData.getHighEntropyValues(['architecture', 'bitness']);
        if (v.architecture === 'arm') arch = 'arm64';
        else if (v.architecture === 'x86') arch = 'x64';
      } catch {
        /* ignore */
      }
    }

    // Safari/Firefox on Apple Silicon still report "Intel" in the UA; probe the GPU name.
    if (os === 'macos' && !arch) {
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
        if (/Apple (M\d|GPU)/i.test(renderer)) arch = 'arm64';
        else if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) arch = 'x64';
      } catch {
        /* ignore */
      }
    }
    // Unknown architecture is not evidence for a specific installer.
    if (os !== 'macos' && !arch) {
      if (/aarch64|arm64/i.test(ua)) arch = 'arm64';
      else if (/x86_64|Win64|x64|amd64/i.test(ua)) arch = 'x64';
    }
    return { os, arch };
  }

  // ---------------------------------------------------------------------------
  // Data sources
  // ---------------------------------------------------------------------------
  function safeUrl(raw, base) {
    if (!raw) return null;
    try {
      const url = new URL(raw, base || document.baseURI);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function normalizeAsset(a, release, base) {
    if (!a || a.approved !== true || typeof a.signature !== 'string' || !a.signature) {
      throw new Error('公开安装包缺少发布确认');
    }
    if (typeof a.id !== 'string' || !a.id || a.releaseId !== release.id || a.channel !== release.channel ||
        !Object.hasOwn(OS_LABEL, a.os) || !['x64', 'arm64', 'universal'].includes(a.arch) ||
        typeof a.packageType !== 'string' || !Object.hasOwn(PACKAGE_LABEL, a.packageType.toLowerCase()) ||
        typeof a.fileName !== 'string' || !a.fileName || typeof a.hosted !== 'boolean' ||
        !Number.isSafeInteger(a.sizeBytes) || a.sizeBytes <= 0 ||
        typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(a.sha256)) {
      throw new Error('公开安装包数据不完整');
    }
    if (typeof a.downloadUrl !== 'string' || !safeUrl(a.downloadUrl, base)) {
      throw new Error('公开安装包下载地址无效');
    }
    // Hosted downloads use the documented asset-ID endpoint through the same
    // public proxy as discovery. External assets keep their published URL.
    const url = a.hosted
      ? new URL(`/api/v1/updates/assets/${encodeURIComponent(a.id)}/download`, base).href
      : safeUrl(a.downloadUrl, base);
    return {
      os: a.os,
      arch: a.arch,
      packageType: a.packageType.toLowerCase(),
      fileName: a.fileName,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
      version: release.version,
      url,
    };
  }

  async function fetchJson(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fromUpdateServer() {
    if (typeof config.updateServer !== 'string' || !['stable', 'beta'].includes(config.channel)) {
      throw new Error('版本服务配置无效');
    }
    const base = config.updateServer === '' ? location.origin : config.updateServer.replace(/\/+$/, '');
    if (!safeUrl(base) || new URL(base).origin !== base) throw new Error('版本服务地址无效');
    const url = `${base}/api/v1/updates?channel=${encodeURIComponent(config.channel)}`;
    const data = await fetchJson(url);
    if (!data || !Array.isArray(data.items) ||
        (data.items.length === 0 ? data.latest !== null :
          !data.latest || data.latest.id !== data.items[0].id || data.latest.version !== data.items[0].version)) {
      throw new Error('版本列表格式无效');
    }
    const platforms = {};
    // The public API orders releases by descending semantic version. Pick one
    // published release per OS so staggered platform releases keep their own version.
    const releases = data.items.map((release) => {
      if (!release || typeof release.id !== 'string' || !release.id || release.published !== true ||
          !(release.channel === config.channel || (config.channel === 'beta' && release.channel === 'stable')) ||
          typeof release.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(release.version) ||
          typeof release.publishedAt !== 'string' || !formatDate(release.publishedAt) || !Array.isArray(release.assets)) {
        throw new Error('已发布版本数据无效');
      }
      return { version: release.version, publishedAt: release.publishedAt,
        assets: release.assets.map((a) => normalizeAsset(a, release, base)) };
    });
    for (const release of releases) {
      for (const os of Object.keys(OS_LABEL)) {
        const assets = release.assets.filter((a) => a.os === os);
        if (!platforms[os] && assets.length) platforms[os] = { ...release, assets };
      }
    }
    return { status: 'ready', latest: releases[0] ?? null, platforms };
  }

  async function loadRelease() {
    try {
      return await fromUpdateServer();
    } catch (err) {
      console.info('[Alex] 版本服务不可用：', err && err.message);
      return { status: 'error', latest: null, platforms: {} };
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function formatSize(bytes) {
    if (!bytes) return '';
    const mb = bytes / 1024 / 1024;
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
  }

  function formatDate(raw) {
    const d = raw ? new Date(raw) : null;
    if (!d || Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return '';
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
  }

  function archLabel(os, arch) {
    return (ARCH_LABEL[os] || ARCH_LABEL.default)[arch] || arch;
  }

  function sortAssets(list) {
    return list.slice().sort(
      (a, b) =>
        (ARCH_RANK[a.arch] ?? 9) - (ARCH_RANK[b.arch] ?? 9) ||
        (PACKAGE_RANK[a.packageType] ?? 9) - (PACKAGE_RANK[b.packageType] ?? 9),
    );
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function assetItem(asset) {
    const li = el('li');
    const a = el('a', 'asset');
    a.href = asset.url;
    a.setAttribute('download', '');
    a.rel = 'noopener';

    const main = el('span', 'asset-main');
    const name = `v${asset.version} · ${archLabel(asset.os, asset.arch)} · ${PACKAGE_LABEL[asset.packageType]}`;
    main.append(el('span', 'asset-name', name));
    const metaParts = [formatSize(asset.sizeBytes), asset.fileName].filter(Boolean);
    const meta = el('span', 'asset-meta', metaParts.join(' · '));
    if (asset.sha256) {
      meta.title = `SHA-256: ${asset.sha256}`;
    }
    main.append(meta);

    a.append(main, el('span', 'asset-cta', '下载'));
    li.append(a);
    return li;
  }

  function unavailableItem(os, status) {
    const li = el('li');
    const box = el('div', 'asset unavailable');
    const main = el('span', 'asset-main');
    main.append(el('span', 'asset-name', status === 'error' ? '下载信息暂不可用' : `${OS_LABEL[os]} 安装包暂未发布`));
    main.append(el('span', 'asset-meta', status === 'error' ? '请重试加载版本信息' : '发布后将在这里提供下载'));
    const cta = el('a', 'asset-cta', '联系');
    cta.href = `mailto:${config.contactEmail || ''}?subject=${encodeURIComponent(`申请 Alex ${OS_LABEL[os]} 安装包`)}`;
    box.append(main, cta);
    li.append(box);
    return li;
  }

  function renderSkeleton() {
    for (const card of $$('.platform')) {
      const list = $('[data-assets]', card);
      list.replaceChildren(...[0, 1].map(() => el('li', 'asset skeleton')));
    }
  }

  function renderPlatforms(catalog) {
    for (const card of $$('.platform')) {
      const os = card.dataset.os;
      const list = $('[data-assets]', card);
      const release = catalog.platforms[os];
      const assets = release ? sortAssets(release.assets) : [];
      list.replaceChildren(...(assets.length ? assets.map(assetItem) : [unavailableItem(os, catalog.status)]));
      $('.p-tip', card).hidden = !assets.length;
    }
  }

  function pickRecommended(release, device) {
    if (!release || !device.os || !device.arch) return null;
    const candidates = release.assets.filter((a) => a.os === device.os);
    const score = (a) => {
      let s = 0;
      if (a.arch === device.arch) s += 100;
      else if (a.arch === 'universal') s += 80;
      else if (device.arch === 'arm64' && a.arch === 'x64' && device.os !== 'linux') s += 40;
      else return -1;
      return s - (PACKAGE_RANK[a.packageType] ?? 9) * 5;
    };
    return candidates
      .map((a) => ({ a, s: score(a) }))
      .filter((x) => x.s >= 0)
      .sort((x, y) => y.s - x.s)[0]?.a || null;
  }

  function renderRelease(catalog, device) {
    const release = catalog.latest;
    for (const node of $$('[data-version]')) {
      node.textContent = release ? `v${release.version}` : catalog.status === 'error' ? '暂不可用' : '暂无发布';
    }

    const date = release && formatDate(release.publishedAt);
    $('[data-release-date]').textContent = date ? `· 发布于 ${date}` : '';
    $('[data-source-note]').textContent = catalog.status === 'error'
      ? '· 版本信息加载失败，请重试'
      : release ? '· 与版本中心同步，各平台可下载版本见下方' : '· 正式发布后将在这里提供下载';
    const actions = $('[data-release-actions]');
    actions.replaceChildren();
    if (catalog.status === 'error') {
      const retry = el('button', 'btn btn-quiet btn-sm', '重新加载');
      retry.type = 'button';
      retry.addEventListener('click', () => refreshRelease(device));
      actions.append(retry);
    }

    if (device.os) {
      const card = $(`.platform[data-os="${device.os}"]`);
      if (card) card.classList.add('is-current');
    }

    const rec = pickRecommended(catalog.platforms[device.os], device);
    const recBox = $('[data-recommend]');
    const primary = $('[data-primary-download]');
    const primaryLabel = $('[data-primary-label]');

    recBox.hidden = !rec;
    primaryLabel.textContent = '查看下载';
    $('[data-recommend-link]').removeAttribute('href');
    if (rec) {
      const title = `${OS_LABEL[rec.os]} · ${archLabel(rec.os, rec.arch)}`;
      $('[data-recommend-title]').textContent = title;
      $('[data-recommend-meta]').textContent = [
        `v${rec.version}`,
        PACKAGE_LABEL[rec.packageType] || rec.packageType,
        formatSize(rec.sizeBytes),
        rec.sha256 ? `SHA-256 ${rec.sha256.slice(0, 12)}…` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const link = $('[data-recommend-link]');
      link.href = rec.url;
      link.setAttribute('download', '');
      link.textContent = `下载 ${OS_LABEL[rec.os]} 版`;
      recBox.hidden = false;

      primaryLabel.textContent = `下载 ${OS_LABEL[rec.os]} 版`;
    }
    // The hero button always scrolls to the download section so users can
    // review the options; the direct link lives in the recommendation card.
    primary.href = '#download';
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function refreshRelease(device) {
    $('[data-release-actions]').replaceChildren();
    $('[data-recommend]').hidden = true;
    $('[data-recommend-link]').removeAttribute('href');
    for (const node of $$('[data-version]')) node.textContent = '版本加载中';
    $('[data-release-date]').textContent = '';
    $('[data-source-note]').textContent = '';
    renderSkeleton();
    const catalog = await loadRelease();
    renderPlatforms(catalog);
    renderRelease(catalog, device);
  }

  async function init() {
    const year = $('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
    if (config.repoUrl) {
      const repo = $('[data-repo-link]');
      if (repo) repo.href = config.repoUrl;
    }

    const device = await detectDevice();
    await refreshRelease(device);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
