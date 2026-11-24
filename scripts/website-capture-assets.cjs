#!/usr/bin/env node
/*
 * Captures fresh visual assets for ProtoFlow AI website & docs using headless Electron:
 *   1. website/assets/workbench-screenshot.png + docs/assets/workbench-screenshot.png (1600x980)
 *   2. website/assets/mobile-preview.png (960x760, from website/demo/#mob-crm-approvals)
 *   3. website/assets/social-preview.jpg + docs/assets/social-preview.png (1280x640)
 *
 * Usage:
 *   npm run build
 *   npm run website:demo
 *   npx electron scripts/website-capture-assets.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

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

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-capture-profile-'));
  app.setPath('userData', userDataDir);
  app.on('window-all-closed', (e) => e.preventDefault());

  app.whenReady().then(async () => {
    app.dock?.hide();
    const servers = [];
    const windows = [];
    try {
      const distDir = path.join(root, 'dist');
      if (!fs.existsSync(path.join(distDir, 'index.html'))) {
        throw new Error('Missing dist/index.html — run npm run build first');
      }
      const distServer = await startStaticServer(distDir);
      servers.push(distServer);
      const websiteServer = await startStaticServer(path.join(root, 'website'));
      servers.push(websiteServer);

      const waitIn = async (win, expr, label, maxSteps = 300) => {
        for (let i = 0; i < maxSteps; i++) {
          const ok = await win.webContents.executeJavaScript(`Boolean(${expr})`).catch(() => false);
          if (ok) return;
          await new Promise((r) => setTimeout(r, 40));
        }
        throw new Error(`Timed out waiting for ${label}`);
      };

      // 1. Capture clean Desktop CRM Workbench (1600x980)
      const wbWin = new BrowserWindow({
        show: false,
        width: 1600,
        height: 980,
        useContentSize: true,
        backgroundColor: '#f3f5f8',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          deviceScaleFactor: 2,
        },
      });
      windows.push(wbWin);
      wbWin.webContents.setZoomFactor(1);

      await wbWin.loadURL(`${distServer.origin}/index.html`);
      await wbWin.webContents.executeJavaScript(`localStorage.setItem('protoflow-locale', 'zh-CN')`);
      await wbWin.loadURL(`${distServer.origin}/index.html`);

      // Wait for either AccountGate ("免登录本地使用") or Welcome Launcher ("新建项目")
      await waitIn(
        wbWin,
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('免登录本地使用') || b.textContent.trim() === '新建项目'))`,
        'AccountGate or New Project button',
      );
      await wbWin.webContents.executeJavaScript(`
        (() => {
          const localBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('免登录本地使用'));
          if (localBtn) localBtn.click();
        })()
      `);

      // On Welcome Launcher -> click "新建项目"
      await waitIn(
        wbWin,
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === '新建项目')`,
        'New Project button on launcher',
      );
      await wbWin.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === '新建项目').click()`);

      // Select "PC + 移动多端协同" and "CRM 合同与业财回款系统"
      await waitIn(
        wbWin,
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('PC + 移动多端协同'))`,
        'Hybrid mode button',
      );
      await wbWin.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('PC + 移动多端协同')).click()`);
      await waitIn(
        wbWin,
        `Array.from(document.querySelectorAll('span')).find(s => s.textContent && s.textContent.trim() === 'CRM 合同与业财回款系统')`,
        'CRM starter card',
      );
      await wbWin.webContents.executeJavaScript(`Array.from(document.querySelectorAll('span')).find(s => s.textContent && s.textContent.trim() === 'CRM 合同与业财回款系统').closest('div[class*="cursor-pointer"]').click()`);
      await wbWin.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('创建并进入工作台')).click()`);

      // Wait for CRM dashboard charts + table to render cleanly
      await waitIn(
        wbWin,
        `document.querySelectorAll('[data-chart-status="ready"]').length >= 2 && document.querySelector('table') && document.body.innerText.includes('CRM 业财经营与回款总览')`,
        'CRM dashboard rendered',
      );
      // Select the overdue table or line chart cleanly if available, and wait for ECharts animation to settle
      await wbWin.webContents.executeJavaScript(`
        (() => {
          const chart = document.querySelector('[data-chart-type="LineChart"]');
          if (chart) chart.click();
        })()
      `);
      await wbWin.webContents.executeJavaScript(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 900))))`);
      const wbImage = await wbWin.webContents.capturePage();
      const wbPng = wbImage.resize({ width: 1600, height: 980, quality: 'best' }).toPNG();
      fs.writeFileSync(path.join(root, 'website/assets/workbench-screenshot.png'), wbPng);
      fs.writeFileSync(path.join(root, 'docs/assets/workbench-screenshot.png'), wbPng);

      // 2. Capture Mobile Viewport Preview (960x760) from website/demo/#mob-crm-approvals
      const mobWin = new BrowserWindow({
        show: false,
        width: 960,
        height: 760,
        useContentSize: true,
        backgroundColor: '#f8fafc',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          deviceScaleFactor: 2,
        },
      });
      windows.push(mobWin);
      await mobWin.loadURL(`${websiteServer.origin}/demo/#mob-crm-approvals`);
      await waitIn(
        mobWin,
        `document.querySelector('.pf-mobile-canvas-stage') && document.body.innerText.includes('合同') && !document.body.innerText.includes('正在加载')`,
        'mobile approvals preview ready',
      );
      await mobWin.webContents.executeJavaScript(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 350))))`);
      const mobImage = await mobWin.webContents.capturePage();
      const mobPng = mobImage.resize({ width: 960, height: 760, quality: 'best' }).toPNG();
      fs.writeFileSync(path.join(root, 'website/assets/mobile-preview.png'), mobPng);

      // 3. Render Branded Social Preview Card (1280x640)
      const logoSvg = fs.readFileSync(path.join(root, 'website/assets/logo.svg'), 'utf8');
      const logoDataUrl = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString('base64')}`;
      const wbDataUrl = `data:image/png;base64,${wbPng.toString('base64')}`;
      const socialHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px; height: 640px; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: radial-gradient(760px 520px at 8% 0%, rgba(29, 78, 216, 0.14), transparent 65%),
                radial-gradient(640px 460px at 95% 100%, rgba(3, 105, 161, 0.12), transparent 65%),
                linear-gradient(155deg, #f8fafc 0%, #eff4fb 55%, #f5f7fb 100%);
    color: #0b1220;
    display: grid;
    grid-template-columns: 515px 1fr;
    gap: 32px;
    padding: 48px 0 48px 56px;
    align-items: center;
    -webkit-font-smoothing: antialiased;
  }
  .left { display: flex; flex-direction: column; gap: 20px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand img { width: 48px; height: 48px; border-radius: 12px; box-shadow: 0 8px 20px -6px rgba(29, 78, 216, 0.32); }
  .brand-name { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: #0b1220; }
  .brand-tag {
    font-size: 13px; font-weight: 600; color: #1d4ed8;
    background: #eff6ff; border: 1px solid #bfdbfe;
    padding: 4px 10px; border-radius: 999px;
  }
  h1 {
    font-size: 40px; line-height: 1.18; font-weight: 800; letter-spacing: -0.025em;
    color: #090d1a;
  }
  h1 span { color: #1d4ed8; display: block; margin-top: 4px; font-size: 36px; }
  .desc { font-size: 16px; line-height: 1.55; color: #475569; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill {
    font-size: 13px; font-weight: 600; color: #1e293b;
    background: #ffffff; border: 1px solid #d7e1ef;
    padding: 6px 12px; border-radius: 10px;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
  }
  .meta {
    display: flex; align-items: center; gap: 10px; font-size: 13px; color: #475569; font-weight: 500;
    margin-top: 4px;
  }
  .oss {
    background: #090d1a; color: #f8fafc; font-weight: 700; font-size: 12px;
    padding: 4px 10px; border-radius: 6px;
  }
  .right {
    height: 544px; position: relative; display: flex; align-items: center;
  }
  .frame {
    width: 820px; border-radius: 16px 0 0 16px; overflow: hidden;
    background: #ffffff; border: 1px solid #cbd5e1; border-right: 0;
    box-shadow: -12px 24px 56px -14px rgba(15, 23, 42, 0.22);
  }
  .frame img { width: 100%; height: auto; display: block; }
  .frame-bar {
    padding: 9px 16px; background: #f8fafc; border-top: 1px solid #e2e8f0;
    font-size: 12px; font-weight: 600; color: #0369a1; display: flex; align-items: center; gap: 8px;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #16a34a; display: inline-block; }
</style>
</head>
<body>
  <div class="left">
    <div class="brand">
      <img src="${logoDataUrl}" alt="" />
      <span class="brand-name">ProtoFlow AI</span>
      <span class="brand-tag">原名 Alex</span>
    </div>
    <h1>开源 AI 原型设计工具<span>把需求做成能跑起来的业务原型</span></h1>
    <p class="desc">先澄清边界再生成页面与共享 ER 物理表 · PC 中后台与 iPhone 视口实时联动 · 免装 Axure 导入 .rp · MCP 双向直连研发</p>
    <div class="pills">
      <span class="pill">共享 ER 物理表</span>
      <span class="pill">18 个 MCP 协同工具</span>
      <span class="pill">Axure .rp 本地解析</span>
      <span class="pill">Docker 私有化评审</span>
    </div>
    <div class="meta">
      <span class="oss">Apache-2.0</span>
      <span>macOS · Windows · Linux · 免登录本地可用</span>
    </div>
  </div>
  <div class="right">
    <div class="frame">
      <img src="${wbDataUrl}" alt="" />
      <div class="frame-bar"><span class="dot"></span>本地 .pflow 工程 · 5 张共享 ER 表 · 6 个 PC + 移动联动页面</div>
    </div>
  </div>
</body>
</html>`;

      const socialWin = new BrowserWindow({
        show: false,
        width: 1280,
        height: 640,
        useContentSize: true,
        backgroundColor: '#f8fafc',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      windows.push(socialWin);
      await socialWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(socialHtml)}`);
      await socialWin.webContents.executeJavaScript(`new Promise(r => setTimeout(r, 250))`);
      const socialImg = await socialWin.webContents.capturePage();
      fs.writeFileSync(path.join(root, 'website/assets/social-preview.jpg'), socialImg.toJPEG(90));
      fs.writeFileSync(path.join(root, 'docs/assets/social-preview.png'), socialImg.toPNG());

      console.log(JSON.stringify({ ok: true, assets: ['workbench-screenshot.png', 'mobile-preview.png', 'social-preview.jpg'] }));
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
  const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 90000 });
  if (child.status !== 0) {
    throw new Error(child.error?.message || child.stderr || child.stdout || `Electron exited with ${child.status}`);
  }
  console.log(child.stdout.trim());
}
