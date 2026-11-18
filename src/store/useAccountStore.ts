import { create } from 'zustand';
import { accountSettings, authenticatePublishing, logoutPublishing, type PublishingLogin, type PublishingUser } from '../services/publishingClient';
import { flushProjectChanges } from '../services/projectStorage';
import { useProtoStore } from './useProtoStore';
import { useHermesStore } from './useHermesStore';

interface AccountState {
  status: 'checking' | 'authenticated' | 'local' | 'signedOut' | 'error';
  serverUrl: string;
  user: PublishingUser | null;
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  enterLocalMode: () => void;
  login: (input: PublishingLogin) => Promise<void>;
  logout: () => Promise<void>;
}
let epoch = 0, refreshPromise: Promise<void> | null = null;
export const useAccountStore = create<AccountState>((set, get) => ({
  status: 'checking', serverUrl: '', user: null, busy: false, error: '',
  refresh: () => {
    if (refreshPromise) return refreshPromise;
    if (get().busy) return Promise.resolve();
    const current = epoch;
    refreshPromise = (async () => {
      try {
        const settings = await accountSettings();
        if (current !== epoch) return;
        if (settings.user) {
          set({ status: 'authenticated', serverUrl: settings.url, user: settings.user, error: settings.notice ?? '' });
          return;
        }
        // Out-of-the-box open-source mode has no server URL configured; open local workspace directly.
        // Also preserve an explicitly chosen local session across focus refreshes.
        const stayLocal = get().status === 'local' || !settings.url;
        set({
          status: stayLocal ? 'local' : 'signedOut',
          serverUrl: settings.url,
          user: null,
          error: settings.notice ?? '',
        });
      } catch (error) {
        if (current !== epoch) return;
        const active = get().status;
        // Transient network errors never discard an already verified session or local offline session.
        set({
          status: active === 'authenticated' || active === 'local' ? active : 'error',
          error: error instanceof Error ? error.message : '账号服务暂不可用',
        });
      } finally { refreshPromise = null; }
    })();
    return refreshPromise;
  },
  enterLocalMode: () => {
    if (get().busy) return;
    ++epoch;
    set({ status: 'local', user: null, error: '' });
  },
  login: async input => {
    if (get().busy) return;
    const current = ++epoch;
    const previousStatus = get().status;
    set({ busy: true, error: '' });
    try {
      const settings = await authenticatePublishing(input);
      if (current !== epoch) return;
      if (!settings.user) throw new Error('登录未完成，请重试');
      set({ status: 'authenticated', serverUrl: settings.url, user: settings.user, error: '' });
    } catch (error) {
      if (current === epoch) {
        set({
          status: previousStatus === 'local' ? 'local' : 'signedOut',
          user: null,
          error: error instanceof Error ? error.message : '登录失败',
        });
      }
    } finally { if (current === epoch) set({ busy: false }); }
  },
  logout: async () => {
    if (get().busy) return;
    if (Object.values(useHermesStore.getState().runningProjects).some(Boolean)) throw new Error('AI 任务正在进行，请完成或停止任务后再退出账号');
    ++epoch; set({ busy: true, error: '' });
    try {
      await flushProjectChanges();
      const settings = await logoutPublishing();
      useProtoStore.setState({ isWebPublishModalOpen: false, isBundleModalOpen: false, isWelcomeScreenOpen: true });
      set({
        status: settings.url ? 'signedOut' : 'local',
        serverUrl: settings.url,
        user: null,
        error: settings.notice ?? '',
      });
    } finally { set({ busy: false }); }
  },
}));
