import { PPL_V0, resolveColumns, type ExcelRowError } from '@quoteflow/shared';
import { Workbook, type CellValue, type Worksheet } from 'exceljs';
import type { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import type { AppConfig } from '../../config/app-config';
import {
  PPL_HELP_SHEET,
  PPL_LISTS_SHEET,
  PPL_META_SHEET,
  PPL_QUOTE_SHEET,
  PplExcelService,
  type PplExcelContext,
  type PplExcelLine,
} from './ppl-excel.service';

const env: Record<string, string> = {
  EXCEL_SIGNING_SECRET: 'test-signing-secret',
  EXCEL_SHEET_PASSWORD: 'quoteflow',
};
const config = { get: (key: string) => env[key] } as unknown as AppConfig;
const clock = { now: () => new Date('2026-10-22T02:00:00.000Z') } as unknown as ClockService;
const service = new PplExcelService(config, clock);

const columns = resolveColumns(PPL_V0, 'PPL-LED');
const col = (key: string) => {
  const index = columns.findIndex((c) => c.key === key);
  if (index < 0) throw new Error(key);
  return index + 1;
};

function line(id: string, lineNo: number, quantity: string): PplExcelLine {
  return {
    id,
    lineNo,
    materialCode: `MAT-00000${lineNo}`,
    nameZh: `灯珠 ${lineNo}`,
    nameEn: `LED ${lineNo}`,
    categoryNameZh: '2835 灯珠',
    categoryNameEn: '2835 SMD LED',
    spec: '2835 / 0.5W',
    unitNameZh: '个',
    unitNameEn: 'pcs',
    quantity,
    drawingRef: null,
    currency: 'CNY',
  };
}

/** 3 行合成询价行，故意乱序，生成时按 lineNo 排 */
const ctx: PplExcelContext = {
  quoteId: 'quote-1',
  roundId: 'round-1',
  formalNo: 'RFQ-20261022-0001',
  roundNo: 1,
  templateVersion: 1,
  variantCode: 'PPL-LED',
  groups: PPL_V0.groups,
  columns,
  lines: [line('line-b', 2, '500.0000'), line('line-a', 1, '1000.0000'), line('line-c', 3, '20.0000')],
  dictOptions: {
    certification: [
      { code: 'CE', nameZh: 'CE 认证', nameEn: 'CE' },
      { code: 'UL', nameZh: 'UL 认证', nameEn: 'UL' },
    ],
    payment_terms: [{ code: 'T30', nameZh: '月结 30 天', nameEn: 'Net 30' }],
    packing_method: [{ code: 'CARTON', nameZh: '纸箱', nameEn: 'Carton' }],
    trade_term: [{ code: 'FOB', nameZh: '离岸价', nameEn: 'FOB' }],
  },
};

/** 每行都填齐 PPL-LED 的必填列 */
const REQUIRED: Record<string, CellValue> = {
  power_w: 0.5,
  cct_k: 3000,
  cri_ra: 80,
  luminous_flux_lm: 60.5,
  unit_price_incl_tax: 1.13,
  tax_rate: 13,
  lead_time_days: 30,
};

async function load(buffer: Buffer): Promise<Workbook> {
  const wb = new Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

/** 像供应商一样打开文件、改单元格、保存 */
async function edit(buffer: Buffer, change: (wb: Workbook, ws: Worksheet) => void): Promise<Buffer> {
  const wb = await load(buffer);
  change(wb, wb.getWorksheet(PPL_QUOTE_SHEET)!);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function fill(ws: Worksheet, row: number, values: Record<string, CellValue>): void {
  for (const [key, value] of Object.entries(values)) ws.getCell(row, col(key)).value = value;
}

async function filled(extra: Record<number, Record<string, CellValue>> = {}): Promise<Buffer> {
  return edit(await service.build(ctx), (_wb, ws) => {
    for (const row of [4, 5, 6]) fill(ws, row, { ...REQUIRED, ...extra[row] });
  });
}

async function expectError(promise: Promise<unknown>, code: string): Promise<AppException> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(AppException);
    expect((e as AppException).code).toBe(code);
    return e as AppException;
  }
  throw new Error(`expected ${code}`);
}

describe('PplExcelService', () => {
  it('R05-7 结构：四个工作表、分组与标签表头、隐藏的 key 行、冻结窗格、按 lineNo 排序', async () => {
    const wb = await load(await service.build(ctx, { deadline: new Date('2026-11-20T09:00:00.000Z') }));
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      PPL_QUOTE_SHEET,
      PPL_HELP_SHEET,
      PPL_LISTS_SHEET,
      PPL_META_SHEET,
    ]);
    expect(wb.getWorksheet(PPL_LISTS_SHEET)!.state).toBe('veryHidden');
    expect(wb.getWorksheet(PPL_META_SHEET)!.state).toBe('veryHidden');

    const ws = wb.getWorksheet(PPL_QUOTE_SHEET)!;
    expect(ws.getCell(1, 1).value).toBe('基本信息 / Basic Info');
    expect(ws.getCell(1, 2).isMerged).toBe(true);
    expect(ws.getCell(1, col('unit_price_incl_tax')).value).toBe('价格 / Price');
    expect(ws.getCell(2, col('unit_price_incl_tax')).value).toBe('含税单价 *\nUnit Price (incl. tax)');
    expect(ws.getCell(2, col('power_w')).value).toBe('功率(W) *\nPower (W)');
    expect(ws.getCell(2, col('brand')).value).toBe('品牌\nBrand');
    expect(ws.getCell(3, col('tax_rate')).value).toBe('tax_rate');
    expect(ws.getRow(3).hidden).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 3 });
    expect([4, 5, 6].map((r) => ws.getCell(r, col('line_no')).value)).toEqual([1, 2, 3]);
    expect(ws.getCell(4, col('quantity')).value).toBe(1000);
    expect(ws.getCell(4, col('material_name')).value).toBe('灯珠 1');
    expect(ws.getCell(4, col('unit_price_excl_tax')).value).toEqual(
      expect.objectContaining({ formula: expect.stringContaining('ROUND(') }),
    );
    expect(ws.getCell(4, col('payment_terms')).dataValidation).toMatchObject({
      type: 'list',
      formulae: [`'${PPL_LISTS_SHEET}'!$A$2:$A$2`],
    });
    expect(wb.getWorksheet(PPL_LISTS_SHEET)!.getCell(2, 1).value).toBe('月结 30 天 / Net 30');
    const help = wb.getWorksheet(PPL_HELP_SHEET)!;
    const helpText = help.getColumn(1).values.join('\n');
    expect(helpText).toContain('2026-11-20 17:00（北京时间 UTC+8）');
    expect(helpText).toContain('含税单价 / Unit Price (incl. tax)');
  });

  it('R05-7 工作表受保护：预填列和公式列锁定，供应商列不锁定', async () => {
    const wb = await load(await service.build(ctx));
    const ws = wb.getWorksheet(PPL_QUOTE_SHEET)!;
    // ExcelJS 的 true = 允许：只允许选中单元格和调整列宽，插入删除行列、排序、筛选、改行格式都禁止
    const protection = (ws as unknown as { sheetProtection: Record<string, unknown> }).sheetProtection;
    expect(protection).toMatchObject({ sheet: true, formatColumns: true });
    expect(protection.selectLockedCells).not.toBe(false);
    expect(protection.selectUnlockedCells).not.toBe(false);
    for (const action of [
      'insertRows',
      'deleteRows',
      'insertColumns',
      'deleteColumns',
      'formatRows',
      'formatCells',
      'sort',
      'autoFilter',
    ]) {
      expect(protection[action]).toBeUndefined();
    }
    for (const key of [
      'line_no',
      'material_name',
      'quantity',
      'unit_price_excl_tax',
      'total_price_incl_tax',
    ]) {
      expect(ws.getCell(4, col(key)).protection?.locked).not.toBe(false);
    }
    for (const key of ['brand', 'unit_price_incl_tax', 'certifications']) {
      expect(ws.getCell(4, col(key)).protection).toMatchObject({ locked: false });
    }
    // 询价行之外的行不能填写
    expect(ws.getCell(7, col('brand')).protection?.locked).not.toBe(false);
  });

  it('R05-7 往返：生成 → 填写未锁定单元格 → 解析得到规范化取值，公式列由服务端重算', async () => {
    const buffer = await filled({
      4: {
        brand: ' Acme ',
        payment_terms: '月结 30 天 / Net 30',
        rohs: '是 / Yes',
        certifications: 'CE, ul',
        cert_expiry: new Date(Date.UTC(2027, 1, 28)),
        unit_price_excl_tax: 999,
      },
      5: { payment_terms: 'T30', rohs: '否', moq: '100', unit_price_incl_tax: '2.5' },
      6: { cert_expiry: '2027-03-01', carton_l_cm: 45.5, carton_w_cm: 32.3, carton_h_cm: 28.7 },
    });
    const values = await service.parse(ctx, buffer);
    expect(Object.keys(values).sort()).toEqual(['line-a', 'line-b', 'line-c']);
    expect(values['line-a']).toEqual({
      brand: 'Acme',
      power_w: '0.50',
      cct_k: 3000,
      cri_ra: 80,
      luminous_flux_lm: '60.5',
      certifications: ['CE', 'UL'],
      rohs: true,
      cert_expiry: '2027-02-28',
      unit_price_incl_tax: '1.1300',
      tax_rate: '13.00',
      unit_price_excl_tax: '1.0000',
      total_price_incl_tax: '1130.00',
      payment_terms: 'T30',
      lead_time_days: 30,
    });
    expect(values['line-b']).toMatchObject({
      payment_terms: 'T30',
      rohs: false,
      moq: 100,
      unit_price_incl_tax: '2.5000',
      total_price_incl_tax: '1250.00',
    });
    expect(values['line-c']).toMatchObject({ cert_expiry: '2027-03-01', carton_cbm: '0.0422' });
  });

  it('R05-7 再次下载时预先写入已有取值', async () => {
    const buffer = await service.build(ctx, {
      values: {
        'line-b': { brand: 'Acme', tax_rate: '13.00', payment_terms: 'T30', certifications: ['CE', 'UL'] },
      },
    });
    const ws = (await load(buffer)).getWorksheet(PPL_QUOTE_SHEET)!;
    expect(ws.getCell(5, col('brand')).value).toBe('Acme');
    expect(ws.getCell(5, col('tax_rate')).value).toBe(13);
    expect(ws.getCell(5, col('payment_terms')).value).toBe('月结 30 天 / Net 30');
    expect(ws.getCell(5, col('certifications')).value).toBe('CE,UL');
    expect(ws.getCell(4, col('brand')).value).toBeNull();
  });

  it('R05-7 篡改 _meta 签名或报价单 → EXCEL_TEMPLATE_MISMATCH', async () => {
    const buffer = await filled();
    const resign = (key: string, value: string) =>
      edit(buffer, (wb) => {
        wb.getWorksheet(PPL_META_SHEET)!.eachRow((row) => {
          if (row.getCell(1).value === key) row.getCell(2).value = value;
        });
      });
    const tampered = await expectError(
      service.parse(ctx, await resign('signature', 'f'.repeat(64))),
      'EXCEL_TEMPLATE_MISMATCH',
    );
    expect(tampered.params).toEqual({ reason: 'tampered' });
    const otherQuote = await expectError(
      service.parse(ctx, await resign('quoteId', 'quote-2')),
      'EXCEL_TEMPLATE_MISMATCH',
    );
    expect(otherQuote.params).toEqual({ reason: 'tampered' });

    // 别的报价单、别的模板版本、询价行有变化：文件本身没问题，但不是本单本轮的当前模板
    for (const other of [
      { ...ctx, quoteId: 'quote-2' },
      { ...ctx, templateVersion: 2 },
      { ...ctx, lines: [...ctx.lines, line('line-d', 4, '1.0000')] },
    ]) {
      const e = await expectError(service.parse(other, buffer), 'EXCEL_TEMPLATE_MISMATCH');
      expect(e.params).toEqual({ reason: 'outdated' });
    }
  });

  it('不是本系统模板 → EXCEL_TEMPLATE_MISMATCH；打不开 → EXCEL_PARSE_FAILED；超过 10MB → FILE_TOO_LARGE', async () => {
    const plain = new Workbook();
    plain.addWorksheet(PPL_QUOTE_SHEET).addRow(['x']);
    const e = await expectError(
      service.parse(ctx, Buffer.from(await plain.xlsx.writeBuffer())),
      'EXCEL_TEMPLATE_MISMATCH',
    );
    expect(e.params).toEqual({ reason: 'not_template' });
    await expectError(service.parse(ctx, Buffer.from('not an xlsx')), 'EXCEL_PARSE_FAILED');
    await expectError(service.parse(ctx, Buffer.alloc(10 * 1024 * 1024 + 1)), 'FILE_TOO_LARGE');
  });

  it('R05-7 改了第 3 行 key 或第 2 行标签 → EXCEL_HEADER_MISMATCH', async () => {
    const buffer = await filled();
    const keyChanged = await edit(buffer, (_wb, ws) => {
      ws.getCell(3, col('brand')).value = 'brand_x';
    });
    const e = await expectError(service.parse(ctx, keyChanged), 'EXCEL_HEADER_MISMATCH');
    expect(e.details).toMatchObject({ missing: ['brand'], extra: ['brand_x'], orderMismatch: false });

    const labelChanged = await edit(buffer, (_wb, ws) => {
      ws.getCell(2, col('brand')).value = '品牌名\nBrand';
    });
    const l = await expectError(service.parse(ctx, labelChanged), 'EXCEL_HEADER_MISMATCH');
    expect(l.details).toMatchObject({ missing: ['品牌 Brand'], extra: ['品牌名 Brand'] });
  });

  it('R05-7 非法取值 → EXCEL_ROWS_INVALID，行号、列名正确，一处不漏', async () => {
    const buffer = await filled({
      4: { unit_price_incl_tax: 'abc', cct_k: 3000.5 },
      5: { tax_rate: 13.123, rohs: '也许', payment_terms: 'T90', certifications: 'CE,XX' },
      6: { lead_time_days: null, cert_expiry: '2027-02-30' },
    });
    const e = await expectError(service.parse(ctx, buffer), 'EXCEL_ROWS_INVALID');
    const details = e.details as ExcelRowError[];
    expect(details.map((d) => [d.row, d.column, d.code])).toEqual([
      [4, '色温(K) / CCT (K)', 'invalid_integer'],
      [4, '含税单价 / Unit Price (incl. tax)', 'invalid_number'],
      [5, '认证 / Certifications', 'invalid_option'],
      [5, '符合 RoHS / RoHS Compliant', 'invalid_bool'],
      [5, '税率(%) / Tax Rate (%)', 'too_many_decimals'],
      [5, '付款条件 / Payment Terms', 'invalid_option'],
      [6, '证书有效期 / Certificate Expiry', 'invalid_date'],
      [6, '量产交期(天) / Production Lead Time (days)', 'required'],
    ]);
    expect(details.find((d) => d.code === 'too_many_decimals')?.params).toEqual({ max: 2 });
    expect(details.find((d) => d.column.startsWith('认证'))?.params).toEqual({ value: 'XX' });
    expect(e.params).toEqual({ count: 8 });
  });

  it('R05-7 草稿模式不校验必填；行号被改、下方多出的非空行都报错', async () => {
    const empty = await service.build(ctx);
    expect(await service.parse(ctx, empty, 'draft')).toEqual({ 'line-a': {}, 'line-b': {}, 'line-c': {} });
    await expectError(service.parse(ctx, empty), 'EXCEL_ROWS_INVALID');

    const moved = await edit(await filled(), (_wb, ws) => {
      ws.getCell(5, col('line_no')).value = 9;
      ws.getCell(8, col('brand')).value = 'extra';
    });
    const e = await expectError(service.parse(ctx, moved), 'EXCEL_ROWS_INVALID');
    expect((e.details as ExcelRowError[]).map((d) => [d.row, d.code])).toEqual([
      [5, 'line_mismatch'],
      [8, 'unexpected_row'],
    ]);
  });
});
