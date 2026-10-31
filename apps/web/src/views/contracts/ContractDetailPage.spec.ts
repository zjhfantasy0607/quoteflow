import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { ContractApprovalDto, ContractDetailDto, ContractSnapshotDto, MeDto } from '@quoteflow/shared';
import { AxiosError, type AxiosResponse } from 'axios';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import ContractDetailPage from './ContractDetailPage.vue';
import ContractPrintPage from './ContractPrintPage.vue';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  submit: vi.fn(),
  review: vi.fn(),
  approve: vi.fn(),
  signedScan: vi.fn(),
  appConfig: vi.fn(),
  confirm: vi.fn(async () => true),
}));

vi.mock('@/api/contracts', () => ({
  contractsApi: {
    get: mocks.get,
    update: mocks.update,
    submit: mocks.submit,
    review: mocks.review,
    approve: mocks.approve,
    signedScan: mocks.signedScan,
  },
}));
vi.mock('@/api/system', () => ({
  paramsApi: { appConfig: mocks.appConfig },
  dictsApi: { load: async () => ({}) },
}));
vi.mock('@/utils/dialogs', () => ({ confirmAction: mocks.confirm }));

type Column = ContractSnapshotDto['columns'][number];
const column = (key: string, labelZh: string, type: Column['type'], extra: Partial<Column> = {}): Column => ({
  key,
  group: 'price',
  labelZh,
  labelEn: key,
  type,
  source: 'supplier',
  required: false,
  ...extra,
});

/** 两行：第 1 行议价把数量从 1000 改成 1200；合计 1200 × 50 + 500 × 34 = 77000.00 */
function snapshot(): ContractSnapshotDto {
  const unit = { code: 'PCS', nameZh: '个', nameEn: 'pcs' };
  const category = { code: 'BRACKET', nameZh: '支架', nameEn: 'Bracket' };
  return {
    capturedAt: '2026-11-06T02:00:00.000Z',
    inquiry: {
      id: 'i1',
      formalNo: 'PJ-2026-006',
      projectNo: 'PRJ-0006',
      title: '灯具支架询价',
      currency: 'CNY',
      roundNo: 1,
      materialCategory: category,
      owner: { id: 'u1', name: '张三' },
    },
    lines: [
      {
        lineId: 'l1',
        lineNo: 1,
        materialCode: 'M-001',
        nameZh: '铝支架',
        nameEn: 'Aluminium bracket',
        spec: '200mm 阳极氧化',
        unit,
        quantity: '1000',
        category,
      },
      {
        lineId: 'l2',
        lineNo: 2,
        materialCode: null,
        nameZh: '钢支架',
        nameEn: null,
        spec: '300mm',
        unit,
        quantity: '500',
        category,
      },
    ],
    supplier: {
      id: 's1',
      code: 'SUP10003',
      nameZh: '东莞五金制品有限公司',
      nameEn: null,
      contactName: '李四',
      contactEmail: 'li@example.com',
      contactPhone: '13800000000',
    },
    quoteVersion: {
      id: 'v2',
      versionNo: 2,
      source: 'NEGOTIATION',
      submittedAt: '2026-11-05T02:00:00.000Z',
      totalAmount: '77000.00',
      currency: 'CNY',
      values: {
        lines: [
          {
            lineId: 'l1',
            lineNo: 1,
            values: {
              unit_price_incl_tax: '50.0000',
              tax_rate: '13',
              total_price_incl_tax: '60000.00',
              brand: 'ACME',
              quantity: '1200',
            },
          },
          {
            lineId: 'l2',
            lineNo: 2,
            values: {
              unit_price_incl_tax: '34.0000',
              tax_rate: '13',
              total_price_incl_tax: '17000.00',
              brand: 'ACME',
            },
          },
        ],
      },
      remark: null,
      changeNote: null,
      templateVersion: 1,
      variantCode: 'PPL-MASTER',
      attachments: [{ fileId: 'f9', originalName: '报价说明.pdf' }],
    },
    columns: [
      column('line_no', '行号', 'int', { source: 'prefill', keyField: true }),
      column('brand', '品牌', 'text', { inMatrix: true }),
      column('unit_price_incl_tax', '含税单价', 'money', { keyField: true, sensitive: true, precision: 4 }),
      column('tax_rate', '税率(%)', 'percent', { keyField: true }),
      column('total_price_incl_tax', '含税总价', 'money', {
        source: 'formula',
        formula: 'lineTotal',
        keyField: true,
        sensitive: true,
        precision: 2,
      }),
    ],
    negotiation: [
      {
        seq: 1,
        party: 'BUYER',
        type: 'OFFER',
        lines: [{ lineId: 'l1', unitPriceInclTax: '50', quantity: '1200' }],
        content: '量大从优',
        createdAt: '2026-11-04T02:00:00.000Z',
      },
      {
        seq: 2,
        party: 'SUPPLIER',
        type: 'ACCEPT',
        lines: [],
        content: null,
        createdAt: '2026-11-05T02:00:00.000Z',
      },
    ],
    files: [{ fileId: 'f1', originalName: '支架图纸.pdf', kind: 'SPEC_DOC', lineNo: null }],
  };
}

const approval = (
  step: ContractApprovalDto['step'],
  action: ContractApprovalDto['action'],
  name: string,
  createdAt: string,
  comment: string | null = null,
): ContractApprovalDto => ({
  id: `${step}-${action}-${createdAt}`,
  step,
  action,
  comment,
  actor: { id: name, name },
  createdAt,
});

function detail(extra: Partial<ContractDetailDto> = {}): ContractDetailDto {
  return {
    id: 'ct1',
    contractNo: 'CT-202611-0001',
    status: 'DRAFT',
    inquiry: { id: 'i1', formalNo: 'PJ-2026-006', title: '灯具支架询价' },
    supplier: { id: 's1', code: 'SUP10003', nameZh: '东莞五金制品有限公司', nameEn: null },
    amount: '77000.00',
    currency: 'CNY',
    deliveryDate: '2026-12-01',
    createdAt: '2026-11-06T02:00:00.000Z',
    updatedAt: '2026-11-06T02:00:00.000Z',
    deliveryPlace: null,
    paymentTerms: '月结 30 天',
    summary: null,
    remark: null,
    snapshot: snapshot(),
    attachments: [
      {
        id: 'fa',
        originalName: '技术协议.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        kind: 'ATTACHMENT',
        createdAt: '2026-11-06T03:00:00.000Z',
      },
    ],
    signedScan: null,
    signedAt: null,
    approvals: [],
    createdBy: { id: 'u2', name: '张伟' },
    allowedActions: ['edit', 'submit'],
    ...extra,
  };
}

/** 没有 contract.amount、supplier.contact 时接口返回的样子（R14-7） */
function maskedDetail(): ContractDetailDto {
  const d = detail({ amount: null, maskedFields: ['amount', 'contactEmail', 'contactPhone'] });
  const s = d.snapshot;
  s.quoteVersion.totalAmount = null;
  for (const line of s.quoteVersion.values.lines) {
    line.values.unit_price_incl_tax = null;
    line.values.total_price_incl_tax = null;
  }
  s.negotiation![0].lines[0].unitPriceInclTax = null;
  s.supplier.contactEmail = null;
  s.supplier.contactPhone = null;
  return d;
}

function me(): MeDto {
  return {
    user: {
      id: 'u2',
      username: 'buyer',
      name: '张伟',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions: ['inquiry:view', 'contract:view', 'contract:edit'],
    fieldPermissions: ['contract.amount'],
    dataScope: 'ALL',
  };
}

let router: Router;

async function mountAt(path: string, component: object, d: ContractDetailDto | Error): Promise<VueWrapper> {
  if (d instanceof Error) mocks.get.mockRejectedValue(d);
  else mocks.get.mockResolvedValue(d);
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me();
  const blank = { template: '<div />' };
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/contracts', name: 'contracts', component: blank },
      { path: '/contracts/:id', name: 'contract-detail', component: ContractDetailPage },
      { path: '/contracts/:id/print', name: 'contract-print', component: ContractPrintPage },
      { path: '/inquiries/:id', name: 'inquiry-detail', component: blank },
    ],
  });
  await router.push(path);
  const w = mount(component, {
    global: { plugins: [i18n, ElementPlus, pinia, router], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

const mountDetail = (d: ContractDetailDto | Error = detail()) =>
  mountAt('/contracts/ct1', ContractDetailPage, d);
const mountPrint = (d: ContractDetailDto = detail()) => mountAt('/contracts/ct1/print', ContractPrintPage, d);

const headerButtons = (w: VueWrapper) => w.findAll('.page-header .el-button').map((b) => b.text());
const button = (w: VueWrapper, text: string) => w.findAll('.el-button').find((b) => b.text() === text);
const messages = () => document.body.querySelector('.el-message')?.textContent ?? '';
/** 页面上有编辑、扫描件、预览三个对话框，取打开着的那个 */
const dialog = () =>
  [...document.body.querySelectorAll<HTMLElement>('.el-dialog')].find(
    (d) => d.closest<HTMLElement>('.el-overlay')?.style.display !== 'none',
  )!;
const dialogField = (label: string) =>
  [...dialog().querySelectorAll<HTMLElement>('.el-form-item')]
    .find((item) => item.querySelector('.el-form-item__label')?.textContent?.trim() === label)!
    .querySelector<HTMLInputElement>('input, textarea')!;
const dialogButton = (text: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')].find(
    (b) => b.textContent?.trim() === text,
  )!;

describe('ContractDetailPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    mocks.appConfig.mockResolvedValue(null);
    document.body.innerHTML = '';
  });

  it('R14-7 合同信息与定标快照：询价行与中标报价的关键列、议价改过的数量、合计、议价记录、附件；不做电子签的提示', async () => {
    const w = await mountDetail();
    expect(w.find('.page-header').text()).toContain('CT-202611-0001');
    expect(headerButtons(w)).toEqual(['返回', '打印', '编辑', '提交审核']);
    expect(w.text()).toContain('本期不做电子签');
    expect(w.text()).toContain('CNY 77,000.00');
    expect(w.text()).toContain('月结 30 天');

    const table = w.find('.el-table');
    const headers = table.findAll('th').map((th) => th.text());
    expect(headers).toEqual(
      expect.arrayContaining(['物料 / 规格型号', '数量', '含税单价', '税率(%)', '含税总价']),
    );
    // 非关键列（品牌）在展开行里，预填列（行号）不重复显示
    expect(headers).not.toContain('品牌');
    expect(headers.filter((h) => h === '行号')).toHaveLength(1);
    const rows = table.findAll('tbody tr');
    expect(rows[0].text()).toContain('M-001');
    expect(rows[0].text()).toContain('议价');
    expect(rows[0].text()).toContain('1200');
    expect(rows[0].text()).toContain('60,000.00');
    expect(rows[1].text()).not.toContain('议价');
    expect(rows[1].text()).toContain('500');
    expect(w.find('.total').text()).toContain('CNY 77,000.00');

    expect(w.text()).toContain('议价记录');
    expect(w.text()).toContain('方案说明：量大从优');
    expect(w.text()).toContain('50.0000');
    expect(w.text()).toContain('支架图纸.pdf');
    expect(w.text()).toContain('报价说明.pdf');
    expect(w.text()).toContain('技术协议.pdf');
    expect(w.text()).toContain('还没有上传签字扫描件');
    expect(w.find('a.el-button').attributes('href')).toBe('/contracts/ct1/print');
    w.unmount();
  });

  it('R14-7 没有 contract.amount 时合同金额、快照金额列、议价价格显示 🔒；没有 supplier.contact 时联系电话和邮箱显示 🔒', async () => {
    const w = await mountDetail(maskedDetail());
    expect(w.text()).not.toContain('77,000.00');
    expect(w.text()).not.toContain('60,000.00');
    expect(w.text()).not.toContain('50.0000');
    expect(w.text()).not.toContain('li@example.com');
    // 合同金额、联系电话、邮箱、两行 × (单价、总价)、合计、议价单价
    expect(w.findAll('.masked-value').length).toBe(9);
    w.unmount();
  });

  it('R14-2 编辑：对话框带出当前条款，保存时整体提交（附件按当前列表）', async () => {
    mocks.update.mockResolvedValue(detail({ deliveryPlace: '深圳仓' }));
    const w = await mountDetail();
    await button(w, '编辑')!.trigger('click');
    await flushPromises();
    expect(dialogField('付款方式').value).toBe('月结 30 天');
    const place = dialogField('交付地点');
    place.value = '深圳仓';
    place.dispatchEvent(new Event('input'));
    await flushPromises();
    dialogButton('保存').click();
    await flushPromises();
    expect(mocks.update).toHaveBeenCalledWith('ct1', {
      deliveryDate: '2026-12-01',
      deliveryPlace: '深圳仓',
      paymentTerms: '月结 30 天',
      summary: '',
      remark: '',
      attachmentFileIds: ['fa'],
    });
    expect(w.text()).toContain('深圳仓');
    w.unmount();
  });

  it('R14-3 提交审核：确认后提交，按返回的详情刷新状态和按钮', async () => {
    mocks.submit.mockResolvedValue(
      detail({
        status: 'PENDING_REVIEW',
        allowedActions: [],
        approvals: [approval('SUBMIT', 'SUBMIT', '张伟', '2026-11-07T02:00:00.000Z')],
      }),
    );
    const w = await mountDetail();
    await button(w, '提交审核')!.trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('不能再修改'), { type: 'info' });
    expect(mocks.submit).toHaveBeenCalledWith('ct1');
    expect(w.find('.page-header').text()).not.toContain('编辑');
    expect(w.text()).toContain('待审核');
    expect(w.text()).toContain('张伟 提交审核');
    w.unmount();
  });

  it('R14-4 审核：驳回必须填写意见，回到草稿后顶部提示驳回环节和意见、步骤条标红', async () => {
    const submitted = approval('SUBMIT', 'SUBMIT', '张伟', '2026-11-07T02:00:00.000Z');
    const rejected = approval(
      'REVIEW',
      'REJECT',
      '王五',
      '2026-11-07T03:00:00.000Z',
      '付款方式改为月结 60 天',
    );
    mocks.review.mockResolvedValue(detail({ approvals: [submitted, rejected] }));
    const w = await mountDetail(
      detail({ status: 'PENDING_REVIEW', allowedActions: ['review'], approvals: [submitted] }),
    );
    expect(w.text()).toContain('审批操作');
    expect(button(w, '审核通过')).toBeDefined();

    await button(w, '驳回')!.trigger('click');
    await flushPromises();
    expect(messages()).toContain('请填写驳回意见');
    expect(mocks.review).not.toHaveBeenCalled();

    await w.find('textarea').setValue('付款方式改为月结 60 天');
    await button(w, '驳回')!.trigger('click');
    await flushPromises();
    expect(mocks.review).toHaveBeenCalledWith('ct1', { action: 'REJECT', comment: '付款方式改为月结 60 天' });
    expect(w.text()).toContain(
      '合同在合同审核环节被 王五 驳回，修改后可以重新提交。驳回意见：付款方式改为月结 60 天',
    );
    expect(w.find('.el-step__head.is-error').exists()).toBe(true);
    expect(w.text()).toContain('王五 审核驳回');
    expect(w.text()).not.toContain('审批操作');
    w.unmount();
  });

  it('R14-4 批准环节：按钮是"批准"，通过时意见可以不填；已完成的步骤显示处理人', async () => {
    const records = [
      approval('SUBMIT', 'SUBMIT', '张伟', '2026-11-07T02:00:00.000Z'),
      approval('REVIEW', 'APPROVE', '王五', '2026-11-07T03:00:00.000Z'),
    ];
    mocks.approve.mockResolvedValue(
      detail({
        status: 'APPROVED',
        allowedActions: [],
        approvals: [...records, approval('APPROVE', 'APPROVE', '赵六', '2026-11-08T02:00:00.000Z')],
      }),
    );
    const w = await mountDetail(
      detail({ status: 'PENDING_APPROVAL', allowedActions: ['approve'], approvals: records }),
    );
    expect(button(w, '审核通过')).toBeUndefined();
    const steps = w.findAll('.el-step');
    expect(steps[1].text()).toContain('王五');
    expect(steps[2].text()).not.toContain('赵六');

    await button(w, '批准')!.trigger('click');
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('批准该合同'), { type: 'info' });
    expect(mocks.approve).toHaveBeenCalledWith('ct1', { action: 'APPROVE', comment: undefined });
    expect(w.findAll('.el-step__head.is-success')).toHaveLength(3);
    expect(w.findAll('.el-step')[2].text()).toContain('赵六');
    expect(w.text()).toContain('赵六 批准');
    w.unmount();
  });

  it('R14-6 已批准：显示签字扫描件和上传时间，可以替换；没有可执行动作时只有返回和打印', async () => {
    const scan = {
      id: 'fs',
      originalName: '合同签字版.pdf',
      mimeType: 'application/pdf',
      size: 4096,
      kind: 'ATTACHMENT' as const,
      createdAt: '2026-11-10T02:00:00.000Z',
    };
    const approved = detail({ status: 'APPROVED', signedScan: scan, signedAt: '2026-11-10T02:00:00.000Z' });
    const w = await mountDetail({ ...approved, allowedActions: ['uploadSignedScan'] });
    expect(headerButtons(w)).toEqual(['返回', '打印', '替换签字扫描件']);
    expect(w.text()).toContain('合同签字版.pdf');
    expect(w.text()).toContain('上传于 2026-11-10 10:00 北京时间');

    await button(w, '替换签字扫描件')!.trigger('click');
    await flushPromises();
    expect(dialog().textContent).toContain('当前扫描件：合同签字版.pdf');
    dialogButton('确定').click();
    await flushPromises();
    expect(messages()).toContain('请先上传文件');
    expect(mocks.signedScan).not.toHaveBeenCalled();
    w.unmount();

    const readonly = await mountDetail({ ...approved, allowedActions: [] });
    expect(headerButtons(readonly)).toEqual(['返回', '打印']);
    readonly.unmount();
  });

  it('不在数据权限内（404）显示合同不存在', async () => {
    const response = { status: 404, data: { code: 'NOT_FOUND', message: 'NOT_FOUND' } } as AxiosResponse;
    const w = await mountDetail(
      new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, response),
    );
    expect(w.text()).toContain('合同不存在或无权查看');
    w.unmount();
  });
});

describe('ContractPrintPage', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.appConfig.mockResolvedValue({
      company: {
        nameZh: '深圳光源科技有限公司',
        nameEn: 'Shenzhen Light Co.',
        address: '深圳市南山区科技园',
        phone: '0755-12345678',
      },
      uploadLimits: { specDocMaxMB: 20, imageMaxMB: 5, attachmentMaxMB: 20, imagesPerLine: 5 },
    });
  });

  it('R14-8 打印版：甲乙双方、快照明细（议价后的数量）、合计与大写金额、交付与付款条款、签字栏；未批准时注明仅供核对', async () => {
    const w = await mountPrint();
    const text = w.find('.sheet').text();
    expect(text).toContain('采购合同');
    expect(text).toContain('合同号：CT-202611-0001');
    expect(text).toContain('询价单号：PJ-2026-006');
    expect(text).toContain('本合同尚未批准，仅供核对');
    expect(text).toContain('深圳光源科技有限公司');
    expect(text).toContain('深圳市南山区科技园');
    expect(text).toContain('SUP10003 东莞五金制品有限公司');
    expect(text).toContain('li@example.com');

    const rows = w.findAll('.items tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].findAll('td').map((td) => td.text())).toEqual([
      '1',
      '铝支架M-001',
      '200mm 阳极氧化',
      '1200',
      '个',
      '50.0000',
      '60,000.00',
    ]);
    expect(w.find('.items tfoot').text()).toContain('77,000.00');
    expect(text).toContain('合计金额（大写）：柒万柒仟元整');
    expect(text).toContain('2026-12-01');
    expect(text).toContain('月结 30 天');
    expect(text).toContain('甲方（盖章）');
    expect(text).toContain('乙方（盖章）');

    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await button(w, '打印')!.trigger('click');
    expect(print).toHaveBeenCalled();
    print.mockRestore();
    w.unmount();
  });

  it('R14-8 已批准不再提示；没有 contract.amount 时金额显示 🔒，不显示大写金额', async () => {
    const approved = await mountPrint(detail({ status: 'APPROVED' }));
    expect(approved.text()).not.toContain('仅供核对');
    approved.unmount();

    const masked = await mountPrint(maskedDetail());
    expect(masked.text()).not.toContain('77,000.00');
    expect(masked.text()).not.toContain('大写');
    expect(masked.findAll('.items .masked-value')).toHaveLength(5);
    masked.unmount();
  });
});
