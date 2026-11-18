import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withAiBackgroundTask } from '../src/services/aiBackground';
const { AiBackground } = require(path.join(process.cwd(), 'electron/ai-background.cjs'));
const { AcpClient } = require(path.join(process.cwd(), 'electron/hermes-acp.cjs'));
const { cleanContext } = require(path.join(process.cwd(), 'electron/diagnostics.cjs'));
const scope = { projectId: 'project-power', kind: 'project', threadId: 'thread-power' };
function fixture(t: any, overrides: any = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-background-'));
  const powerMonitor = Object.assign(new EventEmitter(), { getSystemIdleState: () => 'active' });
  const live = new Set<number>(), starts: string[] = [], stops: number[] = [], reports: any[] = [], notifications: any[] = [];
  let nextId = 0, throttle = true;
  const powerSaveBlocker = { start: (type: string) => { starts.push(type); live.add(nextId); return nextId++; }, stop: (id: number) => { stops.push(id); live.delete(id); }, isStarted: (id: number) => live.has(id) };
  const window = { id: 7, isDestroyed: () => false, getBackgroundThrottling: () => throttle, setBackgroundThrottling: (value: boolean) => { throttle = value; } };
  const options = { dataDir, powerMonitor, powerSaveBlocker, diagnostic: (r: any) => reports.push(r), notify: (n: any) => notifications.push(n), ...overrides };
  const controller = new AiBackground(options); controller.attach(window);
  t.after(() => { controller.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { controller, options, powerMonitor, powerSaveBlocker, starts, stops, reports, notifications, window };
}
test('background protection covers native turns, between-page validation/save, and parallel task leases; blocker ID zero is valid', async t => {
  const f = fixture(t), c = f.controller;
  const workflow = c.begin(scope, 7);
  assert.equal(c.snapshot().protected, true); assert.equal(f.window.getBackgroundThrottling(), false);
  await c.run(scope, 7, async () => assert.equal(c.snapshot().protected, true));
  assert.equal(c.snapshot().protected, true); assert.deepEqual(f.stops, []);
  const other = c.begin({ ...scope, projectId: 'other-project' }, 8);
  c.end(workflow, 7);
  assert.equal(c.snapshot().protected, true);
  c.end(other, 8);
  assert.deepEqual(f.starts, ['prevent-app-suspension']); assert.deepEqual(f.stops, [0]);
  assert.equal(f.window.getBackgroundThrottling(), true);
});
test('lock and display idle do not end a task; suspend is recorded separately and never replays work', async t => {
  const f = fixture(t), c = f.controller;
  const original = new Error('Internal error');
  let calls = 0;
  await assert.rejects(c.run(scope, 7, async () => {
    calls++;
    f.powerMonitor.emit('lock-screen');
    assert.equal(c.snapshot().protected, true); assert.equal(c.snapshot().suspended, false);
    assert.equal(f.reports.length, 0);
    throw original;
  }), e => e === original);
  assert.match(f.notifications[0].body, /后台运行/); assert.match(f.notifications[1].body, /未完成/);
  await assert.rejects(c.run(scope, 7, async () => {
    calls++; f.powerMonitor.emit('suspend'); f.powerMonitor.emit('resume');
    assert.ok(c.checks(scope).some((v: any) => v.status.startsWith('suspend@')));
    throw original;
  }), /系统曾进入睡眠/);
  assert.equal(calls, 2); assert.equal(c.snapshot().active, false);
  assert.equal(f.reports[0].code, 'AI_SYSTEM_SUSPEND');
  const cleaned = cleanContext(f.reports[0].context);
  assert.equal(cleaned.projectId, scope.projectId);
  assert.ok(cleaned.checks.some((v: any) => v.kind === 'power-event'));
  assert.equal(JSON.stringify(f.notifications).includes(scope.projectId), false);
});
test('background cancellation preserves its identity and failed requests always release protection', async t => {
  const { controller: c, powerMonitor, stops } = fixture(t);
  const abort = new Error('已停止生成，未应用修改');
  await assert.rejects(c.run(scope, 7, async () => { powerMonitor.emit('suspend'); throw abort; }), e => e === abort);
  assert.deepEqual(stops, [0]); assert.equal(c.snapshot().protected, false);
});
test('power preference changes take effect during a task and persist; renderer cleanup cannot release another owner', t => {
  const { controller: c, options, window, powerMonitor } = fixture(t);
  const own = c.begin(scope, 7), other = c.begin({ ...scope, projectId: 'other' }, 8);
  assert.throws(() => c.end(own, 8), /不属于/);
  c.configure({ preventSleep: false, notifications: false });
  assert.equal(c.snapshot().protected, false); assert.equal(window.getBackgroundThrottling(), false);
  c.configure({ preventSleep: true, notifications: false }); assert.equal(c.snapshot().protected, true);
  c.releaseOwner(7); assert.equal(c.snapshot().protected, true);
  c.end(other, 8); assert.equal(window.getBackgroundThrottling(), true);
  c.begin(scope, 7); c.close(); assert.equal(c.snapshot().protected, false);
  assert.equal(powerMonitor.listenerCount('suspend'), 0);
  const restored = new AiBackground(options);
  assert.equal(restored.snapshot().notifications, false); restored.close();
});
test('failed OS assertion reports unavailable protection while still removing renderer throttling', t => {
  const f = fixture(t, { powerSaveBlocker: { start: () => { throw new Error('OS unavailable'); }, isStarted: () => false } });
  f.controller.begin(scope, 7);
  assert.equal(f.controller.snapshot().protected, false);
  assert.match(f.controller.snapshot().healthError, /未能/);
  assert.equal(f.window.getBackgroundThrottling(), false);
  assert.equal(f.reports[0].code, 'AI_BACKGROUND_PROTECTION_FAILED');
});
test('unlocking and disabling notifications clear a stale running notice without releasing task protection', t => {
  let cleared = 0;
  const f = fixture(t, { clearNotification: () => { cleared++; } });
  const id = f.controller.begin(scope, 7);
  f.powerMonitor.emit('lock-screen'); assert.equal(f.notifications.length, 1);
  f.powerMonitor.emit('unlock-screen'); assert.equal(cleared, 1); assert.equal(f.controller.snapshot().protected, true);
  f.controller.configure({ preventSleep: true, notifications: false }); assert.equal(cleared, 2);
  f.powerMonitor.emit('lock-screen'); f.controller.end(id, 7);
  assert.equal(f.notifications.length, 1); assert.equal(f.controller.snapshot().protected, false);
});
test('renderer workflow lease encloses host validation/save and does not mask failure on cleanup', async () => {
  const before = globalThis.window, order: string[] = [];
  const error = new Error('host validation failed');
  (globalThis as any).window = { protoflowDesktop: { aiBackground: {
    begin: async (s: any) => { assert.equal(s.projectId, scope.projectId); order.push('begin'); return 'lease-real'; },
    end: async (input: any) => { order.push('end:' + input.outcome); assert.equal(input.leaseId, 'lease-real'); throw new Error('transport closed'); },
  } } };
  try {
    await assert.rejects(withAiBackgroundTask(scope, async () => { order.push('native-ended'); await Promise.resolve(); order.push('host-validation'); throw error; }), e => e === error);
    assert.deepEqual(order, ['begin', 'native-ended', 'host-validation', 'end:failed']);
    order.length = 0;
    assert.equal(await withAiBackgroundTask(scope, async () => { order.push('save'); return 42; }), 42);
    assert.deepEqual(order, ['begin', 'save', 'end:finished']);
  } finally { (globalThis as any).window = before; }
});
test('ACP Internal error retains numeric error code and method without retaining raw provider data', async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => {} });
  const client = new AcpClient('fake', { home: '/tmp', spawnProcess: () => child });
  const pending = client.request('session/prompt', { sessionId: 's' }, null);
  child.stdout.write(JSON.stringify({ id: 1, error: { code: -32603, message: 'Internal error', data: { apiKey: 'secret', prompt: 'private' } } }) + '\n');
  await assert.rejects(pending, (error: any) => { assert.equal(error.rpcCode, -32603); assert.equal(error.rpcMethod, 'session/prompt'); assert.equal(JSON.stringify(error).includes('secret'), false); assert.equal(error.data, undefined); return true; });
  client.close();
});
