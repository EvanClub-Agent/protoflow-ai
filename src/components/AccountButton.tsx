import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAccountStore } from '../store/useAccountStore';
import { signedOutPublishing } from '../services/publishingClient';
import { PublishingAccountPanel } from './PublishingAccountPanel';
import { useI18n } from '../i18n';

export function AccountButton() {
  const { tr, td } = useI18n();
  const { user, serverUrl, busy, error: authError, login, logout } = useAccountStore();
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (loginOpen && !dlg.open) dlg.showModal();
    else if (!loginOpen && dlg.open) dlg.close();
  }, [loginOpen]);

  useEffect(() => {
    if (user && loginOpen) setLoginOpen(false);
  }, [user, loginOpen]);

  if (!user) {
    return (
      <div className="relative shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          onClick={() => { setError(''); setLoginOpen(true); }}
          className="rounded-md border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 cursor-pointer transition whitespace-nowrap"
        >
          {tr('本地模式 · 连接服务', 'Local · Connect')}
        </button>
        {loginOpen && (
          <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            onClose={() => setLoginOpen(false)}
            onCancel={event => { if (busy) event.preventDefault(); }}
            className="m-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40 whitespace-normal"
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
              <span id={titleId} className="text-xs font-bold text-slate-800">{tr('连接自建发布服务', 'Connect Self-Hosted Server')}</span>
              <button
                type="button"
                aria-label={tr('关闭登录窗口', 'Close sign-in dialog')}
                disabled={busy}
                onClick={() => setLoginOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 cursor-pointer disabled:opacity-40"
              >
                <X size={15} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {(error || authError) && (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 break-words">
                  {td(error || authError || '')}
                </p>
              )}
              <PublishingAccountPanel
                settings={{ ...signedOutPublishing(), url: serverUrl || signedOutPublishing().url }}
                busy={busy}
                onAuthenticate={async input => {
                  setError('');
                  await login(input);
                }}
                onLogout={() => void logout()}
                onLegacyChoice={() => {}}
              />
            </div>
          </dialog>
        )}
      </div>
    );
  }

  return <div className="relative shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="max-w-36 truncate rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">{user.displayName}</button>
    {open && <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-slate-800 whitespace-normal">
      <p className="text-sm font-semibold">{tr('当前账号', 'Signed-in Account')}</p>
      <p className="mt-1 break-all text-xs text-slate-500">{user.username}</p>
      {serverUrl && <p className="mb-2 mt-0.5 break-all text-[11px] text-slate-400">{serverUrl}</p>}
      <button type="button" disabled={busy} onClick={() => { setError(''); void logout().catch(e => setError(e instanceof Error ? td(e.message) : tr('退出失败，请重试', 'Sign-out failed, please retry'))); }} className="mt-2 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm disabled:opacity-40">{busy ? tr('正在保存并退出…', 'Saving & signing out…') : tr('退出登录', 'Sign Out')}</button>
      {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    </div>}
  </div>;
}
