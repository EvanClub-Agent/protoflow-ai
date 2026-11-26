# Desktop (`<Page>`) & Mobile (`<MobilePage>`) Authoring Guide

Before emitting TSX, always fetch exact schemas via `protoflow_get_implementation_guide` and `protoflow_get_contracts`.

## 1. Universal DSL Constraints

- **Exact wrapper**:
  ```tsx
  export default function Page() {
    return (
      <Page pfId="page_root" title="...">
        ...
      </Page>
    );
  }
  ```
- **Unique `pfId` everywhere**: Every JSX element MUST specify an explicit, unique `pfId`. When editing via `protoflow_edit_page_block(mode="replace_node")`, preserve the target node's `pfId`.
- **Forbidden syntax**: No `import`/`export` beyond `export default function Page()`, no local variables/hooks in outer TSX, no JS callbacks (`onClick={() => ...}`), no spread props, no raw HTML tags (`div`, `span`), no `style` or `className`.
- **Text children vs props**: `Button`, `MButton`, `Text`, `Title`, `Tag`, `Avatar` take their text label as JSX child text (`<Button pfId="btn_add" type="primary">新增</Button>`), NOT via a `text`/`label` prop.
- **Zero-argument runtime action chains**: Events only accept registered actions from `protoflow_get_contracts().actions` written as a plain call or semicolon-separated block statement inside a zero-argument arrow function (never an array `[...]`). Note that `closeOverlay()` takes 0 arguments and `updateRow({ field: value })` takes a plain JSON object (e.g. `onClick={() => openModal('dlg_create')}` or `onClick={() => { submitForm('form_edit'); closeOverlay(); toast('已保存', 'success'); refresh('tbl_main'); }}`).
- **Overlays at page root**:
  - Desktop: `<Modal>` and `<Drawer>` MUST be direct children of `<Page>` (with `width` as numeric pixels, e.g. `width={640}`).
  - Mobile: `<MBottomSheet>` and `<MDialog>` MUST be direct children of `<MobilePage>`.

## 2. Desktop (`<Page>`) Patterns

- **Allowed components**: Desktop + Universal (`Freeform` + 12 ECharts types). Never use `M*` components.
- **Grid layout**: `<Row gutter={16}>` accepts ONLY `<Col span={...}>`. Keep `Col.span` sums per row at `24` (e.g. `12 + 12` or `16 + 8` or `6 + 6 + 6 + 6`). Note `width="full"` inside a `Col` fills that column, not the full page.
- **Cohesive Designer Surfaces & 85/10/5 Hierarchy on Desktop**:
  - Choose ONE `<Page appearance="..." surfaceBg="..." accent="..." motion="smooth">` system for the **entire project** (or inherit `visualBaseline.dominant` from `protoflow_get_project_overview`) and keep it identical across every screen: e.g. `appearance="light" surfaceBg="mist" accent="obsidian"` for executive/fintech/industrial ops; `sage_field` + `lime_forest` for green/ESG suites; `warm_paper` + `indigo` for editorial/collaborative suites; `oled_carbon` only when the whole product is dark.
  - Anchor the top KPI row with **one** `<Statistic tone="inverted" splitDecimal={true} sparkline={true} />` (or `<Card variant="inverted">`), keep sibling KPIs clean `tone="card"` without rainbow `valueColor` overrides, and pair with `<ProgressBoard variant="gauge" | "capsule">` and `<ActivityFeed>` (signed split-decimal ledger + guarded `rowActions`). Reserve `AiCopilotCard tone="dark_brief"` for `lime_forest`/`emerald`/`sage_field` projects; on `obsidian`/`mist`/`indigo`/`blue` projects use `AiCopilotCard tone="indigo"`. Charts and tables inside `<Card variant="bento">` automatically melt duplicate inner borders.
- **Query + Table + Create/Edit**:
  - Bind `<QueryForm target="tbl_main" cols={3} layout="horizontal" size="middle">` to `<Table pfId="tbl_main" table="t_..." ... />`.
  - Remember `QueryForm` filters scalar substring matches; array filters (`dateRange`, multi-select, `cascader`) are UI-only and do not execute array filtering in preview runtime — note this honestly if used.
  - Put Create/Edit `<Form pfId="form_..." table="t_...">` inside `<Modal>` or `<Drawer>`. Use either `fields={[...]}` shorthand OR child field components (`<Input>`, `<Select>`, etc.), never both simultaneously.
  - Edit flows open the overlay from `Table.rowActions[].onClick` (`openModal('dlg_edit')` or `openDrawer('drawer_edit')`) so the overlay inherits the clicked `row` context; save buttons call `submitForm('form_...')` followed by `closeOverlay` / `toast` / `refresh`.
- **Master-detail, Repeater, Kanban, Calendar & Picker**:
  - **In-page Master-Detail (no modal/drawer needed)**: Set `autoSelectFirst={true}` and `onRowClick={() => selectRow()}` (or `onItemClick` / `onCardClick`) on the master `<Table>`, `<Repeater>`, `<CardGrid>`, or `<Kanban>`, and wrap the detail column in `<Card activeTable="t_...">`. Inside that `Card`, `title="{{row.field}}"`, `<Descriptions table="t_..." />`, `<Form table="t_..." />`, `<Button onClick={() => updateRow({ ... })}>`, and child `<Table table="t_sub" sourceForeignKey="<fk>" />` all react live to the selected row! (In JSX text children like `<Text>` or `<Tag>`, quote mustache placeholders as `{'{{row.field}}'}`).
  - **Custom Card Templates (`<Repeater>`)**: Bind `table="t_..."` and compose `<Card>`, `<Flex>`, `<Avatar>`, `<Tag>`, `<Progress>`, `<Button>` inside instead of falling back to `Freeform`.
  - **Stage Workflows (`<Kanban>`) & Schedules (`<Calendar>`)**: Bind `table` + `statusField` on `<Kanban>` or `dateField` on `<Calendar>`, and pair with `<AiCopilotCard>` for AI review/risk insights.
  - Cross-page drill-down uses `navigate('detail_page_id', 'row')`, and detail `Table` sets `sourceForeignKey="<fk_column_name>"`.
  - FK lookup pickers use `<PickerInput overlay="modal_picker" />` with a `selectable` `<Table>` and `returnSelection(tablePfId, displayField, sourceKeyField)`.

## 3. Mobile (`<MobilePage>`) Patterns

- **Allowed components**: `MobilePage`, `M*` components, and Universal (`Freeform` + charts). Never use `Table`, `QueryForm`, `Card`, `Row`/`Col`, `Modal`, or `Drawer`.
- **Cohesive Designer Surfaces & Focal Contrast on Mobile**:
  - Lock the **exact same** `(appearance, surfaceBg, accent, motion)` family across all `<MobilePage>` tabs (and match any companion desktop `<Page>` screens via `visualBaseline.dominant`): e.g. `appearance="light" surfaceBg="mist" accent="obsidian"` across every tab, never jumping from green on Tab 1 to blue on Tab 2 to pitch-black OLED on Tab 3.
  - Anchor the top of each screen with `<MHeroHeader mode="wallet" value="$24,680.00" accountMask="**** 3287" />` or `<MHeroHeader mode="metric_hero" value="98.6%" statusBadge="Plan 95%" />`, paired with `<MAiInsightCard tone="glow" />` (`tone="dark_brief"` only on `lime_forest`/`sage_field` green projects) and `<MProgressList variant="gauge" | "capsule">`.
- **3-tier viewport structure**:
  1. Top sticky bar: `<MTopBar>`
  2. Middle single-column flow: `<MHeroHeader>`, `<MAiInsightCard>`, `<MProgressList variant="capsule" | "gauge">`, `<MActivityList>` (signed split-decimal ledger + swipe-left `rowActions`), `<MBentoGrid>`, `<MSurface>`, `<MSearchPill target="list_id" />`, `<MPillTabs target="list_id" filterField="status" />`, `<MFeedList>` (C-end feed/cards), `<MTaskList>` (B-end task/document list), `<MRepeater>` (custom repeating mobile card template), `<MKanban>` (touch stage board), `<MCalendar>` (week/month date strip + daily agenda), `<MListGroup>` + `<MListItem>`, `<MStatCard>`, `<MChatStream>`
  3. Bottom dock: `<MFloatingBar>` (persistent SLA timer / mini-player capsule above tab bar) + `<MTabBar>` (supports `avatarText` for split pill island + circular avatar), `<MBottomDock>`, or `<MComposerBar>`
- **Mobile forms & overlays**: Place `<MForm>` with `<MField>`, `<MSheetPicker>`, `<MChipSelect>`, `<MMediaInput>` inside `<MBottomSheet>` (`openDrawer`) or a dedicated mobile form page.
- **Related detail rows on mobile**: Set `table` + `sourceForeignKey` on `<MTaskList>`, `<MActivityList>`, `<MProgressList>`, or `<MFeedList>` inside an overlay opened from row click (`openDrawer`) or target page navigated with `'row'`.

## 4. Charts & Freeform

- **12 ECharts components** (`BarChart`, `LineChart`, `AreaChart`, `PieChart`, `DonutChart`, `ScatterChart`, `RadarChart`, `GaugeChart`, `FunnelChart`, `HeatmapChart`, `TreemapChart`, `SankeyChart`): When `source="table"`, ensure `tableRows` has non-empty compatible records via `protoflow_manage_table_rows(action="read")` / `seed` BEFORE writing the page, or `protoflow_write_page` validation will reject empty/incompatible chart data.
- **Freeform**: Use only when standard compositions cannot express the region (seat maps, kanban drag-drop, calendar matrix, specialized SVG). Check `protoflow_get_contracts({ componentNames: ["Freeform"] })` for allowed sandbox subset and `eventFields` / `onAction` wiring.
