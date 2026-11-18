// Read-only smoke test against a real local Hermes. No login, key writes,
// updates, new installation, or changes to the user's provider settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HermesRuntime } = require('../electron/hermes-runtime.cjs');
const { HermesManagement } = require('../electron/hermes-management.cjs');
const { HermesAccounts } = require('../electron/hermes-accounts.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-management-smoke-'));
const runtime = new HermesRuntime({ dataDir: path.join(dir, 'runtime'), emit() {} });
const management = new HermesManagement({ runtime, dataDir: path.join(dir, 'management'), emit() {} });
const accounts = new HermesAccounts({ management, openExternal() { throw new Error('Read-only check cannot start a login'); } });
(async () => {
  try {
    const detected = await runtime.detect();
    assert.equal(detected.detected, true, 'A working local Hermes is required');
    const url = new URL(await management.managementUrl('models'));
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/models');
    assert.equal(url.searchParams.has('profile'), true);
    const catalog = await accounts.list();
    assert.ok(catalog.providers.length > 0);
    assert.ok(catalog.keys.length > 0);
    assert.ok(!JSON.stringify(catalog).includes('token_preview'));
    console.log(JSON.stringify({ version: detected.version, profilePinned: true,
      visualLogins: catalog.providers.filter(p => p.flow !== 'external').length,
      keyOptions: catalog.keys.length, credentialWrites: 0 }));
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  } finally {
    management.close(); runtime.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
