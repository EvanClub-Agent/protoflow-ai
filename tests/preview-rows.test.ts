import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { REGISTRY, type CompProps } from '../src/proto/registry/components';
import { prepareChartData } from '../src/proto/charts/model';
import { usePageStore } from '../src/proto/store/usePageStore';
import { captureProjectPayload, createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { projectRevision, projectRecoveryRevision } from '../src/services/hermesProject';
import { encodePflowBinary, decodePflowBinary } from '../src/utils/pflowBinaryCodec';

const tables: DBTableSchema[] = ['travel', 'contracts', 'salary', 'quarters'].map(id => ({
  id, tableName: `t_${id}`, cnName: id, domain: '基础资料域 (MDM)', description: '', sharedByMenus: [],
  columns: [
    { id: `${id}-group`, name: 'group_name', dataType: 'TEXT', comment: '分组名称', nullable: false },
    { id: `${id}-amount`, name: 'amount', dataType: 'DECIMAL', comment: '金额', nullable: false },
  ],
}));

function project(projectId = 'preview-rows') {
  const payload = createProjectPayload({ projectId, projectName: projectId, templateId: 'blank_project', storageDir: '/tmp', fileName: `${projectId}.pflow`, createdAt: '2026-11-01', updatedAt: '2026-11-01', pageCount: 0, tableCount: 4, stickyCount: 0 });
  payload.stateSnapshot.dbTables = structuredClone(tables);
  return payload;
}

test('four statistics mounted together persist every table for the charts and project archive', async () => {
  loadProjectFromBinaryPayload(project());
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null, ...tables.map(table =>
        React.createElement(REGISTRY.Statistic, { key: table.id, p: { table: table.id, title: table.cnName }, root: {} } as CompProps),
      )));
    });
    assert.equal(renderer.root.findAllByType('span').filter(span => span.children.includes('8')).length, 4);
    await act(async () => { await Promise.resolve(); });
    const rows = usePageStore.getState().tableRows;
    assert.deepEqual(Object.keys(rows).sort(), tables.map(table => table.id).sort());
    for (const table of tables) {
      assert.equal(rows[table.id].length, 8);
      const chart = prepareChartData('BarChart', { source: 'table', table: table.id, dimension: 'group_name', metrics: [{ field: 'amount', label: '金额' }] }, rows[table.id]);
      assert.equal(chart.data.length, 8);
      assert.equal(chart.data[0].amount, rows[table.id][0].amount);
    }
    assert.deepEqual(captureProjectPayload().stateSnapshot.tableRows, rows);
  } finally { act(() => renderer?.unmount()); }
});

test('lazy preview initialization preserves saved rows and deliberately empty tables', async () => {
  const payload = project();
  payload.stateSnapshot.tableRows = { travel: [], contracts: [{ id: 'contract-record', group_name: '已保存', amount: 0 }] };
  loadProjectFromBinaryPayload(payload);
  const expected = tables.map(table => usePageStore.getState().getRows(table.id));
  await Promise.resolve();
  const rows = usePageStore.getState().tableRows;
  assert.deepEqual(rows.travel, []);
  assert.deepEqual(rows.contracts, payload.stateSnapshot.tableRows.contracts);
  tables.forEach((table, index) => assert.deepEqual(rows[table.id], expected[index]));
});

test('queued preview rows cannot reappear after reset, reopening the same project or switching projects', async () => {
  for (const invalidate of [
    () => usePageStore.getState().resetRows(),
    () => loadProjectFromBinaryPayload(project()),
    () => loadProjectFromBinaryPayload(project('another-project')),
  ]) {
    loadProjectFromBinaryPayload(project());
    tables.forEach(table => usePageStore.getState().getRows(table.id));
    invalidate();
    await Promise.resolve();
    assert.deepEqual(usePageStore.getState().tableRows, {});
  }
});

test('queued preview rows cannot replace records explicitly saved before initialization completes', async () => {
  loadProjectFromBinaryPayload(project());
  tables.forEach(table => usePageStore.getState().getRows(table.id));
  const saved = { travel: [{ id: 'saved-record', group_name: '实际录入', amount: 0 }], salary: [] };
  usePageStore.setState({ tableRows: saved });
  await Promise.resolve();
  assert.deepEqual(usePageStore.getState().tableRows, saved);
});

test('AI revisions ignore lazy initialization but retain saved rows, explicit writes and in-place changes', async () => {
  for (const edit of [
    () => usePageStore.getState().insertRow('travel', { amount: 42 }),
    () => usePageStore.getState().updateRow('travel', usePageStore.getState().tableRows.travel[0].id, { amount: 42 }),
    () => usePageStore.getState().deleteRow('travel', usePageStore.getState().tableRows.travel[0].id),
    () => { usePageStore.getState().tableRows.travel[0].amount = 42; },
    () => usePageStore.setState({ tableRows: { ...usePageStore.getState().tableRows, travel: [] } }),
  ]) {
    const payload = project();
    payload.stateSnapshot.tableRows = { contracts: [] };
    loadProjectFromBinaryPayload(payload);
    const before = projectRevision();
    usePageStore.getState().getRows('travel');
    usePageStore.getState().getRows('salary');
    await Promise.resolve();
    assert.equal(projectRevision(), before);
    assert.equal(captureProjectPayload().stateSnapshot.tableRows.travel.length, 8);
    edit();
    assert.notEqual(projectRevision(), before);
  }
  loadProjectFromBinaryPayload(project());
  usePageStore.getState().getRows('travel');
  await Promise.resolve();
  loadProjectFromBinaryPayload(captureProjectPayload());
  const restored = projectRevision();
  usePageStore.getState().resetRows();
  assert.notEqual(projectRevision(), restored, 'reopened rows are saved input, including originally automatic examples');
});

test('durable recovery survives saving and reopening lazy rows while actual data and requirement edits invalidate it', async () => {
  loadProjectFromBinaryPayload(project('durable-rows'));
  useProtoStore.setState({projectPlan:{summary:'查看记录',folders:[{id:'main-folder',title:'记录',parentFolderId:null}],
    pages:[{pageId:'main',folderId:'main-folder',title:'记录',requirements:'展示记录'}],approved:true,generatedPageIds:[]}});
  usePageStore.getState().getRows('travel');
  await Promise.resolve();
  const before = captureProjectPayload(), liveRevision = projectRevision(), recovery = projectRecoveryRevision(before);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(before)));
  assert.notEqual(projectRevision(), liveRevision, 'the old in-memory baseline changes after restart');
  assert.equal(projectRecoveryRevision(captureProjectPayload()), recovery);
  useProtoStore.setState({projectPlan:{...useProtoStore.getState().projectPlan!,lastGenerationFailure:{pageId:'main',diagnostic:'temporary failure'}}});
  assert.equal(projectRecoveryRevision(captureProjectPayload()), recovery, 'host failure text is not a requirement edit');
  for (const edit of [
    () => usePageStore.getState().updateRow('travel',usePageStore.getState().tableRows.travel[0].id,{amount:42}),
    () => usePageStore.getState().resetRows(),
    () => usePageStore.setState({pageSources:{main:'changed source'}}),
    () => useProtoStore.setState({projectPlan:{...useProtoStore.getState().projectPlan!,summary:'新需求'}}),
    () => useProtoStore.setState({projectNotes:{nodes:[{id:'requirement',kind:'note',parentId:null,title:'需求',content:'<p>新增约束</p>'}],links:[]}}),
  ]) {
    loadProjectFromBinaryPayload(before);
    edit();
    assert.notEqual(projectRecoveryRevision(captureProjectPayload()), recovery);
  }
});
