import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAiPreviewStore, type AiPreviewPage, type AiPreviewRun } from '../../store/useAiPreviewStore';
import { useHermesStore } from '../../store/useHermesStore';
import { conversationKey, type HermesChatConversation } from '../../services/hermesConversation';
import { RuntimeProvider, useRuntimeController } from '../runtime/runtime';
import { PreviewDataContext } from '../runtime/PreviewData';
import { DesignProvider, NodeView, ScopeProvider } from '../renderer/NodeView';
import { MobileViewportShell } from '../mobile/MobileViewportShell';
import { OVERLAY_TYPES } from '../registry/meta';
import { usePageStore } from '../store/usePageStore';
import { isNode } from '../types';
import { useI18n } from '../../i18n';

const DraftCanvas = React.memo(function DraftCanvas({ page, run }: { page: AiPreviewPage; run: AiPreviewRun }) {
  const { tr } = useI18n();
  const runtime = useRuntimeController(page.doc, page.pageId, true);
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const device = usePageStore(s => s.mobileDevice);
  const root = page.doc.root;
  const overlays = root.children.filter(isNode).filter(n => OVERLAY_TYPES.has(n.type));
  const overlay = overlays.find(n => n.pfId === overlayId);
  const preview = <NodeView node={overlay ?? root} options={overlay ? { staticOverlay: true } : undefined} />;
  return <RuntimeProvider value={runtime}><PreviewDataContext.Provider value={{ tables: run.dbTables, rows: run.tableRows }}><DesignProvider value={null}><ScopeProvider value={{}}>
    {overlays.length > 0 && <div className="flex gap-2 flex-wrap mb-3" aria-label={tr('生成预览页面与弹层', 'Generated preview pages and overlays')}>
      <button type="button" onClick={() => setOverlayId(null)} className={`px-2 py-1 rounded text-xs border ${!overlay ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200'}`}>{tr('主页面', 'Main Page')}</button>
      {overlays.map(node => <button key={node.pfId} type="button" onClick={() => setOverlayId(node.pfId)} className={`px-2 py-1 rounded text-xs border ${overlay === node ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200'}`}>{String(node.props.title ?? node.props.id)}</button>)}
    </div>}
    <div
      ref={el => { if (el) el.inert = true; }}
      className={
        root.type === 'MobilePage'
          ? 'pf-mobile-canvas-stage pf-ai-aura-surface flex-[1_0_auto] flex flex-col items-center py-4 border border-slate-200 rounded-2xl pointer-events-none'
          : 'pf-paper pf-ai-aura-surface flex-[1_0_auto] flex flex-col bg-white border border-slate-200 rounded-2xl pointer-events-none'
      }
      data-ai-preview-page={page.pageId}
    >
      {root.type === 'MobilePage' ? (
        <MobileViewportShell device={device} appearance={root.props.appearance} accent={root.props.accent} surfaceBg={root.props.surfaceBg}>
          {preview}
        </MobileViewportShell>
      ) : preview}
    </div>
  </ScopeProvider></DesignProvider></PreviewDataContext.Provider></RuntimeProvider>;
});

export const AiStreamingPreview = React.memo(function AiStreamingPreview(scope: HermesChatConversation) {
  const { tr } = useI18n();
  const key = conversationKey(scope);
  const run = useAiPreviewStore(s => s.runs[key]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  if (!run?.latestPageId) return null;
  const page = selectedPageId && run.pages[selectedPageId] ? run.pages[selectedPageId] : run.pages[run.latestPageId];
  return <section aria-label={tr('AI 实时生成预览', 'AI Live Streaming Preview')} className="w-full flex-[1_0_auto] flex flex-col gap-2">
    <div className="sticky top-0 z-10 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between gap-4">
      <div role="status" className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-900"><Loader2 className="w-4 h-4 animate-spin" />{tr('正在生成 · 实时预览', 'Generating · Live Preview')}</div>
        <p className="mt-1 text-xs text-blue-700">{tr('区块会陆续显示。当前内容尚未保存，最终以校验和确认结果为准。', 'Sections stream in progressively. Draft is unsaved until validated and confirmed.')}</p>
      </div>
      <button type="button" className="shrink-0 text-xs text-blue-700 underline" onClick={() => void useHermesStore.getState().stop(scope).catch(error => useHermesStore.setState({ error: String(error) }))}>{tr('停止生成', 'Stop')}</button>
    </div>
    {Object.keys(run.pages).length > 1 && <div className="flex gap-2 flex-wrap" aria-label={tr('生成中的页面', 'Pages being generated')}>
      <button type="button" onClick={() => setSelectedPageId(null)} className="text-xs text-blue-700 px-2 py-1">{tr('跟随最新内容', 'Follow Latest')}</button>
      {Object.values(run.pages).map(p => <button key={p.pageId} type="button" onClick={() => setSelectedPageId(p.pageId)} className={`px-2 py-1 text-xs rounded border ${p.pageId === page.pageId ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white'}`}>{String(p.doc.root.props.title ?? p.pageId)}</button>)}
    </div>}
    <DraftCanvas key={page.pageId} page={page} run={run} />
  </section>;
});
