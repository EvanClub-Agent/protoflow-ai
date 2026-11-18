import React, { useEffect, useState } from 'react';
import { Bot, X, Download, KeyRound, SlidersHorizontal, ArrowUpRight, RefreshCw, Check, LoaderCircle, BookOpen, History, Brain, Plug, Puzzle, CalendarClock, Radio, Activity, Archive, ScrollText, ChevronRight } from 'lucide-react';
import { useHermesStore } from '../store/useHermesStore';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { getHermesApi, type HermesManagementSection } from '../services/hermesClient';
import { HermesSessionControls } from './HermesSessionControls';
import { HermesAccountsPanel } from './HermesAccountsPanel';

const operations: { section: HermesManagementSection; title: string; description: string; icon: typeof Bot }[] = [
  { section: 'skills', title: '技能库', description: '安装、启用和管理 AI 技能', icon: BookOpen },
  { section: 'history', title: '对话历史', description: '查看和管理 Hermes 历史会话', icon: History },
  { section: 'memory', title: 'AI 记忆', description: '查看记忆状态与清理选项', icon: Brain },
  { section: 'tools', title: '工具连接', description: '连接外部服务与 MCP 工具', icon: Plug },
  { section: 'plugins', title: '扩展插件', description: '安装和管理更多能力', icon: Puzzle },
  { section: 'schedules', title: '定时任务', description: '安排 AI 自动执行的任务', icon: CalendarClock },
  { section: 'channels', title: '消息渠道', description: '连接聊天平台与通知渠道', icon: Radio },
  { section: 'diagnostics', title: '更新与诊断', description: '检查版本、升级与排查问题', icon: Activity },
  { section: 'backup', title: '备份与恢复', description: '备份个人配置、技能和会话', icon: Archive },
];
const button = 'rounded-lg px-3 py-2 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed';

export function HermesEnginePanel({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }) {
  const h = useHermesStore();
  const [home, setHome] = useState(h.hermesHomePath);
  const [binary, setBinary] = useState(h.binaryPath);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const desktop = Boolean((window as unknown as { protoflowDesktop?: { hermes?: unknown } }).protoflowDesktop?.hermes);
  const installation = h.installation;
  const installing = installation?.status === 'running' || installation?.status === 'cancelling';
  const connected = h.status === 'running';
  const detected = Boolean(h.binaryPath && h.currentVersion);
  const executing = Object.values(h.runningProjects).some(Boolean);
  const locked = Boolean(busy) || installing || h.status === 'scanning' || h.status === 'updating';
  const managementDisabled = !desktop || !detected || locked || executing;
  useEffect(() => { setHome(h.hermesHomePath); setBinary(h.binaryPath); }, [h.hermesHomePath, h.binaryPath]);
  useEffect(() => {
    if (desktop) void useHermesStore.getState().loadInstallation().catch(e => setFailure(String(e)));
  }, [desktop]);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setNotice(''); setFailure('');
    try { await fn(); } catch (e) { setFailure(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };
  const open = (section: HermesManagementSection, label: string) => {
    if (section === 'accounts') { setAccountsOpen(true); return; }
    void run(`正在打开${label}…`, () => getHermesApi().openManagement({ section }));
  };
  const connect = () => run('正在连接 Hermes…', async () => {
    await h.scanLocalHermes();
    if (useHermesStore.getState().status !== 'detected_local') throw new Error('尚未找到 Hermes，请使用“自动安装并连接”。');
    await useHermesStore.getState().mountDetectedLocalHermes();
  });
  if (accountsOpen) return <HermesAccountsPanel onBack={() => setAccountsOpen(false)} />;
  return <section aria-label="AI 管理中心" className="bg-white text-slate-900 flex flex-col h-full p-5 gap-5 overflow-y-auto">
    <header className="flex items-start justify-between gap-3 shrink-0">
      <div className="flex gap-3 items-center">
        <span className="p-2 rounded-xl bg-blue-50 text-blue-600"><Bot className="w-5 h-5" /></span>
        <div><h2 className="text-lg font-semibold tracking-tight">AI 管理中心</h2><p className="text-xs text-slate-500 mt-1">由 Hermes 驱动，从安装到日常管理都在这里完成。</p></div>
      </div>
      {onClose && <button aria-label="关闭 AI 管理中心" className="p-1 text-slate-500 hover:bg-slate-100 rounded" onClick={onClose}><X className="w-5 h-5" /></button>}
    </header>

    {!desktop && <p className="text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-lg p-3">请在 Alex 桌面应用中使用自动安装和 AI 管理功能。网页预览不连接电脑上的 Hermes。</p>}

    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 shrink-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {installing ? '正在准备 Hermes' : connected ? 'Hermes 已连接' : detected ? 'Hermes 已安装，尚未连接' : '准备你的 AI 助手'}
          {connected && <span className="text-xs text-slate-400 font-normal">{h.currentVersion}</span>}
        </div>
        <div className="flex gap-2">
          {detected && <button disabled={!desktop || locked || executing} className={button} onClick={() => void run('正在升级 Hermes，完成后会自动重新连接…', h.upgradeHermesRuntime)}>升级 Hermes</button>}
          {connected && <button disabled={locked || executing} className={button} onClick={() => void run('正在重新连接…', h.reconnect)}>重新连接</button>}
        </div>
      </div>
      <p className="text-xs text-slate-500 leading-5">{connected ? '服务已连接。使用 AI 前，请确认账号已授权，并选择可用模型。' : '自动检测已有安装；首次使用时，应用会为你下载并配置 Hermes。'}</p>
      {!connected && !installing && <div className="flex flex-wrap gap-2">
        <button disabled={!desktop || locked || executing} className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg px-4 py-2.5 disabled:opacity-45" onClick={() => void run('正在准备安装…', h.startInstallation)}>
          <Download className="w-4 h-4" />{['error', 'cancelled', 'interrupted'].includes(installation?.status ?? '') ? '重试安装并连接' : '自动安装并连接'}
        </button>
        <button disabled={!desktop || locked || executing || installation?.needsResume} className={button} onClick={() => void connect()}>已有 Hermes，直接连接</button>
        {detected && <button disabled={!desktop || locked || executing} className={button} onClick={() => void run('正在修复连接组件…', h.repairInstallation)}>修复连接组件</button>}
      </div>}
      {installation && installation.status !== 'idle' && <div aria-live="polite" className="text-xs space-y-2">
        {installing && <><div className="flex items-center gap-2 text-blue-700"><LoaderCircle className="w-3.5 h-3.5 animate-spin" />{installation.phase}<span className="ml-auto text-slate-400">已完成 {installation.completed} / {installation.total} 步</span></div><progress aria-label="Hermes 安装进度" value={installation.completed} max={installation.total} className="w-full h-1.5 accent-blue-600" /><p className="text-slate-500">首次安装需要下载运行组件，请保持网络连接。系统可能弹出组件安装提示。</p><button className={button} disabled={installation.status === 'cancelling'} onClick={() => void run('正在取消…', h.cancelInstallation)}>{installation.status === 'cancelling' ? '正在取消…' : '取消安装'}</button></>}
        {installation.message && <p className={installation.status === 'error' ? 'text-rose-700' : 'text-slate-600'}>{installation.message}</p>}
        {installation.status === 'error' && installation.needsResume && <button className={button} onClick={() => void run('正在打开安装日志…', () => getHermesApi().openInstallLog())}>查看安装日志</button>}
      </div>}
    </div>

    <div className="grid grid-cols-3 gap-3 shrink-0">
      {[{ n: '1', title: '准备 Hermes', text: connected ? '已连接应用' : '自动安装，一步连接', icon: connected ? Check : Download, section: null },
        { n: '2', title: '连接 AI 账号', text: '登录服务或填写 API 密钥', icon: KeyRound, section: 'accounts' as const },
        { n: '3', title: '选择默认模型', text: '设置新对话使用的模型', icon: SlidersHorizontal, section: 'models' as const }].map(step => <button key={step.n} disabled={step.section ? managementDisabled : !desktop || locked || connected || executing} className="text-left rounded-xl border border-slate-200 p-3 hover:border-blue-300 hover:bg-blue-50/30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:border-slate-200" onClick={() => step.section ? open(step.section, step.title) : void run('正在准备安装…', h.startInstallation)}>
          <div className="flex items-center justify-between mb-3"><span className="text-[10px] font-medium text-slate-400">步骤 {step.n}</span><step.icon className={`w-4 h-4 ${step.n === '1' && connected ? 'text-emerald-600' : 'text-blue-600'}`} /></div>
          <p className="text-xs font-semibold">{step.title}</p><p className="text-[11px] text-slate-500 leading-4 mt-1">{step.text}</p>
        </button>)}
    </div>

    {h.configurationChanged && <div className="flex items-center justify-between gap-3 bg-blue-50 rounded-lg p-3 text-xs text-blue-800"><span>如果刚刚修改了账号或模型设置，重新连接后即可应用。</span><button disabled={locked || executing} className={button} onClick={() => void run('正在应用设置…', h.reconnect)}>应用设置</button></div>}
    {!embedded && connected && <div className="space-y-2 shrink-0"><h3 className="text-xs font-semibold">当前对话的模型</h3><HermesSessionControls /></div>}

    <div className="space-y-3 shrink-0">
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">常用操作</h3><span className="text-[11px] text-slate-400">在应用内打开 Hermes 管理页</span></div>
      <div className="grid grid-cols-3 gap-2">
        {operations.map(({ section, title, description, icon: Icon }) => <button key={section} disabled={managementDisabled} onClick={() => open(section, title)} className="group text-left p-3 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed">
          <div className="flex gap-2 items-center"><Icon className="w-4 h-4 text-slate-500 shrink-0" /><span className="text-xs font-medium">{title}</span><ArrowUpRight className="w-3 h-3 ml-auto text-slate-300 group-hover:text-blue-600" /></div><p className="text-[11px] text-slate-500 mt-2 leading-4">{description}</p>
        </button>)}
      </div>
      <p className="text-[11px] text-slate-400 leading-4">管理页中的配置作用于当前 Hermes 环境；项目内切换模型只影响当前对话。{executing ? '正在生成内容，完成或停止后可修改设置。' : ''}</p>
    </div>

    {busy && <p role="status" className="flex items-center gap-2 text-xs text-blue-700"><LoaderCircle className="w-3.5 h-3.5 animate-spin" />{busy}</p>}
    {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
    {(failure || h.error) && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-2"><p>当前操作未完成。可以重新连接，或打开“更新与诊断”检查环境。</p><details><summary className="cursor-pointer">查看错误详情</summary><p className="mt-2 break-words whitespace-pre-wrap">{failure || h.error}</p></details></div>}

    <div className="border-t border-slate-200 pt-3 shrink-0">
      <button aria-expanded={advanced} className="flex gap-1 items-center text-xs text-slate-500" onClick={() => setAdvanced(!advanced)}><ChevronRight className={`w-3 h-3 ${advanced ? 'rotate-90' : ''}`} />高级设置</button>
      {advanced && <div className="space-y-3 mt-3">
        <p className="text-xs text-slate-500">仅在需要使用其他 Hermes 环境时修改。日常使用无需设置路径。</p>
        <label className="block text-xs">Hermes 配置目录<input className="block w-full border border-slate-300 rounded p-2 mt-1" value={home} onChange={e => setHome(e.target.value)} /></label>
        <label className="block text-xs">Hermes 可执行文件<input className="block w-full border border-slate-300 rounded p-2 mt-1" value={binary} onChange={e => setBinary(e.target.value)} placeholder="留空则自动检测" /></label>
        <div className="flex gap-2 flex-wrap">
          <button disabled={!desktop || locked || executing} className={button} onClick={() => void run('正在切换环境…', async () => {
            await h.scanLocalHermes(home, binary);
            if (useHermesStore.getState().status !== 'detected_local') throw new Error('所选环境不可用，请检查路径');
            await useHermesStore.getState().mountDetectedLocalHermes();
          })}>连接此环境</button>
          <button disabled={!desktop || locked || !connected || executing} className={button} onClick={() => void run('正在断开…', h.disableHermes)}>停用 AI</button>
          <button disabled={managementDisabled} className={button} onClick={() => open('logs', '运行日志')}><ScrollText className="w-3 h-3 inline mr-1" />运行日志</button>
          <button disabled={managementDisabled} className={button} onClick={() => open('settings', '完整设置')}>完整设置</button>
          {!embedded && <button disabled={locked || !connected || executing} className={button} onClick={() => void run('正在同步项目指令…', async () => {
            const p = useProtoStore.getState();
            await h.syncProtoFlowSkillToHermes(p.dbTables, usePageStore.getState().compositeBlocks, p.stickyNotes);
            setNotice('项目指令已同步');
          })}><RefreshCw className="w-3 h-3 inline mr-1" />同步项目指令</button>}
        </div>
      </div>}
    </div>
  </section>;
}
