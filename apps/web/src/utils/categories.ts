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
