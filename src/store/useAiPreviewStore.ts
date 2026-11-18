import { create } from 'zustand';
import { conversationKey, type HermesChatConversation } from '../services/hermesConversation';
import type { HermesEvent } from '../services/hermesClient';
import type { DBTableSchema } from './useProtoStore';
import type { ProtoDoc } from '../proto/types';
import type { Row } from '../proto/runtime/mock';
import { parsePageSource } from '../proto/dsl/parser';
import { pageContractErrors } from '../proto/ai/pageContract';

export interface AiPreviewPage { pageId: string; source: string; doc: ProtoDoc; sequence: number }
export type AiPreviewRun = HermesChatConversation & {
  planningSessionId: string;
  execSessionId: string | null;
  sessionId: string;
  runId: string | null;
  pages: Record<string, AiPreviewPage>;
  latestPageId: string | null;
  dbTables: DBTableSchema[];
  tableRows: Record<string, Row[]>;
}
interface State {
  runs: Record<string, AiPreviewRun>;
  begin: (scope: HermesChatConversation, planningSessionId: string, tableRows: Record<string, Row[]>, preserveDraft?: boolean) => void;
  receive: (event: HermesEvent) => void;
  clear: (scope: HermesChatConversation) => void;
}
/** Ephemeral only: previews never enter page history, project archives or autosave. */
export const useAiPreviewStore = create<State>((set) => ({
  runs: {},
  begin: (scope, planningSessionId, tableRows, preserveDraft = false) => set(s => {
    const key = conversationKey(scope);
    const previous = preserveDraft && s.runs[key]?.planningSessionId === planningSessionId ? s.runs[key] : undefined;
    return { runs: { ...s.runs, [key]: { ...scope, planningSessionId, execSessionId: null, sessionId: planningSessionId, runId: null,
      pages: previous ? Object.fromEntries(Object.entries(previous.pages).map(([id, page]) => [id, { ...page, sequence: 0 }])) : {},
      latestPageId: previous?.latestPageId ?? null, dbTables: previous?.dbTables ?? [], tableRows,
    } } };
  }),
  receive: event => set(s => {
    if (!event.projectId || !event.runId) return s;
    const scope: HermesChatConversation | null = event.kind === 'project' && event.pageId === undefined && event.mindmapId === undefined
      ? { projectId: event.projectId, kind: 'project', threadId: event.threadId }
      : event.kind === undefined && event.threadId === undefined && event.mindmapId === undefined && event.pageId
        ? { projectId: event.projectId, pageId: event.pageId } : null;
    if (!scope) return s;
    let key: string;
    try { key = conversationKey(scope); } catch { return s; }
    const run = s.runs[key];
    if (!run) return s;
    if (event.type === 'run-start') {
      const eventPlanningId = event.planningSessionId ?? event.sessionId;
      const eventExecId = event.execSessionId ?? event.sessionId;
      if (
        run.runId !== null ||
        eventPlanningId !== run.planningSessionId ||
        typeof eventExecId !== 'string' ||
        !eventExecId ||
        event.sessionId !== eventExecId
      ) {
        return s;
      }
      return {
        runs: {
          ...s.runs,
          [key]: { ...run, runId: event.runId, execSessionId: eventExecId, sessionId: eventExecId },
        },
      };
    }
    if (
      event.type !== 'page-preview' ||
      run.runId === null ||
      run.execSessionId === null ||
      event.runId !== run.runId ||
      event.sessionId !== run.execSessionId ||
      (event.execSessionId ?? event.sessionId) !== run.execSessionId
    ) {
      return s;
    }
    const p = event.preview;
    if (!p || typeof p.targetPageId !== 'string' || !p.targetPageId.trim() || typeof p.source !== 'string' || !Number.isSafeInteger(p.sequence) || p.sequence < 1 || !Array.isArray(p.dbTables)) return s;
    if (run.pages[p.targetPageId] && p.sequence <= run.pages[p.targetPageId].sequence) return s;
    const tableRows = p.tableRows ?? run.tableRows; // Older desktop preview events do not include staged rows.
    if (pageContractErrors(p.source, p.dbTables, { tableRows }).length) return s;
    const doc = parsePageSource(p.source).doc!;
    return { runs: { ...s.runs, [key]: { ...run, latestPageId: p.targetPageId, dbTables: p.dbTables, tableRows,
      pages: { ...run.pages, [p.targetPageId]: { pageId: p.targetPageId, source: p.source, doc, sequence: p.sequence } },
    } } };
  }),
  clear: scope => set(s => { const runs = { ...s.runs }; delete runs[conversationKey(scope)]; return { runs }; }),
}));
