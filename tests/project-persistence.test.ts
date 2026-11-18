import { createMindmapNode } from '../src/services/mindmapWorkspace';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useProjectSaveStore } from '../src/services/projectAutosave';
import { startProjectPersistence, createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload, flushProjectChanges, openRecentProject } from '../src/services/projectStorage';
import { deleteMenu, prepareMenuDeletion } from '../src/services/menuDeletion';
import { deleteProject } from '../src/services/projectDeletion';
import { encodePflowBinary, decodePflowBinary } from '../src/utils/pflowBinaryCodec';
const { saveProjectArchive, trashProjectArchive } = require(path.join(process.cwd(), 'electron/project-files.cjs'));
const { installProjectCloseGuard } = require(path.join(process.cwd(), 'electron/project-close-guard.cjs'));

async function setup(delay = 10000) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pflow-persistence-'));
  const now = new Date().toISOString();
  const payload = createProjectPayload({ projectId: 'persist-A', projectName: '保存测试', templateId: 'blank_project', storageDir: dir, fileName: 'a.pflow', createdAt: now, updatedAt: now, pageCount: 0, stickyCount: 0, tableCount: 0 });
  await fs.writeFile(path.join(dir, payload.meta.fileName), encodePflowBinary(payload));
  const listeners = new Map<string, Function>();
  let closeListener: (id: string) => void;
  const bridge = {
    isElectron: true,
    saveCurrentProject: (input: any) => saveProjectArchive(input),
    readBinaryProject: async (input: any) => ({ binaryBytes: new Uint8Array(await fs.readFile(path.join(input.dirPath, input.fileName))) }),
    onSaveBeforeClose: (listener: typeof closeListener) => { closeListener = listener; return () => {}; },
    persistenceReady: () => {},
    finishSaveBeforeClose: (_result: any) => {},
    trashProject: (input: any) => trashProjectArchive(input, (file: string) => fs.rename(file, file + '.test-trash')),
  };
  Object.assign(window, { protoflowDesktop: bridge, addEventListener: (key: string, fn: Function) => listeners.set(key, fn), removeEventListener: (key: string) => listeners.delete(key) });
  const stop = startProjectPersistence(delay);
  loadProjectFromBinaryPayload(payload);
  const read = async () => decodePflowBinary(new Uint8Array(await fs.readFile(path.join(dir, 'a.pflow')))) as ReturnType<typeof captureProjectPayload>;
  return { dir, payload, bridge, listeners, read, requestClose: (id: string) => closeListener(id), cleanup: async () => { stop(); await fs.rm(dir, { recursive: true, force: true }); } };
}

function editMenu() {
  const folder = usePageStore.getState().createDesignerFolder('业务管理', null);
  const child = usePageStore.getState().createDesignerFolder('基础资料', folder.id);
  usePageStore.getState().createDesignerPage({ pageId: 'new-page', title: '物料管理', folderId: child.id }, 'export default function Page(){return <Page title="重启后仍在"/>;}');
  useProtoStore.getState().setActivePage('new-page');
  useProtoStore.setState({ stickyNotes: [{ id: 'note-persist', pageId: 'new-page', targetWidgetId: 'root', targetWidgetName: '内容区域', text: '便签也要保存', compiledRule: '', index: 1, active: true }] });
  return folder;
}

const nextTick = () => new Promise<void>(resolve => setImmediate(resolve));

test('a mindmap-only edit triggers autosave and reopening preserves even an unfinished draft', async () => {
  const h = await setup(5);
  try {
    const draft = 'mindmap\n  root((尚未完成';
    const id = createMindmapNode(h.payload.meta.projectId, 'mindmap', '自动保存', null);
    useProtoStore.getState().setMindmapSource(h.payload.meta.projectId, id, draft);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { stop(); reject(new Error('mindmap autosave did not complete')); }, 2000);
      const stop = useProjectSaveStore.subscribe(s => { if (s.status === 'saved') { clearTimeout(timeout); stop(); resolve(); } });
    });
    assert.equal((await h.read()).stateSnapshot.mindmaps.nodes[0].source, draft);
    loadProjectFromBinaryPayload(createProjectPayload({ ...h.payload.meta, projectId: 'persist-B', fileName: 'b.pflow' }));
    assert.deepEqual(useProtoStore.getState().mindmaps.nodes, []);
    await openRecentProject(h.payload.meta.projectId);
    assert.equal(useProtoStore.getState().mindmaps.nodes[0].source, draft);
  } finally { await h.cleanup(); }
});

test('automatic save survives a fresh store/reopen with nested menus, source, notes and exact identities', async () => {
  const h = await setup(5);
  try {
    const folder = editMenu();
    useProtoStore.getState().createNewTable('t_persist', '保存测试表', '基础资料域 (MDM)', { pageId: 'new-page', menuTitle: '物料管理' });
    usePageStore.getState().insertRow('t_persist', { biz_no: 'SAVE-001' });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { stop(); reject(new Error('autosave did not complete')); }, 2000);
      const stop = useProjectSaveStore.subscribe(s => { if (s.status === 'saved') { clearTimeout(timeout); stop(); resolve(); } });
    });
    const saved = await h.read();
    assert.equal(saved.stateSnapshot.designerFolders.find(f => f.id === folder.id)?.title, '业务管理');
    const expected = captureProjectPayload().stateSnapshot;
    const other = createProjectPayload({ ...h.payload.meta, projectId: 'persist-B', fileName: 'b.pflow' });
    loadProjectFromBinaryPayload(other);
    // Reopening reads the native archive, never the old in-memory snapshot.
    await openRecentProject(h.payload.meta.projectId);
    assert.deepEqual(captureProjectPayload().stateSnapshot, expected);
    assert.equal(useProjectSaveStore.getState().status, 'saved');
  } finally { await h.cleanup(); }
});

test('switching projects flushes the old archive and leaves the new archive untouched', async () => {
  const h = await setup();
  try {
    const other = createProjectPayload({ ...h.payload.meta, projectId: 'persist-B', fileName: 'b.pflow' });
    await fs.writeFile(path.join(h.dir, 'b.pflow'), encodePflowBinary(other));
    useProtoStore.setState({ recentProjects: [...useProtoStore.getState().recentProjects, other.meta] });
    editMenu();
    await openRecentProject('persist-B');
    assert.equal(useProtoStore.getState().currentProjectMeta.projectId, 'persist-B');
    assert.equal((await h.read()).stateSnapshot.activePageId, 'new-page');
    assert.deepEqual(decodePflowBinary(new Uint8Array(await fs.readFile(path.join(h.dir, 'b.pflow')))), other);
  } finally { await h.cleanup(); }
});

test('a hot-updated renderer can save through the older desktop bridge after checking the archive identity', async () => {
  const h = await setup();
  try {
    delete (h.bridge as any).saveCurrentProject;
    (h.bridge as any).writeBinaryProject = (input: any) => saveProjectArchive(input);
    editMenu();
    await flushProjectChanges();
    assert.equal((await h.read()).stateSnapshot.activePageId, 'new-page');
    const other = createProjectPayload({ ...h.payload.meta, projectId: 'different-project' });
    await fs.writeFile(path.join(h.dir, 'a.pflow'), encodePflowBinary(other));
    usePageStore.getState().renameDesignerPage('new-page', '不能覆盖别的工程');
    await assert.rejects(flushProjectChanges(), /ID 已变化/);
    assert.equal((await h.read()).meta.projectId, 'different-project');
  } finally { await h.cleanup(); }
});

test('close flushes edits immediately before the debounce deadline and Ctrl+S saves the same snapshot', async () => {
  const h = await setup();
  try {
    editMenu();
    await new Promise<void>((resolve, reject) => {
      h.bridge.finishSaveBeforeClose = result => { try { assert.equal(result.requestId, 'close-1'); assert.equal(result.ok, true); resolve(); } catch (e) { reject(e); } };
      h.requestClose('close-1');
    });
    assert.equal((await h.read()).stateSnapshot.activePageId, 'new-page');
    usePageStore.getState().renameDesignerPage('new-page', '快捷键保存');
    let prevented = false;
    h.listeners.get('keydown')!({ metaKey: true, key: 's', preventDefault() { prevented = true; } });
    await flushProjectChanges();
    assert.equal(prevented, true);
    assert.equal((await h.read()).stateSnapshot.designerPages.find(p => p.pageId === 'new-page')?.title, '快捷键保存');
  } finally { await h.cleanup(); }
});

test('changes during an in-flight save are serialized, and a project cannot be replaced before the latest save', async () => {
  const h = await setup();
  try {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    const held = new Promise<void>(r => { release = r; });
    let calls = 0;
    h.bridge.saveCurrentProject = async input => { if (++calls === 1) { entered(); await held; } return saveProjectArchive(input); };
    editMenu();
    const saving = flushProjectChanges(); await started;
    usePageStore.getState().renameDesignerPage('new-page', '较新的内容');
    assert.throws(() => loadProjectFromBinaryPayload(h.payload), /尚未保存/);
    release(); await saving;
    assert.equal(calls, 2);
    assert.equal((await h.read()).stateSnapshot.designerPages.find(p => p.pageId === 'new-page')?.title, '较新的内容');
    assert.equal(useProjectSaveStore.getState().status, 'saved');
  } finally { await h.cleanup(); }
});

test('save failure preserves edits, refuses project switch/close, and retry writes the original project only', async () => {
  const h = await setup();
  try {
    const originalBytes = await fs.readFile(path.join(h.dir, 'a.pflow'));
    h.bridge.saveCurrentProject = async () => { throw new Error('磁盘不可写'); };
    editMenu();
    await assert.rejects(flushProjectChanges(), /磁盘不可写/);
    assert.equal(useProjectSaveStore.getState().status, 'error');
    await assert.rejects(openRecentProject('persist-A'), /磁盘不可写/);
    await new Promise<void>(resolve => {
      h.bridge.finishSaveBeforeClose = result => { assert.equal(result.ok, false); resolve(); };
      h.requestClose('close-error');
    });
    let unloadBlocked = false;
    h.listeners.get('beforeunload')!({ preventDefault() { unloadBlocked = true; } });
    await nextTick();
    assert.ok(unloadBlocked);
    assert.deepEqual(await fs.readFile(path.join(h.dir, 'a.pflow')), originalBytes);
    h.bridge.saveCurrentProject = input => saveProjectArchive(input);
    await flushProjectChanges();
    assert.equal((await h.read()).meta.projectId, 'persist-A');
    assert.equal((await h.read()).stateSnapshot.activePageId, 'new-page');
    assert.equal(useProjectSaveStore.getState().error, '');
  } finally { await h.cleanup(); }
});

test('menu deletion and undo remain dirty edits and both persist', async () => {
  const h = await setup();
  try {
    const folder = editMenu(); await flushProjectChanges();
    const undo = deleteMenu(prepareMenuDeletion(captureProjectPayload(), folder.id));
    await flushProjectChanges();
    assert.equal((await h.read()).stateSnapshot.designerFolders.some(f => f.id === folder.id), false);
    assert.ok(undo.canUndo()); undo.undo(); await flushProjectChanges();
    assert.equal((await h.read()).stateSnapshot.designerFolders.some(f => f.id === folder.id), true);
  } finally { await h.cleanup(); }
});

test('deleting an open project saves its latest changes into trash and does not recreate it', async () => {
  const h = await setup();
  try {
    editMenu();
    await deleteProject(h.payload.meta);
    assert.equal(useProtoStore.getState().isProjectClosed, true);
    await flushProjectChanges();
    await assert.rejects(fs.stat(path.join(h.dir, 'a.pflow')), { code: 'ENOENT' });
    const trashed = decodePflowBinary(new Uint8Array(await fs.readFile(path.join(h.dir, 'a.pflow.test-trash')))) as ReturnType<typeof captureProjectPayload>;
    assert.equal(trashed.stateSnapshot.activePageId, 'new-page');
    assert.equal(useProjectSaveStore.getState().status, 'idle');
  } finally { await h.cleanup(); }
});

test('atomic archive writing rejects wrong identities, corrupt bytes, missing files and symlinks without modifying valid data', async () => {
  const h = await setup();
  try {
    const input = { projectId: h.payload.meta.projectId, dirPath: h.dir, fileName: 'a.pflow', binaryBytes: encodePflowBinary(h.payload) };
    await assert.rejects(saveProjectArchive({ ...input, projectId: 'wrong' }), /ID 不一致/);
    const other = createProjectPayload({ ...h.payload.meta, projectId: 'other' });
    await assert.rejects(saveProjectArchive({ ...input, projectId: 'other', binaryBytes: encodePflowBinary(other) }), /已有其他项目/);
    const corrupt = input.binaryBytes.slice(); corrupt[20] ^= 1;
    await assert.rejects(saveProjectArchive({ ...input, binaryBytes: corrupt }), /校验失败/);
    await assert.rejects(saveProjectArchive({ ...input, fileName: 'missing.pflow' }), /移动或删除/);
    await fs.symlink(path.join(h.dir, 'a.pflow'), path.join(h.dir, 'link.pflow'));
    await assert.rejects(saveProjectArchive({ ...input, fileName: 'link.pflow' }), /普通文件/);
    assert.deepEqual((await h.read()).stateSnapshot, h.payload.stateSnapshot);
    assert.deepEqual((await fs.readdir(h.dir)).sort(), ['a.pflow', 'link.pflow']);
    // Native save and delete share the queue; a delayed save cannot resurrect a trashed file.
    const saving = saveProjectArchive(input);
    const deleting = trashProjectArchive(input, (file: string) => fs.rename(file, file + '.trash'));
    await Promise.all([saving, deleting]);
    await assert.rejects(saveProjectArchive(input), /移动或删除/);
  } finally { await h.cleanup(); }
});

function closeHarness(timeoutMs = 500, { confirmationReady = true, persistenceReady = true, nativeResponse = 0, getCloseBlockReason = () => null as string | null } = {}) {
  const app = new EventEmitter() as any, window = new EventEmitter() as any, ipcMain = new EventEmitter();
  const messages: any[] = [], errors: any[] = [];
  const contents = new EventEmitter() as any;
  let destroyed = false;
  contents.mainFrame = {};
  contents.isDestroyed = () => destroyed;
  contents.send = (channel: string, payload: any) => messages.push({ channel, payload, requestId: typeof payload === 'string' ? payload : payload.requestId });
  Object.defineProperty(window, 'webContents', {
    get() {
      if (destroyed) throw new TypeError('Object has been destroyed');
      return contents;
    },
  });
  window.isDestroyed = () => destroyed;
  let closed = 0, quit = 0;
  const event = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
  const emitClosed = () => {
    destroyed = true;
    window.emit('closed');
  };
  window.close = () => { const e = event(); window.emit('close', e); if (!e.prevented) { closed++; emitClosed(); } };
  app.quit = () => { const e = event(); app.emit('before-quit', e); if (!e.prevented) { quit++; window.close(); } };
  installProjectCloseGuard({ app, window, ipcMain, timeoutMs, getCloseBlockReason, dialog: { showMessageBox: async (_w: any, p: any) => { errors.push(p); return { response: nativeResponse }; } } });
  const sender = { sender: contents, senderFrame: contents.mainFrame };
  if (persistenceReady) ipcMain.emit('pflow:persistence-ready', sender);
  if (confirmationReady) ipcMain.emit('pflow:close-confirmation-ready', sender);
  return { app, window, ipcMain, messages, errors, sender, counts: () => ({ closed, quit }), dispose: () => { if (!destroyed) emitClosed(); } };
}

test('installing a system update blocks close and a previously pending save cannot bypass the installation guard', () => {
  let blocked = false;
  const h = closeHarness(500, { getCloseBlockReason: () => blocked ? '正在安装更新' : null });
  try {
    blocked = true; h.app.quit();
    assert.equal(h.errors.at(-1).message, '正在安装更新');
    assert.deepEqual(h.counts(), { closed: 0, quit: 0 });
    blocked = false; h.window.close();
    h.ipcMain.emit('pflow:confirm-close-result', h.sender, { requestId: h.messages.at(-1).requestId, confirmed: true });
    const flushId = h.messages.at(-1).requestId;
    blocked = true;
    h.ipcMain.emit('pflow:save-before-close-result', h.sender, { requestId: flushId, ok: true });
    assert.deepEqual(h.counts(), { closed: 0, quit: 0 });
    assert.equal(h.messages.at(-1).payload.error, '正在安装更新');
  } finally { h.dispose(); }
});

test('native exit requires confirmation, rejects stale/foreign responses and retries failed saves', () => {
  const h = closeHarness();
  const decide = (id: string, confirmed: boolean, sender = h.sender) => h.ipcMain.emit('pflow:confirm-close-result', sender, { requestId: id, confirmed });
  const saved = (id: string, ok: boolean) => h.ipcMain.emit('pflow:save-before-close-result', h.sender, { requestId: id, ok, error: 'disk full' });
  try {
    h.window.close(); h.window.close(); h.app.quit();
    assert.equal(h.messages.length, 1);
    const first = h.messages[0].requestId;
    assert.equal(h.messages[0].channel, 'pflow:confirm-close');
    decide(first, true, {} as any);
    saved(first, true);
    assert.equal(h.messages.length, 1);
    decide(first, false);
    assert.deepEqual(h.counts(), { closed: 0, quit: 0 });
    h.app.quit();
    const next = h.messages.at(-1).requestId;
    assert.notEqual(first, next);
    decide(first, true);
    assert.equal(h.messages.length, 2);
    decide(next, true); decide(next, true);
    const flush1 = h.messages.at(-1);
    assert.equal(flush1.channel, 'pflow:save-before-close');
    assert.notEqual(flush1.requestId, next);
    saved(flush1.requestId, false);
    assert.equal(h.messages.at(-1).payload.state, 'error');
    assert.deepEqual(h.counts(), { closed: 0, quit: 0 });
    decide(next, true);
    const flush2 = h.messages.at(-1).requestId;
    assert.notEqual(flush1.requestId, flush2);
    saved(flush1.requestId, true);
    assert.equal(h.counts().closed, 0);
    h.ipcMain.emit('pflow:save-before-close-result', {}, { requestId: flush2, ok: true });
    assert.equal(h.counts().closed, 0);
    saved(flush2, true);
    assert.deepEqual(h.counts(), { quit: 1, closed: 1 });
    assert.equal(h.ipcMain.listenerCount('pflow:save-before-close-result'), 0);
    assert.equal(h.ipcMain.listenerCount('pflow:confirm-close-result'), 0);
  } finally { h.dispose(); }
});

test('confirmation has no save timeout; a confirmed but unresponsive save stays open and can cancel', async () => {
  const h = closeHarness(5);
  try {
    h.app.quit();
    const requestId = h.messages[0].requestId;
    await new Promise(r => setTimeout(r, 20));
    assert.equal(h.messages.length, 1);
    h.ipcMain.emit('pflow:confirm-close-result', h.sender, { requestId, confirmed: true });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(h.messages.at(-1).payload.state, 'error');
    assert.deepEqual(h.counts(), { quit: 0, closed: 0 });
    h.ipcMain.emit('pflow:confirm-close-result', h.sender, { requestId, confirmed: false });
    h.app.quit();
    assert.notEqual(h.messages.at(-1).requestId, requestId);
  } finally { h.dispose(); }
});

test('a newly mounted confirmation UI recovers the pending prompt', () => {
  const h = closeHarness();
  try {
    h.app.quit();
    const requestId = h.messages[0].requestId;
    h.ipcMain.emit('pflow:close-confirmation-ready', h.sender);
    assert.equal(h.messages.at(-1).requestId, requestId);
    h.ipcMain.emit('pflow:confirm-close-result', h.sender, { requestId, confirmed: true });
    h.ipcMain.emit('pflow:close-confirmation-ready', h.sender);
    assert.equal(h.messages.at(-1).payload.state, 'saving');
    assert.equal(h.messages.filter(m => m.channel === 'pflow:save-before-close').length, 1);
  } finally { h.dispose(); }
});

test('startup close also asks for confirmation and does not duplicate the native dialog when React mounts', async () => {
  const h = closeHarness(500, { confirmationReady: false, persistenceReady: false });
  try {
    h.window.close();
    assert.equal(h.errors[0].type, 'question');
    assert.deepEqual(h.counts(), { quit: 0, closed: 0 });
    h.ipcMain.emit('pflow:close-confirmation-ready', h.sender);
    assert.equal(h.messages.length, 0);
    await Promise.resolve();
    h.app.quit();
    assert.equal(h.messages.at(-1).channel, 'pflow:confirm-close');
    assert.deepEqual(h.counts(), { quit: 0, closed: 0 });
  } finally { h.dispose(); }
  const accepted = closeHarness(500, { confirmationReady: false, persistenceReady: false, nativeResponse: 1 });
  try {
    accepted.window.close();
    await Promise.resolve();
    assert.deepEqual(accepted.counts(), { quit: 1, closed: 1 });
  } finally { accepted.dispose(); }
});

test('new edits blocking unload require a fresh confirmation and a new save acknowledgement', () => {
  const h = closeHarness();
  try {
    h.app.quit();
    const requestId = h.messages[0].requestId;
    h.ipcMain.emit('pflow:confirm-close-result', h.sender, { requestId, confirmed: true });
    const flushId = h.messages.at(-1).requestId;
    h.window.once('close', (event: any) => { event.preventDefault(); h.sender.sender.emit('will-prevent-unload'); });
    h.ipcMain.emit('pflow:save-before-close-result', h.sender, { requestId: flushId, ok: true });
    assert.equal(h.counts().closed, 0);
    assert.equal(h.messages.at(-1).payload.state, 'error');
    h.ipcMain.emit('pflow:confirm-close-result', h.sender, { requestId, confirmed: true });
    const nextFlush = h.messages.at(-1).requestId;
    assert.notEqual(nextFlush, flushId);
    h.ipcMain.emit('pflow:save-before-close-result', h.sender, { requestId: flushId, ok: true });
    assert.equal(h.counts().closed, 0);
    h.ipcMain.emit('pflow:save-before-close-result', h.sender, { requestId: nextFlush, ok: true });
    assert.equal(h.counts().closed, 1);
  } finally { h.dispose(); }
});

test('a crashed renderer cannot authorize a pending close with a delayed save response', () => {
  const h = closeHarness();
  try {
    h.app.quit();
    h.ipcMain.emit('pflow:confirm-close-result', h.sender, { requestId: h.messages[0].requestId, confirmed: true });
    const flushId = h.messages.at(-1).requestId;
    h.sender.sender.emit('render-process-gone');
    assert.equal(h.errors[0].type, 'error');
    h.ipcMain.emit('pflow:save-before-close-result', h.sender, { requestId: flushId, ok: true });
    assert.deepEqual(h.counts(), { quit: 0, closed: 0 });
  } finally { h.dispose(); }
});
