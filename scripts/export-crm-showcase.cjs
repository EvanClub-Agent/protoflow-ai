const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');

const entryCode = `
import { createProjectPayload } from './src/services/projectStorage';
import { encodePflowBinary } from './src/utils/pflowBinaryCodec';

export function buildCrmShowcaseBytes(): Uint8Array {
  const payload = createProjectPayload({
    projectId: 'proj-crm-contract-billing-v1',
    projectName: 'CRM 合同与回款开票业财系统',
    storageDir: 'examples/crm-contract-billing',
    fileName: 'crm-contract-billing.pflow',
    templateId: 'crm_analytics',
    projectMode: 'hybrid',
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:30:00.000Z',
    pageCount: 6,
    tableCount: 5,
    stickyCount: 9,
  });
  return encodePflowBinary(payload);
}
`;

const compiled = buildSync({
  stdin: {
    contents: entryCode,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.svg': 'dataurl' },
});

const mod = new Module('crm-showcase-exporter');
mod.filename = path.join(root, 'scripts/.crm-exporter.cjs');
mod.paths = Module._nodeModulePaths(root);
mod._compile(compiled.outputFiles[0].text, mod.filename);

const outDir = path.join(root, 'examples/crm-contract-billing');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'crm-contract-billing.pflow');
const bytes = mod.exports.buildCrmShowcaseBytes();
fs.writeFileSync(outFile, bytes);
console.log(`Generated ${path.relative(root, outFile)} (${bytes.byteLength} bytes)`);
