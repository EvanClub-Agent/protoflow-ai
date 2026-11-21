import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CaptureMode } from '../../capture/CaptureMode';
import { captureDiagnostic, currentDiagnosticLocation } from '../../services/runtimeDiagnostics';
import type { CompProps } from '../registry/components';
import { useResolvedTheme } from '../registry/AntdSurface';
import { MobileThemeContext } from '../mobile/components';
import { usePageStore } from '../store/usePageStore';
import { PreviewDataContext, useMaterialTables } from '../runtime/PreviewData';
import { newId } from '../../utils/identity';
import { compileFreeform } from './compile';
import { freeformDocument } from './document';
import { freeformInputs, freeformSourceErrors, resolveFreeformEvent, validateFreeformEvent, type FreeformEventField } from './contract';
import { useI18n } from '../../i18n';

export const FreeformMaterial: React.FC<CompProps> = ({ node, p, root, rt, scope }) => {
  const { tr, td } = useI18n();
  const capturing = useContext(CaptureMode);
  const [paintedChannel, setPaintedChannel] = useState<string>();
  const tables = useMaterialTables();
  const preview = useContext(PreviewDataContext);
  const savedRows = usePageStore(s => s.tableRows);
  const workspaceTheme = useResolvedTheme();
  const mobileTheme = useContext(MobileThemeContext);
  const themeMode = mobileTheme ? mobileTheme.appearance : workspaceTheme;
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState<{ html: string; channel: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const inputs = useMemo(() => {
    try {
      const rows = typeof p.table === 'string' ? (preview ? preview.rows[p.table] : savedRows[p.table]) : [];
      if (typeof p.table === 'string' && rows === undefined) throw new Error('关联表尚无演示数据，请先为该表配置演示数据');
      return { value: freeformInputs(p, tables, rows!), error: null };
    } catch (e) { return { value: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [p.data, p.table, p.columns, tables, preview, savedRows]);
  useEffect(()=>{
    if(error||inputs.error) void captureDiagnostic({category:'renderer',code:'FREEFORM_RENDER_FAILED',stage:'freeform',message:'自由组件编译、渲染或交互失败',context:{...currentDiagnosticLocation(),pageId:rt.pageId,pfId:node.pfId}});
  },[error,inputs.error,node.pfId,rt.pageId]);
  const latest = useRef({ inputs, p, rt, scope, themeMode });
  latest.current = { inputs, p, rt, scope, themeMode };

  useEffect(() => {
    let cancelled = false;
    ready.current = false; setFrame(null); setError(null); setHeight(0);
    const errors = freeformSourceErrors(p.source, p.css);
    if (errors.length) { setError(errors.join('；')); return; }
    void compileFreeform(p.source).then(code => {
      if (cancelled) return;
      const channel = newId('freeform-channel');
      const nonce = document.querySelector<HTMLMetaElement>('meta[name="protoflow-frame-nonce"]')?.nonce;
      setFrame({ channel, html: freeformDocument(code, p.css === undefined ? '' : p.css, channel, nonce) });
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [p.source, p.css, attempt]);

  useLayoutEffect(() => {
    if (!frame) return;
    const sendInput = () => {
      if (!latest.current.inputs.error) iframe.current?.contentWindow?.postMessage({ channel: frame.channel, type: 'input', capture: capturing, payload: latest.current.inputs.value, theme: latest.current.themeMode }, '*');
    };
    const receive = (event: MessageEvent) => {
      if (!iframe.current?.contentWindow || event.source !== iframe.current.contentWindow || event.data?.channel !== frame.channel) return;
      const message = event.data;
      if (message.type === 'ready') { ready.current = true; sendInput(); }
      if (capturing && message.type === 'painted') setPaintedChannel(frame.channel);
      if (message.type === 'height' && typeof message.payload === 'number' && Number.isFinite(message.payload)) setHeight(Math.min(4000, Math.max(80, message.payload)));
      if (message.type === 'error' && typeof message.payload === 'string') setError(message.payload.slice(0, 1000));
      if (message.type === 'action' && !latest.current.rt.isDesign) {
        try {
          validateFreeformEvent(message.payload, (latest.current.p.eventFields ?? []) as FreeformEventField[]);
          const chain = resolveFreeformEvent(latest.current.p.onAction, message.payload);
          void latest.current.rt.run(chain, latest.current.scope).catch(e => setError(String(e)));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [frame, capturing]);
  useEffect(() => {
    if (frame && ready.current && !inputs.error) iframe.current?.contentWindow?.postMessage({ channel: frame.channel, type: 'input', capture: capturing, payload: inputs.value, theme: themeMode }, '*');
  }, [frame, inputs, capturing]);
  useEffect(() => {
    if (frame && ready.current) iframe.current?.contentWindow?.postMessage({ channel: frame.channel, type: 'theme', payload: themeMode }, '*');
  }, [frame, themeMode]);

  const rawError = inputs.error ?? error;
  const displayError = rawError ? td(rawError) : null;
  const alertCls = mobileTheme && mobileTheme.isDark
    ? 'rounded-2xl border border-amber-400/25 bg-amber-500/15 p-4 text-xs text-amber-200 space-y-2'
    : 'rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2';
  const loadingCls = mobileTheme
    ? `rounded-[22px] p-8 text-center text-xs ${mobileTheme.cardBg} ${mobileTheme.textMuted}`
    : 'rounded-xl bg-slate-50 p-8 text-center text-xs text-slate-500';
  return <div {...root} className="relative w-full min-w-0" data-freeform-id={node.pfId}
    data-freeform-status={capturing ? (displayError ? 'error' : frame && paintedChannel === frame.channel ? 'ready' : 'loading') : undefined}>
    {displayError ? <div role="alert" className={alertCls}>
      <p className="font-semibold">{tr('这个自由组件需要调整', 'Freeform Widget Needs Adjustment')}</p><p className="break-words">{displayError}</p>
      <button type="button" className="underline cursor-pointer" onClick={() => setAttempt(n => n + 1)}>{tr('重新预览', 'Retry Preview')}</button>
    </div> : frame ? <>
      <iframe ref={iframe} title={typeof p.title === 'string' ? p.title : tr('自由组件', 'Freeform Widget')} sandbox="allow-scripts" srcDoc={frame.html} referrerPolicy="no-referrer" className="block w-full border-0" style={{ height: Math.max(typeof p.height === 'number' ? p.height : 260, height), pointerEvents: rt.isDesign ? 'none' : 'auto' }} />
      {rt.isDesign && <div className="absolute inset-0" title={tr('选中后描述想法；切换到预览模式体验交互', 'Select to describe your idea; switch to Preview mode to interact')} />}
    </> : <div className={loadingCls}>{tr('正在准备自由组件…', 'Preparing freeform widget…')}</div>}
  </div>;
};
