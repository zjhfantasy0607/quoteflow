import type { FileDto, SheetPreviewDto, UploadKind } from '@quoteflow/shared';
import { get, http } from './http';

export const filesApi = {
  /** 上传后得到 fileId，再由业务接口引用；出错不弹全局提示，由上传组件处理 */
  upload: async (file: File, kind: UploadKind, onProgress?: (percent: number) => void): Promise<FileDto> => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    const res = await http.post<FileDto>('/files', form, {
      silent: true,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
    return res.data;
  },
  meta: (id: string) => get<FileDto>(`/files/${id}/meta`),
  sheetPreview: (id: string) =>
    get<SheetPreviewDto>(`/files/${id}/sheet-preview`, undefined, { silent: true }),
  /**
   * 在线预览（inline）或下载（attachment）地址；同源请求会带上会话 cookie。
   * thumbnail：内部页面自动加载的缩略图，不记访问日志（点开放大用不带它的地址，照样记）
   */
  contentUrl: (id: string, disposition: 'inline' | 'attachment' = 'attachment', thumbnail = false) =>
    `/api/files/${id}/content?disposition=${disposition}${thumbnail ? '&thumbnail=true' : ''}`,
};
