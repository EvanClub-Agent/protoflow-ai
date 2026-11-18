// Isolated Electron UI check; no real publication, credentials or user projects.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const dir = process.env.PFLOW_FIRST_PUBLISH_SMOKE_DIR;
  const { serviceOrigin: bundledOrigin } = require(path.join(root, 'electron/service-origin.json'));
  const serviceOrigin = bundledOrigin || 'http://127.0.0.1:8088';
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const requests = [];
    ipcMain.handle('pflow:set-window-mode', () => true);
    let signedIn = false;
    const accountState = () => ({ url: serviceOrigin, configured: signedIn, user: signedIn ? { id: 'smoke-account', username: 'smoke', displayName: '测试用户' } : null, legacy: null });
    for (const method of ['settings', 'accountSettings']) ipcMain.handle('pflow:publishing-' + method, () => ({ ok: true, value: accountState() }));
    ipcMain.handle('pflow:publishing-authenticate', (_event, input) => {
      if (input.password === 'wrong') return { ok: false, error: { message: '用户名或密码不正确', status: 401 } };
      assert.ok(['login','register'].includes(input.mode)); assert.equal(input.username, 'smoke'); assert.equal(input.password, 'smoke-password');
      signedIn = true; return { ok: true, value: accountState() };
    });
    ipcMain.handle('pflow:publishing-logout', () => { signedIn = false; return { ok: true, value: accountState() }; });
    ipcMain.handle('pflow:publishing-request', (_event, input) => {
      if (input.action === 'test-expire') { signedIn = false; return { ok: true, value: null }; }
      requests.push(input);
      if (input.action === 'list') return { ok: true, value: { items: [] } };
      assert.equal(input.action, 'create');
      return { ok: true, value: { id: 'FIRSTSHARE12345678901234', projectId: input.input.snapshot.projectId, title: '首次发布', version: 1,
        passwordProtected: false, expiresAt: null, revokedAt: null, createdAt: '2026-11-13T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z', shareUrl: serviceOrigin + '/p/FIRSTSHARE12345678901234' } };
    });
    const win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async code => { for (let i = 0; i < 150; i++) { if (await js('Boolean(' + code + ')')) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out: ' + code); };
    let passed = false;
    try {
      await win.loadFile(path.join(dir, 'index.html'));
      await until('document.querySelector("#publishing-username")');
      assert.equal(await js('Boolean(document.querySelector("dialog[open]"))'), false);
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      if (process.env.PFLOW_FIRST_PUBLISH_SCREENSHOT_DIR) fs.writeFileSync(path.join(process.env.PFLOW_FIRST_PUBLISH_SCREENSHOT_DIR, 'login.png'), (await win.webContents.capturePage()).toPNG());
      const error = await js('window.checkAuthError({mode:"login",username:"smoke",password:"wrong"}).then(()=>null,error=>({message:error.message,status:error.status}))');
      assert.equal(error.status, 401); assert.equal(error.message, '用户名或密码不正确');
      await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("没有账号？注册")).click()');
      await until('document.querySelector("#publishing-password").autocomplete === "new-password"');
      await js(`for (const [id,value] of [['publishing-username','smoke'],['publishing-password','smoke-password']]) { const el=document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); }`);
      await js('document.querySelector("form").requestSubmit()');
      await until('document.querySelector("dialog[open]") && document.body.textContent.includes("已登录")');
      const publish = 'Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("发布并生成链接"))';
      assert.equal(await js(publish + '.disabled'), true);
      assert.equal(await js('Boolean(document.querySelector("select"))'), false);
      assert.equal(await js('document.getElementById("publish-block-reason").textContent'), '请先创建或生成画布页面');
      if (process.env.PFLOW_FIRST_PUBLISH_SCREENSHOT_DIR) fs.writeFileSync(path.join(process.env.PFLOW_FIRST_PUBLISH_SCREENSHOT_DIR, 'empty.png'), (await win.webContents.capturePage()).toPNG());
      // Real store updates while the same dialog remains mounted.
      await js('window.createFirstPage()');
      await until('document.querySelector("select")?.value === "first-authored-page"');
      assert.equal(await js(publish + '.disabled'), false);
      assert.equal(await js('Boolean(document.getElementById("publish-block-reason"))'), false);
      await until('getComputedStyle(' + publish + ').opacity === "1"');
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      if (process.env.PFLOW_FIRST_PUBLISH_SCREENSHOT_DIR) fs.writeFileSync(path.join(process.env.PFLOW_FIRST_PUBLISH_SCREENSHOT_DIR, 'ready.png'), (await win.webContents.capturePage()).toPNG());
      // Expiry must cover an open native dialog without discarding its project;
      // signing back in restores the same dialog and the same first page.
      await js('window.expireSession()');
      await until('document.querySelector("#publishing-username")');
      assert.equal(await js('Boolean(document.querySelector("dialog[open]"))'), false);
      await js(`for (const [id,value] of [['publishing-username','smoke'],['publishing-password','smoke-password']]) { const el=document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); }`);
      await js('document.querySelector("form").requestSubmit()');
      await until('document.querySelector("dialog[open]") && !document.querySelector("#publishing-username")');
      assert.equal(await js('document.querySelector("select").value'), 'first-authored-page');
      await js(publish + '.click()');
      await until('document.body.textContent.includes("发布成功")');
      assert.deepEqual(requests.map(request => request.action), ['list', 'create']);
      assert.equal(requests[1].input.snapshot.entryPageId, 'first-authored-page');
      assert.equal(requests[1].input.snapshot.pages.length, 1);
      assert.equal(requests[1].input.expectedVersion, undefined);
      await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent === "退出登录").click()');
      await until('document.querySelector("#publishing-username")');
      assert.equal(await js('Boolean(document.querySelector("dialog[open]"))'), false);
      passed = true;
      console.log('PASS real Electron account gate: registration, shared publishing login, 401 metadata, sign-out; dialog: empty project explanation, live first page, initial entry selection and first publication without history');
    } catch (error) { console.error(error); }
    finally { win.destroy(); app.exit(passed ? 0 : 1); }
  }).catch(error => { console.error(error); app.exit(1); });
  setTimeout(() => { console.error('First publication smoke timeout'); app.exit(1); }, 25000).unref();
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-first-publish-'));
  try {
    require('esbuild').buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {OnlinePublishModal} from './src/components/OnlinePublishModal';
import {AccountGate} from './src/components/AccountGate';
import {authenticatePublishing} from './src/services/publishingClient';
window.checkAuthError=authenticatePublishing;
import {useAccountStore} from './src/store/useAccountStore';
window.expireSession=async()=>{await window.protoflowDesktop.publishing.request({action:'test-expire'}); await useAccountStore.getState().refresh();};
import {createProjectPayload,loadProjectFromBinaryPayload} from './src/services/projectStorage'; import {usePageStore} from './src/proto/store/usePageStore';
loadProjectFromBinaryPayload(createProjectPayload({projectId:'first-publish-smoke',projectName:'新建项目',templateId:'blank_project',storageDir:'',fileName:'smoke.pflow',createdAt:'2026-11-13',updatedAt:'2026-11-13',pageCount:0,tableCount:0,stickyCount:0}));
window.createFirstPage=()=>{const store=usePageStore.getState();const folder=store.createDesignerFolder('业务页面',null);store.createDesignerPage({pageId:'first-authored-page',title:'我的第一个页面',folderId:folder.id},'export default function Page(){return <Page pfId="root" title="我的第一个页面"/>;}');};
createRoot(document.getElementById('root')).render(<AccountGate><OnlinePublishModal onClose={()=>{}} onOffline={()=>{}}/></AccountGate>);`, loader: 'tsx', resolveDir: root }, jsx: 'automatic', loader: { '.svg': 'dataurl' }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(dir, 'app.js') });
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.startsWith('index-') && name.endsWith('.css'));
    if (!css) throw new Error('Run npm run build first');
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'app.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><meta charset="UTF-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
    const env = { ...process.env, PFLOW_FIRST_PUBLISH_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', timeout: 30000 });
    if (result.status !== 0) process.exitCode = 1;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
