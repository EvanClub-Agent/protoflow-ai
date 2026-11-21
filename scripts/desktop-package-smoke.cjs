// Inspect and exercise the built app with its own Electron runtime. Uses a temporary
// Hermes context only: no user profile, real project, model request or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(executable, args) {
  const result = spawnSync(executable, args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || `进程退出：${result.signal}`);
  return result.stdout;
}

if (process.argv[2] === '--inspect-archive') {
  assert.ok(process.versions.electron, '必须使用安装包自带的 Electron 检查');
  const archive = process.argv[3];
  assert.ok(path.isAbsolute(archive), '必须提供绝对路径');
  assert.deepEqual(fs.readdirSync(archive).sort(), ['dist', 'electron', 'package.json', 'public', 'skills']);
  const files = fs.readdirSync(archive, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(archive, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  const skillFiles = ['SKILL.md', ...['axure-reshape', 'desktop-and-mobile', 'er-modeling-rules', 'full-project-workflow']
    .map(name => 'references/' + name + '.md')].map(file => 'skills/alex-protoflow-designer/' + file);
  assert.deepEqual(files.filter(file => file.startsWith('skills/')).sort(), skillFiles.sort());
  for (const file of files) {
    assert.ok(skillFiles.includes(file) || /^(dist\/|electron\/.+\.cjs$|electron\/service-origin\.json$|electron\/hermes-(?:reasoning|context|rate-limit|recovery-gateway|acp-surface|acp-runtime)\.py$|public\/icon\.png$|package\.json$)/.test(file), `多余的打包文件：${file}`);
    assert.ok(!/(^|\/)(\.env(?:\.|$)|[^/]+\.local$)|\.(pflow|map)$/.test(file), `不应包含本地配置、工程或 source map：${file}`);
  }
  for (const file of ['electron/main.cjs', 'electron/preload.cjs', 'electron/service-origin.json', 'electron/hermes-dashboard-preload.cjs', 'electron/hermes-reasoning.py', 'electron/hermes-context.py', 'electron/hermes-rate-limit.py', 'electron/hermes-recovery-gateway.py', 'electron/hermes-acp-surface.py', 'electron/hermes-acp-runtime.py', 'public/icon.png']) {
    assert.ok(fs.statSync(path.join(archive, file)).isFile(), `缺少 ${file}`);
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'));
  assert.equal(metadata.main, 'electron/main.cjs');
  assert.equal(metadata.productName, 'Alex');
  const html = fs.readFileSync(path.join(archive, 'dist/index.html'), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^\"]+)"/g)].map(match => match[1]);
  assert.ok(assets.some(asset => asset.endsWith('.js')), '缺少 renderer 脚本');
  for (const asset of assets) {
    assert.ok(asset.startsWith('./'), `桌面资源必须使用相对地址：${asset}`);
    assert.ok(fs.statSync(path.join(archive, 'dist', asset)).isFile(), `资源不存在：${asset}`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-package-smoke-'));
  try {
    const skill = require(path.join(archive, 'electron/desktop-authoring.cjs')).installDesignerSkill('codex', dir, path.join(archive, 'skills/alex-protoflow-designer'));
    assert.ok(fs.statSync(path.join(skill, 'references/full-project-workflow.md')).isFile());
    const channel = require(path.join(archive, 'electron/update-channel.cjs')).validateBundledUpdateChannel();
    const { DesktopUpdater } = require(path.join(archive, 'electron/updater.cjs'));
    const updater = new DesktopUpdater({ dataDir: dir, appVersion: require(path.join(archive, 'package.json')).version,
      fixedUpdateConfig: channel });
    assert.equal(updater.snapshot().serverUrl, channel.serverUrl, '首次安装无需配置更新地址');
    assert.equal(updater.snapshot().signingPublicKey, channel.trustedPublicKey, '首次安装必须有独立的更新信任公钥');
    console.log('PASS 安装包内置更新源与验证公钥，无需用户配置');
    const { PublishingClient } = require(path.join(archive, 'electron/publishing.cjs'));
    const publishing = new PublishingClient({ dataDir: dir, safeStorage: {} });
    assert.equal(publishing.serviceUrl, channel.serverUrl, '发布与更新使用同一套托管服务配置');
    console.log('PASS 安装包内置发布服务地址，无需用户填写');
    const { HermesRuntime } = require(path.join(archive, 'electron/hermes-runtime.cjs'));
    const runtime = new HermesRuntime({ dataDir: dir, emit() {} });
    const [server] = runtime.mcp(dir);
    fs.writeFileSync(path.join(dir, 'context.json'), JSON.stringify({
      active: true, runId: 'package-smoke', projectId: 'package-smoke-project',
      snapshot: { pageSources: { 'package-smoke-page': '<Page />' } }, operations: [],
    }));
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'protoflow_get_project', arguments: {} } },
    ];
    const child = spawnSync(server.command, server.args, {
      cwd: dir,
      env: { ...process.env, ...Object.fromEntries(server.env.map(item => [item.name, item.value])) },
      input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
      encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, child.stderr || `Hermes 工具进程退出：${child.signal}`);
    const responses = child.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(responses.length, 3);
    assert.equal(responses[0].result.serverInfo.name, 'protoflow');
    assert.ok(responses[1].result.tools.some(tool => tool.name === 'protoflow_apply_tsx_patch'));
    assert.ok(responses[1].result.tools.some(tool => tool.name === 'protoflow_add_preview_scenario'));
    assert.notEqual(responses[2].result.isError, true);
    const project = JSON.parse(responses[2].result.content[0].text);
    assert.equal(project.projectId, 'package-smoke-project');
    assert.deepEqual(project.pageIds, ['package-smoke-page']);
    console.log(`PASS 安装包资源与边界检查（${files.length} 个文件）`);
    console.log('PASS 使用安装包运行时启动 Hermes MCP，完成初始化、工具发现、项目读取');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
} else {
  const root = path.resolve(__dirname, '..');
  const defaults = {
    darwin: `release/${process.arch === 'x64' ? 'mac' : `mac-${process.arch}`}/Alex.app`,
    win32: `release/win${process.arch === 'x64' ? '' : `-${process.arch}`}-unpacked`,
    linux: `release/linux${process.arch === 'x64' ? '' : `-${process.arch}`}-unpacked`,
  };
  assert.ok(defaults[process.platform], '当前系统不支持此检查');
  const appDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, defaults[process.platform]);
  const resources = path.join(appDir, process.platform === 'darwin' ? 'Contents/Resources' : 'resources');
  const executable = path.join(appDir, process.platform === 'darwin' ? 'Contents/MacOS/Alex' : process.platform === 'win32' ? 'Alex.exe' : 'protoflow-ai');
  assert.ok(fs.existsSync(executable), `找不到应用：${executable}。请先运行 npm run build:unpacked，或传入当前系统的解包应用路径。`);
  if (process.platform === 'darwin') {
    const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', appDir], { encoding: 'utf8' });
    assert.equal(signature.status, 0, `macOS 安装包签名无效：${signature.stderr}`);
    const info = JSON.parse(spawnSync('plutil', ['-convert', 'json', '-o', '-', path.join(appDir, 'Contents/Info.plist')], { encoding: 'utf8' }).stdout);
    const identity = spawnSync('codesign', ['-d', '--verbose=4', appDir], { encoding: 'utf8' });
    assert.ok(identity.stderr.split('\n').includes(`Identifier=${info.CFBundleIdentifier}`), '签名标识必须与应用 bundle ID 一致');
    assert.equal(info.CFBundleIdentifier, 'com.protoflow.ai', '改名保留应用更新身份');
    assert.equal(info.CFBundleName, 'Alex');
    assert.ok(info.NSLocalNetworkUsageDescription?.trim(), '缺少 macOS 本地网络用途说明');
    console.log('PASS macOS 完整签名、应用身份与本地网络权限说明');
  }
  process.stdout.write(run(executable, [__filename, '--inspect-archive', path.join(resources, 'app.asar')]));
}
