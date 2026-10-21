import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma 7 经 pg 驱动连接 PostgreSQL（PrismaService 与 seed 共用，seed 不能引入 Nest 装饰器）。
 * 连接池参数按 Prisma 6 的默认值设置：pg 默认连接超时为 0（不限时等待），空闲连接 10 秒就回收。
 */
export function createPgAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 300_000 });
}
