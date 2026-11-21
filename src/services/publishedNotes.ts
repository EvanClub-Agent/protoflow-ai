import { useProtoStore } from '../store/useProtoStore';
import { tr } from '../i18n/runtime';
import { usePageStore } from '../proto/store/usePageStore';
import { NOTE_ASSET_SCHEME, relatedPagesResolver, type NoteAsset } from '../proto/notes';
import { sanitizeNoteHtml } from '../proto/noteHtmlSanitize';
import type { PublishedNote } from './publishedSnapshot';

/** Notes plus images must leave room for pages and data within the 20 MB share request. */
export const PUBLISHED_NOTES_BUDGET = 12 * 1024 * 1024;

/** Notes the PM explicitly marked shareable, in a stable order (pinned first, then recent). */
export function shareableNotes() {
  return useProtoStore
    .getState()
    .projectNotes.nodes.filter((node) => node.kind === 'note' && node.shareable === true)
    .map((node) => node as Extract<typeof node, { kind: 'note' }>)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * Builds the read-only note DTO for an online share. Only opt-in notes are included; HTML is
 * allow-list sanitized, links to unpublished pages become plain text, and only the images those
 * notes reference are attached. Stakeholders and tags are internal and never published.
 */
export function publishableNotes(publishedPageIds: Set<string>): {
  notes: PublishedNote[];
  noteAssets: Record<string, NoteAsset>;
} {
  const data = useProtoStore.getState().projectNotes;
  const selected = shareableNotes();
  if (!selected.length) return { notes: [], noteAssets: {} };
  const resolve = relatedPagesResolver(data, usePageStore.getState());
  const noteAssets: Record<string, NoteAsset> = {};
  const notes = selected.map((node) => {
    const html = sanitizeNoteHtml(node.content, {
      resolveImage: (src) => {
        if (!src.startsWith(NOTE_ASSET_SCHEME)) return null;
        const id = src.slice(NOTE_ASSET_SCHEME.length);
        const asset = data.assets?.[id];
        if (!asset) return null;
        noteAssets[id] = { mime: asset.mime, data: asset.data };
        return src;
      },
      keepPageLink: (pageId) => publishedPageIds.has(pageId),
    });
    const note: PublishedNote = {
      noteId: node.id,
      title: node.title,
      icon: node.icon,
      status: node.status ?? 'draft',
      ...(node.priority ? { priority: node.priority } : {}),
      ...(node.meetingDate ? { meetingDate: node.meetingDate } : {}),
      updatedAt: node.updatedAt,
      html,
      pageIds: resolve(node.id).relatedPageIds.filter((id) => publishedPageIds.has(id)),
    };
    return note;
  });
  const size =
    notes.reduce((n, note) => n + note.html.length, 0) +
    Object.values(noteAssets).reduce((n, asset) => n + asset.data.length, 0);
  if (size > PUBLISHED_NOTES_BUDGET) {
    throw new Error(tr('外发笔记（含图片）超过 12 MB，请减少外发笔记或压缩其中的截图后再发布', 'Shared notes (including images) exceed 12 MB; reduce shared notes or compress screenshots before publishing'));
  }
  return { notes, noteAssets };
}
