import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { validateMaterialSource } from '../src/proto/registry/materialContract';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { RuntimeProvider, useRuntimeController } from '../src/proto/runtime/runtime';
import { NodeView } from '../src/proto/renderer/NodeView';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { installTestDom } from './dom';

const wrapDesktop = (inner: string) => `export default function Page() {\n  return (\n    ${inner}\n  );\n}\n`;

const CRM_TABLES: DBTableSchema[] = [
  {
    id: 't_deals',
    tableName: 'crm_deals',
    cnName: '销售商机表',
    domain: '业务单据',
    description: '核心商机推进台账',
    sharedByMenus: [],
    columns: [
      { id: 'c_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
      { id: 'c_name', name: 'deal_name', dataType: 'VARCHAR(128)', nullable: false, comment: '商机名称' },
      { id: 'c_owner', name: 'owner_name', dataType: 'VARCHAR(64)', nullable: false, comment: '负责人' },
      { id: 'c_stage', name: 'stage', dataType: "ENUM('初步接触','方案报价','赢单')", nullable: false, comment: '阶段' },
      { id: 'c_amount', name: 'amount', dataType: 'DECIMAL(12,2)', nullable: false, comment: '预计金额' },
      { id: 'c_date', name: 'close_date', dataType: 'DATE', nullable: false, comment: '预计签约日' },
    ],
  },
  {
    id: 't_deal_tasks',
    tableName: 'crm_deal_tasks',
    cnName: '商机跟进任务表',
    domain: '业务单据',
    description: '商机下属跟进事项',
    sharedByMenus: [],
    columns: [
      { id: 'ct_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
      {
        id: 'ct_deal',
        name: 'deal_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'crm_deals(id)',
        comment: '所属商机',
      },
      { id: 'ct_title', name: 'task_title', dataType: 'VARCHAR(128)', nullable: false, comment: '跟进事项' },
    ],
  },
];

function LiveHost({ pageId, source }: { pageId: string; source: string }) {
  const doc = React.useMemo(() => parsePageSource(source).doc!, [source]);
  const rt = useRuntimeController(doc, pageId, false);
  return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
}

test('Phase 1 contracts: Repeater, Kanban, Calendar, AiCopilotCard and Mobile counterparts validate and round-trip AST cleanly', () => {
  const desktopTsx = wrapDesktop(`<Page pfId="p-root" title="商机协同工作台">
  <AiCopilotCard pfId="ai-1" title="AI 商机预审" badge="实时" summary="共 2 笔重点商机待推进" items={[{ title: "高潜商机跟进", detail: "方案已读 3 次", actionLabel: "提醒", onClick: () => toast("已发送提醒") }]} />
  <Row pfId="row-1" gutter={16}>
    <Col pfId="col-master" span={10}>
      <Repeater pfId="rep-deals" table="t_deals" cols={1} autoSelectFirst={true} onItemClick={() => selectRow()}>
        <Card pfId="rep-card" title="{{row.deal_name}}" extra="{{row.stage}}">
          <Text pfId="rep-owner">{'{{row.owner_name}}'}</Text>
          <Button pfId="rep-win" type="link" onClick={() => updateRow({ stage: "赢单" })}>标记赢单</Button>
        </Card>
      </Repeater>
    </Col>
    <Col pfId="col-detail" span={14}>
      <Card pfId="detail-card" activeTable="t_deals" title="当前商机：{{row.deal_name}}">
        <Descriptions pfId="desc-deal" table="t_deals" />
        <Button pfId="btn-advance" type="primary" onClick={() => { updateRow({ stage: "方案报价" }); toast("已推进"); }}>推进报价</Button>
        <Table pfId="tbl-sub" table="t_deal_tasks" sourceForeignKey="deal_id" />
      </Card>
    </Col>
  </Row>
  <Kanban pfId="kb-deals" table="t_deals" statusField="stage" titleField="deal_name" subtitleField="owner_name" metricField="amount" />
  <Calendar pfId="cal-deals" table="t_deals" dateField="close_date" titleField="deal_name" statusField="stage" />
</Page>`);

  assert.deepEqual(validateMaterialSource(desktopTsx), []);
  assert.deepEqual(pageContractErrors(desktopTsx, CRM_TABLES), []);
  const reparsed = printPageSource(parsePageSource(desktopTsx, { strict: true }).doc!);
  assert.deepEqual(validateMaterialSource(reparsed), []);

  const mobileTsx = wrapDesktop(`<MobilePage pfId="mp-root" title="移动商机工作台">
  <MTopBar pfId="m-top" title="随行CRM" />
  <MAiInsightCard pfId="m-ai" title="AI 今日重点" items={[{ title: "跟进签约", detail: "今日截止", actionLabel: "收到", onClick: () => toast("已标记") }]} />
  <MKanban pfId="m-kb" table="t_deals" statusField="stage" titleField="deal_name" subtitleField="owner_name" autoSelectFirst={true} />
  <MRepeater pfId="m-rep" table="t_deals" layout="stack" onItemClick={() => selectRow()}>
    <MSurface pfId="m-rep-card" title="{{row.deal_name}}" subtitle="{{row.owner_name}}" />
  </MRepeater>
  <MSurface pfId="m-detail" activeTable="t_deals" title="激活商机：{{row.deal_name}}">
    <MListGroup pfId="m-lg" table="t_deals" />
    <MButton pfId="m-win-btn" onClick={() => updateRow({ stage: "赢单" })}>一键赢单</MButton>
  </MSurface>
  <MCalendar pfId="m-cal" table="t_deals" dateField="close_date" titleField="deal_name" statusField="stage" />
</MobilePage>`);

  assert.deepEqual(validateMaterialSource(mobileTsx), []);
  assert.deepEqual(pageContractErrors(mobileTsx, CRM_TABLES), []);

  // Platform isolation & missing-context guards still reject invalid usage
  const crossPlatformBad = wrapDesktop(`<Page pfId="bad-p"><MKanban pfId="bad-mkb" /></Page>`);
  assert.ok(validateMaterialSource(crossPlatformBad).some((e) => e.includes('移动端物料')));
  const orphanSelectRow = wrapDesktop(`<Page pfId="bad-sel"><Button pfId="b1" onClick={() => selectRow()}>选行</Button></Page>`);
  assert.ok(pageContractErrors(orphanSelectRow, CRM_TABLES).some((e) => e.includes('selectRow 缺少当前行数据上下文')));
});

test('Phase 1 runtime: popup-free Master-Detail (autoSelectFirst + selectRow + activeTable) and Kanban stage transitions sync live', async () => {
  const restore = installTestDom();
  let view: TestRenderer.ReactTestRenderer | undefined;
  try {
    useProtoStore.setState({ dbTables: CRM_TABLES, activePageId: 'deal-workspace' });
    usePageStore.setState({
      tableRows: {
        t_deals: [
          { id: 'd1', deal_name: '星辰云续约', owner_name: '王凯', stage: '初步接触', amount: 360000, close_date: '2026-11-12' },
          { id: 'd2', deal_name: '博雅医疗中台', owner_name: '赵敏', stage: '方案报价', amount: 520000, close_date: '2026-11-24' },
        ],
        t_deal_tasks: [
          { id: 'tk1', deal_id: 'd1', task_title: '星辰云技术架构复盘' },
          { id: 'tk2', deal_id: 'd2', task_title: '博雅医疗法务合同审阅' },
        ],
      },
    });

    const source = wrapDesktop(`<Page pfId="p-ws" title="商机主从台">
  <Row pfId="r1" gutter={16}>
    <Col pfId="c1" span={10}>
      <Repeater pfId="rep-master" table="t_deals" cols={1} autoSelectFirst={true} onItemClick={() => selectRow()}>
        <Card pfId="tpl-c" title="{{row.deal_name}}" extra="{{row.owner_name}}">
          <Text pfId="tpl-txt">{'{{row.stage}}'}</Text>
        </Card>
      </Repeater>
    </Col>
    <Col pfId="c2" span={14}>
      <Card pfId="detail-pane" activeTable="t_deals" title="详情：{{row.deal_name}}">
        <Button pfId="btn-win" type="primary" onClick={() => updateRow({ stage: "赢单" })}>确认赢单</Button>
        <Table pfId="tbl-tasks" table="t_deal_tasks" sourceForeignKey="deal_id" columns={[{ dataIndex: "task_title", title: "跟进事项" }]} />
      </Card>
    </Col>
  </Row>
  <Kanban pfId="kb-live" table="t_deals" statusField="stage" titleField="deal_name" allowMove={true} />
</Page>`);

    await act(async () => {
      view = TestRenderer.create(React.createElement(LiveHost, { pageId: 'deal-workspace', source }));
    });

    const stringifyText = () => JSON.stringify(view!.toJSON());
    // 1. autoSelectFirst selects d1 ("星辰云续约") on initial mount without any modal/drawer
    assert.ok(stringifyText().includes('详情：星辰云续约'));
    assert.ok(stringifyText().includes('星辰云技术架构复盘'));
    assert.ok(!stringifyText().includes('博雅医疗法务合同审阅'));

    // 2. Clicking row d2 in Repeater switches the right-hand detail card & child foreign-key table in-place
    const d2Node = view!.root.findAll((el) => el.type === 'div' && el.props['data-row-id'] === 'd2')[0];
    await act(async () => {
      d2Node.props.onClick();
    });
    assert.ok(stringifyText().includes('详情：博雅医疗中台'));
    assert.ok(stringifyText().includes('博雅医疗法务合同审阅'));
    assert.ok(!stringifyText().includes('星辰云技术架构复盘'));

    // 3. Clicking "确认赢单" inside <Card activeTable="t_deals"> updates d2's stage directly in shared tableRows
    const winBtn = view!.root.findByProps({ 'data-pf-id': 'btn-win' }).findByType('button');
    await act(async () => {
      await winBtn.props.onClick({ stopPropagation() {} });
    });
    const updatedD2 = usePageStore.getState().tableRows.t_deals.find((r) => r.id === 'd2')!;
    assert.equal(updatedD2.stage, '赢单');

    // 4. Advancing d1 via Kanban advance button updates shared tableRows from '初步接触' -> '方案报价'
    const advanceBtn = view!.root.findAll(
      (el) => el.type === 'button' && typeof el.props['aria-label'] === 'string' && el.props['aria-label'].includes('推进至方案报价'),
    )[0];
    assert.ok(advanceBtn, 'Kanban card should render stage advance button');
    await act(async () => {
      advanceBtn.props.onClick();
    });
    const updatedD1 = usePageStore.getState().tableRows.t_deals.find((r) => r.id === 'd1')!;
    assert.equal(updatedD1.stage, '方案报价');
  } finally {
    act(() => view?.unmount());
    restore();
  }
});
