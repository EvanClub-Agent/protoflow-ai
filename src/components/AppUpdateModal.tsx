import React, { useEffect, useId, useRef } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, Package, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useUpdateStore } from '../store/useUpdateStore';
import { formatBytes, getUpdaterDesktopBridge } from '../services/releaseClient';

export const AppUpdatePanel: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const update = useUpdateStore();
  const { status, currentVersion, os, serverUrl, hasUpdate, latestRelease,
    recommendedAsset, progress, lastCheckedAt, error, installGuide, isUpdating } = update;
  const native = Boolean(getUpdaterDesktopBridge());
  const busy = isUpdating || status === 'checking' || status === 'downloading' || status === 'installing';
  const buttonClass = 'rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-4 py-2 text-sm flex items-center gap-2 cursor-pointer disabled:cursor-wait transition';
  const platformName = os === 'macos' ? 'macOS' : os === 'windows' ? 'Windows' : 'Linux';
  const progressPercent = Math.min(100, Math.max(0, progress?.percent ?? 0));

  return (
    <div className={`flex flex-col gap-5 ${embedded ? 'h-full overflow-y-auto p-6' : 'p-5 sm:p-6'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">软件更新</h2>
          <p className="mt-1 text-sm text-slate-500">当前版本 v{currentVersion} · {platformName}</p>
          <p className="mt-2 text-xs text-slate-500">自动为这台电脑选择更新，保留你的项目和设置。</p>
        </div>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => void update.checkForUpdates()}>
          <RefreshCw size={15} className={status === 'checking' ? 'animate-spin' : ''} />
          {status === 'checking' ? '正在检查…' : '检查更新'}
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-start gap-2">
        <AlertCircle size={17} className="shrink-0 mt-0.5" /><div><p className="font-semibold">更新未完成</p><p className="mt-1 break-words">{error}</p></div>
      </div>}

      {status === 'up-to-date' && !hasUpdate && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 flex items-start gap-3">
        <CheckCircle2 size={23} className="text-emerald-600 shrink-0" />
        <div><p className="font-semibold text-slate-900">已经是最新版本</p><p className="mt-1 text-sm text-slate-600">你正在使用 v{currentVersion}。{lastCheckedAt && `上次检查：${new Date(lastCheckedAt).toLocaleTimeString()}`}</p></div>
      </div>}

      {latestRelease && hasUpdate && <section aria-label="可用更新" className="rounded-2xl border border-blue-200 bg-white overflow-hidden">
        <div className="bg-blue-50 p-5 border-b border-blue-100">
          <p className="text-xs font-semibold text-blue-600">{latestRelease.mandatory ? '重要更新' : '发现新版本'}</p>
          <h3 className="mt-1 text-lg font-bold text-slate-900">Alex v{latestRelease.version}</h3>
          {recommendedAsset && <p className="mt-1 text-xs text-slate-500">已为你的电脑选择合适的安装包 · {formatBytes(recommendedAsset.sizeBytes)}</p>}
        </div>
        <div className="p-5 space-y-4">
          {latestRelease.notes && <div className="whitespace-pre-wrap text-sm text-slate-700 leading-6 max-h-52 overflow-y-auto">{latestRelease.notes}</div>}
          {status === 'downloading' && <div role="status" className="space-y-2">
            <div className="flex justify-between text-sm text-slate-600"><span>正在下载更新…</span><span>{progressPercent.toFixed(0)}%</span></div>
            <div role="progressbar" aria-label="下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${progressPercent}%` }} /></div>
            {progress && <p className="text-xs text-slate-500">{formatBytes(progress.transferredBytes)} / {formatBytes(progress.totalBytes)}</p>}
          </div>}
          {status === 'installing' && !installGuide && <div role="status" className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">正在安装更新，请在系统弹窗中输入电脑的管理员密码。安装完成后将自动重启。</div>}
          {status === 'downloaded' && <p className="text-sm text-emerald-700 flex items-center gap-2"><ShieldCheck size={16} />更新已下载并通过安全验证</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || !recommendedAsset} className={buttonClass} onClick={() => void update.installLatestUpdate()}>
              <Download size={16} />{status === 'installing' ? '正在安装…' : isUpdating ? '正在更新…' : native ? '立即更新' : '下载安装包'}
            </button>
            {status === 'downloading' && <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => void update.cancelDownload()}>取消下载</button>}
          </div>
          <p className="text-xs text-slate-500">{os === 'linux' ? '自动下载、安全校验并安装。系统可能会要求输入管理员密码。' : os === 'windows' ? '自动下载并打开安装向导，按提示完成更新。' : '自动下载并打开安装包，按提示替换应用。'}</p>
        </div>
      </section>}

      {installGuide && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-slate-700">
        <p className="font-semibold text-blue-900">{installGuide.title}</p>
        <ol className="list-decimal list-inside space-y-1 mt-2">{installGuide.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      </div>}

      {status === 'idle' && !error && <p className="text-sm text-slate-500">点击“检查更新”，即可获取最新版本。</p>}
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <ShieldCheck size={14} /><span>更新包会自动验证来源和完整性</span>
        <button type="button" disabled={busy} className="ml-auto flex items-center gap-1 hover:text-blue-600 cursor-pointer disabled:opacity-40" onClick={() => void update.openReleaseCenterWeb()}><ExternalLink size={13} />{serverUrl ? '版本记录' : 'GitHub Releases'}</button>
      </div>


    </div>
  );
};

export const AppUpdateModal: React.FC = () => {
  const idPrefix = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const { isModalOpen, setModalOpen, status, isUpdating } = useUpdateStore();

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (isModalOpen && !dlg.open) {
      dlg.showModal();
    } else if (!isModalOpen && dlg.open) {
      dlg.close();
    }
  }, [isModalOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${idPrefix}-modal-title`}
      onClose={() => setModalOpen(false)}
      onCancel={event => { if (isUpdating || status === 'installing') event.preventDefault(); }}
      className="m-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between gap-3 px-6 py-3.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-blue-600" />
          <span id={`${idPrefix}-modal-title`} className="text-xs font-bold text-slate-800">
            Alex · 版本更新中心
          </span>
        </div>
        <button
          type="button"
          aria-label="关闭版本更新窗口"
          disabled={isUpdating || status === 'downloading' || status === 'installing'}
          onClick={() => setModalOpen(false)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer disabled:opacity-40"
        >
          <X size={15} />
        </button>
      </div>
      <div className="max-h-[80vh] overflow-y-auto">
        <AppUpdatePanel />
      </div>
    </dialog>
  );
};
