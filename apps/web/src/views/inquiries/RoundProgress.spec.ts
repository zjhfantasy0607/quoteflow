import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryRoundSummaryDto } from '@quoteflow/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import RoundProgress from './RoundProgress.vue';

function round(extra: Partial<InquiryRoundSummaryDto> = {}): InquiryRoundSummaryDto {
  return {
    id: 'r1',
    roundNo: 1,
    status: 'WAITING_QUOTES',
    deadline: '2026-11-05T02:00:00.000Z',
    publishedAt: '2026-11-02T01:00:00.000Z',
    quotesClosedAt: null,
    closedEarly: false,
    openedAt: null,
    evaluatedAt: null,
    lineCount: 1,
    ...extra,
  };
}

async function steps(value: InquiryRoundSummaryDto) {
  const w = mount(RoundProgress, {
    props: { round: value },
    global: { plugins: [i18n, ElementPlus], components: ElementPlusIcons },
  });
  // el-steps 在子步骤挂载后才算出各步状态
  await flushPromises();
  return {
    w,
    items: w.findAll('.el-step').map((s) => ({
      title: s.find('.el-step__title').text(),
      description: s.find('.el-step__description').text(),
      status: ['process', 'success', 'wait', 'error'].find((c) =>
        s.find('.el-step__title').classes().includes(`is-${c}`),
      ),
    })),
  };
}

describe('RoundProgress', () => {
  beforeEach(() => applyLocale('zh-CN'));

  it('M10 §5 等待报价时第 1 步高亮，报价完成显示计划的截止时间（北京时间）', async () => {
    const { items } = await steps(round());
    expect(items.map((i) => i.title)).toEqual(['等待报价', '报价完成', '开标', '评标完成']);
    expect(items.map((i) => i.status)).toEqual(['process', 'wait', 'wait', 'wait']);
    expect(items[0].description).toBe('2026-11-02 09:00 北京时间');
    expect(items[1].description).toBe('截止 2026-11-05 10:00 北京时间');
  });

  it('提前截止后开标：前两步完成并注明提前截止，开标是当前步骤', async () => {
    const { items } = await steps(
      round({
        status: 'OPENED',
        quotesClosedAt: '2026-11-03T01:00:00.000Z',
        closedEarly: true,
        openedAt: '2026-11-03T02:00:00.000Z',
      }),
    );
    expect(items.map((i) => i.status)).toEqual(['success', 'success', 'process', 'wait']);
    expect(items[1].description).toBe('2026-11-03 09:00 北京时间 · 提前截止');
    expect(items[2].description).toBe('2026-11-03 10:00 北京时间');
  });

  it('取消的轮次停在走到的那一步并标红', async () => {
    const { w, items } = await steps(round({ status: 'CANCELLED', quotesClosedAt: '2026-11-05T02:00:00.000Z' }));
    expect(items.map((i) => i.status)).toEqual(['success', 'error', 'wait', 'wait']);
    expect(items[2].description).toBe('');
    expect(w.text()).toContain('本轮已停止：已取消');
  });
});
