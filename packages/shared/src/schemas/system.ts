import { z } from 'zod';
import { LOCALES } from '../enums';
import { idSchema, optionalText, pageQuerySchema, requiredText } from './common';

/** 可选邮箱：空串视为未填 */
export const optionalEmail = z
  .union([z.literal(''), z.string().trim().email().max(100)])
  .optional()
  .transform((v) => (v ? v : undefined));

// ---------- 用户 ----------

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

export const userListQuerySchema = pageQuerySchema.extend({
  keyword: optionalText(100),
  status: z.enum(['ACTIVE', 'DISABLED', 'PENDING_ACTIVATION']).optional(),
  roleId: idSchema.optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

const userFields = {
  name: requiredText(50),
  email: optionalEmail,
  phone: optionalText(30),
  departmentCode: optionalText(50),
  locale: z.enum(LOCALES).default('zh-CN'),
  roleIds: z.array(idSchema).min(1).max(10),
  remark: optionalText(500),
};

export const createUserSchema = z.object({
  username: z.string().trim().regex(USERNAME_PATTERN),
  password: z.string().min(1).max(200),
  ...userFields,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object(userFields);
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });
export type UserStatusInput = z.infer<typeof userStatusSchema>;

export const resetPasswordSchema = z.object({ newPassword: z.string().min(1).max(200) });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ---------- 角色 ----------

export const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;

const roleFields = {
  nameZh: requiredText(50),
  nameEn: requiredText(100),
  description: optionalText(200),
  dataScope: z.enum(['SELF', 'DEPT', 'ALL']),
  permissions: z.array(z.string().max(64)).max(200),
  fieldPermissions: z.array(z.string().max(64)).max(20),
};

export const createRoleSchema = z.object({
  code: z.string().trim().regex(ROLE_CODE_PATTERN),
  ...roleFields,
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object(roleFields);
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

// ---------- 字典（读取） ----------

export const dictQuerySchema = z.object({
  types: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))]),
});
export type DictQuery = z.infer<typeof dictQuerySchema>;
