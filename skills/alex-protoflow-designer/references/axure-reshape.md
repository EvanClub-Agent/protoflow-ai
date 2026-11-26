# Inspecting & Reshaping Imported Axure RP & Figma Pages

Use this guide when an existing `.pflow` project contains imported Axure RP pages (`rp-page-<guid>`, containing `<AxureCanvas>`, `<StaticTable>`, `<PositionedGroup>`, `<DynamicPanel>`, `<OutlineTree>`) or imported Figma frames (`fig-page-<hash>`, containing `<FigmaCanvas>`, `<FigmaFrame>`, `<FigmaText>`).

## 1. Paginated Discovery & Evidence Inspection

1. Call `protoflow_reshape_imported_page({ action: "inspect_project" })` (optionally scoped by `folderId` or `pageId`, following `nextOffset`) to inventory imported Axure RP pages and Figma frames, existing `rp-optimized-*` / `fig-optimized-*` copies, table bindings, and `migrationProgress`.
2. For each target source page, call `protoflow_reshape_imported_page({ action: "inspect_page", pageId })` (or `protoflow_get_page_spec({ pageId, importView: "axure" | "figma" })`):
   - **Axure RP (`rp-page-*`)**: inspect `firstRow[].pfId` header cells on each `StaticTable`, `grid.columnActions` (`consistentAcrossDataRows` and `requiresConfirmation`), `nearbyLabel` input pairings, hidden `DynamicPanel` states, and `importNotes`.
   - **Figma (`fig-page-*`)**: inspect detected `platform` (`desktop` vs `mobile`), Auto Layout `repeatingGroups` (table/list/card candidates), `semanticBlocks`, and navigation targets.
3. Call `protoflow_get_database_schema` to reuse existing shared `dbTables` before creating new ones with `protoflow_upsert_db_tables`, and call `protoflow_get_implementation_guide({ scenarioIds: ["axure", "figma"] })` + `protoflow_get_contracts` before writing TSX.

## 2. Controlled Flow-Layout Reshaping (`protoflow_reshape_imported_page`)

- **Never overwrite or delete the original `rp-page-*` / `fig-page-*` page** unless explicitly requested. `protoflow_reshape_imported_page` automatically writes to the sibling `rp-optimized-<guid>` or `fig-optimized-<hash>` copy, stamps the provenance header (`// @alex-axure-source` or `// @alex-figma-source`), and retargets cross-page `navigate()` links to existing sibling optimized copies.
- **Axure RP → `action: "reshape_axure_page"`**:
  - Emit a complete flow-layout `<Page>` without `<AxureCanvas>`. Combine scattered query labels/inputs/buttons into `<QueryForm target="tbl_..." />`.
  - When converting a `<StaticTable>` into `<Table>`, `coverage.converted` must point `targetPfId` directly to the `<Table>` and include `tableId` plus `columnMappings` accounting for every first-row `headerPfId` (`field` + exact `columnId`, `index`, `checkbox`, `radio`, `actions`, or `pending` + `reason`). Never invert column headers, and only migrate `rowActions` when `consistentAcrossDataRows: true` and `requiresConfirmation: false` (never promote single-row sample actions like one-off "Delete" to all rows).
  - Account for every core source block in `coverage` (`converted`, `retained`, or `pending` — never silently drop `OutlineTree`, custom pagers, hidden `DynamicPanel` states, or `importNotes`).
  - For localized in-place edits on an existing positioned canvas instead of full flow reshaping, use `action: "bind_axure_table"` or `action: "optimize_axure_block"`.
- **Figma → `action: "reshape_figma_page"`**:
  - Match the source frame's platform (`<Page>` with desktop materials for desktop frames; `<MobilePage>` with `M*` materials for mobile frames) without raw `Figma*` restoration nodes.
  - Provide `coverage.converted` (mapping `sourcePfIds` to standard `targetPfId`s and optional `tableId`) and `coverage.pending` for any unconfirmed elements; do not hardcode sample mock text from design layers as saved business facts unless seeded intentionally via `protoflow_manage_table_rows`.

## 3. Visual & Closed-Loop Verification

- On `desktop_bridge`, pass the latest `expectedRevision` on every write action, then call `protoflow_capture_preview` on both the source page (`rp-page-*` / `fig-page-*`) and the generated `optimizedPageId` to visually compare layout hierarchy and viewport fit.
- Subsequent localized tweaks on `rp-optimized-*` / `fig-optimized-*` via `protoflow_edit_page_block` automatically preserve and retarget sibling optimized navigation links.
- Finish with `protoflow_audit_project` to confirm zero contract, database, or visual consistency issues.
