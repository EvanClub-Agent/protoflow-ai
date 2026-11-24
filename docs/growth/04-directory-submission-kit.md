# 导航站、开源周刊与搜索引擎收录提交清单

本文档整理了 **ProtoFlow AI（原名 Alex）** 上线新版官网（含 `/demo/`、`/compare/`、`/axure-import/`、`/mcp/`）后的外部渠道提交资料与必应（Bing）收录操作步骤。

---

## 1. 基础信息卡片（中英文通用）

- **产品名称**：ProtoFlow AI（原名 Alex）
- **官网地址**：`https://alex.xclubai.com/`
- **浏览器在线演示（免下载）**：`https://alex.xclubai.com/demo/`
- **GitHub 仓库**：`https://github.com/EvanClub-Agent/protoflow-ai`
- **开源协议**：Apache-2.0（免费商用、支持私有化部署）
- **支持平台**：Web 在线预览 / macOS (Apple Silicon & Intel) / Windows x64 / Linux / Docker Compose
- **一句话简介（中文，35 字内）**：开源 AI 原型设计工具，共享 ER 物理表驱动可运行原型，支持 Axure `.rp` 导入与 MCP 直连研发。
- **详细介绍（中文，150 字内）**：
  ProtoFlow AI（原名 Alex）是一款 Apache-2.0 开源、本机优先的 AI 原型设计与 ER 数据库建模工作台。AI 先追问澄清业务规则，再规划目录、页面与共享物理表；支持同一工程内混排 PC 后台与 iPhone 视口实时联动、免装 Axure 离线导入 `.rp`、12 类 ECharts 图表绑定，以及通过 MCP 让 Claude Code / Cursor / Codex 双向操控画布或零安装读取 DDL/TSX 写生产代码。
- **One-liner (EN)**: Open-source, local-first AI prototyping workbench backed by shared ER tables, offline Axure `.rp` import, and bidirectional MCP for Claude Code & Cursor.

---

## 2. 推荐投稿 / 收录渠道清单

### A. AI 工具导航站（影响必应「AI 概览」权重最高）
1. **AI 工具集 (`ai-bot.cn`)**：
   - 必应「AI 原型设计」搜索结果第 2 名及 AI 概览首位参考文献均来自 `ai-bot.cn/ai-ui-generation-tools/`。
   - 提交路径：前往 `ai-bot.cn` 提交产品收录申请，重点标注「**开源免费 / 本地优先 / 支持浏览器在线试玩 `/demo/` / 支持 Axure `.rp` 导入 / 支持 MCP 连接 Claude Code & Cursor**」，并附上新采集的 `website/assets/workbench-screenshot.png` 与 `website/assets/social-preview.jpg`。
2. **其他中文 AI 导航与产品库**：
   - **AIbase (`top.aibase.com`)**
   - **一起用 AI / 工具达人 / Futurepedia / There's An AI For That**

### B. 开源社区与周刊
1. **HelloGitHub**（`https://hellogithub.com`）：
   - 推荐理由：Apache-2.0 全栈开源（Electron + React + TypeScript + Go 1.27 + PostgreSQL 18），自带 470+ 自动化测试、CRM 业财标杆工程与完整 Docker Compose 部署方案。
2. **阮一峰《科技爱好者周刊》**（GitHub Issue 自荐）：
   - 突出亮点：一个带真实 ER 物理表和双向 MCP 协议的开源原型设计器，免装 Axure 解析 `.rp`，直接在线 Demo 可体验。
3. **V2EX `/go/share` & `/go/create`**：
   - 使用 `docs/growth/03-zhihu-v2ex-2026-ai-prototyping-comparison.md` 作为交流帖底稿，首段放免下载在线演示 `https://alex.xclubai.com/demo/`。
4. **少数派 / 知乎专栏 / CSDN / 掘金**：
   - 使用 `01-csdn-juejin-claude-code-cursor-mcp-prototype.md` 与 `02-zhihu-sspai-axure-rp-migration.md` 分别投放技术社区与产品经理社区，在正文嵌入官网场景落地页链接（`/mcp/`、`/axure-import/`、`/demo/`）。

---

## 3. Bing Webmaster Tools & IndexNow 主动推送（加速收录）

部署更新后的 `website/` 到 `https://alex.xclubai.com` 后，建议立即执行以下 3 步：

1. **在 Bing Webmaster Tools 验证并提交 Sitemap**：
   - 登录 [Bing Webmaster Tools](https://www.bing.com/webmasters/)，添加站点 `https://alex.xclubai.com/`（可直接通过 Google Search Console 一键导入，或 DNS TXT 验证）。
   - 在 **Sitemaps** 提交：`https://alex.xclubai.com/sitemap.xml`（已包含 `/`、`/en/`、`/demo/`、`/compare/`、`/axure-import/`、`/mcp/`、`/about/`、`/contact/`、`/privacy/`、`/llms.txt`、`/llms-full.txt`）。
2. **使用 URL Inspection 检查核心页**：
   - 对以下 5 个高意图页面手动点 **Request Indexing**：
     - `https://alex.xclubai.com/`
     - `https://alex.xclubai.com/demo/`
     - `https://alex.xclubai.com/compare/`
     - `https://alex.xclubai.com/axure-import/`
     - `https://alex.xclubai.com/mcp/`
3. **配置 IndexNow（可选，秒级通知必应抓取新页面）**：
   - 在 Bing Webmaster Tools 生成一个 IndexNow Key，将 `<key>.txt` 放到 `website/` 根目录，部署后对新增/更新的 URL 发送一次 `POST https://api.indexnow.org/indexnow`。
4. **域名迁移说明（如未来启用独立域名）**：
   - 当前配置统一锚定 `https://alex.xclubai.com`。若后续购买了例如 `protoflow.ai` 等独立品牌域名，只需批量替换 `website/`、`scripts/website-build-seo.cjs`、`demo.html` 和 `deploy/vercel-website.json` 中的规范域名，并在旧域名配置 301 永久重定向即可无缝转移权重。
