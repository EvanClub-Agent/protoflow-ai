import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { installTestDom } from './dom';
import { setLocale } from '../src/i18n';
import { useProtoStore, type DBColumnSchema, type DBTableSchema } from '../src/store/useProtoStore';
import { initialPages, usePageStore } from '../src/proto/store/usePageStore';
import { fieldTypeOf, generateFromTemplate, resolveFieldSelectOptions } from '../src/proto/ai/templates';
import { parsePageSource } from '../src/proto/dsl/parser';
import { findNode, walk } from '../src/proto/dsl/tree';
import { preparePreviewScenario } from '../src/proto/database/previewScenario';
import { generatePreviewRows } from '../src/proto/runtime/mock';
import { RuntimeProvider, useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { NodeView } from '../src/proto/renderer/NodeView';
import { prepareTableRows } from '../src/proto/table/model';
import { AntdFieldControl } from '../src/proto/registry/AntdFieldControl';
import { normalizeQueryChoiceOptions } from '../src/proto/registry/components';
import { materialOptions } from '../src/proto/registry/antdOptions';
import type { ActionChain, PropValue } from '../src/proto/types';

const locales = ['zh-CN', 'en-US'] as const;
function column(name: string, dataType: string, comment = name): DBColumnSchema {
  return { id: name, name, dataType, comment, nullable: false };
}
function table(name: string, columns: DBColumnSchema[]): DBTableSchema {
  return { id: name, tableName: name, cnName: name, domain: '', description: '', sharedByMenus: [],
    columns: [{ ...column('id', 'VARCHAR(32)'), isPrimaryKey: true }, ...columns] };
}
function parsed(source: string) {
  const { doc, issues } = parsePageSource(source);
  assert.ok(doc, JSON.stringify(issues));
  return doc;
}
function openPage(t: TestContext, source: string) {
  const cleanup = installTestDom();
  const doc = parsed(source);
  let rt!: Runtime;
  const Harness = () => {
    rt = useRuntimeController(doc, 'test', false);
    return <RuntimeProvider value={rt}><NodeView node={doc.root} live /></RuntimeProvider>;
  };
  let view!: TestRenderer.ReactTestRenderer;
  act(() => { view = TestRenderer.create(<Harness />); });
  t.after(() => { act(() => view.unmount()); cleanup(); });
  return { get rt() { return rt; }, view, doc };
}
function submit(form: string): ActionChain {
  return { $kind: 'actions', calls: [{ name: 'submitForm', args: [form] }, { name: 'toast', args: ['saved'] }] };
}
function receiptSchema() {
  const supplier = table('t_base_supplier', [column('supplier_name', 'VARCHAR(64)'), column('status', 'VARCHAR(16)')]);
  const receipt = table('t_wms_acceptance_order', [{
    ...column('supplier_id', 'VARCHAR(32)', 'Qualified Supplier'), isForeignKey: true,
    references: 't_base_supplier(id)', defaultValue: "'pending-id'",
  }]);
  useProtoStore.setState({ dbTables: [supplier, receipt] });
  usePageStore.setState({ tableRows: {
    [receipt.id]: [], [supplier.id]: [
      { id: 'qualified-id', supplier_name: 'Eligible', status: 'qualified' },
      { id: 'pending-id', supplier_name: 'Pending', status: 'pending' },
    ],
  } });
  return { receipt, supplier };
}

test('physical ENUM governs approval actions, generated rows and writes in either language', () => {
  const status = { ...column('status', "ENUM('pending','approved')", 'Ticket status (pending/approved/rejected)'), defaultValue: "'rejected'" };
  const tickets = table('ticket', [status]);
  useProtoStore.setState({ dbTables: [tickets] });
  const pages = usePageStore.getState();
  usePageStore.setState({ tableRows: { ticket: [{ id: 'T', status: 'pending' }] } });
  for (const locale of locales) {
    const rows = generatePreviewRows(tickets, locale);
    assert.deepEqual([...new Set(rows.map(r => r.status))], ['pending', 'approved']);
    const source = generateFromTemplate('list', tickets, [tickets], { pageId: 'tickets', title: 'Tickets', locale });
    assert.doesNotMatch(source, /\brejected\b|驳回/);
    assert.deepEqual(findNode(parsed(source).root, 'tbl-approved')?.props.filter, { status: 'approved' });
  }
  assert.throws(() => preparePreviewScenario([tickets], {}, [
    { tableId: 'ticket', rows: [{ id: 'example', status: 'rejected' }] },
  ]), /ticket.status/);
  assert.throws(() => pages.insertRow('ticket', {}), /ENUM|枚举/);
  assert.throws(() => pages.updateRow('ticket', 'T', { status: 'rejected' }), /ENUM|枚举/);
  assert.deepEqual(pages.getRows('ticket'), [{ id: 'T', status: 'pending' }]);
  pages.updateRow('ticket', 'T', { status: 'approved' });
  assert.equal(pages.getRows('ticket')[0].status, 'approved');
  const special = column('choice', "ENUM('a,b', 'can''t', ' pad ')", 'Display choice');
  assert.deepEqual(resolveFieldSelectOptions(special).map(o => o.value), ['a,b', "can't", ' pad ']);
});

test('mobile receipt validates the effective FK default and permits a qualified replacement', async t => {
  const { receipt, supplier } = receiptSchema();
  const source = generateFromTemplate('mobile_form', receipt, [receipt, supplier],
    { pageId: 'receipt', title: 'Receipt', locale: 'en-US' });
  const page = openPage(t, source);
  let action: PropValue | undefined;
  let pickerTable: PropValue | undefined;
  walk(page.doc.root, node => {
    if (node.type === 'MSheetPicker' && node.props.name === 'supplier_id') pickerTable = node.props.table;
    if (node.type === 'MBottomDock') action = node.props.onPrimary;
  });
  assert.equal(pickerTable, supplier.id);
  assert.ok(action);
  await act(() => page.rt.run(action, {}));
  assert.equal(usePageStore.getState().getRows(receipt.id).length, 0);
  assert.ok(page.rt.formErrors['mform-main'].supplier_id);
  act(() => page.rt.setFormValue('mform-main', 'supplier_id', 'qualified-id'));
  await act(() => page.rt.run(action, {}));
  assert.deepEqual(usePageStore.getState().getRows(receipt.id).map(r => r.supplier_id), ['qualified-id']);
});

test('older form with hidden FK defaults rejects an invalid default, accepts a valid one and preserves edits on resubmit', async t => {
  const { receipt, supplier } = receiptSchema();
  const page = openPage(t, 'export default function Page(){return <Page><Form pfId="f" table="t_wms_acceptance_order"><Input name="note" /></Form></Page>}');
  await act(() => page.rt.run(submit('f'), {}));
  const pages = usePageStore.getState();
  assert.deepEqual(pages.getRows(receipt.id), []);
  assert.equal(page.rt.toasts.at(-1)?.type, 'error');
  act(() => pages.updateRow(supplier.id, 'pending-id', { status: 'qualified' }));
  await act(() => page.rt.run(submit('f'), {}));
  const [inserted] = pages.getRows(receipt.id);
  assert.equal(inserted.supplier_id, 'pending-id');
  act(() => pages.updateRow(receipt.id, inserted.id, { supplier_id: 'qualified-id' }));
  await act(() => page.rt.run(submit('f'), {}));
  assert.deepEqual(pages.getRows(receipt.id).map(r => r.supplier_id), ['qualified-id']);
});

test('a supplier_id without REFERENCES remains an ordinary field in an auto-bound form', async t => {
  const { supplier } = receiptSchema();
  const invoice = table('invoice', [column('supplier_id', 'VARCHAR(32)', 'Accounting Reference')]);
  useProtoStore.setState({ dbTables: [invoice, supplier] });
  usePageStore.setState({ tableRows: { ...usePageStore.getState().tableRows, invoice: [] } });
  const page = openPage(t, 'export default function Page(){return <Page><Form pfId="f" table="invoice" /></Page>}');
  const control = page.view.root.findByType(AntdFieldControl);
  assert.equal(control.props.def.type, 'input');
  act(() => control.props.onChange('ACCOUNTING-123'));
  await act(() => page.rt.run(submit('f'), {}));
  assert.equal(usePageStore.getState().getRows('invoice')[0].supplier_id, 'ACCOUNTING-123');
});

test('unit and format comments keep their physical types, while numeric choices and CRM text choices retain their values', () => {
  const columns = [
    column('speed', 'DECIMAL(8,2)', 'Speed (km/h)'), column('doc_date', 'DATE', 'Document date (YYYY/MM/DD)'),
    column('status', 'INT', 'Status (0/1)'), column('region', 'VARCHAR(32)', 'Region (East/South/North/West)'),
  ];
  const metrics = table('metrics', columns);
  assert.deepEqual(columns.map(fieldTypeOf), ['number', 'date', 'select', 'select']);
  for (const locale of locales) {
    const rows = generatePreviewRows(metrics, locale);
    assert.ok(rows.every(r => typeof r.speed === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(String(r.doc_date))));
    assert.deepEqual([...new Set(rows.map(r => r.status))], [0, 1]);
    assert.deepEqual(resolveFieldSelectOptions(columns[2], locale).map(o => o.value), [0, 1]);
    const doc = parsed(generateFromTemplate('mobile_form', metrics, [metrics], { pageId: 'm', title: 'Metrics', locale }));
    let options: unknown;
    walk(doc.root, n => { if (n.props.name === 'status' && n.type === 'MSheetPicker') options = n.props.options; });
    assert.deepEqual(materialOptions(options).map(o => o.value), [0, 1]);
  }
});

test('structured All remains searchable while only shipped legacy CSV presets use a clear sentinel', t => {
  const options = [{ label: 'All', value: 'All' }, { label: 'Other', value: 1 }];
  const normalized = normalizeQueryChoiceOptions(options);
  assert.deepEqual(materialOptions(normalized.options), options);
  assert.equal(normalized.legacyClearTokens.size, 0);
  assert.equal(normalizeQueryChoiceOptions('All,Other').options, 'All,Other');
  assert.equal(materialOptions(normalizeQueryChoiceOptions('All,Enabled,Disabled').options)[0].value, '');
  useProtoStore.setState({ dbTables: [table('choices', [column('kind', 'VARCHAR(32)')])] });
  usePageStore.setState({ tableRows: { choices: [] } });
  const page = openPage(t, `export default function Page(){return <Page>
    <QueryForm target="list" fields={[{ name: 'kind', type: 'select', label: 'Kind', options: ${JSON.stringify(options)} }]} />
    <Table pfId="list" table="choices" />
  </Page>}`);
  const control = page.view.root.findByType(AntdFieldControl);
  act(() => control.props.onChange('All'));
  const button = page.view.root.findAllByType('button').find(b =>
    b.findAll(n => typeof n.type === 'string' && n.children.some(c => c === '查询' || c === 'Search')).length > 0);
  assert.ok(button);
  act(() => button.props.onClick());
  assert.deepEqual(page.rt.filters.list, { kind: 'All' });
  const rows = [{ id: 'A', kind: 'All' }, { id: 'B', kind: 1 }];
  assert.deepEqual(prepareTableRows(rows, {}, page.rt.filters.list, null).roots.map(r => r.row.id), ['A']);
});

test('updateRow preserves null and rejects missing references or non-nullable clears atomically', async t => {
  const totals = table('totals', [{ ...column('amount', 'DECIMAL(14,2)'), nullable: true }, column('mandatory', 'INT')]);
  useProtoStore.setState({ dbTables: [totals] });
  const original = { id: 'A', amount: 100, mandatory: 42 };
  usePageStore.setState({ tableRows: { totals: [original] } });
  const page = openPage(t, 'export default function Page(){return <MobilePage><MForm pfId="f"><MField name="amount" inputType="number" /></MForm></MobilePage>}');
  act(() => page.view.root.findByType('input').props.onChange({ target: { value: '' } }));
  assert.equal(page.rt.formValues.f.amount, null);
  const update = async (patch: Record<string, PropValue>) => {
    await act(() => page.rt.run({ $kind: 'actions', calls: [
      { name: 'updateRow', args: [patch] }, { name: 'toast', args: ['updated'] },
    ] }, { tableId: totals.id, row: original }));
    return usePageStore.getState().getRows('totals')[0];
  };
  assert.deepEqual(await update({ amount: '{{form.f.amount}}' }), { ...original, amount: null });
  assert.deepEqual(await update({ amount: 7, mandatory: '{{form.f.amount}}' }), { ...original, amount: null });
  assert.equal(page.rt.toasts.at(-1)?.type, 'error');
  assert.deepEqual(await update({ amount: '{{form.f.missing}}' }), { ...original, amount: null });
  assert.match(page.rt.toasts.at(-1)!.message, /form\.f\.missing/);
});

test('generated qualified supplier directory follows current qualification in both locales', () => {
  const { supplier } = receiptSchema();
  for (const locale of locales) {
    const { sources } = initialPages([supplier], locale);
    const main = findNode(parsed(sources['qualified-suppliers']).root, 'tbl-main')!;
    assert.deepEqual(main.props.filter, { status: 'qualified' });
    const visible = () => prepareTableRows(usePageStore.getState().getRows(supplier.id), main.props, {}, null).roots.map(r => r.row.id);
    assert.deepEqual(visible(), ['qualified-id']);
    usePageStore.getState().updateRow(supplier.id, 'pending-id', { status: 'qualified' });
    assert.deepEqual(visible(), ['qualified-id', 'pending-id']);
    usePageStore.getState().updateRow(supplier.id, 'pending-id', { status: 'pending' });
  }
});

test('field error and open toast follow language switches without resubmitting', async t => {
  receiptSchema();
  const page = openPage(t, 'export default function Page(){return <MobilePage><MForm table="t_wms_acceptance_order" pfId="f"><MSheetPicker name="supplier_id" label="Qualified Supplier" /></MForm></MobilePage>}');
  act(() => setLocale('en-US'));
  await act(() => page.rt.run(submit('f'), {}));
  const errorText = () => page.view.root.findByProps({ role: 'alert' }).children.join('');
  assert.match(errorText(), /no longer qualified/);
  for (const locale of ['zh-CN', 'en-US'] as const) {
    act(() => setLocale(locale));
    assert.match(errorText(), locale === 'zh-CN' ? /请重新选择/ : /please select again/);
    assert.equal(page.rt.toasts.at(-1)?.message, errorText());
  }
});
