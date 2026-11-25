import './axure-import.test';
import './figma-import.test';
import './ai-recovery.test';
import './stage2-recovery.test';
import "./project-accuracy.test";
import './runtime-diagnostics.test';
import './ai-background.test';
import './mobile-related-details.test';
import './release-workspace.test';
import './website-downloads.test.cjs';
import './project-context.test';
import './spec-mcp.test';
import './authoring-mcp.test';
import './desktop-authoring.test';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { captureProjectPayload, createProjectPayload, loadProjectFromBinaryPayload, openRecentProject, normalizeProjectPayload } from '../src/services/projectStorage';
import { encodePflowBinary, decodePflowBinary, generateUnpackedGitFiles, type PflowProjectMetadata } from '../src/utils/pflowBinaryCodec';
import { pageContractErrors } from '../src/services/hermesProject';
import './materials.test';
import './table-material.test';
import './freeform.test';
import './ai-implementation.test';
import './charts.test';
import './preview-rows.test';
import './grid-layout.test';
import './database-diagram.test';
import './database-design.test';
import './project-truth.test';
import './material-contract.test';
import './mobile-design-ai.test';
import './streaming-preview.test';
import './hermes.test';
import './hermes-menu-chat.test';
import './hermes-questions.test';
import './project-workflow.test';
import './hermes-images.test';
import './hermes-model-picker.test';
import './publishing.test';
import './publishing-account.test';
import './account-gate.test';
import './published-sitemap.test';
import './sitemap.test';
import './blank-project.test';
import './deletion.test';
import './project-persistence.test';
import './mindmap.test';
import './notes.test';
import './notes-ledger.test';
import './notes-context.test';
import './mermaid-diagrams.test';
import './hermes-mindmap.test';
import './exit-confirmation.test';
import './hermes-management.test';
import './hermes-accounts.test';
import './updater.test';
import './update-experience.test';
import './ai-prompt-quality.test';
import './project-ai-speed.test';
import './project-ai-live.test';
import './acceptance-return.test';
import './i18n.test';
import './i18n-field-contracts.test';
import './high-ceiling-materials.test';
import './experience-upgrade-phases2to5.test';
import './architecture-review-fixes.test';
import { createWebExport, type WebExportOptions } from '../src/services/webExport';
import { parsePageSource } from '../src/proto/dsl/parser';
import { walk } from '../src/proto/dsl/tree';
import { useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { ProjectWelcomeLauncher } from '../src/components/ProjectWelcomeLauncher';
import { DesktopBundleModal } from '../src/components/DesktopBundleModal';

const initial = useProtoStore.getInitialState();
const initialPages = usePageStore.getInitialState();
const meta = (id = 'test', templateId: PflowProjectMetadata['templateId'] = 'customs_erp'): PflowProjectMetadata => ({
  projectId: id, projectName: id, storageDir: '/tmp/review-project/bundle', fileName: `${id}.pflow`,
  templateId, createdAt: '2026-10-30', updatedAt: '2026-10-30', pageCount: 0, tableCount: 0, stickyCount: 0,
});
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  globalThis.window = { location: { search: '' }, localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  } } as any;
  useProtoStore.setState(initial, true);
  usePageStore.setState(initialPages, true);
});

test('complete archive round trip restores custom pages, rows, widgets and drafts, replacing all old state', () => {
  loadProjectFromBinaryPayload(createProjectPayload(meta('A')));
  const source = 'export default function Page() {return <Page title="custom saved page"/>;}';
  usePageStore.getState().createDesignerPage({ pageId: 'custom-page', title: 'custom', folderId: 'folder-base-data' }, source);
  usePageStore.getState().insertRow('t_base_supplier', { supplier_name: 'saved supplier' });
  useProtoStore.getState().updateAcceptanceHeader({ remark: 'saved draft' });
  useProtoStore.getState().setActivePage('custom-page');
  const saved = captureProjectPayload();
  const bytes = encodePflowBinary(saved);
  loadProjectFromBinaryPayload(createProjectPayload(meta('B', 'blank_project')));
  usePageStore.getState().setPageSource('unrelated', 'old data');
  loadProjectFromBinaryPayload(decodePflowBinary(bytes));
  assert.deepEqual(captureProjectPayload().stateSnapshot, saved.stateSnapshot);
  assert.deepEqual(usePageStore.getState().history, {});
  const files = generateUnpackedGitFiles(saved);
  assert.equal(files.find(f => f.relativePath === 'pages/custom-page.page.tsx')?.content, source);
  assert.ok(files.find(f => f.relativePath === 'pages/index.json')?.content.includes('custom-page'));
});

test('the actual binary download handler contains canvas source and page metadata', async () => {
  loadProjectFromBinaryPayload(createProjectPayload(meta()));
  usePageStore.getState().createDesignerPage({ pageId: 'download-test', title: 'download title', folderId: 'folder-base-data' }, 'export default function Page(){return <Page title="DOWNLOAD_MARKER"/>;}');
  useProtoStore.setState({ isBundleModalOpen: true });
  let blob: Blob | undefined;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = value => { blob = value as Blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  globalThis.document = { createElement: () => ({ click() {} }) } as any;
  let renderer: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(React.createElement(DesktopBundleModal)); });
    const button = renderer!.root.findAllByType('button').find(b => b.props.onClick?.name === 'handleDownloadBinaryBundle')!;
    await act(async () => { await button.props.onClick(); });
    const decoded = normalizeProjectPayload(decodePflowBinary(await blob!.arrayBuffer()));
    assert.match(decoded.stateSnapshot.pageSources['download-test'], /DOWNLOAD_MARKER/);
    assert.equal(decoded.stateSnapshot.designerPages[0].title, 'download title');
  } finally { act(() => renderer!.unmount()); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; }
});

test('blank creation writes the exact new snapshot shown in the workspace', async () => {
  loadProjectFromBinaryPayload(createProjectPayload(meta('OLD')));
  useProtoStore.getState().createNewTable('old_secret', 'old project', '基础资料域 (MDM)');
  let written: any;
  (window as any).location.search = '?welcomeTab=new_project';
  (window as any).protoflowDesktop = { writeUnpackedGitTree: async (p: any) => { written = p; return { saved: true }; } };
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(ProjectWelcomeLauncher)); });
  await act(async () => { await renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.ok(written, 'new project must be written');
  const saved = normalizeProjectPayload(decodePflowBinary(written.binaryBundle.binaryBytes));
  assert.deepEqual(saved.stateSnapshot, captureProjectPayload().stateSnapshot);
  assert.equal(saved.meta.templateId, 'blank_project');
  assert.equal(saved.meta.pageCount, 0);
  assert.deepEqual(saved.stateSnapshot.designerFolders, []);
  assert.deepEqual(saved.stateSnapshot.pageSources, {});
  assert.equal(saved.stateSnapshot.activePageId, '');
  assert.equal(saved.stateSnapshot.dbTables.length, 0);
  assert.equal(saved.meta.storageDir, `${written.rootDirPath}/bundle`);
  act(() => renderer!.unmount());
});

test('recent projects read the corresponding file and reject failures without altering current data', async () => {
  const a = createProjectPayload(meta('A')), b = createProjectPayload(meta('B', 'blank_project'));
  loadProjectFromBinaryPayload(b); loadProjectFromBinaryPayload(a);
  let requested: any;
  (window as any).protoflowDesktop = { readBinaryProject: async (p: any) => { requested = p; return { binaryBytes: encodePflowBinary(b) }; } };
  await openRecentProject('B');
  assert.equal(requested.fileName, 'B.pflow');
  assert.deepEqual(captureProjectPayload().stateSnapshot, b.stateSnapshot);
  (window as any).protoflowDesktop.readBinaryProject = async () => { throw new Error('file missing'); };
  await assert.rejects(openRecentProject('A'), /file missing/);
  assert.equal(useProtoStore.getState().currentProjectMeta.projectId, 'B');
  (window as any).protoflowDesktop.readBinaryProject = async () => ({ binaryBytes: encodePflowBinary(b) });
  await assert.rejects(openRecentProject('A'), /ID 已变化/);
});

test('empty imported collections remain empty; invalid fields fail before state changes', () => {
  const blank = createProjectPayload(meta('empty', 'blank_project'));
  loadProjectFromBinaryPayload(blank);
  for (const key of ['dbTables', 'stickyNotes', 'suppliers', 'purchaseOrderItems', 'acceptanceOrders', 'closedLoopIssues'] as const) assert.equal(useProtoStore.getState()[key].length, 0);
  const invalid = structuredClone(blank) as any;
  invalid.stateSnapshot.suppliers = undefined;
  assert.throws(() => loadProjectFromBinaryPayload(invalid), /suppliers/);
  assert.equal(useProtoStore.getState().currentProjectMeta.projectId, 'empty');
  assert.throws(() => normalizeProjectPayload({}), /meta/);
});

test('legacy migration uses only imported tables and never inherits current canvas data', () => {
  const old: any = createProjectPayload(meta('legacy', 'blank_project'));
  old.stateSnapshot.activePageId = 'legacy-authored-page';
  delete old.schemaVersion;
  for (const key of ['pageSources', 'designerPages', 'designerFolders', 'sitemapOverrides', 'sitemapBase', 'tableRows', 'widgets', 'draftAcceptanceHeader', 'draftAcceptanceLines', 'mindmaps']) delete old.stateSnapshot[key];
  usePageStore.getState().setPageSource('secret-old-page', 'secret');
  loadProjectFromBinaryPayload(old);
  assert.equal(usePageStore.getState().pageSources['secret-old-page'], undefined);
  assert.deepEqual(useProtoStore.getState().dbTables, []);
});

test('corrupt and truncated archives are rejected', () => {
  const bytes = encodePflowBinary(createProjectPayload(meta()));
  assert.throws(() => decodePflowBinary(bytes.slice(0, -1)), /长度/);
  bytes[bytes.length - 5] ^= 1;
  assert.throws(() => decodePflowBinary(bytes), /校验和/);
});

test('AI field validation uses nearest Form and excludes queries and Select option sources', () => {
  const table = (id: string) => ({id,tableName:id,cnName:id,domain:'基础资料域 (MDM)' as const,description:'',sharedByMenus:[],columns:[]});
  const errors = pageContractErrors(`export default function Page(){return <Page>
    <Form table="orders"><Select name="supplier_id" table="suppliers"/><Form table="suppliers"><Input name="supplier_name"/></Form><Input name="after_nested"/></Form>
    <QueryForm><Input name="keyword"/></QueryForm><Input name="unbound"/>
  </Page>}`, [table('orders'),table('suppliers')]);
  assert.equal(errors.filter(e => e.includes('未知字段')).length,3);
  assert.ok(errors.some(e => e.includes('<Select>.table') && e.includes('未注册属性')));
  assert.ok(errors.some(e => e.includes('<QueryForm>.children')));
  assert.ok(errors.some(e=>e.includes('orders.supplier_id')));
  assert.ok(errors.some(e=>e.includes('suppliers.supplier_name')));
  assert.ok(errors.some(e=>e.includes('orders.after_nested')));
});

const options: WebExportOptions = {includeStickyNotes:true,includeDbSchema:true,enableInteractiveFlow:true,passwordProtected:false,accessPassword:''};
function exportScript(html: string) {
  const nodes = new Map<string, any>();
  const get = (id: string) => { if (!nodes.has(id)) nodes.set(id,{innerHTML:'',checked:true,classList:{add(){},remove(){}}}); return nodes.get(id); };
  const sandbox = vm.createContext({document:{getElementById:get},console,alert(){},confirm:()=>true});
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  vm.runInContext(script,sandbox);
  return {sandbox,main:get('app-main')};
}

test('excluded export data is absent and read-only export cannot mutate records', async () => {
  const input = { ...initial, stickyNotes: [{ ...initial.stickyNotes[0], text: 'PRIVATE_STICKY' }], dbTables: [{ ...initial.dbTables[0], description: 'PRIVATE_SCHEMA' }] };
  const html = await createWebExport(input, { ...options, includeStickyNotes: false, includeDbSchema: false, enableInteractiveFlow: false });
  assert.ok(!html.includes('PRIVATE_STICKY')); assert.ok(!html.includes('PRIVATE_SCHEMA'));
  assert.ok(!html.includes('id="togglePins"')); assert.ok(!html.includes('id="nav-db"'));
  const { sandbox } = exportScript(html);
  const before = vm.runInContext('JSON.stringify(state)', sandbox);
  vm.runInContext(`approveSup('SUP-03'); updateQty(0, 9999); updatePrice(0, 9999); submitOrder();`, sandbox);
  assert.equal(vm.runInContext('JSON.stringify(state)', sandbox), before);
});

test('password export encrypts the document and decrypts only with the correct password', async () => {
  const password = 'review password 2026';
  const html = await createWebExport({ ...initial, currentProjectMeta: { ...initial.currentProjectMeta, projectName: 'CONFIDENTIAL_PROJECT' } }, { ...options, passwordProtected: true, accessPassword: password });
  assert.ok(!html.includes('CONFIDENTIAL_PROJECT')); assert.ok(!html.includes(password));
  const payload = JSON.parse(html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/)![1]);
  const decrypt = async (pass: string) => {
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(payload.salt, 'base64'), iterations: payload.iterations, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(payload.iv, 'base64') }, key, Buffer.from(payload.ciphertext, 'base64')));
  };
  await assert.rejects(decrypt('wrong password'));
  const unlocked = await decrypt(password);
  assert.match(unlocked, /CONFIDENTIAL_PROJECT/);
  exportScript(unlocked);
  await assert.rejects(createWebExport(initial, { ...options, passwordProtected: true, accessPassword: '' }), /请输入访问密码/);
});

test('HTML export safely embeds user content without ending script or injecting markup', async () => {
  const text = '</script><img src=x onerror=alert(1)>';
  const html = await createWebExport({ ...initial, currentProjectMeta: { ...initial.currentProjectMeta, projectName: text }, stickyNotes: [{ ...initial.stickyNotes[0], text }] }, options);
  assert.ok(!html.includes(text));
  const { sandbox, main } = exportScript(html);
  assert.equal(vm.runInContext('state.stickyNotes[0].text', sandbox), text);
  assert.ok(!main.innerHTML.includes('<img src=x'));
});

test('actual template transfer chain inserts linked rows once and aborts invalid selections', async () => {
  loadProjectFromBinaryPayload(createProjectPayload(meta()));
  const doc = parsePageSource(usePageStore.getState().pageSources['acceptance-new']).doc!;
  let runtime: Runtime;
  const Harness = () => { runtime = useRuntimeController(doc, 'acceptance-new', false); return null; };
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
  const fields = { acceptance_no: 'ACC-TEST', acceptance_date: '2026-10-30', inbound_type: '购买', source_type: '采购订单转入', supplier_id: 'SUP-01', total_amount_tax_included: 0, status: '草稿' };
  act(() => runtime!.setFormValues('field-supplier-select', fields));
  let open: any, transfer: any;
  walk(doc.root, node => {
    if (node.pfId === 'btn-import-po') open = node.props.onClick;
    if (node.props.onClick && JSON.stringify(node.props.onClick).includes('importPurchaseOrderLines')) transfer = node.props.onClick;
  });
  await act(async () => { await runtime!.run(open, {}); });
  const po = usePageStore.getState().getRows('t_pms_po_item').find(r => r.status === 'confirmed' && Number(r.ordered_qty) > Number(r.delivered_qty))!;
  assert.ok(po);
  act(() => runtime!.setSelection('tbl-po-picker', [po.id]));
  const before = usePageStore.getState().getRows('t_wms_acceptance_detail').length;
  await act(async () => { await runtime!.run(transfer, {}); });
  const rows = usePageStore.getState().getRows('t_wms_acceptance_detail');
  assert.equal(rows.length, before + 1);
  const added = rows.at(-1)!;
  assert.equal(added.source_po_item_id, po.id);
  assert.equal(added.current_accept_qty, Number(po.ordered_qty) - Number(po.delivered_qty));
  assert.ok(usePageStore.getState().getRows('t_wms_acceptance_order').some(r => r.id === added.acceptance_order_id));
  assert.equal(runtime!.overlays.length, 0);
  act(() => runtime!.setSelection('tbl-po-picker', [po.id]));
  await act(async () => { await runtime!.run(transfer, {}); });
  assert.equal(usePageStore.getState().getRows('t_wms_acceptance_detail').length, before + 1);
  act(() => runtime!.setSelection('tbl-po-picker', ['missing-id']));
  await act(async () => { await runtime!.run(transfer, {}); });
  assert.match(runtime!.toasts.at(-1)!.message, /不存在/);
  act(() => renderer!.unmount());
});
