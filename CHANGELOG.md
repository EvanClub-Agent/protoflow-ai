# Changelog

All notable changes to **Alex (ProtoFlow AI)** are documented in this file.

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
