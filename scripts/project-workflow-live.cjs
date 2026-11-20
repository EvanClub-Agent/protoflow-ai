// Real Hermes smoke test, isolated from the user's open project and transcript.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { hermesTestEnvironment } = require('./hermes-test-environment.cjs');
const { HermesRuntime } = require('../electron/hermes-runtime.cjs');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-workflow-live-'));
const storage = new Map();
global.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) } };
const compiled = buildSync({ stdin: { contents: `export * from './src/services/projectWorkflow'; export * from './src/services/projectStorage'; export * from './src/store/useProtoStore'; export * from './src/store/useHermesStore'; export * from './src/store/useAiChatStore'; export * from './src/services/hermesProject'; export {runProjectAi} from './src/services/hermesBridge'; export {analyzeProject} from './src/services/projectAnalysis'; export {generateUnpackedGitFiles} from './src/utils/pflowBinaryCodec';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'] });
const harness = new Module('workflow-live'); harness.filename = path.join(root,'scripts/.workflow-live.cjs'); harness.paths = Module._nodeModulePaths(root); harness._compile(compiled.outputFiles[0].text, harness.filename);
const h = harness.exports, listeners = new Set();
const runtime = new HermesRuntime({ dataDir: dir, emit: event => {
  for (const listener of listeners) listener(event);
  if (event.type === 'session-update' && event.update.sessionUpdate === 'tool_call') console.log('Tool:', event.update.title);
  if (event.type === 'permission') runtime.respondPermission({ id: event.id, optionId: null });
  // Answers are only for this synthetic test project, never the user's workflow.
  if (event.type === 'question') runtime.respondQuestion({ id: event.id, answer: event.answerSchema.type === 'array' ? (event.answerSchema.items?.enum ? [event.answerSchema.items.enum[0]] : ['按测试需求实现']) : (event.answerSchema.enum ? event.answerSchema.enum[0] : '只做测试需求描述中的页面布局，不增加其他业务范围') });
} });
window.protoflowDesktop = { hermes: { onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); }, session: input => runtime.session(input), sync: input => runtime.sync(input), execute: input => runtime.execute(input), cancel: input => runtime.cancel(input) } };
const timeout = setTimeout(() => { console.error('Live test timeout'); runtime.close(); process.exit(1); }, process.argv.includes('--shared-model') ? 420000 : 240000);
(async () => { try {
  const project = h.createProjectPayload({ projectId: 'workflow-live', projectName: '项目流程测试', templateId:'blank_project',storageDir:dir,fileName:'test.pflow',createdAt:'2026-11-02',updatedAt:'2026-11-02',pageCount:0,tableCount:0,stickyCount:0 });
  h.loadProjectFromBinaryPayload(project); h.useProtoStore.getState().setViewMode('project_ai');
  await runtime.connect(hermesTestEnvironment()); h.useHermesStore.setState({status:'running'});
  const projectId = project.meta.projectId;
  h.useAiChatStore.getState().switchConversation({kind:'project',projectId});
  if (process.argv.includes('--pending-rule')) {
    await h.discussProject(projectId, '请直接提交采购报价的表设计供确认，本轮仅建一张 quote 表，无页面和外键。每行是一份报价，主键 quote_id，非空字段 lot_id、supplier_id、status。状态为 draft 或 effective。草稿允许多份，只有同一标段同一供应商的生效报价至多一份。若工具无法精确表达这项约束，请保留完整要求交付给开发，不改变该业务口径。');
    const review = h.useAiChatStore.getState().messages.at(-1);
    assert.ok(review.projectChangeReview);
    await h.resolveProjectReview(projectId, review.id, true);
    const payload=h.captureProjectPayload();
    assert.equal(payload.stateSnapshot.dbTables.length,1);
    const [quote]=payload.stateSnapshot.dbTables;
    assert.ok(quote.modeling.pendingRules?.some(r=>r.rule && r.reason));
    assert.ok(!quote.uniqueConstraints?.length && !quote.columns.some(c=>c.isUnique));
    const ddl=h.generateUnpackedGitFiles(payload).find(f=>f.relativePath==='database/schema.sql').content;
    assert.ok(ddl.includes('未由本 DDL 实现') && !/\bUNIQUE\b/.test(ddl));
    const audit=review.requirementAudit;
    assert.ok(audit.lines.some(line=>line.includes('草稿') && line.includes('待实现') && line.includes('应允许') && line.includes('应拒绝')));
    assert.deepEqual(audit.conflicts,[]);
    console.log(JSON.stringify({requirementReview:audit}));
    return;
  }
  if (process.argv.includes('--quote-key')) {
    await h.discussProject(projectId, '为采购报价建立一张 quote 表，仅建模，无需菜单和示例数据。主键 quote_id BIGINT，同一标段 lot_id、供应商 supplier_id、轮次 round_no 只能有一份报价，按此顺序命名唯一约束 uq_quote_round。这三列均为非空整数，分别可重复。项目暂无标段和供应商表，本轮不建外键。');
    const review = h.useAiChatStore.getState().messages.at(-1);
    assert.ok(review.projectChangeReview);
    await h.resolveProjectReview(projectId, review.id, true);
    const payload = h.captureProjectPayload(), tables = payload.stateSnapshot.dbTables;
    assert.equal(tables.length, 1);
    assert.ok(!tables[0].modeling.pendingRules?.length, '本轮排除外键不能推断为后续义务');
    assert.deepEqual(tables[0].columns.filter(c => c.isPrimaryKey).map(c => c.name), ['quote_id']);
    const ddl = h.generateUnpackedGitFiles(payload).find(f => f.relativePath === 'database/schema.sql').content;
    assert.ok(ddl.includes('CONSTRAINT `uq_quote_round` UNIQUE (`lot_id`, `supplier_id`, `round_no`)'));
    const audit=review.requirementAudit;
    assert.ok(audit.lines.some(line=>line.includes('uq_quote_round') && line.includes('被 uq_quote_round 拒绝')));
    assert.deepEqual(audit.conflicts,[]);
    console.log(JSON.stringify({quoteDDL: ddl, requirementReview:audit}));
    return;
  }
  if (process.argv.includes('--member-schema')) {
    h.useProtoStore.setState({mindmaps:{links:[], nodes:[{id:'member-flow',kind:'mindmap',title:'会员卡',parentId:null,source:'flowchart LR\n A[会员档案] --> B[查看卡号与会员姓名]'}]}});
    await h.discussProject(projectId, '按脑图设计一个只读的会员档案菜单（page-member），列出卡号和姓名。在同一份待确认方案里提交目录、页面方案以及一张绑定该菜单的数据表，确认后才生成页面。无需跨页、弹层、演示数据或其他功能。表 ID 为 t_mem_member，物理表名 mem_member，主键 card_no，姓名 member_name。', [], ['member-flow']);
    const review = h.useAiChatStore.getState().messages.at(-1);
    assert.ok(review.projectChangeReview);
    assert.equal(h.captureProjectPayload().stateSnapshot.dbTables.length, 0);
    await h.resolveProjectReview(projectId, review.id, true);
    const state = h.captureProjectPayload().stateSnapshot;
    assert.deepEqual(h.projectPlanProgress(), ['page-member']);
    const table = state.dbTables.find(t=>t.id==='t_mem_member');
    assert.deepEqual(table.sharedByMenus.map(b=>b.pageId), ['page-member']);
    assert.match(state.pageSources['page-member'], /table=["']t_mem_member["']/);
    console.log(JSON.stringify({ok:true, menu:state.designerPages[0].title, boundTable:table.id, generated:h.projectPlanProgress()}));
    return;
  }
  h.useProtoStore.setState({mindmaps:{links:[],nodes:[
    {kind:'mindmap',id:'overview-map',parentId:null,title:'范围一',source:'mindmap\n  root((任务列表))\n    显示任务名称和状态\n    标题列为任务名称'},
    {kind:'mindmap',id:'creation-map',parentId:null,title:'范围二',source:'mindmap\n  root((新建任务))\n    任务名称输入框\n    保存按钮'},
  ]}});
  const sharedModel = process.argv.includes('--shared-model');
  await h.discussProject('workflow-live','请按两张所选脑图，在任务目录下各规划一个页面，用各自根节点原文做菜单名。只需要这两页，需求明确，请保存完整方案。无需权限或真实数据接入。任务字段 id 为记录主键，title 为任务名称，status 为 todo/done。' + (sharedModel ? '新建任务须持久化，列表读取已登记的任务。提交待确认方案，确认后生成可用的两个页面。' : ''), [], ['overview-map','creation-map']);
  const review = h.useAiChatStore.getState().messages.at(-1);
  const proposal = review.projectChangeReview?.operations.find(op => op.tool === 'protoflow_set_project_plan')?.args.plan ?? h.useProtoStore.getState().projectPlan;
  assert.deepEqual(proposal?.pages.map(p=>p.title).sort(), ['任务列表','新建任务'].sort());
  assert.equal(Object.keys(h.captureProjectPayload().stateSnapshot.pageSources).length,0);
  // Confirm only this synthetic plan in the isolated harness.
  if (review.projectChangeReview) await h.resolveProjectReview(projectId, review.id, true);
  else await h.generateProject(projectId);
  assert.equal(h.projectPlanProgress().length,2);
  if (sharedModel) {
    const before = h.captureProjectPayload().stateSnapshot;
    assert.equal(before.dbTables.length, 1, '登记和查询同一事实应共用一张物理表');
    const [tasks] = before.dbTables;
    assert.ok(tasks.modeling.grain && tasks.modeling.reason);
    const bound = state => new Set(h.analyzeProject(state).usages.filter(u => u.pfId !== null && u.tableId === tasks.id).map(u => u.pageId));
    assert.equal(bound(before).size, 2, '使用实际页面组件的表绑定验收');
    await h.runProjectAi('在任务目录下新增一个独立菜单「已完成任务」，展示已登记且状态为 done 的任务，只读，显示任务名称和状态。本次只做这个菜单。', {pageId:before.activePageId});
    const after = h.captureProjectPayload().stateSnapshot;
    assert.deepEqual(after.dbTables.map(t => t.id), [tasks.id]);
    assert.equal(bound(after).size, 3);
    console.log(JSON.stringify({sharedTable:tasks.tableName, grain:tasks.modeling.grain, boundMenus:[...bound(after)]}));
  }
  const result = h.captureProjectPayload();
  console.log(JSON.stringify({ok:true,pages:result.stateSnapshot.designerPages.map(p=>p.title),folders:result.stateSnapshot.designerFolders.map(f=>f.title),generated:h.projectPlanProgress()}));
} catch(error) { console.error(error); process.exitCode=1; } finally {clearTimeout(timeout);runtime.close();fs.rmSync(dir,{recursive:true,force:true});} })();
