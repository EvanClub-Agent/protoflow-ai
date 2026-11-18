import test from 'node:test';
import { installTestDom } from './dom';
import { publishingBridgeFixture } from './publishingBridgeFixture';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AccountGate } from '../src/components/AccountGate';
import { useAccountStore } from '../src/store/useAccountStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { signedOutPublishing } from '../src/services/publishingClient';

const testServerUrl = 'http://127.0.0.1:8088';
const user = { id: 'application-account', username: 'alex_user', displayName: '应用用户' };
const configuredSignedOut = { url: testServerUrl, configured: false, user: null, legacy: null };
const settings = { url: testServerUrl, user, configured: true, legacy: null };

function prepare(t: any, api: any) {
  const restoreDom = installTestDom();
  const old = (window as any).protoflowDesktop, state = useAccountStore.getState();
  (window as any).protoflowDesktop = { publishing: publishingBridgeFixture(api) };
  useAccountStore.setState({ status: 'checking', serverUrl: '', user: null, busy: false, error: '' });
  return () => { (window as any).protoflowDesktop = old; useAccountStore.setState(state); restoreDom(); };
}

test('out-of-the-box unconfigured open-source mode opens local workspace directly without blocking', async t => {
  let mounts = 0;
  const cleanup = prepare(t, { accountSettings: async () => signedOutPublishing() });
  function Workspace() { mounts++; return React.createElement('div', { id: 'local-workspace' }, 'local-workspace'); }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AccountGate, { children: undefined }, React.createElement(Workspace))); });
  t.after(() => { act(() => renderer.unmount()); cleanup(); });
  assert.equal(useAccountStore.getState().status, 'local');
  assert.equal(mounts, 1);
  assert.equal(renderer.root.findAllByProps({ id: 'local-workspace' }).length, 1);
});

test('when a self-hosted server is configured, gate waits for verification and offers both login and local offline mode', async t => {
  let resolve!: (value: any) => void, mounts = 0;
  const cleanup = prepare(t, { accountSettings: () => new Promise(done => { resolve = done; }) });
  function Workspace() { mounts++; return React.createElement('div', { id: 'private-workspace' }, 'private-workspace'); }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AccountGate, { children: undefined }, React.createElement(Workspace))); });
  t.after(() => { act(() => renderer.unmount()); cleanup(); });
  assert.equal(mounts, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /正在检查本地工作区/);
  await act(async () => resolve(configuredSignedOut));
  assert.equal(mounts, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /登录 Alex 账号/);
  assert.match(JSON.stringify(renderer.toJSON()), /免登录本地使用/);
  act(() => {
    renderer.root.findAllByType('button').find(b => b.children.includes('免登录本地使用'))!.props.onClick();
  });
  assert.equal(useAccountStore.getState().status, 'local');
  assert.equal(mounts, 1);
});

test('registration opens the workspace, sign-out returns to gate when server is configured, and service failure allows retry or local mode', async t => {
  let failing = true;
  const cleanup = prepare(t, {
    accountSettings: async () => { if (failing) throw new Error('无法连接账号服务'); return settings; },
    authenticate: async () => settings,
    logout: async () => configuredSignedOut,
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AccountGate, { children: undefined }, React.createElement('div', { id: 'workspace-test' }, 'workspace'))); });
  t.after(() => { act(() => renderer.unmount()); cleanup(); });
  assert.equal(renderer.root.findAllByProps({ id: 'workspace-test' }).length, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /无法连接账号服务|重新连接/);
  await act(async () => useAccountStore.getState().login({ mode: 'register', url: testServerUrl, username: 'alex_user', password: 'test-password' }));
  assert.equal(useAccountStore.getState().status, 'authenticated');
  assert.equal(renderer.root.findAllByProps({ id: 'workspace-test' }).length, 1);
  // Transient network errors in an already verified session do not discard work.
  await act(async () => useAccountStore.getState().refresh());
  assert.equal(useAccountStore.getState().status, 'authenticated');
  await act(async () => useAccountStore.getState().logout());
  assert.equal(useAccountStore.getState().status, 'signedOut');
  assert.equal(renderer.root.findByProps({ id: 'workspace-test' }).parent!.props.hidden, true);
  failing = false;
  await act(async () => useAccountStore.getState().refresh());
  assert.equal(renderer.root.findByProps({ id: 'workspace-test' }).parent!.props.hidden, false);
});

test('a late startup check cannot replace a newly authenticated account and logout protects active AI work', async t => {
  let resolve!: (value: any) => void;
  const cleanup = prepare(t, { accountSettings: () => new Promise(done => { resolve = done; }), authenticate: async () => settings });
  t.after(cleanup);
  const pending = useAccountStore.getState().refresh();
  await useAccountStore.getState().login({ mode: 'login', url: testServerUrl, username: 'alex_user', password: 'test-password' });
  resolve(configuredSignedOut); await pending;
  assert.equal(useAccountStore.getState().user?.id, user.id);
  const running = useHermesStore.getState().runningProjects;
  useHermesStore.setState({ runningProjects: { 'test-project': true } });
  try { await assert.rejects(useAccountStore.getState().logout(), /AI 任务正在进行/); assert.equal(useAccountStore.getState().status, 'authenticated'); }
  finally { useHermesStore.setState({ runningProjects: running }); }
});
