import React, { useCallback, useEffect, useState } from 'react';
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
  const connection = useDesktopAuthoring(s => s.connectionPath);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const api = desktopAuthoringApi();
  if (!api) return null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const install = (client: SkillClient) => run(async () => {
    const path = await api.installSkill(client);
    setMessage(tr(`Skill 已安装到 ${path}`, `Skill installed at ${path}`));
  });
  return <div className="space-y-2">
    <fieldset disabled={busy} className="flex flex-wrap gap-4">
      <legend className="mb-1 font-semibold">{tr('本地连接权限', 'Local connection permissions')}</legend>
      <label className="flex items-center gap-1"><input type="radio" name="mcp-local-mode" checked={!connection}
        onChange={() => void run(disableDesktopAuthoring)} />{tr('只读规格', 'Read-only specs')}</label>
      <label className="flex items-center gap-1"><input type="radio" name="mcp-local-mode" checked={Boolean(connection)}
        onChange={() => void run(enableDesktopAuthoring)} />{tr('双向设计', 'Bidirectional design')}</label>
    </fieldset>
    {connection && <>
      <p>{tr('外部 Agent 可以编辑当前打开的工程。切换工程后，请重新绑定插件或更新扩展的连接文件。返回启动页或关闭双向设计会断开连接。', 'Agents can edit this open project. After switching projects, rebind the plugin or update the extension’s connection file. Returning to the launcher or switching to read-only disconnects agents.')}</p>
      <fieldset disabled={busy} className="flex flex-wrap gap-2">
        <legend className="mb-1 font-semibold">{tr('客户端扩展', 'Client extensions')}</legend>
        <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs" onClick={() => void run(async () => {
          const path = await runClientIntegration('installPlugin');
          setMessage(tr(`插件已安装到 ${path}。请在 Antigravity 中重新加载插件。`, `Plugin installed at ${path}. Reload plugins in Antigravity.`));
        })}>{tr('安装 Antigravity 插件', 'Install Antigravity plugin')}</button>
        <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1 text-xs" onClick={() => void run(async () => {
          const path = await runClientIntegration('exportExtension');
          if (path) setMessage(tr(`请在 Claude Desktop 中打开 ${path}`, `Open ${path} in Claude Desktop.`));
        })}>{tr('导出 Claude Desktop 扩展', 'Export Claude Desktop extension')}</button>
      </fieldset>
      <fieldset disabled={busy} className="flex flex-wrap gap-2">
        <legend className="mb-1 font-semibold">{tr('安装设计 Skill', 'Install designer skill')}</legend>
        {([['codex', 'Codex'], ['antigravity', 'Antigravity'], ['claude', 'Claude Code']] as const).map(([client, label]) =>
          <button key={client} type="button" onClick={() => void install(client)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">{label}</button>)}
      </fieldset>
    </>}
    <p role="status" className="break-all">{message}</p>
  </div>;
}

const summaries: Record<string, string> = {
  'update project meta': '工程信息', 'manage sitemap': '页面目录', 'upsert db tables': '数据表结构',
  'seed tableRows': '演示数据', 'clear tableRows': '演示数据', 'write page': '页面源码',
  'edit page block': '页面组件', 'manage sticky notes': '组件便签', 'manage docs and flows': '工程文档与流程图',
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
  return <div className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-4 py-1 text-xs text-blue-900">
    <span role="status">{shown ? tr(`MCP 已修改${summaries[shown.summary] ?? '工程'}`, `MCP edit: ${shown.summary}`)
      : tr('MCP 双向设计已开启', 'MCP bidirectional design enabled')}</span>
    {shown && <button type="button" disabled={!canUndo} onClick={undo} className="underline disabled:opacity-45">{tr('撤销', 'Undo')}</button>}
    {shown && <button type="button" onClick={() => setDismissed(shown.id)}>{tr('收起提示', 'Dismiss')}</button>}
  </div>;
}
