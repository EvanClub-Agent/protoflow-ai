import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
const RuntimeDiagnosticsPanel = React.lazy(() => import('./RuntimeDiagnosticsPanel'));
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  FileArchive,
  HardDrive,
  KeyRound,
  Link2,
  Lock,
  LogOut,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { AlexLogo } from '../components/AlexLogo';
import { ReleaseWorkspace } from './ReleaseWorkspace';
import { assetReady, assetVersionIssue, releaseInput, releaseTitleIssue } from './releasePresentation';
import { ThemeSwitch, useThemePreference } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { useI18n } from '../i18n';
import {
  addReleaseAssetLink,
  approveReleaseAsset,
  createManagedRelease,
  deleteManagedRelease,
  deleteReleaseAsset,
  detectBrowserPlatform,
  fetchAdminStatus,
  fetchClientUserMe,
  fetchManagedReleases,
  fetchPlatformAdminMe,
  fetchPublicReleases,
  formatBytes,
  inferAssetTargetFromFileName,
  loginClientUser,
  loginPlatformAdmin,
  logoutClientUser,
  logoutPlatformAdmin,
  PLATFORM_LABELS,
  registerClientUser,
  updateManagedRelease,
  uploadReleaseAsset,
  type ClientUser,
  type DesktopRelease,
  type PlatformAdmin,
  type ReleaseArch,
  type ReleaseChannel,
  type ReleaseInput,
  type ReleaseOS,
  type ReleasePackageType,
} from '../services/releaseClient';

const ADMIN_TOKEN_KEY = 'protoflow_platform_admin_token';
const USER_TOKEN_KEY = 'protoflow_client_user_token';

export interface ReleaseCenterViewProps {
  isAdminRoute?: boolean;
  onNavigateRoute?: (adminRoute: boolean) => void;
}

export const ReleaseCenterView: React.FC<ReleaseCenterViewProps> = ({
  isAdminRoute = false,
  onNavigateRoute,
}) => {
  const { locale, tr, td } = useI18n();
  const theme = useThemePreference();
  const visitorPlatform = useMemo(() => detectBrowserPlatform(), []);
  const idPrefix = useId();

  const [releases, setReleases] = useState<DesktopRelease[]>([]);
  const [signingPublicKey, setSigningPublicKey] = useState<string>('');
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<'all' | ReleaseChannel>('all');
  const [loading, setLoading] = useState(true);
  const loadEpoch = useRef(0);
  const mutationLock = useRef(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Platform Admin state (used on /releases/admin)
  const [adminToken, setAdminToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });
  const [adminProfile, setAdminProfile] = useState<PlatformAdmin | null>(null);
  const [adminInitialized, setAdminInitialized] = useState<boolean>(true);
  const [adminChecking, setAdminChecking] = useState<boolean>(isAdminRoute);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthBusy, setAdminAuthBusy] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState('');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [adminChannelAllowed, setAdminChannelAllowed] = useState(false);

  // Client User state (used on /releases)
  const [userToken, setUserToken] = useState<string>(() => {
    try {
      return localStorage.getItem(USER_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });
  const [clientUser, setClientUser] = useState<ClientUser | null>(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userAuthMode, setUserAuthMode] = useState<'login' | 'register'>('login');
  const [userUsername, setUserUsername] = useState('');
  const [userDisplayName, setUserDisplayName] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userAuthBusy, setUserAuthBusy] = useState(false);
  const [userAuthError, setUserAuthError] = useState('');

  const isAdminAuthenticated = Boolean(isAdminRoute && adminChannelAllowed && !adminChecking && adminToken && adminProfile);

  // Native <dialog> refs
  const userDialogRef = useRef<HTMLDialogElement | null>(null);
  const releaseDialogRef = useRef<HTMLDialogElement | null>(null);
  const assetDialogRef = useRef<HTMLDialogElement | null>(null);

  // Release form modal state
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [editingRelease, setEditingRelease] = useState<DesktopRelease | null>(null);
  const [releaseForm, setReleaseForm] = useState<ReleaseInput>({
    version: '', title: '', notes: '', channel: 'stable', mandatory: false, published: false,
  });
  const [releaseSaving, setReleaseSaving] = useState(false);
  const [releaseFormError, setReleaseFormError] = useState('');

  // Asset upload / external link modal state
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [assetTargetRelease, setAssetTargetRelease] = useState<DesktopRelease | null>(null);
  const [assetMode, setAssetMode] = useState<'upload' | 'link'>('upload');
  const [assetOS, setAssetOS] = useState<ReleaseOS>('macos');
  const [assetArch, setAssetArch] = useState<ReleaseArch>('arm64');
  const [assetPkg, setAssetPkg] = useState<ReleasePackageType>('dmg');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; loaded: number; total: number } | null>(null);
  const [linkFileName, setLinkFileName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkSize, setLinkSize] = useState('');
  const [linkSha256, setLinkSha256] = useState('');
  const [assetSaving, setAssetSaving] = useState(false);
  const [assetError, setAssetError] = useState('');

  const switchRoute = (targetAdmin: boolean) => {
    if (onNavigateRoute) {
      onNavigateRoute(targetAdmin);
      return;
    }
    window.location.href = targetAdmin ? '/releases/admin' : '/releases';
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      showToast(tr('复制失败，请手动选中复制', 'Copy failed. Please select and copy manually.'));
    }
  };

  // Sync native <dialog> open states via showModal() / close()
  useEffect(() => {
    const dlg = userDialogRef.current;
    if (!dlg) return;
    if (userDialogOpen && !dlg.open) dlg.showModal();
    else if (!userDialogOpen && dlg.open) dlg.close();
  }, [userDialogOpen]);

  useEffect(() => {
    const dlg = releaseDialogRef.current;
    if (!dlg) return;
    if (releaseDialogOpen && !dlg.open) dlg.showModal();
    else if (!releaseDialogOpen && dlg.open) dlg.close();
  }, [releaseDialogOpen]);

  useEffect(() => {
    const dlg = assetDialogRef.current;
    if (!dlg) return;
    if (assetDialogOpen && !dlg.open) dlg.showModal();
    else if (!assetDialogOpen && dlg.open) dlg.close();
  }, [assetDialogOpen]);

  // Verify stored client user token on mount
  useEffect(() => {
    if (!userToken) {
      setClientUser(null);
      return;
    }
    fetchClientUserMe(userToken)
      .then((res) => setClientUser(res.user))
      .catch(() => {
        setClientUser(null);
        setUserToken('');
        try {
          localStorage.removeItem(USER_TOKEN_KEY);
        } catch {
          // ignore
        }
      });
  }, [userToken]);

  const checkAdminStatusAndSession = async () => {
    if (!isAdminRoute) return;
    setAdminChecking(true);
    setAdminChannelAllowed(false);
    setAdminAuthError('');
    try {
      const status = await fetchAdminStatus();
      setAdminInitialized(status.initialized);
      setAdminChannelAllowed(true);
      if (adminToken) {
        try {
          const me = await fetchPlatformAdminMe(adminToken);
          setAdminProfile(me.admin);
        } catch {
          setAdminProfile(null);
          setAdminToken('');
          try {
            sessionStorage.removeItem(ADMIN_TOKEN_KEY);
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      setAdminAuthError(e instanceof Error ? e.message : tr('读取平台管理员状态失败', 'Failed to verify platform admin status'));
    } finally {
      setAdminChecking(false);
    }
  };

  // Verify admin status & token when on /releases/admin
  useEffect(() => {
    void checkAdminStatusAndSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminRoute, adminToken]);

  const loadReleases = async (preferredId?: string) => {
    const epoch = ++loadEpoch.current;
    if (isAdminRoute && (!adminToken || !adminProfile)) {
      setReleases([]); setLoading(false); return;
    }
    setLoading(true); setError('');
    try {
      const res = isAdminRoute
        ? await fetchManagedReleases(adminToken)
        : await fetchPublicReleases('', 'all');
      if (epoch !== loadEpoch.current) return;
      setReleases(res.items);
      setSigningPublicKey(res.signingPublicKey ?? '');
      setSelectedReleaseId(current => {
        const selected = preferredId === undefined ? current : preferredId;
        return res.items.some(release => release.id === selected) ? selected : res.items[0]?.id ?? null;
      });
    } catch (e) {
      if (epoch === loadEpoch.current) setError(e instanceof Error ? e.message : tr('加载版本列表失败', 'Failed to load releases'));
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
  };

  useEffect(() => {
    document.title = isAdminRoute
      ? tr('Alex · 版本管理', 'Alex · Release Admin')
      : tr('Alex · 版本下载', 'Alex · Downloads');
  }, [isAdminRoute, locale, tr]);

  useEffect(() => {
    void loadReleases();
    return () => { loadEpoch.current++; };
  }, [isAdminRoute, adminToken, adminProfile]);

  useEffect(() => { setMutationError(''); }, [selectedReleaseId]);

  const runReleaseAction = async (action: () => Promise<void>) => {
    if (!isAdminAuthenticated || mutationLock.current) return;
    mutationLock.current = true; setMutationBusy(true); setMutationError('');
    try { await action(); }
    catch (e) { setMutationError(e instanceof Error ? e.message : tr('操作失败，请重试', 'Action failed. Please try again.')); }
    finally { mutationLock.current = false; setMutationBusy(false); }
  };
  const changeVisibility = (release: DesktopRelease) => void runReleaseAction(async () => {
    if (!release.published) {
      if (!release.assets.some(assetReady)) throw new Error(tr('请先上传至少一个平台的安装包并完成签名确认。', 'Please upload and sign at least one platform installer first.'));
      const issue = releaseTitleIssue(release.version, release.title);
      if (issue) throw new Error(issue);
    } else if (!window.confirm(tr(`将 v${release.version} 撤回为草稿？下载页将不再展示，安装包仍保留。`, `Unpublish v${release.version} to draft? It will be hidden from public downloads while keeping its installers.`))) return;
    await updateManagedRelease(adminToken, release.id, {
      version:release.version, title:release.title, notes:release.notes, channel:release.channel,
      mandatory:release.mandatory, published:!release.published,
    });
    await loadReleases(release.id);
    showToast(
      release.published
        ? tr(`v${release.version} 已撤回为草稿`, `v${release.version} reverted to draft`)
        : tr(`v${release.version} 已公开，可继续补充其他平台`, `v${release.version} published. Other platforms can still be added.`)
    );
  });
  const openCreateReleaseModal = () => {
    setEditingRelease(null);
    setReleaseForm({version:'', title:'', notes:'', channel:'stable', mandatory:false, published:false});
    setReleaseFormError(''); setReleaseDialogOpen(true);
  };

  const openEditReleaseModal = (rel: DesktopRelease) => {
    setEditingRelease(rel);
    setReleaseForm({
      version: rel.version,
      title: rel.title,
      notes: rel.notes,
      channel: rel.channel,
      mandatory: rel.mandatory,
      published: rel.published,
    });
    setReleaseFormError('');
    setReleaseDialogOpen(true);
  };

  const openAssetModal = (rel: DesktopRelease, presetOS?: ReleaseOS) => {
    const targetOS = presetOS ?? visitorPlatform.os;
    setAssetTargetRelease(rel);
    setAssetMode('upload');
    setAssetOS(targetOS);
    setAssetArch(targetOS === 'macos' ? 'arm64' : 'x64');
    setAssetPkg(targetOS === 'windows' ? 'exe' : targetOS === 'macos' ? 'dmg' : 'deb');
    setSelectedFile(null);
    setUploadProgress(null);
    setLinkFileName('');
    setLinkUrl('');
    setLinkSize('');
    setLinkSha256('');
    setAssetError('');
    setAssetDialogOpen(true);
  };

  const handleFilePicked = (file: File | null) => {
    setSelectedFile(file);
    setAssetError('');
    if (!file) return;
    const inferred = inferAssetTargetFromFileName(file.name);
    if (inferred) {
      setAssetOS(inferred.os);
      setAssetArch(inferred.arch);
      setAssetPkg(inferred.packageType);
    }
  };

  const handleOSChange = (nextOS: ReleaseOS) => {
    setAssetOS(nextOS);
    const validPkgs = PLATFORM_LABELS[nextOS].packages;
    if (!validPkgs.includes(assetPkg)) {
      setAssetPkg(validPkgs[0]);
    }
    if (nextOS !== 'macos' && assetArch === 'universal') {
      setAssetArch('x64');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-30 h-14 border-b border-slate-200/90 bg-white/95 backdrop-blur-xs px-4 sm:px-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <AlexLogo size={30} className="rounded-lg shadow-2xs shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-slate-900 tracking-tight shrink-0">Alex</span>
              {isAdminRoute ? (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 whitespace-nowrap">
                  <ShieldCheck size={12} />
                  <span>{tr('版本管理后台', 'Release Admin')}</span>
                </span>
              ) : (
                <span className="hidden sm:inline-flex items-center rounded-md bg-blue-50 border border-blue-200/80 px-2 py-0.5 text-[11px] font-semibold text-blue-700 whitespace-nowrap">
                  {tr('版本发布与更新中心', 'Release & Update Center')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block truncate">
              {isAdminRoute
                ? tr('维护版本信息，逐步补充各平台安装包', 'Manage releases and upload installers across platforms')
                : tr('查看更新，选择适合你的版本与平台', 'Browse updates and choose the right version for your platform')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ThemeSwitch {...theme} />
          <LanguageSwitch />

          {isAdminRoute ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => switchRoute(false)}
                className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
              >
                <ArrowLeft size={13.5} />
                <span className="hidden sm:inline">{tr('返回公开下载页', 'Public Downloads')}</span><span className="sm:hidden">{tr('下载页', 'Downloads')}</span>
              </button>
              {isAdminAuthenticated && adminProfile && (
                <>
                  <span className="hidden lg:inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                    <ShieldCheck size={13.5} />
                    <span>{tr(`管理员：${adminProfile.displayName}`, `Admin: ${adminProfile.displayName}`)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const tok = adminToken;
                      setAdminToken('');
                      setAdminProfile(null);
                      try {
                        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
                      } catch {
                        // ignore
                      }
                      if (tok) {
                        try {
                          await logoutPlatformAdmin(tok);
                        } catch {
                          // ignore
                        }
                      }
                      showToast(tr('已退出平台管理员后台', 'Signed out of admin console'));
                    }}
                    title={tr('退出平台管理员登录', 'Sign out of platform admin')}
                    className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-2.5 py-1.5 text-xs flex items-center gap-1 cursor-pointer transition whitespace-nowrap"
                  >
                    <LogOut size={13.5} />
                    <span className="hidden sm:inline">{tr('退出管理', 'Sign Out')}</span>
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {clientUser ? (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    <UserCheck size={13} className="text-blue-600 shrink-0" />
                    <span className="max-w-20 truncate sm:max-w-40">{clientUser.displayName}</span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const tok = userToken;
                      setClientUser(null);
                      setUserToken('');
                      try {
                        localStorage.removeItem(USER_TOKEN_KEY);
                      } catch {
                        // ignore
                      }
                      if (tok) {
                        try {
                          await logoutClientUser(tok);
                        } catch {
                          // ignore
                        }
                      }
                      showToast(tr('已退出客户端账号', 'Signed out of client account'));
                    }}
                    title={tr('退出客户端账号', 'Sign out of client account')}
                    className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 p-1.5 text-xs cursor-pointer"
                  >
                    <LogOut size={13} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setUserAuthError('');
                    setUserAuthMode('login');
                    setUserDialogOpen(true);
                  }}
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer transition shadow-2xs whitespace-nowrap"
                >
                  <UserPlus size={13.5} className="text-blue-600" />
                  <span className="hidden sm:inline">{tr('用户登录 / 注册', 'Sign In / Register')}</span><span className="sm:hidden">{tr('登录', 'Sign In')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => switchRoute(true)}
                className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
              >
                <KeyRound size={13.5} />
                <span className="hidden sm:inline">{tr('版本管理后台', 'Release Admin')}</span><span className="sm:hidden">{tr('管理', 'Admin')}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-4 sm:right-6 max-w-[calc(100vw-2rem)] z-50 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/95 px-4 py-2.5 text-xs font-medium text-white shadow-xl"
        >
          <Sparkles size={14} className="text-blue-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-8 space-y-8">
        {/* If on /releases/admin and not authenticated as PlatformAdmin, show Dedicated Admin Login / CLI Init Gate */}
        {isAdminRoute && !isAdminAuthenticated ? (
          <section className="max-w-md mx-auto mt-8 rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-sm space-y-5">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                <Lock size={20} />
              </span>
              <div className="space-y-1">
                <h1 className="text-base font-extrabold text-slate-900">
                  {adminInitialized
                    ? tr('平台管理员登录 · 版本管理后台', 'Platform Admin Sign In · Release Admin')
                    : tr('需在服务端命令行初始化平台管理员', 'Initialize Platform Admin via Server CLI')}
                </h1>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {adminInitialized
                    ? tr(
                        '桌面端版本发布、编辑、删除与安装包替换仅限平台管理员 (platform_admins) 访问，普通原型发布凭证与客户端用户无权操作。',
                        'Publishing, editing, deleting desktop releases and replacing installers is restricted to platform admins (platform_admins).'
                      )
                    : tr(
                        '为防止匿名抢注，已关闭网页端首次管理员初始化入口。请由运维人员在服务端执行 CLI 命令完成初始化。',
                        'To prevent unauthorized claiming, web-based initial admin setup is disabled. Please run the CLI command on the server.'
                      )}
                </p>
              </div>
            </div>

            {adminChecking ? (
              <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                <RefreshCw size={15} className="animate-spin text-blue-600" />
                <span>{tr('正在验证平台管理员状态…', 'Verifying platform admin status…')}</span>
              </div>
            ) : !adminChannelAllowed ? (
              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 text-xs text-amber-900">
                <p className="leading-relaxed">{adminAuthError}</p>
                <button type="button" onClick={() => void checkAdminStatusAndSession()} className="font-semibold underline cursor-pointer">
                  {tr('重新检测访问权限', 'Retry Access Check')}
                </button>
              </div>
            ) : !adminInitialized ? (
              <div className="space-y-4 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-slate-700">
                  <p className="font-semibold text-slate-800">{tr('请在服务器终端执行以下命令创建或重置管理员账号：', 'Run the following command on the server terminal to create or reset an admin account:')}</p>
                  <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-[11px] overflow-x-auto">
                    {tr(
                      `# 密码从标准输入或 PROTOFLOW_ADMIN_PASSWORD 读取\nnpm run server:create-admin -- admin`,
                      `# Password is read from stdin or PROTOFLOW_ADMIN_PASSWORD\nnpm run server:create-admin -- admin`
                    )}
                  </pre>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {tr('生产环境可直接执行 ', 'In production, run ')}
                    <code className="font-mono text-slate-700">protoflow create-admin admin</code>
                    {tr('，按提示输入 8–128 位管理员密码后点击下方按钮刷新状态。', ', enter an 8–128 character password when prompted, then click below to refresh.')}
                  </p>
                </div>

                {adminAuthError && (
                  <p
                    role="alert"
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                  >
                    {td(adminAuthError)}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void checkAdminStatusAndSession()}
                  className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 py-2.5 text-xs font-semibold text-white cursor-pointer transition shadow-2xs"
                >
                  {tr('已完成 CLI 初始化，重新检测状态', 'CLI Initialized — Refresh Status')}
                </button>
              </div>
            ) : (
              <form
                className="space-y-4 text-xs"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (adminAuthBusy || !adminChannelAllowed) return;
                  setAdminAuthBusy(true);
                  setAdminAuthError('');
                  try {
                    const res = await loginPlatformAdmin({
                      username: adminUsername.trim(),
                      password: adminPassword,
                    });
                    setAdminInitialized(true);
                    setAdminToken(res.token);
                    setAdminProfile(res.admin);
                    try {
                      sessionStorage.setItem(ADMIN_TOKEN_KEY, res.token);
                    } catch {
                      // ignore
                    }
                    setAdminPassword('');
                    showToast(tr(`欢迎，平台管理员 ${res.admin.displayName}！`, `Welcome, Platform Admin ${res.admin.displayName}!`));
                  } catch (err) {
                    setAdminAuthError(err instanceof Error ? err.message : tr('管理员认证失败', 'Admin authentication failed'));
                  } finally {
                    setAdminAuthBusy(false);
                  }
                }}
              >
                <div className="space-y-1.5">
                  <label htmlFor={`${idPrefix}-admin-user`} className="block font-semibold text-slate-700">
                    {tr('管理员账号 (Username) *', 'Admin Username *')}
                  </label>
                  <input
                    id={`${idPrefix}-admin-user`}
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={tr('例如：admin', 'e.g. admin')}
                    value={adminUsername}
                    onChange={(e) => {
                      setAdminUsername(e.target.value);
                      if (adminAuthError) setAdminAuthError('');
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor={`${idPrefix}-admin-pass`} className="block font-semibold text-slate-700">
                    {tr('管理员密码 (至少 8 位) *', 'Admin Password (min 8 chars) *')}
                  </label>
                  <input
                    id={`${idPrefix}-admin-pass`}
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="current-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={tr('输入平台管理员密码...', 'Enter platform admin password...')}
                    value={adminPassword}
                    onChange={(e) => {
                      setAdminPassword(e.target.value);
                      if (adminAuthError) setAdminAuthError('');
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none"
                  />
                </div>

                {adminAuthError && (
                  <p
                    role="alert"
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                  >
                    {td(adminAuthError)}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={adminAuthBusy || !adminChannelAllowed}
                  className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 py-2.5 text-xs font-semibold text-white cursor-pointer transition shadow-2xs"
                >
                  {adminAuthBusy ? tr('正在验证…', 'Verifying…') : tr('登录版本管理后台', 'Sign In to Release Admin')}
                </button>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {tr('如需重置管理员密码，可在服务器终端执行 ', 'To reset an admin password, run ')}{' '}
                  <code className="font-mono text-slate-600">{tr('protoflow create-admin <用户名>', 'protoflow create-admin <username>')}</code>
                  {tr('。', ' on the server.')}
                </p>
              </form>
            )}
          </section>
        ) : (
          <>
            {isAdminAuthenticated && <div className="space-y-3">
              <button type="button" onClick={()=>setDiagnosticsOpen(value=>!value)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">{diagnosticsOpen ? tr('收起运行诊断', 'Hide Runtime Diagnostics') : tr('查询运行诊断', 'Runtime Diagnostics')}</button>
              {diagnosticsOpen&&<React.Suspense fallback={<p>{tr('正在加载运行诊断…', 'Loading runtime diagnostics…')}</p>}><RuntimeDiagnosticsPanel token={adminToken}/></React.Suspense>}
            </div>}
            {/* Error Banner */}
            {error && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50/90 p-4 flex items-center justify-between gap-3 text-xs text-rose-700"
              >
                <div className="flex items-center gap-2.5">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{td(error)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadReleases()}
                  className="px-3 py-1 rounded-lg bg-white border border-rose-200 font-semibold hover:bg-rose-100 cursor-pointer shrink-0"
                >
                  {tr('重新加载', 'Reload')}
                </button>
              </div>
            )}

            <ReleaseWorkspace
              releases={isAdminRoute ? releases : releases.filter(release=>release.published)}
              selectedId={selectedReleaseId} onSelect={setSelectedReleaseId}
              admin={isAdminAuthenticated} loading={loading} channel={channelFilter} onChannel={setChannelFilter}
              visitorOS={visitorPlatform.os} busy={mutationBusy} error={mutationError ? td(mutationError) : ''}
              onCreate={openCreateReleaseModal} onEdit={openEditReleaseModal} onUpload={openAssetModal}
              onVisibility={changeVisibility}
              onDelete={release=>void runReleaseAction(async()=>{
                if (!window.confirm(tr(`确定要永久删除版本 v${release.version} 及其全部安装包吗？`, `Permanently delete v${release.version} and all of its installers?`))) return;
                await deleteManagedRelease(adminToken,release.id); await loadReleases(); showToast(tr(`已删除 v${release.version}`, `Deleted v${release.version}`));
              })}
              onApprove={(release,asset)=>void runReleaseAction(async()=>{
                await approveReleaseAsset(adminToken,release.id,asset.id,asset.sha256);
                await loadReleases(release.id); showToast(tr(`已确认并签名 ${asset.fileName}`, `Approved and signed ${asset.fileName}`));
              })}
              onRemove={(release,asset)=>void runReleaseAction(async()=>{
                if (!window.confirm(tr(`确认移除 v${release.version} 的安装包 ${asset.fileName} 吗？`, `Remove installer ${asset.fileName} from v${release.version}?`))) return;
                await deleteReleaseAsset(adminToken,release.id,asset.id);
                await loadReleases(release.id); showToast(tr(`已移除 ${asset.fileName}`, `Removed ${asset.fileName}`));
              })}
            />
            {isAdminAuthenticated && signingPublicKey && <details className="text-xs text-slate-500 border-t border-slate-200 pt-4">
              <summary className="cursor-pointer">{tr('高级信息 · 更新签名公钥', 'Advanced · Update Signing Public Key')}</summary>
              <div className="flex flex-wrap gap-3 items-center pt-3"><code className="break-all">{signingPublicKey}</code><button type="button" onClick={()=>void copyText('pub-key',signingPublicKey)} className="text-blue-600">{copiedKey==='pub-key' ? tr('已复制', 'Copied') : tr('复制公钥', 'Copy Public Key')}</button></div>
            </details>}
          </>
        )}
      </main>

      {/* =====================================================================
          DIALOG 1: Client User Login / Register Dialog (Native <dialog>)
         ===================================================================== */}
      <dialog
        ref={userDialogRef}
        aria-labelledby={`${idPrefix}-user-auth-title`}
        onClose={() => setUserDialogOpen(false)}
        className="m-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-[2px]"
      >
        <div className="p-6 space-y-5 text-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <UserPlus size={18} />
              </span>
              <div>
                <h2 id={`${idPrefix}-user-auth-title`} className="text-sm font-bold text-slate-900">
                  {userAuthMode === 'login' ? tr('客户端用户登录', 'Client User Sign In') : tr('注册客户端用户账号', 'Register Client Account')}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {tr('登录或注册 Alex 客户端用户账号 (client_users)', 'Sign in or create an Alex client account (client_users)')}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label={tr('关闭用户登录窗口', 'Close sign-in dialog')}
              onClick={() => setUserDialogOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200/80">
            <button
              type="button"
              onClick={() => {
                setUserAuthMode('login');
                setUserAuthError('');
              }}
              className={`py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                userAuthMode === 'login' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600'
              }`}
            >
              {tr('账号登录', 'Sign In')}
            </button>
            <button
              type="button"
              onClick={() => {
                setUserAuthMode('register');
                setUserAuthError('');
              }}
              className={`py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                userAuthMode === 'register' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600'
              }`}
            >
              {tr('注册新用户', 'Register')}
            </button>
          </div>

          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (userAuthBusy) return;
              setUserAuthBusy(true);
              setUserAuthError('');
              try {
                const res =
                  userAuthMode === 'login'
                    ? await loginClientUser({
                        username: userUsername.trim(),
                        password: userPassword,
                      })
                    : await registerClientUser({
                        username: userUsername.trim(),
                        displayName: userDisplayName.trim() || userUsername.trim(),
                        password: userPassword,
                      });
                setUserToken(res.token);
                setClientUser(res.user);
                try {
                  localStorage.setItem(USER_TOKEN_KEY, res.token);
                } catch {
                  // ignore
                }
                setUserPassword('');
                setUserDialogOpen(false);
                showToast(
                  userAuthMode === 'login'
                    ? tr(`欢迎回来，${res.user.displayName}！`, `Welcome back, ${res.user.displayName}!`)
                    : tr(`注册成功，欢迎 ${res.user.displayName}！`, `Account created. Welcome, ${res.user.displayName}!`)
                );
              } catch (err) {
                setUserAuthError(err instanceof Error ? err.message : tr('操作失败', 'Operation failed'));
              } finally {
                setUserAuthBusy(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-user-name`} className="block font-semibold text-slate-700">
                {tr('用户名 *', 'Username *')}
              </label>
              <input
                id={`${idPrefix}-user-name`}
                name="username"
                type="text"
                required
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={tr('3–40 位字母、数字或下划线', '3–40 letters, numbers, or underscores')}
                value={userUsername}
                onChange={(e) => {
                  setUserUsername(e.target.value);
                  if (userAuthError) setUserAuthError('');
                }}
                className="w-full rounded-xl border border-slate-300 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none"
              />
            </div>

            {userAuthMode === 'register' && (
              <div className="space-y-1.5">
                <label htmlFor={`${idPrefix}-user-display`} className="block font-semibold text-slate-700">
                  {tr('显示昵称', 'Display Name')}
                </label>
                <input
                  id={`${idPrefix}-user-display`}
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  placeholder={tr('例如：产品设计师张工', 'e.g. Alex Taylor')}
                  value={userDisplayName}
                  onChange={(e) => setUserDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-user-pass`} className="block font-semibold text-slate-700">
                {tr('登录密码 (至少 8 位) *', 'Password (min 8 chars) *')}
              </label>
              <input
                id={`${idPrefix}-user-pass`}
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={userAuthMode === 'login' ? 'current-password' : 'new-password'}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={tr('输入登录密码...', 'Enter password...')}
                value={userPassword}
                onChange={(e) => {
                  setUserPassword(e.target.value);
                  if (userAuthError) setUserAuthError('');
                }}
                className="w-full rounded-xl border border-slate-300 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none"
              />
            </div>

            {userAuthError && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {td(userAuthError)}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUserDialogOpen(false)}
                className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                {tr('取消', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={userAuthBusy}
                className="rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                {userAuthBusy ? tr('正在提交…', 'Submitting…') : userAuthMode === 'login' ? tr('立即登录', 'Sign In') : tr('立即注册', 'Create Account')}
              </button>
            </div>
          </form>
        </div>
      </dialog>

      {/* =====================================================================
          DIALOG 2: Create / Edit Release Metadata Dialog (Native <dialog>)
         ===================================================================== */}
      <dialog
        ref={releaseDialogRef}
        onCancel={e=>{if(releaseSaving)e.preventDefault();}}
        aria-labelledby={`${idPrefix}-release-title`}
        onClose={() => setReleaseDialogOpen(false)}
        className="m-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-[2px]"
      >
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 id={`${idPrefix}-release-title`} className="text-base font-bold text-slate-900">
                {editingRelease ? tr(`编辑 v${editingRelease.version} 的信息`, `Edit v${editingRelease.version} Metadata`) : tr('新建版本草稿', 'New Release Draft')}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {tr('先建草稿，再上传任意平台的安装包。其他平台可以之后补充。', 'Create a draft first, then upload an installer for any platform. Other platforms can be added later.')}
              </p>
            </div>
            <button
              type="button"
              aria-label={tr('关闭版本编辑窗口', 'Close release editor')}
              disabled={releaseSaving} onClick={() => setReleaseDialogOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <form
            className="space-y-4 text-xs"
            onSubmit={async (e) => {
              e.preventDefault();
              if (releaseSaving) return;
              setReleaseSaving(true);
              setReleaseFormError('');
              try {
                const input = releaseInput(releaseForm);
                const saved = editingRelease
                  ? await updateManagedRelease(adminToken, editingRelease.id, input)
                  : await createManagedRelease(adminToken, {...input,published:false});
                setReleaseDialogOpen(false);
                showToast(
                  editingRelease
                    ? tr(`已更新版本 v${saved.version}`, `Updated release v${saved.version}`)
                    : tr(`已创建版本 v${saved.version}，现在可以上传各平台安装包`, `Created release v${saved.version}. You can now upload platform installers.`)
                );
                setChannelFilter('all');
                await loadReleases(saved.id);
              } catch (err) {
                setReleaseFormError(err instanceof Error ? err.message : tr('保存版本失败', 'Failed to save release'));
              } finally {
                setReleaseSaving(false);
              }
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor={`${idPrefix}-ver`} className="block font-semibold text-slate-700">
                  {tr('版本号 *', 'Version *')}
                </label>
                <input disabled={releaseSaving}
                  id={`${idPrefix}-ver`}
                  name="version"
                  type="text"
                  required
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={tr('例如：0.0.6', 'e.g. 0.0.6')}
                  value={releaseForm.version}
                  onChange={(e) => {
                    setReleaseForm((f) => ({ ...f, version: e.target.value }));
                    if (releaseFormError) setReleaseFormError('');
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <fieldset className="space-y-1.5">
                <legend className="font-semibold text-slate-700">{tr('发布通道', 'Channel')}</legend>
                <div className="flex flex-wrap items-center gap-4 pt-1.5">
                  <label htmlFor={`${idPrefix}-ch-stable`} className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input disabled={releaseSaving}
                      id={`${idPrefix}-ch-stable`}
                      type="radio"
                      name="channel"
                      value="stable"
                      checked={releaseForm.channel === 'stable'}
                      onChange={() => setReleaseForm((f) => ({ ...f, channel: 'stable' }))}
                    />
                    <span>{tr('正式版 (Stable)', 'Stable')}</span>
                  </label>
                  <label htmlFor={`${idPrefix}-ch-beta`} className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input disabled={releaseSaving}
                      id={`${idPrefix}-ch-beta`}
                      type="radio"
                      name="channel"
                      value="beta"
                      checked={releaseForm.channel === 'beta'}
                      onChange={() => setReleaseForm((f) => ({ ...f, channel: 'beta' }))}
                    />
                    <span>{tr('测试版 (Beta)', 'Beta')}</span>
                  </label>
                </div>
              </fieldset>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-title`} className="block font-semibold text-slate-700">
                {tr('版本主题（选填）', 'Release Subtitle (Optional)')}
              </label>
              <input disabled={releaseSaving}
                id={`${idPrefix}-title`}
                name="title"
                type="text"
                placeholder={tr('例如：移动审批明细修复，不需要重复填写版本号', 'e.g. Mobile approval detail fixes (do not repeat version number)')}
                value={releaseForm.title}
                onChange={(e) => setReleaseForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-notes`} className="block font-semibold text-slate-700">
                {tr('版本更新说明 (Changelog)', 'Release Notes (Changelog)')}
              </label>
              <textarea disabled={releaseSaving}
                id={`${idPrefix}-notes`}
                name="notes"
                rows={5}
                placeholder={tr('填写本次版本的新增功能、体验优化与问题修复说明...', 'Summarize new features, improvements, and bug fixes in this release...')}
                value={releaseForm.notes}
                onChange={(e) => setReleaseForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 p-3 text-slate-900 leading-relaxed focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="rounded-xl bg-slate-50 p-3 text-slate-600 leading-relaxed">
                {editingRelease?.published
                  ? tr('当前版本已公开。保存信息不会撤回发布，补充安装包后会直接提供下载。', 'This release is public. Saving metadata keeps it published, and newly added installers become downloadable immediately.')
                  : tr('保存为草稿，安装包准备好后在版本详情中发布。', 'Saved as a draft. Publish from the release detail pane once an installer is ready.')}
              </div>

              <label
                htmlFor={`${idPrefix}-mandatory`}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex items-center justify-between gap-2 cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-slate-800">{tr('标记为重要强制更新', 'Mandatory Update')}</div>
                  <div className="text-[11px] text-slate-400">{tr('桌面端启动时主动弹窗提醒升级', 'Prompts desktop users to upgrade on startup')}</div>
                </div>
                <input disabled={releaseSaving}
                  id={`${idPrefix}-mandatory`}
                  name="mandatory"
                  type="checkbox"
                  checked={releaseForm.mandatory}
                  onChange={(e) => setReleaseForm((f) => ({ ...f, mandatory: e.target.checked }))}
                  className="w-4 h-4 shrink-0"
                />
              </label>
            </div>

            {releaseTitleIssue(releaseForm.version,releaseForm.title) && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{releaseTitleIssue(releaseForm.version,releaseForm.title)}</p>}

            {releaseFormError && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {td(releaseFormError)}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={releaseSaving} onClick={() => setReleaseDialogOpen(false)}
                className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 font-medium text-slate-700 cursor-pointer"
              >
                {tr('取消', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={releaseSaving}
                className="rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-5 py-2 font-semibold text-white cursor-pointer"
              >
                {releaseSaving ? tr('正在保存…', 'Saving…') : editingRelease ? tr('保存修改', 'Save Changes') : tr('创建草稿', 'Create Draft')}
              </button>
            </div>
          </form>
        </div>
      </dialog>

      {/* =====================================================================
          DIALOG 3: Upload / Link Platform Installer Asset Dialog (Native <dialog>)
         ===================================================================== */}
      <dialog
        ref={assetDialogRef}
        onCancel={e=>{if(assetSaving)e.preventDefault();}}
        aria-labelledby={`${idPrefix}-asset-title`}
        onClose={() => {
          if (!assetSaving) setAssetDialogOpen(false);
        }}
        className="m-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-[2px]"
      >
        <div className="p-6 space-y-5 text-xs">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 id={`${idPrefix}-asset-title`} className="text-base font-bold text-slate-900">
                {tr(`配置安装包 · v${assetTargetRelease?.version}`, `Configure Installer · v${assetTargetRelease?.version}`)}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {tr('安装包归属当前版本。已公开的版本补包后直接可下载，无需重新发布。', 'Installers belong to this version. Adding packages to a published release makes them downloadable immediately.')}
              </p>
            </div>
            <button
              type="button"
              disabled={assetSaving}
              aria-label={tr('关闭安装包配置窗口', 'Close installer dialog')}
              onClick={() => setAssetDialogOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </div>

          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200/80">
            <button
              type="button"
              disabled={assetSaving}
              onClick={() => {
                setAssetMode('upload');
                setAssetError('');
              }}
              className={`py-2 px-3 rounded-lg font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition ${
                assetMode === 'upload'
                  ? 'bg-white text-blue-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <HardDrive size={14} className="shrink-0" />
              <span>{tr('上传文件到服务端托管', 'Upload Hosted File')}</span>
            </button>
            <button
              type="button"
              disabled={assetSaving}
              onClick={() => {
                setAssetMode('link');
                setAssetError('');
              }}
              className={`py-2 px-3 rounded-lg font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition ${
                assetMode === 'link'
                  ? 'bg-white text-blue-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Link2 size={14} className="shrink-0" />
              <span>{tr('填写外部下载 URL', 'External Download URL')}</span>
            </button>
          </div>

          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!assetTargetRelease || assetSaving) return;
              setAssetSaving(true);
              setAssetError('');
              try {
                if (assetMode === 'upload') {
                  if (!selectedFile) {
                    throw new Error(tr('请先选择要上传的安装包文件', 'Please select an installer file to upload first'));
                  }
                  const issue = assetVersionIssue(selectedFile.name,assetTargetRelease.version);
                  if (issue) throw new Error(issue);
                  setUploadProgress({ percent: 0, loaded: 0, total: selectedFile.size });
                  const uploaded = await uploadReleaseAsset(
                    adminToken,
                    assetTargetRelease.id,
                    selectedFile,
                    { os: assetOS, arch: assetArch, packageType: assetPkg },
                    (percent, loaded, total) => setUploadProgress({ percent, loaded, total })
                  );
                  showToast(tr(`已上传并签名 ${uploaded.fileName} (${formatBytes(uploaded.sizeBytes)})`, `Uploaded and signed ${uploaded.fileName} (${formatBytes(uploaded.sizeBytes)})`));
                } else {
                  const issue = assetVersionIssue(linkFileName.trim(),assetTargetRelease.version);
                  if (issue) throw new Error(issue);
                  const saved = await addReleaseAssetLink(adminToken, assetTargetRelease.id, {
                    os: assetOS,
                    arch: assetArch,
                    packageType: assetPkg,
                    fileName: linkFileName.trim(),
                    externalUrl: linkUrl.trim(),
                    sizeBytes: Number(linkSize) > 0 ? Number(linkSize) : 0,
                    sha256: linkSha256.trim(),
                  });
                  showToast(tr(`已关联并签名安装包 ${saved.fileName}`, `Linked and signed installer ${saved.fileName}`));
                }
                setAssetDialogOpen(false);
                await loadReleases(assetTargetRelease.id);
              } catch (err) {
                setAssetError(err instanceof Error ? err.message : tr('保存安装包失败', 'Failed to save installer'));
              } finally {
                setAssetSaving(false);
                setUploadProgress(null);
              }
            }}
          >
            {assetMode === 'upload' ? (
              <div className="space-y-2">
                <label htmlFor={`${idPrefix}-file`} className="block font-semibold text-slate-700">
                  {tr('选择本地构建产物文件 (.exe / .dmg / .zip / .deb / .AppImage / .tar.gz) *', 'Select local build artifact (.exe / .dmg / .zip / .deb / .AppImage / .tar.gz) *')}
                </label>
                <label
                  htmlFor={`${idPrefix}-file`}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/70 p-5 text-center cursor-pointer transition"
                >
                  <FileArchive size={24} className="text-blue-600" />
                  {selectedFile ? (
                    <div className="space-y-0.5">
                      <div className="font-bold text-slate-900 break-all">{selectedFile.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {tr(`大小：${formatBytes(selectedFile.size)} · 已自动识别目标系统与包格式`, `Size: ${formatBytes(selectedFile.size)} · Target OS & package format auto-detected`)}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-700">{tr('点击选择安装包文件', 'Click to choose installer file')}</div>
                      <div className="text-[11px] text-slate-400">
                        {tr('支持自动从文件名识别系统、架构与格式，服务端将流式计算 SHA-256 并生成 Ed25519 签名', 'Auto-detects OS, arch, and format from filename; server computes SHA-256 and Ed25519 signature')}
                      </div>
                    </div>
                  )}
                  <input disabled={assetSaving}
                    id={`${idPrefix}-file`}
                    name="file"
                    type="file"
                    accept=".exe,.dmg,.zip,.deb,.AppImage,.tar.gz,.tgz"
                    onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
                    className="sr-only"
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor={`${idPrefix}-ext-url`} className="block font-semibold text-slate-700">
                    {tr('外部安装包下载 URL *', 'External Installer Download URL *')}
                  </label>
                  <input disabled={assetSaving}
                    id={`${idPrefix}-ext-url`}
                    name="externalUrl"
                    type="url"
                    required
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={tr('填写当前版本安装包的完整下载地址', 'Full download URL for this installer')}
                    value={linkUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLinkUrl(val);
                      const inferred = inferAssetTargetFromFileName(val);
                      if (inferred) {
                        setAssetOS(inferred.os);
                        setAssetArch(inferred.arch);
                        setAssetPkg(inferred.packageType);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor={`${idPrefix}-ext-name`} className="block font-semibold text-slate-700">
                      {tr('文件名（留空则自动从 URL 提取）', 'Filename (auto-extracted from URL if blank)')}
                    </label>
                    <input disabled={assetSaving}
                      id={`${idPrefix}-ext-name`}
                      name="fileName"
                      type="text"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder={tr('填写实际安装包文件名', 'Actual installer filename')}
                      value={linkFileName}
                      onChange={(e) => setLinkFileName(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`${idPrefix}-ext-size`} className="block font-semibold text-slate-700">
                      {tr('文件准确字节大小 (Bytes) *', 'Exact File Size (Bytes) *')}
                    </label>
                    <input disabled={assetSaving}
                      id={`${idPrefix}-ext-size`}
                      name="sizeBytes"
                      type="text"
                      required
                      inputMode="numeric"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder={tr('例如：125931306', 'e.g. 125931306')}
                      value={linkSize}
                      onChange={(e) => setLinkSize(e.target.value.replace(/\D/g, ''))}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor={`${idPrefix}-ext-sha`} className="block font-semibold text-slate-700">
                    {tr('SHA-256 校验值 (64 位十六进制，必填) *', 'SHA-256 Checksum (64-char hex, required) *')}
                  </label>
                  <input disabled={assetSaving}
                    id={`${idPrefix}-ext-sha`}
                    name="sha256"
                    type="text"
                    required
                    minLength={64}
                    maxLength={64}
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={tr('必填：用于签名与客户端下载完整性强制校验', 'Required for Ed25519 signing and client integrity verification')}
                    value={linkSha256}
                    onChange={(e) => setLinkSha256(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Target OS / Arch / Package Format */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <fieldset disabled={assetSaving} className="space-y-1.5">
                <legend className="font-semibold text-slate-700">{tr('目标操作系统', 'Target OS')}</legend>
                <div className="space-y-1">
                  {(['windows', 'macos', 'linux'] as const).map((osOpt) => (
                    <label
                      key={osOpt}
                      htmlFor={`${idPrefix}-os-${osOpt}`}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer ${
                        assetOS === osOpt ? 'border-blue-500 bg-blue-50/50 font-semibold' : 'border-slate-200'
                      }`}
                    >
                      <input disabled={assetSaving}
                        id={`${idPrefix}-os-${osOpt}`}
                        type="radio"
                        name="os"
                        value={osOpt}
                        checked={assetOS === osOpt}
                        onChange={() => handleOSChange(osOpt)}
                      />
                      <span>{PLATFORM_LABELS[osOpt].shortName}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset disabled={assetSaving} className="space-y-1.5">
                <legend className="font-semibold text-slate-700">{tr('CPU 架构', 'CPU Architecture')}</legend>
                <div className="space-y-1">
                  {(['x64', 'arm64', ...(assetOS === 'macos' ? (['universal'] as const) : [])] as const).map(
                    (archOpt) => (
                      <label
                        key={archOpt}
                        htmlFor={`${idPrefix}-arch-${archOpt}`}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer ${
                          assetArch === archOpt ? 'border-blue-500 bg-blue-50/50 font-semibold' : 'border-slate-200'
                        }`}
                      >
                        <input disabled={assetSaving}
                          id={`${idPrefix}-arch-${archOpt}`}
                          type="radio"
                          name="arch"
                          value={archOpt}
                          checked={assetArch === archOpt}
                          onChange={() => setAssetArch(archOpt)}
                        />
                        <span className="font-mono">{archOpt}</span>
                      </label>
                    )
                  )}
                </div>
              </fieldset>

              <fieldset disabled={assetSaving} className="space-y-1.5">
                <legend className="font-semibold text-slate-700">{tr('安装包格式', 'Package Format')}</legend>
                <div className="space-y-1">
                  {PLATFORM_LABELS[assetOS].packages.map((pkgOpt) => (
                    <label
                      key={pkgOpt}
                      htmlFor={`${idPrefix}-pkg-${pkgOpt}`}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer ${
                        assetPkg === pkgOpt ? 'border-blue-500 bg-blue-50/50 font-semibold' : 'border-slate-200'
                      }`}
                    >
                      <input disabled={assetSaving}
                        id={`${idPrefix}-pkg-${pkgOpt}`}
                        type="radio"
                        name="packageType"
                        value={pkgOpt}
                        checked={assetPkg === pkgOpt}
                        onChange={() => setAssetPkg(pkgOpt)}
                      />
                      <span className="font-mono">.{pkgOpt}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            {assetTargetRelease?.assets.some(asset=>asset.os===assetOS&&asset.arch===assetArch&&asset.packageType===assetPkg) && <p className="rounded-lg bg-amber-50 p-3 text-amber-800">{tr('当前版本已有此平台、架构和格式的安装包，保存将替换该包。其他安装包保持不变。', 'An installer for this OS, architecture, and format already exists in this release and will be replaced. Other installers remain unchanged.')}</p>}
            {assetTargetRelease && assetVersionIssue(assetMode === 'upload' ? selectedFile?.name ?? '' : linkFileName,assetTargetRelease.version) && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-800">{assetVersionIssue(assetMode === 'upload' ? selectedFile?.name ?? '' : linkFileName,assetTargetRelease.version)}</p>}

            {uploadProgress && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-blue-800">
                  <span>{tr(`正在上传并计算 SHA-256… (${uploadProgress.percent}%)`, `Uploading & computing SHA-256… (${uploadProgress.percent}%)`)}</span>
                  <span>
                    {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}
                  </span>
                </div>
                <progress
                  max={100}
                  value={uploadProgress.percent}
                  className="w-full h-2 rounded-full overflow-hidden"
                >
                  {uploadProgress.percent}%
                </progress>
              </div>
            )}

            {assetError && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {td(assetError)}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={assetSaving}
                onClick={() => setAssetDialogOpen(false)}
                className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 font-medium text-slate-700 cursor-pointer disabled:opacity-40"
              >
                {tr('取消', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={assetSaving}
                className="rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-5 py-2 font-semibold text-white flex items-center gap-1.5 cursor-pointer"
              >
                {assetMode === 'upload' ? <Upload size={14} /> : <ExternalLink size={14} />}
                <span>{assetSaving ? tr('正在处理…', 'Processing…') : assetMode === 'upload' ? tr('开始上传并保存', 'Upload & Save') : tr('保存下载链接', 'Save Download Link')}</span>
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
};
