import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ExitConfirmation, type CloseConfirmationBridge } from '../src/components/ExitConfirmation';

test('exit UI cancels safely, prevents double confirmation and shows recoverable save failures', () => {
  let request!: (id: string) => void, status!: Parameters<CloseConfirmationBridge['onCloseState']>[0];
  const decisions: { requestId: string; confirmed: boolean }[] = [];
  let stopped = 0, ready = 0;
  const bridge: CloseConfirmationBridge = {
    onConfirmClose: fn => { request = fn; return () => { stopped++; }; },
    onCloseState: fn => { status = fn; return () => { stopped++; }; },
    confirmClose: value => { decisions.push(value); }, closeConfirmationReady: () => { ready++; },
  };
  (window as any).protoflowDesktop = bridge;
  let renderer!: TestRenderer.ReactTestRenderer;
  const click = (label: string) => renderer.root.findAllByType('button').find(b => b.children.includes(label))!.props.onClick();
  act(() => { renderer = TestRenderer.create(React.createElement(ExitConfirmation)); });
  try {
    assert.equal(ready, 1);
    assert.equal(renderer.toJSON(), null);
    act(() => { request('cancel'); });
    act(() => { renderer.root.findByType('dialog').props.onCancel({ preventDefault() {} }); });
    assert.deepEqual(decisions, [{ requestId: 'cancel', confirmed: false }]);
    assert.equal(renderer.toJSON(), null);
    act(() => { request('confirm'); });
    const confirm = renderer.root.findAllByType('button').at(-1)!.props.onClick;
    act(() => { confirm(); confirm(); });
    assert.equal(decisions.length, 2);
    assert.equal(renderer.root.findAllByType('button').every(b => b.props.disabled), true);
    act(() => { status({ requestId: 'stale', state: 'error', error: 'wrong window' }); });
    assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
    act(() => { status({ requestId: 'confirm', state: 'error', error: '磁盘空间不足' }); });
    assert.ok(JSON.stringify(renderer.toJSON()).includes('磁盘空间不足'));
    act(() => { click('重试并退出'); });
    assert.deepEqual(decisions.at(-1), { requestId: 'confirm', confirmed: true });
  } finally { act(() => renderer.unmount()); delete (window as any).protoflowDesktop; }
  assert.equal(stopped, 2);
});
