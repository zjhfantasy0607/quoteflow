import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { MeDto, WorkbenchDto, WorkbenchInquiryItemDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import WorkbenchPage from './WorkbenchPage.vue';

const mocks = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock('@/api/workbench', () => ({ workbenchApi: { overview: mocks.overview } }));

const Dummy = { template: '<div />' };

function me(permissions: string[]): MeDto {
  return {
    user: {
      id: 'u1',
      username: 'buyer.zhang',
      name: '张采购',
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

function inquiry(extra: Partial<WorkbenchInquiryItemDto> = {}): WorkbenchInquiryItemDto {
  return {
    id: 'i1',
    draftNo: 'DR-20261101-0001',
    formalNo: 'RFQ-202611-0001',
    projectNo: 'PJ-2026-001',
    title: '透镜与反光杯询价',
    owner: { id: 'u1', name: '张采购' },
    currentRoundNo: 1,
    currentDeadline: '2026-11-20T10:00:00.000Z',
    submittedAt: '2026-11-01T02:00:00.000Z',
    approvedAt: '2026-11-02T02:00:00.000Z',
    updatedAt: '2026-11-03T02:00:00.000Z',
    rejected: false,
    progress: null,
    ...extra,
  };
}

let router: Router;

async function mountPage(data: WorkbenchDto, permissions: string[]): Promise<VueWrapper> {
  mocks.overview.mockResolvedValue(data);
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me(permissions);
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/workbench', name: 'workbench', component: WorkbenchPage },
      { path: '/inquiries', name: 'inquiries', component: Dummy, meta: { perm: 'inquiry:view' } },
      {
        path: '/inquiries/approvals',
        name: 'inquiry-approvals',
        component: Dummy,
        meta: { perm: 'inquiry:approve' },
      },
      { path: '/inquiries/:id', name: 'inquiry-detail', component: Dummy, meta: { perm: 'inquiry:view' } },
      { path: '/contracts', name: 'contracts', component: Dummy, meta: { perm: 'contract:view' } },
      { path: '/contracts/:id', name: 'contract-detail', component: Dummy, meta: { perm: 'contract:view' } },
    ],
  });
  await router.push('/workbench');
  const w = mount(WorkbenchPage, {
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
  });
  await flushPromises();
  return w;
}

const card = (w: VueWrapper, key: string) => w.find(`[data-card="${key}"]`);
const links = (w: VueWrapper, key: string) =>
  card(w, key)
    .findAll('a')
    .map((a) => a.attributes('href'));

describe('WorkbenchPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('R16-2 按接口返回的卡片逐张显示：数量、前几条、被驳回标识、响应进度；空卡片显示"暂无待办"', async () => {
    const w = await mountPage(
      {
        myDrafts: {
          total: 2,
          items: [
            inquiry({
              id: 'd2',
              formalNo: null,
              draftNo: 'DR-20261031-0001',
              title: '硅胶线询价',
              rejected: true,
            }),
            inquiry({ id: 'd1', formalNo: null, title: '2835 灯珠年度询价' }),
          ],
        },
        waitingQuotes: {
          total: 7,
          items: [inquiry({ id: 'w1', currentRoundNo: 2, progress: { responded: 2, invited: 3 } })],
        },
        readyToPublish: { total: 0, items: [] },
      },
      ['inquiry:view', 'inquiry:create', 'inquiry:publish'],
    );
    expect(w.findAll('[data-card]').map((c) => c.attributes('data-card'))).toEqual([
      'myDrafts',
      'readyToPublish',
      'waitingQuotes',
    ]);
    const drafts = card(w, 'myDrafts');
    expect(drafts.find('.count').text()).toBe('2');
    expect(drafts.text()).toContain('我的草稿 / 被驳回');
    expect(drafts.findAll('.wb-item')[0].text()).toContain('DR-20261031-0001');
    expect(drafts.findAll('.wb-item')[0].text()).toContain('被驳回');
    expect(drafts.findAll('.wb-item')[1].text()).not.toContain('被驳回');
    expect(drafts.text()).toContain('负责人 张采购');
    expect(drafts.text()).toContain('更新于 2026-11-03 10:00');

    const waiting = card(w, 'waitingQuotes');
    expect(waiting.find('.count').text()).toBe('7');
    expect(waiting.text()).toContain('已响应 2/3');
    expect(waiting.text()).toContain('第 2 轮');
    expect(waiting.text()).toContain('截止 2026-11-20 18:00');
    expect(card(w, 'readyToPublish').text()).toContain('暂无待办');
  });

  it('R16-1 条目链接到详情（等待报价进"供应商响应"、议价进"议价"页签）；"查看全部"进对应列表页签', async () => {
    const w = await mountPage(
      {
        myDrafts: { total: 1, items: [inquiry({ id: 'd1' })] },
        waitingQuotes: { total: 1, items: [inquiry({ id: 'w1' })] },
        negotiations: {
          total: 1,
          items: [
            {
              quoteId: 'q1',
              inquiry: { id: 'o1', formalNo: 'RFQ-202610-0002', title: '散热器询价' },
              roundNo: 1,
              supplier: { id: 's1', code: 'SUP10003', nameZh: '江苏新能', nameEn: 'Jiangsu Xinneng' },
              lastMessage: { type: 'COUNTER', createdAt: '2026-11-01T02:00:00.000Z' },
            },
          ],
        },
        contractsToReview: {
          total: 1,
          items: [
            {
              id: 'c1',
              contractNo: 'CT-202611-0001',
              status: 'PENDING_REVIEW',
              inquiry: { id: 'e1', formalNo: 'RFQ-202610-0003', title: '防水连接器询价' },
              supplier: { id: 's2', code: 'SUP10004', nameZh: '浙江精工', nameEn: null },
              submittedAt: '2026-11-01T03:00:00.000Z',
            },
          ],
        },
      },
      ['inquiry:view', 'inquiry:create', 'inquiry:evaluate', 'contract:view', 'contract:review'],
    );
    expect(links(w, 'myDrafts')).toEqual(['/inquiries/d1', '/inquiries?tab=draft&mine=true']);
    expect(links(w, 'waitingQuotes')).toEqual(['/inquiries/w1?tab=responses', '/inquiries?tab=quoting']);
    expect(links(w, 'negotiations')).toEqual(['/inquiries/o1?tab=negotiation', '/inquiries?tab=evaluating']);
    expect(card(w, 'negotiations').text()).toContain('江苏新能');
    expect(card(w, 'negotiations').text()).toContain('反提案');
    expect(links(w, 'contractsToReview')).toEqual(['/contracts/c1', '/contracts?tab=PENDING_REVIEW']);
    expect(card(w, 'contractsToReview').text()).toContain('RFQ-202610-0003 防水连接器询价');
    expect(card(w, 'contractsToReview').text()).toContain('送审于 2026-11-01 11:00');
  });

  it('进不去的列表不显示"查看全部"；没有任何卡片时显示提示；英文界面', async () => {
    // 有 contract:review 但没有 contract:view：合同列表进不去
    const w = await mountPage(
      { contractsToReview: { total: 1, items: [] }, waitingQuotes: { total: 0, items: [] } },
      ['inquiry:view', 'contract:review'],
    );
    expect(card(w, 'contractsToReview').find('.view-all').exists()).toBe(false);
    // 数量为 0 时也不显示
    expect(card(w, 'waitingQuotes').find('.view-all').exists()).toBe(false);

    const none = await mountPage({}, []);
    expect(none.text()).toContain('您的账号没有可显示的待办事项。');

    applyLocale('en-US');
    const en = await mountPage(
      { waitingQuotes: { total: 1, items: [inquiry({ progress: { responded: 1, invited: 2 } })] } },
      ['inquiry:view'],
    );
    expect(en.text()).toContain('Awaiting Quotes');
    expect(en.text()).toContain('1/2 responded');
    expect(en.text()).toContain('View all');
  });
});
