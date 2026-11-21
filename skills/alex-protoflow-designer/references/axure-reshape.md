# Inspecting & Reshaping Imported Axure RP Pages

Use this guide when an existing `.pflow` project contains Axure RP imported pages (e.g., `pageId` starting with `rp-page-`, containing `<AxureCanvas>`, `<StaticTable>`, `<PositionedGroup>`, `<DynamicPanel>`, `<OutlineTree>`).

## 1. Inspection

1. Call `protoflow_get_project_overview` to see all pages and RP lineage (`axureSourcePageId` / `optimizedPageId`).
2. Call `protoflow_get_page_spec({ pageId, includeSource: true, includeInspection: true })` to inspect the full RP source, component outline (including `StaticTableCell` headers and labels), and existing bindings.
3. Call `protoflow_get_database_schema` to check existing physical tables before introducing new ones.

## 2. Reshaping Strategy via Read-Write MCP

- **Preserve the original `rp-page-*` page** unless the user explicitly asks to overwrite or delete it. Create a new flow-layout native `<Page>` (or update its `optimizedPageId`) using standard Alex materials (`PageHeader`, `Card`, `QueryForm`, `Table`, `Form`, `Modal`, `Drawer`, `Tabs`).
- **Account for every functional control**:
  - Merge scattered query labels + inputs + search/reset buttons into `<QueryForm target="tbl_..." ...>`.
  - Model or reuse physical `dbTables` via `protoflow_upsert_db_tables`, map every header column from `<StaticTable>` into `<Table columns={[...]} />`, and seed representative `<StaticTableCell>` rows via `protoflow_manage_table_rows(action="seed")`.
  - Preserve dynamic panel states (`<Tabs>` or `<Modal>`/`<Drawer>`), sidebar navigation trees, and consistent row actions (`navigate(..., "row")` or `openDrawer`).
  - Do NOT silently drop unmapped columns, conditional branches, or unsupported RP widgets — document any intentional exclusions or pending behaviors via `protoflow_manage_sticky_notes`.
- Verify the reshaped page and cross-page navigation links with `protoflow_audit_project`.
