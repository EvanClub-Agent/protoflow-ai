# Alex 桌面应用打包

使用锁定版本的 electron-builder 构建 Electron 安装包。首次构建先运行 `npm ci`；本项目使用 Node.js 24 验证。

## 命令与产物

在项目根目录运行：

| 命令 | 平台 / 架构 | 输出 |
| --- | --- | --- |
| `npm run build:win` | Windows x64 | NSIS 安装程序 `.exe`，可选择安装目录 |
| `npm run build:mac` | macOS，默认当前电脑架构 | `.dmg`、`.zip` |
| `npm run build:mac:arm64` | macOS Apple Silicon | `.dmg`、`.zip` |
| `npm run build:mac:x64` | macOS Intel | `.dmg`、`.zip` |
| `npm run build:linux` | Linux x64 | `.deb`、`.AppImage`、`.AppImage.zsync`、`.tar.gz` |
| `npm run build:linux:deb` | Linux x64（Debian 架构名 `amd64`） | 仅 `.deb` 安装包 |
| `npm run build:unpacked` | 当前系统 / 架构 | 解包应用目录，用于快速检查，不生成安装程序 |

以上命令会先执行 TypeScript 检查和桌面 React 构建，再打包 Electron。所有桌面产物放在 `release/`，AppImage 使用 `ProtoFlow_AI-<版本>-<架构>.AppImage`，其他安装包使用 `Alex-<版本>-<系统>-<架构>.<扩展名>`。版本来自根目录 `package.json`。

`npm run build` 仍然只生成桌面 renderer 的 `dist/`，不生成安装包；`npm run build:viewer` 仍然只生成远程演示网站的 `dist-viewer/`。

## Alex 改名兼容（0.1.3 起）

Linux 应用菜单显示 **ProtoFlow AI**，桌面入口文件仍为 `protoflow-ai.desktop`。仓库 URL 和既有服务器部署路径保持原样。

为让现有用户继续使用项目、更新配置与发布凭证，应用 ID `com.protoflow.ai`、内部 Electron 名称 `protoflow-ai`、用户数据和浏览器会话目录均保留。内部名称还关联 macOS Keychain / Linux 密钥存储，不能随显示名称直接替换；应用窗口与关于面板沿用 Alex。参见 [Electron 应用路径文档](https://www.electronjs.org/docs/latest/api/app) 与 [当前 Electron 版本的密钥存储初始化](https://github.com/electron/electron/blob/v45.1.0/shell/browser/electron_browser_main_parts.cc#L610)。

Linux 保留 Debian 包名、桌面入口 ID 与可执行文件名 `protoflow-ai`，由包管理器覆盖原安装。新文件安装到 `/opt/Alex`，包内保留旧绝对路径的兼容启动脚本，使 0.1.2 更新器安装后仍能自动重启。macOS 新包为 `Alex.app`；从旧名称首次升级时，安装后退出旧应用并打开 Alex。

`.pflow` 格式、MCP 工具名、IPC 通道、浏览器存储键与服务端协议标识保持兼容。在线演示端和版本中心源码已统一名称，服务机需在发布时同步 `build:viewer` 产物；本次改名不自动切换线上版本。

## AppImage 与增量更新

Linux 构建机需要 `binutils`（`readelf`）和 `zsync`（`zsyncmake`）。在 macOS 上交叉打包时可用 `brew install binutils zsync` 安装工具，并将 Homebrew 的 binutils/bin 目录加入 `PATH`。AppImage 使用静态链接的 Type 2 运行时，挂载时无需系统提供 `libfuse2`。Electron 仍使用目标发行版的系统库。

将 AppImage 与同名 `.zsync` 上传到同一个 GitHub Release 后，AppImageUpdate 会按架构在最新稳定版中查找更新。旧版 `Alex-*.AppImage` 缺少更新地址，用户首次迁移可使用应用内更新或手动下载。应用内更新继续使用版本中心的签名清单。

## Debian / Ubuntu 安装

只生成 DEB 安装包：

```sh
npm run build:linux:deb
```

将生成的 `release/Alex-0.1.4-linux-amd64.deb` 拷贝到 Debian / Ubuntu x86_64 电脑，在安装包所在目录运行（版本号随 `package.json` 更新）：

```sh
sudo apt install ./Alex-0.1.4-linux-amd64.deb
```

APT 会处理安装包声明的系统依赖。安装完成后，可从应用菜单打开 **Alex**，也可在桌面会话的终端运行 `protoflow-ai`。从 0.1.2 起，后续更新在应用的“软件更新”页面点击“立即更新”，由系统弹窗完成授权后自动安装并重启，无需输入终端命令；卸载使用 `sudo apt remove protoflow-ai`。参见 [Debian APT 使用说明](https://manpages.debian.org/bookworm/apt/apt.8.en.html)。

## 面向使用者的一键更新（0.1.2 起）

发行配置集中在 `electron/update-channel.cjs`，随三端安装包收录。开源仓库默认将 `electron/service-origin.json` 与 `trustedPublicKey` 留空，使编译出的客户端纯本地开箱即用，不向任何第三方服务器发起更新请求。团队或维护者在构建私有分发安装包时，可在 `electron/service-origin.json` 中填写自建更新服务地址，并在 `electron/update-channel.cjs` 中写入对应的 32 字节 Ed25519 公钥（私钥仅保存在服务端）。更换发行服务器或签名密钥需由维护者修改配置并重新打包，运行中的客户端不会自动信任未预置的新公钥。

普通使用者安装后直接“检查更新 → 立即更新”。应用自动选择推荐包、验证数字签名与文件摘要、保存工程并安装。从 0.1.4 起彻底移除高级设置、服务地址、通道选择及保存设置入口，preload 和主进程不再提供配置修改接口。发行包固定使用内置地址、通道与公钥，忽略旧 `updater.json` 中的地址/通道/公钥以及运行时环境变量覆盖；旧文件无需用户清理。更新服务与原型发布设置相互独立。

Debian/Ubuntu 使用 `pkexec --disable-internal-agent /usr/bin/apt-get --yes install <已校验的包>`，以参数数组执行，不通过 shell，也不读取或保存管理员密码。DEB 声明 `pkexec`、`polkitd` 依赖，图形认证代理由桌面会话提供。用户取消授权、安装失败时保留已下载包以便重试；仅安装成功才自动重启。安装期间阻止退出和切换更新源；工程保存失败、更新源变化、包被篡改或有进行中的 AI 任务时不会安装。该授权机制依据 [polkit pkexec 文档](https://www.freedesktop.org/software/polkit/docs/latest/pkexec.1.html)。

此前的 0.1.0/0.1.1 安装包未内置公钥，需要由管理员分发 0.1.2 覆盖安装一次，之后使用应用内更新。已发布的 0.1.1 保持原样，不通过关闭签名校验来迁移。

Hermes 是独立的 AI 组件升级渠道，不使用 Alex 的内网版本服务器。服务器上的旧 Hermes 更新日志显示读取 GitHub 稳定版标签超时；2026-11-06 在该服务器重新执行版本检查已成功，返回稳定版 v0.23.0。暂时连接失败时提示下载服务连接问题，不再展示 Electron 的内部 IPC 错误前缀。

如果此前安装过同为 `0.1.0` 的缺图标版本，请使用修复后的 DEB 覆盖重装：`sudo apt install --reinstall ./ProtoFlow-AI-0.1.0-linux-amd64.deb`。标准 hicolor 主题的包触发器会重新生成图标缓存。

DEB 安装的是桌面设计器，需要图形桌面环境；远程演示的 Go / Nginx 服务仍使用独立部署流程。工程文件和 Hermes 配置不属于 DEB 的安装内容。

## 构建环境

- 建议分别在 Windows、macOS、Linux 上执行对应命令。macOS 安装包需要 macOS 构建环境；跨平台生成 Windows 安装程序可能需要 Wine，Linux AppImage 需要对应的打包工具与系统环境。
- 首次构建需要联网下载目标平台的 Electron 运行时和安装包工具。`npm ci` 后仍可能发生这些下载。
- macOS 默认构建本机架构；两个显式架构命令可分别生成 Intel 和 Apple Silicon 版本。
- Linux ARM64 可运行 `npm run build:unpacked -- --linux --arm64` 生成解包应用；需要完整安装包时运行 `npm run build && npx electron-builder --config electron-builder.config.cjs --linux --arm64 --publish never`。
- macOS 本地构建默认执行完整 ad-hoc 签名，将签名身份绑定到 `com.protoflow.ai`。指定 `CSC_NAME` 时使用该证书；指定 `CSC_LINK` 时交由 electron-builder 从导入证书中选择。仅在钥匙串安装证书的正式构建也需设置 `CSC_NAME`（或显式覆盖 `mac.identity`）。当前配置没有提供证书或公证凭据；ad-hoc 签名不等于 Developer ID 签名或 Apple 公证。正式分发时按 [electron-builder 签名文档](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/) 配置证书与公证，勿提交凭据文件。
- 所有命令均使用 `--publish never`，只生成本地文件，不上传 release。

## 打包范围

配置位于 `electron-builder.config.cjs`，只收录 `dist/`、Electron 原生适配代码、应用图标和运行所需的 `package.json`。React 等前端依赖已编译进 renderer；Electron 主进程仅使用 Node.js / Electron 内置模块，不需要随包复制开发目录的 `node_modules/`。

项目 AI 和单页 AI 聊天的推理强度保存在各自的 Hermes 会话中。包内的 `electron/hermes-reasoning.py` 使用当前连接的 Hermes 启动器提供的 Python 运行时，向同一配置目录的网关读取和修改会话。无需安装系统 Python，也不会把某个对话的档位写入全局配置。若 Hermes 版本未提供对应接口，输入栏会提示无法调整，聊天仍可使用。

Linux 图标使用 `build/icon.icns` 作为多尺寸来源，由 electron-builder 转换为 PNG 集合并安装到 `hicolor` 主题。不要直接改成单张 `public/icon.png`：当前打包器会原样安装这张 1024px 图片，不会生成桌面需要的其他尺寸；只检查“包里有 PNG”无法验证桌面能否找到它。[freedesktop 图标规范](https://specifications.freedesktop.org/icon-theme/latest/#installing-application-icons)要求至少提供标准的 48×48 图标。

不包含本地 `.pflow` 工程、数据库和发布凭据、测试目录、Go 服务或用户的 Hermes 配置。Hermes 仍通过工具内的安装、连接和管理入口使用；在线演示服务按 `docs/web-publishing.md` 独立部署。

应用代码收录在 `app.asar` 中。Hermes 通过安装包自带的 Electron 可执行文件和 `ELECTRON_RUN_AS_NODE=1` 启动 Alex 的兼容 MCP 工具进程，因此不能禁用 Electron 的 RunAsNode fuse，除非同步替换这条运行链路。

## 验证安装包

安装版移除了默认的 File / Edit / View / Window 菜单。Windows / Linux 不显示菜单栏；macOS 只保留系统应用菜单，复制、粘贴、撤销和退出快捷键仍可用。

关闭主窗口或使用退出快捷键时，会显示支持浅色、深色主题的确认弹窗。确认后先保存项目，再退出整个程序；取消、保存失败或保存超时都会保留窗口。程序刚启动且界面尚未就绪时，使用系统确认框。`npm run test:persistence` 同时检查原生菜单配置、退出确认通信和跨进程保存恢复。

```sh
npm run build:unpacked
npm run test:package
```

`test:package` 使用当前系统对应的解包应用和它自带的运行时，检查 renderer 的相对资源路径、原生入口与 preload 是否存在、打包范围是否包含意外文件，并实际执行 Hermes MCP 的初始化、工具发现和项目读取。测试只创建临时上下文，不读取用户工程，也不调用模型。

可以传入特定解包应用路径，例如：

```sh
npm run test:package -- "release/mac-arm64/Alex.app"
```

该检查需在能运行目标可执行文件的系统上执行；跨平台成功生成安装包不等于完成目标系统上的安装和桌面交互验证。Windows / Linux 的安装、窗口交互与 Hermes 安装流程仍应在对应系统验收。

macOS 检查还会执行 `codesign --verify --deep --strict`，核对签名标识与应用 bundle ID 一致，并检查 `NSLocalNetworkUsageDescription`。不能只检查 Electron 的二进制可以启动：未重新签名的安装包可能仍带有 `Identifier=Electron` 的链接器签名，且没有绑定 `Info.plist`，导致系统无法正确关联局域网授权。

在 Debian / Ubuntu 测试环境中，可额外检查 DEB 的桌面图标：

```sh
sudo apt install python3-gi gir1.2-gtk-3.0 hicolor-icon-theme desktop-file-utils
npm run test:linux-icons -- release/Alex-0.1.4-linux-amd64.deb
```

该检查只解包到临时目录，不安装应用；它使用系统真实的 hicolor 主题和 GTK 图标查找机制，验证桌面入口以及 16–512px 的图标解析、解码。如果保留了旧包，可追加 `--previous-package /path/to/old.deb`，验证旧包缺图标的问题能够复现。无需启动图形桌面会话。

## macOS 内网更新连接失败

更新源支持内网 HTTP 地址，例如 `http://192.168.1.10:8088`。若命令行能访问 `/api/v1/updates/check`，但安装应用报网络不可达，需在「系统设置 → 隐私与安全 → 本地网络」检查 Alex 的权限，同时核验安装包签名。终端请求成功不能证明 GUI 应用已获授权。应用会显示请求的服务器地址、底层连接错误码和相应处理提示，保留服务端错误及签名校验错误的原始含义。

旧包若保留 Electron 原始链接器签名，应使用新构建覆盖安装，再从应用图标启动并重试。打包配置明确开启完整签名；不要用 `mac.identity=null` 或 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过。签名和本地网络行为依据 [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)：系统通过代码签名与可执行文件 UUID 识别程序，正式分发应使用 Apple 签发的身份；ad-hoc 构建仍需在目标机器验证授权，不保证跨更新的权限稳定性。
