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

export function ProjectChatHistory({
  index,
}: {
  index: ProjectChatIndex;
}) {
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

  const keyword = search.trim().toLowerCase();
  const visibleEntries = keyword
    ? index.entries.filter(e => (e.title || '新会话').toLowerCase().includes(keyword))
    : index.entries;

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={createChat}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200/90 bg-blue-50/80 hover:bg-blue-100/80 px-2.5 py-1 text-[11px] font-semibold text-blue-700 shadow-2xs cursor-pointer transition"
          title="开启一段新的项目 AI 会话"
        >
          <MessageSquarePlus size={13} className="shrink-0" />
          <span>新建会话</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setSearch('');
            dialog.current?.showModal();
          }}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 hover:border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-2xs cursor-pointer transition"
          title={`查看与切换历史会话（共 ${index.entries.length} 条）`}
        >
          <History size={13} className="text-slate-500 shrink-0" />
          <span>历史会话</span>
        </button>
      </div>

      {error && !dialog.current?.open && (
        <span role="alert" className="text-xs text-rose-700">
          {error}
        </span>
      )}

      <dialog
        ref={dialog}
        aria-label="项目历史会话"
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
                <h2 className="text-sm font-bold text-slate-900">历史会话</h2>
                <span className="rounded-full bg-slate-100 border border-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600 tabular-nums">
                  {index.entries.length} 条
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                切换不同讨论主题，右侧已保存方案与页面进度会自动保留
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={createChat}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 cursor-pointer transition"
            >
              <MessageSquarePlus size={13} />
              <span>新建</span>
            </button>
            <button
              type="button"
              aria-label="关闭历史会话"
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
                placeholder="搜索会话标题…"
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
            const title = entry.title || '新会话';
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
                            {new Date(entry.updatedAt).toLocaleString('zh-CN', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                        </span>
                      ) : (
                        <span>{entry.id === null ? '默认主会话' : '刚刚创建'}</span>
                      )}
                      {msgCount > 0 && (
                        <span className="tabular-nums text-slate-400">· {msgCount} 条消息</span>
                      )}
                    </span>
                  </span>

                  <span className="flex items-center gap-1.5 shrink-0 self-center">
                    {isRunning && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <Loader2 size={10} className="animate-spin" />
                        <span>执行中</span>
                      </span>
                    )}
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-600/10 border border-blue-200/80 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                        <Check aria-label="当前会话" size={12} className="text-blue-600" />
                        <span>当前</span>
                      </span>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  aria-label={`删除会话「${title}」`}
                  disabled={isRunning}
                  title={isRunning ? '会话正在执行任务，无法删除' : `删除会话「${title}」`}
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
              {error}
            </p>
          </div>
        )}
      </dialog>

      {target && (
        <DeleteConfirmation
          title="删除这条会话？"
          confirmLabel="删除会话"
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            const scope = projectChatScope(projectId, target.id),
              key = conversationKey(scope);
            if (useProjectWorkflow.getState().runningChat[projectId] === key)
              throw new Error('请先停止这条会话的任务');
            // A browser-only workspace can create local chats but cannot open an ACP
            // session. A desktop workspace must acknowledge native deletion first.
            if ('protoflowDesktop' in window) {
              const api = getHermesApi();
              if (!api.deleteProjectChat) throw new Error('请完整重启 Alex 以启用会话管理');
              if ((await api.deleteProjectChat(scope)).deleted !== true)
                throw new Error('删除未完成，请重试');
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
            将删除「{target.title || '新会话'}」的聊天记录和 AI 上下文。已经应用到工程的修改会保留。
          </p>
        </DeleteConfirmation>
      )}
    </>
  );
}
