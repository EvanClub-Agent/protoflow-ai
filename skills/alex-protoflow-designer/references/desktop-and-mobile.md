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
- **3-tier viewport structure**:
  1. Top sticky bar: `<MTopBar>`
  2. Middle single-column flow: `<MHeroHeader>`, `<MBentoGrid>`, `<MSurface>`, `<MAiInsightCard>`, `<MSearchPill target="list_id" />`, `<MPillTabs target="list_id" filterField="status" />`, `<MFeedList>` (C-end feed/cards), `<MTaskList>` (B-end task/document list), `<MRepeater>` (custom repeating mobile card template), `<MKanban>` (touch stage board), `<MCalendar>` (week/month date strip + daily agenda), `<MListGroup>` + `<MListItem>`, `<MStatCard>`, `<MChatStream>`
  3. Bottom dock: `<MTabBar>` (top-level tabs), `<MBottomDock>` (detail/form primary/secondary CTA), or `<MComposerBar>` (AI input bar)
- **Mobile forms & overlays**: Place `<MForm>` with `<MField>`, `<MSheetPicker>`, `<MChipSelect>`, `<MMediaInput>` inside `<MBottomSheet>` (`openDrawer`) or a dedicated mobile form page.
- **Related detail rows on mobile**: Set `table` + `sourceForeignKey` on `<MTaskList>` or `<MFeedList>` inside an overlay opened from row click (`openDrawer`) or target page navigated with `'row'`.

## 4. Charts & Freeform

- **12 ECharts components** (`BarChart`, `LineChart`, `AreaChart`, `PieChart`, `DonutChart`, `ScatterChart`, `RadarChart`, `GaugeChart`, `FunnelChart`, `HeatmapChart`, `TreemapChart`, `SankeyChart`): When `source="table"`, ensure `tableRows` has non-empty compatible records via `protoflow_manage_table_rows(action="read")` / `seed` BEFORE writing the page, or `protoflow_write_page` validation will reject empty/incompatible chart data.
- **Freeform**: Use only when standard compositions cannot express the region (seat maps, kanban drag-drop, calendar matrix, specialized SVG). Check `protoflow_get_contracts({ componentNames: ["Freeform"] })` for allowed sandbox subset and `eventFields` / `onAction` wiring.
