import type { ComponentMeta, PropSpec } from '../registry/meta';

const numProps = (fields: Record<string, string>): PropSpec[] =>
  Object.entries(fields).map(([name, label]) => ({ name, label, kind: 'number' }));

const strProps = (fields: Record<string, string>): PropSpec[] =>
  Object.entries(fields).map(([name, label]) => ({ name, label, kind: 'string' }));

const boolProps = (fields: Record<string, string>): PropSpec[] =>
  Object.entries(fields).map(([name, label]) => ({ name, label, kind: 'boolean' }));

const figmaGeometrySpecs: PropSpec[] = [
  ...numProps({ x: '横坐标', y: '纵坐标', width: '图层宽度', height: '图层高度', opacity: '不透明度', rotation: '旋转角度' }),
  { name: 'sizingH', label: '水平尺寸策略', kind: 'select', options: ['fixed', 'hug', 'fill'] },
  { name: 'sizingV', label: '垂直尺寸策略', kind: 'select', options: ['fixed', 'hug', 'fill'] },
  { name: 'positioning', label: '定位模式', kind: 'select', options: ['auto', 'absolute'] },
  ...strProps({ label: '图层名称', sourceNodeId: '源节点ID' }),
  ...boolProps({ hidden: '初始隐藏' }),
];

const figmaSurfaceSpecs: PropSpec[] = [
  ...strProps({
    background: '背景填充/渐变',
    borderColor: '描边颜色',
    cornerRadii: '四角圆角',
    shadow: '阴影样式',
    padding: '内边距',
  }),
  ...numProps({
    radius: '统一圆角',
    borderWidth: '描边宽度',
    backdropBlur: '背景模糊(px)',
  }),
  { name: 'borderStyle', label: '描边线型', kind: 'select', options: ['solid', 'dashed'] },
];

const clickEvents = [{ name: 'onClick', label: '点击时' }];
const figmaParents = ['FigmaCanvas', 'FigmaFrame'];

export const FIGMA_MATERIAL_NAMES = new Set([
  'FigmaCanvas',
  'FigmaFrame',
  'FigmaText',
  'FigmaVector',
  'FigmaImage',
]);

export const isFigmaMaterial = (name: string): boolean => FIGMA_MATERIAL_NAMES.has(name);

export const FIGMA_MATERIALS: ComponentMeta[] = [
  {
    name: 'FigmaCanvas',
    title: 'Figma 画板宿主',
    category: 'layout',
    icon: 'LayoutTemplate',
    container: true,
    description: '承载从 Figma 导入的顶层画板，保留原始画板尺寸、背景与内部 Auto Layout / 自由定位图层。',
    props: [
      ...numProps({ frameWidth: '画板宽度', frameHeight: '画板高度', radius: '画板圆角', gap: '主轴间距' }),
      ...strProps({ background: '画板底色', padding: '画板内边距', sourceNodeId: 'Figma 画板 ID', importNotes: '导入说明' }),
      { name: 'layoutMode', label: '顶层自动布局', kind: 'select', options: ['none', 'row', 'column'] },
      { name: 'justify', label: '主轴对齐', kind: 'select', options: ['flex-start', 'center', 'flex-end', 'space-between'] },
      { name: 'align', label: '交叉轴对齐', kind: 'select', options: ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'] },
      ...boolProps({ clip: '裁剪溢出内容', wrap: '自动换行' }),
    ],
    snippet: '<FigmaCanvas frameWidth={1440} frameHeight={900} background="#FFFFFF" />',
  },
  {
    name: 'FigmaFrame',
    title: 'Figma 容器帧',
    category: 'layout',
    icon: 'Layers',
    container: true,
    parents: figmaParents,
    description: '支持 Figma Auto Layout 弹性排布与组内绝对定位的复合容器，保留填充、渐变、圆角、描边、阴影与毛玻璃。',
    props: [
      ...figmaGeometrySpecs,
      ...figmaSurfaceSpecs,
      { name: 'layoutMode', label: '布局模式', kind: 'select', options: ['none', 'row', 'column'] },
      ...numProps({ gap: '主轴间距', counterGap: '换行行距' }),
      { name: 'justify', label: '主轴对齐', kind: 'select', options: ['flex-start', 'center', 'flex-end', 'space-between'] },
      { name: 'align', label: '交叉轴对齐', kind: 'select', options: ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'] },
      ...boolProps({ wrap: '允许换行', clip: '裁剪溢出', disabled: '禁用交互' }),
      { name: 'semanticRole', label: '识别角色', kind: 'string' },
    ],
    events: clickEvents,
    snippet: '<FigmaFrame layoutMode="row" gap={12} padding="12px 16px" width={320} height={64} />',
  },
  {
    name: 'FigmaText',
    title: 'Figma 文本图层',
    category: 'data',
    icon: 'Type',
    parents: figmaParents,
    description: '高保真还原 Figma 文本与富文本分段样式（字号、字重、行高、字间距与对齐），支持独立选中编辑。',
    props: [
      { name: 'text', label: '文本内容', kind: 'text' },
      { name: 'runs', label: '分段富文本样式', kind: 'json' },
      ...figmaGeometrySpecs,
      ...strProps({ color: '文字颜色', fontFamily: '字体族', lineHeight: '行高' }),
      ...numProps({ fontSize: '字号', fontWeight: '字重', letterSpacing: '字间距(px)' }),
      { name: 'align', label: '水平对齐', kind: 'select', options: ['left', 'center', 'right', 'justify'] },
      { name: 'vertical', label: '垂直对齐', kind: 'select', options: ['top', 'middle', 'bottom'] },
      { name: 'decoration', label: '文字修饰', kind: 'select', options: ['none', 'underline', 'line-through'] },
      ...boolProps({ italic: '斜体', disabled: '禁用交互' }),
    ],
    events: clickEvents,
    snippet: '<FigmaText text="标题文本" fontSize={16} fontWeight={600} color="#0F172A" width={120} height={24} />',
  },
  {
    name: 'FigmaVector',
    title: 'Figma 矢量与形状',
    category: 'data',
    icon: 'Shapes',
    parents: figmaParents,
    description: '还原 Figma 矩形、椭圆、线条、多边形、布尔运算及 SVG 矢量图标路径。',
    props: [
      ...figmaGeometrySpecs,
      ...figmaSurfaceSpecs,
      ...strProps({ svgPath: '主矢量路径', viewBox: 'SVG 视口', fill: '矢量填充色', stroke: '矢量描边色' }),
      ...numProps({ strokeWidth: '矢量线宽' }),
      { name: 'paths', label: '多路径列表', kind: 'json' },
      ...boolProps({ disabled: '禁用交互' }),
    ],
    events: clickEvents,
    snippet: '<FigmaVector width={24} height={24} fill="#2563EB" viewBox="0 0 24 24" svgPath="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9Z" />',
  },
  {
    name: 'FigmaImage',
    title: 'Figma 图片图层',
    category: 'data',
    icon: 'Image',
    parents: figmaParents,
    description: '承载 Figma 内嵌位图或在线导出的图层切图，支持裁剪适配、圆角、描边与阴影。',
    props: [
      ...figmaGeometrySpecs,
      ...figmaSurfaceSpecs,
      ...strProps({ src: '图片地址/DataURI', alt: '替代说明' }),
      { name: 'objectFit', label: '填充模式', kind: 'select', options: ['cover', 'contain', 'fill'] },
      ...boolProps({ disabled: '禁用交互' }),
    ],
    events: clickEvents,
    snippet: '<FigmaImage width={160} height={120} objectFit="cover" radius={12} alt="配图" />',
  },
];
