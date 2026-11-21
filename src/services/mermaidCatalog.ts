import { tr } from '../i18n/runtime';

/** Diagram IDs below are Mermaid 12.2 parser IDs, not project/document identifiers.
 * Samples are intentionally small, editable starting points, never project data. */
export interface MermaidDiagramTemplate {
  id: string;
  readonly label: string;
  diagramTypes: readonly string[];
  readonly code: string;
  docs: string;
}
function template(
  id: string,
  labelZh: string,
  labelEn: string,
  codeZh: string,
  codeEn: string,
  doc: string,
  diagramTypes: readonly string[] = [id]
): MermaidDiagramTemplate {
  return {
    id,
    get label() {
      return tr(labelZh, labelEn);
    },
    get code() {
      return tr(codeZh + '\n', codeEn + '\n');
    },
    docs: `https://mermaid.js.org/syntax/${doc}.html`,
    diagramTypes,
  };
}
export const MERMAID_DIAGRAM_TEMPLATES: readonly MermaidDiagramTemplate[] = [
  template('mindmap', '思维导图', 'Mindmap', `mindmap
  root((项目规划))
    项目目标
      用户需求
    功能模块
      核心功能
    交付计划`, `mindmap
  root((Project Plan))
    Objectives
      User Needs
    Modules
      Core Features
    Delivery Roadmap`, 'mindmap'),
  template('flowchart', '流程图', 'Flowchart', `---
config:
  layout: dagre
---
flowchart TB
  Start([开始]) --> Submit[提交申请]
  Submit --> Approved{审批通过?}
  Approved -->|通过| Done([完成])
  Approved -->|退回| Submit`, `---
config:
  layout: dagre
---
flowchart TB
  Start([Start]) --> Submit[Submit Request]
  Submit --> Approved{Approved?}
  Approved -->|Yes| Done([Completed])
  Approved -->|Return| Submit`, 'flowchart', ['flowchart-v2', 'flowchart-elk']),
  template('sequence', '时序图', 'Sequence Diagram', `sequenceDiagram
  actor User as 用户
  participant App as 应用
  participant DB as 数据库
  User->>App: 提交请求
  App->>DB: 查询数据
  DB-->>App: 返回结果
  App-->>User: 展示结果`, `sequenceDiagram
  actor User as User
  participant App as Application
  participant DB as Database
  User->>App: Submit request
  App->>DB: Query records
  DB-->>App: Return rows
  App-->>User: Render results`, 'sequenceDiagram'),
  template('classDiagram', '类图', 'Class Diagram', `classDiagram
  class Order {
    +String orderId
    +submit()
  }
  class OrderItem {
    +int quantity
  }
  Order "1" *-- "many" OrderItem : 包含`, `classDiagram
  class Order {
    +String orderId
    +submit()
  }
  class OrderItem {
    +int quantity
  }
  Order "1" *-- "many" OrderItem : contains`, 'classDiagram'),
  template('stateDiagram', '状态图', 'State Diagram', `stateDiagram-v2
  state "草稿" as Draft
  state "审核中" as Pending
  state "已通过" as Approved
  [*] --> Draft
  Draft --> Pending : 提交
  Pending --> Approved : 通过
  Pending --> Draft : 退回
  Approved --> [*]`, `stateDiagram-v2
  state "Draft" as Draft
  state "Pending Review" as Pending
  state "Approved" as Approved
  [*] --> Draft
  Draft --> Pending : Submit
  Pending --> Approved : Approve
  Pending --> Draft : Return
  Approved --> [*]`, 'stateDiagram'),
  template('er', '实体关系图', 'ER Diagram', `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_ITEM : contains
  CUSTOMER {
    string id PK
    string name
  }
  ORDER {
    string id PK
    string customer_id FK
  }`, `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_ITEM : contains
  CUSTOMER {
    string id PK
    string name
  }
  ORDER {
    string id PK
    string customer_id FK
  }`, 'entityRelationshipDiagram'),
  template('gantt', '甘特图', 'Gantt Chart', `gantt
  title 项目计划示例
  dateFormat YYYY-MM-DD
  section 设计
    需求梳理 :a1, 2026-11-01, 3d
    原型设计 :a2, after a1, 5d
  section 交付
    开发验收 :after a2, 7d`, `gantt
  title Sample Project Schedule
  dateFormat YYYY-MM-DD
  section Design
    Discovery :a1, 2026-11-01, 3d
    Prototyping :a2, after a1, 5d
  section Delivery
    Implementation & UAT :after a2, 7d`, 'gantt'),
  template('pie', '饼图', 'Pie Chart', `pie title 任务分布示例
  "待开始" : 3
  "进行中" : 5
  "已完成" : 8`, `pie title Sample Task Breakdown
  "Backlog" : 3
  "In Progress" : 5
  "Done" : 8`, 'pie'),
  template('journey', '用户旅程图', 'User Journey', `journey
  title 采购申请体验
  section 提交
    填写申请: 3: 申请人
    核对资料: 4: 申请人
  section 审批
    审核申请: 4: 审批人
    查看结果: 5: 申请人`, `journey
  title Purchase Request Experience
  section Submit
    Fill Form: 3: Requester
    Verify Details: 4: Requester
  section Review
    Approve Request: 4: Approver
    Check Outcome: 5: Requester`, 'userJourney'),
  template('timeline', '时间线', 'Timeline', `timeline
  title 项目里程碑示例
  规划阶段 : 需求梳理 : 范围确认
  设计阶段 : 原型评审
  交付阶段 : 验收上线`, `timeline
  title Project Milestones
  Planning : Discovery : Scope Sign-Off
  Design : Prototype Review
  Delivery : UAT & Launch`, 'timeline'),
  template('gitGraph', 'Git 分支图', 'Git Graph', `gitGraph
  commit
  branch feature
  checkout feature
  commit
  checkout main
  merge feature
  commit`, `gitGraph
  commit
  branch feature
  checkout feature
  commit
  checkout main
  merge feature
  commit`, 'gitgraph'),
  template('quadrantChart', '象限图', 'Quadrant Chart', `quadrantChart
  title 需求优先级示例
  x-axis Low effort --> High effort
  y-axis Low value --> High value
  quadrant-1 Plan
  quadrant-2 Prioritize
  quadrant-3 Optional
  quadrant-4 Review
  Feature A: [0.2, 0.8]
  Feature B: [0.7, 0.6]`, `quadrantChart
  title Feature Prioritization Matrix
  x-axis Low effort --> High effort
  y-axis Low value --> High value
  quadrant-1 Plan
  quadrant-2 Prioritize
  quadrant-3 Optional
  quadrant-4 Review
  Feature A: [0.2, 0.8]
  Feature B: [0.7, 0.6]`, 'quadrantChart'),
  template('requirement', '需求图', 'Requirement Diagram', `requirementDiagram
  requirement approval {
    id: REQ01
    text: approval required
    risk: medium
    verifymethod: test
  }
  element workflow {
    type: system
  }
  workflow - satisfies -> approval`, `requirementDiagram
  requirement approval {
    id: REQ01
    text: approval required
    risk: medium
    verifymethod: test
  }
  element workflow {
    type: system
  }
  workflow - satisfies -> approval`, 'requirementDiagram'),
  template('c4', 'C4 架构图', 'C4 Context Diagram', `C4Context
  title 系统上下文
  Person(user, "用户", "业务使用者")
  System(app, "业务系统", "管理项目业务")
  System_Ext(external, "外部服务", "提供协作能力")
  Rel(user, app, "使用")
  Rel(app, external, "调用")`, `C4Context
  title System Context
  Person(user, "User", "Business operator")
  System(app, "Business System", "Core application")
  System_Ext(external, "External Service", "Integration partner")
  Rel(user, app, "Uses")
  Rel(app, external, "Calls")`, 'c4'),
  template('sankey', '桑基图', 'Sankey Diagram', `sankey

Requirements,Design,10
Design,Development,8
Design,Pending,2
Development,Acceptance,8`, `sankey

Requirements,Design,10
Design,Development,8
Design,Pending,2
Development,Acceptance,8`, 'sankey'),
  template('xychart', 'XY 图表', 'XY Chart', `xychart
  title "月度数据示例"
  x-axis [Jan, Feb, Mar, Apr]
  y-axis "数量" 0 --> 100
  bar [25, 40, 65, 80]
  line [20, 35, 60, 75]`, `xychart
  title "Monthly Metrics Sample"
  x-axis [Jan, Feb, Mar, Apr]
  y-axis "Volume" 0 --> 100
  bar [25, 40, 65, 80]
  line [20, 35, 60, 75]`, 'xyChart'),
  template('block', '块图', 'Block Diagram', `block
  columns 3
  A["输入"] B["处理"] C["输出"]
  A --> B
  B --> C`, `block
  columns 3
  A["Input"] B["Process"] C["Output"]
  A --> B
  B --> C`, 'block'),
  template('packet', '数据包图', 'Packet Diagram', `packet
  0-7: "Header"
  8-15: "Type"
  16-31: "Payload"`, `packet
  0-7: "Header"
  8-15: "Type"
  16-31: "Payload"`, 'packet'),
  template('kanban', '看板', 'Kanban Board', `kanban
  todo[待开始]
    task1[需求梳理]
  doing[进行中]
    task2[原型设计]
  done[已完成]
    task3[项目启动]`, `kanban
  todo[Backlog]
    task1[Discovery]
  doing[In Progress]
    task2[Prototyping]
  done[Done]
    task3[Kickoff]`, 'kanban'),
  template('architecture', '架构图', 'Architecture Diagram', `architecture-beta
  group api(cloud)[API]
  service app(server)[Application] in api
  service db(database)[Database] in api
  app:R -- L:db`, `architecture-beta
  group api(cloud)[API]
  service app(server)[Application] in api
  service db(database)[Database] in api
  app:R -- L:db`, 'architecture'),
  template('radar', '雷达图', 'Radar Chart', `radar-beta
  axis Quality, Speed, Cost, Experience
  curve current{4, 3, 2, 5}
  curve target{5, 4, 4, 5}`, `radar-beta
  axis Quality, Speed, Cost, Experience
  curve current{4, 3, 2, 5}
  curve target{5, 4, 4, 5}`, 'radar'),
  template('treemap', '矩形树图', 'Treemap', `treemap-beta
"业务模块"
  "采购": 30
  "仓储": 20
"基础资料"
  "物料": 15
  "供应商": 10`, `treemap-beta
"Core Modules"
  "Procurement": 30
  "Warehouse": 20
"Master Data"
  "Catalog": 15
  "Suppliers": 10`, 'treemap'),
  template('venn', '韦恩图', 'Venn Diagram', `venn-beta
  title Feature planning
  set Useful
  set Feasible
  union Useful,Feasible["Priority"]`, `venn-beta
  title Feature planning
  set Useful
  set Feasible
  union Useful,Feasible["Priority"]`, 'venn'),
  template('swimlane', '泳道图', 'Swimlane Diagram', `swimlane-beta LR
  subgraph Applicant[申请人]
    Submit[提交申请]
  end
  subgraph Reviewer[审批人]
    Review[审核申请]
  end
  Submit --> Review`, `swimlane-beta LR
  subgraph Applicant[Requester]
    Submit[Submit Request]
  end
  subgraph Reviewer[Approver]
    Review[Review Request]
  end
  Submit --> Review`, 'swimlanes'),
  template('usecase', '用例图', 'Use Case Diagram', `usecase-beta
  direction LR
  actor User("用户")
  systemBoundary "业务系统"
    Create("发起申请")
    Query("查询结果")
  end
  User --> Create
  User --> Query`, `usecase-beta
  direction LR
  actor User("User")
  systemBoundary "Business System"
    Create("Submit Request")
    Query("Query Status")
  end
  User --> Create
  User --> Query`, 'usecase'),
  template('eventmodeling', '事件建模图', 'Event Modeling', `eventmodeling
  tf 01 ui ApplicationForm
  tf 02 cmd SubmitApplication
  tf 03 evt ApplicationSubmitted`, `eventmodeling
  tf 01 ui ApplicationForm
  tf 02 cmd SubmitApplication
  tf 03 evt ApplicationSubmitted`, 'eventmodeling'),
  template('ishikawa', '鱼骨图', 'Ishikawa Diagram', `ishikawa-beta
  交付延期
  流程
    审批等待
    需求变更
  资源
    人员不足
  环境
    外部依赖`, `ishikawa-beta
  Delivery Delay
  Process
    Approval Bottleneck
    Scope Creep
  Resources
    Staffing Gap
  Environment
    External Dependency`, 'ishikawa'),
  template('wardley', 'Wardley 地图', 'Wardley Map', `wardley-beta
  title Service map
  anchor User [0.95, 0.3]
  component Application [0.7, 0.5]
  component Database [0.4, 0.8]
  User -> Application
  Application -> Database`, `wardley-beta
  title Service map
  anchor User [0.95, 0.3]
  component Application [0.7, 0.5]
  component Database [0.4, 0.8]
  User -> Application
  Application -> Database`, 'wardley'),
  template('cynefin', 'Cynefin 图', 'Cynefin Framework', `cynefin-beta
  title Decision contexts
  complex
  "Explore new needs"
  complicated
  "Analyze architecture"
  clear
  "Follow procedure"
  chaotic
  "Handle incident"
  confusion
  "Gather context"`, `cynefin-beta
  title Decision contexts
  complex
  "Explore new needs"
  complicated
  "Analyze architecture"
  clear
  "Follow procedure"
  chaotic
  "Handle incident"
  confusion
  "Gather context"`, 'cynefin'),
  template('treeView', '目录树图', 'Tree View', `treeView-beta
  project/
    pages/
      home.tsx
    diagrams/
      overview.mmd
    README.md`, `treeView-beta
  project/
    pages/
      home.tsx
    diagrams/
      overview.mmd
    README.md`, 'treeView'),
  template('zenuml', 'ZenUML 时序图', 'ZenUML Sequence', `zenuml
  title Request flow
  User->Application: Submit
  Application->Database: Save
  Database->Application: Done`, `zenuml
  title Request flow
  User->Application: Submit
  Application->Database: Save
  Database->Application: Done`, 'zenuml'),
];
export function mermaidTemplate(id: string): MermaidDiagramTemplate {
  const item = MERMAID_DIAGRAM_TEMPLATES.find(item => item.id === id);
  if (!item) throw new Error(tr('未知的 Mermaid 图表类型', 'Unknown Mermaid diagram type'));
  return item;
}
export function mermaidTypeLabel(diagramType: string): string {
  const item = MERMAID_DIAGRAM_TEMPLATES.find(item => item.diagramTypes.includes(diagramType));
  return item === undefined ? diagramType : item.label;
}
