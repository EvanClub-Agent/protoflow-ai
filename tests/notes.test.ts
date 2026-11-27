import { projectWithHome } from './fixtures/projectWithHome';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import {
  captureProjectPayload,
  loadProjectFromBinaryPayload,
} from '../src/services/projectStorage';
import {
  encodePflowBinary,
  decodePflowBinary,
  generateUnpackedGitFiles,
} from '../src/utils/pflowBinaryCodec';
import {
  createNoteNode,
  deleteNoteNode,
  duplicateNoteNode,
  editNoteNode,
  importMarkdownAsNote,
  importMarkdownFilesAsNotes,
  openNoteNode,
  registerNoteImage,
  setNoteTargetLinks,
  setPageNoteLinks,
  toggleNoteTask,
  updateNoteContent,
  updateNoteMeta,
} from '../src/services/notesWorkspace';
import {
  NOTE_ASSET_SCHEME,
  NOTE_TEMPLATES,
  extractAllNoteTasks,
  extractNoteHeadings,
  markdownToNoteHtml,
  noteAiImageAttachments,
  noteAssetRefs,
  noteContext,
  noteHtmlToMarkdown,
  notePath,
  noteTemplateContent,
  uniqueNoteTitle,
} from '../src/proto/notes';
import { sanitizeNoteHtml } from '../src/proto/noteHtmlSanitize';
import { installTestDom } from './dom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectContext, projectRevision } from '../src/services/hermesProject';
import { buildProtoFlowHermesSkillMarkdown } from '../src/store/useHermesStore';
const { callTool, atomicWrite } = require(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
import { deleteMenu, prepareMenuDeletion } from '../src/services/menuDeletion';
import { ProjectNotesView, DockedNoteSidecar } from '../src/components/ProjectNotesView';

const project = (projectId: string) =>
  projectWithHome({
    projectId,
    projectName: '笔记测试工程',
    templateId: 'blank_project',
    storageDir: '/tmp',
    fileName: `${projectId}.pflow`,
    createdAt: '2026-11-04',
    updatedAt: '2026-11-04',
    pageCount: 0,
    tableCount: 0,
    stickyCount: 0,
  });

test('nested note folders, multiple notes, tags, covers, and page links survive project switch, binary archive, and Git export', () => {
  loadProjectFromBinaryPayload(project('proj-note-a'));
  const folderId = createNoteNode('proj-note-a', 'folder', '客户需求访谈', null, {
    icon: '📁',
  });
  const note1 = createNoteNode('proj-note-a', 'note', '第一轮采购访谈纪要', folderId, {
    icon: '🤝',
    content: '<h1>一、采购核心诉求</h1><p>需要支持多供应商比价与含税单价自动换算。</p><h2>二、待确认事项</h2>',
    tags: ['客户沟通', '会议纪要'],
    cover: 'ocean',
    pinned: true,
  });
  const note2 = duplicateNoteNode('proj-note-a', note1);
  assert.notEqual(note1, note2);

  updateNoteContent(
    'proj-note-a',
    note2,
    '<h2>补充评审结论</h2><p>驳回时必须填写驳回原因。</p>'
  );
  updateNoteMeta('proj-note-a', note2, {
    tags: ['原型评审'],
    cover: 'emerald',
    pinned: false,
  });

  setPageNoteLinks('proj-note-a', { kind: 'page', pageId: 'page-home' }, [note1]);
  setNoteTargetLinks('proj-note-a', folderId, [
    { kind: 'folder', folderId: 'folder-project-pages' },
  ]);

  const ctx = noteContext(
    useProtoStore.getState().projectNotes,
    note1,
    usePageStore.getState()
  );
  assert.deepEqual(ctx.relatedPageIds, ['page-home']);
  assert.equal(ctx.path, '客户需求访谈 / 第一轮采购访谈纪要');

  const headings = extractNoteHeadings(ctx.content);
  assert.equal(headings.length, 2);
  assert.equal(headings[0].text, '一、采购核心诉求');

  const saved = captureProjectPayload();
  loadProjectFromBinaryPayload(project('proj-note-b'));
  assert.deepEqual(useProtoStore.getState().projectNotes, { nodes: [], links: [] });
  assert.throws(() => openNoteNode('proj-note-b', note1), /不存在/);

  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(saved)));
  assert.deepEqual(captureProjectPayload().stateSnapshot, saved.stateSnapshot);

  const files = generateUnpackedGitFiles(saved);
  const mdFile = files.find((f) => f.relativePath === `notes/${note1}.md`);
  assert.ok(mdFile);
  assert.ok(mdFile!.content.includes('第一轮采购访谈纪要'));
  assert.ok(mdFile!.content.includes('需要支持多供应商比价'));
  const index = JSON.parse(files.find((f) => f.relativePath === 'notes/index.json')!.content);
  assert.deepEqual(index.links, saved.stateSnapshot.projectNotes!.links);
  // Bodies live in the .md files; index.json keeps structure and metadata only.
  assert.equal(index.nodes.length, saved.stateSnapshot.projectNotes!.nodes.length);
  assert.ok(index.nodes.every((n: { content?: string }) => n.content === undefined));
  assert.equal(index.nodes.find((n: { id: string }) => n.id === note1).file, `${note1}.md`);
});

test('markdown import, export, validation guards, and menu deletion cleanup work atomically', () => {
  loadProjectFromBinaryPayload(project('proj-note-md'));
  const importedId = importMarkdownAsNote(
    'proj-note-md',
    'customer-spec.md',
    '# 仓储验收客户沟通记录\n\n## 1. 业务规则\n- [x] 验收数量不可大于剩余未交数量\n- [ ] 异常批次需上传质检附件\n',
    null
  );
  const node = useProtoStore
    .getState()
    .projectNotes.nodes.find((n) => n.id === importedId)!;
  assert.equal(node.title, '仓储验收客户沟通记录');
  assert.equal(node.kind, 'note');
  const exportedMd = noteHtmlToMarkdown(node);
  assert.ok(exportedMd.includes('仓储验收客户沟通记录'));
  assert.ok(exportedMd.includes('验收数量不可大于剩余未交数量'));

  // Validation guards against duplicate sibling names and cycles
  assert.throws(
    () => createNoteNode('proj-note-md', 'note', '仓储验收客户沟通记录', null),
    /同名/
  );
  const f1 = createNoteNode('proj-note-md', 'folder', '目录A', null);
  const f2 = createNoteNode('proj-note-md', 'folder', '目录B', f1);
  assert.throws(() => editNoteNode('proj-note-md', f1, '目录A', f2), /循环/);
  assert.equal(notePath(useProtoStore.getState().projectNotes, f2), '目录A / 目录B');

  // Menu deletion cleans up note links and undo restores them
  setPageNoteLinks('proj-note-md', { kind: 'page', pageId: 'page-home' }, [importedId]);
  const beforeDelete = captureProjectPayload();
  const undo = deleteMenu(prepareMenuDeletion(beforeDelete, 'folder-project-pages'));
  assert.equal(useProtoStore.getState().projectNotes.nodes.length, 3);
  assert.deepEqual(useProtoStore.getState().projectNotes.links, []);
  undo.undo();
  assert.deepEqual(
    useProtoStore.getState().projectNotes,
    beforeDelete.stateSnapshot.projectNotes
  );

  deleteNoteNode('proj-note-md', f1);
  assert.equal(useProtoStore.getState().projectNotes.nodes.length, 1);
});

test('ProjectNotesView renders welcome template cards and opens editor when creating a note', () => {
  loadProjectFromBinaryPayload(project('proj-note-ui'));
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(ProjectNotesView, { projectId: 'proj-note-ui' })
    );
  });
  try {
    const initialTree = JSON.stringify(renderer!.toJSON());
    assert.ok(initialTree.includes('客户需求沟通纪要'));
    assert.ok(initialTree.includes('原型评审与修改记录'));

    const templateBtn = renderer!.root
      .findAllByType('button')
      .find((b) =>
        b.findAll((node) =>
          node.children.some(
            (c) => typeof c === 'string' && c.includes('客户需求沟通纪要')
          )
        ).length > 0
      );
    assert.ok(templateBtn);
    act(() => {
      templateBtn!.props.onClick();
    });

    assert.equal(useProtoStore.getState().projectNotes.nodes.length, 1);
    assert.equal(
      useProtoStore.getState().projectNotes.nodes[0].title,
      '客户需求沟通纪要'
    );
    // Priority is a deliberate PM decision; templates must not default everything to P0.
    assert.equal('priority' in useProtoStore.getState().projectNotes.nodes[0], false);
    const editorTree = JSON.stringify(renderer!.toJSON());
    assert.ok(editorTree.includes('发给项目 AI'));
    assert.ok(editorTree.includes('分屏对照原型'));

    // Global action items extraction & toggle
    const tasksBefore = extractAllNoteTasks(useProtoStore.getState().projectNotes);
    assert.equal(tasksBefore.length, 3);
    assert.equal(tasksBefore.filter((t) => !t.checked).length, 2);

    const firstUnchecked = tasksBefore.find((t) => !t.checked)!;
    act(() => {
      toggleNoteTask('proj-note-ui', firstUnchecked.noteId, firstUnchecked.taskIndex);
    });
    const tasksAfter = extractAllNoteTasks(useProtoStore.getState().projectNotes);
    assert.equal(tasksAfter.filter((t) => !t.checked).length, 1);

    // PM Ledger metadata update
    act(() => {
      updateNoteMeta('proj-note-ui', firstUnchecked.noteId, {
        status: 'confirmed',
        priority: 'P0',
        stakeholder: '采购部张总',
        meetingDate: '2026-11-04',
      });
    });
    const updatedNode = useProtoStore.getState().projectNotes.nodes[0];
    assert.equal(updatedNode.kind, 'note');
    if (updatedNode.kind === 'note') {
      assert.equal(updatedNode.status, 'confirmed');
      assert.equal(updatedNode.priority, 'P0');
      assert.equal(updatedNode.stakeholder, '采购部张总');
    }

    // Docked split-screen sidecar rendering
    let sidecarRenderer: TestRenderer.ReactTestRenderer;
    act(() => {
      sidecarRenderer = TestRenderer.create(
        React.createElement(DockedNoteSidecar, {
          projectId: 'proj-note-ui',
          noteId: updatedNode.id,
        })
      );
    });
    assert.ok(JSON.stringify(sidecarRenderer!.toJSON()).includes('伴随需求笔记'));
    act(() => sidecarRenderer!.unmount());
  } finally {
    act(() => renderer!.unmount());
  }
});

test('optional note properties can be cleared, and stale links never block editing or saving', () => {
  loadProjectFromBinaryPayload(project('proj-note-meta'));
  const id = createNoteNode('proj-note-meta', 'note', '属性清空', null, {
    priority: 'P1',
    stakeholder: '王总',
  });
  const note = () => {
    const n = useProtoStore.getState().projectNotes.nodes.find((x) => x.id === id)!;
    assert.equal(n.kind, 'note');
    return n as Extract<typeof n, { kind: 'note' }>;
  };
  updateNoteMeta('proj-note-meta', id, { priority: undefined, stakeholder: '', meetingDate: '' });
  assert.equal(note().priority, undefined);
  assert.equal(note().stakeholder, undefined);
  assert.equal(note().meetingDate, undefined);
  assert.equal('priority' in note(), false);
  // Omitted keys are left untouched.
  updateNoteMeta('proj-note-meta', id, { priority: 'P2' });
  updateNoteMeta('proj-note-meta', id, { pinned: true });
  assert.equal(note().priority, 'P2');

  // A link to a page that disappeared outside the normal cleanup paths.
  setPageNoteLinks('proj-note-meta', { kind: 'page', pageId: 'page-home' }, [id]);
  useProtoStore.setState({
    projectNotes: {
      ...useProtoStore.getState().projectNotes,
      links: [
        ...useProtoStore.getState().projectNotes.links,
        { page: { kind: 'page', pageId: 'page-gone' }, targetNodeId: id },
        { page: { kind: 'folder', folderId: 'folder-gone' }, targetNodeId: id },
      ],
    },
  });
  updateNoteContent('proj-note-meta', id, '<p>仍然可以继续编辑</p>');
  updateNoteMeta('proj-note-meta', id, { title: '属性清空 已改名' });
  assert.deepEqual(
    noteContext(useProtoStore.getState().projectNotes, id, usePageStore.getState()).relatedPageIds,
    ['page-home']
  );
  const saved = captureProjectPayload();
  assert.deepEqual(saved.stateSnapshot.projectNotes!.links, [
    { page: { kind: 'page', pageId: 'page-home' }, targetNodeId: id },
  ]);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(saved)));
  // Editing links prunes stale ones too, but still rejects an explicitly invalid target.
  assert.throws(
    () => setPageNoteLinks('proj-note-meta', { kind: 'page', pageId: 'page-gone' }, [id]),
    /页面 ID 无效/
  );
});

test('template placeholders resolve at creation time and generated titles never clash', () => {
  const tpl = NOTE_TEMPLATES.find((t) => t.id === 'customer-discovery')!;
  assert.ok(tpl.content.includes('{{today}}'));
  const html = noteTemplateContent(tpl, new Date(2027, 0, 9));
  assert.ok(html.includes('2027-01-09'));
  assert.ok(!html.includes('{{today}}'));

  loadProjectFromBinaryPayload(project('proj-note-unique'));
  const data = () => useProtoStore.getState().projectNotes;
  createNoteNode('proj-note-unique', 'note', '速记', null);
  assert.equal(uniqueNoteTitle(data(), null, '速记'), '速记 (2)');
  assert.equal(uniqueNoteTitle(data(), 'other-folder', '速记'), '速记');
  const a = importMarkdownAsNote('proj-note-unique', 'a.md', '# 速记\n正文', null);
  assert.equal(data().nodes.find((n) => n.id === a)!.title, '速记 (2)');
});

test('the docked sidecar creates unique quick notes, accepts spaces in titles and reports clashes', () => {
  loadProjectFromBinaryPayload(project('proj-note-sidecar'));
  const findQuick = (r: TestRenderer.ReactTestRenderer) =>
    r.root.findAllByType('button').find((b) => b.props.title === '为当前页面新建速记笔记')!;
  let r: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(
      React.createElement(DockedNoteSidecar, { projectId: 'proj-note-sidecar', noteId: '__empty__' })
    );
  });
  try {
    act(() => findQuick(r!).props.onClick());
    act(() => findQuick(r!).props.onClick());
    const notes = useProtoStore.getState().projectNotes;
    const titles = notes.nodes.map((n) => n.title);
    assert.equal(titles.length, 2);
    assert.equal(new Set(titles).size, 2);
    // Uses the page title rather than its ID, and links both notes to the page.
    assert.ok(titles.every((t) => !t.startsWith('page-home')));
    assert.equal(notes.links.filter((l) => l.page.kind === 'page' && l.page.pageId === 'page-home').length, 2);

    const dockedId = useProtoStore.getState().dockedNoteId!;
    act(() => {
      r!.update(
        React.createElement(DockedNoteSidecar, { projectId: 'proj-note-sidecar', noteId: dockedId })
      );
    });
    const titleInput = () => r!.root.findByProps({ 'aria-label': '伴随笔记标题' });
    act(() => titleInput().props.onChange({ target: { value: '采购 需求 ' } }));
    assert.equal(titleInput().props.value, '采购 需求 ');
    act(() => titleInput().props.onBlur());
    assert.equal(
      useProtoStore.getState().projectNotes.nodes.find((n) => n.id === dockedId)!.title,
      '采购 需求'
    );

    const otherTitle = useProtoStore.getState().projectNotes.nodes.find((n) => n.id !== dockedId)!.title;
    act(() => titleInput().props.onChange({ target: { value: otherTitle } }));
    assert.doesNotThrow(() => act(() => titleInput().props.onBlur()));
    assert.equal(titleInput().props.value, '采购 需求');
    assert.ok(JSON.stringify(r!.toJSON()).includes('同名'));
  } finally {
    act(() => r!.unmount());
  }
});

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG}`;
const GIF_URL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const noteById = (id: string) => {
  const n = useProtoStore.getState().projectNotes.nodes.find((x) => x.id === id)!;
  assert.equal(n.kind, 'note');
  return n as Extract<typeof n, { kind: 'note' }>;
};

test('project AI sees a compact notes catalog, reads full notes through MCP, and note edits never invalidate AI results', () => {
  loadProjectFromBinaryPayload(project('proj-note-ai'));
  const id = createNoteNode('proj-note-ai', 'note', '采购客户沟通', null, {
    content: `<h2>结论</h2><p>审批驳回必须填写原因。</p><img src="${PNG_URL}" alt="客户截图"><p>补充说明</p>`,
    status: 'pending_confirm',
    priority: 'P1',
    stakeholder: '采购部王总',
  });
  setPageNoteLinks('proj-note-ai', { kind: 'page', pageId: 'page-home' }, [id]);

  const context = projectContext();
  const entry = context.projectNotes.find((n) => n.noteId === id)!;
  assert.deepEqual(entry.relatedPageIds, ['page-home']);
  assert.equal(entry.status, 'pending_confirm');
  assert.equal(entry.stakeholder, '采购部王总');
  assert.match(entry.summary, /审批驳回必须填写原因/);
  assert.ok(!JSON.stringify(context.projectNotes).includes('base64'), 'catalog never carries image bytes');
  assert.match(context.projectNoteDocuments[id], /\[图片 1：客户截图\]/);
  assert.ok(!context.projectNoteDocuments[id].includes('base64'));

  const revision = projectRevision();
  updateNoteContent('proj-note-ai', id, '<p>AI 运行期间继续记录</p>');
  updateNoteMeta('proj-note-ai', id, { status: 'confirmed' });
  assert.equal(projectRevision(), revision);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-mcp-'));
  const file = path.join(dir, 'context.json');
  try {
    atomicWrite(file, { active: true, runId: 'notes', projectId: 'proj-note-ai', kind: 'project', readOnly: true, snapshot: projectContext(), operations: [] });
    const projectInfo = callTool(file, 'protoflow_get_project', {});
    assert.equal(projectInfo.projectNotes[0].noteId, id);
    assert.equal(projectInfo.projectNoteDocuments, undefined, 'full documents are only served on demand');
    const byPage = callTool(file, 'protoflow_get_project_notes', { pageId: 'page-home' });
    assert.equal(byPage.total, 1);
    assert.match(byPage.notes[0].content, /AI 运行期间继续记录/);
    assert.equal(byPage.notes[0].status, 'confirmed');
    assert.equal(callTool(file, 'protoflow_get_project_notes', { noteIds: [id] }).notes[0].title, '采购客户沟通');
    assert.equal(callTool(file, 'protoflow_get_project_notes', {}).notes.length, 1);
    assert.throws(() => callTool(file, 'protoflow_get_project_notes', { noteIds: ['nope'] }), /Unknown noteId/);
    assert.throws(() => callTool(file, 'protoflow_get_project_notes', { pageId: '首页' }), /Unknown pageId/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.match(buildProtoFlowHermesSkillMarkdown([], [], [], 'project'), /protoflow_get_project_notes/);
});

test('note images are stored once as assets, migrated from inline data, pruned when unused, and kept in every export', () => {
  loadProjectFromBinaryPayload(project('proj-note-img'));
  const src1 = registerNoteImage('proj-note-img', PNG_URL, '截图.png');
  const src2 = registerNoteImage('proj-note-img', PNG_URL, '截图副本.png');
  assert.equal(src1, src2, 'identical images are deduplicated');
  assert.ok(src1.startsWith(NOTE_ASSET_SCHEME));
  assert.throws(() => registerNoteImage('proj-note-img', 'data:text/plain;base64,SGk='), /仅支持/);

  // Pasted/legacy inline images are moved into the asset table automatically.
  const id = createNoteNode('proj-note-img', 'note', '带图笔记', null, { content: '<p>正文</p>' });
  updateNoteContent('proj-note-img', id, `<p>正文</p><img src="${PNG_URL}" alt="截图 & 说明"><img src="${GIF_URL}" alt="动图">`);
  const stored = noteById(id).content;
  assert.ok(!stored.includes('base64'));
  assert.equal(noteAssetRefs(stored).length, 2);
  assert.equal(noteAssetRefs(stored)[0], src1.slice(NOTE_ASSET_SCHEME.length));

  // Unused assets are dropped from the saved project; referenced ones survive the round trip.
  registerNoteImage('proj-note-img', `data:image/png;base64,${PNG.replace('ggg==', 'ggA=')}`);
  const saved = captureProjectPayload();
  assert.equal(Object.keys(saved.stateSnapshot.projectNotes!.assets!).length, 2);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(saved)));
  assert.equal(Object.keys(useProtoStore.getState().projectNotes.assets!).length, 2);

  const assets = useProtoStore.getState().projectNotes.assets;
  const node = noteById(id);
  assert.match(noteHtmlToMarkdown(node), /\[图片 1：截图 & 说明\]/);
  const inline = noteHtmlToMarkdown(node, { images: 'inline', assets });
  assert.ok(inline.includes(`![截图 & 说明](${PNG_URL})`));
  // The single-file export re-imports with its images.
  const reimported = importMarkdownAsNote('proj-note-img', 'x.md', inline, null);
  assert.equal(noteAssetRefs(noteById(reimported).content).length, 2);

  const files = generateUnpackedGitFiles(captureProjectPayload());
  const md = files.find((f) => f.relativePath === `notes/${id}.md`)!.content;
  const pngFile = files.find((f) => f.relativePath.startsWith('notes/assets/') && f.relativePath.endsWith('.png'))!;
  assert.equal(pngFile.encoding, 'base64');
  assert.equal(pngFile.content, PNG);
  assert.ok(md.includes(`](${pngFile.relativePath.replace('notes/', '')})`));
  assert.ok(!files.find((f) => f.relativePath === 'notes/index.json')!.content.includes(PNG));

  // AI attachments: PNG/JPEG/WebP only, numbered like the placeholders.
  const pick = noteAiImageAttachments(node.content, assets);
  assert.equal(pick.total, 2);
  assert.deepEqual(pick.attachments.map((a) => a.index), [1]);

  // Archives saved before assets existed are migrated on load.
  const legacy = project('proj-note-legacy');
  legacy.stateSnapshot.projectNotes = {
    nodes: [{ id: 'legacy', kind: 'note', title: '旧笔记', parentId: null, icon: '📝', updatedAt: '2026-11-01T00:00:00.000Z', content: `<img src="${PNG_URL}">`, tags: [], cover: 'none', pinned: false }],
    links: [],
  };
  loadProjectFromBinaryPayload(legacy);
  assert.ok(noteById('legacy').content.includes(NOTE_ASSET_SCHEME));

  const broken = captureProjectPayload();
  broken.stateSnapshot.projectNotes!.assets = { '../evil': { mime: 'image/png', data: PNG } };
  assert.throws(() => loadProjectFromBinaryPayload(broken), /图片 ID 无效/);
});

test('an open rich editor picks up external task toggles instead of overwriting them', async () => {
  const restore = installTestDom();
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    loadProjectFromBinaryPayload(project('proj-note-sync'));
    const imageSrc = registerNoteImage('proj-note-sync', PNG_URL, '截图');
    const id = createNoteNode('proj-note-sync', 'note', '同步', null, {
      content:
        `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>确认税率</p></div></li></ul><p>正文</p><img src="${imageSrc}" alt="截图">`,
    });
    openNoteNode('proj-note-sync', id);
    await act(async () => {
      root.render(React.createElement(ProjectNotesView, { projectId: 'proj-note-sync' }));
    });
    const dom = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: any }) | null;
    assert.ok(dom?.editor, 'rich editor should mount under jsdom');
    const editor = dom!.editor;
    // The document keeps the asset reference; only the on-screen image resolves the bytes.
    assert.equal(container.querySelector('img.pf-note-image')?.getAttribute('src'), PNG_URL);
    assert.ok(editor.getHTML().includes(imageSrc));

    await act(async () => {
      toggleNoteTask('proj-note-sync', id, 0);
    });
    assert.match(editor.getHTML(), /data-checked="true"/);

    await act(async () => {
      editor.commands.focus('end');
      editor.commands.insertContent('继续输入');
    });
    const content = (useProtoStore.getState().projectNotes.nodes.find((n) => n.id === id) as any).content;
    assert.match(content, /data-checked="true"/);
    assert.match(content, /继续输入/);
  } finally {
    await act(async () => root.unmount());
    // Let editor/React teardown finish before the fake DOM is removed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    container.remove();
    restore();
  }
});

test('PRD-grade Markdown round-trip: H1–H5, nested lists, inline-code pipes, <br> table cells, GFM callouts, Mermaid blocks, cross-doc links, batch import, and read-only/wide UI', async () => {
  const restore = installTestDom();
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    loadProjectFromBinaryPayload(project('proj-prd-suite'));

    const prdMd0 = [
      '# 00-PRD总纲与双端闭环状态机架构规范',
      '',
      '> [!IMPORTANT]',
      '> 所有审批流以单据状态枚举直接体现，严禁出现孤立无下游的单据。',
      '',
      '## 1. 全局状态流转图',
      '',
      '```mermaid',
      'stateDiagram-v2',
      '  direction LR',
      '  [*] --> 草稿',
      '  草稿 --> 待审核: 提交申请',
      '  待审核 --> 已通过: 审批通过',
      '```',
      '',
      '### 1.1 多级业务规则树',
      '- 主端入库红线',
      '  - 本次验收数量 `recv_qty <= remain_qty`',
      '  - 关联 [首页工作台](#pf-page:page-home) 与 [主数据表](#pf-table:tbl_mat)',
      '- 供应商协同规则',
      '  1. 报价截止前允许撤回重报',
      '  2. 中标后自动下推采购订单',
      '',
      '#### 1.1.1 核心字段与枚举字典表（含管道符与换行）',
      '',
      '| 字段名 | 枚举值定义 | 交互与校验说明 |',
      '| --- | --- | --- |',
      '| `F_Status` | `0|草稿`、`1|待审`、`2|已审` | 第一行说明<br>第二行补充说明 |',
      '| `F_Type` | 普通 \\| 紧急 | 参见 [模块一PRD](#pf-note:note_mod_1) |',
      '',
      '##### (a) 五级细则标题保留验证',
      '支持五级标题无损往返。',
    ].join('\n');

    const prdMd1 = '# 01-主端PRD-基础资料与计划招采\n\n## 2.1 物资档案维护\n- [x] 支持批次保质期预警\n';

    const importedIds = importMarkdownFilesAsNotes(
      'proj-prd-suite',
      [
        { fileName: '00-总纲.md', markdownText: prdMd0 },
        { fileName: '01-主端.md', markdownText: prdMd1 },
      ],
      null
    );
    assert.equal(importedIds.length, 2);

    const note0 = noteById(importedIds[0]);
    assert.equal(note0.title, '00-PRD总纲与双端闭环状态机架构规范');
    assert.match(note0.content, /<blockquote data-callout="important">/);
    assert.match(note0.content, /<code class="language-mermaid">/);
    assert.match(note0.content, /<h4>1\.1\.1 核心字段与枚举字典表（含管道符与换行）<\/h4>/);
    assert.match(note0.content, /<h5>\(a\) 五级细则标题保留验证<\/h5>/);
    // `0|草稿` must NOT split the 3-column table row into extra columns
    const rowMatches = [...note0.content.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
    assert.equal(rowMatches.length, 3);
    for (const row of rowMatches) {
      const cells = row[1].match(/<(?:th|td)>/g) ?? [];
      assert.equal(cells.length, 3, 'every row must have exactly 3 cells despite inline code pipes');
    }
    assert.match(note0.content, /第一行说明<br>第二行补充说明/);
    assert.match(note0.content, /href="#pf-page:page-home"/);
    assert.match(note0.content, /href="#pf-table:tbl_mat"/);
    assert.match(note0.content, /href="#pf-note:note_mod_1"/);

    // TOC extracts H1–H4
    const headings = extractNoteHeadings(note0.content);
    assert.deepEqual(
      headings.map((h) => h.level),
      [2, 3, 4]
    );

    // Sanitizer preserves data-callout, language-mermaid, H5, and opted-in note/table links
    const sanitized = sanitizeNoteHtml(note0.content, {
      resolveImage: () => null,
      keepPageLink: (p) => p === 'page-home',
      keepNoteLink: (n) => n === 'note_mod_1',
      keepTableLink: (t) => t === 'tbl_mat',
    });
    assert.match(sanitized, /data-callout="important"/);
    assert.match(sanitized, /class="language-mermaid"/);
    assert.match(sanitized, /href="#pf-note:note_mod_1"/);
    assert.match(sanitized, /href="#pf-table:tbl_mat"/);

    // Round-trip HTML -> Markdown -> HTML preserves callouts, mermaid lang, nested lists, table cells & links
    const exported = noteHtmlToMarkdown(note0);
    assert.match(exported, /> \[!IMPORTANT\]/);
    assert.match(exported, /```mermaid/);
    assert.match(exported, /  - 本次验收数量 `recv_qty <= remain_qty`/);
    assert.match(exported, /\[首页工作台\]\(#pf-page:page-home\)/);
    assert.match(exported, /第一行说明<br>第二行补充说明/);
    const reparsed = markdownToNoteHtml(exported);
    assert.match(reparsed.html, /<blockquote data-callout="important">/);
    assert.match(reparsed.html, /<code class="language-mermaid">/);
    assert.match(reparsed.html, /第一行说明<br>第二行补充说明/);

    // Mount ProjectNotesView and verify Mermaid block NodeView + Read-Only lock toggle
    openNoteNode('proj-prd-suite', importedIds[0]);
    await act(async () => {
      root.render(React.createElement(ProjectNotesView, { projectId: 'proj-prd-suite' }));
    });
    assert.ok(container.querySelector('.pf-note-mermaid-block'), 'Mermaid diagram block NodeView should render');
    const dom = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: any }) | null;
    assert.equal(dom?.editor?.isEditable, true);

    const lockBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('阅读锁定')
    );
    assert.ok(lockBtn, 'Read-only lock button should exist');
    await act(async () => {
      lockBtn!.click();
    });
    assert.equal(dom?.editor?.isEditable, false, 'editor should lock in read-only mode');
  } finally {
    await act(async () => root.unmount());
    await new Promise((resolve) => setTimeout(resolve, 20));
    container.remove();
    restore();
  }
});
