import type { ApiErrorBody, ExcelHeaderErrorDetails, ExcelRowError } from '@quoteflow/shared';
import { translateError } from '@/api/http';
import { i18n } from '@/i18n';

/** 标准 Excel 导入失败时给 ExcelImportDialog 展示的内容（R02-9） */
export type ImportErrorView =
  | { kind: 'header'; missing: string[]; extra: string[]; orderMismatch: boolean; expected: string[] }
  | { kind: 'rows'; total: number; rows: { row: number; column: string; message: string }[] }
  | { kind: 'other'; message: string };

/** 行错误按 excel.rowErrors.<code> 翻译，没有翻译的显示后端原文 */
export function rowErrorMessage(e: ExcelRowError): string {
  const { t, te } = i18n.global;
  const key = `excel.rowErrors.${e.code}`;
  return te(key) ? t(key, e.params ?? {}) : e.message;
}

export function importErrorView(body: ApiErrorBody | undefined): ImportErrorView {
  if (body?.code === 'EXCEL_HEADER_MISMATCH' && body.details) {
    const d = body.details as ExcelHeaderErrorDetails;
    return { kind: 'header', missing: d.missing, extra: d.extra, orderMismatch: d.orderMismatch, expected: d.expected };
  }
  if (body?.code === 'EXCEL_ROWS_INVALID' && Array.isArray(body.details)) {
    const rows = (body.details as ExcelRowError[]).map((e) => ({ row: e.row, column: e.column, message: rowErrorMessage(e) }));
    const total = typeof body.params?.count === 'number' ? body.params.count : rows.length;
    return { kind: 'rows', total, rows };
  }
  return { kind: 'other', message: translateError(body) };
}
