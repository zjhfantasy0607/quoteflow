import { Prisma } from '../../generated/prisma/client';

interface UniqueConstraintCause {
  table?: string;
  constraint?: { fields?: string[]; index?: string };
}

/**
 * 违反唯一约束（P2002）时冲突的字段。Prisma 7 经 pg 适配器时没有 meta.target，冲突信息在
 * meta.driverAdapterError.cause.constraint：通常是约束名（如 User_username_key），按 Prisma 默认命名
 * "表名_字段_key" 拆出字段（字段名不含下划线）；PostgreSQL 没给约束名时才是 fields。主键冲突（X_pkey）拆不出字段。
 */
export function uniqueViolationFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const cause = (error.meta?.driverAdapterError as { cause?: UniqueConstraintCause } | undefined)?.cause;
  const constraint = cause?.constraint;
  if (constraint?.fields) return constraint.fields;
  const index = constraint?.index;
  const table = cause?.table ?? error.meta?.modelName;
  if (!index || typeof table !== 'string' || !index.startsWith(`${table}_`) || !index.endsWith('_key')) return [];
  return index.slice(table.length + 1, -'_key'.length).split('_');
}

/** 是否违反唯一约束；给了 field 时只匹配包含该字段的约束 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  return !field || uniqueViolationFields(error).includes(field);
}

/** 是否违反外键约束（P2003），如删除仍被 RESTRICT 外键引用的记录 */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}
