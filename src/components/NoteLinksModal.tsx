import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, ExternalLink, Link2, X } from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { buildSitemap } from '../proto/sitemap';
import { pageRefKey } from '../proto/mindmaps';
import { notePath, type NotePageRef } from '../proto/notes';
import { openNoteNode, setNoteTargetLinks, setPageNoteLinks } from '../services/notesWorkspace';
import { useI18n } from '../i18n';

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
  const { tr, td } = useI18n();
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
        if (!source) throw new Error(tr('请选择页面或页面目录', 'Please select a page or folder'));
        setPageNoteLinks(projectId, source.ref, selectedNoteIds);
        onClose();
      }
    } catch (failure) {
      setError(td(failure instanceof Error ? failure.message : String(failure)));
    }
  };

  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      aria-label={tr('关联页面与项目笔记', 'Link Pages & Project Notes')}
      className="pf-notes-surface m-auto w-[560px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={handleSubmit}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 bg-slate-50/70">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 min-w-0">
            <Link2 size={16} className="text-blue-600 shrink-0" />
            <span className="truncate">
              {isNoteToPagesMode
                ? tr(`关联原型页面 · ${targetNode?.icon || '📝'} ${targetNode?.title || ''}`, `Link Prototype Pages · ${targetNode?.icon || '📝'} ${targetNode?.title || ''}`)
                : tr('关联页面与项目笔记', 'Link Pages & Project Notes')}
            </span>
          </h2>
          <button
            type="button"
            aria-label={tr('关闭关联设置', 'Close link settings')}
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </header>

        <div className="space-y-4 p-5 text-xs text-slate-700">
          {isNoteToPagesMode ? (
            <>
              <p className="leading-5 text-slate-500">
                {tr('勾选与当前笔记相关的原型页面或模块目录（支持多选）。关联后，不仅可以在笔记顶部一键跳转到对应原型页面，还能在将笔记发送给项目 AI 时自动附带关联页面上下文。', 'Select prototype pages or folders related to this note (multi-select). Linked pages appear as quick-jump links at the top of the note and provide automatic context when sending the note to Project AI.')}
              </p>
              <div
                className="max-h-64 space-y-1 overflow-auto rounded-xl border border-slate-200 p-2 bg-slate-50/40"
                aria-label={tr('原型页面关联列表', 'Prototype pages to link')}
              >
                {!sources.length && (
                  <p className="p-3 text-slate-500">{tr('当前工程还没有可关联的页面或目录。', 'No pages or folders available to link in this project.')}</p>
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
                            {item.ref.kind === 'folder' ? tr('📁 目录 · ', '📁 Folder · ') : tr('📄 页面 · ', '📄 Page · ')}
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
                          <span>{tr('打开页面', 'Open Page')}</span>
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
                {tr('页面或页面目录', 'Page or Folder')}
                <select
                  aria-label={tr('关联的页面或目录', 'Linked page or folder')}
                  value={sourceKey}
                  disabled={page !== undefined}
                  onChange={(event) => setSourceKey(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-800"
                >
                  <option value="">{tr('请选择', 'Select...')}</option>
                  {sources.map((item) => (
                    <option key={pageRefKey(item.ref)} value={pageRefKey(item.ref)}>
                      {item.ref.kind === 'folder' ? tr('目录 · ', 'Folder · ') : tr('页面 · ', 'Page · ')}
                      {item.path}
                    </option>
                  ))}
                </select>
              </label>
              <p className="leading-5 text-slate-500">
                {tr('选择要关联的需求笔记或笔记目录，可多选。关联后可在左侧页面目录快速查看或打开对应的客户需求笔记。', 'Select requirement notes or note folders to link (multi-select). Linked notes can be viewed and opened directly from the left page tree.')}
              </p>
              <div
                className="max-h-64 space-y-1 overflow-auto rounded-xl border border-slate-200 p-2 bg-slate-50/40"
                aria-label={tr('笔记关联目标', 'Note link targets')}
              >
                {!data.nodes.length && (
                  <p className="p-3 text-slate-500 flex items-center gap-1.5">
                    <BookOpenText size={14} className="text-slate-400 shrink-0" />
                    <span>{tr('请先到左侧「项目笔记」中新建客户需求笔记或目录。', 'Create a requirement note or folder in "Project Notes" on the left first.')}</span>
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
                        {node.icon} {node.kind === 'folder' ? tr('目录 · ', 'Folder · ') : tr('笔记 · ', 'Note · ')}
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
                      {tr('打开笔记', 'Open Note')}
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
            {tr('取消', 'Cancel')}
          </button>
          <button
            disabled={!isNoteToPagesMode && !source}
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-1.5 font-medium text-white disabled:opacity-40 cursor-pointer"
          >
            {tr('保存关联', 'Save Links')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
