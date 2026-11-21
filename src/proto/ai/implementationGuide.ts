import { getMaterialContracts } from '../registry/materialSchemas';
import { CHART_TYPES } from '../charts/model';

interface Scenario {
  id: string;
  title: string;
  when: string;
  components: string[];
  actions: string[];
  implementation: string[];
  acceptance: string[];
  limits: string[];
}

// Describe implemented behavior, not the complete upstream Ant Design API.
export const IMPLEMENTATION_SCENARIOS: Scenario[] = [
  {
    id: 'list', title: '查询与业务表格', when: '普通列表、树形表、展开行详情、合并行或列、单元格编辑，以及筛选、排序、分页和行操作。',
    components: ['QueryForm', 'SearchInput', 'Table', 'Toolbar', 'Button', 'Modal', 'Drawer', 'Pagination'],
    actions: ['openModal', 'openDrawer', 'confirm', 'deleteRow', 'refresh'],
    implementation: [
      '普通表省略 rowMode，Table.table 填工程表 ID，columns[].dataIndex 填该表的字段名。QueryForm.target / SearchInput.target 指向 Table 的 pfId。表格自带分页。',
      '跨页来源可以在表格行操作调用 navigate(页面ID,"row")，或在行内打开弹层。下游明细 Table.sourceForeignKey 指定明细表中引用来源记录的外键字段名；没有匹配来源时展示空表。',
      '树形表使用 rowMode="tree"。用扁平记录中的 parentField 匹配 treeKeyField（默认工程记录 id），值与类型须一致。节点值唯一，根记录的父值显式为 null。按需启用 defaultExpandAll，分页按根节点计算。',
      '点击行首展开并显示本行字段使用 rowMode="expandable"。detailFields 按展示顺序列出字段名，省略时展示当前列。行操作打开独立弹层时使用 rowActions，弹层自动接收当前行。',
      '同一列内合并连续相同的非空值，设置 columns[].mergeRows。指定矩形使用 cellMerges，每项的 rowIds 按展示顺序填写工程记录 id，fields 按列顺序填写 dataIndex。两个数组都要填写，区域至少两个单元格，显示左上角的值。',
      '单元格编辑在 columns[] 上设置 editor，按实际值类型选择契约中的编辑器。下拉用 editor="select" 和 editorOptions，label 是显示文字，value 保留业务原值和类型。单元格自带保存和取消。记录 id、物理主外键及树模式的关联字段只读。',
      '契约中的 examples 使用内置示例记录。业务页面应根据 get_db_table 的字段和 get_table_rows 的已保存记录配置。遇到缺失父节点、循环或无法确定的合并行 ID，指出具体数据缺口。',
    ],
    acceptance: ['查询目标和字段对应正确，重置清空条件。行操作打开正确弹层，删除有确认和反馈。', '树节点归属与实际父值一致；展开详情展示被点击行的字段。合并区域在同页、连续且同父时生效，展开详情会隔断跨行合并。', '预览中保存只改对应记录和字段，取消保留原值。下拉数值 0 保存后仍为数字。'],
    limits: ['当前 Table 查询使用标量文本包含匹配；数组值会被忽略，日期区间、多选、级联路径不能声称已实现筛选。不得删除用户条件掩盖这一限制；需说明并选择可实现的局部交互方案。', '表格读写的是工程内原型数据，不是远程业务数据库。'],
  },
  {
    id: 'form', title: '录入、编辑与校验', when: '新增记录、修改当前行、分组录入或表单提交。',
    components: ['Form', 'Input', 'NumberInput', 'Textarea', 'Select', 'DatePicker', 'DateRange', 'TimePicker', 'Radio', 'Checkbox', 'Switch', 'Upload', 'Slider', 'Rate', 'Cascader', 'TreeSelect', 'AutoComplete', 'Button', 'Modal', 'Drawer'],
    actions: ['submitForm', 'resetForm', 'closeOverlay', 'toast', 'refresh'],
    implementation: ['Form 绑定真实表，字段 name 对应真实字段；fields 简写和子字段组件二选一。类型按字段含义选择，不改动业务标识或状态值。', '编辑从表格行打开弹层，使表单继承 row；保存动作先 submitForm，再提示/关窗/刷新，校验失败会中断动作链。'],
    acceptance: ['必填缺失时阻止保存；编辑的是指定行；取消不提交。', '保存后的列表可以看到结果；选择项的显示文字与实际值明确。'],
    limits: ['Upload 目前只演示附件名称，不上传真实文件。', '复杂跨字段条件和远程校验没有通用执行器，不得编造外层 onChange 回调；必要时用自由组件做明确标注的局部原型演示。'],
  },
  {
    id: 'detail', title: '详情、分组与记录展示', when: '查看记录、分组信息、过程记录、标签和概要。',
    components: ['Descriptions', 'Card', 'Tabs', 'Tab', 'Collapse', 'CollapsePanel', 'Timeline', 'Text', 'Title', 'Tag', 'Avatar', 'Badge', 'Image', 'Tooltip', 'Popover'],
    actions: ['openDrawer', 'openModal', 'switchTab', 'navigate'],
    implementation: ['详情通过行操作进入 Drawer/Modal，Descriptions 读取当前行；分组用 Tabs 或 Collapse。', '时间线用于过程展示；需要真实状态变更时另配受支持的动作，不能只改变展示标签。'],
    acceptance: ['展示的是选中记录；分组标题清楚；长文本、空字段和图片不可用时的表现可解释。'],
    limits: ['静态 Timeline / Steps 展示不等于审批引擎或业务流程已执行。'],
  },
  {
    id: 'picker', title: '关联记录选择与回填', when: '选择供应商、客户等关联记录，或在弹层中搜索后回填。',
    components: ['PickerInput', 'Modal', 'QueryForm', 'Table', 'Toolbar', 'Button'],
    actions: ['returnSelection', 'closeOverlay'],
    implementation: ['PickerInput.overlay 绑定弹层 id；弹层内 Table 开启 selectable，按需求选择单选/多选。', '单选外键使用 returnSelection(表格pfId, 显示字段名, 来源键字段名)，按声明的关系保存键原值，第二个字段只负责展示。旧两参数形式保存展示文本。'],
    acceptance: ['选单属于正确表；查询指向选单；选中后回填并关窗；取消保留原值。'],
    limits: ['通用回填不等于任意多表明细导入。importPurchaseOrderLines 是专用采购验收动作，不可套用于其他业务。'],
  },
  {
    id: 'dashboard', title: '指标、进度与可视化', when: '概览数字、进度、图表、分布和趋势。',
    components: ['Statistic', 'Progress', 'Card', 'Row', 'Col', 'Tag', 'Segmented', ...CHART_TYPES],
    actions: ['navigate', 'openDrawer'],
    implementation: ['基础指标和进度用 Statistic/Progress；统计图表优先使用“数据图表”分区：分类比较用柱状、趋势用折线/面积、占比用饼/环形、关系用散点、单指标用仪表盘；其余按图表契约选择。', '先确认指标含义、口径与来源；演示数字明确说明，不能把静态数值称作实时统计。'],
    acceptance: ['数值、单位、图例一致；空数据和零值合理；图形适应容器。', 'source、分类、指标、汇总口径明确；读取真实字段，不把空值补为 0；点击结果不冒充业务行 ID。'],
    limits: ['已接入 ECharts 6.1.0 的 12 类图表。读取工程预览数据或明确的演示数据；不连接远程数据仓库、不提供实时分析服务。地图、3D、任意 option 尚未接入。'],
  },
  {
    id: 'workflow', title: '步骤、审批与状态反馈', when: '步骤引导、审批操作、成功失败反馈和页面跳转。',
    components: ['Steps', 'Tabs', 'Tab', 'Button', 'Popconfirm', 'Alert', 'Result', 'Empty', 'Skeleton', 'Spin', 'Timeline'],
    actions: ['confirm', 'updateRow', 'switchTab', 'show', 'hide', 'toast', 'navigate'],
    implementation: ['先明确状态值和允许的操作；updateRow 必须在有当前行的上下文内执行。', '步骤展示配合明确的 Tab 或显隐动作；只有已有字段语义明确时才变更状态。'],
    acceptance: ['关键动作有取消路径和结果反馈；前进/返回对应正确内容；未实现的动作不伪装成成功。'],
    limits: ['没有远程审批、权限鉴权、邮件通知或后台任务执行能力；这些可展示原型流程，但不能承诺真实服务已接通。'],
  },
  {
    id: 'layout', title: '页面结构与视觉组织', when: '调整层级、对齐、间距、密度、导航和区域结构。',
    components: ['Page', 'PageHeader', 'Breadcrumb', 'Card', 'Row', 'Col', 'Flex', 'Space', 'Divider', 'Tabs', 'Tab', 'Collapse', 'CollapsePanel', 'Toolbar'],
    actions: [],
    implementation: ['先用标准布局组合；调整间距、分组、密度不需要自由组件。保留已有业务组件、绑定和 pfId。', '从已有复合块复用时检查依赖与参数；保留项目视觉习惯，局部修改不重建整页。'],
    acceptance: ['信息层级清楚；内容宽度适配；表单和列表不被不必要地拆进多个自由组件。'],
    limits: ['不能直接在外层写 CSS/HTML 或假设任意 Ant Design 属性已接入。'],
  },
  {
    id: 'mobile', title: '现代移动端界面（Gemini 现代风 · C端/B端通用）', when: '移动端 App、小程序、消费级内容/电商流、移动审批待办、现场扫码录入或移动 AI 助手页面。',
    components: ['MobilePage', 'MTopBar', 'MTabBar', 'MPillTabs', 'MTab', 'MSearchPill', 'MSurface', 'MBentoGrid', 'MScrollRow', 'MHeroHeader', 'MFeedList', 'MTaskList', 'MListGroup', 'MListItem', 'MStatCard', 'MChatStream', 'MComposerBar', 'MForm', 'MField', 'MSheetPicker', 'MChipSelect', 'MMediaInput', 'MButton', 'MBottomDock', 'MBottomSheet', 'MDialog', 'Freeform'],
    actions: ['openDrawer', 'openModal', 'closeOverlay', 'submitForm', 'resetForm', 'updateRow', 'deleteRow', 'navigate', 'switchTab', 'toast'],
    implementation: [
      '移动端页面根组件必须使用 MobilePage，严禁混用 PC 管理端组件（如 Table、QueryForm、Card、Modal、Drawer）。',
      '采用三段式视口结构：顶部吸顶使用 MTopBar；中部单列纵向流使用 MHeroHeader、MBentoGrid、MSurface、MFeedList（C端图文/商品瀑布流）或 MTaskList（B端业务单据卡片流）；底部吸底使用 MTabBar（一级页悬浮胶囊导航）、MBottomDock（二级详情/表单转化栏）或 MComposerBar（AI 输入舱）。',
      '移动端弹层优先使用 MBottomSheet（通过 openDrawer 打开）和 MDialog（通过 openModal 打开），所有筛选、规格选择、新增编辑表单（MForm + MField/MSheetPicker/MChipSelect/MMediaInput）统一放入 MBottomSheet 或独立移动表单页。',
      'MSearchPill.target 和 MPillTabs.target 可关联同一页面的 MFeedList 或 MTaskList 的 pfId 实现实时搜索与分类胶囊过滤。',
      '当前单据的关联明细已支持：在来源 MTaskList 的 onCardClick/rowActions[].onClick 或 MFeedList.onItemClick 调用 openDrawer("详情弹层ID")，弹层中的 MTaskList/MFeedList 设置 table="明细表ID" 和 sourceForeignKey="明细表外键字段名"。也支持行事件 navigate("目标页面ID","row") 后在目标页读取明细。按真实外键引用的来源列取值，不假定该列名为 id；数值 0 与字符串 "0" 不混用，缺少来源时显示空列表。',
      '例如费用表 expense_items.expense_no 引用 expenses.expense_no：报销列表 table="expenses" 的行事件打开 MBottomSheet，内部 MTaskList table="expense_items" sourceForeignKey="expense_no"。表 ID 和字段名必须替换为 get_db_table 核实的实际值；filter 用于进一步筛选，不用 {{row.id}} 字符串或全量列表替代外键隔离。',
    ],
    acceptance: ['单列触控排布清晰，无横向挤压溢出；MTopBar 与底部 MTabBar/MBottomDock 层级分明。', '绑表列表、表单保存、状态更新与半屏抽屉联动闭环一致。', '关联明细要分别打开两条来源记录核对隔离；无来源、来源表不匹配时不能显示全量数据。静态表绑定通过不代表已完成此项运行验证。'],
    limits: ['移动端视口模拟 iPhone 标准屏/Pro/Pro Max，拍照与扫码为原型态交互模拟，不调用物理硬件摄像头。'],
  },
  {
    id: 'axure', title: '编辑与重塑导入的 Axure 页面', when: '从 RP 工程导入后，将页面重塑为标准流式物料，或局部调整定位元件、文本与跨页跳转。',
    components: ['Page', 'PageHeader', 'Card', 'Toolbar', 'QueryForm', 'Table', 'Form', 'Descriptions', 'Modal', 'Drawer', 'AxureCanvas', 'AxureWidget', 'PositionedGroup', 'OutlineTree', 'TreeItem', 'DynamicPanel', 'PanelState', 'StaticTable', 'StaticTableCell', 'VectorShape', 'Hotspot', 'EmbeddedPicture', 'ListSelect', 'ListBox', 'CheckControl', 'RadioControl'], actions: ['navigate', 'openDrawer', 'openModal', 'submitForm', 'show', 'hide', 'switchTab'],
    implementation: ['优化副本默认以标准流式 <Page> 为目标：先调用 protoflow_inspect_axure_project 盘点，再用 protoflow_inspect_page(view="axure") 核对控件、nearbyLabel、grid.columnActions 行动作一致性与 importNotes。', '调用 protoflow_reshape_axure_page 传入源页 rp-page-... ID（由宿主确定副本 ID 与来源标记）：将平铺的查询标签/输入框/按钮合并为 QueryForm（target 指向 Table）；将 StaticTable 转为 Table 时，coverage.converted 须直接指向 Table 的 pfId 并提交 tableId 与逐列 columnMappings（headerPfId → field/columnId、index、checkbox、radio、actions 或 pending），确保 Table.columns 与已确认映射一致且不颠倒字段；仅在 grid.columnActions 显示逐行一致且无需额外确认时迁入 Table.rowActions，并保持源单元格动作链、目标页及当前行参数（如 navigate(目标页ID,"row") 或 openDrawer），单行样例里的“删除”等不得推广到全表。', 'coverage.retained 仅用于保持原物料类型、内容、面板状态和交互不变的区块（仅允许流式排版调整坐标）；发生物料或语义变化的区块、侧栏 OutlineTree、隐藏 DynamicPanel、未支持占位或条件点击警告不得静默删除或虚假声明为保留，须据实列为 converted 或 pending。局部原位微调仍可用 protoflow_bind_axure_table 或 protoflow_optimize_axure_block。'],
    acceptance: ['QueryForm 能按字段实际筛选目标 Table；行操作“查看”从被点击的具体行打开正确目标记录；确认单完整展示已转换、保留与待确认项。'],
    limits: ['未支持元件和条件/多分支点击在导入时仅保留占位或说明，重塑时须显式列为待确认。'],
  },
  {
    id: 'custom', title: '独特展示与局部交互', when: '座位图、拖拽看板、日历排程、关系图、特殊动效等标准组合难以表达的区域。',
    components: ['Freeform', 'Modal', 'Drawer'],
    actions: ['openModal', 'openDrawer', 'navigate', 'setVar', 'toast'],
    implementation: ['说明标准组合不足的具体原因，再读取 Freeform 完整契约；只替换必要区域。', 'source 内使用 React Hooks 与原生 HTML/SVG/CSS；输入用 data 或真实表+columns；输出通过 eventFields、emit、onAction。', '表绑定只接收显式保存的工程预览数据。先 get_table_rows 确认 hasSavedRows，缺失时说明需要准备数据；不得暗造业务记录。独立示意可用明确标注的 data 演示内容。'],
    acceptance: ['可操作状态、撤销/取消路径、空数据、键盘操作和容器适配都有考虑。', '局部状态与宿主联动分开检查；跨区域状态通过已声明事件，不能访问宿主 Store。'],
    limits: ['内部节点不能像标准物料逐项拖拽配置；由 AI 或高级选项整体维护。', '不支持外部模块、远程网络、宿主 API；静态检查不证明组件已运行或交互已成功。'],
  },
];

export function getImplementationGuide(scenarioIds?: string[]) {
  if (scenarioIds !== undefined && (!Array.isArray(scenarioIds) || scenarioIds.some(id => !IMPLEMENTATION_SCENARIOS.some(s => s.id === id)))) throw new Error('未知场景 ID；先不传 scenarioIds 读取场景目录');
  const materials = getMaterialContracts();
  return {
    selectionOrder: ['已有组件属性', '标准物料组合或已保存复合块', '最小范围自由组件', '明确说明当前无法实现的能力并给出可行替代'],
    materialCount: materials.length,
    scenarios: scenarioIds === undefined
      ? IMPLEMENTATION_SCENARIOS.map(({ id, title, when }) => ({ id, title, when }))
      : IMPLEMENTATION_SCENARIOS.filter(s => scenarioIds.includes(s.id)).map(s => ({ ...s, components: s.components.map(name => {
          const material = materials.find(m => m.name === name);
          if (!material) throw new Error(`场景指南引用了未注册物料：${name}`);
          return { name, title: material.title };
        }) })),
    verification: '先读场景指南，再读所选组件契约；用 inspect_page 核对当前或暂存页的结构、动作和绑定。静态有效不等于交互已验证。',
  };
}

export const TASK_IMPLEMENTATION_RULES = `任务理解与实现流程：
- 先判断本轮是问答、审查还是修改，结合本菜单的对话和最新补充理解“这个/刚才/继续”等指代；最新纠正优先，保留仍有效的要求。不要靠关键词硬套模板，也不要把询问当作修改授权。
- 修改前将需求拆为用户目标、页面区域、数据来源、触发动作与结果、空/错/取消等状态、修改范围。简短说明要实现的效果即可，不向用户倾倒内部推理。若业务 ID、字段含义、状态流转存在决定性歧义，先读项目证据，仍不明才询问；常规排版自行决策。
- 先 get_project；已有页用 protoflow_inspect_page（局部任务传入 selectedPfId）与 get_page_tsx 获取最新证据、祖先路径、现有动作和校验问题。读取相关便签与复合块；便签是需求，不能当作已实现证据。
- 用 protoflow_get_implementation_guide 查看场景目录，再请求适用 scenarioIds，可组合多个场景。按“已有属性 → 标准组合/复合块 → 最小自由组件”选择；随后读取所有所选物料和动作的完整契约。不确定能力先查工具，不凭记忆猜属性。
- 每项交互形成“触发组件 → 动作 → 目标 → 数据变化/反馈”的明确对应。出现表单、按钮或步骤条不代表流程已经完成；toast 不能代替保存，静态数字不能代替实时统计。按照场景 limits 诚实说明原型边界。
- 先准备准确的数据契约，再按区块暂存页面。修改后再次 protoflow_inspect_page，按用户的每项要求对照结构、字段、动作链和反馈，修复 errors 并处理 warnings；不要以少做功能换取校验通过。
- inspect_page 只提供静态证据，不执行浏览器交互。最终用产品设计人员能理解的中文说明实际完成的效果、原型演示边界与待验证项；没有工具或运行证据时不得声称点击、保存、拖拽等交互已经测试通过。`;
