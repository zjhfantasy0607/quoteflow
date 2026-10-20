import { Workbook } from 'exceljs';
import { AppException } from '../../common/errors/app.exception';
import { ExcelTemplateService, normalizeHeader, type ExcelSheetDef } from './excel-template.service';

const def: ExcelSheetDef = {
  sheetName: '材料 Materials',
  columns: [
    { key: 'code', header: '物料编码 / Material Code', maxLength: 30 },
    { key: 'name', header: '物料名称 / Material Name', required: true, maxLength: 10 },
    { key: 'qty', header: '数量 / Quantity', type: 'decimal', precision: 2, min: 0 },
    { key: 'pcs', header: '每箱数量 / Qty per Carton', type: 'integer' },
    { key: 'email', header: '邮箱 / Email', type: 'email' },
  ],
  instructions: ['请勿修改表头'],
};

async function sheet(rows: (string | number | null)[][], header = def.columns.map((c) => c.header)): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(def.sheetName);
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
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

describe('ExcelTemplateService（R02-9）', () => {
  const svc = new ExcelTemplateService();

  it('生成的模板可以原样解析回来', async () => {
    const buf = await svc.build(def, [{ code: 'MAT-1', name: '灯珠', qty: '12.5', pcs: 100, email: 'a@b.com' }]);
    const { rows, errors } = await svc.parse(def, buf);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ row: 2, values: { code: 'MAT-1', name: '灯珠', qty: '12.5', pcs: 100, email: 'a@b.com' } }]);
  });

  it('表头规范化：全角斜杠和多余空格不影响匹配', async () => {
    expect(normalizeHeader('  物料编码／Material   Code ')).toBe('物料编码 / Material Code');
    const header = def.columns.map((c) => c.header.replace(' / ', '／'));
    const { errors } = await svc.parse(def, await sheet([['A', '名', 1, 2, null]], header));
    expect(errors).toEqual([]);
  });

  it('缺列、多列整表拒绝并列出差异', async () => {
    const header = [...def.columns.slice(0, 4).map((c) => c.header), '备注 / Remark'];
    const err = await expectError(svc.parse(def, await sheet([], header)), 'EXCEL_HEADER_MISMATCH');
    expect(err.details).toMatchObject({ missing: ['邮箱 / Email'], extra: ['备注 / Remark'], orderMismatch: false });
  });

  it('列顺序不一致整表拒绝', async () => {
    const header = def.columns.map((c) => c.header).reverse();
    const err = await expectError(svc.parse(def, await sheet([], header)), 'EXCEL_HEADER_MISMATCH');
    expect(err.details).toMatchObject({ missing: [], extra: [], orderMismatch: true });
  });

  it('行数据错误逐条报出行号和列名，空行跳过', async () => {
    const buf = await sheet([
      ['A1', null, 'abc', 1.5, 'bad-email'],
      [null, null, null, null, null],
      ['A3', '超过十个字的名称超长了', 1.234, 2, null],
    ]);
    const { rows, errors } = await svc.parse(def, buf);
    expect(rows.map((r) => r.row)).toEqual([2, 4]);
    expect(errors.map((e) => [e.row, e.column, e.code])).toEqual([
      [2, '物料名称 / Material Name', 'required'],
      [2, '数量 / Quantity', 'invalid_number'],
      [2, '每箱数量 / Qty per Carton', 'invalid_integer'],
      [2, '邮箱 / Email', 'invalid_email'],
      [4, '物料名称 / Material Name', 'too_long'],
      [4, '数量 / Quantity', 'too_many_decimals'],
    ]);
    await expectError(Promise.resolve().then(() => svc.assertNoRowErrors(errors)), 'EXCEL_ROWS_INVALID');
  });

  it('没有数据行返回 EXCEL_EMPTY；不是 xlsx 返回 EXCEL_PARSE_FAILED', async () => {
    await expectError(svc.parse(def, await sheet([])), 'EXCEL_EMPTY');
    await expectError(svc.parse(def, Buffer.from('not an xlsx')), 'EXCEL_PARSE_FAILED');
  });
});
