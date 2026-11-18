import { publishingBridgeFixture } from './publishingBridgeFixture';
import { projectWithHome } from './fixtures/projectWithHome';
import { installTestDom } from './dom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { captureProjectPayload, createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { validateProjectPayload } from '../src/services/projectValidation';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { normalizePublishedSnapshot, validatePublishedSnapshot } from '../src/services/publishedSnapshot';
import { hydratePublishedSnapshot, PublishedPageView } from '../src/viewer/PublishedViewer';
import { PublishedNotesButton, PublishedNotesProvider } from '../src/viewer/PublishedNotes';
import { createPublishDemo } from './publish-demo';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { publishingOrigin, savePublication, authenticatePublishing, publishingSettings, logoutPublishing } from '../src/services/publishingClient';
import { OnlinePublishModal } from '../src/components/OnlinePublishModal';
import { newId } from '../src/utils/identity';
const { PublishingClient, origin } = require(path.join(process.cwd(), 'electron/publishing.cjs'));
const { serviceOrigin } = require(path.join(process.cwd(), 'electron/service-origin.json'));

function project(templateId: 'blank_project' | 'customs_erp' = 'blank_project') {
  const makeProject = templateId === 'blank_project' ? projectWithHome : createProjectPayload;
  loadProjectFromBinaryPayload(makeProject({ projectId: 'publish-test', projectName: '我的真实画布', templateId, storageDir: '/private/LOCAL-ONLY-PATH', fileName: 'local.pflow', createdAt: '2026-10-30', updatedAt: '2026-10-30', pageCount: 0, tableCount: 0, stickyCount: 0 }));
}
test('modeling decisions stay in the project while an AI table publishes through the existing V3 wire contract', () => {
  project('customs_erp');
  const [table, ...others] = useProtoStore.getState().dbTables;
  const modeling = {entity:'供应商',grain:'每行一个供应商',reason:'供方准入和采购登记共享主数据'};
  useProtoStore.setState({dbTables:[{...table,modeling,columns:table.columns.map(c => c.isPrimaryKey ? {...c,isUnique:true} : c)},...others]});
  const shared = createPublishedSnapshot('acceptance-new').tables[0];
  assert.deepEqual(Object.keys(shared).sort(), ['cnName','columns','description','domain','id','sharedByMenus','tableName']);
  assert.deepEqual(shared.columns, table.columns);
  assert.equal(useProtoStore.getState().dbTables[0].modeling,modeling);
});
test('publishing captures user-created pages and exact demo rows, without local archive or AI metadata', () => {
  project();
  usePageStore.getState().setPageSource('page-home', 'export default function Page(){return <Page pfId="root" title="自定义设计"><Text pfId="text" text="真实内容"/></Page>;}');
  const snapshot = createPublishedSnapshot('page-home');
  assert.equal(snapshot.pages[0].doc.root.props.title, '自定义设计');
  assert.equal(snapshot.pages[0].pageId, 'page-home');
  assert.equal(snapshot.projectId, 'publish-test');
  assert.ok(!JSON.stringify(snapshot).includes('LOCAL-ONLY-PATH'));
  assert.equal('meta' in snapshot, false);
  assert.equal('pageSources' in snapshot, false);
  usePageStore.getState().setPageSource('page-home', 'changed locally');
  assert.equal(snapshot.pages[0].doc.root.props.title, '自定义设计');
});
test('the complete built-in canvas publishes all pages and materializes exactly its local data', () => {
  project('customs_erp');
  const expected = structuredClone(usePageStore.getState().getRows('t_pms_po_item'));
  const snapshot = createPublishedSnapshot('acceptance-new');
  assert.equal(snapshot.pages.length, Object.keys(usePageStore.getState().pageSources).length);
  assert.ok(snapshot.pages.length > 1);
  assert.deepEqual(snapshot.tableRows.t_pms_po_item, expected);
  for (const table of snapshot.tables) assert.ok(Array.isArray(snapshot.tableRows[table.id]));
});
test('published data validation rejects missing identities, unsupported code and unpublished navigation before hydration', () => {
  project(); const snapshot = createPublishedSnapshot('page-home');
  const previous = usePageStore.getState().tableRows;
  const invalid = structuredClone(snapshot); invalid.entryPageId = 'missing';
  assert.throws(() => hydratePublishedSnapshot(invalid), /入口页面/);
  assert.equal(usePageStore.getState().tableRows, previous);
  invalid.entryPageId = 'page-home'; invalid.pages[0].doc.root.props.title = { $kind: 'raw', code: 'fetch("https://evil.test")' };
  assert.throws(() => validatePublishedSnapshot(invalid), /代码表达式/);
  invalid.pages[0].doc.root.props.title = 'title'; invalid.pages[0].doc.root.props.onClick = { $kind: 'actions', calls: [{ name: 'navigate', args: ['not-published'] }] };
  assert.throws(() => validatePublishedSnapshot(invalid), /未发布/);
  assert.throws(() => createPublishedSnapshot('missing'), /入口页面/);
});
test('viewer data is isolated from the stored snapshot and reset restores it', () => {
  project('customs_erp'); const snapshot = createPublishedSnapshot('acceptance-new');
  hydratePublishedSnapshot(snapshot);
  const id = snapshot.tableRows.t_pms_po_item[0].id;
  usePageStore.getState().updateRow('t_pms_po_item', id, { ordered_qty: 999 });
  assert.notEqual(snapshot.tableRows.t_pms_po_item[0].ordered_qty, 999);
  hydratePublishedSnapshot(snapshot);
  assert.deepEqual(usePageStore.getState().tableRows, snapshot.tableRows);
  assert.deepEqual(useProtoStore.getState().stickyNotes, []);
  assert.deepEqual(usePageStore.getState().pageSources, {});
});
test('LAN HTTP viewers can insert rows with unique UUID v4 identities without randomUUID', () => {
  project('customs_erp');
  hydratePublishedSnapshot(createPublishedSnapshot('acceptance-new'));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
  try {
    const ids = Array.from({ length: 100 }, () => newId('row'));
    assert.equal(new Set(ids).size, 100);
    for (const id of ids) assert.match(id, /^row-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const before = usePageStore.getState().getRows('t_pms_po_item').length;
    usePageStore.getState().insertRow('t_pms_po_item', { ordered_qty: 5 });
    assert.equal(usePageStore.getState().getRows('t_pms_po_item').length, before + 1);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});
test('publishing never substitutes an existing publication from another project', async () => {
  project(); const snapshot = createPublishedSnapshot('page-home');
  await assert.rejects(savePublication({ snapshot, access: { passwordAction: 'remove', password: '', expiresAt: null } }, { projectId: 'other-project' } as any), /不属于当前项目/);
});
test('publication preserves exact note identities and states without publishing internal compiled rules', () => {
  createPublishDemo();
  const notes = useProtoStore.getState().stickyNotes;
  useProtoStore.setState({ stickyNotes: [
    { ...notes[0], active: false, compiledRule: 'PRIVATE_INTERNAL_RULE' },
    notes[1],
    { ...notes[0], id: 'document-only', pageId: 'doc-overview', text: 'DOCUMENT_ONLY' },
  ] });
  const snapshot = createPublishedSnapshot('page-home');
  assert.equal(snapshot.stickyNotes.length, 2);
  assert.equal(snapshot.stickyNotes[0].id, notes[0].id);
  assert.equal(snapshot.stickyNotes[0].targetWidgetId, 'review-table');
  assert.equal(snapshot.stickyNotes[0].active, false);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_INTERNAL_RULE'));
  assert.ok(!JSON.stringify(snapshot).includes('DOCUMENT_ONLY'));
  useProtoStore.getState().updateStickyRuleText(notes[0].id, 'Changed after publication');
  assert.equal(snapshot.stickyNotes[0].text, notes[0].text);
});
test('V1 shares migrate explicitly while V2 rejects missing notes and invalid note identities', () => {
  const snapshot = createPublishDemo();
  const legacy: any = structuredClone(snapshot); legacy.formatVersion = 1; delete legacy.stickyNotes; delete legacy.sitemap;
  assert.deepEqual(normalizePublishedSnapshot(legacy).stickyNotes, []);
  assert.equal(legacy.formatVersion, 1);
  const missing: any = structuredClone(snapshot); delete missing.stickyNotes;
  const before = usePageStore.getState().tableRows;
  assert.throws(() => hydratePublishedSnapshot(missing), /便签/);
  assert.equal(usePageStore.getState().tableRows, before);
  for (const patch of [{ id: '' }, { pageId: 'unknown' }, { targetWidgetId: '' }, { active: undefined }, { index: 0 }]) {
    const invalid = structuredClone(snapshot); Object.assign(invalid.stickyNotes[0], patch);
    assert.throws(() => validatePublishedSnapshot(invalid), /便签/);
  }
  const duplicate = structuredClone(snapshot); duplicate.stickyNotes.push(duplicate.stickyNotes[0]);
  assert.throws(() => validatePublishedSnapshot(duplicate), /重复/);
});
test('opening an old project assigns zero-numbered stickies free numbers on their own page before publishing', () => {
  createPublishDemo();
  const archive = captureProjectPayload();
  archive.stateSnapshot.activePageId = 'page-home';
  const [table, form] = archive.stateSnapshot.stickyNotes;
  const oldNotes = [
    { ...table, index: 0, active: false },
    { ...table, id: 'other-page', pageId: 'share-overview', targetWidgetId: 'overview-root', index: 0 },
    { ...table, id: 'second-zero', index: 0 },
    { ...form, index: 1 },
  ];
  archive.stateSnapshot.stickyNotes = oldNotes;
  assert.throws(() => validateProjectPayload(archive), /demo-note-table.*index/);
  loadProjectFromBinaryPayload(archive);
  const expected = oldNotes.map((note, i) => ({ ...note, index: [2, 1, 3, 1][i] }));
  assert.deepEqual(captureProjectPayload().stateSnapshot.stickyNotes, expected);
  const published = createPublishedSnapshot('page-home');
  assert.deepEqual(published.stickyNotes, expected.map(({ compiledRule, ...note }) => note));
  assert.deepEqual(oldNotes.map(note => note.index), [0, 0, 0, 1]);
  loadProjectFromBinaryPayload(captureProjectPayload());
  assert.deepEqual(createPublishedSnapshot('page-home').stickyNotes, published.stickyNotes);
  for (const index of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0', undefined]) {
    const invalid = structuredClone(archive);
    Object.assign(invalid.stateSnapshot.stickyNotes[0], { index });
    assert.throws(() => loadProjectFromBinaryPayload(invalid), /demo-note-table.*index/);
  }
});
test('publish errors identify the page, sticky and invalid field', () => {
  const snapshot = createPublishDemo();
  for (const [field, value] of Object.entries({ targetWidgetName: null, active: 'false', index: 0 })) {
    const invalid = structuredClone(snapshot);
    Object.assign(invalid.stickyNotes[0], { [field]: value });
    assert.throws(() => validatePublishedSnapshot(invalid), new RegExp(`page-home.*demo-note-table.*${field}`));
  }
});
test('viewer pins cover page, region and overlay notes and isolate identical component IDs by page', async () => {
  const restoreDom = installTestDom();
  const snapshot = createPublishDemo();
  snapshot.stickyNotes.push(
    { ...snapshot.stickyNotes[0], id: 'page-note', targetWidgetId: 'root', targetWidgetName: '页面整体', text: '整页说明' },
    { ...snapshot.stickyNotes[0], id: 'other-page-note', pageId: 'share-overview', text: 'OTHER_PAGE_ONLY' },
    { ...snapshot.stickyNotes[0], id: 'orphan-note', targetWidgetId: 'removed-region', text: '已删除区域的原始说明' },
  );
  hydratePublishedSnapshot(snapshot);
  const originalNotes = structuredClone(snapshot.stickyNotes);
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(PublishedNotesProvider, { page: snapshot.pages[0], notes: snapshot.stickyNotes }, React.createElement(PublishedNotesButton), React.createElement(PublishedPageView, { page: snapshot.pages[0] }))); });
  try {
    assert.ok(renderer!.root.findByProps({ 'aria-label': '查看页面整体便签（1 条）' }));
    act(() => renderer!.root.findByProps({ 'aria-label': '查看当前评审需求表格便签（1 条）' }).props.onClick({ stopPropagation() {} }));
    let dialog = renderer!.root.findByType('dialog');
    assert.ok(JSON.stringify(dialog.findAllByType('p').map(node => node.children)).includes('展示本次评审的全部需求'));
    assert.ok(!JSON.stringify(dialog.findAllByType('p').map(node => node.children)).includes('OTHER_PAGE_ONLY'));
    assert.equal(dialog.findAllByType('input').length, 0);
    assert.equal(dialog.findAllByType('textarea').length, 0);
    act(() => renderer!.root.findByProps({ 'aria-label': '关闭便签' }).props.onClick());
    const open = renderer!.root.findAllByType('button').find(node => node.findAll(child => child.type === 'span' && child.children.includes('新增评审需求')).length > 0)!;
    await act(async () => { await open.props.onClick({ preventDefault() {}, stopPropagation() {} }); });
    assert.ok(renderer!.root.findByProps({ 'aria-label': '查看新增需求表单便签（1 条）' }));
    act(() => renderer!.root.findByProps({ 'aria-label': '查看本页便签（4 条）' }).props.onClick());
    dialog = renderer!.root.findByType('dialog');
    assert.ok(JSON.stringify(dialog.findAllByType('p').map(node => node.children)).includes('原区域已不在当前发布页面中'));
    assert.deepEqual(snapshot.stickyNotes, originalNotes);
  } finally { act(() => renderer!.unmount()); restoreDom(); }
});
test('publishing connection origins allow explicit LAN deployment and reject credential URLs and public HTTP', () => {
  for (const check of [origin, publishingOrigin]) {
    assert.equal(check('http://192.168.1.104:8088'), 'http://192.168.1.104:8088');
    assert.equal(check('https://preview.example.com/'), 'https://preview.example.com');
    for (const bad of ['http://public.example.com','https://user:pass@example.com','https://example.com/api','file:///tmp/viewer','http://192.168.evil.example']) assert.throws(() => check(bad));
  }
});
const testPublishOrigin = serviceOrigin || 'http://127.0.0.1:8088';
const accountUser = { id: 'account-user-A', username: 'publisher', displayName: '发布用户' };
const accountSettings = { url: testPublishOrigin, configured: true, user: accountUser, legacy: null };

test('browser publishing connects to a self-hosted service URL, validates HTTPS/LAN origin, and keeps tokens out of settings', async () => {
  const previousDesktop = (window as any).protoflowDesktop, previousFetch = globalThis.fetch;
  const calls: any[] = [];
  (window as any).protoflowDesktop = undefined;
  try { localStorage.removeItem('protoflow_publishing_server_url'); } catch {}
  globalThis.fetch = (async (url: string, options: any) => { calls.push({ url, options }); return { ok: true, json: async () => ({ user: accountUser, token: 'pfu_browserTestToken' }) }; }) as any;
  try {
    assert.equal((await publishingSettings()).configured, false);
    if (!serviceOrigin) {
      await assert.rejects(authenticatePublishing({ mode: 'login', username: 'user', password: 'test-password' }), /填写自建发布服务地址/);
    }
    await assert.rejects(authenticatePublishing({ url: 'http://insecure-public.example.com', mode: 'login', username: 'user', password: 'test-password' }), /HTTPS/);
    assert.equal(calls.length, 0);
    await authenticatePublishing({ url: testPublishOrigin, mode: 'login', username: 'publisher', password: 'test-password' });
    assert.equal(calls[0].url, testPublishOrigin + '/api/v1/auth/login');
    assert.equal(calls[0].options.redirect, 'error');
    assert.deepEqual(await publishingSettings(), accountSettings);
    assert.doesNotMatch(JSON.stringify(await publishingSettings()), /pfu_|test-password/);
    await logoutPublishing();
    assert.equal((await publishingSettings()).configured, false);
  } finally {
    try { localStorage.removeItem('protoflow_publishing_server_url'); } catch {}
    (window as any).protoflowDesktop = previousDesktop;
    globalThis.fetch = previousFetch;
  }
});

test('publish dialog accepts a self-hosted server URL and registers or logs in cleanly', async () => {
  project();
  const previousDesktop = (window as any).protoflowDesktop, submitted: any[] = [];
  let authenticated = false;
  (window as any).protoflowDesktop = { publishing: publishingBridgeFixture({
    settings: async () => authenticated ? accountSettings : ({ url: '', configured: false, user: null, legacy: null }),
    authenticate: async (input: any) => { submitted.push(input); authenticated = true; return accountSettings; },
    logout: async () => ({ url: testPublishOrigin, configured: false, user: null, legacy: null }),
    request: async () => ({ items: [] }),
  }) };
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(OnlinePublishModal, { onClose() {}, onOffline() {} })); });
    assert.equal(renderer.root.findAllByProps({ type: 'url' }).length, 1);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': '发布凭证' }).length, 0);
    assert.equal(renderer.root.findByProps({ id: 'publishing-password' }).props.autoComplete, 'current-password');
    act(() => renderer.root.findAllByType('button').find(b => b.children.includes('没有账号？注册'))!.props.onClick());
    assert.equal(renderer.root.findByProps({ id: 'publishing-password' }).props.autoComplete, 'new-password');
    act(() => {
      renderer.root.findByProps({ id: 'publishing-server-url' }).props.onChange({ target: { value: testPublishOrigin } });
      renderer.root.findByProps({ id: 'publishing-username' }).props.onChange({ target: { value: 'publisher' } });
      renderer.root.findByProps({ id: 'publishing-password' }).props.onChange({ target: { value: 'account-password' } });
    });
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.deepEqual(submitted, [{ mode: 'register', url: testPublishOrigin, username: 'publisher', password: 'account-password' }]);
    assert.match(JSON.stringify(renderer.toJSON()), /已登录/);
    await act(async () => renderer.root.findAllByType('button').find(b => b.children.includes('退出登录'))!.props.onClick());
    assert.equal(renderer.root.findByProps({ id: 'publishing-password' }).props.value, '');
    assert.equal(renderer.root.findAllByType('button').find(b => b.children.includes('发布并生成链接'))!.props.disabled, true);
  } finally { if (renderer) act(() => renderer.unmount()); (window as any).protoflowDesktop = previousDesktop; }
});

async function publishingDialog(t: any, onRequest?: (input: any) => unknown) {
  const previousDesktop = (window as any).protoflowDesktop;
  const requests: any[] = []; let closed = false;
  (window as any).protoflowDesktop = { publishing: publishingBridgeFixture({
    settings: async () => accountSettings,
    request: async (input: any) => { requests.push(input); return onRequest ? onRequest(input) : { items: [] }; },
  }) };
  let renderer!: TestRenderer.ReactTestRenderer;
  t.after(() => { if (renderer) act(() => renderer.unmount()); (window as any).protoflowDesktop = previousDesktop; });
  await act(async () => { renderer = TestRenderer.create(React.createElement(OnlinePublishModal, { onClose() { closed = true; }, onOffline() {} })); });
  const publish = () => renderer.root.findAllByType('button').find(button => button.children.includes('发布并生成链接'))!;
  return { renderer, requests, publish, closed: () => closed };
}

test('a project with real pages can publish its first link with an empty publication history', async t => {
  project();
  const id = 'FIRSTPUBLICATION123456789';
  const f = await publishingDialog(t, input => {
    if (input.action === 'list') return { items: [] };
    assert.equal(input.action, 'create');
    assert.equal(input.input.snapshot.entryPageId, 'page-home');
    assert.equal(input.input.snapshot.projectId, 'publish-test');
    return { id, projectId: 'publish-test', title: '首次发布', version: 1, passwordProtected: false,
      expiresAt: null, revokedAt: null, createdAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:00:00.000Z', shareUrl: `${testPublishOrigin}/p/${id}` };
  });
  assert.equal(f.publish().props.disabled, false);
  await act(async () => { f.publish().props.onClick(); });
  assert.deepEqual(f.requests.map(input => input.action), ['list', 'create']);
  assert.match(JSON.stringify(f.renderer.toJSON()), /发布成功/);
});

test('a blank publish dialog explains why publishing is blocked and reacts to the first real page without reopening', async t => {
  loadProjectFromBinaryPayload(createProjectPayload({ projectId: 'blank-share', projectName: '新建工程', templateId: 'blank_project', storageDir: '/tmp', fileName: 'blank-share.pflow', createdAt: '2026-11-13', updatedAt: '2026-11-13', pageCount: 0, tableCount: 0, stickyCount: 0 }));
  const f = await publishingDialog(t);
  assert.equal(f.publish().props.disabled, true);
  assert.equal(f.publish().props.title, '请先创建或生成画布页面');
  assert.match(JSON.stringify(f.renderer.toJSON()), /还没有可发布的画布页面/);
  assert.equal(f.renderer.root.findAllByProps({ 'aria-label': '分享入口页面' }).length, 0);
  let folderId!: string;
  act(() => { folderId = usePageStore.getState().createDesignerFolder('真实目录', null).id; });
  // A menu/plan alone must not become a fake publishable page.
  act(() => { usePageStore.setState({ designerPages: [{ pageId: 'first-authored-page', title: '首个页面', folderId }] }); });
  assert.equal(f.publish().props.disabled, true);
  act(() => { usePageStore.getState().setPageSource('first-authored-page', 'export default function Page(){return <Page pfId="root" title="首个页面"/>;}'); });
  assert.equal(f.publish().props.disabled, false);
  assert.equal(f.renderer.root.findByProps({ 'aria-label': '分享入口页面' }).props.value, 'first-authored-page');
  assert.doesNotMatch(JSON.stringify(f.renderer.toJSON()), /还没有可发布的画布页面/);
});

test('publication directory failures stay visible instead of masquerading as an empty project, and recover after repair', async t => {
  project();
  usePageStore.setState(state => ({ pageSources: { ...state.pageSources, 'unlisted-page': 'export default function Page(){return <Page pfId="root"/>;}' } }));
  const f = await publishingDialog(t);
  assert.equal(f.publish().props.disabled, true);
  assert.match(JSON.stringify(f.renderer.toJSON()), /unlisted-page.*缺少目录信息/);
  assert.doesNotMatch(JSON.stringify(f.renderer.toJSON()), /还没有可发布的画布页面|含 0 个画布/);
  act(() => { usePageStore.setState(state => ({ designerPages: [...state.designerPages, { pageId: 'unlisted-page', title: '修复的页面', folderId: state.designerPages[0].folderId }] })); });
  assert.equal(f.publish().props.disabled, false);
  assert.doesNotMatch(JSON.stringify(f.renderer.toJSON()), /无法读取项目页面/);
});

test('removing an explicitly selected entry requires a fresh choice and empty state actions navigate to the designer', async t => {
  project();
  const folderId = usePageStore.getState().designerPages[0].folderId;
  usePageStore.getState().createDesignerPage({ pageId: 'second-page', title: '第二页', folderId }, 'export default function Page(){return <Page pfId="root"/>;}');
  const f = await publishingDialog(t);
  act(() => { f.renderer.root.findByProps({ 'aria-label': '分享入口页面' }).props.onChange({ target: { value: 'second-page' } }); });
  act(() => { usePageStore.setState(state => ({ pageSources: Object.fromEntries(Object.entries(state.pageSources).filter(([id]) => id !== 'second-page')), designerPages: state.designerPages.filter(page => page.pageId !== 'second-page') })); });
  assert.equal(f.publish().props.disabled, true);
  assert.equal(f.publish().props.title, '原入口页面已不可用，请重新选择');
  assert.equal(f.renderer.root.findByProps({ 'aria-label': '分享入口页面' }).props.value, 'second-page');
  act(() => { f.renderer.root.findByProps({ 'aria-label': '分享入口页面' }).props.onChange({ target: { value: 'page-home' } }); });
  assert.equal(f.publish().props.disabled, false);
  act(() => { usePageStore.setState({ pageSources: {} }); useProtoStore.setState({ leftSidebarCollapsed: true, viewMode: 'project_ai', isWebPlayerMode: true }); });
  act(() => { f.renderer.root.findAllByType('button').find(button => button.children.includes('前往页面设计'))!.props.onClick(); });
  assert.equal(f.closed(), true); assert.equal(useProtoStore.getState().viewMode, 'single_page');
  assert.equal(useProtoStore.getState().leftActivityView, 'pages'); assert.equal(useProtoStore.getState().leftSidebarCollapsed, false);
  assert.equal(useProtoStore.getState().isWebPlayerMode, false);
});
