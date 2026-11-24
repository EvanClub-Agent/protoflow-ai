/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Preserve the installed application's identity through the Alex rename.
  appId: 'com.protoflow.ai',
  productName: 'Alex',
  directories: { output: 'release', buildResources: 'build' },
  artifactName: 'Alex-${version}-${os}-${arch}.${ext}',
  toolsets: { appimage: '1.0.3' },
  appImage: { artifactName: 'ProtoFlow_AI-${version}-${arch}.${ext}' },
  artifactBuildCompleted: require('./scripts/appimage-update.cjs'),
  asar: true,
  asarUnpack: ['electron/generated/spec-mcp-server.cjs'],
  // Renderer dependencies are bundled by Vite; native code only uses Node/Electron.
  // Keep local projects, publishing credentials and the Go server out of releases.
  files: ['LICENSE', 'dist/**/*', 'skills/alex-protoflow-designer/**/*.md', 'electron/**/*.cjs', 'electron/service-origin.json', 'electron/hermes-reasoning.py', 'electron/hermes-context.py', 'electron/hermes-rate-limit.py', 'electron/hermes-recovery-gateway.py', 'electron/hermes-acp-surface.py', 'electron/hermes-acp-runtime.py', 'public/icon.png', 'package.json', '!node_modules/**/*'],
  npmRebuild: false,
  publish: null,
  beforePack: async () => { require('./electron/update-channel.cjs').validateBundledUpdateChannel(); },
  mac: {
    icon: 'build/icon.icns',
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
    // Local builds must bind the signature to our bundle ID instead of retaining
    // Electron's linker signature. Explicit certificate settings take precedence.
    identity: process.env.CSC_NAME || (process.env.CSC_LINK ? undefined : '-'),
    extendInfo: {
      NSLocalNetworkUsageDescription: 'Alex 需要连接您配置的局域网服务器，以检查版本更新、下载安装包和发布原型。',
    },
  },
  win: {
    icon: 'public/icon.png',
    target: ['nsis'],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
  },
  linux: {
    // A single PNG is copied at its original size by electron-builder. The ICNS
    // source is converted to a PNG size set, including the standard hicolor sizes.
    icon: 'build/icon.icns',
    executableName: 'protoflow-ai',
    syncDesktopName: true,
    desktop: { entry: { Name: 'ProtoFlow AI' } },
    category: 'Development',
    target: ['deb', 'AppImage', 'tar.gz'],
  },
  deb: {
    // Same Debian package identity replaces the old installation in place.
    packageName: 'protoflow-ai',
    // The 0.1.2 updater relaunches its original absolute executable path. Keep
    // a package-owned launcher there when the application moves to /opt/Alex.
    fpm: [`${require('node:path').join(__dirname, 'build/linux-legacy-launcher.sh')}=/opt/ProtoFlow AI/protoflow-ai`],
    // Keep electron-builder's desktop dependencies, plus GBM/ALSA linked by
    // the shipped Electron executable. Newer Debian/Ubuntu call ALSA "t64".
    depends: [
      'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
      'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libgbm1',
      'libasound2t64 | libasound2', 'pkexec | policykit-1', 'polkitd | policykit-1',
    ],
  },
};
