// PPL 模板集（docs/06-种子数据.md §2.5），db:seed 与 e2e 测试共用。
import { PPL_V0 } from '@quoteflow/shared';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client';

/** 版本 1 = v0 占位定义并激活。已有任何版本时不动，不覆盖管理员上传、激活的版本 */
export async function seedPplTemplateSets(prisma: PrismaClient): Promise<void> {
  if ((await prisma.pplTemplateSet.count()) > 0) return;
  await prisma.pplTemplateSet.create({
    data: {
      version: 1,
      label: PPL_V0.label,
      isActive: true,
      definition: PPL_V0 as unknown as Prisma.InputJsonValue,
    },
  });
}
