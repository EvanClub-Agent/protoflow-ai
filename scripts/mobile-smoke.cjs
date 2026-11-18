// Real Chromium rendering & interaction test for the Gemini-style Mobile Material System & iPhone Viewport Shell.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_MOBILE_SMOKE_DIR;
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 1100,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    const errors = [];
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    const js = (code) => window.webContents.executeJavaScript(code);
    const waitFor = async (code) => {
      for (let n = 0; n < 100; n++) {
        if (await js(`Boolean(${code})`)) return;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(`Timed out waiting for: ${code}`);
    };
    try {
      await window.loadFile(path.join(dir, 'index.html'));
      await waitFor('window.mobileSmoke && document.querySelector(".pf-mobile-page")');

      // 1. Verify Gemini Light Mode surface color (#F0F4F9 -> rgb(240, 244, 249)) and iPhone 393px viewport
      assert.equal(
        await js('getComputedStyle(document.querySelector(".pf-mobile-page")).backgroundColor'),
        'rgb(240, 244, 249)',
      );
      assert.equal(await js('document.querySelector(".pf-mobile-page").clientWidth'), 393);

      // 2. Switch to iPhone Pro (402px) and iPhone Pro Max (440px)
      await js('window.mobileSmoke.setDevice("iphone-pro")');
      await waitFor('document.querySelector(".pf-mobile-page").clientWidth === 402');
      await js('window.mobileSmoke.setDevice("iphone-promax")');
      await waitFor('document.querySelector(".pf-mobile-page").clientWidth === 440');

      // 3. Verify MPillTabs filtering on MTaskList
      assert.equal(await js('document.querySelectorAll("[data-pf-id=task-list-main] > div > div").length'), 3);
      await js(`Array.from(document.querySelectorAll('[role=tab]')).find(el => el.textContent.includes('已完成')).click()`);
      await waitFor('document.querySelectorAll("[data-pf-id=task-list-main] > div > div").length === 1');

      // 4. Open MBottomSheet inside the phone viewport and submit MForm to insert a new row
      await js('window.mobileSmoke.openNewTask()');
      await waitFor('document.querySelector("[role=dialog][aria-label=发起移动事项]")');
      assert.equal(
        await js('Boolean(document.querySelector(".pf-mobile-page").parentElement.parentElement.querySelector("[role=dialog]"))'),
        true,
        'MBottomSheet must render inside the mobile viewport shell',
      );

      const clickText = (text) => js(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`);
      const enter = (placeholder, value) => js(`(() => {
        const input = document.querySelector('input[placeholder=' + CSS.escape(${JSON.stringify(placeholder)}) + ']');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      assert.equal(
        await js(`(() => {
          const sheet = document.querySelector('[role=dialog][aria-label=发起移动事项]');
          const form = sheet.querySelector('[data-pf-id=mform-new-task]');
          const submitBtn = Array.from(sheet.querySelectorAll('button')).find(el => el.textContent.trim() === '提交申请');
          return form && submitBtn && !form.parentElement.contains(submitBtn);
        })()`),
        true,
        'MBottomDock inside MBottomSheet must remain pinned outside the scrollable body container',
      );
      await enter('请输入申请事项标题', '移动回归事项');
      await clickText('点击选择');
      await waitFor('document.querySelectorAll(".pf-mobile-scope [role=dialog]").length === 2');
      await clickText('供应链运营部');
      await clickText('提交申请');
      await waitFor('document.querySelector("[role=dialog]")?.textContent.includes("请填写初始状态")');
      assert.equal(await js('window.mobileSmoke.taskRows().length'), 3);
      await clickText('待处理');
      await clickText('提交申请');
      await waitFor('!document.querySelector("[role=dialog]")');
      await waitFor('Boolean(document.querySelector(".pf-mobile-scope [role=status]")?.textContent.includes("新事项已创建"))');
      assert.deepEqual(await js('window.mobileSmoke.taskRows().slice(0,1).map(r=>[r.task_title,r.owner_dept,r.status])'),
        [['移动回归事项', '供应链运营部', '待处理']]);
      await js('window.mobileSmoke.openNewTask()');
      await js('window.mobileSmoke.setDark(true)');
      await waitFor('getComputedStyle(document.querySelector(".pf-mobile-page")).backgroundColor === "rgb(19, 19, 20)"');
      assert.equal(await js('getComputedStyle(document.querySelector("[role=dialog]")).backgroundColor'), 'rgb(30, 31, 32)');
      // Nested MForm inside dark MBottomSheet must elevate to #282A2E (rgb(40, 42, 46)) for clear surface separation
      assert.equal(await js('getComputedStyle(document.querySelector("[data-pf-id=mform-new-task] > div")).backgroundColor'), 'rgb(40, 42, 46)');

      // 5. Verify global html[data-theme="dark"] synchronization & CSS isolation
      await js('window.mobileSmoke.setDark(false)');
      await waitFor('getComputedStyle(document.querySelector(".pf-mobile-page")).backgroundColor === "rgb(240, 244, 249)"');
      await js('document.documentElement.dataset.theme = "dark"');
      await waitFor('getComputedStyle(document.querySelector(".pf-mobile-page")).backgroundColor === "rgb(19, 19, 20)"');
      assert.equal(
        await js('getComputedStyle(document.querySelector(".pf-mobile-canvas-stage")).backgroundColor'),
        'rgb(11, 15, 23)',
        'Mobile canvas stage must switch to deep obsidian backdrop in dark mode',
      );
      assert.equal(
        await js('getComputedStyle(document.querySelector("[data-pf-id=task-list-main] > div > div")).backgroundColor'),
        'rgb(30, 31, 32)',
      );
      assert.equal(
        await js('getComputedStyle(document.querySelector("[data-pf-id=task-list-main] > div > div")).color'),
        'rgb(227, 227, 227)',
      );

      // 6. Verify previewAppearance="light" inside a dark workspace keeps crisp white cards (#FFFFFF) without CSS clobbering
      await js('window.mobileSmoke.setPreviewAppearance("light")');
      await waitFor('getComputedStyle(document.querySelector(".pf-mobile-page")).backgroundColor === "rgb(240, 244, 249)"');
      assert.equal(
        await js('getComputedStyle(document.querySelector("[data-pf-id=task-list-main] > div > div")).backgroundColor'),
        'rgb(255, 255, 255)',
        'Light preview inside dark workspace must preserve white mobile cards without global dark CSS override',
      );

      // 7. Verify overflowing content expands MobilePage without boundary spillover, scrolls cleanly, and shows scroll thumb
      await js('window.mobileSmoke.setDevice("iphone")');
      await js(`Array.from(document.querySelectorAll('[role=tab]')).find(el => el.textContent.includes('全部')).click()`);
      await waitFor('document.querySelector(".pf-mobile-page").parentElement.scrollHeight > document.querySelector(".pf-mobile-page").parentElement.clientHeight');
      const scrollMetrics = await js(`(() => {
        const page = document.querySelector(".pf-mobile-page");
        const scroller = page.parentElement;
        const thumbBefore = document.querySelector("[data-mobile-scroll-thumb='1']")?.getBoundingClientRect().top ?? 0;
        scroller.scrollTop = scroller.scrollHeight;
        return {
          clientWidth: page.clientWidth,
          pageOffsetHeight: page.offsetHeight,
          scrollerScrollHeight: scroller.scrollHeight,
          scrollerClientHeight: scroller.clientHeight,
          scrollTop: scroller.scrollTop,
          hasThumb: Boolean(document.querySelector("[data-mobile-scroll-thumb='1']")),
          thumbBefore,
          headerTop: Math.round(page.querySelector("header").getBoundingClientRect().top),
          scrollerTop: Math.round(scroller.getBoundingClientRect().top),
        };
      })()`);
      assert.equal(scrollMetrics.clientWidth, 393, 'iPhone viewport must keep exact 393px width while scrolling');
      assert.equal(
        scrollMetrics.pageOffsetHeight,
        scrollMetrics.scrollerScrollHeight,
        'MobilePage box height must match full scrollable content height without overflowing its boundary',
      );
      assert.equal(scrollMetrics.hasThumb, true, 'Scroll thumb must appear when content exceeds mobile viewport');
      assert.equal(scrollMetrics.scrollTop > 0, true, 'Mobile viewport must scroll when content exceeds container');
      assert.equal(scrollMetrics.headerTop, scrollMetrics.scrollerTop, 'Sticky MTopBar must remain pinned at top through full scroll range');
      await waitFor(`(document.querySelector("[data-mobile-scroll-thumb='1']")?.getBoundingClientRect().top ?? 0) > ${scrollMetrics.thumbBefore}`);

      assert.deepEqual(errors, []);
      console.log('PASS Gemini mobile materials, iPhone 393/402/440 viewports, pill tab filtering, dark surface elevation, and global dark-mode sync/isolation');
      app.exit(0);
    } catch (error) {
      console.error(error);
      console.error(errors);
      app.exit(1);
    }
  });
  setTimeout(() => app.exit(1), 30000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-mobile-smoke-'));
  try {
    const code = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMobileStarterDataset } from './src/proto/mobile/starter';
import { parsePageSource } from './src/proto/dsl/parser';
import { setProp } from './src/proto/dsl/tree';
import { NodeView, ScopeProvider } from './src/proto/renderer/NodeView';
import { findOverlay, RuntimeProvider, useRuntimeController } from './src/proto/runtime/runtime';
import { MobileViewportShell } from './src/proto/mobile/MobileViewportShell';
import { usePageStore } from './src/proto/store/usePageStore';
import { useProtoStore } from './src/store/useProtoStore';

const starter = createMobileStarterDataset();
useProtoStore.setState({ dbTables: starter.dbTables });
usePageStore.setState({ tableRows: starter.tableRows, pageSources: starter.pageSources, designerPages: starter.designerPages });
const baseDoc = parsePageSource(starter.pageSources['mob-tasks']).doc;

function App() {
  const [device, setDevice] = useState('iphone');
  const [dark, setDark] = useState(false);
  const [previewAppearance, setPreviewAppearance] = useState(null);
  const doc = dark ? setProp(baseDoc, baseDoc.root.pfId, 'appearance', 'dark') : baseDoc;
  const rt = useRuntimeController(doc, 'mob-tasks', false);
  window.mobileSmoke = {
    runtime: rt,
    setDevice,
    taskRows: () => usePageStore.getState().tableRows.t_mob_tasks,
    setDark,
    setPreviewAppearance,
    openNewTask: () => rt.openOverlay('sheet-new-task', {}),
  };
  return (
    <div className="pf-mobile-canvas-stage p-4">
      <RuntimeProvider value={rt}>
        <MobileViewportShell
          device={device}
          appearance={doc.root.props.appearance}
          previewAppearance={previewAppearance}
          framed={true}
          runtimeFeedback={{
            toasts: rt.toasts,
            confirmState: rt.confirmState,
            onResolveConfirm: rt.resolveConfirm,
          }}
          overlaySlot={
            <>
              {rt.overlays.map((entry, idx) => {
                const node = findOverlay(doc, entry.id);
                return node ? (
                  <ScopeProvider key={entry.key} value={{ params: entry.params, overlayIndex: idx }}>
                    <NodeView node={node} live />
                  </ScopeProvider>
                ) : null;
              })}
            </>
          }
        >
          <NodeView node={doc.root} />
        </MobileViewportShell>
      </RuntimeProvider>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
`;
    const result = buildSync({
      stdin: { contents: code, resolveDir: root, loader: 'tsx' },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      write: false,
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    fs.writeFileSync(path.join(dir, 'bundle.js'), result.outputFiles[0].contents);
    const cssFile = fs.readdirSync(path.join(root, 'dist/assets')).find((name) => name.endsWith('.css'));
    fs.copyFileSync(path.join(root, 'dist/assets', cssFile), path.join(dir, 'styles.css'));
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./styles.css"><div id="root"></div><script src="./bundle.js"></script>',
    );
    const env = { ...process.env, PFLOW_MOBILE_SMOKE_DIR: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 35000 });
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
    console.log(child.stdout.trim());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
