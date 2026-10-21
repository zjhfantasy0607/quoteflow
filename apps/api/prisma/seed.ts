// 基础数据（docs/06-种子数据.md §2）。幂等：只新增缺失的数据，可重复执行。
// 各模块完成时把自己的部分加到 main() 里。
import { hashPassword } from '../src/common/auth/password';
import { PrismaClient } from '../src/generated/prisma/client';
import { createPgAdapter } from '../src/prisma/pg-adapter';
import { seedDicts, seedInternalUsers, seedRoles } from './seed-data/base';

// DATABASE_URL 由 prisma db seed 传入（prisma.config.ts 已读取 .env）
const prisma = new PrismaClient({ adapter: createPgAdapter(process.env.DATABASE_URL ?? '') });

async function main(): Promise<void> {
  await seedRoles(prisma);
  await seedDicts(prisma);
  await seedInternalUsers(prisma, hashPassword);
  console.log('seed: roles, dictionaries and internal users are ready');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
