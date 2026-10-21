import type { MaterialCategoryNodeDto } from '@quoteflow/shared';
import { describe, expect, it } from 'vitest';
import { categoryMatches, categoryPath } from './categories';

function node(id: string, parentId: string | null): MaterialCategoryNodeDto {
  return {
    id,
    parentId,
    code: id.toUpperCase(),
    nameZh: `分类 ${id}`,
    nameEn: `Category ${id}`,
    sort: 0,
    status: 'ENABLED',
    effectiveEnabled: true,
    isPreset: false,
    remark: null,
    pplVariantCode: null,
    materialCount: 0,
    children: [],
  };
}

describe('分类工具', () => {
  it('categoryMatches 按编码、中英文名称匹配，不区分大小写，空关键字全部匹配', () => {
    const c = { code: 'DRV-CC', nameZh: '恒流电源', nameEn: 'Constant Current Driver' };
    expect(categoryMatches('drv', c)).toBe(true);
    expect(categoryMatches('恒流', c)).toBe(true);
    expect(categoryMatches('current', c)).toBe(true);
    expect(categoryMatches('  ', c)).toBe(true);
    expect(categoryMatches('lens', c)).toBe(false);
  });

  it('categoryPath 返回从顶级到自己的路径', () => {
    const byId = new Map([node('per', null), node('drv', 'per'), node('cc', 'drv')].map((n) => [n.id, n]));
    expect(categoryPath(byId, 'cc').map((n) => n.id)).toEqual(['per', 'drv', 'cc']);
    expect(categoryPath(byId, null)).toEqual([]);
    expect(categoryPath(byId, 'nope')).toEqual([]);
  });
});
