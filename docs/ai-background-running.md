# AI 熄屏与锁屏后台运行

## 问题与证据

用户场景：macOS 自动熄屏或手动锁屏，屏幕没有合盖，AI 生成报 `Internal error`。旧代码没有任务级 `powerSaveBlocker`，主窗口使用默认后台节流。日志中找到过 `Internal error`，但旧记录不包含当时的锁屏/睡眠状态，因此不能认定每次错误都是睡眠导致。

2026-11-13 只读检查本机 Codex（`/Applications/ChatGPT.app`）主进程代码，确认存在 `prevent-app-suspension` 电源断言、锁屏/睡眠状态监听；`pmset -g assertions` 也显示其 Electron 防空闲睡眠断言。OpenAI 官方设置文档提供 “Prevent sleep while running”。

Codex 的 Locked Use 是另一项 Computer Use 能力，通过 Apple authorization plug-in 在受控条件下操作锁定的桌面。Alex 的生成是网络请求和本地工具调用，不需要接入自动解锁流程，也不需要录屏或辅助功能权限。

## 实现

- `electron/ai-background.cjs` 管理任务租约。项目工作流及页面 AI 在连接开始前取得租约，覆盖模型推理、宿主验收、逐页保存和页面切换；主进程另为每次 `execute` 持有租约，覆盖直接调用方。仅最后一个任务结束时恢复正常省电。
- 使用 `prevent-app-suspension`，允许屏幕熄灭。任务期间关闭主窗口后台节流，结束后恢复原值。锁屏不会取消任务。窗口重载、崩溃、销毁和应用退出清理任务及保护。
- 顶部工具栏“AI 后台运行”提供防自动睡眠开关、当前保护状态和锁屏通知开关。设置保存在用户目录 `ai-background.json`。默认开启；停用防睡眠后仍保留运行中的页面调度。
- 锁屏时发送通用运行/结束/失败通知，不显示项目名称、需求或生成内容。解锁、停用通知和任务结束会清理过期运行提示。系统通知显示受平台支持、通知权限及专注模式影响；macOS 要求正确签名的应用。这里不是锁屏常驻进度组件。
- `suspend` 与 `resume` 和锁屏事件分别记录。只有真实收到睡眠事件的任务失败时，才附加“任务期间系统曾进入睡眠”说明，保留原始错误。不自动重放写工具或重试整轮。
- 诊断保留 ACP 数字错误码与请求方法，不保存 `error.data`。现有 `context.checks` 白名单承载 `power-protection`、`screen-state`、`system-state`、`task-suspend` 和带时间戳的 `power-event`，无需新增数据库字段。

## 验证与限制

运行 `npm test`、`npm run build`、`npm run build:viewer`。`node scripts/ai-background-smoke.cjs` 使用隔离的真实 Electron 进程，验证 preload、隐藏窗口、设置界面、原生防睡眠断言和窗口销毁释放。macOS 下通过 `pmset` 按测试进程 PID 核验防系统空闲睡眠断言，确认没有防屏幕熄灭断言。

冒烟测试中的锁屏事件是模拟事件，通知使用测试适配器。没有锁定用户正在工作的电脑，也没有实际进行长时间锁屏模型生成测试。仍需在正式签名安装包上执行一次“多页生成 → 手动锁屏/自动熄屏 → 解锁核验保存与通知”的现场验收。

手动睡眠、合盖、关机、断网和操作系统电源策略仍可能中断本地生成。防空闲睡眠不会解决模型服务自身的错误。macOS 已验证原生电源断言；Windows/Linux 共用 Electron API，仍需对应平台验证。

本改动尚未打包发布，线上现有 `0.0.6` 安装包不包含本次后台运行保护；服务器更新不能替代客户端更新。现有 104 诊断数据库可以接收上述结构化证据，不需要重新部署后端。

## 参考

- [OpenAI 桌面设置](https://learn.chatgpt.com/docs/app/settings)
- [OpenAI Computer Use / Locked use](https://learn.chatgpt.com/docs/computer-use)
- [Electron powerSaveBlocker](https://www.electronjs.org/docs/latest/api/power-save-blocker)
- [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor)
- [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electron Notification](https://www.electronjs.org/docs/latest/api/notification)
