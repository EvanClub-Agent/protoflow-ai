import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { CHART_TYPES, chartConfigErrors, chartExample, chartNumber, prepareChartData, resolveChartEvent } from '../src/proto/charts/model';
import { CHART_MATERIALS } from '../src/proto/charts/metadata';
import { buildChartOption, chartClickPoint } from '../src/proto/charts/options';
import { ChartInspector } from '../src/proto/charts/ChartInspector';
import { COMPONENT_MAP, CATEGORY_LABELS } from '../src/proto/registry/meta';
import { REGISTRY } from '../src/proto/registry/components';
import { validateMaterialSource } from '../src/proto/registry/materialContract';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { reassignIds } from '../src/proto/dsl/tree';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { inspectPage } from '../src/proto/ai/pageInspection';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from '../src/services/projectStorage';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { validatePublishedSnapshot } from '../src/services/publishedSnapshot';
import { prepareProjectChanges } from '../src/services/hermesProject';
import { encodePflowBinary, decodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { usePageStore } from '../src/proto/store/usePageStore';
import type { DBTableSchema } from '../src/store/useProtoStore';
import type { ProtoDoc, ProtoNode } from '../src/proto/types';

const native = require(process.cwd() + '/electron/generated/material-contract.cjs');
const source = (tag: string) => `export default function Page(){return <Page pfId="root">${tag}</Page>}`;
const inline = { source: 'inline', dimension: 'region', metrics: [{ field: 'amount', label: '销售额' }], data: [{ region: '华东', amount: 0 }, { region: '华南', amount: '12.5' }] };
const table: DBTableSchema = { id: 'sales-entity', tableName: 't_sales', cnName: '销售数据', domain: '基础资料域 (MDM)', description: '', sharedByMenus: [], columns: [
  { id: 'region-column', name: 'region', dataType: 'TEXT', comment: '区域', nullable: false }, { id: 'amount-column', name: 'amount', dataType: 'DECIMAL', comment: '销售额', nullable: false },
] };
const bound = { source: 'table', table: table.id, dimension: 'region', metrics: inline.metrics };
const boundSource = source('<BarChart pfId="chart" source="table" table="sales-entity" dimension="region" metrics={[{field:"amount",label:"销售额"}]} />');

test('all twelve chart materials share palette, native contracts and runnable default option shapes', () => {
  assert.equal(CATEGORY_LABELS.charts, '数据图表');
  assert.equal(CHART_TYPES.length, 12);
  for (const meta of CHART_MATERIALS) {
    assert.equal(COMPONENT_MAP[meta.name].category, 'charts');
    assert.ok(REGISTRY[meta.name]);
    const doc = parsePageSource(source(meta.snippet)).doc!;
    doc.root = reassignIds(doc.root);
    const printed = printPageSource(doc);
    assert.deepEqual(validateMaterialSource(printed), [], meta.name);
    assert.deepEqual(native.validateMaterialSource(printed), [], meta.name);
    const type = meta.name as typeof CHART_TYPES[number];
    const dataset = prepareChartData(type, { source: 'sample' }, undefined);
    assert.ok(dataset.data.length);
    const option = buildChartOption(type, { source: 'sample' }, dataset) as any;
    assert.ok(option.series.length > 0, meta.name);
    assert.equal(option.tooltip.renderMode, 'richText', 'data labels must not be rendered as HTML');
    const darkOption = buildChartOption(type, { source: 'sample' }, dataset, true) as any;
    assert.equal(darkOption.textStyle.color, 'rgba(255, 255, 255, 0.85)', `${meta.name} dark text`);
    assert.equal(darkOption.tooltip.backgroundColor, '#1f1f1f', `${meta.name} dark tooltip`);
  }
});

test('chart data preserves zero, converts only explicit numeric text and never manufactures missing values', () => {
  const before = JSON.stringify(inline);
  const dataset = prepareChartData('BarChart', inline, inline.data);
  assert.deepEqual(dataset.data, [{ region: '华东', amount: 0 }, { region: '华南', amount: 12.5 }]);
  assert.equal(JSON.stringify(inline), before);
  for (const value of [null, undefined, '', '  ', true, 'NaN', 'Infinity', '0x10', {}, []]) assert.throws(() => chartNumber(value, 'amount'), /需要数值/);
  assert.throws(() => prepareChartData('BarChart', bound, undefined), /不会用示例数据替代/);
  assert.deepEqual(prepareChartData('BarChart', bound, []).data, []);
  assert.throws(() => prepareChartData('BarChart', bound, [{ region: '甲', code: 20 }]), /amount/);
  assert.match(chartConfigErrors('BarChart', { ...bound, table: table.tableName }, [table]).join(' '), /数据表不存在/);
  assert.match(pageContractErrors(boundSource.replace('field:"amount"', 'field:"code"'), [table]).join(' '), /未知图表字段 sales-entity.code/);
  assert.deepEqual(pageContractErrors(boundSource, [table]), []);
  assert.deepEqual(native.pageContractErrors(boundSource, [table]), []);
});

test('chart aggregation is explicit, preserves order and rejects ambiguous or invalid chart-specific inputs', () => {
  const data = [{ region: '乙', amount: 0 }, { region: '甲', amount: 10 }, { region: '甲', amount: 20 }];
  assert.throws(() => prepareChartData('BarChart', inline, data), /明确选择求和或平均/);
  assert.deepEqual(prepareChartData('BarChart', { ...inline, aggregation: 'sum' }, data).data, [{ region: '乙', amount: 0 }, { region: '甲', amount: 30 }]);
  assert.deepEqual(prepareChartData('BarChart', { ...inline, aggregation: 'average' }, data).data, [{ region: '乙', amount: 0 }, { region: '甲', amount: 15 }]);
  assert.throws(() => prepareChartData('BarChart', inline, [{ region: 1, amount: 2 }, { region: '1', amount: 3 }]), /统一分类类型/);
  assert.throws(() => prepareChartData('PieChart', inline, [{ region: '甲', amount: -1 }]), /不能为负/);
  assert.throws(() => prepareChartData('GaugeChart', inline, inline.data), /仅展示一条/);
  assert.throws(() => prepareChartData('GaugeChart', { ...inline, min: 0, max: 10 }, [{ region: '甲', amount: 20 }]), /超出/);
  assert.match(chartConfigErrors('GaugeChart', { source: 'sample', min: 0, max: 50 }).join(' '), /超出/);
  const sankey = { source: 'inline', ...chartExample('SankeyChart') };
  assert.throws(() => prepareChartData('SankeyChart', sankey, [{ from: '甲', to: '乙', value: 1 }, { from: '乙', to: '甲', value: 1 }]), /环路/);
  assert.throws(() => prepareChartData('SankeyChart', sankey, [{ from: 1, to: '甲', value: 1 }, { from: '乙', to: '1', value: 1 }]), /统一分类类型/);
  const zeroPie = buildChartOption('PieChart', inline, prepareChartData('PieChart', inline, [{ region: '甲', amount: 0 }])) as any;
  assert.equal(zeroPie.series[0].stillShowZeroSum, false, 'zero totals must not become equal positive proportions');
});

test('dense charts enable range zoom and large-data drawing without losing declared click behavior', () => {
  const rows = Array.from({ length: 2001 }, (_, i) => ({ region: String(i), amount: i % 100 }));
  const dataset = prepareChartData('BarChart', inline, rows);
  const option = buildChartOption('BarChart', { ...inline, dataZoom: true }, dataset) as any;
  assert.equal(option.animation, false);
  assert.equal(option.series[0].large, true);
  assert.equal(option.dataZoom.length, 2);
  const interactive = buildChartOption('BarChart', { ...inline, onClick: { $kind: 'actions', calls: [] } }, dataset) as any;
  assert.equal(interactive.series[0].large, false, 'large drawing cannot silently drop click targets');
  assert.throws(() => prepareChartData('BarChart', inline, Array(50001).fill({ region: '甲', amount: 1 })), /最多读取 50000/);
});

test('chart contracts reject unsupported options and keep selection event values typed and opaque', () => {
  for (const prop of ['option={{series:[]}}', 'height={0}', 'source="remote"', 'onClick={()=>toast("{{chart.id}}")}', 'data={[{x:1}]}']) {
    const candidate = source(`<BarChart pfId="chart" source="sample" ${prop}/>`);
    assert.ok(validateMaterialSource(candidate).length, prop);
    assert.deepEqual(native.validateMaterialSource(candidate), validateMaterialSource(candidate));
  }
  const point = { name: '{{row.id}}', value: [0, 12], seriesName: '指标' };
  assert.deepEqual(resolveChartEvent({ name: '{{chart.name}}', value: '{{chart.value}}' }, point), { name: '{{row.id}}', value: [0, 12] });
  assert.throws(() => resolveChartEvent('{{chart.id}}', point), /未知图表点击结果/);
  assert.deepEqual(chartClickPoint({ data: { protoflowPoint: point } }), point);
  assert.equal(chartClickPoint({ data: { id: 'business-record', value: 5 } }), null);
  const eventPage = source('<BarChart pfId="chart" source="sample" onClick={()=>openModal("detail",{value:"{{chart.value}}"})}/><Modal pfId="modal" id="detail"/>');
  assert.deepEqual(validateMaterialSource(eventPage), []);
  assert.match(printPageSource(parsePageSource(eventPage).doc!), /\{\{chart.value\}\}/);
});

test('AI inspection distinguishes sample charts, empty saved data and unavailable data', () => {
  assert.ok(inspectPage(source('<BarChart pfId="chart" source="sample"/>'), [], {}).warnings.some(w => w.code === 'chart-sample-data'));
  const missing = inspectPage(boundSource, [table], {});
  assert.equal(missing.validation.valid, false, 'unavailable chart data must not be reported as a valid page');
  assert.ok(missing.warnings.some(w => w.code === 'chart-data-invalid' && w.message.includes('已保存')));
  const empty = inspectPage(boundSource, [table], { [table.id]: [] });
  assert.equal(empty.warnings.some(w => w.code === 'chart-data-invalid'), false);
  assert.equal(empty.validation.runtimeVerified, false);
});

test('chart commits validate every saved record after schema changes without filling missing fields', () => {
  const added = { id: 'growth-column', name: 'amount_qoq_rate', dataType: 'DECIMAL', nullable: false, comment: '金额环比（%）' };
  const extended = { ...table, columns: [...table.columns, added] };
  const oldRows = [{ id: 'record-1', region: '2026-Q1', amount: 100 }];
  const rateSource = boundSource.replace('field:"amount",label:"销售额"', 'field:"amount_qoq_rate",label:"金额环比"');
  assert.deepEqual(pageContractErrors(rateSource, [extended]), [], 'schema-only validation explains the original gap');
  const rows = { [table.id]: oldRows };
  const errors = pageContractErrors(rateSource, [extended], { tableRows: rows });
  assert.match(errors.join(' '), /chart:图表数据不可用.*sales-entity.*缺少字段 amount_qoq_rate/);
  assert.deepEqual(native.pageContractErrors(rateSource, [extended], { tableRows: rows }), errors);
  assert.equal(inspectPage(rateSource, [extended], rows).validation.valid, false);
  const laterMissing = { [table.id]: Array.from({ length: 25 }, (_, i) => ({ id: `record-${i}`, region: String(i), ...(i === 24 ? {} : { amount_qoq_rate: i }) })) };
  assert.match(pageContractErrors(rateSource, [extended], { tableRows: laterMissing }).join(' '), /第 25 条数据缺少字段/);
  assert.match(pageContractErrors(rateSource, [extended], { tableRows: undefined }).join(' '), /工程快照缺少预览数据/);
  assert.deepEqual(pageContractErrors(rateSource, [extended], { tableRows: { [table.id]: [] } }), [], 'explicit empty data remains valid');
  const base = createProjectPayload({ projectId: 'chart-append-test', projectName: '追加图表', templateId: 'blank_project', storageDir: '/tmp', fileName: 'chart-append.pflow', createdAt: '2026-11-01', updatedAt: '2026-11-01', pageCount: 0, tableCount: 0, stickyCount: 0 });
  Object.assign(base.stateSnapshot, { activePageId: 'main', designerFolders: [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }], dbTables: [table], tableRows: rows, pageSources: { main: boundSource }, designerPages: [{ pageId: 'main', title: '图表', folderId: 'folder-project-pages' }] });
  const before = JSON.stringify(base);
  const schemaOp = { tool: 'protoflow_upsert_db_column', args: { tableId: table.id, column: added } };
  const chartOp = { tool: 'protoflow_apply_tsx_patch', args: { pageId: 'main', source: rateSource } };
  assert.throws(() => prepareProjectChanges(base, [schemaOp, chartOp]), /图表数据不可用.*amount_qoq_rate/);
  assert.equal(JSON.stringify(base), before, 'failed append cannot mutate the source page, schema or saved values');

  const { callTool, atomicWrite } = require(process.cwd() + '/electron/protoflow-mcp.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-chart-append-'));
  const file = path.join(dir, 'context.json');
  try {
    atomicWrite(file, { active: true, runId: 'append', operations: [], snapshot: structuredClone(base.stateSnapshot) });
    callTool(file, 'protoflow_get_project', {});
    const result = callTool(file, schemaOp.tool, schemaOp.args);
    assert.match(result.message, /saved rows are unchanged/);
    const staged = fs.readFileSync(file, 'utf8');
    assert.throws(() => callTool(file, chartOp.tool, chartOp.args), /缺少字段 amount_qoq_rate/);
    assert.throws(() => callTool(file, 'protoflow_edit_page_block', { pageId: 'main', targetPfId: 'root', mode: 'append_children', tsx: '<LineChart pfId="growth" source="table" table="sales-entity" dimension="region" metrics={[{field:"amount_qoq_rate",label:"环比"}]}/>' }), /缺少字段 amount_qoq_rate/);
    assert.equal(fs.readFileSync(file, 'utf8'), staged, 'invalid full-page and incremental patches must never enter streaming preview');
    assert.deepEqual(callTool(file, 'protoflow_get_table_rows', { tableId: table.id }).rows, oldRows);
    callTool(file, 'protoflow_edit_page_block', { pageId: 'main', targetPfId: 'root', mode: 'append_children', tsx: '<LineChart pfId="trend" source="table" table="sales-entity" dimension="region" metrics={[{field:"amount",label:"金额趋势"}]}/>' });
    assert.equal(callTool(file, 'protoflow_inspect_page', { pageId: 'main' }).validation.valid, true, 'AI can correct its binding and retry in the same turn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('chart inspector edits data without code, applies atomically, and can recover an empty dataset', () => {
  const initial = parsePageSource(source('<BarChart pfId="chart" source="sample"/>')).doc!;
  let current = initial;
  const Harness = () => { const [doc, setDoc] = React.useState(initial); current = doc; return React.createElement(ChartInspector, { node: doc.root.children[0] as ProtoNode, doc, tables: [table], onCommit: setDoc }); };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
  const button = (text: string) => renderer.root.findAllByType('button').find(b => b.children.includes(text))!;
  try {
    assert.equal(renderer.root.findAllByType('textarea').length, 0);
    act(() => renderer.root.findByProps({ 'aria-label': '图表数据来源' }).props.onChange({ target: { value: 'inline' } }));
    assert.equal(current, initial, 'draft changes cannot partially replace project data');
    act(() => renderer.root.findByProps({ 'aria-label': '第 1 行 sales' }).props.onChange({ target: { value: '0' } }));
    act(() => button('应用图表设置').props.onClick());
    assert.equal(((current.root.children[0] as ProtoNode).props.data as any[])[0].sales, 0);
    for (let i = 0; i < 6; i++) act(() => renderer.root.findByProps({ 'aria-label': '删除第 1 行' }).props.onClick());
    act(() => button('＋ 添加一行').props.onClick());
    assert.ok(renderer.root.findByProps({ 'aria-label': '第 1 行 sales' }));
    act(() => button('应用图表设置').props.onClick());
    assert.ok(renderer.root.findByProps({ role: 'alert' }));
    assert.equal(((current.root.children[0] as ProtoNode).props.data as any[]).length, 6, 'invalid edits must leave previous data intact');
  } finally { act(() => renderer.unmount()); }
});

test('charts survive save, undo and publication; publishing never generates substitute table data', () => {
  const payload = createProjectPayload({ projectId: 'charts-test', projectName: '图表测试', templateId: 'blank_project', storageDir: '/tmp', fileName: 'charts.pflow', createdAt: '2026-11-01', updatedAt: '2026-11-01', pageCount: 0, tableCount: 0, stickyCount: 0 });
  Object.assign(payload.stateSnapshot, { designerFolders: [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }], pageSources: { main: boundSource }, activePageId: 'main', designerPages: [{ pageId: 'main', title: '图表', folderId: 'folder-project-pages' }], dbTables: [table], tableRows: {} });
  loadProjectFromBinaryPayload(payload);
  assert.throws(() => createPublishedSnapshot('main'), /尚无已保存的预览数据/);
  assert.deepEqual(usePageStore.getState().tableRows, {});
  usePageStore.setState({ tableRows: { [table.id]: [{ id: 'record-1', region: '甲', amount: 0 }] } });
  const changed = boundSource.replace('<BarChart', '<LineChart');
  usePageStore.getState().setPageSource('main', changed);
  usePageStore.getState().undo('main'); assert.equal(usePageStore.getState().pageSources.main, boundSource);
  usePageStore.getState().redo('main'); assert.equal(usePageStore.getState().pageSources.main, changed);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(captureProjectPayload())));
  assert.equal(usePageStore.getState().pageSources.main, changed);
  const published = createPublishedSnapshot('main');
  validatePublishedSnapshot(published);
  assert.equal(published.tableRows[table.id][0].amount, 0);
  published.tableRows[table.id][0].amount = '';
  assert.throws(() => validatePublishedSnapshot(published), /数据图表未通过发布检查/);
});
