const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { zipSync } = require('fflate');

const { installDesignerFiles, skillFiles } = require('../electron/designer-install.cjs');

const name = 'alex-protoflow-designer';
const fileTitle = 'Alex connection file';
const fileDescription = 'In Alex Desktop, open a project and copy the live.json connection file path from MCP → Bidirectional design (reused automatically across projects).';
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const args = (entry, connection) => [entry, '--mode', 'readwrite', '--desktop-bridge', connection];

function contents(root) {
  const { version, license, author } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const metadata = { name, version, description: 'Design and visually review the open Alex prototype through a live desktop connection.', author: { name: author.name }, license };
  const files = {
    'server/cli.cjs': fs.readFileSync(path.join(root, 'electron/generated/spec-mcp-server.cjs')),
    LICENSE: fs.readFileSync(path.join(root, 'LICENSE')),
  };
  return { metadata, files };
}

function claudeBundle(root, connectionFile) {
  const { metadata, files } = contents(root);
  const manifest = {
    manifest_version: '0.3', ...metadata, display_name: 'Alex ProtoFlow Designer',
    server: { type: 'node', entry_point: 'server/cli.cjs', mcp_config: {
      command: 'node', args: args('${__dirname}/server/cli.cjs', '${user_config.connection_file}'),
    } },
    user_config: { connection_file: { type: 'file', title: fileTitle, description: fileDescription, required: true,
      ...(connectionFile ? { default: connectionFile } : {}) } },
    tools_generated: true, prompts_generated: true,
  };
  return Buffer.from(zipSync({ ...files, 'manifest.json': json(manifest) }));
}

function pluginConfig(binding) {
  const server = binding ? { command: binding.executable, args: args('${PLUGIN_ROOT}/server/cli.cjs', binding.connectionFile), env: { ELECTRON_RUN_AS_NODE: '1' } } :
    { command: 'node', args: args('${PLUGIN_ROOT}/server/cli.cjs', '${ALEX_CONNECTION_FILE}'),
      variables: [{ name: 'ALEX_CONNECTION_FILE', title: fileTitle, description: fileDescription }] };
  return { mcpServers: { protoflow: server } };
}

function pluginFiles(root, binding) {
  const { metadata, files } = contents(root);
  files['plugin.json'] = json({ ...metadata, displayName: 'Alex ProtoFlow Designer' });
  files['mcp_config.json'] = json(pluginConfig(binding));
  const skill = 'skills/' + name;
  for (const [file, bytes] of Object.entries(skillFiles(path.join(root, skill)))) files[skill + '/' + file] = bytes;
  return files;
}

function writeAtomic(file, bytes) {
  const temporary = path.join(path.dirname(file), '.alex-' + randomUUID());
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function installPlugin(root, home, binding) {
  if (!path.isAbsolute(binding.connectionFile) || !path.isAbsolute(binding.executable)) throw new Error('Missing desktop connection or executable path');
  const files = pluginFiles(root, binding);
  const target = path.join(home, '.gemini/config/plugins', name);
  return installDesignerFiles(target, 'plugin', files, current => {
    let previous;
    try { previous = JSON.parse(current).mcpServers.protoflow; } catch { return false; }
    if (!Array.isArray(previous?.args)) return false;
    const connectionFile = previous.args.at(-1);
    return typeof connectionFile === 'string' && path.isAbsolute(connectionFile) &&
      typeof previous.command === 'string' && path.isAbsolute(previous.command) &&
      current.equals(json(pluginConfig({ executable: previous.command, connectionFile })));
  });
}

module.exports = { name, claudeBundle, pluginFiles, installPlugin, writeAtomic };
