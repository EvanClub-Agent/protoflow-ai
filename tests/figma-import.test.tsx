import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { deflateSync, zipSync } from 'fflate';
import {
  decodeBinarySchema,
  decodeKiwiMessage,
  encodeBinarySchema,
  encodeKiwiMessage,
  type KiwiSchema,
} from '../src/proto/figma/kiwi';
import { importFigmaBinary } from '../src/proto/figma/figBinary';
import {
  fetchFigmaDocumentFromUrl,
  loadSavedFigmaToken,
  materializeFigmaSelectionImages,
  normalizeFigmaRestFile,
  parseFigmaUrl,
  saveFigmaToken,
} from '../src/proto/figma/restApi';
import { compileFigmaSelectionToProject } from '../src/proto/figma/import';
import { createFigmaProject } from '../src/services/figmaProject';
import {
  inspectFigmaPage,
  inspectFigmaProject,
  reshapeFigmaPage,
} from '../src/proto/figma/optimization';
import {
  applyFigmaTaskDraft,
  buildFigmaMigrationInstructions,
  clearFigmaTaskDraft,
  figmaCopyId,
  resolveSubmittedFigmaMigration,
} from '../src/proto/figma/task';
import { buildProjectSharedInstructions, discussProject, resolveProjectReview } from '../src/services/projectWorkflow';
import { loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { useHermesStore } from '../src/store/useHermesStore';
import { usePageStore } from '../src/proto/store/usePageStore';
import { useAiChatStore } from '../src/store/useAiChatStore';
import { projectChatScope } from '../src/services/projectChatHistory';
import { conversationKey } from '../src/services/hermesConversation';
import { pageContractErrors } from '../src/proto/ai/pageContract';
import { parsePageSource } from '../src/proto/dsl/parser';
import { NodeView } from '../src/proto/renderer/NodeView';
import { RuntimeProvider, useRuntimeController } from '../src/proto/runtime/runtime';
import { PreviewDataContext } from '../src/proto/runtime/PreviewData';
import { ProjectWelcomeLauncher } from '../src/components/ProjectWelcomeLauncher';
import { FigmaImportDialog, useFigmaImport } from '../src/components/FigmaImportDialog';
import { filterCardRows } from '../src/proto/registry/modernComponents';
import { prepareTableRows } from '../src/proto/table/model';
import { publicationSizeWarning, savePublication } from '../src/services/publishingClient';
import { createPublishedSnapshot } from '../src/services/createPublishedSnapshot';
import { encodePflowBinary, decodePflowBinary } from '../src/utils/pflowBinaryCodec';
import type { DBTableSchema } from '../src/store/useProtoStore';

declare const require: NodeRequire;
const cjsRequire = require;

const UTF8 = new TextEncoder();

function buildMinimalFigKiwiSchema(): KiwiSchema {
  return {
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
        name: 'PaintType',
        kind: 'ENUM',
        fields: [
          { name: 'SOLID', type: 'uint', typeId: 0, isArray: false, value: 0 },
          { name: 'IMAGE', type: 'uint', typeId: 0, isArray: false, value: 1 },
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
          { name: 'guid', type: 'GUID', typeId: 4, isArray: false, value: 1 },
          { name: 'position', type: 'string', typeId: ~5, isArray: false, value: 2 },
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
          { name: 'type', type: 'PaintType', typeId: 3, isArray: false, value: 1 },
          { name: 'color', type: 'Color', typeId: 7, isArray: false, value: 2 },
          { name: 'opacity', type: 'float', typeId: ~4, isArray: false, value: 3 },
          { name: 'visible', type: 'bool', typeId: ~0, isArray: false, value: 4 },
          { name: 'image', type: 'ImageRef', typeId: 9, isArray: false, value: 5 },
        ],
      },
      {
        name: 'PathGeom',
        kind: 'MESSAGE',
        fields: [{ name: 'commandsBlob', type: 'uint', typeId: ~3, isArray: false, value: 1 }],
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
          { name: 'guid', type: 'GUID', typeId: 4, isArray: false, value: 1 },
          { name: 'phase', type: 'NodePhase', typeId: 0, isArray: false, value: 2 },
          { name: 'parentIndex', type: 'ParentIndex', typeId: 8, isArray: false, value: 3 },
          { name: 'type', type: 'NodeType', typeId: 1, isArray: false, value: 4 },
          { name: 'name', type: 'string', typeId: ~5, isArray: false, value: 5 },
          { name: 'visible', type: 'bool', typeId: ~0, isArray: false, value: 6 },
          { name: 'size', type: 'Vector', typeId: 5, isArray: false, value: 7 },
          { name: 'transform', type: 'Matrix', typeId: 6, isArray: false, value: 8 },
          { name: 'stackMode', type: 'StackMode', typeId: 2, isArray: false, value: 9 },
          { name: 'stackSpacing', type: 'float', typeId: ~4, isArray: false, value: 10 },
          { name: 'fillPaints', type: 'Paint', typeId: 10, isArray: true, value: 11 },
          { name: 'textData', type: 'TextData', typeId: 12, isArray: false, value: 12 },
          { name: 'fontSize', type: 'float', typeId: ~4, isArray: false, value: 13 },
          { name: 'cornerRadius', type: 'float', typeId: ~4, isArray: false, value: 14 },
          { name: 'transitionNodeID', type: 'GUID', typeId: 4, isArray: false, value: 15 },
          { name: 'fillGeometry', type: 'PathGeom', typeId: 11, isArray: true, value: 16 },
        ],
      },
      {
        name: 'Blob',
        kind: 'MESSAGE',
        fields: [{ name: 'bytes', type: 'byte', typeId: ~1, isArray: true, value: 1 }],
      },
      {
        name: 'Message',
        kind: 'MESSAGE',
        fields: [
          { name: 'nodeChanges', type: 'NodeChange', typeId: 13, isArray: true, value: 1 },
          { name: 'blobs', type: 'Blob', typeId: 14, isArray: true, value: 2 },
        ],
      },
    ],
  };
}

function makeMatrix(x = 0, y = 0) {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
}

function buildSyntheticFigZipArchive(componentImageCount = 0): Uint8Array {
  const schema = buildMinimalFigKiwiSchema();
  const schemaBin = encodeBinarySchema(schema);

  // Build a simple triangle vector commandsBlob: M 0 0 L 16 8 L 0 16 Z
  const pathBuf = new ArrayBuffer(1 + 8 + 1 + 8 + 1 + 8 + 1);
  const dv = new DataView(pathBuf);
  let p = 0;
  dv.setUint8(p++, 1); dv.setFloat32(p, 0, true); p += 4; dv.setFloat32(p, 0, true); p += 4;
  dv.setUint8(p++, 2); dv.setFloat32(p, 16, true); p += 4; dv.setFloat32(p, 8, true); p += 4;
  dv.setUint8(p++, 2); dv.setFloat32(p, 0, true); p += 4; dv.setFloat32(p, 16, true); p += 4;
  dv.setUint8(p++, 0);

  const imgHashHex = 'aabbccddeeff00112233445566778899aabbccdd';
  const imgHashBytes = new Uint8Array(imgHashHex.match(/../g)!.map((h) => parseInt(h, 16)));
  // Minimal 1x1 PNG header signature bytes
  const tinyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

  const msgPayload = {
    blobs: [{ bytes: new Uint8Array(pathBuf) }],
    nodeChanges: [
      { guid: { sessionID: 0, localID: 0 }, phase: 'CREATED', type: 'DOCUMENT', name: 'SaaS & Mobile Suite', visible: true },
      // Canvas 1: Design System (should be auto-flagged & defaultSelected=false)
      {
        guid: { sessionID: 1, localID: 1 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 0, localID: 0 }, position: '!' },
        type: 'CANVAS',
        name: 'Design System / Components',
        visible: true,
      },
      {
        guid: { sessionID: 1, localID: 2 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 1 }, position: '!' },
        type: 'FRAME',
        name: 'Button Tokens',
        visible: true,
        size: { x: 600, y: 400 },
        transform: makeMatrix(0, 0),
      },
      // Canvas 2: Product Screens (Desktop + Mobile inside Section)
      {
        guid: { sessionID: 1, localID: 10 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 0, localID: 0 }, position: '"' },
        type: 'CANVAS',
        name: '核心业务流程',
        visible: true,
      },
      // Desktop Frame 1440x900
      {
        guid: { sessionID: 1, localID: 11 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 10 }, position: '!' },
        type: 'FRAME',
        name: '订单管理工作台',
        visible: true,
        size: { x: 1440, y: 900 },
        transform: makeMatrix(0, 0),
        stackMode: 'VERTICAL',
        stackSpacing: 16,
        fillPaints: [{ type: 'SOLID', color: { r: 0.97, g: 0.98, b: 0.99, a: 1 }, opacity: 1, visible: true }],
      },
      // Sidebar Nav inside Desktop Frame
      {
        guid: { sessionID: 1, localID: 12 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 11 }, position: '!' },
        type: 'FRAME',
        name: 'Top Header Nav',
        visible: true,
        size: { x: 1400, y: 56 },
        transform: makeMatrix(0, 0),
        stackMode: 'HORIZONTAL',
        stackSpacing: 12,
        transitionNodeID: { sessionID: 1, localID: 21 },
      },
      // Repeating Card List inside Desktop Frame
      {
        guid: { sessionID: 1, localID: 13 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 11 }, position: '"' },
        type: 'FRAME',
        name: 'Order List Rows',
        visible: true,
        size: { x: 1400, y: 400 },
        transform: makeMatrix(0, 72),
        stackMode: 'VERTICAL',
        stackSpacing: 8,
      },
      {
        guid: { sessionID: 1, localID: 14 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 13 }, position: '!' },
        type: 'FRAME',
        name: 'Row 1',
        visible: true,
        size: { x: 1360, y: 48 },
        transform: makeMatrix(0, 0),
        stackMode: 'HORIZONTAL',
        stackSpacing: 16,
      },
      {
        guid: { sessionID: 1, localID: 15 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 14 }, position: '!' },
        type: 'TEXT',
        name: 'Order No',
        visible: true,
        size: { x: 160, y: 24 },
        transform: makeMatrix(0, 0),
        textData: { characters: 'SO-2026-001' },
        fontSize: 14,
      },
      {
        guid: { sessionID: 1, localID: 16 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 13 }, position: '"' },
        type: 'FRAME',
        name: 'Row 2',
        visible: true,
        size: { x: 1360, y: 48 },
        transform: makeMatrix(0, 56),
        stackMode: 'HORIZONTAL',
        stackSpacing: 16,
      },
      {
        guid: { sessionID: 1, localID: 17 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 16 }, position: '!' },
        type: 'TEXT',
        name: 'Order No 2',
        visible: true,
        size: { x: 160, y: 24 },
        transform: makeMatrix(0, 0),
        textData: { characters: 'SO-2026-002' },
        fontSize: 14,
      },
      // Vector icon & Embedded Image inside Desktop Frame
      {
        guid: { sessionID: 1, localID: 18 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 11 }, position: '#' },
        type: 'VECTOR',
        name: 'Play Icon',
        visible: true,
        size: { x: 16, y: 16 },
        transform: makeMatrix(0, 500),
        fillPaints: [{ type: 'SOLID', color: { r: 0.15, g: 0.39, b: 0.92, a: 1 }, opacity: 1, visible: true }],
        fillGeometry: [{ commandsBlob: 0 }],
      },
      {
        guid: { sessionID: 1, localID: 19 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 11 }, position: '$' },
        type: 'RECTANGLE',
        name: 'Banner Cover',
        visible: true,
        size: { x: 240, y: 120 },
        transform: makeMatrix(40, 500),
        cornerRadius: 12,
        fillPaints: [{ type: 'IMAGE', opacity: 1, visible: true, image: { hash: imgHashBytes } }],
      },
      // Mobile Section -> Mobile Frame 390x844
      {
        guid: { sessionID: 1, localID: 20 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 10 }, position: '"' },
        type: 'SECTION',
        name: '移动端商城',
        visible: true,
      },
      {
        guid: { sessionID: 1, localID: 21 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 20 }, position: '!' },
        type: 'FRAME',
        name: '移动端商品首页',
        visible: true,
        size: { x: 390, y: 844 },
        transform: makeMatrix(1600, 0),
        stackMode: 'VERTICAL',
        stackSpacing: 12,
        fillPaints: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
      },
      {
        guid: { sessionID: 1, localID: 22 },
        phase: 'CREATED',
        parentIndex: { guid: { sessionID: 1, localID: 21 }, position: '!' },
        type: 'TEXT',
        name: 'Mobile Greeting',
        visible: true,
        size: { x: 320, y: 28 },
        transform: makeMatrix(16, 20),
        textData: { characters: '精选好物直达' },
        fontSize: 18,
      },
    ],
  };

  const componentAssets: Record<string, Uint8Array> = {};
  for (let i = 0; i < componentImageCount; i++) {
    const hash = (i + 1).toString(16).padStart(40, '0');
    const bytes = new Uint8Array(4 * 1024 * 1024);
    bytes.set(tinyPng);
    componentAssets[`images/${hash}`] = bytes;
    msgPayload.nodeChanges.push({
      guid: { sessionID: 2, localID: i + 1 }, phase: 'CREATED', type: 'RECTANGLE', name: 'Component art',
      parentIndex: { guid: { sessionID: 1, localID: 2 }, position: String(i) },
      visible: true, size: { x: 240, y: 120 }, transform: makeMatrix(),
      fillPaints: [{ type: 'IMAGE', opacity: 1, visible: true, image: { hash: Buffer.from(hash, 'hex') } }],
    });
  }
  const msgBin = encodeKiwiMessage(schema, msgPayload, 'Message');
  const compSchema = deflateSync(schemaBin);
  const compData = deflateSync(msgBin);

  const canvasFig = new Uint8Array(12 + 4 + compSchema.length + 4 + compData.length);
  canvasFig.set(UTF8.encode('fig-kiwi'), 0);
  const headerDv = new DataView(canvasFig.buffer);
  headerDv.setUint32(8, 48, true);
  headerDv.setUint32(12, compSchema.length, true);
  canvasFig.set(compSchema, 16);
  headerDv.setUint32(16 + compSchema.length, compData.length, true);
  canvasFig.set(compData, 20 + compSchema.length);

  return zipSync({
    'meta.json': UTF8.encode(JSON.stringify({ file_name: '企业全端协同设计稿' })),
    'canvas.fig': canvasFig,
    ...componentAssets,
    [`images/${imgHashHex}`]: tinyPng,
  });
}

test('Kiwi binary schema & message round-trip preserves zero/non-zero varfloats, structs, enums and byte arrays', () => {
  const schema = buildMinimalFigKiwiSchema();
  const decodedSchema = decodeBinarySchema(encodeBinarySchema(schema));
  assert.equal(decodedSchema.definitions.length, schema.definitions.length);
  const msg = {
    blobs: [{ bytes: new Uint8Array([1, 2, 3, 4]) }],
    nodeChanges: [
      {
        guid: { sessionID: 2, localID: 99 },
        phase: 'CREATED',
        type: 'FRAME',
        name: 'Test Frame',
        visible: true,
        size: { x: 0, y: 375.5 },
        transform: makeMatrix(-24.25, 0),
      },
    ],
  };
  const roundTripped = decodeKiwiMessage(decodedSchema, encodeKiwiMessage(schema, msg, 'Message'));
  assert.equal(roundTripped.nodeChanges[0].name, 'Test Frame');
  assert.equal(roundTripped.nodeChanges[0].size.x, 0);
  assert.ok(Math.abs(roundTripped.nodeChanges[0].size.y - 375.5) < 0.01);
  assert.ok(Math.abs(roundTripped.nodeChanges[0].transform.m02 - -24.25) < 0.01);
  assert.deepEqual([...roundTripped.blobs[0].bytes], [1, 2, 3, 4]);
});

test('Local .fig archive unpacks, filters Design System sheets, detects Hybrid Desktop/Mobile frames, and reshapes cleanly', () => {
  const figBytes = buildSyntheticFigZipArchive();
  const doc = importFigmaBinary(figBytes, 'demo.fig');
  assert.equal(doc.name, '企业全端协同设计稿');
  assert.equal(doc.canvases.length, 2);
  assert.equal(doc.canvases[0].isDesignSystemCanvas, true);
  assert.equal(doc.canvases[0].frames[0].defaultSelected, false);

  const bizFrames = doc.canvases[1].frames;
  assert.equal(bizFrames.length, 2);
  assert.equal(bizFrames[0].platform, 'desktop');
  assert.equal(bizFrames[1].platform, 'mobile');
  assert.equal(bizFrames[1].sectionName, '移动端商城');

  const compiled = compileFigmaSelectionToProject(doc);
  assert.equal(compiled.projectMode, 'hybrid');
  assert.equal(compiled.designerPages.length, 2);

  const payload = createFigmaProject('企业全端协同设计稿.fig', '/tmp/figma-test', compiled);
  const decodedPayload = decodePflowBinary(encodePflowBinary(payload));
  assert.equal(decodedPayload.meta.projectMode, 'hybrid');
  assert.equal(decodedPayload.meta.pageCount, 2);

  for (const [pid, src] of Object.entries(decodedPayload.stateSnapshot.pageSources)) {
    assert.deepEqual(pageContractErrors(src, []), [], `Imported Figma page ${pid} should have 0 contract errors`);
  }

  // Inspect project & verify Auto Layout repeating row cluster detection + cross-page link
  const desktopPageId = compiled.designerPages[0].pageId;
  const mobilePageId = compiled.designerPages[1].pageId;
  const overview = inspectFigmaProject(decodedPayload.stateSnapshot, { kind: 'project' });
  assert.equal(overview.totalPages, 2);
  const desktopRec = overview.records.find((r) => r.pageId === desktopPageId)!;
  assert.ok(desktopRec.repeatingGroups.length >= 1, 'Detects Auto Layout repeating rows');
  assert.ok(desktopRec.linkedPageIds.includes(mobilePageId), 'Resolves prototype navigation link to mobile page');

  const pageDetail = inspectFigmaPage(desktopPageId, decodedPayload.stateSnapshot.pageSources[desktopPageId]);
  assert.equal(pageDetail.platform, 'desktop');
  assert.ok(pageDetail.nodes.length >= 5);

  // Add a business DB table and reshape both Desktop & Mobile pages using the new Layer-2 materials!
  const ordersTable: DBTableSchema = {
    id: 't_orders',
    tableName: 'sales_orders',
    cnName: '销售订单',
    domain: 'business',
    description: '订单主表',
    columns: [
      { id: 'c_id', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '主键' },
      { id: 'c_no', name: 'order_no', dataType: 'VARCHAR(64)', nullable: false, comment: '订单号' },
      { id: 'c_amt', name: 'amount', dataType: 'VARCHAR(32)', nullable: false, comment: '金额' },
      { id: 'c_tag', name: 'status', dataType: 'VARCHAR(32)', nullable: false, comment: '状态' },
    ],
    sharedByMenus: [],
  };
  decodedPayload.stateSnapshot.dbTables = [ordersTable];

  // Reshape Mobile frame first so Desktop reshape auto-retargets navigate(mobilePageId) -> figmaCopyId(mobilePageId)!
  const mobileNodes = inspectFigmaPage(mobilePageId, decodedPayload.stateSnapshot.pageSources[mobilePageId]).nodes;
  const mobileTextPfId = String(mobileNodes.find((n) => n.type === 'FigmaText')!.pfId);
  const reshapedMobile = reshapeFigmaPage(
    decodedPayload.stateSnapshot,
    mobilePageId,
    `export default function Page() {
      return (
        <MobilePage pfId="m-root" title="移动端商品首页">
          <MTopBar pfId="m-top" title="移动商城" leftMode="none" rightIcon="avatar" />
          <MBannerCarousel pfId="m-banner" height={160} items={[{ title: "精选好物直达", subtitle: "春季上新", badge: "NEW", tone: "gemini" }]} />
          <MSearchPill pfId="m-search" target="m-grid" placeholder="搜索订单或商品..." />
          <MCardGrid pfId="m-grid" table="t_orders" cols={2} titleField="order_no" priceField="amount" tagField="status" />
          <MTabBar pfId="m-tabs" activeKey="home" items={[{ key: "home", title: "首页", icon: "Home" }, { key: "me", title: "我的", icon: "User" }]} />
        </MobilePage>
      );
    }`,
    {
      converted: [{ sourcePfIds: [mobileTextPfId], targetPfId: 'm-grid', summary: '移动端精选商品与订单双列卡片流', tableId: 't_orders' }],
    },
  );
  assert.equal(reshapedMobile.pageId, figmaCopyId(mobilePageId));
  assert.equal(reshapedMobile.platform, 'mobile');
  decodedPayload.stateSnapshot.pageSources[reshapedMobile.pageId] = reshapedMobile.source;

  const navSrcPfId = String(pageDetail.nodes.find((n) => n.label === 'Top Header Nav')!.pfId);
  const rowsSrcPfId = String(pageDetail.nodes.find((n) => n.label === 'Order List Rows')!.pfId);
  const reshapedDesktop = reshapeFigmaPage(
    decodedPayload.stateSnapshot,
    desktopPageId,
    `export default function Page() {
      return (
        <Page pfId="d-root" title="订单管理工作台">
          <NavMenu pfId="d-nav" mode="horizontal" brandTitle="协同运营中心" activeKey="orders" items={[{ key: "orders", title: "订单工作台", icon: "ShoppingBag" }, { key: "mobile", title: "移动商城预览", icon: "Compass", page: "${mobilePageId}" }]} />
          <Carousel pfId="d-hero" height={180} items={[{ title: "订单履约全景看板", subtitle: "实时追踪核心单据", tone: "blue" }]} />
          <Toolbar pfId="d-bar">
            <Icon pfId="d-icon" name="Sparkles" size={18} tone="blue" />
            <Dropdown pfId="d-drop" label="批量操作" items={[{ key: "exp", title: "导出报表" }]} />
          </Toolbar>
          <QueryForm pfId="d-query" target="d-cards" fields={[{ name: "order_no", label: "订单号" }]} />
          <CardGrid pfId="d-cards" table="t_orders" cols={3} titleField="order_no" priceField="amount" tagField="status" />
        </Page>
      );
    }`,
    {
      converted: [
        { sourcePfIds: [navSrcPfId], targetPfId: 'd-nav', summary: '顶部应用导航栏' },
        { sourcePfIds: [rowsSrcPfId], targetPfId: 'd-cards', summary: '订单卡片网格列表', tableId: 't_orders' },
      ],
      pending: [{ reason: '装饰图标已合并至工具栏' }],
    },
  );
  assert.equal(reshapedDesktop.pageId, figmaCopyId(desktopPageId));
  assert.ok(
    reshapedDesktop.source.includes(figmaCopyId(mobilePageId)),
    'Cross-page navigate target in NavMenu.items[].page retargets to optimized mobile page ID',
  );
});

test('Figma REST API URL parser & JSON normalizer convert coordinates, gradients, and interactions', () => {
  const parsed = parseFigmaUrl('https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Enterprise-CRM?node-id=42-108&t=xyz');
  assert.equal(parsed.fileKey, 'AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(parsed.nodeId, '42:108');

  const restDoc = normalizeFigmaRestFile(
    {
      name: 'CRM Cloud Rest',
      version: '991',
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [
          {
            id: '1:1',
            type: 'CANVAS',
            name: 'Dashboard',
            children: [
              {
                id: '42:108',
                type: 'FRAME',
                name: 'Sales Overview',
                absoluteBoundingBox: { x: 200, y: 100, width: 1280, height: 800 },
                clipsContent: true,
                fills: [
                  {
                    type: 'GRADIENT_LINEAR',
                    gradientStops: [
                      { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
                      { position: 1, color: { r: 0.94, g: 0.96, b: 1, a: 1 } },
                    ],
                  },
                ],
                children: [
                  {
                    id: '42:109',
                    type: 'TEXT',
                    name: 'KPI Heading',
                    absoluteBoundingBox: { x: 240, y: 132, width: 300, height: 32 },
                    characters: 'Q4 Revenue $1.28M',
                    fills: [{ type: 'SOLID', color: { r: 0.06, g: 0.09, b: 0.16, a: 1 } }],
                    style: { fontSize: 24, fontWeight: 700, textAlignHorizontal: 'LEFT' },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    { fileKey: parsed.fileKey },
  );

  assert.equal(restDoc.canvases.length, 1);
  const frame = restDoc.canvases[0].frames[0];
  assert.equal(frame.platform, 'desktop');
  assert.equal(frame.rootNode.children?.[0].x, 40, 'Child X is relative to parent frame');
  assert.equal(frame.rootNode.children?.[0].y, 32, 'Child Y is relative to parent frame');
});

test('Figma materials, new desktop/mobile business materials, and redesigned Welcome Launcher render cleanly', () => {
  const Harness: React.FC<{ source: string }> = ({ source }) => {
    const doc = parsePageSource(source).doc!;
    const rt = useRuntimeController(doc, { pageId: 'p1', isDesign: false });
    return (
      <PreviewDataContext.Provider
        value={{
          tables: [
            {
              id: 't1',
              tableName: 'items',
              cnName: '商品',
              domain: 'business',
              description: '',
              columns: [
                { id: 'c1', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '' },
                { id: 'c2', name: 'title', dataType: 'VARCHAR(64)', nullable: false, comment: '' },
              ],
              sharedByMenus: [],
            },
          ],
          rows: { t1: [{ id: '1', title: '智算一体机' }] },
        }}
      >
        <RuntimeProvider value={rt}>
          <NodeView node={doc.root} />
        </RuntimeProvider>
      </PreviewDataContext.Provider>
    );
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <Harness
        source={`export default function Page() {
          return (
            <Page pfId="root" title="Render Check">
              <FigmaCanvas pfId="fc" frameWidth={800} frameHeight={400} layoutMode="column" gap={12}>
                <FigmaFrame pfId="ff" layoutMode="row" gap={8} padding="8px 12px" width={400} height={48} background="#F8FAFC" radius={8}>
                  <FigmaVector pfId="fv" width={20} height={20} fill="#2563EB" svgPath="M0 0L10 5L0 10Z" />
                  <FigmaText pfId="ft" text="Figma Auto Layout Layer" fontSize={14} fontWeight={600} width={200} height={20} />
                </FigmaFrame>
                <FigmaImage pfId="fi" width={120} height={80} alt="Demo" />
              </FigmaCanvas>
              <NavMenu pfId="nm" brandTitle="Portal" items={[{ key: "k1", title: "首页" }]} />
              <CardGrid pfId="cg" table="t1" cols={2} titleField="title" />
            </Page>
          );
        }`}
      />,
    );
  });
  const textJoined = JSON.stringify(renderer.toJSON());
  assert.ok(textJoined.includes('Figma Auto Layout Layer'));
  assert.ok(textJoined.includes('智算一体机'));
  renderer.unmount();

  // Verify redesigned Welcome Launcher renders separated Figma & Axure RP branded triggers
  const prevWin = (globalThis as any).window;
  if (!prevWin) {
    const store = new Map<string, string>();
    (globalThis as any).window = {
      location: { search: '' },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    };
  }
  let figmaCalls: string[] = [];
  let rpCalls = 0;
  let launcher!: TestRenderer.ReactTestRenderer;
  act(() => {
    launcher = TestRenderer.create(
      <ProjectWelcomeLauncher
        standalone
        onImportRp={() => { rpCalls++; }}
        onImportFigma={(tab) => { figmaCalls.push(tab ?? 'file'); }}
      />,
    );
  });
  const launcherTree = launcher.toJSON();
  const launcherStr = JSON.stringify(launcherTree);
  assert.ok(launcherStr.includes('Figma'));
  assert.ok(launcherStr.includes('Axure'));
  assert.equal(rpCalls, 0);
  assert.equal(figmaCalls.length, 0);

  // Guard: no interactive <button> or [role="button"] nested inside another interactive trigger
  const assertNoNestedInteractive = (node: any, insideInteractive = false) => {
    if (!node || typeof node !== 'object') return;
    const isInteractive = node.type === 'button' || node.props?.role === 'button';
    if (insideInteractive && isInteractive) {
      assert.fail(`Found nested interactive element: <${node.type}> inside interactive parent`);
    }
    if (Array.isArray(node.children)) {
      for (const ch of node.children) assertNoNestedInteractive(ch, insideInteractive || isInteractive);
    }
  };
  assertNoNestedInteractive(launcherTree);
  launcher.unmount();
});

test('Review regressions: single leaf node URL import, encrypted-only token storage, and embedded REST images', async () => {
  // 1. Single TEXT and VECTOR leaf node URLs (?node-id=...) must NOT compile to blank pages
  const textNodeDoc = normalizeFigmaRestFile(
    {
      name: 'Leaf Text Spec',
      nodes: {
        '88:9': {
          document: {
            id: '88:9',
            type: 'TEXT',
            name: 'Hero Headline',
            absoluteBoundingBox: { x: 120, y: 64, width: 260, height: 36 },
            characters: '立即开启智能协同',
            fills: [{ type: 'SOLID', color: { r: 0.08, g: 0.12, b: 0.22, a: 1 } }],
            style: { fontSize: 22, fontWeight: 700, textAlignHorizontal: 'LEFT' },
          },
        },
      },
    },
    { fileKey: 'AbCdEf12345678901234' },
  );
  const compiledText = compileFigmaSelectionToProject(textNodeDoc);
  assert.equal(compiledText.report[0].widgets, 1, 'Single text node emits 1 widget instead of blank page');
  const textPageSrc = compiledText.pageSources[compiledText.designerPages[0].pageId];
  assert.ok(textPageSrc.includes('<FigmaText'), 'Single text node compiles <FigmaText>');
  assert.ok(textPageSrc.includes('立即开启智能协同'), 'Single text node preserves characters');
  assert.deepEqual(pageContractErrors(textPageSrc, []), []);

  const iconNodeDoc = normalizeFigmaRestFile(
    {
      name: 'Leaf Icon Spec',
      nodes: {
        '99:3': {
          document: {
            id: '99:3',
            type: 'VECTOR',
            name: 'Spark Icon',
            absoluteBoundingBox: { x: 10, y: 10, width: 24, height: 24 },
            fills: [{ type: 'SOLID', color: { r: 0.15, g: 0.39, b: 0.92, a: 1 } }],
            fillGeometry: [{ path: 'M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9Z', windingRule: 'NONZERO' }],
          },
        },
      },
    },
    { fileKey: 'AbCdEf12345678901234' },
  );
  const compiledIcon = compileFigmaSelectionToProject(iconNodeDoc);
  assert.equal(compiledIcon.report[0].widgets, 1, 'Single vector icon emits 1 widget');
  const iconPageSrc = compiledIcon.pageSources[compiledIcon.designerPages[0].pageId];
  assert.ok(iconPageSrc.includes('<FigmaVector'), 'Single vector node compiles <FigmaVector>');
  assert.deepEqual(pageContractErrors(iconPageSrc, []), []);

  // 2. Desktop token store refuses plaintext persistence when safeStorage is unavailable or basic_text
  const { createFigmaBridge } = cjsRequire(path.join(process.cwd(), 'electron/figma-bridge.cjs'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-token-'));
  try {
    const unencryptedBridge = createFigmaBridge({
      dataDir: tmpDir,
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.from('should-not-run'),
        decryptString: () => '',
      },
    });
    const resUnavail = await unencryptedBridge.setToken('figd_plain_forbidden');
    assert.equal(resUnavail.saved, true);
    assert.equal(resUnavail.persisted, false);
    assert.equal(fs.existsSync(unencryptedBridge.settingsFile), false, 'Must never write plaintext token file when encryption is unavailable');
    assert.equal(await unencryptedBridge.getToken(), 'figd_plain_forbidden', 'Keeps session token in memory only');

    // basic_text backend on Linux must also refuse disk persistence
    const basicTextBridge = createFigmaBridge({
      dataDir: tmpDir,
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'basic_text',
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString('utf-8'),
      },
    });
    const resBasic = await basicTextBridge.setToken('figd_basic_text_forbidden');
    assert.equal(resBasic.persisted, false);
    assert.equal(fs.existsSync(basicTextBridge.settingsFile), false, 'Must refuse basic_text backend');

    // Legacy plaintext file on disk is scrubbed on read and never returned
    fs.writeFileSync(basicTextBridge.settingsFile, JSON.stringify({ token: 'figd_legacy_plain' }), 'utf-8');
    const freshEncryptedBridge = createFigmaBridge({
      dataDir: tmpDir,
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'keychain',
        encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
        decryptString: (b: Buffer) => b.toString('utf-8').replace(/^enc:/, ''),
      },
    });
    assert.equal(await freshEncryptedBridge.getToken(), '', 'Legacy plaintext token is rejected');
    assert.equal(fs.existsSync(freshEncryptedBridge.settingsFile), false, 'Legacy plaintext file is deleted');

    // Valid OS keychain encryption persists ciphertext only
    const resEnc = await freshEncryptedBridge.setToken('figd_keychain_ok');
    assert.equal(resEnc.persisted, true);
    const rawDisk = fs.readFileSync(freshEncryptedBridge.settingsFile, 'utf-8');
    assert.ok(!rawDisk.includes('figd_keychain_ok'), 'Plaintext token never appears on disk');
    assert.ok(rawDisk.includes('encryptedToken'));

    const reloadedBridge = createFigmaBridge({
      dataDir: tmpDir,
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'keychain',
        encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
        decryptString: (b: Buffer) => b.toString('utf-8').replace(/^enc:/, ''),
      },
    });
    assert.equal(await reloadedBridge.getToken(), 'figd_keychain_ok');

    // SSRF guard on fetchImage: rejects http:// and private/loopback hosts
    const blockedHttp = await reloadedBridge.fetchImage({ url: 'http://example.com/a.png' });
    assert.equal(blockedHttp.ok, false);
    const blockedLocal = await reloadedBridge.fetchImage({ url: 'https://127.0.0.1/a.png' });
    assert.equal(blockedLocal.ok, false);

    // Web fallback never writes plaintext to window.localStorage
    if ((globalThis as any).window?.localStorage) {
      (globalThis as any).window.localStorage.setItem('protoflow.figma.pat.v1', 'legacy_web_secret');
      const webSave = await saveFigmaToken('figd_session_only');
      assert.equal(webSave.persisted, false);
      assert.equal((globalThis as any).window.localStorage.getItem('protoflow.figma.pat.v1'), null, 'Legacy localStorage token scrubbed');
      assert.equal(await loadSavedFigmaToken(), 'figd_session_only');
      await saveFigmaToken('');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 3. Online REST API image fills download bytes into data:image/png;base64,... instead of keeping expiring S3 URLs
  const tinyPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x04]);
  const expiringS3Url = 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/ref-banner-1?X-Amz-Expires=1209600';
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/images')) {
      return new Response(
        JSON.stringify({ meta: { images: { 'ref-ok': expiringS3Url, 'ref-expired': 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/403' } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('api.figma.com/v1/files/')) {
      return new Response(
        JSON.stringify({
          name: 'Online Marketing Deck',
          version: '99',
          document: {
            id: '0:0',
            type: 'DOCUMENT',
            children: [
              {
                id: '1:1',
                type: 'CANVAS',
                name: 'Landing',
                children: [
                  {
                    id: '2:1',
                    type: 'FRAME',
                    name: 'Promo Screen',
                    absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 720 },
                    children: [
                      {
                        id: '2:2',
                        type: 'RECTANGLE',
                        name: 'Hero Banner',
                        absoluteBoundingBox: { x: 24, y: 24, width: 600, height: 280 },
                        fills: [{ type: 'IMAGE', imageRef: 'ref-ok', scaleMode: 'FILL' }],
                      },
                      {
                        id: '2:3',
                        type: 'RECTANGLE',
                        name: 'Expired Asset',
                        absoluteBoundingBox: { x: 24, y: 320, width: 200, height: 120 },
                        fills: [{ type: 'IMAGE', imageRef: 'ref-expired', scaleMode: 'FIT' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === expiringS3Url) {
      return new Response(tinyPngBytes, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('Forbidden', { status: 403 });
  };

  const onlineDoc = await fetchFigmaDocumentFromUrl(
    'https://www.figma.com/design/KeyOnlineImg123456789/Marketing',
    'figd_test_token',
    { fetchImpl: mockFetch },
  );
  const compiledOnline = compileFigmaSelectionToProject(onlineDoc);
  const onlinePageSrc = Object.values(compiledOnline.pageSources)[0];
  assert.ok(onlinePageSrc.includes('data:image/png;base64,'), 'Valid remote image is embedded as base64 data URI');
  assert.ok(!onlinePageSrc.includes('amazonaws.com'), 'Temporary expiring S3 URL is never written into .pflow source');
  assert.ok(onlineDoc.warnings.some((w) => w.includes('未能内嵌')), 'Failed/expired image records a clear warning');
});

test('Review regressions: AI prompt isolation, MCP single-page scope enforcement, and follow-up scope persistence', () => {
  // 1. Ordinary shared project instructions must NOT contain Figma reshape workflow instructions
  const sharedPrompt = buildProjectSharedInstructions();
  assert.ok(!sharedPrompt.includes('protoflow_inspect_figma_project'), 'Global shared prompt is free of Figma inspection rules');
  assert.ok(!sharedPrompt.includes('protoflow_reshape_figma_page'), 'Global shared prompt is free of Figma reshape rules');

  const scopedPrompt = buildFigmaMigrationInstructions({
    scope: { kind: 'page', pageId: 'fig-page-11223344aabbccdd' },
    readOnly: false,
  });
  assert.ok(scopedPrompt.includes('fig-page-11223344aabbccdd'));
  assert.ok(scopedPrompt.includes('protoflow_reshape_figma_page'));

  // 2. MCP protoflow_inspect_figma_project & write gates strictly enforce snapshot.figmaMigrationScope
  const archive = buildSyntheticFigZipArchive();
  const doc = importFigmaBinary(archive, 'ScopeCheck.fig');
  const compiled = compileFigmaSelectionToProject(doc);
  const payload = createFigmaProject('ScopeCheck', '/tmp', compiled);
  const desktopPage = compiled.designerPages.find((p) => p.platform === 'desktop')!;
  const mobilePage = compiled.designerPages.find((p) => p.platform === 'mobile')!;

  const { callTool, atomicWrite } = cjsRequire(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
  const tmpMcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-mcp-'));
  const ctxFile = path.join(tmpMcpDir, 'context.json');
  try {
    const baseContext = {
      kind: 'project',
      workflowPhase: 'conversation',
      active: true,
      projectId: payload.meta.projectId,
      runId: 'run-fig-scope-1',
      operations: [],
      snapshot: {
        ...payload.stateSnapshot,
        projectMode: payload.meta.projectMode,
        figmaMigrationScope: { kind: 'page', pageId: desktopPage.pageId },
      },
    };
    atomicWrite(ctxFile, baseContext);

    // Default call with {} must inspect ONLY the 1 scoped page (not all 2 pages!)
    const singleInv = callTool(ctxFile, 'protoflow_inspect_figma_project', {});
    assert.equal(singleInv.totalPages, 1, 'Single-page figmaMigrationScope returns only 1 page');
    assert.equal(singleInv.records.length, 1);
    assert.equal(singleInv.records[0].pageId, desktopPage.pageId);

    // Passing an out-of-scope pageId to inspect_figma_project must throw
    assert.throws(
      () => callTool(ctxFile, 'protoflow_inspect_figma_project', { pageId: mobilePage.pageId }),
      /超出本次选择/,
    );

    // Read project schema catalog first, then verify out-of-scope reshape & arbitrary apply_tsx_patch are blocked
    callTool(ctxFile, 'protoflow_get_project', {});
    assert.throws(
      () =>
        callTool(ctxFile, 'protoflow_reshape_figma_page', {
          pageId: mobilePage.pageId,
          source: 'export default function Page() { return <MobilePage pfId="m-root" title="M"><MTopBar pfId="mt" title="M" /></MobilePage>; }',
          coverage: { converted: [], pending: [] },
        }),
      /超出本次 Figma 重构范围/,
    );
    assert.throws(
      () =>
        callTool(ctxFile, 'protoflow_apply_tsx_patch', {
          pageId: desktopPage.pageId,
          source: payload.stateSnapshot.pageSources[desktopPage.pageId],
        }),
      /Figma 重构任务只允许/,
    );
  } finally {
    fs.rmSync(tmpMcpDir, { recursive: true, force: true });
  }

  // 3. Answering clarifying questions preserves figmaQuestionScope across chat persistence & submission
  const chatIndex = useAiChatStore.getState().loadProjectIndex('proj-fig-q');
  const chatScope = projectChatScope('proj-fig-q', chatIndex.activeId);
  const key = conversationKey(chatScope);
  useAiChatStore.getState().switchConversation(chatScope);
  useAiChatStore.getState().addMessage({
    ...chatScope,
    role: 'assistant',
    status: 'done',
    text: '请确认订单表主键粒度：',
    projectQuestions: [
      {
        question: '订单列表是否包含拆单子单？',
        options: ['仅主订单一行', '按子单拆分'],
      },
    ],
    figmaQuestionScope: { kind: 'page', pageId: desktopPage.pageId },
  });
  // Reload from localStorage to verify validMessage accepts figmaQuestionScope
  useAiChatStore.setState((s) => {
    const next = { ...s.byConversation };
    delete next[key];
    return { byConversation: next };
  });
  useAiChatStore.getState().switchConversation(chatScope);
  const reloadedMsg = useAiChatStore.getState().byConversation[key]?.at(-1);
  assert.deepEqual(reloadedMsg?.figmaQuestionScope, { kind: 'page', pageId: desktopPage.pageId });

  // Follow-up submit without an active draft.figmaTask restores scope from figmaQuestionScope
  const restored = resolveSubmittedFigmaMigration(undefined, reloadedMsg?.figmaQuestionScope);
  assert.deepEqual(restored, {
    scope: { kind: 'page', pageId: desktopPage.pageId },
    readOnly: false,
  });

  // 4. Draft task switching: applying Figma task then resetting via starter template clears figmaTask
  const withFigma = applyFigmaTaskDraft(
    { text: '', figmaTask: undefined, rpTask: undefined },
    { kind: 'page', pageId: desktopPage.pageId },
    '订单管理工作台',
    false,
  );
  assert.ok(withFigma.figmaTask);
  const clearedForTemplate = { ...clearFigmaTaskDraft(withFigma), text: '普通模板提示词', rpTask: undefined, figmaTask: undefined };
  assert.equal(clearedForTemplate.figmaTask, undefined);
});

test('End-to-end Figma AI workflow: ordinary chat stays clean, single-page scope survives clarifying questions and reshapes cleanly', async () => {
  const archive = buildSyntheticFigZipArchive();
  const doc = importFigmaBinary(archive, 'WorkflowE2E.fig');
  const compiled = compileFigmaSelectionToProject(doc);
  const payload = createFigmaProject('WorkflowE2E', '/tmp', compiled);
  const projectId = payload.meta.projectId;
  const desktopPage = compiled.designerPages.find((p) => p.platform === 'desktop')!;
  const mobilePage = compiled.designerPages.find((p) => p.platform === 'mobile')!;

  loadProjectFromBinaryPayload(payload);
  useHermesStore.setState({ status: 'running', sessions: {}, runningProjects: {}, cancelGeneration: {}, partial: {} });

  const { callTool, atomicWrite, tools: mcpTools } = cjsRequire(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
  const registeredToolNames = mcpTools.map((t: { name: string }) => t.name);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-e2e-'));
  const prevDesktop = ((globalThis as any).window as any).protoflowDesktop;
  const listeners = new Set<(event: any) => void>();
  let capturedInputs: any[] = [];
  let currentHandler: (ctxFile: string, input: any) => void = () => {};

  try {
    ((globalThis as any).window as any).protoflowDesktop = {
      hermes: {
        onEvent: (fn: (event: any) => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        session: async (sc: any) => ({
          ...sc,
          sessionId: 's-fig-e2e',
          running: false,
          projectTools: registeredToolNames,
          models: { currentModelId: 'm-fig', availableModels: [] },
        }),
        sync: async () => ({ synced: true }),
        execute: async (input: any) => {
          capturedInputs.push(input);
          const taskKey = conversationKey(input);
          const runId = 'run-' + Math.random().toString(36).slice(2, 8);
          const baseEvt = {
            projectId: input.projectId,
            kind: input.kind,
            ...(input.threadId ? { threadId: input.threadId } : {}),
            sessionId: 's-fig-e2e',
            planningSessionId: 's-fig-e2e',
            execSessionId: 's-fig-e2e',
            taskKey,
            clientRequestId: input.clientRequestId,
            runId,
          };
          listeners.forEach((fn) => fn({ type: 'run-start', ...baseEvt }));
          const ctxFile = path.join(tmpDir, `${runId}.json`);
          atomicWrite(ctxFile, {
            kind: 'project',
            workflowPhase: input.workflowPhase,
            active: true,
            projectId: input.projectId,
            sessionId: 's-fig-e2e',
            runId,
            contextFocus: input.contextFocus ?? {},
            operations: [],
            snapshot: structuredClone(input.snapshot),
          });
          try {
            currentHandler(ctxFile, input);
            const finalCtx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
            return {
              text: '已完成处理。',
              operations: finalCtx.operations,
              dependencyFootprint: finalCtx.dependencyFootprint,
              sessionId: 's-fig-e2e',
              planningSessionId: 's-fig-e2e',
              execSessionId: 's-fig-e2e',
              taskKey,
              clientRequestId: input.clientRequestId,
              runId,
              modelId: 'm-fig',
            };
          } finally {
            listeners.forEach((fn) => fn({ type: 'run-end', ...baseEvt }));
          }
        },
        cancel: async () => {},
      },
    };

    const activeThreadKey = () =>
      conversationKey(projectChatScope(projectId, useAiChatStore.getState().loadProjectIndex(projectId).activeId));

    // Turn 0: Ordinary chat turn does NOT inject Figma reshape rules or figmaMigrationScope
    currentHandler = (ctxFile) => {
      callTool(ctxFile, 'protoflow_get_project_brief', {});
    };
    await discussProject(projectId, '帮我介绍一下当前工程有哪些目录？', [], []);
    assert.equal(capturedInputs.length, 1);
    assert.equal(capturedInputs[0].snapshot.figmaMigrationScope, undefined);
    assert.ok(!String(capturedInputs[0].prompt).includes('Figma 画板重构专项规则'));

    // Turn 1: Single-page Figma reshape task asks a clarifying question -> persists figmaQuestionScope
    let turn1InspectedCount = -1;
    currentHandler = (ctxFile) => {
      callTool(ctxFile, 'protoflow_get_project_brief', {});
      const inv = callTool(ctxFile, 'protoflow_inspect_figma_project', {});
      turn1InspectedCount = inv.totalPages;
      callTool(ctxFile, 'protoflow_ask_questions', {
        questions: [
          {
            question: '订单状态筛选是否需要默认选中待处理？',
            options: ['默认显示全部', '默认筛选待处理'],
          },
        ],
      });
    };
    await discussProject(
      projectId,
      '重塑桌面端订单管理画板',
      [],
      [],
      { pageId: desktopPage.pageId },
      undefined,
      undefined,
      { scope: { kind: 'page', pageId: desktopPage.pageId }, readOnly: false },
    );
    assert.equal(turn1InspectedCount, 1, 'Single-page turn inspects only 1 scoped Figma page');
    assert.ok(String(capturedInputs[1].prompt).includes('Figma 画板重构专项规则'));
    const qMsg = useAiChatStore.getState().byConversation[activeThreadKey()]!.at(-1)!;
    assert.deepEqual(qMsg.figmaQuestionScope, { kind: 'page', pageId: desktopPage.pageId });

    // Turn 2: Follow-up answer restores figmaMigration from qMsg.figmaQuestionScope and reshapes only desktopPage
    const restoredMigration = resolveSubmittedFigmaMigration(undefined, qMsg.figmaQuestionScope);
    assert.ok(restoredMigration);
    currentHandler = (ctxFile) => {
      callTool(ctxFile, 'protoflow_get_project_brief', {});
      const inv = callTool(ctxFile, 'protoflow_inspect_figma_project', {});
      assert.equal(inv.totalPages, 1, 'Follow-up turn still locks inspection to the 1 selected page');
      assert.throws(
        () => callTool(ctxFile, 'protoflow_inspect_figma_project', { pageId: mobilePage.pageId }),
        /超出本次选择/,
      );
      const pageEv = callTool(ctxFile, 'protoflow_inspect_page', {
        pageId: desktopPage.pageId,
        view: 'figma',
        limit: 20,
      });
      callTool(ctxFile, 'protoflow_get_project', {});
      callTool(ctxFile, 'protoflow_upsert_db_table', {
        table: {
          id: 't_fig_orders',
          tableName: 't_orders',
          cnName: '订单主表',
          domain: '交易域',
          description: '订单管理列表主表',
          modeling: { entity: '销售订单', grain: '一单一行', reason: '承接订单管理工作台查询与列表' },
          sharedByMenus: [],
          columns: [
            { id: 'c_id', name: 'id', dataType: 'VARCHAR(32)', nullable: false, isPrimaryKey: true, comment: '主键' },
            { id: 'c_no', name: 'order_no', dataType: 'VARCHAR(32)', nullable: false, comment: '订单编号' },
          ],
        },
      });
      callTool(ctxFile, 'protoflow_reshape_figma_page', {
        pageId: desktopPage.pageId,
        source: [
          'export default function Page() {',
          '  return (',
          '    <Page pfId="p-fig-orders" title="订单管理工作台（重构版）">',
          '      <PageHeader pfId="ph-orders" title="订单管理工作台" />',
          '      <Card pfId="card-orders" title="订单台账">',
          '        <QueryForm pfId="qf-orders" target="tbl-orders" fields={[{ name: "order_no", label: "订单号" }]} />',
          '        <Table pfId="tbl-orders" table="t_fig_orders" columns={[{ title: "订单编号", dataIndex: "order_no" }]} />',
          '      </Card>',
          '    </Page>',
          '  );',
          '}',
        ].join('\n'),
        coverage: {
          converted: [
            {
              sourcePfIds: [pageEv.nodes[0].pfId],
              targetPfId: 'tbl-orders',
              summary: '订单管理列表重构',
              tableId: 't_fig_orders',
            },
          ],
          pending: [],
        },
      });
    };
    await discussProject(
      projectId,
      '1. 针对「订单状态筛选是否需要默认选中待处理？」：默认显示全部',
      [],
      [],
      { pageId: desktopPage.pageId },
      undefined,
      undefined,
      restoredMigration,
    );
    assert.deepEqual(capturedInputs[2].snapshot.figmaMigrationScope, { kind: 'page', pageId: desktopPage.pageId });
    assert.ok(String(capturedInputs[2].prompt).includes('Figma 画板重构专项规则'));

    const reviewMsg = useAiChatStore.getState().byConversation[activeThreadKey()]!.at(-1)!;
    assert.ok(reviewMsg.projectChangeReview, 'Turn 2 produces a projectChangeReview card');
    await resolveProjectReview(projectId, reviewMsg.id, true);

    const optPageId = figmaCopyId(desktopPage.pageId);
    assert.ok(usePageStore.getState().pageSources[optPageId]?.includes('<QueryForm'), 'Optimized Figma page committed');
    assert.ok(usePageStore.getState().pageSources[desktopPage.pageId]?.includes('<FigmaCanvas'), 'Original Figma source page preserved');
  } finally {
    ((globalThis as any).window as any).protoflowDesktop = prevDesktop;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Second-pass review regressions (all 8 findings): pre-redirect SSRF, async safeStorage, CardGrid filter, MCP inspect_page scope, image budget/index/streaming, and uncheck-close token cleanup', async () => {
  const { createFigmaBridge } = cjsRequire(path.join(process.cwd(), 'electron/figma-bridge.cjs'));
  const tinyPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x04]);

  // 1. [P1] Desktop image download validates redirect targets & DNS BEFORE sending any HTTP request
  const tmpBridgeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-r2-'));
  try {
    const requestedUrls: string[] = [];
    const redirectBridge = createFigmaBridge({
      dataDir: tmpBridgeDir,
      fetchImpl: async (url: string, init?: RequestInit) => {
        assert.equal(init?.redirect, 'manual', 'Must use manual redirect mode');
        requestedUrls.push(String(url));
        if (String(url) === 'https://cdn.example.com/redirect-to-loopback') {
          return new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1:8080/internal-admin' },
          });
        }
        if (String(url) === 'https://cdn.example.com/redirect-to-lan') {
          return new Response(null, {
            status: 307,
            headers: { location: 'https://192.168.1.20/private.png' },
          });
        }
        if (String(url) === 'https://cdn.example.com/redirect-to-valid-s3') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://s3.us-west-2.amazonaws.com/public/ok.png' },
          });
        }
        if (String(url) === 'https://s3.us-west-2.amazonaws.com/public/ok.png') {
          return new Response(tinyPngBytes, { status: 200, headers: { 'content-type': 'image/png' } });
        }
        return new Response('Not Found', { status: 404 });
      },
    });

    const loopRes = await redirectBridge.fetchImage({ url: 'https://cdn.example.com/redirect-to-loopback' });
    assert.equal(loopRes.ok, false);
    assert.ok(
      !requestedUrls.some((u) => u.includes('127.0.0.1')),
      'Loopback redirect target must NEVER be requested',
    );

    const lanRes = await redirectBridge.fetchImage({ url: 'https://cdn.example.com/redirect-to-lan' });
    assert.equal(lanRes.ok, false);
    assert.ok(
      !requestedUrls.some((u) => u.includes('192.168.1.20')),
      'Private LAN redirect target must NEVER be requested',
    );

    const validRedirectRes = await redirectBridge.fetchImage({ url: 'https://cdn.example.com/redirect-to-valid-s3' });
    assert.equal(validRedirectRes.ok, true);
    assert.ok(validRedirectRes.dataUri.startsWith('data:image/png;base64,'));

    // DNS rebinding guard: hostname resolving to 127.0.0.1 is blocked before fetchImpl runs
    let dnsFetchCalled = false;
    const dnsRebindBridge = createFigmaBridge({
      dataDir: tmpBridgeDir,
      lookupHost: async () => [{ address: '127.0.0.1', family: 4 }],
      fetchImpl: async () => {
        dnsFetchCalled = true;
        return new Response(tinyPngBytes, { status: 200 });
      },
    });
    const dnsBlocked = await dnsRebindBridge.fetchImage({ url: 'https://evil-rebind.example.com/a.png' });
    assert.equal(dnsBlocked.ok, false);
    assert.equal(dnsFetchCalled, false, 'Must not send HTTP request when DNS resolves to loopback/private IP');

    // Also test real https.request socket-pinned lookup path (without custom fetchImpl)
    const pinnedDnsBridge = createFigmaBridge({
      dataDir: tmpBridgeDir,
      lookupHost: async () => [{ address: '10.1.2.3', family: 4 }],
    });
    const pinnedDnsBlocked = await pinnedDnsBridge.fetchImage({ url: 'https://rebind-socket.example.com/a.png' });
    assert.equal(pinnedDnsBlocked.ok, false);
    assert.match(String(pinnedDnsBlocked.error), /non-public IP/);

    // 2. [P2] Electron async safeStorage contract: decryptStringAsync resolves to { result, shouldReEncrypt }
    let encryptCount = 0;
    const asyncSafeStorage = {
      getSelectedStorageBackend: () => 'gnome_libsecret' as const,
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plain: string) => {
        encryptCount++;
        return Buffer.from(`v${encryptCount}:${plain}`, 'utf-8');
      },
      decryptStringAsync: async (buf: Buffer) => {
        const text = buf.toString('utf-8');
        const colon = text.indexOf(':');
        return {
          result: colon >= 0 ? text.slice(colon + 1) : text,
          shouldReEncrypt: text.startsWith('v1:'),
        };
      },
    };
    const writerBridge = createFigmaBridge({ dataDir: tmpBridgeDir, safeStorage: asyncSafeStorage });
    const saveAsyncRes = await writerBridge.setToken('figd_async_contract_token');
    assert.equal(saveAsyncRes.persisted, true);

    // Fresh instance simulates app restart reading from disk via decryptStringAsync -> { result, shouldReEncrypt }
    const readerBridge = createFigmaBridge({ dataDir: tmpBridgeDir, safeStorage: asyncSafeStorage });
    const readBackToken = await readerBridge.getToken();
    assert.equal(readBackToken, 'figd_async_contract_token', 'decryptStringAsync({ result }) must return exact saved token');
    assert.equal(encryptCount, 2, 'shouldReEncrypt: true rotates ciphertext transparently');
  } finally {
    fs.rmSync(tmpBridgeDir, { recursive: true, force: true });
  }

  // 3. [P2] CardGrid static filter uses exact matching while runtimeFilter keeps substring query semantics
  const sampleCardRows = [
    { id: '1', title: 'Alpha', status: 'Active', enabled: true, parent_id: null, remark: '' },
    { id: '10', title: 'Beta', status: 'Inactive', enabled: false, parent_id: '1', remark: 'archived' },
    { id: '2', title: 'Gamma', status: 'active', enabled: undefined, parent_id: undefined, remark: 'draft' },
  ] as any[];
  assert.deepEqual(
    filterCardRows(sampleCardRows, { status: 'Active' }).map((r) => r.id),
    ['1'],
    'Static filter status="Active" must NOT match "Inactive" or lowercase "active"',
  );
  assert.deepEqual(
    filterCardRows(sampleCardRows, { id: '1' }).map((r) => r.id),
    ['1'],
    'Static filter id="1" must NOT match id="10"',
  );
  assert.deepEqual(
    filterCardRows(sampleCardRows, { enabled: true }).map((r) => r.id),
    ['1'],
    'Static filter enabled=true must NOT match false or undefined',
  );
  assert.deepEqual(
    filterCardRows(sampleCardRows, { parent_id: null }).map((r) => r.id),
    ['1'],
    'Static filter parent_id=null matches ONLY explicit null foreign keys (matching Table)',
  );
  assert.deepEqual(
    filterCardRows(sampleCardRows, { remark: '' }).map((r) => r.id),
    ['1'],
    'Static filter remark="" filters to empty-string records instead of returning all rows',
  );
  assert.deepEqual(
    filterCardRows(sampleCardRows, { parent_id: null }, { __keyword: 'alp' }).map((r) => r.id),
    ['1'],
    'Runtime keyword search still performs case-insensitive substring matching on top of static filter',
  );

  // 4. [P2] MCP protoflow_inspect_page(view="figma") & protoflow_get_page_tsx block out-of-scope Figma frames
  const archive = buildSyntheticFigZipArchive();
  const figDoc = importFigmaBinary(archive, 'InspectScope.fig');
  const compiled = compileFigmaSelectionToProject(figDoc);
  const payload = createFigmaProject('InspectScope', '/tmp', compiled);
  const desktopPage = compiled.designerPages.find((p) => p.platform === 'desktop')!;
  const mobilePage = compiled.designerPages.find((p) => p.platform === 'mobile')!;
  const { callTool, atomicWrite } = cjsRequire(path.join(process.cwd(), 'electron/protoflow-mcp.cjs'));
  const tmpMcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-mcp-r2-'));
  const ctxFile = path.join(tmpMcpDir, 'context.json');
  try {
    atomicWrite(ctxFile, {
      kind: 'project',
      workflowPhase: 'conversation',
      active: true,
      projectId: payload.meta.projectId,
      runId: 'run-fig-r2',
      operations: [],
      snapshot: {
        ...payload.stateSnapshot,
        projectMode: payload.meta.projectMode,
        figmaMigrationScope: { kind: 'page', pageId: desktopPage.pageId },
      },
    });
    const inScopeLayers = callTool(ctxFile, 'protoflow_inspect_page', {
      pageId: desktopPage.pageId,
      view: 'figma',
    });
    assert.ok(inScopeLayers.nodes.length > 0);
    assert.throws(
      () => callTool(ctxFile, 'protoflow_inspect_page', { pageId: mobilePage.pageId, view: 'figma' }),
      /超出本次选择/,
      'inspect_page(view=figma) must reject out-of-scope Figma page',
    );
    assert.throws(
      () => callTool(ctxFile, 'protoflow_inspect_page', { pageId: mobilePage.pageId }),
      /超出本次选择/,
      'inspect_page without view must also reject out-of-scope Figma page',
    );
    assert.throws(
      () => callTool(ctxFile, 'protoflow_get_page_tsx', { pageId: mobilePage.pageId }),
      /超出本次选择/,
      'get_page_tsx must also reject out-of-scope Figma page',
    );
  } finally {
    fs.rmSync(tmpMcpDir, { recursive: true, force: true });
  }

  // 5. [P2] Repeated reuse of the same imageRef charges total budget per node placement
  const makeRepeatedImageFile = () => ({
    name: 'Repeated Image Budget Deck',
    version: '1',
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [
        {
          id: '1:1',
          type: 'CANVAS',
          name: 'Gallery',
          children: [
            {
              id: '2:1',
              type: 'FRAME',
              name: 'Gallery Frame',
              absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 800 },
              children: Array.from({ length: 5 }, (_, i) => ({
                id: `2:${10 + i}`,
                type: 'RECTANGLE',
                name: `Card Cover ${i + 1}`,
                absoluteBoundingBox: { x: i * 120, y: 20, width: 100, height: 100 },
                fills: [{ type: 'IMAGE', imageRef: 'ref-shared', scaleMode: 'FILL' }],
              })),
            },
          ],
        },
      ],
    },
  });

  // tinyPngBytes is 12 bytes -> budget of 30 bytes fits exactly 2 placements (24 bytes) and must omit the remaining 3!
  const budgetDoc = await fetchFigmaDocumentFromUrl(
    'https://www.figma.com/design/KeyBudgetTest123456789/Gallery',
    'figd_test',
    {
      maxEmbeddedImageBudget: 30,
      fetchImpl: async (input) => {
        const u = String(input);
        if (u.endsWith('/images')) {
          return new Response(
            JSON.stringify({ meta: { images: { 'ref-shared': 'https://s3.us-west-2.amazonaws.com/img/shared.png' } } }),
            { status: 200 },
          );
        }
        if (u.includes('api.figma.com/v1/files/')) {
          return new Response(JSON.stringify(makeRepeatedImageFile()), { status: 200 });
        }
        return new Response(tinyPngBytes, { status: 200 });
      },
    },
  );
  const galleryChildren = budgetDoc.canvases[0].frames[0].rootNode.children ?? [];
  const embeddedCount = galleryChildren.filter((n) => n.imageSrc?.startsWith('data:image/png;base64,')).length;
  const omittedNodes = galleryChildren.filter((n) => n.imageSrc === undefined).length;
  assert.equal(embeddedCount, 2, 'Only 2 placements fit within 30-byte total embedded budget');
  assert.equal(omittedNodes, 3, 'Remaining 3 placements of the same imageRef are omitted to protect total budget');
  assert.ok(budgetDoc.warnings.some((w) => w.includes('3 处在线图片未能内嵌')));

  // 6. [P2] /images index request failure surfaces an explicit warning instead of silently dropping all images
  const indexFailDoc = await fetchFigmaDocumentFromUrl(
    'https://www.figma.com/design/KeyIndexFail1234567890/Gallery',
    'figd_test',
    {
      fetchImpl: async (input) => {
        const u = String(input);
        if (u.endsWith('/images')) {
          return new Response('Service Unavailable', { status: 503 });
        }
        return new Response(JSON.stringify(makeRepeatedImageFile()), { status: 200 });
      },
    },
  );
  assert.ok(
    indexFailDoc.warnings.some((w) => w.includes('图片下载地址索引获取失败') && w.includes('5 处图片')),
    'Image index failure must record an explicit document warning',
  );
  assert.ok(
    indexFailDoc.canvases[0].frames[0].warnings.length === 5,
    'Each affected frame image layer records a warning when /images fails',
  );

  // 7. [P2] Web image download aborts oversized chunked stream BEFORE reading full image into memory
  let chunksPulled = 0;
  const streamLimitDoc = await fetchFigmaDocumentFromUrl(
    'https://www.figma.com/design/KeyStreamCap1234567890/Stream',
    'figd_test',
    {
      maxEmbeddedImageBudget: 4096, // 4 KiB budget
      fetchImpl: async (input) => {
        const u = String(input);
        if (u.endsWith('/images')) {
          return new Response(
            JSON.stringify({ meta: { images: { 'ref-shared': 'https://s3.us-west-2.amazonaws.com/img/huge-stream.png' } } }),
            { status: 200 },
          );
        }
        if (u.includes('api.figma.com/v1/files/')) {
          const singleImg = makeRepeatedImageFile();
          singleImg.document.children[0].children[0].children = [singleImg.document.children[0].children[0].children[0]];
          return new Response(JSON.stringify(singleImg), { status: 200 });
        }
        // Stream 20 chunks of 1024 bytes (20 KiB total) WITHOUT Content-Length header
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            chunksPulled++;
            if (chunksPulled > 20) {
              controller.close();
              return;
            }
            const chunk = new Uint8Array(1024);
            if (chunksPulled === 1) chunk.set(tinyPngBytes, 0);
            controller.enqueue(chunk);
          },
        });
        return new Response(stream, { status: 200 });
      },
    },
  );
  assert.ok(chunksPulled <= 6, `Oversized stream must abort early (pulled ${chunksPulled} chunks instead of all 20)`);
  assert.equal(streamLimitDoc.canvases[0].frames[0].rootNode.children?.[0].imageSrc, undefined);

  // 8. [P2] Unchecking "Remember token" in FigmaImportDialog and closing without submitting clears saved token
  const prevDesktop = ((globalThis as any).window as any).protoflowDesktop;
  const tmpDialogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-dlg-'));
  try {
    const dlgBridge = createFigmaBridge({
      dataDir: tmpDialogDir,
      safeStorage: {
        getSelectedStorageBackend: () => 'keychain',
        isAsyncEncryptionAvailable: async () => true,
        encryptStringAsync: async (s: string) => Buffer.from(`k:${s}`, 'utf-8'),
        decryptStringAsync: async (b: Buffer) => ({
          result: b.toString('utf-8').replace(/^k:/, ''),
          shouldReEncrypt: false,
        }),
      },
    });
    await dlgBridge.setToken('figd_persisted_before_open');
    assert.equal(fs.existsSync(dlgBridge.settingsFile), true);

    ((globalThis as any).window as any).protoflowDesktop = {
      isElectron: true,
      figma: {
        getToken: () => dlgBridge.getToken(),
        setToken: (tok: string) => dlgBridge.setToken(tok),
        fetchJson: (inp: any) => dlgBridge.fetchJson(inp),
        fetchImage: (inp: any) => dlgBridge.fetchImage(inp),
      },
    };

    let dialogRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      dialogRenderer = TestRenderer.create(
        <FigmaImportDialog initialTab="url" onClose={() => {}} />,
        {
          createNodeMock: (element) => {
            if (element.type === 'dialog') {
              return { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
            }
            return null;
          },
        },
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const passwordInput = dialogRenderer.root.find((n) => n.type === 'input' && n.props.type === 'password');
    assert.equal(passwordInput.props.value, 'figd_persisted_before_open', 'Dialog loads saved token on mount');

    const checkbox = dialogRenderer.root.find((n) => n.type === 'input' && n.props.type === 'checkbox');
    assert.equal(checkbox.props.checked, true);

    // User unchecks "Remember token" and immediately closes dialog WITHOUT submitting form
    await act(async () => {
      checkbox.props.onChange({ target: { checked: false } });
      await Promise.resolve();
    });
    act(() => {
      dialogRenderer.unmount();
    });
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(fs.existsSync(dlgBridge.settingsFile), false, 'Encrypted token file removed immediately upon uncheck + close');
    assert.equal(await loadSavedFigmaToken(), '', 'Saved token cleared from memory and disk');
  } finally {
    ((globalThis as any).window as any).protoflowDesktop = prevDesktop;
    fs.rmSync(tmpDialogDir, { recursive: true, force: true });
  }
});

test('Third-pass review regressions (all 7 findings): byte-level IPv6 SSRF, token race & unlink error, selection-scoped & exact image budget, publish cap, and Table/CardGrid null-FK parity', async () => {
  const {
    createFigmaBridge,
    isPrivateOrLocalHostname,
  } = cjsRequire(path.join(process.cwd(), 'electron/figma-bridge.cjs'));
  const png12Bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x04]); // 12 raw -> 38 chars Data URI
  const png4Bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // 4 raw -> 30 chars Data URI

  // 1. [P1] Byte-level IPv4/IPv6 classifier catches WHATWG hex-serialized IPv4-mapped IPv6, NAT64, 6to4, and DNS AAAA records
  for (const blockedUrl of [
    'https://[::ffff:127.0.0.1]/a.png', // WHATWG URL serializes hostname to [::ffff:7f00:1]
    'https://[::ffff:7f00:1]/a.png',
    'https://[::ffff:10.0.0.8]/a.png', // [::ffff:a00:8]
    'https://[::ffff:172.16.5.4]/a.png', // [::ffff:ac10:504]
    'https://[::ffff:192.168.1.1]/a.png', // [::ffff:c0a8:101]
    'https://[::ffff:169.254.169.254]/a.png', // [::ffff:a9fe:a9fe]
    'https://[::ffff:100.64.0.1]/a.png', // CGNAT mapped
    'https://[64:ff9b::127.0.0.1]/a.png', // RFC 6052 NAT64 loopback
    'https://[2002:7f00:0001::1]/a.png', // 6to4 loopback
    'https://[::1]/a.png',
    'https://[::]/a.png',
    'https://[fe80::1]/a.png',
    'https://[fd00::1]/a.png',
  ]) {
    const u = new URL(blockedUrl);
    assert.equal(
      isPrivateOrLocalHostname(u.hostname),
      true,
      `Expected ${blockedUrl} (normalized hostname ${u.hostname}) to be classified as non-public`,
    );
  }
  // Public IPv4, public IPv6, and IPv4-mapped public IP remain allowed
  assert.equal(isPrivateOrLocalHostname(new URL('https://[::ffff:8.8.8.8]/a.png').hostname), false);
  assert.equal(isPrivateOrLocalHostname('[2606:4700:4700::1111]'), false);
  assert.equal(isPrivateOrLocalHostname('93.184.216.34'), false);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-r3-'));
  try {
    // Verify redirect to https://[::ffff:127.0.0.1]/... and DNS returning ::ffff:7f00:1 never issue HTTP requests
    const hitUrls: string[] = [];
    const ipv6Bridge = createFigmaBridge({
      dataDir: tmpDir,
      fetchImpl: async (url: string) => {
        hitUrls.push(String(url));
        if (String(url) === 'https://cdn.example.com/hop-mapped-v6') {
          return new Response(null, { status: 302, headers: { location: 'https://[::ffff:127.0.0.1]/secret.png' } });
        }
        return new Response(png12Bytes, { status: 200 });
      },
    });
    const hopMappedRes = await ipv6Bridge.fetchImage({ url: 'https://cdn.example.com/hop-mapped-v6' });
    assert.equal(hopMappedRes.ok, false);
    assert.deepEqual(hitUrls, ['https://cdn.example.com/hop-mapped-v6'], 'Redirect to [::ffff:7f00:1] never requested');

    let aaaaFetchCalled = false;
    const aaaaBridge = createFigmaBridge({
      dataDir: tmpDir,
      lookupHost: async () => [{ address: '::ffff:7f00:1', family: 6 }],
      fetchImpl: async () => {
        aaaaFetchCalled = true;
        return new Response(png12Bytes, { status: 200 });
      },
    });
    const aaaaRes = await aaaaBridge.fetchImage({ url: 'https://dualstack.example.com/img.png' });
    assert.equal(aaaaRes.ok, false);
    assert.equal(aaaaFetchCalled, false, 'DNS AAAA ::ffff:7f00:1 blocked before fetch');

    // 2. [P2] Concurrent getToken (with shouldReEncrypt) and slow setToken cannot resurrect token after setToken('')
    let releaseDecrypt!: () => void;
    const decryptGate = new Promise<void>((resolve) => {
      releaseDecrypt = resolve;
    });
    const raceSafeStorage = {
      getSelectedStorageBackend: () => 'keychain' as const,
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (plain: string) => Buffer.from(`enc:${plain}`, 'utf-8'),
      decryptStringAsync: async (buf: Buffer) => {
        await decryptGate;
        return {
          result: buf.toString('utf-8').replace(/^enc:/, ''),
          shouldReEncrypt: true,
        };
      },
    };
    // Seed initial encrypted file on disk
    fs.writeFileSync(
      path.join(tmpDir, 'figma-settings.json'),
      JSON.stringify({ encryptedToken: Buffer.from('enc:figd_stale_inflight', 'utf-8').toString('base64') }),
      'utf-8',
    );
    const raceBridge = createFigmaBridge({ dataDir: tmpDir, safeStorage: raceSafeStorage });

    // Start getToken() on dialog open, then uncheck (setToken('')) BEFORE decryptStringAsync finishes!
    const pendingRead = raceBridge.getToken();
    const clearDuringRead = raceBridge.setToken('');
    releaseDecrypt();
    const [readOutcome, clearOutcome] = await Promise.all([pendingRead, clearDuringRead]);
    assert.equal(clearOutcome.saved, true);
    assert.equal(fs.existsSync(raceBridge.settingsFile), false, 'Stale key-rotation in getToken must NOT re-create settings file');
    assert.equal(await raceBridge.getToken(), '', 'Session and disk remain empty after concurrent clear');
    // Even if the superseded getToken resolved before/after, subsequent reads are empty
    assert.ok(readOutcome === 'figd_stale_inflight' || readOutcome === '');

    // Also test slow setToken('figd_slow') superseded by immediate setToken('')
    let releaseEncrypt!: () => void;
    const encryptGate = new Promise<void>((resolve) => {
      releaseEncrypt = resolve;
    });
    const writeRaceBridge = createFigmaBridge({
      dataDir: tmpDir,
      safeStorage: {
        getSelectedStorageBackend: () => 'keychain' as const,
        isAsyncEncryptionAvailable: async () => true,
        encryptStringAsync: async (plain: string) => {
          await encryptGate;
          return Buffer.from(`enc:${plain}`, 'utf-8');
        },
        decryptStringAsync: async (buf: Buffer) => ({
          result: buf.toString('utf-8').replace(/^enc:/, ''),
          shouldReEncrypt: false,
        }),
      },
    });
    const slowSave = writeRaceBridge.setToken('figd_slow_save');
    const immediateClear = writeRaceBridge.setToken('');
    releaseEncrypt();
    await Promise.all([slowSave, immediateClear]);
    assert.equal(fs.existsSync(writeRaceBridge.settingsFile), false, 'Superseded setToken must NOT write file after clear');
    assert.equal(await writeRaceBridge.getToken(), '');

    // Also test <FigmaImportDialog /> UI race: user unchecks "Remember token" BEFORE initial getToken() resolves
    const prevDesktopRace = ((globalThis as any).window as any).protoflowDesktop;
    try {
      let releaseUiLoad!: () => void;
      const uiLoadGate = new Promise<void>((resolve) => {
        releaseUiLoad = resolve;
      });
      const uiRaceBridge = createFigmaBridge({
        dataDir: tmpDir,
        safeStorage: {
          getSelectedStorageBackend: () => 'keychain' as const,
          isAsyncEncryptionAvailable: async () => true,
          encryptStringAsync: async (plain: string) => Buffer.from(`enc:${plain}`, 'utf-8'),
          decryptStringAsync: async (buf: Buffer) => {
            await uiLoadGate;
            return { result: buf.toString('utf-8').replace(/^enc:/, ''), shouldReEncrypt: true };
          },
        },
      });
      fs.writeFileSync(
        uiRaceBridge.settingsFile,
        JSON.stringify({ encryptedToken: Buffer.from('enc:figd_ui_inflight', 'utf-8').toString('base64') }),
        'utf-8',
      );
      ((globalThis as any).window as any).protoflowDesktop = {
        isElectron: true,
        figma: {
          getToken: () => uiRaceBridge.getToken(),
          setToken: (tok: string) => uiRaceBridge.setToken(tok),
          fetchJson: (inp: any) => uiRaceBridge.fetchJson(inp),
        },
      };
      let raceDlg!: TestRenderer.ReactTestRenderer;
      act(() => {
        raceDlg = TestRenderer.create(<FigmaImportDialog initialTab="url" onClose={() => {}} />, {
          createNodeMock: (el) =>
            el.type === 'dialog' ? { open: false, showModal() { this.open = true; }, close() { this.open = false; } } : null,
        });
      });
      // Uncheck BEFORE uiLoadGate resolves!
      const raceCb = raceDlg.root.find((n) => n.type === 'input' && n.props.type === 'checkbox');
      act(() => {
        raceCb.props.onChange({ target: { checked: false } });
      });
      releaseUiLoad();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
      const racePwd = raceDlg.root.find((n) => n.type === 'input' && n.props.type === 'password');
      assert.equal(racePwd.props.value, '', 'Late-resolving getToken must not repopulate password input after user uncheck');
      assert.equal(fs.existsSync(uiRaceBridge.settingsFile), false, 'Settings file stays deleted after late getToken resolves');
      assert.equal(await loadSavedFigmaToken(), '', 'Saved token stays empty');
      act(() => raceDlg.unmount());
    } finally {
      ((globalThis as any).window as any).protoflowDesktop = prevDesktopRace;
    }

    // 7. [P2] Unlink error (e.g. EISDIR/EPERM when settingsFile cannot be unlinked) returns saved: false and surfaces in dialog
    const errDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-figma-unlink-err-'));
    try {
      const errBridge = createFigmaBridge({ dataDir: errDir, safeStorage: raceSafeStorage });
      // Make settingsFile a non-empty directory so fs.unlinkSync fails with EISDIR/EPERM (non-ENOENT)
      fs.mkdirSync(errBridge.settingsFile, { recursive: true });
      fs.writeFileSync(path.join(errBridge.settingsFile, 'lock'), '1');
      const failedClear = await errBridge.setToken('');
      assert.equal(failedClear.saved, false, 'Non-ENOENT unlink failure must report saved: false');
      assert.ok(typeof failedClear.error === 'string' && failedClear.error.length > 0);

      const prevDesktop = ((globalThis as any).window as any).protoflowDesktop;
      try {
        ((globalThis as any).window as any).protoflowDesktop = {
          isElectron: true,
          figma: {
            getToken: async () => 'figd_locked_token',
            setToken: (tok: string) => errBridge.setToken(tok),
            fetchJson: (inp: any) => errBridge.fetchJson(inp),
          },
        };
        let errDlg!: TestRenderer.ReactTestRenderer;
        await act(async () => {
          errDlg = TestRenderer.create(<FigmaImportDialog initialTab="url" onClose={() => {}} />, {
            createNodeMock: (el) =>
              el.type === 'dialog' ? { open: false, showModal() { this.open = true; }, close() { this.open = false; } } : null,
          });
          await Promise.resolve();
          await Promise.resolve();
        });
        const cb = errDlg.root.find((n) => n.type === 'input' && n.props.type === 'checkbox');
        await act(async () => {
          cb.props.onChange({ target: { checked: false } });
          await new Promise((r) => setTimeout(r, 10));
        });
        const alertNode = errDlg.root.findByProps({ role: 'alert' });
        assert.ok(JSON.stringify(alertNode.children).length > 0, 'Unlink failure surfaces error alert in dialog');
        assert.equal(
          errDlg.root.find((n) => n.type === 'input' && n.props.type === 'checkbox').props.checked,
          true,
          'Checkbox reverts to checked when credential file could not be removed',
        );
        act(() => errDlg.unmount());
      } finally {
        ((globalThis as any).window as any).protoflowDesktop = prevDesktop;
      }
    } finally {
      fs.rmSync(errDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 3. [P2] Unselected frames do NOT consume the selected frames' image budget
  const twoFramePayload = {
    name: 'Two Frame Selection Budget',
    version: '1',
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [
        {
          id: '1:1',
          type: 'CANVAS',
          name: 'All Screens',
          children: [
            {
              id: '2:1',
              type: 'FRAME',
              name: 'Unselected Heavy Sheet',
              absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 800 },
              children: [
                {
                  id: '2:2',
                  type: 'RECTANGLE',
                  name: 'Heavy Comp Asset 1',
                  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
                  fills: [{ type: 'IMAGE', imageRef: 'ref-heavy-1', scaleMode: 'FILL' }],
                },
                {
                  id: '2:3',
                  type: 'RECTANGLE',
                  name: 'Heavy Comp Asset 2',
                  absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 300 },
                  fills: [{ type: 'IMAGE', imageRef: 'ref-heavy-2', scaleMode: 'FILL' }],
                },
              ],
            },
            {
              id: '3:1',
              type: 'FRAME',
              name: 'Selected Business Page',
              absoluteBoundingBox: { x: 0, y: 900, width: 1280, height: 800 },
              children: [
                {
                  id: '3:2',
                  type: 'RECTANGLE',
                  name: 'Business Hero',
                  absoluteBoundingBox: { x: 20, y: 20, width: 320, height: 180 },
                  fills: [{ type: 'IMAGE', imageRef: 'ref-biz', scaleMode: 'FILL' }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  let heavyFetched = false;
  const deferredDoc = await fetchFigmaDocumentFromUrl(
    'https://www.figma.com/design/KeyDeferSel1234567890/Selection',
    'figd_test',
    {
      deferImageDownload: true,
      fetchImpl: async (input) => {
        const u = String(input);
        if (u.endsWith('/images')) {
          return new Response(
            JSON.stringify({
              meta: {
                images: {
                  'ref-heavy-1': 'https://s3.us-west-2.amazonaws.com/img/h1.png',
                  'ref-heavy-2': 'https://s3.us-west-2.amazonaws.com/img/h2.png',
                  'ref-biz': 'https://s3.us-west-2.amazonaws.com/img/biz.png',
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(twoFramePayload), { status: 200 });
      },
    },
  );
  const bizFramePageId = deferredDoc.canvases[0].frames[1].pageId;
  // Budget fits ONLY 1 png12Bytes (38 encoded chars). Unselected Frame 1 has 2 images (76 chars), Selected Frame 2 has 1 image (38 chars).
  const materializedBizOnly = await materializeFigmaSelectionImages(
    deferredDoc,
    new Set([bizFramePageId]),
    {
      maxEncodedImageBudget: 40,
      fetchImpl: async (input) => {
        if (String(input).includes('h1.png') || String(input).includes('h2.png')) heavyFetched = true;
        return new Response(png12Bytes, { status: 200 });
      },
    },
  );
  const compiledBizOnly = compileFigmaSelectionToProject(materializedBizOnly, new Set([bizFramePageId]), {
    maxEncodedImageBudget: 40,
  });
  assert.equal(heavyFetched, false, 'Unselected frame images are never downloaded');
  assert.ok(
    compiledBizOnly.pageSources[bizFramePageId].includes('data:image/png;base64,'),
    'Selected second frame retains 100% of image budget and embeds its image',
  );

  // 4. [P2] Rejected repeated image placement leaves exact remaining budget for subsequent smaller image
  // png12Bytes = 38 encoded chars; png4Bytes = 30 encoded chars.
  // With maxEncodedImageBudget = 110:
  // - ref-repeat #1 -> 38 (used=38, rem=72)
  // - ref-repeat #2 -> 38 (used=76, rem=34)
  // - ref-repeat #3 -> 38 > 34 -> REJECTED (used stays 76, rem stays 34!)
  // - ref-small #1  -> 30 <= 34 -> ACCEPTED (used=106 <= 110!)
  const repeatThenSmallPayload = {
    name: 'Repeat Then Small',
    version: '1',
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [
        {
          id: '1:1',
          type: 'CANVAS',
          name: 'Main',
          children: [
            {
              id: '2:1',
              type: 'FRAME',
              name: 'Board',
              absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 800 },
              children: [
                { id: '2:10', type: 'RECTANGLE', name: 'Rep 1', absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 80 }, fills: [{ type: 'IMAGE', imageRef: 'ref-rep' }] },
                { id: '2:11', type: 'RECTANGLE', name: 'Rep 2', absoluteBoundingBox: { x: 90, y: 0, width: 80, height: 80 }, fills: [{ type: 'IMAGE', imageRef: 'ref-rep' }] },
                { id: '2:12', type: 'RECTANGLE', name: 'Rep 3', absoluteBoundingBox: { x: 180, y: 0, width: 80, height: 80 }, fills: [{ type: 'IMAGE', imageRef: 'ref-rep' }] },
                { id: '2:13', type: 'RECTANGLE', name: 'Small Tail', absoluteBoundingBox: { x: 270, y: 0, width: 40, height: 40 }, fills: [{ type: 'IMAGE', imageRef: 'ref-small' }] },
              ],
            },
          ],
        },
      ],
    },
  };
  const repeatSmallDoc = await fetchFigmaDocumentFromUrl(
    'https://www.figma.com/design/KeyRepeatSmall12345678/Board',
    'figd_test',
    {
      maxEncodedImageBudget: 110,
      fetchImpl: async (input) => {
        const u = String(input);
        if (u.endsWith('/images')) {
          return new Response(
            JSON.stringify({
              meta: {
                images: {
                  'ref-rep': 'https://s3.us-west-2.amazonaws.com/img/rep.png',
                  'ref-small': 'https://s3.us-west-2.amazonaws.com/img/small.png',
                },
              },
            }),
            { status: 200 },
          );
        }
        if (u.includes('api.figma.com/v1/files/')) {
          return new Response(JSON.stringify(repeatThenSmallPayload), { status: 200 });
        }
        if (u.endsWith('rep.png')) return new Response(png12Bytes, { status: 200 });
        return new Response(png4Bytes, { status: 200 });
      },
    },
  );
  const boardKids = repeatSmallDoc.canvases[0].frames[0].rootNode.children ?? [];
  assert.ok(boardKids[0].imageSrc?.startsWith('data:image/png;base64,'), 'Rep 1 accepted');
  assert.ok(boardKids[1].imageSrc?.startsWith('data:image/png;base64,'), 'Rep 2 accepted');
  assert.equal(boardKids[2].imageSrc, undefined, 'Rep 3 rejected over budget');
  assert.ok(
    boardKids[3].imageSrc?.startsWith('data:image/png;base64,'),
    'Trailing small image fits in remaining budget and is NOT skipped',
  );

  // A small project with oversized bitmaps fits after applying the image budget.
  const fourMibPng = new Uint8Array(4 * 1024 * 1024);
  fourMibPng.set(png12Bytes, 0);
  const publishCapDoc = await fetchFigmaDocumentFromUrl(
    'https://www.figma.com/design/KeyPublishCap123456789/Publish',
    'figd_test',
    {
      fetchImpl: async (input) => {
        const u = String(input);
        if (u.endsWith('/images')) {
          return new Response(
            JSON.stringify({
              meta: {
                images: {
                  'ref-4m-a': 'https://s3.us-west-2.amazonaws.com/img/4ma.png',
                  'ref-4m-b': 'https://s3.us-west-2.amazonaws.com/img/4mb.png',
                  'ref-4m-c': 'https://s3.us-west-2.amazonaws.com/img/4mc.png',
                },
              },
            }),
            { status: 200 },
          );
        }
        if (u.includes('api.figma.com/v1/files/')) {
          return new Response(
            JSON.stringify({
              name: 'Large Publishable Design',
              version: '1',
              document: {
                id: '0:0',
                type: 'DOCUMENT',
                children: [
                  {
                    id: '1:1',
                    type: 'CANVAS',
                    name: 'Main',
                    children: [
                      {
                        id: '2:1',
                        type: 'FRAME',
                        name: 'Hero Page',
                        absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
                        children: [
                          { id: '2:2', type: 'RECTANGLE', name: 'Img A', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 }, fills: [{ type: 'IMAGE', imageRef: 'ref-4m-a' }] },
                          { id: '2:3', type: 'RECTANGLE', name: 'Img B', absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 300 }, fills: [{ type: 'IMAGE', imageRef: 'ref-4m-b' }] },
                          { id: '2:4', type: 'RECTANGLE', name: 'Img C', absoluteBoundingBox: { x: 840, y: 0, width: 400, height: 300 }, fills: [{ type: 'IMAGE', imageRef: 'ref-4m-c' }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        return new Response(fourMibPng, { status: 200 });
      },
    },
  );
  const compiledPub = compileFigmaSelectionToProject(publishCapDoc);
  const pubPayload = createFigmaProject('Large Publishable Design', '/tmp', compiledPub);
  loadProjectFromBinaryPayload(pubPayload);
  const publishedSnapshot = createPublishedSnapshot(compiledPub.designerPages[0].pageId);
  const publishBodyBytes = Buffer.byteLength(JSON.stringify({ snapshot: publishedSnapshot }), 'utf-8');
  assert.ok(
    publishBodyBytes < 20 * 1024 * 1024,
    `Published JSON body (${publishBodyBytes} bytes) must stay strictly under 20 MiB limit`,
  );
  assert.ok(
    publishCapDoc.warnings.some((w) => w.includes('图片内嵌额度')),
    'Reports images omitted because the image budget is exhausted',
  );

  // 6. [P2] CardGrid and Table return identical records for explicit null foreign key vs missing field
  const fkParityRows = [
    { id: 'r-explicit-null', title: '根节点', parent_id: null },
    { id: 'r-missing-field', title: '缺失字段记录' },
    { id: 'r-undef-field', title: 'Undefined字段记录', parent_id: undefined },
    { id: 'r-child', title: '子节点', parent_id: 'r-explicit-null' },
  ] as any[];
  const tableFilteredIds = prepareTableRows(fkParityRows, { filter: { parent_id: null } }, {}, null).roots.map(
    (b) => b.row.id,
  );
  const cardFilteredIds = filterCardRows(fkParityRows, { parent_id: null }).map((r) => r.id);
  assert.deepEqual(tableFilteredIds, ['r-explicit-null'], 'Table returns explicit null FK record');
  assert.deepEqual(cardFilteredIds, ['r-explicit-null'], 'CardGrid returns identical explicit null FK record');
  assert.deepEqual(cardFilteredIds, tableFilteredIds, 'CardGrid and Table static filter results match identically');
});

test('local ZIP selection reads business artwork even after 48 MiB of unselected component images', () => {
  const doc = importFigmaBinary(buildSyntheticFigZipArchive(12));
  const page = doc.canvases[1].frames.find(f => f.platform === 'desktop')!;
  const compiled = compileFigmaSelectionToProject(doc, new Set([page.pageId]));
  assert.match(compiled.pageSources[page.pageId], /data:image\/png;base64,/);
  assert.equal(compiled.omittedImages, 0);
  assert.deepEqual(doc.warnings, []);
});

const imageLayer = (id: string, ref: string) => ({
  id, name: ref, type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 72, height: 72 },
  fills: [{ type: 'IMAGE', imageRef: ref }],
});
const designFrame = (id: string, name: string, children: unknown[]) => ({
  id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 720 }, children,
});
const designFile = (frames: unknown[]) => ({
  name: 'Review fixture', document: { id: '0:0', type: 'DOCUMENT', children: [{ id: '1:1', name: 'Design', type: 'CANVAS', children: frames }] },
});

test('only images retained by both compiler limits consume the online import budget', async () => {
  const labels = Array.from({ length: 1800 }, (_, i) => ({ type: 'TEXT', id: '3:' + i, name: 'Label', characters: 'Text' }));
  let nested: any = imageLayer('8:1', 'too-deep');
  for (let i = 0; i < 36; i++) nested = designFrame('9:' + i, 'Group', [nested]);
  const file = designFile([
    designFrame('2:1', 'Long page', [...labels, imageLayer('7:1', 'clipped')]),
    designFrame('2:2', 'Nested page', [nested]),
    designFrame('2:3', 'Business page', [{ ...imageLayer('7:2', 'kept'), transitionNodeID: '7:1' }]),
  ]);
  const doc = normalizeFigmaRestFile(file, { fileKey: 'Review' });
  doc.remoteImagesByRef = { clipped: 'https://example.com/clipped', 'too-deep': 'https://example.com/deep', kept: 'https://example.com/kept' };
  const requests: string[] = [];
  const ready = await materializeFigmaSelectionImages(doc, undefined, {
    maxEncodedImageBudget: 38,
    fetchImpl: async input => {
      requests.push(String(input));
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 4]));
    },
  });
  const compiled = compileFigmaSelectionToProject(ready);
  assert.deepEqual(requests, ['https://example.com/kept']);
  assert.equal(compiled.report[0].widgets, 1800);
  assert.match(compiled.report[1].warnings.join(' '), /36/);
  assert.equal(compiled.report[2].links, 1, 'A clipped destination layer still resolves to its owning page');
  assert.equal(compiled.encodedImageBytes, 38);
  assert.equal(compiled.omittedImages, 0);
});

function largeVectorFrames() {
  const path = 'M0 0 ' + Array.from({ length: 5200 }, (_, i) => `L${i % 760}.25 ${i % 397}.50 `).join('') + 'Z';
  return Array.from({ length: 10 }, (_, i) => designFrame('50:' + i, 'Chart ' + i,
    Array.from({ length: 30 }, (_, j) => ({ id: `${10 + i}:${j}`, type: 'VECTOR', fillGeometry: [{ path }] }))));
}

test('a large vector project remains locally usable and fails the real UTF-8 publication preflight', async () => {
  const compiled = compileFigmaSelectionToProject(normalizeFigmaRestFile(designFile(largeVectorFrames()), { fileKey: 'Vector' }));
  const project = createFigmaProject('Vectors', '/tmp', compiled);
  loadProjectFromBinaryPayload(project);
  const snapshot = createPublishedSnapshot(compiled.designerPages[0].pageId);
  const input = { snapshot, access: { passwordAction: 'remove' as const, password: '', expiresAt: null } };
  assert.equal(compiled.encodedImageBytes, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 20 * 1024 * 1024);
  assert.match(publicationSizeWarning(input)!, /20 MiB/);
  await assert.rejects(savePublication(input), /20 MiB/);

  const unicodeBody = { ...input, snapshot: { ...snapshot, pages: snapshot.pages.slice(0, 1), title: '' } };
  const limit = 20 * 1024 * 1024;
  const remaining = limit - Buffer.byteLength(JSON.stringify(unicodeBody));
  unicodeBody.snapshot.title = '图'.repeat(Math.floor(remaining / 3)) + 'x'.repeat(remaining % 3);
  assert.equal(Buffer.byteLength(JSON.stringify(unicodeBody)), limit);
  assert.equal(publicationSizeWarning(unicodeBody), undefined);
  unicodeBody.snapshot.title += 'x';
  assert.ok(JSON.stringify(unicodeBody).length < limit);
  assert.match(publicationSizeWarning(unicodeBody)!, /20 MiB/);
});

const dialogMock = (element: React.ReactElement) => element.type === 'dialog'
  ? { open: false, showModal() { this.open = true; }, close() { this.open = false; } } : null;

test('immediate dialog dismissal waits for the credential deletion result', async () => {
  const win = (globalThis as any).window;
  const previous = win.protoflowDesktop;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    for (const success of [false, true]) {
      let finish!: (value: unknown) => void;
      let clears = 0;
      let closed = 0;
      win.protoflowDesktop = { isElectron: true, figma: {
        getToken: async () => '',
        setToken: () => { clears++; return new Promise(resolve => { finish = resolve; }); },
      } };
      await act(async () => { renderer = TestRenderer.create(<FigmaImportDialog initialTab="url" onClose={() => { closed++; }} />, { createNodeMock: dialogMock }); });
      const root = renderer!.root;
      act(() => {
        root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: false } });
        root.findByType('dialog').props.onCancel({ preventDefault() {} });
      });
      assert.equal(closed, 0);
      await act(async () => finish({ saved: success, persisted: success, error: success ? undefined : 'permission denied' }));
      assert.equal(closed, success ? 1 : 0);
      if (!success) {
        assert.match(JSON.stringify(root.findByProps({ role: 'alert' }).children), /permission denied/);
        assert.equal(root.findByProps({ type: 'checkbox' }).props.checked, true);
      }
      act(() => renderer!.unmount());
      renderer = undefined;
      assert.equal(clears, 1);
    }
  } finally {
    if (renderer) act(() => renderer!.unmount());
    win.protoflowDesktop = previous;
  }
});

test('import completion displays publication size and per-page missing images after the local file is saved', async () => {
  const win = (globalThis as any).window;
  const previous = win.protoflowDesktop;
  const { addEventListener, removeEventListener } = win;
  win.addEventListener ??= () => {};
  win.removeEventListener ??= () => {};
  let savedCount = 0;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  function ImportHost() {
    const importer = useFigmaImport();
    return <><button id="open-figma" onClick={() => importer.openFigma('url')}>Open</button>{importer.ui}</>;
  }
  try {
    const file = designFile([
      designFrame('2:1', 'Orders', [imageLayer('3:1', 'cover'), imageLayer('3:2', 'cover')]),
      ...largeVectorFrames(),
    ]);
    win.protoflowDesktop = {
      isElectron: true, defaultProjectsDirectory: async () => '/tmp', writeBinaryProject: async () => { savedCount++; return { saved: true }; },
      figma: { getToken: async () => 'fixture', setToken: async () => ({ saved: true, persisted: true }),
        fetchJson: async ({ url }: { url: string }) => ({ ok: true, data: url.endsWith('/images') ? { meta: { images: { cover: 'https://example.com/art' } } } : file }),
        fetchImage: async () => ({ ok: false, error: 'HTTP 404' }) },
    };
    await act(async () => { renderer = TestRenderer.create(<ImportHost />, { createNodeMock: dialogMock }); });
    const root = renderer!.root;
    await act(async () => root.findByProps({ id: 'open-figma' }).props.onClick());
    act(() => root.findByProps({ type: 'url' }).props.onChange({ target: { value: 'https://www.figma.com/design/KeyReview1234567/Test' } }));
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }));
    const confirm = root.findAllByType('button').find(b => b.findAllByType('span').some(s => s.children.some(t => typeof t === 'string' && /导入所选|Frame\(s\)/.test(t))));
    assert.ok(confirm);
    await act(async () => confirm.props.onClick());
    assert.equal(savedCount, 1);
    const heading = root.findByType('h3').children.join('');
    assert.match(heading, /Orders/);
    assert.match(heading, /2 处缺图|2 missing images/);
    const warnings = root.findAllByType('li').map(item => item.children.join(''));
    assert.ok(warnings.some(w => w.includes('cover')));
    assert.ok(warnings.some(w => w.includes('2 处在线图片')));
    assert.match(root.findByType('p').children.join(''), /20 MiB/);
  } finally {
    if (renderer) act(() => renderer!.unmount());
    win.protoflowDesktop = previous;
    win.addEventListener = addEventListener;
    win.removeEventListener = removeEventListener;
  }
});
