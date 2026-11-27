import { projectWithHome } from './fixtures/projectWithHome';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SITEMAP_TREE, useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { buildSitemap, folderOptions } from '../src/proto/sitemap';
import { captureProjectPayload, createProjectPayload, loadProjectFromBinaryPayload, normalizeProjectPayload } from '../src/services/projectStorage';
import { decodePflowBinary, encodePflowBinary, generateUnpackedGitFiles } from '../src/utils/pflowBinaryCodec';
import { prepareProjectChanges, projectContext, projectRevision } from '../src/services/hermesProject';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { LeftSitemapTree, DEFAULT_SITEMAP_WIDTH, MIN_SITEMAP_WIDTH, MAX_SITEMAP_WIDTH, SITEMAP_WIDTH_STORAGE_KEY } from '../src/components/LeftSitemapTree';
import { NewFolderModal } from '../src/components/NewFolderModal';

// Menu editing regressions exercise a sample-backed project with one authored
// page and no tables. Actual blank-project isolation has its own tests.
function menuFixture(id = 'folder-test') {
  const payload = projectWithHome({ projectId: id, projectName: id, templateId: 'blank_project', storageDir: '/tmp', fileName: `${id}.pflow`, createdAt: '2026-10-30', updatedAt: '2026-10-30', pageCount: 0, tableCount: 0, stickyCount: 0 });
  payload.meta.templateId = 'customs_erp';
  payload.stateSnapshot.sitemapBase = structuredClone(SITEMAP_TREE);
  payload.stateSnapshot.designerFolders = [];
  payload.stateSnapshot.designerPages[0].folderId = 'folder-base-data';
  loadProjectFromBinaryPayload(payload);
}
const source = 'export default function Page(){return <Page pfId="root" title="客户列表"/>;}';

test('empty and nested menu folders survive archive save/reopen and remain isolated by project', () => {
  menuFixture();
  const root = usePageStore.getState().createDesignerFolder('客户管理', null);
  const child = usePageStore.getState().createDesignerFolder('客户档案', root.id);
  const empty = usePageStore.getState().createDesignerFolder('待设计模块', null);
  usePageStore.getState().createDesignerPage({ pageId: 'customer-list', title: '客户列表', folderId: child.id }, source);
  const saved = captureProjectPayload();
  const bytes = encodePflowBinary(saved);
  menuFixture('other');
  assert.deepEqual(usePageStore.getState().designerFolders, []);
  loadProjectFromBinaryPayload(decodePflowBinary(bytes));
  assert.deepEqual(usePageStore.getState().designerFolders, [root, child, empty]);
  const tree = buildSitemap(usePageStore.getState().designerFolders, usePageStore.getState().designerPages, usePageStore.getState().sitemapOverrides, usePageStore.getState().sitemapBase);
  assert.equal(tree.find(item => item.id === root.id)!.children![0].children![0].pageId, 'customer-list');
  assert.deepEqual(tree.find(item => item.id === empty.id)!.children, []);
  assert.equal(folderOptions([root, child], usePageStore.getState().sitemapOverrides, usePageStore.getState().sitemapBase).find(item => item.id === child.id)!.path, '客户管理 / 客户档案');
  assert.deepEqual(JSON.parse(generateUnpackedGitFiles(saved).find(file => file.relativePath === 'pages/folders.json')!.content), [root, child, empty]);
  assert.equal(createPublishedSnapshot('customer-list').pages.find(page => page.pageId === 'customer-list')!.folderId, child.id);
});

test('invalid folder graphs and missing page parents fail before mutating either store', () => {
  menuFixture();
  const root = usePageStore.getState().createDesignerFolder('业务模块', null);
  assert.throws(() => usePageStore.getState().createDesignerFolder('  ', null), /目录名称/);
  assert.throws(() => usePageStore.getState().createDesignerFolder('业务模块', null), /同名/);
  assert.throws(() => usePageStore.getState().createDesignerFolder('孤立目录', 'unknown'), /不存在/);
  assert.throws(() => usePageStore.getState().createDesignerPage({ pageId: 'orphan', title: '孤立页面', folderId: 'unknown' }, source), /不存在/);
  assert.deepEqual(usePageStore.getState().designerFolders, [root]);
  const before = captureProjectPayload().stateSnapshot;
  for (const folders of [
    undefined,
    [{ ...root, parentFolderId: root.id }],
    [root, { ...root, title: '重复 ID' }],
    [{ ...root, parentFolderId: 'missing' }],
    [{ id: 'a', title: 'A', parentFolderId: 'b' }, { id: 'b', title: 'B', parentFolderId: 'a' }],
  ]) {
    const invalid: any = captureProjectPayload(); invalid.stateSnapshot.designerFolders = folders;
    assert.throws(() => loadProjectFromBinaryPayload(invalid));
    assert.deepEqual(captureProjectPayload().stateSnapshot, before);
  }
});

test('V2 archives explicitly migrate without inheriting custom folders or guessing missing parents', () => {
  menuFixture();
  const legacy: any = captureProjectPayload(); legacy.schemaVersion = 2; delete legacy.stateSnapshot.sitemapBase; delete legacy.stateSnapshot.designerFolders; delete legacy.stateSnapshot.sitemapOverrides; delete legacy.stateSnapshot.mindmaps;
  usePageStore.getState().createDesignerFolder('其他工程的目录', null);
  loadProjectFromBinaryPayload(legacy);
  assert.deepEqual(usePageStore.getState().designerFolders, []);
  assert.deepEqual(usePageStore.getState().pageSources, legacy.stateSnapshot.pageSources);
  assert.equal(captureProjectPayload().schemaVersion, 7);
  legacy.stateSnapshot.designerPages[0].folderId = 'not-an-existing-folder';
  assert.throws(() => normalizeProjectPayload(legacy), /菜单目录不存在/);
});

test('Hermes sees exact custom folder IDs and may create pages there; a new folder invalidates stale context', () => {
  menuFixture();
  const before = projectRevision();
  const root = usePageStore.getState().createDesignerFolder('业务模块', null);
  const child = usePageStore.getState().createDesignerFolder('订单管理', root.id);
  assert.notEqual(projectRevision(), before);
  const context = projectContext();
  assert.ok(context.contracts.folderIds.includes(child.id));
  assert.equal(context.folders.find(folder => folder.id === child.id)!.path, '业务模块 / 订单管理');
  const args = { pageId: 'ai-custom-page', title: 'AI 页面', folderId: child.id, source };
  const result = prepareProjectChanges(captureProjectPayload(), [{ tool: 'protoflow_apply_tsx_patch', args }]);
  assert.equal(result.next.stateSnapshot.designerPages.find(page => page.pageId === args.pageId)!.folderId, child.id);
  assert.throws(() => prepareProjectChanges(captureProjectPayload(), [{ tool: 'protoflow_apply_tsx_patch', args: { ...args, folderId: 'fake' } }]), /目录不存在/);
});

test('sidebar creates a root folder and child, creates a page under the exact child, and collapses on first click', async () => {
  menuFixture();
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(LeftSitemapTree)); });
  const button = (text: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(text))!;
  try {
    act(() => button('新建目录').props.onClick());
    act(() => renderer!.root.findByType(NewFolderModal).findByType('input').props.onChange({ target: { value: '客户管理' } }));
    act(() => renderer!.root.findByType(NewFolderModal).findByType('form').props.onSubmit({ preventDefault() {} }));
    const root = usePageStore.getState().designerFolders[0];
    assert.equal(root.parentFolderId, null);
    act(() => renderer!.root.findByProps({ 'aria-label': '在客户管理中新建子目录' }).props.onClick());
    assert.equal(renderer!.root.findByType(NewFolderModal).findByType('select').props.value, root.id);
    act(() => renderer!.root.findByType(NewFolderModal).findByType('input').props.onChange({ target: { value: '客户档案' } }));
    act(() => renderer!.root.findByType(NewFolderModal).findByType('form').props.onSubmit({ preventDefault() {} }));
    const child = usePageStore.getState().designerFolders[1];
    act(() => renderer!.root.findByProps({ 'aria-label': '在客户档案中新建页面' }).props.onClick());
    assert.equal(renderer!.root.findByProps({ 'aria-label': '所属模块菜单目录' }).props.value, child.id);
    assert.equal(renderer!.root.findByProps({ 'aria-label': '页面交互模板' }).props.value, 'blank');
    act(() => renderer!.root.findByProps({ 'aria-label': '页面菜单名称' }).props.onChange({ target: { value: '客户列表' } }));
    await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    const page = usePageStore.getState().designerPages.find(item => item.title === '客户列表')!;
    assert.equal(page.folderId, child.id);
    assert.equal(useProtoStore.getState().activePageId, page.pageId);
    assert.equal(renderer!.root.findAllByProps({ role: 'dialog' }).length, 0);
    act(() => useProtoStore.setState({ expandedFolders: {} }));
    const folderButton = renderer!.root.findAllByType('button').find(node => node.findAllByType('span').some(span => span.children.includes('客户管理')))!;
    act(() => folderButton.props.onClick());
    assert.equal(useProtoStore.getState().expandedFolders[root.id], false);
    act(() => button('新建目录').props.onClick());
    act(() => menuFixture('switched-project'));
    assert.equal(renderer!.root.findAllByType(NewFolderModal).length, 0);
  } finally { act(() => renderer!.unmount()); }
});

test('folder dialog cancellation and duplicate-name errors do not create extra directories', () => {
  menuFixture();
  usePageStore.getState().createDesignerFolder('客户管理', null);
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(LeftSitemapTree)); });
  try {
    const open = () => renderer!.root.findAllByType('button').find(node => node.children.includes('新建目录'))!.props.onClick();
    act(open);
    act(() => renderer!.root.findByType(NewFolderModal).findByType('input').props.onChange({ target: { value: '客户管理' } }));
    act(() => renderer!.root.findByType(NewFolderModal).findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.match(renderer!.root.findByProps({ role: 'alert' }).children.join(''), /同名/);
    assert.equal(usePageStore.getState().designerFolders.length, 1);
    act(() => renderer!.root.findByType('dialog').props.onCancel());
    assert.equal(renderer!.root.findAllByType(NewFolderModal).length, 0);
    assert.equal(usePageStore.getState().designerFolders.length, 1);
  } finally { act(() => renderer!.unmount()); }
});

test('moving built-in and custom folders carries subtrees and preserves all page data and relations', () => {
  menuFixture();
  loadProjectFromBinaryPayload(createProjectPayload({ ...useProtoStore.getState().currentProjectMeta, templateId: 'customs_erp' }));
  const rows = usePageStore.getState().getRows('t_base_supplier');
  usePageStore.setState({ tableRows: { t_base_supplier: rows } });
  const destination = usePageStore.getState().createDesignerFolder('工作台', null);
  const child = usePageStore.getState().createDesignerFolder('客户档案', 'folder-base-data');
  usePageStore.getState().createDesignerPage({ pageId: 'customer-list', title: '客户列表', folderId: child.id }, source);
  const before = captureProjectPayload().stateSnapshot;
  const revision = projectRevision();
  usePageStore.getState().moveSitemapItem({ kind: 'folder', id: 'folder-base-data' }, destination.id, 'folder-test');
  const state = usePageStore.getState();
  assert.equal(folderOptions(state.designerFolders, state.sitemapOverrides, state.sitemapBase).find(folder => folder.id === child.id)!.path, '工作台 / 基础资料管理 / 客户档案');
  const after = captureProjectPayload().stateSnapshot;
  for (const key of ['pageSources', 'designerPages', 'stickyNotes', 'dbTables', 'widgets', 'tableRows'] as const) assert.deepEqual(after[key], before[key]);
  assert.notEqual(projectRevision(), revision);
  assert.equal(projectContext().folders.find(folder => folder.id === child.id)!.path, '工作台 / 基础资料管理 / 客户档案');
  const tree = buildSitemap(state.designerFolders, state.designerPages, state.sitemapOverrides, state.sitemapBase);
  assert.ok(tree.find(item => item.id === destination.id)!.children!.some(item => item.id === 'folder-base-data'));
  const bytes = encodePflowBinary(captureProjectPayload());
  menuFixture('another-project');
  assert.deepEqual(usePageStore.getState().sitemapOverrides, { folderParents: {}, pageFolders: {} });
  loadProjectFromBinaryPayload(decodePflowBinary(bytes));
  assert.equal(usePageStore.getState().sitemapOverrides.folderParents['folder-base-data'], destination.id);
  usePageStore.getState().moveSitemapItem({ kind: 'folder', id: child.id }, null, 'folder-test');
  assert.equal(usePageStore.getState().designerFolders.find(folder => folder.id === child.id)!.parentFolderId, null);
  assert.equal(usePageStore.getState().designerPages.find(page => page.pageId === 'customer-list')!.folderId, child.id);
});

test('page moves use exact page IDs and publish their new positions without fabricating missing canvas sources', () => {
  menuFixture();
  const root = usePageStore.getState().createDesignerFolder('销售管理', null);
  const before = usePageStore.getState().pageSources;
  usePageStore.getState().moveSitemapItem({ kind: 'page', id: 'material-catalog' }, root.id, 'folder-test');
  assert.equal(usePageStore.getState().pageSources, before);
  assert.equal(usePageStore.getState().pageSources['material-catalog'], undefined);
  let state = usePageStore.getState();
  assert.ok(buildSitemap(state.designerFolders, state.designerPages, state.sitemapOverrides, state.sitemapBase).find(item => item.id === root.id)!.children!.some(item => item.pageId === 'material-catalog'));
  state.setPageSource('material-catalog', source);
  state.moveSitemapItem({ kind: 'page', id: 'page-home' }, root.id, 'folder-test');
  state = usePageStore.getState();
  assert.equal(state.designerPages.find(page => page.pageId === 'page-home')!.folderId, root.id);
  assert.equal(createPublishedSnapshot('material-catalog').pages.find(page => page.pageId === 'material-catalog')!.folderId, root.id);
  const saved = captureProjectPayload();
  assert.deepEqual(JSON.parse(generateUnpackedGitFiles(saved).find(file => file.relativePath === 'pages/sitemap-overrides.json')!.content), state.sitemapOverrides);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(saved)));
  assert.deepEqual(usePageStore.getState().sitemapOverrides, state.sitemapOverrides);
});

test('invalid moves, mixed cycles, name collisions and stale project actions fail atomically; same-parent is a no-op', () => {
  menuFixture();
  const root = usePageStore.getState().createDesignerFolder('工作台', null);
  const child = usePageStore.getState().createDesignerFolder('子目录', root.id);
  const duplicate = usePageStore.getState().createDesignerFolder('基础资料管理', root.id);
  const move = usePageStore.getState().moveSitemapItem;
  const unchanged = usePageStore.getState();
  move({ kind: 'folder', id: root.id }, null, 'folder-test');
  assert.equal(usePageStore.getState(), unchanged);
  for (const [target, parent, project] of [
    [{ kind: 'folder', id: root.id }, child.id, 'folder-test'],
    [{ kind: 'folder', id: root.id }, root.id, 'folder-test'],
    [{ kind: 'folder', id: 'folder-base-data' }, root.id, 'folder-test'],
    [{ kind: 'folder', id: duplicate.id }, null, 'folder-test'],
    [{ kind: 'folder', id: root.id }, 'missing', 'folder-test'],
    [{ kind: 'folder', id: root.id }, 'folder-deprecated', 'folder-test'],
    [{ kind: 'page', id: 'page-home' }, null, 'folder-test'],
    [{ kind: 'page', id: 'missing' }, root.id, 'folder-test'],
    [{ kind: 'page', id: 'page-home' }, root.id, 'another-project'],
  ] as const) {
    assert.throws(() => move(target, parent, project));
    assert.equal(usePageStore.getState(), unchanged);
  }
  move({ kind: 'folder', id: 'folder-procurement' }, child.id, 'folder-test');
  const mixed = usePageStore.getState();
  assert.throws(() => move({ kind: 'folder', id: root.id }, 'folder-procurement', 'folder-test'), /自己的子目录/);
  assert.equal(usePageStore.getState(), mixed);
});

test('V3 migration preserves custom hierarchies; V4 invalid placement maps never alter the active project', () => {
  menuFixture();
  const parent = usePageStore.getState().createDesignerFolder('业务目录', null);
  const legacy: any = captureProjectPayload(); legacy.schemaVersion = 3; delete legacy.stateSnapshot.sitemapBase; delete legacy.stateSnapshot.sitemapOverrides; delete legacy.stateSnapshot.mindmaps;
  usePageStore.getState().moveSitemapItem({ kind: 'folder', id: 'folder-base-data' }, parent.id, 'folder-test');
  loadProjectFromBinaryPayload(legacy);
  assert.deepEqual(usePageStore.getState().designerFolders, [parent]);
  assert.deepEqual(usePageStore.getState().sitemapOverrides, { folderParents: {}, pageFolders: {} });
  const before = captureProjectPayload().stateSnapshot;
  for (const overrides of [undefined, {}, { folderParents: { unknown: null }, pageFolders: {} }, { folderParents: { 'folder-base-data': 'missing' }, pageFolders: {} }, { folderParents: {}, pageFolders: { 'material-catalog': null } }, { folderParents: {}, pageFolders: { 'material-catalog': 'missing' } }]) {
    const invalid: any = captureProjectPayload(); invalid.stateSnapshot.sitemapOverrides = overrides;
    assert.throws(() => loadProjectFromBinaryPayload(invalid));
    assert.deepEqual(captureProjectPayload().stateSnapshot, before);
  }
});

test('move modal selects and promotes directories, prevents descendant choices, cancels, undoes, and resets on project switch', () => {
  menuFixture();
  const parent = usePageStore.getState().createDesignerFolder('客户中心', null);
  const child = usePageStore.getState().createDesignerFolder('客户档案', parent.id);
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(LeftSitemapTree)); });
  const clickLabel = (label: string) => act(() => renderer!.root.findByProps({ 'aria-label': label }).props.onClick());
  const clickText = (text: string) => act(() => renderer!.root.findAllByType('button').find(button => button.children.includes(text))!.props.onClick());
  try {
    clickLabel('移动客户中心');
    assert.equal(renderer!.root.findAllByProps({ 'aria-label': '选择客户中心' }).length, 0);
    assert.equal(renderer!.root.findAllByProps({ 'aria-label': '选择客户中心 / 客户档案' }).length, 0);
    clickLabel('选择基础资料管理');
    clickText('取消');
    assert.equal(usePageStore.getState().designerFolders[0].parentFolderId, null);
    clickLabel('移动客户档案');
    clickText('提升一级');
    act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(usePageStore.getState().designerFolders[1].parentFolderId, null);
    clickText('撤销');
    assert.equal(usePageStore.getState().designerFolders[1].parentFolderId, parent.id);
    clickLabel('移动客户中心');
    act(() => renderer!.root.findByProps({ 'aria-label': '搜索目标目录' }).props.onChange({ target: { value: '采购' } }));
    assert.equal(renderer!.root.findByProps({ 'aria-label': '目标目录' }).findAllByType('button').length, 1);
    clickLabel('选择采购与招标管理');
    act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(usePageStore.getState().designerFolders[0].parentFolderId, 'folder-procurement');
    assert.equal(usePageStore.getState().designerFolders[1].parentFolderId, parent.id);
    assert.equal(useProtoStore.getState().expandedFolders['folder-procurement'], true);
    act(() => usePageStore.getState().createDesignerFolder('新增目录', null));
    assert.equal(renderer!.root.findAllByType('button').filter(button => button.children.includes('撤销')).length, 0);
    clickLabel('移动客户档案');
    act(() => menuFixture('different-project'));
    assert.equal(renderer!.root.findAllByType('dialog').length, 0);
    assert.ok(!usePageStore.getState().designerFolders.some(folder => folder.id === child.id));
  } finally { act(() => renderer!.unmount()); }
});

test('dragging pages and folders uses the same validated move, with a top-level drop target for nested folders', () => {
  menuFixture();
  const parent = usePageStore.getState().createDesignerFolder('客户中心', null);
  const child = usePageStore.getState().createDesignerFolder('客户档案', parent.id);
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(LeftSitemapTree)); });
  const dragEvent = { preventDefault() {}, stopPropagation() {}, dataTransfer: { setData() {}, effectAllowed: '', dropEffect: '' } };
  const row = (id: string) => renderer!.root.findByProps({ 'data-sitemap-id': id });
  try {
    act(() => row('node-page-home').findAllByType('button')[0].props.onDragStart(dragEvent));
    act(() => row(child.id).props.onDragOver(dragEvent));
    act(() => row(child.id).props.onDrop(dragEvent));
    assert.equal(usePageStore.getState().designerPages[0].folderId, child.id);
    act(() => row(parent.id).findAllByType('button')[0].props.onDragStart(dragEvent));
    act(() => row(child.id).props.onDrop(dragEvent));
    assert.equal(usePageStore.getState().designerFolders[0].parentFolderId, null);
    act(() => row(child.id).findAllByType('button')[0].props.onDragStart(dragEvent));
    act(() => renderer!.root.findByProps({ 'data-sitemap-root-drop': true }).props.onDrop(dragEvent));
    assert.equal(usePageStore.getState().designerFolders[1].parentFolderId, null);
    assert.equal(usePageStore.getState().designerPages[0].folderId, child.id);
    assert.equal(renderer!.root.findAllByProps({ 'data-sitemap-root-drop': true }).length, 0);
  } finally { act(() => renderer!.unmount()); }
});

test('long menu titles stay intact in DOM inside pf-sitemap-label while row actions collapse at rest and sidebar width resizes and persists', () => {
  menuFixture();
  const longFolderTitle = '14 供应商门户·准入目录与年度框架协议管理';
  const longPageTitle = '海关实验室危化试剂正负冲抵合并发票上传审核';
  const folder = usePageStore.getState().createDesignerFolder(longFolderTitle, null);
  usePageStore.getState().createDesignerPage({ pageId: 'long-menu-page', title: longPageTitle, folderId: folder.id }, source);
  const store = new Map<string, string>();
  const hasWindowStorage = typeof window !== 'undefined' && Boolean(window.localStorage);
  const prevStorage = hasWindowStorage ? undefined : Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  if (!hasWindowStorage) {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
      },
    });
  }
  const activeStorage = hasWindowStorage ? window.localStorage : globalThis.localStorage;
  activeStorage.removeItem(SITEMAP_WIDTH_STORAGE_KEY);

  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(LeftSitemapTree)); });
  try {
    const aside = renderer!.root.findByType('aside');
    assert.equal(aside.props.style.width, `${DEFAULT_SITEMAP_WIDTH}px`);

    // Full accessible names stay intact in DOM (never JS-sliced) inside .pf-sitemap-label > span
    const labels = renderer!.root.findAll(node => node.type === 'span' && typeof node.props.className === 'string' && node.props.className.includes('pf-sitemap-label'));
    const labelTexts = labels.map(node => (node.children[0] as TestRenderer.ReactTestInstance).children.join(''));
    assert.ok(labelTexts.includes(longFolderTitle));
    assert.ok(labelTexts.includes(longPageTitle));

    // Row action bar takes 0px idle layout width (w-0 anchor) and collapses visually until hover/focus-within
    const pageRow = renderer!.root.findByProps({ 'data-sitemap-id': 'node-long-menu-page' });
    const actionsBar = pageRow.find(node => node.type === 'div' && typeof node.props.className === 'string' && node.props.className.includes('pf-sitemap-actions'));
    assert.match(actionsBar.props.className, /opacity-0/);
    assert.match(actionsBar.props.className, /group-hover:opacity-100/);
    assert.match(actionsBar.props.className, /group-focus-within:opacity-100/);

    // Keyboard & double-click resize updates width within bounds and persists to localStorage
    const sash = renderer!.root.findByProps({ role: 'separator', 'aria-label': '拖拽调整页面目录宽度' });
    act(() => sash.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} }));
    assert.equal(renderer!.root.findByType('aside').props.style.width, `${DEFAULT_SITEMAP_WIDTH + 16}px`);
    assert.equal(activeStorage.getItem(SITEMAP_WIDTH_STORAGE_KEY), String(DEFAULT_SITEMAP_WIDTH + 16));

    act(() => sash.props.onKeyDown({ key: 'Home', preventDefault() {} }));
    assert.equal(renderer!.root.findByType('aside').props.style.width, `${MIN_SITEMAP_WIDTH}px`);

    act(() => sash.props.onKeyDown({ key: 'End', preventDefault() {} }));
    const clampedMax = Number(renderer!.root.findByType('aside').props.style.width.replace('px', ''));
    assert.ok(clampedMax >= MIN_SITEMAP_WIDTH && clampedMax <= MAX_SITEMAP_WIDTH);

    act(() => sash.props.onDoubleClick());
    assert.equal(renderer!.root.findByType('aside').props.style.width, `${DEFAULT_SITEMAP_WIDTH}px`);
    assert.equal(activeStorage.getItem(SITEMAP_WIDTH_STORAGE_KEY), String(DEFAULT_SITEMAP_WIDTH));
  } finally {
    act(() => renderer!.unmount());
    activeStorage.removeItem(SITEMAP_WIDTH_STORAGE_KEY);
    if (!hasWindowStorage) {
      if (prevStorage) Object.defineProperty(globalThis, 'localStorage', prevStorage);
      else delete (globalThis as Record<string, unknown>).localStorage;
    }
  }
});
