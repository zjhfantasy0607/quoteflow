import * as ElementPlusIcons from '@element-plus/icons-vue';
import type {
  InquiryDetailDto,
  MatrixSupplierDto,
  PplResolvedColumn,
  RoundMatrixDto,
} from '@quoteflow/shared';
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import InquiryEvaluationTab from './InquiryEvaluationTab.vue';

const mocks = vi.hoisted(() => ({ matrix: vi.fn(), shortlist: vi.fn(), download: vi.fn(async () => true) }));

vi.mock('@/api/inquiries', () => ({
  inquiriesApi: {
    matrix: mocks.matrix,
    shortlist: mocks.shortlist,
    matrixExportUrl: (id: string, roundNo: number) => `/inquiries/${id}/rounds/${roundNo}/matrix/export`,
  },
}));
vi.mock('@/api/system', () => ({ dictsApi: { load: async () => ({ decline_reason: [] }) } }));
vi.mock('@/utils/download', () => ({ downloadFile: mocks.download }));

const inquiry = (allowedActions: string[]) =>
  ({ id: 'i1', currentRoundNo: 1, allowedActions }) as unknown as InquiryDetailDto;

const column = (key: string, type: string, extra: Record<string, unknown> = {}) =>
  ({
    key,
    group: 'g',
    labelZh: key,
    labelEn: key,
    type,
    source: 'supplier',
    inMatrix: true,
    ...extra,
  }) as unknown as PplResolvedColumn;

function supplier(code: string, extra: Partial<MatrixSupplierDto> = {}): MatrixSupplierDto {
  return {
    quoteId: `q-${code}`,
    supplier: { id: `s-${code}`, code, nameZh: `供应商${code}`, nameEn: null },
    status: 'EVALUATING',
    quoted: true,
    totalAmount: '100.00',
    currency: 'CNY',
    maxLeadTimeDays: 30,
    versionCount: 1,
    currentVersionNo: 1,
    currentVersionSource: 'ONLINE',
    lastSubmittedAt: '2026-11-23T02:00:00.000Z',
    changeNote: null,
    declineReasonCode: null,
    declineReason: null,
    shortlisted: false,
    lowestTotal: false,
    negotiation: null,
    ...extra,
  };
}

function matrix(extra: Partial<RoundMatrixDto> = {}): RoundMatrixDto {
  return {
    roundNo: 1,
    roundStatus: 'OPENED',
    currency: 'CNY',
    columns: [
      column('unit_price_incl_tax', 'money', { sensitive: true, precision: 4 }),
      column('lead_time_days', 'int'),
      column('brand', 'text'),
    ],
    suppliers: [
      supplier('A', {
        totalAmount: '2300.00',
        lowestTotal: true,
        versionCount: 2,
        currentVersionNo: 2,
        changeNote: 'v2 降价',
      }),
      supplier('B', { totalAmount: '2350.00' }),
      supplier('C', {
        status: 'DECLINED',
        quoted: false,
        totalAmount: null,
        currency: null,
        currentVersionNo: null,
        versionCount: 0,
        declineReason: '交期太紧',
      }),
      supplier('D', {
        status: 'INVITED',
        quoted: false,
        totalAmount: null,
        currency: null,
        currentVersionNo: null,
        versionCount: 0,
      }),
    ],
    lines: [
      {
        lineId: 'l1',
        lineNo: 1,
        materialCode: null,
        nameZh: '灯珠 A',
        nameEn: null,
        spec: '2835',
        unitNameZh: '个',
        unitNameEn: 'pcs',
        quantity: '1000',
        quotes: [
          {
            quoteId: 'q-A',
            values: { unit_price_incl_tax: '1.1000', lead_time_days: 25, brand: '甲' },
            changes: { unit_price_incl_tax: '1.2000' },
            lowestUnitPrice: false,
          },
          {
            quoteId: 'q-B',
            values: { unit_price_incl_tax: '1.0000', lead_time_days: 25, brand: '乙' },
            changes: {},
            lowestUnitPrice: true,
          },
        ],
      },
      {
        lineId: 'l2',
        lineNo: 2,
        materialCode: null,
        nameZh: '灯珠 B',
        nameEn: null,
        spec: '5050',
        unitNameZh: '个',
        unitNameEn: 'pcs',
        quantity: '500',
        quotes: [
          {
            quoteId: 'q-A',
            values: { unit_price_incl_tax: '2.4000', lead_time_days: 30, brand: '甲' },
            changes: {},
            lowestUnitPrice: true,
          },
          {
            quoteId: 'q-B',
            values: { unit_price_incl_tax: '2.7000', lead_time_days: 45, brand: '乙' },
            changes: {},
            lowestUnitPrice: false,
          },
        ],
      },
    ],
    shortlistLimit: 2,
    canShortlist: true,
    ...extra,
  };
}

async function mountTab(
  data: RoundMatrixDto,
  actions = ['evaluate', 'shortlist', 'exportMatrix'],
): Promise<VueWrapper> {
  mocks.matrix.mockResolvedValue(data);
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(InquiryEvaluationTab, {
    props: { inquiry: inquiry(actions) },
    global: {
      plugins: [i18n, ElementPlus, pinia],
      components: ElementPlusIcons,
      stubs: { RouterLink: RouterLinkStub },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const tables = (w: VueWrapper) => w.findAll('.el-table');
const bodyRows = (w: VueWrapper, index: number) => tables(w)[index].findAll('.el-table__body tr');
const button = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().startsWith(text));

describe('InquiryEvaluationTab', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('R11-2 汇总表：每家一行，合计最低的标"最低"，拒绝显示原因、开标后已邀请显示"未响应"；可以导出', async () => {
    const w = await mountTab(matrix());
    const rows = bodyRows(w, 0);
    expect(rows).toHaveLength(4);
    expect(rows[0].text()).toContain('CNY 2,300.00');
    expect(rows[0].text()).toContain('最低');
    expect(rows[0].text()).toContain('v2 降价');
    expect(rows[1].text()).not.toContain('最低');
    expect(rows[2].text()).toContain('交期太紧');
    expect(rows[3].text()).toContain('未响应');
    expect(w.findAllComponents(RouterLinkStub)).toHaveLength(2);
    await button(w, '导出 Excel')!.trigger('click');
    expect(mocks.download).toHaveBeenCalledWith(
      '/inquiries/i1/rounds/1/matrix/export',
      undefined,
      'matrix.xlsx',
    );
    w.unmount();

    const readonly = await mountTab(matrix({ canShortlist: false }), ['evaluate']);
    expect(button(readonly, '导出 Excel')).toBeUndefined();
    expect(readonly.findAll('.el-table__body .el-checkbox.is-disabled')).toHaveLength(4);
    readonly.unmount();
  });

  it('R11-6 入围：只能勾选评标中的；满 2 家后其余不可勾；发过议价的不能取消；勾选即保存', async () => {
    const data = matrix();
    data.suppliers[0].shortlisted = true;
    data.suppliers[0].negotiation = { status: 'OPEN', awaiting: 'SUPPLIER', messageCount: 1 };
    const updated = matrix();
    updated.suppliers[0].shortlisted = true;
    updated.suppliers[1].shortlisted = true;
    mocks.shortlist.mockResolvedValue(updated);
    const w = await mountTab(data);
    const boxes = () => tables(w)[0].findAll('.el-table__body .el-checkbox');
    expect(boxes().map((b) => b.classes().includes('is-disabled'))).toEqual([true, false, true, true]);
    expect(w.text()).toContain('已入围 1 / 2 家');

    await boxes()[1].find('input').setValue(true);
    await flushPromises();
    expect(mocks.shortlist).toHaveBeenCalledWith('i1', 1, ['q-A', 'q-B']);
    expect(w.emitted('shortlisted')).toHaveLength(1);
    expect(w.text()).toContain('已入围 2 / 2 家');
    w.unmount();
  });

  it('R11-3 R11-4 明细：含税单价最低的格子高亮，变化的格子高亮并能看原值；切换询价行', async () => {
    const w = await mountTab(matrix());
    const rows = bodyRows(w, 1);
    expect(rows.map((r) => r.find('td').text())).toEqual(['unit_price_incl_tax', 'lead_time_days', 'brand']);
    const price = rows[0].findAll('td');
    expect(price[1].classes()).toContain('is-changed');
    expect(price[1].classes()).not.toContain('is-lowest');
    expect(price[2].classes()).toContain('is-lowest');
    expect(price[1].text()).toContain('1.1000');

    // 第 2 行：甲最低，没有变化
    (w.findComponent({ name: 'ElSelect' }).vm as unknown as { $emit: (e: string, v: string) => void }).$emit(
      'update:modelValue',
      'l2',
    );
    await flushPromises();
    const price2 = bodyRows(w, 1)[0].findAll('td');
    expect(price2[1].classes()).toEqual(expect.arrayContaining(['is-lowest']));
    expect(price2[1].classes()).not.toContain('is-changed');
    w.unmount();
  });

  it('只看差异：隐藏各家取值相同的字段（有变化的照样显示）', async () => {
    const w = await mountTab(matrix());
    await w.find('.el-switch').trigger('click');
    await flushPromises();
    // 第 1 行两家交期都是 25，被隐藏
    expect(bodyRows(w, 1).map((r) => r.find('td').text())).toEqual(['unit_price_incl_tax', 'brand']);
    w.unmount();
  });

  it('S-5 没有 quote.amount：合计和金额字段显示锁', async () => {
    const data = matrix();
    for (const s of data.suppliers) {
      s.maskedFields = ['totalAmount'];
      s.totalAmount = null;
      s.lowestTotal = false;
    }
    for (const l of data.lines) for (const q of l.quotes) q.values.unit_price_incl_tax = null;
    const w = await mountTab(data);
    expect(bodyRows(w, 0)[0].findAll('.masked-value')).toHaveLength(1);
    expect(bodyRows(w, 1)[0].findAll('.masked-value')).toHaveLength(2);
    expect(bodyRows(w, 1)[1].findAll('.masked-value')).toHaveLength(0);
    w.unmount();
  });
});
