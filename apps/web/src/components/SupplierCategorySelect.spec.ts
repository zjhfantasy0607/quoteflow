import type { DictItemDto } from '@quoteflow/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { applyLocale, i18n } from '@/i18n';
import { supplierLanguageLabel } from '@/utils/suppliers';
import SupplierCategorySelect from './SupplierCategorySelect.vue';

const fixtures = vi.hoisted(() => {
  const item = (code: string, nameZh: string, nameEn: string, status = 'ENABLED') => ({
    id: `id-${code}`,
    typeCode: 'supplier_category',
    code,
    nameZh,
    nameEn,
    sort: 0,
    status,
    remark: null,
  });
  return {
    items: [
      item('STRATEGIC', '战略供应商', 'Strategic'),
      item('EXCELLENT', '优秀供应商', 'Preferred'),
      item('BLOCKED', '暂停合作', 'Suspended', 'DISABLED'),
    ],
    list: vi.fn(),
  };
});

vi.mock('@/api/suppliers', () => ({
  supplierCategoriesApi: {
    list: fixtures.list.mockImplementation(async () => fixtures.items as unknown as DictItemDto[]),
  },
}));

/** 只关心传给 el-option 的数据，不渲染 Element Plus 的下拉 */
const SelectStub = defineComponent({ name: 'ElSelect', template: '<div><slot /></div>' });
const OptionStub = defineComponent({
  name: 'ElOption',
  props: {
    value: { type: String, required: true },
    label: { type: String, required: true },
    disabled: Boolean,
  },
  template: '<div class="option" />',
});

async function mountSelect(props: Record<string, unknown> = {}) {
  const w = mount(SupplierCategorySelect, {
    props,
    global: { plugins: [i18n, ElementPlus], stubs: { ElSelect: SelectStub, ElOption: OptionStub } },
  });
  await flushPromises();
  const options = () =>
    w
      .findAllComponents(OptionStub)
      .map((o) => ({ value: o.props('value'), label: o.props('label'), disabled: o.props('disabled') }));
  return { w, options };
}

describe('SupplierCategorySelect', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    applyLocale('zh-CN');
  });

  it('R04-1 默认只列出启用的分类；当前值已停用时照常显示但不能再选', async () => {
    const { options } = await mountSelect();
    expect(options().map((o) => o.value)).toEqual(['STRATEGIC', 'EXCELLENT']);

    const current = await mountSelect({ modelValue: 'BLOCKED' });
    expect(current.options()).toContainEqual({ value: 'BLOCKED', label: '暂停合作', disabled: true });
  });

  it('R04-5 用作筛选（allow-disabled）时停用的分类也能选；按当前语言显示名称', async () => {
    const { options } = await mountSelect({ allowDisabled: true, multiple: true, modelValue: [] });
    expect(options()).toEqual([
      { value: 'STRATEGIC', label: '战略供应商', disabled: false },
      { value: 'EXCELLENT', label: '优秀供应商', disabled: false },
      { value: 'BLOCKED', label: '暂停合作', disabled: false },
    ]);
    applyLocale('en-US');
    await nextTick();
    expect(options().map((o) => o.label)).toEqual(['Strategic', 'Preferred', 'Suspended']);
    applyLocale('zh-CN');
  });
});

describe('supplierLanguageLabel', () => {
  it('R04-3 首选语言按界面语言显示', () => {
    applyLocale('zh-CN');
    expect(['zh-CN', 'en-US', 'bilingual'].map(supplierLanguageLabel)).toEqual([
      '中文',
      'English',
      '中英双语',
    ]);
    applyLocale('en-US');
    expect(['zh-CN', 'en-US', 'bilingual'].map(supplierLanguageLabel)).toEqual([
      'Chinese',
      'English',
      'Bilingual',
    ]);
    expect(supplierLanguageLabel('fr-FR')).toBe('fr-FR');
    applyLocale('zh-CN');
  });
});
