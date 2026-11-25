import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { parsePageSource } from '../src/proto/dsl/parser';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { projectRevision } from '../src/services/hermesProject';
import {
  RuntimeProvider,
  useRuntimeController,
  findOverlay,
  type Runtime,
} from '../src/proto/runtime/runtime';
import { DesktopConfirmDialog } from '../src/proto/runtime/ConfirmModalContent';
import { MobileRuntimeFeedback } from '../src/proto/mobile/components';
import { NodeView, ScopeProvider } from '../src/proto/renderer/NodeView';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { normalizePublishedSnapshot } from '../src/services/publishedSnapshot';
import {
  startProjectPersistence,
  createProjectPayload,
  loadProjectFromBinaryPayload,
  captureProjectPayload,
  flushProjectChanges,
} from '../src/services/projectStorage';
import { decodePflowBinary, encodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { installTestDom } from './dom';

const initialProto = useProtoStore.getInitialState();
const initialPages = usePageStore.getInitialState();

const wrapTsx = (inner: string) => `export default function Page() {\n  return (\n    ${inner}\n  );\n}\n`;

const rendererOptions: TestRenderer.TestRendererOptions = {
  createNodeMock: (element) => {
    if (typeof document !== 'undefined' && (element.type === 'input' || element.type === 'textarea')) {
      const domNode = document.createElement(element.type);
      if (element.props?.value !== undefined) {
        domNode.value = String(element.props.value);
      }
      return domNode;
    }
    return null;
  },
};

function RuntimeHost({
  pageId,
  source,
  isMobile = false,
  isDesign = false,
  onRuntime,
}: {
  pageId: string;
  source: string;
  isMobile?: boolean;
  isDesign?: boolean;
  onRuntime?: (rt: Runtime) => void;
}) {
  const doc = React.useMemo(() => parsePageSource(source).doc!, [source]);
  const rt = useRuntimeController(doc, pageId, isDesign);
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
              value={{
                row: entry.params.row as any,
                tableId: entry.params.tableId as string | undefined,
                expectedTableId: entry.expectedTableId,
                params: entry.params,
                overlayIndex: idx,
              }}
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
          doc={doc}
          overlays={rt.overlays}
          onCloseOverlay={() => rt.closeTop()}
          toasts={rt.toasts}
          confirmState={rt.confirmState}
          onResolveConfirm={rt.resolveConfirm}
        />
      )}
    </RuntimeProvider>
  );
}

function collectText(inst: TestRenderer.ReactTestInstance): string {
  return inst.children
    .map((c) => (typeof c === 'string' ? c : collectText(c)))
    .join('');
}

beforeEach(() => {
  useProtoStore.setState(initialProto, true);
  usePageStore.setState(initialPages, true);
});

test('[P1 #1 & #2] createPublishedSnapshot with custom designTokens and selectRow() normalizes cleanly for V5 publish parity', () => {
  const meta = {
    projectId: 'proj-publish-v5',
    projectName: '发布契约回归',
    templateId: 'blank_project' as const,
    storageDir: '/tmp/publish-v5',
    fileName: 'pub.pflow',
    createdAt: '2026-11-25T00:00:00Z',
    updatedAt: '2026-11-25T00:00:00Z',
    pageCount: 0,
    tableCount: 0,
    stickyCount: 0,
  };
  loadProjectFromBinaryPayload(createProjectPayload(meta));
  const tables: DBTableSchema[] = [
    {
      id: 't_orders',
      tableName: 'biz_orders',
      cnName: '订单表',
      domain: '交易域',
      description: '订单主表',
      sharedByMenus: [],
      columns: [
        { id: 'c_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
        { id: 'c_no', name: 'order_no', dataType: 'VARCHAR(64)', nullable: false, comment: '单号' },
      ],
    },
  ];
  useProtoStore.setState({ dbTables: tables });
  useProtoStore.getState().setDesignTokens({
    preset: 'modern_minimal',
    primaryColor: '#059669',
    colorMode: 'dark',
  });
  const folder = usePageStore.getState().createDesignerFolder('业务中心', null);
  const pageSrc = wrapTsx(`
    <Page pfId="p-orders" title="订单工作台">
      <Table
        pfId="tbl-orders"
        table="t_orders"
        onRowClick={() => selectRow()}
        columns={[{ dataIndex: "order_no", title: "单号" }]}
      />
    </Page>
  `);
  assert.deepEqual(pageContractErrors(pageSrc, tables), []);
  usePageStore.getState().createDesignerPage(
    { pageId: 'orders-page', title: '订单工作台', folderId: folder.id },
    pageSrc,
  );
  useProtoStore.getState().setActivePage('orders-page');

  const snap = createPublishedSnapshot('orders-page');
  assert.equal(snap.formatVersion, 5);
  assert.equal(snap.designTokens?.preset, 'modern_minimal');
  assert.equal(snap.designTokens?.primaryColor, '#059669');
  assert.equal(snap.designTokens?.colorMode, 'dark');

  const normalized = normalizePublishedSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.equal(normalized.designTokens?.preset, 'modern_minimal');
  assert.equal(normalized.pages.length, 1);
});

test('[P1 #3 & Normalization] standalone designTokens edit flushes to disk, bumps projectRevision, and classic_antd normalizes away', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pflow-theme-autosave-'));
  const prevWin = globalThis.window;
  let writeCount = 0;
  let stopPersistence = () => {};
  try {
    const now = '2026-11-25T00:00:00.000Z';
    const payload = createProjectPayload({
      projectId: 'persist-theme',
      projectName: '主题保存测试',
      templateId: 'blank_project',
      storageDir: dir,
      fileName: 'theme.pflow',
      createdAt: now,
      updatedAt: now,
      pageCount: 0,
      stickyCount: 0,
      tableCount: 0,
    });
    await fs.writeFile(path.join(dir, 'theme.pflow'), encodePflowBinary(payload));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveProjectArchive } = require(path.join(process.cwd(), 'electron/project-files.cjs'));
    const storage = new Map<string, string>();
    globalThis.window = {
      location: { search: '' },
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      protoflowDesktop: {
        isElectron: true,
        saveCurrentProject: async (input: unknown) => {
          writeCount += 1;
          return saveProjectArchive(input);
        },
        readBinaryProject: async (input: { dirPath: string; fileName: string }) => ({
          binaryBytes: new Uint8Array(await fs.readFile(path.join(input.dirPath, input.fileName))),
        }),
        onSaveBeforeClose: () => () => {},
        persistenceReady: () => {},
        finishSaveBeforeClose: () => {},
      },
    } as any;

    stopPersistence = startProjectPersistence(10000);
    loadProjectFromBinaryPayload(payload);
    const revBefore = projectRevision();
    assert.equal(writeCount, 0);

    // Modify ONLY designTokens and explicitly flush
    useProtoStore.getState().setDesignTokens({
      preset: 'modern_minimal',
      primaryColor: '#059669',
    });
    const revAfter = projectRevision();
    assert.notEqual(revAfter, revBefore, 'projectRevision must reflect standalone designTokens edits');

    await flushProjectChanges();
    assert.equal(writeCount, 1, 'standalone designTokens edit must trigger disk write on flush');

    const diskSaved = decodePflowBinary(new Uint8Array(await fs.readFile(path.join(dir, 'theme.pflow'))));
    assert.equal(diskSaved.stateSnapshot.designTokens?.preset, 'modern_minimal');
    assert.equal(diskSaved.stateSnapshot.designTokens?.primaryColor, '#059669');

    // Normalization check: an archive with explicit default `{ preset: "classic_antd" }` normalizes to null / omitted
    const rawDefaultArchive = {
      ...diskSaved,
      stateSnapshot: {
        ...diskSaved.stateSnapshot,
        designTokens: { preset: 'classic_antd' as const },
      },
    };
    loadProjectFromBinaryPayload(rawDefaultArchive);
    assert.equal(useProtoStore.getState().designTokens, null);
    assert.equal(captureProjectPayload().stateSnapshot.designTokens, undefined);
  } finally {
    stopPersistence();
    globalThis.window = prevWin;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('[P1 #4] Card.activeTable and MSurface.activeTable never fallback to another table navigationSource or mutate cross-table rows', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  let mtr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const tables: DBTableSchema[] = [
      {
        id: 't_inventory',
        tableName: 'wms_inventory',
        cnName: '库存表',
        domain: '仓储',
        description: '库存台账',
        sharedByMenus: [],
        columns: [
          { id: 'ci_1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'ci_2', name: 'status', dataType: 'VARCHAR(32)', nullable: false, comment: '状态' },
        ],
      },
      {
        id: 't_orders',
        tableName: 'sales_orders',
        cnName: '订单表',
        domain: '销售',
        description: '销售订单',
        sharedByMenus: [],
        columns: [
          { id: 'co_1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'co_2', name: 'status', dataType: 'VARCHAR(32)', nullable: false, comment: '状态' },
        ],
      },
    ];
    useProtoStore.setState({
      dbTables: tables,
      activePageId: 'orders-detail',
      navigationSource: { tableId: 't_inventory', rowId: 'inv-1' },
    });
    usePageStore.setState({
      tableRows: {
        t_inventory: [{ id: 'inv-1', status: 'in_stock' }],
        t_orders: [{ id: 'ord-1', status: 'draft' }],
      },
    });

    const desktopSrc = wrapTsx(`
      <Page pfId="p-ord-detail" title="订单详情">
        <Card pfId="card-ord" title="订单编辑" activeTable="t_orders">
          <Form pfId="form-ord" table="t_orders">
            <Input pfId="in-st" label="状态" name="status" />
            <Button pfId="btn-save" type="primary" onClick={() => submitForm("form-ord")}>保存订单</Button>
          </Form>
          <Button pfId="btn-direct" onClick={() => updateRow({ status: "hijacked" })}>直接改行</Button>
        </Card>
      </Page>
    `);
    assert.deepEqual(pageContractErrors(desktopSrc, tables), []);

    let rt!: Runtime;
    await act(async () => {
      tr = TestRenderer.create(
        <RuntimeHost pageId="orders-detail" source={desktopSrc} onRuntime={(r) => { rt = r; }} />,
        rendererOptions,
      );
    });

    // Form must NOT prefill from t_inventory
    assert.equal(rt.formValues['form-ord']?.status ?? '', '');

    const saveBtn = tr!.root.findByProps({ 'data-pf-id': 'btn-save' }).findByType('button');
    const directBtn = tr!.root.findByProps({ 'data-pf-id': 'btn-direct' }).findByType('button');

    await act(async () => {
      saveBtn.props.onClick?.({ stopPropagation: () => {} });
      directBtn.props.onClick?.({ stopPropagation: () => {} });
    });

    assert.equal(usePageStore.getState().tableRows.t_inventory[0].status, 'in_stock');
    assert.equal(usePageStore.getState().tableRows.t_orders[0].status, 'draft');
    assert.ok(rt.toasts.some((t) => t.type === 'error'));
    await act(async () => {
      tr?.unmount();
      tr = undefined;
    });

    // Mobile MSurface.activeTable check
    useProtoStore.setState({
      activePageId: 'm-orders-detail',
      navigationSource: { tableId: 't_inventory', rowId: 'inv-1' },
    });
    const mobileSrc = wrapTsx(`
      <MobilePage pfId="mp-ord" title="移动订单详情">
        <MSurface pfId="ms-ord" title="订单卡片" activeTable="t_orders">
          <MForm pfId="mform-ord" table="t_orders">
            <MField pfId="mf-st" label="状态" name="status" />
            <MButton pfId="mbtn-save" onClick={() => submitForm("mform-ord")}>保存移动订单</MButton>
          </MForm>
        </MSurface>
      </MobilePage>
    `);
    assert.deepEqual(pageContractErrors(mobileSrc, tables), []);

    let mrt!: Runtime;
    await act(async () => {
      mtr = TestRenderer.create(
        <RuntimeHost pageId="m-orders-detail" source={mobileSrc} isMobile onRuntime={(r) => { mrt = r; }} />,
        rendererOptions,
      );
    });
    const mSaveBtn = mtr!.root.findAll((el) => el.type === 'button').find((b) => collectText(b).includes('保存移动订单'))!;
    await act(async () => {
      mSaveBtn.props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_inventory[0].status, 'in_stock');
    assert.ok(mrt.toasts.some((t) => t.type === 'error'));
  } finally {
    await act(async () => {
      tr?.unmount();
      mtr?.unmount();
    });
    restore();
  }
});

test('[P1 #5] Form inside Repeater and MForm inside MRepeater isolate per-row drafts without overwriting sibling rows', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  let mtr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const tables: DBTableSchema[] = [
      {
        id: 't_items',
        tableName: 'line_items',
        cnName: '明细表',
        domain: '交易',
        description: '明细行',
        sharedByMenus: [],
        columns: [
          { id: 'c1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'c2', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '名称' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: tables });
    usePageStore.setState({
      tableRows: {
        t_items: [
          { id: 'row-1', title: 'first' },
          { id: 'row-2', title: 'second' },
        ],
      },
    });

    const src = wrapTsx(`
      <Page pfId="p-rep-form" title="行内表单列表">
        <Repeater pfId="rep-items" table="t_items" cols={1}>
          <Form pfId="f-row" table="t_items">
            <Input pfId="in-title" label="名称" name="title" />
            <Button pfId="btn-row-save" type="primary" onClick={() => submitForm("f-row")}>保存本行</Button>
          </Form>
        </Repeater>
      </Page>
    `);
    assert.deepEqual(pageContractErrors(src, tables), []);

    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="rep-form-page" source={src} />, rendererOptions);
    });

    const inputs = tr!.root.findAll((el) => el.type === 'input');
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0].props.value, 'first');
    assert.equal(inputs[1].props.value, 'second');

    // Directly click Row 1's save button without editing -> Row 1 MUST stay 'first', NOT 'second'!
    const saveBtns = tr!.root.findAll((el) => el.type === 'button' && collectText(el).includes('保存本行'));
    assert.equal(saveBtns.length, 2);
    await act(async () => {
      saveBtns[0].props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_items[0].title, 'first');
    assert.equal(usePageStore.getState().tableRows.t_items[1].title, 'second');

    // Edit Row 1's input to 'first-edited' and save -> only Row 1 updates
    const refreshedInputs = tr!.root.findAll((el) => el.type === 'input');
    await act(async () => {
      refreshedInputs[0].props.onChange({ target: { value: 'first-edited' } });
    });
    const refreshedSaveBtns = tr!.root.findAll((el) => el.type === 'button' && collectText(el).includes('保存本行'));
    await act(async () => {
      refreshedSaveBtns[0].props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_items[0].title, 'first-edited');
    assert.equal(usePageStore.getState().tableRows.t_items[1].title, 'second');
    await act(async () => {
      tr?.unmount();
      tr = undefined;
    });

    // Mobile MRepeater + MForm parity
    usePageStore.setState({
      tableRows: {
        t_items: [
          { id: 'm-1', title: 'alpha' },
          { id: 'm-2', title: 'beta' },
        ],
      },
    });
    const mSrc = wrapTsx(`
      <MobilePage pfId="mp-rep" title="移动行内编辑">
        <MRepeater pfId="mrep-items" table="t_items">
          <MForm pfId="mf-row" table="t_items">
            <MField pfId="mfi-title" label="名称" name="title" />
            <MButton pfId="mbtn-row-save" onClick={() => submitForm("mf-row")}>保存卡片</MButton>
          </MForm>
        </MRepeater>
      </MobilePage>
    `);
    assert.deepEqual(pageContractErrors(mSrc, tables), []);

    await act(async () => {
      mtr = TestRenderer.create(<RuntimeHost pageId="mrep-page" source={mSrc} isMobile />, rendererOptions);
    });
    const mInputs = mtr!.root.findAll((el) => el.type === 'input');
    assert.equal(mInputs.length, 2);
    assert.equal(mInputs[0].props.value, 'alpha');
    assert.equal(mInputs[1].props.value, 'beta');

    const mSaveBtns = mtr!.root.findAll((el) => el.type === 'button' && collectText(el).includes('保存卡片'));
    assert.equal(mSaveBtns.length, 2);
    await act(async () => {
      mSaveBtns[0].props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_items[0].title, 'alpha');
    assert.equal(usePageStore.getState().tableRows.t_items[1].title, 'beta');

    await act(async () => {
      mInputs[0].props.onChange({ target: { value: 'alpha-edited' } });
    });
    const mSaveBtnsAfter = mtr!.root.findAll((el) => el.type === 'button' && collectText(el).includes('保存卡片'));
    await act(async () => {
      mSaveBtnsAfter[0].props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_items[0].title, 'alpha-edited');
    assert.equal(usePageStore.getState().tableRows.t_items[1].title, 'beta');
  } finally {
    await act(async () => {
      tr?.unmount();
      mtr?.unmount();
    });
    restore();
  }
});

test('[P1 #6] two autoSelectFirst lists bound to the same table with disjoint filters never thrash each other', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const tables: DBTableSchema[] = [
      {
        id: 't_tasks',
        tableName: 'work_tasks',
        cnName: '任务表',
        domain: '协同',
        description: '任务列表',
        sharedByMenus: [],
        columns: [
          { id: 'c1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'c2', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '标题' },
          { id: 'c3', name: 'status', dataType: "ENUM('pending','done')", nullable: false, comment: '状态' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: tables });
    usePageStore.setState({
      tableRows: {
        t_tasks: [
          { id: 'task-A', title: '待办A', status: 'pending' },
          { id: 'task-B', title: '已完成B', status: 'done' },
        ],
      },
    });

    const src = wrapTsx(`
      <Page pfId="p-dual" title="双列表联动">
        <Repeater pfId="rep-pending" table="t_tasks" filter={{ status: "pending" }} autoSelectFirst={true}>
          <Card pfId="card-a" title="{{row.title}}" />
        </Repeater>
        <Repeater pfId="rep-done" table="t_tasks" filter={{ status: "done" }} autoSelectFirst={true}>
          <Card pfId="card-b" title="{{row.title}}" />
        </Repeater>
      </Page>
    `);

    let rt!: Runtime;
    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="dual-page" source={src} onRuntime={(r) => { rt = r; }} />, rendererOptions);
    });

    // Initial auto-select settles cleanly on the first list's row (task-A) without ping-ponging to task-B
    assert.equal(rt.activeRows['t_tasks'], 'task-A');

    // Clicking task-B in the second list keeps task-B selected without rep-pending stealing it back
    const rowB = tr!.root.find((el) => el.props['data-row-id'] === 'task-B');
    await act(async () => {
      rowB.props.onClick?.({});
    });
    assert.equal(rt.activeRows['t_tasks'], 'task-B');
  } finally {
    await act(async () => {
      tr?.unmount();
    });
    restore();
  }
});

test('[P1 #7] Kanban and MKanban pick status over earlier priority ENUM and block writes when status column is ambiguous', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const tables: DBTableSchema[] = [
      {
        id: 't_tickets',
        tableName: 'support_tickets',
        cnName: '工单表',
        domain: '客服',
        description: '工单看板',
        sharedByMenus: [],
        columns: [
          { id: 'c1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'c2', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '标题' },
          { id: 'c3', name: 'priority', dataType: "ENUM('low','high')", nullable: false, comment: '优先级' },
          { id: 'c4', name: 'status', dataType: "ENUM('open','closed')", nullable: false, comment: '状态' },
        ],
      },
      {
        id: 't_priority_only',
        tableName: 'priority_items',
        cnName: '非状态枚举表',
        domain: '客服',
        description: '仅含优先级',
        sharedByMenus: [],
        columns: [
          { id: 'p1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'p2', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '标题' },
          { id: 'p3', name: 'priority', dataType: "ENUM('low','high')", nullable: false, comment: '优先级' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: tables });
    usePageStore.setState({
      tableRows: {
        t_tickets: [{ id: 'tk-1', title: '连接超时排查', priority: 'low', status: 'open' }],
        t_priority_only: [{ id: 'po-1', title: '仅优先级卡片', priority: 'low' }],
      },
    });

    const src = wrapTsx(`
      <Page pfId="p-kanban" title="工单看板">
        <Kanban pfId="kb-tickets" table="t_tickets" />
        <Kanban pfId="kb-readonly" table="t_priority_only" />
      </Page>
    `);
    assert.deepEqual(pageContractErrors(src, tables), []);

    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="kb-page" source={src} />, rendererOptions);
    });

    // kb-tickets must advance `status` ('open' -> 'closed'), leaving `priority` as 'low'!
    const kbTickets = tr!.root.find((el) => el.type === 'div' && el.props['data-pf-id'] === 'kb-tickets');
    const moveButtons = kbTickets.findAll(
      (el) => el.type === 'button' && typeof el.props['aria-label'] === 'string' && el.props['aria-label'].includes('推进至'),
    );
    assert.equal(moveButtons.length, 1);
    await act(async () => {
      moveButtons[0].props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_tickets[0].status, 'closed');
    assert.equal(usePageStore.getState().tableRows.t_tickets[0].priority, 'low');

    // kb-readonly has only priority ENUM and omitted statusField -> zero advance buttons!
    const kbReadonly = tr!.root.find((el) => el.type === 'div' && el.props['data-pf-id'] === 'kb-readonly');
    const readonlyMoves = kbReadonly.findAll(
      (el) => el.type === 'button' && typeof el.props['aria-label'] === 'string' && el.props['aria-label'].includes('推进至'),
    );
    assert.equal(readonlyMoves.length, 0);
  } finally {
    await act(async () => {
      tr?.unmount();
    });
    restore();
  }
});

test('[P1 #8] edge UI Stack stress projection only affects display and never writes simulated text back to tableRows', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const tables: DBTableSchema[] = [
      {
        id: 't_items',
        tableName: 'biz_items',
        cnName: '物料表',
        domain: '仓储',
        description: '物料档案',
        sharedByMenus: [],
        columns: [
          { id: 'c1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'c2', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '物料名' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: tables, uiState: 'edge' });
    usePageStore.setState({
      tableRows: {
        t_items: [{ id: 'item-1', title: 'actual' }],
      },
    });

    const src = wrapTsx(`
      <Page pfId="p-edge" title="极值压测隔离">
        <Repeater pfId="rep-edge" table="t_items" cols={1}>
          <Card pfId="card-display" title="{{row.title}}" />
          <Form pfId="f-edge" table="t_items">
            <Input pfId="in-edge" label="物料名" name="title" />
            <Button pfId="btn-edge-save" type="primary" onClick={() => submitForm("f-edge")}>保存</Button>
          </Form>
        </Repeater>
      </Page>
    `);

    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="edge-page" source={src} />, rendererOptions);
    });

    const fullText = collectText(tr!.root);
    assert.ok(fullText.includes('极值长文本压测'), 'display text should show edge stress string');

    const input = tr!.root.find((el) => el.type === 'input');
    assert.equal(input.props.value, 'actual', 'bound Form must prefill canonical stored value, not edge stress text');

    const saveBtn = tr!.root.findByProps({ 'data-pf-id': 'btn-edge-save' }).findByType('button');
    await act(async () => {
      saveBtn.props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_items[0].title, 'actual');
  } finally {
    await act(async () => {
      tr?.unmount();
    });
    restore();
  }
});

test('[P1 #9 & #10] multi-level CASCADE respects grandchild RESTRICT, deletes transitively, and granular undo preserves concurrent edits', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const makeTables = (batchPolicy: 'RESTRICT' | 'CASCADE'): DBTableSchema[] => [
      {
        id: 't_orders',
        tableName: 'orders',
        cnName: '订单主表',
        domain: '交易',
        description: '订单',
        sharedByMenus: [],
        columns: [
          { id: 'o1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'o2', name: 'code', dataType: 'VARCHAR(64)', nullable: false, comment: '单号' },
        ],
      },
      {
        id: 't_items',
        tableName: 'order_items',
        cnName: '订单明细',
        domain: '交易',
        description: '明细',
        sharedByMenus: [],
        columns: [
          { id: 'i1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          {
            id: 'i2',
            name: 'order_id',
            dataType: 'VARCHAR(64)',
            nullable: false,
            isForeignKey: true,
            references: 'orders(id)',
            foreignKeyOptions: { onDelete: 'CASCADE' },
            comment: '订单ID',
          },
        ],
      },
      {
        id: 't_batches',
        tableName: 'item_batches',
        cnName: '拣货批次',
        domain: '仓储',
        description: '孙级批次',
        sharedByMenus: [],
        columns: [
          { id: 'b1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          {
            id: 'b2',
            name: 'item_id',
            dataType: 'VARCHAR(64)',
            nullable: false,
            isForeignKey: true,
            references: 'order_items(id)',
            foreignKeyOptions: { onDelete: batchPolicy },
            comment: '明细ID',
          },
        ],
      },
      {
        id: 't_inventory',
        tableName: 'inventory',
        cnName: '库存表',
        domain: '仓储',
        description: '独立库存',
        sharedByMenus: [],
        columns: [
          { id: 'v1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'v2', name: 'qty', dataType: 'INT', nullable: false, comment: '数量' },
        ],
      },
    ];

    // 1. Order -> Item (CASCADE) -> Batch (RESTRICT) MUST block Order deletion and leave all 3 levels intact
    useProtoStore.setState({ dbTables: makeTables('RESTRICT') });
    usePageStore.setState({
      tableRows: {
        t_orders: [{ id: 'ord-1', code: 'SO-01' }],
        t_items: [{ id: 'item-1', order_id: 'ord-1' }],
        t_batches: [{ id: 'batch-1', item_id: 'item-1' }],
        t_inventory: [{ id: 'inv-1', qty: 10 }],
      },
    });
    assert.throws(() => usePageStore.getState().deleteRow('t_orders', 'ord-1'), /拣货批次/);
    assert.equal(usePageStore.getState().tableRows.t_orders.length, 1);
    assert.equal(usePageStore.getState().tableRows.t_items.length, 1);
    assert.equal(usePageStore.getState().tableRows.t_batches.length, 1);

    // 2. Order -> Item (CASCADE) -> Batch (CASCADE) deletes all 3 levels cleanly, and Undo restores without wiping concurrent edits!
    useProtoStore.setState({ dbTables: makeTables('CASCADE') });
    const src = wrapTsx(`
      <Page pfId="p-undo" title="级联与精确撤销">
        <Table
          pfId="tbl-ord"
          table="t_orders"
          columns={[{ dataIndex: "code", title: "单号" }]}
          rowActions={[{ label: "归档删除", danger: true, onClick: () => deleteRow("undo") }]}
        />
      </Page>
    `);

    let rt!: Runtime;
    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="undo-page" source={src} onRuntime={(r) => { rt = r; }} />, rendererOptions);
    });

    const delBtn = tr!.root.findAll((el) => el.type === 'button').find((b) => collectText(b).includes('归档删除'))!;
    await act(async () => {
      delBtn.props.onClick?.({ stopPropagation: () => {} });
    });

    assert.equal(usePageStore.getState().tableRows.t_orders.length, 0);
    assert.equal(usePageStore.getState().tableRows.t_items.length, 0);
    assert.equal(usePageStore.getState().tableRows.t_batches.length, 0);

    // Make independent edits BEFORE clicking Undo
    usePageStore.getState().updateRow('t_inventory', 'inv-1', { qty: 99 });
    const inserted = usePageStore.getState().insertRow('t_orders', { code: 'SO-NEW' });

    const undoToast = rt.toasts.find((t) => Boolean(t.undoAction));
    assert.ok(undoToast, 'expected undo toast');
    await act(async () => {
      undoToast!.undoAction!.onUndo();
    });

    // Deleted 3-level hierarchy is restored at original index AND concurrent edits remain intact!
    assert.deepEqual(
      usePageStore.getState().tableRows.t_orders.map((r) => r.id),
      ['ord-1', inserted.id],
    );
    assert.equal(usePageStore.getState().tableRows.t_items.length, 1);
    assert.equal(usePageStore.getState().tableRows.t_batches.length, 1);
    assert.equal(usePageStore.getState().tableRows.t_inventory[0].qty, 99);
  } finally {
    await act(async () => {
      tr?.unmount();
    });
    restore();
  }
});

test('[P1 #11] confirm(msg, "{{row.code}}") aborts with error instead of downgrading when match field is missing or empty', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const tables: DBTableSchema[] = [
      {
        id: 't_orders',
        tableName: 'orders',
        cnName: '订单表',
        domain: '交易',
        description: '订单',
        sharedByMenus: [],
        columns: [
          { id: 'o1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'o2', name: 'code', dataType: 'VARCHAR(64)', nullable: true, comment: '单号' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: tables });
    usePageStore.setState({
      tableRows: {
        t_orders: [{ id: 'ord-empty', code: '' }],
      },
    });

    const src = wrapTsx(`
      <Page pfId="p-confirm" title="高危确认防降级">
        <Table
          pfId="tbl-confirm"
          table="t_orders"
          columns={[{ dataIndex: "id", title: "ID" }]}
          rowActions={[{
            label: "高危删除",
            danger: true,
            onClick: () => {
              confirm("确认彻底删除？", "{{row.code}}");
              deleteRow();
            }
          }]}
        />
      </Page>
    `);

    let rt!: Runtime;
    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="confirm-page" source={src} onRuntime={(r) => { rt = r; }} />, rendererOptions);
    });

    const btn = tr!.root.findAll((el) => el.type === 'button').find((b) => collectText(b).includes('高危删除'))!;
    await act(async () => {
      btn.props.onClick?.({ stopPropagation: () => {} });
    });

    // Must NOT open a downgraded confirm dialog without matchText, and must NOT delete the row
    assert.equal(rt.confirmState, null);
    assert.equal(usePageStore.getState().tableRows.t_orders.length, 1);
    assert.ok(rt.toasts.some((t) => t.type === 'error' && t.message.includes('row.code')));
  } finally {
    await act(async () => {
      tr?.unmount();
    });
    restore();
  }
});

test('[P2 #2, #3 & #4] dark workbench CSS isolation, mirrored Repeater DOM ids, and empty state parity on Chart & unbound collections', async () => {
  const restore = installTestDom();
  let dtr: TestRenderer.ReactTestRenderer | undefined;
  let etr: TestRenderer.ReactTestRenderer | undefined;
  let metr: TestRenderer.ReactTestRenderer | undefined;
  try {
    // [P2 #2] Verify CSS selector isolation in src/index.css
    const css = fsSync.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');
    assert.ok(
      css.includes(':is([data-pf-mode="dark"], :root[data-theme="dark"]) {') &&
        css.includes('.pf-paper:not([data-pf-mode="light"], [data-pf-mode="light"] *)') &&
        css.includes(':is(.pf-paper, .pf-paper *):not([data-pf-mode="light"], [data-pf-mode="light"] *)'),
      'src/index.css must isolate .pf-paper dark overrides from explicit [data-pf-mode="light"] canvas',
    );

    // [P2 #3] Design-mode Repeater emits data-pf-id ONLY on row 0; mirrored rows emit data-pf-mirror-of
    const tables: DBTableSchema[] = [
      {
        id: 't_cards',
        tableName: 'cards',
        cnName: '卡片表',
        domain: '展示',
        description: '卡片',
        sharedByMenus: [],
        columns: [
          { id: 'c1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'c2', name: 'name', dataType: 'VARCHAR(64)', nullable: false, comment: '名称' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: tables, uiState: 'normal' });
    usePageStore.setState({
      tableRows: {
        t_cards: [
          { id: 'c-1', name: 'Card 1' },
          { id: 'c-2', name: 'Card 2' },
          { id: 'c-3', name: 'Card 3' },
        ],
      },
    });

    const designSrc = wrapTsx(`
      <Page pfId="p-design" title="设计态镜像检查">
        <Repeater pfId="rep-design" table="t_cards">
          <Tag pfId="tag-template" text="状态标签" />
        </Repeater>
      </Page>
    `);
    await act(async () => {
      dtr = TestRenderer.create(<RuntimeHost pageId="design-page" source={designSrc} isDesign />, rendererOptions);
    });
    const realTemplateAnchors = dtr!.root.findAll(
      (el) => typeof el.type === 'string' && el.props['data-pf-id'] === 'tag-template',
    );
    const mirroredAnchors = dtr!.root.findAll(
      (el) => typeof el.type === 'string' && el.props['data-pf-mirror-of'] === 'tag-template',
    );
    assert.equal(realTemplateAnchors.length, 1, 'data-pf-id must appear only once on the primary template row');
    assert.ok(mirroredAnchors.length >= 2, 'mirrored rows must use data-pf-mirror-of without duplicating data-pf-id');
    await act(async () => {
      dtr?.unmount();
      dtr = undefined;
    });

    // [P2 #4] uiState === "empty" renders empty states for sample ChartMaterial and unbound Repeater/Kanban/Calendar + M*
    useProtoStore.setState({ uiState: 'empty' });
    const emptyDesktopSrc = wrapTsx(`
      <Page pfId="p-empty" title="空态一致性">
        <BarChart pfId="ch-sample" title="趋势图" source="sample" />
        <Repeater pfId="rep-unbound">
          <Text pfId="txt-u">不应渲染样例卡片</Text>
        </Repeater>
        <Kanban pfId="kb-unbound" />
        <Calendar pfId="cal-unbound" />
      </Page>
    `);
    await act(async () => {
      etr = TestRenderer.create(<RuntimeHost pageId="empty-page" source={emptyDesktopSrc} />, rendererOptions);
    });
    const emptyCharts = etr!.root.findAll(
      (el) => el.type === 'section' && el.props['data-chart-status'] === 'empty',
    );
    assert.equal(emptyCharts.length, 1, 'BarChart with source="sample" must render empty state when uiState === "empty"');
    assert.equal(
      etr!.root.findAll((el) => typeof el.type === 'string' && el.props['data-ui-stack'] === 'empty').length,
      3,
    );
    assert.ok(!collectText(etr!.root).includes('不应渲染样例卡片'));
    await act(async () => {
      etr?.unmount();
      etr = undefined;
    });

    const emptyMobileSrc = wrapTsx(`
      <MobilePage pfId="mp-empty" title="移动空态一致性">
        <MRepeater pfId="mrep-unbound">
          <MSurface pfId="ms-u" title="不应渲染移动样例" />
        </MRepeater>
        <MKanban pfId="mkb-unbound" />
        <MCalendar pfId="mcal-unbound" />
      </MobilePage>
    `);
    await act(async () => {
      metr = TestRenderer.create(<RuntimeHost pageId="m-empty-page" source={emptyMobileSrc} isMobile />, rendererOptions);
    });
    assert.equal(
      metr!.root.findAll((el) => typeof el.type === 'string' && el.props['data-ui-stack'] === 'empty').length,
      3,
    );
    assert.ok(!collectText(metr!.root).includes('不应渲染移动样例'));
  } finally {
    await act(async () => {
      dtr?.unmount();
      etr?.unmount();
      metr?.unmount();
    });
    restore();
  }
});

test('[2nd-Pass P1 #1 & #4] Card.activeTable purges params.row across 2nd-level overlays while allowing bound child table row actions', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const tables: DBTableSchema[] = [
      {
        id: 't_inventory',
        tableName: 'inventory',
        cnName: '库存表',
        domain: '仓储',
        description: '库存',
        sharedByMenus: [],
        columns: [
          { id: 'i1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'i2', name: 'status', dataType: 'VARCHAR(32)', nullable: false, comment: '状态' },
        ],
      },
      {
        id: 't_orders',
        tableName: 'orders',
        cnName: '订单主表',
        domain: '销售',
        description: '订单',
        sharedByMenus: [],
        columns: [
          { id: 'o1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'o2', name: 'code', dataType: 'VARCHAR(64)', nullable: false, comment: '单号' },
          { id: 'o3', name: 'status', dataType: 'VARCHAR(32)', nullable: false, comment: '状态' },
        ],
      },
      {
        id: 't_lines',
        tableName: 'order_lines',
        cnName: '订单明细',
        domain: '销售',
        description: '明细',
        sharedByMenus: [],
        columns: [
          { id: 'l1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          {
            id: 'l2',
            name: 'order_id',
            dataType: 'VARCHAR(64)',
            nullable: false,
            isForeignKey: true,
            references: 'orders(id)',
            comment: '所属订单',
          },
          { id: 'l3', name: 'item_name', dataType: 'VARCHAR(128)', nullable: false, comment: '物料' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: tables });
    usePageStore.setState({
      tableRows: {
        t_inventory: [{ id: 'inv-1', status: 'in_stock' }],
        t_orders: [{ id: 'ord-1', code: 'SO-100', status: 'open' }],
        t_lines: [{ id: 'line-1', order_id: 'ord-1', item_name: '初始物料' }],
      },
    });

    const src = wrapTsx(`
      <Page pfId="p-nested" title="嵌套弹层与主从表测试">
        <Table
          pfId="tbl-inv"
          table="t_inventory"
          columns={[{ dataIndex: "status", title: "库存状态" }]}
          rowActions={[{ label: "打开库存抽屉", onClick: () => openDrawer("d-inv") }]}
        />
        <Card pfId="card-master" title="订单主从详情" activeTable="t_orders">
          <Table
            pfId="tbl-child-lines"
            table="t_lines"
            sourceForeignKey="order_id"
            columns={[{ dataIndex: "item_name", title: "明细物料" }]}
            rowActions={[{ label: "更新明细", onClick: () => updateRow({ item_name: "明细已修改" }) }]}
          />
        </Card>
        <Drawer pfId="drw-inv" id="d-inv" title="一级抽屉">
          <Card pfId="card-unselected-order" title="订单详情" activeTable="t_orders">
            <Button pfId="btn-open-m2" onClick={() => openModal("m-second")}>打开二级弹窗</Button>
          </Card>
        </Drawer>
        <Modal pfId="mdl-second" id="m-second" title="二级弹窗" footer={false}>
          <Button pfId="btn-mut-m2" onClick={() => updateRow({ status: "hijacked_inventory" })}>二级更新</Button>
        </Modal>
      </Page>
    `);
    assert.deepEqual(pageContractErrors(src, tables), []);

    let rt!: Runtime;
    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="nested-page" source={src} onRuntime={(r) => { rt = r; }} />, rendererOptions);
    });

    // [P1 #1] Open Drawer from inventory row -> inside Card(activeTable="t_orders") open 2nd Modal -> click updateRow
    const openDrwBtn = tr!.root.findAll((el) => el.type === 'button').find((b) => collectText(b).includes('打开库存抽屉'))!;
    await act(async () => {
      openDrwBtn.props.onClick?.({ stopPropagation: () => {} });
    });
    const openM2Btn = tr!.root.findByProps({ 'data-pf-id': 'btn-open-m2' }).findByType('button');
    await act(async () => {
      openM2Btn.props.onClick?.({ stopPropagation: () => {} });
    });
    const mutM2Btn = tr!.root.findByProps({ 'data-pf-id': 'btn-mut-m2' }).findByType('button');
    await act(async () => {
      mutM2Btn.props.onClick?.({ stopPropagation: () => {} });
    });

    // Inventory row MUST remain untouched and error toast must be emitted!
    assert.equal(usePageStore.getState().tableRows.t_inventory[0].status, 'in_stock');
    assert.ok(rt.toasts.some((t) => t.type === 'error'));

    // [P1 #4] Select order ord-1 -> child Table(t_lines, sourceForeignKey="order_id") inside Card(activeTable="t_orders") updates its own line!
    await act(async () => {
      rt.setActiveRow('t_orders', 'ord-1');
    });
    const editLineBtn = tr!.root.findAll((el) => el.type === 'button').find((b) => collectText(b).includes('更新明细'))!;
    await act(async () => {
      editLineBtn.props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(usePageStore.getState().tableRows.t_lines[0].item_name, '明细已修改');
  } finally {
    await act(async () => {
      tr?.unmount();
    });
    restore();
  }
});

test('[2nd-Pass P1 #2 & #3] cross-table child Form inside Repeater inserts distinct rows and row-scoped PickerInput enforces FK valueField', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  let ptr: TestRenderer.ReactTestRenderer | undefined;
  try {
    const orderTables: DBTableSchema[] = [
      {
        id: 't_orders',
        tableName: 'orders',
        cnName: '订单表',
        domain: '销售',
        description: '订单',
        sharedByMenus: [],
        columns: [
          { id: 'o1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'o2', name: 'code', dataType: 'VARCHAR(64)', nullable: false, comment: '单号' },
        ],
      },
      {
        id: 't_lines',
        tableName: 'order_lines',
        cnName: '明细表',
        domain: '销售',
        description: '明细',
        sharedByMenus: [],
        columns: [
          { id: 'l1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          {
            id: 'l2',
            name: 'order_id',
            dataType: 'VARCHAR(64)',
            nullable: false,
            isForeignKey: true,
            references: 'orders(id)',
            comment: '订单ID',
          },
          { id: 'l3', name: 'note', dataType: 'VARCHAR(128)', nullable: false, comment: '备注' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: orderTables });
    usePageStore.setState({
      tableRows: {
        t_orders: [
          { id: 'ord-1', code: 'PO-1' },
          { id: 'ord-2', code: 'PO-2' },
        ],
        t_lines: [],
      },
    });

    // [P1 #2] Form(table="t_lines") inside Repeater(table="t_orders")
    const crossFormSrc = wrapTsx(`
      <Page pfId="p-cross-rep" title="循环订单新增明细">
        <Repeater pfId="rep-orders" table="t_orders" cols={1}>
          <Form pfId="f-new-line" table="t_lines">
            <Input pfId="in-oid" label="订单ID" name="order_id" initialValue="{{row.id}}" />
            <Input pfId="in-note" label="明细内容" name="note" required={true} />
            <Button pfId="btn-add-line" type="primary" onClick={() => submitForm("f-new-line")}>新增明细</Button>
          </Form>
        </Repeater>
      </Page>
    `);
    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="cross-rep-page" source={crossFormSrc} />, rendererOptions);
    });

    // Card 1 inputs: [order_id_1, note_1, order_id_2, note_2]
    const allInputs = tr!.root.findAll((el) => el.type === 'input');
    assert.equal(allInputs.length, 4);
    await act(async () => {
      allInputs[1].props.onChange({ target: { value: '第一张订单明细' } });
    });
    let addBtns = tr!.root.findAll((el) => el.type === 'button' && collectText(el).includes('新增明细'));
    await act(async () => {
      addBtns[0].props.onClick?.({ stopPropagation: () => {} });
    });

    const refreshedInputs = tr!.root.findAll((el) => el.type === 'input');
    await act(async () => {
      refreshedInputs[3].props.onChange({ target: { value: '第二张订单明细' } });
    });
    addBtns = tr!.root.findAll((el) => el.type === 'button' && collectText(el).includes('新增明细'));
    await act(async () => {
      addBtns[1].props.onClick?.({ stopPropagation: () => {} });
    });

    const savedLines = usePageStore.getState().tableRows.t_lines;
    assert.equal(savedLines.length, 2, 'saving on two order cards must insert two separate line records');
    assert.ok(savedLines.some((r) => r.order_id === 'ord-1' && r.note === '第一张订单明细'));
    assert.ok(savedLines.some((r) => r.order_id === 'ord-2' && r.note === '第二张订单明细'));
    await act(async () => {
      tr?.unmount();
      tr = undefined;
    });

    // [P1 #3] Row-scoped PickerInput MUST enforce FK target column (`book_no` vs runtime `id`)
    const bookTables: DBTableSchema[] = [
      {
        id: 't_books',
        tableName: 'books',
        cnName: '图书表',
        domain: '馆藏',
        description: '图书',
        sharedByMenus: [],
        columns: [
          { id: 'b1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'b2', name: 'book_no', dataType: 'VARCHAR(64)', nullable: false, isUnique: true, comment: '索书号' },
          { id: 'b3', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '书名' },
        ],
      },
      {
        id: 't_loans',
        tableName: 'loans',
        cnName: '借阅表',
        domain: '馆藏',
        description: '借阅记录',
        sharedByMenus: [],
        columns: [
          { id: 'ln1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          {
            id: 'ln2',
            name: 'book_no',
            dataType: 'VARCHAR(64)',
            nullable: false,
            isForeignKey: true,
            references: 'books(book_no)',
            comment: '借阅索书号',
          },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: bookTables });
    usePageStore.setState({
      tableRows: {
        t_books: [
          // Book 1's runtime id ('B-2') deliberately collides with Book 2's book_no ('B-2')!
          { id: 'B-2', book_no: 'ISBN-001', title: 'B-2' },
          { id: 'B-9', book_no: 'B-2', title: '领域驱动设计' },
        ],
        t_loans: [{ id: 'loan-1', book_no: 'ISBN-001' }],
      },
    });

    const pickerSrc = wrapTsx(`
      <Page pfId="p-picker-fk" title="行内选单外键校验">
        <Repeater pfId="rep-loans" table="t_loans" cols={1}>
          <Form pfId="f-loan" table="t_loans">
            <PickerInput pfId="pk-book" label="关联图书" name="book_no" overlay="m-books" />
            <Button pfId="btn-save-loan" type="primary" onClick={() => submitForm("f-loan")}>保存借阅</Button>
          </Form>
        </Repeater>
        <Modal pfId="mdl-books" id="m-books" title="选择图书" footer={false}>
          <Table pfId="tbl-books" table="t_books" selectable={true} columns={[{ dataIndex: "title", title: "书名" }]} />
          <Button pfId="btn-wrong-col" onClick={() => returnSelection("tbl-books", "title", "id")}>错误按ID回填</Button>
          <Button pfId="btn-label-only" onClick={() => returnSelection("tbl-books", "title")}>回填标题</Button>
          <Button pfId="btn-right-col" onClick={() => returnSelection("tbl-books", "title", "book_no")}>正确按索书号回填</Button>
        </Modal>
      </Page>
    `);

    let prt!: Runtime;
    await act(async () => {
      ptr = TestRenderer.create(<RuntimeHost pageId="picker-fk-page" source={pickerSrc} onRuntime={(r) => { prt = r; }} />, rendererOptions);
    });

    // Click PickerInput inside Repeater row 1
    const pickerTrigger = ptr!.root.findByProps({ 'data-pf-id': 'pk-book' }).findByType('button');
    await act(async () => {
      pickerTrigger.props.onClick?.();
    });
    assert.equal(prt.overlays.length, 1);

    // Select Book 1 (id='B-2', book_no='ISBN-001') and click wrong returnSelection(..., "id")
    await act(async () => {
      prt.setSelection('tbl-books', ['B-2']);
    });
    const wrongBtn = ptr!.root.findByProps({ 'data-pf-id': 'btn-wrong-col' }).findByType('button');
    await act(async () => {
      wrongBtn.props.onClick?.({ stopPropagation: () => {} });
    });

    // Must reject mismatched FK column (`id` != `book_no`) and stay open without corrupting draft!
    assert.equal(prt.overlays.length, 1);
    assert.ok(prt.toasts.some((t) => t.type === 'error' && t.message.includes('外键不一致')));
    assert.equal(prt.formValues['f-loan::row:t_loans:loan-1']?.book_no, 'ISBN-001');

    const labelOnly = ptr!.root.findByProps({ 'data-pf-id': 'btn-label-only' }).findByType('button');
    await act(async () => { labelOnly.props.onClick({ stopPropagation() {} }); });
    assert.equal(prt.overlays.length, 1);
    assert.equal(prt.formValues['f-loan::row:t_loans:loan-1'].book_no, 'ISBN-001');
    assert.equal(usePageStore.getState().tableRows.t_loans[0].book_no, 'ISBN-001');

    // Now select Book 2 (id='B-9', book_no='B-2') and click valid returnSelection(..., "book_no")
    await act(async () => {
      prt.setSelection('tbl-books', ['B-9']);
    });
    const rightBtn = ptr!.root.findByProps({ 'data-pf-id': 'btn-right-col' }).findByType('button');
    await act(async () => {
      rightBtn.props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(prt.overlays.length, 0);
    assert.equal(prt.formValues['f-loan::row:t_loans:loan-1']?.book_no, 'B-2');
    await act(async () => { pickerTrigger.props.onClick(); });
    await act(async () => { prt.setSelection('tbl-books', ['B-2']); });
    await act(async () => {
      await prt.run({ $kind: 'actions', calls: [{ name: 'returnSelection', args: ['tbl-books', 'book_no'] }] }, {});
    });
    assert.equal(prt.overlays.length, 0);
    assert.equal(prt.formValues['f-loan::row:t_loans:loan-1'].book_no, 'ISBN-001');
  } finally {
    await act(async () => {
      tr?.unmount();
      ptr?.unmount();
    });
    restore();
  }
});

test('[2nd-Pass P1 #5, #6 & P2 #1] Kanban rejects status_changed_at TIMESTAMP, Undo enforces PK & composite unique constraints, and dual SET NULL + CASCADE undoes cleanly', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  try {
    // [P1 #5] Table with TIMESTAMP `status_changed_at` must NEVER be writable as an implicit Kanban status column
    const kbTables: DBTableSchema[] = [
      {
        id: 't_audit',
        tableName: 'audit_events',
        cnName: '审计表',
        domain: '安全',
        description: '审计日志',
        sharedByMenus: [],
        columns: [
          { id: 'a1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'a2', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '事件' },
          { id: 'a3', name: 'status_changed_at', dataType: 'TIMESTAMP', nullable: false, comment: '状态变更时间' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: kbTables });
    usePageStore.setState({
      tableRows: {
        t_audit: [{ id: 'ev-1', title: '登录核验', status_changed_at: '2026-11-25 09:00:00' }],
      },
    });
    const kbSrc = wrapTsx(`
      <Page pfId="p-kb-ts" title="时间戳防误写">
        <Kanban pfId="kb-audit" table="t_audit" />
      </Page>
    `);
    await act(async () => {
      tr = TestRenderer.create(<RuntimeHost pageId="kb-ts-page" source={kbSrc} />, rendererOptions);
    });
    const advanceBtns = tr!.root.findAll(
      (el) => el.type === 'button' && typeof el.props['aria-label'] === 'string' && el.props['aria-label'].includes('推进至'),
    );
    assert.equal(advanceBtns.length, 0, 'TIMESTAMP status_changed_at must remain read-only on Kanban');
    assert.equal(usePageStore.getState().tableRows.t_audit[0].status_changed_at, '2026-11-25 09:00:00');
    await act(async () => {
      tr?.unmount();
      tr = undefined;
    });

    // [P1 #6] Undo delete MUST check business primary key (`order_no`) AND table-level composite `uniqueConstraints`
    const uniqTables: DBTableSchema[] = [
      {
        id: 't_po',
        tableName: 'purchase_orders',
        cnName: '采购单',
        domain: '采购',
        description: '业务主键表',
        uniqueConstraints: [{ name: 'uq_sup_ext', columnIds: ['c_sup', 'c_ext'] }],
        sharedByMenus: [],
        columns: [
          { id: 'c_pk', name: 'order_no', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '采购单号' },
          { id: 'c_sup', name: 'supplier_code', dataType: 'VARCHAR(64)', nullable: false, comment: '供应商编码' },
          { id: 'c_ext', name: 'external_ref', dataType: 'VARCHAR(64)', nullable: false, comment: '外部单号' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: uniqTables });
    usePageStore.setState({
      tableRows: {
        t_po: [
          { id: 'r-1', order_no: 'PO-1', supplier_code: 'SUP-A', external_ref: 'EXT-1' },
          { id: 'r-2', order_no: 'PO-2', supplier_code: 'SUP-B', external_ref: 'EXT-2' },
        ],
      },
    });

    // 1) Business PK collision on Undo
    const pkPatch = usePageStore.getState().deleteRow('t_po', 'r-1')!;
    usePageStore.getState().insertRow('t_po', { order_no: 'PO-1', supplier_code: 'SUP-C', external_ref: 'EXT-9' });
    assert.throws(() => usePageStore.getState().undoDeleteRow(pkPatch), /业务主键/);
    assert.equal(usePageStore.getState().tableRows.t_po.filter((r) => r.order_no === 'PO-1').length, 1);

    // 2) Composite uniqueConstraint collision on Undo
    const compPatch = usePageStore.getState().deleteRow('t_po', 'r-2')!;
    usePageStore.getState().insertRow('t_po', { order_no: 'PO-99', supplier_code: 'SUP-B', external_ref: 'EXT-2' });
    assert.throws(() => usePageStore.getState().undoDeleteRow(compPatch), /uq_sup_ext/);
    assert.equal(usePageStore.getState().tableRows.t_po.some((r) => r.id === 'r-2'), false);

    // [P2 #1] Child row hitting BOTH SET NULL and CASCADE on the same parent order must undo cleanly
    const dualFkTables: DBTableSchema[] = [
      {
        id: 't_orders',
        tableName: 'orders',
        cnName: '订单表',
        domain: '销售',
        description: '订单',
        sharedByMenus: [],
        columns: [
          { id: 'o1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
        ],
      },
      {
        id: 't_lines',
        tableName: 'order_lines',
        cnName: '明细表',
        domain: '销售',
        description: '双外键明细',
        sharedByMenus: [],
        columns: [
          { id: 'l1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          {
            id: 'l2',
            name: 'origin_order_id',
            dataType: 'VARCHAR(64)',
            nullable: true,
            isForeignKey: true,
            references: 'orders(id)',
            foreignKeyOptions: { onDelete: 'SET NULL' },
            comment: '来源单ID',
          },
          {
            id: 'l3',
            name: 'order_id',
            dataType: 'VARCHAR(64)',
            nullable: false,
            isForeignKey: true,
            references: 'orders(id)',
            foreignKeyOptions: { onDelete: 'CASCADE' },
            comment: '当前单ID',
          },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: dualFkTables });
    usePageStore.setState({
      tableRows: {
        t_orders: [{ id: 'ord-1' }],
        t_lines: [{ id: 'line-1', origin_order_id: 'ord-1', order_id: 'ord-1' }],
      },
    });
    const dualPatch = usePageStore.getState().deleteRow('t_orders', 'ord-1')!;
    assert.equal(dualPatch.nullified.length, 0, 'cascaded rows must not also appear in nullified');
    usePageStore.getState().undoDeleteRow(dualPatch);
    assert.deepEqual(usePageStore.getState().tableRows.t_lines, [
      { id: 'line-1', origin_order_id: 'ord-1', order_id: 'ord-1' },
    ]);
  } finally {
    await act(async () => {
      tr?.unmount();
    });
    restore();
  }
});

test('[2nd-Pass P2 #2, #3 & #4] row-scoped acceptance PO transfer, edge-mode params.row preservation, and strict Go/Viewer designTokens parity', async () => {
  const restore = installTestDom();
  let tr: TestRenderer.ReactTestRenderer | undefined;
  let etr: TestRenderer.ReactTestRenderer | undefined;
  try {
    // [P2 #2] Built-in acceptance template (`acceptance-new`) saved inside an existing header's row scope imports PO lines cleanly
    loadProjectFromBinaryPayload(
      createProjectPayload({
        projectId: 'proj-acc-transfer',
        projectName: '验收转入回归',
        templateId: 'customs_erp',
        storageDir: '/tmp/acc-transfer',
        fileName: 'acc.pflow',
        createdAt: '2026-11-25T00:00:00Z',
        updatedAt: '2026-11-25T00:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      }),
    );
    const accTemplateSrc = usePageStore.getState().pageSources['acceptance-new'];
    const existingHeader = usePageStore.getState().getRows('t_wms_acceptance_order')[0]!;
    assert.ok(existingHeader);

    let art!: Runtime;
    await act(async () => {
      tr = TestRenderer.create(
        <ScopeProvider value={{ row: existingHeader, tableId: 't_wms_acceptance_order' }}>
          <RuntimeHost pageId="acceptance-new" source={accTemplateSrc} onRuntime={(r) => { art = r; }} />
        </ScopeProvider>,
        rendererOptions,
      );
    });

    const scopedKey = `field-supplier-select::row:t_wms_acceptance_order:${existingHeader.id}`;
    await act(async () => {
      art.setFormValue(scopedKey, 'acceptance_no', 'ACC-EDITED-999');
    });
    const importOpenBtn = tr!.root.findByProps({ 'data-pf-id': 'btn-import-po' }).findByType('button');
    await act(async () => {
      await importOpenBtn.props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(art.overlays.length, 1, 'PO picker modal should open after saving row-scoped acceptance header');
    const updatedHeader = usePageStore
      .getState()
      .getRows('t_wms_acceptance_order')
      .find((r) => r.id === existingHeader.id)!;
    assert.equal(updatedHeader.acceptance_no, 'ACC-EDITED-999');

    const poLine = usePageStore
      .getState()
      .getRows('t_pms_po_item')
      .find(
        (r) =>
          r.status === 'confirmed' &&
          Number(r.ordered_qty) > Number(r.delivered_qty) &&
          !usePageStore
            .getState()
            .getRows('t_wms_acceptance_detail')
            .some((d) => d.acceptance_order_id === existingHeader.id && d.source_po_item_id === r.id),
      )!;
    assert.ok(poLine);
    const detailCountBefore = usePageStore.getState().getRows('t_wms_acceptance_detail').length;

    await act(async () => {
      art.setSelection('tbl-po-picker', [poLine.id]);
    });
    const doImportBtn = tr!.root.findAll((el) => el.type === 'button').find((b) => collectText(b).includes('转入选中明细'))!;
    await act(async () => {
      await doImportBtn.props.onClick?.({ stopPropagation: () => {} });
    });

    const detailsAfter = usePageStore.getState().getRows('t_wms_acceptance_detail');
    assert.equal(detailsAfter.length, detailCountBefore + 1);
    assert.equal(detailsAfter.at(-1)!.acceptance_order_id, existingHeader.id);
    assert.equal(detailsAfter.at(-1)!.source_po_item_id, poLine.id);
    assert.equal(art.overlays.length, 0);
    await act(async () => {
      tr?.unmount();
      tr = undefined;
    });

    // [P2 #3] In `edge` UI Stack mode, child row action inside Drawer preserves parent `params.row` canonical fields
    const edgeTables: DBTableSchema[] = [
      {
        id: 't_orders',
        tableName: 'orders',
        cnName: '订单表',
        domain: '销售',
        description: '订单',
        sharedByMenus: [],
        columns: [
          { id: 'o1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          { id: 'o2', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '订单标题' },
        ],
      },
      {
        id: 't_lines',
        tableName: 'order_lines',
        cnName: '明细表',
        domain: '销售',
        description: '明细',
        sharedByMenus: [],
        columns: [
          { id: 'l1', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
          {
            id: 'l2',
            name: 'order_id',
            dataType: 'VARCHAR(64)',
            nullable: false,
            isForeignKey: true,
            references: 'orders(id)',
            comment: '所属订单',
          },
          { id: 'l3', name: 'title', dataType: 'VARCHAR(128)', nullable: false, comment: '明细标题' },
        ],
      },
    ];
    useProtoStore.setState({ dbTables: edgeTables, uiState: 'edge' });
    usePageStore.setState({
      tableRows: {
        t_orders: [{ id: 'ord-1', title: 'Parent-Order-Canonical' }],
        t_lines: [{ id: 'line-1', order_id: 'ord-1', title: 'Child-Line-Old' }],
      },
    });
    const edgeDrawerSrc = wrapTsx(`
      <Page pfId="p-edge-drw" title="Edge弹层父子行隔离">
        <Table
          pfId="tbl-parent"
          table="t_orders"
          columns={[{ dataIndex: "title", title: "订单标题" }]}
          rowActions={[{ label: "查看明细抽屉", onClick: () => openDrawer("d-lines") }]}
        />
        <Drawer pfId="drw-lines" id="d-lines" title="订单明细">
          <Card pfId="active-order" activeTable="t_orders">
            <Table
              pfId="tbl-child"
              table="t_lines"
              sourceForeignKey="order_id"
              columns={[{ dataIndex: "title", title: "明细标题" }]}
              rowActions={[{ label: "复制父标题", onClick: () => updateRow({ title: "{{params.row.title}}" }) }]}
            />
          </Card>
        </Drawer>
      </Page>
    `);
    await act(async () => {
      etr = TestRenderer.create(<RuntimeHost pageId="edge-drw-page" source={edgeDrawerSrc} />, rendererOptions);
    });
    const openEdgeDrw = etr!.root.findAll((el) => el.type === 'button').find((b) => collectText(b).includes('查看明细抽屉'))!;
    await act(async () => {
      openEdgeDrw.props.onClick?.({ stopPropagation: () => {} });
    });
    const copyParentBtn = etr!.root.findAll((el) => el.type === 'button').find((b) => collectText(b).includes('复制父标题'))!;
    await act(async () => {
      copyParentBtn.props.onClick?.({ stopPropagation: () => {} });
    });
    assert.equal(
      usePageStore.getState().tableRows.t_lines[0].title,
      'Parent-Order-Canonical',
      'params.row.title in edge mode must resolve canonical parent order title, never child line title or stress text',
    );
    await act(async () => {
      etr?.unmount();
      etr = undefined;
    });

    // [P2 #4] Viewer / normalizePublishedSnapshot rejects `designTokens: null`, wrong-case `Preset`, and V4 `designTokens`
    loadProjectFromBinaryPayload(
      createProjectPayload({
        projectId: 'proj-p2-4-parity',
        projectName: '主题空值与大小写校验',
        templateId: 'blank_project',
        storageDir: '/tmp/p2-4-parity',
        fileName: 'parity.pflow',
        createdAt: '2026-11-25T00:00:00Z',
        updatedAt: '2026-11-25T00:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      }),
    );
    useProtoStore.setState({ dbTables: edgeTables, uiState: 'normal' });
    usePageStore.setState({
      tableRows: {
        t_orders: [{ id: 'ord-1', title: 'Parent-Order-Canonical' }],
        t_lines: [{ id: 'line-1', order_id: 'ord-1', title: 'Child-Line-Old' }],
      },
    });
    const folder = usePageStore.getState().createDesignerFolder('目录', null);
    usePageStore.getState().createDesignerPage(
      { pageId: 'edge-drw-page', title: '测试页', folderId: folder.id },
      edgeDrawerSrc,
    );
    useProtoStore.getState().setDesignTokens({ preset: 'modern_minimal' });
    const validSnap = createPublishedSnapshot('edge-drw-page');

    const { designTokens, ...withoutTokens } = validSnap;
    assert.throws(() => normalizePublishedSnapshot({ ...withoutTokens, DesignTokens: designTokens }), /DesignTokens/);
    assert.throws(() => normalizePublishedSnapshot({ ...validSnap, designTokens: null }));
    assert.throws(() => normalizePublishedSnapshot({ ...validSnap, designTokens: { Preset: 'modern_minimal' } }));
    assert.throws(() =>
      normalizePublishedSnapshot({
        ...validSnap,
        formatVersion: 4,
        notes: [],
        noteAssets: {},
      }),
    );
  } finally {
    await act(async () => {
      tr?.unmount();
      etr?.unmount();
    });
    restore();
  }
});

function reviewTable(id: string, columns: DBTableSchema['columns'] = []): DBTableSchema {
  return {
    id, tableName: id, cnName: id, description: id, domain: '订单', sharedByMenus: [],
    columns: [{ id: 'id', name: 'id', comment: 'ID', nullable: false, dataType: 'VARCHAR(64)', isPrimaryKey: true }, ...columns],
  };
}

test('切换订单后用当前可见草稿验证必填项并保存明细', async () => {
  const restore = installTestDom();
  let view: TestRenderer.ReactTestRenderer | undefined;
  try {
    const tables = [
      reviewTable('orders'),
      reviewTable('lines', [
        { id: 'title', name: 'title', comment: '标题', dataType: 'VARCHAR(50)', nullable: false },
        { id: 'order_id', name: 'order_id', comment: '订单', dataType: 'VARCHAR(64)', nullable: false, isForeignKey: true, references: 'orders(id)' },
      ]),
    ];
    useProtoStore.setState({ dbTables: tables });
    usePageStore.setState({ tableRows: { orders: [{ id: 'B' }], lines: [] } });
    const source = wrapTsx(`<Page pfId="p">
      <Table pfId="orders-list" table="orders" onRowClick={() => selectRow()} />
      <Card pfId="detail" activeTable="orders"><Form pfId="line" table="lines">
        <Input pfId="title" name="title" required={true} />
        <Input pfId="owner" name="order_id" initialValue="{{row.id}}" />
        <Button pfId="save" onClick={() => submitForm("line")}>保存明细</Button>
      </Form></Card></Page>`);
    let rt!: Runtime;
    await act(async () => { view = TestRenderer.create(<RuntimeHost pageId="p" source={source} onRuntime={r => { rt = r; }} />, rendererOptions); });
    const title = () => view!.root.findByProps({ 'data-pf-id': 'title' }).findByType('input');
    const save = () => view!.root.findByProps({ 'data-pf-id': 'save' }).findByType('button').props.onClick({});
    await act(async () => { title().props.onChange({ target: { value: '未指定订单' } }); });
    await act(async () => { view!.root.findByProps({ 'data-row-id': 'B' }).props.onClick({}); });
    assert.equal(title().props.value, '');
    await act(async () => { save(); });
    assert.ok(rt.formErrors['line::row:orders:B'].title);
    assert.deepEqual(usePageStore.getState().tableRows.lines, []);
    await act(async () => { title().props.onChange({ target: { value: '订单 B 明细' } }); });
    await act(async () => { save(); });
    assert.deepEqual(usePageStore.getState().tableRows.lines.map(({ title, order_id }) => [title, order_id]), [['订单 B 明细', 'B']]);
  } finally {
    await act(async () => { view?.unmount(); });
    restore();
  }
});

test('采购明细转入使用选单对应的已保存验收单', async () => {
  const restore = installTestDom();
  let view: TestRenderer.ReactTestRenderer | undefined;
  try {
    loadProjectFromBinaryPayload(createProjectPayload({ ...initialProto.currentProjectMeta, templateId: 'customs_erp' }));
    const pages = usePageStore.getState();
    const fields = { acceptance_no: 'B', acceptance_date: '2026-10-30', inbound_type: '购买', source_type: '采购订单转入',
      supplier_id: 'SUP-01', total_amount_tax_included: 0, status: '草稿' };
    const b = pages.insertRow('t_wms_acceptance_order', fields);
    const po = pages.getRows('t_pms_po_item').find(r => r.status === 'confirmed' && Number(r.ordered_qty) > Number(r.delivered_qty))!;
    const source = wrapTsx(`<Page pfId="p">
      <Form pfId="header" table="t_wms_acceptance_order"><Input pfId="number" name="acceptance_no" /></Form>
      <Button pfId="save" onClick={() => submitForm("header")}>保存</Button>
      <Table pfId="headers" table="t_wms_acceptance_order" onRowClick={() => openModal("lookup")} />
      <Table pfId="items" table="t_wms_acceptance_detail" />
      <Modal pfId="dialog" id="lookup"><Table pfId="po" table="t_pms_po_item" selectable={true} />
        <Button pfId="import" onClick={() => importPurchaseOrderLines("po","items","header")}>转入</Button>
      </Modal></Page>`);
    let rt!: Runtime;
    await act(async () => { view = TestRenderer.create(<RuntimeHost pageId="p" source={source} onRuntime={r => { rt = r; }} />, rendererOptions); });
    const click = (id: string) => view!.root.findByProps({ 'data-pf-id': id }).findByType('button').props.onClick({});
    const open = (id: string) => view!.root.findByProps({ 'data-row-id': id }).props.onClick({});
    await act(async () => { rt.setFormValues('header', { ...fields, acceptance_no: 'A' }); });
    await act(async () => { click('save'); });
    const a = pages.getRows('t_wms_acceptance_order').find(r => r.acceptance_no === 'A')!;
    const before = pages.getRows('t_wms_acceptance_detail');
    await act(async () => { open(b.id); });
    await act(async () => { rt.setSelection('po', [po.id]); });
    await act(async () => { click('import'); });
    assert.equal(rt.toasts.at(-1)?.type, 'error');
    assert.deepEqual(pages.getRows('t_wms_acceptance_detail'), before);
    await act(async () => { rt.closeOverlay(); });
    await act(async () => { open(a.id); });
    await act(async () => { click('import'); });
    const after = pages.getRows('t_wms_acceptance_detail');
    assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1)?.acceptance_order_id, a.id);
    assert.equal(after.at(-1)?.source_po_item_id, po.id);
  } finally {
    await act(async () => { view?.unmount(); });
    restore();
  }
});

test('删除在任何外键列顺序下都保留仍受 RESTRICT 引用的明细', () => {
  const fk = (name: string, references: string, onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT') => ({
    id: name, name, comment: name, dataType: 'VARCHAR(64)', nullable: onDelete === 'SET NULL',
    isForeignKey: true, references, foreignKeyOptions: { onDelete },
  });
  const origin = { ...fk('origin', 'orders(id)', 'SET NULL'), isUnique: true };
  const owner = fk('owner', 'orders(id)', 'CASCADE');
  const tables = [reviewTable('orders'), reviewTable('lines'), reviewTable('deliveries', [fk('source', 'lines(origin)', 'RESTRICT')])];
  const rows = { orders: [{ id: 'B' }], lines: [{ id: 'L', origin: 'B', owner: 'B' }], deliveries: [{ id: 'D', source: 'B' }] };
  for (const columns of [[origin, owner], [owner, origin], [origin]]) {
    useProtoStore.setState({ dbTables: [tables[0], reviewTable('lines', columns), tables[2]] });
    usePageStore.setState({ tableRows: structuredClone(rows) });
    assert.throws(() => usePageStore.getState().deleteRow('orders', 'B'), /引用/);
    assert.deepEqual(usePageStore.getState().tableRows, rows);
  }
  const deliveries = reviewTable('deliveries', [fk('source', 'lines(origin)', 'CASCADE')]);
  useProtoStore.setState({ dbTables: [tables[0], reviewTable('lines', [origin, owner]), deliveries] });
  const patch = usePageStore.getState().deleteRow('orders', 'B')!;
  assert.deepEqual(usePageStore.getState().tableRows, { orders: [], lines: [], deliveries: [] });
  usePageStore.getState().undoDeleteRow(patch);
  assert.deepEqual(usePageStore.getState().tableRows, rows);
});

test('撤销按 SQL 数值比较业务主键、单列唯一键和联合唯一键', () => {
  for (const kind of ['primary', 'unique', 'composite']) {
    const table = reviewTable('prices', [
      { id: 'rank', name: 'rank', dataType: 'DECIMAL(30,10)', nullable: false, comment: '序号',
        isPrimaryKey: kind === 'primary', isUnique: kind === 'unique' },
      { id: 'group', name: 'group_code', dataType: 'VARCHAR(10)', nullable: false, comment: '分组' },
    ]);
    table.columns[0].isPrimaryKey = false;
    if (kind === 'composite') table.uniqueConstraints = [{ name: 'uq_group_rank', columnIds: ['group', 'rank'] }];
    useProtoStore.setState({ dbTables: [table] });
    for (const [oldValue, newValue] of [['001.00', 1], ['0.0000001', 1e-7], ['9007199254740993.0', '9007199254740993']] as const) {
      usePageStore.setState({ tableRows: { prices: [{ id: 'old', rank: oldValue, group_code: 'A' }] } });
      const store = usePageStore.getState();
      const patch = store.deleteRow('prices', 'old')!;
      store.insertRow('prices', { rank: newValue, group_code: 'A' });
      const before = store.getRows('prices');
      assert.throws(() => store.undoDeleteRow(patch), /占用/);
      assert.deepEqual(store.getRows('prices'), before);
    }
  }
});

test('桌面和移动看板只允许推进到字段契约声明的状态', async () => {
  const restore = installTestDom();
  let view: TestRenderer.ReactTestRenderer | undefined;
  try {
    useProtoStore.setState({ dbTables: [reviewTable('orders', [
      { id: 'status', name: 'order_status', dataType: 'VARCHAR(20)', nullable: false, comment: '状态: pending/approved' },
    ])] });
    for (const mobile of [false, true]) {
      const page = mobile ? 'MobilePage' : 'Page';
      const board = mobile ? 'MKanban' : 'Kanban';
      for (const invalidConfig of [true, false]) {
        usePageStore.setState({ tableRows: { orders: [{ id: 'A', order_status: 'pending' }, { id: 'B', order_status: 'legacy' }] } });
        const source = wrapTsx(`<${page} pfId="p"><${board} pfId="board" table="orders" ${invalidConfig ? 'lanes={["pending","other"]}' : ''}/></${page}>`);
        await act(async () => { view = TestRenderer.create(<RuntimeHost pageId="p" source={source} isMobile={mobile} />, rendererOptions); });
        const laneButton = (lane: string, target: string) => view!.root.findByProps({ 'data-kanban-lane': lane })
          .findAllByType('button').find(b => String(b.props['aria-label'] ?? collectText(b)).includes(target));
        if (invalidConfig) {
          assert.equal(laneButton('pending', 'other'), undefined);
          assert.equal(usePageStore.getState().getRows('orders')[0].order_status, 'pending');
        } else {
          const advance = laneButton('pending', 'approved');
          assert.ok(advance);
          await act(async () => { advance.props.onClick(); });
          assert.equal(usePageStore.getState().getRows('orders')[0].order_status, 'approved');
          assert.equal(laneButton('approved', 'legacy'), undefined);
        }
        await act(async () => { view?.unmount(); view = undefined; });
      }
    }
  } finally {
    await act(async () => { view?.unmount(); });
    restore();
  }
});
