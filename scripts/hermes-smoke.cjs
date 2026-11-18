// Opt-in real Hermes integration test. Uses a temporary project, never the open editor project.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require('node:child_process');
const { buildSync } = require("esbuild");
const { HermesRuntime } = require("../electron/hermes-runtime.cjs");
const root = path.resolve(__dirname, "..");
const compiled = buildSync({
  stdin: {
    contents:
      "export * from './src/services/hermesProject'; export * from './src/services/projectStorage'; export { buildProtoFlowHermesSkillMarkdown } from './src/store/useHermesStore'; export { parsePageSource } from './src/proto/dsl/parser';",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["react"],
});
const harness = new Module("hermes-smoke");
harness.filename = path.join(root, "scripts/.hermes-smoke.cjs");
harness.paths = Module._nodeModulePaths(root);
harness._compile(compiled.outputFiles[0].text, harness.filename);
const h = harness.exports;
const materialScenario = process.argv.includes("--material");
const customScenario = process.argv.includes('--custom');
const tableScenario = process.argv.includes('--table');
const chartsScenario = process.argv.includes('--charts');
const growthScenario = process.argv.includes('--chart-growth');
const dataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "protoflow-hermes-smoke-"),
);
let chunks = 0;
const toolCalls = [];
const deniedPermissions = [];
const questions = [];
const runtime = new HermesRuntime({
  dataDir,
  emit: (e) => {
    if (
      e.type === "session-update" &&
      e.update.sessionUpdate === "agent_message_chunk"
    )
      chunks++;
    if (e.type === "session-update" && e.update.sessionUpdate === "tool_call") {
      toolCalls.push(e.update.title);
      console.log(`Tool: ${e.update.title}`);
    }
    if (e.type === "permission") {
      deniedPermissions.push(e.toolCall?.title);
      runtime.respondPermission({ id: e.id, optionId: null });
    }
    if (e.type === "question") {
      questions.push(e.message);
      runtime.respondQuestion({ id: e.id, answer: null });
    }
  },
});
if (process.env.PFLOW_HERMES_SETTINGS) {
  const settings = JSON.parse(fs.readFileSync(process.env.PFLOW_HERMES_SETTINGS, 'utf8'));
  assert.equal(typeof settings.home, 'string'); assert.equal(typeof settings.binary, 'string');
  runtime.settings = { home: settings.home, binary: settings.binary };
}
const timeout = setTimeout(() => { console.error('Real Hermes integration test timed out'); runtime.close(); process.exit(1); }, 240000);
(async () => {
  try {
    const project = h.createProjectPayload({
      projectId: "hermes-smoke",
      projectName: "Hermes integration test",
      templateId: "blank_project",
      storageDir: dataDir,
      fileName: "smoke.pflow",
      createdAt: "2026-10-30",
      updatedAt: "2026-10-30",
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    project.stateSnapshot.pageSources = {
      main: 'export default function Page(){return <Page pfId="root" title="Before"><Text pfId="content">Keep this</Text></Page>}',
    };
    project.stateSnapshot.designerFolders = [{ id:'folder-project-pages', title:'测试目录', parentFolderId:null }];
    project.stateSnapshot.designerPages = [
      { pageId: "main", title: "Smoke", folderId: "folder-project-pages" },
    ];
    project.stateSnapshot.activePageId = "main";
    if (customScenario) {
      project.stateSnapshot.dbTables = [{ id: 'customer-entity', tableName: 't_customer', cnName: '客户', domain: '基础资料域 (MDM)', description: '隔离测试数据', sharedByMenus: [], columns: [{ id: 'customer-name-column', name: 'customer_name', dataType: 'TEXT', nullable: false, comment: '客户名称' }] }];
      project.stateSnapshot.tableRows = { 'customer-entity': [{ id: 'demo-customer', customer_name: '演示客户' }] };
      project.stateSnapshot.pageSources.main = 'export default function Page(){return <Page pfId="root" title="客户页面"><Table pfId="customer-grid" table="customer-entity" columns={[{title:"客户名称",dataIndex:"customer_name"}]}/></Page>}';
    }
    if (tableScenario) {
      const fields = [
        ['dept_no', '部门编号', 'TEXT'], ['parent_no', '上级部门编号，对应 dept_no，根部门为 null', 'TEXT'],
        ['name', '部门名称', 'TEXT'], ['zone', '所在区域', 'TEXT'], ['quota', '编制人数', 'INT'],
        ['enabled', '启用状态，0 停用，1 启用', 'INT'], ['note', '部门备注', 'TEXT'],
      ];
      project.stateSnapshot.dbTables = [{ id: 'dept-entity', tableName: 't_dept', cnName: '部门', description: '隔离测试', domain: '基础资料域 (MDM)', sharedByMenus: [],
        columns: fields.map(([name, comment, dataType]) => ({ id: 'column-' + name, name, comment, dataType, nullable: name === 'parent_no' })) }];
      project.stateSnapshot.tableRows = { 'dept-entity': [
        { id:'record-a', dept_no:'HQ', parent_no:null, name:'总部', zone:'北区', quota:12, enabled:1, note:'总览' },
        { id:'record-b', dept_no:'RD', parent_no:'HQ', name:'研发部', zone:'北区', quota:8, enabled:0, note:'研发' },
        { id:'record-c', dept_no:'OPS', parent_no:'HQ', name:'运维部', zone:'南区', quota:4, enabled:1, note:'运维' },
      ] };
    }
    if (chartsScenario) {
      project.stateSnapshot.dbTables = [{ id: 'sales-entity', tableName: 't_region_sales', cnName: '地区销售记录', domain: '基础资料域 (MDM)', description: '销售额单位为万元，按地区求和', sharedByMenus: [], columns: [{ id: 'region-column', name: 'sales_region', dataType: 'TEXT', nullable: false, comment: '销售地区' }, { id: 'amount-column', name: 'sales_amount', dataType: 'DECIMAL', nullable: false, comment: '销售额（万元）' }] }];
      project.stateSnapshot.tableRows = { 'sales-entity': [{ id: 'sales-1', sales_region: '华东', sales_amount: 10 }, { id: 'sales-2', sales_region: '华南', sales_amount: 20 }, { id: 'sales-3', sales_region: '华东', sales_amount: 30 }] };
    }
    if (growthScenario) {
      const fields = ['profit', 'contract', 'salary', 'trip'];
      const values = [[100,120,80,160,200,180,240,300], [1000,1200,1500,1400,1800,2100,2400,2800], [400,420,450,460,480,500,540,560], [80,100,90,120,110,130,140,150]];
      project.stateSnapshot.dbTables = [{ id: 'quarter-records', tableName: 't_quarter_records', cnName: '季度经营', domain: '基础资料域 (MDM)', description: '连续八个真实标注年份的季度；已有环比同比列定义，但历史记录尚未提供这些派生字段', sharedByMenus: [], columns: [
        { id: 'quarter-column', name: 'quarter', dataType: 'TEXT', nullable: false, comment: '季度，格式 YYYY-QN' },
        ...fields.flatMap(name => ['', '_qoq_rate', '_yoy_rate'].map(suffix => ({ id: `${name}${suffix}-column`, name: `${name}${suffix}`, dataType: 'DECIMAL', nullable: false, comment: `${name}${suffix}` }))),
      ] }];
      project.stateSnapshot.tableRows = { 'quarter-records': Array.from({length:8}, (_,i) => ({ id: `quarter-${i+1}`, quarter: `${2025+Math.floor(i/4)}-Q${i%4+1}`, ...Object.fromEntries(fields.map((field,j) => [field,values[j][i]])) })) };
      project.stateSnapshot.pageSources.main = 'export default function Page(){return <Page pfId="root" title="季度经营"><Text pfId="content">Keep this</Text><LineChart pfId="existing-profit" title="利润趋势" source="table" table="quarter-records" dimension="quarter" metrics={[{field:"profit",label:"利润"}]}/></Page>}';
    }
    h.loadProjectFromBinaryPayload(project);
    const info = await runtime.connect();
    const session = await runtime.session({
      projectId: project.meta.projectId,
      pageId: "main",
    });
    const provider = session.models.currentModelId.split(":")[0];
    const alternate = session.models.availableModels.find(
      (m) =>
        m.modelId.startsWith(provider + ":") &&
        m.modelId !== session.models.currentModelId,
    );
    if (alternate && !customScenario && !chartsScenario && !growthScenario && !tableScenario) {
      const changed = await runtime.setModel({
        projectId: session.projectId,
        pageId: session.pageId,
        modelId: alternate.modelId,
      });
      assert.equal(changed.models.currentModelId, alternate.modelId);
      // Hermes can expose a custom model only while it is current. If it is no
      // longer offered after switching, continue this isolated test with the
      // explicitly selected catalogue model instead of sending an invalid ID.
      if (changed.models.availableModels.some(m => m.modelId === session.models.currentModelId)) {
        await runtime.setModel({
          projectId: session.projectId,
          pageId: session.pageId,
          modelId: session.models.currentModelId,
        });
      }
    }
    const before = h.captureProjectPayload(),
      revision = h.projectRevision();
    const result = await runtime.execute({
      projectId: session.projectId,
      pageId: session.pageId,
      snapshot: h.projectContext(),
      prompt: tableScenario
        ? h.buildProtoFlowHermesSkillMarkdown(project.stateSnapshot.dbTables, [], []) + '\n请在当前 main 页保留原有说明，增加上下两张绑定现有部门数据的表格。上表按部门编号和上级部门编号展示组织树，默认全展开。下表为平铺部门清单：点行首能展开本行备注，相邻相同区域纵向合并；编制人数用数字框，启用状态用下拉框，选项为停用（数字 0）和启用（数字 1），都在单元格编辑。下表的名称和部门编号两列按这个顺序紧邻，只为总部这一条记录横向合并这两列。请实际读取字段和记录后生成。仅调整此页，保留表结构和数据，无需询问。'
        : growthScenario
        ? h.buildProtoFlowHermesSkillMarkdown(project.stateSnapshot.dbTables, [], []) + '\n这是隔离测试工程，当前页面 main。保留原说明和利润趋势图，继续追加利润、合同金额、工资总额、出差费用四张环比/同比折线图。每张展示 2026-Q1 至 2026-Q4，两个系列名称分别包含“环比”“同比”。原始金额字段依次为 profit、contract、salary、trip；基于工程已保存的八个季度记录，按 (本期金额-基期金额)/基期金额*100 计算百分数，环比基期是上一季度，同比基期是去年同季。不要假定表结构中的 rate 字段已有数据，也不要修改表结构和原始记录。允许把有明确数据来源的计算结果作为当前快照的自定义图表数据，页面注明口径和更新限制。禁止生成示例数值；读表记录、检查页面后再提交，仅通过项目工具完成，无需询问。'
        : chartsScenario
        ? h.buildProtoFlowHermesSkillMarkdown(project.stateSnapshot.dbTables, [], []) + '\n这是隔离测试工程，当前页面是 main。请保留页面原有说明，增加一张各地区销售额对比图和一张占比图；采用现有地区销售记录表，按 sales_region 分组，对 sales_amount 求和，单位为万元。图表并排摆放，配色协调。不要修改表结构、数据和已有 pfId，不要新增菜单。只通过项目工具实现，无需询问。'
        : customScenario
        ? h.buildProtoFlowHermesSkillMarkdown(project.stateSnapshot.dbTables, [], []) + '\n这是隔离的测试工程，当前页面 ID 是 main。请保留现有客户表格，补上按客户名称查询。在表格上方加入一个两排三列的座位选择示意区域，选中状态清楚，点击座位打开显示座位编号的详情弹框；弹框可关闭。座位只是演示，不写入客户表。普通控件维持项目风格。不要新增菜单或改变客户表结构，保留原有 pfId。演示座位编号授权自行定义，无需询问。'
        : materialScenario
        ? h.buildProtoFlowHermesSkillMarkdown([], [], []) + "\n这是一个隔离的空白测试项目。请帮我创建物料目录列表页面和新增物料弹框，绑定一张新的物料表。字段、分类、单位选项和编码方式都授权你自定义为演示用途，无需询问。列表需要查询、新增按钮和分页；弹框保存后关闭并刷新列表，取消不保存。保留原 main 页面，另建菜单页，不要将弹框建成独立菜单。先读取项目和所需组件契约，只通过 protoflow 工具提交，禁止文件和 shell 工具。"
        : "This is an isolated ProtoFlow integration test. Call protoflow_get_project, then protoflow_get_page_tsx for pageId main. Use protoflow_apply_tsx_patch to change ONLY the Page title to HERMES_SMOKE_OK, preserving every pfId and the child. Do not use filesystem/shell tools or modify other project data. Then give a short summary.",
    });
    assert.ok(
      result.operations.some((o) => o.tool === "protoflow_apply_tsx_patch"),
      `Hermes must call the real page tool. Diagnostics: ${JSON.stringify({ model: result.modelId, toolCalls, deniedPermissions, questions, reply: result.text.slice(-3000) })}`,
    );
    h.applyProjectChanges(
      before,
      revision,
      result.operations,
      undefined,
      result.runId,
    );
    if (tableScenario) {
      const after = h.projectContext();
      assert.deepEqual(after.dbTables, before.stateSnapshot.dbTables);
      assert.deepEqual(after.tableRows, before.stateSnapshot.tableRows);
      const nodes = [];
      const visit = node => { nodes.push(node); node.children.filter(c => c.kind === 'node').forEach(visit); };
      visit(h.parsePageSource(after.pageSources.main).doc.root);
      assert.deepEqual(nodes.find(n => n.pfId === 'content'), h.parsePageSource(before.stateSnapshot.pageSources.main).doc.root.children[0]);
      const tables = nodes.filter(n => n.type === 'Table');
      assert.equal(tables.length, 2);
      const [tree, detail] = tables.map(n => n.props);
      assert.equal(tree.table, 'dept-entity');
      assert.equal(tree.rowMode, 'tree');
      assert.equal(tree.treeKeyField, 'dept_no');
      assert.equal(tree.parentField, 'parent_no');
      assert.equal(tree.defaultExpandAll, true);
      assert.equal(detail.table, 'dept-entity');
      assert.equal(detail.rowMode, 'expandable');
      assert.ok((detail.detailFields ?? detail.columns.map(c => c.dataIndex)).includes('note'));
      const columns = detail.columns;
      assert.equal(columns.find(c => c.dataIndex === 'zone')?.mergeRows, true);
      assert.equal(columns.find(c => c.dataIndex === 'quota')?.editor, 'number');
      const status = columns.find(c => c.dataIndex === 'enabled');
      assert.equal(status?.editor, 'select');
      assert.deepEqual(Object.fromEntries(status.editorOptions.map(o => [o.label,o.value])), { '停用':0, '启用':1 });
      assert.deepEqual(detail.cellMerges, [{rowIds:['record-a'],fields:['name','dept_no']}]);
      assert.equal(columns[columns.findIndex(c => c.dataIndex === 'name') + 1]?.dataIndex, 'dept_no');
      for (const tool of ['protoflow_get_contracts','protoflow_get_table_rows']) assert.ok(toolCalls.some(call => call.includes(tool)), `Missing tool: ${tool}`);
    } else if (customScenario) {
      const after = h.projectContext();
      if (process.env.PFLOW_HERMES_SMOKE_SOURCE) fs.writeFileSync(process.env.PFLOW_HERMES_SMOKE_SOURCE, after.pageSources.main);
      assert.deepEqual(after.dbTables, before.stateSnapshot.dbTables);
      assert.deepEqual(after.tableRows, before.stateSnapshot.tableRows);
      assert.deepEqual(after.designerPages, before.stateSnapshot.designerPages);
      const nodes = [];
      const visit = node => { nodes.push(node); node.children.filter(c => c.kind === 'node').forEach(visit); };
      visit(h.parsePageSource(after.pageSources.main).doc.root);
      const beforeTable = h.parsePageSource(before.stateSnapshot.pageSources.main).doc.root.children[0];
      assert.deepEqual(nodes.find(n => n.pfId === 'customer-grid'), beforeTable, 'Existing table must remain standard and unchanged');
      assert.ok(nodes.some(n => n.type === 'QueryForm' && n.props.target === 'customer-grid' && n.props.fields.some(f => f.name === 'customer_name')) || nodes.some(n => n.type === 'SearchInput' && n.props.target === 'customer-grid'));
      const freeforms = nodes.filter(n => n.type === 'Freeform');
      assert.equal(freeforms.length, 1, 'Only the seat region should use Freeform');
      assert.ok(freeforms[0].props.source.includes('emit('));
      assert.ok(freeforms[0].props.onAction.calls.some(c => c.name === 'openModal'));
      assert.ok(nodes.some(n => n.type === 'Modal'));
      // Hermes abbreviates long display titles with a hash; these are log labels,
      // not business IDs or the native MCP tool names used for dispatch.
      for (const tool of ['protoflow_get_implement', 'protoflow_inspect_page', 'protoflow_get_contracts']) assert.ok(toolCalls.some(call => call.includes(tool)), `Missing actual tool: ${tool}`);
      const generatedPage = path.join(dataDir, 'generated-page.tsx');
      fs.writeFileSync(generatedPage, after.pageSources.main);
      const preview = spawnSync(process.execPath, [path.join(__dirname, 'ai-implementation-preview.cjs'), generatedPage], { encoding: 'utf8', timeout: 45000 });
      assert.equal(preview.status, 0, preview.error?.message || preview.stdout + preview.stderr);
      console.log(preview.stdout.trim());
    } else if (growthScenario) {
      const after = h.projectContext();
      if (process.env.PFLOW_HERMES_SMOKE_SOURCE) fs.writeFileSync(process.env.PFLOW_HERMES_SMOKE_SOURCE, after.pageSources.main);
      assert.deepEqual(after.dbTables, before.stateSnapshot.dbTables);
      assert.deepEqual(after.tableRows, before.stateSnapshot.tableRows);
      const nodes = [];
      const visit = node => { nodes.push(node); node.children.filter(c => c.kind === 'node').forEach(visit); };
      visit(h.parsePageSource(after.pageSources.main).doc.root);
      const initial = h.parsePageSource(before.stateSnapshot.pageSources.main).doc.root;
      for (const node of initial.children) assert.deepEqual(nodes.find(n => n.pfId === node.pfId), node, 'existing page content is preserved');
      const charts = nodes.filter(n => n.type === 'LineChart' && n.pfId !== 'existing-profit');
      assert.equal(charts.length, 4);
      const records = before.stateSnapshot.tableRows['quarter-records'];
      for (const [field, title] of [['profit','利润'], ['contract','合同'], ['salary','工资'], ['trip','出差']]) {
        const chart = charts.find(n => n.props.title.includes(title));
        assert.ok(chart, title); assert.equal(chart.props.source, 'inline'); assert.equal(chart.props.metrics.length, 2);
        assert.equal(chart.props.data.length, 4);
        for (let i=4; i<8; i++) {
          const row = chart.props.data.find(row => row[chart.props.dimension] === records[i].quarter);
          assert.ok(row, records[i].quarter);
          for (const [label, offset] of [['环比',1], ['同比',4]]) {
            const metric = chart.props.metrics.find(metric => metric.label.includes(label)); assert.ok(metric, label);
            const expected = (records[i][field] - records[i-offset][field]) / records[i-offset][field] * 100;
            assert.ok(Math.abs(row[metric.field] - expected) < 0.011, `${field} ${records[i].quarter} ${label}: ${row[metric.field]} vs ${expected}`);
          }
        }
      }
      assert.match(after.pageSources.main, /快照|静态/);
      for (const tool of ['protoflow_inspect_page', 'protoflow_get_table_rows']) assert.ok(toolCalls.some(call => call.includes(tool)), `Missing actual tool: ${tool}`);
    } else if (chartsScenario) {
      const after = h.projectContext();
      if (process.env.PFLOW_HERMES_SMOKE_SOURCE) fs.writeFileSync(process.env.PFLOW_HERMES_SMOKE_SOURCE, after.pageSources.main);
      assert.deepEqual(after.dbTables, before.stateSnapshot.dbTables);
      assert.deepEqual(after.tableRows, before.stateSnapshot.tableRows);
      assert.deepEqual(after.designerPages, before.stateSnapshot.designerPages);
      const nodes = [];
      const visit = node => { nodes.push(node); node.children.filter(c => c.kind === 'node').forEach(visit); };
      visit(h.parsePageSource(after.pageSources.main).doc.root);
      assert.deepEqual(nodes.find(n => n.pfId === 'content'), h.parsePageSource(before.stateSnapshot.pageSources.main).doc.root.children[0]);
      assert.equal(nodes.some(n => n.type === 'Freeform'), false);
      const charts = nodes.filter(n => ['BarChart', 'PieChart', 'DonutChart'].includes(n.type));
      assert.equal(charts.length, 2);
      assert.ok(charts.some(n => n.type === 'BarChart'));
      assert.ok(charts.some(n => ['PieChart', 'DonutChart'].includes(n.type)));
      for (const chart of charts) {
        assert.equal(chart.props.source, 'table'); assert.equal(chart.props.table, 'sales-entity');
        assert.equal(chart.props.dimension, 'sales_region'); assert.equal(chart.props.metrics[0].field, 'sales_amount');
        assert.equal(chart.props.aggregation, 'sum');
      }
      // This task specifies comparison, proportions and aggregation. Evaluate
      // correct material/data choices, not an unnecessary extra guide lookup.
      for (const tool of ['protoflow_inspect_page', 'protoflow_get_contracts', 'protoflow_get_table_rows']) assert.ok(toolCalls.some(call => call.includes(tool)), `Missing actual tool: ${tool}`);
    } else if (materialScenario) {
      const after = h.projectContext();
      const created = after.designerPages.filter(p => p.pageId !== "main");
      assert.equal(created.length, 1, "List and its Modal must share one menu page");
      assert.equal(after.dbTables.length, 1, "A real material table must be created");
      assert.deepEqual(after.dbTables[0].sharedByMenus.map(m => m.pageId), [created[0].pageId]);
      const source = after.pageSources[created[0].pageId];
      for (const expected of [/<Table\b/, /<Modal\b/, /<Form\b/, /openModal\(/, /submitForm\(/, /refresh\(/, /closeOverlay\(/])
        assert.match(source, expected);
      assert.equal(after.pageSources.main, before.stateSnapshot.pageSources.main);
    } else assert.match(h.projectContext().pageSources.main, /HERMES_SMOKE_OK/);
    assert.ok(chunks > 0);
    h.undoProjectChange(result.runId);
    assert.equal(
      h.projectContext().pageSources.main,
      before.stateSnapshot.pageSources.main,
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          scenario: tableScenario ? 'tree-detail-merged-editable-tables' : growthScenario ? 'append-four-growth-charts-from-saved-quarterly-records' : chartsScenario ? 'table-bound-sales-charts-with-explicit-aggregation' : customScenario ? 'standard-query-and-custom-seating' : materialScenario ? "material-list-and-add-dialog" : "page-title",
          version: info.version,
          modelUsed: result.modelId,
          modelCount: session.models.availableModels.length,
          switchedModel: Boolean(alternate) && !customScenario && !chartsScenario && !growthScenario && !tableScenario,
          streamChunks: chunks,
          toolCalls,
          operations: result.operations.length,
          validatedAndUndone: true,
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(timeout);
    runtime.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
