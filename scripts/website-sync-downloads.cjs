#!/usr/bin/env node
/*
 * 把 release/ 中当前版本的安装包同步到官网 website/downloads/，并生成 manifest.json。
 *
 *   npm run website:sync                     复制安装包 + 生成清单
 *   npm run website:sync -- --no-copy --base-url https://cdn.example.com/alex/
 *                                            不复制文件，清单中的下载地址指向外部存储
 *
 * 官网会实时读取发行服务器的公开版本接口或 GitHub Releases，此清单仅用于构建产物本地核对与外部镜像记录。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const outDir = path.join(root, 'website', 'downloads');
const { version } = require(path.join(root, 'package.json'));

const args = process.argv.slice(2);
const noCopy = args.includes('--no-copy');
const baseUrlIndex = args.indexOf('--base-url');
const baseUrl = baseUrlIndex >= 0 ? args[baseUrlIndex + 1] : '';
if (baseUrlIndex >= 0 && !/^https?:\/\//.test(baseUrl || '')) {
  console.error('--base-url 需要 http(s) 地址');
  process.exit(1);
}

const OS = { mac: 'macos', win: 'windows', linux: 'linux' };
const ARCH = { arm64: 'arm64', aarch64: 'arm64', x64: 'x64', amd64: 'x64', x86_64: 'x64', universal: 'universal' };
function parseInstallerName(name) {
  const appImage = /^ProtoFlow_AI-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)-(x86_64|arm64|aarch64)\.AppImage$/.exec(name);
  if (appImage) return { version: appImage[1], platform: 'linux', cpu: appImage[2], format: 'AppImage' };
  const legacy = /^Alex-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)-(mac|win|linux)-([a-z0-9_]+)\.(dmg|zip|exe|deb|AppImage|tar\.gz)$/.exec(name);
  if (!legacy) return null;
  const [, version, platform, cpu, format] = legacy;
  return { version, platform, cpu, format };
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  if (!fs.existsSync(releaseDir)) {
    console.error('未找到 release/ 目录，请先运行 npm run build:mac / build:win / build:linux');
    process.exit(1);
  }
  const files = fs.readdirSync(releaseDir).filter((name) => parseInstallerName(name)?.version === version);
  if (!files.length) {
    console.error(`release/ 中没有 ${version} 版本的安装包`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  // Remove installers from previous versions so the site never serves stale builds.
  if (!noCopy) {
    const sidecars = files.filter(name => name.endsWith('.AppImage'))
      .map(name => name + '.zsync').filter(name => fs.existsSync(path.join(releaseDir, name)));
    const mirrored = new Set([...files, ...sidecars]);
    for (const name of fs.readdirSync(outDir)) {
      const installer = name.endsWith('.AppImage.zsync') ? name.slice(0, -6) : name;
      if (parseInstallerName(installer) && !mirrored.has(name)) {
        fs.rmSync(path.join(outDir, name));
        console.log(`  - 删除旧安装包 ${name}`);
      }
    }
    // A zsync control file travels with its installer, but is not itself an installer.
    for (const name of sidecars) fs.copyFileSync(path.join(releaseDir, name), path.join(outDir, name));
  }

  const assets = [];
  for (const name of files) {
    const { platform: os, cpu: arch, format: ext } = parseInstallerName(name);
    const src = path.join(releaseDir, name);
    const { size } = fs.statSync(src);
    const digest = await sha256(src);
    if (!noCopy) {
      const dest = path.join(outDir, name);
      const same = fs.existsSync(dest) && fs.statSync(dest).size === size && (await sha256(dest)) === digest;
      if (!same) fs.copyFileSync(src, dest);
      console.log(`  ${same ? '=' : '+'} ${name}`);
    }
    assets.push({
      os: OS[os],
      arch: ARCH[arch] || arch,
      packageType: ext.toLowerCase() === 'appimage' ? 'AppImage' : ext,
      fileName: name,
      sizeBytes: size,
      sha256: digest,
      url: baseUrl ? new URL(encodeURIComponent(name), baseUrl.replace(/\/?$/, '/')).href : encodeURIComponent(name),
    });
  }

  const manifest = { version, publishedAt: new Date().toISOString(), assets };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`已生成 website/downloads/manifest.json（${assets.length} 个安装包，版本 ${version}）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
