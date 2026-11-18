// Render all templates and reported layout regressions with real Chromium SVG metrics.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_DIAGRAM_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
    try {
      await win.loadFile(path.join(dir, 'index.html'));
      const fixtures = await win.webContents.executeJavaScript('window.diagramSmoke.templates.map(item => ({ id: item.id, diagramTypes: item.diagramTypes }))');
      const failures = [];
      for (const item of fixtures) {
        try {
          const result = await win.webContents.executeJavaScript(`window.diagramSmoke.renderTemplate(${JSON.stringify(item.id)})`);
          assert.ok(item.diagramTypes.includes(result.diagramType), item.id);
          assert.ok(result.elements > 2 && result.width > 0 && result.height > 0, `${item.id}: empty SVG`);
          console.log(`PASS render ${item.id}`);
        } catch (error) { failures.push(`${item.id}: ${error.message}`); }
      }
      const purchase = fs.readFileSync(path.join(root, 'tests/fixtures/purchase-flowchart.mmd'), 'utf8');
      const result = await win.webContents.executeJavaScript(`window.diagramSmoke.render(${JSON.stringify(purchase)})`);
      assert.equal(result.diagramType, 'flowchart-v2');
      assert.match(result.svg, /采购业务开始/); assert.match(result.svg, /采购流程完成/);
      assert.match(result.svg, /fff3cd/); assert.match(result.svg, /供应商管理/);
      assert.equal(result.clusters, 10);
      assert.equal(failures.length, 0, failures.join('\n'));
      console.log('PASS full procurement flow: YAML dagre, ten subgraphs, labelled edges and custom styles');
      if (process.env.PFLOW_DIAGRAM_SCREENSHOT) fs.writeFileSync(process.env.PFLOW_DIAGRAM_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      const gantt = fs.readFileSync(path.join(root, 'tests/fixtures/gantt-long-labels.mmd'), 'utf8');
      const ganttResult = await win.webContents.executeJavaScript(`window.diagramSmoke.render(${JSON.stringify(gantt)})`);
      assert.equal(ganttResult.source, gantt, 'Rendering must preserve task names, dates and dependencies');
      assert.equal(ganttResult.diagramType, 'gantt');
      assert.ok(ganttResult.layout.viewBox.width >= 1200, 'Gantt must not lay out into a shrink-to-fit 300px container');
      assert.equal(ganttResult.ganttTask.fontSize, '16px');
      assert.deepEqual(ganttResult.layout.overlaps, [], 'Gantt labels overlap');
      assert.deepEqual(ganttResult.layout.clipped, [], 'Gantt labels exceed its exported viewBox');
      if (process.env.PFLOW_GANTT_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve, 250));
        fs.writeFileSync(process.env.PFLOW_GANTT_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      }
      // Exported SVG must remain usable on its own, outside the editor's CSS.
      const exported = await win.webContents.executeJavaScript(`window.diagramSmoke.inspectExport(${JSON.stringify(ganttResult.svg)})`);
      assert.deepEqual(exported.overlaps, []);
      assert.deepEqual(exported.clipped, []);
      // A small viewport scales the completed layout; it must not influence layout.
      win.setSize(800, 700);
      const compact = await win.webContents.executeJavaScript(`window.diagramSmoke.render(${JSON.stringify(gantt)})`);
      assert.deepEqual(compact.layout.viewBox, ganttResult.layout.viewBox);
      assert.deepEqual(compact.layout.overlaps, []);
      win.setSize(1400, 1000);
      // User-authored frontmatter retains precedence over host rendering defaults.
      const configuredSource = '---\nconfig:\n  gantt:\n    useWidth: 1800\n    leftPadding: 220\n    barHeight: 32\n    barGap: 16\n    fontSize: 20\n---\n' + gantt;
      const configured = await win.webContents.executeJavaScript(`window.diagramSmoke.render(${JSON.stringify(configuredSource)})`);
      assert.equal(configured.source, configuredSource);
      assert.equal(configured.layout.viewBox.width, 1800);
      assert.equal(configured.ganttTask.x, 220);
      assert.equal(configured.ganttTask.height, 32);
      assert.equal(configured.ganttTask.fontSize, '20px');
      console.log('PASS long Chinese Gantt: no text collisions or clipping, standalone SVG export, small viewport, explicit YAML layout');
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 120000).unref();
} else {
  const { buildSync } = require('esbuild'), { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-all-diagrams-'));
  try {
    buildSync({ stdin: { contents: `
import { renderMermaidDiagram } from './src/services/mindmapRenderer';
import { MERMAID_DIAGRAM_TEMPLATES, mermaidTemplate } from './src/services/mermaidCatalog';
const inspectLayout = svg => {
  const box = svg.viewBox.baseVal;
  const items = [...svg.querySelectorAll('text')].filter(el => el.textContent.trim()).map(el => {
    const r = el.getBBox();
    const transform = svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
    const origin = new DOMPoint(r.x, r.y).matrixTransform(transform);
    const end = new DOMPoint(r.x + r.width, r.y + r.height).matrixTransform(transform);
    // Gantt text is axis-aligned; compare in SVG coordinates, independent of zoom.
    return { text: el.textContent, x: origin.x, y: origin.y, width: end.x - origin.x, height: end.y - origin.y };
  });
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1) overlaps.push([a.text, b.text]);
  }
  const clipped = items.filter(item => item.x < box.x - 1 || item.y < box.y - 1 || item.x + item.width > box.x + box.width + 1 || item.y + item.height > box.y + box.height + 1).map(item => item.text);
  return { viewBox: { width: box.width, height: box.height }, overlaps, clipped };
};
const render = async source => {
  const result = await renderMermaidDiagram(source, false);
  document.getElementById('root').innerHTML = result.svg;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const svg = document.querySelector('#root > svg');
  const rect = svg.getBoundingClientRect();
  const task = result.diagramType === 'gantt' ? svg.querySelector('rect.task') : null;
  const taskLabel = svg.querySelector('text.taskText, text.taskTextOutsideRight, text.taskTextOutsideLeft');
  return { ...result, layout: result.diagramType === 'gantt' ? inspectLayout(svg) : null, ganttTask: task ? { x: task.x.baseVal.value, height: task.height.baseVal.value, fontSize: getComputedStyle(taskLabel).fontSize } : null, elements: svg.querySelectorAll('*').length, width: rect.width, height: rect.height, clusters: svg.querySelectorAll('.cluster').length };
};
const inspectExport = async source => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:1600px;height:700px;border:0';
  document.getElementById('root').replaceChildren(frame);
  const loaded = new Promise(resolve => frame.onload = resolve);
  frame.srcdoc = source;
  await loaded;
  return inspectLayout(frame.contentDocument.querySelector('svg'));
};
window.diagramSmoke = { templates: MERMAID_DIAGRAM_TEMPLATES, render, inspectExport, renderTemplate: id => render(mermaidTemplate(id).code) };
`, resolveDir: root, loader: 'ts' }, bundle: true, splitting: true, format: 'esm', platform: 'browser', outdir: dir, entryNames: 'bundle', define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><meta charset="utf-8"><style>body{margin:0}#root{height:100vh;padding:20px;box-sizing:border-box}#root>svg{width:100%;height:100%;max-width:none!important}</style><div id="root"></div><script type="module" src="./bundle.js"></script></html>');
    const env = { ...process.env, PFLOW_DIAGRAM_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 130000 });
    console.log(child.stdout.trim());
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
