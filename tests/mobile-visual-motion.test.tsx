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
import { MobileOverlayStack, MobileViewportShell } from '../src/proto/mobile/MobileViewportShell';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import {
  resolveMobileAppearance,
  SplitMetricText,
} from '../src/proto/mobile/components';
import { MOBILE_COMPONENTS } from '../src/proto/mobile/meta';
import { localizeComponentMeta } from '../src/proto/registry/localizeMeta';
import { CaptureMode } from '../src/capture/CaptureMode';
import { validatePublishedSnapshot } from '../src/services/publishedSnapshot';
import { PublishedPageView } from '../src/viewer/PublishedViewer';
import { installTestDom } from './dom';
import { MOBILE_TEST_TABLES, interactionSource, interactionRows } from './fixtures/mobile-list-interactions';

const wrapMobile = (inner: string) => `export default function Page() {\n  return (\n    ${inner}\n  );\n}\n`;

const textOf = (inst: TestRenderer.ReactTestInstance | string): string =>
  typeof inst === 'string'
    ? inst
    : inst.children.map((c) => textOf(c as TestRenderer.ReactTestInstance | string)).join('');

function LiveMobileShellHost({
  pageId,
  source,
  capture = false,
  isDesign = false,
  canNavigate,
  onRuntime,
}: {
  pageId: string;
  source: string;
  capture?: boolean;
  isDesign?: boolean;
  canNavigate?: (id: string) => boolean;
  onRuntime?: (rt: Runtime) => void;
}) {
  const doc = React.useMemo(() => parsePageSource(source).doc!, [source]);
  const rt = useRuntimeController(doc, pageId, isDesign, canNavigate);
  onRuntime?.(rt);
  const shell = React.createElement(
    RuntimeProvider,
    { value: rt },
    React.createElement(
      MobileViewportShell,
      {
        appearance: doc.root.props.appearance,
        accent: doc.root.props.accent,
        surfaceBg: doc.root.props.surfaceBg,
        motion: doc.root.props.motion,
        runtimeFeedback: {
          toasts: rt.toasts,
          confirmState: rt.confirmState,
          onResolveConfirm: rt.resolveConfirm,
        },
        overlaySlot: React.createElement(MobileOverlayStack, {
          overlays: rt.overlays,
          resolveNode: (id) => {
            const found = doc.root.children.find(
              (c) => c.kind === 'node' && (c.props.id === id || c.pfId === id),
            );
            return found && found.kind === 'node' ? found : undefined;
          },
        }),
      },
      React.createElement(NodeView, { node: doc.root }),
    ),
  );
  return capture
    ? React.createElement(CaptureMode.Provider, { value: true }, shell)
    : shell;
}

const DESIGNER_MOBILE_TSX = wrapMobile(`<MobilePage pfId="mp-root" title="星链移动工作台" surfaceBg="sage_field" accent="lime_forest" motion="smooth">
  <MTopBar pfId="m-top" title="星链维保现场" leftMode="sparkle" rightIcon="bell" />
  <MHeroHeader
    pfId="m-hero-wallet"
    mode="wallet"
    eyebrow="备件授信额度"
    title="华东战区可用备件金"
    value="$24,680.00"
    accountMask="**** 3287"
    statusBadge="+12.4%"
    actionText="快捷申领"
    secondaryActionText="退库核销"
    onAction={() => toast("打开申领")}
    onSecondaryAction={() => toast("打开核销")}
  />
  <MHeroHeader
    pfId="m-hero-metric"
    mode="metric_hero"
    eyebrow="今日 SLA 达成"
    title="整体抢修准时闭环率"
    value="86.5%"
    accountMask="战区排名 #1"
    statusBadge="计划 85% · +1.5%"
  />
  <MAiInsightCard
    pfId="m-brief"
    tone="dark_brief"
    badge="今日简报"
    timestamp="08:14 更新"
    title="2 座海岛基站备件库存低于安全线"
    summary="建议优先从舟山前置仓调拨 Ku 波段相控阵组件。"
    primaryActionLabel="查看调拨建议"
    onPrimaryAction={() => toast("已定位调拨单")}
  />
  <MSurface pfId="m-inv-surface" tone="inverted" title="核心健康度" extra="更多" onExtraClick={() => toast("更多指标")}>
    <MStatCard pfId="m-stat-inv" tone="inverted" title="本月备件周转额" value="¥128,450.90" trend="+18.2%" trendTone="up" />
  </MSurface>
  <MProgressList
    pfId="m-prog-gauge"
    title="分项达成率"
    extra="全部"
    variant="capsule"
    table="t_milestones"
    labelField="milestone_name"
    valueField="progress_pct"
    targetField="target_pct"
    statusField="health_status"
  />
  <MActivityList
    pfId="m-ledger"
    title="近期备件出入库流水"
    extra="筛选"
    table="t_ledger"
    titleField="item_title"
    subtitleField="biz_time"
    amountField="delta_amount"
    typeField="direction"
    autoSelectFirst={true}
    onItemClick={() => openDrawer("sheet-ledger-detail")}
    rowActions={[
      { label: "撤销流水", danger: true, onClick: () => deleteRow("undo") }
    ]}
  />
  <MFloatingBar
    pfId="m-float"
    tone="inverted"
    icon="Zap"
    title="紧急工单履约中 · WO-202611-01"
    subtitle="距 SLA 承诺节点剩余 42m"
    badge="LIVE"
    progress={72}
    actionText="领料"
    onAction={() => toast("快捷领料")}
  />
  <MTabBar
    pfId="m-tabs"
    variant="floating"
    activeKey="home"
    avatarText="林"
    onAvatarClick={() => toast("个人中心")}
    items={[
      { key: "home", title: "现场", icon: "Sparkles" },
      { key: "ledger", title: "流水", icon: "Wallet", badge: "2" },
      { key: "kanban", title: "工单", icon: "Layers" }
    ]}
  />
  <MBottomSheet pfId="m-sheet" id="sheet-ledger-detail" title="关联核销记录" size="medium">
    <MActivityList
      pfId="m-sub-ledger"
      title="核销子明细"
      table="t_sub_logs"
      sourceForeignKey="ledger_id"
      titleField="log_title"
      amountField="qty_text"
    />
  </MBottomSheet>
</MobilePage>`);

function buildSnapshotForDoc(doc: ReturnType<typeof parsePageSource>['doc']) {
  return {
    formatVersion: 5 as const,
    projectId: 'proj_mobile_visual',
    title: 'Mobile Visual Test',
    entryPageId: 'm_home',
    designTokens: { preset: 'modern_minimal' as const },
    sitemap: [
      {
        id: 'f_mobile',
        title: '移动端',
        type: 'folder' as const,
        deprecated: false,
        children: [
          {
            id: 'menu_m_home',
            title: '星链移动工作台',
            type: 'page' as const,
            deprecated: false,
            pageId: 'm_home',
          },
        ],
      },
    ],
    pages: [
      {
        pageId: 'm_home',
        title: '星链移动工作台',
        folderId: 'f_mobile',
        doc: doc!,
      },
    ],
    tables: MOBILE_TEST_TABLES,
    tableRows: {
      t_milestones: [
        { id: 'ms-1', milestone_name: '基站结构巡检', progress_pct: 88, target_pct: 90, health_status: '正常' },
      ],
      t_ledger: [
        { id: 'lg-1', item_title: '光模块退库', biz_time: '14:20', unit_price: 91, delta_amount: '+$1,280.00', direction: '入库' },
      ],
      t_sub_logs: [
        { id: 'sl-1', ledger_id: 'lg-1', log_title: '仓管扫码复核', qty_text: '+2 件' },
      ],
    },
    stickyNotes: [],
  };
}

test('Mobile visual & motion upgrade: contracts, AST round-trip, and shared staging/publish validation pass cleanly', () => {
  assert.deepEqual(validateMaterialSource(DESIGNER_MOBILE_TSX), []);
  assert.deepEqual(pageContractErrors(DESIGNER_MOBILE_TSX, MOBILE_TEST_TABLES), []);

  const parsed = parsePageSource(DESIGNER_MOBILE_TSX, { strict: true });
  assert.ok(parsed.doc);
  const printed = printPageSource(parsed.doc!);
  assert.deepEqual(validateMaterialSource(printed), []);
  assert.deepEqual(pageContractErrors(printed, MOBILE_TEST_TABLES), []);

  const snapshot = buildSnapshotForDoc(parsed.doc);
  validatePublishedSnapshot(snapshot);
  assert.equal(snapshot.pages[0].doc.root.props.surfaceBg, 'sage_field');

  // [P1 #2] Shared validation rejects misspelled guard fields, non-FK sourceForeignKey, and missing numeric columns in BOTH staging & publish
  const badCases = [
    DESIGNER_MOBILE_TSX.replace(
      '{ label: "撤销流水", danger: true, onClick: () => deleteRow("undo") }',
      '{ label: "撤销流水", danger: true, disabledWhenField: "sttae", disabledWhenValue: "领用", onClick: () => deleteRow("undo") }',
    ),
    DESIGNER_MOBILE_TSX.replace('sourceForeignKey="ledger_id"', 'sourceForeignKey="log_title"'),
    DESIGNER_MOBILE_TSX.replace('amountField="delta_amount"', ''),
    DESIGNER_MOBILE_TSX.replace('valueField="progress_pct"', ''),
    DESIGNER_MOBILE_TSX.replace('valueField="progress_pct"', 'valueField="missing_col"'),
  ];

  for (const badTsx of badCases) {
    const stagingErrs = pageContractErrors(badTsx, MOBILE_TEST_TABLES);
    assert.ok(stagingErrs.length > 0, `Expected pageContractErrors to reject: ${badTsx.slice(0, 120)}`);
    const badDoc = parsePageSource(badTsx).doc!;
    assert.throws(
      () => validatePublishedSnapshot(buildSnapshotForDoc(badDoc)),
      /未通过发布检查/,
    );
  }
});

test('Mobile visual & motion upgrade: [P1 #1] static MActivityList inside parent-row drawer isolates scope & blocks parent mutations', async () => {
  const staticInDrawerTsx = wrapMobile(`<MobilePage pfId="mp-static-guard" title="单据工作台">
  <MActivityList
    pfId="parent-ledger"
    table="t_ledger"
    titleField="item_title"
    amountField="delta_amount"
    onItemClick={() => openDrawer("sheet-parent")}
  />
  <MBottomSheet pfId="sheet-p" id="sheet-parent" title="单据详情">
    <MActivityList
      pfId="static-inner"
      title="静态示例流水"
      items={[
        { title: "静态记录A", amount: "-$12.00", tone: "outflow" }
      ]}
      rowActions={[
        { label: "误绑删除", danger: true, disabledWhenField: "direction", disabledWhenValue: "入库", onClick: () => deleteRow("undo") }
      ]}
    />
  </MBottomSheet>
</MobilePage>`);

  // 1. Contract gate rejects both unbound deleteRow AND unknown static guard field
  const errs = pageContractErrors(staticInDrawerTsx, MOBILE_TEST_TABLES);
  assert.ok(errs.some((e) => e.includes('deleteRow 缺少当前行数据上下文')));
  assert.ok(errs.some((e) => e.includes('direction')));

  // 2. Runtime defense-in-depth: even if static list omits invalid guard field, button is disabled and parent row is untouched
  const runtimeSafeGuardTsx = staticInDrawerTsx.replace(
    'disabledWhenField: "direction", disabledWhenValue: "入库", ',
    '',
  );
  assert.ok(pageContractErrors(runtimeSafeGuardTsx, MOBILE_TEST_TABLES).some((e) => e.includes('deleteRow')));

  const cleanupDom = installTestDom();
  try {
    useProtoStore.setState({ dbTables: MOBILE_TEST_TABLES, uiState: 'normal' });
    usePageStore.setState({
      tableRows: {
        t_milestones: [],
        t_ledger: [
          { id: 'lg-parent', item_title: '已关闭父单据', biz_time: '09:00', unit_price: 91, delta_amount: '-$50.00', direction: '入库' },
        ],
        t_sub_logs: [],
      },
    });

    let liveRt!: Runtime;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(LiveMobileShellHost, {
          pageId: 'm_guard',
          source: runtimeSafeGuardTsx,
          onRuntime: (r) => {
            liveRt = r;
          },
        }),
      );
    });

    // Open drawer from parent row lg-parent
    const parentRow = renderer.root.find((n) => n.type === 'div' && n.props?.['data-row-id'] === 'lg-parent');
    const parentSurface = parentRow.find((n) => n.props?.['data-activity-row-surface'] === '1');
    await act(async () => {
      parentSurface.props.onClick();
    });
    assert.equal(liveRt.overlays.length, 1);

    // Static item inside drawer has disabled delete button and cannot delete lg-parent
    const staticDeleteBtn = renderer.root.find(
      (n) => n.type === 'button' && textOf(n).includes('误绑删除'),
    );
    assert.equal(staticDeleteBtn.props.disabled, true);
    await act(async () => {
      staticDeleteBtn.props.onClick({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_ledger.length, 1);
    assert.equal(usePageStore.getState().tableRows.t_ledger[0].id, 'lg-parent');
    renderer.unmount();
  } finally {
    cleanupDom();
  }
});

test('Mobile visual & motion upgrade: [P1 #3 & #4, P2 #4] missing/invalid/zero values, empty bindings, and gauge 3rd+ item click', async () => {
  const cleanupDom = installTestDom();
  try {
    const strictValuesTsx = wrapMobile(`<MobilePage pfId="mp-strict" title="数值严谨性校验">
  <MSurface pfId="surf-active" activeTable="t_ledger" title="详情">
    <MHeroHeader pfId="hero-empty-wallet" mode="wallet" title="缺失余额测试" value="{{row.nonexistent_balance}}" />
    <MHeroHeader pfId="hero-empty-metric" mode="metric_hero" title="缺失达成率测试" value="" />
  </MSurface>
  <MActivityList pfId="act-empty-static" title="显式空静态流水" items={[]} />
  <MProgressList pfId="prog-empty-static" title="显式空静态进度" items={[]} />
  <MActivityList
    pfId="act-bound-strict"
    table="t_ledger"
    titleField="item_title"
    amountField="delta_amount"
    typeField="direction"
    autoSelectFirst={true}
  />
  <MProgressList
    pfId="prog-bound-gauge"
    variant="gauge"
    table="t_milestones"
    labelField="milestone_name"
    valueField="progress_pct"
    targetField="target_pct"
    onItemClick={() => selectRow()}
  />
  <MProgressList
    pfId="prog-static-gauge-3"
    variant="gauge"
    items={[
      { label: "仪表一", value: 90 },
      { label: "仪表二", value: 80 },
      { label: "静态第三项", value: 70, onClick: () => toast("点击静态第三项") }
    ]}
  />
</MobilePage>`);

    useProtoStore.setState({ dbTables: MOBILE_TEST_TABLES, uiState: 'normal' });
    usePageStore.setState({
      tableRows: {
        t_ledger: [
          // unit_price is 91, delta_amount is empty -> must NOT display 91!
          { id: 'lg-empty-amt', item_title: '待核价调拨单', biz_time: '10:00', unit_price: 91, delta_amount: '', direction: '领用' },
          { id: 'lg-zero-amt', item_title: '平账冲销单', biz_time: '11:00', unit_price: 91, delta_amount: '0.00', direction: '入库' },
        ],
        t_milestones: [
          { id: 'ms-zero', milestone_name: '真实零进度项', progress_pct: 0, target_pct: 80, health_status: '风险' },
          { id: 'ms-null', milestone_name: '空值进度项', progress_pct: null, target_pct: 80, health_status: '风险' },
          { id: 'ms-third', milestone_name: '第三项进度条', progress_pct: 75, target_pct: 90, health_status: '正常' },
          { id: 'ms-invalid', milestone_name: '非法文本项', progress_pct: 'TBD' as unknown as number, target_pct: 90, health_status: '风险' },
        ],
        t_sub_logs: [],
      },
    });

    let liveRt!: Runtime;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(LiveMobileShellHost, {
          pageId: 'm_strict',
          source: strictValuesTsx,
          onRuntime: (r) => {
            liveRt = r;
          },
        }),
      );
    });

    const fullText = textOf(renderer.root);
    // Must never display fake $24,680.00, 68.4%, demo transactions, or unconfigured unit_price 91
    assert.ok(!fullText.includes('$24,680.00'), 'Wallet must not fallback to $24,680.00');
    assert.ok(!fullText.includes('68.4%'), 'Metric hero must not fallback to 68.4%');
    assert.ok(!fullText.includes('光模块备件退库入账'), 'Empty items=[] must not render demo items');
    assert.ok(!fullText.includes('91'), 'MActivityList must not display unconfigured unit_price 91');
    assert.ok(fullText.includes('暂无流水记录'));
    assert.ok(fullText.includes('暂无进度数据'));

    // Real 0% vs null ('—') vs invalid ('无效值')
    assert.ok(fullText.includes('0%'), 'Real numeric 0 must render 0%');
    assert.ok(fullText.includes('无效值'), 'Invalid string progress must render 无效值');
    const missingBadges = renderer.root.findAll((n) => n.props?.['data-missing-value'] === '1');
    assert.ok(missingBadges.length >= 4, 'Expected missing value placeholders for wallet, metric_hero, empty amount, and null progress');

    // [P2 #4] 3rd item in gauge mode (`slice(2)`) activates both bound onItemClick (with row context) and static item.onClick
    const thirdGaugeItem = renderer.root.find((n) => n.props?.['data-progress-item-id'] === 'ms-third');
    await act(async () => {
      thirdGaugeItem.props.onClick();
    });
    assert.equal(
      liveRt.activeRows.t_milestones,
      'ms-third',
      'Expected 3rd bound item in gauge mode to execute onItemClick with ms-third row context',
    );

    const staticThirdGauge = renderer.root.find((n) => n.props?.['data-progress-item-id'] === 'prog-2');
    await act(async () => {
      staticThirdGauge.props.onClick();
    });
    assert.ok(
      liveRt.toasts.some((t) => t.message === '点击静态第三项'),
      'Expected 3rd static item in gauge mode to execute its own item.onClick',
    );
    renderer.unmount();
  } finally {
    cleanupDom();
  }
});

test('Mobile visual & motion upgrade: real touch swipe gesture, keyboard Enter isolation, FK cascade delete & 5s Undo restore, and CaptureMode settle', async () => {
  const cleanupDom = installTestDom();
  try {
    useProtoStore.setState({
      dbTables: MOBILE_TEST_TABLES,
      uiState: 'normal',
    });
    usePageStore.setState({
      tableRows: {
        t_milestones: [
          { id: 'ms-1', milestone_name: '基站结构巡检', progress_pct: 88, target_pct: 90, health_status: '正常' },
          { id: 'ms-2', milestone_name: '高优备件齐套', progress_pct: 62, target_pct: 85, health_status: '风险' },
        ],
        t_ledger: [
          { id: 'lg-1', item_title: '光模块备件退库', biz_time: '今天 14:20', unit_price: 50, delta_amount: '+$1,280.00', direction: '入库' },
          { id: 'lg-2', item_title: '相控阵天线领用', biz_time: '今天 10:05', unit_price: 91, delta_amount: '-$340.50', direction: '领用' },
        ],
        t_sub_logs: [
          { id: 'sl-1', ledger_id: 'lg-1', log_title: '舟山中心仓复核入账', qty_text: '+2 件' },
          { id: 'sl-2', ledger_id: 'lg-2', log_title: '东极岛基站现场签收', qty_text: '-1 套' },
        ],
      },
    });

    let liveRt!: Runtime;
    let interactiveRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      interactiveRenderer = TestRenderer.create(
        React.createElement(LiveMobileShellHost, {
          pageId: 'm_home',
          source: DESIGNER_MOBILE_TSX,
          capture: false,
          onRuntime: (r) => {
            liveRt = r;
          },
        }),
      );
    });

    // 1. Stagger wrappers active in interactive smooth mode
    const mobileRoot = interactiveRenderer.root.find(
      (n) => n.type === 'div' && n.props?.['data-surface-bg'] === 'sage_field' && n.props?.className?.includes('pf-mobile-page'),
    );
    assert.equal(mobileRoot.props['data-motion'], 'smooth');
    const staggerItems = interactiveRenderer.root.findAll(
      (n) => n.type === 'div' && typeof n.props?.className === 'string' && n.props.className.includes('pf-mobile-stagger-item'),
    );
    assert.ok(staggerItems.length >= 6);

    // 2. [P2 #1] Collapsed swipe action tray is aria-hidden + inert + tabIndex=-1, and keyboard Enter on MoreHorizontal does NOT trigger row click
    const getRow2 = () =>
      interactiveRenderer.root.find((n) => n.type === 'div' && n.props?.['data-row-id'] === 'lg-2');
    const closedTray = getRow2().find((n) => n.props?.['data-swipe-actions'] === '1');
    assert.equal(closedTray.props['aria-hidden'], 'true');
    assert.equal(closedTray.props.inert, '');
    const closedBtn = closedTray.findByType('button');
    assert.equal(closedBtn.props.tabIndex, -1);

    // Simulate Enter bubbling from MoreHorizontal button to row surface: target !== currentTarget -> must NOT open sheet-ledger-detail!
    const row2Surface = getRow2().find((n) => n.props?.['data-activity-row-surface'] === '1');
    const moreBtn = getRow2().find((n) => n.type === 'button' && n.props?.['aria-expanded'] !== undefined);
    await act(async () => {
      row2Surface.props.onKeyDown({
        key: 'Enter',
        target: { tagName: 'BUTTON' },
        currentTarget: { tagName: 'DIV' },
        preventDefault: () => {},
      });
    });
    assert.equal(liveRt.overlays.length, 0, 'Enter on child button must not bubble to row activation');
    assert.equal(moreBtn.props['aria-expanded'], false);

    // 3. Execute real touch swipe-left gesture on lg-2 (dx = 150 - 260 = -110 < -32)
    await act(async () => {
      row2Surface.props.onTouchStart({ touches: [{ clientX: 260 }] });
    });
    await act(async () => {
      row2Surface.props.onTouchEnd({ changedTouches: [{ clientX: 150 }] });
    });

    assert.equal(getRow2().props['data-swiped'], '1');
    const openedMoreBtn = getRow2().find((n) => n.type === 'button' && n.props?.['aria-expanded'] !== undefined);
    assert.equal(openedMoreBtn.props['aria-expanded'], true);
    const openTray = getRow2().find((n) => n.props?.['data-swipe-actions'] === '1');
    assert.equal(openTray.props['aria-hidden'], undefined);
    const openDeleteBtn = openTray.findByType('button');
    assert.equal(openDeleteBtn.props.tabIndex, 0);

    // 4. Click revealed swipe delete button -> deletes lg-2 AND cascades to sl-2, then 5s Undo restores BOTH atomically
    await act(async () => {
      openDeleteBtn.props.onClick({ stopPropagation: () => {} });
    });
    assert.deepEqual(
      usePageStore.getState().tableRows.t_ledger.map((r) => r.id),
      ['lg-1'],
    );
    assert.deepEqual(
      usePageStore.getState().tableRows.t_sub_logs.map((r) => r.id),
      ['sl-1'],
      'Expected ON DELETE CASCADE to remove sl-2',
    );

    const undoToast = liveRt.toasts.find((t) => Boolean(t.undoAction));
    assert.ok(undoToast?.undoAction, 'Expected 5s Undo toast');
    await act(async () => {
      undoToast!.undoAction!.onUndo();
    });
    assert.deepEqual(
      usePageStore.getState().tableRows.t_ledger.map((r) => r.id),
      ['lg-1', 'lg-2'],
      'Expected Undo to restore lg-2',
    );
    assert.deepEqual(
      usePageStore.getState().tableRows.t_sub_logs.map((r) => r.id),
      ['sl-1', 'sl-2'],
      'Expected Undo to atomically restore cascaded child sl-2',
    );

    // 5. Click lg-1 row to open MBottomSheet and verify sourceForeignKey isolation
    const ledgerRow1 = interactiveRenderer.root.find(
      (n) => n.type === 'div' && n.props?.['data-row-id'] === 'lg-1',
    );
    const surface1 = ledgerRow1.find((n) => n.props?.['data-activity-row-surface'] === '1');
    await act(async () => {
      surface1.props.onClick();
    });
    const treeText = textOf(interactiveRenderer.root);
    assert.ok(treeText.includes('舟山中心仓复核入账'));
    assert.ok(!treeText.includes('东极岛基站现场签收'));

    interactiveRenderer.unmount();

    // 6. CaptureMode bypasses stagger wrappers instantaneously
    let captureRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      captureRenderer = TestRenderer.create(
        React.createElement(LiveMobileShellHost, {
          pageId: 'm_home',
          source: DESIGNER_MOBILE_TSX,
          capture: true,
        }),
      );
    });
    const captureShell = captureRenderer.root.find(
      (n) => n.type === 'div' && n.props?.['data-capture-mode'] === '1',
    );
    assert.ok(captureShell);
    const captureStaggerItems = captureRenderer.root.findAll(
      (n) => n.type === 'div' && typeof n.props?.className === 'string' && n.props.className.includes('pf-mobile-stagger-item'),
    );
    assert.equal(captureStaggerItems.length, 0);
    captureRenderer.unmount();
  } finally {
    cleanupDom();
  }
});

test('Mobile visual & motion upgrade: [P1 #5, P2 #2, #3, #5] confirm->navigate ViewTransition non-blocking, overlay exit retention, motion=none, and auto-dark toggle', async () => {
  const cleanupDom = installTestDom();
  const origStartVT = (document as unknown as Record<string, unknown>).startViewTransition;
  const origGetAnimations = Element.prototype.getAnimations;
  try {
    // 1. [P1 #5] confirm -> navigate runs confirm OUTSIDE startViewTransition and only transitions final synchronous commit
    let vtCalls = 0;
    let vtCallbackRunning = false;
    (document as unknown as Record<string, unknown>).startViewTransition = (cb: () => void) => {
      vtCalls += 1;
      vtCallbackRunning = true;
      cb();
      vtCallbackRunning = false;
      return { finished: Promise.resolve() };
    };

    const navPageTsx = wrapMobile(`<MobilePage pfId="mp-nav" title="导航页" surfaceBg="oled_carbon" appearance="auto" motion="smooth">
  <MTabBar
    pfId="tabs-confirm"
    variant="floating"
    activeKey="home"
    items={[
      { key: "home", title: "首页", icon: "Home" },
      { key: "target", title: "跳转页", icon: "Layers", onClick: () => { confirm("确认切换页面？"); navigate("m_target"); } }
    ]}
  />
  <MBottomSheet pfId="sh-1" id="sheet-anim" title="动效抽屉">
    <MListItem pfId="li-1" title="抽屉内容" />
  </MBottomSheet>
</MobilePage>`);

    useProtoStore.setState({
      dbTables: MOBILE_TEST_TABLES,
      activePageId: 'm_nav',
      uiState: 'normal',
    });

    let liveRt!: Runtime;
    let navRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      navRenderer = TestRenderer.create(
        React.createElement(LiveMobileShellHost, {
          pageId: 'm_nav',
          source: navPageTsx,
          canNavigate: (id) => id === 'm_nav' || id === 'm_target',
          onRuntime: (r) => {
            liveRt = r;
          },
        }),
      );
    });

    const targetTabBtn = navRenderer.root.find(
      (n) => n.type === 'button' && textOf(n).includes('跳转页'),
    );
    await act(async () => {
      targetTabBtn.props.onClick();
    });

    // While awaiting user confirmation, startViewTransition MUST NOT have started!
    assert.ok(liveRt.confirmState, 'Expected confirm dialog open');
    assert.equal(vtCalls, 0, 'startViewTransition must not wrap pending confirm Promise');
    assert.equal(vtCallbackRunning, false);

    // Clicking Confirm resolves confirm first, then executes synchronous startViewTransition for navigate
    await act(async () => {
      liveRt.resolveConfirm(true);
    });
    assert.equal(vtCalls, 1);
    assert.equal(useProtoStore.getState().activePageId, 'm_target');

    // 2. [P2 #2] MobileOverlayStack retains closing MBottomSheet with data-closing="" until animations finish
    let resolveAnim!: () => void;
    const animPromise = new Promise<void>((r) => {
      resolveAnim = r;
    });
    Element.prototype.getAnimations = () => [{ finished: animPromise } as unknown as Animation];

    navRenderer.unmount();
    await act(async () => {
      navRenderer = TestRenderer.create(
        React.createElement(LiveMobileShellHost, {
          pageId: 'm_nav',
          source: navPageTsx,
          canNavigate: (id) => id === 'm_nav' || id === 'm_target',
          onRuntime: (r) => {
            liveRt = r;
          },
        }),
        {
          createNodeMock: (element) =>
            typeof element.props?.className === 'string' &&
            element.props.className.includes('pf-sheet-panel')
              ? { getAnimations: () => [{ finished: animPromise }] }
              : null,
        },
      );
    });

    await act(async () => {
      liveRt.openOverlay('sheet-anim');
    });
    assert.equal(liveRt.overlays.length, 1);
    assert.ok(
      navRenderer.root.findAll((n) => typeof n.props?.className === 'string' && n.props.className.includes('pf-sheet-panel')).length === 1,
    );

    await act(async () => {
      liveRt.closeOverlay();
    });
    assert.equal(liveRt.overlays.length, 0);
    const closingPanels = navRenderer.root.findAll(
      (n) => typeof n.props?.className === 'string' && n.props.className.includes('pf-sheet-panel'),
    );
    assert.equal(closingPanels.length, 1, 'Expected sheet panel retained in DOM while closing');
    assert.equal(closingPanels[0].props['data-closing'], '');

    await act(async () => {
      resolveAnim();
      await new Promise((r) => setTimeout(r, 20));
    });
    const afterFinishPanels = navRenderer.root.findAll(
      (n) => typeof n.props?.className === 'string' && n.props.className.includes('pf-sheet-panel'),
    );
    assert.equal(afterFinishPanels.length, 0, 'Expected sheet panel unmounted after exit animation settled');
    navRenderer.unmount();

    // 3. [P2 #3] motion="none" propagates to MobileViewportShell & overlaySlot and unmounts immediately without waiting
    const motionNoneTsx = navPageTsx.replace('motion="smooth"', 'motion="none"');
    let noneRt!: Runtime;
    let noneRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      noneRenderer = TestRenderer.create(
        React.createElement(LiveMobileShellHost, {
          pageId: 'm_nav',
          source: motionNoneTsx,
          onRuntime: (r) => {
            noneRt = r;
          },
        }),
      );
    });
    const shellScopes = noneRenderer.root.findAll((n) => n.props?.['data-motion'] === 'none');
    assert.ok(shellScopes.length >= 2, 'Expected both viewport shell and mobile page to carry data-motion="none"');

    await act(async () => {
      noneRt.openOverlay('sheet-anim');
    });
    const sheetDialog = noneRenderer.root.find((n) => n.props?.role === 'dialog');
    assert.equal(sheetDialog.props['data-motion'], 'none');

    await act(async () => {
      noneRt.closeOverlay();
    });
    assert.equal(
      noneRenderer.root.findAll((n) => typeof n.props?.className === 'string' && n.props.className.includes('pf-sheet-panel')).length,
      0,
      'Expected immediate unmount on closeOverlay when motion="none"',
    );
    noneRenderer.unmount();

    // 4. [P2 #5] PublishedPageView with appearance="auto" + surfaceBg="oled_carbon" in light workspace switches to light on FIRST click
    const oledDoc = parsePageSource(navPageTsx).doc!;
    let viewerRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      viewerRenderer = TestRenderer.create(
        React.createElement(PublishedPageView, {
          page: {
            pageId: 'm_oled',
            title: 'OLED Carbon Page',
            folderId: 'f_mobile',
            doc: oledDoc,
          },
          canNavigate: () => true,
        }),
      );
    });
    const toggleBtn = viewerRenderer.root.find(
      (n) => n.type === 'button' && typeof n.props?.title === 'string' && /明暗预览|light\/dark/i.test(n.props.title),
    );
    assert.ok(/深色|Dark/.test(textOf(toggleBtn)), 'Expected toggle button to initially reflect auto-dark state');
    assert.ok(viewerRenderer.root.findAll((n) => n.props?.['data-mobile-appearance'] === 'dark').length >= 2);

    // First click immediately flips appearance to light!
    await act(async () => {
      toggleBtn.props.onClick();
    });
    assert.ok(viewerRenderer.root.findAll((n) => n.props?.['data-mobile-appearance'] === 'light').length >= 2);
    viewerRenderer.unmount();
  } finally {
    if (origStartVT === undefined) {
      delete (document as unknown as Record<string, unknown>).startViewTransition;
    } else {
      (document as unknown as Record<string, unknown>).startViewTransition = origStartVT;
    }
    Element.prototype.getAnimations = origGetAnimations;
    cleanupDom();
  }
});

test('Mobile visual & motion upgrade: designer dark surfaces resolve appearance, SplitMetricText splits decimals & English localization is CJK-free', () => {
  assert.equal(resolveMobileAppearance('auto', 'light', null, 'oled_carbon'), 'dark');
  assert.equal(resolveMobileAppearance('auto', 'light', null, 'ocean_glow'), 'dark');
  assert.equal(resolveMobileAppearance('auto', 'light', null, 'sage_field'), 'light');
  assert.equal(resolveMobileAppearance('auto', 'light', null, 'warm_paper'), 'light');
  assert.equal(resolveMobileAppearance('auto', 'light', 'light', 'oled_carbon'), 'light');
  assert.equal(resolveMobileAppearance('light', 'dark', null, 'oled_carbon'), 'light');

  let tr!: TestRenderer.ReactTestRenderer;
  act(() => {
    tr = TestRenderer.create(
      React.createElement(
        'div',
        null,
        React.createElement(SplitMetricText, { value: '$24,680.00' }),
        React.createElement(SplitMetricText, { value: '68.4%' }),
        React.createElement(SplitMetricText, { value: '$99.50', splitDecimal: false }),
      ),
    );
  });

  const decNodes = tr.root.findAll((n) => n.props?.['data-metric-decimal'] === '1');
  assert.equal(decNodes.length, 2);
  assert.deepEqual(
    decNodes.map((n) => n.children.join('')),
    ['.00', '.4'],
  );
  tr.unmount();

  const cjkRe = /[\u4e00-\u9fff]/;
  for (const name of ['MProgressList', 'MActivityList', 'MFloatingBar', 'MHeroHeader', 'MAiInsightCard', 'MTabBar', 'MStatCard']) {
    const meta = MOBILE_COMPONENTS.find((c) => c.name === name);
    assert.ok(meta, `Missing meta for ${name}`);
    const en = localizeComponentMeta(meta!, 'en-US');
    assert.ok(!cjkRe.test(en.title), `${name} en title contains CJK: ${en.title}`);
    assert.ok(!cjkRe.test(en.description), `${name} en description contains CJK: ${en.description}`);
    assert.ok(!cjkRe.test(en.snippet), `${name} en snippet contains CJK: ${en.snippet}`);
    for (const prop of en.props) {
      assert.ok(!cjkRe.test(prop.label), `${name}.${prop.name} en label contains CJK: ${prop.label}`);
    }
  }
});

for (const entry of ['static-activity', 'static-progress']) {
  test(`${entry} opens an independent create form and isolates nested FK details`, async () => {
    const cleanup = installTestDom();
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    const source = interactionSource
      .replace('motion="smooth"', 'motion="none"')
      .replace('autoSelectFirst={true}', `autoSelectFirst={${entry === 'static-activity'}}`);
    const seed = interactionRows();
    try {
      assert.deepEqual(pageContractErrors(source, MOBILE_TEST_TABLES), []);
      useProtoStore.setState({
        dbTables: MOBILE_TEST_TABLES, uiState: 'normal', activePageId: 'entry-test',
        navigationSource: entry === 'static-progress' ? { tableId: 't_ledger', rowId: 'parent' } : null,
      });
      usePageStore.setState({ tableRows: seed });
      let runtime!: Runtime;
      await act(async () => {
        renderer = TestRenderer.create(<LiveMobileShellHost pageId="entry-test" source={source} onRuntime={r => { runtime = r; }} />);
      });
      const host = (id: string) => renderer!.root.find(n => typeof n.type === 'string' && n.props['data-pf-id'] === id);
      const click = (n: TestRenderer.ReactTestInstance) => act(async () => { await n.props.onClick(); });
      await click(host('ledger').findByProps({ 'data-activity-row-surface': '1' }));
      assert.match(textOf(host('bound-details')), /Parent detail/);
      const trigger = host(entry).findByProps(entry === 'static-progress'
        ? { 'data-progress-item-id': 'prog-0' } : { 'data-activity-row-surface': '1' });
      await click(trigger);
      assert.match(textOf(host('create-details')), /No linked rows/);
      await click(host('more').findByType('button'));
      assert.match(textOf(host('nested-details')), /No linked rows/);
      const cancel = host('nested').findAllByType('button')[0].props.onClick;
      await act(async () => { await cancel(); });
      await act(async () => { await cancel(); });
      assert.deepEqual(runtime.overlays.map(o => o.id), ['parent-sheet', 'create']);
      await act(async () => { runtime.setFormValues('form', { item_title: 'Independent entry', biz_time: '10:00', direction: '入库' }); });
      await click(host('save').findByType('button'));
      const rows = usePageStore.getState().tableRows.t_ledger;
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.find(row => row.id === 'parent'), seed.t_ledger[0]);
      assert.equal(rows.find(row => row.id !== 'parent')?.item_title, 'Independent entry');
      assert.deepEqual(runtime.overlays.map(o => o.id), ['parent-sheet']);
    } finally {
      renderer?.unmount();
      cleanup();
    }
  });
}

test('activity icons and displayed signs agree for bound and static amounts', async () => {
  const cleanup = installTestDom();
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    const rows = interactionRows();
    rows.t_ledger = [
      { id: 'negative', item_title: 'Negative', biz_time: '09:00', delta_amount: '-13.00', direction: '入库' },
      { id: 'positive', item_title: 'Positive', biz_time: '09:00', delta_amount: '+13.00', direction: '领用' },
      { id: 'unsigned', item_title: 'Unsigned', biz_time: '09:00', delta_amount: '13.00', direction: '领用' },
      { id: 'zero', item_title: 'Zero', biz_time: '09:00', delta_amount: '-$0.00', direction: '入库' },
    ];
    useProtoStore.setState({ dbTables: MOBILE_TEST_TABLES, uiState: 'normal' });
    usePageStore.setState({ tableRows: rows });
    const source = wrapMobile(`<MobilePage pfId="page" motion="none">
      <MActivityList pfId="bound" table="t_ledger" amountField="delta_amount" typeField="direction" />
      <MActivityList pfId="static" items={[{title:"Reversal",amount:"-13.00",tone:"inflow"}]} />
    </MobilePage>`);
    await act(async () => { renderer = TestRenderer.create(<LiveMobileShellHost pageId="sign" source={source} />); });
    for (const [id, text, icon] of [
      ['negative', '-13.00', 'arrow-up-right'], ['positive', '+13.00', 'arrow-down-left'],
      ['unsigned', '-13.00', 'arrow-up-right'], ['zero', '$0.00', 'wallet'],
      ['act-0', '-13.00', 'arrow-up-right'],
    ]) {
      const row = renderer!.root.findByProps({ 'data-row-id': id });
      assert.equal(textOf(row.findByProps({ 'data-split-metric': '1' })), text);
      assert.ok(row.findByType('svg').props.className.split(' ').includes('lucide-' + icon), id);
    }
  } finally {
    renderer?.unmount();
    cleanup();
  }
});
