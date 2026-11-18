import React, { useEffect, useState } from 'react';
import type { PublishingLogin, PublishSettings } from '../services/publishingClient';

export function PublishingAccountPanel({ settings, busy, onAuthenticate, onLogout, onLegacyChoice, applicationEntry = false }: {
  settings: PublishSettings; busy: boolean; applicationEntry?: boolean;
  onAuthenticate: (input: PublishingLogin) => Promise<void>;
  onLogout: () => void;
  onLegacyChoice: (action: 'link' | 'skip') => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [serverUrl, setServerUrl] = useState(settings.url || '');
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [visible, setVisible] = useState(false);
  useEffect(() => {
    if (settings.url && !serverUrl) setServerUrl(settings.url);
  }, [settings.url]);
  const button = 'min-h-12 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-600';
  const input = 'mt-1 block w-full min-h-12 rounded-lg border border-slate-400 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-blue-600 user-invalid:border-rose-600';
  if (settings.user) return <section aria-label="发布账号" className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">已登录 · {settings.user.displayName}</p>
        <p className="text-xs text-slate-500 break-all">账号：{settings.user.username}{settings.url ? ` · 服务：${settings.url}` : ''}</p>
      </div>
      <button type="button" disabled={busy} onClick={onLogout} className={`${button} shrink-0 text-slate-600`}>退出登录</button>
    </div>
    {settings.legacy ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
      <p className="text-sm font-semibold text-amber-900">发现本机已有分享</p>
      <p className="text-xs leading-5 text-amber-900">关联后，此账号将管理原发布身份「{settings.legacy.name}」下的全部分享，原链接保持不变。请确认这些分享属于你。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => onLegacyChoice('link')} className={`${button} bg-blue-600 text-white`}>关联本机已有分享</button>
        <button type="button" disabled={busy} onClick={() => onLegacyChoice('skip')} className={`${button} bg-white border border-slate-300`}>使用账号创建新的分享</button>
      </div>
      <p className="text-xs text-slate-600">创建新分享后，旧分享仍保留；如需合并归属，请联系管理员。</p>
    </div> : <p className="text-xs text-slate-500">分享记录归属于此账号，登录后可在其他电脑继续管理。</p>}
  </section>;
  if (applicationEntry) return <ApplicationEntryForm defaultUrl={settings.url} busy={busy} onAuthenticate={onAuthenticate} />;
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
    <h3 id="publishing-account-title" className="text-sm font-semibold">{mode === 'login' ? '连接自建服务并登录' : '在自建服务上注册账号'}</h3>
    <p className="mt-1 text-xs text-slate-500">填写团队或个人部署的 Alex 发布服务地址，即可在线分享原型链接并管理版本。</p>
    <form method="post" aria-labelledby="publishing-account-title" className="mt-4 space-y-3" onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      void onAuthenticate({ mode, url: serverUrl.trim(), username, password }).finally(() => { setPassword(''); setVisible(false); });
    }}>
      <div>
        <label htmlFor="publishing-server-url" className="text-xs font-medium">自建服务地址（必填）</label>
        <input id="publishing-server-url" name="serverUrl" type="url" inputMode="url" autoComplete="url" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required placeholder="https://protoflow.example.com 或 http://localhost:8088" aria-describedby="publishing-server-url-help" value={serverUrl} onChange={e => setServerUrl(e.target.value)} disabled={busy} className={input} />
        <p id="publishing-server-url-help" className="mt-1 text-xs text-slate-500">公网请使用 HTTPS；本机或局域网自建支持 HTTP（如 http://localhost:8088）</p>
      </div>
      <div>
        <label htmlFor="publishing-username" className="text-xs font-medium">用户名（必填）</label>
        <input id="publishing-username" name="username" autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.\-]{3,40}" aria-describedby="publishing-username-help" value={username} onChange={e => setUsername(e.target.value)} disabled={busy} className={input} />
        <p id="publishing-username-help" className="mt-1 text-xs text-slate-500">3–40 位字母、数字、下划线、点或短横线</p>
      </div>
      <div>
        <label htmlFor="publishing-password" className="text-xs font-medium">密码（必填）</label>
        <div className="flex items-center gap-2">
          <input id="publishing-password" name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} enterKeyHint="done" required minLength={mode === 'register' ? 8 : undefined} maxLength={128} aria-describedby={mode === 'register' ? 'publishing-password-help' : undefined} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} className={`${input} min-w-0`} />
          <button type="button" aria-pressed={visible} disabled={busy} onClick={() => setVisible(value => !value)} className={`${button} shrink-0 text-slate-600`}>{visible ? '隐藏密码' : '显示密码'}</button>
        </div>
        {mode === 'register' && <p id="publishing-password-help" className="mt-1 text-xs text-slate-500">至少 8 个字符，最多 128 字节</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={`${button} bg-blue-600 text-white`}>{busy ? '正在处理…' : mode === 'login' ? '登录账号' : '注册并登录'}</button>
        <button type="button" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); setVisible(false); }} className={`${button} text-blue-600`}>{mode === 'login' ? '没有账号？注册' : '已有账号？登录'}</button>
      </div>
    </form>
  </section>;
}

/** Application sign-in form, styled after the Claude desktop entry: warm neutral surface, quiet borders, dark primary action. */
function ApplicationEntryForm({ defaultUrl, busy, onAuthenticate }: { defaultUrl: string; busy: boolean; onAuthenticate: (input: PublishingLogin) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [serverUrl, setServerUrl] = useState(defaultUrl || '');
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [visible, setVisible] = useState(false);
  useEffect(() => {
    if (defaultUrl && !serverUrl) setServerUrl(defaultUrl);
  }, [defaultUrl]);
  const field = 'block w-full h-11 rounded-[10px] border border-[#DAD8CE] bg-white px-3.5 text-[15px] text-[#141413] placeholder:text-[#A8A69C] shadow-[0_1px_0_rgba(20,20,19,0.02)] transition-[border-color,box-shadow] duration-150 hover:border-[#C7C4B8] focus:outline-none focus-visible:border-[#D97757] focus-visible:ring-[3px] focus-visible:ring-[#D97757]/20 user-invalid:border-rose-600 disabled:cursor-not-allowed disabled:opacity-60';
  const label = 'mb-1.5 block text-[13px] font-medium text-[#3D3D3A]';
  const switchMode = () => { setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); setVisible(false); };
  return <section>
    <h2 id="publishing-account-title" className="sr-only">{mode === 'login' ? '登录 Alex 账号' : '注册 Alex 账号'}</h2>
    <form method="post" aria-labelledby="publishing-account-title" className="space-y-4 [@media(max-height:640px)]:space-y-3" onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      void onAuthenticate({ mode, url: serverUrl.trim(), username, password }).finally(() => { setPassword(''); setVisible(false); });
    }}>
      <div>
        <label htmlFor="publishing-server-url" className={label}>自建服务地址</label>
        <input id="publishing-server-url" name="serverUrl" type="url" inputMode="url" autoComplete="url" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required placeholder="https://protoflow.example.com 或 http://localhost:8088" aria-describedby="publishing-server-url-help" value={serverUrl} onChange={e => setServerUrl(e.target.value)} disabled={busy} className={field} />
        <p id="publishing-server-url-help" className="mt-1.5 text-xs text-[#8A887F]">支持 HTTPS 域名或 http://localhost:8088 等内网地址</p>
      </div>
      <div>
        <label htmlFor="publishing-username" className={label}>用户名</label>
        <input id="publishing-username" name="username" autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="next" required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.\-]{3,40}" placeholder="输入用户名" aria-describedby="publishing-username-help" value={username} onChange={e => setUsername(e.target.value)} disabled={busy} className={field} />
        <p id="publishing-username-help" className="mt-1.5 text-xs text-[#8A887F]">3–40 位字母、数字、下划线、点或短横线</p>
      </div>
      <div>
        <label htmlFor="publishing-password" className={label}>密码</label>
        <div className="relative">
          <input id="publishing-password" name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} enterKeyHint="done" required minLength={mode === 'register' ? 8 : undefined} maxLength={128} placeholder={mode === 'login' ? '输入密码' : '设置密码'} aria-describedby={mode === 'register' ? 'publishing-password-help' : undefined} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} className={`${field} pr-16`} />
          <button type="button" aria-pressed={visible} aria-label={visible ? '隐藏密码' : '显示密码'} disabled={busy} onClick={() => setVisible(value => !value)} className="absolute inset-y-1 right-1 rounded-lg px-2.5 text-xs font-medium text-[#73726C] transition-colors hover:bg-[#F0EEE6] hover:text-[#141413] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/40 disabled:opacity-50">{visible ? '隐藏' : '显示'}</button>
        </div>
        {mode === 'register' && <p id="publishing-password-help" className="mt-1.5 text-xs text-[#8A887F]">至少 8 个字符，最多 128 字节</p>}
      </div>
      <button type="submit" disabled={busy} className="!mt-6 flex [@media(max-height:640px)]:!mt-4 h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#141413] text-[15px] font-medium text-[#FAF9F5] transition-colors hover:bg-[#2B2A27] active:bg-[#000] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#D97757]/35 disabled:cursor-not-allowed disabled:opacity-50">
        {busy && <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-[#FAF9F5]/30 border-t-[#FAF9F5]" />}
        {busy ? '正在处理…' : mode === 'login' ? '登录账号' : '注册并登录'}
      </button>
    </form>
    <p className="mt-5 text-center text-[13px] text-[#73726C] [@media(max-height:640px)]:mt-4">
      {mode === 'login' ? '还没有账号？' : '已有账号？'}
      <button type="button" disabled={busy} onClick={switchMode} className="ml-1 rounded font-medium text-[#141413] underline decoration-[#C7C4B8] underline-offset-4 transition-colors hover:decoration-[#141413] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/40 disabled:opacity-50">{mode === 'login' ? '注册' : '登录'}</button>
    </p>
  </section>;
}
