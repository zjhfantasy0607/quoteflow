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

/** 门户报价单详情的 allowedActions（docs/03 §6），M09 起由 computePortalQuoteActions() 生成 */
export const PORTAL_QUOTE_ACTIONS = [
  'saveDraft',
  'submit',
  'decline',
  'downloadTemplate',
  'importExcel',
  'respondNegotiation',
] as const;
export type PortalQuoteAction = (typeof PORTAL_QUOTE_ACTIONS)[number];

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
 * 按 05 §1、§3 的状态表和功能权限算出当前用户可以执行的动作；动作接口用同一个函数复核，
 * 保证"按钮显示"和"接口放行"一致。数据权限不在这里判断（范围外的单据直接 404）。
 * 轮次类动作（发布、补充邀请、催报、延期）都针对当前轮次。
 * M06 覆盖 edit、submit、approve、reject、发布前的 cancel；M07 覆盖 editInvitees、publish、lateInvite、
 * remind、extendDeadline 和发布后的 cancel；M08 覆盖 viewAccessLog；其余动作由 M10 起的模块补充。
 */
export function computeInquiryActions(ctx: InquiryActionContext, perms: PermissionChecker): InquiryAction[] {
  const can = (code: PermissionCode) => perms.has(code);
  const actions: InquiryAction[] = [];
  const draft = ctx.docStatus === InquiryDocStatus.DRAFT;
  const approved = ctx.docStatus === InquiryDocStatus.APPROVED;
  const unpublished = firstRoundUnpublished(ctx);
  const round = ctx.currentRoundStatus;

  // 编辑页包含表头、询价行（inquiry:create）和附件（inquiry:spec），有其一即可进入
  if (draft && unpublished && (can('inquiry:create') || can('inquiry:spec'))) actions.push('edit');
  if (draft && can('inquiry:submit')) actions.push('submit');
  if (ctx.docStatus === InquiryDocStatus.PENDING_APPROVAL && can('inquiry:approve'))
    actions.push('approve', 'reject');
  // R07-2：第 1 轮发布前（草稿或已通过，待审批时不能改）可以维护受邀名单；变更轮次草稿期间的维护由 M13 补充
  if ((draft || approved) && unpublished && can('inquiry:invite')) actions.push('editInvitees');
  // R07-3：审批通过后才能发布
  if (approved && unpublished && can('inquiry:publish')) actions.push('publish');
  // R07-7、R07-8：补充邀请、催报只在等待报价时
  if (approved && round === RoundStatus.WAITING_QUOTES) {
    if (can('inquiry:invite')) actions.push('lateInvite');
    if (can('inquiry:remind')) actions.push('remind');
  }
  // R07-10：报价完成后也能延期，回到等待报价
  const extendable: RoundStatus[] = [RoundStatus.WAITING_QUOTES, RoundStatus.QUOTES_CLOSED];
  if (approved && extendable.includes(round) && can('inquiry:deadline')) actions.push('extendDeadline');
  // R06-9、R07-11：没取消、当前轮次还没评标完成都能取消
  const cancellable: InquiryDocStatus[] = [
    InquiryDocStatus.DRAFT,
    InquiryDocStatus.PENDING_APPROVAL,
    InquiryDocStatus.APPROVED,
  ];
  if (cancellable.includes(ctx.docStatus) && round !== RoundStatus.EVALUATED && can('inquiry:cancel'))
    actions.push('cancel');
  // R08-4：规格下载日志，任何状态都能看（内部用户的访问也记录）
  if (can('inquiry:accessLog')) actions.push('viewAccessLog');
  return actions;
}
