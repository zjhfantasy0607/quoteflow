import * as ElementPlusIcons from '@element-plus/icons-vue';
import { mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { isMasked } from '@/utils/masked';
import MaskedValue from './MaskedValue.vue';

function mountValue(masked: boolean) {
  return mount(MaskedValue, {
    props: { masked },
    slots: { default: '021-6666 0002' },
    global: { plugins: [i18n, ElementPlus], components: ElementPlusIcons },
  });
}

describe('MaskedValue', () => {
  it('R04-7 被脱敏时显示 ******，不显示插槽内容', () => {
    const w = mountValue(true);
    expect(w.text()).toContain('******');
    expect(w.text()).not.toContain('021');
  });

  it('没被脱敏时显示插槽内容', () => {
    expect(mountValue(false).text()).toBe('021-6666 0002');
  });

  it('isMasked 按 maskedFields 判断', () => {
    const row = { contactPhone: null, maskedFields: ['contactEmail', 'contactPhone'] };
    expect(isMasked(row, 'contactPhone')).toBe(true);
    expect(isMasked(row, 'contactName')).toBe(false);
    expect(isMasked({}, 'contactPhone')).toBe(false);
    expect(isMasked(null, 'contactPhone')).toBe(false);
  });
});
