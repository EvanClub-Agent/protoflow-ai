import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'lossless-json';
import { parseStdioPayload } from './wire';
import { handleSpecMcpPayload, handleSpecMcpRequest, requestedStatusDigest, type JsonRpcRequest, type JsonRpcResponse } from './protocol';
import type { AuthoringWorkspace } from './authoringTypes';

function disconnectedDesktopWorkspace(message: string): AuthoringWorkspace {
  const unavailable = async (): Promise<never> => { throw new Error(message); };
  return {
    mode: 'readwrite',
    transport: 'desktop_bridge',
    canWrite: true,
    hasActiveProject: () => false,
    listProjects: unavailable,
    createProject: unavailable,
    switchProject: unavailable,
    getContext: unavailable,
    capturePreview: unavailable,
    load: unavailable,
    mutate: unavailable,
  };
}

/** Only the desktop's loopback port and per-session secret come from disk. */
export function createDesktopRelay(connectionPath: string) {
  if (!path.isAbsolute(connectionPath)) throw new Error('--desktop-bridge requires an absolute connection file path');
  const connection = { modern: false };
  const forward = async (request: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const verifying = requestedStatusDigest(request) !== undefined;
    const signal = AbortSignal.timeout(verifying ? 5_000 : 60_000);
    let connected = false;
    try {
      const { port, token } = JSON.parse(await fs.readFile(connectionPath, { encoding: 'utf8', signal }));
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !/^[0-9a-f]{64}$/.test(token)) {
        throw new Error('Invalid Alex desktop connection file');
      }
      connected = true;
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Alex-Contract-Lock': '1' },
        body: stringify(request),
      });
      if (!response.ok) throw new Error(`Desktop bridge HTTP ${response.status}`);
      return response.status === 204 ? null : parseStdioPayload(await response.text()) as JsonRpcResponse;
    } catch (error) {
      // Only the running desktop can attest its digest, including after a reconnect.
      if (verifying) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      const message = connected
        ? `Alex desktop connection unavailable. Please make sure a .pflow project is open in Alex Desktop (live AI co-design reconnects automatically). Check the result of any submitted edit before retrying. ${detail}`
        : `Alex desktop connection unavailable. Open a .pflow project in Alex Desktop and enable MCP → Bidirectional design once (remembered automatically). ${detail}`;
      return handleSpecMcpRequest(disconnectedDesktopWorkspace(message), request);
    }
  };
  return (payload: unknown) => handleSpecMcpPayload(forward, payload, connection);
}
