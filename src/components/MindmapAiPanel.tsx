import { MERMAID_DIAGRAM_TEMPLATES } from '../services/mermaidCatalog';
import React, { useState } from 'react';
import { Loader2, Plus, Send, Sparkles, Square } from 'lucide-react';
import { useHermesStore } from '../store/useHermesStore';
import { conversationKey, type HermesMindmapConversation } from '../services/hermesConversation';
import { generateMindmapWithHermes, useMindmapAiStore } from '../services/hermesMindmap';
import { HermesQuestionHost } from './HermesQuestionCard';
import { HermesSessionControls } from './HermesSessionControls';
import { useI18n } from '../i18n';

export function MindmapAiPanel({ projectId, mindmapId }: { projectId: string; mindmapId: string }) {
  const { tr, td } = useI18n();
  const scope: HermesMindmapConversation = { projectId, kind: 'mindmap', mindmapId };
  const key = conversationKey(scope);
  const [prompt, setPrompt] = useState('');
  const [diagramType, setDiagramType] = useState('auto');
  const [error, setError] = useState('');
  const run = useMindmapAiStore(state => state.runs[key]);
  const connected = useHermesStore(state => state.status === 'running');
  const projectBusy = useHermesStore(state => Boolean(state.runningProjects[projectId]));
  const progress = useHermesStore(state => state.progress[key]);
  const partial = useHermesStore(state => state.partial[key]);
  const running = run?.status === 'running';
  const submit = async () => {
    if (!connected || projectBusy || !prompt.trim() || running) return;
    setError('');
    try { await generateMindmapWithHermes(projectId, mindmapId, prompt, diagramType); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };

  return (
    <div
      className="w-full max-w-[680px] mx-auto rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md px-3.5 py-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.08)] transition-all"
      aria-label={tr('Hermes 脑图生成', 'Hermes Mindmap Generator')}
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600 border border-rose-200/70 whitespace-nowrap shrink-0">
            <Sparkles size={12} className="text-rose-500 shrink-0" />
            {tr('Hermes AI 图表助手', 'Hermes Diagram AI')}
          </span>
          <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-200/90 bg-slate-50/90 px-2 py-0.5 text-[11px] font-medium text-slate-600 min-w-0">
            <span className="shrink-0">{tr('生成类型', 'Type')}</span>
            <select
              aria-label={tr('AI 图表类型', 'AI diagram type')}
              value={diagramType}
              disabled={running}
              onChange={event => setDiagramType(event.target.value)}
              className="min-w-0 max-w-[180px] bg-transparent font-semibold text-slate-800 outline-none cursor-pointer disabled:opacity-50"
            >
              <option value="auto">{tr('自动选择 / 保留原类型', 'Auto / Keep Current')}</option>
              {MERMAID_DIAGRAM_TEMPLATES.map(item => (
                <option key={item.id} value={item.id}>
                  {td(item.label)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={running}
            onClick={() =>
              setPrompt(
                tr(
                  '优先根据当前脑图关联的页面（含目录下的页面）、页面功能、便签和数据库表生成所选类型的图表；如果没有关联，请读取项目资料选择合适的范围。区分已实现功能与待实现需求。',
                  'Generate the selected diagram type primarily from pages linked to this mindmap (including linked folders), their features, sticky rules, and database tables; if unlinked, inspect project context to pick an appropriate scope, distinguishing built features from pending requirements.'
                )
              )
            }
            className="inline-flex items-center gap-1 rounded-md bg-slate-100/90 hover:bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:text-blue-600 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer transition"
          >
            <Plus size={11} className="shrink-0" />
            {tr('按关联页面生成图表', 'From Linked Pages')}
          </button>
        </div>
        <HermesSessionControls scope={scope} />
      </div>
      <HermesQuestionHost scope={scope} />
      <form
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
        className="flex items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/70 px-2.5 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/15 transition"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-2xs border border-slate-200/80">
          <Plus size={14} />
        </span>
        <textarea
          aria-label={tr('脑图生成要求', 'Mindmap generation prompt')}
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={1}
          disabled={running}
          placeholder={tr('描述要绘制的图表，或根据关联页面、便签与数据表自动生成…', 'Describe the diagram to generate, or synthesize from linked pages, stickies, and tables…')}
          className="min-h-[26px] max-h-20 min-w-0 flex-1 resize-none bg-transparent py-0.5 text-xs leading-5 text-slate-700 outline-none placeholder:text-slate-400 disabled:opacity-60"
        />
        {running ? (
          <button
            type="button"
            onClick={() => {
              void useHermesStore
                .getState()
                .stop(scope)
                .catch(failure => setError(String(failure)));
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700 whitespace-nowrap cursor-pointer transition"
          >
            <Square size={11} />
            {tr('停止生成', 'Stop')}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!connected || projectBusy || !prompt.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer transition shadow-2xs"
          >
            <Send size={11} />
            {tr('生成图表', 'Generate')}
          </button>
        )}
      </form>

      {running && (
        <p role="status" className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-600">
          <Loader2 size={12} className="shrink-0 animate-spin" />
          {progress ? td(progress) : tr('正在校验图表…', 'Validating diagram…')}
        </p>
      )}
      {!running && projectBusy && (
        <p className="mt-1.5 text-[11px] text-slate-500">{tr('当前项目正在执行其他 AI 任务。', 'Another AI task is currently running in this project.')}</p>
      )}
      {running && partial && (
        <details className="mt-1.5 text-[11px] text-slate-500">
          <summary className="cursor-pointer">{tr('查看生成内容', 'View streaming output')}</summary>
          <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 font-mono">
            {partial}
          </pre>
        </details>
      )}
      {!running && run?.status === 'done' && !error && (
        <p role="status" className="mt-1.5 text-[11px] text-emerald-600">
          {td(run.message ?? '')} · {run.modelId}
        </p>
      )}
      {(error || run?.status === 'error') && (
        <p role="alert" className="mt-1.5 text-[11px] leading-5 text-rose-600 break-words">
          {td(error || run?.message || '')}
        </p>
      )}
      {run?.status === 'error' && run.resultSource && (
        <details className="mt-1.5 text-[11px] text-slate-500">
          <summary className="cursor-pointer">{tr('查看本次生成源码', 'View generated source')}</summary>
          <textarea
            readOnly
            aria-label={tr('未应用的生成源码', 'Unapplied generated source')}
            value={run.resultSource}
            className="mt-1.5 h-24 w-full rounded border border-slate-200 bg-slate-50 p-2 font-mono text-xs"
          />
        </details>
      )}
    </div>
  );
}
