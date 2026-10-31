import type {
  AuditLogDto,
  InquiryDetailDto,
  InquiryRoundBriefDto,
  InquiryRoundDto,
  NegotiationThreadDto,
  PortalQuoteDetailDto,
  RoundDiffDto,
  RoundMatrixDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import {
  addManualLine,
  createApprovedInquiry,
  createDraftInquiry,
  manualLineBody,
  publishRound,
} from './helpers/inquiries';
import { ledValues, openRound, publishLedInquiry, submitQuote } from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
const START = new Date('2026-12-10T01:00:00.000Z');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const LINE_REMARK = '内部备注乙';

type Key = 'a' | 'b' | 'c' | 'd';

/**
 * M13 规格变更：第 1 轮邀请甲、乙、丙（甲乙报价、丙未响应），等待报价时发起变更（第 2 轮草稿），改规格、删一行、加一行、
 * 换产品图，名单去掉丙、加上丁；开标并与甲议价后"采购确认"发布第 2 轮：第 1 轮作废、报价作废、议价关闭；
 * 甲乙收变更通知、丁收邀请。之后放弃第 3 轮变更、取消与完成后不能再变更
 */
describe('M13 规格变更', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let buyer: Agent;
  let buyer2: Agent;
  let pd: Agent;
  let manager: Agent;
  let approver: Agent;
  const portal = {} as Record<Key, Agent>;
  let s: Record<Key, Supplier>;
  let category: Record<string, string>;
  let inquiry: InquiryDetailDto;
  /** 第 1 轮的两行、报价单（甲乙丙）、附件文件 */
  let r1: { l1: string; l2: string; quotes: Record<'a' | 'b' | 'c', string> };
  const files = {} as Record<'whole' | 'img1' | 'spec2' | 'img1New', string>;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const base = () => `/api/inquiries/${inquiry.id}`;
  const roundUrl = (no: number) => `${base()}/rounds/${no}`;

  async function upload(agent: Agent, kind: string, file: Buffer, name: string): Promise<string> {
    return (await agent.post('/api/files').field('kind', kind).attach('file', file, name).expect(201)).body
      .id;
  }

  async function detail(agent: Agent = buyer): Promise<InquiryDetailDto> {
    return (await agent.get(base()).expect(200)).body;
  }

  async function round(no: number, agent: Agent = buyer): Promise<InquiryRoundDto> {
    return (await agent.get(roundUrl(no)).expect(200)).body;
  }

  async function quotesOf(roundNo: number) {
    return ctx.prisma.quote.findMany({
      where: { round: { inquiryId: inquiry.id, roundNo } },
      include: { supplier: true },
      orderBy: { supplier: { code: 'asc' } },
    });
  }

  async function loginAll(): Promise<void> {
    buyer = await loginAs(ctx, users.buyer);
    buyer2 = await loginAs(ctx, users.buyer2);
    pd = await loginAs(ctx, users.pd);
    manager = await loginAs(ctx, users.manager);
    approver = await loginAs(ctx, users.approver);
    for (const key of ['a', 'b', 'c', 'd'] as const) portal[key] = await loginAs(ctx, users[key]);
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
      pd: await mk('pd', ['PD']),
      manager: await mk('manager', ['PURCHASE_MANAGER']),
      approver: await mk('approver', ['CONTRACT_APPROVER']),
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
    };
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      users[key] = await createUser(ctx.prisma, {
        username: `${key}@supplier.example.com`,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: s[key].id,
      });
    }
    await loginAll();

    // 第 1 轮：两行（第 2 行有内部备注）、整单规格书、第 1 行产品图、第 2 行规格书
    const led = category['LED-2835'];
    const draft = await createDraftInquiry(buyer, led, { title: '变更测试询价', pdUserId: users.pd.id });
    const l1 = await addManualLine(buyer, draft.id, led, {
      nameZh: '灯珠 A',
      spec: 'COB / 10W / Ra80',
      quantity: '1000',
    });
    const l2 = await addManualLine(buyer, draft.id, led, {
      nameZh: '灯珠 B',
      quantity: '500',
      remark: LINE_REMARK,
    });
    files.whole = await upload(buyer, 'SPEC_DOC', PDF, '整单规格书.pdf');
    files.img1 = await upload(buyer, 'PRODUCT_IMAGE', PNG, '灯珠A.png');
    files.spec2 = await upload(buyer, 'SPEC_DOC', PDF, '灯珠B规格书.pdf');
    const attach = (fileId: string, kind: string, lineId: string | null) =>
      buyer.post(`/api/inquiries/${draft.id}/rounds/1/files`).send({ fileId, kind, lineId }).expect(201);
    await attach(files.whole, 'SPEC_DOC', null);
    await attach(files.img1, 'PRODUCT_IMAGE', l1.id);
    await attach(files.spec2, 'SPEC_DOC', l2.id);
    await buyer.post(`/api/inquiries/${draft.id}/submit`).expect(200);
    await manager.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(200);
    inquiry = await publishRound(buyer, draft.id, [s.a.id, s.b.id, s.c.id], at(6 * HOUR));
    const quotes = await quotesOf(1);
    r1 = {
      l1: l1.id,
      l2: l2.id,
      quotes: { a: quotes[0].id, b: quotes[1].id, c: quotes[2].id },
    };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R13-1 前置条件：草稿、待发布的单据不能发起变更；要 inquiry:changeSpec，数据权限外 404', async () => {
    const led = category['LED-2835'];
    const draft = await createDraftInquiry(buyer, led);
    const res = await buyer.post(`/api/inquiries/${draft.id}/rounds`).send({}).expect(409);
    expect(res.body.code).toBe('INQUIRY_INVALID_STATUS');
    const ready = await createApprovedInquiry(buyer, manager, led);
    expect(ready.allowedActions).not.toContain('createChangeRound');
    expect((await buyer.post(`/api/inquiries/${ready.id}/rounds`).send({}).expect(409)).body.code).toBe(
      'ROUND_INVALID_STATUS',
    );

    expect((await approver.post(`${base()}/rounds`).send({}).expect(403)).body.code).toBe('FORBIDDEN');
    expect((await buyer2.post(`${base()}/rounds`).send({}).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await detail()).allowedActions).toContain('createChangeRound');
    expect((await detail(pd)).allowedActions).toContain('createChangeRound');
  });

  it('R13-1 复制：新轮次的行、字段、sourceLineId、附件挂载与上一轮一致；已有变更草稿时不能再建；当前轮照常进行', async () => {
    ctx.clock.set(at(HOUR));
    await submitQuote(portal.a, r1.quotes.a, {
      [r1.l1]: ledValues({ unit_price_incl_tax: '1.2' }),
      [r1.l2]: ledValues({ unit_price_incl_tax: '2.4' }),
    });
    await submitQuote(portal.b, r1.quotes.b, {
      [r1.l1]: ledValues({ unit_price_incl_tax: '1.0' }),
      [r1.l2]: ledValues({ unit_price_incl_tax: '2.7' }),
    });

    const created: InquiryRoundDto = (
      await buyer.post(`${base()}/rounds`).send({ changeReason: ' 显色指数 Ra80 → Ra90 ' }).expect(201)
    ).body;
    const first = await round(1);
    expect(created).toMatchObject({
      roundNo: 2,
      status: 'DRAFT',
      deadline: null,
      publishedAt: null,
      changeReason: '显色指数 Ra80 → Ra90',
      changeSummary: null,
      pplTemplateVersion: null,
      allowedActions: ['edit', 'editInvitees', 'publish', 'editChangeRound', 'discardChangeRound'],
    });
    const fields = (l: InquiryRoundDto['lines'][number]) => ({
      lineNo: l.lineNo,
      nameZh: l.nameZh,
      spec: l.spec,
      unitCode: l.unitCode,
      quantity: l.quantity,
      remark: l.remark,
      category: l.category.code,
      files: l.files.map((f) => [f.kind, f.file.id]),
    });
    expect(created.lines.map(fields)).toEqual(first.lines.map(fields));
    expect(created.files.map((f) => [f.kind, f.file.id])).toEqual([['SPEC_DOC', files.whole]]);
    const copies = await ctx.prisma.inquiryLine.findMany({
      where: { round: { inquiryId: inquiry.id, roundNo: 2 } },
      orderBy: { lineNo: 'asc' },
    });
    expect(copies.map((l) => l.sourceLineId)).toEqual([r1.l1, r1.l2]);
    // 新的挂载指向同一个文件，上传人不变
    const mounts = await ctx.prisma.inquiryFile.findMany({
      where: { round: { inquiryId: inquiry.id, roundNo: 2 } },
    });
    expect(mounts).toHaveLength(3);
    expect(new Set(mounts.map((m) => m.uploadedById))).toEqual(new Set([users.buyer.id]));

    const d = await detail();
    expect(d).toMatchObject({ currentRoundNo: 1, currentRoundStatus: 'WAITING_QUOTES', draftRoundNo: 2 });
    expect(d.allowedActions).toEqual(expect.arrayContaining(['editInvitees', 'lateInvite', 'remind']));
    expect(d.allowedActions).not.toContain('createChangeRound');
    expect((await buyer.post(`${base()}/rounds`).send({}).expect(409)).body).toMatchObject({
      code: 'ROUND_DRAFT_EXISTS',
      params: { roundNo: 2 },
    });
    const list: InquiryRoundBriefDto[] = (await buyer.get(`${base()}/rounds`).expect(200)).body;
    expect(list.map((r) => [r.roundNo, r.status, r.lineCount, r.quoteCount, r.changeReason])).toEqual([
      [1, 'WAITING_QUOTES', 2, 3, null],
      [2, 'DRAFT', 2, 0, '显色指数 Ra80 → Ra90'],
    ]);
    // PD 能改行、附件和变更说明，不能发布、改名单
    expect((await round(2, pd)).allowedActions).toEqual(['edit', 'editChangeRound', 'discardChangeRound']);
    // 当前轮照常进行：乙还能改报价；供应商看不到变更草稿
    await submitQuote(portal.b, r1.quotes.b, {
      [r1.l1]: ledValues({ unit_price_incl_tax: '0.98' }),
      [r1.l2]: ledValues({ unit_price_incl_tax: '2.7' }),
    });
    const mine = (await portal.a.get('/api/portal/quotes').expect(200)).body;
    expect(mine.items.map((q: { roundNo: number }) => q.roundNo)).toEqual([1]);
  });

  it('R13-2 变更草稿按 M06 的规则编辑行和附件、保存变更说明；第 1 轮已冻结', async () => {
    const draftLines = (await round(2)).lines;
    const [c1, c2] = draftLines;
    await buyer
      .put(`${roundUrl(2)}/lines/${c1.id}`)
      .send(
        manualLineBody(category['LED-2835'], {
          nameZh: '灯珠 A',
          spec: 'COB / 10W / Ra90',
          quantity: '1000',
        }),
      )
      .expect(200);
    await pd.delete(`${roundUrl(2)}/lines/${c2.id}`).expect(200);
    await buyer
      .post(`${roundUrl(2)}/lines`)
      .send(manualLineBody(category['LED-2835'], { nameZh: '灯珠 C', spec: 'COB / 5W', quantity: '300' }))
      .expect(201);
    // 换第 1 行的产品图
    await buyer.delete(`${roundUrl(2)}/files/${c1.files[0].id}`).expect(200);
    files.img1New = await upload(buyer, 'PRODUCT_IMAGE', PNG, '灯珠A-Ra90.png');
    await buyer
      .post(`${roundUrl(2)}/files`)
      .send({ fileId: files.img1New, kind: 'PRODUCT_IMAGE', lineId: c1.id })
      .expect(201);
    const saved: InquiryRoundDto = (
      await pd
        .put(roundUrl(2))
        .send({
          changeReason: '显色指数 Ra80 → Ra90',
          changeSummary: '第 1 行改为 Ra90；取消灯珠 B；新增灯珠 C',
        })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ changeSummary: '第 1 行改为 Ra90；取消灯珠 B；新增灯珠 C' });

    // 第 1 轮已发布，行和附件冻结
    const res = await buyer
      .put(`${roundUrl(1)}/lines/${r1.l1}`)
      .send(manualLineBody(category['LED-2835'], { nameZh: '灯珠 A', spec: 'x', quantity: '1' }))
      .expect(409);
    expect(res.body.code).toBe('INQUIRY_NOT_EDITABLE');
    expect((await round(1)).allowedActions).not.toContain('edit');
    // 只有变更草稿能改变更说明
    expect((await buyer.put(roundUrl(1)).send({ changeReason: 'x' }).expect(409)).body.code).toBe(
      'ROUND_INVALID_STATUS',
    );
  });

  it('R13-6 规格对比：修改的字段与附件、新增行、删除行；第 1 轮没有对比', async () => {
    const diff: RoundDiffDto = (await buyer.get(`${roundUrl(2)}/diff`).expect(200)).body;
    expect(diff).toMatchObject({
      roundNo: 2,
      previousRoundNo: 1,
      changeReason: '显色指数 Ra80 → Ra90',
      summary: { ADDED: 1, REMOVED: 1, MODIFIED: 1, UNCHANGED: 0 },
      files: { added: [], removed: [] },
    });
    expect(
      diff.lines.map((l) => [l.change, l.after?.lineNo ?? null, l.before?.lineNo ?? null, l.changedFields]),
    ).toEqual([
      ['MODIFIED', 1, 1, ['spec']],
      ['ADDED', 2, null, []],
      ['REMOVED', null, 2, []],
    ]);
    expect(diff.lines[0].before).toMatchObject({ spec: 'COB / 10W / Ra80' });
    expect(diff.lines[0].after).toMatchObject({ spec: 'COB / 10W / Ra90' });
    expect(diff.lines[0].files).toEqual({
      added: [{ fileId: files.img1New, originalName: '灯珠A-Ra90.png', kind: 'PRODUCT_IMAGE' }],
      removed: [{ fileId: files.img1, originalName: '灯珠A.png', kind: 'PRODUCT_IMAGE' }],
    });
    expect(diff.lines[1].after).toMatchObject({ nameZh: '灯珠 C', quantity: '300' });
    expect(diff.lines[2].before).toMatchObject({ nameZh: '灯珠 B', remark: LINE_REMARK });
    expect(diff.lines[2].files.removed.map((f) => f.fileId)).toEqual([files.spec2]);
    expect((await buyer.get(`${roundUrl(1)}/diff`).expect(404)).body.code).toBe('NOT_FOUND');
  });

  it('R13-3 发布前置：变更原因和内容必填、截止有效、要 inquiry:publish；05 §3 变更草稿期间可以改受邀名单', async () => {
    await buyer.put(roundUrl(2)).send({ changeReason: '显色指数 Ra80 → Ra90' }).expect(200);
    const missing = await buyer
      .post(`${roundUrl(2)}/publish`)
      .send({ deadline: at(30 * HOUR).toISOString() })
      .expect(400);
    expect(missing.body.code).toBe('ROUND_CHANGE_REASON_REQUIRED');
    await buyer
      .put(roundUrl(2))
      .send({
        changeReason: '显色指数 Ra80 → Ra90',
        changeSummary: '第 1 行改为 Ra90；取消灯珠 B；新增灯珠 C',
      })
      .expect(200);
    const early = await buyer
      .post(`${roundUrl(2)}/publish`)
      .send({ deadline: at(HOUR + 30 * 60_000).toISOString() })
      .expect(400);
    expect(early.body.code).toBe('INQUIRY_DEADLINE_INVALID');
    expect(
      (
        await pd
          .post(`${roundUrl(2)}/publish`)
          .send({ deadline: at(30 * HOUR).toISOString() })
          .expect(403)
      ).body.code,
    ).toBe('FORBIDDEN');
    // 名单去掉丙、加上丁（只影响第 2 轮）
    await buyer
      .put(`${base()}/invitees`)
      .send({ supplierIds: [s.a.id, s.b.id, s.d.id] })
      .expect(200);
    expect((await quotesOf(1)).map((q) => q.supplier.code)).toEqual(['TS-A', 'TS-B', 'TS-C']);
  });

  it('B-52 第 1 轮开标、入围、议价进行中；有变更草稿时不能定标（ROUND_DRAFT_EXISTS）', async () => {
    await openRound(ctx, manager, { inquiry }, at(6 * HOUR));
    await buyer
      .put(`${roundUrl(1)}/shortlist`)
      .send({ quoteIds: [r1.quotes.a] })
      .expect(200);
    await buyer
      .post(`/api/quotes/${r1.quotes.a}/negotiation/offer`)
      .send({ lines: [{ lineId: r1.l1, unitPriceInclTax: '1.1' }] })
      .expect(200);
    const d = await detail(manager);
    expect(d).toMatchObject({ currentRoundStatus: 'OPENED', draftRoundNo: 2 });
    expect(d.allowedActions).not.toContain('award');
    const res = await manager
      .post(`${roundUrl(1)}/award`)
      .send({ quoteId: r1.quotes.a })
      .expect(409);
    expect(res.body).toMatchObject({ code: 'ROUND_DRAFT_EXISTS', params: { roundNo: 2 } });
  });

  it('R13-4 发布：上一轮作废、报价作废、议价关闭、切换当前轮次、按名单建报价单；老供应商收 change.spec，新增的收邀请', async () => {
    ctx.clock.set(at(7 * HOUR));
    const res = await buyer
      .post(`${roundUrl(2)}/publish`)
      .send({ deadline: at(15 * HOUR).toISOString() })
      .expect(200);
    const published: InquiryDetailDto = res.body;
    expect(published).toMatchObject({
      currentRoundNo: 2,
      currentRoundStatus: 'WAITING_QUOTES',
      displayStatus: 'WAITING_QUOTES',
      currentDeadline: at(15 * HOUR).toISOString(),
      draftRoundNo: null,
      currentRound: { roundNo: 2, status: 'WAITING_QUOTES', publishedAt: at(7 * HOUR).toISOString() },
    });
    expect(published.allowedActions).toEqual(
      expect.arrayContaining(['lateInvite', 'remind', 'createChangeRound']),
    );
    expect(published.allowedActions).not.toContain('editInvitees');

    const rounds = await ctx.prisma.inquiryRound.findMany({
      where: { inquiryId: inquiry.id },
      orderBy: { roundNo: 'asc' },
    });
    expect(rounds.map((r) => [r.roundNo, r.status])).toEqual([
      [1, 'SUPERSEDED'],
      [2, 'WAITING_QUOTES'],
    ]);
    expect(rounds[1]).toMatchObject({
      pplTemplateVersion: 1,
      pplVariantCode: 'PPL-LED',
      publishedById: users.buyer.id,
    });
    expect((await quotesOf(1)).map((q) => q.status)).toEqual(['VOID', 'VOID', 'VOID']);
    const fresh = await quotesOf(2);
    expect(fresh.map((q) => [q.supplier.code, q.status, q.invitedAt])).toEqual([
      ['TS-A', 'INVITED', at(7 * HOUR)],
      ['TS-B', 'INVITED', at(7 * HOUR)],
      ['TS-D', 'INVITED', at(7 * HOUR)],
    ]);
    const thread: NegotiationThreadDto = (
      await buyer.get(`/api/quotes/${r1.quotes.a}/negotiation`).expect(200)
    ).body;
    expect(thread).toMatchObject({ status: 'CLOSED', allowedActions: [] });
    expect(thread.messages.at(-1)).toMatchObject({ type: 'CLOSE', content: 'AUTO_CLOSED_BY_CHANGE' });

    // 邮件的 createdAt 是数据库时间，按类型取：变更通知，和发给丁的邀请
    const emails = await ctx.prisma.emailMessage.findMany({
      where: { inquiryId: inquiry.id, OR: [{ type: 'CHANGE' }, { type: 'INVITATION', supplierId: s.d.id }] },
      orderBy: { toAddresses: 'asc' },
    });
    expect(emails.map((e) => [e.type, e.toAddresses, e.ccAddresses, e.language, e.bizKey])).toEqual([
      ['CHANGE', ['a@s.example.com'], [], 'zh-CN', `CHANGE:SPEC:${fresh[0].id}`],
      ['CHANGE', ['b@s.example.com'], ['b.cc@s.example.com'], 'en-US', `CHANGE:SPEC:${fresh[1].id}`],
      ['INVITATION', ['d@s.example.com'], [], 'zh-CN', `INVITATION:${fresh[2].id}`],
    ]);
    const [zh, en] = emails;
    expect(zh.subject).toBe(`规格变更：${inquiry.formalNo} 变更测试询价（第 2 轮）`);
    expect(zh.text).toContain('变更原因：显色指数 Ra80 → Ra90');
    expect(zh.text).toContain('主要变更内容：第 1 行改为 Ra90；取消灯珠 B；新增灯珠 C');
    expect(zh.text).toContain('询价明细：2 行');
    expect(zh.text).toContain(`/portal/quotes/${fresh[0].id}`);
    expect(en.subject).toBe(`Specification change: ${inquiry.formalNo} 变更测试询价 (round 2)`);
    expect(en.text).toContain('Reason for change: 显色指数 Ra80 → Ra90');
    // 丙不在新名单里，不发通知
    expect(emails.some((e) => e.toAddresses.includes('c@s.example.com'))).toBe(false);
    for (const e of emails) expect(`${e.subject}${e.text}`).not.toContain(LINE_REMARK);
  });

  it('R13-5 R13-8 开过标的旧轮次仍可查看报价和比价，但只读', async () => {
    const quote = (await buyer.get(`${roundUrl(1)}/quotes/${r1.quotes.a}`).expect(200)).body;
    expect(quote).toMatchObject({ status: 'VOID', currentVersion: { versionNo: 1 } });
    const matrix: RoundMatrixDto = (await buyer.get(`${roundUrl(1)}/matrix`).expect(200)).body;
    expect(matrix).toMatchObject({ roundNo: 1, roundStatus: 'SUPERSEDED', canShortlist: false });
    expect(matrix.suppliers.map((x) => [x.supplier.code, x.status, x.quoted])).toEqual([
      ['TS-A', 'VOID', true],
      ['TS-B', 'VOID', true],
      ['TS-C', 'VOID', false],
    ]);
    const responses = (await buyer.get(`${roundUrl(1)}/responses`).expect(200)).body;
    expect(responses.sealed).toBe(false);
    expect((await round(1)).allowedActions).toEqual([]);
    for (const res of [
      await buyer.put(`${roundUrl(1)}/shortlist`).send({ quoteIds: [] }),
      await buyer.post(`${roundUrl(1)}/remind`).send({ quoteIds: [r1.quotes.c] }),
      await buyer.post(`${roundUrl(1)}/publish`).send({ deadline: at(20 * HOUR).toISOString() }),
      await buyer.delete(roundUrl(1)),
    ]) {
      expect([res.status, res.body.code]).toEqual([409, 'ROUND_INVALID_STATUS']);
    }
  });

  it('R13-8 P-4 门户：旧轮次只读可查；新一轮有变更说明和规格对比（不含内部备注）；新增的供应商看不到上一轮', async () => {
    const fresh = await quotesOf(2);
    const [a2, , d2] = fresh;
    const old: PortalQuoteDetailDto = (await portal.a.get(`/api/portal/quotes/${r1.quotes.a}`).expect(200))
      .body;
    expect(old).toMatchObject({
      status: 'VOID',
      round: { roundNo: 1, status: 'SUPERSEDED' },
      allowedActions: [],
      diff: null,
      rounds: [
        { quoteId: r1.quotes.a, roundNo: 1, roundStatus: 'SUPERSEDED', status: 'VOID' },
        { quoteId: a2.id, roundNo: 2, roundStatus: 'WAITING_QUOTES', status: 'INVITED' },
      ],
    });
    expect(old.lines.map((l) => l.spec)).toEqual(['COB / 10W / Ra80', 'SPEC-1']);
    const now: PortalQuoteDetailDto = (await portal.a.get(`/api/portal/quotes/${a2.id}`).expect(200)).body;
    expect(now).toMatchObject({
      status: 'INVITED',
      round: {
        roundNo: 2,
        changeReason: '显色指数 Ra80 → Ra90',
        changeSummary: '第 1 行改为 Ra90；取消灯珠 B；新增灯珠 C',
      },
      diff: { roundNo: 2, summary: { ADDED: 1, REMOVED: 1, MODIFIED: 1, UNCHANGED: 0 } },
    });
    expect(now.allowedActions).toContain('submit');
    expect(JSON.stringify(now)).not.toContain(LINE_REMARK);
    expect(
      now.diff!.lines.every((l) => !('remark' in (l.before ?? {})) && !('remark' in (l.after ?? {}))),
    ).toBe(true);

    // 旧轮次不能再报，新一轮照常报价
    const [n1, n2] = now.lines;
    const values = { [n1.id]: ledValues({ unit_price_incl_tax: '1.25' }), [n2.id]: ledValues() };
    expect(
      (await portal.a.post(`/api/portal/quotes/${r1.quotes.a}/submit`).send({ lines: values }).expect(409))
        .body.code,
    ).toBe('QUOTE_INVALID_STATUS');
    await submitQuote(portal.a, a2.id, values);

    // 丁是新增的：只看到第 2 轮，没有对比，打不开只挂在第 1 轮的附件；甲可以
    const newcomer: PortalQuoteDetailDto = (await portal.d.get(`/api/portal/quotes/${d2.id}`).expect(200))
      .body;
    expect(newcomer).toMatchObject({ diff: null, rounds: [{ roundNo: 2 }] });
    await portal.d.get(`/api/portal/quotes/${r1.quotes.a}`).expect(404);
    expect((await portal.d.get(`/api/files/${files.img1}/content`).expect(403)).body.code).toBe(
      'FILE_ACCESS_DENIED',
    );
    await portal.d.get(`/api/files/${files.img1New}/content`).expect(200);
    await portal.a.get(`/api/files/${files.img1}/content`).expect(200);
    // 丙被移出名单：旧报价照样能看
    const removed: PortalQuoteDetailDto = (
      await portal.c.get(`/api/portal/quotes/${r1.quotes.c}`).expect(200)
    ).body;
    expect(removed).toMatchObject({ status: 'VOID', rounds: [{ roundNo: 1 }] });
    const list = (await portal.a.get('/api/portal/quotes').expect(200)).body;
    expect(list.items.map((q: { roundNo: number; status: string }) => [q.roundNo, q.status])).toEqual([
      [2, 'SUBMITTED'],
      [1, 'VOID'],
    ]);
  });

  it('R13-7 放弃变更：删除草稿轮次（连同行和附件挂载），当前轮不受影响', async () => {
    const created: InquiryRoundDto = (await pd.post(`${base()}/rounds`).send({}).expect(201)).body;
    expect(created).toMatchObject({ roundNo: 3, status: 'DRAFT' });
    expect(created.lines.map((l) => l.nameZh)).toEqual(['灯珠 A', '灯珠 C']);
    await pd
      .post(`${roundUrl(3)}/lines`)
      .send(manualLineBody(category['LED-2835'], { nameZh: '灯珠 D' }))
      .expect(201);
    const after: InquiryDetailDto = (await pd.delete(roundUrl(3)).expect(200)).body;
    expect(after).toMatchObject({
      currentRoundNo: 2,
      currentRoundStatus: 'WAITING_QUOTES',
      draftRoundNo: null,
    });
    expect(await ctx.prisma.inquiryRound.count({ where: { inquiryId: inquiry.id, roundNo: 3 } })).toBe(0);
    expect(await ctx.prisma.inquiryLine.count({ where: { round: { inquiryId: inquiry.id } } })).toBe(4);
    expect((await round(2)).lines.map((l) => l.nameZh)).toEqual(['灯珠 A', '灯珠 C']);
    expect((await buyer.delete(roundUrl(2)).expect(409)).body.code).toBe('ROUND_INVALID_STATUS');
    expect((await buyer.delete(roundUrl(9)).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await approver.delete(roundUrl(2)).expect(403)).body.code).toBe('FORBIDDEN');
  });

  it('R13-9 新建、编辑、放弃、发布都记审计', async () => {
    const logs: AuditLogDto[] = (await buyer.get(`${base()}/timeline`).expect(200)).body;
    const count = (action: string) => logs.filter((l) => l.action === action).length;
    expect([
      count('inquiry.createChangeRound'),
      count('inquiry.updateChangeRound'),
      count('inquiry.discardChangeRound'),
      count('inquiry.publishChange'),
    ]).toEqual([2, 3, 1, 1]);
    expect(logs.find((l) => l.action === 'inquiry.publishChange')).toMatchObject({
      actor: { name: 'buyer' },
      summary: `${inquiry.formalNo} · R2 · 2026-12-11 00:00 UTC+8 · TS-A, TS-B, TS-D`,
      detail: { roundNo: 2, supersededRoundNo: 1, voidedQuotes: 3, closedNegotiations: 1 },
    });
    expect(logs.find((l) => l.action === 'inquiry.discardChangeRound')).toMatchObject({
      actor: { name: 'pd' },
      summary: `${inquiry.formalNo} · R3`,
    });
  });

  it('R13-1 取消、完成后不能发起变更；取消时变更草稿一起取消', async () => {
    await buyer.post(`${base()}/rounds`).send({ changeReason: '再改一次' }).expect(201);
    await manager.post(`${base()}/cancel`).send({ reason: '项目暂停' }).expect(200);
    const rounds = await ctx.prisma.inquiryRound.findMany({
      where: { inquiryId: inquiry.id },
      orderBy: { roundNo: 'asc' },
    });
    expect(rounds.map((r) => [r.roundNo, r.status])).toEqual([
      [1, 'SUPERSEDED'],
      [2, 'CANCELLED'],
      [3, 'CANCELLED'],
    ]);
    for (const res of [
      await buyer.post(`${base()}/rounds`).send({}),
      await buyer.put(roundUrl(3)).send({ changeReason: 'x' }),
      await buyer.delete(roundUrl(3)),
    ]) {
      expect([res.status, res.body.code]).toEqual([409, 'INQUIRY_COMPLETED_READONLY']);
    }

    // 评标完成的询价同样只读
    ctx.clock.set(at(9 * HOUR));
    await loginAll();
    const done = await publishLedInquiry(
      ctx.prisma,
      buyer,
      manager,
      category['LED-2835'],
      [s.a.id],
      at(10 * HOUR),
    );
    await submitQuote(portal.a, done.quotes[0], {
      [done.l1]: ledValues(),
      [done.l2]: ledValues(),
    });
    await openRound(ctx, manager, done, at(10 * HOUR));
    await manager
      .post(`/api/inquiries/${done.inquiry.id}/rounds/1/award`)
      .send({ quoteId: done.quotes[0] })
      .expect(200);
    const res = await buyer.post(`/api/inquiries/${done.inquiry.id}/rounds`).send({}).expect(409);
    expect(res.body.code).toBe('INQUIRY_COMPLETED_READONLY');
  });
});
