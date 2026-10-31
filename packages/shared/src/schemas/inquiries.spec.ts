import { describe, expect, it } from 'vitest';
import {
  computeChangeRoundActions,
  computeInquiryActions,
  isInquiryReadonly,
  isRoundEditable,
  type InquiryActionContext,
} from '../inquiry-actions';
import { PRESET_ROLES } from '../roles';
import { ROUND_TERMINAL_STATUSES, ROUND_TRANSITIONS } from '../status';
import {
  awardRoundSchema,
  changeRoundSchema,
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
  /** 与状态有关的动作（下载日志在任何状态都能看，单独测） */
  const stateActions = (c: ReturnType<typeof ctx>, role: string) =>
    computeInquiryActions(c, perms(role)).filter((a) => a !== 'viewAccessLog');

  it('草稿：PD、采购员可以编辑和提交，采购员还能维护受邀名单；采购主管还能取消', () => {
    expect(stateActions(ctx('DRAFT'), 'PD')).toEqual(['edit', 'submit']);
    expect(stateActions(ctx('DRAFT'), 'BUYER')).toEqual(['edit', 'submit', 'editInvitees']);
    expect(stateActions(ctx('DRAFT'), 'PURCHASE_MANAGER')).toEqual([
      'edit',
      'submit',
      'editInvitees',
      'cancel',
    ]);
  });

  it('待审批：只有采购主管能通过、驳回、取消；R07-2 待审批时不能改受邀名单', () => {
    expect(stateActions(ctx('PENDING_APPROVAL'), 'PD')).toEqual([]);
    expect(stateActions(ctx('PENDING_APPROVAL'), 'BUYER')).toEqual([]);
    expect(stateActions(ctx('PENDING_APPROVAL'), 'PURCHASE_MANAGER')).toEqual([
      'approve',
      'reject',
      'cancel',
    ]);
  });

  it('R07-2、R07-3 已通过、未发布：采购员维护名单和发布，采购主管还能取消', () => {
    expect(stateActions(ctx('APPROVED'), 'PD')).toEqual([]);
    expect(stateActions(ctx('APPROVED'), 'BUYER')).toEqual(['editInvitees', 'publish']);
    expect(stateActions(ctx('APPROVED'), 'PURCHASE_MANAGER')).toEqual(['editInvitees', 'publish', 'cancel']);
  });

  it('R07-7、R07-8、R07-10 等待报价：补充邀请、催报、延期；名单只读，不能再发布（M13 起可以发起规格变更）', () => {
    expect(stateActions(ctx('APPROVED', 'WAITING_QUOTES'), 'PD')).toEqual(['createChangeRound']);
    expect(stateActions(ctx('APPROVED', 'WAITING_QUOTES'), 'BUYER')).toEqual([
      'lateInvite',
      'remind',
      'extendDeadline',
      'createChangeRound',
    ]);
    expect(stateActions(ctx('APPROVED', 'WAITING_QUOTES'), 'PURCHASE_MANAGER')).toEqual([
      'lateInvite',
      'remind',
      'extendDeadline',
      'closeEarly',
      'createChangeRound',
      'cancel',
    ]);
  });

  it('R07-10 R10-3 报价完成后只能延期、开标（和取消），不能补充邀请、催报', () => {
    expect(stateActions(ctx('APPROVED', 'QUOTES_CLOSED'), 'BUYER')).toEqual([
      'extendDeadline',
      'createChangeRound',
    ]);
    expect(stateActions(ctx('APPROVED', 'QUOTES_CLOSED'), 'PURCHASE_MANAGER')).toEqual([
      'extendDeadline',
      'open',
      'createChangeRound',
      'cancel',
    ]);
  });

  it('R10-2 R10-3 R10-8 提前截止只在等待报价、开标只在报价完成时出现，都要 inquiry:open', () => {
    const rounds = ['DRAFT', 'WAITING_QUOTES', 'QUOTES_CLOSED', 'OPENED', 'EVALUATED'] as const;
    const has = (round: (typeof rounds)[number], role: string, action: string) =>
      computeInquiryActions(ctx('APPROVED', round), perms(role)).includes(action as never);
    expect(rounds.filter((r) => has(r, 'PURCHASE_MANAGER', 'closeEarly'))).toEqual(['WAITING_QUOTES']);
    expect(rounds.filter((r) => has(r, 'PURCHASE_MANAGER', 'open'))).toEqual(['QUOTES_CLOSED']);
    for (const round of rounds) {
      expect(has(round, 'BUYER', 'closeEarly') || has(round, 'BUYER', 'open')).toBe(false);
    }
    expect(computeInquiryActions(ctx('CANCELLED', 'QUOTES_CLOSED'), perms('PURCHASE_MANAGER'))).not.toContain(
      'open',
    );
  });

  it('R07-11 发布后也能取消，评标完成后、已取消的不能', () => {
    expect(stateActions(ctx('APPROVED', 'OPENED'), 'PURCHASE_MANAGER')).toContain('cancel');
    expect(stateActions(ctx('APPROVED', 'EVALUATED'), 'PURCHASE_MANAGER')).not.toContain('cancel');
    expect(stateActions(ctx('CANCELLED', 'CANCELLED'), 'PURCHASE_MANAGER')).toEqual([]);
  });

  it('只有管理员的查看权限时没有任何动作', () => {
    for (const round of ['DRAFT', 'WAITING_QUOTES', 'QUOTES_CLOSED'] as const) {
      expect(computeInquiryActions(ctx('APPROVED', round), perms('ADMIN'))).toEqual([]);
    }
  });

  it('R08-4 有 inquiry:accessLog 的人在任何状态都能看下载日志', () => {
    const states = [ctx('DRAFT'), ctx('APPROVED', 'WAITING_QUOTES'), ctx('CANCELLED', 'CANCELLED')];
    for (const c of states) {
      expect(computeInquiryActions(c, perms('BUYER'))).toContain('viewAccessLog');
      expect(computeInquiryActions(c, perms('PURCHASE_MANAGER'))).toContain('viewAccessLog');
      expect(computeInquiryActions(c, perms('PD'))).not.toContain('viewAccessLog');
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

describe('M12 定标与只读', () => {
  const rounds = ['DRAFT', 'WAITING_QUOTES', 'QUOTES_CLOSED', 'OPENED', 'EVALUATED'] as const;

  it('R12-1 定标只在评标中（OPENED）出现，要 inquiry:award（采购主管有，采购员没有）', () => {
    const has = (round: (typeof rounds)[number], role: string) =>
      computeInquiryActions(ctx('APPROVED', round), perms(role)).includes('award');
    expect(rounds.filter((r) => has(r, 'PURCHASE_MANAGER'))).toEqual(['OPENED']);
    expect(rounds.some((r) => has(r, 'BUYER'))).toBe(false);
    expect(computeInquiryActions(ctx('CANCELLED', 'OPENED'), perms('PURCHASE_MANAGER'))).not.toContain(
      'award',
    );
  });

  it('R12-8 评标完成或取消后只读：只剩查看类动作', () => {
    expect(isInquiryReadonly(ctx('APPROVED', 'EVALUATED'))).toBe(true);
    expect(isInquiryReadonly(ctx('CANCELLED', 'CANCELLED'))).toBe(true);
    expect(isInquiryReadonly(ctx('CANCELLED', 'DRAFT'))).toBe(true);
    for (const round of ['DRAFT', 'WAITING_QUOTES', 'QUOTES_CLOSED', 'OPENED'] as const) {
      expect(isInquiryReadonly(ctx('APPROVED', round))).toBe(false);
    }
    expect(isInquiryReadonly(ctx('DRAFT'))).toBe(false);
    expect(computeInquiryActions(ctx('APPROVED', 'EVALUATED'), perms('PURCHASE_MANAGER'))).toEqual([
      'evaluate',
      'exportMatrix',
      'viewAccessLog',
    ]);
  });

  it('定标说明可选，空白视为没填', () => {
    expect(awardRoundSchema.parse({ quoteId: 'q1', comment: '  ' })).toEqual({
      quoteId: 'q1',
      comment: undefined,
    });
    expect(awardRoundSchema.parse({ quoteId: 'q1', comment: ' 价格最低 ' }).comment).toBe('价格最低');
    expect(awardRoundSchema.safeParse({}).success).toBe(false);
    expect(awardRoundSchema.safeParse({ quoteId: 'q1', comment: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('M13 规格变更', () => {
  const rounds = ['DRAFT', 'WAITING_QUOTES', 'QUOTES_CLOSED', 'OPENED', 'EVALUATED'] as const;
  const withDraft = (round: (typeof rounds)[number], draftRoundNo: number | null) => ({
    ...ctx('APPROVED', round),
    draftRoundNo,
  });

  it('R13-1 等待报价、报价完成、开标中可以发起变更（inquiry:changeSpec）；已有变更草稿时不能再发起', () => {
    const has = (round: (typeof rounds)[number], role: string, draft: number | null = null) =>
      computeInquiryActions(withDraft(round, draft), perms(role)).includes('createChangeRound');
    expect(rounds.filter((r) => has(r, 'BUYER'))).toEqual(['WAITING_QUOTES', 'QUOTES_CLOSED', 'OPENED']);
    expect(rounds.filter((r) => has(r, 'PD'))).toEqual(['WAITING_QUOTES', 'QUOTES_CLOSED', 'OPENED']);
    expect(rounds.some((r) => has(r, 'CONTRACT_APPROVER'))).toBe(false);
    expect(has('WAITING_QUOTES', 'BUYER', 2)).toBe(false);
    expect(computeInquiryActions(ctx('DRAFT'), perms('BUYER'))).not.toContain('createChangeRound');
    expect(computeInquiryActions(ctx('CANCELLED', 'OPENED'), perms('BUYER'))).not.toContain(
      'createChangeRound',
    );
  });

  it('05 §3 有变更草稿时可以维护受邀名单（只影响下一轮）；B-52 有变更草稿时不能定标', () => {
    const buyer = (draft: number | null) =>
      computeInquiryActions(withDraft('WAITING_QUOTES', draft), perms('BUYER'));
    expect(buyer(null)).not.toContain('editInvitees');
    expect(buyer(2)).toContain('editInvitees');
    const manager = (draft: number | null) =>
      computeInquiryActions(withDraft('OPENED', draft), perms('PURCHASE_MANAGER'));
    expect(manager(null)).toContain('award');
    expect(manager(2)).not.toContain('award');
  });

  it('R13-2 R13-3 R13-7 变更草稿的动作：采购员全有；PD 能改行、附件和变更说明，不能发布、改名单；询价完成后没有', () => {
    expect(computeChangeRoundActions(ctx('APPROVED', 'WAITING_QUOTES'), perms('BUYER'))).toEqual([
      'edit',
      'editInvitees',
      'publish',
      'editChangeRound',
      'discardChangeRound',
    ]);
    expect(computeChangeRoundActions(ctx('APPROVED', 'OPENED'), perms('PD'))).toEqual([
      'edit',
      'editChangeRound',
      'discardChangeRound',
    ]);
    expect(computeChangeRoundActions(ctx('APPROVED', 'EVALUATED'), perms('BUYER'))).toEqual([]);
    expect(computeChangeRoundActions(ctx('CANCELLED', 'CANCELLED'), perms('BUYER'))).toEqual([]);
  });

  it('R13-2 变更草稿（第 N 轮）在询价单已通过时可以编辑；发布后、作废后都不能', () => {
    expect(isRoundEditable('APPROVED', { roundNo: 2, status: 'DRAFT' })).toBe(true);
    expect(isRoundEditable('DRAFT', { roundNo: 2, status: 'DRAFT' })).toBe(false);
    expect(isRoundEditable('APPROVED', { roundNo: 2, status: 'WAITING_QUOTES' })).toBe(false);
    expect(isRoundEditable('APPROVED', { roundNo: 1, status: 'SUPERSEDED' })).toBe(false);
  });

  it('变更说明可以留空（发布时才必填）；原因最多 500、内容最多 1000', () => {
    expect(changeRoundSchema.parse({})).toEqual({ changeReason: undefined, changeSummary: undefined });
    expect(changeRoundSchema.parse({ changeReason: ' Ra80 → Ra90 ', changeSummary: '' })).toEqual({
      changeReason: 'Ra80 → Ra90',
      changeSummary: undefined,
    });
    expect(changeRoundSchema.safeParse({ changeReason: 'x'.repeat(501) }).success).toBe(false);
    expect(changeRoundSchema.safeParse({ changeSummary: 'x'.repeat(1001) }).success).toBe(false);
  });
});
