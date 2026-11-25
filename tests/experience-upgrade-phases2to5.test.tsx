import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { parsePageSource } from '../src/proto/dsl/parser';
import { validateMaterialSource } from '../src/proto/registry/materialContract';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { RuntimeProvider, useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { DesktopConfirmDialog } from '../src/proto/runtime/ConfirmModalContent';
import { MobileRuntimeFeedback } from '../src/proto/mobile/components';
import { NodeView, ScopeProvider } from '../src/proto/renderer/NodeView';
import { findOverlay } from '../src/proto/runtime/runtime';
import { useResolvedTheme, AntdSurface } from '../src/proto/registry/AntdSurface';
import { ProtoCanvasThemeScope, useCanvasTheme } from '../src/proto/theme/ProtoCanvasThemeScope';
import { validateDesignTokens, exportDesignTokensSpec } from '../src/proto/theme/designTokens';
import { parseCaptureOptions } from '../src/mcp/capturePreview';
import { createLocalAuthoringWorkspace } from '../src/mcp/authoringWorkspace';
import { handleSpecMcpPayload } from '../src/mcp/protocol';
import { payloadFromPublishedSnapshot, type WorkspaceLoader } from '../src/mcp/workspace';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { normalizePublishedSnapshot } from '../src/services/publishedSnapshot';
import {
  captureProjectPayload,
  createProjectPayload,
  loadProjectFromBinaryPayload,
} from '../src/services/projectStorage';
import { decodePflowBinary, encodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { installTestDom } from './dom';

const wrapTsx = (inner: string) => `export default function Page() {\n  return (\n    ${inner}\n  );\n}\n`;

const WMS_TABLES: DBTableSchema[] = [
  {
    id: 't_inbound_orders',
    tableName: 'wms_inbound_orders',
    cnName: '入库验收单',
    domain: '仓储履约',
    description: '入库收货单主表',
    modeling: {
      entity: '入库验收单',
      grain: '每一笔供应商送货入库申请对应一行',
      reason: '统一管理待验收、已归档与作废状态',
    },
    sharedByMenus: [],
    columns: [
      { id: 'c_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
      { id: 'c_no', name: 'order_no', dataType: 'VARCHAR(64)', nullable: false, isUnique: true, comment: '入库单号' },
      {
        id: 'c_status',
        name: 'status',
        dataType: "ENUM('待验收','已入库','已作废')",
        nullable: false,
        comment: '状态',
      },
      { id: 'c_rem', name: 'remaining_qty', dataType: 'INT', nullable: false, comment: '待收余量' },
      { id: 'c_in', name: 'inbound_qty', dataType: 'INT', nullable: false, comment: '本次实收数' },
      { id: 'c_sdate', name: 'start_date', dataType: 'DATE', nullable: false, comment: '预约起日' },
      { id: 'c_edate', name: 'end_date', dataType: 'DATE', nullable: false, comment: '预约止日' },
      { id: 'c_phone', name: 'driver_phone', dataType: 'VARCHAR(32)', nullable: false, comment: '司机手机号' },
    ],
  },
  {
    id: 't_inbound_items',
    tableName: 'wms_inbound_items',
    cnName: '入库明细行',
    domain: '仓储履约',
    description: '入库单关联明细',
    modeling: {
      entity: '入库物料明细',
      grain: '每张入库单下的单个物料批次一行',
      reason: '挂接主单验证外键删除保护策略',
    },
    sharedByMenus: [],
    columns: [
      { id: 'ci_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
      {
        id: 'ci_order',
        name: 'order_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'wms_inbound_orders(id)',
        foreignKeyOptions: { onDelete: 'RESTRICT' },
        comment: '所属入库单',
      },
      { id: 'ci_sku', name: 'sku_name', dataType: 'VARCHAR(128)', nullable: false, comment: '物料名称' },
    ],
  },
];

function InteractiveHost({
  pageId,
  source,
  isMobile = false,
  onRuntime,
}: {
  pageId: string;
  source: string;
  isMobile?: boolean;
  onRuntime?: (rt: Runtime) => void;
}) {
  const doc = React.useMemo(() => parsePageSource(source).doc!, [source]);
  const rt = useRuntimeController(doc, pageId, false);
  onRuntime?.(rt);
  return (
    <RuntimeProvider value={rt}>
      <NodeView node={doc.root} />
      {!isMobile &&
        rt.overlays.map((entry, idx) => {
          const target = findOverlay(doc, entry.id);
          if (!target) return null;
          return (
            <ScopeProvider
              key={`${entry.id}-${idx}`}
              value={{ row: entry.row, tableId: entry.tableId, params: entry.params, overlayIndex: idx }}
            >
              <NodeView node={target} live />
            </ScopeProvider>
          );
        })}
      {!isMobile && rt.confirmState && (
        <DesktopConfirmDialog confirmState={rt.confirmState} onResolve={rt.resolveConfirm} />
      )}
      {isMobile && (
        <MobileRuntimeFeedback
          toasts={rt.toasts}
          confirmState={rt.confirmState}
          onResolveConfirm={rt.resolveConfirm}
        />
      )}
    </RuntimeProvider>
  );
}

test('Phase 2: Design Tokens strictly isolate canvas theme from workbench shell, round-trip .pflow & PublishedSnapshot, and render Card/Statistic variants', async () => {
  const restore = installTestDom();
  let view: TestRenderer.ReactTestRenderer | undefined;
  try {
    // 1. Token validation
    validateDesignTokens({
      preset: 'modern_minimal',
      primaryColor: '#059669',
      radius: 'generous',
      density: 'compact',
      surfaceVariant: 'elevated',
      colorMode: 'dark',
    });
    assert.throws(() => validateDesignTokens({ preset: 'unknown_theme' }));
    assert.throws(() => validateDesignTokens({ preset: 'classic_antd', primaryColor: 'red' }));
    assert.throws(() => validateDesignTokens({ preset: 'classic_antd', extraHack: true }));

    // 2. Strict workbench isolation: outer shell stays light while ProtoCanvasThemeScope is dark
    let hostThemeSeen = '';
    let canvasThemeSeen = '';
    let canvasPrimarySeen = '';

    function ShellProbe() {
      hostThemeSeen = useResolvedTheme();
      return <span data-probe="shell">{hostThemeSeen}</span>;
    }
    function CanvasProbe() {
      canvasThemeSeen = useResolvedTheme();
      const ctx = useCanvasTheme();
      canvasPrimarySeen = ctx?.resolved.primaryColor ?? '';
      return (
        <AntdSurface>
          <span data-probe="canvas">{canvasThemeSeen}</span>
        </AntdSurface>
      );
    }

    await act(async () => {
      view = TestRenderer.create(
        <div>
          <ShellProbe />
          <ProtoCanvasThemeScope
            tokens={{ preset: 'modern_minimal', primaryColor: '#059669', density: 'compact', colorMode: 'dark' }}
          >
            <CanvasProbe />
          </ProtoCanvasThemeScope>
        </div>,
      );
    });

    assert.equal(hostThemeSeen, 'light');
    assert.equal(canvasThemeSeen, 'dark');
    assert.equal(canvasPrimarySeen, '#059669');
    assert.equal(document.documentElement.dataset.theme, undefined);

    // 3. .pflow V7 binary archive & PublishedSnapshot round-trip (and omission when null/default)
    const blankPayload = createProjectPayload({
      projectId: 'p-tokens',
      projectName: 'Token Test',
      storageDir: '/tmp',
      fileName: 'p-tokens.pflow',
      templateId: 'customs_erp',
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(blankPayload);
    assert.equal('designTokens' in captureProjectPayload().stateSnapshot, false);

    useProtoStore.getState().setDesignTokens({
      preset: 'collab_soft',
      primaryColor: '#4f46e5',
      radius: 'generous',
      density: 'spacious',
      surfaceVariant: 'subtle',
      colorMode: 'dark',
    });
    usePageStore.getState().createDesignerPage(
      { pageId: 'home-kpi', title: '经营总览', folderId: 'folder-base-data' },
      wrapTsx(`<Page pfId="p-kpi" title="经营总览">
  <Card pfId="c-bento" variant="bento" title="核心营收">
    <Statistic pfId="st-rev" title="月度经常性收入" prefix="¥" value={286000} trend="up" trendText="+24.6%" sparkline={true} />
  </Card>
</Page>`),
    );
    useProtoStore.getState().setActivePage('home-kpi');

    const captured = captureProjectPayload();
    assert.equal(captured.stateSnapshot.designTokens?.preset, 'collab_soft');
    const decoded = decodePflowBinary(encodePflowBinary(captured));
    loadProjectFromBinaryPayload(blankPayload);
    assert.equal(useProtoStore.getState().designTokens, null);
    loadProjectFromBinaryPayload(decoded);
    assert.equal(useProtoStore.getState().designTokens?.preset, 'collab_soft');
    assert.equal(useProtoStore.getState().designTokens?.colorMode, 'dark');

    const pubSnap = normalizePublishedSnapshot(createPublishedSnapshot('home-kpi'));
    assert.equal(pubSnap.designTokens?.preset, 'collab_soft');
    const remotePayload = payloadFromPublishedSnapshot(pubSnap);
    assert.equal(remotePayload.stateSnapshot.designTokens?.preset, 'collab_soft');

    // 4. Card.variant & Statistic sparkline render cleanly
    const kpiSource = usePageStore.getState().pageSources['home-kpi'];
    assert.deepEqual(validateMaterialSource(kpiSource), []);
    await act(async () => {
      view!.update(
        <ProtoCanvasThemeScope tokens={useProtoStore.getState().designTokens}>
          <InteractiveHost pageId="home-kpi" source={kpiSource} />
        </ProtoCanvasThemeScope>,
      );
    });
    const renderedJson = JSON.stringify(view!.toJSON());
    assert.ok(renderedJson.includes('+24.6%'));
    assert.ok(renderedJson.includes('"svg"'));
  } finally {
    await act(async () => {
      view?.unmount();
    });
    useProtoStore.getState().setDesignTokens(null);
    useProtoStore.getState().setUIState('normal');
    restore();
  }
});

test('Phase 3: Dual-platform UI Stack 5-state simulator projects normal/empty/loading/edge/error with zero tableRows mutation', async () => {
  const restore = installTestDom();
  let view: TestRenderer.ReactTestRenderer | undefined;
  try {
    const seedRows = {
      t_inbound_orders: [
        {
          id: 'ord-1',
          order_no: 'IN-20261124-01',
          status: '待验收',
          remaining_qty: 50,
          inbound_qty: 20,
          start_date: '2026-11-20',
          end_date: '2026-11-25',
          driver_phone: '13800138000',
        },
      ],
      t_inbound_items: [{ id: 'itm-1', order_id: 'ord-1', sku_name: '工业级激光传感器' }],
    };
    const snapshotBefore = structuredClone(seedRows);
    useProtoStore.setState({ dbTables: WMS_TABLES, uiState: 'normal', activePageId: 'p-uistack' });
    usePageStore.setState({ tableRows: structuredClone(seedRows) });

    const desktopSource = wrapTsx(`<Page pfId="p-root" title="收货台账" emptyTitle="当前暂无待验收的入库单据，请先同步采购单" errorFallback="result_403" errorTitle="暂无仓库库区访问权限">
  <Table pfId="tbl-orders" table="t_inbound_orders" emptyText="列表空空如也" columns={[{ dataIndex: "order_no", title: "单号" }, { dataIndex: "status", title: "状态" }]} />
</Page>`);

    const mobileSource = wrapTsx(`<MobilePage pfId="mp-root" title="移动收货" emptyTitle="今日暂无到货任务" errorFallback="component">
  <MTopBar pfId="mt-1" title="移动收货" />
  <MTaskList pfId="mtask-1" table="t_inbound_orders" titleField="order_no" statusField="status" />
</MobilePage>`);

    assert.deepEqual(validateMaterialSource(desktopSource), []);
    assert.deepEqual(validateMaterialSource(mobileSource), []);

    // Normal state
    await act(async () => {
      view = TestRenderer.create(<InteractiveHost pageId="p-uistack" source={desktopSource} />);
    });
    assert.ok(JSON.stringify(view!.toJSON()).includes('IN-20261124-01'));

    // Empty state
    await act(async () => {
      useProtoStore.getState().setUIState('empty');
    });
    const emptyDesktopJson = JSON.stringify(view!.toJSON());
    assert.ok(emptyDesktopJson.includes('当前暂无待验收的入库单据'));
    assert.ok(emptyDesktopJson.includes('列表空空如也'));
    assert.ok(!emptyDesktopJson.includes('IN-20261124-01'));

    // Loading state
    await act(async () => {
      useProtoStore.getState().setUIState('loading');
    });
    assert.ok(JSON.stringify(view!.toJSON()).includes('"data-ui-stack":"loading"'));

    // Edge state (extreme text length + multiplied rows)
    await act(async () => {
      useProtoStore.getState().setUIState('edge');
    });
    assert.ok(JSON.stringify(view!.toJSON()).includes('极值长文本压测'));

    // Error state (page-level 403 Result on desktop)
    await act(async () => {
      useProtoStore.getState().setUIState('error');
    });
    assert.ok(JSON.stringify(view!.toJSON()).includes('暂无仓库库区访问权限'));

    // Mobile 5-state projection (component-level error card + empty banner)
    await act(async () => {
      view!.update(<InteractiveHost pageId="mp-uistack" source={mobileSource} isMobile />);
    });
    assert.ok(JSON.stringify(view!.toJSON()).includes('"data-ui-stack":"error"'));

    await act(async () => {
      useProtoStore.getState().setUIState('empty');
    });
    assert.ok(JSON.stringify(view!.toJSON()).includes('今日暂无到货任务'));

    // Underlying tableRows MUST be 100% untouched across all 5 states!
    assert.deepEqual(usePageStore.getState().tableRows, snapshotBefore);

    // Capture preview CLI/MCP option parser supports uiState
    const parsedCapture = parseCaptureOptions({ pageId: 'p-uistack', scope: 'viewport', uiState: 'edge' });
    assert.equal(parsedCapture.uiState, 'edge');
    assert.throws(() => parseCaptureOptions({ uiState: 'corrupted' }));
  } finally {
    await act(async () => {
      view?.unmount();
    });
    useProtoStore.getState().setUIState('normal');
    restore();
  }
});

test('Phase 4: Poka-Yoke cross-field validation, state guards, FK onDelete protection, Undo Toast, and high-risk matchText confirm', async () => {
  const restore = installTestDom();
  let view: TestRenderer.ReactTestRenderer | undefined;
  try {
    useProtoStore.setState({ dbTables: structuredClone(WMS_TABLES), uiState: 'normal', activePageId: 'p-poka' });
    usePageStore.setState({
      tableRows: {
        t_inbound_orders: [
          {
            id: 'ord-1',
            order_no: 'IN-1001',
            status: '待验收',
            remaining_qty: 30,
            inbound_qty: 10,
            start_date: '2026-11-20',
            end_date: '2026-11-22',
            driver_phone: '13800138000',
          },
          {
            id: 'ord-2',
            order_no: 'IN-1002',
            status: '已入库',
            remaining_qty: 15,
            inbound_qty: 15,
            start_date: '2026-11-21',
            end_date: '2026-11-23',
            driver_phone: '13900139000',
          },
        ],
        t_inbound_items: [{ id: 'itm-1', order_id: 'ord-1', sku_name: '伺服电机模组' }],
      },
    });

    const source = wrapTsx(`<Page pfId="p-poka-root" title="收货防错工作台">
  <Table
    pfId="tbl-in"
    table="t_inbound_orders"
    columns={[{ dataIndex: "order_no", title: "单号" }, { dataIndex: "status", title: "状态" }]}
    rowActions={[
      { label: "验收通过", disabledWhenField: "status", disabledWhenValue: "!待验收", disabledReason: "仅待验收单据可执行验收", onClick: () => updateRow({ status: "已入库" }) },
      { label: "归档删除", danger: true, hiddenWhenField: "status", hiddenWhenValue: "待验收", onClick: () => deleteRow("undo") },
      { label: "高危作废", danger: true, onClick: () => { confirm("即将彻底作废单据 {{row.order_no}}", "{{row.order_no}}"); updateRow({ status: "已作废" }); } }
    ]}
  />
  <Form pfId="frm-in" table="t_inbound_orders">
    <Input pfId="f-no" name="order_no" label="入库单号" required={true} />
    <Select pfId="f-st" name="status" label="状态" options="待验收,已入库,已作废" required={true} />
    <NumberInput pfId="f-rem" name="remaining_qty" label="待收余量" required={true} minValue={1} />
    <NumberInput pfId="f-in" name="inbound_qty" label="本次实收数" required={true} maxField="remaining_qty" />
    <DatePicker pfId="f-sd" name="start_date" label="预约起日" required={true} />
    <DatePicker pfId="f-ed" name="end_date" label="预约止日" required={true} minField="start_date" />
    <Input pfId="f-ph" name="driver_phone" label="司机手机" required={true} formatRule="phone" />
    <Button pfId="btn-save" type="primary" onClick={() => submitForm("frm-in")}>提交验收</Button>
  </Form>
</Page>`);

    assert.deepEqual(validateMaterialSource(source), []);
    assert.deepEqual(pageContractErrors(source, WMS_TABLES), []);

    let liveRt!: Runtime;
    await act(async () => {
      view = TestRenderer.create(
        <InteractiveHost pageId="p-poka" source={source} onRuntime={(r) => { liveRt = r; }} />,
      );
    });

    // 1. Row action state guards:
    // Row ord-1 (status='待验收'): "验收通过" enabled, "归档删除" hidden!
    // Row ord-2 (status='已入库'): "验收通过" disabled with title="仅待验收单据可执行验收", "归档删除" visible!
    const row1Tr = view!.root.findByProps({ 'data-row-id': 'ord-1' });
    const row2Tr = view!.root.findByProps({ 'data-row-id': 'ord-2' });
    const row1Btns = row1Tr.findAllByType('button');
    const row2Btns = row2Tr.findAllByType('button');
    assert.equal(row1Btns.some((b) => JSON.stringify(b.children).includes('归档删除')), false);
    const row2ApproveBtn = row2Btns.find((b) => JSON.stringify(b.children).includes('验收通过'))!;
    assert.equal(row2ApproveBtn.props.disabled, true);
    assert.equal(row2ApproveBtn.props.title, '仅待验收单据可执行验收');

    // 2. Cross-field & formatRule Poka-Yoke blocks invalid submitForm and records exact formErrors
    await act(async () => {
      liveRt.setFormValues('frm-in', {
        order_no: 'IN-1003',
        status: '待验收',
        remaining_qty: 20,
        inbound_qty: 35, // violates maxField="remaining_qty" (35 > 20)
        start_date: '2026-11-28',
        end_date: '2026-11-25', // violates minField="start_date"
        driver_phone: '12345', // violates formatRule="phone"
      });
    });
    await act(async () => {
      const saveBtn = view!.root.findByProps({ 'data-pf-id': 'btn-save' }).findByType('button');
      saveBtn.props.onClick({ stopPropagation() {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_inbound_orders.length, 2);
    assert.ok(liveRt.formErrors['frm-in']?.inbound_qty);
    assert.ok(liveRt.formErrors['frm-in']?.end_date);
    assert.ok(liveRt.formErrors['frm-in']?.driver_phone);

    // Fix values -> submitForm succeeds!
    await act(async () => {
      liveRt.setFormValues('frm-in', {
        order_no: 'IN-1003',
        status: '待验收',
        remaining_qty: 20,
        inbound_qty: 18,
        start_date: '2026-11-25',
        end_date: '2026-11-28',
        driver_phone: '13712345678',
      });
    });
    await act(async () => {
      const saveBtn = view!.root.findByProps({ 'data-pf-id': 'btn-save' }).findByType('button');
      saveBtn.props.onClick({ stopPropagation() {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_inbound_orders.length, 3);

    // 3. Undoable delete (`deleteRow("undo")`) on ord-2 (unreferenced by child items) deletes & restores on Undo!
    await act(async () => {
      const updatedRow2 = view!.root.findByProps({ 'data-row-id': 'ord-2' });
      const archiveBtn = updatedRow2
        .findAllByType('button')
        .find((b) => JSON.stringify(b.children).includes('归档删除'))!;
      archiveBtn.props.onClick({ stopPropagation() {} });
    });
    assert.equal(
      usePageStore.getState().tableRows.t_inbound_orders.some((r) => r.id === 'ord-2'),
      false,
    );
    assert.equal(liveRt.toasts.some((t) => Boolean(t.undoAction)), true);

    await act(async () => {
      const toastWithUndo = liveRt.toasts.find((t) => Boolean(t.undoAction))!;
      toastWithUndo.undoAction!.onUndo();
    });
    assert.equal(
      usePageStore.getState().tableRows.t_inbound_orders.some((r) => r.id === 'ord-2'),
      true,
    );

    // 4. FK RESTRICT protection blocks deleting ord-1 because t_inbound_items references ord-1!
    assert.throws(() => {
      usePageStore.getState().deleteRow('t_inbound_orders', 'ord-1');
    }, /入库明细行/);
    assert.equal(
      usePageStore.getState().tableRows.t_inbound_orders.some((r) => r.id === 'ord-1'),
      true,
    );

    // 5. High-risk `confirm(message, "{{row.order_no}}")` requires exact matchText before unlocking Confirm
    let confirmPromise!: Promise<void>;
    await act(async () => {
      const r1 = view!.root.findByProps({ 'data-row-id': 'ord-1' });
      const voidBtn = r1.findAllByType('button').find((b) => JSON.stringify(b.children).includes('高危作废'))!;
      confirmPromise = Promise.resolve(voidBtn.props.onClick({ stopPropagation() {} }));
    });
    assert.equal(liveRt.confirmState?.matchText, 'IN-1001');
    const confirmSubmitBtn = view!.root.findByProps({ 'data-testid': 'confirm-submit-btn' });
    assert.equal(confirmSubmitBtn.props.disabled, true);

    // Type wrong text -> still disabled
    await act(async () => {
      const input = view!.root.findByProps({ 'data-testid': 'confirm-match-input' });
      input.props.onChange({ target: { value: 'WRONG' } });
    });
    assert.equal(view!.root.findByProps({ 'data-testid': 'confirm-submit-btn' }).props.disabled, true);

    // Type exact match 'IN-1001' -> enabled & executes updateRow({ status: '已作废' })!
    await act(async () => {
      const input = view!.root.findByProps({ 'data-testid': 'confirm-match-input' });
      input.props.onChange({ target: { value: 'IN-1001' } });
    });
    const unlockedBtn = view!.root.findByProps({ 'data-testid': 'confirm-submit-btn' });
    assert.equal(unlockedBtn.props.disabled, false);
    await act(async () => {
      unlockedBtn.props.onClick();
      await confirmPromise;
    });
    const ord1After = usePageStore.getState().tableRows.t_inbound_orders.find((r) => r.id === 'ord-1');
    assert.equal(ord1After?.status, '已作废');
  } finally {
    await act(async () => {
      view?.unmount();
    });
    restore();
  }
});

test('Phase 5: MCP authoring & spec tools persist designTokens and export CSS vars, uiStackSpec, and pokaYokeRules', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-phase5-mcp-'));
  try {
    const pflowPath = path.join(tmpDir, 'smart-wms.pflow');
    const ws = createLocalAuthoringWorkspace({ workspaceDir: tmpDir });

    const callMcp = async (name: string, args: Record<string, unknown>) => {
      const res = await handleSpecMcpPayload(ws as unknown as WorkspaceLoader, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      assert.ok(res && !Array.isArray(res) && !res.error, `MCP ${name} failed`);
      const body = res.result as { isError?: boolean; content: { text: string }[] };
      assert.notEqual(body.isError, true, `Tool ${name} error: ${body.content?.[0]?.text}`);
      return JSON.parse(body.content[0].text);
    };

    const created = await callMcp('protoflow_workspace', {
      action: 'create_project',
      filePath: pflowPath,
      projectName: '智能仓储防错中台',
      projectMode: 'hybrid',
      designTokens: {
        preset: 'enterprise_compact',
        primaryColor: '#0284c7',
        radius: 'sharp',
        density: 'compact',
        colorMode: 'light',
      },
    });
    assert.equal(created.designTokens.preset, 'enterprise_compact');
    assert.equal(created.designTokens.antdThemeToken.compact, true);

    await callMcp('protoflow_manage_sitemap', {
      action: 'upsert_folder',
      folder: { id: 'f-wms', title: '入库作业', parentFolderId: null },
    });

    await callMcp('protoflow_upsert_db_tables', {
      action: 'upsert_tables',
      tables: WMS_TABLES,
    });

    const pageTsx = wrapTsx(`<Page pfId="p-wms" title="收货验收台" emptyTitle="暂无待处理入库单" errorFallback="result_500" errorTitle="仓储主服务连接超时">
  <Table
    pfId="t-wms"
    table="t_inbound_orders"
    emptyText="筛选结果为空"
    columns={[{ dataIndex: "order_no", title: "单号" }, { dataIndex: "status", title: "状态" }]}
    rowActions={[
      { label: "确认入库", disabledWhenField: "status", disabledWhenValue: "!待验收", disabledReason: "非待验收单不可入库", onClick: () => updateRow({ status: "已入库" }) },
      { label: "删除单据", danger: true, onClick: () => deleteRow("undo") },
      { label: "强制冲销", danger: true, onClick: () => { confirm("请确认冲销 {{row.order_no}}", "{{row.order_no}}"); updateRow({ status: "已作废" }); } }
    ]}
  />
  <Form pfId="f-wms-form" table="t_inbound_orders">
    <Input pfId="fi-no" name="order_no" label="单号" required={true} />
    <Select pfId="fi-st" name="status" label="状态" options="待验收,已入库,已作废" required={true} />
    <NumberInput pfId="fi-rem" name="remaining_qty" label="待收余量" required={true} minValue={1} />
    <NumberInput pfId="fi-in" name="inbound_qty" label="本次实收" required={true} maxField="remaining_qty" />
    <DatePicker pfId="fi-sd" name="start_date" label="开始日" required={true} />
    <DatePicker pfId="fi-ed" name="end_date" label="结束日" required={true} minField="start_date" />
    <Input pfId="fi-ph" name="driver_phone" label="手机号" required={true} formatRule="phone" />
    <Button pfId="btn-sub" type="primary" onClick={() => submitForm("f-wms-form")}>保存</Button>
  </Form>
</Page>`);

    await callMcp('protoflow_write_page', {
      pageId: 'wms-inbound',
      title: '收货验收台',
      folderId: 'f-wms',
      platform: 'desktop',
      source: pageTsx,
    });

    const overview = await callMcp('protoflow_get_project_overview', {});
    assert.equal(overview.designTokens.preset, 'enterprise_compact');
    assert.equal(overview.designTokens.cssVariables.light['--pf-primary'], '#0284c7');
    assert.equal(overview.designTokens.antdThemeToken.borderRadius, 4);

    const pageSpec = await callMcp('protoflow_get_page_spec', { pageId: 'wms-inbound' });
    assert.equal(pageSpec.uiStackSpec.pageEmptyTitle, '暂无待处理入库单');
    assert.equal(pageSpec.uiStackSpec.pageErrorFallback, 'result_500');
    assert.equal(pageSpec.uiStackSpec.pageErrorTitle, '仓储主服务连接超时');
    assert.ok(
      pageSpec.uiStackSpec.componentEmptyTexts.some(
        (x: { pfId: string; emptyText: string }) => x.pfId === 't-wms' && x.emptyText === '筛选结果为空',
      ),
    );

    assert.ok(
      pageSpec.pokaYokeRules.fieldConstraints.some(
        (c: { fieldName: string; maxField?: string }) => c.fieldName === 'inbound_qty' && c.maxField === 'remaining_qty',
      ),
    );
    assert.ok(
      pageSpec.pokaYokeRules.actionStateGuards.some(
        (g: { label: string; disabledWhenField?: string }) => g.label === '确认入库' && g.disabledWhenField === 'status',
      ),
    );
    assert.ok(
      pageSpec.pokaYokeRules.highRiskConfirmations.some(
        (h: { kind: string; matchText?: string }) => h.kind === 'match_text_confirm' && h.matchText === '{{row.order_no}}',
      ),
    );
    assert.ok(
      pageSpec.pokaYokeRules.highRiskConfirmations.some((h: { kind: string }) => h.kind === 'undoable_delete'),
    );
    assert.ok(
      pageSpec.pokaYokeRules.foreignKeyDeletePolicies.some(
        (fk: { parentTable: string; onDelete: string }) => fk.parentTable === 'wms_inbound_orders' && fk.onDelete === 'RESTRICT',
      ),
    );

    const audit = await callMcp('protoflow_audit_project', {});
    assert.equal(audit.healthy, true);

    const spec = exportDesignTokensSpec({ preset: 'modern_minimal' }, 'en-US');
    assert.equal(spec.presetLabel, 'Modern Minimal SaaS');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
