import React, { useEffect, useState } from 'react';
import { Bot, X, Download, KeyRound, SlidersHorizontal, ArrowUpRight, RefreshCw, Check, LoaderCircle, BookOpen, History, Brain, Plug, Puzzle, CalendarClock, Radio, Activity, Archive, ScrollText, ChevronRight } from 'lucide-react';
import { useHermesStore } from '../store/useHermesStore';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { getHermesApi, type HermesManagementSection } from '../services/hermesClient';
import { HermesSessionControls } from './HermesSessionControls';
import { HermesAccountsPanel } from './HermesAccountsPanel';
import { useI18n } from '../i18n';

const button = 'rounded-lg px-3 py-2 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed';

export function HermesEnginePanel({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }) {
  const { tr, td } = useI18n();
  const operations: { section: HermesManagementSection; title: string; description: string; icon: typeof Bot }[] = [
    { section: 'skills', title: tr('技能库', 'Skills'), description: tr('安装、启用和管理 AI 技能', 'Install, enable, and manage AI skills'), icon: BookOpen },
    { section: 'history', title: tr('对话历史', 'Chat History'), description: tr('查看和管理 Hermes 历史会话', 'Browse and manage Hermes sessions'), icon: History },
    { section: 'memory', title: tr('AI 记忆', 'AI Memory'), description: tr('查看记忆状态与清理选项', 'Inspect memory status and cleanup options'), icon: Brain },
    { section: 'tools', title: tr('工具连接', 'Tool Connections'), description: tr('连接外部服务与 MCP 工具', 'Connect external services and MCP tools'), icon: Plug },
    { section: 'plugins', title: tr('扩展插件', 'Extensions'), description: tr('安装和管理更多能力', 'Install and manage add-on capabilities'), icon: Puzzle },
    { section: 'schedules', title: tr('定时任务', 'Schedules'), description: tr('安排 AI 自动执行的任务', 'Schedule automated AI tasks'), icon: CalendarClock },
    { section: 'channels', title: tr('消息渠道', 'Channels'), description: tr('连接聊天平台与通知渠道', 'Connect chat platforms and notifications'), icon: Radio },
    { section: 'diagnostics', title: tr('更新与诊断', 'Updates & Diagnostics'), description: tr('检查版本、升级与排查问题', 'Check versions, upgrade, and troubleshoot'), icon: Activity },
    { section: 'backup', title: tr('备份与恢复', 'Backup & Restore'), description: tr('备份个人配置、技能和会话', 'Back up configs, skills, and sessions'), icon: Archive },
  ];
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
  const external = installation?.selectedRuntime === 'external';
  const legacyManaged = installation?.selectedRuntime === 'legacy-managed';
  const previous = installation?.previousExternal;
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
    void run(tr(`正在打开${label}…`, `Opening ${label}…`), () => getHermesApi().openManagement({ section }));
  };
  if (accountsOpen) return <HermesAccountsPanel onBack={() => setAccountsOpen(false)} />;
  return <section aria-label={tr('AI 管理中心', 'AI Center')} className="bg-white text-slate-900 flex flex-col h-full p-5 gap-5 overflow-y-auto">
    <header className="flex items-start justify-between gap-3 shrink-0">
      <div className="flex gap-3 items-center min-w-0">
        <span className="p-2 rounded-xl bg-blue-50 text-blue-600 shrink-0"><Bot className="w-5 h-5" /></span>
        <div className="min-w-0"><h2 className="text-lg font-semibold tracking-tight">{tr('AI 管理中心', 'AI Center')}</h2><p className="text-xs text-slate-500 mt-1">{tr('由 Hermes 驱动，从安装到日常管理都在这里完成。', 'Powered by Hermes — manage installation, accounts, models, and tools in one place.')}</p></div>
      </div>
      {onClose && <button aria-label={tr('关闭 AI 管理中心', 'Close AI Center')} className="p-1 text-slate-500 hover:bg-slate-100 rounded shrink-0" onClick={onClose}><X className="w-5 h-5" /></button>}
    </header>

    {!desktop && <p className="text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-lg p-3">{tr('请在 Alex 桌面应用中使用自动安装和 AI 管理功能。网页预览不连接电脑上的 Hermes。', 'Use the Alex desktop app for automatic installation and AI management. Web preview does not connect to your local Hermes runtime.')}</p>}

    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 shrink-0 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className={`h-2 w-2 rounded-full shrink-0 ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {installing ? tr('正在准备 Hermes', 'Preparing Hermes') : connected ? tr('Hermes 已连接', 'Hermes Connected') : detected ? tr('Hermes 已安装，尚未连接', 'Hermes Installed (Disconnected)') : tr('准备你的 AI 助手', 'Set Up Your AI Assistant')}
          {connected && <span className="text-xs text-slate-400 font-normal tabular-nums">{h.currentVersion}</span>}
        </div>
        <div className="flex gap-2">
          {detected && installation?.selectedRuntime === 'managed' && <button disabled={!desktop || locked || executing} className={button} onClick={() => void run(tr('正在升级 Hermes，完成后会自动重新连接…', 'Upgrading Hermes — will reconnect automatically…'), h.upgradeHermesRuntime)}>{tr('升级 Hermes', 'Upgrade Hermes')}</button>}
          {connected && <button disabled={locked || executing} className={button} onClick={() => void run(tr('正在重新连接…', 'Reconnecting…'), h.reconnect)}>{tr('重新连接', 'Reconnect')}</button>}
        </div>
      </div>
      <p className="text-xs text-slate-500 leading-5">{external ? tr('当前使用外部 Hermes。切换后，请在托管环境中授权账号。旧对话和草稿保存在原环境，版本兼容时可从高级设置切回。', 'Using an external Hermes runtime. After switching to managed mode, authorize your accounts there. Previous sessions stay in your external environment and can be restored from Advanced Settings.') : legacyManaged ? tr('当前使用旧版 Alex 安装的 Hermes。切换到独立版本后将继续使用当前账号配置和工作区。', 'Using a legacy Alex-managed Hermes runtime. Switching to the isolated runtime preserves your current accounts and workspace.') : tr('Alex 使用独立的 Hermes 托管运行时。本机其他 Hermes 的升级和降级不影响它。', 'Alex runs an isolated managed Hermes runtime unaffected by other Hermes installations on this computer.')}</p>
      {(!connected || external || legacyManaged) && !installing && <div className="flex flex-wrap gap-2">
        <button disabled={!desktop || locked || executing} className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg px-4 py-2.5 disabled:opacity-45" onClick={() => void run(tr('正在准备安装…', 'Preparing installation…'), h.startInstallation)}>
          <Download className="w-4 h-4" />{external || legacyManaged ? tr('使用 Alex 托管运行时', 'Use Alex Managed Runtime') : ['error', 'cancelled', 'interrupted'].includes(installation?.status ?? '') ? tr('重试安装并连接', 'Retry Install & Connect') : tr('自动安装并连接', 'Auto-Install & Connect')}
        </button>
        {!connected && detected && <button disabled={!desktop || locked || executing} className={button} onClick={() => void run(tr('正在修复连接组件…', 'Repairing connection components…'), h.repairInstallation)}>{tr('修复连接组件', 'Repair Connection')}</button>}
      </div>}
      {installation && installation.status !== 'idle' && <div aria-live="polite" className="text-xs space-y-2">
        {installing && <><div className="flex items-center gap-2 text-blue-700"><LoaderCircle className="w-3.5 h-3.5 animate-spin shrink-0" /><span className="min-w-0 truncate">{td(installation.phase)}</span><span className="ml-auto text-slate-400 tabular-nums shrink-0">{tr(`已完成 ${installation.completed} / ${installation.total} 步`, `Step ${installation.completed} / ${installation.total}`)}</span></div><progress aria-label={tr('Hermes 安装进度', 'Hermes installation progress')} value={installation.completed} max={installation.total} className="w-full h-1.5 accent-blue-600" /><p className="text-slate-500">{tr('首次安装需要下载运行组件，请保持网络连接。系统可能弹出组件安装提示。', 'First-time setup downloads runtime components — please stay online. System installer prompts may appear.')}</p><button className={button} disabled={installation.status === 'cancelling'} onClick={() => void run(tr('正在取消…', 'Cancelling…'), h.cancelInstallation)}>{installation.status === 'cancelling' ? tr('正在取消…', 'Cancelling…') : tr('取消安装', 'Cancel Install')}</button></>}
        {installation.message && <p className={installation.status === 'error' ? 'text-rose-700' : 'text-slate-600'}>{td(installation.message)}</p>}
        {installation.status === 'error' && installation.needsResume && <button className={button} onClick={() => void run(tr('正在打开安装日志…', 'Opening install log…'), () => getHermesApi().openInstallLog())}>{tr('查看安装日志', 'View Install Log')}</button>}
      </div>}
    </div>

    <div className="grid grid-cols-3 gap-3 shrink-0">
      {[{ n: '1', title: tr('准备 Hermes', 'Set Up Hermes'), text: connected ? tr('已连接应用', 'Connected to app') : tr('自动安装，一步连接', 'One-click install & connect'), icon: connected ? Check : Download, section: null },
        { n: '2', title: tr('连接 AI 账号', 'Connect AI Account'), text: tr('登录服务或填写 API 密钥', 'Sign in or paste an API key'), icon: KeyRound, section: 'accounts' as const },
        { n: '3', title: tr('选择默认模型', 'Default Model'), text: tr('设置新对话使用的模型', 'Choose model for new chats'), icon: SlidersHorizontal, section: 'models' as const }].map(step => <button key={step.n} disabled={step.section ? managementDisabled : !desktop || locked || connected || executing} className="min-w-0 text-left rounded-xl border border-slate-200 p-3 hover:border-blue-300 hover:bg-blue-50/30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:border-slate-200" onClick={() => step.section ? open(step.section, step.title) : void run(tr('正在准备安装…', 'Preparing installation…'), h.startInstallation)}>
          <div className="flex items-center justify-between mb-3"><span className="text-[10px] font-medium text-slate-400">{tr(`步骤 ${step.n}`, `Step ${step.n}`)}</span><step.icon className={`w-4 h-4 shrink-0 ${step.n === '1' && connected ? 'text-emerald-600' : 'text-blue-600'}`} /></div>
          <p className="text-xs font-semibold truncate">{step.title}</p><p className="text-[11px] text-slate-500 leading-4 mt-1 line-clamp-2">{step.text}</p>
        </button>)}
    </div>

    {h.configurationChanged && <div className="flex items-center justify-between gap-3 bg-blue-50 rounded-lg p-3 text-xs text-blue-800"><span>{tr('如果刚刚修改了账号或模型设置，重新连接后即可应用。', 'Reconnect to apply your updated account or model settings.')}</span><button disabled={locked || executing} className={`${button} shrink-0`} onClick={() => void run(tr('正在应用设置…', 'Applying settings…'), h.reconnect)}>{tr('应用设置', 'Apply Settings')}</button></div>}
    {!embedded && connected && <div className="space-y-2 shrink-0"><h3 className="text-xs font-semibold">{tr('当前对话的模型', 'Active Chat Model')}</h3><HermesSessionControls /></div>}

    <div className="space-y-3 shrink-0">
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{tr('常用操作', 'Management')}</h3><span className="text-[11px] text-slate-400">{tr('在应用内打开 Hermes 管理页', 'Opens Hermes management view inside Alex')}</span></div>
      <div className="grid grid-cols-3 gap-2">
        {operations.map(({ section, title, description, icon: Icon }) => <button key={section} disabled={managementDisabled} onClick={() => open(section, title)} className="group min-w-0 text-left p-3 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed">
          <div className="flex gap-2 items-center min-w-0"><Icon className="w-4 h-4 text-slate-500 shrink-0" /><span className="text-xs font-medium truncate">{title}</span><ArrowUpRight className="w-3 h-3 ml-auto shrink-0 text-slate-300 group-hover:text-blue-600" /></div><p className="text-[11px] text-slate-500 mt-2 leading-4 line-clamp-2">{description}</p>
        </button>)}
      </div>
      <p className="text-[11px] text-slate-400 leading-4">{tr('管理页中的配置作用于当前 Hermes 环境；项目内切换模型只影响当前对话。', 'Management settings apply to the active Hermes environment; switching models inside a project affects only that conversation.')}{executing ? tr('正在生成内容，完成或停止后可修改设置。', ' AI is currently generating — wait or stop to change settings.') : ''}</p>
    </div>

    {busy && <p role="status" className="flex items-center gap-2 text-xs text-blue-700"><LoaderCircle className="w-3.5 h-3.5 animate-spin" />{busy}</p>}
    {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
    {(failure || h.error) && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-2"><p>{tr('当前操作未完成。可以重新连接，或打开“更新与诊断”检查环境。', 'Action incomplete. Try reconnecting or open "Updates & Diagnostics" to inspect your environment.')}</p><details><summary className="cursor-pointer">{tr('查看错误详情', 'View Error Details')}</summary><p className="mt-2 break-words whitespace-pre-wrap">{td(failure || h.error || '')}</p></details></div>}

    <div className="border-t border-slate-200 pt-3 shrink-0">
      <button aria-expanded={advanced} className="flex gap-1 items-center text-xs text-slate-500" onClick={() => setAdvanced(!advanced)}><ChevronRight className={`w-3 h-3 ${advanced ? 'rotate-90' : ''}`} />{tr('高级设置', 'Advanced Settings')}</button>
      {advanced && <div className="space-y-3 mt-3">
        <p className="text-xs text-slate-500">{tr('仅在需要使用其他 Hermes 环境时修改。日常使用无需设置路径。', 'Modify only if you want to mount a custom Hermes installation. Leave unchanged for normal use.')}</p>
        {previous && <button disabled={!desktop || locked || executing} className={button} onClick={() => void run(tr('正在连接原 Hermes 环境…', 'Connecting previous Hermes environment…'), () => h.mountDetectedLocalHermes(previous))}>{tr('切回原 Hermes 环境', 'Restore Previous Hermes Environment')}</button>}
        <label className="block text-xs">{tr('Hermes 配置目录', 'Hermes Home Directory')}<input className="block w-full border border-slate-300 rounded p-2 mt-1" value={home} onChange={e => setHome(e.target.value)} /></label>
        <label className="block text-xs">{tr('Hermes 可执行文件', 'Hermes Executable Path')}<input className="block w-full border border-slate-300 rounded p-2 mt-1" value={binary} onChange={e => setBinary(e.target.value)} placeholder={tr('留空则自动检测', 'Leave blank to auto-detect')} /></label>
        <div className="flex gap-2 flex-wrap">
          <button disabled={!desktop || locked || executing} className={button} onClick={() => void run(tr('正在切换环境…', 'Switching environment…'), async () => {
            if (!home.trim()) throw new Error(tr('请输入 Hermes 配置目录', 'Please enter a Hermes home directory'));
            await h.mountDetectedLocalHermes({ home, binary: binary || undefined });
          })}>{tr('连接此环境', 'Mount Environment')}</button>
          <button disabled={!desktop || locked || !connected || executing} className={button} onClick={() => void run(tr('正在断开…', 'Disconnecting…'), h.disableHermes)}>{tr('停用 AI', 'Disable AI')}</button>
          <button disabled={managementDisabled} className={button} onClick={() => open('logs', tr('运行日志', 'Runtime Logs'))}><ScrollText className="w-3 h-3 inline mr-1" />{tr('运行日志', 'Runtime Logs')}</button>
          <button disabled={managementDisabled} className={button} onClick={() => open('settings', tr('完整设置', 'Full Settings'))}>{tr('完整设置', 'Full Settings')}</button>
          {!embedded && <button disabled={locked || !connected || executing} className={button} onClick={() => void run(tr('正在同步项目指令…', 'Syncing project skill…'), async () => {
            const p = useProtoStore.getState();
            await h.syncProtoFlowSkillToHermes(p.dbTables, usePageStore.getState().compositeBlocks, p.stickyNotes);
            setNotice(tr('项目指令已同步', 'Project skill synced'));
          })}><RefreshCw className="w-3 h-3 inline mr-1" />{tr('同步项目指令', 'Sync Project Skill')}</button>}
        </div>
      </div>}
    </div>
  </section>;
}
