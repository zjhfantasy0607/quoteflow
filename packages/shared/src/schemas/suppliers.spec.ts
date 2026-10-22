import { describe, expect, it } from 'vitest';
import {
  createSupplierAccountSchema,
  createSupplierSchema,
  supplierListQuerySchema,
  updateSupplierSchema,
} from './suppliers';

const supplier = {
  nameZh: '深圳华信光电科技有限公司',
  categoryCode: 'STRATEGIC',
  contactName: '陈经理',
  contactEmail: 'sales@huaxin.example.com',
};

describe('供应商 schema', () => {
  it('R04-1 名称、分类必填', () => {
    expect(createSupplierSchema.safeParse({ ...supplier, nameZh: ' ' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...supplier, categoryCode: '' }).success).toBe(false);
    const { categoryCode: _omit, ...withoutCategory } = supplier;
    expect(createSupplierSchema.safeParse(withoutCategory).success).toBe(false);
  });

  it('R04-2 编码可留空（自动生成），手填时去空白转大写', () => {
    expect(createSupplierSchema.parse({ ...supplier, code: '' }).code).toBeUndefined();
    expect(createSupplierSchema.parse(supplier).code).toBeUndefined();
    expect(createSupplierSchema.parse({ ...supplier, code: ' sup-a01 ' }).code).toBe('SUP-A01');
    expect(createSupplierSchema.safeParse({ ...supplier, code: 'SUP 01' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...supplier, code: 'S'.repeat(31) }).success).toBe(false);
  });

  it('R04-2 信用代码可空；填写时必须是 18 位字母或数字，小写自动转大写', () => {
    expect(createSupplierSchema.parse({ ...supplier, creditCode: '' }).creditCode).toBeUndefined();
    expect(createSupplierSchema.parse({ ...supplier, creditCode: ' 91440300ma5hx00001 ' }).creditCode).toBe(
      '91440300MA5HX00001',
    );
    expect(createSupplierSchema.safeParse({ ...supplier, creditCode: '91440300MA5HX0000' }).success).toBe(
      false,
    );
    expect(createSupplierSchema.safeParse({ ...supplier, creditCode: '91440300MA5HX0000-' }).success).toBe(
      false,
    );
  });

  it('R04-3 联系人、联系邮箱必填；邮箱转小写；抄送邮箱最多 5 个且去重', () => {
    expect(createSupplierSchema.safeParse({ ...supplier, contactName: '' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...supplier, contactEmail: '' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...supplier, contactEmail: 'not-an-email' }).success).toBe(false);

    const parsed = createSupplierSchema.parse({
      ...supplier,
      contactEmail: ' Sales@Huaxin.Example.com ',
      ccEmails: ['A@x.com', 'a@x.com', 'b@x.com'],
    });
    expect(parsed.contactEmail).toBe('sales@huaxin.example.com');
    expect(parsed.ccEmails).toEqual(['a@x.com', 'b@x.com']);

    const six = Array.from({ length: 6 }, (_, i) => `cc${i}@x.com`);
    expect(createSupplierSchema.safeParse({ ...supplier, ccEmails: six }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...supplier, ccEmails: ['bad'] }).success).toBe(false);
  });

  it('R04-3 首选语言只能是 zh-CN / en-US / bilingual，默认 zh-CN', () => {
    expect(createSupplierSchema.parse(supplier).preferredLanguage).toBe('zh-CN');
    expect(
      createSupplierSchema.parse({ ...supplier, preferredLanguage: 'bilingual' }).preferredLanguage,
    ).toBe('bilingual');
    expect(createSupplierSchema.safeParse({ ...supplier, preferredLanguage: 'ja-JP' }).success).toBe(false);
  });

  it('R04-4 主营材料分类可多选，默认为空，去重', () => {
    expect(createSupplierSchema.parse(supplier).materialCategoryIds).toEqual([]);
    expect(
      createSupplierSchema.parse({ ...supplier, materialCategoryIds: ['c1', 'c2', 'c1'] })
        .materialCategoryIds,
    ).toEqual(['c1', 'c2']);
  });

  it('更新时忽略 code，可选文本空串视为未填', () => {
    const parsed = updateSupplierSchema.parse({ ...supplier, code: 'HACKED', nameEn: '', contactPhone: ' ' });
    expect(parsed).not.toHaveProperty('code');
    expect(parsed).toMatchObject({ nameEn: undefined, contactPhone: undefined, ccEmails: [] });
  });

  it('R04-5 列表筛选：分类多选用逗号分隔', () => {
    const q = supplierListQuerySchema.parse({
      categoryCodes: 'STRATEGIC, EXCELLENT,,STRATEGIC',
      status: 'ENABLED',
    });
    expect(q).toMatchObject({
      categoryCodes: ['STRATEGIC', 'EXCELLENT'],
      status: 'ENABLED',
      page: 1,
      pageSize: 20,
    });
    expect(supplierListQuerySchema.parse({}).categoryCodes).toBeUndefined();
    expect(supplierListQuerySchema.safeParse({ status: 'ACTIVE' }).success).toBe(false);
  });
});

describe('门户账号 schema', () => {
  it('R04-10 开通账号：邮箱和姓名必填，邮箱转小写', () => {
    expect(createSupplierAccountSchema.parse({ email: ' Kevin@Example.com ', name: 'Kevin' })).toEqual({
      email: 'kevin@example.com',
      name: 'Kevin',
    });
    expect(createSupplierAccountSchema.safeParse({ email: 'kevin', name: 'Kevin' }).success).toBe(false);
    expect(createSupplierAccountSchema.safeParse({ email: 'kevin@example.com', name: '' }).success).toBe(
      false,
    );
  });
});
