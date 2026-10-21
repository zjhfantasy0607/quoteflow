import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import ParamsPage from './ParamsPage.vue';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('@/api/system', async () => {
  const { SYSTEM_PARAMS, SYSTEM_PARAM_KEYS } = await import('@quoteflow/shared');
  const dto = (key: (typeof SYSTEM_PARAM_KEYS)[number]) => ({
    key,
    value: SYSTEM_PARAMS[key].defaultValue,
    defaultValue: SYSTEM_PARAMS[key].defaultValue,
    descZh: SYSTEM_PARAMS[key].descZh,
    descEn: SYSTEM_PARAMS[key].descEn,
    updatedAt: null,
  });
  mocks.update.mockImplementation(async (key: (typeof SYSTEM_PARAM_KEYS)[number], value: unknown) => ({
    ...dto(key),
    value,
    updatedAt: '2026-10-21T08:00:00.000Z',
  }));
  return { paramsApi: { list: async () => SYSTEM_PARAM_KEYS.map(dto), update: mocks.update }, rolesApi: { list: async () => [] } };
});

function card(w: VueWrapper, key: string) {
  const found = w.findAll('.param-card').find((c) => c.text().includes(key));
  if (!found) throw new Error(`card ${key} not found`);
  return found;
}

async function mountPage(): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(ParamsPage, { global: { plugins: [i18n, ElementPlus, pinia] }, attachTo: document.body });
  await flushPromises();
  return w;
}

describe('系统参数页', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    mocks.update.mockClear();
  });

  it('每个参数一张卡片，显示标题、说明和默认值', async () => {
    const w = await mountPage();
    expect(w.findAll('.param-card')).toHaveLength(8);
    const session = card(w, 'security.sessionHours');
    expect(session.text()).toContain('登录会话有效期');
    expect(session.text()).toContain('12 小时');
    w.unmount();
  });

  it('R02-3 修改数字参数后按 schema 的类型提交', async () => {
    const w = await mountPage();
    const session = card(w, 'security.sessionHours');
    const input = session.find('.el-input-number input');
    await input.setValue('13');
    await input.trigger('change');
    await session.findAll('.card-footer button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(mocks.update).toHaveBeenCalledWith('security.sessionHours', 13);
    expect(card(w, 'security.sessionHours').text()).toContain('最后修改');
    w.unmount();
  });

  it('R02-3 不符合 schema 时在前端拦住，不提交', async () => {
    const w = await mountPage();
    const company = card(w, 'company.profile');
    await company.find('input').setValue('');
    await company.findAll('.card-footer button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(mocks.update).not.toHaveBeenCalled();
    // 错误文字在 Element Plus 的过渡动画里，jsdom 不渲染；表单项进入 is-error 状态即说明错误已挂上
    expect(company.findAll('.el-form-item.is-error')).toHaveLength(1);
    w.unmount();
  });
});
