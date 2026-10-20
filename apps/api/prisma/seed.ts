// 基础数据（docs/06-种子数据.md §2）。幂等：只新增缺失的数据，可重复执行。
// 各模块完成时把自己的部分加到 main() 里。
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/auth/password';
import { seedDicts, seedInternalUsers, seedRoles } from './seed-data/base';

const prisma = new PrismaClient();

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
