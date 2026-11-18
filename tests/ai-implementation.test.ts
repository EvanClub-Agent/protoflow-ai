import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getImplementationGuide, IMPLEMENTATION_SCENARIOS } from '../src/proto/ai/implementationGuide';
import { inspectPage } from '../src/proto/ai/pageInspection';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { getMaterialContracts, getActionContracts } from '../src/proto/registry/materialContract';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { editPageBlock } from '../src/proto/dsl/editBlock';
import { FREEFORM_DEFAULT_SOURCE } from '../src/proto/freeform/contract';
import type { DBTableSchema } from '../src/store/useProtoStore';
import type { ProtoNode } from '../src/proto/types';

const native = require(process.cwd() + '/electron/generated/material-contract.cjs');
const { callTool, atomicWrite, tools } = require(process.cwd() + '/electron/protoflow-mcp.cjs');
const table: DBTableSchema = {
  id: 'customer-entity', tableName: 't_customer', cnName: '客户', domain: '基础资料域 (MDM)', description: '', sharedByMenus: [],
  columns: [{ id: 'customer-name-column', name: 'customer_name', dataType: 'TEXT', nullable: false, comment: '客户名称' }],
};
const page = (children: string) => `export default function Page(){return <Page pfId="root">${children}</Page>}`;
const listing = page(`<Card pfId="group"><QueryForm pfId="query" target="grid" fields={[{name:"customer_name",type:"input",label:"客户"}]}/><Table pfId="grid" table="customer-entity" columns={[{title:"客户",dataIndex:"customer_name"}]} rowActions={[{label:"详情",onClick:()=>openDrawer("detail")}]}/></Card><Drawer pfId="detail-node" id="detail"><Descriptions pfId="details" table="customer-entity"/></Drawer>`);
const freeform = (extra = '') => page(`<Freeform pfId="free" source={${JSON.stringify(FREEFORM_DEFAULT_SOURCE)}} ${extra}/>`);

test('scenario guidance covers registered materials and only proposes existing runtime actions', () => {
  const materials = getMaterialContracts();
  const actions = getActionContracts();
  const covered = new Set<string>();
  for (const scenario of IMPLEMENTATION_SCENARIOS) {
    for (const name of scenario.components) { assert.ok(materials.some(c => c.name === name), name); covered.add(name); }
    for (const name of scenario.actions) assert.ok(actions.some(a => a.name === name), name);
  }
  assert.deepEqual(materials.filter(c => !covered.has(c.name)).map(c => c.name), []);
  const chosen = getImplementationGuide(['list', 'form', 'custom']);
  assert.deepEqual(native.getImplementationGuide(['list', 'form', 'custom']), chosen);
  assert.match(JSON.stringify(chosen), /数组值会被忽略/);
  assert.match(JSON.stringify(chosen), /不上传真实文件/);
  assert.throws(() => getImplementationGuide(['Chart']), /未知场景/);
});

test('page inspection grounds the selected scope, action targets and exact saved data without mutation', () => {
  const rows = { [table.id]: [{ customer_name: '甲' }] };
  const before = JSON.stringify(rows);
  const result = inspectPage(listing, [table], rows, 'grid');
  assert.deepEqual(native.inspectPage(listing, [table], rows, 'grid'), result);
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.runtimeVerified, false);
  assert.deepEqual(result.selected?.ancestors.map(n => n.pfId), ['root', 'group']);
  assert.deepEqual(result.selected?.subtreePfIds, ['grid']);
  assert.deepEqual(result.interactions, [{ pfId: 'grid', path: 'rowActions[0].onClick', calls: [{ name: 'openDrawer', args: ['detail'] }] }]);
  assert.deepEqual(result.bindings[0], { pfId: 'grid', tableId: table.id, tableExists: true, hasSavedRows: true, savedRowCount: 1 });
  assert.equal(JSON.stringify(rows), before);
  assert.throws(() => inspectPage(listing, [table], rows, 'detail'), /选中组件不存在/, 'overlay id cannot stand in for pfId');
  const invalid = listing.replace('table="customer-entity"', 'table="t_customer"');
  assert.match(inspectPage(invalid, [table], rows).validation.errors.join(' '), /未知表 t_customer/);
  assert.deepEqual(native.pageContractErrors(invalid, [table]), pageContractErrors(invalid, [table]));
});

test('inspection exposes prototype limits and separates missing preview data from intentionally empty data', () => {
  const source = freeform('table="customer-entity" columns={["customer_name"]}');
  assert.ok(inspectPage(source, [table], {}).warnings.some(w => w.code === 'freeform-data-missing'));
  const empty = inspectPage(source, [table], { [table.id]: [] });
  assert.equal(empty.bindings[0].savedRowCount, 0);
  assert.equal(empty.warnings.some(w => w.code === 'freeform-data-missing'), false);
  assert.ok(empty.warnings.some(w => w.code === 'freeform-runtime-unverified'));
  assert.match(inspectPage(source, [table], { [table.id]: [{ other_name: '乙' }] }).warnings.map(w => w.message).join(' '), /缺少字段 customer_name/);
  const incomplete = page('<QueryForm pfId="query" target="grid" fields={[{name:"date",type:"dateRange"},{name:"files",type:"upload"}]}/><Table pfId="grid"/><Button pfId="save">保存</Button>');
  const warnings = inspectPage(incomplete, [], {}).warnings.map(w => w.code);
  assert.ok(warnings.includes('query-array-filter-unimplemented'));
  assert.ok(warnings.includes('upload-demo-only'));
  assert.ok(warnings.includes('button-no-action'));
  assert.equal(inspectPage('broken source', [], {}).validation.valid, false);
});

test('MCP discovery and inspection are read-only and inspect the latest staged page; bad data bindings are rejected before staging', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-implementation-'));
  const file = path.join(dir, 'context.json');
  try {
    const context = { active: true, runId: 'run', projectId: 'project', readOnly: true, operations: [], snapshot: { pageSources: { main: listing }, tableRows: {}, dbTables: [table] } };
    atomicWrite(file, context);
    const before = fs.readFileSync(file, 'utf8');
    for (const name of ['protoflow_get_implementation_guide', 'protoflow_inspect_page']) assert.ok(tools.some((t: any) => t.name === name));
    assert.equal(callTool(file, 'protoflow_get_implementation_guide', {}).materialCount, getMaterialContracts().length);
    assert.equal(callTool(file, 'protoflow_inspect_page', { pageId: 'main', selectedPfId: 'group' }).selected.subtreePfIds.length, 3);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.throws(() => callTool(file, 'protoflow_apply_tsx_patch', { pageId: 'main', source: listing }), /read-only/);
    assert.throws(() => callTool(file, 'protoflow_inspect_page', { pageId: 'missing' }), /Unknown pageId/);
    context.readOnly = false;
    atomicWrite(file, context);
    const prior = fs.readFileSync(file, 'utf8');
    assert.throws(() => callTool(file, 'protoflow_apply_tsx_patch', { pageId: 'main', source: listing.replace('dataIndex:"customer_name"', 'dataIndex:"display_name"') }), /未知字段 customer-entity.display_name/);
    assert.equal(fs.readFileSync(file, 'utf8'), prior);
    callTool(file, 'protoflow_edit_page_block', { pageId: 'main', targetPfId: 'group', mode: 'append_children', tsx: '<Button pfId="open" onClick={()=>openDrawer("detail")}>查看</Button>' });
    const inspected = callTool(file, 'protoflow_inspect_page', { pageId: 'main' });
    assert.equal(inspected.validation.valid, true);
    assert.ok(inspected.interactions.some((i: any) => i.pfId === 'open'));
    assert.equal(inspected.validation.runtimeVerified, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('canonical page edits preserve Windows newlines, Unicode separators and literal HTML entities in opaque content', () => {
  const source = 'export default function Component() {\r\n return <p>{"line\\r\\n"}</p>;\r\n}';
  const result = parsePageSource(freeform());
  const node = result.doc!.root.children[0] as ProtoNode;
  node.props.source = source;
  node.props.css = '.a {\r\n color:red;\r\n}\u2028/* 分隔 */\u2029';
  node.props.title = 'A &amp; B';
  const printed = printPageSource(result.doc!);
  assert.deepEqual(pageContractErrors(printed, []), []);
  const changed = editPageBlock(printed, 'root', 'append_children', '<Text pfId="tail">保留内容</Text>');
  const after = parsePageSource(changed).doc!.root.children[0] as ProtoNode;
  assert.deepEqual(after.props, node.props);
});
