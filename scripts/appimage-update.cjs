// Fill the AppImageSpec update section in place. Rebuild electron-builder's embedded
// block map before generating the zsync checksums, so both describe the final file.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getArtifactArchName } = require('builder-util');
const { appendBlockmap } = require('app-builder-lib/out/targets/differentialUpdateInfoBuilder');
const run = promisify(execFile);

// zsyncmake 0.8 uses SHA-256 in File-Hash. Older AppImageUpdate clients
// read SHA-1, so include it too, preserving the original block table.
async function includeLegacyChecksum(file) {
  const sidecar = await fs.readFile(file + '.zsync');
  const end = sidecar.indexOf('\n\n');
  if (end < 0) throw new Error('Invalid zsync control file');
  if (/^SHA-1: [a-f0-9]{40}$/m.test(sidecar.toString('ascii', 0, end))) return;
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const field = Buffer.from('\nSHA-1: ' + hash.digest('hex'));
  await fs.writeFile(file + '.zsync', Buffer.concat([sidecar.subarray(0, end), field, sidecar.subarray(end)]));
}

module.exports = async function addAppImageUpdates(event) {
  if (event.target?.name !== 'appImage') return;

  const { file, arch, packager, updateInfo } = event;
  const name = path.basename(file);
  const cpu = getArtifactArchName(arch, 'AppImage');
  const repo = 'EvanClub-Agent/protoflow-ai';
  const update = Buffer.from(`gh-releases-zsync|${repo.replace('/', '|')}|latest|ProtoFlow_AI-*-${cpu}.AppImage.zsync\0`);
  const url = `https://github.com/${repo}/releases/download/v${packager.appInfo.version}/${name}`;
  const dir = await fs.mkdtemp(path.join(path.dirname(file), '.appimage-update-'));
  const staged = path.join(dir, name);
  try {
    await fs.rename(file, staged);
    await fs.rm(file + '.zsync', { force: true });
    const { stdout } = await run(process.platform === 'darwin' ? 'greadelf' : 'readelf', ['-SW', staged], {
      env: { ...process.env, LC_ALL: 'C' },
    });
    // readelf -SW columns are index, name, type, address, file offset, byte size.
    const section = /^\s*\[\s*\d+\]\s+\.upd_info\s+PROGBITS\s+[\da-f]+\s+([\da-f]+)\s+([\da-f]+)/im.exec(stdout);
    if (!section || update.length > parseInt(section[2], 16)) throw new Error('AppImage runtime has no usable .upd_info section');

    const output = await fs.open(staged, 'r+');
    try {
      const { size } = await output.stat();
      const trailer = Buffer.alloc(4);
      await output.read(trailer, 0, 4, size - 4);
      if (size !== updateInfo.size || trailer.readUInt32BE() !== updateInfo.blockMapSize) {
        throw new Error('AppImage does not match the embedded block map');
      }
      await output.truncate(size - 4 - updateInfo.blockMapSize);
      await output.write(update, 0, update.length, parseInt(section[1], 16));
    } finally {
      await output.close();
    }
    const info = await appendBlockmap(staged);
    await run('zsyncmake', ['-u', url, '-o', name + '.zsync', name], { cwd: dir });
    await includeLegacyChecksum(staged);
    await fs.rename(staged + '.zsync', file + '.zsync');
    await fs.rename(staged, file);
    event.updateInfo = info;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};
