import type { DBColumnSchema, DBTableSchema } from '../../store/useProtoStore';

/** Older projects (including the inventory archive) store simple text defaults
 * such as 草稿 as an unquoted token on VARCHAR columns. Normalize this exact
 * historical representation for both preview and SQL, without mutating archives.
 * Preserve explicit SQL literals, functions and SQL value keywords verbatim. */
export function columnDefaultSql(col: DBColumnSchema): string | undefined {
  const sql = col.defaultValue?.trim();
  if (!sql) return undefined;
  const textColumn = /^(?:(?:VAR)?CHAR|(?:TINY|MEDIUM|LONG)?TEXT|ENUM)\b/i.test(col.dataType);
  const bareText = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(sql);
  const sqlValue = /^(?:NULL|TRUE|FALSE|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|CURRENT_USER|LOCALTIME|LOCALTIMESTAMP)$/i.test(sql);
  return textColumn && bareText && !sqlValue ? `'${sql}'` : sql;
}

export function columnDefaultIssue(col: DBColumnSchema): string | undefined {
  if (columnDefaultSql(col)?.toUpperCase() === 'NULL' && !col.nullable) return '非空字段不能声明 DEFAULT NULL';
}

/** Undefined denotes a database-only expression or a malformed literal. */
export function previewDefaultValue(col: DBColumnSchema, now: Date): string | number | boolean | null | undefined {
  const sql = columnDefaultSql(col);
  if (!sql || columnDefaultIssue(col)) return undefined;
  if (/^NULL$/i.test(sql)) return null;
  if (/^'(?:''|[^'\\])*'$/.test(sql)) return sql.slice(1,-1).replace(/''/g,"'");
  if (/^(?:TRUE|FALSE)$/i.test(sql)) return sql.toUpperCase() === 'TRUE';
  if (/^-?\d+(\.\d+)?$/.test(sql)) {
    const number = Number(sql);
    // Preserve large integers and fixed-point precision when serialized as SQL text.
    return Number.isSafeInteger(number) && !sql.includes('.') ? number : sql;
  }
  if (/^CURRENT_DATE(?:\(\))?$/i.test(sql) && /^DATE\b/i.test(col.dataType)) return now.toISOString().slice(0,10);
  if (/^CURRENT_TIMESTAMP(?:\(\))?$/i.test(sql) && /^(?:DATETIME|TIMESTAMP)\b/i.test(col.dataType)) return now.toISOString();
}

export function valuesWithColumnDefaults(table: DBTableSchema, input: Record<string, unknown>, now = new Date()) {
  const values = {...input};
  for (const col of table.columns) {
    if (!col.defaultValue?.trim() || Object.hasOwn(input,col.name) || col.name === 'id') continue;
    const value = previewDefaultValue(col, now);
    if (value === undefined) {
      const reason = columnDefaultIssue(col) ?? `默认表达式 ${col.defaultValue} 需要数据库执行，请显式提供该字段`;
      throw new Error(`${table.tableName}.${col.name}：${reason}`);
    }
    values[col.name] = value;
  }
  return values;
}
