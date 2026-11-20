// Opt-in real multimodal request, using only an in-memory generated test image
// and an isolated menu session. No user project or screenshots are read.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { hermesTestEnvironment } = require('./hermes-test-environment.cjs');
const { HermesRuntime } = require('../electron/hermes-runtime.cjs');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBytes = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}
function testImage() {
  const width = 320, height = 160, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width * 3 + 1) + 1 + x * 3 + (x < width / 2 ? 0 : 2)] = 255;
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pflow-vision-smoke-'));
const runtime = new HermesRuntime({ dataDir, emit: event => {
  if (event.type === 'permission') runtime.respondPermission({ id: event.id, optionId: null });
  if (event.type === 'question') runtime.respondQuestion({ id: event.id, answer: null });
} });
(async () => {
  try {
    const projectChat = process.argv.includes('--project');
    const scope = projectChat
      ? { projectId: 'vision-smoke', kind: 'project', threadId: 'reference-images' }
      : { projectId: 'vision-smoke', pageId: 'image-menu' };
    const info = await runtime.connect(hermesTestEnvironment());
    assert.equal(info.capabilities.promptCapabilities.image, true);
    const session = await runtime.session(scope);
    const requestedModel = process.argv.find(arg => arg.startsWith('--model='))?.slice('--model='.length);
    const model = requestedModel
      ? session.models.availableModels.find(m => m.modelId === requestedModel)
      : session.models.availableModels.find(m => m.modelId.startsWith('openai-codex:'));
    if (requestedModel && !model) throw new Error('Requested model is not in the live Hermes catalogue');
    if (model) await runtime.setModel({ ...scope, modelId: model.modelId });
    const images = runtime.saveImages({ ...scope, images: [{ name: 'vision-test.png', mimeType: 'image/png', data: testImage().toString('base64') }] });
    const reply = await runtime.execute({ ...scope, images, readOnly: true, workflowPhase: projectChat ? 'conversation' : undefined, snapshot: { projectId: scope.projectId },
      prompt: 'Inspect the attached image directly. What are the two main colors, from left to right? Reply in English as LEFT=<color>; RIGHT=<color>. Do not use tools or modify files.' });
    assert.match(reply.text, /LEFT\s*=\s*red/i);
    assert.match(reply.text, /RIGHT\s*=\s*blue/i);
    assert.deepEqual(reply.operations, []);
    console.log(JSON.stringify({ passed: true, version: info.version, model: reply.modelId, reply: reply.text.trim() }, null, 2));
  } finally { runtime.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
