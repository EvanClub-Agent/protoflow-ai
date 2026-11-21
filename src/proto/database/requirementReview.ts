import type { DBTableSchema } from '../../store/useProtoStore';
import { tr } from '../../i18n/runtime';

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
  if (!Array.isArray(value)) throw new Error(tr('需求核对记录必须为数组', 'Requirement records must be an array'));
  const ids = new Set<string>();
  for (const r of value) {
    if (!r || ![r.id, r.label, r.text].every(nonblank) || ids.has(r.id) || !Array.isArray(r.findings))
      throw new Error(tr('需求核对记录来源无效或重复', 'Invalid or duplicate requirement record source'));
    ids.add(r.id);
    if (r.kind !== undefined && (r.kind !== 'image' || r.findings.length))
      throw new Error(tr('图片来源需要文字转录后才能逐字核对', 'Image requirement sources require text transcription before verbatim review'));
    for (const f of r.findings) {
      if (!f || !nonblank(f.quote) || !r.text.includes(f.quote) || r.text.indexOf(f.quote) !== r.text.lastIndexOf(f.quote))
        throw new Error(tr('请逐字引用该来源中的唯一原文片段，重复短句请包含上下文', 'Quote a unique verbatim passage from the source; include surrounding context if a short phrase repeats'));
      if (!['declared','pending','clarify','gap','outside','excluded'].includes(f.state) || !nonblank(f.note))
        throw new Error(tr('需求核对缺少有效结论或依据', 'Requirement finding is missing a valid state or note'));
      if ([f.tableId, f.basis].some(v => v !== undefined && !nonblank(v))) throw new Error(tr('需求依据标识无效', 'Invalid tableId or basis on requirement finding'));
      if (['declared','pending'].includes(f.state) && !(nonblank(f.tableId) && nonblank(f.basis)))
        throw new Error(tr('请引用候选表的准确 tableId 和 basis', 'Reference an exact tableId and basis on the candidate table'));
      if ([f.allow, f.reject].some(e => e !== undefined && !validExample(e))) throw new Error(tr('正反例缺少描述或字段 ID 重复', 'Allow/reject example is missing a description or has duplicate column IDs'));
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
    if (!record) throw new Error(tr('需求核对引用了本轮未提供的来源', 'Requirement submission references a source not provided in this turn'));
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
      lines.push(tr(
        `${record.label}「${record.text}」 · 图片内需求待转录或人工核对`,
        `${record.label} "${record.text}" · Image requirements pending transcription or manual verification`,
      ));
      continue;
    }
    const ranges: [number,number][] = [];
    const emit = (quote:string, detail:string) => lines.push(tr(`${record.label}「${quote}」 · ${detail}`, `${record.label} "${quote}" · ${detail}`));
    for (const finding of record.findings) {
      const start = record.text.indexOf(finding.quote);
      ranges.push([start, start + finding.quote.length]);
      const table = tables.find(t=>t.id===finding.tableId);
      const basis = table && finding.basis && requirementEvidence(table).get(finding.basis);
      const isPending = finding.basis?.startsWith('pending:') === true;
      const backed = basis && ((finding.state==='pending' && isPending) || (finding.state==='declared' && !isPending));
      const state = {
        declared: tr('结构依据', 'Schema-backed'),
        pending: tr('待实现', 'Pending rule'),
        clarify: tr('待澄清', 'Needs clarification'),
        gap: tr('未覆盖', 'Uncovered'),
        outside: tr('非数据库要求', 'Non-DB UI/flow'),
        excluded: tr('本轮明确排除', 'Explicitly excluded'),
      }[finding.state];
      const needsBasis = finding.state==='declared' || finding.state==='pending';
      let detail = needsBasis && !backed ? tr('未覆盖（找不到对应的结构或待实现记录）', 'Uncovered (matching schema constraint or pending rule not found)') : state;
      if (finding.state==='gap' || (needsBasis && !backed)) uncovered++;
      if (backed) detail += ` · ${table!.tableName} · ${basis}`;
      detail += tr(` · Hermes 说明：${finding.note}`, ` · Hermes note: ${finding.note}`);
      if (finding.state !== 'outside' && finding.state !== 'excluded') {
        for (const side of ['allow','reject'] as const) {
          const label = side==='allow' ? tr('应允许', 'Should allow') : tr('应拒绝', 'Should reject');
          const example = finding[side];
          if (!example) { detail += `\n${label} · ${tr('案例待补', 'Example missing')}`; continue; }
          const keys = table && compareKeys(table, example);
          let verdict = tr('待验证', 'Pending verification');
          if (keys) {
            const collisions = keys.filter(k=>k.matches === true);
            const named = keys.find(k=>k.token === finding.basis);
            const allDifferent = keys.every(k=>k.matches === false);
            if (collisions.length) verdict = tr('被 '+collisions.map(k=>k.name).join('、')+' 拒绝', 'Rejected by '+collisions.map(k=>k.name).join(', '));
            else if (allDifferent) verdict = tr('可通过已声明的唯一键', 'Passes declared unique keys');
            if (side==='reject' && finding.state==='declared' && named && collisions.length &&
                (named.matches!==true || collisions.length>1))
              verdict += tr('，不能单独验证所引业务键', '; cannot isolate the referenced business key');
            if ((side==='allow' && collisions.length) ||
                (side==='reject' && finding.state==='declared' && named && allDifferent))
              conflicts.push(tr(
                `${record.label}「${finding.quote}」：${label}「${example.description}」，实际${verdict}`,
                `${record.label} "${finding.quote}": ${label} "${example.description}", actual: ${verdict}`,
              ));
          }
          detail += tr(`\n${label} · ${example.description}（${verdict}）`, `\n${label} · ${example.description} (${verdict})`);
        }
      }
      emit(finding.quote, detail);
    }
    let cursor = 0;
    const gap = (end:number) => {
      const quote = record.text.slice(cursor,end).trim();
      if (/[\p{L}\p{N}\p{S}]/u.test(quote)) {
        uncovered++;
        emit(quote, tr('未核对原文 · 尚无结构依据、待实现说明或澄清结论', 'Unreviewed passage · No schema basis, pending rule, or clarification yet'));
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
