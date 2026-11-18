# Alex 产品官网 (`website/`)

Alex 桌面应用静态官网，提供产品特性展示以及 macOS、Windows、Linux 安装包下载入口。采用纯静态 HTML、CSS 和原生 JavaScript 编写，无需额外前端打包步骤。

## 版本和下载数据机制

官网通过 `GET /api/v1/updates?channel=stable` 读取版本中心公开数据，与桌面客户端自托管更新共用同一数据源：

- 顶部“最新发布”及各系统平台下载卡片实时读取公开接口的已审核安装包信息；尚未上传安装包的平台会明确显示“暂未发布”。
- `config.js` 中 `updateServer: ''` 表示同源接口（由 Nginx 仅反代只读的公开版本查询与安装包下载接口，不暴露任何管理或鉴权接口）。

## 目录说明

- `index.html`：页面结构与产品介绍文案
- `styles.css`：样式表
- `main.js`：访客操作系统识别、公开版本查询与下载卡片渲染
- `config.js`：更新服务地址、发布通道、联系邮箱与 GitHub 仓库链接
- `assets/`：品牌图标与模型服务商图标（含开源许可说明 `assets/providers/LICENSE`）

## 本地预览与语法检查

```sh
node --check website/main.js
node --test tests/website-downloads.test.cjs
npm run website:preview
```

> 提示：`npm run website:preview` 使用本地静态 HTTP 服务预览页面排版；由于未挂载后端 `/api/v1/updates` 接口，下载区显示“加载失败”属预期行为。完整联调请配合 `deploy/website.compose.yml` 与 `deploy/nginx-website.conf` 指向本地 `127.0.0.1:8088` 发布服务。
