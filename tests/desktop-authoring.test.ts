import { parseCaptureOptions } from '../src/mcp/capturePreview';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createDesktopRelay } from '../src/mcp/desktopRelay';
import { parseCliArgs } from '../src/mcp/cli';
import { desktopAuthoringApi, enableDesktopAuthoring, startDesktopAuthoring, useDesktopAuthoring, publishCanvasSelection } from '../src/services/desktopAuthoring';
import { createProjectPayload, flushProjectChanges, loadProjectFromBinaryPayload, startProjectPersistence } from '../src/services/projectStorage';
import { pendingProjectAiTasks } from '../src/services/hermesTaskLock';
import { canUndoProjectChange, undoProjectChange } from '../src/services/projectUndo';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useAccountStore } from '../src/store/useAccountStore';
import { decodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { installTestDom } from './dom';
const { createDesktopAuthoringBridge, installDesignerSkill } = require('../electron/desktop-authoring.cjs');

test('capture options distinguish absent fields from invalid explicit values', () => {
  assert.deepEqual(parseCaptureOptions({}), { scope: 'viewport', waitMs: 0, pageId: undefined });
  for (const value of [null, [], {scope:'window'}, {waitMs:null}, {waitMs:'5'}, {waitMs:5001}, {pageId:' '}, {rect:{}}]) {
    assert.throws(() => parseCaptureOptions(value));
  }
});

test('Live MCP uses authenticated loopback, current editor selection, autosave revisions, Hermes lock and project undo', async () => {
  const restoreDom = installTestDom();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-desktop-authoring-'));
  const previous = [useProtoStore.getState(), usePageStore.getState(), useAccountStore.getState()] as const;
  type Api = NonNullable<ReturnType<typeof desktopAuthoringApi>>;
  let receive: Parameters<Api['onRequest']>[0];
  const bridge = createDesktopAuthoringBridge(path.join(dir, 'credentials'), (request: Parameters<typeof receive>[0]) => receive(request));
  const target = path.join(dir, 'live.pflow');
  let holdSave: (() => void) | undefined;
  let waitForSave: Promise<void> | undefined;
  let failSave = false;
  const api: Api = { ...bridge, onRequest(callback) { receive = callback; return () => {}; } };
  Object.assign(window, { protoflowDesktop: { isElectron: true, liveAuthoring: api,
    saveCurrentProject: async ({ binaryBytes }: { binaryBytes: Uint8Array }) => {
      if (waitForSave) await waitForSave;
      if (failSave) throw new Error('disk full');
      fs.writeFileSync(target, binaryBytes);
      return { saved: true };
    } } });
  const stopPersistence = startProjectPersistence(60_000);
  const stopBridge = startDesktopAuthoring();
  try {
    const payload = createProjectPayload({ projectId: 'live-test', projectName: 'Before', templateId: 'mobile_starter', fileName: 'live.pflow',
      storageDir: dir, pageCount: 0, tableCount: 0, stickyCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    loadProjectFromBinaryPayload(payload);
    useAccountStore.setState({ status: 'local' });
    await enableDesktopAuthoring();
    const connection = useDesktopAuthoring.getState().connectionPath!;
    assert.equal(process.platform === 'win32' || (fs.statSync(connection).mode & 0o077) === 0, true);
    const { port, token } = JSON.parse(fs.readFileSync(connection, 'utf8'));
    const endpoint = 'http://127.0.0.1:' + port + '/mcp';
    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { Origin: 'null', Authorization: 'Bearer ' + token } })).status, 403);
    const relay = createDesktopRelay(connection);
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const res: any = await relay({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name, arguments: args } });
      if (res.error || res.result.isError) throw new Error(res.error?.message ?? res.result.content[0].text);
      return JSON.parse(res.result.content[0].text);
    };
    const status = () => tool('protoflow_workspace', { action: 'status' });
    const rename = (projectName: string, expectedRevision?: string) => tool('protoflow_workspace', { action: 'update_project_meta', projectName, expectedRevision });
    const first = await status();
    assert.equal(first.transport, 'desktop_bridge');
    const page = useProtoStore.getState().activePageId;
    assert.equal(first.activePageId, page);
    const source = usePageStore.getState().pageSources[page];
    const selected = /pfId="([^"]+)"/.exec(source)![1];
    const clear = publishCanvasSelection({ projectId: 'live-test', pageId: page, pfId: selected, source });
    assert.equal((await status()).selectedPfId, selected);
    clear();
    assert.equal((await status()).selectedPfId, null);
    await assert.rejects(tool('protoflow_workspace', { action: 'switch_project', filePath: 'other.pflow' }), /Alex/);
    pendingProjectAiTasks.add('live-test');
    await assert.rejects(rename('busy'), /AI/);
    pendingProjectAiTasks.delete('live-test');

    useProtoStore.setState({ viewMode: 'db_designer' });
    api.capture = async () => {
      usePageStore.getState().setPageSource(page, source + '\n');
      return { data: 'stale', width: 1, height: 1 };
    };
    await assert.rejects(tool('protoflow_capture_preview'), /changed during preview capture/);
    await assert.rejects(rename('stale', first.revision), /冲突|conflict/);
    const dirty = await status();
    waitForSave = new Promise(resolve => { holdSave = resolve; });
    const changing = rename('First', dirty.revision);
    const deadline = Date.now() + 5000;
    while (!pendingProjectAiTasks.has('live-test') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(pendingProjectAiTasks.has('live-test'), 'MCP must acquire the shared lock before awaiting autosave');
    usePageStore.getState().setPageSource(page, source + '\n\n');
    holdSave!(); waitForSave = undefined;
    await assert.rejects(changing, /冲突|conflict/);
    await rename('First');
    const originalUndo = useDesktopAuthoring.getState().notice!.id;
    await rename('Second');
    const disk = () => decodePflowBinary(fs.readFileSync(target));
    assert.equal(disk().meta.projectName, 'Second');
    assert.equal(disk().stateSnapshot.pageSources[page], source + '\n\n');
    assert.equal(useProtoStore.getState().viewMode, 'db_designer');
    undoProjectChange(useDesktopAuthoring.getState().notice!.id);
    assert.equal(canUndoProjectChange(originalUndo), true);
    waitForSave = new Promise(resolve => { holdSave = resolve; });
    const savingUndo = flushProjectChanges();
    undoProjectChange(originalUndo);
    holdSave!(); waitForSave = undefined;
    await savingUndo;
    assert.equal(disk().meta.projectName, 'Before');
    assert.equal((await rename('Before')).revision, (await status()).revision);

    failSave = true;
    await assert.rejects(rename('Recoverable'), /已应用|applied/);
    assert.equal(useProtoStore.getState().currentProjectMeta.projectName, 'Recoverable');
    failSave = false;
    await flushProjectChanges();
    assert.equal(disk().meta.projectName, 'Recoverable');
    useProtoStore.getState().setWelcomeScreenOpen(true);
    assert.equal(fs.existsSync(connection), false);
    await assert.rejects(status(), /unavailable/);
  } finally {
    holdSave?.();
    pendingProjectAiTasks.delete('live-test');
    stopBridge(); bridge.close(); stopPersistence();
    useDesktopAuthoring.setState({ notice: null });
    useProtoStore.setState(previous[0]); usePageStore.setState(previous[1]); useAccountStore.setState(previous[2]);
    fs.rmSync(dir, { recursive: true, force: true }); restoreDom();
  }
});

test('Desktop CLI isolates live and file modes; bundled skill installs are repeatable and preserve customized copies', () => {
  for (const args of [['--desktop-bridge'], ['--desktop-bridge', '/info'], ['--rw', '--desktop-bridge', '/info', '--project', '/file'],
    ['--rw', '--desktop-bridge', '/info', '--share', 'https://example.com']]) assert.throws(() => parseCliArgs(args, {}));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-skill-install-'));
  const source = path.resolve('skills/alex-protoflow-designer');
  try {
    for (const client of ['codex', 'antigravity', 'claude']) {
      const target = installDesignerSkill(client, home, source);
      assert.equal(installDesignerSkill(client, home, source), target);
      assert.deepEqual(fs.readdirSync(path.join(target, 'references')), fs.readdirSync(path.join(source, 'references')));
      fs.writeFileSync(path.join(target, 'SKILL.md'), 'custom instructions');
      assert.throws(() => installDesignerSkill(client, home, source), /differs/);
      assert.equal(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'custom instructions');
    }
    assert.throws(() => installDesignerSkill('../invalid', home, source), /Unknown/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
