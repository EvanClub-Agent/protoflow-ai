import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Ajv from 'ajv';
import { createLocalAuthoringWorkspace } from '../src/mcp/authoringWorkspace';
import { buildCanonicalContractSurface, canonicalizeJsonSchema } from '../src/mcp/contractSurface';
import { PROTOFLOW_CONTRACT_DIGEST, PROTOFLOW_SERVER_VERSION } from '../src/mcp/generatedSkillBundle';
import { handleSpecMcpPayload, handleSpecMcpRequest, MCP_TOOL_CATALOGS, SUPPORTED_MCP_PROTOCOLS } from '../src/mcp/protocol';
import type { McpToolDefinition } from '../src/mcp/tools';
import { getMaterialContracts, validateMaterialSource } from '../src/proto/registry/materialContract';
import { UNIVERSAL_COMPONENT_NAMES } from '../src/proto/registry/meta';
import { FREEFORM_DEFAULT_SOURCE } from '../src/proto/freeform/contract';
import {
  DESIGNER_SKILL_ENTRY_URI,
  DESIGNER_SKILL_ROOT_URI,
  MCP_SKILLS_EXTENSION_ID,
} from '../src/mcp/skillsExtension';
import { createLocalWorkspaceLoader } from '../src/mcp/workspace';
import { createProjectPayload } from '../src/services/projectStorage';
import { encodePflowBinary } from '../src/utils/pflowBinaryCodec';

declare const require: NodeRequire;
const { handleMcpFrame, resolveToolsForProfile, tools: fullHermesTools } = require(path.join(
  process.cwd(),
  'electron/protoflow-mcp.cjs',
));
const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};

const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));

test('Hermes MCP: session tool profiles prune out-of-scope schemas and enforce token budgets', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-hermes-profiles-'));
  const prevProfile = process.env.PROTOFLOW_TOOL_PROFILE;
  const prevBinding = process.env.PROTOFLOW_TOOL_BINDING;
  try {
    const ajv = new Ajv({ strict: false });
    for (const tool of fullHermesTools) {
      assert.doesNotThrow(() => ajv.compile(tool.inputSchema), `Invalid schema on Hermes tool ${tool.name}`);
    }

    const fullChars = JSON.stringify(fullHermesTools).length;
    const pageTools = resolveToolsForProfile('page');
    const pageExecTools = resolveToolsForProfile('page-exec');
    const noteTools = resolveToolsForProfile('note-assistant');
    const projectTools = resolveToolsForProfile('project');

    assert.equal(projectTools.length, 33);
    assert.equal(pageTools.length, 19);
    assert.equal(pageExecTools.length, 18);
    assert.equal(noteTools.length, 6);

    // Token/char budget regression gates (down from 40,676 chars baseline)
    assert.ok(fullChars < 30_000, `Expected full Hermes tools < 30k chars, got ${fullChars}`);
    assert.ok(JSON.stringify(pageTools).length < 16_000, `Expected page profile < 16k chars`);
    assert.ok(JSON.stringify(pageExecTools).length < 14_500, `Expected page-exec profile < 14.5k chars`);
    assert.ok(JSON.stringify(noteTools).length < 3_500, `Expected note-assistant profile < 3.5k chars`);

    // Single-page menu sessions never load project-planning or import-reshaping tools
    const pageNames = new Set(pageTools.map((t: { name: string }) => t.name));
    assert.equal(pageNames.has('protoflow_apply_tsx_patch'), true);
    assert.equal(pageNames.has('protoflow_edit_page_block'), true);
    assert.equal(pageNames.has('protoflow_capture_preview'), true);
    assert.equal(pageNames.has('protoflow_set_project_plan'), false);
    assert.equal(pageNames.has('protoflow_revise_project_page'), false);
    assert.equal(pageNames.has('protoflow_reshape_axure_page'), false);
    assert.equal(pageNames.has('protoflow_reshape_figma_page'), false);

    // Stage-2 per-page execution loads brief + history + page/table writers, but excludes plan/sitemap/audit/import tools
    const execNames = new Set(pageExecTools.map((t: { name: string }) => t.name));
    assert.equal(execNames.has('protoflow_get_project_brief'), true);
    assert.equal(execNames.has('protoflow_apply_tsx_patch'), true);
    assert.equal(execNames.has('protoflow_add_preview_scenario'), true);
    assert.equal(execNames.has('protoflow_set_project_plan'), false);
    assert.equal(execNames.has('protoflow_ask_questions'), false);
    assert.equal(execNames.has('protoflow_run_closed_loop_audit'), false);
    assert.equal(execNames.has('protoflow_capture_preview'), false);

    // Note assistant loads strictly read-only inspection tools
    const noteNames = new Set(noteTools.map((t: { name: string }) => t.name));
    assert.equal(noteNames.has('protoflow_get_project'), true);
    assert.equal(noteNames.has('protoflow_get_project_notes'), true);
    assert.equal(noteNames.has('protoflow_apply_tsx_patch'), false);
    assert.equal(noteNames.has('protoflow_upsert_db_table'), false);

    // Verify handleMcpFrame writes the exact pruned list into tool-registration.json
    const ctxFile = path.join(tmpDir, 'context.json');
    process.env.PROTOFLOW_TOOL_PROFILE = 'page';
    process.env.PROTOFLOW_TOOL_BINDING = 'bind-page-123';
    const listFrame = await handleMcpFrame(ctxFile, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const registeredTools = listFrame.result.tools.map((tool: { name: string }) => tool.name);
    assert.deepEqual(registeredTools, [...pageNames]);
    assert.ok(registeredTools.includes('protoflow_review_db_requirements'));
    assert.ok(registeredTools.includes('protoflow_search_history'));
    const receipt = JSON.parse(fs.readFileSync(path.join(tmpDir, 'tool-registration.json'), 'utf8'));
    assert.equal(receipt.binding, 'bind-page-123');
    assert.deepEqual(receipt.tools, pageTools.map((t: { name: string }) => t.name));

    const sessionId = 'menu-s1';
    const source = { id: 'requirement-1', label: '用户原文', text: '订单编号必须唯一。' };
    const scope = { projectId: 'p1', pageId: 'orders' };
    const allowedHistorySessions = HermesRuntime.prototype.buildAllowedHistorySessions(scope, { sessionId, dir: tmpDir });
    fs.writeFileSync(ctxFile, JSON.stringify({
      ...scope, sessionId, runId: 'r1', active: true, operations: [], allowedHistorySessions,
      nativeBridge: { home: tmpDir, python: 'python3', installDir: tmpDir },
      snapshot: { requirementSources: [source], dbTables: [] },
    }));
    const pool = { request: async (_bridge: unknown, request: unknown) => {
      assert.deepEqual(request, { action: 'history', sessionId, query: '订单编号', offset: undefined,
        allowedHistorySessions: [{ sessionId, role: 'menu_session', expectedCwd: tmpDir }] });
      return { mode: 'persistent', result: { sessionId, excerpts: ['订单编号必须唯一。'] } };
    } };
    const callRegisteredTool = async (name: string, args: Record<string, unknown>) => {
      assert.ok(registeredTools.includes(name));
      const frame = await handleMcpFrame(ctxFile, { jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name, arguments: args } }, { pool });
      assert.ok(!frame.result.isError, frame.result.content[0].text);
      return JSON.parse(frame.result.content[0].text);
    };
    const review = await callRegisteredTool('protoflow_review_db_requirements', {});
    assert.equal(review.sources[0].text, source.text);
    const finding = { quote: source.text, state: 'gap', note: '当前模型尚无订单编号唯一约束' };
    await callRegisteredTool('protoflow_review_db_requirements', { sourceId: review.sources[0].id, findings: [finding] });
    assert.deepEqual(JSON.parse(fs.readFileSync(ctxFile, 'utf8')).requirementFindings,
      [{ sourceId: source.id, findings: [finding] }]);
    const history = await callRegisteredTool('protoflow_search_history', { query: '订单编号' });
    assert.deepEqual(history.excerpts, [source.text]);

    // Verify HermesRuntime maps scopes to the expected PROTOFLOW_TOOL_PROFILE env var
    const fakeRuntime = Object.assign(Object.create(HermesRuntime.prototype), { nodeBinary: process.execPath });
    assert.equal(fakeRuntime.toolProfileForScope({ projectId: 'p1', pageId: 'home' }, false), 'page');
    assert.equal(fakeRuntime.toolProfileForScope({ projectId: 'p1', kind: 'project', threadId: 'note-assistant' }, false), 'note-assistant');
    assert.equal(fakeRuntime.toolProfileForScope({ projectId: 'p1', kind: 'project' }, false), 'project');
    assert.equal(fakeRuntime.toolProfileForScope({ projectId: 'p1', kind: 'project' }, true), 'page-exec');

    const pageMcpEnv = fakeRuntime.mcp(tmpDir, 'b1', 'page')[0].env;
    assert.equal(pageMcpEnv.find((e: { name: string }) => e.name === 'PROTOFLOW_TOOL_PROFILE')?.value, 'page');
    const projMcpEnv = fakeRuntime.mcp(tmpDir, 'b2', 'project')[0].env;
    assert.equal(projMcpEnv.find((e: { name: string }) => e.name === 'PROTOFLOW_TOOL_PROFILE'), undefined);
  } finally {
    if (prevProfile === undefined) delete process.env.PROTOFLOW_TOOL_PROFILE;
    else process.env.PROTOFLOW_TOOL_PROFILE = prevProfile;
    if (prevBinding === undefined) delete process.env.PROTOFLOW_TOOL_BINDING;
    else process.env.PROTOFLOW_TOOL_BINDING = prevBinding;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('modern MCP validates request metadata while preserving the legacy initialize handshake', async () => {
  const loader = { load: async () => { throw new Error('Unexpected workspace load'); } };
  const connection = { modern: false };
  const request = (method: string, params: Record<string, unknown>) =>
    handleSpecMcpRequest(loader, { jsonrpc: '2.0', id: 1, method, params }, connection);
  const versionKey = 'io.modelcontextprotocol/protocolVersion';
  const capsKey = 'io.modelcontextprotocol/clientCapabilities';
  for (const method of ['server/discover', 'skills/list', 'skills/get', 'resources/directory/read']) {
    for (const meta of [undefined, {}, { [capsKey]: {} }, { [versionKey]: '2026-07-28' },
      { ...modernMeta, [capsKey]: null }, { ...modernMeta, [capsKey]: [] }, { ...modernMeta, [versionKey]: 2026 }]) {
      assert.equal((await request(method, { _meta: meta }))?.error?.code, -32602, method);
    }
  }
  assert.ok((await request('server/discover', { _meta: modernMeta }))?.result);
  assert.equal((await request('tools/list', {}))?.error?.code, -32602);
  assert.equal((await request('tools/call', { _meta: { [versionKey]: '2026-07-28' } }))?.error?.code, -32602);
  const initialized = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal((initialized?.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
  assert.deepEqual((await request('ping', {}))?.result, {});
  assert.ok((await request('tools/list', {}))?.result);
});

test('modern resource reads distinguish an unknown URI from a workspace failure', async () => {
  let loads = 0;
  const loader = { load: async () => { loads++; throw new Error('Workspace unavailable'); } };
  const read = (uri: string) => handleSpecMcpRequest(loader, { jsonrpc: '2.0', id: 1, method: 'resources/read',
    params: { uri, _meta: modernMeta } });
  for (const uri of ['protoflow://spec/missing', 'protoflow://authoring/playbook']) {
    assert.equal((await read(uri))?.error?.code, -32602);
  }
  assert.equal(loads, 0);
  assert.deepEqual((await read('protoflow://spec/markdown'))?.error, { code: -32603, message: 'Workspace unavailable' });
  assert.equal(loads, 1);
});

test('the skill build preserves nested YAML, scalar types, block strings and CRLF', () => {
  const { parseSkillFrontmatter } = require(path.join(process.cwd(), 'scripts/build-material-contract.cjs'));
  const markdown = ['---', 'name: alex-protoflow-designer', 'description: >-', '  Design', '  prototypes.',
    'metadata:', '  owner: "Design #1"', '  labels: [reviews, "001"]', 'flags: [true, 2, null]',
    'notes: |', '  line one', '  line two', '---', 'Body'].join('\r\n');
  assert.deepEqual(parseSkillFrontmatter(markdown), {
    name: 'alex-protoflow-designer', description: 'Design prototypes.',
    metadata: { owner: 'Design #1', labels: ['reviews', '001'] }, flags: [true, 2, null], notes: 'line one\nline two\n',
  });
  assert.throws(() => parseSkillFrontmatter('---\nname: first\nname: second\ndescription: Example\n---\n'));
});

test('External MCP: Skills over MCP (io.modelcontextprotocol/skills), MCP 2026-07-28 discovery, manifest integrity, and embedded CLI bundle', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-skills-over-mcp-'));
  try {
    const project = createProjectPayload({
      projectId: 'p-skills',
      projectName: 'Skills Project',
      storageDir: tmpDir,
      fileName: 'skills.pflow',
      templateId: 'blank_project',
      createdAt: '2026-11-26',
      updatedAt: '2026-11-26',
      pageCount: 0,
      tableCount: 0,
      stickyCount: 0,
    });
    const pflowPath = path.join(tmpDir, 'skills.pflow');
    fs.writeFileSync(pflowPath, encodePflowBinary(project));

    const roLoader = createLocalWorkspaceLoader(pflowPath);
    const rwLoader = createLocalAuthoringWorkspace({ projectPath: pflowPath });

    // 1. Modern MCP 2026-07-28 server/discover & version negotiation
    assert.equal(SUPPORTED_MCP_PROTOCOLS.includes('2026-07-28'), true);
    const unsupportedRes = await handleSpecMcpPayload(rwLoader, {
      jsonrpc: '2.0',
      id: 'bad-ver',
      method: 'tools/list',
      params: { _meta: { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '1999-01-01' } },
    });
    assert.ok(unsupportedRes && !Array.isArray(unsupportedRes));
    assert.equal(unsupportedRes.error?.code, -32022);
    assert.deepEqual((unsupportedRes.error?.data as { requested: string }).requested, '1999-01-01');

    const rwDiscover = await handleSpecMcpPayload(rwLoader, {
      jsonrpc: '2.0',
      id: 'disc-rw',
      method: 'server/discover',
      params: { _meta: modernMeta },
    });
    assert.ok(rwDiscover && !Array.isArray(rwDiscover) && !rwDiscover.error);
    const discResult = rwDiscover.result as Record<string, any>;
    assert.equal(discResult.resultType, 'complete');
    assert.equal(discResult.supportedVersions[0], '2026-07-28');
    assert.deepEqual(discResult.capabilities.extensions[MCP_SKILLS_EXTENSION_ID], { directoryRead: true });
    assert.equal(discResult.ttlMs, 300_000);

    // Read-only mode omits the authoring skills extension and rejects skills/list
    const roDiscover = await handleSpecMcpPayload(roLoader, {
      jsonrpc: '2.0',
      id: 'disc-ro',
      method: 'server/discover',
      params: { _meta: modernMeta },
    });
    assert.ok(roDiscover && !Array.isArray(roDiscover));
    assert.equal((roDiscover.result as Record<string, any>).capabilities.extensions, undefined);
    const roSkillsList = await handleSpecMcpPayload(roLoader, {
      jsonrpc: '2.0',
      id: 'ro-sl',
      method: 'skills/list',
      params: { _meta: modernMeta },
    });
    assert.ok(roSkillsList && !Array.isArray(roSkillsList));
    assert.equal(roSkillsList.error?.code, -32601);

    // 2. Modern tools/list schema compactness & Ajv validity
    const modernToolsRes = await handleSpecMcpPayload(rwLoader, {
      jsonrpc: '2.0',
      id: 'tl-modern',
      method: 'tools/list',
      params: { _meta: modernMeta },
    });
    assert.ok(modernToolsRes && !Array.isArray(modernToolsRes));
    const modernToolsBody = modernToolsRes.result as {
      resultType: string;
      ttlMs: number;
      cacheScope: string;
      tools: { name: string; inputSchema: object }[];
    };
    assert.equal(modernToolsBody.resultType, 'complete');
    assert.equal(modernToolsBody.ttlMs, 300_000);
    assert.ok(JSON.stringify(modernToolsBody.tools).length < 31_500, 'Expected slimmed external tools JSON < 31.5k chars');
    const ajv = new Ajv({ strict: false });
    for (const tool of modernToolsBody.tools) {
      assert.doesNotThrow(() => ajv.compile(tool.inputSchema), `Invalid schema on external tool ${tool.name}`);
    }

    // 3. skills/list, skills/get, host cryptographic manifest & frontmatter verification
    const listRes = await handleSpecMcpPayload(rwLoader, {
      jsonrpc: '2.0',
      id: 'sl-1',
      method: 'skills/list',
      params: { _meta: modernMeta },
    });
    assert.ok(listRes && !Array.isArray(listRes) && !listRes.error);
    const listBody = listRes.result as {
      resultType: string;
      ttlMs: number;
      cacheScope: string;
      skills: {
        uri: string;
        frontmatter: Record<string, unknown>;
        resources: { uri: string; digest: string; size: number }[];
      }[];
    };
    assert.equal(listBody.resultType, 'complete');
    assert.equal(listBody.cacheScope, 'public');
    assert.equal(listBody.skills.length, 1);
    const skillEntry = listBody.skills[0];
    assert.equal(skillEntry.uri, DESIGNER_SKILL_ENTRY_URI);
    assert.equal(skillEntry.frontmatter.name, 'alex-protoflow-designer');
    assert.equal(skillEntry.resources.length, 5);

    const getRes = await handleSpecMcpPayload(rwLoader, {
      jsonrpc: '2.0',
      id: 'sg-1',
      method: 'skills/get',
      params: { _meta: modernMeta, uri: DESIGNER_SKILL_ENTRY_URI },
    });
    assert.ok(getRes && !Array.isArray(getRes) && !getRes.error);
    assert.deepEqual((getRes.result as { skill: unknown }).skill, skillEntry);

    // Simulate SEP-2640 host verification across every file in the manifest
    for (const item of skillEntry.resources) {
      const readRes = await handleSpecMcpPayload(rwLoader, {
        jsonrpc: '2.0',
        id: `read-${item.uri}`,
        method: 'resources/read',
        params: { _meta: modernMeta, uri: item.uri },
      });
      assert.ok(readRes && !Array.isArray(readRes) && !readRes.error);
      const readBody = readRes.result as {
        resultType: string;
        contents: { uri: string; mimeType: string; text: string }[];
      };
      assert.equal(readBody.resultType, 'complete');
      assert.equal(readBody.contents[0].mimeType, 'text/markdown');
      const rawBytes = Buffer.from(readBody.contents[0].text, 'utf8');
      assert.equal(rawBytes.length, item.size, `Size mismatch on ${item.uri}`);
      const actualDigest = `sha256:${createHash('sha256').update(rawBytes).digest('hex')}`;
      assert.equal(actualDigest, item.digest, `Digest mismatch on ${item.uri}`);
      if (item.uri === DESIGNER_SKILL_ENTRY_URI) {
        const header = readBody.contents[0].text.split(/^---[ \t]*\r?$/m)[1];
        const { load, CORE_SCHEMA } = require('js-yaml');
        assert.deepEqual(skillEntry.frontmatter, load(header, { schema: CORE_SCHEMA }));
      }
    }

    // 4. resources/directory/read and -32602 error contracts
    const rootDirRes = await handleSpecMcpPayload(rwLoader, {
      jsonrpc: '2.0',
      id: 'dir-root',
      method: 'resources/directory/read',
      params: { _meta: modernMeta, uri: DESIGNER_SKILL_ROOT_URI },
    });
    assert.ok(rootDirRes && !Array.isArray(rootDirRes) && !rootDirRes.error);
    const rootChildren = (rootDirRes.result as { resources: { uri: string; name: string; mimeType: string }[] }).resources;
    assert.deepEqual(rootChildren, [
      { uri: `${DESIGNER_SKILL_ROOT_URI}/SKILL.md`, name: 'SKILL.md', mimeType: 'text/markdown' },
      { uri: `${DESIGNER_SKILL_ROOT_URI}/references`, name: 'references', mimeType: 'inode/directory' },
    ]);

    const refsDirRes = await handleSpecMcpPayload(rwLoader, {
      jsonrpc: '2.0',
      id: 'dir-refs',
      method: 'resources/directory/read',
      params: { _meta: modernMeta, uri: `${DESIGNER_SKILL_ROOT_URI}/references` },
    });
    assert.ok(refsDirRes && !Array.isArray(refsDirRes) && !refsDirRes.error);
    assert.equal((refsDirRes.result as { resources: unknown[] }).resources.length, 4);

    for (const badReq of [
      { method: 'skills/get', params: { _meta: modernMeta, uri: 'skill://unknown/SKILL.md' } },
      { method: 'resources/read', params: { _meta: modernMeta, uri: `${DESIGNER_SKILL_ROOT_URI}/references/missing.md` } },
      { method: 'resources/directory/read', params: { _meta: modernMeta, uri: `${DESIGNER_SKILL_ROOT_URI}/` } },
      { method: 'skills/list', params: { _meta: modernMeta, cursor: 'opaque-bad' } },
    ]) {
      const errRes = await handleSpecMcpPayload(rwLoader, { jsonrpc: '2.0', id: 'err', ...badReq });
      assert.ok(errRes && !Array.isArray(errRes));
      assert.equal(errRes.error?.code, -32602, `Expected -32602 for ${badReq.method}`);
    }

    // 5. Verify standalone bundled CLI serves embedded skill from an isolated cwd without local skills/ folder
    const cliPath = path.join(tmpDir, 'cli.cjs');
    fs.copyFileSync(path.join(process.cwd(), 'packages/protoflow-mcp/dist/cli.cjs'), cliPath);
    const stdinPayload = [
      { method: 'skills/list', params: { _meta: modernMeta } },
      { method: 'resources/read', params: { _meta: modernMeta, uri: `${DESIGNER_SKILL_ROOT_URI}/references/axure-reshape.md` } },
      { method: 'tools/list', params: {} },
    ].map((frame, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...frame })).join('\n') + '\n';
    const proc = spawnSync(process.execPath, [cliPath, '--mode', 'readwrite', '--workspace', tmpDir], {
      cwd: tmpDir,
      input: stdinPayload,
      encoding: 'utf8',
    });
    assert.equal(proc.status, 0, proc.stderr);
    const responses = proc.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(responses[0].result.skills[0].uri, DESIGNER_SKILL_ENTRY_URI);
    assert.match(responses[1].result.contents[0].text, /protoflow_reshape_imported_page/);
    assert.equal(responses[2].error.code, -32602);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Contract digest stamps SKILL.md, ignores prose-only edits, and detects stale skill drift on status', async () => {
  const {
    computeContractDigestFromPayload,
    parseSkillFrontmatter,
    stampDesignerSkillMarkdown,
  } = require(path.join(process.cwd(), 'scripts/build-material-contract.cjs'));

  // 1. Deterministic structural digest matches generated bundle & on-disk SKILL.md
  assert.match(PROTOFLOW_CONTRACT_DIGEST, /^sha256:[0-9a-f]{16}$/);
  const baseSurface = buildCanonicalContractSurface();
  assert.equal(computeContractDigestFromPayload(baseSurface), PROTOFLOW_CONTRACT_DIGEST);

  const diskSkillMd = fs.readFileSync(path.resolve('skills/alex-protoflow-designer/SKILL.md'), 'utf8');
  const diskFrontmatter = parseSkillFrontmatter(diskSkillMd);
  assert.deepEqual(diskFrontmatter.metadata, {
    serverVersion: PROTOFLOW_SERVER_VERSION,
    contractDigest: PROTOFLOW_CONTRACT_DIGEST,
  });
  assert.ok(
    diskSkillMd.includes(`protoflow_workspace(action="status", expectedContractDigest="${PROTOFLOW_CONTRACT_DIGEST}")`),
    'Expected Rule 1 in SKILL.md to carry stamped expectedContractDigest',
  );
  // Stamping is idempotent
  assert.equal(
    stampDesignerSkillMarkdown(diskSkillMd, PROTOFLOW_SERVER_VERSION, PROTOFLOW_CONTRACT_DIGEST),
    diskSkillMd,
  );

  // 2. Prose-only description edits do not cause false drift; structural schema edits change the digest
  const proseEditedTools = [
    {
      name: 'protoflow_demo',
      inputSchema: {
        type: 'object',
        title: 'Title A',
        description: 'Original prose wording',
        required: ['b', 'a'],
        properties: {
          b: { type: 'string', description: 'Field B prose' },
          a: { type: 'number', minimum: 1 },
        },
      },
    },
  ];
  const rewordedTools = [
    {
      name: 'protoflow_demo',
      inputSchema: {
        type: 'object',
        title: 'Updated Title B',
        description: 'Completely rewritten human prose without schema change',
        required: ['a', 'b'],
        properties: {
          a: { type: 'number', minimum: 1, description: 'Added prose' },
          b: { type: 'string', description: 'Updated prose' },
        },
      },
    },
  ];
  const digestWithLocalTools = (tools: Pick<McpToolDefinition, 'name' | 'inputSchema'>[]) =>
    computeContractDigestFromPayload(buildCanonicalContractSurface({ toolCatalogs: { ...MCP_TOOL_CATALOGS, local_file: tools } }));
  assert.equal(digestWithLocalTools(proseEditedTools), digestWithLocalTools(rewordedTools));
  const structurallyChangedTools = [
    {
      name: 'protoflow_demo',
      inputSchema: {
        type: 'object',
        required: ['a', 'b'],
        properties: {
          a: { type: 'number', minimum: 2 },
          b: { type: 'string' },
        },
      },
    },
  ];
  assert.notEqual(digestWithLocalTools(proseEditedTools), digestWithLocalTools(structurallyChangedTools));

  // 3. protoflow_workspace(status) & protoflow_get_contracts expose digest and flag drift across local_file & desktop_bridge
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-contract-drift-'));
  try {
    const rwLoader = createLocalAuthoringWorkspace({ workspaceDir: tmpDir });
    const callTool = async (loader: Parameters<typeof handleSpecMcpPayload>[0], name: string, args: Record<string, unknown>) => {
      const res = await handleSpecMcpPayload(loader, {
        jsonrpc: '2.0',
        id: 'call',
        method: 'tools/call',
        params: { _meta: modernMeta, name, arguments: args },
      });
      assert.ok(res && !Array.isArray(res) && !res.error);
      return res.result as { isError?: boolean; content: { text: string }[] };
    };

    const plainStatusRes = await callTool(rwLoader, 'protoflow_workspace', { action: 'status' });
    assert.notEqual(plainStatusRes.isError, true);
    const plainStatus = JSON.parse(plainStatusRes.content[0].text);
    assert.equal(plainStatus.serverVersion, PROTOFLOW_SERVER_VERSION);
    assert.equal(plainStatus.contractDigest, PROTOFLOW_CONTRACT_DIGEST);
    assert.equal(plainStatus.contractCheckStatus, 'unchecked');
    assert.match(plainStatus.contractCheckNotice, /SKILL\.md.*metadata\.contractDigest/);
    assert.match(plainStatus.contractCheckNotice, /refresh|刷新/);
    assert.equal(plainStatus.contractMatch, undefined);
    assert.equal(plainStatus.contractDriftWarning, undefined);

    const matchedStatus = JSON.parse(
      (
        await callTool(rwLoader, 'protoflow_workspace', {
          action: 'status',
          expectedContractDigest: PROTOFLOW_CONTRACT_DIGEST,
        })
      ).content[0].text,
    );
    assert.equal(matchedStatus.contractMatch, true);
    assert.equal(matchedStatus.contractCheckStatus, 'matched');
    assert.equal(matchedStatus.contractDriftWarning, undefined);

    const staleDigest = 'sha256:0123456789abcdef';
    const driftedStatus = JSON.parse(
      (
        await callTool(rwLoader, 'protoflow_workspace', {
          action: 'status',
          expectedContractDigest: staleDigest,
        })
      ).content[0].text,
    );
    assert.equal(driftedStatus.contractMatch, false);
    assert.equal(driftedStatus.contractCheckStatus, 'mismatched');
    assert.equal(driftedStatus.contractDigest, PROTOFLOW_CONTRACT_DIGEST);
    assert.match(driftedStatus.contractDriftWarning, new RegExp(staleDigest));
    assert.match(driftedStatus.contractDriftWarning, new RegExp(PROTOFLOW_CONTRACT_DIGEST));

    const emptyDigestRes = await callTool(rwLoader, 'protoflow_workspace', {
      action: 'status',
      expectedContractDigest: '   ',
    });
    assert.equal(emptyDigestRes.isError, true);

    const contractsSummary = JSON.parse((await callTool(rwLoader, 'protoflow_get_contracts', {})).content[0].text);
    assert.equal(contractsSummary.serverVersion, PROTOFLOW_SERVER_VERSION);
    assert.equal(contractsSummary.contractDigest, PROTOFLOW_CONTRACT_DIGEST);

    const contractsDetail = JSON.parse(
      (await callTool(rwLoader, 'protoflow_get_contracts', { componentNames: ['Page', 'Table'] })).content[0].text,
    );
    assert.equal(contractsDetail.serverVersion, PROTOFLOW_SERVER_VERSION);
    assert.equal(contractsDetail.contractDigest, PROTOFLOW_CONTRACT_DIGEST);

    // Verify desktop_bridge schema preserves expectedContractDigest without requiring expectedRevision
    const desktopMock = {
      mode: 'readwrite' as const,
      canWrite: true,
      transport: 'desktop_bridge' as const,
      hasActiveProject: () => true,
      load: async () => { throw new Error('unused'); },
      getContext: async () => ({
        transport: 'desktop_bridge' as const,
        projectPath: '/tmp/live.pflow',
        workspaceDir: '/tmp',
        projectId: 'p-live',
        projectName: 'Live',
        projectMode: 'desktop' as const,
        revision: 'rev-1',
        activePageId: 'home',
        selectedPfId: null,
        viewMode: 'canvas',
      }),
      listProjects: async () => ({ directory: '/tmp', projects: [] }),
      createProject: async () => { throw new Error('unsupported'); },
      switchProject: async () => { throw new Error('unsupported'); },
      mutate: async () => { throw new Error('unsupported'); },
    };
    const desktopToolsRes = await handleSpecMcpPayload(desktopMock, {
      jsonrpc: '2.0',
      id: 'dt',
      method: 'tools/list',
      params: { _meta: modernMeta },
    });
    assert.ok(desktopToolsRes && !Array.isArray(desktopToolsRes) && !desktopToolsRes.error);
    const desktopWorkspaceTool = (desktopToolsRes.result as { tools: { name: string; inputSchema: any }[] }).tools.find(
      (t) => t.name === 'protoflow_workspace',
    )!;
    assert.ok(desktopWorkspaceTool.inputSchema.properties.expectedContractDigest);
    assert.ok(!desktopWorkspaceTool.inputSchema.required?.includes('expectedRevision'));

    const desktopDrift = JSON.parse(
      (
        await callTool(desktopMock, 'protoflow_workspace', {
          action: 'status',
          expectedContractDigest: staleDigest,
        })
      ).content[0].text,
    );
    assert.equal(desktopDrift.transport, 'desktop_bridge');
    assert.equal(desktopDrift.contractMatch, false);
    assert.equal(desktopDrift.contractCheckStatus, 'mismatched');
    assert.match(desktopDrift.contractDriftWarning, /drift|不一致/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('contract digest includes the schemas actually advertised in every workspace mode', async () => {
  const surface = buildCanonicalContractSurface();
  const local = createLocalAuthoringWorkspace({ workspaceDir: os.tmpdir() });
  const desktop = { ...local, transport: 'desktop_bridge' as const };
  const loaders = {
    readonly: { load: local.load },
    local_file: local,
    desktop_bridge: desktop,
    desktop_bridge_with_preview: { ...desktop, capturePreview: async () => { throw new Error('unused'); } },
  };
  for (const [profile, loader] of Object.entries(loaders)) {
    const response = await handleSpecMcpRequest(loader, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const published = (response?.result as { tools: McpToolDefinition[] }).tools;
    const expected = Object.fromEntries(published.map(t => [t.name, canonicalizeJsonSchema(t.inputSchema)]));
    assert.deepEqual(Object.fromEntries(surface.tools[profile].map(t => [t.name, t.inputSchema])), expected, profile);
  }

  const desktopTools = MCP_TOOL_CATALOGS.desktop_bridge.map(tool => {
    if (tool.name !== 'protoflow_write_page') return tool;
    const required = tool.inputSchema.required as string[];
    assert.ok(required.includes('expectedRevision'));
    return { ...tool, inputSchema: { ...tool.inputSchema, required: required.filter(key => key !== 'expectedRevision') } };
  });
  const changed = buildCanonicalContractSurface({ toolCatalogs: { ...MCP_TOOL_CATALOGS, desktop_bridge: desktopTools } });
  const { computeContractDigestFromPayload } = require(path.resolve('scripts/build-material-contract.cjs'));
  assert.notEqual(computeContractDigestFromPayload(changed), PROTOFLOW_CONTRACT_DIGEST);
});

test('contract digest preserves JSON literals and schema map names while ignoring schema annotations', () => {
  const { computeContractDigestFromPayload: hash } = require(path.resolve('scripts/build-material-contract.cjs'));
  const digest = (schema: Record<string, unknown>) => hash(canonicalizeJsonSchema(schema));
  const original = { title: 'one', description: 'A', required: ['b', 'a'] };
  for (const keyword of ['const', 'default', 'enum']) {
    const schema = (value: object) => ({ properties: { payload: { [keyword]: keyword === 'enum' ? [value] : value } } });
    const before = digest(schema(original));
    assert.equal(before, digest(schema({ required: ['b', 'a'], description: 'A', title: 'one' })));
    assert.notEqual(before, digest(schema({ ...original, title: 'two' })));
    assert.notEqual(before, digest(schema({ ...original, description: 'B' })));
    assert.notEqual(before, digest(schema({ ...original, required: ['a', 'b'] })));
  }
  for (const keyword of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    const schema = (type: string, prose: string) => ({ [keyword]: { title: { anyOf: [{ type, description: prose }] } } });
    assert.equal(digest(schema('string', 'A')), digest(schema('string', 'B')));
    assert.notEqual(digest(schema('string', 'A')), digest(schema('number', 'A')));
  }
  const definitions = (type: string) => buildCanonicalContractSurface({ valueDefinitions: { description: { type } } });
  assert.notEqual(hash(definitions('string')), hash(definitions('number')));
});

test('contract digest follows the validator platform registry and explicit property defaults', () => {
  const { computeContractDigestFromPayload: hash } = require(path.resolve('scripts/build-material-contract.cjs'));
  const source = `export default function Page(){return (<MobilePage pfId="root"><Freeform pfId="free" source={${JSON.stringify(FREEFORM_DEFAULT_SOURCE)}}/></MobilePage>);}`;
  assert.deepEqual(validateMaterialSource(source), []);
  assert.ok(UNIVERSAL_COMPONENT_NAMES.delete('Freeform'));
  try {
    assert.ok(validateMaterialSource(source).some(error => error.includes('Freeform') && error.includes('MobilePage')));
    assert.notEqual(hash(buildCanonicalContractSurface()), PROTOFLOW_CONTRACT_DIGEST);
  } finally {
    UNIVERSAL_COMPONENT_NAMES.add('Freeform');
  }

  const materials = getMaterialContracts();
  const prop = materials.find(m => m.name === 'Pagination')!.props.find(p => p.name === 'pageSize')!;
  const original = prop.default;
  assert.equal(typeof original, 'number');
  prop.default = Number(original) + 1;
  assert.notEqual(hash(buildCanonicalContractSurface({ materials })), PROTOFLOW_CONTRACT_DIGEST);
  delete prop.default;
  const missing = hash(buildCanonicalContractSurface({ materials }));
  prop.default = null;
  assert.notEqual(hash(buildCanonicalContractSurface({ materials })), missing);
});

test('contract digest is identical in separate English and Czech build processes', () => {
  const script = 'const {evaluateContractDigest} = require("./scripts/build-material-contract.cjs");' +
    'process.stdout.write(evaluateContractDigest(process.cwd(), require("./package.json").version));';
  for (const locale of ['en_US.UTF-8', 'cs_CZ.UTF-8']) {
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8', env: { ...process.env, LANG: locale, LC_ALL: locale },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, PROTOFLOW_CONTRACT_DIGEST, locale);
  }
});

test('stamped skill gives schema-valid status calls for both legacy and current servers', () => {
  const { stampDesignerSkillMarkdown } = require(path.resolve('scripts/build-material-contract.cjs'));
  const markdown = fs.readFileSync(path.resolve('skills/alex-protoflow-designer/SKILL.md'), 'utf8');
  const nextDigest = 'sha256:0123456789abcdef';
  const stamped = stampDesignerSkillMarkdown(markdown, PROTOFLOW_SERVER_VERSION, nextDigest);
  const rule = stamped.split(/\r?\n/).find((line: string) => line.startsWith('1. **Workspace first**.'))!;
  const calls = [...rule.matchAll(/`protoflow_workspace\(action="status"(?:, expectedContractDigest="([^"]+)")?\)`/g)]
    .map(match => match[1] ? { action: 'status', expectedContractDigest: match[1] } : { action: 'status' });
  assert.match(rule, /If it declares `expectedContractDigest`/);
  assert.deepEqual(calls, [{ action: 'status', expectedContractDigest: nextDigest }, { action: 'status' }]);
  assert.match(stamped, /missing `contractDigest` or `contractMatch` means the skill is unverified[^\n]+protoflow_get_contracts/);

  const ajv = new Ajv();
  const validateCurrent = ajv.compile(MCP_TOOL_CATALOGS.desktop_bridge.find(t => t.name === 'protoflow_workspace')!.inputSchema);
  // The pre-digest release rejects extra keys. Only the status action is needed for this fixture.
  const validateLegacy = ajv.compile({ type: 'object', properties: { action: { const: 'status' } }, additionalProperties: false });
  assert.ok(validateCurrent(calls[0]));
  assert.equal(validateLegacy(calls[0]), false);
  assert.ok(validateLegacy(calls[1]));
});
