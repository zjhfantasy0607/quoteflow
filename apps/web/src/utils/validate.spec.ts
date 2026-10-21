import { requiredText } from '@quoteflow/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { i18n } from '@/i18n';
import { serverFieldErrors, zodErrors } from './validate';

const schema = z.object({
  name: requiredText(20),
  code: z.string().trim().min(3).max(5),
  email: z.string().trim().email(),
  pattern: z.string().regex(/^[A-Z]+$/),
  roles: z.array(z.string()).min(1),
  qty: z.number().max(10),
  kind: z.enum(['A', 'B']),
  nested: z.object({ title: z.string() }),
});

const valid = {
  name: '灯珠',
  code: 'LED',
  email: ' buyer@example.com ',
  pattern: 'ABC',
  roles: ['BUYER'],
  qty: 10,
  kind: 'A',
  nested: { title: 'x' },
};

describe('zodErrors：zod issue 转成表单提示', () => {
  beforeAll(() => {
    i18n.global.locale.value = 'zh-CN';
  });

  it('校验通过返回空对象（邮箱先去首尾空白再校验）', () => {
    expect(zodErrors(schema, valid)).toEqual({});
  });

  it('缺字段、只有空白提示必填；空数组提示至少选一项', () => {
    expect(zodErrors(schema, { ...valid, name: undefined })).toEqual({ name: '必填' });
    expect(zodErrors(schema, { ...valid, name: '   ' })).toEqual({ name: '必填' });
    expect(zodErrors(schema, { ...valid, roles: [] })).toEqual({ roles: '至少选择一项' });
  });

  it('长度、数值上限、邮箱、正则分别提示', () => {
    expect(zodErrors(schema, { ...valid, code: 'ab', qty: 11, email: 'bad', pattern: 'abc' })).toEqual({
      code: '不能少于 3',
      qty: '不能超过 10',
      email: '邮箱格式不正确',
      pattern: '格式不正确',
    });
  });

  it('类型不对、不在枚举里提示内容不正确；嵌套字段用点分路径', () => {
    expect(zodErrors(schema, { ...valid, kind: 'C', nested: { title: 5 } })).toEqual({
      kind: '内容不正确',
      'nested.title': '内容不正确',
    });
  });
});

describe('serverFieldErrors', () => {
  it('后端 VALIDATION_FAILED 的 details 按字段路径给出提示', () => {
    i18n.global.locale.value = 'zh-CN';
    expect(serverFieldErrors([{ path: 'email', code: 'invalid_format', message: 'x' }])).toEqual({
      email: '内容不正确',
    });
    expect(serverFieldErrors(undefined)).toEqual({});
  });
});
