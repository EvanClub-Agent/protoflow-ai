import type { DBColumnSchema, DBTableSchema } from '../../store/useProtoStore';

export function unquoteSqlLiteral(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const match = trimmed.match(/^['"](.+)['"]$/);
  return match ? match[1].trim() : undefined;
}

export function isEnumLikeColumn(col: DBColumnSchema): boolean {
  const n = col.name.toLowerCase();
  const c = col.comment || '';
  return (
    n.includes('status') ||
    n.includes('state') ||
    n.includes('stage') ||
    n.endsWith('_type') ||
    c.includes('状态') ||
    c.includes('类型') ||
    c.includes('阶段') ||
    /\b(?:status|state|stage)\b/i.test(c)
  );
}

/**
 * Parse explicit enum values declared in a column comment:
 * - Annotated: `pending(待审) / qualified(合格) / rejected(驳回)`
 * - Parenthesized: `(pending/approved/rejected)` or `（草稿 / 已提交验收 / 已入库）`
 * - Colon / bare list on enum-like columns: `状态: pending/approved/rejected` or `pending / approved / rejected`
 */
export function parseExplicitEnumPairs(
  comment: string,
  allowUnparenthesized = false,
): Array<{ value: string; zhHint?: string }> | null {
  if (!comment || !comment.includes('/')) return null;

  const annotatedRe = /([A-Za-z0-9_-]+)\s*[（(]([^()（）/]+)[)）]/g;
  const annotated: Array<{ value: string; zhHint?: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = annotatedRe.exec(comment)) !== null) {
    annotated.push({ value: m[1].trim(), zhHint: m[2].trim() });
  }
  if (annotated.length >= 2) return annotated;

  const parenMatch = comment.match(/[（(]([^()（）]*\/[^()（）]*)[)）]/);
  if (parenMatch && parenMatch[1]) {
    const tokens = parenMatch[1]
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length >= 2) {
      return tokens.map((value) => ({ value }));
    }
  }

  if (allowUnparenthesized) {
    const afterColon = comment.includes(':') || comment.includes('：')
      ? comment.split(/[:：]/).slice(1).join(':').trim()
      : comment
          .replace(/^(?:审批状态|单据状态|准入状态|流转状态|行状态|状态|类型|阶段|status|state|stage)\s*/i, '')
          .trim();
    if (afterColon.includes('/')) {
      const tokens = afterColon
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);
      const validTokens =
        tokens.length >= 2 &&
        tokens.length <= 10 &&
        tokens.every(
          (tok) =>
            tok.length >= 1 &&
            tok.length <= 24 &&
            !/[,，;；。!！?？]/.test(tok) &&
            /^(?:[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+){0,2}|[\u4e00-\u9fffA-Za-z0-9_-]+)$/.test(tok),
        );
      if (validTokens) {
        return tokens.map((value) => ({ value }));
      }
    }
  }

  return null;
}

export function isTextColumn(col: DBColumnSchema): boolean {
  return /^(?:(?:VAR)?CHAR|(?:TINY|MEDIUM|LONG)?TEXT|ENUM)\b/i.test(col.dataType.trim());
}

/** SQL ENUM literals are stored verbatim, including spaces and embedded commas.
 * An unparseable ENUM has no usable options until its schema is corrected. */
export function sqlEnumValues(col: DBColumnSchema): string[] | null {
  const type = col.dataType.trim();
  if (!/^ENUM\b/i.test(type)) return null;
  const declaration = /^ENUM\s*\(([\s\S]*)\)$/i.exec(type);
  if (!declaration) return [];
  const body = declaration[1];
  const literal = /\s*(?:'((?:''|\\.|[^'\\])*)'|"((?:""|\\.|[^"\\])*)")\s*(,|$)/gy;
  const result: string[] = [];
  while (literal.lastIndex < body.length) {
    const token = literal.exec(body);
    if (!token) return [];
    const value = token[1] !== undefined ? token[1].replace(/''/g, "'") : token[2].replace(/""/g, '"');
    result.push(value.replace(/\\(['"\\])/g, '$1'));
    if (!token[3]) return result;
  }
  return [];
}

export function declaredColumnOptions(col: DBColumnSchema): Array<{ value: string | number; zhHint?: string }> | null {
  const physical = sqlEnumValues(col);
  const enumLike = isEnumLikeColumn(col);
  if (physical !== null) {
    const hints = parseExplicitEnumPairs(col.comment || '', enumLike);
    return physical.map(value => ({ value, zhHint: hints?.find(item => item.value === value)?.zhHint }));
  }
  const integer = /^(?:(?:TINY|SMALL|MEDIUM|BIG)?INT|INTEGER)\b/i.test(col.dataType);
  if (!integer && !isTextColumn(col)) return null;
  const pairs = parseExplicitEnumPairs(col.comment || '', enumLike);
  if (!integer || !pairs) return pairs;
  if (!pairs.every(p => /^-?\d+$/.test(p.value) && Number.isSafeInteger(Number(p.value)))) return null;
  return pairs.map(p => ({ ...p, value: Number(p.value) }));
}

export function tableUsesChineseContract(table?: DBTableSchema, col?: DBColumnSchema): boolean {
  if (!table) return !col?.comment || /[\u4e00-\u9fff]/.test(col.comment);
  const texts = [
    table.cnName,
    table.description,
    ...table.columns.map((c) => c.comment),
    ...table.columns.map((c) => unquoteSqlLiteral(c.defaultValue) ?? ''),
  ].filter(Boolean);
  if (texts.some((t) => /[\u4e00-\u9fff]/.test(t))) return true;
  const nonIdentTexts = [
    table.cnName !== table.tableName ? table.cnName : '',
    table.description,
    ...table.columns.map((c) => c.comment),
  ].filter(Boolean);
  if (nonIdentTexts.some((t) => /[A-Za-z]{2,}/.test(t))) return false;
  return true;
}
