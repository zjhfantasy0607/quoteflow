// 与 apps/api/prisma/schema.prisma 中的枚举一一对应（值必须相同，api 有测试校验）。

export const UserType = { INTERNAL: 'INTERNAL', SUPPLIER: 'SUPPLIER' } as const;
export type UserType = (typeof UserType)[keyof typeof UserType];

export const UserStatus = {
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const DataScope = { SELF: 'SELF', DEPT: 'DEPT', ALL: 'ALL' } as const;
export type DataScope = (typeof DataScope)[keyof typeof DataScope];

export const EnableStatus = { ENABLED: 'ENABLED', DISABLED: 'DISABLED' } as const;
export type EnableStatus = (typeof EnableStatus)[keyof typeof EnableStatus];

export const InquiryDocStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
} as const;
export type InquiryDocStatus = (typeof InquiryDocStatus)[keyof typeof InquiryDocStatus];

export const RoundStatus = {
  DRAFT: 'DRAFT',
  WAITING_QUOTES: 'WAITING_QUOTES',
  QUOTES_CLOSED: 'QUOTES_CLOSED',
  OPENED: 'OPENED',
  EVALUATED: 'EVALUATED',
  SUPERSEDED: 'SUPERSEDED',
  CANCELLED: 'CANCELLED',
} as const;
export type RoundStatus = (typeof RoundStatus)[keyof typeof RoundStatus];

export const QuoteStatus = {
  INVITED: 'INVITED',
  SUBMITTED: 'SUBMITTED',
  DECLINED: 'DECLINED',
  EVALUATING: 'EVALUATING',
  WON: 'WON',
  LOST: 'LOST',
  VOID: 'VOID',
} as const;
export type QuoteStatus = (typeof QuoteStatus)[keyof typeof QuoteStatus];

export const QuoteVersionSource = { ONLINE: 'ONLINE', EXCEL: 'EXCEL', NEGOTIATION: 'NEGOTIATION' } as const;
export type QuoteVersionSource = (typeof QuoteVersionSource)[keyof typeof QuoteVersionSource];

export const NegotiationStatus = { OPEN: 'OPEN', AGREED: 'AGREED', CLOSED: 'CLOSED' } as const;
export type NegotiationStatus = (typeof NegotiationStatus)[keyof typeof NegotiationStatus];

export const NegotiationParty = { BUYER: 'BUYER', SUPPLIER: 'SUPPLIER' } as const;
export type NegotiationParty = (typeof NegotiationParty)[keyof typeof NegotiationParty];

export const NegotiationMsgType = {
  OFFER: 'OFFER',
  COUNTER: 'COUNTER',
  ACCEPT: 'ACCEPT',
  REJECT: 'REJECT',
  CLOSE: 'CLOSE',
} as const;
export type NegotiationMsgType = (typeof NegotiationMsgType)[keyof typeof NegotiationMsgType];

export const ApprovalAction = { SUBMIT: 'SUBMIT', APPROVE: 'APPROVE', REJECT: 'REJECT' } as const;
export type ApprovalAction = (typeof ApprovalAction)[keyof typeof ApprovalAction];

export const ContractStatus = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];

export const EmailType = {
  INVITATION: 'INVITATION',
  REMINDER: 'REMINDER',
  OPENING: 'OPENING',
  NEGOTIATION: 'NEGOTIATION',
  AWARD: 'AWARD',
  RESULT: 'RESULT',
  CHANGE: 'CHANGE',
  APPROVAL: 'APPROVAL',
  ACCOUNT: 'ACCOUNT',
} as const;
export type EmailType = (typeof EmailType)[keyof typeof EmailType];

export const EmailStatus = { PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED' } as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];

export const FileAccessAction = { PREVIEW: 'PREVIEW', DOWNLOAD: 'DOWNLOAD' } as const;
export type FileAccessAction = (typeof FileAccessAction)[keyof typeof FileAccessAction];

export const PointsSource = { AUTO: 'AUTO', MANUAL: 'MANUAL' } as const;
export type PointsSource = (typeof PointsSource)[keyof typeof PointsSource];

// ---------- 非数据库枚举 ----------

export const LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof LOCALES)[number];

export const SUPPLIER_LANGUAGES = ['zh-CN', 'en-US', 'bilingual'] as const;
export type SupplierLanguage = (typeof SUPPLIER_LANGUAGES)[number];

export const FILE_KINDS = [
  'SPEC_DOC',
  'PRODUCT_IMAGE',
  'MATERIAL_IMAGE',
  'ATTACHMENT',
  'IMPORT',
  'EXPORT',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const ATTACHMENT_OWNER_TYPES = ['QUOTE_VERSION', 'NEGOTIATION_MESSAGE', 'CONTRACT'] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

/**
 * 门户账号状态（R07-6）：ACTIVE 有可登录的账号；PENDING 只有待激活的；DISABLED 账号都已停用；
 * NONE 没开通。不是 ACTIVE 的供应商收得到邀请邮件，但登录不了门户
 */
export const PORTAL_ACCOUNT_STATES = ['ACTIVE', 'PENDING', 'DISABLED', 'NONE'] as const;
export type PortalAccountState = (typeof PORTAL_ACCOUNT_STATES)[number];

/** 供 api 测试与 Prisma 枚举比对 */
export const DB_ENUMS = {
  UserType,
  UserStatus,
  DataScope,
  EnableStatus,
  InquiryDocStatus,
  RoundStatus,
  QuoteStatus,
  QuoteVersionSource,
  NegotiationStatus,
  NegotiationParty,
  NegotiationMsgType,
  ApprovalAction,
  ContractStatus,
  EmailType,
  EmailStatus,
  FileAccessAction,
  PointsSource,
} as const;
