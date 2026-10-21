import type { ApiErrorBody } from '@quoteflow/shared';
import { AxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { http, translateError } from '@/api/http';

/** 从 Content-Disposition 取文件名（优先 RFC 5987 的 filename*） */
export function filenameFromDisposition(header: string | undefined | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // 编码不合法时退回普通 filename
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** 下载失败时响应体是 Blob，要先读成 JSON 才能按错误码翻译 */
async function blobError(error: unknown): Promise<ApiErrorBody | undefined> {
  const data = error instanceof AxiosError ? error.response?.data : undefined;
  if (!(data instanceof Blob)) return undefined;
  try {
    return JSON.parse(await data.text()) as ApiErrorBody;
  } catch {
    return undefined;
  }
}

/** 用当前会话下载接口返回的文件（导出等）；出错时按错误码提示，返回 false */
export async function downloadFile(url: string, params?: object, fallbackName = 'download'): Promise<boolean> {
  try {
    const res = await http.get<Blob>(url, { params, responseType: 'blob', silent: true });
    const name = filenameFromDisposition(res.headers['content-disposition'] as string | undefined) ?? fallbackName;
    const href = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 0);
    return true;
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 401) return false;
    ElMessage.error(translateError(await blobError(err)));
    return false;
  }
}
