/** A display grouping declared by the project, reused verbatim across menus and exports. */
export function validateTableDomain(domain: unknown): asserts domain is string {
  if (typeof domain !== 'string' || !domain.length || domain.length > 80 || domain !== domain.trim() || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(domain)) {
    throw new Error('表的业务域需要 1 至 80 个字符的单行名称，首尾不能有空格');
  }
}
