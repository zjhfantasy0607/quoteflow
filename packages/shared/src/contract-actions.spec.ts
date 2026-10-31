import { describe, expect, it } from 'vitest';
import { computeContractActions } from './contract-actions';
import { PRESET_ROLES } from './roles';
import { contractDecisionSchema, contractListQuerySchema, updateContractSchema } from './schemas/contracts';

const perms = (role: string) => new Set<string>(PRESET_ROLES.find((r) => r.code === role)!.permissions);
const statuses = ['DRAFT', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'APPROVED'] as const;
const actionsOf = (role: string) =>
  Object.fromEntries(statuses.map((status) => [status, computeContractActions({ status }, perms(role))]));

describe('M14 合同动作（05 §6）', () => {
  it('R14-1 采购员编辑、提交、上传扫描件；采购主管另能审核；合同批准人只能批准；管理员只能看', () => {
    expect(actionsOf('BUYER')).toEqual({
      DRAFT: ['edit', 'submit'],
      PENDING_REVIEW: [],
      PENDING_APPROVAL: [],
      APPROVED: ['uploadSignedScan'],
    });
    expect(actionsOf('PURCHASE_MANAGER')).toMatchObject({ PENDING_REVIEW: ['review'], PENDING_APPROVAL: [] });
    expect(actionsOf('CONTRACT_APPROVER')).toEqual({
      DRAFT: [],
      PENDING_REVIEW: [],
      PENDING_APPROVAL: ['approve'],
      APPROVED: [],
    });
    expect(Object.values(actionsOf('ADMIN')).flat()).toEqual([]);
  });

  it('R14-2 编辑：交付日期必须是真实日期，空的清空；附件去重', () => {
    expect(
      updateContractSchema.parse({
        deliveryDate: '2026-12-31',
        deliveryPlace: ' 深圳宝安 ',
        paymentTerms: '',
        attachmentFileIds: ['f1', 'f1', 'f2'],
      }),
    ).toEqual({
      deliveryDate: '2026-12-31',
      deliveryPlace: '深圳宝安',
      paymentTerms: undefined,
      summary: undefined,
      remark: undefined,
      attachmentFileIds: ['f1', 'f2'],
    });
    expect(updateContractSchema.parse({ deliveryDate: '' }).deliveryDate).toBeUndefined();
    expect(updateContractSchema.safeParse({ deliveryDate: '2026-02-30' }).success).toBe(false);
    expect(updateContractSchema.safeParse({ deliveryDate: '2026/12/31' }).success).toBe(false);
  });

  it('R14-4 审核、批准的决定只能是通过或驳回；列表按状态筛选', () => {
    expect(contractDecisionSchema.parse({ action: 'REJECT', comment: ' 交期太晚 ' })).toEqual({
      action: 'REJECT',
      comment: '交期太晚',
    });
    expect(contractDecisionSchema.safeParse({ action: 'SUBMIT' }).success).toBe(false);
    expect(contractListQuerySchema.parse({ status: 'PENDING_REVIEW' })).toMatchObject({
      status: 'PENDING_REVIEW',
      page: 1,
      pageSize: 20,
    });
    expect(contractListQuerySchema.safeParse({ status: 'VOID' }).success).toBe(false);
  });
});
