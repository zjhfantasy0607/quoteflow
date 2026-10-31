import { z } from 'zod';
import { Dec } from '../decimal';
import { INQUIRY_TABS } from '../status';
import {
  commaListParam,
  dateQueryParam,
  idSchema,
  optionalText,
  pageQuerySchema,
  requiredText,
} from './common';

const unique = <T>(list: T[]) => [...new Set(list)];

// ---------- 询价单表头（M06 R06-1） ----------

const inquiryHeaderFields = {
  /** 同一项目号可以建多张询价单（#1） */
  projectNo: requiredText(50),
  title: requiredText(200),
  /** 材料类别，必须有效启用（服务端校验） */
  materialCategoryId: idSchema,
  /** 字典 currency，必须启用（服务端校验） */
  currency: requiredText(10),
  description: optionalText(1000),
  /** PD 负责人，可空 */
  pdUserId: idSchema.nullable().default(null),
};

export const createInquirySchema = z.object({
  ...inquiryHeaderFields,
  /** 采购负责人，不传 = 当前用户 */
  ownerId: idSchema.optional(),
});
export type CreateInquiryInput = z.infer<typeof createInquirySchema>;

export const updateInquirySchema = z.object({ ...inquiryHeaderFields, ownerId: idSchema });
export type UpdateInquiryInput = z.infer<typeof updateInquirySchema>;

const inquiryFilterFields = {
  /** 不传 = 全部（05 §2） */
  tab: z.enum(INQUIRY_TABS).optional(),
  /** 匹配草稿号、正式询价号、标题、项目号 */
  keyword: optionalText(100),
  /** 项目号，完全一致（不区分大小写） */
  projectNo: optionalText(50),
  /** 材料类别，包含所有下级 */
  materialCategoryId: idSchema.optional(),
  ownerId: idSchema.optional(),
  /** 创建日期区间（含当天，按 UTC+8） */
  from: dateQueryParam,
  to: dateQueryParam,
};

export const inquiryListQuerySchema = pageQuerySchema.extend(inquiryFilterFields);
export type InquiryListQuery = z.infer<typeof inquiryListQuerySchema>;
export type InquiryListParams = z.input<typeof inquiryListQuerySchema>;

// ---------- 审批与取消（R06-7、R06-9） ----------

export const approveInquirySchema = z.object({ comment: optionalText(500) });
export type ApproveInquiryInput = z.infer<typeof approveInquirySchema>;

/** 意见必填由服务端判断，未填返回 INQUIRY_REJECT_COMMENT_REQUIRED */
export const rejectInquirySchema = z.object({ comment: optionalText(500) });
export type RejectInquiryInput = z.infer<typeof rejectInquirySchema>;

/** 原因必填由服务端判断，未填返回 INQUIRY_CANCEL_REASON_REQUIRED */
export const cancelInquirySchema = z.object({ reason: optionalText(500) });
export type CancelInquiryInput = z.infer<typeof cancelInquirySchema>;

// ---------- 询价行（R06-2、R06-3、R06-11） ----------

/** 轮次号路径参数 */
export const roundNoSchema = z.coerce.number().int().min(1).max(999);

/** 数量：大于 0，最多 14 位整数、4 位小数（Decimal(18,4)） */
export const QUANTITY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;
export const QUANTITY_MAX_DECIMALS = 4;

/** 接受十进制字符串或数字，输出字符串（数量参与金额计算，不在 JS number 上做运算） */
export const quantitySchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .pipe(z.string().regex(QUANTITY_PATTERN))
  .refine((v) => /[1-9]/.test(v), { message: 'Quantity must be greater than 0' })
  // 规范写法：去掉前导 0 和小数末尾的 0（"0200.50" → "200.5"），审计比较新旧值时不会误报
  .transform((v) => new Dec(v).toFixed());

const lineCommonFields = {
  quantity: quantitySchema,
  brand: optionalText(100),
  drawingRef: optionalText(100),
  remark: optionalText(1000),
};

/** 手工行：名称、规格、单位、分类必填 */
const manualLineFields = {
  /** 选填：不关联材料库的物料编码（如客户自己的编码），转大写 */
  materialCode: optionalText(50).transform((v) => v?.toUpperCase()),
  nameZh: requiredText(100),
  nameEn: optionalText(100),
  spec: requiredText(200),
  /** 字典 unit，必须启用（服务端校验） */
  unitCode: requiredText(50),
  /** 必须有效启用（服务端校验，#21） */
  categoryId: idSchema,
};

const manualLineSchema = z.object({ source: z.literal('MANUAL'), ...manualLineFields, ...lineCommonFields });

/**
 * POST .../lines：从材料库选用（复制编码、中英文名、规格、单位、分类、品牌，材料必须启用）或手工录入。
 * 材料行不填品牌时取材料的品牌
 */
export const createLineSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('MATERIAL'), materialId: idSchema, ...lineCommonFields }),
  manualLineSchema,
]);
export type CreateLineInput = z.infer<typeof createLineSchema>;
export type CreateLineParams = z.input<typeof createLineSchema>;

/** PUT .../lines/:lineId：source 必须与行的来源一致；材料行只能改数量、品牌、图纸编号和备注 */
export const updateLineSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('MATERIAL'), ...lineCommonFields }),
  manualLineSchema,
]);
export type UpdateLineInput = z.infer<typeof updateLineSchema>;
export type UpdateLineParams = z.input<typeof updateLineSchema>;

/** 一次最多选用多少个材料 */
export const MAX_MATERIALS_PER_PICK = 200;

export const linesFromMaterialsSchema = z.object({
  items: z
    .array(z.object({ materialId: idSchema, quantity: quantitySchema }))
    .min(1)
    .max(MAX_MATERIALS_PER_PICK),
});
export type LinesFromMaterialsInput = z.infer<typeof linesFromMaterialsSchema>;

/** 本轮全部行的新顺序（R06-3），必须恰好是本轮的全部行 */
export const reorderLinesSchema = z.object({ lineIds: z.array(idSchema).min(1).max(5000) });
export type ReorderLinesInput = z.infer<typeof reorderLinesSchema>;

// ---------- 规格书与产品图（R06-5） ----------

export const INQUIRY_FILE_KINDS = ['SPEC_DOC', 'PRODUCT_IMAGE'] as const;
export type InquiryFileKind = (typeof INQUIRY_FILE_KINDS)[number];

/** fileId 是自己刚上传的同类文件；lineId 为空 = 整单附件（只能是规格书） */
export const attachInquiryFileSchema = z.object({
  fileId: idSchema,
  kind: z.enum(INQUIRY_FILE_KINDS),
  lineId: idSchema.nullable().default(null),
});
export type AttachInquiryFileInput = z.infer<typeof attachInquiryFileSchema>;

/** 复制到其他行：为目标行新增指向同一文件的挂载；目标行已有的同一文件跳过 */
export const copyLineFilesSchema = z.object({
  fromLineId: idSchema,
  toLineIds: z.array(idSchema).min(1).max(5000).transform(unique),
  /** 不传 = 规格书和产品图都复制 */
  kind: z.enum(INQUIRY_FILE_KINDS).optional(),
});
export type CopyLineFilesInput = z.infer<typeof copyLineFilesSchema>;

// ---------- 受邀名单、发布与通知（M07） ----------

/** 一张询价单最多邀请多少家供应商；催报一次最多选多少张报价单 */
export const MAX_INVITEES = 200;

/** R07-1 候选供应商（只含启用的）；主营材料分类包含下级，前端默认填询价单的材料类别，可以清空 */
export const inviteeCandidatesQuerySchema = pageQuerySchema.extend({
  /** 供应商分类，可多选，逗号分隔（战略 / 优秀 / 普通，#3） */
  categoryCodes: commaListParam.optional(),
  materialCategoryId: idSchema.optional(),
  /** 匹配编码、中英文名称、联系人 */
  keyword: optionalText(100),
});
export type InviteeCandidatesQuery = z.infer<typeof inviteeCandidatesQuerySchema>;
export type InviteeCandidatesParams = z.input<typeof inviteeCandidatesQuerySchema>;

/** PUT .../invitees：整体替换受邀名单（可以清空）；新加入的供应商必须启用 */
export const updateInviteesSchema = z.object({
  supplierIds: z.array(idSchema).max(MAX_INVITEES).transform(unique),
});
export type UpdateInviteesInput = z.infer<typeof updateInviteesSchema>;

/** 截止时间：ISO 8601（UTC 或带时区偏移）。界面按 UTC+8 选择，提交时转成 UTC */
export const deadlineSchema = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

/** R07-3：截止 ≥ 现在 + inquiry.minDeadlineHours（服务端校验） */
export const publishRoundSchema = z.object({ deadline: deadlineSchema });
export type PublishRoundInput = z.infer<typeof publishRoundSchema>;

/** R07-10：新截止 > max(原截止, 现在 + inquiry.minDeadlineHours)（服务端校验） */
export const extendDeadlineSchema = z.object({ deadline: deadlineSchema });
export type ExtendDeadlineInput = z.infer<typeof extendDeadlineSchema>;

/** R07-7 补充邀请：本轮已邀请的供应商跳过 */
export const lateInviteSchema = z.object({
  supplierIds: z.array(idSchema).min(1).max(MAX_INVITEES).transform(unique),
});
export type LateInviteInput = z.infer<typeof lateInviteSchema>;

/** R07-8 手动催报：只能选未响应（INVITED）的报价单 */
export const remindQuotesSchema = z.object({
  quoteIds: z.array(idSchema).min(1).max(MAX_INVITEES).transform(unique),
});
export type RemindQuotesInput = z.infer<typeof remindQuotesSchema>;

// ---------- 定标（M12） ----------

/** POST .../rounds/:roundNo/award（R12-1）：中标报价必须是评标中（服务端校验 AWARD_INVALID_QUOTE）；定标说明可选 */
export const awardRoundSchema = z.object({
  quoteId: idSchema,
  comment: optionalText(500),
});
export type AwardRoundInput = z.infer<typeof awardRoundSchema>;
