import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryDetailDto, MeDto, QuoteResponseDto, RoundStatus } from '@quoteflow/shared';
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import InquiryResponsesTab from './InquiryResponsesTab.vue';

const mocks = vi.hoisted(() => ({
  responses: vi.fn(),
  remind: vi.fn(),
  closeEarly: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@/api/inquiries', () => ({
  inquiriesApi: { responses: mocks.responses, remind: mocks.remind, closeEarly: mocks.closeEarly },
}));
vi.mock('@/api/system', () => ({ dictsApi: { load: async () => ({ decline_reason: [] }) } }));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm }));

const detail = (allowedActions: string[], currentRoundStatus: RoundStatus = 'WAITING_QUOTES') =>
  ({
    id: 'q1',
    currentRoundNo: 1,
    currentRoundStatus,
    currentDeadline: '2026-11-05T01:00:00.000Z',
    allowedActions,
  }) as unknown as InquiryDetailDto;

function me(permissions: string[]): MeDto {
  return {
    user: {
      id: 'u1',
      username: 'u1',
      name: 'U1',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions,
    fieldPermissions: [],
    dataScope: 'SELF',
  };
}

function response(
  id: string,
  code: string,
  status: QuoteResponseDto['status'],
  extra: Partial<QuoteResponseDto> = {},
) {
  return {
    id,
    supplier: { id: `s-${code}`, code, nameZh: `供应商 ${code}`, nameEn: null, portalAccount: 'ACTIVE' },
    status,
    invitedAt: '2026-11-02T01:00:00.000Z',
    firstViewedAt: null,
    respondedAt: status === 'INVITED' ? null : '2026-11-02T03:00:00.000Z',
    lastSubmittedAt: null,
    declinedAt: null,
    declineReasonCode: null,
    declineReason: null,
    versionCount: status === 'SUBMITTED' || status === 'EVALUATING' ? 1 : 0,
    ...extra,
  } satisfies QuoteResponseDto;
}

const rows = [
  response('q-a', 'TS-A', 'SUBMITTED'),
  response('q-b', 'TS-B', 'DECLINED', { declineReason: '交期太紧' }),
  response('q-c', 'TS-C', 'INVITED', { firstViewedAt: '2026-11-02T02:00:00.000Z' }),
  response('q-d', 'TS-D', 'INVITED', {
    supplier: { id: 's-d', code: 'TS-D', nameZh: '供应商 TS-D', nameEn: null, portalAccount: 'NONE' },
  }),
];

async function mountTab(
  inquiry: InquiryDetailDto,
  data: { sealed: boolean; items: QuoteResponseDto[] } = { sealed: true, items: rows },
  permissions: string[] = ['inquiry:view'],
): Promise<VueWrapper> {
  mocks.responses.mockResolvedValue(data);
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me(permissions);
  const w = mount(InquiryResponsesTab, {
    props: { inquiry },
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

const button = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().startsWith(text));

describe('InquiryResponsesTab', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('S-1 密封时只显示响应状态，报价合计一律显示锁；汇总已提交、已拒绝、未响应', async () => {
    const w = await mountTab(detail([]));
    expect(w.text()).toContain('开标前只能看到各家的响应状态和时间');
    expect(w.text()).toContain('共邀请 4 家：已提交 1 家，已拒绝 1 家，未响应 2 家');
    expect(w.text()).toContain('已查看');
    expect(w.text()).toContain('交期太紧');
    expect(w.findAll('.el-table__body .masked-value')).toHaveLength(4);
    // 没有催报、提前截止权限（或状态不对）时没有勾选列和按钮；密封时没有"查看报价"
    expect(button(w, '催报')).toBeUndefined();
    expect(button(w, '提前截止')).toBeUndefined();
    expect(w.findAll('.el-table__body .el-checkbox')).toHaveLength(0);
    expect(w.text()).not.toContain('查看报价');
    w.unmount();
  });

  it('R07-8 只能勾选未响应的供应商，确认后按报价单催报', async () => {
    mocks.remind.mockResolvedValue(detail(['remind']));
    const w = await mountTab(detail(['remind', 'extendDeadline']));
    const boxes = w.findAll('.el-table__body .el-checkbox');
    expect(boxes.map((b) => b.classes().includes('is-disabled'))).toEqual([true, true, false, false]);
    expect(button(w, '催报')!.attributes('disabled')).toBeDefined();

    await boxes[2].find('input').setValue(true);
    await boxes[3].find('input').setValue(true);
    expect(button(w, '催报')!.text()).toBe('催报（2）');
    await button(w, '催报')!.trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.remind).toHaveBeenCalledWith('q1', 1, ['q-c', 'q-d']);
    expect(w.emitted('changed')).toHaveLength(1);
    w.unmount();
  });

  it('R10-2 提前截止：有未响应的供应商时按钮不可点；全部响应后确认即提前截止', async () => {
    let w = await mountTab(detail(['closeEarly']));
    expect(button(w, '提前截止')!.attributes('disabled')).toBeDefined();
    w.unmount();

    const responded = [rows[0], rows[1]];
    mocks.closeEarly.mockResolvedValue(detail([], 'QUOTES_CLOSED'));
    w = await mountTab(detail(['closeEarly']), { sealed: true, items: responded });
    expect(button(w, '提前截止')!.attributes('disabled')).toBeUndefined();
    await button(w, '提前截止')!.trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.closeEarly).toHaveBeenCalledWith('q1', 1);
    expect(w.emitted('changed')).toHaveLength(1);
    w.unmount();
  });

  it('M10 §5 开标后显示合计（被脱敏的显示锁），有 inquiry:evaluate 的可以点进报价详情；截止后的已邀请显示"未响应"', async () => {
    const opened = [
      response('q-a', 'TS-A', 'EVALUATING', { totalAmount: '2260.00', currency: 'CNY' }),
      response('q-b', 'TS-B', 'EVALUATING', {
        totalAmount: null,
        currency: 'CNY',
        maskedFields: ['totalAmount'],
      }),
      response('q-c', 'TS-C', 'INVITED', { totalAmount: null, currency: null }),
    ];
    let w = await mountTab(detail([], 'OPENED'), { sealed: false, items: opened }, [
      'inquiry:view',
      'inquiry:evaluate',
    ]);
    expect(w.text()).not.toContain('开标前只能看到');
    expect(w.text()).toContain('CNY 2,260.00');
    expect(w.findAll('.el-table__body .masked-value')).toHaveLength(1);
    expect(w.text()).toContain('未响应');
    const links = w.findAllComponents(RouterLinkStub);
    expect(links.map((l) => l.props('to'))).toEqual(
      ['q-a', 'q-b'].map((quoteId) => ({
        name: 'inquiry-quote',
        params: { id: 'q1', roundNo: 1, quoteId },
      })),
    );
    w.unmount();

    // 没有 inquiry:evaluate：能看合计，不能点进报价详情
    w = await mountTab(detail([], 'OPENED'), { sealed: false, items: opened });
    expect(w.text()).toContain('CNY 2,260.00');
    expect(w.findAllComponents(RouterLinkStub)).toHaveLength(0);
    w.unmount();
  });
});
