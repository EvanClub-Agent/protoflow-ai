# Changelog

All notable changes to **Alex (ProtoFlow AI)** are documented in this file.

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
