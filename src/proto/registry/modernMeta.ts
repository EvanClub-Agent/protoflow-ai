import type { ComponentMeta, ListFieldSpec, PropSpec } from './meta';

const CARD_ROW_ACTION_ITEM: ListFieldSpec[] = [
  { name: 'label', label: '名称', kind: 'string' },
  { name: 'danger', label: '危险', kind: 'boolean' },
  { name: 'onClick', label: '点击动作', kind: 'actions' },
];

export const MODERN_DESKTOP_MATERIALS: ComponentMeta[] = [
  {
    name: 'NavMenu',
    title: '导航菜单',
    category: 'navigation',
    icon: 'PanelLeft',
    description: '侧边或顶部应用导航菜单栏，支持品牌标题、收起态、角标提示与点击跨页跳转。',
    props: [
      { name: 'brandTitle', label: '品牌标题', kind: 'string', default: '工作台' },
      { name: 'mode', label: '排列方向', kind: 'select', options: ['inline', 'horizontal'], default: 'inline' },
      { name: 'theme', label: '视觉主题', kind: 'select', options: ['light', 'dark'], default: 'light' },
      { name: 'activeKey', label: '当前激活项 key', kind: 'string', default: 'overview' },
      { name: 'collapsed', label: '折叠仅显示图标', kind: 'boolean', default: false },
      {
        name: 'items',
        label: '菜单项',
        kind: 'list',
        itemFields: [
          { name: 'key', label: '唯一标识', kind: 'string' },
          { name: 'title', label: '菜单名称', kind: 'string' },
          { name: 'icon', label: '图标名', kind: 'string' },
          { name: 'badge', label: '角标文字', kind: 'string' },
          { name: 'page', label: '跳转目标页面ID', kind: 'string' },
          { name: 'onClick', label: '点击动作', kind: 'actions' },
        ],
      },
    ],
    events: [{ name: 'onSelect', label: '切换菜单项（params.key）' }],
    snippet: `<NavMenu brandTitle="运营中心" mode="inline" activeKey="overview" items={[
  { key: 'overview', title: '数据总览', icon: 'LayoutGrid' },
  { key: 'orders', title: '订单管理', icon: 'ShoppingBag', badge: '12' },
  { key: 'customers', title: '客户档案', icon: 'Users' },
  { key: 'settings', title: '系统设置', icon: 'Settings' }
]} />`,
  },
  {
    name: 'CardGrid',
    title: '卡片网格列表',
    category: 'data',
    icon: 'LayoutGrid',
    description: '多列图文与业务卡片网格列表。支持直接绑定物理表（配合 QueryForm / SearchInput 筛选）或静态配置卡片项，支持行级点击与卡片底部操作。',
    props: [
      { name: 'table', label: '绑定物理表', kind: 'table' },
      { name: 'sourceForeignKey', label: '当前单据外键字段', kind: 'column', description: '按当前打开记录过滤子表卡片时填写明细表外键字段名。' },
      { name: 'filter', label: '固定过滤条件', kind: 'json' },
      { name: 'cols', label: '每行列数(1-4)', kind: 'number', default: 3 },
      { name: 'titleField', label: '主标题字段', kind: 'column' },
      { name: 'subtitleField', label: '副标题字段', kind: 'column' },
      { name: 'imageField', label: '封面图字段', kind: 'column' },
      { name: 'tagField', label: '状态标签字段', kind: 'column' },
      { name: 'priceField', label: '金额/指标字段', kind: 'column' },
      { name: 'showCover', label: '显示卡片封面区', kind: 'boolean', default: true },
      { name: 'pageSize', label: '每页卡片数', kind: 'number', default: 6 },
      {
        name: 'items',
        label: '静态示例卡片(未绑表时生效)',
        kind: 'list',
        itemFields: [
          { name: 'title', label: '主标题', kind: 'string' },
          { name: 'subtitle', label: '副标题描述', kind: 'string' },
          { name: 'image', label: '封面图片地址', kind: 'string' },
          { name: 'tag', label: '右上角标签', kind: 'string' },
          { name: 'price', label: '重点指标/价格', kind: 'string' },
        ],
      },
      { name: 'rowActions', label: '卡片操作按钮', kind: 'list', itemFields: CARD_ROW_ACTION_ITEM },
    ],
    events: [{ name: 'onItemClick', label: '点击卡片' }],
    snippet: `<CardGrid cols={3} items={[
  { title: '企业版 AI 知识库', subtitle: '支持多源文档向量检索与权限隔离', tag: '已上线', price: '¥2,999/年' },
  { title: '全渠道客服工作台', subtitle: '工单自动流转与智能话术辅助', tag: '热门', price: '¥1,599/年' },
  { title: '经营分析驾驶舱', subtitle: '实时追踪核心转化率与库存周转', tag: '推荐', price: '¥999/年' }
]} />`,
  },
  {
    name: 'Dropdown',
    title: '下拉操作菜单',
    category: 'action',
    icon: 'ChevronDown',
    inline: true,
    container: true,
    description: 'Ant Design Dropdown 下拉操作菜单，可包裹自定义触发按钮或直接使用内置按钮文字。',
    props: [
      { name: 'label', label: '默认触发按钮文字', kind: 'string', default: '更多操作' },
      { name: 'buttonType', label: '按钮样式', kind: 'select', options: ['default', 'primary', 'text', 'link'], default: 'default' },
      { name: 'trigger', label: '触发方式', kind: 'select', options: ['click', 'hover'], default: 'click' },
      { name: 'placement', label: '弹出位置', kind: 'select', options: ['bottomRight', 'bottomLeft', 'topRight', 'topLeft'], default: 'bottomRight' },
      { name: 'disabled', label: '禁用', kind: 'boolean', default: false },
      {
        name: 'items',
        label: '菜单动作项',
        kind: 'list',
        itemFields: [
          { name: 'key', label: '标识', kind: 'string' },
          { name: 'title', label: '菜单文字', kind: 'string' },
          { name: 'danger', label: '危险项', kind: 'boolean' },
          { name: 'disabled', label: '禁用项', kind: 'boolean' },
          { name: 'onClick', label: '点击动作', kind: 'actions' },
        ],
      },
    ],
    snippet: `<Dropdown label="更多操作" items={[
  { key: 'export', title: '导出所选数据' },
  { key: 'archive', title: '批量归档' },
  { key: 'delete', title: '删除记录', danger: true }
]} />`,
  },
  {
    name: 'Carousel',
    title: '轮播横幅',
    category: 'data',
    icon: 'GalleryHorizontal',
    description: '支持横滑吸附、前后切换按钮与圆点指示器的焦点轮播横幅，适用于门户首页、活动推荐与产品特性展示。',
    props: [
      { name: 'title', label: '无障碍区域名称', kind: 'string', default: '精选推荐' },
      { name: 'height', label: '高度(px)', kind: 'number', default: 220 },
      { name: 'loop', label: '循环切换', kind: 'boolean', default: true },
      { name: 'showArrows', label: '显示左右箭头', kind: 'boolean', default: true },
      {
        name: 'items',
        label: '轮播页列表',
        kind: 'list',
        itemFields: [
          { name: 'title', label: '主标题', kind: 'string' },
          { name: 'subtitle', label: '副文案', kind: 'string' },
          { name: 'tag', label: '顶部胶囊标签', kind: 'string' },
          { name: 'image', label: '背景或配图地址', kind: 'string' },
          { name: 'tone', label: '渐变色调', kind: 'select', options: ['blue', 'violet', 'emerald', 'amber', 'slate'] },
          { name: 'onClick', label: '点击动作', kind: 'actions' },
        ],
      },
    ],
    snippet: `<Carousel height={220} items={[
  { title: '全新一代智能协同工作台', subtitle: '打通设计稿导入、ER 建模与多端业务流验证', tag: '重磅升级', tone: 'blue' },
  { title: '企业级数据资产全景看板', subtitle: '核心经营指标秒级汇总与多维下钻', tag: '精选特性', tone: 'violet' },
  { title: '自动化闭环需求巡检', subtitle: '提前发现断链交互与字段缺失风险', tag: '效率提升', tone: 'emerald' }
]} />`,
  },
  {
    name: 'Icon',
    title: '语义图标',
    category: 'data',
    icon: 'Sparkles',
    inline: true,
    description: '独立可配置的语义矢量图标，支持尺寸、主题色阶、圆角底衬与点击事件。',
    props: [
      { name: 'name', label: '图标名称', kind: 'string', default: 'Sparkles' },
      { name: 'size', label: '图标大小(px)', kind: 'number', default: 20 },
      { name: 'tone', label: '主题色阶', kind: 'select', options: ['default', 'blue', 'violet', 'emerald', 'amber', 'rose'], default: 'blue' },
      { name: 'color', label: '自定义颜色', kind: 'string' },
      { name: 'boxed', label: '圆角底衬背景', kind: 'boolean', default: true },
      { name: 'label', label: '辅助说明名称', kind: 'string' },
    ],
    events: [{ name: 'onClick', label: '点击图标' }],
    snippet: '<Icon name="Sparkles" size={20} tone="blue" boxed={true} />',
  },
];
