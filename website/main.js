/* ProtoFlow AI（原名 Alex）官网脚本：双语切换 + 响应式导航 + Showcase Tabs + 设备识别 + 下载渲染。零第三方依赖。 */
(() => {
  'use strict';

  const config = Object.assign(
    // Older self-hosted config files predate releaseSource/discordUrl/demoUrl and use the release center.
    { releaseSource: 'release-center', updateServer: '', channel: 'stable', discordUrl: '', demoUrl: '' },
    window.ALEX_SITE_CONFIG || {},
  );

  const LOCALE_STORAGE_KEY = 'protoflow-locale';
  const OS_LABEL = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
  const PACKAGE_KEYS = ['dmg', 'zip', 'exe', 'deb', 'appimage', 'tar.gz'];
  // Lower = shown first / preferred for recommendation.
  const PACKAGE_RANK = { dmg: 0, exe: 0, deb: 0, appimage: 1, zip: 2, 'tar.gz': 3 };
  const ARCH_RANK = { arm64: 0, universal: 1, x64: 2 };
  const githubRepository = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/?$/.exec(config.repoUrl)?.[1];

  const $ = (sel, root = document) => (root && root.querySelector ? root.querySelector(sel) : null);
  const $$ = (sel, root = document) => (root && root.querySelectorAll ? Array.from(root.querySelectorAll(sel)) : []);

  // ---------------------------------------------------------------------------
  // Bilingual i18n (zh-CN & en-US)
  // ---------------------------------------------------------------------------
  const EN_META = {
    title: 'ProtoFlow AI — Open-Source AI Prototyping Workbench That Runs',
    description:
      'ProtoFlow AI (formerly Alex) is an Apache-2.0 local-first AI prototyping tool with shared ER tables, desktop + iPhone sync, Axure .rp import, and MCP.',
    ogTitle: 'ProtoFlow AI — Open-Source AI Prototyping Workbench That Runs',
    ogDescription:
      'Shared ER tables · Clarify-first AI · Desktop & mobile sync · Axure .rp import · Bidirectional MCP for coding agents · Open source.',
  };

  const EN_TEXT = {
    skip: 'Skip to content',
    'nav.brandAria': 'ProtoFlow AI home',
    'nav.brandSub': 'ex-Alex',
    'nav.aria': 'Primary',
    'nav.menu': 'Menu',
    'nav.demo': 'Live Demo',
    'nav.compareLink': 'Compare',
    'nav.axureLink': 'Axure Import',
    'nav.compare': 'Why ProtoFlow',
    'nav.features': 'Capabilities',
    'nav.mcp': 'MCP Bridge',
    'nav.scenarios': 'Templates',
    'nav.models': 'Models',
    'nav.download': 'Download',
    'nav.faq': 'FAQ',
    'nav.githubAria': 'GitHub repository',

    'hero.desktop': 'Desktop',
    'hero.openSource': 'Open Source',
    'hero.localFirst': 'Local-first · No sign-in required',
    'hero.title': 'Open-Source AI Prototyping<br />Turn Specs into Runnable Apps',
    'hero.lead':
      'Shared ER physical tables powering desktop admin + iPhone viewports (with offline Axure .rp import) — paired with a bidirectional MCP canvas and SQL DDL spec hub for Claude Code and Cursor.',
    'hero.primaryCta': 'Free Download',
    'hero.secondaryCta': 'See Live Workbench',
    'hero.sourceCta': 'GitHub Source & Docs →',
    'hero.demoCta': 'Try Live Demo',

    'showcase.tablistAria': 'Product capability perspectives',
    'showcase.srHeading': 'Interactive Workbench & Core Architecture Showcase',
    'sc.tab1': 'Workbench',
    'sc.tab2': 'Shared ER Data Flow',
    'sc.tab3': 'MCP Co-Design & Handoff',
    'sc.tab4': 'Axure .rp Import',
    'sc.imgAlt':
      'ProtoFlow AI desktop workbench screenshot showing the CRM Contracts & Billing suite with shared-table badges on the left, live ECharts and table bound to physical ER tables in the center, sticky specs at the bottom, and bidirectional AST property inspector on the right',
    'sc.hl1': 'Multi-module menu tree with live shared-table badges',
    'sc.hl2': '12 native ECharts & tables bound directly to project data',
    'sc.hl3': 'Bidirectional AST inspector, sticky specs & scoped Ask AI',
    'sc.demoBanner': 'No download needed — explore this 6-page desktop + iPhone CRM prototype live in your browser in 5 seconds.',
    'sc.demoBannerBtn': 'Launch Browser Live Demo →',
    'sc.er1Tag': 'Desktop Admin · Form',
    'sc.er1Title': 'New Sales Contract / Account',
    'sc.er1Desc':
      'Form controls bind directly to table columns and foreign-key lookups, writing real rows and running tax ID and over-billing guards.',
    'sc.er2Tag': 'Shared Physical Table · ER Constraints',
    'sc.er2Desc':
      'Foreign keys to customers, ENUM status machines, and composite unique payment-plan keys with cross-page impact tracking.',
    'sc.er3Tag': 'iPhone Viewport · Mobile',
    'sc.er3Title': 'Mobile Approvals & Invoicing',
    'sc.er3Desc':
      'Backed by the exact same dataset — approving contracts or filing field invoices updates desktop ledgers immediately.',
    'sc.erMobImgAlt':
      'ProtoFlow AI browser sandbox iPhone mobile approval viewport sharing the t_crm_contracts ER table with desktop admin',
    'sc.erMobTitle': 'Real Desktop ↔ Mobile Data Sync in Your Browser',
    'sc.erMobDesc':
      'No separate mobile file required. Forms, tables, ECharts, and iPhone viewports read and write the same ER physical tables inside one .pflow project.',
    'sc.erMobBtn': 'Try Mobile Approvals Live →',
    'sc.mcp1Tag': 'Live Canvas Bridge · Design Time',
    'sc.mcp1Title': 'Let Coding Agents Design Directly on Canvas',
    'sc.mcp1Desc':
      'Enable Bidirectional design in the desktop app so Codex, Google Antigravity, Claude Desktop, or Claude Code can model ER tables, edit selected subtrees, and inspect rendered screenshots.',
    'sc.mcp1L1': '18 contract-enforced authoring tools with sequential revision checks',
    'sc.mcp1L2': 'protoflow_capture_preview offscreen PNG capture for layout verification',
    'sc.mcp1L3': 'One-click Antigravity plugin install, .mcpb export & Cmd/Ctrl+Z undo',
    'sc.mcp2Tag': 'Remote Streamable HTTP · Engineering Handoff',
    'sc.mcp2Title': 'Zero-Install Spec Access After Publishing /p/{id}',
    'sc.mcp2Desc':
      'Once a prototype is published for review, developers paste one remote MCP URL into their IDE to read the sitemap, PostgreSQL/MySQL DDL, TSX screens, and sticky-note rules.',
    'sc.ax1Title': 'Parse .rp Locally Without Axure',
    'sc.ax1Desc':
      'Drop Axure RP 9 or RP 11 binaries into ProtoFlow AI. A local worker restores nested folders, groups, static table cells, master instances, and dynamic panel states offline.',
    'sc.ax2Title': 'Preserve Originals & Map Fields',
    'sc.ax2Desc':
      'Run read-only inventories or migration drafts per page, folder, or project and verify column-to-schema mappings before modifying layouts.',
    'sc.ax3Title': 'Reshape into Runnable Screens',
    'sc.ax3Desc':
      'Generate flow-layout QueryForm + Table + Descriptions pages backed by shared ER tables alongside untouched RP originals, complete with a Converted / Retained / Pending checklist.',

    'facts.aria': 'Key product facts',
    'fact.1.title': 'Apache-2.0 Open Source',
    'fact.1.desc': 'No sign-in required locally · Docker self-hostable',
    'fact.2.title': '114+ Materials · 12 Charts',
    'fact.2.desc': 'Desktop admin & iPhone viewports sharing ER tables',
    'fact.3.title': '18 MCP Tools',
    'fact.3.desc': 'Live canvas co-design + zero-install spec handoff',
    'fact.4.title': '14+ AI Providers',
    'fact.4.desc': 'Cloud accounts or offline local Ollama models',

    'cmp.kicker': 'Why ProtoFlow AI',
    'cmp.title': 'Bridge the gap between static wireframes and disposable AI webpages',
    'cmp.desc': 'Not another click-only drawing board, and not a one-shot HTML generator that scrambles layouts on every tweak.',
    'cmp.caption':
      'Comparison of traditional static prototyping tools, one-shot AI web generators, and ProtoFlow AI (formerly Alex)',
    'cmp.colDim': 'Dimension',
    'cmp.colStatic': 'Static Wireframing Tools',
    'cmp.colAiWeb': 'One-Shot AI Web Tools',
    'cmp.r1Dim': 'Cross-Page Data Flow',
    'cmp.r1Static': 'Static placeholder text; submitted forms never appear in lists',
    'cmp.r1AiWeb': 'Hardcoded per-page mocks; state resets across screens',
    'cmp.r1Alex': 'Bound to real ER physical tables synced live across pages & viewports',
    'cmp.r2Dim': 'AI Collaboration',
    'cmp.r2Static': 'No project-level context; every screen assembled manually',
    'cmp.r2AiWeb': 'Guesses ambiguous requirements and dumps a whole page at once',
    'cmp.r2Alex': 'Clarifies edge cases first → proposes sitemap & ER plan → generates on approval',
    'cmp.r3Dim': 'Iteration & Refinement',
    'cmp.r3Static': 'Manual alignment across dozens of artboards',
    'cmp.r3AiWeb': 'Small field edits frequently regenerate and break existing layouts',
    'cmp.r3Alex': 'Bidirectional AST drag-and-drop + scoped non-destructive AI/MCP edits',
    'cmp.r4Dim': 'Multi-Platform & Legacy',
    'cmp.r4Static': 'Desktop & mobile split across files; legacy .rp stays static',
    'cmp.r4AiWeb': 'Hard to share one backend relational dataset across desktop and mobile',
    'cmp.r4Alex': 'Desktop admin + iPhone viewports in one project, plus native Axure .rp import',
    'cmp.r5Dim': 'Engineering Handoff',
    'cmp.r5Static': 'Relies on long offline PRDs and verbal field explanations',
    'cmp.r5AiWeb': 'Lacks relational constraints, unique keys, and acceptance checklists',
    'cmp.r5Alex': 'Component sticky specs, FK impact analysis & remote MCP DDL/TSX access',
    'cmp.r6Dim': 'Data Sovereignty',
    'cmp.r6Static': 'Cloud-locked accounts and per-seat SaaS subscriptions',
    'cmp.r6AiWeb': 'Closed hosted sandboxes without private deployment',
    'cmp.r6Alex': 'Apache-2.0 open source · Local-first .pflow files + 3-step Docker Compose',
    'cmp.allToolsLink': 'Read full 2026 comparison (vs. Modao, Pixso, GemDesign & OpenDesign) →',

    'features.kicker': 'Capabilities',
    'features.title': 'Two core tracks uniting product validation and AI engineering',
    'features.desc': 'Stop copying context across mindmaps, wireframing tools, schema editors, and coding IDEs.',
    'features.p1Tag': 'Track 1 · Prototypes Backed by Real Data',
    'features.p1Title': 'Shared ER Physical Tables + Offline Axure .rp Upgrade',
    'features.p1Desc':
      'Model foreign keys and composite unique constraints visually so form writes update desktop ledgers, charts, and iPhone screens live — and parse Axure RP 9/11 .rp binaries offline without Axure installed.',
    'features.p1DemoLink': 'Try Live CRM Demo →',
    'features.p1AxureLink': 'Axure .rp Migration Guide →',
    'features.p2Tag': 'Track 2 · Built for Coding Agents',
    'features.p2Title': 'Bidirectional MCP Live Canvas + Zero-Install DDL/TSX Handoff',
    'features.p2Desc':
      'Let Claude Code, Cursor, Codex, or Google Antigravity co-design on your desktop canvas with 18 contract tools + screenshot self-checks — then publish /p/{id} so engineers stream SQL DDL, TSX, and sticky rules via remote MCP.',
    'features.p2McpLink': 'Explore MCP Server & Tools →',
    'f1.title': 'Clarify-First Project AI',
    'f1.desc':
      'The built-in Hermes engine asks about thresholds, approvals, and edge cases first, proposes a sitemap + ER blueprint, and supports scoped edits after confirmation.',
    'f2.title': 'Bidirectional AST Canvas & 114+ Materials',
    'f2.desc':
      'Widescreen grids, multi-column query bars, master-detail tables, drawers, composite blocks, and sandboxed freeform components synced losslessly with TSX DSL.',
    'f4.title': 'Desktop Admin & Mobile in One Project',
    'f4.desc':
      'Author wide admin consoles alongside iPhone mobile viewports with bottom sheets, capsule tabs, and waterfall feeds backed by the exact same dataset.',
    'f5.title': '12 Native ECharts & Mermaid Diagrams',
    'f5.desc':
      'Bar, line, area, pie, scatter, radar, gauge, funnel, heatmap, treemap, and sankey charts bind directly to project tables alongside split-screen notes and mindmaps.',
    'f7.title': 'Sticky Specs, Impact Analysis & Audits',
    'f7.desc':
      'Pin validation rules directly onto controls, trace every screen impacted by a schema edit, and audit broken links, unbound foreign keys, and acceptance items.',
    'f8.title': 'Local .pflow Privacy + One-Click Online Review',
    'f8.desc':
      'Projects stay on disk as .pflow archives or Git-friendly trees. Connect the open-source Docker server to publish password-protected, expiring /p/{id} review links.',

    'mcp.kicker': 'MCP Co-Design & Handoff',
    'mcp.title': 'Let your coding agents build prototypes, read specs, and ship code',
    'mcp.desc':
      'Built-in Model Context Protocol (MCP) support in ProtoFlow AI bridges live AI-assisted prototyping on desktop with read-only spec handoff to your engineering team.',
    'mcp.p1Title': 'Live Canvas Bridge (Desktop Co-Design)',
    'mcp.p1Desc':
      'Toggle Bidirectional design in the desktop app so external agents can model shared ER tables, seed FK-valid rows, patch selected components via 18 contract tools, verify layouts via screenshot capture, and support Cmd/Ctrl+Z undo.',
    'mcp.p2Title': 'Remote /p/{id} Zero-Install Spec Server',
    'mcp.p2Desc':
      'Once you share an online review link, engineers copy one Streamable HTTP snippet into their IDE to inspect the full route tree, PostgreSQL/MySQL DDL, page TSX, and sticky-note rules.',
    'mcp.agentsAria': 'Supported AI coding clients',
    'mcp.copy': 'Copy JSON',
    'mcp.foot':
      'Includes 6 read-only spec tools for engineering handoff and 18 contract-validated write tools for live canvas co-design, with one-click setup inside the app.',

    'scn.kicker': 'Teams & Starter Templates',
    'scn.title': 'Launch with 3 built-in industry templates and test a full loop in minutes',
    'scn.desc': 'No sign-in wall, no blank-canvas paralysis, and no throwaway mockups.',
    'scn.r1Kicker': 'Product Managers & Analysts',
    'scn.r1Title': 'Turn ambiguous specs into verifiable loops',
    'scn.r1Desc':
      'Clarify business rules before generating screens, pin acceptance specs onto buttons and fields, and upgrade legacy Axure .rp files without starting over.',
    'scn.r2Kicker': 'Solutions & Pre-Sales Architects',
    'scn.r2Title': 'Demo real CRUD, approvals, and live charts',
    'scn.r2Desc':
      'Add a requested column or approval step on the spot, show desktop submissions arriving on mobile immediately, and send a /p/{id} link for customer sign-off.',
    'scn.r3Kicker': 'Full-Stack & AI Coding Teams',
    'scn.r3Title': 'Make the prototype the single source of truth',
    'scn.r3Desc':
      'Stream normalized ER DDL, foreign-key closures, page TSX, and sticky constraints straight into Claude Code or Cursor via MCP.',
    'scn.tplHead': '3 built-in community starter templates (ready locally without login)',
    'scn.t1Title': 'SaaS E-Commerce & Inventory Admin',
    'scn.t1Desc':
      'Supplier onboarding, purchase orders, master-detail inbound receipts, 4 shared ER tables, and 5 tax/over-receipt sticky specs.',
    'scn.t2Title': 'CRM Sales & Contract Billing Dashboard',
    'scn.t2Desc':
      'Table-bound ECharts trend and regional ARR charts, customer opportunity CRUD, payment plans, and cross-platform billing views.',
    'scn.t2Cta': 'Launch Live Demo in Browser →',
    'scn.t3Title': 'Modern Mobile & Cross-Platform App',
    'scn.t3Desc':
      'Consumer waterfall discovery feed, mobile approval drawers, AI assistant view, and live table sync with the desktop admin console.',

    'ai.kicker': 'Model Ecosystem',
    'ai.title': 'Bring your own cloud model or Ollama — or run 100% without AI',
    'ai.desc':
      'ProtoFlow AI Desktop ships a verified managed Hermes runtime so you can connect 14+ cloud providers or local Ollama models with adjustable reasoning effort. Every canvas, ER, and publishing tool also works standalone without AI.',
    'ai.listAria': 'Supported model providers',
    'ai.qwen': 'Qwen',
    'ai.zai': 'Z.ai (GLM)',
    'ai.ollama': 'Ollama (Local)',
    'ai.fine': 'Brand icons courtesy of LobeHub Icons (MIT). All trademarks belong to their respective owners.',

    'dl.kicker': 'Download & Self-Host',
    'dl.title': 'Download ProtoFlow AI Desktop free, or self-host in 3 commands',
    'dl.latestPrefix': 'Latest release',
    'dl.recKicker': 'Recommended for your device',
    'dl.macReq': 'macOS 13 or later · Apple Silicon / Intel',
    'dl.yourOs': 'Your OS',
    'dl.macTip':
      'Desktop packages currently use the Alex app name (Alex-*.dmg). Drag Alex to Applications; on first launch, right-click → Open or click "Open Anyway" in Privacy & Security once.',
    'dl.winTip':
      'Run the NSIS installer (Alex-*-win-x64.exe) to pick an install folder and create shortcuts. If Windows SmartScreen appears, click "More info → Run anyway".',
    'dl.linuxTip':
      'Recommended .deb: <code>sudo apt install ./Alex-*-linux-amd64.deb</code> (retains Alex package name) — supports one-click in-app updates afterward.',
    'dl.tr1Title': 'Apache-2.0 Open Source',
    'dl.tr1Desc': 'Desktop workbench, web viewer & Go server are 100% auditable',
    'dl.tr2Title': 'Built via GitHub Actions',
    'dl.tr2Desc': 'Official installers compiled directly in CI with checksum manifests',
    'dl.tr3Title': 'SHA-256 & Signed Updates',
    'dl.tr3Desc': 'Every download lists its digest; in-app updates verify digital signatures',
    'dl.tr4Title': 'Run Directly from Source',
    'dl.tr4Desc': 'Developers can also launch locally in seconds with Node.js 22+',
    'dl.devSummary': '60-second source launch & 3-step Docker Compose self-hosting commands',
    'dl.devSrcTitle': 'Run from source locally (Node.js 22+ only)',
    'dl.devDockerTitle': 'Self-host team sharing & remote MCP server (Docker Compose)',

    'faq.kicker': 'FAQ',
    'faq.title': 'Questions & Answers',
    'faq.contact':
      'Still have questions? Open an issue on <a class="text-link" data-repo-link data-repo-path="/issues" href="https://github.com/EvanClub-Agent/protoflow-ai/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a> or email <a class="text-link" data-contact-email data-contact-email-text href="mailto:ai.agent.club@gmail.com">ai.agent.club@gmail.com</a>.',
    'faq.q1': 'Is ProtoFlow AI free and open source? Can we use it commercially?',
    'faq.a1':
      'Yes. ProtoFlow AI (formerly Alex) is licensed under Apache-2.0 — free for personal learning, commercial prototyping, and private enterprise self-hosting with no seat limits. You connect your own model keys or local Ollama directly.',
    'faq.q2': 'Where are my project files and model API keys stored?',
    'faq.a2':
      'Projects save locally on your disk as .pflow archives or unpacked directories, and model credentials are managed locally by Hermes without mandatory login. Snapshots upload to your configured server only when you explicitly click Publish.',
    'faq.q3': 'How does Axure (.rp) import work?',
    'faq.a3':
      'Drag an Axure RP 9 or RP 11 .rp file into the launcher or workbench. A local worker parses folders, groups, static tables, masters, and dynamic panels offline without Axure installed, and lets AI map table headers to physical ER columns alongside untouched original pages.',
    'faq.q4': 'How do I connect Claude Code, Cursor, Codex, or Antigravity via MCP?',
    'faq.a4':
      'Click "MCP Connect" in the desktop toolbar to install the Antigravity plugin or export a Claude Desktop .mcpb bundle in one click for live canvas co-design. For engineering handoff, publish a /p/{id} demo and copy the remote Streamable HTTP URL into any MCP-compatible IDE.',
    'faq.q5': 'Can I use ProtoFlow AI without configuring AI models or Docker?',
    'faq.a5':
      'Absolutely. Launch the desktop app without logging in to use the visual canvas, 114+ materials, ER database designer, 12 ECharts types, Mermaid notes, and local exports. Docker is only needed if you want to host interactive /p/{id} links for browser review.',
    'faq.q6': 'Why do desktop installers still use "Alex" in filenames, and how do I open on macOS?',
    'faq.a6':
      'The desktop binaries currently preserve the Alex package identifier (Alex-*.dmg / Alex-*.exe / Alex-*.deb) for seamless in-app upgrades. Community builds use local signing: on macOS right-click Alex in Applications → Open once (Apple Silicon = arm64, Intel = x64).',

    'cta.title': 'Make your prototypes<br />run today',
    'cta.desc': 'Try the interactive live demo in your browser, or download the Apache-2.0 desktop workbench for free with no sign-in required.',
    'cta.btn': 'Download ProtoFlow AI',
    'cta.discord': 'Join Discord Community',

    'footer.brandAria': 'ProtoFlow AI back to top',
    'footer.tagline':
      'Open-source, local-first AI prototyping and ER modeling workbench connecting product specs to AI engineering delivery.',
    'footer.colProduct': 'Product',
    'footer.colDocs': 'Docs & Guides',
    'footer.quickStart': 'Quick Start (60s)',
    'footer.selfHost': 'Docker Self-Hosting',
    'footer.mcpDocs': 'MCP Spec Server',
    'footer.changelog': 'Changelog',
    'footer.mcpPage': 'MCP Server & API Docs',
    'footer.llms': 'AI / llms.txt',
    'footer.colCommunity': 'Community & Trust',
    'footer.about': 'About ProtoFlow AI',
    'footer.privacyPage': 'Privacy & Local-First',
    'footer.contactPage': 'Support & Contact',
    'footer.discord': 'Discord Community',
    'footer.issues': 'Report Issues',
    'footer.security': 'Security Policy',
    'footer.contact': 'Contact Us',
    'footer.license': 'Apache-2.0 Open Source',
    'footer.privacy': 'Projects stay local by default · No sign-in required',
    'footer.localesAria': 'Language versions',
  };

  const staticLocale =
    (document.documentElement && document.documentElement.dataset && document.documentElement.dataset.staticLocale) || '';

  function readSavedLocale() {
    try {
      const saved = window.localStorage && window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === 'zh-CN' || saved === 'en-US') return saved;
    } catch {
      /* ignore storage errors */
    }
    return null;
  }

  function readUrlLocale() {
    try {
      if (typeof location !== 'undefined' && location.search) {
        const param = new URLSearchParams(location.search).get('lang');
        if (param) {
          if (/^en\b/i.test(param.trim())) return 'en-US';
          if (/^zh\b/i.test(param.trim())) return 'zh-CN';
        }
      }
    } catch {
      /* ignore URL parsing errors */
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
    const urlLocale = readUrlLocale();
    if (urlLocale) return urlLocale;
    if (staticLocale === 'en') return 'en-US';
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

  function safeUrl(raw, base) {
    if (!raw) return null;
    try {
      const url = new URL(raw, base || document.baseURI);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function applySiteConfigLinks() {
    const repoBase = safeUrl(config.repoUrl);
    if (repoBase) {
      const cleanBase = repoBase.replace(/\/+$/, '');
      for (const link of $$('[data-repo-link]')) {
        const sub = link.dataset.repoPath || '';
        link.href = sub ? `${cleanBase}${sub}` : cleanBase;
      }
    }

    const email = typeof config.contactEmail === 'string' ? config.contactEmail.trim() : '';
    if (email) {
      for (const link of $$('[data-contact-email]')) {
        link.href = `mailto:${email}`;
        if (link.hasAttribute('data-contact-email-text')) {
          link.textContent = email;
        }
      }
    }

    const discord = safeUrl(config.discordUrl);
    for (const link of $$('[data-discord-link]')) {
      if (discord) {
        link.href = discord;
        link.hidden = false;
      } else {
        link.hidden = true;
      }
    }

    const secondary = $('[data-secondary-cta]');
    if (secondary) {
      const rawDemo = typeof config.demoUrl === 'string' ? config.demoUrl.trim() : '';
      const demo = safeUrl(rawDemo);
      if (demo) {
        const isRelativeSameOrigin = rawDemo.startsWith('/');
        secondary.href = isRelativeSameOrigin ? rawDemo : demo;
        if (isRelativeSameOrigin) {
          secondary.removeAttribute('target');
          secondary.removeAttribute('rel');
        } else {
          secondary.target = '_blank';
          secondary.rel = 'noopener noreferrer';
        }
        secondary.textContent = tr('在线体验原型', EN_TEXT['hero.demoCta']);
      } else {
        secondary.href = '#showcase';
        secondary.removeAttribute('target');
        secondary.removeAttribute('rel');
        secondary.textContent = tr('查看实机演示', EN_TEXT['hero.secondaryCta']);
      }
    }
  }

  let zhSnapshot = null;
  function captureInitialZhDom() {
    if (zhSnapshot) return;
    const descMeta = $('meta[name="description"]');
    const ogTitleMeta = $('meta[property="og:title"]');
    const ogDescMeta = $('meta[property="og:description"]');
    const twTitleMeta = $('meta[name="twitter:title"]');
    const twDescMeta = $('meta[name="twitter:description"]');
    zhSnapshot = {
      title: document.title,
      description: descMeta ? descMeta.getAttribute('content') : '',
      ogTitle: ogTitleMeta ? ogTitleMeta.getAttribute('content') : '',
      ogDescription: ogDescMeta ? ogDescMeta.getAttribute('content') : '',
      twTitle: twTitleMeta ? twTitleMeta.getAttribute('content') : '',
      twDescription: twDescMeta ? twDescMeta.getAttribute('content') : '',
      texts: $$('[data-i18n]').map((node) => ({ node, key: node.dataset.i18n, zh: node.textContent })),
      htmls: $$('[data-i18n-html]').map((node) => ({ node, key: node.dataset.i18nHtml, zh: node.innerHTML })),
      arias: $$('[data-i18n-aria]').map((node) => ({ node, key: node.dataset.i18nAria, zh: node.getAttribute('aria-label') || '' })),
      alts: $$('[data-i18n-alt]').map((node) => ({ node, key: node.dataset.i18nAlt, zh: node.getAttribute('alt') || '' })),
    };
  }

  function applyStaticLocale() {
    const en = isEn();
    if (staticLocale !== 'en') {
      captureInitialZhDom();
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
      const twTitleMeta = $('meta[name="twitter:title"]');
      if (twTitleMeta) twTitleMeta.setAttribute('content', en ? EN_META.ogTitle : zhSnapshot.twTitle);
      const twDescMeta = $('meta[name="twitter:description"]');
      if (twDescMeta) twDescMeta.setAttribute('content', en ? EN_META.ogDescription : zhSnapshot.twDescription);

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
      for (const item of zhSnapshot.alts) {
        if (en && EN_TEXT[item.key] != null) item.node.setAttribute('alt', EN_TEXT[item.key]);
        else item.node.setAttribute('alt', item.zh);
      }
    }

    const compareTable = $('[data-compare-table]');
    if (compareTable && compareTable.style) {
      if (en) {
        compareTable.style.setProperty('--col-1', '"Static Wireframing Tools"');
        compareTable.style.setProperty('--col-2', '"One-Shot AI Web Tools"');
        compareTable.style.setProperty('--col-3', '"ProtoFlow AI"');
      } else {
        compareTable.style.setProperty('--col-1', '"传统静态原型工具"');
        compareTable.style.setProperty('--col-2', '"一次性 AI 网页工具"');
        compareTable.style.setProperty('--col-3', '"ProtoFlow AI"');
      }
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

    applySiteConfigLinks();
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
  // Responsive Popover Navigation Bar
  // ---------------------------------------------------------------------------
  function setupResponsiveNavbar() {
    const header = $('[data-site-header]');
    const inner = $('[data-header-inner]');
    const menuBtn = $('[data-menu-button]');
    const menu = $('[data-site-menu]');
    if (!header || !inner || !menuBtn || !menu) return () => {};

    const supportsPopover = Object.hasOwn(HTMLElement.prototype, 'popover');
    if (!supportsPopover) {
      header.classList.add('no-popover');
    }

    const isPopoverOpen = () => {
      if (supportsPopover) {
        try {
          return menu.matches(':popover-open');
        } catch {
          return false;
        }
      }
      return menu.classList.contains('is-open');
    };

    const closeMenu = () => {
      if (supportsPopover) {
        try {
          if (menu.matches(':popover-open') && typeof menu.hidePopover === 'function') {
            menu.hidePopover();
          }
        } catch {
          /* ignore */
        }
      } else {
        menu.classList.remove('is-open');
      }
      menuBtn.setAttribute('aria-expanded', 'false');
    };

    const openMenu = () => {
      if (supportsPopover) {
        try {
          if (typeof menu.showPopover === 'function') menu.showPopover();
        } catch {
          /* ignore */
        }
      } else {
        menu.classList.add('is-open');
      }
      menuBtn.setAttribute('aria-expanded', 'true');
    };

    if (supportsPopover) {
      menu.addEventListener('toggle', (event) => {
        menuBtn.setAttribute('aria-expanded', event.newState === 'open' ? 'true' : 'false');
      });
    } else {
      menuBtn.addEventListener('click', () => {
        if (isPopoverOpen()) closeMenu();
        else openMenu();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isPopoverOpen()) {
          closeMenu();
          menuBtn.focus();
        }
      });
      document.addEventListener('click', (event) => {
        if (!header.classList.contains('is-wide') && isPopoverOpen()) {
          if (!menu.contains(event.target) && !menuBtn.contains(event.target)) {
            closeMenu();
          }
        }
      });
    }

    for (const link of $$('a', menu)) {
      link.addEventListener('click', () => {
        if (!header.classList.contains('is-wide')) closeMenu();
      });
    }

    let lastHeaderWidth = 0;
    const syncNavLayout = () => {
      const currentWidth = header.clientWidth;
      // Avoid layout thrashing when hidden/unlaid-out (e.g. JSDOM clientWidth === 0).
      if (!currentWidth) return;

      const wasOpen = !header.classList.contains('is-wide') && isPopoverOpen();
      header.classList.add('is-measuring', 'is-wide');
      menu.removeAttribute('popover');
      const wide = inner.scrollWidth <= inner.clientWidth;

      if (wide) {
        header.classList.add('is-wide');
        menu.classList.remove('is-open');
        menuBtn.setAttribute('aria-expanded', 'false');
      } else {
        header.classList.remove('is-wide');
        if (supportsPopover) {
          menu.setAttribute('popover', 'auto');
        }
        if (wasOpen) openMenu();
        else menuBtn.setAttribute('aria-expanded', 'false');
      }

      lastHeaderWidth = currentWidth;
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => header.classList.remove('is-measuring'));
      } else {
        header.classList.remove('is-measuring');
      }
    };

    if (typeof ResizeObserver === 'function') {
      const headerObserver = new ResizeObserver(() => {
        const w = header.clientWidth;
        if (header.classList.contains('is-wide') || w > lastHeaderWidth) {
          syncNavLayout();
        }
      });
      headerObserver.observe(header);

      const menuObserver = new ResizeObserver(() => {
        if (header.classList.contains('is-wide')) {
          syncNavLayout();
        }
      });
      menuObserver.observe(menu);
    }

    syncNavLayout();
    return syncNavLayout;
  }

  // ---------------------------------------------------------------------------
  // Accessible Showcase Tabs (selection follows focus + hidden="until-found")
  // ---------------------------------------------------------------------------
  function setupTabs() {
    for (const root of $$('[data-tabs]')) {
      const tablist = $('[role="tablist"]', root);
      if (!tablist) continue;
      const tabs = $$('[role="tab"]', tablist);
      const panels = $$('[role="tabpanel"]', root);
      if (!tabs.length || !panels.length) continue;

      const pairFor = (tab) => panels.find((p) => p.getAttribute('aria-labelledby') === tab.id) || null;

      const selectTab = (targetTab, { focus = false, scroll = true } = {}) => {
        for (const tab of tabs) {
          const selected = tab === targetTab;
          tab.setAttribute('aria-selected', selected ? 'true' : 'false');
          tab.tabIndex = selected ? 0 : -1;
          const panel = pairFor(tab);
          if (panel) {
            if (selected) {
              panel.removeAttribute('hidden');
              panel.tabIndex = 0;
            } else {
              panel.setAttribute('hidden', 'until-found');
              panel.removeAttribute('tabindex');
            }
          }
        }
        if (scroll && typeof targetTab.scrollIntoView === 'function') {
          try {
            targetTab.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
          } catch {
            try {
              targetTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } catch {
              /* ignore in minimal DOM environments */
            }
          }
        }
        if (focus && typeof targetTab.focus === 'function') {
          targetTab.focus();
        }
      };

      for (const tab of tabs) {
        tab.addEventListener('click', () => selectTab(tab, { focus: false, scroll: true }));
        const panel = pairFor(tab);
        if (panel) {
          panel.addEventListener('beforematch', () => selectTab(tab, { focus: false, scroll: true }));
        }
      }

      tablist.addEventListener('keydown', (event) => {
        const currentIndex = tabs.indexOf(event.target);
        if (currentIndex < 0) return;
        let nextIndex = -1;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex >= 0) {
          event.preventDefault();
          selectTab(tabs[nextIndex], { focus: true, scroll: true });
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Copy MCP Configuration Snippet
  // ---------------------------------------------------------------------------
  function setupCopyButtons() {
    const copyBtn = $('[data-copy-mcp]');
    const codeNode = $('[data-mcp-code]');
    const statusNode = $('[data-copy-status]');
    if (!copyBtn || !codeNode) return;

    let resetTimer = null;
    copyBtn.addEventListener('click', async () => {
      const text = codeNode.textContent || '';
      let copied = false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch {
        copied = false;
      }
      if (!copied) {
        try {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          copied = document.execCommand('copy');
          area.remove();
        } catch {
          copied = false;
        }
      }

      if (copied) {
        const doneLabel = tr('已复制', 'Copied');
        copyBtn.textContent = doneLabel;
        if (statusNode) statusNode.textContent = tr('MCP 配置已复制到剪贴板', 'MCP config copied to clipboard');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          copyBtn.textContent = tr('复制配置', EN_TEXT['mcp.copy']);
          if (statusNode) statusNode.textContent = '';
        }, 2000);
      }
    });
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
  // Release data sources & strict provenance verification
  // ---------------------------------------------------------------------------
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

  async function fetchJson(url, cache = 'no-store') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache,
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
    // The public API orders releases by descending semantic version. Pick one
    // published release per OS so staggered platform releases keep their own version.
    const releases = data.items.map((release) => {
      if (!release || typeof release.id !== 'string' || !release.id || release.published !== true ||
          !(release.channel === config.channel || (config.channel === 'beta' && release.channel === 'stable')) ||
          typeof release.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(release.version) ||
          typeof release.publishedAt !== 'string' || !formatDate(release.publishedAt) || !Array.isArray(release.assets)) {
        throw new Error(tr('已发布版本数据无效', 'Invalid published release data'));
      }
      return {
        version: release.version,
        publishedAt: release.publishedAt,
        assets: release.assets.map((a) => normalizeAsset(a, release, base)),
      };
    });
    return catalogFromReleases(releases);
  }

  async function fromGitHub() {
    if (!githubRepository || config.channel !== 'stable') throw new Error('Invalid GitHub release configuration');
    const repoUrl = `https://github.com/${githubRepository}`;
    const data = await fetchJson(`https://api.github.com/repos/${githubRepository}/releases/latest`, 'default');
    const tag = /^v(\d+\.\d+\.\d+)$/.exec(data?.tag_name);
    if (!tag || data.draft !== false || data.prerelease !== false ||
        data.html_url !== `${repoUrl}/releases/tag/${tag[0]}` ||
        typeof data.published_at !== 'string' || !formatDate(data.published_at) || !Array.isArray(data.assets)) {
      throw new Error('Invalid stable GitHub release');
    }

    // Linux package formats spell the same CPU architecture differently.
    const systems = { mac: 'macos', win: 'windows', linux: 'linux' };
    const architectures = { arm64: 'arm64', aarch64: 'arm64', x64: 'x64', amd64: 'x64', x86_64: 'x64', universal: 'universal' };
    const formats = { mac: ['dmg', 'zip'], win: ['exe'], linux: ['deb', 'AppImage', 'tar.gz'] };
    const version = tag[1];
    const assets = [];
    for (const asset of data.assets) {
      if (asset.state !== 'uploaded') continue;
      const appImage = /^ProtoFlow_AI-(\d+\.\d+\.\d+)-(x86_64|arm64|aarch64)\.AppImage$/.exec(asset.name);
      const legacy = /^Alex-(\d+\.\d+\.\d+)-(mac|win|linux)-(arm64|aarch64|x64|amd64|x86_64|universal)\.(dmg|zip|exe|deb|AppImage|tar\.gz)$/.exec(asset.name);
      if (!appImage && !legacy) continue;
      const [fileVersion, platform, cpu, format] = appImage
        ? [appImage[1], 'linux', appImage[2], 'AppImage']
        : legacy.slice(1);
      if (fileVersion !== version || !formats[platform].includes(format) ||
          asset.browser_download_url !== `${repoUrl}/releases/download/${tag[0]}/${asset.name}` ||
          !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
        throw new Error('Invalid GitHub installer metadata');
      }
      assets.push({
        os: systems[platform],
        arch: architectures[cpu],
        packageType: format.toLowerCase(),
        version,
        fileName: asset.name,
        sizeBytes: asset.size,
        sha256: asset.digest.slice(7),
        url: asset.browser_download_url,
      });
    }
    return catalogFromReleases([{ version, publishedAt: data.published_at, assets }]);
  }

  function catalogFromReleases(releases) {
    const platforms = {};
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
      if (config.releaseSource === 'release-center') return await fromUpdateServer();
      if (config.releaseSource === 'github') return await fromGitHub();
      throw new Error('Unknown download source');
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
          : tr(`此版本的 ${OS_LABEL[os]} 安装包暂未发布`, `No ${OS_LABEL[os]} installer in this release`),
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
      if (list) list.replaceChildren(...[0, 1].map(() => el('li', 'asset skeleton')));
    }
  }

  function renderPlatforms(catalog) {
    for (const card of $$('.platform')) {
      const os = card.dataset.os;
      const list = $('[data-assets]', card);
      const tip = $('.p-tip', card);
      const release = catalog.platforms[os];
      const assets = release ? sortAssets(release.assets) : [];
      if (list) list.replaceChildren(...(assets.length ? assets.map(assetItem) : [unavailableItem(os, catalog.status)]));
      if (tip) tip.hidden = !assets.length;
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

    // Never leave an alarming "暂不可用" / "Unavailable" badge above the Hero headline.
    const heroVersion = $('[data-hero-version]');
    if (heroVersion) heroVersion.hidden = !release;

    const date = release && formatDate(release.publishedAt);
    $('[data-release-date]').textContent = date ? tr(`· 发布于 ${date}`, `· Released ${date}`) : '';
    $('[data-source-note]').textContent = catalog.status === 'error'
      ? tr('· 版本信息加载失败，请重试', '· Failed to load release info. Please retry.')
      : release
        ? (config.releaseSource === 'github'
          ? tr('· 来自 GitHub 官方发行版', '· Published on GitHub Releases')
          : tr('· 与版本中心同步，各平台可下载版本见下方', '· Synced with Release Center. Platform installers are listed below.'))
        : tr('· 正式发布后将在这里提供下载', '· Installers will appear here once officially published.');

    const actions = $('[data-release-actions]');
    actions.replaceChildren();
    if (config.releaseSource === 'github' && githubRepository) {
      const releasesLink = el('a', 'btn btn-quiet btn-sm', tr('前往 GitHub Releases', 'View GitHub Releases'));
      releasesLink.href = `https://github.com/${githubRepository}/releases/latest`;
      releasesLink.target = '_blank';
      releasesLink.rel = 'noopener noreferrer';
      actions.append(releasesLink);
    }
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
  let syncNavLayoutFn = () => {};

  function syncLangQueryParam(nextLocale) {
    try {
      if (typeof history === 'undefined' || typeof history.replaceState !== 'function') return;
      if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return;
      const url = new URL(location.href);
      url.searchParams.set('lang', nextLocale === 'en-US' ? 'en' : 'zh');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {
      /* ignore history errors */
    }
  }

  function setLocale(nextLocale) {
    currentLocale = nextLocale === 'en-US' ? 'en-US' : 'zh-CN';
    try {
      if (window.localStorage) window.localStorage.setItem(LOCALE_STORAGE_KEY, currentLocale);
    } catch {
      /* ignore storage errors */
    }
    syncLangQueryParam(currentLocale);
    applyStaticLocale();
    if (lastCatalog) {
      renderPlatforms(lastCatalog);
      renderRelease(lastCatalog, currentDevice);
    } else {
      for (const node of $$('[data-version]')) {
        node.textContent = tr('版本加载中', 'Loading version');
      }
    }
    syncNavLayoutFn();
  }

  async function refreshRelease(device) {
    lastCatalog = null;
    $('[data-release-actions]').replaceChildren();
    $('[data-recommend]').hidden = true;
    $('[data-recommend-link]').removeAttribute('href');
    const heroVersion = $('[data-hero-version]');
    if (heroVersion) heroVersion.hidden = false;
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
    syncNavLayoutFn = setupResponsiveNavbar();
    setupTabs();
    setupCopyButtons();

    const toggle = $('[data-lang-toggle]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        if (staticLocale === 'en') {
          try {
            if (window.localStorage) window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
          } catch {
            /* ignore storage errors */
          }
          if (typeof location !== 'undefined') {
            location.href = `/?lang=zh${location.hash || ''}`;
          }
          return;
        }
        setLocale(isEn() ? 'zh-CN' : 'en-US');
      });
    }
    for (const link of $$('.footer-locales a[hreflang]')) {
      link.addEventListener('click', () => {
        const target = /^en\b/i.test(link.getAttribute('hreflang') || '') ? 'en-US' : 'zh-CN';
        try {
          if (window.localStorage) window.localStorage.setItem(LOCALE_STORAGE_KEY, target);
        } catch {
          /* ignore storage errors */
        }
      });
    }
    const year = $('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());

    currentDevice = await detectDevice();
    await refreshRelease(currentDevice);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
