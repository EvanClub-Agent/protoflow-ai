import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenText,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileUp,
  FolderPlus,
  Link2,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { buildSitemap } from '../proto/sitemap';
import { flattenSitemap } from '../proto/mindmaps';
import {
  NOTE_EMOJI_CATALOG,
  NOTE_PRESET_TAGS,
  NOTE_STATUS_OPTIONS,
  NOTE_TEMPLATES,
  extractAllNoteTasks,
  noteContext,
  noteDescendants,
  noteHtmlToPlainText,
  notePath,
  noteTemplateContent,
  type NoteNode,
} from '../proto/notes';
import {
  createNoteNode,
  deleteNoteNode,
  duplicateNoteNode,
  editNoteNode,
  importMarkdownAsNote,
  openNoteNode,
  toggleNoteTask,
  updateNoteMeta,
} from '../services/notesWorkspace';
import { DeleteConfirmation } from './DeleteConfirmation';
import { NoteLinksModal } from './NoteLinksModal';

type NoteDraft = {
  kind: NoteNode['kind'];
  title: string;
  parentId: string | null;
  icon: string;
  templateId?: string;
  nodeId?: string;
};

const iconBtnClass =
  'inline-flex items-center justify-center rounded-md p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 cursor-pointer transition';

export function NotesDirectory({
  projectId,
  onCollapse,
}: {
  projectId: string;
  onCollapse?: () => void;
}) {
  const data = useProtoStore((state) => state.projectNotes);
  const selectedId = useProtoStore((state) => state.selectedNoteNodeId);
  const selected = data.nodes.find((node) => node.id === selectedId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sidebarMode, setSidebarMode] = useState<'tree' | 'tasks'>('tree');
  const [taskFilter, setTaskFilter] = useState<'pending' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState<string>('ALL');
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [deleting, setDeleting] = useState<NoteNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allTasks = useMemo(() => extractAllNoteTasks(data), [data]);
  const pendingTaskCount = useMemo(
    () => allTasks.filter((t) => !t.checked).length,
    [allTasks]
  );

  const defaultParentId =
    selected === undefined
      ? null
      : selected.kind === 'folder'
      ? selected.id
      : selected.parentId;

  const allNoteCount = useMemo(
    () => data.nodes.filter((n) => n.kind === 'note').length,
    [data.nodes]
  );

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const node of data.nodes) {
      if (node.kind === 'note') {
        for (const t of node.tags) set.add(t);
      }
    }
    return [...set];
  }, [data.nodes]);

  const pinnedNotes = useMemo(
    () => data.nodes.filter((n): n is Extract<NoteNode, { kind: 'note' }> => n.kind === 'note' && n.pinned),
    [data.nodes]
  );

  // Full-text search results (when searchQuery or activeTagFilter is active)
  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q && activeTagFilter === 'ALL') return null;

    return data.nodes
      .filter((node): node is Extract<NoteNode, { kind: 'note' }> => node.kind === 'note')
      .map((node) => {
        const plain = noteHtmlToPlainText(node.content);
        const titleMatch = node.title.toLowerCase().includes(q);
        const tagMatch = node.tags.some((t) => t.toLowerCase().includes(q));
        const bodyIdx = q ? plain.toLowerCase().indexOf(q) : -1;
        const matchesQuery = !q || titleMatch || tagMatch || bodyIdx !== -1;
        const matchesTag =
          activeTagFilter === 'ALL'
            ? true
            : activeTagFilter === 'PINNED'
            ? node.pinned
            : node.tags.includes(activeTagFilter);

        if (!matchesQuery || !matchesTag) return null;

        let snippet = '';
        if (q && bodyIdx !== -1) {
          const start = Math.max(0, bodyIdx - 18);
          const end = Math.min(plain.length, bodyIdx + q.length + 36);
          snippet = (start > 0 ? '…' : '') + plain.slice(start, end).replace(/\n+/g, ' ') + (end < plain.length ? '…' : '');
        } else if (plain) {
          snippet = plain.slice(0, 48).replace(/\n+/g, ' ') + (plain.length > 48 ? '…' : '');
        }
        return { node, snippet };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [data.nodes, searchQuery, activeTagFilter]);

  const handleImportMarkdownFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const id = importMarkdownAsNote(projectId, file.name, text, defaultParentId);
    openNoteNode(projectId, id);
  };

  const renderNodes = (parent: string | null, depth = 0): React.ReactNode =>
    data.nodes
      .filter((node) => node.parentId === parent)
      .map((node) => {
        const isSelected = selectedId === node.id;
        const isFolder = node.kind === 'folder';
        const isCollapsed = collapsed.has(node.id);
        const childCount = isFolder
          ? data.nodes.filter((n) => n.parentId === node.id).length
          : 0;

        return (
          <div key={node.id} className="select-none">
            <div
              data-note-node={node.id}
              style={{ paddingLeft: 8 + depth * 14 }}
              className={`group flex items-center justify-between gap-1 pr-2 py-1 text-xs rounded-lg mx-1.5 my-0.5 transition ${
                isSelected
                  ? 'bg-blue-50/90 text-blue-700 font-medium ring-1 ring-blue-200/70'
                  : 'text-slate-700 hover:bg-slate-100/80'
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1">
                {isFolder ? (
                  <button
                    type="button"
                    className="p-0.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                    aria-label={`${isCollapsed ? '展开' : '收起'}${node.title}`}
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((ids) => {
                        const next = new Set(ids);
                        if (next.has(node.id)) next.delete(node.id);
                        else next.add(node.id);
                        return next;
                      })
                    }
                  >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}

                <button
                  type="button"
                  aria-current={isSelected ? 'page' : undefined}
                  onClick={() => {
                    openNoteNode(projectId, node.id);
                    if (isFolder && isCollapsed) {
                      setCollapsed((ids) => {
                        const next = new Set(ids);
                        next.delete(node.id);
                        return next;
                      });
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left cursor-pointer"
                  title={notePath(data, node.id)}
                >
                  <span className="shrink-0 text-sm leading-none">{node.icon}</span>
                  <span className="truncate">{node.title}</span>
                  {node.kind === 'note' && node.status && node.status !== 'draft' && (
                    <span
                      title={
                        NOTE_STATUS_OPTIONS.find((s) => s.id === node.status)?.label || ''
                      }
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        NOTE_STATUS_OPTIONS.find((s) => s.id === node.status)?.dotClass ||
                        'bg-slate-400'
                      }`}
                    />
                  )}
                  {node.kind === 'note' && node.pinned && (
                    <Star size={11} className="shrink-0 text-amber-500 fill-amber-400" />
                  )}
                  {isFolder && childCount > 0 && (
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {childCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Hover Quick Actions */}
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                {isFolder ? (
                  <>
                    <button
                      type="button"
                      title="在此目录新建笔记"
                      aria-label={`在${node.title}中新建笔记`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft({
                          kind: 'note',
                          title: '',
                          parentId: node.id,
                          icon: '🤝',
                          templateId: 'customer-discovery',
                        });
                      }}
                      className={iconBtnClass}
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      type="button"
                      title="在此目录新建子目录"
                      aria-label={`在${node.title}中新建子目录`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft({
                          kind: 'folder',
                          title: '',
                          parentId: node.id,
                          icon: '📁',
                        });
                      }}
                      className={iconBtnClass}
                    >
                      <FolderPlus size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      title={node.pinned ? '取消置顶' : '置顶笔记'}
                      aria-label={node.pinned ? `取消置顶${node.title}` : `置顶${node.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateNoteMeta(projectId, node.id, { pinned: !node.pinned });
                      }}
                      className={iconBtnClass}
                    >
                      <Pin size={11} className={node.pinned ? 'text-amber-500' : ''} />
                    </button>
                    <button
                      type="button"
                      title="复制笔记"
                      aria-label={`复制${node.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const copyId = duplicateNoteNode(projectId, node.id);
                        openNoteNode(projectId, copyId);
                      }}
                      className={iconBtnClass}
                    >
                      <Copy size={11} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  title="重命名 / 移动"
                  aria-label={`重命名${node.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDraft({
                      kind: node.kind,
                      title: node.title,
                      parentId: node.parentId,
                      icon: node.icon,
                      nodeId: node.id,
                    });
                  }}
                  className={iconBtnClass}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  title="删除"
                  aria-label={`删除${node.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(node);
                  }}
                  className="inline-flex items-center justify-center rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer transition"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>

            {isFolder && !isCollapsed && renderNodes(node.id, depth + 1)}
          </div>
        );
      });

  return (
    <aside
      aria-label="项目笔记目录"
      className="flex w-[264px] shrink-0 flex-col border-r border-slate-200 bg-white h-full select-none"
    >
      {/* Top Header */}
      <header className="px-3 py-2.5 border-b border-slate-200 bg-slate-50/60 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <BookOpenText className="w-4 h-4 text-blue-600 shrink-0" />
            <h2 className="text-xs font-semibold text-slate-800 truncate">项目笔记</h2>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-600 text-[10px] font-mono">
              {allNoteCount}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              title="新建笔记分类目录"
              aria-label="新建笔记目录"
              onClick={() =>
                setDraft({
                  kind: 'folder',
                  title: '',
                  parentId: defaultParentId,
                  icon: '📁',
                })
              }
              className="flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer transition shadow-2xs"
            >
              <FolderPlus size={12} className="text-slate-500" />
              <span>目录</span>
            </button>
            <button
              type="button"
              title="新建笔记"
              aria-label="新建笔记"
              onClick={() =>
                setDraft({
                  kind: 'note',
                  title: '',
                  parentId: defaultParentId,
                  icon: '🤝',
                  templateId: 'customer-discovery',
                })
              }
              className="flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 cursor-pointer transition shadow-2xs"
            >
              <Plus size={12} />
              <span>新建笔记</span>
            </button>
          </div>
        </div>

        {/* Directory Tree vs Global Action Items Switcher */}
        <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-slate-200/70 text-[11px]">
          <button
            type="button"
            onClick={() => setSidebarMode('tree')}
            className={`py-1 px-2 rounded-md font-medium flex items-center justify-center gap-1 cursor-pointer transition ${
              sidebarMode === 'tree'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpenText size={12} />
            <span>目录树 ({allNoteCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarMode('tasks')}
            className={`py-1 px-2 rounded-md font-medium flex items-center justify-center gap-1 cursor-pointer transition ${
              sidebarMode === 'tasks'
                ? 'bg-white text-blue-600 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckSquare size={12} />
            <span>全局待办</span>
            {pendingTaskCount > 0 && (
              <span className="px-1.5 py-0.1 rounded-full bg-amber-500 text-white text-[9px] font-semibold leading-tight">
                {pendingTaskCount}
              </span>
            )}
          </button>
        </div>

        {/* Full-text search box */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="全文搜索笔记标题、标签或内容..."
            aria-label="搜索项目笔记"
            className="w-full pl-8 pr-6 py-1 text-xs rounded-lg bg-white border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        {(availableTags.length > 0 || pinnedNotes.length > 0) && (
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTagFilter('ALL')}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 cursor-pointer transition ${
                activeTagFilter === 'ALL'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              全部
            </button>
            {pinnedNotes.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setActiveTagFilter(activeTagFilter === 'PINNED' ? 'ALL' : 'PINNED')
                }
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 flex items-center gap-1 cursor-pointer transition ${
                  activeTagFilter === 'PINNED'
                    ? 'bg-amber-500 text-white'
                    : 'bg-amber-50 text-amber-800 border border-amber-200/80 hover:bg-amber-100/70'
                }`}
              >
                <Star size={9} className="fill-current" />
                <span>置顶 ({pinnedNotes.length})</span>
              </button>
            )}
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setActiveTagFilter(activeTagFilter === tag ? 'ALL' : tag)
                }
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 cursor-pointer transition ${
                  activeTagFilter === tag
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Main Tree, Global Tasks, or Search Results */}
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {sidebarMode === 'tasks' ? (
          <div className="px-2.5 space-y-2">
            <div className="flex items-center justify-between px-1 py-0.5 text-[11px]">
              <span className="font-semibold text-slate-600">
                跨纪要待办汇总 ({pendingTaskCount} 未完成 / {allTasks.length} 总计)
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTaskFilter('pending')}
                  className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                    taskFilter === 'pending'
                      ? 'bg-blue-600 text-white font-medium'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  未完成
                </button>
                <button
                  type="button"
                  onClick={() => setTaskFilter('all')}
                  className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                    taskFilter === 'all'
                      ? 'bg-blue-600 text-white font-medium'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  全部
                </button>
              </div>
            </div>

            {allTasks.filter((t) => (taskFilter === 'pending' ? !t.checked : true))
              .length === 0 ? (
              <div className="py-8 px-3 text-center space-y-1.5">
                <p className="text-xs font-medium text-slate-600">
                  {taskFilter === 'pending'
                    ? '🎉 所有笔记中的待办事项均已闭环！'
                    : '暂无待办事项'}
                </p>
                <p className="text-[11px] text-slate-400">
                  在任意笔记中输入 <code className="px-1 rounded bg-slate-100">/todo</code> 即可添加待跟进事项。
                </p>
              </div>
            ) : (
              allTasks
                .filter((t) => (taskFilter === 'pending' ? !t.checked : true))
                .filter(
                  (t) =>
                    !searchQuery.trim() ||
                    t.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    t.noteTitle.toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((item) => (
                  <div
                    key={`${item.noteId}-${item.taskIndex}`}
                    className={`p-2.5 rounded-xl border transition space-y-1.5 ${
                      item.checked
                        ? 'bg-slate-50/60 border-slate-200/70 opacity-70'
                        : 'bg-white border-slate-200 hover:border-blue-300 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        aria-label={`勾选待办：${item.text}`}
                        onChange={() =>
                          toggleNoteTask(projectId, item.noteId, item.taskIndex)
                        }
                        className="mt-0.5 rounded border-slate-300 cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => openNoteNode(projectId, item.noteId)}
                        className={`text-left text-xs leading-4 flex-1 cursor-pointer hover:text-blue-600 ${
                          item.checked ? 'line-through text-slate-400' : 'text-slate-800 font-medium'
                        }`}
                      >
                        {item.text}
                      </button>
                    </div>
                    <div className="flex items-center justify-between pl-5 text-[10px] text-slate-400">
                      <button
                        type="button"
                        onClick={() => openNoteNode(projectId, item.noteId)}
                        className="truncate hover:text-blue-600 cursor-pointer flex items-center gap-1"
                      >
                        <span>{item.noteIcon}</span>
                        <span className="truncate max-w-[140px]">{item.noteTitle}</span>
                      </button>
                    </div>
                  </div>
                ))
            )}
          </div>
        ) : filteredNotes !== null ? (
          <div className="px-2 space-y-1">
            <div className="px-1.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>检索结果 ({filteredNotes.length})</span>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveTagFilter('ALL');
                }}
                className="text-blue-600 hover:underline cursor-pointer font-normal"
              >
                重置筛选
              </button>
            </div>
            {filteredNotes.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-slate-400">
                未找到匹配的笔记内容
              </p>
            ) : (
              filteredNotes.map(({ node, snippet }) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => openNoteNode(projectId, node.id)}
                  className={`w-full text-left p-2 rounded-xl border transition cursor-pointer space-y-1 ${
                    selectedId === node.id
                      ? 'bg-blue-50/80 border-blue-300 text-blue-900'
                      : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm shrink-0">{node.icon}</span>
                    <span className="text-xs font-semibold truncate flex-1">
                      {node.title}
                    </span>
                  </div>
                  {snippet && (
                    <p className="text-[11px] text-slate-500 line-clamp-2 leading-4 pl-5">
                      {snippet}
                    </p>
                  )}
                  {node.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pl-5 pt-0.5">
                      {node.tags.map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px]"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            {/* Pinned Section */}
            {pinnedNotes.length > 0 && (
              <div className="mb-3">
                <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Star size={10} className="text-amber-500 fill-amber-400" />
                  <span>置顶笔记</span>
                </div>
                {pinnedNotes.map((node) => (
                  <button
                    key={`pin-${node.id}`}
                    type="button"
                    onClick={() => openNoteNode(projectId, node.id)}
                    className={`w-[calc(100%-12px)] mx-1.5 my-0.5 px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 text-left cursor-pointer transition ${
                      selectedId === node.id
                        ? 'bg-blue-50/90 text-blue-700 font-medium ring-1 ring-blue-200/70'
                        : 'text-slate-700 hover:bg-slate-100/80'
                    }`}
                  >
                    <span className="text-sm shrink-0">{node.icon}</span>
                    <span className="truncate flex-1">{node.title}</span>
                  </button>
                ))}
              </div>
            )}

            {/* All Notes Tree */}
            <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              笔记与分类目录
            </div>
            {renderNodes(null)}

            {!data.nodes.length && (
              <div className="px-4 py-8 text-center space-y-2.5">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto text-lg">
                  📝
                </div>
                <p className="text-xs font-medium text-slate-700">还没有项目笔记</p>
                <p className="text-[11px] leading-5 text-slate-500">
                  像使用 Notion 一样建立多层级目录，记录客户访谈需求、原型评审纪要与业务规则。
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-2.5 border-t border-slate-200 bg-slate-50/70 space-y-1.5 text-[11px]">
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          onChange={handleImportMarkdownFile}
          className="hidden"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setDraft({
                kind: 'note',
                title: '',
                parentId: defaultParentId,
                icon: '🤝',
                templateId: 'customer-discovery',
              })
            }
            className="flex-1 py-1.5 px-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>从模板新建</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="导入本地 Markdown (.md) 文件为笔记"
            className="py-1.5 px-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-medium flex items-center justify-center gap-1 cursor-pointer shadow-2xs transition shrink-0"
          >
            <FileUp className="w-3.5 h-3.5 text-slate-500" />
            <span>导入 .md</span>
          </button>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="w-full py-1 text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer text-center"
          >
            收起笔记目录侧栏
          </button>
        )}
      </div>

      {draft && (
        <NoteNodeModal
          projectId={projectId}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(id) => {
            setCollapsed(new Set());
            openNoteNode(projectId, id);
            setDraft(null);
          }}
        />
      )}

      {deleting && (
        <DeleteConfirmation
          title={deleting.kind === 'folder' ? '删除笔记目录' : '删除项目笔记'}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            deleteNoteNode(projectId, deleting.id);
            setDeleting(null);
          }}
        >
          <p>
            确认删除「<strong className="text-slate-900">{deleting.title}</strong>」
            {deleting.kind === 'folder'
              ? `及其下的 ${noteDescendants(data, deleting.id).size - 1} 个子节点`
              : ''}
            ？
          </p>
          <p className="text-xs text-slate-500">
            对应的笔记内容及页面关联会一并清理，已创建的原型页面和数据表会保留。
          </p>
        </DeleteConfirmation>
      )}
    </aside>
  );
}

function NoteNodeModal({
  projectId,
  draft,
  onClose,
  onSaved,
}: {
  projectId: string;
  draft: NoteDraft;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const data = useProtoStore((state) => state.projectNotes);
  const [title, setTitle] = useState(draft.title);
  const [parentId, setParentId] = useState<string | null>(draft.parentId);
  const [icon, setIcon] = useState(draft.icon);
  const [templateId, setTemplateId] = useState(draft.templateId || 'customer-discovery');
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const excluded =
    draft.nodeId === undefined ? new Set<string>() : noteDescendants(data, draft.nodeId);
  const parents = data.nodes.filter(
    (node) => node.kind === 'folder' && !excluded.has(node.id)
  );

  const emojis = useMemo(
    () => NOTE_EMOJI_CATALOG.flatMap((c) => c.emojis).slice(0, 20),
    []
  );

  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      aria-label="笔记节点设置"
      className="pf-notes-surface m-auto w-[440px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-0 text-sm shadow-2xl backdrop:bg-slate-900/40"
    >
      <form
        className="p-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            if (draft.nodeId === undefined) {
              if (draft.kind === 'folder') {
                onSaved(createNoteNode(projectId, 'folder', title, parentId, { icon }));
              } else {
                const tpl =
                  NOTE_TEMPLATES.find((t) => t.id === templateId) ?? NOTE_TEMPLATES[0];
                onSaved(
                  createNoteNode(projectId, 'note', title, parentId, {
                    icon: icon || tpl.icon,
                    content: noteTemplateContent(tpl),
                    tags: tpl.tags,
                    cover: tpl.cover,
                  })
                );
              }
            } else {
              editNoteNode(projectId, draft.nodeId, title, parentId, icon);
              onSaved(draft.nodeId);
            }
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
          }
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">
            {draft.nodeId
              ? '重命名 / 移动位置'
              : draft.kind === 'folder'
              ? '新建笔记分类目录'
              : '新建项目笔记'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Icon & Title */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            图标与名称
          </label>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-lg shrink-0">
              {icon}
            </span>
            <input
              autoFocus
              required
              maxLength={100}
              aria-label="笔记节点名称"
              placeholder={
                draft.kind === 'folder'
                  ? '例如：一、客户需求访谈记录'
                  : '例如：2026-11 采购模块客户沟通纪要'
              }
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {(draft.kind === 'folder' ? ['📁', '🗂️', '📂', '🏢', '📦', '🧭', '🏷️', '🔐'] : emojis).map(
              (em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setIcon(em)}
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-xs cursor-pointer transition ${
                    icon === em
                      ? 'bg-blue-100 ring-1 ring-blue-500'
                      : 'hover:bg-slate-100'
                  }`}
                >
                  {em}
                </button>
              )
            )}
          </div>
        </div>

        {/* Parent Folder */}
        <label className="block text-xs font-medium text-slate-700">
          所属目录
          <select
            aria-label="笔记所属目录"
            value={parentId === null ? '' : parentId}
            onChange={(event) =>
              setParentId(event.target.value === '' ? null : event.target.value)
            }
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-800"
          >
            <option value="">顶层目录</option>
            {parents.map((node) => (
              <option key={node.id} value={node.id}>
                {node.icon} {notePath(data, node.id)}
              </option>
            ))}
          </select>
        </label>

        {/* Initial Template (Only when creating a new note) */}
        {draft.nodeId === undefined && draft.kind === 'note' && (
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700">
              选择初始内容模板
            </span>
            <div className="grid grid-cols-2 gap-2">
              {NOTE_TEMPLATES.map((tpl) => {
                const active = templateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setTemplateId(tpl.id);
                      setIcon(tpl.icon);
                      if (!title.trim() && tpl.id !== 'blank-note') {
                        setTitle(tpl.title);
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer space-y-1 ${
                      active
                        ? 'border-blue-600 bg-blue-50/70 ring-1 ring-blue-600/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                      <span>{tpl.icon}</span>
                      <span className="truncate">{tpl.title}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 line-clamp-2 leading-4">
                      {tpl.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-rose-600 font-medium">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            取消
          </button>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-1.5 font-medium text-white cursor-pointer"
          >
            {draft.nodeId ? '保存修改' : '立即创建'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function NoteRelations({
  projectId,
  node,
}: {
  projectId: string;
  node: NoteNode;
}) {
  const data = useProtoStore((state) => state.projectNotes);
  const { setActivePage, setViewMode } = useProtoStore();
  const layout = usePageStore();
  const [open, setOpen] = useState(false);

  const links =
    node.kind === 'note'
      ? noteContext(data, node.id, layout).links
      : data.links.filter((link) => link.targetNodeId === node.id);

  const items = flattenSitemap(
    buildSitemap(
      layout.designerFolders,
      layout.designerPages,
      layout.sitemapOverrides,
      layout.sitemapBase
    )
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-slate-400 font-medium min-w-[64px]">关联页面</span>
      {links.map((link, index) => {
        const ref = link.page;
        const item = items.find((it) =>
          ref.kind === 'folder'
            ? it.type === 'folder' && it.id === ref.folderId
            : it.type === 'page' && it.pageId === ref.pageId
        );
        const isPage = ref.kind === 'page';
        return (
          <button
            key={index}
            type="button"
            onClick={() => {
              if (ref.kind === 'page') {
                setActivePage(ref.pageId);
                setViewMode('single_page');
              }
            }}
            title={isPage ? '点击跳转到该原型页面' : '已关联模块目录'}
            className={`inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[11px] text-slate-700 shadow-2xs transition ${
              isPage ? 'hover:border-blue-300 hover:text-blue-600 cursor-pointer' : 'cursor-default'
            }`}
          >
            <span>{isPage ? '📄' : '📁'}</span>
            <span>
              {item?.title || '未知页面'}
              {link.targetNodeId !== node.id ? ' (目录继承)' : ''}
            </span>
            {isPage && <ExternalLink size={10} className="text-slate-400" />}
          </button>
        );
      })}
      {!links.length && <span className="text-slate-400 text-[11px]">尚未关联原型页面</span>}
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-slate-200/80 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 cursor-pointer transition"
        onClick={() => setOpen(true)}
      >
        <Link2 size={11} />
        <span>管理关联</span>
      </button>
      {open && (
        <NoteLinksModal
          projectId={projectId}
          targetNodeId={node.id}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export function getTagColorClass(tag: string): string {
  const found = NOTE_PRESET_TAGS.find((t) => t.label === tag);
  return found ? found.colorClass : 'bg-slate-100 text-slate-700 border-slate-200';
}
