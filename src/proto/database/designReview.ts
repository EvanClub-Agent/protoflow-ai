import { columnDefaultIssue } from './columnDefault';
import { resolveUniqueConstraints } from './uniqueConstraints';
import type { DBTableSchema } from '../../store/useProtoStore';
import { diagramRelations, type DiagramRelation } from './relations';

export const DATABASE_DESIGN_RULES = `项目级数据库建模规则（适用于整项目、逐页生成、单页对话及字段补全）
- 先读 protoflow_get_project 的全项目 dbTables、databaseDesignReview、菜单与 projectPlan，结合相关页面、便签和已有字段契约审查同一业务对象的全部读写方。整项目先在方案 summary 说明共享实体、行粒度及各页面的读写职责，再逐页实施；单页也要核对其他菜单及尚待实现的页面。
- 提交项目方案、新建/修改数据表，或处理涉及数据持久化、字段归属、唯一性与业务约束的页面需求时（包括核实后决定复用已有表而零建表），先调用 protoflow_review_db_requirements 不带参数读取宿主提供的用户原文和备选表依据（纯只读问答、闭环巡检扫描，或仅微调纯视觉排版/文案且不引入任何新业务数据规则时无需调用）。逐条核对各独立要求，再按每个 sourceId 提交完整 findings；quote 必须逐字取自原文。只把真正的界面或操作说明标为 outside。明确区分 declared、pending、clarify、gap，不可把字段存在当作复杂规则已实现。原文明确排除的内容用 excluded，须尊重范围。比如“本轮不建外键”只说明本轮范围，无明确需求不可推断后续需要外键、ON DELETE 行为或登记为 pendingRules。pendingRules 只记录用户已明确要求、当前模型无法落实的正向业务规则，不要将架构建议变成未来需求。一句话包含多项独立限制时拆成多条，可对同一原文分别引用各项依据。数据规则给出应允许和应拒绝的具体案例；凡涉及防重，在 allow/reject 中分别用 same、different 指明两行非空值按数据库比较相同、不同的准确本表字段 ID（含不同主键，以及相同或不同的状态）。条件唯一性待实现时也要检验草稿与生效两种情况。提交后核对遗留原文和案例冲突，修正后再结束本轮。
- 先判断是否需要持久化。纯布局、目录、筛选条件、仪表盘、报表和弹层本身不产生物理表。列表、录入、详情、审批及不同状态视图优先复用同一事实，通过 sharedByMenus 说明各自读写、过滤或引用的字段，保留其他菜单的映射。页面直接复用现有表或无需数据时，可以零建表。
- 新建物理表时必须填写 modeling.entity（业务实体或事件）、grain（一行唯一表示什么，含必要的时间或版本维度）、reason（比较过哪些现有或规划实体，为何需要独立保存）。同域同实体同粒度只声明一次。主数据、单据头、明细、关联、状态变更历史各自维护所属事实；只有明确的审计、历史快照或性能需求才保存副本，写明来源、冻结时点或更新责任。
- 从唯一性与业务生命周期确定主键和候选键，每个主键列都非空。多对多用有业务粒度的关联表，按需求用组合主键或唯一约束防重。外键用物理表名和列名，指向已声明的单列主键或 UNIQUE，沿用键类型；1:1 的引用列也必须唯一。同名字段、菜单关联与展示名称都不足以证明外键或租户归属。现有工具仅支持单列外键，不可拆开一个复合外键假装已实现。
- 保留代理主键时，业务去重可另外声明表级 uniqueConstraints，每项填写约束名 name 和有序的本表 columns[].id 列表 columnIds。例如同一标段、供应商、轮次只允许一份报价，应将三列一起声明；各列仍可单独重复。业务要求每行都防重时明确所有参与列非空。保留已有约束，只在明确要求移除时提交更新后的完整列表。
- 需求明确但当前模型无法完整表达的约束（例如复合外键、按状态生效的唯一性），必须在所属表 modeling.pendingRules 写明 rule（完整业务规则）和 reason（为什么当前 DDL 无法保证），随工程交付，不得声称已实现。不能用多条单列约束、放宽或收紧业务规则来凑出建表语句。后续更新保留待实现规则，确认解决或取消后才明确移除。业务语义不明时先澄清，不猜测。
- 在生成查询、列表或指标前逐跳核对连接键、方向、基数和结果粒度。一个订单的 2 条明细和 3 笔付款按订单直接并联会得到 6 行。独立的一对多分支要分别按目标粒度聚合后关联，或分开查询；多层明细不能直接累加上层金额。禁止无条件 JOIN、以 DISTINCT 掩盖重复计数，或为拼页面把多个粒度平铺进宽表。原型运行时不能表达的查询需说明口径和限制。
- 新增字段先核对归属和数据来源，展示名、关联带出值、派生指标及筛选项默认按读取需求处理。业务身份、关联基数、唯一范围或快照口径不清时，先向用户澄清并暂缓相关写入。回复中说明实际复用或新增的表、行粒度和需开发核实的风险。`;

type Review = { tableErrors: string[]; relationErrors: string[]; risks: string[] };

function comparableType(type: string) {
  // Preserve case and spaces inside SQL literals (e.g. ENUM values).
  return /['"]/.test(type) ? type.trim() : type.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1');
}

function relationRisks(relations: DiagramRelation[], byId: Map<string, DBTableSchema>, uniqueKeys: Map<string, Set<string>>) {
  const children = new Map<string, DiagramRelation[]>();
  for (const edge of relations) {
    const siblings = children.get(edge.fromTableId);
    if (siblings) siblings.push(edge);
    else children.set(edge.fromTableId, [edge]);
  }
  const name = (id: string) => byId.get(id)!.tableName;
  const isOne = (edge: DiagramRelation) => uniqueKeys.get(edge.toTableId)!.has(edge.toColumnId);
  // A 1:1 extension does not change the grain. Follow it to the first edge
  // that can multiply rows. Visit each extension once, including in cycles.
  const expansions = new Map<string, DiagramRelation[][]>();
  for (const root of children.keys()) {
    const paths: DiagramRelation[][] = [];
    const queue = [{id: root, path: [] as DiagramRelation[]}];
    const visited = new Set([root]);
    for (let i = 0; i < queue.length; i++) {
      const step = queue[i];
      for (const edge of children.get(step.id) ?? []) {
        const path = [...step.path, edge];
        if (!isOne(edge)) paths.push(path);
        else if (!visited.has(edge.toTableId)) {
          visited.add(edge.toTableId);
          queue.push({id: edge.toTableId, path});
        }
      }
    }
    expansions.set(root, paths);
  }
  const risks: string[] = [];
  for (const [root, paths] of expansions) {
    if (new Set(paths.map(path => path[0].id)).size > 1) {
      const branches = paths.map(path => path.map(e => `${name(e.toTableId)}.${e.toColumnName}`).join(' → ')).sort();
      risks.push(`${name(root)} 的多行分支 ${branches.join('、')} 若仅按父键同时连接，行数可能相乘。请分别按父键汇总或分别查询。`);
    }
    for (const [edge, ...rest] of paths) {
      if (rest.length || edge.toTableId === root) continue;
      for (const next of expansions.get(edge.toTableId) ?? []) {
        const chain = [root, edge.toTableId, ...next.map(e => e.toTableId)];
        if (new Set(chain).size === chain.length)
          risks.push(`${chain.map(name).join(' → ')} 存在多层明细，展开后上层记录可能重复。请按指标所属粒度汇总。`);
      }
    }
  }
  return [...new Set(risks)];
}

/** Inspect declared constraints only. Similar columns and join paths are evidence
 * for human review, never sufficient to merge tables or reject a valid schema. */
export function reviewDatabaseDesign(tables: DBTableSchema[], graph = diagramRelations(tables)): Review {
  const tableErrors: string[] = [], relationErrors: string[] = [], risks: string[] = [];
  const byId = new Map(tables.map(t => [t.id, t]));
  const physicalNames = new Map<string, string>();
  const grains = new Map<string, string>();
  const uniqueKeys = new Map<string, Set<string>>();
  const businessFields = new Map<DBTableSchema, Set<string>>();

  for (const table of tables) {
    const name = table.tableName;
    const previousId = physicalNames.get(name.toLowerCase());
    if (previousId !== undefined) tableErrors.push(`重复物理表名 ${name}（表 ID ${previousId}、${table.id}）。`);
    else physicalNames.set(name.toLowerCase(), table.id);
    const model = table.modeling;
    if (model) {
      for (const pending of model.pendingRules ?? [])
        risks.push(`${name} 未落实的业务规则：${pending.rule}。当前 DDL 无法保证：${pending.reason}`);
      const key = JSON.stringify([table.domain, model.entity.trim(), model.grain.trim()]);
      const previous = grains.get(key);
      if (previous) tableErrors.push(`${previous} 与 ${name} 重复声明业务实体「${model.entity}」和行粒度「${model.grain}」。请复用已有表，或核实并说明两表各自保存的独立事实。`);
      else grains.set(key, name);
    } else {
      risks.push(`${name} 尚未记录行粒度和建表依据，复用或扩表前需核对业务含义。`);
    }
    const pk = table.columns.filter(c => c.isPrimaryKey === true);
    const unique = new Set(table.columns.filter(c => c.isUnique === true).map(c => c.id));
    try {
      for (const key of resolveUniqueConstraints(table)) {
        if (key.columns.length === 1) unique.add(key.columns[0].id);
        const nullable = key.columns.filter(c => c.nullable);
        if (nullable.length) risks.push(`${name} 的唯一约束 ${key.name} 含可空字段 ${nullable.map(c => c.name).join('、')}。MySQL 允许含 NULL 的组合重复，请核实防重范围。`);
      }
    } catch (error) { tableErrors.push((error as Error).message); }
    if (pk.length === 1) unique.add(pk[0].id);
    uniqueKeys.set(table.id, unique);
    if (!pk.length) tableErrors.push(`${name} 缺少主键，请按行粒度声明非空主键。`);
    const names = new Map<string, string>();
    for (const col of table.columns) {
      const field = `${name}.${col.name}`;
      const defaultError = columnDefaultIssue(col);
      if (defaultError) tableErrors.push(`${field}：${defaultError}`);
      const previousCol = names.get(col.name.toLowerCase());
      if (previousCol !== undefined) tableErrors.push(`重复字段 ${field}（字段 ID ${previousCol}、${col.id}）。`);
      else names.set(col.name.toLowerCase(), col.id);
      if (!col.dataType.trim()) tableErrors.push(`${field} 缺少物理数据类型。`);
      if (col.isPrimaryKey && col.nullable) tableErrors.push(`${field} 是主键，必须非空。`);
      if ((col.references || col.foreignKeyOptions) && col.isForeignKey !== true)
        tableErrors.push(`${field} 已声明外键关系，须设置 isForeignKey=true。`);
      if (col.foreignKeyOptions?.cardinality === '1:1' && !unique.has(col.id))
        tableErrors.push(`${field} 声明 1:1，引用列需要单列主键或 UNIQUE 约束。`);
      if (col.foreignKeyOptions?.cardinality === '1:N' && unique.has(col.id))
        tableErrors.push(`${field} 有单列唯一约束，与 1:N 的声明不一致，请核对基数。`);
      if (col.foreignKeyOptions?.onDelete === 'SET NULL' && !col.nullable)
        tableErrors.push(`${field} 使用 SET NULL，字段必须允许空值。`);
    }
    const fields = new Set(table.columns.filter(c => !c.isPrimaryKey).map(c => c.name));
    for (const [other, otherFields] of businessFields) {
      const shared = [...fields].filter(field => otherFields.has(field));
      if (shared.length >= 2 && shared.length >= 0.75 * Math.max(fields.size, otherFields.size))
        risks.push(`${other.tableName} 与 ${name} 的非主键字段高度重合（${shared.sort().join('、')}）。请核对是否为同一事实的不同页面，或有独立的生命周期。`);
    }
    businessFields.set(table, fields);
  }

  const { relations, issues } = graph;
  relationErrors.push(...issues);
  for (const edge of relations) {
    const parent = byId.get(edge.fromTableId)!, child = byId.get(edge.toTableId)!;
    const target = parent.columns.find(c => c.name === edge.fromColumnName)!;
    const source = child.columns.find(c => c.id === edge.toColumnId)!;
    const path = `${child.tableName}.${source.name} → ${source.references}`;
    if (!uniqueKeys.get(parent.id)!.has(target.id))
      relationErrors.push(`${path} 的引用目标缺少单列唯一性依据，请核对主键或 UNIQUE 约束。`);
    if (comparableType(source.dataType) !== comparableType(target.dataType))
      relationErrors.push(`${path} 两端键类型声明不一致（${source.dataType} / ${target.dataType}），请核实后沿用同一类型。`);
  }
  risks.push(...relationRisks(relations, byId, uniqueKeys));
  return { tableErrors, relationErrors, risks };
}

/** Compare entire graphs so changing a parent key also checks untouched inbound FKs.
 * Unchanged historical findings stay visible without blocking unrelated work. */
export function reviewDatabaseChanges(before: DBTableSchema[], after: DBTableSchema[]) {
  const baseline = reviewDatabaseDesign(before);
  const current = reviewDatabaseDesign(after);
  for (const key of ['tableErrors', 'relationErrors', 'risks'] as const) {
    const existing = new Set(baseline[key]);
    current[key] = current[key].filter(issue => !existing.has(issue));
  }
  const existingTables = new Map(before.map(t => [t.id, t]));
  for (const table of after) {
    const previous = existingTables.get(table.id);
    if (previous?.modeling?.pendingRules?.length && table.modeling?.pendingRules === undefined)
      current.tableErrors.push(`${table.tableName} 更新时遗漏 modeling.pendingRules，请保留待实现规则或明确提交新的列表。`);
    if (previous?.uniqueConstraints?.length && table.uniqueConstraints === undefined)
      current.tableErrors.push(`${table.tableName} 更新时遗漏 uniqueConstraints，请保留原约束或明确提交新的约束列表。`);
    if (!table.modeling && (!previous || previous.modeling))
      current.tableErrors.push(`${table.tableName} 须提供 modeling.entity、grain、reason，说明业务实体、行粒度及独立建表依据。`);
  }
  // When a later menu introduces a new source, revisit rules on BOTH ends.
  // A new FK establishes structure only. Preserve earlier business/service obligations.
  const edges = (tables: DBTableSchema[]) => diagramRelations(tables).relations;
  const signature = (r: DiagramRelation) => JSON.stringify([r.toTableId,r.toColumnId,r.fromTableId,r.fromColumnName]);
  const beforeKeys = new Set(edges(before).map(signature));
  const addedEdges = edges(after).filter(r => !beforeKeys.has(signature(r)));
  const affectedRules = after.flatMap(t => {
    const newSources = addedEdges.filter(r => r.fromTableId === t.id || r.toTableId === t.id);
    const rules = existingTables.get(t.id)?.modeling?.pendingRules;
    return newSources.length && rules?.length ? [{tableId:t.id, pageIds:t.sharedByMenus.map(m => m.pageId), newSources, previousRules:rules}] : [];
  });
  for (const t of affectedRules) current.risks.push(`新增外键影响已有表 ${t.tableId}，请回查 ${t.previousRules.length} 条原规则的建表依据与服务边界。`);
  return {...current, affectedRules};
}
