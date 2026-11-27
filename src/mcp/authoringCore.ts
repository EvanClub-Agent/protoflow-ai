import { isEnLocale, tr } from '../i18n/runtime';
import { getImplementationGuide } from '../proto/ai/implementationGuide';
import { pageContractErrors } from '../proto/ai/pageContract';
import { inspectPage } from '../proto/ai/pageInspection';
import { auditTableMenuCoverage } from '../proto/ai/tableMenuCoverage';
import { isAxureMaterial } from '../proto/axure/metadata';
import { isFigmaMaterial } from '../proto/figma/metadata';
import { reviewDatabaseChanges, reviewDatabaseDesign } from '../proto/database/designReview';
import { previewRelationIssues } from '../proto/database/previewRelations';
import { preparePreviewScenario } from '../proto/database/previewScenario';
import { editPageBlock } from '../proto/dsl/editBlock';
import { parsePageSource } from '../proto/dsl/parser';
import { printPageSource } from '../proto/dsl/printer';
import { findNode, removeNode } from '../proto/dsl/tree';
import {
  applyMindmapMutation,
  auditProjectMindmaps,
  buildLinksForTarget,
  mindmapDescendants,
  resolveDocumentParentId,
  validateMindmaps,
  type MindmapNode,
} from '../proto/mindmaps';
import {
  emptyProjectNotes,
  extractInlineNoteImages,
  findMarkdownSectionRange,
  markdownToNoteHtml,
  noteDescendants,
  noteHtmlToMarkdownBody,
  pruneUnusedNoteAssets,
  validateProjectNotes,
  type NoteCoverId,
  type NoteLink,
  type NoteNode,
  type NotePriority,
  type NoteRequirementStatus,
} from '../proto/notes';
import {
  getActionContracts,
  getMaterialContracts,
  MATERIAL_CONTRACT_VERSION,
  MATERIAL_VALUE_DEFINITIONS,
} from '../proto/registry/materialContract';
import type { Row } from '../proto/runtime/mock';
import {
  buildSitemap,
  folderOptions,
  menuPageIds,
  prepareSitemapMove,
  sitemapCatalog,
  validateDesignerFolders,
  type SitemapMoveTarget,
} from '../proto/sitemap';
import { validateStickyNoteIndex } from '../proto/stickyNoteIndex';
import {
  DESIGN_COLOR_MODES,
  DESIGN_DENSITY_TOKENS,
  DESIGN_PRESET_IDS,
  DESIGN_RADIUS_TOKENS,
  DESIGN_SURFACE_TOKENS,
  exportDesignTokensSpec,
  isDefaultDesignTokens,
  validateDesignTokens,
} from '../proto/theme/designTokens';
import { analyzeVisualConsistency } from '../proto/theme/visualConsistency';
import { prepareMenuDeletion } from '../services/menuDeletion';
import { analyzeProject } from '../services/projectAnalysis';
import { applyProjectAgreement } from '../services/projectKnowledge';
import { checkAiPagePlatform } from '../services/projectPagePlatform';
import type { DBColumnSchema, DBTableSchema, StickyNoteRule } from '../store/useProtoStore';
import type { PflowBinaryPayload } from '../utils/pflowBinaryCodec';
import type { AuthoringWorkspace } from './authoringWorkspace';
import type { WorkspaceStatus } from './authoringTypes';
import { DB_COLUMN_JSON_SCHEMA, DB_TABLE_JSON_SCHEMA, validateDbColumnInput, validateDbTableInput } from './dbContract';
import {
  AXURE_COLUMN_MAPPING_SCHEMA,
  AXURE_RESHAPE_COVERAGE_SCHEMA,
  bindAxureTable,
  commitOptimizedCopyPatch,
  FIGMA_RESHAPE_COVERAGE_SCHEMA,
  inspectImportedProjectInventory,
  inspectImportedSourcePage,
  optimizeAxureBlock,
  reshapeAxurePage,
  reshapeFigmaPage,
  resolveImportInspectionScope,
  retargetEditedOptimizedCopy,
  type RpColumnMapping,
} from './importReshape';
import {
  executeSpecTool,
  type McpPromptDefinition,
  type McpResourceDefinition,
  type McpToolDefinition,
} from './tools';
import { PROTOFLOW_CONTRACT_DIGEST, PROTOFLOW_SERVER_VERSION } from './generatedSkillBundle';
import type { LoadedWorkspace } from './workspace';

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(tr(`参数 ${fieldName} 必须是非空字符串`, `${fieldName} must be a non-empty string`));
  }
  return value.trim();
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  const match = allowed.find(option => option === value);
  if (!match) throw new Error(`${field}: ${allowed.join(' | ')}`);
  return match;
}
const templateIds = ['blank_project', 'saas_inventory', 'crm_analytics', 'mobile_starter', 'customs_erp', 'supply_chain'] as const;
const projectModes = ['desktop', 'mobile', 'hybrid'] as const;
const pagePlatforms = ['desktop', 'mobile'] as const;

function optionalExpectedRevision(args: Record<string, unknown>): string | undefined {
  if (args.expectedRevision === undefined) return undefined;
  return requireNonEmptyString(args.expectedRevision, 'expectedRevision');
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const DESTRUCTIVE_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

export const AUTHORING_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'protoflow_workspace',
    description:
      'Inspect or manage the active .pflow workspace: status, list_projects, create_project, switch_project, or update_project_meta (name, mode, activePageId, designTokens).',
    annotations: { ...WRITE_ANNOTATIONS, title: 'Manage Alex Project Workspace' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'list_projects', 'create_project', 'switch_project', 'update_project_meta'],
          description: 'Workspace action (default: "status").',
        },
        directory: {
          type: 'string',
          description: 'Directory to scan for list_projects.',
        },
        filePath: {
          type: 'string',
          description: 'Target .pflow path for create_project or switch_project.',
        },
        projectName: {
          type: 'string',
        },
        templateId: {
          type: 'string',
          enum: templateIds,
          description: 'Starter template for create_project (default: "blank_project").',
        },
        projectMode: {
          type: 'string',
          enum: projectModes,
        },
        activePageId: {
          type: 'string',
        },
        designTokens: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['preset'],
              properties: {
                preset: { type: 'string', enum: DESIGN_PRESET_IDS },
                primaryColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                radius: { type: 'string', enum: DESIGN_RADIUS_TOKENS },
                density: { type: 'string', enum: DESIGN_DENSITY_TOKENS },
                surfaceVariant: { type: 'string', enum: DESIGN_SURFACE_TOKENS },
                colorMode: {
                  type: 'string',
                  enum: DESIGN_COLOR_MODES,
                  description: 'Keep "auto" (default) so the prototype follows the outer workbench/viewer light-dark theme toggle; only set "light" or "dark" if the user explicitly asks to lock the canvas theme.',
                },
              },
            },
          ],
          description: 'Canvas Design Tokens (pass null to reset to classic_antd).',
        },
        overwrite: {
          type: 'boolean',
        },
        expectedContractDigest: {
          type: 'string',
          description: 'Optional contractDigest from SKILL.md to detect stale skill drift.',
        },
        expectedRevision: {
          type: 'string',
          description: 'Optimistic concurrency revision token.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_get_implementation_guide',
    description:
      'Get scenario recipes (list, form, detail, picker, dashboard, workflow, layout, mobile, axure, custom). Omit scenarioIds to list IDs first.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Get Scenario Implementation Guide' },
    inputSchema: {
      type: 'object',
      properties: {
        scenarioIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scenario IDs to load (omit to list catalog).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_get_contracts',
    description:
      'Get registered TSX component contracts (props, valueSchema, events, child rules, snippets) and runtime actions. Omit componentNames to list catalog.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Get Material & Action Contracts' },
    inputSchema: {
      type: 'object',
      properties: {
        componentNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Component names to inspect in full.',
        },
        includeAxure: {
          type: 'boolean',
        },
        includeFigma: {
          type: 'boolean',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_manage_sitemap',
    description:
      'Create, update, move, rename, or cascade-delete sitemap folders and menu pages.',
    annotations: { ...DESTRUCTIVE_WRITE_ANNOTATIONS, title: 'Manage Sitemap Folders & Menus' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['upsert_folder', 'move_item', 'rename_page', 'delete_item'],
          description: 'Sitemap mutation action.',
        },
        folder: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'parentFolderId'],
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            parentFolderId: { type: ['string', 'null'] },
          },
          description: 'Folder definition for upsert_folder (parentFolderId: null for top-level folder).',
        },
        target: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id'],
          properties: {
            kind: { type: 'string', enum: ['folder', 'page'] },
            id: { type: 'string', minLength: 1 },
          },
          description: 'Target item for move_item.',
        },
        parentFolderId: {
          type: ['string', 'null'],
          description: 'Destination parent folder ID for move_item (null allowed only for folders).',
        },
        pageId: {
          type: 'string',
          description: 'Target pageId for rename_page or delete_item.',
        },
        title: {
          type: 'string',
          description: 'New page title for rename_page.',
        },
        nodeId: {
          type: 'string',
          description: 'Target sitemap node ID (folder ID or page node ID) for delete_item.',
        },
        expectedRevision: {
          type: 'string',
          description: 'Optional revision token for optimistic concurrency control.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_upsert_db_tables',
    description:
      'Create or update physical ER database tables (in batches so parent/child FKs validate together), upsert columns on an existing table, or delete tables. Validates modeling rationale, primary/foreign keys, types, and unique constraints.',
    annotations: { ...DESTRUCTIVE_WRITE_ANNOTATIONS, title: 'Create/Update ER Database Tables' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['upsert_tables', 'upsert_columns', 'delete_tables'],
          description: 'Database schema action (default: "upsert_tables").',
        },
        tables: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: DB_TABLE_JSON_SCHEMA,
          description: '1..30 complete DBTableSchema definitions for upsert_tables.',
        },
        tableId: {
          type: 'string',
          description: 'Exact existing dbTables.id for upsert_columns.',
        },
        columns: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: DB_COLUMN_JSON_SCHEMA,
          description: '1..50 DBColumnSchema definitions for upsert_columns.',
        },
        tableIds: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: { type: 'string', minLength: 1 },
          description: 'Exact dbTables.id list for delete_tables.',
        },
        force: {
          type: 'boolean',
          description: 'Allow delete_tables even if page TSX still binds the table (dangling FKs on other tables are still rejected).',
        },
        expectedRevision: {
          type: 'string',
          description: 'Optional revision token for optimistic concurrency control.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_manage_table_rows',
    description:
      'Read, seed, replace, or clear prototype preview rows in tableRows. Validates NOT NULL, column data types, ENUM values, PK/UNIQUE constraints, and foreign-key referential integrity across all seeded tables.',
    annotations: { ...WRITE_ANNOTATIONS, title: 'Manage Prototype Preview Rows' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'seed', 'clear'],
          description: 'Preview data operation.',
        },
        tableId: {
          type: 'string',
          description: 'Exact dbTables.id for action="read".',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Pagination offset for action="read" (default: 0).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Pagination limit for action="read" (default: 20, max: 100).',
        },
        datasets: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            required: ['tableId', 'rows'],
            additionalProperties: false,
            properties: {
              tableId: { type: 'string', minLength: 1 },
              rows: {
                type: 'array',
                minItems: 1,
                maxItems: 100,
                items: {
                  type: 'object',
                  additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
                },
              },
            },
          },
          description: 'Coherent scenario datasets for action="seed" (each row requires a unique string id).',
        },
        replaceExisting: {
          type: 'boolean',
          description: 'When true, replace existing preview rows for the target tableIds in datasets (default: false).',
        },
        tableIds: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: { type: 'string', minLength: 1 },
          description: 'Exact dbTables.id list for action="clear".',
        },
        expectedRevision: {
          type: 'string',
          description: 'Optional revision token for optimistic concurrency control.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_write_page',
    description:
      'Create a new page or overwrite a page with complete, validated Alex TSX (<Page> for desktop or <MobilePage> for mobile). Enforces strict material contracts, table/column bindings, semantic actions, and platform compatibility before saving.',
    annotations: { ...WRITE_ANNOTATIONS, title: 'Create or Write Complete Page TSX' },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          minLength: 1,
          description: 'Stable page identifier.',
        },
        source: {
          type: 'string',
          minLength: 1,
          description: 'Complete TSX source (`export default function Page() { return (...); }`) with unique explicit pfId on every element.',
        },
        title: {
          type: 'string',
          description: 'Page title (required when creating a new custom page).',
        },
        folderId: {
          type: 'string',
          description: 'Parent sitemap folder ID (required when creating a new custom page).',
        },
        platform: {
          type: 'string',
          enum: pagePlatforms,
          description: 'Optional explicit page platform (recommended in hybrid projects).',
        },
        setActive: {
          type: 'boolean',
          description: 'Set this page as activePageId after saving (auto-enabled when project activePageId is empty).',
        },
        expectedRevision: {
          type: 'string',
          description: 'Optional revision token for optimistic concurrency control.',
        },
      },
      required: ['pageId', 'source'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_edit_page_block',
    description:
      'Losslessly modify a localized subtree of an existing page by targetPfId: append child components ("append_children"), replace one component preserving its pfId ("replace_node"), or remove a component ("delete_node"). Validates the full page before saving.',
    annotations: { ...WRITE_ANNOTATIONS, title: 'Edit Page Component Block' },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          minLength: 1,
          description: 'Existing pageId containing targetPfId.',
        },
        targetPfId: {
          type: 'string',
          minLength: 1,
          description: 'Exact existing component pfId to target.',
        },
        mode: {
          type: 'string',
          enum: ['append_children', 'replace_node', 'delete_node'],
          description: 'Block edit mode.',
        },
        tsx: {
          type: 'string',
          description: 'Complete TSX fragment (without imports or Page wrapper) with unique pfId on each element; required for append_children / replace_node.',
        },
        expectedRevision: {
          type: 'string',
          description: 'Optional revision token for optimistic concurrency control.',
        },
      },
      required: ['pageId', 'targetPfId', 'mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_manage_sticky_notes',
    description:
      'Attach, update, or delete component-pinned requirement sticky notes on existing page components.',
    annotations: { ...WRITE_ANNOTATIONS, title: 'Manage Component Sticky Notes' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['upsert', 'delete'],
          description: 'Sticky note action.',
        },
        stickies: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            required: ['id', 'pageId', 'targetWidgetId', 'targetWidgetName', 'text'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              pageId: { type: 'string', minLength: 1 },
              targetWidgetId: { type: 'string', minLength: 1, description: 'Exact existing pfId on pageId.' },
              targetWidgetName: { type: 'string', minLength: 1 },
              index: { type: 'integer', minimum: 1, description: 'Optional 1-based display number (auto-assigned if omitted).' },
              text: { type: 'string', minLength: 1 },
              compiledRule: { type: 'string' },
              active: { type: 'boolean' },
            },
          },
          description: 'Sticky note rules to upsert.',
        },
        stickyIds: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string', minLength: 1 },
          description: 'Sticky IDs to delete for action="delete".',
        },
        expectedRevision: {
          type: 'string',
          description: 'Optional revision token for optimistic concurrency control.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_manage_docs_and_flows',
    description:
      'Create, update, or delete PRD project notes (Markdown -> rich HTML), Mermaid business flowcharts/mindmaps, and durable project agreements.',
    annotations: { ...DESTRUCTIVE_WRITE_ANNOTATIONS, title: 'Manage Project Notes, Mindmaps & Agreements' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'upsert_note',
            'patch_note',
            'upsert_note_folder',
            'delete_note',
            'upsert_mindmap',
            'upsert_mindmap_folder',
            'delete_mindmap',
            'upsert_agreement',
            'remove_agreement',
          ],
          description: 'Docs/flows mutation action.',
        },
        note: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'markdown'],
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string' },
            markdown: { type: 'string' },
            parentId: { type: ['string', 'null'] },
            icon: { type: 'string' },
            tags: { type: 'array', items: { type: 'string', minLength: 1 } },
            cover: { type: 'string', enum: ['none', 'ocean', 'emerald', 'amber', 'violet', 'rose', 'slate'] },
            pinned: { type: 'boolean' },
            status: { type: 'string', enum: ['draft', 'pending_confirm', 'confirmed', 'implemented'] },
            priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
            stakeholder: { type: 'string' },
            meetingDate: { type: 'string' },
            shareable: { type: 'boolean' },
            linkedPageIds: { type: 'array', items: { type: 'string', minLength: 1 } },
            linkedFolderIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        notePatch: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'operations'],
          properties: {
            id: { type: 'string', minLength: 1 },
            operations: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['mode'],
                properties: {
                  mode: { type: 'string', enum: ['replace', 'append', 'prepend', 'replace_section'] },
                  target: { type: 'string' },
                  replacement: { type: 'string' },
                  replaceAll: { type: 'boolean' },
                  heading: { type: 'string' },
                  markdown: { type: 'string' },
                },
              },
            },
          },
        },
        mindmap: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'source'],
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            source: { type: 'string' },
            parentId: { type: ['string', 'null'] },
            linkedPageIds: { type: 'array', items: { type: 'string', minLength: 1 } },
            linkedFolderIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        folder: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title'],
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            parentId: { type: ['string', 'null'] },
            icon: { type: 'string' },
            linkedPageIds: { type: 'array', items: { type: 'string', minLength: 1 } },
            linkedFolderIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        agreement: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'title', 'text', 'pageIds'],
          properties: {
            id: { type: 'string', minLength: 1 },
            kind: { type: 'string', enum: ['requirement', 'field_constraint', 'design'] },
            title: { type: 'string', minLength: 1 },
            text: { type: 'string', minLength: 1 },
            pageIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        id: {
          type: 'string',
          description: 'Target note, mindmap, or agreement ID for delete/remove actions.',
        },
        expectedRevision: {
          type: 'string',
          description: 'Optional revision token for optimistic concurrency control.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_audit_project',
    description:
      'Run static closed-loop validation across the entire prototype (or a single pageId): cross-page references, ER design errors/risks, preview FK integrity, dangling table menu bindings, and per-page material/action contract checks.',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Audit Prototype Integrity & Contracts' },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'string',
          description: 'Optional pageId to restrict per-page contract inspection to one page.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_reshape_imported_page',
    description:
      'Inspect and reshape imported Axure RP (`rp-page-*`) or Figma (`fig-page-*`) pages into flow-layout `<Page>` / `<MobilePage>` optimized copies (`rp-optimized-*` / `fig-optimized-*`) while preserving original canvases.',
    annotations: { ...WRITE_ANNOTATIONS, title: 'Inspect & Reshape Imported Axure RP / Figma Pages' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'inspect_project',
            'inspect_page',
            'reshape_axure_page',
            'bind_axure_table',
            'optimize_axure_block',
            'reshape_figma_page',
          ],
          description: 'Read (inspect_project, inspect_page) or write sibling optimized copy.',
        },
        sourceType: {
          type: 'string',
          enum: ['axure', 'figma', 'auto'],
          description: 'Source family for inspect actions (default: "auto").',
        },
        pageId: {
          type: 'string',
          description: 'Source page ID (`rp-page-*` or `fig-page-*`).',
        },
        folderId: {
          type: 'string',
          description: 'Folder scope for inspect_project (exclusive with pageId).',
        },
        selectedPfId: {
          type: 'string',
          description: 'Subtree pfId filter for inspect_page.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 80,
          description: '1..8 for inspect_project; 1..80 for inspect_page.',
        },
        source: {
          type: 'string',
          description: 'Complete flow-layout `<Page>` / `<MobilePage>` TSX without AxureCanvas/FigmaCanvas.',
        },
        coverage: {
          anyOf: [AXURE_RESHAPE_COVERAGE_SCHEMA, FIGMA_RESHAPE_COVERAGE_SCHEMA],
          description: 'Source-widget accounting manifest for reshape_axure_page / reshape_figma_page.',
        },
        targetPfId: {
          type: 'string',
          description: 'Source StaticTable or widget pfId for bind_axure_table / optimize_axure_block.',
        },
        tableId: {
          type: 'string',
          description: 'Bound dbTables.id for bind_axure_table.',
        },
        mappings: {
          type: 'array',
          minItems: 1,
          items: AXURE_COLUMN_MAPPING_SCHEMA,
          description: 'First-row StaticTableCell column mappings for bind_axure_table.',
        },
        tsx: {
          type: 'string',
          description: 'Replacement component TSX preserving targetPfId for optimize_axure_block.',
        },
        setActive: {
          type: 'boolean',
          description: 'Set generated optimized copy as activePageId.',
        },
        expectedRevision: {
          type: 'string',
          description: 'Revision token for optimistic concurrency on write actions.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
];

const STICKY_ITEM_SCHEMA = {
  type: 'object',
  required: ['id', 'pageId', 'targetWidgetId', 'targetWidgetName', 'text'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    pageId: { type: 'string', minLength: 1 },
    targetWidgetId: { type: 'string', minLength: 1, description: 'Exact existing pfId on pageId.' },
    targetWidgetName: { type: 'string', minLength: 1 },
    index: { type: 'integer', minimum: 1, description: 'Optional 1-based display number (auto-assigned if omitted).' },
    text: { type: 'string', minLength: 1 },
    compiledRule: { type: 'string' },
    active: { type: 'boolean' },
  },
};

const DATASET_ITEM_SCHEMA = {
  type: 'object',
  required: ['tableId', 'rows'],
  additionalProperties: false,
  properties: {
    tableId: { type: 'string', minLength: 1 },
    rows: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
      },
    },
  },
};

export const DOMAIN_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'protoflow_workspace',
    description:
      'Workspace & contract hub: check status/contract, inspect project overview (Design Tokens, visualBaseline, sitemap, DB summary), load scenario guides, inspect TSX component/action contracts, or manage .pflow project metadata/files.',
    annotations: { ...WRITE_ANNOTATIONS, title: 'Workspace, Overview & Material Contracts' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'overview',
            'guide',
            'contracts',
            'list_projects',
            'create_project',
            'switch_project',
            'update_project_meta',
          ],
          description: 'Workspace action (default: "status").',
        },
        directory: { type: 'string', description: 'Directory to scan for list_projects.' },
        filePath: { type: 'string', description: 'Target .pflow path for create_project or switch_project.' },
        projectName: { type: 'string' },
        templateId: {
          type: 'string',
          enum: templateIds,
          description: 'Starter template for create_project (default: "blank_project").',
        },
        projectMode: { type: 'string', enum: projectModes },
        activePageId: { type: 'string' },
        designTokens: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['preset'],
              properties: {
                preset: { type: 'string', enum: DESIGN_PRESET_IDS },
                primaryColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                radius: { type: 'string', enum: DESIGN_RADIUS_TOKENS },
                density: { type: 'string', enum: DESIGN_DENSITY_TOKENS },
                surfaceVariant: { type: 'string', enum: DESIGN_SURFACE_TOKENS },
                colorMode: {
                  type: 'string',
                  enum: DESIGN_COLOR_MODES,
                  description: 'Keep "auto" (default) so the prototype follows the outer workbench/viewer light-dark theme toggle; only set "light" or "dark" if the user explicitly asks to lock the canvas theme.',
                },
              },
            },
          ],
          description: 'Canvas Design Tokens (pass null to reset to classic_antd).',
        },
        overwrite: { type: 'boolean' },
        includeDiagnostics: { type: 'boolean', description: 'Include diagnostics for action="overview" (default: true).' },
        scenarioIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scenario IDs for action="guide" (omit to list catalog).',
        },
        componentNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Component names to inspect in full for action="contracts" (omit to list catalog).',
        },
        includeAxure: { type: 'boolean' },
        includeFigma: { type: 'boolean' },
        expectedContractDigest: {
          type: 'string',
          description: 'Optional contractDigest from SKILL.md for action="status".',
        },
        expectedRevision: { type: 'string', description: 'Optimistic concurrency revision token.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_sitemap',
    description: 'Create, update, move, rename, or cascade-delete sitemap folders and menu pages.',
    annotations: { ...DESTRUCTIVE_WRITE_ANNOTATIONS, title: 'Manage Sitemap Folders & Menus' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['upsert_folder', 'move_item', 'rename_page', 'delete_item'],
          description: 'Sitemap mutation action.',
        },
        folder: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'parentFolderId'],
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            parentFolderId: { type: ['string', 'null'] },
          },
          description: 'Folder definition for upsert_folder (parentFolderId: null for top-level folder).',
        },
        target: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id'],
          properties: {
            kind: { type: 'string', enum: ['folder', 'page'] },
            id: { type: 'string', minLength: 1 },
          },
          description: 'Target item for move_item.',
        },
        parentFolderId: {
          type: ['string', 'null'],
          description: 'Destination parent folder ID for move_item (null allowed only for folders).',
        },
        pageId: { type: 'string', description: 'Target pageId for rename_page or delete_item.' },
        title: { type: 'string', description: 'New page title for rename_page.' },
        nodeId: { type: 'string', description: 'Target sitemap node ID for delete_item.' },
        expectedRevision: { type: 'string', description: 'Optimistic concurrency revision token.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_database',
    description:
      'Unified ER database & preview data tool: inspect schemas/DDL ("get_schema"), batch-create/update/delete physical ER tables & columns ("upsert_tables", "upsert_columns", "delete_tables"), and read/seed/clear FK-validated preview rows ("read_rows", "seed_rows", "clear_rows").',
    annotations: { ...DESTRUCTIVE_WRITE_ANNOTATIONS, title: 'Manage ER Database Schema & Preview Rows' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'get_schema',
            'upsert_tables',
            'upsert_columns',
            'delete_tables',
            'read_rows',
            'seed_rows',
            'clear_rows',
          ],
          description: 'Database schema or preview row operation.',
        },
        tableNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional physical tableNames or tableIds filter for get_schema.',
        },
        dialect: { type: 'string', enum: ['postgres', 'mysql'], description: 'SQL dialect for get_schema (default: "postgres").' },
        includeSampleRows: { type: 'boolean', description: 'Include sample rows in get_schema (default: true).' },
        sampleRowLimit: { type: 'integer', minimum: 1, maximum: 50 },
        tables: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: DB_TABLE_JSON_SCHEMA,
          description: '1..30 complete DBTableSchema definitions for upsert_tables.',
        },
        tableId: { type: 'string', description: 'Exact dbTables.id for upsert_columns or read_rows.' },
        columns: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: DB_COLUMN_JSON_SCHEMA,
          description: '1..50 DBColumnSchema definitions for upsert_columns.',
        },
        tableIds: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: { type: 'string', minLength: 1 },
          description: 'Exact dbTables.id list for delete_tables or clear_rows.',
        },
        force: { type: 'boolean', description: 'Allow delete_tables even if page TSX binds the table.' },
        offset: { type: 'integer', minimum: 0, description: 'Pagination offset for read_rows (default: 0).' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Pagination limit for read_rows (default: 20).' },
        datasets: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: DATASET_ITEM_SCHEMA,
          description: 'Coherent scenario datasets for seed_rows (each row needs a unique string id).',
        },
        replaceExisting: { type: 'boolean', description: 'Replace existing preview rows in target tables for seed_rows.' },
        expectedRevision: { type: 'string', description: 'Optimistic concurrency revision token for write actions.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_page',
    description:
      'Unified page specification & authoring tool: read single-page spec ("get_spec"), create/overwrite complete <Page>/<MobilePage> TSX ("write_page"), losslessly edit a localized subtree ("edit_block"), or inspect/reshape imported Axure RP & Figma pages.',
    annotations: { ...WRITE_ANNOTATIONS, title: 'Inspect, Write, Edit & Reshape Pages' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'get_spec',
            'write_page',
            'edit_block',
            'inspect_project',
            'inspect_page',
            'reshape_axure_page',
            'bind_axure_table',
            'optimize_axure_block',
            'reshape_figma_page',
          ],
          description: 'Page inspection or authoring action.',
        },
        pageId: { type: 'string', description: 'Target pageId (required except for inspect_project across folders).' },
        includeSource: { type: 'boolean', description: 'Include canonical TSX source for get_spec (default: true).' },
        selectedPfId: { type: 'string', description: 'Optional pfId filter for get_spec or inspect_page.' },
        includeInspection: { type: 'boolean', description: 'Include contract validation in get_spec (default: false).' },
        importView: { type: 'string', enum: ['axure', 'figma'], description: 'Optional imported canvas view for get_spec.' },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 80 },
        source: {
          type: 'string',
          description: 'Complete TSX (`export default function Page() { return (...); }`) with unique pfId on every element.',
        },
        title: { type: 'string', description: 'Page title (required when creating a new page in write_page).' },
        folderId: { type: 'string', description: 'Parent folderId (for new page in write_page or scope in inspect_project).' },
        platform: { type: 'string', enum: pagePlatforms, description: 'Explicit page platform for write_page.' },
        setActive: { type: 'boolean', description: 'Set page as activePageId after saving.' },
        targetPfId: { type: 'string', description: 'Target component pfId for edit_block / bind_axure_table / optimize_axure_block.' },
        mode: {
          type: 'string',
          enum: ['append_children', 'replace_node', 'delete_node'],
          description: 'Subtree edit mode for edit_block.',
        },
        tsx: { type: 'string', description: 'TSX fragment for edit_block or optimize_axure_block.' },
        sourceType: { type: 'string', enum: ['axure', 'figma', 'auto'], description: 'Import family filter (default: "auto").' },
        coverage: {
          anyOf: [AXURE_RESHAPE_COVERAGE_SCHEMA, FIGMA_RESHAPE_COVERAGE_SCHEMA],
          description: 'Coverage manifest for reshape_axure_page / reshape_figma_page.',
        },
        tableId: { type: 'string', description: 'Bound dbTables.id for bind_axure_table.' },
        mappings: {
          type: 'array',
          minItems: 1,
          items: AXURE_COLUMN_MAPPING_SCHEMA,
          description: 'Header column mappings for bind_axure_table.',
        },
        expectedRevision: { type: 'string', description: 'Optimistic concurrency revision token for write actions.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_docs',
    description:
      'Unified product documentation, mindmap & sticky-note tool: read notes/Mermaid flows ("get_docs"), create/patch PRD notes, manage Mermaid business mindmaps/flowcharts, pin component sticky-note rules ("upsert_sticky"/"delete_sticky"), and manage project agreements.',
    annotations: { ...DESTRUCTIVE_WRITE_ANNOTATIONS, title: 'Manage PRD Notes, Mindmaps, Stickies & Agreements' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'get_docs',
            'upsert_note',
            'patch_note',
            'upsert_note_folder',
            'delete_note',
            'upsert_mindmap',
            'upsert_mindmap_folder',
            'delete_mindmap',
            'upsert_sticky',
            'delete_sticky',
            'upsert_agreement',
            'remove_agreement',
          ],
          description: 'Documentation, mindmap, sticky-note, or agreement action.',
        },
        noteId: { type: 'string', description: 'Optional note ID for get_docs.' },
        mindmapId: { type: 'string', description: 'Optional mindmap ID for get_docs.' },
        pageId: { type: 'string', description: 'Optional pageId filter for get_docs.' },
        sectionHeading: { type: 'string', description: 'Optional heading text to extract one section in get_docs.' },
        charOffset: { type: 'integer', minimum: 0 },
        maxChars: { type: 'integer', minimum: 500, maximum: 200000 },
        note: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'markdown'],
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string' },
            markdown: { type: 'string' },
            parentId: { type: ['string', 'null'] },
            icon: { type: 'string' },
            tags: { type: 'array', items: { type: 'string', minLength: 1 } },
            cover: { type: 'string', enum: ['none', 'ocean', 'emerald', 'amber', 'violet', 'rose', 'slate'] },
            pinned: { type: 'boolean' },
            status: { type: 'string', enum: ['draft', 'pending_confirm', 'confirmed', 'implemented'] },
            priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
            stakeholder: { type: 'string' },
            meetingDate: { type: 'string' },
            shareable: { type: 'boolean' },
            linkedPageIds: { type: 'array', items: { type: 'string', minLength: 1 } },
            linkedFolderIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        notePatch: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'operations'],
          properties: {
            id: { type: 'string', minLength: 1 },
            operations: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['mode'],
                properties: {
                  mode: { type: 'string', enum: ['replace', 'append', 'prepend', 'replace_section'] },
                  target: { type: 'string' },
                  replacement: { type: 'string' },
                  replaceAll: { type: 'boolean' },
                  heading: { type: 'string' },
                  markdown: { type: 'string' },
                },
              },
            },
          },
        },
        mindmap: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'source'],
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            source: { type: 'string' },
            parentId: { type: ['string', 'null'] },
            linkedPageIds: { type: 'array', items: { type: 'string', minLength: 1 } },
            linkedFolderIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        folder: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title'],
          properties: {
            id: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            parentId: { type: ['string', 'null'] },
            icon: { type: 'string' },
            linkedPageIds: { type: 'array', items: { type: 'string', minLength: 1 } },
            linkedFolderIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        agreement: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'title', 'text', 'pageIds'],
          properties: {
            id: { type: 'string', minLength: 1 },
            kind: { type: 'string', enum: ['requirement', 'field_constraint', 'design'] },
            title: { type: 'string', minLength: 1 },
            text: { type: 'string', minLength: 1 },
            pageIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
        stickies: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: STICKY_ITEM_SCHEMA,
          description: 'Component-pinned sticky note rules for upsert_sticky.',
        },
        stickyIds: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string', minLength: 1 },
          description: 'Sticky IDs to remove for delete_sticky.',
        },
        id: { type: 'string', description: 'Target note, mindmap, or agreement ID for delete/remove actions.' },
        expectedRevision: { type: 'string', description: 'Optimistic concurrency revision token for write actions.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'protoflow_audit',
    description:
      'Quality audit, global specification search & engineering handoff tool: run full closed-loop static audit ("audit_project"), search across all tables/pages/notes/mindmaps ("search_spec"), or generate an implementation checklist ("checklist").',
    annotations: { ...READ_ONLY_ANNOTATIONS, title: 'Audit Project, Search Spec & Checklist' },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['audit_project', 'search_spec', 'checklist'],
          description: 'Verification or search action (default: "audit_project").',
        },
        pageId: { type: 'string', description: 'Optional pageId filter for audit_project.' },
        query: { type: 'string', minLength: 1, description: 'Keyword to search for search_spec.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max search results for search_spec (default: 25).' },
        moduleKeyword: { type: 'string', description: 'Optional module keyword filter for checklist.' },
      },
      additionalProperties: false,
    },
  },
];

const AUTHORING_TOOL_NAMES = new Set([
  ...DOMAIN_MCP_TOOLS.map((t) => t.name),
  ...AUTHORING_MCP_TOOLS.map((t) => t.name),
]);

export function isAuthoringToolName(name: string): boolean {
  return AUTHORING_TOOL_NAMES.has(name);
}

export const AUTHORING_MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: 'design-full-project',
    description: 'End-to-end 5-step workflow to design a full Alex (ProtoFlow AI) prototype: ER tables, seed rows, sitemap, PC/Mobile pages, sticky rules, and audit.',
    arguments: [
      { name: 'requirements', description: 'Business domain, core workflows, and user requirements.', required: true },
      { name: 'projectMode', description: 'Target platform: desktop, mobile, or hybrid (default: hybrid).', required: false },
      { name: 'filePath', description: 'Optional target .pflow file path.', required: false },
    ],
  },
  {
    name: 'design-page',
    description: 'Design or rebuild a single desktop (<Page>) or mobile (<MobilePage>) prototype page aligned with existing ER tables and contracts.',
    arguments: [
      { name: 'pageGoal', description: 'Purpose, fields, and interactive behaviors of the page.', required: true },
      { name: 'pageId', description: 'Existing or new pageId.', required: false },
      { name: 'folderId', description: 'Target folderId when creating a new page.', required: false },
      { name: 'platform', description: 'desktop or mobile.', required: false },
    ],
  },
  {
    name: 'refine-page',
    description: 'Losslessly adjust part of an existing prototype page while preserving unrelated components and pfIds.',
    arguments: [
      { name: 'pageId', description: 'Exact pageId to modify.', required: true },
      { name: 'changeRequest', description: 'Requested layout, field, binding, or interaction adjustment.', required: true },
      { name: 'targetPfId', description: 'Optional specific pfId selected for modification.', required: false },
    ],
  },
  {
    name: 'design-database',
    description: 'Design or evolve normalized shared ER database tables, foreign keys, unique constraints, and coherent preview rows.',
    arguments: [
      { name: 'domainRequirements', description: 'Entities, business rules, uniqueness constraints, and workflows to model.', required: true },
    ],
  },
  {
    name: 'reshape-imported-pages',
    description: 'Inspect and reshape imported Axure RP (`rp-page-*`) or Figma (`fig-page-*`) canvases into clean, data-bound flow-layout Alex pages.',
    arguments: [
      { name: 'scopeTarget', description: 'Optional source pageId, folderId, or module name (omit to convert all imported pages).', required: false },
    ],
  },
];

export const AUTHORING_MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: 'protoflow://authoring/playbook',
    name: 'Alex Prototype Authoring Playbook',
    description: 'Authoritative workflow, ER modeling rules, and PC/Mobile DSL contract guide for external AI agents.',
    mimeType: 'text/markdown',
  },
];

function summarizeContractCatalog(includeAxure: boolean, includeFigma = false) {
  const all = getMaterialContracts();
  const desktop: { name: string; title: string; category: string; description: string }[] = [];
  const mobile: { name: string; title: string; category: string; description: string }[] = [];
  const universal: { name: string; title: string; category: string; description: string }[] = [];
  const axure: { name: string; title: string; category: string; description: string }[] = [];
  const figma: { name: string; title: string; category: string; description: string }[] = [];

  for (const item of all) {
    const entry = {
      name: item.name,
      title: item.title,
      category: item.category,
      description: item.description,
    };
    if (isAxureMaterial(item.name)) {
      if (includeAxure) axure.push(entry);
    } else if (isFigmaMaterial(item.name)) {
      if (includeFigma) figma.push(entry);
    } else if (item.platform === 'universal') {
      universal.push(entry);
    } else if (item.platform === 'mobile') {
      mobile.push(entry);
    } else {
      desktop.push(entry);
    }
  }

  return {
    materialContractVersion: MATERIAL_CONTRACT_VERSION,
    serverVersion: PROTOFLOW_SERVER_VERSION,
    contractDigest: PROTOFLOW_CONTRACT_DIGEST,
    componentCounts: {
      desktop: desktop.length,
      mobile: mobile.length,
      universal: universal.length,
      ...(includeAxure ? { axure: axure.length } : {}),
      ...(includeFigma ? { figma: figma.length } : {}),
    },
    components: {
      desktop,
      mobile,
      universal,
      ...(includeAxure ? { axure } : {}),
      ...(includeFigma ? { figma } : {}),
    },
    actions: getActionContracts(),
  };
}

function findSitemapNodeIdForPage(
  draft: PflowBinaryPayload,
  pageId: string
): string | null {
  const s = draft.stateSnapshot;
  const tree = buildSitemap(s.designerFolders, s.designerPages, s.sitemapOverrides, s.sitemapBase);
  const stack = [...tree];
  while (stack.length > 0) {
    const item = stack.shift()!;
    if (item.pageId === pageId) return item.id;
    if (item.children) stack.push(...item.children);
  }
  return null;
}

function handleManageSitemap(draft: PflowBinaryPayload, args: Record<string, unknown>) {
  const action = requireNonEmptyString(args.action, 'action');
  const s = draft.stateSnapshot;

  if (action === 'upsert_folder') {
    if (!isPlainObject(args.folder)) {
      throw new Error(tr('缺少必填参数 folder', 'Missing required parameter folder'));
    }
    const id = requireNonEmptyString(args.folder.id, 'folder.id');
    const title = requireNonEmptyString(args.folder.title, 'folder.title');
    const parentFolderId =
      args.folder.parentFolderId === null
        ? null
        : requireNonEmptyString(args.folder.parentFolderId, 'folder.parentFolderId');

    const catalog = sitemapCatalog(s.sitemapBase);
    if (catalog.builtinFolders.has(id) || catalog.builtinNodes.has(id)) {
      throw new Error(
        tr(
          `不能替换内置模板目录 "${id}"；请使用新的自定义目录 ID`,
          `Cannot replace built-in template folder "${id}"; choose a distinct custom folder ID`
        )
      );
    }

    const nextFolders = s.designerFolders.some((f) => f.id === id)
      ? s.designerFolders.map((f) => (f.id === id ? { id, title, parentFolderId } : f))
      : [...s.designerFolders, { id, title, parentFolderId }];
    validateDesignerFolders(nextFolders, s.sitemapOverrides, s.sitemapBase);
    s.designerFolders = nextFolders;
    return { action, folder: { id, title, parentFolderId } };
  }

  if (action === 'move_item') {
    if (!isPlainObject(args.target)) {
      throw new Error(tr('缺少必填参数 target', 'Missing required parameter target'));
    }
    const kind = args.target.kind;
    if (kind !== 'folder' && kind !== 'page') {
      throw new Error(tr('target.kind 必须是 "folder" 或 "page"', 'target.kind must be "folder" or "page"'));
    }
    const id = requireNonEmptyString(args.target.id, 'target.id');
    if (args.parentFolderId !== null && typeof args.parentFolderId !== 'string') {
      throw new Error(
        tr(
          'parentFolderId 必须是目录 ID 字符串或 null（仅目录可移至顶层）',
          'parentFolderId must be a folder ID string or null (null is only valid for folders)'
        )
      );
    }
    const target: SitemapMoveTarget = { kind, id };
    const parentFolderId = args.parentFolderId === null ? null : requireNonEmptyString(args.parentFolderId, 'parentFolderId');
    const moved = prepareSitemapMove(s, target, parentFolderId);
    s.designerFolders = moved.designerFolders;
    s.designerPages = moved.designerPages;
    s.sitemapOverrides = moved.sitemapOverrides;
    return { action, target, parentFolderId };
  }

  if (action === 'rename_page') {
    const pageId = requireNonEmptyString(args.pageId, 'pageId');
    const title = requireNonEmptyString(args.title, 'title');
    const idx = s.designerPages.findIndex((p) => p.pageId === pageId);
    if (idx < 0) {
      if (sitemapCatalog(s.sitemapBase).builtinPages.has(pageId)) {
        throw new Error(
          tr(
            `内置模板页面 "${pageId}" 暂不支持直接改名，仅支持重命名自定义页面`,
            `Built-in template page "${pageId}" cannot be renamed; only custom designer pages can be renamed`
          )
        );
      }
      throw new Error(tr(`找不到页面 "${pageId}"`, `Page "${pageId}" not found`));
    }
    s.designerPages[idx] = { ...s.designerPages[idx], title };
    return { action, pageId, title };
  }

  if (action === 'delete_item') {
    const explicitNodeId = typeof args.nodeId === 'string' && args.nodeId.trim() ? args.nodeId.trim() : null;
    const explicitPageId = typeof args.pageId === 'string' && args.pageId.trim() ? args.pageId.trim() : null;
    if (!explicitNodeId && !explicitPageId) {
      throw new Error(
        tr('delete_item 需要提供 nodeId 或 pageId', 'delete_item requires either nodeId or pageId')
      );
    }
    const resolvedNodeId = explicitNodeId ?? findSitemapNodeIdForPage(draft, explicitPageId!);
    if (!resolvedNodeId) {
      throw new Error(
        tr(
          `在当前菜单目录中找不到页面 "${explicitPageId}"`,
          `Page "${explicitPageId}" was not found in the current sitemap`
        )
      );
    }
    const plan = prepareMenuDeletion(draft, resolvedNodeId);
    draft.stateSnapshot = plan.next.stateSnapshot;
    draft.meta = plan.next.meta;
    return {
      action,
      deletedNodeId: resolvedNodeId,
      deletedTitle: plan.title,
      kind: plan.kind,
      deletedPageIds: plan.pageIds,
      deletedFolderCount: plan.folderCount,
      removedStickyCount: plan.stickyCount,
      removedTableBindingCount: plan.bindingCount,
      removedNavLinkCount: plan.linkCount,
      changedSources: plan.changedSources,
    };
  }

  throw new Error(tr(`不支持的菜单操作：${action}`, `Unsupported sitemap action: ${action}`));
}

function handleUpsertDbTables(draft: PflowBinaryPayload, args: Record<string, unknown>) {
  const action = typeof args.action === 'string' && args.action.trim() ? args.action.trim() : 'upsert_tables';
  const s = draft.stateSnapshot;
  const before = s.dbTables;
  const knownMenus = menuPageIds(s);

  if (action === 'upsert_tables') {
    if (!Array.isArray(args.tables) || args.tables.length === 0) {
      throw new Error(tr('upsert_tables 需要提供非空的 tables 数组', 'upsert_tables requires a non-empty tables array'));
    }
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const incoming: DBTableSchema[] = args.tables.map((raw, i) => {
      validateDbTableInput(raw, `tables[${i}]`);
      if (seenIds.has(raw.id)) {
        throw new Error(tr(`批量请求中存在重复表 ID：${raw.id}`, `Duplicate table id in batch: ${raw.id}`));
      }
      if (seenNames.has(raw.tableName.toLowerCase())) {
        throw new Error(
          tr(`批量请求中存在重复物理表名：${raw.tableName}`, `Duplicate physical tableName in batch: ${raw.tableName}`)
        );
      }
      seenIds.add(raw.id);
      seenNames.add(raw.tableName.toLowerCase());
      return structuredClone(raw);
    });

    const incomingById = new Map(incoming.map((t) => [t.id, t]));
    const updated = before.map((existing) => incomingById.get(existing.id) ?? existing);
    const existingIdSet = new Set(before.map((t) => t.id));
    for (const tbl of incoming) {
      if (!existingIdSet.has(tbl.id)) updated.push(tbl);
    }

    const review = reviewDatabaseChanges(before, updated);
    const hardErrors = [...review.tableErrors, ...review.relationErrors];
    if (hardErrors.length > 0) {
      throw new Error(
        tr(
          `数据库结构审查未通过（未保存）：\n${hardErrors.join('\n')}`,
          `Database schema review failed (nothing saved):\n${hardErrors.join('\n')}`
        )
      );
    }

    s.dbTables = updated;
    const pendingMenuBindings = incoming.flatMap((tbl) =>
      tbl.sharedByMenus
        .filter((m) => !knownMenus.has(m.pageId))
        .map((m) => ({ tableId: tbl.id, tableName: tbl.tableName, pageId: m.pageId, menuTitle: m.menuTitle }))
    );

    return {
      action,
      updatedTableIds: incoming.map((t) => t.id),
      totalTables: updated.length,
      designReview: {
        risks: review.risks,
        affectedRules: review.affectedRules,
      },
      ...(pendingMenuBindings.length > 0 ? { pendingMenuBindings } : {}),
    };
  }

  if (action === 'upsert_columns') {
    const tableId = requireNonEmptyString(args.tableId, 'tableId');
    if (!Array.isArray(args.columns) || args.columns.length === 0) {
      throw new Error(tr('upsert_columns 需要提供非空的 columns 数组', 'upsert_columns requires a non-empty columns array'));
    }
    const existing = before.find((t) => t.id === tableId);
    if (!existing) {
      throw new Error(
        tr(
          `找不到数据表 "${tableId}"（请使用 exact dbTables.id，勿用物理表名替代）`,
          `Database table "${tableId}" not found (use exact dbTables.id, not physical tableName)`
        )
      );
    }

    const nextColumns: DBColumnSchema[] = structuredClone(existing.columns);
    const updatedColumnIds: string[] = [];
    args.columns.forEach((rawCol, i) => {
      validateDbColumnInput(rawCol, `columns[${i}]`);
      const col = structuredClone(rawCol);
      updatedColumnIds.push(col.id);
      const idx = nextColumns.findIndex((c) => c.id === col.id);
      if (idx < 0) nextColumns.push(col);
      else nextColumns[idx] = col;
    });

    const nextTable: DBTableSchema = { ...structuredClone(existing), columns: nextColumns };
    validateDbTableInput(nextTable, 'table');
    const updated = before.map((t) => (t.id === tableId ? nextTable : t));
    const review = reviewDatabaseChanges(before, updated);
    const hardErrors = [...review.tableErrors, ...review.relationErrors];
    if (hardErrors.length > 0) {
      throw new Error(
        tr(
          `字段修改未通过数据库审查（未保存）：\n${hardErrors.join('\n')}`,
          `Column update failed database review (nothing saved):\n${hardErrors.join('\n')}`
        )
      );
    }

    s.dbTables = updated;
    return {
      action,
      tableId,
      updatedColumnIds,
      columnCount: nextColumns.length,
      designReview: {
        risks: review.risks,
        affectedRules: review.affectedRules,
      },
    };
  }

  if (action === 'delete_tables') {
    if (!Array.isArray(args.tableIds) || args.tableIds.length === 0) {
      throw new Error(tr('delete_tables 需要提供非空的 tableIds 数组', 'delete_tables requires a non-empty tableIds array'));
    }
    const deleteIds = args.tableIds.map((id, i) => requireNonEmptyString(id, `tableIds[${i}]`));
    const deleteSet = new Set(deleteIds);
    for (const id of deleteSet) {
      if (!before.some((t) => t.id === id)) {
        throw new Error(tr(`找不到要删除的数据表 "${id}"`, `Table "${id}" not found for deletion`));
      }
    }

    const after = before.filter((t) => !deleteSet.has(t.id));
    const review = reviewDatabaseChanges(before, after);
    if (review.relationErrors.length > 0) {
      throw new Error(
        tr(
          `仍有其他表通过外键引用待删除的表（未删除）：\n${review.relationErrors.join('\n')}`,
          `Other tables still reference deleted table(s) via foreign keys (nothing deleted):\n${review.relationErrors.join('\n')}`
        )
      );
    }

    const analysis = analyzeProject(s);
    const impactedPageBindings = analysis.usages
      .filter((u) => deleteSet.has(u.tableId) && u.pfId !== null)
      .map((u) => ({ pageId: u.pageId, pfId: u.pfId, tableId: u.tableId }));

    if (impactedPageBindings.length > 0 && args.force !== true) {
      throw new Error(
        tr(
          `仍有页面组件绑定待删除的数据表（传 force: true 可强制删除）：${impactedPageBindings
            .map((b) => `${b.pageId}#${b.pfId}->${b.tableId}`)
            .join(', ')}`,
          `Page components still bind deleted table(s) (pass force: true to delete anyway): ${impactedPageBindings
            .map((b) => `${b.pageId}#${b.pfId}->${b.tableId}`)
            .join(', ')}`
        )
      );
    }

    s.dbTables = after;
    const nextRows: Record<string, Row[]> = {};
    for (const [tblId, rows] of Object.entries(s.tableRows)) {
      if (!deleteSet.has(tblId)) nextRows[tblId] = rows;
    }
    s.tableRows = nextRows;

    return {
      action,
      deletedTableIds: [...deleteSet],
      remainingTables: after.length,
      ...(impactedPageBindings.length > 0 ? { impactedPageBindings } : {}),
    };
  }

  throw new Error(tr(`不支持的数据库操作：${action}`, `Unsupported database action: ${action}`));
}

async function handleManageTableRows(workspace: AuthoringWorkspace, args: Record<string, unknown>) {
  const action = requireNonEmptyString(args.action, 'action');

  if (action === 'read') {
    const tableId = requireNonEmptyString(args.tableId, 'tableId');
    const offset = args.offset === undefined ? 0 : Number(args.offset);
    const limit = args.limit === undefined ? 20 : Number(args.limit);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error(tr('offset 须 >= 0，limit 须为 1..100 的整数', 'offset must be >= 0 and limit must be integer 1..100'));
    }
    const loaded = await workspace.load();
    const s = loaded.payload.stateSnapshot;
    const table = s.dbTables.find((t) => t.id === tableId);
    if (!table) {
      throw new Error(tr(`找不到数据表 "${tableId}"`, `Database table "${tableId}" not found`));
    }
    const hasSavedRows = hasOwn(s.tableRows, tableId);
    const rows = hasSavedRows ? s.tableRows[tableId] : [];
    const slice = rows.slice(offset, offset + limit);
    return {
      revision: loaded.revision,
      action,
      tableId,
      tableName: table.tableName,
      hasSavedRows,
      total: rows.length,
      offset,
      limit,
      rows: slice,
      nextOffset: offset + slice.length < rows.length ? offset + slice.length : null,
    };
  }

  if (action === 'seed') {
    if (!Array.isArray(args.datasets) || args.datasets.length === 0) {
      throw new Error(tr('seed 操作需要提供非空的 datasets 数组', 'seed requires a non-empty datasets array'));
    }
    const replaceExisting = args.replaceExisting === true;
    const targetIds = new Set<string>();
    for (let i = 0; i < args.datasets.length; i++) {
      const ds = args.datasets[i];
      if (isPlainObject(ds) && typeof ds.tableId === 'string') {
        targetIds.add(ds.tableId);
      }
    }

    const mutated = await workspace.mutate(
      (draft) => {
        const s = draft.stateSnapshot;
        const baseRows: Record<string, Row[]> = {};
        for (const [k, v] of Object.entries(s.tableRows)) {
          if (!replaceExisting || !targetIds.has(k)) {
            baseRows[k] = v;
          }
        }
        const added = preparePreviewScenario(s.dbTables, baseRows, args.datasets);
        s.tableRows = { ...baseRows, ...added };
        return {
          seededTables: Object.entries(added).map(([tableId, rows]) => ({
            tableId,
            rowCount: rows.length,
          })),
        };
      },
      { expectedRevision: optionalExpectedRevision(args), summary: 'seed tableRows' }
    );
    return { revision: mutated.revision, action, ...mutated.result };
  }

  if (action === 'clear') {
    if (!Array.isArray(args.tableIds) || args.tableIds.length === 0) {
      throw new Error(tr('clear 操作需要提供非空的 tableIds 数组', 'clear requires a non-empty tableIds array'));
    }
    const clearIds = new Set(args.tableIds.map((id, i) => requireNonEmptyString(id, `tableIds[${i}]`)));
    const mutated = await workspace.mutate(
      (draft) => {
        const s = draft.stateSnapshot;
        for (const id of clearIds) {
          if (!s.dbTables.some((t) => t.id === id)) {
            throw new Error(tr(`找不到数据表 "${id}"`, `Database table "${id}" not found`));
          }
        }
        const nextRows: Record<string, Row[]> = {};
        for (const [id, rows] of Object.entries(s.tableRows)) {
          if (!clearIds.has(id)) nextRows[id] = rows;
        }
        const issues = previewRelationIssues(s.dbTables, nextRows);
        if (issues.length > 0) {
          const first = issues[0];
          throw new Error(
            tr(
              `清空表数据后，子表 ${first.tableId} 的记录 ${first.firstRowId} 外键 ${first.field} -> ${first.target} 将失效；请同时清空或更新关联子表`,
              `Clearing table rows leaves child table ${first.tableId} row ${first.firstRowId} with broken FK ${first.field} -> ${first.target}; clear or update child tables together`
            )
          );
        }
        s.tableRows = nextRows;
        return { clearedTableIds: [...clearIds] };
      },
      { expectedRevision: optionalExpectedRevision(args), summary: 'clear tableRows' }
    );
    return { revision: mutated.revision, action, ...mutated.result };
  }

  throw new Error(tr(`不支持的预览数据操作：${action}`, `Unsupported table rows action: ${action}`));
}

function handleWritePage(draft: PflowBinaryPayload, args: Record<string, unknown>) {
  const pageId = requireNonEmptyString(args.pageId, 'pageId');
  const source = requireNonEmptyString(args.source, 'source');
  const requestedPlatform = optionalEnum(args.platform, pagePlatforms, 'platform');
  const s = draft.stateSnapshot;

  const parsed = parsePageSource(source, { strict: true });
  if (!parsed.doc || parsed.issues.length > 0 || parsed.normalized) {
    const details = [
      ...parsed.issues.map((i) => i.message),
      ...(parsed.normalized ? [tr('每个组件必须显式提供唯一非空 pfId，不能依赖自动补全', 'Every component must declare a unique explicit pfId')] : []),
    ];
    throw new Error(
      tr(
        `页面 TSX 语法或 pfId 校验失败（未保存）：\n${details.join('\n')}`,
        `Page TSX syntax or pfId validation failed (nothing saved):\n${details.join('\n')}`
      )
    );
  }

  const contractErrors = pageContractErrors(source, s.dbTables, { tableRows: s.tableRows });
  if (contractErrors.length > 0) {
    throw new Error(
      tr(
        `物料或数据契约校验失败（共 ${contractErrors.length} 项，未保存）：\n${contractErrors.join('\n')}\n请调用 protoflow_get_contracts 和 protoflow_get_database_schema 核对组件属性与物理表字段后修正重试。`,
        `Material or data contract validation failed (${contractErrors.length} issue(s), nothing saved):\n${contractErrors.join('\n')}\nInspect protoflow_get_contracts and protoflow_get_database_schema, fix the TSX, and retry.`
      )
    );
  }

  const resolvedPlatform = checkAiPagePlatform(s, pageId, parsed.doc.root.type, draft.meta.projectMode, requestedPlatform);

  const builtinPage = sitemapCatalog(s.sitemapBase).builtinPages.get(pageId);
  if (builtinPage && s.sitemapOverrides.deletedNodeIds?.includes(builtinPage.item.id)) {
    throw new Error(
      tr(
        `页面 ID "${pageId}" 属于已删除的模板页面，请使用新的 pageId`,
        `Page ID "${pageId}" belongs to a deleted template menu; choose a new pageId`
      )
    );
  }

  const isNew = !hasOwn(s.pageSources, pageId);
  let effectiveTitle = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : '';

  if (isNew) {
    if (builtinPage) {
      effectiveTitle = effectiveTitle || builtinPage.item.title;
    } else {
      if (!effectiveTitle) {
        throw new Error(tr('新建页面必须提供非空 title', 'Creating a new page requires a non-empty title'));
      }
      const folderId = requireNonEmptyString(args.folderId, 'folderId');
      const validFolders = folderOptions(s.designerFolders, s.sitemapOverrides, s.sitemapBase);
      const targetFolder = validFolders.find((f) => f.id === folderId && !f.deprecated);
      if (!targetFolder) {
        throw new Error(
          tr(
            `找不到有效的目标目录 "${folderId}"。可用目录：${validFolders
              .filter((f) => !f.deprecated)
              .map((f) => `${f.id}(${f.title})`)
              .join(', ') || '无（请先用 protoflow_manage_sitemap 创建目录）'}`,
            `Valid folder "${folderId}" not found. Available folders: ${validFolders
              .filter((f) => !f.deprecated)
              .map((f) => `${f.id}(${f.title})`)
              .join(', ') || 'none (create a folder with protoflow_manage_sitemap first)'}`
          )
        );
      }
      s.designerPages.push({
        pageId,
        title: effectiveTitle,
        folderId,
        platform: resolvedPlatform,
      });
    }
  } else {
    const customIdx = s.designerPages.findIndex((p) => p.pageId === pageId);
    if (customIdx >= 0) {
      if (effectiveTitle) {
        s.designerPages[customIdx] = { ...s.designerPages[customIdx], title: effectiveTitle, platform: resolvedPlatform };
      } else {
        effectiveTitle = s.designerPages[customIdx].title;
        s.designerPages[customIdx] = { ...s.designerPages[customIdx], platform: resolvedPlatform };
      }
    } else {
      effectiveTitle = effectiveTitle || builtinPage?.item.title || pageId;
    }
  }

  const canonicalSource = printPageSource(parsed.doc);
  s.pageSources[pageId] = canonicalSource;

  if (s.activePageId === '' || args.setActive === true) {
    s.activePageId = pageId;
  }

  const inspection = inspectPage(canonicalSource, s.dbTables, s.tableRows);
  const tableMenuCoverageIssues = auditTableMenuCoverage(s, pageId);
  for (const cov of tableMenuCoverageIssues) {
    inspection.warnings.push({
      pfId: parsed.doc.root.pfId,
      code: cov.kind,
      message: cov.message,
    });
  }

  return {
    pageId,
    title: effectiveTitle,
    created: isNew,
    platform: resolvedPlatform,
    activePageId: s.activePageId,
    inspection,
    ...(tableMenuCoverageIssues.length > 0 ? { tableMenuCoverageIssues } : {}),
  };
}

function handleEditPageBlock(draft: PflowBinaryPayload, args: Record<string, unknown>) {
  const pageId = requireNonEmptyString(args.pageId, 'pageId');
  const targetPfId = requireNonEmptyString(args.targetPfId, 'targetPfId');
  const mode = requireNonEmptyString(args.mode, 'mode');
  const s = draft.stateSnapshot;

  if (!hasOwn(s.pageSources, pageId)) {
    throw new Error(
      tr(
        `页面 "${pageId}" 尚无保存源码，请先调用 protoflow_write_page 创建页面框架`,
        `Page "${pageId}" does not have saved source yet; create the page shell via protoflow_write_page first`
      )
    );
  }

  const currentSource = s.pageSources[pageId];
  let nextSource: string;

  if (mode === 'append_children' || mode === 'replace_node') {
    const tsx = requireNonEmptyString(args.tsx, 'tsx');
    nextSource = editPageBlock(currentSource, targetPfId, mode, tsx);
  } else if (mode === 'delete_node') {
    const parsed = parsePageSource(currentSource, { strict: true });
    if (!parsed.doc || parsed.issues.length > 0) {
      throw new Error(
        tr(
          `当前页面源码存在解析错误，请先使用 protoflow_write_page 修复：${parsed.issues.map((i) => i.message).join('；')}`,
          `Current page source has parse errors; fix via protoflow_write_page first: ${parsed.issues.map((i) => i.message).join('; ')}`
        )
      );
    }
    if (targetPfId === parsed.doc.root.pfId) {
      throw new Error(tr('不能删除页面根节点（Page / MobilePage）', 'Cannot delete the root Page / MobilePage component'));
    }
    if (!findNode(parsed.doc.root, targetPfId)) {
      throw new Error(tr(`在页面 "${pageId}" 中找不到组件 pfId="${targetPfId}"`, `Component pfId="${targetPfId}" not found on page "${pageId}"`));
    }
    nextSource = printPageSource(removeNode(parsed.doc, targetPfId));
  } else {
    throw new Error(
      tr(
        `mode 仅支持 append_children、replace_node 或 delete_node（收到：${mode}）`,
        `mode must be append_children, replace_node, or delete_node (got: ${mode})`
      )
    );
  }

  const retargetedCopy = retargetEditedOptimizedCopy(s, pageId, nextSource);
  nextSource = retargetedCopy.source;

  const contractErrors = pageContractErrors(nextSource, s.dbTables, { tableRows: s.tableRows });
  if (contractErrors.length > 0) {
    throw new Error(
      tr(
        `区块修改后未通过页面契约校验（未保存）：\n${contractErrors.join('\n')}`,
        `Block edit failed page contract validation (nothing saved):\n${contractErrors.join('\n')}`
      )
    );
  }

  const nextDoc = parsePageSource(nextSource, { strict: true }).doc;
  if (nextDoc) {
    checkAiPagePlatform(s, pageId, nextDoc.root.type, draft.meta.projectMode);
  }

  s.pageSources[pageId] = nextSource;
  const inspection = inspectPage(nextSource, s.dbTables, s.tableRows);
  const tableMenuCoverageIssues = auditTableMenuCoverage(s, pageId);
  if (nextDoc) {
    for (const cov of tableMenuCoverageIssues) {
      inspection.warnings.push({
        pfId: nextDoc.root.pfId,
        code: cov.kind,
        message: cov.message,
      });
    }
  }
  return {
    pageId,
    targetPfId,
    mode,
    inspection,
    ...(tableMenuCoverageIssues.length > 0 ? { tableMenuCoverageIssues } : {}),
  };
}

function handleManageStickyNotes(draft: PflowBinaryPayload, args: Record<string, unknown>) {
  const action = requireNonEmptyString(args.action, 'action');
  const s = draft.stateSnapshot;

  if (action === 'upsert') {
    if (!Array.isArray(args.stickies) || args.stickies.length === 0) {
      throw new Error(tr('upsert 需要提供非空的 stickies 数组', 'upsert requires a non-empty stickies array'));
    }
    const nextNotes = structuredClone(s.stickyNotes);
    const updatedIds: string[] = [];

    for (let i = 0; i < args.stickies.length; i++) {
      const raw = args.stickies[i];
      if (!isPlainObject(raw)) {
        throw new Error(tr(`stickies[${i}] 必须是对象`, `stickies[${i}] must be an object`));
      }
      const id = requireNonEmptyString(raw.id, `stickies[${i}].id`);
      const pageId = requireNonEmptyString(raw.pageId, `stickies[${i}].pageId`);
      const targetWidgetId = requireNonEmptyString(raw.targetWidgetId, `stickies[${i}].targetWidgetId`);
      const targetWidgetName = requireNonEmptyString(raw.targetWidgetName, `stickies[${i}].targetWidgetName`);
      const text = requireNonEmptyString(raw.text, `stickies[${i}].text`);
      const compiledRule = raw.compiledRule === undefined ? '' : String(raw.compiledRule);
      const active = raw.active === undefined ? true : Boolean(raw.active);

      if (!hasOwn(s.pageSources, pageId)) {
        throw new Error(tr(`便签引用的页面 "${pageId}" 不存在`, `Page "${pageId}" referenced by sticky note does not exist`));
      }
      const root = parsePageSource(s.pageSources[pageId]).doc?.root;
      if (!root || !findNode(root, targetWidgetId)) {
        throw new Error(
          tr(
            `便签 ${id} 的目标组件 pfId="${targetWidgetId}" 在页面 "${pageId}" 中不存在`,
            `Target component pfId="${targetWidgetId}" for sticky "${id}" does not exist on page "${pageId}"`
          )
        );
      }

      const existingIdx = nextNotes.findIndex((n) => n.id === id);
      let index: number;
      if (raw.index !== undefined) {
        validateStickyNoteIndex(raw.index, `stickies[${i}]`);
        index = raw.index as number;
      } else if (existingIdx >= 0 && Number.isSafeInteger(nextNotes[existingIdx].index) && nextNotes[existingIdx].index >= 1) {
        index = nextNotes[existingIdx].index;
      } else {
        const maxOnPage = nextNotes
          .filter((n) => n.pageId === pageId && Number.isSafeInteger(n.index))
          .reduce((max, n) => Math.max(max, n.index), 0);
        index = maxOnPage + 1;
      }

      const record: StickyNoteRule = {
        id,
        pageId,
        targetWidgetId,
        targetWidgetName,
        index,
        text,
        compiledRule,
        active,
      };
      if (existingIdx < 0) nextNotes.push(record);
      else nextNotes[existingIdx] = record;
      updatedIds.push(id);
    }

    s.stickyNotes = nextNotes;
    return { action, updatedIds, totalStickies: nextNotes.length };
  }

  if (action === 'delete') {
    if (!Array.isArray(args.stickyIds) || args.stickyIds.length === 0) {
      throw new Error(tr('delete 需要提供非空的 stickyIds 数组', 'delete requires a non-empty stickyIds array'));
    }
    const delSet = new Set(args.stickyIds.map((id, i) => requireNonEmptyString(id, `stickyIds[${i}]`)));
    const beforeCount = s.stickyNotes.length;
    s.stickyNotes = s.stickyNotes.filter((n) => !delSet.has(n.id));
    return {
      action,
      deletedCount: beforeCount - s.stickyNotes.length,
      remainingStickies: s.stickyNotes.length,
    };
  }

  throw new Error(tr(`不支持的便签操作：${action}`, `Unsupported sticky note action: ${action}`));
}

function handleManageDocsAndFlows(draft: PflowBinaryPayload, args: Record<string, unknown>) {
  const action = requireNonEmptyString(args.action, 'action');
  const s = draft.stateSnapshot;
  const now = new Date().toISOString();

  if (action === 'upsert_note') {
    if (!isPlainObject(args.note)) {
      throw new Error(tr('缺少必填参数 note', 'Missing required parameter note'));
    }
    const n = args.note;
    const id = requireNonEmptyString(n.id, 'note.id');
    const markdown = typeof n.markdown === 'string' ? n.markdown : '';
    const converted = markdownToNoteHtml(markdown);

    const workspace = s.projectNotes ? structuredClone(s.projectNotes) : emptyProjectNotes();
    const existing = workspace.nodes.find((item) => item.id === id);
    if (existing && existing.kind !== 'note') {
      throw new Error(tr(`ID "${id}" 已被笔记目录占用`, `ID "${id}" already belongs to a note folder`));
    }
    const extracted = extractInlineNoteImages(converted.html, workspace.assets);
    if (extracted.assets) workspace.assets = extracted.assets;

    const title =
      typeof n.title === 'string' && n.title.trim()
        ? n.title.trim()
        : converted.title || (existing?.kind === 'note' ? existing.title : '');
    if (!title) {
      throw new Error(tr('笔记标题不能为空（可传入 note.title 或在 Markdown 首行写 # 标题）', 'Note title cannot be empty (pass note.title or start Markdown with # Title)'));
    }

    const parentId = resolveDocumentParentId(n.parentId, existing, 'note.parentId');

    const tags = Array.isArray(n.tags)
      ? n.tags.map((t, i) => requireNonEmptyString(t, `note.tags[${i}]`))
      : existing?.kind === 'note'
        ? existing.tags
        : [];

    const record: NoteNode = {
      id,
      title,
      parentId,
      icon: typeof n.icon === 'string' && n.icon.trim() ? n.icon.trim() : existing?.icon ?? '📝',
      updatedAt: now,
      kind: 'note',
      content: extracted.html,
      tags,
      cover: (n.cover as NoteCoverId | undefined) ?? (existing?.kind === 'note' ? existing.cover : 'none'),
      pinned: typeof n.pinned === 'boolean' ? n.pinned : existing?.kind === 'note' ? existing.pinned : false,
      ...(n.status !== undefined
        ? { status: n.status as NoteRequirementStatus }
        : existing?.kind === 'note' && existing.status !== undefined
          ? { status: existing.status }
          : {}),
      ...(n.priority !== undefined
        ? { priority: n.priority as NotePriority }
        : existing?.kind === 'note' && existing.priority !== undefined
          ? { priority: existing.priority }
          : {}),
      ...(n.stakeholder !== undefined
        ? { stakeholder: String(n.stakeholder) }
        : existing?.kind === 'note' && existing.stakeholder !== undefined
          ? { stakeholder: existing.stakeholder }
          : {}),
      ...(n.meetingDate !== undefined
        ? { meetingDate: String(n.meetingDate) }
        : existing?.kind === 'note' && existing.meetingDate !== undefined
          ? { meetingDate: existing.meetingDate }
          : {}),
      ...(n.shareable !== undefined
        ? { shareable: Boolean(n.shareable) }
        : existing?.kind === 'note' && existing.shareable !== undefined
          ? { shareable: existing.shareable }
          : {}),
    };

    const existingIdx = workspace.nodes.findIndex((item) => item.id === id);
    if (existingIdx < 0) workspace.nodes.push(record);
    else workspace.nodes[existingIdx] = record;

    if (n.linkedPageIds !== undefined || n.linkedFolderIds !== undefined) {
      workspace.links = [
        ...workspace.links.filter((l) => l.targetNodeId !== id),
        ...buildLinksForTarget(id, n.linkedPageIds, n.linkedFolderIds),
      ];
    }

    validateProjectNotes(workspace, s);
    s.projectNotes = workspace;
    return { action, id, title, linkCount: workspace.links.filter((l) => l.targetNodeId === id).length };
  }

  if (action === 'patch_note') {
    if (!isPlainObject(args.notePatch)) {
      throw new Error(tr('缺少必填参数 notePatch', 'Missing required parameter notePatch'));
    }
    const p = args.notePatch;
    const id = requireNonEmptyString(p.id, 'notePatch.id');
    if (!Array.isArray(p.operations) || p.operations.length === 0) {
      throw new Error(tr('notePatch.operations 必须是非空数组', 'notePatch.operations must be a non-empty array'));
    }
    const workspace = s.projectNotes ? structuredClone(s.projectNotes) : emptyProjectNotes();
    const existingIdx = workspace.nodes.findIndex((item) => item.id === id);
    const existing = existingIdx >= 0 ? workspace.nodes[existingIdx] : undefined;
    if (!existing || existing.kind !== 'note') {
      throw new Error(tr(`找不到可局部编辑的笔记 "${id}"`, `Note "${id}" not found for patch_note`));
    }

    let bodyMd = noteHtmlToMarkdownBody(existing.content, {
      images: 'asset_ref',
      assets: workspace.assets,
    });

    p.operations.forEach((rawOp, idx) => {
      if (!isPlainObject(rawOp)) {
        throw new Error(tr(`notePatch.operations[${idx}] 必须是对象`, `notePatch.operations[${idx}] must be an object`));
      }
      const mode = requireNonEmptyString(rawOp.mode, `notePatch.operations[${idx}].mode`);
      if (mode === 'replace') {
        const target = requireNonEmptyString(rawOp.target, `notePatch.operations[${idx}].target`);
        if (typeof rawOp.replacement !== 'string') {
          throw new Error(tr(`notePatch.operations[${idx}].replacement 必须是字符串`, `notePatch.operations[${idx}].replacement must be a string`));
        }
        if (!bodyMd.includes(target)) {
          throw new Error(
            tr(
              `notePatch.operations[${idx}] 未在笔记 "${existing.title}" 中找到匹配的 target 文本`,
              `notePatch.operations[${idx}] target substring not found in note "${existing.title}"`
            )
          );
        }
        bodyMd = rawOp.replaceAll
          ? bodyMd.split(target).join(rawOp.replacement)
          : bodyMd.replace(target, () => rawOp.replacement as string);
      } else if (mode === 'append') {
        const chunk = requireNonEmptyString(rawOp.markdown, `notePatch.operations[${idx}].markdown`).trim();
        bodyMd = bodyMd.trim() ? `${bodyMd.trimEnd()}\n\n${chunk}` : chunk;
      } else if (mode === 'prepend') {
        const chunk = requireNonEmptyString(rawOp.markdown, `notePatch.operations[${idx}].markdown`).trim();
        bodyMd = bodyMd.trim() ? `${chunk}\n\n${bodyMd.trimStart()}` : chunk;
      } else if (mode === 'replace_section') {
        const heading = requireNonEmptyString(rawOp.heading, `notePatch.operations[${idx}].heading`);
        if (typeof rawOp.markdown !== 'string') {
          throw new Error(tr(`notePatch.operations[${idx}].markdown 必须是字符串`, `notePatch.operations[${idx}].markdown must be a string`));
        }
        const range = findMarkdownSectionRange(bodyMd, heading);
        if (!range) {
          throw new Error(
            tr(
              `notePatch.operations[${idx}] 未在笔记 "${existing.title}" 中找到章节标题 "${heading}"`,
              `notePatch.operations[${idx}] section heading "${heading}" not found in note "${existing.title}"`
            )
          );
        }
        const replacementChunk = rawOp.markdown.trim();
        const before = bodyMd.slice(0, range.start).trimEnd();
        const after = bodyMd.slice(range.end).trimStart();
        bodyMd = [before, replacementChunk, after].filter(Boolean).join('\n\n');
      } else {
        throw new Error(tr(`不支持的 notePatch 操作模式：${mode}`, `Unsupported notePatch mode: ${mode}`));
      }
    });

    const converted = markdownToNoteHtml(bodyMd, { extractTitle: false });
    const extracted = extractInlineNoteImages(converted.html, workspace.assets);
    if (extracted.assets) workspace.assets = extracted.assets;

    const nextTitle =
      typeof p.title === 'string' && p.title.trim() ? p.title.trim() : existing.title;
    const parentId = resolveDocumentParentId(p.parentId, existing, 'notePatch.parentId');
    const tags = Array.isArray(p.tags)
      ? p.tags.map((t, i) => requireNonEmptyString(t, `notePatch.tags[${i}]`))
      : existing.tags;

    const updated: NoteNode = {
      ...existing,
      title: nextTitle,
      parentId,
      icon: typeof p.icon === 'string' && p.icon.trim() ? p.icon.trim() : existing.icon,
      updatedAt: now,
      content: extracted.html,
      tags,
      cover: (p.cover as NoteCoverId | undefined) ?? existing.cover,
      pinned: typeof p.pinned === 'boolean' ? p.pinned : existing.pinned,
      ...(p.status !== undefined ? { status: p.status as NoteRequirementStatus } : {}),
      ...(p.priority !== undefined ? { priority: p.priority as NotePriority } : {}),
      ...(p.stakeholder !== undefined ? { stakeholder: String(p.stakeholder) } : {}),
      ...(p.meetingDate !== undefined ? { meetingDate: String(p.meetingDate) } : {}),
      ...(p.shareable !== undefined ? { shareable: Boolean(p.shareable) } : {}),
    };

    workspace.nodes[existingIdx] = updated;
    if (p.linkedPageIds !== undefined || p.linkedFolderIds !== undefined) {
      workspace.links = [
        ...workspace.links.filter((l) => l.targetNodeId !== id),
        ...buildLinksForTarget(id, p.linkedPageIds, p.linkedFolderIds),
      ];
    }

    const cleaned = pruneUnusedNoteAssets(workspace);
    validateProjectNotes(cleaned, s);
    s.projectNotes = cleaned;
    return {
      action,
      id,
      title: nextTitle,
      appliedOperations: p.operations.length,
      markdownLength: bodyMd.length,
      linkCount: cleaned.links.filter((l) => l.targetNodeId === id).length,
    };
  }

  if (action === 'upsert_note_folder') {
    if (!isPlainObject(args.folder)) {
      throw new Error(tr('缺少必填参数 folder', 'Missing required parameter folder'));
    }
    const id = requireNonEmptyString(args.folder.id, 'folder.id');
    const title = requireNonEmptyString(args.folder.title, 'folder.title');
    const workspace = s.projectNotes ? structuredClone(s.projectNotes) : emptyProjectNotes();
    const idx = workspace.nodes.findIndex(item => item.id === id);
    const existing = workspace.nodes[idx];
    if (existing && existing.kind !== 'folder') throw new Error(tr(`ID "${id}" 已由文档使用`, `ID "${id}" already belongs to a document`));
    const parentId = resolveDocumentParentId(args.folder.parentId, existing, 'folder.parentId');
    const icon = typeof args.folder.icon === 'string' && args.folder.icon.trim() ? args.folder.icon.trim() : existing?.icon ?? '📁';
    const record: NoteNode = { id, title, parentId, icon, updatedAt: now, kind: 'folder' };
    if (idx < 0) workspace.nodes.push(record);
    else workspace.nodes[idx] = record;

    if (args.folder.linkedPageIds !== undefined || args.folder.linkedFolderIds !== undefined) {
      workspace.links = [
        ...workspace.links.filter((l) => l.targetNodeId !== id),
        ...buildLinksForTarget(id, args.folder.linkedPageIds, args.folder.linkedFolderIds),
      ];
    }

    validateProjectNotes(workspace, s);
    s.projectNotes = workspace;
    return { action, id, title, linkCount: workspace.links.filter((l) => l.targetNodeId === id).length };
  }

  if (action === 'delete_note') {
    const id = requireNonEmptyString(args.id, 'id');
    if (!s.projectNotes || !s.projectNotes.nodes.some((n) => n.id === id)) {
      throw new Error(tr(`找不到笔记或目录 "${id}"`, `Note or folder "${id}" not found`));
    }
    const workspace = structuredClone(s.projectNotes);
    const removedIds = noteDescendants(workspace, id);
    workspace.nodes = workspace.nodes.filter((n) => !removedIds.has(n.id));
    workspace.links = workspace.links.filter((l) => !removedIds.has(l.targetNodeId));
    const cleaned = pruneUnusedNoteAssets(workspace);
    if (cleaned.nodes.length === 0 && cleaned.links.length === 0) {
      delete s.projectNotes;
    } else {
      validateProjectNotes(cleaned, s);
      s.projectNotes = cleaned;
    }
    return { action, deletedIds: [...removedIds] };
  }

  if (action === 'upsert_mindmap') {
    if (!isPlainObject(args.mindmap)) {
      throw new Error(tr('缺少必填参数 mindmap', 'Missing required parameter mindmap'));
    }
    const m = args.mindmap;
    const id = requireNonEmptyString(m.id, 'mindmap.id');
    const title = requireNonEmptyString(m.title, 'mindmap.title');
    const source = typeof m.source === 'string' ? m.source : '';
    const mindmaps = structuredClone(s.mindmaps);
    const existing = mindmaps.nodes.find((item) => item.id === id);
    if (existing && existing.kind !== 'mindmap') {
      throw new Error(tr(`ID "${id}" 已被脑图目录占用`, `ID "${id}" already belongs to a mindmap folder`));
    }
    const parentId = resolveDocumentParentId(m.parentId, existing, 'mindmap.parentId');

    const record: MindmapNode = { id, title, parentId, kind: 'mindmap', source };
    const idx = mindmaps.nodes.findIndex((item) => item.id === id);
    if (idx < 0) mindmaps.nodes.push(record);
    else mindmaps.nodes[idx] = record;

    if (m.linkedPageIds !== undefined || m.linkedFolderIds !== undefined) {
      mindmaps.links = [
        ...mindmaps.links.filter((l) => l.targetNodeId !== id),
        ...buildLinksForTarget(id, m.linkedPageIds, m.linkedFolderIds),
      ];
    }

    validateMindmaps(mindmaps, s);
    s.mindmaps = mindmaps;
    return { action, id, title, linkCount: mindmaps.links.filter((l) => l.targetNodeId === id).length };
  }

  if (action === 'upsert_mindmap_folder') {
    if (!isPlainObject(args.folder)) {
      throw new Error(tr('缺少必填参数 folder', 'Missing required parameter folder'));
    }
    const result = applyMindmapMutation(s, { ...args.folder, action: 'upsert_folder' });
    return { ...result, action };
  }

  if (action === 'delete_mindmap') {
    const id = requireNonEmptyString(args.id, 'id');
    if (!s.mindmaps.nodes.some((n) => n.id === id)) {
      throw new Error(tr(`找不到脑图或目录 "${id}"`, `Mindmap or folder "${id}" not found`));
    }
    const mindmaps = structuredClone(s.mindmaps);
    const removedIds = mindmapDescendants(mindmaps, id);
    mindmaps.nodes = mindmaps.nodes.filter((n) => !removedIds.has(n.id));
    mindmaps.links = mindmaps.links.filter((l) => !removedIds.has(l.targetNodeId));
    validateMindmaps(mindmaps, s);
    s.mindmaps = mindmaps;
    return { action, deletedIds: [...removedIds] };
  }

  if (action === 'upsert_agreement') {
    if (!isPlainObject(args.agreement)) {
      throw new Error(tr('缺少必填参数 agreement', 'Missing required parameter agreement'));
    }
    applyProjectAgreement(s, args.agreement);
    return { action, id: String(args.agreement.id), totalAgreements: (s.projectAgreements ?? []).length };
  }

  if (action === 'remove_agreement') {
    const id = requireNonEmptyString(args.id, 'id');
    const existing = s.projectAgreements ?? [];
    if (!existing.some((a) => a.id === id)) {
      throw new Error(tr(`找不到项目约定 "${id}"`, `Project agreement "${id}" not found`));
    }
    s.projectAgreements = existing.filter((a) => a.id !== id);
    return { action, removedId: id, totalAgreements: s.projectAgreements.length };
  }

  throw new Error(tr(`不支持的文档/导图操作：${action}`, `Unsupported docs/flows action: ${action}`));
}

export const CONTRACT_DRIFT_ERROR_PREFIX = '[CONTRACT_DRIFT]';

export class SkillContractDriftError extends Error {
  readonly expectedDigest: string;
  readonly serverDigest: string;

  constructor(expectedDigest: string, serverDigest: string, serverVersion: string) {
    super(
      tr(
        `${CONTRACT_DRIFT_ERROR_PREFIX} 技能契约摘要不一致，已拒绝执行：当前 SKILL.md 期望 ${expectedDigest}，运行中的 MCP 服务端（v${serverVersion}）实际为 ${serverDigest}。当前会话已锁定以阻止过期工具调用，请在 Alex 桌面端（MCP → 双向设计）刷新技能后重新发起对话。`,
        `${CONTRACT_DRIFT_ERROR_PREFIX} Skill contract drift refused: SKILL.md expects ${expectedDigest}, while the running MCP server (v${serverVersion}) exposes ${serverDigest}. Session tool calls are locked to prevent stale execution—refresh the installed skill in Alex Desktop (MCP → Bidirectional design) before continuing.`,
      ),
    );
    this.name = 'SkillContractDriftError';
    this.expectedDigest = expectedDigest;
    this.serverDigest = serverDigest;
  }
}

export async function executeAuthoringTool(
  workspace: AuthoringWorkspace,
  name: string,
  rawArgs: Record<string, unknown> | undefined
): Promise<unknown> {
  const args = rawArgs ?? {};

  switch (name) {
    case 'protoflow_workspace': {
      const action = typeof args.action === 'string' && args.action.trim() ? args.action.trim() : 'status';
      if (action === 'status') {
        const expectedDigest =
          args.expectedContractDigest === undefined
            ? undefined
            : requireNonEmptyString(args.expectedContractDigest, 'expectedContractDigest');
        const ctx = await workspace.getContext();
        const enriched = {
          ...ctx,
          serverVersion: PROTOFLOW_SERVER_VERSION,
          contractDigest: PROTOFLOW_CONTRACT_DIGEST,
        };
        if (expectedDigest === undefined) {
          return {
            ...enriched,
            contractCheckStatus: 'unchecked',
            contractCheckNotice: tr(
              '此次未传入 expectedContractDigest，技能契约尚未校验。若使用本地技能，请以其 SKILL.md 的 metadata.contractDigest 重试 status；也可直接调用 protoflow_workspace(action="contracts") 获取实时契约。',
              'Skill contract unchecked. Pass expectedContractDigest from SKILL.md metadata.contractDigest, or query protoflow_workspace(action="contracts") for live contracts.',
            ),
          } satisfies WorkspaceStatus;
        }
        if (expectedDigest !== PROTOFLOW_CONTRACT_DIGEST) {
          return {
            ...enriched,
            contractCheckStatus: 'mismatched',
            contractMatch: false,
            expectedContractDigest: expectedDigest,
            contractDriftNotice: tr(
              `本地技能摘要（${expectedDigest}）与当前运行服务端（v${PROTOFLOW_SERVER_VERSION}，${PROTOFLOW_CONTRACT_DIGEST}）存在差异，已自动启用实时契约自愈兼容模式，无需中断对话或要求用户刷新插件。请直接调用 protoflow_workspace(action="contracts") 与 protoflow_workspace(action="guide") 按实时契约继续执行。`,
              `Local skill digest (${expectedDigest}) differs from the running server (v${PROTOFLOW_SERVER_VERSION}, ${PROTOFLOW_CONTRACT_DIGEST}). Live contract self-healing is active — do NOT interrupt the user or ask to reinstall. Call protoflow_workspace(action="contracts") and protoflow_workspace(action="guide") to inspect live contracts and continue.`,
            ),
          } satisfies WorkspaceStatus;
        }
        return { ...enriched, contractCheckStatus: 'matched', contractMatch: true } satisfies WorkspaceStatus;
      }
      if (action === 'overview') {
        const loaded = await workspace.load();
        return executeSpecTool(loaded, 'protoflow_get_project_overview', args);
      }
      if (action === 'guide') {
        return await executeAuthoringTool(workspace, 'protoflow_get_implementation_guide', args);
      }
      if (action === 'contracts') {
        return await executeAuthoringTool(workspace, 'protoflow_get_contracts', args);
      }
      if (action === 'list_projects') {
        return await workspace.listProjects(typeof args.directory === 'string' ? args.directory : undefined);
      }
      if (action === 'create_project') {
        const filePath = requireNonEmptyString(args.filePath, 'filePath');
        const projectName = requireNonEmptyString(args.projectName, 'projectName');
        const templateId = optionalEnum(args.templateId, templateIds, 'templateId');
        const projectMode = optionalEnum(args.projectMode, projectModes, 'projectMode');
        if (args.designTokens !== undefined && args.designTokens !== null) {
          validateDesignTokens(args.designTokens, 'designTokens');
        }
        const created = await workspace.createProject({
          filePath,
          projectName,
          templateId,
          projectMode,
          overwrite: args.overwrite === true,
        });
        if (args.designTokens !== undefined) {
          const tokenInput = args.designTokens;
          const mutated = await workspace.mutate(
            (draft) => {
              if (tokenInput === null || isDefaultDesignTokens(tokenInput)) {
                delete draft.stateSnapshot.designTokens;
              } else {
                validateDesignTokens(tokenInput, 'designTokens');
                draft.stateSnapshot.designTokens = structuredClone(tokenInput);
              }
              return exportDesignTokensSpec(draft.stateSnapshot.designTokens, isEnLocale() ? 'en-US' : 'zh-CN');
            },
            { expectedRevision: created.revision, summary: 'apply initial design tokens' },
          );
          return { ...created, revision: mutated.revision, designTokens: mutated.result };
        }
        return created;
      }
      if (action === 'switch_project') {
        const filePath = requireNonEmptyString(args.filePath, 'filePath');
        return await workspace.switchProject(filePath);
      }
      if (action === 'update_project_meta' || action === 'update_meta') {
        const mutated = await workspace.mutate(
          (draft) => {
            const s = draft.stateSnapshot;
            if (typeof args.projectName === 'string') {
              const trimmed = args.projectName.trim();
              if (!trimmed) throw new Error(tr('projectName 不能为空', 'projectName cannot be empty'));
              draft.meta.projectName = trimmed;
            }
            if (args.projectMode !== undefined) {
              if (args.projectMode !== 'desktop' && args.projectMode !== 'mobile' && args.projectMode !== 'hybrid') {
                throw new Error(tr('projectMode 必须是 desktop、mobile 或 hybrid', 'projectMode must be desktop, mobile, or hybrid'));
              }
              draft.meta.projectMode = args.projectMode;
            }
            if (args.activePageId !== undefined) {
              if (typeof args.activePageId !== 'string') throw new Error('activePageId must be a string');
              const targetPage = args.activePageId.trim();
              if (targetPage === '') {
                const knownPages = menuPageIds(s);
                if (Object.keys(s.pageSources).length > 0 || knownPages.size > 0) {
                  throw new Error(tr('工程存在页面时 activePageId 不能为空', 'activePageId cannot be empty when project has pages'));
                }
                s.activePageId = '';
              } else {
                const knownPages = menuPageIds(s);
                if (!hasOwn(s.pageSources, targetPage) && !knownPages.has(targetPage)) {
                  throw new Error(tr(`找不到目标页面 "${targetPage}"`, `Target page "${targetPage}" not found`));
                }
                s.activePageId = targetPage;
              }
            }
            if (args.designTokens !== undefined) {
              if (args.designTokens === null) {
                delete s.designTokens;
              } else {
                validateDesignTokens(args.designTokens, 'designTokens');
                if (isDefaultDesignTokens(args.designTokens)) {
                  delete s.designTokens;
                } else {
                  s.designTokens = structuredClone(args.designTokens);
                }
              }
            }
            return {
              projectId: draft.meta.projectId,
              projectName: draft.meta.projectName,
              projectMode: draft.meta.projectMode ?? 'desktop',
              activePageId: s.activePageId,
              designTokens: exportDesignTokensSpec(s.designTokens, isEnLocale() ? 'en-US' : 'zh-CN'),
            };
          },
          { expectedRevision: optionalExpectedRevision(args), summary: 'update project meta' }
        );
        return { revision: mutated.revision, filePath: mutated.filePath, ...mutated.result };
      }
      throw new Error(tr(`不支持的 workspace 操作：${action}`, `Unsupported workspace action: ${action}`));
    }

    case 'protoflow_get_implementation_guide': {
      const scenarioIds = Array.isArray(args.scenarioIds)
        ? args.scenarioIds.map((id, i) => requireNonEmptyString(id, `scenarioIds[${i}]`))
        : undefined;
      return getImplementationGuide(scenarioIds);
    }

    case 'protoflow_get_contracts': {
      const includeAxure = args.includeAxure === true;
      const includeFigma = args.includeFigma === true;
      const requestedNames = Array.isArray(args.componentNames)
        ? args.componentNames.map((n, i) => requireNonEmptyString(n, `componentNames[${i}]`))
        : undefined;
      if (!requestedNames || requestedNames.length === 0) {
        return summarizeContractCatalog(includeAxure, includeFigma);
      }
      const all = getMaterialContracts();
      const byName = new Map(all.map((c) => [c.name, c]));
      const missing = requestedNames.filter((n) => !byName.has(n));
      if (missing.length > 0) {
        throw new Error(
          tr(
            `未知物料组件名称：${missing.join(', ')}。请先不传 componentNames 调用 protoflow_get_contracts 查看可用组件列表。`,
            `Unknown component name(s): ${missing.join(', ')}. Call protoflow_get_contracts without componentNames first to list registered materials.`
          )
        );
      }
      const matched = requestedNames.map((n) => byName.get(n)!);
      return {
        materialContractVersion: MATERIAL_CONTRACT_VERSION,
        serverVersion: PROTOFLOW_SERVER_VERSION,
        contractDigest: PROTOFLOW_CONTRACT_DIGEST,
        components: matched,
        valueDefinitions: MATERIAL_VALUE_DEFINITIONS,
        actions: getActionContracts(),
      };
    }

    case 'protoflow_sitemap':
    case 'protoflow_manage_sitemap': {
      const mutated = await workspace.mutate((draft) => handleManageSitemap(draft, args), {
        expectedRevision: optionalExpectedRevision(args),
        summary: 'manage sitemap',
      });
      return { revision: mutated.revision, ...mutated.result };
    }

    case 'protoflow_database': {
      const action = requireNonEmptyString(args.action, 'action');
      if (action === 'get_schema') {
        const loaded = await workspace.load();
        return executeSpecTool(loaded, 'protoflow_get_database_schema', args);
      }
      if (action === 'upsert_tables' || action === 'upsert_columns' || action === 'delete_tables') {
        return await executeAuthoringTool(workspace, 'protoflow_upsert_db_tables', args);
      }
      if (action === 'read_rows' || action === 'read') {
        return await handleManageTableRows(workspace, { ...args, action: 'read' });
      }
      if (action === 'seed_rows' || action === 'seed') {
        return await handleManageTableRows(workspace, { ...args, action: 'seed' });
      }
      if (action === 'clear_rows' || action === 'clear') {
        return await handleManageTableRows(workspace, { ...args, action: 'clear' });
      }
      throw new Error(tr(`不支持的数据库操作：${action}`, `Unsupported database action: ${action}`));
    }

    case 'protoflow_page': {
      const action = requireNonEmptyString(args.action, 'action');
      if (action === 'get_spec') {
        const loaded = await workspace.load();
        return executeSpecTool(loaded, 'protoflow_get_page_spec', args);
      }
      if (action === 'write_page') {
        return await executeAuthoringTool(workspace, 'protoflow_write_page', args);
      }
      if (action === 'edit_block') {
        return await executeAuthoringTool(workspace, 'protoflow_edit_page_block', args);
      }
      if (
        action === 'inspect_project' ||
        action === 'inspect_imported_project' ||
        action === 'inspect_page' ||
        action === 'inspect_imported_page' ||
        action === 'reshape_axure_page' ||
        action === 'bind_axure_table' ||
        action === 'optimize_axure_block' ||
        action === 'reshape_figma_page'
      ) {
        const normalizedAction =
          action === 'inspect_imported_project'
            ? 'inspect_project'
            : action === 'inspect_imported_page'
              ? 'inspect_page'
              : action;
        return await executeAuthoringTool(workspace, 'protoflow_reshape_imported_page', {
          ...args,
          action: normalizedAction,
        });
      }
      throw new Error(tr(`不支持的页面操作：${action}`, `Unsupported page action: ${action}`));
    }

    case 'protoflow_docs': {
      const action = requireNonEmptyString(args.action, 'action');
      if (action === 'get_docs') {
        const loaded = await workspace.load();
        return executeSpecTool(loaded, 'protoflow_get_docs_and_flows', args);
      }
      if (action === 'upsert_sticky' || action === 'upsert_stickies') {
        return await executeAuthoringTool(workspace, 'protoflow_manage_sticky_notes', { ...args, action: 'upsert' });
      }
      if (action === 'delete_sticky' || action === 'delete_stickies') {
        return await executeAuthoringTool(workspace, 'protoflow_manage_sticky_notes', { ...args, action: 'delete' });
      }
      return await executeAuthoringTool(workspace, 'protoflow_manage_docs_and_flows', args);
    }

    case 'protoflow_audit': {
      const action = typeof args.action === 'string' && args.action.trim() ? args.action.trim() : 'audit_project';
      if (action === 'audit_project') {
        return await executeAuthoringTool(workspace, 'protoflow_audit_project', args);
      }
      if (action === 'search_spec') {
        const loaded = await workspace.load();
        return executeSpecTool(loaded, 'protoflow_search_spec', args);
      }
      if (action === 'checklist') {
        const loaded = await workspace.load();
        return executeSpecTool(loaded, 'protoflow_get_implementation_checklist', args);
      }
      throw new Error(tr(`不支持的审计/检索操作：${action}`, `Unsupported audit action: ${action}`));
    }

    case 'protoflow_upsert_db_tables': {
      const mutated = await workspace.mutate((draft) => handleUpsertDbTables(draft, args), {
        expectedRevision: optionalExpectedRevision(args),
        summary: 'upsert db tables',
      });
      return { revision: mutated.revision, ...mutated.result };
    }

    case 'protoflow_manage_table_rows': {
      return await handleManageTableRows(workspace, args);
    }

    case 'protoflow_write_page': {
      const mutated = await workspace.mutate((draft) => handleWritePage(draft, args), {
        expectedRevision: optionalExpectedRevision(args),
        summary: 'write page',
      });
      return { revision: mutated.revision, ...mutated.result };
    }

    case 'protoflow_edit_page_block': {
      const mutated = await workspace.mutate((draft) => handleEditPageBlock(draft, args), {
        expectedRevision: optionalExpectedRevision(args),
        summary: 'edit page block',
      });
      return { revision: mutated.revision, ...mutated.result };
    }

    case 'protoflow_manage_sticky_notes': {
      const mutated = await workspace.mutate((draft) => handleManageStickyNotes(draft, args), {
        expectedRevision: optionalExpectedRevision(args),
        summary: 'manage sticky notes',
      });
      return { revision: mutated.revision, ...mutated.result };
    }

    case 'protoflow_manage_docs_and_flows': {
      const mutated = await workspace.mutate((draft) => handleManageDocsAndFlows(draft, args), {
        expectedRevision: optionalExpectedRevision(args),
        summary: 'manage docs and flows',
      });
      return { revision: mutated.revision, ...mutated.result };
    }

    case 'protoflow_reshape_imported_page': {
      const action = requireNonEmptyString(args.action, 'action');
      const sourceType = optionalEnum(args.sourceType, ['axure', 'figma', 'auto'] as const, 'sourceType') ?? 'auto';

      if (action === 'inspect_project') {
        const scope = resolveImportInspectionScope(args);
        const offset = args.offset === undefined ? 0 : Number(args.offset);
        const limit = args.limit === undefined ? 4 : Number(args.limit);
        const loaded = await workspace.load();
        return {
          revision: loaded.revision,
          action,
          ...inspectImportedProjectInventory(loaded.payload.stateSnapshot, sourceType, scope, offset, limit),
        };
      }

      if (action === 'inspect_page') {
        const pageId = requireNonEmptyString(args.pageId, 'pageId');
        const selectedPfId =
          typeof args.selectedPfId === 'string' && args.selectedPfId.trim() ? args.selectedPfId.trim() : undefined;
        const offset = args.offset === undefined ? undefined : Number(args.offset);
        const limit = args.limit === undefined ? undefined : Number(args.limit);
        const loaded = await workspace.load();
        return {
          revision: loaded.revision,
          action,
          ...inspectImportedSourcePage(loaded.payload.stateSnapshot, pageId, sourceType, selectedPfId, offset, limit),
        };
      }

      if (action === 'reshape_axure_page') {
        const pageId = requireNonEmptyString(args.pageId, 'pageId');
        const source = requireNonEmptyString(args.source, 'source');
        const mutated = await workspace.mutate(
          (draft) => {
            const s = draft.stateSnapshot;
            const reshaped = reshapeAxurePage(s, pageId, source, args.coverage);
            const applied = commitOptimizedCopyPatch(s, draft.meta.projectMode, reshaped, args.setActive === true);
            return {
              action,
              sourcePageId: pageId,
              ...applied,
              rpCoverage: reshaped.rpCoverage,
              inspection: inspectPage(reshaped.source, s.dbTables, s.tableRows),
            };
          },
          { expectedRevision: optionalExpectedRevision(args), summary: `reshape Axure page ${pageId}` },
        );
        return { revision: mutated.revision, ...mutated.result };
      }

      if (action === 'bind_axure_table') {
        const pageId = requireNonEmptyString(args.pageId, 'pageId');
        const targetPfId = requireNonEmptyString(args.targetPfId, 'targetPfId');
        const tableId = requireNonEmptyString(args.tableId, 'tableId');
        if (!Array.isArray(args.mappings) || args.mappings.length === 0) {
          throw new Error(tr('bind_axure_table 需要提供非空的 mappings 数组', 'bind_axure_table requires a non-empty mappings array'));
        }
        const mutated = await workspace.mutate(
          (draft) => {
            const s = draft.stateSnapshot;
            const bound = bindAxureTable(s, pageId, targetPfId, tableId, args.mappings as RpColumnMapping[]);
            if ('unchanged' in bound) {
              return {
                action,
                sourcePageId: pageId,
                optimizedPageId: bound.pageId,
                unchanged: true,
              };
            }
            const applied = commitOptimizedCopyPatch(
              s,
              draft.meta.projectMode,
              {
                pageId: bound.pageId,
                title: bound.title,
                folderId: bound.folderId,
                source: bound.source,
              },
              args.setActive === true,
            );
            return {
              action,
              sourcePageId: pageId,
              unchanged: false,
              ...applied,
              inspection: inspectPage(bound.source, s.dbTables, s.tableRows),
            };
          },
          { expectedRevision: optionalExpectedRevision(args), summary: `bind Axure table on ${pageId}` },
        );
        return { revision: mutated.revision, ...mutated.result };
      }

      if (action === 'optimize_axure_block') {
        const pageId = requireNonEmptyString(args.pageId, 'pageId');
        const targetPfId = requireNonEmptyString(args.targetPfId, 'targetPfId');
        const tsx = requireNonEmptyString(args.tsx, 'tsx');
        const mutated = await workspace.mutate(
          (draft) => {
            const s = draft.stateSnapshot;
            const optimized = optimizeAxureBlock(s, pageId, targetPfId, tsx, true);
            const applied = commitOptimizedCopyPatch(s, draft.meta.projectMode, optimized, args.setActive === true);
            return {
              action,
              sourcePageId: pageId,
              targetPfId,
              ...applied,
              inspection: inspectPage(optimized.source, s.dbTables, s.tableRows),
            };
          },
          { expectedRevision: optionalExpectedRevision(args), summary: `optimize Axure block on ${pageId}` },
        );
        return { revision: mutated.revision, ...mutated.result };
      }

      if (action === 'reshape_figma_page') {
        const pageId = requireNonEmptyString(args.pageId, 'pageId');
        const source = requireNonEmptyString(args.source, 'source');
        const mutated = await workspace.mutate(
          (draft) => {
            const s = draft.stateSnapshot;
            const reshaped = reshapeFigmaPage(s, pageId, source, args.coverage);
            const applied = commitOptimizedCopyPatch(s, draft.meta.projectMode, reshaped, args.setActive === true);
            return {
              action,
              sourcePageId: pageId,
              ...applied,
              figmaCoverage: reshaped.figmaCoverage,
              inspection: inspectPage(reshaped.source, s.dbTables, s.tableRows),
            };
          },
          { expectedRevision: optionalExpectedRevision(args), summary: `reshape Figma frame ${pageId}` },
        );
        return { revision: mutated.revision, ...mutated.result };
      }

      throw new Error(tr(`不支持的导入重构操作：${action}`, `Unsupported imported-page reshape action: ${action}`));
    }

    case 'protoflow_audit_project': {
      const pageId = typeof args.pageId === 'string' && args.pageId.trim() ? args.pageId.trim() : null;
      const loaded = await workspace.load();
      const s = loaded.payload.stateSnapshot;
      const analysis = analyzeProject(s);
      if (pageId && !analysis.pages.some((p) => p.pageId === pageId)) {
        throw new Error(
          tr(
            `在项目中找不到页面 "${pageId}"`,
            `Page "${pageId}" not found in project`
          )
        );
      }

      const dbReview = reviewDatabaseDesign(s.dbTables);
      const previewIssues = previewRelationIssues(s.dbTables, s.tableRows);
      const knownMenus = menuPageIds(s);
      const danglingTableMenuBindings = s.dbTables.flatMap((tbl) =>
        tbl.sharedByMenus
          .filter((m) => !knownMenus.has(m.pageId))
          .map((m) => ({
            tableId: tbl.id,
            tableName: tbl.tableName,
            pageId: m.pageId,
            menuTitle: m.menuTitle,
          }))
      );

      const targetPages = analysis.pages.filter((p) => !p.deprecated && (!pageId || p.pageId === pageId));
      const pageAudits = targetPages.map((p) => {
        const src = s.pageSources[p.pageId];
        if (!src) {
          return {
            pageId: p.pageId,
            title: p.title,
            hasSource: false,
            valid: true,
            contractErrors: [] as string[],
            warnings: [] as { pfId: string; code: string; message: string }[],
          };
        }
        const inspected = inspectPage(src, s.dbTables, s.tableRows);
        return {
          pageId: p.pageId,
          title: p.title,
          hasSource: true,
          valid: inspected.validation.valid,
          contractErrors: inspected.validation.errors,
          warnings: inspected.warnings,
        };
      });

      const pagesWithErrors = pageAudits.filter((pa) => pa.contractErrors.length > 0).length;
      const pagesWithoutSource = pageAudits.filter((pa) => !pa.hasSource).length;
      const visualCheck = analyzeVisualConsistency(s);
      const visualConsistencyWarnings = pageId
        ? visualCheck.warnings.filter((w) => w.pageIds.includes(pageId))
        : visualCheck.warnings;
      const mindmapWarnings = auditProjectMindmaps(s, pageId);
      const tableMenuCoverageIssues = auditTableMenuCoverage(s, pageId);
      const blockingCoverageIssues = tableMenuCoverageIssues.filter((i) => i.blocking);
      const healthy =
        analysis.issues.length === 0 &&
        dbReview.tableErrors.length === 0 &&
        dbReview.relationErrors.length === 0 &&
        previewIssues.length === 0 &&
        danglingTableMenuBindings.length === 0 &&
        blockingCoverageIssues.length === 0 &&
        pagesWithErrors === 0;

      return {
        revision: loaded.revision,
        healthy,
        summary: {
          auditedPages: pageAudits.length,
          pagesWithErrors,
          pagesWithoutSource,
          referenceIssues: analysis.issues.length,
          databaseTableErrors: dbReview.tableErrors.length,
          databaseRelationErrors: dbReview.relationErrors.length,
          databaseDesignRisks: dbReview.risks.length,
          previewRelationIssues: previewIssues.length,
          danglingTableMenuBindings: danglingTableMenuBindings.length,
          unfulfilledTableMenuBindings: blockingCoverageIssues.length,
          tableMenuCoverageWarnings: tableMenuCoverageIssues.length,
          visualConsistencyWarnings: visualConsistencyWarnings.length,
          mindmapWarnings: mindmapWarnings.length,
        },
        referenceIssues: analysis.issues,
        databaseReview: dbReview,
        previewRelationIssues: previewIssues,
        danglingTableMenuBindings,
        unfulfilledTableMenuBindings: tableMenuCoverageIssues,
        visualBaseline: visualCheck.dominant,
        visualConsistencyWarnings,
        mindmapWarnings,
        pageAudits,
      };
    }

    default:
      throw new Error(tr(`未知的 Alex Authoring 工具：${name}`, `Unknown Alex authoring tool: ${name}`));
  }
}

export function getAuthoringPrompt(
  workspace: LoadedWorkspace | null,
  name: string,
  args: Record<string, string> | undefined
): { description: string; messages: { role: 'user'; content: { type: 'text'; text: string } }[] } {
  const projectLabel = workspace
    ? `「${workspace.payload.meta.projectName}」(${workspace.payload.meta.projectMode ?? 'desktop'})`
    : tr('当前工作区（如尚未创建工程，请先调用 protoflow_workspace）', 'active workspace (call protoflow_workspace if no project is open yet)');

  if (name === 'design-full-project') {
    const requirements = args?.requirements?.trim() || tr('由用户描述的完整业务系统需求', 'Full business system requirements described by the user');
    const projectMode = args?.projectMode?.trim() || 'hybrid';
    const filePath = args?.filePath?.trim();
    return {
      description: tr('按五步法从 0 到 1 生成完整的 Alex 原型工程（菜单、ER 表、预览数据、页面、便签与审计）', 'Design a complete Alex prototype project end-to-end in 5 steps'),
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: tr(
              [
                `请在 ${projectLabel} 中设计并生成完整的 Alex 业务原型。`,
                `目标形态：${projectMode}${filePath ? `；目标文件：${filePath}` : ''}`,
                `业务需求：${requirements}`,
                '',
                '请严格按以下五步执行（禁止跳过契约查询，禁止编造未注册的 AntD 属性或 JSX 回调）：',
                '1. **工作区与现状**：先调用 `protoflow_workspace(action="status")`；若尚未打开目标工程，按需求创建或切换到对应 `.pflow` 文件（注意设置 `projectMode`）。已有工程则调用 `protoflow_get_project_overview` 与 `protoflow_get_database_schema` 摸底。',
                '2. **澄清与确认**：若核心业务边界、状态枚举或关键唯一性约束存在歧义，先向用户提问澄清后再动手；常规页面布局自行决策。',
                '3. **目录 + 共享 ER 表 + 预览数据**：先用 `protoflow_manage_sitemap` 建好模块目录；再用 `protoflow_upsert_db_tables` 批量建好共享物理表（每表必须包含 `modeling.entity/grain/reason`、明确主键/外键/唯一约束与 `sharedByMenus`）；随后用 `protoflow_manage_table_rows(action="seed")` 灌入主子表外键自洽的真实样例行。',
                '4. **同源视觉定调 + 按需查契约 + 逐页实现**：先确定整套工程唯一的一组视觉母题 `(appearance, surfaceBg, accent, motion)`（已有页面时读取 `protoflow_get_project_overview.visualBaseline.dominant` 并全端严格继承，严禁每页换一套底色或主按钮色造成拼盘感；遵循 85% 统一底布 Bento 容器 + 10% 单页唯一反色压舱主卡 + 5% 绿/琥珀/红业务语义色）。调用 `protoflow_get_implementation_guide` 选定场景，再调用 `protoflow_get_contracts` 读取所用组件与动作的真实契约（PC 用 `<Page>`，移动用 `<MobilePage>` + `M*` 组件，严禁混用）。按依赖顺序用 `protoflow_write_page` 生成页面，并确保按钮/表格触发真实动作链（`submitForm`/`updateRow`/`deleteRow`/`navigate`/`openModal`/`openDrawer`），再用 `protoflow_manage_sticky_notes` 钉上关键业务规则便签，必要时用 `protoflow_manage_docs_and_flows` 补充 PRD 笔记与 Mermaid 流程图。',
                '5. **全工程闭环与同源审计**：最后调用 `protoflow_audit_project` 检查所有跨页引用、外键关联、预览数据、页面契约与 `visualConsistencyWarnings`，消除跨页视觉漂移并确保 `healthy: true`，如实汇报成果与原型边界。',
              ].join('\n'),
              [
                `Design and build a complete Alex (ProtoFlow AI) prototype project in ${projectLabel}.`,
                `Target mode: ${projectMode}${filePath ? `; target file: ${filePath}` : ''}`,
                `Business requirements: ${requirements}`,
                '',
                'Follow these 5 steps strictly (never skip contract lookup or invent AntD props / inline callbacks):',
                '1. **Workspace & Discovery**: Call `protoflow_workspace(action="status")`. Create or switch to the target `.pflow` file with the right `projectMode` if none is loaded, or inspect existing structure with `protoflow_get_project_overview` and `protoflow_get_database_schema`.',
                '2. **Clarify Ambiguities**: Ask the user only for critical business ambiguities (status transitions, uniqueness rules, ownership); decide standard UI layout yourself.',
                '3. **Sitemap + Shared ER Tables + Seed Data**: Create folders via `protoflow_manage_sitemap`, create normalized shared tables in batches via `protoflow_upsert_db_tables` (with `modeling.entity/grain/reason`, PK/FK/uniqueConstraints, and `sharedByMenus`), and seed coherent parent/child rows via `protoflow_manage_table_rows(action="seed")`.',
                '4. **Unified Visual Identity + Contracts + Pages**: Lock ONE cohesive visual system `(appearance, surfaceBg, accent, motion)` across all desktop `<Page>` and mobile `<MobilePage>` screens (inherit `visualBaseline.dominant` if pages already exist — never vary brand accent or canvas surface per page; follow 85% unified Bento canvas + 10% single inverted focal card + 5% semantic status colors). Call `protoflow_get_implementation_guide` and `protoflow_get_contracts` before writing TSX (never mix desktop and `M*` components), build pages via `protoflow_write_page` with real action chains, attach requirement pins via `protoflow_manage_sticky_notes`, and optionally add notes/Mermaid flows via `protoflow_manage_docs_and_flows`.',
                '5. **Closed-Loop & Visual Consistency Audit**: Run `protoflow_audit_project`, resolve every contract/FK error AND any `visualConsistencyWarnings` until `healthy: true`, then summarize what was built and any prototype boundaries.',
              ].join('\n')
            ),
          },
        },
      ],
    };
  }

  if (name === 'design-page') {
    const pageGoal = args?.pageGoal?.trim() || tr('按项目现有表结构新建或重构页面', 'Design or rebuild a page aligned with project tables');
    const pageIdHint = args?.pageId?.trim() ? `pageId="${args.pageId.trim()}"` : tr('按语义命名新的 pageId', 'choose a semantic pageId');
    const folderHint = args?.folderId?.trim() ? `folderId="${args.folderId.trim()}"` : tr('从概览中选择合适 folderId', 'pick a valid folderId from overview');
    const platformHint = args?.platform?.trim() || tr('遵循工程默认平台', 'match project mode');
    return {
      description: tr('基于工程 ER 表和实时物料契约设计单个页面', 'Design a single desktop or mobile prototype page'),
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: tr(
              [
                `请在 ${projectLabel} 中设计页面（${pageIdHint}，${folderHint}，平台：${platformHint}）。`,
                `页面目标：${pageGoal}`,
                '',
                '执行要求：',
                '1. 先调用 `protoflow_get_project_overview` 和 `protoflow_get_database_schema` 复用现有物理表、字段以及 `visualBaseline.dominant` 同源视觉基线（保持与兄弟页面一致的 `appearance`、`surfaceBg`、`accent` 与 `motion`），确认确实需要新字段或新表时再用 `protoflow_upsert_db_tables` 补齐。',
                '2. 调用 `protoflow_get_implementation_guide` 与 `protoflow_get_contracts` 核对将要使用的组件（PC 仅用桌面物料，移动仅用 `M*` 物料）与动作契约。',
                '3. 用 `protoflow_write_page` 写入完整页面（所有节点必须带唯一稳定 `pfId`），必要时用 `protoflow_manage_sticky_notes` 添加需求便签，最后用 `protoflow_audit_project` 校验零错误且无 `visualConsistencyWarnings`。',
              ].join('\n'),
              [
                `Design a page in ${projectLabel} (${pageIdHint}, ${folderHint}, platform: ${platformHint}).`,
                `Page goal: ${pageGoal}`,
                '',
                'Requirements:',
                '1. Call `protoflow_get_project_overview` and `protoflow_get_database_schema` first to reuse existing tables/columns and inherit `visualBaseline.dominant` (`appearance`, `surfaceBg`, `accent`, `motion`) from sibling pages; extend schema via `protoflow_upsert_db_tables` only when needed.',
                '2. Call `protoflow_get_implementation_guide` and `protoflow_get_contracts` for exact props and actions before writing TSX (never mix desktop and mobile `M*` materials).',
                '3. Write the page via `protoflow_write_page` with unique stable `pfId`s, attach sticky notes if needed, and verify zero contract errors and zero `visualConsistencyWarnings` via `protoflow_audit_project`.',
              ].join('\n')
            ),
          },
        },
      ],
    };
  }

  if (name === 'refine-page') {
    const pageId = args?.pageId?.trim() || '<pageId>';
    const changeRequest = args?.changeRequest?.trim() || tr('按用户要求微调页面结构或交互', 'Adjust page layout or interactions');
    const targetPfId = args?.targetPfId?.trim();
    return {
      description: tr('基于 pfId 无损局部精修已有原型页面', 'Losslessly refine an existing prototype page'),
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: tr(
              [
                `请在 ${projectLabel} 中局部调整页面 \`${pageId}\`${targetPfId ? `（重点组件 \`${targetPfId}\`）` : ''}。`,
                `调整诉求：${changeRequest}`,
                '',
                '执行要求：',
                `1. 先调用 \`protoflow_get_page_spec({ pageId: "${pageId}", includeInspection: true${targetPfId ? `, selectedPfId: "${targetPfId}"` : ''} })\` 获取现有 TSX 与组件树，如需改动字段先读 \`protoflow_get_database_schema\`。`,
                '2. 用 `protoflow_get_contracts` 核对涉及组件的属性与事件契约。',
                '3. 优先使用 `protoflow_edit_page_block`（`replace_node` / `append_children` / `delete_node`）保留无关组件及其 `pfId`；仅当涉及跨区大改时才使用 `protoflow_write_page`。最后用 `protoflow_audit_project({ pageId })` 确认无错误。',
              ].join('\n'),
              [
                `Refine page \`${pageId}\` in ${projectLabel}${targetPfId ? ` (focus pfId: \`${targetPfId}\`)` : ''}.`,
                `Change request: ${changeRequest}`,
                '',
                'Requirements:',
                `1. Call \`protoflow_get_page_spec({ pageId: "${pageId}", includeInspection: true${targetPfId ? `, selectedPfId: "${targetPfId}"` : ''} })\` first, and \`protoflow_get_database_schema\` if fields change.`,
                '2. Verify affected component props/events with `protoflow_get_contracts`.',
                '3. Prefer `protoflow_edit_page_block` (`replace_node` / `append_children` / `delete_node`) to preserve unrelated components and `pfId`s. Verify with `protoflow_audit_project({ pageId })`.',
              ].join('\n')
            ),
          },
        },
      ],
    };
  }

  if (name === 'design-database') {
    const domainRequirements = args?.domainRequirements?.trim() || tr('业务实体与约束描述', 'Business entities and constraints');
    return {
      description: tr('设计或演进高内聚、可复用的 ER 物理表与外键自洽样例数据', 'Design normalized shared ER database tables and coherent seed rows'),
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: tr(
              [
                `请在 ${projectLabel} 中设计或演进数据库 ER 模型：${domainRequirements}`,
                '',
                '执行要求：',
                '1. 先调用 `protoflow_get_project_overview` 与 `protoflow_get_database_schema` 盘点已有表、主键、外键和业务域。',
                '2. 坚持“同域同实体同粒度复用同一物理表”原则：每张表必须填写 `modeling.entity`、`modeling.grain`、`modeling.reason`；合理使用单列 `isUnique` 或表级 `uniqueConstraints`；外键 `references` 写成 `物理表名(列名)` 且保持两端 `dataType` 一致；SQL 无法表达的业务约束写入 `modeling.pendingRules`。',
                '3. 用 `protoflow_upsert_db_tables` 批量提交关联表，并用 `protoflow_manage_table_rows(action="seed")` 灌入满足全部外键、唯一性和非空约束的演示行，最后调用 `protoflow_audit_project` 核对设计风险。',
              ].join('\n'),
              [
                `Design or evolve the ER database schema in ${projectLabel}: ${domainRequirements}`,
                '',
                'Requirements:',
                '1. Inspect existing tables and domains via `protoflow_get_project_overview` and `protoflow_get_database_schema`.',
                '2. Reuse shared physical tables for the same entity/grain across menus; populate `modeling.entity/grain/reason`, `uniqueConstraints`, matching-type `references: "tableName(colName)"`, and `modeling.pendingRules` for rules DDL cannot enforce.',
                '3. Submit related tables together via `protoflow_upsert_db_tables`, seed coherent rows via `protoflow_manage_table_rows(action="seed")`, and verify via `protoflow_audit_project`.',
              ].join('\n')
            ),
          },
        },
      ],
    };
  }

  if (name === 'reshape-imported-pages') {
    const scopeTarget = args?.scopeTarget?.trim() || tr('当前工程中的全部导入原稿页面', 'all imported source pages in the active project');
    return {
      description: tr('盘点并将导入的 Axure RP 或 Figma 原稿页面重塑为绑定共享表的标准流式 Alex 页面', 'Inspect and reshape imported Axure RP or Figma canvases into standard flow-layout Alex pages'),
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: tr(
              [
                `请在 ${projectLabel} 中盘点并流式重塑导入原稿页面（范围：${scopeTarget}）。`,
                '',
                '执行要求：',
                '1. 先调用 `protoflow_reshape_imported_page({ action: "inspect_project" })` 分页盘点 `rp-page-*` / `fig-page-*` 原稿与迁移进度，再对目标页调用 `protoflow_reshape_imported_page({ action: "inspect_page", pageId })` 核对表头 `firstRow[].pfId`、列动作一致性 `columnActions`、`nearbyLabel` 或 Figma Auto Layout 重复组。',
                '2. 调用 `protoflow_get_database_schema`、`protoflow_get_implementation_guide({ scenarioIds: ["axure", "figma"] })` 与 `protoflow_get_contracts`，按需通过 `protoflow_upsert_db_tables` 建立或复用共享物理表。',
                '3. 调用 `protoflow_reshape_imported_page`（`action="reshape_axure_page"` 或 `"reshape_figma_page"`）写入同目录 `rp-optimized-*` / `fig-optimized-*` 流式副本（保留原始导入页不覆盖），完整提交 `coverage` 去向清单，最后调用 `protoflow_audit_project` 核验零契约错误。',
              ].join('\n'),
              [
                `Inspect and reshape imported Axure RP / Figma pages in ${projectLabel} (scope: ${scopeTarget}).`,
                '',
                'Requirements:',
                '1. Call `protoflow_reshape_imported_page({ action: "inspect_project" })` to inventory `rp-page-*` / `fig-page-*` pages, then `protoflow_reshape_imported_page({ action: "inspect_page", pageId })` to inspect `StaticTable` headers, `columnActions`, `nearbyLabel`, or Figma Auto Layout groups.',
                '2. Check `protoflow_get_database_schema`, `protoflow_get_implementation_guide({ scenarioIds: ["axure", "figma"] })`, and `protoflow_get_contracts`, creating or reusing shared tables via `protoflow_upsert_db_tables`.',
                '3. Write sibling `rp-optimized-*` / `fig-optimized-*` flow-layout copies via `protoflow_reshape_imported_page` (`reshape_axure_page` or `reshape_figma_page`) with a complete `coverage` manifest while keeping source canvases intact, then run `protoflow_audit_project`.',
              ].join('\n'),
            ),
          },
        },
      ],
    };
  }

  throw new Error(tr(`未知的 Authoring Prompt：${name}`, `Unknown authoring prompt: ${name}`));
}

export function readAuthoringResource(uri: string): { contents: { uri: string; mimeType: string; text: string }[] } {
  if (uri === 'protoflow://authoring/playbook') {
    const text = [
      '# Alex (ProtoFlow AI) Authoring Playbook',
      '',
      '## 1. Standard 5-Step Workflow',
      '1. Call `protoflow_workspace(action="status")` (and `create_project` / `switch_project` if needed), then `protoflow_get_project_overview` and `protoflow_get_database_schema`.',
      '2. Clarify critical business ambiguities before building; handle routine UI layout autonomously.',
      '3. Create sitemap folders (`protoflow_manage_sitemap`), batch-create normalized ER tables (`protoflow_upsert_db_tables`), and seed coherent preview data (`protoflow_manage_table_rows`).',
      '4. Load scenario guides (`protoflow_get_implementation_guide`) and exact component/action schemas (`protoflow_get_contracts`), then write pages (`protoflow_write_page` / `protoflow_edit_page_block`), sticky notes (`protoflow_manage_sticky_notes`), and structured project mindmaps + PRD notes (`protoflow_manage_docs_and_flows`: organize mindmap folders with `upsert_mindmap_folder`, write a product panorama `mindmap` plus core business `flowchart`/`stateDiagram-v2`/`sequenceDiagram` diagrams with `upsert_mindmap`, and bind `linkedFolderIds`/`linkedPageIds`).',
      '5. Run `protoflow_audit_project` and resolve all contract, FK, reference errors, `visualConsistencyWarnings`, and `mindmapWarnings` before concluding.',
      '',
      '## 2. UX Architecture & Material Selection Heuristics',
      '- **Project-Wide Cohesive Visual System (One Product, One Visual Language)**: Lock ONE unified `(appearance, surfaceBg, accent, motion)` identity across EVERY `<Page>` and `<MobilePage>` in the project (read `protoflow_get_project_overview.visualBaseline.dominant` when adding pages to an existing project). Never mix different brand accents or canvas atmospheres across sibling screens (e.g., avoid green on Page 1, indigo on Page 2, and pitch-black OLED on Page 3 unless a dedicated dark wallboard/night terminal was explicitly requested). Follow the **85 / 10 / 5 hierarchy**: 85% unified canvas + clean Bento containers (`Card variant="bento"`), 10% single inverted hero anchor per screen (`Statistic tone="inverted"` or `MHeroHeader mode="wallet" | "metric_hero"`), and 5% strict semantic status accents (`emerald` = healthy, `amber` = warning, `rose` = danger/undo). Reserve `tone="dark_brief"` exclusively for `lime_forest`/`emerald`/`sage_field` palettes; on `obsidian`/`mist`/`indigo`/`blue` palettes use `AiCopilotCard tone="indigo"` and `MAiInsightCard tone="glow"`.',
      '- **Brand Design Tokens**: Match industry temperament via `protoflow_workspace(action="update_project_meta", designTokens={ preset })` (`modern_minimal` for AI/SaaS, `collab_soft` for collaborative workspaces, `enterprise_compact` for finance/ERP/customs, `classic_antd` for general backoffice).',
      '- **Break CRUD Monotony**: Use Master-Detail (`autoSelectFirst={true}` + `selectRow()` paired with `<Card activeTable="...">` or `<MSurface activeTable="...">`) for高频审单/客诉处理; `Kanban` / `MKanban` for state-machine pipelines; `Calendar` / `MCalendar` for schedules/bookings; `Repeater` / `MRepeater` for rich custom cards; `ProgressBoard` / `MProgressList` for semicircle gauges & capsule goal bars; `ActivityFeed` / `MActivityList` for signed split-decimal ledgers; `AiCopilotCard` / `MAiInsightCard` for AI triage summaries; and `<MFloatingBar>` for live mobile status.',
      '- **UI Stack 5-State & Poka-Yoke**: Configure `<Page>` / `<MobilePage>` `emptyTitle` and `errorFallback` (`result_403` / `result_500`); attach cross-field `minField`/`maxField` (e.g. `inbound_qty <= remaining_qty`, `end_date >= start_date`), `disabledWhenField`/`hiddenWhenField` state guards on buttons/rowActions, `deleteRow("undo")` for recoverable deletes, and `confirm(msg, "{{row.code}}")` for irreversible high-risk actions.',
      '',
      '## 3. Hard Rules (Never Violate)',
      '- **Never guess props or write arbitrary React code**: Outer TSX only accepts registered components, props, and zero-argument runtime action chains from `protoflow_get_contracts`. No imports, JS callbacks (`() => ...`), `style`, or `className`.',
      '- **Every element needs a unique explicit `pfId`**: Never omit `pfId` or reuse duplicate `pfId`s.',
      '- **Strict PC vs Mobile isolation**: Desktop `<Page>` only uses desktop + universal components; Mobile `<MobilePage>` only uses `M*` + universal components. Declare overlays (`Modal`/`Drawer` or `MBottomSheet`/`MDialog`) as direct children of the page root.',
      '- **Reuse shared physical tables**: Use exact `dbTables.id` in `Table.table` / `Form.table` (never `tableName`), and exact `tableName(columnName)` in `column.references`.',
      '- **Real closed-loop actions**: Save actions must call `submitForm`, state updates must call `updateRow`, and cross-page links must call `navigate` to an existing `pageId`. Never fake persistence with `toast` alone.',
    ].join('\n');
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text,
        },
      ],
    };
  }
  throw new Error(tr(`未知的 Authoring Resource URI：${uri}`, `Unknown authoring resource URI: ${uri}`));
}
