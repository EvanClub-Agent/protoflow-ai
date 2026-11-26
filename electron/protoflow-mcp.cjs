const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
let tr;
try {
  ({ tr } = require("./i18n.cjs"));
} catch {
  tr = (zh, en, explicitLocale) =>
    /^en/i.test(String(explicitLocale || process.env.PROTOFLOW_LOCALE || "")) ? en : zh;
}
const { ContextBridgePool, BridgeTransportError, bridgeKey, oneShotContextSync } = require('./hermes-context-bridge.cjs');
const {
  projectExecutionBrief,
  applyProjectAgreement,
  validateStickyNoteIndex,
  validateClosedLoopAuditIssues,
  findNode,
  evaluatePageDraftReadiness,
  createEmptyDependencyFootprint,
  recordBriefFootprint,
  recordGetProjectFootprint,
  recordGetPageTsxFootprint,
  recordInspectPageFootprint,
  recordGetDbTableFootprint,
  recordGetStickyNotesFootprint,
  recordGetProjectNotesFootprint,
  recordReviewDbRequirementsFootprint,
  recordPageMutationFootprint,
  recordTableMutationFootprint,
  recordPreviewScenarioFootprint,
  recordStickyMutationFootprint,
  recordOtherMutationFootprint,
  buildNarrowedProjectPlan,
  filterGeneratingStickyNotes,
  filterGeneratingClosedLoopIssues,
  filterGeneratingProjectNotes,
  AXURE_COLUMN_MAPPING_SCHEMA,
  AXURE_RESHAPE_COVERAGE_SCHEMA,
  FIGMA_RESHAPE_COVERAGE_SCHEMA,
  retargetEditedOptimizedCopy,
  siblingNavigationPatches,
  CAPTURE_PREVIEW_PROPERTIES,
  parseCaptureOptions,
  buildStagedPreviewSnapshot,
} = require('./generated/material-contract.cjs');
const { tableSchema, columnSchema, validateTable } = require("./protoflow-db-contract.cjs");
const { parsePageSource, checkAiPagePlatform, preparePreviewScenario, collectRequirementRecords, reviewRequirementRecords, requirementEvidence, reviewDatabaseDesign, reviewDatabaseChanges, validateProjectQuestions, buildSitemap, folderOptions, menuPageIds, applyStructureOperation, finalProjectDraftOperations, pageContractErrors, inspectPage, inspectAxurePage, inspectAxureProject, axureCatalog, axureScopePages, bindAxureTable, optimizeAxureBlock, reshapeAxurePage, evaluateAxureMigrationProgress, checkRpTableExtension, figmaCatalog, figmaScopePages, inspectFigmaProject, inspectFigmaPage, reshapeFigmaPage, getImplementationGuide, getMaterialContracts, getActionContracts, MATERIAL_VALUE_DEFINITIONS, MATERIAL_CONTRACT_VERSION, editPageBlock } = require('./generated/material-contract.cjs');

// The host and native MCP compile this contract from the same registry. Never
// trust a cached conversation/snapshot to expand the actual runtime allowlist.
const materialContracts = getMaterialContracts();
const currentContracts = (snapshot) => ({
  ...snapshot.contracts,
  components: materialContracts,
  actions: getActionContracts(),
  materialContractVersion: MATERIAL_CONTRACT_VERSION,
  materialValueDefinitions: MATERIAL_VALUE_DEFINITIONS,
});

const exampleSchema = { type:'object', properties:{
  description:{type:'string'}, same:{type:'array',items:{type:'string'}}, different:{type:'array',items:{type:'string'}},
}, required:['description'], additionalProperties:false };
const evidenceFields = {
  dependencies: { type: 'array', description: 'Upstream dependencies ([] if independent; pending if unresolved).', items: {
    type: 'object', properties: {sourcePageId:{type:'string'},requirement:{type:'string'},kind:{enum:['reuse','foreignKey','pending']},
      sourceTableId:{type:'string',description:'Upstream dbTables.id (required for reuse/foreignKey).'},sourceColumnId:{type:'string',description:'Referenced target column ID.'},tableId:{type:'string',description:'Referencing dbTables.id.'},foreignKeyColumnId:{type:'string',description:'Referencing FK column ID.'}},
    required:['sourcePageId','requirement','kind'],additionalProperties:false}},
  acceptanceCases: { type:'array', minItems:1, items:{type:'object',properties:{
    scenario:{type:'string'}, expected:{type:'string'},
    actionPfId:{type:'string',description:'Trigger pfId or pfId.eventPath (e.g. dock.onPrimary, tbl.rowActions[0].onClick).'},
    actionEvent:{type:'string',description:'Exact event path on actionPfId.'},
    actionKind:{type:'string',enum:['submitForm','openOverlay','closeOverlay','navigate','updateRow','deleteRow','returnSelection'],description:'Expected runtime action (cancel/back must not write).'},
    targetId:{type:'string',description:'Target Form/MForm pfId, overlay id, target pageId, or picker Table pfId.'},
    tableId:{type:'string',description:'Bound dbTables.id for submitForm/updateRow/deleteRow.'},
    field:{type:'string',description:'Field updated by updateRow or returned by returnSelection.'},
    chart:{type:'object',description:'Bound chart pfId and source dbTables.id.',properties:{pfId:{type:'string'},tableId:{type:'string'}},required:['pfId','tableId'],additionalProperties:false},
    source:{type:'object',properties:{mindmapId:{type:'string'},quote:{type:'string'}},required:['mindmapId','quote'],additionalProperties:false}},
    required:['scenario','expected'],additionalProperties:false}}
};
const properties = {
  protoflow_add_preview_scenario: { datasets: {type:'array',minItems:1,maxItems:30,items:{type:'object',required:['tableId','rows'],additionalProperties:false,
    properties:{tableId:{type:'string'},rows:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:{type:['string','number','boolean','null']}}}}}} },
  protoflow_review_db_requirements: {
    sourceId:{type:'string'}, findings:{type:'array',items:{type:'object',required:['quote','state','note'],additionalProperties:false,properties:{
      quote:{type:'string'},state:{type:'string',enum:['declared','pending','clarify','gap','outside','excluded']},note:{type:'string'},
      tableId:{type:'string'},basis:{type:'string'},allow:exampleSchema,reject:exampleSchema,
    }}},
  },
  protoflow_move_sitemap_item: { target: { type:'object', properties:{kind:{enum:['folder','page']},id:{type:'string'}}, required:['kind','id'], additionalProperties:false }, parentFolderId: {type:['string','null']} },
  protoflow_get_project: {},
  protoflow_remove_project_agreement: { id: { type: 'string' } },
  protoflow_get_project_brief: { pageId: { type: 'string' }, folderId: { type: 'string' } },
  protoflow_search_history: { query: { type: 'string', minLength: 1, maxLength: 200 }, offset: { type: 'integer', minimum: 0 } },
  protoflow_upsert_project_agreement: { agreement: { type: 'object', properties: {
    id: { type: 'string' }, kind: { enum: ['requirement', 'field_constraint', 'design'] }, title: { type: 'string' },
    text: { type: 'string' }, pageIds: { type: 'array', items: { type: 'string' } },
  }, required: ['id', 'kind', 'title', 'text', 'pageIds'], additionalProperties: false } },
  protoflow_ask_questions: { questions: { type: 'array', minItems: 1, maxItems: 5, items: {
    type: 'object', properties: { question: {type:'string'}, options: {type:'array', minItems:2, maxItems:4, items:{type:'string'}} },
    required:['question','options'], additionalProperties:false } } },
  protoflow_revise_project_page: {
    ...evidenceFields, pageId:{type:'string'}, requirements:{type:'string'}, merge:{type:'object',
      properties:{sourcePageId:{type:'string'},overlayId:{type:'string'},presentation:{enum:['drawer','modal']}},
      required:['sourcePageId','overlayId','presentation'],additionalProperties:false}
  },
  protoflow_set_project_plan: { plan: { type:'object',description:'Complete proposal (preserve existing approved dependencies when revising).', properties:{
    summary:{type:'string'},folders:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},parentFolderId:{type:['string','null']}},required:['id','title','parentFolderId']}},
    pages:{type:'array',items:{type:'object',properties:{pageId:{type:'string'},title:{type:'string'},folderId:{type:'string'},requirements:{type:'string'},platform:{enum:['desktop','mobile'], description:'Required for new pages in hybrid projects.'},...evidenceFields},required:['pageId','title','folderId','requirements','dependencies','acceptanceCases']}}
  },required:['summary','folders','pages']} },
  protoflow_upsert_folder: { folder: { type: 'object', properties: { id: {type:'string'}, title:{type:'string'}, parentFolderId:{type:['string','null']} }, required:['id','title','parentFolderId'], additionalProperties:false } },
  protoflow_get_implementation_guide: {
    scenarioIds: { type: 'array', items: { type: 'string' }, description: 'Scenario IDs to load (omit to list catalog).' },
  },
  protoflow_inspect_axure_project: {
    pageId:{type:'string'}, folderId:{type:'string'},
    offset:{type:'integer',minimum:0}, limit:{type:'integer',minimum:1,maximum:8},
  },
  protoflow_bind_axure_table: {
    pageId:{type:'string'}, targetPfId:{type:'string'}, tableId:{type:'string'},
    mappings:{type:'array',minItems:1,items:AXURE_COLUMN_MAPPING_SCHEMA},
  },
  protoflow_optimize_axure_block: {
    pageId: { type:'string', description:'Source RP page ID.' },
    targetPfId: { type:'string', description:'Source widget/group pfId.' },
    tsx: { type:'string', description:'Replacement component TSX keeping pfId.' },
  },
  protoflow_reshape_axure_page: {
    pageId: { type:'string', description:'Source RP page ID (rp-page-<guid>).' },
    source: { type:'string', description:'Complete flow-layout <Page> TSX without AxureCanvas.' },
    coverage: AXURE_RESHAPE_COVERAGE_SCHEMA,
  },
  protoflow_inspect_figma_project: {
    pageId: { type: 'string' },
    folderId: { type: 'string' },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 8 },
  },
  protoflow_reshape_figma_page: {
    pageId: { type: 'string', description: 'Source Figma page ID (fig-page-<hash>).' },
    source: { type: 'string', description: 'Complete flow-layout <Page> or <MobilePage> TSX without FigmaCanvas.' },
    coverage: FIGMA_RESHAPE_COVERAGE_SCHEMA,
  },
  protoflow_capture_preview: CAPTURE_PREVIEW_PROPERTIES,
  protoflow_inspect_page: {
    view: { enum:['axure', 'figma'], description:'Paginated RP or Figma import inspection.' },
    offset: { type:'integer', minimum:0 }, limit: { type:'integer', minimum:1, maximum:80 },
    pageId: { type: 'string' },
    selectedPfId: { type: 'string', description: 'Subtree component pfId.' },
  },
  protoflow_get_contracts: {
    componentNames: {
      type: "array",
      items: { type: "string" },
      description: "Component names to inspect (omit to list catalog).",
    },
  },
  protoflow_get_page_tsx: { pageId: { type: "string" } },
  protoflow_get_sticky_notes: { pageId: { type: 'string', description: 'Menu page ID (omit for all).' } },
  protoflow_get_project_notes: {
    noteIds: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Exact noteIds from get_project.projectNotes.' },
    pageId: { type: 'string', description: 'Filter notes linked to pageId/folders.' },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
    charOffset: { type: 'integer', minimum: 0, description: 'Character offset for >20k-char notes.' },
    maxChars: { type: 'integer', minimum: 1000, maximum: 50000 },
  },
  protoflow_get_db_table: { tableId: { type: 'string', description: 'Exact dbTables.id (not tableName).' } },
  protoflow_get_table_rows: {
    tableId: { type: 'string' },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  protoflow_apply_tsx_patch: {
    pageId: { type: "string" },
    source: { type: "string" },
    title: { type: "string" },
    folderId: { type: "string" },
  },
  protoflow_edit_page_block: {
    pageId: { type: 'string' },
    targetPfId: { type: 'string', description: 'Existing node pfId.' },
    mode: { type: 'string', enum: ['append_children', 'replace_node'] },
    tsx: { type: 'string', description: 'Component TSX fragment with stable pfId(s).' },
  },
  protoflow_upsert_db_table: {
    table: tableSchema,
  },
  protoflow_upsert_db_column: {
    tableId: { type: "string" },
    column: columnSchema,
  },
  protoflow_upsert_sticky_contract: {
    sticky: {
      type: "object",
      description: "StickyNoteRule (use documented runtime actions only).",
      properties: {
        id: { type: 'string' }, pageId: { type: 'string' }, targetWidgetId: { type: 'string' },
        targetWidgetName: { type: 'string' }, index: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        text: { type: 'string' }, compiledRule: { type: 'string' }, active: { type: 'boolean' },
      },
      required: ['id', 'pageId', 'targetWidgetId', 'targetWidgetName', 'index', 'text', 'compiledRule', 'active'],
    },
  },
  protoflow_run_closed_loop_audit: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          scope: { type: "string", enum: ["module", "project"] },
          pageId: { type: "string", description: "Exact existing menu pageId." },
          moduleTitle: { type: "string" },
          category: { type: "string" },
          severity: { type: "string", enum: ["critical", "warning"] },
          title: { type: "string" },
          brokenChainDesc: { type: "string" },
          targetWidgetId: { type: "string", description: "Exact existing pfId in pageId." },
          targetWidgetName: { type: "string" },
          targetTableId: { type: "string", description: "Exact dbTables.id, or empty string '' when no database table is involved." },
          aiQuestion: { type: "string" },
          status: { type: "string", enum: ["open", "resolved"] },
          resolvedByOptionId: { type: "string" },
          customUserAnswer: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
                stickyPatchText: { type: "string" },
                dbPatchSummary: { type: "string" },
              },
              required: ["id", "label", "description", "stickyPatchText", "dbPatchSummary"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "id", "scope", "pageId", "moduleTitle", "category", "severity",
          "title", "brokenChainDesc", "targetWidgetId", "targetWidgetName",
          "targetTableId", "aiQuestion", "options", "status",
        ],
        additionalProperties: false,
      },
      description:
        "Full ClosedLoopAuditIssue list based on actual project evidence. An empty list is valid.",
    },
  },
};
const descriptions = {
  protoflow_add_preview_scenario: 'Initialize absent preview datasets with coherent synthetic rows (mandatory fields, distinct row ids, valid FKs; never overwrite existing datasets or claim mock figures are real).',
  protoflow_remove_project_agreement: 'Propose removing a saved project agreement by exact id on explicit user intent.',
  protoflow_get_project_brief: 'Read confirmed agreements, approved requirements, generation progress, and schema summary before working or after compaction (optional pageId or folderId narrows scope).',
  protoflow_search_history: 'Case-insensitive text search across this bound Hermes conversation and compacted ancestry (10 excerpts/page via offset; historical context only).',
  protoflow_upsert_project_agreement: 'Propose a durable requirement, field_constraint, or design agreement (stable id, complete text, exact pageIds or [] for project-wide; awaits user confirmation).',
  protoflow_review_db_requirements: 'Call with {} to read requirement sources/tokens, then submit sourceId + verbatim quote findings (declared/pending/clarify/gap/outside/excluded) with concrete allow/reject examples.',
  protoflow_move_sitemap_item: 'Stage moving an existing menu page or folder to parentFolderId (null allowed only for folders).',
  protoflow_ask_questions: 'Present 1–5 selectable clarification questions in project chat, then end the turn without staging edits or plans.',
  protoflow_revise_project_page: 'Propose revised requirements (and optional drawer/modal merge) for an existing or planned pageId.',
  protoflow_set_project_plan: 'Stage the complete project proposal (folders, pages, dependencies, acceptanceCases) for user confirmation after clarifying missing facts.',
  protoflow_upsert_folder: 'Create or update a custom sitemap folder (parentFolderId: null for root; cannot replace built-in folders).',
  protoflow_get_implementation_guide: 'Read scenario recipes (omit scenarioIds to list IDs first); pair with get_contracts before writing TSX.',
  protoflow_inspect_axure_project: 'Read paged inventory of imported RP source pages in project, folderId, or pageId.',
  protoflow_bind_axure_table: 'Convert an RP StaticTable to a bound Table on the optimized copy by mapping every first-row headerPfId from inspect_page(view="axure").',
  protoflow_optimize_axure_block: 'Localized positioned replacement of one RP widget/group on the sibling optimized copy; prefer reshape_axure_page for full flow-layout pages.',
  protoflow_reshape_axure_page: 'Reshape an imported RP page (rp-page-<guid>) into a flow-layout <Page> on its sibling rp-optimized-* copy with explicit widget/column coverage while keeping the source intact.',
  protoflow_inspect_figma_project: 'Read paged inventory of imported Figma frames (platform, Auto Layout repeating groups, semantic blocks, links).',
  protoflow_reshape_figma_page: 'Reshape an imported Figma frame (fig-page-<hash>) into a flow-layout <Page> or <MobilePage> on its sibling fig-optimized-* copy with layer coverage.',
  protoflow_capture_preview: 'Capture a rendered PNG of a page from the staged candidate snapshot (supports scope, fullPage, waitMs, and uiState).',
  protoflow_inspect_page: 'Inspect static material tree, subtree/ancestors, actions, table bindings, and contract errors (pass view="axure"|"figma" for paginated import layers).',
  protoflow_get_sticky_notes: 'Read saved requirement sticky notes (optional pageId filter).',
  protoflow_get_project_notes: 'Read paginated Markdown project notes by noteIds or pageId; continue with charOffset=nextCharOffset when truncated=true (draft/pending_confirm are unconfirmed).',
  protoflow_get_db_table: 'Read one saved DBTableSchema by exact dbTables.id (never tableName).',
  protoflow_get_table_rows: 'Read paginated saved preview rows by dbTables.id (offset/limit).',
  protoflow_edit_page_block: 'Append sibling children or replace one node (preserving targetPfId) on an existing staged page and validate the full page.',
  protoflow_get_contracts: 'Read exact registered component props/events/snippets and runtime actions (pass componentNames or omit to list catalog).',
  protoflow_get_project: 'Read project catalogue: sitemap, pageIds, dbTables summary, stickies, audit issues, and allowed contracts. Call first.',
  protoflow_get_page_tsx: 'Read current TSX source of pageId including staged edits.',
  protoflow_apply_tsx_patch: 'Validate and stage complete page TSX (include title/folderId for new pages; check get_contracts first).',
  protoflow_upsert_db_table: 'Stage a complete DBTableSchema after reading get_project (reuse entities across menus; schema-only, does not populate saved rows).',
  protoflow_upsert_db_column: 'Stage a column on an existing tableId after reading get_project (schema-only, does not populate saved rows).',
  protoflow_upsert_sticky_contract: 'Stage a requirement sticky note anchored to an existing component pfId.',
  protoflow_run_closed_loop_audit: 'Stage evidence-backed ClosedLoopAuditIssue list or update issue resolution.',
};
const required = {
  protoflow_add_preview_scenario: ['datasets'],
  protoflow_remove_project_agreement: ['id'],
  protoflow_get_project_brief: [],
  protoflow_search_history: ['query'],
  protoflow_upsert_project_agreement: ['agreement'],
  protoflow_review_db_requirements: [],
  protoflow_move_sitemap_item: ['target','parentFolderId'],
  protoflow_ask_questions: ['questions'],
  protoflow_revise_project_page: ['pageId','requirements'],
  protoflow_set_project_plan: ['plan'],
  protoflow_upsert_folder: ['folder'],
  protoflow_get_implementation_guide: [],
  protoflow_inspect_axure_project: [],
  protoflow_bind_axure_table: ['pageId','targetPfId','tableId','mappings'],
  protoflow_optimize_axure_block: ['pageId','targetPfId','tsx'],
  protoflow_reshape_axure_page: ['pageId','source','coverage'],
  protoflow_inspect_figma_project: [],
  protoflow_reshape_figma_page: ['pageId','source','coverage'],
  protoflow_capture_preview: [],
  protoflow_inspect_page: ['pageId'],
  protoflow_get_sticky_notes: [],
  protoflow_get_project_notes: [],
  protoflow_get_db_table: ['tableId'],
  protoflow_get_table_rows: ['tableId'],
  protoflow_get_contracts: [],
  protoflow_get_project: [],
  protoflow_get_page_tsx: ["pageId"],
  protoflow_apply_tsx_patch: ["pageId", "source"],
  protoflow_edit_page_block: ['pageId', 'targetPfId', 'mode', 'tsx'],
  protoflow_upsert_db_table: ["table"],
  protoflow_upsert_db_column: ["tableId", "column"],
  protoflow_upsert_sticky_contract: ["sticky"],
  protoflow_run_closed_loop_audit: ["issues"],
};
const tools = Object.keys(properties).map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: {
    type: "object",
    properties: properties[name],
    required: required[name],
    additionalProperties: false,
  },
}));
const TOOL_PROFILES = {
  'note-assistant': new Set([
    'protoflow_get_project',
    'protoflow_get_project_brief',
    'protoflow_get_project_notes',
    'protoflow_get_sticky_notes',
    'protoflow_get_db_table',
    'protoflow_inspect_page',
  ]),
  page: new Set([
    'protoflow_get_project',
    'protoflow_search_history',
    'protoflow_review_db_requirements',
    'protoflow_get_contracts',
    'protoflow_get_implementation_guide',
    'protoflow_inspect_page',
    'protoflow_get_page_tsx',
    'protoflow_get_db_table',
    'protoflow_get_table_rows',
    'protoflow_get_sticky_notes',
    'protoflow_get_project_notes',
    'protoflow_capture_preview',
    'protoflow_apply_tsx_patch',
    'protoflow_edit_page_block',
    'protoflow_upsert_db_table',
    'protoflow_upsert_db_column',
    'protoflow_upsert_folder',
    'protoflow_upsert_sticky_contract',
    'protoflow_run_closed_loop_audit',
  ]),
  'page-exec': new Set([
    'protoflow_get_project_brief',
    'protoflow_search_history',
    'protoflow_get_project',
    'protoflow_get_contracts',
    'protoflow_get_implementation_guide',
    'protoflow_inspect_page',
    'protoflow_get_page_tsx',
    'protoflow_get_db_table',
    'protoflow_get_table_rows',
    'protoflow_get_sticky_notes',
    'protoflow_get_project_notes',
    'protoflow_review_db_requirements',
    'protoflow_apply_tsx_patch',
    'protoflow_edit_page_block',
    'protoflow_upsert_db_table',
    'protoflow_upsert_db_column',
    'protoflow_add_preview_scenario',
    'protoflow_upsert_sticky_contract',
  ]),
};
function resolveToolsForProfile(profile) {
  const allowed = typeof profile === 'string' ? TOOL_PROFILES[profile] : undefined;
  return allowed ? tools.filter((tool) => allowed.has(tool.name)) : tools;
}
function atomicWrite(file, data) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
// A table may be staged before its page. Tell the agent which exact references
// are still outstanding; never infer an owner from the table or menu title.
function projectMenuFeedback(context) {
  if (context.kind !== 'project') return {};
  const { snapshot, operations } = context;
  const known = menuPageIds(snapshot);
  if (operations.some(op => op.tool === 'protoflow_set_project_plan')) {
    for (const page of snapshot.projectPlan.pages) known.add(page.pageId);
  }
  const written = new Set(operations.filter(op => op.tool === 'protoflow_upsert_db_table').map(op => op.args.table.id));
  const pendingMenuBindings = snapshot.dbTables.filter(table => written.has(table.id)).flatMap(table =>
    table.sharedByMenus.filter(binding => !known.has(binding.pageId)).map(({pageId}) => ({tableId:table.id, pageId})));
  if (!pendingMenuBindings.length) return {};
  if (context.workflowPhase === 'generating') throw new Error(tr('数据表关联了不存在的菜单：' + JSON.stringify(pendingMenuBindings) + '。请读取 get_project 的 pageCatalog，用实际菜单的 pageId 修正表关联后重试。', 'Database table references non-existent menus: ' + JSON.stringify(pendingMenuBindings) + '. Read get_project.pageCatalog, fix sharedByMenus with valid menu pageIds, and retry.'));
  return {pendingMenuBindings, requiredNextStep:tr('这些关联尚无对应菜单。本轮结束前请用准确的 pageId 修正关联，或按用户需求声明相应的菜单（完整方案或页面修改）。不要把目录或弹层当作菜单，也不要删除关联来绕过检查。', 'These bindings do not match any menu yet. Before ending this turn, update them with exact pageIds or declare the corresponding menus (in the project plan or page revision). Do not treat folders or overlays as menus, and do not delete bindings to bypass checks.')};
}
function stageTable(snapshot, table, baseSnapshot) {
  validateTable(table);
  if (snapshot.axureMigrationScope) checkRpTableExtension(baseSnapshot.dbTables.find(t => t.id === table.id), table);
  const before = snapshot.dbTables;
  const after = before.some(t => t.id === table.id)
    ? before.map(t => t.id === table.id ? table : t) : [...before, table];
  const review = reviewDatabaseChanges(before, after);
  if (review.tableErrors.length) throw new Error(review.tableErrors.join(tr('；', '; ')));
  // A related table may be staged later in this turn. Give Hermes the exact
  // outstanding references now; the host checks the final graph atomically.
  snapshot.dbTables = after;
  return review;
}
/** Internal signal: the synchronous tool core needs one authoritative Hermes
 * answer that the async server path fetches through the long-lived bridge,
 * after which the core re-runs from a fresh read of context.json. */
class NativeContextNeeded extends Error {
  constructor(key, bridge, payload) {
    super('native context needed');
    this.name = 'NativeContextNeeded';
    this.key = key;
    this.bridge = bridge;
    this.payload = payload;
  }
}
class PreviewCaptureNeeded extends Error {
  constructor(key, bridge, payload) {
    super('preview capture needed');
    this.name = 'PreviewCaptureNeeded';
    this.key = key;
    this.bridge = bridge;
    this.payload = payload;
  }
}
/** A tool call bound to one Alex turn reached a context.json that now belongs to
 * another turn (cancelled, finished or replaced). It must never act on it. */
class StaleRunError extends Error {
  constructor() {
    super(tr('该工具调用所属的 Alex 轮次已结束或已切换，未执行任何操作；请在当前轮次重新调用', 'The Alex turn owning this tool call has ended or changed; no action was executed. Retry in the active turn'));
    this.name = 'StaleRunError';
  }
}
/** Stable execution identity of an active turn: run, ACP session and conversation scope.
 * Returns null when no turn is active. */
function executionIdentity(context) {
  if (!context || typeof context !== 'object' || !context.active || !context.runId) return null;
  return JSON.stringify([
    context.runId, context.sessionId ?? null, context.projectId ?? null, context.kind ?? null,
    context.threadId ?? null, context.pageId ?? null, context.mindmapId ?? null,
    context.workflowPhase ?? null, context.targetPageId ?? null,
  ]);
}
function readExecutionIdentity(contextFile) {
  try { return executionIdentity(JSON.parse(fs.readFileSync(contextFile, 'utf8'))); } catch { return null; }
}
function callTool(contextFile, name, args, options = {}) {
  return require('./context-transaction.cjs').withContextLock(contextFile, () => callToolCore(contextFile, name, args, options));
}
function callToolCore(contextFile, name, args, options = {}) {
  const requestedTool = typeof name === 'string' ? name : String(name);
  const startedAt = typeof options.startedAt === 'number' ? options.startedAt : performance.now();
  const nativeStats = options.nativeStats ?? { count: 0, ms: 0, modes: new Set(), coldStarts: 0 };
  let argBytes = 0;
  try {
    if (args && typeof args === 'object') argBytes = Buffer.byteLength(JSON.stringify(args), 'utf8');
  } catch {}
  let parsedContext = null;
  let normalizedTool = requestedTool;
  let ok = false;
  let resultBytes = 0;
  let errorMessage;
  const run = () => {
    try {
      parsedContext = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    } catch {
      parsedContext = null;
    }
    if (!Object.hasOwn(properties, name))
      throw new Error("Unknown Alex tool");
    const context = parsedContext ?? (parsedContext = JSON.parse(fs.readFileSync(contextFile, "utf8")));
    // Async/queued callers pin the turn they belong to; every (re-)run verifies it
    // before reading or writing anything, so a stale call can never act on a new turn.
    // (Bound to no active turn and still none falls through to the normal error below.)
    if (Object.hasOwn(options, 'expectedIdentity') && executionIdentity(context) !== options.expectedIdentity)
      throw new StaleRunError();
    if (!context.active || !context.runId)
      throw new Error(
        "No active Alex turn; start a new request in Alex",
      );
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("Tool arguments must be an object");
    for (const key of required[name])
      if (args[key] === undefined) throw new Error(`Missing ${key}`);
    const snapshot = context.snapshot;
    const baseSnapshot =
      context.baseSnapshot && typeof context.baseSnapshot === 'object' && !Array.isArray(context.baseSnapshot)
        ? context.baseSnapshot
        : snapshot;
    const generatingTargetId =
      context.kind === 'project' &&
      context.workflowPhase === 'generating' &&
      typeof context.targetPageId === 'string' &&
      context.targetPageId
        ? context.targetPageId
        : null;
    const footprintPath = contextFile + '.footprint.json';
    const footprintErrorPath = contextFile + '.footprint.error';
    const hasFootprintErrorMarker = () => {
      try {
        const rawErr = fs.readFileSync(footprintErrorPath, 'utf8');
        const parsedErr = JSON.parse(rawErr);
        return !parsedErr || !parsedErr.runId || parsedErr.runId === context.runId;
      } catch (err) {
        return err?.code !== 'ENOENT';
      }
    };
    const markFootprintCorrupted = (reason) => {
      try {
        atomicWrite(footprintErrorPath, {
          runId: context.runId,
          message: reason instanceof Error ? reason.message : String(reason),
        });
      } catch {}
    };
    if (context.footprintCorrupted || hasFootprintErrorMarker()) {
      throw new Error(tr('依赖足迹记录已损坏或保存失败，已阻止继续执行', 'Dependency footprint record is corrupted or failed to save; execution blocked'));
    }
    const sidecarRequired = Boolean(context.requireFootprintSidecar);
    let sidecarFootprint = null;
    let sidecarExisted = false;
    try {
      const rawSidecar = fs.readFileSync(footprintPath, 'utf8');
      const parsedSidecar = JSON.parse(rawSidecar);
      if (!parsedSidecar || typeof parsedSidecar !== 'object' || parsedSidecar.corrupted === true) {
        throw new Error(tr('依赖足迹文件已损坏', 'Dependency footprint file is corrupted'));
      }
      if (parsedSidecar.runId !== context.runId) {
        if (sidecarRequired) {
          throw new Error(tr('依赖足迹运行标识不匹配', 'Dependency footprint run ID mismatch'));
        }
        sidecarFootprint = null;
        sidecarExisted = false;
      } else {
        if (parsedSidecar.dependencyFootprint?.version !== 3) {
          throw new Error(tr('依赖足迹版本无效', 'Invalid dependency footprint version'));
        }
        sidecarFootprint = parsedSidecar.dependencyFootprint;
        sidecarExisted = true;
      }
    } catch (sidecarReadErr) {
      if (sidecarReadErr?.code === 'ENOENT' && !sidecarRequired) {
        sidecarFootprint = null;
      } else {
        markFootprintCorrupted(sidecarReadErr);
        throw new Error(tr('依赖足迹记录读取失败，已阻止继续执行', 'Failed to read dependency footprint record; execution blocked'));
      }
    }
    const sourceFootprint = sidecarExisted
      ? sidecarFootprint
      : (context.dependencyFootprint?.version === 3 ? context.dependencyFootprint : null);
    const initialFootprintJson = sourceFootprint ? JSON.stringify(sourceFootprint) : '';
    const footprint = sourceFootprint
      ? structuredClone(sourceFootprint)
      : createEmptyDependencyFootprint(context.workflowPhase ?? null, context.targetPageId ?? null);
    let footprintPersisted = false;
    const persistFootprintSidecar = () => {
      if (footprintPersisted) return;
      const nextJson = JSON.stringify(footprint);
      if (nextJson === initialFootprintJson) return;
      try {
        atomicWrite(footprintPath, { runId: context.runId, dependencyFootprint: footprint });
        sidecarExisted = true;
        footprintPersisted = true;
      } catch (writeErr) {
        markFootprintCorrupted(writeErr);
        throw new Error(tr('依赖足迹记录保存失败，已阻止返回工具结果或提交修改', 'Failed to save dependency footprint record; blocked tool response and commit'));
      }
    };
    const saveContext = () => {
      persistFootprintSidecar();
      atomicWrite(contextFile, context);
    };
    const persistFootprintOnlyIfChanged = () => {
      persistFootprintSidecar();
    };
  const epochFile = path.join(path.dirname(contextFile), 'context-epoch.json');
  const currentEpoch = () => {
    if (!fs.existsSync(epochFile)) return 0;
    const marker = JSON.parse(fs.readFileSync(epochFile, 'utf8'));
    if (marker.sessionId !== context.sessionId || !Number.isSafeInteger(marker.epoch)) throw new Error(tr('上下文会话标识不一致', 'Context session ID mismatch'));
    return marker.epoch;
  };
  const nativeContext = (action, data = {}) => {
    const bridge = context.nativeBridge;
    if (!bridge || !context.sessionId) throw new Error(tr('当前 Hermes 尚未接入上下文接口，请更新桌面端并重新连接', 'Current Hermes session is not connected to the context interface; please update the desktop app and reconnect'));
    const payload = { action, sessionId: context.sessionId, ...data };
    let response;
    if (typeof options.resolveNative === 'function') {
      // Async server path: answered by the long-lived bridge for THIS call only.
      response = options.resolveNative(bridge, payload);
    } else {
      const nativeStartedAt = performance.now();
      try {
        response = oneShotContextSync(bridge, payload);
      } catch (error) {
        if (error instanceof BridgeTransportError) throw new Error(tr('Hermes 上下文接口不可用', 'Hermes context interface is unavailable'));
        throw error;
      } finally {
        nativeStats.count += 1;
        nativeStats.ms += performance.now() - nativeStartedAt;
        nativeStats.modes.add('oneshot');
        nativeStats.coldStarts += 1;
      }
    }
    if (response.error) throw new Error(response.error);
    if (response.sessionId !== context.sessionId) throw new Error(tr('上下文接口返回了其他会话', 'Context interface returned a different session'));
    return response;
  };
  const nativeCompressionCount = () => {
    const count = nativeContext('usage').usage?.compressions;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(tr('Hermes 未提供有效的压缩计数，无法核对项目资料', 'Hermes did not return a valid compression count; unable to verify project context'));
    return count;
  };
  const requireFreshBrief = () => {
    if (!context.requireProjectBrief) return; // Explicit compatibility with pre-context-management hosts.
    if (context.briefReadEpoch !== currentEpoch() || (context.nativeBridge && context.briefReadCompressions !== nativeCompressionCount()))
      throw new Error(tr('请先调用 protoflow_get_project_brief 重新核对已保存的约定、字段约束和进度；上下文可能刚完成压缩。', 'Call protoflow_get_project_brief first to re-verify saved agreements, field constraints, and progress; context may have just been compacted.'));
  };
  let toolResult;
  try {
  toolResult = (() => {
  if (name === 'protoflow_get_project_brief') {
    const focus = args.pageId !== undefined || args.folderId !== undefined ? args
      : context.targetPageId === undefined ? (context.contextFocus ?? {}) : { pageId: context.targetPageId };
    let brief;
    try {
      brief = projectExecutionBrief(
        { ...snapshot, projectAgreements: context.confirmedProjectAgreements ?? snapshot.projectAgreements },
        focus,
        generatingTargetId ? { generatingTargetPageId: generatingTargetId } : undefined,
      );
    } catch (briefErr) {
      recordBriefFootprint(
        footprint,
        { ...baseSnapshot, projectAgreements: context.confirmedProjectAgreements ?? baseSnapshot.projectAgreements },
        focus,
        generatingTargetId,
        null,
      );
      throw briefErr;
    }
    recordBriefFootprint(
      footprint,
      { ...baseSnapshot, projectAgreements: context.confirmedProjectAgreements ?? baseSnapshot.projectAgreements },
      focus,
      generatingTargetId,
      brief,
    );
    const expectedFocus = context.targetPageId === undefined ? (context.contextFocus ?? {}) : {pageId:context.targetPageId};
    if (focus.pageId === expectedFocus.pageId && focus.folderId === expectedFocus.folderId) {
      if (context.nativeBridge) context.briefReadCompressions = nativeCompressionCount();
      context.briefReadEpoch = currentEpoch();
    }
    saveContext();
    const stagedPageReadiness =
      context.kind === 'project' &&
      context.workflowPhase === 'generating' &&
      typeof context.targetPageId === 'string' &&
      context.operations.length > 0
        ? evaluatePageDraftReadiness(snapshot, context.targetPageId, context.initialValidationBase ?? snapshot)
        : undefined;
    return { projectId: context.projectId, sessionId: context.sessionId, ...brief,
      projectNotes: Array.isArray(snapshot.projectNotes) ? snapshot.projectNotes.filter(note => !focus.pageId && !focus.folderId || (Array.isArray(note?.relatedPageIds) && note.relatedPageIds.some(id => brief.pageCatalog.some(page => page.pageId === id)))) : [],
      stagedChanges: context.operations.map(op => ({
        tool: op.tool,
        ...(op.args?.pageId ? { pageId: op.args.pageId } : {}),
        ...(op.args?.table?.id ? { tableId: op.args.table.id } : {}),
        ...(op.args?.tableId ? { tableId: op.args.tableId } : {}),
        ...(Array.isArray(op.args?.datasets) ? { tableIds: op.args.datasets.map(d => d?.tableId).filter(Boolean) } : {}),
        ...(op.args?.sticky?.id ? { stickyId: op.args.sticky.id, pageId: op.args.sticky.pageId } : {}),
      })),
      ...(stagedPageReadiness ? { stagedPageReadiness } : {}),
      agreementsAwaitingConfirmation: context.operations.filter(op => op.tool === 'protoflow_upsert_project_agreement').map(op => op.args.agreement.id) };
  }
  if (name === 'protoflow_search_history') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200 ||
        (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0))) throw new Error(tr('历史检索参数无效', 'Invalid history search parameters'));
    return nativeContext('history', {
      query: args.query,
      offset: args.offset,
      ...(Array.isArray(context.allowedHistorySessions) ? { allowedHistorySessions: context.allowedHistorySessions } : {}),
    });
  }
  if (name === 'protoflow_review_db_requirements') {
    const sources = snapshot.requirementSources ?? [];
    const tables = snapshot.dbTables ?? [];
    let submissions = context.requirementFindings ?? [];
    const submittingFindings = args.sourceId !== undefined || args.findings !== undefined;
    if (submittingFindings) {
      requireFreshBrief();
      if (context.readOnly) throw new Error('This request is read-only');
      if (typeof args.sourceId !== 'string' || !Array.isArray(args.findings)) throw new Error(tr('须同时提供 sourceId 和完整 findings', 'Both sourceId and complete findings are required'));
      submissions = [...submissions.filter(s => s.sourceId !== args.sourceId), {sourceId:args.sourceId, findings:args.findings}];
    }
    recordReviewDbRequirementsFootprint(footprint, baseSnapshot, args.sourceId, submittingFindings);
    const records = collectRequirementRecords(sources, submissions, snapshot.databaseRequirements);
    const report = reviewRequirementRecords(records, tables);
    if (submissions !== context.requirementFindings && args.sourceId !== undefined) {
      context.requirementFindings = submissions;
      saveContext();
    }
    const priorSources = (snapshot.databaseRequirements ?? []).filter(r => !records.some(current=>current.id===r.id));
    return { sources:records, priorSources, evidence:tables.map(t=>({tableId:t.id, tableName:t.tableName,
      columns:t.columns.map(c=>({id:c.id,name:c.name})), basis:Object.fromEntries(requirementEvidence(t))})), ...report };
  }
  if (name === 'protoflow_get_implementation_guide') return getImplementationGuide(args.scenarioIds);
  if (name === 'protoflow_inspect_axure_project') {
    if (context.kind !== 'project' || context.workflowPhase !== 'conversation') throw new Error(tr('请在项目 AI 对话中读取 RP 迁移范围', 'Inspect RP migration scope in project AI conversation mode'));
    if (args.pageId !== undefined && args.folderId !== undefined) throw new Error(tr('请选择一个页面、一个目录或全工程', 'Select either one page, one folder, or the entire project'));
    const scope = args.pageId !== undefined ? {kind:'page',pageId:args.pageId}
      : args.folderId !== undefined ? {kind:'folder',folderId:args.folderId} : snapshot.axureMigrationScope ?? {kind:'project'};
    if (snapshot.axureMigrationScope && (args.pageId !== undefined || args.folderId !== undefined)) {
      const catalog = axureCatalog(snapshot);
      const selected = new Set(axureScopePages(catalog,snapshot.axureMigrationScope).map(page=>page.pageId));
      if (axureScopePages(catalog,scope).some(page=>!selected.has(page.pageId))) throw new Error(tr('盘点范围超出本次选择', 'Inspection scope exceeds the current selection'));
    }
    const result = inspectAxureProject(snapshot,scope,args.offset,args.limit);
    recordGetProjectFootprint(footprint,baseSnapshot);
    for (const page of result.records) {
      recordGetPageTsxFootprint(footprint,baseSnapshot,page.pageId);
      if (page.optimizedPageId) recordGetPageTsxFootprint(footprint,baseSnapshot,page.optimizedPageId);
    }
    return result;
  }
  if (name === 'protoflow_inspect_figma_project') {
    if (context.kind !== 'project' || context.workflowPhase !== 'conversation') throw new Error(tr('请在项目 AI 对话中盘点 Figma 画板范围', 'Inspect Figma scope in project AI conversation mode'));
    if (args.pageId !== undefined && args.folderId !== undefined) throw new Error(tr('请选择一个页面、一个目录或全工程', 'Select either one page, one folder, or the entire project'));
    const scope = args.pageId !== undefined ? { kind: 'page', pageId: args.pageId }
      : args.folderId !== undefined ? { kind: 'folder', folderId: args.folderId } : snapshot.figmaMigrationScope ?? { kind: 'project' };
    if (snapshot.figmaMigrationScope && (args.pageId !== undefined || args.folderId !== undefined)) {
      const catalog = figmaCatalog(snapshot);
      const selected = new Set(figmaScopePages(catalog, snapshot.figmaMigrationScope).map(page => page.pageId));
      if (figmaScopePages(catalog, scope).some(page => !selected.has(page.pageId))) throw new Error(tr('盘点范围超出本次选择', 'Inspection scope exceeds the current selection'));
    }
    const result = inspectFigmaProject(snapshot, scope, args.offset, args.limit);
    recordGetProjectFootprint(footprint, baseSnapshot);
    for (const page of result.records) {
      recordGetPageTsxFootprint(footprint, baseSnapshot, page.pageId);
      if (page.optimizedPageId) recordGetPageTsxFootprint(footprint, baseSnapshot, page.optimizedPageId);
    }
    return result;
  }
  const checkFigmaPageReadScope = (targetPageId, requireFigmaSource = false) => {
    if (!snapshot.figmaMigrationScope || typeof targetPageId !== 'string') return;
    const scopePages = figmaScopePages(figmaCatalog(snapshot), snapshot.figmaMigrationScope);
    const allowedSourceIds = new Set(scopePages.map(p => p.pageId));
    const allowedCopyIds = new Set(scopePages.map(p => 'fig-optimized-' + p.pageId.slice('fig-page-'.length)));
    if (requireFigmaSource) {
      if (!allowedSourceIds.has(targetPageId)) {
        throw new Error(tr('盘点范围超出本次选择', 'Inspection scope exceeds the current selection'));
      }
      return;
    }
    if (/^fig-(?:page|optimized)-/.test(targetPageId) && !allowedSourceIds.has(targetPageId) && !allowedCopyIds.has(targetPageId)) {
      throw new Error(tr('盘点范围超出本次选择', 'Inspection scope exceeds the current selection'));
    }
  };
  if (name === 'protoflow_inspect_page') {
    if (typeof args.pageId !== 'string' || !Object.hasOwn(snapshot.pageSources, args.pageId)) throw new Error('Unknown pageId');
    checkFigmaPageReadScope(args.pageId, args.view === 'figma');
    recordInspectPageFootprint(footprint, baseSnapshot, snapshot, args.pageId, context.kind === 'project');
    if (args.view === 'axure') return inspectAxurePage(args.pageId, snapshot.pageSources[args.pageId], args.selectedPfId, args.offset, args.limit);
    if (args.view === 'figma') return inspectFigmaPage(args.pageId, snapshot.pageSources[args.pageId], args.selectedPfId, args.offset, args.limit);
    if (args.view !== undefined || args.offset !== undefined || args.limit !== undefined) throw new Error(tr('分页参数需要 view=axure 或 view=figma', 'Pagination parameters require view=axure or view=figma'));
    if (!snapshot.tableRows || typeof snapshot.tableRows !== 'object' || Array.isArray(snapshot.tableRows)) throw new Error('This snapshot does not provide saved table data; reopen the project and retry');
    const readiness = context.kind === 'project'
      ? evaluatePageDraftReadiness(snapshot, args.pageId, context.initialValidationBase ?? snapshot)
      : null;
    return {
      pageId: args.pageId,
      ...inspectPage(snapshot.pageSources[args.pageId], snapshot.dbTables, snapshot.tableRows, args.selectedPfId),
      ...(readiness?.planned
        ? {
            acceptanceReady: readiness.acceptanceReady,
            pendingAcceptanceIssues: readiness.pendingAcceptanceIssues,
          }
        : {}),
    };
  }
  if (name === 'protoflow_capture_preview') {
    const captureOpts = parseCaptureOptions(args);
    const bridge = context.previewBridge;
    if (!bridge || !Number.isInteger(bridge.port) || bridge.port < 1 || typeof bridge.token !== 'string' || !bridge.token) {
      throw new Error(tr(
        '当前会话环境未开启离屏渲染截图预览（请使用 protoflow_inspect_page 核对页面结构与契约）',
        'Offscreen rendered preview capture is not enabled in this session environment; use protoflow_inspect_page to verify page structure and contracts',
      ));
    }
    const previewContext = context.previewContext;
    if (!previewContext?.state || previewContext.meta?.projectId !== context.projectId) {
      throw new Error('Missing project render data for this turn. Start a new turn to capture a preview.');
    }
    const pageId = captureOpts.pageId ?? context.targetPageId ?? context.pageId ?? previewContext.activePageId;
    if (!pageId || !Object.hasOwn(snapshot.pageSources, pageId)) throw new Error('Unknown pageId');
    checkFigmaPageReadScope(pageId, false);
    recordInspectPageFootprint(footprint, baseSnapshot, snapshot, pageId, context.kind === 'project');
    const previewSnapshot = buildStagedPreviewSnapshot(
      {
        ...previewContext.state,
        activePageId: previewContext.activePageId,
        pageSources: snapshot.pageSources,
        dbTables: snapshot.dbTables,
        tableRows: snapshot.tableRows,
        designTokens: snapshot.designTokens,
      },
      { ...captureOpts, pageId },
      {
        revision: `staged:${context.runId}:${context.operations.length}`,
        meta: previewContext.meta,
        locale: /^en/i.test(String(process.env.PROTOFLOW_LOCALE || '')) ? 'en-US' : 'zh-CN',
      },
    );
    if (typeof options.resolvePreview !== 'function') {
      throw new Error(tr('截图预览须通过异步 MCP 服务通道调用', 'Preview capture must be invoked via the async MCP server channel'));
    }
    const image = options.resolvePreview(bridge, { runId: context.runId, snapshot: previewSnapshot });
    return {
      __alexMcpImageContent: image.data,
      metadata: {
        pageId: previewSnapshot.pageId,
        platform: previewSnapshot.platform,
        scope: previewSnapshot.scope,
        fullPage: previewSnapshot.fullPage,
        ...(previewSnapshot.uiState ? { uiState: previewSnapshot.uiState } : {}),
        width: image.width,
        height: image.height,
        truncated: image.truncated,
        staged: Array.isArray(context.operations) && context.operations.length > 0,
        stagedOperationCount: Array.isArray(context.operations) ? context.operations.length : 0,
      },
    };
  }
  if (name === "protoflow_get_project") {
    recordGetProjectFootprint(footprint, baseSnapshot, generatingTargetId);
    // Older callers may omit the structural catalogue; do not invent it. Current
    // project snapshots carry all four authoritative sitemap fields.
    if (Array.isArray(snapshot.designerFolders) && Array.isArray(snapshot.designerPages) && Array.isArray(snapshot.sitemapBase) && snapshot.sitemapOverrides) {
      snapshot.sitemap = buildSitemap(snapshot.designerFolders, snapshot.designerPages, snapshot.sitemapOverrides, snapshot.sitemapBase);
      snapshot.folders = folderOptions(snapshot.designerFolders, snapshot.sitemapOverrides, snapshot.sitemapBase).filter(folder => !folder.deprecated);
      const pages = [];
      const visit = (items, parents = [], archived = false) => items.forEach(item => {
        const deprecated = archived || item.deprecated === true;
        if (item.type === 'folder') visit(item.children, [...parents, item.title], deprecated);
        else if (item.pageId !== undefined) pages.push({ pageId: item.pageId, title: item.title, path: [...parents, item.title].join(' / '), deprecated, hasSource: Object.hasOwn(snapshot.pageSources, item.pageId) });
      });
      visit(snapshot.sitemap); snapshot.pageCatalog = pages;
      if (snapshot.contracts) snapshot.contracts.folderIds = snapshot.folders.map(folder => folder.id);
    }
    const { pageSources, databaseRequirements: _records, requirementSources: _sources, tableRows: _savedRows, contracts: _cachedContracts, projectNoteDocuments: _noteDocuments, ...rawCatalogue } = snapshot;
    const catalogue = generatingTargetId
      ? {
          ...rawCatalogue,
          stickyNotes: filterGeneratingStickyNotes(snapshot.stickyNotes, snapshot.projectPlan, generatingTargetId),
          closedLoopIssues: filterGeneratingClosedLoopIssues(snapshot.closedLoopIssues, snapshot.projectPlan, generatingTargetId),
          projectNotes: filterGeneratingProjectNotes(snapshot.projectNotes, snapshot.projectPlan, generatingTargetId),
          projectPlan: buildNarrowedProjectPlan(snapshot, generatingTargetId),
        }
      : rawCatalogue;
    const contracts = currentContracts(snapshot);
    // Some historical read-only callers have no schema catalogue at all.
    // Only a real catalogue, including an explicitly empty one, permits modeling.
    const design = Array.isArray(snapshot.dbTables) ? reviewDatabaseDesign(snapshot.dbTables) : undefined;
    if (design && !context.readOnly && context.schemaCatalogReadRunId !== context.runId) {
      context.schemaCatalogReadRunId = context.runId;
      saveContext();
    }
    return {
      ...catalogue,
      ...(design && { databaseDesignReview: design }),
      projectId: context.projectId,
      pageIds: Object.keys(pageSources),
      contracts: {
        ...(contracts ? {
            ...contracts,
            components: contracts.components.map((c) => ({
              name: c.name,
              title: c.title,
              description: c.description,
            })),
          } : {}),
        dbTable: tableSchema,
        dbColumn: columnSchema,
      },
    };
  }
  if (name === "protoflow_get_contracts") {
    const contracts = currentContracts(snapshot);
    if (
      args.componentNames !== undefined &&
      (!Array.isArray(args.componentNames) ||
        args.componentNames.some(
          (name) => !contracts.components.some((c) => c.name === name),
        ))
    )
      throw new Error("Unknown component name");
    return {
      ...contracts,
      dbTable: tableSchema,
      dbColumn: columnSchema,
      components: args.componentNames
        ? contracts.components.filter((c) =>
            args.componentNames.includes(c.name),
          )
        : contracts.components.map((c) => ({ name: c.name, title: c.title })),
    };
  }
  if (name === "protoflow_get_page_tsx") {
    if (!Object.hasOwn(snapshot.pageSources, args.pageId))
      throw new Error("Unknown pageId");
    checkFigmaPageReadScope(args.pageId, false);
    recordGetPageTsxFootprint(footprint, baseSnapshot, args.pageId);
    return { pageId: args.pageId, source: snapshot.pageSources[args.pageId] };
  }
  if (name === 'protoflow_get_sticky_notes') {
    recordGetStickyNotesFootprint(footprint, baseSnapshot, args.pageId);
    if (args.pageId !== undefined && (typeof args.pageId !== 'string' || !(Object.hasOwn(snapshot.pageSources, args.pageId) || snapshot.pageCatalog?.some(page => page.pageId === args.pageId)))) throw new Error('Unknown pageId');
    return { stickyNotes: snapshot.stickyNotes.filter(note => args.pageId === undefined || note.pageId === args.pageId) };
  }
  if (name === 'protoflow_get_project_notes') {
    recordGetProjectNotesFootprint(footprint, baseSnapshot, args);
    const catalog = Array.isArray(snapshot.projectNotes) ? snapshot.projectNotes : [];
    const documents = snapshot.projectNoteDocuments && typeof snapshot.projectNoteDocuments === 'object' ? snapshot.projectNoteDocuments : {};
    if (args.noteIds !== undefined && (!Array.isArray(args.noteIds) || args.noteIds.length > 20 || args.noteIds.some(id => typeof id !== 'string' || !catalog.some(note => note.noteId === id))))
      throw new Error('Unknown noteId; use the exact noteId from get_project.projectNotes (at most 20)');
    if (args.pageId !== undefined && (typeof args.pageId !== 'string' || !(Object.hasOwn(snapshot.pageSources ?? {}, args.pageId) || snapshot.pageCatalog?.some(page => page.pageId === args.pageId))))
      throw new Error('Unknown pageId');
    const offset = args.offset === undefined ? 0 : args.offset;
    const limit = args.limit === undefined ? 10 : args.limit;
    const charOffset = args.charOffset === undefined ? 0 : args.charOffset;
    const maxChars = args.maxChars === undefined ? 20000 : args.maxChars;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new Error('Invalid offset/limit; offset >= 0 and 1 <= limit <= 20');
    if (!Number.isInteger(charOffset) || charOffset < 0 || !Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 50000)
      throw new Error('Invalid charOffset/maxChars; charOffset >= 0 and 1000 <= maxChars <= 50000');
    let selected = catalog;
    if (args.noteIds !== undefined) selected = selected.filter(note => args.noteIds.includes(note.noteId));
    if (args.pageId !== undefined) selected = selected.filter(note => Array.isArray(note.relatedPageIds) && note.relatedPageIds.includes(args.pageId));
    if (args.noteIds === undefined) selected = [...selected].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const total = selected.length;
    const paged = args.noteIds === undefined ? selected.slice(offset, offset + limit) : selected;
    const nextOffset = args.noteIds === undefined && offset + paged.length < total ? offset + paged.length : null;
    return {
      total,
      offset: args.noteIds === undefined ? offset : 0,
      nextOffset,
      notes: paged.map(note => {
        const content = typeof documents[note.noteId] === 'string' ? documents[note.noteId] : '';
        const slice = content.slice(charOffset, charOffset + maxChars);
        const truncated = charOffset + slice.length < content.length;
        const { summary: _summary, ...meta } = note;
        return {
          ...meta,
          content: slice,
          totalChars: content.length,
          charOffset,
          truncated,
          nextCharOffset: truncated ? charOffset + slice.length : null,
        };
      }),
    };
  }
  if (name === 'protoflow_get_db_table' || name === 'protoflow_get_table_rows') {
    if (typeof args.tableId !== 'string' || !args.tableId.trim()) throw new Error('tableId must be a non-empty string');
    const table = snapshot.dbTables.find(table => table.id === args.tableId);
    if (!table) {
      recordGetDbTableFootprint(footprint, baseSnapshot, args.tableId, false);
      throw new Error('Unknown tableId; use the exact dbTables.id');
    }
    if (name === 'protoflow_get_db_table') {
      recordGetDbTableFootprint(footprint, baseSnapshot, args.tableId, false);
      return { table };
    }
    const offset = args.offset === undefined ? 0 : args.offset, limit = args.limit === undefined ? 20 : args.limit;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      recordGetDbTableFootprint(footprint, baseSnapshot, args.tableId, false);
      throw new Error('Invalid offset/limit');
    }
    if (!snapshot.tableRows || typeof snapshot.tableRows !== 'object' || Array.isArray(snapshot.tableRows)) {
      recordGetDbTableFootprint(footprint, baseSnapshot, args.tableId, false);
      throw new Error('This snapshot does not provide saved table data; reopen the project and retry');
    }
    recordGetDbTableFootprint(footprint, baseSnapshot, args.tableId, true);
    const hasSavedRows = Object.hasOwn(snapshot.tableRows, args.tableId);
    const rows = hasSavedRows ? snapshot.tableRows[args.tableId] : [];
    if (!Array.isArray(rows)) throw new Error('Saved table data must be an array');
    return { tableId: table.id, source: 'saved-project-preview-data', hasSavedRows, total: rows.length, offset, rows: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null };
  }
  if (context.readOnly) throw new Error("This request is read-only");
  let allowedCopyIds;
  if (snapshot.axureMigrationScope) {
    const scopePages = axureScopePages(axureCatalog(snapshot),snapshot.axureMigrationScope);
    const allowedSourceIds = new Set(scopePages.map(p=>p.pageId));
    allowedCopyIds = new Set(scopePages.map(p=>'rp-optimized-' + p.pageId.slice('rp-page-'.length)));
    const rpWrite = name === 'protoflow_bind_axure_table' || name === 'protoflow_optimize_axure_block' || name === 'protoflow_reshape_axure_page';
    const rpEditCopy = name === 'protoflow_edit_page_block' && typeof args.pageId === 'string' && allowedCopyIds.has(args.pageId) && Object.hasOwn(snapshot.pageSources,args.pageId);
    if (!rpWrite && !rpEditCopy && !['protoflow_upsert_db_table','protoflow_upsert_db_column','protoflow_ask_questions'].includes(name))
      throw new Error(tr('RP 迁移任务只允许暂存优化版物料和表结构', 'RP migration tasks may only stage optimized materials and table schemas'));
    if (rpWrite && !allowedSourceIds.has(args.pageId))
      throw new Error(tr('来源页面超出本次 RP 迁移范围', 'Source page is outside the current RP migration scope'));
  }
  if (snapshot.figmaMigrationScope) {
    const scopePages = figmaScopePages(figmaCatalog(snapshot), snapshot.figmaMigrationScope);
    const allowedSourceIds = new Set(scopePages.map(p => p.pageId));
    allowedCopyIds = new Set(scopePages.map(p => 'fig-optimized-' + p.pageId.slice('fig-page-'.length)));
    const figmaWrite = name === 'protoflow_reshape_figma_page';
    const figmaEditCopy = name === 'protoflow_edit_page_block' && typeof args.pageId === 'string' && allowedCopyIds.has(args.pageId) && Object.hasOwn(snapshot.pageSources, args.pageId);
    if (!figmaWrite && !figmaEditCopy && !['protoflow_upsert_db_table', 'protoflow_upsert_db_column', 'protoflow_ask_questions'].includes(name))
      throw new Error(tr('Figma 重构任务只允许暂存重构页面和表结构', 'Figma reshape tasks may only stage reshaped pages and table schemas'));
    if (figmaWrite && !allowedSourceIds.has(args.pageId))
      throw new Error(tr('来源页面超出本次 Figma 重构范围', 'Source page is outside the current Figma reshape scope'));
  }
  if (name === 'protoflow_ask_questions') {
    if (context.kind !== 'project' || !['conversation','planning'].includes(context.workflowPhase) || context.operations.length) throw new Error(tr('请在暂存修改前提问，等待用户回答后再构建修改', 'Ask questions before staging modifications, then wait for user answers before making changes'));
    validateProjectQuestions(args.questions);
    context.operations.push({tool:name,args}); saveContext();
    return { awaitingUser: true, message: 'Questions queued for display. End this turn now. Wait for answers in the next turn.' };
  }
  requireFreshBrief();
  if (context.operations.some(op => op.tool === 'protoflow_ask_questions')) throw new Error(tr('请先结束本轮并等待用户回答', 'End this turn first and wait for user answers'));
  if (name === 'protoflow_remove_project_agreement') {
    recordOtherMutationFootprint(footprint, baseSnapshot, name, args);
    if (context.kind !== 'project' || context.workflowPhase !== 'conversation' || typeof args.id !== 'string' || !snapshot.projectAgreements?.some(a => a.id === args.id)) throw new Error(tr('项目约定不存在或本轮不可移除', 'Project agreement does not exist or cannot be removed in this turn'));
    snapshot.projectAgreements = snapshot.projectAgreements.filter(a => a.id !== args.id);
    context.operations.push({tool:name,args}); saveContext();
    return {staged:true};
  }
  if (name === 'protoflow_upsert_project_agreement') {
    recordOtherMutationFootprint(footprint, baseSnapshot, name, args);
    if (context.kind !== 'project' || context.workflowPhase !== 'conversation') throw new Error(tr('项目约定只能在项目对话中提交确认', 'Project agreements can only be proposed in project conversation mode'));
    applyProjectAgreement(snapshot, args.agreement);
    context.operations.push({tool: name, args}); saveContext();
    return { staged: true, message: 'Awaiting user confirmation; not saved as a confirmed agreement.' };
  }
  if (context.operations.some(op => op.tool === 'protoflow_ask_questions')) throw new Error(tr('请先结束本轮并等待用户回答', 'End this turn first and wait for user answers'));
  if (['protoflow_set_project_plan','protoflow_revise_project_page'].includes(name) && (context.kind !== 'project' || !['conversation','planning'].includes(context.workflowPhase))) throw new Error(tr('方案只能在项目对话中更新', 'Project plans can only be updated in project conversation mode'));
  if (name === 'protoflow_set_project_plan' && context.requirePageEvidence &&
      (!Array.isArray(args.plan?.pages) || args.plan.pages.some(p => !Array.isArray(p?.dependencies) || !Array.isArray(p?.acceptanceCases) || !p.acceptanceCases.length)))
    throw new Error(tr('每页必须声明 dependencies（独立页面填 []）并提供可复核的 acceptanceCases', 'Every page must declare dependencies (use [] for independent pages) and provide verifiable acceptanceCases'));
  if (name === 'protoflow_set_project_plan' && context.requirePageEvidence) {
    recordOtherMutationFootprint(footprint, baseSnapshot, name, args);
    const citations = args.plan.pages.flatMap(page => page.acceptanceCases.map(c => c?.source).filter(Boolean));
    for (const ref of citations) {
      const map = snapshot.mindmaps?.nodes.find(node => node.id === ref.mindmapId && node.kind === 'mindmap');
      if (!map || typeof ref.quote !== 'string' || !ref.quote.trim() || !map.source.includes(ref.quote)) {
        throw new Error(tr(`方案中的验收场景无法定位到脑图原文：${String(ref.mindmapId)}，请核对文档 ID 和逐字引文`, `Acceptance case in plan could not locate verbatim quote in mindmap ${String(ref.mindmapId)}; verify the mindmap ID and exact quote`));
      }
    }
    if (snapshot.selectedMindmapIds?.length && !citations.some(ref => snapshot.selectedMindmapIds.includes(ref.mindmapId)))
      throw new Error(tr('本轮选用了脑图，请在方案验收场景中引用所选脑图的 ID 和原文', 'Mindmaps are selected for this turn; cite the selected mindmap IDs and verbatim quotes in acceptanceCases'));
  }
  if (name === 'protoflow_move_sitemap_item' && (context.kind !== 'project' || context.workflowPhase !== 'conversation')) throw new Error(tr('请在项目对话中调整菜单位置', 'Move menu items in project conversation mode'));
  if (!context.initialStickyOwners || typeof context.initialStickyOwners !== 'object') {
    context.initialStickyOwners = Object.fromEntries((snapshot.stickyNotes ?? []).map(s => [s.id, s.pageId]));
  }
  if (context.kind === 'project') {
    if (context.workflowPhase === 'planning' && !['protoflow_set_project_plan','protoflow_revise_project_page'].includes(name)) throw new Error(tr('方案尚未确认；本轮只能讨论需求并保存方案', 'Project plan is not confirmed yet; this turn may only discuss requirements and save the plan'));
    if (context.workflowPhase === 'generating') {
      if (!snapshot.projectPlan?.approved || snapshot.projectPlan.discussionPending) throw new Error(tr('方案尚未确认或正在讨论调整', 'Project plan is not confirmed or is under revision'));
      if (['protoflow_apply_tsx_patch','protoflow_edit_page_block'].includes(name) && args.pageId !== context.targetPageId) throw new Error(tr('本轮只生成指定页面，其他页面由后续任务处理', 'This turn only generates the target page; other pages are handled in subsequent tasks'));
      if (name === 'protoflow_upsert_sticky_contract') {
        const prevPageId = Object.hasOwn(context.initialStickyOwners, args.sticky?.id)
          ? context.initialStickyOwners[args.sticky.id]
          : (snapshot.stickyNotes ?? []).find(s => s.id === args.sticky?.id)?.pageId;
        if (args.sticky?.pageId !== context.targetPageId || (prevPageId !== undefined && prevPageId !== context.targetPageId))
          throw new Error(tr('本轮只能添加或更新目标页面的需求便签，不能覆盖其他页面的已有便签', 'This turn may only add or update sticky notes on the target page and cannot overwrite sticky notes on other pages'));
      }
      if (name === 'protoflow_upsert_folder' || name === 'protoflow_run_closed_loop_audit') throw new Error(tr('本轮不能改变目录或执行全项目巡检', 'Cannot modify folders or run project-wide audits during single-page generation'));
    }
  }
  if (['protoflow_set_project_plan','protoflow_revise_project_page','protoflow_upsert_folder','protoflow_move_sitemap_item'].includes(name)) {
    recordOtherMutationFootprint(footprint, baseSnapshot, name, args);
    // Intermediate drafts are not evidence that any page was generated.
    if (!Object.hasOwn(context, 'initialProjectPlan')) context.initialProjectPlan = structuredClone(snapshot.projectPlan ?? null);
    const operations = [...context.operations, { tool: name, args }];
    context.operations = finalProjectDraftOperations(operations);
    applyStructureOperation(snapshot, name, args, context.initialProjectPlan, snapshot.projectMode, snapshot.requestedPage);
    const feedback = name === 'protoflow_set_project_plan' ? projectMenuFeedback(context) : {};
    saveContext();
    if (name === 'protoflow_set_project_plan') return {
      staged: true, folderCount: snapshot.projectPlan.folders.length, pageCount: snapshot.projectPlan.pages.length,
      message: 'This complete draft is now the plan for user confirmation. No pages generated yet.',
      ...feedback,
    };
    return { staged: true, message: 'Awaiting host validation; not yet committed.' };
  }
  if (!Array.isArray(context.initialPageIds)) context.initialPageIds = Object.keys(snapshot.pageSources ?? {});
  if (!Array.isArray(context.initialTableRowIds)) context.initialTableRowIds = Object.keys(snapshot.tableRows ?? {});
  if (context.kind === 'project' && (!context.initialValidationBase || typeof context.initialValidationBase !== 'object')) {
    context.initialValidationBase = {
      projectPlan: structuredClone(snapshot.projectPlan ?? null),
      pageSources: { ...(snapshot.pageSources ?? {}) },
      dbTables: structuredClone(snapshot.dbTables ?? []),
      mindmaps: snapshot.mindmaps ?? { nodes: [], links: [] },
      stickyNotes: structuredClone(snapshot.stickyNotes ?? []),
      closedLoopIssues: structuredClone(snapshot.closedLoopIssues ?? []),
      designerPages: structuredClone(snapshot.designerPages ?? []),
      sitemapBase: snapshot.sitemapBase ?? [],
    };
  }
  if (!Array.isArray(context.explicitChangedPages)) context.explicitChangedPages = [];
  if (!Array.isArray(context.explicitStickyPages)) context.explicitStickyPages = [];
  if (['protoflow_edit_page_block', 'protoflow_apply_tsx_patch'].includes(name)) {
    const targetId = args?.pageId;
    if (snapshot.requestedPage) {
      if (targetId !== snapshot.requestedPage.pageId)
        throw new Error(tr(`新建页面请求只允许写入目标新页面 ${snapshot.requestedPage.pageId}，禁止修改或覆盖其他页面 ${String(targetId ?? '')}`, `New-page request may only write to target page ${snapshot.requestedPage.pageId}; modifying or overwriting page ${String(targetId ?? '')} is forbidden`));
      if (context.initialPageIds.includes(snapshot.requestedPage.pageId))
        throw new Error(tr(`目标页面 ${snapshot.requestedPage.pageId} 已存在，新建页面请求不能覆盖已有页面`, `Target page ${snapshot.requestedPage.pageId} already exists; new-page request cannot overwrite an existing page`));
    } else if (context.kind === undefined && typeof context.pageId === 'string' && context.pageId) {
      if (context.selectedPfId && targetId !== context.pageId)
        throw new Error(tr('局部修改不能写入其他页面', 'Scoped component edits cannot write to other pages'));
      if (typeof targetId === 'string' && targetId !== context.pageId && context.initialPageIds.includes(targetId))
        throw new Error(tr(`单页会话（${context.pageId}）不能修改或覆盖其他已有页面 ${targetId}`, `Single-page session (${context.pageId}) cannot modify or overwrite existing page ${targetId}`));
      if (typeof targetId === 'string') {
        const allTouched = new Set([...context.explicitChangedPages, ...context.explicitStickyPages, targetId]);
        if ([...allTouched].some(id => !context.initialPageIds.includes(id)) && allTouched.size > 1)
          throw new Error(tr('新建页面时禁止同时修改或覆盖原有页面', 'Creating a new page cannot simultaneously modify or overwrite existing pages'));
      }
    }
  }
  if (name === 'protoflow_upsert_sticky_contract') {
    const stickyId = args?.sticky?.id;
    const stickyPageId = args?.sticky?.pageId;
    const existingOwner = typeof stickyId === 'string' && Object.hasOwn(context.initialStickyOwners, stickyId)
      ? context.initialStickyOwners[stickyId]
      : (snapshot.stickyNotes ?? []).find(s => s.id === stickyId)?.pageId;
    if (snapshot.requestedPage) {
      if (stickyPageId !== snapshot.requestedPage.pageId)
        throw new Error(tr(`新建页面请求只允许添加目标新页面 ${snapshot.requestedPage.pageId} 的需求便签，禁止写入页面 ${String(stickyPageId ?? '')}`, `New-page request may only add sticky notes to target page ${snapshot.requestedPage.pageId}; writing to page ${String(stickyPageId ?? '')} is forbidden`));
      if (context.initialPageIds.includes(snapshot.requestedPage.pageId))
        throw new Error(tr(`目标页面 ${snapshot.requestedPage.pageId} 已存在，新建页面请求不能覆盖已有页面`, `Target page ${snapshot.requestedPage.pageId} already exists; new-page request cannot overwrite an existing page`));
      if (existingOwner !== undefined && existingOwner !== snapshot.requestedPage.pageId)
        throw new Error(tr(`便签 ${stickyId} 原属于页面 ${existingOwner}，新建页面不能复用或覆盖已有便签`, `Sticky note ${stickyId} belongs to page ${existingOwner}; new-page requests cannot reuse or overwrite existing sticky notes`));
    } else if (context.kind === undefined && typeof context.pageId === 'string' && context.pageId) {
      if (existingOwner !== undefined && existingOwner !== stickyPageId)
        throw new Error(tr(`便签 ${stickyId} 原属于页面 ${existingOwner}，不能跨页面挪用或覆盖`, `Sticky note ${stickyId} belongs to page ${existingOwner} and cannot be moved or overwritten across pages`));
      if (existingOwner !== undefined && existingOwner !== context.pageId)
        throw new Error(tr(`单页会话（${context.pageId}）不能修改或覆盖其他页面 ${existingOwner} 的已有便签 ${stickyId}`, `Single-page session (${context.pageId}) cannot modify or overwrite sticky note ${stickyId} belonging to page ${existingOwner}`));
      if (typeof stickyPageId === 'string') {
        if (stickyPageId !== context.pageId && context.initialPageIds.includes(stickyPageId))
          throw new Error(tr(`单页会话（${context.pageId}）不能修改其他已有页面 ${stickyPageId} 的需求便签`, `Single-page session (${context.pageId}) cannot modify sticky notes on existing page ${stickyPageId}`));
        const allTouched = new Set([
          ...context.explicitChangedPages,
          ...context.explicitStickyPages,
          stickyPageId,
          ...(typeof existingOwner === 'string' && existingOwner ? [existingOwner] : []),
        ]);
        if ([...allTouched].some(id => !context.initialPageIds.includes(id)) && allTouched.size > 1)
          throw new Error(tr('新建页面时禁止同时修改或覆盖原有页面', 'Creating a new page cannot simultaneously modify or overwrite existing pages'));
      }
    }
  }
  let optimizedPageId;
  const newSiblingOperations = [];
  if (name === 'protoflow_optimize_axure_block' || name === 'protoflow_bind_axure_table' || name === 'protoflow_reshape_axure_page') {
    if (context.kind !== 'project' || context.workflowPhase !== 'conversation' || snapshot.requestedPage) throw new Error(tr('RP 物料优化需要在项目 AI 对话中由用户发起', 'RP material optimization must be initiated by the user in project AI conversation mode'));
    recordInspectPageFootprint(footprint, baseSnapshot, snapshot, args.pageId, true);
    if (name === 'protoflow_bind_axure_table') {
      if (context.schemaCatalogReadRunId !== context.runId) throw new Error(tr('绑定 RP 表格前请先用 protoflow_get_project 核对本轮表目录', 'Call protoflow_get_project to verify the current schema catalog before binding an RP table'));
      recordGetDbTableFootprint(footprint,baseSnapshot,args.tableId,false);
      const bound = bindAxureTable(snapshot,args.pageId,args.targetPfId,args.tableId,args.mappings);
      if (bound.unchanged) return {staged:false,unchanged:true,optimizedPageId:bound.pageId};
      args = bound;
    } else if (name === 'protoflow_reshape_axure_page') {
      if (typeof args.pageId !== 'string' || typeof args.source !== 'string' || !args.pageId.trim() || !args.source.trim())
        throw new Error(tr('RP 整页重塑缺少来源页面 pageId 或页面源码 source', 'RP page reshape requires non-empty source pageId and page source'));
      const reshapedDoc = parsePageSource(args.source).doc;
      const bindsAnyTable = Boolean(reshapedDoc && JSON.stringify(reshapedDoc.root).includes('"table"'));
      if (bindsAnyTable && context.schemaCatalogReadRunId !== context.runId)
        throw new Error(tr('重塑 RP 页面并绑定数据表前，请先调用 protoflow_get_project 核对本轮表目录', 'Call protoflow_get_project to verify the current schema catalog before reshaping an RP page with table bindings'));
      args = reshapeAxurePage(snapshot, args.pageId, args.source, args.coverage);
    } else {
      if (['pageId','targetPfId','tsx'].some(k => typeof args[k] !== 'string' || !args[k].trim())) throw new Error(tr('RP 优化缺少来源页面、目标 pfId 或物料源码', 'RP block optimization requires non-empty pageId, targetPfId, and tsx'));
      args = optimizeAxureBlock(snapshot, args.pageId, args.targetPfId, args.tsx, Boolean(snapshot.axureMigrationScope));
    }
    optimizedPageId = args.pageId;
    name = normalizedTool = 'protoflow_apply_tsx_patch';
  }
  if (name === 'protoflow_reshape_figma_page') {
    if (context.kind !== 'project' || context.workflowPhase !== 'conversation' || snapshot.requestedPage) {
      throw new Error(tr('Figma 画板重塑需要在项目 AI 对话中由用户发起', 'Figma frame reshaping must be initiated in project AI conversation mode'));
    }
    if (typeof args.pageId !== 'string' || typeof args.source !== 'string' || !args.pageId.trim() || !args.source.trim()) {
      throw new Error(tr('Figma 画板重塑缺少来源页面 pageId 或页面源码 source', 'Figma page reshape requires non-empty source pageId and page source'));
    }
    recordInspectPageFootprint(footprint, baseSnapshot, snapshot, args.pageId, true);
    const reshapedDoc = parsePageSource(args.source).doc;
    const bindsAnyTable = Boolean(reshapedDoc && JSON.stringify(reshapedDoc.root).includes('"table"'));
    if (bindsAnyTable && context.schemaCatalogReadRunId !== context.runId) {
      throw new Error(tr('重塑 Figma 画板并绑定数据表前，请先调用 protoflow_get_project 核对本轮表目录', 'Call protoflow_get_project to verify the current schema catalog before reshaping a Figma page with table bindings'));
    }
    args = reshapeFigmaPage(snapshot, args.pageId, args.source, args.coverage);
    optimizedPageId = args.pageId;
    name = normalizedTool = 'protoflow_apply_tsx_patch';
  }
  let wasEditBlock = false;
  if (name === 'protoflow_edit_page_block') {
    if (['pageId', 'targetPfId', 'mode', 'tsx'].some(key => typeof args[key] !== 'string')) throw new Error(tr('区块参数必须是字符串', 'Page block arguments must be strings'));
    recordPageMutationFootprint(footprint, baseSnapshot, args.pageId, undefined, true, context.kind === 'project');
    if (!Object.hasOwn(snapshot.pageSources, args.pageId)) throw new Error(tr('页面不存在，请先创建 Page 框架', 'Page does not exist; create a Page shell first'));
    let source = editPageBlock(snapshot.pageSources[args.pageId], args.targetPfId, args.mode, args.tsx);
    const priorOp = [...context.operations].reverse().find(op => op.tool === 'protoflow_apply_tsx_patch' && op.args.pageId === args.pageId);
    const retargeted = retargetEditedOptimizedCopy(snapshot, args.pageId, source, priorOp?.args);
    source = retargeted.source;
    const preservedMeta = retargeted.preservedMeta;
    if (retargeted.isOptimizedCopy) {
      optimizedPageId = args.pageId;
    }
    // Normalize to the existing host operation; partial drafts never bypass its gates.
    wasEditBlock = true;
    name = 'protoflow_apply_tsx_patch';
    normalizedTool = name;
    args = { pageId: args.pageId, ...preservedMeta, source };
  }
  if (['protoflow_upsert_db_table', 'protoflow_upsert_db_column'].includes(name) && context.schemaCatalogReadRunId !== context.runId)
    throw new Error(tr('修改数据库前必须先用 protoflow_get_project 读取本轮完整表目录，核对全项目已有实体和关联。', 'Call protoflow_get_project to read the full table catalog and check existing project entities and relations before modifying database schemas.'));
  let designFeedback;
  let pageReadinessFeedback;
  if (name === 'protoflow_add_preview_scenario') {
    if (context.kind !== 'project' || !['conversation','generating'].includes(context.workflowPhase)) throw new Error(tr('演示场景仅支持项目对话或已确认的项目生成', 'Preview scenarios are only supported in project conversation mode or confirmed project generation'));
    recordPreviewScenarioFootprint(footprint, baseSnapshot, snapshot, args.datasets);
    snapshot.tableRows = { ...snapshot.tableRows, ...preparePreviewScenario(snapshot.dbTables, snapshot.tableRows, args.datasets) };
  } else if (name === "protoflow_apply_tsx_patch") {
    if (typeof args.pageId !== "string" || typeof args.source !== "string")
      throw new Error("pageId/source must be strings");
    recordPageMutationFootprint(footprint, baseSnapshot, args.pageId, args.source, wasEditBlock || Boolean(optimizedPageId), context.kind === 'project');
    const errors = pageContractErrors(args.source, snapshot.dbTables, { tableRows: snapshot.tableRows });
    if (errors.length) throw new Error(tr(`物料或数据契约校验失败（${errors.length} 项）：\n${errors.join('\n')}\n请按 protoflow_get_contracts 返回的 valueSchema、events、父子关系和当前表结构修正。图表还会核验全部已保存记录：新增表/字段只改变结构，不会补齐记录或计算指标。请用 protoflow_get_table_rows 分页读取实际数据；派生指标只有在来源、时期和计算口径明确时才能计算为 inline 数据，并说明是当前快照计算结果。缺少基期或分母为零不能伪造为 0；不要删除用户要求的功能或改用示例数据来规避校验，无法实现时明确说明缺少的数据。`, `Material or data contract validation failed (${errors.length} issue(s)):\n${errors.join('\n')}\nFix according to valueSchema, events, parent-child rules in protoflow_get_contracts and the current table schemas. Charts also validate all saved rows: adding tables/columns only changes schema and never populates rows or computes metrics. Read actual rows via protoflow_get_table_rows; derived metrics may only be inlined when source, period, and formula are explicit and noted as snapshot-derived. Do not fabricate 0 when baseline is missing or denominator is zero; do not delete user-requested features or use sample data to bypass validation—state missing data explicitly if unimplementable.`));
    const isNew = !Object.hasOwn(snapshot.pageSources, args.pageId);
    const platform = checkAiPagePlatform(snapshot, args.pageId, parsePageSource(args.source).doc.root.type, snapshot.projectMode, snapshot.requestedPage?.pageId === args.pageId ? snapshot.requestedPage.platform : undefined);
    if (isNew) {
      if (!args.title || !args.folderId)
        throw new Error("New pages require title and folderId");
      snapshot.designerPages.push({
        pageId: args.pageId,
        title: args.title,
        folderId: args.folderId,
        platform,
      });
    }
    snapshot.pageSources[args.pageId] = args.source;
    if (isNew && optimizedPageId) {
      // Reuse the latest staged patch (including coverage) or create a reviewable
      // patch for a copy already on disk when this turn began.
      const stagedByPage = new Map();
      for (const op of context.operations) {
        if (op.tool === 'protoflow_apply_tsx_patch') stagedByPage.set(op.args.pageId, op);
      }
      for (const sibling of siblingNavigationPatches(snapshot, optimizedPageId, allowedCopyIds)) {
        if (pageContractErrors(sibling.source, snapshot.dbTables, { tableRows: snapshot.tableRows }).length) continue;
        recordPageMutationFootprint(footprint, baseSnapshot, sibling.pageId, sibling.source, true, context.kind === 'project');
        snapshot.pageSources[sibling.pageId] = sibling.source;
        const staged = stagedByPage.get(sibling.pageId);
        if (staged) staged.args.source = sibling.source;
        else newSiblingOperations.push({ tool: name, args: sibling });
        if (!context.explicitChangedPages.includes(sibling.pageId)) context.explicitChangedPages.push(sibling.pageId);
      }
    }
    if (!context.explicitChangedPages.includes(args.pageId)) context.explicitChangedPages.push(args.pageId);
    if (context.kind === 'project') {
      const readiness = evaluatePageDraftReadiness(snapshot, args.pageId, context.initialValidationBase ?? snapshot);
      if (context.workflowPhase === 'generating' || readiness.planned) {
        pageReadinessFeedback = {
          acceptanceReady: readiness.acceptanceReady,
          pendingAcceptanceIssues: readiness.pendingAcceptanceIssues,
          acceptanceHint: readiness.pendingAcceptanceIssues.length
            ? tr('当前修改已暂存，但整页尚有未完成的验收或关联项；请继续用 protoflow_edit_page_block 或相关工具补齐后再结束本轮。', 'Current changes are staged, but the page still has pending acceptance or dependency items; continue using protoflow_edit_page_block or related tools before ending this turn.')
            : tr('当前页面已满足全部静态契约与方案验收项，可直接结束本轮等待宿主原子提交。', 'This page now satisfies all static contracts and planned acceptance checks; you may end this turn and await atomic host commit.'),
        };
      }
    }
  } else if (name === "protoflow_upsert_db_table") {
    recordTableMutationFootprint(footprint, baseSnapshot, args.table?.id, args.table?.columns);
    designFeedback = stageTable(snapshot, args.table, baseSnapshot);
  } else if (name === "protoflow_upsert_db_column") {
    const table = snapshot.dbTables.find((t) => t.id === args.tableId);
    recordTableMutationFootprint(
      footprint,
      baseSnapshot,
      args.tableId,
      [...(table?.columns ?? []), ...(args.column ? [args.column] : [])],
    );
    if (!table || !args.column?.id)
      throw new Error("Unknown tableId or missing column id");
    const columns = [...table.columns];
    const i = columns.findIndex((c) => c.id === args.column.id);
    if (i < 0) columns.push(args.column);
    else columns[i] = args.column;
    designFeedback = stageTable(snapshot, { ...table, columns }, baseSnapshot);
  } else if (name === "protoflow_upsert_sticky_contract") {
    recordStickyMutationFootprint(footprint, baseSnapshot, args.sticky?.id);
    if (!args.sticky?.id) throw new Error("Sticky id required");
    validateStickyNoteIndex(args.sticky.index, tr(`便签 ${args.sticky.id}`, `Sticky note ${args.sticky.id}`));
    const i = snapshot.stickyNotes.findIndex((s) => s.id === args.sticky.id);
    if (i < 0) snapshot.stickyNotes.push(args.sticky);
    else snapshot.stickyNotes[i] = args.sticky;
    if (typeof args.sticky.pageId === 'string' && !context.explicitStickyPages.includes(args.sticky.pageId))
      context.explicitStickyPages.push(args.sticky.pageId);
  } else {
    recordOtherMutationFootprint(footprint, baseSnapshot, name, args);
    if (!Array.isArray(args.issues)) throw new Error("issues must be an array");
    validateClosedLoopAuditIssues(args.issues);
    for (const issue of args.issues) {
      const root = Object.hasOwn(snapshot.pageSources ?? {}, issue.pageId)
        ? parsePageSource(snapshot.pageSources[issue.pageId]).doc?.root
        : undefined;
      if (!root) throw new Error(tr(`巡检问题 ${issue.id} 引用的页面 pageId="${issue.pageId}" 不存在`, `Audit issue ${issue.id} references non-existent pageId="${issue.pageId}"`));
      if (!findNode(root, issue.targetWidgetId))
        throw new Error(tr(`巡检问题 ${issue.id} 引用的组件 targetWidgetId="${issue.targetWidgetId}" 在页面 ${issue.pageId} 中不存在`, `Audit issue ${issue.id} references non-existent targetWidgetId="${issue.targetWidgetId}" on page ${issue.pageId}`));
      if (issue.targetTableId !== '' && !(snapshot.dbTables ?? []).some(t => t.id === issue.targetTableId))
        throw new Error(tr(`巡检问题 ${issue.id} 引用的数据表 targetTableId="${issue.targetTableId}" 不存在；请使用精确 dbTables.id，无关联表时填 ""`, `Audit issue ${issue.id} references non-existent targetTableId="${issue.targetTableId}"; use exact dbTables.id or "" when no table is involved`));
    }
    snapshot.closedLoopIssues = args.issues;
  }
  // Consecutive RP replacements are cumulative full-page sources. The review
  // only needs the final copy. Keep intervening schema/menu operations in order.
  const previous = context.operations.at(-1);
  if (optimizedPageId && previous?.tool === name && previous.args.pageId === optimizedPageId)
    context.operations[context.operations.length - 1] = { tool: name, args };
  else context.operations.push({ tool: name, args });
  context.operations.push(...newSiblingOperations);
  const feedback = name === 'protoflow_upsert_db_table' ? projectMenuFeedback(context) : {};
  let rpMigrationProgress;
  if (snapshot.axureMigrationScope) {
    rpMigrationProgress = evaluateAxureMigrationProgress(
      snapshot,
      snapshot.axureMigrationScope,
      context.operations,
    );
  }
  saveContext();
  return {
    staged: true,
    operationCount: context.operations.length,
    ...(optimizedPageId && { optimizedPageId }),
    ...(rpMigrationProgress && { rpMigrationProgress }),
    ...(designFeedback && {databaseDesignReview: designFeedback}),
    ...(pageReadinessFeedback || {}),
    ...feedback,
    message: ['protoflow_upsert_db_table', 'protoflow_upsert_db_column'].includes(name)
      ? "Schema definition staged only; saved rows are unchanged. New fields have no values until data is explicitly provided. Awaiting host validation; not yet committed."
      : "Awaiting host validation; not yet committed.",
  };
  })();
  } catch (innerErr) {
    if (!(innerErr instanceof NativeContextNeeded || innerErr instanceof StaleRunError)) {
      persistFootprintOnlyIfChanged();
    }
    throw innerErr;
  }
  persistFootprintOnlyIfChanged();
  return toolResult;
  };
  let pendingNative = false;
  try {
    const value = run();
    ok = true;
    try {
      resultBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {}
    return value;
  } catch (error) {
    if (error instanceof NativeContextNeeded || error instanceof PreviewCaptureNeeded || error instanceof StaleRunError) {
      // Not an outcome of the current turn: either re-run by the async path, or a
      // stale call whose metrics must not be attributed to the turn that replaced it.
      pendingNative = true;
      throw error;
    }
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (
      !pendingNative &&
      parsedContext &&
      parsedContext.active &&
      parsedContext.runId &&
      typeof parsedContext.metricsFile === 'string' &&
      parsedContext.metricsFile
    ) {
      try {
        const durationMs = Number((performance.now() - startedAt).toFixed(2));
        fs.appendFileSync(
          parsedContext.metricsFile,
          JSON.stringify({
            runId: parsedContext.runId,
            tool: requestedTool,
            normalizedTool,
            ok,
            durationMs,
            argBytes,
            resultBytes,
            ...(nativeStats.count
              ? {
                  nativeQueryCount: nativeStats.count,
                  nativeQueryMs: Number(nativeStats.ms.toFixed(2)),
                  nativeBridgeMode: [...nativeStats.modes].sort().join('+'),
                  nativeColdStarts: nativeStats.coldStarts,
                }
              : {}),
            ...(errorMessage ? { error: errorMessage.slice(0, 240) } : {}),
          }) + '\n',
          { mode: 0o600 },
        );
      } catch {}
    }
  }
}
const nativeBridgePool = new ContextBridgePool();
/**
 * Server-path tool call. Same synchronous core and gates as `callTool`; only the
 * authoritative Hermes reads (compression count, history) go through the
 * long-lived bridge. Results are memoized for THIS call only and are never reused
 * by a later call, so every write still queries the live compression state.
 */
async function fetchPreviewBridge(bridge, payload) {
  const response = await fetch(`http://127.0.0.1:${bridge.port}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bridge.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(50000),
  });
  let parsed = null;
  try { parsed = await response.json(); } catch {}
  if (!response.ok || !parsed?.ok || !parsed?.image?.data) {
    throw new Error(parsed?.error || tr(`页面预览截图失败（HTTP ${response.status}）`, `Preview capture failed (HTTP ${response.status})`));
  }
  return parsed.image;
}
async function callToolAsync(contextFile, name, args, { pool = nativeBridgePool, expectedIdentity } = {}) {
  const startedAt = performance.now();
  // Bind this call to the turn it belongs to (fixed at frame arrival by the server,
  // otherwise at call start). Every re-run after an await re-verifies it.
  const identity = expectedIdentity !== undefined ? expectedIdentity : readExecutionIdentity(contextFile);
  const nativeStats = { count: 0, ms: 0, modes: new Set(), coldStarts: 0 };
  const answers = new Map();
  const previewAnswers = new Map();
  const resolveNative = (bridge, payload) => {
    const key = JSON.stringify([bridgeKey(bridge), payload]);
    if (!answers.has(key)) throw new NativeContextNeeded(key, bridge, payload);
    const answer = answers.get(key);
    if (answer.transportError) throw new Error(tr('Hermes 上下文接口不可用', 'Hermes context interface is unavailable'));
    return answer.result;
  };
  const resolvePreview = (bridge, payload) => {
    const key = JSON.stringify([bridge.port, payload.runId, payload.snapshot.pageId, payload.snapshot.revision, payload.snapshot.scope, payload.snapshot.fullPage, payload.snapshot.uiState ?? 'normal']);
    if (!previewAnswers.has(key)) throw new PreviewCaptureNeeded(key, bridge, payload);
    const answer = previewAnswers.get(key);
    if (answer.error) throw answer.error;
    return answer.image;
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return callTool(contextFile, name, args, { startedAt, nativeStats, resolveNative, resolvePreview, expectedIdentity: identity });
    } catch (error) {
      if (error instanceof PreviewCaptureNeeded) {
        try {
          const image = await fetchPreviewBridge(error.bridge, error.payload);
          previewAnswers.set(error.key, { image });
        } catch (captureErr) {
          previewAnswers.set(error.key, { error: captureErr instanceof Error ? captureErr : new Error(String(captureErr)) });
        }
        continue;
      }
      if (!(error instanceof NativeContextNeeded)) throw error;
      const queryStartedAt = performance.now();
      try {
        const answer = await pool.request(error.bridge, error.payload);
        nativeStats.modes.add(answer.mode);
        if (answer.coldStart) nativeStats.coldStarts += 1;
        answers.set(error.key, { result: answer.result });
      } catch (fetchError) {
        if (!(fetchError instanceof BridgeTransportError)) throw fetchError;
        nativeStats.modes.add('persistent');
        answers.set(error.key, { transportError: true });
      } finally {
        nativeStats.count += 1;
        nativeStats.ms += performance.now() - queryStartedAt;
      }
    }
  }
  throw new Error(tr('Hermes 上下文查询次数超出单次工具调用上限', 'Hermes context queries exceeded the per-tool-call limit'));
}
function mcpToolResult(value) {
  if (value && typeof value === 'object' && typeof value.__alexMcpImageContent === 'string') {
    return {
      content: [
        { type: 'image', mimeType: 'image/png', data: value.__alexMcpImageContent },
        { type: 'text', text: JSON.stringify(value.metadata) },
      ],
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
function mcpToolError(error) {
  return {
    isError: true,
    content: [{ type: "text", text: tr(`${error.message}\n本次调用未暂存修改。请读取 protoflow_get_contracts 中的契约，修正参数后重新调用。`, `${error.message}\nNo changes were staged by this call. Read the contracts in protoflow_get_contracts, fix the arguments, and retry.`) }],
  };
}
/** Handles one MCP frame. Tool calls are awaited here and the caller chains
 * frames, so staged writes are strictly serialized in arrival order. */
async function handleMcpFrame(contextFile, m, { pool = nativeBridgePool, identity } = {}) {
  try {
    let result;
    if (m.method === "initialize")
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "protoflow", version: "1.0.0" },
      };
    else if (m.method === "ping") result = {};
    else if (m.method === "tools/list") {
      const activeTools = resolveToolsForProfile(process.env.PROTOFLOW_TOOL_PROFILE);
      // Proof of actual ACP discovery, not the list imported by Electron.
      if (process.env.PROTOFLOW_TOOL_BINDING) atomicWrite(path.join(path.dirname(contextFile), 'tool-registration.json'), {
        binding: process.env.PROTOFLOW_TOOL_BINDING, tools: activeTools.map(tool => tool.name),
      });
      result = { tools: activeTools };
    }
    else if (m.method === "tools/call") {
      try {
        result = mcpToolResult(await callToolAsync(contextFile, m.params.name, m.params.arguments, {
          pool,
          expectedIdentity: identity !== undefined ? identity : readExecutionIdentity(contextFile),
        }));
      } catch (error) {
        result = mcpToolError(error);
      }
    } else throw new Error("Unsupported MCP method");
    return { jsonrpc: "2.0", id: m.id, result };
  } catch (error) {
    return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: error.message } };
  }
}
if (require.main === module) {
  const contextFile = process.argv[2];
  if (!contextFile || !path.isAbsolute(contextFile)) process.exit(1);
  const input = readline.createInterface({ input: process.stdin });
  let queue = Promise.resolve();
  input.on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id === undefined) return;
    // Bind the frame to the turn active when it ARRIVED, not when it is dequeued:
    // frames queued behind a slow call must not run against a newer turn.
    const identity = m.method === 'tools/call' ? readExecutionIdentity(contextFile) : undefined;
    queue = queue
      .then(() => handleMcpFrame(contextFile, m, { identity }))
      .then(frame => { process.stdout.write(JSON.stringify(frame) + "\n"); })
      .catch(() => {});
  });
  input.on("close", () => { queue.finally(() => nativeBridgePool.close()); });
}
/**
 * Replays staged candidate operations onto a fresh clone of `latestBaseSnapshot`
 * using the exact same material, schema, sticky and preview-scenario validators
 * as `callToolCore`. Never overwrites unrelated pages, tables or rows in `latestBaseSnapshot`.
 */
function replayCandidateOperations(latestBaseSnapshot, operations, { workflowPhase = 'generating', targetPageId } = {}) {
  const next = structuredClone(latestBaseSnapshot);
  if (!Array.isArray(operations) || operations.length === 0) return next;
  const initialStickyOwners = Object.fromEntries((latestBaseSnapshot.stickyNotes ?? []).map(s => [s.id, s.pageId]));
  const replayContext = {
    kind: 'project',
    workflowPhase,
    targetPageId,
    snapshot: next,
    operations: [],
  };
  for (const op of operations) {
    if (!op || typeof op !== 'object' || typeof op.tool !== 'string' || !op.args || typeof op.args !== 'object') {
      throw new Error(tr('候选恢复操作格式无效', 'Invalid candidate recovery operation format'));
    }
    const name = op.tool;
    const args = structuredClone(op.args);
    if (name === 'protoflow_add_preview_scenario') {
      next.tableRows = { ...next.tableRows, ...preparePreviewScenario(next.dbTables, next.tableRows, args.datasets) };
    } else if (name === 'protoflow_apply_tsx_patch') {
      if (typeof args.pageId !== 'string' || typeof args.source !== 'string') {
        throw new Error(tr('候选页面操作缺少 pageId 或 source', 'Candidate page operation is missing pageId or source'));
      }
      if (workflowPhase === 'generating' && targetPageId !== undefined && args.pageId !== targetPageId) {
        throw new Error(tr('候选操作超出当前页面生成范围', 'Candidate operation is outside the current page generation scope'));
      }
      const errors = pageContractErrors(args.source, next.dbTables, { tableRows: next.tableRows });
      if (errors.length) {
        throw new Error(tr(`候选页面契约校验失败：${errors.slice(0, 4).join('；')}`, `Candidate page contract validation failed: ${errors.slice(0, 4).join('; ')}`));
      }
      const isNew = !Object.hasOwn(next.pageSources, args.pageId);
      const platform = checkAiPagePlatform(
        next,
        args.pageId,
        parsePageSource(args.source).doc.root.type,
        next.projectMode,
        next.requestedPage?.pageId === args.pageId ? next.requestedPage.platform : undefined,
      );
      if (isNew) {
        if (!args.title || !args.folderId) throw new Error(tr('候选新页面缺少标题或目录', 'Candidate new page is missing title or folderId'));
        next.designerPages.push({
          pageId: args.pageId,
          title: args.title,
          folderId: args.folderId,
          platform,
        });
      }
      next.pageSources[args.pageId] = args.source;
    } else if (name === 'protoflow_upsert_db_table') {
      stageTable(next, args.table, latestBaseSnapshot);
    } else if (name === 'protoflow_upsert_db_column') {
      const table = next.dbTables.find(t => t.id === args.tableId);
      if (!table || !args.column?.id) throw new Error(tr('候选字段修改引用的数据表或字段无效', 'Candidate column operation references an invalid table or column'));
      const columns = [...table.columns];
      const idx = columns.findIndex(c => c.id === args.column.id);
      if (idx < 0) columns.push(args.column);
      else columns[idx] = args.column;
      stageTable(next, { ...table, columns }, latestBaseSnapshot);
    } else if (name === 'protoflow_upsert_sticky_contract') {
      if (!args.sticky?.id) throw new Error(tr('候选便签缺少 ID', 'Candidate sticky note is missing ID'));
      if (workflowPhase === 'generating' && targetPageId !== undefined) {
        const prevOwner = Object.hasOwn(initialStickyOwners, args.sticky.id)
          ? initialStickyOwners[args.sticky.id]
          : (next.stickyNotes ?? []).find(s => s.id === args.sticky.id)?.pageId;
        if (args.sticky.pageId !== targetPageId || (prevOwner !== undefined && prevOwner !== targetPageId)) {
          throw new Error(tr('候选便签超出当前页面生成范围', 'Candidate sticky note is outside the current page generation scope'));
        }
      }
      validateStickyNoteIndex(args.sticky.index, tr(`便签 ${args.sticky.id}`, `Sticky note ${args.sticky.id}`));
      const idx = next.stickyNotes.findIndex(s => s.id === args.sticky.id);
      if (idx < 0) next.stickyNotes.push(args.sticky);
      else next.stickyNotes[idx] = args.sticky;
    } else {
      throw new Error(tr(`不支持重放的候选工具操作：${name}`, `Unsupported candidate tool operation for replay: ${name}`));
    }
    replayContext.operations.push({ tool: name, args });
    if (name === 'protoflow_upsert_db_table') {
      projectMenuFeedback(replayContext);
    }
  }
  return next;
}

function readContextFootprint(contextFile) {
  const ctx = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
  if (!ctx || typeof ctx !== 'object') {
    throw new Error(tr('依赖足迹上下文文件无效', 'Invalid dependency footprint context file'));
  }
  const footprintErrorPath = contextFile + '.footprint.error';
  let errorMarkerTriggered = false;
  try {
    const rawErr = fs.readFileSync(footprintErrorPath, 'utf8');
    const parsedErr = JSON.parse(rawErr);
    errorMarkerTriggered = !parsedErr || !parsedErr.runId || parsedErr.runId === ctx.runId;
  } catch (err) {
    if (err?.code !== 'ENOENT') errorMarkerTriggered = true;
  }
  if (ctx.footprintCorrupted || errorMarkerTriggered) {
    throw new Error(tr('依赖足迹记录已损坏或保存失败，无法校验工程依赖', 'Dependency footprint record is corrupted or failed to save; unable to verify project dependencies'));
  }
  const sidecarPath = contextFile + '.footprint.json';
  const sidecarRequired = Boolean(ctx.requireFootprintSidecar);
  let rawSidecar = null;
  try {
    rawSidecar = fs.readFileSync(sidecarPath, 'utf8');
  } catch (readErr) {
    if (readErr?.code === 'ENOENT' && !sidecarRequired) {
      if (ctx.dependencyFootprint?.version === 3) return ctx.dependencyFootprint;
      return null;
    }
    throw new Error(tr('依赖足迹记录缺失或读取失败，无法校验工程依赖', 'Dependency footprint record is missing or unreadable; unable to verify project dependencies'));
  }
  let sidecar;
  try {
    sidecar = JSON.parse(rawSidecar);
  } catch {
    throw new Error(tr('依赖足迹记录已损坏，无法校验工程依赖', 'Dependency footprint record is corrupted; unable to verify project dependencies'));
  }
  if (
    !sidecar ||
    typeof sidecar !== 'object' ||
    sidecar.corrupted === true ||
    (ctx.runId && sidecar.runId !== ctx.runId) ||
    sidecar.dependencyFootprint?.version !== 3
  ) {
    throw new Error(tr('依赖足迹记录不完整或运行标识不匹配，无法校验工程依赖', 'Dependency footprint record is incomplete or has a mismatched run ID; unable to verify project dependencies'));
  }
  return sidecar.dependencyFootprint;
}

module.exports = { tools, resolveToolsForProfile, callTool, callToolAsync, handleMcpFrame, readExecutionIdentity, atomicWrite, replayCandidateOperations, readContextFootprint };
