import { projectWithHome } from './fixtures/projectWithHome';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SITEMAP_TREE, useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { buildSitemap } from '../src/proto/sitemap';
import { createProjectPayload, captureProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { publishableSitemap, publishablePages, createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { projectContext, prepareProjectChanges } from '../src/services/hermesProject';
import { encodePflowBinary, decodePflowBinary, generateUnpackedGitFiles } from '../src/utils/pflowBinaryCodec';
import { LeftSitemapTree } from '../src/components/LeftSitemapTree';

const meta = (id = 'clean-blank', templateId: 'blank_project' | 'customs_erp' = 'blank_project') => ({ projectId: id, projectName: '我的空白工程', templateId, storageDir: '/tmp', fileName: `${id}.pflow`, createdAt: '2026-10-30', updatedAt: '2026-10-30', pageCount: 0, tableCount: 0, stickyCount: 0 });
const menu = () => { const s = usePageStore.getState(); return buildSitemap(s.designerFolders, s.designerPages, s.sitemapOverrides, s.sitemapBase); };
const sampleNames = ['供应商审批', '物料目录', '采购与招标管理', '验收入库管理', '作废设计', '系统总体要求', '设计变更记录'];
const newSource = 'export default function Page(){return <Page pfId="customer-root" title="客户列表"/>;}';

test('a new blank archive reopens with no pages or folders, ready to create its first real menu', () => {
  const blank = createProjectPayload(meta());
  assert.equal(blank.meta.pageCount, 0);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(blank)));
  assert.deepEqual(menu(), []);
  assert.equal(useProtoStore.getState().activePageId, '');
  assert.deepEqual(usePageStore.getState().pageSources, {});
  assert.deepEqual(projectContext().contracts.folderIds, []);
  assert.deepEqual(projectContext().pageCatalog, []);
  assert.deepEqual(publishablePages(), []);
  assert.deepEqual(publishableSitemap(), []);
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(LeftSitemapTree)); });
  try {
    const ui = JSON.stringify(renderer!.toJSON());
    for (const name of sampleNames) assert.ok(!ui.includes(name), name);
    act(() => renderer!.root.findAllByType('button').find(button => button.children.includes('新建页'))!.props.onClick());
    const folderDialog = renderer!.root.findByProps({ 'aria-labelledby': 'new-folder-title' });
    act(() => folderDialog.findByType('input').props.onChange({target:{value:'业务管理'}}));
    act(() => folderDialog.findByType('form').props.onSubmit({preventDefault(){}}));
    const [createdFolder] = usePageStore.getState().designerFolders;
    assert.deepEqual(usePageStore.getState().designerPages, []);
    assert.equal(renderer!.root.findByProps({ 'aria-label': '所属模块菜单目录' }).props.value, createdFolder.id);
    assert.equal(renderer!.root.findByProps({ 'aria-label': '页面交互模板' }).props.value, 'blank');
    act(() => renderer!.root.findByProps({'aria-label':'页面菜单名称'}).props.onChange({target:{value:'订单'}}));
    act(() => { void renderer!.root.findByProps({'aria-label':'新建页面'}).findByType('form').props.onSubmit({preventDefault(){}}); });
    const [page] = usePageStore.getState().designerPages;
    assert.equal(page.title, '订单'); assert.equal(page.folderId, createdFolder.id);
    assert.equal(useProtoStore.getState().activePageId, page.pageId);
  } finally { act(() => renderer!.unmount()); }
  assert.throws(() => usePageStore.getState().moveSitemapItem({ kind: 'page', id: 'supplier-approval' }, 'folder-project-pages', 'clean-blank'), /不存在/);
  assert.throws(() => prepareProjectChanges(captureProjectPayload(), [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'invalid-ai-page', title: '错误目录', folderId: 'folder-base-data', source: newSource } }]), /目录不存在/);
});

test('blank menus and edits survive switching sample projects, archive round trips, moves and Git export', () => {
  loadProjectFromBinaryPayload(projectWithHome(meta()));
  const folder = usePageStore.getState().createDesignerFolder('客户管理', 'folder-project-pages');
  usePageStore.getState().createDesignerPage({ pageId: 'customer-page', title: '客户列表', folderId: folder.id }, newSource);
  usePageStore.getState().moveSitemapItem({ kind: 'page', id: 'page-home' }, folder.id, 'clean-blank');
  const before = menu(), saved = captureProjectPayload();
  loadProjectFromBinaryPayload(createProjectPayload(meta('sample', 'customs_erp')));
  assert.ok(JSON.stringify(menu()).includes('供应商审批'));
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(saved)));
  assert.deepEqual(menu(), before);
  assert.equal(usePageStore.getState().pageSources['customer-page'], newSource);
  for (const name of sampleNames) assert.ok(!JSON.stringify(menu()).includes(name));
  const files = generateUnpackedGitFiles(saved);
  assert.equal(files.find(file => file.relativePath === 'pages/sitemap-base.json')!.content, '[]');
  assert.ok(!files.some(file => file.relativePath === 'pages/018_supplier-approval.page.json'));
  assert.ok(!files.find(file => file.relativePath === 'protoflow.project.json')!.content.includes('采购'));
  assert.equal(createPublishedSnapshot('page-home').pages.find(page => page.pageId === 'customer-page')!.folderId, folder.id);
});

test('V4 blank archives lose unreferenced sample nodes but retain authored pages, notes, IDs and moved hierarchy', () => {
  const old: any = projectWithHome(meta('legacy-blank'));
  old.schemaVersion = 4; delete old.stateSnapshot.sitemapBase; delete old.stateSnapshot.mindmaps;
  old.stateSnapshot.designerFolders = [{ id: 'author-folder', title: '自建目录', parentFolderId: null }];
  old.stateSnapshot.designerPages[0].folderId = 'folder-base-data';
  old.stateSnapshot.pageSources['supplier-approval'] = newSource;
  old.stateSnapshot.sitemapOverrides = { folderParents: { 'folder-procurement': 'author-folder' }, pageFolders: { 'supplier-approval': 'folder-procurement' } };
  old.stateSnapshot.stickyNotes = [{ id: 'note-authored', pageId: 'supplier-approval', targetWidgetId: 'customer-root', targetWidgetName: '页面', index: 1, text: '保留我写的需求', compiledRule: '', active: true }];
  loadProjectFromBinaryPayload(old);
  assert.deepEqual(usePageStore.getState().pageSources, old.stateSnapshot.pageSources);
  assert.deepEqual(useProtoStore.getState().stickyNotes, old.stateSnapshot.stickyNotes);
  assert.deepEqual(usePageStore.getState().sitemapOverrides, old.stateSnapshot.sitemapOverrides);
  const tree = menu();
  const root = tree.find(item => item.id === 'author-folder')!;
  assert.equal(root.children![0].id, 'folder-procurement');
  assert.equal(root.children![0].children![0].pageId, 'supplier-approval');
  for (const missing of ['合格供应商目录', '物料目录', '验收入库管理', '作废设计', '设计变更记录']) assert.ok(!JSON.stringify(tree).includes(missing));
  const saved = captureProjectPayload(); assert.equal(saved.schemaVersion, 7);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(saved))); assert.deepEqual(menu(), tree);
});

test('new menu archives reject missing templates and bad identities without mixing projects', () => {
  const payload = createProjectPayload(meta()); loadProjectFromBinaryPayload(payload);
  const before = usePageStore.getState();
  for (const base of [undefined, null, [{ id: 'bad', title: '坏目录', type: 'folder' }], [SITEMAP_TREE[0], SITEMAP_TREE[0]]]) {
    assert.throws(() => loadProjectFromBinaryPayload({ ...payload, stateSnapshot: { ...payload.stateSnapshot, sitemapBase: base } }));
    assert.equal(usePageStore.getState(), before);
  }
});
