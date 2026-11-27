import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Ajv from 'ajv';
import type { PreviewSnapshot } from '../src/capture/snapshot';
import { projectPreviewContext } from '../src/mcp/capturePreview';
import { importAxureRp } from '../src/proto/axure/import';
import { parsePageSource } from '../src/proto/dsl/parser';
import { AUTHORING_MCP_TOOLS } from '../src/mcp/authoringCore';
import type { AuthoringWorkspace } from '../src/mcp/authoringTypes';
import { createLocalAuthoringWorkspace } from '../src/mcp/authoringWorkspace';
import { handleSpecMcpPayload } from '../src/mcp/protocol';
import { SPEC_MCP_TOOLS } from '../src/mcp/tools';
import { createLocalWorkspaceLoader, type WorkspaceLoader } from '../src/mcp/workspace';
import { createAxureProject } from '../src/services/axureProject';
import { verifyDependencyFootprint } from '../src/services/dependencyFootprint';
import { prepareProjectChanges } from '../src/services/hermesProject';
import type { HermesOperation } from '../src/services/hermesClient';
import { toolProgressLabel } from '../src/services/hermesProgress';
import { createProjectPayload } from '../src/services/projectStorage';
import { validateProjectPayload } from '../src/services/projectValidation';
import { encodePflowBinary } from '../src/utils/pflowBinaryCodec';

declare const require: NodeRequire;
const { createHermesPreviewBridge } = require(path.join(process.cwd(), 'electron/hermes-preview.cjs'));
const { atomicWrite, callTool, handleMcpFrame, tools: hermesMcpTools } = require(path.join(
  process.cwd(),
  'electron/protoflow-mcp.cjs',
));
const { createEmptyDependencyFootprint } = require(path.join(
  process.cwd(),
  'electron/generated/material-contract.cjs',
));

async function rpcCall(loader: WorkspaceLoader, method: string, params: Record<string, unknown> = {}, id = 1) {
  const res = await handleSpecMcpPayload(loader, { jsonrpc: '2.0', id, method, params });
  assert.ok(res && !Array.isArray(res));
  if (res.error) throw new Error(`RPC ${method} failed: ${res.error.message}`);
  return res.result as Record<string, unknown>;
}

async function callOk(loader: WorkspaceLoader, name: string, args: Record<string, unknown> = {}) {
  const res = (await rpcCall(loader, 'tools/call', { name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text?: string }[];
  };
  assert.notEqual(res.isError, true, `Tool ${name} failed: ${res.content?.[0]?.text}`);
  return JSON.parse(res.content[0].text!);
}

async function callErr(loader: WorkspaceLoader, name: string, args: Record<string, unknown> = {}) {
  const res = (await rpcCall(loader, 'tools/call', { name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text?: string }[];
  };
  assert.equal(res.isError, true, `Expected ${name} to fail`);
  return res.content[0]?.text ?? '';
}

test('Bidirectional MCP: Axure RP & Figma inspection, flow reshaping, coverage gates, and optimized-copy navigation retargeting', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-mcp-import-reshape-'));
  try {
    const imported = await importAxureRp(fs.readFileSync('tests/fixtures/axure9-editable-layout.rp'));
    const project = createAxureProject('warehouse.rp', tmpDir, imported);
    const rpSourceId = project.stateSnapshot.designerPages[0].pageId;
    const rpGuid = rpSourceId.slice('rp-page-'.length);
    const rpCopyId = `rp-optimized-${rpGuid}`;

    // Add a second RP page + its optimized copy AND a mobile Figma frame so we test both families & nav retargeting
    const siblingGuid = '11111111222222223333333344444444';
    const rpSiblingId = `rp-page-${siblingGuid}`;
    const rpSiblingCopyId = `rp-optimized-${siblingGuid}`;
    const folderId = project.stateSnapshot.designerPages[0].folderId;
    project.stateSnapshot.designerFolders.push({ id: 'fig-only', title: 'Figma', parentFolderId: folderId });
    project.stateSnapshot.designerPages.push(
      { pageId: rpSiblingId, title: '仓库详情原稿', folderId, platform: 'desktop' },
      { pageId: rpSiblingCopyId, title: '仓库详情（优化版）', folderId, platform: 'desktop' },
      { pageId: 'fig-page-a1b2c3d4', title: '移动盘点画板', folderId: 'fig-only', platform: 'mobile' },
    );
    project.stateSnapshot.pageSources[rpSiblingId] =
      `export default function Page() { return (<Page pfId="rp-root-sib"><AxureCanvas pfId="rp-canvas-${siblingGuid}" width={800} height={600}><Text pfId="sib-txt">详情</Text></AxureCanvas></Page>); }`;
    project.stateSnapshot.pageSources[rpSiblingCopyId] =
      `// @alex-axure-source ${rpSiblingId}\nexport default function Page() { return (<Page pfId="opt-sib-root" title="仓库详情（优化版）"><Button pfId="back" onClick={() => navigate("${rpSourceId}")}>返回列表</Button></Page>); }`;
    project.stateSnapshot.pageSources['fig-page-a1b2c3d4'] = [
      'export default function Page() {',
      '  return (',
      '    <MobilePage pfId="fig-root-1">',
      '      <FigmaCanvas pfId="fig-canvas-1" frameWidth={390} frameHeight={844} importNotes="Keep header CTA">',
      '        <FigmaFrame pfId="fig-header" label="TopHeader" layoutMode="HORIZONTAL" width={390} height={56}>',
      '          <FigmaText pfId="fig-title" text="移动盘点任务" />',
      '        </FigmaFrame>',
      '        <FigmaFrame pfId="fig-card-list" label="TaskList" layoutMode="VERTICAL" semanticRole="list" width={358} height={320}>',
      '          <FigmaText pfId="fig-item-1" text="单号 001 · 华东仓" />',
      '        </FigmaFrame>',
      '      </FigmaCanvas>',
      '    </MobilePage>',
      '  );',
      '}',
    ].join('\n');
    project.meta.projectMode = 'hybrid';

    const pflowPath = path.join(tmpDir, 'hybrid-imports.pflow');
    fs.writeFileSync(pflowPath, encodePflowBinary(project));

    // 1. Read-only SPEC MCP keeps 6 tools and supports importView="axure" / "figma" on protoflow_get_page_spec
    const roLoader = createLocalWorkspaceLoader(pflowPath);
    assert.equal(SPEC_MCP_TOOLS.length, 6);
    const rpSpec = await callOk(roLoader, 'protoflow_get_page_spec', {
      pageId: rpSourceId,
      includeSource: false,
      importView: 'axure',
      includeInspection: true,
      limit: 80,
    });
    assert.equal(rpSpec.importInspection.sourceType, 'axure');
    assert.ok(Array.isArray(rpSpec.inspection.validation.errors));
    assert.match(await callErr(roLoader, 'protoflow_get_page_spec', {
      pageId: rpSourceId, importView: 'axure', limit: 81,
    }), /80/);
    assert.ok(rpSpec.importInspection.records.some((r: { type: string }) => r.type === 'StaticTable'));
    const figSpec = await callOk(roLoader, 'protoflow_get_page_spec', {
      pageId: 'fig-page-a1b2c3d4',
      includeSource: false,
      importView: 'figma',
      limit: 80,
    });
    assert.equal(figSpec.importInspection.sourceType, 'figma');
    assert.equal(figSpec.importInspection.platform, 'mobile');
    assert.match(await callErr(roLoader, 'protoflow_get_page_spec', {
      pageId: 'fig-page-a1b2c3d4', importView: 'figma', limit: 81,
    }), /80/);

    // 2. Read-write Authoring MCP inventory + inspection + schema modeling + reshaping
    const rwLoader = createLocalAuthoringWorkspace({ projectPath: pflowPath });
    const inv = await callOk(rwLoader, 'protoflow_reshape_imported_page', { action: 'inspect_project' });
    assert.equal(inv.axure.totalPages, 3);
    assert.equal(inv.figma.totalPages, 1);
    const inspectScope = (scope: Record<string, string>) => callOk(rwLoader, 'protoflow_reshape_imported_page', {
      action: 'inspect_project', ...scope,
    });
    const singleRp = await inspectScope({ pageId: rpSourceId });
    assert.deepEqual(singleRp.axure.records.map((record: { pageId: string }) => record.pageId), [rpSourceId]);
    assert.equal(singleRp.figma.totalPages, 0);
    const figFolder = await inspectScope({ folderId: 'fig-only' });
    assert.equal(figFolder.axure.totalPages, 0);
    assert.equal(figFolder.figma.records[0].pageId, 'fig-page-a1b2c3d4');
    assert.match(await callErr(rwLoader, 'protoflow_reshape_imported_page', {
      action: 'inspect_project', folderId: 'absent-folder',
    }), /指定范围|scope/i);

    const pageInspect = await callOk(rwLoader, 'protoflow_reshape_imported_page', {
      action: 'inspect_page',
      pageId: rpSourceId,
    });
    const gridRecord = pageInspect.records.find((r: { type: string }) => r.type === 'StaticTable');
    assert.ok(gridRecord);
    const [hdrCode, hdrWarehouse] = gridRecord.grid.firstRow;
    assert.equal(hdrCode.text, '单号');
    assert.equal(hdrWarehouse.text, '仓库');

    // Create shared ER table for warehouse orders
    await callOk(rwLoader, 'protoflow_upsert_db_tables', {
      tables: [
        {
          id: 'tbl_orders',
          tableName: 't_warehouse_orders',
          cnName: '仓库单据表',
          domain: '仓储域',
          description: '仓库入库与盘点单据',
          modeling: { entity: '仓库单据', grain: '每张单据一行', reason: '承载 RP 与移动盘点列表' },
          sharedByMenus: [
            { pageId: rpSourceId, menuTitle: 'RP 单据页', accessMode: 'CRUD 读写', fieldMappingNote: '单号与仓库列表' },
          ],
          columns: [
            { id: 'c_id', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '主键' },
            { id: 'c_no', name: 'order_no', dataType: 'VARCHAR(64)', nullable: false, isUnique: true, comment: '单号' },
            { id: 'c_wh', name: 'warehouse_name', dataType: 'VARCHAR(64)', nullable: false, comment: '仓库名称' },
          ],
        },
      ],
    });

    // Reject inverted column mapping (mapping '单号' header to warehouse_name and '仓库' header to order_no)
    const canvasPfId = `rp-canvas-${rpGuid}`;
    const blockError = await callErr(rwLoader, 'protoflow_reshape_imported_page', {
      action: 'optimize_axure_block', pageId: rpSourceId, targetPfId: gridRecord.pfId,
      tsx: `<Table pfId="${gridRecord.pfId}" table="tbl_orders" columns={[{ title: "单号", dataIndex: "warehouse_name" }, { title: "仓库", dataIndex: "order_no" }]} />`,
    });
    assert.match(blockError, /bind_axure_table/);
    assert.ok(!Object.hasOwn((await rwLoader.load()).payload.stateSnapshot.pageSources, rpCopyId));
    const allTopPfIds = pageInspect.records
      .filter((item: { parentPfId?: string; pfId: string }) => item.parentPfId === canvasPfId)
      .map((item: { pfId: string }) => item.pfId);
    const nonGridPfIds = allTopPfIds.filter((id: string) => id !== gridRecord.pfId);

    const validReshapedTsx = [
      'export default function Page() {',
      '  return (',
      '    <Page pfId="opt-root" title="单据管理（优化版）">',
      '      <Card pfId="opt-card" title="仓库单据">',
      '        <QueryForm pfId="opt-query" target="opt-tbl" fields={[{ name: "order_no", label: "单号" }]} />',
      '        <Table pfId="opt-tbl" table="tbl_orders" columns={[{ title: "单号", dataIndex: "order_no" }, { title: "仓库", dataIndex: "warehouse_name" }]} />',
      '      </Card>',
      '    </Page>',
      '  );',
      '}',
    ].join('\n');

    const invertedErr = await callErr(rwLoader, 'protoflow_reshape_imported_page', {
      action: 'reshape_axure_page',
      pageId: rpSourceId,
      source: validReshapedTsx,
      coverage: {
        converted: [
          {
            sourcePfIds: [gridRecord.pfId],
            targetPfId: 'opt-tbl',
            summary: 'StaticTable -> Table',
            tableId: 'tbl_orders',
            columnMappings: [
              { headerPfId: hdrCode.pfId, role: 'field', columnId: 'c_wh' },
              { headerPfId: hdrWarehouse.pfId, role: 'field', columnId: 'c_no' },
            ],
          },
        ],
        pending: [{ sourcePfIds: nonGridPfIds, reason: '其余控件待业务确认' }],
      },
    });
    assert.match(invertedErr, /颠倒|不匹配|仓库|单号/);

    // Valid Axure reshape succeeds and preserves original rp-page-* source
    const reshapedRp = await callOk(rwLoader, 'protoflow_reshape_imported_page', {
      action: 'reshape_axure_page',
      pageId: rpSourceId,
      setActive: true,
      source: validReshapedTsx,
      coverage: {
        converted: [
          {
            sourcePfIds: [gridRecord.pfId],
            targetPfId: 'opt-tbl',
            summary: 'StaticTable -> Table',
            tableId: 'tbl_orders',
            columnMappings: [
              { headerPfId: hdrCode.pfId, role: 'field', columnId: 'c_no' },
              { headerPfId: hdrWarehouse.pfId, role: 'field', columnId: 'c_wh' },
            ],
          },
        ],
        pending: [{ sourcePfIds: nonGridPfIds, reason: '其余隐藏组、母版与多状态面板待确认' }],
      },
    });
    assert.equal(reshapedRp.optimizedPageId, rpCopyId);
    assert.equal(reshapedRp.activePageId, rpCopyId);
    assert.match((await rwLoader.load()).payload.stateSnapshot.pageSources[rpSiblingCopyId],
      new RegExp(`navigate\\(['"]${rpCopyId}['"]\\)`));

    // Block-editing rp-optimized-* with a link to rpSiblingId auto-retargets to rpSiblingCopyId!
    await callOk(rwLoader, 'protoflow_edit_page_block', {
      pageId: rpCopyId,
      targetPfId: 'opt-card',
      mode: 'append_children',
      tsx: `<Button pfId="btn-jump-sib" onClick={() => navigate("${rpSiblingId}")}>查看仓库详情</Button>`,
    });
    const afterBlockEdit = await rwLoader.load();
    assert.match(afterBlockEdit.payload.stateSnapshot.pageSources[rpCopyId], new RegExp(`navigate\\(['"]${rpSiblingCopyId}['"]\\)`));
    assert.equal(
      afterBlockEdit.payload.stateSnapshot.pageSources[rpSourceId],
      project.stateSnapshot.pageSources[rpSourceId],
      'Original RP source page must remain untouched',
    );

    // 3. Figma frame reshape into <MobilePage>
    const reshapedFigma = await callOk(rwLoader, 'protoflow_reshape_imported_page', {
      action: 'reshape_figma_page',
      pageId: 'fig-page-a1b2c3d4',
      source: [
        'export default function Page() {',
        '  return (',
        '    <MobilePage pfId="m-opt-root">',
        '      <MTopBar pfId="m-opt-top" title="移动盘点任务" />',
        '      <MCardGrid pfId="m-opt-list" table="tbl_orders" titleField="order_no" subtitleField="warehouse_name" />',
        '    </MobilePage>',
        '  );',
        '}',
      ].join('\n'),
      coverage: {
        converted: [
          { sourcePfIds: ['fig-header', 'fig-title'], targetPfId: 'm-opt-top', summary: '顶部标题栏' },
          { sourcePfIds: ['fig-card-list', 'fig-item-1'], targetPfId: 'm-opt-list', tableId: 'tbl_orders', summary: '盘点任务列表' },
        ],
        pending: [{ reason: '导入提示 Keep header CTA 待确认具体业务动作' }],
      },
    });
    assert.equal(reshapedFigma.optimizedPageId, 'fig-optimized-a1b2c3d4');
    assert.equal(reshapedFigma.platform, 'mobile');

    const finalLoaded = await rwLoader.load();
    validateProjectPayload(finalLoaded.payload);

    // 4. Desktop bridge mode enforces expectedRevision ONLY on write actions of protoflow_reshape_imported_page
    const desktopMock: AuthoringWorkspace = {
      ...rwLoader,
      transport: 'desktop_bridge',
      async mutate(mutator, opts) {
        if (!opts?.expectedRevision) throw new Error('expectedRevision required on desktop_bridge');
        return rwLoader.mutate(mutator, opts);
      },
    };
    const desktopToolsRes = (await rpcCall(desktopMock, 'tools/list')) as {
      tools: { name: string; inputSchema: { required?: string[] } }[];
    };
    const desktopPageSchema = desktopToolsRes.tools.find((t) => t.name === 'protoflow_page')!;
    const validateArgs = new Ajv().compile(desktopPageSchema.inputSchema);
    const coverageArgs = { action: 'reshape_figma_page', pageId: 'fig-page-a1b2c3d4', expectedRevision: finalLoaded.revision,
      coverage: { converted: [{ sourcePfIds: ['fig-title'], targetPfId: 'm-opt-top', summary: '标题栏' }] },
      source: finalLoaded.payload.stateSnapshot.pageSources[reshapedFigma.optimizedPageId] };
    assert.ok(validateArgs(coverageArgs), JSON.stringify(validateArgs.errors));
    assert.equal(validateArgs({ ...coverageArgs, coverage: { converted: [{ targetPfId: 'm-opt-top' }] } }), false);
    assert.ok(!desktopPageSchema.inputSchema.required?.includes('expectedRevision'));
    const inspectOnDesktop = await callOk(desktopMock, 'protoflow_page', {
      action: 'inspect_project',
      sourceType: 'figma',
    });
    assert.equal(inspectOnDesktop.totalPages, 1);
    // Legacy tool alias remains 100% callable too
    const legacyInspect = await callOk(desktopMock, 'protoflow_reshape_imported_page', {
      action: 'inspect_project',
      sourceType: 'figma',
    });
    assert.equal(legacyInspect.totalPages, 1);
    const promptRes = (await rpcCall(desktopMock, 'prompts/get', {
      name: 'reshape-imported-pages',
      arguments: { scopeTarget: 'fig-page-a1b2c3d4' },
    })) as { messages: { content: { text: string } }[] };
    assert.match(promptRes.messages[0].content.text, /protoflow_reshape_imported_page|protoflow_page/);

    assert.equal(AUTHORING_MCP_TOOLS.some((t) => t.name === 'protoflow_reshape_imported_page'), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Figma reshape preserves occupied IDs and retargets earlier verified copies in the same write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-copy-'));
  try {
    const project = createProjectPayload({
      projectId: 'copy-test', projectName: 'Copies', storageDir: dir, fileName: 'copies.pflow',
      templateId: 'blank_project', projectMode: 'desktop', createdAt: '2026-11-26', updatedAt: '2026-11-26',
      pageCount: 0, tableCount: 0, stickyCount: 0,
    });
    const s = project.stateSnapshot;
    const frame = 'export default function Page() { return <Page pfId="root"><FigmaCanvas pfId="frame" frameWidth={800} frameHeight={600}><FigmaText pfId="label" text="Open" /></FigmaCanvas></Page> }';
    const link = (to: string) => `export default function Page() { return <Page pfId="root"><Button pfId="go" onClick={() => navigate("${to}")}>Open</Button></Page> }`;
    const original = link('fig-page-bravo');
    s.designerFolders.push({ id: 'folder', title: 'Pages', parentFolderId: null });
    for (const id of ['alpha', 'bravo', 'occupied']) {
      s.designerPages.push({ pageId: 'fig-page-' + id, title: id, folderId: 'folder', platform: 'desktop' });
      s.pageSources['fig-page-' + id] = frame;
    }
    s.activePageId = 'fig-page-alpha';
    s.designerPages.push({ pageId: 'fig-optimized-occupied', title: 'Hand-authored', folderId: 'folder', platform: 'desktop' });
    s.pageSources['fig-optimized-occupied'] = original;
    const file = path.join(dir, project.meta.fileName);
    fs.writeFileSync(file, encodePflowBinary(project));
    const loader = createLocalAuthoringWorkspace({ projectPath: file });
    const tool = 'protoflow_reshape_imported_page';
    const reshape = (id: string, to: string) => ({
      action: 'reshape_figma_page', pageId: 'fig-page-' + id, source: link('fig-page-' + to),
      coverage: { converted: [{ sourcePfIds: ['label'], targetPfId: 'go', summary: '导航按钮' }] },
    });
    const before = (await loader.load()).revision;
    assert.match(await callErr(loader, tool, reshape('occupied', 'bravo')), /来源不一致/);
    assert.equal((await loader.load()).revision, before);
    await callOk(loader, tool, reshape('alpha', 'bravo'));
    assert.match((await loader.load()).payload.stateSnapshot.pageSources['fig-optimized-alpha'], /navigate\(['"]fig-page-bravo/);
    await callOk(loader, tool, reshape('bravo', 'alpha'));
    const saved = (await loader.load()).payload.stateSnapshot.pageSources;
    assert.match(saved['fig-optimized-alpha'], /navigate\(['"]fig-optimized-bravo/);
    assert.match(saved['fig-optimized-bravo'], /navigate\(['"]fig-optimized-alpha/);
    assert.equal(saved['fig-optimized-occupied'], original);
    assert.equal(saved['fig-page-alpha'], frame);
    assert.equal(saved['fig-page-bravo'], frame);
    await callOk(loader, tool, reshape('alpha', 'occupied'));
    assert.match((await loader.load()).payload.stateSnapshot.pageSources['fig-optimized-alpha'], /navigate\(['"]fig-page-occupied/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const family of ['axure', 'figma'] as const) {
  test(`Hermes ${family}: a new copy repairs saved sibling links within the selected migration scope`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-sibling-turns-'));
    try {
      const project = createProjectPayload({
        projectId: 'siblings', projectName: 'Siblings', storageDir: dir, fileName: 'siblings.pflow',
        templateId: 'blank_project', projectMode: 'desktop', createdAt: '2026-11-26', updatedAt: '2026-11-26',
        pageCount: 0, tableCount: 0, stickyCount: 0,
      });
      const state = project.stateSnapshot;
      const prefix = family === 'axure' ? 'rp' : 'fig';
      const [a, b, occupied] = ['a', 'b', 'c'].map(key => key.repeat(32));
      const sourceId = (key: string) => `${prefix}-page-${key}`;
      const copyId = (key: string) => `${prefix}-optimized-${key}`;
      const link = (target: string) => `export default function Page() { return <Page pfId="root"><Button pfId="go" onClick={() => navigate("${target}")}>Open</Button></Page> }`;
      state.designerFolders.push({ id: 'both', title: 'Both', parentFolderId: null }, { id: 'only-b', title: 'B', parentFolderId: 'both' });
      for (const key of [a, b, occupied]) {
        const pageId = sourceId(key);
        state.designerPages.push({ pageId, title: key, folderId: key === b ? 'only-b' : 'both', platform: 'desktop' });
        const canvas = family === 'axure'
          ? `<AxureCanvas pfId="rp-canvas-${key}"><Text pfId="label">Open</Text></AxureCanvas>`
          : '<FigmaCanvas pfId="frame" frameWidth={800} frameHeight={600}><FigmaText pfId="label" text="Open" /></FigmaCanvas>';
        state.pageSources[pageId] = `export default function Page() { return <Page pfId="root">${canvas}</Page> }`;
      }
      state.designerPages.push({ pageId: copyId(occupied), title: 'Hand-authored', folderId: 'both', platform: 'desktop' });
      state.pageSources[copyId(occupied)] = link(sourceId(b));
      state.activePageId = sourceId(a);
      function reshape(base: typeof project, runId: string, key: string, target: string, scope?: Record<string, string>) {
        const file = path.join(dir, runId + '.json');
        atomicWrite(file, {
          kind: 'project', workflowPhase: 'conversation', active: true, projectId: project.meta.projectId, runId,
          operations: [], baseSnapshot: base.stateSnapshot, snapshot: {
            ...base.stateSnapshot, projectMode: 'desktop', [family + 'MigrationScope']: scope,
          },
        });
        callTool(file, `protoflow_reshape_${family}_page`, {
          pageId: sourceId(key), source: link(sourceId(target)),
          coverage: { converted: [{ sourcePfIds: ['label'], targetPfId: 'go', summary: '导航按钮' }] },
        });
        const operations: HermesOperation[] = JSON.parse(fs.readFileSync(file, 'utf8')).operations;
        const { dependencyFootprint } = JSON.parse(fs.readFileSync(file + '.footprint.json', 'utf8'));
        return { ...prepareProjectChanges(base, operations), operations, dependencyFootprint };
      }
      const first = reshape(project, 'first', a, b).next;
      assert.ok(first.stateSnapshot.pageSources[copyId(a)].includes(sourceId(b)));
      for (const [runId, scope, includesA] of [
        ['conversation', undefined, true],
        ['project', { kind: 'project' }, true],
        ['both-folders', { kind: 'folder', folderId: 'both' }, true],
        ['one-folder', { kind: 'folder', folderId: 'only-b' }, false],
        ['one-page', { kind: 'page', pageId: sourceId(b) }, false],
      ] as const) {
        const result = reshape(first, runId, b, a, scope);
        const pages = result.next.stateSnapshot.pageSources;
        assert.deepEqual(result.operations.map(op => op.args.pageId), includesA ? [copyId(b), copyId(a)] : [copyId(b)]);
        assert.ok(pages[copyId(b)].includes(copyId(a)));
        if (includesA) {
          const before = first.stateSnapshot.pageSources[copyId(a)];
          assert.deepEqual(parsePageSource(pages[copyId(a)]).doc, parsePageSource(before.replace(sourceId(b), copyId(b))).doc);
          assert.equal(verifyDependencyFootprint(first.stateSnapshot, result.dependencyFootprint).ok, true);
          const concurrent = structuredClone(first.stateSnapshot);
          concurrent.pageSources[copyId(a)] = before.replace('Open', 'Updated');
          const conflict = verifyDependencyFootprint(concurrent, result.dependencyFootprint);
          assert.ok(!conflict.ok && conflict.changedSections.includes(`writeSet.pages.${copyId(a)}`));
        } else {
          assert.equal(pages[copyId(a)], first.stateSnapshot.pageSources[copyId(a)]);
          assert.ok(!Object.hasOwn(result.dependencyFootprint.writeSet.pages, copyId(a)));
        }
        for (const id of [sourceId(a), sourceId(b), copyId(occupied)]) assert.equal(pages[id], state.pageSources[id]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('Hermes MCP: protoflow_capture_preview renders staged candidate snapshot and enforces turn/token/cancellation fences', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-hermes-preview-'));
  const capturedSnapshots: PreviewSnapshot[] = [];
  let holdNextCapture = false;
  let observedSignalAborted = false;

  const previewBridgeServer = createHermesPreviewBridge(
    async (snapshot: PreviewSnapshot, signal: AbortSignal) => {
      capturedSnapshots.push(snapshot);
      if (holdNextCapture) {
        await new Promise<void>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              observedSignalAborted = true;
              reject(new Error('Aborted by turn cancellation'));
            },
            { once: true },
          );
        });
      }
      return {
        data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'),
        width: 1280,
        height: 800,
        truncated: false,
      };
    },
  );

  try {
    assert.equal(hermesMcpTools.some((t: { name: string }) => t.name === 'protoflow_capture_preview'), true);
    assert.match(toolProgressLabel('mcp__protoflow__protoflow_capture_preview', 'in_progress'), /视觉预览|Capturing page preview/);

    const payload = createProjectPayload({
      projectId: 'proj-staged-cap',
      projectName: 'Staged Preview Test',
      storageDir: tmpDir,
      fileName: 'staged.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    payload.stateSnapshot.activePageId = 'p_orders';
    const baseSnapshot = {
      projectId: 'proj-staged-cap',
      projectName: 'Staged Preview Test',
      projectMode: 'desktop' as const,
      designerFolders: [{ id: 'f_ops', title: '运营中心', parentFolderId: null }],
      designerPages: [{ pageId: 'p_orders', title: '订单台账', folderId: 'f_ops', platform: 'desktop' as const }],
      sitemapOverrides: payload.stateSnapshot.sitemapOverrides,
      sitemapBase: payload.stateSnapshot.sitemapBase,
      pageSources: {
        p_orders: 'export default function Page() { return (<Page pfId="root" title="旧标题"><Text pfId="old-txt">旧内容</Text></Page>); }',
      },
      dbTables: [],
      tableRows: {},
      stickyNotes: [],
      closedLoopIssues: [],
      mindmaps: { nodes: [], links: [] },
    };

    const runId = 'run-preview-001';
    const bridgeInfo = await previewBridgeServer.registerTurn(runId);
    assert.ok(bridgeInfo && bridgeInfo.port > 0 && bridgeInfo.token.length === 64);

    const contextFile = path.join(tmpDir, 'context.json');
    atomicWrite(contextFile + '.footprint.json', {
      runId,
      dependencyFootprint: createEmptyDependencyFootprint(null, null),
    });
    atomicWrite(contextFile, {
      active: true,
      runId,
      projectId: 'proj-staged-cap',
      kind: 'project',
      workflowPhase: 'conversation',
      sessionId: 'acp-sess-1',
      readOnly: false,
      requireFootprintSidecar: true,
      previewBridge: bridgeInfo,
      previewContext: projectPreviewContext(payload),
      baseSnapshot: structuredClone(baseSnapshot),
      snapshot: structuredClone(baseSnapshot),
      operations: [],
    });

    // 1. Read catalog -> stage DB table -> stage updated TSX -> call protoflow_capture_preview
    const getProjFrame = await handleMcpFrame(contextFile, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'protoflow_get_project', arguments: {} },
    });
    assert.notEqual(getProjFrame.result.isError, true);

    const stageTblFrame = await handleMcpFrame(contextFile, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'protoflow_upsert_db_table',
        arguments: {
          table: {
            id: 't_orders',
            tableName: 'orders',
            cnName: '订单表',
            domain: '交易域',
            description: '订单记录',
            modeling: { entity: '订单', grain: '一单一记录', reason: '台账展示' },
            sharedByMenus: [{ pageId: 'p_orders', menuTitle: '订单台账', accessMode: 'CRUD 读写', fieldMappingNote: '主列表' }],
            columns: [
              { id: 'c_id', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' },
              { id: 'c_code', name: 'order_code', dataType: 'VARCHAR(64)', nullable: false, isUnique: true, comment: '单号' },
            ],
          },
        },
      },
    });
    assert.notEqual(stageTblFrame.result.isError, true, stageTblFrame.result.content?.[0]?.text);

    const stagePageFrame = await handleMcpFrame(contextFile, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'protoflow_apply_tsx_patch',
        arguments: {
          pageId: 'p_orders',
          source:
            'export default function Page() { return (<Page pfId="root" title="新暂存订单台账"><Card pfId="c1" title="列表"><Table pfId="tbl1" table="t_orders" columns={[{ title: "单号", dataIndex: "order_code" }]} /></Card></Page>); }',
        },
      },
    });
    assert.notEqual(stagePageFrame.result.isError, true, stagePageFrame.result.content?.[0]?.text);

    const capFrame = await handleMcpFrame(contextFile, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'protoflow_capture_preview',
        arguments: { scope: 'viewport', fullPage: true, uiState: 'empty' },
      },
    });
    assert.notEqual(capFrame.result.isError, true, capFrame.result.content?.[0]?.text);
    assert.equal(capFrame.result.content.length, 2);
    assert.equal(capFrame.result.content[0].type, 'image');
    assert.equal(capFrame.result.content[0].mimeType, 'image/png');
    const meta = JSON.parse(capFrame.result.content[1].text);
    assert.equal(meta.pageId, 'p_orders');
    assert.equal(meta.platform, 'desktop');
    assert.equal(meta.fullPage, true);
    assert.equal(meta.uiState, 'empty');
    assert.equal(meta.staged, true);
    assert.equal(meta.stagedOperationCount, 2);

    // Verify captured snapshot reflects STAGED table + STAGED TSX, NOT old baseSnapshot!
    assert.equal(capturedSnapshots.length, 1);
    const snap = capturedSnapshots[0];
    assert.equal(snap.meta.templateId, 'saas_inventory');
    assert.ok(payload.stateSnapshot.suppliers.length > 0);
    assert.deepEqual(snap.state.suppliers, payload.stateSnapshot.suppliers);
    assert.deepEqual(snap.state.purchaseOrderItems, payload.stateSnapshot.purchaseOrderItems);
    assert.deepEqual(snap.state.draftAcceptanceHeader, payload.stateSnapshot.draftAcceptanceHeader);
    assert.deepEqual(snap.state.widgets, payload.stateSnapshot.widgets);
    assert.equal(snap.doc.root.props.title, '新暂存订单台账');
    assert.equal(snap.state.dbTables.length, 1);
    assert.equal(snap.state.dbTables[0].id, 't_orders');
    assert.equal(snap.uiState, 'empty');

    // Verify protoflow_capture_preview did NOT append a write operation to context.operations
    const savedCtx = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    assert.equal(savedCtx.operations.length, 2);

    // 2. Security fences: Origin header and bad Bearer token rejected with 403
    const originRes = await fetch(`http://127.0.0.1:${bridgeInfo.port}/capture`, {
      method: 'POST',
      headers: {
        Origin: 'http://evil.example',
        Authorization: `Bearer ${bridgeInfo.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ runId, snapshot: snap }),
    });
    assert.equal(originRes.status, 403);

    const badTokenRes = await fetch(`http://127.0.0.1:${bridgeInfo.port}/capture`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ runId, snapshot: snap }),
    });
    assert.equal(badTokenRes.status, 403);

    // 3. Cancellation fence: unregisterTurn aborts an in-flight BrowserWindow capture immediately
    holdNextCapture = true;
    const inflightPromise = handleMcpFrame(contextFile, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'protoflow_capture_preview', arguments: { pageId: 'p_orders' } },
    });
    await new Promise((r) => setTimeout(r, 40));
    previewBridgeServer.unregisterTurn(runId);
    const cancelledFrame = await inflightPromise;
    assert.equal(observedSignalAborted, true);
    assert.equal(cancelledFrame.result.isError, true);

    // 4. Graceful fallback error when previewBridge is absent
    const headlessCtx = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    delete headlessCtx.previewBridge;
    atomicWrite(contextFile, headlessCtx);
    const noBridgeFrame = await handleMcpFrame(contextFile, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'protoflow_capture_preview', arguments: { pageId: 'p_orders' } },
    });
    assert.equal(noBridgeFrame.result.isError, true);
    assert.match(noBridgeFrame.result.content[0].text, /protoflow_inspect_page/);
  } finally {
    previewBridgeServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
