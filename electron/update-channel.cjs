const { origin } = require('./publishing.cjs');
const { serviceOrigin } = require('./service-origin.json');

// Open-source builds leave serviceOrigin and trustedPublicKey empty so the app
// runs purely locally out of the box. Maintainers building a private/managed
// distribution may set serviceOrigin and its 32-byte Ed25519 public key together.
const bundledUpdateChannel = Object.freeze({
  serverUrl: serviceOrigin,
  channel: 'stable',
  trustedPublicKey: '',
});

function validateBundledUpdateChannel(config = bundledUpdateChannel) {
  if (config.channel !== 'stable' && config.channel !== 'beta') throw new Error('安装包的更新通道无效');
  const rawUrl = typeof config.serverUrl === 'string' ? config.serverUrl.trim() : '';
  const rawKey = typeof config.trustedPublicKey === 'string' ? config.trustedPublicKey.trim() : '';
  if (!rawUrl) {
    if (rawKey) throw new Error('配置了更新验证公钥时必须同时配置默认更新服务地址');
    return { serverUrl: '', channel: config.channel, trustedPublicKey: '' };
  }
  if (origin(rawUrl) !== rawUrl) throw new Error('安装包的默认更新地址无效');
  const key = Buffer.from(rawKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== rawKey) {
    throw new Error('安装包缺少有效的 Ed25519 更新验证公钥');
  }
  return { serverUrl: rawUrl, channel: config.channel, trustedPublicKey: rawKey };
}

module.exports = { bundledUpdateChannel, validateBundledUpdateChannel };
