import * as ElementPlusIcons from '@element-plus/icons-vue';
import {
  PPL_V0,
  resolveColumns,
  type PortalQuoteDetailDto,
  type QuoteVersionDto,
  type QuoteVersionSummaryDto,
} from '@quoteflow/shared';
import { AxiosError, type AxiosResponse } from 'axios';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import PortalQuoteDetailPage from './PortalQuoteDetailPage.vue';

const mocks = vi.hoisted(() => ({
  quote: vi.fn(),
  versions: vi.fn(),
  version: vi.fn(),
  saveDraft: vi.fn(),
  submit: vi.fn(),
  decline: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@/api/portal', () => ({
  portalApi: {
    quote: mocks.quote,
    versions: mocks.versions,
    version: mocks.version,
    saveDraft: mocks.saveDraft,
    submit: mocks.submit,
    decline: mocks.decline,
    importExcel: vi.fn(),
    excelTemplateUrl: (id: string) => `/api/portal/quotes/${id}/excel-template`,
  },
}));
const DICT: Record<string, { code: string; nameZh: string; nameEn: string }[]> = {
  unit: [{ code: 'PCS', nameZh: '个', nameEn: 'pcs' }],
  decline_reason: [{ code: 'LEAD_TIME', nameZh: '交期无法满足', nameEn: 'Cannot meet lead time' }],
};
vi.mock('@/api/system', () => ({
  dictsApi: {
    load: async (types: string[]) =>
      Object.fromEntries(
        types.map((t) => [
          t,
          (DICT[t] ?? []).map((d, i) => ({
            ...d,
            id: `${t}-${i}`,
            typeCode: t,
            sort: i,
            status: 'ENABLED',
            remark: null,
          })),
        ]),
      ),
  },
  paramsApi: { appConfig: async () => null },
}));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm }));

const ALL_ACTIONS: PortalQuoteDetailDto['allowedActions'] = [
  'saveDraft',
  'submit',
  'decline',
  'downloadTemplate',
  'importExcel',
];

const file = (id: string, originalName: string) => ({
  id,
  originalName,
  mimeType: 'application/pdf',
  size: 2048,
  kind: 'SPEC_DOC' as const,
  createdAt: '2026-11-02T01:00:00.000Z',
});

/** 恒流驱动电源 1 行（数量 5000），PPL-PERIPH：必填含税单价、税率、交期、材质 */
function detail(extra: Partial<PortalQuoteDetailDto> = {}): PortalQuoteDetailDto {
  return {
    id: 'q1',
    status: 'INVITED',
    invitedAt: '2026-11-02T01:00:00.000Z',
    firstViewedAt: '2026-11-02T02:00:00.000Z',
    respondedAt: null,
    lastSubmittedAt: null,
    declinedAt: null,
    declineReasonCode: null,
    declineReason: null,
    inquiry: {
      formalNo: 'RFQ-202611-0001',
      title: '恒流驱动电源询价',
      currency: 'CNY',
      description: null,
      buyer: { name: '张三', email: 'buyer.zhang@example.com' },
      cancelledAt: null,
      cancelReason: null,
    },
    round: {
      roundNo: 1,
      status: 'WAITING_QUOTES',
      deadline: '2099-11-05T10:00:00.000Z',
      publishedAt: '2026-11-02T01:00:00.000Z',
      changeReason: null,
      changeSummary: null,
      pplTemplateVersion: 1,
      pplVariantCode: 'PPL-PERIPH',
    },
    lines: [
      {
        id: 'l1',
        lineNo: 1,
        materialCode: 'MAT-000005',
        nameZh: '恒流驱动电源',
        nameEn: 'CC LED Driver',
        spec: 'AC220V / DC30–42V',
        unitCode: 'PCS',
        quantity: '5000',
        brand: null,
        drawingRef: null,
        category: { code: 'DRV-CC', nameZh: '恒流电源', nameEn: 'Constant Current Driver' },
        files: [{ id: 'm2', kind: 'PRODUCT_IMAGE', file: file('f2', '外观.png') }],
      },
    ],
    files: [{ id: 'm1', kind: 'SPEC_DOC', file: file('f1', '规格书.pdf') }],
    template: {
      version: 1,
      variantCode: 'PPL-PERIPH',
      groups: PPL_V0.groups,
      columns: resolveColumns(PPL_V0, 'PPL-PERIPH'),
    },
    draft: null,
    currentVersion: null,
    versionCount: 0,
    negotiationStatus: null,
    allowedActions: [],
    ...extra,
  };
}

function version(no: number, price: string, total: string): QuoteVersionDto {
  return {
    versionNo: no,
    source: 'ONLINE',
    submittedAt: `2026-11-0${no + 1}T02:00:00.000Z`,
    submittedBy: { name: '陈经理' },
    totalAmount: total,
    currency: 'CNY',
    remark: '含运费',
    changeNote: no > 1 ? '降价' : null,
    attachmentCount: 0,
    templateVersion: 1,
    variantCode: 'PPL-PERIPH',
    attachments: [],
    lines: [
      {
        lineId: 'l1',
        lineNo: 1,
        values: {
          unit_price_incl_tax: price,
          tax_rate: '13.00',
          lead_time_days: 30,
          material: 'PC',
          unit_price_excl_tax: '1.0000',
          total_price_incl_tax: total,
        },
      },
    ],
  };
}

async function mountPage(value: PortalQuoteDetailDto): Promise<VueWrapper> {
  mocks.quote.mockResolvedValue(value);
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/portal/quotes/:quoteId', name: 'portal-quote', component: PortalQuoteDetailPage },
      { path: '/portal/quotes', name: 'portal-quotes', component: { template: '<div />' } },
    ],
  });
  await router.push('/portal/quotes/q1');
  const w = mount(PortalQuoteDetailPage, {
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const quoteCard = (w: VueWrapper) => w.find('.quote-form');
const buttonByText = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text() === text)!;
/** 表格里某个供应商列的输入框（PplValueInput 的 data-key） */
const cellInput = (w: VueWrapper, key: string) =>
  quoteCard(w).find(`.ppl-line-table [data-key="${key}"] input`);
const drawer = () => document.body.querySelector('.ppl-form');

describe('PortalQuoteDetailPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // jsdom 没有 scrollIntoView（抽屉定位到出错字段时调用）
    Element.prototype.scrollIntoView = vi.fn();
    mocks.versions.mockResolvedValue([]);
  });

  it('询价信息、采购联系人、明细；附件按整单 / 行列出，下载走记录日志的内容接口', async () => {
    const w = await mountPage(detail());
    const text = w.text();
    expect(text).toContain('RFQ-202611-0001 · 恒流驱动电源询价');
    expect(text).toContain('张三（buyer.zhang@example.com）');
    expect(text).toContain('待报价');
    expect(text).toContain('询价明细（共 1 行）');
    expect(text).toContain('在线预览和下载都会被记录');
    const rows = w.find('.files-card').findAll('.el-table__body tr');
    expect(rows.map((r) => r.findAll('td')[0].text())).toEqual(['整单', '第 1 行']);
    const links = w.findAll('a').map((a) => a.attributes('href'));
    expect(links).toContain('/api/files/f1/content?disposition=attachment');
    expect(links).toContain('/api/files/f2/content?disposition=attachment');
    expect(w.find('.banner').exists()).toBe(false);
    w.unmount();
  });

  it('R08-6 作废的报价单、取消的询价只读并标明', async () => {
    let w = await mountPage(
      detail({ status: 'VOID', round: { ...detail().round, roundNo: 1, status: 'SUPERSEDED' } }),
    );
    expect(w.find('.el-alert').text()).toContain('本报价单已作废（第 1 轮），只能查看');
    w.unmount();

    w = await mountPage(
      detail({
        status: 'VOID',
        inquiry: { ...detail().inquiry, cancelledAt: '2026-11-03T02:00:00.000Z', cancelReason: '项目暂停' },
        round: { ...detail().round, status: 'CANCELLED' },
      }),
    );
    expect(w.find('.el-alert').text()).toContain('询价已于 2026-11-03 10:00 北京时间 取消，原因：项目暂停');
    expect(w.text()).toContain('已作废');
    w.unmount();
  });

  it('M12 §5 定标后：中标显示"恭喜中标"，未中标显示"本次未中标，感谢参与"', async () => {
    const evaluated = { ...detail().round, status: 'EVALUATED' as const };
    let w = await mountPage(detail({ status: 'WON', round: evaluated }));
    expect(w.find('.el-alert').text()).toContain('恭喜中标');
    expect(w.text()).toContain('已中标');
    w.unmount();

    w = await mountPage(detail({ status: 'LOST', round: evaluated }));
    expect(w.find('.el-alert').text()).toContain('本次未中标，感谢贵司的参与');
    expect(w.text()).toContain('未中标');
    w.unmount();
  });

  it('别家的报价单（404）显示找不到', async () => {
    const response = { status: 404, data: { code: 'NOT_FOUND', message: 'NOT_FOUND' } } as AxiosResponse;
    mocks.quote.mockRejectedValue(
      new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, response),
    );
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/portal/quotes/:quoteId', name: 'portal-quote', component: PortalQuoteDetailPage }],
    });
    await router.push('/portal/quotes/other');
    const w = mount(PortalQuoteDetailPage, {
      global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
    });
    await flushPromises();
    expect(w.text()).toContain('找不到这张询价');
    w.unmount();
  });

  it('R09-2 R09-3 新草稿用默认值（税率 13）；表格显示列表列、必填带 *；改单价后合计实时计算', async () => {
    const w = await mountPage(detail({ allowedActions: ALL_ACTIONS }));
    const card = quoteCard(w);
    expect(card.text()).toContain('截止时间前可多次更新，系统以最后一次提交为准');
    const headers = card.findAll('.ppl-line-table th').map((th) => th.text());
    expect(headers).toEqual(
      expect.arrayContaining([
        '行号',
        '物料名称',
        '需求数量',
        '*含税单价',
        '*税率(%)',
        '含税总价',
        '*量产交期(天)',
      ]),
    );
    expect((cellInput(w, 'tax_rate').element as HTMLInputElement).value).toBe('13.00');
    expect(card.find('.total').text()).toContain('CNY 0.00');

    await cellInput(w, 'unit_price_incl_tax').setValue('2');
    await cellInput(w, 'unit_price_incl_tax').trigger('blur');
    expect((cellInput(w, 'unit_price_incl_tax').element as HTMLInputElement).value).toBe('2.0000');
    expect(card.find('.total').text()).toContain('CNY 10,000.00');
    expect(card.text()).toContain('必填 2/4');
    expect(card.findAll('a').map((a) => a.attributes('href'))).toContain(
      '/api/portal/quotes/q1/excel-template',
    );
    w.unmount();
  });

  it('R09-11 提交前做同样的校验：不调接口，打开出错行的抽屉并定位到第一个出错字段', async () => {
    const w = await mountPage(detail({ allowedActions: ALL_ACTIONS }));
    await cellInput(w, 'unit_price_incl_tax').setValue('1.123456');
    await buttonByText(w, '提交报价').trigger('click');
    await flushPromises();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(quoteCard(w).text()).toContain('小数不能超过 4 位');
    const form = drawer();
    expect(form?.textContent).toContain('第 1 行 · 恒流驱动电源');
    expect(form?.textContent).toContain('这一行有 3 处需要修改');
    // 第一个错误是材质（按列顺序在含税单价前面），抽屉里它下面有提示
    const material = form!.querySelector('[data-field="material"]');
    expect(material?.classList.contains('is-error')).toBe(true);
    expect(material?.textContent).toContain('必填');
    w.unmount();
  });

  it('R09-4 填齐后提交：请求体是表单取值，成功后换成返回的详情', async () => {
    const submitted = detail({
      status: 'SUBMITTED',
      allowedActions: ALL_ACTIONS,
      currentVersion: version(1, '1.1300', '5650.00'),
      versionCount: 1,
    });
    mocks.submit.mockResolvedValue(submitted);
    mocks.versions.mockResolvedValue([version(1, '1.1300', '5650.00')]);
    const w = await mountPage(detail({ allowedActions: ALL_ACTIONS }));
    await cellInput(w, 'unit_price_incl_tax').setValue('1.13');
    await cellInput(w, 'lead_time_days').setValue('30');
    await cellInput(w, 'lead_time_days').trigger('blur');
    // 材质不是列表列，在抽屉里填
    await w
      .findAll('.ppl-line-table button')
      .find((b) => b.text() === '编辑全部字段')!
      .trigger('click');
    await flushPromises();
    const material = drawer()!.querySelector<HTMLInputElement>('[data-field="material"] input')!;
    material.value = 'PC';
    material.dispatchEvent(new Event('input'));
    await flushPromises();

    await buttonByText(w, '提交报价').trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('生成第 1 版报价'), { type: 'info' });
    expect(mocks.submit).toHaveBeenCalledWith('q1', {
      lines: { l1: { tax_rate: '13.00', unit_price_incl_tax: '1.13', lead_time_days: 30, material: 'PC' } },
      remark: '',
      changeNote: '',
      attachmentFileIds: [],
    });
    expect(quoteCard(w).text()).toContain('当前有效报价：第 1 版');
    expect(buttonByText(w, '提交新版本').exists()).toBe(true);
    w.unmount();
  });

  it('R09-11 服务端返回 QUOTE_VALUES_INVALID 时同样定位到出错的行和字段', async () => {
    const response = {
      status: 422,
      data: {
        code: 'QUOTE_VALUES_INVALID',
        message: 'invalid',
        params: { count: 1 },
        details: [
          { lineId: 'l1', lineNo: 1, key: 'payment_terms', code: 'invalid_option', params: { value: 'X' } },
        ],
      },
    } as AxiosResponse;
    mocks.saveDraft.mockRejectedValue(
      new AxiosError('Unprocessable', 'ERR_BAD_REQUEST', undefined, undefined, response),
    );
    const w = await mountPage(detail({ allowedActions: ALL_ACTIONS }));
    await buttonByText(w, '保存草稿').trigger('click');
    await flushPromises();
    expect(mocks.saveDraft).toHaveBeenCalled();
    expect(drawer()?.querySelector('[data-field="payment_terms"]')?.textContent).toContain('没有选项 X');
    w.unmount();
  });

  it('R09-6 拒绝报价：原因和说明都必填，没填不调接口', async () => {
    const w = await mountPage(detail({ allowedActions: ALL_ACTIONS }));
    await buttonByText(w, '拒绝报价').trigger('click');
    await flushPromises();
    const dialog = [...document.body.querySelectorAll('.el-dialog')].find((d) =>
      d.textContent?.includes('确认拒绝'),
    )!;
    [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('确认拒绝'))!.click();
    await flushPromises();
    expect(mocks.decline).not.toHaveBeenCalled();
    expect(dialog.querySelectorAll('.el-form-item.is-error')).toHaveLength(2);
    w.unmount();
  });

  it('R09-8 有草稿时以草稿为底（导入 Excel 的草稿标明来源），备注、变更说明、附件都带上', async () => {
    const w = await mountPage(
      detail({
        allowedActions: ALL_ACTIONS,
        currentVersion: version(1, '1.1300', '5650.00'),
        versionCount: 1,
        draft: {
          lines: { l1: { unit_price_incl_tax: '0.9000', tax_rate: '13.00', certifications: ['CE'] } },
          remark: '草稿备注',
          changeNote: '准备降价',
          attachments: [file('f9', '报价说明.pdf')],
          source: 'EXCEL',
          updatedAt: '2026-11-03T02:00:00.000Z',
        },
      }),
    );
    const card = quoteCard(w);
    expect(card.text()).toContain('草稿来自 Excel 导入（2026-11-03 10:00）');
    expect((cellInput(w, 'unit_price_incl_tax').element as HTMLInputElement).value).toBe('0.9000');
    expect(card.find('.total').text()).toContain('CNY 4,500.00');
    const textareas = card.findAll('.extra textarea').map((t) => (t.element as HTMLTextAreaElement).value);
    expect(textareas).toEqual(['草稿备注', '准备降价']);
    expect(card.text()).toContain('报价说明.pdf');
    w.unmount();
  });

  it('没有草稿时以当前版本为底：备注、附件沿用，变更说明清空；输入和失焦在同一时刻也不丢', async () => {
    const w = await mountPage(
      detail({
        status: 'SUBMITTED',
        allowedActions: ALL_ACTIONS,
        currentVersion: version(1, '1.1300', '5650.00'),
        versionCount: 1,
      }),
    );
    const textareas = quoteCard(w)
      .findAll('.extra textarea')
      .map((t) => (t.element as HTMLTextAreaElement).value);
    expect(textareas).toEqual(['含运费', '']);
    const input = cellInput(w, 'unit_price_incl_tax');
    expect((input.element as HTMLInputElement).value).toBe('1.1300');
    // 不等页面重新渲染就失焦（自动化工具、输入法可能这样）
    (input.element as HTMLInputElement).value = '0.39';
    void input.trigger('input');
    void input.trigger('blur');
    await flushPromises();
    expect((cellInput(w, 'unit_price_incl_tax').element as HTMLInputElement).value).toBe('0.3900');
    expect(quoteCard(w).find('.total').text()).toContain('CNY 1,950.00');
    w.unmount();
  });

  it('R09-7 截止后只读显示最后一次提交的版本，历史版本按时间线列出', async () => {
    mocks.versions.mockResolvedValue([
      version(2, '1.0000', '5000.00'),
      version(1, '1.1300', '5650.00'),
    ] as QuoteVersionSummaryDto[]);
    const w = await mountPage(
      detail({
        status: 'SUBMITTED',
        round: { ...detail().round, status: 'QUOTES_CLOSED' },
        currentVersion: version(2, '1.0000', '5000.00'),
        versionCount: 2,
      }),
    );
    const card = quoteCard(w);
    expect(card.text()).toContain('报价已截止，下面是贵司最后一次提交的报价');
    expect(card.findAll('input')).toHaveLength(0);
    expect(card.find('.ppl-line-table').text()).toContain('5,000.00');
    expect(card.find('.total').text()).toContain('CNY 5,000.00');
    expect(w.find('.banner').text()).toContain('已过截止时间');
    const timeline = w.find('.el-timeline').text();
    expect(timeline).toContain('第 2 版');
    expect(timeline).toContain('当前版本');
    expect(timeline).toContain('含税合计 CNY 5,000.00');
    expect(timeline).toContain('变更说明：降价');
    w.unmount();
  });
});
