const { tr, onMainLocaleChange } = require('./i18n.cjs');

function buildDarwinMenu(Menu, locale) {
  // macOS editing shortcuts rely on native menu roles even when hidden.
  const editing = ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll', 'close']
    .map(role => ({ role, visible: false, acceleratorWorksWhenHidden: true }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Alex', submenu: [
      { role: 'about', label: tr('关于 Alex', 'About Alex', locale) }, ...editing,
      { type: 'separator' }, { role: 'hide', label: tr('隐藏 Alex', 'Hide Alex', locale) },
      { type: 'separator' }, { role: 'quit', label: tr('退出 Alex', 'Quit Alex', locale) },
    ],
  }]));
}

function installApplicationMenu({ app, Menu, platform = process.platform, locale }) {
  if (platform === 'darwin') {
    buildDarwinMenu(Menu, locale);
    onMainLocaleChange(nextLocale => buildDarwinMenu(Menu, nextLocale));
  } else Menu.setApplicationMenu(null);
  app.on('browser-window-created', (_event, window) => {
    if (platform !== 'darwin') {
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
