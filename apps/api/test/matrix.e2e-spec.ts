import {
  PRESET_ROLES,
  type AuditLogDto,
  type InquiryDetailDto,
  type RoundMatrixDto,
} from '@quoteflow/shared';
import type { Cell as ExcelCell, Worksheet } from 'exceljs';
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
import { binaryParser, loadXlsx } from './helpers/xlsx';

const HOUR = 3600_000;
const START = new Date('2026-11-23T01:00:00.000Z');
const GREEN = 'FFE1F3D8';
const YELLOW = 'FFFFF2CC';

type Key = 'a' | 'b' | 'c' | 'd';

/**
 * M11 比价矩阵、导出与入围：甲提交两版（第 2 版降了第 1 行的价格和交期）、乙一版、丙拒绝、丁未响应。
 * 甲合计 1.1 × 1000 + 2.4 × 500 = 2300.00（最低），乙 1.0 × 1000 + 2.7 × 500 = 2350.00；
 * 第 1 行含税单价乙最低，第 2 行甲最低
 */
describe('M11 比价矩阵与入围', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let buyer: Agent;
  let manager: Agent;
  let admin: Agent;
  let noAmount: Agent;
  let pd: Agent;
  let portal: Record<Key, Agent>;
  let s: Record<Key, Supplier>;
  let p: PublishedLed;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const roundUrl = () => `/api/inquiries/${p.inquiry.id}/rounds/1`;
  const quoteOf = (key: Key) => p.quotes[(['a', 'b', 'c', 'd'] as const).indexOf(key)];

  async function matrix(agent: Agent = buyer): Promise<RoundMatrixDto> {
    return (await agent.get(`${roundUrl()}/matrix`).expect(200)).body;
  }

  async function exported(agent: Agent): Promise<{ summary: Worksheet; detail: Worksheet }> {
    const res = await agent.get(`${roundUrl()}/matrix/export`).buffer(true).parse(binaryParser).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = await loadXlsx(res.body as Buffer);
    return { summary: wb.getWorksheet('汇总')!, detail: wb.getWorksheet('明细')! };
  }

  /** 第一列（汇总）或"字段"列（明细）等于 text 的行 */
  function rowWhere(ws: Worksheet, column: number, text: string, after = 1): number {
    for (let r = after; r <= ws.rowCount; r++) if (ws.getCell(r, column).value === text) return r;
    throw new Error(`row ${text} not found`);
  }

  const fillOf = (cell: ExcelCell) =>
    (cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;

  const shortlist = (agent: Agent, keys: (Key | string)[]) =>
    agent.put(`${roundUrl()}/shortlist`).send({
      quoteIds: keys.map((k) => (['a', 'b', 'c', 'd'].includes(k) ? quoteOf(k as Key) : k)),
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(START);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    const buyerRole = PRESET_ROLES.find((r) => r.code === 'BUYER')!;
    await ctx.prisma.role.create({
      data: {
        code: 'EVAL_NO_AMOUNT',
        nameZh: '评标（无报价金额）',
        nameEn: 'Evaluator without amounts',
        dataScope: 'ALL',
        permissions: [...buyerRole.permissions],
        fieldPermissions: ['negotiation.amount'],
      },
    });
    const category = Object.fromEntries(
      (await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]),
    );
    const mk = (key: string, roles: string[]) => createUser(ctx.prisma, { username: key, name: key, roles });
    users = {
      buyer: await mk('buyer', ['BUYER']),
      manager: await mk('manager', ['PURCHASE_MANAGER']),
      admin: await mk('admin', ['ADMIN']),
      noAmount: await mk('noamount', ['EVAL_NO_AMOUNT']),
      pd: await mk('pd', ['PD']),
    };
    s = {
      a: await createSupplier(ctx.prisma, { code: 'TS-A', nameZh: '供应商甲' }),
      b: await createSupplier(ctx.prisma, { code: 'TS-B', nameZh: '供应商乙' }),
      c: await createSupplier(ctx.prisma, { code: 'TS-C', nameZh: '供应商丙' }),
      d: await createSupplier(ctx.prisma, { code: 'TS-D', nameZh: '供应商丁' }),
    };
    const portalAgents: Partial<Record<Key, Agent>> = {};
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      users[key] = await createUser(ctx.prisma, {
        username: `${key}@supplier.example.com`,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: s[key].id,
      });
      portalAgents[key] = await loginAs(ctx, users[key]);
    }
    portal = portalAgents as Record<Key, Agent>;
    buyer = await loginAs(ctx, users.buyer);
    manager = await loginAs(ctx, users.manager);
    admin = await loginAs(ctx, users.admin);
    noAmount = await loginAs(ctx, users.noAmount);
    pd = await loginAs(ctx, users.pd);

    p = await publishLedInquiry(
      ctx.prisma,
      buyer,
      manager,
      category['LED-2835'],
      [s.a.id, s.b.id, s.c.id, s.d.id],
      at(6 * HOUR),
      '比价测试询价',
    );
    ctx.clock.set(at(HOUR));
    await submitQuote(portal.a, quoteOf('a'), {
      [p.l1]: ledValues({ unit_price_incl_tax: '1.2' }),
      [p.l2]: ledValues({ unit_price_incl_tax: '2.4' }),
    });
    await submitQuote(portal.b, quoteOf('b'), {
      [p.l1]: ledValues({ unit_price_incl_tax: '1.0', lead_time_days: 45 }),
      [p.l2]: ledValues({ unit_price_incl_tax: '2.7', lead_time_days: 45 }),
    });
    await declineQuote(portal.c, quoteOf('c'));
    ctx.clock.set(at(2 * HOUR));
    await submitQuote(
      portal.a,
      quoteOf('a'),
      {
        [p.l1]: ledValues({ unit_price_incl_tax: '1.1', lead_time_days: 25 }),
        [p.l2]: ledValues({ unit_price_incl_tax: '2.4' }),
      },
      { changeNote: 'v2 降价' },
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R11-1 开标前矩阵、导出 QUOTE_SEALED，入围 ROUND_INVALID_STATUS；没有比价相关的 allowedActions', async () => {
    expect((await buyer.get(`${roundUrl()}/matrix`).expect(403)).body.code).toBe('QUOTE_SEALED');
    expect((await buyer.get(`${roundUrl()}/matrix/export`).expect(403)).body.code).toBe('QUOTE_SEALED');
    expect((await shortlist(buyer, ['a']).expect(409)).body.code).toBe('ROUND_INVALID_STATUS');
    const detail: InquiryDetailDto = (await buyer.get(`/api/inquiries/${p.inquiry.id}`).expect(200)).body;
    expect(detail.allowedActions).not.toEqual(expect.arrayContaining(['evaluate']));
    expect(detail.currentRound.shortlistCount).toBe(0);
  });

  it('R11-1 开标后有 inquiry:evaluate 才能看矩阵（管理员、PD 403）；allowedActions 有 evaluate / shortlist / exportMatrix', async () => {
    const opened = await openRound(ctx, manager, p, at(6 * HOUR));
    expect(opened.allowedActions).toEqual(expect.arrayContaining(['evaluate', 'shortlist', 'exportMatrix']));
    await matrix(buyer);
    await matrix(manager);
    for (const agent of [admin, pd]) {
      expect((await agent.get(`${roundUrl()}/matrix`).expect(403)).body.code).toBe('FORBIDDEN');
      expect((await agent.get(`${roundUrl()}/matrix/export`).expect(403)).body.code).toBe('FORBIDDEN');
    }
  });

  it('R11-2 汇总表：每家一行（含拒绝和未响应），合计、最长交期、版本数、变更备注；合计最低的高亮', async () => {
    const m = await matrix();
    expect(m).toMatchObject({
      roundNo: 1,
      roundStatus: 'OPENED',
      currency: 'CNY',
      shortlistLimit: 2,
      canShortlist: true,
    });
    expect(
      m.suppliers.map((r) => [
        r.supplier.code,
        r.status,
        r.quoted,
        r.totalAmount,
        r.maxLeadTimeDays,
        r.versionCount,
        r.currentVersionNo,
        r.lowestTotal,
      ]),
    ).toEqual([
      ['TS-A', 'EVALUATING', true, '2300.00', 30, 2, 2, true],
      ['TS-B', 'EVALUATING', true, '2350.00', 45, 1, 1, false],
      ['TS-C', 'DECLINED', false, null, null, 0, null, false],
      ['TS-D', 'INVITED', false, null, null, 0, null, false],
    ]);
    expect(m.suppliers[0]).toMatchObject({
      changeNote: 'v2 降价',
      currentVersionSource: 'ONLINE',
      lastSubmittedAt: at(2 * HOUR).toISOString(),
      shortlisted: false,
      negotiation: null,
    });
    expect(m.suppliers[2]).toMatchObject({ declineReasonCode: 'LEAD_TIME', declineReason: '交期无法满足' });
  });

  it('R11-3 明细：列为 inMatrix 列、每行各家的当前版本取值；每行含税单价最低的标记', async () => {
    const m = await matrix();
    const keys = m.columns.map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'unit_price_incl_tax',
        'total_price_incl_tax',
        'lead_time_days',
        'change_note',
      ]),
    );
    expect(keys).not.toContain('quantity');
    expect(m.columns.every((c) => c.inMatrix)).toBe(true);
    expect(m.lines.map((l) => [l.lineNo, l.quantity, l.quotes.map((q) => q.quoteId)])).toEqual([
      [1, '1000', [quoteOf('a'), quoteOf('b')]],
      [2, '500', [quoteOf('a'), quoteOf('b')]],
    ]);
    const [l1, l2] = m.lines;
    expect(
      l1.quotes.map((q) => [q.values.unit_price_incl_tax, q.values.total_price_incl_tax, q.lowestUnitPrice]),
    ).toEqual([
      ['1.1000', '1100.00', false],
      ['1.0000', '1000.00', true],
    ]);
    expect(l2.quotes.map((q) => [q.values.unit_price_incl_tax, q.lowestUnitPrice])).toEqual([
      ['2.4000', true],
      ['2.7000', false],
    ]);
  });

  it('R11-4 变更高亮：当前版本与上一版本逐行逐列比较，给出原值；第 1 版没有变更', async () => {
    const [l1, l2] = (await matrix()).lines;
    expect(l1.quotes[0].changes).toEqual({
      unit_price_incl_tax: '1.2000',
      unit_price_excl_tax: '1.0619',
      total_price_incl_tax: '1200.00',
      lead_time_days: 30,
    });
    expect(l2.quotes[0].changes).toEqual({});
    expect(l1.quotes[1].changes).toEqual({});
  });

  it('S-5 没有 quote.amount：合计和金额列为 null、不标最低价、不报金额列的变更', async () => {
    const m = await matrix(noAmount);
    expect(m.suppliers[0]).toMatchObject({
      totalAmount: null,
      lowestTotal: false,
      maskedFields: ['totalAmount'],
    });
    const cell = m.lines[0].quotes[0];
    expect(cell.values).toMatchObject({
      unit_price_incl_tax: null,
      total_price_incl_tax: null,
      lead_time_days: 25,
    });
    expect(cell.changes).toEqual({ lead_time_days: 30 });
    expect(m.lines.flatMap((l) => l.quotes).some((q) => q.lowestUnitPrice)).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/2300\.00|1\.1000|1200\.00/);
  });

  it('R11-5 导出：汇总 + 明细，内容与页面一致（最低价绿色、变更黄色）；要 inquiry:export', async () => {
    const { summary, detail } = await exported(buyer);
    const a = rowWhere(summary, 1, 'TS-A');
    expect([2, 3, 4, 5, 6, 7, 8, 10].map((c) => summary.getCell(a, c).value)).toEqual([
      '供应商甲',
      '评标中',
      2300,
      'CNY',
      30,
      2,
      'v2 在线',
      'v2 降价',
    ]);
    expect(fillOf(summary.getCell(a, 4))).toBe(GREEN);
    expect(fillOf(summary.getCell(rowWhere(summary, 1, 'TS-B'), 4))).toBeUndefined();
    expect(summary.getCell(rowWhere(summary, 1, 'TS-C'), 3).value).toBe('已拒绝');
    expect(summary.getCell(rowWhere(summary, 1, 'TS-D'), 3).value).toBe('未响应');

    const header = rowWhere(detail, 7, '字段');
    expect([8, 9].map((c) => detail.getCell(header, c).value)).toEqual(['TS-A 供应商甲', 'TS-B 供应商乙']);
    const price = rowWhere(detail, 7, '含税单价', header);
    expect([1, 8, 9].map((c) => detail.getCell(price, c).value)).toEqual([1, 1.1, 1]);
    expect(fillOf(detail.getCell(price, 8))).toBe(YELLOW);
    expect(fillOf(detail.getCell(price, 9))).toBe(GREEN);
    const price2 = rowWhere(detail, 7, '含税单价', price + 1);
    expect([8, 9].map((c) => detail.getCell(price2, c).value)).toEqual([2.4, 2.7]);
    expect(fillOf(detail.getCell(price2, 8))).toBe(GREEN);

    // 没有 inquiry:export 的自定义角色只能看矩阵、不能导出
    await ctx.prisma.role.update({
      where: { code: 'EVAL_NO_AMOUNT' },
      data: {
        permissions: PRESET_ROLES.find((r) => r.code === 'BUYER')!.permissions.filter(
          (x) => x !== 'inquiry:export',
        ),
      },
    });
    try {
      expect((await noAmount.get(`${roundUrl()}/matrix/export`).expect(403)).body.code).toBe('FORBIDDEN');
      expect(
        (await noAmount.get(`/api/inquiries/${p.inquiry.id}`).expect(200)).body.allowedActions,
      ).not.toContain('exportMatrix');
    } finally {
      await ctx.prisma.role.update({
        where: { code: 'EVAL_NO_AMOUNT' },
        data: { permissions: [...PRESET_ROLES.find((r) => r.code === 'BUYER')!.permissions] },
      });
    }
  });

  it('R11-5 去掉 quote.amount 后导出的金额写 "***"', async () => {
    const { summary, detail } = await exported(noAmount);
    expect(summary.getCell(rowWhere(summary, 1, 'TS-A'), 4).value).toBe('***');
    const price = rowWhere(detail, 7, '含税单价');
    expect([8, 9].map((c) => detail.getCell(price, c).value)).toEqual(['***', '***']);
    expect(detail.getCell(rowWhere(detail, 7, '量产交期(天)'), 8).value).toBe(25);
  });

  it('R11-6 入围：第 3 家、非评标中、不属于本轮的都被拒；最多 2 家', async () => {
    expect((await shortlist(buyer, ['a', 'b', 'd']).expect(400)).body).toMatchObject({
      code: 'SHORTLIST_LIMIT_EXCEEDED',
      params: { max: 2 },
    });
    expect((await shortlist(buyer, ['a', 'c']).expect(400)).body.code).toBe('SHORTLIST_INVALID_QUOTE');
    expect((await shortlist(buyer, ['d']).expect(400)).body.code).toBe('SHORTLIST_INVALID_QUOTE');
    expect((await shortlist(buyer, ['a', 'not-a-quote']).expect(400)).body.code).toBe(
      'SHORTLIST_INVALID_QUOTE',
    );
    expect((await shortlist(pd, ['a']).expect(403)).body.code).toBe('FORBIDDEN');

    ctx.clock.set(at(7 * HOUR));
    const m: RoundMatrixDto = (await shortlist(buyer, ['a', 'b']).expect(200)).body;
    expect(m.suppliers.map((r) => r.shortlisted)).toEqual([true, true, false, false]);
    const quote = await ctx.prisma.quote.findUniqueOrThrow({ where: { id: quoteOf('a') } });
    expect(quote.shortlistedAt).toEqual(at(7 * HOUR));
    const detail: InquiryDetailDto = (await buyer.get(`/api/inquiries/${p.inquiry.id}`).expect(200)).body;
    expect(detail.currentRound.shortlistCount).toBe(2);
    const logs: AuditLogDto[] = (await buyer.get(`/api/inquiries/${p.inquiry.id}/timeline`).expect(200)).body;
    expect(logs.find((l) => l.action === 'inquiry.shortlist')).toMatchObject({
      summary: `${p.inquiry.formalNo} · TS-A, TS-B`,
    });
    // 同样的名单再保存一次不记日志
    await shortlist(buyer, ['b', 'a']).expect(200);
    const again: AuditLogDto[] = (await buyer.get(`/api/inquiries/${p.inquiry.id}/timeline`).expect(200))
      .body;
    expect(again.filter((l) => l.action === 'inquiry.shortlist')).toHaveLength(1);
  });

  it('R11-6 发过议价的不能移出名单；没发过的可以替换', async () => {
    await buyer
      .post(`/api/quotes/${quoteOf('a')}/negotiation/offer`)
      .send({ lines: [{ lineId: p.l1, unitPriceInclTax: '1.05' }] })
      .expect(200);
    expect((await shortlist(buyer, ['b']).expect(409)).body.code).toBe('SHORTLIST_LOCKED');
    const m: RoundMatrixDto = (await shortlist(buyer, ['a']).expect(200)).body;
    expect(m.suppliers.map((r) => r.shortlisted)).toEqual([true, false, false, false]);
    expect(m.suppliers[0].negotiation).toEqual({ status: 'OPEN', awaiting: 'SUPPLIER', messageCount: 1 });
    const quote = await ctx.prisma.quote.findUniqueOrThrow({ where: { id: quoteOf('b') } });
    expect(quote).toMatchObject({ shortlisted: false, shortlistedAt: null });
  });
});
