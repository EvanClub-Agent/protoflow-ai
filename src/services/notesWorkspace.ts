import { useProtoStore } from '../store/useProtoStore';
import { tr } from '../i18n/runtime';
import { usePageStore } from '../proto/store/usePageStore';
import { pageRefKey } from '../proto/mindmaps';
import {
  NOTE_ASSET_SCHEME,
  addNoteAsset,
  extractInlineNoteImages,
  markdownToNoteHtml,
  noteDescendants,
  parseImageDataUrl,
  pruneStaleNoteLinks,
  toggleNoteTaskAtIndex,
  uniqueNoteTitle,
  validateNoteLinks,
  validateNoteNodes,
  type NoteCoverId,
  type NoteNode,
  type NotePageRef,
  type NotePriority,
  type NoteRequirementStatus,
  type NoteWorkspace,
} from '../proto/notes';
import { newId } from '../utils/identity';
import { groupStickiesByPage, sitemapPageOrder, stickySummaryHtml } from '../proto/notesStickies';

function current(projectId: string) {
  const state = useProtoStore.getState();
  if (state.isProjectClosed || state.currentProjectMeta.projectId !== projectId) {
    throw new Error(tr('当前项目已变化', 'Current project has changed'));
  }
  return state;
}

function commit(
  projectId: string,
  projectNotes: NoteWorkspace,
  selectedNoteNodeId = current(projectId).selectedNoteNodeId,
  { validateLinks = false }: { validateLinks?: boolean } = {}
) {
  current(projectId);
  // Body/metadata edits happen on every keystroke: validate only the node tree here.
  // Link edits additionally validate against the sitemap.
  validateNoteNodes(projectNotes);
  if (validateLinks) validateNoteLinks(projectNotes, usePageStore.getState());
  if (
    selectedNoteNodeId !== null &&
    !projectNotes.nodes.some((node) => node.id === selectedNoteNodeId)
  ) {
    throw new Error(tr('选择的笔记节点不存在', 'Selected note node does not exist'));
  }
  useProtoStore.setState({ projectNotes, selectedNoteNodeId });
}

export interface CreateNoteOptions {
  icon?: string;
  content?: string;
  tags?: string[];
  cover?: NoteCoverId;
  pinned?: boolean;
  status?: NoteRequirementStatus;
  priority?: NotePriority;
  stakeholder?: string;
  meetingDate?: string;
}

export function createNoteNode(
  projectId: string,
  kind: NoteNode['kind'],
  title: string,
  parentId: string | null,
  options?: CreateNoteOptions
): string {
  const state = current(projectId);
  const id = newId('note');
  const now = new Date().toISOString();
  const cleanTitle = title.trim();
  const extracted = extractInlineNoteImages(options?.content ?? '<p></p>', state.projectNotes.assets);
  const node: NoteNode =
    kind === 'folder'
      ? {
          id,
          kind: 'folder',
          title: cleanTitle,
          parentId,
          icon: options?.icon?.trim() || '📁',
          updatedAt: now,
        }
      : {
          id,
          kind: 'note',
          title: cleanTitle,
          parentId,
          icon: options?.icon?.trim() || '📝',
          updatedAt: now,
          content: extracted.html,
          tags: options?.tags ? [...options.tags] : [],
          cover: options?.cover ?? 'none',
          pinned: options?.pinned ?? false,
          ...(options?.status ? { status: options.status } : { status: 'draft' }),
          ...(options?.priority ? { priority: options.priority } : {}),
          ...(options?.stakeholder ? { stakeholder: options.stakeholder } : {}),
          ...(options?.meetingDate ? { meetingDate: options.meetingDate } : { meetingDate: now.slice(0, 10) }),
        };
  commit(
    projectId,
    {
      ...state.projectNotes,
      ...(kind === 'note' && extracted.assets ? { assets: extracted.assets } : {}),
      nodes: [...state.projectNotes.nodes, node],
    },
    id
  );
  return id;
}

export function editNoteNode(
  projectId: string,
  nodeId: string,
  title: string,
  parentId: string | null,
  icon?: string
) {
  const { projectNotes } = current(projectId);
  if (!projectNotes.nodes.some((node) => node.id === nodeId)) {
    throw new Error(tr('笔记节点不存在', 'Note node does not exist'));
  }
  const now = new Date().toISOString();
  commit(projectId, {
    ...projectNotes,
    nodes: projectNotes.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            title: title.trim(),
            parentId,
            icon: icon?.trim() ? icon.trim() : node.icon,
            updatedAt: now,
          }
        : node
    ),
  });
}

export function updateNoteContent(projectId: string, noteId: string, content: string) {
  const { projectNotes } = current(projectId);
  const existing = projectNotes.nodes.find((node) => node.id === noteId);
  if (!existing || existing.kind !== 'note') {
    throw new Error(tr('笔记不存在', 'Note does not exist'));
  }
  // Inline data-URL images (pasted HTML, legacy notes) are moved into the asset table.
  const extracted = extractInlineNoteImages(content, projectNotes.assets);
  if (existing.content === extracted.html) return;
  const now = new Date().toISOString();
  commit(projectId, {
    ...projectNotes,
    ...(extracted.assets ? { assets: extracted.assets } : {}),
    nodes: projectNotes.nodes.map((node) =>
      node.id === noteId && node.kind === 'note'
        ? { ...node, content: extracted.html, updatedAt: now }
        : node
    ),
  });
}

/** Stores an image once in the project and returns the `src` to put on the image node. */
export function registerNoteImage(projectId: string, dataUrl: string, name?: string): string {
  const { projectNotes } = current(projectId);
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) throw new Error(tr('仅支持 PNG、JPG、WebP 或 GIF 图片', 'Only PNG, JPG, WebP, or GIF images are supported'));
  const added = addNoteAsset(projectNotes.assets, { ...parsed, name });
  if (added.assets !== projectNotes.assets) {
    commit(projectId, { ...projectNotes, assets: added.assets });
  }
  return `${NOTE_ASSET_SCHEME}${added.id}`;
}

export interface NoteMetaPatch {
  title?: string;
  icon?: string;
  tags?: string[];
  cover?: NoteCoverId;
  pinned?: boolean;
  /** For the optional fields below, an explicit `undefined` (or empty string) clears the value. */
  status?: NoteRequirementStatus;
  priority?: NotePriority;
  stakeholder?: string;
  meetingDate?: string;
  /** Allow this note to be published to viewer links (false/undefined = private). */
  shareable?: boolean;
}

export function updateNoteMeta(projectId: string, noteId: string, patch: NoteMetaPatch) {
  const { projectNotes } = current(projectId);
  const existing = projectNotes.nodes.find((node) => node.id === noteId);
  if (!existing || existing.kind !== 'note') {
    throw new Error(tr('笔记不存在', 'Note does not exist'));
  }
  const next: Extract<NoteNode, { kind: 'note' }> = { ...existing, updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.icon !== undefined && patch.icon.trim()) next.icon = patch.icon.trim();
  if (patch.tags !== undefined) next.tags = [...patch.tags];
  if (patch.cover !== undefined) next.cover = patch.cover;
  if (patch.pinned !== undefined) next.pinned = patch.pinned;
  if ('status' in patch) {
    if (patch.status) next.status = patch.status;
    else delete next.status;
  }
  if ('priority' in patch) {
    if (patch.priority) next.priority = patch.priority;
    else delete next.priority;
  }
  if ('stakeholder' in patch) {
    const value = patch.stakeholder?.trim();
    if (value) next.stakeholder = value;
    else delete next.stakeholder;
  }
  if ('meetingDate' in patch) {
    if (patch.meetingDate) next.meetingDate = patch.meetingDate;
    else delete next.meetingDate;
  }
  if ('shareable' in patch) {
    if (patch.shareable) next.shareable = true;
    else delete next.shareable;
  }
  commit(projectId, {
    ...projectNotes,
    nodes: projectNotes.nodes.map((node) => (node.id === noteId ? next : node)),
  });
}

export function toggleNoteTask(projectId: string, noteId: string, taskIndex: number) {
  const { projectNotes } = current(projectId);
  const existing = projectNotes.nodes.find((node) => node.id === noteId);
  if (!existing || existing.kind !== 'note') {
    throw new Error(tr('笔记不存在', 'Note does not exist'));
  }
  const nextHtml = toggleNoteTaskAtIndex(existing.content, taskIndex);
  updateNoteContent(projectId, noteId, nextHtml);
}

export function duplicateNoteNode(projectId: string, noteId: string): string {
  const { projectNotes } = current(projectId);
  const source = projectNotes.nodes.find((node) => node.id === noteId);
  if (!source || source.kind !== 'note') {
    throw new Error(tr('只能复制单篇笔记', 'Only individual notes can be duplicated'));
  }
  const copyTitle = uniqueNoteTitle(
    projectNotes,
    source.parentId,
    tr(`${source.title} (副本)`, `${source.title} (Copy)`),
    (_b, n) => tr(`${source.title} (副本 ${n})`, `${source.title} (Copy ${n})`)
  );
  return createNoteNode(projectId, 'note', copyTitle, source.parentId, {
    icon: source.icon,
    content: source.content,
    tags: source.tags,
    cover: source.cover,
    pinned: false,
  });
}

export function deleteNoteNode(projectId: string, nodeId: string) {
  const state = current(projectId);
  const removed = noteDescendants(state.projectNotes, nodeId);
  // AI transactions neither read nor write notes (they are outside projectRevision),
  // so deleting a note while AI is running is safe.
  const target = state.projectNotes.nodes.find((node) => node.id === nodeId)!;
  const remainingNodes = state.projectNotes.nodes.filter((node) => !removed.has(node.id));
  let nextSelected = state.selectedNoteNodeId;
  if (nextSelected !== null && removed.has(nextSelected)) {
    const firstNote =
      remainingNodes.find((n) => n.parentId === target.parentId && n.kind === 'note') ??
      remainingNodes.find((n) => n.kind === 'note') ??
      remainingNodes.find((n) => n.id === target.parentId) ??
      null;
    nextSelected = firstNote ? firstNote.id : null;
  }
  if (state.dockedNoteId && removed.has(state.dockedNoteId)) {
    useProtoStore.setState({ dockedNoteId: null });
  }
  commit(
    projectId,
    {
      ...state.projectNotes,
      nodes: remainingNodes,
      links: state.projectNotes.links.filter((link) => !removed.has(link.targetNodeId)),
    },
    nextSelected
  );
}

/** Multiple links per page/directory are allowed; update only the explicit source. */
export function setPageNoteLinks(
  projectId: string,
  page: NotePageRef,
  targetNodeIds: string[]
) {
  const projectNotes = pruneStaleNoteLinks(current(projectId).projectNotes, usePageStore.getState());
  const links = projectNotes.links.filter(
    (link) => pageRefKey(link.page) !== pageRefKey(page)
  );
  commit(
    projectId,
    {
      ...projectNotes,
      links: [...links, ...targetNodeIds.map((targetNodeId) => ({ page, targetNodeId }))],
    },
    undefined,
    { validateLinks: true }
  );
}

/** Links a note to one more page, keeping the page's other note links. */
export function addPageNoteLink(projectId: string, pageId: string, targetNodeId: string) {
  const { projectNotes } = current(projectId);
  const existing = projectNotes.links
    .filter((link) => link.page.kind === 'page' && link.page.pageId === pageId)
    .map((link) => link.targetNodeId);
  if (existing.includes(targetNodeId)) return;
  setPageNoteLinks(projectId, { kind: 'page', pageId }, [...existing, targetNodeId]);
}

export function setNoteTargetLinks(
  projectId: string,
  targetNodeId: string,
  pages: NotePageRef[]
) {
  const projectNotes = pruneStaleNoteLinks(current(projectId).projectNotes, usePageStore.getState());
  const links = projectNotes.links.filter((link) => link.targetNodeId !== targetNodeId);
  commit(
    projectId,
    {
      ...projectNotes,
      links: [...links, ...pages.map((page) => ({ page, targetNodeId }))],
    },
    undefined,
    { validateLinks: true }
  );
}

export function openNoteNode(projectId: string, nodeId: string) {
  const state = current(projectId);
  if (!state.projectNotes.nodes.some((node) => node.id === nodeId)) {
    throw new Error(tr('笔记节点不存在', 'Note node does not exist'));
  }
  useProtoStore.setState({ selectedNoteNodeId: nodeId, viewMode: 'notes' });
}

export function importMarkdownAsNote(
  projectId: string,
  fileName: string,
  markdownText: string,
  parentId: string | null
): string {
  const state = current(projectId);
  const parsed = markdownToNoteHtml(markdownText);
  const finalTitle = uniqueNoteTitle(
    state.projectNotes,
    parentId,
    parsed.title || fileName.replace(/\.(md|markdown|txt)$/i, '').trim() || tr('导入的需求笔记', 'Imported Requirement Note')
  );
  return createNoteNode(projectId, 'note', finalTitle, parentId, {
    icon: '📄',
    content: parsed.html,
    tags: [tr('客户沟通', 'Stakeholder')],
    cover: 'ocean',
  });
}

const localToday = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/**
 * Creates a review checklist note from the canvas stickies of the given pages (all pages with
 * stickies when omitted) and links the note to those pages.
 */
export function createStickyReviewNote(
  projectId: string,
  { pageIds, onlyActive = true }: { pageIds?: string[]; onlyActive?: boolean } = {}
): string {
  const state = current(projectId);
  const groups = groupStickiesByPage(state.stickyNotes, sitemapPageOrder(usePageStore.getState()), {
    pageIds,
    onlyActive,
  });
  if (!groups.length) throw new Error(onlyActive ? tr('所选页面没有启用中的画布批注', 'No active canvas sticky notes on selected pages') : tr('所选页面没有画布批注', 'No canvas sticky notes on selected pages'));
  const today = localToday();
  const id = createNoteNode(projectId, 'note', uniqueNoteTitle(state.projectNotes, null, tr(`评审修改清单 ${today}`, `Review Checklist ${today}`)), null, {
    icon: '📋',
    tags: [tr('原型评审', 'Prototype Review')],
    status: 'draft',
    meetingDate: today,
    content: tr(
      `<blockquote><p>由画布批注自动汇总生成。补充结论后可导出或发给客户确认；勾选的待办会同步到全局待办。</p></blockquote>${stickySummaryHtml(groups)}`,
      `<blockquote><p>Automatically compiled from canvas sticky notes. Add review conclusions to export or share with stakeholders; task items sync to Global Action Items.</p></blockquote>${stickySummaryHtml(groups)}`,
    ),
  });
  for (const group of groups) {
    try {
      addPageNoteLink(projectId, group.pageId, id);
    } catch {
      /* stickies on pages that left the sitemap are summarised but not linked */
    }
  }
  return id;
}
