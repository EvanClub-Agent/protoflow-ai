const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { claimDirectory } = require('./claim-directory.cjs');

const receipt = '.alex-install.json';
const IGNORED_OS_JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = hashes => hash(JSON.stringify(Object.keys(hashes).sort().map(key => [key, hashes[key]])));
const stat = file => fs.lstatSync(file, { throwIfNoEntry: false });

// 3f5d2f5 and 8d32c08 shipped before receipts existed. Hash the complete tree
// except the project-specific MCP config, checked against its original generator.
const legacy = {
  skill: ['b0682c055dba9308dad0d7935cf029c953baa1f59da0df05fff02bde5eeb7df3', '4e5e391b3632c5e08a74c0a35863cd7e3dcbc089a522c349651762b1bb8acf5c'],
  plugin: ['477b9de850884f670f31902f689422d3c235842ae3a124a9b9a84be7f63c9447'],
};

function skillFiles(source) {
  const names = ['SKILL.md', ...fs.readdirSync(path.join(source, 'references')).filter(n => n.endsWith('.md')).map(n => 'references/' + n)];
  return Object.fromEntries(names.map(n => [n, fs.readFileSync(path.join(source, n))]));
}

function checkInstalled(target, kind, expected, legacyBinding) {
  const conflict = new Error('Existing ' + kind + ' differs: ' + target + '（请先移走自定义版本，或在 Alex 中点击「修复连接」强制重置）');
  if (!stat(target)?.isDirectory()) throw conflict;
  const hashes = new Map();
  let installed;
  function inspect(relative) {
    const entries = fs.readdirSync(path.join(target, relative), { withFileTypes: true })
      .filter(entry => !IGNORED_OS_JUNK.has(entry.name));
    if (!entries.length) throw conflict;
    for (const entry of entries) {
      const key = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) { inspect(key); continue; }
      if (!entry.isFile()) throw conflict;
      const bytes = fs.readFileSync(path.join(target, key));
      if (key === receipt) {
        try { installed = JSON.parse(bytes); } catch { throw conflict; }
        if (installed?.format !== 1 || installed.kind !== kind) throw conflict;
      } else hashes.set(key, hash(bytes));
    }
  }
  inspect('');
  const actual = Object.fromEntries(hashes);
  if (installed) {
    if (!isDeepStrictEqual(actual, installed.files)) throw conflict;
    return isDeepStrictEqual(actual, expected);
  }
  if (isDeepStrictEqual(actual, expected)) return false;
  const sameRelease = { ...expected };
  if (kind === 'plugin') {
    if (!actual['mcp_config.json'] || !legacyBinding(fs.readFileSync(path.join(target, 'mcp_config.json')))) throw conflict;
    delete actual['mcp_config.json'];
    delete sameRelease['mcp_config.json'];
  }
  if (!isDeepStrictEqual(actual, sameRelease) && !legacy[kind].includes(fingerprint(actual))) throw conflict;
  return false;
}

function installDesignerFiles(target, kind, files, legacyBinding, options = {}) {
  const forceRepair = options?.forceRepair === true;
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const transaction = path.join(parent, '.' + path.basename(target) + '.alex-update');
  const previous = path.join(transaction, 'previous');
  const work = fs.mkdtempSync(path.join(parent, '.alex-install-'));
  try {
    claimDirectory(transaction, work, 'owner-' + process.pid + '-' + randomUUID(), 'Installation already in progress: ' + transaction);
  } catch (error) {
    fs.rmSync(work, { recursive: true, force: true });
    throw error;
  }
  const next = path.join(transaction, 'next');
  try {
    // Resume an interrupted swap before checking the installed tree.
    if (stat(previous)) {
      if (stat(target)) fs.rmSync(previous, { recursive: true });
      else fs.renameSync(previous, target);
    }
    fs.rmSync(next, { recursive: true, force: true });
    const hashes = Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, hash(bytes)]));
    const currentStat = stat(target);
    const exists = Boolean(currentStat);
    if (exists && forceRepair && !currentStat.isDirectory()) {
      throw new Error('Existing ' + kind + ' is not a directory: ' + target);
    }
    if (exists && !forceRepair && checkInstalled(target, kind, hashes, legacyBinding)) return target;
    for (const [key, bytes] of Object.entries(files)) {
      const dest = path.join(next, key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, bytes);
    }
    fs.writeFileSync(path.join(next, receipt), JSON.stringify({ format: 1, kind, files: hashes }, null, 2) + '\n');
    if (exists) {
      fs.renameSync(target, previous);
      if (!forceRepair) checkInstalled(previous, kind, hashes, legacyBinding);
    }
    fs.renameSync(next, target);
    return target;
  } finally {
    if (stat(previous) && !stat(target)) fs.renameSync(previous, target);
    fs.renameSync(transaction, path.join(work, 'finished'));
    fs.rmSync(work, { recursive: true });
  }
}
module.exports = { installDesignerFiles, skillFiles };
