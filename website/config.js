/*
 * Alex 官网配置 / Alex Website Configuration — 部署时只需修改这个文件。
 *
 * 官网和客户端更新共用版本中心的公开发行数据。
 * 接口失败时明确提示重试，不使用静态安装包清单替代已发布版本。
 */
window.ALEX_SITE_CONFIG = {
  // 空字符串表示同源；由官网 nginx 代理公开版本查询和安装包下载。
  // Empty string means same-origin; nginx proxies public release queries and installer downloads.
  updateServer: '',

  // 发行通道 / Release channel: stable | beta
  channel: 'stable',

  // 联系方式 / 仓库地址 / Contact & repository URL
  contactEmail: 'ai.agent.club@gmail.com',
  repoUrl: 'https://github.com/EvanClub-Agent/protoflow-ai',
};
