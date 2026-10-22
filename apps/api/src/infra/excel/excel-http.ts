import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { contentDisposition } from '../files/file-types';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** multer 的硬上限；导入文件的实际上限（10MB）由各导入 service 判断，超出时返回 FILE_TOO_LARGE */
export const IMPORT_HARD_LIMIT_BYTES = 20 * 1024 * 1024;

/** 导入模板、导出文件的下载响应 */
export function xlsxFile(res: Response, name: string, buffer: Buffer): StreamableFile {
  res.set({
    'Content-Type': XLSX_MIME,
    'Content-Disposition': contentDisposition('attachment', name),
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(buffer);
}
