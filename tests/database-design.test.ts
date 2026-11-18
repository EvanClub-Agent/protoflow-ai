import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DBColumnSchema, DBTableSchema } from '../src/store/useProtoStore';
import { reviewDatabaseDesign } from '../src/proto/database/designReview';
import { prepareProjectChanges } from '../src/services/hermesProject';
import { createProjectPayload } from '../src/services/projectStorage';
import { describeChanges } from '../src/services/projectChangeReview';
import { validateProjectPayload } from '../src/services/projectValidation';
import { generateUnpackedGitFiles, encodePflowBinary, decodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { buildProtoFlowHermesSkillMarkdown } from '../src/store/useHermesStore';

const { atomicWrite, callTool } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
const field = (name: string, props: Partial<DBColumnSchema> = {}): DBColumnSchema =>
  ({ id: 'col-' + name, name, nullable: false, dataType: 'BIGINT', comment: '', ...props });
const fk = (name: string, references: string, props: Partial<DBColumnSchema> = {}) =>
  field(name, { isForeignKey: true, references, ...props });
const table = (entity: string, ...columns: DBColumnSchema[]): DBTableSchema => ({
  id: 'entity-' + entity, tableName: 't_' + entity, cnName: entity, domain: '采购管理域 (SRM)',
  description: '', sharedByMenus: [], modeling: {entity, grain: '每行一个 ' + entity, reason: '记录独立的 ' + entity + ' 业务事实'},
  columns: [field('id', {isPrimaryKey: true}), ...columns],
});
const upsert = (table: DBTableSchema) => ({tool: 'protoflow_upsert_db_table', args: {table}});
const columnOp = (table: DBTableSchema, column: DBColumnSchema) => ({tool:'protoflow_upsert_db_column',args:{tableId:table.id,column}});
function project(...tables: DBTableSchema[]) {
  const base = createProjectPayload({projectId:'design',projectName:'建模',templateId:'blank_project',fileName:'design.pflow',storageDir:'/tmp',createdAt:'2026-11-03',updatedAt:'2026-11-03',pageCount:0,tableCount:0,stickyCount:0});
  base.stateSnapshot.dbTables = tables;
  return base;
}

test('project plans and single-page chats both instruct Hermes to compare entities, grains and aggregation paths', () => {
  for (const surface of ['project', 'menu'] as const) {
    const prompt = buildProtoFlowHermesSkillMarkdown([],[],[],surface);
    for (const concept of ['projectPlan','零建表','modeling.entity','行粒度','多对多','分别按目标粒度聚合','澄清']) assert.ok(prompt.includes(concept));
  }
});

test('host guards both upsert tools against new structural errors while retaining unrelated historical findings', () => {
  const order = table('order',field('business_no'));
  const line = table('line',fk('order_id','t_order(id)'));
  const old = {...table('legacy'), modeling:undefined, columns:[]};
  const base = project(old, order, line);
  assert.ok(reviewDatabaseDesign(base.stateSnapshot.dbTables).tableErrors.some(m => m.includes('t_legacy 缺少主键')));
  assert.doesNotThrow(() => prepareProjectChanges(base,[columnOp(line, field('quantity'))]));
  for (const [op,pattern] of [
    [upsert({...table('another'), modeling:undefined}), /建表依据/],
    [upsert({...table('another'), columns:[]}), /缺少主键/],
    [upsert({...table('another'), modeling:order.modeling}), /重复声明业务实体/],
    [upsert({...order, modeling:undefined}), /建表依据/],
    [columnOp(order,field('id',{nullable:true,isPrimaryKey:true})), /主键，必须非空/],
    [columnOp(order,field('id',{dataType:'INT',isPrimaryKey:true})), /t_line.order_id.*类型声明不一致/],
    [columnOp(line,fk('order_id','entity-order(id)')), /无法解析/],
    [columnOp(line,fk('order_id','t_order(business_no)')), /缺少单列唯一性/],
    [columnOp(line,field('order_id',{isForeignKey:true})), /未填写/],
    [columnOp(line,field('order_id',{references:'t_order(id)'})), /isForeignKey=true/],
    [columnOp(line,fk('order_id','t_order(id)',{foreignKeyOptions:{cardinality:'1:1'}})), /引用列需要单列主键或 UNIQUE/],
  ] as const) assert.throws(() => prepareProjectChanges(base,[op]), pattern);
  assert.deepEqual(base.stateSnapshot.dbTables, [old, order, line]);
  assert.doesNotThrow(() => prepareProjectChanges(base, [
    columnOp(line,fk('order_id','t_order(business_no)')),
    columnOp(order,field('business_no',{isUnique:true})),
  ]));
});

test('MCP stages forward FKs, returns exact diagnostics and cannot authorize a schema write with a prior turn read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'database-design-')), file = path.join(dir,'context.json');
  const order = table('order'), line = table('line',fk('order_id','t_order(id)',{foreignKeyOptions:{cardinality:'1:N'}}));
  const base = project();
  try {
    atomicWrite(file,{active:true,runId:'new',schemaCatalogReadRunId:'old',snapshot:base.stateSnapshot,operations:[]});
    assert.throws(() => callTool(file,upsert(line).tool,upsert(line).args), /本轮完整表目录/);
    callTool(file,'protoflow_get_project',{});
    const pristine = fs.readFileSync(file,'utf8');
    const { modeling: _model, ...unreviewed } = line;
    assert.throws(() => callTool(file,upsert(line).tool,{table:unreviewed}),/建表依据/);
    assert.equal(fs.readFileSync(file,'utf8'),pristine);
    const pending = callTool(file,upsert(line).tool,upsert(line).args);
    assert.match(pending.databaseDesignReview.relationErrors.join(' '), /t_line.order_id.*t_order\(id\)/);
    let journal = JSON.parse(fs.readFileSync(file,'utf8')).operations;
    assert.throws(() => prepareProjectChanges(base,journal), /t_line.order_id/);
    callTool(file,upsert(order).tool,upsert(order).args);
    const catalogue = callTool(file,'protoflow_get_project',{});
    assert.deepEqual(catalogue.databaseDesignReview, {tableErrors:[],relationErrors:[],risks:[]});
    journal = JSON.parse(fs.readFileSync(file,'utf8')).operations;
    assert.deepEqual(prepareProjectChanges(base,journal).next.stateSnapshot.dbTables,catalogue.dbTables);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('related facts remain valid while sibling and multi-level joins and structural clones get specific review notes', () => {
  const order = table('order');
  const line = table('line',fk('order_id','t_order(id)'));
  const payment = table('payment',fk('order_id','t_order(id)'),field('amount'));
  const delivery = table('delivery',fk('line_id','t_line(id)'));
  const profile = table('profile',fk('order_id','t_order(id)',{isUnique:true,foreignKeyOptions:{cardinality:'1:1'}}));
  const another = table('refund',fk('order_id','t_order(id)'),field('amount'));
  const candidate = prepareProjectChanges(project(order, line), [payment, delivery, profile, another].map(upsert));
  const risks = candidate.databaseRisks.join('\n');
  assert.match(risks,/t_order 的多行分支.*t_line.*t_payment.*行数可能相乘/);
  assert.match(risks,/t_order → t_line → t_delivery/);
  assert.match(risks,/t_payment 与 t_refund.*amount、order_id/);
  assert.doesNotMatch(risks,/t_profile/);
  const model = generateUnpackedGitFiles(candidate.next);
  assert.match(model.find(f=>f.relativePath==='SPEC.md')!.content,/t_order → t_line → t_delivery/);
  assert.deepEqual(JSON.parse(model.find(f=>f.relativePath.endsWith('t_order.table.json'))!.content).modeling,order.modeling);
});

test('a 1:1 extension preserves grain on the path to an independent collection', () => {
  const order = table('order'), line = table('line',fk('order_id','t_order(id)'));
  const profile = table('profile',fk('order_id','t_order(id)',{isUnique:true}));
  const activity = table('activity',fk('profile_id','t_profile(id)'));
  const notes = reviewDatabaseDesign([order,line,profile,activity]).risks.join(' ');
  assert.match(notes,/t_order 的多行分支 t_line.order_id、t_profile.order_id → t_activity.profile_id/);
});

test('junctions may use a composite PK but a single FK cannot target just part of it', () => {
  const product = table('product'), order = table('order');
  const junction = {...table('item'),columns:[
    fk('order_id','t_order(id)',{isPrimaryKey:true}),fk('product_id','t_product(id)',{isPrimaryKey:true})]};
  const result = prepareProjectChanges(project(), [junction,product,order].map(upsert));
  const sql = generateUnpackedGitFiles(result.next).find(f=>f.relativePath==='database/schema.sql')!.content;
  assert.ok(sql.includes('PRIMARY KEY (`order_id`, `product_id`)'));
  assert.ok(sql.indexOf('ALTER TABLE') > sql.lastIndexOf('CREATE TABLE'));
  assert.ok(sql.includes('FOREIGN KEY (`product_id`) REFERENCES `t_product` (`id`)'));
  assert.throws(() => prepareProjectChanges(result.next,[upsert(table('receipt',fk('item_order','t_item(order_id)')))]), /缺少单列唯一性/);
});

test('composite business keys remain separate from the PK through review, archive and developer handoff', () => {
  const quote = table('quote',field('lot_id'),field('supplier_id'),field('round_no'));
  quote.columns[0].name = 'quote_id';
  const key = {name:'uq_quote_round',columnIds:quote.columns.slice(1).map(c=>c.id)};
  quote.uniqueConstraints = [key];
  const base = project(), candidate = prepareProjectChanges(base,[upsert(quote)]).next;
  assert.match(describeChanges(base.stateSnapshot,candidate.stateSnapshot,[upsert(quote)]).join('\n'), /新增唯一约束 t_quote.uq_quote_round（lot_id、supplier_id、round_no）/);
  const reopened = decodePflowBinary(encodePflowBinary(candidate));
  validateProjectPayload(reopened);
  const files = generateUnpackedGitFiles(reopened);
  assert.deepEqual(JSON.parse(files.find(f=>f.relativePath.endsWith('t_quote.table.json'))!.content).uniqueConstraints,[key]);
  const sql = files.find(f=>f.relativePath==='database/schema.sql')!.content;
  assert.ok(sql.includes('PRIMARY KEY (`quote_id`)'));
  assert.ok(sql.includes('CONSTRAINT `uq_quote_round` UNIQUE (`lot_id`, `supplier_id`, `round_no`)'));
  assert.equal(sql.match(/\bUNIQUE\b/g)?.length,1);
  assert.match(files.find(f=>f.relativePath==='SPEC.md')!.content,/uq_quote_round（lot_id、supplier_id、round_no）/);
  assert.throws(()=>prepareProjectChanges(reopened,[upsert(table('item',fk('lot_id','t_quote(lot_id)')))]), /缺少单列唯一性/);
  assert.throws(()=>prepareProjectChanges(reopened,[upsert({...quote,uniqueConstraints:undefined})]), /遗漏 uniqueConstraints/);
  const removal=upsert({...quote,uniqueConstraints:[]});
  const removed=prepareProjectChanges(reopened,[removal]).next;
  assert.match(describeChanges(reopened.stateSnapshot,removed.stateSnapshot,[removal]).join('\n'),/移除唯一约束/);
  const nullable=prepareProjectChanges(reopened,[columnOp(quote,field('round_no',{nullable:true}))]);
  assert.match(nullable.databaseRisks.join('\n'),/uq_quote_round.*可空字段 round_no/);
});

test('invalid key member IDs and ambiguous or redundant declarations cannot enter through MCP or an archive', () => {
  const quote = table('quote',field('lot_id'),field('supplier_id'),field('round_no'));
  const key = {name:'uq_pair',columnIds:['col-lot_id','col-round_no']};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quote-keys-')), file=path.join(dir,'context.json');
  try {
    atomicWrite(file,{active:true,runId:'test',snapshot:project().stateSnapshot,operations:[]});
    callTool(file,'protoflow_get_project',{});
    const pristine=fs.readFileSync(file,'utf8');
    for (const keys of [
      [{...key,columnIds:['lot_id','col-round_no']}],
      [{...key,columnIds:['col-lot_id','col-lot_id']}],
      [{...key,columnIds:['col-id']}],
      [key,{name:'uq_reverse',columnIds:[...key.columnIds].reverse()}],
      [key,{name:'UQ_PAIR',columnIds:['col-supplier_id']}],
    ]) {
      const invalid={...quote,uniqueConstraints:keys};
      assert.throws(()=>callTool(file,upsert(invalid).tool,upsert(invalid).args),/重复|未知|unique/i);
      assert.equal(fs.readFileSync(file,'utf8'),pristine);
      assert.throws(()=>validateProjectPayload(project(invalid)), /重复|未知|unique/i);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('a rule the schema cannot enforce stays visibly pending rather than generating a misleading unconditional constraint', () => {
  const quote=table('quote',field('lot_id'),field('supplier_id'));
  const pending={rule:'同一供应商在每个标段只能有一份生效报价，草稿可重复',reason:'当前仅支持无条件的唯一约束'};
  quote.modeling={...quote.modeling!,pendingRules:[pending]};
  const op=upsert(quote), base=project();
  const result=prepareProjectChanges(base,[op]);
  assert.match(result.databaseRisks.join('\n'),/未落实的业务规则.*草稿可重复.*当前 DDL 无法保证/);
  const reopened=decodePflowBinary(encodePflowBinary(result.next)); validateProjectPayload(reopened);
  const files=generateUnpackedGitFiles(reopened);
  assert.ok(files.find(f=>f.relativePath==='SPEC.md')!.content.includes(pending.rule));
  const ddl=files.find(f=>f.relativePath==='database/schema.sql')!.content;
  assert.match(ddl,/1 项业务规则未由本 DDL 实现/); assert.doesNotMatch(ddl,/\bUNIQUE\b/);
  assert.throws(()=>prepareProjectChanges(reopened,[upsert({...quote,modeling:{...quote.modeling!,pendingRules:undefined}})]),/遗漏 modeling.pendingRules/);
  assert.throws(()=>validateProjectPayload(project({...quote,modeling:{...quote.modeling!,pendingRules:[{...pending,reason:' '}]}})),/pendingRules/);
});
