import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { prepareTableRows, visibleTableRows, tableCellSpans, tableConfigErrors } from '../src/proto/table/model';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { parsePageSource } from '../src/proto/dsl/parser';
import { printPageSource } from '../src/proto/dsl/printer';
import { AntdFieldControl } from '../src/proto/registry/AntdFieldControl';
import { NodeView } from '../src/proto/renderer/NodeView';
import { RuntimeProvider, useRuntimeController } from '../src/proto/runtime/runtime';
import { PreviewDataContext } from '../src/proto/runtime/PreviewData';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { installTestDom } from './dom';

const records = [
  { id: 'row-child', code: 1, parent: 0, title: '子项', status: 0 },
  { id: 'row-second', code: 2, parent: null, title: '二组', status: 1 },
  { id: 'row-root', code: 0, parent: null, title: '一组', status: 1 },
];
const tree = { rowMode: 'tree', parentField: 'parent', treeKeyField: 'code' };
const table: DBTableSchema = {
  id: 'records', tableName: 't_records', cnName: '目录', domain: '基础资料域 (MDM)', description: '', sharedByMenus: [],
  columns: Object.keys(records[0]).map(name => ({ id: 'field-' + name, name, comment: name, nullable: name === 'parent', dataType: ['code','parent','status'].includes(name) ? 'INT' : 'VARCHAR', isPrimaryKey: name === 'id' })),
};
const source = (props: string) => `export default function Page(){return <Page pfId="page"><Table pfId="grid" table="records" ${props}/></Page>}`;
const columns = `columns={[{dataIndex:"title",title:"标题",sortable:true,editor:"input"},{dataIndex:"status",title:"状态",editor:"select",editorOptions:[{label:"待办",value:0},{label:"完成",value:1}]}]}`;

test('tree matching uses the exact business key, filters descendants with their ancestry and pages roots', () => {
  const { roots } = prepareTableRows(records, tree, {}, { key: 'code', asc: true });
  assert.deepEqual(roots.map(n => n.row.id), ['row-root','row-second']);
  assert.deepEqual(visibleTableRows(roots.slice(0, 1), () => true).map(v => [v.row.id,v.depth]), [['row-root',0],['row-child',1]]);
  const search = prepareTableRows(records, tree, { title:'子项' }, null);
  assert.deepEqual(visibleTableRows(search.roots, id => search.forcedOpen.has(id)).map(v => v.row.id), ['row-root','row-child']);
  for (const [parent, message] of [['0', /未匹配/], [1, /循环/], [undefined, /显式填写 null/]] as const)
    assert.throws(() => prepareTableRows([{ ...records[0], parent }, ...records.slice(1)], tree, {}, null), message);
  assert.throws(() => prepareTableRows([...records,{ ...records[0], id:'distinct' }], tree, {}, null), /值重复/);
});

test('manual rectangles never absorb a replacement record, cross a page or cover an expanded detail', () => {
  const columns = ['title','status'].map(dataIndex => ({ dataIndex, title:dataIndex }));
  const rows = visibleTableRows(prepareTableRows(records, {}, {}, null).roots, () => false);
  const merge = [{ rowIds:records.slice(0,2).map(r=>r.id), fields:['title','status'] }];
  const off = () => false;
  const spans = tableCellSpans(rows, columns, merge, off);
  assert.deepEqual(spans(0,0), { rowSpan:2, colSpan:2 });
  assert.equal(spans(1,1), null);
  for (const subset of [rows.slice(1),[rows[0],rows[2]], [...rows].reverse()]) assert.equal(tableCellSpans(subset,columns,merge,off)(0,0), undefined);
  assert.equal(tableCellSpans(rows,columns,merge,id => id === rows[0].row.id)(0,0), undefined);
  assert.deepEqual(tableCellSpans(rows,[{ ...columns[1], mergeRows:true }],[],off)(1,0), { rowSpan:2, colSpan:1 });
  assert.match(tableConfigErrors({ table:table.id, columns, cellMerges: [...merge,...merge] }).join(), /重叠/);
});

test('material contracts preserve advanced settings through source and reject invalid fields and identities', () => {
  const code = source(`rowMode="tree" treeKeyField="code" parentField="parent" ${columns}`);
  const doc = parsePageSource(code).doc!;
  assert.deepEqual(pageContractErrors(printPageSource(doc), [table], { tableRows: { records } }), []);
  for (const [props, message] of [
    ['rowMode="tree"', /父节点字段/], ['rowMode="tree" parentField="unknown"', /未知字段/],
    ['rowMode="expandable" detailFields={["unknown"]}', /未知字段/],
    ['columns={[{dataIndex:"id",title:"ID",editor:"input"}]}', /不可行内编辑/],
    ['columns={[{dataIndex:"status",title:"状态",editor:"select"}]}', /editorOptions/],
  ] as const) assert.match(pageContractErrors(source(props), [table]).join(), message);
  assert.match(pageContractErrors(source(`${columns} cellMerges={[{rowIds:["missing"],fields:["title","status"]}]}`), [table], { tableRows:{ records } }).join(), /不存在的记录 missing/);
  assert.match(pageContractErrors(code,[table],{ tableRows:{records:[records[0]]} }).join(), /未匹配/);
});

test('registered Table expands details, edits the correct row after sorting, cancels, and isolates design and draft data', () => {
  const restore = installTestDom(), oldTables = useProtoStore.getState().dbTables, oldRows = usePageStore.getState().tableRows;
  const doc = parsePageSource(source(`rowMode="expandable" detailFields={["code"]} onRowClick={() => setVar("hit","yes")} ${columns}`)).doc!;
  const draft = { tables:[table], rows:{ records:records.slice(0,1) } };
  function Canvas({ design = false, staged = false }) {
    const rt = useRuntimeController(doc, 'page', design);
    return <PreviewDataContext.Provider value={staged ? draft : null}><RuntimeProvider value={rt}><NodeView node={doc.root}/><output>{String(rt.vars.hit)}</output></RuntimeProvider></PreviewDataContext.Provider>;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  const find = (id: string) => renderer.root.findByProps({ 'data-row-id':id });
  const cellButton = (id: string, label: string) => find(id).findByProps({ 'aria-label':label });
  const click = (button: TestRenderer.ReactTestInstance) => act(() => button.props.onClick({ stopPropagation() {} }));
  try {
    useProtoStore.setState({ dbTables:[table] }); usePageStore.setState({ tableRows:{ records, other:records } });
    act(() => { renderer = TestRenderer.create(<Canvas/>); });
    click(cellButton('row-child','展开记录 row-child'));
    assert.deepEqual(renderer.root.findByType('dd').findByType('span').children, ['1']);
    click(renderer.root.findAllByType('th').find(th=>typeof th.props.onClick === 'function')!);
    click(cellButton('row-child','编辑状态'));
    act(() => renderer.root.findByType(AntdFieldControl).props.onChange(1));
    click(cellButton('row-child','取消编辑状态'));
    assert.equal(usePageStore.getState().tableRows.records[0].status,0);
    click(cellButton('row-second','编辑状态'));
    act(() => renderer.root.findByType(AntdFieldControl).props.onChange(0));
    click(cellButton('row-second','保存状态'));
    const saved = usePageStore.getState().tableRows;
    assert.deepEqual(saved.records.map(r=>r.status), [0,0,1]); assert.equal(saved.other,records);
    for (const canvas of [<Canvas design/>, <Canvas staged/>]) {
      act(() => renderer.update(canvas));
      assert.equal(renderer.root.findAllByProps({ 'aria-label':'编辑状态' }).length, 0);
    }
    assert.equal(renderer.root.findAll(n=>n.type==='tr' && !!n.props['data-row-id']).length,1);
    assert.equal(usePageStore.getState().tableRows, saved);
  } finally {
    act(()=>renderer?.unmount()); useProtoStore.setState({ dbTables:oldTables }); usePageStore.setState({ tableRows:oldRows }); restore();
  }
});
