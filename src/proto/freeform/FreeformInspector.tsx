import React, { useRef, useState } from 'react';
import { Sparkles, WandSparkles } from 'lucide-react';
import type { ProtoDoc, ProtoNode, PropValue } from '../types';
import type { DBTableSchema } from '../../store/useProtoStore';
import { replaceNode } from '../dsl/tree';
import { validatePageDoc } from '../ai/assistant';
import { compileFreeform } from './compile';

interface Props {
  node: ProtoNode;
  doc: ProtoDoc;
  tables: DBTableSchema[];
  onCommit?: (doc: ProtoDoc) => void;
  onPropChange: (id: string, key: string, value: PropValue | undefined) => void;
  onGenerate: (prompt: string) => void;
  enabled: boolean;
  onConnect: () => void;
}
const ideas = ['做一个可以点击选择的座位图，区分可选、已选和不可选的座位', '做一个横向业务流程，点击步骤时展开说明，并突出当前进度', '做一组特色指标卡片，带细腻的悬停效果和进度展示'];

export function FreeformInspector({ node, doc, tables, onCommit, onPropChange, onGenerate, enabled, onConnect }: Props) {
  const [idea, setIdea] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [source, setSource] = useState('');
  const [css, setCss] = useState('');
  const [settings, setSettings] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentDoc = useRef(doc);
  currentDoc.current = doc;
  const openAdvanced = () => {
    setSource(typeof node.props.source === 'string' ? node.props.source : '');
    setCss(typeof node.props.css === 'string' ? node.props.css : '');
    setSettings(JSON.stringify(Object.fromEntries(['data', 'table', 'columns', 'eventFields'].filter(key => node.props[key] !== undefined).map(key => [key, node.props[key]])), null, 2));
    setError(null); setAdvanced(true);
  };
  const apply = async () => {
    setSaving(true); setError(null);
    try {
      const config = JSON.parse(settings);
      if (!config || Array.isArray(config) || typeof config !== 'object' || Object.keys(config).some(k => !['data', 'table', 'columns', 'eventFields'].includes(k))) throw new Error('数据配置仅支持 data、table、columns、eventFields');
      const nextProps: Record<string, PropValue> = { ...node.props, source, css };
      for (const key of ['data', 'table', 'columns', 'eventFields']) delete nextProps[key];
      Object.assign(nextProps, config);
      const nextDoc = replaceNode(doc, node.pfId, { ...node, props: nextProps });
      const errors = validatePageDoc(nextDoc, tables).filter(issue => issue.pfId === node.pfId && issue.severity === 'error');
      if (errors.length) throw new Error(errors.map(issue => issue.message).join('；'));
      await compileFreeform(source);
      if (currentDoc.current !== doc) throw new Error('页面已更新，请重新打开高级选项后再应用');
      onCommit?.(nextDoc); setAdvanced(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const table = tables.find(t => t.id === node.props.table);
  return <div className="space-y-3" aria-label="自由组件设置">
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 font-semibold text-indigo-950"><WandSparkles className="h-4 w-4" />让想法自由呈现</div>
      <p className="text-[11px] leading-relaxed text-slate-600">描述你想要的布局、样式和操作方式，AI 会为你完成。也可以选中现有组件继续调整。</p>
      <textarea aria-label="描述自由组件效果" value={idea} onChange={e => setIdea(e.target.value)} rows={4} placeholder="例如：做一个会议室座位图，点击空位可以选中，右侧显示已选座位…" className="w-full resize-y rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-none focus:border-indigo-500" />
      <button type="button" disabled={enabled && !idea.trim()} onClick={() => {
        if (!enabled) { onConnect(); return; }
        if (idea.trim()) onGenerate(`请按自由组件契约完善当前选中的 Freeform（pfId=${node.pfId}），保留其标识和已配置的业务绑定。需求：${idea.trim()}。通过工具提交完整可运行的组件内容，面向产品设计人员说明效果。`);
      }} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-white font-medium cursor-pointer hover:bg-indigo-700 disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />{enabled ? '让 AI 实现' : '连接 AI，开始创作'}</button>
      <div className="space-y-1"><p className="text-[10px] text-slate-500">试试这些想法</p>{ideas.map((text, i) => <button key={text} type="button" onClick={() => setIdea(text)} className="mr-1 rounded-md border border-indigo-100 bg-white px-2 py-1 text-[10px] text-indigo-700 hover:bg-indigo-100 cursor-pointer">{['交互座位图', '创意流程', '特色指标'][i]}</button>)}</div>
    </div>
    <label className="block space-y-1"><span className="text-[11px] font-medium text-slate-700">组件名称</span><input aria-label="自由组件名称" value={typeof node.props.title === 'string' ? node.props.title : ''} onChange={e => onPropChange(node.pfId, 'title', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" /></label>
    <label className="block space-y-1"><span className="text-[11px] font-medium text-slate-700">最小高度（像素）</span><input aria-label="自由组件最小高度" type="number" min={80} max={4000} value={typeof node.props.height === 'number' ? node.props.height : 260} onChange={e => { const value = e.target.valueAsNumber; if (Number.isInteger(value) && value >= 80 && value <= 4000) onPropChange(node.pfId, 'height', value); }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" /></label>
    {table && <p className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">关联数据：{table.cnName}</p>}
    <p className="text-[11px] leading-relaxed text-slate-500">切换到画布上方的“预览”即可体验交互。需要调整效果时，在这里继续描述。</p>
    {onCommit && <div className="border-t border-slate-100 pt-2">
      <button type="button" onClick={() => advanced ? setAdvanced(false) : openAdvanced()} aria-expanded={advanced} className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer">{advanced ? '收起高级选项' : '高级选项'}</button>
      {advanced && <div className="mt-2 space-y-2"><p className="text-[10px] text-slate-500">供需要手动编辑的协作者使用，日常创作交给 AI 即可。</p>
        {([['组件代码（TSX）', source, setSource], ['独立样式（CSS）', css, setCss], ['数据与交互配置（JSON）', settings, setSettings]] as const).map(([label, value, set]) => <label key={label} className="block space-y-1"><span className="text-[10px] text-slate-600">{label}</span><textarea aria-label={label} value={value} onChange={e => set(e.target.value)} rows={7} spellCheck={false} className="w-full rounded-lg border border-slate-200 p-2 font-mono text-[10px]" /></label>)}
        {error && <p role="alert" className="text-xs text-rose-600 break-words">{error}</p>}
        <button type="button" disabled={saving} onClick={() => void apply()} className="w-full rounded-lg bg-slate-900 py-2 text-white cursor-pointer disabled:opacity-40">{saving ? '正在检查…' : '检查并应用'}</button>
      </div>}
    </div>}
  </div>;
}
