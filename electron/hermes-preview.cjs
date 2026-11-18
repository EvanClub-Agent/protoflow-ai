const fs = require('node:fs');
const { pageContractErrors } = require('./generated/material-contract.cjs');

/** Observe atomic MCP staging writes, never incomplete model tokens or persisted projects. */
function watchStagedPages(file, scope, emit, isActive, initialCount = 0) {
  let stopped = false;
  let count = Number.isInteger(initialCount) && initialCount > 0 ? initialCount : 0;
  let tablesJson;
  let rowsJson;
  const published = new Map();
  const publish = (context, frozen = false) => {
    if (stopped || !isActive()) return;
    if ((!context.active && !frozen) || context.readOnly || context.runId !== scope.runId || context.projectId !== scope.projectId || context.pageId !== scope.pageId || context.kind !== scope.kind || context.threadId !== scope.threadId || context.mindmapId !== scope.mindmapId || !Array.isArray(context.operations)) return;
    const snapshot = context.snapshot;
    if (!snapshot || !Array.isArray(snapshot.dbTables) || !snapshot.pageSources) return;
    const nextTables = JSON.stringify(snapshot.dbTables);
    const nextRows = JSON.stringify(snapshot.tableRows);
    const targets = new Set(context.operations.slice(count).filter(op => op.tool === 'protoflow_apply_tsx_patch' && typeof op.args?.pageId === 'string').map(op => op.args.pageId));
    if (nextTables !== tablesJson || nextRows !== rowsJson) for (const id of published.keys()) targets.add(id);
    count = context.operations.length;
    for (const targetPageId of targets) {
      const source = snapshot.pageSources[targetPageId];
      if (typeof source !== 'string' || (source === published.get(targetPageId) && nextTables === tablesJson && nextRows === rowsJson)) continue;
      if (pageContractErrors(source, snapshot.dbTables, { tableRows: snapshot.tableRows }).length) continue;
      published.set(targetPageId, source);
      emit({ type: 'page-preview', ...scope, preview: { targetPageId, source, sequence: count, dbTables: snapshot.dbTables,
        ...(snapshot.tableRows ? { tableRows: snapshot.tableRows } : {}) } });
    }
    tablesJson = nextTables;
    rowsJson = nextRows;
  };
  const flush = () => {
    let context;
    try { context = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    publish(context);
  };
  // watchFile follows rename-based atomic writes on all supported desktop platforms.
  fs.watchFile(file, { interval: 100, persistent: false }, flush);
  // Only the host passes its verified final snapshot here after closing writes;
  // file-watch callbacks continue rejecting inactive or cancelled contexts.
  return { flush, flushFinal(context) { if (context.active === false) publish(context, true); },
    close() { stopped = true; fs.unwatchFile(file, flush); } };
}
module.exports = { watchStagedPages };
