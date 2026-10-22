import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryLineDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import InquiryLinesTable from './InquiryLinesTable.vue';

const mocks = vi.hoisted(() => ({
  reorderLines: vi.fn(async () => ({})),
  updateLine: vi.fn(async () => ({})),
  removeLine: vi.fn(async () => ({})),
}));

vi.mock('@/api/inquiries', () => ({ inquiriesApi: mocks }));
vi.mock('@/api/system', () => ({ dictsApi: { load: async () => ({ unit: [] }) } }));
vi.mock('@/api/materials', () => ({ materialCategoriesApi: { tree: async () => [] } }));

function line(no: number, extra: Partial<InquiryLineDto> = {}): InquiryLineDto {
  return {
    id: `l${no}`,
    lineNo: no,
    materialId: null,
    materialCode: null,
    nameZh: `物料 ${no}`,
    nameEn: null,
    spec: `SPEC-${no}`,
    unitCode: 'PCS',
    quantity: '100',
    brand: null,
    drawingRef: null,
    remark: null,
    category: { id: 'c1', code: 'LED', nameZh: '灯珠', nameEn: 'LED Beads', effectiveEnabled: true },
    files: [],
    ...extra,
  };
}

function mountTable(lines: InquiryLineDto[], editable = true): VueWrapper {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(InquiryLinesTable, {
    props: { inquiryId: 'q1', roundNo: 1, lines, editable },
    global: { plugins: [i18n, ElementPlus, pinia], components: ElementPlusIcons },
    attachTo: document.body,
  });
}

/** jsdom 没有 DragEvent / DataTransfer，用普通事件模拟（组件里 dataTransfer 是可选的） */
function drag(source: Element, target: Element): void {
  source.dispatchEvent(new Event('dragstart', { bubbles: true }));
  target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
  target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
}

describe('InquiryLinesTable', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
  });

  it('R06-3 拖动第 3 行的图标放到第 1 行上，按新顺序提交全部行', async () => {
    const w = mountTable([line(1), line(2), line(3)]);
    await flushPromises();
    const handles = w.findAll('.drag-handle');
    const rows = w.findAll('.el-table__body tr.el-table__row');
    expect(handles).toHaveLength(3);
    drag(handles[2].element, rows[0].find('td').element);
    await flushPromises();
    expect(mocks.reorderLines).toHaveBeenCalledWith('q1', 1, ['l3', 'l1', 'l2']);
    expect(w.emitted('changed')).toHaveLength(1);
    w.unmount();
  });

  it('只读时没有拖动图标和操作列', async () => {
    const w = mountTable([line(1), line(2)], false);
    await flushPromises();
    expect(w.findAll('.drag-handle')).toHaveLength(0);
    expect(w.text()).not.toContain('编辑');
    w.unmount();
  });

  it('R06-2 材料行行内编辑只能改数量、品牌、图纸编号和备注', async () => {
    const material = line(1, { materialId: 'm1', materialCode: 'MAT-000001', nameZh: '灯珠 2835' });
    const w = mountTable([material, line(2)]);
    await flushPromises();
    const editButtons = w.findAll('.el-table__body button').filter((b) => b.text() === '编辑');
    await editButtons[0].trigger('click');
    const row = w.findAll('.el-table__body tr.el-table__row')[0];
    // 数量、品牌、图纸编号、备注 4 个输入框，名称和规格仍是文字
    expect(row.findAll('input')).toHaveLength(4);
    expect(row.text()).toContain('灯珠 2835');
    await row.findAll('input')[0].setValue('2500.5');
    await row
      .findAll('button')
      .find((b) => b.text() === '保存')!
      .trigger('click');
    await flushPromises();
    expect(mocks.updateLine).toHaveBeenCalledWith('q1', 1, 'l1', {
      source: 'MATERIAL',
      quantity: '2500.5',
      brand: undefined,
      drawingRef: undefined,
      remark: undefined,
    });
    w.unmount();
  });

  it('数量不合法时不提交，行内提示', async () => {
    const w = mountTable([line(1)]);
    await flushPromises();
    await w
      .findAll('.el-table__body button')
      .find((b) => b.text() === '编辑')!
      .trigger('click');
    const row = w.findAll('.el-table__body tr.el-table__row')[0];
    const quantity = row.findAll('input').find((i) => (i.element as HTMLInputElement).value === '100')!;
    await quantity.setValue('0');
    await row
      .findAll('button')
      .find((b) => b.text() === '保存')!
      .trigger('click');
    await flushPromises();
    expect(mocks.updateLine).not.toHaveBeenCalled();
    expect(row.find('.err').exists()).toBe(true);
    w.unmount();
  });
});
