const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const { name, claudeBundle, pluginFiles, writeAtomic } = require('./client-integrations.cjs');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'release/integrations'));
fs.mkdirSync(output, { recursive: true });
for (const [suffix, bytes] of [['.mcpb', claudeBundle(root)], ['-antigravity.zip', zipSync(pluginFiles(root))]]) {
  const file = path.join(output, name + suffix);
  writeAtomic(file, bytes);
  console.log(file);
}
