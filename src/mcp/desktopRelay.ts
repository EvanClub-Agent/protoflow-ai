import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'lossless-json';
import { parseStdioPayload } from './wire';
import { handleSpecMcpPayload } from './protocol';
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
  return async (payload: unknown) => {
    let connected = false;
    try {
      const { port, token } = JSON.parse(await fs.readFile(connectionPath, 'utf8'));
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !/^[0-9a-f]{64}$/.test(token)) {
        throw new Error('Invalid Alex desktop connection file');
      }
      connected = true;
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: stringify(payload),
      });
      if (!response.ok) throw new Error(`Desktop bridge HTTP ${response.status}`);
      return response.status === 204 ? null : parseStdioPayload(await response.text());
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = connected
        ? `Alex desktop connection unavailable. Open a project in Alex Desktop and enable MCP → Bidirectional design. Check the result of any submitted edit before retrying. ${detail}`
        : `Alex desktop connection unavailable. Open a project in Alex Desktop and enable MCP → Bidirectional design. ${detail}`;
      return handleSpecMcpPayload(disconnectedDesktopWorkspace(message), payload);
    }
  };
}
