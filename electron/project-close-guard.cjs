const { randomUUID } = require('node:crypto');
const { tr } = require('./i18n.cjs');

/** Confirm once, then flush. Only an acknowledgement for that flush may quit. */
function installProjectCloseGuard({ app, window, ipcMain, dialog, timeoutMs = 15000, getCloseBlockReason = () => null }) {
  let ready = false, confirmationReady = false, allowed = false, pending = null, closingPrompt = null;
  const webContents = window.webContents;
  const isAlive = () => !window.isDestroyed?.() && !webContents?.isDestroyed?.();
  const authorized = event => isAlive() && event.sender === webContents && event.senderFrame === webContents.mainFrame;
  const clearTimer = () => { if (pending?.timer) clearTimeout(pending.timer); };
  const status = (state, error) => {
    if (pending?.ui === 'renderer' && isAlive()) {
      webContents.send('pflow:close-state', { requestId: pending.requestId, state, error });
    }
  };
  const fail = error => {
    clearTimer();
    if (pending) { pending.phase = 'confirming'; pending.flushId = null; pending.timer = null; pending.error = error; }
    if (pending?.ui === 'renderer') status('error', error);
    else {
      pending = null;
      if (isAlive()) void dialog.showMessageBox(window, {
        type: 'error',
        title: tr('项目尚未保存', 'Project Not Saved'),
        message: tr('无法完成保存，已保留当前窗口', 'Unable to finish saving. Window kept open.'),
        detail: `${error}\n${tr('请重试保存，或导出 .pflow 备份。', 'Please retry saving or export a .pflow backup.')}`,
        buttons: [tr('返回项目', 'Back to Project')],
      });
    }
  };
  const finish = () => {
    const blockReason = getCloseBlockReason();
    if (blockReason) { fail(blockReason); return; }
    clearTimer(); closingPrompt = { requestId: pending.requestId, ui: pending.ui }; pending = null; allowed = true;
    app.quit();
  };
  const decide = (requestId, confirmed) => {
    if (!pending || pending.phase !== 'confirming' || pending.requestId !== requestId) return;
    if (confirmed === false) { clearTimer(); pending = null; return; }
    if (confirmed !== true) return;
    const blockReason = getCloseBlockReason();
    if (blockReason) { fail(blockReason); return; }
    // Before the renderer has initialized there is no editable project to flush.
    if (!ready) { finish(); return; }
    pending.phase = 'saving';
    pending.flushId = randomUUID();
    pending.timer = setTimeout(() => fail(tr('等待项目保存超时，请检查保存状态后重试', 'Timed out waiting for project save. Please check save status and retry.')), timeoutMs);
    status('saving');
    webContents.send('pflow:save-before-close', pending.flushId);
  };
  const request = event => {
    if (allowed || !isAlive()) return;
    event.preventDefault();
    if (window.isMinimized?.()) window.restore();
    window.show?.(); window.focus?.();
    if (pending) return;
    const blockReason = getCloseBlockReason();
    if (blockReason) {
      void dialog.showMessageBox(window, {
        type: 'info',
        title: tr('正在更新', 'Updating'),
        message: blockReason,
        buttons: [tr('等待完成', 'Wait')],
      });
      return;
    }
    const requestId = randomUUID();
    pending = { requestId, phase: 'confirming', flushId: null, timer: null, ui: confirmationReady ? 'renderer' : 'native' };
    if (confirmationReady) webContents.send('pflow:confirm-close', requestId);
    else {
      // Startup / an older renderer may not have the custom dialog yet.
      void dialog.showMessageBox(window, {
        type: 'question',
        title: tr('退出 Alex', 'Quit Alex'),
        message: tr('确定退出 Alex？', 'Are you sure you want to quit Alex?'),
        detail: tr('退出前会保存当前项目。', 'Your current project will be saved before quitting.'),
        buttons: [tr('继续使用', 'Keep Working'), tr('退出程序', 'Quit Alex')],
        defaultId: 0, cancelId: 0,
      }).then(result => { if (isAlive()) decide(requestId, result.response === 1); }, () => decide(requestId, false));
    }
  };
  const onReady = event => { if (authorized(event)) ready = true; };
  const onConfirmationReady = event => {
    if (!authorized(event)) return;
    confirmationReady = true;
    if (pending?.ui === 'renderer') {
      webContents.send('pflow:confirm-close', pending.requestId);
      if (pending.phase === 'saving') status('saving');
      else if (pending.error) status('error', pending.error);
    }
  };
  const onDecision = (event, result) => { if (authorized(event)) decide(result?.requestId, result?.confirmed); };
  const onSaved = (event, result) => {
    if (!authorized(event) || pending?.phase !== 'saving' || result?.requestId !== pending.flushId) return;
    if (result.ok !== true) { fail(typeof result.error === 'string' ? result.error : tr('保存失败', 'Save failed')); return; }
    finish();
  };
  const unloadPrevented = () => {
    if (!allowed) return;
    allowed = false;
    pending = { ...closingPrompt, phase: 'confirming', flushId: null, timer: null };
    fail(tr('项目又有新的修改，请再次确认保存并退出', 'New changes were made. Please confirm saving and quitting again.'));
  };
  const rendererGone = () => {
    confirmationReady = false;
    if (pending) {
      pending.ui = 'native';
      fail(tr('界面意外退出，已保留程序。请恢复界面并保存项目后重试', 'Renderer exited unexpectedly. App kept open; please restore the window and save before retrying.'));
    }
  };
  webContents.on('will-prevent-unload', unloadPrevented);
  webContents.on('render-process-gone', rendererGone);
  window.on('close', request);
  app.on('before-quit', request);
  ipcMain.on('pflow:persistence-ready', onReady);
  ipcMain.on('pflow:close-confirmation-ready', onConfirmationReady);
  ipcMain.on('pflow:confirm-close-result', onDecision);
  ipcMain.on('pflow:save-before-close-result', onSaved);
  window.once('closed', () => {
    clearTimer(); pending = null;
    app.removeListener('before-quit', request);
    ipcMain.removeListener('pflow:persistence-ready', onReady);
    ipcMain.removeListener('pflow:close-confirmation-ready', onConfirmationReady);
    ipcMain.removeListener('pflow:confirm-close-result', onDecision);
    ipcMain.removeListener('pflow:save-before-close-result', onSaved);
    if (!webContents?.isDestroyed?.()) {
      webContents.removeListener('will-prevent-unload', unloadPrevented);
      webContents.removeListener('render-process-gone', rendererGone);
    }
  });
}
module.exports = { installProjectCloseGuard };
