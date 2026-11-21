import { useProjectWorkflow, warmProjectSession } from '../services/projectWorkflow';
import { conversationKey, type HermesTaskScope } from '../services/hermesConversation';
import React, { useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle, MessageSquarePlus, RefreshCw } from 'lucide-react';
import { useHermesStore } from '../store/useHermesStore';
import { useProtoStore } from '../store/useProtoStore';
import { useAiChatStore } from '../store/useAiChatStore';
import { presentHermesModel } from '../services/hermesModelCatalog';
import { ModelProviderIcon } from './ModelProviderIcon';
import { getHermesApi } from '../services/hermesClient';
import { HermesReasoningPicker } from './HermesReasoningPicker';
import { HermesModelPicker } from './HermesModelPicker';
import { useI18n } from '../i18n';

export function HermesSessionControls({ scope, showReasoning = false }: { scope?: HermesTaskScope; showReasoning?: boolean } = {}) {
  const { tr } = useI18n();
  const projectId = useProtoStore(s => s.currentProjectMeta.projectId);
  const pageId = useProtoStore(s => s.activePageId);
  const closed = useProtoStore(s => s.isProjectClosed);
  const mindmapId = useProtoStore(s => s.mindmaps.nodes.find(node => node.id === s.selectedMindmapNodeId && node.kind === 'mindmap')?.id);
  const mindmap = useProtoStore(s => s.viewMode === 'mindmap');
  if (closed || (!scope && (mindmap ? !mindmapId : pageId === ''))) return <p className="text-xs text-slate-500">{tr('选择具体菜单后可管理其对话模型', 'Select a menu page to manage its chat model')}</p>;
  const activeScope: HermesTaskScope = scope === undefined ? mindmap ? { projectId, kind: 'mindmap', mindmapId: mindmapId! } : { projectId, pageId } : scope;
  return <MenuSessionControls key={conversationKey(activeScope)} scope={activeScope} showReasoning={showReasoning} />;
}

function MenuSessionControls({ scope, showReasoning }: { scope: HermesTaskScope; showReasoning: boolean }) {
  const { isEn, tr, td } = useI18n();
  const { projectId, kind } = scope;
  const key = conversationKey(scope);
  const status = useHermesStore(s => s.status);
  const canReconnect = useHermesStore(s => s.status === 'error' && Boolean(s.binaryPath));
  const session = useHermesStore(s => s.sessions[key]);
  const nativeRunning = useHermesStore(s => Boolean(s.runningProjects[projectId]));
  const workflowRunning = useProjectWorkflow(s => Boolean(s.running[projectId]));
  const running = nativeRunning || workflowRunning;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [picker, setPicker] = useState<(HermesTaskScope & { sessionId: string }) | null>(null);
  const current = session?.models.availableModels.find(m => m.modelId === session.models.currentModelId);
  const currentChoice = current ? presentHermesModel(current) : null;
  const pickerOpen = Boolean(picker && conversationKey(picker) === key && picker.sessionId === session?.sessionId);
  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active = true;
    setPicker(null); setError('');
    if (status !== 'running') { setBusy(false); return; }
    setBusy(true);
    void (scope.kind === 'project' ? warmProjectSession(scope) : useHermesStore.getState().ensureSession(scope)).catch(e => {
      if (active) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [key, status]);
  if (status !== 'running') {
    return (
      <button
        type="button"
        disabled={status === 'scanning' || status === 'updating'}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-lg bg-amber-50 border border-amber-200/80 text-[11px] font-medium text-amber-800 hover:bg-amber-100 transition cursor-pointer whitespace-nowrap"
        onClick={() => {
          if (canReconnect) void perform(() => useHermesStore.getState().mountDetectedLocalHermes());
          else useHermesStore.getState().setModalOpen(true);
        }}
      >
        {status === 'scanning' ? tr('正在连接 Hermes…', 'Connecting Hermes…') : status === 'updating' ? tr('正在更新 Hermes…', 'Updating Hermes…') : canReconnect ? tr('重新连接 Hermes', 'Reconnect Hermes') : tr('连接 Hermes 启用 AI', 'Connect Hermes')}
      </button>
    );
  }

  const assertPickerSession = () => {
    const state = useHermesStore.getState();
    const project = useProtoStore.getState();
    if (picker?.kind === 'project' && useAiChatStore.getState().projectIndexes[picker.projectId]?.activeId !== (picker.threadId ?? null))
      throw new Error(tr('项目会话已切换，请重新打开模型选择', 'Project session changed — please reopen model picker'));
    if (!picker || project.currentProjectMeta.projectId !== picker.projectId || (picker.kind === 'project' ? project.viewMode !== 'project_ai' : picker.kind === 'mindmap' ? project.viewMode !== 'mindmap' || project.selectedMindmapNodeId !== picker.mindmapId : project.activePageId !== picker.pageId) || state.sessions[conversationKey(picker)]?.sessionId !== picker.sessionId)
      throw new Error(tr('对话已变化，请重新打开模型选择', 'Conversation changed — please reopen model picker'));
    if (state.status !== 'running' || state.runningProjects[picker.projectId]) throw new Error(tr('请等待当前任务结束后再切换模型', 'Wait for the current task to finish before switching models'));
  };
  const openModelPicker = () => { if (session) setPicker({ ...scope, sessionId: session.sessionId }); };
  const visibleModelText = busy ? tr('读取模型…', 'Loading…') : currentChoice ? currentChoice.title : session?.models.currentModelId ? tr('未在列表中', 'Unlisted') : tr('选择模型', 'Select Model');
  return <div className="min-w-0 text-[11px]">
    <div className="flex items-center gap-1 min-w-0">
      <button
        type="button"
        aria-label={isEn ? `Select chat model: ${visibleModelText}` : '选择对话模型'}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        disabled={busy || running || !session}
        onClick={openModelPicker}
        title={currentChoice ? tr(`${currentChoice.title} (${currentChoice.source}) · 点击切换模型`, `${currentChoice.title} (${td(currentChoice.source)}) · Click to switch model`) : tr('点击选择当前对话的模型', 'Click to select model for this chat')}
        className="inline-flex items-center gap-1.5 min-w-0 max-w-[168px] h-6 px-2 rounded-lg border border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50 text-left transition cursor-pointer focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
      >
        <ModelProviderIcon brand={currentChoice ? currentChoice.brand : 'unknown'} size={15} />
        <span className="truncate font-medium text-slate-700 leading-none">
          {visibleModelText}
        </span>
        {busy ? <LoaderCircle size={11} className="animate-spin text-slate-400 shrink-0" /> : <ChevronDown size={11} className="text-slate-400 shrink-0" />}
      </button>
      {showReasoning && scope.kind !== 'mindmap' && session?.models.currentModelId && <HermesReasoningPicker
        key={JSON.stringify([key, session.sessionId, session.models.currentModelId])}
        modelTitle={currentChoice?.title ?? session.models.currentModelId} disabled={busy || running} onChooseModel={openModelPicker}
        request={async effort => {
          const state = useHermesStore.getState(), active = state.sessions[key];
          const project = useProtoStore.getState();
          const sameConversation = scope.kind === 'project'
            ? project.viewMode === 'project_ai' && useAiChatStore.getState().projectIndexes[projectId]?.activeId === (scope.threadId ?? null)
            : project.activePageId === scope.pageId;
          if (project.isProjectClosed || project.currentProjectMeta.projectId !== projectId || !sameConversation ||
              state.status !== 'running' || active?.sessionId !== session.sessionId || active.models.currentModelId !== session.models.currentModelId)
            throw new Error(tr('会话或模型已切换，请重新打开推理强度', 'Session or model changed — please reopen reasoning effort'));
          if (effort !== undefined && (state.runningProjects[projectId] || useProjectWorkflow.getState().running[projectId]))
            throw new Error(tr('请等当前任务结束后再调整推理强度', 'Wait for the current task to finish before changing reasoning effort'));
          const api = getHermesApi();
          if (!api.reasoning) throw new Error(tr('请重启或更新桌面端后再调整推理强度', 'Restart or update the desktop app to adjust reasoning effort'));
          return api.reasoning({ ...scope, sessionId: session.sessionId, modelId: session.models.currentModelId,
            ...(effort === undefined ? {} : { effort }) });
        }} />}
      {kind !== 'project' && <button
        type="button"
        title={tr('开启新对话', 'Start new chat')}
        disabled={busy || running || !session}
        className="inline-flex h-6 px-1.5 rounded-md gap-1 items-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer shrink-0 disabled:opacity-40 whitespace-nowrap"
        onClick={() => void perform(async () => { await useHermesStore.getState().ensureSession(scope, true); if (scope.kind === undefined) useAiChatStore.getState().clearMessages(scope); })}
      >
        <MessageSquarePlus size={12} />{showReasoning ? <span className="sr-only">{tr('新对话', 'New Chat')}</span> : tr('新对话', 'New Chat')}
      </button>}
      <button
        type="button"
        title={tr('刷新模型列表', 'Refresh models')}
        aria-label={tr('刷新模型', 'Refresh models')}
        disabled={busy || running}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer shrink-0 disabled:opacity-40"
        onClick={() => void perform(() => useHermesStore.getState().ensureSession(scope, false, true))}
      >
        <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
      </button>
    </div>
    {error && <p role="alert" className="mt-1 text-rose-600 break-words">{td(error)}</p>}
    {pickerOpen && session && <HermesModelPicker
      key={`${key}:${session.sessionId}`}
      models={session.models.availableModels}
      currentModelId={session.models.currentModelId}
      running={running}
      onClose={() => setPicker(null)}
      onSelect={async modelId => { assertPickerSession(); await useHermesStore.getState().selectModel(scope, modelId); }}
      onRefresh={() => { assertPickerSession(); return useHermesStore.getState().ensureSession(scope, false, true); }}
    />}
  </div>;
}
