import React, { useCallback, useId, useRef, useState } from 'react';
import { create } from 'zustand';
import { Check, ChevronRight, Loader2, MessageCircleQuestion, PenLine } from 'lucide-react';
import { conversationKey, type HermesTaskScope } from '../services/hermesConversation';
import type { HermesQuestion } from '../services/hermesClient';
import { useHermesStore } from '../store/useHermesStore';
import { ChatMarkdown } from './ChatMarkdown';

// The global request owner portals into the visible chat. Hidden/unmounted chats
// release their host so an unanswered question remains reachable in other views.
export const useQuestionHosts = create<{ hosts: Record<string, HTMLElement> }>(() => ({ hosts: {} }));

export function HermesQuestionHost({ scope, visible = true }: { scope: HermesTaskScope; visible?: boolean }) {
  const key = conversationKey(scope);
  const attach = useCallback((element: HTMLDivElement | null) => {
    useQuestionHosts.setState(state => {
      const hosts = { ...state.hosts };
      if (element) hosts[key] = element;
      else delete hosts[key];
      return { hosts };
    });
  }, [key]);
  return visible ? <div ref={attach} className="shrink-0 min-h-0" /> : null;
}

export function HermesQuestionCard({ question, inline = false }: { question: HermesQuestion; inline?: boolean }) {
  const labelId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const multiple = question.answerSchema.type === 'array';
  const choices = multiple ? question.answerSchema.items?.enum : question.answerSchema.enum;
  const hasChoices = choices !== undefined && choices.length > 0;
  const ready = selected.length > 0 || text.trim().length > 0;

  const submit = async (skip = false) => {
    if (submitting.current || (!skip && !ready)) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const pending = useHermesStore.getState().questions.find(item => item.id === question.id);
      if (pending !== question) throw new Error('该问题已结束或已更新，请使用当前问题卡片');
      const answer = skip ? null : hasChoices ? (multiple ? selected : selected.length ? selected[0] : '') : (multiple ? [text] : text);
      await useHermesStore.getState().answerQuestion(question.id, answer, !skip && hasChoices && text.trim() ? text : undefined);
      // Keep the submitted card disabled until the question-resolved event.
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      submitting.current = false; setBusy(false);
    }
  };

  return <form
    role={inline ? 'region' : 'dialog'}
    aria-label="AI 需要你确认"
    aria-busy={busy}
    onSubmit={event => { event.preventDefault(); void submit(); }}
    className="relative m-2 overflow-hidden rounded-2xl border border-blue-200/90 bg-white shadow-[0_8px_28px_-6px_rgba(37,99,235,0.16)] text-xs text-slate-700"
  >
    <div className="flex items-center gap-2 border-b border-blue-100/80 bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-blue-50/90 px-3 py-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white shadow-2xs">
        <MessageCircleQuestion size={13} />
      </span>
      <span className="font-semibold text-slate-900">AI 需要你确认</span>
      <span className="text-[10px] text-blue-600/80 bg-white/80 border border-blue-200/60 rounded px-1.5 py-0.5 font-medium">
        {multiple ? '可多选' : '点选或填写其他'}
      </span>
      {question.progress ? <span
        role="status"
        aria-label={`本组问题：第 ${question.progress.current} 题，共 ${question.progress.total} 题`}
        title="本轮这组问题的进度"
        className="ml-auto shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-2xs"
      >{question.progress.current} / {question.progress.total}</span> : <span className="ml-auto text-[10px] font-medium text-slate-400">等待你的回答</span>}
    </div>
    <div className="max-h-[25vh] overflow-y-auto p-2.5 space-y-2">
      <div id={labelId} className="text-xs font-medium text-slate-800 leading-relaxed break-words"><ChatMarkdown content={question.message} /></div>
      {hasChoices && <fieldset disabled={busy} aria-labelledby={labelId} className="space-y-1.5 min-w-0">
        <legend className="sr-only">{multiple ? '可选择多项' : '请选择一项'}</legend>
        {choices.map(choice => {
          const checked = selected.includes(choice);
          return <label key={choice} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 cursor-pointer transition ${checked ? 'border-blue-500 bg-blue-50/90 text-blue-900 font-medium shadow-2xs' : 'border-slate-200/90 bg-slate-50/40 hover:border-blue-300 hover:bg-blue-50/30'}`}>
            <input type={multiple ? 'checkbox' : 'radio'} name={labelId} value={choice} checked={checked}
              className={`mt-0.5 h-4 w-4 shrink-0 appearance-none border bg-white transition-all cursor-pointer ${
                multiple
                  ? 'rounded-[5px] border-slate-300 checked:border-blue-600 checked:bg-blue-600'
                  : 'rounded-full border-slate-300 checked:border-blue-600 checked:border-[5px]'
              }`}
              onChange={() => setSelected(previous => multiple ? previous.includes(choice) ? previous.filter(value => value !== choice) : [...previous, choice] : [choice])} />
            <span className="min-w-0 whitespace-pre-wrap break-words leading-relaxed">{choice}</span>
          </label>;
        })}
      </fieldset>}
      <div className="space-y-1.5 pt-0.5">
        {hasChoices ? (
          <button
            type="button"
            disabled={busy}
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-blue-600 cursor-pointer disabled:opacity-50 transition"
          >
            <PenLine size={11} className="text-blue-600 shrink-0" />
            <span>其他选项 / 补充说明</span>
            <ChevronRight size={12} className={`transition-transform text-slate-400 ${expanded ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="text-[11px] font-medium text-slate-600">补充说明</span>
        )}
        {(expanded || !hasChoices) && (
          <textarea
            aria-label="补充说明"
            value={text}
            disabled={busy}
            rows={2}
            onChange={event => setText(event.target.value)}
            placeholder={hasChoices ? '输入其他选项，或对已选项补充说明…' : '写下你的要求或需要调整的地方…'}
            className="w-full resize-y min-h-[2.25rem] max-h-28 rounded-xl border border-slate-200/90 bg-slate-50/70 focus:bg-white px-2.5 py-1.5 text-xs leading-relaxed focus:outline-blue-500 disabled:opacity-60 transition"
          />
        )}
      </div>
      {error && <p role="alert" className="text-rose-600 break-words">{error}</p>}
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
      <button type="button" disabled={busy} onClick={() => void submit(true)} className="text-[11px] font-medium text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-40 transition">暂不回答</button>
      <button type="submit" disabled={busy || !ready} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 cursor-pointer disabled:opacity-40 transition shadow-2xs">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        {busy ? '正在继续…' : '提交并继续'}
      </button>
    </div>
  </form>;
}
