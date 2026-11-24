#!/usr/bin/env node
/*
 * Generates bilingual (zh-CN & en-US) 16:9 (1600x900 @2x) X / Twitter promotional visuals
 * for ProtoFlow AI's new Figma support in docs/assets/promo-figma/.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs/assets/promo-figma');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const resolvedRoot = path.resolve(rootDir);
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        let relPath = decodeURIComponent(reqUrl.pathname);
        if (relPath.endsWith('/')) relPath += 'index.html';
        const candidate = path.resolve(resolvedRoot, '.' + relPath);
        if (!candidate.startsWith(resolvedRoot + path.sep) && candidate !== resolvedRoot) {
          res.writeHead(403).end('Forbidden');
          return;
        }
        let filePath = candidate;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404).end('Not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500).end(String(err));
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const FIGMA_SVG = `<svg viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
  <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
  <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
  <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
  <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
</svg>`;

const AXURE_SVG = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="36" height="36" rx="9" fill="#0F172A"/>
  <path d="M10.5 10.5L19.8 20L10.5 29.5" stroke="#00A8E8" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M29.5 10.5L20.2 20L29.5 29.5" stroke="#8CC63F" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M15.2 10.5L24.8 29.5" stroke="#EC008C" stroke-width="3.6" stroke-linecap="round" opacity="0.92"/>
  <circle cx="20" cy="20" r="2.6" fill="#FFFFFF"/>
</svg>`;

function buildHeroHtml({ lang, logoDataUrl, hubShotUrl, pickerShotUrl, canvasShotUrl }) {
  const zh = lang === 'zh';
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1600px; height: 900px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(920px 620px at 8% 0%, rgba(124, 58, 237, 0.13), transparent 64%),
      radial-gradient(880px 640px at 94% 100%, rgba(37, 99, 235, 0.15), transparent 64%),
      linear-gradient(150deg, #f8fafc 0%, #f1f5fd 52%, #f6f4fe 100%);
    color: #090d1a;
    display: grid;
    grid-template-columns: 650px 1fr;
    gap: 28px;
    padding: 58px 54px 54px 66px;
    align-items: center;
    -webkit-font-smoothing: antialiased;
    position: relative;
  }
  .grid-dots {
    position: absolute; inset: 0; pointer-events: none;
    background-image: radial-gradient(rgba(15, 23, 42, 0.065) 1.2px, transparent 1.2px);
    background-size: 24px 24px;
    mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.45) 48%, rgba(0,0,0,0.9) 100%);
  }
  .left { display: flex; flex-direction: column; gap: 24px; position: relative; z-index: 2; }
  .lockup { display: flex; align-items: center; gap: 14px; }
  .app-icon {
    width: 56px; height: 56px; border-radius: 15px;
    box-shadow: 0 12px 26px -8px rgba(29, 78, 216, 0.38);
  }
  .plus { font-size: 24px; font-weight: 700; color: #94a3b8; }
  .fig-icon {
    width: 56px; height: 56px; border-radius: 15px; background: #0f172a;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 12px 26px -8px rgba(15, 23, 42, 0.32);
  }
  .fig-icon svg { width: 26px; height: 38px; }
  .badge-new {
    margin-left: 6px;
    font-size: 13px; font-weight: 700; letter-spacing: 0.02em;
    color: #6d28d9; background: #f3e8ff; border: 1px solid #d8b4fe;
    padding: 6px 14px; border-radius: 999px;
  }
  .eyebrow {
    font-size: 16px; font-weight: 700; color: #2563eb; letter-spacing: 0.01em;
    display: flex; align-items: center; gap: 10px;
  }
  .eyebrow span.sep { color: #cbd5e1; }
  h1 {
    font-size: ${zh ? '48px' : '46px'}; line-height: ${zh ? '1.18' : '1.13'};
    font-weight: 850; letter-spacing: -0.028em; color: #090d1a;
  }
  h1 em {
    font-style: normal; display: block; margin-top: 8px;
    background: linear-gradient(95deg, #1d4ed8 0%, #6d28d9 62%, #db2777 100%);
    -webkit-background-clip: text; color: transparent;
    font-size: ${zh ? '38px' : '38px'};
  }
  .lead {
    font-size: ${zh ? '19px' : '18.5px'}; line-height: 1.58; color: #334155; font-weight: 450;
  }
  .pipeline {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid #dbe4f3; border-radius: 16px; padding: 14px;
    box-shadow: 0 10px 26px -12px rgba(15, 23, 42, 0.09);
  }
  .step {
    background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 11px 12px;
  }
  .step-num { font-size: 11px; font-weight: 800; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.05em; }
  .step-title { font-size: 14px; font-weight: 750; color: #0f172a; margin-top: 3px; }
  .step-sub { font-size: 12px; color: #64748b; margin-top: 2px; line-height: 1.35; }
  .pills { display: flex; flex-wrap: wrap; gap: 9px; }
  .pill {
    font-size: 13.5px; font-weight: 650; color: #1e293b;
    background: #ffffff; border: 1px solid #d5e0f0;
    padding: 7px 13px; border-radius: 10px;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
  }
  .footer {
    display: flex; align-items: center; gap: 12px; margin-top: 4px;
    font-size: 14px; font-weight: 600; color: #475569;
  }
  .oss {
    background: #090d1a; color: #ffffff; font-weight: 750; font-size: 13px;
    padding: 5px 12px; border-radius: 8px; letter-spacing: 0.01em;
  }
  .url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #1d4ed8; font-weight: 700; }

  .right { position: relative; height: 788px; z-index: 2; }
  .win-back {
    position: absolute; top: 14px; right: 0; width: 800px;
    border-radius: 18px; overflow: hidden; background: #ffffff;
    border: 1px solid #cbd5e1;
    box-shadow: 0 24px 60px -18px rgba(15, 23, 42, 0.22);
  }
  .win-back img { width: 100%; height: auto; display: block; }
  .win-front {
    position: absolute; bottom: 18px; left: 0; width: 575px;
    border-radius: 18px; overflow: hidden; background: #ffffff;
    border: 1.5px solid #c4b5fd;
    box-shadow: 0 28px 68px -14px rgba(30, 27, 75, 0.34);
  }
  .win-front img { width: 100%; height: auto; display: block; }
  .cap-bar {
    background: #0f172a; color: #f8fafc; padding: 9px 15px;
    font-size: 12.5px; font-weight: 650; display: flex; align-items: center; justify-content: space-between;
  }
  .cap-dot {
    display: inline-flex; align-items: center; gap: 7px;
  }
  .cap-dot::before {
    content: ""; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; display: inline-block;
  }
  .cap-tag {
    font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11.5px;
    color: #c4b5fd; background: rgba(139, 92, 246, 0.18); padding: 2px 8px; border-radius: 6px;
  }
</style>
</head>
<body>
  <div class="grid-dots"></div>
  <div class="left">
    <div class="lockup">
      <img class="app-icon" src="${logoDataUrl}" alt="" />
      <span class="plus">×</span>
      <div class="fig-icon">${FIGMA_SVG}</div>
      <span class="badge-new">${zh ? '重磅更新 · Figma 原生支持' : 'NEW · Native Figma Integration'}</span>
    </div>
    <div class="eyebrow">
      <span>ProtoFlow AI</span>
      <span class="sep">·</span>
      <span>${zh ? '开源 AI 原型与 ER 建模工作台' : 'Open-Source AI Prototyping & ER Workbench'}</span>
    </div>
    <h1>
      ${zh ? '告别静态画板与看图猜代码' : 'Beyond Static Figma Frames.'}
      <em>${zh ? '把 Figma 变成带真实 ER 表的活原型' : 'Turn .fig Designs into Stateful ER Apps'}</em>
    </h1>
    <p class="lead">
      ${
        zh
          ? '免登录本机离线解析 .fig 与在线 API 双通道接入，高保真还原 Auto Layout，一键升维绑定共享物理表，并通过 MCP 直连 Claude Code 与 Cursor。'
          : '100% offline .fig decoding + Figma REST sync. Preserve Auto Layout, reshape static screens into shared ER database pages, and hand off via MCP.'
      }
    </p>
    <div class="pipeline">
      <div class="step">
        <div class="step-num">01 · IMPORT</div>
        <div class="step-title">${zh ? '离线 .fig / 在线链接' : 'Offline .fig & URL'}</div>
        <div class="step-sub">${zh ? '自动混排 PC+移动，过滤规范页' : 'Hybrid viewports, skips icon noise'}</div>
      </div>
      <div class="step">
        <div class="step-num">02 · RESHAPE</div>
        <div class="step-title">${zh ? '共享 ER 物理表驱动' : 'Shared ER Database'}</div>
        <div class="step-sub">${zh ? '保留原稿对照，生成真实增删改查' : 'Live filters, CRUD & mobile sync'}</div>
      </div>
      <div class="step">
        <div class="step-num">03 · MCP HANDOFF</div>
        <div class="step-title">${zh ? '18 个 MCP 研发工具' : '18 Native MCP Tools'}</div>
        <div class="step-sub">${zh ? '直连 Claude Code / Cursor / Codex' : 'SQL DDL + TSX for Coding Agents'}</div>
      </div>
    </div>
    <div class="pills">
      <span class="pill">${zh ? 'Kiwi 二进制纯本机解码' : 'Local Kiwi + Zstd Parser'}</span>
      <span class="pill">${zh ? 'Auto Layout 弹性还原' : 'Auto Layout + SVG Vectors'}</span>
      <span class="pill">${zh ? '钥匙串加密 & 图片永不过期' : 'Keychain PAT + Permanent Images'}</span>
      <span class="pill">${zh ? '同时支持 Axure .rp' : 'Also Imports Axure .rp'}</span>
    </div>
    <div class="footer">
      <span class="oss">Apache-2.0</span>
      <span>macOS · Windows · Linux</span>
      <span>·</span>
      <span class="url">alex.xclubai.com</span>
    </div>
  </div>
  <div class="right">
    <div class="win-back">
      <img src="${canvasShotUrl || hubShotUrl}" alt="" />
      <div class="cap-bar">
        <span class="cap-dot">${zh ? '高保真还原 Auto Layout、渐变圆角与内嵌矢量位图' : 'Lossless Auto Layout, Rich Text, Gradients & Embedded Assets'}</span>
        <span class="cap-tag">.pflow</span>
      </div>
    </div>
    <div class="win-front">
      <img src="${pickerShotUrl}" alt="" />
      <div class="cap-bar">
        <span class="cap-dot">${zh ? '智能画板树：自动识别多端视口 · 默认跳过组件规范页' : 'Smart Frame Tree: Hybrid PC + Mobile · Auto-Skips Design System'}</span>
        <span class="cap-tag">Figma IR</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildDualImportHtml({ lang, logoDataUrl }) {
  const zh = lang === 'zh';
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1600px; height: 900px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(860px 520px at 14% 8%, rgba(124, 58, 237, 0.18), transparent 65%),
      radial-gradient(860px 560px at 88% 95%, rgba(14, 165, 233, 0.18), transparent 65%),
      linear-gradient(160deg, #070b16 0%, #0d152c 55%, #090f20 100%);
    color: #f8fafc;
    padding: 54px 68px;
    display: flex; flex-direction: column; justify-content: space-between;
    -webkit-font-smoothing: antialiased;
  }
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .brand img { width: 42px; height: 42px; border-radius: 11px; }
  .brand-txt { font-size: 20px; font-weight: 800; color: #e2e8f0; }
  .chip {
    font-size: 12.5px; font-weight: 700; color: #c4b5fd;
    background: rgba(139, 92, 246, 0.18); border: 1px solid rgba(167, 139, 250, 0.35);
    padding: 4px 12px; border-radius: 999px;
  }
  h1 { font-size: ${zh ? '44px' : '42px'}; font-weight: 850; letter-spacing: -0.025em; line-height: 1.18; }
  h1 span { color: #60a5fa; }
  .sub { font-size: 17.5px; color: #94a3b8; margin-top: 8px; max-width: 980px; line-height: 1.5; }

  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 6px; }
  .card {
    border-radius: 22px; padding: 30px 32px;
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.2);
    box-shadow: 0 24px 48px -18px rgba(0, 0, 0, 0.55);
    display: flex; flex-direction: column; gap: 20px;
    position: relative; overflow: hidden;
  }
  .card.offline { border-top: 3px solid #a855f7; }
  .card.online { border-top: 3px solid #38bdf8; }
  .card-head { display: flex; align-items: center; justify-content: space-between; }
  .mode-tag {
    font-size: 12.5px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;
    padding: 5px 12px; border-radius: 8px;
  }
  .offline .mode-tag { background: rgba(168, 85, 247, 0.18); color: #d8b4fe; border: 1px solid rgba(192, 132, 252, 0.35); }
  .online .mode-tag { background: rgba(56, 189, 248, 0.16); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.35); }
  .card h2 { font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -0.015em; }
  .card p.tagline { font-size: 15.5px; color: #cbd5e1; line-height: 1.5; }
  .arch-flow {
    display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;
    background: rgba(2, 6, 23, 0.65); border: 1px solid rgba(148, 163, 184, 0.16);
    padding: 12px 14px; border-radius: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: #e2e8f0;
  }
  .node { background: rgba(30, 41, 59, 0.9); padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.22); white-space: nowrap; }
  .arr { color: #64748b; font-weight: 700; }
  .list { display: flex; flex-direction: column; gap: 13px; }
  .item { display: flex; align-items: flex-start; gap: 12px; }
  .check {
    width: 22px; height: 22px; border-radius: 7px; flex-shrink: 0; margin-top: 2px;
    display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 900;
  }
  .offline .check { background: rgba(168, 85, 247, 0.22); color: #e9d5ff; }
  .online .check { background: rgba(56, 189, 248, 0.2); color: #bae6fd; }
  .item-body strong { font-size: 16px; color: #f8fafc; display: block; margin-bottom: 2px; }
  .item-body span { font-size: 14px; color: #94a3b8; line-height: 1.45; display: block; }

  .bottom-bar {
    background: linear-gradient(90deg, rgba(30, 41, 59, 0.88), rgba(15, 23, 42, 0.92));
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 18px; padding: 18px 28px;
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
  }
  .bottom-left { display: flex; align-items: center; gap: 16px; }
  .fig-mini { width: 42px; height: 42px; border-radius: 11px; background: #020617; border: 1px solid #334155; display: flex; align-items: center; justify-content: center; }
  .fig-mini svg { width: 20px; height: 30px; }
  .bottom-title { font-size: 16.5px; font-weight: 750; color: #f8fafc; }
  .bottom-desc { font-size: 13.5px; color: #94a3b8; margin-top: 2px; }
  .badges { display: flex; gap: 10px; }
  .b-pill {
    font-size: 13px; font-weight: 700; color: #e2e8f0;
    background: rgba(51, 65, 85, 0.65); border: 1px solid rgba(148, 163, 184, 0.25);
    padding: 8px 14px; border-radius: 10px;
  }
</style>
</head>
<body>
  <div class="top">
    <div>
      <div class="brand">
        <img src="${logoDataUrl}" alt="" />
        <span class="brand-txt">ProtoFlow AI × Figma</span>
        <span class="chip">${zh ? '安全与工程化架构' : 'Enterprise-Grade Import Engine'}</span>
      </div>
      <h1>
        ${zh ? '双通道原生接入：' : 'Two Native Channels: '}
        <span>${zh ? '既能 100% 离线解包，也能链接永久固化' : '100% Offline .fig + Permanent API Sync'}</span>
      </h1>
      <p class="sub">
        ${
          zh
            ? '无论是严禁外传的政企内网源文件，还是快速迭代的团队在线画板链接，最终都统一收敛为本地开放可读、永不裂图的 .pflow 工程。'
            : 'Whether working under strict air-gapped NDAs or collaborating via live Figma URLs, every frame compiles cleanly into an open, self-contained local .pflow project.'
        }
      </p>
    </div>
  </div>

  <div class="cards">
    <div class="card offline">
      <div class="card-head">
        <span class="mode-tag">${zh ? '通道 A · 零上传离线解析' : 'Channel A · Zero-Cloud Offline'}</span>
        <span style="font-family:ui-monospace,monospace;font-size:13px;color:#c084fc;">File → Save local copy (.fig)</span>
      </div>
      <h2>${zh ? '免登录直接拖入本地 .fig 文件' : 'Local .fig Binary Drag & Drop'}</h2>
      <p class="tagline">${zh ? '无需 Figma 账号与 Token，内置独立 Worker 在本机毫秒级还原画布结构。' : 'No Figma account or API token required. Decodes archives entirely inside a local Worker.'}</p>
      <div class="arch-flow">
        <span class="node">.fig Archive</span><span class="arr">→</span>
        <span class="node">Zstd / Deflate</span><span class="arr">→</span>
        <span class="node">Kiwi Schema</span><span class="arr">→</span>
        <span class="node">Figma IR</span>
      </div>
      <div class="list">
        <div class="item">
          <div class="check">✓</div>
          <div class="item-body">
            <strong>${zh ? '按所选画板精准解压图片额度' : 'Selection-Scoped Image Unpacking'}</strong>
            <span>${zh ? '未勾选的 50MB 组件库贴图占 0 字节预算，绝不挤掉真实业务画板图片。' : 'Unchecked 50MB design-system sheets consume zero budget—preserving every business asset.'}</span>
          </div>
        </div>
        <div class="item">
          <div class="check">✓</div>
          <div class="item-body">
            <strong>${zh ? '涉密与内网环境 100% 合规' : '100% Air-Gapped & NDA-Compliant'}</strong>
            <span>${zh ? '设计稿字节流不经过任何第三方服务器，支持无外网环境独立运行。' : 'Zero bytes leave your machine—built for regulated finance, enterprise & private networks.'}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card online">
      <div class="card-head">
        <span class="mode-tag">${zh ? '通道 B · 官方 REST API 同步' : 'Channel B · Figma REST API'}</span>
        <span style="font-family:ui-monospace,monospace;font-size:13px;color:#7dd3fc;">figma.com/design/...?node-id=</span>
      </div>
      <h2>${zh ? '粘贴 Figma 链接精准拉取画板' : 'Scoped URL Sync + Never-Expiring Assets'}</h2>
      <p class="tagline">${zh ? '支持整份设计文件链接，也支持带 ?node-id= 的单画板、单分组或单节点链接。' : 'Paste a full file link or target a single frame/section via ?node-id= query parameters.'}</p>
      <div class="arch-flow">
        <span class="node">OS Keychain PAT</span><span class="arr">→</span>
        <span class="node">SSRF Guard</span><span class="arr">→</span>
        <span class="node">Base64 Embed</span><span class="arr">→</span>
        <span class="node">.pflow</span>
      </div>
      <div class="list">
        <div class="item">
          <div class="check">✓</div>
          <div class="item-body">
            <strong>${zh ? '彻底解决 Figma 临时图片 14 天过期裂图' : 'Eliminates Figma’s 14-Day S3 Link Expiration'}</strong>
            <span>${zh ? '自动下载最终保留图层的位图并内嵌进本地 .pflow，数月后打开依然完整无损。' : 'Downloads & embeds referenced bitmaps into .pflow so prototypes never rot with broken URLs.'}</span>
          </div>
        </div>
        <div class="item">
          <div class="check">✓</div>
          <div class="item-body">
            <strong>${zh ? '系统级 safeStorage 钥匙串加密 Token' : 'OS Keychain Token Encryption & SSRF Pinning'}</strong>
            <span>${zh ? '拒绝明文落盘保存 PAT，内置公网 IP 字节级校验与 20 MiB 发布体积预检。' : 'Encrypts PATs via OS safeStorage with byte-level IP validation and 20 MiB publish preflight.'}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="bottom-bar">
    <div class="bottom-left">
      <div class="fig-mini">${FIGMA_SVG}</div>
      <div>
        <div class="bottom-title">${zh ? '智能识别多端视口 & 自动过滤组件库噪音' : 'Smart Hybrid Viewport Detection & Design-System Noise Filtering'}</div>
        <div class="bottom-desc">${zh ? '自动区分 PC &lt;Page&gt; 与移动端 &lt;MobilePage&gt;，默认取消勾选 Design System / Icons 规范页' : 'Routes wide frames to &lt;Page&gt; &amp; mobile frames to &lt;MobilePage&gt; while skipping Component/Icon sheets by default'}</div>
      </div>
    </div>
    <div class="badges">
      <span class="b-pill">Apache-2.0 OSS</span>
      <span class="b-pill">alex.xclubai.com</span>
    </div>
  </div>
</body>
</html>`;
}

function buildErReshapeHtml({ lang, logoDataUrl }) {
  const zh = lang === 'zh';
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1600px; height: 900px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(900px 540px at 50% 0%, rgba(37, 99, 235, 0.12), transparent 68%),
      linear-gradient(165deg, #f8fafc 0%, #eff4fc 55%, #f5f3ff 100%);
    color: #090d1a;
    padding: 52px 64px;
    display: flex; flex-direction: column; justify-content: space-between;
    -webkit-font-smoothing: antialiased;
  }
  .header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
  .brand-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .brand-row img { width: 42px; height: 42px; border-radius: 11px; }
  .brand-row span.name { font-size: 20px; font-weight: 800; }
  .brand-row span.tag {
    font-size: 12.5px; font-weight: 700; color: #1d4ed8; background: #dbeafe;
    padding: 4px 12px; border-radius: 999px;
  }
  h1 { font-size: ${zh ? '39px' : '39px'}; font-weight: 850; letter-spacing: -0.026em; line-height: 1.18; }
  h1 em { font-style: normal; color: #2563eb; display: ${zh ? 'inline' : 'block'}; margin-top: ${zh ? '0' : '4px'}; }
  .header-sub { font-size: 16px; color: #475569; max-width: 580px; text-align: right; line-height: 1.52; }

  .stages {
    display: grid; grid-template-columns: 1fr 44px 1.08fr 44px 1fr; align-items: stretch;
    margin: 10px 0;
  }
  .connector {
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 800; color: #6366f1;
  }
  .stage {
    background: #ffffff; border: 1.5px solid #dbe4f2; border-radius: 22px;
    padding: 26px 26px; display: flex; flex-direction: column; gap: 16px;
    box-shadow: 0 18px 42px -18px rgba(15, 23, 42, 0.12);
  }
  .stage.center {
    border-color: #93c5fd;
    background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    box-shadow: 0 22px 50px -16px rgba(37, 99, 235, 0.2);
  }
  .st-badge {
    display: inline-flex; align-self: flex-start; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 5px 11px; border-radius: 8px;
  }
  .st1 { background: #f3e8ff; color: #6d28d9; }
  .st2 { background: #dbeafe; color: #1d4ed8; }
  .st3 { background: #dcfce7; color: #15803d; }
  .stage h2 { font-size: 23px; font-weight: 800; color: #0f172a; line-height: 1.25; }
  .stage p { font-size: 14.5px; color: #475569; line-height: 1.5; }

  .mock-box {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px;
    display: flex; flex-direction: column; gap: 9px; margin-top: auto;
  }
  .code-tags { display: flex; flex-wrap: wrap; gap: 7px; }
  .ctag {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 650;
    padding: 5px 9px; border-radius: 7px; background: #ffffff; border: 1px solid #cbd5e1; color: #1e293b;
  }
  .ctag.blue { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
  .ctag.purple { background: #faf5ff; border-color: #e9d5ff; color: #7e22ce; }
  .ctag.green { background: #f0fdf4; border-color: #bbf7d0; color: #15803d; }

  .er-card {
    background: #0f172a; color: #f8fafc; border-radius: 12px; padding: 12px 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  }
  .er-head { display: flex; justify-content: space-between; color: #93c5fd; font-weight: 700; margin-bottom: 6px; }
  .er-row { display: flex; justify-content: space-between; color: #cbd5e1; padding: 2.5px 0; border-top: 1px solid rgba(148,163,184,0.15); }
  .er-row em { font-style: normal; color: #34d399; }

  .agent-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .agent {
    background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 9px 12px;
    font-size: 13.5px; font-weight: 750; color: #0f172a; display: flex; align-items: center; gap: 8px;
  }
  .agent i { width: 8px; height: 8px; border-radius: 50%; background: #2563eb; display: inline-block; }

  .bottom {
    background: #090d1a; color: #f8fafc; border-radius: 18px; padding: 18px 28px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .b-items { display: flex; align-items: center; gap: 28px; font-size: 14.5px; font-weight: 600; color: #e2e8f0; }
  .b-items span b { color: #60a5fa; }
  .b-url { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 14px; color: #93c5fd; font-weight: 700; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand-row">
        <img src="${logoDataUrl}" alt="" />
        <span class="name">ProtoFlow AI</span>
        <span class="tag">${zh ? '双层物料架构 + MCP 研发闭环' : 'Dual-Layer Engine + MCP Closed Loop'}</span>
      </div>
      <h1>
        ${zh ? '从静态 Figma 图层，到' : 'From Static Figma Layers to '}
        <em>${zh ? '共享 ER 物理表与生产级代码' : 'Live ER Tables & Coding Agents'}</em>
      </h1>
    </div>
    <p class="header-sub">
      ${
        zh
          ? '先 1:1 还原视觉，再按选定范围受控升维业务组件——原始 Figma 画板完整保留对照，绝不搞一次性黑盒转换。'
          : 'Restore pixel-true layouts first, then selectively upgrade chosen frames into database-backed pages—keeping original Figma frames side-by-side.'
      }
    </p>
  </div>

  <div class="stages">
    <div class="stage">
      <span class="st-badge st1">${zh ? '第 1 层 · 高保真视觉还原' : 'Layer 01 · Lossless Restoration'}</span>
      <h2>${zh ? '原生承接 Auto Layout 与矢量细节' : 'Pixel-True Auto Layout & Vectors'}</h2>
      <p>${zh ? '精确解析横纵弹性布局、间距内边距、FILL/HUG 尺寸、线性渐变、毛玻璃阴影、多段富文本与二进制 SVG 路径。' : 'Preserves Flexbox Auto Layout, gap/padding, FILL/HUG sizing, gradients, blur, rich text runs & binary commandsBlob SVG paths.'}</p>
      <div class="mock-box">
        <div style="font-size:12px;font-weight:700;color:#64748b;">${zh ? 'Figma 专属还原图元' : 'Dedicated Figma Primitives'}</div>
        <div class="code-tags">
          <span class="ctag purple">&lt;FigmaCanvas&gt;</span>
          <span class="ctag purple">&lt;FigmaFrame&gt;</span>
          <span class="ctag purple">&lt;FigmaText&gt;</span>
          <span class="ctag purple">&lt;FigmaVector&gt;</span>
          <span class="ctag purple">&lt;FigmaImage&gt;</span>
        </div>
        <div style="font-size:12.5px;color:#475569;padding-top:4px;border-top:1px dashed #cbd5e1;">
          ${zh ? '✓ 导入立即可视化编辑文本、配色与结构' : '✓ Immediately editable offline right after import'}
        </div>
      </div>
    </div>

    <div class="connector">→</div>

    <div class="stage center">
      <span class="st-badge st2">${zh ? '第 2 层 · 受控 AI 业务升维' : 'Layer 02 · Scoped AI + Shared ER'}</span>
      <h2>${zh ? '绑定共享物理表，PC 与移动端实时共表' : 'Reshape into Live ER-Backed Pages'}</h2>
      <p>${zh ? '框定单页或目录后，AI 先只读盘点重复卡片/表头并核对字段，同目录生成带真实筛选与弹窗交互的 fig-optimized 页面。' : 'Select a frame or folder: Project AI inventories repeating rows, aligns on ER schemas, and builds live CRUD/filter pages alongside the original.'}</p>
      <div class="er-card">
        <div class="er-head"><span>DBTableSchema · t_omnichannel_orders</span><span>PK / FK</span></div>
        <div class="er-row"><span>order_no · customer_id</span><em>VARCHAR · FK</em></div>
        <div class="er-row"><span>channel · fulfillment_status</span><em>ENUM · INDEX</em></div>
      </div>
      <div class="mock-box" style="margin-top:0;">
        <div class="code-tags">
          <span class="ctag blue">NavMenu</span>
          <span class="ctag blue">QueryForm</span>
          <span class="ctag blue">Table</span>
          <span class="ctag blue">CardGrid</span>
          <span class="ctag blue">Carousel</span>
          <span class="ctag blue">MBannerCarousel</span>
          <span class="ctag blue">MCardGrid</span>
        </div>
      </div>
    </div>

    <div class="connector">→</div>

    <div class="stage">
      <span class="st-badge st3">${zh ? '第 3 步 · MCP 零猜测交接' : 'Step 03 · Native MCP Handoff'}</span>
      <h2>${zh ? '18 个 MCP 工具直连 AI 编程助手' : '18 MCP Tools for Coding Agents'}</h2>
      <p>${zh ? '告别把静态截图喂给大模型猜字段！研发 IDE 直接拉取标准 SQL DDL、流式 TSX 与锚定便签规则生成生产代码。' : 'Stop pasting flat screenshots into LLMs. Coding agents read verified PostgreSQL/MySQL DDL, clean TSX, and sticky-note contracts directly.'}</p>
      <div class="mock-box">
        <div style="font-size:12px;font-weight:700;color:#64748b;">${zh ? '原生支持主流 AI 研发终端' : 'Works Out-of-the-Box With'}</div>
        <div class="agent-grid">
          <div class="agent"><i></i>Claude Code</div>
          <div class="agent"><i></i>Cursor</div>
          <div class="agent"><i></i>Codex CLI</div>
          <div class="agent"><i></i>Antigravity</div>
        </div>
        <div class="code-tags" style="margin-top:4px;">
          <span class="ctag green">get_database_schema</span>
          <span class="ctag green">get_page_spec</span>
        </div>
      </div>
    </div>
  </div>

  <div class="bottom">
    <div class="b-items">
      <span><b>✓</b> ${zh ? '单页 / 目录范围严格隔离' : 'Strict Frame/Folder Scope Isolation'}</span>
      <span><b>✓</b> ${zh ? '原始 Figma 画板无损保留对照' : 'Original Figma Frames Preserved Side-by-Side'}</span>
      <span><b>✓</b> ${zh ? '导出标准 PostgreSQL / MySQL DDL' : 'Exports Clean PostgreSQL & MySQL DDL'}</span>
    </div>
    <span class="b-url">github.com/EvanClub-Agent/protoflow-ai</span>
  </div>
</body>
</html>`;
}

function buildUiShowcaseHtml({ lang, logoDataUrl, hubShotUrl, pickerShotUrl }) {
  const zh = lang === 'zh';
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1600px; height: 900px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(820px 540px at 90% 8%, rgba(124, 58, 237, 0.14), transparent 65%),
      radial-gradient(760px 520px at 8% 96%, rgba(37, 99, 235, 0.13), transparent 65%),
      linear-gradient(155deg, #f8fafc 0%, #eef3fb 55%, #f5f3ff 100%);
    color: #090d1a;
    padding: 48px 58px;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 26px;
    -webkit-font-smoothing: antialiased;
  }
  .top {
    display: flex; align-items: center; justify-content: space-between; gap: 24px;
  }
  .title-block { display: flex; flex-direction: column; gap: 8px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 38px; height: 38px; border-radius: 10px; }
  .brand-name { font-size: 18px; font-weight: 800; color: #0f172a; }
  .pill-ax {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12.5px; font-weight: 700; color: #4c1d95;
    background: #ede9fe; border: 1px solid #c4b5fd; padding: 4px 11px; border-radius: 999px;
  }
  h1 { font-size: ${zh ? '32px' : '31px'}; font-weight: 850; letter-spacing: -0.024em; line-height: 1.22; }
  h1 span { color: #6d28d9; }

  .highlights { display: flex; gap: 10px; flex-shrink: 0; }
  .hl {
    background: #ffffff; border: 1px solid #dbe4f2; border-radius: 14px; padding: 11px 14px;
    box-shadow: 0 6px 18px -8px rgba(15, 23, 42, 0.08);
    width: 226px;
  }
  .hl b { font-size: 13px; color: #0f172a; display: block; margin-bottom: 3px; white-space: nowrap; }
  .hl span { font-size: 11.8px; color: #64748b; line-height: 1.38; display: block; }

  .stage {
    display: grid; grid-template-columns: 1.16fr 0.84fr; gap: 24px;
    align-items: center; min-height: 0; height: 100%;
  }
  .shot-hub, .shot-picker {
    border-radius: 18px; overflow: hidden; background: #ffffff;
    display: flex; flex-direction: column; max-height: 696px;
  }
  .shot-hub {
    border: 1.5px solid #cbd5e1;
    box-shadow: 0 22px 52px -18px rgba(15, 23, 42, 0.2);
  }
  .shot-picker {
    border: 2px solid #a78bfa;
    box-shadow: 0 26px 60px -14px rgba(30, 27, 75, 0.28);
  }
  .shot-body {
    background: #f8fafc; display: flex; align-items: center; justify-content: center;
    overflow: hidden; flex: 1; min-height: 0;
  }
  .shot-hub img, .shot-picker img {
    width: 100%; height: 100%; max-height: 654px; object-fit: contain; object-position: top center; display: block;
  }
  .bar {
    background: #0f172a; color: #f8fafc; padding: 9px 16px;
    font-size: 12.5px; font-weight: 650; display: flex; justify-content: space-between; align-items: center;
  }
  .bar em { font-style: normal; color: #a5b4fc; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11.5px; }
</style>
</head>
<body>
  <div class="top">
    <div class="title-block">
      <div class="brand">
        <img src="${logoDataUrl}" alt="" />
        <span class="brand-name">ProtoFlow AI</span>
        <span class="pill-ax">${zh ? '设计工具导入中心 · Figma + Axure RP' : 'Unified Design Import Hub · Figma + Axure RP'}</span>
      </div>
      <h1>
        ${zh ? '真实工作台实拍：' : 'Inside the Workbench: '}
        <span>${zh ? '多端视口自动识别，组件规范页一键智能过滤' : 'Smart Frame Tree Picker & Dual-Tool Hub'}</span>
      </h1>
    </div>
    <div class="highlights">
      <div class="hl">
        <b>${zh ? '🖥 + 📱 多端混排自动识别' : '🖥 + 📱 Auto Hybrid Mode'}</b>
        <span>${zh ? '按画板宽高自动映射 PC 页面与 iPhone 视口' : 'Maps wide & mobile frames into one hybrid project'}</span>
      </div>
      <div class="hl">
        <b>${zh ? '🧹 默认跳过规范与图标页' : '🧹 Skips Design-System Noise'}</b>
        <span>${zh ? '保持左侧业务目录树清爽，随时可手动勾选' : 'Auto-unchecks Icon/Token sheets with manual override'}</span>
      </div>
      <div class="hl">
        <b>${zh ? '📦 Figma .fig + Axure .rp' : '📦 Figma .fig + Axure .rp'}</b>
        <span>${zh ? '两大主流存量设计资产一站式转入活原型' : 'Bring both design & legacy RP assets into one studio'}</span>
      </div>
    </div>
  </div>

  <div class="stage">
    <div class="shot-hub">
      <div class="bar">
        <span>${zh ? '① 全新「导入设计稿」专区（Figma 双通道 + Axure RP 离线解析）' : '① Unified Design Import Hub (Figma Dual-Mode + Offline Axure RP)'}</span>
        <em>Import Designs</em>
      </div>
      <div class="shot-body"><img src="${hubShotUrl}" alt="" /></div>
    </div>
    <div class="shot-picker">
      <div class="bar">
        <span>${zh ? '② 智能画板树（多端自动识别 · 默认跳过规范页）' : '② Smart Frame Picker (Hybrid Viewports · Clean Sitemap)'}</span>
        <em>FigmaImportDialog</em>
      </div>
      <div class="shot-body"><img src="${pickerShotUrl}" alt="" /></div>
    </div>
  </div>
</body>
</html>`;
}

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-figma-promo-'));
  app.setPath('userData', userDataDir);
  app.on('window-all-closed', (e) => e.preventDefault());

  app.whenReady().then(async () => {
    app.dock?.hide();
    fs.mkdirSync(outDir, { recursive: true });
    const servers = [];
    const windows = [];
    try {
      const distDir = path.join(root, 'dist');
      if (!fs.existsSync(path.join(distDir, 'index.html'))) {
        throw new Error('Missing dist/index.html — run npm run build first');
      }
      const distServer = await startStaticServer(distDir);
      servers.push(distServer);

      const figSamplePath = path.join(root, 'examples/figma-samples/电商全渠道运营系统-多端混合.fig');
      const figBytesB64 = fs.readFileSync(figSamplePath).toString('base64');
      const logoSvg = fs.readFileSync(path.join(root, 'public/logo.svg'), 'utf8');
      const logoDataUrl = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString('base64')}`;

      const waitIn = async (win, expr, label, maxSteps = 250) => {
        for (let i = 0; i < maxSteps; i++) {
          const ok = await win.webContents.executeJavaScript(`Boolean(${expr})`).catch(() => false);
          if (ok) return;
          await new Promise((r) => setTimeout(r, 40));
        }
        throw new Error(`Timed out waiting for ${label}`);
      };

      async function captureRealUiForLocale(locale) {
        const isZh = locale === 'zh-CN';
        const win = new BrowserWindow({
          show: false,
          width: 1440,
          height: 900,
          useContentSize: true,
          backgroundColor: '#f8fafc',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            deviceScaleFactor: 2,
          },
        });
        windows.push(win);
        win.webContents.setZoomFactor(1);

        await win.loadURL(`${distServer.origin}/index.html`);
        await win.webContents.executeJavaScript(`
          localStorage.setItem('protoflow-locale', ${JSON.stringify(locale)});
        `);
        await win.loadURL(`${distServer.origin}/index.html`);

        // Pass AccountGate if shown
        await waitIn(
          win,
          `Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('免登录本地使用') || b.textContent.includes('Use Locally') || b.textContent.includes('导入设计稿') || b.textContent.includes('Import Designs')))`,
          `Launcher ready (${locale})`,
        );
        await win.webContents.executeJavaScript(`
          (() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('免登录本地使用') || b.textContent.includes('Use Locally')));
            if (btn) btn.click();
          })()
        `);

        // Click "导入设计稿" / "Import Designs"
        const navLabel = isZh ? '导入设计稿' : 'Import Designs';
        await waitIn(
          win,
          `Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes(${JSON.stringify(navLabel)}))`,
          `Import Designs nav (${locale})`,
        );
        await win.webContents.executeJavaScript(`
          Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes(${JSON.stringify(navLabel)})).click();
        `);
        await new Promise((r) => setTimeout(r, 350));

        const hubRect = await win.webContents.executeJavaScript(`
          (() => {
            const card = Array.from(document.querySelectorAll('div')).find(el => {
              const r = el.getBoundingClientRect();
              return r.width >= 820 && r.width <= 1220 && r.height >= 480 && r.height <= 820 && el.innerText && (el.innerText.includes('Axure RP') && el.innerText.includes('Figma'));
            });
            if (!card) return null;
            const r = card.getBoundingClientRect();
            return { x: Math.max(0, Math.floor(r.x - 12)), y: Math.max(0, Math.floor(r.y - 12)), width: Math.ceil(r.width + 24), height: Math.ceil(r.height + 24) };
          })()
        `);
        const hubImg = hubRect ? await win.webContents.capturePage(hubRect) : await win.webContents.capturePage();
        const hubPng = hubImg.toPNG();

        // Open Figma Import Dialog and drop the hybrid .fig archive
        const openBtnLabel = isZh ? '导入本地 .fig 文件' : 'Import Local .fig';
        await win.webContents.executeJavaScript(`
          Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes(${JSON.stringify(openBtnLabel)})).click();
        `);
        await waitIn(win, `document.querySelector('dialog[open] input[type="file"]')`, `Figma dialog input (${locale})`);

        const fileName = isZh ? '电商全渠道运营系统-多端混合.fig' : 'Omnichannel-Commerce-Suite-Hybrid.fig';
        await win.webContents.executeJavaScript(`
          (() => {
            const b64 = ${JSON.stringify(figBytesB64)};
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const file = new File([bytes], ${JSON.stringify(fileName)}, { type: 'application/octet-stream' });
            const dt = new DataTransfer();
            dt.items.add(file);
            const input = document.querySelector('dialog[open] input[type="file"]');
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          })()
        `);

        // Wait for parsed frame tree button to appear
        const confirmKeyword = isZh ? '个画板为新工程' : 'as New Project';
        await waitIn(
          win,
          `Array.from(document.querySelectorAll('dialog[open] button')).find(b => b.textContent && b.textContent.includes(${JSON.stringify(confirmKeyword)}))`,
          `Parsed frame tree (${locale})`,
        );

        // For English screenshot polish, translate sample fixture frame titles cleanly in DOM if locale is en-US
        if (!isZh) {
          await win.webContents.executeJavaScript(`
            (() => {
              const map = [
                ['电商全渠道运营系统 (多端混合)', 'Omnichannel Commerce Suite (Hybrid)'],
                ['电商全渠道运营系统', 'Omnichannel Commerce Suite'],
                ['Design System / 组件规范库', 'Design System / Component Library'],
                ['PC 运营管理后台', 'Desktop Operations Admin'],
                ['订单履约工作台', 'Order Fulfillment Console'],
                ['商品库存画廊', 'Product Inventory Gallery'],
                ['C端移动商城小程序', 'Mobile Storefront App'],
                ['核心购物链路', 'Core Shopping Flow'],
                ['移动商城首页', 'Mobile Storefront Home'],
                ['商品详情与下单', 'Product Detail & Checkout'],
                ['商品详情与结算页', 'Product Detail & Checkout'],
                ['移动商品详情页', 'Mobile Product Detail'],
              ];
              const walker = document.createTreeWalker(document.querySelector('dialog[open]'), NodeFilter.SHOW_TEXT);
              const nodes = [];
              while (walker.nextNode()) nodes.push(walker.currentNode);
              for (const n of nodes) {
                let txt = n.nodeValue || '';
                for (const [k, v] of map) txt = txt.split(k).join(v);
                n.nodeValue = txt;
              }
              for (const inp of document.querySelectorAll('input')) {
                let val = inp.value || '';
                for (const [k, v] of map) val = val.split(k).join(v);
                if (val !== inp.value) inp.value = val;
              }
            })()
          `);
        }
        await new Promise((r) => setTimeout(r, 300));

        // Capture tight crop around the open <dialog>
        const rect = await win.webContents.executeJavaScript(`
          (() => {
            const d = document.querySelector('dialog[open]');
            const r = d.getBoundingClientRect();
            return { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.ceil(r.width), height: Math.ceil(r.height) };
          })()
        `);
        const pickerImg = await win.webContents.capturePage(rect);
        const pickerPng = pickerImg.toPNG();

        // Click import to capture real imported Figma workbench!
        await win.webContents.executeJavaScript(`
          Array.from(document.querySelectorAll('dialog[open] button')).find(b => b.textContent && b.textContent.includes(${JSON.stringify(confirmKeyword)})).click();
        `);
        await waitIn(
          win,
          `document.body.innerText.includes('订单履约工作台') && !document.getElementById('figma-import-heading')`,
          `Imported Figma workbench ready (${locale})`,
        );
        await new Promise((r) => setTimeout(r, 450));
        // Dismiss result summary dialog if open
        await win.webContents.executeJavaScript(`
          (() => {
            const doneBtn = Array.from(document.querySelectorAll('dialog[open] button')).find(b => b.textContent && (b.textContent.trim() === '完成' || b.textContent.trim() === 'Done'));
            if (doneBtn) doneBtn.click();
          })()
        `);
        await new Promise((r) => setTimeout(r, 550));
        if (!isZh) {
          await win.webContents.executeJavaScript(`
            (() => {
              const map = [
                ['电商全渠道运营系统-多端混合', 'Omnichannel Commerce Suite'],
                ['电商全渠道运营系统', 'Omnichannel Commerce Suite'],
                ['PC 运营管理后台', 'Desktop Admin'],
                ['订单履约工作台', 'Order Fulfillment Console'],
                ['商品库存画廊 (点击跳转)', 'Product Inventory Gallery'],
                ['商品库存画廊', 'Product Inventory Gallery'],
                ['移动端商城预览 (点击跳转)', 'Mobile Storefront Preview'],
                ['C端移动商城小程序', 'Mobile Storefront'],
                ['核心购物链路', 'Shopping Flow'],
                ['移动商城首页', 'Storefront Home'],
                ['云枢全渠道 OMS', 'CloudHub OMS'],
                ['+ 新建销售单', '+ New Order'],
                ['今日成交总额 (GMV)', 'Today GMV'],
                ['¥ 128,640', '$ 128,640'],
                ['+18.4% 较昨日', '+18.4% vs yesterday'],
                ['待审核发货单', 'Pending Shipments'],
                ['42 单', '42 Orders'],
                ['其中加急 7 单', '7 Express'],
                ['全仓履约准时率', 'On-Time Fulfillment'],
                ['高于目标 2.6%', '+2.6% above SLA'],
                ['异常售后处理中', 'Open Escalations'],
                ['5 单', '5 Cases'],
                ['2h 内响应率 100%', '100% <2h SLA'],
                ['查询', 'Filter'],
                ['订单编号', 'Order ID'],
                ['客户名称', 'Customer'],
                ['渠道来源', 'Channel'],
                ['订单金额', 'Amount'],
                ['履约状态', 'Status'],
                ['操作', 'Action'],
                ['上海星云智能科技', 'Nebula AI Corp'],
                ['杭州极客精选百货', 'GeekSelect Retail'],
                ['深圳湾创新实验室', 'Bay Area Labs'],
                ['成都锦江严选门店', 'Jinjiang Flagship'],
                ['企业直采', 'Enterprise B2B'],
                ['微信小程序', 'Mini-App'],
                ['官网商城', 'Web Store'],
                ['移动订货端', 'Mobile App'],
                ['待发货', 'Pending'],
                ['已发货', 'Shipped'],
                ['已签收', 'Delivered'],
                ['待审核', 'Review'],
                ['查看商品 →', 'Inspect →'],
              ];
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              const nodes = [];
              while (walker.nextNode()) nodes.push(walker.currentNode);
              for (const n of nodes) {
                let txt = n.nodeValue || '';
                for (const [k, v] of map) txt = txt.split(k).join(v);
                n.nodeValue = txt;
              }
              for (const inp of document.querySelectorAll('input')) {
                let val = inp.value || '';
                for (const [k, v] of map) val = val.split(k).join(v);
                if (val !== inp.value) inp.value = val;
              }
            })()
          `);
          await new Promise((r) => setTimeout(r, 200));
        }
        const canvasImg = await win.webContents.capturePage();
        const canvasPng = canvasImg.resize({ width: 1440, height: 900, quality: 'best' }).toPNG();

        win.destroy();
        return {
          hubDataUrl: `data:image/png;base64,${hubPng.toString('base64')}`,
          pickerDataUrl: `data:image/png;base64,${pickerPng.toString('base64')}`,
          canvasDataUrl: canvasPng ? `data:image/png;base64,${canvasPng.toString('base64')}` : null,
          rawHubPng: hubPng,
          rawPickerPng: pickerPng,
          rawCanvasPng: canvasPng,
        };
      }

      const zhShots = await captureRealUiForLocale('zh-CN');
      const enShots = await captureRealUiForLocale('en-US');

      // Save raw real UI screenshots as bonus attachments too
      fs.writeFileSync(path.join(outDir, 'raw-workbench-figma-zh.png'), zhShots.rawCanvasPng);
      fs.writeFileSync(path.join(outDir, 'raw-workbench-figma-en.png'), enShots.rawCanvasPng);

      // Render 1600x900 (@2x Retina -> resized cleanly to 1600x900) poster cards
      const posterWin = new BrowserWindow({
        show: false,
        width: 1600,
        height: 900,
        useContentSize: true,
        backgroundColor: '#090d1a',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          deviceScaleFactor: 2,
        },
      });
      windows.push(posterWin);

      async function renderCard(fileName, html) {
        const tmpHtmlPath = path.join(userDataDir, `${fileName}.html`);
        fs.writeFileSync(tmpHtmlPath, html, 'utf8');
        await posterWin.loadFile(tmpHtmlPath);
        await posterWin.webContents.executeJavaScript(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 220))))`);
        const img = await posterWin.webContents.capturePage();
        const png = img.resize({ width: 1600, height: 900, quality: 'best' }).toPNG();
        fs.writeFileSync(path.join(outDir, fileName), png);
      }

      // Chinese 4-card set
      await renderCard(
        '01-hero-figma-launch-zh.png',
        buildHeroHtml({
          lang: 'zh',
          logoDataUrl,
          hubShotUrl: zhShots.hubDataUrl,
          pickerShotUrl: zhShots.pickerDataUrl,
          canvasShotUrl: zhShots.canvasDataUrl,
        }),
      );
      await renderCard('02-dual-import-zh.png', buildDualImportHtml({ lang: 'zh', logoDataUrl }));
      await renderCard('03-er-reshape-zh.png', buildErReshapeHtml({ lang: 'zh', logoDataUrl }));
      await renderCard(
        '04-ui-showcase-zh.png',
        buildUiShowcaseHtml({
          lang: 'zh',
          logoDataUrl,
          hubShotUrl: zhShots.hubDataUrl,
          pickerShotUrl: zhShots.pickerDataUrl,
        }),
      );

      // English 4-card set
      // Capture an English workbench canvas screenshot too or use clean hub/canvas
      await renderCard(
        '01-hero-figma-launch-en.png',
        buildHeroHtml({
          lang: 'en',
          logoDataUrl,
          hubShotUrl: enShots.hubDataUrl,
          pickerShotUrl: enShots.pickerDataUrl,
          canvasShotUrl: enShots.canvasDataUrl,
        }),
      );
      await renderCard('02-dual-import-en.png', buildDualImportHtml({ lang: 'en', logoDataUrl }));
      await renderCard('03-er-reshape-en.png', buildErReshapeHtml({ lang: 'en', logoDataUrl }));
      await renderCard(
        '04-ui-showcase-en.png',
        buildUiShowcaseHtml({
          lang: 'en',
          logoDataUrl,
          hubShotUrl: enShots.hubDataUrl,
          pickerShotUrl: enShots.pickerDataUrl,
        }),
      );

      console.log(
        JSON.stringify({
          ok: true,
          outDir,
          files: fs.readdirSync(outDir).sort(),
        }),
      );
      app.exit(0);
    } catch (err) {
      console.error(err);
      app.exit(1);
    } finally {
      for (const win of windows) {
        if (!win.isDestroyed()) win.destroy();
      }
      await Promise.allSettled(servers.map((s) => s.close()));
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
} else {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 120000 });
  if (child.status !== 0) {
    throw new Error(child.error?.message || child.stderr || child.stdout || `Electron exited with ${child.status}`);
  }
  console.log(child.stdout.trim());
}
