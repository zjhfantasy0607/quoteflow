import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryRoundDto, MeDto, RoundDiffDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import InquiryChangePage from './InquiryChangePage.vue';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  round: vi.fn(),
  roundDiff: vi.fn(),
  updateChangeRound: vi.fn(),
  discardChangeRound: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@/api/inquiries', () => ({
  inquiriesApi: {
    get: mocks.get,
    round: mocks.round,
    roundDiff: mocks.roundDiff,
    updateChangeRound: mocks.updateChangeRound,
    discardChangeRound: mocks.discardChangeRound,
    lineTemplateUrl: '/api/inquiries/lines/import-template',
  },
}));
vi.mock('@/api/system', () => ({ dictsApi: { load: async () => ({ unit: [] }) } }));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm }));

const ALL = ['edit', 'editInvitees', 'publish', 'editChangeRound', 'discardChangeRound'];

const inquiry = {
  id: 'i1',
  draftNo: 'DR-20261210-0001',
  formalNo: 'RFQ-202612-0001',
  title: 'COB 灯珠询价',
  currentRoundNo: 1,
  currentRoundStatus: 'WAITING_QUOTES',
  draftRoundNo: 2,
  materialCategory: { id: 'c1', code: 'LED-COB', nameZh: 'COB 灯珠', nameEn: 'COB LED' },
  allowedActions: ['editInvitees'],
};

function round(extra: Partial<InquiryRoundDto> = {}): InquiryRoundDto {
  return {
    id: 'r2',
    roundNo: 2,
    status: 'DRAFT',
    deadline: null,
    changeReason: '显色指数 Ra80 → Ra90',
    changeSummary: null,
    pplTemplateVersion: null,
    pplVariantCode: null,
    publishedAt: null,
    lines: [],
    files: [],
    allowedActions: [...ALL] as InquiryRoundDto['allowedActions'],
    ...extra,
  };
}

const diff: RoundDiffDto = {
  roundNo: 2,
  previousRoundNo: 1,
  changeReason: '显色指数 Ra80 → Ra90',
  changeSummary: null,
  lines: [],
  files: { added: [], removed: [] },
  summary: { ADDED: 0, REMOVED: 0, MODIFIED: 0, UNCHANGED: 0 },
};

function me(): MeDto {
  return {
    user: {
      id: 'u1',
      username: 'buyer',
      name: '张三',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions: ['inquiry:view', 'inquiry:create', 'inquiry:spec', 'inquiry:publish', 'inquiry:changeSpec'],
    fieldPermissions: [],
    dataScope: 'SELF',
  };
}

let router: Router;

async function mountPage(r: InquiryRoundDto = round()): Promise<VueWrapper> {
  mocks.get.mockResolvedValue(inquiry);
  mocks.round.mockResolvedValue(r);
  mocks.roundDiff.mockResolvedValue(diff);
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me();
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/inquiries/:id/rounds/:roundNo/change', name: 'inquiry-change', component: InquiryChangePage },
      { path: '/inquiries/:id', name: 'inquiry-detail', component: { template: '<div />' } },
    ],
  });
  await router.push('/inquiries/i1/rounds/2/change');
  const w = mount(InquiryChangePage, {
    global: {
      plugins: [i18n, ElementPlus, pinia, router],
      components: ElementPlusIcons,
      stubs: {
        InquiryLinesTable: true,
        InquiryFilesSection: true,
        InquiryInviteesTab: true,
        MaterialPickerDialog: true,
        ManualLineDialog: true,
        ExcelImportDialog: true,
        PublishDialog: true,
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const button = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text() === text);
const messages = () => document.body.querySelector('.el-message')?.textContent ?? '';

describe('InquiryChangePage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('R13-2 变更草稿：标题、提示、变更说明表单（取自本轮）、规格对比；按 allowedActions 显示放弃与发布', async () => {
    const w = await mountPage();
    expect(w.find('.page-header').text()).toContain('规格变更 · 第 2 轮');
    expect(w.text()).toContain('发布前供应商看不到，第 1 轮照常进行');
    const [reason, summary] = w.findAll('textarea');
    expect((reason.element as HTMLTextAreaElement).value).toBe('显色指数 Ra80 → Ra90');
    expect((summary.element as HTMLTextAreaElement).value).toBe('');
    expect(w.text()).toContain('规格对比（第 1 轮 → 第 2 轮）');
    expect(button(w, '放弃变更')).toBeDefined();
    expect(button(w, '通知供应商重新报价')).toBeDefined();
    w.unmount();

    // PD：能改行、附件和变更说明，不能发布
    const pd = await mountPage(round({ allowedActions: ['edit', 'editChangeRound', 'discardChangeRound'] }));
    expect(button(pd, '通知供应商重新报价')).toBeUndefined();
    pd.unmount();
  });

  it('R13-2 保存变更说明；R13-3 发布前变更说明要已保存、两项都填，然后打开发布对话框（第 2 轮）', async () => {
    const w = await mountPage();
    // 没填主要变更内容
    await button(w, '通知供应商重新报价')!.trigger('click');
    await flushPromises();
    expect(messages()).toContain('发布前请填写并保存变更原因和主要变更内容');

    const summary = w.findAll('textarea')[1];
    await summary.setValue('两款都改为 Ra90');
    await button(w, '通知供应商重新报价')!.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('变更说明有未保存的修改，请先保存');
    expect(mocks.updateChangeRound).not.toHaveBeenCalled();

    mocks.updateChangeRound.mockResolvedValue(round({ changeSummary: '两款都改为 Ra90' }));
    await button(w, '保存变更说明')!.trigger('click');
    await flushPromises();
    expect(mocks.updateChangeRound).toHaveBeenCalledWith('i1', 2, {
      changeReason: '显色指数 Ra80 → Ra90',
      changeSummary: '两款都改为 Ra90',
    });
    await button(w, '通知供应商重新报价')!.trigger('click');
    await flushPromises();
    const dialog = w.findComponent({ name: 'PublishDialog' });
    expect(dialog.props()).toMatchObject({ modelValue: true, roundNo: 2 });
    w.unmount();
  });

  it('R13-7 放弃变更：确认后删除草稿，回到询价详情', async () => {
    mocks.discardChangeRound.mockResolvedValue({ id: 'i1' });
    const w = await mountPage();
    await button(w, '放弃变更')!.trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('第 2 轮草稿'));
    expect(mocks.discardChangeRound).toHaveBeenCalledWith('i1', 2);
    expect(router.currentRoute.value.name).toBe('inquiry-detail');
    w.unmount();
  });

  it('已发布的轮次不是变更草稿：提示后回到询价详情', async () => {
    const w = await mountPage(round({ status: 'WAITING_QUOTES', allowedActions: [] }));
    expect(router.currentRoute.value.name).toBe('inquiry-detail');
    expect(document.body.textContent).toContain('第 2 轮已不是变更草稿');
    w.unmount();
  });
});
