import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, LoaderCircle, KeyRound } from 'lucide-react';
import { getHermesApi, type HermesAccountCatalog, type HermesLogin } from '../services/hermesClient';
import { useHermesStore } from '../store/useHermesStore';
const button = 'text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white hover:bg-slate-50 disabled:opacity-50';

export function HermesAccountsPanel({ onBack }: { onBack: () => void }) {
  const [catalog, setCatalog] = useState<HermesAccountCatalog | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [key, setKey] = useState(''), [value, setValue] = useState(''), [code, setCode] = useState('');
  const [login, setLogin] = useState<HermesLogin | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'key' | 'oauth'; id: string } | null>(null);
  const mounted = useRef(false), activeLogin = useRef<HermesLogin | null>(null);
  const executing = useHermesStore(s => Object.values(s.runningProjects).some(Boolean));
  const locked = busy || executing;
  const api = () => getHermesApi().accounts;
  const refresh = async () => { const data = await api().list(); if (mounted.current) setCatalog(data); };
  const changed = () => useHermesStore.setState({ configurationChanged: true });
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true;
    void perform(refresh);
    return () => {
      mounted.current = false;
      if (activeLogin.current) void api().cancel({ sessionId: activeLogin.current.sessionId }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (login?.flow !== 'device_code') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api().poll({ sessionId: login.sessionId });
        if (!alive) return;
        if (result.status === 'pending') timer = setTimeout(() => void poll(), 2000);
        else {
          activeLogin.current = null; setLogin(null);
          if (result.status === 'approved') { changed(); setNotice('账号已连接。返回管理中心后点击“应用设置”。'); await refresh(); }
          else setError(result.status === 'expired' ? '登录已过期，请重新登录。' : '授权未完成，请重试。');
        }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [login]);
  const start = (providerId: string) => perform(async () => {
    const result = await api().start({ providerId });
    if (!mounted.current) { await api().cancel({ sessionId: result.sessionId }); return; }
    activeLogin.current = result; setLogin(result);
    await api().openLogin({ sessionId: result.sessionId });
  });
  const selectedKey = catalog?.keys.find(k => k.key === key);
  return <section aria-label="连接 AI 账号" className="h-full overflow-y-auto bg-white p-5 space-y-5 text-slate-900">
    <button className="flex gap-1 items-center text-xs text-slate-500" onClick={onBack}><ArrowLeft className="w-4 h-4" />返回 AI 管理中心</button>
    <div><h2 className="text-lg font-semibold">连接 AI 账号</h2><p className="text-xs text-slate-500 mt-2 leading-5">选择已有账号登录，或粘贴服务提供的 API 密钥。授权与密钥由 Hermes 管理。</p></div>
    {busy && <p role="status" className="text-xs text-blue-700 flex items-center gap-2"><LoaderCircle className="w-4 h-4 animate-spin" />正在连接 Hermes…</p>}
    {error && <p role="alert" className="bg-rose-50 text-rose-700 rounded-lg p-3 text-xs">{error}<button className="ml-3 underline" onClick={() => void perform(refresh)}>重新读取</button></p>}
    {notice && <p role="status" className="bg-emerald-50 text-emerald-700 rounded-lg p-3 text-xs">{notice}</p>}
    {login && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <h3 className="text-sm font-semibold">在浏览器中完成授权</h3>
      {login.flow === 'device_code' ? <><p className="text-xs text-slate-600">在服务网站输入下面的验证码，完成后会自动更新连接状态。</p><p className="font-mono text-xl tracking-widest select-all">{login.userCode}</p></> : <label className="block text-xs">粘贴授权页面返回的验证码<input type="password" autoComplete="off" className="mt-2 block w-full border border-slate-300 rounded-lg p-2" value={code} onChange={e => setCode(e.target.value)} /></label>}
      <div className="flex gap-2 flex-wrap">
        <button className={button} onClick={() => void perform(async () => api().openLogin({ sessionId: login.sessionId }))}><ExternalLink className="w-3 h-3 inline mr-1" />重新打开授权网页</button>
        {login.flow === 'pkce' && <button disabled={locked || !code.trim()} className={button} onClick={() => void perform(async () => {
          await api().submit({ sessionId: login.sessionId, code }); setCode(''); activeLogin.current = null; setLogin(null); changed(); setNotice('账号已连接。返回后点击“应用设置”。'); await refresh();
        })}>完成登录</button>}
        <button className={button} onClick={() => void perform(async () => { await api().cancel({ sessionId: login.sessionId }); activeLogin.current = null; setLogin(null); setCode(''); })}>取消登录</button>
      </div>
    </div>}
    <div className="space-y-2"><h3 className="text-sm font-semibold">使用账号登录</h3>
      {catalog?.providers.filter(p => p.flow !== 'external').map(p => <div key={p.id} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg p-3">
        <div className="text-xs"><p className="font-medium">{p.name}</p><p className={`mt-1 ${p.connected ? 'text-emerald-600' : 'text-slate-400'}`}>{p.connected ? '已连接' : '尚未连接'}</p></div>
        <button className={button} disabled={locked || Boolean(login)} onClick={() => p.connected ? setConfirm({ kind: 'oauth', id: p.id }) : void start(p.id)}>{p.connected ? '退出账号' : '登录账号'}</button>
      </div>)}
    </div>
    <form className="border border-slate-200 rounded-xl p-4 space-y-3" onSubmit={e => { e.preventDefault(); void perform(async () => {
      await api().saveKey({ key, value }); setValue(''); changed(); setNotice('密钥已保存。返回管理中心选择模型，并点击“应用设置”。'); await refresh();
    }); }}>
      <h3 className="text-sm font-semibold flex gap-2 items-center"><KeyRound className="w-4 h-4 text-blue-600" />使用 API 密钥</h3>
      <label className="block text-xs">选择 AI 服务<select required aria-label="AI 服务" className="block w-full mt-2 p-2 rounded-lg border border-slate-300 bg-white" value={key} onChange={e => { setKey(e.target.value); setValue(''); }}><option value="">请选择服务</option>{catalog?.keys.map(k => <option key={k.key} value={k.key}>{k.name}{k.configured ? '（已保存密钥）' : ''}</option>)}</select></label>
      <label className="block text-xs">API 密钥<input required type="password" autoComplete="off" value={value} disabled={!key || locked} onChange={e => setValue(e.target.value)} placeholder={selectedKey?.configured ? '粘贴新密钥以替换已有密钥' : '粘贴从 AI 服务获取的密钥'} className="block w-full mt-2 p-2 rounded-lg border border-slate-300" /></label>
      <p className="text-[11px] text-slate-500">密钥保存在当前 Hermes 环境中。此处不会显示已保存的密钥；服务可能按使用量收费。</p>
      <div className="flex gap-2"><button type="submit" disabled={locked || !key || !value.trim()} className="text-xs rounded-lg bg-blue-600 text-white px-3 py-2 disabled:opacity-50">保存密钥</button>{selectedKey?.configured && <button type="button" disabled={locked} className={button} onClick={() => setConfirm({ kind: 'key', id: key })}>移除密钥</button>}</div>
    </form>
    {catalog?.providers.some(p => p.flow === 'external') && <details className="text-xs text-slate-500"><summary className="cursor-pointer">其他账号连接方式</summary><div className="space-y-2 mt-3">{catalog.providers.filter(p => p.flow === 'external').map(p => <p key={p.id}>{p.name}：{p.connected ? '已由外部应用连接，Hermes 可继续使用。' : 'Hermes 暂未提供此方式的可视化登录，可在上方配置该服务的 API 密钥。'}</p>)}</div></details>}
    {confirm && <div role="dialog" aria-label="确认移除账号连接" className="border border-amber-300 bg-amber-50 rounded-xl p-4 text-xs space-y-3"><p>移除后，使用此账号的 Hermes 对话可能无法继续。确定移除这个连接吗？</p><div className="flex gap-2"><button className={button} disabled={locked} onClick={() => void perform(async () => { if (confirm.kind === 'key') await api().removeKey({ key: confirm.id }); else await api().disconnect({ providerId: confirm.id }); setConfirm(null); changed(); await refresh(); setNotice('连接已移除。'); })}>确认移除</button><button className={button} onClick={() => setConfirm(null)}>保留连接</button></div></div>}
  </section>;
}
