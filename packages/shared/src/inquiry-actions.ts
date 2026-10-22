import { InquiryDocStatus, RoundStatus } from './enums';
import type { PermissionCode } from './permissions';

/** 询价单、轮次详情的 allowedActions（docs/03 §6）：前端只按它显示操作按钮 */
export const INQUIRY_ACTIONS = [
  'edit',
  'submit',
  'approve',
  'reject',
  'cancel',
  'editInvitees',
  'publish',
  'lateInvite',
  'remind',
  'extendDeadline',
  'closeEarly',
  'open',
  'evaluate',
  'shortlist',
  'award',
  'createChangeRound',
  'exportMatrix',
  'viewAccessLog',
] as const;
export type InquiryAction = (typeof INQUIRY_ACTIONS)[number];

export interface InquiryActionContext {
  docStatus: InquiryDocStatus;
  currentRoundNo: number;
  currentRoundStatus: RoundStatus;
}

/** 后端传 AuthUser.permissions（Set），测试里也可以直接 new Set([...]) */
export interface PermissionChecker {
  has(code: string): boolean;
}

/** 第 1 轮还没发布 */
function firstRoundUnpublished(ctx: InquiryActionContext): boolean {
  return ctx.currentRoundNo === 1 && ctx.currentRoundStatus === RoundStatus.DRAFT;
}

/**
 * I-4：第 1 轮的询价行和附件只在询价单为草稿时可以编辑（提交审批后冻结）。
 * 第 N 轮（规格变更）的编辑条件由 M13 补充。
 */
export function isRoundEditable(
  docStatus: InquiryDocStatus,
  round: { roundNo: number; status: RoundStatus },
): boolean {
  return round.roundNo === 1 && round.status === RoundStatus.DRAFT && docStatus === InquiryDocStatus.DRAFT;
}

/**
 * 按 05 §1 的状态表和功能权限算出当前用户可以执行的动作；动作接口用同一个函数复核，
 * 保证"按钮显示"和"接口放行"一致。数据权限不在这里判断（范围外的单据直接 404）。
 * M06 覆盖 edit、submit、approve、reject 和发布前的 cancel，其余动作由 M07 起的模块补充。
 */
export function computeInquiryActions(ctx: InquiryActionContext, perms: PermissionChecker): InquiryAction[] {
  const can = (code: PermissionCode) => perms.has(code);
  const actions: InquiryAction[] = [];
  const draft = ctx.docStatus === InquiryDocStatus.DRAFT;

  // 编辑页包含表头、询价行（inquiry:create）和附件（inquiry:spec），有其一即可进入
  if (draft && firstRoundUnpublished(ctx) && (can('inquiry:create') || can('inquiry:spec')))
    actions.push('edit');
  if (draft && can('inquiry:submit')) actions.push('submit');
  if (ctx.docStatus === InquiryDocStatus.PENDING_APPROVAL && can('inquiry:approve'))
    actions.push('approve', 'reject');
  // R06-9：本模块只覆盖第 1 轮发布前的取消，发布后的取消由 M07 扩展
  const cancellable: InquiryDocStatus[] = [
    InquiryDocStatus.DRAFT,
    InquiryDocStatus.PENDING_APPROVAL,
    InquiryDocStatus.APPROVED,
  ];
  if (cancellable.includes(ctx.docStatus) && firstRoundUnpublished(ctx) && can('inquiry:cancel'))
    actions.push('cancel');
  return actions;
}
