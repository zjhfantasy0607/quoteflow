#!/usr/bin/env node
// 浏览器主流程（M17）开始前：把测试库迁移到最新、清空全部业务表、执行基础数据 seed。
// 只连 apps/api/.env 里的 DATABASE_URL_TEST，库名必须以 _test 结尾（与 api e2e 共用，两者不能同时跑）。
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const env = parseEnv(readFileSync(`${apiDir}.env`, 'utf8'));
const url = env.DATABASE_URL_TEST;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('DATABASE_URL_TEST in apps/api/.env must point to a database whose name ends with _test');
}

const TRUNCATE = `DO $$ DECLARE t text; BEGIN
  SELECT string_agg(format('%I', tablename), ', ') INTO t FROM pg_tables
  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
  IF t IS NOT NULL THEN EXECUTE 'TRUNCATE TABLE ' || t || ' RESTART IDENTITY CASCADE'; END IF;
END $$;`;

const run = (cmd, input) =>
  execSync(cmd, {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: url },
    input,
    stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'],
  });
run('npx prisma migrate deploy');
run('npx prisma db execute --stdin', TRUNCATE);
run('npx prisma db seed');
console.log('prepare-db: test database reset and seeded');
