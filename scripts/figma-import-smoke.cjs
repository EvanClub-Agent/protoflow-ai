// Standalone Figma import + Zstandard + REST API + MCP reshape smoke test.
const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
require('./build-material-contract.cjs').buildMaterialContract();

const result = buildSync({
  entryPoints: [path.join(root, 'tests/figma-import.test.tsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['react', 'react-dom', 'react-dom/server', 'react-test-renderer', 'scheduler', 'jsdom'],
  loader: { '.svg': 'dataurl' },
});

const suite = new Module('protoflow-figma-smoke');
suite.filename = path.join(root, 'tests/.compiled-figma-smoke.cjs');
suite.paths = Module._nodeModulePaths(root);
suite._compile(result.outputFiles[0].text, suite.filename);
