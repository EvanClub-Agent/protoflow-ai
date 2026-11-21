// Run the actual preload, renderer persistence and native close guard in isolated
// Electron processes. Never load or modify the user's projects or Electron profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain, Menu } = require('electron');
  const { saveProjectArchive, projectIdentity } = require('../electron/project-files.cjs');
  const { installProjectCloseGuard } = require('../electron/project-close-guard.cjs');
  const dir = process.env.PFLOW_PERSISTENCE_SMOKE_DIR;
  const phase = process.env.PFLOW_PERSISTENCE_SMOKE_PHASE;
  if (!dir || !['create', 'reopen', 'verify'].includes(phase)) throw new Error('Missing isolated smoke configuration');
  app.setPath('appData', dir);
  if (phase === 'create') {
    // Seed the pre-rename profile before initializing Alex's identity.
    fs.mkdirSync(path.join(dir, 'protoflow-ai'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'protoflow-ai', 'updater.json'), JSON.stringify({ serverUrl: 'http://192.168.1.104:8088' }));
  }
  require('../electron/app-identity.cjs').initializeApplicationIdentity(app);
  assert.equal(app.getName(), 'protoflow-ai', 'secret-store identity must survive the rename');
  assert.equal(app.getPath('userData'), path.join(dir, 'protoflow-ai'));
  assert.equal(app.getPath('sessionData'), app.getPath('userData'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'updater.json'), 'utf8')).serverUrl, 'http://192.168.1.104:8088');
  let passed = false;
  ipcMain.handle('pflow:save-current-project', (_event, input) => saveProjectArchive(input));
  ipcMain.handle('pflow:write-binary-project', (_event, input) => saveProjectArchive({ ...input, projectId: projectIdentity(Buffer.from(input.binaryBytes)) }, { allowCreate: true }));
  ipcMain.handle('pflow:read-binary-project', (_event, input) => ({ binaryBytes: new Uint8Array(fs.readFileSync(path.join(input.dirPath, input.fileName))) }));
  app.whenReady().then(async () => {
    app.dock?.hide();
    require('../electron/application-menu.cjs').installApplicationMenu({ app, Menu });
    if (process.platform === 'darwin') {
      const menu = Menu.getApplicationMenu();
      assert.deepEqual(menu.items.map(item => item.label), ['Alex']);
      assert.equal(menu.getMenuItemById('alex-undo').accelerator, 'Command+Z');
      for (const role of ['copy', 'paste', 'cut', 'selectall', 'redo', 'close']) {
        assert.ok(menu.items[0].submenu.items.some(item => item.role === role && !item.visible), `missing native shortcut: ${role}`);
      }
    } else assert.equal(Menu.getApplicationMenu(), null);
    const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(dir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
    installProjectCloseGuard({ app, window, ipcMain, dialog: { showMessageBox: async (_w, result) => { console.error(result.detail); app.exit(1); } } });
    ipcMain.handle('smoke:finish', (_event, result) => {
      assert.equal(result.ok, true, result.error);
      if (phase === 'create') fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(result.snapshot));
      passed = true;
      setImmediate(() => phase === 'reopen' ? app.quit() : window.close());
      return true;
    });
    window.webContents.on('render-process-gone', (_event, details) => { console.error(details.reason); app.exit(1); });
    await window.loadFile(path.join(dir, 'index.html'));
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { assert.ok(passed, 'renderer must complete before exit'); console.log(`PASS native ${phase}`); });
  setTimeout(() => { console.error('native persistence smoke timed out'); app.exit(1); }, 25000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-persistence-smoke-'));
  try {
    fs.writeFileSync(path.join(dir, 'preload.cjs'), fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8') + `\ncontextBridge.exposeInMainWorld('persistenceSmoke', { finish: input => ipcRenderer.invoke('smoke:finish', input) });\n`);
    for (const phase of ['create', 'reopen', 'verify']) {
      const expected = phase === 'create' ? null : JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
      const code = `
import { startProjectPersistence, createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload, restoreRecentProjects, openRecentProject } from './src/services/projectStorage';
import { createMindmapNode, setPageMindmapLinks } from './src/services/mindmapWorkspace';
import { useProtoStore } from './src/store/useProtoStore';
import { usePageStore } from './src/proto/store/usePageStore';
import { encodePflowBinary, decodePflowBinary } from './src/utils/pflowBinaryCodec';
const phase = ${JSON.stringify(phase)}, dir = ${JSON.stringify(dir)}, expected = ${JSON.stringify(expected)};
const check = (ok, message) => { if (!ok) throw new Error(message); };
(async () => {
  // Intentionally longer than the test: the native close/quit handshake must flush.
  startProjectPersistence(60000);
  // Exercise the real confirmation IPC before permitting the native save flush.
  window.protoflowDesktop.onConfirmClose(requestId => window.protoflowDesktop.confirmClose({ requestId, confirmed: true }));
  window.protoflowDesktop.closeConfirmationReady();
  const meta = { projectId: 'native-restart-check', projectName: '重启持久化测试', templateId: 'blank_project', storageDir: dir, fileName: 'restart.pflow', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pageCount: 0, tableCount: 0, stickyCount: 0 };
  if (phase === 'create') {
    const payload = createProjectPayload(meta);
    await window.protoflowDesktop.writeBinaryProject({ dirPath: dir, fileName: meta.fileName, binaryBytes: encodePflowBinary(payload) });
    const saved = await window.protoflowDesktop.readBinaryProject({dirPath:dir, fileName:meta.fileName});
    loadProjectFromBinaryPayload(decodePflowBinary(saved.binaryBytes));
    check(useProtoStore.getState().activePageId === '' && !usePageStore.getState().designerFolders.length && !Object.keys(usePageStore.getState().pageSources).length, '空白工程首次打开时不应有目录或页面');
    const folder = usePageStore.getState().createDesignerFolder('系统管理', null);
    const nested = usePageStore.getState().createDesignerFolder('资料管理', folder.id);
    usePageStore.getState().createDesignerPage({ pageId: 'native-page', title: '物料管理', folderId: nested.id }, 'export default function Page(){return <Page title="重启不会丢失"/>;}');
    useProtoStore.getState().setActivePage('native-page');
    const mapFolder = createMindmapNode(meta.projectId, 'folder', '业务脑图', null);
    const mapId = createMindmapNode(meta.projectId, 'mindmap', '模块脑图', mapFolder);
    setPageMindmapLinks(meta.projectId, { kind: 'folder', folderId: folder.id }, [mapFolder]);
    useProtoStore.getState().setMindmapSource(meta.projectId, mapId, 'mindmap\\n  重启后保留脑图\\n    项目目标');
    useProtoStore.setState({ stickyNotes: [{ id: 'native-note', index: 1, pageId: 'native-page', targetWidgetId: 'root', targetWidgetName: '页面', text: '重启后保留便签', compiledRule: '', active: true }] });
  } else {
    restoreRecentProjects();
    check(useProtoStore.getState().recentProjects.some(p => p.projectId === meta.projectId), '重启后最近项目列表丢失');
    await openRecentProject(meta.projectId);
    if (phase === 'reopen') {
      check(JSON.stringify(captureProjectPayload().stateSnapshot) === JSON.stringify(expected), '完整工程与关闭前不一致');
      usePageStore.getState().renameDesignerPage('native-page', '退出应用也保存');
      useProtoStore.getState().setMindmapSource(meta.projectId, useProtoStore.getState().mindmaps.nodes.find(node => node.kind === 'mindmap').id, 'mindmap\\n  退出前最后修改');
    } else {
      check(usePageStore.getState().designerPages.find(p => p.pageId === 'native-page').title === '退出应用也保存', 'app.quit 没有保存最终修改');
      check(JSON.stringify(usePageStore.getState().designerFolders) === JSON.stringify(expected.designerFolders), '保存的目录或层级与创建时不一致');
      check(useProtoStore.getState().stickyNotes[0].id === 'native-note', '便签丢失');
      check(useProtoStore.getState().mindmaps.nodes.find(node => node.kind === 'mindmap').source === 'mindmap\\n  退出前最后修改', '退出时脑图未保存');
    }
  }
  await window.persistenceSmoke.finish({ ok: true, snapshot: captureProjectPayload().stateSnapshot });
})().catch(error => window.persistenceSmoke.finish({ ok: false, error: String(error) }));
`;
      const result = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
      fs.writeFileSync(path.join(dir, `${phase}.js`), result.outputFiles[0].contents);
      fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Isolated persistence check</title><script src="./${phase}.js"></script>`);
      const env = { ...process.env, PFLOW_PERSISTENCE_SMOKE_DIR: dir, PFLOW_PERSISTENCE_SMOKE_PHASE: phase };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 30000 });
      if (child.status !== 0 || !child.stdout.includes(`PASS native ${phase}`)) throw new Error(child.error?.message || child.stderr || child.stdout || `Electron exit ${child.status}`);
      console.log(child.stdout.trim());
    }
    console.log('PASS create directories/pages → close window → fresh process reopen → edit → quit app → fresh process reopen');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
