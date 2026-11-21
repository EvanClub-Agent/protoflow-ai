import type { LosslessNumber } from 'lossless-json';
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
export const SPEC_MCP_SERVER_VERSION = '0.0.4';

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
            instructions: SERVER_INSTRUCTIONS,
          },
        };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: SPEC_MCP_TOOLS } };

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
          const workspace = await loader.load();
          const output = executeSpecTool(workspace, toolName, toolArgs);
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
        return { jsonrpc: '2.0', id, result: { prompts: SPEC_MCP_PROMPTS } };

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
        const workspace = await loader.load();
        const prompt = getSpecPrompt(workspace, promptName, promptArgs);
        return { jsonrpc: '2.0', id, result: prompt };
      }

      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: SPEC_MCP_RESOURCES } };

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
