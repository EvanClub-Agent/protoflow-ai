const path = require('node:path');
const { BrowserWindow } = require('electron');

/** The preview window has a private in-memory storage partition and a two-method preload. */
async function capturePreview(url, snapshot, signal) {
  signal.throwIfAborted();
  const { width, height } = snapshot;
  if (!Number.isInteger(width) || width < 1 || width > 2560 || !Number.isInteger(height) || height < 1 || height > 2160) {
    throw new Error('Invalid preview dimensions');
  }
  const win = new BrowserWindow({
    show: false, focusable: false, frame: false, useContentSize: true, enableLargerThanScreen: true,
    width, height, backgroundColor: '#ffffff', webPreferences: {
      preload: path.join(__dirname, 'capture-preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, partition: 'alex-preview',
    },
  });
  const wc = win.webContents;
  const trusted = e => e.senderFrame === wc.mainFrame && e.senderFrame.url === url;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', e => e.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, _permission, respond) => respond(false));
  wc.ipc.handle('alex-preview:data', event => {
    if (!trusted(event)) throw new Error('Unknown preview frame');
    return snapshot;
  });
  let cancel;
  const interrupted = new Promise((_, reject) => {
    cancel = () => reject(new Error('Preview capture interrupted'));
    wc.once('render-process-gone', cancel);
    wc.once('destroyed', cancel);
    signal.addEventListener('abort', cancel, { once: true });
  });
  const ready = new Promise((resolve, reject) => {
    wc.ipc.on('alex-preview:ready', (event, result) => {
      if (!trusted(event)) return;
      if (result?.error) reject(new Error(String(result.error)));
      else resolve(result?.rect);
    });
  });
  try {
    const [, rect] = await Promise.race([Promise.all([win.loadURL(url), ready]), interrupted]);
    const [w, h] = win.getContentSize();
    if (!rect || !['x', 'y', 'width', 'height'].every(k => Number.isInteger(rect[k])) ||
        rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > w || rect.y + rect.height > h) {
      throw new Error('Preview bounds exceed the rendered surface');
    }
    const image = await Promise.race([wc.capturePage(rect, { stayHidden: true }), interrupted]);
    if (image.isEmpty()) throw new Error('Empty preview capture');
    const bytes = image.toPNG({ scaleFactor: 1 });
    // PNG IHDR reports the actual pixel dimensions, including the platform backing scale.
    return { data: bytes.toString('base64'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!win.isDestroyed()) win.destroy();
  }
}
module.exports = { capturePreview };
