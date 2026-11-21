import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHermesStore } from '../store/useHermesStore';
import { useProtoStore } from '../store/useProtoStore';
import { usePageStore } from '../proto/store/usePageStore';
import { folderOptions } from '../proto/sitemap';
import { projectPageCatalog } from '../services/projectAnalysis';
import { conversationKey, type HermesProjectConversation } from '../services/hermesConversation';
import { getHermesApi, type HermesContextResult } from '../services/hermesClient';
import { useI18n } from '../i18n';

export type ProjectContextFocus = { pageId?: string; folderId?: string };

export function ProjectContextPanel({ scope, busy, focus, onFocus }: {
  scope: HermesProjectConversation; busy: boolean; focus: ProjectContextFocus; onFocus: (focus: ProjectContextFocus) => void;
}) {
  const { tr, td } = useI18n();
  const key = conversationKey(scope);
  const usage = useHermesStore(s => s.contexts[key]);
  const contextError = useHermesStore(s => s.contextErrors[key]);
  const connected = useHermesStore(s => s.status === 'running');
  const agreements = useProtoStore(s => s.projectAgreements);
  const designerPages = usePageStore(s => s.designerPages);
  const designerFolders = usePageStore(s => s.designerFolders);
  const sitemapBase = usePageStore(s => s.sitemapBase);
  const sitemapOverrides = usePageStore(s => s.sitemapOverrides);
  const pageSources = usePageStore(s => s.pageSources);
  const pages = useMemo(() => projectPageCatalog({designerPages, designerFolders, sitemapBase, sitemapOverrides, pageSources}),
    [designerPages, designerFolders, sitemapBase, sitemapOverrides, pageSources]);
  const folders = useMemo(() => folderOptions(designerFolders, sitemapOverrides, sitemapBase).filter(f => !f.deprecated),
    [designerFolders, sitemapOverrides, sitemapBase]);
  const [action, setAction] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<HermesContextResult>();
  const alive = useRef(false);
  const pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (kind: 'usage' | 'compress' | 'history', offset = 0) => {
    if (pending.current || busy) return;
    pending.current = true; setAction(kind); setMessage('');
    if (kind === 'history' && offset === 0) setHistory(undefined);
    try {
      const session = await useHermesStore.getState().ensureSession(scope);
      const api = getHermesApi();
      if (!api.context) throw new Error(tr('请保存项目并完整重启 Alex，以加载上下文管理接口', 'Please save the project and restart Alex completely to load the context management API'));
      const result = await api.context({...scope, sessionId: session.sessionId, action: kind, ...(kind === 'history' ? {query: query.trim(), offset} : {})});
      if (!alive.current) return;
      if (result.sessionId !== session.sessionId) throw new Error(tr('会话已变化，请重试', 'Session changed; please try again'));
      if (kind === 'history') setHistory(result);
      if (kind === 'compress') {
        setMessage(result.summary?.aborted ? tr('Hermes 未完成整理，原上下文已保留。', 'Hermes did not finish compacting; original context was preserved.')
          : result.summary?.noop || result.status === 'noop' ? tr('当前上下文无需整理。', 'Current context does not need compaction.')
          : result.summary?.fallback_used ? tr('Hermes 已使用简化摘要；下次任务会重新核对项目资料。', 'Hermes used a simplified summary; project context will be re-verified on the next task.')
          : ['compressed', 'applied'].includes(result.status ?? '') ? tr('上下文已整理，下次任务会重新核对项目资料。', 'Context compacted; project context will be re-verified on the next task.')
          : tr('Hermes 已返回整理结果，请刷新用量核对。', 'Hermes returned compaction result; refresh usage to verify.'));
      }
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { pending.current = false; if (alive.current) setAction(''); }
  };
  const selection = focus.pageId !== undefined ? `page:${focus.pageId}` : focus.folderId !== undefined ? `folder:${focus.folderId}` : '';
  const missing = focus.pageId !== undefined ? !pages.some(p => p.pageId === focus.pageId)
    : focus.folderId !== undefined && !folders.some(f => f.id === focus.folderId);
  const measured = usage?.used !== undefined && usage.size !== undefined;
  const percent = measured ? Math.round(usage.used! / usage.size! * 100) : undefined;
  const agreementKindLabel: Record<'requirement' | 'field_constraint' | 'design', string> = {
    requirement: tr('需求', 'Requirement'),
    field_constraint: tr('字段约束', 'Field Constraint'),
    design: tr('设计规范', 'Design Rule'),
  };
  return <details className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
    <summary className="cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
      <span className="font-medium">{tr('项目资料与上下文', 'Project Context & Memory')}</span>
      <span className="tabular-nums">{tr(`${agreements.length} 条项目约定`, `${agreements.length} agreements`)}</span>
      <span className="tabular-nums">{usage?.compacting ? tr('Hermes 正在压缩上下文…', 'Hermes compacting context…') : measured ? tr(`上下文 ${percent}%${usage.estimated ? '（估算）' : ''}`, `Context ${percent}%${usage.estimated ? ' (est.)' : ''}`) : tr('等待 Hermes 报告用量', 'Awaiting Hermes token usage')}</span>
      {usage?.compressions !== undefined && <span className="tabular-nums">{tr(`已压缩 ${usage.compressions} 次`, `Compacted ${usage.compressions}×`)}</span>}
    </summary>
    <div className="mt-3 space-y-3 max-h-80 overflow-auto">
      <label className="flex items-center gap-2">{tr('本轮资料范围', 'Context Scope')}
        <select aria-label={tr('本轮资料范围', 'Context scope')} disabled={busy || Boolean(action)} value={selection}
          onChange={e => onFocus(e.target.value.startsWith('page:') ? {pageId:e.target.value.slice(5)} : e.target.value.startsWith('folder:') ? {folderId:e.target.value.slice(7)} : {})}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white p-1.5">
          <option value="">{tr('全项目概览', 'Full project overview')}</option>
          {missing && <option value={selection} disabled>{tr('原范围已移除，请重新选择', 'Previous scope was removed; please reselect')}</option>}
          <optgroup label={tr('按模块读取', 'By Module')}>{folders.map(f => <option key={f.id} value={`folder:${f.id}`}>{f.path}</option>)}</optgroup>
          <optgroup label={tr('按页面读取', 'By Page')}>{pages.filter(p => !p.deprecated).map(p => <option key={p.pageId} value={`page:${p.pageId}`}>{p.path}</option>)}</optgroup>
        </select>
      </label>
      <p className="text-slate-500">{tr('生成整套页面时会自动逐页读取资料；全局约定始终保留。已保存页面不等于已通过业务验收。', 'Full-project generation automatically loads context page by page; global agreements are always kept. Saved pages still require business acceptance.')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums">{measured ? `${usage.used!.toLocaleString()} / ${usage.size!.toLocaleString()} tokens` : tr('当前用量尚不可用', 'Token usage unavailable')}</span>
        <button type="button" disabled={!connected || busy || Boolean(action)} onClick={() => void run('usage')} className="rounded border px-2 py-1 disabled:opacity-40 whitespace-nowrap cursor-pointer">{tr('刷新用量', 'Refresh Usage')}</button>
        <button type="button" disabled={!connected || busy || Boolean(action)} onClick={() => void run('compress')} className="rounded border px-2 py-1 disabled:opacity-40 whitespace-nowrap cursor-pointer">{action === 'compress' ? tr('正在整理…', 'Compacting…') : tr('整理上下文', 'Compact Context')}</button>
      </div>
      {(message || contextError) && <p role="status" className="break-words text-amber-700">{td(message || contextError || '')}</p>}
      <details>
        <summary className="cursor-pointer font-medium tabular-nums">{tr(`已保存的项目约定（${agreements.length}）`, `Saved Project Agreements (${agreements.length})`)}</summary>
        {!agreements.length && <p className="mt-2 text-slate-500">{tr('可在项目对话中提出需要长期遵循的需求、字段约束或设计规范，确认修改后随工程保存。', 'State standing requirements, field constraints, or design conventions in Project AI chat — once confirmed, they persist with the project.')}</p>}
        <ul className="space-y-2 mt-2">{agreements.map(a => <li key={a.id} className="rounded border border-slate-200 p-2">
          <p className="font-medium break-words">{a.title} · {agreementKindLabel[a.kind]}</p>
          <p className="whitespace-pre-wrap break-words mt-1">{a.text}</p>
          <p className="text-slate-500 mt-1 break-words">{a.pageIds.length ? a.pageIds.map(id => pages.find(p => p.pageId === id)?.title ?? tr(`已移除页面（${id}）`, `Removed page (${id})`)).join(tr('、', ', ')) : tr('全项目', 'All pages')}</p>
        </li>)}</ul>
      </details>
      <div role="search" className="flex gap-2">
        <input disabled={Boolean(action)} onKeyDown={e => { if (e.key === 'Enter' && query.trim()) { e.preventDefault(); void run('history'); } }} aria-label={tr('检索当前会话历史', 'Search current session history')} value={query} maxLength={200} onChange={e => {setQuery(e.target.value); setHistory(undefined);}}
          placeholder={tr('检索本会话原文（含压缩前记录）', 'Search raw session transcript (including pre-compaction messages)')} className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5"/>
        <button type="button" onClick={() => void run('history')} disabled={!connected || busy || Boolean(action) || !query.trim()} className="rounded border px-2 py-1 disabled:opacity-40 whitespace-nowrap cursor-pointer">{action === 'history' ? tr('检索中…', 'Searching…') : tr('检索', 'Search')}</button>
      </div>
      {history && <div aria-label={tr('历史检索结果', 'Transcript search results')} className="space-y-2">
        <p>{tr(`找到 ${history.total} 条记录。历史原文可能包含已放弃的方案，请以当前工程为准。`, `Found ${history.total} record(s). Transcripts may contain superseded ideas — defer to the current project state.`)}</p>
        {history.matches?.map(hit => <div key={hit.messageId} className="rounded border border-slate-200 p-2"><span className="text-slate-500">{hit.role === 'user' ? tr('用户', 'User') : 'Hermes'} · #{hit.messageId}</span><p className="mt-1 whitespace-pre-wrap break-words">{hit.text}{hit.truncated && '…'}</p></div>)}
        {history.nextOffset != null && <button type="button" disabled={Boolean(action)} onClick={() => void run('history', history.nextOffset!)} className="underline cursor-pointer">{tr('下一页', 'Next page')}</button>}
      </div>}
    </div>
  </details>;
}
