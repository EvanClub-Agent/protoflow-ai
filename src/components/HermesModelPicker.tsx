import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, LayoutGrid, LoaderCircle, RefreshCw, Search, SearchX, X } from 'lucide-react';
import type { HermesModel } from '../services/hermesClient';
import { filterModelGroups, groupHermesModels, presentHermesModel } from '../services/hermesModelCatalog';
import { ModelProviderIcon } from './ModelProviderIcon';

interface Props {
  models: HermesModel[];
  currentModelId: string;
  running: boolean;
  onSelect: (modelId: string) => Promise<void>;
  onRefresh: () => Promise<unknown>;
  onClose: () => void;
}

export function HermesModelPicker({ models, currentModelId, running, onSelect, onRefresh, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const alive = useRef(false);
  const id = useId();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(currentModelId);
  const [busy, setBusy] = useState<'switch' | 'refresh' | null>(null);
  const [error, setError] = useState('');
  const groups = useMemo(() => groupHermesModels(models), [models]);
  // Refresh may remove a provider. Keep browsing useful without selecting
  // another model automatically or submitting an ID absent from the catalogue.
  const activeCategory = category !== null && groups.some(group => group.id === category) ? category : null;
  const visible = useMemo(() => filterModelGroups(groups, activeCategory, search), [groups, activeCategory, search]);
  const resultCount = visible.reduce((n, group) => n + group.choices.length, 0);
  const selected = models.find(model => model.modelId === selectedId);
  const choice = selected ? presentHermesModel(selected) : null;
  const switching = busy === 'switch';
  const unavailable = selectedId !== '' && !selected;

  useEffect(() => { if (results.current) results.current.scrollTop = 0; }, [activeCategory, search]);

  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    if (!element) return () => { alive.current = false; };
    const previous = document.activeElement;
    if (!element.open) element.showModal();
    searchInput.current?.focus();
    return () => {
      alive.current = false;
      if (element.open) element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const run = async (action: 'switch' | 'refresh') => {
    if (busy || running) return;
    setBusy(action); setError('');
    try {
      if (action === 'switch') {
        if (!selected || selectedId === currentModelId) return;
        await onSelect(selected.modelId);
        if (alive.current) onClose();
      } else await onRefresh();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally { if (alive.current) setBusy(null); }
  };

  return <dialog ref={dialog} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); if (!switching) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !switching) onClose(); }}
    onKeyDown={event => event.stopPropagation()}
    className="m-auto w-[min(760px,calc(100vw-32px))] h-[min(560px,calc(100dvh-48px))] max-w-none max-h-none p-0 rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl backdrop:bg-slate-950/35 backdrop:backdrop-blur-[3px]">
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between gap-4 px-4 pt-3.5 pb-2.5 shrink-0">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 id={`${id}-title`} className="text-sm font-semibold tracking-tight shrink-0">选择对话模型</h2>
          <p id={`${id}-description`} className="text-[11px] text-slate-400 truncate">按实际服务来源浏览，为当前对话选择模型。</p>
        </div>
        <button type="button" aria-label="关闭模型选择" disabled={switching} onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-blue-600"><X size={16} /></button>
      </header>
      <div className="flex items-center gap-2 px-4 pb-3 shrink-0">
        <label className="relative flex-1 min-w-0">
          <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input ref={searchInput} aria-label="搜索模型、厂商或平台" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索模型、厂商或平台…" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-8 text-xs outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10" />
          {search && <button type="button" aria-label="清空模型搜索" onClick={() => { setSearch(''); searchInput.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"><X size={13} /></button>}
        </label>
        <button type="button" disabled={Boolean(busy) || running} onClick={() => void run('refresh')} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40">
          <RefreshCw size={13} className={busy === 'refresh' ? 'animate-spin' : ''} />{busy === 'refresh' ? '刷新中' : '刷新列表'}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row border-t border-slate-200">
        <nav aria-label="模型服务来源" className="shrink-0 w-full sm:w-44 border-b sm:border-b-0 sm:border-r border-slate-200 bg-slate-50/60 overflow-x-auto sm:overflow-y-auto">
          <div className="flex sm:flex-col gap-0.5 p-2">
            <p className="hidden sm:block text-[10px] font-medium tracking-wider text-slate-400 px-2 py-1">服务来源</p>
            <button type="button" aria-pressed={activeCategory === null} onClick={() => setCategory(null)} className={`flex items-center gap-2 text-xs text-left rounded-lg px-2 py-1.5 shrink-0 ${activeCategory === null ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span className="grid place-items-center w-5 h-5"><LayoutGrid size={14} /></span><span className="whitespace-nowrap flex-1">全部模型</span><span className="text-[10px] tabular-nums opacity-65">{models.length}</span>
            </button>
            {groups.map(group => <button key={group.id} type="button" aria-pressed={activeCategory === group.id} onClick={() => setCategory(group.id)} className={`flex items-center gap-2 text-xs text-left rounded-lg px-2 py-1.5 shrink-0 ${activeCategory === group.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
              <ModelProviderIcon brand={group.brand} size={20} /><span className="whitespace-nowrap flex-1">{group.name}</span><span className="text-[10px] tabular-nums opacity-65">{group.choices.length}</span>
            </button>)}
          </div>
        </nav>
        <div ref={results} className="min-w-0 min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-busy={busy === 'refresh'}>
          <div className="flex justify-between items-center gap-2 text-xs mb-3"><span className="font-medium text-slate-700">{activeCategory === null ? '全部模型' : groups.find(g => g.id === activeCategory)?.name}</span><span className="text-slate-400 tabular-nums">{search ? '找到 ' : ''}{resultCount} 个模型</span></div>
          <p className="mb-3 text-[11px] leading-5 text-slate-500">服务来源决定使用的账号与接口，同名模型也可能来自不同平台。</p>
          {resultCount === 0 ? <div className="flex min-h-40 h-full flex-col items-center justify-center text-center gap-2.5 pb-8">
            <SearchX size={24} className="text-slate-300" /><p className="text-xs font-medium">{models.length === 0 ? '暂时没有可选模型' : '没有找到匹配的模型'}</p>
            <p className="text-[11px] text-slate-500">{models.length === 0 ? '连接 AI 账号后，点击“刷新列表”重新获取。' : '试试其他关键词，或查看全部厂商。'}</p>
            {models.length > 0 && <button type="button" className="text-xs text-blue-600 rounded px-2.5 py-1.5 hover:bg-blue-50" onClick={() => { setCategory(null); setSearch(''); }}>清除筛选</button>}
          </div> : <div role="radiogroup" aria-label="可选对话模型" className="space-y-4">
            {visible.map(group => <section key={group.id} aria-label={`${group.name}模型`}>
              {activeCategory === null && <h3 className="text-[11px] font-semibold text-slate-600 mb-2 flex items-center gap-1.5"><ModelProviderIcon brand={group.brand} size={18} />{group.name}<span className="font-normal text-slate-400">{group.choices.length}</span></h3>}
              <div className="grid grid-cols-1 min-[680px]:grid-cols-2 gap-2">
                {group.choices.map(row => {
                  const selected = selectedId === row.model.modelId, current = currentModelId === row.model.modelId;
                  return <label key={row.model.modelId} className={`relative flex items-start gap-2.5 rounded-xl border p-2.5 transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-blue-500/30 ${selected ? 'border-blue-500 bg-blue-50/60' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'} ${busy || running ? 'opacity-60 cursor-not-allowed' : ''}`}>
                    <input type="radio" name={`${id}-model`} value={row.model.modelId} aria-label={`${row.title}，来源 ${row.source}`} checked={selected} disabled={Boolean(busy) || running} onChange={() => { setSelectedId(row.model.modelId); setError(''); }} className="absolute opacity-0 w-4 h-4" />
                    <ModelProviderIcon brand={row.brand} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold leading-4 break-words [overflow-wrap:anywhere]">{row.title}</span>
                      <span className="block mt-0.5 text-[10px] leading-4 text-slate-500 break-words">服务来源 · {row.source}</span>
                      {current && <span className="mt-1 inline-flex gap-1 items-center text-[10px] text-emerald-700"><Check size={10} />正在使用</span>}
                    </span>
                    <span aria-hidden="true" className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'}`}>{selected && <Check size={10} strokeWidth={3} />}</span>
                  </label>;
                })}
              </div>
            </section>)}
          </div>}
        </div>
      </div>
      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
        {error && <p role="alert" className="mb-2 rounded-lg bg-rose-50 text-rose-700 p-2 text-xs">操作未完成：{error}</p>}
        {unavailable && <p role="status" className="mb-2 text-xs text-amber-700">所选模型不在当前列表中，请刷新列表或重新选择。</p>}
        {running && <p role="status" className="mb-2 text-xs text-amber-700">当前对话正在生成，停止或完成后即可切换模型。</p>}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            {choice && <ModelProviderIcon brand={choice.brand} size={22} />}
            <div className="min-w-0"><p className="text-xs font-medium truncate" title={choice?.title}>{choice ? choice.title : '请选择一个模型'}</p><p className="text-[10px] text-slate-500 truncate">{choice ? `${choice.source} · 仅用于当前对话` : '不会改变其他对话的模型'}</p></div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" disabled={switching} onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">取消</button>
            <button type="button" disabled={Boolean(busy) || running || !selected || selectedId === currentModelId} onClick={() => void run('switch')} className="inline-flex gap-1.5 items-center text-xs font-medium px-3.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {switching ? <LoaderCircle size={13} className="animate-spin" /> : <ArrowRight size={13} />}{switching ? '正在切换…' : '切换模型'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  </dialog>;
}
