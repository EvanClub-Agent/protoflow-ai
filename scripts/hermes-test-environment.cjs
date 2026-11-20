const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Live probes use the selected test installation, independently of desktop first-run defaults.
function hermesTestEnvironment() {
  if (!process.env.PFLOW_HERMES_SETTINGS) return { home: process.env.HERMES_HOME || path.join(os.homedir(), '.hermes') };
  const { home, binary } = JSON.parse(fs.readFileSync(process.env.PFLOW_HERMES_SETTINGS, 'utf8'));
  if (typeof home !== 'string' || !path.isAbsolute(home) || typeof binary !== 'string' || !path.isAbsolute(binary))
    throw new Error('PFLOW_HERMES_SETTINGS must name an absolute Hermes home and launcher');
  return { home, binary };
}

async function detectTestHermes(runtime) {
  const info = await runtime.detect(hermesTestEnvironment());
  if (!info.detected || !info.installDir) {
    if (process.env.PFLOW_HERMES_SETTINGS) throw new Error(info.error || 'Selected Hermes fixture has no source installation');
    return info;
  }
  // These native integration fixtures exercise the pinned source adapter. A developer's
  // unrelated CLI is optional. An explicitly supplied fixture must pass verification.
  const { verify } = require('../electron/hermes-recovery-native.cjs');
  try { verify(info.installDir); } catch (error) {
    if (process.env.PFLOW_HERMES_SETTINGS) throw error;
    return { ...info, detected: false, error: error.message };
  }
  return info;
}

module.exports = { hermesTestEnvironment, detectTestHermes };
