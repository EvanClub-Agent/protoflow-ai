import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderPlus, Link2, Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { buildSitemap } from '../proto/sitemap';
import { flattenSitemap, mindmapContext, mindmapDescendants, mindmapPath, type MindmapNode } from '../proto/mindmaps';
import { createMindmapNode, deleteMindmapNode, editMindmapNode, openMindmapNode } from '../services/mindmapWorkspace';
import { DeleteConfirmation } from './DeleteConfirmation';
import { MindmapLinksModal } from './MindmapLinksModal';
import { useI18n } from '../i18n';

type Draft = { kind: MindmapNode['kind']; title: string; parentId: string | null; nodeId?: string };
const button = 'inline-flex min-w-0 items-center gap-1 rounded p-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-blue-600 cursor-pointer';

export function MindmapDirectory({ projectId }: { projectId: string }) {
  const { isEn, tr, td } = useI18n();
  const data = useProtoStore(state => state.mindmaps);
  const selectedId = useProtoStore(state => state.selectedMindmapNodeId);
  const selected = data.nodes.find(node => node.id === selectedId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null), [deleting, setDeleting] = useState<MindmapNode | null>(null);
  const parentId = selected === undefined ? null : selected.kind === 'folder' ? selected.id : selected.parentId;
  const renderNodes = (parent: string | null, depth = 0): React.ReactNode => data.nodes.filter(node => node.parentId === parent).map(node => <div key={node.id}>
    <div data-mindmap-node={node.id} style={{ paddingLeft: 8 + depth * 14 }} className={`group flex min-w-0 items-center gap-1 pr-2 py-1 text-xs ${selectedId === node.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}>
      {node.kind === 'folder' ? <button type="button" className="p-1 shrink-0 cursor-pointer" aria-label={collapsed.has(node.id) ? tr(`展开${node.title}`, `Expand ${node.title}`) : tr(`收起${node.title}`, `Collapse ${node.title}`)} aria-expanded={!collapsed.has(node.id)} onClick={() => setCollapsed(ids => { const next = new Set(ids); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; })}>{collapsed.has(node.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button> : <span className="w-5 shrink-0" />}
      <button type="button" aria-current={selectedId === node.id ? 'page' : undefined} onClick={() => openMindmapNode(projectId, node.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left cursor-pointer" title={mindmapPath(data, node.id)}>{node.kind === 'folder' ? <Folder size={14} className="shrink-0 text-amber-500" /> : <Network size={14} className="shrink-0 text-blue-500" />}<span className="min-w-0 truncate">{node.title}</span></button>
    </div>
    {node.kind === 'folder' && !collapsed.has(node.id) && renderNodes(node.id, depth + 1)}
  </div>);
  return <aside aria-label={tr('脑图目录', 'Mindmap directory')} className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white max-md:max-h-52 max-md:w-full max-md:border-b">
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 min-w-0"><h2 className="min-w-0 truncate text-xs font-semibold text-slate-800">{tr('脑图目录', 'Mindmaps')}</h2><div className="flex shrink-0"><button className={button} title={tr('新建脑图目录', 'New mindmap folder')} aria-label={tr('新建脑图目录', 'New mindmap folder')} onClick={() => setDraft({ kind: 'folder', title: '', parentId })}><FolderPlus size={15} /></button><button className={button} title={tr('新建脑图菜单', 'New mindmap')} aria-label={tr('新建脑图菜单', 'New mindmap')} onClick={() => setDraft({ kind: 'mindmap', title: '', parentId })}><Plus size={15} /></button></div></header>
    <div className="min-h-0 flex-1 overflow-auto py-2">{renderNodes(null)}{!data.nodes.length && <p className="p-4 text-xs leading-6 text-slate-500">{tr('按模块新建目录，在目录中添加脑图菜单。每个菜单保存一张脑图。', 'Create folders by module and add mindmap items inside. Each item stores an independent diagram.')}</p>}</div>
    {selected && <div className="flex shrink-0 items-center justify-between gap-1 border-t border-slate-200 p-2 min-w-0"><button className={`${button} flex-1`} onClick={() => setDraft({ kind: selected.kind, title: selected.title, parentId: selected.parentId, nodeId: selected.id })}><Pencil size={12} className="shrink-0" /><span className="truncate">{tr('重命名 / 移动', 'Rename / Move')}</span></button><button className={`${button} shrink-0`} aria-label={tr('删除当前脑图节点', 'Delete selected mindmap item')} onClick={() => setDeleting(selected)}><Trash2 size={12} /></button></div>}
    {draft && <MindmapNodeModal projectId={projectId} draft={draft} onClose={() => setDraft(null)} onSaved={id => { setCollapsed(new Set()); openMindmapNode(projectId, id); setDraft(null); }} />}
    {deleting && <DeleteConfirmation title={deleting.kind === 'folder' ? tr('删除脑图目录', 'Delete Mindmap Folder') : tr('删除脑图菜单', 'Delete Mindmap')} onClose={() => setDeleting(null)} onConfirm={() => { deleteMindmapNode(projectId, deleting.id); setDeleting(null); }}><p>{isEn ? `Delete "${deleting.title}"${deleting.kind === 'folder' ? ` and its ${mindmapDescendants(data, deleting.id).size - 1} child item(s)` : ''}?` : `删除「${deleting.title}」${deleting.kind === 'folder' ? `及其下的 ${mindmapDescendants(data, deleting.id).size - 1} 个节点` : ''}？`}</p><p>{tr('对应的脑图源码及页面关联会一并删除，页面内容会保留。', 'Diagram source code and page links will be removed; prototype pages will be kept.')}</p></DeleteConfirmation>}
  </aside>;
}

function MindmapNodeModal({ projectId, draft, onClose, onSaved }: { projectId: string; draft: Draft; onClose: () => void; onSaved: (id: string) => void }) {
  const { tr, td } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null), data = useProtoStore(state => state.mindmaps);
  const [title, setTitle] = useState(draft.title), [parentId, setParentId] = useState<string | null>(draft.parentId), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const excluded = draft.nodeId === undefined ? new Set<string>() : mindmapDescendants(data, draft.nodeId);
  const parents = data.nodes.filter(node => node.kind === 'folder' && !excluded.has(node.id));
  return <dialog ref={dialog} onCancel={onClose} aria-label={tr('脑图节点设置', 'Mindmap item settings')} className="m-auto w-96 max-w-[92vw] rounded-xl border border-slate-200 bg-white p-5 text-sm shadow-xl backdrop:bg-slate-900/40"><form className="space-y-4" onSubmit={event => {
    event.preventDefault();
    try { if (draft.nodeId === undefined) onSaved(createMindmapNode(projectId, draft.kind, title, parentId)); else { editMindmapNode(projectId, draft.nodeId, title, parentId); onSaved(draft.nodeId); } }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }}><h2 className="font-semibold text-slate-800">{draft.nodeId ? tr('重命名 / 移动', 'Rename / Move') : draft.kind === 'folder' ? tr('新建脑图目录', 'New Mindmap Folder') : tr('新建脑图菜单', 'New Mindmap')}</h2>
    <label className="block text-xs text-slate-600">{tr('名称', 'Name')}<input autoFocus required maxLength={60} aria-label={tr('脑图节点名称', 'Mindmap item name')} value={title} onChange={event => setTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-2" /></label>
    <label className="block text-xs text-slate-600">{tr('所属目录', 'Parent Folder')}<select aria-label={tr('脑图所属目录', 'Parent folder')} value={parentId === null ? '' : parentId} onChange={event => setParentId(event.target.value === '' ? null : event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-2"><option value="">{tr('顶层', 'Root')}</option>{parents.map(node => <option key={node.id} value={node.id}>{mindmapPath(data, node.id)}</option>)}</select></label>
    {error && <p role="alert" className="text-xs text-rose-600">{td(error)}</p>}<div className="flex justify-end gap-2 text-xs"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 cursor-pointer">{tr('取消', 'Cancel')}</button><button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-white cursor-pointer">{draft.nodeId ? tr('保存', 'Save') : tr('创建', 'Create')}</button></div></form></dialog>;
}

export function MindmapRelations({ projectId, node }: { projectId: string; node: MindmapNode }) {
  const { tr } = useI18n();
  const data = useProtoStore(state => state.mindmaps), layout = usePageStore();
  const [open, setOpen] = useState(false);
  const links = node.kind === 'mindmap' ? mindmapContext(data, node.id, layout).links : data.links.filter(link => link.targetNodeId === node.id);
  const items = flattenSitemap(buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase));
  return <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200/80 bg-slate-50/60 px-4 py-1.5 text-[11px] text-slate-500"><span className="font-medium text-slate-600">{tr('关联页面', 'Linked Pages')}</span>{links.map((link, index) => {
    const ref = link.page;
    const item = items.find(item => ref.kind === 'folder' ? item.type === 'folder' && item.id === ref.folderId : item.type === 'page' && item.pageId === ref.pageId);
    return <span key={index} className="rounded-md border border-slate-200/80 bg-white px-2 py-0.5 text-slate-700 shadow-2xs">{item?.title}{link.targetNodeId !== node.id ? tr('（继承）', ' (inherited)') : ''}</span>;
  })}{!links.length && <span className="text-slate-400">{tr('尚未关联', 'Not linked')}</span>}<button className="inline-flex items-center gap-1 rounded-md border border-slate-200/80 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 whitespace-nowrap shrink-0 cursor-pointer transition" onClick={() => setOpen(true)}><Link2 size={11} className="shrink-0" />{tr('管理关联', 'Manage Links')}</button>{open && <MindmapLinksModal projectId={projectId} targetNodeId={node.id} onClose={() => setOpen(false)} />}</div>;
}
