import { z } from 'zod';
import { LOCALES } from '../enums';

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateLocaleSchema = z.object({ locale: z.enum(LOCALES) });
export type UpdateLocaleInput = z.infer<typeof updateLocaleSchema>;

/** 密码规则：8–100 位，同时包含字母和数字（不满足时后端返回 AUTH_PASSWORD_WEAK） */
export function isStrongPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 100 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
