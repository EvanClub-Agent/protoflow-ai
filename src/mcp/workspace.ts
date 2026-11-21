import fs from 'node:fs';
import path from 'node:path';
import { isEnLocale, tr } from '../i18n/runtime';
import { printPageSource } from '../proto/dsl/printer';
import { emptyMindmaps } from '../proto/mindmaps';
import type { NoteLink, NoteNode, NoteWorkspace } from '../proto/notes';
import { emptySitemapOverrides } from '../proto/sitemap';
import type { DesignerPage } from '../proto/store/usePageStore';
import { normalizeProjectPayload } from '../services/projectStorage';
import { normalizePublishedSnapshot, type ReadablePublishedSnapshot } from '../services/publishedSnapshot';
import type { PublishedMenuItem } from '../services/publishedSitemap';
import { useProtoStore, type SitemapItem, type StickyNoteRule } from '../store/useProtoStore';
import { decodePflowBinary, type PflowBinaryPayload } from '../utils/pflowBinaryCodec';

export interface ParsedShareTarget {
  origin: string;
  shareId: string;
  shareUrl: string;
  mcpHttpUrl: string;
}

const SHARE_ID_RE = /^[A-Za-z0-9_-]{20,80}$/;

function isLocalNetworkHost(host: string): boolean {
  if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return true;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  return (
    parts.every((n) => n <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))
  );
}

/**
 * Parse either a share preview link (`https://host/p/<id>`) or a remote MCP HTTP URL
 * (`https://host/api/v1/mcp/<id>`) into canonical endpoints.
 */
export function parseShareUrl(rawUrl: string): ParsedShareTarget {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    throw new Error(tr(`无效的在线分享链接：${rawUrl}`, `Invalid online share URL: ${rawUrl}`));
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalNetworkHost(u.hostname))) {
    throw new Error(
      tr(
        '在线分享地址必须使用 HTTPS（本机 localhost 或内网 IP 允许 HTTP）',
        'Online share URL must use HTTPS (HTTP is allowed for localhost and private LAN IPs)'
      )
    );
  }
  if (u.username || u.password) {
    throw new Error(
      tr(
        '在线分享链接不应在 URL 内包含账号密码，请使用独立的 password 参数',
        'Online share URL must not embed credentials; pass the password parameter separately'
      )
    );
  }
  const pMatch = /^\/p\/([A-Za-z0-9_-]{20,80})\/?$/.exec(u.pathname);
  const mcpMatch = /^\/api\/v1\/mcp\/([A-Za-z0-9_-]{20,80})\/?$/.exec(u.pathname);
  const viewMatch = /^\/api\/v1\/view\/([A-Za-z0-9_-]{20,80})\/?$/.exec(u.pathname);
  const shareId = pMatch?.[1] ?? mcpMatch?.[1] ?? viewMatch?.[1];
  if (!shareId || !SHARE_ID_RE.test(shareId)) {
    throw new Error(
      tr(
        '链接格式无效：请提供完整的在线原型链接（如 https://proto.example.com/p/<shareId>）',
        'Invalid share URL format: provide a full online prototype link (e.g., https://proto.example.com/p/<shareId>)'
      )
    );
  }
  return {
    origin: u.origin,
    shareId,
    shareUrl: `${u.origin}/p/${shareId}`,
    mcpHttpUrl: `${u.origin}/api/v1/mcp/${shareId}`,
  };
}

function convertPublishedSitemap(items: PublishedMenuItem[]): SitemapItem[] {
  const result: SitemapItem[] = [];
  for (const item of items) {
    if (item.type === 'folder') {
      result.push({
        id: item.id,
        title: item.title,
        type: 'folder',
        deprecated: item.deprecated,
        children: convertPublishedSitemap(item.children),
      });
    } else if (item.pageId !== null) {
      result.push({
        id: item.id,
        title: item.title,
        type: item.type,
        pageId: item.pageId,
        deprecated: item.deprecated,
      });
    }
  }
  return result;
}

/**
 * Convert a validated PublishedSnapshot (from an online share link) into the unified
 * PflowBinaryPayload shape so every MCP tool operates identically on local and remote projects.
 */
export function payloadFromPublishedSnapshot(
  rawSnapshot: unknown,
  metaOverrides?: { shareUrl?: string; updatedAt?: string; version?: number }
): PflowBinaryPayload {
  const snapshot: ReadablePublishedSnapshot = normalizePublishedSnapshot(rawSnapshot);
  const pageSources: Record<string, string> = {};
  const designerPages: DesignerPage[] = [];

  for (const page of snapshot.pages) {
    pageSources[page.pageId] = printPageSource(page.doc);
  }

  let sitemapBase: SitemapItem[];
  if (snapshot.formatVersion !== 2) {
    sitemapBase = convertPublishedSitemap(snapshot.sitemap);
  } else {
    const byFolder = new Map<string, SitemapItem[]>();
    for (const p of snapshot.pages) {
      const list = byFolder.get(p.folderId) ?? [];
      list.push({ id: `menu-${p.pageId}`, title: p.title, type: 'page', pageId: p.pageId });
      byFolder.set(p.folderId, list);
    }
    sitemapBase = Array.from(byFolder.entries()).map(([folderId, children]) => ({
      id: folderId,
      title: folderId,
      type: 'folder',
      children,
    }));
  }

  const stickyNotes: StickyNoteRule[] = snapshot.stickyNotes.map((s) => ({
    id: s.id,
    pageId: s.pageId,
    targetWidgetId: s.targetWidgetId,
    targetWidgetName: s.targetWidgetName,
    index: s.index,
    text: s.text,
    compiledRule: '',
    active: s.active,
  }));

  const noteNodes: NoteNode[] = [];
  const noteLinks: NoteLink[] = [];
  if ((snapshot.formatVersion === 4 || snapshot.formatVersion === 5) && snapshot.notes) {
    for (const n of snapshot.notes) {
      noteNodes.push({
        id: n.noteId,
        title: n.title,
        parentId: null,
        icon: n.icon || '📝',
        updatedAt: n.updatedAt,
        kind: 'note',
        content: n.html,
        tags: [],
        cover: 'none',
        pinned: false,
        status: n.status,
        ...(n.priority ? { priority: n.priority } : {}),
        ...(n.meetingDate ? { meetingDate: n.meetingDate } : {}),
        shareable: true,
      });
      for (const pageId of n.pageIds) {
        noteLinks.push({
          page: { kind: 'page', pageId },
          targetNodeId: n.noteId,
        });
      }
    }
  }
  const projectNotes: NoteWorkspace = {
    nodes: noteNodes,
    links: noteLinks,
    ...((snapshot.formatVersion === 4 || snapshot.formatVersion === 5) && snapshot.noteAssets ? { assets: snapshot.noteAssets } : {}),
  };

  const nowIso = metaOverrides?.updatedAt || new Date().toISOString();
  return {
    schemaVersion: 7,
    meta: {
      projectId: snapshot.projectId,
      projectName: snapshot.title,
      storageDir: metaOverrides?.shareUrl ?? 'remote://published-share',
      fileName: `${snapshot.projectId}.pflow`,
      templateId: 'blank_project',
      createdAt: nowIso,
      updatedAt: nowIso,
      pageCount: snapshot.pages.length,
      tableCount: snapshot.tables.length,
      stickyCount: stickyNotes.length,
    },
    stateSnapshot: {
      activePageId: snapshot.entryPageId,
      dbTables: snapshot.tables,
      stickyNotes,
      suppliers: [],
      purchaseOrderItems: [],
      acceptanceOrders: [],
      closedLoopIssues: [],
      widgets: useProtoStore.getInitialState().widgets,
      draftAcceptanceHeader: {
        acceptanceDate: '',
        acceptanceNo: '',
        inspector: '',
        inboundType: '购买',
        sourceType: '采购订单转入',
        deliveryPerson: '',
        supplierId: '',
        supplierContact: '',
        supplierPhone: '',
        invoiceType: '专票',
        taxRate: 0,
        remark: '',
      },
      draftAcceptanceLines: [],
      mindmaps: emptyMindmaps(),
      projectAgreements: [],
      projectPlan: null,
      projectNotes,
      pageSources,
      designerPages,
      // Sitemap already encodes the full published tree; keep designerFolders empty so buildSitemap does not duplicate pages.
      designerFolders: [],
      sitemapBase,
      sitemapOverrides: emptySitemapOverrides(),
      tableRows: snapshot.tableRows,
    },
  };
}

export interface LoadedWorkspace {
  sourceKind: 'local' | 'remote';
  sourceLabel: string;
  revision: string;
  payload: PflowBinaryPayload;
  uniqueConstraintsComplete: boolean;
  publishedFormatVersion?: number;
}

export interface WorkspaceLoader {
  load(): Promise<LoadedWorkspace>;
}

export function createLocalWorkspaceLoader(projectFilePath: string): WorkspaceLoader {
  const resolved = path.resolve(projectFilePath);
  let cached: { mtimeMs: number; size: number; workspace: LoadedWorkspace } | null = null;

  return {
    async load(): Promise<LoadedWorkspace> {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(resolved);
      } catch {
        throw new Error(tr(`找不到本地工程文件：${resolved}`, `Local project file not found: ${resolved}`));
      }
      if (!stat.isFile()) {
        throw new Error(tr(`指定路径不是有效的 .pflow 文件：${resolved}`, `Path is not a regular .pflow file: ${resolved}`));
      }
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.workspace;
      }
      const bytes = fs.readFileSync(resolved);
      const decoded = decodePflowBinary(bytes);
      const payload = normalizeProjectPayload(decoded);
      const workspace: LoadedWorkspace = {
        sourceKind: 'local',
        sourceLabel: resolved,
        revision: `${Math.trunc(stat.mtimeMs)}-${stat.size}`,
        payload,
        uniqueConstraintsComplete: true,
      };
      cached = { mtimeMs: stat.mtimeMs, size: stat.size, workspace };
      return workspace;
    },
  };
}

export function createRemoteWorkspaceLoader(options: {
  shareUrl: string;
  password?: string;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
}): WorkspaceLoader {
  const target = parseShareUrl(options.shareUrl);
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const ttlMs = options.cacheTtlMs ?? 3000;
  let cached: { fetchedAt: number; version: number; workspace: LoadedWorkspace } | null = null;

  return {
    async load(): Promise<LoadedWorkspace> {
      if (typeof fetchFn !== 'function') {
        throw new Error(
          tr(
            '当前运行环境不支持 HTTP fetch，无法读取远程分享链接',
            'Current runtime does not support HTTP fetch; cannot load remote share URL'
          )
        );
      }
      const now = Date.now();
      if (cached && now - cached.fetchedAt < ttlMs) {
        return cached.workspace;
      }

      const langHeader: Record<string, string> = isEnLocale() ? { 'Accept-Language': 'en-US' } : {};
      const metaRes = await fetchFn(`${target.origin}/api/v1/view/${target.shareId}`, {
        method: 'GET',
        headers: { Accept: 'application/json', ...langHeader },
        redirect: 'error',
      });
      const metaJson = (await metaRes.json().catch(() => null)) as Record<string, unknown> | null;
      if (!metaRes.ok) {
        const msg =
          typeof metaJson?.error === 'string'
            ? metaJson.error
            : tr(`远程分享访问失败 (HTTP ${metaRes.status})`, `Failed to access remote share (HTTP ${metaRes.status})`);
        throw new Error(msg);
      }
      if (
        !metaJson ||
        metaJson.id !== target.shareId ||
        typeof metaJson.passwordProtected !== 'boolean' ||
        typeof metaJson.version !== 'number' ||
        !Number.isInteger(metaJson.version) ||
        metaJson.version < 1
      ) {
        throw new Error(tr('远程分享返回的元数据格式无效', 'Invalid metadata format returned by remote share'));
      }

      const metaVersion = metaJson.version;
      if (cached && cached.version === metaVersion) {
        cached.fetchedAt = now;
        return cached.workspace;
      }

      if (metaJson.passwordProtected && !options.password) {
        throw new Error(
          tr(
            '该在线分享启用了访问密码保护，请在 MCP 配置中提供 password（或环境变量 PROTOFLOW_SHARE_PASSWORD）',
            'This online share is password-protected; provide password in MCP config (or PROTOFLOW_SHARE_PASSWORD)'
          )
        );
      }

      const openRes = await fetchFn(`${target.origin}/api/v1/view/${target.shareId}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...langHeader },
        body: JSON.stringify({ password: options.password ?? '' }),
        redirect: 'error',
      });
      const openJson = (await openRes.json().catch(() => null)) as Record<string, unknown> | null;
      if (!openRes.ok) {
        const msg =
          typeof openJson?.error === 'string'
            ? openJson.error
            : tr(`打开远程分享失败 (HTTP ${openRes.status})`, `Failed to open remote share (HTTP ${openRes.status})`);
        throw new Error(msg);
      }
      const pub = openJson?.publication as Record<string, unknown> | undefined;
      if (
        !openJson ||
        !pub ||
        pub.id !== target.shareId ||
        typeof pub.version !== 'number' ||
        !Number.isInteger(pub.version) ||
        pub.version < 1
      ) {
        throw new Error(
          tr(
            '远程分享内容与链接标识不一致或缺少有效版本号',
            'Remote share payload does not match share ID or is missing a valid version'
          )
        );
      }
      // Always stamp revision and cache with pub.version from the atomic /open response,
      // never metaVersion from the earlier GET which may predate a concurrent republish.
      const openedVersion = pub.version;

      const rawSnapFormat =
        openJson.snapshot && typeof openJson.snapshot === 'object' && 'formatVersion' in openJson.snapshot
          ? (openJson.snapshot as { formatVersion?: unknown }).formatVersion
          : undefined;
      const rawFormatVersion =
        typeof rawSnapFormat === 'number' && Number.isInteger(rawSnapFormat) ? rawSnapFormat : undefined;

      const payload = payloadFromPublishedSnapshot(openJson.snapshot, {
        shareUrl: target.shareUrl,
        updatedAt: typeof pub.updatedAt === 'string' ? pub.updatedAt : undefined,
        version: openedVersion,
      });

      const workspace: LoadedWorkspace = {
        sourceKind: 'remote',
        sourceLabel: target.shareUrl,
        revision: `v${openedVersion}`,
        payload,
        uniqueConstraintsComplete: rawFormatVersion !== undefined && rawFormatVersion >= 5,
        publishedFormatVersion: rawFormatVersion,
      };
      cached = { fetchedAt: now, version: openedVersion, workspace };
      return workspace;
    },
  };
}
