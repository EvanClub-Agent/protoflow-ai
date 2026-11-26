// Real Chromium rendering/interaction, with an isolated profile and no user projects.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_MATERIAL_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({ show: false, width: 1280, height: 1500, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    window.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
    const js = (code) => window.webContents.executeJavaScript(code);
    const waitFor = async (code) => {
      for (let n = 0; n < 100; n++) {
        if (await js(`Boolean(${code})`)) return;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(`Timed out: ${code}`);
    };
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await waitFor('window.materialSmoke && document.querySelectorAll(".ant-select").length > 0');
      assert.equal(await js('document.querySelectorAll("[role=alert]").length'), 0);
      await js(`document.querySelector('[data-pf-id="status"] input').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));`);
      await waitFor('document.querySelector(".ant-select-item-option")');
      await js(`Array.from(document.querySelectorAll('.ant-select-item-option')).find(e => e.textContent.includes('启用')).click()`);
      await waitFor('window.materialSmoke.runtime.formValues.form?.status_code === 0');
      assert.equal(await js('window.materialSmoke.runtime.vars.changed'), 'yes');
      await js(`document.querySelector('[data-pf-id="switch"] button').click()`);
      await waitFor('window.materialSmoke.runtime.formValues.form?.enabled === true');
      await js(`document.querySelector('[data-pf-id="alert"] button').click()`);
      await waitFor('!document.querySelector("[aria-label=关闭提示]")');
      await js(`document.querySelector('[data-pf-id="confirm"] button').click()`);
      await waitFor('document.querySelector(".ant-popconfirm")');
      await js(`document.querySelector('.ant-popconfirm .ant-btn-primary').click()`);
      await waitFor('window.materialSmoke.runtime.vars.confirmed === "yes"');
      await js(`window.materialSmoke.runtime.run({$kind:'actions',calls:[{name:'resetForm',args:['form']}]}, {})`);
      await waitFor('Object.keys(window.materialSmoke.runtime.formValues.form ?? {}).length === 0');
      // Remount as a designer, including every newly registered material.
      await js('window.materialSmoke.design()');
      await waitFor('window.materialSmoke.runtime.isDesign');
      assert.equal(await js('document.querySelectorAll("[role=alert]").length'), 0);
      assert.equal(await js('document.querySelectorAll(".ant-collapse [aria-expanded=true]").length'), 2);
      await js(`document.querySelector('[data-pf-id="alert"] button').click()`);
      assert.ok(await js('document.querySelector("[aria-label=关闭提示]") !== null'));
      // Verify Ant Design darkAlgorithm and .pf-paper dark token synchronization
      assert.equal(await js('getComputedStyle(document.querySelector("[data-pf-id=page]")).backgroundColor'), 'rgb(248, 250, 252)');
      const copyColor = `getComputedStyle(document.querySelector('[data-pf-quickbar] button[title="复制组件"]')).color`;
      const lightCopyColor = await js(copyColor);
      await js('document.documentElement.dataset.theme = "dark"');
      await waitFor('getComputedStyle(document.querySelector("[data-pf-id=page]")).backgroundColor === "rgb(10, 10, 10)"');
      await waitFor('getComputedStyle(document.querySelector(".ant-select-selector, .ant-select")).backgroundColor === "rgb(20, 20, 20)"');
      assert.equal(await js(copyColor), lightCopyColor, 'quickbar actions stay legible on the same dark toolbar');
      await js('document.documentElement.dataset.theme = "light"');
      await waitFor('getComputedStyle(document.querySelector("[data-pf-id=page]")).backgroundColor === "rgb(248, 250, 252)"');
      if (process.env.PFLOW_MATERIAL_SCREENSHOT) {
        await new Promise((r) => setTimeout(r, 300));
        fs.writeFileSync(process.env.PFLOW_MATERIAL_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      }
      await js('window.showPublishedCanvas()');
      await waitFor('document.querySelector("[data-pf-id=open-edit] button")');
      assert.equal(await js('getComputedStyle(document.querySelector("main")).contain'), 'layout');
      await js('document.querySelector("[data-pf-id=open-edit] button").click()');
      await waitFor('document.querySelector("[data-pf-id=ask] button")');
      await js('document.querySelector("[data-pf-id=ask] button").click()');
      await waitFor('document.querySelector("[data-testid=confirm-submit-btn]")');
      const clickPoint = await js(`(() => {
        const button = document.querySelector('[data-testid=confirm-submit-btn]');
        const rect = button.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
        return { x, y, hitsConfirm: button.contains(document.elementFromPoint(x, y)) };
      })()`);
      assert.ok(clickPoint.hitsConfirm, 'The material modal must not intercept the confirmation click');
      for (const type of ['mouseDown', 'mouseUp']) {
        window.webContents.sendInputEvent({ type, button: 'left', x: clickPoint.x, y: clickPoint.y, clickCount: 1 });
      }
      await waitFor('document.querySelector("[role=status]")?.textContent === "Canvas confirmed"');
      assert.equal(await js('document.querySelector("[data-testid=confirm-submit-btn]")'), null);
      assert.deepEqual(errors, []);
      console.log('PASS material interactions and published canvas modal confirmation in Chromium');
      app.exit(0);
    } catch (error) { console.error(error); console.error(errors); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 30000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-materials-'));
  try {
    const code = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {COMPONENT_MAP} from './src/proto/registry/meta';
import {parsePageSource} from './src/proto/dsl/parser';
import {DesignProvider,NodeView} from './src/proto/renderer/NodeView';
import {RuntimeProvider, useRuntimeController} from './src/proto/runtime/runtime';
import {PublishedViewer} from './src/viewer/PublishedViewer';
const names = ['Flex','Collapse','Avatar','Badge','Progress','Image','Skeleton','Spin','Tooltip','Popover','TimePicker','Slider','Rate','Cascader','TreeSelect','AutoComplete','Segmented'];
const snippets = names.map(name => '<Card title="' + COMPONENT_MAP[name].title + '" width="1/3">' + COMPONENT_MAP[name].snippet + '</Card>').join('');
const source = 'export default function Page(){return <Page pfId="page"><Title level={2}>Ant Design 物料扩展</Title><Form pfId="form" cols={3} layout="vertical"><Select pfId="status" label="状态（数值选项）" name="status_code" showSearch allowClear options={[{label:"启用",value:0},{label:"停用",value:1,disabled:true}]} onChange={() => setVar("changed","yes")} /><Switch pfId="switch" label="启用" name="enabled"/><DatePicker label="日期时间" name="date" showTime/><Input label="只读输入" readOnly/><Textarea label="自动高度" autoSize showCount maxLength={100}/><NumberInput label="金额" precision={2} prefix="¥" /></Form><Alert pfId="alert" message="可以关闭的提示" closable/><Popconfirm pfId="confirm" title="确定执行？" onConfirm={() => setVar("confirmed","yes")}><Button>确认操作</Button></Popconfirm><Table pageSize={2} showQuickJumper scrollY={180} sticky/>' + snippets + '</Page>}';
const doc = parsePageSource(source).doc;
const designApi = { selectedId: 'status', stickyCounts: {}, select() {}, hover() {}, onUpdateProp() {} };
function App(){ const [design, setDesign] = useState(false); const rt = useRuntimeController(doc,'smoke',design); window.materialSmoke = {runtime:rt, design:()=>setDesign(true)}; return <RuntimeProvider value={rt}><DesignProvider value={design ? designApi : null}><NodeView key={String(design)} node={doc.root}/></DesignProvider></RuntimeProvider>; }
const root = createRoot(document.getElementById('root'));
root.render(<App/>);
window.showPublishedCanvas = () => {
  const source = [
    'export default function Page(){return <Page pfId="page" motion="none"><AxureCanvas pfId="canvas" />',
    '<Button pfId="open-edit" onClick={()=>openModal("edit")}>Open</Button>',
    '<Modal pfId="modal" id="edit" title="Edit"><Button pfId="ask" onClick={()=>{confirm("Continue?");toast("Canvas confirmed");}}>Save</Button></Modal></Page>}',
  ].join('');
  const page = {pageId: 'canvas', title: 'Canvas', folderId: 'folder', doc: parsePageSource(source).doc};
  const jsonUrl = value => URL.createObjectURL(new Blob([JSON.stringify(value)], {type: 'application/json'}));
  const snapshot = jsonUrl({formatVersion: 2, projectId: 'smoke', title: 'Smoke', entryPageId: page.pageId,
    pages: [page], tables: [], tableRows: {}, stickyNotes: []});
  const manifest = document.createElement('meta');
  manifest.name = 'protoflow-static-demo';
  manifest.content = jsonUrl({snapshots: {zh: snapshot, en: snapshot}});
  document.head.append(manifest);
  root.render(<PublishedViewer/>);
};
`;
    const result = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'bundle.js'), result.outputFiles[0].contents);
    const cssFile = fs.readdirSync(path.join(root, 'dist/assets')).find((name) => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', cssFile), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div class="pf-paper" id="root"></div><script src="./bundle.js"></script>');
    const env = { ...process.env, PFLOW_MATERIAL_SMOKE_DIR: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 35000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
