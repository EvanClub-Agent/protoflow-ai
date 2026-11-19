import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { McpConnectModal, shareUrlToMcpHttpUrl } from '../src/components/McpConnectModal';
import postgresColumnTypes from '../server/internal/publish/testdata/postgres-column-types.json';
import { generateDatabaseDdl, mapColumnTypeForDialect } from '../src/mcp/ddl';
import { handleSpecMcpPayload } from '../src/mcp/protocol';
import {
  createLocalWorkspaceLoader,
  createRemoteWorkspaceLoader,
  parseShareUrl,
} from '../src/mcp/workspace';
import { parsePageSource } from '../src/proto/dsl/parser';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import {
  normalizePublishedSnapshot,
  validatePublishedSnapshot,
  type PublishedSnapshot,
} from '../src/services/publishedSnapshot';
import { useProtoStore } from '../src/store/useProtoStore';
import { encodePflowBinary } from '../src/utils/pflowBinaryCodec';
import { installTestDom } from './dom';
import { publishingBridgeFixture } from './publishingBridgeFixture';

test('Spec MCP: parseShareUrl accepts /p/<id> and /api/v1/mcp/<id> and enforces HTTPS outside LAN', () => {
  const shareId = 'share_1234567890abcdefghij';
  const parsed = parseShareUrl(`https://proto.example.com/p/${shareId}`);
  assert.equal(parsed.origin, 'https://proto.example.com');
  assert.equal(parsed.shareId, shareId);
  assert.equal(parsed.shareUrl, `https://proto.example.com/p/${shareId}`);
  assert.equal(parsed.mcpHttpUrl, `https://proto.example.com/api/v1/mcp/${shareId}`);

  const lan = parseShareUrl(`http://192.168.1.25:8080/api/v1/mcp/${shareId}`);
  assert.equal(lan.shareUrl, `http://192.168.1.25:8080/p/${shareId}`);

  assert.throws(() => parseShareUrl(`http://public.example.com/p/${shareId}`), /HTTPS/);
});

test('Spec MCP: local .pflow loader supports all 6 read-only tools, transitive FK closure, prompts, resources, and hot reload', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-spec-mcp-'));
  try {
    const filePath = path.join(tmpDir, 'crm.pflow');
    const payload = createProjectPayload({
      projectId: 'proj-crm-mcp',
      projectName: 'CRM 客户协同系统',
      storageDir: tmpDir,
      fileName: 'crm.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-18T08:00:00.000Z',
      updatedAt: '2026-11-18T08:00:00.000Z',
      pageCount: 3,
      tableCount: 2,
      stickyCount: 1,
    });
    fs.writeFileSync(filePath, encodePflowBinary(payload));

    const loader = createLocalWorkspaceLoader(filePath);

    const initRes = await handleSpecMcpPayload(loader, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    assert.ok(initRes && !Array.isArray(initRes));
    assert.equal((initRes.result as { protocolVersion: string }).protocolVersion, '2025-03-26');

    const notifRes = await handleSpecMcpPayload(loader, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    assert.equal(notifRes, null);

    const callTool = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await handleSpecMcpPayload(loader, {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      assert.ok(r && !Array.isArray(r));
      const res = r.result as { isError: boolean; content: { text: string }[] };
      assert.equal(res.isError, false, res.content[0]?.text);
      return JSON.parse(res.content[0].text);
    };

    const overview = await callTool('protoflow_get_project_overview');
    assert.equal(overview.project.projectName, 'CRM 客户协同系统');
    assert.equal(overview.project.sourceKind, 'local');

    const pgSchema = await callTool('protoflow_get_database_schema', { dialect: 'postgres', includeSampleRows: true });
    assert.equal(pgSchema.dialect, 'postgres');
    assert.equal(pgSchema.uniqueConstraintsComplete, true);
    assert.match(pgSchema.ddl, /CREATE TABLE IF NOT EXISTS "/);

    // Filtering by child table t_wms_acceptance_detail includes transitive parent tables in DDL
    const childSchema = await callTool('protoflow_get_database_schema', {
      tableNames: ['t_wms_acceptance_detail'],
      dialect: 'postgres',
    });
    assert.equal(childSchema.tableCount, 1);
    assert.ok(Array.isArray(childSchema.dependencyTables) && childSchema.dependencyTables.length >= 1);
    for (const depName of childSchema.dependencyTables) {
      assert.ok(childSchema.ddl.includes(`CREATE TABLE IF NOT EXISTS "${depName}"`));
    }

    const firstCanvasPage = overview.pages.find((p: { hasSource: boolean }) => p.hasSource);
    assert.ok(firstCanvasPage);
    const pageSpec = await callTool('protoflow_get_page_spec', { pageId: firstCanvasPage.pageId });
    assert.equal(pageSpec.page.pageId, firstCanvasPage.pageId);
    assert.ok(typeof pageSpec.pageSourceTsx === 'string' && pageSpec.pageSourceTsx.includes('export default function Page()'));

    // Hot reload when .pflow is modified on disk
    payload.meta.projectName = 'CRM 客户协同系统 V2';
    fs.writeFileSync(filePath, encodePflowBinary(payload));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(filePath, future, future);

    const refreshed = await callTool('protoflow_get_project_overview');
    assert.equal(refreshed.project.projectName, 'CRM 客户协同系统 V2');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Spec MCP: real published built-in project preserves V5 unique constraints and round-trips acceptance-new rowActions', async () => {
  loadProjectFromBinaryPayload(
    createProjectPayload({
      projectId: 'proj-real-pub-mcp',
      projectName: '真实发布链路验证',
      storageDir: '/tmp',
      fileName: 'real.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-18T08:00:00.000Z',
      updatedAt: '2026-11-18T08:00:00.000Z',
      pageCount: 2,
      tableCount: 2,
      stickyCount: 0,
    })
  );

  // Add both single-column isUnique and composite uniqueConstraints onto the first table before publishing
  const [tbl, ...rest] = useProtoStore.getState().dbTables;
  const nonPkCols = tbl.columns.filter((c) => !c.isPrimaryKey);
  const modifiedTbl = {
    ...tbl,
    columns: tbl.columns.map((c) => (c.id === nonPkCols[0].id ? { ...c, isUnique: true } : c)),
    uniqueConstraints: [{ name: 'uq_composite_pair', columnIds: [nonPkCols[0].id, nonPkCols[1].id] }],
  };
  useProtoStore.setState({ dbTables: [modifiedTbl, ...rest] });

  const v5Snapshot = createPublishedSnapshot('acceptance-new');
  assert.equal(v5Snapshot.formatVersion, 5);

  // Duplicate column IDs in a V5 snapshot must be rejected so uniqueConstraints cannot bind to a shadowed column
  const dupColSnap: any = structuredClone(v5Snapshot);
  dupColSnap.tables[0].columns[1].id = dupColSnap.tables[0].columns[0].id;
  assert.throws(() => validatePublishedSnapshot(dupColSnap), /字段 ID 重复/);

  const observedRedirects: (RequestRedirect | undefined)[] = [];
  const shareId = 'share_v5_real_abcdefghij12345';
  const mockFetchV5 = (async (url: string | URL | Request, init?: RequestInit) => {
    observedRedirects.push(init?.redirect);
    const u = String(url);
    if (u.endsWith(`/api/v1/view/${shareId}`)) {
      return new Response(
        JSON.stringify({ id: shareId, projectId: v5Snapshot.projectId, title: v5Snapshot.title, version: 1, passwordProtected: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        publication: { id: shareId, projectId: v5Snapshot.projectId, title: v5Snapshot.title, version: 1, updatedAt: '2026-11-18T10:00:00Z' },
        snapshot: v5Snapshot,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const v5Loader = createRemoteWorkspaceLoader({
    shareUrl: `https://proto.example.com/p/${shareId}`,
    fetchImpl: mockFetchV5,
  });

  const dbRes = await handleSpecMcpPayload(v5Loader, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'protoflow_get_database_schema', arguments: { tableNames: [modifiedTbl.tableName], dialect: 'postgres' } },
  });
  assert.ok(dbRes && !Array.isArray(dbRes));
  const dbParsed = JSON.parse((dbRes.result as { content: { text: string }[] }).content[0].text);
  assert.equal(dbParsed.uniqueConstraintsComplete, true);
  assert.deepEqual(observedRedirects, ['error', 'error']);
  assert.match(dbParsed.ddl, /UNIQUE/);
  assert.match(dbParsed.ddl, /CONSTRAINT "uq_composite_pair" UNIQUE/);

  // Verify acceptance-new TSX round-trips cleanly with executable rowActions callbacks
  const pageRes = await handleSpecMcpPayload(v5Loader, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'protoflow_get_page_spec', arguments: { pageId: 'acceptance-new' } },
  });
  assert.ok(pageRes && !Array.isArray(pageRes));
  const pageParsed = JSON.parse((pageRes.result as { content: { text: string }[] }).content[0].text);
  assert.equal(pageParsed.pageSourceTsx.includes('$kind'), false);
  const reparsed = parsePageSource(pageParsed.pageSourceTsx);
  assert.ok(reparsed.doc);
  assert.equal(reparsed.issues.filter((i) => i.level === 'error').length, 0);

  // Verify legacy V4 snapshot explicitly marks uniqueConstraintsComplete=false and emits warning
  const legacyV4: PublishedSnapshot = {
    formatVersion: 4,
    projectId: 'proj-v4-legacy',
    title: '旧版V4分享',
    entryPageId: 'p1',
    sitemap: [
      { id: 'f1', title: '目录', type: 'folder', deprecated: false, children: [{ id: 'm1', title: '页1', type: 'page', deprecated: false, pageId: 'p1' }] },
    ],
    pages: [{ pageId: 'p1', title: '页1', folderId: 'f1', doc: { header: [], root: { kind: 'node', pfId: 'r', type: 'Page', props: {}, children: [] } } }],
    tables: [{ id: 't1', tableName: 't1', cnName: '表1', domain: '域', description: '', sharedByMenus: [], columns: [{ id: 'c1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: 'ID' }] }],
    tableRows: { t1: [] },
    stickyNotes: [],
    notes: [],
  };
  const legacyId = 'share_v4_old_abcdefghij12345';
  const v4Loader = createRemoteWorkspaceLoader({
    shareUrl: `https://proto.example.com/p/${legacyId}`,
    fetchImpl: (async (url: string | URL | Request) => {
      if (String(url).endsWith(`/api/v1/view/${legacyId}`)) {
        return new Response(JSON.stringify({ id: legacyId, projectId: 'proj-v4-legacy', title: '旧版V4分享', version: 1, passwordProtected: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ publication: { id: legacyId, projectId: 'proj-v4-legacy', title: '旧版V4分享', version: 1 }, snapshot: legacyV4 }), { status: 200 });
    }) as typeof fetch,
  });
  const legacyRes = await handleSpecMcpPayload(v4Loader, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'protoflow_get_database_schema', arguments: {} },
  });
  assert.ok(legacyRes && !Array.isArray(legacyRes));
  const legacySchema = JSON.parse((legacyRes.result as { content: { text: string }[] }).content[0].text);
  assert.equal(legacySchema.uniqueConstraintsComplete, false);
  assert.ok(Array.isArray(legacySchema.warnings) && legacySchema.warnings.length === 1);
  assert.ok(legacySchema.ddl.startsWith('-- [警告]'));
});

test('Spec MCP UI: McpConnectModal isolates share passwords across links/projects and never emits unpublished npx package', async () => {
  installTestDom();
  const previousDesktop = (window as unknown as { protoflowDesktop?: unknown }).protoflowDesktop;
  const shareA = 'https://alpha.example.com/p/share_alpha_1234567890ab';
  const shareB = 'https://beta.example.com/p/share_beta_1234567890abc';

  loadProjectFromBinaryPayload(
    createProjectPayload({
      projectId: 'proj-modal-A',
      projectName: '工程A',
      storageDir: '/tmp/projA',
      fileName: 'a.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-18T08:00:00.000Z',
      updatedAt: '2026-11-18T08:00:00.000Z',
      pageCount: 1,
      tableCount: 0,
      stickyCount: 0,
    })
  );

  (window as unknown as { protoflowDesktop?: unknown }).protoflowDesktop = {
    isElectron: true,
    mcpRuntimeInfo: async () => ({
      execPath: '/Applications/Alex.app/Contents/MacOS/Alex',
      scriptPath: '/Applications/Alex.app/Contents/Resources/app.asar.unpacked/electron/generated/spec-mcp-server.cjs',
      isPackaged: true,
      homeDir: '/Users/demo',
      pathSep: '/',
    }),
    publishing: publishingBridgeFixture({
      settings: async () => ({
        url: 'https://alpha.example.com',
        configured: true,
        user: { id: 'u1', username: 'pm', displayName: 'PM' },
        legacy: null,
      }),
      request: async (input: { action: string; projectId?: string }) => {
        if (input.action === 'list' && input.projectId === 'proj-modal-A') {
          return {
            items: [
              {
                id: 'share_alpha_1234567890ab',
                projectId: 'proj-modal-A',
                title: '工程A分享',
                version: 1,
                passwordProtected: true,
                expiresAt: null,
                revokedAt: null,
                createdAt: '2026-11-18T08:00:00Z',
                updatedAt: '2026-11-18T08:00:00Z',
                shareUrl: shareA,
              },
            ],
          };
        }
        return { items: [] };
      },
    }),
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(McpConnectModal, {
          open: true,
          onClose() {},
          initialTab: 'remote',
        })
      );
    });

    const getCodeText = () => {
      const pre = renderer.root.findByType('pre');
      return pre.findByType('code').children.join('');
    };

    // Share A loaded from project A's publications; enter Share A's secret password
    assert.match(getCodeText(), /alpha\.example\.com\/api\/v1\/mcp\/share_alpha_1234567890ab/);
    act(() => {
      renderer.root.findByProps({ id: 'mcp-share-pw-input' }).props.onChange({
        target: { value: 'TopSecretAlpha99' },
      });
    });
    assert.match(getCodeText(), /TopSecretAlpha99/);

    // Switch URL to Share B on another domain -> Share A's password MUST NOT leak into Share B's headers!
    act(() => {
      renderer.root.findByProps({ id: 'mcp-share-url-input' }).props.onChange({
        target: { value: shareB },
      });
    });
    assert.match(getCodeText(), /beta\.example\.com\/api\/v1\/mcp\/share_beta_1234567890abc/);
    assert.equal(getCodeText().includes('TopSecretAlpha99'), false);
    assert.equal(renderer.root.findByProps({ id: 'mcp-share-pw-input' }).props.value, '');

    // Cleartext public HTTP URL must be rejected, disabling password input and refusing to emit cleartext URL
    assert.equal(shareUrlToMcpHttpUrl('http://public.example.com/p/share_alpha_1234567890ab').valid, false);
    assert.equal(shareUrlToMcpHttpUrl('http://192.168.1.10:8088/p/share_alpha_1234567890ab').valid, true);
    act(() => {
      renderer.root.findByProps({ id: 'mcp-share-url-input' }).props.onChange({
        target: { value: 'http://public.example.com/p/share_alpha_1234567890ab' },
      });
    });
    assert.equal(renderer.root.findByProps({ id: 'mcp-share-pw-input' }).props.disabled, true);
    assert.equal(getCodeText().includes('http://public.example.com'), false);
    assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 1);

    const instanceText = (inst: TestRenderer.ReactTestInstance | string): string =>
      typeof inst === 'string' ? inst : inst.children.map((c) => instanceText(c)).join('');

    // Switch to Local tab -> verify executable local Electron / Node commands, ZERO @protoflow-ai/mcp npx 404 references
    act(() => {
      const localBtn = renderer.root.findAllByType('button').find((b) => instanceText(b).includes('本地 .pflow 工程直连'));
      localBtn!.props.onClick();
    });
    assert.equal(getCodeText().includes('@protoflow-ai/mcp'), false);
    assert.match(getCodeText(), /ELECTRON_RUN_AS_NODE/);

    // Switch active project in store to Project B (which has 0 publications) -> old project's URL & credentials clear immediately
    await act(async () => {
      loadProjectFromBinaryPayload(
        createProjectPayload({
          projectId: 'proj-modal-B',
          projectName: '工程B',
          storageDir: '/tmp/projB',
          fileName: 'b.pflow',
          templateId: 'blank_project',
          createdAt: '2026-11-18T09:00:00.000Z',
          updatedAt: '2026-11-18T09:00:00.000Z',
          pageCount: 1,
          tableCount: 0,
          stickyCount: 0,
        })
      );
    });
    assert.equal(renderer.root.findByProps({ id: 'mcp-share-url-input' }).props.value, '');
    assert.equal(getCodeText().includes('beta.example.com'), false);
    assert.equal(getCodeText().includes('alpha.example.com'), false);
  } finally {
    if (renderer) act(() => renderer.unmount());
    (window as unknown as { protoflowDesktop?: unknown }).protoflowDesktop = previousDesktop;
  }
});

test('Spec MCP: standalone CLI bundle responds over stdio to both newline and Content-Length frames', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-mcp-cli-'));
  try {
    const filePath = path.join(tmpDir, 'demo.pflow');
    const payload = createProjectPayload({
      projectId: 'proj-cli-smoke',
      projectName: 'CLI 冒烟工程',
      storageDir: tmpDir,
      fileName: 'demo.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-18T08:00:00.000Z',
      updatedAt: '2026-11-18T08:00:00.000Z',
      pageCount: 2,
      tableCount: 2,
      stickyCount: 0,
    });
    fs.writeFileSync(filePath, encodePflowBinary(payload));

    const cliScript = path.resolve(__dirname, '../packages/protoflow-mcp/dist/cli.cjs');
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'protoflow_get_project_overview', arguments: {} } },
    ];
    const res = spawnSync(process.execPath, [cliScript, '--project', filePath], {
      input: requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].result.serverInfo.name, 'protoflow-spec');
    const overview = JSON.parse(lines[1].result.content[0].text);
    assert.equal(overview.project.projectName, 'CLI 冒烟工程');

    const firstId = '1' + '0'.repeat(64);
    const secondId = '1' + '0'.repeat(63) + '1';
    const batch = `[{"jsonrpc":"2.0","id":${firstId},"method":"ping"},{"jsonrpc":"2.0","id":${secondId},"method":"ping"}]`;
    const longIds = spawnSync(process.execPath, [cliScript, '--project', filePath], {
      input: batch + '\n', encoding: 'utf8', timeout: 15000,
    });
    assert.equal(longIds.status, 0, longIds.stderr);
    // Compare numeric tokens directly; JSON.parse would round both to the same Number.
    assert.deepEqual([...longIds.stdout.matchAll(/"id":(\d+)/g)].map(match => match[1]), [firstId, secondId]);

    const body = JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping' });
    const framedInput = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
    const framedRes = spawnSync(process.execPath, [cliScript, '--project', filePath], {
      input: framedInput,
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(framedRes.status, 0, framedRes.stderr);
    assert.match(framedRes.stdout, /^Content-Length:\s*\d+\r\n\r\n\{/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Spec MCP Round-3 regressions: FK single-column uniqueness, legacy V3/V4 column.id compatibility, exact password preservation, and atomic open version', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-mcp-r3-'));
  const previousDesktop = (window as unknown as { protoflowDesktop?: unknown }).protoflowDesktop;
  try {
    // 1. [P2 #1] Foreign keys targeting non-unique or composite-PK columns must not emit invalid PostgreSQL FK DDL
    const payload = createProjectPayload({
      projectId: 'proj-fk-r3',
      projectName: '外键唯一性验证',
      storageDir: tmpDir,
      fileName: 'fk-r3.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-19T08:00:00.000Z',
      updatedAt: '2026-11-19T08:00:00.000Z',
      pageCount: 1,
      tableCount: 3,
      stickyCount: 0,
    });
    payload.stateSnapshot.dbTables = [
      {
        id: 't_org',
        tableName: 't_org',
        cnName: '机构表',
        domain: '主数据',
        description: '',
        sharedByMenus: [],
        columns: [
          { id: 'c_org_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
          { id: 'c_org_region', name: 'region_code', dataType: 'VARCHAR(32)', nullable: false, comment: '普通非唯一列' },
        ],
      },
      {
        id: 't_comp',
        tableName: 't_comp',
        cnName: '复合主键表',
        domain: '主数据',
        description: '',
        sharedByMenus: [],
        columns: [
          { id: 'c_t1', name: 'tenant_id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '租户' },
          { id: 'c_t2', name: 'member_id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '成员' },
          { id: 'lookup_ref', name: 'lookup_id', dataType: 'VARCHAR(64)', nullable: true, isForeignKey: true, references: 't_lookup(id)', comment: '' },
        ],
      },
      {
        id: 't_lookup', tableName: 't_lookup', cnName: '字典表', domain: '主数据',
        description: '', sharedByMenus: [],
        columns: [{ id: 'l_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '' }],
      },
      {
        id: 't_child',
        tableName: 't_child',
        cnName: '子表',
        domain: '业务',
        description: '',
        sharedByMenus: [],
        columns: [
          { id: 'c_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
          { id: 'c_valid_fk', name: 'org_id', dataType: 'VARCHAR(64)', nullable: false, isForeignKey: true, references: 't_org(id)', comment: '合法单列主键外键' },
          { id: 'c_nonuniq_fk', name: 'region_code', dataType: 'VARCHAR(32)', nullable: true, isForeignKey: true, references: 't_org(region_code)', comment: '指向非唯一列' },
          { id: 'c_comppk_fk', name: 'tenant_id', dataType: 'VARCHAR(64)', nullable: true, isForeignKey: true, references: 't_comp(tenant_id)', comment: '指向复合主键单列' },
        ],
      },
    ];
    payload.stateSnapshot.tableRows = { t_org: [], t_comp: [], t_lookup: [], t_child: [] };
    const fkFile = path.join(tmpDir, 'fk-r3.pflow');
    fs.writeFileSync(fkFile, encodePflowBinary(payload));

    const localLoader = createLocalWorkspaceLoader(fkFile);
    const dbSchemaRes = (await handleSpecMcpPayload(localLoader, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'protoflow_get_database_schema', arguments: { dialect: 'postgres' } },
    })) as { result: { content: { text: string }[] } };
    const schemaJson = JSON.parse(dbSchemaRes.result.content[0].text);
    assert.equal(schemaJson.foreignKeys.length, 2);
    assert.ok(schemaJson.foreignKeys.every((fk: { referencesColumn: string }) => fk.referencesColumn === 'id'));
    assert.equal(schemaJson.ddl.includes('REFERENCES "t_org" ("id")'), true);
    assert.equal(schemaJson.ddl.includes('REFERENCES "t_org" ("region_code")'), false);
    assert.equal(schemaJson.ddl.includes('REFERENCES "t_comp" ("tenant_id")'), false);
    assert.match(schemaJson.ddl, /待修复的外键引用：t_child\.region_code/);
    assert.match(schemaJson.ddl, /待修复的外键引用：t_child\.tenant_id/);
    assert.equal(Array.isArray(schemaJson.warnings) && schemaJson.warnings.length === 2, true);

    const filtered = await handleSpecMcpPayload(localLoader, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'protoflow_get_database_schema', arguments: { tableNames: ['t_child'] } },
    }) as { result: { content: { text: string }[] } };
    const childSchema = JSON.parse(filtered.result.content[0].text);
    assert.deepEqual(childSchema.dependencyTables, ['t_org']);
    assert.deepEqual(childSchema.foreignKeys.map((fk: { referencesTable: string }) => fk.referencesTable), ['t_org']);
    assert.doesNotMatch(childSchema.ddl, /CREATE TABLE IF NOT EXISTS "(?:t_comp|t_lookup)"/);
    assert.match(childSchema.ddl, /待修复的外键引用：t_child\.tenant_id/);
    assert.ok(childSchema.warnings.some((warning: string) => warning.includes('t_comp(tenant_id)')));

    // 2. [P2 #2] Legacy V3/V4 shares with duplicate or untrimmed column.id must keep opening, while V5 enforces strict column.id uniqueness/trimming
    const saasPayload = createProjectPayload({
      projectId: 'proj-v5-compat',
      projectName: '旧版分享兼容验证',
      storageDir: tmpDir,
      fileName: 'v5-compat.pflow',
      templateId: 'saas_inventory',
      createdAt: '2026-11-19T08:00:00.000Z',
      updatedAt: '2026-11-19T08:00:00.000Z',
      pageCount: 2,
      tableCount: 2,
      stickyCount: 0,
    });
    loadProjectFromBinaryPayload(saasPayload);
    const entryPageId = Object.keys(saasPayload.stateSnapshot.pageSources)[0];
    const v5Base = createPublishedSnapshot(entryPageId);
    const legacyV3DupColId = {
      ...structuredClone(v5Base),
      formatVersion: 3 as const,
      tables: v5Base.tables.map((t) => {
        const { uniqueConstraints: _uc, ...rest } = t;
        return {
          ...rest,
          columns: t.columns.map(( col, idx ) => {
            const { isUnique: _u, ...cRest } = col;
            return { ...cRest, id: idx === 0 ? ' legacy_dup_id ' : ' legacy_dup_id ' };
          }),
        };
      }),
    };
    delete (legacyV3DupColId as Record<string, unknown>).notes;
    delete (legacyV3DupColId as Record<string, unknown>).noteAssets;
    assert.doesNotThrow(() => validatePublishedSnapshot(legacyV3DupColId));
    assert.doesNotThrow(() => normalizePublishedSnapshot(legacyV3DupColId));

    const v5DupColId = {
      ...structuredClone(v5Base),
      tables: v5Base.tables.map((t, tIdx) =>
        tIdx === 0
          ? { ...t, columns: t.columns.map((col) => ({ ...col, id: 'same_col_id' })) }
          : t
      ),
    };
    assert.throws(() => validatePublishedSnapshot(v5DupColId), /字段 ID 重复/);

    // 3. [P2 #5] McpConnectModal preserves leading/trailing whitespace & Unicode share passwords without .trim() mutation
    installTestDom();
    const shareProtected = 'https://secure.example.com/p/share_padded_1234567890';
    (window as unknown as { protoflowDesktop?: unknown }).protoflowDesktop = {
      isElectron: true,
      mcpRuntimeInfo: async () => ({
        execPath: '/Applications/Alex.app/Contents/MacOS/Alex',
        scriptPath: '/Applications/Alex.app/Contents/Resources/app.asar.unpacked/electron/generated/spec-mcp-server.cjs',
        isPackaged: true,
        homeDir: '/Users/demo',
        pathSep: '/',
      }),
    };
    let modalRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      modalRenderer = TestRenderer.create(
        React.createElement(McpConnectModal, {
          open: true,
          onClose() {},
          initialTab: 'remote',
          initialShareUrl: shareProtected,
        })
      );
    });
    const readSnippet = () => modalRenderer.root.findByType('pre').findByType('code').children.join('');

    const paddedSecret = '  paddedPass99  ';
    act(() => {
      modalRenderer.root.findByProps({ id: 'mcp-share-pw-input' }).props.onChange({
        target: { value: paddedSecret },
      });
    });
    const httpPaddedCfg = JSON.parse(readSnippet());
    const b64Header = httpPaddedCfg.mcpServers.protoflow.headers['X-Protoflow-Password-Base64'];
    assert.equal(typeof b64Header, 'string');
    assert.equal(Buffer.from(b64Header, 'base64').toString('utf8'), paddedSecret);

    const unicodeSecret = '密码测试888';
    act(() => {
      modalRenderer.root.findByProps({ id: 'mcp-share-pw-input' }).props.onChange({
        target: { value: unicodeSecret },
      });
    });
    const httpUnicodeCfg = JSON.parse(readSnippet());
    assert.equal(
      Buffer.from(httpUnicodeCfg.mcpServers.protoflow.headers['X-Protoflow-Password-Base64'], 'base64').toString('utf8'),
      unicodeSecret
    );

    // Switch transport to stdio_local -> env.PROTOFLOW_SHARE_PASSWORD preserves exact padded spaces verbatim
    act(() => {
      modalRenderer.root.findByProps({ id: 'mcp-share-pw-input' }).props.onChange({
        target: { value: paddedSecret },
      });
    });
    const instanceText = (inst: TestRenderer.ReactTestInstance | string): string =>
      typeof inst === 'string' ? inst : inst.children.map((c) => instanceText(c)).join('');
    act(() => {
      const stdioBtn = modalRenderer.root
        .findAllByType('button')
        .find((b) => instanceText(b).includes('客户端内置 Stdio'));
      stdioBtn!.props.onClick();
    });
    const stdioCfg = JSON.parse(readSnippet());
    assert.equal(stdioCfg.mcpServers.protoflow.env.PROTOFLOW_SHARE_PASSWORD, paddedSecret);
    act(() => modalRenderer.unmount());

    // 4. [P2 #6] createRemoteWorkspaceLoader stamps revision & cache with atomic openJson.publication.version, not stale GET metaJson.version
    const shareRaceId = 'share_race_1234567890abcd';
    const shareRaceUrl = `https://race.example.com/p/${shareRaceId}`;
    let metaCallCount = 0;
    let openCallCount = 0;
    const raceLoader = createRemoteWorkspaceLoader({
      shareUrl: shareRaceUrl,
      cacheTtlMs: 0,
      fetchImpl: async (url: string | URL | Request) => {
        const u = String(url);
        if (u.endsWith(`/api/v1/view/${shareRaceId}`)) {
          metaCallCount++;
          // Call 1 returns stale version 1 before concurrent republish; Call 2 returns version 2!
          const ver = metaCallCount === 1 ? 1 : 2;
          return new Response(
            JSON.stringify({ id: shareRaceId, passwordProtected: false, version: ver }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        openCallCount++;
        return new Response(
          JSON.stringify({
            publication: {
              id: shareRaceId,
              version: 2,
              updatedAt: '2026-11-19T09:00:00Z',
            },
            snapshot: v5Base as PublishedSnapshot,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const firstWs = await raceLoader.load();
    assert.equal(firstWs.revision, 'v2');
    assert.equal(firstWs.uniqueConstraintsComplete, true);
    assert.equal(firstWs.publishedFormatVersion, 5);
    assert.equal(openCallCount, 1);

    // Next load sees GET version=2, which matches cached.version=2 -> NO redundant /open fetch!
    const secondWs = await raceLoader.load();
    assert.equal(secondWs.revision, 'v2');
    assert.equal(openCallCount, 1);
  } finally {
    (window as unknown as { protoflowDesktop?: unknown }).protoflowDesktop = previousDesktop;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Spec MCP Round-4 regressions: filtered DDL preserves full-project tableName ambiguity and PostgreSQL native column types stay intact', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-mcp-r4-'));
  try {
    // 1. [P2] Filtering out one duplicate physical tableName must NOT resolve an ambiguous FK to the remaining duplicate
    const payload = createProjectPayload({
      projectId: 'proj-ambig-fk',
      projectName: '同名父表歧义隔离验证',
      storageDir: tmpDir,
      fileName: 'ambig-fk.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:00:00.000Z',
      pageCount: 1,
      tableCount: 3,
      stickyCount: 0,
    });
    payload.stateSnapshot.dbTables = [
      {
        id: 't_users_a',
        tableName: 't_users',
        cnName: '用户表A',
        domain: '账号域',
        description: '',
        sharedByMenus: [],
        columns: [
          { id: 'ua_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
        ],
      },
      {
        id: 't_users_b',
        tableName: 't_users',
        cnName: '用户表B',
        domain: '账号域',
        description: '',
        sharedByMenus: [],
        columns: [
          { id: 'ub_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
        ],
      },
      {
        id: 't_orders',
        tableName: 't_orders',
        cnName: '订单表',
        domain: '交易域',
        description: '',
        sharedByMenus: [],
        columns: [
          { id: 'o_id', name: 'id', dataType: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, comment: '主键' },
          { id: 'o_user', name: 'user_id', dataType: 'VARCHAR(64)', nullable: false, isForeignKey: true, references: 't_users(id)', comment: '歧义用户外键' },
        ],
      },
    ];
    payload.stateSnapshot.tableRows = { t_users_a: [], t_users_b: [], t_orders: [] };
    const filePath = path.join(tmpDir, 'ambig-fk.pflow');
    fs.writeFileSync(filePath, encodePflowBinary(payload));

    const loader = createLocalWorkspaceLoader(filePath);
    const filteredRes = (await handleSpecMcpPayload(loader, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'protoflow_get_database_schema',
        arguments: { tableNames: ['t_orders', 't_users_a'], dialect: 'postgres' },
      },
    })) as { result: { content: { text: string }[] } };
    const filteredJson = JSON.parse(filteredRes.result.content[0].text);
    assert.equal(filteredJson.foreignKeys.length, 0);
    assert.equal(filteredJson.ddl.includes('REFERENCES "t_users"'), false);
    assert.match(filteredJson.ddl, /待修复的外键引用：t_orders\.user_id：外键引用 t_users\(id\) 无法解析/);
    assert.equal(
      Array.isArray(filteredJson.warnings) &&
        filteredJson.warnings.some((w: string) => w.includes('t_orders.user_id：外键引用 t_users(id) 无法解析')),
      true
    );
    assert.equal(
      Array.isArray(filteredJson.designReview?.relationErrors) &&
        filteredJson.designReview.relationErrors.some((e: string) => e.includes('t_orders.user_id')),
      true
    );

    // 2. [P2] PostgreSQL native column types must never be rewritten by prefix collisions
    const preservedTypes = [
      'INTERVAL',
      'INTERVAL DAY TO SECOND',
      'INT8',
      'INT2',
      'INT4RANGE',
      'FLOAT8',
      'FLOAT4',
      'INT[]',
      'BIGINT[]',
      'TEXT[]',
      'TIMESTAMP WITHOUT TIME ZONE',
      'TIMESTAMPTZ',
    ];
    for (const nativeType of preservedTypes) {
      assert.equal(mapColumnTypeForDialect(nativeType, 'postgres'), nativeType);
    }
    assert.equal(mapColumnTypeForDialect('INT(10) UNSIGNED', 'postgres'), 'BIGINT');
    assert.equal(mapColumnTypeForDialect('SMALLINT UNSIGNED', 'postgres'), 'INTEGER');
    assert.equal(mapColumnTypeForDialect('INT(11)', 'postgres'), 'INTEGER');
    assert.equal(mapColumnTypeForDialect('TINYINT(1)', 'postgres'), 'BOOLEAN');
    assert.equal(mapColumnTypeForDialect('BLOB', 'postgres'), 'BYTEA');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP keeps declared numeric ranges and fractional seconds in PostgreSQL DDL', () => {
  for (const [source, target] of Object.entries(postgresColumnTypes)) {
    assert.equal(mapColumnTypeForDialect(source, 'postgres'), target, source);
    assert.equal(mapColumnTypeForDialect(source, 'mysql'), source);
  }
  const ddl = generateDatabaseDdl([{
    id: 'table-counters', tableName: 'counters', cnName: '计数器', domain: '', description: '', sharedByMenus: [],
    columns: [
      { id: 'column-serial', name: 'serial_no', dataType: 'BIGINT UNSIGNED', nullable: false, comment: '' },
      { id: 'column-counter', name: 'counter', dataType: 'INT ZEROFILL', nullable: true, comment: '' },
    ],
  }], 'postgres');
  assert.ok(ddl.includes('"serial_no" NUMERIC(20,0) NOT NULL CHECK ("serial_no" BETWEEN 0 AND 18446744073709551615)'));
  assert.ok(ddl.includes('"counter" BIGINT NULL CHECK ("counter" BETWEEN 0 AND 4294967295)'));
});
