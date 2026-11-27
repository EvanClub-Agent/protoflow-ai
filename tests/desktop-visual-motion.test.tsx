import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { validateMaterialSource } from '../src/proto/registry/materialContract';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { RuntimeProvider, useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { NodeView } from '../src/proto/renderer/NodeView';
import { DesktopOverlayStack } from '../src/proto/registry/DesktopOverlayStack';
import { ProtoCanvasThemeScope } from '../src/proto/theme/ProtoCanvasThemeScope';
import { resolveDesktopAppearance } from '../src/proto/theme/designTokens';
import { countPinnedAppearancePages, unlockProjectAppearanceToFollowTheme } from '../src/proto/theme/unlockCanvasAppearance';
import { COMPONENT_MAP } from '../src/proto/registry/meta';
import { localizeComponentMeta } from '../src/proto/registry/localizeMeta';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { CaptureMode } from '../src/capture/CaptureMode';
import { PreviewDataContext } from '../src/proto/runtime/PreviewData';
import { validatePublishedSnapshot } from '../src/services/publishedSnapshot';
import { PublishedPageView, PublishedViewer } from '../src/viewer/PublishedViewer';
import { installTestDom } from './dom';

async function withDom(fn: () => void | Promise<void>) {
  const restore = installTestDom();
  try {
    await fn();
  } finally {
    await new Promise((r) => setTimeout(r, 0));
    restore();
  }
}

const wrapDesktop = (inner: string) => `export default function Page() {\n  return (\n    ${inner}\n  );\n}\n`;

const textOf = (inst: TestRenderer.ReactTestInstance | string): string =>
  typeof inst === 'string'
    ? inst
    : inst.children.map((c) => textOf(c as TestRenderer.ReactTestInstance | string)).join('');

const DESKTOP_TEST_TABLES: DBTableSchema[] = [
  {
    id: 't_orders',
    tableName: 'work_orders',
    cnName: '维保工单表',
    domain: '维保调度',
    description: '维保工单主表',
    sharedByMenus: [],
    columns: [
      { id: 'c_id', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '工单ID' },
      { id: 'c_code', name: 'order_no', dataType: 'VARCHAR(64)', nullable: false, comment: '工单编号' },
      { id: 'c_status', name: 'status', dataType: "ENUM('待派单','上门中','已结单')", nullable: false, comment: '状态' },
      { id: 'c_amt', name: 'total_amount', dataType: 'DECIMAL(12,2)', nullable: false, comment: '金额' },
    ],
  },
  {
    id: 't_ledger',
    tableName: 'part_ledger',
    cnName: '备件领用流水表',
    domain: '备件仓配',
    description: '备件领用流水子表',
    sharedByMenus: [],
    columns: [
      { id: 'l_id', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '流水ID' },
      {
        id: 'l_oid',
        name: 'order_id',
        dataType: 'VARCHAR(32)',
        nullable: false,
        isForeignKey: true,
        references: 'work_orders(id)',
        foreignKeyOptions: { onDelete: 'CASCADE' },
        comment: '所属工单',
      },
      { id: 'l_title', name: 'part_name', dataType: 'VARCHAR(120)', nullable: false, comment: '备件名称' },
      { id: 'l_price', name: 'unit_price', dataType: 'DECIMAL(10,2)', nullable: true, comment: '单价' },
      { id: 'l_delta', name: 'delta_amount', dataType: 'VARCHAR(40)', nullable: true, comment: '变动金额' },
      { id: 'l_dir', name: 'direction', dataType: 'VARCHAR(20)', nullable: true, comment: '方向' },
      { id: 'l_state', name: 'state', dataType: 'VARCHAR(20)', nullable: false, comment: '核销状态' },
    ],
  },
  {
    id: 't_metrics',
    tableName: 'sla_metrics',
    cnName: 'SLA达成指标表',
    domain: '履约监控',
    description: 'SLA指标子表',
    sharedByMenus: [],
    columns: [
      { id: 'm_id', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' },
      {
        id: 'm_oid',
        name: 'order_id',
        dataType: 'VARCHAR(32)',
        nullable: true,
        isForeignKey: true,
        references: 'work_orders(id)',
        foreignKeyOptions: { onDelete: 'CASCADE' },
        comment: '关联工单',
      },
      { id: 'm_label', name: 'metric_name', dataType: 'VARCHAR(80)', nullable: false, comment: '指标名' },
      { id: 'm_val', name: 'progress_pct', dataType: 'VARCHAR(20)', nullable: true, comment: '达成率' },
      { id: 'm_target', name: 'target_pct', dataType: 'INT', nullable: true, comment: '目标率' },
      { id: 'm_status', name: 'health_state', dataType: 'VARCHAR(20)', nullable: true, comment: '状态' },
    ],
  },
];

function LiveDesktopHost({
  pageId,
  source,
  capture = false,
  isDesign = false,
  onRuntime,
}: {
  pageId: string;
  source: string;
  capture?: boolean;
  isDesign?: boolean;
  onRuntime?: (rt: Runtime) => void;
}) {
  const doc = React.useMemo(() => parsePageSource(source).doc!, [source]);
  const rt = useRuntimeController(doc, pageId, isDesign);
  onRuntime?.(rt);
  const tree = React.createElement(
    ProtoCanvasThemeScope,
    {
      pageAppearance: doc.root.props.appearance,
      surfaceBg: doc.root.props.surfaceBg,
      accent: doc.root.props.accent,
      motion: doc.root.props.motion,
      captureMode: capture,
    },
    React.createElement(
      RuntimeProvider,
      { value: rt },
      React.createElement(NodeView, { node: doc.root }),
      React.createElement(DesktopOverlayStack, {
        overlays: rt.overlays,
        resolveNode: (id) => {
          const found = doc.root.children.find(
            (c) => c.kind === 'node' && (c.props.id === id || c.pfId === id),
          );
          return found && found.kind === 'node' ? found : undefined;
        },
      }),
    ),
  );
  return capture
    ? React.createElement(CaptureMode.Provider, { value: true }, tree)
    : tree;
}

test('Desktop visual & motion upgrade: DSL round-trip, surface tokens, Card de-cluttering & AiCopilotCard dark_brief', () =>
  withDom(() => {
    useProtoStore.setState({ dbTables: DESKTOP_TEST_TABLES, uiState: 'normal' });
    usePageStore.setState({
      tableRows: {
        t_orders: [{ id: 'wo-1', order_no: 'WO-202611-01', status: '上门中', total_amount: 12800 }],
        t_ledger: [],
        t_metrics: [],
      },
    });

    const tsx = wrapDesktop(`<Page pfId="p-root" title="星链维保驾驶舱" surfaceBg="sage_field" accent="lime_forest" appearance="light" motion="smooth">
  <PageHeader pfId="ph-1" title="星链售后履约指挥台" subTitle="实时调度 · 华东战区" tagText="SLA 正常" tagColor="green" />
  <Row pfId="row-kpi" gutter={16}>
    <Col pfId="col-k1" span={8}>
      <Statistic pfId="st-inv" title="本月备件授信余额" prefix="¥" value="128,450.80" tone="inverted" icon="Wallet" trendText="+14.2%" statusBadge="额度充裕" sparkline={true} />
    </Col>
    <Col pfId="col-k2" span={8}>
      <Statistic pfId="st-zero" title="超时积压工单" value="0" suffix="单" tone="card" />
    </Col>
    <Col pfId="col-k3" span={8}>
      <Statistic pfId="st-missing" title="未绑定指标" value="" tone="subtle" />
    </Col>
  </Row>
  <Row pfId="row-main" gutter={16}>
    <Col pfId="col-left" span={14}>
      <Card pfId="card-chart" title="近7日工单趋势" variant="bento">
        <AreaChart pfId="chart-1" title="日闭环量" source="sample" height={240} />
      </Card>
      <Card pfId="card-tbl" title="活跃工单池" variant="default">
        <Table pfId="tbl-orders" table="t_orders" />
      </Card>
    </Col>
    <Col pfId="col-right" span={10}>
      <AiCopilotCard
        pfId="ai-brief"
        title="AI 战区履约晨报"
        badge="实时研判"
        timestamp="09:42 更新"
        tone="dark_brief"
        summary="华东核心仓光模块周转率提升 12%，建议优先派发上海浦东 2 单 P1 巡检。"
        primaryActionLabel="一键智能派单"
        items={[
          { title: '浦东陆家嘴基站巡检', detail: '距离工程师林工 1.8km', actionLabel: '立即指派' }
        ]}
      />
      <Card pfId="card-inverted" title="反色压舱摘要卡" variant="inverted">
        <Descriptions pfId="desc-inv" items={[{ label: '值班主管', value: '林致远' }, { label: '响应等级', value: 'P0 战备' }]} />
      </Card>
    </Col>
  </Row>
</Page>`);

    assert.deepEqual(validateMaterialSource(tsx), []);
    const parsed = parsePageSource(tsx);
    assert.ok(parsed.doc);
    assert.deepEqual(pageContractErrors(tsx, DESKTOP_TEST_TABLES), []);

    const reprinted = printPageSource(parsed.doc);
    assert.deepEqual(validateMaterialSource(reprinted), []);

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(LiveDesktopHost, { pageId: 'p-overview', source: tsx }));
    });

    const pageDiv = renderer.root.find((el) => el.type === 'div' && el.props['data-desktop-appearance'] === 'light');
    assert.equal(pageDiv.props['data-surface-bg'], 'sage_field');
    assert.equal(pageDiv.props['data-accent'], 'lime_forest');
    assert.equal(pageDiv.props['data-motion'], 'smooth');

    //Chart inside Card melts duplicate border (data-inside-card="1" and p-0)
    const chartSec = renderer.root.find((el) => el.type === 'section' && el.props['data-chart-type'] === 'AreaChart');
    assert.equal(chartSec.props['data-inside-card'], '1');
    assert.match(String(chartSec.props.className), /\bp-0\b/);

    // Table inside Card has accessible scroll region (tabIndex=0, role="region") and hides noisy preview caption in live mode
    const tblRegion = renderer.root.find((el) => el.type === 'div' && el.props.role === 'region');
    assert.equal(tblRegion.props.tabIndex, 0);
    assert.ok(!JSON.stringify(renderer.toJSON()).includes('原型预览数据 · 保存在工程内'));

    // Statistic: split decimal (.80), valid 0 ("0"), and missing empty value ("—" with data-missing-value="1")
    const splitNode = renderer.root.find((el) => el.type === 'span' && el.props['data-split-metric'] === '1');
    assert.ok(textOf(splitNode).includes('128,450.80'));
    const missingNode = renderer.root.find((el) => el.type === 'span' && el.props['data-missing-value'] === '1');
    assert.equal(textOf(missingNode), '—');
    const zeroStat = renderer.root.find((el) => el.props['data-pf-id'] === 'st-zero');
    assert.ok(textOf(zeroStat).includes('0'));

    // AiCopilotCard dark_brief & Card inverted colorScheme
    const copilot = renderer.root.find((el) => el.type === 'section' && el.props['data-copilot-tone'] === 'dark_brief');
    assert.equal(copilot.props.style?.colorScheme, 'dark');
    const invertedCard = renderer.root.find((el) => el.props['data-card-variant'] === 'inverted');
    assert.equal(invertedCard.props.style?.colorScheme, 'dark');

    act(() => renderer.unmount());
  }));

test('Desktop visual & motion upgrade: [P1 #1] static ActivityFeed inside parent-row Drawer isolates scope & blocks parent mutations', () =>
  withDom(async () => {
    useProtoStore.setState({ dbTables: DESKTOP_TEST_TABLES, uiState: 'normal' });
    usePageStore.setState({
      tableRows: {
        t_orders: [{ id: 'wo-parent-1', order_no: 'WO-PARENT-01', status: '已结单', total_amount: 9800 }],
        t_ledger: [],
        t_metrics: [],
      },
    });

    const badDeleteTsx = wrapDesktop(`<Page pfId="p-root" title="工单页">
  <Table pfId="tbl-main" table="t_orders" rowActions={[{ label: '详情', onClick: () => openDrawer('drw-detail') }]} />
  <Drawer pfId="drw-1" id="drw-detail" title="工单详情">
    <ActivityFeed
      pfId="af-static-bad"
      items={[{ title: '静态流水项', amount: '-¥120.00', tone: 'outflow' }]}
      rowActions={[{ label: '删除', danger: true, onClick: () => deleteRow() }]}
    />
  </Drawer>
</Page>`);

    assert.deepEqual(validateMaterialSource(badDeleteTsx), []);
    const contractErrs = pageContractErrors(badDeleteTsx, DESKTOP_TEST_TABLES);
    assert.ok(
      contractErrs.some((e) => e.includes('af-static-bad.rowActions[0].onClick') && e.includes('deleteRow')),
      `Expected static ActivityFeed deleteRow inside parent Drawer to fail contract check, got: ${contractErrs.join('; ')}`,
    );

    // Runtime defense-in-depth: even if rendered directly, deleteRow button is disabled and toast '{{row.id}}' sees no parent row
    const runtimeCheckTsx = wrapDesktop(`<Page pfId="p-root" title="工单页" motion="none">
  <Table pfId="tbl-main" table="t_orders" rowActions={[{ label: '详情', onClick: () => openDrawer('drw-detail') }]} />
  <Drawer pfId="drw-1" id="drw-detail" title="工单详情">
    <ActivityFeed
      pfId="af-static"
      items={[{ title: '静态流水项', subtitle: '静态说明', amount: '-¥120.00', tone: 'outflow' }]}
      onItemClick={() => toast('row={{row.id}}')}
      rowActions={[
        { label: '违规删父单', danger: true, onClick: () => deleteRow() },
        { label: '查看静态提示', onClick: () => toast('parent={{row.order_no}}') }
      ]}
    />
  </Drawer>
</Page>`);

    let capturedRt!: Runtime;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(LiveDesktopHost, {
          pageId: 'p-iso',
          source: runtimeCheckTsx,
          onRuntime: (r) => {
            capturedRt = r;
          },
        }),
      );
    });

    // Open Drawer from parent row wo-parent-1
    const openBtn = renderer.root.findAllByType('button').find((b) => textOf(b) === '详情')!;
    await act(async () => {
      openBtn.props.onClick({ stopPropagation() {} });
    });

    const delBtn = renderer.root.findAllByType('button').find((b) => textOf(b) === '违规删父单')!;
    assert.equal(delBtn.props.disabled, true, 'Static ActivityFeed rowAction with deleteRow must be disabled at runtime');

    const toastBtn = renderer.root.findAllByType('button').find((b) => textOf(b) === '查看静态提示')!;
    await act(async () => {
      toastBtn.props.onClick({ stopPropagation() {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_orders.length, 1, 'Parent row must remain intact');
    const lastToastMsg = capturedRt.toasts.at(-1)?.message ?? '';
    assert.ok(
      !lastToastMsg.includes('WO-PARENT-01'),
      `Static ActivityFeed must not leak parent row interpolation, got: ${lastToastMsg}`,
    );

    act(() => renderer.unmount());
  }));

test('Desktop visual & motion upgrade: [P1 #2] staging & publish share ProgressBoard / ActivityFeed field & guard validation', () => {
  // 1. Missing valueField on bound ProgressBoard
  const missingValueTsx = wrapDesktop(`<Page pfId="p-root" title="测试">
  <ProgressBoard pfId="pb-1" table="t_metrics" labelField="metric_name" />
</Page>`);
  assert.ok(pageContractErrors(missingValueTsx, DESKTOP_TEST_TABLES).some((e) => e.includes('valueField')));

  // 2. Missing amountField on bound ActivityFeed
  const missingAmtTsx = wrapDesktop(`<Page pfId="p-root" title="测试">
  <ActivityFeed pfId="af-1" table="t_ledger" titleField="part_name" />
</Page>`);
  assert.ok(pageContractErrors(missingAmtTsx, DESKTOP_TEST_TABLES).some((e) => e.includes('amountField')));

  // 3. Misspelled disabledWhenField on bound & static ActivityFeed
  const typoGuardBoundTsx = wrapDesktop(`<Page pfId="p-root" title="测试">
  <ActivityFeed
    pfId="af-guard"
    table="t_ledger"
    titleField="part_name"
    amountField="delta_amount"
    rowActions={[{ label: '冲销', disabledWhenField: 'sttae', disabledWhenValue: '已冲销', onClick: () => toast('ok') }]}
  />
</Page>`);
  const stageErrs3 = pageContractErrors(typoGuardBoundTsx, DESKTOP_TEST_TABLES);
  assert.ok(stageErrs3.some((e) => e.includes('t_ledger.sttae')));

  // Verify validatePublishedSnapshot rejects the exact same invalid bindings
  assert.throws(
    () =>
      validatePublishedSnapshot({
        formatVersion: 3,
        projectId: 'proj-test',
        title: 'Test',
        entryPageId: 'p1',
        sitemap: [
          {
            id: 'fld-1',
            title: '默认',
            type: 'folder',
            deprecated: false,
            children: [{ id: 'it-1', title: '测试', type: 'page', deprecated: false, pageId: 'p1' }],
          },
        ],
        pages: [{ pageId: 'p1', title: '测试', folderId: 'fld-1', doc: parsePageSource(typoGuardBoundTsx).doc! }],
        tables: DESKTOP_TEST_TABLES,
        tableRows: { t_orders: [], t_ledger: [], t_metrics: [] },
        stickyNotes: [],
      }),
    /sttae/,
  );

  // 4. Non-FK column used as sourceForeignKey fails staging immediately
  const badFkTsx = wrapDesktop(`<Page pfId="p-root" title="测试">
  <ProgressBoard pfId="pb-badfk" table="t_metrics" labelField="metric_name" valueField="progress_pct" sourceForeignKey="metric_name" />
</Page>`);
  assert.ok(pageContractErrors(badFkTsx, DESKTOP_TEST_TABLES).some((e) => e.includes('sourceForeignKey')));
});

test('Desktop visual & motion upgrade: [P1 #3, #4] & [P2 #1, #4] strict numeric parsing, empty items, keyboard target isolation & gauge 3rd+ item click', () =>
  withDom(async () => {
    useProtoStore.setState({ dbTables: DESKTOP_TEST_TABLES, uiState: 'normal' });
    usePageStore.setState({
      tableRows: {
        t_orders: [{ id: 'wo-1', order_no: 'WO-01', status: '上门中', total_amount: 500 }],
        t_ledger: [
          {
            id: 'lg-1',
            order_id: 'wo-1',
            part_name: '光模块A',
            unit_price: 91,
            delta_amount: null,
            direction: 'outflow',
            state: '正常',
          },
          {
            id: 'lg-2',
            order_id: 'wo-1',
            part_name: '天线馈线B',
            unit_price: 45,
            delta_amount: '-3',
            direction: 'outflow',
            state: '已锁定',
          },
        ],
        t_metrics: [
          { id: 'm-1', order_id: 'wo-1', metric_name: '零值指标', progress_pct: '0', target_pct: 80, health_state: '正常' },
          { id: 'm-2', order_id: 'wo-1', metric_name: '缺失指标', progress_pct: '', target_pct: 85, health_state: '待上报' },
          { id: 'm-3', order_id: 'wo-1', metric_name: '非法指标', progress_pct: 'TBD', target_pct: 90, health_state: '异常' },
        ],
      },
    });

    const tsx = wrapDesktop(`<Page pfId="p-root" title="精度与交互核验" motion="none">
  <ActivityFeed pfId="af-empty" title="空静态流水" items={[]} emptyText="空流水占位" />
  <ProgressBoard pfId="pb-empty" title="空静态进度" items={[]} emptyText="空进度占位" />
  <SearchInput pfId="search-af" target="af-bound" placeholder="搜备件..." />
  <ActivityFeed
    pfId="af-bound"
    table="t_ledger"
    titleField="part_name"
    amountField="delta_amount"
    typeField="direction"
    onItemClick={() => toast('rowClick={{row.part_name}}')}
    rowActions={[
      {
        label: '核销动作',
        primary: true,
        disabledWhenField: 'state',
        disabledWhenValue: '已锁定',
        disabledReason: '锁定记录不可核销',
        onClick: () => toast('action={{row.part_name}}')
      },
      {
        label: '可撤删除',
        danger: true,
        onClick: () => deleteRow('undo')
      }
    ]}
  />
  <ProgressBoard
    pfId="pb-gauge"
    variant="gauge"
    cols={2}
    table="t_metrics"
    labelField="metric_name"
    valueField="progress_pct"
    targetField="target_pct"
    statusField="health_state"
    onItemClick={() => openDrawer('drw-metric')}
  />
  <Drawer pfId="drw-m" id="drw-metric" title="指标详情">
    <Descriptions pfId="desc-m" table="t_metrics" />
  </Drawer>
</Page>`);

    assert.deepEqual(validateMaterialSource(tsx), []);
    assert.deepEqual(pageContractErrors(tsx, DESKTOP_TEST_TABLES), []);

    let capturedRt!: Runtime;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(LiveDesktopHost, {
          pageId: 'p-strict',
          source: tsx,
          onRuntime: (r) => {
            capturedRt = r;
          },
        }),
      );
    });

    const fullText = textOf(renderer.root);
    // Explicit empty items=[] renders empty states, never demo items
    assert.ok(fullText.includes('空流水占位'));
    assert.ok(fullText.includes('空进度占位'));
    // Must NEVER guess unit_price 91 when delta_amount is null
    assert.ok(!JSON.stringify(renderer.toJSON()).includes('"91"'), 'ActivityFeed must never display unconfigured unit_price 91');
    // ProgressBoard distinguishes 0%, missing (—), and invalid (无效值)
    assert.ok(fullText.includes('0%'));
    assert.ok(fullText.includes('无效值'));

    // [P2 #4] Gauge 3rd overflow item ('非法指标', id 'm-3') has full click activation & passes bound row scope to Drawer
    const thirdMetricRow = renderer.root.find(
      (el) => el.type === 'div' && el.props['data-row-id'] === 'm-3',
    );
    await act(async () => {
      thirdMetricRow.props.onClick();
    });
    assert.equal(capturedRt.overlays.length, 1);
    assert.equal((capturedRt.overlays[0]?.params.row as { id?: string } | undefined)?.id, 'm-3');
    await act(async () => {
      capturedRt.closeOverlay();
    });

    // [P2 #1] Pressing Enter on a nested button inside ActivityFeed row must NOT trigger row onItemClick
    const firstActivityRow = renderer.root.find(
      (el) => el.type === 'div' && el.props['data-activity-row-surface'] === '1' && el.props['data-row-id'] === 'lg-1',
    );
    const nestedBtn = firstActivityRow.findAllByType('button')[0]!;
    const toastCountBefore = capturedRt.toasts.length;
    act(() => {
      firstActivityRow.props.onKeyDown({
        key: 'Enter',
        target: nestedBtn,
        currentTarget: firstActivityRow,
        preventDefault() {},
      });
    });
    assert.equal(capturedRt.toasts.length, toastCountBefore, 'Row keydown from nested button must not fire row click');

    // Disabled guard on lg-2 ('已锁定')
    const secondActivityRow = renderer.root.find(
      (el) => el.type === 'div' && el.props['data-activity-row-surface'] === '1' && el.props['data-row-id'] === 'lg-2',
    );
    const lockedActionBtn = secondActivityRow.findAllByType('button').find((b) => textOf(b) === '核销动作')!;
    assert.equal(lockedActionBtn.props.disabled, true);
    assert.equal(lockedActionBtn.props['data-disabled-reason'], '锁定记录不可核销');

    // 5s Undo delete on lg-1 & restore
    const undoDelBtn = firstActivityRow.findAllByType('button').find((b) => textOf(b) === '可撤删除')!;
    await act(async () => {
      undoDelBtn.props.onClick({ stopPropagation() {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_ledger.length, 1);
    const undoToast = capturedRt.toasts.find((t) => Boolean(t.undoAction));
    assert.ok(undoToast?.undoAction);
    act(() => {
      undoToast!.undoAction!.onUndo();
    });
    assert.equal(usePageStore.getState().tableRows.t_ledger.length, 2);

    act(() => renderer.unmount());
  }));

test('Desktop visual & motion upgrade: [P2 #2, #3, #5] DesktopOverlayStack exit retention, CaptureMode instant settle & auto+oled_carbon first-click toggle', () =>
  withDom(async () => {
    const origRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof requestAnimationFrame;

  try {
    useProtoStore.setState({ dbTables: DESKTOP_TEST_TABLES, uiState: 'normal' });
    usePageStore.setState({ tableRows: { t_orders: [], t_ledger: [], t_metrics: [] } });

    const overlayTsx = wrapDesktop(`<Page pfId="p-root" title="弹层退场验证" surfaceBg="oled_carbon" motion="smooth">
  <Button pfId="btn-open" type="primary" onClick={() => openDrawer('drw-anim')}>打开抽屉</Button>
  <Drawer pfId="drw-node" id="drw-anim" title="平滑退场抽屉">
    <Text pfId="txt-in-drw">抽屉内部内容</Text>
  </Drawer>
</Page>`);

    const finishCallbacks: Array<() => void> = [];
    let capturedRt!: Runtime;
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        React.createElement(LiveDesktopHost, {
          pageId: 'p-anim',
          source: overlayTsx,
          onRuntime: (r) => {
            capturedRt = r;
          },
        }),
        {
          createNodeMock: (element: React.ReactElement) => {
            if (element.type === 'div') {
              return {
                getAnimations: () => [
                  {
                    finished: new Promise<void>((res) => {
                      finishCallbacks.push(res);
                    }),
                  },
                ],
              };
            }
            return null;
          },
        },
      );
    });

    // Open drawer
    const openBtn = renderer.root.findAllByType('button').find((b) => textOf(b).includes('打开抽屉'))!;
    await act(async () => {
      openBtn.props.onClick({ stopPropagation() {} });
    });
    assert.equal(capturedRt.overlays.length, 1);
    assert.ok(JSON.stringify(renderer.toJSON()).includes('抽屉内部内容'));

    // Close drawer -> runtime.overlays becomes empty immediately, but DesktopOverlayStack retains panel with data-closing="1"
    await act(async () => {
      capturedRt.closeOverlay();
    });
    assert.equal(capturedRt.overlays.length, 0);
    const closingDrawer = renderer.root.find(
      (el) => el.type === 'div' && el.props['data-overlay-kind'] === 'drawer',
    );
    assert.equal(closingDrawer.props['data-closing'], '1');
    assert.equal(closingDrawer.props.inert, '');

    // Resolve all WAAPI animations (panel + backdrop) -> unmounts cleanly
    await act(async () => {
      for (const fn of finishCallbacks.splice(0)) fn();
      await Promise.resolve();
    });
    assert.equal(
      renderer.root.findAll((el) => el.type === 'div' && el.props['data-overlay-kind'] === 'drawer').length,
      0,
    );
    act(() => renderer.unmount());

    // CaptureMode instant settle: zero retention when closing
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(LiveDesktopHost, {
          pageId: 'p-cap',
          source: overlayTsx,
          capture: true,
          onRuntime: (r) => {
            capturedRt = r;
          },
        }),
      );
    });
    const capOpenBtn = renderer.root.findAllByType('button').find((b) => textOf(b).includes('打开抽屉'))!;
    await act(async () => {
      capOpenBtn.props.onClick({ stopPropagation() {} });
    });
    assert.equal(
      renderer.root.findAll((el) => el.type === 'div' && el.props['data-overlay-kind'] === 'drawer').length,
      1,
    );
    await act(async () => {
      capturedRt.closeOverlay();
    });
    assert.equal(
      renderer.root.findAll((el) => el.type === 'div' && el.props['data-overlay-kind'] === 'drawer').length,
      0,
      'CaptureMode must unmount overlay synchronously without exit retention',
    );
    act(() => renderer.unmount());

    // [P2 #5] PublishedPageView with appearance="auto" (omitted) + surfaceBg="oled_carbon" in light workspace starts dark & flips to light on FIRST click
    assert.equal(resolveDesktopAppearance(undefined, 'light', null, 'oled_carbon'), 'dark');
    const pubDoc = parsePageSource(overlayTsx).doc!;
    let pubRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      pubRenderer = TestRenderer.create(
        React.createElement(PublishedPageView, {
          page: {
            pageId: 'p-oled',
            title: 'OLED Desktop',
            source: overlayTsx,
            doc: pubDoc,
          },
        }),
      );
    });
    const themeScopeBefore = pubRenderer.root.find(
      (el) => el.type === 'div' && el.props['data-pf-theme-scope'] === '1',
    );
    assert.equal(themeScopeBefore.props['data-pf-mode'], 'dark');

    const toggleBtn = pubRenderer.root.findByProps({ 'data-testid': 'desktop-appearance-toggle' });
    act(() => {
      toggleBtn.props.onClick();
    });
    const themeScopeAfter = pubRenderer.root.find(
      (el) => el.type === 'div' && el.props['data-pf-theme-scope'] === '1',
    );
    assert.equal(
      themeScopeAfter.props['data-pf-mode'],
      'light',
      'First click on desktop appearance toggle must switch auto+oled_carbon page from dark to light immediately',
    );
    act(() => pubRenderer.unmount());
  } finally {
    globalThis.requestAnimationFrame = origRaf;
  }
  }));

test('Desktop visual & motion upgrade: en-US localization for upgraded & new desktop materials', () => {
  for (const name of ['Page', 'Card', 'Statistic', 'AiCopilotCard', 'ProgressBoard', 'ActivityFeed']) {
    const raw = COMPONENT_MAP[name];
    assert.ok(raw, `Missing COMPONENT_MAP entry for ${name}`);
    const en = localizeComponentMeta(raw, 'en-US');
    assert.ok(!/[\u4e00-\u9fff]/.test(en.title), `Expected English title for ${name}, got: ${en.title}`);
    assert.ok(!/[\u4e00-\u9fff]/.test(en.description), `Expected English description for ${name}, got: ${en.description}`);
    for (const p of en.props) {
      assert.ok(!/[\u4e00-\u9fff]/.test(p.label), `Expected English prop label for ${name}.${p.name}, got: ${p.label}`);
      if (p.description) {
        assert.ok(
          !/[\u4e00-\u9fff]/.test(p.description),
          `Expected English prop description for ${name}.${p.name}, got: ${p.description}`,
        );
      }
    }
    const snippetTsx = wrapDesktop(`<Page pfId="p-en">${en.snippet.startsWith('<Page') ? '' : en.snippet}</Page>`);
    if (!en.snippet.startsWith('<Page')) {
      const parsed = parsePageSource(snippetTsx);
      assert.ok(parsed.doc, `Expected localized snippet for ${name} to parse cleanly`);
    }
  }
});

test('Desktop review regressions: [P1 #1] read-only draft preview never seeds global project tableRows for ActivityFeed, ProgressBoard, MActivityList & MProgressList', () =>
  withDom(async () => {
    // Active project has NO rows initialized for t_ledger or t_metrics at all
    useProtoStore.setState({ dbTables: DESKTOP_TEST_TABLES, uiState: 'normal' });
    usePageStore.setState({ tableRows: {} });

    const desktopDraftTsx = wrapDesktop(`<Page pfId="p-draft" title="草稿只读预览">
  <ActivityFeed
    pfId="af-draft"
    table="t_ledger"
    titleField="part_name"
    amountField="delta_amount"
    rowActions={[{ label: '核查', disabledWhenField: 'state', disabledWhenValue: '锁定', onClick: () => toast('draft') }]}
  />
  <ProgressBoard
    pfId="pb-draft"
    table="t_metrics"
    labelField="metric_name"
    valueField="progress_pct"
    onItemClick={() => toast('metric')}
  />
</Page>`);

    const mobileDraftTsx = `export default function Page() {
  return (
    <MobilePage pfId="mp-draft" title="移动草稿">
      <MActivityList pfId="maf-draft" table="t_ledger" titleField="part_name" amountField="delta_amount" />
      <MProgressList pfId="mpb-draft" table="t_metrics" labelField="metric_name" valueField="progress_pct" onItemClick={() => toast('m')} />
    </MobilePage>
  );
}`;

    const draftRows = {
      t_ledger: [
        { id: 'draft-lg-1', order_id: 'wo-1', part_name: '草稿备件A', delta_amount: '-18.5', state: '正常' },
      ],
      t_metrics: [
        { id: 'draft-m-1', order_id: 'wo-1', metric_name: '草稿达成率', progress_pct: '92', target_pct: 85 },
      ],
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          PreviewDataContext.Provider,
          { value: { tables: DESKTOP_TEST_TABLES, rows: draftRows } },
          React.createElement(LiveDesktopHost, { pageId: 'p-draft', source: desktopDraftTsx }),
        ),
      );
    });

    // getRows commits lazy project seeds in a microtask after render.
    await Promise.resolve();
    const renderedText = JSON.stringify(renderer.toJSON());
    assert.ok(renderedText.includes('草稿备件A'));
    assert.ok(renderedText.includes('草稿达成率'));
    assert.deepEqual(
      usePageStore.getState().tableRows,
      {},
      'Opening read-only draft preview for desktop ActivityFeed / ProgressBoard must not write mock rows into project tableRows',
    );
    act(() => renderer.unmount());
    await Promise.resolve();
    assert.deepEqual(usePageStore.getState().tableRows, {});

    // Verify mobile MActivityList / MProgressList parity as well
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          PreviewDataContext.Provider,
          { value: { tables: DESKTOP_TEST_TABLES, rows: draftRows } },
          React.createElement(LiveDesktopHost, { pageId: 'mp-draft', source: mobileDraftTsx }),
        ),
      );
    });
    await Promise.resolve();
    const mobileText = JSON.stringify(renderer.toJSON());
    assert.ok(mobileText.includes('草稿备件A'));
    assert.ok(mobileText.includes('草稿达成率'));
    assert.deepEqual(
      usePageStore.getState().tableRows,
      {},
      'Opening read-only draft preview for mobile MActivityList / MProgressList must not write mock rows into project tableRows',
    );
    act(() => renderer.unmount());
    await Promise.resolve();
    assert.deepEqual(usePageStore.getState().tableRows, {});
  }));

test('Desktop review regressions: [P1 #2] ActivityFeed with sourceForeignKey + autoSelectFirst keeps child rows visible after auto-selecting first child row', () =>
  withDom(async () => {
    try {
    useProtoStore.setState({
      dbTables: DESKTOP_TEST_TABLES,
      uiState: 'normal',
      activePageId: 'p-detail',
      navigationSource: { tableId: 't_orders', rowId: 'wo-1' },
    });
    usePageStore.setState({
      tableRows: {
        t_orders: [
          { id: 'wo-1', order_no: 'WO-001', status: '上门中', total_amount: 1200 },
          { id: 'wo-2', order_no: 'WO-002', status: '待派单', total_amount: 800 },
          { id: 'wo-empty', order_no: 'WO-003', status: '待派单', total_amount: 0 },
        ],
        t_ledger: [
          { id: 'lg-wo1', order_id: 'wo-1', part_name: '工单1专属光模块', delta_amount: '-260.00', direction: 'outflow', state: '正常' },
          { id: 'lg-wo2', order_id: 'wo-2', part_name: '工单2专属射频板', delta_amount: '-580.00', direction: 'outflow', state: '正常' },
        ],
        t_metrics: [],
      },
    });

    const fkAutoSelectTsx = wrapDesktop(`<Page pfId="p-root" title="工单关联流水" motion="none">
  <ActivityFeed
    pfId="af-fk"
    table="t_ledger"
    sourceForeignKey="order_id"
    autoSelectFirst={true}
    titleField="part_name"
    amountField="delta_amount"
    typeField="direction"
  />
  <Card pfId="ledger-detail" activeTable="t_ledger" title="流水={{row.id}}" />
</Page>`);

    assert.deepEqual(pageContractErrors(fkAutoSelectTsx, DESKTOP_TEST_TABLES), []);

    let capturedRt!: Runtime;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(LiveDesktopHost, {
          pageId: 'p-detail',
          source: fkAutoSelectTsx,
          onRuntime: (r) => {
            capturedRt = r;
          },
        }),
      );
    });

    // useAutoSelectFirstRow has already fired on mount and set activeRows.t_ledger = 'lg-wo1'
    assert.equal(capturedRt.activeRows.t_ledger, 'lg-wo1');
    const jsonAfterSelect = JSON.stringify(renderer.toJSON());
    assert.ok(
      jsonAfterSelect.includes('工单1专属光模块'),
      'ActivityFeed must retain parent-scoped child rows after autoSelectFirst activates the child table row',
    );
    assert.ok(!jsonAfterSelect.includes('工单2专属射频板'));
    const activeRowEl = renderer.root.find(
      (el) => el.type === 'div' && el.props['data-activity-row-surface'] === '1' && el.props['data-row-id'] === 'lg-wo1',
    );
    assert.equal(activeRowEl.props['data-active-row'], '1');

    const detail = () => textOf(renderer.root.findByProps({ 'data-pf-id': 'ledger-detail' }));
    assert.match(detail(), /流水=lg-wo1/);
    act(() => capturedRt.setActiveRow('t_orders', 'wo-2'));
    assert.equal(capturedRt.activeRows.t_ledger, 'lg-wo2');
    assert.match(detail(), /流水=lg-wo2/);
    act(() => capturedRt.setActiveRow('t_orders', 'wo-empty'));
    assert.equal(capturedRt.activeRows.t_ledger, undefined);
    assert.doesNotMatch(detail(), /lg-wo[12]/);
    act(() => capturedRt.setActiveRow('t_orders', 'wo-1'));
    assert.equal(capturedRt.activeRows.t_ledger, 'lg-wo1');

    act(() => renderer.unmount());
  } finally {
    useProtoStore.setState({ navigationSource: null });
  }
  }));

for (const [pageType, feedType] of [['Page', 'ActivityFeed'], ['MobilePage', 'MActivityList']]) {
  test(`${feedType} keeps the parent of a self-referencing collection across child selections`, () =>
    withDom(async () => {
      const ledger = DESKTOP_TEST_TABLES.find(table => table.id === 't_ledger')!;
      const tables = [{
        ...ledger,
        columns: ledger.columns.map(column => column.name === 'order_id'
          ? { ...column, nullable: true, references: 'part_ledger(id)' }
          : column),
      }];
      const detailType = pageType === 'Page' ? 'Card' : 'MSurface';
      const source = wrapDesktop(`<${pageType} pfId="page">
        <${feedType} pfId="feed" table="t_ledger" sourceForeignKey="order_id" titleField="part_name"
          amountField="delta_amount" autoSelectFirst={true} onItemClick={() => selectRow()} />
        <${detailType} pfId="detail" activeTable="t_ledger" title="选中={{row.id}}" />
      </${pageType}>`);
      assert.deepEqual(pageContractErrors(source, tables), []);
      useProtoStore.setState({ dbTables: tables, uiState: 'normal', activePageId: 'tree',
        navigationSource: { tableId: ledger.id, rowId: 'parent' } });
      usePageStore.setState({ tableRows: { t_ledger: [
        { id: 'parent', part_name: '根' },
        { id: 'child-a', order_id: 'parent', part_name: '甲' },
        { id: 'child-b', order_id: 'parent', part_name: '乙' },
        { id: 'grandchild', order_id: 'child-b', part_name: '孙' },
      ] } });
      let rt!: Runtime;
      let view!: TestRenderer.ReactTestRenderer;
      try {
        await act(async () => {
          view = TestRenderer.create(<LiveDesktopHost pageId="tree" source={source} onRuntime={value => { rt = value; }} />);
        });
        const visible = () => view.root.findAll(el => el.type === 'div' && el.props['data-row-id'])
          .map(el => el.props['data-row-id']);
        assert.deepEqual(visible(), ['child-a', 'child-b']);
        assert.equal(rt.activeRows[ledger.id], 'child-a');
        const second = view.root.findAllByProps({ 'data-activity-row-surface': '1' })[1];
        await act(async () => { second.props.onClick(); });
        assert.equal(rt.activeRows[ledger.id], 'child-b');
        assert.deepEqual(visible(), ['child-a', 'child-b']);

        // The same ID can subsequently be selected as a parent by another master view.
        act(() => rt.setActiveRow(ledger.id, 'child-b'));
        assert.deepEqual(visible(), ['grandchild']);
        assert.equal(rt.activeRows[ledger.id], 'grandchild');
        const detail = () => textOf(view.root.findByProps({ 'data-pf-id': 'detail' }));
        assert.match(detail(), /选中=grandchild/);
        act(() => rt.setActiveRow(ledger.id, 'child-a'));
        assert.deepEqual(visible(), []);
        assert.equal(rt.activeRows[ledger.id], undefined);
        assert.doesNotMatch(detail(), /选中=\w/);
      } finally {
        act(() => view?.unmount());
        useProtoStore.setState({ navigationSource: null });
      }
    }));
}

test('Desktop review regressions: [P1 #3, P2 #2, P2 #3] PublishedViewer viewport host, CSS nearest-mode & motion=none selectors', () =>
  withDom(async () => {
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
  try {
    // 1. Verify CSS rules in src/index.css:
    //    - nearest-mode selector allows [data-pf-mode="light"] [data-pf-mode="dark"]
    //    - .pf-capsule-fill only animates when its own page/overlay has smooth/snappy, NOT via outer ancestor
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');
    assert.ok(
      css.includes('[data-pf-mode="light"] [data-pf-mode="dark"]'),
      'src/index.css must re-enable .pf-paper dark overrides when an inner [data-pf-mode="dark"] page sits inside an outer [data-pf-mode="light"] scope',
    );
    assert.ok(
      !css.includes(':is([data-motion="smooth"], [data-motion="snappy"]):not([data-capture-mode="1"]) :is(.pf-desktop-page'),
      'src/index.css must not let an outer [data-motion="smooth"] scope override an inner motion="none" page on .pf-capsule-fill',
    );

    // 2. Verify full PublishedViewer mounts dedicated non-scrolling [data-testid="published-viewport"] wrapper around scrolling <main>
    //    and PublishedPageView's inner ProtoCanvasThemeScope does NOT trap absolute overlays via `relative`
    const tallPageTsx = wrapDesktop(`<Page pfId="p-tall" title="长页弹框测试" surfaceBg="oled_carbon" motion="none">
  <SearchInput pfId="si-1" placeholder="搜索..." />
  <ProgressBoard pfId="pb-none" items={[{ label: '静态胶囊', value: 75 }]} />
  <Button pfId="btn-modal" type="primary" onClick={() => openModal('mdl-tall')}>打开弹框</Button>
  <Modal pfId="mdl-node" id="mdl-tall" title="视口居中弹框">
    <Text pfId="txt-m">弹框正文</Text>
  </Modal>
</Page>`);

    const shareId = 'PUBVIEWPORTMODALTEST0123456789';
    const snapshot = {
      formatVersion: 3 as const,
      projectId: 'proj-pub',
      title: '发布视口验证',
      entryPageId: 'p-tall',
      sitemap: [
        {
          id: 'f1',
          title: '默认',
          type: 'folder' as const,
          deprecated: false,
          children: [{ id: 'i1', title: '长页', type: 'page' as const, deprecated: false, pageId: 'p-tall' }],
        },
      ],
      pages: [{ pageId: 'p-tall', title: '长页弹框测试', folderId: 'f1', doc: parsePageSource(tallPageTsx).doc! }],
      tables: DESKTOP_TEST_TABLES,
      tableRows: { t_orders: [], t_ledger: [], t_metrics: [] },
      stickyNotes: [],
    };
    const publication = { id: shareId, projectId: 'proj-pub', title: '发布视口验证', version: 1, passwordProtected: false };
    const location = { pathname: `/p/${shareId}`, hash: '#p-tall', search: '', href: `http://localhost/p/${shareId}#p-tall`, origin: 'http://localhost' };
    globalThis.window = {
      ...originalWindow,
      document: globalThis.document,
      innerWidth: 1280,
      location,
      history: { replaceState() {}, pushState() {} },
      addEventListener() {},
      removeEventListener() {},
    } as any;
    globalThis.fetch = (async (url: string) => ({
      ok: true,
      json: async () => (String(url).endsWith('/open') ? { publication, snapshot } : publication),
    })) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(PublishedViewer));
    });

    const viewportDiv = renderer.root.findByProps({ 'data-testid': 'published-viewport' });
    assert.match(String(viewportDiv.props.className), /\brelative\b/);
    assert.match(String(viewportDiv.props.className), /\boverflow-hidden\b/);

    // Inner page ProtoCanvasThemeScope must NOT have `relative` className that stretches to full page scrollHeight
    const scopes = renderer.root.findAll(
      (el) => el.type === 'div' && el.props['data-pf-theme-scope'] === '1',
    );
    const innerScope = scopes.find((s) => s.props['data-surface-bg'] === 'oled_carbon')!;
    assert.ok(innerScope);
    assert.doesNotMatch(String(innerScope.props.className), /\brelative\b/);

    // Open modal in fallback test environment -> uses `fixed inset-0 flex` and stamps data-motion="none"
    const openBtn = renderer.root.findAllByType('button').find((b) => textOf(b).includes('打开弹框'))!;
    await act(async () => {
      openBtn.props.onClick({ stopPropagation() {} });
    });
    const modalWrapper = renderer.root.find(
      (el) => el.type === 'div' && el.props['data-overlay-kind'] === 'modal',
    );
    assert.equal(modalWrapper.props['data-motion'], 'none');
    assert.match(String(modalWrapper.props.className), /\bfixed\b/);

    act(() => renderer.unmount());
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
  }));

test('unlockProjectAppearanceToFollowTheme strips hardcoded light/dark locks on standard pages while preserving oled_carbon wallboards', () =>
  withDom(async () => {
    useProtoStore.getState().setDesignTokens({
      preset: 'enterprise_compact',
      density: 'spacious',
      colorMode: 'light',
    });
    usePageStore.setState({
      pageSources: {
        p_regular: wrapDesktop('<Page pfId="p1" title="常规采购申请" appearance="light" surfaceBg="mist" accent="obsidian"><Card pfId="c1" title="主表" /></Page>'),
        p_mobile: 'export default function Page() {\n  return (<MobilePage pfId="mp1" title="移动审批" appearance="light" surfaceBg="mist" accent="obsidian"><MTopBar pfId="mt1" title="审批" /></MobilePage>);\n}\n',
        p_wallboard: wrapDesktop('<Page pfId="p2" title="指挥大屏" appearance="dark" surfaceBg="oled_carbon" accent="emerald"><Card pfId="c2" title="态势" /></Page>'),
      },
    });

    assert.equal(countPinnedAppearancePages(usePageStore.getState().pageSources), 2);

    const res = unlockProjectAppearanceToFollowTheme();
    assert.equal(res.clearedTokenColorMode, true);
    assert.deepEqual(res.updatedPageIds.sort(), ['p_mobile', 'p_regular']);
    assert.equal(useProtoStore.getState().designTokens?.colorMode, undefined);
    assert.equal(useProtoStore.getState().designTokens?.preset, 'enterprise_compact');
    assert.equal(countPinnedAppearancePages(usePageStore.getState().pageSources), 0);

    const regularDoc = parsePageSource(usePageStore.getState().pageSources.p_regular).doc!;
    assert.equal(regularDoc.root.props.appearance, undefined);
    assert.equal(regularDoc.root.props.surfaceBg, 'mist');
    assert.equal(regularDoc.root.props.accent, 'obsidian');

    // Dedicated OLED wallboards keep their explicit dark surface intact
    const wallboardDoc = parsePageSource(usePageStore.getState().pageSources.p_wallboard).doc!;
    assert.equal(wallboardDoc.root.props.appearance, 'dark');
    assert.equal(wallboardDoc.root.props.surfaceBg, 'oled_carbon');

    // Now toggling document.documentElement.dataset.theme switches standard pages cleanly between light and dark
    document.documentElement.dataset.theme = 'dark';
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          ProtoCanvasThemeScope,
          {
            tokens: useProtoStore.getState().designTokens,
            pageAppearance: regularDoc.root.props.appearance,
            surfaceBg: regularDoc.root.props.surfaceBg,
            accent: regularDoc.root.props.accent,
          },
          React.createElement('span', { 'data-probe': 'ok' }),
        ),
      );
    });
    const scopeEl = renderer.root.find((el) => el.type === 'div' && el.props['data-pf-theme-scope'] === '1');
    assert.equal(scopeEl.props['data-pf-mode'], 'dark');
    act(() => renderer.unmount());
    document.documentElement.dataset.theme = 'light';
  }));
