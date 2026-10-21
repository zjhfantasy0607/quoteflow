import { hashPassword } from '../../src/common/auth/password';
import { seedDicts, seedRoles } from '../../prisma/seed-data/base';
import type {
  EnableStatus,
  Material,
  MaterialCategory,
  PrismaClient,
  User,
  UserStatus,
  UserType,
} from '../../src/generated/prisma/client';

export const TEST_PASSWORD = 'Passw0rd!';

/** 每个测试文件 resetDb() 之后调用：角色 + 系统字典 */
export async function seedBase(prisma: PrismaClient): Promise<void> {
  await seedRoles(prisma);
  await seedDicts(prisma);
}

let seq = 0;

export async function createUser(
  prisma: PrismaClient,
  options: {
    roles?: string[];
    username?: string;
    name?: string;
    email?: string | null;
    departmentCode?: string | null;
    status?: UserStatus;
    userType?: UserType;
    supplierId?: string | null;
    password?: string;
    locale?: string;
  } = {},
): Promise<User> {
  seq += 1;
  const roleCodes = options.roles ?? ['BUYER'];
  const roles = await prisma.role.findMany({ where: { code: { in: roleCodes } } });
  if (roles.length !== roleCodes.length) throw new Error(`Unknown role in ${roleCodes.join(',')}`);
  return prisma.user.create({
    data: {
      username: options.username ?? `user${seq}.${Date.now().toString(36)}`,
      passwordHash: await hashPassword(options.password ?? TEST_PASSWORD),
      name: options.name ?? `Test User ${seq}`,
      email: options.email === undefined ? null : options.email,
      departmentCode: options.departmentCode === undefined ? 'PURCHASE' : options.departmentCode,
      status: options.status ?? 'ACTIVE',
      userType: options.userType ?? 'INTERNAL',
      supplierId: options.supplierId ?? null,
      locale: options.locale ?? 'zh-CN',
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
}

let categorySeq = 0;

/** 直接写库建分类（不经过接口校验）；预置分类树用 seedMaterialCategories() */
export async function createCategory(
  prisma: PrismaClient,
  options: { code?: string; parentId?: string | null; status?: EnableStatus; nameZh?: string; nameEn?: string } = {},
): Promise<MaterialCategory> {
  categorySeq += 1;
  return prisma.materialCategory.create({
    data: {
      code: options.code ?? `TC-${categorySeq}`,
      nameZh: options.nameZh ?? `测试分类 ${categorySeq}`,
      nameEn: options.nameEn ?? `Test Category ${categorySeq}`,
      parentId: options.parentId ?? null,
      status: options.status ?? 'ENABLED',
    },
  });
}

let materialSeq = 0;

/** 直接写库建材料（编码默认 TM-0001 起，不占用 MAT 序列） */
export async function createMaterial(
  prisma: PrismaClient,
  options: { categoryId: string; code?: string; nameZh?: string; spec?: string; unitCode?: string; status?: EnableStatus },
): Promise<Material> {
  materialSeq += 1;
  return prisma.material.create({
    data: {
      code: options.code ?? `TM-${String(materialSeq).padStart(4, '0')}`,
      nameZh: options.nameZh ?? `测试材料 ${materialSeq}`,
      spec: options.spec ?? `SPEC-${materialSeq}`,
      unitCode: options.unitCode ?? 'PCS',
      categoryId: options.categoryId,
      status: options.status ?? 'ENABLED',
    },
  });
}
