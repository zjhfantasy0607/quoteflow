import { z } from 'zod';
import { SUPPLIER_LANGUAGES } from '../enums';
import { commaListParam, idSchema, optionalText, pageQuerySchema, requiredText } from './common';

// ---------- 供应商（M04 R04-1 ~ R04-5） ----------

/** 供应商编码：字母、数字和 . _ / -，自动转大写；留空自动生成 SUP10001 起的编号（R04-2） */
export const SUPPLIER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;

/** 统一社会信用代码：18 位大写字母或数字，输入的小写字母自动转大写（R04-2；海外供应商可空，A-12） */
export const CREDIT_CODE_PATTERN = /^[0-9A-Z]{18}$/;

/** 抄送邮箱最多几个（R04-3） */
export const MAX_CC_EMAILS = 5;

/** 邮箱统一转小写后存储和比较（docs/03 §1） */
const emailSchema = z.string().trim().toLowerCase().email().max(100);

/** 可留空的编码类字段：去空白、转大写，空串视为未填 */
const optionalCode = (pattern: RegExp) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(new RegExp(`^$|${pattern.source}`))
    .optional()
    .transform((v) => (v ? v : undefined));

const supplierFilterFields = {
  /** 匹配编码、中英文名称、联系人 */
  keyword: optionalText(100),
  /** 供应商分类，可多选，逗号分隔 */
  categoryCodes: commaListParam.optional(),
  /** 主营材料分类，包含所有下级 */
  materialCategoryId: idSchema.optional(),
  status: z.enum(['ENABLED', 'DISABLED']).optional(),
};

/** R04-5 列表筛选 */
export const supplierListQuerySchema = pageQuerySchema.extend(supplierFilterFields);
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;
/** 前端传参（categoryCodes 是逗号分隔的字符串） */
export type SupplierListParams = z.input<typeof supplierListQuerySchema>;

export const supplierExportQuerySchema = z.object(supplierFilterFields);
export type SupplierExportQuery = z.infer<typeof supplierExportQuerySchema>;
export type SupplierExportParams = z.input<typeof supplierExportQuerySchema>;

const unique = <T>(list: T[]) => [...new Set(list)];

const supplierFields = {
  nameZh: requiredText(100),
  nameEn: optionalText(200),
  creditCode: optionalCode(CREDIT_CODE_PATTERN),
  /** 字典 supplier_category，必须启用（R04-1，服务端校验） */
  categoryCode: requiredText(50),
  /** 主营材料分类，可多选，只能选有效启用的分类（R04-4，服务端校验） */
  materialCategoryIds: z.array(idSchema).max(50).default([]).transform(unique),
  contactName: requiredText(50),
  contactEmail: emailSchema,
  contactPhone: optionalText(30),
  ccEmails: z.array(emailSchema).max(MAX_CC_EMAILS).default([]).transform(unique),
  /** 决定邮件语言（R04-3、#4） */
  preferredLanguage: z.enum(SUPPLIER_LANGUAGES).default('zh-CN'),
  country: optionalText(50),
  address: optionalText(200),
  remark: optionalText(1000),
};

export const createSupplierSchema = z.object({
  code: optionalCode(SUPPLIER_CODE_PATTERN),
  ...supplierFields,
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/** 不能改 code（R04-2），请求里带了也会被忽略 */
export const updateSupplierSchema = z.object(supplierFields);
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

// ---------- 门户账号（R04-10、R04-11） ----------

export const createSupplierAccountSchema = z.object({
  /** 同时是登录账号，在全部用户中唯一 */
  email: emailSchema,
  name: requiredText(50),
});
export type CreateSupplierAccountInput = z.infer<typeof createSupplierAccountSchema>;

/** 激活：用激活邮件里的令牌设置密码 */
export const activateAccountSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(1).max(200),
});
export type ActivateAccountInput = z.infer<typeof activateAccountSchema>;
