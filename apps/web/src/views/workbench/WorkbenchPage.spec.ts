import { mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { applyLocale, i18n } from '@/i18n';
import WorkbenchPage from './WorkbenchPage.vue';

describe('WorkbenchPage', () => {
  it('R00-5 切换语言后文案即时变化，输入内容不丢', async () => {
    applyLocale('zh-CN');
    const wrapper = mount(WorkbenchPage, { global: { plugins: [i18n, ElementPlus] } });
    const input = wrapper.find('input');
    await input.setValue('2835 LED');
    expect(wrapper.text()).toContain(i18n.global.t('workbench.welcome'));
    const zhPlaceholder = input.attributes('placeholder');

    applyLocale('en-US');
    await nextTick();

    expect(wrapper.text()).toContain('Welcome to the QuoteFlow sourcing platform.');
    expect(input.attributes('placeholder')).not.toBe(zhPlaceholder);
    expect((input.element as HTMLInputElement).value).toBe('2835 LED');
    applyLocale('zh-CN');
  });
});
