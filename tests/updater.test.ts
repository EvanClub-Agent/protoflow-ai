import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import {
  assertAllowedAdminOrigin,
  fetchAdminStatus,
  loginPlatformAdmin,
  fetchManagedReleases,
  fetchPlatformAdminMe,
  logoutPlatformAdmin,
  createManagedRelease,
  updateManagedRelease,
  deleteManagedRelease,
  addReleaseAssetLink,
  approveReleaseAsset,
  deleteReleaseAsset,
  uploadReleaseAsset,
  formatBytes,
  inferAssetTargetFromFileName,
  isSecureOrLoopbackAdminOrigin,
} from '../src/services/releaseClient';
import { isReleaseAdminRoute, isReleaseCenterRoute } from '../src/viewer/PublishedViewer';
import { useUpdateStore } from '../src/store/useUpdateStore';
import { useProtoStore } from '../src/store/useProtoStore';
import { createProjectPayload, loadProjectFromBinaryPayload, startProjectPersistence } from '../src/services/projectStorage';

const {
  DesktopUpdater,
  compareSemver,
  signAssetManifest,
  verifyAssetManifestSignature,
} = require('../electron/updater.cjs');

const TEST_SIGNING_SEED = crypto.randomBytes(32);

function attachSignature(version: string, asset: Record<string, any>, seed: Buffer = TEST_SIGNING_SEED) {
  const channel = asset.channel === 'beta' ? 'beta' : 'stable';
  const mandatory = Boolean(asset.mandatory);
  const { signature, signingPublicKey } = signAssetManifest(
    version,
    {
      ...asset,
      channel,
      mandatory,
    },
    seed
  );
  return {
    ...asset,
    channel,
    mandatory,
    signature,
    signingPublicKey,
  };
}

const TEST_SIGNING_PUBLIC_KEY: string = signAssetManifest(
  '0.1.0',
  {
    os: 'macos',
    arch: 'arm64',
    packageType: 'dmg',
    fileName: 'probe.dmg',
    sizeBytes: 1,
    sha256: 'a'.repeat(64),
  },
  TEST_SIGNING_SEED
).signingPublicKey;

test('inferAssetTargetFromFileName, isReleaseCenterRoute, and isReleaseAdminRoute recognize artifacts and routes', () => {
  assert.deepEqual(inferAssetTargetFromFileName('ProtoFlow-AI-0.2.0-win-x64.exe'), {
    os: 'windows',
    arch: 'x64',
    packageType: 'exe',
  });
  assert.deepEqual(inferAssetTargetFromFileName('ProtoFlow-AI-0.2.0-mac-arm64.dmg'), {
    os: 'macos',
    arch: 'arm64',
    packageType: 'dmg',
  });
  assert.deepEqual(inferAssetTargetFromFileName('ProtoFlow-AI-0.2.0-linux-amd64.deb'), {
    os: 'linux',
    arch: 'x64',
    packageType: 'deb',
  });
  assert.deepEqual(inferAssetTargetFromFileName('ProtoFlow-AI-0.2.0-linux-x86_64.AppImage'), {
    os: 'linux',
    arch: 'x64',
    packageType: 'AppImage',
  });
  assert.deepEqual(inferAssetTargetFromFileName('ProtoFlow-AI-0.2.0-linux-x64.tar.gz'), {
    os: 'linux',
    arch: 'x64',
    packageType: 'tar.gz',
  });
  assert.equal(formatBytes(1024 * 1024 * 5), '5.00 MB');
  assert.equal(isReleaseCenterRoute('/releases', ''), true);
  assert.equal(isReleaseCenterRoute('/releases/admin', ''), true);
  assert.equal(isReleaseCenterRoute('/updates/', ''), true);
  assert.equal(isReleaseCenterRoute('/', '?route=releases'), true);
  assert.equal(isReleaseCenterRoute('/p/2NZZMWYV6M3I4AIIAT5OLQNILC', ''), false);

  assert.equal(isReleaseAdminRoute('/releases', ''), false);
  assert.equal(isReleaseAdminRoute('/releases/admin', ''), true);
  assert.equal(isReleaseAdminRoute('/updates/admin/', ''), true);
  assert.equal(isReleaseAdminRoute('/', '?route=releases-admin'), true);
});

test('DesktopUpdater explains network failures without masking HTTP errors and recovers after retry', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-updater-network-'));
  const socketError = (code: string) => Object.assign(new Error('socket failed'), { code });
  const fetchError = (cause: Error) => new TypeError('fetch failed', { cause });
  try {
    let failure: Error | null = fetchError(new AggregateError([socketError('EHOSTUNREACH')]));
    let httpFailure = false;
    const updater = new DesktopUpdater({
      dataDir: tmpDir,
      platform: 'darwin',
      getFallbackServerUrl: () => 'http://192.168.1.104:8088',
      fetchImpl: async () => {
        if (failure) throw failure;
        return {
          ok: !httpFailure,
          status: httpFailure ? 503 : 200,
          json: async () => httpFailure ? { error: '版本服务暂时不可用' } : { hasUpdate: false },
        };
      },
    });
    const unreachable = await updater.check();
    assert.equal(unreachable.status, 'error');
    assert.equal(unreachable.hasUpdate, false);
    assert.match(unreachable.error, /192\.168\.1\.104:8088/);
    assert.match(unreachable.error, /EHOSTUNREACH/);
    assert.match(unreachable.error, /隐私与安全 → 本地网络/);
    assert.match(unreachable.error, /安装包签名/);
    for (const [error, expected] of [
      [fetchError(socketError('ECONNREFUSED')), /服务器拒绝连接/],
      [fetchError(socketError('ENOTFOUND')), /无法解析服务器域名/],
      [fetchError(socketError('ETIMEDOUT')), /连接超时/],
      [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), /连接更新服务器 .* 超时/],
    ] as const) {
      failure = error;
      assert.match((await updater.check()).error, expected);
    }
    failure = null;
    httpFailure = true;
    assert.equal((await updater.check()).error, '版本服务暂时不可用');
    httpFailure = false;
    const recovered = await updater.check();
    assert.equal(recovered.status, 'up-to-date');
    assert.equal(recovered.error, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DesktopUpdater checks, downloads, verifies Ed25519 signature + SHA-256 and applies updates across Windows, macOS, and Linux', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-updater-test-'));
  try {
    const winPayload = Buffer.from('fake-windows-nsis-installer-binary-v0.2.0');
    const winSha256 = crypto.createHash('sha256').update(winPayload).digest('hex');

    const macPayload = Buffer.from('fake-macos-dmg-installer-binary-v0.2.0');
    const macSha256 = crypto.createHash('sha256').update(macPayload).digest('hex');

    const debPayload = Buffer.from('fake-linux-deb-installer-binary-v0.2.0');
    const debSha256 = crypto.createHash('sha256').update(debPayload).digest('hex');

    const appImagePayload = Buffer.from('#!/bin/sh\necho "ProtoFlow AI v0.2.0"\n');
    const appImageSha256 = crypto.createHash('sha256').update(appImagePayload).digest('hex');

    const assets = [
      attachSignature('0.2.0', {
        id: 'asset-win',
        releaseId: 'rel-020',
        channel: 'stable',
        mandatory: true,
        os: 'windows',
        arch: 'x64',
        packageType: 'exe',
        fileName: 'ProtoFlow-AI-0.2.0-win-x64.exe',
        sizeBytes: winPayload.length,
        sha256: winSha256,
        hosted: true,
        downloadUrl: 'http://localhost:8088/api/v1/updates/assets/asset-win/download',
      }),
      attachSignature('0.2.0', {
        id: 'asset-mac',
        releaseId: 'rel-020',
        channel: 'stable',
        mandatory: true,
        os: 'macos',
        arch: 'arm64',
        packageType: 'dmg',
        fileName: 'ProtoFlow-AI-0.2.0-mac-arm64.dmg',
        sizeBytes: macPayload.length,
        sha256: macSha256,
        hosted: true,
        downloadUrl: 'http://localhost:8088/api/v1/updates/assets/asset-mac/download',
      }),
      attachSignature('0.2.0', {
        id: 'asset-deb',
        releaseId: 'rel-020',
        channel: 'stable',
        mandatory: true,
        os: 'linux',
        arch: 'x64',
        packageType: 'deb',
        fileName: 'ProtoFlow-AI-0.2.0-linux-amd64.deb',
        sizeBytes: debPayload.length,
        sha256: debSha256,
        hosted: true,
        downloadUrl: 'http://localhost:8088/api/v1/updates/assets/asset-deb/download',
      }),
      attachSignature('0.2.0', {
        id: 'asset-appimage',
        releaseId: 'rel-020',
        channel: 'stable',
        mandatory: true,
        os: 'linux',
        arch: 'x64',
        packageType: 'AppImage',
        fileName: 'ProtoFlow-AI-0.2.0-linux-x86_64.AppImage',
        sizeBytes: appImagePayload.length,
        sha256: appImageSha256,
        hosted: true,
        downloadUrl: 'http://localhost:8088/api/v1/updates/assets/asset-appimage/download',
      }),
    ];

    const releaseFixture = {
      id: 'rel-020',
      version: '0.2.0',
      title: 'ProtoFlow AI 0.2.0',
      notes: 'Three-platform update support',
      channel: 'stable',
      mandatory: true,
      published: true,
      publishedAt: '2026-11-04T08:00:00Z',
      createdAt: '2026-11-04T08:00:00Z',
      updatedAt: '2026-11-04T08:00:00Z',
      assets,
    };

    const mockFetch = async (urlStr: string) => {
      const u = new URL(urlStr);
      if (u.pathname === '/api/v1/updates/check') {
        const osParam = u.searchParams.get('os');
        const prefer = u.searchParams.get('preferPackage');
        const platformAssets = releaseFixture.assets.filter((a) => a.os === osParam);
        const recommendedAsset =
          platformAssets.find((a) => a.packageType === prefer) ?? platformAssets[0] ?? null;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            signingPublicKey: assets[0].signingPublicKey,
            currentVersion: '0.1.0',
            hasUpdate: true,
            latestRelease: releaseFixture,
            recommendedAsset,
            platformAssets,
          }),
        };
      }
      const payloads: Record<string, Buffer> = {
        '/api/v1/updates/assets/asset-win/download': winPayload,
        '/api/v1/updates/assets/asset-mac/download': macPayload,
        '/api/v1/updates/assets/asset-deb/download': debPayload,
        '/api/v1/updates/assets/asset-appimage/download': appImagePayload,
      };
      const buf = payloads[u.pathname];
      if (buf) {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-length', String(buf.length)]]),
          body: Readable.from([buf]),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    };

    // 1. Windows exe check, download & apply
    let launchedExe = '';
    const winUpdater = new DesktopUpdater({
      dataDir: path.join(tmpDir, 'win'),
      appVersion: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: mockFetch,
      launchDetached: (exe: string) => {
        launchedExe = exe;
      },
    });
    const winChecked = await winUpdater.check();
    assert.equal(winChecked.hasUpdate, true);
    assert.equal(winChecked.recommendedAsset.packageType, 'exe');
    const winDownloaded = await winUpdater.download();
    assert.equal(winDownloaded.status, 'downloaded');
    assert.equal(winDownloaded.verifiedSha256, winSha256);
    const winGuide = await winUpdater.apply();
    assert.equal(winGuide.action, 'installer-launched');
    assert.equal(launchedExe, winDownloaded.downloadedFilePath);

    // 2. macOS dmg check, download & apply
    let openedDmg = '';
    const macUpdater = new DesktopUpdater({
      dataDir: path.join(tmpDir, 'mac'),
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: mockFetch,
      openPath: async (target: string) => {
        openedDmg = target;
        return '';
      },
    });
    await macUpdater.check();
    const macDownloaded = await macUpdater.download();
    assert.equal(macDownloaded.status, 'downloaded');
    assert.equal(macDownloaded.verifiedSha256, macSha256);
    const macGuide = await macUpdater.apply();
    assert.equal(macGuide.action, 'dmg-mounted');
    assert.equal(openedDmg, macDownloaded.downloadedFilePath);
    assert.equal(macGuide.command, undefined);

    // 3. Linux AppImage in-place replacement
    const oldAppImage = process.env.APPIMAGE;
    const fakeInstalledAppImage = path.join(tmpDir, 'ProtoFlow-AI.AppImage');
    fs.writeFileSync(fakeInstalledAppImage, 'old-appimage');
    process.env.APPIMAGE = fakeInstalledAppImage;
    try {
      let relaunchedAppImage = '';
      const linuxUpdater = new DesktopUpdater({
        dataDir: path.join(tmpDir, 'linux'),
        appVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
        getFallbackServerUrl: () => 'http://localhost:8088',
        fetchImpl: mockFetch,
        launchDetached: (exe: string) => {
          relaunchedAppImage = exe;
        },
      });
      const linuxChecked = await linuxUpdater.check();
      assert.equal(linuxChecked.recommendedAsset.packageType, 'AppImage');
      await linuxUpdater.download();
      const linuxGuide = await linuxUpdater.apply();
      assert.equal(linuxGuide.action, 'appimage-replaced');
      assert.equal(relaunchedAppImage, fakeInstalledAppImage);
      assert.deepEqual(fs.readFileSync(fakeInstalledAppImage), appImagePayload);
    } finally {
      if (oldAppImage === undefined) delete process.env.APPIMAGE;
      else process.env.APPIMAGE = oldAppImage;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DesktopUpdater security & reliability regressions: path traversal, missing digest/size mismatch, incompatible arch, write error, cancel-retry race, and save-before-apply guard', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-updater-sec-'));
  try {
    // 1. [P1] Reject path traversal in release.version (e.g. "../escaped")
    const traversalUpdater = new DesktopUpdater({
      dataDir: path.join(tmpDir, 'traversal'),
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          hasUpdate: true,
          latestRelease: {
            id: 'bad-rel',
            version: '../escaped',
            assets: [],
          },
          recommendedAsset: null,
          platformAssets: [],
        }),
      }),
    });
    const traversalCheck = await traversalUpdater.check();
    assert.equal(traversalCheck.status, 'error');
    assert.match(traversalCheck.error, /版本号格式/);

    // Even if state is mutated directly with "../", download refuses to write outside updatesDir
    traversalUpdater.state.latestRelease = {
      id: 'bad-rel',
      version: '../../escaped',
      assets: [
        {
          id: 'bad-asset',
          os: 'macos',
          arch: 'arm64',
          packageType: 'dmg',
          fileName: 'ProtoFlow.dmg',
          sizeBytes: 3,
          sha256: 'a'.repeat(64),
          downloadUrl: 'http://localhost:8088/bad.dmg',
        },
      ],
    };
    const traversalDl = await traversalUpdater.download({ assetId: 'bad-asset' });
    assert.equal(traversalDl.status, 'error');
    assert.equal(fs.existsSync(path.join(tmpDir, 'ProtoFlow.dmg')), false);

    // 2. [P1] Reject missing SHA-256 or mismatched byte length or invalid signature
    const shortPayload = Buffer.from('abc');
    const shortSha = crypto.createHash('sha256').update(shortPayload).digest('hex');
    const signedDeclared100 = attachSignature('0.2.0', {
      id: 'mismatch-asset',
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-0.2.0.dmg',
      sizeBytes: 100, // declares 100 bytes, server returns 3 bytes!
      sha256: shortSha,
      downloadUrl: 'http://localhost:8088/mismatch.dmg',
    });

    const digestUpdater = new DesktopUpdater({
      dataDir: path.join(tmpDir, 'digest'),
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async (urlStr: string) => {
        if (urlStr.includes('/updates/check')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              signingPublicKey: signedDeclared100.signingPublicKey,
              hasUpdate: true,
              latestRelease: { id: 'r1', version: '0.2.0', assets: [signedDeclared100] },
              recommendedAsset: signedDeclared100,
              platformAssets: [signedDeclared100],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-length', '3']]),
          body: Readable.from([shortPayload]),
        };
      },
    });
    await digestUpdater.check();
    const mismatchRes = await digestUpdater.download();
    assert.equal(mismatchRes.status, 'error');
    assert.equal(mismatchRes.verifiedSha256, null);
    assert.match(mismatchRes.error, /字节长度/);

    // Also test missing sha256
    digestUpdater.state.recommendedAsset = {
      ...signedDeclared100,
      sizeBytes: 3,
      sha256: '',
    };
    const missingShaRes = await digestUpdater.download();
    assert.equal(missingShaRes.status, 'error');
    assert.equal(missingShaRes.verifiedSha256, null);
    assert.match(missingShaRes.error, /SHA-256/);

    // Also test tampered manifest signature
    const tamperedAsset = {
      ...signedDeclared100,
      sizeBytes: 3,
    };
    assert.equal(verifyAssetManifestSignature('0.2.0', tamperedAsset, signedDeclared100.signingPublicKey), false);
    digestUpdater.state.recommendedAsset = tamperedAsset;
    const tamperedRes = await digestUpdater.download();
    assert.equal(tamperedRes.status, 'error');
    assert.match(tamperedRes.error, /签名/);

    // 3. [P1] Incompatible architecture (Linux x64 client receiving arm64-only AppImage)
    const arm64OnlyAsset = attachSignature('0.2.0', {
      id: 'arm64-appimage',
      os: 'linux',
      arch: 'arm64',
      packageType: 'AppImage',
      fileName: 'ProtoFlow-0.2.0-arm64.AppImage',
      sizeBytes: shortPayload.length,
      sha256: shortSha,
      downloadUrl: 'http://localhost:8088/arm64.AppImage',
    });
    const archUpdater = new DesktopUpdater({
      dataDir: path.join(tmpDir, 'arch'),
      appVersion: '0.1.0',
      platform: 'linux',
      arch: 'x64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          signingPublicKey: arm64OnlyAsset.signingPublicKey,
          hasUpdate: true,
          latestRelease: { id: 'r-arm', version: '0.2.0', mandatory: true, assets: [arm64OnlyAsset] },
          recommendedAsset: null,
          platformAssets: [arm64OnlyAsset], // even if a buggy server sent arm64 in platformAssets
        }),
      }),
    });
    const archChecked = await archUpdater.check();
    assert.equal(archChecked.recommendedAsset, null);
    assert.equal(archChecked.platformAssets.length, 0);
    assert.equal(archChecked.hasUpdate, false);
    assert.equal(archChecked.latestRelease, null);
    assert.equal(archChecked.status, 'up-to-date');
    // Even a stale IPC request cannot install a package for a different architecture.
    archUpdater.state.latestRelease = { version: '0.2.0', assets: [arm64OnlyAsset] };
    const archDl = await archUpdater.download({ assetId: 'arm64-appimage' });
    assert.equal(archDl.status, 'error');
    assert.match(archDl.error, /不兼容/);

    // 4. [P2] Propagate disk write error without unhandled error event crash
    const validPayload = Buffer.from('valid-binary-installer-content');
    const validSha = crypto.createHash('sha256').update(validPayload).digest('hex');
    const validAsset = attachSignature('0.2.0', {
      id: 'valid-mac',
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-0.2.0.dmg',
      sizeBytes: validPayload.length,
      sha256: validSha,
      downloadUrl: 'http://localhost:8088/valid.dmg',
    });

    const writeErrDir = path.join(tmpDir, 'write-err');
    const writeErrUpdater = new DesktopUpdater({
      dataDir: writeErrDir,
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async (urlStr: string) => {
        if (urlStr.includes('/updates/check')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              signingPublicKey: validAsset.signingPublicKey,
              hasUpdate: true,
              latestRelease: { id: 'r-ok', version: '0.2.0', assets: [validAsset] },
              recommendedAsset: validAsset,
              platformAssets: [validAsset],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-length', String(validPayload.length)]]),
          body: Readable.from([validPayload]),
        };
      },
    });
    await writeErrUpdater.check();
    // Make versionDir read-only so opening the temporary .part file fails with EACCES
    const roVersionDir = path.join(writeErrDir, 'updates', '0.2.0');
    fs.mkdirSync(roVersionDir, { recursive: true });
    fs.chmodSync(roVersionDir, 0o500);
    try {
      const writeErrState = await writeErrUpdater.download();
      assert.equal(writeErrState.status, 'error');
      assert.ok(writeErrState.error);
    } finally {
      fs.chmodSync(roVersionDir, 0o755);
    }

    // 5. [P2] Cancel download and immediately retry the same asset without .part collision
    let callCount = 0;
    const retryUpdater = new DesktopUpdater({
      dataDir: path.join(tmpDir, 'retry'),
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async (urlStr: string) => {
        if (urlStr.includes('/updates/check')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              signingPublicKey: validAsset.signingPublicKey,
              hasUpdate: true,
              latestRelease: { id: 'r-ok', version: '0.2.0', assets: [validAsset] },
              recommendedAsset: validAsset,
              platformAssets: [validAsset],
            }),
          };
        }
        callCount++;
        const currentCall = callCount;
        async function* slowThenFastStream() {
          if (currentCall === 1) {
            yield validPayload.subarray(0, 5);
            await new Promise((r) => setTimeout(r, 60));
            yield validPayload.subarray(5);
          } else {
            yield validPayload;
          }
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-length', String(validPayload.length)]]),
          body: Readable.from(slowThenFastStream()),
        };
      },
    });
    await retryUpdater.check();
    const firstDownloadPromise = retryUpdater.download();
    await new Promise((r) => setTimeout(r, 15));
    retryUpdater.cancelDownload();
    const secondDownloadPromise = retryUpdater.download();
    const [, secondResult] = await Promise.all([firstDownloadPromise, secondDownloadPromise]);
    assert.equal(secondResult.status, 'downloaded');
    assert.equal(secondResult.verifiedSha256, validSha);
    assert.equal(fs.existsSync(secondResult.downloadedFilePath), true);

    // 6. [P2] Stop launching installer if saving project (flushProjectChanges) fails
    let applyCalled = false;
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      protoflowDesktop: {
        isElectron: true,
        saveCurrentProject: async () => {
          throw new Error('磁盘空间不足，无法写入 .pflow 工程文件');
        },
        updater: {
          apply: async () => {
            applyCalled = true;
            return {
              action: 'installer-launched',
              platform: 'macos',
              packageType: 'dmg',
              filePath: '/tmp/a.dmg',
              title: 'ok',
              steps: [],
            };
          },
        },
      },
    };
    const stopPersistence = startProjectPersistence(60000);
    try {
      const payload = createProjectPayload({
        projectId: 'proj-save-fail',
        projectName: '测试工程',
        templateId: 'blank_project',
        storageDir: '/nonexistent/dir',
        fileName: 'test.pflow',
        createdAt: '2026-11-04T00:00:00Z',
        updatedAt: '2026-11-04T00:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      });
      loadProjectFromBinaryPayload(payload);
      // Trigger a tracked state change so ProjectAutosave marks dirty = true
      useProtoStore.setState({ projectPlan: 'dirty-change' });
      useUpdateStore.setState({ error: null, installGuide: null });
      await useUpdateStore.getState().applyUpdate();
      assert.equal(applyCalled, false);
      assert.match(String(useUpdateStore.getState().error), /保存当前工程失败/);
      const checked = { ...useUpdateStore.getInitialState(), status: 'available', hasUpdate: true,
        recommendedAsset: { id: 'save-guard' }, platformAssets: [{ id: 'save-guard' }], configEpoch: 7 };
      (globalThis as any).window.protoflowDesktop.updater.check = async () => checked;
      (globalThis as any).window.protoflowDesktop.updater.download = async () => ({ ...checked, status: 'downloaded', downloadedAssetId: 'save-guard' });
      useUpdateStore.setState({ isUpdating: false, status: 'available', error: null });
      useProtoStore.setState({ projectPlan: 'dirty-change-one-click' });
      await useUpdateStore.getState().installLatestUpdate();
      assert.equal(applyCalled, false);
      assert.match(String(useUpdateStore.getState().error), /保存当前工程失败/);
    } finally {
      stopPersistence();
      (globalThis as any).window = prevWindow;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('an unsigned mandatory release with no compatible asset cannot trigger a desktop update', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-unsigned-notice-'));
  try {
    const updater = new DesktopUpdater({
      dataDir,
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async () => Response.json({
        hasUpdate: true,
        latestRelease: { version: '99.0.0', channel: 'stable', mandatory: true, assets: [] },
        recommendedAsset: null,
        platformAssets: [],
      }),
    });
    const state = await updater.check({ silent: true });
    assert.equal(state.hasUpdate, false);
    assert.equal(state.latestRelease, null);
    assert.equal(state.status, 'up-to-date');
    await assert.rejects(() => updater.download(), /请先检查新版本/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('DesktopUpdater trusted key chain, anti-downgrade replay protection, source switch cleanup, and admin transport guard', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-updater-trust-'));
  try {
    assert.equal(compareSemver('1.0.0', '0.9.0'), 1);
    assert.equal(compareSemver('0.9.0', '1.0.0'), -1);
    assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
    assert.equal(compareSemver('1.0.0', '1.0.0-beta.1'), 1);

    // 1. [P1] Brand-new client WITHOUT pre-configured trustedPublicKey must NOT trust or pin public key from HTTP response
    const attackerSeed = crypto.randomBytes(32);
    const payload = Buffer.from('fake-installer-binary-content');
    const payloadSha = crypto.createHash('sha256').update(payload).digest('hex');
    const selfSignedAsset = attachSignature(
      '1.2.0',
      {
        id: 'attacker-asset',
        os: 'macos',
        arch: 'arm64',
        packageType: 'dmg',
        fileName: 'ProtoFlow-1.2.0.dmg',
        sizeBytes: payload.length,
        sha256: payloadSha,
        downloadUrl: 'http://192.168.1.50:8088/ProtoFlow-1.2.0.dmg',
      },
      attackerSeed
    );

    let installerLaunched = false;
    const tofuDir = path.join(tmpDir, 'no-tofu');
    // Pre-seed legacy pinnedPublicKeys in updater.json to verify it is ignored
    fs.mkdirSync(tofuDir, { recursive: true });
    fs.writeFileSync(
      path.join(tofuDir, 'updater.json'),
      JSON.stringify({
        pinnedPublicKeys: {
          'http://192.168.1.50:8088': selfSignedAsset.signingPublicKey,
        },
      })
    );

    const untrustedClient = new DesktopUpdater({
      dataDir: tofuDir,
      appVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: '', // no pre-configured key
      getFallbackServerUrl: () => 'http://192.168.1.50:8088',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          signingPublicKey: selfSignedAsset.signingPublicKey,
          hasUpdate: true,
          latestRelease: { id: 'rel-120', version: '1.2.0', assets: [selfSignedAsset] },
          recommendedAsset: selfSignedAsset,
          platformAssets: [selfSignedAsset],
        }),
      }),
      openPath: async () => {
        installerLaunched = true;
        return '';
      },
    });

    const untrustedCheck = await untrustedClient.check();
    assert.equal(untrustedCheck.status, 'error');
    assert.match(untrustedCheck.error, /未配置可信更新签名公钥/);
    assert.equal(untrustedCheck.signingPublicKey, '');

    // Direct download attempt must also fail and never enter install callback
    untrustedClient.state.latestRelease = { id: 'rel-120', version: '1.2.0', assets: [selfSignedAsset] };
    untrustedClient.state.recommendedAsset = selfSignedAsset;
    untrustedClient.state.platformAssets = [selfSignedAsset];
    const untrustedDl = await untrustedClient.download();
    assert.equal(untrustedDl.status, 'error');
    assert.match(untrustedDl.error, /未配置可信更新签名公钥/);
    assert.equal(installerLaunched, false);

    // 2. [P1] Client pre-configured with TEST_SIGNING_PUBLIC_KEY rejects manifest signed by attackerSeed
    const pinnedClient = new DesktopUpdater({
      dataDir: path.join(tmpDir, 'wrong-key'),
      appVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          signingPublicKey: selfSignedAsset.signingPublicKey,
          hasUpdate: true,
          latestRelease: { id: 'rel-120', version: '1.2.0', assets: [selfSignedAsset] },
          recommendedAsset: selfSignedAsset,
          platformAssets: [selfSignedAsset],
        }),
      }),
    });
    const wrongKeyCheck = await pinnedClient.check();
    assert.equal(wrongKeyCheck.status, 'error');
    assert.match(wrongKeyCheck.error, /不一致|签名/);

    // 3. [P1] Anti-downgrade & same-version replay protection:
    // Client is on 1.0.0 with valid TEST_SIGNING_PUBLIC_KEY, server replays validly signed 0.9.0 with hasUpdate: true
    const oldSignedAsset = attachSignature('0.9.0', {
      id: 'asset-090',
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-0.9.0.dmg',
      sizeBytes: payload.length,
      sha256: payloadSha,
      downloadUrl: 'http://localhost:8088/ProtoFlow-0.9.0.dmg',
    });

    const downgradeDir = path.join(tmpDir, 'downgrade');
    const downgradeClient = new DesktopUpdater({
      dataDir: downgradeDir,
      appVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async (urlStr: string) => {
        if (urlStr.includes('/updates/check')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              signingPublicKey: TEST_SIGNING_PUBLIC_KEY,
              hasUpdate: true, // maliciously claims hasUpdate=true for 0.9.0!
              latestRelease: { id: 'rel-090', version: '0.9.0', assets: [oldSignedAsset] },
              recommendedAsset: oldSignedAsset,
              platformAssets: [oldSignedAsset],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          body: Readable.from([payload]),
        };
      },
      openPath: async () => {
        installerLaunched = true;
        return '';
      },
    });

    const downgradeCheck = await downgradeClient.check();
    assert.equal(downgradeCheck.hasUpdate, false);
    assert.equal(downgradeCheck.status, 'up-to-date');
    assert.equal(downgradeCheck.recommendedAsset, null);
    assert.equal(downgradeCheck.platformAssets.length, 0);

    // Even if state is forced to 0.9.0 and download() or apply() is called directly, it must be rejected
    downgradeClient.state.latestRelease = { id: 'rel-090', version: '0.9.0', assets: [oldSignedAsset] };
    downgradeClient.state.recommendedAsset = oldSignedAsset;
    downgradeClient.state.platformAssets = [oldSignedAsset];
    const downgradeDl = await downgradeClient.download();
    assert.equal(downgradeDl.status, 'error');
    assert.match(downgradeDl.error, /不高于当前客户端版本/);

    const cached090Dir = path.join(downgradeDir, 'updates', '0.9.0');
    fs.mkdirSync(cached090Dir, { recursive: true });
    const cached090File = path.join(cached090Dir, 'ProtoFlow-0.9.0.dmg');
    fs.writeFileSync(cached090File, payload);
    downgradeClient.state.downloadedAssetId = oldSignedAsset.id;
    downgradeClient.state.downloadedFilePath = cached090File;
    await assert.rejects(() => downgradeClient.apply(), /校验未通过/);
    assert.equal(installerLaunched, false);

    // Same-version (1.0.0) replay must also be rejected
    const sameSignedAsset = attachSignature('1.0.0', {
      id: 'asset-100',
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-1.0.0.dmg',
      sizeBytes: payload.length,
      sha256: payloadSha,
      downloadUrl: 'http://localhost:8088/ProtoFlow-1.0.0.dmg',
    });
    downgradeClient.state.latestRelease = { id: 'rel-100', version: '1.0.0', assets: [sameSignedAsset] };
    downgradeClient.state.recommendedAsset = sameSignedAsset;
    downgradeClient.state.platformAssets = [sameSignedAsset];
    const sameDl = await downgradeClient.download();
    assert.equal(sameDl.status, 'error');
    assert.match(sameDl.error, /不高于当前客户端版本/);

    // 4. Switching serverUrl or channel via configure() clears stale update & download state
    const valid110Asset = attachSignature('1.1.0', {
      id: 'asset-110',
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-1.1.0.dmg',
      sizeBytes: payload.length,
      sha256: payloadSha,
      downloadUrl: 'http://localhost:8088/ProtoFlow-1.1.0.dmg',
    });
    downgradeClient.state.status = 'downloaded';
    downgradeClient.state.hasUpdate = true;
    downgradeClient.state.latestRelease = { id: 'rel-110', version: '1.1.0', assets: [valid110Asset] };
    downgradeClient.state.recommendedAsset = valid110Asset;
    downgradeClient.state.platformAssets = [valid110Asset];
    downgradeClient.state.downloadedAssetId = 'asset-110';
    downgradeClient.state.downloadedFilePath = '/tmp/ProtoFlow-1.1.0.dmg';
    downgradeClient.state.verifiedSha256 = payloadSha;

    const resetAfterConfigure = downgradeClient.configure({ channel: 'beta' });
    assert.equal(resetAfterConfigure.status, 'idle');
    assert.equal(resetAfterConfigure.hasUpdate, false);
    assert.equal(resetAfterConfigure.latestRelease, null);
    assert.equal(resetAfterConfigure.recommendedAsset, null);
    assert.equal(resetAfterConfigure.platformAssets.length, 0);
    assert.equal(resetAfterConfigure.downloadedAssetId, null);
    assert.equal(resetAfterConfigure.downloadedFilePath, null);
    assert.equal(resetAfterConfigure.verifiedSha256, null);

    // 5. LAN HTTP requires a server policy check; HTTPS and loopback remain directly eligible.
    assert.equal(isSecureOrLoopbackAdminOrigin('http://192.168.1.104:8088'), false);
    assert.equal(isSecureOrLoopbackAdminOrigin('http://10.0.0.15:8088'), false);
    assert.equal(isSecureOrLoopbackAdminOrigin('http://127.0.0.1:8088'), true);
    assert.equal(isSecureOrLoopbackAdminOrigin('http://localhost:8088'), true);
    assert.equal(isSecureOrLoopbackAdminOrigin('https://releases.protoflow.example.com'), true);

    // 6. [P1] Channel & Mandatory signature binding (protoflow-release-v2) + v1 signature rejection:
    // A validly signed Beta asset relabeled as channel='stable' or mandatory=true in the HTTP response must be rejected by a stable client!
    const validBetaAsset = attachSignature('1.3.0', {
      id: 'asset-beta-130',
      channel: 'beta',
      mandatory: false,
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-1.3.0-beta.dmg',
      sizeBytes: payload.length,
      sha256: payloadSha,
      downloadUrl: 'http://localhost:8088/ProtoFlow-1.3.0-beta.dmg',
    });

    // Server tampers with response JSON to relabel beta package as stable & mandatory
    const relabeledAsStableAsset = {
      ...validBetaAsset,
      channel: 'stable',
      mandatory: true,
    };

    let channelSpoofInstalled = false;
    const channelSpoofDir = path.join(tmpDir, 'channel-spoof');
    const stableClient = new DesktopUpdater({
      dataDir: channelSpoofDir,
      appVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async (urlStr: string) => {
        if (urlStr.includes('/updates/check')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              signingPublicKey: TEST_SIGNING_PUBLIC_KEY,
              hasUpdate: true,
              latestRelease: {
                id: 'rel-130',
                version: '1.3.0',
                channel: 'stable',
                mandatory: true,
                assets: [relabeledAsStableAsset],
              },
              recommendedAsset: relabeledAsStableAsset,
              platformAssets: [relabeledAsStableAsset],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          body: Readable.from([payload]),
        };
      },
      openPath: async () => {
        channelSpoofInstalled = true;
        return '';
      },
    });

    // Check on stable channel must reject relabeled beta asset
    const spoofCheck = await stableClient.check();
    assert.equal(spoofCheck.status, 'error');
    assert.match(spoofCheck.error, /签名|通道/);

    // Even if server keeps validBetaAsset.channel='beta' without relabeling, a stable client must reject it because stable only accepts channel='stable'
    stableClient.state.latestRelease = {
      id: 'rel-130',
      version: '1.3.0',
      channel: 'beta',
      mandatory: false,
      assets: [validBetaAsset],
    };
    stableClient.state.recommendedAsset = validBetaAsset;
    stableClient.state.platformAssets = [validBetaAsset];
    const betaOnStableDl = await stableClient.download();
    assert.equal(betaOnStableDl.status, 'error');
    assert.match(betaOnStableDl.error, /已拒绝非正式版通道的安装包/);

    // Even if file is already on disk in cache and apply() is called directly, stableClient rejects it
    const cached130Dir = path.join(channelSpoofDir, 'updates', '1.3.0');
    fs.mkdirSync(cached130Dir, { recursive: true });
    const cached130File = path.join(cached130Dir, 'ProtoFlow-1.3.0-beta.dmg');
    fs.writeFileSync(cached130File, payload);
    stableClient.state.downloadedAssetId = validBetaAsset.id;
    stableClient.state.downloadedFilePath = cached130File;
    await assert.rejects(() => stableClient.apply(), /校验未通过|已拒绝非正式版通道的安装包/);
    assert.equal(channelSpoofInstalled, false);

    // Also verify old protoflow-release-v1 signature (without channel/mandatory) is rejected
    const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([pkcs8Prefix, TEST_SIGNING_SEED]),
      format: 'der',
      type: 'pkcs8',
    });
    const legacyV1Canonical = [
      'protoflow-release-v1',
      'version=1.3.0',
      'os=macos',
      'arch=arm64',
      'packageType=dmg',
      'fileName=ProtoFlow-1.3.0.dmg',
      `sizeBytes=${payload.length}`,
      `sha256=${payloadSha}`,
    ].join('\n');
    const legacyV1Signature = crypto.sign(null, Buffer.from(legacyV1Canonical, 'utf8'), privateKey).toString('base64');
    const v1SignedAsset = {
      id: 'asset-v1',
      channel: 'stable',
      mandatory: false,
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-1.3.0.dmg',
      sizeBytes: payload.length,
      sha256: payloadSha,
      signature: legacyV1Signature,
      signingPublicKey: TEST_SIGNING_PUBLIC_KEY,
      downloadUrl: 'http://localhost:8088/ProtoFlow-1.3.0.dmg',
    };
    assert.equal(verifyAssetManifestSignature('1.3.0', v1SignedAsset, TEST_SIGNING_PUBLIC_KEY), false);

    // 7. [P1] Configuration Epoch (configEpoch): delayed Beta response arriving after switching to Stable must be discarded!
    const stable110Payload = Buffer.from('stable-1.1.0-dmg-binary');
    const stable110Sha = crypto.createHash('sha256').update(stable110Payload).digest('hex');
    const stable110Asset = attachSignature('1.1.0', {
      id: 'asset-stable-110',
      channel: 'stable',
      mandatory: false,
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-1.1.0.dmg',
      sizeBytes: stable110Payload.length,
      sha256: stable110Sha,
      downloadUrl: 'http://localhost:8088/ProtoFlow-1.1.0.dmg',
    });

    const beta140Payload = Buffer.from('beta-1.4.0-dmg-binary');
    const beta140Sha = crypto.createHash('sha256').update(beta140Payload).digest('hex');
    const beta140Asset = attachSignature('1.4.0-beta.1', {
      id: 'asset-beta-140',
      channel: 'beta',
      mandatory: false,
      os: 'macos',
      arch: 'arm64',
      packageType: 'dmg',
      fileName: 'ProtoFlow-1.4.0-beta.1.dmg',
      sizeBytes: beta140Payload.length,
      sha256: beta140Sha,
      downloadUrl: 'http://localhost:8088/ProtoFlow-1.4.0-beta.1.dmg',
    });

    let resolveDelayedBetaCheck!: () => void;
    const delayedBetaGate = new Promise<void>((r) => {
      resolveDelayedBetaCheck = r;
    });

    let mountedDmgPath = '';
    const raceDir = path.join(tmpDir, 'epoch-race');
    const raceUpdater = new DesktopUpdater({
      dataDir: raceDir,
      appVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      trustedPublicKey: TEST_SIGNING_PUBLIC_KEY,
      getFallbackServerUrl: () => 'http://localhost:8088',
      fetchImpl: async (urlStr: string) => {
        if (urlStr.includes('/updates/check')) {
          const u = new URL(urlStr);
          const ch = u.searchParams.get('channel');
          if (ch === 'beta') {
            await delayedBetaGate;
            return {
              ok: true,
              status: 200,
              json: async () => ({
                signingPublicKey: TEST_SIGNING_PUBLIC_KEY,
                hasUpdate: true,
                latestRelease: {
                  id: 'rel-beta-140',
                  version: '1.4.0-beta.1',
                  channel: 'beta',
                  mandatory: false,
                  assets: [beta140Asset],
                },
                recommendedAsset: beta140Asset,
                platformAssets: [beta140Asset],
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              signingPublicKey: TEST_SIGNING_PUBLIC_KEY,
              hasUpdate: true,
              latestRelease: {
                id: 'rel-stable-110',
                version: '1.1.0',
                channel: 'stable',
                mandatory: false,
                assets: [stable110Asset],
              },
              recommendedAsset: stable110Asset,
              platformAssets: [stable110Asset],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-length', String(stable110Payload.length)]]),
          body: Readable.from([stable110Payload]),
        };
      },
      openPath: async (target: string) => {
        mountedDmgPath = target;
        return '';
      },
    });

    // Step A: Configure beta and start a slow beta check
    raceUpdater.configure({ channel: 'beta' });
    const pendingBetaPromise = raceUpdater.check({ channel: 'beta' });

    // Step B: Switch to stable channel and complete stable check + download
    raceUpdater.configure({ channel: 'stable' });
    const stableCheckResult = await raceUpdater.check({ channel: 'stable' });
    assert.equal(stableCheckResult.channel, 'stable');
    assert.equal(stableCheckResult.latestRelease?.version, '1.1.0');
    await raceUpdater.download();

    // Step C: Now let the delayed beta check response finish
    resolveDelayedBetaCheck();
    const afterLateBeta = await pendingBetaPromise;

    // Both the returned snapshot, updater.snapshot(), and apply() MUST retain only the stable 1.1.0 release!
    assert.equal(afterLateBeta.channel, 'stable');
    assert.equal(afterLateBeta.latestRelease?.version, '1.1.0');
    assert.equal(afterLateBeta.recommendedAsset?.id, 'asset-stable-110');
    assert.equal(raceUpdater.snapshot().latestRelease?.version, '1.1.0');
    assert.equal(raceUpdater.snapshot().recommendedAsset?.id, 'asset-stable-110');

    const guide = await raceUpdater.apply();
    assert.equal(guide.action, 'dmg-mounted');
    assert.match(mountedDmgPath, /ProtoFlow-1\.1\.0\.dmg$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('LAN admin client verifies server policy before sending credentials or uploading files', async () => {
  const originalFetch = globalThis.fetch;
  const base = 'http://192.168.1.104:8088';
  const calls: { url: string; init?: RequestInit }[] = [];
  const release = { version: '0.0.5', title: 'LAN test', notes: '', channel: 'stable' as const, mandatory: false, published: false };
  const asset = { os: 'macos' as const, arch: 'arm64' as const, packageType: 'dmg' as const, fileName: 'test.dmg', externalUrl: 'https://example.com/test.dmg', sizeBytes: 10, sha256: 'a'.repeat(64) };
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ error: 'network denied' }), { status: 403 });
    };
    const operations = [
      () => loginPlatformAdmin({ username: 'admin', password: 'test-password' }, base),
      () => fetchPlatformAdminMe('test-token', base),
      () => logoutPlatformAdmin('test-token', base),
      () => fetchManagedReleases('test-token', base),
      () => createManagedRelease('test-token', release, base),
      () => updateManagedRelease('test-token', 'release-id', release, base),
      () => deleteManagedRelease('test-token', 'release-id', base),
      () => addReleaseAssetLink('test-token', 'release-id', asset, base),
      () => approveReleaseAsset('test-token', 'release-id', 'asset-id', asset.sha256, base),
      () => deleteReleaseAsset('test-token', 'release-id', 'asset-id', base),
      () => uploadReleaseAsset('test-token', 'release-id', new File(['package'], 'test.dmg'), asset, undefined, base),
    ];
    for (const operation of operations) {
      calls.length = 0;
      await assert.rejects(operation, /network denied/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, `${base}/api/v1/admin/status`);
      assert.equal(new Headers(calls[0].init?.headers).has('Authorization'), false);
      assert.equal(calls[0].init?.body, undefined);
    }
    calls.length = 0;
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      if (String(input).endsWith('/status')) return new Response(JSON.stringify({ initialized: true }));
      return new Response(JSON.stringify({ token: 'test-session', admin: { id: 'admin-id' } }));
    };
    assert.equal((await loginPlatformAdmin({ username: 'admin', password: 'test-password' }, base)).token, 'test-session');
    assert.deepEqual(calls.map(c => c.url), [`${base}/api/v1/admin/status`, `${base}/api/v1/admin/login`]);
    assert.equal(calls[1].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { username: 'admin', password: 'test-password' });
    calls.length = 0;
    await assertAllowedAdminOrigin('https://releases.example.com');
    await assertAllowedAdminOrigin('http://127.0.0.1:8088');
    assert.equal(calls.length, 0);
    globalThis.fetch = async () => new Response(JSON.stringify({ initialized: 'yes' }));
    await assert.rejects(() => fetchAdminStatus(base), /管理员状态响应无效/);
    await assert.rejects(() => loginPlatformAdmin({ username: 'admin', password: 'test-password' }, base), /管理员状态响应无效/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
