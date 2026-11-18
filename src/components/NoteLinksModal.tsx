import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, ExternalLink, Link2, X } from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { buildSitemap } from '../proto/sitemap';
import { pageRefKey } from '../proto/mindmaps';
import { notePath, type NotePageRef } from '../proto/notes';
import { openNoteNode, setNoteTargetLinks, setPageNoteLinks } from '../services/notesWorkspace';

export function NoteLinksModal({
  projectId,
  page,
  targetNodeId,
  onClose,
}: {
  projectId: string;
  page?: NotePageRef;
  targetNodeId?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const data = useProtoStore((state) => state.projectNotes);
  const { setActivePage, setViewMode } = useProtoStore();
  const layout = usePageStore();

  const sources = useMemo(() => {
    const result: { ref: NotePageRef; path: string; title: string }[] = [];
    const visit = (nodes: ReturnType<typeof buildSitemap>, prefix: string) => {
      for (const node of nodes) {
        const path = prefix ? `${prefix} / ${node.title}` : node.title;
        if (node.type === 'folder') {
          result.push({ ref: { kind: 'folder', folderId: node.id }, path, title: node.title });
          if (node.children) visit(node.children, path);
        } else if (node.type === 'page' && node.pageId !== undefined) {
          result.push({ ref: { kind: 'page', pageId: node.pageId }, path, title: node.title });
        }
      }
    };
    visit(
      buildSitemap(
        layout.designerFolders,
        layout.designerPages,
        layout.sitemapOverrides,
        layout.sitemapBase
      ),
      ''
    );
    return result;
  }, [layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase]);

  // Mode A: Opened from a Note/Folder (`targetNodeId` provided, `page` undefined) -> multi-select pages/folders!
  // Mode B: Opened from a Page/Folder in LeftSitemapTree (`page` provided) -> multi-select notes/folders!
  const isNoteToPagesMode = targetNodeId !== undefined && page === undefined;
  const targetNode = data.nodes.find((n) => n.id === targetNodeId);

  const [sourceKey, setSourceKey] = useState(page === undefined ? '' : pageRefKey(page));
  const source = sources.find((item) => pageRefKey(item.ref) === sourceKey);

  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [selectedPageKeys, setSelectedPageKeys] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (isNoteToPagesMode && targetNodeId) {
      const savedKeys = data.links
        .filter((link) => link.targetNodeId === targetNodeId)
        .map((link) => pageRefKey(link.page));
      setSelectedPageKeys(savedKeys);
    } else {
      const saved = data.links
        .filter((link) => pageRefKey(link.page) === sourceKey)
        .map((link) => link.targetNodeId);
      setSelectedNoteIds(
        targetNodeId !== undefined && saved.length === 0 ? [targetNodeId] : saved
      );
    }
  }, [isNoteToPagesMode, sourceKey, data.links, targetNodeId]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (isNoteToPagesMode && targetNodeId) {
        const chosenRefs = sources
          .filter((item) => selectedPageKeys.includes(pageRefKey(item.ref)))
          .map((item) => item.ref);
        setNoteTargetLinks(projectId, targetNodeId, chosenRefs);
        onClose();
      } else {
        if (!source) throw new Error('请选择页面或页面目录');
        setPageNoteLinks(projectId, source.ref, selectedNoteIds);
        onClose();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      aria-label="关联页面与项目笔记"
      className="pf-notes-surface m-auto w-[560px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={handleSubmit}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50/70">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Link2 size={16} className="text-blue-600" />
            <span>
              {isNoteToPagesMode
                ? `关联原型页面 · ${targetNode?.icon || '📝'} ${targetNode?.title || ''}`
                : '关联页面与项目笔记'}
            </span>
          </h2>
          <button
            type="button"
            aria-label="关闭关联设置"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 cursor-pointer"
          >
            <X size={16} />
          </button>
        </header>

        <div className="space-y-4 p-5 text-xs text-slate-700">
          {isNoteToPagesMode ? (
            <>
              <p className="leading-5 text-slate-500">
                勾选与当前笔记相关的原型页面或模块目录（支持多选）。关联后，不仅可以在笔记顶部一键跳转到对应原型页面，还能在将笔记发送给项目 AI 时自动附带关联页面上下文。
              </p>
              <div
                className="max-h-64 space-y-1 overflow-auto rounded-xl border border-slate-200 p-2 bg-slate-50/40"
                aria-label="原型页面关联列表"
              >
                {!sources.length && (
                  <p className="p-3 text-slate-500">当前工程还没有可关联的页面或目录。</p>
                )}
                {sources.map((item) => {
                  const key = pageRefKey(item.ref);
                  const checked = selectedPageKeys.includes(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 hover:bg-white transition"
                    >
                      <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedPageKeys((keys) =>
                              e.target.checked
                                ? [...keys, key]
                                : keys.filter((k) => k !== key)
                            )
                          }
                          className="rounded border-slate-300"
                        />
                        <span className="truncate">
                          <span className="text-slate-400 font-medium">
                            {item.ref.kind === 'folder' ? '📁 目录 · ' : '📄 页面 · '}
                          </span>
                          <span className="text-slate-800 font-medium">{item.path}</span>
                        </span>
                      </label>
                      {item.ref.kind === 'page' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (item.ref.kind === 'page') {
                              setActivePage(item.ref.pageId);
                              setViewMode('single_page');
                              onClose();
                            }
                          }}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline cursor-pointer"
                        >
                          <span>打开页面</span>
                          <ExternalLink size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <label className="block font-medium text-slate-700">
                页面或页面目录
                <select
                  aria-label="关联的页面或目录"
                  value={sourceKey}
                  disabled={page !== undefined}
                  onChange={(event) => setSourceKey(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-800"
                >
                  <option value="">请选择</option>
                  {sources.map((item) => (
                    <option key={pageRefKey(item.ref)} value={pageRefKey(item.ref)}>
                      {item.ref.kind === 'folder' ? '目录 · ' : '页面 · '}
                      {item.path}
                    </option>
                  ))}
                </select>
              </label>
              <p className="leading-5 text-slate-500">
                选择要关联的需求笔记或笔记目录，可多选。关联后可在左侧页面目录快速查看或打开对应的客户需求笔记。
              </p>
              <div
                className="max-h-64 space-y-1 overflow-auto rounded-xl border border-slate-200 p-2 bg-slate-50/40"
                aria-label="笔记关联目标"
              >
                {!data.nodes.length && (
                  <p className="p-3 text-slate-500 flex items-center gap-1.5">
                    <BookOpenText size={14} className="text-slate-400" />
                    <span>请先到左侧「项目笔记」中新建客户需求笔记或目录。</span>
                  </p>
                )}
                {data.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white transition"
                  >
                    <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedNoteIds.includes(node.id)}
                        onChange={(event) =>
                          setSelectedNoteIds((ids) =>
                            event.target.checked
                              ? [...ids, node.id]
                              : ids.filter((id) => id !== node.id)
                          )
                        }
                      />
                      <span className="truncate">
                        {node.icon} {node.kind === 'folder' ? '目录 · ' : '笔记 · '}
                        {notePath(data, node.id)}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="shrink-0 text-blue-600 hover:underline cursor-pointer"
                      onClick={() => {
                        openNoteNode(projectId, node.id);
                        onClose();
                      }}
                    >
                      打开笔记
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-rose-600 font-medium">
              {error}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3.5 text-xs bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            取消
          </button>
          <button
            disabled={!isNoteToPagesMode && !source}
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-1.5 font-medium text-white disabled:opacity-40 cursor-pointer"
          >
            保存关联
          </button>
        </footer>
      </form>
    </dialog>
  );
}
