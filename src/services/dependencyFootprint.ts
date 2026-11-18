import { parsePageSource } from '../proto/dsl/parser';
import { walk } from '../proto/dsl/tree';
import { buildSitemap, folderOptions, type SitemapOverrides } from '../proto/sitemap';
import { noteAiContext, type NoteAiCatalogItem, type NoteWorkspace } from '../proto/notes';
import type { RequirementRecord } from '../proto/database/requirementReview';
import type { DBTableSchema } from '../store/useProtoStore';
import type { ProjectPlan } from './projectPlan';
import { pagePrototypeIssue } from './projectPlanMenus';
import { projectPageCatalog } from './projectAnalysis';
import { projectExecutionBrief, type ProjectAgreement } from './projectKnowledge';

const hasOwn = (obj: unknown, key: string): boolean =>
  Boolean(obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key));

// Standard FIPS 180-4 SHA-256 round constants (first 32 bits of fractional parts of cube roots of first 64 primes).
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const utf8Encoder = new TextEncoder();

/**
 * Synchronous, browser-and-Node compatible FIPS 180-4 SHA-256 hex digest.
 * Matches `node:crypto.createHash('sha256').update(input, 'utf8').digest('hex')` byte-for-byte.
 */
export function sha256Hex(input: string): string {
  const bytes = utf8Encoder.encode(input);
  const bitLenHi = Math.floor(bytes.length / 0x20000000);
  const bitLenLo = (bytes.length << 3) >>> 0;
  const paddedLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const v0 = w[i - 15];
      const s0 = (((v0 >>> 7) | (v0 << 25)) ^ ((v0 >>> 18) | (v0 << 14)) ^ (v0 >>> 3)) >>> 0;
      const v1 = w[i - 2];
      const s1 = (((v1 >>> 17) | (v1 << 15)) ^ ((v1 >>> 19) | (v1 << 13)) ^ (v1 >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map(n => n.toString(16).padStart(8, '0')).join('');
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return '"__undef__"';
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  }
  if (Array.isArray(value)) {
    return '[' + value.map(item => canonicalJson(item)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter(k => record[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(record[k])).join(',') + '}';
  }
  return JSON.stringify(String(value));
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export interface FootprintSnapshotView {
  projectId?: string;
  projectName?: string;
  projectMode?: 'desktop' | 'mobile' | 'hybrid';
  mindmaps?: { nodes: Array<{ id: string; kind: string; source?: string }>; links: unknown[] };
  projectNotes?: NoteAiCatalogItem[] | NoteWorkspace;
  projectNoteDocuments?: Record<string, string>;
  pageCatalog?: Array<{ pageId: string; title: string; path: string; hasSource: boolean; deprecated: boolean }>;
  tableRows?: Record<string, unknown[]>;
  pageSources?: Record<string, string>;
  designerPages?: Array<{ pageId: string; title: string; folderId: string; platform?: 'desktop' | 'mobile' }>;
  designerFolders?: Array<{ id: string; title: string; parentFolderId: string | null }>;
  sitemapBase?: unknown[];
  sitemapOverrides?: SitemapOverrides | Record<string, unknown>;
  sitemap?: unknown[];
  folders?: unknown[];
  projectPlan?: ProjectPlan | null;
  projectAgreements?: ProjectAgreement[] | Array<{ id: string; kind: string; title: string; text: string; pageIds: string[] }>;
  databaseRequirements?: RequirementRecord[] | Array<{ id: string }>;
  requirementSources?: unknown[];
  dbTables?: DBTableSchema[];
  stickyNotes?: Array<{ id: string; pageId: string; targetWidgetId: string; active: boolean }>;
  closedLoopIssues?: Array<{ id: string; pageId: string }>;
  compositeBlocks?: unknown[];
  contracts?: Record<string, unknown>;
}

export interface ObservedPageState {
  inDesignerPages: boolean;
  designerMetaHash: string | null;
  hasSource: boolean;
  sourceHash: string | null;
  isEmptyScaffold: boolean;
  generated: boolean;
}

export interface GeneratingTargetStatus {
  targetPageId: string;
  targetGenerated: boolean;
  upstreamPages: Record<string, ObservedPageState>;
}

export interface ObservedTableState {
  exists: boolean;
  schemaHash: string | null;
}

export interface ObservedTableRowsState {
  hasSavedRows: boolean;
  rowsHash: string | null;
}

export interface NoteCatalogProofItem {
  noteId: string;
  metaHash: string;
}

export interface NoteDocumentQueryProofItem {
  noteId: string;
  metaHash: string;
  docHash: string;
  sliceHash: string;
  totalChars: number;
}

export interface NoteDocumentQueryProof {
  key: string;
  noteIds: string[] | null;
  pageId: string | null;
  offset: number;
  limit: number;
  charOffset: number;
  maxChars: number;
  total: number;
  items: NoteDocumentQueryProofItem[];
}

export interface WriteTablePreimage {
  existed: boolean;
  schemaHash: string | null;
  tableName: string | null;
}

export interface WriteStickyPreimage {
  existed: boolean;
  prevOwnerPageId: string | null;
  prevHash: string | null;
}

export interface DependencyFootprintV3 {
  version: 3;
  workflowPhase: string | null;
  targetPageId: string | null;
  readSet: {
    agreementCatalogHash?: string;
    agreementsByScope: Record<string, string>;
    allProjectAgreementsHash?: string;
    planSliceByScope: Record<string, string>;
    pageCatalogByScope: Record<string, string>;
    relatedPagesByScope: Record<string, string>;
    dependencyReviewByScope: Record<string, string>;
    tableCatalogHash?: string;
    relationIssuesHash?: string;
    allDbTablesHash?: string;
    sitemapTopologyHash?: string;
    mindmapsHash?: string;
    mindmapNodes: Record<string, { exists: boolean; sourceHash: string | null }>;
    knownNavigablePages: Record<string, boolean>;
    compositeBlocksHash?: string;
    contractsWidgetsHash?: string;
    allPageSourcesHash?: string;
    allStickiesHash?: string;
    allClosedLoopIssuesHash?: string;
    stickiesByPage: Record<string, string>;
    activeStickiesByScope: Record<string, string>;
    issuesByPage: Record<string, string>;
    pages: Record<string, ObservedPageState>;
    pageKnownInCatalog: Record<string, boolean>;
    tables: Record<string, ObservedTableState>;
    tableRows: Record<string, ObservedTableRowsState>;
    requirementSourcesHash?: string;
    databaseRequirementsHash?: string;
  };
  tableNameBindings: Record<string, string[]>;
  noteCatalogByScope: Record<string, NoteCatalogProofItem[]>;
  noteQueries: Record<string, NoteDocumentQueryProof>;
  noteExists: Record<string, boolean>;
  writeSet: {
    pages: Record<string, ObservedPageState>;
    tables: Record<string, WriteTablePreimage>;
    tableRows: Record<string, ObservedTableRowsState>;
    stickies: Record<string, WriteStickyPreimage>;
    requirementSources: Record<string, string | null>;
    agreements: Record<string, string | null>;
    projectPlanHash?: string;
    closedLoopIssuesHash?: string;
  };
}

export function getActiveMergeForPage(plan: ProjectPlan | null | undefined, targetPageId?: string | null) {
  if (!targetPageId) return null;
  return plan?.approved && plan.revision?.pageId === targetPageId && plan.revision.merge !== undefined
    ? plan.revision.merge
    : null;
}

export function isDefaultPlanScaffold(source: string): boolean {
  const doc = parsePageSource(source).doc;
  if (!doc) return false;
  if (doc.root.type !== 'Page' && doc.root.type !== 'MobilePage') return false;
  return !doc.root.children.some(child => child.kind === 'node');
}

export function observePageState(snapshot: FootprintSnapshotView, pageId: string): ObservedPageState {
  const designerPages = Array.isArray(snapshot.designerPages) ? snapshot.designerPages : [];
  const d = designerPages.find(p => p.pageId === pageId);
  const pageSources = snapshot.pageSources && typeof snapshot.pageSources === 'object' ? snapshot.pageSources : {};
  const hasSource = hasOwn(pageSources, pageId) && typeof pageSources[pageId] === 'string';
  const source = hasSource ? pageSources[pageId] : null;
  return {
    inDesignerPages: Boolean(d),
    designerMetaHash: d
      ? canonicalHash({
          pageId: d.pageId,
          title: d.title,
          folderId: d.folderId,
          platform: d.platform ?? null,
        })
      : null,
    hasSource,
    sourceHash: source !== null ? sha256Hex(source) : null,
    isEmptyScaffold: source !== null ? isDefaultPlanScaffold(source) : false,
    generated: Boolean(snapshot.projectPlan?.generatedPageIds?.includes(pageId)),
  };
}

export function buildGeneratingTargetStatus(
  snapshot: FootprintSnapshotView,
  targetPageId: string,
): GeneratingTargetStatus {
  const plan = snapshot.projectPlan;
  const approvedPlan = plan?.approved ? plan : null;
  const pageSources = snapshot.pageSources ?? {};
  const targetGenerated = Boolean(
    approvedPlan?.generatedPageIds?.includes(targetPageId) &&
      hasOwn(pageSources, targetPageId) &&
      !pagePrototypeIssue(pageSources[targetPageId]),
  );
  const targetPagePlan = approvedPlan?.pages?.find(p => p.pageId === targetPageId);
  const upstreamIds = new Set<string>();
  for (const dep of targetPagePlan?.dependencies ?? []) {
    if (typeof dep.sourcePageId === 'string' && dep.sourcePageId) {
      upstreamIds.add(dep.sourcePageId);
    }
  }
  const activeMerge = getActiveMergeForPage(approvedPlan, targetPageId);
  if (activeMerge?.sourcePageId) {
    upstreamIds.add(activeMerge.sourcePageId);
  }
  const upstreamPages: Record<string, ObservedPageState> = {};
  for (const depId of [...upstreamIds].sort()) {
    upstreamPages[depId] = observePageState(snapshot, depId);
  }
  return {
    targetPageId,
    targetGenerated,
    upstreamPages,
  };
}

export function buildNarrowedProjectPlan(snapshot: FootprintSnapshotView, targetPageId: string) {
  const plan = snapshot.projectPlan;
  if (!plan) return null;
  return {
    summary: plan.summary,
    discussionPending: plan.discussionPending === true,
    folders: plan.folders,
    ...(plan.revision !== undefined ? { revision: plan.revision } : {}),
    pages: (plan.pages ?? []).filter(p => p.pageId === targetPageId),
    targetStatus: buildGeneratingTargetStatus(snapshot, targetPageId),
  };
}

export function filterGeneratingStickyNotes<T extends { pageId: string }>(
  stickyNotes: T[] | undefined,
  plan: ProjectPlan | null | undefined,
  targetPageId: string,
): T[] {
  const activeMerge = getActiveMergeForPage(plan, targetPageId);
  const allowed = new Set<string>([targetPageId, ...(activeMerge ? [activeMerge.sourcePageId] : [])]);
  return (stickyNotes ?? []).filter(note => allowed.has(note.pageId));
}

export function filterGeneratingClosedLoopIssues<T extends { pageId: string }>(
  issues: T[] | undefined,
  plan: ProjectPlan | null | undefined,
  targetPageId: string,
): T[] {
  const activeMerge = getActiveMergeForPage(plan, targetPageId);
  const allowed = new Set<string>([targetPageId, ...(activeMerge ? [activeMerge.sourcePageId] : [])]);
  return (issues ?? []).filter(issue => allowed.has(issue.pageId));
}

export function filterGeneratingProjectNotes<T extends { relatedPageIds?: string[] }>(
  notes: T[] | undefined,
  plan: ProjectPlan | null | undefined,
  targetPageId: string,
): T[] {
  const activeMerge = getActiveMergeForPage(plan, targetPageId);
  return (notes ?? []).filter(
    note =>
      !Array.isArray(note.relatedPageIds) ||
      note.relatedPageIds.length === 0 ||
      note.relatedPageIds.includes(targetPageId) ||
      Boolean(activeMerge && note.relatedPageIds.includes(activeMerge.sourcePageId)),
  );
}

export function parseForeignKeyReference(raw: string | undefined | null): { refTableName: string; refColumnName: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  const match = /^([\w]+)\(([\w]+)\)$/.exec(raw);
  if (!match) return null;
  return { refTableName: match[1], refColumnName: match[2] };
}

export function observeTable(snapshot: FootprintSnapshotView, tableId: string): ObservedTableState {
  const table = (snapshot.dbTables ?? []).find(t => t.id === tableId);
  return {
    exists: Boolean(table),
    schemaHash: table ? canonicalHash(table) : null,
  };
}

export function observeTableRows(snapshot: FootprintSnapshotView, tableId: string): ObservedTableRowsState {
  const rowsMap = snapshot.tableRows && typeof snapshot.tableRows === 'object' && !Array.isArray(snapshot.tableRows)
    ? snapshot.tableRows
    : {};
  const hasSavedRows = hasOwn(rowsMap, tableId);
  return {
    hasSavedRows,
    rowsHash: hasSavedRows ? canonicalHash(rowsMap[tableId]) : null,
  };
}

function observeWriteTablePreimage(snapshot: FootprintSnapshotView, tableId: string): WriteTablePreimage {
  const table = (snapshot.dbTables ?? []).find(t => t.id === tableId);
  return {
    existed: Boolean(table),
    schemaHash: table ? canonicalHash(table) : null,
    tableName: table ? table.tableName : null,
  };
}

function observeWriteStickyPreimage(snapshot: FootprintSnapshotView, stickyId: string): WriteStickyPreimage {
  const sticky = (snapshot.stickyNotes ?? []).find(s => s.id === stickyId);
  return {
    existed: Boolean(sticky),
    prevOwnerPageId: sticky ? sticky.pageId : null,
    prevHash: sticky ? canonicalHash(sticky) : null,
  };
}

function observeMindmapNode(snapshot: FootprintSnapshotView, mindmapId: string): { exists: boolean; sourceHash: string | null } {
  const node = snapshot.mindmaps?.nodes?.find(n => n.id === mindmapId && n.kind === 'mindmap');
  return {
    exists: Boolean(node),
    sourceHash: node && typeof node.source === 'string' ? sha256Hex(node.source) : null,
  };
}

function computeMatchingTableIdsByPhysicalName(snapshot: FootprintSnapshotView, refTableName: string): string[] {
  return (snapshot.dbTables ?? []).filter(t => t.tableName === refTableName).map(t => t.id);
}

function computeAllDbTablesHash(snapshot: FootprintSnapshotView): string {
  return canonicalHash(snapshot.dbTables ?? []);
}

function computeAllPageSourcesHash(snapshot: FootprintSnapshotView): string {
  return canonicalHash(snapshot.pageSources ?? {});
}

function computeStickiesForPageHash(snapshot: FootprintSnapshotView, pageId: string): string {
  return canonicalHash((snapshot.stickyNotes ?? []).filter(n => n.pageId === pageId));
}

function computeIssuesForPageHash(snapshot: FootprintSnapshotView, pageId: string): string {
  return canonicalHash((snapshot.closedLoopIssues ?? []).filter(i => i.pageId === pageId));
}

function resolveCatalog(snapshot: FootprintSnapshotView) {
  if (
    Array.isArray(snapshot.designerFolders) &&
    Array.isArray(snapshot.designerPages) &&
    Array.isArray(snapshot.sitemapBase) &&
    snapshot.sitemapOverrides
  ) {
    return projectPageCatalog(snapshot as unknown as Parameters<typeof projectPageCatalog>[0]);
  }
  return Array.isArray(snapshot.pageCatalog) ? snapshot.pageCatalog : [];
}

function computeSitemapTopologyHash(snapshot: FootprintSnapshotView): string {
  const hasFullLayout =
    Array.isArray(snapshot.designerFolders) &&
    Array.isArray(snapshot.designerPages) &&
    Array.isArray(snapshot.sitemapBase) &&
    Boolean(snapshot.sitemapOverrides);
  const sitemap = hasFullLayout
    ? buildSitemap(
        snapshot.designerFolders!,
        snapshot.designerPages!,
        snapshot.sitemapOverrides as unknown as Parameters<typeof buildSitemap>[2],
        snapshot.sitemapBase as unknown as Parameters<typeof buildSitemap>[3],
      )
    : snapshot.sitemap ?? [];
  const folders = hasFullLayout
    ? folderOptions(
        snapshot.designerFolders!,
        snapshot.sitemapOverrides as unknown as Parameters<typeof folderOptions>[1],
        snapshot.sitemapBase as unknown as Parameters<typeof folderOptions>[2],
      ).filter(f => !f.deprecated)
    : snapshot.folders ?? [];
  const catalog = resolveCatalog(snapshot);
  const pageIds = Object.keys(snapshot.pageSources ?? {}).sort();
  return canonicalHash({
    designerFolders: snapshot.designerFolders ?? [],
    designerPages: snapshot.designerPages ?? [],
    sitemapBase: snapshot.sitemapBase ?? [],
    sitemapOverrides: snapshot.sitemapOverrides ?? {},
    sitemap,
    folders,
    pageCatalog: catalog,
    pageIds,
  });
}

function computeProjectContractsMeta(snapshot: FootprintSnapshotView): Record<string, unknown> {
  const raw = snapshot.contracts && typeof snapshot.contracts === 'object' && !Array.isArray(snapshot.contracts)
    ? snapshot.contracts
    : {};
  const {
    components: _c,
    materialContractVersion: _v,
    materialValueDefinitions: _d,
    actions: _a,
    ...dynamic
  } = raw;
  const hasFullLayout =
    Array.isArray(snapshot.designerFolders) &&
    Array.isArray(snapshot.sitemapBase) &&
    Boolean(snapshot.sitemapOverrides);
  const folderIds = hasFullLayout
    ? folderOptions(
        snapshot.designerFolders!,
        snapshot.sitemapOverrides as unknown as Parameters<typeof folderOptions>[1],
        snapshot.sitemapBase as unknown as Parameters<typeof folderOptions>[2],
      )
        .filter(f => !f.deprecated)
        .map(f => f.id)
    : (dynamic.folderIds ?? []);
  const tableDomains = Array.isArray(snapshot.dbTables)
    ? [...new Set(snapshot.dbTables.map(t => t.domain))]
    : (dynamic.tableDomains ?? []);
  return {
    ...dynamic,
    folderIds,
    tableDomains,
  };
}

function isKnownCatalogOrSourcePage(snapshot: FootprintSnapshotView, pageId: string): boolean {
  if (hasOwn(snapshot.pageSources ?? {}, pageId)) return true;
  const catalog = resolveCatalog(snapshot);
  return catalog.some(p => p.pageId === pageId);
}

function isKnownPlanOrSourcePage(snapshot: FootprintSnapshotView, pageId: string): boolean {
  if (hasOwn(snapshot.pageSources ?? {}, pageId)) return true;
  return Boolean(snapshot.projectPlan?.pages?.some(p => p.pageId === pageId));
}

function extractSourceBoundTableIds(source: string | undefined): string[] {
  if (typeof source !== 'string' || !source) return [];
  const doc = parsePageSource(source).doc;
  if (!doc) return [];
  const ids = new Set<string>();
  walk(doc.root, node => {
    if (typeof node.props.table === 'string' && node.props.table) {
      ids.add(node.props.table);
    }
  });
  return [...ids].sort();
}

function noteCatalogProof(notes: NoteAiCatalogItem[]): NoteCatalogProofItem[] {
  return notes.map(note => ({
    noteId: note.noteId,
    metaHash: canonicalHash(note),
  }));
}

export function buildNoteQueryKey(params: {
  noteIds: string[] | null;
  pageId: string | null;
  offset: number;
  limit: number;
  charOffset: number;
  maxChars: number;
}): string {
  return canonicalJson({
    noteIds: params.noteIds ? [...params.noteIds] : null,
    pageId: params.pageId,
    offset: params.offset,
    limit: params.limit,
    charOffset: params.charOffset,
    maxChars: params.maxChars,
  });
}

function resolveNoteContext(snapshot: FootprintSnapshotView): {
  catalog: NoteAiCatalogItem[];
  documents: Record<string, string>;
} {
  if (Array.isArray(snapshot.projectNotes)) {
    return {
      catalog: snapshot.projectNotes,
      documents:
        snapshot.projectNoteDocuments && typeof snapshot.projectNoteDocuments === 'object'
          ? snapshot.projectNoteDocuments
          : {},
    };
  }
  if (
    snapshot.projectNotes &&
    typeof snapshot.projectNotes === 'object' &&
    Array.isArray(snapshot.designerFolders) &&
    Array.isArray(snapshot.designerPages) &&
    Array.isArray(snapshot.sitemapBase) &&
    snapshot.sitemapOverrides
  ) {
    return noteAiContext(snapshot.projectNotes, snapshot as unknown as Parameters<typeof noteAiContext>[1]);
  }
  return {
    catalog: [],
    documents:
      snapshot.projectNoteDocuments && typeof snapshot.projectNoteDocuments === 'object'
        ? snapshot.projectNoteDocuments
        : {},
  };
}

export function buildNoteDocumentQueryProof(
  snapshot: FootprintSnapshotView,
  params: {
    noteIds: string[] | null;
    pageId: string | null;
    offset: number;
    limit: number;
    charOffset: number;
    maxChars: number;
  },
): NoteDocumentQueryProof {
  const { catalog, documents } = resolveNoteContext(snapshot);
  let selected = catalog;
  if (params.noteIds !== null) {
    const idSet = new Set(params.noteIds);
    selected = selected.filter(note => idSet.has(note.noteId));
  }
  if (params.pageId !== null) {
    selected = selected.filter(
      note => Array.isArray(note.relatedPageIds) && note.relatedPageIds.includes(params.pageId!),
    );
  }
  if (params.noteIds === null) {
    selected = [...selected].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  const total = selected.length;
  const paged = params.noteIds === null ? selected.slice(params.offset, params.offset + params.limit) : selected;
  const key = buildNoteQueryKey(params);
  return {
    key,
    ...params,
    total,
    items: paged.map(note => {
      const content = typeof documents[note.noteId] === 'string' ? documents[note.noteId] : '';
      const slice = content.slice(params.charOffset, params.charOffset + params.maxChars);
      const { summary: _summary, ...meta } = note;
      return {
        noteId: note.noteId,
        metaHash: canonicalHash(meta),
        docHash: sha256Hex(content),
        sliceHash: sha256Hex(slice),
        totalChars: content.length,
      };
    }),
  };
}

export function createEmptyDependencyFootprint(
  workflowPhase?: string | null,
  targetPageId?: string | null,
): DependencyFootprintV3 {
  return {
    version: 3,
    workflowPhase: workflowPhase ?? null,
    targetPageId: targetPageId ?? null,
    readSet: {
      agreementsByScope: {},
      planSliceByScope: {},
      pageCatalogByScope: {},
      relatedPagesByScope: {},
      dependencyReviewByScope: {},
      mindmapNodes: {},
      knownNavigablePages: {},
      stickiesByPage: {},
      activeStickiesByScope: {},
      issuesByPage: {},
      pages: {},
      pageKnownInCatalog: {},
      tables: {},
      tableRows: {},
    },
    tableNameBindings: {},
    noteCatalogByScope: {},
    noteQueries: {},
    noteExists: {},
    writeSet: {
      pages: {},
      tables: {},
      tableRows: {},
      stickies: {},
      requirementSources: {},
      agreements: {},
    },
  };
}

function recordForeignKeyColumn(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  rawRef: string | undefined | null,
  includeParentRows: boolean,
) {
  const parsed = parseForeignKeyReference(rawRef);
  if (!parsed) return;
  const matchingIds = computeMatchingTableIdsByPhysicalName(baseSnapshot, parsed.refTableName);
  footprint.tableNameBindings[parsed.refTableName] = matchingIds;
  if (matchingIds.length === 1) {
    const resolvedId = matchingIds[0];
    footprint.readSet.tables[resolvedId] = observeTable(baseSnapshot, resolvedId);
    if (includeParentRows) {
      footprint.readSet.tableRows[resolvedId] = observeTableRows(baseSnapshot, resolvedId);
    }
  }
}

function recordMergeReadSet(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  pageId: string,
) {
  const activeMerge = getActiveMergeForPage(baseSnapshot.projectPlan, pageId);
  if (!activeMerge) return;
  const srcId = activeMerge.sourcePageId;
  footprint.readSet.pages[srcId] = observePageState(baseSnapshot, srcId);
  footprint.readSet.stickiesByPage[srcId] = computeStickiesForPageHash(baseSnapshot, srcId);
  footprint.readSet.issuesByPage[srcId] = computeIssuesForPageHash(baseSnapshot, srcId);
  footprint.readSet.allPageSourcesHash = computeAllPageSourcesHash(baseSnapshot);
  footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
}

function recordPageReadinessInputs(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  pageId: string,
) {
  footprint.readSet.pages[pageId] = observePageState(baseSnapshot, pageId);
  footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
  const planPage = baseSnapshot.projectPlan?.pages?.find(p => p.pageId === pageId);
  if (planPage) {
    const scopeKey = canonicalJson({ readinessPage: pageId });
    footprint.readSet.planSliceByScope[scopeKey] = canonicalHash(planPage);
    for (const dep of planPage.dependencies ?? []) {
      if (dep.sourcePageId) {
        footprint.readSet.pages[dep.sourcePageId] = observePageState(baseSnapshot, dep.sourcePageId);
      }
    }
    for (const other of baseSnapshot.projectPlan?.pages ?? []) {
      for (const dep of other.dependencies ?? []) {
        if (dep.sourcePageId === pageId) {
          footprint.readSet.pages[other.pageId] = observePageState(baseSnapshot, other.pageId);
        }
      }
    }
    for (const c of planPage.acceptanceCases ?? []) {
      if (c.source?.mindmapId) {
        footprint.readSet.mindmapNodes[c.source.mindmapId] = observeMindmapNode(baseSnapshot, c.source.mindmapId);
      }
      if (c.actionKind === 'navigate' && c.targetId) {
        footprint.readSet.knownNavigablePages[c.targetId] = isKnownPlanOrSourcePage(baseSnapshot, c.targetId);
      }
    }
  }
  recordMergeReadSet(footprint, baseSnapshot, pageId);
}

function briefScopeKey(focus: { pageId?: string; folderId?: string }, generatingTargetPageId?: string): string {
  return canonicalJson({
    generatingTargetPageId: generatingTargetPageId ?? null,
    pageId: focus.pageId ?? null,
    folderId: focus.folderId ?? null,
  });
}

function parseBriefScopeKey(key: string): {
  generatingTargetPageId: string | null;
  pageId: string | null;
  folderId: string | null;
} | null {
  try {
    const parsed = JSON.parse(key);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      generatingTargetPageId: typeof parsed.generatingTargetPageId === 'string' ? parsed.generatingTargetPageId : null,
      pageId: typeof parsed.pageId === 'string' ? parsed.pageId : null,
      folderId: typeof parsed.folderId === 'string' ? parsed.folderId : null,
    };
  } catch {
    return null;
  }
}

function computeBriefOnSnapshot(
  snapshot: FootprintSnapshotView,
  focus: { pageId?: string; folderId?: string },
  generatingTargetPageId?: string | null,
) {
  return projectExecutionBrief(
    {
      ...(snapshot as unknown as Parameters<typeof projectExecutionBrief>[0]),
      projectAgreements: (snapshot.projectAgreements ?? []) as ProjectAgreement[],
    },
    focus,
    generatingTargetPageId ? { generatingTargetPageId } : undefined,
  );
}

export function recordBriefFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  focus: { pageId?: string; folderId?: string },
  generatingTargetPageId?: string | null,
  candidateBrief?: ReturnType<typeof projectExecutionBrief> | null,
) {
  if (focus.folderId !== undefined) {
    footprint.readSet.sitemapTopologyHash = computeSitemapTopologyHash(baseSnapshot);
  }
  if (focus.pageId !== undefined) {
    footprint.readSet.pages[focus.pageId] = observePageState(baseSnapshot, focus.pageId);
    footprint.readSet.pageKnownInCatalog[focus.pageId] = isKnownCatalogOrSourcePage(baseSnapshot, focus.pageId);
  }
  let baseBrief: ReturnType<typeof projectExecutionBrief>;
  try {
    baseBrief = computeBriefOnSnapshot(baseSnapshot, focus, generatingTargetPageId);
  } catch {
    // Negative lookup on baseSnapshot (e.g. unknown pageId or folderId): the negative existence facts above cover it.
    return;
  }
  const sKey = briefScopeKey(focus, generatingTargetPageId ?? undefined);
  footprint.readSet.agreementCatalogHash = canonicalHash(baseBrief.agreementCatalog);
  footprint.readSet.agreementsByScope[sKey] = canonicalHash(baseBrief.agreements);
  footprint.readSet.planSliceByScope['brief:' + sKey] = canonicalHash(baseBrief.plan);
  footprint.readSet.pageCatalogByScope[sKey] = canonicalHash(baseBrief.pageCatalog);
  footprint.readSet.relatedPagesByScope[sKey] = canonicalHash(baseBrief.relatedPages);
  footprint.readSet.dependencyReviewByScope[sKey] = canonicalHash(baseBrief.dependencyReview);
  footprint.readSet.tableCatalogHash = canonicalHash(baseBrief.tableCatalog);
  footprint.readSet.relationIssuesHash = canonicalHash(baseBrief.relationIssues);
  footprint.readSet.activeStickiesByScope[sKey] = canonicalHash({
    catalog: baseBrief.requirementCatalog,
    requirements: baseBrief.requirements,
  });

  const observedPageIds = new Set<string>();
  if (focus.pageId) observedPageIds.add(focus.pageId);
  if (generatingTargetPageId) observedPageIds.add(generatingTargetPageId);
  for (const p of baseBrief.pageCatalog) observedPageIds.add(p.pageId);
  for (const link of baseBrief.dependencyReview.links) {
    observedPageIds.add(link.pageId);
    observedPageIds.add(link.sourcePageId);
  }
  for (const link of candidateBrief?.dependencyReview?.links ?? []) {
    observedPageIds.add(link.pageId);
    observedPageIds.add(link.sourcePageId);
  }
  for (const pid of observedPageIds) {
    footprint.readSet.pages[pid] = observePageState(baseSnapshot, pid);
    recordMergeReadSet(footprint, baseSnapshot, pid);
  }

  const planPages = [
    ...((baseBrief.plan?.pages ?? []) as ProjectPlan['pages']),
    ...(((candidateBrief?.plan?.pages ?? []) as ProjectPlan['pages'])),
  ];
  for (const page of planPages) {
    for (const c of page.acceptanceCases ?? []) {
      if (c?.source?.mindmapId) {
        footprint.readSet.mindmapNodes[c.source.mindmapId] = observeMindmapNode(baseSnapshot, c.source.mindmapId);
      }
      if (c?.actionKind === 'navigate' && c.targetId) {
        footprint.readSet.knownNavigablePages[c.targetId] = isKnownPlanOrSourcePage(baseSnapshot, c.targetId);
      }
    }
  }

  const allExposedTables = [...baseBrief.tables, ...(candidateBrief?.tables ?? [])];
  for (const table of allExposedTables) {
    footprint.readSet.tables[table.id] = observeTable(baseSnapshot, table.id);
    for (const col of table.columns ?? []) {
      if (col.isForeignKey || col.references) {
        recordForeignKeyColumn(footprint, baseSnapshot, col.references, false);
      }
    }
  }

  const baseCatalogNotes = Array.isArray(baseSnapshot.projectNotes)
    ? baseSnapshot.projectNotes.filter(
        note =>
          (!focus.pageId && !focus.folderId) ||
          note.relatedPageIds.some(id => baseBrief.pageCatalog.some(page => page.pageId === id)),
      )
    : [];
  footprint.noteCatalogByScope['brief:' + sKey] = noteCatalogProof(baseCatalogNotes);
}

export function recordGetProjectFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  generatingTargetPageId?: string | null,
) {
  footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
  footprint.readSet.sitemapTopologyHash = computeSitemapTopologyHash(baseSnapshot);
  footprint.readSet.allProjectAgreementsHash = canonicalHash(baseSnapshot.projectAgreements ?? []);
  footprint.readSet.mindmapsHash = canonicalHash(baseSnapshot.mindmaps ?? null);
  footprint.readSet.compositeBlocksHash = canonicalHash(baseSnapshot.compositeBlocks ?? []);
  footprint.readSet.contractsWidgetsHash = canonicalHash(computeProjectContractsMeta(baseSnapshot));

  const baseNoteCatalog = resolveNoteContext(baseSnapshot).catalog;
  if (generatingTargetPageId) {
    footprint.readSet.pages[generatingTargetPageId] = observePageState(baseSnapshot, generatingTargetPageId);
    footprint.readSet.stickiesByPage[generatingTargetPageId] = computeStickiesForPageHash(
      baseSnapshot,
      generatingTargetPageId,
    );
    footprint.readSet.issuesByPage[generatingTargetPageId] = computeIssuesForPageHash(
      baseSnapshot,
      generatingTargetPageId,
    );
    recordMergeReadSet(footprint, baseSnapshot, generatingTargetPageId);
    footprint.readSet.planSliceByScope['get_project:generating:' + generatingTargetPageId] = canonicalHash(
      buildNarrowedProjectPlan(baseSnapshot, generatingTargetPageId),
    );
    footprint.noteCatalogByScope['get_project:generating:' + generatingTargetPageId] = noteCatalogProof(
      filterGeneratingProjectNotes(baseNoteCatalog, baseSnapshot.projectPlan, generatingTargetPageId),
    );
  } else {
    footprint.readSet.allStickiesHash = canonicalHash(baseSnapshot.stickyNotes ?? []);
    footprint.readSet.allClosedLoopIssuesHash = canonicalHash(baseSnapshot.closedLoopIssues ?? []);
    footprint.readSet.planSliceByScope['get_project:full'] = canonicalHash(baseSnapshot.projectPlan ?? null);
    footprint.noteCatalogByScope['get_project:full'] = noteCatalogProof(baseNoteCatalog);
  }
}

export function recordGetPageTsxFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  pageId: unknown,
) {
  if (typeof pageId !== 'string') return;
  footprint.readSet.pages[pageId] = observePageState(baseSnapshot, pageId);
}

export function recordInspectPageFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  candidateSnapshot: FootprintSnapshotView,
  pageId: unknown,
  isProjectKind: boolean,
) {
  if (typeof pageId !== 'string') return;
  footprint.readSet.pages[pageId] = observePageState(baseSnapshot, pageId);
  if (!hasOwn(candidateSnapshot.pageSources ?? {}, pageId)) return;
  footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
  const tableIds = new Set([
    ...extractSourceBoundTableIds(baseSnapshot.pageSources?.[pageId]),
    ...extractSourceBoundTableIds(candidateSnapshot.pageSources?.[pageId]),
  ]);
  for (const tid of tableIds) {
    footprint.readSet.tables[tid] = observeTable(baseSnapshot, tid);
    footprint.readSet.tableRows[tid] = observeTableRows(baseSnapshot, tid);
  }
  if (isProjectKind) {
    recordPageReadinessInputs(footprint, baseSnapshot, pageId);
  }
}

export function recordGetDbTableFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  tableId: unknown,
  includeRows: boolean,
) {
  if (typeof tableId !== 'string' || !tableId.trim()) return;
  footprint.readSet.tables[tableId] = observeTable(baseSnapshot, tableId);
  if (includeRows) {
    footprint.readSet.tableRows[tableId] = observeTableRows(baseSnapshot, tableId);
  }
}

export function recordGetStickyNotesFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  pageId: unknown,
) {
  if (pageId === undefined) {
    footprint.readSet.allStickiesHash = canonicalHash(baseSnapshot.stickyNotes ?? []);
    return;
  }
  if (typeof pageId === 'string') {
    footprint.readSet.pages[pageId] = observePageState(baseSnapshot, pageId);
    footprint.readSet.pageKnownInCatalog[pageId] = isKnownCatalogOrSourcePage(baseSnapshot, pageId);
    footprint.readSet.stickiesByPage[pageId] = computeStickiesForPageHash(baseSnapshot, pageId);
  }
}

export function recordGetProjectNotesFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  args: Record<string, unknown>,
) {
  const baseCatalog = Array.isArray(baseSnapshot.projectNotes) ? baseSnapshot.projectNotes : [];
  if (Array.isArray(args.noteIds)) {
    for (const id of args.noteIds) {
      if (typeof id === 'string') {
        footprint.noteExists[id] = baseCatalog.some(note => note.noteId === id);
      }
    }
  }
  if (typeof args.pageId === 'string') {
    footprint.readSet.pageKnownInCatalog[args.pageId] = isKnownCatalogOrSourcePage(baseSnapshot, args.pageId);
  }
  const offset = args.offset === undefined ? 0 : args.offset;
  const limit = args.limit === undefined ? 10 : args.limit;
  const charOffset = args.charOffset === undefined ? 0 : args.charOffset;
  const maxChars = args.maxChars === undefined ? 20000 : args.maxChars;
  if (
    typeof offset !== 'number' ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    typeof charOffset !== 'number' ||
    !Number.isInteger(charOffset) ||
    charOffset < 0 ||
    typeof maxChars !== 'number' ||
    !Number.isInteger(maxChars) ||
    maxChars < 1000 ||
    maxChars > 50000
  ) {
    return;
  }
  if (
    args.noteIds !== undefined &&
    (!Array.isArray(args.noteIds) ||
      args.noteIds.length > 20 ||
      args.noteIds.some(id => typeof id !== 'string'))
  ) {
    return;
  }
  if (args.pageId !== undefined && typeof args.pageId !== 'string') {
    return;
  }
  // If any requested noteId does not exist in baseCatalog, noteExists above already locked its absence.
  if (
    Array.isArray(args.noteIds) &&
    args.noteIds.some(id => !baseCatalog.some(note => note.noteId === id))
  ) {
    return;
  }
  if (typeof args.pageId === 'string' && !isKnownCatalogOrSourcePage(baseSnapshot, args.pageId)) {
    return;
  }
  const proof = buildNoteDocumentQueryProof(baseSnapshot, {
    noteIds: Array.isArray(args.noteIds) ? (args.noteIds as string[]) : null,
    pageId: typeof args.pageId === 'string' ? args.pageId : null,
    offset,
    limit,
    charOffset,
    maxChars,
  });
  footprint.noteQueries[proof.key] = proof;
}

export function recordReviewDbRequirementsFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  sourceId: unknown,
  hasFindings: boolean,
) {
  footprint.readSet.requirementSourcesHash = canonicalHash(baseSnapshot.requirementSources ?? []);
  footprint.readSet.databaseRequirementsHash = canonicalHash(baseSnapshot.databaseRequirements ?? []);
  footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
  if (hasFindings && typeof sourceId === 'string' && sourceId) {
    if (!hasOwn(footprint.writeSet.requirementSources, sourceId)) {
      const prev = (baseSnapshot.databaseRequirements ?? []).find(r => r.id === sourceId) ?? null;
      footprint.writeSet.requirementSources[sourceId] = prev ? canonicalHash(prev) : null;
    }
  }
}

export function recordPageMutationFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  pageId: unknown,
  nextSource: string | undefined,
  isEditBlock: boolean,
  isProjectKind: boolean,
) {
  if (typeof pageId !== 'string' || !pageId) return;
  if (isEditBlock) {
    footprint.readSet.pages[pageId] = observePageState(baseSnapshot, pageId);
  }
  if (!hasOwn(footprint.writeSet.pages, pageId)) {
    footprint.writeSet.pages[pageId] = observePageState(baseSnapshot, pageId);
  }
  footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
  const tableIds = new Set([
    ...extractSourceBoundTableIds(baseSnapshot.pageSources?.[pageId]),
    ...extractSourceBoundTableIds(nextSource),
  ]);
  for (const tid of tableIds) {
    footprint.readSet.tables[tid] = observeTable(baseSnapshot, tid);
    footprint.readSet.tableRows[tid] = observeTableRows(baseSnapshot, tid);
  }
  if (isProjectKind) {
    recordPageReadinessInputs(footprint, baseSnapshot, pageId);
  }
}

export function recordTableMutationFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  tableId: unknown,
  columns: Array<{ isForeignKey?: boolean; references?: string }> | undefined,
) {
  footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
  footprint.readSet.sitemapTopologyHash = computeSitemapTopologyHash(baseSnapshot);
  if (typeof tableId === 'string' && tableId) {
    if (!hasOwn(footprint.writeSet.tables, tableId)) {
      footprint.writeSet.tables[tableId] = observeWriteTablePreimage(baseSnapshot, tableId);
    }
    // Any planned dependency links referencing this table depend on its bound pages' sources in regressedPageDependencies.
    for (const page of baseSnapshot.projectPlan?.pages ?? []) {
      for (const dep of page.dependencies ?? []) {
        if (
          (dep.kind !== 'pending' && dep.sourceTableId === tableId) ||
          (dep.kind === 'foreignKey' && dep.tableId === tableId)
        ) {
          footprint.readSet.pages[page.pageId] = observePageState(baseSnapshot, page.pageId);
          footprint.readSet.pages[dep.sourcePageId] = observePageState(baseSnapshot, dep.sourcePageId);
        }
      }
    }
  }
  for (const col of columns ?? []) {
    if (col && (col.isForeignKey || col.references)) {
      recordForeignKeyColumn(footprint, baseSnapshot, col.references, false);
    }
  }
}

export function recordPreviewScenarioFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  candidateSnapshot: FootprintSnapshotView,
  datasets: unknown,
) {
  footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
  if (!Array.isArray(datasets)) return;
  for (const item of datasets) {
    if (!item || typeof item !== 'object') continue;
    const tid = (item as { tableId?: unknown }).tableId;
    if (typeof tid !== 'string' || !tid) continue;
    footprint.readSet.tables[tid] = observeTable(baseSnapshot, tid);
    footprint.readSet.tableRows[tid] = observeTableRows(baseSnapshot, tid);
    if (!hasOwn(footprint.writeSet.tableRows, tid)) {
      footprint.writeSet.tableRows[tid] = observeTableRows(baseSnapshot, tid);
    }
    const candidateTable = (candidateSnapshot.dbTables ?? []).find(t => t.id === tid);
    const baseTable = (baseSnapshot.dbTables ?? []).find(t => t.id === tid);
    for (const col of [...(baseTable?.columns ?? []), ...(candidateTable?.columns ?? [])]) {
      if (col && (col.isForeignKey || col.references)) {
        recordForeignKeyColumn(footprint, baseSnapshot, col.references, true);
      }
    }
  }
}

export function recordStickyMutationFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  stickyId: unknown,
) {
  if (typeof stickyId !== 'string' || !stickyId) return;
  if (!hasOwn(footprint.writeSet.stickies, stickyId)) {
    footprint.writeSet.stickies[stickyId] = observeWriteStickyPreimage(baseSnapshot, stickyId);
  }
}

export function recordOtherMutationFootprint(
  footprint: DependencyFootprintV3,
  baseSnapshot: FootprintSnapshotView,
  toolName: string,
  args: Record<string, unknown>,
) {
  if (
    toolName === 'protoflow_set_project_plan' ||
    toolName === 'protoflow_revise_project_page' ||
    toolName === 'protoflow_upsert_folder' ||
    toolName === 'protoflow_move_sitemap_item'
  ) {
    footprint.readSet.sitemapTopologyHash = computeSitemapTopologyHash(baseSnapshot);
    if (footprint.writeSet.projectPlanHash === undefined) {
      footprint.writeSet.projectPlanHash = canonicalHash(baseSnapshot.projectPlan ?? null);
    }
    if (toolName === 'protoflow_set_project_plan') {
      footprint.readSet.mindmapsHash = canonicalHash(baseSnapshot.mindmaps ?? null);
    }
  } else if (
    toolName === 'protoflow_upsert_project_agreement' ||
    toolName === 'protoflow_remove_project_agreement'
  ) {
    const id =
      toolName === 'protoflow_remove_project_agreement'
        ? args.id
        : (args.agreement as { id?: unknown } | undefined)?.id;
    footprint.readSet.allProjectAgreementsHash = canonicalHash(baseSnapshot.projectAgreements ?? []);
    if (typeof id === 'string' && id && !hasOwn(footprint.writeSet.agreements, id)) {
      const prev = (baseSnapshot.projectAgreements ?? []).find(a => a.id === id) ?? null;
      footprint.writeSet.agreements[id] = prev ? canonicalHash(prev) : null;
    }
  } else if (toolName === 'protoflow_run_closed_loop_audit') {
    footprint.readSet.allClosedLoopIssuesHash = canonicalHash(baseSnapshot.closedLoopIssues ?? []);
    footprint.readSet.allDbTablesHash = computeAllDbTablesHash(baseSnapshot);
    footprint.readSet.allPageSourcesHash = computeAllPageSourcesHash(baseSnapshot);
    if (footprint.writeSet.closedLoopIssuesHash === undefined) {
      footprint.writeSet.closedLoopIssuesHash = canonicalHash(baseSnapshot.closedLoopIssues ?? []);
    }
  }
}

export type VerifyFootprintResult =
  | { ok: true }
  | { ok: false; changedSections: string[]; reason: string };

export function verifyDependencyFootprint(
  liveSnapshot: FootprintSnapshotView,
  footprint: unknown,
): VerifyFootprintResult {
  if (!footprint || typeof footprint !== 'object' || (footprint as DependencyFootprintV3).version !== 3) {
    return {
      ok: false,
      changedSections: ['version'],
      reason: '缺少有效的 v3 依赖记录',
    };
  }
  const fp = footprint as DependencyFootprintV3;
  const changed = new Set<string>();
  const rs = fp.readSet;

  const checkEqual = (section: string, actual: unknown, expected: unknown) => {
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      changed.add(section);
    }
  };

  if (rs.allDbTablesHash !== undefined) {
    checkEqual('dbTables', computeAllDbTablesHash(liveSnapshot), rs.allDbTablesHash);
  }
  if (rs.sitemapTopologyHash !== undefined) {
    checkEqual('sitemapTopology', computeSitemapTopologyHash(liveSnapshot), rs.sitemapTopologyHash);
  }
  if (rs.allProjectAgreementsHash !== undefined) {
    checkEqual(
      'projectAgreements',
      canonicalHash(liveSnapshot.projectAgreements ?? []),
      rs.allProjectAgreementsHash,
    );
  }
  if (rs.mindmapsHash !== undefined) {
    checkEqual('mindmaps', canonicalHash(liveSnapshot.mindmaps ?? null), rs.mindmapsHash);
  }
  for (const [mindmapId, expectedNode] of Object.entries(rs.mindmapNodes ?? {})) {
    checkEqual(`mindmaps.${mindmapId}`, observeMindmapNode(liveSnapshot, mindmapId), expectedNode);
  }
  for (const [pid, expectedKnown] of Object.entries(rs.knownNavigablePages ?? {})) {
    checkEqual(`knownPage.${pid}`, isKnownPlanOrSourcePage(liveSnapshot, pid), expectedKnown);
  }
  if (rs.compositeBlocksHash !== undefined) {
    checkEqual(
      'compositeBlocks',
      canonicalHash(liveSnapshot.compositeBlocks ?? []),
      rs.compositeBlocksHash,
    );
  }
  if (rs.contractsWidgetsHash !== undefined) {
    checkEqual(
      'contracts',
      canonicalHash(computeProjectContractsMeta(liveSnapshot)),
      rs.contractsWidgetsHash,
    );
  }
  if (rs.allPageSourcesHash !== undefined) {
    checkEqual('pageSources', computeAllPageSourcesHash(liveSnapshot), rs.allPageSourcesHash);
  }
  if (rs.allStickiesHash !== undefined) {
    checkEqual(
      'stickyNotes',
      canonicalHash(liveSnapshot.stickyNotes ?? []),
      rs.allStickiesHash,
    );
  }
  if (rs.allClosedLoopIssuesHash !== undefined) {
    checkEqual(
      'closedLoopIssues',
      canonicalHash(liveSnapshot.closedLoopIssues ?? []),
      rs.allClosedLoopIssuesHash,
    );
  }
  if (rs.requirementSourcesHash !== undefined) {
    checkEqual(
      'requirementSources',
      canonicalHash(liveSnapshot.requirementSources ?? []),
      rs.requirementSourcesHash,
    );
  }
  if (rs.databaseRequirementsHash !== undefined) {
    checkEqual(
      'databaseRequirements',
      canonicalHash(liveSnapshot.databaseRequirements ?? []),
      rs.databaseRequirementsHash,
    );
  }

  for (const [pid, expectedHash] of Object.entries(rs.stickiesByPage ?? {})) {
    checkEqual(`stickyNotes.page.${pid}`, computeStickiesForPageHash(liveSnapshot, pid), expectedHash);
  }
  for (const [pid, expectedHash] of Object.entries(rs.issuesByPage ?? {})) {
    checkEqual(`closedLoopIssues.page.${pid}`, computeIssuesForPageHash(liveSnapshot, pid), expectedHash);
  }
  for (const [pid, expectedState] of Object.entries(rs.pages ?? {})) {
    checkEqual(`pages.${pid}`, observePageState(liveSnapshot, pid), expectedState);
  }
  for (const [pid, expectedKnown] of Object.entries(rs.pageKnownInCatalog ?? {})) {
    checkEqual(`pageCatalog.${pid}`, isKnownCatalogOrSourcePage(liveSnapshot, pid), expectedKnown);
  }
  for (const [tid, expectedTable] of Object.entries(rs.tables ?? {})) {
    checkEqual(`tables.${tid}`, observeTable(liveSnapshot, tid), expectedTable);
  }
  for (const [tid, expectedRows] of Object.entries(rs.tableRows ?? {})) {
    checkEqual(`tableRows.${tid}`, observeTableRows(liveSnapshot, tid), expectedRows);
  }

  // Recompute brief-derived slices for every recorded brief scope.
  const briefScopes = new Set<string>([
    ...Object.keys(rs.agreementsByScope ?? {}),
    ...Object.keys(rs.pageCatalogByScope ?? {}),
    ...Object.keys(rs.relatedPagesByScope ?? {}),
    ...Object.keys(rs.dependencyReviewByScope ?? {}),
    ...Object.keys(rs.activeStickiesByScope ?? {}),
    ...Object.keys(rs.planSliceByScope ?? {})
      .filter(k => k.startsWith('brief:'))
      .map(k => k.slice('brief:'.length)),
  ]);

  if (rs.agreementCatalogHash !== undefined || rs.tableCatalogHash !== undefined || rs.relationIssuesHash !== undefined || briefScopes.size > 0) {
    const keysToEvaluate = briefScopes.size > 0 ? [...briefScopes] : [briefScopeKey({}, fp.workflowPhase === 'generating' ? fp.targetPageId ?? undefined : undefined)];
    for (const sKey of keysToEvaluate) {
      const parsed = parseBriefScopeKey(sKey);
      if (!parsed) {
        changed.add('brief.scope');
        continue;
      }
      const focus: { pageId?: string; folderId?: string } = {
        ...(parsed.pageId !== null ? { pageId: parsed.pageId } : {}),
        ...(parsed.folderId !== null ? { folderId: parsed.folderId } : {}),
      };
      let liveBrief: ReturnType<typeof projectExecutionBrief>;
      try {
        liveBrief = computeBriefOnSnapshot(liveSnapshot, focus, parsed.generatingTargetPageId);
      } catch {
        changed.add('brief');
        continue;
      }
      if (rs.agreementCatalogHash !== undefined) {
        checkEqual('agreementCatalog', canonicalHash(liveBrief.agreementCatalog), rs.agreementCatalogHash);
      }
      if (rs.tableCatalogHash !== undefined) {
        checkEqual('tableCatalog', canonicalHash(liveBrief.tableCatalog), rs.tableCatalogHash);
      }
      if (rs.relationIssuesHash !== undefined) {
        checkEqual('relationIssues', canonicalHash(liveBrief.relationIssues), rs.relationIssuesHash);
      }
      if (hasOwn(rs.agreementsByScope, sKey)) {
        checkEqual('agreements', canonicalHash(liveBrief.agreements), rs.agreementsByScope[sKey]);
      }
      if (hasOwn(rs.planSliceByScope, 'brief:' + sKey)) {
        checkEqual('plan.brief', canonicalHash(liveBrief.plan), rs.planSliceByScope['brief:' + sKey]);
      }
      if (hasOwn(rs.pageCatalogByScope, sKey)) {
        checkEqual('pageCatalog.brief', canonicalHash(liveBrief.pageCatalog), rs.pageCatalogByScope[sKey]);
      }
      if (hasOwn(rs.relatedPagesByScope, sKey)) {
        checkEqual('relatedPages', canonicalHash(liveBrief.relatedPages), rs.relatedPagesByScope[sKey]);
      }
      if (hasOwn(rs.dependencyReviewByScope, sKey)) {
        checkEqual('dependencyReview', canonicalHash(liveBrief.dependencyReview), rs.dependencyReviewByScope[sKey]);
      }
      if (hasOwn(rs.activeStickiesByScope, sKey)) {
        checkEqual(
          'stickyNotes.brief',
          canonicalHash({
            catalog: liveBrief.requirementCatalog,
            requirements: liveBrief.requirements,
          }),
          rs.activeStickiesByScope[sKey],
        );
      }
      if (hasOwn(fp.noteCatalogByScope, 'brief:' + sKey)) {
        const liveNotes = Array.isArray(liveSnapshot.projectNotes)
          ? liveSnapshot.projectNotes.filter(
              note =>
                (!focus.pageId && !focus.folderId) ||
                note.relatedPageIds.some(id => liveBrief.pageCatalog.some(page => page.pageId === id)),
            )
          : [];
        checkEqual('projectNotes.brief', noteCatalogProof(liveNotes), fp.noteCatalogByScope['brief:' + sKey]);
      }
    }
  }

  for (const [pKey, expectedHash] of Object.entries(rs.planSliceByScope ?? {})) {
    if (pKey.startsWith('brief:')) continue;
    if (pKey === 'get_project:full') {
      checkEqual('projectPlan', canonicalHash(liveSnapshot.projectPlan ?? null), expectedHash);
    } else if (pKey.startsWith('get_project:generating:')) {
      const pid = pKey.slice('get_project:generating:'.length);
      checkEqual(
        `projectPlan.generating.${pid}`,
        canonicalHash(buildNarrowedProjectPlan(liveSnapshot, pid)),
        expectedHash,
      );
    } else {
      try {
        const parsed = JSON.parse(pKey) as { readinessPage?: string };
        if (typeof parsed?.readinessPage === 'string') {
          const planPage = liveSnapshot.projectPlan?.pages?.find(p => p.pageId === parsed.readinessPage);
          checkEqual(`projectPlan.page.${parsed.readinessPage}`, canonicalHash(planPage), expectedHash);
        }
      } catch {
        changed.add('projectPlan');
      }
    }
  }

  for (const [refTableName, expectedIds] of Object.entries(fp.tableNameBindings ?? {})) {
    checkEqual(
      `tableNameBindings.${refTableName}`,
      computeMatchingTableIdsByPhysicalName(liveSnapshot, refTableName),
      expectedIds,
    );
  }

  const liveNoteCatalog = resolveNoteContext(liveSnapshot).catalog;
  for (const [nKey, expectedItems] of Object.entries(fp.noteCatalogByScope ?? {})) {
    if (nKey.startsWith('brief:')) continue;
    if (nKey === 'get_project:full') {
      checkEqual('projectNotes.catalog', noteCatalogProof(liveNoteCatalog), expectedItems);
    } else if (nKey.startsWith('get_project:generating:')) {
      const pid = nKey.slice('get_project:generating:'.length);
      checkEqual(
        `projectNotes.generating.${pid}`,
        noteCatalogProof(
          filterGeneratingProjectNotes(liveNoteCatalog, liveSnapshot.projectPlan, pid),
        ),
        expectedItems,
      );
    }
  }

  for (const [noteId, expectedExists] of Object.entries(fp.noteExists ?? {})) {
    checkEqual(`projectNotes.exists.${noteId}`, liveNoteCatalog.some(n => n.noteId === noteId), expectedExists);
  }
  for (const [qKey, expectedProof] of Object.entries(fp.noteQueries ?? {})) {
    const liveProof = buildNoteDocumentQueryProof(liveSnapshot, {
      noteIds: expectedProof.noteIds,
      pageId: expectedProof.pageId,
      offset: expectedProof.offset,
      limit: expectedProof.limit,
      charOffset: expectedProof.charOffset,
      maxChars: expectedProof.maxChars,
    });
    checkEqual(`projectNotes.query.${qKey}`, liveProof, expectedProof);
  }

  // Verify WriteSet preimages.
  const ws = fp.writeSet;
  for (const [pid, expectedPreimage] of Object.entries(ws.pages ?? {})) {
    checkEqual(`writeSet.pages.${pid}`, observePageState(liveSnapshot, pid), expectedPreimage);
  }
  for (const [tid, expectedPreimage] of Object.entries(ws.tables ?? {})) {
    checkEqual(`writeSet.tables.${tid}`, observeWriteTablePreimage(liveSnapshot, tid), expectedPreimage);
  }
  for (const [tid, expectedPreimage] of Object.entries(ws.tableRows ?? {})) {
    checkEqual(`writeSet.tableRows.${tid}`, observeTableRows(liveSnapshot, tid), expectedPreimage);
  }
  for (const [sid, expectedPreimage] of Object.entries(ws.stickies ?? {})) {
    checkEqual(`writeSet.stickies.${sid}`, observeWriteStickyPreimage(liveSnapshot, sid), expectedPreimage);
  }
  for (const [sourceId, expectedHash] of Object.entries(ws.requirementSources ?? {})) {
    const liveRec = (liveSnapshot.databaseRequirements ?? []).find(r => r.id === sourceId) ?? null;
    checkEqual(
      `writeSet.requirementSources.${sourceId}`,
      liveRec ? canonicalHash(liveRec) : null,
      expectedHash,
    );
  }
  for (const [aid, expectedHash] of Object.entries(ws.agreements ?? {})) {
    const liveAgr = (liveSnapshot.projectAgreements ?? []).find(a => a.id === aid) ?? null;
    checkEqual(`writeSet.agreements.${aid}`, liveAgr ? canonicalHash(liveAgr) : null, expectedHash);
  }
  if (ws.projectPlanHash !== undefined) {
    checkEqual('writeSet.projectPlan', canonicalHash(liveSnapshot.projectPlan ?? null), ws.projectPlanHash);
  }
  if (ws.closedLoopIssuesHash !== undefined) {
    checkEqual(
      'writeSet.closedLoopIssues',
      canonicalHash(liveSnapshot.closedLoopIssues ?? []),
      ws.closedLoopIssuesHash,
    );
  }

  if (changed.size > 0) {
    const changedSections = [...changed];
    return {
      ok: false,
      changedSections,
      reason: changedSections.slice(0, 6).join(', '),
    };
  }
  return { ok: true };
}
