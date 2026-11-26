// MCP's advertised schema and staging validation share this definition.
// Keep it aligned with DBTableSchema / DBColumnSchema in useProtoStore.ts.
const text = { type: "string" };
const identifier = { type: "string", pattern: "\\S" };
const columnSchema = {
  type: "object",
  description: "DBColumnSchema (preserve existing column IDs).",
  additionalProperties: false,
  // Hermes 0.22.5 tool_search_validation removes every key named "nullable",
  // including the entry in a properties map. This exact-name constraint keeps
  // that real business field valid and boolean after its schema transformation.
  // Retain the normal properties entry for providers that handle maps correctly.
  patternProperties: { "^nullable$": { type: "boolean" } },
  required: ["id", "name", "dataType", "nullable", "comment"],
  properties: {
    id: { ...identifier, description: "Stable column ID." },
    name: { ...identifier, description: "Physical field name (Form.name / Table dataIndex, not column ID)." },
    dataType: text,
    nullable: { type: "boolean" },
    comment: text,
    isPrimaryKey: { type: "boolean" },
    isUnique: { type: "boolean", description: "Single-column UNIQUE when backed by business rule." },
    isForeignKey: { type: "boolean" },
    references: { ...text, description: "Physical tableName(columnName), not table ID." },
    foreignKeyOptions: {
      type: "object", additionalProperties: false, required: [],
      properties: {
        name: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
        cardinality: { type: "string", enum: ["1:N", "1:1"] },
        onDelete: { type: "string", enum: ["RESTRICT", "CASCADE", "SET NULL"] },
      },
    },
    defaultValue: { ...text, description: "SQL DEFAULT literal (quote strings, e.g. 'todo')." },
    sourceWidgetOrSticky: text,
    isNew: { type: "boolean" },
  },
};
const sharedMenuSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pageId", "menuTitle", "accessMode", "fieldMappingNote"],
  properties: {
    pageId: { ...identifier, description: "Exact menu pageId (existing or proposed in this turn; never folder/pfId/modal ID)." },
    menuTitle: { ...text, description: "Menu display title." },
    accessMode: { type: "string", enum: ["CRUD 读写", "READ 查询", "FK 外键引用", "STATE 状态流转"] },
    fieldMappingNote: { ...text, description: "How the page uses this table (or '' if none)." },
  },
};
const tableSchema = {
  type: "object",
  description: "DBTableSchema (preserve existing table and column IDs).",
  additionalProperties: false,
  required: ["id", "tableName", "cnName", "domain", "description", "columns", "sharedByMenus"],
  properties: {
    id: { ...identifier, description: "Stable dbTables.id bound by Form/Table." },
    tableName: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$", description: "Physical SQL table name (never use as table ID)." },
    cnName: text,
    domain: { ...identifier, maxLength: 80, description: "Business domain name (reuse existing domains when applicable)." },
    description: text,
    modeling: {
      type: "object", additionalProperties: false, required: ["entity", "grain", "reason"],
      description: "Required on new tables; preserve on updates.",
      properties: {
        pendingRules: {
          type: "array", description: "Explicit requested rules SQL DDL cannot enforce (no speculative rules; explicit exclusions are not pending).",
          items: { type: "object", required: ["rule", "reason"], additionalProperties: false, properties: { rule: identifier, reason: identifier } },
        },
        entity: { ...identifier, description: "Business entity/event." },
        grain: { ...identifier, description: "Exact meaning of one row." },
        reason: { ...identifier, description: "Why persisted separately vs existing/planned tables." },
      },
    },
    uniqueConstraints: {
      type: "array", description: "Named composite/table UNIQUE keys (preserve on updates; [] clears all).",
      items: { type: "object", required: ["name", "columnIds"], additionalProperties: false, properties: {
        name: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]{0,62}$" },
        columnIds: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: identifier, description: "Ordered columns[].id (not column names)." },
      } },
    },
    columns: { type: "array", items: columnSchema },
    sharedByMenus: {
      type: "array",
      description: "Objects per owning menu page ([] only if intentionally unbound).",
      items: sharedMenuSchema,
    },
  },
};

// Only the JSON Schema keywords used above are needed; never coerce values or
// invent missing identifiers, access modes, labels or mapping notes.
// The transport's patternProperties repeats nullable's properties constraint;
// the properties pass below already enforces that field on the actual input.
function validate(value, schema, path) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${path} 必须是对象，包含字段：${schema.required.join(", ")}`);
    for (const key of schema.required)
      if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} 必须提供`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${path}.${key} 不是支持的字段`);
      validate(value[key], schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
    value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`));
  } else {
    if (typeof value !== schema.type) throw new Error(`${path} 必须是 ${schema.type}`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} 必须是以下值之一：${schema.enum.join("、")}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`${path} 格式无效（${schema.pattern}）`);
  }
}
function unique(items, key, path) {
  const seen = new Set();
  items.forEach((item, i) => {
    if (seen.has(item[key])) throw new Error(`${path}[${i}].${key} 重复：${item[key]}`);
    seen.add(item[key]);
  });
}
function validateTable(table, path = "table") {
  validate(table, tableSchema, path);
  require('./generated/material-contract.cjs').validateTableDomain(table.domain);
  unique(table.columns, "id", `${path}.columns`);
  unique(table.columns, "name", `${path}.columns`);
  unique(table.sharedByMenus, "pageId", `${path}.sharedByMenus`);
}
module.exports = { tableSchema, columnSchema, validateTable };
