import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Maximize2, Network, Search, X } from 'lucide-react';
import { mindmapPath } from '../proto/mindmaps';
import { useProtoStore } from '../store/useProtoStore';
import { openMindmapNode } from '../services/mindmapWorkspace';
import { renderMindmap } from '../services/mindmapRenderer';
import type { ChatMindmap } from '../services/projectChatMindmaps';
import { useI18n } from '../i18n';

export function MindmapPicker({ selected, onApply, onClose }: {
  selected: string[]; onApply: (ids: string[]) => void; onClose: () => void;
}) {
  const { tr } = useI18n();
  const workspace = useProtoStore(s => s.mindmaps);
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(selected);
  const documents = useMemo(() => workspace.nodes.flatMap(node => node.kind === 'mindmap'
    ? [{ node, path: mindmapPath(workspace, node.id) }] : []), [workspace]);
  const visible = documents.filter(item => item.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const canApply = picked.every(id => documents.some(({ node }) => node.id === id && node.source.trim()));
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return <dialog ref={dialog} aria-label={tr('选择项目脑图', 'Select project mindmaps')} onCancel={onClose}
    className="m-auto w-[30rem] max-w-[92vw] rounded-xl border border-slate-200 bg-white p-0 text-sm text-slate-800 shadow-xl backdrop:bg-slate-900/35">
    <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <h2 className="font-semibold">{tr('选择项目脑图', 'Select Project Mindmaps')}</h2>
      <button type="button" aria-label={tr('关闭脑图选择', 'Close mindmap picker')} onClick={onClose} className="cursor-pointer"><X size={16}/></button>
    </header>
    <div className="px-4 pt-3">
      <p className="mb-2 text-xs text-slate-500">{tr('可选择多张，与文字和图片一起发送。', 'Select one or more mindmaps to attach alongside your prompt and images.')}</p>
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5"><Search size={14}/>
        <input autoFocus aria-label={tr('搜索脑图', 'Search mindmaps')} value={query} onChange={e => setQuery(e.target.value)}
          placeholder={tr('搜索脑图名称或目录', 'Search mindmap name or folder')} className="min-w-0 flex-1 outline-none"/>
      </label>
    </div>
    <div className="max-h-[45vh] overflow-y-auto p-3">
      {visible.map(({node, path}) => <label key={node.id} className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-50 cursor-pointer">
        <input type="checkbox" checked={picked.includes(node.id)} disabled={!node.source.trim() && !picked.includes(node.id)}
          onChange={e => setPicked(e.target.checked ? [...picked, node.id] : picked.filter(id => id !== node.id))}/>
        <span className="min-w-0 break-words">{path}</span>
        {!node.source.trim() && <span className="ml-auto shrink-0 text-xs text-slate-500">{tr('暂无内容', 'Empty')}</span>}
      </label>)}
      {!visible.length && <p className="p-2 text-xs text-slate-500">{documents.length ? tr('没有找到匹配的脑图。', 'No matching mindmaps found.') : tr('当前项目还没有脑图，可以先到「项目脑图」创建。', 'No mindmaps in this project yet — create one in "Project Mindmaps" first.')}</p>}
    </div>
    <footer className="flex items-center gap-3 border-t border-slate-100 px-4 py-3">
      <span className="mr-auto text-xs text-slate-500 tabular-nums">{tr(`已选 ${picked.length} 张`, `${picked.length} selected`)}</span>
      <button type="button" onClick={onClose} className="text-sm text-slate-600 cursor-pointer">{tr('取消', 'Cancel')}</button>
      <button type="button" disabled={!canApply} onClick={() => { onApply(picked); onClose(); }}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-40 cursor-pointer">{tr('使用所选脑图', 'Attach Selected')}</button>
    </footer>
  </dialog>;
}

export function MindmapAttachmentCard({ map }: { map: ChatMindmap }) {
  const { tr } = useI18n();
  const card = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const canOpen = useProtoStore(s => !s.isProjectClosed && s.currentProjectMeta.projectId === map.projectId &&
    s.mindmaps.nodes.some(n => n.kind === 'mindmap' && n.id === map.mindmapId));
  // Only render diagrams near the chat viewport. History holds source, never SVG markup.
  useEffect(() => {
    if (!card.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, {rootMargin:'160px'});
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setUrl(''); setError('');
    void renderMindmap(map.source, false).then(svg => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
      setUrl(objectUrl);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : tr('无法绘制脑图', 'Unable to render mindmap')); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, map.source, tr]);
  const openCurrent = () => { dialog.current?.close(); openMindmapNode(map.projectId, map.mindmapId); };
  return <figure ref={card} className="w-40 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-800">
    <button type="button" aria-label={tr(`预览脑图：${map.path}`, `Preview mindmap: ${map.path}`)} title={tr(`放大查看发送时的脑图：${map.path}`, `Inspect snapshot mindmap: ${map.path}`)}
      onClick={() => { setVisible(true); setZoom(1); dialog.current?.showModal(); }}
      className="relative block w-full cursor-zoom-in bg-slate-50 hover:bg-blue-50">
      <Maximize2 aria-hidden size={16} className="absolute right-1 top-1 rounded bg-white/90 p-0.5 text-slate-500"/>
      {url && !error ? <img src={url} alt={map.title} onError={() => setError(tr('图像加载失败', 'Failed to load image'))} className="h-20 w-full object-contain p-1"/>
        : <span className="flex h-20 items-center justify-center gap-1 text-xs text-slate-600"><Network size={16}/>{error ? tr('查看脑图原文', 'View source') : tr('正在绘制…', 'Rendering…')}</span>}
    </button>
    <figcaption className="px-2 py-1.5 text-xs">
      <strong className="block truncate" title={map.path}>{map.title}</strong>
      {map.path !== map.title && <span className="block truncate text-[10px] text-slate-500" title={map.path}>{map.path}</span>}
      <button type="button" aria-label={tr(`前往脑图：${map.path}`, `Open mindmap: ${map.path}`)} disabled={!canOpen} onClick={openCurrent}
        className="mt-1 inline-flex items-center gap-1 text-blue-700 disabled:text-slate-500 cursor-pointer">{canOpen ? tr('前往脑图', 'Open Mindmap') : tr('原脑图已移除', 'Mindmap removed')}<ArrowUpRight size={12}/></button>
    </figcaption>
    <dialog ref={dialog} aria-label={tr(`脑图快照：${map.path}`, `Mindmap snapshot: ${map.path}`)}
      className="m-auto w-[90vw] max-w-6xl rounded-xl border border-slate-200 bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-900/40">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{map.path}</h2><p className="text-xs text-slate-500">{tr('发送时的脑图', 'Snapshot when sent')}</p></div>
        <button type="button" aria-label={tr('关闭脑图预览', 'Close mindmap preview')} onClick={() => dialog.current?.close()} className="cursor-pointer"><X size={18}/></button>
      </header>
      <div className="h-[65vh] overflow-auto bg-slate-50">
        {error ? <div className="p-4 text-sm"><p>{tr('这版脑图暂不能绘制，以下是发送时的原文。', 'This snapshot cannot be rendered; showing original Mermaid source below.')}</p><pre className="mt-3 whitespace-pre-wrap">{map.source}</pre></div>
          : url ? <div style={{width:`${zoom * 100}%`, height:`${zoom * 100}%`}}><img src={url} alt={tr(`${map.title}大图`, `${map.title} full view`)} className="h-full w-full object-contain"/></div>
          : <p className="p-4 text-sm">{tr('正在绘制脑图…', 'Rendering mindmap…')}</p>}
      </div>
      <footer className="flex items-center gap-3 border-t border-slate-100 px-4 py-2 text-xs">
        {url && !error && <>
          <button type="button" aria-label={tr('缩小脑图', 'Zoom out mindmap')} disabled={zoom <= 1} onClick={() => setZoom(z => z - 0.5)} className="p-1 disabled:opacity-40 cursor-pointer">{tr('缩小', 'Zoom out')}</button>
          <span className="tabular-nums">{zoom * 100}%</span>
          <button type="button" aria-label={tr('放大脑图', 'Zoom in mindmap')} disabled={zoom >= 6} onClick={() => setZoom(z => z + 0.5)} className="p-1 disabled:opacity-40 cursor-pointer">{tr('放大', 'Zoom in')}</button>
        </>}
        <button type="button" disabled={!canOpen} onClick={openCurrent} className="ml-auto rounded-md border border-slate-200 px-2 py-1.5 text-blue-700 disabled:text-slate-500 cursor-pointer">
          {canOpen ? tr('前往当前脑图', 'Open Current Mindmap') : tr('原脑图已移除', 'Mindmap removed')}</button>
      </footer>
    </dialog>
  </figure>;
}
