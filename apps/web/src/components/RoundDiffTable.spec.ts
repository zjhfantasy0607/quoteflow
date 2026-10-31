import type { RoundDiffDto, RoundDiffLineValues } from '@quoteflow/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import RoundDiffTable from './RoundDiffTable.vue';

vi.mock('@/api/system', () => ({
  dictsApi: {
    load: async () => ({
      unit: [
        { code: 'PCS', nameZh: '个', nameEn: 'pcs' },
        { code: 'SET', nameZh: '套', nameEn: 'set' },
      ],
    }),
  },
}));

const LED = { id: 'c1', code: 'LED-COB', nameZh: 'COB 灯珠', nameEn: 'COB LED' };
const line = (lineNo: number, extra: Partial<RoundDiffLineValues> = {}): RoundDiffLineValues => ({
  lineId: `l${lineNo}`,
  lineNo,
  materialCode: null,
  nameZh: `灯珠 ${lineNo}`,
  nameEn: null,
  spec: 'COB / 10W / Ra80',
  unitCode: 'PCS',
  quantity: '1000',
  category: LED,
  brand: null,
  drawingRef: null,
  ...extra,
});

const diff: RoundDiffDto = {
  roundNo: 2,
  previousRoundNo: 1,
  changeReason: 'Ra80 → Ra90',
  changeSummary: '改显色指数',
  lines: [
    {
      change: 'MODIFIED',
      before: line(1),
      after: line(1, { spec: 'COB / 10W / Ra90', unitCode: 'SET' }),
      changedFields: ['spec', 'unitCode'],
      files: {
        added: [{ fileId: 'f2', originalName: '新图.png', kind: 'PRODUCT_IMAGE' }],
        removed: [{ fileId: 'f1', originalName: '旧图.png', kind: 'PRODUCT_IMAGE' }],
      },
    },
    {
      change: 'UNCHANGED',
      before: line(2),
      after: line(3),
      changedFields: [],
      files: { added: [], removed: [] },
    },
    {
      change: 'ADDED',
      before: null,
      after: line(4, { nameZh: '新灯珠', spec: 'COB / 5W', quantity: '300' }),
      changedFields: [],
      files: { added: [], removed: [] },
    },
    {
      change: 'REMOVED',
      before: line(3, { nameZh: '取消的灯珠' }),
      after: null,
      changedFields: [],
      files: { added: [], removed: [] },
    },
  ],
  files: { added: [{ fileId: 'f9', originalName: '技术要求 V2.pdf', kind: 'SPEC_DOC' }], removed: [] },
  summary: { ADDED: 1, REMOVED: 1, MODIFIED: 1, UNCHANGED: 1 },
};

async function mountTable() {
  setActivePinia(createPinia());
  const w = mount(RoundDiffTable, {
    props: { diff },
    global: { plugins: [i18n, ElementPlus] },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const rows = (w: Awaited<ReturnType<typeof mountTable>>) =>
  w.findAll('.el-table__body tr').map((r) => r.text().replace(/\s+/g, ' '));

describe('RoundDiffTable', () => {
  beforeEach(() => applyLocale('zh-CN'));

  it('R13-6 只列有变化的行：修改的字段原值 → 新值（单位取字典名称）、附件增删、新增行、删除行；整单附件', async () => {
    const w = await mountTable();
    expect(w.find('.summary').text()).toBe('新增 1 行 · 删除 1 行 · 修改 1 行 · 未变 1 行');
    expect(w.find('.whole-files').text()).toContain('新增附件：技术要求 V2.pdf');
    const list = rows(w);
    expect(list).toHaveLength(3);
    expect(list[0]).toContain('第 1 行');
    expect(list[0]).toContain('规格型号：COB / 10W / Ra80 → COB / 10W / Ra90');
    expect(list[0]).toContain('单位：个 → 套');
    expect(list[0]).toContain('新增附件：新图.png');
    expect(list[0]).toContain('删除附件：旧图.png');
    expect(list[1]).toContain('新增');
    expect(list[1]).toContain('COB / 5W · 数量 300 个');
    expect(list[2]).toContain('删除');
    expect(list[2]).toContain('取消的灯珠');
    w.unmount();
  });

  it('打开"显示未变化的行"后列出未变的行（挪了位置的写原行号 → 新行号）；英文界面', async () => {
    const w = await mountTable();
    await w.find('.el-switch').trigger('click');
    await flushPromises();
    const list = rows(w);
    expect(list).toHaveLength(4);
    expect(list[1]).toContain('第 2 行 → 第 3 行');
    expect(list[1]).toContain('未变');

    applyLocale('en-US');
    await flushPromises();
    expect(w.find('.summary').text()).toBe('1 added · 1 removed · 1 changed · 1 unchanged');
    expect(rows(w)[0]).toContain('Unit: pcs → set');
    w.unmount();
  });
});
