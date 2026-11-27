# Changelog

All notable changes to **Alex (ProtoFlow AI)** are documented in this file.

## [v0.1.4] - 2026-11-27

### Added & Improved

- **腾讯云 WorkBuddy 一键免配接入（零 Node 环境门槛 · 面向国内产品经理）**：
  - 在「MCP → 双向设计」首位新增 **WorkBuddy 一键接入**卡片与强制修复能力：直接复用 Alex 内置运行底座（`ELECTRON_RUN_AS_NODE=1`）挂载托管服务端，用户电脑无需安装 Node.js / npm 或手改 JSON。
  - 原子无损合并 `~/.workbuddy/mcp.json`（同时自动兼容 `~/.workbuddy-ai` 与同源 `~/.codebuddy` 目录），完整保留用户已有的腾讯文档、企业微信、飞书、TAPD 等连接器配置，并同步安装 `alex-protoflow-designer` 技能包；后续切换 `.pflow` 工程或升级客户端自动后台同步。
- **原型画布自适应外框深浅主题与一键解锁（Adaptive Canvas Theme Sync）**：
  - 修复 AI 技能与内置提示词默认写死 `appearance="light"` / `colorMode="light"` 导致画布无法跟随外框明暗切换的问题，统一规范常规色板默认采用 `appearance="auto"`。
  - 在设计器顶部工具栏与「画布主题令牌」弹窗新增显式锁定感知与**「跟随外框主题」**一键解锁能力（自动清理常规页面硬编码明暗锁并保留 `oled_carbon` / `ocean_glow` 纯黑大屏页），同时对齐 PC 与移动端视口对 `designTokens.colorMode` 及 `<meta name="color-scheme">` 的同步。

---

## [v0.1.3] - 2026-11-27

### Added & Improved

- **领域聚合式双向 MCP 协同架构（Domain-Consolidated MCP Tools）与连接预检护栏**：
  - 将外部读写模式与桌面实时桥接工具收敛为 6 个高内聚领域工具（`protoflow_workspace`、`protoflow_sitemap`、`protoflow_database`、`protoflow_page`、`protoflow_docs`、`protoflow_audit`）加桌面专属 `protoflow_capture_preview`，显著降低外部 Agent 上下文开销与工具误选率，并同步更新 `alex-protoflow-designer` 技能手册与 `contractDigest` 签名。
  - 在 `desktopRelay` 与 `handleSpecMcpRequest` 中增加 `expectedContractDigest` 在线桥接核验（未连接打开工程时返回显式 `[CONTRACT_UNVERIFIED]` 引导），防止桌面端未就绪时误判契约状态。
- **通用主子单据跨表批量选行转入（`importSelectedRows`）与表菜单闭环审计（`tableMenuCoverage`）**：
  - 新增 `importSelectedRows(sourceTablePfId, targetTablePfId, mapping)` 运行时动作与静态契约校验（支持 `parentForeignKey`、`fieldMap`、`parentFieldMap`、`defaults` 与防重复转入校验），并在 Go 发布服务端快照白名单同步放行。
  - 新增 `tableMenuCoverage` 共享审计引擎，在内置工作流与 `protoflow_audit` 中统一核查菜单绑表未落地（`unbound_menu_table`）、主从页缺失子表新增入口（`missing_detail_create`）、兄弟页明细断链（`sibling_missing_detail`）及声明写权限但无写动作（`missing_crud_write`）。
- **项目文档（Notes）净化导出与目录导航体验优化**：
  - 加固富文本笔记 HTML 净化、导出与在线浏览端（`PublishedProjectNotes`）展示一致性，优化左侧菜单树与文档目录交互细节，并将 `fflate` 升级至 `0.8.3`。

---

## [v0.1.2] - 2026-11-26

### Added & Hardened

- **技能与服务端结构化契约摘要（`contractDigest`）确定性防漂移闭环**：
  - **跨模式同源规范化哈希（`src/mcp/contractSurface.ts`）**：基于 `tools/list` 四种真实对外工具目录（`readonly`、`local_file`、`desktop_bridge`、`desktop_bridge_with_preview`，含桌面端 `expectedRevision` 必填项）、134+ 注册物料（含平台归属 `desktop`/`mobile`/`universal`、属性默认值、嵌套约束与事件契约）、运行时动作及共享值定义计算跨 Locale 确定性摘要（`sha256:635b55e283f0eac0`），自动忽略 Schema 纯文案（`title`/`description`）修订并完整保留 `const`/`enum`/`default` 字面量业务字段。
  - **构建期自动盖章与双向跨版本平滑兼容**：构建时自动将 `metadata.serverVersion` 与 `metadata.contractDigest` 同步写入 `SKILL.md` Frontmatter、第 1 条规则、内嵌 `Skills over MCP` 清单及 `.mcpb`/`.zip` 客户端集成包；`protoflow_workspace(action="status")` 与 `protoflow_get_contracts` 暴露 `serverVersion` 与 `contractDigest`，并通过三态 `contractCheckStatus`（`unchecked` / `matched` / `mismatched`）及前置 Schema 参数探测同时兼容“旧技能连新服务”与“新技能连旧服务”。

---

## [v0.1.1] - 2026-11-26

### Added

- **原生支持 `Skills over MCP`（`io.modelcontextprotocol/skills` / SEP-2640）与 MCP `2026-07-28` 双代协议**：
  - **随服务自发版专家技能包**：`@protoflow-ai/mcp`（含独立 CLI、`.mcpb` 扩展包及桌面端 `--desktop-bridge` 实时桥接）在 `readwrite` 模式下原生声明 `io.modelcontextprotocol/skills`（`directoryRead: true`），完整实现 `server/discover`、`skills/list`、`skills/get`、`resources/directory/read` 及 `skill://alex-protoflow-designer/*` 的按需懒加载；构建期基于标准 YAML `CORE_SCHEMA` 固化完整 Frontmatter 并预计算精确 UTF-8 字节长度与 `sha256` 摘要，使兼容客户端免手动安装即可零漂移获取最新设计规程。
  - **现代与经典双代协议协商**：完整支持 MCP `2026-07-28` 逐请求 `_meta`（`protocolVersion` 与对象型 `clientCapabilities` 校验、`-32022` 版本协商错误以及 `resultType`/`ttlMs`/`cacheScope` 缓存提示），同时无损兼容 `server/discover` 探测后回退 `initialize` 握手的双代及旧版客户端。
- **内置 Hermes 按会话画像渐进式裁剪与双端 Schema 瘦身（最高节省 93.7% 工具底噪）**：
  - **四级确定性工具画像（`PROTOFLOW_TOOL_PROFILE`）**：按 ACP 会话边界将内置工具集精准拆分为 `note-assistant`（6 工具，字符量缩减 **93.7%**）、`page-exec` 多页批量生成（18 工具，缩减 **67.1%**）、`page` 单页交互（19 工具，完整保留菜单级历史检索与数据库需求原文核销，缩减 **62.2%**）及 `project` 全局会话（33 工具，缩减 **27.7%** 且保持预热会话零重绑），并同步收敛外部 MCP 工具 Schema 中的教学冗余描述。

### Fixed & Hardened

- **资源分派前置判别与 CI 内存水位加固**：
  - `resources/read` 前置校验已知资源 URI 白名单，清晰隔离客户端未知 URI 参数错误（`-32602` / 旧版 `-32002`）与工作区读取故障（`-32603`）。
  - 统一放宽 CI、桌面多架构发版与 Docker 镜像构建的 Node.js V8 堆上限至 4 GB 并关闭 Vite 冗余 gzip 体积统计缓冲，彻底消除 `macos-latest` 构建机尾声阶段的内存峰值溢出。

---

## [v0.1.0] - 2026-11-26

### Added

- **双端 MCP 架构同源收敛与能力对齐（v0.1.0 里程碑）**：
  - **共享领域原语层**：建立双轨 MCP 架构规范（`docs/mcp-architecture-alignment.md`），抽离 `src/mcp/importReshape.ts` 与 `src/mcp/capturePreview.ts` 同源纯函数并编入 `material-contract.cjs`，使内置 Hermes（候选暂存 + 宿主确认）与外部双向 MCP（`expectedRevision` 乐观锁 + 桌面实时渲染与 `Undo/Redo`）共享同一套契约校验、血缘守卫与快照构造。
  - **Axure RP 与 Figma 导入原稿检视与流式重塑开放至双向 MCP**：`protoflow_get_page_spec` 新增正交可选参数 `importView: "axure" | "figma"`（支持分页读取 `StaticTable` 表头 `pfId`、列动作一致性、邻近标签与 Figma Auto Layout 重复组，同时保持只读规格模式固定 6 个工具不变）；读写模式新增 `protoflow_reshape_imported_page` 工具与 `reshape-imported-pages` 提示词，完整支持范围盘点、表头逐列映射核验、无损生成 `rp-optimized-*` / `fig-optimized-*` 标准物料副本，并同步升级 `alex-protoflow-designer` 技能插件。
  - **内置 Hermes 候选态离屏渲染截图自检（`protoflow_capture_preview`）**：Electron 主进程新增仅绑定 `127.0.0.1` 的受控预览桥接（`electron/hermes-preview.cjs`），在单轮未落盘阶段基于真实工程上下文（`projectPreviewContext`）与当前轮暂存的表结构、演示数据及 TSX 直接渲染离屏 PNG 截图（支持 `fullPage` 与 UI Stack 五态投影），并在任务取消或轮次结束时立即中断在途捕获。

### Fixed & Hardened

- **血缘覆写守卫、跨轮次兄弟副本跳转联动与严格 Schema 兼容**：
  - **双向血缘校验与跨轮次互链**：`reshapeFigmaPage` 补齐 `@alex-figma-source` 血缘头核验，严禁覆盖无血缘手写同 ID 页面；双端通过 `siblingNavigationPatches` 在分步或跨轮次新建优化副本时自动将所选迁移范围内的既有兄弟副本跳转更新至新副本，并在内置 Hermes 中纳入待确认变更集与 `DependencyFootprint` 并发冲突检测。
  - **严格客户端 JSON Schema 与 Retina 捕获基线加固**：外部 MCP `optimize_axure_block` 强制启用表头绑定门禁；`coverage` 联合契约改用 `anyOf` 并纳入 Ajv 编译预检回归；桌面双向冒烟测试按 CSS 逻辑像素比例换算长页面高度，完整兼容 macOS Retina 2x 物理像素截图。

---

## [v0.0.11] - 2026-11-26

### Added

- **PC 与移动端高阶视觉体系与合成器动效引擎（双端质感跃升）**：
  - **页面级视觉与动效令牌**：PC `<Page>` 与移动 `<MobilePage>` 完整支持 `surfaceBg`（`mist` / `pure` / `warm_paper` / `sage_field` / `aurora` / `oled_carbon` / 移动 `ocean_glow`）、`accent`（含 `obsidian` 深曜石与 `lime_forest` 森林青柠）、`appearance`（`auto` / `light` / `dark`）与 `motion`（`smooth` / `snappy` / `none`），内置合成器友好的 `opacity / translate / scale` 错峰入场、`@starting-style` 声明式弹层进退场、跨页 View Transitions 以及 `prefers-reduced-motion` 与截图捕获静默降级。
  - **高上限对标与流水物料**：新增移动端 `MProgressList`、`MActivityList`、`MFloatingBar` 及 `MHeroHeader(mode="wallet" | "metric_hero")`、`MAiInsightCard(tone="dark_brief")`，并在 PC 端对称落地 `ProgressBoard(variant="gauge" | "capsule")`、`ActivityFeed`、`Statistic(tone="inverted", splitDecimal, sparkline)`、`Card(variant="bento" | "glow" | "inverted")`（自动消隐内嵌表格/查询栏/图表的双重边框）与分段胶囊 `Tabs(type="segmented")`。
- **全工程同源视觉闭环机制（One Product, One Visual System）**：
  - **跨端主视觉基线归纳（`visualBaseline`）**：新增 `analyzeVisualConsistency` 分析器，在 `protoflow_get_project_overview`、内置多页工作流简报 `projectExecutionBrief` 与 `projectContext` 中自动提取已保存页面的主流 `appearance`、`surfaceBg`、`accent` 与 `motion`（含跨端同系映射），引导后续生成的新页面自动继承同源家族设计语言。
  - **闭环审计跨页漂移护栏（`visualConsistencyWarnings`）**：`protoflow_audit_project` 自动检测同一工程内的多套品牌主色分裂（`accent-drift`）、底布跳变（`surface-drift`）、无故明暗切屏（`appearance-drift`）及冷调页面内混用森林青柠 `dark_brief` 卡片的色温冲突（`dark-brief-clash`），并同步升级内置 AI 生成规范、MCP Playbook 与 `alex-protoflow-designer` 插件技能的 `85 / 10 / 5` 黄金视觉层级规范。

### Fixed & Hardened

- **数据语义真实性、作用域隔离与长页面视口弹层定位加固**：
  - **严格区分真实零值与缺失绑定**：`ActivityFeed` / `MActivityList` 与 `ProgressBoard` / `MProgressList` 绑表时强制校验显式数值列，空绑定或缺失字段在发布态均诚实呈现缺失占位而非回退示例金额或 `0%`；只读草稿预览严格传入预览行快照，杜绝触发全局表自动造数。
  - **主从外键与行上下文防串扰**：`useSourceRow` 支持按外键声明反查来源主表 ID，确保关联子表开启 `autoSelectFirst` 时不覆盖父工单上下文；静态 `items` 列表行动作显式隔断父弹层行作用域；底栏确认后导航先完成 `confirm` 交互再进入视图过渡回调。
  - **发布浏览端视口锚定与深浅色作用域**：`PublishedViewer` 将 `Modal` / `Drawer` Portal 宿主锚定至非滚动可视区域容器，彻底解决超长页面打开居中弹框落入视口外的问题；修复外层浅色工作台嵌套深色画布时最近层 `[data-pf-mode]` 选择器优先级。

---

## [v0.0.10] - 2026-11-25

### Added

- **高上限现代业务物料体系（134+ PC & 移动端注册物料）**：
  - **PC 中后台核心物料**：新增无弹窗主从循环列表 `Repeater`（内置 `autoSelectFirst`、`selectRow()` 与分页筛选）、多阶段状态泳道看板 `Kanban`（多 SQL `ENUM` 列智能消歧与拖拽/箭头推进）、月/周排期日历 `Calendar`（支持起止日跨天排程联动）、结构化智能建议卡片 `AiCopilotCard`，以及 `Card(variant="bento")` 与 `Statistic(sparkline)` 微型趋势指标卡。
  - **iPhone 移动端现场物料**：新增触控横向泳道看板 `MKanban`、周视图日程流 `MCalendar` 与移动端 AI 随行预检卡片 `MAiInsightCard`，与 PC 端天然共享同一套物理 ER 数据表。
- **UI Stack 五态仿真矩阵（`normal` / `empty` / `loading` / `edge` / `error`）**：
  - 桌面设计器与在线发布浏览端（`/p/<id>` 及 `/demo/`）顶部工具栏新增一键五态切换器，支持秒级检视理想态、空数据引导态、骨架屏加载态、极值压测态与异常降级态（`result_500` / `result_403` / `banner` / `component`）。
  - **极值态写保护隔离**：`edge` 极值长文本与大额数字仅作用于视图展示投影，表单预填与业务写入始终读取真实底层 `tableRows`，彻底杜绝压测假数据污染工程存档。
- **工程级品牌主题令牌（`designTokens`）**：
  - 内置 `classic_antd`（经典中后台）、`modern_minimal`（现代极简）、`industrial_dense`（工业高密）、`collab_soft`（柔和协作）4 套预设，支持自定义主色（`primaryColor`）、圆角、密度与画布底色，完整打通 `.pflow` V7 自动保存（默认主题保持历史字节零差异兼容）与 V5 在线发布快照。
- **Poka-Yoke 实时防错、递归外键闭环与 5 秒原子撤销**：
  - **跨字段与格式实时防错**：PC `<Form>` 与移动端 `<MForm>` 表单控件支持 `minField` / `maxField`（跨字段日期/库存上限对比）、`minValue` / `maxValue` 及 `formatRule`（`phone` / `email` / `credit_code` / `id_card` / `positive_number`）实时拦截。
  - **递归外键策略与原子恢复**：`deleteRow` 完整遍历多层 `ON DELETE RESTRICT / CASCADE / SET NULL` 引用树，存在 `RESTRICT` 子记录时精准阻断误删；支持 `deleteRow('undo')` 5 秒内一键原子恢复主子表快照，并在恢复前重验单列 `isUnique` 与表级联合唯一约束（`uniqueConstraints`）。
  - **状态条件禁用与高危二次核验**：行操作与按钮支持 `disabledWhenField` / `disabledWhenValue` / `disabledReason` 动态禁用说明，以及 `confirm(message, '{{row.ticket_no}}')` 单号精确输入核验弹窗。
- **官网在线演示升级为【星链设备售后维保与备件履约平台】**：
  - `website/demo/` 升级为中英双语零下载交互沙盒（3 个 PC 页 + 1 个 iPhone 现场端页 + 3 张 `RESTRICT/CASCADE` 共享物理表 + 8 条防错需求便签），集中展示无弹窗主从工作台、五态切换与防错撤销闭环。

### Fixed & Hardened

- **主从作用域与循环表单跨行写入安全加固**：
  - `Card` / `Modal` / `Drawer` 设置 `activeTable` 时严格阻断异表来源行及二级嵌套弹层 `params` 透传误写；`Repeater` 循环内嵌表单按行实例隔离草稿与新增记录；父详情容器内的关联子表行动作自动绑定子表自身行上下文；`PickerInput` 分离契约 `pfId` 与实例键确保外键来源列校验不跳检。
- **MCP 双向契约、Go 发布白名单与多架构 GHCR 镜像同步**：
  - Go 服务端 `publish.ValidateSnapshot` 与远程 Streamable HTTP MCP（`POST /api/v1/mcp/:id`）同步支持 `designTokens`、`selectRow`、字段级 Poka-Yoke 约束与动作防错守卫元数据，并随 `v0.0.10` 发布 `linux/amd64` + `linux/arm64` 多架构 `protoflow-ai-api` / `protoflow-ai-web` GHCR 镜像。

---

## [v0.0.9] - 2026-11-24

### 桌面端修复

- **发版原因**　在 macOS 桌面端成功发布原型后，点击「打开预览」可能导致「发布与分享」窗口停止响应。此时点击「关闭」或按 Esc 都无法返回编辑器。
- **修复方式**　此前预览链接会请求创建 Electron 子窗口，再由主进程拦截并转交系统浏览器。桌面端现在通过专用接口校验并打开所选分享记录的地址。等待浏览器启动期间可以继续操作弹窗，启动失败时会显示错误。已有链接可直接使用，无需重新发布。
- **验证**　已在 macOS 验证系统默认浏览器加载测试分享页。Electron 回归测试覆盖了浏览器启动失败、启动期间关闭弹窗，以及返回工作区后再次打开弹窗。

### 自托管部署

- 修正 Docker Compose 中 PostgreSQL 18 的数据卷挂载路径。

---

## [v0.0.8] - 2026-11-24

### Added

- **Native Dual-Channel Figma Import (`.fig` Offline Archive & Figma REST API)**:
  - **100% Offline `.fig` Binary Decoder**: In-app Web Worker unpacks Zstandard/Deflate archives (`fzstd` / `fflate`) and decodes Figma Kiwi binary schemas locally with zero account or cloud upload required, unpacking only the image assets referenced by user-selected frames.
  - **Figma Link + OS Keychain PAT Sync**: Fetches full files or scoped `?node-id=...` frame/section/leaf-node links via the Figma REST API, encrypts Personal Access Tokens via Electron `safeStorage` (serialized against concurrent clear/save operations), validates redirect hops & IPv4/IPv6 byte ranges against SSRF, and embeds referenced images as Data URIs so `.pflow` projects never break when Figma's 14-day S3 URLs expire.
  - **Smart Frame Tree Picker & Design Import Hub**: Auto-detects **Desktop (`<Page>`)**, **Mobile (`<MobilePage>`)**, or **Hybrid** multi-platform workspaces from frame dimensions, auto-skips Design System / Component / Icon sheets by default, reports omitted image counts and 20 MiB UTF-8 publish snapshot warnings transparently, and adds a dedicated **Import Designs (Figma · Axure RP)** hub to the Welcome Launcher.
- **Dual-Layer Material Expansion & Scoped AI Figma Reshaping**:
  - **Layer-1 High-Fidelity Primitives**: Added `FigmaCanvas`, `FigmaFrame` (Flexbox Auto Layout direction, gap, padding, `FILL`/`HUG` sizing, gradients, radii, shadows, backdrop blur), `FigmaText` (multi-run rich text), `FigmaVector` (`commandsBlob` SVG path decoder), and `FigmaImage`.
  - **Layer-2 Stateful Business Materials**: Added desktop `NavMenu`, `CardGrid`, `Dropdown`, `Carousel`, `Icon` and mobile `MBannerCarousel`, `MCardGrid` bound to shared physical ER tables (`DBTableSchema`) with unified `matchesStaticRowFilter` parity across `Table` and `CardGrid`.
  - **On-Demand Scoped AI Reshaping & MCP Lineage**: Added `protoflow_inspect_figma_project`, `inspect_page(view="figma")`, and `protoflow_reshape_figma_page` with strict frame/folder/project scope enforcement across follow-up clarifications, plus `figmaSourcePageId` / `optimizedPageId` lineage exposure in `@protoflow-ai/mcp` and the Go HTTP Spec MCP server.

### Fixed & Improved

- **Portable Linux `ProtoFlow_AI-*` AppImage Packaging & Dev Port Identity Guard**:
  - Updated Linux AppImage artifact naming (`ProtoFlow_AI-<version>-x86_64.AppImage`), automated `.AppImage.zsync` update syncing in `website-sync-downloads.cjs`, and added CI AppImage verification (`scripts/verify-appimage.sh`).
  - Added `<meta name="protoflow-app" content="alex-protoflow-ai">` probing in `electron/main.cjs` so local Electron development never attaches to unrelated services occupying port `5173`.

---

## [v0.0.7] - 2026-11-22

### Fixed & Improved

- **Stable Single-Install Live Desktop Bridge (`live.json`) & Offline Handshake Resilience**:
  - Replaced per-project SHA-256 bridge file paths with a stable `<userData>/authoring/live.json` endpoint protected by cross-instance directory locking (`live.lock` with automatic dead-owner recovery) and automatic project-switch reconnection while **Bidirectional design** is enabled — eliminating plugin reinstalls and MCP server restarts when creating or switching `.pflow` projects.
  - Added local offline protocol fallback in `createDesktopRelay` so `initialize`, `ping`, `tools/list`, `prompts/list`, `resources/list`, and static contract tools (`protoflow_get_contracts` / `protoflow_get_implementation_guide`) succeed even when Alex Desktop is closed or on the launcher, keeping MCP tools registered across IDE restarts.
- **Cross-Project Write Safety & Sequential Revision Guardrails**:
  - Enforced mandatory `expectedRevision` verification on every desktop write mutation (`desktop_bridge`) before touching canvas or disk state, preventing in-flight edits from Project A from landing on Project B after switching projects, and automatically disabling write access upon account changes or connection errors.
  - Updated MCP `authoringInstructions`, schema descriptions (without non-portable Draft-07 `if`/`then` keywords), and `alex-protoflow-designer` skill playbooks to enforce sequential single-in-flight desktop writes chaining each returned `revision`.
- **Product-Manager-Friendly AI Connection & Dev Handoff UI**:
  - Redesigned `McpConnectModal`, `DesktopAuthoringControls`, and `GlobalToolbar` around non-technical product manager workflows: plain-language scenario split (**Let External AI Design Here** vs **Hand Off Prototype to Developers**), guided 3-step setup with one-click **Antigravity** / **Claude Desktop** cards, 3 switchable plain-language prompt templates, native `<details>` progressive disclosure hiding raw developer JSON by default in live co-design mode, and live toolbar connection indicators.

---

## [v0.0.6] - 2026-11-21

### Added

- **Bidirectional MCP Prototype Authoring (`--mode readwrite`)**:
  - Expanded `@protoflow-ai/mcp` from read-only specs into a full 18-tool contract-enforced authoring server: external AI agents (**Codex**, **Google Antigravity**, **Claude Desktop**, **Claude Code**) can now create `.pflow` projects, organize sitemap folders, design normalized shared ER tables with foreign-key & composite-unique validation, seed coherent preview rows, write or losslessly patch desktop (`<Page>`) and mobile (`<MobilePage>`) pages (`protoflow_write_page` / `protoflow_edit_page_block`), attach sticky-note specs, author Markdown PRDs & Mermaid diagrams, and run closed-loop audits (`protoflow_audit_project`).
  - Added 4 guided MCP Prompts (`design-full-project`, `design-page`, `refine-page`, `design-database`), the `protoflow://authoring/playbook` resource, and the standalone `alex-protoflow-designer` Agent Skill pack (`SKILL.md` + 4 scenario playbooks).
- **Live Desktop Canvas Bridge (`--desktop-bridge`) & Multi-Step Undo**:
  - Enable **MCP → Local → Bidirectional design** in Alex Desktop to expose an authenticated loopback bridge bound to the open `.pflow` project, sharing live `revision`, `activePageId`, and canvas-selected `selectedPfId` with external agents.
  - Live edits stream directly onto the open canvas through the desktop autosave queue with optimistic `expectedRevision` conflict checks, shared Hermes AI task locking, top-bar undo notices, and focus-aware `Cmd/Ctrl+Z` multi-step undo (preserving native text input undo on macOS/Windows/Linux).
- **Revision-Bound Visual Preview Capture (`protoflow_capture_preview`)**:
  - Added an isolated sandboxed offscreen preview renderer (`partition: 'alex-preview'`) that captures high-DPI PNG screenshots of any desktop or mobile page (`scope: "viewport" | "canvas"`, `fullPage: true` up to `2160` CSS px with `truncated` reporting, minimum `1280` CSS px desktop viewport width) without disturbing editor selection, scroll position, or undo history.
  - Automatically waits for deterministic ECharts canvas rendering (zero entry animation) and sandboxed Freeform `iframe` first paint before capturing, verifying no concurrent project edits occurred mid-capture.
- **One-Click Client Integrations & Distributable Bundles**:
  - Added one-click **Install Antigravity plugin** (`~/.gemini/config/plugins/alex-protoflow-designer`), **Export Claude Desktop extension** (`.mcpb` manifest v0.3), and standalone **Codex / Antigravity / Claude Code** skill installers (`$CODEX_HOME/skills` & `~/.agents/skills`) with `.alex-install.json` SHA-256 receipt verification for seamless version upgrades while preserving user-customized files.

---

## [v0.0.5] - 2026-11-21

### Added

- **Full Bilingual Internationalization (`zh-CN` & `en-US`) Across All Surfaces**:
  - Automatic OS / browser language detection (`zh*` → `zh-CN`, otherwise `en-US`) on first launch with persistent one-click `LanguageSwitch` across the desktop workbench, welcome launcher, published web viewer (`/p/<id>`), release center, standalone/encrypted HTML exports, and official product website (`website/`).
  - Synchronized Ant Design (`zhCN` / `enUS`), `dayjs` (`zh-cn` / `en`), Tiptap editor placeholders, Electron native macOS application menus, close guards, Python Hermes sidecars (`PROTOFLOW_LOCALE`), mounted Hermes management dashboard windows (live in-place `LanguageSwitcher` sync without page reload), MCP servers, and Go publishing API (`Accept-Language` error localization).
  - Container-query and flex-wrap layout hardening across narrow sidebars, 332px 4-tab node inspectors, secondary canvas toolbars, and web preview headers to guarantee zero text clipping or layout overflow when switching languages.
- **Locale-Invariant Business & Relational Data Contracts**:
  - Localized all 114+ desktop/mobile material metadata entries, starter projects, and page templates while strictly preserving physical schema contracts: foreign-key `value` bindings (including live qualified-supplier filtering across desktop `<Form>` and mobile `<MForm>` / `<MSheetPicker>`), SQL `ENUM(...)` state machines, `¥` RMB currency defaults, typed `{{form.<pfId>.<field>}}` action interpolation (`number`, `boolean`, `null`), legacy `"全部,启用,停用"` query clear compatibility, and live bidirectional translation of active validation errors and toasts.

---

## [v0.0.4] - 2026-11-21

### Added

- **Native Axure RP 9 & RP 11 Binary Import (`.rp` → `.pflow`)**:
  - Local Worker-based `.rp` binary parser with zero Axure installation or cloud upload required. Restores nested sitemap folders, positioned groups (including hidden groups), static table cells, isolated master-instance widget scopes, multi-state `DynamicPanel`s, and unconditional page links / show-hide / state-switch actions while surfacing unsupported widgets and conditional events in page import notes.
- **Controlled AI Flow-Layout Reshaping & Relational Schema Migration**:
  - Added `protoflow_reshape_axure_page`, `protoflow_bind_axure_table`, `protoflow_optimize_axure_block`, and `protoflow_inspect_axure_project` for converting imported RP pages into clean, flow-layout Alex `<Page>` copies alongside the untouched original RP pages.
  - Synthesizes scattered RP captions and inputs (`nearbyLabel`) into live `QueryForm`s, binds `StaticTable` headers (`headerPfId → tableId / columnId`) to shared physical ER tables without polluting `tableRows` with static sample cells, and threads row-accurate cross-page `navigate(targetPageId, 'row')` into `Descriptions` via `useSourceRow`.
  - Enforces deterministic host & MCP anti-hallucination guardrails: blocks inverted field bindings, prevents single-row sample actions (such as row-1 `"删除"`) from promoting onto all-row `Table.rowActions`, verifies `retained` subtrees semantically, distinguishes per-turn edits from whole-page flow completion, and itemizes **Converted / Retained / Pending** blocks in confirmation reviews.
- **Enterprise CRM Contract & Billing Benchmark Showcase (`examples/crm-contract-billing`)**:
  - Added a complete 5-table, 6-page (4 Desktop + 2 Mobile) enterprise showcase with composite unique constraints, master-detail payment plans, anti-overpayment/invoicing sticky-note rules, and full-stack MCP implementation prompts.
- **Redesigned Spec MCP Studio Modal & Protocol Hardening**:
  - Redesigned `McpConnectModal` into a streamlined studio interface with one-click client configs (**Claude Code**, **Cursor**, **Antigravity**, **Codex**, **JSON**) and synced TypeScript + Go Spec MCP tools (`protoflow_get_page_spec` verified Axure lineage metadata, `protoflow_search_spec` coverage, and batch capabilities).

---

## [v0.0.3] - 2026-11-20

### Fixed

- Alex Desktop now installs its own verified Hermes v0.23.1 runtime by default. Upgrading or downgrading a separate Hermes installation no longer interrupts AI features that use the managed runtime.
- Existing users can select **使用 Alex 托管运行时** in the AI Management Center and authorize their account there. Conversations and drafts stay in their original profile. **高级设置 → 切回原 Hermes 环境** reconnects to that profile when its Hermes version is compatible.
- Alex verifies the new connection before saving an environment switch. If the switch fails, the active connection stays available.

---

## [v0.0.2] - 2026-11-19

### Added
- **Read-Only MCP Specification Server (Remote Streamable HTTP + Local `stdio`)**:
  - **Zero-Install Remote Online Connection (`POST /api/v1/mcp/:id`)**: Coding Agents (**Claude Code**, **Cursor**, **Google Antigravity**, **Windsurf**, **Codex**) can connect directly to any published `/p/<shareId>` prototype over Streamable HTTP without installing Alex Desktop or Node.js locally.
  - **Local `.pflow` & Share `stdio` Runtime**: Bundled into Alex Desktop (`electron/generated/spec-mcp-server.cjs` via `ELECTRON_RUN_AS_NODE=1`) and standalone CLI (`packages/protoflow-mcp/dist/cli.cjs`) with automatic hot-reload on `.pflow` file changes.
  - **6 Read-Only Tools, 4 Resources & 2 Guided Prompts**:
    - `protoflow_get_project_overview`, `protoflow_get_database_schema` (PostgreSQL & MySQL DDL + sample rows), `protoflow_get_page_spec` (component outline, TSX source, table bindings, actions, and pinned sticky-note rules), `protoflow_get_docs_and_flows`, `protoflow_search_spec`, and `protoflow_get_implementation_checklist`.
- **Format V5 Publishing Contract & PostgreSQL Migration `011`**:
  - Preserves column-level `isUnique` and table-level composite `uniqueConstraints` in published snapshots while keeping internal AI modeling notes local; legacy V1–V4 shares remain backward-compatible and emit explicit constraint completeness warnings.
- **One-Click MCP Connection Modal (`McpConnectModal`)**:
  - Accessible from the workbench top toolbar, the online publish modal, and the published web viewer (`/p/<id>`), generating ready-to-copy snippets for JSON IDEs, Claude Code CLI, and Codex CLI.

### Security & Reliability
- Enforced HTTPS for non-LAN remote share URLs, isolated per-share/per-project credentials in the connection UI, and added `X-Protoflow-Password-Base64` support so passwords with leading/trailing spaces or Unicode characters are preserved verbatim.
- Bounded public MCP request bodies (`64 KiB`), batch item counts (`16`), and cumulative batch response sizes (`4 MiB`) while preserving 1-to-1 JSON-RPC request IDs (including escaped strings and high-precision >53-bit integer IDs).
- Hardened PostgreSQL DDL generation for `BIGINT UNSIGNED` (`NUMERIC(20,0)` + range `CHECK`), `ZEROFILL` unsigned ranges, `FLOAT(p)` precision (`REAL` vs `DOUBLE PRECISION`), fractional `DATETIME(p)` / `TIMESTAMP(p)` precision, and strict single-column-unique foreign-key dependency closures.

---

## [v0.0.1] - 2026-11-18

### Added
- Initial open-source release of **Alex (ProtoFlow AI)** — AI prototyping workbench, shared physical ER modeling, interactive desktop & mobile canvas runtime, sticky-note business rules, project notes & mindmaps, self-hosted Go + PostgreSQL publishing server, and cross-platform Electron desktop builds.
