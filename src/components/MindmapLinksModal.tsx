import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { buildSitemap } from '../proto/sitemap';
import { mindmapPath, pageRefKey, type MindmapPageRef } from '../proto/mindmaps';
import { openMindmapNode, setPageMindmapLinks } from '../services/mindmapWorkspace';

export function MindmapLinksModal({ projectId, page, targetNodeId, onClose }: { projectId: string; page?: MindmapPageRef; targetNodeId?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const data = useProtoStore(state => state.mindmaps);
  const layout = usePageStore();
  const sources = useMemo(() => {
    const result: { ref: MindmapPageRef; path: string }[] = [];
    const visit = (nodes: ReturnType<typeof buildSitemap>, prefix: string) => {
      for (const node of nodes) {
        const path = prefix ? `${prefix} / ${node.title}` : node.title;
        if (node.type === 'folder') { result.push({ ref: { kind: 'folder', folderId: node.id }, path }); visit(node.children!, path); }
        else if (node.type === 'page' && node.pageId !== undefined) result.push({ ref: { kind: 'page', pageId: node.pageId }, path });
      }
    };
    visit(buildSitemap(layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase), '');
    return result;
  }, [layout.designerFolders, layout.designerPages, layout.sitemapOverrides, layout.sitemapBase]);
  const [sourceKey, setSourceKey] = useState(page === undefined ? '' : pageRefKey(page));
  const source = sources.find(item => pageRefKey(item.ref) === sourceKey);
  const [selected, setSelected] = useState<string[]>([]), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const saved = data.links.filter(link => pageRefKey(link.page) === sourceKey).map(link => link.targetNodeId);
    setSelected(targetNodeId !== undefined && saved.length === 0 ? [targetNodeId] : saved);
  }, [sourceKey, data.links, targetNodeId]);
  return <dialog ref={dialog} onCancel={onClose} aria-label="关联页面与脑图" className="m-auto w-[560px] max-w-[94vw] rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40">
    <form onSubmit={event => {
      event.preventDefault();
      try { if (!source) throw new Error('请选择页面或页面目录'); setPageMindmapLinks(projectId, source.ref, selected); onClose(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    }}>
      <header className="flex items-center justify-between border-b border-slate-200 p-4"><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Link2 size={16} />关联页面与脑图</h2><button type="button" aria-label="关闭关联设置" onClick={onClose}><X size={16} /></button></header>
      <div className="space-y-4 p-5 text-xs text-slate-700">
        <label className="block">页面或页面目录<select aria-label="关联的页面或目录" value={sourceKey} disabled={page !== undefined} onChange={event => setSourceKey(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-2"><option value="">请选择</option>{sources.map(item => <option key={pageRefKey(item.ref)} value={pageRefKey(item.ref)}>{item.ref.kind === 'folder' ? '目录 · ' : '页面 · '}{item.path}</option>)}</select></label>
        <p className="leading-5 text-slate-500">选择要关联的脑图目录或菜单，可多选。关联到脑图目录时，其下的脑图均可读取这些页面；页面目录会包含其中的子页面。</p>
        <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2" aria-label="脑图关联目标">
          {!data.nodes.length && <p className="p-3 text-slate-500">请先到左侧「项目脑图」中新建目录或脑图菜单。</p>}
          {data.nodes.map(node => <div key={node.id} className="flex items-center gap-2 rounded px-2 py-2 hover:bg-slate-50"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={selected.includes(node.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, node.id] : ids.filter(id => id !== node.id))} /><span>{node.kind === 'folder' ? '目录 · ' : '脑图 · '}{mindmapPath(data, node.id)}</span></label><button type="button" className="shrink-0 text-blue-600" onClick={() => { openMindmapNode(projectId, node.id); onClose(); }}>打开</button></div>)}
        </div>
        {error && <p role="alert" className="text-rose-600">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-slate-200 p-4 text-xs"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2">取消</button><button disabled={!source} type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40">保存关联</button></footer>
    </form>
  </dialog>;
}
