import { describe, expect, it } from 'vitest';
import { computeInquiryActions, isRoundEditable, type InquiryActionContext } from '../inquiry-actions';
import { PRESET_ROLES } from '../roles';
import { ROUND_TERMINAL_STATUSES, ROUND_TRANSITIONS } from '../status';
import {
  copyLineFilesSchema,
  createInquirySchema,
  createLineSchema,
  inviteeCandidatesQuerySchema,
  lateInviteSchema,
  publishRoundSchema,
  quantitySchema,
  rejectInquirySchema,
  remindQuotesSchema,
  updateInviteesSchema,
  updateLineSchema,
} from './inquiries';

const perms = (role: string) => new Set<string>(PRESET_ROLES.find((r) => r.code === role)!.permissions);

const ctx = (
  docStatus: InquiryActionContext['docStatus'],
  currentRoundStatus: InquiryActionContext['currentRoundStatus'] = 'DRAFT',
) => ({
  docStatus,
  currentRoundNo: 1,
  currentRoundStatus,
});

describe('R06-2 数量', () => {
  it('大于 0、最多 4 位小数，输出字符串', () => {
    expect(quantitySchema.parse('200000')).toBe('200000');
    expect(quantitySchema.parse(' 12.5 ')).toBe('12.5');
    expect(quantitySchema.parse(0.0001)).toBe('0.0001');
    expect(quantitySchema.parse('99999999999999.9999')).toBe('99999999999999.9999');
    expect(quantitySchema.parse('0200.50')).toBe('200.5');
  });

  it('0、负数、5 位小数、科学计数法、超过 14 位整数都不行', () => {
    for (const bad of ['0', '0.0000', '-1', '1.23456', '1e3', '', 'abc', '123456789012345', 1e-7]) {
      expect(quantitySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('R06-1 表头', () => {
  it('项目号、标题、材料类别、币种必填；项目号最多 50', () => {
    const ok = createInquirySchema.parse({
      projectNo: ' PJ-1 ',
      title: 'T',
      materialCategoryId: 'c1',
      currency: 'CNY',
    });
    expect(ok).toEqual({
      projectNo: 'PJ-1',
      title: 'T',
      materialCategoryId: 'c1',
      currency: 'CNY',
      pdUserId: null,
    });
    expect(
      createInquirySchema.safeParse({ title: 'T', materialCategoryId: 'c1', currency: 'CNY' }).success,
    ).toBe(false);
    expect(
      createInquirySchema.safeParse({
        projectNo: 'x'.repeat(51),
        title: 'T',
        materialCategoryId: 'c1',
        currency: 'CNY',
      }).success,
    ).toBe(false);
  });

  it('R06-7 驳回意见在 schema 里可以为空（由服务端返回 INQUIRY_REJECT_COMMENT_REQUIRED）', () => {
    expect(rejectInquirySchema.parse({ comment: '  ' })).toEqual({ comment: undefined });
  });
});

describe('R06-2 询价行', () => {
  it('材料行只要材料和数量；手工行名称、规格、单位、分类必填', () => {
    expect(createLineSchema.parse({ source: 'MATERIAL', materialId: 'm1', quantity: '10' })).toMatchObject({
      source: 'MATERIAL',
      materialId: 'm1',
      quantity: '10',
    });
    const manual = {
      source: 'MANUAL',
      nameZh: '灯珠',
      spec: '2835',
      unitCode: 'PCS',
      categoryId: 'c1',
      quantity: 1,
    };
    expect(createLineSchema.parse({ ...manual, materialCode: ' abc-1 ' })).toMatchObject({
      materialCode: 'ABC-1',
    });
    for (const key of ['nameZh', 'spec', 'unitCode', 'categoryId']) {
      expect(createLineSchema.safeParse({ ...manual, [key]: undefined }).success).toBe(false);
    }
  });

  it('更新材料行时不接受材料字段之外的必填项', () => {
    expect(updateLineSchema.parse({ source: 'MATERIAL', quantity: '3', nameZh: 'x' })).toEqual({
      source: 'MATERIAL',
      quantity: '3',
      brand: undefined,
      drawingRef: undefined,
      remark: undefined,
    });
  });

  it('复制到其他行：目标行去重', () => {
    expect(copyLineFilesSchema.parse({ fromLineId: 'a', toLineIds: ['b', 'b', 'c'] }).toLineIds).toEqual([
      'b',
      'c',
    ]);
  });
});

describe('allowedActions（03 §6）', () => {
  it('草稿：PD、采购员可以编辑和提交，采购员还能维护受邀名单；采购主管还能取消', () => {
    expect(computeInquiryActions(ctx('DRAFT'), perms('PD'))).toEqual(['edit', 'submit']);
    expect(computeInquiryActions(ctx('DRAFT'), perms('BUYER'))).toEqual(['edit', 'submit', 'editInvitees']);
    expect(computeInquiryActions(ctx('DRAFT'), perms('PURCHASE_MANAGER'))).toEqual([
      'edit',
      'submit',
      'editInvitees',
      'cancel',
    ]);
  });

  it('待审批：只有采购主管能通过、驳回、取消；R07-2 待审批时不能改受邀名单', () => {
    expect(computeInquiryActions(ctx('PENDING_APPROVAL'), perms('PD'))).toEqual([]);
    expect(computeInquiryActions(ctx('PENDING_APPROVAL'), perms('BUYER'))).toEqual([]);
    expect(computeInquiryActions(ctx('PENDING_APPROVAL'), perms('PURCHASE_MANAGER'))).toEqual([
      'approve',
      'reject',
      'cancel',
    ]);
  });

  it('R07-2、R07-3 已通过、未发布：采购员维护名单和发布，采购主管还能取消', () => {
    expect(computeInquiryActions(ctx('APPROVED'), perms('PD'))).toEqual([]);
    expect(computeInquiryActions(ctx('APPROVED'), perms('BUYER'))).toEqual(['editInvitees', 'publish']);
    expect(computeInquiryActions(ctx('APPROVED'), perms('PURCHASE_MANAGER'))).toEqual([
      'editInvitees',
      'publish',
      'cancel',
    ]);
  });

  it('R07-7、R07-8、R07-10 等待报价：补充邀请、催报、延期；名单只读，不能再发布', () => {
    expect(computeInquiryActions(ctx('APPROVED', 'WAITING_QUOTES'), perms('PD'))).toEqual([]);
    expect(computeInquiryActions(ctx('APPROVED', 'WAITING_QUOTES'), perms('BUYER'))).toEqual([
      'lateInvite',
      'remind',
      'extendDeadline',
    ]);
    expect(computeInquiryActions(ctx('APPROVED', 'WAITING_QUOTES'), perms('PURCHASE_MANAGER'))).toEqual([
      'lateInvite',
      'remind',
      'extendDeadline',
      'cancel',
    ]);
  });

  it('R07-10 报价完成后只能延期（和取消），不能补充邀请、催报', () => {
    expect(computeInquiryActions(ctx('APPROVED', 'QUOTES_CLOSED'), perms('BUYER'))).toEqual([
      'extendDeadline',
    ]);
    expect(computeInquiryActions(ctx('APPROVED', 'QUOTES_CLOSED'), perms('PURCHASE_MANAGER'))).toEqual([
      'extendDeadline',
      'cancel',
    ]);
  });

  it('R07-11 发布后也能取消，评标完成后、已取消的不能', () => {
    expect(computeInquiryActions(ctx('APPROVED', 'OPENED'), perms('PURCHASE_MANAGER'))).toContain('cancel');
    expect(computeInquiryActions(ctx('APPROVED', 'EVALUATED'), perms('PURCHASE_MANAGER'))).not.toContain(
      'cancel',
    );
    expect(computeInquiryActions(ctx('CANCELLED', 'CANCELLED'), perms('PURCHASE_MANAGER'))).toEqual([]);
  });

  it('只有管理员的查看权限时没有任何动作', () => {
    for (const round of ['DRAFT', 'WAITING_QUOTES', 'QUOTES_CLOSED'] as const) {
      expect(computeInquiryActions(ctx('APPROVED', round), perms('ADMIN'))).toEqual([]);
    }
  });

  it('I-4 第 1 轮只在草稿时可以编辑', () => {
    expect(isRoundEditable('DRAFT', { roundNo: 1, status: 'DRAFT' })).toBe(true);
    expect(isRoundEditable('PENDING_APPROVAL', { roundNo: 1, status: 'DRAFT' })).toBe(false);
    expect(isRoundEditable('APPROVED', { roundNo: 1, status: 'DRAFT' })).toBe(false);
  });
});

describe('R07-12 轮次状态流转表（05 §3）', () => {
  it('发布只能从 DRAFT；延期可以从等待报价或报价完成回到等待报价', () => {
    expect(ROUND_TRANSITIONS.publish).toEqual({ from: ['DRAFT'], to: 'WAITING_QUOTES' });
    expect(ROUND_TRANSITIONS.extendDeadline).toEqual({
      from: ['WAITING_QUOTES', 'QUOTES_CLOSED'],
      to: 'WAITING_QUOTES',
    });
  });

  it('终态不能再迁移到任何状态', () => {
    for (const { from } of Object.values(ROUND_TRANSITIONS)) {
      for (const terminal of ROUND_TERMINAL_STATUSES) expect(from).not.toContain(terminal);
    }
  });

  it('取消覆盖全部非终态', () => {
    expect([...ROUND_TRANSITIONS.cancel.from].sort()).toEqual(
      ['DRAFT', 'OPENED', 'QUOTES_CLOSED', 'WAITING_QUOTES'].sort(),
    );
  });
});

describe('M07 受邀名单与发布', () => {
  it('R07-1 候选筛选：分类多选逗号分隔、去重', () => {
    const q = inviteeCandidatesQuerySchema.parse({
      categoryCodes: 'STRATEGIC, EXCELLENT,STRATEGIC',
      keyword: ' ',
    });
    expect(q).toMatchObject({ categoryCodes: ['STRATEGIC', 'EXCELLENT'], page: 1, pageSize: 20 });
    expect(q.keyword).toBeUndefined();
  });

  it('受邀名单整体替换可以为空，供应商去重；补充邀请、催报至少一个', () => {
    expect(updateInviteesSchema.parse({ supplierIds: [] }).supplierIds).toEqual([]);
    expect(updateInviteesSchema.parse({ supplierIds: ['a', 'b', 'a'] }).supplierIds).toEqual(['a', 'b']);
    expect(lateInviteSchema.safeParse({ supplierIds: [] }).success).toBe(false);
    expect(remindQuotesSchema.safeParse({ quoteIds: [] }).success).toBe(false);
    expect(remindQuotesSchema.parse({ quoteIds: ['q1', 'q1'] }).quoteIds).toEqual(['q1']);
  });

  it('截止时间接受 UTC 或带时区偏移的 ISO 8601，输出 Date', () => {
    const utc = publishRoundSchema.parse({ deadline: '2026-11-20T09:00:00.000Z' }).deadline;
    const offset = publishRoundSchema.parse({ deadline: '2026-11-20T17:00:00+08:00' }).deadline;
    expect(utc).toBeInstanceOf(Date);
    expect(offset.toISOString()).toBe(utc.toISOString());
    expect(publishRoundSchema.safeParse({ deadline: '2026-11-20 17:00' }).success).toBe(false);
    expect(publishRoundSchema.safeParse({}).success).toBe(false);
  });
});
