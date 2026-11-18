import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HermesAccountsPanel } from '../src/components/HermesAccountsPanel';
import { useHermesStore } from '../src/store/useHermesStore';
const { HermesAccounts } = require(path.join(process.cwd(), 'electron/hermes-accounts.cjs'));
function fixture() {
  const requests: any[] = [];
  const env = {
    EXACT_CREDENTIAL_KEY: { category: 'provider', provider_primary: true, is_password: true, provider: 'actual-provider-id', provider_label: 'Provider', is_set: true, redacted_value: 'NEVER_EXPOSE_THIS' },
    OTHER_SECRET: { category: 'custom', is_password: true, is_set: true },
  };
  const providers = [{ id: 'opaque:provider', name: 'Account', flow: 'device_code', status: { logged_in: false, token_preview: 'NEVER_EXPOSE_THIS' }, cli_command: 'do not show' }, { id: 'external-id', name: 'External', flow: 'external', status: { logged_in: true } }];
  const management = {
    dashboard: { origin: 'http://127.0.0.1:12345', profile: 'selected profile', token: 'PRIVATE_TEST_SESSION_TOKEN', child: { exitCode: null } },
    dashboardOrigin: async () => 'http://127.0.0.1:12345', assertNoChat() {},
    fetchResource: async (url: string, options: any) => {
      requests.push({ url, options });
      const route = new URL(url).pathname;
      let result: any = { ok: true };
      if (route === '/api/env' && options.method === 'GET') result = env;
      if (route === '/api/providers/oauth') result = { providers };
      if (route.endsWith('/start')) result = { session_id: 'session:exact', flow: 'device_code', verification_url: 'https://provider.example/verify', user_code: 'TEST-CODE', expires_in: 600 };
      if (route.includes('/poll/')) result = { session_id: 'session:exact', status: 'approved', token: 'DO_NOT_FORWARD' };
      return { ok: true, json: async () => result };
    },
  };
  const opened: string[] = [];
  const accounts = new HermesAccounts({ management, openExternal: async (url: string) => opened.push(url) });
  return { accounts, management, requests, opened, env };
}
test('account metadata excludes secrets and every request uses the server-declared profile and private header', async () => {
  const { accounts, requests } = fixture();
  const catalog = await accounts.list();
  assert.equal(catalog.keys[0].key, 'EXACT_CREDENTIAL_KEY');
  assert.equal(catalog.keys.length, 1);
  assert.doesNotMatch(JSON.stringify(catalog), /NEVER_EXPOSE|cli_command|SESSION_TOKEN|redacted_value/);
  assert.ok(requests.every(r => new URL(r.url).searchParams.get('profile') === 'selected profile'));
  assert.ok(requests.every(r => r.options.headers.Authorization === 'Bearer PRIVATE_TEST_SESSION_TOKEN'));
});
test('credential writes and removals require exact catalog keys and never substitute provider IDs or display names', async () => {
  const { accounts, requests } = fixture();
  for (const key of ['actual-provider-id', 'Provider', 'OTHER_SECRET', 'MISSING']) await assert.rejects(accounts.saveKey({ key, value: 'synthetic-test-key' }));
  assert.equal(requests.some(r => r.options.method === 'PUT'), false);
  await accounts.saveKey({ key: 'EXACT_CREDENTIAL_KEY', value: 'synthetic-test-key' });
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { key: 'EXACT_CREDENTIAL_KEY', value: 'synthetic-test-key', provider_setup: true });
  await accounts.removeKey({ key: 'EXACT_CREDENTIAL_KEY' });
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { key: 'EXACT_CREDENTIAL_KEY' });
});
test('OAuth keeps exact IDs, opens only the server authorization URL and does not forward returned tokens', async () => {
  const { accounts, requests, opened } = fixture();
  await assert.rejects(accounts.start({ providerId: 'external-id' }), /可视化|应用内/);
  const login = await accounts.start({ providerId: 'opaque:provider' });
  assert.equal(login.sessionId, 'session:exact');
  assert.ok(requests.some(r => r.url.includes('opaque%3Aprovider/start')));
  await accounts.openLogin({ sessionId: login.sessionId });
  assert.deepEqual(opened, ['https://provider.example/verify']);
  assert.deepEqual(await accounts.poll({ sessionId: login.sessionId }), { status: 'approved' });
  await assert.rejects(accounts.openLogin({ sessionId: login.sessionId }), /已结束/);
});
test('changing profile invalidates a pending login and API failures cannot leak response credentials', async () => {
  const { accounts, management } = fixture();
  const login = await accounts.start({ providerId: 'opaque:provider' });
  management.dashboard = { ...management.dashboard, profile: 'other profile' };
  await assert.rejects(accounts.poll({ sessionId: login.sessionId }), /环境已变化/);
  management.fetchResource = async () => ({ ok: false, status: 403, json: async () => ({ secret: 'NEVER_EXPOSE' }) }) as any;
  await assert.rejects(accounts.list(), (e: Error) => e.message.includes('403') && !e.message.includes('NEVER_EXPOSE'));
  management.dashboard.token = '';
  await assert.rejects(accounts.list(), /额外访问授权/);
});
test('account form submits an exact catalog key, clears entered secrets and marks settings for reconnection', async () => {
  useHermesStore.setState(useHermesStore.getInitialState(), true);
  const saved: any[] = [];
  (window as any).protoflowDesktop = { hermes: { accounts: {
    list: async () => ({ providers: [], keys: [{ key: 'EXACT_CREDENTIAL_KEY', provider: 'provider', name: 'Provider', configured: false }] }),
    saveKey: async (input: any) => { saved.push(input); return { saved: true }; },
  } } };
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(HermesAccountsPanel, { onBack() {} })); });
  act(() => renderer!.root.findByType('select').props.onChange({ target: { value: 'EXACT_CREDENTIAL_KEY' } }));
  act(() => renderer!.root.findByType('input').props.onChange({ target: { value: 'synthetic-user-key' } }));
  await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(saved, [{ key: 'EXACT_CREDENTIAL_KEY', value: 'synthetic-user-key' }]);
  assert.equal(renderer!.root.findByType('input').props.value, '');
  assert.equal(useHermesStore.getState().configurationChanged, true);
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /synthetic-user-key|hermes model|HERMES_HOME/);
  act(() => renderer!.unmount());
});
