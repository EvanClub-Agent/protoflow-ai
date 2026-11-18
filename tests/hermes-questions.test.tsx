import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HermesQuestionCard } from '../src/components/HermesQuestionCard';
import { useHermesStore } from '../src/store/useHermesStore';
import type { HermesQuestion } from '../src/services/hermesClient';

const question = (id: string, answerSchema: HermesQuestion['answerSchema']): HermesQuestion => ({
  id, projectId: 'question-project', pageId: 'page-a', message: '采购审批采用哪种方式？', answerSchema,
});

test('the card shows the declared batch position and does not invent a total for an ungrouped question', () => {
  const q = { ...question('progress', { type: 'string' }), progress: { batchId: 'batch', current: 2, total: 3 } };
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(<HermesQuestionCard question={q} />); });
    assert.equal(renderer.root.findByProps({ role: 'status' }).children.join(''), '2 / 3');
    assert.equal(renderer.root.findByProps({ role: 'status' }).props['aria-label'], '本组问题：第 2 题，共 3 题');
    act(() => renderer.update(<HermesQuestionCard question={question('unknown', { type: 'string' })} />));
    assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0);
  } finally { act(() => renderer.unmount()); }
});

test('truncated, duplicate, mismatched and concurrent question lists cannot supply a guessed total', () => {
  const { QuestionProgress } = require(process.cwd() + '/electron/hermes-question-progress.cjs');
  const tracker = new QuestionProgress('run');
  const observe = (id: string, rawInput: unknown) => tracker.observe({ sessionUpdate: 'tool_call', toolCallId: id, title: 'clarify', rawInput });
  observe('duplicate', { questions: [{ question: '同名' }, { question: '同名' }] });
  assert.equal(tracker.forQuestion('同名'), undefined);
  tracker.observe({ sessionUpdate: 'tool_call_update', toolCallId: 'duplicate', status: 'completed' });
  tracker.observe({ sessionUpdate: 'tool_call', toolCallId: 'truncated', title: 'clarify', content: [{ type: 'content', content: { type: 'text', text: '{"questions":[...' } }] });
  assert.equal(tracker.forQuestion('范围？'), undefined);
  observe('known', { questions: [{ question: '范围？' }] });
  assert.equal(tracker.forQuestion('范围？'), undefined);
  tracker.observe({ sessionUpdate: 'tool_call_update', toolCallId: 'truncated', status: 'failed' });
  assert.equal(tracker.forQuestion('另一问题'), undefined);
  assert.deepEqual(tracker.forQuestion('范围？'), { batchId: 'known', current: 1, total: 1 });
});

test('inline questions require explicit input, preserve selected choices with supplements, and prevent duplicate submission', async () => {
  const q = question('options', { type: 'string', enum: ['一级审批', '多级审批'] });
  const calls: unknown[][] = [];
  const original = useHermesStore.getState().answerQuestion;
  useHermesStore.setState({ questions: [q], answerQuestion: async (...args) => { calls.push(args); } });
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(<HermesQuestionCard question={q} inline />); });
    const root = renderer.root;
    assert.equal(root.findAllByProps({ role: 'dialog' }).length, 0);
    assert.equal(root.findByProps({ type: 'submit' }).props.disabled, true);
    assert.equal(root.findAllByType('input').some(input => input.props.checked), false);
    act(() => root.findByProps({ value: '多级审批' }).props.onChange());
    act(() => root.findByProps({ 'aria-expanded': false }).props.onClick());
    act(() => root.findByType('textarea').props.onChange({ target: { value: '超过十万元增加财务审批' } }));
    await act(async () => { root.findByType('form').props.onSubmit({ preventDefault() {} }); root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.deepEqual(calls, [['options', '多级审批', '超过十万元增加财务审批']]);
    assert.equal(root.findByProps({ type: 'submit' }).props.disabled, true);
  } finally { act(() => renderer.unmount()); useHermesStore.setState({ questions: [], answerQuestion: original }); }
});

test('a free-text answer survives a failed submission and a replaced question cannot receive a stale answer', async () => {
  const q = question('text', { type: 'string' });
  const original = useHermesStore.getState().answerQuestion;
  let calls = 0;
  useHermesStore.setState({ questions: [q], answerQuestion: async () => { calls++; throw new Error('连接暂时中断'); } });
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(<HermesQuestionCard question={q} />); });
    const root = renderer.root;
    act(() => root.findByType('textarea').props.onChange({ target: { value: '保留原始要求' } }));
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(root.findByType('textarea').props.value, '保留原始要求');
    assert.equal(root.findByProps({ role: 'alert' }).children.join(''), '连接暂时中断');
    act(() => useHermesStore.setState({ questions: [question('text', { type: 'string' })] }));
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(calls, 1);
    assert.match(root.findByProps({ role: 'alert' }).children.join(''), /已结束或已更新/);
  } finally { act(() => renderer.unmount()); useHermesStore.setState({ questions: [], answerQuestion: original }); }
});

test('multi-select cards allow a custom answer without selecting an invented enum value', async () => {
  const q = question('multi', { type: 'array', items: { enum: ['采购', '仓储'] } });
  const original = useHermesStore.getState().answerQuestion;
  const calls: unknown[][] = [];
  useHermesStore.setState({ questions: [q], answerQuestion: async (...args) => { calls.push(args); } });
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { renderer = TestRenderer.create(<HermesQuestionCard question={q} />); });
    const root = renderer.root;
    act(() => root.findByProps({ 'aria-expanded': false }).props.onClick());
    act(() => root.findByType('textarea').props.onChange({ target: { value: '本期仅做销售' } }));
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(calls, [['multi', [], '本期仅做销售']]);
  } finally { act(() => renderer.unmount()); useHermesStore.setState({ questions: [], answerQuestion: original }); }
});
