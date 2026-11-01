import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { MeDto, SupplierQuoteItemDto } from '@quoteflow/shared';
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import SupplierPointsTab from './SupplierPointsTab.vue';
import SupplierQuotesTab from './SupplierQuotesTab.vue';

const mocks = vi.hoisted(() => ({ supplierQuotes: vi.fn(), supplierPoints: vi.fn() }));
vi.mock('@/api/reports', () => ({
  reportsApi: { supplierQuotes: mocks.supplierQuotes, supplierPoints: mocks.supplierPoints },
}));

function quote(extra: Partial<SupplierQuoteItemDto>): SupplierQuoteItemDto {
  return {
    id: 'q1',
    inquiry: { id: 'i1', formalNo: 'RFQ-202611-0001', title: '散热器询价' },
    roundNo: 1,
    roundStatus: 'EVALUATED',
    status: 'WON',
    invitedAt: '2026-11-01T01:00:00.000Z',
    respondedAt: '2026-11-01T03:00:00.000Z',
    lastSubmittedAt: '2026-11-01T03:00:00.000Z',
    totalAmount: '12800.00',
    currency: 'CNY',
    sealed: false,
    ...extra,
  };
}

function me(permissions: string[]): MeDto {
  return {
    user: {
      id: 'u1',
      username: 'buyer',
      name: '张三',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions,
    fieldPermissions: ['quote.amount'],
    dataScope: 'SELF',
  };
}

function mountTab(component: object, props: object, permissions: string[]): VueWrapper {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me(permissions);
  return mount(component, {
    props,
    global: {
      plugins: [i18n, ElementPlus, pinia],
      components: ElementPlusIcons,
      stubs: { RouterLink: RouterLinkStub },
    },
    attachTo: document.body,
  });
}

describe('供应商详情的报价记录与积分页签（R15-4）', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('报价记录：金额、未开标密封 🔒、截止后没响应显示"未响应"', async () => {
    mocks.supplierQuotes.mockResolvedValue({
      items: [
        quote({}),
        quote({
          id: 'q2',
          roundStatus: 'WAITING_QUOTES',
          status: 'SUBMITTED',
          totalAmount: null,
          sealed: true,
        }),
        quote({
          id: 'q3',
          roundStatus: 'OPENED',
          status: 'INVITED',
          totalAmount: null,
          lastSubmittedAt: null,
        }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    });
    const w = mountTab(SupplierQuotesTab, { supplierId: 's1' }, ['supplier:view', 'inquiry:view']);
    await flushPromises();
    expect(mocks.supplierQuotes).toHaveBeenCalledWith('s1', { page: 1, pageSize: 20 });
    const rows = w.findAll('.el-table__body tbody tr');
    expect(rows[0].text()).toContain('RFQ-202611-0001');
    expect(rows[0].text()).toContain('已中标');
    expect(rows[0].text()).toContain('CNY 12,800.00');
    expect(rows[1].find('.masked-value').exists()).toBe(true);
    expect(rows[2].text()).toContain('未响应');
    expect(rows[2].find('.masked-value').exists()).toBe(false);
    w.unmount();
  });

  it('积分：累计积分与记录；有 points:adjust 才显示"手工调整"', async () => {
    mocks.supplierPoints.mockResolvedValue({
      items: [
        {
          id: 'p1',
          createdAt: '2026-11-09T09:00:00.000Z',
          supplier: { id: 's1', code: 'TS-A', nameZh: '供应商甲', nameEn: null },
          ruleCode: 'WON',
          delta: 5,
          source: 'AUTO',
          inquiry: { id: 'i1', formalNo: 'RFQ-202611-0001' },
          roundNo: 1,
          remark: null,
          createdBy: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      balance: 8,
    });
    const supplier = { id: 's1', code: 'TS-A', nameZh: '供应商甲', nameEn: null };
    const w = mountTab(SupplierPointsTab, { supplier }, ['supplier:view', 'points:adjust']);
    await flushPromises();
    expect(w.find('.balance').text()).toContain('累计积分');
    expect(w.find('.balance').text()).toContain('8');
    const row = w.find('.el-table__body tbody tr').text();
    expect(row).toContain('中标');
    expect(row).toContain('+5');
    expect(row).toContain('系统');
    expect(w.findAll('button').some((b) => b.text() === '手工调整')).toBe(true);
    w.unmount();
    const viewer = mountTab(SupplierPointsTab, { supplier }, ['supplier:view']);
    await flushPromises();
    expect(viewer.findAll('button').some((b) => b.text() === '手工调整')).toBe(false);
    viewer.unmount();
  });
});
