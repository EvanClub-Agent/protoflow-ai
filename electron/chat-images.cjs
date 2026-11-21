const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { atomicWrite } = require('./protoflow-mcp.cjs');
const { tr } = require('./i18n.cjs');

const { conversationScope, conversationKey } = require('./hermes-conversation.cjs');

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validateWebp(bytes) {
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error(tr('WebP 图片文件不完整', 'Incomplete WebP image file'));
  let dimensions;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw new Error(tr('WebP 图片内容损坏', 'Corrupted WebP image content'));
    if (type === 'VP8X' && size >= 10) dimensions = [1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3)];
    else if (type === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
      const bits = bytes.readUInt32LE(start + 1); dimensions = [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
    } else if (type === 'VP8 ' && size >= 10 && bytes.toString('hex', start + 3, start + 6) === '9d012a')
      dimensions = [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff];
    if (dimensions) break;
    offset = start + size + (size % 2);
  }
  if (!dimensions || !dimensions[0] || !dimensions[1]) throw new Error(tr('无法识别 WebP 图片尺寸', 'Unable to determine WebP image dimensions'));
  if (dimensions[0] * dimensions[1] > 40_000_000) throw new Error(tr('图片分辨率过大，请缩小到 4000 万像素以内', 'Image resolution is too large; please resize below 40 megapixels'));
}
function imageScope(input) {
  const scope = conversationScope(input);
  if (scope.kind === 'mindmap') throw new Error(tr('脑图会话不支持图片附件', 'Mindmap chats do not support image attachments'));
  return scope;
}
function validateImage(image) {
  if (!image || typeof image.name !== 'string' || !image.name.trim() || image.name.length > 255)
    throw new Error(tr('图片文件名无效', 'Invalid image file name'));
  if (typeof image.data !== 'string' || !image.data.length || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
    throw new Error(tr('图片不能为空，单张图片不能超过 5 MB', 'Image cannot be empty and each image must be 5 MB or smaller'));
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.toString('base64') !== image.data || !bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error(tr('图片编码无效或超过 5 MB', 'Invalid image encoding or image exceeds 5 MB'));
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const detected = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null;
  if (!detected || detected !== image.mimeType) throw new Error(tr('图片格式不匹配，请选择 PNG、JPG 或 WebP 图片', 'Image format mismatch; please choose a PNG, JPG, or WebP image'));
  if (webp) validateWebp(bytes);
  return bytes.length;
}
function imageList(images) {
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(tr('每条消息最多添加 4 张图片', 'Up to 4 images can be attached per message'));
}

// Store media outside localStorage and outside Hermes's installation/home. Only
// opaque IDs scoped to the exact chat may be read, never file paths.
class ChatImages {
  constructor(dataDir, validateDecodedImage) { this.dataDir = path.join(dataDir, 'chat-images'); this.validateDecodedImage = validateDecodedImage; }
  directory(scope) { return path.join(this.dataDir, createHash('sha256').update(conversationKey(imageScope(scope))).digest('hex')); }
  removeConversation(scope) { fs.rmSync(this.directory(scope), { recursive: true, force: true }); }
  save(input) {
    const scope = imageScope(input), dir = this.directory(scope), { images } = input;
    imageList(images);
    const records = images.map(image => {
      const size = validateImage(image);
      // Electron nativeImage on macOS decodes PNG/JPEG but rejects valid WebP.
      // WebP is decoded by Chromium in the picker and structurally checked above;
      // forward its original bytes to Hermes instead of converting or dropping it.
      if (image.mimeType !== 'image/webp') this.validateDecodedImage?.(Buffer.from(image.data, 'base64'));
      return { ...scope, id: randomUUID(), name: image.name, mimeType: image.mimeType, size, data: image.data };
    });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const written = [];
    try {
      for (const record of records) {
        const file = path.join(dir, `${record.id}.json`);
        atomicWrite(file, record); written.push(file);
      }
    } catch (error) { for (const file of written) fs.rmSync(file, { force: true }); throw error; }
    return records.map(({ data, ...reference }) => reference);
  }
  read(input) {
    const scope = imageScope(input), dir = this.directory(scope), { id } = input;
    if (typeof id !== 'string' || !ID.test(id)) throw new Error(tr('图片附件 ID 无效', 'Invalid image attachment ID'));
    let record;
    try {
      const file = path.join(dir, `${id}.json`);
      if (fs.statSync(file).size > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8192) throw new Error(tr('图片文件过大', 'Image file is too large'));
      record = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { throw new Error(tr('图片附件读取失败，请重新添加图片', 'Failed to read image attachment; please re-attach the image')); }
    if (conversationKey(record) !== conversationKey(scope) || record.id !== id)
      throw new Error(tr('图片附件不属于当前会话', 'Image attachment does not belong to the current conversation'));
    if (validateImage(record) !== record.size) throw new Error(tr('图片附件内容损坏，请重新添加', 'Image attachment is corrupted; please re-attach the image'));
    return record;
  }
  content(scope, images) {
    imageList(images);
    return images.map(image => {
      if (!image || conversationKey(image) !== conversationKey(scope))
        throw new Error(tr('图片附件不属于当前会话', 'Image attachment does not belong to the current conversation'));
      const record = this.read({ ...scope, id: image.id });
      if (record.mimeType !== image.mimeType || record.size !== image.size || record.name !== image.name)
        throw new Error(tr('图片附件信息不匹配，请重新添加', 'Image attachment metadata mismatch; please re-attach the image'));
      // Hermes ACP ImageContentBlock (acp_adapter/content.py).
      return { type: 'image', mimeType: record.mimeType, data: record.data };
    });
  }
}
module.exports = { ChatImages, MAX_IMAGES, MAX_IMAGE_BYTES };
