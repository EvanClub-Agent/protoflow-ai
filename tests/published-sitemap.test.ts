import { installTestDom } from './dom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createPublishDemo } from './publish-demo';
import { buildSitemap } from '../src/proto/sitemap';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useProtoStore } from '../src/store/useProtoStore';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { normalizePublishedSnapshot } from '../src/services/publishedSnapshot';
import { publishedMenuIndex } from '../src/services/publishedSitemap';
import { LanguageSwitch } from '../src/components/LanguageSwitch';
import { hydrateLocale, resetLocaleCache } from '../src/i18n/runtime';
import { hydratePublishedSnapshot, PublishedViewer } from '../src/viewer/PublishedViewer';
import { PublishedSitemap } from '../src/viewer/PublishedSitemap';

test('publishing preserves the full designer tree including docs, moved folders, empty menus and archived placeholders', () => {
  createPublishDemo();
  const state = usePageStore.getState();
  const root = state.createDesignerFolder('组织目录', null);
  const child = state.createDesignerFolder('待配置模块', root.id);
  state.moveSitemapItem({ kind: 'folder', id: 'folder-base-data' }, root.id, useProtoStore.getState().currentProjectMeta.projectId);
  const snapshot = createPublishedSnapshot('page-home');
  const current = usePageStore.getState();
  const tree = buildSitemap(current.designerFolders, current.designerPages, current.sitemapOverrides, current.sitemapBase);
  const structure = (items: any[]): any[] => items.map(item => ({ id: item.id, type: item.type, title: item.title, ...(item.type === 'folder' ? { children: structure(item.children) } : {}) }));
  assert.deepEqual(structure(snapshot.sitemap), structure(tree));
  const index = publishedMenuIndex(snapshot.sitemap);
  assert.equal(index.get('doc-overview')!.item.type, 'doc');
  assert.equal(index.get('doc-changelog')!.item.title, '设计变更记录');
  assert.deepEqual(index.get('page-home')!.ancestors, [root.id, 'folder-base-data']);
  const parent = snapshot.sitemap.find(item => item.id === root.id)!;
  assert.ok(parent.type === 'folder' && parent.children.some(item => item.id === child.id && item.type === 'folder' && item.children.length === 0));
  assert.ok(index.has('material-catalog'));
  assert.ok(!snapshot.pages.some(page => page.pageId === 'material-catalog'));
  const archived = snapshot.sitemap.find(item => item.id === 'folder-deprecated')!;
  assert.ok(archived.type === 'folder' && archived.children.every(item => item.type === 'page' && item.pageId === null));
});

test('missing, duplicate, cyclic, wrong-parent and incomplete published menu contracts fail before hydration', () => {
  const snapshot = createPublishDemo();
  const before = usePageStore.getState();
  const folder = snapshot.sitemap.find(item => item.id === 'folder-base-data')!;
  assert.equal(folder.type, 'folder');
  const invalid: any[] = [undefined, null, [], [...snapshot.sitemap, snapshot.sitemap[0]]];
  const wrongParent: any = structuredClone(snapshot.sitemap);
  wrongParent.find((item: any) => item.id === 'folder-base-data').id = 'incorrect-parent';
  invalid.push(wrongParent);
  const badLeaf: any = structuredClone(snapshot.sitemap); delete badLeaf[0].pageId; invalid.push(badLeaf);
  const cyclic: any = { id: 'cycle', title: 'cycle', type: 'folder', deprecated: false, children: [] }; cyclic.children.push(cyclic); invalid.push([cyclic]);
  for (const sitemap of invalid) {
    assert.throws(() => hydratePublishedSnapshot({ ...snapshot, sitemap }));
    assert.equal(usePageStore.getState(), before);
  }
  const duplicateRoute: any = structuredClone(snapshot.sitemap); duplicateRoute[0].pageId = 'doc-changelog';
  assert.throws(() => normalizePublishedSnapshot({ ...snapshot, sitemap: duplicateRoute }), /重复/);
});

test('old shares remain flat and do not invent unuploaded document titles or hierarchy', () => {
  const legacy: any = createPublishDemo(); legacy.formatVersion = 2; delete legacy.sitemap;
  const normalized = normalizePublishedSnapshot(legacy);
  assert.equal(normalized.formatVersion, 2); assert.equal('sitemap' in normalized, false);
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(PublishedSitemap, { snapshot: normalized, activeId: 'page-home', expanded: {}, onSelect() {}, onToggle() {} })); });
  try {
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('此分享未包含目录结构'));
    assert.ok(!JSON.stringify(renderer!.toJSON()).includes('设计变更记录'));
  } finally { act(() => renderer!.unmount()); }
  legacy.sitemap = [];
  assert.throws(() => normalizePublishedSnapshot(legacy), /旧版/);
});

test('viewer document deep links, folder collapse, page navigation and browser back retain exact menu routes', async () => {
  const restoreDom = installTestDom();
  const snapshot = createPublishDemo();
  const originalWindow = globalThis.window, originalDocument = globalThis.document, originalFetch = globalThis.fetch;
  const id = 'PUBLICATIONMENUTEST0123456789';
  const listeners = new Map<string, () => void>();
  const location = { pathname: `/p/${id}`, hash: '#doc-changelog' };
  globalThis.window = { document: globalThis.document, matchMedia: originalWindow.matchMedia, setTimeout: originalWindow.setTimeout, clearTimeout: originalWindow.clearTimeout, location, history: { replaceState(_a: unknown, _b: unknown, hash: string) { location.hash = hash; } }, addEventListener(name: string, handler: () => void) { listeners.set(name, handler); }, removeEventListener(name: string) { listeners.delete(name); } } as any;
  globalThis.document.title = '';
  const publication = { id, projectId: snapshot.projectId, title: snapshot.title, version: 1, passwordProtected: false };
  globalThis.fetch = (async (url: string) => ({ ok: true, json: async () => url.endsWith('/open') ? { publication, snapshot } : publication })) as any;
  let renderer: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(PublishedViewer)); });
    const canvasClass = renderer!.root.findByProps({ 'data-testid': 'published-canvas' }).props.className;
    assert.match(canvasClass, /w-full/);
    assert.doesNotMatch(canvasClass, /max-w-/);
    assert.equal(useProtoStore.getState().activePageId, 'doc-changelog');
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('尚未保存独立正文'));
    const folderButton = () => renderer!.root.findAllByType('button').find(button => button.props.title === '基础资料管理')!;
    act(() => folderButton().props.onClick());
    assert.equal(folderButton().props['aria-expanded'], false);
    act(() => renderer!.root.findAllByType('button').find(button => button.props.title === '系统总体要求')!.props.onClick());
    assert.equal(useProtoStore.getState().activePageId, 'doc-overview');
    assert.equal(location.hash, '#doc-overview');
    assert.equal(folderButton().props['aria-expanded'], false);
    // Runtime navigation to a page expands its ancestors, including collapsed folders.
    act(() => useProtoStore.getState().setActivePage('page-home'));
    assert.equal(folderButton().props['aria-expanded'], true);
    act(() => { location.hash = '#doc-changelog'; listeners.get('hashchange')!(); });
    assert.equal(useProtoStore.getState().activePageId, 'doc-changelog');
    assert.ok(renderer!.root.findAllByType('button').some(button => button.props.title === '设计变更记录' && button.props['aria-current'] === 'page'));
  } finally {
    act(() => renderer?.unmount()); globalThis.window = originalWindow; globalThis.document = originalDocument; globalThis.fetch = originalFetch; restoreDom();
  }
});

test('static demo mode loads manifest and zh/en snapshots without calling /api/v1/view/', async () => {
  const restoreDom = installTestDom();
  const zhSnapshot = createPublishDemo();
  const enSnapshot = structuredClone(zhSnapshot);
  enSnapshot.title = 'Interactive Prototype English Demo';
  const originalWindow = globalThis.window, originalDocument = globalThis.document, originalFetch = globalThis.fetch;
  const meta = globalThis.document.createElement('meta');
  meta.setAttribute('name', 'protoflow-static-demo');
  meta.setAttribute('content', './demo-manifest.json');
  globalThis.document.head.appendChild(meta);
  const location = { origin: 'https://alex.xclubai.com', pathname: '/demo/', href: 'https://alex.xclubai.com/demo/', hash: '' };
  globalThis.window = {
    document: globalThis.document,
    matchMedia: originalWindow.matchMedia,
    setTimeout: originalWindow.setTimeout,
    clearTimeout: originalWindow.clearTimeout,
    location,
    history: { replaceState(_a: unknown, _b: unknown, hash: string) { location.hash = hash; } },
    addEventListener() {},
    removeEventListener() {},
  } as any;
  hydrateLocale('zh-CN');
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requestedUrls.push(String(url));
    assert.ok(!String(url).includes('/api/v1/view/'), `Unexpected view API request: ${url}`);
    if (String(url).endsWith('demo-manifest.json')) {
      return { ok: true, json: async () => ({ version: 1, snapshots: { zh: './snapshots/crm-zh.json', en: './snapshots/crm-en.json' } }) };
    }
    if (String(url).includes('crm-en.json')) {
      return { ok: true, json: async () => enSnapshot };
    }
    return { ok: true, json: async () => zhSnapshot };
  }) as any;
  let renderer: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(PublishedViewer)); });
    assert.ok(requestedUrls.some(u => u.includes('demo-manifest.json')));
    assert.ok(requestedUrls.some(u => u.includes('crm-zh.json')));
    assert.match(globalThis.document.title, /ProtoFlow AI/);
    const langBtn = renderer!.root.findByType(LanguageSwitch).findByType('button');
    await act(async () => { langBtn.props.onClick(); });
    assert.ok(requestedUrls.some(u => u.includes('crm-en.json')));
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('Interactive Prototype English Demo'));
  } finally {
    act(() => renderer?.unmount());
    meta.remove();
    hydrateLocale('zh-CN');
    resetLocaleCache();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    restoreDom();
  }
});
