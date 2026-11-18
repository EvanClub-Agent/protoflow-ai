// Real Electron/preload/UI/power assertion smoke. Never locks or sleeps the user's Mac.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain, powerSaveBlocker, powerMonitor } = require('electron');
  const { AiBackground } = require(path.join(root, 'electron/ai-background.cjs'));
  const dir = process.env.PFLOW_BACKGROUND_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const win = new BrowserWindow({ show: false, width: 900, height: 650, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false } });
    const owner = win.webContents.id;
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
    const notifications = [];
    const background = new AiBackground({ powerSaveBlocker, powerMonitor, dataDir: dir,
      emit: state => { if (!win.webContents.isDestroyed()) win.webContents.send('pflow:ai-background-event', state); },
      notify: notification => notifications.push(notification),
    });
    background.attach(win.webContents);
    win.webContents.once('destroyed', () => background.detach(owner));
    for (const method of ['begin', 'end', 'snapshot', 'configure']) ipcMain.handle('pflow:ai-background-' + method, (event, input) => {
      assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, win.webContents.mainFrame);
      if (method === 'begin') return background.begin(input, owner);
      if (method === 'end') return background.end(input.leaseId, owner, input.outcome);
      return background[method](input);
    });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async code => { for (let i = 0; i < 150; i++) { if (await js('Boolean(' + code + ')')) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out: ' + code); };
    let passed = false;
    try {
      await win.loadFile(path.join(dir, 'index.html'));
      await until('document.querySelector("button[aria-label]")');
      await js('document.querySelector("button[aria-label]").click()');
      await until('document.querySelector("dialog[open]")');
      await until('document.querySelector("dialog").textContent.includes("已就绪")');
      const lease = await js('window.protoflowDesktop.aiBackground.begin({projectId:"power-smoke",kind:"project",threadId:"thread"})');
      assert.equal(background.snapshot().protected, true);
      assert.equal(win.webContents.getBackgroundThrottling(), false);
      await until('document.querySelector("[role=status]").textContent.includes("保护中")');
      if (process.platform === 'darwin') {
        const own = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' }).split('\n').filter(line => line.includes(`pid ${process.pid}(`));
        assert.ok(own.some(line => /NoIdleSleepAssertion|PreventUserIdleSystemSleep/.test(line)), own.join('\n'));
        assert.ok(!own.some(line => /PreventUserIdleDisplaySleep/.test(line)), own.join('\n'));
        console.log('PASS macOS process owns a system-idle sleep assertion, without a display sleep assertion');
      }
      // Synthetic events exercise app reactions only; they do not lock/sleep the OS.
      background.powerEvent('lock-screen');
      assert.equal(background.snapshot().protected, true); assert.equal(notifications.length, 1);
      await js('document.querySelectorAll("dialog input")[0].click()');
      await until('!document.querySelectorAll("dialog input")[0].checked');
      assert.equal(background.snapshot().protected, false);
      assert.equal(win.webContents.getBackgroundThrottling(), false);
      await js('document.querySelectorAll("dialog input")[0].click()');
      await until('document.querySelectorAll("dialog input")[0].checked');
      await until('document.querySelector("[role=status]").textContent.includes("保护中")');
      const screenshot = await win.webContents.capturePage();
      if (process.env.PFLOW_BACKGROUND_SCREENSHOT) fs.writeFileSync(process.env.PFLOW_BACKGROUND_SCREENSHOT, screenshot.toPNG());
      await js(`window.protoflowDesktop.aiBackground.end({leaseId:${JSON.stringify(lease)},outcome:"finished"})`);
      assert.equal(background.snapshot().protected, false); assert.equal(win.webContents.getBackgroundThrottling(), true);
      assert.equal(notifications.length, 2);
      const pending = background.begin({ projectId: 'close-smoke' }, owner);
      const destroyed = new Promise(resolve => win.webContents.once('destroyed', resolve));
      assert.ok(pending); win.destroy(); await destroyed;
      assert.equal(background.snapshot().active, false); assert.equal(background.snapshot().protected, false);
      passed = true;
      console.log('PASS real Electron IPC, hidden renderer, settings dialog, task leases, notification adapter and destroyed-window cleanup');
    } catch (error) { console.error(error); }
    finally { background.close(); if (!win.isDestroyed()) win.destroy(); app.exit(passed ? 0 : 1); }
  }).catch(error => { console.error(error); app.exit(1); });
  setTimeout(() => { console.error('Background smoke timeout'); app.exit(1); }, 25000).unref();
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-background-smoke-'));
  try {
    require('esbuild').buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AiBackgroundControl} from './src/components/AiBackgroundControl'; createRoot(document.getElementById('root')).render(<AiBackgroundControl/>);`, loader: 'tsx', resolveDir: root }, jsx: 'automatic', bundle: true, platform: 'browser', format: 'iife', outfile: path.join(dir, 'app.js') });
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.startsWith('index-') && name.endsWith('.css'));
    if (!css) throw new Error('Build app first so smoke can render its actual styles');
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'app.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><meta charset="UTF-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
    const env = { ...process.env, PFLOW_BACKGROUND_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', timeout: 30000 });
    if (result.status !== 0) process.exitCode = 1;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
