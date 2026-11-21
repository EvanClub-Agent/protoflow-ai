import type { ComponentMeta, PropSpec } from '../registry/meta';

const numbers = (fields: Record<string, string>): PropSpec[] =>
  Object.entries(fields).map(([name, label]) => ({ name, label, kind: 'number' }));
const strings = (fields: Record<string, string>): PropSpec[] =>
  Object.entries(fields).map(([name, label]) => ({ name, label, kind: 'string' }));
export const frameSpecs: PropSpec[] = [
  ...numbers({ x: '横坐标', y: '纵坐标', width: '宽度', height: '高度' }),
  ...strings({ label: '元件名称' }), { name: 'hidden', label: '初始隐藏', kind: 'boolean' },
];
export const appearanceSpecs: PropSpec[] = [
  ...numbers({ fontSize: '字号', fontWeight: '字重', radius: '圆角', borderWidth: '边框宽度', opacity: '不透明度' }),
  ...strings({ color: '文字颜色', background: '填充颜色', borderColor: '边框颜色', padding: '内边距', fontFamily: '字体', edgeWidths: '各边宽度', edgeColors: '各边颜色' }),
  { name: 'align', label: '文本对齐', kind: 'select', options: ['left', 'center', 'right'] },
  { name: 'vertical', label: '垂直对齐', kind: 'select', options: ['top', 'middle', 'bottom'] },
];
const text: PropSpec = { name: 'text', label: '文本', kind: 'text' };
const runs: PropSpec = { name: 'runs', label: '分段文字样式', kind: 'json' };
const click = [{ name: 'onClick', label: '点击时' }];
const choices: PropSpec[] = [{ name: 'choices', label: '选项', kind: 'list' }, { name: 'selectedOptions', label: '选中项下标', kind: 'json' }];
const flags = (fields: Record<string, string>): PropSpec[] =>
  Object.entries(fields).map(([name, label]) => ({ name, label, kind: 'boolean' }));
const state = flags({ disabled: '禁用', checked: '初始勾选', readOnly: '只读', multiple: '多选' });

export const AXURE_LEAF_KINDS: Record<string, string> = {
  VectorShape: 'shape', StaticTableCell: 'cell', Hotspot: 'hotspot', EmbeddedPicture: 'image',
  ListSelect: 'select', ListBox: 'list', CheckControl: 'checkbox', RadioControl: 'radio',
};
export const positionedNativeTypes = new Set(['Text', 'Button', 'Input', 'Textarea', 'Select', 'DatePicker', 'NumberInput', 'Radio', 'Checkbox', 'Form', 'QueryForm', 'Table']);
export const isAxureMaterial = (name: string) => name === 'AxureWidget' || name === 'AxureCanvas' ||
  name === 'OutlineTree' || name === 'TreeItem' || name === 'DynamicPanel' || name === 'PanelState' || name === 'PositionedGroup' || name === 'StaticTable' || Object.hasOwn(AXURE_LEAF_KINDS, name);
const parents = ['AxureCanvas', 'PositionedGroup', 'PanelState'];
const titles: Record<string, string> = {
  VectorShape: '矢量图形', StaticTableCell: '静态单元格', Hotspot: '交互热区', EmbeddedPicture: '内嵌图片',
  ListSelect: '下拉选择框', ListBox: '列表选择框', CheckControl: '独立复选框', RadioControl: '独立单选框',
};
export const AXURE_MATERIALS: ComponentMeta[] = [
  { name: 'AxureCanvas', title: '自由定位画布', category: 'layout', icon: 'LayoutTemplate', container: true,
    description: '按原始像素坐标排列可编辑物料。', props: [], snippet: '<AxureCanvas />' },
  { name: 'PositionedGroup', title: '定位分组', category: 'layout', icon: 'Layers', container: true, parents,
    description: '子控件使用组内坐标，可整体移动或隐藏。', props: [...frameSpecs, ...flags({ clip: '裁剪内容', disabled: '禁用交互' })], events: click, snippet: '<PositionedGroup width={120} height={40} />' },
  { name: 'OutlineTree', title: '树形目录', category: 'navigation', icon: 'ListTree', container: true,
    description: '各层级可展开的目录，子节点的标签和跳转可独立编辑。', props: [...frameSpecs, ...flags({ disabled: '禁用交互' })], events: click,
    snippet: '<OutlineTree width={180} height={100}><TreeItem text="目录" /></OutlineTree>' },
  { name: 'TreeItem', title: '树节点', category: 'navigation', icon: 'ListTree', container: true, parents: ['OutlineTree', 'TreeItem'],
    description: '保留源节点的名称、子目录及初始展开状态。', props: [text, ...appearanceSpecs, runs,
      ...numbers({ height: '行高', indent: '缩进' }), ...flags({ expanded: '初始展开', hidden: '初始隐藏', disabled: '禁用' })], events: click, snippet: '<TreeItem text="节点" />' },
  { name: 'DynamicPanel', title: '动态面板', category: 'layout', icon: 'Layers', container: true,
    description: '保留所有状态及其中的控件，可按序号切换显示。', events: click,
    props: [...frameSpecs, ...numbers({ activeState: '显示状态（从 1 开始）', pinMarginX: '固定水平偏移', pinMarginY: '固定垂直偏移' }),
      { name:'pinX', label:'固定水平位置', kind:'select', options:['left','center','right'] },
      { name:'pinY', label:'固定垂直位置', kind:'select', options:['top','middle','bottom'] },
      ...flags({ clip: '裁剪内容', fitContent:'按当前状态调整大小', pinInFront:'固定在最前', disabled: '禁用交互' })],
    snippet: '<DynamicPanel width={120} height={40} activeState={1}><PanelState label="初始状态" /></DynamicPanel>' },
  { name: 'PanelState', title: '面板状态', category: 'layout', icon: 'Layers', container: true, parents: ['DynamicPanel'],
    description: '在该状态下可编辑的定位控件。', props: strings({ label: '状态名称' }), snippet: '<PanelState label="状态" />' },
  { name: 'StaticTable', title: '静态表格', category: 'data', icon: 'Table', container: true,
    description: '按原始行列尺寸排布，每个单元格均可单独选择和编辑。', events: click,
    props: [...frameSpecs, ...flags({ disabled: '禁用交互' }), ...['columnWidths', 'rowHeights'].map((name): PropSpec => ({ name, label: name === 'rowHeights' ? '行高' : '列宽', kind: 'json' })),
      { name: 'cellStyle', label: '共用单元格样式', kind: 'json' }],
    snippet: '<StaticTable width={100} height={32} columnWidths={[100]} rowHeights={[32]}><StaticTableCell text="单元格" /></StaticTable>' },
  ...Object.entries(AXURE_LEAF_KINDS).map(([name, kind]): ComponentMeta => ({
    name, title: titles[name], category: 'data', icon: kind === 'cell' ? 'Table' : 'Square',
    parents: kind === 'cell' ? ['StaticTable'] : parents, description: titles[name] + '，可在属性面板编辑。', events: click,
    props: [text, ...(kind === 'cell' ? [] : frameSpecs), ...appearanceSpecs, runs,
      ...(kind === 'shape' ? strings({ path: '矢量路径' }) : []), ...(kind === 'image' ? strings({ image: '图片内容' }) : []),
      ...(['select', 'list'].includes(kind) ? choices : []), ...(kind === 'radio' ? strings({ radioGroup: '单选组' }) : []),
      ...state.filter(p => p.name === 'disabled' || (['checkbox','radio'].includes(kind) && p.name === 'checked') || (['select','list'].includes(kind) && p.name === 'multiple'))],
    snippet: '<' + name + (kind === 'cell' ? ' text="单元格"' : ' width={96} height={30}') + ' />',
  })),
  // Kept for projects saved by the original flat importer and unresolved source controls.
  { name: 'AxureWidget', title: 'Axure 元件', category: 'data', icon: 'Square', parents,
    description: '保留原型元件信息。', snippet: '<AxureWidget kind="shape" text="文本" width={100} height={30} />',
    props: [{ name: 'kind', label: '元件类型', kind: 'select', options: ['shape', 'input', 'textarea', 'select', 'list', 'checkbox', 'radio', 'image', 'placeholder'] },
      ...frameSpecs, ...appearanceSpecs, text, ...strings({ placeholder: '输入提示', image: '内嵌图片' }), ...choices, ...state], events: click },
];
