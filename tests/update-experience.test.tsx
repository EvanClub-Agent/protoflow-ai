import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppUpdatePanel } from '../src/components/AppUpdateModal';
import { useUpdateStore } from '../src/store/useUpdateStore';
import type { DesktopUpdaterState } from '../src/services/releaseClient';
const { DesktopUpdater, signAssetManifest } = require('../electron/updater.cjs');
const { bundledUpdateChannel, validateBundledUpdateChannel } = require('../electron/update-channel.cjs');
const { installDeb } = require('../electron/linux-update-installer.cjs');
const { runCommand, describeHermesUpdateError } = require('../electron/hermes-runtime.cjs');

test('Hermes update failures retain stderr for classification without corrupting JSON stdout', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({ok:false})); process.stderr.write("git ls-remote timed out after 60 seconds"); process.exitCode=1;'], os.tmpdir());
  assert.deepEqual(JSON.parse(result.output), { ok: false });
  assert.equal(result.ok, false);
  assert.match(describeHermesUpdateError(result), /暂时无法连接下载服务/);
  assert.doesNotMatch(describeHermesUpdateError(result), /git|pflow:/);
});

test('bundled updates support unconfigured open-source defaults and lock managed channels with verified keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-update-defaults-'));
  const previousUrl = process.env.PROTOFLOW_UPDATE_URL, previousKey = process.env.PROTOFLOW_UPDATE_PUBLIC_KEY;
  try {
    const ossDefault = validateBundledUpdateChannel();
    assert.equal(ossDefault.serverUrl, bundledUpdateChannel.serverUrl);
    const managedOrigin = 'https://updates.example.com';
    const managedKey = crypto.randomBytes(32).toString('base64');
    const config = validateBundledUpdateChannel({ serverUrl: managedOrigin, channel: 'stable', trustedPublicKey: managedKey });
    const legacy = JSON.stringify({ serverUrl: 'http://192.168.1.8:8088', channel: 'beta', trustedPublicKey: 'old-key' });
    fs.writeFileSync(path.join(dir, 'updater.json'), legacy);
    process.env.PROTOFLOW_UPDATE_URL = 'http://192.168.1.9:8088';
    process.env.PROTOFLOW_UPDATE_PUBLIC_KEY = 'environment-key';
    const updater = new DesktopUpdater({ dataDir: dir, fixedUpdateConfig: config,
      getFallbackServerUrl: () => 'http://192.168.1.99:8088', fetchImpl: async (url: string) => {
        const target = new URL(url);
        assert.equal(target.origin, config.serverUrl);
        assert.equal(target.searchParams.get('channel'), 'stable');
        return { ok: true, json: async () => ({ hasUpdate: false, platformAssets: [] }) };
      } });
    assert.equal(updater.snapshot().serverUrl, config.serverUrl);
    assert.equal(updater.snapshot().signingPublicKey, config.trustedPublicKey);
    assert.equal(updater.snapshot().channel, 'stable');
    assert.equal(updater.resolveServerUrl('http://192.168.1.7:8088'), config.serverUrl);
    for (const override of [{ serverUrl: 'http://192.168.1.8:8088' }, { channel: 'beta' }, { trustedPublicKey: 'replacement' }]) {
      assert.throws(() => updater.configure(override), /内置管理/);
      await assert.rejects(updater.check(override), /内置管理/);
    }
    assert.equal((await updater.check()).status, 'up-to-date');
    assert.equal(fs.readFileSync(path.join(dir, 'updater.json'), 'utf8'), legacy);
    updater.fetch = async () => { throw new TypeError('fetch failed', { cause: { code: 'ENETUNREACH' } }); };
    const failed = await updater.check();
    assert.match(failed.error, /检查网络连接/);
    assert.doesNotMatch(failed.error, /192\.168|https?:|更新源|服务器地址|ENETUNREACH/);
    assert.throws(() => validateBundledUpdateChannel({ ...config, trustedPublicKey: '' }), /公钥/);
    assert.throws(() => validateBundledUpdateChannel({ serverUrl: '', channel: 'stable', trustedPublicKey: managedKey }), /默认更新服务地址/);
    assert.throws(() => validateBundledUpdateChannel({ ...config, serverUrl: 'not a URL' }));
    assert.throws(() => validateBundledUpdateChannel({ ...config, channel: 'unknown' }), /通道/);
  } finally {
    if (previousUrl === undefined) delete process.env.PROTOFLOW_UPDATE_URL; else process.env.PROTOFLOW_UPDATE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.PROTOFLOW_UPDATE_PUBLIC_KEY; else process.env.PROTOFLOW_UPDATE_PUBLIC_KEY = previousKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Debian updater verifies the download, waits for installation, rejects concurrent changes and only then restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-deb-update-'));
  const payload = Buffer.from('test-deb-content');
  const asset: any = { id: 'deb-120', os: 'linux', arch: 'x64', packageType: 'deb', fileName: 'ProtoFlow-AI-0.1.2.deb',
    sizeBytes: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex'), channel: 'stable', mandatory: false };
  Object.assign(asset, signAssetManifest('0.1.2', asset, crypto.randomBytes(32)));
  let finish!: () => void;
  let restartCount = 0, installCount = 0;
  const updater = new DesktopUpdater({ dataDir: dir, appVersion: '0.1.1', platform: 'linux', arch: 'x64',
    trustedPublicKey: asset.signingPublicKey, defaultServerUrl: 'http://localhost:8088',
    fetchImpl: async () => ({ ok: true, body: Readable.from([payload]) }),
    installDeb: async (file: string) => { installCount++; assert.deepEqual(fs.readFileSync(file), payload); await new Promise<void>(resolve => { finish = resolve; }); },
    restartApp: () => { restartCount++; },
  });
  updater.state.latestRelease = { id: 'release-120', version: '0.1.2', channel: 'stable', mandatory: false, assets: [asset] };
  updater.state.platformAssets = [asset]; updater.state.recommendedAsset = asset; updater.state.hasUpdate = true;
  try {
    assert.equal((await updater.download()).status, 'downloaded');
    await assert.rejects(updater.apply({ expectedAssetId: 'other' }), /更新内容已改变/);
    const installing = updater.apply({ expectedAssetId: asset.id, expectedConfigEpoch: updater.configEpoch });
    assert.equal(updater.snapshot().status, 'installing');
    assert.equal(restartCount, 0);
    assert.throws(() => updater.configure({ channel: 'beta' }), /正在安装/);
    await assert.rejects(updater.apply(), /正在安装/);
    finish();
    assert.equal((await installing).action, 'deb-installed');
    assert.equal(installCount, 1); assert.equal(restartCount, 1);
    assert.equal(updater.snapshot().installGuide.command, undefined);

    updater.installing = false; // simulate a fresh attempt with a cancelled system authorization
    updater.installDeb = async () => { throw new Error('已取消系统授权'); };
    await assert.rejects(updater.apply(), /已取消系统授权/);
    assert.equal(updater.snapshot().status, 'downloaded');
    assert.equal(updater.installing, false); assert.equal(restartCount, 1);
    fs.writeFileSync(updater.snapshot().downloadedFilePath, 'tampered');
    await assert.rejects(updater.apply(), /校验未通过/);
    assert.equal(restartCount, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Linux installer uses the graphical authorization agent, preserves spaces and handles cancel/failure', async () => {
  for (const code of [0, 126, 127, 100]) {
    const child: any = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const promise = installDeb('/tmp/updates with spaces/ProtoFlow.deb', { spawnProcess: (binary: string, args: string[], options: any) => {
      assert.equal(binary, '/usr/bin/pkexec');
      assert.deepEqual(args, ['--disable-internal-agent', '/usr/bin/apt-get', '--yes', 'install', '/tmp/updates with spaces/ProtoFlow.deb']);
      assert.equal(options.shell, undefined);
      setImmediate(() => { if (code === 100) child.stderr.write('Could not get lock'); child.emit('close', code); });
      return child;
    } });
    if (code === 0) await promise;
    else await assert.rejects(promise, code === 126 ? /已取消系统授权/ : code === 127 ? /未获得系统安装授权/ : /安装其他软件/);
  }
});

test('one click chooses the recommended asset, coalesces duplicate clicks and never installs a cancelled or switched download', async () => {
  const previousWindow = globalThis.window;
  const previousState = useUpdateStore.getState();
  const asset = { id: 'recommended' } as any;
  const available = { ...useUpdateStore.getInitialState(), hasUpdate: true, status: 'available', recommendedAsset: asset,
    platformAssets: [asset], latestRelease: { id: 'release', version: '0.1.2', assets: [asset] }, configEpoch: 3 } as DesktopUpdaterState;
  let applyCount = 0, checkCount = 0;
  let result = { ...available, status: 'downloaded', downloadedAssetId: asset.id } as DesktopUpdaterState;
  const api = {
    check: async () => { checkCount++; return available; },
    download: async ({ assetId }: { assetId: string }) => { assert.equal(assetId, asset.id); return result; },
    apply: async (input: any) => { assert.deepEqual(input, { expectedAssetId: asset.id, expectedConfigEpoch: 3 }); applyCount++; return { action: 'deb-installed' }; },
  };
  try {
    globalThis.window = { protoflowDesktop: { updater: api } } as any;
    useUpdateStore.setState({ ...useUpdateStore.getInitialState(), ...available, selectedAssetId: 'unrelated' });
    await Promise.all([useUpdateStore.getState().installLatestUpdate(), useUpdateStore.getState().installLatestUpdate()]);
    assert.equal(checkCount, 1); assert.equal(applyCount, 1); assert.equal(useUpdateStore.getState().isUpdating, false);
    result = { ...available, status: 'available' };
    await useUpdateStore.getState().installLatestUpdate(); assert.equal(applyCount, 1);
    result = { ...result, status: 'downloaded', configEpoch: 4, downloadedAssetId: asset.id };
    await useUpdateStore.getState().installLatestUpdate(); assert.equal(applyCount, 1);
    assert.match(useUpdateStore.getState().error!, /更新内容已改变/);
    result = { ...available, status: 'downloaded', downloadedAssetId: asset.id };
    api.apply = async () => { throw new Error("Error invoking remote method 'pflow:updater-apply': Error: 已取消系统授权"); };
    await useUpdateStore.getState().installLatestUpdate();
    assert.equal(useUpdateStore.getState().error, '已取消系统授权');
  } finally { globalThis.window = previousWindow; useUpdateStore.setState(previousState, true); }
});

test('update screen has no configuration fields and exposes one update action', () => {
  const previousState = useUpdateStore.getState(), previousWindow = globalThis.window;
  let view!: TestRenderer.ReactTestRenderer;
  try {
    globalThis.window = { protoflowDesktop: { updater: {} } } as any;
    useUpdateStore.setState({ ...useUpdateStore.getInitialState(), serverUrl: bundledUpdateChannel.serverUrl,
      hasUpdate: true, status: 'available', latestRelease: { version: '0.1.2', notes: '修复更新', assets: [] } as any,
      recommendedAsset: { id: 'deb', sizeBytes: 1024 } as any });
    act(() => { view = TestRenderer.create(<AppUpdatePanel />); });
    for (const tag of ['details', 'form', 'input', 'select']) assert.equal(view.root.findAllByType(tag).length, 0);
    assert.equal(view.root.findAllByType('button').filter(button => button.children.includes('立即更新')).length, 1);
    const text = JSON.stringify(view.toJSON());
    assert.doesNotMatch(text, /127\.0\.0\.1|192\.168|Go 服务|sudo apt|SHA-256|签名公钥|高级设置|更新服务地址|更新通道|保存设置/);
  } finally { if (view) act(() => view.unmount()); globalThis.window = previousWindow; useUpdateStore.setState(previousState, true); }
});
