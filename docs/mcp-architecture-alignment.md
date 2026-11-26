# 双端 MCP 架构对齐与视觉自检演进规范

状态：2026-11-26 制定并落地。覆盖内置 Hermes MCP（`electron/protoflow-mcp.cjs`）与外部生态双向/只读 MCP（`src/mcp/*`）的职责分层、共享原语边界、Axure/Figma 重构能力对齐，以及内置 Hermes 候选态离屏截图预览（`protoflow_capture_preview`）。

---

## 1. 双轨定位与不合并的事务外壳

Alex 当前同时维护两条 AI 协同轨道，面向不同用户群体与并发模型，**保留各自独立的会话与事务外壳，不强行合并传输层**：

| 维度 | 轨道 A：内置 Hermes MCP (`electron/protoflow-mcp.cjs`) | 轨道 B：外部双向 / 只读 MCP (`src/mcp/*`) |
| --- | --- | --- |
| 目标场景 | 产品经理零配置开箱即用、向导式建项、多页长批次生成與断点恢复 | 研发/设计师使用 Claude Code、Cursor、Codex、Antigravity 结对设计与全栈交付 |
| 状态读写形态 | 磁盘 `context.json` **候选暂存** → 宿主验收 → 零 `await` 同步落盘 | 内存克隆修改 → **`expectedRevision` 乐观锁** → 即时渲染与桌面 `Undo/Redo` 栈 |
| 历史与依赖追踪 | `v3 DependencyFootprint` 读写集证明 + 三态 ACP 历史边界 | 无会话状态，单请求携带 `expectedRevision` 串行提交 |
| 并发互斥 | 与轨道 B 共享工程级互斥锁 `pendingProjectAiTasks` | 与轨道 A 共享工程级互斥锁 `pendingProjectAiTasks` |

---

## 2. 工具层三类边界清单（止血重复开发准则）

所有 MCP 工具按职责划分为三类。凡属第 1 类（共享领域能力）的 Schema、AST 转换、契约校验与快照构造，统一实现在 `src/proto/*` 与 `src/mcp/*` TypeScript 纯函数层，经 `scripts/build-material-contract.cjs` 编译进 `electron/generated/material-contract.cjs` 供双端同源调用，禁止在 `electron/protoflow-mcp.cjs` 中维护第二份业务实现。

### 2.1 共享领域能力（双端对齐、同源纯函数）

| 领域能力 | 内置 Hermes 工具名 | 外部 MCP 工具名 | 同源实现模块 |
| --- | --- | --- | --- |
| 场景指南与物料契约 | `protoflow_get_implementation_guide`、`protoflow_get_contracts` | `protoflow_get_implementation_guide`、`protoflow_get_contracts` | `src/proto/ai/implementationGuide.ts`、`src/proto/registry/materialContract.ts` |
| 页面全量写入与局部块编辑 | `protoflow_apply_tsx_patch`、`protoflow_edit_page_block` | `protoflow_write_page`、`protoflow_edit_page_block` | `src/proto/ai/pageContract.ts`、`src/proto/dsl/editBlock.ts`、`src/mcp/importReshape.ts` |
| 页面静态检查与导入图层读取 | `protoflow_inspect_page`（含 `view="axure" \| "figma"`） | `protoflow_get_page_spec`（含 `importView`）+ `protoflow_reshape_imported_page(action="inspect_page")` | `src/proto/ai/pageInspection.ts`、`src/proto/axure/optimization.ts`、`src/proto/figma/optimization.ts` |
| Axure RP / Figma 盘点与流式重塑 | `protoflow_inspect_axure_project`、`protoflow_reshape_axure_page`、`protoflow_bind_axure_table`、`protoflow_optimize_axure_block`、`protoflow_inspect_figma_project`、`protoflow_reshape_figma_page` | `protoflow_reshape_imported_page`（`inspect_project`、`inspect_page`、`reshape_axure_page`、`bind_axure_table`、`optimize_axure_block`、`reshape_figma_page`） | `src/mcp/importReshape.ts`、`src/proto/axure/*`、`src/proto/figma/*` |
| ER 表建模与预览数据管理 | `protoflow_get_db_table`、`protoflow_upsert_db_table`、`protoflow_upsert_db_column`、`protoflow_get_table_rows`、`protoflow_add_preview_scenario` | `protoflow_get_database_schema`、`protoflow_upsert_db_tables`、`protoflow_manage_table_rows` | `src/proto/database/designReview.ts`、`src/proto/database/previewScenario.ts` |
| 目录菜单、便签、笔记与约定 | `protoflow_upsert_folder`、`protoflow_move_sitemap_item`、`protoflow_get_sticky_notes`、`protoflow_upsert_sticky_contract`、`protoflow_get_project_notes`、`protoflow_upsert_project_agreement`、`protoflow_remove_project_agreement` | `protoflow_manage_sitemap`、`protoflow_manage_sticky_notes`、`protoflow_get_docs_and_flows`、`protoflow_manage_docs_and_flows` | `src/proto/sitemap.ts`、`src/proto/notes.ts`、`src/services/projectKnowledge.ts` |
| 真实离屏渲染截图预览 | `protoflow_capture_preview`（渲染未提交候选快照 `context.snapshot`） | `protoflow_capture_preview`（渲染当前桌面活动工程） | `src/mcp/capturePreview.ts`、`electron/capture-preview.cjs` |

### 2.2 仅内置 Hermes 专有的向导与恢复门禁工具

- `protoflow_get_project_brief`：压缩后与执行前的权威工程摘要门禁。
- `protoflow_ask_questions`：桌面项目对话内嵌交互式问题卡。
- `protoflow_set_project_plan` / `protoflow_revise_project_page`：多页批量生成前的完整方案与依赖/验收用例审批。
- `protoflow_review_db_requirements` / `protoflow_run_closed_loop_audit`：项目级需求核销账本与问题修复状态流转。
- `protoflow_search_history`：受三态 ACP 表面与谱系白名单保护的本地会话检索。

### 2.3 仅外部生态 MCP 专有的工作区与研发交付工具

- `protoflow_workspace`：本地 `.pflow` 文件发现、模板创建、切换与品牌 `designTokens` 配置。
- `protoflow_get_project_overview` / `protoflow_search_spec` / `protoflow_get_implementation_checklist`：面向研发落地的 PostgreSQL/MySQL DDL、接口推导与业务便签核销清单（只读规格模式保持固定 6 个工具不变，兼容在线分享链接 `--share`）。

---

## 3. Axure / Figma 重构对齐双向 MCP 规格

1. **只读规格增强（`protoflow_get_page_spec`）**：保持 `SPEC_MCP_TOOLS` 6 个工具总数不变，新增可选参数 `importView: 'axure' | 'figma'`、`offset`、`limit`，使只读与读写模式均可分页检视 RP `StaticTable` 首行表头 `pfId`、列动作一致性 `columnActions`、`nearbyLabel` 及 Figma Auto Layout 重复组。
2. **读写重构工具（`protoflow_reshape_imported_page`）**：
   - 读动作（`inspect_project`、`inspect_page`）：在 `desktop_bridge` 模式下免传 `expectedRevision`，支持按全工程、`folderId` 或 `pageId` 分页盘点导入原稿及迁移进度（`evaluateAxureMigrationProgress`）。
   - 写动作（`reshape_axure_page`、`bind_axure_table`、`optimize_axure_block`、`reshape_figma_page`）：保留原始 `rp-page-*` / `fig-page-*` 页面不覆盖，自动生成或更新同目录 `rp-optimized-*` / `fig-optimized-*` 优化副本、写入血缘注释头、校验 `coverage` 控件去向账本与非颠倒字段映射，并在 `desktop_bridge` 下强制校验 `expectedRevision`、接入桌面原生 `Undo/Redo`。
3. **局部块编辑与跨轮次重塑自动重定向上下游跳转**：`protoflow_edit_page_block` 修改 `rp-optimized-*` 或 `fig-optimized-*` 副本时调用 `retargetEditedOptimizedCopy`；首次生成新优化副本时双端统一通过 `siblingNavigationPatches`（内置 Hermes 受本轮所选迁移范围 `allowedCopyIds` 与 `DependencyFootprint` 写集约束）将已优化兄弟副本指向源页的 `navigate()` 自动重定向至对应优化副本。

---

## 4. 内置 Hermes 候选态 `protoflow_capture_preview` 规格

1. **截取候选暂存态而非旧落盘态**：内置 Hermes 单轮执行中，表结构、预览行与页面 TSX 均暂存在 `context.json` 的 `snapshot` 中。`protoflow_capture_preview` 通过共享 `buildStagedPreviewSnapshot` 直接从当前轮 `context.snapshot` 构造 `PreviewSnapshot`，确保模型看到本轮刚暂存的最新渲染画面。
2. **主进程受控 Loopback 通道与身份围栏**：
   - `HermesRuntime` 在具备离屏渲染能力（桌面主窗口就绪）时启动仅绑定 `127.0.0.1:0` 的临时预览桥接服务，每次请求校验 256-bit Bearer Token、精确 `runId`、活动会话未取消状态，并将取消信号透传给 `capturePreview(captureUrl, snapshot, signal)`；
   - `protoflow-mcp.cjs` 仅在单页交互、项目对话精修/重构等需要视觉核对的场景调用该桥接；批量无人值守生成阶段不在默认必调路径中强制截图，避免多模态 Token 放大触发上游 TPM 限流。
3. **多模态模型兼容**：返回标准 MCP `[ImageContent(image/png), TextContent(metadata)]`。Hermes `v0.23.1` 原生 MCP 客户端（`native_images=True`）自动对视觉模型缩放嵌入图片，对纯文本模型降级保留文本元数据而不报错中断。

---

## 5. 上下文与 Token 渐进式披露机制（Hermes 分相裁剪 + Skills over MCP）

1. **内置 Hermes 按会话画像裁剪 `tools/list`（`PROTOFLOW_TOOL_PROFILE`）**：
   - `HermesRuntime` 在拉起或重载 ACP 会话时按会话边界注入确定性画像，避免无关工具污染每轮上下文：
     - `note-assistant`（6 个只读盘点工具）：仅供笔记助手查询真实菜单与表名，隔离全部写操作；
     - `page` 提供 19 个单页交互工具，包含当前菜单的历史检索、数据库需求原文核对与页面编辑。项目方案审批、目录移动与 RP/Figma 项目级迁移由项目会话处理。
     - `page-exec`（18 个批量子页生成工具）：保留 `get_project_brief`、历史检索及页面/数据表暂存工具，剥离方案讨论、巡检与无人值守阶段不调用的导入重塑/截图工具；
     - `project`（33 个全量项目对话工具）：保持与预热会话（`warmProjectSession`）的稳定契约，避免中途导入 RP/Figma 时触发额外 `session/load` 重绑。
2. **外部生态原生支持 `Skills over MCP`（`io.modelcontextprotocol/skills` / SEP-2640）与 MCP `2026-07-28`**：
   - `@protoflow-ai/mcp` 同时兼容 `2026-07-28`（`server/discover`、逐请求 `_meta` 协议协商与 `resultType`/`ttlMs`/`cacheScope` 缓存语义）及旧版 `initialize` 握手协议；
   - 在 `readwrite` 模式下声明 `extensions["io.modelcontextprotocol/skills"] = { directoryRead: true }`，构建期将 `skills/alex-protoflow-designer/SKILL.md` 及 `references/*.md` 连同精确字节长度与 `sha256` 摘要内嵌进独立 CLI 包，使支持的客户端免本地安装即可按需懒加载专家规程，同时精简工具 Schema 中的教学长文以降低非 Lazy 客户端的常驻上下文开销。
