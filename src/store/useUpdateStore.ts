import { create } from 'zustand';
import {
  checkPublicUpdate,
  detectBrowserPlatform,
  getUpdaterDesktopBridge,
  type DesktopReleaseAsset,
  type DesktopUpdaterState,
} from '../services/releaseClient';
import { publishingOrigin, publishingSettings } from '../services/publishingClient';
import { flushProjectChanges } from '../services/projectStorage';
import packageMeta from '../../package.json';

export interface UpdateStore extends DesktopUpdaterState {
  isModalOpen: boolean;
  isUpdating: boolean;
  selectedAssetId: string | null;
  setModalOpen: (open: boolean) => void;
  selectAsset: (assetId: string) => void;
  syncFromNativeState: (state: DesktopUpdaterState) => void;
  bootstrapUpdaterOnLaunch: () => Promise<void>;
  checkForUpdates: (options?: { silent?: boolean }) => Promise<void>;
  startDownload: (assetId?: string) => Promise<void>;
  installLatestUpdate: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  revealDownloadedFile: () => Promise<void>;
  openReleaseCenterWeb: () => Promise<void>;
}

const browserPlatform = detectBrowserPlatform();
let subscribed = false;
let webCheckAbort: AbortController | null = null;
const updateErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^Error invoking remote method 'pflow:updater-[^']+':\s*(?:Error:\s*)?/, '');

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  isModalOpen: false,
  isUpdating: false,
  selectedAssetId: null,
  status: 'idle',
  currentVersion: packageMeta.version || '0.0.1',
  os: browserPlatform.os,
  arch: browserPlatform.arch,
  preferPackage: browserPlatform.os === 'windows' ? 'exe' : browserPlatform.os === 'macos' ? 'dmg' : 'deb',
  isDebian: browserPlatform.os === 'linux',
  appImagePath: null,
  serverUrl: '',
  channel: 'stable',
  skippedVersion: '',
  hasUpdate: false,
  latestRelease: null,
  recommendedAsset: null,
  platformAssets: [],
  progress: null,
  downloadedAssetId: null,
  downloadedFilePath: null,
  verifiedSha256: null,
  lastCheckedAt: null,
  error: null,
  installGuide: null,
  configEpoch: 0,

  setModalOpen: (open) => { if (open || (!get().isUpdating && get().status !== 'installing')) set({ isModalOpen: open }); },
  selectAsset: (assetId) => set({ selectedAssetId: assetId }),

  syncFromNativeState: (state) => {
    const currentEpoch = get().configEpoch ?? 0;
    if (typeof state.configEpoch === 'number' && state.configEpoch < currentEpoch) {
      return;
    }
    const currentSelected = get().selectedAssetId;
    const validSelected =
      currentSelected && state.platformAssets.some((a) => a.id === currentSelected)
        ? currentSelected
        : state.downloadedAssetId ?? state.recommendedAsset?.id ?? state.platformAssets[0]?.id ?? null;
    set({
      ...state,
      configEpoch: typeof state.configEpoch === 'number' ? state.configEpoch : currentEpoch,
      selectedAssetId: validSelected,
    });
  },

  bootstrapUpdaterOnLaunch: async () => {
    const bridge = getUpdaterDesktopBridge();
    if (bridge) {
      if (!subscribed) {
        subscribed = true;
        bridge.onEvent((nextState) => {
          get().syncFromNativeState(nextState);
        });
      }
      try {
        const initial = await bridge.state();
        get().syncFromNativeState(initial);
        if (initial.serverUrl) {
          const checked = await bridge.check({ silent: true });
          get().syncFromNativeState(checked);
          if ((checked.status === 'available' || checked.status === 'downloaded') && checked.hasUpdate && checked.latestRelease?.mandatory) {
            set({ isModalOpen: true });
          }
        }
      } catch {
        // ignore startup background check error
      }
      return;
    }

    // Browser development fallback: inspect publishingSettings if configured
    try {
      const pub = await publishingSettings();
      if (pub.url) {
        set({ serverUrl: pub.url });
        await get().checkForUpdates({ silent: true });
      }
    } catch {
      // ignore
    }
  },

  checkForUpdates: async (options = {}) => {
    const bridge = getUpdaterDesktopBridge();
    if (bridge) {
      const next = await bridge.check(options);
      get().syncFromNativeState(next);
      return;
    }

    const requestEpoch = get().configEpoch ?? 0;
    const rawUrl = get().serverUrl;
    const channel = get().channel;
    if (!rawUrl || !rawUrl.trim()) {
      if ((get().configEpoch ?? 0) !== requestEpoch) return;
      set({
        status: 'idle',
        error: options.silent ? null : '请在 Alex 桌面应用中检查更新。',
      });
      return;
    }
    let serverUrl: string;
    try {
      serverUrl = publishingOrigin(rawUrl);
    } catch (e) {
      if ((get().configEpoch ?? 0) !== requestEpoch) return;
      set({
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (webCheckAbort) {
      try {
        webCheckAbort.abort();
      } catch {
        // ignore
      }
    }
    const abortController = new AbortController();
    webCheckAbort = abortController;

    set({ status: 'checking', serverUrl, channel, error: null, installGuide: null });
    try {
      const res = await checkPublicUpdate({
        baseUrl: serverUrl,
        currentVersion: get().currentVersion,
        os: get().os,
        arch: get().arch,
        channel,
        preferPackage: get().preferPackage,
        signal: abortController.signal,
      });
      if ((get().configEpoch ?? 0) !== requestEpoch || webCheckAbort !== abortController || abortController.signal.aborted) {
        return;
      }
      if (res.hasUpdate && res.latestRelease && channel === 'stable' && res.latestRelease.channel !== 'stable') {
        throw new Error('当前客户端处于正式版 (stable) 通道，已拒绝非正式版通道的更新响应');
      }
      const platformAssets: DesktopReleaseAsset[] = Array.isArray(res.platformAssets) ? res.platformAssets : [];
      const recommendedAsset = platformAssets.find((asset) => asset.id === res.recommendedAsset?.id) ?? platformAssets[0] ?? null;
      const hasUpdate = Boolean(res.hasUpdate && res.latestRelease && recommendedAsset);
      set({
        status: hasUpdate ? 'available' : 'up-to-date',
        hasUpdate,
        latestRelease: hasUpdate ? res.latestRelease : null,
        recommendedAsset: hasUpdate ? recommendedAsset : null,
        platformAssets: hasUpdate ? platformAssets : [],
        selectedAssetId: hasUpdate && recommendedAsset ? recommendedAsset.id : null,
        lastCheckedAt: new Date().toISOString(),
        error: null,
      });
    } catch (e) {
      if ((get().configEpoch ?? 0) !== requestEpoch || webCheckAbort !== abortController || abortController.signal.aborted) {
        return;
      }
      set({
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
        lastCheckedAt: new Date().toISOString(),
      });
    } finally {
      if (webCheckAbort === abortController) {
        webCheckAbort = null;
      }
    }
  },

  startDownload: async (assetId) => {
    const targetId = assetId ?? get().selectedAssetId ?? get().recommendedAsset?.id;
    const bridge = getUpdaterDesktopBridge();
    if (bridge) {
      try {
        const next = await bridge.download({ assetId: targetId ?? undefined });
        get().syncFromNativeState(next);
      } catch (e) {
        set({
          status: 'error',
          progress: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    // Browser dev fallback: trigger direct browser download of the asset
    const release = get().latestRelease;
    const allAssets = release?.assets ?? get().platformAssets;
    const asset = allAssets.find((a) => a.id === targetId) ?? get().recommendedAsset;
    if (!asset?.downloadUrl) {
      set({ status: 'error', error: '未找到可用的安装包下载链接' });
      return;
    }
    window.open(asset.downloadUrl, '_blank', 'noopener,noreferrer');
  },

  installLatestUpdate: async () => {
    if (get().isUpdating || get().status === 'installing') return;
    const bridge = getUpdaterDesktopBridge();
    if (!bridge) { await get().startDownload(); return; }
    set({ isUpdating: true, isModalOpen: true, error: null });
    try {
      const checked = await bridge.check();
      get().syncFromNativeState(checked);
      if (checked.error) throw new Error(checked.error);
      if (!checked.hasUpdate) return;
      const asset = checked.recommendedAsset;
      if (!asset) throw new Error('该版本暂未提供适合此电脑的安装包，请联系管理员。');
      const downloaded = await bridge.download({ assetId: asset.id });
      get().syncFromNativeState(downloaded);
      if (downloaded.error) throw new Error(downloaded.error);
      // Cancellation or switching sources must never install another task's file.
      if (downloaded.status !== 'downloaded') return;
      if (downloaded.configEpoch !== checked.configEpoch || downloaded.downloadedAssetId !== asset.id) {
        throw new Error('更新内容已改变，请重新检查更新。');
      }
      try { await flushProjectChanges(); }
      catch (error) { throw new Error(`保存当前工程失败，更新已停止：${error instanceof Error ? error.message : String(error)}`); }
      const guide = await bridge.apply({ expectedAssetId: asset.id, expectedConfigEpoch: checked.configEpoch });
      set({ installGuide: guide, error: null });
    } catch (error) {
      set({ error: updateErrorMessage(error) });
    } finally {
      set({ isUpdating: false });
    }
  },

  cancelDownload: async () => {
    const bridge = getUpdaterDesktopBridge();
    if (bridge) {
      const next = await bridge.cancel();
      get().syncFromNativeState(next);
    }
  },

  applyUpdate: async () => {
    const bridge = getUpdaterDesktopBridge();
    if (!bridge) return;
    try {
      await flushProjectChanges();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({
        error: `保存当前工程失败，已停止启动安装器：${msg}`,
      });
      return;
    }
    try {
      const guide = await bridge.apply();
      set({ installGuide: guide, error: null });
    } catch (e) {
      set({
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  revealDownloadedFile: async () => {
    const bridge = getUpdaterDesktopBridge();
    if (!bridge) return;
    await bridge.reveal();
  },

  openReleaseCenterWeb: async () => {
    const targetUrl = get().serverUrl.trim();
    const bridge = getUpdaterDesktopBridge();
    if (bridge) {
      await bridge.openWeb();
      return;
    }
    if (targetUrl) {
      const clean = publishingOrigin(targetUrl);
      window.open(`${clean}/releases`, '_blank', 'noopener,noreferrer');
    } else {
      window.open('https://github.com/EvanClub-Agent/protoflow-ai/releases', '_blank', 'noopener,noreferrer');
    }
  },
}));
