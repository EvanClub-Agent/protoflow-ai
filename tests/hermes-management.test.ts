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
  const runtime = { sessions: new Map(), detect: async () => info, close() {}, connect: async (input: any) => { connections.push(input); return info; } };
  const manager = new HermesManagement({ dataDir: dir, runtime, emit: (e: any) => events.push(e), ...overrides });
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
test('official installer protocol fails closed on changed stages, skipped steps and false success', () => {
  assert.equal(parseManifest(manifest).length, 7);
  assert.throws(() => parseManifest(manifest.replace('prerequisites', 'other-stage')));
  assert.throws(() => parseManifest(manifest.replace('protocol_version":1', 'protocol_version":2')));
  parseStageResult('log line\n{"ok":true,"stage":"products","skipped":false}\n', 'products');
  for (const output of ['installed!', '{"ok":false,"stage":"products"}', '{"ok":true,"stage":"config"}', '{"ok":true,"stage":"products","skipped":true}']) assert.throws(() => parseStageResult(output, 'products'));
});
test('an existing Hermes is reused without any download or installation and duplicate clicks coalesce', async t => {
  const { manager, connections } = managerFixture(t, { fetchResource: () => { throw new Error('must not download'); } });
  assert.equal(manager.startInstall().status, 'running');
  manager.startInstall();
  await manager.installPromise;
  assert.equal(manager.snapshot().status, 'success');
  assert.deepEqual(connections, [{ home: info.home, binary: info.binary }]);
});
test('fresh install follows official phases and only succeeds after ACP connection, without interactive setup', async t => {
  const { manager, runtime, dir, connections, events } = managerFixture(t, { fetchResource: async () => ({ ok: true, text: async () => '# protocol_version' }) });
  runtime.detect = async () => ({ detected: false }) as any;
  const commands: any[] = [];
  manager.command = async (binary: string, args: string[], home: string) => {
    commands.push({ binary, args, home });
    if (args.includes('--manifest')) return manifest;
    if (args.includes('--stage')) return JSON.stringify({ stage: args[args.indexOf('--stage') + 1], ok: true, skipped: false });
    return '';
  };
  manager.startInstall(); await manager.installPromise;
  assert.equal(manager.snapshot().status, 'success');
  assert.equal(commands.length, 9);
  assert.ok(commands.every(c => c.home === path.join(dir, 'hermes-home')));
  assert.ok(commands.slice(0, 8).every(c => c.args.includes('--commit')));
  assert.ok(commands.slice(1, 8).every(c => c.args.includes('--non-interactive') && c.args.includes('--json')));
  assert.deepEqual(commands.at(-1).args, ['pm', 'install', '--extra', 'acp', '--extra', 'web']);
  assert.equal(connections[0].home, path.join(dir, 'hermes-home'));
  assert.equal(connections[0].binary, path.join(dir, 'hermes-home/hermes-agent/.hermes/bin/hermes'));
  assert.equal(events.filter(e => e.installation.status === 'success').length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'installation-pending')), false);
});
test('retry after publication keeps the app-owned profile instead of adopting its PATH launcher with a wrong home', async t => {
  const { manager, dir, connections } = managerFixture(t, { fetchResource: async () => ({ ok: true, text: async () => '# protocol_version' }) });
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
  runtime.detect = async () => info;
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
