import type { DBTableSchema } from '../../store/useProtoStore';

export type RequirementAudit = ReturnType<typeof reviewRequirementRecords>;
export interface RequirementSource { id: string; label: string; text: string; kind?: 'image' }
export interface RuleExample { description: string; same?: string[]; different?: string[] }
export interface RuleFinding {
  quote: string;
  state: 'declared' | 'pending' | 'clarify' | 'gap' | 'outside' | 'excluded';
  note: string;
  tableId?: string;
  basis?: string;
  allow?: RuleExample;
  reject?: RuleExample;
}
export interface RequirementRecord extends RequirementSource { findings: RuleFinding[] }
export interface RequirementSubmission { sourceId: string; findings: RuleFinding[] }

const nonblank = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
function validExample(example: RuleExample) {
  if (!example || !nonblank(example.description)) return false;
  for (const fields of [example.same, example.different])
    if (fields !== undefined && (!Array.isArray(fields) || !fields.every(nonblank))) return false;
  const ids = [...(example.same ?? []), ...(example.different ?? [])];
  return ids.length === new Set(ids).size;
}
export function validateRequirementRecords(value: unknown): asserts value is RequirementRecord[] {
  if (!Array.isArray(value)) throw new Error('需求核对记录必须为数组');
  const ids = new Set<string>();
  for (const r of value) {
    if (!r || ![r.id, r.label, r.text].every(nonblank) || ids.has(r.id) || !Array.isArray(r.findings))
      throw new Error('需求核对记录来源无效或重复');
    ids.add(r.id);
    if (r.kind !== undefined && (r.kind !== 'image' || r.findings.length))
      throw new Error('图片来源需要文字转录后才能逐字核对');
    for (const f of r.findings) {
      if (!f || !nonblank(f.quote) || !r.text.includes(f.quote) || r.text.indexOf(f.quote) !== r.text.lastIndexOf(f.quote))
        throw new Error('请逐字引用该来源中的唯一原文片段，重复短句请包含上下文');
      if (!['declared','pending','clarify','gap','outside','excluded'].includes(f.state) || !nonblank(f.note))
        throw new Error('需求核对缺少有效结论或依据');
      if ([f.tableId, f.basis].some(v => v !== undefined && !nonblank(v))) throw new Error('需求依据标识无效');
      if (['declared','pending'].includes(f.state) && !(nonblank(f.tableId) && nonblank(f.basis)))
        throw new Error('请引用候选表的准确 tableId 和 basis');
      if ([f.allow, f.reject].some(e => e !== undefined && !validExample(e))) throw new Error('正反例缺少描述或字段 ID 重复');
    }
  }
}

/** The host owns the sources. Hermes can annotate a passage, never replace its text. */
export function collectRequirementRecords(sources: RequirementSource[], submissions: RequirementSubmission[] = [], previous: RequirementRecord[] = []) {
  const records = new Map(sources.map(source => {
    const old = previous.find(r => r.id === source.id && r.text === source.text);
    return [source.id, { ...source, findings: old?.findings ?? [] }];
  }));
  for (const submission of submissions) {
    const record = records.get(submission.sourceId) ?? previous.find(r=>r.id===submission.sourceId);
    if (!record) throw new Error('需求核对引用了本轮未提供的来源');
    records.set(record.id, { ...record, findings: submission.findings });
  }
  const result = [...records.values()];
  validateRequirementRecords(result);
  return result;
}
export function mergeRequirementRecords(previous: RequirementRecord[], changes: RequirementRecord[]) {
  const records = new Map(previous.map(r => [r.id, r]));
  for (const r of changes) records.set(r.id, r);
  return [...records.values()];
}

export function requirementEvidence(table: DBTableSchema) {
  const evidence = new Map<string,string>();
  const primary = table.columns.filter(c => c.isPrimaryKey);
  if (primary.length) evidence.set('primary', `PRIMARY KEY (${primary.map(c=>c.name).join(', ')})`);
  for (const c of table.columns) {
    evidence.set('column:'+c.id, `${c.name} ${c.dataType}`);
    if (c.isUnique) evidence.set('uniqueColumn:'+c.id, `UNIQUE (${c.name})`);
    if (!c.nullable) evidence.set('required:'+c.id, `${c.name} NOT NULL`);
    if (c.isForeignKey && c.references) evidence.set('foreign:'+c.id, `${c.name} → ${c.references}`);
  }
  for (const key of table.uniqueConstraints ?? []) {
    const names = key.columnIds.map(id => table.columns.find(c=>c.id===id)?.name);
    if (names.every(nonblank)) evidence.set('unique:'+key.name, `${key.name} UNIQUE (${names.join(', ')})`);
  }
  for (const r of table.modeling?.pendingRules ?? []) evidence.set('pending:'+r.rule, r.reason);
  return evidence;
}

/** Compare two hypothetical rows with non-null values equal/different under the database's
 * own comparison semantics. Unspecified columns are unknown. This is a key check, not SQL execution. */
function compareKeys(table: DBTableSchema, example: RuleExample) {
  if (!example.same && !example.different) return;
  const same = new Set(example.same), different = new Set(example.different);
  if ([...same, ...different].some(id=>!table.columns.some(c=>c.id===id))) return;
  const keys = [
    { token:'primary', name:'PRIMARY KEY', ids:table.columns.filter(c=>c.isPrimaryKey).map(c=>c.id) },
    ...table.columns.filter(c=>c.isUnique).map(c=>({token:'uniqueColumn:'+c.id, name:`UNIQUE (${c.name})`, ids:[c.id]})),
    ...(table.uniqueConstraints ?? []).map(k=>({token:'unique:'+k.name, name:k.name, ids:k.columnIds})),
  ].filter(k=>k.ids.length);
  return keys.map(key=>({
    token: key.token,
    name: key.name,
    matches: key.ids.every(id=>same.has(id)) ? true : key.ids.some(id=>different.has(id)) ? false : undefined,
  }));
}

export function reviewRequirementRecords(records: RequirementRecord[], tables: DBTableSchema[]) {
  const lines: string[] = [], conflicts: string[] = [];
  let uncovered = 0;
  for (const record of records) {
    if (record.kind === 'image') {
      uncovered++;
      lines.push(`${record.label}「${record.text}」 · 图片内需求待转录或人工核对`);
      continue;
    }
    const ranges: [number,number][] = [];
    const emit = (quote:string, detail:string) => lines.push(`${record.label}「${quote}」 · ${detail}`);
    for (const finding of record.findings) {
      const start = record.text.indexOf(finding.quote);
      ranges.push([start, start + finding.quote.length]);
      const table = tables.find(t=>t.id===finding.tableId);
      const basis = table && finding.basis && requirementEvidence(table).get(finding.basis);
      const isPending = finding.basis?.startsWith('pending:') === true;
      const backed = basis && ((finding.state==='pending' && isPending) || (finding.state==='declared' && !isPending));
      const state = {declared:'结构依据', pending:'待实现', clarify:'待澄清', gap:'未覆盖', outside:'非数据库要求', excluded:'本轮明确排除'}[finding.state];
      const needsBasis = finding.state==='declared' || finding.state==='pending';
      let detail = needsBasis && !backed ? '未覆盖（找不到对应的结构或待实现记录）' : state;
      if (finding.state==='gap' || (needsBasis && !backed)) uncovered++;
      if (backed) detail += ` · ${table!.tableName} · ${basis}`;
      detail += ` · Hermes 说明：${finding.note}`;
      if (finding.state !== 'outside' && finding.state !== 'excluded') {
        for (const side of ['allow','reject'] as const) {
          const label = side==='allow' ? '应允许' : '应拒绝';
          const example = finding[side];
          if (!example) { detail += `\n${label} · 案例待补`; continue; }
          const keys = table && compareKeys(table, example);
          let verdict = '待验证';
          if (keys) {
            const collisions = keys.filter(k=>k.matches === true);
            const named = keys.find(k=>k.token === finding.basis);
            const allDifferent = keys.every(k=>k.matches === false);
            if (collisions.length) verdict = '被 '+collisions.map(k=>k.name).join('、')+' 拒绝';
            else if (allDifferent) verdict = '可通过已声明的唯一键';
            if (side==='reject' && finding.state==='declared' && named && collisions.length &&
                (named.matches!==true || collisions.length>1))
              verdict += '，不能单独验证所引业务键';
            if ((side==='allow' && collisions.length) ||
                (side==='reject' && finding.state==='declared' && named && allDifferent))
              conflicts.push(`${record.label}「${finding.quote}」：${label}「${example.description}」，实际${verdict}`);
          }
          detail += `\n${label} · ${example.description}（${verdict}）`;
        }
      }
      emit(finding.quote, detail);
    }
    let cursor = 0;
    const gap = (end:number) => {
      const quote = record.text.slice(cursor,end).trim();
      if (/[\p{L}\p{N}\p{S}]/u.test(quote)) {
        uncovered++;
        emit(quote,'未核对原文 · 尚无结构依据、待实现说明或澄清结论');
      }
    };
    for (const [start,end] of ranges.sort((a,b)=>a[0]-b[0])) {
      if (start > cursor) gap(start);
      cursor = Math.max(cursor,end);
    }
    gap(record.text.length);
  }
  return { lines, conflicts, uncovered };
}
