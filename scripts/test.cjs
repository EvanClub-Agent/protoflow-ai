const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
require('./build-material-contract.cjs').buildMaterialContract();
// rc-select uses MessageChannels for deferred close events.
// Browser channels do not own a process; Node ports must be closed after tests.
const channels = new Set();
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.add(this); }
};
require('node:test').after(() => {
  for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
  globalThis.MessageChannel = NativeMessageChannel;
});
const cliFiles = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const entryPoints = cliFiles.length
  ? cliFiles.map((file) => path.resolve(root, file))
  : [path.join(root, 'tests/regressions.test.ts')];
const result = buildSync({
  entryPoints,
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react-dom', 'react-dom/server', 'react-test-renderer', 'scheduler', 'jsdom', 'mermaid', '@mermaid-js/mermaid-zenuml'],
  loader: { '.svg': 'dataurl' },
});
const suite = new Module('protoflow-regression-tests');
suite.filename = path.join(root, 'tests/.compiled-tests.cjs');
suite.paths = Module._nodeModulePaths(root);
suite._compile(result.outputFiles[0].text, suite.filename);
