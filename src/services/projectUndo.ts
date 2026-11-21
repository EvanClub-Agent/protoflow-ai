import { tr } from '../i18n/runtime';

interface UndoEntry {
  projectId: string;
  canUndo(): boolean;
  undo(): void;
  // Consecutive live edits can resume the preceding entry after restoring its content.
  restored?(): void;
}
const entries = new Map<string, UndoEntry>();

export function recordProjectUndo(id: string, entry: UndoEntry, continuesHistory = false) {
  const previous = [...entries].filter(([, item]) => item.projectId === entry.projectId);
  const expired = continuesHistory ? previous.slice(0, Math.max(0, previous.length - 9)) : previous;
  for (const [key] of expired) entries.delete(key);
  entries.set(id, entry);
}

export function canUndoProjectChange(id: string) {
  return entries.get(id)?.canUndo() === true;
}

export function undoProjectChange(id: string) {
  const entry = entries.get(id);
  if (!entry?.canUndo()) throw new Error(tr('工程已变更，不能再整体撤销这次修改', 'Project changed. This edit can no longer be undone as a whole.'));
  entry.undo();
  entries.delete(id);
  const previous = [...entries.values()].reverse().find(item => item.projectId === entry.projectId);
  previous?.restored?.();
}
