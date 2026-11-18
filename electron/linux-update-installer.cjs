const { spawn } = require('node:child_process');
const path = require('node:path');

// The updater verifies the signed manifest, size and digest before calling this.
// pkexec delegates authentication to the desktop; no password or shell is used.
function installDeb(filePath, { spawnProcess = spawn } = {}) {
  if (!path.isAbsolute(filePath) || !filePath.endsWith('.deb')) {
    return Promise.reject(new Error('安装包路径无效'));
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess('/usr/bin/pkexec', [
      '--disable-internal-agent', '/usr/bin/apt-get', '--yes', 'install', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const record = chunk => { output = (output + chunk.toString()).slice(-8000); };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    child.on('error', error => reject(new Error(error.code === 'ENOENT'
      ? '系统安装组件缺失，请联系管理员重新安装 Alex。'
      : '无法启动系统安装程序，请稍后重试。')));
    child.on('close', code => {
      if (code === 0) { resolve(); return; }
      if (code === 126) { reject(new Error('已取消系统授权，更新尚未安装，可点击“立即更新”重试。')); return; }
      if (code === 127) { reject(new Error('未获得系统安装授权，请在密码弹窗中完成授权后重试。')); return; }
      if (/Could not get lock|Unable to acquire|锁|锁定/.test(output)) {
        reject(new Error('系统正在安装其他软件，请等待完成后再更新。')); return;
      }
      reject(new Error(`系统安装未完成（错误码 ${code}），请检查网络后重试；若持续失败，请联系管理员。`));
    });
  });
}

module.exports = { installDeb };
