import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { NegotiationThreadDto, PortalQuoteDetailDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import PortalNegotiation from './PortalNegotiation.vue';

const mocks = vi.hoisted(() => ({
  negotiation: vi.fn(),
  respond: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@/api/portal', () => ({
  portalApi: { negotiation: mocks.negotiation, respondNegotiation: mocks.respond },
}));
vi.mock('@/api/system', () => ({ paramsApi: { appConfig: async () => ({ uploadLimits: null }) } }));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm }));

const detail = (negotiationStatus: PortalQuoteDetailDto['negotiationStatus']) =>
  ({ id: 'q1', negotiationStatus, currentVersion: { versionNo: 1 } }) as unknown as PortalQuoteDetailDto;

function thread(extra: Partial<NegotiationThreadDto> = {}): NegotiationThreadDto {
  return {
    quoteId: 'q1',
    supplier: { id: 's1', code: 'TS-A', nameZh: '供应商甲', nameEn: null },
    quoteStatus: 'EVALUATING',
    shortlisted: true,
    status: 'OPEN',
    awaiting: 'SUPPLIER',
    currency: 'CNY',
    currentVersionNo: 1,
    lines: [
      {
        lineId: 'l1',
        lineNo: 1,
        materialCode: null,
        nameZh: '灯珠 A',
        nameEn: null,
        spec: '2835',
        unitNameZh: '个',
        unitNameEn: null,
        quantity: '1000',
        currentUnitPrice: '1.2000',
        currentQuantity: '1000',
      },
    ],
    messages: [
      {
        id: 'm1',
        seq: 1,
        negotiationRound: 1,
        party: 'BUYER',
        type: 'OFFER',
        lines: [{ lineId: 'l1', lineNo: 1, unitPriceInclTax: '1.05', quantity: '1200', specNote: '哑光' }],
        content: '批量 1200 的目标价',
        replyToId: null,
        author: { name: 'buyer' },
        createdAt: '2026-11-30T01:00:00.000Z',
        attachments: [],
        resultVersionNo: null,
      },
    ],
    allowedActions: ['accept', 'reject', 'counter'],
    ...extra,
  };
}

async function mountSection(d: PortalQuoteDetailDto, data = thread()): Promise<VueWrapper> {
  mocks.negotiation.mockResolvedValue(data);
  setActivePinia(createPinia());
  const w = mount(PortalNegotiation, {
    props: { detail: d },
    global: { plugins: [i18n, ElementPlus], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const button = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text() === text);

describe('PortalNegotiation', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('采购方没发过议价时不显示', async () => {
    const w = await mountSection(detail(null));
    expect(w.text()).toBe('');
    expect(mocks.negotiation).not.toHaveBeenCalled();
    w.unmount();
  });

  it('R11-10 轮到回复：看到目标价全部内容，接受 / 拒绝 / 反提案；接受后通知刷新', async () => {
    mocks.respond.mockResolvedValue(
      thread({ status: 'AGREED', awaiting: 'BUYER', allowedActions: [], currentVersionNo: 2 }),
    );
    const w = await mountSection(detail('OPEN'));
    expect(w.text()).toContain('采购方发来了新的目标价');
    expect(w.text()).toContain('CNY 1.0500');
    expect(w.text()).toContain('哑光');
    expect(['接受', '拒绝', '反提案'].every((b) => button(w, b))).toBe(true);
    await button(w, '接受')!.trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.respond).toHaveBeenCalledWith('q1', { type: 'ACCEPT', replyToId: 'm1' });
    expect(w.emitted('changed')).toHaveLength(1);
    expect(w.text()).toContain('议价已成交');
    w.unmount();
  });

  it('R11-7 拒绝必须填原因', async () => {
    mocks.respond.mockResolvedValue(thread({ awaiting: 'BUYER', allowedActions: [] }));
    const w = await mountSection(detail('OPEN'));
    await button(w, '拒绝')!.trigger('click');
    await button(w, '拒绝')!.trigger('click');
    expect(mocks.respond).not.toHaveBeenCalled();
    await w.find('.reason-input textarea').setValue('价格太低');
    await button(w, '拒绝')!.trigger('click');
    await flushPromises();
    expect(mocks.respond).toHaveBeenCalledWith('q1', {
      type: 'REJECT',
      content: '价格太低',
      attachmentFileIds: [],
      replyToId: 'm1',
    });
    w.unmount();
  });

  it('R11-7 反提案：至少一行、原因必填', async () => {
    mocks.respond.mockResolvedValue(thread({ awaiting: 'BUYER', allowedActions: [] }));
    const w = await mountSection(detail('OPEN'));
    await button(w, '反提案')!.trigger('click');
    await w.find('.price-input input').setValue('1.10');
    await button(w, '发送')!.trigger('click');
    expect(mocks.respond).not.toHaveBeenCalled();
    await w.find('.content-input textarea').setValue('原材料涨价');
    await button(w, '发送')!.trigger('click');
    await flushPromises();
    expect(mocks.respond).toHaveBeenCalledWith('q1', {
      type: 'COUNTER',
      lines: [{ lineId: 'l1', unitPriceInclTax: '1.10' }],
      content: '原材料涨价',
      attachmentFileIds: [],
      replyToId: 'm1',
    });
    w.unmount();
  });
});
