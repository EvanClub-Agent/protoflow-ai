import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HermesEnginePanel } from '../src/components/HermesManagementPanel';
import { useHermesStore } from '../src/store/useHermesStore';
const { HermesManagement, dashboardUrl, dashboardProfile, parseManifest, parseStageResult } = require(path.join(process.cwd(), 'electron/hermes-management.cjs'));
const stageNames = ['prerequisites', 'repository', 'venv', 'python-deps', 'config', 'products', 'complete'];
const manifest = JSON.stringify({ protocol_version: 1, stages: [...stageNames.map(name => ({ name, needs_user_input: false })), { name: 'setup', needs_user_input: true }] });
const info = { detected: true, home: '/selected profile', binary: '/selected install/hermes', version: 'test' };
function managerFixture(t: any, overrides: any = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-management-test-'));
  const events: any[] = [], connections: any[] = [];
  const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
  const runtime = new HermesRuntime({ dataDir: path.join(dir, 'integration'), managedHome: path.join(dir, 'hermes-home'), emit() {} });
  runtime.settings = { home: info.home, binary: info.binary };
  runtime.detect = async () => info;
  runtime.connect = async (input: any) => { connections.push(input); return info; };
  const manager = new HermesManagement({ dataDir: dir, runtime, emit: (e: any) => events.push(e), fetchResource: async () => { throw new Error('unexpected download'); }, ...overrides });
  t.after(() => { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { manager, runtime, dir, events, connections };
}
test('management routes are explicit, loopback-only and reject inherited object keys', () => {
  assert.equal(dashboardUrl('http://127.0.0.1:12000', 'accounts'), 'http://127.0.0.1:12000/env');
  assert.equal(dashboardUrl('http://127.0.0.1:12000', 'accounts', ''), 'http://127.0.0.1:12000/env?profile=');
  assert.equal(dashboardProfile('<script>window.__HERMES_DASHBOARD_PROFILE__="work";</script>'), 'work');
  assert.throws(() => dashboardProfile('<html>old dashboard</html>'));
  for (const section of ['__proto__', 'toString', '//example.com', '../../env', 'http://example.com']) assert.throws(() => dashboardUrl('http://127.0.0.1:12000', section));
  for (const origin of ['https://example.com', 'http://0.0.0.0:12000', 'http://127.0.0.1', 'http://user:password@127.0.0.1:12000']) assert.throws(() => dashboardUrl(origin, 'models'));
});
test('a failed ACP handshake keeps the explicitly selected home for repair and account management', async t => {
  const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-selected-home-test-'));
  const runtime = new HermesRuntime({ dataDir: dir, emit() {} });
  t.after(() => { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const selected = { detected: true, home: path.join(dir, 'chosen-home'), binary: path.join(dir, 'missing-hermes'), version: 'test' };
  runtime.detect = async () => selected;
  await assert.rejects(runtime.connect({ home: selected.home, binary: selected.binary }));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8')), { home: selected.home, binary: selected.binary });
});
test('fresh installs and restarts resolve only the private release despite external version and shell changes', async t => {
  const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-managed-selection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const opts = { dataDir: path.join(dir, 'integration'), managedHome: path.join(dir, 'management', 'hermes-home'), emit() {} };
  const runtime = new HermesRuntime(opts);
  const target = runtime.managedTarget();
  const local = { home: path.join(dir, 'old-profile'), binary: path.join(dir, 'user-bin', 'hermes') };
  fs.mkdirSync(path.dirname(local.binary), { recursive: true });
  fs.writeFileSync(local.binary, 'external', { mode: 0o755 });
  const variables = { HERMES_HOME: local.home, HERMES_RUNTIME_DIR: local.home, PATH: path.dirname(local.binary) };
  for (const [name, value] of Object.entries(variables)) {
    const saved = process.env[name];
    process.env[name] = value;
    t.after(() => { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; });
  }
  assert.equal((await runtime.detect()).detected, false);
  assert.equal(runtime.envFor(target.home).HERMES_RUNTIME_DIR, undefined);
  assert.equal(runtime.envFor(target.home).PATH.split(path.delimiter)[0], path.dirname(target.binary));
  assert.equal(runtime.envFor(local.home).HERMES_RUNTIME_DIR, local.home);
  fs.mkdirSync(path.dirname(target.binary), { recursive: true });
  fs.writeFileSync(target.binary, 'private', { mode: 0o755 });
  fs.writeFileSync(runtime.settingsFile, JSON.stringify({ home: target.home, binary: target.binary, previousExternal: local }));
  for (const externalVersion of ['0.23.3', '0.22.0']) {
    fs.writeFileSync(local.binary, externalVersion);
    const restarted = new HermesRuntime(opts);
    restarted.runCommand = async (binary: string) => {
      assert.equal(binary, target.binary);
      return { ok: true, output: 'Hermes Agent v0.23.1\nInstall directory: ' + fs.realpathSync(target.installDir) };
    };
    const detected = await restarted.detect();
    assert.equal(detected.detected, true);
    assert.equal(detected.binary, target.binary);
    assert.deepEqual(restarted.settings.previousExternal, local);
    restarted.close();
  }
  runtime.close();
});
test('an incompatible switch back preserves the live managed connection, workspace and previous profile', async t => {
  const { manager, dir } = managerFixture(t);
  const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
  const runtime = new HermesRuntime({ dataDir: dir, emit() {} });
  const { home, binary } = runtime.managedTarget();
  const previousExternal = { home: info.home, binary: info.binary };
  runtime.settings = { home, binary, previousExternal };
  fs.writeFileSync(runtime.settingsFile, JSON.stringify(runtime.settings));
  const workspace = runtime.workspace('project');
  const active = { closed: false, close() { this.closed = true; } };
  runtime.client = active;
  runtime.detect = async () => ({ ...previousExternal, detected: true, installDir: path.join(dir, 'unverified') });
  runtime.runCommand = async () => ({ ok: true, output: JSON.stringify([process.execPath]) });
  await assert.rejects(runtime.connect(previousExternal));
  assert.equal(runtime.client, active);
  assert.equal(active.closed, false);
  assert.equal(runtime.workspace('project'), workspace);
  assert.deepEqual(JSON.parse(fs.readFileSync(runtime.settingsFile, 'utf8')), { home, binary, previousExternal });
  manager.runtime = runtime;
  assert.deepEqual(manager.snapshot().previousExternal, previousExternal);
  runtime.close();
});
test('official installer protocol fails closed on changed stages, skipped steps and false success', () => {
  assert.equal(parseManifest(manifest).length, 7);
  assert.throws(() => parseManifest(manifest.replace('prerequisites', 'other-stage')));
  assert.throws(() => parseManifest(manifest.replace('protocol_version":1', 'protocol_version":2')));
  parseStageResult('log line\n{"ok":true,"stage":"products","skipped":false}\n', 'products');
  for (const output of ['installed!', '{"ok":false,"stage":"products"}', '{"ok":true,"stage":"config"}', '{"ok":true,"stage":"products","skipped":true}']) assert.throws(() => parseStageResult(output, 'products'));
});
test('install reuses the pinned managed launcher while an external Hermes is selected and coalesces duplicate clicks', async t => {
  const { manager, runtime, connections } = managerFixture(t);
  const target = runtime.managedTarget();
  fs.mkdirSync(path.dirname(target.binary), { recursive: true });
  fs.writeFileSync(target.binary, '');
  runtime.detect = async (input: any) => {
    assert.deepEqual(input, { home: target.home, binary: target.binary });
    return { ...target, detected: true };
  };
  manager.verifySource = (checkout: string) => assert.equal(checkout, target.installDir);
  assert.equal(manager.startInstall().status, 'running');
  manager.startInstall();
  await manager.installPromise;
  assert.equal(manager.snapshot().status, 'success');
  assert.deepEqual(connections, [{ home: target.home, binary: target.binary }]);
});
test('fresh install follows official phases and only succeeds after ACP connection, without interactive setup', async t => {
  const { manager, runtime, dir, connections, events } = managerFixture(t, { fetchResource: async () => ({ ok: true, text: async () => '# protocol_version' }) });
  runtime.detect = async () => info;
  manager.verifySource = (checkout: string) => assert.equal(checkout, runtime.managedTarget().installDir);
  const commands: any[] = [];
  manager.command = async (binary: string, args: string[], home: string) => {
    commands.push({ binary, args, home });
    if (args.includes('--print-runtime-command')) return JSON.stringify([path.resolve(dir, 'python')]);
    if (args.includes('--manifest')) return manifest;
    if (args.includes('--stage')) return JSON.stringify({ stage: args[args.indexOf('--stage') + 1], ok: true, skipped: false });
    return '';
  };
  manager.startInstall(); await manager.installPromise;
  assert.equal(manager.snapshot().status, 'success');
  assert.equal(commands.length, 10);
  assert.ok(commands.every(c => c.home === runtime.managedHome));
  const stages = commands.filter(c => c.args.includes('--stage'));
  assert.deepEqual(stages.map(c => c.args[c.args.indexOf('--stage') + 1]), stageNames.filter(s => s !== 'products'));
  assert.ok(stages.every(c => c.args.includes('--non-interactive') && c.args.includes('--json') && c.args.includes('--commit')));
  assert.ok(commands.some(c => c.binary === path.resolve(dir, 'python') && c.args.includes(runtime.managedTarget().installDir)));
  assert.deepEqual(commands.at(-1).args, ['pm', 'install', '--extra', 'acp', '--extra', 'web']);
  assert.equal(connections[0].home, path.join(dir, 'hermes-home'));
  assert.equal(connections[0].binary, runtime.managedTarget().binary);
  assert.equal(events.filter(e => e.installation.status === 'success').length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'installation-pending')), false);
});
test('retry after publication keeps the app-owned profile instead of adopting its PATH launcher with a wrong home', async t => {
  const { manager, runtime, dir, connections } = managerFixture(t, { fetchResource: async () => ({ ok: true, text: async () => '# protocol_version' }) });
  manager.verifySource = () => {};
  manager.prepareManagedDashboard = async () => {};
  fs.writeFileSync(path.join(dir, 'installation-pending'), '');
  manager.command = async (_: string, args: string[]) => args.includes('--manifest') ? manifest : args.includes('--stage') ? JSON.stringify({ stage: args[args.indexOf('--stage') + 1], ok: true, skipped: false }) : '';
  manager.startInstall(); await manager.installPromise;
  assert.equal(connections[0].home, path.join(dir, 'hermes-home'));
  assert.notEqual(connections[0].home, info.home);
});
test('cancellation, interrupted process recovery and verification failure never report success', async t => {
  const { manager, runtime, dir } = managerFixture(t, { fetchResource: (_: string, { signal }: any) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })) });
  runtime.detect = async () => ({ detected: false }) as any;
  manager.startInstall(); await new Promise(r => setImmediate(r));
  await manager.cancelInstall();
  assert.equal(manager.snapshot().status, 'cancelled');
  fs.writeFileSync(path.join(dir, 'installation.json'), JSON.stringify({ status: 'running' }));
  const restarted = new HermesManagement({ dataDir: dir, runtime, emit() {} });
  assert.equal(restarted.snapshot().status, 'interrupted');
  const target = runtime.managedTarget();
  fs.mkdirSync(path.dirname(target.binary), { recursive: true });
  fs.writeFileSync(target.binary, '');
  runtime.detect = async () => ({ ...target, detected: true });
  restarted.verifySource = () => {};
  fs.unlinkSync(path.join(dir, 'installation-pending'));
  runtime.connect = async () => { throw new Error('ACP handshake failed'); };
  restarted.startInstall(); await restarted.installPromise;
  assert.equal(restarted.snapshot().status, 'error');
  assert.match(restarted.snapshot().message, /ACP/);
});
test('dashboard reads fragmented readiness, uses the selected profile and never attaches to a global server', async t => {
  const spawned: any[] = [];
  const spawnProcess = (binary: string, args: string[], options: any) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, pid: undefined });
    spawned.push({ binary, args, options, child });
    setImmediate(() => { child.stdout.write('HERMES_DASH'); child.stdout.write('BOARD_READY port=12345\n'); });
    return child;
  };
  const { manager, runtime } = managerFixture(t, { spawnProcess, fetchResource: async () => ({ ok: true, text: async () => '<script>window.__HERMES_DASHBOARD_PROFILE__="selected";</script>' }) });
  const origins = await Promise.all([manager.dashboardOrigin(), manager.dashboardOrigin()]);
  assert.deepEqual(origins, ['http://127.0.0.1:12345', 'http://127.0.0.1:12345']);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].options.env.HERMES_HOME, info.home);
  assert.equal(await manager.managementUrl('accounts'), 'http://127.0.0.1:12345/env?profile=selected');
  assert.ok(spawned[0].args.includes('--isolated'));
  assert.equal(spawned[0].args[spawned[0].args.indexOf('--port') + 1], '0');
  await manager.dashboardOrigin(); assert.equal(spawned.length, 1);
  runtime.detect = async () => ({ ...info, home: '/other profile' });
  await manager.dashboardOrigin(); assert.equal(spawned.length, 2);
  assert.equal(spawned[1].options.env.HERMES_HOME, '/other profile');
});
test('in-flight chat blocks installation and installation blocks opening management', async t => {
  const { manager, runtime } = managerFixture(t);
  runtime.sessions.set('busy-project', { running: true });
  assert.throws(() => manager.startInstall(), /停止/);
  runtime.sessions.clear();
  manager.startInstall();
  await assert.rejects(manager.dashboardOrigin(), /等待/);
  await manager.installPromise;
});
test('management UI hides technical paths, uses real install/cancel actions and forwards exact management sections', async () => {
  const calls: any[] = [];
  const idle = { status: 'idle', phase: '', total: 9, completed: 0, message: '' };
  useHermesStore.setState(useHermesStore.getInitialState(), true);
  (window as any).protoflowDesktop = { hermes: {
    installation: async () => idle, onEvent: () => () => {},
    install: async () => { calls.push('install'); return { ...idle, status: 'running', phase: '下载 Hermes' }; },
    cancelInstall: async () => { calls.push('cancel'); return { ...idle, status: 'cancelled' }; },
    openManagement: async (input: any) => { calls.push(input); return { opened: true }; },
    accounts: { list: async () => ({ providers: [], keys: [] }) },
  } };
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(HermesEnginePanel, { embedded: true })); });
  const textOf = (node: TestRenderer.ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');
  const button = (text: string) => renderer!.root.findAllByType('button').find(b => textOf(b).includes(text))!;
  assert.equal(renderer!.root.findAllByType('input').length, 0);
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /hermes model|HERMES_HOME|终端运行/);
  await act(async () => button('自动安装并连接').props.onClick());
  assert.deepEqual(calls, ['install']);
  assert.equal(renderer!.root.findByType('progress').props.value, 0);
  await act(async () => button('取消安装').props.onClick());
  assert.deepEqual(calls, ['install', 'cancel']);
  act(() => useHermesStore.setState({ binaryPath: info.binary, currentVersion: info.version, status: 'detected_local' }));
  await act(async () => button('技能库').props.onClick());
  assert.deepEqual(calls.at(-1), { section: 'skills' });
  await act(async () => button('连接 AI 账号').props.onClick());
  assert.ok(renderer!.root.findByProps({ 'aria-label': 'AI 服务' }));
  act(() => button('返回 AI 管理中心').props.onClick());
  act(() => button('高级设置').props.onClick());
  assert.equal(renderer!.root.findAllByType('input').length, 2);
  act(() => renderer!.unmount());
});

test('management offers migration while external Hermes is connected and switches back to the recorded pair', async () => {
  const external = { home: '/selected profile', binary: '/custom launcher' };
  const idle = { status: 'idle', phase: '', total: 9, completed: 0, message: '' };
  const managed = { ...idle, selectedRuntime: 'managed', previousExternal: external };
  const calls: unknown[] = [];
  useHermesStore.setState({ ...useHermesStore.getInitialState(), status: 'running', currentVersion: 'v0.23.1', binaryPath: external.binary, hermesHomePath: external.home }, true);
  (window as any).protoflowDesktop = { hermes: {
    installation: async () => ({ ...idle, selectedRuntime: 'external' }), onEvent: () => () => {},
    install: async () => { calls.push('managed'); return managed; },
    connect: async (selection: unknown) => { calls.push(selection); return info; },
  } };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(HermesEnginePanel)); });
  const click = (label: string) => renderer.root.findAllByType('button').find(b => b.children.includes(label))!.props.onClick();
  await act(async () => click('使用 Alex 托管运行时'));
  act(() => click('高级设置'));
  await act(async () => click('切回原 Hermes 环境'));
  assert.deepEqual(calls, ['managed', external]);
  act(() => renderer.unmount());
});

test('upgradeHermesRuntime syncs UI status from real post-failure detect() connection state', async () => {
  // 1. Pre-switch staging rejection keeps live connection -> status remains 'running'
  useHermesStore.setState({
    ...useHermesStore.getInitialState(),
    status: 'running',
    currentVersion: '0.23.1',
    hermesHomePath: info.home,
    binaryPath: info.binary,
  }, true);
  (window as any).protoflowDesktop = {
    hermes: {
      update: async () => { throw new Error('暂存区 Hermes 提交校验未通过，原环境保持不变'); },
      detect: async () => ({ detected: true, connected: true, home: info.home, binary: info.binary, version: '0.23.1' }),
    },
  };
  await assert.rejects(useHermesStore.getState().upgradeHermesRuntime(), /原环境保持不变/);
  assert.equal(useHermesStore.getState().status, 'running');
  assert.equal(useHermesStore.getState().binaryPath, info.binary);
  assert.match(useHermesStore.getState().error || '', /原环境保持不变/);

  // 2. Switch failure + rollback reconnect failure from 'running' -> connected=false -> status MUST become 'error', never 'running'
  useHermesStore.setState({
    ...useHermesStore.getInitialState(),
    status: 'running',
    currentVersion: '0.23.1',
    hermesHomePath: info.home,
    binaryPath: info.binary,
    sessions: { 'proj:1': { sessionId: 's1', running: false, models: { currentModelId: 'm', availableModels: [] }, projectId: '1', kind: 'project', threadId: 't' } as any },
  }, true);
  (window as any).protoflowDesktop = {
    hermes: {
      update: async () => { throw new Error('Hermes 升级切换失败（staged failed），且恢复原连接失败（rollback failed）'); },
      detect: async () => ({ detected: true, connected: false, home: info.home, binary: info.binary, version: '0.23.1' }),
    },
  };
  await assert.rejects(useHermesStore.getState().upgradeHermesRuntime(), /恢复原连接失败/);
  assert.equal(useHermesStore.getState().status, 'error');
  assert.deepEqual(useHermesStore.getState().sessions, {});
  assert.equal(useHermesStore.getState().binaryPath, info.binary);

  // 3. Switch failure from 'detected_local' (not connected before upgrade) -> connected=false, detected=true -> stays 'detected_local' with restored binary
  useHermesStore.setState({
    ...useHermesStore.getInitialState(),
    status: 'detected_local',
    currentVersion: '0.23.1',
    hermesHomePath: info.home,
    binaryPath: info.binary,
  }, true);
  (window as any).protoflowDesktop = {
    hermes: {
      update: async () => { throw new Error('staged handshake failed'); },
      detect: async () => ({ detected: true, connected: false, home: info.home, binary: info.binary, version: '0.23.1' }),
    },
  };
  await assert.rejects(useHermesStore.getState().upgradeHermesRuntime(), /staged handshake failed/);
  assert.equal(useHermesStore.getState().status, 'detected_local');
  assert.equal(useHermesStore.getState().binaryPath, info.binary);
});
