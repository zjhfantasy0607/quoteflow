import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryDetailDto, QuoteResponseDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import InquiryResponsesTab from './InquiryResponsesTab.vue';

const mocks = vi.hoisted(() => ({
  responses: vi.fn(),
  remind: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@/api/inquiries', () => ({ inquiriesApi: { responses: mocks.responses, remind: mocks.remind } }));
vi.mock('@/api/system', () => ({ dictsApi: { load: async () => ({ decline_reason: [] }) } }));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm }));

const detail = (allowedActions: string[]) =>
  ({
    id: 'q1',
    currentRoundNo: 1,
    currentDeadline: '2026-11-05T01:00:00.000Z',
    allowedActions,
  }) as unknown as InquiryDetailDto;

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
    versionCount: status === 'SUBMITTED' ? 1 : 0,
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

async function mountTab(allowedActions: string[]): Promise<VueWrapper> {
  mocks.responses.mockResolvedValue(rows);
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(InquiryResponsesTab, {
    props: { inquiry: detail(allowedActions) },
    global: { plugins: [i18n, ElementPlus, pinia], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const remindButton = (w: VueWrapper) => w.findAll('button').find((b) => b.text().startsWith('催报'));

describe('InquiryResponsesTab', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('S-1 只显示响应状态；汇总已提交、已拒绝、未响应', async () => {
    const w = await mountTab([]);
    expect(w.text()).toContain('共邀请 4 家：已提交 1 家，已拒绝 1 家，未响应 2 家');
    expect(w.text()).toContain('已查看');
    expect(w.text()).toContain('交期太紧');
    // 没有催报权限（或状态不对）时没有勾选列和按钮
    expect(remindButton(w)).toBeUndefined();
    expect(w.findAll('.el-table__body .el-checkbox')).toHaveLength(0);
    w.unmount();
  });

  it('R07-8 只能勾选未响应的供应商，确认后按报价单催报', async () => {
    mocks.remind.mockResolvedValue(detail(['remind']));
    const w = await mountTab(['remind', 'extendDeadline']);
    const boxes = w.findAll('.el-table__body .el-checkbox');
    expect(boxes.map((b) => b.classes().includes('is-disabled'))).toEqual([true, true, false, false]);
    expect(remindButton(w)!.attributes('disabled')).toBeDefined();

    await boxes[2].find('input').setValue(true);
    await boxes[3].find('input').setValue(true);
    expect(remindButton(w)!.text()).toBe('催报（2）');
    await remindButton(w)!.trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.remind).toHaveBeenCalledWith('q1', 1, ['q-c', 'q-d']);
    expect(w.emitted('changed')).toHaveLength(1);
    w.unmount();
  });
});
