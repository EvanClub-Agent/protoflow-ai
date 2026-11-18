import { acknowledgeToolDiscovery } from './fixtures/hermesToolDiscovery';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useAiChatStore, type AiChatMessage } from '../src/store/useAiChatStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { useProtoStore } from '../src/store/useProtoStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { conversationKey } from '../src/services/hermesConversation';
import { createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { runProjectAi } from '../src/services/hermesBridge';
import { HermesSessionControls } from '../src/components/HermesSessionControls';
import { HermesEngineModal } from '../src/components/HermesEngineModal';
import type { HermesEvent } from '../src/services/hermesClient';
const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
const src = (title: string) => `export default function Page(){return <Page pfId="root" title="${title}"/>;}`;
function fixture(projectId: string) {
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
  const p = createProjectPayload({ projectId, projectName: projectId, storageDir: '/tmp', fileName: `${projectId}.pflow`, templateId: 'blank_project', createdAt: '2026-10-31', updatedAt: '2026-10-31', pageCount: 0, tableCount: 0, stickyCount: 0 });
  p.stateSnapshot.designerFolders = [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }];
  p.stateSnapshot.pageSources = { A: src('菜单A'), B: src('菜单B') };
  p.stateSnapshot.designerPages = ['A', 'B'].map(pageId => ({ pageId, title: '同名菜单', folderId: 'folder-project-pages' }));
  p.stateSnapshot.activePageId = 'A';
  loadProjectFromBinaryPayload(p);
  return { projectId, pageId: 'A' };
}
const add = (scope: { projectId: string; pageId: string }, text: string) => useAiChatStore.getState().addMessage({ ...scope, text, role: 'user', status: 'done' });
const restartChat = () => useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });

test('same-project menus have isolated persisted histories across selection, rename, move and restart', () => {
  const a = fixture('menu-history'), b = { ...a, pageId: 'B' };
  const id = add(a, 'A的内容');
  useProtoStore.getState().setActivePage('B');
  assert.deepEqual(useAiChatStore.getState().messages, []);
  add(b, 'B的内容');
  useAiChatStore.getState().updateMessage(id, { text: 'A的更新', pageId: 'B', projectId: 'wrong' });
  assert.equal(useAiChatStore.getState().messages[0].text, 'B的内容');
  usePageStore.getState().renameDesignerPage('A', '改名后');
  const folder = usePageStore.getState().createDesignerFolder('新的目录', null);
  usePageStore.getState().moveSitemapItem({ kind: 'page', id: 'A' }, folder.id, a.projectId);
  useProtoStore.getState().setActivePage('A');
  assert.equal(useAiChatStore.getState().messages[0].text, 'A的更新');
  restartChat(); useAiChatStore.getState().switchConversation(a);
  assert.equal(useAiChatStore.getState().messages[0].pageId, 'A');
  assert.equal(useAiChatStore.getState().messages[0].text, 'A的更新');
  useAiChatStore.getState().clearMessages(a);
  restartChat(); useAiChatStore.getState().switchConversation(b);
  assert.equal(useAiChatStore.getState().messages[0].text, 'B的内容');
  useAiChatStore.getState().switchConversation(a);
  assert.deepEqual(useAiChatStore.getState().messages, []);
});

test('legacy project history splits only by exact menu IDs and clear does not resurrect the legacy transcript', () => {
  const a = fixture('legacy-menu-history'), b = { ...a, pageId: 'B' };
  const message = (pageId: string): AiChatMessage => ({ projectId: a.projectId, pageId, id: pageId, text: pageId, role: 'assistant', status: 'done', time: '10:30' });
  const legacyKey = `protoflow_ai_chat_v2:${encodeURIComponent(a.projectId)}`;
  const raw = JSON.stringify([message('A'), { ...message('B'), status: 'pending' }, { ...message('bad'), pageId: undefined }, { ...message('A'), projectId: 'other' }]);
  window.localStorage.setItem(legacyKey, raw);
  // A was already opened once; use another exact legacy page for first-load migration.
  const c = { ...a, pageId: 'legacy-A' };
  window.localStorage.setItem(legacyKey, JSON.stringify([message('legacy-A'), ...JSON.parse(raw)]));
  const archived = window.localStorage.getItem(legacyKey);
  useAiChatStore.getState().switchConversation(c);
  assert.deepEqual(useAiChatStore.getState().messages.map(m => m.id), ['legacy-A']);
  useAiChatStore.getState().clearMessages(c);
  restartChat(); useAiChatStore.getState().switchConversation(c);
  assert.deepEqual(useAiChatStore.getState().messages, []);
  useAiChatStore.getState().switchConversation(b);
  assert.equal(useAiChatStore.getState().messages[0].status, 'error');
  assert.equal(useAiChatStore.getState().messages.length, 1);
  assert.equal(window.localStorage.getItem(legacyKey), archived);
  assert.notEqual(conversationKey({ projectId: 'x:y', pageId: 'z' }), conversationKey({ projectId: 'x', pageId: 'y:z' }));
});

test('a late stream and generated menu stay with their originating chat without navigating away from the new selection', async () => {
  const a = fixture('late-menu-reply'), b = { ...a, pageId: 'B' };
  let emit: (e: HermesEvent) => void = () => {}, started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const model = { currentModelId: 'provider:exact', availableModels: [{ modelId: 'provider:exact', name: 'Model' }] };
  (window as any).protoflowDesktop = { hermes: {
    onEvent: (listener: typeof emit) => { emit = listener; return () => {}; },
    session: async (scope: typeof a) => ({ ...scope, sessionId: `s-${scope.pageId}`, running: false, models: model }),
    sync: async () => ({ synced: true }),
    execute: async (input: any) => {
      assert.equal(input.pageId, 'A'); started(); await gate;
      emit({ type: 'session-update', ...a, sessionId: 's-A', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'A的流式回复' } } });
      assert.deepEqual(useAiChatStore.getState().messages, []);
      return { text: 'A已生成新菜单', sessionId: 's-A', modelId: model.currentModelId, runId: 'late-result', operations: [{ tool: 'protoflow_apply_tsx_patch', args: { pageId: 'generated', folderId: 'folder-project-pages', title: '新菜单', source: src('生成内容') } }] };
    },
  } };
  useHermesStore.setState({ status: 'running', sessions: {}, runningProjects: {}, runningPageByProject: {}, partial: {}, cancelGeneration: {} });
  const task = runProjectAi('创建新菜单'); await entered;
  useProtoStore.getState().setActivePage('B');
  assert.deepEqual(useAiChatStore.getState().messages, []);
  finish(); await task;
  assert.equal(useProtoStore.getState().activePageId, 'B');
  assert.equal(usePageStore.getState().pageSources.B, src('菜单B'));
  assert.deepEqual(useAiChatStore.getState().messages, []);
  useProtoStore.getState().setActivePage('A');
  assert.equal(useAiChatStore.getState().messages.at(-1)?.text, 'A已生成新菜单');
  assert.match(useAiChatStore.getState().messages.at(-1)?.requirementAudit?.lines.join('\n') ?? '',/创建新菜单.*未核对原文/);
  assert.ok(useProtoStore.getState().databaseRequirements.some(r => r.text==='创建新菜单'));
  useProtoStore.getState().setActivePage('generated');
  assert.deepEqual(useAiChatStore.getState().messages, []);
});

test('model controls reject callbacks from another menu and new conversation clears only its own history', async () => {
  const a = fixture('model-menu-scope'), b = { ...a, pageId: 'B' };
  add(a, 'A历史'); add(b, 'B历史');
  const requests: any[] = [];
  (window as any).protoflowDesktop = { hermes: {
    onEvent: () => () => {},
    session: async (input: any) => { requests.push(input); return { ...input, sessionId: `s-${input.pageId}`, running: false, models: { currentModelId: 'm', availableModels: [{ modelId: 'm', name: 'Model' }] } }; },
  } };
  useHermesStore.setState({ status: 'running', sessions: {}, runningProjects: {} });
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(HermesSessionControls)); });
    act(() => renderer.root.findByProps({ 'aria-label': '选择对话模型' }).props.onClick());
    const stale = renderer.root.find(n => typeof n.type === 'function' && n.type.name === 'HermesModelPicker').props.onSelect;
    await act(async () => { useProtoStore.getState().setActivePage('B'); });
    assert.equal(renderer.root.findAllByType('dialog').length, 0);
    await assert.rejects(stale('m'), /对话已变化/);
    await act(async () => { await renderer.root.findAllByType('button').find(b => b.children.includes('新对话'))!.props.onClick(); });
    assert.equal(requests.at(-1).pageId, 'B'); assert.equal(requests.at(-1).fresh, true);
    assert.deepEqual(useAiChatStore.getState().messages, []);
    useProtoStore.getState().setActivePage('A');
    assert.equal(useAiChatStore.getState().messages[0].text, 'A历史');
  } finally { act(() => renderer?.unmount()); }
});

test('questions and tool permissions from another menu are not displayed in the selected menu', () => {
  const a = fixture('menu-permissions');
  useProtoStore.getState().setActivePage('B');
  useHermesStore.setState({ isModalOpen: false, error: null,
    questions: [{ ...a, id: 'q', message: 'A的字段问题', answerSchema: { type: 'string' } }],
    permissions: [{ ...a, id: 'p', toolCall: { title: 'A的操作' }, options: [] }],
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(React.createElement(HermesEngineModal)); });
    assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
    act(() => useProtoStore.getState().setActivePage('A'));
    assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 2);
  } finally { act(() => renderer.unmount()); useHermesStore.setState({ questions: [], permissions: [] }); }
});

test('clarification answers are recorded in their originating menu after a late acknowledgement', async () => {
  const scope = fixture('question-answer-history');
  let release!: () => void;
  const calls: unknown[] = [];
  (window as any).protoflowDesktop = { hermes: { question: async (input: unknown) => {
    calls.push(input); await new Promise<void>(resolve => { release = resolve; });
  } } };
  useHermesStore.setState({ questions: [{ ...scope, id: 'answer-history', message: '是否确认？', answerSchema: { type: 'string', enum: ['确认', '调整'] } }] });
  const replyId = useAiChatStore.getState().addMessage({ ...scope, role: 'assistant', status: 'pending', text: '正在整理' });
  const pending = useHermesStore.getState().answerQuestion('answer-history', '调整', '先做采购');
  useProtoStore.getState().setActivePage('B');
  release(); await pending;
  assert.deepEqual(calls, [{ id: 'answer-history', answer: '调整', supplement: '先做采购' }]);
  assert.deepEqual(useAiChatStore.getState().messages, []);
  const answers = useAiChatStore.getState().byConversation[conversationKey(scope)];
  assert.equal(answers.length, 2);
  assert.equal(answers[1].id, replyId);
  assert.match(answers[0].text, /我的回答：调整；补充说明：先做采购/);
  useHermesStore.setState({ questions: [] });
});

test('native Hermes sessions and model choices are isolated by menu, survive restart and never adopt a legacy mixed session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-menu-sessions-'));
  const sessions = new Map<string, any>(), calls: any[] = []; let n = 0;
  const makeRuntime = () => {
    const r = new HermesRuntime({ dataDir: dir, emit: () => {} });
    r.settings = { home: '/test/hermes', binary: '/test/hermes/bin' }; r.connect = async () => ({});
    r.client = { close() {}, request: async (method: string, args: any) => {
      acknowledgeToolDiscovery(args);
      calls.push({ method, args });
      if (method === 'session/new') {
        const sessionId = `session-${++n}`, models = { currentModelId: 'model-A', availableModels: [{ modelId: 'model-A' }, { modelId: 'model-B' }] };
        sessions.set(sessionId, models); return { sessionId, models: structuredClone(models) };
      }
      if (method === 'session/set_model') { sessions.get(args.sessionId).currentModelId = args.modelId; return {}; }
      return { models: structuredClone(sessions.get(args.sessionId)) };
    } };
    return r;
  };
  let runtime = makeRuntime();
  const a = { projectId: 'same-project', pageId: 'A' }, b = { ...a, pageId: 'B' };
  try {
    const legacy = path.join(runtime.workspace(a.projectId), 'session.json');
    fs.writeFileSync(legacy, JSON.stringify({ projectId: a.projectId, sessionId: 'mixed-legacy' }));
    const sa = await runtime.session(a), sb = await runtime.session(b);
    assert.notEqual(sa.sessionId, sb.sessionId);
    assert.equal(calls.some(c => c.args.sessionId === 'mixed-legacy'), false);
    await runtime.setModel({ ...a, modelId: 'model-B' });
    assert.equal((await runtime.session(b)).models.currentModelId, 'model-A');
    const freshB = await runtime.session({ ...b, fresh: true });
    assert.notEqual(freshB.sessionId, sb.sessionId);
    runtime.close(); runtime = makeRuntime();
    assert.equal((await runtime.session(a)).sessionId, sa.sessionId);
    assert.equal((await runtime.session(a)).models.currentModelId, 'model-B');
    assert.equal((await runtime.session(b)).sessionId, freshB.sessionId);
    // A rebuilt material contract must reload this menu's tools without starting a different conversation.
    const oldBinding = calls.at(-1).args.mcpServers[0].env.find((e: any) => e.name === 'PROTOFLOW_TOOL_BINDING').value;
    runtime.projectToolVersion = () => 'updated-table-contract';
    assert.equal((await runtime.session(b)).sessionId, freshB.sessionId);
    const reload = calls.at(-1);
    assert.equal(reload.method, 'session/load');
    assert.equal(reload.args.sessionId, freshB.sessionId);
    assert.notEqual(reload.args.mcpServers[0].env.find((e: any) => e.name === 'PROTOFLOW_TOOL_BINDING').value, oldBinding);
    const file = path.join(runtime.conversationWorkspace(a), 'session.json');
    runtime.sessions.clear(); fs.writeFileSync(file, '{bad-json');
    await assert.rejects(runtime.session(a), /原记录未覆盖/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{bad-json');
    await assert.rejects(runtime.session({ projectId: a.projectId }), /菜单页面 ID/);
    assert.match(fs.readFileSync(legacy, 'utf8'), /mixed-legacy/);
  } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hot update refuses to reset an older project-wide Hermes session', async () => {
  const scope = fixture('old-native-bridge');
  const requests: any[] = [];
  (window as any).protoflowDesktop = { hermes: {
    onEvent: () => () => {},
    session: async (input: any) => { requests.push(input); return { projectId: scope.projectId, sessionId: 'legacy-project-session', running: false, models: { currentModelId: 'm', availableModels: [] } }; },
  } };
  useHermesStore.setState({ status: 'running', sessions: {} });
  await assert.rejects(useHermesStore.getState().ensureSession(scope, true), /重启桌面应用/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].fresh, false);
});
