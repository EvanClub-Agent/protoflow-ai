import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Link2, LoaderCircle, LockKeyhole, RefreshCw, X, Blocks } from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { createPublishedSnapshot, publishablePages } from '../services/createPublishedSnapshot';
import { useAccountStore } from '../store/useAccountStore';
import { PublishingAccountPanel } from './PublishingAccountPanel';
import { shareableNotes } from '../services/publishedNotes';
import { chooseLegacyPublishing, desktopPublishing, signedOutPublishing, listPublications, publishingSettings, revokePublication, savePublication, type Publication, type PublishSettings } from '../services/publishingClient';
import { useI18n } from '../i18n';

function localDate(value: string | null) {
  if (value === null) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function recordState(record: Publication): 'revoked' | 'expired' | 'active' {
  return record.revokedAt ? 'revoked' : record.expiresAt && Date.parse(record.expiresAt) <= Date.now() ? 'expired' : 'active';
}

export function OnlinePublishModal({ onClose, onOffline }: { onClose: () => void; onOffline: () => void }) {
  const { tr, td } = useI18n();
  const stateLabel = (record: Publication) => {
    const st = recordState(record);
    return st === 'revoked' ? tr('已撤回', 'Revoked') : st === 'expired' ? tr('已过期', 'Expired') : tr('可访问', 'Active');
  };
  const project = useProtoStore(s => s.currentProjectMeta);
  const activePageId = useProtoStore(s => s.activePageId);
  const pageSources = usePageStore(s => s.pageSources), designerPages = usePageStore(s => s.designerPages);
  const designerFolders = usePageStore(s => s.designerFolders), sitemapBase = usePageStore(s => s.sitemapBase), sitemapOverrides = usePageStore(s => s.sitemapOverrides);
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(false);
  const [settings, setSettings] = useState<PublishSettings>(signedOutPublishing);
  const [records, setRecords] = useState<Publication[]>([]), [selectedId, setSelectedId] = useState<string | null>(null);
  const inventory = useMemo(() => {
    try { return { pages: publishablePages({ pageSources, designerPages, designerFolders, sitemapBase, sitemapOverrides }), error: null }; }
    catch (error) { return { pages: [], error: error instanceof Error ? error.message : String(error) }; }
  }, [pageSources, designerPages, designerFolders, sitemapBase, sitemapOverrides]);
  const { pages } = inventory;
  // A document-only workspace selection isn't a publishable canvas. Explicitly
  // default the entry-page control to the first actual canvas, which users can change.
  // null means no user choice yet. Resolve the default from the current pages,
  // including the first page generated while this dialog is already open.
  const [chosenEntry, setEntry] = useState<string | null>(null);
  const entry = chosenEntry !== null ? chosenEntry : pages.some(p => p.pageId === activePageId) ? activePageId : pages.length ? pages[0].pageId : null;
  const entryAvailable = entry !== null && pages.some(p => p.pageId === entry);
  const [protectedLink, setProtectedLink] = useState(false), [password, setPassword] = useState(''), [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const selected = selectedId === null ? undefined : records.find(r => r.id === selectedId);
  const updating = Boolean(selected && !selected.revokedAt);
  const publishBlockReason = busy ? (busy === 'load' ? tr('正在读取发布状态…', 'Loading publish status…') : tr('请等待当前操作完成', 'Please wait for the current action to finish'))
    : inventory.error ? tr('页面目录读取失败，请先修复后再发布', 'Failed to read sitemap — fix before publishing')
    : pages.length === 0 ? tr('请先创建或生成画布页面', 'Create or generate at least one canvas page first')
    : !settings.configured ? settings.legacy ? tr('请先选择是否关联本机已有分享', 'Choose whether to link existing local shares first') : tr('请先登录账号', 'Please sign in first')
    : selected?.revokedAt ? tr('此链接已撤回，请新建分享链接', 'This link was revoked — create a new share link')
    : !entryAvailable ? tr('原入口页面已不可用，请重新选择', 'Original entry page is unavailable — please reselect')
    : null;
  const openDesign = (view: 'single_page' | 'project_ai') => {
    onClose();
    const store = useProtoStore.getState();
    store.setWebPlayerMode(false);
    store.setViewMode(view);
    if (view === 'single_page') store.setLeftActivityView('pages');
  };
  useEffect(() => {
    alive.current = true;
    const previous = dialog.current ? document.activeElement : null;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    const load = async () => {
      setBusy('load');
      try {
        const config = await publishingSettings();
        if (!alive.current) return; setSettings(config); if (config.notice) setMessage(td(config.notice));
        if (config.configured) { const items = await listPublications(project.projectId); if (alive.current) setRecords(items); }
      } catch (e) {
      if (alive.current) {
        setError(td(e instanceof Error ? e.message : String(e)));
        if ((e as { status?: number }).status === 401) { setSettings(signedOutPublishing()); setRecords([]); setSelectedId(null); setPassword(''); }
      }
    }
      finally { if (alive.current) setBusy(''); }
    };
    void load();
    return () => { alive.current = false; dialog.current?.close(); if (previous && previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [project.projectId]);
  const run = async (name: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setError(''); setMessage('');
    try {
      if (useProtoStore.getState().currentProjectMeta.projectId !== project.projectId) throw new Error(tr('项目已变化，请重新打开发布窗口', 'Project changed — please reopen the publish dialog'));
      await work();
    } catch (e) {
      if (alive.current) {
        setError(td(e instanceof Error ? e.message : String(e)));
        if ((e as { status?: number }).status === 401) { setSettings(signedOutPublishing()); setRecords([]); setSelectedId(null); setPassword(''); }
      }
    }
    finally { if (alive.current) setBusy(''); }
  };
  const choose = (record?: Publication) => {
    setSelectedId(record ? record.id : null); setProtectedLink(record ? record.passwordProtected : false);
    setExpires(record ? localDate(record.expiresAt) : ''); setPassword(''); setError(''); setMessage(''); setRevokeConfirm(false);
  };
  const save = () => run('publish', async () => {
    if (publishBlockReason) throw new Error(publishBlockReason);
    if (entry === null || !entryAvailable) throw new Error(tr('请先选择可发布的入口页面', 'Please select a publishable entry page'));
    if (selectedId !== null && !selected) throw new Error(tr('发布记录已变化，请刷新后重新选择', 'Share record changed — please refresh and reselect'));
    if (selected?.revokedAt) throw new Error(tr('该链接已撤回，请创建新的分享链接', 'This link was revoked — please create a new share link'));
    const snapshot = createPublishedSnapshot(entry);
    if (snapshot.projectId !== project.projectId) throw new Error(tr('项目已变化，请重新打开发布窗口', 'Project changed — please reopen the publish dialog'));
    if (protectedLink && !password && !selected?.passwordProtected) throw new Error(tr('请设置访问密码', 'Please set an access password'));
    const expiresAt = expires ? new Date(expires).toISOString() : null;
    const record = await savePublication({ snapshot, access: { passwordAction: protectedLink ? password ? 'set' : 'keep' : 'remove', password: protectedLink ? password : '', expiresAt } }, selected);
    if (!alive.current) return;
    setRecords(list => [record, ...list.filter(item => item.id !== record.id)]); setSelectedId(record.id); setPassword('');
    setMessage(updating ? tr(`已更新到版本 ${record.version}，分享链接保持不变。`, `Updated to version ${record.version}. Share URL remains unchanged.`) : tr('发布成功，复制链接即可邀请他人查看。', 'Published! Copy the link to invite others to view.'));
  });
  const button =
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  const desktop = desktopPublishing();
  const previewLabel = <><ExternalLink size={12} />{tr('打开预览', 'Open Preview')}</>;
  const previewClass = `${button} bg-white hover:bg-slate-50 border border-slate-200 text-slate-700`;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="publish-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="m-auto w-[min(740px,calc(100vw-32px))] max-w-none max-h-[calc(100dvh-48px)] p-0 rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl backdrop:bg-slate-950/35 backdrop:backdrop-blur-[3px]"
    >
      <div className="flex flex-col max-h-[calc(100dvh-48px)] overflow-hidden rounded-2xl">
        {/* Compact Modal Header */}
        <header className="flex justify-between items-center gap-4 border-b border-slate-200 px-5 py-3.5 bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
              <Globe size={16} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h2 id="publish-title" className="text-sm font-semibold text-slate-900 shrink-0">
                  {tr('发布与分享', 'Publish & Share')}
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200/80 text-[11px] font-medium text-slate-600 truncate max-w-[220px]">
                  {project.projectName}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate tabular-nums">
                {inventory.error ? tr('页面状态待检查，修复后即可发布', 'Check page status before publishing') : tr(`生成可在浏览器直接交互预览的专属链接（含 ${pages.length} 个画布页面、便签与演示数据）`, `Generate an interactive browser preview link (${pages.length} canvas page(s), spec pins & demo data)`)}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={tr('关闭发布窗口', 'Close publish dialog')}
            disabled={Boolean(busy)}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer transition shrink-0"
          >
            <X size={16} />
          </button>
        </header>

        {/* Body: Left Configuration + Right History */}
        <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-auto">
          <main className="min-w-0 flex-1 p-5 space-y-4">
            {inventory.error ? (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                <p className="font-semibold">{tr('无法读取项目页面', 'Unable to Read Project Pages')}</p>
                <p className="mt-2 break-words text-xs leading-5">{td(inventory.error)}</p>
                <button type="button" disabled={Boolean(busy)} onClick={() => openDesign('single_page')} className="mt-3 text-xs font-medium underline disabled:opacity-40">{tr('前往页面设计检查', 'Inspect in Page Designer')}</button>
              </div>
            ) : pages.length === 0 ? (
              <div role="status" className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">{tr('还没有可发布的画布页面', 'No Publishable Canvas Pages Yet')}</p>
                <p className="mt-2 text-xs leading-5">{tr('发布需要至少一个画布页面。创建项目、填写需求或确认方案后，还需要创建或生成页面内容。', 'Publishing requires at least one canvas page. Create or generate page content first.')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={Boolean(busy)} onClick={() => openDesign('project_ai')} className={`${button} bg-blue-600 text-white`}>{tr('打开项目 AI', 'Open Project AI')}</button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => openDesign('single_page')} className={`${button} border border-slate-200 bg-white text-slate-700`}>{tr('前往页面设计', 'Go to Page Designer')}</button>
                </div>
              </div>
            ) : null}
            <PublishingAccountPanel settings={settings} busy={Boolean(busy)}
              onAuthenticate={input => run('login', async () => {
                await useAccountStore.getState().login(input);
                if (useAccountStore.getState().status !== 'authenticated') throw new Error(useAccountStore.getState().error);
                const config = await publishingSettings();
                if (!alive.current) return;
                choose(); setRecords([]); setSettings(config);
                if (config.notice) setMessage(td(config.notice));
                if (config.configured) { const items = await listPublications(project.projectId); if (alive.current) setRecords(items); }
              })}
              onLogout={() => void run('logout', async () => {
                await useAccountStore.getState().logout();
                const acct = useAccountStore.getState();
                const config = { ...signedOutPublishing(), url: acct.serverUrl || signedOutPublishing().url, ...(acct.error ? { notice: acct.error } : {}) };
                if (!alive.current) return;
                choose(); setRecords([]); setSettings(config); setMessage(config.notice ? td(config.notice) : tr('已退出登录', 'Signed out'));
              })}
              onLegacyChoice={action => void run('link', async () => {
                const config = await chooseLegacyPublishing(action);
                if (!alive.current) return;
                choose(); setRecords([]); setSettings(config);
                if (config.configured) { const items = await listPublications(project.projectId); if (alive.current) setRecords(items); }
              })}
            />

            {/* Project notes that will be shared (explicit opt-in per note) */}
            {pages.length > 0 && <SharedNotesSummary />}

            {/* Share Link Settings */}
            {pages.length > 0 && <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 tabular-nums">
                  <Link2 size={14} className="text-blue-600 shrink-0" />
                  <span>
                    {selected ? tr(`更新分享配置 · 版本 V${selected.version}`, `Update Share · Version V${selected.version}`) : tr('新建分享链接配置', 'New Share Link Settings')}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">{tr('浏览者操作不会回写原设计', 'Viewer actions do not modify your project')}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs text-slate-600">
                  <span className="font-medium text-slate-700">{tr('默认打开页面', 'Default Entry Page')}</span>
                  <select
                    aria-label={tr('分享入口页面', 'Share entry page')}
                    disabled={Boolean(busy)}
                    value={entry === null ? '' : entry}
                    onChange={(e) => setEntry(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-600"
                  >
                    {!entryAvailable && <option value={entry === null ? '' : entry} disabled>{tr('原入口页面已不可用，请重新选择', 'Original entry page unavailable — please reselect')}</option>}
                    {pages.map((p) => (
                      <option key={p.pageId} value={p.pageId}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs text-slate-600">
                  <span className="font-medium text-slate-700">
                    {tr('过期时间 ', 'Expiration ')}<span className="text-slate-400 font-normal">{tr('（留空长期有效）', '(leave blank for no expiry)')}</span>
                  </span>
                  <input
                    aria-label={tr('分享过期时间', 'Share expiration time')}
                    type="datetime-local"
                    disabled={Boolean(busy)}
                    value={expires}
                    onChange={(e) => setExpires(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-600"
                  />
                </label>
              </div>

              {/* Password Protection Card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 space-y-2.5">
                <label className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <LockKeyhole size={14} className="text-slate-500" />
                    <span>{tr('开启访问密码保护', 'Enable Password Protection')}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={protectedLink}
                    disabled={Boolean(busy)}
                    onChange={(e) => {
                      setProtectedLink(e.target.checked);
                      setPassword('');
                    }}
                    className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer"
                  />
                </label>
                {protectedLink && (
                  <input
                    aria-label={tr('分享访问密码', 'Share access password')}
                    type="password"
                    autoComplete="new-password"
                    maxLength={128}
                    disabled={Boolean(busy)}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      selected?.passwordProtected
                        ? tr('留空保留原密码，输入以更换密码', 'Leave blank to keep current password, or enter a new one')
                        : tr('至少 6 个字符，单独发送给浏览者', 'At least 6 characters — share separately with viewers')
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-600"
                  />
                )}
              </div>
            </div>}

            {/* Active Selected Share URL Card */}
            {selected && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-blue-800">{tr('专属分享链接', 'Share Link')}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      recordState(selected) === 'active'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {stateLabel(selected)}
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-white border border-blue-200/80 rounded-lg px-2.5 py-1.5">
                  <p className="text-xs font-mono break-all select-all text-slate-700 flex-1">
                    {selected.shareUrl}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      disabled={Boolean(busy) || recordState(selected) !== 'active'}
                      onClick={() =>
                        void run('copy', async () => {
                          await navigator.clipboard.writeText(selected.shareUrl);
                          if (alive.current) setMessage(tr('链接已复制。', 'Link copied.'));
                        })
                      }
                      className={`${button} bg-white hover:bg-slate-50 border border-slate-200 text-slate-700`}
                    >
                      <Copy size={12} />
                      {tr('复制链接', 'Copy Link')}
                    </button>
                    {desktop ? (
                      <button type="button" className={previewClass} onClick={() => {
                        setError('');
                        void desktop.openPreview({ id: selected.id, shareUrl: selected.shareUrl }).catch(cause => {
                          if (alive.current) setError(tr('无法打开系统浏览器：', 'Could not open the system browser: ') + td(cause instanceof Error ? cause.message : String(cause)));
                        });
                      }}>{previewLabel}</button>
                    ) : (
                      <a href={selected.shareUrl} target="_blank" rel="noopener noreferrer" className={previewClass}>{previewLabel}</a>
                    )}
                    {recordState(selected) === 'active' && (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          onClose();
                          useProtoStore.getState().setMcpModalOpen(true, {
                            tab: 'remote',
                            shareUrl: selected.shareUrl,
                          });
                        }}
                        className={`${button} bg-white hover:bg-blue-50 border border-blue-200 text-blue-700`}
                      >
                        <Blocks size={12} />
                        {tr('MCP 接入', 'MCP')}
                      </button>
                    )}
                  </div>
                  {!selected.revokedAt && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => setRevokeConfirm(true)}
                      className={`${button} text-rose-600 hover:bg-rose-50`}
                    >
                      {tr('撤回分享', 'Revoke Share')}
                    </button>
                  )}
                </div>
                {revokeConfirm && (
                  <div className="border-t border-blue-200/80 pt-2.5 flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs text-slate-700">{tr('撤回后此链接将无法继续打开，确定撤回？', 'Revoking permanently disables this link. Revoke now?')}</p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => setRevokeConfirm(false)}
                        className={`${button} bg-white border border-slate-200 text-slate-600`}
                      >
                        {tr('暂不撤回', 'Keep Active')}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run('revoke', async () => {
                            const record = await revokePublication(selected);
                            if (alive.current) {
                              setRecords((list) =>
                                list.map((r) => (r.id === record.id ? record : r))
                              );
                              setRevokeConfirm(false);
                              setMessage(tr('已撤回分享，原链接已失效。', 'Share revoked — the link is now inactive.'));
                            }
                          })
                        }
                        className={`${button} bg-rose-600 hover:bg-rose-700 text-white`}
                      >
                        {tr('确认撤回', 'Confirm Revoke')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {message && (
              <p
                role="status"
                className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex gap-1.5 items-center"
              >
                <Check size={14} className="shrink-0 text-emerald-600" />
                {message}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 break-words"
              >
                {td(error)}
              </p>
            )}
          </main>

          {/* Right Sidebar: Published Share Records */}
          <aside className="sm:w-60 shrink-0 border-t sm:border-t-0 sm:border-l border-slate-200 bg-slate-50/60 p-3.5 flex flex-col min-w-0">
            <div className="flex items-center justify-between gap-1.5 mb-2.5 min-w-0">
              <h3 className="text-xs font-semibold text-slate-600 truncate tabular-nums">{tr(`分享记录 (${records.length})`, `Share History (${records.length})`)}</h3>
              <button
                type="button"
                aria-label={tr('刷新分享记录', 'Refresh share history')}
                disabled={!settings.configured || Boolean(busy)}
                onClick={() =>
                  void run('refresh', async () => {
                    const list = await listPublications(project.projectId);
                    if (alive.current) setRecords(list);
                  })
                }
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 disabled:opacity-40 cursor-pointer transition shrink-0"
              >
                <RefreshCw size={13} className={busy === 'refresh' ? 'animate-spin' : ''} />
              </button>
            </div>

            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => choose()}
              className={`w-full min-w-0 truncate text-left rounded-lg px-2.5 py-2 mb-2 text-xs font-medium transition cursor-pointer ${
                selectedId === null
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tr('＋ 新建分享链接', '＋ New Share Link')}
            </button>

            <div className="space-y-1.5 flex-1 overflow-y-auto">
              {records.map((record) => {
                const st = recordState(record);
                const status = stateLabel(record);
                return (
                  <button
                    key={record.id}
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => choose(record)}
                    className={`w-full min-w-0 text-left rounded-lg p-2.5 border text-xs transition cursor-pointer ${
                      selectedId === record.id
                        ? 'border-blue-400 bg-blue-50/80 shadow-2xs'
                        : 'border-slate-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                      <span className="font-semibold text-slate-800 truncate">{record.title}</span>
                      <span className="shrink-0 px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-mono tabular-nums text-[10px]">
                        V{record.version}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-1.5 text-[10px] text-slate-400 tabular-nums">
                      <span className="truncate">
                        {new Date(record.updatedAt).toLocaleDateString()}
                      </span>
                      <span
                        className={`shrink-0 ${
                          st === 'active'
                            ? 'text-emerald-600 font-medium'
                            : 'text-slate-400'
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                  </button>
                );
              })}
              {records.length === 0 && (
                <p className="text-[11px] text-slate-400 leading-relaxed p-2 text-center">
                  {settings.configured
                    ? tr('暂无分享记录，发布后将在此处显示。', 'No share history yet. Published links will appear here.')
                    : tr('登录账号后可查看自己的分享记录。', 'Sign in to view and manage your share history.')}
                </p>
              )}
            </div>
          </aside>
        </div>

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex flex-wrap justify-between items-center gap-3 shrink-0">
          {publishBlockReason && <p id="publish-block-reason" role="status" className="w-full text-xs text-slate-600">{publishBlockReason}</p>}
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onOffline}
            className={`${button} text-slate-600 hover:text-slate-900 hover:bg-slate-200/60`}
          >
            {tr('导出离线模板演示', 'Export Offline HTML Demo')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={onClose}
              className={`${button} bg-white hover:bg-slate-50 border border-slate-200 text-slate-700`}
            >
              {tr('关闭', 'Close')}
            </button>
            <button
              type="button"
              disabled={publishBlockReason !== null}
              aria-describedby={publishBlockReason ? 'publish-block-reason' : undefined}
              title={publishBlockReason === null ? undefined : publishBlockReason}
              onClick={() => void save()}
              className={`${button} bg-blue-600 hover:bg-blue-700 text-white px-4 shadow-2xs`}
            >
              {busy === 'publish' ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Globe size={14} />
              )}
              {busy === 'publish' ? tr('正在发布…', 'Publishing…') : updating ? tr('更新到此链接', 'Update This Link') : tr('发布并生成链接', 'Publish & Create Link')}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

/** Lists the notes marked "外发到演示端"; everything else stays internal. */
function SharedNotesSummary() {
  const { tr } = useI18n();
  useProtoStore(s => s.projectNotes);
  const notes = shareableNotes();
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-[11px] text-slate-600 space-y-1.5" aria-label={tr('将外发的项目笔记', 'Shared project notes')}>
      <div className="font-semibold text-slate-800 tabular-nums">
        {tr('项目笔记：', 'Project Notes: ')}{notes.length ? tr(`将外发 ${notes.length} 篇（只读，显示在演示端「需求说明」中）`, `Sharing ${notes.length} note(s) (read-only in viewer "Spec Docs")`) : tr('不外发任何笔记', 'No notes shared')}
      </div>
      {notes.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {notes.map(note => (
            <li key={note.id} className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{note.icon} {note.title}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-slate-400">{tr('只有在笔记属性中开启「外发到演示端」的笔记才会发布；对接人、标签等内部信息不会外发。', 'Only notes marked "Share to Viewer" in note properties are published; internal contacts and tags stay private.')}</p>
    </div>
  );
}
