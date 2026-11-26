import { tr } from '../i18n/runtime';
import { validateTableDomain } from '../proto/database/domain';
import { resolveUniqueConstraints } from '../proto/database/uniqueConstraints';
import type { DBColumnSchema, DBTableSchema } from '../store/useProtoStore';

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface JsonSchemaNode {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  enum?: readonly string[];
  required?: readonly string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
}

const text: JsonSchemaNode = { type: 'string' };
const identifier: JsonSchemaNode = { type: 'string', pattern: '\\S' };

export const DB_COLUMN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description: 'DBColumnSchema (preserve existing column IDs).',
  additionalProperties: false,
  required: ['id', 'name', 'dataType', 'nullable', 'comment'],
  properties: {
    id: { ...identifier, description: 'Stable column ID.' },
    name: { ...identifier, description: 'Physical field name (Form.name / Table dataIndex).' },
    dataType: { ...identifier, description: 'SQL type, e.g. VARCHAR(64), INT, DECIMAL(12,2), BOOLEAN, TIMESTAMP.' },
    nullable: { type: 'boolean' },
    comment: text,
    isPrimaryKey: { type: 'boolean' },
    isUnique: { type: 'boolean' },
    isForeignKey: { type: 'boolean' },
    references: { ...text, description: 'FK target as tableName(columnName), e.g. t_customers(id).' },
    foreignKeyOptions: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {
        name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
        cardinality: { type: 'string', enum: ['1:N', '1:1'] },
        onDelete: { type: 'string', enum: ['RESTRICT', 'CASCADE', 'SET NULL'] },
      },
    },
    defaultValue: {
      ...text,
      description: "SQL DEFAULT literal (quote strings, e.g. 'draft').",
    },
    sourceWidgetOrSticky: text,
    isNew: { type: 'boolean' },
  },
};

export const DB_SHARED_MENU_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['pageId', 'menuTitle', 'accessMode', 'fieldMappingNote'],
  properties: {
    pageId: {
      ...identifier,
      description: 'Exact menu pageId (never folder/pfId/modal ID).',
    },
    menuTitle: text,
    accessMode: {
      type: 'string',
      enum: ['CRUD 读写', 'READ 查询', 'FK 外键引用', 'STATE 状态流转'],
    },
    fieldMappingNote: {
      ...text,
      description: 'How the page uses this table (or "").',
    },
  },
};

export const DB_TABLE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description: 'DBTableSchema (preserve existing table/column IDs).',
  additionalProperties: false,
  required: ['id', 'tableName', 'cnName', 'domain', 'description', 'columns', 'sharedByMenus'],
  properties: {
    id: { ...identifier, description: 'Stable dbTables.id bound by Table.table / Form.table.' },
    tableName: {
      type: 'string',
      pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
      description: 'Physical SQL table name (not table ID).',
    },
    cnName: text,
    domain: {
      ...identifier,
      maxLength: 80,
      description: 'Business domain (1-80 single-line chars).',
    },
    description: text,
    modeling: {
      type: 'object',
      additionalProperties: false,
      required: ['entity', 'grain', 'reason'],
      properties: {
        entity: { ...identifier, description: 'Business entity/event.' },
        grain: { ...identifier, description: 'Meaning of one row.' },
        reason: { ...identifier, description: 'Why persisted separately.' },
        pendingRules: {
          type: 'array',
          description: 'Rules SQL DDL cannot enforce.',
          items: {
            type: 'object',
            required: ['rule', 'reason'],
            additionalProperties: false,
            properties: {
              rule: identifier,
              reason: identifier,
            },
          },
        },
      },
    },
    uniqueConstraints: {
      type: 'array',
      description: 'Named composite UNIQUE constraints using columns[].id.',
      items: {
        type: 'object',
        required: ['name', 'columnIds'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,62}$' },
          columnIds: {
            type: 'array',
            minItems: 1,
            maxItems: 16,
            uniqueItems: true,
            items: identifier,
          },
        },
      },
    },
    columns: {
      type: 'array',
      items: DB_COLUMN_JSON_SCHEMA,
    },
    sharedByMenus: {
      type: 'array',
      description: 'Menu bindings declaring how pages share this table. Use [] if unbound.',
      items: DB_SHARED_MENU_JSON_SCHEMA,
    },
  },
};

function validateAgainstSchema(value: unknown, schema: JsonSchemaNode, fieldPath: string): void {
  if (schema.type === 'object') {
    if (!isPlainObject(value)) {
      const req = schema.required?.join(', ') ?? '';
      throw new Error(
        tr(
          `${fieldPath} 必须是对象${req ? `（必填字段：${req}）` : ''}`,
          `${fieldPath} must be an object${req ? ` (required: ${req})` : ''}`
        )
      );
    }
    for (const key of schema.required ?? []) {
      if (!hasOwn(value, key)) {
        throw new Error(tr(`${fieldPath}.${key} 必须提供`, `${fieldPath}.${key} is required`));
      }
    }
    const props = schema.properties ?? {};
    for (const key of Object.keys(value)) {
      if (!hasOwn(props, key)) {
        throw new Error(
          tr(
            `${fieldPath}.${key} 不是支持的字段（允许：${Object.keys(props).join(', ')}）`,
            `${fieldPath}.${key} is not a supported field (allowed: ${Object.keys(props).join(', ')})`
          )
        );
      }
      validateAgainstSchema(value[key], props[key], `${fieldPath}.${key}`);
    }
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      throw new Error(tr(`${fieldPath} 必须是数组`, `${fieldPath} must be an array`));
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new Error(
        tr(
          `${fieldPath} 至少需要 ${schema.minItems} 项`,
          `${fieldPath} must contain at least ${schema.minItems} item(s)`
        )
      );
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw new Error(
        tr(
          `${fieldPath} 最多允许 ${schema.maxItems} 项`,
          `${fieldPath} must contain at most ${schema.maxItems} item(s)`
        )
      );
    }
    if (schema.items) {
      value.forEach((item, index) => validateAgainstSchema(item, schema.items!, `${fieldPath}[${index}]`));
    }
    if (schema.uniqueItems) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) {
        throw new Error(tr(`${fieldPath} 不能包含重复项`, `${fieldPath} must not contain duplicate items`));
      }
    }
    return;
  }

  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(tr(`${fieldPath} 必须是布尔值`, `${fieldPath} must be a boolean`));
    }
    return;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      throw new Error(tr(`${fieldPath} 必须是字符串`, `${fieldPath} must be a string`));
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new Error(
        tr(`${fieldPath} 长度不能小于 ${schema.minLength}`, `${fieldPath} length must be >= ${schema.minLength}`)
      );
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new Error(
        tr(`${fieldPath} 长度不能超过 ${schema.maxLength}`, `${fieldPath} length must be <= ${schema.maxLength}`)
      );
    }
    if (schema.enum && !schema.enum.includes(value)) {
      throw new Error(
        tr(
          `${fieldPath} 必须是以下值之一：${schema.enum.join('、')}`,
          `${fieldPath} must be one of: ${schema.enum.join(', ')}`
        )
      );
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      throw new Error(
        tr(`${fieldPath} 格式无效（需匹配 ${schema.pattern}）`, `${fieldPath} has invalid format (${schema.pattern})`)
      );
    }
  }
}

function assertUniqueField(items: Record<string, unknown>[], key: string, arrayPath: string): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const val = String(item[key]);
    if (seen.has(val)) {
      throw new Error(
        tr(`${arrayPath}[${index}].${key} 重复：${val}`, `Duplicate ${arrayPath}[${index}].${key}: ${val}`)
      );
    }
    seen.add(val);
  });
}

function validateColumnSemantics(column: DBColumnSchema, fieldPath: string): void {
  if (column.foreignKeyOptions) {
    if (!column.references || !column.references.trim()) {
      throw new Error(
        tr(
          `${fieldPath}.references 在配置 foreignKeyOptions 时不能为空`,
          `${fieldPath}.references is required when foreignKeyOptions is specified`
        )
      );
    }
    if (column.foreignKeyOptions.onDelete === 'SET NULL' && !column.nullable) {
      throw new Error(
        tr(
          `${fieldPath}.foreignKeyOptions.onDelete 为 SET NULL 时字段必须允许空值 (nullable: true)`,
          `${fieldPath}.foreignKeyOptions.onDelete = SET NULL requires nullable: true`
        )
      );
    }
  }
}

export function validateDbColumnInput(column: unknown, fieldPath = 'column'): asserts column is DBColumnSchema {
  validateAgainstSchema(column, DB_COLUMN_JSON_SCHEMA as JsonSchemaNode, fieldPath);
  validateColumnSemantics(column as DBColumnSchema, fieldPath);
}

export function validateDbTableInput(table: unknown, fieldPath = 'table'): asserts table is DBTableSchema {
  validateAgainstSchema(table, DB_TABLE_JSON_SCHEMA as JsonSchemaNode, fieldPath);
  const typed = table as unknown as DBTableSchema;
  validateTableDomain(typed.domain);
  assertUniqueField(typed.columns as unknown as Record<string, unknown>[], 'id', `${fieldPath}.columns`);
  assertUniqueField(typed.columns as unknown as Record<string, unknown>[], 'name', `${fieldPath}.columns`);
  assertUniqueField(typed.sharedByMenus as unknown as Record<string, unknown>[], 'pageId', `${fieldPath}.sharedByMenus`);
  typed.columns.forEach((col, i) => validateColumnSemantics(col, `${fieldPath}.columns[${i}]`));
  resolveUniqueConstraints(typed);
}
