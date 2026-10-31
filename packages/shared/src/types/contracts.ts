import type { ContractAction, ContractStep } from '../contract-actions';
import type { ApprovalAction, ContractStatus } from '../enums';
import type { PplValue } from '../ppl/values';
import type { ContractSnapshot } from '../schemas/contracts';
import type { FileDto } from './infra';
import type { UserBriefDto } from './inquiries';

// 合同管理（M14）：金额按 contract.amount 脱敏（快照里的金额同样处理，R14-7），被脱敏的值为 null

/** GET /api/contracts 的一项 */
export interface ContractListItemDto {
  id: string;
  /** CT-202611-0001 */
  contractNo: string;
  status: ContractStatus;
  inquiry: { id: string; formalNo: string; title: string };
  supplier: { id: string; code: string; nameZh: string; nameEn: string | null };
  /** 合同金额（2 位小数）；没有 contract.amount 时为 null */
  amount: string | null;
  /** 字典 currency */
  currency: string;
  /** YYYY-MM-DD */
  deliveryDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** 被脱敏的字段：amount */
  maskedFields?: string[];
}

/** 审批记录（R14-4）：每次提交、审核、批准各一条 */
export interface ContractApprovalDto {
  id: string;
  step: ContractStep;
  action: ApprovalAction;
  comment: string | null;
  actor: UserBriefDto;
  createdAt: string;
}

type SnapshotNegotiation = NonNullable<ContractSnapshot['negotiation']>[number];

/**
 * 接口里的快照（02 §4）：没有 contract.amount 时中标版本合计、金额列（PPL 的 sensitive 列）、议价价格为 null；
 * 没有 supplier.contact 时供应商的联系电话、邮箱为 null
 */
export type ContractSnapshotDto = Omit<ContractSnapshot, 'supplier' | 'quoteVersion' | 'negotiation'> & {
  supplier: Omit<ContractSnapshot['supplier'], 'contactEmail' | 'contactPhone'> & {
    contactEmail: string | null;
    contactPhone: string | null;
  };
  quoteVersion: Omit<ContractSnapshot['quoteVersion'], 'totalAmount' | 'values'> & {
    totalAmount: string | null;
    values: { lines: { lineId: string; lineNo: number; values: Record<string, PplValue | null> }[] };
  };
  negotiation:
    | (Omit<SnapshotNegotiation, 'lines'> & {
        lines: (Omit<SnapshotNegotiation['lines'][number], 'unitPriceInclTax'> & {
          unitPriceInclTax?: string | null;
        })[];
      })[]
    | null;
};

/** GET /api/contracts/:id */
export interface ContractDetailDto extends ContractListItemDto {
  deliveryPlace: string | null;
  /** 付款方式（定标时预填为中标版本付款条件的字典名称） */
  paymentTerms: string | null;
  summary: string | null;
  remark: string | null;
  snapshot: ContractSnapshotDto;
  attachments: FileDto[];
  /** 签字扫描件（批准后上传，可以替换） */
  signedScan: FileDto | null;
  signedAt: string | null;
  approvals: ContractApprovalDto[];
  createdBy: UserBriefDto;
  allowedActions: ContractAction[];
}
