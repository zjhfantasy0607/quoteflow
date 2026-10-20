import type { DictItemDto } from '@quoteflow/shared';
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { dictsApi } from '@/api/system';

/** 字典缓存（含中英名称，切换语言不需要重新加载） */
export const useDictStore = defineStore('dict', () => {
  const cache = reactive<Record<string, DictItemDto[]>>({});
  const inflight = new Map<string, Promise<void>>();

  async function load(types: string[], force = false): Promise<void> {
    const missing = force ? types : types.filter((t) => !cache[t] && !inflight.has(t));
    if (missing.length > 0) {
      const request = dictsApi.load(missing).then((data) => {
        Object.assign(cache, data);
      });
      for (const t of missing) inflight.set(t, request);
      try {
        await request;
      } finally {
        for (const t of missing) inflight.delete(t);
      }
    }
    await Promise.all(types.map((t) => inflight.get(t)).filter(Boolean));
  }

  function items(type: string): DictItemDto[] {
    return cache[type] ?? [];
  }

  function find(type: string, code: string | null | undefined): DictItemDto | undefined {
    return code ? items(type).find((i) => i.code === code) : undefined;
  }

  /** 字典维护后调用，下次使用时重新加载 */
  function invalidate(types?: string[]): void {
    for (const t of types ?? Object.keys(cache)) delete cache[t];
  }

  return { cache, load, items, find, invalidate };
});
