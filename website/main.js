/* Alex 官网脚本：双语切换 + 设备识别 + 下载列表渲染。无第三方依赖。 */
(() => {
  'use strict';

  const config = Object.assign(
    { updateServer: '', channel: 'stable' },
    window.ALEX_SITE_CONFIG || {},
  );

  const LOCALE_STORAGE_KEY = 'protoflow-locale';
  const OS_LABEL = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
  const PACKAGE_KEYS = ['dmg', 'zip', 'exe', 'deb', 'appimage', 'tar.gz'];
  // Lower = shown first / preferred for recommendation.
  const PACKAGE_RANK = { dmg: 0, exe: 0, deb: 0, appimage: 1, zip: 2, 'tar.gz': 3 };
  const ARCH_RANK = { arm64: 0, universal: 1, x64: 2 };

  const $ = (sel, root = document) => (root && root.querySelector ? root.querySelector(sel) : null);
  const $$ = (sel, root = document) => (root && root.querySelectorAll ? Array.from(root.querySelectorAll(sel)) : []);

  // ---------------------------------------------------------------------------
  // Bilingual i18n (zh-CN & en-US)
  // ---------------------------------------------------------------------------
  const EN_META = {
    title: 'Alex — Turn Requirements into Working Business Prototypes',
    description:
      'Alex is a desktop prototyping tool: describe your business to plan pages and database tables with Project AI, refine desktop and mobile screens on canvas, bind shared tables for real data flow, and publish interactive online demos. Available for macOS, Windows, and Linux.',
    ogTitle: 'Alex — Turn Requirements into Working Business Prototypes',
    ogDescription: 'Clickable, fillable prototypes with real data flow.',
  };

  const EN_TEXT = {
    skip: 'Skip to content',
    'nav.aria': 'Primary',
    'nav.brandAria': 'Alex home',
    'nav.features': 'Features',
    'nav.workflow': 'Workflow',
    'nav.models': 'Models',
    'nav.download': 'Download',
    'nav.faq': 'FAQ',

    'hero.desktop': 'Desktop',
    'hero.title': 'Turn requirements into<br />prototypes that actually run',
    'hero.lead':
      'Describe your business and let Alex plan modules, pages, and database tables. Refine desktop admin and mobile screens on the canvas, bind shared tables so forms, lists, and approvals work end to end, and share a live link for team review.',
    'hero.primaryCta': 'Free Download',
    'hero.secondaryCta': 'Explore Features',

    'mockup.aria': 'Alex application interface preview',
    'mk.tab1': 'Canvas',
    'mk.tab2': 'Database',
    'mk.tab3': 'Cross-Module Flow',
    'mk.tab4': 'Mindmaps',
    'mk.title': 'Procurement System',
    'mk.pagesLabel': 'Pages',
    'mk.folder1': 'Suppliers',
    'mk.page1': 'Supplier List',
    'mk.folder2': 'Procurement',
    'mk.page2': 'Purchase Orders',
    'mk.page3': 'Approvals',
    'mk.folder3': 'Warehouse',
    'mk.page4': 'Goods Receipt',
    'mk.page5': 'Scan Inbound <em>Mobile</em>',
    'mk.tablesLabel': 'Tables',
    'mk.pageHead': 'Purchase Orders',
    'mk.newOrder': 'New Order',
    'mk.qOrderNo': 'Order No.',
    'mk.qSupplier': 'Supplier',
    'mk.qStatus': 'Status',
    'mk.qSearch': 'Search',
    'mk.thOrderNo': 'Order No.',
    'mk.thSupplier': 'Supplier',
    'mk.thAmount': 'Amount',
    'mk.thStatus': 'Status',
    'mk.r1Vendor': 'Aurora Digital',
    'mk.r1Amt': '$48,200',
    'mk.statusApproved': 'Approved',
    'mk.r2Vendor': 'Sinolink Tech',
    'mk.r2Amt': '$12,860',
    'mk.statusPending': 'Pending',
    'mk.r3Vendor': 'Voyage Pack',
    'mk.r3Amt': '$6,540',
    'mk.statusDraft': 'Draft',
    'mk.aiLabel': 'Project AI',
    'mk.aiUser': 'Build a procurement system with suppliers, purchase approvals, and a mobile scan-to-stock page',
    'mk.aiBotLead': 'Planned <b>3 modules, 6 pages, and 4 shared tables</b>:',
    'mk.aiBotItem1': 'Supplier List (Desktop)',
    'mk.aiBotItem2': 'Purchase Orders & Approvals',
    'mk.aiBotItem3': 'Scan Inbound (Mobile)',
    'mk.aiConfirm': 'Confirm & Generate',

    'facts.aria': 'Key highlights',
    'fact.1.title': 'Desktop & Mobile',
    'fact.1.desc': 'Designed in one project',
    'fact.2.title': 'Shared Tables',
    'fact.2.desc': 'Live data across screens',
    'fact.3.title': '15+ AI Providers',
    'fact.3.desc': 'Cloud or local Ollama',
    'fact.4.title': 'Local-First Data',
    'fact.4.desc': 'Only published demos upload',

    'features.kicker': 'Features',
    'features.title': 'From a plain-language brief to a review-ready system prototype',
    'features.desc':
      'Clarify requirements, design screens, model tables, connect workflows, and publish for review — all in one project.',
    'f1.title': 'Project AI Planning',
    'f1.desc':
      'Describe your business in plain language. AI asks clarifying questions first, proposes modules, pages, and database tables, and generates only after you confirm.',
    'f2.title': 'Canvas & Material Library',
    'f2.desc':
      'Widescreen grids, multi-column filters, data tables, ECharts visualizations, composite blocks, and page templates — drag and drop to assemble enterprise interfaces.',
    'f3.title': 'Database & Shared-Table Sync',
    'f3.desc':
      'Design physical schemas and relations, then bind pages directly to tables. Records created, edited, or approved stay in sync across every screen.',
    'f4.title': 'Desktop & Mobile Together',
    'f4.desc':
      'Design admin consoles and mobile or mini-app screens side by side with iPhone viewports and touch components, all backed by the same dataset.',
    'f5.title': 'Cross-Module Flow & Impact Analysis',
    'f5.desc':
      'Map how business records move across modules. Change a table or column and immediately see every affected page and workflow.',
    'f6.title': 'Requirement Audit & Acceptance',
    'f6.desc':
      'Pin requirement sticky notes directly onto components, audit implementation coverage, and verify item by item during review.',
    'f7.title': 'Project Notes & Mindmaps',
    'f7.desc':
      'Split-screen notes, Mermaid diagram templates, and mindmaps keep meeting minutes, domain models, and prototypes together in one workspace.',
    'f8.title': 'Online Demo Publishing',
    'f8.desc':
      'Publish to your team server to share an interactive browser link, or export local project archives for backup.',

    'd1.kicker': 'Runnable Prototypes',
    'd1.title': 'Not just drawn —<br />built to run',
    'd1.desc': 'Static mockups only show flat pictures. In Alex, screens bind to real relational table schemas:',
    'd1.c1': 'Orders submitted in "New Order" appear immediately in the order list',
    'd1.c2': 'Approved statuses sync straight to the mobile to-do queue',
    'd1.c3': 'Master-detail queries and approval state transitions work out of the box',
    'd1.c4': 'Walk stakeholders through complete business loops without hand-waving',
    'd1.fn1Title': 'New Order',
    'd1.fn1Sub': 'Desktop · Form',
    'd1.fn2Sub': 'Shared Table',
    'd1.fn3Title': 'Pending Approvals',
    'd1.fn3Sub': 'Mobile · List',

    'd2.kicker': 'AI Collaboration',
    'd2.title': 'Ask first,<br />build second',
    'd2.desc': 'Powered by the built-in Hermes engine with full context across pages, components, tables, and sticky notes:',
    'd2.c1': 'Asks clarifying questions when requirements are ambiguous instead of guessing',
    'd2.c2': 'Proposes a structured plan first and generates only after confirmation',
    'd2.c3': 'Edits targeted sections of a page without breaking existing layouts',
    'd2.c4': 'Switch models and reasoning effort levels whenever needed',
    'd2.b1': 'In "Purchase Approval", what amount triggers second-level approval?',
    'd2.b2': 'Orders over $50,000 require CFO approval',
    'd2.b3': 'Added the "CFO Approval" step to the workflow and added <code>approve_level</code> to purchase_order.',

    'd3.kicker': 'Publish & Update',
    'd3.title': 'One link is all<br />your team needs',
    'd3.desc': 'Publish prototypes to your LAN or team server so teammates can review them in any browser with zero setup:',
    'd3.c1': 'Publishes pages, requirement notes, and the full sitemap together',
    'd3.c2': 'Supports link expiration dates and password-protected access',
    'd3.c3': 'Built-in one-click desktop updates verified by digital signatures',
    'd3.published': 'Published',
    'd3.m1': '6 pages',
    'd3.m2': 'Expires in 7 days',
    'd3.m3': 'Password protected',

    'wf.kicker': 'Workflow',
    'wf.title': 'Five steps to a complete requirement review',
    'wf.s1Title': 'Describe',
    'wf.s1Desc': 'Start from a template or blank project and tell AI what you need.',
    'wf.s2Title': 'Confirm Plan',
    'wf.s2Desc': 'AI clarifies details and proposes modules, pages, and database tables.',
    'wf.s3Title': 'Refine on Canvas',
    'wf.s3Desc': 'Polish layouts, copy, and interactions with components and composite blocks.',
    'wf.s4Title': 'Connect Data',
    'wf.s4Desc': 'Bind shared tables and verify cross-module flows and schema impact.',
    'wf.s5Title': 'Publish & Review',
    'wf.s5Desc': 'Share an interactive online demo for your team to test and sign off in the browser.',

    'ai.kicker': 'Models',
    'ai.title': 'Use the models you already trust',
    'ai.desc':
      'Configure accounts and models in the AI Management Center — connect leading cloud providers or run local models via Ollama. The canvas and database tools also work standalone without AI.',
    'ai.listAria': 'Supported model providers',
    'ai.qwen': 'Qwen',
    'ai.zai': 'Z.ai (GLM)',
    'ai.ollama': 'Ollama (Local)',
    'ai.fine': 'Brand icons courtesy of LobeHub Icons (MIT). All trademarks belong to their respective owners.',

    'dl.kicker': 'Download',
    'dl.title': 'Download Alex',
    'dl.latestPrefix': 'Latest release',
    'dl.recKicker': 'Recommended for your device',
    'dl.macReq': 'macOS 13 or later',
    'dl.yourOs': 'Your OS',
    'dl.macTip':
      'Open the .dmg and drag Alex to Applications. If macOS says the developer cannot be verified on first launch, go to System Settings → Privacy & Security and click "Open Anyway".',
    'dl.winTip':
      'Run the installer to choose an install folder and create shortcuts. If Windows SmartScreen appears, click "More info → Run anyway".',
    'dl.linuxTip':
      'Recommended .deb: <code>sudo apt install ./Alex-*-linux-amd64.deb</code> — supports one-click in-app updates afterward.',
    'dl.fine':
      'Every installer includes a SHA-256 checksum. After installation, check and apply digitally signed updates with one click in Updates.',

    'faq.kicker': 'FAQ',
    'faq.title': 'Questions & Answers',
    'faq.contact': 'Still have questions? Email <a class="text-link" href="mailto:ai.agent.club@gmail.com">ai.agent.club@gmail.com</a>.',
    'faq.q1': 'Who is Alex built for?',
    'faq.a1':
      'Product managers, business analysts, solution consultants, and frontend engineers — especially teams building admin consoles, mobile approvals, or barcode workflows who want to demonstrate complete business loops during reviews.',
    'faq.q2': 'Where is my project data stored?',
    'faq.a2':
      'Projects are saved as local files on your computer and can be exported for backup. Data is uploaded to your configured server only when you explicitly publish an online demo.',
    'faq.q3': 'What do I need to use Project AI?',
    'faq.a3':
      'Sign in or configure your own model accounts (such as Claude, Gemini, OpenAI, DeepSeek, or Qwen) in the in-app AI Management Center, or connect local models via Ollama. The canvas and database features also work independently without AI.',
    'faq.q4': 'How do I update to a new version?',
    'faq.a4':
      'Open "Updates" inside the app and click "Check for Updates → Update Now". Alex automatically selects the right installer for your OS, verifies its digital signature and SHA-256 digest, saves your project, and restarts.',
    'faq.q5': 'What if macOS says "developer cannot be verified"?',
    'faq.a5':
      'Open System Settings → Privacy & Security, scroll down to find Alex, and click "Open Anyway" — or right-click Alex in Applications and choose "Open". You only need to do this once.',
    'faq.q6': 'Should I download Apple Silicon or Intel for my Mac?',
    'faq.a6':
      'Click the Apple menu in the top-left corner → "About This Mac". Choose Apple Silicon (arm64) for Apple M-series chips, or Intel (x64) for Intel processors. This page also recommends the matching build automatically when possible.',

    'cta.title': 'Make your prototypes<br />run today',
    'cta.desc': 'Download Alex for free and build your first working business prototype in minutes.',
    'cta.btn': 'Free Download',

    'footer.aria': 'Footer',
    'footer.contact': 'Contact Us',
  };

  function readSavedLocale() {
    try {
      const saved = window.localStorage && window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === 'zh-CN' || saved === 'en-US') return saved;
    } catch {
      /* ignore storage errors */
    }
    return null;
  }

  function hasExplicitOrRealBrowserLocale() {
    if (typeof navigator === 'undefined' || !navigator) return false;
    if (Object.hasOwn(navigator, 'language') || Object.hasOwn(navigator, 'languages')) {
      return true;
    }
    try {
      const probe = document.createElement('canvas');
      return Boolean(probe && typeof probe.getContext === 'function' && probe.getContext('2d'));
    } catch {
      return false;
    }
  }

  function detectInitialLocale() {
    const saved = readSavedLocale();
    if (saved) return saved;
    if (!hasExplicitOrRealBrowserLocale()) {
      const docLang = (document.documentElement && document.documentElement.lang) || 'zh-CN';
      return /^en\b/i.test(docLang) ? 'en-US' : 'zh-CN';
    }
    const langs = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
    const primary = langs.find((l) => typeof l === 'string' && l.trim());
    if (!primary) return 'zh-CN';
    return /^zh\b/i.test(primary.trim()) ? 'zh-CN' : 'en-US';
  }

  let currentLocale = detectInitialLocale();
  const isEn = () => currentLocale === 'en-US';
  const tr = (zh, en) => (isEn() ? en : zh);

  let zhSnapshot = null;
  function captureInitialZhDom() {
    if (zhSnapshot) return;
    const descMeta = $('meta[name="description"]');
    const ogTitleMeta = $('meta[property="og:title"]');
    const ogDescMeta = $('meta[property="og:description"]');
    zhSnapshot = {
      title: document.title,
      description: descMeta ? descMeta.getAttribute('content') : '',
      ogTitle: ogTitleMeta ? ogTitleMeta.getAttribute('content') : '',
      ogDescription: ogDescMeta ? ogDescMeta.getAttribute('content') : '',
      texts: $$('[data-i18n]').map((node) => ({ node, key: node.dataset.i18n, zh: node.textContent })),
      htmls: $$('[data-i18n-html]').map((node) => ({ node, key: node.dataset.i18nHtml, zh: node.innerHTML })),
      arias: $$('[data-i18n-aria]').map((node) => ({ node, key: node.dataset.i18nAria, zh: node.getAttribute('aria-label') || '' })),
    };
  }

  function applyStaticLocale() {
    captureInitialZhDom();
    const en = isEn();
    if (document.documentElement) {
      document.documentElement.lang = en ? 'en' : 'zh-CN';
    }
    document.title = en ? EN_META.title : zhSnapshot.title;
    const descMeta = $('meta[name="description"]');
    if (descMeta) descMeta.setAttribute('content', en ? EN_META.description : zhSnapshot.description);
    const ogTitleMeta = $('meta[property="og:title"]');
    if (ogTitleMeta) ogTitleMeta.setAttribute('content', en ? EN_META.ogTitle : zhSnapshot.ogTitle);
    const ogDescMeta = $('meta[property="og:description"]');
    if (ogDescMeta) ogDescMeta.setAttribute('content', en ? EN_META.ogDescription : zhSnapshot.ogDescription);

    for (const item of zhSnapshot.texts) {
      // Dynamic primary download label is controlled by renderRelease once loaded.
      if (item.node.hasAttribute('data-primary-label') && lastCatalog) continue;
      if (item.node.hasAttribute('data-recommend-link') && lastCatalog) continue;
      if (en && EN_TEXT[item.key] != null) item.node.textContent = EN_TEXT[item.key];
      else item.node.textContent = item.zh;
    }
    for (const item of zhSnapshot.htmls) {
      if (en && EN_TEXT[item.key] != null) item.node.innerHTML = EN_TEXT[item.key];
      else item.node.innerHTML = item.zh;
    }
    for (const item of zhSnapshot.arias) {
      if (en && EN_TEXT[item.key] != null) item.node.setAttribute('aria-label', EN_TEXT[item.key]);
      else item.node.setAttribute('aria-label', item.zh);
    }

    const toggle = $('[data-lang-toggle]');
    if (toggle) {
      if (en) {
        toggle.textContent = '中文';
        toggle.setAttribute('lang', 'zh-CN');
        toggle.setAttribute('aria-label', '中文 — 切换到中文');
      } else {
        toggle.textContent = 'EN';
        toggle.setAttribute('lang', 'en');
        toggle.setAttribute('aria-label', 'EN — Switch to English');
      }
    }
  }

  function packageLabel(pkg) {
    const labels = isEn()
      ? {
          dmg: 'Disk Image .dmg',
          zip: 'Archive .zip',
          exe: 'Installer .exe',
          deb: 'Debian / Ubuntu .deb',
          appimage: 'AppImage',
          'tar.gz': 'Archive .tar.gz',
        }
      : {
          dmg: '磁盘映像 .dmg',
          zip: '压缩包 .zip',
          exe: '安装程序 .exe',
          deb: 'Debian / Ubuntu .deb',
          appimage: 'AppImage',
          'tar.gz': '压缩包 .tar.gz',
        };
    return labels[pkg] || pkg;
  }

  function archLabel(os, arch) {
    const table = isEn()
      ? {
          macos: { arm64: 'Apple Silicon', x64: 'Intel', universal: 'Universal' },
          default: { arm64: 'ARM64', x64: 'x64', universal: 'Universal' },
        }
      : {
          macos: { arm64: 'Apple Silicon', x64: 'Intel', universal: '通用版' },
          default: { arm64: 'ARM64', x64: 'x64', universal: '通用版' },
        };
    return (table[os] || table.default)[arch] || arch;
  }

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
      throw new Error(tr('公开安装包缺少发布确认', 'Public installer is missing release approval'));
    }
    if (typeof a.id !== 'string' || !a.id || a.releaseId !== release.id || a.channel !== release.channel ||
        !Object.hasOwn(OS_LABEL, a.os) || !['x64', 'arm64', 'universal'].includes(a.arch) ||
        typeof a.packageType !== 'string' || !PACKAGE_KEYS.includes(a.packageType.toLowerCase()) ||
        typeof a.fileName !== 'string' || !a.fileName || typeof a.hosted !== 'boolean' ||
        !Number.isSafeInteger(a.sizeBytes) || a.sizeBytes <= 0 ||
        typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(a.sha256)) {
      throw new Error(tr('公开安装包数据不完整', 'Public installer metadata is incomplete'));
    }
    if (typeof a.downloadUrl !== 'string' || !safeUrl(a.downloadUrl, base)) {
      throw new Error(tr('公开安装包下载地址无效', 'Public installer download URL is invalid'));
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
      throw new Error(tr('版本服务配置无效', 'Invalid release server configuration'));
    }
    const base = config.updateServer === '' ? location.origin : config.updateServer.replace(/\/+$/, '');
    if (!safeUrl(base) || new URL(base).origin !== base) {
      throw new Error(tr('版本服务地址无效', 'Invalid release server URL'));
    }
    const url = `${base}/api/v1/updates?channel=${encodeURIComponent(config.channel)}`;
    const data = await fetchJson(url);
    if (!data || !Array.isArray(data.items) ||
        (data.items.length === 0 ? data.latest !== null :
          !data.latest || data.latest.id !== data.items[0].id || data.latest.version !== data.items[0].version)) {
      throw new Error(tr('版本列表格式无效', 'Invalid release list format'));
    }
    const platforms = {};
    // The public API orders releases by descending semantic version. Pick one
    // published release per OS so staggered platform releases keep their own version.
    const releases = data.items.map((release) => {
      if (!release || typeof release.id !== 'string' || !release.id || release.published !== true ||
          !(release.channel === config.channel || (config.channel === 'beta' && release.channel === 'stable')) ||
          typeof release.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(release.version) ||
          typeof release.publishedAt !== 'string' || !formatDate(release.publishedAt) || !Array.isArray(release.assets)) {
        throw new Error(tr('已发布版本数据无效', 'Invalid published release data'));
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
      console.info(tr('[Alex] 版本服务不可用：', '[Alex] Release service unavailable:'), err && err.message);
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
    return new Intl.DateTimeFormat(isEn() ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
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
    const name = `v${asset.version} · ${archLabel(asset.os, asset.arch)} · ${packageLabel(asset.packageType)}`;
    main.append(el('span', 'asset-name', name));
    const metaParts = [formatSize(asset.sizeBytes), asset.fileName].filter(Boolean);
    const meta = el('span', 'asset-meta', metaParts.join(' · '));
    if (asset.sha256) {
      meta.title = `SHA-256: ${asset.sha256}`;
    }
    main.append(meta);

    a.append(main, el('span', 'asset-cta', tr('下载', 'Download')));
    li.append(a);
    return li;
  }

  function unavailableItem(os, status) {
    const li = el('li');
    const box = el('div', 'asset unavailable');
    const main = el('span', 'asset-main');
    main.append(
      el(
        'span',
        'asset-name',
        status === 'error'
          ? tr('下载信息暂不可用', 'Download info unavailable')
          : tr(`${OS_LABEL[os]} 安装包暂未发布`, `No ${OS_LABEL[os]} installer published yet`),
      ),
    );
    main.append(
      el(
        'span',
        'asset-meta',
        status === 'error'
          ? tr('请重试加载版本信息', 'Please retry loading release info')
          : tr('发布后将在这里提供下载', 'Downloads will appear here once published'),
      ),
    );
    const cta = el('a', 'asset-cta', tr('联系', 'Contact'));
    const subject = tr(`申请 Alex ${OS_LABEL[os]} 安装包`, `Request Alex ${OS_LABEL[os]} installer`);
    cta.href = `mailto:${config.contactEmail || ''}?subject=${encodeURIComponent(subject)}`;
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
      node.textContent = release
        ? `v${release.version}`
        : catalog.status === 'error'
          ? tr('暂不可用', 'Unavailable')
          : tr('暂无发布', 'No release yet');
    }

    const date = release && formatDate(release.publishedAt);
    $('[data-release-date]').textContent = date ? tr(`· 发布于 ${date}`, `· Released ${date}`) : '';
    $('[data-source-note]').textContent = catalog.status === 'error'
      ? tr('· 版本信息加载失败，请重试', '· Failed to load release info. Please retry.')
      : release
        ? tr('· 与版本中心同步，各平台可下载版本见下方', '· Synced with Release Center. Platform installers are listed below.')
        : tr('· 正式发布后将在这里提供下载', '· Installers will appear here once officially published.');
    const actions = $('[data-release-actions]');
    actions.replaceChildren();
    if (catalog.status === 'error') {
      const retry = el('button', 'btn btn-quiet btn-sm', tr('重新加载', 'Reload'));
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
    primaryLabel.textContent = tr('查看下载', 'View Downloads');
    $('[data-recommend-link]').removeAttribute('href');
    if (rec) {
      const title = `${OS_LABEL[rec.os]} · ${archLabel(rec.os, rec.arch)}`;
      $('[data-recommend-title]').textContent = title;
      $('[data-recommend-meta]').textContent = [
        `v${rec.version}`,
        packageLabel(rec.packageType),
        formatSize(rec.sizeBytes),
        rec.sha256 ? `SHA-256 ${rec.sha256.slice(0, 12)}…` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const dlText = tr(`下载 ${OS_LABEL[rec.os]} 版`, `Download for ${OS_LABEL[rec.os]}`);
      const link = $('[data-recommend-link]');
      link.href = rec.url;
      link.setAttribute('download', '');
      link.textContent = dlText;
      recBox.hidden = false;

      primaryLabel.textContent = dlText;
    }
    // The hero button always scrolls to the download section so users can
    // review the options; the direct link lives in the recommendation card.
    primary.href = '#download';
  }

  // ---------------------------------------------------------------------------
  // Boot & Language Switching
  // ---------------------------------------------------------------------------
  let currentDevice = { os: null, arch: null };
  let lastCatalog = null;

  function setLocale(nextLocale) {
    currentLocale = nextLocale === 'en-US' ? 'en-US' : 'zh-CN';
    try {
      if (window.localStorage) window.localStorage.setItem(LOCALE_STORAGE_KEY, currentLocale);
    } catch {
      /* ignore storage errors */
    }
    applyStaticLocale();
    if (lastCatalog) {
      renderPlatforms(lastCatalog);
      renderRelease(lastCatalog, currentDevice);
    } else {
      for (const node of $$('[data-version]')) {
        node.textContent = tr('版本加载中', 'Loading version');
      }
    }
  }

  async function refreshRelease(device) {
    lastCatalog = null;
    $('[data-release-actions]').replaceChildren();
    $('[data-recommend]').hidden = true;
    $('[data-recommend-link]').removeAttribute('href');
    for (const node of $$('[data-version]')) node.textContent = tr('版本加载中', 'Loading version');
    $('[data-release-date]').textContent = '';
    $('[data-source-note]').textContent = '';
    renderSkeleton();
    const catalog = await loadRelease();
    lastCatalog = catalog;
    renderPlatforms(catalog);
    renderRelease(catalog, device);
  }

  async function init() {
    applyStaticLocale();
    const toggle = $('[data-lang-toggle]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        setLocale(isEn() ? 'zh-CN' : 'en-US');
      });
    }
    const year = $('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
    if (config.repoUrl) {
      const repo = $('[data-repo-link]');
      if (repo) repo.href = config.repoUrl;
    }

    currentDevice = await detectDevice();
    await refreshRelease(currentDevice);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
