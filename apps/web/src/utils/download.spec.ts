import { AxiosError, type AxiosResponse } from 'axios';
import { ElMessage } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http } from '@/api/http';
import { applyLocale, i18n } from '@/i18n';
import { downloadFile, filenameFromDisposition } from './download';

describe('filenameFromDisposition', () => {
  it('优先取 RFC 5987 的 filename*，中文文件名能正确解码', () => {
    const header = `attachment; filename="____.xlsx"; filename*=UTF-8''${encodeURIComponent('材料库-20261021.xlsx')}`;
    expect(filenameFromDisposition(header)).toBe('材料库-20261021.xlsx');
  });

  it('没有 filename* 时取 filename；没有头时返回 null', () => {
    expect(filenameFromDisposition('attachment; filename="materials.xlsx"')).toBe('materials.xlsx');
    expect(filenameFromDisposition('attachment; filename=plain.xlsx')).toBe('plain.xlsx');
    expect(filenameFromDisposition(undefined)).toBeNull();
  });
});

describe('downloadFile', () => {
  const clicked: string[] = [];

  beforeEach(() => {
    applyLocale('zh-CN');
    clicked.length = 0;
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('用响应头里的文件名保存', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('材料库.xlsx')}` },
    });
    await expect(downloadFile('/materials/export', { status: 'ENABLED' })).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledWith('/materials/export', expect.objectContaining({ responseType: 'blob' }));
    expect(clicked).toEqual(['材料库.xlsx']);
  });

  it('失败时把 Blob 里的错误体读出来按错误码提示', async () => {
    const response = {
      status: 403,
      data: new Blob([JSON.stringify({ code: 'FORBIDDEN', message: 'Forbidden' })], { type: 'application/json' }),
    } as AxiosResponse;
    vi.spyOn(http, 'get').mockRejectedValue(new AxiosError('fail', 'ERR_BAD_REQUEST', undefined, undefined, response));
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: () => undefined }));
    await expect(downloadFile('/materials/export')).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith(i18n.global.t('errors.FORBIDDEN'));
    expect(clicked).toEqual([]);
  });
});
