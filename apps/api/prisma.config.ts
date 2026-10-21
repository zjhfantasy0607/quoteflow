// Prisma 7 的 CLI 配置（连接串、迁移目录、seed 命令都在这里，不再写在 schema.prisma 和 package.json）。
// CLI 不再自动读取 .env，这里补上；已设置的环境变量优先（e2e 先把 DATABASE_URL 指向测试库再跑 migrate deploy）。
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // generate 不连库，构建镜像时可能没有 DATABASE_URL；env() 在变量缺失时会直接报错，所以不用它
    url: process.env.DATABASE_URL ?? '',
  },
});
