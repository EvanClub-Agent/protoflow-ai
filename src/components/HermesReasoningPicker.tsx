import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, LoaderCircle, RotateCcw, Zap } from 'lucide-react';
import type { HermesReasoning } from '../services/hermesClient';

const labels: Record<string, string> = {
  none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: '超强',
};
const label = (value: string) => value === '' ? '沿用默认' : labels[value] ?? value;

interface Props {
  modelTitle: string;
  disabled: boolean;
  onChooseModel: () => void;
  request: (effort?: string | null) => Promise<HermesReasoning>;
}

// The parent keys this control by conversation, native session and model.
export function HermesReasoningPicker({ modelTitle, disabled, request, onChooseModel }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<HermesReasoning | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<number | null>(null);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const pending = useRef(false), dragging = useRef(false), mounted = useRef(true);
  const panelId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  async function load(effort?: string | null) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await request(effort);
      if (mounted.current) setState(result);
    } catch (e) {
      if (mounted.current) {
        setState(null);
        setError(e instanceof Error ? e.message : '无法读取推理强度');
      }
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); setDraft(null); }
    }
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 248)),
        bottom: Math.max(8, window.innerHeight - rect.top + 6) });
    }
    place();
    panel.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      dragging.current = false; setDraft(null);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const levels = state?.levels ?? [];
  const selected = state ? levels.indexOf(state.current) : -1;
  const index = draft ?? selected;
  const value = draft !== null ? label(levels[draft]) : state ? label(state.current) : '';
  const save = (i: number) => {
    if (levels[i] !== undefined && levels[i] !== state?.current) void load(levels[i]);
    else setDraft(null);
  };
  return <>
    <button type="button" ref={trigger} aria-label="选择推理强度" title="选择当前对话的推理强度"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} disabled={disabled}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 text-[11px] text-slate-600 hover:bg-slate-200 focus-visible:outline-blue-600 disabled:opacity-50"
      onClick={() => { setOpen(!open); if (!open) void load(); }}>
      <Zap size={11} aria-hidden="true" />
      {state && levels.length ? label(state.current) : '推理强度'}<ChevronDown size={10} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panel} id={panelId} role="dialog" aria-label="当前对话的推理强度" tabIndex={-1}
      onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) setOpen(false); }}
      style={position} className="fixed z-[1000] w-60 max-w-[calc(100vw-16px)] rounded-2xl border border-slate-200 bg-white p-3 text-slate-700 shadow-lg outline-none">
      <div className="flex items-start justify-between gap-2">
        <Zap size={14} className="mt-1 text-slate-400" aria-hidden="true" />
        <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-0.5 text-center">
          <div aria-live="polite" className="text-sm font-semibold text-blue-600">
            {error ? '推理强度' : !state ? '正在读取…' : !levels.length ? '不可调节' : value}
          </div>
          <button type="button" aria-label={`切换对话模型：${modelTitle}`} title={modelTitle} disabled={disabled || busy}
            onClick={() => { setOpen(false); onChooseModel(); }}
            className="inline-flex max-w-full items-center gap-0.5 text-[11px] text-slate-500 hover:text-blue-600">
            <span className="truncate">{modelTitle}</span><ChevronRight size={10} className="shrink-0" />
          </button>
        </div>
        <button type="button" aria-label="恢复 Hermes 默认推理强度" title="恢复 Hermes 默认推理强度"
          disabled={disabled || busy || !levels.length} onClick={() => void load(null)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40">
          {busy ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />}
        </button>
      </div>
      {error ? <div className="mt-2 text-xs"><span role="alert">{error}</span>
        <button type="button" className="ml-2 text-blue-600 underline" onClick={() => void load()}>重试</button></div>
      : state && (levels.length ? <>
        <div className="relative mt-3 h-6 rounded-full bg-slate-200">
          <div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-full bg-blue-500"
            style={{width: index < 0 ? 0 : levels.length === 1 ? '100%' : `calc(12px + (100% - 24px) * ${index / (levels.length - 1)})`}} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 inset-y-0 flex items-center justify-between">
            {levels.map((effort, i) => <span key={effort} className={`h-1 w-1 rounded-full ${i <= index ? 'bg-white/60' : 'bg-slate-400'}`} />)}
          </div>
          <input type="range" min={0} max={levels.length - 1} step={1} value={Math.max(0, index)}
            aria-label="推理强度" aria-valuetext={value} disabled={disabled} aria-disabled={disabled || busy}
            data-unset={index < 0} className="hermes-effort-slider"
            onPointerDown={e => { if (pending.current) e.preventDefault(); else dragging.current = true; }}
            onPointerCancel={() => { dragging.current = false; setDraft(null); }}
            onPointerUp={e => { if (dragging.current) save(Number(e.currentTarget.value)); dragging.current = false; }}
            onKeyDown={e => {
              if (pending.current) { e.preventDefault(); return; }
              if (index < 0 && ['Home', 'ArrowLeft', 'ArrowDown'].includes(e.key)) { e.preventDefault(); save(0); }
            }}
            onChange={e => {
              if (pending.current) return;
              const i = Number(e.currentTarget.value);
              if (dragging.current) setDraft(i); else save(i);
            }} />
        </div>
        <div className="mt-1 flex justify-between px-1 text-[10px] text-slate-500">
          <span>{label(levels[0])}</span>{levels.length > 1 && <span>{label(levels[levels.length - 1])}</span>}
        </div>
        {state.generalLevels && <p className="mt-1 text-[11px] text-slate-500">这是 Hermes 的通用档位，模型服务可能合并部分档位。</p>}
        {state.wire && state.wire !== state.current && <p className="mt-1 text-[11px] text-slate-600">当前线路使用：{label(state.wire)}</p>}
      </> : <p className="mt-3 text-center text-xs text-slate-500">当前模型未提供可调的推理档位</p>)}
    </div>, document.body)}
  </>;
}
