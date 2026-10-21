import { z } from 'zod';
import { idSchema, optionalText, pageQuerySchema, queryBoolean, requiredText } from './common';

// ---------- 材料分类（M03 R03-1 ~ R03-3） ----------

/** 分类编码：大写字母、数字、连字符，创建后不可改（输入的小写字母自动转大写） */
export const CATEGORY_CODE_PATTERN = /^[A-Z0-9-]{1,30}$/;

/** 分类可绑定的 PPL 变体代码（是否存在于激活模板集由 M05 校验）；空串视为清除 */
const pplVariantCodeInput = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{0,30}$/)
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

export const categoryTreeQuerySchema = z.object({
  /** 默认只返回有效启用的节点；分类管理页传 true 取整棵树 */
  includeDisabled: queryBoolean.default(false),
});
export type CategoryTreeQuery = z.infer<typeof categoryTreeQuerySchema>;

const categoryFields = {
  nameZh: requiredText(100),
  nameEn: requiredText(100),
  sort: z.number().int().min(0).max(9999).default(0),
  remark: optionalText(1000),
  /** 不传 = 不修改；null 或空串 = 清除（继承上级） */
  pplVariantCode: pplVariantCodeInput,
};

export const createCategorySchema = z.object({
  /** 不传或 null 表示顶级分类 */
  parentId: idSchema.nullable().optional(),
  code: z.string().trim().toUpperCase().regex(CATEGORY_CODE_PATTERN),
  ...categoryFields,
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** 不能改 code、parentId（R03-1），请求里带了也会被忽略 */
export const updateCategorySchema = z.object(categoryFields);
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const enableStatusSchema = z.object({ status: z.enum(['ENABLED', 'DISABLED']) });
export type EnableStatusInput = z.infer<typeof enableStatusSchema>;

// ---------- 材料库（R03-4 ~ R03-6） ----------

/** 物料编码：字母、数字和 . _ / -，自动转大写；留空自动生成 MAT-000001 */
export const MATERIAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,49}$/;

const materialFilterFields = {
  /** 匹配编码、中英文名称、规格 */
  keyword: optionalText(100),
  /** 包含所有下级分类 */
  categoryId: idSchema.optional(),
  status: z.enum(['ENABLED', 'DISABLED']).optional(),
};

export const materialListQuerySchema = pageQuerySchema.extend(materialFilterFields);
export type MaterialListQuery = z.infer<typeof materialListQuerySchema>;

export const materialExportQuerySchema = z.object(materialFilterFields);
export type MaterialExportQuery = z.infer<typeof materialExportQuerySchema>;

const materialFields = {
  nameZh: requiredText(100),
  nameEn: optionalText(100),
  spec: requiredText(200),
  unitCode: requiredText(50),
  categoryId: idSchema,
  brand: optionalText(100),
  remark: optionalText(1000),
  /** 最多 1 张图片（kind = MATERIAL_IMAGE）；null 表示没有图片 */
  imageFileId: idSchema.nullable().default(null),
};

export const createMaterialSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(new RegExp(`^$|${MATERIAL_CODE_PATTERN.source}`))
    .optional()
    .transform((v) => (v ? v : undefined)),
  ...materialFields,
});
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

/** 不能改 code（R03-4） */
export const updateMaterialSchema = z.object(materialFields);
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
