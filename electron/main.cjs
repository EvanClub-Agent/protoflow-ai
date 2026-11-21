const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, powerSaveBlocker, powerMonitor, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { saveProjectArchive, projectIdentity } = require('./project-files.cjs');
const { installProjectCloseGuard } = require('./project-close-guard.cjs');
const { installApplicationMenu } = require('./application-menu.cjs');
const { initMainI18n, getMainLocale, setMainLocale, isMainEn, tr } = require('./i18n.cjs');

require('./app-identity.cjs').initializeApplicationIdentity(app);

let mainWindow = null;
let authoringBridge = null;
let managedViteProcess = null;
let publishingClient;
let desktopUpdater;
let diagnostics;
let aiBackground;
let taskNotification;
function getAiBackground() {
  if (!aiBackground) {
    const { AiBackground } = require('./ai-background.cjs');
    aiBackground = new AiBackground({ powerSaveBlocker, powerMonitor, dataDir: app.getPath('userData'),
      diagnostic: captureDiagnostic,
      clearNotification: () => { taskNotification?.close(); taskNotification = undefined; },
      emit: state => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('pflow:ai-background-event', state);
      },
      notify: options => {
        if (!Notification.isSupported()) throw new Error('System notifications unavailable');
        taskNotification?.close();
        const notification = new Notification({ ...options, silent: true });
        taskNotification = notification;
        notification.on('failed', () => aiBackground?.notificationFailed());
        notification.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
        });
        notification.show();
      },
    });
  }
  return aiBackground;
}
let diagnosticInitError = '';
function getDiagnostics() {
  if (!diagnostics) {
    const { DiagnosticCollector } = require('./diagnostics.cjs');
    diagnostics = new DiagnosticCollector({ dataDir: app.getPath('userData'),
      serverUrl: require('./update-channel.cjs').bundledUpdateChannel.serverUrl,
      serverUrlProvider: () => publishingClient?.serviceUrl ?? '',
      appVersion: app.getVersion(), enabled: false,
      accountProvider: () => publishingClient?.diagnosticAccount() ?? { status: 'unknown' } });
    diagnostics.start();
  }
  return diagnostics;
}
function captureDiagnostic(input) {
  try { return getDiagnostics().capture(input); }
  catch {
    diagnosticInitError = tr(
      '诊断存储初始化失败，请检查本地目录权限或诊断安装凭证',
      'Failed to initialize diagnostics storage. Please check local directory permissions.',
    );
    return null;
  }
}
// One failure boundary for desktop IO, network, update and AI IPC operations.
// Never collect invocation arguments, tokens, file contents or AI prompt/response text.
function handleIpc(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { return await handler(event, ...args); }
    catch (error) {
      if (isMainRendererEvent(event) && !channel.startsWith('pflow:diagnostics-') && !require('./diagnostics.cjs').isCancellation(error)) {
        const category = channel.includes('hermes') ? 'ai' : /publishing|updater/.test(channel) ? 'network' : /project|file|directory/.test(channel) ? 'storage' : 'main';
        captureDiagnostic({ source:'main', category, code:'IPC_FAILED', stage:channel,
          message: category==='ai' ? tr('AI 桌面调用失败：', 'Desktop AI call failed: ')+require('./diagnostics.cjs').failureReason(error?.cause ?? error) : error?.message,
          stack: String(error?.stack ?? '').split('\n').slice(1).join('\n'), context: category === 'ai' ? { ...args[0],
            checks: [...(error?.backgroundChecks ?? []), ...(Number.isInteger(error?.rpcCode) ? [{kind:'acp-error',status:String(error.rpcCode),actionKind:error.rpcMethod}] : [])] } : args[0] });
      }
      throw error;
    }
  });
}
for (const method of ['capture', 'snapshot', 'configure', 'retry']) {
  handleIpc(`pflow:diagnostics-${method}`, (event, input) => {
    if (!isMainRendererEvent(event)) throw new Error(tr('不允许的诊断调用', 'Unauthorized diagnostics call'));
    if (method==='capture') return captureDiagnostic({...input,source:'renderer'});
    if (method==='snapshot' && diagnosticInitError) return {enabled:false,items:[],healthError:diagnosticInitError,dropped:0};
    return getDiagnostics()[method](input);
  });
}
for (const method of ['begin', 'end', 'snapshot', 'configure']) {
  handleIpc(`pflow:ai-background-${method}`, (event, input) => {
    assertMainRenderer(event);
    const background = getAiBackground();
    if (method === 'begin') return background.begin(input, event.sender.id);
    if (method === 'end') return background.end(input?.leaseId, event.sender.id, input?.outcome);
    return background[method](input);
  });
}
process.on('uncaughtExceptionMonitor', error => captureDiagnostic({source:'main',category:'main',code:'UNCAUGHT_EXCEPTION',stage:'process',message:error.message,stack:error.stack}));
for (const method of ['settings', 'accountSettings', 'authenticate', 'logout', 'legacyChoice', 'request']) {
  handleIpc(`pflow:publishing-${method}`, (event, input) => {
    if (!isMainRendererEvent(event)) throw new Error(tr('不允许的发布调用', 'Unauthorized publishing call'));
    if (!publishingClient) {
      const { PublishingClient } = require('./publishing.cjs');
      publishingClient = new PublishingClient({ dataDir: app.getPath('userData'), safeStorage: require('electron').safeStorage });
    }
    return publishingClient[method](input).then(value => ({ ok: true, value }), error => {
      captureDiagnostic({ source: 'main', category: 'network', code: 'PUBLISHING_FAILED', stage: `publishing-${method}`, message: error.message });
      return { ok: false, error: { message: error.message, status: error.status } };
    });
  });
}

function getDesktopUpdater() {
  if (!desktopUpdater) {
    const { DesktopUpdater } = require('./updater.cjs');
    const updateChannel = require('./update-channel.cjs').validateBundledUpdateChannel();
    desktopUpdater = new DesktopUpdater({
      dataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      fixedUpdateConfig: updateChannel,
      installDeb: filePath => require('./linux-update-installer.cjs').installDeb(filePath),
      restartApp: () => {
        // The renderer has flushed the project and blocks editing during install.
        setTimeout(() => { stopApplicationServices(); app.relaunch(); app.exit(0); }, 500);
      },
      emit: state => {
        if (state.status === 'error') captureDiagnostic({source:'main',category:'network',code:'UPDATE_REQUEST_FAILED',stage:'updater',message:state.error});
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('pflow:updater-event', state);
        }
      },
      openPath: target => require('electron').shell.openPath(target),
      showItemInFolder: target => require('electron').shell.showItemInFolder(target),
      launchDetached: (executable, args) => {
        const child = spawn(executable, args, { detached: true, stdio: 'ignore' });
        child.unref();
        setTimeout(() => app.quit(), 400);
      },
    });
  }
  return desktopUpdater;
}

const updaterMethods = {
  state: 'snapshot',
  check: 'check',
  download: 'download',
  cancel: 'cancelDownload',
  apply: 'apply',
  reveal: 'reveal',
};
for (const [name, method] of Object.entries(updaterMethods)) {
  handleIpc(`pflow:updater-${name}`, (event, input) => {
    if (!isMainRendererEvent(event)) throw new Error(tr('不允许的版本更新调用', 'Unauthorized updater call'));
    if (method === 'apply') { hermesManagement?.assertIdle(); hermesManagement?.assertNoChat(); }
    return getDesktopUpdater()[method](method === 'check' ? { silent: input?.silent === true } : input);
  });
}
handleIpc('pflow:updater-open-web', event => {
  if (!isMainRendererEvent(event)) throw new Error(tr('不允许的版本更新调用', 'Unauthorized updater call'));
  const updater = getDesktopUpdater();
  const baseUrl = updater.resolveServerUrl();
  const target = baseUrl
    ? `${baseUrl}/releases`
    : 'https://github.com/EvanClub-Agent/protoflow-ai/releases';
  return require('electron').shell.openExternal(target);
});

const WELCOME_SIZE = { width: 1020, height: 660 };
const WORKSPACE_SIZE = { width: 1560, height: 960 };

// Clamp a desired window size to the work area of the display the window is on
// (or the primary display before the window exists), so small laptop screens and
// high display scaling never push the window or its content off-screen.
function fitToDisplay(size, ratio = 0.94) {
  const { screen } = require('electron');
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  return {
    width: Math.min(size.width, Math.floor(width * ratio)),
    height: Math.min(size.height, Math.floor(height * ratio)),
  };
}

function isPortListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function ensureDevServerReady(port = 5173) {
  if (await isPortListening(port, '127.0.0.1')) return true;
  if (await isPortListening(port, 'localhost')) return true;

  // Auto-spawn Vite dev server when running `npm run electron:start` standalone
  const projectRoot = path.resolve(__dirname, '..');
  const viteBin = path.join(projectRoot, 'node_modules', '.bin', 'vite');
  if (fs.existsSync(viteBin) && !managedViteProcess) {
    managedViteProcess = spawn(viteBin, ['--port', String(port)], {
      cwd: projectRoot,
      stdio: 'ignore',
      env: process.env,
    });
    managedViteProcess.on('exit', () => {
      managedViteProcess = null;
    });
  }

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isPortListening(port, '127.0.0.1')) return true;
    if (await isPortListening(port, 'localhost')) return true;
  }
  return false;
}

async function createMainWindow() {
  const iconPath = path.join(__dirname, '../public/icon.png');
  const isMac = process.platform === 'darwin';
  // Start as a compact, centered IDEA-style welcome window; expands into the workspace after a project is opened
  const welcome = fitToDisplay(WELCOME_SIZE);
  mainWindow = new BrowserWindow({
    width: welcome.width,
    height: welcome.height,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Alex',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 14 },
        }
      : {}),
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (!isMac) {
    mainWindow.setMenuBarVisibility(false);
  }
  installProjectCloseGuard({ app, window: mainWindow, ipcMain, dialog,
    getCloseBlockReason: () => desktopUpdater?.installing ? tr('正在安装更新，请等待完成后应用自动重启。', 'Installing update. Please wait for the app to restart automatically.') : null,
  });
  const win = mainWindow;
  const rendererOwner = win.webContents.id;
  getAiBackground().attach(win.webContents);
  const stopOrphanedTasks = () => {
    // No renderer remains to validate/apply the result. Do not keep an orphaned
    // prompt or power assertion alive after a crash, reload or window closure.
    authoringBridge?.close();
    hermesRuntime?.close();
    aiBackground?.releaseOwner(rendererOwner);
  };
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) stopOrphanedTasks();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    stopOrphanedTasks();
    if (details.reason !== 'clean-exit') captureDiagnostic({source:'main',category:'renderer',code:'RENDER_PROCESS_GONE',stage:'process',message:`Renderer ${details.reason}; exitCode=${details.exitCode}`});
  });
  win.webContents.once('destroyed', () => { stopOrphanedTasks(); aiBackground?.detach(rendererOwner); });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  // Shared prototypes open in the system browser, never in an editor window
  // carrying the desktop preload bridge.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const distIndex = path.join(__dirname, '../dist/index.html');

  if (!app.isPackaged) {
    const devReady = await ensureDevServerReady(5173);
    if (devReady) {
      await mainWindow.loadURL(devServerUrl);
      return;
    }
  }

  if (fs.existsSync(distIndex)) {
    await mainWindow.loadFile(distIndex);
  } else {
    await mainWindow.loadURL(devServerUrl);
  }
}

// 1. Select a local directory on computer when creating a new project (IDEA style)
handleIpc('pflow:default-projects-directory', () => {
  try {
    return path.join(app.getPath('documents'), 'AlexProjects');
  } catch {
    return path.join(os.homedir(), 'AlexProjects');
  }
});

handleIpc('pflow:select-directory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: tr('选择保存 .pflow 二进制工程文件的电脑目录', 'Select Directory to Save .pflow Project'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return { selected: false };
  return { selected: true, directoryPath: filePaths[0] };
});

// 2. Write binary .pflow Uint8Array directly to chosen directory or via save dialog
handleIpc('pflow:write-binary-project', async (event, { dirPath, fileName, binaryBytes }) => {
  assertMainRenderer(event);
  let targetFilePath = dirPath ? path.join(dirPath, fileName) : null;
  if (!targetFilePath) {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: tr('保存 Alex 二进制工程文件 (.pflow)', 'Save Alex Binary Project (.pflow)'),
      defaultPath: fileName || 'project.pflow',
      filters: [{ name: 'Alex Binary Archive (.pflow)', extensions: ['pflow'] }],
    });
    if (canceled || !filePath) return { saved: false };
    targetFilePath = filePath;
  }

  return saveProjectArchive({ projectId: projectIdentity(Buffer.from(binaryBytes)), dirPath: path.dirname(targetFilePath), fileName: path.basename(targetFilePath), binaryBytes }, { allowCreate: true });
});

handleIpc('pflow:save-current-project', (event, input) => {
  assertMainRenderer(event);
  return saveProjectArchive(input);
});

// 2b. Expand and write file-level Git workspace tree + binary bundle to disk
handleIpc(
  'pflow:write-unpacked-git-tree',
  async (event, { rootDirPath, files, binaryBundle }) => {
    assertMainRenderer(event);
    let targetDir = rootDirPath;
    if (!targetDir) {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: tr('选择展开 Git 文件级工程结构的电脑目录', 'Select Directory to Unpack Git Project Tree'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (canceled || !filePaths.length) return { saved: false };
      targetDir = filePaths[0];
    }

    // Check the archive identity before touching an existing workspace's exports.
    if (binaryBundle) {
      await saveProjectArchive({ projectId: projectIdentity(Buffer.from(binaryBundle.binaryBytes)), dirPath: path.join(targetDir, 'bundle'), fileName: binaryBundle.fileName, binaryBytes: binaryBundle.binaryBytes }, { allowCreate: true });
    }
    for (const entry of files) {
      const fullPath = path.join(targetDir, entry.relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, entry.encoding === 'base64' ? Buffer.from(entry.content, 'base64') : entry.content, entry.encoding === 'base64' ? undefined : 'utf-8');
    }

    return { saved: true, targetDir, fileCount: files.length + (binaryBundle ? 1 : 0) };
  }
);

// Read a previously selected project at its recorded location.
handleIpc('pflow:read-binary-project', async (_event, { dirPath, fileName }) => {
  if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath) || typeof fileName !== 'string' ||
      !fileName || path.basename(fileName) !== fileName) throw new Error(tr('工程路径无效，请重新选择文件', 'Invalid project path. Please select the file again.'));
  return { binaryBytes: new Uint8Array(await fs.promises.readFile(path.join(dirPath, fileName))) };
});

function assertAuthoringRenderer(event) {
  if (!isMainRendererEvent(event)) throw new Error('Unauthorized desktop authoring caller');
  const page = new URL(event.senderFrame.url);
  if (page.protocol === 'file:' && path.resolve(require('node:url').fileURLToPath(page)) === path.resolve(__dirname, '../dist/index.html')) return;
  const dev = new URL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  if (!app.isPackaged && page.origin === dev.origin) return;
  throw new Error('Desktop authoring requires the Alex editor');
}
handleIpc('pflow:mcp-live-open', (event, input) => {
  assertAuthoringRenderer(event);
  authoringBridge ??= require('./desktop-authoring.cjs').createDesktopAuthoringBridge(
    path.join(app.getPath('userData'), 'authoring'), request => mainWindow.webContents.send('pflow:mcp-live-request', request)
  );
  return authoringBridge.open(input);
});
handleIpc('pflow:mcp-capture', (event, { sessionId, requestId, snapshot }) => {
  assertAuthoringRenderer(event);
  if (!authoringBridge) throw new Error('Desktop connection closed');
  const signal = authoringBridge.requestSignal(sessionId, requestId);
  return require('./capture-preview.cjs').capturePreview(new URL('capture.html', event.senderFrame.url).href, snapshot, signal);
});
handleIpc('pflow:mcp-live-close', (event, sessionId) => {
  assertAuthoringRenderer(event);
  authoringBridge?.close(sessionId);
});
ipcMain.on('pflow:mcp-live-reply', (event, result) => {
  if (isMainRendererEvent(event)) authoringBridge?.reply(result);
});
handleIpc('pflow:mcp-install-skill', (event, client) => {
  assertAuthoringRenderer(event);
  return require('./desktop-authoring.cjs').installDesignerSkill(client, os.homedir(),
    path.join(__dirname, '../skills/alex-protoflow-designer'), process.env.CODEX_HOME);
});

function currentConnectionFile(sessionId) {
  if (!authoringBridge) throw new Error('Desktop connection closed');
  return authoringBridge.connectionFile(sessionId);
}
handleIpc('pflow:mcp-install-plugin', (event, sessionId) => {
  assertAuthoringRenderer(event);
  const connectionFile = currentConnectionFile(sessionId);
  const { installPlugin } = require('./generated/client-integrations.cjs');
  return installPlugin(path.resolve(__dirname, '..'), app.getPath('home'), { executable: process.execPath, connectionFile });
});
handleIpc('pflow:mcp-export-extension', async (event, sessionId) => {
  assertAuthoringRenderer(event);
  currentConnectionFile(sessionId);
  const { name, claudeBundle, writeAtomic } = require('./generated/client-integrations.cjs');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('downloads'), name + '.mcpb'),
    filters: [{ name: 'Claude Desktop Extension', extensions: ['mcpb'] }],
  });
  if (canceled || !filePath) return null;
  assertAuthoringRenderer(event);
  const connectionFile = currentConnectionFile(sessionId);
  writeAtomic(filePath, claudeBundle(path.resolve(__dirname, '..'), connectionFile));
  return filePath;
});

handleIpc('pflow:mcp-runtime-info', (event) => {
  if (!isMainRendererEvent(event)) throw new Error(tr('不允许的 MCP 配置查询调用', 'Unauthorized MCP config query'));
  const bundled = path.join(__dirname, 'generated/spec-mcp-server.cjs');
  const unpacked = bundled.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  const scriptPath = unpacked !== bundled && fs.existsSync(unpacked) ? unpacked : bundled;
  return {
    execPath: process.execPath,
    scriptPath,
    isPackaged: app.isPackaged,
    homeDir: os.homedir(),
    pathSep: path.sep,
  };
});

handleIpc('pflow:trash-project', async (event, input) => {
  if (!isMainRendererEvent(event)) throw new Error(tr('不允许的工程删除调用', 'Unauthorized project deletion call'));
  return require('./project-files.cjs').trashProjectArchive(input, file => require('electron').shell.trashItem(file));
});

// 3. Open an existing binary .pflow file from disk
handleIpc('pflow:open-binary-project', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: tr('打开本地 Alex 二进制工程文件 (.pflow)', 'Open Local Alex Project (.pflow)'),
    properties: ['openFile'],
    filters: [{ name: 'Alex Binary Archive (.pflow)', extensions: ['pflow'] }],
  });

  if (canceled || !filePaths.length) return { opened: false };
  const buf = fs.readFileSync(filePaths[0]);
  return {
    opened: true,
    filePath: filePaths[0],
    dirPath: path.dirname(filePaths[0]),
    fileName: path.basename(filePaths[0]),
    binaryBytes: new Uint8Array(buf),
  };
});

// Legacy string save fallback
handleIpc('pflow:save-file', async (_event, bundleJsonString) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: tr('保存 Alex 桌面工程产物包 (.pflow)', 'Save Alex Project Bundle (.pflow)'),
    defaultPath: tr('未命名原型项目.pflow', 'Untitled-Prototype.pflow'),
    filters: [
      { name: 'Alex Project Bundle (.pflow)', extensions: ['pflow'] },
      { name: tr('所有文件', 'All Files'), extensions: ['*'] },
    ],
  });

  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, bundleJsonString, 'utf-8');
  return { saved: true, filePath };
});

handleIpc('pflow:get-locale', () => getMainLocale());
handleIpc('pflow:set-locale', async (event, locale) => {
  if (!isMainRendererEvent(event)) return getMainLocale();
  const next = setMainLocale(locale);
  if (hermesManagementWindow && !hermesManagementWindow.isDestroyed()) {
    hermesManagementWindow.setTitle(tr('AI 管理中心 · Hermes', 'AI Engine Center · Hermes', next));
    await syncHermesDashboardWindowLocale(hermesManagementWindow, next);
  }
  return next;
});

// Native OS theme synchronization
handleIpc('pflow:set-window-mode', (_event, mode) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mode === 'workspace') {
    mainWindow.setResizable(true);
    mainWindow.setMaximizable(true);
    mainWindow.setFullScreenable(true);
    const minimum = fitToDisplay({ width: 1180, height: 740 }, 1);
    mainWindow.setMinimumSize(minimum.width, minimum.height);
    mainWindow.setTrafficLightPosition?.({ x: 14, y: 12 });
    const workspace = fitToDisplay(WORKSPACE_SIZE);
    mainWindow.setSize(workspace.width, workspace.height, true);
  } else {
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    const welcome = fitToDisplay(WELCOME_SIZE);
    mainWindow.setMinimumSize(welcome.width, welcome.height);
    mainWindow.setSize(welcome.width, welcome.height, true);
    mainWindow.setTrafficLightPosition?.({ x: 16, y: 14 });
    mainWindow.setResizable(false);
    mainWindow.setMaximizable(false);
    mainWindow.setFullScreenable(false);
  }
  mainWindow.center();
  return true;
});

handleIpc('pflow:set-native-theme', (_event, mode) => {
  if (mode === 'light' || mode === 'dark' || mode === 'system') {
    nativeTheme.themeSource = mode;
  }
  return nativeTheme.shouldUseDarkColors;
});

// Hermes owns inference, credentials and conversations; Alex hosts ACP and project tools.
const { HermesRuntime } = require('./hermes-runtime.cjs');
let hermesRuntime;
let hermesManagement;
let hermesManagementWindow;
let hermesAccounts;
const { HermesAccounts } = require('./hermes-accounts.cjs');
const { HermesManagement, MANAGEMENT_ROUTES, syncHermesDashboardWindowLocale } = require('./hermes-management.cjs');
function isMainRendererEvent(event) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}
function emitHermes(event) {
  if (event.type === 'environment-changed') {
    hermesManagement?.stopDashboard();
    if (hermesManagementWindow && !hermesManagementWindow.isDestroyed()) hermesManagementWindow.close();
    return;
  }
  if (event.type === 'context-error') captureDiagnostic({source:'main',category:'ai',code:'CONTEXT_BRIDGE_FAILED',stage:'context',message:'AI 上下文连接异常',context:event});
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('pflow:hermes-event', event);
  }
}
function getHermesRuntime() {
  if (!hermesRuntime) hermesRuntime = new HermesRuntime({
    accountProvider: () => publishingClient ? { ...publishingClient.diagnosticAccount(), serviceUrl: publishingClient.serviceUrl } : { status: 'unknown' },
    dataDir: path.join(app.getPath('userData'), 'hermes-integration'),
    managedHome: path.join(app.getPath('userData'), 'hermes-management', 'hermes-home'),
    emit: emitHermes,
    diagnostic: input => captureDiagnostic({ ...input, context: { ...input.context,
      checks: [...(input.context?.checks ?? []), ...(aiBackground?.checks(input.context) ?? [])] } }),
    deleteHistorySession: (sessionId, identity) => getHermesManagement().deleteHistorySession(sessionId, identity),
    validateDecodedImage: bytes => {
      const image = require('electron').nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error(tr('图片内容无法识别，请重新选择图片', 'Image content cannot be recognized. Please choose another image.'));
      const { width, height } = image.getSize();
      if (width * height > 40_000_000) throw new Error(tr('图片分辨率过大，请缩小到 4000 万像素以内', 'Image resolution is too large. Please resize below 40 megapixels.'));
    },
  });
  return hermesRuntime;
}
function getHermesManagement() {
  if (!hermesManagement) hermesManagement = new HermesManagement({
    runtime: getHermesRuntime(), dataDir: path.join(app.getPath('userData'), 'hermes-management'), emit: emitHermes,
  });
  return hermesManagement;
}
function assertMainRenderer(event) {
  if (!isMainRendererEvent(event))
    throw new Error(tr('此窗口没有管理 AI 的权限', 'This window is not authorized to manage AI'));
}
function getHermesAccounts() {
  if (!hermesAccounts) hermesAccounts = new HermesAccounts({ management: getHermesManagement(), openExternal: url => require('electron').shell.openExternal(url) });
  return hermesAccounts;
}
for (const method of ['list', 'saveKey', 'removeKey', 'start', 'openLogin', 'poll', 'submit', 'cancel', 'disconnect']) {
  handleIpc(`pflow:hermes-accounts-${method}`, (event, payload) => { assertMainRenderer(event); return getHermesAccounts()[method](payload); });
}
async function openHermesManagement(section) {
  if (typeof section !== 'string' || !Object.hasOwn(MANAGEMENT_ROUTES, section)) throw new Error(tr('未知的 AI 管理页面', 'Unknown AI management section'));
  const url = await getHermesManagement().managementUrl(section);
  const origin = new URL(url).origin;
  // This window never receives Alex's privileged preload/IPC API.
  if (!hermesManagementWindow || hermesManagementWindow.isDestroyed()) {
    const winTitle = tr('AI 管理中心 · Hermes', 'AI Engine Center · Hermes');
    const win = new BrowserWindow({
      parent: mainWindow, width: 1180, height: 820, minWidth: 880, minHeight: 620,
      title: winTitle, show: false, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
        additionalArguments: [`--alex-locale=${isMainEn() ? 'en' : 'zh'}`],
        preload: path.join(__dirname, 'hermes-dashboard-preload.cjs') },
    });
    if (process.platform !== 'darwin') {
      win.setMenuBarVisibility(false);
    }
    hermesManagementWindow = win;
    const external = value => {
      try {
        if (new URL(value).protocol === 'https:') void require('electron').shell.openExternal(value);
      } catch {}
    };
    win.webContents.on('will-navigate', (event, target) => {
      if (new URL(target).origin !== win.managementOrigin) { event.preventDefault(); external(target); }
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (new URL(target).origin === win.managementOrigin) void win.loadURL(target);
      else external(target);
      return { action: 'deny' };
    });
    win.webContents.on('page-title-updated', event => { event.preventDefault(); win.setTitle(tr('AI 管理中心 · Hermes', 'AI Engine Center · Hermes')); });
    win.on('closed', () => {
      if (hermesManagementWindow === win) hermesManagementWindow = null;
      emitHermes({ type: 'management-closed' });
    });
  }
  const win = hermesManagementWindow;
  win.managementOrigin = origin;
  await win.loadURL(url);
  await syncHermesDashboardWindowLocale(win, getMainLocale());
  win.show(); win.focus();
  return { opened: true };
}
const { sanitizeFailureEnvelope, runHermesExecuteIpc } = require('./hermes-ipc-envelope.cjs');
const hermesMethods = {
  'save-images': 'saveImages', 'read-image': 'readImage',
  detect: 'detect', connect: 'connect', session: 'session', 'delete-project-chat':'deleteProjectChat', model: 'setModel', reasoning: 'reasoning', context: 'context',
  execute: 'execute', 'complete-recovery': 'completeRecovery', cancel: 'cancel', permission: 'respondPermission', question: 'respondQuestion', sync: 'sync', update: 'update',
};
for (const [name, method] of Object.entries(hermesMethods)) {
  handleIpc(`pflow:hermes-${name}`, async (event, payload) => {
    assertMainRenderer(event);
    if (['connect', 'execute', 'session', 'reasoning', 'update'].includes(name)) getHermesManagement().assertIdle();
    if (name === 'update') { getHermesManagement().assertNoChat(); getHermesManagement().stopDashboard(); }
    if (name === 'execute') {
      return runHermesExecuteIpc(
        payload,
        cleanPayload => getAiBackground().run(cleanPayload, event.sender.id, () => getHermesRuntime().execute(cleanPayload)),
        captureDiagnostic,
      );
    }
    return getHermesRuntime()[method](payload);
  });
}
handleIpc('pflow:hermes-disconnect', event => {
  assertMainRenderer(event); getHermesManagement().assertIdle(); getHermesManagement().assertNoChat();
  return getHermesRuntime().close();
});
handleIpc('pflow:hermes-install-state', event => { assertMainRenderer(event); return getHermesManagement().snapshot(); });
handleIpc('pflow:hermes-install', event => { assertMainRenderer(event); return getHermesManagement().startInstall(); });
handleIpc('pflow:hermes-repair', event => { assertMainRenderer(event); return getHermesManagement().startInstall({ repair: true }); });
handleIpc('pflow:hermes-install-cancel', event => { assertMainRenderer(event); return getHermesManagement().cancelInstall(); });
handleIpc('pflow:hermes-install-log', async event => {
  assertMainRenderer(event);
  const log = path.join(getHermesManagement().dataDir, 'hermes-home', 'logs', 'install.log');
  if (!fs.existsSync(log)) throw new Error(tr('安装器尚未生成日志，请检查网络后重试', 'Installer log has not been generated yet. Check your network and retry.'));
  const error = await require('electron').shell.openPath(log);
  if (error) throw new Error(tr('无法打开安装日志，请检查系统是否有可用的文本查看器', 'Unable to open install log. Please check if a text viewer is available.'));
});
handleIpc('pflow:hermes-management', (event, { section }) => { assertMainRenderer(event); return openHermesManagement(section); });
handleIpc('pflow:hermes-install-guide', () => require('electron').shell.openExternal('https://hermes-agent.nousresearch.com/docs/getting-started/installation'));

app.whenReady().then(() => {
  initMainI18n(app);
  try { getDiagnostics(); } catch { diagnosticInitError = tr('诊断存储初始化失败', 'Diagnostics storage initialization failed'); }
  installApplicationMenu({ app, Menu, locale: getMainLocale(), editor: () => mainWindow });
  const iconPath = path.join(__dirname, '../public/icon.png');
  if (process.platform === 'darwin' && app.dock && fs.existsSync(iconPath)) {
    try {
      app.dock.setIcon(iconPath);
    } catch {
      // ignore
    }
  }
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

function stopApplicationServices() {
  authoringBridge?.close();
  aiBackground?.close();
  taskNotification?.close();
  diagnostics?.close();
  hermesManagement?.close();
  hermesRuntime?.close();
  if (managedViteProcess) {
    try {
      managedViteProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    managedViteProcess = null;
  }
}
app.on('will-quit', stopApplicationServices);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
