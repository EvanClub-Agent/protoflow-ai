import type { DBTableSchema } from '../../store/useProtoStore';
import { canonicalJson } from '../../services/dependencyFootprint';

/** Migration may extend an existing shared model. Other pages still rely on
 * its physical names, columns, declared constraints and menu bindings. */
export function checkRpTableExtension(previous:DBTableSchema | undefined, candidate:DBTableSchema) {
  if (!previous) return;
  function retains<T>(existing:readonly T[] = [], proposed:readonly T[] = []) {
    const values = new Set(proposed.map(canonicalJson));
    return existing.every(item => values.has(canonicalJson(item)));
  }
  if (previous.tableName !== candidate.tableName || !retains(previous.columns,candidate.columns) ||
      !retains(previous.uniqueConstraints,candidate.uniqueConstraints) || !retains(previous.sharedByMenus,candidate.sharedByMenus) ||
      !retains(previous.modeling?.pendingRules,candidate.modeling?.pendingRules) ||
      (previous.modeling && (previous.modeling.entity !== candidate.modeling?.entity || previous.modeling.grain !== candidate.modeling.grain)))
    throw new Error(`RP 迁移只能补充已有表 ${previous.tableName}。请保留原有字段、实体粒度、约束和菜单关联，再提交新增内容。`);
}
