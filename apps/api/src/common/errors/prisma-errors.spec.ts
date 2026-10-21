import { Prisma } from '../../generated/prisma/client';
import { isUniqueViolation, uniqueViolationFields } from './prisma-errors';

/** 按 Prisma 7 + pg 适配器的实际结构构造 P2002（2026-10-21 在测试库上实测） */
function p2002(constraint: { index?: string; fields?: string[] }, table: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.1',
    meta: {
      modelName: table,
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint, table },
      },
    },
  });
}

describe('isUniqueViolation', () => {
  it('从约束名拆出字段：只匹配冲突的那个唯一约束', () => {
    const e = p2002({ index: 'User_username_key' }, 'User');
    expect(uniqueViolationFields(e)).toEqual(['username']);
    expect(isUniqueViolation(e, 'username')).toBe(true);
    expect(isUniqueViolation(e, 'email')).toBe(false);
    expect(isUniqueViolation(e)).toBe(true);
  });

  it('复合唯一约束拆出全部字段', () => {
    expect(uniqueViolationFields(p2002({ index: 'DictItem_typeCode_code_key' }, 'DictItem'))).toEqual([
      'typeCode',
      'code',
    ]);
  });

  it('适配器直接给出 fields 时使用 fields', () => {
    expect(isUniqueViolation(p2002({ fields: ['code'] }, 'Role'), 'code')).toBe(true);
  });

  it('主键冲突拆不出字段，但仍算唯一约束冲突', () => {
    const e = p2002({ index: 'DictType_pkey' }, 'DictType');
    expect(uniqueViolationFields(e)).toEqual([]);
    expect(isUniqueViolation(e)).toBe(true);
    expect(isUniqueViolation(e, 'code')).toBe(false);
  });

  it('其他错误不算', () => {
    const notFound = new Prisma.PrismaClientKnownRequestError('Not found', { code: 'P2025', clientVersion: '7.10.1' });
    expect(isUniqueViolation(notFound)).toBe(false);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
  });
});
