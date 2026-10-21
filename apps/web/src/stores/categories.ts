import type { MaterialCategoryNodeDto } from '@quoteflow/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { materialCategoriesApi } from '@/api/materials';

/**
 * 材料分类树缓存（含停用节点，CategoryTreeSelect 置灰显示）。一个页面里多个下拉共用一次请求；
 * 分类维护后调用 invalidate()，下次使用时重新加载。
 */
export const useCategoryStore = defineStore('categories', () => {
  const tree = ref<MaterialCategoryNodeDto[] | null>(null);
  let inflight: Promise<void> | null = null;

  const byId = computed(() => {
    const map = new Map<string, MaterialCategoryNodeDto>();
    const walk = (nodes: MaterialCategoryNodeDto[]) => {
      for (const n of nodes) {
        map.set(n.id, n);
        walk(n.children);
      }
    };
    walk(tree.value ?? []);
    return map;
  });

  async function load(force = false): Promise<void> {
    if (tree.value && !force) return;
    if (!inflight) {
      inflight = materialCategoriesApi
        .tree(true)
        .then((data) => {
          tree.value = data;
        })
        .finally(() => {
          inflight = null;
        });
    }
    await inflight;
  }

  function invalidate(): void {
    tree.value = null;
  }

  return { tree, byId, load, invalidate };
});
