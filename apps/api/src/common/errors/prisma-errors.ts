import { Prisma } from '@prisma/client';

/** 是否违反唯一约束；给了 field 时只匹配包含该字段的约束 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  if (!field) return true;
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === 'string' && target.includes(field);
}
