import * as ElementPlusIcons from '@element-plus/icons-vue';
import { flushPromises, mount } from '@vue/test-utils';
import { AxiosError, type AxiosResponse } from 'axios';
import ElementPlus from 'element-plus';
import { createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import ActivatePage from './ActivatePage.vue';

const mocks = vi.hoisted(() => ({ activate: vi.fn() }));
vi.mock('@/api/auth', () => ({ authApi: { activate: mocks.activate } }));

async function mountAt(url: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/activate', name: 'activate', component: ActivatePage },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(ActivatePage, {
    global: { plugins: [i18n, ElementPlus, createPinia(), router], components: ElementPlusIcons },
  });
  await flushPromises();
  return w;
}

async function fillAndSubmit(w: Awaited<ReturnType<typeof mountAt>>, password: string, confirm = password) {
  await w.find('input[name="new-password"]').setValue(password);
  await w.find('input[name="confirm-password"]').setValue(confirm);
  await w.find('form').trigger('submit');
  await flushPromises();
}

describe('ActivatePage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    mocks.activate.mockReset();
  });

  it('R04-11 链接带 lang 时按邮件的语言打开；设置密码后提示去登录', async () => {
    mocks.activate.mockResolvedValue({ ok: true });
    const w = await mountAt('/activate?token=tok-123456789&lang=en-US');
    expect(i18n.global.locale.value).toBe('en-US');
    expect(w.text()).toContain('Activate your supplier portal account');

    await fillAndSubmit(w, 'weak');
    expect(mocks.activate).not.toHaveBeenCalled();
    await fillAndSubmit(w, 'Portal2026', 'Portal2027');
    expect(mocks.activate).not.toHaveBeenCalled();

    await fillAndSubmit(w, 'Portal2026');
    expect(mocks.activate).toHaveBeenCalledWith('tok-123456789', 'Portal2026');
    expect(w.text()).toContain('Your account is activated');
    applyLocale('zh-CN');
  });

  it('R04-11 链接无效或过期时提示联系采购人员重新发送', async () => {
    const response = {
      status: 400,
      data: { code: 'AUTH_TOKEN_INVALID', message: 'Invalid token' },
    } as AxiosResponse;
    mocks.activate.mockRejectedValue(
      new AxiosError('fail', 'ERR_BAD_REQUEST', undefined, undefined, response),
    );
    const w = await mountAt('/activate?token=tok-expired-000');
    await fillAndSubmit(w, 'Portal2026');
    expect(w.text()).toContain(i18n.global.t('errors.AUTH_TOKEN_INVALID'));
    expect(w.text()).toContain('请联系采购人员重新发送激活邮件');
  });

  it('链接里没有令牌时不显示表单', async () => {
    const w = await mountAt('/activate');
    expect(w.text()).toContain('链接不完整');
    expect(w.find('form').exists()).toBe(false);
  });
});
