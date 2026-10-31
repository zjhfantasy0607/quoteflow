import type {
  FileAccessAction,
  NegotiationStatus,
  QuoteStatus,
  RoundStatus,
  SupplierLanguage,
} from '../enums';
import type { PortalQuoteAction } from '../inquiry-actions';
import type { PplValues } from '../ppl/values';
import type { RoundDiffDto } from '../round-diff';
import type { InquiryFileKind } from '../schemas/inquiries';
import type { QuoteDraftSource } from '../schemas/portal';
import type { FileDto } from './infra';
import type { PplResolvedDto } from './ppl';
import type { QuoteVersionDto } from './quotes';

// 供应商门户（M08）。门户里不出现内部信息（05 §7.2 P-5）：项目号、草稿号、审批记录、其他供应商、
// 询价行的备注（按"内部备注"处理）、供应商分类和内部备注都不返回

/** "我的询价"列表的一项（一张报价单 = 本供应商在某一轮的报价） */
export interface PortalQuoteListItemDto {
  /** 报价单 id，详情页用它 */
  id: string;
  inquiry: { formalNo: string; title: string; currency: string };
  roundNo: number;
  roundStatus: RoundStatus;
  deadline: string | null;
  /** 我的状态 */
  status: QuoteStatus;
  invitedAt: string;
  firstViewedAt: string | null;
  lastSubmittedAt: string | null;
}

/** 规格书、产品图的一条挂载 */
export interface PortalFileDto {
  id: string;
  kind: InquiryFileKind;
  file: FileDto;
}

export interface PortalLineDto {
  id: string;
  lineNo: number;
  materialCode: string | null;
  nameZh: string;
  nameEn: string | null;
  spec: string;
  /** 字典 unit */
  unitCode: string;
  /** 十进制字符串 */
  quantity: string;
  brand: string | null;
  drawingRef: string | null;
  category: { code: string; nameZh: string; nameEn: string };
  files: PortalFileDto[];
}

/** GET /api/portal/quotes/:quoteId（R08-7） */
export interface PortalQuoteDetailDto {
  id: string;
  status: QuoteStatus;
  invitedAt: string;
  firstViewedAt: string | null;
  respondedAt: string | null;
  lastSubmittedAt: string | null;
  declinedAt: string | null;
  /** 字典 decline_reason */
  declineReasonCode: string | null;
  declineReason: string | null;
  inquiry: {
    formalNo: string;
    title: string;
    /** 字典 currency */
    currency: string;
    description: string | null;
    /** 采购联系人：询价负责人的姓名和邮箱 */
    buyer: { name: string; email: string | null };
    /** 询价已取消时的时间和原因（取消通知邮件里也写了原因） */
    cancelledAt: string | null;
    cancelReason: string | null;
  };
  round: {
    roundNo: number;
    status: RoundStatus;
    deadline: string | null;
    publishedAt: string | null;
    /** 第 2 轮起：变更原因和主要变更内容 */
    changeReason: string | null;
    changeSummary: string | null;
    pplTemplateVersion: number | null;
    pplVariantCode: string | null;
  };
  lines: PortalLineDto[];
  /** 整单附件（规格书） */
  files: PortalFileDto[];
  /** 该轮冻结的模板版本与变体解析后的列（R09-2） */
  template: PplResolvedDto;
  /** 草稿，只有供应商自己看得到（02 §4）；没有草稿为 null */
  draft: PortalQuoteDraftDto | null;
  /** 当前版本 = 最后一次提交（R09-5）；还没提交过为 null */
  currentVersion: QuoteVersionDto | null;
  versionCount: number;
  /** 议价状态（M11）：采购方发过议价才有，门户据此显示"议价"区 */
  negotiationStatus: NegotiationStatus | null;
  /** 本供应商在这张询价单各轮的报价单（M13，按轮次号，含本张）：切换查看旧轮次（只读，P-4） */
  rounds: PortalQuoteRoundDto[];
  /** 第 2 轮起与上一轮的规格对比（不含询价行备注，P-5）；上一轮没有邀请本供应商时为 null（P-2） */
  diff: RoundDiffDto | null;
  /** computePortalQuoteActions()：报价窗口外（已截止、作废）为空，轮到回复议价时有 respondNegotiation */
  allowedActions: PortalQuoteAction[];
}

/** 本供应商在同一询价单某一轮的报价单（M13） */
export interface PortalQuoteRoundDto {
  quoteId: string;
  roundNo: number;
  roundStatus: RoundStatus;
  status: QuoteStatus;
}

/** 供应商草稿（R09-3、R09-8） */
export interface PortalQuoteDraftDto {
  /** 询价行 id → 供应商填写列的取值 */
  lines: Record<string, PplValues>;
  remark: string | null;
  changeNote: string | null;
  attachments: FileDto[];
  /** 最近一次写入草稿的方式：在线保存 / 导入 Excel */
  source: QuoteDraftSource;
  updatedAt: string;
}

/** GET /api/portal/profile：本供应商的企业资料（只读） */
export interface SupplierProfileDto {
  code: string;
  nameZh: string;
  nameEn: string | null;
  creditCode: string | null;
  /** 主营材料分类 */
  materialCategories: { code: string; nameZh: string; nameEn: string }[];
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  ccEmails: string[];
  preferredLanguage: SupplierLanguage;
  country: string | null;
  address: string | null;
}

/** GET /api/inquiries/:id/file-access-logs（R08-4） */
export interface FileAccessLogDto {
  id: string;
  createdAt: string;
  action: FileAccessAction;
  file: { id: string; originalName: string };
  user: { id: string; name: string } | null;
  /** 内部用户访问时为 null */
  supplier: { id: string; code: string; nameZh: string; nameEn: string | null } | null;
}
