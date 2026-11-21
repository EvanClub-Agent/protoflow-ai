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
import { AlexLogo } from '../components/AlexLogo';
import { ReleaseCenterView } from './ReleaseCenterView';

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
              title="切换移动端屏幕明暗预览"
              className="px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1 text-slate-600 hover:bg-slate-100 cursor-pointer transition"
            >
              {effectiveAppearance === 'dark' ? (
                <>
                  <Moon size={12} className="text-violet-600" />
                  <span>深色</span>
                </>
              ) : (
                <>
                  <Sun size={12} className="text-amber-500" />
                  <span>浅色</span>
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
      <div role="dialog" aria-modal="true" aria-label="操作确认" className="fixed inset-0 z-[90] bg-slate-900/45 backdrop-blur-[2px] flex items-center justify-center p-5">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 max-w-sm w-full shadow-2xl space-y-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-bold text-slate-900">操作确认</h2>
            <p className="text-xs leading-5 text-slate-600">{runtime.confirmState.message}</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => runtime.resolveConfirm(false)} className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg cursor-pointer transition">取消</button>
            <button type="button" onClick={() => runtime.resolveConfirm(true)} className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer transition">确认执行</button>
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
  const response = await fetch(`/api/v1/view/${id}${password === undefined ? '' : '/open'}`, { method: password === undefined ? 'GET' : 'POST', headers: password === undefined ? undefined : { 'Content-Type': 'application/json' }, body: password === undefined ? undefined : JSON.stringify({ password }), cache: 'no-store', credentials: 'omit', signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '无法读取分享，请稍后重试');
  if (!data) throw new Error('分享服务返回了无效内容');
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

function PublishedShareViewer({ onOpenReleaseCenter }: { onOpenReleaseCenter: () => void }) {
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
    if (data.publication?.id !== id || data.publication.projectId !== content.projectId) throw new Error('分享内容与链接不一致');
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
        if (!id) throw new Error('分享链接无效，请使用发布者提供的完整链接');
        const meta = await viewRequest(id, undefined, abort.signal);
        if (meta.id !== id || typeof meta.passwordProtected !== 'boolean') throw new Error('分享记录格式无效');
        if (!alive) return; setPublication(meta);
        if (!meta.passwordProtected) { const data = await viewRequest(id, '', abort.signal); if (alive) accept(data); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : '无法加载分享'); }
      finally { if (alive) setBusy(false); }
    };
    void load(); return () => { alive = false; abort.abort(); };
  }, [id]);
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
        <div className="relative z-10 w-full max-w-[420px] rounded-2xl border border-slate-200/90 bg-white p-7 sm:p-8 shadow-xl shadow-slate-900/5 space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlexLogo size={40} className="rounded-xl shadow-xs shrink-0" />
              <div>
                <div className="text-xs font-extrabold text-slate-900 tracking-tight">Alex</div>
                <div className="text-[11px] text-slate-500">在线交互原型演示沙盒</div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 shrink-0">
              {publication?.passwordProtected ? <LockKeyhole size={11} /> : <ShieldCheck size={11} />}
              {publication?.passwordProtected ? '密码保护' : '在线分享'}
              {publication?.version ? ` · v${publication.version}` : ''}
            </span>
          </div>

          <div className="space-y-1.5 border-t border-slate-100 pt-5">
            <h1 className="text-lg font-bold text-slate-900 tracking-tight break-words">
              {publication?.title ?? '在线原型'}
            </h1>
            <p className="text-xs text-slate-500 leading-5">
              支持页面目录跳转、表单联动、数据流转与需求便签查阅
            </p>
          </div>

          {busy && !publication?.passwordProtected ? (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-5 flex items-center justify-center gap-2.5">
              <span className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin shrink-0" />
              <p role="status" className="text-xs font-medium text-slate-600">正在加载分享…</p>
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
                  setError(e instanceof Error ? e.message : '无法打开分享');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <LockKeyhole size={13.5} className="text-blue-600 shrink-0" />
                  请输入发布者提供的访问密码。
                </p>
                <div className="relative">
                  <LockKeyhole size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    aria-label="访问密码"
                    type="password"
                    required
                    autoFocus
                    autoComplete="current-password"
                    placeholder="输入演示访问密码..."
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
                <span>{busy ? '正在验证密码…' : '查看原型'}</span>
                <ArrowRight size={15} />
              </button>
            </form>
          ) : null}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-3.5 py-2.5 flex items-start gap-2">
              <AlertCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
              <p role="alert" className="text-xs font-medium text-rose-700 leading-5">{error}</p>
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
                重新加载
              </button>
              <button
                type="button"
                onClick={onOpenReleaseCenter}
                className="w-full rounded-xl bg-blue-50 hover:bg-blue-100/80 border border-blue-200 text-blue-700 font-semibold py-2.5 text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <span>前往桌面端版本发布与下载中心 (/releases)</span>
                <ArrowRight size={13.5} />
              </button>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Alex · 在线分享</span>
            <ThemeSwitch {...theme} />
            <span>演示操作仅影响当前浏览</span>
          </div>
        </div>
      </main>
    );
  }

  const page = snapshot.pages.find(p => p.pageId === activeId);
  const hasAxureCanvas = page?.doc.root.children.some(c => c.kind === 'node' && c.type === 'AxureCanvas');
  const activeMenuTitle = page?.title ?? menuIndex.get(activeId)?.item.title;

  return (
    <PublishedNotesProvider key={`${activeId}:${reset}`} page={page} notes={snapshot.stickyNotes}>
      <div className="h-dvh flex flex-col bg-slate-100/80 text-slate-900 overflow-hidden">
        <header className="shrink-0 h-12 border-b border-slate-200/90 bg-white flex items-center justify-between gap-3 px-3.5 sm:px-4 z-20">
          <div className="min-w-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(c => !c)}
              aria-label={sidebarCollapsed ? '展开左侧目录' : '收起左侧目录'}
              title={sidebarCollapsed ? '展开左侧目录' : '收起左侧目录'}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer shrink-0 ${
                !sidebarCollapsed
                  ? 'text-slate-800 bg-slate-100 hover:bg-slate-200/70'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              <PanelLeft size={15} />
            </button>

            <div className="h-4 w-px bg-slate-200 shrink-0" />

            <AlexLogo size={22} className="rounded-md shadow-2xs shrink-0" />

            <div className="min-w-0 flex items-center gap-2">
              <h1 className="text-xs sm:text-[13px] font-bold text-slate-900 truncate max-w-[160px] sm:max-w-[280px]">
                {snapshot.title}
              </h1>
              <span className="hidden md:inline-flex items-center rounded-md bg-blue-50 border border-blue-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 shrink-0">
                版本 {publication?.version ?? 1}
              </span>
            </div>

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
            <p className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-400 mr-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              在线原型 · 版本 {publication?.version} · 演示操作仅影响当前浏览
            </p>
            <ThemeSwitch {...theme} />
            <PublishedProjectNotes
              snapshot={snapshot}
              activePageId={activeId}
              onNavigate={pageId => {
                window.location.hash = encodeURIComponent(pageId);
                useProtoStore.getState().setActivePage(pageId);
              }}
            />
            <PublishedNotesButton />
            <button
              type="button"
              onClick={() => setMcpOpen(true)}
              className="flex gap-1.5 items-center rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100/80 text-blue-700 font-medium px-2.5 py-1.5 text-xs shrink-0 cursor-pointer transition shadow-2xs"
            >
              <Blocks size={13.5} aria-hidden="true" />
              <span>MCP 接入</span>
            </button>
            <button
              type="button"
              onClick={() => {
                hydratePublishedSnapshot(snapshot);
                setReset(n => n + 1);
              }}
              className="flex gap-1.5 items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 font-medium px-2.5 py-1.5 text-xs shrink-0 cursor-pointer transition shadow-2xs"
            >
              <RotateCcw size={13.5} className="text-slate-500" />
              重置演示
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
                <div role="alert" className="p-8 text-sm text-slate-500">目标页面未发布，请从左侧目录选择页面。</div>
              )}
            </div>
            </div>
          </main>
        </div>
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
      </div>
    </PublishedNotesProvider>
  );
}
