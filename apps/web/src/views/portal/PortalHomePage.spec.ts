import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { PortalWorkbenchDto, PortalWorkbenchItemDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import PortalHomePage from './PortalHomePage.vue';

const mocks = vi.hoisted(() => ({ workbench: vi.fn() }));
vi.mock('@/api/portal', () => ({ portalApi: { workbench: mocks.workbench } }));

const Dummy = { template: '<div />' };

function quote(extra: Partial<PortalWorkbenchItemDto> = {}): PortalWorkbenchItemDto {
  return {
    id: 'q1',
    inquiry: { formalNo: 'RFQ-202611-0001', title: '透镜与反光杯询价' },
    roundNo: 1,
    roundStatus: 'WAITING_QUOTES',
    // 截止在很久以后：剩余时间一定显示
    deadline: '2099-11-20T10:00:00.000Z',
    status: 'INVITED',
    offeredAt: null,
    evaluatedAt: null,
    ...extra,
  };
}

async function mountPage(data: PortalWorkbenchDto): Promise<VueWrapper> {
  mocks.workbench.mockResolvedValue(data);
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/portal', name: 'portal-home', component: PortalHomePage },
      { path: '/portal/quotes', name: 'portal-quotes', component: Dummy },
      { path: '/portal/quotes/:quoteId', name: 'portal-quote', component: Dummy },
    ],
  });
  await router.push('/portal');
  const w = mount(PortalHomePage, {
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
  });
  await flushPromises();
  return w;
}

const card = (w: VueWrapper, key: string) => w.find(`[data-card="${key}"]`);

describe('PortalHomePage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('R16-1 待报价（已提交 / 未提交、截止与剩余时间）、议价待回复、最近结果；链接到报价详情和"我的询价"页签', async () => {
    const w = await mountPage({
      pendingQuotes: {
        total: 3,
        items: [
          quote({ id: 'q1', status: 'SUBMITTED', roundNo: 2 }),
          quote({ id: 'q2', inquiry: { formalNo: 'RFQ-202611-0002', title: '散热器询价' } }),
        ],
      },
      negotiations: {
        total: 1,
        items: [
          quote({
            id: 'q3',
            roundStatus: 'OPENED',
            status: 'EVALUATING',
            offeredAt: '2026-11-01T02:00:00.000Z',
          }),
        ],
      },
      recentResults: {
        total: 1,
        items: [
          quote({
            id: 'q4',
            roundStatus: 'EVALUATED',
            status: 'WON',
            evaluatedAt: '2026-10-30T02:00:00.000Z',
          }),
        ],
      },
    });
    expect(w.findAll('[data-card]').map((c) => c.attributes('data-card'))).toEqual([
      'pendingQuotes',
      'negotiations',
      'recentResults',
    ]);
    const pending = card(w, 'pendingQuotes');
    expect(pending.find('.count').text()).toBe('3');
    const [first, second] = pending.findAll('.wb-item');
    expect(first.text()).toContain('RFQ-202611-0001');
    expect(first.text()).toContain('已提交');
    expect(first.text()).toContain('第 2 轮');
    expect(first.text()).toContain('截止 2099-11-20 18:00');
    expect(first.text()).toContain('剩余');
    expect(second.text()).toContain('未提交');
    expect(pending.findAll('a').map((a) => a.attributes('href'))).toEqual([
      '/portal/quotes/q1',
      '/portal/quotes/q2',
      '/portal/quotes?tab=pending',
    ]);
    expect(card(w, 'negotiations').text()).toContain('采购方方案发出于 2026-11-01 10:00');
    expect(card(w, 'negotiations').find('.view-all').attributes('href')).toBe(
      '/portal/quotes?tab=evaluating',
    );
    const results = card(w, 'recentResults');
    expect(results.text()).toContain('最近 30 天内定标');
    expect(results.text()).toContain('定标于 2026-10-30 10:00');
    expect(results.text()).toContain('已中标');
    expect(results.find('.view-all').attributes('href')).toBe('/portal/quotes?tab=closed');
  });

  it('没有待办时显示"暂无待办"；英文界面', async () => {
    applyLocale('en-US');
    const empty = { total: 0, items: [] };
    const w = await mountPage({ pendingQuotes: empty, negotiations: empty, recentResults: empty });
    expect(w.findAll('.empty')).toHaveLength(3);
    expect(w.text()).toContain('Quotations Due');
    expect(w.text()).toContain('Nothing to do');
    expect(w.find('.view-all').exists()).toBe(false);
  });
});
