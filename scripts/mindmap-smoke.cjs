// Exercise the real activity bar and official Mermaid in isolated Chromium.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_MINDMAP_SMOKE_DIR;
  if (!dir) throw new Error('Missing isolated test directory');
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [], downloads = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    win.webContents.session.on('will-download', (_event, item) => {
      const file = path.join(dir, path.basename(item.getFilename()));
      item.setSavePath(file);
      item.once('done', (_event, state) => downloads.push({ file, state }));
    });
    const js = code => win.webContents.executeJavaScript(code);
    const waitFor = async (code, description) => {
      for (let i = 0; i < 160; i++) {
        if (await js(code)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${description}`);
    };
    const click = async label => js(`(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)});
      if (!button || button.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(label)});
      button.click();
    })()`);
    const fill = async (label, value) => js(`(() => {
      const editor = [...document.querySelectorAll('textarea,input,select')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(label)});
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value').set.call(editor, ${JSON.stringify(value)});
      editor.dispatchEvent(new Event(editor.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    })()`);
    const newNode = async (label, name) => { await click(label); await fill('脑图节点名称', name); await click('创建'); };
    const type = value => fill('脑图源码', value);
    const waitSvg = text => waitFor(`Boolean(document.querySelector('[data-mindmap-preview] svg')?.textContent.includes(${JSON.stringify(text)}))`, text);
    try {
      await win.loadFile(path.join(dir, 'index.html'));
      await waitFor('Boolean(document.querySelector("button[aria-label=项目脑图]"))', 'activity bar');
      await click('项目脑图');
      await newNode('新建脑图目录', '业务模块');
      await newNode('新建脑图目录', '采购模块');
      await newNode('新建脑图菜单', '模块规划');
      await waitFor('Boolean(document.querySelector("textarea[aria-label=脑图源码]"))', 'editor');
      assert.equal(await js('document.querySelector("button[aria-label=项目脑图]").getAttribute("aria-pressed")'), 'true');
      assert.equal(await js('window.mindmapSmoke.source()'), '');
      await click('使用脑图模板');
      await waitSvg('项目规划');
      const source = 'mindmap\n  root((我的项目))\n    需求梳理\n      中文节点\n    交付计划';
      await type(source);
      await waitSvg('中文节点');
      assert.ok(await js(`(() => {
        const canvas = document.querySelector('[data-mindmap-preview]').getBoundingClientRect();
        const svg = document.querySelector('[data-mindmap-preview] svg').getBoundingClientRect();
        return svg.width <= canvas.width && svg.height <= canvas.height && svg.bottom <= canvas.bottom;
      })()`), 'fit view must show the complete diagram vertically and horizontally');
      assert.equal(await js('window.mindmapSmoke.source()'), source);
      const width = await js('document.querySelector("[data-mindmap-preview] svg").getBoundingClientRect().width');
      await click('放大脑图');
      await waitFor(`document.querySelector('[data-mindmap-preview] svg').getBoundingClientRect().width > ${width}`, 'zoom');
      await click('适应画布');
      await click('导出源码'); await click('导出 SVG');
      for (let i = 0; i < 80 && downloads.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(downloads.length, 2);
      assert.ok(downloads.every(download => download.state === 'completed'));
      assert.equal(fs.readFileSync(downloads.find(download => download.file.endsWith('.mmd')).file, 'utf8'), source);
      assert.match(fs.readFileSync(downloads.find(download => download.file.endsWith('.svg')).file, 'utf8'), /中文节点/);
      if (process.env.PFLOW_MINDMAP_SCREENSHOT) fs.writeFileSync(process.env.PFLOW_MINDMAP_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      const lightSvg = await js('document.querySelector("[data-mindmap-preview]").innerHTML');
      await js('document.documentElement.dataset.theme = "dark"');
      await waitFor(`Boolean(document.querySelector('[data-mindmap-preview] svg')) && document.querySelector('[data-mindmap-preview]').innerHTML !== ${JSON.stringify(lightSvg)}`, 'dark theme');
      await type('---\nconfig:\n  layout: dagre\n---\nflowchart LR\n A[流程开始]-->B[流程结束]');
      await waitSvg('流程结束');
      assert.equal(await js('document.querySelector("button[title=追加分支仅适用于思维导图]").disabled'), true);
      await fill('手工制作图表类型', 'sequence'); await click('使用模板');
      await click('保留当前内容'); await waitSvg('流程结束');
      await click('使用模板'); await click('替换为模板'); await waitSvg('提交请求');
      await type('invalid mermaid source');
      await waitFor('Boolean(document.querySelector("[data-mindmap-preview] [role=alert]"))', 'syntax error');
      await type(source); await waitSvg('中文节点');
      // Create a second independent map, rename and move it through the real UI.
      await newNode('新建脑图菜单', '第二张脑图');
      await type('mindmap\n  独立模块'); await waitSvg('独立模块');
      await click('重命名 / 移动'); await fill('脑图节点名称', '仓储规划'); await fill('脑图所属目录', ''); await click('保存');
      await click('模块规划'); await waitSvg('中文节点');
      // Page-folder -> map-folder links are inherited by contained maps.
      await click('页面目录'); await click('关联脑图：项目页面');
      await js(`(() => { const label = [...document.querySelectorAll('dialog label')].find(e => e.textContent.trim() === '目录 · 业务模块'); label.querySelector('input').click(); })()`);
      await click('保存关联'); await click('项目脑图'); await waitSvg('中文节点');
      assert.ok(await js(`document.querySelector('[aria-label="项目脑图工作区"]').textContent.includes('项目页面（继承）')`));
      await js('window.mindmapSmoke.save()');
      // Begin another render and switch projects before its result can commit.
      await type('mindmap\n  不能出现在项目乙');
      await new Promise(resolve => setTimeout(resolve, 310));
      await js('window.mindmapSmoke.openB()'); await click('项目脑图'); await newNode('新建脑图菜单', '项目乙脑图');
      await waitFor('Boolean(document.querySelector("textarea[aria-label=脑图源码]"))', 'project B editor');
      assert.equal(await js('document.querySelector("textarea[aria-label=脑图源码]").value'), '');
      await new Promise(resolve => setTimeout(resolve, 600));
      assert.equal(await js('document.querySelector("[data-mindmap-preview]").textContent.includes("不能出现在项目乙")'), false);
      await type('mindmap\n  项目乙'); await waitSvg('项目乙');
      await js('window.mindmapSmoke.restore()'); await click('项目脑图'); await click('模块规划'); await waitSvg('中文节点');
      await click('页面目录');
      await waitFor('!document.querySelector("textarea[aria-label=脑图源码]")', 'return to pages');
      await click('项目脑图'); await waitSvg('中文节点');
      win.setSize(800, 700);
      await waitFor('window.innerWidth === 800', 'compact window');
      assert.ok(await js('document.documentElement.scrollWidth <= window.innerWidth'));
      assert.ok(await js('document.querySelector("textarea[aria-label=脑图源码]").getBoundingClientRect().height > 50'));
      win.setSize(1440, 960);
      await js('window.mindmapSmoke.connectAi()');
      await waitFor('Boolean(document.querySelector("button[aria-label=选择对话模型]"))', 'mindmap model controls');
      await fill('脑图生成要求', '根据实际页面、便签与数据库生成全景脑图');
      await click('生成图表'); await waitSvg('AI项目全景');
      const input = await js('window.mindmapSmoke.lastAiInput()');
      assert.equal(input.mindmapId, input.snapshot.currentMindmap.mindmapId);
      assert.deepEqual(input.snapshot.currentMindmap.relatedPageIds, ['page-home']);
      assert.equal(input.kind, 'mindmap'); assert.equal(input.pageId, undefined); assert.equal(input.readOnly, true);
      assert.ok(Object.hasOwn(input.snapshot.pageSources, 'page-home'));
      assert.ok(Array.isArray(input.snapshot.stickyNotes)); assert.ok(Array.isArray(input.snapshot.dbTables));
      assert.ok(Object.hasOwn(input.snapshot, 'tableRows'));
      if (process.env.PFLOW_MINDMAP_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve, 400));
        await waitSvg('AI项目全景');
        await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        fs.writeFileSync(process.env.PFLOW_MINDMAP_SCREENSHOT.replace(/\.png$/, '-ai.png'), (await win.webContents.capturePage()).toPNG());
      }
      await js('window.mindmapSmoke.deferAi()');
      await click('生成图表'); await waitFor('window.mindmapSmoke.aiPending()', 'pending AI request');
      await click('停止生成');
      await waitFor('document.querySelector("[aria-label=\\\"Hermes 脑图生成\\\"] [role=alert]")?.textContent.includes("已停止")', 'cancelled AI');
      assert.equal(await js('window.mindmapSmoke.source()'), 'mindmap\n  root((AI项目全景))\n    首页\n    页面内容');
      await click('生成图表'); await waitFor('window.mindmapSmoke.aiPending()', 'second pending AI request');
      await type('mindmap\n  用户手动修改');
      await js('window.mindmapSmoke.finishAi()');
      await waitFor('document.querySelector("[aria-label=\\\"Hermes 脑图生成\\\"] [role=alert]")?.textContent.includes("已变化")', 'preserve manual edits');
      assert.equal(await js('window.mindmapSmoke.source()'), 'mindmap\n  用户手动修改');
      await click('仓储规划'); await waitSvg('独立模块');
      assert.equal(await js('document.querySelector("textarea[aria-label=脑图生成要求]").value'), '');
      await click('删除当前脑图节点'); await click('确认删除');
      assert.equal(await js('window.mindmapSmoke.mapCount()'), 3);
      await click('模块规划'); await waitSvg('用户手动修改');
      await js('window.mindmapSmoke.immediateAi()');
      await fill('AI 图表类型', 'flowchart');
      await fill('脑图生成要求', '生成采购审批流程图'); await click('生成图表');
      await waitSvg('AI采购流程');
      assert.ok((await js('window.mindmapSmoke.lastAiInput().prompt')).includes('用户选择的图表类型：流程图'));
      // Exercise the reported Gantt with the application's real CSS and canvas.
      const gantt = fs.readFileSync(path.join(root, 'tests/fixtures/gantt-long-labels.mmd'), 'utf8');
      await js('document.documentElement.dataset.theme = "light"');
      await type(gantt); await waitSvg('人员管理系统');
      assert.equal(await js('window.mindmapSmoke.source()'), gantt);
      const checkGanttLayout = async () => {
        const layout = await js(`(() => {
          const svg = document.querySelector('[data-mindmap-preview] svg');
          const items = [...svg.querySelectorAll('text')].filter(el => el.textContent.trim()).map(el => ({ text: el.textContent, rect: el.getBoundingClientRect() }));
          const overlaps = [];
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i].rect, b = items[j].rect;
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([items[i].text, items[j].text]);
          }
          return { width: svg.viewBox.baseVal.width, overlaps };
        })()`);
        assert.ok(layout.width >= 1200);
        assert.deepEqual(layout.overlaps, []);
      };
      await checkGanttLayout();
      assert.ok(await js(`(() => {
        const svg = document.querySelector('[data-mindmap-preview] svg').getBoundingClientRect();
        const left = document.querySelector('button[title="收起源码面板"]').parentElement.getBoundingClientRect();
        const right = document.querySelector('button[aria-label="适应画布"]').parentElement.getBoundingClientRect();
        return svg.left > left.right && svg.right < right.left;
      })()`), 'Fitted diagrams must leave room for floating toolbars');
      await click('放大脑图'); await checkGanttLayout();
      await click('适应画布');
      if (process.env.PFLOW_MINDMAP_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve, 400));
        fs.writeFileSync(process.env.PFLOW_MINDMAP_SCREENSHOT.replace(/\.png$/, '-gantt.png'), (await win.webContents.capturePage()).toPNG());
      }
      assert.deepEqual(errors, []);
      console.log('PASS Chromium: nested map directories, independent documents, rename/move/delete, page-folder associations, editing/rendering/export; Hermes generation UI, read-only context, model controls, cancellation and manual-edit protection; long Chinese Gantt layout and zoom');
      app.exit(0);
    } catch (error) { console.error(error); console.error(errors); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 45000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-mindmap-'));
  try {
    buildSync({
      stdin: { contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/App';
import { useProtoStore } from './src/store/useProtoStore';
import { useHermesStore } from './src/store/useHermesStore';
import { conversationKey } from './src/services/hermesConversation';
import { createProjectPayload, loadProjectFromBinaryPayload, captureProjectPayload } from './src/services/projectStorage';
import { encodePflowBinary, decodePflowBinary } from './src/utils/pflowBinaryCodec';
import { projectWithHome } from './tests/fixtures/projectWithHome';
const project = id => projectWithHome({ projectId: id, projectName: '脑图工作区测试', templateId: 'blank_project', storageDir: '/tmp', fileName: id + '.pflow', createdAt: '2026-11-01', updatedAt: '2026-11-01', pageCount: 0, tableCount: 0, stickyCount: 0 });
let saved, lastAiInput, deferAi = false, pendingAi;
const listeners = new Set();
const finishAi = () => { const finish = pendingAi; pendingAi = undefined; finish?.(); };
const connectAi = () => {
  window.protoflowDesktop = { hermes: {
    onEvent: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    session: async scope => ({ ...scope, sessionId: conversationKey(scope), running: false, models: { currentModelId: 'test-model', availableModels: [{ modelId: 'test-model', name: '测试模型' }] } }),
    sync: async () => ({ synced: true }),
    execute: async input => {
      lastAiInput = input;
      if (deferAi) await new Promise(resolve => { pendingAi = resolve; });
      const fence = String.fromCharCode(96).repeat(3);
      const code = input.prompt.includes('用户选择的图表类型：流程图') ? 'flowchart TB\\n A[AI采购流程]-->B[审批完成]' : 'mindmap\\n  root((AI项目全景))\\n    首页\\n    页面内容';
      return { text: fence + 'mermaid\\n' + code + '\\n' + fence, operations: [], sessionId: conversationKey(input), runId: 'browser-ai-run', modelId: 'test-model' };
    },
    cancel: async () => finishAi(),
  } };
  useHermesStore.setState({ status: 'running', sessions: {} });
};
loadProjectFromBinaryPayload(project('mindmap-a'));
window.mindmapSmoke = { connectAi, lastAiInput: () => lastAiInput, deferAi: () => { deferAi = true; }, aiPending: () => Boolean(pendingAi), finishAi, immediateAi: () => { deferAi = false; }, mapCount: () => useProtoStore.getState().mindmaps.nodes.length, source: () => { const state = useProtoStore.getState(); return state.mindmaps.nodes.find(node => node.id === state.selectedMindmapNodeId)?.source; }, save: () => { saved = encodePflowBinary(captureProjectPayload()); }, openB: () => loadProjectFromBinaryPayload(project('mindmap-b')), restore: () => loadProjectFromBinaryPayload(decodePflowBinary(saved)) };
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
`, resolveDir: root, loader: 'tsx' },
      bundle: true, splitting: true, format: 'esm', platform: 'browser', jsx: 'automatic', outdir: dir,
      entryNames: 'bundle', loader: { '.svg': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
    });
    const css = fs.readdirSync(path.join(root, 'dist/assets')).find(name => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', css), path.join(dir, 'styles.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="root"></div><script type="module" src="./bundle.js"></script></html>');
    const env = { ...process.env, PFLOW_MINDMAP_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 50000 });
    if (child.status !== 0) throw new Error(child.error?.message || `${child.stdout}\n${child.stderr}`);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
