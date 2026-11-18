# 安全策略 (Security Policy)

感谢你帮助守护 **Alex (ProtoFlow AI)** 及其开源社区用户的安全！

## 支持的版本 (Supported Versions)

我们持续为最新的正式发布版与 `main` 主干分支提供安全修复更新：

| 版本 | 安全更新支持 |
| :--- | :--- |
| `0.0.x` (Latest Release) | :white_check_mark: 支持 |
| `main` 分支 | :white_check_mark: 支持 |

## 报告安全漏洞 (Reporting a Vulnerability)

如果你在 Alex 桌面客户端（Electron IPC / 沙箱隔离 / 本地存储）、在线浏览端（CSP / 快照解析）或自托管 Go 发布服务端（鉴权 / SQL / 访问控制）中发现了潜在的安全隐患：

> **请勿直接在公开的 GitHub Issues 或 Discussions 中披露尚未修复的漏洞细节。**

请通过以下私密渠道联系维护团队：

1. **安全反馈邮箱**：发送邮件至 **[ai.agent.club@gmail.com](mailto:ai.agent.club@gmail.com)**，邮件标题请注明 `[SECURITY] Alex Vulnerability Report`；或
2. **GitHub 私密漏洞报告**：若仓库已启用 Private Vulnerability Reporting，可在仓库 **Security → Advisories → Report a vulnerability** 页面直接私密提交。

### 请在报告中尽量包含以下信息
- 受影响的模块与版本号（例如桌面端主进程、`server/` 路由或 `deploy/nginx.conf`）
- 清晰的最小复现步骤或概念验证（PoC）
- 潜在的攻击面与安全影响评估

### 响应与披露承诺
- 我们会在收到报告后的 **48 小时内** 回复确认收到。
- 确认问题后，我们会尽快完成修复补丁，并在发布新版 Release Notes 及安全公告时向报告者公开致谢（如你希望保持匿名，请在邮件中注明）。
