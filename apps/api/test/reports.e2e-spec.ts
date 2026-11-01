import type {
  AuditLogDto,
  InquiryReportRowDto,
  LogisticsReportDto,
  Paginated,
  PointsLedgerItemDto,
  PointsSummaryRowDto,
  ReportFilterOptionsDto,
  SupplierPointsDto,
  SupplierQuoteItemDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import {
  declineQuote,
  ledValues,
  openRound,
  publishLedInquiry,
  submitQuote,
  type PublishedLed,
} from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';
import { binaryParser, loadXlsx, sheetRows } from './helpers/xlsx';

const HOUR = 3600_000;
const START = new Date('2026-11-09T01:00:00.000Z');

/** 物流列（A-09）：包装、装箱、外箱尺寸与重量、贸易条款、起运地、运费（金额敏感）、海关编码 */
const LOGISTICS = {
  packing_method: 'CARTON',
  pcs_per_carton: 2000,
  carton_l_cm: '40',
  carton_w_cm: '30',
  carton_h_cm: '25',
  carton_gw_kg: '9.5',
  trade_term: 'FOB',
  ship_from: '深圳',
  freight_cost: '120.5',
  hs_code: '8541410000',
};

/**
 * M15 报表（§4）与积分（R15-3、R15-4）：一张询价（甲、乙报价，丙拒绝）开标后定标给乙，另一张还在等待报价（甲已提交，密封）。
 * 断言四张报表的行、筛选、密封与脱敏、导出，积分手工调整，以及供应商详情的"报价记录 / 积分"
 */
describe('M15 报表与积分', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let agents: Record<'buyer' | 'buyer2' | 'manager' | 'admin', Agent>;
  let portal: Record<'a' | 'b' | 'c', Agent>;
  let s: Record<'a' | 'b' | 'c', Supplier>;
  let category: Record<string, string>;
  let opened: PublishedLed;
  let waiting: PublishedLed;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const lines = (p: PublishedLed, price1: string, price2: string) => ({
    [p.l1]: ledValues({ unit_price_incl_tax: price1, ...LOGISTICS }),
    [p.l2]: ledValues({ unit_price_incl_tax: price2, ...LOGISTICS, pcs_per_carton: 1000 }),
  });

  async function get<T>(agent: Agent, url: string): Promise<T> {
    return (await agent.get(url).expect(200)).body as T;
  }

  async function download(agent: Agent, url: string) {
    const res = await agent.get(url).buffer(true).parse(binaryParser).expect(200);
    const wb = await loadXlsx(res.body as Buffer);
    return { name: String(res.headers['content-disposition']), rows: sheetRows(wb.worksheets[0]) };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(START);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    const mk = (key: string, roles: string[]) =>
      createUser(ctx.prisma, { username: key, name: key, roles, email: `${key}@example.com` });
    users = {
      buyer: await mk('buyer', ['BUYER']),
      buyer2: await mk('buyer2', ['BUYER']),
      manager: await mk('manager', ['PURCHASE_MANAGER']),
      admin: await mk('admin', ['ADMIN']),
      approver: await mk('approver', ['CONTRACT_APPROVER']),
      pd: await mk('pd', ['PD']),
    };
    s = {
      a: await createSupplier(ctx.prisma, { code: 'TS-A', nameZh: '供应商甲', categoryCode: 'STRATEGIC' }),
      b: await createSupplier(ctx.prisma, { code: 'TS-B', nameZh: '供应商乙', categoryCode: 'EXCELLENT' }),
      c: await createSupplier(ctx.prisma, { code: 'TS-C', nameZh: '供应商丙', categoryCode: 'NORMAL' }),
    };
    for (const key of ['a', 'b', 'c'] as const) {
      users[key] = await createUser(ctx.prisma, {
        username: `${key}@supplier.example.com`,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: s[key].id,
      });
    }
    agents = {
      buyer: await loginAs(ctx, users.buyer),
      buyer2: await loginAs(ctx, users.buyer2),
      manager: await loginAs(ctx, users.manager),
      admin: await loginAs(ctx, users.admin),
    };
    portal = {
      a: await loginAs(ctx, users.a),
      b: await loginAs(ctx, users.b),
      c: await loginAs(ctx, users.c),
    };

    // 第一张：甲 2400.00、乙 2350.00，丙拒绝；开标后定标给乙
    opened = await publishLedInquiry(
      ctx.prisma,
      agents.buyer,
      agents.manager,
      category['LED-2835'],
      [s.a.id, s.b.id, s.c.id],
      at(6 * HOUR),
      '报表询价一',
    );
    ctx.clock.set(at(HOUR));
    await submitQuote(portal.a, opened.quotes[0], lines(opened, '1.2', '2.4'));
    await submitQuote(portal.b, opened.quotes[1], lines(opened, '1.0', '2.7'));
    await declineQuote(portal.c, opened.quotes[2]);
    // 第二张：甲已提交，还在等待报价（密封）
    waiting = await publishLedInquiry(
      ctx.prisma,
      agents.buyer,
      agents.manager,
      category['LED-COB'],
      [s.a.id, s.b.id],
      at(30 * HOUR),
      '报表询价二',
    );
    await submitQuote(portal.a, waiting.quotes[0], lines(waiting, '3.3333', '5.5555'));
    await openRound(ctx, agents.manager, opened, at(6 * HOUR));
    ctx.clock.set(at(7 * HOUR));
    await agents.manager
      .post(`/api/inquiries/${opened.inquiry.id}/rounds/1/award`)
      .send({ quoteId: opened.quotes[1] })
      .expect(200);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('询报价单统计：一行一个已发布的轮次；受邀家数、有效报价数、最低 / 最高 / 平均含税合计、中标供应商', async () => {
    const page = await get<Paginated<InquiryReportRowDto>>(agents.buyer, '/api/reports/inquiries');
    expect(page.total).toBe(2);
    // 按发布时间倒序
    expect(page.items.map((r) => r.inquiry.formalNo)).toEqual([
      waiting.inquiry.formalNo,
      opened.inquiry.formalNo,
    ]);
    const [second, first] = page.items;
    expect(first).toMatchObject({
      roundNo: 1,
      roundStatus: 'EVALUATED',
      inquiry: { title: '报表询价一', projectNo: 'PJ-TEST-001' },
      materialCategory: { code: 'LED-2835' },
      currency: 'CNY',
      invitedCount: 3,
      quotedCount: 2,
      minTotal: '2350.00',
      maxTotal: '2400.00',
      avgTotal: '2375.00',
      sealed: false,
      winner: { code: 'TS-B' },
      owner: { name: 'buyer' },
    });
    expect(first.maskedFields).toBeUndefined();
    // S-1 S-3 未开标的轮次金额被密封
    expect(second).toMatchObject({
      roundStatus: 'WAITING_QUOTES',
      invitedCount: 2,
      quotedCount: 1,
      minTotal: null,
      maxTotal: null,
      avgTotal: null,
      sealed: true,
      winner: null,
    });
  });

  it('询报价单统计的筛选：询价号、状态、发布日期、参与过的供应商、负责人、材料类别（含下级）', async () => {
    const count = async (query: string) =>
      (await get<Paginated<InquiryReportRowDto>>(agents.manager, `/api/reports/inquiries?${query}`)).total;
    expect(
      await count(`inquiryNo=${encodeURIComponent(opened.inquiry.formalNo!.slice(-6).toLowerCase())}`),
    ).toBe(1);
    expect(await count('roundStatus=EVALUATED')).toBe(1);
    expect(await count('roundStatus=OPENED')).toBe(0);
    expect(await count(`supplierId=${s.c.id}`)).toBe(1);
    expect(await count(`supplierId=${s.a.id}`)).toBe(2);
    expect(await count(`ownerId=${users.buyer.id}`)).toBe(2);
    expect(await count(`ownerId=${users.manager.id}`)).toBe(0);
    expect(await count(`materialCategoryId=${category.LED}`)).toBe(2);
    expect(await count(`materialCategoryId=${category['LED-COB']}`)).toBe(1);
    expect(await count(`materialCategoryId=${category.PER}`)).toBe(0);
    // 发布日期按北京时间：2026-11-09 09:00 发布
    expect(await count('from=2026-11-09&to=2026-11-09')).toBe(2);
    expect(await count('to=2026-11-08')).toBe(0);
    // 数据权限：另一位采购员（本人范围）看不到
    expect((await get<Paginated<InquiryReportRowDto>>(agents.buyer2, '/api/reports/inquiries')).total).toBe(
      0,
    );
  });

  it('S-5 没有 quote.amount 时金额为 null 并记在 maskedFields；导出写 ***，密封的写"密封"', async () => {
    const page = await get<Paginated<InquiryReportRowDto>>(agents.admin, '/api/reports/inquiries');
    const first = page.items.find((r) => r.roundStatus === 'EVALUATED')!;
    expect(first).toMatchObject({ minTotal: null, maxTotal: null, avgTotal: null, sealed: false });
    expect(first.maskedFields).toEqual(['minTotal', 'maxTotal', 'avgTotal']);
    const { rows } = await download(agents.admin, '/api/reports/inquiries/export');
    const row = rows.find((r) => r[0] === opened.inquiry.formalNo)!;
    expect(row.slice(8, 11)).toEqual(['***', '***', '***']);
    expect(rows.find((r) => r[0] === waiting.inquiry.formalNo)!.slice(8, 11)).toEqual([
      '密封',
      '密封',
      '密封',
    ]);
  });

  it('R15-2 报表导出：当前筛选条件下的全部行；表头、金额、中标供应商与列表一致', async () => {
    const { name, rows } = await download(
      agents.manager,
      '/api/reports/inquiries/export?roundStatus=EVALUATED',
    );
    expect(name).toContain(encodeURIComponent('询报价单统计'));
    const header = rows.findIndex((r) => r[0] === '正式询价号');
    expect(rows[header]).toEqual([
      '正式询价号',
      '轮次',
      '标题',
      '项目号',
      '材料类别',
      '状态',
      '受邀家数',
      '有效报价数',
      '最低含税合计',
      '最高含税合计',
      '平均含税合计',
      '币种',
      '中标供应商',
      '负责人',
      '发布时间',
    ]);
    const data = rows.slice(header + 1);
    expect(data).toHaveLength(1);
    expect(data[0].slice(0, 14)).toEqual([
      opened.inquiry.formalNo,
      1,
      '报表询价一',
      'PJ-TEST-001',
      'LED-2835 2835 灯珠',
      '评标完成',
      3,
      2,
      2350,
      2400,
      2375,
      'CNY',
      'TS-B 供应商乙',
      'buyer',
    ]);
    // 采购员没有 report:export
    expect((await agents.buyer.get('/api/reports/inquiries/export').expect(403)).body.code).toBe('FORBIDDEN');
  });

  it('物流报价明细（A-09）：只有开过标的轮次，每家有效报价的当前版本一个询价行一行；运费按 quote.amount 脱敏', async () => {
    const data = await get<LogisticsReportDto>(agents.buyer, '/api/reports/logistics');
    expect(data.columns.map((c) => c.key)).toEqual([
      'packing_method',
      'pcs_per_inner',
      'pcs_per_carton',
      'carton_l_cm',
      'carton_w_cm',
      'carton_h_cm',
      'carton_cbm',
      'carton_gw_kg',
      'carton_nw_kg',
      'trade_term',
      'ship_from',
      'freight_cost',
      'hs_code',
      'lead_time_days',
    ]);
    // 丙拒绝、第二张没开标，都不在里面（S-3）
    expect(data.items.map((r) => [r.inquiry.formalNo, r.supplier.code, r.lineNo])).toEqual([
      [opened.inquiry.formalNo, 'TS-A', 1],
      [opened.inquiry.formalNo, 'TS-A', 2],
      [opened.inquiry.formalNo, 'TS-B', 1],
      [opened.inquiry.formalNo, 'TS-B', 2],
    ]);
    expect(data.items[0]).toMatchObject({
      roundStatus: 'EVALUATED',
      versionNo: 1,
      nameZh: '灯珠 A',
      currency: 'CNY',
      values: {
        packing_method: 'CARTON',
        pcs_per_carton: 2000,
        carton_cbm: '0.0300',
        freight_cost: '120.50',
        trade_term: 'FOB',
        lead_time_days: 30,
        pcs_per_inner: null,
      },
    });
    expect(data.items[1].values.pcs_per_carton).toBe(1000);
    expect(data.items[0].values).not.toHaveProperty('unit_price_incl_tax');
    const supplierB = await get<LogisticsReportDto>(
      agents.buyer,
      `/api/reports/logistics?supplierId=${s.b.id}`,
    );
    expect(supplierB.total).toBe(2);
    const admin = await get<LogisticsReportDto>(agents.admin, '/api/reports/logistics');
    expect(admin.items[0].values.freight_cost).toBeNull();
    expect(admin.items[0].maskedFields).toEqual(['freight_cost']);
    const { rows } = await download(agents.admin, '/api/reports/logistics/export');
    const header = rows.findIndex((r) => r[0] === '正式询价号');
    expect(rows[header].slice(9, 13)).toEqual(['包装方式', '内盒数量', '每箱数量', '外箱长(cm)']);
    expect(rows[header + 1].slice(0, 10)).toEqual([
      opened.inquiry.formalNo,
      1,
      'TS-A',
      '供应商甲',
      1,
      1,
      null,
      '灯珠 A',
      'SPEC-1',
      '纸箱',
    ]);
    expect(rows[header + 1][rows[header].indexOf('运费')]).toBe('***');
    expect(rows[header + 1][rows[header].indexOf('贸易条款')]).toBe('离岸价');
  });

  it('R15-3 手工调整积分：要 points:adjust，分值为非零整数，备注必填；记审计；流水与汇总一致', async () => {
    const url = `/api/suppliers/${s.a.id}/points-adjust`;
    expect(
      (await agents.buyer.post(url).send({ delta: 3, remark: '配合紧急插单' }).expect(403)).body.code,
    ).toBe('FORBIDDEN');
    expect((await agents.manager.post(url).send({ delta: 3 }).expect(400)).body.code).toBe(
      'POINTS_REMARK_REQUIRED',
    );
    expect((await agents.manager.post(url).send({ delta: 3, remark: '  ' }).expect(400)).body.code).toBe(
      'POINTS_REMARK_REQUIRED',
    );
    expect((await agents.manager.post(url).send({ delta: 0, remark: 'x' }).expect(400)).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await agents.manager.post(url).send({ delta: 1.5, remark: 'x' }).expect(400)).body.code).toBe(
      'VALIDATION_FAILED',
    );
    await agents.manager
      .post('/api/suppliers/nope/points-adjust')
      .send({ delta: 1, remark: 'x' })
      .expect(404);

    ctx.clock.set(at(8 * HOUR));
    const entry: PointsLedgerItemDto = (
      await agents.manager.post(url).send({ delta: -3, remark: '样品尺寸超差' }).expect(201)
    ).body;
    expect(entry).toMatchObject({
      supplier: { code: 'TS-A' },
      ruleCode: 'MANUAL',
      source: 'MANUAL',
      delta: -3,
      remark: '样品尺寸超差',
      inquiry: null,
      createdBy: { name: 'manager' },
      createdAt: at(8 * HOUR).toISOString(),
    });
    const logs: Paginated<AuditLogDto> = await get(
      agents.admin,
      '/api/system/audit-logs?page=1&pageSize=100',
    );
    expect(logs.items.find((l) => l.action === 'supplier.pointsAdjust')).toMatchObject({
      entityType: 'supplier',
      entityId: s.a.id,
      summary: 'TS-A 供应商甲 -3',
      detail: { delta: -3, remark: '样品尺寸超差' },
    });

    // 甲：开标结算准时 +2、快速 +1，手工 −3；乙：准时 +2、快速 +1、中标 +5；丙拒绝不计
    const ledger = await get<Paginated<PointsLedgerItemDto>>(
      agents.buyer,
      '/api/reports/points-ledger?pageSize=100',
    );
    const sum = (code: string) =>
      ledger.items.filter((e) => e.supplier.code === code).reduce((total, e) => total + e.delta, 0);
    expect(ledger.items[0]).toMatchObject({ ruleCode: 'MANUAL', delta: -3 });
    expect(ledger.items.find((e) => e.ruleCode === 'WON')).toMatchObject({
      supplier: { code: 'TS-B' },
      delta: 5,
      source: 'AUTO',
      inquiry: { id: opened.inquiry.id, formalNo: opened.inquiry.formalNo },
      roundNo: 1,
      createdBy: null,
    });
    const summary = await get<Paginated<PointsSummaryRowDto>>(agents.buyer, '/api/reports/points-summary');
    expect(summary.items.map((r) => [r.supplier.code, r.balance, r.periodPoints])).toEqual([
      ['TS-B', 8, 8],
      ['TS-A', 0, 0],
      ['TS-C', 0, 0],
    ]);
    for (const row of summary.items) expect(row.balance).toBe(sum(row.supplier.code));
    expect(summary.items[1].byRule).toEqual({
      QUOTE_ON_TIME: 2,
      FAST_RESPONSE: 1,
      WON: 0,
      NO_RESPONSE: 0,
      MANUAL: -3,
    });
    expect(summary.items[1].lastChangedAt).toBe(at(8 * HOUR).toISOString());
    expect(summary.items[2].lastChangedAt).toBeNull();
  });

  it('积分统计与流水的筛选：区间内积分只算区间内的记录；规则、供应商筛选；导出', async () => {
    // 手工调整在 11-09 17:00（北京时间），开标结算在 15:00
    const period = await get<Paginated<PointsSummaryRowDto>>(
      agents.manager,
      '/api/reports/points-summary?from=2026-11-10&keyword=ts-a',
    );
    expect(period.items.map((r) => [r.supplier.code, r.balance, r.periodPoints])).toEqual([['TS-A', 0, 0]]);
    const strategic = await get<Paginated<PointsSummaryRowDto>>(
      agents.manager,
      '/api/reports/points-summary?supplierCategoryCode=EXCELLENT',
    );
    expect(strategic.items.map((r) => r.supplier.code)).toEqual(['TS-B']);
    const manual = await get<Paginated<PointsLedgerItemDto>>(
      agents.manager,
      '/api/reports/points-ledger?ruleCode=MANUAL',
    );
    expect(manual.total).toBe(1);
    const ofB = await get<Paginated<PointsLedgerItemDto>>(
      agents.manager,
      `/api/reports/points-ledger?supplierId=${s.b.id}`,
    );
    expect(ofB.items.map((e) => e.ruleCode).sort()).toEqual(['FAST_RESPONSE', 'QUOTE_ON_TIME', 'WON']);
    const summaryXlsx = await download(agents.manager, '/api/reports/points-summary/export');
    const header = summaryXlsx.rows.findIndex((r) => r[0] === '供应商编码');
    expect(summaryXlsx.rows[header]).toEqual([
      '供应商编码',
      '供应商名称',
      '供应商分类',
      '状态',
      '累计积分',
      '区间内积分',
      '准时报价',
      '快速响应',
      '中标',
      '未响应',
      '手工调整',
      '最近变动时间',
    ]);
    expect(summaryXlsx.rows[header + 1].slice(0, 11)).toEqual([
      'TS-B',
      '供应商乙',
      '优秀供应商',
      '启用',
      8,
      8,
      2,
      1,
      5,
      0,
      0,
    ]);
    const ledgerXlsx = await download(agents.manager, '/api/reports/points-ledger/export?ruleCode=MANUAL');
    const top = ledgerXlsx.rows.findIndex((r) => r[0] === '时间');
    expect(ledgerXlsx.rows[top + 1]).toEqual([
      '2026-11-09 17:00',
      'TS-A',
      '供应商甲',
      '手工调整',
      -3,
      '手工',
      null,
      null,
      '样品尺寸超差',
      'manager',
    ]);
    expect(ledgerXlsx.rows).toHaveLength(top + 2);
  });

  it('R15-4 供应商详情"报价记录"：参与过的报价单（数据权限内），金额受密封与脱敏约束；"积分"列出流水与累计积分', async () => {
    const quotes = await get<Paginated<SupplierQuoteItemDto>>(
      agents.buyer,
      `/api/suppliers/${s.a.id}/quotes`,
    );
    expect(
      quotes.items.map((q) => [q.inquiry.formalNo, q.roundNo, q.status, q.totalAmount, q.sealed]),
    ).toEqual([
      [waiting.inquiry.formalNo, 1, 'SUBMITTED', null, true],
      [opened.inquiry.formalNo, 1, 'LOST', '2400.00', false],
    ]);
    expect(quotes.items[1]).toMatchObject({ roundStatus: 'EVALUATED', currency: 'CNY' });
    expect(quotes.items[1].lastSubmittedAt).toBe(at(HOUR).toISOString());
    // 丙拒绝：没有有效报价
    const ofC = await get<Paginated<SupplierQuoteItemDto>>(agents.buyer, `/api/suppliers/${s.c.id}/quotes`);
    expect(ofC.items).toEqual([
      expect.objectContaining({ status: 'DECLINED', totalAmount: null, sealed: false }),
    ]);
    const admin = await get<Paginated<SupplierQuoteItemDto>>(agents.admin, `/api/suppliers/${s.a.id}/quotes`);
    expect(admin.items[1]).toMatchObject({ totalAmount: null, maskedFields: ['totalAmount'] });
    expect(
      (await get<Paginated<SupplierQuoteItemDto>>(agents.buyer2, `/api/suppliers/${s.a.id}/quotes`)).total,
    ).toBe(0);

    const points = await get<SupplierPointsDto>(agents.buyer2, `/api/suppliers/${s.a.id}/points`);
    expect(points.balance).toBe(0);
    // 按时间倒序：手工调整在开标结算之后
    expect(points.items[0]).toMatchObject({ ruleCode: 'MANUAL', delta: -3 });
    expect(
      points.items
        .slice(1)
        .map((e) => e.ruleCode)
        .sort(),
    ).toEqual(['FAST_RESPONSE', 'QUOTE_ON_TIME']);
    const ofB = await get<SupplierPointsDto>(agents.buyer, `/api/suppliers/${s.b.id}/points?pageSize=2`);
    expect(ofB).toMatchObject({ balance: 8, total: 3, pageSize: 2 });
    expect(ofB.items).toHaveLength(2);
    await agents.buyer.get('/api/suppliers/nope/quotes').expect(404);
    await agents.buyer.get('/api/suppliers/nope/points').expect(404);
  });

  it('筛选下拉：有 stats:view 或 report:view 即可（合同批准人没有 supplier:view 也能按供应商筛选）；负责人按数据权限', async () => {
    const approver = await loginAs(ctx, users.approver);
    const options: ReportFilterOptionsDto = await get(approver, '/api/reports/filter-options');
    expect(options.owners).toEqual([{ id: users.buyer.id, name: 'buyer' }]);
    expect(options.suppliers.map((x) => [x.code, x.categoryCode, x.status])).toEqual([
      ['TS-A', 'STRATEGIC', 'ENABLED'],
      ['TS-B', 'EXCELLENT', 'ENABLED'],
      ['TS-C', 'NORMAL', 'ENABLED'],
    ]);
    expect((await get<ReportFilterOptionsDto>(agents.buyer2, '/api/reports/filter-options')).owners).toEqual(
      [],
    );
    const pd = await loginAs(ctx, users.pd);
    expect((await pd.get('/api/reports/filter-options').expect(403)).body.code).toBe('FORBIDDEN');
    expect((await pd.get('/api/reports/inquiries').expect(403)).body.code).toBe('FORBIDDEN');
  });
});
