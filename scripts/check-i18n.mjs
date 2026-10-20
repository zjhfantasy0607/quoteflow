#!/usr/bin/env node
// 检查前端是否硬编码了中文：扫描 apps/web/src 下的 .vue / .ts（排除 locales/ 和测试文件），
// 去掉注释后仍出现中日韩字符就报错。界面文案必须写进 locales/ 走 vue-i18n。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'apps/web/src');
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'locales' ? [] : walk(full);
    return /\.(vue|ts)$/.test(name) && !/\.spec\.ts$/.test(name) ? [full] : [];
  });
}

/** 把注释替换成等长空白，保持行号不变 */
function stripComments(source) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:'"`])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const problems = [];
for (const file of walk(srcDir)) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (CJK.test(line)) problems.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
  });
}

if (problems.length > 0) {
  console.error('Hard-coded CJK text found (move it to apps/web/src/locales/*):');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('check-i18n: ok');
