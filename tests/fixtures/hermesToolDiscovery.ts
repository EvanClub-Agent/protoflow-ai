import fs from 'node:fs';
import path from 'node:path';

// Simulate the native MCP tools/list receipt when an ACP session loads its server.
export function acknowledgeToolDiscovery(params: { cwd?: string; mcpServers?: { env: { name: string; value: string }[] }[] }) {
  const binding = params.mcpServers?.[0].env.find(e => e.name === 'PROTOFLOW_TOOL_BINDING')?.value;
  if (binding && params.cwd) fs.writeFileSync(path.join(params.cwd, 'tool-registration.json'), JSON.stringify({ binding, tools: ['protoflow_get_contracts'] }));
}
