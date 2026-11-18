import { projectWithHome } from './fixtures/projectWithHome';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { createNoteNode, setNoteTargetLinks, setPageNoteLinks } from '../src/services/notesWorkspace';
import {
  filterLedgerRows,
  ledgerInsights,
  noteLedgerRows,
  noteTaskCounts,
  sortLedgerRows,
} from '../src/proto/notesLedger';
import { NotesLedger } from '../src/components/NotesLedgerView';

const project = (projectId: string) =>
  projectWithHome({
    projectId,
    projectName: '台账测试工程',
    templateId: 'blank_project',
    storageDir: '/tmp',
    fileName: `${projectId}.pflow`,
    createdAt: '2026-11-04',
    updatedAt: '2026-11-04',
    pageCount: 0,
    tableCount: 0,
    stickyCount: 0,
  });

const task = (text: string, checked: boolean) =>
  `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"><span></span></label><div><p>${text}</p></div></li>`;

function seed(projectId: string) {
  loadProjectFromBinaryPayload(project(projectId));
  const folder = createNoteNode(projectId, 'folder', '客户访谈', null);
  const a = createNoteNode(projectId, 'note', '退款规则纪要', folder, {
    status: 'pending_confirm',
    priority: 'P0',
    stakeholder: '张总',
    meetingDate: '2026-11-02',
    tags: ['客户沟通'],
    content: `<p>退款需审批</p><ul data-type="taskList">${task('提供接口文档', false)}${task('确认税率', true)}</ul>`,
  });
  const b = createNoteNode(projectId, 'note', '采购审批评审', null, {
    status: 'confirmed',
    priority: 'P1',
    stakeholder: '张总',
    meetingDate: '2026-11-03',
  });
  const c = createNoteNode(projectId, 'note', '字段口径字典', null, { status: 'implemented', stakeholder: '李经理' });
  const d = createNoteNode(projectId, 'note', '会中速记', folder, { status: 'pending_confirm', priority: 'P2' });
  setPageNoteLinks(projectId, { kind: 'page', pageId: 'page-home' }, [a]);
  setNoteTargetLinks(projectId, folder, [{ kind: 'folder', folderId: 'folder-project-pages' }]);
  return { folder, a, b, c, d };
}

test('ledger rows aggregate status, priority, stakeholder, related pages and open to-dos', () => {
  const { folder, a, b, c, d } = seed('ledger-rows');
  const rows = noteLedgerRows(useProtoStore.getState().projectNotes, usePageStore.getState());
  assert.equal(rows.length, 4, 'folders are not ledger rows');
  const rowA = rows.find((r) => r.noteId === a)!;
  assert.equal(rowA.folderPath, '客户访谈');
  assert.deepEqual(rowA.relatedPageIds, ['page-home']);
  assert.equal(rowA.openTasks, 1);
  assert.equal(rowA.totalTasks, 2);
  // Folder links apply to the notes inside it.
  assert.deepEqual(rows.find((r) => r.noteId === d)!.relatedPageIds, ['page-home']);
  assert.deepEqual(rows.find((r) => r.noteId === b)!.relatedPageIds, []);
  assert.deepEqual(noteTaskCounts('<p>none</p>'), { total: 0, open: 0 });

  const inFolder = noteLedgerRows(useProtoStore.getState().projectNotes, usePageStore.getState(), folder);
  assert.deepEqual(inFolder.map((r) => r.noteId).sort(), [a, d].sort());

  // "How many P0 are still waiting for the customer?" / "What of Mr. Zhang's is not implemented?"
  assert.deepEqual(filterLedgerRows(rows, { priorities: ['P0'], statuses: ['pending_confirm'] }).map((r) => r.noteId), [a]);
  assert.deepEqual(
    filterLedgerRows(rows, { stakeholder: '张总', notImplemented: true }).map((r) => r.noteId).sort(),
    [a, b].sort()
  );
  assert.deepEqual(filterLedgerRows(rows, { priorities: ['none'] }).map((r) => r.noteId), [c]);
  assert.deepEqual(filterLedgerRows(rows, { query: '接口文档' }).map((r) => r.noteId), [a]);
  assert.deepEqual(filterLedgerRows(rows, { hasOpenTasks: true }).map((r) => r.noteId), [a]);

  const insights = ledgerInsights(rows);
  assert.equal(insights.find((i) => i.id === 'p0-pending')!.count, 1);
  assert.equal(insights.find((i) => i.id === 'pending')!.count, 2);
  assert.equal(insights.find((i) => i.id === 'stakeholder:张总')!.count, 2);
  assert.ok(!insights.some((i) => i.id === 'stakeholder:李经理'), 'implemented notes are not outstanding');

  // Priority sort keeps notes without a priority last in both directions.
  assert.deepEqual(sortLedgerRows(rows, { key: 'priority', direction: 'asc' }).map((r) => r.noteId), [a, b, d, c]);
  assert.equal(sortLedgerRows(rows, { key: 'priority', direction: 'desc' }).at(-1)!.noteId, c);
  assert.deepEqual(sortLedgerRows(rows, { key: 'status', direction: 'asc' }).map((r) => r.status), [
    'pending_confirm',
    'pending_confirm',
    'confirmed',
    'implemented',
  ]);
  const byDate = sortLedgerRows(rows, { key: 'meetingDate', direction: 'desc' }).map((r) => r.noteId);
  assert.ok(byDate.indexOf(b) < byDate.indexOf(a));
});

test('ledger table edits properties inline, kanban moves cards between lanes, and insight chips filter', () => {
  const { a, b } = seed('ledger-ui');
  const note = (id: string) => useProtoStore.getState().projectNotes.nodes.find((n) => n.id === id) as any;
  let r: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(React.createElement(NotesLedger, { projectId: 'ledger-ui', folderId: null, mode: 'table' }));
  });
  try {
    act(() => r!.root.findByProps({ 'aria-label': '退款规则纪要 的状态' }).props.onChange({ target: { value: 'confirmed' } }));
    assert.equal(note(a).status, 'confirmed');
    act(() => r!.root.findByProps({ 'aria-label': '退款规则纪要 的优先级' }).props.onChange({ target: { value: '' } }));
    assert.equal(note(a).priority, undefined);
    const stakeholder = () => r!.root.findByProps({ 'aria-label': '采购审批评审 的对接人' });
    act(() => stakeholder().props.onChange({ target: { value: '王总 ' } }));
    act(() => stakeholder().props.onBlur());
    assert.equal(note(b).stakeholder, '王总');

    const text = (node: TestRenderer.ReactTestInstance): string =>
      node.children.map((c) => (typeof c === 'string' ? c : text(c))).join('');
    const chip = r!.root.findAllByType('button').find((btn) => text(btn).includes('全部待客户确认'))!;
    act(() => chip.props.onClick());
    const titles = () =>
      r!.root
        .findAll((n) => n.type === 'span' && n.props.className?.includes('group-hover:text-blue-600'))
        .map((n) => n.props.children);
    assert.deepEqual(titles(), ['会中速记']);

    act(() => r!.update(React.createElement(NotesLedger, { projectId: 'ledger-ui', folderId: null, mode: 'kanban' })));
    const lane = r!.root.find((n) => n.type === 'section' && String(n.props['aria-label']).startsWith('已落地原型'));
    act(() =>
      lane.props.onDrop({ preventDefault() {}, dataTransfer: { getData: () => b } })
    );
    assert.equal(note(b).status, 'implemented');
    act(() =>
      r!.root.findByProps({ 'aria-label': '移动「会中速记」到其他状态' }).props.onChange({ target: { value: 'draft' } })
    );
    assert.equal(useProtoStore.getState().projectNotes.nodes.find((n) => n.title === '会中速记')!.kind, 'note');
  } finally {
    act(() => r!.unmount());
  }
});
