import React, { useMemo } from 'react';
import { Folder, MessageSquare } from 'lucide-react';
import { folderOptions } from '../proto/sitemap';
import { usePageStore } from '../proto/store/usePageStore';
import { plannedFolders, type ProjectPlan } from '../services/projectPlan';

interface Props {
  plan: ProjectPlan;
  completed: string[];
  revisionDescription: string;
  disabled: boolean;
  hasDraft: boolean;
  onConfirm: () => void;
  onAdjust: () => void;
}

export function ProjectPlanConfirmation({ plan, completed, revisionDescription, disabled, hasDraft, onConfirm, onAdjust }: Props) {
  const designerFolders = usePageStore(s => s.designerFolders);
  const designerPages = usePageStore(s => s.designerPages);
  const sitemapBase = usePageStore(s => s.sitemapBase);
  const sitemapOverrides = usePageStore(s => s.sitemapOverrides);
  const catalogue = useMemo(() => {
    try {
      const folders = plannedFolders({ designerFolders, designerPages, sitemapBase, sitemapOverrides }, plan);
      return { folders: folderOptions(folders, sitemapOverrides, sitemapBase) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : '当前目录与方案不一致' };
    }
  }, [plan, designerFolders, designerPages, sitemapBase, sitemapOverrides]);
  const targetId = plan.revision?.pageId;
  const pages = targetId === undefined ? plan.pages : plan.pages.filter(page => page.pageId === targetId);
  const pending = pages.filter(page => !completed.includes(page.pageId)).length;
  const groups = catalogue.folders?.map(folder => ({
    folder, pages: pages.filter(page => page.folderId === folder.id),
  })).filter(group => group.pages.length || (!plan.revision && plan.folders.some(folder => folder.id === group.folder.id)));

  return <section aria-label="项目方案确认" className="rounded-xl border border-blue-200 bg-white text-xs text-slate-700 shadow-sm">
    <div className="px-4 pt-3 pb-2">
      <h2 className="text-sm font-semibold text-slate-900">{plan.revision ? '确认页面调整' : '确认目录和页面'}</h2>
      <p className="mt-1 leading-relaxed">{plan.revision ? revisionDescription : pending === pages.length
        ? `确认后，AI 会按下面的目录安排菜单，逐页生成 ${pending} 个页面原型。`
        : `共 ${pages.length} 个页面，已有 ${pages.length - pending} 个完成。${pending ? `确认后继续生成其余 ${pending} 个。` : '确认后采用这份方案。'}`}</p>
    </div>
    <div className="max-h-[24vh] overflow-auto border-y border-slate-100 px-4 py-1">
      {catalogue.error && <p role="alert" className="py-2 text-rose-700">{catalogue.error}。请告诉 AI 如何调整方案。</p>}
      {!plan.revision && <details className="border-b border-slate-100 py-1.5">
        <summary className="cursor-pointer font-medium text-slate-700">查看需求摘要</summary>
        <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{plan.summary}</p>
      </details>}
      {groups?.map(({ folder, pages: items }) => items.length === 0 ? (
        <div key={folder.id} className="border-b border-slate-100 py-1.5 pl-3">
          <Folder size={13} aria-hidden className="mx-1 inline"/>{folder.path}
          <span className="ml-2 text-slate-500">{catalogue.folders?.some(child => child.parentFolderId === folder.id) ? '包含子目录' : '空目录'}</span>
        </div>
      ) : <details key={folder.id} className="border-b border-slate-100 py-1.5 last:border-0">
        <summary className="cursor-pointer leading-5">
          <Folder size={13} aria-hidden className="mx-1 inline text-slate-500"/>
          <strong className="font-medium text-slate-900">{folder.path}</strong>
          <span className="ml-2 text-slate-600">{items.map(p => p.title).join('、')}</span>
        </summary>
        <ul className="space-y-2 py-2 pl-5">{items.map(page => <li key={page.pageId}>
          <div className="font-medium text-slate-900">{page.title}</div>
          <p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">{page.requirements}</p>
        </li>)}</ul>
      </details>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
      <span className="text-slate-500">{hasDraft ? '先发送输入框里的修改意见，或清空后确认。' : '展开目录，可查看每个页面要做什么。'}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onAdjust} disabled={disabled} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-blue-700 hover:bg-blue-50"><MessageSquare size={13}/>提出修改</button>
        <button type="button" disabled={disabled || hasDraft || !!catalogue.error} onClick={onConfirm} className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white disabled:opacity-40">确认方案并生成</button>
      </div>
    </div>
  </section>;
}
