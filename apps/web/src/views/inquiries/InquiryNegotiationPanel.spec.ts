import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { NegotiationMessageDto, NegotiationThreadDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import InquiryNegotiationPanel from './InquiryNegotiationPanel.vue';

const mocks = vi.hoisted(() => ({
  negotiation: vi.fn(),
  offer: vi.fn(),
  acceptCounter: vi.fn(),
  closeNegotiation: vi.fn(),
  confirm: vi.fn(async () => true),
  prompt: vi.fn(async () => '谈不拢'),
}));

vi.mock('@/api/inquiries', () => ({
  inquiriesApi: {
    negotiation: mocks.negotiation,
    offer: mocks.offer,
    acceptCounter: mocks.acceptCounter,
    closeNegotiation: mocks.closeNegotiation,
  },
}));
vi.mock('@/api/system', () => ({ paramsApi: { appConfig: async () => ({ uploadLimits: null }) } }));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm, promptText: mocks.prompt }));

function message(
  seq: number,
  type: NegotiationMessageDto['type'],
  extra: Partial<NegotiationMessageDto> = {},
) {
  return {
    id: `m${seq}`,
    seq,
    negotiationRound: 1,
    party: type === 'OFFER' ? 'BUYER' : 'SUPPLIER',
    type,
    lines: [
      {
        lineId: 'l1',
        lineNo: 1,
        unitPriceInclTax: seq === 1 ? '1.05' : '1.10',
        quantity: null,
        specNote: null,
      },
    ],
    content: type === 'COUNTER' ? '原材料涨价' : '目标价',
    replyToId: seq === 1 ? null : `m${seq - 1}`,
    author: { name: seq === 1 ? 'buyer' : 'supplier' },
    createdAt: '2026-11-30T01:00:00.000Z',
    attachments: [],
    resultVersionNo: null,
    ...extra,
  } satisfies NegotiationMessageDto;
}

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
    messages: [message(1, 'OFFER')],
    allowedActions: [],
    ...extra,
  };
}

async function mountPanel(data: NegotiationThreadDto): Promise<VueWrapper> {
  mocks.negotiation.mockResolvedValue(data);
  setActivePinia(createPinia());
  const w = mount(InquiryNegotiationPanel, {
    props: { quoteId: 'q1' },
    global: { plugins: [i18n, ElementPlus], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const button = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().startsWith(text));

describe('InquiryNegotiationPanel', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('R11-7 轮到供应商时表单禁用并提示等待回复，没有接受、结束按钮', async () => {
    const w = await mountPanel(thread());
    expect(w.text()).toContain('已发出目标价，等待供应商回复');
    expect(w.text()).toContain('议价第 1 轮');
    expect(w.text()).toContain('CNY 1.0500');
    expect(w.find('.price-input input').attributes('disabled')).toBeDefined();
    expect(button(w, '发送')!.attributes('disabled')).toBeDefined();
    expect(button(w, '接受反提案')).toBeUndefined();
    expect(button(w, '结束议价')).toBeUndefined();
    w.unmount();
  });

  it('R11-7 收到反提案：可以接受（按最近一条反提案）或结束议价', async () => {
    const countered = thread({
      awaiting: 'BUYER',
      messages: [message(1, 'OFFER'), message(2, 'COUNTER')],
      allowedActions: ['accept', 'offer', 'close'],
    });
    mocks.acceptCounter.mockResolvedValue(
      thread({ status: 'AGREED', awaiting: 'BUYER', currentVersionNo: 2 }),
    );
    const w = await mountPanel(countered);
    expect(w.text()).toContain('供应商提出了反提案');
    expect(w.text()).toContain('原因：原材料涨价');
    await button(w, '接受反提案')!.trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.acceptCounter).toHaveBeenCalledWith('q1', 'm2');
    expect(w.emitted('changed')).toHaveLength(1);
    w.unmount();

    mocks.closeNegotiation.mockResolvedValue(thread({ status: 'CLOSED', awaiting: null }));
    const w2 = await mountPanel(countered);
    await button(w2, '结束议价')!.trigger('click');
    await flushPromises();
    expect(mocks.closeNegotiation).toHaveBeenCalledWith('q1', '谈不拢');
    w2.unmount();
  });

  it('R11-8 发目标价：至少填一行；按行提交价格', async () => {
    const empty = thread({ status: null, awaiting: 'BUYER', messages: [], allowedActions: ['offer'] });
    mocks.offer.mockResolvedValue(thread());
    const w = await mountPanel(empty);
    expect(w.text()).toContain('还没有议价记录');
    await button(w, '发送')!.trigger('click');
    expect(mocks.offer).not.toHaveBeenCalled();

    await w.find('.price-input input').setValue('1.12345');
    await button(w, '发送')!.trigger('click');
    expect(mocks.offer).not.toHaveBeenCalled();

    await w.find('.price-input input').setValue('1.05');
    await w.find('.content-input textarea').setValue('批量 1200');
    await button(w, '发送')!.trigger('click');
    await flushPromises();
    expect(mocks.offer).toHaveBeenCalledWith('q1', {
      lines: [{ lineId: 'l1', unitPriceInclTax: '1.05' }],
      content: '批量 1200',
      attachmentFileIds: [],
    });
    expect(w.emitted('changed')).toHaveLength(1);
    w.unmount();
  });

  it('R11-10 没有 negotiation.amount 时时间线里的价格显示锁', async () => {
    const masked = thread();
    masked.messages[0].lines[0].unitPriceInclTax = null;
    masked.messages[0].maskedFields = ['unitPriceInclTax'];
    const w = await mountPanel(masked);
    expect(w.find('.negotiation-timeline .masked-value').exists()).toBe(true);
    expect(w.text()).not.toContain('1.05');
    w.unmount();
  });
});
