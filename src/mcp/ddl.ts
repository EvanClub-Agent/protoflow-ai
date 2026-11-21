import { tr } from '../i18n/runtime';
import { columnDefaultSql } from '../proto/database/columnDefault';
import { diagramRelations, type DiagramRelation } from '../proto/database/relations';
import { resolveUniqueConstraints, sqlIdentifier, uniqueConstraintSql } from '../proto/database/uniqueConstraints';
import type { DBColumnSchema, DBTableSchema } from '../store/useProtoStore';

export type SqlDialect = 'postgres' | 'mysql';

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeMysqlComment(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/'/g, "''");
}

const PG_BOOL_RE = /^(?:TINYINT\s*\(\s*1\s*\)(?:\s+UNSIGNED)?|BOOL|BOOLEAN)$/i;
const MYSQL_INTEGER_RE = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\s*\(\s*\d+\s*\))?(?:\s+(SIGNED|UNSIGNED))?(?:\s+(ZEROFILL))?$/i;
const PG_TIMESTAMP_RE = /^(?:DATETIME|TIMESTAMP)(?:\s*\(\s*0*([0-6])\s*\))?$/i;
const PG_TEXT_RE = /^(?:TINYTEXT|MEDIUMTEXT|LONGTEXT)$/i;
const PG_JSON_RE = /^JSON$/i;
const PG_DOUBLE_RE = /^DOUBLE(?:\s+PRECISION)?(?:\s*\(\s*\d+\s*,\s*\d+\s*\))?(?:\s+(?:UNSIGNED|SIGNED))?$/i;
const PG_FLOAT_RE = /^FLOAT(?:\s*\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\))?(?:\s+(?:UNSIGNED|SIGNED))?$/i;
const PG_BYTEA_RE = /^(?:LONGBLOB|MEDIUMBLOB|TINYBLOB|BLOB|(?:VAR)?BINARY(?:\s*\(\s*\d+\s*\))?)$/i;
const PG_ENUM_RE = /^ENUM\s*\(.*\)$/i;

// PostgreSQL's signed types must accommodate the full MySQL unsigned range.
const INTEGER_TYPES: Record<string, { signed: string; unsigned: string; maximum: string }> = {
  TINYINT: { signed: 'SMALLINT', unsigned: 'SMALLINT', maximum: '255' },
  SMALLINT: { signed: 'SMALLINT', unsigned: 'INTEGER', maximum: '65535' },
  MEDIUMINT: { signed: 'INTEGER', unsigned: 'INTEGER', maximum: '16777215' },
  INT: { signed: 'INTEGER', unsigned: 'BIGINT', maximum: '4294967295' },
  BIGINT: { signed: 'BIGINT', unsigned: 'NUMERIC(20,0)', maximum: '18446744073709551615' },
};

function postgresIntegerType(declaration: string) {
  const match = MYSQL_INTEGER_RE.exec(declaration.trim().toUpperCase());
  if (!match) return;
  const type = INTEGER_TYPES[match[1] === 'INTEGER' ? 'INT' : match[1]];
  // MySQL ZEROFILL implies UNSIGNED even when no sign modifier is written.
  const unsigned = match[2] === 'UNSIGNED' || match[3] === 'ZEROFILL';
  return { sql: unsigned ? type.unsigned : type.signed, maximum: unsigned ? type.maximum : undefined };
}

/** Map common MySQL-flavored prototype column types to idiomatic PostgreSQL types without altering native PostgreSQL types (e.g. INTERVAL, INT8, FLOAT8, INT[], TIMESTAMP WITHOUT TIME ZONE). */
export function mapColumnTypeForDialect(rawType: string, dialect: SqlDialect): string {
  const trimmed = rawType.trim();
  if (dialect === 'mysql' || trimmed.endsWith(']')) return trimmed;
  if (PG_BOOL_RE.test(trimmed)) return 'BOOLEAN';
  const integer = postgresIntegerType(trimmed);
  if (integer) return integer.sql;
  const timestamp = PG_TIMESTAMP_RE.exec(trimmed);
  if (timestamp) return timestamp[1] === undefined ? 'TIMESTAMPTZ' : 'TIMESTAMPTZ(' + timestamp[1] + ')';
  if (PG_TEXT_RE.test(trimmed)) return 'TEXT';
  if (PG_JSON_RE.test(trimmed)) return 'JSONB';
  if (PG_DOUBLE_RE.test(trimmed)) return 'DOUBLE PRECISION';
  const float = PG_FLOAT_RE.exec(trimmed);
  if (float) {
    // FLOAT(p) specifies binary precision. FLOAT(M,D) is MySQL's single-precision form.
    if (float[1] === undefined || float[2] !== undefined) return 'REAL';
    const precision = Number(float[1]);
    if (precision <= 24) return 'REAL';
    if (precision <= 53) return 'DOUBLE PRECISION';
  }
  if (PG_BYTEA_RE.test(trimmed)) return 'BYTEA';
  if (PG_ENUM_RE.test(trimmed)) return 'VARCHAR(64)';
  return trimmed;
}

function postgresColumnDefaultSql(col: DBColumnSchema): string | undefined {
  const def = columnDefaultSql(col);
  if (!def) return undefined;
  const mappedType = mapColumnTypeForDialect(col.dataType, 'postgres');
  if (mappedType === 'BOOLEAN') {
    if (def === '1' || /^'1'$/i.test(def)) return 'TRUE';
    if (def === '0' || /^'0'$/i.test(def)) return 'FALSE';
  }
  if (/^CURRENT_TIMESTAMP\s*\(\s*\)$/i.test(def)) return 'CURRENT_TIMESTAMP';
  if (/^CURRENT_DATE\s*\(\s*\)$/i.test(def)) return 'CURRENT_DATE';
  return def;
}

export function tableSingleColumnUniqueNames(tbl: DBTableSchema): Set<string> {
  const uniq = new Set<string>();
  const pks = tbl.columns.filter((c) => c.isPrimaryKey);
  if (pks.length === 1) uniq.add(pks[0].name);
  for (const c of tbl.columns) {
    if (c.isUnique) uniq.add(c.name);
  }
  try {
    for (const u of resolveUniqueConstraints(tbl)) {
      if (u.columns.length === 1) uniq.add(u.columns[0].name);
    }
  } catch {
    // Malformed constraint surfaced separately by designReview
  }
  return uniq;
}

export function resolveScopedRelations(
  scopedTables: DBTableSchema[],
  allProjectTables: DBTableSchema[] = scopedTables,
  includeDependencies = false
) {
  const relations: DiagramRelation[] = [];
  const issues: string[] = [];
  const byId = new Map(allProjectTables.map(table => [table.id, table]));
  const uniqueNames = new Map(allProjectTables.map(table => [table.id, tableSingleColumnUniqueNames(table)]));
  const included = new Set(scopedTables.map(table => table.id));

  // Set iteration visits each newly discovered parent once, including in cyclic graphs.
  for (const id of included) {
    const child = byId.get(id)!;
    const declared = diagramRelations([child], allProjectTables);
    issues.push(...declared.issues);
    for (const fk of declared.relations) {
      const parent = byId.get(fk.fromTableId)!;
      if (!uniqueNames.get(parent.id)!.has(fk.fromColumnName)) {
        issues.push(
          tr(
            `${child.tableName}.${fk.toColumnName}：外键引用 ${parent.tableName}(${fk.fromColumnName}) 的目标列缺少单列主键或 UNIQUE 约束，已跳过外键 DDL`,
            `${child.tableName}.${fk.toColumnName}: target column of foreign key reference ${parent.tableName}(${fk.fromColumnName}) lacks a single-column PRIMARY KEY or UNIQUE constraint; skipped foreign key DDL`
          )
        );
        continue;
      }
      if (includeDependencies) included.add(parent.id);
      if (included.has(parent.id)) relations.push(fk);
    }
  }

  return { tables: allProjectTables.filter(table => included.has(table.id)), relations, issues };
}

export function generateDatabaseDdl(
  allTables: DBTableSchema[],
  dialect: SqlDialect = 'postgres',
  allProjectTables: DBTableSchema[] = allTables
): string {
  return renderDatabaseDdl(resolveScopedRelations(allTables, allProjectTables), dialect);
}

export function renderDatabaseDdl(graph: ReturnType<typeof resolveScopedRelations>, dialect: SqlDialect): string {
  const allTables = graph.tables;
  const quote = (name: string) => sqlIdentifier(name, dialect);
  const singleLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
  const blocks: string[] = [];

  for (const tbl of allTables) {
    const columns = tbl.columns.map((c) => {
      const colType = mapColumnTypeForDialect(c.dataType, dialect);
      const defSql = dialect === 'postgres' ? postgresColumnDefaultSql(c) : columnDefaultSql(c);
      const maximum = dialect === 'postgres' && colType !== 'BOOLEAN' ? postgresIntegerType(c.dataType)?.maximum : undefined;
      const range = maximum ? ` CHECK (${quote(c.name)} BETWEEN 0 AND ${maximum})` : '';
      const base = `  ${quote(c.name)} ${colType} ${c.nullable ? 'NULL' : 'NOT NULL'}${c.isUnique ? ' UNIQUE' : ''}${defSql ? ` DEFAULT ${defSql}` : ''}${range}`;
      if (dialect === 'mysql' && c.comment.trim()) {
        return `${base} COMMENT '${escapeMysqlComment(c.comment)}'`;
      }
      return base;
    });

    const pk = tbl.columns.filter((c) => c.isPrimaryKey);
    if (pk.length) {
      columns.push(`  PRIMARY KEY (${pk.map((c) => quote(c.name)).join(', ')})`);
    }
    columns.push(...uniqueConstraintSql(tbl, dialect));

    const pending = tbl.modeling?.pendingRules?.length;
    const boundary = pending
      ? tr(
          `-- 注意：有 ${pending} 项业务规则需在应用服务层或触发器实现\n`,
          `-- Note: ${pending} business rule(s) must be enforced in the application service layer or triggers\n`
        )
      : '';
    const sharedMenus = tbl.sharedByMenus.map((m) => m.menuTitle).join(' | ');
    const header = tr(
      `${boundary}-- 表: ${tbl.tableName} (${singleLine(tbl.cnName)})${sharedMenus ? `\n-- 共表菜单: ${singleLine(sharedMenus)}` : ''}`,
      `${boundary}-- Table: ${tbl.tableName} (${singleLine(tbl.cnName)})${sharedMenus ? `\n-- Shared menus: ${singleLine(sharedMenus)}` : ''}`
    );
    const tableSuffix =
      dialect === 'mysql' && tbl.cnName.trim()
        ? ` COMMENT='${escapeMysqlComment(`${tbl.cnName}${tbl.description ? ` - ${tbl.description}` : ''}`)}'`
        : '';
    const createStmt = `${header}\nCREATE TABLE IF NOT EXISTS ${quote(tbl.tableName)} (\n${columns.join(',\n')}\n)${tableSuffix};`;

    if (dialect === 'postgres') {
      const commentStmts: string[] = [];
      const tblComment = singleLine(`${tbl.cnName}${tbl.description ? ` — ${tbl.description}` : ''}`);
      if (tblComment) {
        commentStmts.push(`COMMENT ON TABLE ${quote(tbl.tableName)} IS '${escapeSqlLiteral(tblComment)}';`);
      }
      for (const c of tbl.columns) {
        if (c.comment.trim()) {
          commentStmts.push(
            `COMMENT ON COLUMN ${quote(tbl.tableName)}.${quote(c.name)} IS '${escapeSqlLiteral(singleLine(c.comment))}';`
          );
        }
      }
      blocks.push(commentStmts.length ? `${createStmt}\n${commentStmts.join('\n')}` : createStmt);
    } else {
      blocks.push(createStmt);
    }
  }

  const tableNames = new Map(allTables.map(table => [table.id, quote(table.tableName)]));
  for (const fk of graph.relations) {
    const toTbl = tableNames.get(fk.toTableId)!;
    const fromTbl = tableNames.get(fk.fromTableId)!;
    blocks.push(
      `ALTER TABLE ${toTbl} ADD CONSTRAINT ${quote(fk.name)} FOREIGN KEY (${quote(fk.toColumnName)}) REFERENCES ${fromTbl} (${quote(fk.fromColumnName)})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ''};`
    );
  }
  for (const issue of graph.issues) {
    blocks.push(
      tr(`-- 待修复的外键引用：${singleLine(issue)}`, `-- Unresolved foreign key reference: ${singleLine(issue)}`)
    );
  }

  return blocks.join('\n\n');
}
