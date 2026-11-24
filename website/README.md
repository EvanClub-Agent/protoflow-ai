# ProtoFlow AI（原名 Alex）产品官网 (`website/`)

ProtoFlow AI（原名 Alex）桌面应用静态官网，提供在线浏览器交互演示（`website/demo/`）、竞品对比页（`website/compare/`）、Axure `.rp` 迁移专页（`website/axure-import/`）、MCP 双向协同文档（`website/mcp/`）以及 macOS、Windows、Linux 安装包下载入口。采用纯静态 HTML、CSS 和原生 JavaScript 编写，其中 `/demo/` 由 `npm run website:demo` 构建生成。

> 说明：`config.js` 中的全局对象 `window.ALEX_SITE_CONFIG` 为兼容已有自托管部署而保留命名。

## 版本和下载数据机制

在 `config.js` 中通过 `releaseSource` 选择下载来源：

- **公网静态官网**在部署副本中设置 `releaseSource: 'github'`、`channel: 'stable'`，并将 `repoUrl` 指向项目的 GitHub 仓库。页面读取 GitHub 标为 Latest 的正式发行版，按打包文件名识别系统与架构，使用附件的下载地址、大小和 SHA-256。附加工具与校验清单不计入桌面安装包。发布新版本后官网会随 GitHub 的缓存更新。接口访问失败时，下载区提供重试和官方发行页入口。
  - **CSP 提示**：若将 `config.js` 切换为 `releaseSource: 'github'`，请在 Nginx 的 `Content-Security-Policy` 中把 `https://api.github.com` 加入 `connect-src`（参见 `deploy/nginx-website.conf` 注释）。
- **自托管官网**默认使用 `releaseSource: 'release-center'`，通过 `GET /api/v1/updates?channel=stable` 与桌面客户端共用版本中心公开数据。
  此模式下，各平台展示最近一次已审核并发布的安装包。配置 `updateServer: ''` 时，由同源 Nginx 代理公开查询和下载接口。

### 部署到官网 Vercel 项目

在仓库根目录运行以下命令。脚本使用 GitHub CLI 和 jq 从正式发行版生成下载清单，只复制 Git 跟踪的官网文件。部署副本通过同域路径 `/api/github/releases/latest` 查询最新版本。遇到网络超时、限流或上游服务故障时，页面会标注并展示部署时同步的发行版。两条路径共用仓库、版本、下载地址和 SHA-256 校验。

```sh
site=$(bash scripts/website-stage-vercel.sh) &&
  vercel link "$site" --yes --project protoflow-alex-website --scope masterbans-projects &&
  vercel deploy "$site" --prod
```

## 配置项 (`config.js`)

- `releaseSource`：`release-center` 或 `github`
- `updateServer`：版本中心地址（`''` 表示同源）
- `channel`：`stable` 或 `beta`
- `contactEmail`：联系邮箱（同时绑定 FAQ 与 Footer 中的 `mailto:` 链接）
- `repoUrl`：GitHub 仓库地址（同时驱动导航、Hero、Footer 文档链接以及 GitHub Release 来源）
- `discordUrl`：社区邀请链接（留空时自动隐藏 Discord 入口）
- `demoUrl`：在线交互原型演示链接（默认指向内置静态沙盒 `/demo/`；也可改为外链如 `https://demo.example.com/p/crm-demo`，留空时首屏次要按钮跳转到 `#showcase`）

## 上线 SEO / 社交卡片提醒

在正式域名部署时，建议把 `index.html` 中的 `og:url`、`canonical` 以及 `og:image` / `twitter:image` 补充或替换为完整的 `https://` 绝对域名 URL，以便微信、Slack、Discord、X 等平台正确抓取 1280×640 宣传卡片 (`assets/social-preview.jpg`)。

## 目录说明

- `index.html`：简体中文主落地页结构、Schema.org `@graph` 结构化数据、`hreflang` 与 SEO/GEO 元数据
- `en/index.html`：由 `npm run website:seo`（[scripts/website-build-seo.cjs](../scripts/website-build-seo.cjs)）自动预渲染生成的静态英文落地页
- `demo/`：由 `npm run website:demo`（[scripts/website-build-demo.cjs](../scripts/website-build-demo.cjs)）生成的纯静态浏览器 CRM 交互演示沙盒
- `compare/`、`axure-import/`、`mcp/`、`about/`、`contact/`、`privacy/`：面向高意图搜索与信任审查的静态专题页面
- `robots.txt`、`sitemap.xml`、`llms.txt`、`llms-full.txt`：搜索引擎抓取策略、双语站点地图与大模型/AI Agent 检索说明
- `styles.css`：品牌蓝冷灰样式表（含明暗双色适配、高对比度模式与响应式容器查询）
- `main.js`：访客操作系统识别、响应式折叠导航、Showcase 标签页、双语切换、公开版本查询与下载卡片渲染
- `config.js`：更新服务地址、发布通道、联系邮箱、社区与在线演示链接配置
- `assets/`：品牌图标 (`logo.svg`、`icon.png`、`apple-touch-icon.png`)、CRM 工作台截图 (`workbench-screenshot.png`)、iPhone 移动端视口截图 (`mobile-preview.png`)、社交分享图 (`social-preview.jpg`) 与模型服务商图标 (`assets/providers/`)
- Vercel 边缘配置模板：[deploy/vercel-website.json](../deploy/vercel-website.json)（提供 `Accept: text/markdown` 内容协商、`Link` 发现头、安全头与静态资源缓存策略）

## 本地预览与语法检查

```sh
npm run website:demo
npm run website:seo
node --check website/main.js
node --check scripts/website-build-seo.cjs
node --test tests/website-downloads.test.cjs
npm run website:preview
```

> 提示：`npm run website:preview` 使用本地静态 HTTP 服务预览页面排版；由于未挂载后端 `/api/v1/updates` 接口，下载区显示“加载失败”属预期行为（首屏版本号徽标会自动隐藏以免干扰浏览）。完整联调请配合 `deploy/website.compose.yml` 与 `deploy/nginx-website.conf` 指向本地 `127.0.0.1:8088` 发布服务。
