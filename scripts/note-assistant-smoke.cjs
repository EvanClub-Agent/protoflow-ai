// Exercise the real notes UI and Tiptap history with a deterministic Hermes reply.
// The isolated Electron profile never opens the user's saved projects or AI accounts.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const dir = process.env.PFLOW_NOTE_SMOKE_DIR;
  if (!dir) throw new Error('Missing isolated smoke directory');
  app.setPath('userData', path.join(dir, 'profile'));
  app.whenReady().then(async () => {
    app.dock?.hide();
    const win = new BrowserWindow({ show: false, width: 1280, height: 920 });
    try {
      await win.loadFile(path.join(dir, 'index.html'));
      const result = await win.webContents.executeJavaScript('window.noteSmoke.run()');
      if (!result.ok) throw new Error(result.error);
      if (process.env.PFLOW_NOTE_SCREENSHOT) {
        fs.writeFileSync(process.env.PFLOW_NOTE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      }
      if (process.env.PFLOW_NOTE_DARK_SCREENSHOT) {
        await win.webContents.executeJavaScript('document.documentElement.dataset.theme = "dark"; new Promise(r => setTimeout(r, 350));');
        fs.writeFileSync(process.env.PFLOW_NOTE_DARK_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      }
      console.log('PASS notes UI: model selection and persistence, empty draft, preview, apply, undo, selection polish, stale-content conflict, append, new note, discard');
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
  setTimeout(() => app.exit(1), 45000).unref();
} else {
  const { buildSync } = require('esbuild');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-note-assistant-'));
  try {
    const code = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectNotesView } from './src/components/ProjectNotesView';
import { createProjectPayload, loadProjectFromBinaryPayload } from './src/services/projectStorage';
import { createNoteNode, updateNoteContent } from './src/services/notesWorkspace';
import { useProtoStore } from './src/store/useProtoStore';
import { useHermesStore } from './src/store/useHermesStore';
import { useNoteAssistantStore, noteAssistantRunKey } from './src/services/hermesNoteAssistant';

const projectId = 'note-smoke';
loadProjectFromBinaryPayload(createProjectPayload({ projectId, projectName: '笔记写作测试', templateId: 'blank_project', storageDir: '/tmp', fileName: 'note-smoke.pflow', createdAt: '2026-11-06', updatedAt: '2026-11-06', pageCount: 0, tableCount: 0, stickyCount: 0 }));
const noteId = createNoteNode(projectId, 'note', '订单退款需求说明', null);
let reply = '## 退款流程\\n退款规则与验收标准待确认。';
const calls = [];
const modelSwitches = [];
const models = [{ modelId: 'custom:notes:model-a', name: '写作模型 A' }, { modelId: 'custom:notes:model-b', name: '写作模型 B' }];
let selectedModelId = models[0].modelId;
window.protoflowDesktop = { hermes: {
  onEvent: () => () => {},
  session: async scope => ({ ...scope, sessionId: 'smoke-session', running: false, models: { currentModelId: selectedModelId, availableModels: models } }),
  setModel: async input => {
    modelSwitches.push(input);
    selectedModelId = input.modelId;
    return { projectId: input.projectId, kind: input.kind, threadId: input.threadId, sessionId: 'smoke-session', running: false, models: { currentModelId: selectedModelId, availableModels: models } };
  },
  sync: async () => ({ synced: true }),
  execute: async input => { calls.push({ ...input, executedModelId: selectedModelId }); return { sessionId: 'smoke-session', runId: 'r', modelId: selectedModelId, operations: [], text: reply }; },
  cancel: async () => {},
} };
useHermesStore.setState({ status: 'running' });
createRoot(document.getElementById('root')).render(<ProjectNotesView projectId={projectId} />);

const check = (value, message) => { if (!value) throw new Error(message); };
const wait = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 15)); } throw new Error('Timed out: ' + predicate); };
const button = label => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label);
const click = async label => {
  try { await wait(() => button(label)); } catch { throw new Error('Missing button: ' + label + ' / ' + document.querySelector('[role="dialog"]')?.textContent); }
  button(label).click(); await new Promise(r => setTimeout(r, 30));
};
const body = () => useProtoStore.getState().projectNotes.nodes.find(n => n.id === noteId).content;
const content = () => document.querySelector('[contenteditable="true"]');
const fill = text => {
  const input = document.querySelector('textarea');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const generate = async label => { await click(label); await wait(() => document.querySelector('[aria-label="AI 结果预览"]')); };
const selectParagraph = async index => {
  content().focus();
  const range = document.createRange();
  range.selectNodeContents(content().querySelectorAll('p')[index]);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await wait(() => button('AI 润色选中段'));
};
const undo = async () => {
  content().focus();
  const mac = /Mac/.test(navigator.platform);
  content().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: mac, ctrlKey: !mac, bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
};
window.noteSmoke = { run: async () => { try {
  await wait(() => content());
  await click('AI 助手');
  check(button('开始代写').disabled, 'empty instruction should disable generation');
  const modelTrigger = () => document.querySelector('[aria-label="选择笔记助手模型"]');
  await wait(() => modelTrigger() && !modelTrigger().disabled);
  modelTrigger().click();
  await wait(() => document.querySelector('dialog[open]'));
  document.querySelector('input[type="radio"][value="custom:notes:model-b"]').click();
  await click('切换模型');
  await wait(() => !document.querySelector('dialog[open]'));
  check(modelSwitches.length === 1 && modelSwitches[0].projectId === projectId && modelSwitches[0].kind === 'project' && modelSwitches[0].threadId === 'note-assistant' && modelSwitches[0].modelId === models[1].modelId, 'model selection targeted a different session');
  check(modelTrigger().textContent.includes('写作模型 B'), 'current model label did not update');
  fill('起草退款流程和验收标准，未确认的规则标为待确认');
  await generate('开始代写');
  check(body() === '<p></p>', 'preview must not write the note');
  check(calls[0].readOnly && calls[0].prompt.includes('起草退款流程和验收标准'), 'wrong AI request');
  check(calls[0].executedModelId === models[1].modelId, 'generation did not use the selected model');
  await click('写入笔记');
  check(body().includes('退款规则与验收标准待确认'), 'draft was not written');
  await undo();
  check(body() === '<p></p>', 'draft replacement must be undoable');

  const original = '<p>金额 500 元，需要审核。</p><p>第二段保留。</p>';
  updateNoteContent(projectId, noteId, original);
  await wait(() => content().textContent.includes('第二段保留'));
  await selectParagraph(0);
  await click('AI 润色选中段');
  await wait(() => !modelTrigger().disabled);
  check(modelTrigger().textContent.includes('写作模型 B'), 'reopening the assistant forgot its model');
  await click('正式专业');
  reply = '金额为 500 元，须经审核。';
  await generate('开始润色');
  check(calls[1].prompt.includes('正式、专业、客观') && !calls[1].prompt.includes('第二段保留'), 'polish did not scope the excerpt');
  document.querySelector('[role="dialog"] button[aria-label="关闭"]').click();
  await wait(() => !document.querySelector('[role="dialog"]'));
  await selectParagraph(1);
  await click('AI 润色选中段');
  // Reopening on a different selection must still apply to the range used for generation.
  await click('替换选中内容');
  check(body().includes('须经审核') && body().includes('<p>第二段保留。</p>'), 'selection replacement damaged surrounding content');
  await undo();
  check(body() === original, 'selection replacement must be undoable: ' + body());

  await click('AI 助手');
  await click('润色改写');
  const scope = document.querySelector('[role="dialog"] input[type="checkbox"]');
  if (scope?.checked) scope.click();
  reply = '润色后的全文。';
  await generate('开始润色');
  const edited = '<p>用户生成后补充的重要内容。</p>';
  updateNoteContent(projectId, noteId, edited);
  await wait(() => content().textContent.includes('用户生成后补充'));
  await click('替换全文');
  check(body() === edited && document.querySelector('[role="alert"]').textContent.includes('已有修改'), 'stale result overwrote recent edits');
  await click('追加到文末');
  check(body().includes('用户生成后补充') && body().includes('润色后的全文'), 'append lost current content');
  await undo();
  check(body() === edited, 'append must be undoable');

  await click('AI 助手');
  await click('润色改写');
  await generate('开始润色');
  await click('另存为新笔记');
  const newNote = useProtoStore.getState().projectNotes.nodes.find(n => n.id !== noteId);
  check(newNote.title.includes('AI 润色') && newNote.content.includes('润色后的全文'), 'new note was not created');
  check(body() === edited && newNote.status === 'draft', 'new-note application modified source or status');
  check(!useNoteAssistantStore.getState().runs[noteAssistantRunKey(projectId, noteId)], 'applied result was not cleared');

  await wait(() => content().textContent.includes('润色后的全文'));
  await click('AI 助手');
  fill('根据现有笔记续写一份验收检查清单');
  await generate('开始代写');
  await click('放弃');
  check(!useNoteAssistantStore.getState().runs[noteAssistantRunKey(projectId, newNote.id)], 'discard did not clear preview');
  await click('AI 助手');
  await click('润色改写');
  await click('简洁清晰');
  fill('保留业务规则，适合发给客户确认。');
  reply = '## 退款需求确认\\n\\n退款流程需明确申请条件、审核步骤及验收标准。\\n\\n### 待确认事项\\n- 退款申请的审核责任人。\\n- 是否设置退款金额限制。\\n- 退款完成后的通知方式。';
  await generate('开始润色');
  await click('原文对照');
  check(document.querySelector('[aria-label="AI 结果预览"]').textContent.includes('笔记原文'), 'compare view did not render source text');
  await click('仅看结果');
  reply = '## 退款需求确认（精简版）\\n\\n- 明确退款申请条件、审核责任人及金额上限。\\n- 补充退款完成后的通知机制（待确认）。';
  await click('✨ 再精简一点');
  await wait(() => document.querySelector('[aria-label="AI 结果预览"]')?.textContent.includes('退款需求确认（精简版）'));
  check(button('初稿') && button('第 2 版'), 'multi-turn revision history pills did not render');
  return { ok: true };
} catch (error) { return { ok: false, error: error.stack }; } } };
`;
    buildSync({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, format: 'iife', platform: 'browser', outfile: path.join(dir, 'bundle.js'), loader: { '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
    const cssDir = path.join(root, 'dist/assets');
    const cssFile = fs.readdirSync(cssDir).find(name => /^index-.*\.css$/.test(name));
    if (!cssFile) throw new Error('Run npm run build before this smoke test');
    fs.copyFileSync(path.join(cssDir, cssFile), path.join(dir, 'style.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root" style="height:100vh;display:flex"></div><script src="bundle.js"></script></body></html>');
    const env = { ...process.env, PFLOW_NOTE_SMOKE_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8', timeout: 50000 });
    console.log(child.stdout.trim());
    if (child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
