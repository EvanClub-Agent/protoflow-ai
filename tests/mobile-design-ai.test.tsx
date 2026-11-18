import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { findNode, setProp } from '../src/proto/dsl/tree';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { inspectPage } from '../src/proto/ai/pageInspection';
import { generateFromTemplate, MOBILE_PAGE_TEMPLATES } from '../src/proto/ai/templates';
import { validateMaterialDoc, validateMaterialSource } from '../src/proto/registry/materialContract';
import { NodeInspectorPanel } from '../src/proto/designer/NodeInspectorPanel';
import { ActionChainEditor } from '../src/proto/designer/ActionChainEditor';
import { NodeView } from '../src/proto/renderer/NodeView';
import { RuntimeProvider, useRuntimeController } from '../src/proto/runtime/runtime';
import { createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { projectContext, prepareProjectChanges } from '../src/services/hermesProject';
import { planMenuOperations } from '../src/services/projectPlanMenus';
import { type ProjectPlan } from '../src/services/projectPlan';
import type { ProjectMode } from '../src/proto/mobile/types';
import type { ProtoNode } from '../src/proto/types';

const { callTool, atomicWrite } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const folderId = 'fld-mobile-app';
const page = { pageId: 'overview', title: '事项速览', folderId, requirements: '展示事项' };
const plan: ProjectPlan = { summary: '事项', approved: true, folders: [], generatedPageIds: [], pages: [page] };
const desktop = 'export default function Page(){return <Page pfId="project-root" title="事项速览"/>}';
const mobile = (body: string) => `export default function Page(){return <MobilePage pfId="root">${body}</MobilePage>}`;
const patch = (pageId: string, source: string) => ({tool: 'protoflow_apply_tsx_patch', args: {pageId, source, title: page.title, folderId}});
function fixture(projectMode: ProjectMode = 'mobile') {
  const payload = createProjectPayload({ projectId: 'mobile-review', projectName: '移动测试', projectMode, templateId: 'mobile_starter',
    storageDir: '/tmp', fileName: 'review.pflow', createdAt: '2026-11-10', updatedAt: '2026-11-10', pageCount: 0, stickyCount: 0, tableCount: 0 });
  loadProjectFromBinaryPayload(payload);
  return payload;
}

test('a mobile plan scaffolds, resumes a legacy empty scaffold and rejects desktop model output in both gates', () => {
  const base = fixture(), state = base.stateSnapshot;
  const wrongPlan = { tool: 'protoflow_set_project_plan', args: { plan: {...plan, pages: [{...page, platform:'desktop'}]} } };
  assert.throws(() => prepareProjectChanges(base, [wrongPlan]), /项目默认平台 mobile/);
  const chosen = prepareProjectChanges(base, [wrongPlan], undefined, undefined, false, [], {pageId:page.pageId, platform:'desktop'});
  assert.equal(chosen.next.stateSnapshot.projectPlan!.pages[0].platform, 'desktop');
  state.projectPlan = plan;
  assert.equal(projectContext().projectMode, 'mobile');
  const [op] = planMenuOperations(state, plan, undefined, base.meta.projectMode);
  const staged = prepareProjectChanges(base, [op]).next;
  assert.equal(staged.stateSnapshot.designerPages.find(p => p.pageId === page.pageId)?.platform, 'mobile');
  assert.equal(parsePageSource(staged.stateSnapshot.pageSources.overview).doc?.root.type, 'MobilePage');
  assert.throws(() => prepareProjectChanges(staged, [patch('overview', desktop)]), /MobilePage/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-mobile-contract-'));
  try {
    const file = path.join(dir, 'context.json');
    atomicWrite(file, {active: true, runId: 'mobile-turn', operations: [], snapshot: {...projectContext(), projectPlan: plan}});
    assert.throws(() => callTool(file, 'protoflow_apply_tsx_patch', patch('overview', desktop).args), /MobilePage/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).operations, []);
    callTool(file, op.tool, op.args);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  state.pageSources.overview = desktop;
  state.designerPages.push({pageId: 'overview', folderId, title: page.title});
  const repaired = prepareProjectChanges(base, planMenuOperations(state, plan, undefined, 'mobile')).next;
  assert.equal(parsePageSource(repaired.stateSnapshot.pageSources.overview).doc?.root.type, 'MobilePage');
  state.pageSources.overview = desktop.replace('/>', '><Text pfId="keep">保留内容</Text></Page>');
  assert.deepEqual(planMenuOperations(state, plan, undefined, 'mobile'), []);
});

test('mixed plans use explicit platforms and preserve a new-page dialog selection through review and replay', () => {
  const base = fixture('hybrid');
  const setPlan = (pages: ProjectPlan['pages']) => ({tool: 'protoflow_set_project_plan', args: {plan: {...plan, pages}}});
  assert.throws(() => prepareProjectChanges(base, [setPlan([page])]), /指定 platform/);
  const request = {pageId: page.pageId, platform: 'mobile' as const};
  const other = {...page, pageId: 'desktop-report', title: 'PC 报表', platform: 'desktop' as const};
  const reviewed = prepareProjectChanges(base, [setPlan([page, other])], undefined, undefined, true, [], request).next;
  assert.deepEqual(reviewed.stateSnapshot.projectPlan!.pages.map(p => p.platform), ['mobile', 'desktop']);
  const creates = planMenuOperations(reviewed.stateSnapshot, reviewed.stateSnapshot.projectPlan!, undefined, 'hybrid');
  const next = prepareProjectChanges(reviewed, creates).next.stateSnapshot;
  assert.equal(parsePageSource(next.pageSources.overview).doc?.root.type, 'MobilePage');
  assert.equal(parsePageSource(next.pageSources['desktop-report']).doc?.root.type, 'Page');
  assert.throws(() => prepareProjectChanges(base, [setPlan([{...page, platform:'desktop'}])], undefined, undefined, true, [], request), /用户选择/);
  assert.throws(() => prepareProjectChanges(base, [patch('wrong', desktop)], undefined, undefined, false, [], request), /未提交请求/);
});

test('selected mobile controls can add root overlays without editing siblings and page inspection retains task row actions', () => {
  const base = fixture(), state = base.stateSnapshot;
  const original = state.pageSources['mob-tasks'];
  const report = inspectPage(original, state.dbTables, state.tableRows);
  assert.deepEqual(report.interactions.filter(i => i.pfId === 'task-list-main' && i.path.startsWith('rowActions')).map(i => i.calls[0].args[0]), [{status:'已驳回'},{status:'已完成'}]);
  const grid = inspectPage(state.pageSources['mob-assistant'], state.dbTables, state.tableRows);
  assert.ok(grid.interactions.some(i => i.path === 'items[0].onClick' && i.calls.some(call => call.name === 'navigate')));
  for (const [kind, action] of [['MBottomSheet','openDrawer'], ['MDialog','openModal']]) {
    const source = original.replace("openDrawer('sheet-task-detail')", `${action}('new-help')`).replace('</MobilePage>', `<${kind} pfId="help" id="new-help" title="说明"/></MobilePage>`);
    const scope = {pageId:'mob-tasks', selectedPfId:'task-list-main'};
    const changed = prepareProjectChanges(base, [patch(scope.pageId, source)], scope).next.stateSnapshot;
    assert.equal(findNode(parsePageSource(changed.pageSources[scope.pageId]).doc!.root, 'help')?.type, kind);
    assert.deepEqual(changed.tableRows, state.tableRows);
    assert.throws(() => prepareProjectChanges(base, [patch(scope.pageId, source.replace('</MobilePage>', '<MButton pfId="unrelated">无关按钮</MButton></MobilePage>'))], scope), /选中范围外/);
  }
});

test('inspector offers only eligible lists and fields; event editor selects mobile sheets or dialogs and binds a newly created sheet atomically', () => {
  fixture();
  const doc = parsePageSource(mobile('<MSearchPill pfId="search" target="tasks"/><MPillTabs pfId="filter" target="tasks" filterField="status"/><MTaskList pfId="tasks" table="t_mob_tasks"/><MFeedList pfId="feed"/><MButton pfId="button">帮助</MButton><MDialog pfId="dialog" id="dialog-id" title="确认"/><MBottomSheet pfId="sheet" id="sheet-id" title="说明"/>')).doc!;
  const noop = () => {};
  for (const id of ['search','filter']) {
    const selectedNode = findNode(doc.root, id)!;
    let ui!: TestRenderer.ReactTestRenderer;
    try {
      act(() => { ui = TestRenderer.create(<NodeInspectorPanel pageId="review" doc={doc} selectedNode={selectedNode} overlays={[]} onSelectNode={noop} onPropChange={noop} onTextChange={noop} onMoveNode={noop} onDuplicateNode={noop} onRemoveNode={noop} onOpenOverlayDesigner={noop} onCreateOverlay={noop} onRunAiPrompt={noop} />); });
      const selectors = ui.root.findAllByType('select');
      const list = selectors.find(s => s.props.value === 'tasks')!;
      assert.deepEqual(list.findAllByType('option').map(o => o.props.value), ['', 'tasks','feed']);
      if (id === 'filter') assert.ok(selectors.find(s => s.props.value === 'status')!.findAllByType('option').some(o => o.props.value === 'owner_dept'));
    } finally { act(() => ui?.unmount()); }
  }
  const overlays = ['dialog','sheet'].map(id => {
    const node = findNode(doc.root, id) as ProtoNode;
    return {node, type:node.type, pfId:node.pfId, overlayId:String(node.props.id), title:String(node.props.title)};
  });
  for (const [name, target] of [['openDrawer','sheet-id'], ['openModal','dialog-id']]) {
    let ui!: TestRenderer.ReactTestRenderer, writes = 0, creations = 0;
    const value = {$kind:'actions' as const, calls:[{name, args:[target,{mode:'read'}]}]};
    try {
      act(() => { ui = TestRenderer.create(<ActionChainEditor label="点击" eventName="onClick" value={value} overlays={overlays} onChange={() => writes++}
        onCreateOverlayAndBind={(_type,id,_title,chain) => { creations++; assert.deepEqual(chain.calls[0].args,[id,{mode:'read'}]); }} />); });
      const selector = ui.root.findAllByType('select').find(s => s.props.value === target)!;
      assert.deepEqual(selector.findAllByType('option').map(o => o.props.value), ['',target]);
      act(() => ui.root.findByProps({ title:'自动新建对应的弹层子页面并绑定到此按钮' }).props.onClick());
      assert.equal(creations,1); assert.equal(writes,0);
    } finally { act(() => ui?.unmount()); }
  }
});

test('inspector preserves structured itemFields lists, resolves MSheetPicker dual-table columns, and manages MPillTabs/MTaskList controls', () => {
  const base = fixture();
  const noop = () => {};
  const textOf = (inst: TestRenderer.ReactTestInstance): string =>
    inst.children
      .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : textOf(c)))
      .join('');

  // 1. Structured object-array list props must never coerce items to "[object Object]"
  let bentoDoc = parsePageSource(
    mobile(
      `<MBentoGrid pfId="bento" items={[{ title: '精选服务', tone: 'violet' }]} />` +
      `<MTaskList pfId="tasks" table="t_mob_tasks" fields={[{ dataIndex: 'owner_dept', title: '部门' }]} rowActions={[{ label: '审批', primary: true }]} />` +
      `<MTabBar pfId="tabbar" items={[{ key: 'home', title: '首页' }]} />` +
      `<MChatStream pfId="chat" messages={[{ role: 'user', title: '你好' }]} />` +
      `<MPillTabs pfId="pills"><MTab pfId="t1" title="全部" /></MPillTabs>`
    )
  ).doc!;

  for (const [pfId, propName, editedTitle] of [
    ['bento', 'items', 'AI 智能精选'],
    ['tabbar', 'items', '工作台'],
    ['chat', 'messages', '帮我汇总今日事项'],
  ] as const) {
    let latestValue: unknown;
    let ui!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        ui = TestRenderer.create(
          <NodeInspectorPanel
            pageId="review"
            doc={bentoDoc}
            selectedNode={findNode(bentoDoc.root, pfId)!}
            overlays={[]}
            onSelectNode={noop}
            onPropChange={(_id, key, val) => {
              if (key === propName) latestValue = val;
            }}
            onTextChange={noop}
            onMoveNode={noop}
            onDuplicateNode={noop}
            onRemoveNode={noop}
            onOpenOverlayDesigner={noop}
            onCreateOverlay={noop}
            onRunAiPrompt={noop}
          />
        );
      });
      const titleInput = ui.root.findByProps({ 'aria-label': `${propName}[0].title` });
      act(() => titleInput.props.onChange({ target: { value: editedTitle } }));
      assert.ok(Array.isArray(latestValue));
      assert.equal(typeof latestValue[0], 'object');
      assert.equal((latestValue[0] as Record<string, unknown>).title, editedTitle);
      const updatedDoc = setProp(bentoDoc, pfId, propName, latestValue as never);
      assert.deepEqual(validateMaterialDoc(updatedDoc), []);
      assert.ok(!printPageSource(updatedDoc).includes('[object Object]'));
    } finally {
      act(() => ui?.unmount());
    }
  }

  // 2. Adding a field in MTaskList picks an unused bound table column and toggles rowActions.primary
  {
    let nextFields: unknown;
    let nextRowActions: unknown;
    let ui!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        ui = TestRenderer.create(
          <NodeInspectorPanel
            pageId="review"
            doc={bentoDoc}
            selectedNode={findNode(bentoDoc.root, 'tasks')!}
            overlays={[]}
            onSelectNode={noop}
            onPropChange={(_id, key, val) => {
              if (key === 'fields') nextFields = val;
              if (key === 'rowActions') nextRowActions = val;
            }}
            onTextChange={noop}
            onMoveNode={noop}
            onDuplicateNode={noop}
            onRemoveNode={noop}
            onOpenOverlayDesigner={noop}
            onCreateOverlay={noop}
            onRunAiPrompt={noop}
          />
        );
      });
      const addBtn = ui.root
        .findAllByType('button')
        .find((b) => b.findAllByType('span').some((s) => s.children.includes('新增项')))!;
      act(() => addBtn.props.onClick());
      assert.ok(Array.isArray(nextFields) && nextFields.length === 2);
      const updatedDoc = setProp(bentoDoc, 'tasks', 'fields', nextFields as never);
      assert.deepEqual(pageContractErrors(printPageSource(updatedDoc), base.stateSnapshot.dbTables), []);

      // Switch to events tab and verify primary toggle on MTaskList rowActions
      const eventsTabBtn = ui.root
        .findAllByType('button')
        .find((b) => textOf(b).includes('交互'));
      assert.ok(eventsTabBtn, 'Inspector should expose events tab button');
      act(() => eventsTabBtn.props.onClick());
      const primaryCheckbox = ui.root
        .findAllByType('input')
        .find((inp) => inp.props.type === 'checkbox' && inp.props.checked === true);
      assert.ok(primaryCheckbox, 'MTaskList rowActions should expose checked primary toggle');
      act(() => primaryCheckbox.props.onChange({ target: { checked: false } }));
      assert.equal((nextRowActions as Record<string, unknown>[])[0].primary, false);
    } finally {
      act(() => ui?.unmount());
    }
  }

  // 3. MPillTabs quick child manager inserts valid MTab
  {
    let committedDoc = bentoDoc;
    let ui!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        ui = TestRenderer.create(
          <NodeInspectorPanel
            pageId="review"
            doc={bentoDoc}
            selectedNode={findNode(bentoDoc.root, 'pills')!}
            overlays={[]}
            onSelectNode={noop}
            onPropChange={noop}
            onCommitDoc={(next) => {
              committedDoc = next;
            }}
            onTextChange={noop}
            onMoveNode={noop}
            onDuplicateNode={noop}
            onRemoveNode={noop}
            onOpenOverlayDesigner={noop}
            onCreateOverlay={noop}
            onRunAiPrompt={noop}
          />
        );
      });
      const addPillBtn = ui.root
        .findAllByType('button')
        .find((b) => b.findAllByType('span').some((s) => String(s.children.join('')).includes('新增胶囊 (MTab)')))!;
      act(() => addPillBtn.props.onClick());
      const pillsNode = findNode(committedDoc.root, 'pills')!;
      assert.equal(pillsNode.children.length, 2);
      assert.deepEqual(validateMaterialDoc(committedDoc), []);
    } finally {
      act(() => ui?.unmount());
    }
  }

  // 4. MSheetPicker resolves `name` from ancestor MForm.table and `labelField`/`valueField` from own picker `table`
  {
    const pickerDoc = parsePageSource(
      mobile(
        `<MForm pfId="form" table="t_mob_tasks">` +
          `<MSheetPicker pfId="picker" label="关联推荐项" name="owner_dept" table="t_mob_catalog" labelField="item_name" valueField="id" />` +
        `</MForm>`
      )
    ).doc!;
    const changes: Array<[string, unknown]> = [];
    let ui!: TestRenderer.ReactTestRenderer;
    try {
      act(() => {
        ui = TestRenderer.create(
          <NodeInspectorPanel
            pageId="review"
            doc={pickerDoc}
            selectedNode={findNode(pickerDoc.root, 'picker')!}
            overlays={[]}
            onSelectNode={noop}
            onPropChange={(_id, key, val) => changes.push([key, val])}
            onTextChange={noop}
            onMoveNode={noop}
            onDuplicateNode={noop}
            onRemoveNode={noop}
            onOpenOverlayDesigner={noop}
            onCreateOverlay={noop}
            onRunAiPrompt={noop}
          />
        );
      });
      const selects = ui.root.findAllByType('select');
      const nameSelect = selects.find((s) => s.props.value === 'owner_dept')!;
      const labelFieldSelect = selects.find((s) => s.props.value === 'item_name')!;
      const valueFieldSelect = selects.find((s) => s.props.value === 'id')!;
      assert.ok(nameSelect.findAllByType('option').some((o) => o.props.value === 'task_title'));
      assert.ok(!nameSelect.findAllByType('option').some((o) => o.props.value === 'price_text'));
      assert.ok(labelFieldSelect.findAllByType('option').some((o) => o.props.value === 'price_text'));
      assert.ok(valueFieldSelect.findAllByType('option').some((o) => o.props.value === 'tag'));
      act(() => labelFieldSelect.props.onChange({ target: { value: 'subtitle' } }));
      assert.deepEqual(changes, [['labelField', 'subtitle']]);
    } finally {
      act(() => ui?.unmount());
    }
  }
});

test('mobile runtime components format MTaskList fields, sync/validate MMediaInput, respect readOnly MSheetPicker, and keep MTabBar active state accurate', async () => {
  fixture();
  const textOf = (inst: TestRenderer.ReactTestInstance): string =>
    inst.children
      .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : textOf(c)))
      .join('');
  const doc = parsePageSource(
    mobile(
      `<MSearchPill pfId="search" target="demo-tasks" />` +
      `<MTaskList pfId="unbound-tasks" table="t_mob_tasks" fields={[{ dataIndex: 'budget_amount', title: '预算', render: 'money' }, { dataIndex: 'status', title: '状态', render: 'tag' }]} />` +
      `<MTaskList pfId="demo-tasks" rowActions={[{ label: '查看单据', primary: true, onClick: () => openDrawer('sheet-detail') }]} />` +
      `<MForm pfId="mform">` +
        `<MMediaInput pfId="qty" label="数量" name="qty" variant="stepper" min={2} max={5} onChange={() => toast('数量变更', 'info')} />` +
        `<MMediaInput pfId="urgent" label="加急" name="urgent" variant="switch" />` +
        `<MMediaInput pfId="code" label="条码" name="code" variant="scan" required={true} onChange={() => toast('扫码变更', 'info')} />` +
        `<MSheetPicker pfId="ro-picker" label="只读部门" name="dept" options="采购部,财务部" readOnly={true} />` +
      `</MForm>` +
      `<MTabBar pfId="nav" activeKey="tasks" items={[{ key: 'tasks', title: '事项' }, { key: 'quick', title: '快建', onClick: () => openDrawer('sheet-detail') }]} />` +
      `<MBottomSheet pfId="sheet" id="sheet-detail" title="详情" />`
    )
  ).doc!;

  let capturedRt!: ReturnType<typeof useRuntimeController>;
  function Harness({ currentDoc }: { currentDoc: typeof doc }) {
    const rt = useRuntimeController(currentDoc, 'mob-runtime-test', false);
    capturedRt = rt;
    return (
      <RuntimeProvider value={rt}>
        <NodeView node={currentDoc.root} live />
      </RuntimeProvider>
    );
  }

  let ui!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      ui = TestRenderer.create(<Harness currentDoc={doc} />);
    });

    // 0. MTaskList money formatting (¥) renders on bound rows
    assert.ok(textOf(ui.root).includes('¥'), 'MTaskList render="money" must format currency with ¥');

    // 1. MMediaInput initial defaults (`stepper` -> min=2, `switch` -> true) synced into formValues
    assert.equal(capturedRt.formValues['mform']?.qty, 2);
    assert.equal(capturedRt.formValues['mform']?.urgent, true);

    // 2. Stepper '+' dispatches onChange and updates formValues
    const incBtn = ui.root.findByProps({ 'aria-label': '增加数量' });
    await act(async () => {
      incBtn.props.onClick();
    });
    assert.equal(capturedRt.formValues['mform']?.qty, 3);
    assert.ok(capturedRt.toasts.some((t) => t.message === '数量变更' && t.type === 'info'));

    // 3. Submitting with empty required MMediaInput (`scan`) sets field validation error (`role="alert"`)
    await act(async () => {
      await capturedRt.run({ $kind: 'actions', calls: [{ name: 'submitForm', args: ['mform'] }] }, {});
    });
    const alerts = ui.root.findAll((el) => el.props?.role === 'alert');
    assert.ok(alerts.some((a) => textOf(a).includes('请填写条码')));

    // 4. MSheetPicker with readOnly=true never opens a dialog
    const roBtn = ui.root.findAllByType('button').find((b) => b.props.disabled === true && textOf(b).includes('点击选择'));
    assert.ok(roBtn, 'readOnly MSheetPicker button must be disabled');

    // 5. Unbound MTaskList passes demo row into rowActions and shows empty state when filtered out
    const rowActionBtn = ui.root.findAllByType('button').find((b) => textOf(b).includes('查看单据'))!;
    await act(async () => {
      rowActionBtn.props.onClick({ stopPropagation: () => {} });
    });
    assert.equal(capturedRt.overlays.length, 1);
    assert.ok((capturedRt.overlays[0].params.row as Record<string, unknown>)?.title);

    await act(async () => {
      capturedRt.setFilter('demo-tasks', { __q: '不存在的单据关键字_xyz' });
    });
    assert.ok(textOf(ui.root).includes('当前筛选下暂无业务单据'));

    // 6. MTabBar action-only item triggers overlay without stealing active tab highlight; updating activeKey syncs highlight
    const quickTab = ui.root.findAllByType('button').find((b) => textOf(b).includes('快建'))!;
    const tasksTab = ui.root.findAllByType('button').find((b) => textOf(b).includes('事项'))!;
    await act(async () => {
      quickTab.props.onClick();
    });
    assert.equal(tasksTab.props['aria-current'], 'page');

    const switchedDoc = setProp(doc, 'nav', 'activeKey', 'quick');
    await act(async () => {
      ui.update(<Harness currentDoc={switchedDoc} />);
    });
    const updatedQuickTab = ui.root.findAllByType('button').find((b) => textOf(b).includes('快建'))!;
    assert.equal(updatedQuickTab.props['aria-current'], 'page');
  } finally {
    await act(async () => {
      ui?.unmount();
    });
  }
});

test('AI contract validates MPillTabs.filterField, inspectPage warns on mobile demo/no-op controls, and mobile templates emit valid FK/date MSheetPickers', () => {
  const base = fixture();
  const tables = [
    ...base.stateSnapshot.dbTables,
    {
      id: 't_dept',
      tableName: 'sys_dept',
      cnName: '部门表',
      columns: [
        { id: 'c_dept_id', name: 'id', dataType: 'INT', nullable: false, isPrimaryKey: true, comment: '部门ID' },
        { id: 'c_dept_name', name: 'dept_name', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: false, comment: '部门名称' },
      ],
    },
    {
      id: 't_leave',
      tableName: 'biz_leave',
      cnName: '请假单',
      columns: [
        { id: 'c_lv_id', name: 'id', dataType: 'INT', nullable: false, isPrimaryKey: true, comment: '主键' },
        { id: 'c_lv_title', name: 'leave_title', dataType: 'VARCHAR(100)', nullable: false, isPrimaryKey: false, comment: '事由标题' },
        { id: 'c_lv_dept', name: 'dept_id', dataType: 'INT', nullable: false, isPrimaryKey: false, isForeignKey: true, references: 'sys_dept(id)', comment: '所属部门' },
        { id: 'c_lv_date', name: 'start_date', dataType: 'DATE', nullable: false, isPrimaryKey: false, comment: '开始日期' },
        { id: 'c_lv_days', name: 'days', dataType: 'DECIMAL(5,1)', nullable: false, isPrimaryKey: false, comment: '天数' },
      ],
    },
  ];

  // 1. MPillTabs.filterField contract check
  const badFilterSrc = mobile(
    `<MPillTabs pfId="tabs" target="list" filterField="missing_col"><MTab pfId="t1" title="全部" /></MPillTabs>` +
    `<MTaskList pfId="list" table="t_mob_tasks" />`
  );
  assert.ok(pageContractErrors(badFilterSrc, tables).some((e) => e.includes('tabs:未知字段 t_mob_tasks.missing_col')));
  const goodFilterSrc = badFilterSrc.replace('missing_col', 'status');
  assert.deepEqual(pageContractErrors(goodFilterSrc, tables), []);

  // 2. inspectPage warnings on MMediaInput (image/scan), actionless MButton, and actionless MBottomDock
  const warnSrc = mobile(
    `<MForm pfId="f"><MMediaInput pfId="cam" label="照片" name="photo" variant="image" /></MForm>` +
    `<MButton pfId="noop-btn">无动作按钮</MButton>` +
    `<MBottomDock pfId="noop-dock" primaryText="提交" />`
  );
  const inspected = inspectPage(warnSrc, tables, base.stateSnapshot.tableRows);
  assert.ok(inspected.warnings.some((w) => w.pfId === 'cam' && w.code === 'upload-demo-only'));
  assert.ok(inspected.warnings.some((w) => w.pfId === 'noop-btn' && w.code === 'button-no-action'));
  assert.ok(inspected.warnings.some((w) => w.pfId === 'noop-dock' && w.code === 'button-no-action'));

  // 3. Every mobile template produces contract-clean TSX and emits FK/date MSheetPicker controls
  const leaveTable = tables.find((t) => t.id === 't_leave')!;
  for (const tpl of MOBILE_PAGE_TEMPLATES) {
    const src = generateFromTemplate(tpl.kind, leaveTable, tables, {
      pageId: `tpl-${tpl.kind}`,
      title: tpl.title,
      platform: 'mobile',
    });
    assert.deepEqual(validateMaterialSource(src), [], `Template ${tpl.kind} failed material validation`);
    assert.deepEqual(pageContractErrors(src, tables), [], `Template ${tpl.kind} failed page contract validation`);
    if (tpl.kind === 'mobile_form' || tpl.kind === 'mobile_workspace') {
      assert.ok(src.includes('table="t_dept"'), `${tpl.kind} should bind FK column to MSheetPicker table="t_dept"`);
      assert.ok(src.includes('mode="date"'), `${tpl.kind} should emit MSheetPicker mode="date" for DATE columns`);
    }
  }
});
