#!/usr/bin/env node
// 构建镜像前的可选加速（M17）：把 package-lock.json 里所有包的 tarball 从本机 npm 缓存复制到 docker/.npm-seed，
// 镜像构建时先放进 npm 缓存再 npm ci --prefer-offline，只需要下载本机缓存里没有的包（主要是 Linux 平台的原生包）。
// 网络慢时首次构建能从一小时缩到几分钟。只复制内容文件（按 integrity 寻址，npm ci 按摘要读取），约 180 MB。
//
//   node scripts/docker-npm-seed.mjs        # 本机先 npm install 过，缓存里才有这些包
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const hostCache = join(execSync('npm config get cache').toString().trim(), '_cacache');
const seed = join(root, 'docker', '.npm-seed', '_cacache');

rmSync(seed, { recursive: true, force: true });
let copied = 0;
let missing = 0;
let bytes = 0;
for (const pkg of Object.values(lock.packages)) {
  if (!pkg.integrity) continue;
  const [algo, b64] = pkg.integrity.split(' ')[0].split('-');
  const hex = Buffer.from(b64, 'base64').toString('hex');
  const rel = join('content-v2', algo, hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
  const src = join(hostCache, rel);
  if (!existsSync(src)) {
    missing += 1;
    continue;
  }
  mkdirSync(dirname(join(seed, rel)), { recursive: true });
  copyFileSync(src, join(seed, rel));
  copied += 1;
  bytes += readFileSync(src).length;
}
console.log(
  `docker-npm-seed: ${copied} packages (${(bytes / 1048576).toFixed(0)} MB) → docker/.npm-seed; ` +
    `${missing} not in the local cache (other platforms' optional packages, downloaded during the build)`,
);
