import { capturePreviewTool, parseCaptureOptions } from './capturePreview';
import type { LosslessNumber } from 'lossless-json';
import { tr } from '../i18n/runtime';
import {
  AUTHORING_MCP_PROMPTS,
  AUTHORING_MCP_RESOURCES,
  AUTHORING_MCP_TOOLS,
  executeAuthoringTool,
  getAuthoringPrompt,
  isAuthoringToolName,
  readAuthoringResource,
} from './authoringCore';
import { isAuthoringWorkspace } from './authoringTypes';
import {
  executeSpecTool,
  getSpecPrompt,
  readSpecResource,
  SPEC_MCP_PROMPTS,
  SPEC_MCP_RESOURCES,
  SPEC_MCP_TOOLS,
} from './tools';
import type { WorkspaceLoader } from './workspace';

export const SUPPORTED_MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SPEC_MCP_SERVER_NAME = 'protoflow-spec';
export const SPEC_MCP_SERVER_VERSION = '0.0.11';

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
  if (typeof requested === 'string' && (SUPPORTED_MCP_PROTOCOLS as readonly string[]).includes(requested)) {
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
    ? '1. Use protoflow_workspace(action="status") to verify the intended projectId, activePageId and selectedPfId. Pass the status revision as expectedRevision on the first write. Send only one desktop write at a time, even across different tools, folders or pages. Wait for each successful write and pass its returned revision unchanged as expectedRevision on the next write. On a conflict, stop the sequence, verify the intended project and inspect the changed state before retrying. Open or create other projects in Alex.'
    : '1. Call protoflow_workspace(action="status") first (and create_project / switch_project if no .pflow project is active), then inspect existing structure via protoflow_get_project_overview and protoflow_get_database_schema.',
  '2. Before writing any TSX page, call protoflow_get_implementation_guide and protoflow_get_contracts to verify registered components, props, and runtime actions — never guess AntD props or write inline JS callbacks.',
  '3. Create sitemap folders (protoflow_manage_sitemap), normalized shared ER tables (protoflow_upsert_db_tables), and coherent seed rows (protoflow_manage_table_rows) before writing pages.',
  '4. Create/overwrite pages with protoflow_write_page or edit subtrees losslessly with protoflow_edit_page_block; never mix desktop <Page> and mobile <MobilePage> (M*) components.',
  '5. Attach requirement pins (protoflow_manage_sticky_notes), optional notes/Mermaid flows (protoflow_manage_docs_and_flows), and finish with protoflow_audit_project until healthy is true.',
  ...(capture ? ['6. After a page edit, call protoflow_capture_preview for a visual check. Use fullPage for content below the fold and inspect the returned revision.'] : []),
].join(' ');

const desktopTools = AUTHORING_MCP_TOOLS.map(tool => {
  const { properties, required = [] } = tool.inputSchema as { properties: Record<string, object>; required?: string[] };
  if (!Object.hasOwn(properties, 'expectedRevision')) return tool;
  const workspace = tool.name === 'protoflow_workspace';
  const writeActions = workspace ? 'update_project_meta' :
    tool.name === 'protoflow_manage_table_rows' ? 'seed and clear' : null;
  const { projectName, projectMode, activePageId } = properties;
  const expectedRevision = {
    type: 'string', minLength: 1,
    description: (writeActions ? `Required for ${writeActions}.` : 'Required for every write.') +
      ' Use the revision from workspace status for the first write and from the previous successful write thereafter.',
  };
  return {
    ...tool,
    description: workspace ? 'Inspect the active desktop project or update its metadata.' : tool.description,
    inputSchema: {
      ...tool.inputSchema,
      properties: workspace ? { action: { type: 'string', enum: ['status', 'update_project_meta'] }, projectName, projectMode, activePageId, expectedRevision }
        : { ...properties, expectedRevision },
      ...(writeActions ? {} : { required: [...required, 'expectedRevision'] }),
    },
  };
});

const AUTHORING_PROMPT_NAMES = new Set(AUTHORING_MCP_PROMPTS.map((p) => p.name));
const AUTHORING_RESOURCE_URIS = new Set(AUTHORING_MCP_RESOURCES.map((r) => r.uri));

export async function handleSpecMcpRequest(
  loader: WorkspaceLoader,
  msg: unknown
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
  const isReadWrite = isAuthoringWorkspace(loader) && loader.mode === 'readwrite';

  const live = isReadWrite && loader.transport === 'desktop_bridge' && typeof loader.capturePreview === 'function';
  try {
    switch (req.method) {
      case 'initialize': {
        const protocolVersion = negotiateProtocolVersion(params.protocolVersion);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: {
              tools: {},
              prompts: {},
              resources: {},
            },
            serverInfo: {
              name: SPEC_MCP_SERVER_NAME,
              version: SPEC_MCP_SERVER_VERSION,
            },
            instructions: isReadWrite ? authoringInstructions(loader.transport === 'desktop_bridge', live) : SERVER_INSTRUCTIONS,
          },
        };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: isReadWrite ? [...SPEC_MCP_TOOLS, ...(loader.transport === 'desktop_bridge' ? desktopTools : AUTHORING_MCP_TOOLS), ...(live ? [capturePreviewTool] : [])] : SPEC_MCP_TOOLS,
          },
        };

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
            return { jsonrpc: '2.0', id, result: { isError: false, content: [
              { type: 'image', mimeType: 'image/png', data }, { type: 'text', text: JSON.stringify(metadata) },
            ] } };
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
              content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
              isError: false,
            },
          };
        } catch (toolError) {
          const message = toolError instanceof Error ? toolError.message : String(toolError);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: message }],
              isError: true,
            },
          };
        }
      }

      case 'prompts/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            prompts: isReadWrite ? [...SPEC_MCP_PROMPTS, ...AUTHORING_MCP_PROMPTS] : SPEC_MCP_PROMPTS,
          },
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
          if (live && ['design-full-project', 'design-page', 'refine-page'].includes(promptName)) {
            prompt.messages[0].content.text += '\n' + tr('完成页面修改后，可调用 protoflow_capture_preview 复核实际布局和移动端裁切。', 'After editing, use protoflow_capture_preview to verify the rendered layout and mobile viewport.');
          }
          return { jsonrpc: '2.0', id, result: prompt };
        }
        const workspace = await loader.load();
        const prompt = getSpecPrompt(workspace, promptName, promptArgs);
        return { jsonrpc: '2.0', id, result: prompt };
      }

      case 'resources/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: isReadWrite ? [...SPEC_MCP_RESOURCES, ...AUTHORING_MCP_RESOURCES] : SPEC_MCP_RESOURCES,
          },
        };

      case 'resources/templates/list':
        return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };

      case 'resources/read': {
        const uri = typeof params.uri === 'string' ? params.uri : '';
        if (!uri) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing resource uri in resources/read' },
          };
        }
        if (isReadWrite && AUTHORING_RESOURCE_URIS.has(uri)) {
          return {
            jsonrpc: '2.0',
            id,
            result: readAuthoringResource(uri),
          };
        }
        const workspace = await loader.load();
        const resource = readSpecResource(workspace, uri);
        return { jsonrpc: '2.0', id, result: resource };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  } catch (err) {
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
  loader: WorkspaceLoader,
  payload: unknown
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Empty batch' } };
    }
    const responses: JsonRpcResponse[] = [];
    for (const item of payload) {
      const res = await handleSpecMcpRequest(loader, item);
      if (res) responses.push(res);
    }
    return responses.length > 0 ? responses : null;
  }
  return handleSpecMcpRequest(loader, payload);
}
