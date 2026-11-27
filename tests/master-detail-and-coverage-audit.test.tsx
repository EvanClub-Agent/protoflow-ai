import { installTestDom } from './dom';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { parsePageSource } from '../src/proto/dsl/parser';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { NodeView, ScopeProvider } from '../src/proto/renderer/NodeView';
import { findOverlay, RuntimeProvider, useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { createLocalAuthoringWorkspace } from '../src/mcp/authoringWorkspace';
import { handleSpecMcpPayload } from '../src/mcp/protocol';

const rendererOptions = {
  createNodeMock(element: React.ReactElement) {
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
  isDesign = false,
  onRuntime,
}: {
  pageId: string;
  source: string;
  isDesign?: boolean;
  onRuntime?: (rt: Runtime) => void;
}) {
  const doc = React.useMemo(() => parsePageSource(source).doc!, [source]);
  const rt = useRuntimeController(doc, pageId, isDesign);
  onRuntime?.(rt);
  return (
    <RuntimeProvider value={rt}>
      <NodeView node={doc.root} />
      {rt.overlays.map((entry, idx) => {
        const target = findOverlay(doc, entry.id);
        if (!target) return null;
        return (
          <ScopeProvider
            key={`${entry.id}-${idx}`}
            value={{
              row: entry.params.row as any,
              tableId: entry.params.tableId as string | undefined,
              expectedTableId: entry.expectedTableId,
              collectionSourceTableId: entry.collectionSourceTableId,
              isolatePageRow: entry.isolatePageRow,
              params: entry.params,
              overlayIndex: idx,
              overlayKey: entry.key,
            }}
          >
            <NodeView node={target} live />
          </ScopeProvider>
        );
      })}
    </RuntimeProvider>
  );
}

const TEST_TABLES: DBTableSchema[] = [
  {
    id: 't_material',
    tableName: 'base_material',
    cnName: '物料目录表',
    domain: 'MDM',
    description: '基础物料',
    modeling: { entity: '物料', grain: '一种物料一行', reason: '主数据' },
    sharedByMenus: [],
    columns: [
      { id: 'cm_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
      { id: 'cm_code', name: 'material_code', dataType: 'VARCHAR(64)', nullable: false, comment: '物料编码' },
      { id: 'cm_name', name: 'material_name', dataType: 'VARCHAR(128)', nullable: false, comment: '物料名称' },
      { id: 'cm_price', name: 'recent_price', dataType: 'DECIMAL(12,2)', nullable: false, comment: '最近采购价' },
    ],
  },
  {
    id: 't_plan_apply',
    tableName: 'biz_plan_apply',
    cnName: '计划与采购申请主表',
    domain: 'SRM',
    description: '多态单据主表',
    modeling: { entity: '采购申请单', grain: '一张申请单一行', reason: '共用主单' },
    sharedByMenus: [
      { pageId: 'p_regular', menuTitle: '常规采购申请', accessMode: 'CRUD 读写', fieldMappingNote: '' },
      { pageId: 'p_research', menuTitle: '科研采购申请', accessMode: 'CRUD 读写', fieldMappingNote: '' },
    ],
    columns: [
      { id: 'cp_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
      { id: 'cp_no', name: 'plan_no', dataType: 'VARCHAR(64)', nullable: false, comment: '申请单号' },
      { id: 'cp_src', name: 'source_type', dataType: "ENUM('年度申报','常规采购','科研采购')", nullable: false, comment: '单据大类' },
      { id: 'cp_dept', name: 'apply_dept', dataType: 'VARCHAR(64)', nullable: false, comment: '申请部门' },
    ],
  },
  {
    id: 't_plan_apply_item',
    tableName: 'biz_plan_apply_item',
    cnName: '采购申请物料明细表',
    domain: 'SRM',
    description: '单据物料行',
    modeling: { entity: '采购申请明细', grain: '单据内一行物料', reason: '1:N 明细' },
    sharedByMenus: [
      { pageId: 'p_regular', menuTitle: '常规采购申请', accessMode: 'CRUD 读写', fieldMappingNote: '' },
      { pageId: 'p_research', menuTitle: '科研采购申请', accessMode: 'CRUD 读写', fieldMappingNote: '' },
    ],
    columns: [
      { id: 'cpi_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
      {
        id: 'cpi_pid',
        name: 'plan_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'biz_plan_apply(id)',
        foreignKeyOptions: { name: 'fk_item_plan', cardinality: '1:N', onDelete: 'CASCADE' },
        comment: '主单ID',
      },
      { id: 'cpi_pno', name: 'plan_no', dataType: 'VARCHAR(64)', nullable: false, comment: '单号' },
      { id: 'cpi_dept', name: 'apply_dept', dataType: 'VARCHAR(64)', nullable: false, comment: '部门' },
      {
        id: 'cpi_mid',
        name: 'material_id',
        dataType: 'VARCHAR(64)',
        nullable: false,
        isForeignKey: true,
        references: 'base_material(id)',
        foreignKeyOptions: { name: 'fk_item_mat', cardinality: '1:N', onDelete: 'RESTRICT' },
        comment: '物料ID',
      },
      { id: 'cpi_mcode', name: 'material_code', dataType: 'VARCHAR(64)', nullable: false, comment: '物料编码' },
      { id: 'cpi_mname', name: 'material_name', dataType: 'VARCHAR(128)', nullable: false, comment: '物料名称' },
      { id: 'cpi_qty', name: 'apply_qty', dataType: 'INT', nullable: false, comment: '申请数量' },
      { id: 'cpi_price', name: 'plan_price', dataType: 'DECIMAL(12,2)', nullable: false, comment: '预算单价' },
    ],
  },
];

test('Design mode & cross-page filtered master-detail auto-select first visible row, and importSelectedRows inserts linked detail rows', async () => {
  const cleanupDom = installTestDom();
  const prevProto = useProtoStore.getState();
  const prevPages = usePageStore.getState();
  let trInst: TestRenderer.ReactTestRenderer | undefined;

  try {
    useProtoStore.setState({ dbTables: TEST_TABLES });
    usePageStore.setState({
      tableRows: {
        t_material: [
          { id: 'MAT-1', material_code: 'HC001', material_name: '乙腈(色谱纯)', recent_price: 280 },
          { id: 'MAT-2', material_code: 'HC002', material_name: '高纯硝酸', recent_price: 350 },
        ],
        t_plan_apply: [
          { id: 'PA-ND-1', plan_no: 'NDJH2026001', source_type: '年度申报', apply_dept: '综合部' },
          { id: 'PA-CG-1', plan_no: 'CGCG2026001', source_type: '常规采购', apply_dept: '食安部' },
          { id: 'PA-KY-1', plan_no: 'KYCG2026001', source_type: '科研采购', apply_dept: '化矿部' },
        ],
        t_plan_apply_item: [
          {
            id: 'PAI-CG-1',
            plan_id: 'PA-CG-1',
            plan_no: 'CGCG2026001',
            apply_dept: '食安部',
            material_id: 'MAT-1',
            material_code: 'HC001',
            material_name: '乙腈(色谱纯)',
            apply_qty: 10,
            plan_price: 280,
          },
        ],
      },
    });

    const regularSrc = `export default function Page() {
      return (
        <Page pfId="p_reg_root" title="常规采购申请">
          <Row pfId="r1" gutter={16}>
            <Col pfId="c1" span={12}>
              <Table pfId="tbl_hdr" table="t_plan_apply" filter={{ source_type: '常规采购' }} autoSelectFirst={true} onRowClick={() => selectRow()} />
            </Col>
            <Col pfId="c2" span={12}>
              <Card pfId="card_det" activeTable="t_plan_apply" title="明细">
                <Descriptions pfId="desc_hdr" table="t_plan_apply" items={[{ label: '单号', field: 'plan_no' }]} />
                <Button pfId="btn_open_pick" onClick={() => openModal('m_pick')}>批量选物料</Button>
                <Table pfId="tbl_items" table="t_plan_apply_item" sourceForeignKey="plan_id" />
              </Card>
            </Col>
          </Row>
          <Modal pfId="m_pick_pf" id="m_pick" title="选择物料" width={720} footer={false}>
            <Table pfId="tbl_mat_pick" table="t_material" selectable={true} />
            <Button pfId="btn_do_import" type="primary" onClick={() => {
              importSelectedRows('tbl_mat_pick', 'tbl_items', {
                fieldMap: { plan_price: 'recent_price' },
                defaults: { apply_qty: 2 }
              });
              closeOverlay();
              toast('已批量添加物料', 'success');
            }}>确认带入</Button>
          </Modal>
        </Page>
      );
    }`;

    assert.deepEqual(pageContractErrors(regularSrc, TEST_TABLES), []);

    // 1. In Design Mode (isDesign=true), Descriptions & child Table reflect CGCG2026001 (NOT NDJH2026001 / 暂无数据!)
    await act(async () => {
      trInst = TestRenderer.create(<RuntimeHost pageId="p_regular" source={regularSrc} isDesign={true} />, rendererOptions);
    });
    const designText = JSON.stringify(trInst!.toJSON());
    assert.ok(designText.includes('CGCG2026001'), 'Design mode must display first filtered row CGCG2026001');
    assert.ok(!designText.includes('NDJH2026001'), 'Design mode must NOT leak unfiltered row[0] NDJH2026001 into Descriptions');
    assert.ok(designText.includes('乙腈(色谱纯)'), 'Design mode must render child rows of CGCG2026001 instead of empty table');
    await act(async () => {
      trInst?.unmount();
      trInst = undefined;
    });

    // 2. Preview Mode: switching pageId resets stale activeRows from previous page, and importSelectedRows writes real child rows
    let liveRt: Runtime | undefined;
    const annualSrc = `export default function Page() {
      return (
        <Page pfId="p_nd_root" title="年度申报">
          <Table pfId="tbl_nd" table="t_plan_apply" filter={{ source_type: '年度申报' }} autoSelectFirst={true} />
        </Page>
      );
    }`;
    await act(async () => {
      trInst = TestRenderer.create(
        <RuntimeHost pageId="p_annual" source={annualSrc} isDesign={false} onRuntime={(r) => { liveRt = r; }} />,
        rendererOptions,
      );
    });
    assert.equal(liveRt!.activeRows.t_plan_apply, 'PA-ND-1');

    // Switch pageId on the same mounted host -> must reset PA-ND-1 and select PA-CG-1!
    await act(async () => {
      trInst!.update(
        <RuntimeHost pageId="p_regular" source={regularSrc} isDesign={false} onRuntime={(r) => { liveRt = r; }} />,
      );
    });
    assert.equal(liveRt!.activeRows.t_plan_apply, 'PA-CG-1');

    // Select MAT-2 and run importSelectedRows
    await act(async () => {
      liveRt!.openOverlay('m_pick');
      liveRt!.setSelection('tbl_mat_pick', ['MAT-1', 'MAT-2']);
    });
    const doc = parsePageSource(regularSrc).doc!;
    const btnImport = doc.root.children
      .find((n: any) => n.pfId === 'm_pick_pf')!
      .children.find((n: any) => n.pfId === 'btn_do_import') as any;
    await act(async () => {
      await liveRt!.run(btnImport.props.onClick, { overlayIndex: 0 });
    });

    const itemsAfter = usePageStore.getState().getRows('t_plan_apply_item').filter((r) => r.plan_id === 'PA-CG-1');
    assert.equal(itemsAfter.length, 2, 'MAT-1 deduplicated and MAT-2 inserted into t_plan_apply_item');
    const addedMat2 = itemsAfter.find((r) => r.material_id === 'MAT-2')!;
    assert.equal(addedMat2.plan_no, 'CGCG2026001');
    assert.equal(addedMat2.apply_dept, '食安部');
    assert.equal(addedMat2.material_name, '高纯硝酸');
    assert.equal(addedMat2.plan_price, 350);
    assert.equal(addedMat2.apply_qty, 2);
  } finally {
    await act(async () => {
      trInst?.unmount();
    });
    useProtoStore.setState({ dbTables: prevProto.dbTables });
    usePageStore.setState({ tableRows: prevPages.tableRows });
    cleanupDom();
  }
});

test('protoflow_audit and write_page catch unbound sharedByMenus tables, missing detail creation, and sibling detail omissions', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-coverage-gate-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const loader = createLocalAuthoringWorkspace({ workspaceDir: tmpDir });

  const callOk = async (name: string, args: Record<string, unknown>) => {
    const resp = await handleSpecMcpPayload(loader, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    assert.ok(resp && !Array.isArray(resp) && !resp.error, `RPC failed: ${JSON.stringify(resp)}`);
    const res = resp.result as { isError?: boolean; content: { text: string }[] };
    assert.ok(!res.isError, `Expected tool success, got error: ${res.content[0]?.text}`);
    return JSON.parse(res.content[0].text);
  };

  await callOk('protoflow_workspace', {
    action: 'create_project',
    projectName: 'Coverage Gate Test',
    filePath: 'gate.pflow',
    projectMode: 'desktop',
  });
  await callOk('protoflow_sitemap', {
    action: 'upsert_folder',
    folder: { id: 'f_proc', title: '采购申请', parentFolderId: null },
  });
  await callOk('protoflow_database', {
    action: 'upsert_tables',
    tables: TEST_TABLES,
  });

  // 1. Write p_regular WITH detail table view ONLY (missing detail creation!)
  const regIncomplete = await callOk('protoflow_page', {
    action: 'write_page',
    folderId: 'f_proc',
    pageId: 'p_regular',
    title: '常规采购申请',
    source: `export default function Page() {
      return (
        <Page pfId="r_reg" title="常规采购申请">
          <Table pfId="t_reg" table="t_plan_apply" />
          <Table pfId="t_reg_i" table="t_plan_apply_item" sourceForeignKey="plan_id" />
          <Modal pfId="m_reg_pf" id="m_reg" title="新建" width={640} footer={false}>
            <Form pfId="f_reg" table="t_plan_apply">
              <Input pfId="i1" name="plan_no" label="单号" required={true} />
              <Select pfId="i2" name="source_type" label="大类" options="常规采购" initialValue="常规采购" required={true} />
              <Input pfId="i3" name="apply_dept" label="部门" initialValue="食安部" required={true} />
              <Button pfId="b1" type="primary" onClick={() => submitForm('f_reg')}>保存</Button>
            </Form>
          </Modal>
        </Page>
      );
    }`,
  });
  assert.ok(
    regIncomplete.tableMenuCoverageIssues?.some((i: any) => i.kind === 'missing_detail_create' && i.tableId === 't_plan_apply_item'),
    'write_page must immediately warn when header creation page lacks detail row creation',
  );

  // 2. Write p_research OMITTING t_plan_apply_item completely!
  const resOmitted = await callOk('protoflow_page', {
    action: 'write_page',
    folderId: 'f_proc',
    pageId: 'p_research',
    title: '科研采购申请',
    source: `export default function Page() {
      return (
        <Page pfId="r_ky" title="科研采购申请">
          <Table pfId="t_ky" table="t_plan_apply" />
          <Modal pfId="m_ky_pf" id="m_ky" title="新建科研" width={640} footer={false}>
            <Form pfId="f_ky" table="t_plan_apply">
              <Input pfId="k1" name="plan_no" label="单号" required={true} />
              <Select pfId="k2" name="source_type" label="大类" options="科研采购" initialValue="科研采购" required={true} />
              <Input pfId="k3" name="apply_dept" label="部门" initialValue="化矿部" required={true} />
              <Button pfId="kb1" type="primary" onClick={() => submitForm('f_ky')}>保存</Button>
            </Form>
          </Modal>
        </Page>
      );
    }`,
  });
  assert.ok(
    resOmitted.tableMenuCoverageIssues?.some((i: any) => i.kind === 'unbound_menu_table' && i.tableId === 't_plan_apply_item'),
  );
  assert.ok(
    resOmitted.tableMenuCoverageIssues?.some((i: any) => i.kind === 'sibling_missing_detail' && i.tableId === 't_plan_apply_item'),
  );

  const auditFail = await callOk('protoflow_audit', { action: 'audit_project' });
  assert.equal(auditFail.healthy, false, 'audit_project must fail healthy when sharedByMenus detail table or detail creation is omitted');
  assert.ok(auditFail.summary.unfulfilledTableMenuBindings >= 2);

  // 3. Fix both pages to include detail table + importSelectedRows -> audit_project becomes healthy: true!
  for (const [pid, title] of [['p_regular', '常规采购申请'], ['p_research', '科研采购申请']] as const) {
    await callOk('protoflow_page', {
      action: 'write_page',
      folderId: 'f_proc',
      pageId: pid,
      title,
      source: `export default function Page() {
        return (
          <Page pfId="${pid}_r" title="${title}">
            <Table pfId="${pid}_t" table="t_plan_apply" autoSelectFirst={true} onRowClick={() => selectRow()} />
            <Table pfId="${pid}_ti" table="t_plan_apply_item" sourceForeignKey="plan_id" />
            <Modal pfId="${pid}_m_pf" id="${pid}_m" title="新建" width={640} footer={false}>
              <Form pfId="${pid}_f" table="t_plan_apply">
                <Input pfId="${pid}_i1" name="plan_no" label="单号" required={true} />
                <Select pfId="${pid}_i2" name="source_type" label="大类" options="常规采购,科研采购" initialValue="常规采购" required={true} />
                <Input pfId="${pid}_i3" name="apply_dept" label="部门" initialValue="食安部" required={true} />
                <Button pfId="${pid}_b1" type="primary" onClick={() => submitForm('${pid}_f')}>保存</Button>
              </Form>
            </Modal>
            <Modal pfId="${pid}_mp_pf" id="${pid}_mp" title="添加物料" width={680} footer={false}>
              <Table pfId="${pid}_mat" table="t_material" selectable={true} />
              <Button pfId="${pid}_bm" type="primary" onClick={() => {
                importSelectedRows('${pid}_mat', '${pid}_ti', { fieldMap: { plan_price: 'recent_price' }, defaults: { apply_qty: 1 } });
                closeOverlay();
              }}>确认带入</Button>
            </Modal>
          </Page>
        );
      }`,
    });
  }

  const auditPass = await callOk('protoflow_audit', { action: 'audit_project' });
  assert.equal(auditPass.healthy, true);
  assert.equal(auditPass.summary.unfulfilledTableMenuBindings, 0);
});
