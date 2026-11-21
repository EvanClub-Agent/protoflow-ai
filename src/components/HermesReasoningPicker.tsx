import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, LoaderCircle, RotateCcw, Zap } from 'lucide-react';
import type { HermesReasoning } from '../services/hermesClient';
import { useI18n } from '../i18n';

const EFFORT_LABELS: Record<string, [string, string]> = {
  none: ['关闭', 'Off'],
  minimal: ['极低', 'Minimal'],
  low: ['低', 'Low'],
  medium: ['中', 'Medium'],
  high: ['高', 'High'],
  xhigh: ['极高', 'Very High'],
  max: ['最高', 'Max'],
  ultra: ['超强', 'Ultra'],
};

interface Props {
  modelTitle: string;
  disabled: boolean;
  onChooseModel: () => void;
  request: (effort?: string | null) => Promise<HermesReasoning>;
}

// The parent keys this control by conversation, native session and model.
export function HermesReasoningPicker({ modelTitle, disabled, request, onChooseModel }: Props) {
  const { isEn, tr, td } = useI18n();
  const label = (value: string) =>
    value === ''
      ? tr('沿用默认', 'Default')
      : EFFORT_LABELS[value]
      ? tr(EFFORT_LABELS[value][0], EFFORT_LABELS[value][1])
      : value;
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
        setError(e instanceof Error ? td(e.message) : tr('无法读取推理强度', 'Unable to read reasoning effort'));
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
  const visibleTriggerLabel = state && levels.length ? label(state.current) : tr('推理强度', 'Reasoning');
  const triggerAriaLabel = isEn
    ? state && levels.length
      ? `Reasoning effort: ${label(state.current)}`
      : 'Select Reasoning Effort'
    : '选择推理强度';
  return <>
    <button type="button" ref={trigger} aria-label={triggerAriaLabel} title={tr('选择当前对话的推理强度', 'Select reasoning effort for this chat')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} disabled={disabled}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 text-[11px] text-slate-600 hover:bg-slate-200 focus-visible:outline-blue-600 disabled:opacity-50 whitespace-nowrap"
      onClick={() => { setOpen(!open); if (!open) void load(); }}>
      <Zap size={11} aria-hidden="true" />
      {visibleTriggerLabel}<ChevronDown size={10} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panel} id={panelId} role="dialog" aria-label={tr('当前对话的推理强度', 'Reasoning Effort')} tabIndex={-1}
      onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) setOpen(false); }}
      style={position} className="fixed z-[1000] w-60 max-w-[calc(100vw-16px)] rounded-2xl border border-slate-200 bg-white p-3 text-slate-700 shadow-lg outline-none">
      <div className="flex items-start justify-between gap-2">
        <Zap size={14} className="mt-1 text-slate-400 shrink-0" aria-hidden="true" />
        <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-0.5 text-center">
          <div aria-live="polite" className="text-sm font-semibold text-blue-600">
            {error ? tr('推理强度', 'Reasoning') : !state ? tr('正在读取…', 'Loading…') : !levels.length ? tr('不可调节', 'Fixed') : value}
          </div>
          <button type="button" aria-label={tr(`切换对话模型：${modelTitle}`, `Switch chat model: ${modelTitle}`)} title={modelTitle} disabled={disabled || busy}
            onClick={() => { setOpen(false); onChooseModel(); }}
            className="inline-flex max-w-full items-center gap-0.5 text-[11px] text-slate-500 hover:text-blue-600">
            <span className="truncate">{modelTitle}</span><ChevronRight size={10} className="shrink-0" />
          </button>
        </div>
        <button type="button" aria-label={tr('恢复 Hermes 默认推理强度', 'Reset to default reasoning effort')} title={tr('恢复 Hermes 默认推理强度', 'Reset to default reasoning effort')}
          disabled={disabled || busy || !levels.length} onClick={() => void load(null)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40 shrink-0">
          {busy ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />}
        </button>
      </div>
      {error ? <div className="mt-2 text-xs"><span role="alert">{error}</span>
        <button type="button" className="ml-2 text-blue-600 underline" onClick={() => void load()}>{tr('重试', 'Retry')}</button></div>
      : state && (levels.length ? <>
        <div className="relative mt-3 h-6 rounded-full bg-slate-200">
          <div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-full bg-blue-500"
            style={{width: index < 0 ? 0 : levels.length === 1 ? '100%' : `calc(12px + (100% - 24px) * ${index / (levels.length - 1)})`}} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 inset-y-0 flex items-center justify-between">
            {levels.map((effort, i) => <span key={effort} className={`h-1 w-1 rounded-full ${i <= index ? 'bg-white/60' : 'bg-slate-400'}`} />)}
          </div>
          <input type="range" min={0} max={levels.length - 1} step={1} value={Math.max(0, index)}
            aria-label={tr('推理强度', 'Reasoning effort')} aria-valuetext={value} disabled={disabled} aria-disabled={disabled || busy}
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
        {state.generalLevels && <p className="mt-1 text-[11px] text-slate-500">{tr('这是 Hermes 的通用档位，模型服务可能合并部分档位。', 'Standard Hermes levels — some providers may merge adjacent tiers.')}</p>}
        {state.wire && state.wire !== state.current && <p className="mt-1 text-[11px] text-slate-600">{tr(`当前线路使用：${label(state.wire)}`, `Active wire level: ${label(state.wire)}`)}</p>}
      </> : <p className="mt-3 text-center text-xs text-slate-500">{tr('当前模型未提供可调的推理档位', 'Reasoning effort is not adjustable for this model')}</p>)}
    </div>, document.body)}
  </>;
}
