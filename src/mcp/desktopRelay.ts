import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'lossless-json';
import { parseStdioPayload } from './wire';
import type { JsonRpcRequest } from './protocol';

/** Only the desktop's loopback port and per-session secret come from disk. */
export function createDesktopRelay(connectionPath: string) {
  if (!path.isAbsolute(connectionPath)) throw new Error('--desktop-bridge requires an absolute connection file path');
  return async (payload: unknown) => {
    try {
      const { port, token } = JSON.parse(await fs.readFile(connectionPath, 'utf8'));
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !/^[0-9a-f]{64}$/.test(token)) {
        throw new Error('Invalid Alex desktop connection file');
      }
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: stringify(payload),
      });
      if (!response.ok) throw new Error(`Desktop bridge HTTP ${response.status}`);
      return response.status === 204 ? null : parseStdioPayload(await response.text());
    } catch (error) {
      const message = `Alex desktop connection unavailable. Check the current project and its bidirectional connection. Check the result of any submitted edit before retrying. ${error instanceof Error ? error.message : error}`;
      const requests = Array.isArray(payload) ? payload : [payload];
      const replies = requests.flatMap((request: JsonRpcRequest) => request?.id === undefined ? [] :
        [{ jsonrpc: '2.0', id: request.id, error: { code: -32000, message } }]);
      return replies.length ? (Array.isArray(payload) ? replies : replies[0]) : null;
    }
  };
}
