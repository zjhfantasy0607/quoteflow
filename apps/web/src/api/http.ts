import { isErrorCode, type ApiErrorBody } from '@quoteflow/shared';
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import { i18n } from '@/i18n';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** 出错时不弹全局提示，由调用方自己处理 */
    silent?: boolean;
    /** 401 时不跳登录页（取当前用户、登录本身） */
    skipAuthRedirect?: boolean;
  }
}

export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 60_000,
  // 后端 CSRF 防护要求非 GET 请求带这个头
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

/** 把错误响应翻译成当前语言的提示 */
export function translateError(body: Partial<ApiErrorBody> | undefined): string {
  const { t, te } = i18n.global;
  if (body?.code && isErrorCode(body.code) && te(`errors.${body.code}`)) {
    return t(`errors.${body.code}`, (body.params ?? {}) as Record<string, unknown>);
  }
  return body?.message ?? t('errors.INTERNAL_ERROR');
}

/** 401 时的处理（登录过期 → 回登录页），由 main.ts 注册 */
let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

http.interceptors.response.use(
  (res) => res,
  (error: AxiosError<ApiErrorBody>) => {
    const body = error.response?.data;
    if (error.response?.status === 401 && !error.config?.skipAuthRedirect && onUnauthenticated) {
      onUnauthenticated();
    } else if (!error.config?.silent) {
      ElMessage.error(translateError(body));
    }
    return Promise.reject(error);
  },
);

export async function get<T>(url: string, params?: object, config?: AxiosRequestConfig): Promise<T> {
  return (await http.get<T>(url, { ...config, params })).data;
}

export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await http.post<T>(url, data, config)).data;
}

export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await http.put<T>(url, data, config)).data;
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await http.delete<T>(url, config)).data;
}

/** 取接口错误体（调用方需要按错误码或 details 处理时用） */
export function apiError(error: unknown): ApiErrorBody | undefined {
  return error instanceof AxiosError ? (error.response?.data as ApiErrorBody | undefined) : undefined;
}
