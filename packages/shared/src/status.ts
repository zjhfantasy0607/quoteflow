import { InquiryDocStatus, QuoteStatus, RoundStatus } from './enums';

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

// ---------- 轮次状态流转（docs/05 §3） ----------

/** 轮次状态迁移事件；后端只有 RoundStateService 执行，按 ROUND_TRANSITIONS 校验来源状态（R07-12） */
export const ROUND_EVENTS = [
  'publish',
  'close',
  'closeEarly',
  'extendDeadline',
  'open',
  'award',
  'supersede',
  'cancel',
] as const;
export type RoundEvent = (typeof ROUND_EVENTS)[number];

/** 终态：EVALUATED、SUPERSEDED、CANCELLED */
export const ROUND_TERMINAL_STATUSES: readonly RoundStatus[] = [
  RoundStatus.EVALUATED,
  RoundStatus.SUPERSEDED,
  RoundStatus.CANCELLED,
];

const NON_TERMINAL_ROUND_STATUSES: readonly RoundStatus[] = [
  RoundStatus.DRAFT,
  RoundStatus.WAITING_QUOTES,
  RoundStatus.QUOTES_CLOSED,
  RoundStatus.OPENED,
];

/** 05 §3 的状态表：事件 → 允许的来源状态、结果状态。表外的流转一律拒绝（ROUND_INVALID_STATUS） */
export const ROUND_TRANSITIONS: Record<RoundEvent, { from: readonly RoundStatus[]; to: RoundStatus }> = {
  /** 发布（第 1 轮 M07；第 N 轮"采购确认"M13） */
  publish: { from: [RoundStatus.DRAFT], to: RoundStatus.WAITING_QUOTES },
  /** 截止时间到（M10 截止任务） */
  close: { from: [RoundStatus.WAITING_QUOTES], to: RoundStatus.QUOTES_CLOSED },
  /** 提前截止（M10） */
  closeEarly: { from: [RoundStatus.WAITING_QUOTES], to: RoundStatus.QUOTES_CLOSED },
  /** 延期：报价完成后延期回到等待报价 */
  extendDeadline: {
    from: [RoundStatus.WAITING_QUOTES, RoundStatus.QUOTES_CLOSED],
    to: RoundStatus.WAITING_QUOTES,
  },
  /** 开标（M10） */
  open: { from: [RoundStatus.QUOTES_CLOSED], to: RoundStatus.OPENED },
  /** 定标（M12） */
  award: { from: [RoundStatus.OPENED], to: RoundStatus.EVALUATED },
  /** 新的变更轮次发布后，旧的当前轮作废（M13） */
  supersede: {
    from: [RoundStatus.WAITING_QUOTES, RoundStatus.QUOTES_CLOSED, RoundStatus.OPENED],
    to: RoundStatus.SUPERSEDED,
  },
  /** 询价单取消：非终态的轮次一起取消 */
  cancel: { from: NON_TERMINAL_ROUND_STATUSES, to: RoundStatus.CANCELLED },
};

/** 05 §4：轮次作废、询价取消时这些状态的报价单 → VOID */
export const QUOTE_VOIDABLE_STATUSES: readonly QuoteStatus[] = [
  QuoteStatus.INVITED,
  QuoteStatus.SUBMITTED,
  QuoteStatus.DECLINED,
  QuoteStatus.EVALUATING,
];

// ---------- 供应商门户"我的询价"页签（M08 R08-1） ----------

export const PORTAL_QUOTE_TABS = ['pending', 'evaluating', 'closed'] as const;
export type PortalQuoteTab = (typeof PORTAL_QUOTE_TABS)[number];

/** 页签 → 报价单所在轮次的状态：待处理 / 评标中 / 已结束（作废的旧轮次、取消的询价也在已结束里） */
export const PORTAL_QUOTE_TAB_ROUND_STATUSES: Record<PortalQuoteTab, readonly RoundStatus[]> = {
  pending: [RoundStatus.WAITING_QUOTES],
  evaluating: [RoundStatus.QUOTES_CLOSED, RoundStatus.OPENED],
  closed: [RoundStatus.EVALUATED, RoundStatus.SUPERSEDED, RoundStatus.CANCELLED],
};
