/** The DSL header consists only of consecutive line comments before the page. */
export function readPageHeader(source: string): string[] {
  const header: string[] = [];
  let start = 0;
  while (start < source.length) {
    const end = source.indexOf('\n', start);
    const line = source.slice(start, end < 0 ? source.length : end).trim();
    if (!line.startsWith('//')) break;
    header.push(line);
    if (end < 0) break;
    start = end + 1;
  }
  return header;
}
