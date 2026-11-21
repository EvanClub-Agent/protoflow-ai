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
  app.setPath('appData', dir);
  const profile = path.join(dir, 'protoflow-ai');
  fs.mkdirSync(profile);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  Object.defineProperty(app, 'isPackaged', { value: true }); // Exercise dist/index.html even with Vite running.
  const file = path.join(dir, 'live.pflow');
  const base = [path.join(root, 'packages/protoflow-mcp/dist/cli.cjs')];
  const runtime = { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  function call(config, name, args) {
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
          assert.ok(!response.result.isError, response.result.content[0].text);
          resolve(JSON.parse(response.result.content[0].text));
        } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    });
  }
  async function run() {
    const local = { ...runtime, args: [...base, '--rw', '--workspace', dir] };
    await call(local, 'protoflow_workspace', { action: 'create_project', projectName: 'Live smoke', filePath: file });
    local.args.push('--project', file);
    await call(local, 'protoflow_manage_sitemap', { action: 'upsert_folder', folder: { id: 'smoke-folder', title: 'Pages', parentFolderId: null } });
    await call(local, 'protoflow_write_page', { pageId: 'smoke-page', title: 'Smoke', folderId: 'smoke-folder',
      platform: 'desktop', source: 'export default function Page() { return (<Page pfId="smoke-root" title="Smoke"><Tag pfId="smoke-tag">Before</Tag></Page>); }' });
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
    const ctx = await call(config, 'protoflow_workspace', { action: 'status' });
    assert.equal(ctx.activePageId, 'smoke-page');
    assert.equal(ctx.selectedPfId, 'smoke-tag');
    await click("[...document.querySelectorAll('dialog button')].find(b => /^(完成|Done)$/.test(b.textContent))");
    await call(config, 'protoflow_edit_page_block', { pageId: ctx.activePageId, targetPfId: ctx.selectedPfId, expectedRevision: ctx.revision,
      mode: 'replace_node', tsx: '<Tag pfId="smoke-tag" color="blue">Live update</Tag>' });
    const text = () => evalUi("document.querySelector('[data-pf-id=smoke-tag]')?.textContent");
    assert.match(await text(), /Live update/);
    const diskSpec = () => call(local, 'protoflow_get_page_spec', { pageId: 'smoke-page' });
    assert.match((await diskSpec()).pageSourceTsx, /Live update/);
    await click("[...document.querySelectorAll('button')].find(b => /^(撤销|Undo)$/.test(b.textContent) && !b.disabled)");
    assert.match(await text(), /Before/);
    await until(async () => (await diskSpec()).pageSourceTsx.includes('Before'), 'undo saved');
    await click("document.querySelector('button[aria-label^=MCP]')");
    await click("[...document.querySelectorAll('label')].find(l => /只读规格|Read-only specs/.test(l.textContent))?.querySelector('input')");
    await assert.rejects(call(config, 'protoflow_workspace', { action: 'status' }), /connection unavailable/);
    console.log('PASS real Electron editor → stdio config → live selection → canvas edit → disk → undo → disconnect');
  }
  run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
}
