import {
  SYSTEM_PARAMS,
  type AuditLogDto,
  type InquiryDetailDto,
  type PortalQuoteDetailDto,
  type QuoteVersionDto,
  type RoleDto,
  type RoundQuoteDetailDto,
  type RoundResponsesDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { RoundDeadlineJob } from '../src/modules/inquiries/round-deadline.job';
import { PointsService } from '../src/modules/points/points.service';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { declineQuote, ledLines, publishLedInquiry, submitQuote, type PublishedLed } from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
const MINUTE = 60_000;
/** 每个用例开始时把测试时钟拨回这里（会话 12 小时过期，用例里前进不超过 12 小时） */
const START = new Date('2026-11-16T01:00:00.000Z');

type Key = 'a' | 'b' | 'c' | 'd';

describe('M10 截止、提前截止与开标', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let buyer: Agent;
  let manager: Agent;
  let admin: Agent;
  let portal: Record<Key, Agent>;
  let s: Record<Key, Supplier>;
  let category: Record<string, string>;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const runJob = () => ctx.app.get(RoundDeadlineJob).run();
  const roundUrl = (p: PublishedLed) => `/api/inquiries/${p.inquiry.id}/rounds/1`;

  /** 发布给 keys 里的供应商，quotes 与 keys 同序 */
  function published(keys: Key[], deadline = at(4 * HOUR)): Promise<PublishedLed> {
    return publishLedInquiry(
      ctx.prisma,
      buyer,
      manager,
      category['LED-2835'],
      keys.map((k) => s[k].id),
      deadline,
    );
  }

  async function detailOf(agent: Agent, p: PublishedLed): Promise<InquiryDetailDto> {
    return (await agent.get(`/api/inquiries/${p.inquiry.id}`).expect(200)).body;
  }

  async function auditsOf(p: PublishedLed, action: string): Promise<AuditLogDto[]> {
    const logs: AuditLogDto[] = (await buyer.get(`/api/inquiries/${p.inquiry.id}/timeline`).expect(200)).body;
    return logs.filter((l) => l.action === action);
  }

  /** 甲提交、乙拒绝、丙未响应，越过截止并执行截止任务 → 报价完成 */
  async function closedRound(): Promise<PublishedLed> {
    const p = await published(['a', 'b', 'c']);
    await submitQuote(portal.a, p.quotes[0], ledLines(p, '1.13', '2.26'));
    await declineQuote(portal.b, p.quotes[1]);
    ctx.clock.set(at(4 * HOUR));
    await runJob();
    return p;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(START);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    const mk = (key: string, roles: string[]) => createUser(ctx.prisma, { username: key, name: key, roles });
    users = {
      buyer: await mk('buyer', ['BUYER']),
      manager: await mk('manager', ['PURCHASE_MANAGER']),
      admin: await mk('admin', ['ADMIN']),
    };
    s = {
      a: await createSupplier(ctx.prisma, { code: 'TS-A', nameZh: '供应商甲', contactEmail: 'a@s.example.com' }),
      b: await createSupplier(ctx.prisma, {
        code: 'TS-B',
        nameZh: '供应商乙',
        nameEn: 'Supplier B',
        contactEmail: 'b@s.example.com',
        ccEmails: ['b.cc@s.example.com'],
        preferredLanguage: 'en-US',
      }),
      c: await createSupplier(ctx.prisma, { code: 'TS-C', nameZh: '供应商丙', contactEmail: 'c@s.example.com' }),
      d: await createSupplier(ctx.prisma, { code: 'TS-D', nameZh: '供应商丁', contactEmail: 'd@s.example.com' }),
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
  });

  beforeEach(async () => {
    ctx.clock.set(START);
    // 会话是滑动续期的，用例之间时钟会回拨，重新登录保证会话有效
    buyer = await loginAs(ctx, users.buyer);
    manager = await loginAs(ctx, users.manager);
    for (const key of ['a', 'b', 'c', 'd'] as const) portal[key] = await loginAs(ctx, users[key]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R10-1 截止任务：现在 ≥ 截止才关闭，同步询价单的当前轮次状态；重复执行无副作用', async () => {
    const p = await published(['a', 'b']);
    ctx.clock.set(at(4 * HOUR - MINUTE));
    await runJob();
    expect((await detailOf(buyer, p)).currentRoundStatus).toBe('WAITING_QUOTES');

    ctx.clock.set(at(4 * HOUR));
    expect(await runJob()).toEqual({ closed: 1 });
    const detail = await detailOf(buyer, p);
    expect(detail).toMatchObject({
      currentRoundStatus: 'QUOTES_CLOSED',
      displayStatus: 'QUOTES_CLOSED',
      currentRound: { status: 'QUOTES_CLOSED', quotesClosedAt: at(4 * HOUR).toISOString(), closedEarly: false },
    });
    const round = await ctx.prisma.inquiryRound.findUniqueOrThrow({ where: { id: p.roundId } });
    expect(round.quotesClosedAt).toEqual(at(4 * HOUR));

    ctx.clock.set(at(4 * HOUR + MINUTE));
    expect(await runJob()).toEqual({ closed: 0 });
    expect((await ctx.prisma.inquiryRound.findUniqueOrThrow({ where: { id: p.roundId } })).quotesClosedAt).toEqual(
      at(4 * HOUR),
    );
    const closes = await auditsOf(p, 'inquiry.close');
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ actor: null, summary: `${p.inquiry.formalNo} · 2026-11-16 13:00 UTC+8` });

    // 报价完成后供应商不能再提交
    const res = await portal.a.post(`/api/portal/quotes/${p.quotes[0]}/submit`).send({ lines: ledLines(p, '1', '2') });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('QUOTE_DEADLINE_PASSED');
  });

  it('R10-1 延期回到等待报价后，新的截止到了再关闭一次', async () => {
    const p = await published(['a']);
    ctx.clock.set(at(4 * HOUR));
    await runJob();
    await buyer
      .put(`${roundUrl(p)}/deadline`)
      .send({ deadline: at(8 * HOUR).toISOString() })
      .expect(200);
    expect((await detailOf(buyer, p)).currentRound).toMatchObject({
      status: 'WAITING_QUOTES',
      quotesClosedAt: null,
    });
    ctx.clock.set(at(8 * HOUR));
    expect(await runJob()).toEqual({ closed: 1 });
    expect((await detailOf(buyer, p)).currentRound).toMatchObject({
      status: 'QUOTES_CLOSED',
      quotesClosedAt: at(8 * HOUR).toISOString(),
    });
    expect(await auditsOf(p, 'inquiry.close')).toHaveLength(2);
  });

  it('R10-2 R10-8 提前截止：要 inquiry:open；有未响应的被拒；全部响应后成功，之后不能再改报价', async () => {
    const p = await published(['a', 'b']);
    expect((await detailOf(manager, p)).allowedActions).toContain('closeEarly');
    expect((await detailOf(buyer, p)).allowedActions).not.toContain('closeEarly');
    expect((await buyer.post(`${roundUrl(p)}/close-early`).expect(403)).body.code).toBe('FORBIDDEN');

    await submitQuote(portal.a, p.quotes[0], ledLines(p, '1.13', '2.26'));
    expect((await manager.post(`${roundUrl(p)}/close-early`).expect(409)).body).toMatchObject({
      code: 'ROUND_NOT_ALL_RESPONDED',
      params: { pending: 1 },
    });

    await declineQuote(portal.b, p.quotes[1]);
    ctx.clock.set(at(HOUR));
    const detail: InquiryDetailDto = (await manager.post(`${roundUrl(p)}/close-early`).expect(200)).body;
    expect(detail).toMatchObject({
      currentRoundStatus: 'QUOTES_CLOSED',
      currentRound: { closedEarly: true, quotesClosedAt: at(HOUR).toISOString() },
    });
    expect(detail.allowedActions).toEqual(expect.arrayContaining(['open', 'extendDeadline']));
    expect(detail.allowedActions).not.toContain('closeEarly');
    expect(await auditsOf(p, 'inquiry.closeEarly')).toMatchObject([
      { actor: { name: 'manager' }, summary: p.inquiry.formalNo },
    ]);

    // 截止前也不能再提交或拒绝（轮次已不在等待报价）
    const portalDetail: PortalQuoteDetailDto = (await portal.a.get(`/api/portal/quotes/${p.quotes[0]}`).expect(200))
      .body;
    expect(portalDetail.allowedActions).toEqual([]);
    const res = await portal.b.post(`/api/portal/quotes/${p.quotes[1]}/submit`).send({ lines: ledLines(p, '1', '2') });
    expect(res.body.code).toBe('QUOTE_DEADLINE_PASSED');
    // 已经报价完成的再提前截止
    expect((await manager.post(`${roundUrl(p)}/close-early`).expect(409)).body.code).toBe('ROUND_INVALID_STATUS');
    // 截止任务不会再处理它
    ctx.clock.set(at(4 * HOUR));
    expect(await runJob()).toEqual({ closed: 0 });
  });

  it('R10-3 R10-8 开标：只有报价完成可开、要 inquiry:open；已提交 → 评标中，未响应和已拒绝不变', async () => {
    const p = await published(['a', 'b', 'c']);
    await submitQuote(portal.a, p.quotes[0], ledLines(p, '1.13', '2.26'));
    await declineQuote(portal.b, p.quotes[1]);
    expect((await manager.post(`${roundUrl(p)}/open`).expect(409)).body.code).toBe('ROUND_INVALID_STATUS');
    expect((await detailOf(manager, p)).allowedActions).not.toContain('open');

    ctx.clock.set(at(4 * HOUR));
    await runJob();
    expect((await detailOf(manager, p)).allowedActions).toContain('open');
    expect((await buyer.post(`${roundUrl(p)}/open`).expect(403)).body.code).toBe('FORBIDDEN');

    ctx.clock.set(at(5 * HOUR));
    const detail: InquiryDetailDto = (await manager.post(`${roundUrl(p)}/open`).expect(200)).body;
    expect(detail).toMatchObject({
      currentRoundStatus: 'OPENED',
      displayStatus: 'OPENED',
      currentRound: { status: 'OPENED', openedAt: at(5 * HOUR).toISOString() },
    });
    expect(detail.allowedActions).not.toContain('open');
    const round = await ctx.prisma.inquiryRound.findUniqueOrThrow({ where: { id: p.roundId } });
    expect(round.openedById).toBe(users.manager.id);
    const quotes = await ctx.prisma.quote.findMany({ where: { roundId: p.roundId } });
    const statusOf = (i: number) => quotes.find((q) => q.id === p.quotes[i])!.status;
    expect([statusOf(0), statusOf(1), statusOf(2)]).toEqual(['EVALUATING', 'DECLINED', 'INVITED']);
    expect(await auditsOf(p, 'inquiry.open')).toMatchObject([
      { actor: { name: 'manager' }, summary: `${p.inquiry.formalNo} · TS-A` },
    ]);
    expect((await manager.post(`${roundUrl(p)}/open`).expect(409)).body.code).toBe('ROUND_INVALID_STATUS');

    // 门户：已提交的显示评标中，不能再填报
    const portalDetail: PortalQuoteDetailDto = (await portal.a.get(`/api/portal/quotes/${p.quotes[0]}`).expect(200))
      .body;
    expect(portalDetail).toMatchObject({ status: 'EVALUATING', allowedActions: [] });
  });

  it('R10-3 并发开标两次只成功一次，积分和开标邮件也只有一份', async () => {
    const p = await closedRound();
    const results = await Promise.all([
      manager.post(`${roundUrl(p)}/open`),
      manager.post(`${roundUrl(p)}/open`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('ROUND_INVALID_STATUS');
    expect(await ctx.prisma.supplierPointsEntry.count({ where: { roundId: p.roundId } })).toBe(3);
    expect(await ctx.prisma.emailMessage.count({ where: { inquiryId: p.inquiry.id, type: 'OPENING' } })).toBe(1);
    expect(await auditsOf(p, 'inquiry.open')).toHaveLength(1);
  });

  it('R10-4 开标结算积分：准时报价、快速响应（≤ fastResponseHours，含边界）、未响应；拒绝不加不减；重复结算无副作用', async () => {
    await admin
      .put('/api/system/params/points.rules')
      .send({ value: { quoteOnTime: 2, fastResponse: 1, fastResponseHours: 1, won: 5, noResponse: -2 } })
      .expect(200);
    try {
      const p = await published(['a', 'b', 'c', 'd']);
      // 甲正好 1 小时（算快速），乙 1 小时 1 分，丙拒绝，丁未响应
      ctx.clock.set(at(HOUR));
      await submitQuote(portal.a, p.quotes[0], ledLines(p, '1.13', '2.26'));
      ctx.clock.set(at(HOUR + MINUTE));
      await submitQuote(portal.b, p.quotes[1], ledLines(p, '1.13', '2.26'));
      await declineQuote(portal.c, p.quotes[2]);
      ctx.clock.set(at(4 * HOUR));
      await runJob();
      await manager.post(`${roundUrl(p)}/open`).expect(200);

      const entries = await ctx.prisma.supplierPointsEntry.findMany({
        where: { roundId: p.roundId },
        orderBy: [{ supplierId: 'asc' }, { ruleCode: 'asc' }],
      });
      const code = (id: string) => Object.values(s).find((x) => x.id === id)!.code;
      expect(
        entries.map((e) => [code(e.supplierId), e.ruleCode, e.delta, e.source]).sort((x, y) =>
          `${x[0]}${x[1]}`.localeCompare(`${y[0]}${y[1]}`),
        ),
      ).toEqual([
        ['TS-A', 'FAST_RESPONSE', 1, 'AUTO'],
        ['TS-A', 'QUOTE_ON_TIME', 2, 'AUTO'],
        ['TS-B', 'QUOTE_ON_TIME', 2, 'AUTO'],
        ['TS-D', 'NO_RESPONSE', -2, 'AUTO'],
      ]);
      for (const e of entries) {
        expect(e).toMatchObject({
          inquiryId: p.inquiry.id,
          bizKey: `${e.ruleCode}:${p.roundId}:${e.supplierId}`,
          createdAt: at(4 * HOUR),
        });
      }

      // 再结算一次（按开标前的状态）：bizKey 已存在，什么都不写
      const quotes = await ctx.prisma.quote.findMany({ where: { roundId: p.roundId } });
      const before = quotes.map((q) => ({ ...q, status: q.status === 'EVALUATING' ? ('SUBMITTED' as const) : q.status }));
      const written = await ctx.prisma.$transaction((tx) =>
        ctx.app.get(PointsService).settleOpening(tx, { id: p.roundId, inquiryId: p.inquiry.id }, before),
      );
      expect(written).toBe(0);
      expect(await ctx.prisma.supplierPointsEntry.count({ where: { roundId: p.roundId } })).toBe(4);
    } finally {
      await admin
        .put('/api/system/params/points.rules')
        .send({ value: SYSTEM_PARAMS['points.rules'].defaultValue })
        .expect(200);
    }
  });

  it('R10-5 开标邮件只发给进入评标的供应商：按首选语言、抄送抄送邮箱，不含金额和其他供应商', async () => {
    const p = await published(['a', 'b', 'c', 'd']);
    await submitQuote(portal.a, p.quotes[0], ledLines(p, '7.7777', '2.26'));
    await submitQuote(portal.b, p.quotes[1], ledLines(p, '8.8888', '2.26'));
    await declineQuote(portal.c, p.quotes[2]);
    ctx.clock.set(at(4 * HOUR));
    await runJob();
    await manager.post(`${roundUrl(p)}/open`).expect(200);

    const emails = await ctx.prisma.emailMessage.findMany({
      where: { inquiryId: p.inquiry.id, type: 'OPENING' },
      orderBy: { toAddresses: 'asc' },
    });
    expect(emails.map((e) => [e.toAddresses, e.ccAddresses, e.language, e.bizKey])).toEqual([
      [['a@s.example.com'], [], 'zh-CN', `OPENING:${p.quotes[0]}`],
      [['b@s.example.com'], ['b.cc@s.example.com'], 'en-US', `OPENING:${p.quotes[1]}`],
    ]);
    expect(emails[0].subject).toBe(`开标通知：${p.inquiry.formalNo} 灯珠询价`);
    expect(emails[0].text).toContain('2026-11-16 13:00');
    expect(emails[0].text).toContain(`/portal/quotes/${p.quotes[0]}`);
    expect(emails[1].subject).toBe(`Bids opened: ${p.inquiry.formalNo} 灯珠询价`);
    expect(emails[1].text).toContain('Supplier B');
    for (const e of emails) {
      const text = [e.subject, e.html, e.text].join('\n');
      for (const secret of ['7.7777', '8.8888', '7777.7', '8888.8', 'PJ-TEST-001']) {
        expect(text).not.toContain(secret);
      }
      // 不出现其他供应商
      for (const other of Object.values(s).filter((x) => x.id !== e.supplierId)) {
        for (const name of [other.nameZh, other.nameEn, other.code]) if (name) expect(text).not.toContain(name);
      }
    }
  });

  it('R10-7 开标后采购员能看报价详情与版本；去掉其 quote.amount 后金额列为 null，maskedFields 正确', async () => {
    const p = await closedRound();
    const quoteUrl = `${roundUrl(p)}/quotes/${p.quotes[0]}`;
    expect((await buyer.get(quoteUrl).expect(403)).body.code).toBe('QUOTE_SEALED');
    await manager.post(`${roundUrl(p)}/open`).expect(200);

    const detail: RoundQuoteDetailDto = (await buyer.get(quoteUrl).expect(200)).body;
    expect(detail).toMatchObject({
      status: 'EVALUATING',
      currentVersion: { versionNo: 1, totalAmount: '2260.00' },
      versions: [{ versionNo: 1, totalAmount: '2260.00' }],
    });
    expect(detail.currentVersion!.maskedFields).toBeUndefined();
    expect(detail.currentVersion!.lines[0].values).toMatchObject({ unit_price_incl_tax: '1.1300' });
    // 拒绝报价、未响应的报价单也能打开（没有版本）
    const declined: RoundQuoteDetailDto = (await buyer.get(`${roundUrl(p)}/quotes/${p.quotes[1]}`).expect(200)).body;
    expect(declined).toMatchObject({ status: 'DECLINED', currentVersion: null, declineReasonCode: 'LEAD_TIME' });

    const roles: RoleDto[] = (await admin.get('/api/system/roles').expect(200)).body;
    const role = roles.find((r) => r.code === 'BUYER')!;
    const body = (fieldPermissions: string[]) => ({
      nameZh: role.nameZh,
      nameEn: role.nameEn,
      description: role.description ?? undefined,
      dataScope: role.dataScope,
      permissions: role.permissions,
      fieldPermissions,
    });
    await admin
      .put(`/api/system/roles/${role.id}`)
      .send(body(role.fieldPermissions.filter((f) => f !== 'quote.amount')))
      .expect(200);
    try {
      const masked: RoundQuoteDetailDto = (await buyer.get(quoteUrl).expect(200)).body;
      expect(masked.currentVersion).toMatchObject({ totalAmount: null });
      expect(masked.versions[0].totalAmount).toBeNull();
      expect(masked.versions[0].maskedFields).toContain('totalAmount');
      const keys = masked.template.columns.filter((c) => c.sensitive).map((c) => c.key);
      expect(keys).toEqual(expect.arrayContaining(['unit_price_incl_tax', 'total_price_incl_tax', 'freight_cost']));
      expect(masked.currentVersion!.maskedFields!.sort()).toEqual(['totalAmount', ...keys].sort());
      for (const key of keys) expect(masked.currentVersion!.lines[0].values[key]).toBeNull();
      expect(masked.currentVersion!.lines[0].values).toMatchObject({ tax_rate: '13.00', lead_time_days: 30 });
      const version: QuoteVersionDto = (await buyer.get(`${quoteUrl}/versions/1`).expect(200)).body;
      expect(version.totalAmount).toBeNull();
      expect(JSON.stringify(version)).not.toContain('1.13');

      const list: RoundResponsesDto = (await buyer.get(`${roundUrl(p)}/responses`).expect(200)).body;
      expect(list.sealed).toBe(false);
      expect(list.items[0]).toMatchObject({ totalAmount: null, currency: 'CNY', maskedFields: ['totalAmount'] });
    } finally {
      await admin.put(`/api/system/roles/${role.id}`).send(body(role.fieldPermissions)).expect(200);
    }
    const list: RoundResponsesDto = (await buyer.get(`${roundUrl(p)}/responses`).expect(200)).body;
    expect(list.items.map((i) => [i.status, i.totalAmount])).toEqual([
      ['EVALUATING', '2260.00'],
      ['DECLINED', null],
      ['INVITED', null],
    ]);
  });
});
