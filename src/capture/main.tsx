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
import { CaptureMode } from './CaptureMode';
import type { PreviewSnapshot } from './snapshot';

interface PreviewHost {
  snapshot(): Promise<PreviewSnapshot>;
  ready(result: { rect: { x: number; y: number; width: number; height: number }; truncated: boolean } | { error: string }): void;
}
const host = (window as Window & { alexPreview?: PreviewHost }).alexPreview;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

async function waitForMaterials(stage: HTMLElement) {
  const pending = '[data-chart-status="loading"], [data-freeform-status="loading"]';
  const started = performance.now();
  for (;;) {
    await frame();
    const waiting = Array.from(stage.querySelectorAll(pending)).filter(el => {
      const rect = el.getBoundingClientRect();
      const clip = el.closest('.pf-mobile-scroll, [data-preview-viewport]')?.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        rect.bottom > Math.max(0, clip?.top ?? 0) && rect.top < Math.min(innerHeight, clip?.bottom ?? innerHeight) &&
        rect.right > Math.max(0, clip?.left ?? 0) && rect.left < Math.min(innerWidth, clip?.right ?? innerWidth);
    });
    if (!waiting.length) return;
    if (performance.now() - started > 8000) {
      const ids = waiting.map(el => el.getAttribute('data-freeform-id') ?? el.getAttribute('data-pf-id'));
      throw new Error('Timed out waiting for preview materials: ' + ids.join(', '));
    }
  }
}

function Preview({ snapshot }: { snapshot: PreviewSnapshot }) {
  const stage = useRef<HTMLDivElement>(null);
  const mobile = snapshot.platform === 'mobile';
  const runtime = useRuntimeController(snapshot.doc, snapshot.pageId, false);
  useEffect(() => {
    const render = async () => {
      const surface = stage.current;
      if (!surface) throw new Error('Preview stage missing');
      await waitForMaterials(surface);
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
      if (snapshot.waitMs) await new Promise(resolve => setTimeout(resolve, snapshot.waitMs));
      await frame(); await frame();
      const node = snapshot.scope === 'canvas' ? stage.current :
        stage.current?.querySelector(mobile ? '[data-mobile-appearance].pf-mobile-scope' : '[data-preview-viewport]');
      if (!node) throw new Error('Preview viewport missing');
      const { x, y, width, height } = node.getBoundingClientRect();
      const top = Math.round(y);
      const measured = Math.round(height);
      const extent = snapshot.fullPage ? Math.min(measured, window.innerHeight - top) : measured;
      host!.ready({ rect: { x: Math.round(x), y: top, width: Math.round(width), height: extent }, truncated: measured > extent });
    };
    void render().catch(e => host!.ready({ error: String(e) }));
  }, [snapshot, mobile]);
  return <AntdSurface><RuntimeProvider value={runtime}>
    <div ref={stage} style={snapshot.fullPage ? { minHeight: snapshot.height } : undefined}
      className={`pf-canvas-viewport-shell box-border flex w-full bg-slate-100 p-[12px] ${snapshot.fullPage ? '' : 'h-dvh overflow-hidden'}`}>
      {mobile ? <div className="m-auto"><MobileViewportShell device={snapshot.device} expandHeight={snapshot.fullPage} appearance={snapshot.doc.root.props.appearance}
        accent={snapshot.doc.root.props.accent} surfaceBg={snapshot.doc.root.props.surfaceBg}>
        <NodeView node={snapshot.doc.root} />
      </MobileViewportShell></div> :
        <div data-preview-viewport className={`pf-paper flex min-w-0 flex-1 flex-col rounded-xl bg-white ${snapshot.fullPage ? '' : 'overflow-auto'}`}><NodeView node={snapshot.doc.root} /></div>}
    </div>
  </RuntimeProvider></AntdSurface>;
}

if (host) void host.snapshot().then(snapshot => {
  const { tableRows, ...state } = snapshot.state;
  document.documentElement.dataset.theme = snapshot.theme;
  setLocale(snapshot.locale);
  useProtoStore.setState({ ...state, currentProjectMeta: snapshot.meta, activePageId: snapshot.pageId, isWebPlayerMode: true });
  usePageStore.setState({ tableRows, pageSources: {}, designerPages: [], designerFolders: [], history: {} });
  createRoot(document.getElementById('root')!, { onRecoverableError: e => host.ready({ error: String(e) }) }).render(<CaptureMode.Provider value><Preview snapshot={snapshot} /></CaptureMode.Provider>);
}).catch(e => host.ready({ error: String(e) }));
window.addEventListener('error', event => host?.ready({ error: event.message }));
