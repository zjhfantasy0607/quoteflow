import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  Dec,
  PPL_DECIMAL_TYPES,
  PPL_FORMULAS,
  buildPrefillValues,
  isPplFormulaName,
  validateQuoteValues,
  type ExcelHeaderErrorDetails,
  type ExcelRowError,
  type Locale,
  type PplColumn,
  type PplDictLookup,
  type PplFormulaName,
  type PplGroup,
  type PplPrefillLine,
  type PplResolvedColumn,
  type PplValues,
} from '@quoteflow/shared';
import { Workbook, type Cell, type CellValue, type DataValidation, type Fill, type Worksheet } from 'exceljs';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { formatMailTime } from '../../common/time';
import { AppConfig } from '../../config/app-config';
import { cellToValue, normalizeHeader } from '../../infra/excel/excel-template.service';

export const PPL_EXCEL_KIND = 'QF_PPL_QUOTE';
export const PPL_QUOTE_SHEET = '报价 Quote';
export const PPL_HELP_SHEET = '说明 Instructions';
export const PPL_LISTS_SHEET = '_lists';
export const PPL_META_SHEET = '_meta';
/** 第 1 行分组、第 2 行标签、第 3 行 key（隐藏），第 4 行起是询价行 */
export const PPL_FIRST_DATA_ROW = 4;
const MAX_IMPORT_MB = 10;
const MAX_REPORTED_ERRORS = 200;
const BOOL_TRUE = '是 / Yes';
const BOOL_FALSE = '否 / No';
const TRUE_TEXTS = new Set(['是 / yes', '是', 'yes', 'y', 'true', '1']);
const FALSE_TEXTS = new Set(['否 / no', '否', 'no', 'n', 'false', '0']);

const PREFILL_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const FORMULA_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
const HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

/** 签名覆盖的 _meta 字段，顺序固定（04 §7.3） */
const SIGNED_KEYS = [
  'kind',
  'quoteId',
  'roundId',
  'templateVersion',
  'variantCode',
  'columnKeys',
  'lineIds',
] as const;
type SignedKey = (typeof SIGNED_KEYS)[number];

/** 公式列在 Excel 里的写法，便于供应商核对；导入时忽略这些单元格，由服务端重算 */
const EXCEL_FORMULAS: Record<PplFormulaName, (refs: string[], dp: number) => string> = {
  exclTax: ([price, rate], dp) => `ROUND(${price}/(1+${rate}/100),${dp})`,
  lineTotal: ([price, qty], dp) => `ROUND(${price}*${qty},${dp})`,
  cbm: ([l, w, h], dp) => `ROUND(${l}*${w}*${h}/1000000,${dp})`,
};

export interface PplDictOption {
  code: string;
  nameZh: string;
  nameEn: string;
}

export interface PplExcelLine extends PplPrefillLine {
  id: string;
}

/** 生成和导入锁定 Excel 用的上下文：目标报价单、该轮冻结的模板、询价行与字典选项（M09 组装） */
export interface PplExcelContext {
  quoteId: string;
  roundId: string;
  formalNo: string;
  roundNo: number;
  templateVersion: number;
  variantCode: string;
  groups: readonly PplGroup[];
  columns: readonly PplResolvedColumn[];
  lines: readonly PplExcelLine[];
  /** 枚举列的启用选项：dictType → 选项 */
  dictOptions: Readonly<Record<string, readonly PplDictOption[]>>;
}

export interface PplExcelBuildOptions {
  /** 已有草稿或当前版本的取值（按 lineId），再次下载时不丢已填内容 */
  values?: Readonly<Record<string, PplValues>>;
  /** 报价截止时间，写进说明页 */
  deadline?: Date | null;
  /** 预填列里名称类取值的语言 */
  locale?: Locale;
}

/** 表头第 2 行："含税单价 *⏎Unit Price (incl. tax)" */
function headerLabel(column: PplResolvedColumn): string {
  return `${column.labelZh}${column.required ? ' *' : ''}\n${column.labelEn}`;
}

/** 行错误里的列名："含税单价 / Unit Price (incl. tax)"（R05-8） */
function columnLabel(column: PplColumn): string {
  return `${column.labelZh} / ${column.labelEn}`;
}

const optionText = (o: PplDictOption) => `${o.nameZh} / ${o.nameEn}`;

function sortedLines(lines: readonly PplExcelLine[]): PplExcelLine[] {
  return [...lines].sort((a, b) => a.lineNo - b.lineNo);
}

function numFmt(column: PplColumn): string | undefined {
  if (PPL_DECIMAL_TYPES.includes(column.type)) {
    const dp = column.precision ?? 0;
    return dp > 0 ? `0.${'0'.repeat(dp)}` : '0';
  }
  if (column.type === 'date') return 'yyyy-mm-dd';
  if (column.type === 'text' || column.type === 'textarea' || column.type === 'multiEnum') return '@';
  return undefined;
}

/** Excel 序列日期 → YYYY-MM-DD（单元格没被识别成日期时） */
function serialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  return new Date(Math.round((serial - 25569) * 86_400_000)).toISOString().slice(0, 10);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function headerMismatch(expected: string[], actual: string[]): AppException {
  const details: ExcelHeaderErrorDetails = {
    expected,
    actual,
    missing: expected.filter((h) => !actual.includes(h)),
    extra: actual.filter((h) => h !== '' && !expected.includes(h)),
    orderMismatch: false,
  };
  details.orderMismatch = details.missing.length === 0 && details.extra.length === 0;
  return new AppException('EXCEL_HEADER_MISMATCH', undefined, details);
}

/** reason：not_template（不是本系统模板）/ tampered（被篡改）/ outdated（不是本单本轮的模板或已过期） */
function templateMismatch(reason: 'not_template' | 'tampered' | 'outdated'): AppException {
  return new AppException('EXCEL_TEMPLATE_MISMATCH', { reason });
}

/**
 * PPL 锁定 Excel（04 §7）：生成供应商下载的报价模板，导入时校验签名、表头和取值。
 * 导入只返回解析好的取值或错误，不写数据库（写草稿由 M09 负责，R05-7）。
 */
@Injectable()
export class PplExcelService {
  constructor(
    private readonly config: AppConfig,
    private readonly clock: ClockService,
  ) {}

  async build(ctx: PplExcelContext, options: PplExcelBuildOptions = {}): Promise<Buffer> {
    const columns = ctx.columns;
    const lines = sortedLines(ctx.lines);
    const wb = new Workbook();
    wb.creator = 'QuoteFlow';
    const ws = wb.addWorksheet(PPL_QUOTE_SHEET, {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 3, topLeftCell: 'D4' }],
    });
    const help = wb.addWorksheet(PPL_HELP_SHEET);
    const lists = wb.addWorksheet(PPL_LISTS_SHEET, { state: 'veryHidden' });
    const meta = wb.addWorksheet(PPL_META_SHEET, { state: 'veryHidden' });

    this.writeHeader(ws, ctx);
    const listRanges = this.writeLists(lists, ctx);
    const letters = new Map(columns.map((c, i) => [c.key, ws.getColumn(i + 1).letter]));
    const locale = options.locale ?? 'zh-CN';
    lines.forEach((line, index) => {
      const row = PPL_FIRST_DATA_ROW + index;
      const prefill = buildPrefillValues(columns, line, locale);
      const values = options.values?.[line.id] ?? {};
      columns.forEach((column, i) => {
        const cell = ws.getCell(row, i + 1);
        const fmt = numFmt(column);
        if (fmt) cell.numFmt = fmt;
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } } };
        if (column.source === 'prefill') {
          cell.value = this.toCellValue(column, prefill[column.key], ctx);
          cell.fill = PREFILL_FILL;
        } else if (column.source === 'formula') {
          cell.value = { formula: this.formula(column, row, letters) };
          cell.fill = FORMULA_FILL;
        } else {
          cell.value = this.toCellValue(column, values[column.key], ctx);
          cell.protection = { locked: false };
          const validation = this.validation(column, listRanges);
          if (validation) cell.dataValidation = validation;
        }
      });
    });
    await ws.protect(this.config.get('EXCEL_SHEET_PASSWORD'), {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatColumns: true,
    });

    this.writeHelp(help, ctx, options.deadline ?? null);
    const metaValues: Record<SignedKey, string> = this.metaFields(ctx);
    const rows: [string, string][] = [
      ...SIGNED_KEYS.map((key): [string, string] => [key, metaValues[key]]),
      ['formalNo', ctx.formalNo],
      ['roundNo', String(ctx.roundNo)],
      ['generatedAt', this.clock.now().toISOString()],
      ['signature', this.sign(metaValues)],
    ];
    rows.forEach(([key, value]) => meta.addRow([key, value]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * 04 §7.4：校验模板、签名、表头与数据行，返回规范化并重算公式后的取值（按 lineId）。
   * mode 默认 submit（04 §7.4 第 8 步：必填与类型都校验）。
   */
  async parse(
    ctx: PplExcelContext,
    buffer: Buffer,
    mode: 'draft' | 'submit' = 'submit',
  ): Promise<Record<string, PplValues>> {
    if (buffer.length > MAX_IMPORT_MB * 1024 * 1024)
      throw new AppException('FILE_TOO_LARGE', { maxMB: MAX_IMPORT_MB });
    const wb = new Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new AppException('EXCEL_PARSE_FAILED');
    }
    this.checkMeta(wb, ctx);
    const ws = wb.getWorksheet(PPL_QUOTE_SHEET);
    if (!ws) throw templateMismatch('not_template');
    const columns = ctx.columns;
    this.checkHeader(ws, columns);

    const lines = sortedLines(ctx.lines);
    const errors: ExcelRowError[] = [];
    const raw: Record<string, Record<string, unknown>> = {};
    const lineNoIndex = columns.findIndex((c) => c.source === 'prefill' && c.prefillFrom === 'lineNo');
    lines.forEach((line, index) => {
      const row = ws.getRow(PPL_FIRST_DATA_ROW + index);
      if (
        lineNoIndex >= 0 &&
        String(cellToValue(row.getCell(lineNoIndex + 1).value) ?? '') !== String(line.lineNo)
      ) {
        errors.push({
          row: row.number,
          column: columnLabel(columns[lineNoIndex]),
          code: 'line_mismatch',
          message: `Expected line ${line.lineNo}`,
          params: { lineNo: line.lineNo },
        });
      }
      const values: Record<string, unknown> = {};
      columns.forEach((column, i) => {
        if (column.source === 'supplier')
          values[column.key] = this.readCell(column, row.getCell(i + 1).value, ctx);
      });
      raw[line.id] = values;
    });
    for (let r = PPL_FIRST_DATA_ROW + lines.length; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r);
      if (columns.some((_, i) => cellToValue(row.getCell(i + 1).value) !== null)) {
        errors.push({
          row: r,
          column: '',
          code: 'unexpected_row',
          message: 'Unexpected row below the quotation lines',
        });
      }
    }

    const dict: PplDictLookup = Object.fromEntries(
      Object.entries(ctx.dictOptions).map(([type, options]) => [type, options.map((o) => o.code)]),
    );
    const result = validateQuoteValues(columns, lines, raw, dict, { mode });
    const rowOf = new Map(lines.map((line, index) => [line.id, PPL_FIRST_DATA_ROW + index]));
    const byKey = new Map(columns.map((c) => [c.key, c]));
    for (const e of result.errors) {
      const column = byKey.get(e.key);
      errors.push({
        row: rowOf.get(e.lineId) ?? 0,
        column: column ? columnLabel(column) : e.key,
        code: e.code,
        message: e.message,
        ...(e.params ? { params: e.params } : {}),
      });
    }
    if (errors.length > 0) {
      const sorted = [...errors].sort((a, b) => a.row - b.row);
      throw new AppException(
        'EXCEL_ROWS_INVALID',
        { count: errors.length },
        sorted.slice(0, MAX_REPORTED_ERRORS),
      );
    }
    return result.values;
  }

  private metaFields(ctx: PplExcelContext): Record<SignedKey, string> {
    return {
      kind: PPL_EXCEL_KIND,
      quoteId: ctx.quoteId,
      roundId: ctx.roundId,
      templateVersion: String(ctx.templateVersion),
      variantCode: ctx.variantCode,
      columnKeys: ctx.columns.map((c) => c.key).join(','),
      lineIds: sortedLines(ctx.lines)
        .map((l) => l.id)
        .join(','),
    };
  }

  private sign(fields: Record<SignedKey, string>): string {
    return createHmac('sha256', this.config.get('EXCEL_SIGNING_SECRET'))
      .update(SIGNED_KEYS.map((key) => fields[key]).join('|'))
      .digest('hex');
  }

  /** 第 2–4 步：_meta 存在且 kind 正确、签名正确、是本报价单本轮次当前模板 */
  private checkMeta(wb: Workbook, ctx: PplExcelContext): void {
    const sheet = wb.getWorksheet(PPL_META_SHEET);
    if (!sheet) throw templateMismatch('not_template');
    const meta = new Map<string, string>();
    sheet.eachRow((row) => {
      const key = cellToValue(row.getCell(1).value);
      if (key !== null) meta.set(String(key), String(cellToValue(row.getCell(2).value) ?? ''));
    });
    if (meta.get('kind') !== PPL_EXCEL_KIND) throw templateMismatch('not_template');

    const fromFile = Object.fromEntries(SIGNED_KEYS.map((key) => [key, meta.get(key) ?? ''])) as Record<
      SignedKey,
      string
    >;
    const expected = Buffer.from(this.sign(fromFile), 'utf8');
    const actual = Buffer.from(meta.get('signature') ?? '', 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw templateMismatch('tampered');

    const current = this.metaFields(ctx);
    if (SIGNED_KEYS.some((key) => fromFile[key] !== current[key])) throw templateMismatch('outdated');
  }

  /** 第 5 步：第 3 行 key 与第 2 行标签都与模板一致，否则整表拒绝 */
  private checkHeader(ws: Worksheet, columns: readonly PplResolvedColumn[]): void {
    const read = (rowNumber: number): string[] => {
      const row = ws.getRow(rowNumber);
      const width = Math.max(row.cellCount, columns.length);
      const values: string[] = [];
      for (let i = 1; i <= width; i += 1) {
        const v = cellToValue(row.getCell(i).value);
        values.push(v === null ? '' : normalizeHeader(String(v)));
      }
      while (values.length > 0 && values[values.length - 1] === '') values.pop();
      return values;
    };
    const keys = columns.map((c) => c.key);
    const actualKeys = read(3);
    if (!sameList(actualKeys, keys)) throw headerMismatch(keys, actualKeys);
    const labels = columns.map((c) => normalizeHeader(headerLabel(c)));
    const actualLabels = read(2);
    if (!sameList(actualLabels, labels)) throw headerMismatch(labels, actualLabels);
  }

  private writeHeader(ws: Worksheet, ctx: PplExcelContext): void {
    const columns = ctx.columns;
    const groups = new Map(ctx.groups.map((g) => [g.key, g]));
    let start = 0;
    for (let i = 1; i <= columns.length; i += 1) {
      if (i < columns.length && columns[i].group === columns[start].group) continue;
      const group = groups.get(columns[start].group);
      ws.getCell(1, start + 1).value = group ? `${group.labelZh} / ${group.labelEn}` : columns[start].group;
      if (i - 1 > start) ws.mergeCells(1, start + 1, 1, i);
      start = i;
    }
    columns.forEach((column, i) => {
      ws.getColumn(i + 1).width = Math.max(8, Math.round((column.width ?? 110) / 7));
      const group = ws.getCell(1, i + 1);
      group.font = { bold: true };
      group.alignment = { horizontal: 'center', vertical: 'middle' };
      group.fill = HEADER_FILL;
      const label = ws.getCell(2, i + 1);
      label.value = headerLabel(column);
      label.font = { bold: true, color: { argb: column.required ? 'FFC0392B' : 'FF1F2937' } };
      label.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
      label.fill = HEADER_FILL;
      const key = ws.getCell(3, i + 1);
      key.value = column.key;
      key.font = { size: 8, color: { argb: 'FF9CA3AF' } };
    });
    ws.getRow(1).height = 20;
    ws.getRow(2).height = 36;
    ws.getRow(3).hidden = true;
  }

  /** 每个 enum 列一列选项（"中文 / English"），返回数据验证引用的区域 */
  private writeLists(lists: Worksheet, ctx: PplExcelContext): Map<string, string> {
    const ranges = new Map<string, string>();
    let col = 0;
    for (const column of ctx.columns) {
      if (column.type !== 'enum' || column.source !== 'supplier') continue;
      const options = ctx.dictOptions[column.dictType ?? ''] ?? [];
      col += 1;
      lists.getCell(1, col).value = column.key;
      options.forEach((o, j) => {
        lists.getCell(j + 2, col).value = optionText(o);
      });
      const letter = lists.getColumn(col).letter;
      if (options.length > 0)
        ranges.set(column.key, `'${PPL_LISTS_SHEET}'!$${letter}$2:$${letter}$${options.length + 1}`);
    }
    return ranges;
  }

  private writeHelp(help: Worksheet, ctx: PplExcelContext, deadline: Date | null): void {
    help.getColumn(1).width = 120;
    const required = ctx.columns.filter((c) => c.required).map(columnLabel);
    const multi = ctx.columns
      .filter((c) => c.type === 'multiEnum' && c.source === 'supplier')
      .map((c) => {
        const codes = (ctx.dictOptions[c.dictType ?? ''] ?? []).map((o) => `${o.code}（${optionText(o)}）`);
        return `   - ${columnLabel(c)}：${codes.join('，')}`;
      });
    const lines = [
      `询价单 ${ctx.formalNo} 第 ${ctx.roundNo} 轮 / RFQ ${ctx.formalNo}, Round ${ctx.roundNo}`,
      ...(deadline
        ? [
            `报价截止时间：${formatMailTime(deadline, 'zh-CN')} / Quotation deadline: ${formatMailTime(deadline, 'en-US')}`,
          ]
        : []),
      '',
      '1. 请勿修改表格结构：不要插入、删除、移动行或列，不要修改第 1–2 行表头。/ Do not change the sheet structure: do not insert, delete or move rows or columns, and do not edit the headers in rows 1–2.',
      '2. 白色单元格由供应商填写；灰色列由系统带出、浅蓝色列由系统计算，不能修改，导入时以系统重新计算的结果为准。/ Fill in the white cells. Grey columns come from the RFQ and light-blue columns are calculated; they cannot be edited and are recalculated on import.',
      `3. 带 * 的列为必填 / Columns marked * are required：${required.join('，')}`,
      `4. "是否"列从下拉选择"${BOOL_TRUE}"或"${BOOL_FALSE}"。/ Yes/No columns: choose "${BOOL_TRUE}" or "${BOOL_FALSE}" from the list.`,
      '5. 日期写成 YYYY-MM-DD，如 2026-12-31。/ Dates: YYYY-MM-DD, e.g. 2026-12-31.',
      '6. 多选列填写英文逗号分隔的编码，如 CE,UL。可选编码 / Multi-select columns: enter codes separated by commas, e.g. CE,UL. Available codes:',
      ...multi,
      '7. 导入后请在系统中核对，并点击"提交报价"才会生效。/ After importing, review the quotation in the system and click "Submit Quotation" for it to take effect.',
    ];
    lines.forEach((text) => {
      help.addRow([text]).getCell(1).alignment = { wrapText: true, vertical: 'top' };
    });
    help.getRow(1).font = { bold: true };
  }

  private formula(column: PplColumn, row: number, letters: Map<string, string>): string {
    if (!column.formula || !isPplFormulaName(column.formula)) return '""';
    const refs = PPL_FORMULAS[column.formula].inputs.map((key) => `${letters.get(key)}${row}`);
    const guard = refs.map((ref) => `ISNUMBER(${ref})`).join(',');
    return `IF(AND(${guard}),${EXCEL_FORMULAS[column.formula](refs, column.precision ?? 4)},"")`;
  }

  private validation(column: PplColumn, listRanges: Map<string, string>): DataValidation | null {
    const common = { allowBlank: true, showErrorMessage: true, errorStyle: 'stop' };
    const range = (fallbackMin: number, fallbackMax: number): unknown[] => [
      column.min ?? fallbackMin,
      column.max ?? fallbackMax,
    ];
    switch (column.type) {
      case 'enum': {
        const ref = listRanges.get(column.key);
        return ref ? { ...common, type: 'list', formulae: [ref] } : null;
      }
      case 'bool':
        return { ...common, type: 'list', formulae: [`"${BOOL_TRUE},${BOOL_FALSE}"`] };
      case 'int':
        return { ...common, type: 'whole', operator: 'between', formulae: range(-999_999_999, 999_999_999) };
      case 'decimal':
      case 'money':
        return { ...common, type: 'decimal', operator: 'between', formulae: range(-1e15, 1e15) };
      case 'percent':
        return { ...common, type: 'decimal', operator: 'between', formulae: range(0, 100) };
      case 'date':
        return {
          ...common,
          type: 'date',
          operator: 'greaterThan',
          formulae: [new Date(Date.UTC(1900, 0, 1))],
        };
      case 'text':
      case 'textarea':
        return {
          ...common,
          type: 'textLength',
          operator: 'lessThanOrEqual',
          formulae: [column.maxLength ?? (column.type === 'text' ? 200 : 1000)],
        };
      case 'multiEnum':
        // 没有下拉，只给输入提示（ExcelJS 支持 any，类型定义里没有）
        return {
          type: 'any',
          allowBlank: true,
          showInputMessage: true,
          promptTitle: column.labelEn.slice(0, 32),
          prompt: '英文逗号分隔的编码，如 CE,UL / Codes separated by commas, e.g. CE,UL',
          formulae: [],
        } as unknown as DataValidation;
    }
  }

  /** 取值写进单元格：数字类写数字（公式和数据验证要用），枚举写选项文本 */
  private toCellValue(column: PplColumn, value: unknown, ctx: PplExcelContext): CellValue {
    if (value === undefined || value === null || value === '') return null;
    switch (column.type) {
      case 'int':
      case 'decimal':
      case 'money':
      case 'percent':
        return typeof value === 'number' ? value : Number(value);
      case 'date':
        return typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : null;
      case 'bool':
        return value === true ? BOOL_TRUE : value === false ? BOOL_FALSE : null;
      case 'enum': {
        const option = (ctx.dictOptions[column.dictType ?? ''] ?? []).find((o) => o.code === value);
        return option ? optionText(option) : String(value);
      }
      case 'multiEnum':
        return Array.isArray(value) ? value.join(',') : String(value);
      default:
        return String(value);
    }
  }

  /** 第 7 步：单元格（数字、文本、日期、富文本）按列类型转换，最终由 validateQuoteValues 校验 */
  private readCell(column: PplColumn, cellValue: Cell['value'], ctx: PplExcelContext): unknown {
    const value = cellToValue(cellValue);
    if (value === null) return null;
    switch (column.type) {
      case 'decimal':
      case 'money':
      case 'percent':
        return typeof value === 'number' ? new Dec(value).toFixed() : value;
      case 'date':
        return typeof value === 'number' ? (serialToDate(value) ?? String(value)) : value;
      case 'bool': {
        const text = normalizeHeader(String(value)).toLowerCase();
        return TRUE_TEXTS.has(text) ? true : FALSE_TEXTS.has(text) ? false : String(value);
      }
      case 'enum': {
        const text = normalizeHeader(String(value));
        const options = ctx.dictOptions[column.dictType ?? ''] ?? [];
        const lower = text.toLowerCase();
        const option = options.find(
          (o) =>
            normalizeHeader(optionText(o)) === text ||
            o.code.toLowerCase() === lower ||
            o.nameZh === text ||
            o.nameEn.toLowerCase() === lower,
        );
        return option ? option.code : text;
      }
      case 'multiEnum': {
        const options = ctx.dictOptions[column.dictType ?? ''] ?? [];
        return String(value)
          .split(/[,，、;；]/)
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => options.find((o) => o.code.toLowerCase() === part.toLowerCase())?.code ?? part);
      }
      case 'int':
        return value;
      default:
        return typeof value === 'number' ? String(value) : value;
    }
  }
}
