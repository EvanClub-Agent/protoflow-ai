const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

// The lock covers only the synchronous context transaction, never a bridge await.
// A dead owner's lock can be reclaimed. A living/unknown owner is never timed out
// and stolen: on timeout the caller fails without touching the staged state.
function acquire(file) {
  const lock = file + '.lock';
  const tmp = lock + '.' + process.pid + '.candidate';
  fs.writeFileSync(tmp, String(process.pid), { mode: 0o600 });
  try {
    fs.linkSync(tmp, lock);
    return () => fs.unlinkSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const reaper = lock + '.reaper';
    let ownsReaper = false;
    try {
      fs.mkdirSync(reaper);
      ownsReaper = true;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1) return null;
      try { process.kill(pid, 0); } catch (error) {
        // Reapers are serialized; a dead owner cannot release this lock.
        if (error.code === 'ESRCH') fs.unlinkSync(lock);
      }
    } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error;
    } finally { if (ownsReaper) fs.rmdirSync(reaper); }
    return null;
  } finally { fs.rmSync(tmp, { force: true }); }
}
function withContextLock(file, action) {
  const start = performance.now();
  let release;
  while (!(release = acquire(file))) {
    if (performance.now() - start > 5000) throw new Error('项目暂存正在收束，请稍后重试');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  try { return action(); } finally { release(); }
}
async function withContextLockAsync(file, action) {
  const start = performance.now();
  let release;
  while (!(release = acquire(file))) {
    if (performance.now() - start > 10000) throw new Error('项目暂存未能安全收束，原始现场已保留');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  // Actions are synchronous. Release before yielding a Promise to avoid holding
  // the lock across the caller's next synchronous MCP call in the same process.
  try { return action(); } finally { release(); }
}
module.exports = { withContextLock, withContextLockAsync };
