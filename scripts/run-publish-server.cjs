const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const local = path.join(root, 'server/.env.local');
const env = { ...process.env };
if (fs.existsSync(local)) {
  for (const line of fs.readFileSync(local, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match && env[match[1]] === undefined) env[match[1]] = match[2];
  }
}
const args = process.argv.slice(2);
const child = spawn('go', ['run', './cmd/protoflow', ...args], { cwd: path.join(root, 'server'), env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code === null ? 1 : code));
