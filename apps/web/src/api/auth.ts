import type { ChangePasswordInput, Locale, LoginInput, MeDto } from '@quoteflow/shared';
import { get, post, put } from './http';

export const authApi = {
  login: (body: LoginInput) => post<MeDto>('/auth/login', body, { silent: true, skipAuthRedirect: true }),
  logout: () => post<{ ok: true }>('/auth/logout', undefined, { silent: true, skipAuthRedirect: true }),
  me: () => get<MeDto>('/auth/me', undefined, { silent: true, skipAuthRedirect: true }),
  updateLocale: (locale: Locale) => put<MeDto>('/auth/me/locale', { locale }),
  changePassword: (body: ChangePasswordInput) => put<{ ok: true }>('/auth/me/password', body, { silent: true }),
  forgotPassword: (email: string) =>
    post<{ ok: true }>('/auth/forgot-password', { email }, { silent: true, skipAuthRedirect: true }),
  resetPassword: (token: string, newPassword: string) =>
    post<{ ok: true }>('/auth/reset-password', { token, newPassword }, { silent: true, skipAuthRedirect: true }),
};
