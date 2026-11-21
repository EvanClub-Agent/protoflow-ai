const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { zipSync } = require('fflate');

const name = 'alex-protoflow-designer';
const fileTitle = 'Alex connection file';
const fileDescription = 'In Alex Desktop, open your project and copy the connection file path from MCP → Bidirectional design.';
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
  for (const file of ['SKILL.md', ...fs.readdirSync(path.join(root, skill, 'references')).filter(f => f.endsWith('.md')).map(f => 'references/' + f)]) {
    files[skill + '/' + file] = fs.readFileSync(path.join(root, skill, file));
  }
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
  const parent = path.join(home, '.gemini/config/plugins');
  const target = path.join(parent, name);
  fs.mkdirSync(parent, { recursive: true });
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing) {
    const conflict = new Error('请先移走已有的自定义插件。 Existing plugin differs: ' + target);
    if (!existing.isDirectory()) throw conflict;
    const realTarget = fs.realpathSync(target);
    for (const [relative, bytes] of Object.entries(files)) {
      const file = path.join(target, relative);
      if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() || fs.realpathSync(file) !== path.join(realTarget, relative)) throw conflict;
      const current = fs.readFileSync(file);
      if (current.equals(bytes)) continue;
      if (relative !== 'mcp_config.json') throw conflict;
      let previous;
      try { previous = JSON.parse(current).mcpServers.protoflow; } catch { throw conflict; }
      if (!Array.isArray(previous?.args)) throw conflict;
      const previousFile = previous.args.at(-1);
      if (typeof previousFile !== 'string' || !path.isAbsolute(previousFile) || typeof previous.command !== 'string' || !path.isAbsolute(previous.command) ||
          !current.equals(json(pluginConfig({ executable: previous.command, connectionFile: previousFile })))) throw conflict;
    }
    const configFile = path.join(target, 'mcp_config.json');
    if (!fs.readFileSync(configFile).equals(files['mcp_config.json'])) writeAtomic(configFile, files['mcp_config.json']);
    return target;
  }
  const staging = fs.mkdtempSync(path.join(parent, '.alex-plugin-'));
  try {
    for (const [relative, bytes] of Object.entries(files)) {
      const file = path.join(staging, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    }
    fs.renameSync(staging, target);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  return target;
}

module.exports = { name, claudeBundle, pluginFiles, installPlugin, writeAtomic };
