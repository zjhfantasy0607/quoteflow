import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { MeDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import SupplierCategorySelect from '@/components/SupplierCategorySelect.vue';
import { vPerm } from '@/directives/perm';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import SuppliersPage from './SuppliersPage.vue';

const mocks = vi.hoisted(() => {
  const supplier = (code: string, extra: Record<string, unknown> = {}) => ({
    id: `id-${code}`,
    code,
    nameZh: `${code} 供应商`,
    nameEn: `${code} Supplier`,
    creditCode: null,
    categoryCode: 'STRATEGIC',
    materialCategories: [
      { id: 'c1', code: 'LED', nameZh: '灯珠', nameEn: 'LED Beads', effectiveEnabled: true },
      { id: 'c2', code: 'PER-DRV', nameZh: '驱动电源', nameEn: 'LED Driver', effectiveEnabled: true },
    ],
    contactName: '陈经理',
    contactEmail: 'sales@huaxin.example.com',
    contactPhone: '0755-8888 0001',
    ccEmails: [],
    preferredLanguage: 'bilingual',
    country: null,
    address: null,
    remark: null,
    status: 'ENABLED',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    ...extra,
  });
  const items = [
    supplier('SUP10001'),
    supplier('SUP10002', {
      contactEmail: null,
      contactPhone: null,
      ccEmails: null,
      maskedFields: ['contactEmail', 'contactPhone', 'ccEmails'],
    }),
  ];
  return {
    list: vi.fn(async () => ({ items, total: items.length, page: 1, pageSize: 20 })),
    exportFile: vi.fn(async () => true),
  };
});

vi.mock('@/api/suppliers', () => ({
  suppliersApi: {
    list: mocks.list,
    export: mocks.exportFile,
    setStatus: vi.fn(),
    import: vi.fn(),
    templateUrl: '/api/suppliers/import-template',
  },
  supplierCategoriesApi: {
    list: async () => [
      {
        id: 's1',
        typeCode: 'supplier_category',
        code: 'STRATEGIC',
        nameZh: '战略供应商',
        nameEn: 'Strategic',
        sort: 1,
        status: 'ENABLED',
        remark: null,
      },
    ],
  },
}));

vi.mock('@/api/materials', () => ({ materialCategoriesApi: { tree: async () => [] } }));

function me(permissions: string[], fieldPermissions: string[] = []): MeDto {
  return {
    user: {
      id: 'u1',
      username: 'u1',
      name: 'U1',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions,
    fieldPermissions,
    dataScope: 'SELF',
  };
}

async function mountPage(permissions: string[]): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me(permissions);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/suppliers/:id', name: 'supplier-detail', component: { template: '<div />' } }],
  });
  const w = mount(SuppliersPage, {
    global: {
      plugins: [i18n, ElementPlus, pinia, router],
      components: ElementPlusIcons,
      directives: { perm: vPerm },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

describe('SuppliersPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    mocks.list.mockClear();
    mocks.exportFile.mockClear();
  });

  it('R04-5 分类多选拼成逗号分隔的 categoryCodes，导出用同样的筛选条件', async () => {
    const w = await mountPage(['supplier:view', 'supplier:export']);
    expect(mocks.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });

    w.findComponent(SupplierCategorySelect).vm.$emit('update:modelValue', ['STRATEGIC', 'EXCELLENT']);
    await w.find('input[placeholder="编码、名称或联系人"]').setValue('kevin');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(mocks.list).toHaveBeenLastCalledWith({
      keyword: 'kevin',
      categoryCodes: 'STRATEGIC,EXCELLENT',
      page: 1,
      pageSize: 20,
    });

    const exportButton = w.findAll('button').find((b) => b.text() === '导出')!;
    await exportButton.trigger('click');
    expect(mocks.exportFile).toHaveBeenCalledWith({ keyword: 'kevin', categoryCodes: 'STRATEGIC,EXCELLENT' });
    w.unmount();
  });

  it('R04-7 联系电话被脱敏时显示 ******；有 supplier:manage 也不能编辑被脱敏的供应商', async () => {
    const w = await mountPage(['supplier:view', 'supplier:manage']);
    const rows = w.findAll('.el-table__body tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('0755-8888 0001');
    expect(rows[0].text()).toContain('战略供应商');
    expect(rows[0].text()).toContain('灯珠、驱动电源');
    expect(rows[0].text()).toContain('中英双语');
    expect(rows[1].text()).toContain('******');
    expect(rows[1].text()).not.toContain('0755');

    const editButtons = w.findAll('.el-table__body button').filter((b) => b.text() === '编辑');
    expect(editButtons.map((b) => b.attributes('disabled') !== undefined)).toEqual([false, true]);
    w.unmount();
  });

  it('B-10 分类树内部用户都能读：只有 supplier:view 也显示主营材料分类筛选', async () => {
    const w = await mountPage(['supplier:view']);
    expect(w.find('.category-tree-select').exists()).toBe(true);
    w.unmount();
  });
});
