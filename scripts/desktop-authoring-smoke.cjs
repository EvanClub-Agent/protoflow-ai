// Exercise the shipping IPC handlers, preload, editor and generated stdio command in an isolated profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-live-smoke-'));
  try {
    const env = { ...process.env, ALEX_LIVE_SMOKE_DIR: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', timeout: 90000 });
    assert.equal(run.status, 0, run.error?.message || 'Desktop integration failed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow, dialog } = require('electron');
  const dir = process.env.ALEX_LIVE_SMOKE_DIR;
  assert.ok(dir && path.isAbsolute(dir));
  app.setPath('home', dir);
  assert.equal(app.getPath('home'), dir);
  app.setPath('appData', dir);
  const profile = path.join(dir, 'protoflow-ai');
  fs.mkdirSync(profile);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  Object.defineProperty(app, 'isPackaged', { value: true }); // Exercise dist/index.html even with Vite running.
  const file = path.join(dir, 'live.pflow');
  const base = [path.join(root, 'packages/protoflow-mcp/dist/cli.cjs')];
  const runtime = { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  function request(config, method, params) {
    return new Promise((resolve, reject) => {
      const child = spawn(config.command, config.args, { env: { ...process.env, ...config.env } });
      let out = '', err = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        try {
          assert.equal(code, 0, err);
          const response = JSON.parse(out);
          assert.ok(!response.error, response.error?.message);
          assert.ok(!response.result.isError, response.result.content?.find(block => block.type === 'text')?.text);
          resolve(response.result);
        } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
    });
  }
  async function call(config, name, args) {
    const { content } = await request(config, 'tools/call', { name, arguments: args });
    return JSON.parse(content[0].text);
  }
  async function capture(config, args, inspectImage) {
    const result = await request(config, 'tools/call', { name: 'protoflow_capture_preview', arguments: args });
    assert.equal(result.content[0].mimeType, 'image/png');
    const bytes = Buffer.from(result.content[0].data, 'base64');
    const meta = JSON.parse(result.content[1].text);
    assert.equal(bytes.readUInt32BE(16), meta.width);
    assert.equal(bytes.readUInt32BE(20), meta.height);
    const image = require('electron').nativeImage.createFromBuffer(bytes);
    if (inspectImage) inspectImage(image, meta);
    const pixels = image.resize({ width: 50 }).toBitmap();
    assert.ok(new Set(pixels).size > 10, 'Preview must contain painted content');
    return meta;
  }
  async function run() {
    const local = { ...runtime, args: [...base, '--rw', '--workspace', dir] };
    await call(local, 'protoflow_workspace', { action: 'create_project', projectName: 'Live smoke', projectMode: 'hybrid', filePath: file });
    local.args.push('--project', file);
    await call(local, 'protoflow_manage_sitemap', { action: 'upsert_folder', folder: { id: 'smoke-folder', title: 'Pages', parentFolderId: null } });
    await call(local, 'protoflow_write_page', { pageId: 'smoke-page', title: 'Smoke', folderId: 'smoke-folder',
      platform: 'desktop', source: 'export default function Page() { return (<Page pfId="smoke-root" title="Smoke"><Tag pfId="smoke-tag">Before</Tag></Page>); }' });
    const listItems = Array.from({ length: 55 }, (_, i) => `<MListItem pfId="row-${i}" title="Row ${i}" />`).join('');
    await call(local, 'protoflow_write_page', { pageId: 'mobile', title: 'Mobile fixture', platform: 'mobile', folderId: 'smoke-folder',
      source: `export default function Page() { return (<MobilePage pfId="m-root"><MTopBar pfId="m-top" title="Mobile fixture" /><MListGroup pfId="rows" title="Rows">${listItems}</MListGroup></MobilePage>); }` });
    const widget = 'export default function Component() { return <section className="sample">Painted</section>; }';
    const widgetNode = `<Freeform pfId="widget" title="Paint" source={${JSON.stringify(widget)}} css=".sample{height:1080px;background:#f32081}" />`;
    await call(local, 'protoflow_write_page', { pageId: 'dashboard', title: 'Dashboard', platform: 'desktop', folderId: 'smoke-folder',
      source: `export default function Page() { return (<Page pfId="dashboard-root"><BarChart pfId="chart" source="sample" />${widgetNode}</Page>); }` });
    assert.ok(!(await request(local, 'tools/list', {})).tools.some(tool => tool.name === 'protoflow_capture_preview'));
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    require('../electron/main.cjs');
    await app.whenReady();
    let win;
    const until = async (fn, label) => {
      for (let n = 0; n < 200; n++) {
        const value = await fn();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      throw new Error('Timed out: ' + label);
    };
    await until(() => (win = BrowserWindow.getAllWindows()[0]), 'editor window');
    const evalUi = source => win.webContents.executeJavaScript(source);
    const click = expr => until(() => evalUi(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true })()`), expr);
    await click("[...document.querySelectorAll('button')].find(b => /打开本地项目|Open Local/.test(b.textContent))");
    await click("document.querySelector('[data-pf-id=smoke-tag]')");
    await click("document.querySelector('button[aria-label^=MCP]')");
    await click("[...document.querySelectorAll('label')].find(l => /双向设计|Bidirectional design/.test(l.textContent))?.querySelector('input')");
    const config = await until(() => evalUi(`(() => { const code = document.querySelector('code[id$="_snippet"]')?.textContent;
      return code?.includes('--desktop-bridge') && JSON.parse(code).mcpServers.protoflow; })()`), 'generated stdio config');
    const integrationButton = english => click("[...document.querySelectorAll('dialog button')].find(b => /" + english + "/.test(b.textContent))");
    const extensionFile = path.join(dir, 'Claude export.mcpb');
    const pluginDir = path.join(dir, '.gemini/config/plugins/alex-protoflow-designer');
    await integrationButton('安装 Antigravity 插件|Install Antigravity plugin');
    await until(() => fs.existsSync(path.join(pluginDir, 'mcp_config.json')), 'installed plugin');
    dialog.showSaveDialog = async () => ({ canceled: true });
    await integrationButton('导出 Claude Desktop 扩展|Export Claude Desktop extension');
    await until(() => evalUi("!document.querySelector('dialog fieldset:disabled')"), 'cancelled export');
    assert.ok(!fs.existsSync(extensionFile));
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: extensionFile });
    await integrationButton('导出 Claude Desktop 扩展|Export Claude Desktop extension');
    await until(() => fs.existsSync(extensionFile), 'exported .mcpb');
    const { unzipSync } = require('fflate');
    const extension = unzipSync(fs.readFileSync(extensionFile));
    const manifest = JSON.parse(Buffer.from(extension['manifest.json']));
    const extracted = path.join(dir, 'unpacked extension');
    const entry = path.join(extracted, manifest.server.entry_point);
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, extension[manifest.server.entry_point]);
    const connectionFile = config.args.at(-1);
    assert.equal(manifest.user_config.connection_file.default, connectionFile);
    const claude = manifest.server.mcp_config;
    claude.args = claude.args.map(arg => arg.replace('${__dirname}', extracted).replace('${user_config.connection_file}', connectionFile));
    const plugin = JSON.parse(fs.readFileSync(path.join(pluginDir, 'mcp_config.json'))).mcpServers.protoflow;
    plugin.args = plugin.args.map(arg => arg.replace('${PLUGIN_ROOT}', pluginDir));
    for (const client of [plugin, claude]) {
      const list = await request(client, 'tools/list', {});
      assert.ok(list.tools.some(tool => tool.name === 'protoflow_capture_preview'));
      assert.equal((await capture(client, { pageId: 'mobile' })).pageId, 'mobile');
    }
    console.log('PASS both desktop export buttons, cancellation, package entry points, tool discovery and mobile PNG');
    const ctx = await call(config, 'protoflow_workspace', { action: 'status' });
    assert.equal(ctx.activePageId, 'smoke-page');
    assert.equal(ctx.selectedPfId, 'smoke-tag');
    await click("[...document.querySelectorAll('dialog button')].find(b => /^(完成|Done)$/.test(b.textContent))");
    await call(config, 'protoflow_edit_page_block', { pageId: ctx.activePageId, targetPfId: ctx.selectedPfId, expectedRevision: ctx.revision,
      mode: 'replace_node', tsx: '<Tag pfId="smoke-tag" color="blue">Live update</Tag>' });
    const text = () => evalUi("document.querySelector('[data-pf-id=smoke-tag]')?.textContent");
    assert.match(await text(), /Live update/);
    const beforeCapture = await call(config, 'protoflow_workspace', { action: 'status' });
    assert.ok((await request(config, 'tools/list', {})).tools.some(tool => tool.name === 'protoflow_capture_preview'));
    const active = await capture(config, {});
    assert.ok(active.width >= 1280);
    const full = await capture(config, { pageId: 'dashboard', fullPage: true }, image => {
      const bgra = image.toBitmap();
      let bars = 0, widgetPixels = 0;
      for (let i = 0; i < bgra.length; i += 4) {
        if (bgra[i] === 0xc6 && bgra[i + 1] === 0x70 && bgra[i + 2] === 0x54) bars++;
        if (bgra[i] === 0x81 && bgra[i + 1] === 0x20 && bgra[i + 2] === 0xf3) widgetPixels++;
      }
      assert.ok(bars > 500, 'Chart bars must be painted with default waitMs');
      assert.ok(widgetPixels > 50000, 'Freeform content must be painted with default waitMs');
    });
    assert.equal(full.fullPage, true);
    assert.equal(full.truncated, false);
    assert.ok(full.height > active.height && full.height >= 1080);
    const initialized = await request(config, 'initialize', {});
    assert.match(initialized.instructions, /protoflow_capture_preview/);
    assert.equal(active.pageId, 'smoke-page');
    const phone = await capture(config, { pageId: 'mobile', scope: 'viewport', waitMs: 50 });
    const stage = await capture(config, { pageId: 'mobile', scope: 'canvas' });
    const longPhone = await capture(config, { pageId: 'mobile', scope: 'viewport', fullPage: true });
    assert.equal(longPhone.width, phone.width);
    assert.ok(longPhone.height > phone.height && longPhone.height <= 2160);
    assert.equal(longPhone.truncated, true);
    assert.equal(phone.pageId, 'mobile');
    assert.equal(phone.platform, 'mobile');
    assert.equal(phone.revision, beforeCapture.revision);
    assert.equal(phone.width / phone.height, 393 / 852);
    assert.ok(stage.width > phone.width && stage.height > phone.height);
    assert.deepEqual(await call(config, 'protoflow_workspace', { action: 'status' }), beforeCapture);
    await assert.rejects(capture(config, { pageId: 'missing' }), /pageId/);
    console.log('PASS desktop and mobile PNGs, device crop, stable selection, revision and undo');
    const diskSpec = () => call(local, 'protoflow_get_page_spec', { pageId: 'smoke-page' });
    assert.match((await diskSpec()).pageSourceTsx, /Live update/);
    app.focus({ steal: true }); win.show(); win.focus();
    const sendUndo = () => {
      const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
      for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Z', modifiers });
    };
    await evalUi("const field = document.createElement('textarea'); field.id='test-text-undo'; document.body.append(field); field.focus()");
    await win.webContents.insertText('typed');
    const fieldValue = () => evalUi("document.getElementById('test-text-undo').value");
    assert.equal(await fieldValue(), 'typed');
    sendUndo();
    await until(async () => (await fieldValue()) === '', 'native text undo');
    assert.match(await text(), /Live update/);
    await evalUi("document.getElementById('test-text-undo').remove()");
    sendUndo();
    await until(async () => (await text())?.includes('Before'), 'project keyboard undo');
    console.log('PASS native text undo and focused canvas Cmd/Ctrl+Z through Electron keyboard input');
    assert.match(await text(), /Before/);
    await until(async () => (await diskSpec()).pageSourceTsx.includes('Before'), 'undo saved');
    if (process.platform === 'darwin') {
      await call(config, 'protoflow_edit_page_block', { pageId: 'smoke-page', targetPfId: 'smoke-tag', mode: 'replace_node',
        tsx: '<Tag pfId="smoke-tag">Menu undo</Tag>' });
      const menuUndo = require('electron').Menu.getApplicationMenu().getMenuItemById('alex-undo');
      assert.equal(menuUndo.accelerator, 'Command+Z');
      menuUndo.click(undefined, win);
      await until(async () => (await text())?.includes('Before'), 'AppKit menu command undo');
    }
    await click("document.querySelector('button[aria-label^=MCP]')");
    await click("[...document.querySelectorAll('label')].find(l => /只读规格|Read-only specs/.test(l.textContent))?.querySelector('input')");
    await assert.rejects(call(config, 'protoflow_workspace', { action: 'status' }), /connection unavailable/);
    console.log('PASS real Electron editor → stdio config → live selection → canvas edit → disk → undo → disconnect');
  }
  run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
}
