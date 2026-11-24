# Claude Code / Cursor + MCP 画可运行 B 端原型实战：从共享 ER 表到直出 DDL 写全栈代码

> **适用平台**：CSDN 博客、掘金、微信公众号技术号  
> **关键词覆盖**：`AI 原型设计`、`Claude Code 画原型`、`Cursor 原型设计`、`MCP 协议`、`ProtoFlow AI`

---

用 Claude Code、Cursor 或 Codex 写代码已经成了日常，但做 B 端中后台系统（ERP、CRM、业财审批）时，很多团队都会卡在一个痛点上：

- **直接让 Coding Agent 吐网页**：它很容易猜错业务边界，页面之间的数据各自编一套硬编码 Mock，切个页状态就丢了，改一个字段又把整页布局洗乱；
- **先用传统画图工具画线框图再交接**：不仅画出来的原型点不动、数据不互通，研发阶段的 Coding Agent 也读不到画布里的表结构和按钮约束，只能靠长篇 Word 文档反复对齐。

今天分享一套**开源、本机优先的闭环工作流**：用 **ProtoFlow AI（原名 Alex）** 的 **MCP（Model Context Protocol）双向协议**，先让 Claude Code / Cursor 直接在可视化画布里设计「带真实 ER 外键表」的可运行原型，评审通过后，再让 Coding Agent 零安装直读 PostgreSQL/MySQL DDL、页面 TSX 和需求便签去写全栈生产代码。

- 开源仓库：[https://github.com/EvanClub-Agent/protoflow-ai](https://github.com/EvanClub-Agent/protoflow-ai)（Apache-2.0）
- 免下载浏览器体验（CRM 业财联动演示）：[https://alex.xclubai.com/demo/](https://alex.xclubai.com/demo/)
- 官方 MCP 文档：[https://alex.xclubai.com/mcp/](https://alex.xclubai.com/mcp/)

---

## 一、为什么这套工作流能打通「画原型 → 写代码」？

ProtoFlow AI 把 MCP 拆成了两个阶段，正好对应产品设计与工程研发的上下游：

1. **设计期：双向实时画布（`--mode readwrite --desktop-bridge`，18 个受控工具）**
   - 在桌面客户端打开 `.pflow` 工程并启用 **「MCP 接入 → 本地 → 双向设计」**。
   - Claude Code、Cursor、Codex 或 Google Antigravity 可以：
     - 用 `protoflow_upsert_db_tables` 建物理表，声明主键、外键（`REFERENCES`）、单列唯一及复合唯一约束；
     - 用 `protoflow_manage_table_rows` 灌入满足外键约束的预览种子数据；
     - 用 `protoflow_write_page` / `protoflow_edit_page_block` 编写 `<Page>`（PC 宽屏）或 `<MobilePage>`（iPhone 视口）页面，或者针对画布上选中的组件 `selectedPfId` 做无损局部精修；
     - 用 `protoflow_manage_sticky_notes` 给按钮、表单字段贴上黄色「需求便签」（写明校验精度、防超额规则、状态机守卫）；
     - 用 `protoflow_audit_project` 做跨页闭环巡检，并用 `protoflow_capture_preview` 截取高清 PNG 预览图自检排版。
2. **研发期：零安装远程只读规格中枢（`POST /api/v1/mcp/<shareId>`，6 个只读工具）**
   - 原型发布成在线评审链接 `/p/{id}` 后，前后端工程师不需要装客户端或下载 `.pflow` 文件，只要在 IDE 里贴一条远程 MCP URL，就能直接读取站点目录、标准 DDL、页面 TSX 和便签验收清单。

---

## 二、实战演示：用官方标杆工程 `crm-contract-billing.pflow` 跑通全链路

仓库 `examples/crm-contract-billing/` 自带了一套完整的企业级业财协同标杆工程（也可以直接在官网 [在线演示页](https://alex.xclubai.com/demo/) 免下载体验）：

- **5 张跨端共享 ER 物理表**：
  - `t_crm_customers`（客户商机表，含 `customer_code` 与 18 位税号 `credit_code` 双单列唯一约束）
  - `t_crm_contracts`（销售合同主表，外键关联 `t_crm_customers(id)`）
  - `t_crm_payment_plans`（分期回款计划子表，带表级复合唯一约束 `uq_contract_stage (contract_id, stage_no)`）
  - `t_crm_invoices`（数电开票申请表，外勤移动端提交、PC 财务端复核）
  - `t_crm_monthly_revenue`（月度签约与回款趋势表，驱动 ECharts 折线图）
- **6 个联动页面（4 个 PC 后台页 + 2 个 iPhone 视口页）**：PC 录入合同、移动端一键法务会签、主子表抽屉下钻分期回款，同一份数据实时同步。
- **9 条组件级需求便签 + 2 篇 PRD 笔记 + 1 张 Mermaid 流程图**。

---

## 三、手把手配置：把 ProtoFlow MCP 接入你的 Coding Agent

### 方式 1：设计期连接桌面画布（让 AI 直接帮你画原型、建 ER 表）

1. 从 [GitHub Releases](https://github.com/EvanClub-Agent/protoflow-ai/releases) 或源码启动桌面端（源码仅需 Node.js 22+：`npm install && npm run electron:start`；注：桌面安装包当前沿用 `Alex` 应用名）。
2. 在顶部工具栏点击 **「MCP 接入」**：
   - 使用 **Google Antigravity**：点击内置的一键安装插件按钮；
   - 使用 **Claude Desktop**：一键导出 `.mcpb` 扩展包双击安装；
   - 使用 **Claude Code / Cursor / Codex**：直接复制面板生成的本地 `--desktop-bridge` 配置即可，无需手动写复杂路径。

### 方式 2：研发期只读本地 `.pflow` 或远程 `/p/{id}` 写全栈代码

在项目里直接挂一个 `.pflow` 文件给 Claude Code / Cursor（确保仓库根目录下先跑过 `npm run build:contracts`）：

```json
{
  "mcpServers": {
    "protoflow": {
      "command": "node",
      "args": [
        "/绝对路径/protoflow-ai/packages/protoflow-mcp/dist/cli.cjs",
        "--project",
        "/绝对路径/protoflow-ai/examples/crm-contract-billing/crm-contract-billing.pflow"
      ]
    }
  }
}
```

如果团队部署了自托管评审服务（`docker compose --env-file deploy/.env -f deploy/compose.yml up -d`），研发更省事——直接用远程 Streamable HTTP（完全零安装）：

```json
{
  "mcpServers": {
    "protoflow": {
      "url": "https://your-protoflow-domain.com/api/v1/mcp/<shareId>"
    }
  }
}
```

或在 Claude Code CLI 中一行添加：

```bash
claude mcp add --transport http protoflow https://your-protoflow-domain.com/api/v1/mcp/<shareId>
```

---

## 四、直接可用的实战 Prompt 模板

连好 MCP 后，把下面这段指令直接发给 Claude Code 或 Cursor：

```text
请调用 protoflow MCP 工具依次读取当前工程的信息：
1. 调用 protoflow_get_project_overview 获取项目模块目录与页面列表；
2. 调用 protoflow_get_database_schema 导出完整 ER 表结构、PostgreSQL/MySQL DDL 与样例数据；
3. 调用 protoflow_get_docs_and_flows 读取 PRD 笔记和业务流程图；
4. 逐页调用 protoflow_get_page_spec 读取 6 个页面的 TSX、表字段绑定、交互动作和黄色需求便签规则。

请严格基于上述规范，使用 React + Ant Design + Node.js + PostgreSQL 初始化并实现这套「CRM 合同与回款开票业财系统」。
完成后调用 protoflow_get_implementation_checklist 逐条核对防超额核销、防超额开票、18 位税号校验与主子表外键接口是否全部落地。
```

---

## 五、总结

过去「原型工具只负责画假图，Coding Agent 只负责盲猜写网页」的割裂正在消失。把 **ProtoFlow AI** 放在「需求澄清 + ER 建模 + 可交互原型」和「IDE Coding Agent」中间当**单一事实源（Single Source of Truth）**，产品经理能当场演示真正流转的数据闭环，研发和 AI 写出来的代码也不再漏字段、漏外键和漏边界校验。

欢迎体验：
- 浏览器在线沙盒（免下载）：[https://alex.xclubai.com/demo/](https://alex.xclubai.com/demo/)
- GitHub 开源地址：[https://github.com/EvanClub-Agent/protoflow-ai](https://github.com/EvanClub-Agent/protoflow-ai)
