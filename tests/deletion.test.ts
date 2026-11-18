import { projectWithHome } from './fixtures/projectWithHome';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { buildSitemap, folderOptions } from '../src/proto/sitemap';
import { createProjectPayload, captureProjectPayload, loadProjectFromBinaryPayload, readRecentProject, restoreRecentProjects } from '../src/services/projectStorage';
import { prepareMenuDeletion, deleteMenu } from '../src/services/menuDeletion';
import { deleteProject } from '../src/services/projectDeletion';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { encodePflowBinary, decodePflowBinary, type PflowProjectMetadata } from '../src/utils/pflowBinaryCodec';
import { LeftSitemapTree } from '../src/components/LeftSitemapTree';
import { ProjectWelcomeLauncher } from '../src/components/ProjectWelcomeLauncher';
import { DeleteConfirmation } from '../src/components/DeleteConfirmation';
const { trashProjectArchive } = require(path.join(process.cwd(), 'electron/project-files.cjs'));
const meta = (projectId = 'delete-test'): PflowProjectMetadata => ({ projectId, projectName: projectId, templateId: 'blank_project', storageDir: '/tmp/delete-test', fileName: 'project.pflow', createdAt: '2026-10-30', updatedAt: '2026-10-30', pageCount: 0, tableCount: 0, stickyCount: 0 });
const source = (id: string) => `export default function Page(){return <Page pfId="${id}" title="${id}"/>;}`;
const menu = () => { const s = usePageStore.getState(); return buildSitemap(s.designerFolders, s.designerPages, s.sitemapOverrides, s.sitemapBase); };

test('directory deletion follows the current subtree and cleans notes, bindings and incoming navigation; undo restores all', () => {
  const p = projectWithHome(meta());
  p.stateSnapshot.designerFolders.push({ id: 'other', title: '其他目录', parentFolderId: null }, { id: 'child', title: '子目录', parentFolderId: 'folder-project-pages' });
  p.stateSnapshot.designerPages.push({ pageId: 'child-page', title: '子页面', folderId: 'child' }, { pageId: 'keep', title: '保留页面', folderId: 'other' });
  p.stateSnapshot.pageSources['child-page'] = source('child');
  p.stateSnapshot.pageSources.keep = 'export default function Page(){return <Page pfId="keep"><Button pfId="go" onClick={()=>{navigate("page-home");toast("保留动作");}}>跳转</Button></Page>}';
  p.stateSnapshot.dbTables = [{ id: 'table', tableName: 'material', cnName: '物料', domain: '基础资料域 (MDM)', description: '', columns: [{ id: 'c', name: 'name', nullable: false, dataType: 'TEXT', comment: '' }], sharedByMenus: ['page-home', 'keep'].map(pageId => ({ pageId, menuTitle: pageId, accessMode: 'CRUD 读写', fieldMappingNote: '' })) }];
  p.stateSnapshot.tableRows = { table: [{ id: 'row', name: '必须保留' }] };
  p.stateSnapshot.stickyNotes = [{ id: 'note', index: 1, pageId: 'page-home', targetWidgetId: 'home-root', targetWidgetName: '首页', text: '备注', compiledRule: '', active: true }];
  loadProjectFromBinaryPayload(p);
  const before = captureProjectPayload().stateSnapshot;
  const plan = prepareMenuDeletion(captureProjectPayload(), 'folder-project-pages');
  assert.equal(plan.pageCount, 2); assert.equal(plan.folderCount, 2); assert.equal(plan.linkCount, 1);
  const undo = deleteMenu(plan);
  const after = captureProjectPayload().stateSnapshot;
  assert.deepEqual(Object.keys(after.pageSources), ['keep']);
  assert.equal(after.activePageId, 'keep');
  assert.equal(after.stickyNotes.length, 0);
  assert.deepEqual(after.dbTables[0].sharedByMenus.map(m => m.pageId), ['keep']);
  assert.deepEqual(after.tableRows, before.tableRows);
  assert.doesNotMatch(after.pageSources.keep, /navigate/); assert.match(after.pageSources.keep, /保留动作/);
  assert.equal(undo.canUndo(), true); undo.undo();
  assert.deepEqual(captureProjectPayload().stateSnapshot, before);
});

test('deleting moved template directories preserves moved-out children and persists deletions in archive and publication', () => {
  loadProjectFromBinaryPayload(createProjectPayload({ ...meta(), templateId: 'customs_erp' }));
  const pages = usePageStore.getState();
  pages.moveSitemapItem({ kind: 'page', id: 'supplier-approval' }, 'folder-acceptance', 'delete-test');
  pages.moveSitemapItem({ kind: 'folder', id: 'folder-plan' }, 'folder-base-data', 'delete-test');
  deleteMenu(prepareMenuDeletion(captureProjectPayload(), 'folder-base-data'));
  assert.equal(usePageStore.getState().pageSources['annual-plan'], undefined);
  assert.ok(usePageStore.getState().pageSources['supplier-approval']);
  assert.doesNotMatch(JSON.stringify(menu()), /基础资料管理|年度计划-审批/);
  assert.ok(folderOptions(usePageStore.getState().designerFolders, usePageStore.getState().sitemapOverrides, usePageStore.getState().sitemapBase).every(f => f.id !== 'folder-base-data'));
  // A real deleted directory must not block reusing its display name.
  assert.doesNotThrow(() => usePageStore.getState().createDesignerFolder('基础资料管理', null));
  deleteMenu(prepareMenuDeletion(captureProjectPayload(), 'node-doc-overview'));
  const saved = encodePflowBinary(captureProjectPayload());
  loadProjectFromBinaryPayload(decodePflowBinary(saved));
  assert.doesNotMatch(JSON.stringify(menu()), /doc-overview|年度计划-审批/);
  const published = createPublishedSnapshot('supplier-approval');
  assert.doesNotMatch(JSON.stringify(published.sitemap), /doc-overview|folder-base-data|folder-plan/);
  assert.ok(published.pages.some(p => p.pageId === 'supplier-approval'));
});

test('the last menu can be deleted, saved and reopened without creating fake pages; stale deletion and undo are rejected', () => {
  loadProjectFromBinaryPayload(projectWithHome(meta()));
  const stale = prepareMenuDeletion(captureProjectPayload(), 'node-page-home');
  usePageStore.getState().setPageSource('page-home', source('changed'));
  assert.throws(() => deleteMenu(stale), /内容已变化/);
  const undo = deleteMenu(prepareMenuDeletion(captureProjectPayload(), 'folder-project-pages'));
  assert.equal(useProtoStore.getState().activePageId, '');
  assert.deepEqual(menu(), []);
  assert.deepEqual(usePageStore.getState().pageSources, {});
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(captureProjectPayload())));
  assert.equal(useProtoStore.getState().activePageId, '');
  assert.deepEqual(menu(), []);
  loadProjectFromBinaryPayload(createProjectPayload(meta('other-project')));
  assert.equal(undo.canUndo(), false); assert.throws(undo.undo, /内容已变化/);
});

test('native trash validates exact archive identity and paths, leaves other files intact, and propagates trash failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-delete-'));
  try {
    const p = createProjectPayload({ ...meta(), storageDir: dir });
    const file = path.join(dir, p.meta.fileName), other = path.join(dir, 'other.txt');
    fs.writeFileSync(file, encodePflowBinary(p)); fs.writeFileSync(other, 'keep');
    const input = { projectId: p.meta.projectId, dirPath: dir, fileName: p.meta.fileName };
    let trashed = 0;
    const trash = async (target: string) => { trashed++; fs.renameSync(target, path.join(dir, 'trash.pflow')); };
    await assert.rejects(trashProjectArchive({ ...input, projectId: 'wrong' }, trash), /ID 已变化/);
    await assert.rejects(trashProjectArchive({ ...input, fileName: '../other.txt' }, trash), /路径无效/);
    fs.symlinkSync(file, path.join(dir, 'link.pflow'));
    await assert.rejects(trashProjectArchive({ ...input, fileName: 'link.pflow' }, trash), /普通文件/);
    await assert.rejects(trashProjectArchive(input, async () => { throw new Error('trash unavailable'); }), /trash unavailable/);
    assert.equal(trashed, 0); assert.equal(fs.existsSync(file), true);
    assert.deepEqual(await trashProjectArchive(input, trash), { deleted: true, missing: false });
    assert.equal(trashed, 1); assert.equal(fs.readFileSync(other, 'utf8'), 'keep');
    assert.deepEqual(await trashProjectArchive(input, trash), { deleted: false, missing: true });
    assert.equal(trashed, 1);
    fs.writeFileSync(file, Buffer.from(encodePflowBinary(p)).subarray(0, 40));
    await assert.rejects(trashProjectArchive(input, trash), /格式无效/);
    assert.equal(trashed, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('project deletion keeps the list on native failure; successful current deletion closes editing and persists removal', async () => {
  loadProjectFromBinaryPayload(createProjectPayload(meta('keep')));
  loadProjectFromBinaryPayload(createProjectPayload(meta()));
  const target = useProtoStore.getState().currentProjectMeta;
  (window as any).protoflowDesktop = { trashProject: async () => { throw new Error('trash failed'); } };
  await assert.rejects(deleteProject(target), /trash failed/);
  assert.equal(useProtoStore.getState().isProjectClosed, false);
  assert.ok(useProtoStore.getState().recentProjects.some(p => p.projectId === target.projectId));
  let input: unknown;
  (window as any).protoflowDesktop.trashProject = async (p: unknown) => { input = p; return { deleted: true, missing: false }; };
  await deleteProject(target);
  assert.deepEqual(input, { projectId: target.projectId, dirPath: target.storageDir, fileName: target.fileName });
  assert.equal(useProtoStore.getState().isProjectClosed, true);
  assert.throws(captureProjectPayload, /当前项目已关闭/);
  await assert.rejects(readRecentProject(target.projectId), /记录不存在/);
  restoreRecentProjects();
  assert.deepEqual(useProtoStore.getState().recentProjects.map(p => p.projectId), ['keep']);
  loadProjectFromBinaryPayload(createProjectPayload(meta('next')));
  assert.equal(useProtoStore.getState().isProjectClosed, false);
});

test('a list persistence failure after trash still closes the deleted project and reports the partial failure', async () => {
  loadProjectFromBinaryPayload(createProjectPayload(meta()));
  const target = useProtoStore.getState().currentProjectMeta;
  (window as any).protoflowDesktop = { trashProject: async () => ({ deleted: true, missing: false }) };
  const storage = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error('storage unavailable'); };
  try {
    const result = await deleteProject(target);
    assert.match(result.recordWarning, /文件已移到废纸篓.*项目列表保存失败/);
    assert.equal(useProtoStore.getState().isProjectClosed, true);
    assert.equal(useProtoStore.getState().recentProjects.length, 0);
  } finally { window.localStorage.setItem = storage; }
});

test('menu UI confirms deletion and supports cancel and undo', async () => {
  loadProjectFromBinaryPayload(projectWithHome(meta()));
  let ui: TestRenderer.ReactTestRenderer;
  act(() => { ui = TestRenderer.create(React.createElement(LeftSitemapTree)); });
  try {
    const click = (label: string) => ui!.root.findByProps({ 'aria-label': label }).props.onClick();
    act(() => click('删除首页'));
    assert.equal(ui!.root.findByType(DeleteConfirmation).props.title, '删除菜单');
    act(() => ui!.root.findByType(DeleteConfirmation).props.onClose());
    assert.ok(usePageStore.getState().pageSources['page-home']);
    act(() => click('删除项目页面'));
    await act(async () => { await ui!.root.findByType(DeleteConfirmation).props.onConfirm(); });
    assert.equal(useProtoStore.getState().activePageId, '');
    const undo = ui!.root.findAllByType('button').find(b => b.children.includes('撤销删除'))!;
    act(() => undo.props.onClick());
    assert.ok(usePageStore.getState().pageSources['page-home']);
  } finally { act(() => ui!.unmount()); }
});

test('project list exposes a trash confirmation without opening or deleting the project on the first click', () => {
  loadProjectFromBinaryPayload(createProjectPayload(meta()));
  let calls = 0;
  (window as any).protoflowDesktop = { trashProject: async () => { calls++; return { deleted: true, missing: false }; } };
  let ui: TestRenderer.ReactTestRenderer;
  act(() => { ui = TestRenderer.create(React.createElement(ProjectWelcomeLauncher)); });
  try {
    act(() => ui!.root.findByProps({ 'aria-label': '删除项目delete-test' }).props.onClick());
    assert.equal(calls, 0);
    const confirm = ui!.root.findByType(DeleteConfirmation);
    assert.equal(confirm.props.confirmLabel, '移到废纸篓并删除');
    act(() => confirm.props.onClose());
    assert.equal(calls, 0);
    assert.equal(useProtoStore.getState().recentProjects.length, 1);
  } finally { act(() => ui!.unmount()); }
});
