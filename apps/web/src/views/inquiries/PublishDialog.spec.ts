import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryDetailDto, InquiryInviteeDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import PublishDialog from './PublishDialog.vue';

const mocks = vi.hoisted(() => ({ invitees: vi.fn(), publish: vi.fn() }));

vi.mock('@/api/inquiries', () => ({ inquiriesApi: { invitees: mocks.invitees, publish: mocks.publish } }));

const inquiry = {
  id: 'q1',
  currentRoundNo: 1,
  allowedActions: ['publish'],
} as unknown as InquiryDetailDto;

function invitee(
  code: string,
  nameZh: string,
  extra: Partial<InquiryInviteeDto['supplier']> = {},
): InquiryInviteeDto {
  return {
    supplier: {
      id: code,
      code,
      nameZh,
      nameEn: null,
      categoryCode: 'STRATEGIC',
      materialCategories: [],
      preferredLanguage: 'zh-CN',
      status: 'ENABLED',
      portalAccount: 'ACTIVE',
      ...extra,
    },
    addedBy: { id: 'u1', name: '采购张三' },
    addedAt: '2026-11-02T01:00:00.000Z',
  };
}

async function open(list: InquiryInviteeDto[], roundNo?: number): Promise<VueWrapper> {
  mocks.invitees.mockResolvedValue(list);
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/suppliers/:id', name: 'supplier-detail', component: { template: '<div />' } },
    ],
  });
  const w = mount(PublishDialog, {
    props: { inquiry, modelValue: false, roundNo },
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await w.setProps({ modelValue: true });
  await flushPromises();
  return w;
}

const dialog = () => document.body.querySelector('.el-dialog')!;
const publishButton = () =>
  [...dialog().querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) =>
    b.textContent?.includes('发布'),
  )!;

describe('PublishDialog', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('R07-6 没有可用门户账号的供应商只提示、可以跳转开通，不阻止发布', async () => {
    const w = await open([
      invitee('TS-ZH', '深圳星光电子'),
      invitee('TS-EN', '欧洲光学', { portalAccount: 'PENDING' }),
      invitee('TS-BI', '香港驱动', { portalAccount: 'NONE' }),
    ]);
    const text = dialog().textContent ?? '';
    expect(text).toContain('将向以下 3 家供应商发送邀请邮件');
    expect(text).toContain('以下受邀供应商还没有可用的门户账号');
    expect(text).toContain('欧洲光学（待激活）');
    expect(text).toContain('香港驱动（未开通）');
    expect(text).not.toContain('深圳星光电子（');
    const links = [...dialog().querySelectorAll<HTMLAnchorElement>('.accounts a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual(['/suppliers/TS-EN', '/suppliers/TS-BI']);
    expect(publishButton().disabled).toBe(false);

    // 没选截止时间：提示，不调接口
    publishButton().click();
    await flushPromises();
    expect(mocks.publish).not.toHaveBeenCalled();
    w.unmount();
  });

  it('R07-3 名单为空或有停用的供应商时不能发布', async () => {
    let w = await open([]);
    expect(dialog().textContent).toContain('还没有受邀供应商');
    expect(publishButton().disabled).toBe(true);
    w.unmount();
    document.body.innerHTML = '';

    w = await open([
      invitee('TS-ZH', '深圳星光电子'),
      invitee('TS-OFF', '停用的供应商', { status: 'DISABLED' }),
    ]);
    expect(dialog().textContent).toContain('以下供应商已停用，请先在"邀请供应商"页签移除：停用的供应商');
    expect(publishButton().disabled).toBe(true);
    w.unmount();
  });

  it('M13 变更草稿发布：标题、上一轮作废的说明、通知名单', async () => {
    const w = await open([invitee('TS-ZH', '深圳星光电子'), invitee('TS-NEW', '新增供应商')], 2);
    expect(dialog().querySelector('.el-dialog__title')?.textContent).toBe('通知供应商重新报价（第 2 轮）');
    const text = dialog().textContent ?? '';
    expect(text).toContain('发布后第 1 轮作废');
    expect(text).toContain('上一轮也受邀的供应商收到变更通知');
    expect(text).toContain('将通知以下 2 家供应商按新规格报价');
    expect(dialog().querySelector('.el-dialog__footer')?.textContent).toContain('确定发布');
    w.unmount();
  });
});
