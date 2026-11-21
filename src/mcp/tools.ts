import { tr } from '../i18n/runtime';
import { inspectPage } from '../proto/ai/pageInspection';
import { verifiedAxureSourceId } from '../proto/axure/task';
import { reviewDatabaseDesign } from '../proto/database/designReview';
import { resolveUniqueConstraints } from '../proto/database/uniqueConstraints';
import { readPageHeader } from '../proto/dsl/header';
import { parsePageSource } from '../proto/dsl/parser';
import { walk } from '../proto/dsl/tree';
import { noteHtmlToMarkdown, noteHtmlToPlainText } from '../proto/notes';
import { buildSitemap } from '../proto/sitemap';
import { isNode, type PropValue, type ProtoNode } from '../proto/types';
import { analyzeProject, projectSpecification } from '../services/projectAnalysis';
import { reviewPageDependencies } from '../services/projectDependencies';
import {
  generateDatabaseDdl,
  resolveScopedRelations,
  renderDatabaseDdl,
  type SqlDialect,
} from './ddl';
import type { LoadedWorkspace } from './workspace';

export interface McpToolDefinition {
  name: string;
  description: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema: Record<string, unknown>;
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const SPEC_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'protoflow_get_project_overview',
    description:
      'Get the high-level architecture of the Alex (ProtoFlow AI) prototype project: metadata, hierarchical navigation sitemap, page catalog with table bindings, database table summary, global business agreements, and static health diagnostics. Call this tool FIRST before implementing features.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Get Prototype Project Overview' },
    inputSchema: {
      type: 'object',
      properties: {
        includeDiagnostics: {
          type: 'boolean',
          description: 'Include static reference checks and database design review warnings (default: true).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_get_database_schema',
    description:
      'Get ER physical table schemas, primary/foreign keys, unique constraints, modeling grain/rationale, PostgreSQL or MySQL DDL draft, and optional seed rows from the prototype. Check uniqueConstraintsComplete and warnings before running DDL from legacy online shares.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Get Database ER Schema & SQL DDL' },
    inputSchema: {
      type: 'object',
      properties: {
        tableNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of physical table names (e.g. ["t_orders"]) or internal table IDs to filter. Omit to retrieve all tables.',
        },
        dialect: {
          type: 'string',
          enum: ['postgres', 'mysql'],
          description: 'Target SQL dialect for generated CREATE/ALTER DDL statements (default: "postgres").',
        },
        includeSampleRows: {
          type: 'boolean',
          description: 'Include realistic prototype rows from tableRows for seed scripts and integration tests (default: true).',
        },
        sampleRowLimit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Maximum sample rows returned per table when includeSampleRows is true (default: 5).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_get_page_spec',
    description:
      'Get the full specification of a single prototype page: route path, desktop/mobile viewport mode, bound physical tables, interactive event chains (submitForm, updateRow, deleteRow, navigate, openOverlay, transfers), component-pinned product sticky notes, component outline, and TSX prototype source.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Get Single Page UI & Interaction Spec' },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Exact pageId from protoflow_get_project_overview.',
        },
        includeSource: {
          type: 'boolean',
          description: 'Include the full canonical TSX prototype source of the page (default: true).',
        },
        selectedPfId: {
          type: 'string',
          description: 'Optional exact component pfId to inspect its ancestors and subtree.',
        },
        includeInspection: {
          type: 'boolean',
          description: 'Include static contract validation, warnings, and saved preview-row binding status from inspectPage (default: false).',
        },
      },
      required: ['pageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_get_docs_and_flows',
    description:
      'Read product requirement notes (converted to clean Markdown) and Mermaid business flowcharts / mindmaps (.mmd) attached to the project or linked to a specific page.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Get Requirement Notes & Mermaid Flows' },
    inputSchema: {
      type: 'object',
      properties: {
        noteId: {
          type: 'string',
          description: 'Optional specific note ID to retrieve.',
        },
        mindmapId: {
          type: 'string',
          description: 'Optional specific mindmap/diagram ID to retrieve.',
        },
        pageId: {
          type: 'string',
          description: 'Optional pageId to filter notes and diagrams linked to that page or its parent folder.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_search_spec',
    description:
      'Search across all database tables/columns, page TSX components, product sticky notes, business agreements, requirement notes, and Mermaid diagrams by keyword.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Search Prototype Specification' },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Keyword or identifier to search for (e.g. column name, table name, status value, or business term).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of matches to return (default: 25).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_get_implementation_checklist',
    description:
      'Generate a structured full-stack engineering checklist (database migrations, CRUD/state-transition API endpoints inferred from page actions, frontend pages, and active sticky-note business rules) to verify implementation completeness.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Get Full-Stack Implementation Checklist' },
    inputSchema: {
      type: 'object',
      properties: {
        moduleKeyword: {
          type: 'string',
          description: 'Optional module folder name or keyword to scope the checklist to a specific module.',
        },
      },
      additionalProperties: false,
    },
  },
];

export const SPEC_MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: 'implement-module',
    description: 'Step-by-step workflow to implement a production full-stack module from the Alex (ProtoFlow AI) prototype.',
    arguments: [
      {
        name: 'moduleKeyword',
        description: 'Target module or page keyword (leave empty to implement the entire project).',
        required: false,
      },
      {
        name: 'techStack',
        description: 'Target production stack (e.g. "Next.js + Prisma + PostgreSQL" or "React + Go Gin + PostgreSQL").',
        required: false,
      },
    ],
  },
  {
    name: 'generate-db-layer',
    description: 'Generate database migrations, ORM models, foreign keys, and realistic seed data from the prototype ER schema.',
    arguments: [
      {
        name: 'dialect',
        description: 'SQL dialect: postgres or mysql (default: postgres).',
        required: false,
      },
      {
        name: 'orm',
        description: 'Target ORM or migration tool (e.g. Prisma, Drizzle, TypeORM, GORM, SQLAlchemy, raw SQL).',
        required: false,
      },
    ],
  },
];

export const SPEC_MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: 'protoflow://spec/markdown',
    name: 'Full Project Specification (SPEC.md)',
    description: 'Complete human- and AI-readable Markdown specification compiled from pages, ER tables, actions, and sticky notes.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'protoflow://database/schema.postgres.sql',
    name: 'PostgreSQL Schema Draft (DDL)',
    description: 'PostgreSQL CREATE TABLE and FOREIGN KEY DDL generated from the prototype ER model.',
    mimeType: 'application/sql',
  },
  {
    uri: 'protoflow://database/schema.mysql.sql',
    name: 'MySQL Schema Draft (DDL)',
    description: 'MySQL CREATE TABLE and FOREIGN KEY DDL generated from the prototype ER model.',
    mimeType: 'application/sql',
  },
];

interface OutlineNode {
  pfId: string;
  type: string;
  summaryProps?: Record<string, unknown>;
  text?: string;
  children?: OutlineNode[];
}

const SUMMARY_PROP_KEYS = [
  'id',
  'title',
  'subtitle',
  'label',
  'name',
  'table',
  'sourceForeignKey',
  'statusField',
  'placeholder',
  'type',
  'variant',
  'xField',
  'yField',
  'seriesField',
  'categoryField',
  'valueField',
];

function buildComponentOutline(node: ProtoNode, depth = 0): OutlineNode {
  const summaryProps: Record<string, unknown> = {};
  for (const key of SUMMARY_PROP_KEYS) {
    const val = node.props[key];
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      summaryProps[key] = val;
    }
  }
  if (Array.isArray(node.props.columns)) {
    const summarizedColumns = node.props.columns
      .map((col: PropValue) => {
        if (col && typeof col === 'object' && !Array.isArray(col)) {
          const rec = col as Record<string, PropValue>;
          const fieldKey =
            typeof rec.dataIndex === 'string' && rec.dataIndex.trim()
              ? rec.dataIndex.trim()
              : typeof rec.key === 'string' && rec.key.trim()
                ? rec.key.trim()
                : '';
          const title = typeof rec.title === 'string' ? rec.title.trim() : '';
          if (fieldKey) return `${fieldKey}${title ? `(${title})` : ''}`;
          if (title) return title;
        }
        return null;
      })
      .filter(Boolean);
    if (summarizedColumns.length) {
      summaryProps.columns = summarizedColumns;
    }
  }
  const textParts = node.children
    .filter((c) => !isNode(c))
    .map((c) => (c as { value: string }).value.trim())
    .filter(Boolean);
  const propText =
    !textParts.length && typeof node.props.text === 'string' && node.props.text.trim()
      ? node.props.text.trim()
      : '';
  const resolvedText = textParts.length ? textParts.join(' ') : propText;
  const childNodes = depth < 8 ? node.children.filter(isNode).map((c) => buildComponentOutline(c, depth + 1)) : [];

  return {
    pfId: node.pfId,
    type: node.type,
    ...(Object.keys(summaryProps).length ? { summaryProps } : {}),
    ...(resolvedText ? { text: Array.from(resolvedText).slice(0, 120).join('') } : {}),
    ...(childNodes.length ? { children: childNodes } : {}),
  };
}

function resolveAxureLineage(
  pages: readonly { pageId: string; deprecated: boolean }[],
  pageSources: Record<string, string>
): { sourceByCopyId: Map<string, string>; activeCopyBySourceId: Map<string, string> } {
  const sourceByCopyId = new Map<string, string>();
  const activeCopyBySourceId = new Map<string, string>();
  const pageIdSet = new Set(pages.map((p) => p.pageId));
  for (const p of pages) {
    const rawSource = pageSources[p.pageId];
    if (!rawSource) continue;
    const sourceId = verifiedAxureSourceId(p.pageId, readPageHeader(rawSource));
    if (!sourceId) continue;
    sourceByCopyId.set(p.pageId, sourceId);
    if (!p.deprecated && pageIdSet.has(sourceId)) {
      activeCopyBySourceId.set(sourceId, p.pageId);
    }
  }
  return { sourceByCopyId, activeCopyBySourceId };
}

function pagePlatform(source: string | undefined): 'desktop' | 'mobile' | 'unknown' {
  if (!source) return 'unknown';
  const parsed = parsePageSource(source);
  if (!parsed.doc) return 'unknown';
  return parsed.doc.root.type === 'MobilePage' ? 'mobile' : 'desktop';
}

export function executeSpecTool(
  workspace: LoadedWorkspace,
  name: string,
  rawArgs: Record<string, unknown> | undefined
): unknown {
  const args = rawArgs ?? {};
  const { payload } = workspace;
  const s = payload.stateSnapshot;
  const analysis = analyzeProject(s);
  const tableById = new Map(s.dbTables.map((t) => [t.id, t]));
  const axureLineage = resolveAxureLineage(analysis.pages, s.pageSources);

  switch (name) {
    case 'protoflow_get_project_overview': {
      const includeDiagnostics = args.includeDiagnostics !== false;
      const sitemap = buildSitemap(s.designerFolders, s.designerPages, s.sitemapOverrides, s.sitemapBase);
      const pages = analysis.pages.map((p) => {
        const boundTables = Array.from(
          new Set(
            analysis.usages
              .filter((u) => u.pageId === p.pageId)
              .map((u) => tableById.get(u.tableId)?.tableName ?? u.tableId)
          )
        );
        const stickyCount = s.stickyNotes.filter((n) => n.pageId === p.pageId && n.active).length;
        const axureSourcePageId = axureLineage.sourceByCopyId.get(p.pageId);
        const optimizedPageId = axureLineage.activeCopyBySourceId.get(p.pageId);
        return {
          pageId: p.pageId,
          title: p.title,
          path: p.path,
          platform: pagePlatform(s.pageSources[p.pageId]),
          hasSource: p.hasSource,
          deprecated: p.deprecated,
          ...(axureSourcePageId ? { axureSourcePageId } : {}),
          ...(optimizedPageId ? { optimizedPageId } : {}),
          boundTables,
          activeStickyCount: stickyCount,
        };
      });

      const tables = s.dbTables.map((t) => ({
        id: t.id,
        tableName: t.tableName,
        cnName: t.cnName,
        domain: t.domain,
        description: t.description,
        columnCount: t.columns.length,
        sampleRowCount: (s.tableRows[t.id] ?? []).length,
        sharedMenus: t.sharedByMenus.map((m) => ({
          pageId: m.pageId,
          menuTitle: m.menuTitle,
          accessMode: m.accessMode,
        })),
      }));

      const notes = (s.projectNotes?.nodes ?? []).filter((n) => n.kind === 'note');
      const mindmaps = (s.mindmaps?.nodes ?? []).filter((n) => n.kind === 'mindmap');
      const dbReview = includeDiagnostics ? reviewDatabaseDesign(s.dbTables) : null;

      return {
        project: {
          projectId: payload.meta.projectId,
          projectName: payload.meta.projectName,
          projectMode: payload.meta.projectMode ?? 'desktop',
          sourceKind: workspace.sourceKind,
          source: workspace.sourceLabel,
          revision: workspace.revision,
          updatedAt: payload.meta.updatedAt,
          entryPageId: s.activePageId,
        },
        counts: {
          pages: pages.filter((p) => !p.deprecated).length,
          archivedPages: pages.filter((p) => p.deprecated).length,
          tables: tables.length,
          foreignKeys: analysis.foreignKeys.length,
          activeStickyNotes: s.stickyNotes.filter((n) => n.active).length,
          notes: notes.length,
          mindmaps: mindmaps.length,
        },
        sitemap,
        pages,
        tables,
        agreements: s.projectAgreements ?? [],
        ...(s.projectPlan
          ? {
              projectPlan: {
                summary: s.projectPlan.summary,
                plannedPageCount: s.projectPlan.pages.length,
              },
            }
          : {}),
        ...(includeDiagnostics
          ? {
              diagnostics: {
                referenceIssues: analysis.issues,
                tableErrors: dbReview?.tableErrors ?? [],
                relationErrors: dbReview?.relationErrors ?? [],
                designRisks: dbReview?.risks ?? [],
              },
            }
          : {}),
      };
    }

    case 'protoflow_get_database_schema': {
      const dialect: SqlDialect = args.dialect === 'mysql' ? 'mysql' : 'postgres';
      const includeSampleRows = args.includeSampleRows !== false;
      const sampleRowLimit =
        typeof args.sampleRowLimit === 'number' && Number.isFinite(args.sampleRowLimit)
          ? Math.max(1, Math.min(50, Math.trunc(args.sampleRowLimit)))
          : 5;
      const filterNames = Array.isArray(args.tableNames)
        ? new Set(args.tableNames.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().toLowerCase()))
        : null;

      const selectedTables = filterNames && filterNames.size > 0
        ? s.dbTables.filter(
            (t) => filterNames.has(t.tableName.toLowerCase()) || filterNames.has(t.id.toLowerCase())
          )
        : s.dbTables;

      if (filterNames && filterNames.size > 0 && selectedTables.length === 0) {
        throw new Error(
          tr(
            `未找到匹配的数据表（请求：${Array.from(filterNames).join(', ')}；工程现有表：${s.dbTables.map((t) => t.tableName).join(', ') || '无'}）`,
            `No matching database tables found (requested: ${Array.from(filterNames).join(', ')}; available: ${s.dbTables.map((t) => t.tableName).join(', ') || 'none'})`
          )
        );
      }

      const selectedIds = new Set(selectedTables.map((t) => t.id));
      const tables = selectedTables.map((t) => {
        let uniqueConstraints: { name: string; columns: string[] }[] = [];
        try {
          uniqueConstraints = resolveUniqueConstraints(t).map((u) => ({
            name: u.name,
            columns: u.columns.map((c) => c.name),
          }));
        } catch {
          uniqueConstraints = [];
        }
        const rows = s.tableRows[t.id] ?? [];
        return {
          id: t.id,
          tableName: t.tableName,
          cnName: t.cnName,
          domain: t.domain,
          description: t.description,
          ...(t.modeling ? { modeling: t.modeling } : {}),
          uniqueConstraints,
          sharedByMenus: t.sharedByMenus,
          columns: t.columns.map((c) => ({
            id: c.id,
            name: c.name,
            prototypeDataType: c.dataType,
            nullable: c.nullable,
            isPrimaryKey: Boolean(c.isPrimaryKey),
            isUnique: Boolean(c.isUnique),
            isForeignKey: Boolean(c.isForeignKey),
            references: c.references ?? null,
            ...(c.foreignKeyOptions ? { foreignKeyOptions: c.foreignKeyOptions } : {}),
            ...(c.defaultValue !== undefined ? { defaultValue: c.defaultValue } : {}),
            comment: c.comment,
          })),
          totalSampleRows: rows.length,
          ...(includeSampleRows ? { sampleRows: rows.slice(0, sampleRowLimit) } : {}),
        };
      });

      const scopedGraph = resolveScopedRelations(selectedTables, s.dbTables, true);
      const dependencyTables = scopedGraph.tables
        .filter(table => !selectedIds.has(table.id))
        .map(table => table.tableName);
      const foreignKeys = scopedGraph.relations.map(fk => ({
        constraintName: fk.name,
        fromTable: tableById.get(fk.toTableId)!.tableName,
        fromColumn: fk.toColumnName,
        referencesTable: tableById.get(fk.fromTableId)!.tableName,
        referencesColumn: fk.fromColumnName,
        cardinality: fk.cardinality,
        onDelete: fk.onDelete ?? 'RESTRICT',
      }));

      const legacyWarning = !workspace.uniqueConstraintsComplete
        ? tr(
            `当前在线分享为旧版发布格式（V${workspace.publishedFormatVersion ?? 'legacy'}），未保存字段级 isUnique 与表级 uniqueConstraints 唯一约束元数据；请重新发布为 V5+ 格式或核对原工程后再执行建表。`,
            `This online share uses legacy publication format (V${workspace.publishedFormatVersion ?? 'legacy'}) without column-level isUnique or table-level uniqueConstraints metadata; republish in V5+ format or verify the source project before running DDL.`
          )
        : null;
      const rawDdl = renderDatabaseDdl(scopedGraph, dialect);
      const ddl = legacyWarning ? `${tr('-- [警告]', '-- [WARNING]')} ${legacyWarning}\n\n${rawDdl}` : rawDdl;
      const dbReview = reviewDatabaseDesign(scopedGraph.tables, scopedGraph);
      const warnings = [...(legacyWarning ? [legacyWarning] : []), ...scopedGraph.issues];

      return {
        dialect,
        tableCount: tables.length,
        uniqueConstraintsComplete: workspace.uniqueConstraintsComplete,
        ...(warnings.length ? { warnings } : {}),
        ...(dependencyTables.length ? { dependencyTables } : {}),
        tables,
        foreignKeys,
        ddl,
        designReview: dbReview,
      };
    }

    case 'protoflow_get_page_spec': {
      const pageId = typeof args.pageId === 'string' ? args.pageId.trim() : '';
      if (!pageId) throw new Error(tr('缺少必填参数 pageId', 'Missing required parameter pageId'));
      const includeSource = args.includeSource !== false;

      const pageEntry = analysis.pages.find((p) => p.pageId === pageId);
      if (!pageEntry) {
        throw new Error(
          tr(
            `找不到页面 "${pageId}"。可用 pageId：${analysis.pages.map((p) => p.pageId).join(', ') || '无'}`,
            `Page "${pageId}" not found. Available pageIds: ${analysis.pages.map((p) => p.pageId).join(', ') || 'none'}`
          )
        );
      }

      const source = s.pageSources[pageId];
      const parsed = source ? parsePageSource(source) : null;
      const nodeTypeByPfId = new Map<string, string>();
      if (parsed?.doc) {
        walk(parsed.doc.root, (n) => nodeTypeByPfId.set(n.pfId, n.type));
      }

      const tableBindings = analysis.usages
        .filter((u) => u.pageId === pageId)
        .map((u) => {
          const tbl = tableById.get(u.tableId);
          return {
            tableId: u.tableId,
            tableName: tbl?.tableName ?? u.tableId,
            cnName: tbl?.cnName ?? '',
            componentPfId: u.pfId,
            componentType: u.pfId ? nodeTypeByPfId.get(u.pfId) ?? null : null,
            bindingSource: u.description,
          };
        });

      const actions = analysis.actions
        .filter((a) => a.pageId === pageId)
        .map((a) => ({
          pfId: a.pfId,
          componentType: nodeTypeByPfId.get(a.pfId) ?? null,
          event: a.event,
          actionName: a.call.name,
          args: a.call.args,
        }));

      const outgoingNavigation = analysis.navigation
        .filter((n) => n.from === pageId)
        .map((n) => ({
          fromPfId: n.pfId,
          event: n.event,
          toPageId: n.to,
          toPageTitle: analysis.pages.find((p) => p.pageId === n.to)?.title ?? n.to,
        }));

      const incomingNavigation = analysis.navigation
        .filter((n) => n.to === pageId)
        .map((n) => ({
          fromPageId: n.from,
          fromPageTitle: analysis.pages.find((p) => p.pageId === n.from)?.title ?? n.from,
          fromPfId: n.pfId,
          event: n.event,
        }));

      const dataTransfers = analysis.transfers
        .filter((tr) => tr.pageId === pageId)
        .map((tr) => ({
          pfId: tr.pfId,
          fromTable: tableById.get(tr.fromTableId)?.tableName ?? tr.fromTableId,
          toTable: tableById.get(tr.toTableId)?.tableName ?? tr.toTableId,
        }));

      const stickyNotes = s.stickyNotes
        .filter((n) => n.pageId === pageId)
        .map((n) => ({
          id: n.id,
          index: n.index,
          active: n.active,
          targetWidgetId: n.targetWidgetId,
          targetWidgetName: n.targetWidgetName,
          requirementText: n.text,
          ...(n.compiledRule ? { compiledRule: n.compiledRule } : {}),
        }));

      const evidence = reviewPageDependencies(s);
      const upstreamDependencies = evidence.links.filter((l) => l.pageId === pageId);
      const acceptanceCases = evidence.cases.filter((c) => c.pageId === pageId);

      const linkedNoteIds = new Set(
        (s.projectNotes?.links ?? [])
          .filter((l) => l.page.kind === 'page' && l.page.pageId === pageId)
          .map((l) => l.targetNodeId)
      );
      const linkedNotes = (s.projectNotes?.nodes ?? [])
        .filter((n) => n.kind === 'note' && linkedNoteIds.has(n.id))
        .map((n) => ({ id: n.id, title: n.title, status: n.status ?? 'draft', priority: n.priority ?? null }));

      const linkedMindmapIds = new Set(
        (s.mindmaps?.links ?? [])
          .filter((l) => l.page.kind === 'page' && l.page.pageId === pageId)
          .map((l) => l.targetNodeId)
      );
      const linkedMindmaps = (s.mindmaps?.nodes ?? [])
        .filter((n) => n.kind === 'mindmap' && linkedMindmapIds.has(n.id))
        .map((n) => ({ id: n.id, title: n.title }));

      const agreements = (s.projectAgreements ?? []).filter((a) => a.pageIds.includes(pageId));

      const axureSourcePageId = axureLineage.sourceByCopyId.get(pageId);
      const optimizedPageId = axureLineage.activeCopyBySourceId.get(pageId);
      const requestedSelectedPfId =
        typeof args.selectedPfId === 'string' && args.selectedPfId.trim().length > 0
          ? args.selectedPfId.trim()
          : undefined;
      const shouldInspect = args.includeInspection === true || requestedSelectedPfId !== undefined;
      let inspection: ReturnType<typeof inspectPage> | null | undefined;
      if (shouldInspect) {
        if (!source) {
          if (requestedSelectedPfId !== undefined) {
            throw new Error(
              tr(
                `页面 "${pageId}" 尚无保存源码，无法定位组件 ${requestedSelectedPfId}`,
                `Page "${pageId}" has no saved source yet; cannot locate component ${requestedSelectedPfId}`
              )
            );
          }
          inspection = null;
        } else {
          inspection = inspectPage(source, s.dbTables, s.tableRows, requestedSelectedPfId);
        }
      }

      return {
        page: {
          pageId: pageEntry.pageId,
          title: pageEntry.title,
          path: pageEntry.path,
          platform: pagePlatform(source),
          hasSource: pageEntry.hasSource,
          deprecated: pageEntry.deprecated,
          ...(axureSourcePageId ? { axureSourcePageId } : {}),
          ...(optimizedPageId ? { optimizedPageId } : {}),
        },
        tableBindings,
        actions,
        outgoingNavigation,
        incomingNavigation,
        dataTransfers,
        stickyNotes,
        agreements,
        upstreamDependencies,
        acceptanceCases,
        linkedNotes,
        linkedMindmaps,
        componentOutline: parsed?.doc ? buildComponentOutline(parsed.doc.root) : null,
        ...(includeSource ? { pageSourceTsx: source ?? null } : {}),
        ...(shouldInspect ? { inspection } : {}),
      };
    }

    case 'protoflow_get_docs_and_flows': {
      const noteId = typeof args.noteId === 'string' && args.noteId.trim() ? args.noteId.trim() : null;
      const mindmapId = typeof args.mindmapId === 'string' && args.mindmapId.trim() ? args.mindmapId.trim() : null;
      const pageId = typeof args.pageId === 'string' && args.pageId.trim() ? args.pageId.trim() : null;

      // Determine parent folders if filtering by pageId so folder-linked notes/mindmaps are also returned
      const matchingFolderIds = new Set<string>();
      if (pageId) {
        const sitemap = buildSitemap(s.designerFolders, s.designerPages, s.sitemapOverrides, s.sitemapBase);
        const findAncestors = (items: typeof sitemap, ancestors: string[]): boolean => {
          for (const item of items) {
            if (item.type === 'folder') {
              if (findAncestors(item.children ?? [], [...ancestors, item.id])) return true;
            } else if (item.pageId === pageId) {
              ancestors.forEach((id) => matchingFolderIds.add(id));
              return true;
            }
          }
          return false;
        };
        findAncestors(sitemap, []);
      }

      const noteLinks = s.projectNotes?.links ?? [];
      const allowedNoteIds = pageId
        ? new Set(
            noteLinks
              .filter(
                (l) =>
                  (l.page.kind === 'page' && l.page.pageId === pageId) ||
                  (l.page.kind === 'folder' && matchingFolderIds.has(l.page.folderId))
              )
              .map((l) => l.targetNodeId)
          )
        : null;

      const notes = (s.projectNotes?.nodes ?? [])
        .filter((n): n is Extract<typeof n, { kind: 'note' }> => n.kind === 'note')
        .filter((n) => (!noteId || n.id === noteId) && (!allowedNoteIds || allowedNoteIds.has(n.id)))
        .map((n) => {
          const linkedTargets = noteLinks
            .filter((l) => l.targetNodeId === n.id)
            .map((l) => (l.page.kind === 'page' ? `page:${l.page.pageId}` : `folder:${l.page.folderId}`));
          return {
            id: n.id,
            title: n.title,
            icon: n.icon,
            status: n.status ?? 'draft',
            priority: n.priority ?? null,
            stakeholder: n.stakeholder ?? null,
            meetingDate: n.meetingDate ?? null,
            tags: n.tags,
            updatedAt: n.updatedAt,
            linkedTargets,
            markdown: noteHtmlToMarkdown(n, { images: 'placeholder', assets: s.projectNotes?.assets }),
          };
        });

      const mindmapLinks = s.mindmaps?.links ?? [];
      const allowedMindmapIds = pageId
        ? new Set(
            mindmapLinks
              .filter(
                (l) =>
                  (l.page.kind === 'page' && l.page.pageId === pageId) ||
                  (l.page.kind === 'folder' && matchingFolderIds.has(l.page.folderId))
              )
              .map((l) => l.targetNodeId)
          )
        : null;

      const mindmaps = (s.mindmaps?.nodes ?? [])
        .filter((n): n is Extract<typeof n, { kind: 'mindmap' }> => n.kind === 'mindmap')
        .filter((n) => (!mindmapId || n.id === mindmapId) && (!allowedMindmapIds || allowedMindmapIds.has(n.id)))
        .map((n) => {
          const linkedTargets = mindmapLinks
            .filter((l) => l.targetNodeId === n.id)
            .map((l) => (l.page.kind === 'page' ? `page:${l.page.pageId}` : `folder:${l.page.folderId}`));
          return {
            id: n.id,
            title: n.title,
            linkedTargets,
            mermaidSource: n.source,
          };
        });

      return {
        noteCount: notes.length,
        mindmapCount: mindmaps.length,
        notes,
        mindmaps,
      };
    }

    case 'protoflow_search_spec': {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) throw new Error(tr('缺少搜索关键词 query', 'Missing required search query'));
      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(100, Math.trunc(args.limit)))
          : 25;
      const q = query.toLowerCase();
      const hits: {
        category: 'table' | 'column' | 'page' | 'sticky_note' | 'agreement' | 'note' | 'mindmap';
        id: string;
        title: string;
        location: string;
        snippet: string;
      }[] = [];

      const pushHit = (hit: (typeof hits)[number]) => {
        if (hits.length < limit) hits.push(hit);
      };

      for (const tbl of s.dbTables) {
        const hay = `${tbl.tableName} ${tbl.cnName} ${tbl.domain} ${tbl.description}`.toLowerCase();
        if (hay.includes(q)) {
          pushHit({
            category: 'table',
            id: tbl.tableName,
            title: `${tbl.tableName} (${tbl.cnName})`,
            location: `database/${tbl.tableName}`,
            snippet:
              tbl.description ||
              tr(`业务域：${tbl.domain}，共 ${tbl.columns.length} 列`, `Domain: ${tbl.domain}, ${tbl.columns.length} columns`),
          });
        }
        for (const col of tbl.columns) {
          const colHay = `${col.name} ${col.dataType} ${col.comment} ${col.references ?? ''}`.toLowerCase();
          if (colHay.includes(q)) {
            pushHit({
              category: 'column',
              id: `${tbl.tableName}.${col.name}`,
              title: `${tbl.tableName}.${col.name} (${col.dataType})`,
              location: `database/${tbl.tableName}#${col.name}`,
              snippet: `${col.comment}${col.references ? tr(` -> 引用 ${col.references}`, ` -> references ${col.references}`) : ''}`,
            });
          }
        }
      }

      for (const note of s.stickyNotes) {
        const hay = `${note.targetWidgetId} ${note.targetWidgetName} ${note.text} ${note.compiledRule ?? ''}`.toLowerCase();
        if (hay.includes(q)) {
          pushHit({
            category: 'sticky_note',
            id: note.id,
            title: tr(`便签 #${note.index} · ${note.targetWidgetName}`, `Sticky #${note.index} · ${note.targetWidgetName}`),
            location: `page:${note.pageId}#${note.targetWidgetId}`,
            snippet: note.text,
          });
        }
      }

      for (const agr of s.projectAgreements ?? []) {
        const hay = `${agr.title} ${agr.text} ${agr.kind}`.toLowerCase();
        if (hay.includes(q)) {
          pushHit({
            category: 'agreement',
            id: agr.id,
            title: agr.title,
            location: `agreements/${agr.kind}`,
            snippet: agr.text,
          });
        }
      }

      for (const page of analysis.pages) {
        const src = s.pageSources[page.pageId] ?? '';
        const metaMatch = `${page.pageId} ${page.title} ${page.path}`.toLowerCase().includes(q);
        const srcLower = src.toLowerCase();
        const idx = srcLower.indexOf(q);
        if (metaMatch || idx >= 0) {
          const snippet =
            idx >= 0
              ? src.slice(Math.max(0, idx - 50), Math.min(src.length, idx + query.length + 90)).replace(/\s+/g, ' ')
              : tr(`路由：${page.path}`, `Route: ${page.path}`);
          pushHit({
            category: 'page',
            id: page.pageId,
            title: page.title,
            location: page.path,
            snippet,
          });
        }
      }

      for (const n of s.projectNotes?.nodes ?? []) {
        if (n.kind !== 'note') continue;
        const plain = noteHtmlToPlainText(n.content);
        const hay = `${n.title} ${n.tags.join(' ')} ${plain}`.toLowerCase();
        const idx = hay.indexOf(q);
        if (idx >= 0) {
          const pIdx = plain.toLowerCase().indexOf(q);
          const snippet =
            pIdx >= 0
              ? plain.slice(Math.max(0, pIdx - 40), Math.min(plain.length, pIdx + query.length + 80)).replace(/\s+/g, ' ')
              : n.title;
          pushHit({
            category: 'note',
            id: n.id,
            title: n.title,
            location: `notes/${n.id}`,
            snippet,
          });
        }
      }

      for (const m of s.mindmaps?.nodes ?? []) {
        if (m.kind !== 'mindmap') continue;
        const hay = `${m.title} ${m.source}`.toLowerCase();
        if (hay.includes(q)) {
          pushHit({
            category: 'mindmap',
            id: m.id,
            title: m.title,
            location: `mindmaps/${m.id}`,
            snippet: m.source.slice(0, 140).replace(/\s+/g, ' '),
          });
        }
      }

      return {
        query,
        matchCount: hits.length,
        matches: hits,
      };
    }

    case 'protoflow_get_implementation_checklist': {
      const moduleKeyword =
        typeof args.moduleKeyword === 'string' && args.moduleKeyword.trim()
          ? args.moduleKeyword.trim().toLowerCase()
          : null;

      const activePages = analysis.pages.filter(
        (p) =>
          !p.deprecated &&
          (!moduleKeyword ||
            p.path.toLowerCase().includes(moduleKeyword) ||
            p.pageId.toLowerCase().includes(moduleKeyword) ||
            p.title.toLowerCase().includes(moduleKeyword))
      );
      const activePageIds = new Set(activePages.map((p) => p.pageId));

      const relevantTableIds = new Set<string>();
      if (!moduleKeyword) {
        s.dbTables.forEach((t) => relevantTableIds.add(t.id));
      } else {
        for (const u of analysis.usages) {
          if (activePageIds.has(u.pageId)) relevantTableIds.add(u.tableId);
        }
      }

      const databaseTasks = s.dbTables
        .filter((t) => relevantTableIds.has(t.id))
        .map((t) => ({
          tableName: t.tableName,
          cnName: t.cnName,
          columnCount: t.columns.length,
          primaryKeys: t.columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
          foreignKeys: t.columns
            .filter((c) => c.references)
            .map((c) => `${c.name} -> ${c.references}`),
          pendingBusinessRules: t.modeling?.pendingRules ?? [],
        }));

      const pageAndApiTasks = activePages.map((p) => {
        const pageUsages = analysis.usages.filter((u) => u.pageId === p.pageId);
        const pageActions = analysis.actions.filter((a) => a.pageId === p.pageId);
        const pageTransfers = analysis.transfers.filter((tr) => tr.pageId === p.pageId);
        const inferredEndpoints = new Set<string>();

        for (const u of pageUsages) {
          const tbl = tableById.get(u.tableId)?.tableName ?? u.tableId;
          inferredEndpoints.add(`READ/LIST ${tbl}`);
        }
        for (const a of pageActions) {
          if (a.call.name === 'submitForm') {
            inferredEndpoints.add(`CREATE/UPDATE via Form (${String(a.call.args[0] ?? a.pfId)})`);
          } else if (a.call.name === 'updateRow') {
            inferredEndpoints.add(`PATCH/STATE_TRANSITION on ${a.pfId}`);
          } else if (a.call.name === 'deleteRow') {
            inferredEndpoints.add(`DELETE row on ${a.pfId}`);
          }
        }
        for (const tr of pageTransfers) {
          const fromTbl = tableById.get(tr.fromTableId)?.tableName ?? tr.fromTableId;
          const toTbl = tableById.get(tr.toTableId)?.tableName ?? tr.toTableId;
          inferredEndpoints.add(`TRANSFER lines ${fromTbl} -> ${toTbl}`);
        }

        const axureSourcePageId = axureLineage.sourceByCopyId.get(p.pageId);
        const supersededByOptimizedPageId = axureLineage.activeCopyBySourceId.get(p.pageId);

        return {
          pageId: p.pageId,
          title: p.title,
          routePath: p.path,
          platform: pagePlatform(s.pageSources[p.pageId]),
          ...(axureSourcePageId ? { axureSourcePageId } : {}),
          ...(supersededByOptimizedPageId ? { supersededByOptimizedPageId } : {}),
          inferredBackendOperations: Array.from(inferredEndpoints),
          interactiveActionCount: pageActions.length,
          activeStickyRules: s.stickyNotes
            .filter((n) => n.pageId === p.pageId && n.active)
            .map((n) => `#${n.index} [${n.targetWidgetName} (${n.targetWidgetId})]: ${n.text}`),
        };
      });

      const dbReview = reviewDatabaseDesign(s.dbTables.filter((t) => relevantTableIds.has(t.id)));

      const legacyChecklistWarnings = !workspace.uniqueConstraintsComplete
        ? [
            tr(
              `当前在线分享为旧版发布格式（V${workspace.publishedFormatVersion ?? 'legacy'}），唯一约束（isUnique / uniqueConstraints）未随旧版快照保存，建表前请核对原工程或重新发布。`,
              `This online share uses legacy publication format (V${workspace.publishedFormatVersion ?? 'legacy'}) without unique constraints (isUnique / uniqueConstraints); verify the source project or republish before creating tables.`
            ),
          ]
        : [];

      return {
        scope: moduleKeyword ?? 'all_modules',
        summary: {
          tablesToImplement: databaseTasks.length,
          pagesToImplement: pageAndApiTasks.length,
          activeStickyRules: pageAndApiTasks.reduce((acc, p) => acc + p.activeStickyRules.length, 0),
        },
        databaseTasks,
        pageAndApiTasks,
        agreementsToHonor: (s.projectAgreements ?? []).filter(
          (a) => !moduleKeyword || a.pageIds.some((id) => activePageIds.has(id))
        ),
        openWarnings: [...legacyChecklistWarnings, ...analysis.issues, ...dbReview.tableErrors, ...dbReview.relationErrors],
      };
    }

    default:
      throw new Error(tr(`未知的 MCP 工具：${name}`, `Unknown MCP tool: ${name}`));
  }
}

export function getSpecPrompt(
  workspace: LoadedWorkspace,
  name: string,
  args: Record<string, string> | undefined
): { description: string; messages: { role: 'user'; content: { type: 'text'; text: string } }[] } {
  const projectName = workspace.payload.meta.projectName;
  if (name === 'implement-module') {
    const mod = args?.moduleKeyword?.trim() || tr('全部核心模块', 'all core modules');
    const stack = args?.techStack?.trim() || tr('当前仓库默认技术栈', "the repository's default stack");
    return {
      description: tr(`按照 ${projectName} 原型规格实现模块：${mod}`, `Implement module from ${projectName} prototype specification: ${mod}`),
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: tr(
              [
                `请基于 Alex (ProtoFlow AI) 原型工程「${projectName}」实现生产级代码（目标范围：${mod}；技术栈：${stack}）。`,
                '',
                '请严格按以下顺序调用 ProtoFlow MCP 工具，不要凭空猜测字段或交互：',
                '1. 调用 `protoflow_get_project_overview` 了解路由结构、模块边界与全局业务共识；',
                '2. 调用 `protoflow_get_database_schema` 获取物理表、主外键、唯一约束与种子数据，先完成数据库 Schema 与接口契约对齐；',
                '3. 对目标范围内的每个页面逐一调用 `protoflow_get_page_spec`（必要时调用 `protoflow_get_docs_and_flows`），严格还原表格列、表单校验、交互事件链（增删改查/状态流转/单据下推）以及挂载在组件上的产品便签规则；',
                '4. 完成后调用 `protoflow_get_implementation_checklist` 逐项核销，确保没有遗漏任何物理表约束或产品批注。',
              ].join('\n'),
              [
                `Implement production-grade code from the Alex (ProtoFlow AI) prototype project "${projectName}" (scope: ${mod}; stack: ${stack}).`,
                '',
                'Call ProtoFlow MCP tools in the exact order below rather than guessing fields or interactions:',
                '1. Call `protoflow_get_project_overview` to inspect the route tree, module boundaries, and global business agreements;',
                '2. Call `protoflow_get_database_schema` to read physical tables, primary/foreign keys, unique constraints, and seed rows, aligning database schemas and API contracts first;',
                '3. For each page in scope, call `protoflow_get_page_spec` (and `protoflow_get_docs_and_flows` when needed) to implement table columns, form validations, interactive action chains, and component-pinned sticky-note rules;',
                '4. Finally call `protoflow_get_implementation_checklist` to verify every database constraint and product requirement.',
              ].join('\n')
            ),
          },
        },
      ],
    };
  }

  if (name === 'generate-db-layer') {
    const dialect = args?.dialect === 'mysql' ? 'mysql' : 'postgres';
    const orm = args?.orm?.trim() || tr('项目现有 ORM / SQL Migration', "the project's existing ORM / SQL migrations");
    return {
      description: tr(
        `基于 ${projectName} ER 物理表生成数据库迁移与数据访问层`,
        `Generate database migrations and data access layer from ${projectName} ER schema`
      ),
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: tr(
              [
                `请调用 \`protoflow_get_database_schema\`（设置 \`dialect: "${dialect}"\`, \`includeSampleRows: true\`）读取「${projectName}」的完整 ER 物理表设计，并生成适配 **${orm}** 的生产代码：`,
                '1. 完整表结构、主键、组合唯一索引与外键关联（注意遵循每张表的 `modeling.grain` 与 `onDelete` 策略）；',
                '2. 可重复执行的数据库 Migration 脚本；',
                '3. 基于 `sampleRows` 的开发环境 Seed 初始化脚本。',
              ].join('\n'),
              [
                `Call \`protoflow_get_database_schema\` (with \`dialect: "${dialect}"\`, \`includeSampleRows: true\`) to read the complete ER physical table schema of "${projectName}", and generate production code for **${orm}**:`,
                '1. Complete table definitions, primary keys, composite unique indexes, and foreign key relations (following each table\'s `modeling.grain` and `onDelete` policy);',
                '2. Repeatable database migration scripts;',
                '3. Development seed scripts derived from `sampleRows`.',
              ].join('\n')
            ),
          },
        },
      ],
    };
  }

  throw new Error(tr(`未知的 MCP Prompt：${name}`, `Unknown MCP Prompt: ${name}`));
}

export function readSpecResource(
  workspace: LoadedWorkspace,
  uri: string
): { contents: { uri: string; mimeType: string; text: string }[] } {
  if (uri === 'protoflow://spec/markdown') {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: projectSpecification(workspace.payload),
        },
      ],
    };
  }
  const legacyPrefix = !workspace.uniqueConstraintsComplete
    ? tr(
        `-- [警告] 当前在线分享为旧版发布格式（V${workspace.publishedFormatVersion ?? 'legacy'}），唯一约束（isUnique / uniqueConstraints）缺失，请重新发布或核对原工程！\n\n`,
        `-- [WARNING] This online share uses legacy publication format (V${workspace.publishedFormatVersion ?? 'legacy'}) without unique constraints (isUnique / uniqueConstraints); republish or verify the source project!\n\n`
      )
    : '';
  if (uri === 'protoflow://database/schema.postgres.sql') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/sql',
          text: legacyPrefix + generateDatabaseDdl(workspace.payload.stateSnapshot.dbTables, 'postgres'),
        },
      ],
    };
  }
  if (uri === 'protoflow://database/schema.mysql.sql') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/sql',
          text: legacyPrefix + generateDatabaseDdl(workspace.payload.stateSnapshot.dbTables, 'mysql'),
        },
      ],
    };
  }
  throw new Error(tr(`未知的 MCP Resource URI：${uri}`, `Unknown MCP Resource URI: ${uri}`));
}
