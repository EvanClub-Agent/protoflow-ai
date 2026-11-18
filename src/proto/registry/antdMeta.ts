import type { ComponentMeta, PropSpec } from './meta';

const bool = (name: string, label: string, value?: boolean): PropSpec => ({ name, label, kind: 'boolean', ...(value === undefined ? {} : { default: value }) });
const str = (name: string, label: string): PropSpec => ({ name, label, kind: 'string' });
const num = (name: string, label: string, value?: number): PropSpec => ({ name, label, kind: 'number', ...(value === undefined ? {} : { default: value }) });
const select = (name: string, label: string, options: string[], value?: string): PropSpec => ({ name, label, kind: 'select', options, ...(value === undefined ? {} : { default: value }) });
const size = select('size', '尺寸', ['small', 'middle', 'large'], 'middle');
const placement = select('placement', '弹出位置', ['top', 'topLeft', 'topRight', 'bottom', 'bottomLeft', 'bottomRight', 'left', 'right'], 'top');
const trigger = select('trigger', '触发方式', ['hover', 'click', 'focus'], 'hover');
const options: PropSpec = { name: 'options', label: '选项数据', kind: 'json', description: '字符串数组，或 [{"label":"显示名","value":"实际值","disabled":false}]；保留 value 原始类型。' };
const treeOptions: PropSpec = { ...options, description: '树形数组：[{"label":"部门","value":"dept","children":[{"label":"小组","value":"team"}]}]；value 必须唯一。' };
const change = [{ name: 'onChange', label: '值变化（params.value）' }];

export function createAntdMaterials(fieldBase: PropSpec[]): ComponentMeta[] {
  const field = (name: string, title: string, icon: string, props: PropSpec[], snippet: string): ComponentMeta => ({ name, title, icon, category: 'form', description: `${title}（Ant Design ${name}），支持表单绑定及 onChange 动作链。`, props: [...fieldBase, ...props], events: change, snippet });
  return [
    { name: 'Flex', title: '弹性布局', icon: 'LayoutGrid', category: 'layout', container: true, description: 'Ant Design Flex，可控制方向、换行、间距和双轴对齐。', props: [bool('vertical', '垂直排列'), bool('wrap', '自动换行'), num('gap', '间距(px)', 12), select('justify', '主轴对齐', ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']), select('align', '交叉轴对齐', ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'])], snippet: '<Flex gap={12}><Button>按钮一</Button><Button>按钮二</Button></Flex>' },
    { name: 'Collapse', title: '折叠面板', icon: 'PanelsTopLeft', category: 'layout', container: true, description: 'Ant Design Collapse，内部放 CollapsePanel；设计时展开全部面板，预览时支持折叠和手风琴。', props: [bool('accordion', '手风琴模式'), bool('bordered', '显示边框', true), bool('ghost', '透明背景'), bool('defaultExpandAll', '默认展开全部'), size, select('expandIconPosition', '展开图标位置', ['start', 'end'], 'start')], events: change, snippet: '<Collapse><CollapsePanel title="基本信息"><Text>面板内容</Text></CollapsePanel><CollapsePanel title="更多信息" /></Collapse>' },
    { name: 'CollapsePanel', title: '折叠面板项', icon: 'PanelTop', category: 'layout', container: true, parents: ['Collapse'], description: 'Collapse 的内容分组，可拖入任意物料。', props: [str('title', '面板标题'), str('extra', '右侧说明'), bool('disabled', '禁止展开')], snippet: '<CollapsePanel title="新面板" />' },
    { name: 'Avatar', title: '头像', icon: 'CircleUserRound', category: 'data', inline: true, textChild: true, description: 'Ant Design Avatar，支持文字、图片、形状与尺寸。', props: [str('src', '图片地址'), str('alt', '替代文字'), num('size', '尺寸(px)', 40), select('shape', '形状', ['circle', 'square'], 'circle'), str('backgroundColor', '背景色'), str('color', '文字颜色')], snippet: '<Avatar size={40}>U</Avatar>' },
    { name: 'Badge', title: '徽标', icon: 'BadgeCheck', category: 'data', inline: true, container: true, description: 'Ant Design Badge，数字角标、小红点或状态标记，可包裹子组件。', props: [num('count', '数量', 5), num('overflowCount', '最大展示数', 99), bool('showZero', '显示零'), bool('dot', '仅显示圆点'), select('status', '状态', ['', 'success', 'processing', 'default', 'error', 'warning']), str('text', '状态说明'), str('color', '自定义颜色')], snippet: '<Badge count={5}><Avatar>U</Avatar></Badge>' },
    { name: 'Progress', title: '进度条', icon: 'Gauge', category: 'data', description: 'Ant Design Progress，线形、圆形、仪表盘和分段进度。', props: [num('percent', '百分比', 50), select('type', '形状', ['line', 'circle', 'dashboard'], 'line'), select('status', '状态', ['normal', 'active', 'exception', 'success'], 'normal'), bool('showInfo', '显示进度文字', true), select('size', '尺寸', ['small', 'default'], 'default'), num('steps', '分段数量'), str('strokeColor', '进度颜色'), select('strokeLinecap', '端点形状', ['round', 'butt', 'square'], 'round')], snippet: '<Progress percent={65} />' },
    { name: 'Image', title: '图片', icon: 'Image', category: 'data', description: 'Ant Design Image，支持点击预览、缩放和旋转；图片来源由用户配置。', props: [str('src', '图片地址'), str('alt', '替代文字'), num('imageWidth', '图片宽度(px)', 240), num('imageHeight', '图片高度(px)'), select('objectFit', '填充方式', ['contain', 'cover', 'fill'], 'contain'), bool('preview', '点击预览', true)], snippet: '<Image alt="图片" imageWidth={240} />' },
    { name: 'Skeleton', title: '骨架屏', icon: 'RectangleEllipsis', category: 'overlay', container: true, description: 'Ant Design Skeleton，加载时展示占位，关闭加载后显示子组件。', props: [bool('loading', '加载状态', true), bool('active', '动画', true), bool('avatar', '头像占位'), bool('title', '标题占位', true), bool('round', '圆角段落'), num('rows', '段落行数', 3)], snippet: '<Skeleton active rows={3}><Text>加载完成的内容</Text></Skeleton>' },
    { name: 'Spin', title: '加载中', icon: 'LoaderCircle', category: 'overlay', container: true, description: 'Ant Design Spin，支持尺寸、说明与内容加载遮罩。', props: [bool('spinning', '加载状态', true), size, str('tip', '加载说明')], snippet: '<Spin tip="加载中"><Text>内容区域</Text></Spin>' },
    { name: 'Tooltip', title: '文字提示', icon: 'MessageCircle', category: 'overlay', container: true, inline: true, description: 'Ant Design Tooltip，包裹触发组件；预览时触发提示。', props: [str('title', '提示内容'), placement, trigger, str('color', '背景颜色')], snippet: '<Tooltip title="补充说明"><Button>悬停查看提示</Button></Tooltip>' },
    { name: 'Popover', title: '气泡卡片', icon: 'MessageSquare', category: 'overlay', container: true, inline: true, description: 'Ant Design Popover，标题与内容可配置，预览时打开。', props: [str('title', '标题'), { name: 'content', label: '内容', kind: 'text' }, placement, { ...trigger, default: 'click' }], snippet: '<Popover title="详细信息" content="在这里填写详细说明"><Button>查看详情</Button></Popover>' },
    { name: 'Popconfirm', title: '气泡确认', icon: 'BadgeHelp', category: 'overlay', container: true, inline: true, description: 'Ant Design Popconfirm，确认或取消时执行各自动作链。', props: [str('title', '确认标题'), str('description', '详细说明'), str('okText', '确认按钮文字'), str('cancelText', '取消按钮文字'), placement, bool('disabled', '禁用')], events: [{ name: 'onConfirm', label: '确认' }, { name: 'onCancel', label: '取消' }], snippet: '<Popconfirm title="确认执行此操作？"><Button>执行操作</Button></Popconfirm>' },
    field('TimePicker', '时间选择', 'Clock', [select('format', '时间格式', ['HH:mm:ss', 'HH:mm', 'hh:mm:ss A'], 'HH:mm:ss'), bool('use12Hours', '12小时制'), num('hourStep', '小时间隔', 1), num('minuteStep', '分钟间隔', 1), num('secondStep', '秒间隔', 1)], '<TimePicker label="时间" name="time" />'),
    field('Slider', '滑动输入', 'SlidersHorizontal', [num('min', '最小值', 0), num('max', '最大值', 100), num('step', '步长', 1), bool('range', '双滑块范围'), bool('reverse', '反向'), bool('dots', '显示刻度'), bool('tooltipVisible', '始终显示数值')], '<Slider label="进度" name="progress" min={0} max={100} />'),
    field('Rate', '评分', 'Star', [num('count', '星星数量', 5), bool('allowHalf', '允许半星')], '<Rate label="评分" name="rating" allowHalf />'),
    field('Cascader', '级联选择', 'GitBranch', [treeOptions, bool('showSearch', '搜索'), bool('changeOnSelect', '允许选择中间层级'), select('expandTrigger', '展开方式', ['click', 'hover'], 'click')], '<Cascader label="地区" name="region" options={[{label:"浙江",value:"zhejiang",children:[{label:"杭州",value:"hangzhou"}]}]} />'),
    field('TreeSelect', '树选择', 'Network', [treeOptions, bool('multiple', '多选'), bool('treeCheckable', '显示复选框'), bool('treeDefaultExpandAll', '默认展开全部'), bool('showSearch', '搜索'), num('maxTagCount', '最多展示标签数')], '<TreeSelect label="部门" name="department" options={[{label:"研发部",value:"engineering",children:[{label:"前端组",value:"frontend"},{label:"后端组",value:"backend"}]}]} />'),
    field('AutoComplete', '自动补全', 'ListFilter', [options], '<AutoComplete label="输入建议" name="suggestion" options={["选项一","选项二"]} />'),
    field('Segmented', '分段控制器', 'PanelsTopLeft', [options, bool('block', '撑满宽度'), select('direction', '排列方向', ['horizontal', 'vertical'], 'horizontal')], '<Segmented label="视图" name="view" options={["列表","看板","日历"]} />'),
  ];
}

export const ANTD_EXTRA_PROPS: Record<string, PropSpec[]> = {
  Input: [bool('visibilityToggle', '密码可见切换', true)],
  Textarea: [bool('autoSize', '自动调整高度'), num('minRows', '最少行数', 2), num('maxRows', '最多行数', 6)],
  NumberInput: [bool('controls', '显示增减按钮', true), bool('keyboard', '允许键盘增减', true)],
  Select: [select('mode', '选择模式（优先于旧多选开关）', ['single', 'multiple', 'tags']), bool('loading', '加载状态'), num('maxTagCount', '最多展示标签数'), num('maxCount', '最多选择项数'), bool('popupMatchSelectWidth', '下拉宽度跟随控件', true)],
  DatePicker: [bool('showTime', '包含时间')],
  Switch: [bool('loading', '加载状态')],
  Button: [bool('loading', '加载状态'), select('iconPosition', '图标位置', ['start', 'end'], 'start')],
  Card: [bool('loading', '加载骨架屏')],
  Pagination: [bool('simple', '简洁模式'), bool('disabled', '禁用'), bool('hideOnSinglePage', '仅一页时隐藏')],
  Table: [bool('showSizeChanger', '允许切换每页条数', true), bool('showQuickJumper', '显示快速跳页'), bool('loading', '加载状态'), num('scrollY', '表体最大高度(px)'), num('scrollX', '表格最小宽度(px)'), bool('sticky', '固定表头')],
};

export const ANTD_INPUT_APPEARANCE: PropSpec[] = [size, select('status', '校验状态', ['', 'warning', 'error']), select('variant', '控件外观', ['outlined', 'filled', 'borderless', 'underlined'], 'outlined')];
