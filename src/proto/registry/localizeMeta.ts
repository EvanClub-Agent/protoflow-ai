import {
  COMPONENTS,
  type ComponentCategory,
  type ComponentMeta,
  type EventSpec,
  type ListFieldSpec,
  type PropSpec,
} from './meta';
import { MOBILE_COMPONENTS } from '../mobile/meta';
import type { CompositeCategory, CustomCompositeBlock } from '../store/usePageStore';
import type { ActionArgSpec, ActionSpec } from '../runtime/actions';
import { getLocale, type Locale } from '../../i18n/runtime';

const ZH_CATEGORY_LABELS: Record<ComponentCategory, string> = {
  layout: '布局容器',
  navigation: '导航',
  query: '查询区',
  data: '数据展示',
  charts: '数据图表',
  form: '表单录入',
  action: '操作按钮',
  overlay: '弹层反馈',
};

const EN_CATEGORY_LABELS: Record<ComponentCategory, string> = {
  layout: 'Layout',
  navigation: 'Navigation',
  query: 'Query',
  data: 'Data Display',
  charts: 'Charts',
  form: 'Form Inputs',
  action: 'Actions',
  overlay: 'Overlays',
};

const ZH_CATEGORY_SHORT_LABELS: Record<ComponentCategory, string> = {
  layout: '布局',
  navigation: '导航',
  query: '查询',
  data: '数据',
  charts: '图表',
  form: '表单',
  action: '操作',
  overlay: '弹层',
};

const EN_CATEGORY_SHORT_LABELS: Record<ComponentCategory, string> = {
  layout: 'Layout',
  navigation: 'Nav',
  query: 'Query',
  data: 'Data',
  charts: 'Charts',
  form: 'Forms',
  action: 'Actions',
  overlay: 'Overlays',
};

const ZH_COMPOSITE_CATEGORY_LABELS: Record<CompositeCategory, string> = {
  header: '单据表头',
  query: '查询过滤',
  table: '明细表格',
  form: '表单区块',
  approval: '审批核验',
  overlay: '弹层模板',
};

const EN_COMPOSITE_CATEGORY_LABELS: Record<CompositeCategory, string> = {
  header: 'Query/Doc Header',
  query: 'Query Header',
  table: 'Table Block',
  form: 'Form Section',
  approval: 'Approval Flow',
  overlay: 'Overlay Block',
};

const EN_COMPONENT_META: Record<string, { title: string; description: string }> = {
  // Desktop Layout & Navigation
  Page: {
    title: 'Page',
    description: 'Root page container. Modals and Drawers are also defined inside the page and opened on demand at runtime.',
  },
  Card: {
    title: 'Card',
    description: 'Titled content section container (AntD Card).',
  },
  Row: {
    title: 'Grid Row',
    description: '24-column grid row (AntD Row) containing Col children.',
  },
  Col: {
    title: 'Grid Col',
    description: 'Grid column (AntD Col) with span from 1 to 24.',
  },
  Space: {
    title: 'Space',
    description: 'Arranges child elements horizontally or vertically with even spacing (AntD Space).',
  },
  Tabs: {
    title: 'Tabs',
    description: 'Tabbed container (AntD Tabs) holding Tab panes; switchable via switchTab.',
  },
  Tab: {
    title: 'Tab Pane',
    description: 'Child tab pane inside Tabs (AntD TabPane).',
  },
  Divider: {
    title: 'Divider',
    description: 'Section divider line with optional inline label (AntD Divider).',
  },
  Steps: {
    title: 'Steps',
    description: 'Displays step-by-step workflow progress (AntD Steps).',
  },
  PageHeader: {
    title: 'Page Header',
    description: 'Page title bar with optional back button, status tag, and breadcrumbs (AntD PageHeader).',
  },
  Breadcrumb: {
    title: 'Breadcrumb',
    description: 'Displays current page hierarchy path (AntD Breadcrumb).',
  },
  Pagination: {
    title: 'Pagination',
    description: 'Standalone pagination control (AntD Pagination).',
  },

  // Desktop Query & Data Display
  QueryForm: {
    title: 'Query Form',
    description: 'Compact filter bar (ProTable QueryFilter) with search, reset, and expand/collapse; target points to the Table pfId to filter.',
  },
  SearchInput: {
    title: 'Search Input',
    description: 'Keyword search box (AntD Input.Search) targeting a Table.',
  },
  Table: {
    title: 'Table',
    description: 'Data table (AntD Table). Auto-generates columns and binds mock records from a physical table; supports flat, tree, expandable rows, cell merges, inline editing, pagination, and row actions.',
  },
  Descriptions: {
    title: 'Descriptions',
    description: 'Detail field list (AntD Descriptions) supporting bordered table style, horizontal/vertical layout, and custom columns.',
  },
  Statistic: {
    title: 'Statistic',
    description: 'KPI metric card (AntD Statistic). Optionally counts rows from a bound physical table.',
  },
  Tag: {
    title: 'Tag',
    description: 'Status or category pill tag (AntD Tag).',
  },
  Timeline: {
    title: 'Timeline',
    description: 'Approval log and activity timeline (AntD Timeline).',
  },
  Text: {
    title: 'Text',
    description: 'Body text (AntD Typography.Text) supporting {{row.x}}, {{params.x}}, and {{vars.x}} template variables.',
  },
  Title: {
    title: 'Title',
    description: 'Section heading (AntD Typography.Title).',
  },
  Empty: {
    title: 'Empty State',
    description: 'Empty state placeholder (AntD Empty).',
  },

  // Desktop Form & Actions & Overlays
  Form: {
    title: 'Form',
    description: 'Form container (AntD Form) supporting horizontal/vertical/inline labels, alignment, colon toggle, sizing, and disabled mode.',
  },
  Input: {
    title: 'Text Input',
    description: 'Single-line text input (AntD Input).',
  },
  NumberInput: {
    title: 'Number Input',
    description: 'Numeric or currency input (AntD InputNumber).',
  },
  Textarea: {
    title: 'Textarea',
    description: 'Multi-line text input (AntD Input.TextArea).',
  },
  Select: {
    title: 'Select',
    description: 'Single or multi-select dropdown (AntD Select).',
  },
  DatePicker: {
    title: 'Date Picker',
    description: 'Date selector (AntD DatePicker).',
  },
  DateRange: {
    title: 'Date Range',
    description: 'Start and end date range picker (AntD RangePicker).',
  },
  Radio: {
    title: 'Radio Group',
    description: 'Radio button group (AntD Radio.Group) supporting dot or segmented button styles.',
  },
  Checkbox: {
    title: 'Checkbox Group',
    description: 'Multi-select checkbox group (AntD Checkbox.Group).',
  },
  Switch: {
    title: 'Switch',
    description: 'Toggle switch control (AntD Switch).',
  },
  Upload: {
    title: 'Upload',
    description: 'File or image upload control (AntD Upload).',
  },
  PickerInput: {
    title: 'Modal Picker',
    description: 'Opens a selection modal (overlay) on click and writes back selected rows via returnSelection(tablePfId, labelField, valueField).',
  },
  Button: {
    title: 'Button',
    description: 'Action button (AntD Button) with label in text child and onClick action chain.',
  },
  Toolbar: {
    title: 'Toolbar',
    description: 'Horizontal bar for action buttons and inline filters with alignment, background, and border options.',
  },
  Modal: {
    title: 'Modal',
    description: 'Modal dialog sub-canvas (AntD Modal). Open via openModal(id, params) and close via closeOverlay().',
  },
  Drawer: {
    title: 'Drawer',
    description: 'Side drawer sub-canvas (AntD Drawer). Open via openDrawer(id, params) for details and long forms.',
  },
  Alert: {
    title: 'Alert',
    description: 'Inline callout banner (AntD Alert).',
  },
  Result: {
    title: 'Result',
    description: 'Operation success or failure result view (AntD Result).',
  },

  // Ant Design Extended Materials
  Flex: {
    title: 'Flex Box',
    description: 'Ant Design Flex container controlling direction, wrapping, gap, and two-axis alignment.',
  },
  Collapse: {
    title: 'Collapse',
    description: 'Ant Design Collapse container holding CollapsePanel items; expands all in design mode and supports accordion in preview.',
  },
  CollapsePanel: {
    title: 'Collapse Panel',
    description: 'Collapsible content section inside Collapse that accepts any child materials.',
  },
  Avatar: {
    title: 'Avatar',
    description: 'Ant Design Avatar supporting initials, images, shape, and custom size.',
  },
  Badge: {
    title: 'Badge',
    description: 'Ant Design Badge counter, dot indicator, or status badge wrapping child components.',
  },
  Progress: {
    title: 'Progress',
    description: 'Ant Design Progress bar supporting line, circle, dashboard, and stepped styles.',
  },
  Image: {
    title: 'Image',
    description: 'Ant Design Image with click preview, zoom, and rotation.',
  },
  Skeleton: {
    title: 'Skeleton',
    description: 'Ant Design Skeleton loading placeholder; displays child components when loading is turned off.',
  },
  Spin: {
    title: 'Spin',
    description: 'Ant Design Spin loading overlay with configurable size and tip text.',
  },
  Tooltip: {
    title: 'Tooltip',
    description: 'Ant Design Tooltip wrapping a trigger element; shows hover/click hint in preview.',
  },
  Popover: {
    title: 'Popover',
    description: 'Ant Design Popover card with configurable title and body; opens in preview.',
  },
  Popconfirm: {
    title: 'Popconfirm',
    description: 'Ant Design Popconfirm bubble running confirm or cancel action chains.',
  },
  TimePicker: {
    title: 'Time Picker',
    description: 'Time selector (Ant Design TimePicker) with form binding and onChange action chain.',
  },
  Slider: {
    title: 'Slider',
    description: 'Range slider input (Ant Design Slider) with form binding and onChange action chain.',
  },
  Rate: {
    title: 'Rate',
    description: 'Star rating control (Ant Design Rate) with form binding and onChange action chain.',
  },
  Cascader: {
    title: 'Cascader',
    description: 'Hierarchical cascader selector (Ant Design Cascader) with form binding and onChange action chain.',
  },
  TreeSelect: {
    title: 'Tree Select',
    description: 'Tree dropdown selector (Ant Design TreeSelect) with form binding and onChange action chain.',
  },
  AutoComplete: {
    title: 'Auto Complete',
    description: 'Input with autocomplete suggestions (Ant Design AutoComplete) and onChange action chain.',
  },
  Segmented: {
    title: 'Segmented',
    description: 'Segmented control (Ant Design Segmented) with form binding and onChange action chain.',
  },

  // Freeform & Charts
  Freeform: {
    title: 'Freeform Widget',
    description: 'Describe your idea and let AI build bespoke layouts and interactions — ideal for seat maps, visual schedules, custom flows, and rich cards.',
  },
  BarChart: {
    title: 'Bar Chart',
    description: 'Compares values across categories; supports horizontal, grouped, and stacked bars.',
  },
  LineChart: {
    title: 'Line Chart',
    description: 'Displays trends over time or ordered categories with single or multiple metrics.',
  },
  AreaChart: {
    title: 'Area Chart',
    description: 'Highlights trend volume and magnitude, supporting multi-metric stacking.',
  },
  PieChart: {
    title: 'Pie Chart',
    description: 'Compares category proportions across non-negative metric values.',
  },
  DonutChart: {
    title: 'Donut Chart',
    description: 'Presents category share in a ring chart ideal for overview dashboards.',
  },
  ScatterChart: {
    title: 'Scatter Chart',
    description: 'Plots relationships between two numeric metrics with one point per record.',
  },
  RadarChart: {
    title: 'Radar Chart',
    description: 'Compares multi-dimensional profiles across non-negative metrics.',
  },
  GaugeChart: {
    title: 'Gauge Chart',
    description: 'Shows a single KPI value within a min/max range such as goal attainment.',
  },
  FunnelChart: {
    title: 'Funnel Chart',
    description: 'Visualizes sequential stage volumes and conversion drop-off.',
  },
  HeatmapChart: {
    title: 'Heatmap Chart',
    description: 'Uses color intensity to express metric strength across two category dimensions.',
  },
  TreemapChart: {
    title: 'Treemap Chart',
    description: 'Compares category composition via nested rectangle areas.',
  },
  SankeyChart: {
    title: 'Sankey Chart',
    description: 'Visualizes source-to-target flow volume without cycles.',
  },

  // Mobile Materials (M*)
  MobilePage: {
    title: 'Mobile Page',
    description: 'Mobile root container (Gemini modern design language) with status bar, sticky glass top bar, scroll body, floating tab bar, and in-frame bottom sheets.',
  },
  MSurface: {
    title: 'Surface Card',
    description: '22px borderless modern card container using soft tonal elevation and optional Gemini gradient glow.',
  },
  MBentoGrid: {
    title: 'Bento Grid',
    description: 'Modular Bento tile grid for consumer entry points, AI prompt cards, and modern mobile workspaces.',
  },
  MScrollRow: {
    title: 'Scroll Row',
    description: 'Smooth horizontal scroll-snap container for carousels, prompt strips, or horizontal KPIs.',
  },
  MTopBar: {
    title: 'Glass Top Bar',
    description: 'Sticky frosted-glass navigation bar with left back/menu icon, optional dropdown title, and right avatar or quick action.',
  },
  MTabBar: {
    title: 'Bottom Tab Bar',
    description: 'Global safe-area bottom navigation bar supporting floating glass pill or docked bar with cross-page navigation.',
  },
  MPillTabs: {
    title: 'Pill Tabs',
    description: 'Rounded sliding pill switcher that toggles nested MTab panes or filters a target MFeedList / MTaskList.',
  },
  MTab: {
    title: 'Mobile Tab Pane',
    description: 'Child panel container inside MPillTabs.',
  },
  MSearchPill: {
    title: 'Search Pill',
    description: 'Soft-filled pill search bar supporting live mobile list filtering and a right filter sheet button.',
  },
  MHeroHeader: {
    title: 'Hero Header',
    description: 'Gemini iridescent greeting header or rounded visual brand banner card.',
  },
  MFeedList: {
    title: 'Feed List',
    description: 'Modern media & product card stream (binds physical tables) with waterfall, media row, and showcase layouts.',
  },
  MTaskList: {
    title: 'Task Card List',
    description: 'Mobile business document & approval card stream with physical table binding, status pills, and card actions.',
  },
  MListGroup: {
    title: 'Grouped List',
    description: '20px rounded grouped row list for profile menus or bound row detail key-value views inside sheets.',
  },
  MListItem: {
    title: 'List Item',
    description: '48px+ touch-friendly row item for MListGroup or MSurface.',
  },
  MStatCard: {
    title: 'Stat Trend Card',
    description: 'Bold headline metric with trend pill badge and smooth sparkline.',
  },
  MChatStream: {
    title: 'AI Chat Stream',
    description: 'Gemini-style borderless AI chat and structured insight card stream.',
  },
  MComposerBar: {
    title: 'AI Composer Bar',
    description: 'Floating bottom multimodal pill input bar with suggestion chips, attachment trigger, voice, and send.',
  },
  MForm: {
    title: 'Mobile Form',
    description: 'Mobile touch form container bound to a physical table with required validation and submitForm / resetForm support.',
  },
  MField: {
    title: 'Filled Input',
    description: '48px borderless soft-filled input supporting text, large amount, number, phone, and multiline notes.',
  },
  MSheetPicker: {
    title: 'Sheet Picker',
    description: 'Slides up a rounded bottom-sheet picker for custom options, dates/times, or foreign-key table records.',
  },
  MChipSelect: {
    title: 'Chip Select',
    description: 'Full-pill chip matrix for thumb-friendly single or multiple selection.',
  },
  MMediaInput: {
    title: 'Media & Toggle',
    description: 'Mobile touch control supporting pill switch, quantity stepper, photo upload, and barcode scanner.',
  },
  MButton: {
    title: 'Pill Button',
    description: '48px full-pill button supporting Gemini gradient, solid primary, tonal, outline, and ghost styles.',
  },
  MBottomDock: {
    title: 'Bottom Action Dock',
    description: 'Safe-area frosted bottom action bar supporting dual approval buttons or commerce price summary + CTA.',
  },
  MBottomSheet: {
    title: 'Bottom Sheet',
    description: 'In-frame 28px rounded bottom sheet with top grabber handle; opened via openDrawer(id).',
  },
  MDialog: {
    title: 'Glass Dialog',
    description: 'In-frame centered 24px frosted confirmation dialog; opened via openModal(id).',
  },

  // Axure Compatibility Materials
  AxureCanvas: {
    title: 'Free-Position Canvas',
    description: 'Arranges editable widgets by exact pixel coordinates.',
  },
  PositionedGroup: {
    title: 'Positioned Group',
    description: 'Groups child widgets with relative coordinates to move or hide together.',
  },
  OutlineTree: {
    title: 'Outline Tree',
    description: 'Expandable hierarchical directory with independently editable node labels and navigation.',
  },
  TreeItem: {
    title: 'Tree Node',
    description: 'Preserves node label, child items, and initial expanded state.',
  },
  DynamicPanel: {
    title: 'Dynamic Panel',
    description: 'Multi-state container preserving child widgets per state and switchable by 1-based index.',
  },
  PanelState: {
    title: 'Panel State',
    description: 'Editable positioned widget container for a single DynamicPanel state.',
  },
  StaticTable: {
    title: 'Static Table',
    description: 'Fixed row/column grid where each cell can be selected and edited individually.',
  },
  VectorShape: {
    title: 'Vector Shape',
    description: 'Editable vector shape widget.',
  },
  StaticTableCell: {
    title: 'Table Cell',
    description: 'Editable static table cell.',
  },
  Hotspot: {
    title: 'Hotspot',
    description: 'Interactive click hotspot region.',
  },
  EmbeddedPicture: {
    title: 'Embedded Picture',
    description: 'Embedded picture widget.',
  },
  ListSelect: {
    title: 'Dropdown Select',
    description: 'Positioned dropdown select box.',
  },
  ListBox: {
    title: 'List Box',
    description: 'Positioned list selection box.',
  },
  CheckControl: {
    title: 'Checkbox',
    description: 'Standalone checkbox widget.',
  },
  RadioControl: {
    title: 'Radio Button',
    description: 'Standalone radio button widget.',
  },
  AxureWidget: {
    title: 'Axure Widget',
    description: 'Preserves imported prototype widget metadata and geometry.',
  },
};

const PROP_LABEL_MAP: Record<string, string> = {
  // Common / Field base
  '标签文字': 'Label',
  '绑定字段': 'Field',
  '占位提示': 'Placeholder',
  '标签排列(layout)': 'Label Layout',
  '标签对齐(labelAlign)': 'Label Align',
  '标签宽度(px)': 'Label Width (px)',
  '显示冒号(:)': 'Show Colon (:)',
  '必填校验': 'Required',
  '允许清空(allowClear)': 'Allow Clear',
  '允许清空': 'Allow Clear',
  '禁用状态': 'Disabled',
  '只读状态': 'Read Only',
  '底部辅助说明(extra)': 'Helper Text (extra)',
  '表单内占列(1-4)': 'Form Span (1-4)',
  '选项数据': 'Options',
  '初始值': 'Initial Value',

  // Page / Card / Grid / Space / Tabs / Divider / Steps
  '页面标题': 'Page Title',
  '页面说明': 'Description',
  '页面边距': 'Padding',
  '背景色': 'Background',
  '标题(title)': 'Title',
  '标题': 'Title',
  '右上角扩展(extra)': 'Header Extra',
  '尺寸(size)': 'Size',
  '尺寸': 'Size',
  '尺寸(px)': 'Size (px)',
  '显示边框(bordered)': 'Bordered',
  '显示边框': 'Bordered',
  '悬停浮起(hoverable)': 'Hoverable',
  '头部底色': 'Header Style',
  '内部默认列数(1-4)': 'Default Columns (1-4)',
  '列间距(gutter px)': 'Gutter (px)',
  '垂直对齐(align)': 'Vertical Align',
  '列占比(span 1-24)': 'Column Span (1-24)',
  '方向(direction)': 'Direction',
  '间距大小(size)': 'Gap Size',
  '主轴对齐(align)': 'Main Axis Align',
  '自动换行(wrap)': 'Wrap',
  '自动换行': 'Wrap',
  '页签样式(type)': 'Tab Style',
  '页签位置(tabPosition)': 'Tab Position',
  '标签居中(centered)': 'Centered Tabs',
  '页签名': 'Tab Title',
  '角标数字(Badge)': 'Badge Count',
  '禁用页签': 'Disabled',
  '内嵌文字': 'Inline Text',
  '文字位置(orientation)': 'Text Position',
  '虚线样式(dashed)': 'Dashed',
  '步骤列表': 'Steps',
  '当前步骤(从0开始)': 'Current Step (0-based)',
  '排列方向(direction)': 'Direction',
  '当前状态(status)': 'Status',

  // Navigation
  '主标题(title)': 'Title',
  '主标题': 'Title',
  '副标题(subTitle)': 'Subtitle',
  '副标题说明(subTitle)': 'Subtitle',
  '状态标签文字': 'Tag Text',
  '状态标签颜色': 'Tag Color',
  '面包屑路径': 'Breadcrumbs',
  '显示返回箭头': 'Show Back Button',
  '底部边线': 'Bottom Divider',
  '层级列表': 'Items',
  '分隔符(separator)': 'Separator',
  '总条数(total)': 'Total Items',
  '每页条数(pageSize)': 'Page Size',
  '对齐位置(align)': 'Alignment',
  '显示总条数': 'Show Total',
  '显示每页条数切换': 'Show Size Changer',
  '允许切换每页条数': 'Show Size Changer',
  '显示快速跳页(跳至X页)': 'Show Quick Jumper',
  '显示快速跳页': 'Show Quick Jumper',

  // QueryForm / SearchInput
  '过滤目标表格': 'Target Table',
  '查询条件': 'Query Fields',
  '每行最多列数(cols)': 'Max Columns (cols)',
  '普通控件最大宽度(px)': 'Control Max Width (px)',
  '日期范围最大宽度(px)': 'Date Range Max Width (px)',
  '标签文字对齐(labelAlign)': 'Label Align',
  '标签宽度(留空自适应)': 'Label Width (auto if empty)',
  '控件尺寸(size)': 'Control Size',
  '默认展开全部条件': 'Expand All by Default',
  '查询按钮文字': 'Search Button Text',
  '重置按钮文字': 'Reset Button Text',
  '显示右侧搜索按钮': 'Show Search Button',

  // Table / Descriptions / Statistic / Tag / Timeline / Text / Title / Empty
  '绑定物理表': 'Bound Table',
  '表格模式': 'Row Mode',
  '当前来源行的外键': 'Source Foreign Key',
  '节点字段': 'Tree Key Field',
  '父节点字段': 'Parent Field',
  '展开详情字段': 'Expanded Detail Fields',
  '默认展开全部': 'Expand All by Default',
  '合并区域': 'Merged Cells',
  '表格顶部标题(title)': 'Table Title',
  '列配置(留空自动)': 'Columns (auto if empty)',
  '行操作列': 'Row Actions',
  '固定过滤条件': 'Static Filter',
  '斑马纹(隔行变色 striped)': 'Striped Rows',
  '单元格纵向边框(bordered)': 'Vertical Cell Borders',
  '表格密度(size)': 'Density',
  '启用行选择(rowSelection)': 'Row Selection',
  '选择框类型': 'Selection Type',
  '显示序号列': 'Show Row Index',
  '显示表头(showHeader)': 'Show Header',
  '显示分页器(pagination)': 'Show Pagination',
  '显示底部合计行(Summary)': 'Show Summary Row',
  '合计行说明文字': 'Summary Label',
  '空数据文案': 'Empty Text',
  '右上角说明(extra)': 'Extra Text',
  '字段(留空自动)': 'Fields (auto if empty)',
  '每行列数(column)': 'Columns per Row',
  '表格边框模式(bordered)': 'Bordered Table Style',
  '排列方向(layout)': 'Layout',
  '密度尺寸(size)': 'Density',
  '显示冒号(colon)': 'Show Colon',
  '标签列宽(px)': 'Label Width (px)',
  '指标名(title)': 'Metric Label',
  '数值(value)': 'Value',
  '统计物理表行数': 'Count Rows from Table',
  '前缀(prefix 如 ¥)': 'Prefix (e.g. $)',
  '后缀单位(suffix)': 'Suffix Unit',
  '小数位数(precision)': 'Precision',
  '趋势箭头': 'Trend Arrow',
  '数值颜色': 'Value Color',
  '显示卡片边框': 'Bordered Card',
  '颜色(color)': 'Color',
  '胶囊圆角': 'Pill Shape',
  '可关闭(closable)': 'Closable',
  '节点列表': 'Timeline Items',
  '排列模式(mode)': 'Alignment Mode',
  '倒序排列(reverse)': 'Reverse Order',
  '语义样式(type)': 'Semantic Style',
  '字号大小': 'Font Size',
  '加粗(strong)': 'Bold',
  '斜体(italic)': 'Italic',
  '下划线(underline)': 'Underline',
  '删除线(delete)': 'Strikethrough',
  '代码框样式(code)': 'Inline Code',
  '可复制图标(copyable)': 'Copyable',
  '标题级别(level 1-5)': 'Heading Level (1-5)',
  '文字对齐': 'Text Align',
  '左侧蓝色竖条装饰': 'Left Accent Bar',
  '描述文案(description)': 'Description',
  '图标尺寸': 'Icon Size',

  // Form & Controls
  '字段(无子组件时生效)': 'Fields (when no children)',
  '每行列数(cols 1-4)': 'Columns (1-4)',
  '标签位置(layout)': 'Label Layout',
  '标签宽度(labelWidth px)': 'Label Width (px)',
  '显示标签冒号(colon)': 'Show Label Colon',
  '整表禁用(disabled)': 'Disable Entire Form',
  '前缀文字(addonBefore/prefix)': 'Prefix',
  '后缀文字(addonAfter/suffix)': 'Suffix',
  '最大字符数(maxLength)': 'Max Length',
  '最大字数(maxLength)': 'Max Length',
  '显示字数统计(showCount)': 'Show Character Count',
  '密码框模式': 'Password Mode',
  '前缀(如 ¥)': 'Prefix (e.g. $)',
  '后缀单位(如 元、件)': 'Suffix Unit',
  '最小值(min)': 'Min',
  '最大值(max)': 'Max',
  '步长(step)': 'Step',
  '显示行数(rows)': 'Rows',
  '多选模式(mode="multiple")': 'Multiple Selection',
  '支持输入搜索(showSearch)': 'Searchable',
  '时间粒度(picker)': 'Date Granularity',
  '包含时间(showTime)': 'Include Time',
  '包含时间': 'Include Time',
  '展示样式(optionType)': 'Option Style',
  '按钮风格(buttonStyle)': 'Button Style',
  '选项排列方向': 'Option Direction',
  '开启时文字(checkedChildren)': 'Checked Label',
  '关闭时文字(unCheckedChildren)': 'Unchecked Label',
  '上传区域样式(listType)': 'Upload Style',
  '文件格式说明(accept)': 'Accepted Formats',
  '按钮文字': 'Button Label',
  '选择弹框': 'Picker Overlay',

  // Actions & Overlays
  '按钮类型(type)': 'Button Type',
  '按钮尺寸(size)': 'Button Size',
  '按钮形状(shape)': 'Button Shape',
  '图标(icon)': 'Icon',
  '危险红色状态(danger)': 'Danger',
  '幽灵透明底(ghost)': 'Ghost',
  '撑满行宽(block)': 'Full Width (block)',
  '禁用(disabled)': 'Disabled',
  '禁用': 'Disabled',
  '对齐方式(align)': 'Alignment',
  '左侧标题文字': 'Left Title',
  '左侧副标题/统计说明': 'Left Subtitle',
  '工具栏底色': 'Background',
  '弹框ID': 'Modal ID',
  '抽屉ID': 'Drawer ID',
  '宽度(width px)': 'Width (px)',
  '垂直居中(centered)': 'Centered',
  '显示默认底部按钮栏(footer)': 'Show Footer',
  '显示底部按钮栏(footer)': 'Show Footer',
  '确定按钮文字(okText)': 'OK Button Text',
  '取消按钮文字(cancelText)': 'Cancel Button Text',
  '弹出位置(placement)': 'Placement',
  '类型(type)': 'Alert Type',
  '主提示内容(message)': 'Message',
  '详细辅助说明(description)': 'Description',
  '显示状态图标(showIcon)': 'Show Icon',
  '显示关闭按钮(closable)': 'Closable',
  '顶部通栏无圆角(banner)': 'Top Banner Mode',
  '状态(status)': 'Status',

  // Antd Extras
  '弹出位置': 'Placement',
  '触发方式': 'Trigger',
  '垂直排列': 'Vertical',
  '间距(px)': 'Gap (px)',
  '主轴对齐': 'Justify',
  '交叉轴对齐': 'Align',
  '手风琴模式': 'Accordion',
  '透明背景': 'Ghost',
  '展开图标位置': 'Expand Icon Position',
  '面板标题': 'Panel Title',
  '右侧说明': 'Extra Text',
  '禁止展开': 'Disabled',
  '图片地址': 'Image URL',
  '替代文字': 'Alt Text',
  '形状': 'Shape',
  '文字颜色': 'Text Color',
  '数量': 'Count',
  '最大展示数': 'Max Count',
  '显示零': 'Show Zero',
  '仅显示圆点': 'Dot Only',
  '状态': 'Status',
  '状态说明': 'Status Text',
  '自定义颜色': 'Custom Color',
  '百分比': 'Percent (%)',
  '显示进度文字': 'Show Info',
  '分段数量': 'Steps',
  '进度颜色': 'Stroke Color',
  '端点形状': 'Stroke Linecap',
  '图片宽度(px)': 'Width (px)',
  '图片高度(px)': 'Height (px)',
  '填充方式': 'Object Fit',
  '点击预览': 'Click to Preview',
  '加载状态': 'Loading',
  '动画': 'Animated',
  '头像占位': 'Avatar Placeholder',
  '标题占位': 'Title Placeholder',
  '圆角段落': 'Rounded Rows',
  '段落行数': 'Paragraph Rows',
  '加载说明': 'Loading Tip',
  '提示内容': 'Tooltip Text',
  '背景颜色': 'Background Color',
  '内容': 'Content',
  '确认标题': 'Confirm Title',
  '详细说明': 'Description',
  '确认按钮文字': 'Confirm Button Text',
  '取消按钮文字': 'Cancel Button Text',
  '时间格式': 'Time Format',
  '12小时制': '12-Hour Clock',
  '小时间隔': 'Hour Step',
  '分钟间隔': 'Minute Step',
  '秒间隔': 'Second Step',
  '最小值': 'Min',
  '最大值': 'Max',
  '步长': 'Step',
  '双滑块范围': 'Dual-Thumb Range',
  '反向': 'Reverse',
  '显示刻度': 'Show Dots',
  '始终显示数值': 'Always Show Tooltip',
  '星星数量': 'Star Count',
  '允许半星': 'Allow Half Star',
  '搜索': 'Searchable',
  '允许选择中间层级': 'Change on Select',
  '展开方式': 'Expand Trigger',
  '多选': 'Multiple',
  '显示复选框': 'Checkable',
  '最多展示标签数': 'Max Tag Count',
  '撑满宽度': 'Block (Full Width)',
  '排列方向': 'Direction',
  '密码可见切换': 'Visibility Toggle',
  '自动调整高度': 'Auto Size',
  '最少行数': 'Min Rows',
  '最多行数': 'Max Rows',
  '显示增减按钮': 'Stepper Controls',
  '允许键盘增减': 'Keyboard Step',
  '选择模式（优先于旧多选开关）': 'Select Mode',
  '最多选择项数': 'Max Selections',
  '下拉宽度跟随控件': 'Popup Match Width',
  '图标位置': 'Icon Position',
  '加载骨架屏': 'Loading Skeleton',
  '简洁模式': 'Simple Mode',
  '仅一页时隐藏': 'Hide on Single Page',
  '表体最大高度(px)': 'Max Scroll Height (px)',
  '表格最小宽度(px)': 'Min Scroll Width (px)',
  '固定表头': 'Sticky Header',
  '校验状态': 'Validation Status',
  '控件外观': 'Input Variant',

  // Charts & Freeform
  '图表标题': 'Chart Title',
  '数据来源': 'Data Source',
  '工程数据表': 'Project Table',
  '自定义数据': 'Inline Data',
  '来源字段': 'Source Field',
  '分类字段': 'Category Field',
  '数值指标': 'Metrics',
  '去向字段': 'Target Field',
  '纵向分类': 'Series / Y Category',
  '汇总方式': 'Aggregation',
  '图表高度': 'Chart Height (px)',
  '图表配色': 'Color Palette',
  '显示图例': 'Show Legend',
  '显示数值': 'Show Data Labels',
  '堆叠展示': 'Stacked',
  '区间缩放': 'Data Zoom',
  '横向展示': 'Horizontal Bars',
  '平滑曲线': 'Smooth Curve',
  '范围下限': 'Min Value',
  '范围上限': 'Max Value',
  '组件名称': 'Widget Title',
  '样式': 'Custom CSS',
  '最小高度': 'Min Height (px)',
  '展示内容': 'Input Data (JSON)',
  '关联数据表': 'Bound Table',
  '展示字段': 'Visible Columns',
  '交互结果': 'Emitted Event Fields',

  // Mobile Props
  '视觉外观': 'Appearance',
  '品牌强调色': 'Accent Theme',
  '页面底色层次': 'Surface Background',
  '内容区内边距': 'Content Padding',
  '区块标题': 'Section Title',
  '副标题说明': 'Subtitle',
  '右上角动作文字': 'Action Text',
  '表面质感': 'Surface Tone',
  '内部留白': 'Padding',
  '列数(1-3)': 'Columns (1-3)',
  '排布形态': 'Grid Layout',
  '磁贴卡片项': 'Bento Tiles',
  '栏目标题': 'Row Title',
  '卡片间距(px)': 'Card Gap (px)',
  '露边提示可横滑': 'Peek Next Card',
  '标题文字': 'Title',
  '副标题/状态': 'Subtitle / Status',
  '左侧按钮': 'Left Button',
  '标题带切换箭头(▾)': 'Title Dropdown (▾)',
  '右侧图标': 'Right Icon',
  '沉浸透明底': 'Transparent Bar',
  '导航栏形态': 'Tab Bar Style',
  '当前激活项 key': 'Active Key',
  '导航项列表(2-5项)': 'Nav Items (2-5)',
  '指示风格': 'Indicator Style',
  '关联筛选列表': 'Target List',
  '筛选字段名': 'Filter Field',
  '快捷胶囊项': 'Pill Items',
  '页签名称': 'Tab Title',
  '徽标数': 'Badge Count',
  '实时过滤列表': 'Live Filter List',
  '显示语音图标': 'Show Voice Icon',
  '显示筛选按钮': 'Show Filter Button',
  '筛选半屏抽屉': 'Filter Sheet',
  '头部形态': 'Header Mode',
  '顶部小胶囊文案': 'Eyebrow Badge',
  '副标题提示': 'Subtitle',
  '胶囊按钮文字': 'Action Pill Text',
  '卡片流排布': 'Feed Layout',
  '标题字段': 'Title Field',
  '描述字段': 'Subtitle Field',
  '价格/核心值字段': 'Price / Value Field',
  '柔和胶囊标签字段': 'Tag Field',
  '默认过滤条件': 'Default Filter',
  '卡片动作文案': 'Card Action Text',
  '静态演示数据(未绑表时生效)': 'Demo Items (when unbound)',
  '单号/主标题字段': 'Title Field',
  '状态胶囊字段': 'Status Field',
  '摘要展示字段(2-4项)': 'Summary Fields (2-4)',
  '卡片底部动作按钮': 'Card Actions',
  '静态演示卡片(未绑表时生效)': 'Demo Cards (when unbound)',
  '分组标题': 'Group Title',
  '详情数据源表(读取当前 row)': 'Detail Table (reads row)',
  '快捷列表行': 'List Rows',
  '辅助说明': 'Description',
  '右侧值文案': 'Right Value',
  '左侧图标': 'Left Icon',
  '显示右箭头': 'Show Chevron',
  '警示文字色': 'Danger Text',
  '指标名称': 'Metric Title',
  '数值文本': 'Value Text',
  '后缀单位': 'Unit',
  '趋势胶囊': 'Trend Badge',
  '趋势语义': 'Trend Tone',
  '显示平滑微折线': 'Show Sparkline',
  'AI 助手名称': 'Assistant Name',
  '对话消息列表': 'Messages',
  '输入提示语': 'Placeholder',
  '快捷指令胶囊(逗号分隔)': 'Suggestion Chips (comma-sep)',
  '吸附于页面底部': 'Dock to Bottom',
  '显示加号与语音按钮': 'Show Media & Voice',
  '表单标题': 'Form Title',
  '绑定数据表': 'Bound Table',
  '字段标签': 'Field Label',
  '绑定字段名': 'Field Name',
  '输入模式': 'Input Mode',
  '底部辅助说明': 'Helper Text',
  '必填项': 'Required',
  '只读态': 'Read Only',
  '选择器类型': 'Picker Mode',
  '外键选项数据表': 'Options Source Table',
  '选项显示字段': 'Option Label Field',
  '选项存储字段': 'Option Value Field',
  '支持多选': 'Multiple Selection',
  '控件标签': 'Label',
  '触控形态': 'Control Variant',
  '辅助说明文字': 'Helper Text',
  '按钮外观': 'Button Variant',
  '尺寸高度': 'Button Size',
  '通栏占满宽度': 'Full Width',
  '前置图标': 'Leading Icon',
  '警示红色': 'Danger',
  '操作坞模式': 'Dock Mode',
  '左侧摘要标题': 'Summary Label',
  '左侧金额/核心值': 'Price / Value',
  '次要胶囊按钮文字': 'Secondary Button Text',
  '主胶囊按钮文字': 'Primary Button Text',
  '主按钮警示色': 'Danger Primary Button',
  '抽屉唯一 ID': 'Sheet ID',
  '抽屉标题': 'Sheet Title',
  '展开高度档位': 'Sheet Height',
  '弹窗唯一 ID': 'Dialog ID',
  '详细说明文案': 'Description',
  '警示确认态': 'Danger Confirm',

  // Axure Props
  '横坐标': 'X',
  '纵坐标': 'Y',
  '宽度': 'Width',
  '高度': 'Height',
  '元件名称': 'Widget Name',
  '初始隐藏': 'Initially Hidden',
  '字号': 'Font Size',
  '字重': 'Font Weight',
  '圆角': 'Border Radius',
  '边框宽度': 'Border Width',
  '不透明度': 'Opacity',
  '填充颜色': 'Fill Color',
  '边框颜色': 'Border Color',
  '内边距': 'Padding',
  '字体': 'Font Family',
  '各边宽度': 'Edge Widths',
  '各边颜色': 'Edge Colors',
  '文本对齐': 'Text Align',
  '垂直对齐': 'Vertical Align',
  '文本': 'Text',
  '分段文字样式': 'Rich Text Runs',
  '选项': 'Choices',
  '选中项下标': 'Selected Indices',
  '初始勾选': 'Initially Checked',
  '只读': 'Read Only',
  '裁剪内容': 'Clip Content',
  '禁用交互': 'Disable Interaction',
  '行高': 'Row Height',
  '缩进': 'Indent',
  '初始展开': 'Initially Expanded',
  '显示状态（从 1 开始）': 'Active State (1-based)',
  '固定水平偏移': 'Pin Margin X',
  '固定垂直偏移': 'Pin Margin Y',
  '固定水平位置': 'Pin Horizontal',
  '固定垂直位置': 'Pin Vertical',
  '按当前状态调整大小': 'Fit to Content',
  '固定在最前': 'Pin to Front',
  '状态名称': 'State Name',
  '列宽': 'Column Widths',
  '共用单元格样式': 'Cell Style',
  '矢量路径': 'Vector Path',
  '图片内容': 'Image Source',
  '单选组': 'Radio Group',
  '元件类型': 'Widget Kind',
  '输入提示': 'Placeholder',
  '内嵌图片': 'Embedded Image',
};

const LIST_FIELD_LABEL_MAP: Record<string, string> = {
  '字段名': 'Field',
  '标签': 'Label',
  '类型': 'Type',
  '必填': 'Required',
  '选项(逗号分隔)': 'Options (CSV)',
  '占列': 'Span',
  '字段': 'Field',
  '列名': 'Title',
  '展示': 'Render',
  '对齐': 'Align',
  '单元格编辑器': 'Editor',
  '下拉选项': 'Options',
  '合并相邻同值行': 'Merge Rows',
  '排序': 'Sortable',
  '宽度': 'Width',
  '名称': 'Label',
  '危险': 'Danger',
  '点击动作': 'On Click',
  '固定值': 'Static Value',
  '标题': 'Title',
  '时间': 'Time',
  '状态': 'Status',
  '指标字段': 'Metric Field',
  '显示名称': 'Display Label',
  '结果名称': 'Field Name',
  '值类型': 'Value Type',
  '按钮文字': 'Button Label',
  '主色胶囊': 'Primary Pill',
  '警示色': 'Danger',
  '绑定字段': 'Field',
  '显示标签': 'Label',
  '展示格式': 'Format',
  '主标题': 'Title',
  '副文案': 'Subtitle',
  '图标名': 'Icon',
  '右上角胶囊': 'Badge',
  '底色层次': 'Tone',
  '唯一标识': 'Key',
  '角标数字/文案': 'Badge',
  '跳转目标页面ID': 'Target Page ID',
  '自定义动作': 'On Click',
  '胶囊文字': 'Label',
  '过滤匹配值(空=全部)': 'Filter Value',
  '数字徽标': 'Badge',
  '描述': 'Subtitle',
  '价格/指标': 'Price / Metric',
  '单据标题': 'Title',
  '摘要说明': 'Summary',
  '时间/金额备注': 'Meta',
  '行标题': 'Title',
  '下方辅助说明': 'Description',
  '右侧显示值': 'Value',
  '左侧图标名': 'Icon',
  '显示右箭头': 'Chevron',
  '发送角色': 'Role',
  '消息正文': 'Message',
  '重点结论卡片文案(可选)': 'Highlight (opt)',
};

const EVENT_LABEL_MAP: Record<string, string> = {
  '切换页签': 'On Tab Change',
  '点击返回': 'On Back Click',
  '点击查询': 'On Search',
  '点击行': 'On Row Click',
  '值变化': 'On Change',
  '值变化（params.value）': 'On Change (params.value)',
  '页码变化（params.current / pageSize）': 'On Page Change (params.current / pageSize)',
  '点击时': 'On Click',
  '点击': 'On Click',
  '点击确定': 'On Confirm (OK)',
  '确认': 'On Confirm',
  '取消': 'On Cancel',
  '关闭': 'On Close',
  '点击数据时（名称、数值、指标）': 'On Data Click (name, value, series)',
  '完成交互时': 'On Interaction Emit',
  '点击右上角时': 'On Header Extra Click',
  '点击任意磁贴时': 'On Tile Click',
  '点击左侧时': 'On Left Button Click',
  '点击标题切换器时': 'On Title Switcher Click',
  '点击右侧图标时': 'On Right Icon Click',
  '点击右侧筛选时': 'On Filter Click',
  '点击语音图标时': 'On Voice Click',
  '点击行动按钮时': 'On Action Click',
  '点击卡片或按钮时(注入当前行 row)': 'On Item Click (injects row)',
  '点击单据卡片时(注入当前行 row)': 'On Card Click (injects row)',
  '点击行时': 'On Row Click',
  '点击卡片时': 'On Card Click',
  '点击发送时': 'On Send',
  '点击加号附件时': 'On Attachment Click',
  '点击语音按钮时': 'On Voice Click',
  '值变更时': 'On Change',
  '确认选择后': 'On Selection Confirm',
  '切换选中时': 'On Toggle',
  '状态变化时': 'On State Change',
  '点击次要按钮时': 'On Secondary Click',
  '点击主按钮时': 'On Primary Click',
  '点击确认时': 'On Confirm',
};

const PROP_DESCRIPTION_MAP: Record<string, string> = {
  '字符串数组或 [{"label":"显示名","value":"实际值","disabled":false}]，value 保留原始类型。':
    'String array or [{"label":"Display","value":"val","disabled":false}]; preserves value type.',
  '字符串数组，或 [{"label":"显示名","value":"实际值","disabled":false}]；保留 value 原始类型。':
    'String array or [{"label":"Display","value":"val","disabled":false}]; preserves value type.',
  '树形数组：[{"label":"部门","value":"dept","children":[{"label":"小组","value":"team"}]}]；value 必须唯一。':
    'Tree array: [{"label":"Dept","value":"dept","children":[{"label":"Team","value":"team"}]}]; unique values.',
  '逗号分隔字符串（如 "大杯,中杯"）或 [{"label":"显示名","value":"实际值"}] 数组。':
    'Comma-separated string (e.g. "Large,Medium") or [{"label":"Display","value":"val"}] array.',
  '留空跟随父级 Form；horizontal=左右水平，vertical=上下垂直，inline=紧凑行内':
    'Follows parent Form when empty; horizontal, vertical, or compact inline.',
  '水平排列时标签文字左对齐或右对齐': 'Left or right label alignment in horizontal layout.',
  '水平布局时标签文字右对齐或左对齐': 'Right or left label alignment in horizontal layout.',
  '留空自动或跟随 Form': 'Auto-sized or inherited from parent Form when empty.',
  '限制查询输入框、下拉等控件的宽度，不包含标签；空间不足时自动缩小。':
    'Max width for query inputs/selects (excluding label); shrinks automatically in narrow containers.',
  '日期范围单独限宽，为起止日期保留更多空间。':
    'Separate max width for date range pickers.',
  '明细表只显示此外键精确引用当前行的记录。填写外键字段名（不是列 ID），来源为行操作打开的弹层或 navigate(页面ID,"row")；缺少来源时显示空表。':
    'Filters detail rows matching the current source row via this foreign key column name.',
  '填写明细表引用来源表的真实外键字段名（不是列 ID）。来源为行操作打开弹层时的当前行，或 navigate(页面ID,"row") 带入的来源行；按外键实际引用列的值与类型精确匹配，缺少来源时显示空列表。':
    'Foreign key column name referencing the source row from an overlay or navigate(pageId, "row").',
  'tree 模式用于匹配父值的唯一字段，默认使用工程记录 id。':
    'Unique key column matched by parentField in tree mode (defaults to record id).',
  'tree 必填，指向相同类型的节点值，根节点为 null。':
    'Required in tree mode; points to parent key value (null for root rows).',
  'expandable 使用，按顺序展示。省略时使用当前展示列。':
    'Fields shown in expanded row details; defaults to visible columns.',
  '数组，每项含有序 rowIds（记录 id）和 fields（展示列字段）。同页相邻时合并，左上角显示其值。':
    'Array of { rowIds, fields } regions merged when adjacent on the current page.',
  '如 { status: "pending" }': 'e.g. { status: "pending" }',
  'horizontal=标签在左，vertical=标签在上，inline=紧凑行内':
    'horizontal = left label, vertical = top label, inline = compact row.',
  'default=圆点单选，button=AntD 按钮式单选(Radio.Button)':
    'default = radio dots, button = segmented button group.',
  'button=标准上传按钮，dragger=拖拽上传大框，picture-card=照片墙方块':
    'button = standard button, dragger = dropzone, picture-card = thumbnail tile.',
  'sample=明确标注的示例；inline=自定义 data；table=工程已保存预览数据。不连接远程数据仓库。':
    'sample = built-in demo; inline = custom data; table = saved project preview rows.',
  '仅 table 来源使用真实 dbTables.id，不是物理表名。':
    'Project table ID (dbTables.id) when source is "table".',
  '仅 inline 来源使用，记录数组；不支持函数或动态表达式。':
    'Array of static data records used when source is "inline".',
  'inline/table 必填，对应原始记录的真实字段名。':
    'Required for inline/table; exact field name in source records.',
  'inline/table 必填，格式 [{field,label}]；数值或非空数字文本，不把空值当 0。柱/折线/面积/雷达支持多指标；散点恰好两个指标，依次 X、Y；其余恰好一个。':
    'Required for inline/table as [{ field, label }] pointing to numeric fields.',
  '第二个真实分类字段，不能与 dimension 相同。':
    'Secondary category field (must differ from dimension).',
  '默认逐条展示，重复分类会报错；只有明确指定 sum/average 才按分类求和/平均，保持首次出现顺序。':
    'None shows raw rows; sum/average aggregates duplicate categories.',
  'auto=自动跟随全局明暗主题，light=冷雾灰白现代风 (#F0F4F9)，dark=Gemini 曜石黑 (#131314)':
    'auto = follow workspace theme, light = mist light, dark = Gemini obsidian dark.',
  'gemini=蓝紫流光现代配色；支持按 C 端品牌或 B 端企业色切换':
    'gemini = blue-violet gradient accent, or choose a brand accent color.',
  'mist=无边框色阶呼吸底；pure=极简纯底':
    'mist = tonal layered background; pure = clean flat background.',
  'card=纯净浮起卡；subtle=柔和次级块；accent=主题浅底；glow=Gemini 流光渐变描边卡':
    'card = elevated card, subtle = muted block, accent = tinted surface, glow = gradient border.',
  'equal=等分圆角磁贴；featured=首张大卡跨列突出展示':
    'equal = uniform tiles; featured = first tile spans full row.',
  '类似 Gemini 顶部切换模型或切换门店/空间':
    'Shows a dropdown chevron in the title bar like a workspace/model switcher.',
  'floating=现代悬浮毛玻璃胶囊岛；docked=经典贴底通栏':
    'floating = floating frosted pill island; docked = full-width bottom bar.',
  '可选：选中胶囊时按 filterField 实时筛选目标移动列表':
    'Optional: filters the target mobile list by filterField when a pill is selected.',
  '点击筛选打开的 MBottomSheet id':
    'ID of the MBottomSheet opened when tapping the filter icon.',
  'waterfall=双列大圆角瀑布流；media=左图右文列表；showcase=单列沉浸大图卡':
    'waterfall = 2-column grid, media = thumbnail + text row, showcase = 1-column large card.',
  'action=并排双胶囊动作（如驳回/通过）；commerce=左侧价格合计+右侧购买胶囊':
    'action = dual action pills; commerce = left price summary + right CTA pill.',
};

const EN_COMPONENT_SNIPPETS: Record<string, string> = {
  Freeform: `<Freeform title="Freeform Widget" height={260} source={"export default function Component() {\\n  return <section className=\\"welcome\\"><span className=\\"mark\\">✦</span><h3>Bring Any Idea to Life</h3><p>Select this block and describe what you want AI to build.</p><div className=\\"ideas\\"><span>Interactive Seat Map</span><span>Visual Flow</span><span>Custom Showcase</span></div></section>;\\n}"} css={":root{background:transparent;color-scheme:var(--pf-color-scheme)}.welcome{min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;background:var(--pf-bg-layout,#f8fafc);border:1px dashed var(--pf-border,#cbd5e1);border-radius:16px;color:var(--pf-text,#334155)}.mark{font-size:32px;color:#6366f1}.welcome h3{font-size:19px;margin:12px 0 0}.welcome p{font-size:13px;color:var(--pf-text-secondary,#64748b);line-height:1.7}.ideas{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:8px}.ideas span{padding:5px 10px;border:1px solid var(--pf-border-secondary,#e2e8f0);border-radius:20px;font-size:11px;background:var(--pf-bg-container,white)}"} />`,
  Page: '<Page title="New Page" />',
  Card: '<Card title="Card Title" />',
  Row: '<Row gutter={16}><Col span={12} /><Col span={12} /></Row>',
  Col: '<Col span={12} />',
  Space: '<Space />',
  Tabs: '<Tabs><Tab title="Tab 1" /><Tab title="Tab 2" /></Tabs>',
  Tab: '<Tab title="New Tab" />',
  Divider: '<Divider />',
  Steps: "<Steps items={['Details', 'Approval', 'Done']} current={0} />",
  PageHeader: '<PageHeader title="Page Title" />',
  Breadcrumb: "<Breadcrumb items={['Home', 'Module', 'Current Page']} />",
  Pagination: '<Pagination total={100} pageSize={10} />',
  QueryForm: "<QueryForm fields={[{ name: 'keyword', label: 'Keyword' }, { name: 'status', label: 'Status', type: 'select', options: [{ label: 'All', value: '' }, { label: 'Enabled', value: '启用' }, { label: 'Disabled', value: '停用' }] }]} />",
  SearchInput: '<SearchInput placeholder="Search..." />',
  Table: "<Table table=\"\" rowActions={[{ label: 'View' }, { label: 'Edit' }, { label: 'Delete', danger: true }]} />",
  Descriptions: '<Descriptions title="Basic Info" column={2} />',
  Statistic: '<Statistic title="Pending" value="12" suffix="items" />',
  Tag: '<Tag color="blue">Tag</Tag>',
  Timeline: "<Timeline items={[{ title: 'Submitted', time: '2026-10-28 09:00', status: 'done' }, { title: 'Dept Review', time: '', status: 'current' }]} />",
  Text: '<Text>Sample paragraph text</Text>',
  Title: '<Title level={3}>Section Title</Title>',
  Empty: '<Empty description="No data" />',
  Form: '<Form cols={2} layout="horizontal" />',
  Input: '<Input label="Name" name="name" />',
  NumberInput: '<NumberInput label="Amount" name="amount" prefix="¥" precision={2} />',
  Textarea: '<Textarea label="Notes" name="remark" span={2} />',
  Select: "<Select label=\"Status\" name=\"status\" options={[{ label: 'Enabled', value: '启用' }, { label: 'Disabled', value: '停用' }]} />",
  DatePicker: '<DatePicker label="Date" name="date" />',
  DateRange: '<DateRange label="Date Range" name="date_range" />',
  Radio: "<Radio label=\"Type\" name=\"type\" options={[{ label: 'Type A', value: '类型一' }, { label: 'Type B', value: '类型二' }]} />",
  Checkbox: "<Checkbox label=\"Tags\" name=\"tags\" options={['A', 'B', 'C']} />",
  Switch: '<Switch label="Enabled" name="enabled" />',
  Upload: '<Upload label="Attachment" name="attachments" />',
  PickerInput: '<PickerInput label="Select Supplier" name="supplier_id" overlay="" />',
  Button: '<Button type="primary">Button</Button>',
  Toolbar: '<Toolbar><Button type="primary" icon="plus">New</Button><Button>Export</Button></Toolbar>',
  Modal: '<Modal id="modal-new" title="New Modal" />',
  Drawer: '<Drawer id="drawer-new" title="New Drawer" />',
  Alert: '<Alert type="info" message="Helpful notice" />',
  Result: '<Result status="success" title="Submitted Successfully" />',
  Flex: '<Flex gap={12}><Button>Action 1</Button><Button>Action 2</Button></Flex>',
  Collapse: '<Collapse><CollapsePanel title="Basic Info"><Text>Panel content</Text></CollapsePanel><CollapsePanel title="More Info" /></Collapse>',
  CollapsePanel: '<CollapsePanel title="New Panel" />',
  Avatar: '<Avatar size={40}>U</Avatar>',
  Badge: '<Badge count={5}><Avatar>U</Avatar></Badge>',
  Progress: '<Progress percent={65} />',
  Image: '<Image alt="Image" imageWidth={240} />',
  Skeleton: '<Skeleton active rows={3}><Text>Loaded content</Text></Skeleton>',
  Spin: '<Spin tip="Loading..."><Text>Content area</Text></Spin>',
  Tooltip: '<Tooltip title="Helpful tip"><Button>Hover for tip</Button></Tooltip>',
  Popover: '<Popover title="Details" content="Enter detailed description here"><Button>View Details</Button></Popover>',
  Popconfirm: '<Popconfirm title="Confirm this action?"><Button>Run Action</Button></Popconfirm>',
  TimePicker: '<TimePicker label="Time" name="time" />',
  Slider: '<Slider label="Progress" name="progress" min={0} max={100} />',
  Rate: '<Rate label="Rating" name="rating" allowHalf />',
  Cascader: '<Cascader label="Region" name="region" options={[{label:"Zhejiang",value:"zhejiang",children:[{label:"Hangzhou",value:"hangzhou"}]}]} />',
  TreeSelect: '<TreeSelect label="Department" name="department" options={[{label:"Engineering",value:"engineering",children:[{label:"Frontend",value:"frontend"},{label:"Backend",value:"backend"}]}]} />',
  AutoComplete: '<AutoComplete label="Suggestion" name="suggestion" options={[{label:"Option 1",value:"选项一"},{label:"Option 2",value:"选项二"}]} />',
  Segmented: '<Segmented label="View" name="view" options={[{label:"List",value:"列表"},{label:"Board",value:"看板"},{label:"Calendar",value:"日历"}]} />',
  BarChart: '<BarChart title="Bar Chart" source="sample" height={320} />',
  LineChart: '<LineChart title="Line Chart" source="sample" height={320} />',
  AreaChart: '<AreaChart title="Area Chart" source="sample" height={320} />',
  PieChart: '<PieChart title="Pie Chart" source="sample" height={320} />',
  DonutChart: '<DonutChart title="Donut Chart" source="sample" height={320} />',
  ScatterChart: '<ScatterChart title="Scatter Chart" source="sample" height={320} />',
  RadarChart: '<RadarChart title="Radar Chart" source="sample" height={320} />',
  GaugeChart: '<GaugeChart title="Gauge Chart" source="sample" height={320} />',
  FunnelChart: '<FunnelChart title="Funnel Chart" source="sample" height={320} />',
  HeatmapChart: '<HeatmapChart title="Heatmap Chart" source="sample" height={320} />',
  TreemapChart: '<TreemapChart title="Treemap Chart" source="sample" height={320} />',
  SankeyChart: '<SankeyChart title="Sankey Chart" source="sample" height={320} />',
  MobilePage: '<MobilePage title="Mobile Page" accent="gemini" />',
  MSurface: '<MSurface title="Key Summary" extra="View All" tone="card" />',
  MBentoGrid: `<MBentoGrid cols={2} layout="equal" items={[
  { title: 'AI Insights', subtitle: 'Daily operational highlights', icon: 'Sparkles', badge: 'AI', tone: 'violet' },
  { title: 'Quick Actions', subtitle: '4 pending approvals', icon: 'Zap', tone: 'blue' },
  { title: 'Featured', subtitle: 'Curated items & services', icon: 'Compass', tone: 'emerald' },
  { title: 'Analytics', subtitle: 'Live conversion trends', icon: 'TrendingUp', tone: 'card' }
]} />`,
  MScrollRow: '<MScrollRow title="Recommended" gap={12}><MSurface title="Featured Collection A" subtitle="High-converting card" /><MSurface title="Featured Collection B" subtitle="Swipe horizontally" /></MScrollRow>',
  MTopBar: '<MTopBar title="Gemini Workspace" leftMode="menu" titleDropdown={true} rightIcon="avatar" />',
  MTabBar: `<MTabBar variant="floating" activeKey="home" items={[
  { key: 'home', title: 'Explore', icon: 'Sparkles' },
  { key: 'tasks', title: 'Tasks', icon: 'Layers', badge: '3' },
  { key: 'mine', title: 'Profile', icon: 'User' }
]} />`,
  MPillTabs: `<MPillTabs variant="pill" items={[
  { title: 'All', value: '' },
  { title: 'In Progress', value: '待审批', badge: '4' },
  { title: 'Completed', value: '已通过' }
]} />`,
  MTab: '<MTab title="New Tab" />',
  MSearchPill: '<MSearchPill placeholder="Search orders, items, or keywords..." showFilter={true} />',
  MHeroHeader: '<MHeroHeader mode="greeting" eyebrow="AI-Powered Workspace" title="Hello, Alex" subtitle="Everything is ready for a productive day" />',
  MFeedList: `<MFeedList layout="waterfall" actionText="View" items={[
  { title: 'Wireless ANC Earbuds Pro', subtitle: 'Spatial Audio · 40h Battery', price: '¥199', tag: 'New' },
  { title: 'Cloud Smart AI Notebook', subtitle: 'Live Voice-to-Notes', price: '¥349', tag: 'Popular' },
  { title: '3-in-1 MagSafe Charger', subtitle: 'Foldable Travel Design', price: '¥59', tag: 'Award' },
  { title: 'Titanium Thermal Tumbler', subtitle: 'Ultralight · Smart Display', price: '¥45', tag: 'Top Rated' }
]} />`,
  MTaskList: `<MTaskList items={[
  { title: 'Annual Cloud Capacity Expansion', status: 'Pending', summary: 'Dept: AI Platform · Vendor: CloudCore Inc.', meta: '¥128,000 · 10m ago' },
  { title: 'East Hub Smart Hardware Acceptance', status: 'Approved', summary: 'Inspector: Alex Lin · 12 standard items', meta: '¥64,500 · Today 09:30' }
]} />`,
  MListGroup: `<MListGroup title="Preferences & Services" items={[
  { title: 'Saved Collections', description: 'Synced 2 mins ago', value: '18', icon: 'Bookmark', arrow: true },
  { title: 'Notification Preferences', value: 'Priority Only', icon: 'Bell', arrow: true },
  { title: 'Privacy & Security', value: 'Protected', icon: 'Shield', arrow: true }
]} />`,
  MListItem: '<MListItem title="Account & Multi-Device Sync" value="Enabled" arrow={true} />',
  MStatCard: '<MStatCard title="Active Conversions" value="12,840" trend="+18.2%" trendTone="up" sparkline={true} />',
  MChatStream: `<MChatStream assistantName="Gemini" messages={[
  { role: 'user', title: 'Summarize the top causes of delayed orders this week' },
  { role: 'assistant', title: 'Analyzed 42 delayed shipments: primarily driven by cold-chain schedule shifts and supplier batch re-checks.', highlight: 'Prioritize 3 high-priority PO approvals to restore a 96% on-time delivery rate.' }
]} />`,
  MComposerBar: '<MComposerBar placeholder="Ask Gemini..." suggestions="Daily brief,Flag risky orders,Compare quotes" docked={true} />',
  MForm: `<MForm title="Basic Details"><MField label="Name" name="name" placeholder="Enter name" required={true} /><MChipSelect label="Category" name="category" options={[{ label: 'Standard', value: '标准项' }, { label: 'Express', value: '加急项' }, { label: 'VIP', value: 'VIP专属' }]} /></MForm>`,
  MField: '<MField label="Title" name="name" placeholder="Enter text..." />',
  MSheetPicker: `<MSheetPicker label="Category" name="category" options={[{ label: 'Hardware', value: '智能硬件' }, { label: 'Enterprise SaaS', value: '企业服务' }, { label: 'Subscription', value: '数字订阅' }]} placeholder="Tap to select" />`,
  MChipSelect: `<MChipSelect label="Select Plan" name="spec" options={[{ label: 'Standard', value: '标准版' }, { label: 'Pro Edition', value: 'Pro 进阶版' }, { label: 'Enterprise', value: '旗舰套装' }]} />`,
  MMediaInput: '<MMediaInput label="Smart Alerts" name="notify_enabled" variant="switch" description="Push real-time status updates to your phone" />',
  MButton: '<MButton variant="primary" block={true}>Continue</MButton>',
  MBottomDock: '<MBottomDock mode="action" secondaryText="Save Draft" primaryText="Submit" />',
  MBottomSheet: '<MBottomSheet id="sheet-detail" title="Details" size="medium"><MListGroup items={[{ title: "Status", value: "Normal" }]} /></MBottomSheet>',
  MDialog: '<MDialog id="dlg-confirm" title="Confirm this action?" description="Submitting will update related records." confirmText="Confirm" />',
  OutlineTree: '<OutlineTree width={180} height={100}><TreeItem text="Directory" /></OutlineTree>',
  TreeItem: '<TreeItem text="Node" />',
  DynamicPanel: '<DynamicPanel width={120} height={40} activeState={1}><PanelState label="Initial State" /></DynamicPanel>',
  PanelState: '<PanelState label="State" />',
  StaticTable: '<StaticTable width={100} height={32} columnWidths={[100]} rowHeights={[32]}><StaticTableCell text="Cell" /></StaticTable>',
  StaticTableCell: '<StaticTableCell text="Cell" />',
  AxureWidget: '<AxureWidget kind="shape" text="Text" width={100} height={30} />',
};

const SNIPPET_PHRASE_MAP: [string, string][] = [
  ['确认执行此操作？', 'Confirm this action?'],
  ['确认执行操作？', 'Confirm this action?'],
  ['在这里填写详细说明', 'Enter detailed description here'],
  ['悬停查看提示', 'Hover for tip'],
  ['加载完成的内容', 'Loaded content'],
  ['这是一段文本', 'Sample paragraph text'],
  ['全部,启用,停用', 'All,Enabled,Disabled'],
  ['全部,待审批,已通过,已驳回,已归档', 'All,Pending,Approved,Rejected,Archived'],
  ['标准项,加急项,VIP专属', 'Standard,Express,VIP'],
  ['标准版,Pro 进阶版,旗舰套装', 'Standard,Pro Edition,Enterprise'],
  ['请输入内容...', 'Enter text...'],
  ['请输入名称...', 'Enter name...'],
  ['请输入名称', 'Enter name'],
  ['请输入备注...', 'Enter notes...'],
  ['请输入...', 'Enter...'],
  ['点击选择分类', 'Tap to select'],
  ['点击选择', 'Tap to select'],
  ['选择供应商', 'Select Supplier'],
  ['输入建议', 'Suggestion'],
  ['确认提交', 'Submit'],
  ['立即继续', 'Continue'],
  ['提交成功', 'Submitted Successfully'],
  ['提交申请', 'Submitted'],
  ['部门审批', 'Dept Review'],
  ['页面标题', 'Page Title'],
  ['卡片标题', 'Card Title'],
  ['区块标题', 'Section Title'],
  ['面板内容', 'Panel content'],
  ['内容区域', 'Content area'],
  ['补充说明', 'Notes'],
  ['详细信息', 'Details'],
  ['查看详情', 'View Details'],
  ['执行操作', 'Run Action'],
  ['基本信息', 'Basic Info'],
  ['基础信息', 'Basic Info'],
  ['更多信息', 'More Info'],
  ['暂无数据', 'No data'],
  ['填写信息', 'Details'],
  ['当前页', 'Current Page'],
  ['日期范围', 'Date Range'],
  ['页签一', 'Tab 1'],
  ['页签二', 'Tab 2'],
  ['新页签', 'New Tab'],
  ['新页面', 'New Page'],
  ['新面板', 'New Panel'],
  ['新弹框', 'New Modal'],
  ['新抽屉', 'New Drawer'],
  ['按钮一', 'Action 1'],
  ['按钮二', 'Action 2'],
  ['选项一', 'Option 1'],
  ['选项二', 'Option 2'],
  ['类型一', 'Type A'],
  ['类型二', 'Type B'],
  ['提示信息', 'Helpful notice'],
  ['自由组件', 'Freeform Widget'],
  ['加载中', 'Loading...'],
  ['待审批', 'Pending'],
  ['已通过', 'Approved'],
  ['已驳回', 'Rejected'],
  ['待处理', 'Pending'],
  ['进行中', 'In Progress'],
  ['已完成', 'Completed'],
  ['搜索...', 'Search...'],
  ['关键字', 'Keyword'],
  ['状态', 'Status'],
  ['启用', 'Enabled'],
  ['停用', 'Disabled'],
  ['查询', 'Search'],
  ['重置', 'Reset'],
  ['新建', 'New'],
  ['新增', 'New'],
  ['导出', 'Export'],
  ['提交', 'Submit'],
  ['取消', 'Cancel'],
  ['确定', 'OK'],
  ['确认', 'Confirm'],
  ['暂存', 'Save Draft'],
  ['编辑', 'Edit'],
  ['删除', 'Delete'],
  ['查看', 'View'],
  ['详情', 'Details'],
  ['审批', 'Review'],
  ['完成', 'Done'],
  ['首页', 'Home'],
  ['模块', 'Module'],
  ['名称', 'Name'],
  ['金额', 'Amount'],
  ['备注', 'Notes'],
  ['日期', 'Date'],
  ['时间', 'Time'],
  ['进度', 'Progress'],
  ['评分', 'Rating'],
  ['地区', 'Region'],
  ['部门', 'Department'],
  ['视图', 'View'],
  ['列表', 'List'],
  ['看板', 'Board'],
  ['日历', 'Calendar'],
  ['类型', 'Type'],
  ['标签', 'Tag'],
  ['附件', 'Attachment'],
  ['按钮', 'Button'],
  ['图片', 'Image'],
  ['标题', 'Title'],
  ['全部', 'All'],
  ['正常', 'Normal'],
];

const PROTECTED_JSX_ATTRS = new Set([
  'id',
  'pfId',
  'table',
  'name',
  'type',
  'mode',
  'variant',
  'size',
  'align',
  'layout',
  'direction',
  'color',
  'tone',
  'accent',
  'surfaceBg',
  'appearance',
  'icon',
  'leftMode',
  'rightIcon',
  'source',
  'css',
  'picker',
  'format',
  'placement',
  'trigger',
  'shape',
  'objectFit',
  'strokeLinecap',
  'expandTrigger',
  'expandIconPosition',
  'tabPosition',
  'selectionType',
  'rowMode',
  'headerBg',
  'bg',
  'padding',
  'valueColor',
  'trend',
  'trendTone',
  'optionType',
  'buttonStyle',
  'listType',
  'target',
  'overlay',
  'filterOverlay',
  'activeKey',
  'labelAlign',
  'labelLayout',
  'orientation',
  'separator',
  'inputType',
  'titleField',
  'subtitleField',
  'priceField',
  'tagField',
  'statusField',
  'labelField',
  'valueField',
  'filterField',
  'treeKeyField',
  'parentField',
  'sourceForeignKey',
  'value',
  'defaultValue',
  'initialValue',
]);

let rawSnippetMapCache: Map<string, string> | null = null;
function getRawToEnSnippetMap(): Map<string, string> {
  if (rawSnippetMapCache) return rawSnippetMapCache;
  const map = new Map<string, string>();
  for (const comp of [...COMPONENTS, ...MOBILE_COMPONENTS]) {
    const enSnippet = EN_COMPONENT_SNIPPETS[comp.name];
    if (enSnippet && comp.snippet) {
      map.set(comp.snippet, enSnippet);
    }
  }
  rawSnippetMapCache = map;
  return map;
}

function humanizeIdentifier(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function translateDisplayString(raw: string): string {
  if (!containsCjk(raw)) return raw;
  let out = raw;
  for (const [zh, en] of SNIPPET_PHRASE_MAP) {
    if (out === zh) return en;
    if (out.includes(zh)) {
      out = out.split(zh).join(en);
    }
  }
  return out;
}

export function localizeMaterialSnippet(snippet: string, explicitLocale?: Locale): string {
  const active = explicitLocale ?? getLocale();
  if (active !== 'en-US' || !snippet) return snippet;

  if (snippet.startsWith('<Freeform ')) {
    return snippet.replace('title="自由组件"', 'title="Freeform Widget"');
  }

  for (const [, enSnippet] of Object.entries(EN_COMPONENT_SNIPPETS)) {
    if (snippet === enSnippet) return snippet;
  }
  const exactMapped = getRawToEnSnippetMap().get(snippet);
  if (exactMapped) return exactMapped;

  if (!containsCjk(snippet)) return snippet;

  // Replace JSX text children between > and <, plus quoted string literals that do not belong to protected enum/ID/value keys.
  const withJsxText = snippet.replace(/>([^<>{}]+)</g, (full, textContent: string) => {
    if (!containsCjk(textContent)) return full;
    const leading = textContent.match(/^\s*/)?.[0] ?? '';
    const trailing = textContent.match(/\s*$/)?.[0] ?? '';
    const core = textContent.trim();
    return `>${leading}${translateDisplayString(core)}${trailing}<`;
  });

  return withJsxText.replace(
    /(?:(\b[A-Za-z_][A-Za-z0-9_]*)\s*([:=])\s*)?(["'])((?:\\.|(?!\3)[^\\])*)\3/g,
    (full, keyName: string | undefined, sep: string | undefined, quote: string, inner: string) => {
      if (keyName && PROTECTED_JSX_ATTRS.has(keyName)) return full;
      if (!containsCjk(inner)) return full;
      const translated = translateDisplayString(inner);
      return keyName ? `${keyName}${sep === ':' ? ': ' : '='}${quote}${translated}${quote}` : `${quote}${translated}${quote}`;
    },
  );
}

function localizeListFieldSpec(field: ListFieldSpec): ListFieldSpec {
  const mapped = LIST_FIELD_LABEL_MAP[field.label] ?? PROP_LABEL_MAP[field.label];
  const label = mapped ?? (containsCjk(field.label) ? humanizeIdentifier(field.name) : field.label);
  return label === field.label ? field : { ...field, label };
}

export function localizePropSpec(prop: PropSpec, explicitLocale?: Locale): PropSpec {
  const active = explicitLocale ?? getLocale();
  if (active !== 'en-US') return prop;

  const mappedLabel = PROP_LABEL_MAP[prop.label];
  const label = mappedLabel ?? (containsCjk(prop.label) ? humanizeIdentifier(prop.name) : prop.label);
  const description = prop.description
    ? PROP_DESCRIPTION_MAP[prop.description] ??
      (containsCjk(prop.description) ? undefined : prop.description)
    : undefined;
  const itemFields = prop.itemFields?.map(localizeListFieldSpec);

  return {
    ...prop,
    label,
    ...(description !== undefined ? { description } : { description: undefined }),
    ...(itemFields ? { itemFields } : {}),
  };
}

export function localizeEventSpec(ev: EventSpec, explicitLocale?: Locale): EventSpec {
  const active = explicitLocale ?? getLocale();
  if (active !== 'en-US') return ev;
  const label =
    EVENT_LABEL_MAP[ev.label] ??
    (containsCjk(ev.label) ? humanizeIdentifier(ev.name) : ev.label);
  return label === ev.label ? ev : { ...ev, label };
}

const metaCacheEn = new WeakMap<ComponentMeta, ComponentMeta>();

export function localizeComponentMeta(meta: ComponentMeta, explicitLocale?: Locale): ComponentMeta {
  const active = explicitLocale ?? getLocale();
  if (active !== 'en-US') return meta;

  const cached = metaCacheEn.get(meta);
  if (cached) return cached;

  const entry = EN_COMPONENT_META[meta.name];
  const title = entry?.title ?? (containsCjk(meta.title) ? humanizeIdentifier(meta.name) : meta.title);
  const description =
    entry?.description ??
    (containsCjk(meta.description) ? `${title} (${meta.name}) component.` : meta.description);
  const snippet =
    EN_COMPONENT_SNIPPETS[meta.name] ?? localizeMaterialSnippet(meta.snippet, 'en-US');

  const localized: ComponentMeta = {
    ...meta,
    title,
    description,
    props: meta.props.map((p) => localizePropSpec(p, 'en-US')),
    ...(meta.events ? { events: meta.events.map((e) => localizeEventSpec(e, 'en-US')) } : {}),
    snippet,
  };
  metaCacheEn.set(meta, localized);
  return localized;
}

export function localizeCategoryLabel(cat: ComponentCategory, explicitLocale?: Locale): string {
  const active = explicitLocale ?? getLocale();
  return active === 'en-US' ? EN_CATEGORY_LABELS[cat] ?? cat : ZH_CATEGORY_LABELS[cat] ?? cat;
}

export function localizeCategoryShortLabel(cat: ComponentCategory, explicitLocale?: Locale): string {
  const active = explicitLocale ?? getLocale();
  return active === 'en-US'
    ? EN_CATEGORY_SHORT_LABELS[cat] ?? cat
    : ZH_CATEGORY_SHORT_LABELS[cat] ?? cat;
}

export function localizeCompositeCategoryLabel(
  cat: CompositeCategory,
  explicitLocale?: Locale,
): string {
  const active = explicitLocale ?? getLocale();
  return active === 'en-US'
    ? EN_COMPOSITE_CATEGORY_LABELS[cat] ?? cat
    : ZH_COMPOSITE_CATEGORY_LABELS[cat] ?? cat;
}

const BUILTIN_COMPOSITE_EN: Record<string, { title: string; description: string; tsxSnippet: string }> = {
  blk_builtin_doc_header: {
    title: 'Standard 3-Column Document Header',
    description: 'SaaS/ERP document header card with Order No., Business Date, Supplier, Department, Tax Rate, and Notes in a 3-column grid.',
    tsxSnippet: `<Card title="Document Header (3-Column)" cols={3} extra="Supports physical master table binding">
  <Input label="Document No." name="order_no" defaultValue="DOC-20261028-001" disabled={true} width="1/3" />
  <DatePicker label="Business Date" name="biz_date" required={true} width="1/3" />
  <Select label="Supplier" name="supplier_id" table="t_base_supplier" labelField="supplier_name" valueField="id" required={true} allowClear={true} showSearch={true} width="1/3" />
  <Select label="Department" name="dept_name" options={[{ label: 'E-Commerce Ops', value: '电商运营部' }, { label: 'Smart Supply Chain', value: '智能供应链部' }, { label: 'Warehouse & Logistics', value: '仓储物流部' }, { label: 'Finance', value: '财务结算部' }]} defaultValue="电商运营部" width="1/3" />
  <InputNumber label="VAT Rate (%)" name="tax_rate" defaultValue={13} min={0} max={100} addonAfter="%" width="1/3" />
  <Input label="Summary Notes" name="remark" placeholder="Enter business context or special instructions..." allowClear={true} width="1/3" />
</Card>`,
  },
  blk_builtin_query_bar: {
    title: 'Multi-Field List Query Bar',
    description: 'Standard filter bar with keyword search, workflow status dropdown, creation date range, and Search/Reset actions.',
    tsxSnippet: `<QueryForm cols={3} labelAlign="right" colon={true}>
  <Input label="Keyword" name="keyword" placeholder="Search by No. / Code / Name" allowClear={true} />
  <Select label="Status" name="status" options={[{ label: 'All', value: '' }, { label: 'Pending', value: '待审批' }, { label: 'Approved', value: '已通过' }, { label: 'Rejected', value: '已驳回' }, { label: 'Archived', value: '已归档' }]} allowClear={true} />
  <DateRangePicker label="Created Date" name="date_range" />
</QueryForm>`,
  },
  blk_builtin_detail_table: {
    title: 'Line-Item Table Block with Toolbar',
    description: 'Top action toolbar (Add Row, Excel Import, Export) paired with a striped, bordered, selectable line-item table and summary row.',
    tsxSnippet: `<Card title="Document Line Items" extra="Inline validation & auto summary">
  <Toolbar align="between">
    <Space>
      <Button type="primary" icon="Plus">Add Line</Button>
      <Button type="default" dashed={true}>Batch Import (Excel)</Button>
    </Space>
    <Space>
      <Tag color="blue">4 Over-Receipt Rules Active</Tag>
      <Button type="default" size="small">Export</Button>
    </Space>
  </Toolbar>
  <Table
    table="t_wms_acceptance_detail"
    rowKey="id"
    size="middle"
    striped={true}
    bordered={true}
    showSummary={true}
    selectionType="checkbox"
    pageSize={5}
    columns={[
      { key: 'material_code', title: 'Item Code', kind: 'text', sortable: true },
      { key: 'current_accept_qty', title: 'Accepted Qty', kind: 'number', align: 'right', sortable: true },
      { key: 'unit_price_tax_included', title: 'Unit Price (Incl. Tax)', kind: 'currency', align: 'right' },
      { key: 'unit_price_no_tax', title: 'Excl. Tax Price', kind: 'number', align: 'right' },
      { key: 'tax_amount', title: 'Tax Subtotal', kind: 'currency', align: 'right', sortable: true }
    ]}
  />
</Card>`,
  },
  blk_builtin_approval_block: {
    title: '2-Column Approval & Attachment Block',
    description: 'Approval workflow section with solid decision radio buttons, rollback step selector, review comments, and drag-and-drop attachment upload.',
    tsxSnippet: `<Card title="Approval Decision & Attachments" cols={2} extra="Workflow Sign-Off">
  <Radio label="Decision" name="audit_result" options={[{ label: 'Approve', value: '审核通过' }, { label: 'Conditional', value: '有条件通过' }, { label: 'Return', value: '退回补正' }, { label: 'Void', value: '作废冲销' }]} defaultValue="审核通过" optionType="button" buttonStyle="solid" required={true} width="1/2" />
  <Select label="Return Target Step" name="rollback_step" options={[{ label: 'Draft Revision', value: '原单草稿修改' }, { label: 'Re-sign PO', value: '采购订单重签' }, { label: 'Lab Re-inspection', value: '实验室复检' }]} placeholder="Required when returning" allowClear={true} width="1/2" />
  <Textarea label="Review Comments" name="audit_comment" rows={3} placeholder="Enter verification conclusion or revision instructions..." showCount={true} maxLength={200} required={true} width="full" />
  <Upload label="Inspection Report / Files" name="audit_files" listType="dragger" accept=".pdf,.jpg,.png,.xlsx" buttonText="Click or drag inspection files here to upload" width="full" />
</Card>`,
  },
  blk_builtin_mobile_hero_bento: {
    title: 'Gemini Hero Greeting & Bento Hub',
    description: 'Mobile hero section with iridescent greeting header, pill search bar, and 2×2 Bento quick-entry tiles.',
    tsxSnippet: `<MSurface title="Workspace Hub" tone="glow" padding="md">
  <MHeroHeader mode="greeting" eyebrow="AI-Powered Experience" title="Hello, Alex" subtitle="Start a query, review approvals, or explore services" />
  <MSearchPill placeholder="Search orders, services, or ask AI..." showFilter={true} />
  <MBentoGrid cols={2} layout="equal" items={[
    { title: 'AI Insights', subtitle: 'Daily priority digest', icon: 'Sparkles', badge: 'AI', tone: 'violet' },
    { title: 'Approvals', subtitle: '3 pending requests', icon: 'Layers', badge: '3', tone: 'blue' }
  ]} />
</MSurface>`,
  },
  blk_builtin_mobile_sheet_form: {
    title: 'Mobile Bottom-Sheet Touch Form',
    description: 'Gemini 28px rounded bottom sheet with filled inputs, pill chip selector, and docked confirmation bar.',
    tsxSnippet: `<MBottomSheet id="sheet-quick-action" title="Quick Entry & Confirm" subtitle="Supports live table write-back" size="medium">
  <MForm title="Basic Info">
    <MField label="Project Name" name="name" placeholder="Enter name..." required={true} />
    <MChipSelect label="Priority" name="priority" options={[{ label: 'Normal', value: '常规办理' }, { label: 'High Priority', value: '重点跟进' }, { label: 'Urgent', value: '加急优先' }]} />
    <MField label="Notes" name="remark" inputType="textarea" placeholder="Enter notes..." />
  </MForm>
  <MBottomDock mode="action" secondaryText="Cancel" primaryText="Submit" onSecondary={() => closeOverlay()} onPrimary={() => { toast('Submitted'); closeOverlay(); }} />
</MBottomSheet>`,
  },
};

export function localizeCompositeBlock(
  block: CustomCompositeBlock,
  explicitLocale?: Locale,
): CustomCompositeBlock {
  const active = explicitLocale ?? getLocale();
  if (active !== 'en-US') return block;
  const builtin = BUILTIN_COMPOSITE_EN[block.id];
  if (builtin) {
    return {
      ...block,
      title: builtin.title,
      description: builtin.description,
      tsxSnippet: builtin.tsxSnippet,
    };
  }
  return block;
}

const ACTION_EN_MAP: Record<string, { title: string; description: string; argLabels?: Record<string, string> }> = {
  openModal: {
    title: 'Open Modal',
    description: 'Open a Modal (or MDialog on mobile) defined in the page.',
    argLabels: { id: 'Modal ID', params: 'Params (JSON)' },
  },
  openDrawer: {
    title: 'Open Drawer',
    description: 'Open a Drawer (or MBottomSheet on mobile) defined in the page.',
    argLabels: { id: 'Drawer ID', params: 'Params (JSON)' },
  },
  closeOverlay: {
    title: 'Close Overlay',
    description: 'Close the topmost open modal or drawer.',
  },
  submitForm: {
    title: 'Submit Form',
    description: 'Validate required fields and write to the bound table; aborts chain on failure.',
    argLabels: { form: 'Form pfId' },
  },
  resetForm: {
    title: 'Reset Form',
    description: 'Clear form values and validation messages.',
    argLabels: { form: 'Form pfId' },
  },
  confirm: {
    title: 'Confirm Dialog',
    description: 'Prompt confirmation; aborts remaining actions if canceled.',
    argLabels: { message: 'Confirm message' },
  },
  toast: {
    title: 'Toast Notice',
    description: 'Show a brief toast notification.',
    argLabels: { message: 'Toast text', type: 'Type' },
  },
  refresh: {
    title: 'Refresh Table/List',
    description: 'Reload table or mobile list data and reset to page 1.',
    argLabels: { table: 'Table / List pfId' },
  },
  deleteRow: {
    title: 'Delete Current Row',
    description: 'Delete the current row in context.',
  },
  updateRow: {
    title: 'Update Row Fields',
    description: 'Patch fields on the current row, e.g. { "status": "Approved" }.',
    argLabels: { values: 'Field patch JSON' },
  },
  importPurchaseOrderLines: {
    title: 'Import PO Lines',
    description: 'Import selected confirmed PO lines into the saved acceptance order.',
    argLabels: { source: 'Source PO Table', target: 'Target Detail Table', form: 'Header Form' },
  },
  returnSelection: {
    title: 'Return Selection',
    description: 'Write selected table row(s) back to the triggering PickerInput and close modal.',
    argLabels: { table: 'Table pfId', labelField: 'Display field', valueField: 'Value field' },
  },
  switchTab: {
    title: 'Switch Tab',
    description: 'Switch Tabs, MPillTabs, or DynamicPanel by 0-based index.',
    argLabels: { tabs: 'Tabs pfId', index: 'Tab index (0-based)' },
  },
  navigate: {
    title: 'Navigate to Page',
    description: 'Navigate to another page in the sitemap.',
    argLabels: { page: 'Target pageId', source: 'Pass current row' },
  },
  setVar: {
    title: 'Set Variable',
    description: 'Set a page variable accessible via {{vars.name}}.',
    argLabels: { name: 'Variable name', value: 'Value' },
  },
  show: {
    title: 'Show Component',
    description: 'Show a hidden component.',
    argLabels: { target: 'Target pfId' },
  },
  hide: {
    title: 'Hide Component',
    description: 'Hide a component.',
    argLabels: { target: 'Target pfId' },
  },
};

export function localizeActionSpec(action: ActionSpec, explicitLocale?: Locale): ActionSpec {
  const active = explicitLocale ?? getLocale();
  if (active !== 'en-US') return action;
  const mapped = ACTION_EN_MAP[action.name];
  if (!mapped) return action;
  const args: ActionArgSpec[] = action.args.map((arg) => ({
    ...arg,
    label: mapped.argLabels?.[arg.name] ?? arg.label,
  }));
  return {
    ...action,
    title: mapped.title,
    description: mapped.description,
    args,
  };
}
