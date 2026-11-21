import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act as domAct } from 'react';
import { createRoot } from 'react-dom/client';
import TestRenderer, { act } from 'react-test-renderer';
import { installTestDom } from './dom';
import {
  LOCALE_STORAGE_KEY,
  detectSystemLocale,
  getLocale,
  resetLocaleCache,
  resolveInitialLocale,
  setLocale,
  syncDesktopBootLocale,
  toggleLocale,
} from '../src/i18n';
import { LanguageSwitch } from '../src/components/LanguageSwitch';
import { GlobalToolbar } from '../src/components/GlobalToolbar';
import { ProjectWelcomeLauncher } from '../src/components/ProjectWelcomeLauncher';
import { PublishedViewer } from '../src/viewer/PublishedViewer';
import { NodeInspectorPanel } from '../src/proto/designer/NodeInspectorPanel';
import { MaterialsAndOutlinePane } from '../src/proto/designer/MaterialsAndOutlinePane';
import { COMPONENTS, COMPONENT_MAP, CATEGORY_LABELS, type ComponentCategory } from '../src/proto/registry/meta';
import { MOBILE_COMPONENTS } from '../src/proto/mobile/meta';
import { AntdFieldControl } from '../src/proto/registry/AntdFieldControl';
import { materialOptions } from '../src/proto/registry/antdOptions';
import {
  localizeCategoryLabel,
  localizeComponentMeta,
  localizeCompositeBlock,
} from '../src/proto/registry/localizeMeta';
import {
  PAGE_TEMPLATES,
  MOBILE_PAGE_TEMPLATES,
  buildForeignKeyOptionsFromRows,
  generateFormPageSource,
  generateFromTemplate,
  generateListPageSource,
} from '../src/proto/ai/templates';
import { parseCreatePageIntent } from '../src/proto/ai/intent';
import { parseSnippetNode } from '../src/proto/ai/assistant';
import { parsePageSource } from '../src/proto/dsl/parser';
import { walk } from '../src/proto/dsl/tree';
import { RuntimeProvider, useRuntimeController, type Runtime } from '../src/proto/runtime/runtime';
import { NodeView, ScopeProvider } from '../src/proto/renderer/NodeView';
import { prepareTableRows, visibleTableRows } from '../src/proto/table/model';
import { generateMockRows, generatePreviewRows } from '../src/proto/runtime/mock';
import { createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { renderStandaloneHtml } from '../src/services/webExport';
import { encryptExportHtml } from '../src/utils/encryptedHtml';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';

const CJK_RE = /[\u4e00-\u9fff]/;

function collectText(node: TestRenderer.ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map((c) => collectText(c as TestRenderer.ReactTestInstance | string)).join(' ');
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__PROTOFLOW_FORCE_SYSTEM_LOCALE__;
  delete (globalThis as Record<string, unknown>).__PROTOFLOW_TEST_LOCALE__;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      delete document.documentElement.dataset.locale;
      document.documentElement.lang = 'zh-CN';
    }
  } catch {
    // ignore
  }
  resetLocaleCache();
});

test('i18n core: auto-detects OS/browser language, persists user choice, and syncs html[lang]', () => {
  const cleanup = installTestDom();
  try {
    assert.equal(detectSystemLocale(['zh-CN', 'en-US'], 'zh-CN'), 'zh-CN');
    assert.equal(detectSystemLocale(['zh-TW'], 'zh-TW'), 'zh-CN');
    assert.equal(detectSystemLocale(['en-US', 'zh-CN'], 'en-US'), 'en-US');
    assert.equal(detectSystemLocale(['en-GB'], 'en-GB'), 'en-US');
    assert.equal(detectSystemLocale(['ja-JP'], 'ja-JP'), 'en-US');

    // Simulate real non-JSDOM runtime with English OS locale
    (globalThis as Record<string, unknown>).__PROTOFLOW_FORCE_SYSTEM_LOCALE__ = true;
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });
    resetLocaleCache();
    assert.equal(resolveInitialLocale(), 'en-US');
    assert.equal(getLocale(), 'en-US');
    assert.equal(document.documentElement.lang, 'en');

    // User toggles to zh-CN -> persisted in localStorage and overrides OS language
    toggleLocale();
    assert.equal(getLocale(), 'zh-CN');
    assert.equal(window.localStorage.getItem(LOCALE_STORAGE_KEY), 'zh-CN');
    assert.equal(document.documentElement.lang, 'zh-CN');

    // User switches back to en-US
    setLocale('en-US');
    assert.equal(getLocale(), 'en-US');
    assert.equal(window.localStorage.getItem(LOCALE_STORAGE_KEY), 'en-US');
    assert.equal(document.documentElement.lang, 'en');
  } finally {
    cleanup();
  }
});

test('i18n UI: GlobalToolbar, LanguageSwitch, WelcomeLauncher & NodeInspector switch cleanly without CJK residue or layout overflow', () => {
  const cleanup = installTestDom();
  try {
    // Load an English blank project so user project name is English
    setLocale('en-US');
    const payload = createProjectPayload({
      projectId: 'proj-en',
      projectName: 'Global Supply Portal',
      storageDir: '/tmp/proj-en/bundle',
      fileName: 'Global Supply Portal.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(payload);
    useProtoStore.setState({ recentProjects: [] });

    // 1. GlobalToolbar in editor mode & WebPlayer mode
    let toolbarRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      toolbarRenderer = TestRenderer.create(React.createElement(GlobalToolbar));
    });
    const toolbarTextEn = collectText(toolbarRenderer.root).replace(/简体中文|中文|中/g, '');
    assert.equal(CJK_RE.test(toolbarTextEn), false, `Unexpected CJK in English GlobalToolbar: ${toolbarTextEn}`);

    // Verify WCAG 2.5.3 Label in Name on LanguageSwitch
    const langBtn = toolbarRenderer.root.findByType(LanguageSwitch).findByType('button');
    assert.ok(String(langBtn.props['aria-label']).startsWith('EN'), 'LanguageSwitch aria-label must start with visible badge EN');

    // Toggle LanguageSwitch to zh-CN reactively
    act(() => {
      langBtn.props.onClick();
    });
    assert.equal(getLocale(), 'zh-CN');
    const toolbarTextZh = collectText(toolbarRenderer.root);
    assert.ok(toolbarTextZh.includes('原型画布'), 'Expected Chinese toolbar tooltip after toggling back to zh-CN');

    // Switch back to en-US and check WebPlayer header layout hardening
    act(() => {
      setLocale('en-US');
      useProtoStore.setState({ isWebPlayerMode: true });
    });
    const webHeaderTextEn = collectText(toolbarRenderer.root).replace(/简体中文|中文|中/g, '');
    assert.ok(webHeaderTextEn.includes('Back to Editor') || webHeaderTextEn.includes('Web Preview'), `Expected English WebPlayer header: ${webHeaderTextEn}`);
    assert.equal(CJK_RE.test(webHeaderTextEn), false, `Unexpected CJK in WebPlayer header: ${webHeaderTextEn}`);
    act(() => {
      useProtoStore.setState({ isWebPlayerMode: false });
      toolbarRenderer.unmount();
    });

    // 2. ProjectWelcomeLauncher layout & English rendering
    let welcomeRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      welcomeRenderer = TestRenderer.create(React.createElement(ProjectWelcomeLauncher, { standalone: true }));
    });
    const aside = welcomeRenderer.root.findByType('aside');
    assert.ok(String(aside.props.className).includes('w-60'), 'Welcome sidebar should be widened to w-60 for English stability');
    const welcomeTextEn = collectText(welcomeRenderer.root).replace(/中文/g, '').replace(/中/g, '');
    assert.equal(CJK_RE.test(welcomeTextEn), false, `Unexpected CJK in English WelcomeLauncher: ${welcomeTextEn}`);
    act(() => {
      welcomeRenderer.unmount();
    });

    // 3. NodeInspectorPanel 332px 4-tab layout budget & container query protection
    const sampleDoc = parsePageSource('export default function Page() { return <Page title="Orders"><Button type="primary">Submit</Button></Page>; }').doc!;
    const btnNode = sampleDoc.root.children[0] as import('../src/proto/types').ProtoNode;
    let inspectorRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      inspectorRenderer = TestRenderer.create(
        React.createElement(NodeInspectorPanel, {
          pageId: 'orders',
          doc: sampleDoc,
          selectedNode: btnNode,
          overlays: [],
          onSelectNode: () => {},
          onPropChange: () => {},
          onTextChange: () => {},
          onMoveNode: () => {},
          onDuplicateNode: () => {},
          onRemoveNode: () => {},
          onOpenOverlayDesigner: () => {},
          onCreateOverlay: () => {},
          onRunAiPrompt: () => {},
          onSaveAsComposite: () => {},
        }),
      );
    });
    const inspectorAside = inspectorRenderer.root.findByType('aside');
    assert.ok(String(inspectorAside.props.className).includes('pf-inspector-cq'), 'Inspector aside must enable pf-inspector-cq container query');
    const inspectorTextEn = collectText(inspectorRenderer.root);
    assert.ok(inspectorTextEn.includes('Props') && inspectorTextEn.includes('Events'), 'Inspector tabs must use compact English labels Props & Events');
    assert.equal(CJK_RE.test(inspectorTextEn), false, `Unexpected CJK in English NodeInspectorPanel: ${inspectorTextEn}`);
    act(() => {
      inspectorRenderer.unmount();
    });

    // 4. MaterialsAndOutlinePane palette localization
    let paletteRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      paletteRenderer = TestRenderer.create(
        React.createElement(MaterialsAndOutlinePane, {
          root: sampleDoc.root,
          selectedPfId: btnNode.pfId,
          hoveredPfId: null,
          activeOverlayId: null,
          compositeBlocks: [],
          onSelectNode: () => {},
          onHoverNode: () => {},
          onSelectOverlay: () => {},
          onInsertComponent: () => {},
          onInsertCompositeBlock: () => {},
          onDeleteCompositeBlock: () => {},
          onPromptSaveComposite: () => {},
          onDeleteNode: () => {},
          onApplyTemplate: () => {},
        }),
      );
    });
    const paletteTextEn = collectText(paletteRenderer.root);
    assert.equal(CJK_RE.test(paletteTextEn), false, `Unexpected CJK in English MaterialsAndOutlinePane: ${paletteTextEn}`);
    act(() => {
      paletteRenderer.unmount();
    });
  } finally {
    cleanup();
  }
});

test('i18n materials, templates, starters, mock data & HTML export generate valid English content while preserving saved user data', async () => {
  const cleanup = installTestDom();
  try {
    setLocale('en-US');

    // 1. All 8 material categories & all 114+ components localize cleanly and snippets parse as valid AST
    for (const cat of Object.keys(CATEGORY_LABELS) as ComponentCategory[]) {
      const label = localizeCategoryLabel(cat, 'en-US');
      assert.ok(label.length > 0 && !CJK_RE.test(label), `Category ${cat} has untranslated label: ${label}`);
    }
    for (const comp of COMPONENTS) {
      const loc = localizeComponentMeta(comp, 'en-US');
      assert.ok(!CJK_RE.test(loc.title), `Component ${comp.name} title still has CJK: ${loc.title}`);
      assert.ok(!CJK_RE.test(loc.description), `Component ${comp.name} description still has CJK: ${loc.description}`);
      // Strip preserved canonical business value attributes before checking user-facing snippet text for CJK
      const visibleSnippetText = loc.snippet
        .replace(/\b(?:value|defaultValue|initialValue)\s*[:=]\s*(["'])(?:\\.|(?!\1)[^\\])*\1/g, '');
      assert.ok(!CJK_RE.test(visibleSnippetText), `Component ${comp.name} user-facing snippet still has CJK: ${loc.snippet}`);
      const parsedNode = parseSnippetNode(loc.snippet);
      assert.ok(parsedNode, `Localized snippet for ${comp.name} must remain valid JSX AST`);
    }

    // 2. Starter projects (saas_inventory, crm_analytics, mobile_starter) generate English pages/tables/mock rows
    for (const tplId of ['saas_inventory', 'crm_analytics', 'mobile_starter'] as const) {
      const payload = createProjectPayload({
        projectId: `en-${tplId}`,
        projectName: `Demo ${tplId}`,
        storageDir: `/tmp/${tplId}/bundle`,
        fileName: `${tplId}.pflow`,
        templateId: tplId,
        projectMode: tplId === 'mobile_starter' ? 'mobile' : 'desktop',
        createdAt: '2026-11-21T00:00:00Z',
        updatedAt: '2026-11-21T00:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      });
      for (const page of payload.stateSnapshot.designerPages) {
        assert.ok(!CJK_RE.test(page.title), `Starter ${tplId} page title has CJK in en-US: ${page.title}`);
        const src = payload.stateSnapshot.pageSources[page.pageId] ?? '';
        assert.ok(parsePageSource(src).doc, `Starter ${tplId} page ${page.pageId} must parse cleanly`);
      }
      const firstTable = payload.stateSnapshot.dbTables[0];
      if (firstTable) {
        const rows = generateMockRows(firstTable, 3);
        assert.equal(rows.length, 3);
        assert.ok(!CJK_RE.test(JSON.stringify(rows)), `Mock rows in en-US should not contain CJK: ${JSON.stringify(rows)}`);
      }
    }

    // 3. Page templates & English natural-language create-page intent
    const enCrmPayload = createProjectPayload({
      projectId: 'en-tpl-check',
      projectName: 'Demo CRM',
      storageDir: '/tmp/en-tpl/bundle',
      fileName: 'en-tpl.pflow',
      templateId: 'crm_analytics',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    const enTables = enCrmPayload.stateSnapshot.dbTables;
    const sampleTable = enTables[0];
    assert.ok(sampleTable, 'Expected starter tables');
    for (const tpl of [...PAGE_TEMPLATES, ...MOBILE_PAGE_TEMPLATES]) {
      assert.ok((tpl as { titleEn?: string }).titleEn, `Template ${tpl.kind} missing titleEn`);
      const src = generateFromTemplate(tpl.kind, sampleTable, enTables, {
        pageId: `test-${tpl.kind}`,
        title: 'Vendor Directory',
      });
      assert.ok(parsePageSource(src).doc, `Generated English template ${tpl.kind} must parse`);
      assert.equal(CJK_RE.test(src), false, `Generated English template ${tpl.kind} has CJK: ${src}`);
    }
    const intent = parseCreatePageIntent('Create a vendor evaluation list page', enTables);
    assert.ok(intent, 'English create-page intent should match');
    assert.equal(intent.template, 'list');

    // 4. Standalone HTML & encrypted HTML export in English mode
    const html = renderStandaloneHtml(useProtoStore.getState(), {
      includeStickyNotes: true,
      includeDbSchema: true,
      enableInteractiveFlow: true,
      passwordProtected: false,
      accessPassword: '',
    });
    assert.ok(html.includes('<html lang="en">'), 'Standalone HTML must declare lang="en" in English mode');
    const encrypted = await encryptExportHtml('<!doctype html><html><body>demo</body></html>', 'secret123', 'DemoApp');
    assert.ok(encrypted.includes('<html lang="en">'), 'Encrypted HTML wrapper must declare lang="en" in English mode');

    // 5. User saved Chinese project data is NEVER mutated when switching UI to English
    setLocale('zh-CN');
    const zhPayload = createProjectPayload({
      projectId: 'zh-saved',
      projectName: '采购验收系统',
      storageDir: '/tmp/zh/bundle',
      fileName: '采购验收系统.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(zhPayload);
    const createdFolder = usePageStore.getState().createDesignerFolder('合同管理', null);
    usePageStore.getState().createDesignerPage(
      { pageId: 'my-zh-page', title: '客户合同审批单', folderId: createdFolder.id },
      'export default function Page() { return <Page title="客户合同审批单"><Button>提交审批</Button></Page>; }',
    );
    setLocale('en-US');
    assert.equal(useProtoStore.getState().currentProjectMeta.projectName, '采购验收系统');
    assert.equal(usePageStore.getState().designerFolders.find((f) => f.id === createdFolder.id)?.title, '合同管理');
    assert.equal(usePageStore.getState().designerPages.find((p) => p.pageId === 'my-zh-page')?.title, '客户合同审批单');
    assert.ok(usePageStore.getState().pageSources['my-zh-page']?.includes('提交审批'));
    assert.ok(COMPONENT_MAP.Button.title === '按钮', 'Canonical COMPONENT_MAP must remain untouched for Node contract stability');
  } finally {
    cleanup();
  }
});

test('i18n Electron main process: dynamic macOS menu and close guard switch cleanly between zh-CN and en-US', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mainI18n = require('../electron/i18n.cjs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { installApplicationMenu } = require('../electron/application-menu.cjs');

  let lastMenuTemplate: Array<{ label: string; submenu: Array<{ label?: string }> }> = [];
  const fakeMenu = {
    buildFromTemplate: (tpl: typeof lastMenuTemplate) => tpl,
    setApplicationMenu: (tpl: typeof lastMenuTemplate) => {
      lastMenuTemplate = tpl;
    },
  };
  const fakeApp = { on: () => {} };

  try {
    mainI18n.setMainLocale('zh-CN');
    installApplicationMenu({ app: fakeApp, Menu: fakeMenu, platform: 'darwin', locale: 'zh-CN' });
    assert.equal(lastMenuTemplate[0].submenu[0].label, '关于 Alex');

    mainI18n.setMainLocale('en-US');
    assert.equal(lastMenuTemplate[0].submenu[0].label, 'About Alex');
    assert.ok(lastMenuTemplate[0].submenu.some((item) => item.label === 'Quit Alex'));
  } finally {
    mainI18n.setMainLocale('zh-CN');
  }
});

test('i18n data integrity [P1 #1]: generated acceptance form submits supplier primary key (SUP-01) instead of company name in both en-US and zh-CN', async () => {
  const cleanup = installTestDom();
  try {
    for (const [locale, expectedLabel] of [
      ['en-US', 'Aurora Smart Digital Ltd.'],
      ['zh-CN', '杭州极光智能数码有限公司'],
    ] as const) {
      setLocale(locale);
      const payload = createProjectPayload({
        projectId: `fk-check-${locale}`,
        projectName: `FK Check ${locale}`,
        storageDir: `/tmp/fk-${locale}/bundle`,
        fileName: `fk-${locale}.pflow`,
        templateId: 'saas_inventory',
        createdAt: '2026-11-21T00:00:00Z',
        updatedAt: '2026-11-21T00:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      });
      loadProjectFromBinaryPayload(payload);

      const dbTables = useProtoStore.getState().dbTables;
      const accOrder = dbTables.find((t) => t.id === 't_wms_acceptance_order')!;
      const src = generateFormPageSource(accOrder, { pageId: `acc-form-${locale}`, locale }, dbTables);
      const doc = parsePageSource(src).doc!;

      let formFieldsProp: Array<Record<string, unknown>> = [];
      let submitAction: unknown;
      walk(doc.root, (node) => {
        if (node.pfId === 'form-main' && Array.isArray(node.props.fields)) {
          formFieldsProp = node.props.fields as Array<Record<string, unknown>>;
        }
        if (node.type === 'Button' && JSON.stringify(node.props.onClick ?? '').includes('submitForm')) {
          submitAction = node.props.onClick;
        }
      });

      const supplierField = formFieldsProp.find((f) => f.name === 'supplier_id')!;
      assert.ok(supplierField, `Expected supplier_id field on generated ${locale} form`);
      const parsedOptions = materialOptions(supplierField.options);
      assert.equal(parsedOptions[0]?.label, expectedLabel);
      assert.equal(parsedOptions[0]?.value, 'SUP-01');

      // Execute actual runtime form write path and verify saved supplier_id is primary key 'SUP-01'
      let runtime!: Runtime;
      const Harness = () => {
        runtime = useRuntimeController(doc, `acc-form-${locale}`, false);
        return null;
      };
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(React.createElement(Harness));
      });
      act(() => {
        runtime.setFormValues('form-main', {
          acceptance_no: 'DHY20261121001',
          acceptance_date: '2026-11-21',
          inbound_type: '购买',
          source_type: '采购订单转入',
          supplier_id: parsedOptions[0].value,
          total_amount_tax_included: 563.0,
          status: '草稿',
        });
      });
      await act(async () => {
        await runtime.run(submitAction as import('../src/proto/types').PropValue, {});
      });

      const savedOrder = usePageStore.getState().getRows('t_wms_acceptance_order')[0];
      assert.ok(savedOrder, 'Expected submitted acceptance order row');
      assert.equal(savedOrder.supplier_id, 'SUP-01');
      const supplierRows = usePageStore.getState().getRows('t_base_supplier');
      assert.ok(
        supplierRows.some((s) => s.id === savedOrder.supplier_id && s.supplier_name === expectedLabel),
        'Submitted supplier_id must join cleanly against t_base_supplier.id',
      );
      act(() => renderer.unmount());
    }
  } finally {
    cleanup();
  }
});

test('i18n data integrity [P1 #2]: zh-CN and en-US approval list templates query and update the exact same status contract on existing tables', async () => {
  const cleanup = installTestDom();
  try {
    setLocale('zh-CN');
    const blankPayload = createProjectPayload({
      projectId: 'status-contract-check',
      projectName: '审批状态契约校验',
      storageDir: '/tmp/status-contract/bundle',
      fileName: 'status-contract.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(blankPayload);

    const approvalTable: DBTableSchema = {
      id: 't_biz_purchase_req',
      tableName: 't_biz_purchase_req',
      cnName: '采购申请单',
      domain: '采购管理域 (SRM)',
      description: '已有中文状态记录的业务审批表',
      sharedByMenus: [],
      columns: [
        { id: 'c1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '主键' },
        { id: 'c2', name: 'req_no', dataType: 'VARCHAR(32)', nullable: false, comment: '申请单号' },
        { id: 'c3', name: 'req_title', dataType: 'VARCHAR(120)', nullable: false, comment: '申请主题' },
        { id: 'c4', name: 'status', dataType: 'VARCHAR(24)', nullable: false, comment: '审批状态' },
      ],
    };

    useProtoStore.setState({ dbTables: [approvalTable] });
    usePageStore.setState({
      tableRows: {
        t_biz_purchase_req: [
          { id: 'REQ-01', req_no: 'PR-2026-01', req_title: 'GPU 服务器扩容采购', status: '待审批' },
          { id: 'REQ-02', req_no: 'PR-2026-02', req_title: '研发显示器增补', status: '待审批' },
          { id: 'REQ-03', req_no: 'PR-2026-03', req_title: '办公网络改造', status: '已通过' },
        ],
      },
    });

    const zhSrc = generateListPageSource(approvalTable, [approvalTable], {
      pageId: 'req-list-zh',
      withStatusTabs: true,
      locale: 'zh-CN',
    });
    const enSrc = generateListPageSource(approvalTable, [approvalTable], {
      pageId: 'req-list-en',
      withStatusTabs: true,
      locale: 'en-US',
    });

    const zhDoc = parsePageSource(zhSrc).doc!;
    const enDoc = parsePageSource(enSrc).doc!;

    const extractListMeta = (doc: typeof zhDoc) => {
      let pendingFilter: Record<string, unknown> | undefined;
      let approvedFilter: Record<string, unknown> | undefined;
      const tabTitles: string[] = [];
      let approveSubmitAction: unknown;
      let rejectAction: unknown;
      walk(doc.root, (node) => {
        if (node.type === 'Tab' && typeof node.props.title === 'string') {
          tabTitles.push(node.props.title);
        }
        if (node.pfId === 'tbl-pending') pendingFilter = node.props.filter as Record<string, unknown>;
        if (node.pfId === 'tbl-approved') approvedFilter = node.props.filter as Record<string, unknown>;
        if (node.type === 'Modal' && node.props.id === 'm-approve') {
          walk(node, (sub) => {
            if (sub.type === 'Button' && JSON.stringify(sub.props.onClick ?? '').includes('updateRow')) {
              if (sub.props.type === 'danger') rejectAction = sub.props.onClick;
              if (sub.props.type === 'primary') approveSubmitAction = sub.props.onClick;
            }
          });
        }
      });
      return { pendingFilter, approvedFilter, tabTitles, approveSubmitAction, rejectAction };
    };

    const zhMeta = extractListMeta(zhDoc);
    const enMeta = extractListMeta(enDoc);

    // Localized tab titles differ, while underlying table filter contract is identical
    assert.deepEqual(zhMeta.tabTitles, ['全部', '待审批', '已通过']);
    assert.deepEqual(enMeta.tabTitles, ['All', 'Pending', 'Approved']);
    assert.deepEqual(enMeta.pendingFilter, zhMeta.pendingFilter);
    assert.deepEqual(enMeta.approvedFilter, zhMeta.approvedFilter);

    const rows = usePageStore.getState().getRows('t_biz_purchase_req');
    const zhPendingRows = visibleTableRows(
      prepareTableRows(rows, { filter: zhMeta.pendingFilter }, {}, null).roots,
      () => false,
    ).map((r) => r.row.id);
    const enPendingRows = visibleTableRows(
      prepareTableRows(rows, { filter: enMeta.pendingFilter }, {}, null).roots,
      () => false,
    ).map((r) => r.row.id);

    assert.deepEqual(zhPendingRows, ['REQ-01', 'REQ-02']);
    assert.deepEqual(enPendingRows, zhPendingRows, 'Both zh-CN and en-US Pending tabs must match the exact same pending rows');

    // Run English Approve and Reject actions against existing rows -> must write '已通过' / '已驳回', not 'Approved' / 'Rejected'
    setLocale('en-US');
    let enRuntime!: Runtime;
    const EnHarness = () => {
      enRuntime = useRuntimeController(enDoc, 'req-list-en', false);
      return null;
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(EnHarness));
    });
    act(() => {
      enRuntime.setFormValues('form-approve', { decision: '已通过', opinion: 'LGTM' });
    });
    const req1 = usePageStore.getState().getRows('t_biz_purchase_req').find((r) => r.id === 'REQ-01')!;
    await act(async () => {
      await enRuntime.run(enMeta.approveSubmitAction as import('../src/proto/types').PropValue, {
        tableId: 't_biz_purchase_req',
        row: req1,
      });
    });
    const req2 = usePageStore.getState().getRows('t_biz_purchase_req').find((r) => r.id === 'REQ-02')!;
    await act(async () => {
      await enRuntime.run(enMeta.rejectAction as import('../src/proto/types').PropValue, {
        tableId: 't_biz_purchase_req',
        row: req2,
      });
    });

    const updatedRows = usePageStore.getState().getRows('t_biz_purchase_req');
    assert.equal(updatedRows.find((r) => r.id === 'REQ-01')?.status, '已通过');
    assert.equal(updatedRows.find((r) => r.id === 'REQ-02')?.status, '已驳回');
    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});

test('i18n parity & currency [P2 #1 & P2 #2]: annual-plan has identical list features across languages and currency stays ¥', () => {
  const cleanup = installTestDom();
  try {
    setLocale('zh-CN');
    const zhErp = createProjectPayload({
      projectId: 'erp-zh',
      projectName: '进销存中文',
      storageDir: '/tmp/erp-zh/bundle',
      fileName: 'erp-zh.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });

    setLocale('en-US');
    const enErp = createProjectPayload({
      projectId: 'erp-en',
      projectName: 'ERP English',
      storageDir: '/tmp/erp-en/bundle',
      fileName: 'erp-en.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });

    const zhAnnualDoc = parsePageSource(zhErp.stateSnapshot.pageSources['annual-plan']).doc!;
    const enAnnualDoc = parsePageSource(enErp.stateSnapshot.pageSources['annual-plan']).doc!;
    const componentTypes = (doc: typeof zhAnnualDoc) => {
      const types: string[] = [];
      walk(doc.root, (n) => types.push(n.type));
      return types;
    };
    assert.ok(componentTypes(enAnnualDoc).includes('Table'), 'English annual-plan must include Table list view');
    assert.ok(componentTypes(enAnnualDoc).includes('QueryForm'), 'English annual-plan must include QueryForm');
    assert.deepEqual(componentTypes(enAnnualDoc), componentTypes(zhAnnualDoc), 'annual-plan component structure must match across zh-CN and en-US');

    // Currency symbol must remain ¥ in material snippets & starters regardless of UI language
    const numberInputMetaEn = localizeComponentMeta(COMPONENT_MAP.NumberInput, 'en-US');
    const numberInputMetaZh = localizeComponentMeta(COMPONENT_MAP.NumberInput, 'zh-CN');
    assert.ok(numberInputMetaEn.snippet.includes('prefix="¥"'), `Expected ¥ prefix in en-US NumberInput snippet: ${numberInputMetaEn.snippet}`);
    assert.ok(!numberInputMetaEn.snippet.includes('$'), `Unexpected $ in en-US NumberInput snippet: ${numberInputMetaEn.snippet}`);
    assert.ok(numberInputMetaZh.snippet.includes('prefix="¥"'));
  } finally {
    cleanup();
  }
});

test('i18n desktop process propagation [P2 #3]: boot hydration preserves saved main locale, passes PROTOFLOW_LOCALE to sidecars, and initializes Hermes dashboard locale', async () => {
  const cleanup = installTestDom();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-i18n-proc-'));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mainI18n = require('../electron/i18n.cjs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { HermesRuntime } = require('../electron/hermes-runtime.cjs');
  try {
    // 1. Renderer localStorage is empty while OS/browser reports zh-CN, but desktop main process saved en-US
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    delete document.documentElement.dataset.locale;
    (globalThis as Record<string, unknown>).__PROTOFLOW_FORCE_SYSTEM_LOCALE__ = true;
    Object.defineProperty(window.navigator, 'languages', { value: ['zh-CN'], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: 'zh-CN', configurable: true });
    resetLocaleCache();

    let desktopSavedLocale = 'en-US';
    const setLocaleCalls: string[] = [];
    const mockDesktop = {
      getLocale: async () => desktopSavedLocale,
      setLocale: async (next: string) => {
        setLocaleCalls.push(next);
        desktopSavedLocale = next;
      },
    };

    const resolved = await syncDesktopBootLocale(mockDesktop);
    assert.equal(resolved, 'en-US');
    assert.equal(setLocaleCalls.length, 0, 'Empty renderer storage must not overwrite saved desktop preference with OS language');
    assert.equal(desktopSavedLocale, 'en-US');
    assert.equal(getLocale(), 'en-US');

    // 2. Main process en-US propagates PROTOFLOW_LOCALE to HermesRuntime.envFor() / Python sidecars
    mainI18n.setMainLocale('en-US');
    const rt = new HermesRuntime({
      dataDir: path.join(tmpDir, 'integration'),
      managedHome: path.join(tmpDir, 'hermes-home'),
      emit() {},
    });
    const sidecarEnv = rt.envFor(path.join(tmpDir, 'hermes-home'));
    assert.equal(sidecarEnv.PROTOFLOW_LOCALE, 'en-US');
    rt.close();

    // 3. Hermes dashboard preload initializes hermes-locale from --alex-locale instead of hardcoded 'zh'
    const preloadScript = fs.readFileSync(path.join(process.cwd(), 'electron/hermes-dashboard-preload.cjs'), 'utf8');
    const runPreload = (argv: string[], initialStore: Record<string, string> = {}) => {
      const store = new Map(Object.entries(initialStore));
      vm.runInNewContext(preloadScript, {
        process: { argv, env: {} },
        navigator: { language: 'zh-CN' },
        localStorage: {
          getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
          setItem: (k: string, v: string) => {
            store.set(k, String(v));
          },
        },
      });
      return store.get('hermes-locale');
    };
    assert.equal(runPreload(['electron', '--alex-locale=en']), 'en');
    assert.equal(runPreload(['electron', '--alex-locale=zh']), 'zh');
    assert.equal(runPreload(['electron', '--alex-locale=en'], { 'hermes-locale': 'zh' }), 'zh');
  } finally {
    mainI18n.setMainLocale('zh-CN');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    cleanup();
  }
});

test('i18n viewer reactive error [P2 #4]: wrong share password error updates live in both directions when switching languages', async () => {
  const cleanup = installTestDom();
  const prevFetch = globalThis.fetch;
  const shareId = 'share_pw_demo_token_12345678';
  try {
    window.history.replaceState(null, '', `/p/${shareId}`);
    setLocale('zh-CN');

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const acceptLang = new Headers(init?.headers).get('Accept-Language') ?? '';
      const preferEn = acceptLang.toLowerCase().startsWith('en');
      if (url.endsWith(`/api/v1/view/${shareId}`) && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({ id: shareId, title: 'Supply Chain Demo', version: 2, passwordProtected: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith(`/api/v1/view/${shareId}/open`) && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ error: preferEn ? 'Incorrect access password' : '访问密码不正确' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }) as typeof fetch;

    let viewer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      viewer = TestRenderer.create(React.createElement(PublishedViewer));
    });

    const passInput = viewer.root.find((n) => n.type === 'input' && n.props.type === 'password');
    act(() => {
      passInput.props.onChange({ target: { value: 'wrong-pass' } });
    });
    const form = viewer.root.findByType('form');
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    const getAlertText = () => collectText(viewer.root.find((n) => n.props.role === 'alert'));
    const getSubmitText = () => collectText(viewer.root.find((n) => n.type === 'button' && n.props.type === 'submit'));

    assert.equal(getAlertText(), '访问密码不正确');
    assert.equal(getSubmitText().trim(), '查看原型');

    // Toggle zh-CN -> en-US: both button and already-displayed error must switch to English
    const langBtn = viewer.root.findByType(LanguageSwitch).findByType('button');
    act(() => {
      langBtn.props.onClick();
    });
    assert.equal(getSubmitText().trim(), 'Open Prototype');
    assert.equal(getAlertText(), 'Incorrect access password');

    // Toggle en-US -> zh-CN: already-displayed error switches back to Chinese
    act(() => {
      langBtn.props.onClick();
    });
    assert.equal(getSubmitText().trim(), '查看原型');
    assert.equal(getAlertText(), '访问密码不正确');

    // Submit wrong password while in en-US (server returns English error), then toggle to zh-CN
    act(() => {
      langBtn.props.onClick();
    });
    assert.equal(getLocale(), 'en-US');
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });
    assert.equal(getAlertText(), 'Incorrect access password');
    act(() => {
      langBtn.props.onClick();
    });
    assert.equal(getLocale(), 'zh-CN');
    assert.equal(getAlertText(), '访问密码不正确');

    act(() => viewer.unmount());
  } finally {
    globalThis.fetch = prevFetch;
    cleanup();
  }
});


test('Round-2 [P1 #1]: creating a new project never leaks tableRows or suppliers from the previously open project', () => {
  const cleanup = installTestDom();
  try {
    setLocale('zh-CN');
    const prevPayload = createProjectPayload({
      projectId: 'old-proj',
      projectName: '旧项目',
      storageDir: '/tmp/old-proj/bundle',
      fileName: 'old-proj.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(prevPayload);

    // Mutate currently open project so its supplier table ONLY has OLD-ONLY-009
    usePageStore.setState({
      tableRows: {
        t_base_supplier: [
          {
            id: 'OLD-ONLY-009',
            supplier_code: 'OLD-009',
            supplier_name: 'Legacy Exclusive Supplier',
            status: 'qualified',
          },
        ],
      },
    });
    useProtoStore.setState({
      suppliers: [
        {
          id: 'OLD-ONLY-009',
          code: 'OLD-009',
          name: 'Legacy Exclusive Supplier',
          contactPerson: 'Old User',
          phone: '13000000000',
          category: 'Legacy',
          taxRateDefault: 13,
          status: 'qualified',
          updatedAt: '09:00:00',
        },
      ],
    });

    for (const locale of ['zh-CN', 'en-US'] as const) {
      setLocale(locale);
      const freshPayload = createProjectPayload({
        projectId: `fresh-proj-${locale}`,
        projectName: `Fresh ${locale}`,
        storageDir: `/tmp/fresh-${locale}/bundle`,
        fileName: `fresh-${locale}.pflow`,
        templateId: 'saas_inventory',
        createdAt: '2026-11-21T01:00:00Z',
        updatedAt: '2026-11-21T01:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      });

      const accNewSrc = freshPayload.stateSnapshot.pageSources['acceptance-new'];
      assert.ok(accNewSrc, `Expected acceptance-new in ${locale}`);
      assert.equal(accNewSrc.includes('OLD-ONLY-009'), false, `Leaked OLD-ONLY-009 into ${locale} acceptance-new`);
      assert.equal(accNewSrc.includes('Legacy Exclusive Supplier'), false, `Leaked old supplier name into ${locale} acceptance-new`);

      const doc = parsePageSource(accNewSrc).doc!;
      let headerFields: Array<Record<string, unknown>> = [];
      walk(doc.root, (n) => {
        if (n.pfId === 'field-supplier-select' && Array.isArray(n.props.fields)) {
          headerFields = n.props.fields as Array<Record<string, unknown>>;
        }
      });
      const supField = headerFields.find((f) => f.name === 'supplier_id')!;
      const opts = materialOptions(supField.options);
      assert.deepEqual(
        opts.map((o) => o.value),
        ['SUP-01', 'SUP-02'],
        `New ${locale} project acceptance-new must use only its own qualified suppliers`,
      );
    }
  } finally {
    cleanup();
  }
});

test('Round-2 [P1 #2]: selecting Reject + clicking Submit in approval modal writes rejected status instead of approving', async () => {
  const cleanup = installTestDom();
  try {
    for (const locale of ['en-US', 'zh-CN'] as const) {
      setLocale(locale);
      const payload = createProjectPayload({
        projectId: `approve-decision-${locale}`,
        projectName: `Approval ${locale}`,
        storageDir: `/tmp/approve-${locale}/bundle`,
        fileName: `approve-${locale}.pflow`,
        templateId: 'saas_inventory',
        createdAt: '2026-11-21T00:00:00Z',
        updatedAt: '2026-11-21T00:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      });
      loadProjectFromBinaryPayload(payload);

      const src = usePageStore.getState().pageSources['supplier-approval'];
      const doc = parsePageSource(src).doc!;
      let approveModalNode: import('../src/proto/types').ProtoNode | undefined;
      let submitAction: unknown;
      walk(doc.root, (node) => {
        if (node.type === 'Modal' && node.props.id === 'm-approve') {
          approveModalNode = node;
          walk(node, (sub) => {
            if (sub.type === 'Button' && sub.props.type === 'primary') {
              submitAction = sub.props.onClick;
            }
          });
        }
      });
      assert.ok(approveModalNode && submitAction, `Expected m-approve modal and Submit button in ${locale}`);

      let runtime!: Runtime;
      const pendingRow3 = usePageStore.getState().getRows('t_base_supplier').find((r) => r.id === 'SUP-03')!;
      assert.equal(pendingRow3.status, 'pending');

      const ModalHarness = () => {
        runtime = useRuntimeController(doc, 'supplier-approval', false);
        return React.createElement(
          RuntimeProvider,
          { value: runtime },
          React.createElement(
            ScopeProvider,
            { value: { tableId: 't_base_supplier', row: pendingRow3 } },
            React.createElement(NodeView, { node: approveModalNode!, live: true }),
          ),
        );
      };

      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(React.createElement(ModalHarness));
      });

      // 1. Clicking Submit without selecting Decision must be blocked by required validation
      await act(async () => {
        await runtime.run(submitAction as import('../src/proto/types').PropValue, {
          tableId: 't_base_supplier',
          row: pendingRow3,
        });
      });
      assert.equal(
        usePageStore.getState().getRows('t_base_supplier').find((r) => r.id === 'SUP-03')?.status,
        'pending',
        'Submitting without Decision must not mutate status',
      );

      // 2. Select Reject in the mounted Radio control and click Submit -> must become 'rejected' (NOT 'qualified')
      const decisionCtrl = renderer.root
        .findAllByType(AntdFieldControl)
        .find((c) => c.props.def.name === 'decision')!;
      const decisionOpts = materialOptions(decisionCtrl.props.def.options);
      const rejectOpt = decisionOpts.find((o) => o.label === (locale === 'en-US' ? 'Reject' : '驳回'))!;
      const approveOpt = decisionOpts.find((o) => o.label === (locale === 'en-US' ? 'Approve' : '通过'))!;
      assert.equal(rejectOpt?.value, 'rejected');
      assert.equal(approveOpt?.value, 'qualified');

      act(() => {
        decisionCtrl.props.onChange(rejectOpt.value);
      });
      await act(async () => {
        await runtime.run(submitAction as import('../src/proto/types').PropValue, {
          tableId: 't_base_supplier',
          row: pendingRow3,
        });
      });
      assert.equal(
        usePageStore.getState().getRows('t_base_supplier').find((r) => r.id === 'SUP-03')?.status,
        'rejected',
        `Selecting Reject + Submit in ${locale} must set SUP-03 status to rejected`,
      );

      // 3. Select Approve + click Submit on SUP-04 -> must become 'qualified'
      const pendingRow4 = usePageStore.getState().getRows('t_base_supplier').find((r) => r.id === 'SUP-04')!;
      act(() => {
        decisionCtrl.props.onChange(approveOpt.value);
      });
      await act(async () => {
        await runtime.run(submitAction as import('../src/proto/types').PropValue, {
          tableId: 't_base_supplier',
          row: pendingRow4,
        });
      });
      assert.equal(
        usePageStore.getState().getRows('t_base_supplier').find((r) => r.id === 'SUP-04')?.status,
        'qualified',
      );

      act(() => renderer.unmount());
    }
  } finally {
    cleanup();
  }
});

test('Round-2 [P1 #3]: tables without a reject state omit Reject actions and never guess status transitions by position', () => {
  const cleanup = installTestDom();
  try {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      setLocale(locale);
      const payload = createProjectPayload({
        projectId: `acc-contract-${locale}`,
        projectName: `Acc Contract ${locale}`,
        storageDir: `/tmp/acc-contract-${locale}/bundle`,
        fileName: `acc-contract-${locale}.pflow`,
        templateId: 'saas_inventory',
        createdAt: '2026-11-21T00:00:00Z',
        updatedAt: '2026-11-21T00:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      });

      const accListSrc = payload.stateSnapshot.pageSources['acceptance-list'];
      assert.ok(accListSrc);
      assert.equal(accListSrc.includes('已驳回'), false, `acceptance-list (${locale}) must not write out-of-contract 已驳回`);
      assert.equal(accListSrc.includes('Rejected'), false, `acceptance-list (${locale}) must not reference out-of-contract Rejected`);

      const doc = parsePageSource(accListSrc).doc!;
      const dangerButtonsInApprove: string[] = [];
      walk(doc.root, (node) => {
        if (node.type === 'Modal' && node.props.id === 'm-approve') {
          walk(node, (sub) => {
            if (sub.type === 'Button' && sub.props.type === 'danger') {
              dangerButtonsInApprove.push(JSON.stringify(sub.props));
            }
          });
        }
      });
      assert.equal(dangerButtonsInApprove.length, 0, `acceptance-list (${locale}) m-approve must omit danger Reject button`);
    }

    // Non-approval two-state enum (草稿/已归档): must NOT guess positional pending/approved values or render m-approve
    const archiveTable: DBTableSchema = {
      id: 't_archive_doc',
      tableName: 't_archive_doc',
      cnName: '归档单据',
      domain: '档案域',
      description: '仅含草稿与已归档状态',
      sharedByMenus: [],
      columns: [
        { id: 'a1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '主键' },
        { id: 'a2', name: 'doc_title', dataType: 'VARCHAR(64)', nullable: false, comment: '标题' },
        { id: 'a3', name: 'status', dataType: 'VARCHAR(24)', nullable: false, comment: '状态 (草稿/已归档)' },
      ],
    };
    const archiveSrc = generateListPageSource(archiveTable, [archiveTable], {
      pageId: 'archive-list',
      withStatusTabs: true,
      locale: 'zh-CN',
    });
    assert.equal(archiveSrc.includes('m-approve'), false, 'Non-approval enum (草稿/已归档) must not fabricate m-approve');
    assert.equal(archiveSrc.includes('已驳回'), false);
    assert.equal(archiveSrc.includes('已通过'), false);
  } finally {
    cleanup();
  }
});

test('Round-2 [P1 #4]: foreign key options use only declared referenced column and stay empty when target table is empty', () => {
  const cleanup = installTestDom();
  try {
    setLocale('en-US');
    const blank = createProjectPayload({
      projectId: 'fk-strict-proj',
      projectName: 'FK Strict',
      storageDir: '/tmp/fk-strict/bundle',
      fileName: 'fk-strict.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(blank);

    const vendorTable: DBTableSchema = {
      id: 'vendor',
      tableName: 'vendor',
      cnName: 'Vendor',
      domain: 'MDM',
      description: 'Vendor master',
      sharedByMenus: [],
      columns: [
        { id: 'v1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' },
        { id: 'v2', name: 'vendor_code', dataType: 'VARCHAR(32)', nullable: true, comment: 'Vendor Code' },
        { id: 'v3', name: 'vendor_name', dataType: 'VARCHAR(128)', nullable: false, comment: 'Vendor Name' },
      ],
    };
    const orderTable: DBTableSchema = {
      id: 'orders',
      tableName: 'orders',
      cnName: 'Purchase Order',
      domain: 'Procurement',
      description: 'Orders referencing vendor(vendor_code)',
      sharedByMenus: [],
      columns: [
        { id: 'o1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' },
        {
          id: 'o2',
          name: 'supplier_id',
          dataType: 'VARCHAR(32)',
          nullable: false,
          isForeignKey: true,
          references: 'vendor(vendor_code)',
          comment: 'Supplier Code FK',
        },
      ],
    };

    const tables = [vendorTable, orderTable];
    useProtoStore.setState({ dbTables: tables });

    // Case 1: One row lacks vendor_code (only has id), one row has vendor_code
    usePageStore.setState({
      tableRows: {
        vendor: [
          { id: 'ROW-ID-MISSING-CODE', vendor_name: 'Missing Code Co.' },
          { id: 'ROW-ID-OK', vendor_code: 'VND-CODE-77', vendor_name: 'Valid Code Co.' },
        ],
      },
    });

    const formSrcWithPartial = generateFormPageSource(orderTable, { pageId: 'order-form', locale: 'en-US' }, tables);
    assert.equal(formSrcWithPartial.includes('ROW-ID-MISSING-CODE'), false, 'Must never fall back to row.id when vendor_code is missing');
    assert.ok(formSrcWithPartial.includes('VND-CODE-77'));

    const doc = parsePageSource(formSrcWithPartial).doc!;
    const FormHarness = () => {
      const rt = useRuntimeController(doc, 'order-form', false);
      return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(FormHarness));
    });

    const getMountedSupplierOptions = () => {
      const ctrl = renderer.root.findAllByType(AntdFieldControl).find((c) => c.props.def.name === 'supplier_id')!;
      return materialOptions(ctrl.props.def.options);
    };
    assert.deepEqual(getMountedSupplierOptions(), [{ label: 'Valid Code Co.', value: 'VND-CODE-77' }]);

    // Case 2: Clear target table -> both live mounted Form AND newly generated Form must have empty options (never SUP-01..SUP-04)
    act(() => {
      usePageStore.setState({ tableRows: { vendor: [] } });
    });
    assert.deepEqual(getMountedSupplierOptions(), [], 'Emptying target table must leave live dropdown options empty');

    const formSrcWhenEmpty = generateFormPageSource(orderTable, { pageId: 'order-form-empty', locale: 'en-US' }, tables);
    assert.equal(formSrcWhenEmpty.includes('SUP-01'), false, 'Empty target table must never fall back to SUP-01..SUP-04');
    const emptyDoc = parsePageSource(formSrcWhenEmpty).doc!;
    let emptyFields: Array<Record<string, unknown>> = [];
    walk(emptyDoc.root, (n) => {
      if (n.pfId === 'form-main' && Array.isArray(n.props.fields)) {
        emptyFields = n.props.fields as Array<Record<string, unknown>>;
      }
    });
    assert.deepEqual(materialOptions(emptyFields.find((f) => f.name === 'supplier_id')?.options), []);

    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});

test('Round-2 [P2 #1]: acceptance supplier dropdown excludes pending suppliers and updates live when suppliers are approved or rejected', () => {
  const cleanup = installTestDom();
  try {
    setLocale('en-US');
    const payload = createProjectPayload({
      projectId: 'live-qualified-suppliers',
      projectName: 'Live Qualified Suppliers',
      storageDir: '/tmp/live-qual/bundle',
      fileName: 'live-qual.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(payload);

    const accNewDoc = parsePageSource(usePageStore.getState().pageSources['acceptance-new']).doc!;
    const AccHarness = () => {
      const rt = useRuntimeController(accNewDoc, 'acceptance-new', false);
      return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: accNewDoc.root }));
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(AccHarness));
    });

    const getSupplierDropdownValues = () => {
      const ctrl = renderer.root.findAllByType(AntdFieldControl).find((c) => c.props.def.name === 'supplier_id')!;
      return materialOptions(ctrl.props.def.options).map((o) => o.value);
    };

    // Initially SUP-01 & SUP-02 are qualified; SUP-03 & SUP-04 are pending and must NOT be selectable
    assert.deepEqual(getSupplierDropdownValues(), ['SUP-01', 'SUP-02']);

    // Approve SUP-03 in supplier table -> immediately appears in acceptance-new without regenerating the page
    act(() => {
      usePageStore.getState().getRows('t_base_supplier');
      usePageStore.getState().updateRow('t_base_supplier', 'SUP-03', { status: 'qualified' });
    });
    assert.deepEqual(getSupplierDropdownValues(), ['SUP-01', 'SUP-02', 'SUP-03']);

    // Reject SUP-01 -> immediately removed from acceptance-new dropdown
    act(() => {
      usePageStore.getState().updateRow('t_base_supplier', 'SUP-01', { status: 'rejected' });
    });
    assert.deepEqual(getSupplierDropdownValues(), ['SUP-02', 'SUP-03']);

    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});

test('Round-2 [P2 #2]: dragging palette materials or composite blocks in zh-CN vs en-US preserves identical underlying business values', () => {
  const cleanup = installTestDom();
  try {
    const allComps = [...COMPONENTS, ...MOBILE_COMPONENTS];
    for (const name of ['Select', 'Radio', 'Cascader', 'TreeSelect', 'AutoComplete', 'Segmented', 'MSheetPicker', 'MChipSelect']) {
      const base = allComps.find((c) => c.name === name)!;
      const zhNode = parseSnippetNode(localizeComponentMeta(base, 'zh-CN').snippet)!;
      const enNode = parseSnippetNode(localizeComponentMeta(base, 'en-US').snippet)!;
      const zhOpts = materialOptions(zhNode.props.options, name === 'Cascader' || name === 'TreeSelect');
      const enOpts = materialOptions(enNode.props.options, name === 'Cascader' || name === 'TreeSelect');
      assert.deepEqual(
        enOpts.map((o) => o.value),
        zhOpts.map((o) => o.value),
        `${name} snippet must submit identical option values in en-US and zh-CN`,
      );
      if (name === 'Select') {
        assert.deepEqual(enOpts, [
          { label: 'Enabled', value: '启用' },
          { label: 'Disabled', value: '停用' },
        ]);
      }
    }

    // QueryForm status options & MPillTabs items also preserve identical values (including '' for All/全部)
    const qfZh = parseSnippetNode(localizeComponentMeta(COMPONENT_MAP.QueryForm, 'zh-CN').snippet)!;
    const qfEn = parseSnippetNode(localizeComponentMeta(COMPONENT_MAP.QueryForm, 'en-US').snippet)!;
    const qfZhStatus = (qfZh.props.fields as Array<Record<string, unknown>>).find((f) => f.name === 'status')!;
    const qfEnStatus = (qfEn.props.fields as Array<Record<string, unknown>>).find((f) => f.name === 'status')!;
    assert.deepEqual(
      materialOptions(qfEnStatus.options).map((o) => o.value),
      ['', '启用', '停用'],
    );
    assert.deepEqual(
      materialOptions(qfEnStatus.options).map((o) => o.value),
      materialOptions(qfZhStatus.options).map((o) => o.value),
    );

    const blocks = usePageStore.getState().compositeBlocks.filter((b) => b.isBuiltin);
    for (const blk of blocks) {
      const zhDoc = parsePageSource(`export default function Page() { return <Page>${localizeCompositeBlock(blk, 'zh-CN').tsxSnippet}</Page>; }`).doc;
      const enDoc = parsePageSource(`export default function Page() { return <Page>${localizeCompositeBlock(blk, 'en-US').tsxSnippet}</Page>; }`).doc;
      if (!zhDoc || !enDoc) continue;
      const collectOptionValues = (root: import('../src/proto/types').ProtoNode) => {
        const res: Array<Array<string | number>> = [];
        walk(root, (n) => {
          if (n.props.options !== undefined) {
            res.push(materialOptions(n.props.options).map((o) => o.value));
          }
        });
        return res;
      };
      assert.deepEqual(
        collectOptionValues(enDoc.root),
        collectOptionValues(zhDoc.root),
        `Composite block ${blk.id} must preserve identical option values across languages`,
      );
    }
  } finally {
    cleanup();
  }
});

test('Round-2 [P2 #3]: already-mounted Hermes dashboard UI updates its displayed language live when synced from main process', async () => {
  const cleanup = installTestDom();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildHermesLocaleSyncScript } = require('../electron/hermes-management.cjs');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    window.localStorage.setItem('hermes-locale', 'zh');

    // Exact reproduction of locked Hermes v0.23.1 web/src/i18n/context.tsx + LanguageSwitcher.tsx
    // (reads localStorage only once in useState initializer, updates via LanguageSwitcher option click)
    const LOCALES = {
      en: { name: 'English', navChat: 'Chat', switchTo: 'Language' },
      zh: { name: '简体中文', navChat: '对话', switchTo: '切换语言' },
    } as const;
    type HermesLang = keyof typeof LOCALES;

    const HermesCtx = React.createContext<{
      locale: HermesLang;
      setLocale: (code: HermesLang) => void;
    }>({ locale: 'zh', setLocale: () => {} });

    const LockedHermesDashboardMock: React.FC = () => {
      const [locale, setLocaleState] = React.useState<HermesLang>(() => {
        const stored = window.localStorage.getItem('hermes-locale');
        return stored === 'en' ? 'en' : 'zh';
      });
      const [open, setOpen] = React.useState(false);
      React.useEffect(() => {
        document.documentElement.lang = locale;
      }, [locale]);
      const setLocale = React.useCallback((code: HermesLang) => {
        setLocaleState(code);
        window.localStorage.setItem('hermes-locale', code);
        document.documentElement.lang = code;
      }, []);
      const t = LOCALES[locale];
      return React.createElement(
        HermesCtx.Provider,
        { value: { locale, setLocale } },
        React.createElement(
          'div',
          { 'data-testid': 'hermes-shell' },
          React.createElement('h1', { 'data-testid': 'hermes-nav-title' }, t.navChat),
          React.createElement(
            'button',
            {
              type: 'button',
              title: t.switchTo,
              'aria-label': t.switchTo,
              'aria-haspopup': 'listbox',
              'aria-expanded': open,
              onClick: () => setOpen((v) => !v),
            },
            locale === 'en' ? 'EN' : t.name,
          ),
          open
            ? React.createElement(
                'div',
                { role: 'listbox', 'aria-label': t.switchTo },
                (Object.entries(LOCALES) as Array<[HermesLang, (typeof LOCALES)[HermesLang]]>).map(([code, meta]) =>
                  React.createElement(
                    'button',
                    {
                      key: code,
                      type: 'button',
                      role: 'option',
                      'aria-selected': code === locale,
                      onClick: () => {
                        setLocale(code);
                        setOpen(false);
                      },
                    },
                    React.createElement('span', null, meta.name),
                  ),
                ),
              )
            : null,
        ),
      );
    };

    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    await domAct(async () => {
      root.render(React.createElement(LockedHermesDashboardMock));
    });

    assert.equal(document.documentElement.lang, 'zh');
    assert.equal(container.querySelector('[data-testid="hermes-nav-title"]')?.textContent, '对话');
    assert.equal(container.querySelector('button[aria-haspopup="listbox"]')?.textContent, '简体中文');

    // Execute main-process sync script for en-US on the already-mounted page (outside act, matching Electron executeJavaScript)
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
    const resEn = (await (0, eval)(buildHermesLocaleSyncScript('en-US'))) as { synced: boolean; method: string; lang: string };
    assert.equal(resEn?.synced, true);
    assert.equal(resEn?.method, 'switcher');
    assert.equal(window.localStorage.getItem('hermes-locale'), 'en');
    assert.equal(document.documentElement.lang, 'en');
    assert.equal(container.querySelector('[data-testid="hermes-nav-title"]')?.textContent, 'Chat');
    assert.equal(container.querySelector('button[aria-haspopup="listbox"]')?.textContent, 'EN');
    assert.equal(container.querySelector('[role="listbox"]'), null, 'Dropdown should close cleanly after selection');

    // Switch back to zh-CN -> mounted page updates back to Chinese live
    const resZh = (await (0, eval)(buildHermesLocaleSyncScript('zh-CN'))) as { synced: boolean; method: string; lang: string };
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    assert.equal(resZh?.synced, true);
    assert.equal(resZh?.method, 'switcher');
    assert.equal(window.localStorage.getItem('hermes-locale'), 'zh');
    assert.equal(document.documentElement.lang, 'zh');
    assert.equal(container.querySelector('[data-testid="hermes-nav-title"]')?.textContent, '对话');
    assert.equal(container.querySelector('button[aria-haspopup="listbox"]')?.textContent, '简体中文');
  } finally {
    await domAct(async () => {
      root.unmount();
    });
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    container.remove();
    cleanup();
  }
});

test('Round-2 [P2 #4]: searching "All" or "全部" in a text field filters matching rows while explicit empty-value option clears filter', () => {
  const cleanup = installTestDom();
  try {
    setLocale('en-US');
    const blank = createProjectPayload({
      projectId: 'search-all-check',
      projectName: 'Search All Check',
      storageDir: '/tmp/search-all/bundle',
      fileName: 'search-all.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(blank);

    const traderTable: DBTableSchema = {
      id: 't_traders',
      tableName: 't_traders',
      cnName: 'Trading Partners',
      domain: 'CRM',
      description: 'Partners',
      sharedByMenus: [],
      columns: [
        { id: 't1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' },
        { id: 't2', name: 'name', dataType: 'VARCHAR(128)', nullable: false, comment: 'Partner Name' },
        { id: 't3', name: 'status', dataType: 'VARCHAR(24)', nullable: false, comment: 'Status (Enabled/Disabled)' },
      ],
    };
    useProtoStore.setState({ dbTables: [traderTable] });
    usePageStore.setState({
      tableRows: {
        t_traders: [
          { id: 'TR-1', name: 'All Trading', status: 'Enabled' },
          { id: 'TR-2', name: 'Other Trading', status: 'Enabled' },
        ],
      },
    });

    // Direct model verification for both 'All' and '全部'
    const rows = usePageStore.getState().getRows('t_traders');
    const matchAllEn = visibleTableRows(prepareTableRows(rows, {}, { name: 'All' }, null).roots, () => false).map(
      (r) => r.row.name,
    );
    assert.deepEqual(matchAllEn, ['All Trading'], 'Searching "All" must return only rows matching "All"');

    const zhRows = [
      { id: 'Z-1', name: '全部供应链有限公司', status: '启用' },
      { id: 'Z-2', name: '其他贸易有限公司', status: '启用' },
    ];
    const matchAllZh = visibleTableRows(prepareTableRows(zhRows, {}, { name: '全部' }, null).roots, () => false).map(
      (r) => r.row.name,
    );
    assert.deepEqual(matchAllZh, ['全部供应链有限公司'], 'Searching "全部" must return only rows matching "全部"');

    // Full UI QueryForm + Table verification: text search "All" vs status dropdown "All" (value: '')
    const listSrc = generateListPageSource(traderTable, [traderTable], {
      pageId: 'trader-list',
      withStatusTabs: false,
      locale: 'en-US',
    });
    const doc = parsePageSource(listSrc).doc!;
    const PageHarness = () => {
      const rt = useRuntimeController(doc, 'trader-list', false);
      return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(PageHarness));
    });

    const nameInput = renderer.root.findAllByType(AntdFieldControl).find((c) => c.props.def.name === 'name')!;
    const statusSelect = renderer.root.findAllByType(AntdFieldControl).find((c) => c.props.def.name === 'status')!;
    const searchBtn = renderer.root.findAll(
      (n) => n.type === 'button' && collectText(n).trim() === 'Search',
    )[0]!;

    // Status dropdown's "All" option uses explicit empty clear value ''
    const statusOpts = materialOptions(statusSelect.props.def.options);
    assert.equal(statusOpts[0]?.label, 'All');
    assert.equal(statusOpts[0]?.value, '');

    // Enter "All" in Name input and click Search -> only "All Trading" remains visible
    act(() => {
      nameInput.props.onChange('All');
    });
    act(() => {
      searchBtn.props.onClick();
    });
    const renderedAfterAllSearch = collectText(renderer.root);
    assert.ok(renderedAfterAllSearch.includes('All Trading'));
    assert.equal(renderedAfterAllSearch.includes('Other Trading'), false, 'Other Trading must be filtered out when searching "All"');

    // Clear Name input and select Status = "All" (value: '') -> both records return
    act(() => {
      nameInput.props.onChange('');
      statusSelect.props.onChange('');
    });
    act(() => {
      searchBtn.props.onClick();
    });
    const renderedAfterClear = collectText(renderer.root);
    assert.ok(renderedAfterClear.includes('All Trading') && renderedAfterClear.includes('Other Trading'));

    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});


test('Round-3 [P1 #1]: generic work-order table with pending/approved rows never injects supplier-only qualified state', async () => {
  const cleanup = installTestDom();
  try {
    setLocale('en-US');
    const blank = createProjectPayload({
      projectId: 'work-order-status',
      projectName: 'Work Order Check',
      storageDir: '/tmp/wo-status/bundle',
      fileName: 'wo-status.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(blank);

    const workOrderTable: DBTableSchema = {
      id: 't_work_order',
      tableName: 't_work_order',
      cnName: 'Work Order',
      domain: 'Ops',
      description: 'Generic approval work orders',
      sharedByMenus: [],
      columns: [
        { id: 'w1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' },
        { id: 'w2', name: 'order_no', dataType: 'VARCHAR(32)', nullable: false, comment: 'Order No.' },
        { id: 'w3', name: 'status', dataType: 'VARCHAR(24)', nullable: false, comment: 'Workflow status' },
      ],
    };
    useProtoStore.setState({ dbTables: [workOrderTable] });
    usePageStore.setState({
      tableRows: {
        t_work_order: [
          { id: 'WO-1', order_no: 'WO-2026-01', status: 'pending' },
          { id: 'WO-2', order_no: 'WO-2026-02', status: 'approved' },
        ],
      },
    });

    const listSrc = generateListPageSource(workOrderTable, [workOrderTable], {
      pageId: 'wo-list',
      withStatusTabs: true,
      locale: 'en-US',
    });
    assert.equal(listSrc.includes('qualified'), false, 'Generic work-order list must not contain supplier-only qualified status');

    const doc = parsePageSource(listSrc).doc!;
    let approvedFilter: Record<string, unknown> | undefined;
    let approveModalNode: import('../src/proto/types').ProtoNode | undefined;
    let submitAction: unknown;
    walk(doc.root, (node) => {
      if (node.pfId === 'tbl-approved') approvedFilter = node.props.filter as Record<string, unknown>;
      if (node.type === 'Modal' && node.props.id === 'm-approve') {
        approveModalNode = node;
        walk(node, (sub) => {
          if (sub.type === 'Button' && sub.props.type === 'primary') submitAction = sub.props.onClick;
        });
      }
    });

    assert.deepEqual(approvedFilter, { status: 'approved' });
    const rows = usePageStore.getState().getRows('t_work_order');
    const approvedTabRows = visibleTableRows(prepareTableRows(rows, { filter: approvedFilter }, {}, null).roots, () => false);
    assert.deepEqual(approvedTabRows.map((r) => r.row.id), ['WO-2'], 'Existing approved row must appear in Approved tab');

    let rt!: Runtime;
    const wo1 = rows.find((r) => r.id === 'WO-1')!;
    const Harness = () => {
      rt = useRuntimeController(doc, 'wo-list', false);
      return React.createElement(
        RuntimeProvider,
        { value: rt },
        React.createElement(
          ScopeProvider,
          { value: { tableId: 't_work_order', row: wo1 } },
          React.createElement(NodeView, { node: approveModalNode!, live: true }),
        ),
      );
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });
    const decisionCtrl = renderer.root.findAllByType(AntdFieldControl).find((c) => c.props.def.name === 'decision')!;
    const approveOpt = materialOptions(decisionCtrl.props.def.options).find((o) => o.label === 'Approve')!;
    assert.equal(approveOpt.value, 'approved');
    act(() => {
      decisionCtrl.props.onChange(approveOpt.value);
    });
    await act(async () => {
      await rt.run(submitAction as import('../src/proto/types').PropValue, { tableId: 't_work_order', row: wo1 });
    });
    assert.equal(usePageStore.getState().getRows('t_work_order').find((r) => r.id === 'WO-1')?.status, 'approved');
    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});

test('Round-3 [P1 #2]: submitting an acceptance form after the selected supplier becomes rejected blocks write and requires reselection', async () => {
  const cleanup = installTestDom();
  try {
    setLocale('en-US');
    const payload = createProjectPayload({
      projectId: 'stale-supplier-guard',
      projectName: 'Stale Supplier Guard',
      storageDir: '/tmp/stale-sup/bundle',
      fileName: 'stale-sup.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(payload);

    const doc = parsePageSource(usePageStore.getState().pageSources['acceptance-new']).doc!;
    let submitBtnAction: unknown;
    walk(doc.root, (n) => {
      if (n.pfId === 'btn-submit-acceptance') submitBtnAction = n.props.onClick;
    });

    let rt!: Runtime;
    const Harness = () => {
      rt = useRuntimeController(doc, 'acceptance-new', false);
      return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });

    // 1. User selects qualified SUP-01 first
    act(() => {
      rt.setFormValues('field-supplier-select', {
        acceptance_no: 'DHY-2026-STALE',
        acceptance_date: '2026-11-21',
        inbound_type: '购买',
        source_type: '采购订单转入',
        supplier_id: 'SUP-01',
        total_amount_tax_included: 200,
        status: '草稿',
      });
    });

    // 2. SUP-01 is subsequently rejected before submission
    const beforeCount = usePageStore.getState().getRows('t_wms_acceptance_order').length;
    act(() => {
      usePageStore.getState().getRows('t_base_supplier');
      usePageStore.getState().updateRow('t_base_supplier', 'SUP-01', { status: 'rejected' });
    });

    // 3. Clicking Submit must fail validation, clear stale SUP-01, and NOT insert row
    await act(async () => {
      await rt.run(submitBtnAction as import('../src/proto/types').PropValue, {});
    });
    const afterRejectedAttempt = usePageStore.getState().getRows('t_wms_acceptance_order');
    assert.equal(afterRejectedAttempt.length, beforeCount, 'Must not save acceptance order with rejected SUP-01');
    assert.equal(rt.formValues['field-supplier-select']?.supplier_id, undefined, 'Stale rejected supplier_id should be cleared for reselection');
    assert.ok(rt.formErrors['field-supplier-select']?.supplier_id, 'Expected field error on supplier_id');

    // 4. Reselecting qualified SUP-02 allows submission to succeed
    act(() => {
      rt.setFormValue('field-supplier-select', 'supplier_id', 'SUP-02');
    });
    await act(async () => {
      await rt.run(submitBtnAction as import('../src/proto/types').PropValue, {});
    });
    const afterValidSubmit = usePageStore.getState().getRows('t_wms_acceptance_order');
    assert.equal(afterValidSubmit.length, beforeCount + 1);
    assert.equal(afterValidSubmit[0]?.supplier_id, 'SUP-02');

    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});

test('Round-3 [P1 #3]: mobile acceptance form supplier picker excludes pending and rejected suppliers just like desktop', async () => {
  const cleanup = installTestDom();
  try {
    setLocale('en-US');
    const payload = createProjectPayload({
      projectId: 'mobile-acc-qualified',
      projectName: 'Mobile Acceptance Qualified',
      storageDir: '/tmp/mob-acc-qual/bundle',
      fileName: 'mob-acc-qual.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(payload);

    // Reject SUP-01 so SUP-01 is rejected, SUP-02 is qualified, SUP-03 & SUP-04 are pending
    usePageStore.getState().getRows('t_base_supplier');
    usePageStore.getState().updateRow('t_base_supplier', 'SUP-01', { status: 'rejected' });

    const tables = useProtoStore.getState().dbTables;
    const accTable = tables.find((t) => t.id === 't_wms_acceptance_order')!;
    const mobSrc = generateFromTemplate(
      'mobile_form',
      accTable,
      tables,
      { pageId: 'mob-acc-form', title: 'Mobile Receipt', platform: 'mobile', locale: 'en-US' },
      'en-US',
    );
    const mobDoc = parsePageSource(mobSrc).doc!;

    const MobHarness = () => {
      const rt = useRuntimeController(mobDoc, 'mob-acc-form', false);
      return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: mobDoc.root, live: true }));
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(MobHarness));
    });

    // Open the supplier MSheetPicker bottom sheet
    let supplierPickerPfId = '';
    walk(mobDoc.root, (n) => {
      if (n.type === 'MSheetPicker' && n.props.name === 'supplier_id') supplierPickerPfId = n.pfId;
    });
    assert.ok(supplierPickerPfId, 'Expected MSheetPicker bound to supplier_id');
    const pickerWrapper = renderer.root.find((n) => n.props?.['data-pf-id'] === supplierPickerPfId);
    const pickerTrigger = pickerWrapper.findAllByType('button')[0]!;
    assert.ok(pickerTrigger, 'Expected supplier MSheetPicker trigger button');
    act(() => {
      pickerTrigger.props.onClick();
    });

    const dialog = renderer.root.find((n) => n.props?.role === 'dialog');
    const dialogText = collectText(dialog);
    assert.ok(dialogText.includes('StarSea Optoelectronics Inc.'), 'Qualified SUP-02 must be listed in mobile picker');
    assert.equal(dialogText.includes('Aurora Smart Digital Ltd.'), false, 'Rejected SUP-01 must NOT be listed in mobile picker');
    assert.equal(dialogText.includes('CloudAtlas Precision Parts Co.'), false, 'Pending SUP-03 must NOT be listed in mobile picker');
    assert.equal(dialogText.includes('GreenForest Eco Packaging Co.'), false, 'Pending SUP-04 must NOT be listed in mobile picker');

    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});

test('Round-3 [P1 #4]: newly created hybrid project populates qualified suppliers on first open in both zh-CN and en-US', () => {
  const cleanup = installTestDom();
  try {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      setLocale(locale);
      const hybridPayload = createProjectPayload({
        projectId: `hybrid-first-open-${locale}`,
        projectName: `Hybrid ${locale}`,
        storageDir: `/tmp/hybrid-${locale}/bundle`,
        fileName: `hybrid-${locale}.pflow`,
        templateId: 'mobile_starter',
        projectMode: 'hybrid',
        createdAt: '2026-11-21T00:00:00Z',
        updatedAt: '2026-11-21T00:00:00Z',
        pageCount: 0,
        tableCount: 0,
        stickyCount: 0,
      });
      loadProjectFromBinaryPayload(hybridPayload);

      const accNewSrc = usePageStore.getState().pageSources['acceptance-new'];
      assert.ok(accNewSrc, `Hybrid project (${locale}) must include acceptance-new`);
      const doc = parsePageSource(accNewSrc).doc!;

      const HybridHarness = () => {
        const rt = useRuntimeController(doc, 'acceptance-new', false);
        return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
      };
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(React.createElement(HybridHarness));
      });

      const supCtrl = renderer.root.findAllByType(AntdFieldControl).find((c) => c.props.def.name === 'supplier_id')!;
      const values = materialOptions(supCtrl.props.def.options).map((o) => o.value);
      assert.deepEqual(
        values,
        ['SUP-01', 'SUP-02'],
        `Hybrid project (${locale}) acceptance-new must offer qualified suppliers SUP-01 & SUP-02 on first open`,
      );

      act(() => renderer.unmount());
    }
  } finally {
    cleanup();
  }
});

test('Round-3 [P2 #1 & P2 #2]: qualifiedOnly rejects rows missing status and foreign key options preserve exact trailing-space values', () => {
  // [P2 #1] Missing status in qualifiedOnly mode must be excluded
  const rowsWithMissingStatus = [
    { id: 'SUP-NO-ST', supplier_name: 'Missing Status Supplier' },
    { id: 'SUP-EMPTY-ST', supplier_name: 'Empty Status Supplier', status: '' },
    { id: 'SUP-PENDING', supplier_name: 'Pending Supplier', status: 'pending' },
    { id: 'SUP-QUAL', supplier_name: 'Qualified Supplier', status: 'qualified' },
  ];
  const qualifiedOpts = buildForeignKeyOptionsFromRows(rowsWithMissingStatus, 'id', 'supplier_name', {
    qualifiedOnly: true,
    locale: 'en-US',
  });
  assert.deepEqual(qualifiedOpts, [{ label: 'Qualified Supplier', value: 'SUP-QUAL' }]);

  // [P2 #2] Trailing space in referenced valueCol is preserved verbatim while blank-only strings are skipped
  const rowsWithSpaces = [
    { id: '1', vendor_code: '   ', vendor_name: 'Blank Code' },
    { id: '2', vendor_code: 'VND-100 ', vendor_name: 'Trailing Space Vendor' },
    { id: '3', vendor_code: 'VND-100 ', vendor_name: 'Duplicate Trailing Space' },
    { id: '4', vendor_code: 'VND-100', vendor_name: 'Trimmed Distinct Vendor' },
  ];
  const fkOpts = buildForeignKeyOptionsFromRows(rowsWithSpaces, 'vendor_code', 'vendor_name', {
    qualifiedOnly: false,
    locale: 'en-US',
  });
  assert.deepEqual(fkOpts, [
    { label: 'Trailing Space Vendor', value: 'VND-100 ' },
    { label: 'Trimmed Distinct Vendor', value: 'VND-100' },
  ]);
});

test('Round-3 [P2 #3]: single form placeholder in updateRow preserves numeric type while mixed text interpolates to string', async () => {
  const cleanup = installTestDom();
  try {
    setLocale('en-US');
    const payload = createProjectPayload({
      projectId: 'numeric-placeholder',
      projectName: 'Numeric Placeholder',
      storageDir: '/tmp/num-ph/bundle',
      fileName: 'num-ph.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(payload);

    usePageStore.setState({
      tableRows: {
        t_wms_acceptance_order: [
          {
            id: 'ACC-NUM-1',
            acceptance_no: 'DHY-NUM-001',
            acceptance_date: '2026-11-21',
            inbound_type: '购买',
            source_type: '采购订单转入',
            supplier_id: 'SUP-01',
            total_amount_tax_included: 0,
            status: '草稿',
          },
        ],
      },
    });

    const pageTsx = `export default function Page() {
      return (
        <Page title="Amount Patch">
          <Form pfId="f" cols={1}>
            <NumberInput pfId="amt" label="Amount" name="amount" precision={2} />
          </Form>
          <Button pfId="btn-patch" onClick={() => updateRow({ total_amount_tax_included: '{{form.f.amount}}', acceptance_no: 'AMT-{{form.f.amount}}' })}>Apply</Button>
        </Page>
      );
    }`;
    const doc = parsePageSource(pageTsx).doc!;
    let patchAction: unknown;
    walk(doc.root, (n) => {
      if (n.pfId === 'btn-patch') patchAction = n.props.onClick;
    });

    let rt!: Runtime;
    const row = usePageStore.getState().getRows('t_wms_acceptance_order')[0]!;
    const Harness = () => {
      rt = useRuntimeController(doc, 'amount-patch', false);
      return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });

    const numCtrl = renderer.root.findByType(AntdFieldControl);
    act(() => {
      numCtrl.props.onChange(42);
    });
    await act(async () => {
      await rt.run(patchAction as import('../src/proto/types').PropValue, {
        tableId: 't_wms_acceptance_order',
        row,
      });
    });

    const updated = usePageStore.getState().getRows('t_wms_acceptance_order')[0]!;
    assert.strictEqual(updated.total_amount_tax_included, 42);
    assert.equal(typeof updated.total_amount_tax_included, 'number');
    assert.strictEqual(updated.acceptance_no, 'AMT-42');

    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});

test('Round-3 [P2 #4]: reloaded legacy QueryForm with "全部,启用,停用" clears filter on selecting "全部" while text search "All" still filters', () => {
  const cleanup = installTestDom();
  try {
    setLocale('zh-CN');
    const legacyPayload = createProjectPayload({
      projectId: 'legacy-query-all',
      projectName: '旧查询兼容',
      storageDir: '/tmp/legacy-query/bundle',
      fileName: 'legacy-query.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    legacyPayload.stateSnapshot.dbTables = [
      {
        id: 't_legacy_items',
        tableName: 't_legacy_items',
        cnName: '历史项目表',
        domain: '基础域',
        description: '测试旧版查询控件',
        sharedByMenus: [],
        columns: [
          { id: 'c1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '主键' },
          { id: 'c2', name: 'keyword', dataType: 'VARCHAR(64)', nullable: false, comment: '名称' },
          { id: 'c3', name: 'status', dataType: 'VARCHAR(24)', nullable: false, comment: '状态' },
        ],
      },
    ];
    legacyPayload.stateSnapshot.tableRows = {
      t_legacy_items: [
        { id: 'L-1', keyword: 'All Trading', status: '启用' },
        { id: 'L-2', keyword: 'Other Trading', status: '停用' },
      ],
    };
    legacyPayload.stateSnapshot.designerFolders = [{ id: 'f-legacy', title: '业务', parentFolderId: null }];
    legacyPayload.stateSnapshot.designerPages = [{ pageId: 'legacy-page', title: '旧列表', folderId: 'f-legacy' }];
    legacyPayload.stateSnapshot.pageSources = {
      'legacy-page': `export default function Page() {
        return (
          <Page title="旧列表">
            <QueryForm target="tbl-legacy" fields={[{ name: 'keyword', label: '关键字' }, { name: 'status', label: '状态', type: 'select', options: '全部,启用,停用' }]} />
            <Table pfId="tbl-legacy" table="t_legacy_items" />
          </Page>
        );
      }`,
    };
    legacyPayload.stateSnapshot.activePageId = 'legacy-page';
    loadProjectFromBinaryPayload(legacyPayload);

    const doc = parsePageSource(usePageStore.getState().pageSources['legacy-page']).doc!;
    const Harness = () => {
      const rt = useRuntimeController(doc, 'legacy-page', false);
      return React.createElement(RuntimeProvider, { value: rt }, React.createElement(NodeView, { node: doc.root }));
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });

    const keywordCtrl = renderer.root.findAllByType(AntdFieldControl).find((c) => c.props.def.name === 'keyword')!;
    const statusCtrl = renderer.root.findAllByType(AntdFieldControl).find((c) => c.props.def.name === 'status')!;
    const searchBtn = renderer.root.findAll((n) => n.type === 'button' && collectText(n).trim() === '查询')[0]!;

    // Normalized option for '全部' has value: ''
    const normalizedOpts = materialOptions(statusCtrl.props.def.options);
    assert.deepEqual(normalizedOpts, [
      { label: '全部', value: '' },
      { label: '启用', value: '启用' },
      { label: '停用', value: '停用' },
    ]);

    // Filter by '启用' -> only L-1 shown
    act(() => statusCtrl.props.onChange('启用'));
    act(() => searchBtn.props.onClick());
    assert.ok(collectText(renderer.root).includes('All Trading'));
    assert.equal(collectText(renderer.root).includes('Other Trading'), false);

    // Select '全部' (test both '' from UI option AND '全部' token) -> BOTH L-1 and L-2 return (never 0 rows)
    act(() => statusCtrl.props.onChange('全部'));
    act(() => searchBtn.props.onClick());
    assert.ok(collectText(renderer.root).includes('All Trading'));
    assert.ok(collectText(renderer.root).includes('Other Trading'));

    // Text search for 'All' in keyword input still filters to 'All Trading' only
    act(() => keywordCtrl.props.onChange('All'));
    act(() => searchBtn.props.onClick());
    assert.ok(collectText(renderer.root).includes('All Trading'));
    assert.equal(collectText(renderer.root).includes('Other Trading'), false);

    act(() => renderer.unmount());
  } finally {
    cleanup();
  }
});

test('Round-3 [P2 #5 & P2 #6]: preview rows follow declared column enums so Pending tabs match in both locales, and QC standard code GB/T 2828.1-2012 stays consistent', () => {
  const cleanup = installTestDom();
  try {
    // [P2 #5] Declared pending/approved/rejected enum in column comment
    const enumTable: DBTableSchema = {
      id: 't_ticket_review',
      tableName: 't_ticket_review',
      cnName: '工单审批表',
      domain: '运维域',
      description: '工单审批',
      sharedByMenus: [],
      columns: [
        { id: 'e1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '主键' },
        { id: 'e2', name: 'ticket_no', dataType: 'VARCHAR(32)', nullable: false, comment: '工单号' },
        {
          id: 'e3',
          name: 'status',
          dataType: 'VARCHAR(24)',
          nullable: false,
          defaultValue: "'pending'",
          comment: '审批状态 (pending/approved/rejected)',
        },
      ],
    };

    for (const locale of ['zh-CN', 'en-US'] as const) {
      setLocale(locale);
      const previewRows = generatePreviewRows(enumTable, locale);
      assert.ok(
        previewRows.every((r) => ['pending', 'approved', 'rejected'].includes(String(r.status))),
        `Preview rows in ${locale} must use declared enum values, got: ${JSON.stringify(previewRows.map((r) => r.status))}`,
      );

      const listSrc = generateListPageSource(enumTable, [enumTable], {
        pageId: `ticket-${locale}`,
        withStatusTabs: true,
        locale,
      });
      const doc = parsePageSource(listSrc).doc!;
      let pendingFilter: Record<string, unknown> | undefined;
      let approvedFilter: Record<string, unknown> | undefined;
      walk(doc.root, (n) => {
        if (n.pfId === 'tbl-pending') pendingFilter = n.props.filter as Record<string, unknown>;
        if (n.pfId === 'tbl-approved') approvedFilter = n.props.filter as Record<string, unknown>;
      });
      assert.deepEqual(pendingFilter, { status: 'pending' });
      assert.deepEqual(approvedFilter, { status: 'approved' });

      const matchedPending = visibleTableRows(prepareTableRows(previewRows, { filter: pendingFilter }, {}, null).roots, () => false);
      const matchedApproved = visibleTableRows(prepareTableRows(previewRows, { filter: approvedFilter }, {}, null).roots, () => false);
      assert.ok(matchedPending.length > 0, `Pending tab in ${locale} must match generated preview rows`);
      assert.ok(matchedApproved.length > 0, `Approved tab in ${locale} must match generated preview rows`);
    }

    // [P2 #6] QC standard number GB/T 2828.1-2012 is identical across zh-CN and en-US starter templates
    setLocale('zh-CN');
    const zhSeed = createProjectPayload({
      projectId: 'qc-zh',
      projectName: 'QC ZH',
      storageDir: '/tmp/qc-zh/bundle',
      fileName: 'qc-zh.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    setLocale('en-US');
    const enSeed = createProjectPayload({
      projectId: 'qc-en',
      projectName: 'QC EN',
      storageDir: '/tmp/qc-en/bundle',
      fileName: 'qc-en.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-21T00:00:00Z',
      updatedAt: '2026-11-21T00:00:00Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    assert.ok(zhSeed.stateSnapshot.pageSources['acceptance-new'].includes('GB/T 2828.1-2012'));
    assert.ok(enSeed.stateSnapshot.pageSources['acceptance-new'].includes('GB/T 2828.1-2012'));
    assert.equal(enSeed.stateSnapshot.pageSources['acceptance-new'].includes('ISO 2859-1'), false);
  } finally {
    cleanup();
  }
});
