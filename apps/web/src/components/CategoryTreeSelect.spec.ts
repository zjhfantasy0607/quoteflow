import type { MaterialCategoryNodeDto } from '@quoteflow/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { applyLocale, i18n } from '@/i18n';
import CategoryTreeSelect from './CategoryTreeSelect.vue';

const fixtures = vi.hoisted(() => {
  const node = (
    code: string,
    nameZh: string,
    nameEn: string,
    opts: { status?: 'ENABLED' | 'DISABLED'; effective?: boolean; children?: unknown[] } = {},
  ) => ({
    id: `id-${code}`,
    parentId: null,
    code,
    nameZh,
    nameEn,
    sort: 0,
    status: opts.status ?? 'ENABLED',
    effectiveEnabled: opts.effective ?? true,
    isPreset: true,
    remark: null,
    pplVariantCode: null,
    materialCount: 0,
    children: opts.children ?? [],
  });
  const tree = [
    node('LED', '灯珠', 'LED Beads', { children: [node('LED-2835', '2835 灯珠', '2835 SMD LED')] }),
    node('PER', '灯外设', 'Lamp Peripherals', {
      children: [
        node('PER-DRV', '驱动电源', 'LED Driver', {
          status: 'DISABLED',
          effective: false,
          children: [node('DRV-CC', '恒流电源', 'Constant Current Driver', { effective: false })],
        }),
      ],
    }),
  ];
  return { tree, load: vi.fn() };
});

vi.mock('@/api/materials', () => ({
  materialCategoriesApi: {
    tree: fixtures.load.mockImplementation(async () => fixtures.tree as unknown as MaterialCategoryNodeDto[]),
  },
}));

interface Option {
  label: string;
  code: string;
  disabled: boolean;
  off: boolean;
  children: Option[];
}

/** 只关心传给 el-tree-select 的数据，不渲染 Element Plus 的下拉 */
const TreeSelectStub = defineComponent({
  name: 'ElTreeSelect',
  props: { data: { type: Array, default: () => [] }, filterNodeMethod: { type: Function, default: undefined } },
  template: '<div class="stub" />',
});

function flatten(options: Option[]): Record<string, Option> {
  const result: Record<string, Option> = {};
  const walk = (list: Option[]) =>
    list.forEach((o) => {
      result[o.code] = o;
      walk(o.children);
    });
  walk(options);
  return result;
}

async function mountSelect(props: Record<string, unknown> = {}) {
  const w = mount(CategoryTreeSelect, {
    props,
    global: { plugins: [i18n, ElementPlus], stubs: { ElTreeSelect: TreeSelectStub } },
  });
  await flushPromises();
  const stub = w.findComponent(TreeSelectStub);
  return {
    w,
    options: () => flatten(stub.props('data') as Option[]),
    filter: stub.props('filterNodeMethod') as (keyword: string, data: Option) => boolean,
  };
}

describe('CategoryTreeSelect', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    applyLocale('zh-CN');
    fixtures.load.mockClear();
  });

  it('R03-2 默认只能选有效启用的节点：停用的分类和它的下级置灰且不可选', async () => {
    const { options } = await mountSelect();
    const o = options();
    expect(o['LED-2835']).toMatchObject({ disabled: false, off: false });
    expect(o['PER-DRV']).toMatchObject({ disabled: true, off: true });
    expect(o['DRV-CC']).toMatchObject({ disabled: true, off: true });
    expect(fixtures.load).toHaveBeenCalledWith(true);
  });

  it('用作筛选（allow-disabled）时停用的分类也能选，仍然置灰', async () => {
    const { options } = await mountSelect({ allowDisabled: true });
    expect(options()['DRV-CC']).toMatchObject({ disabled: false, off: true });
  });

  it('按当前语言显示名称；按编码和中英文名称搜索', async () => {
    const { options, filter } = await mountSelect();
    expect(options().LED.label).toBe('灯珠');
    applyLocale('en-US');
    await nextTick();
    expect(options().LED.label).toBe('LED Beads');
    const cc = options()['DRV-CC'];
    expect(filter('drv-cc', cc)).toBe(true);
    expect(filter('恒流', cc)).toBe(true);
    expect(filter('current', cc)).toBe(true);
    expect(filter('lens', cc)).toBe(false);
    applyLocale('zh-CN');
  });

  it('同一个页面里的多个下拉只请求一次分类树', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const global = { plugins: [i18n, ElementPlus, pinia], stubs: { ElTreeSelect: TreeSelectStub } };
    mount(CategoryTreeSelect, { global });
    mount(CategoryTreeSelect, { global });
    await flushPromises();
    expect(fixtures.load).toHaveBeenCalledTimes(1);
  });
});
