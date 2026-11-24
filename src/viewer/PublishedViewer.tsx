import { publishedMenuIndex } from '../services/publishedSitemap';
import { PublishedSitemap, PublishedMenuPlaceholder } from './PublishedSitemap';
import { emptySitemapOverrides } from '../proto/sitemap';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Blocks, CheckCircle2, ChevronRight, LockKeyhole, Moon, PanelLeft, RotateCcw, ShieldCheck, Smartphone, Sun } from 'lucide-react';
import { McpConnectModal } from '../components/McpConnectModal';
import type { Publication } from '../services/publishingClient';
import { useResolvedTheme } from '../proto/registry/AntdSurface';
import { MobileViewportShell } from '../proto/mobile/MobileViewportShell';
import { resolveMobileAppearance, ToastStatusIcon, type MobileAppearance } from '../proto/mobile/components';
import { MOBILE_DEVICE_LIST, type MobileDevicePreset } from '../proto/mobile/types';
import { normalizePublishedSnapshot, type ReadablePublishedSnapshot, type PublishedPage } from '../services/publishedSnapshot';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { NodeView, ScopeProvider } from '../proto/renderer/NodeView';
import { findOverlay, RuntimeProvider, useRuntimeController } from '../proto/runtime/runtime';
import type { Row } from '../proto/runtime/mock';
import { PublishedNotesButton, PublishedNotesProvider } from './PublishedNotes';
import { PublishedProjectNotes } from './PublishedProjectNotes';
import { ThemeSwitch, useThemePreference } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { AlexLogo } from '../components/AlexLogo';
import { ReleaseCenterView } from './ReleaseCenterView';
import { getAcceptLanguageHeader, isEnLocale, td, tr as trRuntime, useI18n } from '../i18n';

export function isReleaseAdminRoute(pathname = window.location.pathname, search = window.location.search): boolean {
  if (/^\/(?:releases|updates)\/admin(?:\/|$)/.test(pathname)) return true;
  const route = new URLSearchParams(search).get('route');
  return route === 'releases-admin';
}

export function isReleaseCenterRoute(pathname = window.location.pathname, search = window.location.search): boolean {
  if (/^\/(?:releases|updates)(?:\/|$)/.test(pathname)) return true;
  const route = new URLSearchParams(search).get('route');
  return route === 'releases' || route === 'updates' || route === 'releases-admin';
}

export function hydratePublishedSnapshot(snapshot: unknown) {
  const copy = normalizePublishedSnapshot(snapshot);
  // This runs only in the separate viewer entry point. No archive/recent-project
  // loader, persistent editor storage or Hermes bootstrap is invoked.
  usePageStore.setState({ pageSources: {}, designerPages: [], designerFolders: [], sitemapBase: [], sitemapOverrides: emptySitemapOverrides(), tableRows: copy.tableRows, history: {}, compositeBlocks: [] });
  useProtoStore.setState({ dbTables: copy.tables, activePageId: copy.entryPageId, navigationSource: null, stickyNotes: [], suppliers: [], purchaseOrderItems: [], acceptanceOrders: [], closedLoopIssues: [], draftAcceptanceLines: [], showAllComponentPins: false, isWebPlayerMode: true });
}

export function PublishedPageView({ page, canNavigate, publishedHeader }: { page: PublishedPage; canNavigate?: (pageId: string) => boolean; publishedHeader?: (id:string) => readonly string[] | undefined }) {
  const { tr } = useI18n();
  const runtime = useRuntimeController(page.doc, page.pageId, false, canNavigate, publishedHeader);
  const isMobile = page.doc.root.type === 'MobilePage';
  const workspaceTheme = useResolvedTheme();
  const [previewAppearance, setPreviewAppearance] = useState<MobileAppearance | null>(null);
  useEffect(() => {
    setPreviewAppearance(null);
  }, [workspaceTheme]);
  const effectiveAppearance = resolveMobileAppearance(
    page.doc.root.props.appearance,
    workspaceTheme,
    previewAppearance,
  );
  const [device, setDevice] = useState<MobileDevicePreset>('iphone');
  const [isNarrowScreen, setIsNarrowScreen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 540 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onResize = () => setIsNarrowScreen(window.innerWidth <= 540);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const overlayNodes = runtime.overlays.map((entry, index) => {
    const node = findOverlay(page.doc, entry.id);
    return node ? (
      <ScopeProvider
        key={entry.key}
        value={{
          row: entry.params.row as Row | undefined,
          tableId: entry.params.tableId as string | undefined,
          params: entry.params,
          overlayIndex: index,
        }}
      >
        <NodeView node={node} live />
      </ScopeProvider>
    ) : null;
  });

  return <RuntimeProvider value={runtime}>
    {isMobile ? (
      <div className={isNarrowScreen ? 'w-full h-full' : 'py-6 px-4 flex flex-col items-center gap-3'}>
        {!isNarrowScreen && (
          <div className="inline-flex items-center gap-1 bg-white border border-slate-200/80 px-2 py-1 rounded-full shadow-xs text-xs">
            {MOBILE_DEVICE_LIST.map((spec) => {
              const active = device === spec.id;
              return (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => setDevice(spec.id)}
                  className={`px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1 cursor-pointer transition ${
                    active
                      ? 'bg-violet-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Smartphone size={12} />
                  <span>{spec.label}</span>
                  <span className="text-[10px] opacity-75 font-mono">{spec.width}</span>
                </button>
              );
            })}
            <span className="h-3.5 w-px bg-slate-200 mx-0.5" />
            <button
              type="button"
              onClick={() => setPreviewAppearance(effectiveAppearance === 'dark' ? 'light' : 'dark')}
              title={tr('切换移动端屏幕明暗预览', 'Toggle mobile screen light/dark preview')}
              className="px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1 text-slate-600 hover:bg-slate-100 cursor-pointer transition"
            >
              {effectiveAppearance === 'dark' ? (
                <>
                  <Moon size={12} className="text-violet-600" />
                  <span>{tr('深色', 'Dark')}</span>
                </>
              ) : (
                <>
                  <Sun size={12} className="text-amber-500" />
                  <span>{tr('浅色', 'Light')}</span>
                </>
              )}
            </button>
          </div>
        )}
        <MobileViewportShell
          device={device}
          appearance={page.doc.root.props.appearance}
          previewAppearance={previewAppearance}
          accent={page.doc.root.props.accent} surfaceBg={page.doc.root.props.surfaceBg}
          framed={!isNarrowScreen}
          fullBleed={isNarrowScreen}
          runtimeFeedback={{
            toasts: runtime.toasts,
            confirmState: runtime.confirmState,
            onResolveConfirm: runtime.resolveConfirm,
          }}
          overlaySlot={<>{overlayNodes}</>}
        >
          <NodeView node={page.doc.root} />
        </MobileViewportShell>
      </div>
    ) : (
      <>
        <NodeView node={page.doc.root} />
        {overlayNodes}
      </>
    )}
    {!isMobile && runtime.confirmState && (
      <div role="dialog" aria-modal="true" aria-label={tr('操作确认', 'Confirm Action')} className="fixed inset-0 z-[90] bg-slate-900/45 backdrop-blur-[2px] flex items-center justify-center p-5">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 max-w-sm w-full shadow-2xl space-y-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-bold text-slate-900">{tr('操作确认', 'Confirm Action')}</h2>
            <p className="text-xs leading-5 text-slate-600">{runtime.confirmState.message}</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => runtime.resolveConfirm(false)} className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg cursor-pointer transition">{tr('取消', 'Cancel')}</button>
            <button type="button" onClick={() => runtime.resolveConfirm(true)} className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer transition">{tr('确认执行', 'Confirm')}</button>
          </div>
        </div>
      </div>
    )}
    {!isMobile && (
      <div role="status" className="fixed bottom-5 right-5 z-[100] space-y-2 pointer-events-none">
        {runtime.toasts.map(t => (
          <p key={t.id} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/95 backdrop-blur-xs px-4 py-2.5 text-white text-xs font-medium shadow-xl">
            <ToastStatusIcon type={t.type} size={14} />
            {t.message}
          </p>
        ))}
      </div>
    )}
  </RuntimeProvider>;
}

async function viewRequest(id: string, password?: string, signal?: AbortSignal) {
  const headers = isEnLocale()
    ? {
        ...(password === undefined ? {} : { 'Content-Type': 'application/json' }),
        'Accept-Language': getAcceptLanguageHeader(),
      }
    : password === undefined
      ? undefined
      : { 'Content-Type': 'application/json' };
  const response = await fetch(`/api/v1/view/${id}${password === undefined ? '' : '/open'}`, { method: password === undefined ? 'GET' : 'POST', headers, body: password === undefined ? undefined : JSON.stringify({ password }), cache: 'no-store', credentials: 'omit', signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? td(data.error) : trRuntime('无法读取分享，请稍后重试', 'Unable to load share. Please try again later.'));
  if (!data) throw new Error(trRuntime('分享服务返回了无效内容', 'Share service returned an invalid payload'));
  return data;
}

export function PublishedViewer() {
  const [releaseRoute, setReleaseRoute] = useState(() => isReleaseCenterRoute());
  const [adminRoute, setAdminRoute] = useState(() => isReleaseAdminRoute());
  useEffect(() => {
    const onPopState = () => {
      setReleaseRoute(isReleaseCenterRoute());
      setAdminRoute(isReleaseAdminRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  if (releaseRoute) {
    return (
      <ReleaseCenterView
        isAdminRoute={adminRoute}
        onNavigateRoute={(nextAdmin) => {
          const target = nextAdmin ? '/releases/admin' : '/releases';
          window.history.pushState(null, '', target);
          setReleaseRoute(true);
          setAdminRoute(nextAdmin);
        }}
      />
    );
  }
  return <PublishedShareViewer onOpenReleaseCenter={() => {
    window.history.pushState(null, '', '/releases');
    setReleaseRoute(true);
    setAdminRoute(false);
  }} />;
}

function getStaticDemoManifestUrl(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector('meta[name="protoflow-static-demo"]')?.getAttribute('content')?.trim() || '';
}

interface StaticDemoManifest {
  version?: number;
  snapshots?: {
    zh?: string;
    en?: string;
  };
}

function PublishedShareViewer({ onOpenReleaseCenter }: { onOpenReleaseCenter: () => void }) {
  const { tr, locale } = useI18n();
  const staticDemoUrl = getStaticDemoManifestUrl();
  const isStaticDemo = Boolean(staticDemoUrl);
  const theme = useThemePreference();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [snapshot, setSnapshot] = useState<ReadablePublishedSnapshot | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [mcpOpen, setMcpOpen] = useState(false);
  const [reset, setReset] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 540);
  const menuIndex = useMemo(() => publishedMenuIndex(snapshot && snapshot.formatVersion !== 2 ? snapshot.sitemap : []), [snapshot]);
  const canVisit = (content: ReadablePublishedSnapshot, pageId: string) => content.formatVersion !== 2 ? publishedMenuIndex(content.sitemap).has(pageId) : content.pages.some(p => p.pageId === pageId);
  const activeId = useProtoStore(s => s.activePageId);
  const id = /^\/p\/([A-Za-z0-9_-]{20,80})\/?$/.exec(window.location.pathname)?.[1];
  const accept = (data: any) => {
    const content = normalizePublishedSnapshot(data.snapshot);
    if (data.publication?.id !== id || data.publication.projectId !== content.projectId) throw new Error(trRuntime('分享内容与链接不一致', 'Shared payload does not match link'));
    hydratePublishedSnapshot(content);
    let pageId: string;
    try { pageId = decodeURIComponent(window.location.hash.slice(1)); } catch { pageId = ''; }
    if (pageId && canVisit(content, pageId)) useProtoStore.getState().setActivePage(pageId);
    setPublication(data.publication); setSnapshot(content); setExpanded({}); setPassword('');
    document.title = `${content.title} · Alex`;
  };
  useEffect(() => {
    const abort = new AbortController(); let alive = true;
    const load = async () => {
      try {
        if (isStaticDemo) {
          setBusy(true);
          setError('');
          const manifestRes = await fetch(staticDemoUrl, { cache: 'no-cache', credentials: 'omit', signal: abort.signal });
          if (!manifestRes.ok) throw new Error(trRuntime('无法加载演示清单，请稍后重试', 'Unable to load demo manifest. Please try again later.'));
          const manifest = (await manifestRes.json()) as StaticDemoManifest;
          const relSnapshot = locale === 'en-US'
            ? (manifest?.snapshots?.en || manifest?.snapshots?.zh)
            : (manifest?.snapshots?.zh || manifest?.snapshots?.en);
          if (!relSnapshot || typeof relSnapshot !== 'string') {
            throw new Error(trRuntime('演示清单缺少有效的快照地址', 'Demo manifest is missing a valid snapshot path'));
          }
          const resolvedManifest = new URL(staticDemoUrl, window.location.href);
          const snapshotUrl = new URL(relSnapshot, resolvedManifest).toString();
          const snapRes = await fetch(snapshotUrl, { cache: 'no-cache', credentials: 'omit', signal: abort.signal });
          if (!snapRes.ok) throw new Error(trRuntime('无法加载演示快照，请稍后重试', 'Unable to load demo snapshot. Please try again later.'));
          const rawSnapshot = await snapRes.json();
          if (!alive) return;
          const content = normalizePublishedSnapshot(rawSnapshot);
          const previousActiveId = useProtoStore.getState().activePageId;
          hydratePublishedSnapshot(content);
          let hashPageId = '';
          try { hashPageId = decodeURIComponent(window.location.hash.slice(1)); } catch { hashPageId = ''; }
          const preservedPageId = hashPageId && canVisit(content, hashPageId)
            ? hashPageId
            : previousActiveId && canVisit(content, previousActiveId)
              ? previousActiveId
              : content.entryPageId;
          if (preservedPageId) useProtoStore.getState().setActivePage(preservedPageId);
          const nowIso = new Date().toISOString();
          setPublication({
            id: 'static-demo',
            projectId: content.projectId,
            title: content.title,
            version: typeof manifest.version === 'number' ? manifest.version : 1,
            passwordProtected: false,
            expiresAt: null,
            revokedAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
            shareUrl: `${window.location.origin}${window.location.pathname}`,
          });
          setSnapshot(content);
          setExpanded({});
          setPassword('');
          document.title = `${content.title} · ProtoFlow AI`;
          return;
        }
        if (!id) throw new Error(trRuntime('分享链接无效，请使用发布者提供的完整链接', 'Invalid share link. Please use the complete URL provided by the publisher.'));
        const meta = await viewRequest(id, undefined, abort.signal);
        if (meta.id !== id || typeof meta.passwordProtected !== 'boolean') throw new Error(trRuntime('分享记录格式无效', 'Invalid share metadata format'));
        if (!alive) return; setPublication(meta);
        if (!meta.passwordProtected) { const data = await viewRequest(id, '', abort.signal); if (alive) accept(data); }
      } catch (e) { if (alive && !abort.signal.aborted) setError(e instanceof Error ? e.message : trRuntime('无法加载分享', 'Unable to load share')); }
      finally { if (alive) setBusy(false); }
    };
    void load(); return () => { alive = false; abort.abort(); };
  }, [id, isStaticDemo, staticDemoUrl, isStaticDemo ? locale : 'static']);
  useEffect(() => {
    if (!snapshot) return;
    const change = () => {
      let pageId: string; try { pageId = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (canVisit(snapshot, pageId)) useProtoStore.getState().setActivePage(pageId);
    };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, [snapshot]);
  useEffect(() => {
    if (snapshot && canVisit(snapshot, activeId) && window.location.hash !== `#${encodeURIComponent(activeId)}`) window.history.replaceState(null, '', `#${encodeURIComponent(activeId)}`);
  }, [activeId, snapshot]);

  useEffect(() => {
    const ancestors = menuIndex.get(activeId)?.ancestors;
    if (ancestors?.length) setExpanded(current => {
      if (ancestors.every(id => current[id] === true)) return current;
      const next = { ...current }; for (const id of ancestors) next[id] = true; return next;
    });
  }, [activeId, menuIndex]);

  if (!snapshot) {
    return (
      <main className="min-h-screen bg-slate-50 relative overflow-hidden flex items-center justify-center p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.09),transparent_60%)]"
        />
        <div className="relative z-10 w-full max-w-[440px] rounded-2xl border border-slate-200/90 bg-white p-7 sm:p-8 shadow-xl shadow-slate-900/5 space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <AlexLogo size={40} className="rounded-xl shadow-xs shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-slate-900 tracking-tight">
                  {isStaticDemo ? 'ProtoFlow AI' : 'Alex'}
                </div>
                <div className="text-[11px] text-slate-500">{tr('在线交互原型演示沙盒', 'Interactive Prototype Sandbox')}</div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 shrink-0">
              {publication?.passwordProtected ? <LockKeyhole size={11} /> : <ShieldCheck size={11} />}
              {publication?.passwordProtected ? tr('密码保护', 'Protected') : tr('在线分享', 'Live Share')}
              {publication?.version ? ` · v${publication.version}` : ''}
            </span>
          </div>

          <div className="space-y-1.5 border-t border-slate-100 pt-5">
            <h1 className="text-lg font-bold text-slate-900 tracking-tight break-words">
              {publication?.title ?? tr('在线原型', 'Interactive Prototype')}
            </h1>
            <p className="text-xs text-slate-500 leading-5">
              {tr('支持页面目录跳转、表单联动、数据流转与需求便签查阅', 'Supports sitemap navigation, interactive forms, data flows, and spec annotations')}
            </p>
          </div>

          {busy && !publication?.passwordProtected ? (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-5 flex items-center justify-center gap-2.5">
              <span className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin shrink-0" />
              <p role="status" className="text-xs font-medium text-slate-600">{tr('正在加载分享…', 'Loading shared prototype…')}</p>
            </div>
          ) : publication?.passwordProtected ? (
            <form
              className="space-y-4"
              onSubmit={async event => {
                event.preventDefault();
                if (!id || busy) return;
                setBusy(true);
                setError('');
                try {
                  accept(await viewRequest(id, password));
                } catch (e) {
                  setError(e instanceof Error ? e.message : tr('无法打开分享', 'Unable to unlock share'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <LockKeyhole size={13.5} className="text-blue-600 shrink-0" />
                  {tr('请输入发布者提供的访问密码。', 'Please enter the access password provided by the publisher.')}
                </p>
                <div className="relative">
                  <LockKeyhole size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    aria-label={tr('访问密码', 'Access password')}
                    type="password"
                    required
                    autoFocus
                    autoComplete="current-password"
                    placeholder={tr('输入演示访问密码...', 'Enter access password...')}
                    maxLength={128}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:ring-3 focus:ring-blue-500/15 focus:outline-none transition"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 text-white font-semibold py-2.5 px-4 text-sm shadow-xs shadow-blue-600/20 flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <span>{busy ? tr('正在验证密码…', 'Verifying password…') : tr('查看原型', 'Open Prototype')}</span>
                <ArrowRight size={15} />
              </button>
            </form>
          ) : null}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-3.5 py-2.5 flex items-start gap-2">
              <AlertCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
              <p role="alert" className="text-xs font-medium text-rose-700 leading-5">{td(error)}</p>
            </div>
          )}

          {!busy && error && !publication?.passwordProtected && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium py-2.5 text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <RotateCcw size={13.5} />
                {tr('重新加载', 'Reload')}
              </button>
              <button
                type="button"
                onClick={onOpenReleaseCenter}
                className="w-full rounded-xl bg-blue-50 hover:bg-blue-100/80 border border-blue-200 text-blue-700 font-semibold py-2.5 px-3 text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <span>{tr('前往桌面端版本发布与下载中心 (/releases)', 'Go to Desktop Release & Download Center (/releases)')}</span>
                <ArrowRight size={13.5} className="shrink-0" />
              </button>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>{isStaticDemo ? tr('ProtoFlow AI · 在线演示', 'ProtoFlow AI · Live Demo') : tr('Alex · 在线分享', 'Alex · Live Share')}</span>
            <div className="flex items-center gap-1.5">
              <ThemeSwitch {...theme} />
              <LanguageSwitch />
            </div>
            <span>{tr('演示操作仅影响当前浏览', 'Demo actions stay in this tab')}</span>
          </div>
        </div>
      </main>
    );
  }

  const page = snapshot.pages.find(p => p.pageId === activeId);
  const hasAxureCanvas = page?.doc.root.children.some(
    c => c.kind === 'node' && (c.type === 'AxureCanvas' || c.type === 'FigmaCanvas'),
  );
  const activeMenuTitle = page?.title ?? menuIndex.get(activeId)?.item.title;

  return (
    <PublishedNotesProvider key={`${activeId}:${reset}`} page={page} notes={snapshot.stickyNotes}>
      <div className="h-dvh flex flex-col bg-slate-100/80 text-slate-900 overflow-hidden">
        <header className="shrink-0 h-12 border-b border-slate-200/90 bg-white flex items-center justify-between gap-3 px-3.5 sm:px-4 z-20">
          <div className="min-w-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(c => !c)}
              aria-label={sidebarCollapsed ? tr('展开左侧目录', 'Expand sidebar') : tr('收起左侧目录', 'Collapse sidebar')}
              title={sidebarCollapsed ? tr('展开左侧目录', 'Expand sidebar') : tr('收起左侧目录', 'Collapse sidebar')}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer shrink-0 ${
                !sidebarCollapsed
                  ? 'text-slate-800 bg-slate-100 hover:bg-slate-200/70'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              <PanelLeft size={15} />
            </button>

            <div className="h-4 w-px bg-slate-200 shrink-0" />

            {isStaticDemo ? (
              <a
                href="/"
                className="flex items-center gap-2 min-w-0 hover:opacity-85 transition"
                title={tr('返回 ProtoFlow AI 官网', 'Back to ProtoFlow AI Home')}
              >
                <AlexLogo size={22} className="rounded-md shadow-2xs shrink-0" />
                <div className="min-w-0 flex items-center gap-2">
                  <h1 className="text-xs sm:text-[13px] font-bold text-slate-900 truncate max-w-[160px] sm:max-w-[280px]">
                    {snapshot.title}
                  </h1>
                  <span className="hidden md:inline-flex items-center rounded-md bg-blue-50 border border-blue-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 shrink-0">
                    {tr('在线交互沙盒', 'Live Sandbox')}
                  </span>
                </div>
              </a>
            ) : (
              <>
                <AlexLogo size={22} className="rounded-md shadow-2xs shrink-0" />

                <div className="min-w-0 flex items-center gap-2">
                  <h1 className="text-xs sm:text-[13px] font-bold text-slate-900 truncate max-w-[160px] sm:max-w-[280px]">
                    {snapshot.title}
                  </h1>
                  <span className="hidden md:inline-flex items-center rounded-md bg-blue-50 border border-blue-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 shrink-0">
                    {tr(`版本 ${publication?.version ?? 1}`, `v${publication?.version ?? 1}`)}
                  </span>
                </div>
              </>
            )}

            {activeMenuTitle && (
              <>
                <ChevronRight size={13} className="hidden sm:block text-slate-400 shrink-0" />
                <span className="hidden sm:inline-block text-[11px] font-medium text-slate-600 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200/80 truncate max-w-[220px]">
                  {activeMenuTitle}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <p className="hidden xl:flex items-center gap-1.5 text-[11px] text-slate-400 mr-1 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {isStaticDemo
                ? tr('在线交互演示 · 零下载纯浏览器沙盒', 'Interactive Live Demo · Browser Sandbox')
                : tr(
                    `在线原型 · 版本 ${publication?.version} · 演示操作仅影响当前浏览`,
                    `Live Prototype · v${publication?.version} · Demo actions stay local`
                  )}
            </p>
            <ThemeSwitch {...theme} />
            <LanguageSwitch />
            <PublishedProjectNotes
              snapshot={snapshot}
              activePageId={activeId}
              onNavigate={pageId => {
                window.location.hash = encodeURIComponent(pageId);
                useProtoStore.getState().setActivePage(pageId);
              }}
            />
            <PublishedNotesButton />
            {isStaticDemo ? (
              <>
                <a
                  href="/mcp/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden sm:inline-flex gap-1.5 items-center rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100/80 text-blue-700 font-medium px-2.5 py-1.5 text-xs shrink-0 transition shadow-2xs"
                >
                  <Blocks size={13.5} aria-hidden="true" />
                  <span>{tr('MCP 接入指南', 'MCP Guide')}</span>
                </a>
                <a
                  href="/#download"
                  className="inline-flex gap-1.5 items-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold px-2.5 py-1.5 text-xs shrink-0 transition shadow-2xs"
                >
                  <span>{tr('下载桌面端', 'Download App')}</span>
                </a>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setMcpOpen(true)}
                className="flex gap-1.5 items-center rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100/80 text-blue-700 font-medium px-2.5 py-1.5 text-xs shrink-0 cursor-pointer transition shadow-2xs"
              >
                <Blocks size={13.5} aria-hidden="true" />
                <span>{tr('MCP 接入', 'MCP')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                hydratePublishedSnapshot(snapshot);
                setReset(n => n + 1);
              }}
              className="flex gap-1.5 items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 font-medium px-2.5 py-1.5 text-xs shrink-0 cursor-pointer transition shadow-2xs"
            >
              <RotateCcw size={13.5} className="text-slate-500" />
              {tr('重置演示', 'Reset Demo')}
            </button>
          </div>
        </header>

        <div className="min-h-0 flex flex-1 flex-col sm:flex-row overflow-hidden">
          {!sidebarCollapsed && (
            <PublishedSitemap
              snapshot={snapshot}
              activeId={activeId}
              expanded={expanded}
              onToggle={(folderId, open) => setExpanded(current => ({ ...current, [folderId]: open }))}
              onSelect={pageId => {
                window.location.hash = encodeURIComponent(pageId);
                useProtoStore.getState().setActivePage(pageId);
              }}
            />
          )}
          <main data-testid="published-content" style={hasAxureCanvas ? { contain:'layout' } : undefined}
            className={`min-h-0 min-w-0 flex-1 ${hasAxureCanvas ? 'overflow-hidden' : 'overflow-auto p-3 sm:p-5'} ${page?.doc.root.type === 'MobilePage' ? 'max-[540px]:p-0' : ''}`}>
            <div className={hasAxureCanvas ? 'h-full overflow-auto p-3 sm:p-5' : 'contents'}>
            <div
              data-testid="published-canvas"
              className={
                page?.doc.root.type === 'MobilePage'
                  ? 'pf-mobile-canvas-stage w-full rounded-xl border border-slate-200/90 shadow-xs min-h-full p-4 sm:p-6 max-[540px]:h-full max-[540px]:p-0 max-[540px]:border-0 max-[540px]:rounded-none'
                  : 'pf-paper w-full rounded-xl border border-slate-200/90 bg-white shadow-xs min-h-full p-4 sm:p-6'
              }
            >
              {page ? (
                <PublishedPageView key={`${page.pageId}:${reset}`} page={page} canNavigate={id => canVisit(snapshot,id)}
                  publishedHeader={id => snapshot.pages.find(p => p.pageId === id)?.doc.header} />
              ) : menuIndex.has(activeId) ? (
                <PublishedMenuPlaceholder item={menuIndex.get(activeId)!.item} />
              ) : (
                <div role="alert" className="p-8 text-sm text-slate-500">{tr('目标页面未发布，请从左侧目录选择页面。', 'Target page is not published. Please select a page from the sidebar.')}</div>
              )}
            </div>
            </div>
          </main>
        </div>
        {!isStaticDemo && (
          <McpConnectModal
            open={mcpOpen}
            onClose={() => setMcpOpen(false)}
            initialTab="remote"
            viewerShareContext={{
              title: snapshot.title,
              shareUrl: publication?.shareUrl || `${window.location.origin}${window.location.pathname}`,
              passwordProtected: Boolean(publication?.passwordProtected),
            }}
          />
        )}
      </div>
    </PublishedNotesProvider>
  );
}
