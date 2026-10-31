import {
  PPL_V0,
  resolveColumns,
  SYSTEM_PARAMS,
  type AuditLogDto,
  type ContractSnapshot,
  type InquiryDetailDto,
  type NegotiationThreadDto,
  type PortalQuoteDetailDto,
  type RoundMatrixDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { PointsService } from '../src/modules/points/points.service';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { inquiryBody, manualLineBody } from './helpers/inquiries';
import {
  declineQuote,
  ledLines,
  ledValues,
  openRound,
  publishLedInquiry,
  submitQuote,
  type PublishedLed,
} from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
const START = new Date('2026-12-01T01:00:00.000Z');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

type Key = 'a' | 'b' | 'c' | 'd' | 'e';
const KEYS: Key[] = ['a', 'b', 'c', 'd', 'e'];

/**
 * M12 定标与询盘完成：甲、乙、丙报价，丁拒绝，戊未响应；开标后甲、乙入围，甲议价成交（v2），乙议价进行中。
 * 采购主管定标给甲：报价终态、议价自动关闭、轮次评标完成、询盘完成只读、合同草稿与快照、积分、邮件
 */
describe('M12 定标与询盘完成', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let buyer: Agent;
  let buyer2: Agent;
  let manager: Agent;
  let admin: Agent;
  const portal = {} as Record<Key, Agent>;
  let s: Record<Key, Supplier>;
  let category: Record<string, string>;
  let p: PublishedLed;
  let attachmentId: string;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const quoteOf = (key: Key, of: PublishedLed = p) => of.quotes[KEYS.indexOf(key)];
  const roundUrl = (of: PublishedLed = p) => `/api/inquiries/${of.inquiry.id}/rounds/1`;
  const award = (agent: Agent, quoteId: string, extra: Record<string, unknown> = {}, of: PublishedLed = p) =>
    agent.post(`${roundUrl(of)}/award`).send({ quoteId, ...extra });

  async function detailOf(agent: Agent, of: PublishedLed = p): Promise<InquiryDetailDto> {
    return (await agent.get(`/api/inquiries/${of.inquiry.id}`).expect(200)).body;
  }

  async function thread(key: Key): Promise<NegotiationThreadDto> {
    return (await buyer.get(`/api/quotes/${quoteOf(key)}/negotiation`).expect(200)).body;
  }

  async function quoteStatuses(of: PublishedLed = p): Promise<string[]> {
    const quotes = await ctx.prisma.quote.findMany({ where: { roundId: of.roundId } });
    return of.quotes.map((id) => quotes.find((q) => q.id === id)!.status);
  }

  /** 会话 12 小时（滑动续期）：测试时钟往后拨了很多时，重新登录所有账号 */
  async function loginAll(): Promise<void> {
    buyer = await loginAs(ctx, users.buyer);
    buyer2 = await loginAs(ctx, users.buyer2);
    manager = await loginAs(ctx, users.manager);
    admin = await loginAs(ctx, users.admin);
    for (const key of KEYS) portal[key] = await loginAs(ctx, users[key]);
  }

  /** 发一张询价给 keys 这几家：丁拒绝、戊不响应，其余报价；截止后开标 */
  async function openedInquiry(keys: Key[], title: string, start: number): Promise<PublishedLed> {
    ctx.clock.set(at(start));
    await loginAll();
    const published = await publishLedInquiry(
      ctx.prisma,
      buyer,
      manager,
      category['LED-2835'],
      keys.map((k) => s[k].id),
      at(start + 6 * HOUR),
      title,
    );
    ctx.clock.set(at(start + HOUR));
    const prices: Record<Key, [string, string]> = {
      a: ['1.2', '2.4'],
      b: ['1.0', '2.7'],
      c: ['1.5', '3.0'],
      d: ['1', '1'],
      e: ['1', '1'],
    };
    for (const [i, key] of keys.entries()) {
      if (key === 'd') await declineQuote(portal.d, published.quotes[i]);
      else if (key !== 'e')
        await submitQuote(portal[key], published.quotes[i], ledLines(published, ...prices[key]));
    }
    await openRound(ctx, manager, published, at(start + 6 * HOUR));
    return published;
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
      d: await createSupplier(ctx.prisma, {
        code: 'TS-D',
        nameZh: '供应商丁',
        contactEmail: 'd@s.example.com',
      }),
      e: await createSupplier(ctx.prisma, {
        code: 'TS-E',
        nameZh: '供应商戊',
        contactEmail: 'e@s.example.com',
      }),
    };
    for (const key of KEYS) {
      users[key] = await createUser(ctx.prisma, {
        username: `${key}@supplier.example.com`,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: s[key].id,
      });
    }
    await loginAll();

    p = await publishLedInquiry(
      ctx.prisma,
      buyer,
      manager,
      category['LED-2835'],
      KEYS.map((k) => s[k].id),
      at(6 * HOUR),
      '定标测试询价',
    );
    ctx.clock.set(at(HOUR));
    attachmentId = (
      await portal.a
        .post('/api/files')
        .field('kind', 'ATTACHMENT')
        .attach('file', PDF, '甲的报价单.pdf')
        .expect(201)
    ).body.id;
    const withTerms = (price1: string, price2: string) => ({
      [p.l1]: ledValues({ unit_price_incl_tax: price1, payment_terms: 'NET30' }),
      [p.l2]: ledValues({ unit_price_incl_tax: price2, payment_terms: 'NET30' }),
    });
    await submitQuote(portal.a, quoteOf('a'), withTerms('1.2', '2.4'), {
      remark: '甲的备注',
      attachmentFileIds: [attachmentId],
    });
    await submitQuote(portal.b, quoteOf('b'), ledLines(p, '1.0', '2.7'));
    await submitQuote(portal.c, quoteOf('c'), ledLines(p, '1.5', '3.0'));
    await declineQuote(portal.d, quoteOf('d'));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R12-1 开标前不能定标（ROUND_INVALID_STATUS）；要 inquiry:award，数据权限外 404', async () => {
    expect((await award(manager, quoteOf('a')).expect(409)).body.code).toBe('ROUND_INVALID_STATUS');
    expect((await detailOf(manager)).allowedActions).not.toContain('award');
    expect((await award(buyer, quoteOf('a')).expect(403)).body.code).toBe('FORBIDDEN');

    await openRound(ctx, manager, p, at(6 * HOUR));
    expect((await detailOf(manager)).allowedActions).toContain('award');
    expect((await detailOf(buyer)).allowedActions).not.toContain('award');
    expect((await award(buyer, quoteOf('a')).expect(403)).body.code).toBe('FORBIDDEN');
    expect((await award(admin, quoteOf('a')).expect(403)).body.code).toBe('FORBIDDEN');
    expect((await award(portal.a, quoteOf('a')).expect(403)).body.code).toBe('FORBIDDEN');
    // 采购员 2 没有 inquiry:award；给他临时加上也只能看到自己的单（SELF）
    await ctx.prisma.role.update({
      where: { code: 'BUYER' },
      data: { permissions: { push: 'inquiry:award' } },
    });
    try {
      expect((await award(buyer2, quoteOf('a')).expect(404)).body.code).toBe('NOT_FOUND');
    } finally {
      const role = await ctx.prisma.role.findUniqueOrThrow({ where: { code: 'BUYER' } });
      await ctx.prisma.role.update({
        where: { code: 'BUYER' },
        data: { permissions: role.permissions.filter((x) => x !== 'inquiry:award') },
      });
    }
  });

  it('R12-1 中标对象必须是本轮评标中的报价（AWARD_INVALID_QUOTE）；缺 quoteId 校验失败', async () => {
    expect((await award(manager, quoteOf('d')).expect(400)).body.code).toBe('AWARD_INVALID_QUOTE');
    expect((await award(manager, quoteOf('e')).expect(400)).body.code).toBe('AWARD_INVALID_QUOTE');
    expect((await award(manager, 'no-such-quote').expect(400)).body.code).toBe('AWARD_INVALID_QUOTE');
    expect((await manager.post(`${roundUrl()}/award`).send({ comment: 'x' }).expect(400)).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(await quoteStatuses()).toEqual(['EVALUATING', 'EVALUATING', 'EVALUATING', 'DECLINED', 'INVITED']);
  });

  it('R12-2 ~ R12-5 定标：报价终态、议价自动关闭、轮次评标完成、询盘完成、合同草稿与快照', async () => {
    // 甲、乙入围：甲目标价 → 接受（成交 v2），乙目标价等待回复
    ctx.clock.set(at(7 * HOUR));
    await buyer
      .put(`${roundUrl()}/shortlist`)
      .send({ quoteIds: [quoteOf('a'), quoteOf('b')] })
      .expect(200);
    const offered = (
      await buyer
        .post(`/api/quotes/${quoteOf('a')}/negotiation/offer`)
        .send({ lines: [{ lineId: p.l1, unitPriceInclTax: '1.1' }], content: '第 1 行降到 1.1' })
        .expect(200)
    ).body as NegotiationThreadDto;
    await portal.a
      .post(`/api/portal/quotes/${quoteOf('a')}/negotiation/respond`)
      .send({ type: 'ACCEPT', replyToId: offered.messages.at(-1)!.id })
      .expect(200);
    await buyer
      .post(`/api/quotes/${quoteOf('b')}/negotiation/offer`)
      .send({ lines: [{ lineId: p.l2, unitPriceInclTax: '2.5' }] })
      .expect(200);

    ctx.clock.set(at(8 * HOUR));
    const res = await award(manager, quoteOf('a'), { comment: ' 综合价格与交期最优 ' }).expect(200);
    const detail: InquiryDetailDto = res.body;
    const contract = await ctx.prisma.contract.findUniqueOrThrow({ where: { inquiryId: p.inquiry.id } });
    expect(detail).toMatchObject({
      docStatus: 'APPROVED',
      displayStatus: 'EVALUATED',
      currentRoundStatus: 'EVALUATED',
      completedAt: at(8 * HOUR).toISOString(),
      currentRound: { status: 'EVALUATED', evaluatedAt: at(8 * HOUR).toISOString() },
      award: {
        roundNo: 1,
        quoteId: quoteOf('a'),
        supplier: { id: s.a.id, code: 'TS-A', nameZh: '供应商甲' },
        awardedAt: at(8 * HOUR).toISOString(),
        awardedBy: { id: users.manager.id, name: 'manager' },
        comment: '综合价格与交期最优',
        contract: { id: contract.id, contractNo: 'CT-202612-0001' },
      },
      // R12-8：只剩查看类动作
      allowedActions: ['evaluate', 'exportMatrix', 'viewAccessLog'],
    });

    // R12-2：中标 WON，其余评标中的 LOST，已拒绝、未响应不变（I-8 恰好一条 WON）
    expect(await quoteStatuses()).toEqual(['WON', 'LOST', 'LOST', 'DECLINED', 'INVITED']);
    // R12-4
    const round = await ctx.prisma.inquiryRound.findUniqueOrThrow({ where: { id: p.roundId } });
    expect(round).toMatchObject({
      status: 'EVALUATED',
      evaluatedAt: at(8 * HOUR),
      awardedById: users.manager.id,
      awardComment: '综合价格与交期最优',
    });
    const inquiry = await ctx.prisma.inquiry.findUniqueOrThrow({ where: { id: p.inquiry.id } });
    expect(inquiry).toMatchObject({ completedAt: at(8 * HOUR), currentRoundStatus: 'EVALUATED' });

    // R12-3：进行中（已成交、议价中）的都关闭，追加系统 CLOSE 消息
    for (const key of ['a', 'b'] as const) {
      const th = await thread(key);
      expect(th).toMatchObject({ status: 'CLOSED', awaiting: null, allowedActions: [] });
      expect(th.messages.at(-1)).toMatchObject({
        party: 'BUYER',
        type: 'CLOSE',
        content: 'AUTO_CLOSED_BY_AWARD',
        author: { name: 'manager' },
        createdAt: at(8 * HOUR).toISOString(),
      });
    }

    // R12-5：合同草稿，金额 = 中标版本（议价成交的 v2）合计，付款方式取 payment_terms 的字典名称
    const won = await ctx.prisma.quote.findUniqueOrThrow({
      where: { id: quoteOf('a') },
      include: { currentVersion: true },
    });
    expect(won.currentVersion).toMatchObject({ versionNo: 2, source: 'NEGOTIATION' });
    expect(contract).toMatchObject({
      contractNo: 'CT-202612-0001',
      roundId: p.roundId,
      quoteId: quoteOf('a'),
      quoteVersionId: won.currentVersionId,
      supplierId: s.a.id,
      status: 'DRAFT',
      currency: 'CNY',
      paymentTerms: '货到验收后 30 天付款',
      deliveryDate: null,
      deliveryPlace: null,
      createdById: users.manager.id,
      createdAt: at(8 * HOUR),
    });
    expect(contract.amount.toFixed(2)).toBe('2300.00');
    expect(contract.amount.toFixed(2)).toBe(won.currentVersion!.totalAmount.toFixed(2));

    const snapshot = contract.snapshot as unknown as ContractSnapshot;
    expect(snapshot).toMatchObject({
      capturedAt: at(8 * HOUR).toISOString(),
      inquiry: {
        id: p.inquiry.id,
        formalNo: p.inquiry.formalNo,
        projectNo: 'PJ-TEST-001',
        title: '定标测试询价',
        currency: 'CNY',
        roundNo: 1,
        materialCategory: { code: 'LED-2835' },
        owner: { id: users.buyer.id, name: 'buyer' },
      },
      supplier: { id: s.a.id, code: 'TS-A', nameZh: '供应商甲', contactEmail: 'a@s.example.com' },
      quoteVersion: {
        id: won.currentVersionId,
        versionNo: 2,
        source: 'NEGOTIATION',
        totalAmount: '2300.00',
        currency: 'CNY',
        remark: '甲的备注',
        templateVersion: 1,
        variantCode: 'PPL-LED',
        attachments: [{ fileId: attachmentId, originalName: '甲的报价单.pdf' }],
      },
      files: [],
    });
    expect(snapshot.lines).toEqual([
      expect.objectContaining({
        lineId: p.l1,
        lineNo: 1,
        nameZh: '灯珠 A',
        quantity: '1000',
        unit: { code: 'PCS', nameZh: '个', nameEn: 'pcs' },
        category: expect.objectContaining({ code: 'LED-2835' }),
      }),
      expect.objectContaining({ lineId: p.l2, lineNo: 2, nameZh: '灯珠 B', quantity: '500' }),
    ]);
    expect(snapshot.quoteVersion.values.lines.map((l) => l.values.unit_price_incl_tax)).toEqual([
      '1.1000',
      '2.4000',
    ]);
    expect(snapshot.columns).toEqual(resolveColumns(PPL_V0, 'PPL-LED'));
    // 议价记录取定标前的消息（不含系统关闭）
    expect(snapshot.negotiation?.map((m) => [m.seq, m.party, m.type])).toEqual([
      [1, 'BUYER', 'OFFER'],
      [2, 'SUPPLIER', 'ACCEPT'],
    ]);
    expect(snapshot.negotiation?.[0]).toMatchObject({
      lines: [{ lineId: p.l1, unitPriceInclTax: '1.1' }],
      content: '第 1 行降到 1.1',
    });
  });

  it('R12-6 中标方收 award，未中标的收 result（不透露中标方和价格），已拒绝、未响应的不发', async () => {
    const emails = await ctx.prisma.emailMessage.findMany({
      where: { inquiryId: p.inquiry.id, type: { in: ['AWARD', 'RESULT'] } },
      orderBy: { toAddresses: 'asc' },
    });
    expect(emails.map((e) => [e.type, e.toAddresses, e.ccAddresses, e.language, e.bizKey])).toEqual([
      ['AWARD', ['a@s.example.com'], [], 'zh-CN', `AWARD:${quoteOf('a')}`],
      ['RESULT', ['b@s.example.com'], ['b.cc@s.example.com'], 'en-US', `RESULT:${quoteOf('b')}`],
      ['RESULT', ['c@s.example.com'], [], 'zh-CN', `RESULT:${quoteOf('c')}`],
    ]);
    const [won, lostEn, lostZh] = emails;
    expect(won.subject).toBe(`中标通知：${p.inquiry.formalNo} 定标测试询价`);
    expect(won.text).toContain('供应商甲在询价');
    expect(won.text).toContain(`/portal/quotes/${quoteOf('a')}`);
    expect(lostEn.subject).toBe(`RFQ result: ${p.inquiry.formalNo} 定标测试询价`);
    expect(lostEn.text).toContain('Supplier B was not selected');
    expect(lostZh.subject).toBe(`询价结果通知：${p.inquiry.formalNo} 定标测试询价`);
    for (const e of emails) {
      const text = `${e.subject}${e.text}`.replace(/https?:\/\/\S+/g, '');
      for (const secret of ['2300', '1.1', '2.4', '2.7', '3.0']) expect(text).not.toContain(secret);
    }
    for (const e of [lostEn, lostZh]) {
      expect(`${e.subject}${e.text}${e.html}`).not.toMatch(/TS-A|供应商甲/);
    }
  });

  it('R12-7 中标方积分 +won（bizKey 防重复，重复执行不重复）', async () => {
    const entries = await ctx.prisma.supplierPointsEntry.findMany({
      where: { roundId: p.roundId, ruleCode: 'WON' },
    });
    expect(entries).toEqual([
      expect.objectContaining({
        supplierId: s.a.id,
        delta: 5,
        source: 'AUTO',
        inquiryId: p.inquiry.id,
        bizKey: `WON:${p.roundId}:${s.a.id}`,
        createdAt: at(8 * HOUR),
      }),
    ]);
    const again = await ctx.prisma.$transaction((tx) =>
      ctx.app.get(PointsService).award(tx, [
        {
          supplierId: s.a.id,
          ruleCode: 'WON',
          delta: 5,
          inquiryId: p.inquiry.id,
          roundId: p.roundId,
          bizKey: `WON:${p.roundId}:${s.a.id}`,
        },
      ]),
    );
    expect(again).toBe(0);
    expect(
      await ctx.prisma.supplierPointsEntry.count({ where: { roundId: p.roundId, ruleCode: 'WON' } }),
    ).toBe(1);
  });

  it('R12-8 询盘完成后所有修改类接口 INQUIRY_COMPLETED_READONLY，查询照常', async () => {
    const id = p.inquiry.id;
    const readonly = async (req: Promise<{ status: number; body: { code: string } }>) => {
      const res = await req;
      expect([res.status, res.body.code]).toEqual([409, 'INQUIRY_COMPLETED_READONLY']);
    };
    await readonly(
      manager
        .put(`/api/inquiries/${id}`)
        .send(inquiryBody(category['LED-2835'], { ownerId: users.buyer.id })),
    );
    await readonly(manager.post(`${roundUrl()}/lines`).send(manualLineBody(category['LED-2835'])));
    await readonly(manager.put(`/api/inquiries/${id}/invitees`).send({ supplierIds: [] }));
    await readonly(manager.post(`${roundUrl()}/late-invite`).send({ supplierIds: [s.e.id] }));
    await readonly(manager.post(`${roundUrl()}/remind`).send({ quoteIds: [quoteOf('e')] }));
    await readonly(manager.put(`${roundUrl()}/deadline`).send({ deadline: at(100 * HOUR).toISOString() }));
    await readonly(manager.post(`${roundUrl()}/close-early`));
    await readonly(manager.post(`${roundUrl()}/open`));
    await readonly(manager.put(`${roundUrl()}/shortlist`).send({ quoteIds: [quoteOf('a')] }));
    await readonly(
      buyer
        .post(`/api/quotes/${quoteOf('b')}/negotiation/offer`)
        .send({ lines: [{ lineId: p.l1, specNote: '再议' }] }),
    );
    const b = await thread('b');
    await readonly(
      portal.b
        .post(`/api/portal/quotes/${quoteOf('b')}/negotiation/respond`)
        .send({ type: 'ACCEPT', replyToId: b.messages.at(-1)!.id }),
    );
    await readonly(award(manager, quoteOf('b')));
    await readonly(manager.post(`/api/inquiries/${id}/cancel`).send({ reason: '晚了' }));
    expect(await quoteStatuses()).toEqual(['WON', 'LOST', 'LOST', 'DECLINED', 'INVITED']);
    expect(await ctx.prisma.contract.count({ where: { inquiryId: id } })).toBe(1);

    // 查询类接口照常（#11 历史可查不可改）
    await buyer.get(`/api/inquiries/${id}`).expect(200);
    await buyer.get(roundUrl()).expect(200);
    await buyer.get(`/api/inquiries/${id}/approvals`).expect(200);
    await buyer.get(`/api/inquiries/${id}/invitees`).expect(200);
    const responses = (await buyer.get(`${roundUrl()}/responses`).expect(200)).body;
    expect(responses.items.map((r: { status: string }) => r.status)).toEqual([
      'WON',
      'LOST',
      'LOST',
      'DECLINED',
      'INVITED',
    ]);
    const matrix: RoundMatrixDto = (await buyer.get(`${roundUrl()}/matrix`).expect(200)).body;
    expect(matrix).toMatchObject({ roundStatus: 'EVALUATED', canShortlist: false });
    expect(matrix.suppliers.map((x) => x.status)).toEqual(['WON', 'LOST', 'LOST', 'DECLINED', 'INVITED']);
    await buyer.get(`${roundUrl()}/matrix/export`).expect(200);
    await buyer.get(`${roundUrl()}/quotes/${quoteOf('a')}`).expect(200);
    const logs: AuditLogDto[] = (await buyer.get(`/api/inquiries/${id}/timeline`).expect(200)).body;
    const awarded = logs.find((l) => l.action === 'inquiry.award')!;
    expect(awarded).toMatchObject({
      actor: { name: 'manager' },
      summary: `${p.inquiry.formalNo} · TS-A · CT-202612-0001`,
      detail: {
        roundNo: 1,
        quoteId: quoteOf('a'),
        lostQuoteIds: [quoteOf('b'), quoteOf('c')],
        closedNegotiations: 2,
        contractNo: 'CT-202612-0001',
        comment: '综合价格与交期最优',
      },
    });
    // I-11：审计不记金额
    const logged = JSON.stringify([awarded.summary, awarded.detail]);
    for (const secret of ['2300.00', '1.1000', 'amount']) expect(logged).not.toContain(secret);
  });

  it('R12-8 取消后的询价同样只读', async () => {
    const cancelled = await openedInquiry(['a', 'b'], '取消后只读', 20 * HOUR);
    await manager
      .post(`/api/inquiries/${cancelled.inquiry.id}/cancel`)
      .send({ reason: '项目暂停' })
      .expect(200);
    for (const res of [
      await award(manager, quoteOf('a', cancelled), {}, cancelled),
      await manager.put(`${roundUrl(cancelled)}/shortlist`).send({ quoteIds: [] }),
      await manager.post(`/api/inquiries/${cancelled.inquiry.id}/cancel`).send({ reason: '再取消' }),
    ]) {
      expect([res.status, res.body.code]).toEqual([409, 'INQUIRY_COMPLETED_READONLY']);
    }
  });

  it('门户：中标方看到"已中标"，未中标的看到"未中标"，都不能再操作（R12 §5）', async () => {
    await loginAll();
    const winner: PortalQuoteDetailDto = (
      await portal.a.get(`/api/portal/quotes/${quoteOf('a')}`).expect(200)
    ).body;
    expect(winner).toMatchObject({ status: 'WON', round: { status: 'EVALUATED' }, allowedActions: [] });
    const loser: PortalQuoteDetailDto = (await portal.b.get(`/api/portal/quotes/${quoteOf('b')}`).expect(200))
      .body;
    expect(loser).toMatchObject({ status: 'LOST', allowedActions: [] });
    const closed = (await portal.c.get('/api/portal/quotes?tab=closed').expect(200)).body;
    expect(closed.items.map((q: { id: string; status: string }) => [q.id, q.status])).toContainEqual([
      quoteOf('c'),
      'LOST',
    ]);
  });

  it('R12-6 notify.sendResultToLosers = false 时只发中标通知', async () => {
    await admin.put('/api/system/params/notify.sendResultToLosers').send({ value: false }).expect(200);
    try {
      const q = await openedInquiry(['a', 'b', 'c', 'd'], '不发结果通知', 40 * HOUR);
      await award(manager, quoteOf('b', q), {}, q).expect(200);
      const emails = await ctx.prisma.emailMessage.findMany({
        where: { inquiryId: q.inquiry.id, type: { in: ['AWARD', 'RESULT'] } },
      });
      expect(emails.map((e) => [e.type, e.toAddresses])).toEqual([['AWARD', ['b@s.example.com']]]);
      expect(await quoteStatuses(q)).toEqual(['LOST', 'WON', 'LOST', 'DECLINED']);
    } finally {
      await admin
        .put('/api/system/params/notify.sendResultToLosers')
        .send({ value: SYSTEM_PARAMS['notify.sendResultToLosers'].defaultValue })
        .expect(200);
    }
  });

  it('R12-9 并发两次定标只成功一次；定标记审计', async () => {
    const q = await openedInquiry(['a', 'b'], '并发定标', 60 * HOUR);
    const results = await Promise.all([
      award(manager, quoteOf('a', q), {}, q),
      award(manager, quoteOf('b', q), {}, q),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('INQUIRY_COMPLETED_READONLY');
    const statuses = await quoteStatuses(q);
    expect(statuses.filter((x) => x === 'WON')).toHaveLength(1);
    expect(statuses.filter((x) => x === 'LOST')).toHaveLength(1);
    expect(await ctx.prisma.contract.count({ where: { inquiryId: q.inquiry.id } })).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({ where: { entityId: q.inquiry.id, action: 'inquiry.award' } }),
    ).toBe(1);
    // 合同号每月连续
    const numbers = (await ctx.prisma.contract.findMany({ orderBy: { contractNo: 'asc' } })).map(
      (c) => c.contractNo,
    );
    expect(numbers).toEqual(['CT-202612-0001', 'CT-202612-0002', 'CT-202612-0003']);
  });
});
