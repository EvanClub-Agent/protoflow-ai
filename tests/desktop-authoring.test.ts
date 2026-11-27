import { parseCaptureOptions } from '../src/mcp/capturePreview';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createDesktopRelay } from '../src/mcp/desktopRelay';
import { PROTOFLOW_CONTRACT_DIGEST } from '../src/mcp/generatedSkillBundle';
import { parseCliArgs } from '../src/mcp/cli';
import { desktopAuthoringApi, DESKTOP_AUTHORING_PREF_KEY, disableDesktopAuthoring, enableDesktopAuthoring, startDesktopAuthoring, useDesktopAuthoring, publishCanvasSelection } from '../src/services/desktopAuthoring';
import { createProjectPayload, flushProjectChanges, loadProjectFromBinaryPayload, startProjectPersistence } from '../src/services/projectStorage';
import { pendingProjectAiTasks } from '../src/services/hermesTaskLock';
import { canUndoProjectChange, undoProjectChange } from '../src/services/projectUndo';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useAccountStore } from '../src/store/useAccountStore';
import { decodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { installTestDom } from './dom';
const { createDesktopAuthoringBridge, installDesignerSkill, syncManagedIntegrations } = require('../electron/desktop-authoring.cjs');

test('capture options distinguish absent fields from invalid explicit values', () => {
  assert.deepEqual(parseCaptureOptions({}), { scope: 'viewport', fullPage: false, waitMs: 0, pageId: undefined });
  for (const value of [null, [], {scope:'window'}, {fullPage:1}, {fullPage:null}, {waitMs:null}, {waitMs:'5'}, {waitMs:5001}, {pageId:' '}, {rect:{}}]) {
    assert.throws(() => parseCaptureOptions(value));
  }
});

test('one bridge owns live.json until it closes, with recovery after process exit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-live-owner-'));
  const first = createDesktopAuthoringBridge(dir, () => {});
  const second = createDesktopAuthoringBridge(dir, () => {});
  const target = (id: string) => ({ sessionId: id, projectId: id, storageDir: dir, fileName: id + '.pflow' });
  try {
    const { connectionPath } = await first.open(target('first'));
    const published = fs.readFileSync(connectionPath);
    await assert.rejects(second.open(target('second')), /另一个 Alex 实例|other Alex instance/);
    second.close();
    assert.deepEqual(fs.readFileSync(connectionPath), published);
    first.close();
    await second.open(target('second'));
    first.close();
    assert.ok(fs.existsSync(connectionPath));
    second.close();
    fs.mkdirSync(connectionPath);
    await assert.rejects(first.open(target('failed-publish')));
    assert.ok(!fs.existsSync(path.join(dir, 'live.lock')));
    fs.rmdirSync(connectionPath);

    const child = spawnSync(process.execPath, ['-e', `
      const { createDesktopAuthoringBridge } = require('./electron/desktop-authoring.cjs');
      createDesktopAuthoringBridge(process.argv[1], () => {}).open(JSON.parse(process.argv[2]))
        .then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
    `, dir, JSON.stringify(target('exited'))], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    const abandoned = fs.readFileSync(connectionPath);
    await first.open(target('recovered'));
    assert.notDeepEqual(fs.readFileSync(connectionPath), abandoned);
  } finally {
    first.close(); second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop reconnect follows the latest project and stops after revocation or open failure', async () => {
  const restoreDom = installTestDom();
  const previous = [useProtoStore.getState(), usePageStore.getState(), useAccountStore.getState()] as const;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-reconnect-'));
  const connectionPath = path.join(dir, 'live.json');
  const calls: string[] = [];
  let finishOpen!: () => void;
  let delayed = '';
  let fail = false;
  const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
  Object.assign(window, { protoflowDesktop: { isElectron: true, saveCurrentProject: async () => ({ saved: true }),
    liveAuthoring: {
      async open({ projectId, fileName }: { projectId: string; fileName: string }) {
        calls.push(projectId);
        if (projectId === delayed) await new Promise<void>(resolve => { finishOpen = resolve; });
        if (fail) throw new Error('open failed');
        return { connectionPath, projectPath: path.join(dir, fileName) };
      },
      close: async () => {}, onRequest: () => () => {},
    } } });
  const stopPersistence = startProjectPersistence(), stopBridge = startDesktopAuthoring();
  const openProject = (projectId: string) => loadProjectFromBinaryPayload(createProjectPayload({
    projectId, projectName: projectId, templateId: 'blank_project', storageDir: dir, fileName: projectId + '.pflow',
    pageCount: 0, tableCount: 0, stickyCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }));
  try {
    useAccountStore.setState({ status: 'local' });
    openProject('first');
    delayed = 'first';
    const stale = assert.rejects(enableDesktopAuthoring(), /切换|changed/);
    openProject('second');
    await nextTurn();
    finishOpen();
    await stale;
    assert.deepEqual(calls, ['first', 'second']);
    assert.equal(useDesktopAuthoring.getState().connectionPath, connectionPath);

    useAccountStore.setState({ status: 'signedOut' });
    useAccountStore.setState({ status: 'local' });
    await nextTurn();
    assert.equal(useDesktopAuthoring.getState().enabled, false);
    delayed = 'second';
    const cancelled = assert.rejects(enableDesktopAuthoring(), /切换|changed/);
    await disableDesktopAuthoring();
    finishOpen();
    await cancelled;
    assert.equal(useDesktopAuthoring.getState().connectionPath, null);

    delayed = '';
    fail = true;
    await assert.rejects(enableDesktopAuthoring(), /open failed/);
    fail = false;
    openProject('third');
    await nextTurn();
    assert.equal(useDesktopAuthoring.getState().connectionError, 'open failed');
    assert.equal(useDesktopAuthoring.getState().enabled, false);
    assert.equal(useDesktopAuthoring.getState().connectionPath, null);
    assert.ok(!calls.includes('third'));
  } finally {
    stopBridge(); stopPersistence();
    useProtoStore.setState(previous[0]); usePageStore.setState(previous[1]); useAccountStore.setState(previous[2]);
    fs.rmSync(dir, { recursive: true, force: true }); restoreDom();
  }
});

test('an unanswered desktop verification times out in five seconds and recovers immediately when desktop responds', { timeout: 12_000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-relay-verification-'));
  let received = 0;
  let responding = false;
  const bridge = createDesktopAuthoringBridge(dir, (req: { id: string; sessionId: string; body: string }) => {
    received++;
    if (responding) {
      const rpc = JSON.parse(req.body);
      const status = { contractMatch: true, contractCheckStatus: 'matched', contractDigest: PROTOFLOW_CONTRACT_DIGEST };
      bridge.reply({ id: req.id, sessionId: req.sessionId, body: JSON.stringify({
        jsonrpc: '2.0', id: rpc.id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify(status) }] },
      }) });
    }
  });
  t.after(() => { bridge.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { connectionPath } = await bridge.open({ sessionId: 'session', projectId: 'project', storageDir: dir, fileName: 'project.pflow' });
  const relay = createDesktopRelay(connectionPath);
  const status = async (args: Record<string, unknown>) => {
    const reply = await relay({ id: 1, method: 'tools/call', params: { name: 'protoflow_workspace', arguments: args } });
    assert.ok(reply && !Array.isArray(reply) && !reply.error);
    return reply.result as { isError: boolean; content: { text: string }[] };
  };
  const verification = { action: 'status', expectedContractDigest: PROTOFLOW_CONTRACT_DIGEST };
  const start = performance.now();
  const failure = await status(verification);
  assert.ok(performance.now() - start < 7_500, 'allow scheduler slack around the five-second deadline');
  assert.equal(failure.isError, true);
  assert.ok(failure.content[0].text.startsWith('[CONTRACT_UNVERIFIED]'));
  responding = true;
  assert.equal((await status({})).isError, false);
  assert.equal((await status(verification)).isError, false);
  assert.equal(received, 3);
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
    saveCurrentProject: async ({ dirPath, fileName, binaryBytes }: { dirPath: string; fileName: string; binaryBytes: Uint8Array }) => {
      if (waitForSave) await waitForSave;
      if (failSave) throw new Error('disk full');
      fs.writeFileSync(path.join(dirPath, fileName), binaryBytes);
      return { saved: true };
    } } });
  const stopPersistence = startProjectPersistence(60_000);
  const stopBridge = startDesktopAuthoring();
  try {
    const credentialsDir = path.join(dir, 'credentials');
    fs.mkdirSync(credentialsDir, { recursive: true });
    const legacyConnection = path.join(credentialsDir, '95fc06dd1411539458d091a5ff47733f8505f491d22fcac89313ad7453bf3233.json');
    fs.writeFileSync(legacyConnection, '{}');
    const payload = createProjectPayload({ projectId: 'live-test', projectName: 'Before', templateId: 'mobile_starter', fileName: 'live.pflow',
      storageDir: dir, pageCount: 0, tableCount: 0, stickyCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    loadProjectFromBinaryPayload(payload);
    useAccountStore.setState({ status: 'local' });
    await enableDesktopAuthoring();
    const connection = useDesktopAuthoring.getState().connectionPath!;
    assert.equal(path.basename(connection), 'live.json');
    assert.ok(fs.existsSync(legacyConnection), 'Older instances retain ownership of their project-specific files');
    assert.equal(process.platform === 'win32' || (fs.statSync(connection).mode & 0o077) === 0, true);
    const { port, token } = JSON.parse(fs.readFileSync(connection, 'utf8'));
    const endpoint = 'http://127.0.0.1:' + port + '/mcp';
    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { Origin: 'null', Authorization: 'Bearer ' + token } })).status, 403);
    // Older bundled relays without X-Alex-Contract-Lock stay compatible across desktop upgrades (no HTTP 426!)
    const legacyRelay = await fetch(endpoint, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(legacyRelay.status, 200);
    const legacyToolsBody = await legacyRelay.json();
    assert.equal(legacyToolsBody.result.tools.length, 7);
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
    await assert.rejects(rename('busy', first.revision), /AI/);
    pendingProjectAiTasks.delete('live-test');

    useProtoStore.setState({ viewMode: 'db_designer' });
    api.capture = async () => {
      usePageStore.getState().setPageSource(page, source + '\n');
      return { data: 'stale', width: 1, height: 1, truncated: false };
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
    const firstEdit = await rename('First', (await status()).revision);
    const originalUndo = useDesktopAuthoring.getState().notice!.id;
    await rename('Second', firstEdit.revision);
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
    const restored = await status();
    assert.equal((await rename('Before', restored.revision)).revision, restored.revision);

    failSave = true;
    await assert.rejects(rename('Recoverable', restored.revision), /已应用|applied/);
    assert.equal(useProtoStore.getState().currentProjectMeta.projectName, 'Recoverable');
    failSave = false;
    await flushProjectChanges();
    assert.equal(disk().meta.projectName, 'Recoverable');
    useProtoStore.getState().setWelcomeScreenOpen(true);
    assert.equal(fs.existsSync(connection), false);
    const offlineInit: any = await relay({ jsonrpc: '2.0', id: 20, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(offlineInit.error, undefined);
    assert.match(offlineInit.result.instructions, /protoflow_capture_preview/);
    const offlineTools: any = await relay({ jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} });
    assert.equal(offlineTools.error, undefined);
    assert.equal(offlineTools.result.tools.length, 7);
    assert.equal(offlineTools.result.tools.some((t: { name: string }) => t.name === 'protoflow_capture_preview'), true);
    const schemaFor = (name: string) => offlineTools.result.tools.find((tool: { name: string }) => tool.name === name).inputSchema;
    assert.ok(schemaFor('protoflow_sitemap').required.includes('expectedRevision'));
    for (const name of ['protoflow_workspace', 'protoflow_database', 'protoflow_page', 'protoflow_docs']) {
      const schema = schemaFor(name);
      assert.ok(!Object.hasOwn(schema, 'if') && !Object.hasOwn(schema, 'then'));
      assert.ok(!schema.required?.includes('expectedRevision'));
    }
    assert.match(schemaFor('protoflow_workspace').properties.expectedRevision.description, /update_project_meta/);
    assert.match(schemaFor('protoflow_database').properties.expectedRevision.description, /upsert_tables.*seed_rows/);
    assert.ok((await tool('protoflow_workspace', { action: 'contracts' })).components.desktop.length > 0);
    assert.ok((await tool('protoflow_get_contracts')).components.desktop.length > 0);
    await assert.rejects(status(), /unavailable/);

    // Switching or creating another project reconnects automatically on the same live.json path.
    const secondPayload = createProjectPayload({ projectId: 'switched-project', projectName: 'Switched Project', templateId: 'blank_project',
      fileName: 'second.pflow', storageDir: dir, pageCount: 0, tableCount: 0, stickyCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    loadProjectFromBinaryPayload(secondPayload);
    const reconnectDeadline = Date.now() + 5000;
    while (!useDesktopAuthoring.getState().connectionPath && Date.now() < reconnectDeadline) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(useDesktopAuthoring.getState().connectionPath, connection);
    const switchedStatus = await status();
    assert.equal(switchedStatus.projectId, 'switched-project');
    assert.equal(switchedStatus.projectName, 'Switched Project');
    await assert.rejects(rename('Missing version'), /expectedRevision/);
    await assert.rejects(rename('Old rev', first.revision), /冲突|conflict/);
    assert.deepEqual(await status(), switchedStatus);
    assert.equal(fs.existsSync(path.join(dir, 'second.pflow')), false);
    await rename('Confirmed second project', switchedStatus.revision);
    assert.equal(decodePflowBinary(fs.readFileSync(path.join(dir, 'second.pflow'))).meta.projectName, 'Confirmed second project');
    assert.equal(disk().meta.projectName, 'Recoverable');

    // Persisted bidirectional preference survives app restart even when account store boots from 'checking' -> 'local'
    await enableDesktopAuthoring();
    assert.equal(window.localStorage.getItem(DESKTOP_AUTHORING_PREF_KEY), '1');
    stopBridge();
    assert.equal(useDesktopAuthoring.getState().enabled, false);
    useAccountStore.setState({ status: 'checking' });
    const restartedBridge = startDesktopAuthoring();
    assert.equal(useDesktopAuthoring.getState().enabled, true);
    useAccountStore.setState({ status: 'local' });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(useDesktopAuthoring.getState().enabled, true);
    assert.equal(window.localStorage.getItem(DESKTOP_AUTHORING_PREF_KEY), '1');
    assert.equal(useDesktopAuthoring.getState().connectionPath, connection);
    restartedBridge();

    // Explicitly switching back to read-only clears saved preference and prevents auto-reconnecting on subsequent projects.
    const resumedBridge = startDesktopAuthoring();
    await disableDesktopAuthoring();
    assert.equal(window.localStorage.getItem(DESKTOP_AUTHORING_PREF_KEY), '0');
    assert.equal(fs.existsSync(connection), false);
    const thirdPayload = createProjectPayload({ projectId: 'third-project', projectName: 'Third Project', templateId: 'blank_project',
      fileName: 'third.pflow', storageDir: dir, pageCount: 0, tableCount: 0, stickyCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    loadProjectFromBinaryPayload(thirdPayload);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(useDesktopAuthoring.getState().connectionPath, null);
    await assert.rejects(status(), /unavailable/);
    resumedBridge();
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
    for (const client of ['codex', 'antigravity', 'claude', 'workbuddy']) {
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

test('client packages contain a portable stdio server, preserve customized plugins and rebind only the connection path', () => {
  const { claudeBundle, installPlugin, pluginFiles } = require('../scripts/client-integrations.cjs');
  const { unzipSync } = require('fflate');
  const root = process.cwd();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alex client packages '));
  const executable = process.execPath;
  const first = path.join(temp, 'first connection.json'), second = path.join(temp, 'second connection.json');
  fs.writeFileSync(first, '{"token":"test-private-token"}');
  try {
    const portable = pluginFiles(root);
    assert.equal(JSON.parse(portable['mcp_config.json']).mcpServers.alex.variables[0].name, 'ALEX_CONNECTION_FILE');
    assert.ok(portable['skills/alex-protoflow-designer/SKILL.md']);
    for (const connection of [undefined, first]) {
      const files = unzipSync(claudeBundle(root, connection));
      assert.deepEqual(Object.keys(files).sort(), ['LICENSE', 'manifest.json', 'server/cli.cjs']);
      const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
      assert.ok(files[manifest.server.entry_point]);
      assert.equal(manifest.user_config.connection_file.default, connection);
      assert.ok(Object.values(files).every(bytes => !Buffer.from(bytes as Uint8Array).includes('test-private-token')));
    }
    const bind = (connectionFile: string, options?: { forceRepair?: boolean }) =>
      installPlugin(root, temp, { executable, connectionFile }, options);
    const target = bind(first);
    // Benign OS metadata files (.DS_Store) never trigger false conflict errors
    fs.writeFileSync(path.join(target, '.DS_Store'), 'finder');
    assert.equal(bind(first), target);
    assert.equal(bind(second), target);
    const config = path.join(target, 'mcp_config.json');
    assert.equal(JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.alex.args.at(-1), second);
    fs.writeFileSync(config, '{"mcpServers":{"custom":{}}}');
    assert.throws(() => bind(first), /Existing plugin differs/);
    assert.equal(fs.readFileSync(config, 'utf8'), '{"mcpServers":{"custom":{}}}');
    // One-click forceRepair cleanly recovers corrupted or customized directories when explicitly requested by user
    assert.equal(bind(first, { forceRepair: true }), target);
    assert.equal(JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.alex.args.at(-1), first);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('managed designer installs upgrade verified trees, migrate legacy bindings and preserve local edits', () => {
  const { installPlugin } = require('../scripts/client-integrations.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-managed-install-'));
  const assets = path.join(dir, 'assets'), home = path.join(dir, 'account');
  const skill = path.join(assets, 'skills/alex-protoflow-designer'), codexHome = path.join(dir, 'custom codex');
  try {
    fs.cpSync(path.resolve('skills/alex-protoflow-designer'), skill, { recursive: true });
    fs.mkdirSync(path.join(assets, 'electron/generated'), { recursive: true });
    fs.copyFileSync('LICENSE', path.join(assets, 'LICENSE'));
    const writeRelease = (version: string) => {
      fs.writeFileSync(path.join(assets, 'package.json'), JSON.stringify({ version, license: 'Apache-2.0', author: { name: 'Alex' } }));
      fs.writeFileSync(path.join(assets, 'electron/generated/spec-mcp-server.cjs'), '// ' + version);
    };
    writeRelease('1.0.0');
    const bind = (project: string) => installPlugin(assets, home, { executable: process.execPath, connectionFile: path.join(dir, project + '.json') });
    const install = () => installDesignerSkill('codex', home, skill, codexHome);
    const plugin = bind('A'), installed = install();
    assert.equal(installed, path.join(codexHome, 'skills/alex-protoflow-designer'));
    // Receipt-less copies from the same distribution can be adopted on rebind.
    for (const target of [plugin, installed]) fs.unlinkSync(path.join(target, '.alex-install.json'));
    bind('B'); install();
    writeRelease('2.0.0');
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'New bundled instructions');
    fs.unlinkSync(path.join(skill, 'references/axure-reshape.md'));
    bind('C'); install();
    assert.equal(JSON.parse(fs.readFileSync(path.join(plugin, 'plugin.json'), 'utf8')).version, '2.0.0');
    for (const target of [installed, path.join(plugin, 'skills/alex-protoflow-designer')]) {
      assert.equal(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'New bundled instructions');
      assert.equal(fs.existsSync(path.join(target, 'references/axure-reshape.md')), false);
    }
    // A competing installer keeps the previous tree intact. A dead writer's
    // interrupted rename is recovered before the next install checks the hashes.
    const transaction = path.join(path.dirname(installed), '.' + path.basename(installed) + '.alex-update');
    fs.mkdirSync(transaction);
    const owner = (pid: number) => path.join(transaction, 'owner-' + pid + '-d04b82b0-383e-426c-a593-ab2003f41612');
    fs.writeFileSync(owner(process.pid), '');
    assert.throws(install, /in progress/);
    const exited = require('node:child_process').spawnSync(process.execPath, ['-e', '']);
    assert.equal(exited.status, 0);
    fs.renameSync(owner(process.pid), owner(exited.pid));
    fs.renameSync(installed, path.join(transaction, 'previous'));
    assert.equal(install(), installed);
    assert.equal(fs.existsSync(transaction), false);
    fs.writeFileSync(path.join(installed, 'personal.md'), 'My notes');
    assert.throws(install, /Existing skill differs/);
    assert.equal(fs.readFileSync(path.join(installed, 'personal.md'), 'utf8'), 'My notes');
    fs.unlinkSync(path.join(plugin, 'server/cli.cjs'));
    assert.throws(() => bind('D'), /Existing plugin differs/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(plugin, 'mcp_config.json'), 'utf8')).mcpServers.alex.args.at(-1), path.join(dir, 'C.json'));
    // Silent background sync repairs nothing when customized/corrupted, and auto-updates clean managed installs
    installPlugin(assets, home, { executable: process.execPath, connectionFile: path.join(dir, 'C.json') }, { forceRepair: true });
    fs.unlinkSync(path.join(installed, 'personal.md'));
    writeRelease('3.0.0');
    const synced = syncManagedIntegrations({
      root: assets,
      home,
      executable: process.execPath,
      connectionFile: path.join(dir, 'E.json'),
      codexHome,
      installPlugin,
    });
    assert.equal(synced.length, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(plugin, 'plugin.json'), 'utf8')).version, '3.0.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(plugin, 'mcp_config.json'), 'utf8')).mcpServers.alex.args.at(-1), path.join(dir, 'E.json'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installWorkBuddy configures zero-Node MCP + Skill, preserves existing user connectors, backs up malformed JSON on repair, and auto-syncs across upgrades', () => {
  const { installWorkBuddy } = require('../scripts/client-integrations.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-workbuddy-install-'));
  const assets = path.join(dir, 'assets'), home = path.join(dir, 'pm-home');
  const skill = path.join(assets, 'skills/alex-protoflow-designer');
  try {
    fs.cpSync(path.resolve('skills/alex-protoflow-designer'), skill, { recursive: true });
    fs.mkdirSync(path.join(assets, 'electron/generated'), { recursive: true });
    fs.copyFileSync('LICENSE', path.join(assets, 'LICENSE'));
    const writeRelease = (version: string) => {
      fs.writeFileSync(path.join(assets, 'package.json'), JSON.stringify({ version, license: 'Apache-2.0', author: { name: 'Alex' } }));
      fs.writeFileSync(path.join(assets, 'electron/generated/spec-mcp-server.cjs'), '// wb-' + version);
    };
    writeRelease('1.0.0');

    // Pre-populate existing WorkBuddy connectors (Tencent Docs & Feishu) + CodeBuddy shared home
    fs.mkdirSync(path.join(home, '.workbuddy'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.workbuddy/mcp.json'),
      JSON.stringify({
        enableAllProjectMcpServers: true,
        mcpServers: {
          'tencent-docs': { url: 'https://docs.qq.com/mcp' },
          feishu: { command: 'npx', args: ['feishu-mcp'] },
        },
      }, null, 2),
    );
    fs.mkdirSync(path.join(home, '.codebuddy'), { recursive: true });

    const conn1 = path.join(dir, 'live-1.json');
    const conn2 = path.join(dir, 'live-2.json');
    const cfgPath = installWorkBuddy(assets, home, { executable: process.execPath, connectionFile: conn1 });
    assert.equal(cfgPath, path.join(home, '.workbuddy/mcp.json'));

    const parsed1 = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(parsed1.enableAllProjectMcpServers, true);
    assert.deepEqual(parsed1.mcpServers['tencent-docs'], { url: 'https://docs.qq.com/mcp' });
    assert.deepEqual(parsed1.mcpServers.feishu, { command: 'npx', args: ['feishu-mcp'] });
    assert.equal(parsed1.mcpServers.alex.command, process.execPath);
    assert.deepEqual(parsed1.mcpServers.alex.env, { ELECTRON_RUN_AS_NODE: '1' });
    assert.equal(parsed1.mcpServers.alex.args.at(-1), conn1);
    assert.equal(
      parsed1.mcpServers.alex.args[0],
      path.join(home, '.workbuddy/plugins/alex-protoflow-designer/server/cli.cjs'),
    );
    assert.ok(fs.existsSync(path.join(home, '.workbuddy/skills/alex-protoflow-designer/SKILL.md')));
    // Shared .codebuddy directory is also synced automatically when present
    assert.ok(fs.existsSync(path.join(home, '.codebuddy/skills/alex-protoflow-designer/SKILL.md')));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(home, '.codebuddy/.mcp.json'), 'utf8')).mcpServers.alex.args.at(-1),
      conn1,
    );

    // Corrupted mcp.json fails safely without overwriting until forceRepair is requested
    fs.writeFileSync(cfgPath, '{ invalid json');
    assert.throws(
      () => installWorkBuddy(assets, home, { executable: process.execPath, connectionFile: conn2 }),
      /格式无法解析/,
    );
    assert.equal(fs.readFileSync(cfgPath, 'utf8'), '{ invalid json');

    installWorkBuddy(assets, home, { executable: process.execPath, connectionFile: conn2 }, { forceRepair: true });
    assert.equal(fs.readFileSync(cfgPath + '.bak', 'utf8'), '{ invalid json');
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).mcpServers.alex.args.at(-1), conn2);

    // Background sync upgrades WorkBuddy runtime, skill, and connection path seamlessly
    writeRelease('2.5.0');
    const conn3 = path.join(dir, 'live-3.json');
    const synced = syncManagedIntegrations({
      root: assets,
      home,
      executable: process.execPath,
      connectionFile: conn3,
      installWorkBuddy,
    });
    assert.deepEqual(synced, [cfgPath]);
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).mcpServers.alex.args.at(-1), conn3);
    assert.equal(
      fs.readFileSync(path.join(home, '.workbuddy/plugins/alex-protoflow-designer/server/cli.cjs'), 'utf8'),
      '// wb-2.5.0',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
