import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { InquiryDetailDto, MatrixSupplierDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import AwardDialog from './AwardDialog.vue';

const mocks = vi.hoisted(() => ({ award: vi.fn(), confirm: vi.fn(async () => true) }));

vi.mock('@/api/inquiries', () => ({ inquiriesApi: { award: mocks.award } }));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm }));

const inquiry = { id: 'i1', currentRoundNo: 1, allowedActions: ['award'] } as unknown as InquiryDetailDto;

function supplier(code: string, extra: Partial<MatrixSupplierDto> = {}): MatrixSupplierDto {
  return {
    quoteId: `q-${code}`,
    supplier: { id: `s-${code}`, code, nameZh: `供应商${code}`, nameEn: null },
    status: 'EVALUATING',
    quoted: true,
    totalAmount: '100.00',
    currency: 'CNY',
    maxLeadTimeDays: 30,
    versionCount: 1,
    currentVersionNo: 1,
    currentVersionSource: 'ONLINE',
    lastSubmittedAt: '2026-11-23T02:00:00.000Z',
    changeNote: null,
    declineReasonCode: null,
    declineReason: null,
    shortlisted: false,
    lowestTotal: false,
    negotiation: null,
    ...extra,
  };
}

async function open(suppliers: MatrixSupplierDto[]): Promise<VueWrapper> {
  const w = mount(AwardDialog, {
    props: { inquiry, suppliers, modelValue: false },
    global: { plugins: [i18n, ElementPlus], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await w.setProps({ modelValue: true });
  await flushPromises();
  return w;
}

const dialog = () => document.body.querySelector('.el-dialog')!;
const rows = () => [...dialog().querySelectorAll<HTMLElement>('.el-table__body tr')];
const confirmButton = () =>
  [...dialog().querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find((b) =>
    b.textContent?.includes('确定定标'),
  )!;

describe('AwardDialog', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('R12-1 只列评标中的供应商，入围的在前；显示含税合计与入围；提示其他供应商未中标、自动生成合同草稿', async () => {
    const w = await open([
      supplier('A', { totalAmount: '2300.00' }),
      supplier('B', { totalAmount: '2350.00', shortlisted: true }),
      supplier('C', { status: 'DECLINED', quoted: false, totalAmount: null }),
      supplier('D', { status: 'INVITED', quoted: false, totalAmount: null }),
    ]);
    expect(dialog().textContent).toContain('其他评标中的供应商将被标记为未中标');
    expect(dialog().textContent).toContain('自动生成合同草稿');
    const list = rows();
    expect(list).toHaveLength(2);
    expect(list[0].textContent).toContain('供应商B');
    expect(list[0].textContent).toContain('CNY 2,350.00');
    expect(list[0].textContent).toContain('已入围');
    expect(list[1].textContent).toContain('供应商A');
    expect(list[1].textContent).not.toContain('已入围');
    w.unmount();
  });

  it('R12-1 没选供应商不能提交；选中后再确认一次，提交定标说明，把最新详情交给页面', async () => {
    const updated = { ...inquiry, allowedActions: ['evaluate'] } as unknown as InquiryDetailDto;
    mocks.award.mockResolvedValue(updated);
    const w = await open([supplier('A'), supplier('B', { shortlisted: true })]);
    confirmButton().click();
    await flushPromises();
    expect(mocks.award).not.toHaveBeenCalled();

    rows()[1].click();
    await flushPromises();
    const textarea = dialog().querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = ' 价格最低 ';
    textarea.dispatchEvent(new Event('input'));
    confirmButton().click();
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('A 供应商A'));
    expect(mocks.award).toHaveBeenCalledWith('i1', 1, { quoteId: 'q-A', comment: '价格最低' });
    expect(w.emitted('awarded')).toEqual([[updated]]);
    expect(w.emitted('update:modelValue')).toEqual([[false]]);
    w.unmount();
  });

  it('只有一家评标中时默认选中；取消确认就不提交', async () => {
    mocks.confirm.mockResolvedValueOnce(false);
    const w = await open([supplier('A'), supplier('C', { status: 'DECLINED', quoted: false })]);
    confirmButton().click();
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.award).not.toHaveBeenCalled();
    w.unmount();
  });

  it('没有评标中的报价时提示不能定标，按钮不可用', async () => {
    const w = await open([supplier('C', { status: 'DECLINED', quoted: false })]);
    expect(dialog().textContent).toContain('没有评标中的报价，不能定标');
    expect(confirmButton().disabled).toBe(true);
    w.unmount();
  });
});
