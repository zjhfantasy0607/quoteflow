import * as ElementPlusIcons from '@element-plus/icons-vue';
import { PPL_V0, resolveColumns } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import type { PplSheetLine } from '@/utils/ppl';
import PplForm from './PplForm.vue';

vi.mock('@/api/system', () => ({
  dictsApi: { load: async (types: string[]) => Object.fromEntries(types.map((t) => [t, []])) },
}));

const columns = resolveColumns(PPL_V0, 'PPL-LED');
const line: PplSheetLine = {
  id: 'l1',
  lineNo: 2,
  quantity: '1000',
  prefill: { line_no: 2, material_name: '灯珠 2835', quantity: '1000', currency: 'CNY' },
};

async function mountForm(props: Record<string, unknown>): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(PplForm, {
    props: { modelValue: true, groups: PPL_V0.groups, columns, line, currency: 'CNY', ...props },
    global: { plugins: [i18n, ElementPlus, pinia], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const field = (key: string) => document.body.querySelector<HTMLElement>(`.ppl-form [data-field="${key}"]`)!;

describe('PplForm（M09 §5）', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('R09-2 按分组渲染该变体的全部列：预填只读、公式实时计算、必填标 *、标签按当前语言', async () => {
    const w = await mountForm({ values: { unit_price_incl_tax: '1.13', tax_rate: '13' } });
    const form = document.body.querySelector('.ppl-form')!;
    expect(form.textContent).toContain('第 2 行 · 灯珠 2835');
    expect(form.querySelectorAll('[data-field]')).toHaveLength(67);
    expect(form.querySelectorAll('.el-collapse-item')).toHaveLength(PPL_V0.groups.length);
    // PPL-LED 必填：主模板 3 列 + 变体 4 列
    expect(form.querySelectorAll('.required')).toHaveLength(7);
    expect(field('cct_k').textContent).toContain('*');
    expect(field('material_name').textContent).toContain('询价带出');
    expect(field('material_name').querySelector('input')).toBeNull();
    expect(field('unit_price_excl_tax').textContent).toContain('自动计算');
    expect(field('unit_price_excl_tax').textContent).toContain('1.0000');
    expect(field('total_price_incl_tax').textContent).toContain('1,130.00');
    // 排除的列不出现
    expect(field('ip_rating')).toBeNull();

    applyLocale('en-US');
    await flushPromises();
    expect(field('unit_price_incl_tax').textContent).toContain('Unit Price (incl. tax)');
    w.unmount();
  });

  it('编辑后通过 v-model:values 交回这一行的取值；清空的列不保留', async () => {
    const w = await mountForm({ values: { brand: '星光' } });
    const brand = field('brand').querySelector('input')!;
    brand.value = '';
    brand.dispatchEvent(new Event('input'));
    const model = field('model').querySelector('input')!;
    model.value = 'LX-2835';
    model.dispatchEvent(new Event('input'));
    await flushPromises();
    const updates = w.emitted('update:values')!;
    expect(updates.at(-1)).toEqual([{ model: 'LX-2835' }]);
    w.unmount();
  });

  it('R09-11 有错误时标出字段并提示，打开时滚动到 focusKey', async () => {
    const w = await mountForm({
      values: {},
      focusKey: 'cct_k',
      errors: { cct_k: { lineId: 'l1', lineNo: 2, key: 'cct_k', code: 'required', message: 'required' } },
    });
    await w.setProps({ modelValue: false });
    await w.setProps({ modelValue: true });
    await flushPromises();
    expect(field('cct_k').classList.contains('is-error')).toBe(true);
    expect(field('cct_k').textContent).toContain('必填');
    expect(document.body.querySelector('.ppl-form')!.textContent).toContain('这一行有 1 处需要修改');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    w.unmount();
  });

  it('只读时（版本明细）显示存的取值，没有输入框；被脱敏的列显示锁', async () => {
    const w = await mountForm({
      readonly: true,
      values: { unit_price_incl_tax: null, tax_rate: '13.00', rohs: true },
      maskedFields: ['unit_price_incl_tax'],
    });
    const form = document.body.querySelector('.ppl-form')!;
    expect(form.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(field('unit_price_incl_tax').textContent).toContain('******');
    expect(field('tax_rate').textContent).toContain('13.00%');
    expect(field('rohs').textContent).toContain('是');
    w.unmount();
  });
});
