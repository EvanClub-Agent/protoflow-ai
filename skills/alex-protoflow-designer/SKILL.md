---
name: alex-protoflow-designer
description: Create, inspect, refine, model ER databases, seed preview data, write PRD notes/Mermaid flows, and audit interactive Alex (ProtoFlow AI) `.pflow` business prototypes using the `protoflow` read-write MCP tools. Trigger whenever the user asks to generate a prototype project, create or adjust desktop/mobile pages, design or modify database tables/foreign keys, add sticky-note specs, or audit a `.pflow` prototype.
---

# Alex (ProtoFlow AI) Prototype Designer

Build and iterate interactive, data-driven business prototypes stored as `.pflow` archives via the `protoflow` MCP server (`--mode readwrite`).

## Seven Iron Rules

1. **Workspace first**. Start with `protoflow_workspace(action="status")`.
   - For `desktop_bridge`, verify the intended `projectId`. For a canvas edit, inspect the page identified by `activePageId` and the selection identified by `selectedPfId`.
   - Send exactly one desktop write at a time across all tools, including edits to different folders or pages. Use the status `revision` as the first write's `expectedRevision`. Wait for each successful result and pass its exact `revision` as the next write's `expectedRevision`. On conflict, stop, re-read status and inspect the changed target before resuming on the intended project.
   - For `local_file`, if no project is active, call `create_project` or `switch_project` before any project-scoped tool.
2. **Never guess TSX props or write arbitrary React**: Alex page TSX is a strict material AST, not arbitrary React. Before writing or editing any page, call `protoflow_get_implementation_guide` and `protoflow_get_contracts`. Never invent Ant Design props, `style`, `className`, `import`s, or inline JS callbacks (`() => ...`).
3. **Every component needs a unique explicit `pfId`**: Every JSX element in `protoflow_write_page` or `protoflow_edit_page_block` must carry a unique, stable `pfId` string.
4. **Strict PC vs Mobile isolation**: Desktop pages use `<Page>` and desktop/universal materials only; mobile pages use `<MobilePage>` and `M*`/universal materials only. Never mix `<Table>`/`<Card>`/`<Modal>` into `<MobilePage>` or `M*` components into `<Page>`.
5. **Reuse shared ER tables**: Never create duplicate per-page mock tables for the same business entity and grain. Use exact `dbTables.id` in `Table.table` / `Form.table` (never `tableName`), and exact `tableName(columnName)` in `column.references`.
6. **Real closed-loop actions**: Save actions must call `submitForm`, status transitions must call `updateRow`, deletes must call `deleteRow`, and cross-page links must call `navigate` to an existing `pageId`. Never fake persistence with `toast` or `closeOverlay` alone.
7. **Always audit before finishing**: Finish every authoring task with `protoflow_audit_project` and fix every reported error until `healthy: true`. Never edit binary `.pflow` files directly on disk outside MCP tools.

## Intent-to-Tool Routing

| Goal | Primary Tools (in order) |
| :--- | :--- |
| Check / create / switch project | `protoflow_workspace` (`status`, `list_projects`, `create_project`, `switch_project`, `update_project_meta`) |
| Survey existing project structure | `protoflow_get_project_overview` → `protoflow_get_database_schema` → `protoflow_get_docs_and_flows` / `protoflow_search_spec` |
| Organize folders & menus | `protoflow_manage_sitemap` (`upsert_folder`, `move_item`, `rename_page`, `delete_item`) |
| Model or evolve ER tables | `protoflow_upsert_db_tables` (`upsert_tables` in parent+child batches, `upsert_columns`, `delete_tables`) |
| Read or seed preview records | `protoflow_manage_table_rows` (`read`, `seed`, `clear`) |
| Learn material & action schemas | `protoflow_get_implementation_guide` → `protoflow_get_contracts` |
| Create or rebuild a full page | `protoflow_write_page` |
| Losslessly refine part of a page | `protoflow_get_page_spec` (`includeInspection: true`, `selectedPfId`) → `protoflow_edit_page_block` (`append_children`, `replace_node`, `delete_node`) |
| Attach requirement sticky notes | `protoflow_manage_sticky_notes` (`upsert`, `delete`) |
| Write PRD notes, Mermaid flows, agreements | `protoflow_manage_docs_and_flows` (`upsert_note`, `upsert_mindmap`, `upsert_agreement`, etc.) |
| Final closed-loop verification | `protoflow_audit_project` |

## Progressive Contract Discovery & UX Architecture Heuristics (Mandatory)

Never memorize component props from memory — contracts evolve across Alex versions:

1. Call `protoflow_get_implementation_guide()` (no args) to list scenario IDs, then request relevant `scenarioIds` (e.g. `["workspace", "list", "form", "workflow"]` or `["mobile"]`).
2. Call `protoflow_get_contracts()` (no args) to inspect compact component names grouped into `desktop`, `mobile`, `universal`, plus `actions`.
3. Call `protoflow_get_contracts({ componentNames: [...] })` for the exact components you plan to emit; read `valueSchema`, `events`, `parents`, `childTypes`, and `examples`.
4. **Match Brand Design Tokens to Industry**: Use `protoflow_workspace(action="update_project_meta", designTokens={ preset })` (`modern_minimal` for AI/SaaS, `collab_soft` for collaborative suites, `enterprise_compact` for finance/ERP/customs, `classic_antd` for standard backoffice). Tokens stay strictly isolated to the prototype canvas and `/p/{id}` viewer.
5. **Elevate UX Beyond Generic Table+Modal CRUD**:
   - **Master-Detail Split Workspace**: Pair a left `Table` / `Repeater` / `Kanban` (`autoSelectFirst={true}` + `selectRow()`) with a right `<Card activeTable="...">` (or mobile `<MSurface activeTable="...">`) for zero-popup inline inspection & approval.
   - **Domain-Native Views**: Choose `Kanban` / `MKanban` for stage pipelines, `Calendar` / `MCalendar` for schedules/bookings, `Repeater` / `MRepeater` for bespoke multi-slot cards, and `AiCopilotCard` / `MAiInsightCard` for AI triage insights.
   - **UI Stack & Poka-Yoke**: Set `<Page>` / `<MobilePage>` `emptyTitle` and `errorFallback`; bind cross-field `minField` / `maxField` / `formatRule` on form inputs, `disabledWhenField` / `hiddenWhenField` on state-dependent buttons/rowActions, `deleteRow("undo")` for recoverable deletes, and `confirm(msg, "{{row.code}}")` for irreversible high-risk actions.

## Visual & 5-State Verification on Alex Desktop

After creating or refining a page over `desktop_bridge`, call `protoflow_capture_preview` with its exact `pageId`. Use `scope: "viewport"` for the page surface or phone screen and `"canvas"` for the complete visible stage. You can pass `uiState: "normal" | "empty" | "loading" | "edge" | "error"` to visually audit empty fallbacks, loading skeletons, extreme long-text wrapping (`edge`), and error states without mutating underlying `tableRows`. For a long page, pass `fullPage: true` and check `truncated` for the capture height limit. The accompanying text identifies the page, platform, pixel dimensions and project revision. Use that revision before a corrective edit, then capture again. File and shared-link connections expose the specification tools for inspection.

## Reference Playbooks (Read On Demand)

Load the matching reference guide before starting complex workflows:

- **End-to-end 0-to-1 prototype generation**: [references/full-project-workflow.md](references/full-project-workflow.md)
- **Database ER modeling, keys & seed data**: [references/er-modeling-rules.md](references/er-modeling-rules.md)
- **Desktop (`<Page>`) & Mobile (`<MobilePage>`) DSL patterns**: [references/desktop-and-mobile.md](references/desktop-and-mobile.md)
- **Inspecting & reshaping imported Axure RP pages**: [references/axure-reshape.md](references/axure-reshape.md)
