import * as ElementPlusIcons from '@element-plus/icons-vue';
import {
  PPL_V0,
  resolveColumns,
  type InquiryDetailDto,
  type InquiryRoundDto,
  type QuoteVersionDto,
  type RoundQuoteDetailDto,
} from '@quoteflow/shared';
import { AxiosError, type AxiosResponse } from 'axios';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import InquiryQuoteDetailPage from './InquiryQuoteDetailPage.vue';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  round: vi.fn(),
  quote: vi.fn(),
  quoteVersion: vi.fn(),
}));

vi.mock('@/api/inquiries', () => ({
  inquiriesApi: { get: mocks.get, round: mocks.round, quote: mocks.quote, quoteVersion: mocks.quoteVersion },
}));
vi.mock('@/api/system', () => ({
  dictsApi: { load: async (types: string[]) => Object.fromEntries(types.map((t) => [t, []])) },
  paramsApi: { appConfig: async () => null },
}));

const columns = resolveColumns(PPL_V0, 'PPL-PERIPH');
const sensitive = columns.filter((c) => c.sensitive).map((c) => c.key);

const inquiry = {
  id: 'i1',
  draftNo: 'DR-20261102-0001',
  formalNo: 'RFQ-202611-0001',
  title: '恒流驱动电源询价',
  currency: 'CNY',
} as unknown as InquiryDetailDto;

const round = {
  roundNo: 1,
  lines: [
    {
      id: 'l1',
      lineNo: 1,
      materialId: null,
      materialCode: null,
      nameZh: '恒流驱动电源',
      nameEn: null,
      spec: 'AC220V',
      unitCode: 'PCS',
      quantity: '5000',
      brand: null,
      drawingRef: null,
      remark: null,
      category: { id: 'c1', code: 'DRV-CC', nameZh: '恒流电源', nameEn: 'Constant Current Driver' },
      files: [],
    },
  ],
} as unknown as InquiryRoundDto;

function version(masked: boolean): QuoteVersionDto {
  const amounts = {
    unit_price_incl_tax: '1.1300',
    unit_price_excl_tax: '1.0000',
    total_price_incl_tax: '5650.00',
  };
  return {
    versionNo: 1,
    source: 'ONLINE',
    submittedAt: '2026-11-02T02:00:00.000Z',
    submittedBy: { name: '陈经理' },
    totalAmount: masked ? null : '5650.00',
    currency: 'CNY',
    remark: '含运费',
    changeNote: null,
    attachmentCount: 0,
    templateVersion: 1,
    variantCode: 'PPL-PERIPH',
    attachments: [],
    lines: [
      {
        lineId: 'l1',
        lineNo: 1,
        values: {
          tax_rate: '13.00',
          lead_time_days: 30,
          material: 'PC',
          ...(masked ? Object.fromEntries(sensitive.map((k) => [k, null])) : amounts),
        },
      },
    ],
    ...(masked ? { maskedFields: ['totalAmount', ...sensitive] } : {}),
  };
}

function quote(masked = false): RoundQuoteDetailDto {
  const v = version(masked);
  const { lines: _lines, attachments: _files, templateVersion: _tv, variantCode: _vc, ...summary } = v;
  return {
    id: 'q1',
    status: 'EVALUATING',
    supplier: { id: 's1', code: 'SUP10005', nameZh: '联创光电', nameEn: null },
    invitedAt: '2026-11-02T01:00:00.000Z',
    firstViewedAt: '2026-11-02T01:30:00.000Z',
    respondedAt: '2026-11-02T02:00:00.000Z',
    lastSubmittedAt: '2026-11-02T02:00:00.000Z',
    declinedAt: null,
    declineReasonCode: null,
    declineReason: null,
    template: { version: 1, variantCode: 'PPL-PERIPH', groups: PPL_V0.groups, columns },
    currentVersion: v,
    versions: [summary],
  };
}

async function mountPage(): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/inquiries/:id/rounds/:roundNo/quotes/:quoteId',
        name: 'inquiry-quote',
        component: InquiryQuoteDetailPage,
      },
      { path: '/inquiries/:id', name: 'inquiry-detail', component: { template: '<div />' } },
    ],
  });
  await router.push('/inquiries/i1/rounds/1/quotes/q1');
  const w = mount(InquiryQuoteDetailPage, {
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

describe('InquiryQuoteDetailPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.get.mockResolvedValue(inquiry);
    mocks.round.mockResolvedValue(round);
  });

  it('R10-7 开标后显示供应商、当前版本的合计与只读明细、历史版本', async () => {
    mocks.quote.mockResolvedValue(quote());
    const w = await mountPage();
    expect(mocks.quote).toHaveBeenCalledWith('i1', 1, 'q1');
    const text = w.text();
    expect(text).toContain('SUP10005 · 联创光电');
    expect(text).toContain('RFQ-202611-0001 · 恒流驱动电源询价 · 第 1 轮');
    expect(text).toContain('评标中');
    expect(text).toContain('CNY 5,650.00');
    expect(text).toContain('含运费');
    expect(w.find('.ppl-line-table').text()).toContain('恒流驱动电源');
    expect(w.find('.ppl-line-table').text()).toContain('1.1300');
    expect(w.findAll('input')).toHaveLength(0);
    expect(w.find('.el-timeline').text()).toContain('含税合计 CNY 5,650.00');
    expect(w.findAll('.masked-value')).toHaveLength(0);
    w.unmount();
  });

  it('S-5 没有 quote.amount 时合计和金额列显示锁', async () => {
    mocks.quote.mockResolvedValue(quote(true));
    const w = await mountPage();
    expect(w.text()).not.toContain('5,650.00');
    expect(w.text()).not.toContain('1.1300');
    // 合计、表格里的含税单价 / 含税总价等金额列、时间线上的合计
    expect(w.findAll('.masked-value').length).toBeGreaterThanOrEqual(3);
    expect(w.find('.ppl-line-table').text()).toContain('30');
    w.unmount();
  });

  it('S-1 开标前接口返回 QUOTE_SEALED 时只提示不可查看', async () => {
    const response = { status: 403, data: { code: 'QUOTE_SEALED', message: 'QUOTE_SEALED' } } as AxiosResponse;
    mocks.quote.mockRejectedValue(new AxiosError('sealed', '403', undefined, undefined, response));
    const w = await mountPage();
    expect(w.text()).toContain('开标前不能查看报价内容');
    expect(w.find('.ppl-line-table').exists()).toBe(false);
    w.unmount();
  });
});
