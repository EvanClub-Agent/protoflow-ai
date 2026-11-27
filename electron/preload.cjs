const { contextBridge, ipcRenderer } = require('electron');

function publishingInvoke(method, input) {
  // Keep structured errors as data across contextBridge; custom Error fields
  // are lost when Electron copies an exception into the renderer world.
  return ipcRenderer.invoke('pflow:publishing-' + method, input);
}

contextBridge.exposeInMainWorld('protoflowDesktop', {
  isElectron: true,
  platform: process.platform,
  aiBackground: {
    begin: scope => ipcRenderer.invoke('pflow:ai-background-begin', scope),
    end: input => ipcRenderer.invoke('pflow:ai-background-end', input),
    snapshot: () => ipcRenderer.invoke('pflow:ai-background-snapshot'),
    configure: input => ipcRenderer.invoke('pflow:ai-background-configure', input),
    onChange: listener => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('pflow:ai-background-event', handler);
      return () => ipcRenderer.removeListener('pflow:ai-background-event', handler);
    },
  },
  diagnostics: {
    capture: input => ipcRenderer.invoke('pflow:diagnostics-capture', input),
    snapshot: () => ipcRenderer.invoke('pflow:diagnostics-snapshot'),
    configure: input => ipcRenderer.invoke('pflow:diagnostics-configure', input),
    retry: () => ipcRenderer.invoke('pflow:diagnostics-retry'),
  },
  selectDirectory: () => ipcRenderer.invoke('pflow:select-directory'),
  defaultProjectsDirectory: () => ipcRenderer.invoke('pflow:default-projects-directory'),
  writeBinaryProject: (payload) =>
    ipcRenderer.invoke('pflow:write-binary-project', payload),
  saveCurrentProject: payload => ipcRenderer.invoke('pflow:save-current-project', payload),
  persistenceReady: () => ipcRenderer.send('pflow:persistence-ready'),
  closeConfirmationReady: () => ipcRenderer.send('pflow:close-confirmation-ready'),
  onConfirmClose: listener => {
    const handler = (_event, requestId) => listener(requestId);
    ipcRenderer.on('pflow:confirm-close', handler);
    return () => ipcRenderer.removeListener('pflow:confirm-close', handler);
  },
  confirmClose: result => ipcRenderer.send('pflow:confirm-close-result', result),
  onCloseState: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('pflow:close-state', handler);
    return () => ipcRenderer.removeListener('pflow:close-state', handler);
  },
  onSaveBeforeClose: listener => {
    const handler = (_event, requestId) => listener(requestId);
    ipcRenderer.on('pflow:save-before-close', handler);
    return () => ipcRenderer.removeListener('pflow:save-before-close', handler);
  },
  finishSaveBeforeClose: result => ipcRenderer.send('pflow:save-before-close-result', result),
  writeUnpackedGitTree: (payload) =>
    ipcRenderer.invoke('pflow:write-unpacked-git-tree', payload),
  readBinaryProject: (payload) => ipcRenderer.invoke('pflow:read-binary-project', payload),
  liveAuthoring: {
    open: input => ipcRenderer.invoke('pflow:mcp-live-open', input),
    capture: input => ipcRenderer.invoke('pflow:mcp-capture', input),
    close: sessionId => ipcRenderer.invoke('pflow:mcp-live-close', sessionId),
    reply: result => ipcRenderer.send('pflow:mcp-live-reply', result),
    onRequest: listener => {
      const handler = (_event, request) => listener(request);
      ipcRenderer.on('pflow:mcp-live-request', handler);
      return () => ipcRenderer.removeListener('pflow:mcp-live-request', handler);
    },
    installPlugin: (sessionId, options) => ipcRenderer.invoke('pflow:mcp-install-plugin', sessionId, options),
    exportExtension: sessionId => ipcRenderer.invoke('pflow:mcp-export-extension', sessionId),
    installSkill: (client, options) => ipcRenderer.invoke('pflow:mcp-install-skill', client, options),
  },
  mcpRuntimeInfo: () => ipcRenderer.invoke('pflow:mcp-runtime-info'),
  trashProject: (payload) => ipcRenderer.invoke('pflow:trash-project', payload),
  openBinaryProject: () => ipcRenderer.invoke('pflow:open-binary-project'),
  savePflowBundle: (bundleJsonString) =>
    ipcRenderer.invoke('pflow:save-file', bundleJsonString),
  setNativeTheme: (mode) => ipcRenderer.invoke('pflow:set-native-theme', mode),
  setWindowMode: (mode) => ipcRenderer.invoke('pflow:set-window-mode', mode),
  getLocale: () => ipcRenderer.invoke('pflow:get-locale'),
  setLocale: (locale) => ipcRenderer.invoke('pflow:set-locale', locale),
  figma: {
    getToken: () => ipcRenderer.invoke('pflow:figma-get-token'),
    setToken: (token) => ipcRenderer.invoke('pflow:figma-set-token', token),
    fetchJson: (input) => ipcRenderer.invoke('pflow:figma-fetch', input),
    fetchImage: (input) => ipcRenderer.invoke('pflow:figma-fetch-image', input),
  },
  publishing: {
    settings: () => publishingInvoke('settings'),
    accountSettings: () => publishingInvoke('accountSettings'),
    authenticate: input => publishingInvoke('authenticate', input),
    logout: () => publishingInvoke('logout'),
    legacyChoice: input => publishingInvoke('legacyChoice', input),
    request: input => publishingInvoke('request', input),
    openPreview: target => publishingInvoke('openPreview', target),
  },
  updater: {
    state: () => ipcRenderer.invoke('pflow:updater-state'),
    check: input => ipcRenderer.invoke('pflow:updater-check', { silent: input?.silent === true }),
    download: input => ipcRenderer.invoke('pflow:updater-download', input),
    cancel: () => ipcRenderer.invoke('pflow:updater-cancel'),
    apply: (input) => ipcRenderer.invoke('pflow:updater-apply', input),
    reveal: () => ipcRenderer.invoke('pflow:updater-reveal'),
    openWeb: () => ipcRenderer.invoke('pflow:updater-open-web'),
    onEvent: listener => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('pflow:updater-event', handler);
      return () => ipcRenderer.removeListener('pflow:updater-event', handler);
    },
  },
  hermes: {
    completeRecovery: p => ipcRenderer.invoke('pflow:hermes-complete-recovery', p),
    saveImages: p => ipcRenderer.invoke('pflow:hermes-save-images', p),
    readImage: p => ipcRenderer.invoke('pflow:hermes-read-image', p),
    detect: p => ipcRenderer.invoke('pflow:hermes-detect', p),
    connect: p => ipcRenderer.invoke('pflow:hermes-connect', p),
    disconnect: () => ipcRenderer.invoke('pflow:hermes-disconnect'),
    session: p => ipcRenderer.invoke('pflow:hermes-session', p),
    deleteProjectChat: p => ipcRenderer.invoke('pflow:hermes-delete-project-chat', p),
    reasoning: p => ipcRenderer.invoke('pflow:hermes-reasoning', p),
    context: p => ipcRenderer.invoke('pflow:hermes-context', p),
    setModel: async p => {
      try { return await ipcRenderer.invoke('pflow:hermes-model', p); }
      catch (error) {
        const isEn = typeof document !== 'undefined' && document.documentElement?.dataset?.locale === 'en-US';
        const message = error.message.replace(/^Error invoking remote method 'pflow:hermes-model': Error: /, '');
        throw new Error(message === 'model_switch_cancelled' ? (isEn ? 'Model switch cancelled' : '已取消切换模型') : message);
      }
    },
    execute: async p => {
      try {
        const isEn = typeof document !== 'undefined' && document.documentElement?.dataset?.locale === 'en-US';
        const res = await ipcRenderer.invoke('pflow:hermes-execute', p && typeof p === 'object' ? { ...p, __ipcEnvelope: true } : p);
        if (res && typeof res === 'object' && typeof res.__ok === 'boolean') {
          if (res.__ok) return res.value;
          const err = new Error(String(res.error?.message || (isEn ? 'AI execution failed' : 'AI 执行失败')));
          if (res.error?.failureEnvelope && typeof res.error.failureEnvelope === 'object') {
            err.failureEnvelope = res.error.failureEnvelope;
          }
          throw err;
        }
        return res;
      } catch (error) {
        const cleaned = new Error(String(error?.message || error).replace(/^Error invoking remote method 'pflow:hermes-execute': Error: /, ''));
        if (error?.failureEnvelope && typeof error.failureEnvelope === 'object') {
          cleaned.failureEnvelope = error.failureEnvelope;
        }
        throw cleaned;
      }
    },
    cancel: p => ipcRenderer.invoke('pflow:hermes-cancel', p),
    permission: p => ipcRenderer.invoke('pflow:hermes-permission', p),
    question: p => ipcRenderer.invoke('pflow:hermes-question', p),
    sync: p => ipcRenderer.invoke('pflow:hermes-sync', p),
    update: () => ipcRenderer.invoke('pflow:hermes-update'),
    installGuide: () => ipcRenderer.invoke('pflow:hermes-install-guide'),
    installation: () => ipcRenderer.invoke('pflow:hermes-install-state'),
    install: () => ipcRenderer.invoke('pflow:hermes-install'),
    repair: () => ipcRenderer.invoke('pflow:hermes-repair'),
    cancelInstall: () => ipcRenderer.invoke('pflow:hermes-install-cancel'),
    openInstallLog: () => ipcRenderer.invoke('pflow:hermes-install-log'),
    openManagement: p => ipcRenderer.invoke('pflow:hermes-management', p),
    accounts: Object.fromEntries(['list', 'saveKey', 'removeKey', 'start', 'openLogin', 'poll', 'submit', 'cancel', 'disconnect'].map(method => [method, payload => ipcRenderer.invoke(`pflow:hermes-accounts-${method}`, payload)])),
    onEvent: listener => {
      const handler = (_event, event) => listener(event);
      ipcRenderer.on('pflow:hermes-event', handler);
      return () => ipcRenderer.removeListener('pflow:hermes-event', handler);
    },
  },
});
