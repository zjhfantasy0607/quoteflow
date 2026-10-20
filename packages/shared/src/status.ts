import { InquiryDocStatus, RoundStatus } from './enums';

// 询价单显示状态与列表页签（docs/05-状态机与权限.md §2）。
export const InquiryDisplayStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  READY: 'READY',
  WAITING_QUOTES: 'WAITING_QUOTES',
  QUOTES_CLOSED: 'QUOTES_CLOSED',
  OPENED: 'OPENED',
  EVALUATED: 'EVALUATED',
  CANCELLED: 'CANCELLED',
} as const;
export type InquiryDisplayStatus = (typeof InquiryDisplayStatus)[keyof typeof InquiryDisplayStatus];

export const INQUIRY_TABS = [
  'draft',
  'pending',
  'ready',
  'quoting',
  'closed',
  'evaluating',
  'completed',
  'cancelled',
] as const;
export type InquiryTab = (typeof INQUIRY_TABS)[number];

export function inquiryDisplayStatus(
  docStatus: InquiryDocStatus,
  currentRoundStatus: RoundStatus,
): InquiryDisplayStatus {
  switch (docStatus) {
    case InquiryDocStatus.DRAFT:
      return InquiryDisplayStatus.DRAFT;
    case InquiryDocStatus.PENDING_APPROVAL:
      return InquiryDisplayStatus.PENDING_APPROVAL;
    case InquiryDocStatus.CANCELLED:
      return InquiryDisplayStatus.CANCELLED;
    case InquiryDocStatus.APPROVED:
      switch (currentRoundStatus) {
        case RoundStatus.DRAFT:
          return InquiryDisplayStatus.READY;
        case RoundStatus.WAITING_QUOTES:
          return InquiryDisplayStatus.WAITING_QUOTES;
        case RoundStatus.QUOTES_CLOSED:
          return InquiryDisplayStatus.QUOTES_CLOSED;
        case RoundStatus.OPENED:
          return InquiryDisplayStatus.OPENED;
        case RoundStatus.EVALUATED:
          return InquiryDisplayStatus.EVALUATED;
        default:
          // 当前轮次不会是 SUPERSEDED；CANCELLED 只与单据 CANCELLED 同时出现
          return InquiryDisplayStatus.CANCELLED;
      }
  }
}

/** 页签 → 查询条件（api 用来拼 where） */
export const INQUIRY_TAB_FILTER: Record<
  InquiryTab,
  { docStatus: InquiryDocStatus; currentRoundStatus?: RoundStatus }
> = {
  draft: { docStatus: InquiryDocStatus.DRAFT },
  pending: { docStatus: InquiryDocStatus.PENDING_APPROVAL },
  ready: { docStatus: InquiryDocStatus.APPROVED, currentRoundStatus: RoundStatus.DRAFT },
  quoting: { docStatus: InquiryDocStatus.APPROVED, currentRoundStatus: RoundStatus.WAITING_QUOTES },
  closed: { docStatus: InquiryDocStatus.APPROVED, currentRoundStatus: RoundStatus.QUOTES_CLOSED },
  evaluating: { docStatus: InquiryDocStatus.APPROVED, currentRoundStatus: RoundStatus.OPENED },
  completed: { docStatus: InquiryDocStatus.APPROVED, currentRoundStatus: RoundStatus.EVALUATED },
  cancelled: { docStatus: InquiryDocStatus.CANCELLED },
};
