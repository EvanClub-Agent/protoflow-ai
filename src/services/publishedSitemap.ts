/** Reader-facing menu snapshot. Node IDs, page IDs and folder parents retain
 * their distinct meanings; archived placeholders explicitly have no page ID. */
export type PublishedMenuItem =
  | { id: string; title: string; type: 'folder'; deprecated: boolean; children: PublishedMenuItem[] }
  | { id: string; title: string; type: 'page' | 'doc'; deprecated: boolean; pageId: string | null };

export function publishedMenuIndex(items: PublishedMenuItem[]) {
  const byPage = new Map<string, { item: Exclude<PublishedMenuItem, { type: 'folder' }>; ancestors: string[] }>();
  const visit = (nodes: PublishedMenuItem[], ancestors: string[]) => {
    for (const item of nodes) {
      if (item.type === 'folder') visit(item.children, [...ancestors, item.id]);
      else if (item.pageId !== null) byPage.set(item.pageId, { item, ancestors });
    }
  };
  visit(items, []);
  return byPage;
}

export function validatePublishedSitemap(value: unknown, pages: { pageId: string; folderId: string }[]): asserts value is PublishedMenuItem[] {
  if (!Array.isArray(value)) throw new Error('发布内容必须包含完整菜单目录');
  const nodeIds = new Set<string>(), pageIds = new Set<string>();
  const pageMap = new Map(pages.map(page => [page.pageId, page]));
  const visit = (items: unknown[], parent: string | null, depth: number) => {
    if (depth > 40) throw new Error('发布菜单目录层级过深');
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('发布菜单节点无效');
      const n = item as Record<string, unknown>;
      if (typeof n.id !== 'string' || !n.id.trim() || nodeIds.has(n.id) || typeof n.title !== 'string' || !n.title.trim() || typeof n.deprecated !== 'boolean') throw new Error('发布菜单标识、名称或归档状态无效');
      nodeIds.add(n.id);
      if (nodeIds.size > 2000) throw new Error('发布菜单数量过多');
      if (n.type === 'folder') {
        if (!Array.isArray(n.children) || 'pageId' in n) throw new Error('发布菜单目录子节点无效');
        visit(n.children, n.id, depth + 1);
      } else if (n.type === 'doc' || n.type === 'page') {
        if ('children' in n) throw new Error('文档或页面不能包含菜单子节点');
        if (n.pageId === null && n.type === 'page' && n.deprecated) continue;
        if (typeof n.pageId !== 'string' || !n.pageId.trim() || pageIds.has(n.pageId)) throw new Error('菜单页面标识缺失或重复');
        pageIds.add(n.pageId);
        const page = pageMap.get(n.pageId);
        if (page && (n.type !== 'page' || page.folderId !== parent)) throw new Error('发布页面与菜单所属目录不一致');
      } else throw new Error('发布菜单类型无效');
    }
  };
  visit(value, null, 0);
  if (pages.some(page => !pageIds.has(page.pageId))) throw new Error('发布页面缺少对应的菜单项');
}
