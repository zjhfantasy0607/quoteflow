import { z } from 'zod';
import { EmailStatus, EmailType } from '../enums';
import type { SystemParamValue } from '../params';
import {
  dateQueryParam,
  idSchema,
  optionalText,
  pageQuerySchema,
  queryBoolean,
  requiredText,
} from './common';

// ---------- 文件 ----------

/** 允许上传的文件类别（EXPORT 只由系统生成） */
export const UPLOAD_KINDS = ['SPEC_DOC', 'PRODUCT_IMAGE', 'MATERIAL_IMAGE', 'ATTACHMENT', 'IMPORT'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

/** 各类上传文件允许的扩展名与大小上限（R02-4；前端上传前预检，后端再校验魔数） */
export const UPLOAD_KIND_RULES: Record<
  UploadKind,
  { exts: string[]; maxMB: (limits: SystemParamValue<'upload.limits'>) => number }
> = {
  SPEC_DOC: { exts: ['pdf', 'xlsx', 'xls', ...IMAGE_EXTS], maxMB: (l) => l.specDocMaxMB },
  PRODUCT_IMAGE: { exts: IMAGE_EXTS, maxMB: (l) => l.imageMaxMB },
  MATERIAL_IMAGE: { exts: IMAGE_EXTS, maxMB: (l) => l.imageMaxMB },
  ATTACHMENT: {
    exts: ['pdf', 'xlsx', 'xls', 'docx', 'doc', 'zip', ...IMAGE_EXTS],
    maxMB: (l) => l.attachmentMaxMB,
  },
  IMPORT: { exts: ['xlsx'], maxMB: () => 10 },
};

export const uploadFileSchema = z.object({ kind: z.enum(UPLOAD_KINDS) });
export type UploadFileInput = z.infer<typeof uploadFileSchema>;

export const fileContentQuerySchema = z.object({
  disposition: z.enum(['inline', 'attachment']).default('attachment'),
  /** 内部页面里自动加载的缩略图：内部用户不记访问日志（M08 R08-3），供应商照样记 */
  thumbnail: queryBoolean.optional(),
});
export type FileContentQuery = z.infer<typeof fileContentQuerySchema>;

// ---------- 数据字典管理 ----------

export const DICT_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/;

export const createDictTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,49}$/),
  nameZh: requiredText(50),
  nameEn: requiredText(100),
});
export type CreateDictTypeInput = z.infer<typeof createDictTypeSchema>;

export const updateDictTypeSchema = createDictTypeSchema.omit({ code: true });
export type UpdateDictTypeInput = z.infer<typeof updateDictTypeSchema>;

export const createDictItemSchema = z.object({
  code: z.string().trim().regex(DICT_CODE_PATTERN),
  nameZh: requiredText(100),
  nameEn: requiredText(200),
  sort: z.number().int().min(0).max(9999).default(0),
  remark: optionalText(500),
});
export type CreateDictItemInput = z.infer<typeof createDictItemSchema>;

export const updateDictItemSchema = createDictItemSchema.omit({ code: true }).extend({
  status: z.enum(['ENABLED', 'DISABLED']),
});
export type UpdateDictItemInput = z.infer<typeof updateDictItemSchema>;

// ---------- 系统参数 ----------

export const updateParamSchema = z.object({ value: z.unknown() });
export type UpdateParamInput = z.infer<typeof updateParamSchema>;

// ---------- 邮件记录 ----------

const dateParam = dateQueryParam;

export const emailListQuerySchema = pageQuerySchema.extend({
  type: z.enum(EmailType).optional(),
  status: z.enum(EmailStatus).optional(),
  language: z.enum(['zh-CN', 'en-US', 'bilingual']).optional(),
  keyword: optionalText(100),
  inquiryId: idSchema.optional(),
  from: dateParam,
  to: dateParam,
});
export type EmailListQuery = z.infer<typeof emailListQuerySchema>;

// ---------- 操作日志 ----------

export const auditListQuerySchema = pageQuerySchema.extend({
  actorId: idSchema.optional(),
  action: optionalText(100),
  entityType: optionalText(50),
  entityId: idSchema.optional(),
  from: dateParam,
  to: dateParam,
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

// ---------- 找回密码 ----------

export const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(100) });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordWithTokenSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(1).max(200),
});
export type ResetPasswordWithTokenInput = z.infer<typeof resetPasswordWithTokenSchema>;
