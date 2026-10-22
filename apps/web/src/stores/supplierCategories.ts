import type { DictItemDto } from '@quoteflow/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supplierCategoriesApi } from '@/api/suppliers';

/**
 * 供应商分类缓存（含停用的：列表筛选、分类标签要显示停用分类的名称）。一个页面里多处共用一次请求；
 * 供应商分类页保存后调用 load(true)。
 */
export const useSupplierCategoryStore = defineStore('supplierCategories', () => {
  const items = ref<DictItemDto[] | null>(null);
  let inflight: Promise<void> | null = null;

  async function load(force = false): Promise<void> {
    if (items.value && !force) return;
    if (!inflight) {
      inflight = supplierCategoriesApi
        .list()
        .then((data) => {
          items.value = data;
        })
        .finally(() => {
          inflight = null;
        });
    }
    await inflight;
  }

  function find(code: string | null | undefined): DictItemDto | undefined {
    return code ? items.value?.find((c) => c.code === code) : undefined;
  }

  return { items, load, find };
});
