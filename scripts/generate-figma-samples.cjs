// Generates ready-to-import .fig test archives in examples/figma-samples/
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { buildSync } = require('esbuild');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const bundle = buildSync({
  stdin: {
    contents: `
      export { zipSync, deflateSync } from "fflate";
      export { compress as zstdCompress } from "fzstd";
      export * from "./src/proto/figma/kiwi";
      export { importFigmaBinary } from "./src/proto/figma/figBinary";
      export { compileFigmaSelectionToProject } from "./src/proto/figma/import";
      export { createFigmaProject } from "./src/services/figmaProject";
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const mod = new Module('gen-figma-samples');
mod.filename = path.join(root, 'scripts/.gen-figma-samples.cjs');
mod.paths = Module._nodeModulePaths(root);
mod._compile(bundle.outputFiles[0].text, mod.filename);

const {
  zipSync,
  deflateSync,
  encodeBinarySchema,
  encodeKiwiMessage,
  importFigmaBinary,
  compileFigmaSelectionToProject,
  createFigmaProject,
} = mod.exports;

function createGradientPng(w, h, c1, c2) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / Math.max(1, w - 1)) * 0.65 + (y / Math.max(1, h - 1)) * 0.35;
      const p = rowStart + 1 + x * 4;
      raw[p] = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      raw[p + 1] = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      raw[p + 2] = Math.round(c1[2] + (c2[2] - c1[2]) * t);
      raw[p + 3] = 255;
    }
  }
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const tBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([tBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const schema = {
  definitions: [
    {
      name: 'NodePhase',
      kind: 'ENUM',
      fields: [
        { name: 'CREATED', type: 'uint', typeId: 0, isArray: false, value: 0 },
        { name: 'REMOVED', type: 'uint', typeId: 0, isArray: false, value: 1 },
      ],
    },
    {
      name: 'NodeType',
      kind: 'ENUM',
      fields: [
        { name: 'DOCUMENT', type: 'uint', typeId: 0, isArray: false, value: 1 },
        { name: 'CANVAS', type: 'uint', typeId: 0, isArray: false, value: 2 },
        { name: 'FRAME', type: 'uint', typeId: 0, isArray: false, value: 3 },
        { name: 'SECTION', type: 'uint', typeId: 0, isArray: false, value: 4 },
        { name: 'TEXT', type: 'uint', typeId: 0, isArray: false, value: 5 },
        { name: 'VECTOR', type: 'uint', typeId: 0, isArray: false, value: 6 },
        { name: 'RECTANGLE', type: 'uint', typeId: 0, isArray: false, value: 7 },
        { name: 'ELLIPSE', type: 'uint', typeId: 0, isArray: false, value: 8 },
      ],
    },
    {
      name: 'StackMode',
      kind: 'ENUM',
      fields: [
        { name: 'NONE', type: 'uint', typeId: 0, isArray: false, value: 0 },
        { name: 'HORIZONTAL', type: 'uint', typeId: 0, isArray: false, value: 1 },
        { name: 'VERTICAL', type: 'uint', typeId: 0, isArray: false, value: 2 },
      ],
    },
    {
      name: 'StackAlign',
      kind: 'ENUM',
      fields: [
        { name: 'MIN', type: 'uint', typeId: 0, isArray: false, value: 0 },
        { name: 'CENTER', type: 'uint', typeId: 0, isArray: false, value: 1 },
        { name: 'MAX', type: 'uint', typeId: 0, isArray: false, value: 2 },
        { name: 'SPACE_BETWEEN', type: 'uint', typeId: 0, isArray: false, value: 3 },
        { name: 'STRETCH', type: 'uint', typeId: 0, isArray: false, value: 4 },
      ],
    },
    {
      name: 'StackSizing',
      kind: 'ENUM',
      fields: [
        { name: 'FIXED', type: 'uint', typeId: 0, isArray: false, value: 0 },
        { name: 'RESIZE_TO_FIT', type: 'uint', typeId: 0, isArray: false, value: 1 },
      ],
    },
    {
      name: 'PaintType',
      kind: 'ENUM',
      fields: [
        { name: 'SOLID', type: 'uint', typeId: 0, isArray: false, value: 0 },
        { name: 'GRADIENT_LINEAR', type: 'uint', typeId: 0, isArray: false, value: 1 },
        { name: 'IMAGE', type: 'uint', typeId: 0, isArray: false, value: 2 },
      ],
    },
    {
      name: 'EffectType',
      kind: 'ENUM',
      fields: [{ name: 'DROP_SHADOW', type: 'uint', typeId: 0, isArray: false, value: 0 }],
    },
    {
      name: 'TextAlignH',
      kind: 'ENUM',
      fields: [
        { name: 'LEFT', type: 'uint', typeId: 0, isArray: false, value: 0 },
        { name: 'CENTER', type: 'uint', typeId: 0, isArray: false, value: 1 },
        { name: 'RIGHT', type: 'uint', typeId: 0, isArray: false, value: 2 },
      ],
    },
    {
      name: 'GUID',
      kind: 'STRUCT',
      fields: [
        { name: 'sessionID', type: 'uint', typeId: ~3, isArray: false, value: 1 },
        { name: 'localID', type: 'uint', typeId: ~3, isArray: false, value: 2 },
      ],
    },
    {
      name: 'Vector',
      kind: 'STRUCT',
      fields: [
        { name: 'x', type: 'float', typeId: ~4, isArray: false, value: 1 },
        { name: 'y', type: 'float', typeId: ~4, isArray: false, value: 2 },
      ],
    },
    {
      name: 'Matrix',
      kind: 'STRUCT',
      fields: [
        { name: 'm00', type: 'float', typeId: ~4, isArray: false, value: 1 },
        { name: 'm01', type: 'float', typeId: ~4, isArray: false, value: 2 },
        { name: 'm02', type: 'float', typeId: ~4, isArray: false, value: 3 },
        { name: 'm10', type: 'float', typeId: ~4, isArray: false, value: 4 },
        { name: 'm11', type: 'float', typeId: ~4, isArray: false, value: 5 },
        { name: 'm12', type: 'float', typeId: ~4, isArray: false, value: 6 },
      ],
    },
    {
      name: 'Color',
      kind: 'STRUCT',
      fields: [
        { name: 'r', type: 'float', typeId: ~4, isArray: false, value: 1 },
        { name: 'g', type: 'float', typeId: ~4, isArray: false, value: 2 },
        { name: 'b', type: 'float', typeId: ~4, isArray: false, value: 3 },
        { name: 'a', type: 'float', typeId: ~4, isArray: false, value: 4 },
      ],
    },
    {
      name: 'ParentIndex',
      kind: 'STRUCT',
      fields: [
        { name: 'guid', type: 'GUID', typeId: 8, isArray: false, value: 1 },
        { name: 'position', type: 'string', typeId: ~5, isArray: false, value: 2 },
      ],
    },
    {
      name: 'ColorStop',
      kind: 'STRUCT',
      fields: [
        { name: 'color', type: 'Color', typeId: 11, isArray: false, value: 1 },
        { name: 'position', type: 'float', typeId: ~4, isArray: false, value: 2 },
      ],
    },
    {
      name: 'ImageRef',
      kind: 'MESSAGE',
      fields: [{ name: 'hash', type: 'byte', typeId: ~1, isArray: true, value: 1 }],
    },
    {
      name: 'Paint',
      kind: 'MESSAGE',
      fields: [
        { name: 'type', type: 'PaintType', typeId: 5, isArray: false, value: 1 },
        { name: 'color', type: 'Color', typeId: 11, isArray: false, value: 2 },
        { name: 'opacity', type: 'float', typeId: ~4, isArray: false, value: 3 },
        { name: 'visible', type: 'bool', typeId: ~0, isArray: false, value: 4 },
        { name: 'image', type: 'ImageRef', typeId: 14, isArray: false, value: 5 },
        { name: 'stops', type: 'ColorStop', typeId: 13, isArray: true, value: 6 },
      ],
    },
    {
      name: 'Effect',
      kind: 'MESSAGE',
      fields: [
        { name: 'type', type: 'EffectType', typeId: 6, isArray: false, value: 1 },
        { name: 'color', type: 'Color', typeId: 11, isArray: false, value: 2 },
        { name: 'offset', type: 'Vector', typeId: 9, isArray: false, value: 3 },
        { name: 'radius', type: 'float', typeId: ~4, isArray: false, value: 4 },
        { name: 'spread', type: 'float', typeId: ~4, isArray: false, value: 5 },
        { name: 'visible', type: 'bool', typeId: ~0, isArray: false, value: 6 },
      ],
    },
    {
      name: 'TextData',
      kind: 'MESSAGE',
      fields: [{ name: 'characters', type: 'string', typeId: ~5, isArray: false, value: 1 }],
    },
    {
      name: 'NodeChange',
      kind: 'MESSAGE',
      fields: [
        { name: 'guid', type: 'GUID', typeId: 8, isArray: false, value: 1 },
        { name: 'phase', type: 'NodePhase', typeId: 0, isArray: false, value: 2 },
        { name: 'parentIndex', type: 'ParentIndex', typeId: 12, isArray: false, value: 3 },
        { name: 'type', type: 'NodeType', typeId: 1, isArray: false, value: 4 },
        { name: 'name', type: 'string', typeId: ~5, isArray: false, value: 5 },
        { name: 'visible', type: 'bool', typeId: ~0, isArray: false, value: 6 },
        { name: 'size', type: 'Vector', typeId: 9, isArray: false, value: 7 },
        { name: 'transform', type: 'Matrix', typeId: 10, isArray: false, value: 8 },
        { name: 'stackMode', type: 'StackMode', typeId: 2, isArray: false, value: 9 },
        { name: 'stackSpacing', type: 'float', typeId: ~4, isArray: false, value: 10 },
        { name: 'stackHorizontalPadding', type: 'float', typeId: ~4, isArray: false, value: 11 },
        { name: 'stackVerticalPadding', type: 'float', typeId: ~4, isArray: false, value: 12 },
        { name: 'stackPrimaryAlignItems', type: 'StackAlign', typeId: 3, isArray: false, value: 13 },
        { name: 'stackCounterAlignItems', type: 'StackAlign', typeId: 3, isArray: false, value: 14 },
        { name: 'stackPrimarySizing', type: 'StackSizing', typeId: 4, isArray: false, value: 15 },
        { name: 'stackCounterSizing', type: 'StackSizing', typeId: 4, isArray: false, value: 16 },
        { name: 'stackChildPrimaryGrow', type: 'float', typeId: ~4, isArray: false, value: 17 },
        { name: 'stackChildAlignSelf', type: 'StackAlign', typeId: 3, isArray: false, value: 18 },
        { name: 'fillPaints', type: 'Paint', typeId: 15, isArray: true, value: 19 },
        { name: 'strokePaints', type: 'Paint', typeId: 15, isArray: true, value: 20 },
        { name: 'strokeWeight', type: 'float', typeId: ~4, isArray: false, value: 21 },
        { name: 'effects', type: 'Effect', typeId: 16, isArray: true, value: 22 },
        { name: 'textData', type: 'TextData', typeId: 17, isArray: false, value: 23 },
        { name: 'fontSize', type: 'float', typeId: ~4, isArray: false, value: 24 },
        { name: 'fontWeight', type: 'float', typeId: ~4, isArray: false, value: 25 },
        { name: 'textAlignHorizontal', type: 'TextAlignH', typeId: 7, isArray: false, value: 26 },
        { name: 'cornerRadius', type: 'float', typeId: ~4, isArray: false, value: 27 },
        { name: 'clipsContent', type: 'bool', typeId: ~0, isArray: false, value: 28 },
        { name: 'transitionNodeID', type: 'GUID', typeId: 8, isArray: false, value: 29 },
      ],
    },
    {
      name: 'Message',
      kind: 'MESSAGE',
      fields: [{ name: 'nodeChanges', type: 'NodeChange', typeId: 18, isArray: true, value: 1 }],
    },
  ],
};

function hexColor(hex, a = 1) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
}
const solid = (hex, opacity = 1) => [{ type: 'SOLID', color: hexColor(hex), opacity, visible: true }];
const grad = (h1, h2) => [
  {
    type: 'GRADIENT_LINEAR',
    opacity: 1,
    visible: true,
    stops: [
      { color: hexColor(h1), position: 0 },
      { color: hexColor(h2), position: 1 },
    ],
  },
];
const cardShadow = () => [
  { type: 'DROP_SHADOW', color: hexColor('#0F172A', 0.06), offset: { x: 0, y: 4 }, radius: 14, spread: 0, visible: true },
];
const mat = (x = 0, y = 0) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });

class SceneBuilder {
  constructor(docName) {
    this.docName = docName;
    this.seq = 1;
    this.posCounters = new Map();
    this.nodes = [
      { guid: { sessionID: 0, localID: 0 }, phase: 'CREATED', type: 'DOCUMENT', name: docName, visible: true },
    ];
    this.images = {};
  }
  nextGuid() {
    return { sessionID: 1, localID: this.seq++ };
  }
  nextPos(parentGuid) {
    const k = `${parentGuid.sessionID}:${parentGuid.localID}`;
    const n = (this.posCounters.get(k) || 0) + 1;
    this.posCounters.set(k, n);
    return String(n).padStart(4, '0');
  }
  addImage(hexHash, bytes) {
    this.images[`images/${hexHash}`] = bytes;
    return new Uint8Array(hexHash.match(/../g).map((b) => parseInt(b, 16)));
  }
  add(parentGuid, spec) {
    const guid = spec.guid || this.nextGuid();
    const { x, y, ...rest } = spec;
    this.nodes.push({
      phase: 'CREATED',
      visible: true,
      transform: mat(x || 0, y || 0),
      ...rest,
      guid,
      parentIndex: { guid: parentGuid, position: this.nextPos(parentGuid) },
    });
    return guid;
  }
  txt(parent, text, { name, w = 160, h = 22, size = 14, weight = 400, color = '#0F172A', align = 'LEFT', grow = 0, x = 0, y = 0, click } = {}) {
    return this.add(parent, {
      type: 'TEXT',
      name: name || text.slice(0, 20),
      size: { x: w, y: h },
      x,
      y,
      fillPaints: solid(color),
      textData: { characters: text },
      fontSize: size,
      fontWeight: weight,
      textAlignHorizontal: align,
      ...(grow ? { stackChildPrimaryGrow: grow } : {}),
      ...(click ? { transitionNodeID: click } : {}),
    });
  }
  saveAndVerify(outDir, fileName) {
    const schemaBin = encodeBinarySchema(schema);
    const msgBin = encodeKiwiMessage(schema, { nodeChanges: this.nodes }, 'Message');
    const cSchema = deflateSync(schemaBin);
    const cData = deflateSync(msgBin);
    const canvas = new Uint8Array(12 + 4 + cSchema.length + 4 + cData.length);
    canvas.set(Buffer.from('fig-kiwi', 'utf8'), 0);
    const dv = new DataView(canvas.buffer);
    dv.setUint32(8, 48, true);
    dv.setUint32(12, cSchema.length, true);
    canvas.set(cSchema, 16);
    dv.setUint32(16 + cSchema.length, cData.length, true);
    canvas.set(cData, 20 + cSchema.length);
    const bytes = zipSync({
      'meta.json': Buffer.from(JSON.stringify({ file_name: this.docName }), 'utf8'),
      'canvas.fig': canvas,
      ...this.images,
    });
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, bytes);
    const parsed = importFigmaBinary(bytes, fileName);
    const compiled = compileFigmaSelectionToProject(parsed);
    const proj = createFigmaProject(fileName, '/tmp/figma-verify', compiled);
    console.log(`✔ ${fileName} (${(bytes.length / 1024).toFixed(1)} KB) -> mode=${proj.meta.projectMode}, selectedPages=${proj.meta.pageCount}`);
  }
}

const outDir = path.join(root, 'examples', 'figma-samples');
fs.mkdirSync(outDir, { recursive: true });
const docGuid = { sessionID: 0, localID: 0 };

// 1. Hybrid Sample (Desktop + Mobile + Design System Filter + Embedded PNGs + Click Links)
{
  const b = new SceneBuilder('电商全渠道运营系统 (多端混合)');
  const imgHero = b.addImage('1111222233334444555566667777888899990001', createGradientPng(320, 140, [37, 99, 235], [124, 58, 237]));
  const imgProd1 = b.addImage('1111222233334444555566667777888899990002', createGradientPng(200, 140, [16, 185, 129], [14, 165, 233]));
  const imgProd2 = b.addImage('1111222233334444555566667777888899990003', createGradientPng(200, 140, [245, 158, 11], [236, 72, 153]));

  const dsCanvas = b.add(docGuid, { type: 'CANVAS', name: 'Design System / 组件规范库' });
  const dsFrame = b.add(dsCanvas, {
    type: 'FRAME', name: 'Buttons & Color Tokens', size: { x: 800, y: 480 },
    fillPaints: solid('#FFFFFF'), stackMode: 'VERTICAL', stackSpacing: 16, stackHorizontalPadding: 32, stackVerticalPadding: 32,
  });
  b.txt(dsFrame, 'Primary / Secondary Button Tokens (默认自动跳过导入)', { size: 18, weight: 700, w: 520, h: 30 });

  const desktopOrdersGuid = b.nextGuid();
  const desktopProductsGuid = b.nextGuid();
  const mobileHomeGuid = b.nextGuid();
  const mobileDetailGuid = b.nextGuid();

  const pcCanvas = b.add(docGuid, { type: 'CANVAS', name: 'PC 运营管理后台' });
  b.add(pcCanvas, {
    guid: desktopOrdersGuid, type: 'FRAME', name: '订单履约工作台',
    size: { x: 1440, y: 900 }, clipsContent: true, fillPaints: solid('#F1F5F9'), stackMode: 'HORIZONTAL', stackSpacing: 0,
  });
  const side = b.add(desktopOrdersGuid, {
    type: 'FRAME', name: 'Sidebar Navigation', size: { x: 220, y: 900 }, fillPaints: solid('#0F172A'),
    stackMode: 'VERTICAL', stackSpacing: 8, stackHorizontalPadding: 16, stackVerticalPadding: 24,
  });
  b.txt(side, '云枢全渠道 OMS', { size: 17, weight: 700, color: '#FFFFFF', w: 188, h: 32 });
  for (const [label, active, target] of [
    ['订单履约工作台', true, null],
    ['商品库存画廊 (点击跳转)', false, desktopProductsGuid],
    ['移动端商城预览 (点击跳转)', false, mobileHomeGuid],
  ]) {
    const item = b.add(side, {
      type: 'FRAME', name: `NavItem ${label}`, size: { x: 188, y: 40 }, cornerRadius: 10,
      fillPaints: solid(active ? '#2563EB' : '#1E293B'),
      stackMode: 'HORIZONTAL', stackHorizontalPadding: 12, stackVerticalPadding: 10, stackCounterAlignItems: 'CENTER',
      ...(target ? { transitionNodeID: target } : {}),
    });
    b.txt(item, label, { size: 13, weight: active ? 600 : 400, color: active ? '#FFFFFF' : '#CBD5E1', w: 164, h: 20 });
  }

  const main1 = b.add(desktopOrdersGuid, {
    type: 'FRAME', name: 'Main Workspace', size: { x: 1220, y: 900 },
    stackChildPrimaryGrow: 1, stackMode: 'VERTICAL', stackSpacing: 20, stackHorizontalPadding: 28, stackVerticalPadding: 24,
  });
  const topBar1 = b.add(main1, {
    type: 'FRAME', name: 'Page Header', size: { x: 1164, y: 52 },
    stackChildAlignSelf: 'STRETCH', stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'SPACE_BETWEEN', stackCounterAlignItems: 'CENTER',
  });
  b.txt(topBar1, '订单履约工作台', { size: 22, weight: 700, color: '#0F172A', w: 280, h: 30 });
  const createBtn = b.add(topBar1, {
    type: 'FRAME', name: 'Primary Button 新建订单', size: { x: 124, y: 38 }, cornerRadius: 10, fillPaints: solid('#2563EB'),
    stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'CENTER', stackCounterAlignItems: 'CENTER',
  });
  b.txt(createBtn, '+ 新建销售单', { size: 13, weight: 600, color: '#FFFFFF', align: 'CENTER', w: 100, h: 20 });

  const kpiRow = b.add(main1, {
    type: 'FRAME', name: 'KPI Cards Row', size: { x: 1164, y: 104 },
    stackChildAlignSelf: 'STRETCH', stackMode: 'HORIZONTAL', stackSpacing: 16,
  });
  for (const [title, val, trend, col] of [
    ['今日成交总额 (GMV)', '¥ 128,640', '+18.4% 较昨日', '#2563EB'],
    ['待审核发货单', '42 单', '其中加急 7 单', '#D97706'],
    ['全仓履约准时率', '98.6%', '高于目标 2.6%', '#059669'],
    ['异常售后处理中', '5 单', '2h 内响应率 100%', '#7C3AED'],
  ]) {
    const card = b.add(kpiRow, {
      type: 'FRAME', name: `Stat Card ${title}`, size: { x: 279, y: 104 },
      stackChildPrimaryGrow: 1, cornerRadius: 14, fillPaints: solid('#FFFFFF'), effects: cardShadow(),
      stackMode: 'VERTICAL', stackSpacing: 6, stackHorizontalPadding: 18, stackVerticalPadding: 16,
    });
    b.txt(card, title, { size: 12, color: '#64748B', w: 220, h: 18 });
    b.txt(card, val, { size: 24, weight: 700, color: '#0F172A', w: 220, h: 30 });
    b.txt(card, trend, { size: 12, weight: 600, color: col, w: 220, h: 18 });
  }

  const filterBar = b.add(main1, {
    type: 'FRAME', name: 'Search Filter Form', size: { x: 1164, y: 64 },
    stackChildAlignSelf: 'STRETCH', cornerRadius: 14, fillPaints: solid('#FFFFFF'), strokePaints: solid('#E2E8F0'), strokeWeight: 1,
    stackMode: 'HORIZONTAL', stackSpacing: 14, stackHorizontalPadding: 18, stackVerticalPadding: 13, stackCounterAlignItems: 'CENTER',
  });
  for (const ph of ['输入订单号 / 客户名称搜索...', '履约状态：全部', '下单渠道：全渠道']) {
    const inp = b.add(filterBar, {
      type: 'FRAME', name: `Filter Input ${ph}`, size: { x: 240, y: 36 }, cornerRadius: 8,
      fillPaints: solid('#F8FAFC'), strokePaints: solid('#CBD5E1'), strokeWeight: 1,
      stackMode: 'HORIZONTAL', stackHorizontalPadding: 12, stackCounterAlignItems: 'CENTER',
    });
    b.txt(inp, ph, { size: 12, color: '#64748B', w: 210, h: 18 });
  }
  const qBtn = b.add(filterBar, {
    type: 'FRAME', name: 'Query Submit Button', size: { x: 84, y: 36 }, cornerRadius: 8, fillPaints: solid('#2563EB'),
    stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'CENTER', stackCounterAlignItems: 'CENTER',
  });
  b.txt(qBtn, '查询', { size: 13, weight: 600, color: '#FFFFFF', align: 'CENTER', w: 48, h: 18 });

  const tableBox = b.add(main1, {
    type: 'FRAME', name: 'Orders Data Table', size: { x: 1164, y: 320 },
    stackChildAlignSelf: 'STRETCH', cornerRadius: 14, fillPaints: solid('#FFFFFF'), effects: cardShadow(),
    stackMode: 'VERTICAL', stackSpacing: 0, clipsContent: true,
  });
  const thRow = b.add(tableBox, {
    type: 'FRAME', name: 'Table Header', size: { x: 1164, y: 46 },
    stackChildAlignSelf: 'STRETCH', fillPaints: solid('#F8FAFC'),
    stackMode: 'HORIZONTAL', stackSpacing: 16, stackHorizontalPadding: 20, stackCounterAlignItems: 'CENTER',
  });
  for (const h of ['订单编号', '客户名称', '渠道来源', '订单金额', '履约状态', '操作']) {
    b.txt(thRow, h, { size: 12, weight: 600, color: '#475569', w: 170, h: 20, grow: 1 });
  }
  for (const [no, cust, chan, amt, st, stCol] of [
    ['SO-20261124-001', '上海星云智能科技', '企业直采', '¥ 24,800.00', '待发货', '#D97706'],
    ['SO-20261124-002', '杭州极客精选百货', '微信小程序', '¥ 3,599.00', '已发货', '#2563EB'],
    ['SO-20261124-003', '深圳湾创新实验室', '官网商城', '¥ 58,200.00', '已签收', '#059669'],
    ['SO-20261124-004', '成都锦江严选门店', '移动订货端', '¥ 12,450.00', '待审核', '#7C3AED'],
  ]) {
    const trRow = b.add(tableBox, {
      type: 'FRAME', name: `Order Row ${no}`, size: { x: 1164, y: 56 },
      stackChildAlignSelf: 'STRETCH', strokePaints: solid('#F1F5F9'), strokeWeight: 1,
      stackMode: 'HORIZONTAL', stackSpacing: 16, stackHorizontalPadding: 20, stackCounterAlignItems: 'CENTER',
    });
    b.txt(trRow, no, { size: 13, weight: 600, color: '#0F172A', w: 170, h: 20, grow: 1 });
    b.txt(trRow, cust, { size: 13, color: '#334155', w: 170, h: 20, grow: 1 });
    b.txt(trRow, chan, { size: 13, color: '#64748B', w: 170, h: 20, grow: 1 });
    b.txt(trRow, amt, { size: 13, weight: 700, color: '#0F172A', w: 170, h: 20, grow: 1 });
    b.txt(trRow, st, { size: 12, weight: 600, color: stCol, w: 170, h: 20, grow: 1 });
    b.txt(trRow, '查看商品 →', { size: 12, weight: 600, color: '#2563EB', w: 170, h: 20, grow: 1, click: desktopProductsGuid });
  }

  // Page 2: 商品库存画廊
  b.add(pcCanvas, {
    guid: desktopProductsGuid, type: 'FRAME', name: '商品库存画廊', x: 1540, y: 0,
    size: { x: 1440, y: 900 }, clipsContent: true, fillPaints: solid('#F8FAFC'),
    stackMode: 'VERTICAL', stackSpacing: 20, stackHorizontalPadding: 36, stackVerticalPadding: 28,
  });
  const p2Top = b.add(desktopProductsGuid, {
    type: 'FRAME', name: 'Gallery Header', size: { x: 1368, y: 48 },
    stackChildAlignSelf: 'STRETCH', stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'SPACE_BETWEEN', stackCounterAlignItems: 'CENTER',
  });
  b.txt(p2Top, '← 返回订单履约工作台', { size: 13, weight: 600, color: '#2563EB', w: 220, h: 22, click: desktopOrdersGuid });
  b.txt(p2Top, '在售商品与实时库存画廊', { size: 20, weight: 700, color: '#0F172A', w: 320, h: 28 });
  b.add(desktopProductsGuid, {
    type: 'RECTANGLE', name: 'Hero Campaign Cover', size: { x: 1368, y: 160 }, cornerRadius: 16,
    fillPaints: [{ type: 'IMAGE', opacity: 1, visible: true, image: { hash: imgHero } }],
  });
  const gridRow = b.add(desktopProductsGuid, {
    type: 'FRAME', name: 'Product Cards Grid', size: { x: 1368, y: 320 },
    stackChildAlignSelf: 'STRETCH', stackMode: 'HORIZONTAL', stackSpacing: 20,
  });
  for (const [pName, sku, price, stock, imgHash] of [
    ['Pro 无线空间降噪耳机', 'SKU-AUDIO-01 · 现货充足', '¥ 1,299', '库存 480 件', imgProd1],
    ['AI 智能会议录音手写本', 'SKU-NOTE-08 · 热销爆款', '¥ 2,499', '库存 96 件', imgProd2],
    ['桌面氮化镓 140W 超充站', 'SKU-PWR-12 · 新品上架', '¥ 499', '库存 310 件', imgProd1],
  ]) {
    const pCard = b.add(gridRow, {
      type: 'FRAME', name: `Product Card ${pName}`, size: { x: 442, y: 300 },
      stackChildPrimaryGrow: 1, cornerRadius: 16, fillPaints: solid('#FFFFFF'), effects: cardShadow(),
      stackMode: 'VERTICAL', stackSpacing: 10, stackHorizontalPadding: 16, stackVerticalPadding: 16,
    });
    b.add(pCard, {
      type: 'RECTANGLE', name: 'Cover Image', size: { x: 410, y: 150 }, cornerRadius: 12,
      fillPaints: [{ type: 'IMAGE', opacity: 1, visible: true, image: { hash: imgHash } }],
    });
    b.txt(pCard, pName, { size: 16, weight: 700, color: '#0F172A', w: 380, h: 24 });
    b.txt(pCard, sku, { size: 12, color: '#64748B', w: 380, h: 18 });
    const foot = b.add(pCard, {
      type: 'FRAME', name: 'Price Footer', size: { x: 410, y: 32 },
      stackChildAlignSelf: 'STRETCH', stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'SPACE_BETWEEN', stackCounterAlignItems: 'CENTER',
    });
    b.txt(foot, price, { size: 18, weight: 700, color: '#2563EB', w: 120, h: 24 });
    b.txt(foot, stock, { size: 12, weight: 600, color: '#059669', align: 'RIGHT', w: 120, h: 20 });
  }

  // Canvas 3: Mobile Mini-Program
  const mobCanvas = b.add(docGuid, { type: 'CANVAS', name: 'C端移动商城小程序' });
  const mobSec = b.add(mobCanvas, { type: 'SECTION', name: '核心购物链路' });
  b.add(mobSec, {
    guid: mobileHomeGuid, type: 'FRAME', name: '移动商城首页', size: { x: 390, y: 844 }, clipsContent: true,
    fillPaints: solid('#F8FAFC'), stackMode: 'VERTICAL', stackSpacing: 14, stackHorizontalPadding: 16, stackVerticalPadding: 20,
  });
  b.txt(mobileHomeGuid, '星云严选商城', { size: 20, weight: 700, color: '#0F172A', w: 358, h: 28 });
  const mSearch = b.add(mobileHomeGuid, {
    type: 'FRAME', name: 'Mobile Search Pill', size: { x: 358, y: 40 },
    stackChildAlignSelf: 'STRETCH', cornerRadius: 20, fillPaints: solid('#FFFFFF'), strokePaints: solid('#E2E8F0'), strokeWeight: 1,
    stackMode: 'HORIZONTAL', stackHorizontalPadding: 16, stackCounterAlignItems: 'CENTER',
  });
  b.txt(mSearch, '搜索智能耳机、办公好物...', { size: 13, color: '#94A3B8', w: 300, h: 20 });
  const mBanner = b.add(mobileHomeGuid, {
    type: 'FRAME', name: 'Promo Gradient Banner', size: { x: 358, y: 148 },
    stackChildAlignSelf: 'STRETCH', cornerRadius: 20, fillPaints: grad('#2563EB', '#7C3AED'),
    stackMode: 'VERTICAL', stackSpacing: 8, stackHorizontalPadding: 20, stackVerticalPadding: 22,
    transitionNodeID: mobileDetailGuid,
  });
  b.txt(mBanner, '春季智能数码焕新季', { size: 19, weight: 700, color: '#FFFFFF', w: 300, h: 26 });
  b.txt(mBanner, '爆款降噪耳机直降 ¥200 · 点击查看详情 →', { size: 13, color: '#E0E7FF', w: 310, h: 20 });

  const mGrid = b.add(mobileHomeGuid, {
    type: 'FRAME', name: 'Mobile Dual Product Row', size: { x: 358, y: 240 },
    stackChildAlignSelf: 'STRETCH', stackMode: 'HORIZONTAL', stackSpacing: 12,
  });
  for (const [mTitle, mPrice, mHash] of [
    ['无线空间降噪耳机 Pro', '¥ 1,299', imgProd1],
    ['AI 语音转写智能本', '¥ 2,499', imgProd2],
  ]) {
    const mc = b.add(mGrid, {
      type: 'FRAME', name: `Mobile Card ${mTitle}`, size: { x: 173, y: 232 },
      stackChildPrimaryGrow: 1, cornerRadius: 18, fillPaints: solid('#FFFFFF'), effects: cardShadow(),
      stackMode: 'VERTICAL', stackSpacing: 8, stackHorizontalPadding: 10, stackVerticalPadding: 10,
      transitionNodeID: mobileDetailGuid,
    });
    b.add(mc, {
      type: 'RECTANGLE', name: 'Thumb', size: { x: 153, y: 120 }, cornerRadius: 12,
      fillPaints: [{ type: 'IMAGE', opacity: 1, visible: true, image: { hash: mHash } }],
    });
    b.txt(mc, mTitle, { size: 13, weight: 600, color: '#0F172A', w: 150, h: 36 });
    b.txt(mc, mPrice, { size: 15, weight: 700, color: '#2563EB', w: 150, h: 22 });
  }
  const mTabBar = b.add(mobileHomeGuid, {
    type: 'FRAME', name: 'Bottom TabBar', size: { x: 358, y: 54 },
    stackChildAlignSelf: 'STRETCH', cornerRadius: 27, fillPaints: solid('#0F172A'),
    stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'SPACE_BETWEEN', stackCounterAlignItems: 'CENTER', stackHorizontalPadding: 28,
  });
  b.txt(mTabBar, '首页探索', { size: 12, weight: 700, color: '#60A5FA', w: 72, h: 18 });
  b.txt(mTabBar, '分类选购', { size: 12, color: '#94A3B8', align: 'CENTER', w: 72, h: 18 });
  b.txt(mTabBar, '我的订单', { size: 12, color: '#94A3B8', align: 'RIGHT', w: 72, h: 18 });

  // Mobile Page 4: 商品详情与下单
  b.add(mobSec, {
    guid: mobileDetailGuid, type: 'FRAME', name: '商品详情与下单', x: 440, y: 0, size: { x: 390, y: 844 }, clipsContent: true,
    fillPaints: solid('#FFFFFF'), stackMode: 'VERTICAL', stackSpacing: 16, stackHorizontalPadding: 16, stackVerticalPadding: 20,
  });
  b.txt(mobileDetailGuid, '← 返回商城首页', { size: 14, weight: 600, color: '#2563EB', w: 200, h: 24, click: mobileHomeGuid });
  b.add(mobileDetailGuid, {
    type: 'RECTANGLE', name: 'Detail Hero Cover', size: { x: 358, y: 240 }, cornerRadius: 20,
    fillPaints: [{ type: 'IMAGE', opacity: 1, visible: true, image: { hash: imgProd1 } }],
  });
  b.txt(mobileDetailGuid, '¥ 1,299', { size: 26, weight: 700, color: '#2563EB', w: 200, h: 32 });
  b.txt(mobileDetailGuid, 'Pro 无线空间降噪耳机 (深空钛灰)', { size: 18, weight: 700, color: '#0F172A', w: 350, h: 26 });
  b.txt(mobileDetailGuid, '48dB 自适应主动降噪 · 空间音频头部追踪 · 40小时超长续航', { size: 13, color: '#64748B', w: 350, h: 40 });
  const buyDock = b.add(mobileDetailGuid, {
    type: 'FRAME', name: 'Bottom Buy Action Dock', size: { x: 358, y: 52 },
    stackChildAlignSelf: 'STRETCH', cornerRadius: 26, fillPaints: grad('#2563EB', '#4F46E5'),
    stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'CENTER', stackCounterAlignItems: 'CENTER',
  });
  b.txt(buyDock, '立即下单购买', { size: 15, weight: 700, color: '#FFFFFF', align: 'CENTER', w: 200, h: 22 });

  b.saveAndVerify(outDir, '电商全渠道运营系统-多端混合.fig');
}

// 2. Pure Desktop Sample (1440x900)
{
  const b = new SceneBuilder('SaaS 客户关系管理 CRM (桌面端)');
  const c1 = b.add(docGuid, { type: 'CANVAS', name: 'CRM 销售线索与商机' });
  const listGuid = b.nextGuid();
  const formGuid = b.nextGuid();

  b.add(c1, {
    guid: listGuid, type: 'FRAME', name: '客户公海与线索池', size: { x: 1440, y: 900 },
    fillPaints: solid('#F8FAFC'), stackMode: 'VERTICAL', stackSpacing: 20, stackHorizontalPadding: 32, stackVerticalPadding: 28,
  });
  const hdr = b.add(listGuid, {
    type: 'FRAME', name: 'Header Row', size: { x: 1376, y: 48 },
    stackChildAlignSelf: 'STRETCH', stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'SPACE_BETWEEN', stackCounterAlignItems: 'CENTER',
  });
  b.txt(hdr, 'CRM 企业客户线索池', { size: 22, weight: 700, color: '#0F172A', w: 300, h: 30 });
  const addBtn = b.add(hdr, {
    type: 'FRAME', name: 'New Lead Button', size: { x: 140, y: 38 }, cornerRadius: 10, fillPaints: solid('#2563EB'),
    stackMode: 'HORIZONTAL', stackPrimaryAlignItems: 'CENTER', stackCounterAlignItems: 'CENTER', transitionNodeID: formGuid,
  });
  b.txt(addBtn, '+ 登记新商机 →', { size: 13, weight: 600, color: '#FFFFFF', align: 'CENTER', w: 120, h: 20 });

  const tbl = b.add(listGuid, {
    type: 'FRAME', name: 'Leads Table', size: { x: 1376, y: 280 },
    stackChildAlignSelf: 'STRETCH', cornerRadius: 14, fillPaints: solid('#FFFFFF'), effects: cardShadow(),
    stackMode: 'VERTICAL', stackSpacing: 0,
  });
  for (const [comp, contact, stage, val] of [
    ['企业名称', '联系人', '跟进阶段', '预计签约额'],
    ['未来智造集团', '张总监 · 13800138001', '方案演示中', '¥ 360,000'],
    ['远航跨境物流', '李经理 · 13900139002', '商务谈判', '¥ 180,000'],
    ['清风医疗科技', '王主任 · 13700137003', '合同审批', '¥ 520,000'],
  ]) {
    const r = b.add(tbl, {
      type: 'FRAME', name: `Lead Row ${comp}`, size: { x: 1376, y: 54 },
      stackChildAlignSelf: 'STRETCH', strokePaints: solid('#F1F5F9'), strokeWeight: 1,
      stackMode: 'HORIZONTAL', stackSpacing: 16, stackHorizontalPadding: 24, stackCounterAlignItems: 'CENTER',
    });
    const isHdr = comp === '企业名称';
    b.txt(r, comp, { size: 13, weight: isHdr ? 600 : 700, color: isHdr ? '#64748B' : '#0F172A', w: 280, h: 20, grow: 1 });
    b.txt(r, contact, { size: 13, color: '#475569', w: 280, h: 20, grow: 1 });
    b.txt(r, stage, { size: 13, weight: 600, color: isHdr ? '#64748B' : '#2563EB', w: 240, h: 20, grow: 1 });
    b.txt(r, val, { size: 13, weight: 700, color: isHdr ? '#64748B' : '#059669', w: 240, h: 20, grow: 1 });
  }

  b.add(c1, {
    guid: formGuid, type: 'FRAME', name: '登记新商机表单', x: 1520, y: 0, size: { x: 1440, y: 900 },
    fillPaints: solid('#F8FAFC'), stackMode: 'VERTICAL', stackSpacing: 20, stackHorizontalPadding: 120, stackVerticalPadding: 40,
  });
  b.txt(formGuid, '← 返回客户线索池', { size: 13, weight: 600, color: '#2563EB', w: 200, h: 22, click: listGuid });
  const formCard = b.add(formGuid, {
    type: 'FRAME', name: 'Opportunity Form Card', size: { x: 800, y: 420 }, cornerRadius: 16, fillPaints: solid('#FFFFFF'), effects: cardShadow(),
    stackMode: 'VERTICAL', stackSpacing: 18, stackHorizontalPadding: 32, stackVerticalPadding: 28,
  });
  b.txt(formCard, '新建企业商机档案', { size: 20, weight: 700, color: '#0F172A', w: 320, h: 28 });
  for (const [lbl, ph] of [
    ['客户企业全称 *', '请输入营业执照企业名称'],
    ['核心决策人姓名 *', '请输入联系人姓名与职务'],
    ['预计签约金额 (元)', '例如：300000'],
    ['需求背景与痛点备注', '记录客户现阶段系统痛点与交付周期要求...'],
  ]) {
    const fGroup = b.add(formCard, {
      type: 'FRAME', name: `Form Field ${lbl}`, size: { x: 736, y: 62 },
      stackChildAlignSelf: 'STRETCH', stackMode: 'VERTICAL', stackSpacing: 6,
    });
    b.txt(fGroup, lbl, { size: 12, weight: 600, color: '#334155', w: 260, h: 18 });
    const box = b.add(fGroup, {
      type: 'FRAME', name: 'Input Box', size: { x: 736, y: 38 },
      stackChildAlignSelf: 'STRETCH', cornerRadius: 8, fillPaints: solid('#F8FAFC'), strokePaints: solid('#CBD5E1'), strokeWeight: 1,
      stackMode: 'HORIZONTAL', stackHorizontalPadding: 12, stackCounterAlignItems: 'CENTER',
    });
    b.txt(box, ph, { size: 12, color: '#94A3B8', w: 480, h: 18 });
  }

  b.saveAndVerify(outDir, 'SaaS客户关系管理后台-桌面端.fig');
}

// 3. Pure Mobile Sample (390x844)
{
  const b = new SceneBuilder('AI 随行生活助手 (移动端)');
  const mobCanvas = b.add(docGuid, { type: 'CANVAS', name: '移动端 App 页面' });
  const p1 = b.nextGuid();
  const p2 = b.nextGuid();

  b.add(mobCanvas, {
    guid: p1, type: 'FRAME', name: '今日探索主页', size: { x: 390, y: 844 },
    fillPaints: solid('#F0F4F9'), stackMode: 'VERTICAL', stackSpacing: 14, stackHorizontalPadding: 16, stackVerticalPadding: 24,
  });
  b.txt(p1, '早上好，Alex', { size: 22, weight: 700, color: '#0F172A', w: 320, h: 30 });
  b.txt(p1, '今天有 3 项智能日程提醒与精选灵感', { size: 13, color: '#64748B', w: 340, h: 20 });
  for (const [t, sub] of [
    ['10:30 产品设计评审会', '会议室 A302 · 已自动汇总需求纪要'],
    ['14:00 客户回访待办提醒', '星云科技年度续约沟通 · 点击进入 AI 助手 →'],
    ['18:30 城市骑行路线推荐', '滨江森林绿道 12km · 天气晴朗 22°C'],
  ]) {
    const c = b.add(p1, {
      type: 'FRAME', name: `Task Card ${t}`, size: { x: 358, y: 86 },
      stackChildAlignSelf: 'STRETCH', cornerRadius: 20, fillPaints: solid('#FFFFFF'), effects: cardShadow(),
      stackMode: 'VERTICAL', stackSpacing: 6, stackHorizontalPadding: 18, stackVerticalPadding: 16,
      transitionNodeID: p2,
    });
    b.txt(c, t, { size: 15, weight: 700, color: '#0F172A', w: 320, h: 22 });
    b.txt(c, sub, { size: 12, color: '#64748B', w: 320, h: 18 });
  }

  b.add(mobCanvas, {
    guid: p2, type: 'FRAME', name: 'AI 智能对话助手', x: 440, y: 0, size: { x: 390, y: 844 },
    fillPaints: solid('#FFFFFF'), stackMode: 'VERTICAL', stackSpacing: 14, stackHorizontalPadding: 16, stackVerticalPadding: 24,
  });
  b.txt(p2, '← 返回今日探索', { size: 14, weight: 600, color: '#2563EB', w: 200, h: 22, click: p1 });
  const msg1 = b.add(p2, {
    type: 'FRAME', name: 'AI Reply Card', size: { x: 358, y: 120 },
    stackChildAlignSelf: 'STRETCH', cornerRadius: 20, fillPaints: grad('#EEF2FF', '#F5F3FF'),
    stackMode: 'VERTICAL', stackSpacing: 8, stackHorizontalPadding: 16, stackVerticalPadding: 16,
  });
  b.txt(msg1, 'AI 行程建议已就绪', { size: 15, weight: 700, color: '#4338CA', w: 320, h: 22 });
  b.txt(msg1, '已为你预留下午 14:00 的续约报价对比表，并同步了最近 3 个月的工单满意度。', { size: 13, color: '#334155', w: 320, h: 48 });

  b.saveAndVerify(outDir, 'AI随行生活助手-移动端.fig');
}
