const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { withContextLockAsync } = require('./context-transaction.cjs');
const { verifyDependencyFootprint } = require('./generated/material-contract.cjs');
const { tr } = require('./i18n.cjs');
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function durableWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  // Windows does not support opening a directory for fsync.
  if (process.platform !== 'win32') { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
function checkpointFile(dir, phase, pageId) { return path.join(dir, 'recovery-' + hash([phase, pageId]) + '.json'); }
function footprintFile(file) { return file + '.footprint.json'; }
function footprintErrorFile(file) { return file + '.footprint.error'; }
function resolveExecutionPaths(convDir, workflowPhase, targetPageId) {
  if (workflowPhase === 'generating' && typeof targetPageId === 'string' && targetPageId) {
    const execDir = path.join(convDir, 'page-runs', hash(targetPageId));
    return {
      execDir,
      contextFile: path.join(execDir, 'context.json'),
      sessionFile: path.join(execDir, 'session.json'),
      checkpointPath: checkpointFile(execDir, workflowPhase, targetPageId),
      legacyCheckpointPath: checkpointFile(convDir, workflowPhase, targetPageId),
      isPageExecution: true,
    };
  }
  return {
    execDir: convDir,
    contextFile: path.join(convDir, 'context.json'),
    sessionFile: path.join(convDir, 'session.json'),
    checkpointPath: checkpointFile(convDir, workflowPhase, targetPageId),
    legacyCheckpointPath: null,
    isPageExecution: false,
  };
}
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(tr('恢复记录无法读取，已保留原文件，请检查本地工程数据', 'Recovery checkpoint could not be read; original file preserved. Please check local project data'));
  }
}
function readCheckpointWithLegacy(paths) {
  const direct = read(paths.checkpointPath);
  if (direct) return { checkpoint: direct, file: paths.checkpointPath, isLegacyParent: false };
  if (paths.legacyCheckpointPath) {
    const legacy = read(paths.legacyCheckpointPath);
    if (legacy) return { checkpoint: legacy, file: paths.legacyCheckpointPath, isLegacyParent: true };
  }
  return { checkpoint: null, file: paths.checkpointPath, isLegacyParent: false };
}
async function freezeContext(file, runId, status, assistantText, clarifications) {
  return withContextLockAsync(file, () => {
    const context = read(file);
    if (!context || context.runId !== runId) return null;
    const sidecarRequired = Boolean(context.requireFootprintSidecar);
    let latestFootprint;
    let footprintCorrupted = Boolean(context.footprintCorrupted);
    if (!footprintCorrupted) {
      try {
        const errMarker = read(footprintErrorFile(file));
        if (errMarker && (!errMarker.runId || errMarker.runId === runId)) {
          footprintCorrupted = true;
        }
      } catch {
        footprintCorrupted = true;
      }
    }
    if (!footprintCorrupted) {
      try {
        const sidecar = read(footprintFile(file));
        if (sidecar) {
          if (
            sidecar.corrupted === true ||
            sidecar.runId !== runId ||
            sidecar.dependencyFootprint?.version !== 3
          ) {
            footprintCorrupted = true;
          } else {
            latestFootprint = sidecar.dependencyFootprint;
          }
        } else if (sidecarRequired) {
          footprintCorrupted = true;
        } else if (context.dependencyFootprint?.version === 3) {
          latestFootprint = context.dependencyFootprint;
        }
      } catch {
        footprintCorrupted = true;
      }
    }
    const latestClarifications =
      Array.isArray(clarifications) && clarifications.length
        ? clarifications
        : Array.isArray(context.clarifications) && context.clarifications.length
          ? context.clarifications
          : undefined;
    const { dependencyFootprint: _discardStaleFootprint, ...restContext } = context;
    const frozen = {
      ...restContext,
      ...(footprintCorrupted ? { footprintCorrupted: true } : {}),
      ...(!footprintCorrupted && latestFootprint ? { dependencyFootprint: latestFootprint } : {}),
      ...(latestClarifications ? { clarifications: latestClarifications } : {}),
      active: false,
    };
    // Freeze first under the same lock used by every MCP read/mutation. Old
    // async bridge calls must re-enter the lock and fail their identity fence.
    durableWrite(file, frozen);
    if (!context.recovery) return null;
    const effectiveStatus = footprintCorrupted ? 'uncertain' : status;
    const checkpoint = { ...frozen, recovery: { ...context.recovery, status: effectiveStatus, savedAt: new Date().toISOString(),
      ...(typeof assistantText === 'string' ? { assistantText } : {}) } };
    durableWrite(checkpointFile(path.dirname(file), context.workflowPhase, context.targetPageId), checkpoint);
    return checkpoint;
  });
}
const revisionFields = ['projectId','projectName','projectMode','mindmaps','pageCatalog','pageSources','designerPages','designerFolders',
  'sitemapBase','sitemapOverrides','sitemap','folders','projectPlan','projectAgreements','databaseRequirements','dbTables','stickyNotes','closedLoopIssues','compositeBlocks','contracts'];
function revisionSections(revision) {
  const value = JSON.parse(revision);
  if (!value || !value.context || !value.tableRows || !value.widgets) {
    throw new Error(tr('恢复记录缺少完整工程基线', 'Recovery checkpoint is missing a complete project baseline'));
  }
  const section = (object, key) => hash([Object.hasOwn(object, key), object[key]]);
  return Object.fromEntries([
    ...revisionFields.map(key => ['context.' + key, section(value.context, key)]),
    ...['tableRows','widgets','projectNotes'].map(key => [key, section(value, key)]),
  ]);
}
function recoveryIdentity({ scope, sessionId, modelId, environment, account, revision, revisionVersion = 1, skillDigest, toolVersion }) {
  if (![1, 2, 3].includes(revisionVersion)) throw new Error(tr('不支持的工程恢复基线版本', 'Unsupported project recovery baseline version'));
  return { scope, sessionId, modelId, environment, account: account?.status === 'signed-in' && typeof account.userId === 'string' && account.userId
    ? { userId: account.userId, serviceUrl: account.serviceUrl } : null,
  revision: revisionVersion === 3 ? null : (typeof revision === 'string' && revision ? hash(revision) : null), revisionVersion,
  ...(revisionVersion === 2 ? { revisionSections: revisionSections(revision) } : {}), skillDigest, toolVersion };
}
function validateCheckpoint(checkpoint, identity, options = {}) {
  const { liveSnapshot = null, isLegacyParent = false, skipSessionIdCheck = false, targetPageId } = options || {};
  const uncertain = checkpoint.recovery?.status === 'uncertain';
  const fail = (code, key, message, changedSections = []) => {
    const error = new Error(message);
    error.code = code;
    error.recoveryChecks = [
      { kind: 'draft-recovery', status: uncertain ? 'uncertain' : 'conflict' },
      { kind: 'draft-baseline', status: 'mismatch', actionKind: key },
      ...changedSections.map(section => ({ kind: 'draft-baseline-section', status: 'changed', actionKind: section })),
      ...(typeof checkpoint.runId === 'string' ? [{ kind: 'draft-origin', status: 'preserved', targetId: checkpoint.runId }] : []),
    ];
    throw error;
  };
  if (!identity.account || !checkpoint.recovery?.identity?.account) {
    fail('DRAFT_RECOVERY_IDENTITY', 'account', tr('恢复草稿需要原登录账号，当前账号身份尚未验证', 'Draft recovery requires the original signed-in account; current account identity is unverified'));
  }
  const names = {
    scope: tr('任务范围', 'Task scope'),
    account: tr('登录账号', 'Signed-in account'),
    environment: tr('Hermes 环境', 'Hermes environment'),
    sessionId: tr('会话', 'Conversation session'),
    modelId: tr('模型', 'Model'),
    revision: tr('工程内容或需求', 'Project content or requirements'),
    skillDigest: tr('项目指令', 'Project instructions'),
    toolVersion: tr('物料契约', 'Material contract'),
    targetPageId: tr('目标页面', 'Target page'),
  };
  for (const key of ['scope', 'account', 'environment']) {
    if (JSON.stringify(checkpoint.recovery.identity[key]) !== JSON.stringify(identity[key])) {
      fail(
        'DRAFT_RECOVERY_IDENTITY',
        key,
        tr(
          `${names[key]}已变化，未自动覆盖当前项目；原候选草稿仍保留`,
          `${names[key]} has changed; current project was not overwritten and the candidate draft is preserved`
        )
      );
    }
  }
  if (targetPageId !== undefined && checkpoint.targetPageId !== targetPageId) {
    fail(
      'DRAFT_RECOVERY_IDENTITY',
      'targetPageId',
      tr(
        `${names.targetPageId}已变化，未自动覆盖当前项目；原候选草稿仍保留`,
        `${names.targetPageId} has changed; current project was not overwritten and the candidate draft is preserved`
      )
    );
  }
  // Missing version is the documented pre-v2 baseline, which omitted transient
  // preview rows. It cannot be migrated from the candidate: that may contain edits.
  const savedVersion = checkpoint.recovery.identity.revisionVersion === undefined ? 1 : checkpoint.recovery.identity.revisionVersion;
  const currentVersion = identity.revisionVersion === undefined ? 1 : identity.revisionVersion;
  const baselineVersionMessage = tr(
    '旧草稿使用升级前的恢复基线，无法可靠自动接续；这不表示你修改了工程。' +
      (uncertain ? '上轮还存在执行结果不明的操作。' : '') +
      '原候选已保留，请直接点击下方或右侧的“保留旧草稿，重新生成”按钮，按当前工程继续；原会话历史不会清空。',
    'The older draft uses a pre-upgrade recovery baseline and cannot be resumed automatically; this does not mean you modified the project.' +
      (uncertain ? ' The previous run also had operations with uncertain outcomes.' : '') +
      ' The candidate draft is preserved — click "Archive Old Draft & Regenerate" to continue from the current project without clearing conversation history.'
  );
  if (isLegacyParent) {
    fail('DRAFT_RECOVERY_BASELINE_VERSION', 'revisionVersion', baselineVersionMessage);
  }
  const identityKeys = skipSessionIdCheck
    ? ['modelId', 'skillDigest', 'toolVersion']
    : ['sessionId', 'modelId', 'skillDigest', 'toolVersion'];
  for (const key of identityKeys) {
    if (JSON.stringify(checkpoint.recovery.identity[key]) !== JSON.stringify(identity[key])) {
      fail(
        'DRAFT_RECOVERY_IDENTITY',
        key,
        tr(
          `${names[key]}已变化，未自动覆盖当前项目；原候选草稿仍保留。请直接点击下方或右侧的“保留旧草稿，重新生成”按钮，按当前工程重新生成该页。`,
          `${names[key]} has changed; current project was not overwritten and the candidate draft is preserved. Click "Archive Old Draft & Regenerate" to regenerate this page from the current project.`
        )
      );
    }
  }
  if (savedVersion !== currentVersion) {
    fail('DRAFT_RECOVERY_BASELINE_VERSION', 'revisionVersion', baselineVersionMessage);
  }
  if (currentVersion === 3) {
    if (!Array.isArray(checkpoint.operations) || !checkpoint.snapshot || !checkpoint.dependencyFootprint || checkpoint.dependencyFootprint.version !== 3) {
      throw new Error(tr('恢复记录缺少工程基线或候选内容', 'Recovery checkpoint is missing project baseline or candidate operations'));
    }
    if (!liveSnapshot || typeof liveSnapshot !== 'object') {
      throw new Error(tr('恢复校验缺少实时工程快照', 'Recovery verification is missing a live project snapshot'));
    }
    if (
      checkpoint.snapshot.projectPlan?.generatedPageIds?.includes(checkpoint.targetPageId) ||
      checkpoint.baseSnapshot?.projectPlan?.generatedPageIds?.includes(checkpoint.targetPageId) ||
      liveSnapshot.projectPlan?.generatedPageIds?.includes(checkpoint.targetPageId)
    ) {
      throw new Error(tr('该页面已完成，不得重放候选操作', 'This page is already completed; candidate operations will not be replayed'));
    }
    const verified = verifyDependencyFootprint(liveSnapshot, checkpoint.dependencyFootprint);
    if (!verified.ok) {
      fail(
        'DRAFT_RECOVERY_BASELINE_CHANGED',
        'revision',
        tr(
          '工程内容或需求已变化，未自动覆盖当前项目；原候选草稿仍保留。请直接点击下方或右侧的“保留旧草稿，重新生成”按钮，按当前工程重新生成该页。',
          'Project content or requirements have changed; current project was not overwritten and the candidate draft is preserved. Click "Archive Old Draft & Regenerate" to regenerate this page from the current project.'
        ),
        verified.changedSections,
      );
    }
  } else {
    if (checkpoint.recovery.identity.revision !== identity.revision) {
      const changed = currentVersion === 2 ? Object.keys(identity.revisionSections).filter(key => checkpoint.recovery.identity.revisionSections?.[key] !== identity.revisionSections[key]) : [];
      fail(
        'DRAFT_RECOVERY_BASELINE_CHANGED',
        'revision',
        tr(
          '工程内容或需求已变化，未自动覆盖当前项目；原候选草稿仍保留。请直接点击下方或右侧的“保留旧草稿，重新生成”按钮，按当前工程重新生成该页。',
          'Project content or requirements have changed; current project was not overwritten and the candidate draft is preserved. Click "Archive Old Draft & Regenerate" to regenerate this page from the current project.'
        ),
        changed
      );
    }
    if (!identity.revision || !Array.isArray(checkpoint.operations) || !checkpoint.snapshot) {
      throw new Error(tr('恢复记录缺少工程基线或候选内容', 'Recovery checkpoint is missing project baseline or candidate operations'));
    }
    if (checkpoint.snapshot.projectPlan?.generatedPageIds?.includes(checkpoint.targetPageId)) {
      throw new Error(tr('该页面已完成，不得重放候选操作', 'This page is already completed; candidate operations will not be replayed'));
    }
  }
  if (checkpoint.recovery.status === 'uncertain') {
    fail(
      'DRAFT_RECOVERY_UNCERTAIN',
      'status',
      tr(
        '上轮生成中途中断，存在执行结果不明的操作，候选草稿已保留但无法直接续写。请直接点击下方或右侧的“保留旧草稿，重新生成”按钮：系统会自动归档旧草稿并按当前工程重新生成此页，已完成的页面和不会清空的会话历史均不受影响。',
        'The previous generation was interrupted mid-turn with operations of uncertain outcome; the candidate draft is preserved but cannot be continued directly. Click "Archive Old Draft & Regenerate" to archive the old draft and regenerate this page cleanly without affecting completed pages or conversation history.'
      )
    );
  }
  if (checkpoint.recovery.status !== 'available') {
    fail(
      'DRAFT_RECOVERY_UNCERTAIN',
      'status',
      tr(
        '当前候选草稿状态不可自动恢复，请直接点击下方或右侧的“保留旧草稿，重新生成”按钮；原会话历史不会清空。',
        'Current candidate draft state cannot be resumed automatically. Click "Archive Old Draft & Regenerate" to continue without clearing conversation history.'
      )
    );
  }
}
module.exports = {
  durableWrite,
  freezeContext,
  checkpointFile,
  footprintFile,
  footprintErrorFile,
  resolveExecutionPaths,
  read,
  readCheckpointWithLegacy,
  recoveryIdentity,
  validateCheckpoint,
  hash,
};
