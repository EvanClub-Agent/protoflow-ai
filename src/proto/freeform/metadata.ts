import type { ComponentMeta } from '../registry/meta';
import { FREEFORM_DEFAULT_CSS, FREEFORM_DEFAULT_SOURCE } from './contract';

export const FREEFORM_MATERIAL: ComponentMeta = {
  name: 'Freeform', title: '自由组件', icon: 'WandSparkles', category: 'data',
  description: '描述你的想法，让 AI 实现独特的布局与交互。适合座位图、拖拽排程、创意流程和特色展示；普通表格、表单和查询优先使用标准物料。',
  props: [
    { name: 'title', label: '组件名称', kind: 'string', default: '自由组件' },
    { name: 'source', label: '内容', kind: 'text', required: true, description: '完整 TSX 字符串：export default function Component({ data, emit })。React 已提供，可用 React.useState/useEffect/useRef、原生 HTML/SVG；不 import、不访问宿主。' },
    { name: 'css', label: '样式', kind: 'text', description: '独立 CSS 字符串，样式仅作用于本组件。' },
    { name: 'height', label: '最小高度', kind: 'number', default: 260 },
    { name: 'data', label: '展示内容', kind: 'json', description: '输入 JSON 对象，按原值传给 data；不做字符串插值。未设置时为 {}。' },
    { name: 'table', label: '关联数据表', kind: 'table', description: '真实表 ID。使用时必须同时声明 columns，选定字段的数据作为 data.rows；不可自行猜测主键。' },
    { name: 'columns', label: '展示字段', kind: 'list', description: '显式列出的真实字段名数组；仅这些字段传入 data.rows。' },
    { name: 'eventFields', label: '交互结果', kind: 'list', itemFields: [
      { name: 'name', label: '结果名称', kind: 'string' },
      { name: 'type', label: '值类型', kind: 'select', options: ['string', 'number', 'boolean'] },
    ], description: 'emit({字段名:值}) 必须与本声明完全一致；无声明时仅允许 emit({})。onAction 参数中用 {{event.字段名}} 读取，完整占位符保留实际类型，缺失字段报错。' },
  ],
  events: [{ name: 'onAction', label: '完成交互时' }],
  snippet: `<Freeform title="自由组件" height={260} source={${JSON.stringify(FREEFORM_DEFAULT_SOURCE)}} css={${JSON.stringify(FREEFORM_DEFAULT_CSS)}} />`,
};

export const FREEFORM_AI_RULES = `自由组件（Freeform）使用规则：
- 先判断标准物料的属性、组合和业务复合块能否实现需求。仅特殊布局、图形或交互确实超出能力时使用 Freeform，按需替换最小区域；不能用它绕过标准物料的报错或丢弃业务绑定。
- 面向不懂代码的产品设计人员，称呼它为“自由组件”，解释呈现效果和可操作行为；不要要求用户填写 TSX、CSS 或 JSON。
- 先读取 Freeform 契约。source 是原样保存的完整 TSX 字符串，css 是独立样式字符串。原生标签、自定义逻辑、Hooks 只允许在 source 内部，外层页面 DSL 仍受原有约束。
- 单个 export default function Component({ data, emit })，使用 React.useState/useEffect/useRef 等。React 已提供；只使用原生 HTML/SVG/React.Fragment；不引入第三方依赖、远程资源、宿主 Store、Electron API 或动态执行字符串。辅助函数写在 Component 内部，定时器/监听器在 effect 清理。
- 新组件应适配画布亮暗主题：在 :root 设置 background:var(--pf-bg-layout) 和 color-scheme:var(--pf-color-scheme)，内容及控件成对使用 var(--pf-text) 和 var(--pf-bg-container) 等颜色变量。
- 布局适应容器宽度，使用 CSS/SVG 完成图形和动画。组件内部交互独立；页面级弹层、跳转等通过 emit 与 onAction 联动。
- data 是明确的输入对象；绑定表必须使用真实 table ID 和 columns 字段名数组，通过 data.rows 读取。不要在 source 里另造一套业务数据，也不要用 id/code/name 相互兜底。
- emit 的对象严格匹配 eventFields 声明（name、type），仅 string/number/boolean。onAction 仍为标准动作链；参数中 {{event.字段名}} 可传递原类型的交互结果；目标弹层/组件/页面 ID 仍写真实静态 ID。
- 完整示例：source = "export default function Component({ data, emit }) { const [selected, setSelected] = React.useState(null); return <div className='seats'>{data.seats.map(seat => <button key={seat.seatId} aria-pressed={selected === seat.seatId} onClick={() => { setSelected(seat.seatId); emit({ seatId: seat.seatId }); }}>{seat.label}</button>)}</div>; }"；data = {seats:[{seatId:'A1',label:'A1'},{seatId:'A2',label:'A2'}]}（明确的演示座位数据）；eventFields = [{name:'seatId',type:'string'}]；onAction={() => openModal('seat-detail', {seatId:'{{event.seatId}}'})}，并声明对应 Modal。
- 通过现有增量页面工具提交，保留 pfId；语法/契约错误按提示修复。未实际验证的交互不要声称已验证。`;
