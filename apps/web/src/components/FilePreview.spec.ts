import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import FilePreview from './FilePreview.vue';

vi.mock('@/api/files', () => ({
  filesApi: {
    sheetPreview: vi.fn(async () => ({
      sheets: [{ name: '材料', rows: [['编码', '名称'], ['MAT-1', '灯珠', '2835']], truncated: true }],
    })),
    contentUrl: (id: string, disposition = 'attachment') => `/api/files/${id}/content?disposition=${disposition}`,
  },
}));

const mountPreview = (originalName: string) =>
  mount(FilePreview, { props: { file: { id: 'f1', originalName } }, global: { plugins: [i18n, ElementPlus] } });

describe('FilePreview（A-17）', () => {
  beforeAll(() => applyLocale('zh-CN'));

  it('PDF 用 iframe 内嵌预览，下载链接用 attachment', () => {
    const w = mountPreview('规格书.pdf');
    expect(w.find('iframe').attributes('src')).toBe('/api/files/f1/content?disposition=inline');
    expect(w.find('a').attributes('href')).toBe('/api/files/f1/content?disposition=attachment');
  });

  it('R02-6 xlsx 按工作表显示表格（列字母 + 行号，短行补空），被截断时提示', async () => {
    const w = mountPreview('materials.xlsx');
    await flushPromises();
    expect(w.findAll('thead th').map((th) => th.text())).toEqual(['', 'A', 'B', 'C']);
    const rows = w.findAll('tbody tr');
    expect(rows.map((r) => r.find('th').text())).toEqual(['1', '2']);
    expect(rows[0].findAll('td').map((td) => td.text())).toEqual(['编码', '名称', '']);
    expect(rows[1].findAll('td').map((td) => td.text())).toEqual(['MAT-1', '灯珠', '2835']);
    expect(w.text()).toContain(i18n.global.t('file.preview.truncated'));
  });

  it('其他格式不内嵌，只提供下载', () => {
    const w = mountPreview('spec.docx');
    expect(w.find('iframe').exists()).toBe(false);
    expect(w.text()).toContain(i18n.global.t('file.preview.notSupported'));
  });
});
