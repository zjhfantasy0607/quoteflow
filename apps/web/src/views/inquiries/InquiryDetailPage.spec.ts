import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryDetailDto, MeDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
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
    open: vi.fn(),
    responses: vi.fn(async () => ({ sealed: false, items: [] })),
    rounds: vi.fn(async () => [] as unknown[]),
    roundDiff: vi.fn(),
    createChangeRound: vi.fn(),
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
    open: mocks.open,
    responses: mocks.responses,
    rounds: mocks.rounds,
    roundDiff: mocks.roundDiff,
    createChangeRound: mocks.createChangeRound,
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

let router: Router;

async function mountPage(detail: InquiryDetailDto): Promise<VueWrapper> {
  mocks.get.mockResolvedValue(detail);
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me();
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/inquiries/:id', name: 'inquiry-detail', component: InquiryDetailPage },
      { path: '/inquiries/:id/edit', name: 'inquiry-edit', component: { template: '<div />' } },
      { path: '/inquiries', name: 'inquiries', component: { template: '<div />' } },
      { path: '/inquiries/approvals', name: 'inquiry-approvals', component: { template: '<div />' } },
      {
        path: '/inquiries/:id/rounds/:roundNo/change',
        name: 'inquiry-change',
        component: { template: '<div />' },
      },
      { path: '/contracts/:id', name: 'contract-detail', component: { template: '<div />' } },
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

  it('R12-4 评标完成：顶部横幅显示中标供应商、定标人与时间、定标说明和合同草稿号，只读', async () => {
    const evaluatedRound = {
      id: 'r1',
      roundNo: 1,
      status: 'EVALUATED',
      deadline: '2026-11-05T02:00:00.000Z',
      publishedAt: '2026-11-02T01:00:00.000Z',
      quotesClosedAt: '2026-11-05T02:00:00.000Z',
      closedEarly: false,
      openedAt: '2026-11-05T03:00:00.000Z',
      evaluatedAt: '2026-11-06T02:00:00.000Z',
      lineCount: 1,
      shortlistCount: 0,
    };
    const w = await mountPage(
      mocks.detail({
        docStatus: 'APPROVED',
        displayStatus: 'EVALUATED',
        formalNo: 'RFQ-202611-0001',
        currentRoundStatus: 'EVALUATED',
        currentDeadline: evaluatedRound.deadline,
        completedAt: evaluatedRound.evaluatedAt,
        currentRound: evaluatedRound,
        award: {
          roundNo: 1,
          quoteId: 'quote-a',
          supplier: { id: 's1', code: 'SUP10004', nameZh: '浙江精工制造有限公司', nameEn: null },
          awardedAt: evaluatedRound.evaluatedAt,
          awardedBy: { id: 'u1', name: '张伟' },
          comment: '议价后综合价格最低',
          contract: { id: 'ct1', contractNo: 'CT-202611-0001' },
        },
        allowedActions: [],
      }) as unknown as InquiryDetailDto,
    );
    const banner = w.find('.completed-banner');
    expect(banner.text()).toContain('评标已完成，中标供应商：SUP10004 浙江精工制造有限公司');
    expect(banner.text()).toContain('张伟 于 2026-11-06 10:00 北京时间 定标');
    expect(banner.text()).toContain('定标说明：议价后综合价格最低');
    expect(banner.text()).toContain('已自动生成合同草稿 CT-202611-0001');
    expect(banner.find('.contract-link').exists()).toBe(false);
    // M14：有 contract:view 时合同号后面是"查看合同"链接
    useAuthStore().me!.permissions.push('contract:view');
    await flushPromises();
    const link = w.find('.completed-banner .contract-link');
    expect(link.text()).toBe('查看合同');
    expect(link.attributes('href')).toBe('/contracts/ct1');
    expect(w.find('.round-progress').text()).toContain('2026-11-06 10:00');
    expect(buttonTexts(w)).toEqual(['返回']);
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

  it('R10-2 R10-3 提前截止后显示进度条和"开标"按钮，确认后开标并切到供应商响应', async () => {
    const closedRound = {
      id: 'r1',
      roundNo: 1,
      status: 'QUOTES_CLOSED',
      deadline: '2026-11-05T02:00:00.000Z',
      publishedAt: '2026-11-02T01:00:00.000Z',
      quotesClosedAt: '2026-11-05T02:00:00.000Z',
      closedEarly: true,
      openedAt: null,
      evaluatedAt: null,
      lineCount: 1,
    };
    const closed = mocks.detail({
      docStatus: 'APPROVED',
      displayStatus: 'QUOTES_CLOSED',
      formalNo: 'RFQ-202611-0001',
      currentRoundStatus: 'QUOTES_CLOSED',
      currentDeadline: closedRound.deadline,
      currentRound: closedRound,
      allowedActions: ['open'],
    });
    mocks.open.mockResolvedValue({
      ...closed,
      displayStatus: 'OPENED',
      currentRoundStatus: 'OPENED',
      currentRound: { ...closedRound, status: 'OPENED', openedAt: '2026-11-05T03:00:00.000Z' },
      allowedActions: [],
    });
    const w = await mountPage(closed as unknown as InquiryDetailDto);
    expect(w.find('.round-progress').text()).toContain('报价完成');
    // 提前截止后截止时间还没到，不再显示剩余时间
    expect(w.text()).toContain('2026-11-05 10:00 北京时间（已提前截止）');
    expect(w.text()).not.toContain('剩余');
    expect(buttonTexts(w)).toContain('开标');
    await w
      .findAll('.page-header button')
      .find((b) => b.text() === '开标')!
      .trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledWith('q1', 1);
    expect(buttonTexts(w)).not.toContain('开标');
    expect(mocks.responses).toHaveBeenCalledWith('q1', 1);
    expect(w.find('.round-progress').text()).toContain('2026-11-05 11:00 北京时间');
    w.unmount();
  });

  describe('M13 规格变更', () => {
    const brief = (roundNo: number, status: string, extra: Record<string, unknown> = {}) => ({
      id: `r${roundNo}`,
      roundNo,
      status,
      deadline: null,
      publishedAt: status === 'DRAFT' ? null : '2026-11-02T01:00:00.000Z',
      openedAt: null,
      evaluatedAt: null,
      changeReason: roundNo > 1 ? '显色指数 Ra80 → Ra90' : null,
      changeSummary: roundNo > 1 ? '两款都改为 Ra90' : null,
      lineCount: 1,
      quoteCount: 2,
      shortlistCount: 0,
      createdAt: '2026-11-02T01:00:00.000Z',
      ...extra,
    });
    const waiting = () =>
      mocks.detail({
        docStatus: 'APPROVED',
        displayStatus: 'WAITING_QUOTES',
        formalNo: 'RFQ-202611-0001',
        currentRoundNo: 2,
        currentRoundStatus: 'WAITING_QUOTES',
        currentRound: {
          id: 'r2',
          roundNo: 2,
          status: 'WAITING_QUOTES',
          deadline: '2026-11-09T10:00:00.000Z',
          publishedAt: '2026-11-04T01:00:00.000Z',
          quotesClosedAt: null,
          closedEarly: false,
          openedAt: null,
          evaluatedAt: null,
          lineCount: 1,
          shortlistCount: 0,
        },
        draftRoundNo: 3,
      }) as unknown as InquiryDetailDto;

    it('R13-8 轮次页签条：切到作废的第 1 轮只读查看，变更草稿进入编辑页；有变更草稿时顶部提示', async () => {
      mocks.rounds.mockResolvedValue([brief(1, 'SUPERSEDED'), brief(2, 'WAITING_QUOTES'), brief(3, 'DRAFT')]);
      // 按轮次号返回（mock 的签名是无参的，这里断言成 never）
      mocks.round.mockImplementation((async (_id: string, no: number) => ({
        ...brief(no, no === 1 ? 'SUPERSEDED' : 'WAITING_QUOTES'),
        pplTemplateVersion: 1,
        pplVariantCode: 'PPL-LED',
        lines: [],
        files: [],
        allowedActions: [],
      })) as never);
      mocks.roundDiff.mockResolvedValue({
        roundNo: 2,
        previousRoundNo: 1,
        changeReason: '显色指数 Ra80 → Ra90',
        changeSummary: '两款都改为 Ra90',
        lines: [],
        files: { added: [], removed: [] },
        summary: { ADDED: 0, REMOVED: 0, MODIFIED: 1, UNCHANGED: 0 },
      });
      const w = await mountPage(waiting());
      expect(w.find('.draft-banner').text()).toContain('有未发布的规格变更（第 3 轮）');
      const labels = () =>
        w.findAll('.round-strip .el-radio-button').map((b) => b.text().replace(/\s+/g, ''));
      expect(labels()).toEqual(['第1轮（已作废）只读', '第2轮（等待报价）', '第3轮（变更草稿）']);
      // 当前第 2 轮：变更说明与规格对比
      expect(w.text()).toContain('第 2 轮变更说明');
      expect(w.text()).toContain('两款都改为 Ra90');
      expect(mocks.roundDiff).toHaveBeenCalledWith('q1', 2);

      await w.findAll('.round-strip input')[0].setValue(true);
      await flushPromises();
      expect(mocks.round).toHaveBeenLastCalledWith('q1', 1);
      expect(w.text()).toContain('第 1 轮已作废，只能查看（询价已进入第 2 轮）');
      expect(w.text()).not.toContain('第 2 轮变更说明');

      await w.findAll('.round-strip input')[2].setValue(true);
      await flushPromises();
      expect(router.currentRoute.value).toMatchObject({
        name: 'inquiry-change',
        params: { id: 'q1', roundNo: '3' },
      });
      w.unmount();
    });

    it('R13-1 "发起规格变更"：确认后建第 N 轮变更草稿并进入编辑页', async () => {
      mocks.rounds.mockResolvedValue([brief(1, 'WAITING_QUOTES')]);
      mocks.createChangeRound.mockResolvedValue({ roundNo: 2 });
      const w = await mountPage(
        mocks.detail({
          docStatus: 'APPROVED',
          displayStatus: 'WAITING_QUOTES',
          currentRoundStatus: 'WAITING_QUOTES',
          allowedActions: ['createChangeRound'],
        }) as unknown as InquiryDetailDto,
      );
      expect(w.find('.round-strip').exists()).toBe(false);
      expect(buttonTexts(w)).toContain('发起规格变更');
      await w
        .findAll('.page-header button')
        .find((b) => b.text() === '发起规格变更')!
        .trigger('click');
      await flushPromises();
      expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('生成第 2 轮变更草稿'), {
        type: 'info',
      });
      expect(mocks.createChangeRound).toHaveBeenCalledWith('q1', {});
      expect(router.currentRoute.value).toMatchObject({ name: 'inquiry-change', params: { roundNo: '2' } });
      w.unmount();
    });
  });
});
