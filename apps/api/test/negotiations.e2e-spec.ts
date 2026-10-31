import {
  PRESET_ROLES,
  type AuditLogDto,
  type NegotiationThreadDto,
  type PortalQuoteDetailDto,
  type QuoteVersionValues,
  type RoundMatrixDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { ledLines, openRound, publishLedInquiry, submitQuote, type PublishedLed } from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
const START = new Date('2026-11-30T01:00:00.000Z');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
/** 议价里的价格、成交后的金额：邮件和审计里不能出现 */
const PRICES = ['1.05', '2.2', '2.3', '1260', '2460', '2410', '0.95'];

type Key = 'a' | 'b' | 'c';

/**
 * M11 议价（05 §5）：甲、乙、丙都报价，开标后甲、乙入围。
 * 甲：目标价 → 接受（成交 v2）→ 再议 → 反提案 → 采购方接受（成交 v3）→ 询价取消时自动关闭；
 * 乙（英文）：目标价 → 拒绝 → 采购方结束议价
 */
describe('M11 议价', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let buyer: Agent;
  let buyer2: Agent;
  let manager: Agent;
  let admin: Agent;
  let quoteOnly: Agent;
  let portal: Record<Key, Agent>;
  let s: Record<Key, Supplier>;
  let p: PublishedLed;
  let attachmentId: string;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const quoteOf = (key: Key) => p.quotes[(['a', 'b', 'c'] as const).indexOf(key)];
  const url = (key: Key) => `/api/quotes/${quoteOf(key)}/negotiation`;
  const portalUrl = (key: Key) => `/api/portal/quotes/${quoteOf(key)}/negotiation`;

  async function thread(agent: Agent, key: Key): Promise<NegotiationThreadDto> {
    return (await agent.get(url(key)).expect(200)).body;
  }

  async function portalThread(key: Key): Promise<NegotiationThreadDto> {
    return (await portal[key].get(portalUrl(key)).expect(200)).body;
  }

  function offer(key: Key, body: Record<string, unknown>) {
    return buyer.post(`${url(key)}/offer`).send(body);
  }

  function respond(key: Key, body: Record<string, unknown>) {
    return portal[key].post(`${portalUrl(key)}/respond`).send(body);
  }

  async function lastMessageId(key: Key): Promise<string> {
    return (await thread(buyer, key)).messages.at(-1)!.id;
  }

  async function versionOf(key: Key) {
    const quote = await ctx.prisma.quote.findUniqueOrThrow({
      where: { id: quoteOf(key) },
      include: { currentVersion: true },
    });
    const version = quote.currentVersion!;
    const lines = (version.values as unknown as QuoteVersionValues).lines;
    return { version, l1: lines[0].values, l2: lines[1].values };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(START);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await ctx.prisma.role.create({
      data: {
        code: 'EVAL_QUOTE_ONLY',
        nameZh: '评标（无议价金额）',
        nameEn: 'Evaluator without negotiation amounts',
        dataScope: 'ALL',
        permissions: [...PRESET_ROLES.find((r) => r.code === 'BUYER')!.permissions],
        fieldPermissions: ['quote.amount'],
      },
    });
    const category = Object.fromEntries(
      (await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]),
    );
    const mk = (key: string, roles: string[]) =>
      createUser(ctx.prisma, { username: key, name: key, roles, email: `${key}@example.com` });
    users = {
      buyer: await mk('buyer', ['BUYER']),
      buyer2: await mk('buyer2', ['BUYER']),
      manager: await mk('manager', ['PURCHASE_MANAGER']),
      admin: await mk('admin', ['ADMIN']),
      quoteonly: await mk('quoteonly', ['EVAL_QUOTE_ONLY']),
    };
    s = {
      a: await createSupplier(ctx.prisma, {
        code: 'TS-A',
        nameZh: '供应商甲',
        contactEmail: 'a@s.example.com',
      }),
      b: await createSupplier(ctx.prisma, {
        code: 'TS-B',
        nameZh: '供应商乙',
        nameEn: 'Supplier B',
        contactEmail: 'b@s.example.com',
        ccEmails: ['b.cc@s.example.com'],
        preferredLanguage: 'en-US',
      }),
      c: await createSupplier(ctx.prisma, {
        code: 'TS-C',
        nameZh: '供应商丙',
        contactEmail: 'c@s.example.com',
      }),
    };
    const portalAgents: Partial<Record<Key, Agent>> = {};
    for (const key of ['a', 'b', 'c'] as const) {
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
    buyer2 = await loginAs(ctx, users.buyer2);
    manager = await loginAs(ctx, users.manager);
    admin = await loginAs(ctx, users.admin);
    quoteOnly = await loginAs(ctx, users.quoteonly);

    p = await publishLedInquiry(
      ctx.prisma,
      buyer,
      manager,
      category['LED-2835'],
      [s.a.id, s.b.id, s.c.id],
      at(6 * HOUR),
      '议价测试询价',
    );
    ctx.clock.set(at(HOUR));
    await submitQuote(portal.a, quoteOf('a'), ledLines(p, '1.2', '2.4'), { remark: '甲的备注' });
    await submitQuote(portal.b, quoteOf('b'), ledLines(p, '1.0', '2.7'));
    await submitQuote(portal.c, quoteOf('c'), ledLines(p, '1.5', '3.0'));
    attachmentId = (
      await buyer
        .post('/api/files')
        .field('kind', 'ATTACHMENT')
        .attach('file', PDF, '目标价说明.pdf')
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R11-7 开标前看议价 QUOTE_SEALED；开标后未入围的不能发 OFFER；权限与数据权限', async () => {
    expect((await buyer.get(url('a')).expect(403)).body.code).toBe('QUOTE_SEALED');
    await openRound(ctx, manager, p, at(6 * HOUR));
    await buyer
      .put(`/api/inquiries/${p.inquiry.id}/rounds/1/shortlist`)
      .send({ quoteIds: [quoteOf('a'), quoteOf('b')] })
      .expect(200);

    const c = await thread(buyer, 'c');
    expect(c).toMatchObject({
      status: null,
      shortlisted: false,
      awaiting: null,
      messages: [],
      allowedActions: [],
    });
    const res = await offer('c', { lines: [{ lineId: p.l1, unitPriceInclTax: '1.4' }] }).expect(409);
    expect(res.body.code).toBe('NEGOTIATION_NOT_ALLOWED');
    expect((await thread(buyer, 'a')).allowedActions).toEqual(['offer']);

    expect((await admin.get(url('a')).expect(403)).body.code).toBe('FORBIDDEN');
    expect((await portal.a.get(url('a')).expect(403)).body.code).toBe('FORBIDDEN');
    // 采购员 2 的数据权限是 SELF，不是这张询价的负责人
    expect((await buyer2.get(url('a')).expect(404)).body.code).toBe('NOT_FOUND');
    await buyer2
      .post(`${url('a')}/offer`)
      .send({ lines: [{ lineId: p.l1, specNote: 'x' }] })
      .expect(404);
  });

  it('R11-8 提案校验：没有任何一行有内容、询价行不属于本轮、价格 5 位小数、数量为 0、附件超过 10 个', async () => {
    expect((await offer('a', { lines: [] }).expect(400)).body.code).toBe('NEGOTIATION_EMPTY_OFFER');
    expect(
      (await offer('a', { lines: [{ lineId: p.l1, unitPriceInclTax: '' }] }).expect(400)).body.code,
    ).toBe('NEGOTIATION_EMPTY_OFFER');
    const foreign = await offer('a', { lines: [{ lineId: 'not-a-line', specNote: '改色' }] }).expect(400);
    expect(foreign.body).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'lines.0.lineId' }] });
    expect(
      (await offer('a', { lines: [{ lineId: p.l1, unitPriceInclTax: '1.00001' }] }).expect(400)).body.code,
    ).toBe('VALIDATION_FAILED');
    expect((await offer('a', { lines: [{ lineId: p.l1, quantity: '0' }] }).expect(400)).body.code).toBe(
      'VALIDATION_FAILED',
    );
    const many = Array.from({ length: 11 }, (_, i) => `file${i}`);
    const tooMany = await offer('a', {
      lines: [{ lineId: p.l1, specNote: '改色' }],
      attachmentFileIds: many,
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toMatchObject({ code: 'FILE_LIMIT_EXCEEDED', params: { max: 10 } });
    expect(await ctx.prisma.negotiation.count()).toBe(0);
  });

  it('R11-7 轮流：供应商不能先回复；OFFER 之后采购方不能再 OFFER / ACCEPT / CLOSE', async () => {
    const early = await respond('a', { type: 'ACCEPT', replyToId: 'none' }).expect(409);
    expect(early.body.code).toBe('NEGOTIATION_NOT_YOUR_TURN');

    ctx.clock.set(at(7 * HOUR));
    const res = await offer('a', {
      lines: [
        { lineId: p.l1, unitPriceInclTax: '1.05', quantity: '1200', specNote: '改用哑光外壳' },
        { lineId: p.l2 },
      ],
      content: '批量 1200 的目标价',
      attachmentFileIds: [attachmentId],
    }).expect(200);
    const t: NegotiationThreadDto = res.body;
    expect(t).toMatchObject({
      status: 'OPEN',
      awaiting: 'SUPPLIER',
      allowedActions: [],
      currentVersionNo: 1,
    });
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toMatchObject({
      seq: 1,
      negotiationRound: 1,
      party: 'BUYER',
      type: 'OFFER',
      content: '批量 1200 的目标价',
      replyToId: null,
      author: { name: 'buyer' },
      createdAt: at(7 * HOUR).toISOString(),
      lines: [
        { lineId: p.l1, lineNo: 1, unitPriceInclTax: '1.05', quantity: '1200', specNote: '改用哑光外壳' },
      ],
      attachments: [{ id: attachmentId, originalName: '目标价说明.pdf' }],
      resultVersionNo: null,
    });
    expect(t.lines.map((l) => [l.lineNo, l.quantity, l.currentUnitPrice, l.currentQuantity])).toEqual([
      [1, '1000', '1.2000', '1000'],
      [2, '500', '2.4000', '500'],
    ]);

    const offerId = t.messages[0].id;
    expect(
      (await offer('a', { lines: [{ lineId: p.l1, unitPriceInclTax: '1' }] }).expect(409)).body.code,
    ).toBe('NEGOTIATION_NOT_YOUR_TURN');
    expect(
      (
        await buyer
          .post(`${url('a')}/accept`)
          .send({ messageId: offerId })
          .expect(409)
      ).body.code,
    ).toBe('NEGOTIATION_NOT_YOUR_TURN');
    expect(
      (
        await buyer
          .post(`${url('a')}/close`)
          .send({})
          .expect(409)
      ).body.code,
    ).toBe('NEGOTIATION_NOT_YOUR_TURN');

    // 供应商一侧：轮到回复；附件只有本供应商和有权的采购方能下载
    const detail: PortalQuoteDetailDto = (
      await portal.a.get(`/api/portal/quotes/${quoteOf('a')}`).expect(200)
    ).body;
    expect(detail).toMatchObject({ negotiationStatus: 'OPEN', allowedActions: ['respondNegotiation'] });
    expect((await portalThread('a')).allowedActions).toEqual(['accept', 'reject', 'counter']);
    await portal.a.get(`/api/files/${attachmentId}/content`).expect(200);
    await portal.b.get(`/api/files/${attachmentId}/content`).expect(403);
    await buyer2.get(`/api/files/${attachmentId}/content`).expect(403);
    await manager.get(`/api/files/${attachmentId}/content`).expect(200);
  });

  it('P-1 供应商只能看、只能回复自己的议价', async () => {
    expect((await portal.b.get(portalUrl('a')).expect(404)).body.code).toBe('NOT_FOUND');
    const offerId = await lastMessageId('a');
    await portal.b
      .post(`${portalUrl('a')}/respond`)
      .send({ type: 'ACCEPT', replyToId: offerId })
      .expect(404);
  });

  it('R11-7 REJECT / COUNTER 必须填原因，COUNTER 至少一行；replyToId 不是最近一条被拒', async () => {
    const offerId = await lastMessageId('a');
    expect((await respond('a', { type: 'REJECT', replyToId: offerId }).expect(400)).body.code).toBe(
      'NEGOTIATION_REASON_REQUIRED',
    );
    expect(
      (
        await respond('a', {
          type: 'COUNTER',
          replyToId: offerId,
          lines: [{ lineId: p.l1, unitPriceInclTax: '1.1' }],
        }).expect(400)
      ).body.code,
    ).toBe('NEGOTIATION_REASON_REQUIRED');
    expect(
      (
        await respond('a', {
          type: 'COUNTER',
          replyToId: offerId,
          content: '太低',
          lines: [{ lineId: p.l1 }],
        }).expect(400)
      ).body.code,
    ).toBe('NEGOTIATION_EMPTY_OFFER');
    expect((await respond('a', { type: 'ACCEPT', replyToId: 'stale' }).expect(409)).body.code).toBe(
      'NEGOTIATION_NOT_YOUR_TURN',
    );
  });

  it('05 §5 供应商接受：以当前版本为底覆盖单价和数量、追加规格说明、重算公式与合计，生成议价版本；AGREED', async () => {
    const offerId = await lastMessageId('a');
    ctx.clock.set(at(8 * HOUR));
    const t: NegotiationThreadDto = (await respond('a', { type: 'ACCEPT', replyToId: offerId }).expect(200))
      .body;
    expect(t).toMatchObject({ status: 'AGREED', awaiting: 'BUYER', allowedActions: [], currentVersionNo: 2 });
    expect(t.messages[1]).toMatchObject({
      seq: 2,
      negotiationRound: 1,
      party: 'SUPPLIER',
      type: 'ACCEPT',
      replyToId: offerId,
      resultVersionNo: 2,
    });

    const { version, l1, l2 } = await versionOf('a');
    expect(version).toMatchObject({
      versionNo: 2,
      source: 'NEGOTIATION',
      negotiationMessageId: t.messages[1].id,
      remark: '甲的备注',
      changeNote: '批量 1200 的目标价',
      submittedById: users.a.id,
      submittedAt: at(8 * HOUR),
    });
    expect(version.totalAmount.toFixed(2)).toBe('2460.00');
    expect(l1).toMatchObject({
      unit_price_incl_tax: '1.0500',
      quantity: '1200',
      unit_price_excl_tax: '0.9292',
      total_price_incl_tax: '1260.00',
      change_note: '议价第 1 轮：改用哑光外壳',
      lead_time_days: 30,
    });
    expect(l2).toMatchObject({ unit_price_incl_tax: '2.4000', total_price_incl_tax: '1200.00' });
    expect(l2).not.toHaveProperty('quantity');
    const negotiation = await ctx.prisma.negotiation.findUniqueOrThrow({ where: { quoteId: quoteOf('a') } });
    expect(negotiation).toMatchObject({ status: 'AGREED', agreedAt: at(8 * HOUR) });
    expect((await thread(buyer, 'a')).allowedActions).toEqual(['offer']);
    expect((await thread(buyer, 'a')).lines[0]).toMatchObject({
      currentUnitPrice: '1.0500',
      currentQuantity: '1200',
    });
  });

  it('R11-9 成交后比价矩阵立即显示新版本：多出"数量"行，变化的单元格给出原值', async () => {
    const m: RoundMatrixDto = (await buyer.get(`/api/inquiries/${p.inquiry.id}/rounds/1/matrix`).expect(200))
      .body;
    expect(m.suppliers[0]).toMatchObject({
      totalAmount: '2460.00',
      currentVersionNo: 2,
      currentVersionSource: 'NEGOTIATION',
      negotiation: { status: 'AGREED', awaiting: 'BUYER', messageCount: 2 },
    });
    expect(m.columns.map((c) => c.key)).toContain('quantity');
    const [a, b] = m.lines[0].quotes;
    expect(a.values).toMatchObject({ quantity: '1200', unit_price_incl_tax: '1.0500' });
    expect(b.values.quantity).toBe('1000');
    expect(a.changes).toEqual({
      quantity: '1000',
      unit_price_incl_tax: '1.2000',
      unit_price_excl_tax: '1.0619',
      total_price_incl_tax: '1200.00',
      change_note: null,
    });
    expect(m.lines[1].quotes[0].changes).toEqual({});
  });

  it('R11-9 成交后可以再议（回到 OPEN）；采购方接受反提案同样生成版本', async () => {
    ctx.clock.set(at(9 * HOUR));
    const again: NegotiationThreadDto = (
      await offer('a', {
        lines: [{ lineId: p.l2, unitPriceInclTax: '2.2' }],
        content: '第 2 行再降一点',
      }).expect(200)
    ).body;
    expect(again).toMatchObject({ status: 'OPEN', awaiting: 'SUPPLIER' });
    expect(again.messages[2]).toMatchObject({
      seq: 3,
      negotiationRound: 2,
      type: 'OFFER',
      replyToId: again.messages[1].id,
    });

    const countered: NegotiationThreadDto = (
      await respond('a', {
        type: 'COUNTER',
        replyToId: again.messages[2].id,
        content: '原材料涨价，最低 2.3',
        lines: [{ lineId: p.l2, unitPriceInclTax: '2.3', specNote: '包装改为纸箱' }],
      }).expect(200)
    ).body;
    expect(countered).toMatchObject({ awaiting: 'BUYER' });
    expect(countered.messages[3]).toMatchObject({ negotiationRound: 2, party: 'SUPPLIER', type: 'COUNTER' });
    const counter = await thread(buyer, 'a');
    expect(counter.allowedActions).toEqual(['accept', 'offer', 'close']);

    expect(
      (
        await buyer
          .post(`${url('a')}/accept`)
          .send({ messageId: again.messages[2].id })
          .expect(409)
      ).body.code,
    ).toBe('NEGOTIATION_NOT_YOUR_TURN');
    const agreed: NegotiationThreadDto = (
      await buyer
        .post(`${url('a')}/accept`)
        .send({ messageId: countered.messages[3].id })
        .expect(200)
    ).body;
    expect(agreed).toMatchObject({ status: 'AGREED', currentVersionNo: 3 });
    expect(agreed.messages[4]).toMatchObject({ party: 'BUYER', type: 'ACCEPT', resultVersionNo: 3 });

    const { version, l1, l2 } = await versionOf('a');
    expect(version).toMatchObject({
      versionNo: 3,
      source: 'NEGOTIATION',
      changeNote: '原材料涨价，最低 2.3',
      submittedById: users.buyer.id,
    });
    expect(version.totalAmount.toFixed(2)).toBe('2410.00');
    expect(l1).toMatchObject({
      unit_price_incl_tax: '1.0500',
      quantity: '1200',
      total_price_incl_tax: '1260.00',
    });
    expect(l2).toMatchObject({
      unit_price_incl_tax: '2.3000',
      total_price_incl_tax: '1150.00',
      change_note: '议价第 2 轮：包装改为纸箱',
    });
  });

  it('CLOSE 之后任何操作都被拒', async () => {
    const t: NegotiationThreadDto = (
      await offer('b', { lines: [{ lineId: p.l1, unitPriceInclTax: '0.95' }] }).expect(200)
    ).body;
    await respond('b', { type: 'REJECT', replyToId: t.messages[0].id, content: 'Price too low' }).expect(200);
    expect((await thread(buyer, 'b')).allowedActions).toEqual(['offer', 'close']);
    const closed: NegotiationThreadDto = (
      await buyer
        .post(`${url('b')}/close`)
        .send({ content: '价格差距太大' })
        .expect(200)
    ).body;
    expect(closed).toMatchObject({ status: 'CLOSED', awaiting: null, allowedActions: [] });
    expect(closed.messages.map((m) => [m.party, m.type])).toEqual([
      ['BUYER', 'OFFER'],
      ['SUPPLIER', 'REJECT'],
      ['BUYER', 'CLOSE'],
    ]);
    expect(
      (await offer('b', { lines: [{ lineId: p.l1, unitPriceInclTax: '0.98' }] }).expect(409)).body.code,
    ).toBe('NEGOTIATION_CLOSED');
    expect(
      (await respond('b', { type: 'ACCEPT', replyToId: closed.messages[2].id }).expect(409)).body.code,
    ).toBe('NEGOTIATION_CLOSED');
    expect(
      (
        await buyer
          .post(`${url('b')}/close`)
          .send({})
          .expect(409)
      ).body.code,
    ).toBe('NEGOTIATION_CLOSED');
    expect((await portalThread('b')).allowedActions).toEqual([]);
    // 发过议价的不能移出入围名单
    const res = await buyer
      .put(`/api/inquiries/${p.inquiry.id}/rounds/1/shortlist`)
      .send({ quoteIds: [quoteOf('a')] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHORTLIST_LOCKED');
  });

  it('邮件：每一步给对方发一封（成交双方各一封），语言按收件人，不含金额', async () => {
    const emails = await ctx.prisma.emailMessage.findMany({
      where: { inquiryId: p.inquiry.id, type: 'NEGOTIATION' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const summary = emails.map((e) => [
      e.toAddresses.join(','),
      e.language,
      e.subject.split('：')[0].split(':')[0],
    ]);
    expect(summary).toEqual([
      ['a@s.example.com', 'zh-CN', '议价通知'],
      ['a@s.example.com', 'zh-CN', '议价成交'],
      ['buyer@example.com', 'zh-CN', '议价成交'],
      ['a@s.example.com', 'zh-CN', '议价通知'],
      ['buyer@example.com', 'zh-CN', '议价回复'],
      ['a@s.example.com', 'zh-CN', '议价成交'],
      ['buyer@example.com', 'zh-CN', '议价成交'],
      ['b@s.example.com', 'en-US', 'Negotiation request'],
      ['buyer@example.com', 'zh-CN', '议价回复'],
      ['b@s.example.com', 'en-US', 'Negotiation closed'],
    ]);
    expect(emails[7].ccAddresses).toEqual(['b.cc@s.example.com']);
    expect(emails[4].text).toContain('提出了反提案');
    expect(emails[8].text).toContain('拒绝了目标价');
    expect(emails[8].text).toContain(`/inquiries/${p.inquiry.id}?tab=negotiation`);
    expect(emails[0].text).toContain(`/portal/quotes/${quoteOf('a')}`);
    for (const e of emails) {
      for (const price of PRICES) expect([e.subject, e.html, e.text].join()).not.toContain(price);
    }
  });

  it('R11-10 没有 negotiation.amount 的内部用户看到的议价价格为 null；供应商始终看到全部', async () => {
    const masked = await thread(quoteOnly, 'a');
    const proposals = masked.messages.filter((m) => m.lines.length > 0);
    expect(proposals.length).toBeGreaterThan(0);
    for (const m of proposals) {
      expect(m.maskedFields).toEqual(['unitPriceInclTax']);
      for (const l of m.lines) expect(l.unitPriceInclTax).toBeNull();
    }
    expect(masked.messages[0].lines[0]).toMatchObject({ quantity: '1200', specNote: '改用哑光外壳' });
    // 有 quote.amount：参照行的当前单价照常显示
    expect(masked.lines[1].currentUnitPrice).toBe('2.3000');
    expect(masked.maskedFields).toBeUndefined();

    const own = await portalThread('a');
    expect(own.messages[0].lines[0].unitPriceInclTax).toBe('1.05');
    expect(own.messages[0].maskedFields).toBeUndefined();
  });

  it('R11-11 议价每一步都记审计（不含金额）', async () => {
    const logs: AuditLogDto[] = (await buyer.get(`/api/inquiries/${p.inquiry.id}/timeline`).expect(200)).body;
    const steps = logs.filter((l) => l.action.startsWith('negotiation.'));
    const count = (action: string) => steps.filter((l) => l.action === action).length;
    expect([
      count('negotiation.offer'),
      count('negotiation.accept'),
      count('negotiation.counter'),
      count('negotiation.reject'),
      count('negotiation.close'),
    ]).toEqual([3, 2, 1, 1, 1]);
    expect(steps.find((l) => l.action === 'negotiation.counter')).toMatchObject({
      summary: `${p.inquiry.formalNo} · TS-A · #2`,
    });
    const text = JSON.stringify(steps);
    for (const price of PRICES) expect(text).not.toContain(price);
  });

  it('05 §1 取消询价时关闭进行中的议价（系统 CLOSE 消息），已关闭的不再追加', async () => {
    ctx.clock.set(at(10 * HOUR));
    await manager.post(`/api/inquiries/${p.inquiry.id}/cancel`).send({ reason: '项目暂停' }).expect(200);
    const a = await thread(buyer, 'a');
    expect(a).toMatchObject({ status: 'CLOSED', awaiting: null, allowedActions: [] });
    expect(a.messages.at(-1)).toMatchObject({
      party: 'BUYER',
      type: 'CLOSE',
      content: 'AUTO_CLOSED_BY_CANCEL',
      author: { name: 'manager' },
      createdAt: at(10 * HOUR).toISOString(),
    });
    expect((await thread(buyer, 'b')).messages).toHaveLength(3);
    const logs: AuditLogDto[] = (await buyer.get(`/api/inquiries/${p.inquiry.id}/timeline`).expect(200)).body;
    expect(logs.find((l) => l.action === 'inquiry.cancel')?.detail).toMatchObject({ closedNegotiations: 1 });
    // R12-8：询价取消后议价同样只读
    expect(
      (await respond('a', { type: 'ACCEPT', replyToId: a.messages.at(-1)!.id }).expect(409)).body.code,
    ).toBe('INQUIRY_COMPLETED_READONLY');
  });
});
