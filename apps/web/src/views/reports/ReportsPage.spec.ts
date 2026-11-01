import * as ElementPlusIcons from '@element-plus/icons-vue';
import type {
  InquiryReportRowDto,
  LogisticsReportDto,
  MeDto,
  PointsLedgerItemDto,
  PplColumn,
} from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import ReportsPage from './ReportsPage.vue';

const mocks = vi.hoisted(() => ({
  filterOptions: vi.fn(),
  inquiries: vi.fn(),
  logistics: vi.fn(),
  pointsSummary: vi.fn(),
  pointsLedger: vi.fn(),
  adjustPoints: vi.fn(),
  download: vi.fn(async () => true),
}));

vi.mock('@/api/reports', () => ({
  reportsApi: {
    filterOptions: mocks.filterOptions,
    inquiries: mocks.inquiries,
    logistics: mocks.logistics,
    pointsSummary: mocks.pointsSummary,
    pointsLedger: mocks.pointsLedger,
    adjustPoints: mocks.adjustPoints,
    exportUrl: (type: string) => `/reports/${type}/export`,
  },
}));
vi.mock('@/api/materials', () => ({ materialCategoriesApi: { tree: async () => [] } }));
vi.mock('@/api/system', () => ({ dictsApi: { load: async () => ({}) } }));
vi.mock('@/utils/download', () => ({ downloadFile: mocks.download }));

const supplierA = { id: 's1', code: 'TS-A', nameZh: '供应商甲', nameEn: null };

function row(extra: Partial<InquiryReportRowDto> = {}): InquiryReportRowDto {
  return {
    roundId: 'r1',
    inquiry: { id: 'i1', formalNo: 'RFQ-202611-0001', title: '报表询价一', projectNo: 'PJ-1' },
    roundNo: 1,
    roundStatus: 'EVALUATED',
    materialCategory: { id: 'c1', code: 'LED-2835', nameZh: '2835 灯珠', nameEn: '2835 SMD LED' },
    currency: 'CNY',
    invitedCount: 3,
    quotedCount: 2,
    minTotal: '2350.00',
    maxTotal: '2400.00',
    avgTotal: '2375.00',
    sealed: false,
    winner: { id: 's2', code: 'TS-B', nameZh: '供应商乙', nameEn: null },
    owner: { id: 'u1', name: '张三' },
    publishedAt: '2026-11-09T01:00:00.000Z',
    ...extra,
  };
}

const ledgerEntry: PointsLedgerItemDto = {
  id: 'p1',
  createdAt: '2026-11-09T09:00:00.000Z',
  supplier: supplierA,
  ruleCode: 'MANUAL',
  delta: -3,
  source: 'MANUAL',
  inquiry: null,
  roundNo: null,
  remark: '样品尺寸超差',
  createdBy: { id: 'u2', name: '张伟' },
};

function me(permissions: string[], fieldPermissions: string[] = []): MeDto {
  return {
    user: {
      id: 'u2',
      username: 'manager',
      name: '张伟',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions,
    fieldPermissions,
    dataScope: 'ALL',
  };
}

let router: Router;

async function mountAt(path: string, permissions: string[]): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me(permissions);
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reports', name: 'reports', component: ReportsPage },
      { path: '/inquiries/:id', name: 'inquiry-detail', component: { template: '<div />' } },
      { path: '/suppliers/:id', name: 'supplier-detail', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  const w = mount(ReportsPage, {
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const visiblePane = (w: VueWrapper) =>
  w.findAll('.el-tab-pane').find((p) => (p.element as HTMLElement).style.display !== 'none')!;

describe('ReportsPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.filterOptions.mockResolvedValue({
      owners: [{ id: 'u1', name: '张三' }],
      suppliers: [{ ...supplierA, categoryCode: 'STRATEGIC', status: 'ENABLED' }],
    });
    mocks.inquiries.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mocks.pointsLedger.mockResolvedValue({ items: [ledgerEntry], total: 1, page: 1, pageSize: 20 });
  });

  it('询报价单统计：金额、中标供应商；未开标的轮次金额密封 🔒，没有 quote.amount 的 🔒', async () => {
    mocks.inquiries.mockResolvedValue({
      items: [
        row(),
        row({
          roundId: 'r2',
          roundStatus: 'WAITING_QUOTES',
          minTotal: null,
          maxTotal: null,
          avgTotal: null,
          sealed: true,
          winner: null,
        }),
        row({
          roundId: 'r3',
          minTotal: null,
          maxTotal: null,
          avgTotal: null,
          maskedFields: ['minTotal', 'maxTotal', 'avgTotal'],
        }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    });
    const w = await mountAt('/reports', ['report:view', 'report:export', 'inquiry:view']);
    expect(mocks.inquiries).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, inquiryNo: undefined }),
    );
    expect(w.text()).toContain('统计结果：共 3 条');
    // 固定列会让表格渲染两遍，按主体表格取行
    const rows = w.findAll('.el-table__body-wrapper tbody tr');
    expect(rows[0].text()).toContain('CNY 2,350.00');
    expect(rows[0].text()).toContain('TS-B 供应商乙');
    expect(rows[0].text()).toContain('评标完成');
    expect(rows[1].findAll('.masked-value')).toHaveLength(3);
    expect(rows[1].text()).not.toContain('2,350.00');
    expect(rows[2].findAll('.masked-value')).toHaveLength(3);

    await w.find('.report-filters input').setValue('RFQ-202611');
    await w.find('.report-filters').trigger('submit');
    await flushPromises();
    expect(mocks.inquiries).toHaveBeenLastCalledWith(
      expect.objectContaining({ inquiryNo: 'RFQ-202611', page: 1 }),
    );
    const exportButton = w.findAll('button').find((b) => b.text() === '导出 Excel')!;
    await exportButton.trigger('click');
    expect(mocks.download).toHaveBeenCalledWith(
      '/reports/inquiries/export',
      expect.objectContaining({ inquiryNo: 'RFQ-202611' }),
    );
    w.unmount();
  });

  it('物流报价明细：列来自 PPL 的物流列，运费按 quote.amount 显示 🔒', async () => {
    const column = (key: string, labelZh: string, type: string, extra: Partial<PplColumn> = {}) =>
      ({
        key,
        group: 'logistics',
        labelZh,
        labelEn: key,
        type,
        source: 'supplier',
        logistics: true,
        ...extra,
      }) as PplColumn;
    const data: LogisticsReportDto = {
      columns: [
        column('pcs_per_carton', '每箱数量', 'int'),
        column('freight_cost', '运费', 'money', { sensitive: true }),
      ],
      items: [
        {
          id: 'q1:l1',
          quoteId: 'q1',
          inquiry: { id: 'i1', formalNo: 'RFQ-202611-0001', title: '报表询价一' },
          roundNo: 1,
          roundStatus: 'EVALUATED',
          supplier: supplierA,
          versionNo: 1,
          lineNo: 1,
          materialCode: null,
          nameZh: '灯珠 A',
          nameEn: null,
          spec: 'SPEC-1',
          currency: 'CNY',
          values: { pcs_per_carton: 2000, freight_cost: null },
          maskedFields: ['freight_cost'],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    mocks.logistics.mockResolvedValue(data);
    const w = await mountAt('/reports?tab=logistics', ['report:view']);
    expect(mocks.logistics).toHaveBeenCalled();
    const pane = visiblePane(w);
    expect(pane.text()).toContain('每箱数量');
    expect(pane.text()).toContain('运费');
    const tr = pane.find('.el-table__body-wrapper tbody tr');
    expect(tr.text()).toContain('2000');
    expect(tr.find('.masked-value').exists()).toBe(true);
    // 没有 report:export 不显示导出
    expect(pane.findAll('button').some((b) => b.text() === '导出 Excel')).toBe(false);
    w.unmount();
  });

  it('R15-3 积分记录流水：手工调整要 points:adjust；备注必填，前端先拦住；成功后刷新流水', async () => {
    const w = await mountAt('/reports?tab=points-ledger', ['report:view', 'points:adjust']);
    const pane = visiblePane(w);
    expect(pane.find('.el-table__body-wrapper tbody tr').text()).toContain('手工调整');
    expect(pane.find('.el-table__body-wrapper tbody tr').text()).toContain('-3');
    await pane
      .findAll('button')
      .find((b) => b.text() === '手工调整')!
      .trigger('click');
    await flushPromises();
    const dialog = () => document.querySelector('.el-dialog') as HTMLElement;
    const confirm = () =>
      [...dialog().querySelectorAll('button')].find((b) => b.textContent?.trim() === '确定')!;
    confirm().click();
    await flushPromises();
    expect(mocks.adjustPoints).not.toHaveBeenCalled();
    // 供应商、分值、备注三项都标红（Element Plus 的提示文字在测试里被过渡动画的占位挡住，只看状态）
    expect(dialog().querySelectorAll('.el-form-item.is-error')).toHaveLength(3);

    const dialogWrapper = w.findComponent({ name: 'PointsAdjustDialog' });
    dialogWrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 's1');
    dialogWrapper.findComponent({ name: 'ElInputNumber' }).vm.$emit('update:modelValue', 3);
    const remark = dialog().querySelector('textarea')!;
    remark.value = '配合紧急插单';
    remark.dispatchEvent(new Event('input'));
    await flushPromises();
    mocks.adjustPoints.mockResolvedValue({ ...ledgerEntry, delta: 3, remark: '配合紧急插单' });
    confirm().click();
    await flushPromises();
    expect(mocks.adjustPoints).toHaveBeenCalledWith('s1', { delta: 3, remark: '配合紧急插单' });
    expect(mocks.pointsLedger).toHaveBeenCalledTimes(2);
    w.unmount();
  });
});
