import { conversationKey } from '../../services/hermesConversation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { notesLinkedToPage } from '../notes';
import { Bot, Check, Copy, Send, Sparkles, Trash2, Undo2, X, Crosshair, Loader2, FileText, ImagePlus, BookOpenText, Minus, Maximize2, Minimize2, ArrowUpRight } from 'lucide-react';
import { CHAT_IMAGE_ACCEPT, MAX_CHAT_IMAGES, readChatImageFiles, saveChatImages } from '../../services/chatImages';
import type { HermesImageAttachment } from '../../services/hermesClient';
import { ChatImageThumbnail, ChatImageDraftList } from './ChatImageThumbnail';
import { RequirementAuditPanel } from '../../components/RequirementAuditPanel';
import { ChatMarkdown } from '../../components/ChatMarkdown';
import { canUndoProjectChange, undoProjectChange } from '../../services/hermesProject';
import { usePageStore } from '../store/usePageStore';
import { useAiChatStore, EMPTY_PAGE_CHAT_DRAFT, type AiChatMessage } from '../../store/useAiChatStore';
import { useHermesStore } from '../../store/useHermesStore';
import { HermesQuestionHost } from '../../components/HermesQuestionCard';
import { HermesSessionControls } from '../../components/HermesSessionControls';
import { useProtoStore } from '../../store/useProtoStore';

interface AiChatPanelProps {
  pageId: string;
  visible?: boolean;
  composerRef?: React.RefObject<HTMLTextAreaElement>;
  onCollapse?: () => void;
  wide?: boolean;
  onToggleWide?: () => void;
  pageTitle: string;
  /** Label of the currently selected canvas node, null when the whole page is the target */
  selectedLabel: string | null;
  running: boolean;
  onSend: (prompt: string, images?: HermesImageAttachment[], noteIds?: string[]) => void | Promise<boolean | void>;
  onClearSelection: () => void;
}

const SUGGESTIONS_PAGE = [
  '插入单据标准三栏表头',
  '增加 Excel 批量导入弹框，并嵌套校验异常抽屉',
  '给表格增加审批行操作并生成审批弹框',
  '补充空状态提示与表单必填校验反馈',
];

const SUGGESTIONS_NODE = ['把它的标题改得更业务化一些', '给这个表格增加审批行操作', '在它后面新增一个详情抽屉'];
const EMPTY_MESSAGES: AiChatMessage[] = [];

export const AiChatPanel: React.FC<AiChatPanelProps> = ({
  pageId,
  visible = true,
  composerRef,
  onCollapse,
  wide = false,
  onToggleWide,
  pageTitle,
  selectedLabel,
  running,
  onSend,
  onClearSelection,
}) => {
  usePageStore(s => s.pageSources);
  const clearMessages = useAiChatStore(s => s.clearMessages);
  const hermesStatus = useHermesStore(s => s.status);
  const currentVersion = useHermesStore(s => s.currentVersion);
  const setModalOpen = useHermesStore(s => s.setModalOpen);
  const { setActivePage, setViewMode, currentProjectMeta } = useProtoStore();
  const scope = { projectId: currentProjectMeta.projectId, pageId }, key = conversationKey(scope);
  const messages = useAiChatStore(s => s.byConversation[key] ?? EMPTY_MESSAGES);
  const saveError = useAiChatStore(s => s.storageErrors[key]);
  const runningPage = useHermesStore(s => s.runningPageByProject[currentProjectMeta.projectId]);
  const projectRunning = useHermesStore(s => Boolean(s.runningProjects[currentProjectMeta.projectId]));
  const progress = useHermesStore(s => s.progress[key]);
  const awaitingAnswer = useHermesStore(s => s.questions.some(q => conversationKey(q) === key));
  const isRunning = running || projectRunning;
  const draft = useAiChatStore(s => s.pageDrafts.get(key) ?? EMPTY_PAGE_CHAT_DRAFT);
  const updateDraft = useAiChatStore(s => s.updatePageDraft);
  const { text: input, images, excludedNoteIds } = draft;
  const [imageError, setImageError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  // Notes linked to this page are attached as background by default; each can be unticked.
  const projectNotes = useProtoStore(s => s.projectNotes);
  const sitemapLayout = usePageStore(useShallow(s => ({ designerFolders: s.designerFolders, designerPages: s.designerPages, sitemapOverrides: s.sitemapOverrides, sitemapBase: s.sitemapBase })));
  const linkedNotes = useMemo(() => notesLinkedToPage(projectNotes, sitemapLayout, pageId), [projectNotes, sitemapLayout, pageId]);
  const selectedNoteIds = linkedNotes.filter(note => !excludedNoteIds.includes(note.noteId)).map(note => note.noteId);
  const toggleNote = (noteId: string) => updateDraft(key, current => ({
    ...current,
    excludedNoteIds: current.excludedNoteIds.includes(noteId)
      ? current.excludedNoteIds.filter(id => id !== noteId)
      : [...current.excludedNoteIds, noteId],
  }));
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const scopeRef = useRef<string | null>(key);
  const scopeVersionRef = useRef(0);
  useEffect(() => {
    scopeVersionRef.current += 1;
    scopeRef.current = key;
    setImageError(''); setDragging(false); setPreparing(false); setSending(false); busyRef.current = false;
    return () => { scopeRef.current = null; };
  }, [key]);
  const listRef = useRef<HTMLDivElement>(null);
  const followStream = useRef(true);


  const lastChangeId = [...messages].reverse().find((m) => m.role === 'assistant' && m.changedDoc && m.status === 'done')?.id;

  useEffect(() => {
    if (visible && followStream.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'auto' });
  }, [visible, messages.length, messages[messages.length - 1]?.status, messages[messages.length - 1]?.text]);

  const addImages = async (files: File[]) => {
    if (!files.length || busyRef.current || isRunning) return;
    const version = scopeVersionRef.current;
    const isCurrentScope = () => scopeRef.current === key && scopeVersionRef.current === version;
    busyRef.current = true; setPreparing(true); setImageError('');
    try {
      const added = await readChatImageFiles(files, images.length);
      if (isCurrentScope()) updateDraft(key, current => ({ ...current, images: [...current.images, ...added] }));
    } catch (e) { if (isCurrentScope()) setImageError(e instanceof Error ? e.message : String(e)); }
    finally { if (isCurrentScope()) { busyRef.current = false; setPreparing(false); } }
  };
  const submit = async (text?: string) => {
    const value = (text ?? input).trim();
    if ((!value && !images.length) || isRunning || busyRef.current || hermesStatus !== 'running') return;
    const version = scopeVersionRef.current;
    const isCurrentScope = () => scopeRef.current === key && scopeVersionRef.current === version;
    // Identity protects a newer edit or send, including after leaving and reopening this page.
    const cleared = { text: '', images: [], excludedNoteIds };
    const restoreDraft = () => {
      updateDraft(key, current => current === cleared ? draft : current);
    };
    busyRef.current = true; setSending(true); setImageError('');
    try {
      const attachments = images.length ? await saveChatImages(scope, images) : undefined;
      // Reading/saving a file is asynchronous; never send into a newly selected menu.
      const active = useProtoStore.getState();
      if (!isCurrentScope() || active.isProjectClosed || active.currentProjectMeta.projectId !== scope.projectId || active.activePageId !== pageId) return;
      const pending = onSend(value || '请分析这些图片，结合当前页面给出建议。', attachments, selectedNoteIds.length ? selectedNoteIds : undefined);
      // onSend resolves after generation finishes, not when the user message is submitted.
      // Clear the submitted draft now; keep its exact contents for a failed retry.
      updateDraft(key, () => cleared);
      if (fileRef.current) fileRef.current.value = '';
      const sent = await pending;
      if (sent === false) {
        restoreDraft();
        if (isCurrentScope()) setImageError('发送未完成，文字和图片已保留，可调整后重试。');
      }
    } catch (e) {
      restoreDraft();
      if (isCurrentScope()) setImageError(e instanceof Error ? e.message : String(e));
    } finally { if (isCurrentScope()) { busyRef.current = false; setSending(false); } }
  };

  const hermesOn = hermesStatus === 'running';

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white px-3 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-2xs">
          <Sparkles size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-slate-900 shrink-0">页面 AI 对话</span>
            <span className="text-slate-300 shrink-0">·</span>
            <span className="truncate text-[11px] font-medium text-slate-500" title={pageTitle}>{pageTitle}</span>
          </div>
          <div className="truncate text-[10px] text-slate-400">
            {selectedLabel ? `已锁定组件：${selectedLabel}` : '作用于当前整页画布'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true, 'overview')}
          className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium border flex items-center gap-1 cursor-pointer shrink-0 transition ${
            hermesOn
              ? 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/70'
              : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/70'
          }`}
          title={hermesOn ? `Hermes ${currentVersion} 运行中 · 点击管理引擎` : '点击连接或管理 Hermes 引擎'}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${hermesOn ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span>{hermesOn ? `Hermes ${currentVersion}` : '连接 Hermes'}</span>
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => void useHermesStore.getState().ensureSession(scope, true).then(() => clearMessages(scope)).catch(e => useHermesStore.setState({error:String(e)}))}
            disabled={isRunning || !hermesOn}
            className="px-1.5 py-0.5 rounded-md text-[10px] text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-40 transition"
            title="仅清空当前菜单的对话"
          >
            <Trash2 className="w-3 h-3" />
            <span>清空</span>
          </button>
        )}
        {onToggleWide && (
          <button
            type="button"
            onClick={onToggleWide}
            aria-label={wide ? '恢复标准宽度' : '展开宽屏面板'}
            title={wide ? '恢复标准宽度' : '展开宽屏面板'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-800 cursor-pointer transition"
          >
            {wide ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
        {onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="收起 AI 对话" title="收起 AI 对话（Esc）"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer transition focus-visible:outline-blue-600">
            <Minus size={15} />
          </button>
        )}
      </header>

      {saveError && (
        <div role="alert" className="px-3 py-1.5 text-[11px] bg-rose-50/80 border-b border-rose-100 text-rose-600 flex items-center justify-between gap-2">
          <span className="truncate">{saveError}</span>
          <button className="underline shrink-0 font-medium" onClick={() => { try { useAiChatStore.getState().retrySave(scope); } catch (e) { useHermesStore.setState({ error: String(e) }); } }}>重试</button>
        </div>
      )}
      {projectRunning && runningPage && runningPage !== pageId && (
        <div className="px-3 py-1.5 text-[11px] bg-amber-50/80 border-b border-amber-100 text-amber-700 flex items-center justify-between gap-2">
          <span className="truncate">其他菜单任务进行中</span>
          <button className="font-medium hover:underline shrink-0" onClick={() => void useHermesStore.getState().stop({ projectId: currentProjectMeta.projectId, pageId: runningPage }).catch(e => useHermesStore.setState({ error: String(e) }))}>停止任务</button>
        </div>
      )}
      {isRunning && runningPage === pageId && (
        <div className="px-3 py-1.5 text-[11px] bg-emerald-50/70 border-b border-emerald-100 text-emerald-700 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate">
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span className="truncate">{awaitingAnswer ? '等待你回答下方问题' : progress || 'Hermes 正在处理…'}</span>
          </span>
          <button className="font-medium hover:underline shrink-0" onClick={() => void useHermesStore.getState().stop(scope).catch(e => useHermesStore.setState({error:String(e)}))}>停止生成</button>
        </div>
      )}

      {/* Messages Stream */}
      <div
        ref={listRef}
        onScroll={event => {
          const el = event.currentTarget;
          followStream.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 min-h-0 overflow-y-auto bg-slate-50/40 px-2.5 py-3 space-y-3.5"
      >
        {messages.length === 0 ? (
          <div className="pt-1 space-y-3">
            <div className="rounded-xl border border-slate-200/80 bg-white p-3 space-y-2 shadow-2xs">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Sparkles size={13} />
                </span>
                <span className="text-xs font-semibold text-slate-800">
                  {selectedLabel ? '针对选中组件微调' : '智能生成与改稿'}
                </span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-slate-600">
                点选画布上的组件，告诉 AI 想怎么改。也可以直接描述整页需求，或粘贴参考截图。
              </p>
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200/70 bg-slate-50/70 px-2.5 py-1.5 text-[11px] text-slate-600">
                <Crosshair size={12} className="text-blue-600 shrink-0" />
                <span className="truncate">
                  {selectedLabel ? `当前锁定：${selectedLabel}` : `当前页面：${pageTitle}`}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1">
                快捷指令
              </div>
              {(selectedLabel ? SUGGESTIONS_NODE : SUGGESTIONS_PAGE).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  disabled={isRunning || preparing || sending || !hermesOn}
                  className="group w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-xl border border-slate-200/80 bg-white hover:bg-blue-50/60 hover:border-blue-300 text-[11.5px] font-medium text-slate-700 cursor-pointer transition shadow-2xs disabled:opacity-50"
                >
                  <span className="truncate">{s}</span>
                  <ArrowUpRight size={13} className="shrink-0 text-slate-300 group-hover:text-blue-600 transition" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex flex-col items-end gap-1 group">
                <div className="flex items-center gap-1.5 px-1 text-[10px] text-slate-400 max-w-full">
                  {m.targetLabel && (
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 border border-blue-200/80 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 truncate max-w-[190px]">
                      <Crosshair className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{m.targetLabel}</span>
                    </span>
                  )}
                  <span className="tabular-nums shrink-0">{m.time}</span>
                </div>
                <div className="max-w-[92%] px-3.5 py-2.5 rounded-2xl rounded-tr-xs bg-blue-600 text-white shadow-xs">
                  <ChatMarkdown content={m.text} tone="user" />
                  {!!m.images?.length && (
                    <div className="grid grid-cols-2 gap-1.5 mt-2">
                      {m.images.map(image => (
                        <ChatImageThumbnail key={image.id} name={image.name} attachment={image} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div key={m.id} className="space-y-1.5 min-w-0 group">
                {/* Antigravity-style Assistant Header Row */}
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-2xs">
                      <Sparkles className="w-2.5 h-2.5" />
                    </span>
                    <span className="text-[11px] font-semibold text-slate-800 shrink-0">
                      Hermes AI
                    </span>
                    {m.engineBadge && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-slate-100/90 border border-slate-200/80 text-slate-500 truncate max-w-[130px]"
                        title={m.engineBadge}
                      >
                        <Bot className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                        <span className="truncate">{m.engineBadge}</span>
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{m.time}</span>
                </div>

                {/* Assistant Markdown Card */}
                <div
                  className={`px-3.5 py-2.5 rounded-2xl rounded-tl-xs border shadow-2xs transition-all ${
                    m.status === 'error'
                      ? 'bg-rose-50/90 border-rose-200 text-rose-800'
                      : 'bg-white border-slate-200/90 text-slate-800'
                  }`}
                >
                  <ChatMarkdown
                    content={m.text}
                    streaming={m.status === 'pending'}
                    tone={m.status === 'error' ? 'error' : 'assistant'}
                  />
                  <RequirementAuditPanel report={m.requirementAudit} />
                  {m.status === 'pending' && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-blue-600">
                      <span className="inline-flex items-center" aria-label="正在输出">
                        <Loader2 className="w-3 h-3 animate-spin" />
                      </span>
                      <span>正在生成与同步画布…</span>
                    </div>
                  )}
                </div>

                {/* Assistant Action Footer */}
                {m.status === 'done' && (
                  <div className="flex items-center gap-1.5 flex-wrap px-0.5">
                    {m.text.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!navigator.clipboard) return;
                          void navigator.clipboard.writeText(m.text).then(() => {
                            setCopiedMsgId(m.id);
                            setTimeout(() => setCopiedMsgId(prev => (prev === m.id ? null : prev)), 1500);
                          });
                        }}
                        className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white border border-slate-200/90 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                        title="复制本条 AI 回复"
                      >
                        {copiedMsgId === m.id ? (
                          <>
                            <Check className="w-2.5 h-2.5 text-emerald-600" />
                            <span className="text-emerald-600">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-2.5 h-2.5" />
                            <span>复制</span>
                          </>
                        )}
                      </button>
                    )}
                    {m.createdPageId && m.createdPageId !== pageId && (
                      <button
                        type="button"
                        onClick={() => {
                          setActivePage(m.createdPageId as string);
                          setViewMode('single_page');
                        }}
                        className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 flex items-center gap-1 cursor-pointer transition"
                      >
                        <FileText className="w-3 h-3" />
                        打开新页面
                      </button>
                    )}
                    {m.id === lastChangeId && m.changeId && canUndoProjectChange(m.changeId) && (
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            undoProjectChange(m.changeId!);
                            useAiChatStore.getState().updateMessage(m.id, { changedDoc: false });
                          } catch (e) {
                            useHermesStore.setState({ error: String(e) });
                          }
                        }}
                        disabled={isRunning}
                        className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white border border-slate-200/90 text-slate-600 hover:text-rose-600 hover:border-rose-200 flex items-center gap-1 cursor-pointer disabled:opacity-40 transition shadow-2xs"
                        title="撤销这次 AI 修改"
                      >
                        <Undo2 className="w-3 h-3" />
                        撤销修改
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          )
        )}
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <HermesQuestionHost scope={scope} visible={visible} />
      </div>

      {/* Antigravity-style Unified Floating Composer */}
      <div
        className="flex max-h-[50%] min-h-0 shrink-0 flex-col bg-white p-2 pt-1"
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = isRunning || preparing || sending ? 'none' : 'copy'; setDragging(true); } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); setDragging(false); void addImages(Array.from(event.dataTransfer.files)); }}
      >
        <div
          className={`flex min-h-0 flex-col gap-1.5 rounded-2xl border p-2 transition-all ${
            dragging
              ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/15'
              : 'border-slate-200/90 bg-slate-50/70 focus-within:bg-white focus-within:border-blue-500/80 focus-within:shadow-[0_2px_12px_-3px_rgba(37,99,235,0.12)]'
          }`}
        >
          <div className="min-h-0 space-y-1.5 overflow-y-auto overscroll-contain">
            {/* Top Context Chip inside Composer */}
            <div className="flex items-center justify-between gap-1.5 min-w-0">
              {selectedLabel ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 border border-blue-200/80 text-[10px] font-medium text-blue-700 min-w-0 max-w-full">
                  <Crosshair className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{selectedLabel}</span>
                  <button
                    type="button"
                    onClick={onClearSelection}
                    className="text-blue-400 hover:text-blue-700 cursor-pointer shrink-0"
                    title="取消选中，改为针对整页"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/90 border border-slate-200/70 text-[10px] text-slate-500 truncate max-w-full">
                  <Crosshair className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                  <span className="truncate">整页 · {pageTitle}</span>
                </span>
              )}
              {dragging && <span className="text-[10px] text-blue-600 font-medium shrink-0">松开添加图片</span>}
            </div>

            {/* Linked project notes sent as background context */}
            {linkedNotes.length > 0 && (
              <div role="group" aria-label="随消息附带的关联笔记" className="flex flex-wrap items-center gap-1 px-0.5">
                <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400"><BookOpenText size={11} />关联笔记</span>
                {linkedNotes.map(note => {
                  const on = !excludedNoteIds.includes(note.noteId);
                  return (
                    <button key={note.noteId} type="button" aria-pressed={on} disabled={sending || isRunning}
                      title={on ? `发送时附带《${note.title}》作为背景资料，点击取消` : `点击附带《${note.title}》`}
                      onClick={() => toggleNote(note.noteId)}
                      className={`inline-flex max-w-[180px] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] cursor-pointer transition disabled:opacity-50 ${on ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-400 line-through'}`}>
                      <span className="shrink-0">{note.icon}</span>
                      <span className="truncate">{note.title}</span>
                      {note.status === 'pending_confirm' && <span className="shrink-0 text-amber-700">待确认</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Pending Image Attachments */}
            <ChatImageDraftList images={images} disabled={preparing || sending || isRunning}
              onRemove={index => updateDraft(key, current => ({ ...current, images: current.images.filter((_, i) => i !== index) }))} />

            {imageError && <p role="alert" className="text-[11px] text-rose-600 break-words px-0.5">{imageError}</p>}

            {/* Auto-fitting Textarea */}
            <textarea
              ref={composerRef}
              aria-label="页面 AI 对话输入框"
              rows={1}
              value={input}
              disabled={sending}
              onPaste={event => {
                const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => file !== null);
                if (files.length) { event.preventDefault(); void addImages(files); }
              }}
              onChange={event => {
                const text = event.target.value;
                updateDraft(key, current => ({ ...current, text }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={selectedLabel ? '怎么改这个组件？（支持粘贴截图）' : '输入修改指令或粘贴参考截图…'}
              className="w-full h-auto [field-sizing:content] min-h-[2.25rem] max-h-28 resize-none px-1 py-0.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none bg-transparent leading-relaxed"
            />

          </div>
          {/* Integrated Bottom Toolbar: Model Pill (left) + Image & Send (right) */}
          <div className="flex shrink-0 items-center justify-between gap-1 pt-1 border-t border-slate-200/60 min-w-0">
            <div className="min-w-0 flex-1">
              <HermesSessionControls scope={scope} showReasoning />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <input
                ref={fileRef}
                type="file"
                accept={CHAT_IMAGE_ACCEPT}
                multiple
                className="hidden"
                aria-label="选择聊天图片"
                onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addImages(files); }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isRunning || preparing || sending || images.length >= MAX_CHAT_IMAGES}
                className="inline-flex items-center gap-0.5 h-6 px-1.5 rounded-md text-[10px] text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition cursor-pointer disabled:opacity-40"
                title="添加图片（支持直接粘贴截图或拖入 PNG/JPG/WebP，单张 ≤ 5 MB）"
              >
                {preparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                {images.length > 0 && <span className="tabular-nums font-medium">{images.length}/{MAX_CHAT_IMAGES}</span>}
              </button>
              <button
                type="button"
                onClick={() => submit()}
                disabled={isRunning || preparing || sending || (!input.trim() && !images.length) || !hermesOn}
                className="w-6 h-6 rounded-lg flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white shadow-2xs shrink-0 cursor-pointer transition disabled:opacity-35 disabled:cursor-not-allowed"
                title="发送"
              >
                {isRunning || preparing || sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
