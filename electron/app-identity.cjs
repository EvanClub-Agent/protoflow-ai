const fs = require('node:fs');
const path = require('node:path');

function initializeApplicationIdentity(app) {
  // Releases before Alex used package.name = protoflow-ai on every OS. Keep
  // both native settings and Chromium storage in that exact profile so the
  // rename preserves recent projects, credentials, conversations and updates.
  const profile = path.join(app.getPath('appData'), 'protoflow-ai');
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  // Electron also derives the macOS Keychain/Linux secret-store namespace from
  // getName(). Keep it stable; windows, menus and bundle metadata display Alex.
  app.setName('protoflow-ai');
  app.setAboutPanelOptions({ applicationName: 'Alex' });
}

module.exports = { initializeApplicationIdentity };
