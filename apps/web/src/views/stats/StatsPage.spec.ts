import * as ElementPlusIcons from '@element-plus/icons-vue';
import type {
  MeDto,
  StatsCycleTimeDto,
  StatsProjectsDto,
  StatsResponseSpeedDto,
  StatsWinRateDto,
} from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { currentAppYear } from '@/utils/stats';
import StatsPage from './StatsPage.vue';

const mocks = vi.hoisted(() => ({
  projects: vi.fn(),
  responseSpeed: vi.fn(),
  winRate: vi.fn(),
  cycleTime: vi.fn(),
  filterOptions: vi.fn(),
  download: vi.fn(async () => true),
}));

vi.mock('@/api/reports', () => ({
  statsApi: {
    projects: mocks.projects,
    responseSpeed: mocks.responseSpeed,
    winRate: mocks.winRate,
    cycleTime: mocks.cycleTime,
    exportUrl: '/stats/export',
  },
  reportsApi: { filterOptions: mocks.filterOptions },
}));
vi.mock('@/api/materials', () => ({ materialCategoriesApi: { tree: async () => [] } }));
vi.mock('@/api/system', () => ({
  dictsApi: {
    load: async () => ({
      supplier_category: [
        {
          id: 'd1',
          typeCode: 'supplier_category',
          code: 'STRATEGIC',
          nameZh: '战略供应商',
          nameEn: 'Strategic',
          sort: 1,
          status: 'ENABLED',
        },
      ],
    }),
  },
}));
vi.mock('@/utils/download', () => ({ downloadFile: mocks.download }));
// jsdom 没有 canvas：图表换成占位，只看传进去的配置
vi.mock('@/utils/echarts', () => ({
  VChart: { name: 'VChart', props: ['option', 'autoresize'], template: '<div class="chart-stub" />' },
}));

const YEAR = currentAppYear();
const supplierA = {
  id: 's1',
  code: 'TS-A',
  nameZh: '供应商甲',
  nameEn: 'Supplier A',
  categoryCode: 'STRATEGIC',
};

const projects = (count: number): StatsProjectsDto => ({
  year: YEAR,
  months: Array.from({ length: 12 }, (_, i) => ({
    month: `${YEAR}-${String(i + 1).padStart(2, '0')}`,
    inquiryCount: i === 0 ? count : 0,
    projectCount: i === 0 ? count : 0,
    categoryCount: i === 0 && count ? 1 : 0,
  })),
  total: { inquiryCount: count, projectCount: count, categoryCount: count ? 1 : 0 },
  categories: [],
});
const response: StatsResponseSpeedDto = {
  from: `${YEAR}-01-01`,
  to: `${YEAR}-12-31`,
  total: 4,
  buckets: [
    { bucket: 'LE_2H', count: 2 },
    { bucket: 'H2_8', count: 1 },
    { bucket: 'H8_24', count: 0 },
    { bucket: 'D1_3', count: 0 },
    { bucket: 'GT_3D', count: 0 },
    { bucket: 'NO_RESPONSE', count: 1 },
  ],
  suppliers: [
    { supplier: supplierA, invitedCount: 4, respondedCount: 3, responseRate: 0.75, avgResponseHours: 3.0056 },
  ],
};
const winRate: StatsWinRateDto = {
  from: `${YEAR}-01-01`,
  to: `${YEAR}-12-31`,
  months: [{ month: `${YEAR}-01`, winCount: 1, participantCount: 2, successRate: 0.5 }],
  total: { winCount: 1, participantCount: 2, successRate: 0.5 },
  suppliers: [{ supplier: supplierA, invitedCount: 3, quotedCount: 2, wonCount: 1, winRate: 0.5 }],
};
const emptyCycle: StatsCycleTimeDto = {
  from: `${YEAR}-01-01`,
  to: `${YEAR}-12-31`,
  total: 0,
  avgDays: null,
  buckets: [
    { bucket: 'LE_3D', count: 0 },
    { bucket: 'D4_7', count: 0 },
    { bucket: 'D8_14', count: 0 },
    { bucket: 'D15_30', count: 0 },
    { bucket: 'GT_30D', count: 0 },
  ],
  months: [],
};

function me(permissions: string[]): MeDto {
  return {
    user: {
      id: 'u1',
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
    fieldPermissions: [],
    dataScope: 'ALL',
  };
}

async function mountPage(permissions = ['stats:view', 'report:export']): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me(permissions);
  const w = mount(StatsPage, {
    global: { plugins: [i18n, ElementPlus, pinia], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const card = (w: VueWrapper, name: string) => w.find(`[data-chart="${name}"]`);

describe('StatsPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.projects.mockResolvedValue(projects(3));
    mocks.responseSpeed.mockResolvedValue(response);
    mocks.winRate.mockResolvedValue(winRate);
    mocks.cycleTime.mockResolvedValue(emptyCycle);
    mocks.filterOptions.mockResolvedValue({ owners: [], suppliers: [supplierA] });
  });

  it('默认统计当年（北京时间），四个接口各用自己的筛选；有数据画图，没数据显示空', async () => {
    const w = await mountPage();
    expect(mocks.projects).toHaveBeenCalledWith({ year: YEAR, materialCategoryId: undefined });
    const range = { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` };
    expect(mocks.responseSpeed).toHaveBeenCalledWith({
      ...range,
      supplierCategoryCode: undefined,
      materialCategoryId: undefined,
    });
    expect(mocks.winRate).toHaveBeenCalledWith({
      ...range,
      supplierId: undefined,
      supplierCategoryCode: undefined,
    });
    expect(mocks.cycleTime).toHaveBeenCalledWith({ ...range, materialCategoryId: undefined });
    for (const name of ['projects', 'response', 'win-rate']) {
      expect(card(w, name).find('.chart-stub').exists()).toBe(true);
    }
    expect(card(w, 'cycle').find('.chart-stub').exists()).toBe(false);
    expect(card(w, 'cycle').text()).toContain('当前筛选条件下没有数据');
    expect(w.text()).toContain('年询盘项目数与品类');
    w.unmount();
  });

  it('展开数据表：每家供应商的响应率、平均响应时长，中标率', async () => {
    const w = await mountPage();
    await card(w, 'response').find('.el-collapse-item__header').trigger('click');
    await flushPromises();
    const row = card(w, 'response').findAll('.supplier-table tbody tr')[0].text();
    expect(row).toContain('TS-A 供应商甲');
    expect(row).toContain('战略供应商');
    expect(row).toContain('75.0%');
    expect(row).toContain('3.0');
    await card(w, 'win-rate').find('.el-collapse-item__header').trigger('click');
    await flushPromises();
    expect(card(w, 'win-rate').text()).toContain('合计：中选 1 次，参与评标报价 2 份，成功率 50.0%');
    w.unmount();
  });

  it('换年度只重新统计年询盘项目数', async () => {
    const w = await mountPage();
    vi.clearAllMocks();
    mocks.projects.mockResolvedValue(projects(0));
    const picker = card(w, 'projects').findComponent({ name: 'ElDatePicker' });
    picker.vm.$emit('update:modelValue', String(YEAR - 1));
    picker.vm.$emit('change', String(YEAR - 1));
    await flushPromises();
    expect(mocks.projects).toHaveBeenCalledWith({ year: YEAR - 1, materialCategoryId: undefined });
    expect(mocks.responseSpeed).not.toHaveBeenCalled();
    expect(card(w, 'projects').find('.chart-stub').exists()).toBe(false);
    w.unmount();
  });

  it('R15-2 导出：要 report:export，按查询时的筛选条件', async () => {
    const w = await mountPage();
    const exportButton = w.findAll('.page-header button').find((b) => b.text() === '导出 Excel')!;
    await exportButton.trigger('click');
    expect(mocks.download).toHaveBeenCalledWith('/stats/export', {
      year: YEAR,
      from: `${YEAR}-01-01`,
      to: `${YEAR}-12-31`,
      materialCategoryId: undefined,
      supplierCategoryCode: undefined,
      supplierId: undefined,
    });
    w.unmount();
    const viewer = await mountPage(['stats:view']);
    expect(viewer.findAll('.page-header button').some((b) => b.text() === '导出 Excel')).toBe(false);
    viewer.unmount();
  });
});
