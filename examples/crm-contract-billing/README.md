# 标杆案例：CRM 合同与回款开票业财协同系统（`.pflow` → MCP → 全栈代码）

本目录包含 **Alex (ProtoFlow AI)** 官方提供的首个企业级 B 端标杆工程 [`crm-contract-billing.pflow`](./crm-contract-billing.pflow)，完整演示**「商机客户建档 → 销售合同法务会签 → 分期回款计划与防超额水单核销 → 增值税数电开票 → 销售外勤移动端实时共表」**的业财一体化闭环。

---

## 1. 工程规格亮点一览

- **5 张跨菜单、跨端共享物理表（ER）**：
  - `t_crm_customers`（企业客户与商机表）：含 `customer_code` 与 18 位 `credit_code` 双单列唯一约束；
  - `t_crm_contracts`（销售合同主表）：外键关联 `t_crm_customers(id)`，统一归集 `contract_amount`、`received_amount`、`invoiced_amount`（均为 `DECIMAL(14,2)`）；
  - `t_crm_payment_plans`（合同分期回款计划表）：外键关联 `t_crm_contracts(id)`，声明表级复合唯一约束 **`uq_contract_stage (contract_id, stage_no)`**；
  - `t_crm_invoices`（增值税开票申请表）：外键关联 `t_crm_contracts(id)`，由外勤移动端与 PC 财务工作台实时共用；
  - `t_crm_monthly_revenue`（月度签约与回款趋势表）：驱动三序列折线剪刀差监控。
- **6 个交互式页面（4 个 PC 宽屏后台页 + 2 个 iPhone 真机视口移动页）**：
  - PC 端：`crm-dashboard`（经营与逾期看板）、`crm-customers`（客户商机池）、`crm-contracts`（合同审批 + 主子表抽屉下钻回款计划）、`crm-finance`（回款核销与数电开票工作台）；
  - 移动端：`mob-crm-approvals`（手机端一键会签合同 + 半屏抽屉查看分期回款）、`mob-crm-invoice`（客户现场关联生效合同极速提报开票）。
- **9 条组件级「黄色需求便签」+ 2 篇 PRD 规范笔记 + 1 张全链路闭环流程图**：
  - 明确锚定了防超额核销事务锁、防超额开票计算公式、18 位税号校验、价税分离尾差倒算（`税额 = 含税总额 - 不含税额`）及状态机守卫条件。

---

## 2. 如何打开体验

1. **在 Alex 工作台中直接打开**：
   启动 Alex 桌面端或本地开发工作台（`npm run dev`），点击打开本地工程并选择 `examples/crm-contract-billing/crm-contract-billing.pflow`（或在新建项目时直接选择 **「CRM 合同与业财回款系统」** 样板）。
2. **重新导出最新 `.pflow`（修改样板源码后）**：
   ```bash
   node scripts/export-crm-showcase.cjs
   ```

---

## 3. 连接 Claude Code / Cursor / Antigravity 直接生成全栈生产代码

先确保已构建本地 MCP CLI（`npm run build:contracts`），然后在你的 Coding Agent 中添加如下 MCP 配置：

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

*(若已将该工程发布至团队自托管服务 `/p/<shareId>`，也可直接使用免安装的远程 Streamable HTTP 地址 `https://<your-domain>/api/v1/mcp/<shareId>`。)*

### 推荐实战指令（Prompt）

将以下指令发给连接好 `protoflow` MCP 的 Coding Agent：

> 请调用 `protoflow` MCP 依次读取当前工程的项目全景（`protoflow_get_project_overview`）、完整数据库 Schema 与 DDL（`protoflow_get_database_schema`）、2 篇业财 PRD 笔记与流程图（`protoflow_get_docs_and_flows`），以及全部 6 个 PC 与移动端页面的交互规格与黄色便签规则（`protoflow_get_page_spec`）。
>
> 基于读取到的精确表结构、单列与复合唯一约束、外键关系、样例种子数据与便签业务校验规则，使用 **React + Ant Design + Node.js (Fastify/Express) + PostgreSQL/SQLite** 初始化并实现这套「CRM 合同与回款开票业财协同系统」，完成后调用 `protoflow_get_implementation_checklist` 逐项核对防超额核销、防超额开票、价税尾差倒算与主子表接口无遗漏。
