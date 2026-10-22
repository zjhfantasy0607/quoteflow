import * as ElementPlusIcons from '@element-plus/icons-vue';
import {
  PPL_V0,
  pplVariants,
  resolveColumns,
  type MeDto,
  type PplSetDto,
  type PplSetSummaryDto,
} from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { AxiosError, type AxiosResponse } from 'axios';
import ElementPlus, { ElRadioGroup } from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import PplPage from './PplPage.vue';
import PplUploadDialog from './PplUploadDialog.vue';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  activate: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@/api/system', () => ({
  pplApi: { list: mocks.list, detail: mocks.detail, create: mocks.create, activate: mocks.activate },
}));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm }));

function summary(version: number, isActive: boolean): PplSetSummaryDto {
  return {
    version,
    label: `PPL v${version}`,
    isActive,
    createdAt: '2026-10-21T02:00:00.000Z',
    variants: pplVariants(PPL_V0).map((v) => ({ ...v, columnCount: resolveColumns(PPL_V0, v.code).length })),
  };
}

function me(permissions: string[]): MeDto {
  return {
    user: {
      id: 'u1',
      username: 'admin',
      name: 'Admin',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions,
    fieldPermissions: [],
    dataScope: 'ALL',
  };
}

const global = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  return { plugins: [i18n, ElementPlus, pinia], components: ElementPlusIcons };
};

async function mountPage(permissions: string[]): Promise<VueWrapper> {
  const g = global();
  useAuthStore().me = me(permissions);
  const w = mount(PplPage, { global: g, attachTo: document.body });
  await flushPromises();
  return w;
}

const tr = (key: string, params: Record<string, unknown> = {}) => i18n.global.t(key, params);
const columnRows = (w: VueWrapper) => w.findAll('.columns-table .el-table__body-wrapper tbody tr');
const buttons = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).filter((b) => b.textContent?.trim() === text);

describe('PPL 模板页', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([summary(2, false), summary(1, true)]);
    mocks.detail.mockImplementation(async (version: number): Promise<PplSetDto> => ({
      ...summary(version, version === 1),
      definition: PPL_V0,
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('R05-3 默认打开激活版本：主模板 70 列，切到 PPL-LED 后 67 列', async () => {
    const w = await mountPage(['system:ppl:view']);
    expect(mocks.detail).toHaveBeenCalledWith(1);
    expect(columnRows(w)).toHaveLength(70);
    expect(w.text()).toContain(
      tr('system.ppl.columnSummary', { total: 70, prefill: 9, supplier: 58, required: 3, formula: 3 }),
    );
    expect(w.text()).toContain('ip_rating');

    w.findComponent(ElRadioGroup).vm.$emit('update:modelValue', 'PPL-LED');
    await flushPromises();
    expect(columnRows(w)).toHaveLength(67);
    expect(w.text()).toContain(
      tr('system.ppl.columnSummary', { total: 67, prefill: 9, supplier: 55, required: 7, formula: 3 }),
    );
    expect(w.text()).not.toContain('ip_rating');
    // R05-8 标签按当前语言显示
    expect(w.text()).toContain('含税单价');
    w.unmount();
  });

  it('R05-2 激活未激活的版本：确认后调用接口并刷新列表', async () => {
    const w = await mountPage(['system:ppl:view', 'system:ppl:manage']);
    const activate = buttons(tr('system.ppl.activate'));
    expect(activate).toHaveLength(1);
    activate[0].click();
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.activate).toHaveBeenCalledWith(2);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.detail).toHaveBeenLastCalledWith(2);
    w.unmount();
  });

  it('只有 system:ppl:view 时没有上传和激活按钮', async () => {
    const w = await mountPage(['system:ppl:view']);
    expect(buttons(tr('system.ppl.upload'))).toHaveLength(0);
    expect(buttons(tr('system.ppl.activate'))).toHaveLength(0);
    w.unmount();
  });

  it('R05-1 上传写错的定义：逐条显示问题，不关闭对话框', async () => {
    const w = mount(PplUploadDialog, {
      props: { modelValue: true },
      global: global(),
      attachTo: document.body,
    });
    await flushPromises();
    const input = document.body.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([JSON.stringify({ ...PPL_V0, label: 'PPL 错误示例' })], 'ppl.json', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await flushPromises();

    const response = {
      status: 400,
      data: {
        code: 'PPL_DEFINITION_INVALID',
        message: 'PPL_DEFINITION_INVALID',
        details: [
          { path: 'master.columns[2].prefillFrom', message: 'prefill column requires prefillFrom' },
          { path: 'variants[0].exclude[3]', message: 'cannot exclude required column "lead_time_days"' },
        ],
      },
    } as AxiosResponse;
    mocks.create.mockRejectedValue(new AxiosError('fail', 'ERR_BAD_REQUEST', undefined, undefined, response));
    buttons(tr('system.ppl.uploadDialog.submit'))[0].click();
    await flushPromises();

    // 标签默认取定义里的 label
    expect(mocks.create).toHaveBeenCalledWith({
      label: 'PPL 错误示例',
      definition: expect.objectContaining({ schemaVersion: 1 }),
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain(tr('system.ppl.uploadDialog.issuesTitle', { count: 2 }));
    expect(text).toContain('variants[0].exclude[3]');
    expect(text).toContain('cannot exclude required column "lead_time_days"');
    expect(w.emitted('update:modelValue')).toBeUndefined();
    w.unmount();
  });

  it('选的文件不是 JSON 时提示，不调用接口', async () => {
    const w = mount(PplUploadDialog, {
      props: { modelValue: true },
      global: global(),
      attachTo: document.body,
    });
    await flushPromises();
    const input = document.body.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['not json'], 'ppl.json')] });
    input.dispatchEvent(new Event('change'));
    await flushPromises();
    buttons(tr('system.ppl.uploadDialog.submit'))[0].click();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150)); // el-form-item 的错误文字防抖 100ms
    expect(mocks.create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(tr('system.ppl.uploadDialog.invalidJson'));
    w.unmount();
  });
});
