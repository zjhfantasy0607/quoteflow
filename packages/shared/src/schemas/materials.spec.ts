import { describe, expect, it } from 'vitest';
import {
  categoryTreeQuerySchema,
  createCategorySchema,
  createMaterialSchema,
  updateCategorySchema,
  updateMaterialSchema,
} from './materials';

const category = { code: 'led-2835', nameZh: '2835 灯珠', nameEn: '2835 SMD LED' };
const material = { nameZh: '灯珠 2835', spec: '2835 / 0.5W', unitCode: 'PCS', categoryId: 'c1' };

describe('材料分类 schema', () => {
  it('R03-1 编码去空白、转大写后按 ^[A-Z0-9-]{1,30}$ 校验', () => {
    expect(createCategorySchema.parse({ ...category, code: ' led-2835 ' }).code).toBe('LED-2835');
    expect(createCategorySchema.safeParse({ ...category, code: 'LED_2835' }).success).toBe(false);
    expect(createCategorySchema.safeParse({ ...category, code: 'A'.repeat(31) }).success).toBe(false);
    expect(createCategorySchema.safeParse({ ...category, code: '' }).success).toBe(false);
  });

  it('R03-1 中英文名称都必填', () => {
    expect(createCategorySchema.safeParse({ ...category, nameEn: ' ' }).success).toBe(false);
    expect(createCategorySchema.safeParse({ ...category, nameZh: '' }).success).toBe(false);
  });

  it('PPL 变体：不传为 undefined（不修改），空串和 null 为清除', () => {
    expect(updateCategorySchema.parse({ nameZh: 'a', nameEn: 'b' }).pplVariantCode).toBeUndefined();
    expect(updateCategorySchema.parse({ nameZh: 'a', nameEn: 'b', pplVariantCode: '' }).pplVariantCode).toBeNull();
    expect(updateCategorySchema.parse({ nameZh: 'a', nameEn: 'b', pplVariantCode: null }).pplVariantCode).toBeNull();
    expect(updateCategorySchema.parse({ nameZh: 'a', nameEn: 'b', pplVariantCode: 'ppl-led' }).pplVariantCode).toBe(
      'PPL-LED',
    );
  });

  it('更新时忽略 code、parentId', () => {
    const parsed = updateCategorySchema.parse({ nameZh: 'a', nameEn: 'b', code: 'X', parentId: 'p' });
    expect(parsed).not.toHaveProperty('code');
    expect(parsed).not.toHaveProperty('parentId');
  });

  it('树查询的 includeDisabled 默认 false，只接受 true/false', () => {
    expect(categoryTreeQuerySchema.parse({}).includeDisabled).toBe(false);
    expect(categoryTreeQuerySchema.parse({ includeDisabled: 'true' }).includeDisabled).toBe(true);
    expect(categoryTreeQuerySchema.parse({ includeDisabled: 'false' }).includeDisabled).toBe(false);
    expect(categoryTreeQuerySchema.safeParse({ includeDisabled: '1' }).success).toBe(false);
  });
});

describe('材料 schema', () => {
  it('R03-4 编码可留空（自动生成），手填时去空白转大写', () => {
    expect(createMaterialSchema.parse({ ...material, code: '' }).code).toBeUndefined();
    expect(createMaterialSchema.parse(material).code).toBeUndefined();
    expect(createMaterialSchema.parse({ ...material, code: ' mat-a01 ' }).code).toBe('MAT-A01');
    expect(createMaterialSchema.safeParse({ ...material, code: 'MAT 01' }).success).toBe(false);
    expect(createMaterialSchema.safeParse({ ...material, code: '-MAT' }).success).toBe(false);
  });

  it('R03-4 名称、规格、单位、分类必填；图片默认为空', () => {
    for (const key of ['nameZh', 'spec', 'unitCode', 'categoryId'] as const) {
      expect(createMaterialSchema.safeParse({ ...material, [key]: '' }).success).toBe(false);
    }
    const parsed = updateMaterialSchema.parse({ ...material, nameEn: '', brand: ' ' });
    expect(parsed).toMatchObject({ nameEn: undefined, brand: undefined, imageFileId: null });
  });
});
