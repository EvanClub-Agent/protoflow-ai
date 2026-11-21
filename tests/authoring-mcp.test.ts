import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AUTHORING_MCP_TOOLS } from '../src/mcp/authoringCore';
import { createLocalAuthoringWorkspace } from '../src/mcp/authoringWorkspace';
import { buildWorkspaceLoaderFromCli, parseCliArgs } from '../src/mcp/cli';
import { handleSpecMcpPayload } from '../src/mcp/protocol';
import { SPEC_MCP_TOOLS } from '../src/mcp/tools';
import { createLocalWorkspaceLoader, type WorkspaceLoader } from '../src/mcp/workspace';
import { createProjectPayload, normalizeProjectPayload } from '../src/services/projectStorage';
import { validateProjectPayload } from '../src/services/projectValidation';
import { decodePflowBinary, encodePflowBinary } from '../src/utils/pflowBinaryCodec';

async function rpcCall(loader: WorkspaceLoader, method: string, params: Record<string, unknown> = {}, id = 1) {
  const res = await handleSpecMcpPayload(loader, {
    jsonrpc: '2.0',
    id,
    method,
    params,
  });
  assert.ok(res && !Array.isArray(res), `Expected single JSON-RPC response for ${method}`);
  if (res.error) {
    throw new Error(`RPC ${method} failed (${res.error.code}): ${res.error.message}`);
  }
  return res.result as Record<string, unknown>;
}

async function callToolExpectOk(loader: WorkspaceLoader, name: string, args: Record<string, unknown> = {}) {
  const result = await rpcCall(loader, 'tools/call', { name, arguments: args });
  const typed = result as { isError?: boolean; content: { text: string }[] };
  assert.notEqual(typed.isError, true, `Tool ${name} returned error: ${typed.content?.[0]?.text}`);
  return JSON.parse(typed.content[0].text);
}

async function callToolExpectError(loader: WorkspaceLoader, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await rpcCall(loader, 'tools/call', { name, arguments: args });
  const typed = result as { isError?: boolean; content: { text: string }[] };
  assert.equal(typed.isError, true, `Expected tool ${name} to return isError: true`);
  return typed.content[0]?.text ?? '';
}

test('Authoring MCP: CLI args & readonly vs readwrite isolation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-authoring-cli-'));
  try {
    const filePath = path.join(tmpDir, 'readonly-guard.pflow');
    const payload = createProjectPayload({
      projectId: 'proj-ro-guard',
      projectName: 'ReadOnly Guard',
      storageDir: tmpDir,
      fileName: 'readonly-guard.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-21T08:00:00.000Z',
      updatedAt: '2026-11-21T08:00:00.000Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    fs.writeFileSync(filePath, encodePflowBinary(payload));

    // Default readonly mode preserves 6 tools, 2 prompts, 3 resources, and blocks write tools
    const roOpts = parseCliArgs(['--project', filePath], {});
    assert.equal(roOpts.mode, undefined);
    const roLoader = buildWorkspaceLoaderFromCli(roOpts);
    const roTools = (await rpcCall(roLoader, 'tools/list')) as { tools: { name: string }[] };
    assert.equal(roTools.tools.length, 6);
    const roPrompts = (await rpcCall(roLoader, 'prompts/list')) as { prompts: { name: string }[] };
    assert.equal(roPrompts.prompts.length, 2);
    const roResources = (await rpcCall(roLoader, 'resources/list')) as { resources: { uri: string }[] };
    assert.equal(roResources.resources.length, 3);

    const errMsg = await callToolExpectError(roLoader, 'protoflow_workspace', { action: 'status' });
    assert.match(errMsg, /read-only|只读/);

    // Invalid mode rejected
    assert.throws(() => parseCliArgs(['--mode', 'admin'], {}), /Invalid --mode|无效的 --mode/);

    // --share + --mode readwrite rejected
    const rwShareOpts = parseCliArgs(['--mode', 'readwrite', '--share', 'https://proto.example.com/p/abc12345678901234567'], {});
    assert.throws(() => buildWorkspaceLoaderFromCli(rwShareOpts), /read-only|只读/);

    // --mode readwrite --workspace <dir> boots cleanly without --project
    const rwOpts = parseCliArgs(['--rw', '--workspace', tmpDir], {});
    assert.equal(rwOpts.mode, 'readwrite');
    assert.equal(rwOpts.workspaceDir, tmpDir);
    const rwLoader = buildWorkspaceLoaderFromCli(rwOpts);
    for (const invalid of [{ projectMode: 'tablet' }, { templateId: 42 }]) {
      const message = await callToolExpectError(rwLoader, 'protoflow_workspace', {
        action: 'create_project', projectName: 'Invalid', filePath: 'invalid.pflow', ...invalid,
      });
      assert.match(message, /projectMode|templateId/);
      assert.ok(!fs.existsSync(path.join(tmpDir, 'invalid.pflow')));
    }
    assert.throws(() => createLocalAuthoringWorkspace({ projectPath: 'other.json' }), /pflow/);
    const rwInit = (await rpcCall(rwLoader, 'initialize', { protocolVersion: '2025-06-18' })) as { instructions: string };
    assert.match(rwInit.instructions, /Read-Write/);

    const rwTools = (await rpcCall(rwLoader, 'tools/list')) as { tools: { name: string }[] };
    assert.equal(rwTools.tools.length, SPEC_MCP_TOOLS.length + AUTHORING_MCP_TOOLS.length);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Authoring MCP: full 0-to-1 hybrid prototype lifecycle (ER, seed rows, PC+Mobile pages, block edits, stickies, docs/flows, audit, delete)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-authoring-e2e-'));
  try {
    const loader = createLocalAuthoringWorkspace({ workspaceDir: tmpDir });

    // 1. Empty workspace status & no-active-project prompts/resources
    const emptyStatus = await callToolExpectOk(loader, 'protoflow_workspace', { action: 'status' });
    assert.equal(emptyStatus.projectPath, null);
    assert.equal(emptyStatus.workspaceDir, tmpDir);

    const noProjErr = await callToolExpectError(loader, 'protoflow_get_project_overview', {});
    assert.match(noProjErr, /protoflow_workspace/);

    const promptList = (await rpcCall(loader, 'prompts/list')) as { prompts: { name: string }[] };
    assert.equal(promptList.prompts.length, 6);
    const promptRes = (await rpcCall(loader, 'prompts/get', {
      name: 'design-full-project',
      arguments: { requirements: 'CRM 客户与订单台账', projectMode: 'hybrid' },
    })) as { messages: { content: { text: string } }[] };
    assert.match(promptRes.messages[0].content.text, /CRM 客户与订单台账/);

    const playbook = (await rpcCall(loader, 'resources/read', { uri: 'protoflow://authoring/playbook' })) as {
      contents: { text: string }[];
    };
    assert.match(playbook.contents[0].text, /Authoring Playbook/);

    // 2. Create a hybrid project
    const created = await callToolExpectOk(loader, 'protoflow_workspace', {
      action: 'create_project',
      filePath: 'crm-demo.pflow',
      projectName: 'CRM 订单协同原型',
      projectMode: 'hybrid',
      templateId: 'blank_project',
    });
    assert.equal(created.projectMode, 'hybrid');
    assert.ok(fs.existsSync(created.filePath));

    // Create a second project, list_projects, and switch back
    await callToolExpectOk(loader, 'protoflow_workspace', {
      action: 'create_project',
      filePath: 'secondary.pflow',
      projectName: 'Secondary Project',
    });
    const listed = await callToolExpectOk(loader, 'protoflow_workspace', { action: 'list_projects' });
    assert.equal(listed.projects.length, 2);
    assert.equal(listed.projects.every((p: { valid: boolean }) => p.valid), true);

    await callToolExpectOk(loader, 'protoflow_workspace', {
      action: 'switch_project',
      filePath: 'crm-demo.pflow',
    });

    // 3. Progressive guides & contracts
    const guideCatalog = await callToolExpectOk(loader, 'protoflow_get_implementation_guide', {});
    assert.ok(guideCatalog.scenarios.some((s: { id: string }) => s.id === 'mobile'));
    const detailedGuides = await callToolExpectOk(loader, 'protoflow_get_implementation_guide', {
      scenarioIds: ['list', 'mobile'],
    });
    assert.equal(detailedGuides.scenarios.length, 2);

    const contractCatalog = await callToolExpectOk(loader, 'protoflow_get_contracts', {});
    assert.ok(contractCatalog.componentCounts.desktop > 10);
    assert.ok(contractCatalog.componentCounts.mobile > 10);
    assert.equal(contractCatalog.components.axure, undefined);

    const detailedContracts = await callToolExpectOk(loader, 'protoflow_get_contracts', {
      componentNames: ['Page', 'Table', 'Form', 'Modal', 'MobilePage', 'MTopBar', 'MTaskList'],
    });
    assert.equal(detailedContracts.components.length, 7);
    assert.ok(detailedContracts.actions.some((a: { name: string }) => a.name === 'submitForm'));

    // 4. Sitemap folders
    await callToolExpectOk(loader, 'protoflow_manage_sitemap', {
      action: 'upsert_folder',
      folder: { id: 'folder_crm_pc', title: 'PC 管理端', parentFolderId: null },
    });
    await callToolExpectOk(loader, 'protoflow_manage_sitemap', {
      action: 'upsert_folder',
      folder: { id: 'folder_crm_mob', title: '移动端工作台', parentFolderId: null },
    });

    // 5. ER database tables: invalid FK mismatch rejected cleanly without mutating disk
    const badDbErr = await callToolExpectError(loader, 'protoflow_upsert_db_tables', {
      action: 'upsert_tables',
      tables: [
        {
          id: 't_customers',
          tableName: 't_customers',
          cnName: '客户主表',
          domain: '客户域',
          description: '客户主数据',
          modeling: { entity: 'Customer', grain: 'One customer', reason: 'Master data' },
          sharedByMenus: [],
          columns: [
            { id: 'c_cust_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
          ],
        },
        {
          id: 't_orders',
          tableName: 't_orders',
          cnName: '订单表',
          domain: '交易域',
          description: '订单主表',
          modeling: { entity: 'Order', grain: 'One order', reason: 'Order records' },
          sharedByMenus: [],
          columns: [
            { id: 'c_ord_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
            {
              id: 'c_ord_cust',
              name: 'customer_id',
              dataType: 'INT', // Mismatches VARCHAR(64)
              nullable: false,
              isForeignKey: true,
              references: 't_customers(id)',
              comment: '客户ID',
            },
          ],
        },
      ],
    });
    assert.match(badDbErr, /不一致|mismatch/);
    const afterBadDbOverview = await callToolExpectOk(loader, 'protoflow_get_project_overview', {});
    assert.equal(afterBadDbOverview.counts.tables, 0);

    // Valid batch ER tables (including pendingMenuBindings before pages exist!)
    const goodDbRes = await callToolExpectOk(loader, 'protoflow_upsert_db_tables', {
      action: 'upsert_tables',
      tables: [
        {
          id: 't_customers',
          tableName: 't_customers',
          cnName: '客户主表',
          domain: '客户域',
          description: '客户主数据',
          modeling: { entity: 'Customer', grain: 'One customer account', reason: 'Shared master entity' },
          uniqueConstraints: [{ name: 'uq_customer_code', columnIds: ['c_cust_code'] }],
          sharedByMenus: [
            { pageId: 'page_orders', menuTitle: '订单台账', accessMode: 'FK 外键引用', fieldMappingNote: '选择下单客户' },
          ],
          columns: [
            { id: 'c_cust_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
            { id: 'c_cust_code', name: 'customer_code', dataType: 'VARCHAR(32)', nullable: false, comment: '客户编码' },
            { id: 'c_cust_name', name: 'customer_name', dataType: 'VARCHAR(120)', nullable: false, comment: '客户名称' },
          ],
        },
        {
          id: 't_orders',
          tableName: 't_orders',
          cnName: '订单台账表',
          domain: '交易域',
          description: '客户销售订单',
          modeling: { entity: 'Order', grain: 'One sales order', reason: 'Transactional order header' },
          sharedByMenus: [
            { pageId: 'page_orders', menuTitle: '订单台账', accessMode: 'CRUD 读写', fieldMappingNote: '列表与新建' },
            { pageId: 'page_mob_orders', menuTitle: '移动订单', accessMode: 'READ 查询', fieldMappingNote: '移动端待办列表' },
          ],
          columns: [
            { id: 'c_ord_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
            { id: 'c_ord_no', name: 'order_no', dataType: 'VARCHAR(64)', nullable: false, isUnique: true, comment: '订单号' },
            {
              id: 'c_ord_cust',
              name: 'customer_id',
              dataType: 'VARCHAR(64)',
              nullable: false,
              isForeignKey: true,
              references: 't_customers(id)',
              foreignKeyOptions: { name: 'fk_orders_customer', cardinality: '1:N', onDelete: 'RESTRICT' },
              comment: '客户外键',
            },
            {
              id: 'c_ord_status',
              name: 'status',
              dataType: "ENUM('draft','pending','approved')",
              nullable: false,
              comment: '审批状态',
            },
          ],
        },
      ],
    });
    assert.equal(goodDbRes.totalTables, 2);
    assert.ok(Array.isArray(goodDbRes.pendingMenuBindings) && goodDbRes.pendingMenuBindings.length === 3);

    // Upsert an extra column on t_orders
    const colUpsertRes = await callToolExpectOk(loader, 'protoflow_upsert_db_tables', {
      action: 'upsert_columns',
      tableId: 't_orders',
      columns: [
        { id: 'c_ord_amount', name: 'amount', dataType: 'DECIMAL(12,2)', nullable: false, comment: '订单金额' },
      ],
    });
    assert.equal(colUpsertRes.columnCount, 5);

    // 6. Preview tableRows seeding & validation
    const badSeedErr = await callToolExpectError(loader, 'protoflow_manage_table_rows', {
      action: 'seed',
      datasets: [
        {
          tableId: 't_customers',
          rows: [{ id: 'CUST-1', customer_code: 'C001', customer_name: '星辰科技' }],
        },
        {
          tableId: 't_orders',
          rows: [{ id: 'ORD-1', order_no: 'SO-001', customer_id: 'CUST-MISSING', status: 'pending', amount: 1200 }],
        },
      ],
    });
    assert.match(badSeedErr, /找不到唯一来源|CUST-MISSING/);

    await callToolExpectOk(loader, 'protoflow_manage_table_rows', {
      action: 'seed',
      datasets: [
        {
          tableId: 't_customers',
          rows: [
            { id: 'CUST-1', customer_code: 'C001', customer_name: '星辰科技' },
            { id: 'CUST-2', customer_code: 'C002', customer_name: '云海物流' },
          ],
        },
        {
          tableId: 't_orders',
          rows: [
            { id: 'ORD-1', order_no: 'SO-001', customer_id: 'CUST-1', status: 'pending', amount: 12800 },
            { id: 'ORD-2', order_no: 'SO-002', customer_id: 'CUST-2', status: 'approved', amount: 5600 },
          ],
        },
      ],
    });

    const readRowsRes = await callToolExpectOk(loader, 'protoflow_manage_table_rows', {
      action: 'read',
      tableId: 't_orders',
      offset: 0,
      limit: 1,
    });
    assert.equal(readRowsRes.total, 2);
    assert.equal(readRowsRes.rows.length, 1);
    assert.equal(readRowsRes.nextOffset, 1);

    // Overwrite rejected unless replaceExisting: true
    const dupSeedErr = await callToolExpectError(loader, 'protoflow_manage_table_rows', {
      action: 'seed',
      datasets: [{ tableId: 't_orders', rows: [{ id: 'ORD-3', order_no: 'SO-003', customer_id: 'CUST-1', status: 'draft', amount: 100 }] }],
    });
    assert.match(dupSeedErr, /已有预览数据/);

    await callToolExpectOk(loader, 'protoflow_manage_table_rows', {
      action: 'seed',
      replaceExisting: true,
      datasets: [
        {
          tableId: 't_orders',
          rows: [
            { id: 'ORD-1', order_no: 'SO-001', customer_id: 'CUST-1', status: 'pending', amount: 12800 },
            { id: 'ORD-2', order_no: 'SO-002', customer_id: 'CUST-2', status: 'approved', amount: 5600 },
            { id: 'ORD-3', order_no: 'SO-003', customer_id: 'CUST-1', status: 'draft', amount: 3400 },
          ],
        },
      ],
    });

    // 7. Write desktop page + mobile page (and verify invalid mixing rejected)
    const invalidMixedErr = await callToolExpectError(loader, 'protoflow_write_page', {
      pageId: 'page_bad_mix',
      title: '错误混用',
      folderId: 'folder_crm_mob',
      platform: 'mobile',
      source: `export default function Page() {
  return (
    <MobilePage pfId="mob_bad_root" title="错误混用">
      <Table pfId="bad_tbl" table="t_orders" columns={[{ dataIndex: 'order_no', title: '订单号' }]} />
    </MobilePage>
  );
}`,
    });
    assert.match(invalidMixedErr, /不能混用|MobilePage/);

    const pcPageRes = await callToolExpectOk(loader, 'protoflow_write_page', {
      pageId: 'page_orders',
      title: '订单台账',
      folderId: 'folder_crm_pc',
      platform: 'desktop',
      source: `export default function Page() {
  return (
    <Page pfId="pc_orders_root" title="订单台账">
      <PageHeader pfId="pc_orders_hdr" title="订单台账" subTitle="销售订单全生命周期管理" />
      <Card pfId="pc_orders_card" title="订单列表">
        <Toolbar pfId="pc_orders_tb">
          <Button pfId="pc_btn_new" type="primary" onClick={() => openModal('dlg_new_order')}>新建订单</Button>
        </Toolbar>
        <QueryForm pfId="pc_orders_query" target="pc_orders_tbl" cols={3} fields={[
          { name: 'order_no', label: '订单号', type: 'input' },
          { name: 'status', label: '状态', type: 'select', options: 'pending,approved,draft' }
        ]} />
        <Table pfId="pc_orders_tbl" table="t_orders" columns={[
          { dataIndex: 'order_no', title: '订单号' },
          { dataIndex: 'customer_id', title: '客户' },
          { dataIndex: 'amount', title: '金额', render: 'money' },
          { dataIndex: 'status', title: '状态', render: 'tag' }
        ]} rowActions={[
          { label: '审批通过', onClick: () => { updateRow({ status: 'approved' }); toast('已审批', 'success'); } }
        ]} />
      </Card>
      <Modal pfId="dlg_new_order_pf" id="dlg_new_order" title="新建销售订单" width={640}>
        <Form pfId="form_new_order" table="t_orders" cols={2}>
          <Input pfId="fld_order_no" name="order_no" label="订单号" required={true} />
          <Select pfId="fld_cust" name="customer_id" label="客户" options={[{ label: '星辰科技', value: 'CUST-1' }, { label: '云海物流', value: 'CUST-2' }]} required={true} />
          <NumberInput pfId="fld_amount" name="amount" label="订单金额" required={true} />
          <Select pfId="fld_status" name="status" label="状态" options={[{ label: '待审批', value: 'pending' }, { label: '草稿', value: 'draft' }]} required={true} />
          <Button pfId="btn_save_order" type="primary" onClick={() => { submitForm('form_new_order'); closeOverlay(); toast('已保存', 'success'); refresh('pc_orders_tbl'); }}>保存订单</Button>
        </Form>
      </Modal>
    </Page>
  );
}`,
    });
    assert.equal(pcPageRes.created, true);
    assert.equal(pcPageRes.platform, 'desktop');
    assert.equal(pcPageRes.activePageId, 'page_orders');
    assert.equal(pcPageRes.inspection.validation.valid, true);

    const mobPageRes = await callToolExpectOk(loader, 'protoflow_write_page', {
      pageId: 'page_mob_orders',
      title: '移动订单',
      folderId: 'folder_crm_mob',
      platform: 'mobile',
      source: `export default function Page() {
  return (
    <MobilePage pfId="mob_orders_root" title="移动订单" accent="gemini">
      <MTopBar pfId="mob_orders_bar" title="订单审批" leftMode="menu" rightIcon="plus" onRightClick={() => openDrawer('sheet_mob_new')} />
      <MSearchPill pfId="mob_orders_search" target="mob_orders_list" placeholder="搜索订单号" />
      <MTaskList pfId="mob_orders_list" table="t_orders" titleField="order_no" statusField="status" fields={[
        { dataIndex: 'amount', title: '订单金额', render: 'money' }
      ]} rowActions={[
        { label: '通过', primary: true, onClick: () => { updateRow({ status: 'approved' }); toast('已通过', 'success'); } }
      ]} />
      <MBottomSheet pfId="sheet_mob_new_pf" id="sheet_mob_new" title="快速下单">
        <MForm pfId="mform_order" table="t_orders">
          <MField pfId="mf_no" name="order_no" label="订单号" required={true} />
          <MSheetPicker pfId="mf_cust" name="customer_id" label="客户" table="t_customers" labelField="customer_name" valueField="id" required={true} />
          <MField pfId="mf_amt" name="amount" label="金额" inputType="number" required={true} />
          <MChipSelect pfId="mf_status" name="status" label="状态" options={[{ label: '待审批', value: 'pending' }, { label: '草稿', value: 'draft' }]} required={true} />
          <MButton pfId="mbtn_submit" onClick={() => { submitForm('mform_order'); closeOverlay(); toast('创建成功', 'success'); refresh('mob_orders_list'); }}>提交订单</MButton>
        </MForm>
      </MBottomSheet>
    </MobilePage>
  );
}`,
    });
    assert.equal(mobPageRes.created, true);
    assert.equal(mobPageRes.platform, 'mobile');

    // 8. Edit page block (append_children, replace_node, delete_node) & reject deleting root
    await callToolExpectOk(loader, 'protoflow_edit_page_block', {
      pageId: 'page_orders',
      targetPfId: 'pc_orders_tb',
      mode: 'append_children',
      tsx: `<Button pfId="pc_btn_mobile" onClick={() => navigate('page_mob_orders')}>查看移动端</Button>`,
    });
    await callToolExpectOk(loader, 'protoflow_edit_page_block', {
      pageId: 'page_orders',
      targetPfId: 'pc_btn_mobile',
      mode: 'replace_node',
      tsx: `<Button pfId="pc_btn_mobile" type="default" onClick={() => navigate('page_mob_orders')}>跳转移动订单</Button>`,
    });
    const inspectedSpec = await callToolExpectOk(loader, 'protoflow_get_page_spec', {
      pageId: 'page_orders',
      includeInspection: true,
      selectedPfId: 'pc_btn_mobile',
    });
    assert.equal(inspectedSpec.inspection.selected.node.pfId, 'pc_btn_mobile');
    assert.match(inspectedSpec.pageSourceTsx, /跳转移动订单/);

    const rootDelErr = await callToolExpectError(loader, 'protoflow_edit_page_block', {
      pageId: 'page_orders',
      targetPfId: 'pc_orders_root',
      mode: 'delete_node',
    });
    assert.match(rootDelErr, /根节点|root/);

    // Also test delete_node on a temporary node
    await callToolExpectOk(loader, 'protoflow_edit_page_block', {
      pageId: 'page_orders',
      targetPfId: 'pc_orders_tb',
      mode: 'append_children',
      tsx: `<Tag pfId="pc_temp_tag" color="blue">临时标签</Tag>`,
    });
    const deletedTagRes = await callToolExpectOk(loader, 'protoflow_edit_page_block', {
      pageId: 'page_orders',
      targetPfId: 'pc_temp_tag',
      mode: 'delete_node',
    });
    assert.equal(deletedTagRes.inspection.nodes.some((n: { pfId: string }) => n.pfId === 'pc_temp_tag'), false);

    // 9. Sticky notes
    const badStickyErr = await callToolExpectError(loader, 'protoflow_manage_sticky_notes', {
      action: 'upsert',
      stickies: [{
        id: 'st_bad',
        pageId: 'page_orders',
        targetWidgetId: 'non_existent_pfid',
        targetWidgetName: '不存在',
        text: '测试',
      }],
    });
    assert.match(badStickyErr, /non_existent_pfid/);

    const stickyRes = await callToolExpectOk(loader, 'protoflow_manage_sticky_notes', {
      action: 'upsert',
      stickies: [{
        id: 'st_orders_submit',
        pageId: 'page_orders',
        targetWidgetId: 'btn_save_order',
        targetWidgetName: '保存订单按钮',
        text: '订单号必须全局唯一，金额须大于 0。',
        compiledRule: 'UNIQUE(order_no) AND amount > 0',
      }],
    });
    assert.equal(stickyRes.totalStickies, 1);

    // 10. Docs, mindmaps, agreements
    const noteRes = await callToolExpectOk(loader, 'protoflow_manage_docs_and_flows', {
      action: 'upsert_note',
      note: {
        id: 'note_crm_prd',
        markdown: '# CRM 订单业务规则\n\n- 订单审批通过后不可删除。',
        status: 'confirmed',
        priority: 'P0',
        linkedPageIds: ['page_orders', 'page_orders'], // Deduped cleanly
      },
    });
    assert.equal(noteRes.title, 'CRM 订单业务规则');
    assert.equal(noteRes.linkCount, 1);

    await callToolExpectOk(loader, 'protoflow_manage_docs_and_flows', {
      action: 'upsert_mindmap',
      mindmap: {
        id: 'map_order_flow',
        title: '订单状态流转图',
        source: 'flowchart LR\n  Draft[草稿] --> Pending[待审批]\n  Pending --> Approved[已通过]',
        linkedPageIds: ['page_orders'],
      },
    });
    await callToolExpectOk(loader, 'protoflow_manage_docs_and_flows', {
      action: 'upsert_agreement',
      agreement: {
        id: 'agr_order_currency',
        kind: 'field_constraint',
        title: '订单金额单位统一为人民币元',
        text: 't_orders.amount 保留 2 位小数。',
        pageIds: ['page_orders', 'page_mob_orders'],
      },
    });

    // 11. Closed-loop audit (healthy: true, then negative check on dangling sharedByMenus, then restored)
    const cleanAudit = await callToolExpectOk(loader, 'protoflow_audit_project', {});
    assert.equal(cleanAudit.healthy, true);
    assert.equal(cleanAudit.summary.auditedPages, 2);
    assert.equal(cleanAudit.summary.danglingTableMenuBindings, 0);

    const customersTableForAudit = (await callToolExpectOk(loader, 'protoflow_get_database_schema', { tableNames: ['t_customers'] })).tables[0];
    await callToolExpectOk(loader, 'protoflow_upsert_db_tables', {
      action: 'upsert_tables',
      tables: [{
        id: customersTableForAudit.id,
        tableName: customersTableForAudit.tableName,
        cnName: customersTableForAudit.cnName,
        domain: customersTableForAudit.domain,
        description: customersTableForAudit.description,
        modeling: customersTableForAudit.modeling,
        uniqueConstraints: [{ name: 'uq_customer_code', columnIds: ['c_cust_code'] }],
        sharedByMenus: [
          ...customersTableForAudit.sharedByMenus,
          { pageId: 'page_ghost', menuTitle: '不存在的菜单', accessMode: 'READ 查询', fieldMappingNote: '' },
        ],
        columns: customersTableForAudit.columns.map((c: Record<string, unknown>) => ({
          id: c.id,
          name: c.name,
          dataType: c.prototypeDataType,
          nullable: c.nullable,
          comment: c.comment,
          ...(c.isPrimaryKey ? { isPrimaryKey: true } : {}),
        })),
      }],
    });
    const dirtyAudit = await callToolExpectOk(loader, 'protoflow_audit_project', {});
    assert.equal(dirtyAudit.healthy, false);
    assert.ok(dirtyAudit.summary.danglingTableMenuBindings >= 1);

    // Restore clean sharedByMenus
    await callToolExpectOk(loader, 'protoflow_upsert_db_tables', {
      action: 'upsert_tables',
      tables: [{
        id: customersTableForAudit.id,
        tableName: customersTableForAudit.tableName,
        cnName: customersTableForAudit.cnName,
        domain: customersTableForAudit.domain,
        description: customersTableForAudit.description,
        modeling: customersTableForAudit.modeling,
        uniqueConstraints: [{ name: 'uq_customer_code', columnIds: ['c_cust_code'] }],
        sharedByMenus: customersTableForAudit.sharedByMenus,
        columns: customersTableForAudit.columns.map((c: Record<string, unknown>) => ({
          id: c.id,
          name: c.name,
          dataType: c.prototypeDataType,
          nullable: c.nullable,
          comment: c.comment,
          ...(c.isPrimaryKey ? { isPrimaryKey: true } : {}),
        })),
      }],
    });
    const restoredAudit = await callToolExpectOk(loader, 'protoflow_audit_project', {});
    assert.equal(restoredAudit.healthy, true);

    // Sitemap rename, move & delete cascade
    await callToolExpectOk(loader, 'protoflow_manage_sitemap', {
      action: 'rename_page',
      pageId: 'page_mob_orders',
      title: '移动订单工作台',
    });
    await callToolExpectOk(loader, 'protoflow_manage_sitemap', {
      action: 'move_item',
      target: { kind: 'page', id: 'page_mob_orders' },
      parentFolderId: 'folder_crm_pc',
    });
    await callToolExpectOk(loader, 'protoflow_manage_sitemap', {
      action: 'delete_item',
      pageId: 'page_mob_orders',
    });

    // Verify navigate('page_mob_orders') in page_orders was cleaned up by prepareMenuDeletion and project remains valid
    const afterDeleteAudit = await callToolExpectOk(loader, 'protoflow_audit_project', {});
    assert.equal(afterDeleteAudit.healthy, true);
    assert.equal(afterDeleteAudit.summary.auditedPages, 1);

    // Update project metadata
    const metaUpdated = await callToolExpectOk(loader, 'protoflow_workspace', {
      action: 'update_project_meta',
      projectName: 'CRM 订单协同原型 V2',
    });
    assert.equal(metaUpdated.projectName, 'CRM 订单协同原型 V2');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Authoring MCP: optimistic concurrency control (expectedRevision) prevents stale overwrites', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-authoring-occ-'));
  try {
    const loader = createLocalAuthoringWorkspace({ workspaceDir: tmpDir });
    const created = await callToolExpectOk(loader, 'protoflow_workspace', {
      action: 'create_project',
      filePath: 'occ.pflow',
      projectName: 'OCC Test',
    });
    const staleRev = created.revision;

    // External modification via a second writer updates file & revision
    const secondLoader = createLocalAuthoringWorkspace({ projectPath: created.filePath });
    await callToolExpectOk(secondLoader, 'protoflow_workspace', {
      action: 'update_project_meta',
      projectName: 'OCC External V2',
    });

    const conflictMsg = await callToolExpectError(loader, 'protoflow_workspace', {
      action: 'update_project_meta',
      projectName: 'Stale Overwrite',
      expectedRevision: staleRev,
    });
    assert.match(conflictMsg, /冲突|conflict/i);

    const diskCheck = await callToolExpectOk(createLocalWorkspaceLoader(created.filePath), 'protoflow_get_project_overview', {});
    assert.equal(diskCheck.project.projectName, 'OCC External V2');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Authoring MCP: compiled CLI bundle writes valid .pflow over real stdio in --mode readwrite', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-authoring-cli-rw-'));
  try {
    const cliScript = path.resolve(__dirname, '../packages/protoflow-mcp/dist/cli.cjs');
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'protoflow_workspace',
          arguments: {
            action: 'create_project',
            filePath: 'stdio-built.pflow',
            projectName: 'Stdio Built Prototype',
            projectMode: 'desktop',
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'protoflow_manage_sitemap',
          arguments: {
            action: 'upsert_folder',
            folder: { id: 'f_main', title: '主模块', parentFolderId: null },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'protoflow_upsert_db_tables',
          arguments: {
            action: 'upsert_tables',
            tables: [
              {
                id: 't_tasks',
                tableName: 't_tasks',
                cnName: '任务表',
                domain: '任务域',
                description: '任务台账',
                modeling: { entity: 'Task', grain: 'One task', reason: 'Track tasks' },
                sharedByMenus: [{ pageId: 'p_tasks', menuTitle: '任务列表', accessMode: 'CRUD 读写', fieldMappingNote: '' }],
                columns: [
                  { id: 'c_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: 'ID' },
                  { id: 'c_title', name: 'title', dataType: 'VARCHAR(120)', nullable: false, comment: '标题' },
                ],
              },
            ],
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'protoflow_write_page',
          arguments: {
            pageId: 'p_tasks',
            title: '任务列表',
            folderId: 'f_main',
            source: `export default function Page() {
  return (
    <Page pfId="root_tasks" title="任务列表">
      <Table pfId="tbl_tasks" table="t_tasks" columns={[{ dataIndex: 'title', title: '任务标题' }]} />
    </Page>
  );
}`,
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'protoflow_audit_project', arguments: {} },
      },
    ];

    const res = spawnSync(process.execPath, [cliScript, '--mode', 'readwrite', '--workspace', tmpDir], {
      input: requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(res.status, 0, res.stderr);
    const frames = res.stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(frames.length, 7);

    const toolsFrame = frames.find((f) => f.id === 2);
    assert.equal(toolsFrame.result.tools.length, SPEC_MCP_TOOLS.length + AUTHORING_MCP_TOOLS.length);

    const auditFrame = frames.find((f) => f.id === 7);
    assert.notEqual(auditFrame.result.isError, true, auditFrame.result.content?.[0]?.text);
    const audit = JSON.parse(auditFrame.result.content[0].text);
    assert.equal(audit.healthy, true);

    const pflowFile = path.join(tmpDir, 'stdio-built.pflow');
    assert.equal(fs.existsSync(pflowFile), true);
    const decoded = normalizeProjectPayload(decodePflowBinary(fs.readFileSync(pflowFile)));
    validateProjectPayload(decoded);
    assert.equal(decoded.meta.projectName, 'Stdio Built Prototype');
    assert.equal(decoded.stateSnapshot.dbTables.length, 1);
    assert.ok(decoded.stateSnapshot.pageSources.p_tasks);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Authoring Skill Pack: SKILL.md and reference docs exist with valid frontmatter and exact MCP tool names', () => {
  const skillDir = path.resolve(__dirname, '../skills/alex-protoflow-designer');
  const skillFile = path.join(skillDir, 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true, 'SKILL.md must exist');

  for (const refName of [
    'full-project-workflow.md',
    'er-modeling-rules.md',
    'desktop-and-mobile.md',
    'axure-reshape.md',
  ]) {
    const refPath = path.join(skillDir, 'references', refName);
    assert.equal(fs.existsSync(refPath), true, `Missing reference doc: ${refName}`);
  }

  const content = fs.readFileSync(skillFile, 'utf8');
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(content);
  assert.ok(fmMatch, 'SKILL.md must begin with YAML frontmatter');
  assert.match(fmMatch[1], /^name:\s*alex-protoflow-designer\b/m);
  assert.match(fmMatch[1], /^description:\s*\S+/m);

  const validToolNames = new Set([...SPEC_MCP_TOOLS, ...AUTHORING_MCP_TOOLS].map((t) => t.name));
  const referencedTools = [...content.matchAll(/\b(protoflow_[a-z0-9_]+)\b/g)].map((m) => m[1]);
  assert.ok(referencedTools.length >= 10, 'SKILL.md should reference core protoflow_* MCP tools');
  for (const toolName of referencedTools) {
    assert.equal(validToolNames.has(toolName), true, `SKILL.md references unknown MCP tool: ${toolName}`);
  }
});
