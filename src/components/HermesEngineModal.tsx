import { useAiChatStore } from '../store/useAiChatStore';
import { useProtoStore } from '../store/useProtoStore';
import React, { useEffect, useRef, useState } from "react";
import type { HermesPermission } from '../services/hermesClient';
import { createPortal } from 'react-dom';
import { conversationKey, type HermesTaskScope } from '../services/hermesConversation';
import { cachedProjectChatIndex } from '../services/projectChatHistory';
import { HermesQuestionCard, useQuestionHosts } from './HermesQuestionCard';
import { X } from "lucide-react";
import { useHermesStore } from "../store/useHermesStore";
import { HermesEnginePanel } from "./HermesManagementPanel";
import { useI18n } from '../i18n';
export { HermesEnginePanel } from "./HermesManagementPanel";
function useVisibleHermesScope() {
  const projectId = useProtoStore(s => s.currentProjectMeta.projectId);
  const pageId = useProtoStore(s => s.activePageId);
  const mindmapId = useProtoStore(s => s.selectedMindmapNodeId);
  const mode = useProtoStore(s => s.viewMode);
  const activeId = useAiChatStore(s => cachedProjectChatIndex(s.projectIndexes, projectId)?.activeId);
  return (scope: HermesTaskScope) => {
    if (scope.projectId !== projectId) return false;
    if (scope.kind === 'project') return mode !== 'project_ai' || activeId === (scope.threadId ?? null);
    if (mode === 'project_ai') return false;
    if (mode === 'mindmap') return scope.kind === 'mindmap' && scope.mindmapId === mindmapId;
    return scope.kind === undefined && scope.pageId === pageId;
  };
}
function HermesQuestionForm() {
  const visible = useVisibleHermesScope();
  const question = useHermesStore(s => s.questions.find(visible));
  const host = useQuestionHosts(state => question ? state.hosts[conversationKey(question)] : undefined);
  if (!question) return null;
  const card = <HermesQuestionCard key={`${conversationKey(question)}:${question.id}`} question={question} inline={Boolean(host)} />;
  return host ? createPortal(card, host) : <div className="fixed bottom-4 right-4 z-[310] w-[340px] max-w-[calc(100vw-2rem)]">{card}</div>;
}

function HermesPermissionDialog({ permission }: { permission: HermesPermission }) {
  const { tr, td } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const answer = async (optionId: string | null) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setFailure('');
    try { await useHermesStore.getState().answerPermission(permission.id, optionId); }
    catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      submitting.current = false;
      setBusy(false);
    }
  };
  const explanations = permission.toolCall.content?.filter(block => block.type === 'content' && block.content?.type === 'text');
  return <dialog ref={dialog} role="dialog" aria-modal="true" aria-label={tr('Hermes 操作授权', 'Hermes Action Permission')}
    onCancel={event => { event.preventDefault(); void answer(null); }}
    className="m-auto w-[min(576px,calc(100vw-32px))] max-h-[85vh] overflow-auto rounded-xl border border-slate-200 bg-white text-slate-900 p-5 shadow-xl backdrop:bg-slate-900/40 space-y-3">
    <h3 className="font-semibold">{tr('Hermes 请求授权', 'Hermes Requests Permission')}</h3>
    <p className="text-sm">{permission.toolCall.title ? td(permission.toolCall.title) : tr('工具操作', 'Tool Operation')}</p>
    {explanations?.map((block, index) => <p key={index} className="text-sm whitespace-pre-wrap break-words">{block.content?.text}</p>)}
    {permission.toolCall.rawInput !== undefined && <details>
      <summary className="cursor-pointer text-xs text-slate-500">{tr('查看操作详情', 'View Operation Details')}</summary>
      <pre className="mt-2 text-xs bg-slate-50 rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap break-words">
        {JSON.stringify(permission.toolCall.rawInput, null, 2)}
      </pre>
    </details>}
    <div className="flex gap-2 flex-wrap">
      {permission.options.map(option => <button type="button" disabled={busy} key={option.optionId}
        className="border border-slate-200 rounded px-3 py-2 text-xs disabled:opacity-40"
        onClick={() => void answer(option.optionId)}>{td(option.name)}</button>)}
      <button type="button" disabled={busy} className="border border-slate-200 rounded px-3 py-2 text-xs disabled:opacity-40"
        onClick={() => void answer(null)}>{tr('取消', 'Cancel')}</button>
    </div>
    {failure && <p role="alert" className="text-rose-700 text-xs">{td(failure)}</p>}
  </dialog>;
}

function HermesFeedback({ inline }: { inline: boolean }) {
  const { tr, td } = useI18n();
  const { error, permissions: allPermissions, isModalOpen } = useHermesStore();
  const visible = useVisibleHermesScope();
  const permissions = allPermissions.filter(visible);
  return (
    <>
      {error && !isModalOpen && (
        <div
          role="alert"
          className={`flex items-center justify-center gap-3 border border-rose-300 bg-rose-50 text-xs text-rose-800 ${inline
            ? 'shrink-0 px-4 py-2'
            : 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[250] max-w-xl rounded-lg shadow-lg p-3'}`}
        >
          <span className="max-h-16 overflow-auto break-words">{td(error)}</span>
          <button
            aria-label={tr('关闭 AI 错误提示', 'Dismiss AI error')}
            onClick={() => useHermesStore.setState({ error: null })}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {permissions[0] && <HermesPermissionDialog key={permissions[0].id} permission={permissions[0]} />}
    </>
  );
}
export const HermesEngineModal = ({ inlineFeedback = false }: { inlineFeedback?: boolean } = {}) => {
  const { tr } = useI18n();
  const { isModalOpen, setModalOpen } = useHermesStore();
  return (
    <>
      <HermesQuestionForm />
      <HermesFeedback inline={inlineFeedback} />
      {isModalOpen && (
        <div className="fixed inset-0 z-[200] bg-slate-900/40 flex items-center justify-center p-5">
          <div
            role="dialog"
            aria-label={tr('Hermes 引擎设置', 'Hermes Engine Settings')}
            className="w-full max-w-3xl max-h-[90vh] rounded-xl overflow-hidden shadow-xl"
          >
            <HermesEnginePanel onClose={() => setModalOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
};
