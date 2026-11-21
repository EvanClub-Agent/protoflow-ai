const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { tr } = require('./i18n.cjs');

const writes = new Map();
function withProjectFile(file, operation) {
  const previous = writes.get(file) || Promise.resolve();
  const work = previous.catch(() => {}).then(operation);
  writes.set(file, work);
  void work.finally(() => { if (writes.get(file) === work) writes.delete(file); }).catch(() => {});
  return work;
}

function archivePath(input) {
  if (!input || typeof input.projectId !== 'string' || !input.projectId.trim() || typeof input.dirPath !== 'string' || !path.isAbsolute(input.dirPath) || typeof input.fileName !== 'string' || !input.fileName || /[\\/]/.test(input.fileName) || ['.', '..'].includes(input.fileName)) {
    throw new Error(tr('项目标识或文件路径无效', 'Invalid project ID or file path'));
  }
  return path.join(input.dirPath, input.fileName);
}

// The archive identity is verified in the main process before moving a file.
// Binary layout matches pflowBinaryCodec.ts; no caller-supplied decoded ID is trusted.
function projectIdentity(bytes) {
  let json;
  if (bytes.subarray(0, 6).equals(Buffer.from([0x50, 0x46, 0x4c, 0x4f, 0x57, 0x01]))) {
    if (bytes.length < 18 || ![1, 2].includes(bytes.readUInt32BE(6)) || bytes.readUInt32BE(14) !== bytes.length - 18) {
      throw new Error(tr('工程文件格式无效', 'Invalid project file format'));
    }
    const raw = Buffer.alloc(bytes.length - 18);
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      raw[i] = bytes[i + 18] ^ ((0x5a + (i & 0x1f)) & 0xff);
      hash = Math.imul(hash ^ raw[i], 0x01000193) >>> 0;
    }
    if (hash !== bytes.readUInt32BE(10)) throw new Error(tr('工程校验失败', 'Project checksum verification failed'));
    json = raw.toString('utf8');
  } else json = bytes.toString('utf8');
  const payload = JSON.parse(json);
  if (!payload || !payload.meta || typeof payload.meta.projectId !== 'string' || !payload.meta.projectId.trim() || !payload.stateSnapshot || typeof payload.stateSnapshot !== 'object') {
    throw new Error(tr('不是有效的 Alex 工程', 'Not a valid Alex project file'));
  }
  return payload.meta.projectId;
}

async function trashProjectArchive(input, trashItem) {
  const file = archivePath(input);
  return withProjectFile(file, async () => {
    let stat;
    try { stat = await fs.lstat(file); }
    catch (error) {
      if (error.code === 'ENOENT') return { deleted: false, missing: true };
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(tr('工程路径不是普通文件，未删除', 'Project path is not a regular file; nothing was deleted'));
    if (projectIdentity(await fs.readFile(file)) !== input.projectId) {
      throw new Error(tr('该路径的工程 ID 已变化，未删除任何文件。请重新打开工程确认', 'Project ID at this path has changed; nothing was deleted. Reopen the project to verify'));
    }
    await trashItem(file);
    return { deleted: true, missing: false };
  });
}

/** Write a complete, checked snapshot beside the target, fsync, then atomically replace it.
 * Autosave never recreates a moved/deleted file or overwrites a different project. */
async function saveProjectArchive(input, { allowCreate = false } = {}) {
  const file = archivePath(input);
  if (!(input.binaryBytes instanceof Uint8Array)) throw new Error(tr('工程内容必须是二进制快照', 'Project content must be a binary snapshot'));
  const bytes = Buffer.from(input.binaryBytes);
  if (projectIdentity(bytes) !== input.projectId) throw new Error(tr('保存内容与项目 ID 不一致', 'Snapshot content does not match project ID'));
  return withProjectFile(file, async () => {
    let stat;
    try { stat = await fs.lstat(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!allowCreate) {
        throw new Error(tr('工程文件已移动或删除，自动保存已停止。请导出备份后重新打开工程', 'Project file was moved or deleted; autosave stopped. Export a backup and reopen the project'));
      }
    }
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(tr('工程路径不是普通文件，未覆盖', 'Project path is not a regular file; nothing was overwritten'));
      if (projectIdentity(await fs.readFile(file)) !== input.projectId) throw new Error(tr('该路径已有其他项目，未覆盖任何文件', 'Another project already exists at this path; nothing was overwritten'));
    } else await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
    try {
      const handle = await fs.open(temporary, 'wx', stat ? stat.mode & 0o777 : 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
    return { saved: true, filePath: file };
  });
}
module.exports = { trashProjectArchive, saveProjectArchive, projectIdentity };
