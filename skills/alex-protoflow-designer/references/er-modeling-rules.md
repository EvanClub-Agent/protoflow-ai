# ER Database Modeling & Seed Data Rules

Follow these rules whenever calling `protoflow_upsert_db_tables` or `protoflow_manage_table_rows`.

## 1. Shared Tables & Modeling Rationale

- **Inspect existing tables first**: Call `protoflow_get_database_schema` before adding tables or columns. Never create a second table for the same entity and grain across different menus (e.g., list, create, detail, approval, and mobile views must share the same physical table via `sharedByMenus`).
- **Mandatory `modeling` metadata**: Every table must include:
  - `modeling.entity`: Business entity or event name (e.g. `"Sales Order"`, `"Order Line Item"`).
  - `modeling.grain`: Exact meaning of a single row, including time/version dimensions if applicable (e.g. `"One line item on a customer order"`).
  - `modeling.reason`: Rationale for persisting this grain separately compared to existing/planned tables.
- **No persistence for pure UI**: Folders, filter bars, tabs, modals, or dashboards do not create physical tables.

## 2. Keys, Types, Foreign Keys & Constraints

- **IDs vs physical names**:
  - `table.id` is the stable internal ID referenced by `<Table table="..." />`, `<Form table="..." />`, and `tableRows`.
  - `table.tableName` is the physical SQL name (`^[A-Za-z_][A-Za-z0-9_]*$`). Never substitute `tableName` for `table.id` in page bindings or MCP parameters.
- **Primary keys**: Every table needs an explicit primary key column (`isPrimaryKey: true`, `nullable: false`), typically `id` (`VARCHAR(64)` or `BIGINT`).
- **Foreign keys**:
  - Format `references` as `physicalTableName(columnName)` (e.g. `t_customers(id)`), never internal `table.id`.
  - Set `isForeignKey: true` and align `dataType` identically with the referenced target column (which must be a primary key or `isUnique: true` single column).
  - Set `foreignKeyOptions: { name, cardinality: '1:N' | '1:1', onDelete: 'RESTRICT' | 'CASCADE' | 'SET NULL' }`. Remember `SET NULL` requires `nullable: true`.
  - Submit parent and child tables together in one `protoflow_upsert_db_tables(action="upsert_tables", tables=[...])` call so cross-table FK checks pass atomically.
- **Composite uniqueness**: Use `uniqueConstraints: [{ name, columnIds }]` referencing exact `columns[].id` values when uniqueness spans multiple columns (e.g. `(contract_id, stage_no)`).
- **Pending rules (`modeling.pendingRules`)**: When a requirement cannot be expressed by SQL keys/types alone (e.g., conditional uniqueness when `status != 'cancelled'`, cross-table balance caps, or composite foreign keys), record `{ rule, reason }` in `modeling.pendingRules` instead of faking it with weaker constraints.
- **Avoid fan-out traps**: Keep independent 1:N child branches in separate tables (e.g. `order_items` and `order_payments`), never flattened into one wide table.

## 3. Coherent Preview Seed Rows

- Seed parent tables before or together with child tables in `protoflow_manage_table_rows(action="seed")`.
- Every row MUST include a unique non-empty string `id` matching the prototype runtime identity (even if the physical PK is `id`).
- Values must match column `dataType`, `nullable` (`false` columns cannot be null/omitted), ENUM options, `isUnique` / `uniqueConstraints`, and exact foreign key parent values.
- Use realistic domain records (never `"test1"` / `"aaa"`), covering multiple statuses (e.g. draft, pending, approved, rejected) so filters, tabs, approvals, and charts render meaningfully.
- When updating schema on an existing table that already has `tableRows`, inspect `protoflow_manage_table_rows(action="read")` and re-seed with `replaceExisting: true` if new NOT NULL fields or chart metrics require populated data.
