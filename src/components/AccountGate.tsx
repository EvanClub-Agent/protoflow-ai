import React, { useEffect, useRef } from 'react';
import { useProtoStore } from '../store/useProtoStore';
import { useAccountStore } from '../store/useAccountStore';
import { signedOutPublishing } from '../services/publishingClient';
import { PublishingAccountPanel } from './PublishingAccountPanel';
import { AlexLogo } from './AlexLogo';

export function AccountGate({ children }: { children: React.ReactNode }) {
  const { status, serverUrl, busy, error, refresh, enterLocalMode, login, logout } = useAccountStore();
  const entered = useRef(false), workspace = useRef<HTMLDivElement>(null);
  const suspendedDialogs = useRef(new Set<HTMLDialogElement>());
  const hasWorkspaceAccess = status === 'authenticated' || status === 'local';
  if (hasWorkspaceAccess) entered.current = true;
  useEffect(() => {
    void refresh();
    const host = window;
    const onFocus = () => { void refresh(); };
    host.addEventListener('focus', onFocus);
    const interval = host.setInterval(onFocus, 5 * 60_000);
    return () => { host.removeEventListener('focus', onFocus); host.clearInterval(interval); };
  }, [refresh]);
  useEffect(() => {
    if (!hasWorkspaceAccess) {
      workspace.current?.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => { suspendedDialogs.current.add(dialog); dialog.close(); });
    } else {
      for (const dialog of suspendedDialogs.current) if (dialog.isConnected && !dialog.open) dialog.showModal();
      suspendedDialogs.current.clear();
    }
    const desktop = (window as unknown as { protoflowDesktop?: { setWindowMode?: (mode: string) => Promise<unknown> } }).protoflowDesktop;
    void desktop?.setWindowMode?.(hasWorkspaceAccess && !useProtoStore.getState().isWelcomeScreenOpen ? 'workspace' : 'welcome');
  }, [hasWorkspaceAccess]);
  return <>
    {/* Preserve a running local project when a session expires. Users may also enter
        offline local mode directly without signing in to a publishing server. */}
    {entered.current && <div ref={workspace} hidden={!hasWorkspaceAccess}>{children}</div>}
    {!hasWorkspaceAccess && <main className="relative flex h-screen flex-col overflow-x-hidden overflow-y-auto overscroll-none bg-[#FAF9F5] text-[#141413] antialiased [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Soft warm glow, echoing the Claude desktop entry. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-[radial-gradient(55%_50%_at_25%_10%,rgba(217,119,87,0.10),transparent_70%),radial-gradient(45%_45%_at_85%_95%,rgba(217,119,87,0.06),transparent_70%)]" />
      <div className="relative h-10 shrink-0 [@media(max-height:560px)]:h-8" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      <div className="relative my-auto w-full px-6 pb-8 sm:px-10 [@media(max-height:640px)]:pb-5">
        <div className="mx-auto grid w-full max-w-[400px] items-center gap-7 md:max-w-[880px] md:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] md:gap-12 lg:gap-16">
          <div className="flex flex-col items-center text-center md:items-start md:text-left">
            <AlexLogo size={44} className="mb-5 rounded-xl shadow-[0_6px_20px_-8px_rgba(20,20,19,0.35)] md:mb-7 [@media(max-height:640px)]:mb-4 [@media(max-height:640px)]:size-9" />
            <h1 className="text-[clamp(28px,4.2vw,44px)] leading-[1.15] font-normal tracking-[-0.01em] text-balance text-[#141413] [font-family:'Tiempos_Headline',ui-serif,Georgia,'Songti_SC','STSong',serif]">让想法，即刻成形</h1>
            <p className="mt-3 text-[15px] leading-6 text-[#73726C] md:mt-4">连接自建服务，或直接免登录本地使用</p>
            <p className="mt-10 hidden max-w-[300px] text-xs leading-5 text-[#8A887F] md:block [@media(max-height:640px)]:mt-6">项目始终保存在本机，只有主动发布分享时才会连接你配置的服务端。</p>
          </div>
          <div>
            <div className="rounded-[20px] border border-[#E8E6DC] bg-white/85 p-6 shadow-[0_1px_2px_rgba(20,20,19,0.04),0_12px_32px_-12px_rgba(20,20,19,0.10)] backdrop-blur-sm sm:p-7 [@media(max-height:640px)]:p-5">
              {status === 'checking' ? <div role="status" className="flex flex-col items-center gap-3 py-10 text-sm text-[#73726C]">
                <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-[#E8E6DC] border-t-[#D97757]" />
                正在检查本地工作区…
              </div> : <>
                {(error || status === 'error') && <div className="mb-4 rounded-[10px] border border-[#F1C9BC] bg-[#FBF1EC] px-3.5 py-2.5">
                  {error && <p role="alert" className="line-clamp-3 text-[13px] leading-5 break-words text-[#9A3B1E]" title={error}>{error}</p>}
                  {status === 'error' && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded font-medium text-[#9A3B1E] underline decoration-[#E3A48F] underline-offset-4 hover:decoration-[#9A3B1E] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/40 disabled:opacity-50">重新连接</button>
                    <button type="button" disabled={busy} onClick={() => void logout().catch(() => {})} className="rounded text-[#73726C] hover:text-[#141413] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/40 disabled:opacity-50">清除本机登录记录</button>
                  </div>}
                </div>}
                <PublishingAccountPanel settings={{ ...signedOutPublishing(), url: serverUrl || signedOutPublishing().url }} busy={busy} onAuthenticate={login} onLogout={() => void logout()} onLegacyChoice={() => {}} applicationEntry />
                <div className="mt-4 border-t border-[#E8E6DC] pt-4">
                  <button type="button" disabled={busy} onClick={enterLocalMode} className="flex h-10 w-full items-center justify-center rounded-[10px] border border-[#DAD8CE] bg-[#FAF9F5] px-3.5 text-[14px] font-medium text-[#3D3D3A] transition-colors hover:bg-[#F0EEE6] hover:text-[#141413] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/40 disabled:opacity-50">
                    免登录本地使用
                  </button>
                </div>
              </>}
            </div>
            <p className="mx-auto mt-5 max-w-[320px] text-center text-xs leading-5 text-[#8A887F] md:hidden">项目始终保存在本机，只有主动发布分享时才会连接你配置的服务端。</p>
          </div>
        </div>
      </div>
    </main>}
  </>;
}
