import type { ContractStatus, NegotiationMsgType, QuoteStatus, RoundStatus } from '../enums';
import type { UserBriefDto } from './inquiries';

// 工作台（M16）：一个接口一次返回全部卡片（R16-2）。卡片内容遵守数据权限、供应商隔离，不含任何金额（R16-1）

/** 一张卡片：符合条件的总数 + 前 WORKBENCH_CARD_LIMIT 条 */
export interface WorkbenchCardDto<T> {
  total: number;
  items: T[];
}

/** 本轮响应进度：已响应（已提交或已拒绝）/ 受邀家数（S-1 开标前也能看） */
export interface WorkbenchProgressDto {
  responded: number;
  invited: number;
}

/** 询价单类卡片的一项（待我审批、我的草稿、待发布、等待报价、待开标） */
export interface WorkbenchInquiryItemDto {
  id: string;
  draftNo: string;
  formalNo: string | null;
  projectNo: string;
  title: string;
  owner: UserBriefDto;
  currentRoundNo: number;
  currentDeadline: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  updatedAt: string;
  /** 我的草稿：被驳回过（带驳回意见），其他卡片为 false */
  rejected: boolean;
  /** 等待报价、待开标：本轮响应进度；其他卡片为 null */
  progress: WorkbenchProgressDto | null;
}

export interface WorkbenchSupplierDto {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string | null;
}

/** 议价待处理的一项：进行中的议价，最后一条消息来自供应商（不含方案内容和价格） */
export interface WorkbenchNegotiationItemDto {
  quoteId: string;
  inquiry: { id: string; formalNo: string; title: string };
  roundNo: number;
  supplier: WorkbenchSupplierDto;
  lastMessage: { type: NegotiationMsgType; createdAt: string };
}

/** 待审核 / 待批准合同的一项（不含合同金额） */
export interface WorkbenchContractItemDto {
  id: string;
  contractNo: string;
  status: ContractStatus;
  inquiry: { id: string; formalNo: string; title: string };
  supplier: WorkbenchSupplierDto;
  /** 送审时间：进入当前状态的那条审批记录（提交审核 / 审核通过）的时间 */
  submittedAt: string;
}

/** GET /api/workbench：没有权限的卡片不返回（WORKBENCH_CARD_PERMISSIONS） */
export interface WorkbenchDto {
  pendingApproval?: WorkbenchCardDto<WorkbenchInquiryItemDto>;
  myDrafts?: WorkbenchCardDto<WorkbenchInquiryItemDto>;
  readyToPublish?: WorkbenchCardDto<WorkbenchInquiryItemDto>;
  waitingQuotes?: WorkbenchCardDto<WorkbenchInquiryItemDto>;
  toOpen?: WorkbenchCardDto<WorkbenchInquiryItemDto>;
  negotiations?: WorkbenchCardDto<WorkbenchNegotiationItemDto>;
  contractsToReview?: WorkbenchCardDto<WorkbenchContractItemDto>;
  contractsToApprove?: WorkbenchCardDto<WorkbenchContractItemDto>;
}

/** 供应商工作台的一项（一张报价单）；只有门户可见的字段（P-5） */
export interface PortalWorkbenchItemDto {
  /** 报价单 id */
  id: string;
  inquiry: { formalNo: string; title: string };
  roundNo: number;
  roundStatus: RoundStatus;
  deadline: string | null;
  /** 我的状态：待报价里 INVITED = 未提交、SUBMITTED = 已提交；最近结果里 WON / LOST */
  status: QuoteStatus;
  /** 议价待回复：采购方方案的发出时间；其他卡片为 null */
  offeredAt: string | null;
  /** 最近结果：定标时间；其他卡片为 null */
  evaluatedAt: string | null;
}

/** GET /api/portal/workbench */
export interface PortalWorkbenchDto {
  pendingQuotes: WorkbenchCardDto<PortalWorkbenchItemDto>;
  negotiations: WorkbenchCardDto<PortalWorkbenchItemDto>;
  recentResults: WorkbenchCardDto<PortalWorkbenchItemDto>;
}
