#!/usr/bin/env node
// 不使用 Docker 部署时的发布包（docs/交付/部署手册-不使用Docker.md §3）：构建 shared、api（含基础数据 / 演示数据脚本）与 web，
// 把运行需要的文件整理成 release/quoteflow-<版本>-<日期>-<时分>-<提交>/，再打成同名 .tar.gz。
// 包里不带 node_modules：服务器上由 deploy/install.sh 执行 npm ci --omit=dev（Prisma 引擎按服务器平台下载）。
//
//   npm run release
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, cwd = root) => execSync(command, { cwd, stdio: 'inherit' });
const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
// 版本-UTC 日期-时分-提交：同一提交重新打包也不会与正在运行的版本重名
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const name = `quoteflow-${version}-${stamp}-${git('rev-parse', '--short', 'HEAD')}${dirty ? '-dirty' : ''}`;

run('npm run build:shared');
run('npm run build -w @quoteflow/api');
run('npx tsc -p tsconfig.seed.json', join(root, 'apps/api'));
run('npm run build -w @quoteflow/web');

const releaseDir = join(root, 'release');
const out = join(releaseDir, name);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const copy = (from, to = from) => cpSync(join(root, from), join(out, to), { recursive: true });
// npm ci 要求各 workspace 的 package.json 都在，前端只带 package.json；构建产物与迁移文件按仓库里的位置放
for (const path of [
  'package.json',
  'package-lock.json',
  'packages/shared/package.json',
  'packages/shared/dist',
  'apps/api/package.json',
  'apps/api/prisma.config.ts',
  'apps/api/prisma/schema.prisma',
  'apps/api/prisma/migrations',
  'apps/api/dist',
  'apps/api/dist-seed',
  'apps/web/package.json',
]) {
  copy(path);
}
copy('apps/web/dist', 'web');
copy('deploy/linux', 'deploy');
writeFileSync(
  join(out, 'VERSION'),
  [
    `name=${name}`,
    `version=${version}`,
    `commit=${git('rev-parse', 'HEAD')}${dirty ? ' (with uncommitted changes)' : ''}`,
    `built=${new Date().toISOString()}`,
    `node=${process.version}`,
    '',
  ].join('\n'),
);

const tarball = `${name}.tar.gz`;
execFileSync('tar', ['-czf', tarball, name], { cwd: releaseDir, stdio: 'inherit' });
const size = (statSync(join(releaseDir, tarball)).size / 1024 / 1024).toFixed(1);
console.log(`${relative(root, join(releaseDir, tarball))} (${size} MB)`);
