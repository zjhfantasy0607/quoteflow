import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { PortalQuoteDetailDto } from '@quoteflow/shared';
import { AxiosError, type AxiosResponse } from 'axios';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import PortalQuoteDetailPage from './PortalQuoteDetailPage.vue';

const mocks = vi.hoisted(() => ({ quote: vi.fn() }));

vi.mock('@/api/portal', () => ({ portalApi: { quote: mocks.quote } }));
vi.mock('@/api/system', () => ({ dictsApi: { load: async () => ({ currency: [], unit: [] }) } }));

const file = (id: string, originalName: string) => ({
  id,
  originalName,
  mimeType: 'application/pdf',
  size: 2048,
  kind: 'SPEC_DOC' as const,
  createdAt: '2026-11-02T01:00:00.000Z',
});

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
    allowedActions: [],
    ...extra,
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

describe('PortalQuoteDetailPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('询价信息、采购联系人、明细；附件按整单 / 行列出，下载走记录日志的内容接口', async () => {
    const w = await mountPage(detail());
    const text = w.text();
    expect(text).toContain('RFQ-202611-0001 · 恒流驱动电源询价');
    expect(text).toContain('张三（buyer.zhang@example.com）');
    expect(text).toContain('待报价');
    expect(text).toContain('询价明细（共 1 行）');
    expect(text).toContain('在线预览和下载都会被记录');
    const rows = w.findAll('.section').at(-1)!.findAll('.el-table__body tr');
    expect(rows.map((r) => r.findAll('td')[0].text())).toEqual(['整单', '第 1 行']);
    const links = w.findAll('a').map((a) => a.attributes('href'));
    expect(links).toContain('/api/files/f1/content?disposition=attachment');
    expect(links).toContain('/api/files/f2/content?disposition=attachment');
    expect(w.find('.el-alert').exists()).toBe(false);
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
});
