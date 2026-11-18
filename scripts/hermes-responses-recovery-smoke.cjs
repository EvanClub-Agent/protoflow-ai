const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { prepareNativeRecovery, VERIFIED_HERMES_COMMIT } = require('../electron/hermes-recovery-native.cjs');
const { HermesRuntime } = require('../electron/hermes-runtime.cjs');

(async () => {
  const nativeHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
  const source = process.argv[2] || path.join(nativeHome, 'hermes-agent');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-responses-recovery-'));
  try {
    const home = path.join(temp, 'home'); fs.mkdirSync(home, { mode: 0o700 });
    for (const dir of ['installs', 'tools']) fs.symlinkSync(path.join(nativeHome, dir), path.join(home, dir));
    fs.writeFileSync(path.join(home, 'config.yaml'), 'updates:\n  check: false\n', { mode: 0o600 });
    const copy = await prepareNativeRecovery(source, temp);
    const launcher = path.join(source, '.hermes/bin/hermes');
    const python = JSON.parse(cp.execFileSync(launcher, ['--print-runtime-command'], { encoding: 'utf8' }))[0];
    const script = path.join(__dirname, 'hermes-responses-recovery-smoke.py');
    const boot = 'import sys,runpy;sys.path.insert(0,sys.argv[1]);import hermes_bootstrap;from pm.environments import activate_dependencies;from pathlib import Path;activate_dependencies(Path(sys.argv[1]));runpy.run_path(sys.argv[2],run_name="__main__")';
    const child = cp.spawn(python, ['-I', '-B', '-c', boot, copy, script], {
      env: { ...process.env, HERMES_HOME: home, ALEX_RECOVERY_DIR: path.join(temp, 'channels'), HERMES_DISABLE_LAZY_INSTALLS: '1' },
      stdio: 'inherit', timeout: 60000,
    });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (code !== 0) throw new Error('Responses recovery smoke failed');

    const runtime = new HermesRuntime({ dataDir: path.join(temp, 'runtime-verify'), emit: () => {} });
    try {
      await runtime.verifyStagedRelease(
        { detected: true, home, binary: launcher, installDir: source },
        { targetCommit: VERIFIED_HERMES_COMMIT, slotDir: source, slotBinary: launcher },
      );
      console.log('PASS verifyStagedRelease real HEAD + SHA-256 + Gateway + ACP initialize');
    } finally {
      runtime.close();
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
