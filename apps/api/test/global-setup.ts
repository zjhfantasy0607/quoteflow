import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { loadTestEnv } from './load-test-env';

/**
 * 每次 e2e 运行前把测试库迁移到最新版本（库不存在时 Prisma 会创建）。
 * 用的是不破坏数据的 migrate deploy；数据隔离靠各测试文件开头的 resetDb()。
 */
export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    stdio: 'pipe',
    env: process.env,
  });
}
