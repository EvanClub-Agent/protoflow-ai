const fs = require('node:fs');
const path = require('node:path');

// A populated directory is acquired atomically. Only a confirmed dead owner's
// unique marker can be renamed for recovery, even if two processes race to do so.
function claimDirectory(directory, work, owner, busyMessage) {
  const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!existing) {
    const claim = path.join(work, 'claim');
    fs.mkdirSync(claim);
    fs.writeFileSync(path.join(claim, owner), '');
    try { fs.renameSync(claim, directory); }
    catch (error) {
      if (fs.existsSync(directory)) throw new Error(busyMessage);
      throw error;
    }
    return;
  }
  if (!existing.isDirectory()) throw new Error('Invalid lock directory: ' + directory);
  const old = fs.readdirSync(directory).find(name => /^owner-\d+-[0-9a-f-]{36}$/.test(name));
  if (!old) throw new Error('Unknown lock owner: ' + directory);
  const pid = Number(old.split('-')[1]);
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid lock owner: ' + directory);
  try { process.kill(pid, 0); }
  catch (error) {
    if (error.code !== 'ESRCH') throw error;
    fs.renameSync(path.join(directory, old), path.join(directory, owner));
    return;
  }
  throw new Error(busyMessage);
}

module.exports = { claimDirectory };
