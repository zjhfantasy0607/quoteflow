import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { ContractListItemDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import ContractsPage from './ContractsPage.vue';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/api/contracts', () => ({ contractsApi: { list: mocks.list } }));

function item(extra: Partial<ContractListItemDto> = {}): ContractListItemDto {
  return {
    id: 'ct1',
    contractNo: 'CT-202611-0001',
    status: 'PENDING_REVIEW',
    inquiry: { id: 'i1', formalNo: 'PJ-2026-006', title: '灯具支架询价' },
    supplier: { id: 's1', code: 'SUP10003', nameZh: '东莞五金制品有限公司', nameEn: 'Dongguan Hardware' },
    amount: '77000.00',
    currency: 'CNY',
    deliveryDate: '2026-12-01',
    createdAt: '2026-11-06T02:00:00.000Z',
    updatedAt: '2026-11-06T02:00:00.000Z',
    ...extra,
  };
}

let router: Router;

async function mountPage(items: ContractListItemDto[]): Promise<VueWrapper> {
  mocks.list.mockResolvedValue({ items, total: items.length, page: 1, pageSize: 20 });
  const pinia = createPinia();
  setActivePinia(pinia);
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/contracts', name: 'contracts', component: ContractsPage },
      { path: '/contracts/:id', name: 'contract-detail', component: { template: '<div />' } },
    ],
  });
  await router.push('/contracts');
  const w = mount(ContractsPage, {
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

describe('ContractsPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('列表：合同号、询价、供应商、金额、状态；状态页签和关键字按参数查询；点合同号进详情', async () => {
    const w = await mountPage([item()]);
    expect(mocks.list).toHaveBeenLastCalledWith({
      status: undefined,
      keyword: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      pageSize: 20,
    });
    const row = w.find('.el-table__body tbody tr');
    expect(row.text()).toContain('CT-202611-0001');
    expect(row.text()).toContain('PJ-2026-006 · 灯具支架询价');
    expect(row.text()).toContain('SUP10003 东莞五金制品有限公司');
    expect(row.text()).toContain('CNY 77,000.00');
    expect(row.text()).toContain('待审核');
    expect(w.findAll('.el-tabs__item').map((tab) => tab.text())).toEqual([
      '全部',
      '草稿',
      '待审核',
      '待批准',
      '已批准',
    ]);

    await w.find('#tab-PENDING_APPROVAL').trigger('click');
    await flushPromises();
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'PENDING_APPROVAL', page: 1 }),
    );

    await w.find('input').setValue('SUP10003');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'PENDING_APPROVAL', keyword: 'SUP10003' }),
    );

    await w.find('.el-table__body .el-button').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value).toMatchObject({ name: 'contract-detail', params: { id: 'ct1' } });
    w.unmount();
  });

  it('R14-7 没有 contract.amount 时金额显示 🔒', async () => {
    const w = await mountPage([item({ amount: null, maskedFields: ['amount'] })]);
    const row = w.find('.el-table__body tbody tr');
    expect(row.text()).not.toContain('77,000.00');
    expect(row.find('.masked-value').exists()).toBe(true);
    w.unmount();
  });
});
