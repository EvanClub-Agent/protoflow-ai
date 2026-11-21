import React, { useRef, useState } from 'react';
import { Sparkles, WandSparkles } from 'lucide-react';
import type { ProtoDoc, ProtoNode, PropValue } from '../types';
import type { DBTableSchema } from '../../store/useProtoStore';
import { replaceNode } from '../dsl/tree';
import { validatePageDoc } from '../ai/assistant';
import { compileFreeform } from './compile';
import { useI18n } from '../../i18n';

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
const ideasZh = [
  '做一个可以点击选择的座位图，区分可选、已选和不可选的座位',
  '做一个横向业务流程，点击步骤时展开说明，并突出当前进度',
  '做一组特色指标卡片，带细腻的悬停效果和进度展示',
];
const ideasEn = [
  'Build an interactive seat map showing available, selected, and reserved seats',
  'Build a horizontal workflow stepper that expands details on click and highlights active progress',
  'Build a set of custom KPI cards with subtle hover effects and progress bars',
];

export function FreeformInspector({ node, doc, tables, onCommit, onPropChange, onGenerate, enabled, onConnect }: Props) {
  const { isEn, tr, td } = useI18n();
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
      if (!config || Array.isArray(config) || typeof config !== 'object' || Object.keys(config).some(k => !['data', 'table', 'columns', 'eventFields'].includes(k))) {
        throw new Error(tr('数据配置仅支持 data、table、columns、eventFields', 'Data config only supports data, table, columns, and eventFields'));
      }
      const nextProps: Record<string, PropValue> = { ...node.props, source, css };
      for (const key of ['data', 'table', 'columns', 'eventFields']) delete nextProps[key];
      Object.assign(nextProps, config);
      const nextDoc = replaceNode(doc, node.pfId, { ...node, props: nextProps });
      const errors = validatePageDoc(nextDoc, tables).filter(issue => issue.pfId === node.pfId && issue.severity === 'error');
      if (errors.length) throw new Error(errors.map(issue => td(issue.message)).join(tr('；', '; ')));
      await compileFreeform(source);
      if (currentDoc.current !== doc) throw new Error(tr('页面已更新，请重新打开高级选项后再应用', 'Page was updated; reopen Advanced and apply again'));
      onCommit?.(nextDoc); setAdvanced(false);
    } catch (e) { setError(e instanceof Error ? td(e.message) : td(String(e))); }
    finally { setSaving(false); }
  };
  const table = tables.find(t => t.id === node.props.table);
  const ideas = isEn ? ideasEn : ideasZh;
  const ideaBadges = isEn ? ['Seat Map', 'Process Flow', 'KPI Cards'] : ['交互座位图', '创意流程', '特色指标'];
  return <div className="space-y-3" aria-label={tr('自由组件设置', 'Freeform widget settings')}>
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 font-semibold text-indigo-950"><WandSparkles className="h-4 w-4" />{tr('让想法自由呈现', 'Bring Custom Ideas to Life')}</div>
      <p className="text-[11px] leading-relaxed text-slate-600">{tr('描述你想要的布局、样式和操作方式，AI 会为你完成。也可以选中现有组件继续调整。', 'Describe the layout, visuals, and interactions you want, and AI will build it for you.')}</p>
      <textarea aria-label={tr('描述自由组件效果', 'Describe freeform widget')} value={idea} onChange={e => setIdea(e.target.value)} rows={4} placeholder={tr('例如：做一个会议室座位图，点击空位可以选中，右侧显示已选座位…', 'e.g. Build a meeting room seat map where clicking an available seat selects it and lists selected seats on the right…')} className="w-full resize-y rounded-lg border border-slate-200 bg-white p-2 text-xs focus:outline-none focus:border-indigo-500" />
      <button type="button" disabled={enabled && !idea.trim()} onClick={() => {
        if (!enabled) { onConnect(); return; }
        if (idea.trim()) onGenerate(`请按自由组件契约完善当前选中的 Freeform（pfId=${node.pfId}），保留其标识和已配置的业务绑定。需求：${idea.trim()}。通过工具提交完整可运行的组件内容，面向产品设计人员说明效果。`);
      }} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-white font-medium cursor-pointer hover:bg-indigo-700 disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />{enabled ? tr('让 AI 实现', 'Build with AI') : tr('连接 AI，开始创作', 'Connect AI to Build')}</button>
      <div className="space-y-1"><p className="text-[10px] text-slate-500">{tr('试试这些想法', 'Try an example')}</p>{ideas.map((text, i) => <button key={text} type="button" onClick={() => setIdea(text)} className="mr-1 rounded-md border border-indigo-100 bg-white px-2 py-1 text-[10px] text-indigo-700 hover:bg-indigo-100 cursor-pointer">{ideaBadges[i]}</button>)}</div>
    </div>
    <label className="block space-y-1"><span className="text-[11px] font-medium text-slate-700">{tr('组件名称', 'Widget Title')}</span><input aria-label={tr('自由组件名称', 'Freeform widget title')} value={typeof node.props.title === 'string' ? node.props.title : ''} onChange={e => onPropChange(node.pfId, 'title', e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" /></label>
    <label className="block space-y-1"><span className="text-[11px] font-medium text-slate-700">{tr('最小高度（像素）', 'Min Height (px)')}</span><input aria-label={tr('自由组件最小高度', 'Freeform widget min height')} type="number" min={80} max={4000} value={typeof node.props.height === 'number' ? node.props.height : 260} onChange={e => { const value = e.target.valueAsNumber; if (Number.isInteger(value) && value >= 80 && value <= 4000) onPropChange(node.pfId, 'height', value); }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" /></label>
    {table && <p className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">{tr(`关联数据：${table.cnName}`, `Bound Table: ${table.cnName}`)}</p>}
    <p className="text-[11px] leading-relaxed text-slate-500">{tr('切换到画布上方的“预览”即可体验交互。需要调整效果时，在这里继续描述。', 'Switch to "Preview" in the top toolbar to interact with this widget.')}</p>
    {onCommit && <div className="border-t border-slate-100 pt-2">
      <button type="button" onClick={() => advanced ? setAdvanced(false) : openAdvanced()} aria-expanded={advanced} className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer">{advanced ? tr('收起高级选项', 'Hide Advanced') : tr('高级选项', 'Advanced')}</button>
      {advanced && <div className="mt-2 space-y-2"><p className="text-[10px] text-slate-500">{tr('供需要手动编辑的协作者使用，日常创作交给 AI 即可。', 'For manual code tweaks; use AI above for everyday authoring.')}</p>
        {([[tr('组件代码（TSX）', 'Component Code (TSX)'), source, setSource], [tr('独立样式（CSS）', 'Scoped Styles (CSS)'), css, setCss], [tr('数据与交互配置（JSON）', 'Data & Event Config (JSON)'), settings, setSettings]] as const).map(([label, value, set]) => <label key={label} className="block space-y-1"><span className="text-[10px] text-slate-600">{label}</span><textarea aria-label={label} value={value} onChange={e => set(e.target.value)} rows={7} spellCheck={false} className="w-full rounded-lg border border-slate-200 p-2 font-mono text-[10px]" /></label>)}
        {error && <p role="alert" className="text-xs text-rose-600 break-words">{error}</p>}
        <button type="button" disabled={saving} onClick={() => void apply()} className="w-full rounded-lg bg-slate-900 py-2 text-white cursor-pointer disabled:opacity-40">{saving ? tr('正在检查…', 'Validating…') : tr('检查并应用', 'Validate & Apply')}</button>
      </div>}
    </div>}
  </div>;
}
