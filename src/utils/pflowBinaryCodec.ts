import { columnDefaultSql } from '../proto/database/columnDefault';
import { uniqueConstraintSql, sqlIdentifier } from '../proto/database/uniqueConstraints';
import { diagramRelations } from '../proto/database/relations';
import type { ProjectPlan } from '../services/projectPlan';
import { projectPageCatalog, projectSpecification } from '../services/projectAnalysis';
import { noteAssetExtension, noteHtmlToMarkdown, type NoteWorkspace } from '../proto/notes';
import type { ProtoStore, SitemapItem } from '../store/useProtoStore';
import type { DesignerPage } from '../proto/store/usePageStore';
import type { DesignerFolder, SitemapOverrides } from '../proto/sitemap';
import type { Row } from '../proto/runtime/mock';
import type { ProjectMode } from '../proto/mobile/types';
import { tr } from '../i18n/runtime';

/**
 * Alex Binary Archive Codec (.pflow)
 *
 * Binary File Layout:
 * - Bytes 0..5   (6 bytes): Magic Header "PFLOW\x01" (0x50, 0x46, 0x4C, 0x4F, 0x57, 0x01)
 * - Bytes 6..9   (4 bytes): Format Version UInt32BE (e.g. 1)
 * - Bytes 10..13 (4 bytes): Checksum UInt32BE (FNV-1a hash of payload bytes)
 * - Bytes 14..17 (4 bytes): Payload Byte Length UInt32BE
 * - Bytes 18..N  (N bytes): Obfuscated UTF-8 Binary Payload (XOR stream cipher with 0x5A key so file is true binary on disk)
 */

const MAGIC_BYTES = new Uint8Array([0x50, 0x46, 0x4c, 0x4f, 0x57, 0x01]); // "PFLOW\x01"
const HEADER_SIZE = 18;
const XOR_KEY = 0x5a;

export interface PflowProjectMetadata {
  projectId: string;
  projectName: string;
  storageDir: string;
  fileName: string;
  templateId: 'saas_inventory' | 'crm_analytics' | 'blank_project' | 'mobile_starter' | 'customs_erp' | 'supply_chain';
  /** Optional terminal orientation for the project; absent in older archives defaults to 'desktop'. */
  projectMode?: ProjectMode;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  tableCount: number;
  stickyCount: number;
}

export type ProjectStateSnapshot = Pick<ProtoStore,
  'activePageId' | 'dbTables' | 'stickyNotes' | 'suppliers' | 'purchaseOrderItems' |
  'acceptanceOrders' | 'closedLoopIssues' | 'widgets' | 'draftAcceptanceHeader' | 'draftAcceptanceLines' | 'mindmaps'
> & {
  /** Absent in older V7 archives; no project plan existed. */
  databaseRequirements?: ProtoStore['databaseRequirements'];
  projectPlan?: ProjectPlan | null;
  /** Older V7 projects have no saved agreements. */
  projectAgreements?: import('../services/projectKnowledge').ProjectAgreement[];
  /** Optional canvas-scoped Design Tokens preset & overrides; absent in older V7 archives. */
  designTokens?: import('../proto/theme/designTokens').ProjectDesignTokens | null;
  projectNotes?: NoteWorkspace;
  pageSources: Record<string, string>;
  designerPages: DesignerPage[];
  sitemapBase: SitemapItem[];
  designerFolders: DesignerFolder[];
  sitemapOverrides: SitemapOverrides;
  tableRows: Record<string, Row[]>;
};

export interface PflowBinaryPayload {
  schemaVersion: 7;
  meta: PflowProjectMetadata;
  stateSnapshot: ProjectStateSnapshot;
}

function fnv1a32(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Encode a project payload into a real binary .pflow Uint8Array
 */
export function encodePflowBinary(payload: PflowBinaryPayload): Uint8Array {
  const jsonStr = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(jsonStr);

  // Apply lightweight binary XOR transformation so the file on disk is a genuine binary stream
  const encodedPayload = new Uint8Array(rawBytes.length);
  for (let i = 0; i < rawBytes.length; i++) {
    encodedPayload[i] = rawBytes[i] ^ ((XOR_KEY + (i & 0x1f)) & 0xff);
  }

  const checksum = fnv1a32(rawBytes);
  const output = new Uint8Array(HEADER_SIZE + encodedPayload.length);
  const view = new DataView(output.buffer);

  // 1. Write 6-byte Magic Header "PFLOW\x01"
  output.set(MAGIC_BYTES, 0);
  // 2. Write 4-byte Format Version (v1)
  view.setUint32(6, 2, false);
  // 3. Write 4-byte FNV-1a Checksum
  view.setUint32(10, checksum, false);
  // 4. Write 4-byte Payload Length
  view.setUint32(14, encodedPayload.length, false);
  // 5. Write Binary Payload
  output.set(encodedPayload, HEADER_SIZE);

  return output;
}

/**
 * Decode a binary .pflow ArrayBuffer / Uint8Array back into structured project data.
 * Also supports legacy plain-JSON .pflow files for backward compatibility.
 */
export function decodePflowBinary(buffer: ArrayBuffer | Uint8Array): unknown {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // Check if it starts with "PFLOW\x01" binary magic header
  const isMagicMatch =
    bytes.length >= HEADER_SIZE &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x46 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x4f &&
    bytes[4] === 0x57 &&
    bytes[5] === 0x01;

  if (isMagicMatch) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(6, false);
    if (version !== 1 && version !== 2) throw new Error(tr(`不支持的工程格式版本：${version}`, `Unsupported project format version: ${version}`));
    const payloadLength = view.getUint32(14, false);
    if (bytes.length !== HEADER_SIZE + payloadLength) throw new Error(tr('工程文件长度校验失败', 'Project file byte length check failed'));
    const encodedPayload = bytes.subarray(HEADER_SIZE, HEADER_SIZE + payloadLength);

    const decodedBytes = new Uint8Array(encodedPayload.length);
    for (let i = 0; i < encodedPayload.length; i++) {
      decodedBytes[i] = encodedPayload[i] ^ ((XOR_KEY + (i & 0x1f)) & 0xff);
    }

    if (fnv1a32(decodedBytes) !== view.getUint32(10, false)) throw new Error(tr('工程文件校验和不匹配', 'Project file checksum mismatch'));
    const decoder = new TextDecoder('utf-8');
    const jsonStr = decoder.decode(decodedBytes);
    return JSON.parse(jsonStr);
  }

  // Fallback: attempt UTF-8 JSON parse if user selected a JSON-formatted .pflow file
  const decoder = new TextDecoder('utf-8');
  const text = decoder.decode(bytes);
  const parsed = JSON.parse(text);
  if (parsed.meta && parsed.stateSnapshot) {
    return parsed;
  }

  // Explicit migration of the original JSON bundle, which did not store editor state.
  if (!parsed.projectMeta || typeof parsed.projectMeta.name !== 'string' ||
      !Array.isArray(parsed.databaseErSchemas) || !Array.isArray(parsed.componentAnchoredStickyNotes) ||
      !parsed.embeddedReactiveSqliteDump) throw new Error(tr('不是有效的 Alex 工程文件', 'Not a valid Alex project file'));
  return {
    meta: {
      projectId: `proj-${crypto.randomUUID()}`,
      projectName: parsed.projectMeta.name,
      storageDir: '~/Desktop/ProtoFlowProjects',
      fileName: `${parsed.projectMeta?.name || 'project'}.pflow`,
      templateId: 'saas_inventory',
      createdAt: parsed.projectMeta?.exportedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pageCount: parsed.projectMeta?.totalPages || 130,
      tableCount: parsed.databaseErSchemas.length,
      stickyCount: parsed.componentAnchoredStickyNotes.length,
    },
    stateSnapshot: {
      activePageId: 'acceptance-new',
      dbTables: parsed.databaseErSchemas || [],
      stickyNotes: parsed.componentAnchoredStickyNotes || [],
      suppliers: parsed.embeddedReactiveSqliteDump?.suppliers || [],
      purchaseOrderItems: parsed.embeddedReactiveSqliteDump?.purchaseOrderItems || [],
      acceptanceOrders: parsed.embeddedReactiveSqliteDump?.acceptanceOrders || [],
      closedLoopIssues: parsed.closedLoopAuditTrail || [],
    },
  };
}

/**
 * Generate a classic Hex Editor preview string of the first N bytes of a binary .pflow file
 */
export function formatBinaryHexPreview(bytes: Uint8Array, maxBytes = 64): string {
  const slice = bytes.subarray(0, Math.min(bytes.length, maxBytes));
  const lines: string[] = [];

  for (let offset = 0; offset < slice.length; offset += 16) {
    const row = slice.subarray(offset, offset + 16);
    const hexPart = Array.from(row)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ')
      .padEnd(47, ' ');
    const asciiPart = Array.from(row)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`${offset.toString(16).padStart(4, '0').toUpperCase()}  ${hexPart}  |${asciiPart}|`);
  }
  return lines.join('\n');
}

export interface UnpackedGitFileEntry {
  relativePath: string;
  folder: 'root' | 'pages' | 'sticky-notes' | 'database' | 'database/tables' | 'database/migrations' | 'ai-audit';
  description: string;
  content: string;
  /** Binary files (note images) carry base64 content and are decoded when written. */
  encoding?: 'base64';
}

/**
 * Expand a .pflow project into fine-grained, Git-diffable source files so multiple PMs and developers
 * can collaborate via Git without binary merge conflicts (solving Axure .rp's biggest pain point).
 */
export function generateUnpackedGitFiles(
  payload: PflowBinaryPayload
): UnpackedGitFileEntry[] {
  const files: UnpackedGitFileEntry[] = [];

  // 1. Root .gitignore & protoflow.project.json
  files.push({
    relativePath: '.gitignore',
    folder: 'root',
    description: tr('Git 忽略规则 (排除临时缓存，保留所有页面/便签/表结构源码)', 'Git ignore rules (excludes temp cache while keeping all page, sticky note, and schema sources)'),
    content: `# Alex Unpacked Git Workspace
.DS_Store
*.tmp.pflow
.protoflow-cache/
`,
  });

  files.push({
    relativePath: 'protoflow.project.json',
    folder: 'root',
    description: tr('工程全局清单与模块目录索引', 'Project manifest and module directory index'),
    content: JSON.stringify(
      {
        schemaVersion: '2026.1-git-tree',
        projectId: payload.meta.projectId,
        snapshotUpdatedAt: payload.meta.updatedAt,
        projectName: payload.meta.projectName,
        templateId: payload.meta.templateId,
        totalPages: Object.keys(payload.stateSnapshot.pageSources).length,
        totalTables: payload.stateSnapshot.dbTables.length,
        storageMode: 'UNPACKED_GIT_TREE + BINARY_BUNDLE',
        menuFile: 'pages/sitemap-base.json',
      },
      null,
      2
    ),
  });

  files.push({ relativePath: 'pages/sitemap-base.json', folder: 'pages', description: tr('本工程的菜单模板', 'Base menu sitemap template'), content: JSON.stringify(payload.stateSnapshot.sitemapBase, null, 2) });
  files.push({ relativePath: 'mindmaps/index.json', folder: 'root', description: tr('脑图目录与页面关联', 'Mindmap index and page links'), content: JSON.stringify(payload.stateSnapshot.mindmaps, null, 2) });
  for (const node of payload.stateSnapshot.mindmaps.nodes) if (node.kind === 'mindmap') {
    // Encode the actual ID as a single path segment; user titles never become file paths.
    files.push({ relativePath: `mindmaps/${encodeURIComponent(node.id)}.mmd`, folder: 'root', description: node.title, content: node.source });
  }
  const notes = payload.stateSnapshot.projectNotes;
  if (notes && (notes.nodes.length > 0 || notes.links.length > 0)) {
    // index.json holds structure/metadata only; bodies live in readable .md files and
    // images in notes/assets, so Git diffs stay meaningful.
    const index = {
      nodes: notes.nodes.map((node) => {
        if (node.kind !== 'note') return node;
        const { content: _content, ...meta } = node;
        return { ...meta, file: `${encodeURIComponent(node.id)}.md` };
      }),
      links: notes.links,
      ...(notes.assets ? { assets: Object.fromEntries(Object.entries(notes.assets).map(([id, asset]) => [id, { mime: asset.mime, ...(asset.name ? { name: asset.name } : {}), file: `assets/${id}.${noteAssetExtension(asset)}` }])) } : {}),
    };
    files.push({ relativePath: 'notes/index.json', folder: 'root', description: tr('项目笔记目录、属性与页面关联', 'Project notes index, metadata, and page links'), content: JSON.stringify(index, null, 2) });
    for (const node of notes.nodes) if (node.kind === 'note') {
      files.push({ relativePath: `notes/${encodeURIComponent(node.id)}.md`, folder: 'root', description: tr(`项目笔记：${node.title}`, `Project note: ${node.title}`), content: noteHtmlToMarkdown(node, { images: 'link', assets: notes.assets, assetPath: (id, asset) => `assets/${id}.${noteAssetExtension(asset)}` }) });
    }
    for (const [id, asset] of Object.entries(notes.assets ?? {})) {
      files.push({ relativePath: `notes/assets/${id}.${noteAssetExtension(asset)}`, folder: 'root', description: tr(`笔记图片：${asset.name ?? id}`, `Note image: ${asset.name ?? id}`), content: asset.data, encoding: 'base64' });
    }
  }
  files.push({
    relativePath: 'pages/index.json', folder: 'pages', description: tr('自定义页面目录', 'Custom page directory'),
    content: JSON.stringify(payload.stateSnapshot.designerPages, null, 2),
  });
  files.push({
    relativePath: 'pages/folders.json', folder: 'pages', description: tr('自定义菜单目录及层级', 'Custom menu folders and hierarchy'),
    content: JSON.stringify(payload.stateSnapshot.designerFolders, null, 2),
  });
  files.push({
    relativePath: 'pages/sitemap-overrides.json', folder: 'pages', description: tr('模板菜单的自定义层级位置', 'Custom hierarchy overrides for template menus'),
    content: JSON.stringify(payload.stateSnapshot.sitemapOverrides, null, 2),
  });
  for (const [pageId, content] of Object.entries(payload.stateSnapshot.pageSources)) {
    if (!/^[A-Za-z0-9_-]+$/.test(pageId)) throw new Error(tr(`页面 ID 不能作为文件名：${pageId}`, `Page ID cannot be used as filename: ${pageId}`));
    files.push({ relativePath: `pages/${pageId}.page.tsx`, folder: 'pages', description: tr(`页面 ${pageId} 源码`, `Page ${pageId} source`), content });
  }

  const allTables = payload.stateSnapshot.dbTables;
  const allStickies = payload.stateSnapshot.stickyNotes;
  const pages = projectPageCatalog(payload.stateSnapshot);
  for (const page of pages) {
    const notes = allStickies.filter(note => note.pageId === page.pageId);
    if (!notes.length) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(page.pageId)) throw new Error(tr(`页面 ID 不能作为文件名：${page.pageId}`, `Page ID cannot be used as filename: ${page.pageId}`));
    files.push({ relativePath: `sticky-notes/${page.pageId}.pins.json`, folder:'sticky-notes', description:tr(`${page.title} 的需求记录`, `Sticky notes for ${page.title}`), content:JSON.stringify(notes,null,2) });
    files.push({
      relativePath: `sticky-notes/${page.pageId}.pins.md`,
      folder:'sticky-notes',
      description:tr(`${page.title} 的需求说明`, `Spec notes for ${page.title}`),
      content: tr(
        `# ${page.path} · 需求记录\n\n> 启用表示保留该需求，不代表业务规则已经实现或执行。\n\n${notes.map(note=>`### #${note.index} · ${note.targetWidgetName}\n- 页面：${note.pageId}\n- 组件：${note.targetWidgetId}\n- 记录状态：${note.active?'启用':'停用'}\n- 需求：${note.text}${note.compiledRule?`\n- 已保存的规则描述（未验证实现）：${note.compiledRule}`:''}\n`).join('\n')}`,
        `# ${page.path} · Requirement Notes\n\n> Active means the requirement note is retained; it does not mean the business rule is implemented.\n\n${notes.map(note=>`### #${note.index} · ${note.targetWidgetName}\n- Page: ${note.pageId}\n- Widget: ${note.targetWidgetId}\n- Status: ${note.active?'Active':'Inactive'}\n- Note: ${note.text}${note.compiledRule?`\n- Saved rule summary (unverified): ${note.compiledRule}`:''}\n`).join('\n')}`
      ),
    });
  }
  const unresolvedNotes = allStickies.filter(note => !pages.some(page=>page.pageId===note.pageId));
  if (unresolvedNotes.length) files.push({relativePath:'sticky-notes/unresolved.json',folder:'sticky-notes',description:tr('引用了目录外页面的历史便签，待修复','Legacy sticky notes referencing unlisted pages (pending fix)'),content:JSON.stringify(unresolvedNotes,null,2)});
  files.push({relativePath:'SPEC.md',folder:'root',description:tr('根据当前工程生成的规格与配置清单','Generated project specification and configuration inventory'),content:projectSpecification(payload)});

  // 4. Database Tables folder: one .table.json per physical table!
  allTables.forEach((tbl) => {
    files.push({
      relativePath: `database/tables/${tbl.tableName}.table.json`,
      folder: 'database/tables',
      description: tr(`物理表【${tbl.cnName}】结构与多菜单共表映射 (支持数据库表级 Git Diff)`, `Physical table [${tbl.cnName}] schema & shared menu mapping (table-level Git diff)`),
      content: JSON.stringify(
        {
          id: tbl.id,
          tableName: tbl.tableName,
          cnName: tbl.cnName,
          domain: tbl.domain,
          description: tbl.description,
          ...(tbl.modeling ? { modeling: tbl.modeling } : {}),
          ...(tbl.uniqueConstraints && { uniqueConstraints: tbl.uniqueConstraints }),
          sharedByMenus: tbl.sharedByMenus,
          columns: tbl.columns.map((c) => ({
            id: c.id,
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable,
            primaryKey: Boolean(c.isPrimaryKey),
            ...(c.isUnique === undefined ? {} : { isUnique: c.isUnique }),
            foreignKey: Boolean(c.isForeignKey),
            references: c.references || null,
            ...(c.foreignKeyOptions ? { foreignKeyOptions: c.foreignKeyOptions } : {}),
            ...(c.defaultValue === undefined ? {} : { defaultValue: c.defaultValue }),
            comment: c.comment,
          })),
        },
        null,
        2
      ),
    });
  });

  // 5. Reviewable schema draft, not a fabricated dated migration.
  const quote = (name: string) => sqlIdentifier(name, 'mysql');
  const commentLine = (value: string) => value.replace(/[\r\n]+/g, ' ');
  const ddlBlocks = allTables.map(tbl => {
    const columns = tbl.columns.map(c =>
      `  ${quote(c.name)} ${c.dataType} ${c.nullable ? 'NULL' : 'NOT NULL'}${c.isUnique ? ' UNIQUE' : ''}${c.defaultValue?.trim() ? ' DEFAULT ' + columnDefaultSql(c) : ''} COMMENT '${c.comment.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);
    const pk = tbl.columns.filter(c => c.isPrimaryKey);
    if (pk.length) columns.push(`  PRIMARY KEY (${pk.map(c => quote(c.name)).join(', ')})`);
    columns.push(...uniqueConstraintSql(tbl, 'mysql'));
    const pending = tbl.modeling?.pendingRules?.length;
    const boundary = pending ? tr(`-- 有 ${pending} 项业务规则未由本 DDL 实现，详见 SPEC.md 的数据库设计审查。\n`, `-- ${pending} business rule(s) are not enforced by this DDL; see Database Design Review in SPEC.md.\n`) : '';
    return tr(
      `${boundary}-- 表: ${tbl.tableName} (${commentLine(tbl.cnName)})\n-- 共表菜单: ${commentLine(tbl.sharedByMenus.map(m => m.menuTitle).join(' | '))}\nCREATE TABLE IF NOT EXISTS ${quote(tbl.tableName)} (\n${columns.join(',\n')}\n);`,
      `${boundary}-- Table: ${tbl.tableName} (${commentLine(tbl.cnName)})\n-- Shared menus: ${commentLine(tbl.sharedByMenus.map(m => m.menuTitle).join(' | '))}\nCREATE TABLE IF NOT EXISTS ${quote(tbl.tableName)} (\n${columns.join(',\n')}\n);`
    );
  });
  // Add relationships after all tables exist, including self/cyclic references.
  const graph = diagramRelations(allTables);
  const tableNames = new Map(allTables.map(t => [t.id, quote(t.tableName)]));
  for (const fk of graph.relations) {
    ddlBlocks.push(`ALTER TABLE ${tableNames.get(fk.toTableId)} ADD CONSTRAINT ${quote(fk.name)} FOREIGN KEY (${quote(fk.toColumnName)}) REFERENCES ${tableNames.get(fk.fromTableId)} (${quote(fk.fromColumnName)})${fk.onDelete ? ' ON DELETE ' + fk.onDelete : ''};`);
  }
  for (const issue of graph.issues) ddlBlocks.push(tr(`-- 待修复的外键：${commentLine(issue)}`, `-- Pending FK fix: ${commentLine(issue)}`));

  files.push({
    relativePath: 'database/schema.sql',
    folder: 'database',
    description: tr('当前 MySQL 表结构草稿，执行前需审核；不是数据库迁移记录', 'MySQL schema draft (review before executing; not a migration history)'),
    content: ddlBlocks.join('\n\n'),
  });

  // 6. AI Closed-Loop Audit Decisions
  files.push({
    relativePath: 'ai-audit/closed-loop-decisions.json',
    folder: 'ai-audit',
    description: tr('模块与项目需求闭环 AI 检测及问答修复记录', 'AI closed-loop audit and Q&A resolution log'),
    content: JSON.stringify(payload.stateSnapshot.closedLoopIssues, null, 2),
  });

  // 7. Overview of the actual exported project.
  files.unshift({
    relativePath: 'README.md',
    folder: 'root',
    description: tr('当前工程源码目录总览与需求记录', 'Project source tree overview and requirement notes'),
    content: tr(
      `# ${payload.meta.projectName} (Alex 工程源码目录)

> 本目录由 **Alex** 导出。使用 Alex 打开随附的 \`bundle/${payload.meta.fileName}\` 工程文件。源码可自行纳入 Git 版本管理；导出不会创建 Git 提交。

## 1. 数据库表与多菜单共表矩阵 (${allTables.length} 张物理表)

| 物理表名 | 中文名称 | 所属业务域 | 共用该表的模块菜单 |
| :--- | :--- | :--- | :--- |
${allTables
  .map(
    (t) =>
      `| \`${t.tableName}\` | ${t.cnName} | ${t.domain} | ${t.sharedByMenus
        .map((m) => m.menuTitle)
        .join('、')} |`
  )
  .join('\n')}

## 2. 组件需求记录 (${allStickies.length} 条)

${allStickies
  .map((s) => `- **📌 #${s.index} [${s.targetWidgetName}]**：${s.text}`)
  .join('\n')}
`,
      `# ${payload.meta.projectName} (Alex Unpacked Source Tree)

> Exported by **Alex**. Open the bundled \`bundle/${payload.meta.fileName}\` project archive in Alex. Source files can be tracked in Git; exporting does not create a Git commit.

## 1. Database Tables & Shared Menu Matrix (${allTables.length} Physical Tables)

| Physical Table | Display Name | Domain | Shared Menus |
| :--- | :--- | :--- | :--- |
${allTables
  .map(
    (t) =>
      `| \`${t.tableName}\` | ${t.cnName} | ${t.domain} | ${t.sharedByMenus
        .map((m) => m.menuTitle)
        .join(', ')} |`
  )
  .join('\n')}

## 2. Component Sticky Notes (${allStickies.length})

${allStickies
  .map((s) => `- **📌 #${s.index} [${s.targetWidgetName}]**: ${s.text}`)
  .join('\n')}
`
    ),
  });

  return files;
}

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  oldLineNo?: number;
  newLineNo?: number;
  text: string;
}

/**
 * Compute a readable line-by-line unified diff between two text snapshots
 */
export function computeUnifiedLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({
        type: 'context',
        oldLineNo: i + 1,
        newLineNo: j + 1,
        text: oldLines[i],
      });
      i++;
      j++;
    } else {
      // Look ahead a few lines to resync
      let resynced = false;
      for (let look = 1; look <= 6; look++) {
        if (i + look < oldLines.length && oldLines[i + look] === newLines[j]) {
          for (let k = 0; k < look; k++) {
            result.push({
              type: 'del',
              oldLineNo: i + 1,
              text: oldLines[i],
            });
            i++;
          }
          resynced = true;
          break;
        }
        if (j + look < newLines.length && oldLines[i] === newLines[j + look]) {
          for (let k = 0; k < look; k++) {
            result.push({
              type: 'add',
              newLineNo: j + 1,
              text: newLines[j],
            });
            j++;
          }
          resynced = true;
          break;
        }
      }

      if (!resynced) {
        if (i < oldLines.length) {
          result.push({ type: 'del', oldLineNo: i + 1, text: oldLines[i] });
          i++;
        }
        if (j < newLines.length) {
          result.push({ type: 'add', newLineNo: j + 1, text: newLines[j] });
          j++;
        }
      }
    }
  }

  return result;
}

export interface RecursiveDirectoryHandle {
  name: string;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<RecursiveDirectoryHandle>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: string | Uint8Array) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

/**
 * Write all unpacked Git files + optional binary .pflow bundle into a real local folder
 * using the browser File System Access API (showDirectoryPicker)
 */
export async function writeUnpackedGitTreeToDirectoryHandle(
  rootDirHandle: RecursiveDirectoryHandle,
  files: UnpackedGitFileEntry[],
  binaryBundle?: { fileName: string; bytes: Uint8Array }
): Promise<number> {
  let writtenCount = 0;

  for (const entry of files) {
    const parts = entry.relativePath.split('/').filter(Boolean);
    const fileName = parts.pop()!;
    let currentDir = rootDirHandle;

    for (const dirSegment of parts) {
      currentDir = await currentDir.getDirectoryHandle(dirSegment, { create: true });
    }

    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(
      entry.encoding === 'base64'
        ? Uint8Array.from(atob(entry.content), (c) => c.charCodeAt(0))
        : entry.content
    );
    await writable.close();
    writtenCount++;
  }

  if (binaryBundle) {
    const bundleDir = await rootDirHandle.getDirectoryHandle('bundle', { create: true });
    const binHandle = await bundleDir.getFileHandle(binaryBundle.fileName, {
      create: true,
    });
    const writable = await binHandle.createWritable();
    await writable.write(binaryBundle.bytes);
    await writable.close();
    writtenCount++;
  }

  return writtenCount;
}


