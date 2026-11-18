import { projectWithHome } from './fixtures/projectWithHome';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { captureProjectPayload, loadProjectFromBinaryPayload, normalizeProjectPayload } from '../src/services/projectStorage';
import { encodePflowBinary, decodePflowBinary, generateUnpackedGitFiles } from '../src/utils/pflowBinaryCodec';
import { createMindmapNode, deleteMindmapNode, editMindmapNode, setPageMindmapLinks, openMindmapNode } from '../src/services/mindmapWorkspace';
import { mindmapContext, mindmapPath } from '../src/proto/mindmaps';
import { deleteMenu, prepareMenuDeletion } from '../src/services/menuDeletion';

const project = (projectId: string) => projectWithHome({ projectId, projectName: '脑图测试', templateId: 'blank_project', storageDir: '/tmp', fileName: `${projectId}.pflow`, createdAt: '2026-11-01', updatedAt: '2026-11-01', pageCount: 0, tableCount: 0, stickyCount: 0 });

test('nested maps, sources and exact page/folder associations survive switching, archive and Git export', () => {
  loadProjectFromBinaryPayload(project('a'));
  const folder = createMindmapNode('a', 'folder', '业务模块', null);
  const map = createMindmapNode('a', 'mindmap', '采购规划', folder);
  const other = createMindmapNode('a', 'mindmap', '仓储规划', folder);
  const source = 'mindmap\n  root((未完成';
  useProtoStore.getState().setMindmapSource('a', map, source);
  setPageMindmapLinks('a', { kind: 'page', pageId: 'page-home' }, [map, other]);
  setPageMindmapLinks('a', { kind: 'folder', folderId: 'folder-project-pages' }, [folder]);
  const saved = captureProjectPayload();
  loadProjectFromBinaryPayload(project('b'));
  assert.deepEqual(useProtoStore.getState().mindmaps, { nodes: [], links: [] });
  assert.throws(() => useProtoStore.getState().setMindmapSource('a', map, 'wrong'), /项目已变化/);
  assert.throws(() => openMindmapNode('b', map), /不存在/);
  loadProjectFromBinaryPayload(decodePflowBinary(encodePflowBinary(saved)));
  assert.deepEqual(captureProjectPayload().stateSnapshot, saved.stateSnapshot);
  const files = generateUnpackedGitFiles(saved);
  assert.equal(files.find(file => file.relativePath === `mindmaps/${map}.mmd`)?.content, source);
  assert.deepEqual(JSON.parse(files.find(file => file.relativePath === 'mindmaps/index.json')!.content), saved.stateSnapshot.mindmaps);
});

test('V5 stays empty; V6 migrates exact unfinished source to a default document without altering its input', () => {
  const old: any = project('legacy'); delete old.stateSnapshot.mindmaps; old.schemaVersion = 5;
  const upgraded = normalizeProjectPayload(old);
  assert.equal(upgraded.schemaVersion, 7); assert.deepEqual(upgraded.stateSnapshot.mindmaps.nodes, []);
  for (const source of ['', '  ', 'mindmap\n  root((未完成']) {
    old.schemaVersion = 6; old.stateSnapshot.mindmapSource = source;
    const copy = structuredClone(old), data = normalizeProjectPayload(old).stateSnapshot.mindmaps;
    assert.equal(data.nodes.length, source === '' ? 0 : 1);
    if (source !== '') assert.equal(data.nodes[0].source, source);
    assert.deepEqual(old, copy);
  }
  old.stateSnapshot.mindmapSource = null;
  assert.throws(() => normalizeProjectPayload(old), /mindmapSource/);
});

test('moves preserve identities and links; cyclic parents, invalid sources, duplicate names and dangling references fail atomically', () => {
  loadProjectFromBinaryPayload(project('a'));
  const a = createMindmapNode('a', 'folder', '模块一', null), b = createMindmapNode('a', 'folder', '模块二', a);
  const map = createMindmapNode('a', 'mindmap', '细节', b);
  setPageMindmapLinks('a', { kind: 'page', pageId: 'page-home' }, [map]);
  const before = captureProjectPayload();
  assert.throws(() => editMindmapNode('a', a, '模块一', b), /循环/);
  assert.throws(() => editMindmapNode('a', b, '模块二', map), /不是目录/);
  assert.throws(() => createMindmapNode('a', 'mindmap', '细节', b), /同名/);
  assert.throws(() => setPageMindmapLinks('a', { kind: 'page', pageId: 'node-page-home' }, [map]), /页面 ID/);
  assert.throws(() => setPageMindmapLinks('a', { kind: 'folder', folderId: 'page-home' }, [map]), /目录 ID/);
  assert.throws(() => setPageMindmapLinks('a', { kind: 'page', pageId: 'page-home' }, ['wrong']), /目标不存在/);
  assert.throws(() => useProtoStore.getState().setMindmapSource('a', a, ''), /菜单不存在/);
  assert.deepEqual(captureProjectPayload().stateSnapshot, before.stateSnapshot);
  for (const mutate of [(p: any) => p.stateSnapshot.mindmaps.nodes[2].source = 42, (p: any) => p.stateSnapshot.mindmaps.nodes[0].source = '', (p: any) => p.stateSnapshot.mindmaps.links[0].targetNodeId = 'missing']) {
    const invalid = structuredClone(before); mutate(invalid);
    assert.throws(() => loadProjectFromBinaryPayload(invalid));
    assert.deepEqual(captureProjectPayload().stateSnapshot, before.stateSnapshot);
  }
  editMindmapNode('a', map, '新名称', null);
  assert.equal(mindmapPath(useProtoStore.getState().mindmaps, map), '新名称');
  assert.deepEqual(useProtoStore.getState().mindmaps.links, before.stateSnapshot.mindmaps.links);
  useProtoStore.setState({ isProjectClosed: true });
  assert.throws(() => createMindmapNode('a', 'folder', '关闭后', null), /项目已变化/);
});

test('folder links expand actual page descendants and are inherited by contained maps', () => {
  loadProjectFromBinaryPayload(project('a'));
  const folder = createMindmapNode('a', 'folder', '业务模块', null), child = createMindmapNode('a', 'folder', '采购', folder);
  const map = createMindmapNode('a', 'mindmap', '全流程', child);
  const unrelated = createMindmapNode('a', 'mindmap', '其他模块', null);
  const pageFolder = usePageStore.getState().createDesignerFolder('详情', 'folder-project-pages');
  usePageStore.getState().createDesignerPage({ pageId: 'detail', title: '详情页', folderId: pageFolder.id }, 'export default function Page(){return <Page pfId="root"/>}');
  setPageMindmapLinks('a', { kind: 'folder', folderId: 'folder-project-pages' }, [folder]);
  setPageMindmapLinks('a', { kind: 'page', pageId: 'page-home' }, [map]);
  const context = () => mindmapContext(useProtoStore.getState().mindmaps, map, usePageStore.getState());
  assert.deepEqual(new Set(context().relatedPageIds), new Set(['page-home', 'detail']));
  assert.equal(context().links.length, 2);
  assert.deepEqual(mindmapContext(useProtoStore.getState().mindmaps, unrelated, usePageStore.getState()).relatedPageIds, []);
  editMindmapNode('a', map, '全流程', null);
  assert.deepEqual(context().relatedPageIds, ['page-home']);
});

test('page deletion removes only affected associations and undo restores them; map deletion preserves actual pages', () => {
  loadProjectFromBinaryPayload(project('a'));
  const folder = createMindmapNode('a', 'folder', '业务模块', null), map = createMindmapNode('a', 'mindmap', '规划', folder);
  setPageMindmapLinks('a', { kind: 'folder', folderId: 'folder-project-pages' }, [folder]);
  setPageMindmapLinks('a', { kind: 'page', pageId: 'page-home' }, [map]);
  const saved = captureProjectPayload();
  const undo = deleteMenu(prepareMenuDeletion(saved, 'folder-project-pages'));
  assert.deepEqual(useProtoStore.getState().mindmaps.nodes, saved.stateSnapshot.mindmaps.nodes);
  assert.deepEqual(useProtoStore.getState().mindmaps.links, []);
  undo.undo();
  assert.deepEqual(useProtoStore.getState().mindmaps, saved.stateSnapshot.mindmaps);
  deleteMindmapNode('a', folder);
  assert.deepEqual(useProtoStore.getState().mindmaps, { nodes: [], links: [] });
  assert.deepEqual(usePageStore.getState().pageSources, saved.stateSnapshot.pageSources);
  assert.equal(useProtoStore.getState().selectedMindmapNodeId, null);
});
