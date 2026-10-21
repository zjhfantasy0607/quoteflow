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

  describe('末尾的可省略列（导出比模板多的列）', () => {
    const withStatus: ExcelSheetDef = {
      sheetName: '材料 Materials',
      columns: [
        { key: 'code', header: '物料编码 / Material Code' },
        { key: 'name', header: '物料名称 / Material Name', required: true },
        { key: 'status', header: '状态 / Status', omittable: true },
      ],
    };
    const headers = withStatus.columns.map((c) => c.header);

    async function file(header: string[], rows: (string | null)[][]): Promise<Buffer> {
      const wb = new Workbook();
      const ws = wb.addWorksheet(withStatus.sheetName);
      ws.addRow(header);
      rows.forEach((r) => ws.addRow(r));
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    it('有这一列和没有这一列都能导入；没有时取值为 null，表头之外的单元格忽略', async () => {
      const full = await svc.parse(withStatus, await file(headers, [['A', '灯珠', '停用']]));
      expect(full.rows[0].values).toEqual({ code: 'A', name: '灯珠', status: '停用' });
      const short = await svc.parse(withStatus, await file(headers.slice(0, 2), [['A', '灯珠', '多余内容']]));
      expect(short.rows[0].values).toEqual({ code: 'A', name: '灯珠', status: null });
    });

    it('表头不一致时：文件里没有可省略列就按模板表头提示', async () => {
      const err = await expectError(
        svc.parse(withStatus, await file(['物料编码 / Material Code', '名称 / Name'], [])),
        'EXCEL_HEADER_MISMATCH',
      );
      expect(err.details).toMatchObject({
        expected: headers.slice(0, 2),
        missing: ['物料名称 / Material Name'],
        extra: ['名称 / Name'],
      });
      const withExtra = await expectError(
        svc.parse(withStatus, await file(['状态 / Status', ...headers.slice(0, 2)], [])),
        'EXCEL_HEADER_MISMATCH',
      );
      expect(withExtra.details).toMatchObject({ expected: headers, orderMismatch: true });
    });
  });

  it('没有数据行返回 EXCEL_EMPTY；不是 xlsx 返回 EXCEL_PARSE_FAILED', async () => {
    await expectError(svc.parse(def, await sheet([])), 'EXCEL_EMPTY');
    await expectError(svc.parse(def, Buffer.from('not an xlsx')), 'EXCEL_PARSE_FAILED');
  });
});
