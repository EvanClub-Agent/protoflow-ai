import type { DBTableSchema } from '../../store/useProtoStore';
import type { Row } from '../runtime/mock';
import { materialOptions, type MaterialOption } from '../registry/antdOptions';

/** A bound picker reads only the declared columns; row.id is a separate record identity. */
export function mobileOptions(
  options: unknown,
  binding?: { table: DBTableSchema | undefined; rows: Row[]; labelField: unknown; valueField: unknown },
): { options: MaterialOption[]; issue?: string } {
  try {
    if (!binding) return { options: materialOptions(options) };
    const { table, rows, labelField, valueField } = binding;
    if (!table) throw new Error('选项来源表不存在');
    if (typeof labelField !== 'string' || typeof valueField !== 'string' ||
        ![labelField, valueField].every(field => table.columns.some(c => c.name === field))) {
      throw new Error('请选择来源表中的显示字段和存储字段');
    }
    const scalar = (value: unknown): value is string | number =>
      (typeof value === 'string' && value.trim().length > 0) || (typeof value === 'number' && Number.isFinite(value));
    return { options: materialOptions(rows.map(row => {
      const label = row[labelField], value = row[valueField];
      if (!scalar(label) || !scalar(value)) throw new Error(`来源记录 ${row.id} 缺少有效的 ${String(labelField)} 或 ${String(valueField)}`);
      return { label: String(label), value };
    })) };
  } catch (error) {
    return { options: [], issue: error instanceof Error ? error.message : String(error) };
  }
}
