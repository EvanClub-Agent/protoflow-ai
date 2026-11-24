/*
 * ProtoFlow AI（原名 Alex）官网配置 / Website Configuration — 部署时只需修改这个文件。
 *
 * 自托管官网可使用与客户端共用的版本中心；公网官网可选择 GitHub 稳定发行版。
 * Note: window.ALEX_SITE_CONFIG global name is retained for backward compatibility with self-hosted deployments.
 */
window.ALEX_SITE_CONFIG = {
  // release-center | github（读取 repoUrl 仓库最新的 GitHub Release）
  releaseSource: 'release-center',

  // 空字符串表示同源；由官网 nginx 代理公开版本查询和安装包下载。
  // Empty string means same-origin; nginx proxies public release queries and installer downloads.
  updateServer: '',

  // 发行通道 / Release channel: stable | beta
  channel: 'stable',

  // 联系方式与社区入口 / Contact, repository, community, and live browser demo URL
  contactEmail: 'ai.agent.club@gmail.com',
  repoUrl: 'https://github.com/EvanClub-Agent/protoflow-ai',
  discordUrl: 'https://discord.gg/YDnKBhmsrR',

  // 在线交互演示地址（默认指向内置纯静态沙盒 /demo/；留空时首屏次要按钮跳转到实机展示区）。
  // Hosted or bundled interactive live demo URL (defaults to static /demo/ sandbox; empty jumps to #showcase).
  demoUrl: '/demo/',
};
