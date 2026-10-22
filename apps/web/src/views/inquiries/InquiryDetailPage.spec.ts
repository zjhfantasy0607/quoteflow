import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryDetailDto, MeDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import InquiryDetailPage from './InquiryDetailPage.vue';

const mocks = vi.hoisted(() => {
  const detail = (extra: Record<string, unknown> = {}) => ({
    id: 'q1',
    draftNo: 'DR-20261102-0001',
    formalNo: null,
    projectNo: 'PJ-2026-001',
    title: '2835 灯珠年度询价',
    materialCategory: {
      id: 'c1',
      code: 'LED-2835',
      nameZh: '2835 灯珠',
      nameEn: '2835 SMD LED',
      effectiveEnabled: true,
    },
    currency: 'CNY',
    docStatus: 'DRAFT',
    displayStatus: 'DRAFT',
    currentRoundNo: 1,
    currentRoundStatus: 'DRAFT',
    currentDeadline: null,
    owner: { id: 'u2', name: '张三' },
    pdUser: { id: 'u3', name: '王工' },
    submittedAt: null,
    createdAt: '2026-11-02T01:00:00.000Z',
    description: null,
    createdBy: { id: 'u3', name: '王工' },
    departmentCode: 'PRODUCT',
    lastRejectComment: null,
    approvedAt: null,
    approvedBy: null,
    cancelledAt: null,
    cancelReason: null,
    completedAt: null,
    updatedAt: '2026-11-02T01:00:00.000Z',
    currentRound: { id: 'r1', roundNo: 1, status: 'DRAFT', deadline: null, publishedAt: null, lineCount: 0 },
    allowedActions: [],
    ...extra,
  });
  const round = {
    id: 'r1',
    roundNo: 1,
    status: 'DRAFT',
    deadline: null,
    changeReason: null,
    changeSummary: null,
    pplTemplateVersion: null,
    pplVariantCode: null,
    publishedAt: null,
    lines: [],
    files: [],
    allowedActions: [],
  };
  return {
    detail,
    get: vi.fn(),
    round: vi.fn(async () => round),
    approvals: vi.fn(async () => []),
    timeline: vi.fn(async () => []),
    reject: vi.fn(),
    approve: vi.fn(),
    confirm: vi.fn(async () => true),
  };
});

vi.mock('@/api/inquiries', () => ({
  inquiriesApi: {
    get: mocks.get,
    round: mocks.round,
    approvals: mocks.approvals,
    timeline: mocks.timeline,
    reject: mocks.reject,
    approve: mocks.approve,
  },
}));
vi.mock('@/api/system', () => ({
  paramsApi: { appConfig: async () => null },
  dictsApi: { load: async () => ({ currency: [], unit: [] }) },
}));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm, promptText: vi.fn() }));

function me(): MeDto {
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
    permissions: ['inquiry:view'],
    fieldPermissions: [],
    dataScope: 'ALL',
  };
}

async function mountPage(detail: InquiryDetailDto): Promise<VueWrapper> {
  mocks.get.mockResolvedValue(detail);
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/inquiries/:id', name: 'inquiry-detail', component: InquiryDetailPage },
      { path: '/inquiries/:id/edit', name: 'inquiry-edit', component: { template: '<div />' } },
      { path: '/inquiries', name: 'inquiries', component: { template: '<div />' } },
      { path: '/inquiries/approvals', name: 'inquiry-approvals', component: { template: '<div />' } },
    ],
  });
  await router.push('/inquiries/q1');
  const w = mount(InquiryDetailPage, {
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const buttonTexts = (w: VueWrapper) => w.findAll('.page-header button').map((b) => b.text());

describe('InquiryDetailPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('按 allowedActions 显示操作按钮（03 §6）；没有审批动作时没有审批操作区', async () => {
    const w = await mountPage(
      mocks.detail({ allowedActions: ['edit', 'submit'] }) as unknown as InquiryDetailDto,
    );
    expect(w.find('.page-header').text()).toContain('DR-20261102-0001 · 2835 灯珠年度询价');
    expect(buttonTexts(w)).toEqual(['返回', '编辑', '提交审批']);
    expect(w.find('.approval-panel').exists()).toBe(false);
    w.unmount();

    const none = await mountPage(mocks.detail() as unknown as InquiryDetailDto);
    expect(buttonTexts(none)).toEqual(['返回']);
    none.unmount();
  });

  it('R06-7 待审批：底部审批操作区，驳回必须先填意见', async () => {
    const pending = mocks.detail({
      docStatus: 'PENDING_APPROVAL',
      displayStatus: 'PENDING_APPROVAL',
      allowedActions: ['approve', 'reject', 'cancel'],
    }) as unknown as InquiryDetailDto;
    const w = await mountPage(pending);
    expect(buttonTexts(w)).toEqual(['返回', '取消询价单']);
    const panel = w.find('.approval-panel');
    expect(panel.exists()).toBe(true);
    const reject = panel.findAll('button').find((b) => b.text() === '驳回回草稿')!;
    await reject.trigger('click');
    expect(mocks.reject).not.toHaveBeenCalled();

    mocks.reject.mockResolvedValue(
      mocks.detail({ lastRejectComment: '数量不对', allowedActions: ['edit', 'submit'] }),
    );
    await panel.find('textarea').setValue('  数量不对 ');
    await reject.trigger('click');
    await flushPromises();
    expect(mocks.reject).toHaveBeenCalledWith('q1', '数量不对');
    // 驳回后回到草稿：审批区消失，顶部提示驳回意见
    expect(w.find('.approval-panel').exists()).toBe(false);
    expect(w.text()).toContain('上次审批被驳回，意见：数量不对');
    w.unmount();
  });

  it('通过时意见可以不填', async () => {
    const pending = mocks.detail({
      docStatus: 'PENDING_APPROVAL',
      allowedActions: ['approve', 'reject'],
    }) as unknown as InquiryDetailDto;
    mocks.approve.mockResolvedValue(
      mocks.detail({ docStatus: 'APPROVED', displayStatus: 'READY', formalNo: 'RFQ-202611-0001' }),
    );
    const w = await mountPage(pending);
    await w
      .find('.approval-panel')
      .findAll('button')
      .find((b) => b.text() === '通过')!
      .trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.approve).toHaveBeenCalledWith('q1', undefined);
    expect(w.find('.page-header').text()).toContain('RFQ-202611-0001');
    w.unmount();
  });

  it('已取消显示取消时间和原因', async () => {
    const w = await mountPage(
      mocks.detail({
        docStatus: 'CANCELLED',
        displayStatus: 'CANCELLED',
        currentRoundStatus: 'CANCELLED',
        cancelledAt: '2026-11-02T02:00:00.000Z',
        cancelReason: '项目取消',
      }) as unknown as InquiryDetailDto,
    );
    expect(w.text()).toContain('已于 2026-11-02 10:00 北京时间 取消，原因：项目取消');
    w.unmount();
  });
});
