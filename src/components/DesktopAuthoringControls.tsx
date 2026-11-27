import React, { useCallback, useEffect, useId, useState } from 'react';
import { CheckCircle2, ChevronRight, Download, Eye, Sparkles, Undo2, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  desktopAuthoringApi, disableDesktopAuthoring, enableDesktopAuthoring, runClientIntegration, useDesktopAuthoring, type SkillClient,
} from '../services/desktopAuthoring';
import { canUndoProjectChange, undoProjectChange } from '../services/projectUndo';
import { useProjectSaveStore } from '../services/projectAutosave';
import { useProtoStore } from '../store/useProtoStore';
import { useHermesStore } from '../store/useHermesStore';

export function DesktopAuthoringControls() {
  const { tr } = useI18n();
  const baseId = useId();
  const readonlyRadioId = `${baseId}-readonly`;
  const liveRadioId = `${baseId}-live`;
  const connection = useDesktopAuthoring(s => s.connectionPath);
  const enabled = useDesktopAuthoring(s => s.enabled);
  const connectionError = useDesktopAuthoring(s => s.connectionError);
  const [busy, setBusy] = useState(false);
  const [statusInfo, setStatusInfo] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const api = desktopAuthoringApi();
  if (!api) return null;

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setStatusInfo(null);
    try {
      const feedback = await action();
      if (feedback) setStatusInfo({ tone: 'success', text: feedback });
    } catch (error) {
      setStatusInfo({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const install = (client: SkillClient, label: string) => run(async () => {
    const path = await api.installSkill(client);
    return tr(`已为 ${label} 安装原型设计技能（路径：${path}）`, `Installed designer skill for ${label} at ${path}`);
  });

  const activeError = connectionError ?? (statusInfo?.tone === 'error' ? statusInfo.text : null);
  const activeSuccess = !activeError && statusInfo?.tone === 'success' ? statusInfo.text : null;

  return (
    <div className="space-y-3.5">
      <fieldset disabled={busy} className="space-y-2">
        <legend className="mb-1.5 text-xs font-bold text-slate-900">
          {tr('第一步：选择外部 AI 对当前原型的操作权限', 'Step 1: Choose what external AI can do with this prototype')}
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <label
            htmlFor={liveRadioId}
            className={`relative flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition ${
              enabled
                ? 'border-blue-500 bg-blue-50/60 shadow-2xs'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <input
              id={liveRadioId}
              type="radio"
              name="mcp-local-mode"
              checked={enabled}
              onChange={() => void run(async () => { await enableDesktopAuthoring(); return null; })}
              className="mt-0.5 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 shrink-0"
            />
            <span className="min-w-0 space-y-1">
              <span className="flex items-center gap-1.5 flex-wrap font-semibold text-slate-900">
                <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                <span>{tr('双向设计', 'Bidirectional design')}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-blue-100/90 text-[10px] font-semibold text-blue-700">
                  {tr('让 AI 帮我画原型', 'Let AI build & edit')}
                </span>
              </span>
              <span className="block text-[11px] text-slate-600 leading-relaxed">
                {tr(
                  '允许 AI 直接在当前画布新建和修改页面、数据表与便签。所有改动自动保存，不满意随时按 ⌘Z / Ctrl+Z 撤销。',
                  'Lets AI create and refine pages, tables, and notes live on your canvas. Autosaves with instant ⌘Z / Ctrl+Z undo.'
                )}
              </span>
            </span>
          </label>

          <label
            htmlFor={readonlyRadioId}
            className={`relative flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition ${
              !enabled
                ? 'border-blue-500 bg-blue-50/60 shadow-2xs'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <input
              id={readonlyRadioId}
              type="radio"
              name="mcp-local-mode"
              checked={!enabled}
              onChange={() => void run(async () => { await disableDesktopAuthoring(); return null; })}
              className="mt-0.5 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 shrink-0"
            />
            <span className="min-w-0 space-y-1">
              <span className="flex items-center gap-1.5 flex-wrap font-semibold text-slate-900">
                <Eye className="w-3.5 h-3.5 text-slate-600 shrink-0" aria-hidden="true" />
                <span>{tr('只读规格', 'Read-only specs')}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[10px] font-medium text-slate-600">
                  {tr('只读不改原型', 'Safe view-only')}
                </span>
              </span>
              <span className="block text-[11px] text-slate-600 leading-relaxed">
                {tr(
                  '外部 AI 只能读取页面、表结构和产品便签去生成研发代码，绝不会修改你的原型文件。',
                  'External AI can only read your pages, schemas, and notes to write code — your prototype stays untouched.'
                )}
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {connection && (
        <fieldset disabled={busy} className="rounded-xl border border-blue-200/80 bg-white p-3.5 space-y-3 shadow-2xs">
          <legend className="px-1 text-xs font-bold text-slate-900">
            {tr('第二步：一键连接你的 AI 助手（只需装一次，新建或换项目自动连通）', 'Step 2: Connect your AI assistant in one click (set up once — follows any open project)')}
          </legend>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 flex flex-col justify-between gap-2.5">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">Antigravity</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200/80 text-[10px] font-semibold text-emerald-700">
                    {tr('一次安装 · 自动同步', 'Install once · Auto-sync')}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {tr(
                    '点击下方按钮自动装好插件与原型技能。开启后自动记忆，以后重启软件、升级版本或切换项目均会自动无感连通。',
                    'Installs the live bridge and design skill in one click. Remembers your preference and auto-syncs across restarts, upgrades, and projects.'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void run(async () => {
                    await runClientIntegration('installPlugin');
                    return tr(
                      'Antigravity 插件已装好！首次安装后即可直接在聊天框提需求；后续打开或切换项目、升级软件都会在后台自动同步，无需再次操作。',
                      'Antigravity plugin is ready! Chat directly to design — future project switches and app upgrades sync automatically in the background.'
                    );
                  })}
                  className="min-h-7 flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 cursor-pointer transition shadow-2xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{tr('安装 Antigravity 插件', 'Install Antigravity plugin')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void run(async () => {
                    await runClientIntegration('installPlugin', { forceRepair: true });
                    return tr(
                      '已强制修复并重置 Antigravity 插件与技能文件，所有核心工具均已恢复最新状态。',
                      'Force-repaired Antigravity plugin and skill files to a clean latest state.'
                    );
                  })}
                  title={tr('当本地插件目录异常或冲突时一键重置修复', 'Force-reset and repair plugin files if corrupted')}
                  className="min-h-7 shrink-0 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 cursor-pointer transition shadow-2xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
                >
                  {tr('修复', 'Repair')}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 flex flex-col justify-between gap-2.5">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">Claude Desktop</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-medium text-slate-600">
                    {tr('扩展包双击即用', 'One-file installer')}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {tr(
                    '导出一个专属扩展文件，双击用 Claude 桌面端打开并点一次确认，就能在聊天时直接绘制和修改当前原型。',
                    'Save an extension package, open it in Claude Desktop and confirm once to design and edit this prototype by chat.'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void run(async () => {
                  const path = await runClientIntegration('exportExtension');
                  return path
                    ? tr(`扩展包已保存到 ${path}，双击打开并在 Claude Desktop 中点击确认即可连接。`, `Saved extension to ${path}. Open it in Claude Desktop and confirm to connect.`)
                    : null;
                })}
                className="min-h-7 w-full rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 inline-flex items-center justify-center gap-1.5 cursor-pointer transition shadow-2xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                <span>{tr('导出 Claude Desktop 扩展', 'Export Claude Desktop extension')}</span>
              </button>
            </div>
          </div>

          <details className="group rounded-lg border border-slate-200/80 bg-slate-50/50 px-3 py-2">
            <summary className="list-none flex items-center gap-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded">
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-90 shrink-0" aria-hidden="true" />
              <span>{tr('使用命令行 AI 工具？（为 Codex / Claude Code 安装原型设计技能）', 'Using CLI AI tools? (Install design skill for Codex / Claude Code)')}</span>
            </summary>
            <div className="mt-2.5 pt-2 border-t border-slate-200/70 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] text-slate-500">
                {tr('让命令行 Agent 自动掌握 Alex 页面组件规范与建模流程：', 'Teach CLI agents Alex component rules and ER modeling workflows:')}
              </span>
              <div className="flex flex-wrap gap-2">
                {([['codex', 'Codex'], ['claude', 'Claude Code']] as const).map(([client, label]) => (
                  <button
                    key={client}
                    type="button"
                    onClick={() => void install(client, label)}
                    className="min-h-6 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    {tr(`安装到 ${label}`, `Install for ${label}`)}
                  </button>
                ))}
              </div>
            </div>
          </details>
        </fieldset>
      )}

      <div role="status">
        {activeError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 flex items-start gap-2 break-all">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{activeError}</span>
          </div>
        )}
        {activeSuccess && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[11px] font-medium text-emerald-800 flex items-start gap-2 break-all leading-relaxed">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{activeSuccess}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const summaries: Record<string, string> = {
  'update project meta': '工程信息', 'manage sitemap': '页面目录', 'upsert db tables': '数据表结构',
  'seed tableRows': '演示数据', 'clear tableRows': '演示数据', 'write page': '页面内容',
  'edit page block': '页面组件', 'manage sticky notes': '产品规则便签', 'manage docs and flows': '需求文档与流程图',
};
export function DesktopAuthoringNotice() {
  const { tr } = useI18n();
  const { connectionPath, notice, writing } = useDesktopAuthoring();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const projectId = useProtoStore(s => s.currentProjectMeta.projectId);
  const running = useHermesStore(s => s.runningProjects[projectId]);
  const visible = notice?.projectId === projectId ? notice : null;
  const undoId = visible?.id;
  const current = useProjectSaveStore(() => Boolean(undoId && canUndoProjectChange(undoId)));
  const canUndo = current && !writing && !running;
  const undo = useCallback(() => {
    if (!canUndo || !undoId || !canUndoProjectChange(undoId)) return false;
    undoProjectChange(undoId);
    setDismissed(null);
    return true;
  }, [canUndo, undoId]);
  useEffect(() => {
    if (!canUndo) return;
    const handleUndo = (event: Event) => {
      let focused = document.activeElement;
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
      if (event.defaultPrevented || focused?.closest('input, textarea, select, iframe, [role=textbox], dialog') ||
          (focused instanceof HTMLElement && focused.isContentEditable)) return;
      if (undo()) event.preventDefault();
    };
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !event.isComposing &&
          event.key.toLowerCase() === 'z') handleUndo(event);
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('alex-project-undo', handleUndo);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('alex-project-undo', handleUndo);
    };
  }, [canUndo, undo]);
  const shown = visible && visible.id !== dismissed ? visible : null;
  if (!connectionPath && !shown) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-blue-200/90 bg-blue-50/90 px-4 py-1.5 text-xs text-blue-950">
      <span role="status" className="inline-flex items-center gap-2 font-medium min-w-0">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {shown
            ? tr(`外部 AI 刚刚更新了「${summaries[shown.summary] ?? '工程内容'}」`, `External AI updated: ${shown.summary}`)
            : tr('AI 实时协同设计已开启 · 可直接在外部 AI 助手中对话绘制和修改当前原型', 'Live AI co-design active · Chat in your external AI assistant to build or edit this prototype')}
        </span>
      </span>
      {shown && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!canUndo}
            onClick={undo}
            className="min-h-6 inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-100/60 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <Undo2 className="w-3 h-3" aria-hidden="true" />
            <span>{tr('撤销修改', 'Undo')}</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(shown.id)}
            className="min-h-6 rounded-md px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-100/70 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {tr('知道了', 'Dismiss')}
          </button>
        </div>
      )}
    </div>
  );
}
