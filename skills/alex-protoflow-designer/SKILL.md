---
name: alex-protoflow-designer
description: Create, inspect, refine, model ER databases, seed preview data, write PRD notes/Mermaid flows, and audit interactive Alex (ProtoFlow AI) `.pflow` business prototypes using the `alex` read-write MCP domain tools. Trigger whenever the user asks to generate a prototype project, create or adjust desktop/mobile pages, design or modify database tables/foreign keys, add sticky-note specs, or audit a `.pflow` prototype.
metadata:
  serverVersion: 0.1.3
  contractDigest: sha256:d450c6a360e944f6
---

# Alex (ProtoFlow AI) Prototype Designer

Build and iterate interactive, data-driven business prototypes stored as `.pflow` archives via the Alex MCP server (`--mode readwrite`).

## Seven Iron Rules

1. **Workspace first**. Check the advertised `protoflow_workspace` input schema. If it declares `expectedContractDigest`, call `protoflow_workspace(action="status", expectedContractDigest="sha256:d450c6a360e944f6")`. Otherwise call `protoflow_workspace(action="status")`.
   - A missing `contractDigest` or `contractMatch: false` means the local skill differs from the live server: **do NOT interrupt the user or ask to reinstall/refresh**. Immediately call `protoflow_workspace(action="contracts")` and `protoflow_workspace(action="guide")` to follow the live schemas seamlessly. On `[CONTRACT_UNVERIFIED]`, ask the user to open a `.pflow` project in Alex Desktop and retry.
   - For `desktop_bridge`, verify the intended `projectId`. For a canvas edit, inspect the page identified by `activePageId` and the selection identified by `selectedPfId`.
   - Send exactly one desktop write at a time across all tools, including edits to different folders or pages. Use the status `revision` as the first write's `expectedRevision`. Wait for each successful result and pass its exact `revision` as the next write's `expectedRevision`. On conflict, stop, re-read status and inspect the changed target before resuming on the intended project.
   - For `local_file`, if no project is active, call `protoflow_workspace(action="create_project")` or `switch_project` before any project-scoped tool.
2. **Never guess TSX props or write arbitrary React**: Alex page TSX is a strict material AST, not arbitrary React. Before writing or editing any page, call `protoflow_workspace(action="guide")` and `protoflow_workspace(action="contracts")`. Never invent Ant Design props, `style`, `className`, `import`s, or inline JS callbacks (`() => ...`).
3. **Every component needs a unique explicit `pfId`**: Every JSX element in `protoflow_page(action="write_page")` or `protoflow_page(action="edit_block")` must carry a unique, stable `pfId` string.
4. **Strict PC vs Mobile isolation**: Desktop pages use `<Page>` and desktop/universal materials only; mobile pages use `<MobilePage>` and `M*`/universal materials only. Never mix `<Table>`/`<Card>`/`<Modal>` into `<MobilePage>` or `M*` components into `<Page>`.
5. **Reuse shared ER tables**: Never create duplicate per-page mock tables for the same business entity and grain. Use exact `dbTables.id` in `Table.table` / `Form.table` (never `tableName`), and exact `tableName(columnName)` in `column.references`.
6. **Real closed-loop actions & Master-Detail parity**: Save actions must call `submitForm`, multi-row catalog/pool imports into line-item tables must call `importSelectedRows(srcTablePfId, dstTablePfId, mapping?)` (or a `<Form table="t_child">` `submitForm`), status transitions must call `updateRow`, deletes must call `deleteRow`, and cross-page links must call `navigate` to an existing `pageId`. Never fake persistence or batch material import with `toast` or `closeOverlay` alone, and never omit `1:N` line-item tables or material-addition actions on sibling document pages (e.g., regular vs. research purchase requests).
7. **Always audit before finishing (contracts + `sharedByMenus` fulfillment + cohesive visual identity + linked mindmap suite)**: Finish every authoring task with `protoflow_audit(action="audit_project")`, resolve every contract/FK/reference error and every `unfulfilledTableMenuBindings` issue (`unbound_menu_table`, `missing_detail_create`, `sibling_missing_detail`) until `healthy: true`, and address any `visualConsistencyWarnings` and `mindmapWarnings` so all pages speak one cohesive visual language and the Project Mindmaps workspace stays complete and linked. Never edit binary `.pflow` files directly on disk outside MCP tools.

## Intent-to-Tool Routing (7 Core Domain Tools)

| Goal | Primary Domain Tool & Actions |
| :--- | :--- |
| Check status / create / switch / update meta | `protoflow_workspace` (`status`, `list_projects`, `create_project`, `switch_project`, `update_project_meta`) |
| Survey project overview, guides & component contracts | `protoflow_workspace` (`overview`, `guide`, `contracts`) → `protoflow_database` (`get_schema`) → `protoflow_docs` (`get_docs`) |
| Organize folders & menus | `protoflow_sitemap` (`upsert_folder`, `move_item`, `rename_page`, `delete_item`) |
| Model ER tables & seed preview records | `protoflow_database` (`upsert_tables`, `upsert_columns`, `delete_tables`, `read_rows`, `seed_rows`, `clear_rows`) |
| Read, write, block-edit, or reshape pages | `protoflow_page` (`get_spec`, `write_page`, `edit_block`, `inspect_project`, `inspect_page`, `reshape_axure_page`, `reshape_figma_page`, `bind_axure_table`, `optimize_axure_block`) |
| Maintain PRD notes, mindmaps, stickies & agreements | `protoflow_docs` (`get_docs`, `upsert_note`, `patch_note`, `upsert_note_folder`, `upsert_mindmap`, `upsert_mindmap_folder`, `upsert_sticky`, `delete_sticky`, `upsert_agreement`) |
| Audit integrity, search spec, or generate checklist | `protoflow_audit` (`audit_project`, `search_spec`, `checklist`) |
| Visual & 5-state screenshot verification | `protoflow_capture_preview` |

## Progressive Contract Discovery & UX Architecture Heuristics (Mandatory)

Never memorize component props from memory — contracts evolve across Alex versions:

1. Call `protoflow_workspace(action="guide")` (omit `scenarioIds` first to list catalog, then pass e.g. `["workspace", "list", "form", "workflow"]` or `["mobile"]`).
2. Call `protoflow_workspace(action="contracts")` (omit `componentNames` first to list catalog grouped into `desktop`, `mobile`, `universal`, plus `actions`).
3. Call `protoflow_workspace(action="contracts", componentNames=[...])` for the exact components you plan to emit; read `valueSchema`, `events`, `parents`, `childTypes`, and `examples`.
4. **Lock One Cohesive Visual System Across the Entire Project (Never Build a Multi-Style Patchwork)**:
   - Choose ONE unified `(appearance, surfaceBg, accent, motion)` identity for the whole `.pflow` product (e.g. `appearance="light" + surfaceBg="mist" + accent="obsidian"` for executive/fintech/enterprise ops, `sage_field + lime_forest` for green/ESG suites, or `oled_carbon` only when the whole suite or an explicitly requested wallboard is dark) and apply it consistently across **every** desktop `<Page>` and mobile `<MobilePage>`. When adding or refining pages in an existing project, read `protoflow_workspace(action="overview").visualBaseline.dominant` first and inherit it strictly.
   - Follow the **85 / 10 / 5 hierarchy**: **85%** unified canvas & clean Bento containers (`Card variant="bento"`), **10%** single dark inverted hero focal anchor per screen (`Statistic tone="inverted"` on desktop; `MHeroHeader mode="wallet" | "metric_hero"` on mobile), and **5%** strict semantic status colors (`emerald` = healthy/on-target, `amber` = warning/replenish, `rose` = danger/undo). Reserve `tone="dark_brief"` exclusively for `lime_forest`/`emerald`/`sage_field` systems; on `obsidian`/`mist`/`indigo`/`blue` systems use `AiCopilotCard tone="indigo"` and `MAiInsightCard tone="glow"`.
   - Optionally pair with `protoflow_workspace(action="update_project_meta", designTokens={ preset })` (`modern_minimal`, `collab_soft`, `enterprise_compact`, `classic_antd`).
5. **Elevate UX Beyond Generic Table+Modal CRUD**:
   - **Master-Detail Split Workspace**: Pair a left `Table` / `Repeater` / `Kanban` (`autoSelectFirst={true}` + `selectRow()`) with a right `<Card activeTable="...">` (or mobile `<MSurface activeTable="...">`) for zero-popup inline inspection & approval.
   - **Domain-Native Views**: Choose `Kanban` / `MKanban` for stage pipelines, `Calendar` / `MCalendar` for schedules/bookings, `Repeater` / `MRepeater` for bespoke multi-slot cards, `ProgressBoard` / `MProgressList` (`variant="gauge" | "capsule"`) for goal benchmarks, `ActivityFeed` / `MActivityList` for signed split-decimal ledgers, `AiCopilotCard` / `MAiInsightCard` for AI triage insights, and `<MFloatingBar>` for persistent mobile status.
   - **UI Stack & Poka-Yoke**: Set `<Page>` / `<MobilePage>` `emptyTitle` and `errorFallback`; bind cross-field `minField` / `maxField` / `formatRule` on form inputs, `disabledWhenField` / `hiddenWhenField` on state-dependent buttons/rowActions, `deleteRow("undo")` for recoverable deletes, and `confirm(msg, "{{row.code}}")` for irreversible high-risk actions.

## Visual & 5-State Verification on Alex Desktop

After creating or refining a page over `desktop_bridge`, call `protoflow_capture_preview` with its exact `pageId`. Use `scope: "viewport"` for the page surface or phone screen and `"canvas"` for the complete visible stage. You can pass `uiState: "normal" | "empty" | "loading" | "edge" | "error"` to visually audit empty fallbacks, loading skeletons, extreme long-text wrapping (`edge`), and error states without mutating underlying `tableRows`. For a long page, pass `fullPage: true` and check `truncated` for the capture height limit. The accompanying text identifies the page, platform, pixel dimensions and project revision. Use that revision before a corrective edit, then capture again. File and shared-link connections expose the specification tools for inspection.

## Reference Playbooks (Read On Demand)

Load the matching reference guide before starting complex workflows:

- **End-to-end 0-to-1 prototype generation**: [references/full-project-workflow.md](references/full-project-workflow.md)
- **Database ER modeling, keys & seed data**: [references/er-modeling-rules.md](references/er-modeling-rules.md)
- **Desktop (`<Page>`) & Mobile (`<MobilePage>`) DSL patterns**: [references/desktop-and-mobile.md](references/desktop-and-mobile.md)
- **Inspecting & reshaping imported Axure RP and Figma pages**: [references/axure-reshape.md](references/axure-reshape.md)
