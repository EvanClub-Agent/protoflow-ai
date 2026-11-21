import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clock,
  History,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { projectChatScope, type ProjectChatEntry, type ProjectChatIndex } from '../services/projectChatHistory';
import { conversationKey } from '../services/hermesConversation';
import { getHermesApi } from '../services/hermesClient';
import { useAiChatStore } from '../store/useAiChatStore';
import { useHermesStore } from '../store/useHermesStore';
import { purgeConversationTelemetry, useProjectWorkflow } from '../services/projectWorkflow';
import { DeleteConfirmation } from './DeleteConfirmation';
import { useI18n } from '../i18n';

export function ProjectChatHistory({
  index,
}: {
  index: ProjectChatIndex;
}) {
  const { isEn, tr, td } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<ProjectChatEntry | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const { projectId } = index;
  const owner = useProjectWorkflow(s => s.runningChat[projectId]);
  const byConversation = useAiChatStore(s => s.byConversation);

  const run = (action: () => void) => {
    try {
      action();
      setError('');
      setSearch('');
      dialog.current?.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    setTarget(null);
    setError('');
    setSearch('');
    dialog.current?.close();
  }, [projectId]);

  const createChat = () => run(() => useAiChatStore.getState().newProjectChat(projectId));

  const defaultTitle = tr('新会话', 'New Chat');
  const keyword = search.trim().toLowerCase();
  const visibleEntries = keyword
    ? index.entries.filter(e => (e.title || defaultTitle).toLowerCase().includes(keyword))
    : index.entries;

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={createChat}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200/90 bg-blue-50/80 hover:bg-blue-100/80 px-2.5 py-1 text-[11px] font-semibold text-blue-700 shadow-2xs whitespace-nowrap shrink-0 cursor-pointer transition"
          title={tr('开启一段新的项目 AI 会话', 'Start a new Project AI conversation')}
        >
          <MessageSquarePlus size={13} className="shrink-0" />
          <span>{tr('新建会话', 'New Chat')}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setSearch('');
            dialog.current?.showModal();
          }}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 hover:border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-2xs whitespace-nowrap shrink-0 cursor-pointer transition"
          title={tr(`查看与切换历史会话（共 ${index.entries.length} 条）`, `View and switch chat history (${index.entries.length} total)`)}
        >
          <History size={13} className="text-slate-500 shrink-0" />
          <span>{tr('历史会话', 'History')}</span>
        </button>
      </div>

      {error && !dialog.current?.open && (
        <span role="alert" className="text-xs text-rose-700">
          {td(error)}
        </span>
      )}

      <dialog
        ref={dialog}
        aria-label={tr('项目历史会话', 'Project chat history')}
        onClick={e => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto w-[480px] max-w-[94vw] rounded-2xl border border-slate-200/90 bg-white p-0 shadow-2xl backdrop:bg-slate-900/35 backdrop:backdrop-blur-[2px]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/90 via-white to-blue-50/40 px-4 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-2xs">
              <History size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">{tr('历史会话', 'Chat History')}</h2>
                <span className="rounded-full bg-slate-100 border border-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600 tabular-nums">
                  {tr(`${index.entries.length} 条`, `${index.entries.length}`)}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {tr(
                  '切换不同讨论主题，右侧已保存方案与页面进度会自动保留',
                  'Switch topics freely — saved plans and page generation progress on the right remain intact'
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={createChat}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 whitespace-nowrap cursor-pointer transition"
            >
              <MessageSquarePlus size={13} />
              <span>{tr('新建', 'New')}</span>
            </button>
            <button
              type="button"
              aria-label={tr('关闭历史会话', 'Close chat history')}
              onClick={() => dialog.current?.close()}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer transition"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Search Filter Bar when multiple sessions exist */}
        {index.entries.length > 2 && (
          <div className="px-3.5 pt-3 pb-1">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/70 focus-within:bg-white focus-within:border-blue-500 px-3 py-1.5 transition">
              <Search size={13} className="text-slate-400 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={tr('搜索会话标题…', 'Search chat titles…')}
                className="w-full bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Session List */}
        <ul className="max-h-[55vh] overflow-y-auto p-3 space-y-2">
          {visibleEntries.map(entry => {
            const key = conversationKey(projectChatScope(projectId, entry.id));
            const title = entry.title || defaultTitle;
            const isActive = entry.id === index.activeId;
            const isRunning = owner === key;
            const msgCount = byConversation[key]?.length ?? 0;

            return (
              <li
                key={key}
                className={`group flex items-center gap-1.5 rounded-2xl border p-1.5 transition-all ${
                  isActive
                    ? 'border-blue-300 bg-blue-50/60 shadow-2xs'
                    : 'border-slate-200/80 bg-white hover:border-blue-200 hover:bg-slate-50/70'
                }`}
              >
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl p-2 text-left cursor-pointer"
                  onClick={() =>
                    run(() => useAiChatStore.getState().selectProjectChat(projectId, entry.id))
                  }
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border transition ${
                      isActive
                        ? 'border-blue-600 bg-blue-600 text-white shadow-2xs'
                        : 'border-slate-200/90 bg-slate-50 text-slate-500 group-hover:border-blue-200 group-hover:text-blue-600'
                    }`}
                  >
                    {isActive ? <Sparkles size={13} /> : <MessageSquare size={13} />}
                  </span>

                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={`block truncate text-xs leading-snug ${
                          isActive ? 'font-bold text-blue-950' : 'font-semibold text-slate-800'
                        }`}
                      >
                        {title}
                      </span>
                    </span>

                    <span className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      {entry.updatedAt !== null ? (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Clock size={10} className="shrink-0" />
                          <time>
                            {new Date(entry.updatedAt).toLocaleString(isEn ? 'en-US' : 'zh-CN', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                        </span>
                      ) : (
                        <span>{entry.id === null ? tr('默认主会话', 'Main chat') : tr('刚刚创建', 'Just created')}</span>
                      )}
                      {msgCount > 0 && (
                        <span className="tabular-nums text-slate-400">{tr(`· ${msgCount} 条消息`, `· ${msgCount} msgs`)}</span>
                      )}
                    </span>
                  </span>

                  <span className="flex items-center gap-1.5 shrink-0 self-center">
                    {isRunning && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 whitespace-nowrap">
                        <Loader2 size={10} className="animate-spin" />
                        <span>{tr('执行中', 'Running')}</span>
                      </span>
                    )}
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-600/10 border border-blue-200/80 px-2 py-0.5 text-[10px] font-semibold text-blue-700 whitespace-nowrap">
                        <Check aria-label={tr('当前会话', 'Current chat')} size={12} className="text-blue-600" />
                        <span>{tr('当前', 'Active')}</span>
                      </span>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  aria-label={tr(`删除会话「${title}」`, `Delete chat "${title}"`)}
                  disabled={isRunning}
                  title={isRunning ? tr('会话正在执行任务，无法删除', 'Chat is currently running and cannot be deleted') : tr(`删除会话「${title}」`, `Delete chat "${title}"`)}
                  className="mr-1 rounded-xl p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition"
                  onClick={() => setTarget(entry)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>

        {error && (
          <div className="px-4 pb-3">
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            >
              {td(error)}
            </p>
          </div>
        )}
      </dialog>

      {target && (
        <DeleteConfirmation
          title={tr('删除这条会话？', 'Delete this chat?')}
          confirmLabel={tr('删除会话', 'Delete Chat')}
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            const scope = projectChatScope(projectId, target.id),
              key = conversationKey(scope);
            if (useProjectWorkflow.getState().runningChat[projectId] === key)
              throw new Error(tr('请先停止这条会话的任务', 'Please stop the running task in this chat first'));
            // A browser-only workspace can create local chats but cannot open an ACP
            // session. A desktop workspace must acknowledge native deletion first.
            if ('protoflowDesktop' in window) {
              const api = getHermesApi();
              if (!api.deleteProjectChat) throw new Error(tr('请完整重启 Alex 以启用会话管理', 'Please restart Alex completely to enable session management'));
              if ((await api.deleteProjectChat(scope)).deleted !== true)
                throw new Error(tr('删除未完成，请重试', 'Deletion incomplete; please try again'));
            }
            useAiChatStore.getState().forgetProjectChat(projectId, target.id);
            purgeConversationTelemetry(scope);
            useHermesStore.setState(state => {
              const { [key]: session, ...sessions } = state.sessions;
              const { [key]: text, ...partial } = state.partial;
              const { [key]: step, ...progress } = state.progress;
              const { [key]: version, ...cancelGeneration } = state.cancelGeneration;
              const { [key]: metrics, ...lastMetrics } = state.lastMetrics;
              return { sessions, partial, progress, cancelGeneration, lastMetrics };
            });
          }}
        >
          <p>
            {tr(
              `将删除「${target.title || '新会话'}」的聊天记录和 AI 上下文。已经应用到工程的修改会保留。`,
              `Deletes chat messages and AI context for "${target.title || 'New Chat'}". Changes already applied to the project will be preserved.`
            )}
          </p>
        </DeleteConfirmation>
      )}
    </>
  );
}
