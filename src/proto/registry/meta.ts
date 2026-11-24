import { AXURE_MATERIALS } from '../axure/metadata';
import { FIGMA_MATERIALS } from '../figma/metadata';
import { createAntdMaterials, ANTD_EXTRA_PROPS, ANTD_INPUT_APPEARANCE } from './antdMeta';
import { MODERN_DESKTOP_MATERIALS } from './modernMeta';
import { CELL_EDITORS } from '../table/model';
import { FREEFORM_MATERIAL } from '../freeform/metadata';
import { CHART_MATERIALS } from '../charts/metadata';
import {
  MOBILE_COMPONENTS,
  MOBILE_COMPONENT_NAMES,
  MOBILE_FIELD_TYPES,
  MOBILE_OVERLAY_TYPES,
  UNIVERSAL_COMPONENT_NAMES,
} from '../mobile/meta';

/**
 * Alex component registry metadata.
 * Single source of truth for: the palette, the property panel, the validator,
 * and the component documentation fed to AI models.
 */

export type PropKind =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'table'
  | 'column'
  | 'overlay'
  | 'page'
  | 'nodeRef'
  | 'list'
  | 'json';

export interface ListFieldSpec {
  name: string;
  label: string;
  kind: 'string' | 'number' | 'boolean' | 'select' | 'actions' | 'column' | 'json';
  options?: string[];
}

export interface PropSpec {
  name: string;
  label: string;
  kind: PropKind;
  options?: string[];
  default?: unknown;
  required?: boolean;
  description?: string;
  /** For kind = 'list': shape of each item. Omit for string arrays. */
  itemFields?: ListFieldSpec[];
  /** For kind = 'nodeRef': which component types may be referenced */
  refTypes?: string[];
}

export interface EventSpec {
  name: string;
  label: string;
}

export type ComponentCategory =
  | 'layout'
  | 'navigation'
  | 'query'
  | 'data'
  | 'charts'
  | 'form'
  | 'action'
  | 'overlay';

export interface ComponentMeta {
  name: string;
  title: string;
  category: ComponentCategory;
  icon: string;
  description: string;
  /** Can contain child components */
  container?: boolean;
  /** Plain text children act as the label/content (e.g. Button, Text) */
  textChild?: boolean;
  /** Renders inline (Button, Tag) */
  inline?: boolean;
  /** Only valid as child of these components */
  parents?: string[];
  props: PropSpec[];
  events?: EventSpec[];
  /** Default TSX inserted when dragged from the palette */
  snippet: string;
  /** Runnable fragments returned with this material's detailed AI contract. */
  examples?: { title: string; tsx: string }[];
}

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  layout: '布局容器',
  navigation: '导航',
  query: '查询区',
  data: '数据展示',
  charts: '数据图表',
  form: '表单录入',
  action: '操作按钮',
  overlay: '弹层反馈',
};

const FIELD_ITEM: ListFieldSpec[] = [
  { name: 'name', label: '字段名', kind: 'column' },
  { name: 'label', label: '标签', kind: 'string' },
  {
    name: 'type',
    label: '类型',
    kind: 'select',
    options: ['input', 'number', 'textarea', 'select', 'date', 'dateRange', 'radio', 'checkbox', 'switch', 'upload', 'picker', 'time', 'slider', 'rate', 'cascader', 'treeSelect', 'autoComplete', 'segmented'],
  },
  { name: 'required', label: '必填', kind: 'boolean' },
  { name: 'options', label: '选项(逗号分隔)', kind: 'string' },
  { name: 'span', label: '占列', kind: 'number' },
];

const COLUMN_ITEM: ListFieldSpec[] = [
  { name: 'dataIndex', label: '字段', kind: 'column' },
  { name: 'title', label: '列名', kind: 'string' },
  { name: 'render', label: '展示', kind: 'select', options: ['text', 'tag', 'money', 'date', 'link'] },
  { name: 'align', label: '对齐', kind: 'select', options: ['left', 'center', 'right'] },
  { name: 'editor', label: '单元格编辑器', kind: 'select', options: Object.keys(CELL_EDITORS) },
  { name: 'editorOptions', label: '下拉选项', kind: 'json' },
  { name: 'mergeRows', label: '合并相邻同值行', kind: 'boolean' },
  { name: 'sortable', label: '排序', kind: 'boolean' },
  { name: 'width', label: '宽度', kind: 'number' },
];

const ROW_ACTION_ITEM: ListFieldSpec[] = [
  { name: 'label', label: '名称', kind: 'string' },
  { name: 'danger', label: '危险', kind: 'boolean' },
  { name: 'onClick', label: '点击动作', kind: 'actions' },
];

const OPTION_LIST: PropSpec = { name: 'options', label: '选项数据', kind: 'json', description: '字符串数组或 [{"label":"显示名","value":"实际值","disabled":false}]，value 保留原始类型。' };

const fieldBase: PropSpec[] = [
  { name: 'label', label: '标签文字', kind: 'string' },
  { name: 'name', label: '绑定字段', kind: 'column' },
  { name: 'placeholder', label: '占位提示', kind: 'string' },
  {
    name: 'labelLayout',
    label: '标签排列(layout)',
    kind: 'select',
    options: ['', 'horizontal', 'vertical', 'inline'],
    description: '留空跟随父级 Form；horizontal=左右水平，vertical=上下垂直，inline=紧凑行内',
  },
  {
    name: 'labelAlign',
    label: '标签对齐(labelAlign)',
    kind: 'select',
    options: ['', 'right', 'left'],
    description: '水平排列时标签文字左对齐或右对齐',
  },
  { name: 'labelWidth', label: '标签宽度(px)', kind: 'number', description: '留空自动或跟随 Form' },
  { name: 'colon', label: '显示冒号(:)', kind: 'boolean' },
  { name: 'required', label: '必填校验', kind: 'boolean' },
  { name: 'allowClear', label: '允许清空(allowClear)', kind: 'boolean' },
  { name: 'disabled', label: '禁用状态', kind: 'boolean' },
  { name: 'readOnly', label: '只读状态', kind: 'boolean' },
  { name: 'extra', label: '底部辅助说明(extra)', kind: 'string' },
  { name: 'span', label: '表单内占列(1-4)', kind: 'number' },
];

export const COMPONENTS: ComponentMeta[] = [
  // ───────────────────────── Layout ─────────────────────────
  {
    name: 'Page',
    title: '页面',
    category: 'layout',
    icon: 'LayoutTemplate',
    description: '页面根容器。弹框 Modal / 抽屉 Drawer 也定义在页面内，运行时按需打开。',
    container: true,
    props: [
      { name: 'title', label: '页面标题', kind: 'string' },
      { name: 'description', label: '页面说明', kind: 'text' },
      { name: 'padding', label: '页面边距', kind: 'select', options: ['default', 'compact', 'loose'], default: 'default' },
      { name: 'bg', label: '背景色', kind: 'select', options: ['slate', 'white', 'gray'], default: 'slate' },
    ],
    snippet: '<Page title="新页面" />',
  },
  {
    name: 'Card',
    title: '卡片',
    category: 'layout',
    icon: 'Square',
    description: '带标题的内容分组容器（AntD Card）。',
    container: true,
    props: [
      { name: 'title', label: '标题(title)', kind: 'string' },
      { name: 'extra', label: '右上角扩展(extra)', kind: 'string' },
      { name: 'size', label: '尺寸(size)', kind: 'select', options: ['default', 'small'], default: 'default' },
      { name: 'bordered', label: '显示边框(bordered)', kind: 'boolean', default: true },
      { name: 'hoverable', label: '悬停浮起(hoverable)', kind: 'boolean' },
      { name: 'headerBg', label: '头部底色', kind: 'select', options: ['gray', 'white', 'blue'], default: 'gray' },
      { name: 'cols', label: '内部默认列数(1-4)', kind: 'number', default: 1 },
    ],
    snippet: '<Card title="卡片标题" />',
  },
  {
    name: 'Row',
    title: '栅格行',
    category: 'layout',
    icon: 'Columns3',
    description: '24 栅格行（AntD Row），内部放 Col。',
    container: true,
    props: [
      { name: 'gutter', label: '列间距(gutter px)', kind: 'number', default: 16 },
      { name: 'align', label: '垂直对齐(align)', kind: 'select', options: ['top', 'middle', 'bottom'], default: 'top' },
    ],
    snippet: '<Row gutter={16}><Col span={12} /><Col span={12} /></Row>',
  },
  {
    name: 'Col',
    title: '栅格列',
    category: 'layout',
    icon: 'RectangleVertical',
    description: '栅格列（AntD Col），span 取值 1-24。',
    container: true,
    parents: ['Row'],
    props: [
      { name: 'span', label: '列占比(span 1-24)', kind: 'number', default: 12 },
    ],
    snippet: '<Col span={12} />',
  },
  {
    name: 'Space',
    title: '间距排列',
    category: 'layout',
    icon: 'AlignHorizontalSpaceAround',
    description: '把子元素横向或纵向等距排列（AntD Space）。',
    container: true,
    props: [
      { name: 'direction', label: '方向(direction)', kind: 'select', options: ['horizontal', 'vertical'], default: 'horizontal' },
      { name: 'size', label: '间距大小(size)', kind: 'select', options: ['small', 'middle', 'large'], default: 'small' },
      { name: 'align', label: '主轴对齐(align)', kind: 'select', options: ['start', 'center', 'end', 'between'] },
      { name: 'wrap', label: '自动换行(wrap)', kind: 'boolean', default: true },
    ],
    snippet: '<Space />',
  },
  {
    name: 'Tabs',
    title: '页签',
    category: 'layout',
    icon: 'PanelsTopLeft',
    description: '页签容器（AntD Tabs），子元素为 Tab。可通过 switchTab 动作切换。',
    container: true,
    props: [
      { name: 'type', label: '页签样式(type)', kind: 'select', options: ['line', 'card', 'segmented'], default: 'line' },
      { name: 'tabPosition', label: '页签位置(tabPosition)', kind: 'select', options: ['top', 'left', 'bottom', 'right'], default: 'top' },
      { name: 'size', label: '尺寸(size)', kind: 'select', options: ['small', 'middle', 'large'], default: 'middle' },
      { name: 'centered', label: '标签居中(centered)', kind: 'boolean' },
    ],
    events: [{ name: 'onChange', label: '切换页签' }],
    snippet: '<Tabs><Tab title="页签一" /><Tab title="页签二" /></Tabs>',
  },
  {
    name: 'Tab',
    title: '页签项',
    category: 'layout',
    icon: 'PanelTop',
    description: 'Tabs 的子项（AntD TabPane）。',
    container: true,
    parents: ['Tabs'],
    props: [
      { name: 'title', label: '页签名', kind: 'string' },
      { name: 'badge', label: '角标数字(Badge)', kind: 'number' },
      { name: 'disabled', label: '禁用页签', kind: 'boolean' },
    ],
    snippet: '<Tab title="新页签" />',
  },
  {
    name: 'Divider',
    title: '分割线',
    category: 'layout',
    icon: 'Minus',
    description: '分割内容，可带文字（AntD Divider）。',
    props: [
      { name: 'text', label: '内嵌文字', kind: 'string' },
      { name: 'orientation', label: '文字位置(orientation)', kind: 'select', options: ['center', 'left', 'right'], default: 'center' },
      { name: 'dashed', label: '虚线样式(dashed)', kind: 'boolean' },
    ],
    snippet: '<Divider />',
  },
  {
    name: 'Steps',
    title: '步骤条',
    category: 'navigation',
    icon: 'ListOrdered',
    description: '展示流程进度（AntD Steps）。',
    props: [
      { name: 'items', label: '步骤列表', kind: 'list' },
      { name: 'current', label: '当前步骤(从0开始)', kind: 'number', default: 0 },
      { name: 'direction', label: '排列方向(direction)', kind: 'select', options: ['horizontal', 'vertical'], default: 'horizontal' },
      { name: 'size', label: '尺寸(size)', kind: 'select', options: ['default', 'small'], default: 'default' },
      { name: 'status', label: '当前状态(status)', kind: 'select', options: ['process', 'finish', 'wait', 'error'], default: 'process' },
    ],
    snippet: "<Steps items={['填写信息', '审批', '完成']} current={0} />",
  },

  // ───────────────────────── Navigation ─────────────────────────
  {
    name: 'PageHeader',
    title: '页头',
    category: 'navigation',
    icon: 'Heading',
    description: '页面标题栏，可带返回与面包屑（AntD PageHeader）。',
    container: true,
    props: [
      { name: 'title', label: '主标题(title)', kind: 'string' },
      { name: 'subTitle', label: '副标题(subTitle)', kind: 'string' },
      { name: 'tagText', label: '状态标签文字', kind: 'string' },
      { name: 'tagColor', label: '状态标签颜色', kind: 'select', options: ['blue', 'green', 'orange', 'red', 'default'] },
      { name: 'breadcrumb', label: '面包屑路径', kind: 'list' },
      { name: 'back', label: '显示返回箭头', kind: 'boolean' },
      { name: 'divider', label: '底部边线', kind: 'boolean' },
    ],
    events: [{ name: 'onBack', label: '点击返回' }],
    snippet: '<PageHeader title="页面标题" />',
  },
  {
    name: 'Breadcrumb',
    title: '面包屑',
    category: 'navigation',
    icon: 'ChevronsRight',
    description: '显示当前页面层级（AntD Breadcrumb）。',
    props: [
      { name: 'items', label: '层级列表', kind: 'list' },
      { name: 'separator', label: '分隔符(separator)', kind: 'select', options: ['>', '/', '·'], default: '>' },
    ],
    snippet: "<Breadcrumb items={['首页', '模块', '当前页']} />",
  },
  {
    name: 'Pagination',
    title: '分页器',
    category: 'navigation',
    icon: 'ChevronsLeftRight',
    description: '独立分页器（AntD Pagination）。',
    props: [
      { name: 'total', label: '总条数(total)', kind: 'number', default: 100 },
      { name: 'pageSize', label: '每页条数(pageSize)', kind: 'number', default: 10 },
      { name: 'size', label: '尺寸(size)', kind: 'select', options: ['default', 'small'], default: 'default' },
      { name: 'align', label: '对齐位置(align)', kind: 'select', options: ['right', 'center', 'left'], default: 'right' },
      { name: 'showTotal', label: '显示总条数', kind: 'boolean', default: true },
      { name: 'showSizeChanger', label: '显示每页条数切换', kind: 'boolean', default: true },
      { name: 'showQuickJumper', label: '显示快速跳页(跳至X页)', kind: 'boolean' },
    ],
    snippet: '<Pagination total={100} pageSize={10} />',
  },

  // ───────────────────────── Query ─────────────────────────
  {
    name: 'QueryForm',
    title: '查询表单',
    category: 'query',
    icon: 'SlidersHorizontal',
    description: '紧凑查询条件区（ProTable QueryFilter），自带查询/重置与展开收起。cols 是每行最大列数，窄容器自动换行；普通控件默认不超过 240px，日期范围不超过 320px。target 指向要过滤的 Table 的 pfId。',
    props: [
      { name: 'target', label: '过滤目标表格', kind: 'nodeRef', refTypes: ['Table', 'CardGrid'] },
      { name: 'fields', label: '查询条件', kind: 'list', itemFields: FIELD_ITEM.filter((p) => !['required', 'span'].includes(p.name)) },
      { name: 'cols', label: '每行最多列数(cols)', kind: 'number', default: 3 },
      { name: 'controlMaxWidth', label: '普通控件最大宽度(px)', kind: 'number', default: 240, description: '限制查询输入框、下拉等控件的宽度，不包含标签；空间不足时自动缩小。' },
      { name: 'rangeMaxWidth', label: '日期范围最大宽度(px)', kind: 'number', default: 320, description: '日期范围单独限宽，为起止日期保留更多空间。' },
      {
        name: 'layout',
        label: '标签排列(layout)',
        kind: 'select',
        options: ['horizontal', 'vertical'],
        default: 'horizontal',
      },
      {
        name: 'labelAlign',
        label: '标签文字对齐(labelAlign)',
        kind: 'select',
        options: ['right', 'left'],
        default: 'left',
      },
      { name: 'labelWidth', label: '标签宽度(留空自适应)', kind: 'number' },
      { name: 'colon', label: '显示冒号(:)', kind: 'boolean' },
      { name: 'size', label: '控件尺寸(size)', kind: 'select', options: ['small', 'middle', 'large'], default: 'middle' },
      { name: 'defaultExpanded', label: '默认展开全部条件', kind: 'boolean' },
      { name: 'searchText', label: '查询按钮文字', kind: 'string', default: '查询' },
      { name: 'resetText', label: '重置按钮文字', kind: 'string', default: '重置' },
    ],
    events: [{ name: 'onSearch', label: '点击查询' }],
    snippet: "<QueryForm fields={[{ name: 'keyword', label: '关键字' }, { name: 'status', label: '状态', type: 'select', options: [{ label: '全部', value: '' }, { label: '启用', value: '启用' }, { label: '停用', value: '停用' }] }]} />",
  },
  {
    name: 'SearchInput',
    title: '搜索框',
    category: 'query',
    icon: 'Search',
    description: '单个关键字搜索框（AntD Input.Search），target 指向 Table。',
    inline: true,
    props: [
      { name: 'placeholder', label: '占位提示', kind: 'string' },
      { name: 'target', label: '过滤目标表格', kind: 'nodeRef', refTypes: ['Table', 'CardGrid'] },
      { name: 'enterButton', label: '显示右侧搜索按钮', kind: 'boolean' },
      { name: 'allowClear', label: '允许清空', kind: 'boolean', default: true },
      { name: 'size', label: '尺寸(size)', kind: 'select', options: ['small', 'middle', 'large'], default: 'middle' },
    ],
    snippet: '<SearchInput placeholder="搜索..." />',
  },

  // ───────────────────────── Data ─────────────────────────
  {
    name: 'Table',
    title: '表格',
    category: 'data',
    icon: 'Table2',
    description:
      '数据表格（AntD Table）。绑定 table 后自动按表字段生成列并读写模拟数据；支持普通列表、树形层级、行内展开详情、合并行列、单元格编辑、分页与行操作。',
    props: [
      { name: 'table', label: '绑定物理表', kind: 'table' },
      { name: 'rowMode', label: '表格模式', kind: 'select', options: ['flat', 'tree', 'expandable'], default: 'flat' },
      { name: 'sourceForeignKey', label: '当前来源行的外键', kind: 'column', description: '明细表只显示此外键精确引用当前行的记录。填写外键字段名（不是列 ID），来源为行操作打开的弹层或 navigate(页面ID,"row")；缺少来源时显示空表。' },
      { name: 'treeKeyField', label: '节点字段', kind: 'column', description: 'tree 模式用于匹配父值的唯一字段，默认使用工程记录 id。' },
      { name: 'parentField', label: '父节点字段', kind: 'column', description: 'tree 必填，指向相同类型的节点值，根节点为 null。' },
      { name: 'detailFields', label: '展开详情字段', kind: 'list', description: 'expandable 使用，按顺序展示。省略时使用当前展示列。' },
      { name: 'defaultExpandAll', label: '默认展开全部', kind: 'boolean' },
      { name: 'cellMerges', label: '合并区域', kind: 'json', description: '数组，每项含有序 rowIds（记录 id）和 fields（展示列字段）。同页相邻时合并，左上角显示其值。' },
      { name: 'title', label: '表格顶部标题(title)', kind: 'string' },
      { name: 'columns', label: '列配置(留空自动)', kind: 'list', itemFields: COLUMN_ITEM },
      { name: 'rowActions', label: '行操作列', kind: 'list', itemFields: ROW_ACTION_ITEM },
      { name: 'filter', label: '固定过滤条件', kind: 'json', description: '如 { status: "pending" }' },
      { name: 'striped', label: '斑马纹(隔行变色 striped)', kind: 'boolean', default: false },
      { name: 'bordered', label: '单元格纵向边框(bordered)', kind: 'boolean', default: false },
      {
        name: 'size',
        label: '表格密度(size)',
        kind: 'select',
        options: ['small', 'middle', 'large'],
        default: 'middle',
      },
      { name: 'selectable', label: '启用行选择(rowSelection)', kind: 'boolean' },
      {
        name: 'selectionType',
        label: '选择框类型',
        kind: 'select',
        options: ['checkbox', 'radio'],
        default: 'checkbox',
      },
      { name: 'showIndex', label: '显示序号列', kind: 'boolean', default: true },
      { name: 'showHeader', label: '显示表头(showHeader)', kind: 'boolean', default: true },
      { name: 'pagination', label: '显示分页器(pagination)', kind: 'boolean', default: true },
      { name: 'pageSize', label: '每页条数(pageSize)', kind: 'number', default: 10 },
      { name: 'showSummary', label: '显示底部合计行(Summary)', kind: 'boolean' },
      { name: 'summaryText', label: '合计行说明文字', kind: 'string' },
      { name: 'emptyText', label: '空数据文案', kind: 'string', default: '暂无数据' },
    ],
    events: [{ name: 'onRowClick', label: '点击行' }],
    examples: [
      { title: '普通表 · 内置示例数据', tsx: '<Table pfId="sample-list" />' },
      { title: '树形表 · 示例 parentId 对应行 id', tsx: '<Table pfId="sample-tree" rowMode="tree" treeKeyField="id" parentField="parentId" defaultExpandAll />' },
      { title: '展开详情 · 查看本行备注和更新时间', tsx: '<Table pfId="sample-detail" rowMode="expandable" detailFields={["remark","updated"]} />' },
      { title: '合并行列 · 备注列按同值合并，示例行 s0 横向合并名称和状态', tsx: '<Table pfId="sample-merge" columns={[{dataIndex:"name",title:"名称"},{dataIndex:"status",title:"状态"},{dataIndex:"remark",title:"备注",mergeRows:true}]} cellMerges={[{rowIds:["s0"],fields:["name","status"]}]} />' },
      { title: '单元格编辑 · 六种编辑器及下拉选项的实际值', tsx: '<Table pfId="sample-edit" columns={[{dataIndex:"name",title:"名称",editor:"input"},{dataIndex:"remark",title:"备注",editor:"textarea"},{dataIndex:"quantity",title:"数量",editor:"number"},{dataIndex:"status",title:"审批状态",editor:"select",editorOptions:[{label:"通过",value:"已通过"},{label:"待审",value:"待审批"},{label:"草稿",value:"草稿"}]},{dataIndex:"updated",title:"日期",editor:"date"},{dataIndex:"enabled",title:"启用",editor:"switch"}]} />' },
    ],
    snippet: "<Table table=\"\" rowActions={[{ label: '查看' }, { label: '编辑' }, { label: '删除', danger: true }]} />",
  },
  {
    name: 'Descriptions',
    title: '描述列表',
    category: 'data',
    icon: 'FileText',
    description: '详情页字段展示（AntD Descriptions）。支持带边框表格态、水平/垂直排布与自定义列数。',
    props: [
      { name: 'title', label: '标题(title)', kind: 'string' },
      { name: 'extra', label: '右上角说明(extra)', kind: 'string' },
      { name: 'table', label: '绑定物理表', kind: 'table' },
      {
        name: 'items',
        label: '字段(留空自动)',
        kind: 'list',
        itemFields: [
          { name: 'label', label: '名称', kind: 'string' },
          { name: 'field', label: '字段', kind: 'column' },
          { name: 'value', label: '固定值', kind: 'string' },
        ],
      },
      { name: 'column', label: '每行列数(column)', kind: 'number', default: 2 },
      { name: 'bordered', label: '表格边框模式(bordered)', kind: 'boolean', default: false },
      {
        name: 'layout',
        label: '排列方向(layout)',
        kind: 'select',
        options: ['horizontal', 'vertical'],
        default: 'horizontal',
      },
      {
        name: 'size',
        label: '密度尺寸(size)',
        kind: 'select',
        options: ['small', 'middle', 'large'],
        default: 'middle',
      },
      { name: 'colon', label: '显示冒号(colon)', kind: 'boolean', default: true },
      { name: 'labelWidth', label: '标签列宽(px)', kind: 'number' },
    ],
    snippet: '<Descriptions title="基本信息" column={2} />',
  },
  {
    name: 'Statistic',
    title: '统计数值',
    category: 'data',
    icon: 'TrendingUp',
    description: '指标卡（AntD Statistic）。table 可选：自动统计条数。',
    props: [
      { name: 'title', label: '指标名(title)', kind: 'string' },
      { name: 'value', label: '数值(value)', kind: 'string' },
      { name: 'table', label: '统计物理表行数', kind: 'table' },
      { name: 'prefix', label: '前缀(prefix 如 ¥)', kind: 'string' },
      { name: 'suffix', label: '后缀单位(suffix)', kind: 'string' },
      { name: 'precision', label: '小数位数(precision)', kind: 'number' },
      { name: 'trend', label: '趋势箭头', kind: 'select', options: ['up', 'down', 'none'] },
      {
        name: 'valueColor',
        label: '数值颜色',
        kind: 'select',
        options: ['default', 'blue', 'green', 'orange', 'red'],
        default: 'default',
      },
      { name: 'bordered', label: '显示卡片边框', kind: 'boolean', default: true },
    ],
    snippet: '<Statistic title="待处理" value="12" suffix="单" />',
  },
  {
    name: 'Tag',
    title: '标签',
    category: 'data',
    icon: 'Tag',
    description: '状态或分类标签（AntD Tag）。',
    inline: true,
    textChild: true,
    props: [
      {
        name: 'color',
        label: '颜色(color)',
        kind: 'select',
        options: ['default', 'blue', 'green', 'orange', 'red', 'purple', 'cyan'],
      },
      { name: 'bordered', label: '显示边框(bordered)', kind: 'boolean', default: true },
      { name: 'round', label: '胶囊圆角', kind: 'boolean' },
      { name: 'closable', label: '可关闭(closable)', kind: 'boolean' },
    ],
    snippet: '<Tag color="blue">标签</Tag>',
  },
  {
    name: 'Timeline',
    title: '时间线',
    category: 'data',
    icon: 'GitCommitVertical',
    description: '审批记录、操作日志（AntD Timeline）。',
    props: [
      {
        name: 'items',
        label: '节点列表',
        kind: 'list',
        itemFields: [
          { name: 'title', label: '标题', kind: 'string' },
          { name: 'time', label: '时间', kind: 'string' },
          { name: 'status', label: '状态', kind: 'select', options: ['done', 'current', 'wait', 'error'] },
        ],
      },
      {
        name: 'mode',
        label: '排列模式(mode)',
        kind: 'select',
        options: ['left', 'alternate', 'right'],
        default: 'left',
      },
      { name: 'reverse', label: '倒序排列(reverse)', kind: 'boolean' },
    ],
    snippet: "<Timeline items={[{ title: '提交申请', time: '2026-10-28 09:00', status: 'done' }, { title: '部门审批', time: '', status: 'current' }]} />",
  },
  {
    name: 'Text',
    title: '文本',
    category: 'data',
    icon: 'Type',
    description: '段落文本（AntD Typography.Text），支持 {{row.字段}}、{{params.x}}、{{vars.x}} 模板变量。',
    textChild: true,
    props: [
      { name: 'type', label: '语义样式(type)', kind: 'select', options: ['default', 'secondary', 'success', 'warning', 'danger'] },
      { name: 'size', label: '字号大小', kind: 'select', options: ['xs', 'sm', 'base', 'lg'], default: 'sm' },
      { name: 'strong', label: '加粗(strong)', kind: 'boolean' },
      { name: 'italic', label: '斜体(italic)', kind: 'boolean' },
      { name: 'underline', label: '下划线(underline)', kind: 'boolean' },
      { name: 'delete', label: '删除线(delete)', kind: 'boolean' },
      { name: 'code', label: '代码框样式(code)', kind: 'boolean' },
      { name: 'copyable', label: '可复制图标(copyable)', kind: 'boolean' },
    ],
    snippet: '<Text>这是一段文本</Text>',
  },
  {
    name: 'Title',
    title: '标题',
    category: 'data',
    icon: 'Heading2',
    description: '区块标题（AntD Typography.Title）。',
    textChild: true,
    props: [
      { name: 'level', label: '标题级别(level 1-5)', kind: 'number', default: 3 },
      { name: 'align', label: '文字对齐', kind: 'select', options: ['left', 'center', 'right'], default: 'left' },
      { name: 'mark', label: '左侧蓝色竖条装饰', kind: 'boolean' },
    ],
    snippet: '<Title level={3}>区块标题</Title>',
  },
  {
    name: 'Empty',
    title: '空状态',
    category: 'data',
    icon: 'Inbox',
    description: '无数据占位（AntD Empty）。',
    props: [
      { name: 'description', label: '描述文案(description)', kind: 'string' },
      { name: 'size', label: '图标尺寸', kind: 'select', options: ['small', 'default', 'large'], default: 'default' },
    ],
    snippet: '<Empty description="暂无数据" />',
  },

  // ───────────────────────── Form ─────────────────────────
  {
    name: 'Form',
    title: '表单',
    category: 'form',
    icon: 'ClipboardList',
    description:
      '表单容器（AntD Form）。支持水平/垂直/行内标签排列、左右对齐、冒号开关、尺寸密度与整表只读。',
    container: true,
    props: [
      { name: 'table', label: '绑定物理表', kind: 'table' },
      { name: 'fields', label: '字段(无子组件时生效)', kind: 'list', itemFields: FIELD_ITEM },
      { name: 'cols', label: '每行列数(cols 1-4)', kind: 'number', default: 2 },
      {
        name: 'layout',
        label: '标签位置(layout)',
        kind: 'select',
        options: ['horizontal', 'vertical', 'inline'],
        description: 'horizontal=标签在左，vertical=标签在上，inline=紧凑行内',
      },
      {
        name: 'labelAlign',
        label: '标签对齐(labelAlign)',
        kind: 'select',
        options: ['right', 'left'],
        default: 'right',
        description: '水平布局时标签文字右对齐或左对齐',
      },
      { name: 'labelWidth', label: '标签宽度(labelWidth px)', kind: 'number', default: 96 },
      { name: 'colon', label: '显示标签冒号(colon)', kind: 'boolean', default: false },
      {
        name: 'size',
        label: '控件尺寸(size)',
        kind: 'select',
        options: ['small', 'middle', 'large'],
        default: 'middle',
      },
      { name: 'disabled', label: '整表禁用(disabled)', kind: 'boolean' },
    ],
    snippet: '<Form cols={2} layout="horizontal" />',
  },
  {
    name: 'Input',
    title: '输入框',
    category: 'form',
    icon: 'TextCursorInput',
    description: '单行文本输入（AntD Input）。',
    props: [
      ...fieldBase,
      { name: 'initialValue', label: '初始值', kind: 'string' },
      { name: 'prefix', label: '前缀文字(addonBefore/prefix)', kind: 'string' },
      { name: 'suffix', label: '后缀文字(addonAfter/suffix)', kind: 'string' },
      { name: 'maxLength', label: '最大字符数(maxLength)', kind: 'number' },
      { name: 'showCount', label: '显示字数统计(showCount)', kind: 'boolean' },
      { name: 'password', label: '密码框模式', kind: 'boolean' },
    ],
    events: [{ name: 'onChange', label: '值变化' }, { name: 'onClick', label: '点击时' }],
    snippet: '<Input label="名称" name="name" />',
  },
  {
    name: 'NumberInput',
    title: '数字输入',
    category: 'form',
    icon: 'Hash',
    description: '数字或金额输入（AntD InputNumber）。',
    props: [
      ...fieldBase,
      { name: 'prefix', label: '前缀(如 ¥)', kind: 'string' },
      { name: 'suffix', label: '后缀单位(如 元、件)', kind: 'string' },
      { name: 'precision', label: '小数位数(precision)', kind: 'number' },
      { name: 'min', label: '最小值(min)', kind: 'number' },
      { name: 'max', label: '最大值(max)', kind: 'number' },
      { name: 'step', label: '步长(step)', kind: 'number', default: 1 },
    ],
    events: [{ name: 'onChange', label: '值变化' }],
    snippet: '<NumberInput label="金额" name="amount" prefix="¥" precision={2} />',
  },
  {
    name: 'Textarea',
    title: '多行文本',
    category: 'form',
    icon: 'AlignLeft',
    description: '多行文本输入（AntD Input.TextArea）。',
    props: [
      ...fieldBase,
      { name: 'initialValue', label: '初始值', kind: 'string' },
      { name: 'rows', label: '显示行数(rows)', kind: 'number', default: 3 },
      { name: 'maxLength', label: '最大字数(maxLength)', kind: 'number' },
      { name: 'showCount', label: '显示字数统计(showCount)', kind: 'boolean' },
    ],
    events: [{ name: 'onClick', label: '点击时' }],
    snippet: '<Textarea label="备注" name="remark" span={2} />',
  },
  {
    name: 'Select',
    title: '下拉选择',
    category: 'form',
    icon: 'ChevronDownSquare',
    description: '下拉单选/多选（AntD Select）。',
    props: [
      ...fieldBase,
      { name: 'initialValue', label: '初始值', kind: 'string' },
      OPTION_LIST,
      { name: 'multiple', label: '多选模式(mode="multiple")', kind: 'boolean' },
      { name: 'showSearch', label: '支持输入搜索(showSearch)', kind: 'boolean' },
    ],
    events: [{ name: 'onChange', label: '值变化' }],
    snippet: "<Select label=\"状态\" name=\"status\" options={['启用', '停用']} />",
  },
  {
    name: 'DatePicker',
    title: '日期选择',
    category: 'form',
    icon: 'Calendar',
    description: '选择日期（AntD DatePicker）。',
    props: [
      ...fieldBase,
      {
        name: 'picker',
        label: '时间粒度(picker)',
        kind: 'select',
        options: ['date', 'month', 'year', 'datetime'],
        default: 'date',
      },
    ],
    snippet: '<DatePicker label="日期" name="date" />',
  },
  {
    name: 'DateRange',
    title: '日期范围',
    category: 'form',
    icon: 'CalendarRange',
    description: '选择起止日期（AntD RangePicker）。',
    props: [
      ...fieldBase,
      { name: 'showTime', label: '包含时间(showTime)', kind: 'boolean' },
    ],
    snippet: '<DateRange label="日期范围" name="date_range" />',
  },
  {
    name: 'Radio',
    title: '单选框组',
    category: 'form',
    icon: 'CircleDot',
    description: '单选按钮组（AntD Radio.Group），支持圆点或按钮式分段单选。',
    props: [
      ...fieldBase,
      OPTION_LIST,
      {
        name: 'optionType',
        label: '展示样式(optionType)',
        kind: 'select',
        options: ['default', 'button'],
        default: 'default',
        description: 'default=圆点单选，button=AntD 按钮式单选(Radio.Button)',
      },
      {
        name: 'buttonStyle',
        label: '按钮风格(buttonStyle)',
        kind: 'select',
        options: ['outline', 'solid'],
        default: 'outline',
      },
      {
        name: 'direction',
        label: '选项排列方向',
        kind: 'select',
        options: ['horizontal', 'vertical'],
        default: 'horizontal',
      },
    ],
    events: [{ name: 'onChange', label: '值变化' }],
    snippet: "<Radio label=\"类型\" name=\"type\" options={['类型一', '类型二']} />",
  },
  {
    name: 'Checkbox',
    title: '多选框组',
    category: 'form',
    icon: 'CheckSquare',
    description: '多选框组（AntD Checkbox.Group）。',
    props: [
      ...fieldBase,
      OPTION_LIST,
      {
        name: 'direction',
        label: '选项排列方向',
        kind: 'select',
        options: ['horizontal', 'vertical'],
        default: 'horizontal',
      },
    ],
    snippet: "<Checkbox label=\"标签\" name=\"tags\" options={['A', 'B', 'C']} />",
  },
  {
    name: 'Switch',
    title: '开关',
    category: 'form',
    icon: 'ToggleRight',
    description: '开关切换（AntD Switch）。',
    props: [
      ...fieldBase,
      { name: 'checkedChildren', label: '开启时文字(checkedChildren)', kind: 'string' },
      { name: 'unCheckedChildren', label: '关闭时文字(unCheckedChildren)', kind: 'string' },
    ],
    events: [{ name: 'onChange', label: '值变化' }],
    snippet: '<Switch label="启用" name="enabled" />',
  },
  {
    name: 'Upload',
    title: '上传',
    category: 'form',
    icon: 'Upload',
    description: '附件或图片上传（AntD Upload）。',
    props: [
      ...fieldBase,
      {
        name: 'listType',
        label: '上传区域样式(listType)',
        kind: 'select',
        options: ['button', 'dragger', 'picture-card'],
        default: 'button',
        description: 'button=标准上传按钮，dragger=拖拽上传大框，picture-card=照片墙方块',
      },
      { name: 'accept', label: '文件格式说明(accept)', kind: 'string' },
      { name: 'buttonText', label: '按钮文字', kind: 'string', default: '点击上传' },
    ],
    snippet: '<Upload label="附件" name="attachments" />',
  },
  {
    name: 'PickerInput',
    title: '弹框选择器',
    category: 'form',
    icon: 'SquareMousePointer',
    description: '点击后打开选择弹框（overlay），单选关联字段使用 returnSelection(表格pfId, 显示字段, 存储键字段) 回填。',
    props: [...fieldBase, { name: 'overlay', label: '选择弹框', kind: 'overlay', required: true }],
    snippet: '<PickerInput label="选择供应商" name="supplier_id" overlay="" />',
  },

  // ───────────────────────── Actions ─────────────────────────
  {
    name: 'Button',
    title: '按钮',
    category: 'action',
    icon: 'MousePointerClick',
    description: '按钮（AntD Button），文字写在子内容中。onClick 配置动作链。',
    inline: true,
    textChild: true,
    props: [
      {
        name: 'type',
        label: '按钮类型(type)',
        kind: 'select',
        options: ['primary', 'default', 'dashed', 'text', 'link', 'danger'],
        default: 'default',
      },
      {
        name: 'size',
        label: '按钮尺寸(size)',
        kind: 'select',
        options: ['small', 'middle', 'large'],
        default: 'middle',
      },
      {
        name: 'shape',
        label: '按钮形状(shape)',
        kind: 'select',
        options: ['default', 'round', 'circle'],
        default: 'default',
      },
      {
        name: 'icon',
        label: '图标(icon)',
        kind: 'select',
        options: ['', 'plus', 'search', 'edit', 'delete', 'download', 'upload', 'check', 'close', 'eye'],
      },
      { name: 'danger', label: '危险红色状态(danger)', kind: 'boolean' },
      { name: 'ghost', label: '幽灵透明底(ghost)', kind: 'boolean' },
      { name: 'block', label: '撑满行宽(block)', kind: 'boolean' },
      { name: 'disabled', label: '禁用(disabled)', kind: 'boolean' },
    ],
    events: [{ name: 'onClick', label: '点击' }],
    snippet: '<Button type="primary">按钮</Button>',
  },
  {
    name: 'Toolbar',
    title: '操作栏',
    category: 'action',
    icon: 'RectangleEllipsis',
    description: '一行按钮或筛选器的容器，支持左右对齐、背景底栏与上下边线。',
    container: true,
    props: [
      { name: 'align', label: '对齐方式(align)', kind: 'select', options: ['left', 'right', 'between', 'center'], default: 'left' },
      { name: 'title', label: '左侧标题文字', kind: 'string' },
      { name: 'subTitle', label: '左侧副标题/统计说明', kind: 'string' },
      { name: 'bg', label: '工具栏底色', kind: 'select', options: ['none', 'gray', 'blue'], default: 'none' },
      { name: 'bordered', label: '底部边线', kind: 'boolean' },
    ],
    snippet: '<Toolbar><Button type="primary" icon="plus">新增</Button><Button>导出</Button></Toolbar>',
  },

  // ───────────────────────── Overlays ─────────────────────────
  {
    name: 'Modal',
    title: '弹框',
    category: 'overlay',
    icon: 'AppWindow',
    description:
      '弹框（AntD Modal），本身是一个可设计的子页面。用 openModal(id, 参数) 打开，closeOverlay() 关闭。footer 为 false 时隐藏底部默认按钮。',
    container: true,
    props: [
      { name: 'id', label: '弹框ID', kind: 'string', required: true },
      { name: 'title', label: '标题(title)', kind: 'string' },
      { name: 'width', label: '宽度(width px)', kind: 'number', default: 640 },
      { name: 'centered', label: '垂直居中(centered)', kind: 'boolean', default: true },
      { name: 'footer', label: '显示默认底部按钮栏(footer)', kind: 'boolean', default: true },
      { name: 'okText', label: '确定按钮文字(okText)', kind: 'string', default: '确定' },
      { name: 'cancelText', label: '取消按钮文字(cancelText)', kind: 'string', default: '取消' },
    ],
    events: [
      { name: 'onOk', label: '点击确定' },
    ],
    snippet: '<Modal id="modal-new" title="新弹框" />',
  },
  {
    name: 'Drawer',
    title: '抽屉',
    category: 'overlay',
    icon: 'PanelRightOpen',
    description: '侧边抽屉（AntD Drawer），用 openDrawer(id, 参数) 打开，适合详情和长表单。',
    container: true,
    props: [
      { name: 'id', label: '抽屉ID', kind: 'string', required: true },
      { name: 'title', label: '标题(title)', kind: 'string' },
      { name: 'width', label: '宽度(width px)', kind: 'number', default: 520 },
      { name: 'placement', label: '弹出位置(placement)', kind: 'select', options: ['right', 'left'], default: 'right' },
      { name: 'footer', label: '显示底部按钮栏(footer)', kind: 'boolean', default: false },
      { name: 'okText', label: '确定按钮文字(okText)', kind: 'string', default: '确定' },
      { name: 'cancelText', label: '取消按钮文字(cancelText)', kind: 'string', default: '取消' },
    ],
    events: [{ name: 'onOk', label: '点击确定' }],
    snippet: '<Drawer id="drawer-new" title="新抽屉" />',
  },
  {
    name: 'Alert',
    title: '警告提示',
    category: 'overlay',
    icon: 'Info',
    description: '页面内提示条（AntD Alert）。',
    props: [
      { name: 'type', label: '类型(type)', kind: 'select', options: ['info', 'success', 'warning', 'error'], default: 'info' },
      { name: 'message', label: '主提示内容(message)', kind: 'string' },
      { name: 'description', label: '详细辅助说明(description)', kind: 'text' },
      { name: 'showIcon', label: '显示状态图标(showIcon)', kind: 'boolean', default: true },
      { name: 'closable', label: '显示关闭按钮(closable)', kind: 'boolean' },
      { name: 'banner', label: '顶部通栏无圆角(banner)', kind: 'boolean' },
    ],
    snippet: '<Alert type="info" message="提示信息" />',
  },
  {
    name: 'Result',
    title: '结果页',
    category: 'overlay',
    icon: 'BadgeCheck',
    description: '操作成功/失败的结果反馈（AntD Result）。',
    container: true,
    props: [
      { name: 'status', label: '状态(status)', kind: 'select', options: ['success', 'error', 'info', 'warning'], default: 'success' },
      { name: 'title', label: '主标题(title)', kind: 'string' },
      { name: 'subTitle', label: '副标题说明(subTitle)', kind: 'string' },
    ],
    snippet: '<Result status="success" title="提交成功" />',
  },
];

const FIELD_COMPONENT_NAMES_WITHOUT_PLACEHOLDER = new Set(['Radio', 'Checkbox', 'Switch', 'Upload', 'DateRange', 'Slider', 'Rate', 'Segmented']);
const FIELD_COMPONENT_NAMES_WITHOUT_CLEAR = new Set(['NumberInput', 'Radio', 'Checkbox', 'Switch', 'Upload', 'PickerInput', 'Slider', 'Segmented']);

// All consumers (palette, inspector, AI contract, viewer) use the same expanded metadata.
COMPONENTS.push(...createAntdMaterials(fieldBase));
COMPONENTS.push(...MODERN_DESKTOP_MATERIALS);
COMPONENTS.push(FREEFORM_MATERIAL);
COMPONENTS.push(...CHART_MATERIALS);
for (const component of COMPONENTS) {
  // Shared field chrome does not make every control support these input features.
  if (FIELD_COMPONENT_NAMES_WITHOUT_PLACEHOLDER.has(component.name)) component.props = component.props.filter((p) => p.name !== 'placeholder');
  if (FIELD_COMPONENT_NAMES_WITHOUT_CLEAR.has(component.name)) component.props = component.props.filter((p) => p.name !== 'allowClear');
  component.props.push(...(ANTD_EXTRA_PROPS[component.name] ?? []));
  if (['Input', 'Textarea', 'NumberInput', 'Select', 'DatePicker', 'DateRange', 'TimePicker', 'Cascader', 'TreeSelect', 'AutoComplete'].includes(component.name)) {
    component.props.push(...ANTD_INPUT_APPEARANCE);
  }
  if (['Textarea', 'DatePicker', 'DateRange', 'Checkbox'].includes(component.name)) {
    const existing = component.events ?? [];
    component.events = [{ name: 'onChange', label: '值变化（params.value）' }, ...existing.filter((e) => e.name !== 'onChange')];
  }
  if (component.name === 'Pagination') component.events = [{ name: 'onChange', label: '页码变化（params.current / pageSize）' }];
  if (['Alert', 'Tag'].includes(component.name)) component.events = [{ name: 'onClose', label: '关闭' }];
}

COMPONENTS.push(...MOBILE_COMPONENTS);
COMPONENTS.push(...AXURE_MATERIALS);
COMPONENTS.push(...FIGMA_MATERIALS);

export const COMPONENT_MAP: Record<string, ComponentMeta> = Object.fromEntries(COMPONENTS.map((c) => [c.name, c]));

export const DESKTOP_OVERLAY_TYPES = new Set(['Modal', 'Drawer']);
export { MOBILE_COMPONENT_NAMES, MOBILE_OVERLAY_TYPES, MOBILE_FIELD_TYPES, UNIVERSAL_COMPONENT_NAMES };

export const PAGE_ROOT_TYPES = new Set(['Page', 'MobilePage']);

export const OVERLAY_TYPES = new Set(['Modal', 'Drawer', ...MOBILE_OVERLAY_TYPES]);

export const FIELD_TYPES = new Set([
  'Input',
  'NumberInput',
  'Textarea',
  'Select',
  'DatePicker',
  'DateRange',
  'Radio',
  'Checkbox',
  'Switch',
  'Upload',
  'PickerInput',
  'TimePicker', 'Slider', 'Rate', 'Cascader', 'TreeSelect', 'AutoComplete', 'Segmented',
  ...MOBILE_FIELD_TYPES,
]);
