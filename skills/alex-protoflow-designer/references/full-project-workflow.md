# Full-Project Prototype Generation SOP (5 Steps)

Use this workflow when asked to generate an entire prototype project (sitemap, ER database, preview rows, pages, sticky rules, docs/flows) from business requirements.

## Step 1: Workspace Discovery

1. Call `protoflow_workspace(action="status")`.
2. For a new project, open or create the target in Alex when using `desktop_bridge`. With `local_file`, if no `.pflow` file is active or the user wants a new project, call `protoflow_workspace(action="create_project", ...)` with:
   - `filePath` ending in `.pflow`
   - `projectName`
   - `projectMode`: `'desktop'`, `'mobile'`, or `'hybrid'` (pick `'hybrid'` if the system has both admin/backoffice and mobile/mini-program screens)
   - `templateId`: `'blank_project'` unless the user requested a starter template
3. If modifying an existing project, call `protoflow_get_project_overview`, `protoflow_get_database_schema`, and `protoflow_get_docs_and_flows` first so existing pages, domains, and tables are preserved and reused.

## Step 2: Clarify Decisive Business Ambiguities

Before designing tables or pages, check whether any core business facts are genuinely ambiguous:
- Core entities, status state machines (exact enum values and allowed transitions), or uniqueness boundaries (e.g., whether duplicate items are allowed per order or per supplier).
- Whether the system requires PC admin only, mobile only, or PC + mobile hybrid.

Ask concise targeted questions when missing facts would force guessing business rules; decide standard UI layout, columns, spacing, and icons autonomously.

## Step 3: Sitemap Folders + Shared ER Tables + Coherent Seed Data

On `desktop_bridge`, serialize every write through Steps 3–5. To create several folders and pages, send the first folder with the verified project's status `revision` as `expectedRevision`. Wait for its result and pass the returned `revision` to the next folder, table, page or other write as `expectedRevision`. Only one write may be in flight. On a conflict, stop and inspect the active project and affected data before continuing.

Always build the data backbone **before** writing pages:

1. **Create folders**: Call `protoflow_manage_sitemap(action="upsert_folder", ...)` for each module folder (`parentFolderId: null` for top-level).
2. **Design & batch-create ER tables**: Follow [er-modeling-rules.md](er-modeling-rules.md) and submit parent + child tables together via `protoflow_upsert_db_tables(action="upsert_tables", tables=[...])`.
   - Declare `sharedByMenus` for planned pages up front (`pendingMenuBindings` returned as an advisory note will automatically resolve once those pages are created in Step 4).
3. **Seed preview data**: Call `protoflow_manage_table_rows(action="seed", datasets=[...])` with 3–8 realistic, foreign-key-coherent records per table so tables, pickers, detail views, and charts work immediately upon preview.

## Step 4: Contract-Verified Pages, Sticky Notes & Flows

1. Call `protoflow_get_implementation_guide({ scenarioIds: [...] })` and `protoflow_get_contracts({ componentNames: [...] })` for the components needed.
2. **Generate pages in dependency order**:
   - First: master data & upstream source pages (e.g. Customers, Suppliers, Catalog).
   - Second: core transactional pages (e.g. Orders, Approvals, Inspections) linking upstream tables/pages.
   - Third: overview dashboards/charts and mobile companion pages sharing the same physical `dbTables.id`.
3. For each page:
   - Call `protoflow_write_page` with valid TSX, unique `pfId`s, and explicit `platform` in hybrid projects.
   - Attach business-rule sticky notes via `protoflow_manage_sticky_notes(action="upsert", ...)` pointing to exact existing component `pfId`s (validation limits, formulas, state preconditions).
4. Optionally add PRD notes or Mermaid business flowcharts via `protoflow_manage_docs_and_flows` (`upsert_note` / `upsert_mindmap`) and durable project agreements (`upsert_agreement`).

## Step 5: Closed-Loop Audit & Honest Reporting

1. Call `protoflow_audit_project()`.
2. Resolve every reported `referenceIssues`, `databaseReview` error, `previewRelationIssues`, `danglingTableMenuBindings`, or `pageAudits[].contractErrors`.
3. Re-run `protoflow_audit_project()` until `healthy: true`.
4. Summarize created/updated `.pflow` file path, folders, ER tables (and any `modeling.pendingRules` for downstream production engineers), pages, and honest prototype boundaries (e.g., offline preview records, simulated upload/camera).
