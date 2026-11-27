import { DATABASE_DESIGN_RULES } from '../database/designReview';
import { FREEFORM_AI_RULES } from '../freeform/metadata';
import { TASK_IMPLEMENTATION_RULES } from './implementationGuide';
import { CHART_AI_RULES } from '../charts/metadata';
import type { ProjectMode } from '../mobile/types';

export const DESKTOP_MATERIAL_RULES = `桌面端页面（<Page>）专属规范：
- 桌面端普通表、树形表、行内展开详情、合并行列和可编辑单元格都优先使用 Table 物料。遇到这些需求，读取 protoflow_get_implementation_guide 的 list 场景和 protoflow_get_contracts({componentNames:["Table"]}) 的 examples 与列契约。绑定业务表时，通过 protoflow_get_db_table 和 protoflow_get_table_rows 核对字段、原始值和行 ID，再配置层级、合并区域或编辑器。严禁混用 M* 移动端物料。
- 交互范式与高颜视觉选型（避免千篇一律“灰底查询+宽表+弹窗”）：① 根容器 <Page> 支持 surfaceBg（mist / pure / warm_paper / sage_field / aurora / oled_carbon）、accent（含 obsidian、lime_forest）与 appearance（auto / light / dark），必须遵循【全工程同源视觉铁律】：先定整套产品唯一的一组 (surfaceBg, accent, motion) 并在同工程所有 PC/移动页严格复用（若已有兄弟页，必须继承 visualBaseline.dominant），常规页面一律默认使用 appearance="auto"（或省略 appearance）且不锁死 designTokens.colorMode，使原型能随工作台外框浅色/深色主题自如切换；严禁无故写死 appearance="light" 阻断深色模式，也严禁看板一色、工作台一色、日历又切纯黑拼盘！页面内遵循 85% 统一底布与纯净 <Card variant="bento"> + 10% 单页唯一深色压舱焦点（如首列 <Statistic tone="inverted" splitDecimal={true} sparkline={true}> 或 <Card variant="inverted">）+ 5% 严格业务语义色（翡翠绿=达标、琥珀=预警、绯红=高危/撤销）；注意 tone="dark_brief" 仅配搭 lime_forest/emerald/sage_field 绿系工程，在 obsidian/mist/indigo/blue 冷调工程中统一用 <AiCopilotCard tone="indigo">；② 高频审单、客诉工单优先采用左右主从视图（左 Col 放带 autoSelectFirst={true} 与 selectRow() 的 Table / Repeater / Kanban / ActivityFeed，右 Col 放 <Card activeTable="表ID"> 内嵌 Descriptions、Form 或明细子表）；③ 目标达成与水位对比优先用 ProgressBoard（gauge 双半环仪表 / capsule 胶囊条），收支/领料变动流水优先用 ActivityFeed；④ 阶段流转用 Kanban，排期日程用 Calendar，自定义卡片用 Repeater。
- 状态与防错规范：核心业务页可在 <Page> 配置 emptyTitle、errorFallback（"component" | "result_403" | "result_500"）完善 UI Stack 五态规格；表单上下限/跨字段比较配置 minField/maxField/formatRule；有状态前提的按钮或 rowActions 配置 disabledWhenField/disabledWhenValue/disabledReason；常规删除推荐 deleteRow("undo")，高危操作推荐 confirm(提示, "{{row.单号}}")。
- 桌面端栅格布局分两层：Row 内 Col.span 决定列宽（每行共 24 格），列内组件 width="full" 仅填满本列。没有明确留白需求时，同一行各列 span 合计应为 24，例如左右各 12 或 16+8；不能只设置图表 width="full" 就声称整行已铺满。Card.cols/Form.cols 会影响未显式设置 width 的子组件占宽。Modal/Drawer 声明在 Page 根部，width 为数字像素；普通组件的 width 是画布占宽枚举。表单字段绑定显式 name；Form 的 fields 与子字段组件不能同时使用。
- 桌面端查询区优先使用 QueryForm.fields，通常 cols={3} 或 cols={4}、layout="horizontal"、size="small" 或 "middle"、defaultExpanded={false}。普通查询控件 controlMaxWidth 默认 240px，日期范围 rangeMaxWidth 默认 320px；除非用户明确要求宽大输入，不要增大上限或使用 size="large"。width="full" 只表示查询区容器占满一行，不代表其中的控件也要拉满。保留所有查询字段，更多条件通过展开显示；不要靠删除字段变紧凑。
- Axure 兼容物料（AxureCanvas、PositionedGroup、StaticTable、DynamicPanel、OutlineTree 等）与 Figma 还原物料（FigmaCanvas、FigmaFrame、FigmaText、FigmaVector、FigmaImage）仅用于保留已导入的外部设计稿源页面；新建业务页面或将导入页重塑为标准物料时必须使用 Table、CardGrid、Repeater、Kanban、Calendar、Form、QueryForm、NavMenu、Tabs 等高语义物料（移动端使用 MobilePage 及 M* 物料）。`;

export const MOBILE_MATERIAL_RULES = `移动端页面（<MobilePage>）专属规范：
- 根组件必须使用 MobilePage，严禁混用桌面端 Table、QueryForm、Card、Row/Col、Modal、Drawer。实现前读取 protoflow_get_implementation_guide({scenarioIds:["mobile"]}) 及对应 M* 契约。
- 同源视觉与三段式结构：同一工程内所有 MobilePage 必须锁定同一套 surfaceBg、accent 与 motion，并默认使用 appearance="auto" 跟随外框明暗主题（若工程已有 PC 或移动页，必须继承 visualBaseline.dominant 的同源色系，严禁在三个底部 Tab 之间混跳绿底、蓝紫底与纯黑底！例如金融/政企/高端制造统一用 appearance="auto" surfaceBg="mist" accent="obsidian"，户外绿调系统统一用 appearance="auto" surfaceBg="sage_field" accent="lime_forest"）；顶部用 MTopBar；中部按业务选用同系首屏焦点卡 MHeroHeader（wallet 资产卡 / metric_hero 大字重进度卡）、MAiInsightCard（obsidian/mist/blue/gemini 工程用 tone="glow"，仅绿调工程用 tone="dark_brief"）、MProgressList（优先 gauge 双半环仪表或 capsule 胶囊进度）、MActivityList（左滑流水）、MBentoGrid、MFeedList、MTaskList、MKanban、MCalendar 或 MRepeater，搭配 MSearchPill/MPillTabs.target 筛选，也可用 <MSurface activeTable="表ID">（含 tone="inverted"）做主从联动；底部用 MFloatingBar、MTabBar（支持 avatarText 双岛）、MBottomDock 或 MComposerBar。
- 状态与防错：支持 emptyTitle、errorFallback 与 motion；MField/MSheetPicker 支持 minField/maxField/formatRule；MButton 及 MTaskList/MKanban/MActivityList.rowActions 支持 disabledWhenField/hiddenWhenField；删除推荐 deleteRow("undo")。
- 关联明细：在弹层或目标页的 MTaskList/MActivityList/MProgressList/MFeedList/MRepeater/MKanban/MCalendar 上配置 table + sourceForeignKey（真实外键字段名），由来源行事件 openDrawer/openModal 或 navigate(目标页,"row") 传入来源行（不沿用旧会话结论）；无来源时必须为空，禁用全量列表冒充明细隔离。弹层用 MBottomSheet / MDialog，表单用 MForm + MField/MSheetPicker/MChipSelect/MMediaInput。`;

export const CORE_MATERIAL_RULES = `物料规范是强制契约：
- 页面源码是单个 export default function Page() { return (...); }，桌面页使用 Page 根组件，移动页使用 MobilePage。按目标页面的平台选择对应物料体系（混合工程的新页面必须在方案中逐页声明 platform）；外层只描述物料树，不是任意 React 应用。
- 只使用本项目 protoflow_get_contracts 返回的组件、props、events 和 valueSchema。Ant Design 官网存在的组件/属性，不代表本项目已接入；未登记的功能必须说明暂不支持，不能凭空编造或借用相似字段。
- 写页面前先按任务场景调用 protoflow_get_implementation_guide，再逐一通过 protoflow_get_contracts 读取所用组件契约（含嵌套列表对象，$ref 对应 materialValueDefinitions）；已有页面先用 protoflow_inspect_page 检查结构与绑定，修改后再次 protoflow_inspect_page 复核。不可只看组件名称或沿用旧对话中的属性与表结构。
- 采用分区增量生成：先简短说明正在处理的页面；新页先用 protoflow_apply_tsx_patch 提交对应平台的有效页面框架和标题，再用 protoflow_edit_page_block 逐块添加内容，每完成一个完整区块就调用工具。已有页面优先 replace_node 局部替换并保留目标 pfId，append_children 只追加到明确容器；小改动可直接提交完整页。引用的弹层/组件要先创建或在同一区块一起提交。所有区块在整轮成功后才统一保存；最终回复描述实际结果即可，不要重复整页源码。
- 属性名区分大小写；布尔值写 {true}/{false}，数值写 {数字}，枚举只能取契约列出的值。options 的 label 是显示文字，value 是实际值，禁止用 id/code/name 猜测替代。
- 外层页面所有节点显式提供唯一稳定 pfId。外层事件只允许零参数动作链，且只能使用登记动作及其准确参数；禁止在外层自写回调逻辑、表达式、import、变量、原生 HTML、style/className 等未登记属性。Button/Text/Title/Tag/Avatar 的文字写在子内容；不能捏造 text、children、label 属性。Tabs 只接受 Tab，Collapse 只接受 CollapsePanel，Row 只接受 Col；Modal/Drawer 声明在 Page 根部，MDialog/MBottomSheet 声明在 MobilePage 根部。Freeform.source 内部按自由组件契约编写。
- 关键交互必须形成“触发组件 → 动作 → 目标 → 数据变化/反馈”闭环：保存必须调用 submitForm 并绑定真实 Form/MForm 与业务表，状态变更必须调用 updateRow 更新准确字段，页面跳转必须调用 navigate 指向真实 pageId，严禁仅用 toast 或 closeOverlay 冒充保存或状态流转成功。
- MCP 在暂存前校验物料；报错会指出 pfId、属性路径和合法值，本次调用不会暂存。按契约修正并在同一轮重试；不能删除用户要求的字段、绑定或交互来绕过错误。主程序在写入前再次校验，未成功提交不得声称已完成。`;

export function buildMaterialGenerationRules(platform: ProjectMode = 'hybrid'): string {
  const platformRules = platform === 'mobile'
    ? `${MOBILE_MATERIAL_RULES}\n\n（若项目中涉及桌面页，另遵循以下桌面规则）\n${DESKTOP_MATERIAL_RULES}`
    : platform === 'desktop'
      ? `${DESKTOP_MATERIAL_RULES}\n\n（若项目中涉及移动页，另遵循以下移动规则）\n${MOBILE_MATERIAL_RULES}`
      : `${DESKTOP_MATERIAL_RULES}\n\n${MOBILE_MATERIAL_RULES}`;
  return `${CORE_MATERIAL_RULES}

${platformRules}

${DATABASE_DESIGN_RULES}

${FREEFORM_AI_RULES}

${CHART_AI_RULES}

${TASK_IMPLEMENTATION_RULES}`;
}

export const MATERIAL_GENERATION_RULES = buildMaterialGenerationRules('hybrid');
