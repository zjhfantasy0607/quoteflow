import { seedMaterialCategories } from '../prisma/seed-data/materials';
import { seedSuppliers } from '../prisma/seed-data/suppliers';
import { hashPassword } from '../src/common/auth/password';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';
import { binaryParser, buildXlsx, loadXlsx, sheetRows } from './helpers/xlsx';

const SHEET = '供应商 Suppliers';
const HEADERS = [
  '供应商编码 / Supplier Code',
  '供应商名称 / Supplier Name',
  '英文名称 / English Name',
  '统一社会信用代码 / Unified Social Credit Code',
  '供应商分类 / Supplier Category',
  '主营材料分类编码 / Main Category Codes',
  '联系人 / Contact Name',
  '联系邮箱 / Contact Email',
  '联系电话 / Contact Phone',
  '首选语言 / Preferred Language',
  '国家或地区 / Country or Region',
  '地址 / Address',
  '备注 / Remark',
];
const STATUS = '状态 / Status';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Cell = string | number | null;

/** 一行完整数据（按 HEADERS 的顺序），默认是一个合法的新供应商；给了第 13 列时多一列"状态" */
function row(values: Partial<Record<number, Cell>> = {}): Cell[] {
  const base: Cell[] = [
    null,
    '导入测试供应商',
    null,
    null,
    'NORMAL',
    null,
    '联系人',
    'contact@import.example.com',
    null,
    null,
    null,
    null,
    null,
  ];
  const cells = base.map((v, i) => (i in values ? values[i]! : v));
  return 13 in values ? [...cells, values[13]!] : cells;
}

describe('M04 供应商 Excel 导入导出', () => {
  let ctx: TestContext;
  let buyer: Agent;
  let buyerEn: Agent;
  let pd: Agent;
  /** 有 supplier:view、supplier:export，没有 supplier:import 和 supplier.contact */
  let viewer: Agent;
  let category: Record<string, string>;

  async function download(agent: Agent, url: string) {
    return agent.get(url).buffer(true).parse(binaryParser).expect(200);
  }

  async function exportRows(agent: Agent, query = ''): Promise<Cell[][]> {
    const res = await download(agent, `/api/suppliers/export${query}`);
    return sheetRows((await loadXlsx(res.body)).getWorksheet(SHEET)!);
  }

  async function importRows(
    rows: Cell[][],
    status: number,
    header: string[] = HEADERS,
    agent: Agent = buyer,
  ) {
    const file = await buildXlsx(SHEET, header, rows);
    return agent.post('/api/suppliers/import').attach('file', file, '供应商.xlsx').expect(status);
  }

  async function snapshot() {
    return ctx.prisma.supplier.findMany({
      orderBy: { code: 'asc' },
      include: { materialCategories: { select: { categoryId: true }, orderBy: { categoryId: 'asc' } } },
    });
  }

  async function supplier(code: string) {
    return ctx.prisma.supplier.findUniqueOrThrow({
      where: { code },
      include: { materialCategories: { include: { category: true } } },
    });
  }

  const mainCodes = (s: Awaited<ReturnType<typeof supplier>>) =>
    s.materialCategories.map((m) => m.category.code).sort();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await seedSuppliers(ctx.prisma, hashPassword);
    category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    await ctx.prisma.role.create({
      data: {
        code: 'SUPPLIER_VIEWER',
        nameZh: '供应商查看',
        nameEn: 'Supplier viewer',
        dataScope: 'SELF',
        permissions: ['supplier:view', 'supplier:export'],
        fieldPermissions: [],
      },
    });
    buyer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
    buyerEn = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'], locale: 'en-US' }));
    pd = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['PD'] }));
    viewer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['SUPPLIER_VIEWER'] }));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R04-8 下载标准模板：表头与规定的列一致，说明页列出供应商分类和可选的材料分类编码', async () => {
    const res = await download(buyer, '/api/suppliers/import-template');
    expect(res.headers['content-type']).toBe(XLSX_MIME);
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('供应商导入模板.xlsx'));
    const wb = await loadXlsx(res.body);
    expect(sheetRows(wb.getWorksheet(SHEET)!)).toEqual([HEADERS]);
    const help = sheetRows(wb.getWorksheet('说明 Instructions')!).map((r) => r[0]);
    expect(help).toContain('STRATEGIC  战略供应商 / Strategic');
    expect(
      help.some((line) => typeof line === 'string' && line.includes('PER-DRV  驱动电源 / LED Driver')),
    ).toBe(true);

    const en = await download(buyerEn, '/api/suppliers/import-template');
    expect(en.headers['content-disposition']).toContain(encodeURIComponent('Supplier Import Template.xlsx'));
    await viewer.get('/api/suppliers/import-template').expect(403);
    await pd.get('/api/suppliers/import-template').expect(403);
  });

  it('R04-8 导出：列同模板另加"状态"，按当前筛选导出；首选语言写成 中文 / English / 中英', async () => {
    const rows = await exportRows(buyer, '?categoryCodes=EXCELLENT');
    expect(rows[0]).toEqual([...HEADERS, STATUS]);
    expect(rows.slice(1).map((r) => r[0])).toEqual(['SUP10002', 'SUP10003', 'SUP10006']);
    expect(rows[1]).toEqual([
      'SUP10002',
      '上海卓越电子有限公司',
      'Shanghai Zhuoyue Electronics Co., Ltd.',
      '91310000MA1ZY00002',
      'EXCELLENT',
      'PER-DRV',
      '刘工',
      'bd@zhuoyue.example.com',
      '021-6666 0002',
      '中英',
      '中国',
      '上海市松江区九亭镇示例路 168 号',
      null,
      '启用',
    ]);
    expect(rows[2][5]).toBe('PER-BRKT,PER-HS');
    expect(rows[3][9]).toBe('English');
    expect(rows[3][3]).toBeNull();

    const en = await exportRows(buyerEn, '?status=DISABLED');
    expect(en.slice(1).map((r) => [r[0], r[9], r[13]])).toEqual([['SUP10007', '中文', 'Disabled']]);
    await pd.get('/api/suppliers/export').expect(403);
  });

  it('R04-7 没有 supplier.contact 字段权限：导出的联系邮箱、联系电话写成 ******', async () => {
    const rows = await exportRows(viewer, '?keyword=SUP10001');
    expect(rows[1].slice(6, 9)).toEqual(['陈经理', '******', '******']);
  });

  it('R04-8 导入新建：语言"中英"映射为 bilingual，分类中文名 / 英文名都能匹配，编码为空自动生成', async () => {
    const res = await importRows(
      [
        row({
          1: '新建供应商甲',
          2: 'Supplier A',
          4: '战略供应商',
          5: 'LED-2835, per-lens',
          6: '甲经理',
          7: 'A.Manager@Example.com',
          8: '138 0000 0001',
          9: '中英',
          10: '中国',
          11: '深圳市南山区',
          12: '导入的备注',
        }),
        row({
          0: 'imp-b01',
          1: '新建供应商乙',
          3: '91440300ma5hx0b001',
          4: 'preferred',
          7: 'b@example.com',
          9: 'English',
        }),
        row({ 1: '新建供应商丙', 4: 'Standard', 5: 'PER-HS，PER-BRKT', 7: 'c@example.com', 8: 13800000003 }),
      ],
      200,
    );
    expect(res.body).toEqual({ created: 3, updated: 0 });

    const a = await supplier('SUP10009');
    expect(a).toMatchObject({
      nameZh: '新建供应商甲',
      nameEn: 'Supplier A',
      categoryCode: 'STRATEGIC',
      contactName: '甲经理',
      contactEmail: 'a.manager@example.com',
      contactPhone: '138 0000 0001',
      ccEmails: [],
      preferredLanguage: 'bilingual',
      country: '中国',
      address: '深圳市南山区',
      remark: '导入的备注',
      status: 'ENABLED',
    });
    expect(mainCodes(a)).toEqual(['LED-2835', 'PER-LENS']);
    expect(await supplier('IMP-B01')).toMatchObject({
      creditCode: '91440300MA5HX0B001',
      categoryCode: 'EXCELLENT',
      preferredLanguage: 'en-US',
    });
    const c = await supplier('SUP10010');
    expect(c).toMatchObject({
      nameZh: '新建供应商丙',
      categoryCode: 'NORMAL',
      preferredLanguage: 'zh-CN',
      contactPhone: '13800000003',
    });
    expect(mainCodes(c)).toEqual(['PER-BRKT', 'PER-HS']);

    const log = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'supplier.import' } });
    expect(log.detail).toMatchObject({
      created: 3,
      updated: 0,
      createdCodes: ['SUP10009', 'IMP-B01', 'SUP10010'],
    });
  });

  it('R04-8 邮箱格式错误：整表拒绝，一行都不导入', async () => {
    const before = await ctx.prisma.supplier.count();
    const res = await importRows([row({ 1: '合法的一行' }), row({ 1: '邮箱错误', 7: 'not-an-email' })], 422);
    expect(res.body.code).toBe('EXCEL_ROWS_INVALID');
    expect(res.body.details).toEqual([
      expect.objectContaining({ row: 3, column: '联系邮箱 / Contact Email', code: 'invalid_email' }),
    ]);
    expect(await ctx.prisma.supplier.count()).toBe(before);
  });

  it('R04-8 逐行校验分类、主营分类、信用代码、语言、状态，错误一次全部列出', async () => {
    await ctx.prisma.materialCategory.update({
      where: { id: category['PER-WIRE'] },
      data: { status: 'DISABLED' },
    });
    await ctx.prisma.dictItem.create({
      data: {
        typeCode: 'supplier_category',
        code: 'BLOCKED',
        nameZh: '黑名单',
        nameEn: 'Blocked',
        status: 'DISABLED',
      },
    });
    const res = await importRows(
      [
        row({ 0: 'ERR-01', 4: 'VIP' }),
        row({ 5: 'LED,NOPE' }),
        row({ 3: '123' }),
        row({ 3: '91440300MA5HX00001' }),
        row({ 3: '91440300MA5HX0E005' }),
        row({ 3: '91440300ma5hx0e005' }),
        row({ 9: 'Japanese' }),
        row({ 13: '作废' }),
        row({ 0: 'err-01' }),
        row({ 1: null, 6: '' }),
        row({ 5: 'PER-WIRE' }),
        row({ 4: '黑名单' }),
        row({ 0: 'BAD CODE' }),
      ],
      422,
      [...HEADERS, STATUS],
    );
    const details = res.body.details.map((d: { row: number; code: string; params?: unknown }) => [
      d.row,
      d.code,
      d.params,
    ]);
    expect(details).toEqual([
      [2, 'supplier_category_not_found', undefined],
      [3, 'main_category_not_found', { code: 'NOPE' }],
      [4, 'invalid_credit_code', undefined],
      [5, 'credit_code_taken', { code: 'SUP10001' }],
      [7, 'duplicate_credit_code', { row: 6 }],
      [8, 'invalid_language', undefined],
      [9, 'invalid_status', undefined],
      [10, 'duplicate_code', { row: 2 }],
      [11, 'required', undefined],
      [11, 'required', undefined],
      [12, 'main_category_disabled', { code: 'PER-WIRE' }],
      [13, 'supplier_category_disabled', undefined],
      [14, 'invalid_code', undefined],
    ]);
    expect(res.body.details[1].column).toBe('主营材料分类编码 / Main Category Codes');
    expect(await ctx.prisma.supplier.count({ where: { nameZh: '导入测试供应商' } })).toBe(0);
  });

  it('R04-8 编码已存在则更新：首选语言为空时不变；原来就有的停用主营分类可以保留；信用代码可以是自己原来的', async () => {
    // 此时 PER-WIRE 已停用；SUP10007 的主营分类就是它
    const res = await importRows(
      [
        row({
          0: 'sup10007',
          1: '山东海纳线缆股份有限公司',
          3: '91370000MA3HN00007',
          4: 'NORMAL',
          5: 'PER-WIRE',
          6: '郑经理',
          7: 'sales@haina.example.com',
          13: '启用',
        }),
        row({
          0: 'SUP10006',
          1: '明源照明（香港）有限公司',
          4: 'EXCELLENT',
          5: 'LED',
          6: 'Kevin Wong',
          7: 'kevin@brightsource.example.com',
          8: '+852 0000 0000',
        }),
      ],
      200,
      [...HEADERS, STATUS],
    );
    expect(res.body).toEqual({ created: 0, updated: 2 });

    const s7 = await supplier('SUP10007');
    expect(s7).toMatchObject({
      nameZh: '山东海纳线缆股份有限公司',
      status: 'ENABLED',
      creditCode: '91370000MA3HN00007',
    });
    expect(mainCodes(s7)).toEqual(['PER-WIRE']);
    const s6 = await supplier('SUP10006');
    expect(s6).toMatchObject({
      preferredLanguage: 'en-US',
      contactPhone: '+852 0000 0000',
      nameEn: null,
      status: 'ENABLED',
    });
    expect(mainCodes(s6)).toEqual(['LED']);

    // 新加停用的主营分类仍然不行
    const added = await importRows([row({ 0: 'SUP10006', 4: 'EXCELLENT', 5: 'LED,PER-WIRE' })], 422);
    expect(added.body.details[0]).toMatchObject({
      code: 'main_category_disabled',
      params: { code: 'PER-WIRE' },
    });
    await ctx.prisma.materialCategory.update({
      where: { id: category['PER-WIRE'] },
      data: { status: 'ENABLED' },
    });
  });

  it('R04-8 导出后原样导入：数据和更新时间都不变（导入导出往返一致）', async () => {
    const before = await snapshot();
    const res = await download(buyer, '/api/suppliers/export');
    const imported = await buyer
      .post('/api/suppliers/import')
      .attach('file', res.body, '供应商.xlsx')
      .expect(200);
    expect(imported.body).toEqual({ created: 0, updated: before.length });
    expect(await snapshot()).toEqual(before);
  });

  it('R04-6 导入把供应商停用：其门户用户的会话立即删除', async () => {
    const portal = await loginAs(ctx, { username: 'sales@huaxin.example.com' });
    await portal.get('/api/auth/me').expect(200);
    const rows = await exportRows(buyer, '?keyword=SUP10001');
    rows[1][13] = '停用';
    await importRows([rows[1]], 200, rows[0] as string[]);
    expect((await supplier('SUP10001')).status).toBe('DISABLED');
    await portal.get('/api/auth/me').expect(401);
  });

  it('R02-9 表头与模板不一致整表拒绝；没有 supplier:import 权限不能导入', async () => {
    const swapped = [HEADERS[1], HEADERS[0], ...HEADERS.slice(2)];
    const res = await importRows([row()], 422, swapped);
    expect(res.body).toMatchObject({ code: 'EXCEL_HEADER_MISMATCH', details: { orderMismatch: true } });
    await importRows([row()], 403, HEADERS, viewer);
  });
});
