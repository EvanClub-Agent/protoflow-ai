import { capturePreviewTool, parseCaptureOptions } from './capturePreview';
import type { LosslessNumber } from 'lossless-json';
import { tr } from '../i18n/runtime';
import {
  AUTHORING_MCP_PROMPTS,
  AUTHORING_MCP_RESOURCES,
  DOMAIN_MCP_TOOLS,
  executeAuthoringTool,
  getAuthoringPrompt,
  isAuthoringToolName,
  readAuthoringResource,
} from './authoringCore';
import { isAuthoringWorkspace } from './authoringTypes';
import { PROTOFLOW_SERVER_VERSION } from './generatedSkillBundle';
import {
  getMcpSkill,
  listMcpSkills,
  MCP_SKILLS_EXTENSION_ID,
  McpRpcError,
  readMcpSkillDirectory,
  readMcpSkillResource,
} from './skillsExtension';
import {
  executeSpecTool,
  getSpecPrompt,
  readSpecResource,
  SPEC_MCP_PROMPTS,
  SPEC_MCP_RESOURCES,
  SPEC_MCP_TOOLS,
} from './tools';
import type { WorkspaceLoader } from './workspace';

const MODERN_PROTOCOL = '2026-07-28';
const LEGACY_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SUPPORTED_MCP_PROTOCOLS = [MODERN_PROTOCOL, ...LEGACY_PROTOCOLS] as const;
export const SPEC_MCP_SERVER_NAME = 'protoflow-spec';
export const SPEC_MCP_SERVER_VERSION = PROTOFLOW_SERVER_VERSION;

type RpcId = string | number | LosslessNumber | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === 'string' && (LEGACY_PROTOCOLS as readonly string[]).includes(requested)) {
    return requested;
  }
  return '2025-03-26';
}

const SERVER_INSTRUCTIONS = [
  'Alex (ProtoFlow AI) Read-Only Specification MCP Server.',
  '1. Call protoflow_get_project_overview first to understand the sitemap, pages, and shared physical tables.',
  '2. Call protoflow_get_database_schema to inspect ER tables, foreign keys, SQL DDL, and sample seed rows.',
  '3. Call protoflow_get_page_spec for each target page to inspect UI layout, table bindings, interactive actions, and pinned sticky-note rules.',
  '4. Call protoflow_get_implementation_checklist at the end to verify full-stack coverage.',
].join(' ');

const authoringInstructions = (desktop: boolean, capture: boolean) => [
  'Alex (ProtoFlow AI) Read-Write Prototype Authoring MCP Server.',
  desktop
    ? '1. Call protoflow_workspace(action="status") first to verify projectId, activePageId and selectedPfId. Pass the status revision as expectedRevision on the first write. Send only one desktop write at a time across all tools. Wait for each successful write and pass its returned revision unchanged as expectedRevision on the next write. On a conflict, stop, re-read status and inspect the changed state before retrying.'
    : '1. Call protoflow_workspace(action="status") first (and create_project / switch_project if no .pflow project is active), then inspect existing structure via protoflow_workspace(action="overview") and protoflow_database(action="get_schema").',
  '2. Before writing any TSX page, call protoflow_workspace(action="guide") and protoflow_workspace(action="contracts") to verify registered components, props, and runtime actions — never guess AntD props or write inline JS callbacks.',
  '3. Create sitemap folders (protoflow_sitemap), normalized shared ER tables (protoflow_database action="upsert_tables"), and coherent seed rows (protoflow_database action="seed_rows") before writing pages.',
  '4. Create/overwrite pages with protoflow_page(action="write_page") or edit subtrees losslessly with protoflow_page(action="edit_block"); never mix desktop <Page> and mobile <MobilePage> (M*) components.',
  '5. Attach PRD notes, Mermaid mindmaps, and component sticky-note rules via protoflow_docs, and finish with protoflow_audit(action="audit_project") until healthy is true.',
  ...(capture ? ['6. After a page edit, call protoflow_capture_preview for a visual check. Use fullPage for content below the fold and inspect the returned revision.'] : []),
].join(' ');

const DESKTOP_WRITE_ACTIONS: Record<string, string | null> = {
  protoflow_workspace: 'update_project_meta',
  protoflow_database: 'upsert_tables, upsert_columns, delete_tables, seed_rows, and clear_rows',
  protoflow_page: 'write_page, edit_block, reshape_axure_page, bind_axure_table, optimize_axure_block, and reshape_figma_page',
  protoflow_docs: 'all write actions (every action except get_docs)',
};

const desktopTools = DOMAIN_MCP_TOOLS.map(tool => {
  const { properties, required = [] } = tool.inputSchema as { properties: Record<string, object>; required?: string[] };
  if (!Object.hasOwn(properties, 'expectedRevision')) return tool;
  const workspace = tool.name === 'protoflow_workspace';
  const writeActions = Object.hasOwn(DESKTOP_WRITE_ACTIONS, tool.name) ? DESKTOP_WRITE_ACTIONS[tool.name] : null;
  const {
    projectName,
    projectMode,
    activePageId,
    designTokens,
    includeDiagnostics,
    scenarioIds,
    componentNames,
    includeAxure,
    includeFigma,
    expectedContractDigest,
  } = properties;
  const expectedRevision = {
    type: 'string',
    minLength: 1,
    description:
      (writeActions ? `Required for ${writeActions}.` : 'Required for every write.') +
      ' Use the revision from workspace status for the first write and from the previous successful write thereafter.',
  };
  return {
    ...tool,
    description: workspace
      ? 'Inspect the active desktop project (status, overview, guide, contracts) or update its metadata.'
      : tool.description,
    inputSchema: {
      ...tool.inputSchema,
      properties: workspace
        ? {
            action: {
              type: 'string',
              enum: ['status', 'overview', 'guide', 'contracts', 'update_project_meta'],
            },
            projectName,
            projectMode,
            activePageId,
            designTokens,
            includeDiagnostics,
            scenarioIds,
            componentNames,
            includeAxure,
            includeFigma,
            expectedContractDigest,
            expectedRevision,
          }
        : { ...properties, expectedRevision },
      ...(writeActions ? {} : { required: [...required, 'expectedRevision'] }),
    },
  };
});

export const MCP_TOOL_CATALOGS = {
  readonly: SPEC_MCP_TOOLS,
  local_file: DOMAIN_MCP_TOOLS,
  desktop_bridge: desktopTools,
  desktop_bridge_with_preview: [...desktopTools, capturePreviewTool],
};

const AUTHORING_PROMPT_NAMES = new Set(AUTHORING_MCP_PROMPTS.map((p) => p.name));
const AUTHORING_RESOURCE_URIS = new Set(AUTHORING_MCP_RESOURCES.map((r) => r.uri));
const SPEC_RESOURCE_URIS = new Set(SPEC_MCP_RESOURCES.map((r) => r.uri));
const DEFAULT_CACHE_TTL_MS = 300_000;

function serverCapabilities(advertiseSkills: boolean) {
  return {
    tools: {},
    prompts: {},
    resources: {},
    ...(advertiseSkills
      ? {
          extensions: {
            [MCP_SKILLS_EXTENSION_ID]: { directoryRead: true },
          },
        }
      : {}),
  };
}

function withModernCaching<T extends Record<string, unknown>>(
  body: T,
  isModern: boolean,
  cacheScope: 'public' | 'private' = 'private',
  ttlMs = DEFAULT_CACHE_TTL_MS,
): T {
  if (!isModern) return body;
  return {
    resultType: 'complete',
    ...body,
    ttlMs,
    cacheScope,
  };
}

const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const MODERN_METHODS = new Set(['server/discover', 'skills/list', 'skills/get', 'resources/directory/read']);
type StdioConnection = { modern: boolean };
type RequestTarget = WorkspaceLoader | ((request: JsonRpcRequest) => Promise<JsonRpcResponse | null>);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requestedStatusDigest(request: JsonRpcRequest): string | undefined {
  const params = request.params;
  if (request.method !== 'tools/call' || params?.name !== 'protoflow_workspace' || !isObject(params.arguments)) return;
  const { action, expectedContractDigest } = params.arguments;
  const explicitAction = typeof action === 'string' ? action.trim() : '';
  if (explicitAction && explicitAction !== 'status') return;
  if (typeof expectedContractDigest !== 'string') return;
  const digest = expectedContractDigest.trim();
  if (digest.length > 0) return digest;
}

function toolErrorResponse(id: RpcId, message: string, modern: boolean): JsonRpcResponse {
  return {
    jsonrpc: '2.0', id,
    result: {
      ...(modern ? { resultType: 'complete' } : {}),
      content: [{ type: 'text', text: message }], isError: true,
    },
  };
}

function desktopVerificationError(response: JsonRpcResponse | null): string | undefined {
  const unverified = tr(
    '[CONTRACT_UNVERIFIED] 暂未连接到正在运行的 Alex 桌面端工程。请确认已在 Alex 桌面端打开 .pflow 项目（AI 协同会自动重连）。',
    '[CONTRACT_UNVERIFIED] Could not reach an open project in Alex Desktop. Open a .pflow project in Alex Desktop and retry.',
  );
  const result = response?.result;
  if (response?.error || !isObject(result) || !Array.isArray(result.content)) return unverified;
  const first = result.content[0];
  if (!isObject(first) || first.type !== 'text' || typeof first.text !== 'string') return unverified;
  if (result.isError === true) return first.text;
  if (result.isError !== undefined && result.isError !== false) return unverified;
  let status: unknown;
  try {
    status = JSON.parse(first.text);
  } catch {
    return unverified;
  }
  if (!isObject(status) || typeof status.contractDigest !== 'string') return unverified;
  if (status.contractCheckStatus === 'matched' || status.contractCheckStatus === 'mismatched') return;
  return unverified;
}

function usesModernProtocol(method: string, meta: unknown, connection?: StdioConnection): boolean {
  const fields = isObject(meta) ? meta : {};
  const version = fields[VERSION_KEY];
  if (version !== undefined && typeof version !== 'string') {
    throw new McpRpcError(-32602, `Invalid ${VERSION_KEY}`);
  }
  if (typeof version === 'string' && !(SUPPORTED_MCP_PROTOCOLS as readonly string[]).includes(version)) {
    throw new McpRpcError(-32022, 'Unsupported protocol version', { supported: [...SUPPORTED_MCP_PROTOCOLS], requested: version });
  }

  // A dual-era client may probe with discover and then open a legacy handshake.
  const expectsModern = MODERN_METHODS.has(method) || version === MODERN_PROTOCOL ||
    Object.hasOwn(fields, CAPABILITIES_KEY) || Object.hasOwn(fields, 'io.modelcontextprotocol/clientInfo') ||
    (connection?.modern === true && method !== 'initialize');
  if (expectsModern) {
    if (version !== MODERN_PROTOCOL) throw new McpRpcError(-32602, `Expected ${VERSION_KEY} for a modern MCP request`);
    if (!isObject(fields[CAPABILITIES_KEY])) throw new McpRpcError(-32602, `Expected an object in ${CAPABILITIES_KEY}`);
    if (method === 'initialize') throw new McpRpcError(-32601, 'Use server/discover with this protocol version');
  }
  if (connection) connection.modern = expectsModern;
  return expectsModern;
}

export async function handleSpecMcpRequest(
  loader: RequestTarget,
  msg: unknown,
  connection?: StdioConnection,
): Promise<JsonRpcResponse | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  const req = msg as JsonRpcRequest;
  const isNotification = req.id === undefined;

  if (typeof req.method !== 'string' || !req.method) {
    if (isNotification) return null;
    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: { code: -32600, message: 'Missing method in JSON-RPC request' },
    };
  }

  // Notifications never receive a response in JSON-RPC 2.0 / MCP.
  if (isNotification || req.method.startsWith('notifications/')) {
    return null;
  }

  const id = req.id ?? null;
  const params = req.params && typeof req.params === 'object' ? req.params : {};
  try {
    const isModernRequest = usesModernProtocol(req.method, params._meta, connection);
    const expectedDigest = requestedStatusDigest(req);
    if (typeof loader === 'function') {
      if (expectedDigest === undefined) return await loader(req);
      const forwarded = await loader(req).catch(() => null);
      const verificationError = desktopVerificationError(forwarded);
      if (verificationError !== undefined) {
        return toolErrorResponse(id, verificationError, isModernRequest);
      }
      return forwarded;
    }
    const isReadWrite = isAuthoringWorkspace(loader) && loader.mode === 'readwrite';
    const live = isReadWrite && loader.transport === 'desktop_bridge' && typeof loader.capturePreview === 'function';
    switch (req.method) {
      case 'server/discover': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resultType: 'complete',
            supportedVersions: [...SUPPORTED_MCP_PROTOCOLS],
            capabilities: serverCapabilities(isReadWrite),
            _meta: {
              'io.modelcontextprotocol/serverInfo': {
                name: SPEC_MCP_SERVER_NAME,
                version: SPEC_MCP_SERVER_VERSION,
              },
            },
            instructions: isReadWrite ? authoringInstructions(loader.transport === 'desktop_bridge', live) : SERVER_INSTRUCTIONS,
            ttlMs: DEFAULT_CACHE_TTL_MS,
            cacheScope: 'private',
          },
        };
      }

      case 'initialize': {
        const protocolVersion = negotiateProtocolVersion(params.protocolVersion);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: serverCapabilities(false),
            serverInfo: {
              name: SPEC_MCP_SERVER_NAME,
              version: SPEC_MCP_SERVER_VERSION,
            },
            instructions: isReadWrite ? authoringInstructions(loader.transport === 'desktop_bridge', live) : SERVER_INSTRUCTIONS,
          },
        };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: isModernRequest ? { resultType: 'complete' } : {} };

      case 'skills/list': {
        if (!isReadWrite) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: 'Skills extension requires --mode readwrite' },
          };
        }
        return { jsonrpc: '2.0', id, result: listMcpSkills(params.cursor) };
      }

      case 'skills/get': {
        if (!isReadWrite) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: 'Skills extension requires --mode readwrite' },
          };
        }
        return { jsonrpc: '2.0', id, result: getMcpSkill(params.uri) };
      }

      case 'resources/directory/read': {
        if (!isReadWrite) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: 'Directory reading requires --mode readwrite' },
          };
        }
        return { jsonrpc: '2.0', id, result: readMcpSkillDirectory(params.uri, params.cursor) };
      }

      case 'tools/list': {
        const catalog = !isReadWrite ? 'readonly'
          : live ? 'desktop_bridge_with_preview'
          : loader.transport === 'desktop_bridge' ? 'desktop_bridge' : 'local_file';
        return {
          jsonrpc: '2.0',
          id,
          result: withModernCaching({ tools: MCP_TOOL_CATALOGS[catalog] }, isModernRequest),
        };
      }

      case 'tools/call': {
        const toolName = typeof params.name === 'string' ? params.name : '';
        if (!toolName) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name in tools/call' },
          };
        }
        const toolArgs =
          params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        try {
          if (toolName === capturePreviewTool.name) {
            if (!live) throw new Error('Preview capture requires a live Alex desktop connection');
            const { data, ...metadata } = await loader.capturePreview!(parseCaptureOptions(params.arguments === undefined ? {} : params.arguments));
            return {
              jsonrpc: '2.0',
              id,
              result: {
                ...(isModernRequest ? { resultType: 'complete' as const } : {}),
                isError: false,
                content: [
                  { type: 'image', mimeType: 'image/png', data },
                  { type: 'text', text: JSON.stringify(metadata) },
                ],
              },
            };
          }
          let output: unknown;
          if (isAuthoringToolName(toolName)) {
            if (!isReadWrite) {
              throw new Error(
                tr(
                  `当前 MCP 服务以只读模式（readonly）运行，工具 "${toolName}" 已禁用；如需编辑工程请使用 --mode readwrite 重启服务。`,
                  `This MCP server is running in read-only mode; tool "${toolName}" is disabled. Restart with --mode readwrite to enable authoring.`
                )
              );
            }
            output = await executeAuthoringTool(loader, toolName, toolArgs);
          } else {
            const workspace = await loader.load();
            output = executeSpecTool(workspace, toolName, toolArgs);
          }
          return {
            jsonrpc: '2.0',
            id,
            result: {
              ...(isModernRequest ? { resultType: 'complete' as const } : {}),
              content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
              isError: false,
            },
          };
        } catch (toolError) {
          const message = toolError instanceof Error ? toolError.message : String(toolError);
          return toolErrorResponse(id, message, isModernRequest);
        }
      }

      case 'prompts/list':
        return {
          jsonrpc: '2.0',
          id,
          result: withModernCaching(
            {
              prompts: isReadWrite ? [...SPEC_MCP_PROMPTS, ...AUTHORING_MCP_PROMPTS] : SPEC_MCP_PROMPTS,
            },
            isModernRequest,
          ),
        };

      case 'prompts/get': {
        const promptName = typeof params.name === 'string' ? params.name : '';
        if (!promptName) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing prompt name in prompts/get' },
          };
        }
        const promptArgs =
          params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, string>)
            : undefined;
        if (isReadWrite && AUTHORING_PROMPT_NAMES.has(promptName)) {
          const workspace = loader.hasActiveProject() ? await loader.load() : null;
          const prompt = getAuthoringPrompt(workspace, promptName, promptArgs);
          if (live && ['design-full-project', 'design-page', 'refine-page', 'reshape-imported-pages'].includes(promptName)) {
            prompt.messages[0].content.text += '\n' + tr('完成页面修改后，可调用 protoflow_capture_preview 复核实际布局和移动端裁切。', 'After editing, use protoflow_capture_preview to verify the rendered layout and mobile viewport.');
          }
          return { jsonrpc: '2.0', id, result: isModernRequest ? { resultType: 'complete', ...prompt } : prompt };
        }
        const workspace = await loader.load();
        const prompt = getSpecPrompt(workspace, promptName, promptArgs);
        return { jsonrpc: '2.0', id, result: isModernRequest ? { resultType: 'complete', ...prompt } : prompt };
      }

      case 'resources/list':
        return {
          jsonrpc: '2.0',
          id,
          result: withModernCaching(
            {
              resources: isReadWrite ? [...SPEC_MCP_RESOURCES, ...AUTHORING_MCP_RESOURCES] : SPEC_MCP_RESOURCES,
            },
            isModernRequest,
          ),
        };

      case 'resources/templates/list':
        return { jsonrpc: '2.0', id, result: withModernCaching({ resourceTemplates: [] }, isModernRequest) };

      case 'resources/read': {
        const uri = typeof params.uri === 'string' ? params.uri : '';
        if (!uri) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing resource uri in resources/read' },
          };
        }
        if (uri.startsWith('skill://')) {
          if (!isReadWrite) {
            throw new McpRpcError(-32602, 'Skill resources require --mode readwrite');
          }
          return { jsonrpc: '2.0', id, result: readMcpSkillResource(uri) };
        }
        if (isReadWrite && AUTHORING_RESOURCE_URIS.has(uri)) {
          return {
            jsonrpc: '2.0',
            id,
            result: withModernCaching(readAuthoringResource(uri), isModernRequest, 'public'),
          };
        }
        if (!SPEC_RESOURCE_URIS.has(uri)) {
          throw new McpRpcError(isModernRequest ? -32602 : -32002, 'Unknown resource URI', { uri });
        }
        const resource = readSpecResource(await loader.load(), uri);
        return {
          jsonrpc: '2.0',
          id,
          result: withModernCaching(resource, isModernRequest, 'private', 0),
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  } catch (err) {
    if (err instanceof McpRpcError) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: err.code,
          message: err.message,
          ...(err.data !== undefined ? { data: err.data } : {}),
        },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export async function handleSpecMcpPayload(
  loader: RequestTarget,
  payload: unknown,
  connection?: StdioConnection,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Empty batch' } };
    }
    const responses: JsonRpcResponse[] = [];
    for (const item of payload) {
      const res = await handleSpecMcpRequest(loader, item, connection);
      if (res) responses.push(res);
    }
    return responses.length > 0 ? responses : null;
  }
  return handleSpecMcpRequest(loader, payload, connection);
}
