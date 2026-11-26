# 公网 HTTPS 部署指南

本指南适用于将 Alex 在线分享服务、版本中心与官网部署到具备公网域名和 TLS 证书的 Linux 服务器。如果只需在本地或团队内网快速启动，推荐直接使用仓库内置的 Docker Compose 方案（见根目录 [README.md](../README.md)）。

## 方式一：Docker Compose + 反向代理（推荐）

1. 复制环境变量配置并修改密码与公开域名：

```sh
cp deploy/.env.example deploy/.env
```

在 `deploy/.env` 中配置：

```ini
POSTGRES_PASSWORD=请替换为高强度随机密码
PUBLIC_ORIGIN=https://protoflow.example.com
WEB_BIND=127.0.0.1
WEB_PORT=8088
ADMIN_PORT=8089
```

2. 拉取 GHCR 多架构预编译镜像并启动 PostgreSQL + Go API + Web 浏览端（如需锁定版本可在 `deploy/.env` 中配置 `PROTOFLOW_API_IMAGE=ghcr.io/evanclub-agent/protoflow-ai-api:v0.1.2` 与 `PROTOFLOW_WEB_IMAGE=ghcr.io/evanclub-agent/protoflow-ai-web:v0.1.2`；本地二次开发源码后可加 `--build`）：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml up -d
```

3. 初始化平台管理员账号（用于管理安装包与查看诊断）：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml exec api /app/protoflow create-admin admin
```

4. 在宿主机使用 Nginx / Caddy / Traefik 配置 HTTPS 证书（如 Let's Encrypt），将 `https://protoflow.example.com` 反代到 `http://127.0.0.1:8088`，并传递 `Host` 与 `X-Forwarded-Proto: https`。

## 方式二：宿主机 Systemd + Nginx 裸机部署

如果需要在宿主机直接运行二进制与静态目录，可参考 `deploy/protoflow-publish.service` 与 `deploy/nginx-public.conf`：

- **PostgreSQL 18**：`127.0.0.1:5432`，独立数据库 `protoflow_publish` 与最小权限角色 `protoflow`。
- **Go API**：`protoflow-publish.service`，监听 `127.0.0.1:8081`，读取 `/data/protoflow-ai/shared/server.env`（权限 `0640`）。
- **Nginx**：参考 `deploy/nginx-public.conf`（将 `protoflow.example.com` 替换为你的实际域名并配置 Certbot 证书路径）。
- **注意精确路由**：必须保留 Nginx 中的 `location = /api/v1/releases` 精确匹配路由，避免 Nginx 自动补斜杠与 Gin 路由产生重定向循环。

## 备份与证书续期

仓库 `deploy/` 目录提供了可选的 systemd 定时任务模板：

- `protoflow-certificate-renew.service` / `.timer`：定期检查 Certbot 证书续期并重载 Nginx。
- `protoflow-backup.service` / `.timer` / `protoflow-backup.sh`：每日备份 PostgreSQL 数据库、运行配置与发布签名密钥，默认保留 14 天。
