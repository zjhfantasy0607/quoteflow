import type { ApprovalAction, InquiryDocStatus, RoundStatus } from '../enums';
import type { InquiryAction } from '../inquiry-actions';
import type { InquiryFileKind } from '../schemas/inquiries';
import type { InquiryDisplayStatus } from '../status';
import type { FileDto } from './infra';
import type { MaterialCategoryBriefDto } from './materials';

export interface UserBriefDto {
  id: string;
  name: string;
}

/** 询价单列表的一项（M06 §5） */
export interface InquiryListItemDto {
  id: string;
  /** DR-20261026-0001，创建即生成 */
  draftNo: string;
  /** RFQ-202610-0001，审批通过后才有（R06-7）；列表优先显示它 */
  formalNo: string | null;
  projectNo: string;
  title: string;
  materialCategory: MaterialCategoryBriefDto;
  /** 字典 currency */
  currency: string;
  docStatus: InquiryDocStatus;
  displayStatus: InquiryDisplayStatus;
  currentRoundNo: number;
  currentRoundStatus: RoundStatus;
  currentDeadline: string | null;
  owner: UserBriefDto;
  pdUser: UserBriefDto | null;
  submittedAt: string | null;
  createdAt: string;
}

export interface InquiryRoundSummaryDto {
  id: string;
  roundNo: number;
  status: RoundStatus;
  deadline: string | null;
  publishedAt: string | null;
  lineCount: number;
}

/** GET /api/inquiries/:id */
export interface InquiryDetailDto extends InquiryListItemDto {
  description: string | null;
  createdBy: UserBriefDto;
  /** 创建时取创建人的部门（数据权限 DEPT） */
  departmentCode: string | null;
  /** 最近一次驳回意见（R06-7），草稿编辑页顶部显示 */
  lastRejectComment: string | null;
  approvedAt: string | null;
  approvedBy: UserBriefDto | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  updatedAt: string;
  currentRound: InquiryRoundSummaryDto;
  allowedActions: InquiryAction[];
}

/** 规格书或产品图的一条挂载（R06-5）。同一个文件可以挂在多行上（复制到其他行），每条挂载各有 id */
export interface InquiryFileDto {
  /** 挂载记录的 id（删除用）；文件本身是 file.id */
  id: string;
  kind: InquiryFileKind;
  /** 为空 = 整单附件 */
  lineId: string | null;
  file: FileDto;
  createdAt: string;
}

export interface InquiryLineDto {
  id: string;
  /** 从 1 连续（R06-3） */
  lineNo: number;
  /** 从材料库选用时有值（#31），手工行为 null */
  materialId: string | null;
  materialCode: string | null;
  nameZh: string;
  nameEn: string | null;
  spec: string;
  /** 字典 unit */
  unitCode: string;
  /** 十进制字符串，如 "200000"、"12.5" */
  quantity: string;
  brand: string | null;
  drawingRef: string | null;
  remark: string | null;
  category: MaterialCategoryBriefDto;
  /** 本行的规格书和产品图，按挂载顺序 */
  files: InquiryFileDto[];
}

/** GET /api/inquiries/:id/rounds/:roundNo */
export interface InquiryRoundDto {
  id: string;
  roundNo: number;
  status: RoundStatus;
  deadline: string | null;
  changeReason: string | null;
  changeSummary: string | null;
  /** 发布时冻结 */
  pplTemplateVersion: number | null;
  pplVariantCode: string | null;
  publishedAt: string | null;
  lines: InquiryLineDto[];
  /** 整单附件（规格书） */
  files: InquiryFileDto[];
  /** 含 edit 表示本轮的询价行和附件可以编辑 */
  allowedActions: InquiryAction[];
}

/** 审批记录（R06-12） */
export interface InquiryApprovalDto {
  id: string;
  action: ApprovalAction;
  comment: string | null;
  actor: UserBriefDto;
  createdAt: string;
}

/** 负责人、PD 负责人下拉的候选人：启用的、有 inquiry:create 权限的内部用户 */
export interface InquiryUserOptionDto {
  id: string;
  name: string;
  username: string;
  departmentCode: string | null;
  roleCodes: string[];
}
