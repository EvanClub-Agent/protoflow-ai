# 在线发布与服务端部署说明

Alex 桌面端负责本地原型设计、数据表建模与 AI 协同（工程文件默认保存在本机，支持免登录离线使用）。当需要把交互原型通过链接分享给团队评审时，客户端将当前工程转换为版本化 JSON 快照，上传至你自建的 Go + PostgreSQL 发布服务，并通过独立的 Web 浏览端提供 `/p/{发布ID}` 在线访问链接。

## 核心能力与安全边界

- **完整还原交互**：支持当前项目的全部画布页面、目录树、指定入口页、工程级品牌主题令牌（`designTokens`）、UI Stack 五态切换（理想/空白/加载/极值/异常）、区域需求便签、表单/主从工作台/泳道看板/排期日历及 Poka-Yoke 防错与 5 秒撤销动作链；访客在浏览器内存中的增删改不会回写原设计，点击“重置演示”即可恢复初始数据。
- **分享生命周期**：支持创建多个分享链接、同链接版本更新、乐观锁冲突检测、PBKDF2-SHA256 访问密码保护、过期时间与一键撤回。
- **自建服务连接**：客户端默认纯本地运行；在顶部工具栏或“发布与分享”弹窗填写自建服务器地址（公网要求 HTTPS，本机 `localhost` 或 RFC1918 局域网地址支持 HTTP）即可注册或登录账号。
- **凭证安全隔离**：桌面端使用操作系统级 `safeStorage` 加密保存会话令牌，绝不写入 `.pflow` 工程、分享快照或 `localStorage`；切换不同服务地址时不会解密或转发旧服务器凭证。
- **隐私最小化**：发布的快照仅包含页面结构、表结构与演示数据，不包含本机路径、AI 聊天记录或模型 API Key。

## Docker Compose 一键部署（推荐 · 预编译多架构 GHCR 镜像）

`deploy/compose.yml` 已内置 `postgres:18-alpine`、`api`（`ghcr.io/evanclub-agent/protoflow-ai-api:latest`）与 `web`（`ghcr.io/evanclub-agent/protoflow-ai-web:latest`），均支持 `linux/amd64` 与 `linux/arm64`：

```sh
# 1. 准备环境变量（修改数据库密码与对外访问的 PUBLIC_ORIGIN；可选通过 PROTOFLOW_API_IMAGE / PROTOFLOW_WEB_IMAGE 锁定 :v0.1.4 版本）
cp deploy/.env.example deploy/.env

# 2. 直接拉取 GHCR 预编译镜像并后台启动全部容器（若本地修改了源码可追加 --build）
docker compose --env-file deploy/.env -f deploy/compose.yml up -d

# 3. 检查健康状态
curl -fsS http://127.0.0.1:8088/healthz

# 4. （可选）创建平台管理员账号，用于访问版本管理后台
docker compose --env-file deploy/.env -f deploy/compose.yml exec api /app/protoflow create-admin admin
```

后续发布新版本时，执行 `docker compose --env-file deploy/.env -f deploy/compose.yml pull && docker compose --env-file deploy/.env -f deploy/compose.yml up -d` 即可无损滚动升级。

### 端口与局域网/公网配置说明

- **主访问入口**：默认监听 `127.0.0.1:8088`（由 `WEB_BIND` 与 `WEB_PORT` 控制）。
  - **本机体验**：保持默认配置，客户端服务地址填 `http://localhost:8088`。
  - **团队局域网部署**：将 `deploy/.env` 中的 `WEB_BIND` 设为 `0.0.0.0`，`PUBLIC_ORIGIN` 设为 `http://<服务器内网IP>:8088`（如需在局域网直接通过 HTTP 打开 `/releases/admin` 管理后台，同步设置 `ADMIN_HTTP_ALLOWED_CIDRS=192.168.0.0/16,10.0.0.0/8,172.16.0.0/12`）。
  - **公网 HTTPS 部署**：保持 `WEB_BIND=127.0.0.1`，由前置 Nginx / Caddy 终结 HTTPS 后反代至 `127.0.0.1:8088`，并将 `PUBLIC_ORIGIN` 设为 `https://your-domain.example.com`。详见 [公网 HTTPS 部署指南](public-server-deployment.md)。
- **本机回环管理口**：默认绑定 `127.0.0.1:8089`（`ADMIN_PORT`），方便运维人员在宿主机本机或通过 SSH 隧道安全访问 `/releases/admin`。

## 本地源码联调

1. 将 `server/.env.example` 复制为 `server/.env.local`，填写本地 PostgreSQL 的 `DATABASE_URL`。
2. 启动后端 API：`npm run server:dev`（默认监听 `127.0.0.1:8081`）。
3. 启动前端开发服：`npm run dev`，或启动桌面端：`npm run electron:start`。
4. 运行自动化测试：
   - 前端与桥接回归测试：`npm test`
   - Go 服务端单元测试：`npm run server:test`（设置 `PUBLISH_TEST_DATABASE_URL` 可额外运行真实 PostgreSQL 集成测试）
