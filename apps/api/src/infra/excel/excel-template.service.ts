import { Global, Injectable, Module } from '@nestjs/common';
import type { ExcelHeaderErrorDetails, ExcelRowError } from '@quoteflow/shared';
import { Workbook, type CellValue, type Worksheet } from 'exceljs';
import { AppException } from '../../common/errors/app.exception';

export const MAX_IMPORT_ROWS = 5000;
const MAX_REPORTED_ERRORS = 200;

export type ExcelCellType = 'string' | 'integer' | 'decimal' | 'email';

export interface ExcelColumn {
  key: string;
  /** 表头文字，统一写"中文 / English"，导入时必须完全一致 */
  header: string;
  required?: boolean;
  type?: ExcelCellType;
  maxLength?: number;
  /** decimal 的最大小数位 */
  precision?: number;
  min?: number;
  width?: number;
  /** 下拉选项（只用于模板里的数据验证提示，取值校验由调用方做） */
  options?: string[];
  /**
   * 文件里可以整列没有（只能是最后几列）。用于"导出比模板多几列、导出文件改完可以直接导入"的场景，
   * 如材料导出多一列"状态"（R03-8）；没有这一列时取值为 null。
   */
  omittable?: boolean;
}

export interface ExcelSheetDef {
  sheetName: string;
  columns: ExcelColumn[];
  instructions?: string[];
}

export type ExcelValue = string | number | null;

export interface ParsedRow {
  /** Excel 行号（表头是第 1 行） */
  row: number;
  values: Record<string, ExcelValue>;
}

/** 表头规范化：去首尾空白、合并空白、全角斜杠转半角、斜杠两侧去空格 */
export function normalizeHeader(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/／/g, '/')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();
}

/** ExcelJS 单元格值 → 字符串 / 数字 / null */
export function cellToValue(value: CellValue): ExcelValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return cellToValue(value.richText.map((r) => r.text).join(''));
    if ('result' in value) return cellToValue((value.result ?? null) as CellValue);
    if ('text' in value) return cellToValue(value.text as CellValue);
    if ('error' in value) return null;
  }
  return null;
}

function decimals(text: string): number {
  const i = text.indexOf('.');
  return i < 0 ? 0 : text.length - i - 1;
}

/**
 * 标准模板导入导出（#29）：表头名称与顺序必须完全一致，否则整表拒绝；
 * 任何一行有错就整表拒绝，不做智能识别（R02-9）。
 */
@Injectable()
export class ExcelTemplateService {
  async build(def: ExcelSheetDef, rows: Record<string, unknown>[] = []): Promise<Buffer> {
    const wb = new Workbook();
    const ws = wb.addWorksheet(def.sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = def.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
    const header = ws.getRow(1);
    header.height = 22;
    def.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.font = { bold: true, color: { argb: c.required ? 'FFC0392B' : 'FF1F2937' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { vertical: 'middle' };
    });
    for (const row of rows) ws.addRow(def.columns.map((c) => row[c.key] ?? null));
    def.columns.forEach((c, i) => {
      if (!c.options?.length) return;
      const list = `"${c.options.join(',')}"`;
      if (list.length > 255) return;
      for (let r = 2; r <= Math.max(rows.length + 1, 500); r += 1) {
        ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [list] };
      }
    });
    if (def.instructions?.length) {
      const help = wb.addWorksheet('说明 Instructions');
      help.getColumn(1).width = 110;
      def.instructions.forEach((line) => help.addRow([line]));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async parse(def: ExcelSheetDef, buffer: Buffer): Promise<{ rows: ParsedRow[]; errors: ExcelRowError[] }> {
    const wb = new Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new AppException('EXCEL_PARSE_FAILED');
    }
    const ws: Worksheet | undefined = wb.getWorksheet(def.sheetName) ?? wb.worksheets[0];
    if (!ws) throw new AppException('EXCEL_PARSE_FAILED');

    const present = this.checkHeader(def, ws);

    const rows: ParsedRow[] = [];
    const errors: ExcelRowError[] = [];
    for (let r = 2; r <= ws.rowCount; r += 1) {
      const raw = def.columns.map((_, i) => (i < present ? cellToValue(ws.getRow(r).getCell(i + 1).value) : null));
      if (raw.every((v) => v === null)) continue;
      if (rows.length >= MAX_IMPORT_ROWS) throw new AppException('EXCEL_TOO_MANY_ROWS', { max: MAX_IMPORT_ROWS });
      const values: Record<string, ExcelValue> = {};
      def.columns.forEach((col, i) => {
        values[col.key] = this.convert(col, raw[i], r, errors);
      });
      rows.push({ row: r, values });
    }
    if (rows.length === 0) throw new AppException('EXCEL_EMPTY');
    return { rows, errors };
  }

  /** 有行错误时整表拒绝（最多返回 200 条） */
  assertNoRowErrors(errors: ExcelRowError[]): void {
    if (errors.length === 0) return;
    const sorted = [...errors].sort((a, b) => a.row - b.row);
    throw new AppException('EXCEL_ROWS_INVALID', { count: errors.length }, sorted.slice(0, MAX_REPORTED_ERRORS));
  }

  /** 表头一致时返回文件里实际有的列数（末尾的可省略列可能不在） */
  private checkHeader(def: ExcelSheetDef, ws: Worksheet): number {
    const all = def.columns.map((c) => normalizeHeader(c.header));
    let required = all.length;
    while (required > 0 && def.columns[required - 1].omittable) required -= 1;
    const width = Math.max(ws.getRow(1).cellCount, all.length);
    const actual: string[] = [];
    for (let i = 1; i <= width; i += 1) {
      const v = cellToValue(ws.getRow(1).getCell(i).value);
      actual.push(v === null ? '' : normalizeHeader(String(v)));
    }
    while (actual.length && actual[actual.length - 1] === '') actual.pop();
    const same = actual.length >= required && actual.length <= all.length && actual.every((h, i) => h === all[i]);
    if (same) return actual.length;
    // 文件里出现了可省略列，就按完整表头比较，否则按模板表头比较，提示才准确
    const expected = actual.some((h) => all.indexOf(h) >= required) ? all : all.slice(0, required);
    const details: ExcelHeaderErrorDetails = {
      expected,
      actual,
      missing: expected.filter((h) => !actual.includes(h)),
      extra: actual.filter((h) => h !== '' && !expected.includes(h)),
      orderMismatch: false,
    };
    details.orderMismatch = details.missing.length === 0 && details.extra.length === 0;
    throw new AppException('EXCEL_HEADER_MISMATCH', undefined, details);
  }

  private convert(col: ExcelColumn, value: ExcelValue, row: number, errors: ExcelRowError[]): ExcelValue {
    const err = (code: string, message: string, params?: Record<string, string | number>) => {
      errors.push({ row, column: col.header, code, message, ...(params ? { params } : {}) });
      return null;
    };
    if (value === null) return col.required ? err('required', 'Required') : null;
    const type = col.type ?? 'string';
    if (type === 'string' || type === 'email') {
      const text = typeof value === 'number' ? String(value) : value;
      if (col.maxLength && text.length > col.maxLength) return err('too_long', 'Too long', { max: col.maxLength });
      if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return err('invalid_email', 'Invalid email');
      return text;
    }
    const text = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(text)) return err(type === 'integer' ? 'invalid_integer' : 'invalid_number', 'Not a number');
    if (type === 'integer' && text.includes('.')) return err('invalid_integer', 'Not an integer');
    if (type === 'decimal' && col.precision !== undefined && decimals(text) > col.precision) {
      return err('too_many_decimals', 'Too many decimals', { max: col.precision });
    }
    if (col.min !== undefined && Number(text) < col.min) return err('too_small', 'Too small', { min: col.min });
    return type === 'integer' ? Number(text) : text;
  }
}

@Global()
@Module({ providers: [ExcelTemplateService], exports: [ExcelTemplateService] })
export class ExcelModule {}
