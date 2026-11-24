# ProtoFlow AI 新增 Figma 原生支持 · X (Twitter) 中英双语宣发全案

> **定位**：面向产品经理、UI/UX 设计师、独立开发者与 AI Coding（Claude Code / Cursor / Codex）重度用户的重磅功能发布。  
> **核心钩子（Hook）**：Figma 画板很精致但只是「静态画皮」，一句话 Vibe Coding 生成的页面又全是「假状态孤岛」。现在，开源工作台 **ProtoFlow AI** 打通了 **本地 `.fig` 离线解析 + Figma 链接直连 → Auto Layout 高保真还原 → 共享 ER 物理表活原型 → MCP 直连 AI IDE 写生产代码** 的完整闭环。  
> **配套视觉物料目录**：`docs/assets/promo-figma/`（含中/英双语 16:9 超清宣发海报、4 宫格 Thread 配图与真实产品界面实拍）。

---

## 目录

1. [单条爆款推文（Short Launch Post · 配主海报或四宫格直发）](#1-单条爆款推文short-launch-post--配主海报或四宫格直发)
   - [中文版（精炼高转化）](#11-中文版精炼高转化)
   - [English Version (Punchy Launch Post)](#12-english-version-punchy-launch-post)
2. [X 深度长文（X Article · 适合 X 长文专栏发布）](#2-x-深度长文x-article--适合-x-长文专栏发布)
   - [中文长文：《别再把 Figma 截图喂给 AI 了：我们开源了从 .fig 到共享 ER 表活原型与 MCP 研发闭环》](#21-中文长文)
   - [English X Article: *Stop Feeding Figma Screenshots to AI: Turning Static .fig Files into Stateful, ER-Backed Prototypes for Coding Agents*](#22-english-x-article)
3. [5 连推文串（5-Post X Thread · 逐条搭配宣发图）](#3-5-连推文串5-post-x-thread--逐条搭配宣发图)
   - [中文 Thread（1/5 ~ 5/5）](#31-中文-thread15--55)
   - [English Thread (1/5 ~ 5/5)](#32-english-thread-15--55)
4. [评论区置顶链接与发布防降权指南（X Launch Playbook）](#4-评论区置顶链接与发布防降权指南x-launch-playbook)

---

## 1. 单条爆款推文（Short Launch Post · 配主海报或四宫格直发）

> **推荐配图**：
> - 单图模式：`01-hero-figma-launch-zh.png`（中文）/ `01-hero-figma-launch-en.png`（英文）
> - 四宫格模式（X 信息流占屏面积最大）：同时挂载 `01-hero` + `02-dual-import` + `03-er-reshape` + `04-ui-showcase` 四张 16:9 卡片。

### 1.1 中文版（精炼高转化）

```text
Figma 画板很精致，但点不动、没真数据；
直接拿截图让 AI 写代码，生成出来的又是满屏假状态的孤岛 Demo。

今天，开源 AI 原型与 ER 建模工作台 ProtoFlow AI 正式支持 Figma 原生导入与业务升维 ⚡️

• 免登录离线拖入 .fig：纯本机解析 Kiwi 二进制与 Auto Layout、渐变圆角、富文本与 SVG 矢量，涉密稿零上传
• 在线链接 + PAT 同步：支持整文件或单画板 ?node-id 链接，系统钥匙串加密凭据，图片自动转内嵌永不过期
• 智能目录与多端混排：自动识别 PC + iPhone 视口并默认过滤 Design System 组件库杂项页
• 按需 AI 升维活原型：保留原始 Figma 画板对照，一键把静态列表/卡片重塑为绑定共享 ER 物理表的真实增删改查页
• MCP 直连研发：Claude Code / Cursor / Codex 直接读取标准 DDL + 页面 TSX + 需求便签写生产代码

Apache-2.0 完全开源免费，支持 macOS / Windows / Linux 本地运行 👇（体验与源码见评论区置顶）
```

**评论区 1 楼自评置顶（避免主帖外链被 X 算法限流）：**

```text
🔗 立即体验与开源地址：

• 免下载浏览器在线试玩：https://alex.xclubai.com/demo/
• GitHub 开源仓库（Apache-2.0，欢迎 Star ⭐️）：https://github.com/EvanClub-Agent/protoflow-ai
• 官网与桌面安装包下载：https://alex.xclubai.com/
• MCP 接入 Claude Code / Cursor 指南：https://alex.xclubai.com/mcp/

如果你之前用 Axure，我们也同时支持免装客户端离线导入 .rp 文件！欢迎大家拿手头的 .fig 砸过来实测反馈 🙌
```

---

### 1.2 English Version (Punchy Launch Post)

```text
Figma frames look pixel-perfect, yet they hold zero real state.
Screenshots fed into vibe-coding tools produce isolated UI mockups that break on the first edit.

Today, ProtoFlow AI (Apache-2.0 open-source) ships native Figma Import + Stateful ER Reshaping ⚡️

• 100% Offline .fig Drag & Drop — Local Kiwi binary + Zstd/Deflate decoding. Zero account needed, NDA-safe
• Figma URL + OS-Encrypted PAT — Import full files or scoped ?node-id frames; auto-embeds images so 14-day S3 URLs never expire
• Smart Hybrid Frame Picker — Auto-detects Desktop + Mobile viewports and filters out noisy Design System / Icon sheets
• Dual-Layer Engine & AI Reshaping — Preserves Auto Layout, vectors & rich text, then optionally upgrades static frames into live ER-table-backed CRUD & filters
• Native MCP Handoff — Claude Code, Cursor & Codex read live SQL DDL + TSX + sticky-note specs directly

Local-first on macOS, Windows & Linux. Links in the first reply 👇
```

**First Reply (Self-Reply for Links):**

```text
🔗 Try it right in your browser or grab the open-source desktop app:

• Live Interactive Demo (zero install): https://alex.xclubai.com/demo/
• GitHub Repo (Apache-2.0 — Star ⭐️ to support!): https://github.com/EvanClub-Agent/protoflow-ai
• Desktop Downloads & Docs: https://alex.xclubai.com/
• MCP Guide for Claude Code / Cursor / Codex: https://alex.xclubai.com/mcp/

(Bonus: We also parse legacy Axure .rp files 100% offline!) Let us know what workflows you test first 🙌
```

---

## 2. X 深度长文（X Article · 适合 X 长文专栏发布）

> **封面图（Cover Image）**：使用 `01-hero-figma-launch-zh.png`（中文篇）或 `01-hero-figma-launch-en.png`（英文篇）。  
> **正文插图位**：已在文中用 `[插入配图: ...]` 标明最佳视觉锚点。

### 2.1 中文长文

# 别再把 Figma 截图喂给 AI 了：我们开源了从 .fig 到共享 ER 表活原型与 MCP 研发闭环

在 AI 写代码已经成日常的今天，团队从「设计稿」走到「可交付业务系统」，中间依然横着一道极其别扭的断层。

设计师在 Figma 里把 Auto Layout、圆角阴影和组件间距打磨到了像素级，但那本质上还是一张张**没有数据灵魂的静态画皮**：
- 评审时点「筛选订单」「提交审批」，列表不会真的变化；
- PC 管理后台改了一条商品库存，旁边的移动端 H5 / 小程序画板不会同步刷新；
- 当研发把 Figma 截图丢进大模型或 Vibe Coding 工具时，AI 只能靠「看图猜字段」硬编码一堆 `mockData` 数组——第一眼很惊艳，一改业务逻辑就散架，前后端表结构全靠人工重新对齐。

继免装客户端本地解析 **Axure `.rp`** 之后，今天我们在 **Apache-2.0 开源工作台 ProtoFlow AI（桌面端 Alex）** 中正式补齐了另一块核心拼图：**原生 Figma 双通道导入 + 双层物料架构 + 受控 AI 业务升维**。

`[插入配图: 01-hero-figma-launch-zh.png]`

---

### 一、两条原生导入通道：既能 100% 离线拖入 `.fig`，也能连 Figma API 永固资源

很多政企、金融和 B 端核心业务的设计稿不允许上传到不可控的第三方云端；而互联网团队则习惯直接甩一条带 `?node-id=` 的 Figma 协作链接。我们把两条路径都做成了原生能力：

1. **免登录、纯本机离线解析 `.fig` 文件**
   直接把 `.fig` 文件拖进启动器，内置 Web Worker 会在你本机直接解包 Zstandard / Deflate 归档与 Figma 的 Kiwi 二进制结构，完整读取 Canvas → Section → Frame 层级树，并且**按你勾选的目标画板精准提取所需图片**——哪怕同一份文件里有几十 MB 未勾选的组件库贴图，也不会挤占业务画板的体积。全程零云端请求、零账号门槛。

2. **Figma 在线链接 + 系统钥匙串安全同步**
   粘贴任意 Figma 文件链接或单画板/单节点链接（`?node-id=...`），Personal Access Token 通过操作系统原生 `safeStorage` 钥匙串加密存储，绝不明文落盘。更重要的是，Figma 官方的图片临时下载链接只有 14 天有效期——ProtoFlow AI 会在导入阶段经公网安全校验后将所选画板的图片转为内嵌数据写入本地 `.pflow` 工程，**彻底告别两周后打开原型满屏裂图的尴尬**。

`[插入配图: 02-dual-import-zh.png]`

---

### 二、懂产品目录的「画板树选择器」：自动混排 PC + 移动端，过滤组件库杂音

真实的 Figma 文件往往一半是业务页面，一半是 `Design System / Icons / Components / Playground` 画板。如果一股脑全导进来，左侧菜单树瞬间就会变成灾难。

导入预览时，ProtoFlow AI 会自动完成三件事：
- **自动识别多端视口**：根据画板尺寸精准区分桌面端 `<Page>` 与移动端 `<MobilePage>`，一份同时包含后台管理页和 iPhone 页面画板的 `.fig` 会自动开启 **PC + 移动多端混排模式**；
- **默认跳过设计规范与图标页**：自动识别组件集与规范页并默认取消勾选（保留手动开启自由），保证生成的业务菜单树干净清爽；
- **透明的逐页导入报告**：超出嵌套上限或被跳过的超大图片会按画板清晰列出原因，发布前还会自动按 20 MiB 快照上限给出预警，不丢细节、不搞黑盒。

`[插入配图: 04-ui-showcase-zh.png]`

---

### 三、双层架构：先高保真还原，再按需「升维」成共享 ER 物理表活原型

为什么很多「设计转代码」工具一导进来就把版式改乱了？因为它们试图一步到位猜出所有业务组件。

我们在底层采用了**双层物料引擎**：

- **第一层（零损耗视觉还原层）**：通过 `FigmaCanvas`、`FigmaFrame`、`FigmaText`、`FigmaVector`、`FigmaImage` 原生承接 Figma 的 Auto Layout（横纵排列、间距、内边距、填充/包裹尺寸）、线性渐变、圆角描边、阴影毛玻璃、多段富文本样式以及二进制 `commandsBlob` 解码出的高清 SVG 矢量图标。导进来第一秒，它就是干净、可编辑的高保真画板。
- **第二层（真实业务交互物料层）**：我们同步扩展了桌面端 `NavMenu`、`CardGrid`、`Dropdown`、`Carousel`、`Icon` 与移动端 `MBannerCarousel`、`MCardGrid`，与原有的 `QueryForm`、`Table`、`Modal`、12 类 `ECharts` 图表全面打通。

当你需要把静态画板变成真正能跑的原型时，打开左侧 **「项目 AI」**，自主框定范围（**单张画板 / 指定目录 / 全工程**）：
1. **只读盘点，绝不污染普通对话**：专项指令仅在你发起 Figma 盘点或重塑时按需挂载。AI 会先识别 Auto Layout 里的重复列表行、筛选栏与卡片网格，向你核对表结构与业务边界；
2. **保留原画板对照 + 生成共享 ER 表活页面**：确认后，原始 Figma 画板原封不动保留在目录里方便比对，同时生成绑定真实 `DBTableSchema` 物理表的新页面（`fig-optimized-*`）——支持真实条件筛选、弹窗新增编辑、跨页带参详情以及 PC 后台与移动端视口同表实时联动。

`[插入配图: 03-er-reshape-zh.png]`

---

### 四、最后一公里：通过 MCP 直接交给 Claude Code / Cursor / Codex 写生产代码

当你的 Figma 设计稿在 ProtoFlow AI 里拥有了**标准 ER 物理表（可一键导出 PostgreSQL / MySQL DDL）**、**干净的流式 TSX 组件树**以及**锚定在按钮上的需求便签契约**后，交付给研发就不再是甩一堆截图和口头解释了。

通过内置的 **18 个双向 MCP 工具**，开发同学可以在 **Claude Code、Cursor、Codex、Antigravity** 里直接按需读取页面的表结构外键、字段枚举与交互契约，一步生成前后端对齐的真实生产代码。

---

### 立即免费使用（Apache-2.0 开源）

ProtoFlow AI 坚持 **Local-First（本机优先）+ Apache-2.0 开源协议**，免登录即可在本地完整使用，也提供 3 步 Docker Compose 团队私有化评审中心方案。

- **免下载浏览器在线演示**：https://alex.xclubai.com/demo/
- **GitHub 开源仓库（欢迎 Star 支持）**：https://github.com/EvanClub-Agent/protoflow-ai
- **官网与 macOS / Windows / Linux 下载**：https://alex.xclubai.com/
- **MCP 研发协同接入文档**：https://alex.xclubai.com/mcp/

不论你手头是正在推进的 Figma 链接、客户发来的离线 `.fig` 源文件，还是积压多年的老旧 Axure `.rp` 工程，现在都可以在同一个开源工作台里把它们真正「跑起来」。

---

### 2.2 English X Article

# Stop Feeding Figma Screenshots to AI: Turning Static .fig Files into Stateful, ER-Backed Prototypes for Coding Agents

Every product team in 2026 knows this handoff gap all too well.

Designers spend days perfecting Auto Layout spacing, typography, and component variants in Figma. Yet at review and handoff time, those frames are still **static pictures with zero business state**:
- Clicking *"Filter Orders"* or *"Approve Contract"* in a slide deck doesn't mutate real rows;
- Updating inventory on a Desktop Admin screen never reflects on the companion Mobile screen next to it;
- And when engineers paste Figma screenshots into an LLM or vibe-coding tool, the AI guesses field names and hardcodes disconnected `mockData` arrays—impressive for 30 seconds, brittle the moment real requirements change.

Following our offline **Axure `.rp`** parser, we're excited to ship native **Figma Import + Dual-Layer ER Reshaping** in **ProtoFlow AI**—our **Apache-2.0 open-source**, local-first prototyping and ER database modeling workbench.

`[Insert Image: 01-hero-figma-launch-en.png]`

---

### 1. Two Native Import Channels: 100% Offline `.fig` Files + Permanent Figma URL Sync

Enterprise teams often work under strict NDAs where uploading `.fig` files to third-party SaaS clouds is a non-starter, while fast-moving product teams share `?node-id=` links all day. We built first-class support for both:

1. **Zero-Login, 100% Offline `.fig` Drag & Drop**
   Drop any local `.fig` file straight onto the launcher. An in-app Web Worker unpacks Zstandard/Deflate archives and decodes Figma's Kiwi binary schema locally on your machine—reconstructing the full `Canvas → Section → Frame` hierarchy while unpacking *only* the images needed by your selected frames. Even a 50 MB unpicked component library sheet won't eat into your business pages' asset budget.

2. **Figma REST API Sync with OS Keychain Security & Never-Expiring Assets**
   Paste a full Figma file URL or a scoped `?node-id=...` frame link. Your Personal Access Token is encrypted via your OS native keychain (`safeStorage`)—never stored in plaintext. And because Figma's S3 image URLs expire after 14 days, ProtoFlow AI fetches, SSRF-validates, and embeds your selected frames' assets directly into your local `.pflow` project so prototypes never rot with broken images two weeks later.

`[Insert Image: 02-dual-import-en.png]`

---

### 2. A Product-Aware Frame Picker: Hybrid Viewports In, Design-System Noise Out

Real-world Figma files mix actual user flows with dozens of `Design System`, `Icons`, `Tokens`, and scratchpad frames. Importing everything blindly turns your sitemap into chaos.

Before generating a single page, ProtoFlow AI's frame tree picker automatically:
- **Detects Desktop, Mobile, or Hybrid Projects** from frame dimensions—routing wide frames to `<Page>` and mobile frames to `<MobilePage>` inside the same workspace;
- **Auto-Skips Component & Style Sheets by Default** (with full manual override) so your navigation tree stays focused on real business screens;
- **Reports Asset & Publish Budgets Transparently** per frame before you publish snapshots.

`[Insert Image: 04-ui-showcase-en.png]`

---

### 3. Dual-Layer Architecture: Pixel-True Restoration First, Stateful ER Reshaping on Demand

Most "design-to-code" converters mangle layouts because they try to hallucinate high-level widgets in one lossy pass.

ProtoFlow AI separates restoration from semantic upgrading via a **two-layer component engine**:

- **Layer 1 — High-Fidelity Figma Primitives**: `FigmaCanvas`, `FigmaFrame`, `FigmaText`, `FigmaVector`, and `FigmaImage` faithfully preserve Flexbox Auto Layout (direction, gap, padding, `FILL`/`HUG` sizing), linear gradients, corner radii, shadows, backdrop blur, multi-style rich text runs, and binary `commandsBlob` SVG vector paths. Right after import, your frames look crisp and are immediately editable offline.
- **Layer 2 — Stateful Business Materials**: Newly added `NavMenu`, `CardGrid`, `Dropdown`, `Carousel`, `Icon` (Desktop) and `MBannerCarousel`, `MCardGrid` (Mobile) join `QueryForm`, `Table`, `Modal`, and 12 `ECharts` components—all wired to shared physical ER tables (`DBTableSchema`).

Whenever you're ready to make static screens *work*, open **Project AI** and scope the task to a **single frame, folder, or entire project**:
1. **Scoped Read-Only Inventory First**: Specialized Figma migration prompts load *only* when invoked—never bloating normal chats. The AI inspects repeating Auto Layout rows, filter bars, and card grids, then aligns on table columns and foreign keys with you first.
2. **Side-by-Side Live Pages**: Original Figma frames stay untouched in your folder for visual reference while new `fig-optimized-*` pages bind directly to shared ER tables—giving you live filtering, modal CRUD, row-level drilldowns, and instant Desktop ↔ Mobile state sync.

`[Insert Image: 03-er-reshape-en.png]`

---

### 4. Closing the Loop: Native MCP Handoff to Claude Code, Cursor & Codex

Once static Figma frames are backed by **verified ER schemas (exportable to PostgreSQL / MySQL DDL)**, **clean flow-layout TSX**, and **anchored sticky-note business rules**, engineering handoff transforms completely.

Through ProtoFlow AI's **18 bidirectional MCP tools**, coding agents in **Claude Code, Cursor, Codex, and Antigravity** query exact table schemas, foreign keys, page specs, and edge-case contracts directly—shipping production code without guessing from flat screenshots.

---

### Try It Today — 100% Open Source (Apache-2.0)

ProtoFlow AI runs local-first with no mandatory cloud sign-in, plus a 3-step Docker Compose setup for self-hosted team review links.

- **Interactive Browser Demo (Zero Install)**: https://alex.xclubai.com/demo/
- **GitHub Repository (Apache-2.0)**: https://github.com/EvanClub-Agent/protoflow-ai
- **Website & Desktop Builds (macOS / Windows / Linux)**: https://alex.xclubai.com/
- **MCP Integration Guide**: https://alex.xclubai.com/mcp/

Bring your `.fig` archives, Figma links, or legacy Axure `.rp` files—and turn static screens into living software specs.

---

## 3. 5 连推文串（5-Post X Thread · 逐条搭配宣发图）

### 3.1 中文 Thread（1/5 ~ 5/5）

**Tweet 1/5（配图：`01-hero-figma-launch-zh.png`）**
```text
1/5 设计师给的 Figma 很美但只是静态图；直接丢截图让 AI 写代码，出来的又是满屏假数据的孤岛页面。

我们在开源工作台 ProtoFlow AI 中正式上线了「原生 Figma 导入 + 共享 ER 表业务升维」——把 .fig 和 Figma 链接直接变成能跑真实数据、还能喂给 Claude Code / Cursor 的活原型 🧵👇
```

**Tweet 2/5（配图：`02-dual-import-zh.png`）**
```text
2/5 双通道原生接入，兼顾内网合规与在线协同：

• 离线拖入 .fig：纯本机 Worker 解码 Kiwi 二进制与 Zstd 归档，免登录、零云端上传，只解压所选业务画板所需图片
• 在线链接 + PAT：支持整文件或 ?node-id 单画板链接；OS 钥匙串加密 Token，并将图片内嵌固化进 .pflow，彻底解决 Figma 临时图链 14 天过期裂图问题
```

**Tweet 3/5（配图：`04-ui-showcase-zh.png`）**
```text
3/5 懂产品结构的画板树选择器：

• 根据画板尺寸自动识别 PC 桌面端、iPhone 移动端或「PC + 移动多端混排」工程
• 自动识别并默认跳过 Design System / Icons / 组件规范杂项页，保持业务菜单树干净
• 高保真还原 Auto Layout 弹性布局、渐变圆角、多段富文本与 commandsBlob 矢量路径
```

**Tweet 4/5（配图：`03-er-reshape-zh.png`）**
```text
4/5 按需 AI 升维 + 18 个 MCP 工具直连研发：

选定单页或目录后，AI 先只读盘点重复卡片/表格列并核对字段；确认后保留原 Figma 画板对照，同目录生成绑定共享 ER 物理表的流式页（NavMenu / CardGrid / QueryForm / Table / 移动端卡片流）。

随后直接用 MCP 让 Claude Code、Cursor、Codex 读取 DDL 与 TSX 写生产代码！
```

**Tweet 5/5（纯文字收尾 + 引导转化）**
```text
5/5 ProtoFlow AI 基于 Apache-2.0 协议完全开源免费，支持 macOS / Windows / Linux 免登录本地使用（同时也支持免装客户端离线导入 Axure .rp）。

🌐 免下载在线体验：https://alex.xclubai.com/demo/
⭐️ GitHub 源码与安装包：https://github.com/EvanClub-Agent/protoflow-ai
🔌 MCP 研发指南：https://alex.xclubai.com/mcp/

欢迎 Star 收藏或拿手头最复杂的 .fig 文件来实测！
```

---

### 3.2 English Thread (1/5 ~ 5/5)

**Tweet 1/5 (Attach: `01-hero-figma-launch-en.png`)**
```text
1/5 Figma frames are pixel-perfect, but static. Pasting screenshots into AI coding tools gives you hardcoded mockups that fall apart the moment requirements change.

Today we're shipping native Figma Import + Stateful ER Reshaping in ProtoFlow AI (Apache-2.0 open-source) — bridging .fig files to live databases & MCP coding agents 🧵👇
```

**Tweet 2/5 (Attach: `02-dual-import-en.png`)**
```text
2/5 Dual native import channels — built for both strict NDAs and fast team links:

• 100% Offline .fig Drag & Drop: In-browser/local Worker decodes Kiwi binary + Zstd archives with zero login and selective asset unpacking
• Figma REST URL + PAT: Supports file or ?node-id links, encrypts tokens via OS Keychain, and embeds images locally so 14-day Figma S3 URLs never expire
```

**Tweet 3/5 (Attach: `04-ui-showcase-en.png`)**
```text
3/5 Smart Frame Picker + Lossless Layer-1 Restoration:

• Auto-detects Desktop, Mobile, or Hybrid multi-viewport workspaces from frame dimensions
• Auto-skips Design System / Component / Icon sheets by default so sitemaps stay clean
• Preserves Flexbox Auto Layout, gradients, shadows, rich text runs & binary SVG vector paths
```

**Tweet 4/5 (Attach: `03-er-reshape-en.png`)**
```text
4/5 Scoped AI Reshaping → MCP Handoff to Claude Code & Cursor:

Pick a single frame or folder: Project AI inventories repeating Auto Layout rows & cards, aligns on ER schemas, and generates live CRUD/filter pages alongside your original Figma frame.

Then expose SQL DDL + TSX + sticky-note specs directly to Claude Code, Cursor & Codex via MCP!
```

**Tweet 5/5 (CTA & Open-Source Links)**
```text
5/5 ProtoFlow AI is 100% open-source (Apache-2.0) and local-first on macOS, Windows & Linux — with offline Axure .rp import built in too.

🌐 Live Browser Demo: https://alex.xclubai.com/demo/
⭐️ GitHub Repo: https://github.com/EvanClub-Agent/protoflow-ai
🔌 MCP Docs: https://alex.xclubai.com/mcp/

Give it a spin with your toughest .fig file and drop us a ⭐️ if it saves your team handoff headaches!
```

---

## 4. 评论区置顶链接与发布防降权指南（X Launch Playbook）

1. **黄金防限流法则（No External Link in Tweet #1）**：
   - X 的信息流推荐算法对首条带外部链接的普通推文有明显降权；但 **X Articles（原生深度长文）正文内放链接不受降权影响**。
   - 因此：如果发**单帖（Short Launch Post）**，主帖只放文案 + 宣发大图，发出去后 10 秒内在 **1 楼自评（Self-Reply）** 贴上 Demo 与 GitHub 链接；如果发 **X Article 长文**，可以直接把链接放在文末，并在转发长文的引语里配一句痛点金句。
2. **中英文账号 / 时段错峰建议**：
   - **中文推文**：建议北京时间 **10:00–11:30** 或 **20:30–22:00** 发布（覆盖国内产品/设计/独立开发者高峰）。
   - **英文推文 / Thread**：建议北京时间 **22:30–24:00**（对应美东上午 10:30–12:00 / 欧洲下午，海外 AI Coding 与 Figma 社区最活跃时段）。
3. **高相关度和标签建议（最多带 2 个，不堆砌标签）**：
   - 中文可不带标签或仅带 `#Figma` `#MCP`
   - 英文建议仅在末条带 `#Figma` `#OpenSource`（在正文中自然出现 `Claude Code`、`Cursor`、`Figma`、`MCP` 关键词比井号标签更容易进入 X 语义推荐流）。
