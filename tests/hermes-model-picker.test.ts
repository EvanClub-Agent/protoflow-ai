import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HermesModelPicker } from '../src/components/HermesModelPicker';
import { groupHermesModels, filterModelGroups, presentHermesModel } from '../src/services/hermesModelCatalog';
import type { HermesModel } from '../src/services/hermesClient';

const models: HermesModel[] = [
  { modelId: 'anthropic:claude-sonnet-4-20250514', name: 'Anthropic · claude-sonnet-4-20250514', description: 'Provider: Anthropic • current' },
  { modelId: 'copilot-acp:claude-sonnet-4-20250514', name: 'GitHub Copilot ACP · claude-sonnet-4-20250514', description: 'Provider: GitHub Copilot ACP' },
  { modelId: 'openai-api:gpt-model', name: 'OpenAI API · gpt-model', description: 'Provider: OpenAI API' },
  { modelId: 'openai-codex:gpt-model', name: 'ChatGPT or Codex Subscription · gpt-model', description: 'Provider: ChatGPT or Codex Subscription' },
  { modelId: 'custom:team:eu:model:v2', name: 'model:v2', description: 'Provider: Team EU • private endpoint' },
];
const button = (renderer: TestRenderer.ReactTestRenderer, label: string) => renderer.root.findAllByType('button').find(b => b.children.includes(label))!;
const radio = (renderer: TestRenderer.ReactTestRenderer, id: string) => renderer.root.findByProps({ type: 'radio', value: id });

const deepseekModels: HermesModel[] = [
  { modelId: 'deepseek:deepseek-v4-pro', name: 'DeepSeek · deepseek-v4-pro', description: 'Provider: DeepSeek' },
  { modelId: 'openrouter:deepseek/deepseek-v4-pro', name: 'OpenRouter · deepseek/deepseek-v4-pro', description: 'Provider: OpenRouter' },
  { modelId: 'ollama-cloud:deepseek-v4-pro:0813', name: 'Ollama Cloud · deepseek-v4-pro:0813', description: 'Provider: Ollama Cloud' },
  { modelId: 'custom:team:eu:deepseek-ai/DeepSeek-V3.2', name: 'deepseek-ai/DeepSeek-V3.2', description: 'Provider: Team EU' },
];

test('DeepSeek lists its own provider and keeps routed models under their actual service providers', () => {
  const groups = groupHermesModels([...models, ...deepseekModels]);
  const group = groups.find(g => g.id === 'deepseek')!;
  assert.equal(group.name, 'DeepSeek'); assert.equal(group.brand, 'deepseek');
  assert.deepEqual(group.choices.map(c => c.model.modelId), [deepseekModels[0].modelId]);
  assert.deepEqual(deepseekModels.map(m => presentHermesModel(m).source), ['DeepSeek', 'OpenRouter', 'Ollama Cloud', 'Team EU']);
  assert.deepEqual(deepseekModels.map(m => presentHermesModel(m).groupId), ['deepseek', 'openrouter', 'ollama', 'custom']);
  assert.equal(groups.reduce((sum, g) => sum + g.choices.length, 0), models.length + deepseekModels.length);
  assert.equal(filterModelGroups(groups, 'openrouter', 'deepseek v4-pro')[0].choices[0].model.modelId, deepseekModels[1].modelId);
  assert.equal(filterModelGroups(groups, 'ollama', 'deepseek 0813')[0].choices[0].model.modelId, deepseekModels[2].modelId);
  assert.deepEqual(filterModelGroups(groups, 'deepseek', 'openrouter'), []);
  for (const model of [
    { modelId: 'openrouter:other/deepseek-v4-pro', name: 'DeepSeek fork' },
    { modelId: 'custom:deepseek-team:gpt-model', name: 'gpt-model', description: 'Provider: DeepSeek' },
    { modelId: 'future:deepseek-v4-pro', name: 'DeepSeek' },
    { modelId: 'opaque-deepseek', name: 'DeepSeek', description: 'Provider: DeepSeek' },
  ]) assert.notEqual(presentHermesModel(model).groupId, 'deepseek');
});

test('DeepSeek filter selects the official provider and never submits an OpenRouter route', async () => {
  let selected = '', renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(HermesModelPicker, {
    models: [...models, ...deepseekModels], currentModelId: models[0].modelId, running: false,
    onSelect: async id => { selected = id; }, onRefresh: async () => {}, onClose: () => {},
  })); });
  try {
    const category = renderer!.root.findAllByType('button').find(b => b.props['aria-pressed'] !== undefined && b.findAllByType('span').some(s => s.children.includes('DeepSeek')))!;
    act(() => category.props.onClick());
    assert.equal(category.props['aria-pressed'], true);
    assert.equal(renderer!.root.findAllByProps({ type: 'radio' }).length, 1);
    assert.ok(category.findAllByType('img').length > 0);
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('服务来源决定使用的账号与接口'));
    act(() => radio(renderer!, deepseekModels[0].modelId).props.onChange());
    await act(async () => { await button(renderer!, '切换模型').props.onClick(); });
    assert.equal(selected, 'deepseek:deepseek-v4-pro');
  } finally { act(() => renderer!.unmount()); }
});

test('model grouping retains exact provider identities and does not guess the manufacturer of routed models', () => {
  const groups = groupHermesModels(models);
  assert.deepEqual(groups.map(g => g.id), ['anthropic', 'github', 'openai', 'custom']);
  assert.equal(groups[1].choices[0].brand, 'github');
  assert.equal(groups[1].choices[0].title, 'claude-sonnet-4-20250514');
  assert.deepEqual(groups[2].choices.map(c => c.model.modelId), ['openai-api:gpt-model', 'openai-codex:gpt-model']);
  assert.notEqual(groups[2].choices[0].source, groups[2].choices[1].source);
  assert.equal(groups[3].choices[0].model.modelId, 'custom:team:eu:model:v2');
  assert.equal(groups[3].choices[0].source, 'Team EU');
  assert.equal(presentHermesModel({ modelId: 'future:claude-new', name: 'Future · claude-new' }).brand, 'unknown');
  assert.equal(presentHermesModel({ modelId: 'opaque', name: 'opaque' }).title, 'opaque');
  assert.equal(presentHermesModel({ modelId: 'kimi-coding:kimi', name: 'Kimi' }).brand, 'moonshot');
  assert.equal(presentHermesModel({ modelId: 'alibaba:qwen', name: 'Qwen' }).brand, 'qwen');
});

test('model search combines terms with provider filters while preserving same-name routes', () => {
  const groups = groupHermesModels(models);
  assert.equal(filterModelGroups(groups, null, 'CLAUDE 20250514').length, 2);
  assert.equal(filterModelGroups(groups, 'github', 'claude')[0].choices[0].model.modelId, models[1].modelId);
  assert.equal(filterModelGroups(groups, null, 'codex gpt')[0].choices[0].model.modelId, models[3].modelId);
  assert.equal(filterModelGroups(groups, null, 'team:eu:model:v2')[0].choices[0].model.modelId, models[4].modelId);
  assert.deepEqual(filterModelGroups(groups, 'github', 'gpt'), []);
});

test('draft model selection is cancelled without submitting; Escape and empty search are supported', () => {
  let closed = 0, submitted = 0;
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(HermesModelPicker, {
    models, currentModelId: models[0].modelId, running: false,
    onSelect: async () => { submitted++; }, onRefresh: async () => {}, onClose: () => { closed++; },
  })); });
  act(() => radio(renderer!, models[1].modelId).props.onChange());
  assert.equal(submitted, 0);
  assert.equal(radio(renderer!, models[1].modelId).props.checked, true);
  act(() => renderer!.root.findByProps({ 'aria-label': '搜索模型、厂商或平台' }).props.onChange({ target: { value: 'no match' } }));
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('没有找到匹配的模型'));
  act(() => button(renderer!, '清除筛选').props.onClick());
  assert.equal(radio(renderer!, models[1].modelId).props.checked, true);
  act(() => button(renderer!, '取消').props.onClick());
  assert.equal(closed, 1); assert.equal(submitted, 0);
  act(() => renderer!.root.findByType('dialog').props.onCancel({ preventDefault() {} }));
  assert.equal(closed, 2);
  act(() => renderer!.unmount());
});

test('failed model switch stays open and can retry; pending switch cannot close early', async () => {
  let closed = 0, reject = true, resolve!: () => void;
  const submitted: string[] = [];
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(HermesModelPicker, {
    models, currentModelId: models[0].modelId, running: false,
    onSelect: async (id: string) => { submitted.push(id); if (reject) throw new Error('连接中断'); await new Promise<void>(done => { resolve = done; }); },
    onRefresh: async () => {}, onClose: () => { closed++; },
  })); });
  act(() => radio(renderer!, models[4].modelId).props.onChange());
  await act(async () => { button(renderer!, '切换模型').props.onClick(); });
  assert.equal(closed, 0);
  assert.ok(renderer!.root.findByProps({ role: 'alert' }).children.join('').includes('连接中断'));
  reject = false;
  act(() => button(renderer!, '切换模型').props.onClick());
  assert.equal(button(renderer!, '正在切换…').props.disabled, true);
  assert.equal(button(renderer!, '取消').props.disabled, true);
  act(() => renderer!.root.findByType('dialog').props.onCancel({ preventDefault() {} }));
  assert.equal(closed, 0);
  await act(async () => { resolve(); });
  assert.deepEqual(submitted, [models[4].modelId, models[4].modelId]);
  assert.equal(closed, 1);
  act(() => renderer!.unmount());
});

test('removed, empty and running model catalogues never silently pick another model', () => {
  let submitted = 0, renderer: TestRenderer.ReactTestRenderer;
  const props = { models, currentModelId: models[0].modelId, running: false, onSelect: async () => { submitted++; }, onRefresh: async () => {}, onClose() {} };
  act(() => { renderer = TestRenderer.create(React.createElement(HermesModelPicker, props)); });
  act(() => radio(renderer!, models[1].modelId).props.onChange());
  act(() => renderer!.update(React.createElement(HermesModelPicker, { ...props, models: [models[0]] })));
  assert.equal(button(renderer!, '切换模型').props.disabled, true);
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('所选模型不在当前列表中'));
  act(() => renderer!.update(React.createElement(HermesModelPicker, { ...props, running: true })));
  assert.equal(button(renderer!, '切换模型').props.disabled, true);
  assert.equal(radio(renderer!, models[1].modelId).props.disabled, true);
  act(() => renderer!.update(React.createElement(HermesModelPicker, { ...props, models: [] })));
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('暂时没有可选模型'));
  assert.equal(button(renderer!, '切换模型').props.disabled, true);
  assert.equal(submitted, 0);
  act(() => renderer!.unmount());
});
