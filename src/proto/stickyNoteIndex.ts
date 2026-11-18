import type { StickyNoteRule } from '../store/useProtoStore';

export function validateStickyNoteIndex(index: unknown, label: string) {
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 1) {
    throw new Error(`${label} 的序号（index）必须是从 1 开始的安全整数`);
  }
}

/** Older project files could save index 0. On the private copy being opened,
 * fill only those display numbers, reserving all existing numbers on each page. */
export function migrateLegacyZeroStickyIndexes(notes: StickyNoteRule[]) {
  if (!notes.some(note => note.index === 0)) return;
  const pages = new Map<string, StickyNoteRule[]>();
  for (const note of notes) {
    const group = pages.get(note.pageId);
    if (group) group.push(note);
    else pages.set(note.pageId, [note]);
  }
  for (const group of pages.values()) {
    const occupied = new Set(group.map(note => note.index));
    let next = 1;
    for (const note of group) {
      if (note.index !== 0) continue;
      while (occupied.has(next)) next++;
      note.index = next++;
    }
  }
}
