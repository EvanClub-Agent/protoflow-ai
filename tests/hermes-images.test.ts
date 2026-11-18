import { acknowledgeToolDiscovery } from './fixtures/hermesToolDiscovery';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { conversationKey } from '../src/services/hermesConversation';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { useHermesStore } from '../src/store/useHermesStore';
import { useProtoStore } from '../src/store/useProtoStore';
import { runProjectAi } from '../src/services/hermesBridge';
import { discussProject } from '../src/services/projectWorkflow';
import { readChatImageFiles } from '../src/services/chatImages';
import { AiChatPanel } from '../src/proto/designer/AiChatPanel';
import { ProtoCanvasDesigner } from '../src/proto/designer/ProtoCanvasDesigner';
const { ChatImages, MAX_IMAGE_BYTES } = require(path.join(process.cwd(), 'electron/chat-images.cjs'));
const { HermesRuntime } = require(path.join(process.cwd(), 'electron/hermes-runtime.cjs'));
const png = { name: '截图.png', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTK0AAAAASUVORK5CYII=' };
const scope = { projectId: 'image-project', pageId: 'main' };
const ref = { ...scope, id: 'd87d8431-2b57-4d75-81ea-c1086d39ebf8', name: png.name, mimeType: 'image/png' as const, size: Buffer.from(png.data, 'base64').length };
function fixture() {
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
  const p = createProjectPayload({ projectId: scope.projectId, projectName: '图片测试', storageDir: '/tmp', fileName: 'image-test.pflow', templateId: 'blank_project', createdAt: '2026-10-31', updatedAt: '2026-10-31', pageCount: 0, tableCount: 0, stickyCount: 0 });
  p.stateSnapshot.designerFolders = [{ id: 'folder-project-pages', title: '测试目录', parentFolderId: null }];
  p.stateSnapshot.pageSources = { main: 'export default function Page(){return <Page pfId="root" title="图片测试"/>;}', other: 'export default function Page(){return <Page pfId="other" title="另一个菜单"/>;}' };
  p.stateSnapshot.designerPages = ['main', 'other'].map(pageId => ({ pageId, title: pageId, folderId: 'folder-project-pages' }));
  p.stateSnapshot.activePageId = scope.pageId;
  loadProjectFromBinaryPayload(p);
  const session = { ...scope, sessionId: 'image-session', running: false, models: { currentModelId: 'test-vision', availableModels: [{ modelId: 'test-vision', name: 'Test vision' }] } };
  useHermesStore.setState({ status: 'running', runningProjects: {}, runningPageByProject: {}, partial: {}, progress: {}, sessions: { [conversationKey(scope)]: session }, cancelGeneration: {} });
  (window as any).protoflowDesktop = { hermes: {
    session: async () => session, onEvent: () => () => {}, sync: async () => ({ synced: true }),
    saveImages: async () => [ref], readImage: async () => ({ ...ref, data: png.data }),
    execute: async () => ({ text: '收到图片', operations: [], sessionId: session.sessionId, runId: 'image-run', modelId: 'test-vision' }),
  } };
}

test('native chat images survive restart with exact scope and reject foreign refs, paths, invalid MIME and size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-images-'));
  try {
    const store = new ChatImages(dir);
    const [saved] = store.save({ ...scope, images: [png] });
    assert.equal(saved.data, undefined);
    const reopened = new ChatImages(dir);
    assert.equal(reopened.read({ ...scope, id: saved.id }).data, png.data);
    assert.throws(() => reopened.read({ ...scope, pageId: 'other', id: saved.id }), /读取失败/);
    assert.throws(() => reopened.read({ ...scope, id: '../../runtime' }), /ID 无效/);
    assert.throws(() => reopened.content({ ...scope, projectId: 'other-project' }, [saved]), /不属于/);
    assert.throws(() => reopened.content(scope, [{ ...saved, mimeType: 'image/jpeg' }]), /信息不匹配/);
    assert.throws(() => store.save({ ...scope, images: [{ ...png, mimeType: 'image/jpeg' }] }), /格式不匹配/);
    assert.throws(() => store.save({ ...scope, images: [{ ...png, data: '<svg></svg>' }] }), /编码无效/);
    assert.throws(() => store.save({ ...scope, images: [{ ...png, data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') }] }), /5 MB/);
    assert.throws(() => store.save({ ...scope, images: Array(5).fill(png) }), /4 张/);
    const file = path.join(reopened.directory(scope), `${saved.id}.json`);
    const record = JSON.parse(fs.readFileSync(file, 'utf8')); record.pageId = 'other';
    fs.writeFileSync(file, JSON.stringify(record));
    assert.throws(() => reopened.read({ ...scope, id: saved.id }), /不属于/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Hermes receives real inline ACP image blocks; text-only requests stay unchanged and unsupported connections fail explicitly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-acp-images-'));
  const runtime = new HermesRuntime({ dataDir: dir, emit: () => {} });
  const calls: any[] = [];
  runtime.settings = { home: '/test/hermes', binary: '/test/bin/hermes' };
  runtime.info = { capabilities: { promptCapabilities: { image: true } } };
  runtime.connect = async () => runtime.info;
  runtime.client = { close() {}, notify() {}, request: async (method: string, args: any) => {
    acknowledgeToolDiscovery(args);
    calls.push({ method, args });
    if (method === 'session/prompt') return { stopReason: 'end_turn' };
    return { sessionId: 'image-session', models: { currentModelId: 'vision', availableModels: [{ modelId: 'vision' }] } };
  } };
  try {
    const images = runtime.saveImages({ ...scope, images: [png] });
    const request = { ...scope, snapshot: { projectId: scope.projectId }, prompt: '查看截图', images };
    await runtime.execute(request);
    assert.deepEqual(calls.find(c => c.method === 'session/prompt').args.prompt, [{ type: 'text', text: '查看截图' }, { type: 'image', mimeType: png.mimeType, data: png.data }]);
    calls.length = 0;
    await runtime.execute({ ...request, images: undefined });
    assert.deepEqual(calls.find(c => c.method === 'session/prompt').args.prompt, [{ type: 'text', text: '查看截图' }]);
    calls.length = 0;
    runtime.info.capabilities.promptCapabilities.image = false;
    await assert.rejects(runtime.execute(request), /不支持图片输入/);
    assert.equal(calls.some(c => c.method === 'session/prompt'), false);
    assert.equal(runtime.sessions.get(conversationKey(scope)).running, false);
    await assert.rejects(runtime.execute({ ...request, images: [{ ...images[0], pageId: 'other' }] }), /不属于/);
  } finally { runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('project images stay in their original chat after restart and deleting a chat clears only its own media', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-project-images-'));
  const original = { projectId:scope.projectId, kind:'project' };
  const thread = { ...original, threadId:'main' };
  const runtime = new HermesRuntime({ dataDir:dir, emit() {} });
  try {
    const upload = (owner: object) => runtime.saveImages({ ...owner, images:[png] })[0];
    const first = upload(original), second = upload(thread), menu = upload(scope);
    const reopened = new ChatImages(dir);
    assert.equal(reopened.read(second).data, png.data);
    assert.deepEqual(reopened.content(thread,[second]), [{type:'image', mimeType:png.mimeType, data:png.data}]);
    for (const other of [first, menu, {...second, projectId:'another-project'}]) {
      assert.throws(() => reopened.content(thread,[other]), /不属于/);
    }
    assert.throws(() => runtime.saveImages({...thread, pageId:'main', images:[png]}), /不能包含/);
    await runtime.deleteProjectChat(thread);
    assert.throws(() => upload(thread), /已删除/);
    assert.throws(() => reopened.read(second), /读取失败/);
    assert.equal(reopened.read(menu).data, png.data);
    assert.equal(reopened.read(first).data, png.data);
  } finally { runtime.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('an image-only project message keeps its image and model reply in the sending thread when switching during upload', async () => {
  fixture();
  useProtoStore.getState().setViewMode('project_ai');
  const chat = useAiChatStore.getState();
  chat.newProjectChat(scope.projectId);
  const owner = useAiChatStore.getState().conversation!;
  const reference = {...owner, id:ref.id, name:ref.name, mimeType:ref.mimeType, size:ref.size};
  const api = (window as any).protoflowDesktop.hermes;
  let uploaded!: (response: unknown) => void;
  api.saveImages = (input: any) => {
    assert.equal(conversationKey(input), conversationKey(owner));
    return new Promise(resolve => { uploaded = resolve; });
  };
  const listeners = new Set<(e: any) => void>();
  api.onEvent = (fn: (e: any) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
  api.session = async (input: any) => ({...input, sessionId:'vision-chat', running:false,
    projectTools:['protoflow_get_project_brief','protoflow_search_history','protoflow_upsert_project_agreement','protoflow_ask_questions','protoflow_revise_project_page','protoflow_set_project_plan','protoflow_move_sitemap_item','protoflow_apply_tsx_patch'],
    models:{currentModelId:'vision', availableModels:[]}});
  api.execute = async (input: any) => {
    assert.equal(conversationKey(input), conversationKey(owner));
    assert.deepEqual(input.images,[reference]);
    assert.ok(input.prompt.includes('参考图片'));
    const taskKey = conversationKey(input);
    const baseEvt = { ...owner, sessionId: 'vision-chat', planningSessionId: 'vision-chat', execSessionId: 'vision-chat', taskKey, clientRequestId: input.clientRequestId, runId: 'r' };
    listeners.forEach(fn => fn({ type: 'run-start', ...baseEvt }));
    listeners.forEach(fn => fn({ type: 'run-end', ...baseEvt }));
    return {text:'已查看参考图', operations:[], sessionId:'vision-chat', planningSessionId:'vision-chat', execSessionId:'vision-chat', taskKey, clientRequestId:input.clientRequestId, modelId:'vision', runId:'r'};
  };
  const pending = discussProject(scope.projectId,'',[{...png, mimeType:ref.mimeType, size:ref.size, preview:`data:image/png;base64,${png.data}`}]);
  chat.newProjectChat(scope.projectId);
  uploaded([reference]);
  await pending;
  assert.deepEqual(useAiChatStore.getState().messages, []);
  useAiChatStore.setState({byConversation:{}, conversation:null, messages:[]});
  chat.selectProjectChat(scope.projectId, owner.threadId!);
  assert.deepEqual(useAiChatStore.getState().messages[0].images, [reference]);
  assert.equal(useAiChatStore.getState().messages.at(-1)?.text, '已查看参考图');
});

test('native WebP validation rejects truncated RIFF data and excessive declared dimensions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-webp-'));
  try {
    const store = new ChatImages(dir);
    const bytes = Buffer.alloc(30);
    bytes.write('RIFF'); bytes.writeUInt32LE(22, 4); bytes.write('WEBPVP8X', 8); bytes.writeUInt32LE(10, 16);
    bytes.writeUIntLE(9999, 24, 3); bytes.writeUIntLE(9999, 27, 3);
    const save = (data: Buffer) => store.save({ ...scope, images: [{ name: 'large.webp', mimeType: 'image/webp', data: data.toString('base64') }] });
    assert.throws(() => save(bytes), /分辨率过大/);
    assert.throws(() => save(bytes.subarray(0, 29)), /不完整/);
    bytes.writeUInt32LE(100, 16);
    assert.throws(() => save(bytes), /内容损坏/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('image messages persist small references only, restore per menu, and reach the Hermes bridge', async () => {
  fixture();
  let request: any;
  const api = (window as any).protoflowDesktop.hermes, original = api.execute;
  api.execute = async (input: any) => { request = input; return original(input); };
  await runProjectAi('参照图片改页面', { images: [ref] });
  assert.equal(useAiChatStore.getState().pageChatOpen, true);
  assert.equal(useProtoStore.getState().leftActivityView, 'pages');
  assert.equal(useProtoStore.getState().leftSidebarCollapsed, false);
  assert.deepEqual(request.images, [ref]);
  assert.deepEqual(useAiChatStore.getState().messages[0].images, [ref]);
  const id = useAiChatStore.getState().addMessage({ ...scope, text: '仅保存引用', role: 'user', status: 'done', images: [{ ...ref, data: png.data } as any] });
  const raw = window.localStorage.getItem(`protoflow_ai_chat_v3:${encodeURIComponent(conversationKey(scope))}`)!;
  assert.equal(raw.includes(png.data), false);
  assert.throws(() => useAiChatStore.getState().updateMessage(id, { images: [{ ...ref, pageId: 'other' }] }), /不属于/);
  useAiChatStore.setState({ conversation: null, messages: [], byConversation: {}, storageErrors: {} });
  useAiChatStore.getState().switchConversation({ ...scope, pageId: 'other' });
  assert.deepEqual(useAiChatStore.getState().messages, []);
  useAiChatStore.getState().switchConversation(scope);
  assert.deepEqual(useAiChatStore.getState().messages[0].images, [ref]);
});

function imageReaders() {
  const oldReader = globalThis.FileReader, oldImage = globalThis.Image;
  (globalThis as any).FileReader = class { result = `data:image/png;base64,${png.data}`; onload = () => {}; readAsDataURL() { queueMicrotask(() => this.onload()); } };
  (globalThis as any).Image = class { naturalWidth = 1; naturalHeight = 1; onload = () => {}; set src(_src: string) { queueMicrotask(() => this.onload()); } };
  return () => { globalThis.FileReader = oldReader; globalThis.Image = oldImage; };
}
const imageFile = () => new File([Buffer.from(png.data, 'base64')], png.name, { type: png.mimeType });
test('the floating page chat stays independent of the directory and restores text and images for each page', async () => {
  fixture();
  useProtoStore.setState({ leftActivityView: 'pages', leftSidebarCollapsed: false, rightSidebarCollapsed: true });
  const restore = imageReaders();
  let renderer!: TestRenderer.ReactTestRenderer;
  const designer = (pageId: string) => React.createElement(ProtoCanvasDesigner, { key: pageId, pageId });
  const selectPage = (pageId: string) => act(() => {
    useProtoStore.getState().setActivePage(pageId);
    renderer.update(designer(pageId));
  });
  try {
    await act(async () => { renderer = TestRenderer.create(designer(scope.pageId)); });
    const panel = () => renderer.root.findByProps({ 'aria-label': 'AI 对话面板' });
    const launcher = () => renderer.root.findByProps({ 'aria-label': '问 AI' });
    const chat = () => renderer.root.findByType(AiChatPanel);
    assert.equal(panel().props.hidden, true);
    act(() => launcher().props.onClick());
    assert.equal(useProtoStore.getState().leftActivityView, 'pages');
    act(() => chat().findByType('textarea').props.onChange({ target: { value: '尚未发送的修改需求' } }));
    await act(async () => chat().findByProps({ type: 'file' }).props.onChange({ currentTarget: { files: [imageFile()], value: '' } }));
    act(() => renderer.root.findByProps({ 'aria-label': '收起 AI 对话' }).props.onClick());
    assert.equal(panel().props.hidden, true);
    act(() => launcher().props.onClick());
    for (const view of ['materials', 'outline', 'pages'] as const) {
      act(() => useProtoStore.getState().setLeftActivityView(view));
      assert.equal(panel().props.hidden, false);
    }
    act(() => useProtoStore.getState().toggleLeftSidebar());
    assert.equal(panel().props.hidden, false);
    act(() => renderer.root.findByProps({ 'aria-label': '展开宽屏面板' }).props.onClick());
    selectPage('other');
    assert.equal(launcher().props['aria-expanded'], true);
    assert.equal(chat().props.wide, true);
    assert.equal(chat().findByType('textarea').props.value, '');
    assert.equal(chat().findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 0);
    act(() => chat().findByType('textarea').props.onChange({ target: { value: '另一页的草稿' } }));
    selectPage('main');
    assert.equal(chat().props.wide, true);
    assert.equal(chat().findByType('textarea').props.value, '尚未发送的修改需求');
    assert.equal(chat().findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 1);
    act(() => renderer.unmount());
    useProtoStore.setState({ isProjectClosed: true });
    assert.equal(useAiChatStore.getState().pageChatOpen, false);
    assert.equal(useAiChatStore.getState().pageChatWide, false);
    assert.equal(useAiChatStore.getState().pageDrafts.size, 0);
  } finally { if (renderer) act(() => renderer.unmount()); restore(); }
});
async function mountPanel(onSend: (...args: any[]) => any) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AiChatPanel, { pageId: scope.pageId, pageTitle: '图片测试', selectedLabel: null, running: false, onSend, onClearSelection() {} })); });
  return renderer;
}
test('chat composer accepts pasted screenshots, removes drafts, sends image-only messages and retains failed drafts', async () => {
  fixture(); const restore = imageReaders(); const sent: any[] = [];
  let fail = true;
  const renderer = await mountPanel(async (...args: any[]) => { sent.push(args); return !fail; });
  try {
    let prevented = false;
    await act(async () => renderer.root.findByType('textarea').props.onPaste({ preventDefault: () => { prevented = true; }, clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: imageFile }] } }));
    assert.equal(prevented, true);
    assert.equal(renderer.root.findByProps({ title: '发送' }).props.disabled, false);
    await act(async () => renderer.root.findByProps({ title: '发送' }).props.onClick());
    assert.equal(sent[0][0], '请分析这些图片，结合当前页面给出建议。');
    assert.deepEqual(sent[0][1], [ref]);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 1);
    assert.match(JSON.stringify(renderer.toJSON()), /文字和图片已保留/);
    fail = false;
    await act(async () => renderer.root.findByProps({ title: '发送' }).props.onClick());
    assert.equal(renderer.root.findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 0);
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({ currentTarget: { files: [imageFile()], value: 'selected' } }));
    act(() => renderer.root.findByProps({ 'aria-label': `移除图片：${png.name}` }).props.onClick());
    assert.equal(renderer.root.findByProps({ title: '发送' }).props.disabled, true);
  } finally { act(() => renderer.unmount()); restore(); }
});

test('the real designer clears submitted text and images while generation is still pending, preserving message attachments', async () => {
  fixture();
  useProtoStore.setState({ leftActivityView: 'pages', leftSidebarCollapsed: false, rightSidebarCollapsed: true });
  const restore = imageReaders();
  let renderer!: TestRenderer.ReactTestRenderer, task!: Promise<void>, finish!: (result: any) => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let finishUpload!: () => void;
  (window as any).protoflowDesktop.hermes.saveImages = () => new Promise(resolve => {
    finishUpload = () => resolve([ref]);
  });
  let executions = 0;
  (window as any).protoflowDesktop.hermes.execute = () => {
    executions += 1;
    enter();
    return new Promise(resolve => { finish = resolve; });
  };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProtoCanvasDesigner, { pageId: scope.pageId })); });
    act(() => renderer.root.findByProps({ 'aria-label': '问 AI' }).props.onClick());
    const chat = () => renderer.root.findByType(AiChatPanel);
    act(() => chat().findByType('textarea').props.onChange({ target: { value: '参照截图修改当前页面' } }));
    await act(async () => chat().findByProps({ type: 'file' }).props.onChange({ currentTarget: { files: [imageFile()], value: '' } }));
    const send = chat().findByProps({ title: '发送' }).props.onClick;
    act(() => { task = send(); });
    act(() => renderer.root.findByProps({ 'aria-label': '收起 AI 对话' }).props.onClick());
    await act(async () => { finishUpload(); await entered; });
    assert.equal(useAiChatStore.getState().pageChatOpen, false);
    act(() => renderer.root.findByProps({ 'aria-label': '问 AI' }).props.onClick());
    assert.equal(useHermesStore.getState().runningProjects[scope.projectId], true);
    assert.equal(chat().findByType('textarea').props.value, '');
    assert.equal(chat().findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 0);
    const messages = useAiChatStore.getState().byConversation[conversationKey(scope)];
    assert.equal(messages[0].text, '参照截图修改当前页面');
    assert.deepEqual(messages[0].images, [ref]);
    assert.equal(messages[1].status, 'pending');
    await act(async () => { await send(); });
    assert.equal(executions, 1, 'a second click cannot resend the cleared draft');
    await act(async () => { finish({ text: '收到图片', operations: [], sessionId: 'image-session', runId: 'pending-image-run', modelId: 'test-vision' }); await task; });
    assert.equal(chat().findByType('textarea').props.value, '');
    assert.equal(chat().findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 0);
  } finally { if (renderer) act(() => renderer.unmount()); restore(); }
});

test('upload failures keep the draft and rejected generation restores its exact text and images', async () => {
  fixture(); const restore = imageReaders();
  let reject!: (error: Error) => void, task!: Promise<void>, sends = 0;
  const renderer = await mountPanel(() => { sends += 1; return new Promise((_, fail) => { reject = fail; }); });
  const raw = '  请按截图修改\n保留这行说明  ';
  const api = (window as any).protoflowDesktop.hermes, saveImages = api.saveImages;
  try {
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: raw } }));
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({ currentTarget: { files: [imageFile()], value: '' } }));
    api.saveImages = async () => { throw new Error('图片保存失败'); };
    await act(async () => { await renderer.root.findByProps({ title: '发送' }).props.onClick(); });
    assert.equal(sends, 0);
    assert.equal(renderer.root.findByType('textarea').props.value, raw);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 1);
    api.saveImages = saveImages;
    await act(async () => { task = renderer.root.findByProps({ title: '发送' }).props.onClick(); });
    assert.equal(renderer.root.findByType('textarea').props.value, '');
    assert.equal(renderer.root.findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 0);
    await act(async () => { reject(new Error('生成连接中断')); await task; });
    assert.equal(renderer.root.findByType('textarea').props.value, raw);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 1);
    assert.match(JSON.stringify(renderer.toJSON()), /生成连接中断/);
    assert.equal(renderer.root.findByProps({ title: '发送' }).props.disabled, false);
  } finally { act(() => renderer.unmount()); restore(); }
});

test('a failed old send cannot restore its draft or unlock a new send after leaving and returning to the same menu', async () => {
  fixture(); const restore = imageReaders();
  const completions: ((value: boolean) => void)[] = [];
  const onSend = () => new Promise<boolean>(resolve => { completions.push(resolve); });
  const renderer = await mountPanel(onSend);
  const props = (pageId: string) => ({ pageId, pageTitle: pageId, selectedLabel: null, running: false, onSend, onClearSelection() {} });
  let oldTask!: Promise<void>, newTask!: Promise<void>;
  try {
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '旧请求文字' } }));
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({ currentTarget: { files: [imageFile()], value: '' } }));
    await act(async () => { oldTask = renderer.root.findByProps({ title: '发送' }).props.onClick(); });
    act(() => { useProtoStore.getState().setActivePage('other'); renderer.update(React.createElement(AiChatPanel, props('other'))); });
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '另一个页面的草稿' } }));
    act(() => { useProtoStore.getState().setActivePage('main'); renderer.update(React.createElement(AiChatPanel, props('main'))); });
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '回到原页面后的新请求' } }));
    await act(async () => { newTask = renderer.root.findByProps({ title: '发送' }).props.onClick(); });
    await act(async () => { completions[0](false); await oldTask; });
    assert.equal(renderer.root.findByType('textarea').props.value, '');
    assert.equal(renderer.root.findAllByProps({ 'aria-label': `移除图片：${png.name}` }).length, 0);
    assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
    assert.equal(renderer.root.findByProps({ title: '发送' }).props.disabled, true);
    await act(async () => { completions[1](true); await newTask; });
    act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: '可继续输入' } }));
    assert.equal(renderer.root.findByProps({ title: '发送' }).props.disabled, false);
  } finally { act(() => renderer.unmount()); restore(); }
});

test('image file batches reject unsupported or oversized files and never send into a menu selected during upload', async () => {
  await assert.rejects(readChatImageFiles([new File(['svg'], 'x.svg', { type: 'image/svg+xml' })], 0), /PNG/);
  await assert.rejects(readChatImageFiles([{ type: 'image/png', size: MAX_IMAGE_BYTES + 1 } as File], 0), /5 MB/);
  await assert.rejects(readChatImageFiles([imageFile()], 4), /4 张/);
  fixture(); const restore = imageReaders(); let finish!: (v: any) => void, sent = false;
  (window as any).protoflowDesktop.hermes.saveImages = () => new Promise(resolve => { finish = resolve; });
  const renderer = await mountPanel(() => { sent = true; });
  try {
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({ currentTarget: { files: [imageFile()], value: '' } }));
    act(() => { renderer.root.findByProps({ title: '发送' }).props.onClick(); });
    act(() => { useProtoStore.getState().setActivePage('other'); renderer.unmount(); });
    await act(async () => finish([ref]));
    assert.equal(sent, false);
  } finally { restore(); }
});
