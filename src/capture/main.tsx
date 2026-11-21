import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { setLocale } from '../i18n/runtime';
import { MobileViewportShell } from '../proto/mobile/MobileViewportShell';
import { AntdSurface } from '../proto/registry/AntdSurface';
import { NodeView } from '../proto/renderer/NodeView';
import { RuntimeProvider, useRuntimeController } from '../proto/runtime/runtime';
import { usePageStore } from '../proto/store/usePageStore';
import { useProtoStore } from '../store/useProtoStore';
import type { PreviewSnapshot } from './snapshot';

interface PreviewHost {
  snapshot(): Promise<PreviewSnapshot>;
  ready(result: { rect: { x: number; y: number; width: number; height: number } } | { error: string }): void;
}
const host = (window as Window & { alexPreview?: PreviewHost }).alexPreview;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

function Preview({ snapshot }: { snapshot: PreviewSnapshot }) {
  const stage = useRef<HTMLDivElement>(null);
  const mobile = snapshot.platform === 'mobile';
  const runtime = useRuntimeController(snapshot.doc, snapshot.pageId, false);
  useEffect(() => {
    const render = async () => {
      await frame();
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
      if (snapshot.waitMs) await new Promise(resolve => setTimeout(resolve, snapshot.waitMs));
      await frame(); await frame();
      const node = snapshot.scope === 'canvas' ? stage.current :
        stage.current?.querySelector(mobile ? '[data-mobile-appearance].pf-mobile-scope' : '[data-preview-viewport]');
      if (!node) throw new Error('Preview viewport missing');
      const { x, y, width, height } = node.getBoundingClientRect();
      host!.ready({ rect: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) } });
    };
    void render().catch(e => host!.ready({ error: String(e) }));
  }, [snapshot, mobile]);
  return <AntdSurface><RuntimeProvider value={runtime}>
    <div ref={stage} className="pf-canvas-viewport-shell box-border flex h-dvh w-full overflow-hidden bg-slate-100 p-3">
      {mobile ? <div className="m-auto"><MobileViewportShell device={snapshot.device} appearance={snapshot.doc.root.props.appearance}
        accent={snapshot.doc.root.props.accent} surfaceBg={snapshot.doc.root.props.surfaceBg}>
        <NodeView node={snapshot.doc.root} />
      </MobileViewportShell></div> :
        <div data-preview-viewport className="pf-paper flex min-w-0 flex-1 flex-col overflow-auto rounded-xl bg-white"><NodeView node={snapshot.doc.root} /></div>}
    </div>
  </RuntimeProvider></AntdSurface>;
}

if (host) void host.snapshot().then(snapshot => {
  const { tableRows, ...state } = snapshot.state;
  document.documentElement.dataset.theme = snapshot.theme;
  setLocale(snapshot.locale);
  useProtoStore.setState({ ...state, currentProjectMeta: snapshot.meta, activePageId: snapshot.pageId, isWebPlayerMode: true });
  usePageStore.setState({ tableRows, pageSources: {}, designerPages: [], designerFolders: [], history: {} });
  createRoot(document.getElementById('root')!, { onRecoverableError: e => host.ready({ error: String(e) }) }).render(<Preview snapshot={snapshot} />);
}).catch(e => host.ready({ error: String(e) }));
window.addEventListener('error', event => host?.ready({ error: event.message }));
