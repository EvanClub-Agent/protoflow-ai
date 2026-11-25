# Changelog

All notable changes to **Alex (ProtoFlow AI)** are documented in this file.

## [v0.0.10] - 2026-11-25

### Added

- **高上限现代业务物料体系（134+ PC & 移动端注册物料）**：
  - **PC 中后台核心物料**：新增无弹窗主从循环列表 `Repeater`（内置 `autoSelectFirst`、`selectRow()` 与分页筛选）、多阶段状态泳道看板 `Kanban`（多 SQL `ENUM` 列智能消歧与拖拽/箭头推进）、月/周排期日历 `Calendar`（支持起止日跨天排程联动）、结构化智能建议卡片 `AiCopilotCard`，以及 `Card(variant="bento")` 与 `Statistic(sparkline)` 微型趋势指标卡。
  - **iPhone 移动端现场物料**：新增触控横向泳道看板 `MKanban`、周视图日程流 `MCalendar` 与移动端 AI 随行预检卡片 `MAiInsightCard`，与 PC 端天然共享同一套物理 ER 数据表。
- **UI Stack 五态仿真矩阵（`normal` / `empty` / `loading` / `edge` / `error`）**：
  - 桌面设计器与在线发布浏览端（`/p/<id>` 及 `/demo/`）顶部工具栏新增一键五态切换器，支持秒级检视理想态、空数据引导态、骨架屏加载态、极值压测态与异常降级态（`result_500` / `result_403` / `banner` / `component`）。
  - **极值态写保护隔离**：`edge` 极值长文本与大额数字仅作用于视图展示投影，表单预填与业务写入始终读取真实底层 `tableRows`，彻底杜绝压测假数据污染工程存档。
- **工程级品牌主题令牌（`designTokens`）**：
  - 内置 `classic_antd`（经典中后台）、`modern_minimal`（现代极简）、`industrial_dense`（工业高密）、`collab_soft`（柔和协作）4 套预设，支持自定义主色（`primaryColor`）、圆角、密度与画布底色，完整打通 `.pflow` V7 自动保存（默认主题保持历史字节零差异兼容）与 V5 在线发布快照。
- **Poka-Yoke 实时防错、递归外键闭环与 5 秒原子撤销**：
  - **跨字段与格式实时防错**：PC `<Form>` 与移动端 `<MForm>` 表单控件支持 `minField` / `maxField`（跨字段日期/库存上限对比）、`minValue` / `maxValue` 及 `formatRule`（`phone` / `email` / `credit_code` / `id_card` / `positive_number`）实时拦截。
  - **递归外键策略与原子恢复**：`deleteRow` 完整遍历多层 `ON DELETE RESTRICT / CASCADE / SET NULL` 引用树，存在 `RESTRICT` 子记录时精准阻断误删；支持 `deleteRow('undo')` 5 秒内一键原子恢复主子表快照，并在恢复前重验单列 `isUnique` 与表级联合唯一约束（`uniqueConstraints`）。
  - **状态条件禁用与高危二次核验**：行操作与按钮支持 `disabledWhenField` / `disabledWhenValue` / `disabledReason` 动态禁用说明，以及 `confirm(message, '{{row.ticket_no}}')` 单号精确输入核验弹窗。
- **官网在线演示升级为【星链设备售后维保与备件履约平台】**：
  - `website/demo/` 升级为中英双语零下载交互沙盒（3 个 PC 页 + 1 个 iPhone 现场端页 + 3 张 `RESTRICT/CASCADE` 共享物理表 + 8 条防错需求便签），集中展示无弹窗主从工作台、五态切换与防错撤销闭环。

### Fixed & Hardened

- **主从作用域与循环表单跨行写入安全加固**：
  - `Card` / `Modal` / `Drawer` 设置 `activeTable` 时严格阻断异表来源行及二级嵌套弹层 `params` 透传误写；`Repeater` 循环内嵌表单按行实例隔离草稿与新增记录；父详情容器内的关联子表行动作自动绑定子表自身行上下文；`PickerInput` 分离契约 `pfId` 与实例键确保外键来源列校验不跳检。
- **MCP 双向契约、Go 发布白名单与多架构 GHCR 镜像同步**：
  - Go 服务端 `publish.ValidateSnapshot` 与远程 Streamable HTTP MCP（`POST /api/v1/mcp/:id`）同步支持 `designTokens`、`selectRow`、字段级 Poka-Yoke 约束与动作防错守卫元数据，并随 `v0.0.10` 发布 `linux/amd64` + `linux/arm64` 多架构 `protoflow-ai-api` / `protoflow-ai-web` GHCR 镜像。

---

## [v0.0.9] - 2026-11-24

### 桌面端修复

- **发版原因**　在 macOS 桌面端成功发布原型后，点击「打开预览」可能导致「发布与分享」窗口停止响应。此时点击「关闭」或按 Esc 都无法返回编辑器。
- **修复方式**　此前预览链接会请求创建 Electron 子窗口，再由主进程拦截并转交系统浏览器。桌面端现在通过专用接口校验并打开所选分享记录的地址。等待浏览器启动期间可以继续操作弹窗，启动失败时会显示错误。已有链接可直接使用，无需重新发布。
- **验证**　已在 macOS 验证系统默认浏览器加载测试分享页。Electron 回归测试覆盖了浏览器启动失败、启动期间关闭弹窗，以及返回工作区后再次打开弹窗。

### 自托管部署

- 修正 Docker Compose 中 PostgreSQL 18 的数据卷挂载路径。

---

## [v0.0.8] - 2026-11-24

### Added

- **Native Dual-Channel Figma Import (`.fig` Offline Archive & Figma REST API)**:
  - **100% Offline `.fig` Binary Decoder**: In-app Web Worker unpacks Zstandard/Deflate archives (`fzstd` / `fflate`) and decodes Figma Kiwi binary schemas locally with zero account or cloud upload required, unpacking only the image assets referenced by user-selected frames.
  - **Figma Link + OS Keychain PAT Sync**: Fetches full files or scoped `?node-id=...` frame/section/leaf-node links via the Figma REST API, encrypts Personal Access Tokens via Electron `safeStorage` (serialized against concurrent clear/save operations), validates redirect hops & IPv4/IPv6 byte ranges against SSRF, and embeds referenced images as Data URIs so `.pflow` projects never break when Figma's 14-day S3 URLs expire.
  - **Smart Frame Tree Picker & Design Import Hub**: Auto-detects **Desktop (`<Page>`)**, **Mobile (`<MobilePage>`)**, or **Hybrid** multi-platform workspaces from frame dimensions, auto-skips Design System / Component / Icon sheets by default, reports omitted image counts and 20 MiB UTF-8 publish snapshot warnings transparently, and adds a dedicated **Import Designs (Figma · Axure RP)** hub to the Welcome Launcher.
- **Dual-Layer Material Expansion & Scoped AI Figma Reshaping**:
  - **Layer-1 High-Fidelity Primitives**: Added `FigmaCanvas`, `FigmaFrame` (Flexbox Auto Layout direction, gap, padding, `FILL`/`HUG` sizing, gradients, radii, shadows, backdrop blur), `FigmaText` (multi-run rich text), `FigmaVector` (`commandsBlob` SVG path decoder), and `FigmaImage`.
  - **Layer-2 Stateful Business Materials**: Added desktop `NavMenu`, `CardGrid`, `Dropdown`, `Carousel`, `Icon` and mobile `MBannerCarousel`, `MCardGrid` bound to shared physical ER tables (`DBTableSchema`) with unified `matchesStaticRowFilter` parity across `Table` and `CardGrid`.
  - **On-Demand Scoped AI Reshaping & MCP Lineage**: Added `protoflow_inspect_figma_project`, `inspect_page(view="figma")`, and `protoflow_reshape_figma_page` with strict frame/folder/project scope enforcement across follow-up clarifications, plus `figmaSourcePageId` / `optimizedPageId` lineage exposure in `@protoflow-ai/mcp` and the Go HTTP Spec MCP server.

### Fixed & Improved

- **Portable Linux `ProtoFlow_AI-*` AppImage Packaging & Dev Port Identity Guard**:
  - Updated Linux AppImage artifact naming (`ProtoFlow_AI-<version>-x86_64.AppImage`), automated `.AppImage.zsync` update syncing in `website-sync-downloads.cjs`, and added CI AppImage verification (`scripts/verify-appimage.sh`).
  - Added `<meta name="protoflow-app" content="alex-protoflow-ai">` probing in `electron/main.cjs` so local Electron development never attaches to unrelated services occupying port `5173`.

---

## [v0.0.7] - 2026-11-22

### Fixed & Improved

- **Stable Single-Install Live Desktop Bridge (`live.json`) & Offline Handshake Resilience**:
  - Replaced per-project SHA-256 bridge file paths with a stable `<userData>/authoring/live.json` endpoint protected by cross-instance directory locking (`live.lock` with automatic dead-owner recovery) and automatic project-switch reconnection while **Bidirectional design** is enabled — eliminating plugin reinstalls and MCP server restarts when creating or switching `.pflow` projects.
  - Added local offline protocol fallback in `createDesktopRelay` so `initialize`, `ping`, `tools/list`, `prompts/list`, `resources/list`, and static contract tools (`protoflow_get_contracts` / `protoflow_get_implementation_guide`) succeed even when Alex Desktop is closed or on the launcher, keeping MCP tools registered across IDE restarts.
- **Cross-Project Write Safety & Sequential Revision Guardrails**:
  - Enforced mandatory `expectedRevision` verification on every desktop write mutation (`desktop_bridge`) before touching canvas or disk state, preventing in-flight edits from Project A from landing on Project B after switching projects, and automatically disabling write access upon account changes or connection errors.
  - Updated MCP `authoringInstructions`, schema descriptions (without non-portable Draft-07 `if`/`then` keywords), and `alex-protoflow-designer` skill playbooks to enforce sequential single-in-flight desktop writes chaining each returned `revision`.
- **Product-Manager-Friendly AI Connection & Dev Handoff UI**:
  - Redesigned `McpConnectModal`, `DesktopAuthoringControls`, and `GlobalToolbar` around non-technical product manager workflows: plain-language scenario split (**Let External AI Design Here** vs **Hand Off Prototype to Developers**), guided 3-step setup with one-click **Antigravity** / **Claude Desktop** cards, 3 switchable plain-language prompt templates, native `<details>` progressive disclosure hiding raw developer JSON by default in live co-design mode, and live toolbar connection indicators.

---

## [v0.0.6] - 2026-11-21

### Added

- **Bidirectional MCP Prototype Authoring (`--mode readwrite`)**:
  - Expanded `@protoflow-ai/mcp` from read-only specs into a full 18-tool contract-enforced authoring server: external AI agents (**Codex**, **Google Antigravity**, **Claude Desktop**, **Claude Code**) can now create `.pflow` projects, organize sitemap folders, design normalized shared ER tables with foreign-key & composite-unique validation, seed coherent preview rows, write or losslessly patch desktop (`<Page>`) and mobile (`<MobilePage>`) pages (`protoflow_write_page` / `protoflow_edit_page_block`), attach sticky-note specs, author Markdown PRDs & Mermaid diagrams, and run closed-loop audits (`protoflow_audit_project`).
  - Added 4 guided MCP Prompts (`design-full-project`, `design-page`, `refine-page`, `design-database`), the `protoflow://authoring/playbook` resource, and the standalone `alex-protoflow-designer` Agent Skill pack (`SKILL.md` + 4 scenario playbooks).
- **Live Desktop Canvas Bridge (`--desktop-bridge`) & Multi-Step Undo**:
  - Enable **MCP → Local → Bidirectional design** in Alex Desktop to expose an authenticated loopback bridge bound to the open `.pflow` project, sharing live `revision`, `activePageId`, and canvas-selected `selectedPfId` with external agents.
  - Live edits stream directly onto the open canvas through the desktop autosave queue with optimistic `expectedRevision` conflict checks, shared Hermes AI task locking, top-bar undo notices, and focus-aware `Cmd/Ctrl+Z` multi-step undo (preserving native text input undo on macOS/Windows/Linux).
- **Revision-Bound Visual Preview Capture (`protoflow_capture_preview`)**:
  - Added an isolated sandboxed offscreen preview renderer (`partition: 'alex-preview'`) that captures high-DPI PNG screenshots of any desktop or mobile page (`scope: "viewport" | "canvas"`, `fullPage: true` up to `2160` CSS px with `truncated` reporting, minimum `1280` CSS px desktop viewport width) without disturbing editor selection, scroll position, or undo history.
  - Automatically waits for deterministic ECharts canvas rendering (zero entry animation) and sandboxed Freeform `iframe` first paint before capturing, verifying no concurrent project edits occurred mid-capture.
- **One-Click Client Integrations & Distributable Bundles**:
  - Added one-click **Install Antigravity plugin** (`~/.gemini/config/plugins/alex-protoflow-designer`), **Export Claude Desktop extension** (`.mcpb` manifest v0.3), and standalone **Codex / Antigravity / Claude Code** skill installers (`$CODEX_HOME/skills` & `~/.agents/skills`) with `.alex-install.json` SHA-256 receipt verification for seamless version upgrades while preserving user-customized files.

---

## [v0.0.5] - 2026-11-21

### Added

- **Full Bilingual Internationalization (`zh-CN` & `en-US`) Across All Surfaces**:
  - Automatic OS / browser language detection (`zh*` → `zh-CN`, otherwise `en-US`) on first launch with persistent one-click `LanguageSwitch` across the desktop workbench, welcome launcher, published web viewer (`/p/<id>`), release center, standalone/encrypted HTML exports, and official product website (`website/`).
  - Synchronized Ant Design (`zhCN` / `enUS`), `dayjs` (`zh-cn` / `en`), Tiptap editor placeholders, Electron native macOS application menus, close guards, Python Hermes sidecars (`PROTOFLOW_LOCALE`), mounted Hermes management dashboard windows (live in-place `LanguageSwitcher` sync without page reload), MCP servers, and Go publishing API (`Accept-Language` error localization).
  - Container-query and flex-wrap layout hardening across narrow sidebars, 332px 4-tab node inspectors, secondary canvas toolbars, and web preview headers to guarantee zero text clipping or layout overflow when switching languages.
- **Locale-Invariant Business & Relational Data Contracts**:
  - Localized all 114+ desktop/mobile material metadata entries, starter projects, and page templates while strictly preserving physical schema contracts: foreign-key `value` bindings (including live qualified-supplier filtering across desktop `<Form>` and mobile `<MForm>` / `<MSheetPicker>`), SQL `ENUM(...)` state machines, `¥` RMB currency defaults, typed `{{form.<pfId>.<field>}}` action interpolation (`number`, `boolean`, `null`), legacy `"全部,启用,停用"` query clear compatibility, and live bidirectional translation of active validation errors and toasts.

---

## [v0.0.4] - 2026-11-21

### Added

- **Native Axure RP 9 & RP 11 Binary Import (`.rp` → `.pflow`)**:
  - Local Worker-based `.rp` binary parser with zero Axure installation or cloud upload required. Restores nested sitemap folders, positioned groups (including hidden groups), static table cells, isolated master-instance widget scopes, multi-state `DynamicPanel`s, and unconditional page links / show-hide / state-switch actions while surfacing unsupported widgets and conditional events in page import notes.
- **Controlled AI Flow-Layout Reshaping & Relational Schema Migration**:
  - Added `protoflow_reshape_axure_page`, `protoflow_bind_axure_table`, `protoflow_optimize_axure_block`, and `protoflow_inspect_axure_project` for converting imported RP pages into clean, flow-layout Alex `<Page>` copies alongside the untouched original RP pages.
  - Synthesizes scattered RP captions and inputs (`nearbyLabel`) into live `QueryForm`s, binds `StaticTable` headers (`headerPfId → tableId / columnId`) to shared physical ER tables without polluting `tableRows` with static sample cells, and threads row-accurate cross-page `navigate(targetPageId, 'row')` into `Descriptions` via `useSourceRow`.
  - Enforces deterministic host & MCP anti-hallucination guardrails: blocks inverted field bindings, prevents single-row sample actions (such as row-1 `"删除"`) from promoting onto all-row `Table.rowActions`, verifies `retained` subtrees semantically, distinguishes per-turn edits from whole-page flow completion, and itemizes **Converted / Retained / Pending** blocks in confirmation reviews.
- **Enterprise CRM Contract & Billing Benchmark Showcase (`examples/crm-contract-billing`)**:
  - Added a complete 5-table, 6-page (4 Desktop + 2 Mobile) enterprise showcase with composite unique constraints, master-detail payment plans, anti-overpayment/invoicing sticky-note rules, and full-stack MCP implementation prompts.
- **Redesigned Spec MCP Studio Modal & Protocol Hardening**:
  - Redesigned `McpConnectModal` into a streamlined studio interface with one-click client configs (**Claude Code**, **Cursor**, **Antigravity**, **Codex**, **JSON**) and synced TypeScript + Go Spec MCP tools (`protoflow_get_page_spec` verified Axure lineage metadata, `protoflow_search_spec` coverage, and batch capabilities).

---

## [v0.0.3] - 2026-11-20

### Fixed

- Alex Desktop now installs its own verified Hermes v0.23.1 runtime by default. Upgrading or downgrading a separate Hermes installation no longer interrupts AI features that use the managed runtime.
- Existing users can select **使用 Alex 托管运行时** in the AI Management Center and authorize their account there. Conversations and drafts stay in their original profile. **高级设置 → 切回原 Hermes 环境** reconnects to that profile when its Hermes version is compatible.
- Alex verifies the new connection before saving an environment switch. If the switch fails, the active connection stays available.

---

## [v0.0.2] - 2026-11-19

### Added
- **Read-Only MCP Specification Server (Remote Streamable HTTP + Local `stdio`)**:
  - **Zero-Install Remote Online Connection (`POST /api/v1/mcp/:id`)**: Coding Agents (**Claude Code**, **Cursor**, **Google Antigravity**, **Windsurf**, **Codex**) can connect directly to any published `/p/<shareId>` prototype over Streamable HTTP without installing Alex Desktop or Node.js locally.
  - **Local `.pflow` & Share `stdio` Runtime**: Bundled into Alex Desktop (`electron/generated/spec-mcp-server.cjs` via `ELECTRON_RUN_AS_NODE=1`) and standalone CLI (`packages/protoflow-mcp/dist/cli.cjs`) with automatic hot-reload on `.pflow` file changes.
  - **6 Read-Only Tools, 4 Resources & 2 Guided Prompts**:
    - `protoflow_get_project_overview`, `protoflow_get_database_schema` (PostgreSQL & MySQL DDL + sample rows), `protoflow_get_page_spec` (component outline, TSX source, table bindings, actions, and pinned sticky-note rules), `protoflow_get_docs_and_flows`, `protoflow_search_spec`, and `protoflow_get_implementation_checklist`.
- **Format V5 Publishing Contract & PostgreSQL Migration `011`**:
  - Preserves column-level `isUnique` and table-level composite `uniqueConstraints` in published snapshots while keeping internal AI modeling notes local; legacy V1–V4 shares remain backward-compatible and emit explicit constraint completeness warnings.
- **One-Click MCP Connection Modal (`McpConnectModal`)**:
  - Accessible from the workbench top toolbar, the online publish modal, and the published web viewer (`/p/<id>`), generating ready-to-copy snippets for JSON IDEs, Claude Code CLI, and Codex CLI.

### Security & Reliability
- Enforced HTTPS for non-LAN remote share URLs, isolated per-share/per-project credentials in the connection UI, and added `X-Protoflow-Password-Base64` support so passwords with leading/trailing spaces or Unicode characters are preserved verbatim.
- Bounded public MCP request bodies (`64 KiB`), batch item counts (`16`), and cumulative batch response sizes (`4 MiB`) while preserving 1-to-1 JSON-RPC request IDs (including escaped strings and high-precision >53-bit integer IDs).
- Hardened PostgreSQL DDL generation for `BIGINT UNSIGNED` (`NUMERIC(20,0)` + range `CHECK`), `ZEROFILL` unsigned ranges, `FLOAT(p)` precision (`REAL` vs `DOUBLE PRECISION`), fractional `DATETIME(p)` / `TIMESTAMP(p)` precision, and strict single-column-unique foreign-key dependency closures.

---

## [v0.0.1] - 2026-11-18

### Added
- Initial open-source release of **Alex (ProtoFlow AI)** — AI prototyping workbench, shared physical ER modeling, interactive desktop & mobile canvas runtime, sticky-note business rules, project notes & mindmaps, self-hosted Go + PostgreSQL publishing server, and cross-platform Electron desktop builds.
