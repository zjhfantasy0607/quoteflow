import { seedMaterialCategories, seedMaterials } from '../prisma/seed-data/materials';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createCategory, createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';
import { binaryParser, buildXlsx, loadXlsx, sheetRows } from './helpers/xlsx';

const SHEET = '材料 Materials';
const HEADERS = [
  '物料编码 / Material Code',
  '物料名称 / Material Name',
  '英文名称 / English Name',
  '规格型号 / Specification',
  '单位 / Unit',
  '材料分类编码 / Category Code',
  '品牌 / Brand',
  '备注 / Remark',
];
const STATUS = '状态 / Status';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Cell = string | number | null;

describe('M03 材料 Excel 导入导出', () => {
  let ctx: TestContext;
  let buyer: Agent;
  let buyerEn: Agent;
  let pd: Agent;

  async function download(agent: Agent, url: string) {
    return agent.get(url).buffer(true).parse(binaryParser).expect(200);
  }

  async function importRows(rows: Cell[][], status: number, header: string[] = HEADERS, agent: Agent = buyer) {
    const file = await buildXlsx(SHEET, header, rows);
    return agent.post('/api/materials/import').attach('file', file, '材料.xlsx').expect(status);
  }

  async function snapshot() {
    return ctx.prisma.material.findMany({
      orderBy: { code: 'asc' },
      select: {
        code: true,
        nameZh: true,
        nameEn: true,
        spec: true,
        unitCode: true,
        categoryId: true,
        brand: true,
        remark: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await seedMaterials(ctx.prisma);
    buyer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
    buyerEn = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'], locale: 'en-US' }));
    pd = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['PD'] }));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R03-7 下载标准模板：表头与规定的列一致，说明页列出可填的单位和分类编码', async () => {
    const res = await download(buyer, '/api/materials/import-template');
    expect(res.headers['content-type']).toBe(XLSX_MIME);
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('材料导入模板.xlsx'));
    const wb = await loadXlsx(res.body);
    expect(sheetRows(wb.getWorksheet(SHEET)!)).toEqual([HEADERS]);
    const help = sheetRows(wb.getWorksheet('说明 Instructions')!).map((r) => r[0]);
    expect(help).toContain('PCS  个 / pcs');
    expect(help.some((line) => typeof line === 'string' && line.includes('DRV-CC  恒流电源'))).toBe(true);
  });

  it('R03-7 新建 + 更新混合导入成功；单位接受编码、中文名、英文名，分类编码不区分大小写', async () => {
    const res = await importRows([
      [null, '导入灯珠', 'Imported LED', '3030 / 1W', '个', 'LED-3030', 'Acme', '第一行'],
      ['imp-002', '导入透镜', null, 'Φ30 / 45°', 'pcs', 'per-lens', null, null],
      ['MAT-000009', '硅胶线 18AWG（改）', 'Silicone Wire 18AWG', '18AWG / 200℃ / 红黑', 'm', 'PER-WIRE', null, null],
    ], 200);
    expect(res.body).toEqual({ created: 2, updated: 1 });

    const lens = await ctx.prisma.material.findUniqueOrThrow({ where: { code: 'IMP-002' }, include: { category: true } });
    expect(lens).toMatchObject({ unitCode: 'PCS', nameEn: null, status: 'ENABLED', category: { code: 'PER-LENS' } });
    const auto = await ctx.prisma.material.findUniqueOrThrow({ where: { code: 'MAT-000011' } });
    expect(auto).toMatchObject({ nameZh: '导入灯珠', unitCode: 'PCS', brand: 'Acme', remark: '第一行' });
    const wire = await ctx.prisma.material.findUniqueOrThrow({ where: { code: 'MAT-000009' } });
    expect(wire).toMatchObject({ nameZh: '硅胶线 18AWG（改）', unitCode: 'M' });

    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'material.import' } });
    expect(log?.detail).toMatchObject({ file: '材料.xlsx', created: 2, updated: 1, updatedCodes: ['MAT-000009'] });
  });

  it('R03-7 分类编码不存在时整表拒绝，并指出行和列', async () => {
    const before = await snapshot();
    const res = await importRows([
      ['IMP-003', '正常的一行', null, 'S', 'PCS', 'LED', null, null],
      ['IMP-004', '分类不存在', null, 'S', 'PCS', 'NOPE', null, null],
    ], 422);
    expect(res.body).toMatchObject({
      code: 'EXCEL_ROWS_INVALID',
      params: { count: 1 },
      details: [{ row: 3, column: '材料分类编码 / Category Code', code: 'category_not_found' }],
    });
    expect(await snapshot()).toEqual(before);
  });

  it('R03-7 表头顺序错误或缺列时整表拒绝，并列出差异', async () => {
    const swapped = [HEADERS[1], HEADERS[0], ...HEADERS.slice(2)];
    const order = await importRows([['名称', 'X-1', null, 'S', 'PCS', 'LED', null, null]], 422, swapped);
    expect(order.body).toMatchObject({
      code: 'EXCEL_HEADER_MISMATCH',
      details: { expected: HEADERS, missing: [], extra: [], orderMismatch: true },
    });
    const fiveColumns = HEADERS.filter((h) => h !== HEADERS[2]).slice(0, 5);
    const missing = await importRows([['X-1', '名称', 'S', 'PCS', 'LED']], 422, fiveColumns);
    expect(missing.body.details).toMatchObject({ missing: [HEADERS[2], HEADERS[6], HEADERS[7]], orderMismatch: false });
  });

  it('R03-7 逐行校验：必填、编码格式、文件内重复编码、单位不存在或停用、分类停用、状态取值', async () => {
    const disabled = await createCategory(ctx.prisma, { code: 'TST-OFF', status: 'DISABLED' });
    await ctx.prisma.dictItem.update({ where: { typeCode_code: { typeCode: 'unit', code: 'BOX' } }, data: { status: 'DISABLED' } });
    const res = await importRows(
      [
        ['IMP-101', null, null, 'S', 'PCS', 'LED', null, null, null],
        ['BAD CODE', '编码格式', null, 'S', 'PCS', 'LED', null, null, null],
        ['IMP-102', '重复 1', null, 'S', 'PCS', 'LED', null, null, null],
        ['imp-102', '重复 2', null, 'S', 'PCS', 'LED', null, null, null],
        ['IMP-103', '单位不存在', null, 'S', '只', 'LED', null, null, null],
        ['IMP-104', '单位停用', null, 'S', '盒', 'LED', null, null, null],
        ['IMP-105', '分类停用', null, 'S', 'PCS', disabled.code, null, null, null],
        ['IMP-106', '状态', null, 'S', 'PCS', 'LED', null, null, '作废'],
      ],
      422,
      [...HEADERS, STATUS],
    );
    expect(res.body.details.map((d: { row: number; code: string }) => [d.row, d.code])).toEqual([
      [2, 'required'],
      [3, 'invalid_code'],
      [5, 'duplicate_code'],
      [6, 'unit_not_found'],
      [7, 'unit_disabled'],
      [8, 'category_disabled'],
      [9, 'invalid_status'],
    ]);
    expect(res.body.details[2]).toMatchObject({ column: HEADERS[0], params: { row: 4 } });
    expect(await ctx.prisma.material.count({ where: { code: { startsWith: 'IMP-1' } } })).toBe(0);
    await ctx.prisma.dictItem.update({ where: { typeCode_code: { typeCode: 'unit', code: 'BOX' } }, data: { status: 'ENABLED' } });
  });

  it('R03-8 导出按筛选条件，列同模板另加"状态"；改完直接导入，状态列生效', async () => {
    const driver = (await ctx.prisma.materialCategory.findUniqueOrThrow({ where: { code: 'PER-DRV' } })).id;
    const res = await download(buyer, `/api/materials/export?categoryId=${driver}`);
    expect(res.headers['content-disposition']).toMatch(/filename\*=UTF-8''.*\d{8}\.xlsx/);
    const wb = await loadXlsx(res.body);
    const ws = wb.getWorksheet(SHEET)!;
    const rows = sheetRows(ws);
    expect(rows[0]).toEqual([...HEADERS, STATUS]);
    expect(rows.slice(1)).toEqual([
      ['MAT-000005', '恒流驱动电源', 'CC LED Driver', 'AC220V / DC30–42V / 300mA / PF>0.9', 'PCS', 'DRV-CC', null, null, '启用'],
      ['MAT-000006', '恒压驱动电源', 'CV LED Driver', 'AC220V / DC24V / 100W / IP67', 'PCS', 'DRV-CV', null, null, '启用'],
    ]);

    ws.getCell(3, 9).value = '停用';
    ws.getCell(3, 7).value = 'Mean Well';
    const again = await buyer
      .post('/api/materials/import')
      .attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'export.xlsx')
      .expect(200);
    expect(again.body).toEqual({ created: 0, updated: 2 });
    expect(await ctx.prisma.material.findUniqueOrThrow({ where: { code: 'MAT-000006' } })).toMatchObject({
      status: 'DISABLED',
      brand: 'Mean Well',
    });

    // 英文界面的用户导出：状态写英文，文件名英文
    const en = await download(buyerEn, `/api/materials/export?categoryId=${driver}&status=DISABLED`);
    expect(en.headers['content-disposition']).toContain("filename*=UTF-8''Materials-");
    expect(sheetRows((await loadXlsx(en.body)).getWorksheet(SHEET)!).slice(1)).toEqual([
      ['MAT-000006', '恒压驱动电源', 'CV LED Driver', 'AC220V / DC24V / 100W / IP67', 'PCS', 'DRV-CV', 'Mean Well', null, 'Disabled'],
    ]);
  });

  it('R03-8 导出后不改内容再导入：全部计为更新，数据和更新时间都不变', async () => {
    const before = await snapshot();
    const res = await download(buyer, '/api/materials/export');
    const again = await buyer.post('/api/materials/import').attach('file', res.body, 'all.xlsx').expect(200);
    expect(again.body).toEqual({ created: 0, updated: before.length });
    expect(await snapshot()).toEqual(before);
  });

  it('不是 xlsx、没有数据行、超过 10MB 时拒绝', async () => {
    const notXlsx = await buyer.post('/api/materials/import').attach('file', Buffer.from('hello'), 'a.xlsx').expect(400);
    expect(notXlsx.body.code).toBe('EXCEL_PARSE_FAILED');
    expect((await importRows([], 400)).body.code).toBe('EXCEL_EMPTY');
    const big = await buyer
      .post('/api/materials/import')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'big.xlsx')
      .expect(400);
    expect(big.body).toMatchObject({ code: 'FILE_TOO_LARGE', params: { maxMB: 10 } });
    const none = await buyer.post('/api/materials/import').expect(400);
    expect(none.body.code).toBe('VALIDATION_FAILED');
  });

  it('权限：下载模板和导入需要 material:import，导出需要 material:export', async () => {
    await pd.get('/api/materials/import-template').expect(403);
    await pd.get('/api/materials/export').expect(403);
    await importRows([['X', 'x', null, 's', 'PCS', 'LED', null, null]], 403, HEADERS, pd);
  });
});
