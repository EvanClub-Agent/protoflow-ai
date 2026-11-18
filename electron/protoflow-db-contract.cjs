// MCP's advertised schema and staging validation share this definition.
// Keep it aligned with DBTableSchema / DBColumnSchema in useProtoStore.ts.
const text = { type: "string" };
const identifier = { type: "string", pattern: "\\S" };
const columnSchema = {
  type: "object",
  description: "Complete DBColumnSchema. Preserve existing column IDs.",
  additionalProperties: false,
  // Hermes 0.22.5 tool_search_validation removes every key named "nullable",
  // including the entry in a properties map. This exact-name constraint keeps
  // that real business field valid and boolean after its schema transformation.
  // Retain the normal properties entry for providers that handle maps correctly.
  patternProperties: { "^nullable$": { type: "boolean" } },
  required: ["id", "name", "dataType", "nullable", "comment"],
  properties: {
    id: { ...identifier, description: "Stable column ID; preserve it when editing." },
    name: { ...identifier, description: "Physical field name, used by Form name and Table dataIndex. Not the column ID." },
    dataType: text,
    nullable: { type: "boolean" },
    comment: text,
    isPrimaryKey: { type: "boolean" },
    isUnique: { type: "boolean", description: "Single-column UNIQUE constraint, only with a business basis." },
    isForeignKey: { type: "boolean" },
    references: { ...text, description: "Physical tableName(columnName), e.g. actual_supplier(id); not table ID." },
    foreignKeyOptions: {
      type: "object", additionalProperties: false, required: [],
      properties: {
        name: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
        cardinality: { type: "string", enum: ["1:N", "1:1"] },
        onDelete: { type: "string", enum: ["RESTRICT", "CASCADE", "SET NULL"] },
      },
    },
    defaultValue: { ...text, description: "SQL DEFAULT expression. For a business text literal use SQL single quotes inside the JSON string, e.g. 'todo'. Database-only expressions require an explicit value for offline preview writes." },
    sourceWidgetOrSticky: text,
    isNew: { type: "boolean" },
  },
};
const sharedMenuSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pageId", "menuTitle", "accessMode", "fieldMappingNote"],
  properties: {
    pageId: { ...identifier, description: "Exact menu pageId; not a folder ID, menu node ID, component pfId or Modal id. A same-turn new menu can be declared by a page patch or by pages[].pageId in the final full project proposal. The host creates proposed menus and schema together only on confirmation." },
    menuTitle: { ...text, description: "The referenced menu page's display title." },
    accessMode: { type: "string", enum: ["CRUD 读写", "READ 查询", "FK 外键引用", "STATE 状态流转"] },
    fieldMappingNote: { ...text, description: "Describe how the page uses this table and its fields. Use an explicit empty string when no note is needed." },
  },
};
const tableSchema = {
  type: "object",
  description: "Complete DBTableSchema. Preserve existing table and column IDs.",
  additionalProperties: false,
  required: ["id", "tableName", "cnName", "domain", "description", "columns", "sharedByMenus"],
  properties: {
    id: { ...identifier, description: "Stable table ID, used in Form/Table table bindings; preserve existing IDs." },
    tableName: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$", description: "Physical table name; never substitute for the table ID." },
    cnName: text,
    domain: { ...identifier, maxLength: 80, description: "Explicit business domain from this project. Reuse existing domain names precisely, or declare a new one for a genuinely distinct domain." },
    description: text,
    modeling: {
      type: "object", additionalProperties: false, required: ["entity", "grain", "reason"],
      description: "Required for new AI tables. Preserve on updates. Use project-wide business concepts.",
      properties: {
        pendingRules: {
          type: "array", description: "Explicitly requested business rules this schema cannot enforce. Never add speculative future constraints or deletion policies; an explicit exclusion creates no pending rule. Keep these visible for developer review; do not simulate them with weaker constraints.",
          items: { type: "object", required: ["rule", "reason"], additionalProperties: false, properties: { rule: identifier, reason: identifier } },
        },
        entity: { ...identifier, description: "Business entity or event, independent of menus." },
        grain: { ...identifier, description: "Exactly what one row represents, including applicable time or version." },
        reason: { ...identifier, description: "Why this fact needs separate persistence after comparing existing and planned tables. Explain ownership and any intentional snapshots." },
      },
    },
    uniqueConstraints: {
      type: "array", description: "Named UNIQUE keys, independent of the primary key. Preserve existing constraints on updates. Use [] to explicitly remove all.",
      items: { type: "object", required: ["name", "columnIds"], additionalProperties: false, properties: {
        name: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]{0,62}$" },
        columnIds: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: identifier, description: "Ordered exact columns[].id of this table, never physical column names." },
      } },
    },
    columns: { type: "array", items: columnSchema },
    sharedByMenus: {
      type: "array",
      description: "One complete object per menu page, never an array of page ID strings. A list and its nested Modal share the owning menu page reference. Use [] only for a deliberately unbound table.",
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
