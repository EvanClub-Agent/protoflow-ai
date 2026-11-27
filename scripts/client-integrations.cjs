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

function serverEntry(binding) {
  return binding
    ? { command: binding.executable, args: args('${PLUGIN_ROOT}/server/cli.cjs', binding.connectionFile), env: { ELECTRON_RUN_AS_NODE: '1' } }
    : {
        command: 'node',
        args: args('${PLUGIN_ROOT}/server/cli.cjs', '${ALEX_CONNECTION_FILE}'),
        variables: [{ name: 'ALEX_CONNECTION_FILE', title: fileTitle, description: fileDescription }],
      };
}

function pluginConfig(binding, serverKey = 'alex') {
  return { mcpServers: { [serverKey]: serverEntry(binding) } };
}

function pluginFiles(root, binding) {
  const { metadata, files } = contents(root);
  files['plugin.json'] = json({ ...metadata, displayName: 'Alex ProtoFlow Designer' });
  files['mcp_config.json'] = json(pluginConfig(binding, 'alex'));
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

function installPlugin(root, home, binding, options = {}) {
  if (!path.isAbsolute(binding.connectionFile) || !path.isAbsolute(binding.executable)) throw new Error('Missing desktop connection or executable path');
  const files = pluginFiles(root, binding);
  const target = path.join(home, '.gemini/config/plugins', name);
  return installDesignerFiles(target, 'plugin', files, current => {
    let parsed;
    try { parsed = JSON.parse(current); } catch { return false; }
    for (const key of ['alex', 'protoflow']) {
      const previous = parsed?.mcpServers?.[key];
      if (!Array.isArray(previous?.args)) continue;
      const connectionFile = previous.args.at(-1);
      if (typeof connectionFile === 'string' && path.isAbsolute(connectionFile) &&
          typeof previous.command === 'string' && path.isAbsolute(previous.command) &&
          current.equals(json(pluginConfig({ executable: previous.command, connectionFile }, key)))) {
        return true;
      }
    }
    return false;
  }, options);
}

function workbuddyRuntimeFiles(root) {
  const { metadata, files } = contents(root);
  return {
    ...files,
    'plugin.json': json({ ...metadata, displayName: 'Alex ProtoFlow Designer' }),
  };
}

function workbuddyServerEntry(cliPath, binding) {
  return {
    command: binding.executable,
    args: args(cliPath, binding.connectionFile),
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

function mergeMcpServersFile(configPath, serverKey, entry, options = {}) {
  const forceRepair = options?.forceRepair === true;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let base = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
            (parsed.mcpServers !== undefined && (!parsed.mcpServers || typeof parsed.mcpServers !== 'object' || Array.isArray(parsed.mcpServers)))) {
          throw new Error('Root or mcpServers is not an object');
        }
        base = parsed;
      } catch {
        if (!forceRepair) {
          throw new Error(`WorkBuddy 配置文件格式无法解析：${configPath}（请检查 JSON 格式，或点击「修复」自动备份并重建）`);
        }
        writeAtomic(configPath + '.bak', Buffer.from(raw, 'utf8'));
        base = {};
      }
    }
  }
  const previousServers = base.mcpServers && typeof base.mcpServers === 'object' && !Array.isArray(base.mcpServers)
    ? { ...base.mcpServers }
    : {};
  // Clean up legacy 'protoflow' key only if it pointed at our managed server/cli.cjs
  if (serverKey !== 'protoflow' && previousServers.protoflow && Array.isArray(previousServers.protoflow.args)) {
    const firstArg = String(previousServers.protoflow.args[0] ?? '');
    if (firstArg.includes(name) && firstArg.endsWith('cli.cjs')) {
      delete previousServers.protoflow;
    }
  }
  const next = {
    ...base,
    mcpServers: {
      ...previousServers,
      [serverKey]: entry,
    },
  };
  writeAtomic(configPath, json(next));
  return configPath;
}

function resolveWorkBuddyHomes(home) {
  const standard = path.join(home, '.workbuddy');
  const alt = path.join(home, '.workbuddy-ai');
  const hasStandard = fs.existsSync(standard);
  const hasAlt = fs.existsSync(alt);
  if (hasStandard && hasAlt) return [standard, alt];
  if (hasAlt && !hasStandard) return [alt];
  return [standard];
}

function installWorkBuddy(root, home, binding, options = {}) {
  if (!binding || !path.isAbsolute(binding.connectionFile) || !path.isAbsolute(binding.executable)) {
    throw new Error('Missing desktop connection or executable path');
  }
  const runtimeFiles = workbuddyRuntimeFiles(root);
  const bundledSkill = skillFiles(path.join(root, 'skills', name));
  const wbHomes = resolveWorkBuddyHomes(home);
  let primaryConfigPath = '';

  for (const wbHome of wbHomes) {
    const runtimeDir = installDesignerFiles(
      path.join(wbHome, 'plugins', name),
      'plugin',
      runtimeFiles,
      () => false,
      options,
    );
    installDesignerFiles(
      path.join(wbHome, 'skills', name),
      'skill',
      bundledSkill,
      undefined,
      options,
    );
    const cliPath = path.join(runtimeDir, 'server', 'cli.cjs');
    const cfg = mergeMcpServersFile(
      path.join(wbHome, 'mcp.json'),
      'alex',
      workbuddyServerEntry(cliPath, binding),
      options,
    );
    if (!primaryConfigPath) primaryConfigPath = cfg;
  }

  // Also sync Tencent CodeBuddy shared home (~/.codebuddy) when present on disk
  const codebuddyHome = path.join(home, '.codebuddy');
  if (fs.existsSync(codebuddyHome) && fs.lstatSync(codebuddyHome).isDirectory()) {
    try {
      installDesignerFiles(
        path.join(codebuddyHome, 'skills', name),
        'skill',
        bundledSkill,
        undefined,
        options,
      );
      const primaryCli = path.join(wbHomes[0], 'plugins', name, 'server', 'cli.cjs');
      const dotMcp = path.join(codebuddyHome, '.mcp.json');
      const plainMcp = path.join(codebuddyHome, 'mcp.json');
      const targetCfg = fs.existsSync(plainMcp) && !fs.existsSync(dotMcp) ? plainMcp : dotMcp;
      mergeMcpServersFile(targetCfg, 'alex', workbuddyServerEntry(primaryCli, binding), options);
    } catch (err) {
      if (options?.forceRepair) throw err;
    }
  }

  return primaryConfigPath;
}

module.exports = { name, claudeBundle, pluginFiles, installPlugin, installWorkBuddy, writeAtomic };
