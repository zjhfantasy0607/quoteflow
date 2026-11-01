import * as ElementPlusIcons from '@element-plus/icons-vue';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import LoginPage from './LoginPage.vue';

describe('LoginPage', () => {
  it('R00-5 切换语言后文案即时变化，输入内容不丢', async () => {
    applyLocale('zh-CN');
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginPage },
        { path: '/forgot-password', name: 'forgot-password', component: { template: '<div />' } },
      ],
    });
    await router.push('/login');
    const wrapper = mount(LoginPage, {
      global: { plugins: [i18n, ElementPlus, createPinia(), router], components: ElementPlusIcons },
    });
    await flushPromises();
    const input = wrapper.find('input[name="username"]');
    await input.setValue('buyer.zhang');
    const zhLabel = i18n.global.t('auth.login.username');
    expect(wrapper.text()).toContain(zhLabel);

    applyLocale('en-US');
    await nextTick();

    expect(wrapper.text()).not.toContain(zhLabel);
    expect(wrapper.text()).toContain(i18n.global.t('auth.login.username'));
    expect((input.element as HTMLInputElement).value).toBe('buyer.zhang');
    applyLocale('zh-CN');
  });
});
