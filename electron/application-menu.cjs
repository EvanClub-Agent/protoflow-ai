const { tr, onMainLocaleChange } = require('./i18n.cjs');

function buildDarwinMenu(Menu, locale, undo) {
  // macOS editing shortcuts rely on native menu roles even when hidden.
  const editing = ['redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll', 'close']
    .map(role => ({ role, visible: false, acceleratorWorksWhenHidden: true }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Alex', submenu: [
      { role: 'about', label: tr('关于 Alex', 'About Alex', locale) }, {
        id: 'alex-undo', label: tr('撤销', 'Undo', locale), accelerator: 'Command+Z', visible: false,
        acceleratorWorksWhenHidden: true, click: (_item, win) => undo(win),
      }, ...editing,
      { type: 'separator' }, { role: 'hide', label: tr('隐藏 Alex', 'Hide Alex', locale) },
      { type: 'separator' }, { role: 'quit', label: tr('退出 Alex', 'Quit Alex', locale) },
    ],
  }]));
}

function installApplicationMenu({ app, Menu, platform = process.platform, locale, editor = () => null }) {
  async function undo(win) {
    const wc = win?.webContents;
    if (!wc || win !== editor() || !wc.isFocused() || wc.isDevToolsFocused() || wc.focusedFrame !== wc.mainFrame) {
      Menu.sendActionToFirstResponder('undo:');
      return;
    }
    const frame = wc.mainFrame;
    // The editor cancels this event only after consuming a project undo.
    const native = await frame.executeJavaScript("window.dispatchEvent(new Event('alex-project-undo', { cancelable: true }))").catch(() => true);
    if (native && !wc.isDestroyed() && win.isFocused() && wc.focusedFrame === frame) wc.undo();
  }
  if (platform === 'darwin') {
    buildDarwinMenu(Menu, locale, undo);
    onMainLocaleChange(nextLocale => buildDarwinMenu(Menu, nextLocale, undo));
  } else Menu.setApplicationMenu(null);
  app.on('browser-window-created', (_event, window) => {
    if (platform === 'darwin') {
      window.webContents.on('before-input-event', (event, input) => {
        if (window === editor() && input.type === 'keyDown' && input.meta && !input.control && !input.alt &&
            !input.shift && !input.isComposing && input.key.toLowerCase() === 'z') {
          event.preventDefault();
          void undo(window);
        }
      });
    } else {
      window.removeMenu();
      // Ctrl+Q used to come from the default File menu. Keep it without a menu bar.
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.control && !input.alt && !input.shift) {
          if (input.key.toLowerCase() === 'q') { event.preventDefault(); app.quit(); }
          else if (input.key.toLowerCase() === 'w') { event.preventDefault(); window.close(); }
        }
      });
    }
  });
}
module.exports = { installApplicationMenu };
