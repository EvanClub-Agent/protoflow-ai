export interface MaterialOption {
  label: string;
  value: string | number;
  disabled?: boolean;
  children?: MaterialOption[];
}

/** Legacy string options explicitly use the same text for label and value. */
export function materialOptions(input: unknown, tree = false): MaterialOption[] {
  if (input === undefined) return [];
  const source = typeof input === 'string' && !tree
    ? input.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    : input;
  if (!Array.isArray(source)) throw new Error('选项必须是数组');
  const seen = new Set<string | number>();
  const parse = (items: unknown[], path: string): MaterialOption[] => items.map((item, index) => {
    const at = `${path}[${index}]`;
    if (!tree && (typeof item === 'string' || typeof item === 'number')) {
      if (seen.has(item)) throw new Error(`${at} 的 value 重复`);
      seen.add(item);
      return { label: String(item), value: item };
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${at} 必须是选项对象`);
    const record = item as Record<string, unknown>;
    if (typeof record.label !== 'string') throw new Error(`${at} 缺少字符串 label`);
    if (typeof record.value !== 'string' && typeof record.value !== 'number') throw new Error(`${at} 缺少明确的 value（字符串或数字）`);
    if (seen.has(record.value)) throw new Error(`${at} 的 value 重复`);
    seen.add(record.value);
    if (record.disabled !== undefined && typeof record.disabled !== 'boolean') throw new Error(`${at}.disabled 必须是布尔值`);
    if (record.children !== undefined && (!tree || !Array.isArray(record.children))) throw new Error(`${at}.children 必须是树形选项数组`);
    return {
      label: record.label,
      value: record.value,
      ...(record.disabled !== undefined ? { disabled: record.disabled as boolean } : {}),
      ...(Array.isArray(record.children) ? { children: parse(record.children, `${at}.children`) } : {}),
    };
  });
  return parse(source, 'options');
}
