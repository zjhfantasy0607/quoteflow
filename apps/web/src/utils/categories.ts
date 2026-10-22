import type { MaterialCategoryNodeDto } from '@quoteflow/shared';

type CategoryLike = { code: string; nameZh: string; nameEn: string };

/** 分类搜索：编码、中英文名称包含关键字（不区分大小写） */
export function categoryMatches(keyword: string, category: CategoryLike): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  return [category.code, category.nameZh, category.nameEn].some((v) => v.toLowerCase().includes(k));
}

/** 从顶级到 id 自己的路径；id 为空或不存在时返回空数组 */
export function categoryPath(
  byId: ReadonlyMap<string, MaterialCategoryNodeDto>,
  id: string | null | undefined,
): MaterialCategoryNodeDto[] {
  const path: MaterialCategoryNodeDto[] = [];
  for (let node = id ? byId.get(id) : undefined; node; node = node.parentId ? byId.get(node.parentId) : undefined) {
    path.unshift(node);
  }
  return path;
}

/**
 * R05-6：实际生效的 PPL 变体（与后端 CategoryIndex.pplVariantSource 一致）：自己设置的优先，否则沿上级查找。
 * own 是表单里当前的值（可能还没保存）；code 为 null = 主模板，from = 继承来源
 */
export function effectivePplVariant(
  byId: ReadonlyMap<string, MaterialCategoryNodeDto>,
  parentId: string | null | undefined,
  own: string | null,
): { code: string | null; from: MaterialCategoryNodeDto | null } {
  if (own) return { code: own, from: null };
  const from = categoryPath(byId, parentId).reverse().find((c) => c.pplVariantCode) ?? null;
  return { code: from?.pplVariantCode ?? null, from };
}
