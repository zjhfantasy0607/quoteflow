import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * e2e 测试环境：读取 apps/api/.env，再把 DATABASE_URL 切到测试库。
 * 测试库名必须以 _test 结尾，防止误连开发库。
 */
export function loadTestEnv(): void {
  const envFile = join(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) throw new Error('DATABASE_URL_TEST is not set (see apps/api/.env.example)');
  const dbName = new URL(testUrl).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Test database name must end with _test, got "${dbName}"`);
  }

  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  process.env.MAIL_TRANSPORT = 'log';
  process.env.JOBS_ENABLED = 'false';
  process.env.LOG_LEVEL = 'error';
}
