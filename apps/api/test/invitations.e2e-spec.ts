import type {
  InquiryDetailDto,
  InquiryInviteeDto,
  InquiryRoundDto,
  InviteeCandidateDto,
  QuoteStatus,
  RoundEvent,
  RoundResponsesDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { EmailType, Supplier, User } from '../src/generated/prisma/client';
import { AutoReminderJob } from '../src/modules/inquiries/auto-reminder.job';
import { RoundStateService, type RoundTransitionOptions } from '../src/modules/inquiries/round-state.service';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createCategory, createSupplier, createUser, seedBase } from './helpers/fixtures';
import {
  createApprovedInquiry,
  createDraftInquiry,
  addManualLine,
  publishRound,
  setInvitees,
} from './helpers/inquiries';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
/** 每个用例开始时把测试时钟拨回这里（会话 12 小时过期，前进超过 12 小时后要重新登录） */
const START = new Date('2026-11-02T01:00:00.000Z');
const PROJECT_NO = 'PJ-M07-SECRET';

describe('M07 邀请发布与邮件通知', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let buyer: Agent;
  /** 另一个采购员（SELF），看不到 buyer 的单 */
  let buyer2: Agent;
  let manager: Agent;
  let pd: Agent;
  let admin: Agent;
  /** TS-ZH 的门户账号 */
  let portal: Agent;
  let category: Record<string, string>;
  /** zh / en / bi：三种首选语言；nm：普通供应商；off：停用 */
  let s: Record<'zh' | 'en' | 'bi' | 'nm' | 'off', Supplier>;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const base = (id: string) => `/api/inquiries/${id}`;

  async function approved(extra: Record<string, unknown> = {}): Promise<InquiryDetailDto> {
    return createApprovedInquiry(buyer, manager, category['LED-2835'], { projectNo: PROJECT_NO, ...extra });
  }

  /** 审批通过 → 设名单 → 发布；默认三种语言各一家、截止 3 天后 */
  async function published(
    suppliers: Supplier[] = [s.zh, s.en, s.bi],
    deadline = at(72 * HOUR),
  ): Promise<InquiryDetailDto> {
    const inquiry = await approved();
    return publishRound(
      buyer,
      inquiry.id,
      suppliers.map((x) => x.id),
      deadline,
    );
  }

  async function quoteOf(inquiryId: string, supplier: Supplier) {
    return ctx.prisma.quote.findFirstOrThrow({ where: { round: { inquiryId }, supplierId: supplier.id } });
  }

  /** M09 之前没有报价接口，直接改库模拟供应商已提交 / 已拒绝 */
  async function setQuoteStatus(inquiryId: string, supplier: Supplier, status: QuoteStatus) {
    const quote = await quoteOf(inquiryId, supplier);
    const now = ctx.clock.now();
    return ctx.prisma.quote.update({
      where: { id: quote.id },
      data: {
        status,
        respondedAt: now,
        ...(status === 'SUBMITTED' ? { lastSubmittedAt: now } : {}),
        ...(status === 'DECLINED'
          ? { declinedAt: now, declineReasonCode: 'LEAD_TIME', declineReason: '交期无法满足' }
          : {}),
      },
    });
  }

  async function mails(inquiryId: string, type?: EmailType) {
    return ctx.prisma.emailMessage.findMany({
      where: { inquiryId, ...(type ? { type } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async function mailCount(inquiryId: string, type: EmailType, supplier: Supplier): Promise<number> {
    return ctx.prisma.emailMessage.count({ where: { inquiryId, type, supplierId: supplier.id } });
  }

  async function roundOf(agent: Agent, id: string): Promise<InquiryRoundDto> {
    return (await agent.get(`${base(id)}/rounds/1`).expect(200)).body;
  }

  async function detailOf(agent: Agent, id: string): Promise<InquiryDetailDto> {
    return (await agent.get(base(id)).expect(200)).body;
  }

  async function timeline(id: string): Promise<{ action: string; summary: string | null; actor: unknown }[]> {
    return (await buyer.get(`${base(id)}/timeline`).expect(200)).body;
  }

  async function candidates(agent: Agent, id: string, query: Record<string, string> = {}) {
    const res = await agent
      .get(`${base(id)}/invitee-candidates`)
      .query(query)
      .expect(200);
    return res.body.items as InviteeCandidateDto[];
  }

  async function applyRound(roundId: string, event: RoundEvent, options?: RoundTransitionOptions) {
    const state = ctx.app.get(RoundStateService);
    return ctx.prisma.$transaction((tx) => state.apply(tx, roundId, event, options));
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(START);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    const mk = (key: string, options: Parameters<typeof createUser>[1]) =>
      createUser(ctx.prisma, { username: key, name: key, ...options });
    users = {
      buyer: await mk('buyer', { roles: ['BUYER'], name: '采购张三', email: 'buyer.zhang@example.com' }),
      buyer2: await mk('buyer2', { roles: ['BUYER'], email: 'buyer2@example.com' }),
      manager: await mk('manager', { roles: ['PURCHASE_MANAGER'], email: 'manager@example.com' }),
      pd: await mk('pd', { roles: ['PD'], departmentCode: 'PRODUCT' }),
      admin: await mk('admin', { roles: ['ADMIN'] }),
    };
    s = {
      zh: await createSupplier(ctx.prisma, {
        code: 'TS-ZH',
        nameZh: '深圳星光电子',
        categoryCode: 'STRATEGIC',
        contactName: '王经理',
        contactEmail: 'wang@xingguang.example.com',
        ccEmails: ['sales@xingguang.example.com'],
        preferredLanguage: 'zh-CN',
        materialCategoryIds: [category['LED-2835']],
      }),
      en: await createSupplier(ctx.prisma, {
        code: 'TS-EN',
        nameZh: '欧洲光学',
        nameEn: 'Euro Optics GmbH',
        categoryCode: 'EXCELLENT',
        contactName: 'Anna Schmidt',
        contactEmail: 'anna@euro-optics.example.com',
        preferredLanguage: 'en-US',
        materialCategoryIds: [category.LED],
      }),
      bi: await createSupplier(ctx.prisma, {
        code: 'TS-BI',
        nameZh: '香港驱动',
        nameEn: 'HK Drivers Ltd.',
        categoryCode: 'STRATEGIC',
        contactName: 'Peter Chan',
        contactEmail: 'peter@hkdrivers.example.com',
        preferredLanguage: 'bilingual',
        materialCategoryIds: [category['LED-COB']],
      }),
      nm: await createSupplier(ctx.prisma, {
        code: 'TS-NM',
        categoryCode: 'NORMAL',
        materialCategoryIds: [category['PER-LENS']],
      }),
      off: await createSupplier(ctx.prisma, {
        code: 'TS-OFF',
        categoryCode: 'STRATEGIC',
        status: 'DISABLED',
        materialCategoryIds: [category['LED-2835']],
      }),
    };
    // 门户账号：TS-ZH 已激活、TS-EN 待激活、TS-NM 已停用、TS-BI 没开通（R07-6）
    const account = (supplier: Supplier, username: string, status: User['status']) =>
      createUser(ctx.prisma, {
        username,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: supplier.id,
        status,
      });
    users.portal = await account(s.zh, 'wang@xingguang.example.com', 'ACTIVE');
    await account(s.en, 'anna@euro-optics.example.com', 'PENDING_ACTIVATION');
    await account(s.nm, 'nm@supplier.example.com', 'DISABLED');

    buyer = await loginAs(ctx, users.buyer);
    buyer2 = await loginAs(ctx, users.buyer2);
    manager = await loginAs(ctx, users.manager);
    pd = await loginAs(ctx, users.pd);
    admin = await loginAs(ctx, users.admin);
    portal = await loginAs(ctx, users.portal);
  });

  beforeEach(() => ctx.clock.set(START));

  afterAll(async () => {
    await ctx.close();
  });

  describe('R07-1 候选供应商', () => {
    it('R07-1 只含启用的；按供应商分类多选筛选；已受邀的标记出来，带门户账号状态', async () => {
      const draft = await createDraftInquiry(buyer, category['LED-2835']);
      let items = await candidates(buyer, draft.id, { categoryCodes: 'STRATEGIC,EXCELLENT' });
      expect(items.map((c) => c.code)).toEqual(['TS-BI', 'TS-EN', 'TS-ZH']);
      expect(items.map((c) => [c.code, c.portalAccount, c.invited])).toEqual([
        ['TS-BI', 'NONE', false],
        ['TS-EN', 'PENDING', false],
        ['TS-ZH', 'ACTIVE', false],
      ]);
      expect(items[0]).not.toHaveProperty('contactEmail');

      await setInvitees(buyer, draft.id, [s.zh.id]);
      items = await candidates(buyer, draft.id, { categoryCodes: 'STRATEGIC,EXCELLENT' });
      expect(items.filter((c) => c.invited).map((c) => c.code)).toEqual(['TS-ZH']);
    });

    it('R07-1 主营材料分类包含下级、可以不筛；关键字匹配编码和中英文名称', async () => {
      const draft = await createDraftInquiry(buyer, category['LED-2835']);
      const codes = async (query: Record<string, string>) =>
        (await candidates(buyer, draft.id, query)).map((c) => c.code);
      expect(await codes({ materialCategoryId: category.LED })).toEqual(['TS-BI', 'TS-EN', 'TS-ZH']);
      expect(await codes({ materialCategoryId: category['LED-2835'] })).toEqual(['TS-ZH']);
      const all = await codes({});
      expect(all).toEqual(expect.arrayContaining(['TS-BI', 'TS-EN', 'TS-NM', 'TS-ZH']));
      expect(all).not.toContain('TS-OFF');
      expect(await codes({ keyword: 'euro' })).toEqual(['TS-EN']);
      expect(await codes({ keyword: '香港' })).toEqual(['TS-BI']);
    });

    it('R07-1 需要 inquiry:invite；数据权限外的单 404；供应商 403', async () => {
      const draft = await createDraftInquiry(buyer, category['LED-2835']);
      await pd.get(`${base(draft.id)}/invitee-candidates`).expect(403);
      await buyer2.get(`${base(draft.id)}/invitee-candidates`).expect(404);
      await portal.get(`${base(draft.id)}/invitee-candidates`).expect(403);
      await portal.get(`${base(draft.id)}/invitees`).expect(403);
    });
  });

  describe('R07-2 受邀名单', () => {
    it('R07-2 草稿时整体替换并记操作日志；新加入停用或不存在的供应商被拒', async () => {
      const draft = await createDraftInquiry(buyer, category['LED-2835']);
      let res = await buyer
        .put(`${base(draft.id)}/invitees`)
        .send({ supplierIds: [s.zh.id, s.en.id] })
        .expect(200);
      expect((res.body as InquiryInviteeDto[]).map((i) => i.supplier.code)).toEqual(['TS-EN', 'TS-ZH']);
      expect(res.body[0].addedBy.name).toBe('采购张三');

      res = await buyer
        .put(`${base(draft.id)}/invitees`)
        .send({ supplierIds: [s.en.id, s.bi.id] })
        .expect(200);
      expect((res.body as InquiryInviteeDto[]).map((i) => i.supplier.code).sort()).toEqual([
        'TS-BI',
        'TS-EN',
      ]);

      res = await buyer
        .put(`${base(draft.id)}/invitees`)
        .send({ supplierIds: [s.en.id, s.off.id] })
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'INQUIRY_SUPPLIER_NOT_INVITABLE',
        params: { supplierIds: [s.off.id] },
      });
      res = await buyer
        .put(`${base(draft.id)}/invitees`)
        .send({ supplierIds: ['no-such-supplier'] })
        .expect(400);
      expect(res.body.code).toBe('INQUIRY_SUPPLIER_NOT_INVITABLE');

      const logs = (await timeline(draft.id)).filter((l) => l.action === 'inquiry.invitees');
      expect(logs.map((l) => l.summary)).toEqual([
        `${draft.draftNo} · + TS-ZH, TS-EN`,
        `${draft.draftNo} · + TS-BI · - TS-ZH`,
      ]);
      // 可以清空
      await buyer
        .put(`${base(draft.id)}/invitees`)
        .send({ supplierIds: [] })
        .expect(200);
      expect((await buyer.get(`${base(draft.id)}/invitees`).expect(200)).body).toEqual([]);
    });

    it('R07-2 待审批时、发布后不能改；已在名单里、后来停用的可以留着', async () => {
      const later = await createSupplier(ctx.prisma, { code: 'TS-LATER-1' });
      const draft = await createDraftInquiry(buyer, category['LED-2835']);
      await addManualLine(buyer, draft.id, category['LED-2835']);
      await setInvitees(buyer, draft.id, [later.id]);
      await buyer.post(`${base(draft.id)}/submit`).expect(200);
      let res = await buyer
        .put(`${base(draft.id)}/invitees`)
        .send({ supplierIds: [s.zh.id] })
        .expect(409);
      expect(res.body.code).toBe('INQUIRY_NOT_EDITABLE');

      await manager
        .post(`${base(draft.id)}/approve`)
        .send({})
        .expect(200);
      await ctx.prisma.supplier.update({ where: { id: later.id }, data: { status: 'DISABLED' } });
      await setInvitees(buyer, draft.id, [later.id, s.zh.id]);

      await setInvitees(buyer, draft.id, [s.zh.id]);
      await buyer
        .post(`${base(draft.id)}/rounds/1/publish`)
        .send({ deadline: at(72 * HOUR).toISOString() })
        .expect(200);
      res = await buyer
        .put(`${base(draft.id)}/invitees`)
        .send({ supplierIds: [s.zh.id, s.en.id] })
        .expect(409);
      expect(res.body.code).toBe('INQUIRY_NOT_EDITABLE');
    });

    it('R07-6 名单带门户账号状态；需要 inquiry:view，数据权限外 404', async () => {
      const draft = await createDraftInquiry(buyer, category['LED-2835']);
      await setInvitees(buyer, draft.id, [s.zh.id, s.en.id, s.bi.id, s.nm.id]);
      const list: InquiryInviteeDto[] = (await admin.get(`${base(draft.id)}/invitees`).expect(200)).body;
      expect(Object.fromEntries(list.map((i) => [i.supplier.code, i.supplier.portalAccount]))).toEqual({
        'TS-ZH': 'ACTIVE',
        'TS-EN': 'PENDING',
        'TS-BI': 'NONE',
        'TS-NM': 'DISABLED',
      });
      await buyer2.get(`${base(draft.id)}/invitees`).expect(404);
    });
  });

  describe('R07-3 发布前置条件', () => {
    const publish = (agent: Agent, id: string, deadline: Date | string, status: number) =>
      agent
        .post(`${base(id)}/rounds/1/publish`)
        .send({ deadline: typeof deadline === 'string' ? deadline : deadline.toISOString() })
        .expect(status);

    it('R07-3 询价单没有审批通过 → INQUIRY_INVALID_STATUS', async () => {
      const draft = await createDraftInquiry(buyer, category['LED-2835']);
      await addManualLine(buyer, draft.id, category['LED-2835']);
      await setInvitees(buyer, draft.id, [s.zh.id]);
      expect((await publish(buyer, draft.id, at(72 * HOUR), 409)).body.code).toBe('INQUIRY_INVALID_STATUS');
      await buyer.post(`${base(draft.id)}/submit`).expect(200);
      expect((await publish(buyer, draft.id, at(72 * HOUR), 409)).body.code).toBe('INQUIRY_INVALID_STATUS');
    });

    it('R07-3 没有受邀供应商 → INQUIRY_NO_INVITEES', async () => {
      const inquiry = await approved();
      expect((await publish(buyer, inquiry.id, at(72 * HOUR), 400)).body.code).toBe('INQUIRY_NO_INVITEES');
    });

    it('R07-3 受邀供应商后来停用了 → INQUIRY_SUPPLIER_NOT_INVITABLE（带 supplierIds）', async () => {
      const later = await createSupplier(ctx.prisma, { code: 'TS-LATER-2' });
      const inquiry = await approved();
      await setInvitees(buyer, inquiry.id, [s.zh.id, later.id]);
      await ctx.prisma.supplier.update({ where: { id: later.id }, data: { status: 'DISABLED' } });
      const res = await publish(buyer, inquiry.id, at(72 * HOUR), 400);
      expect(res.body).toMatchObject({
        code: 'INQUIRY_SUPPLIER_NOT_INVITABLE',
        params: { supplierIds: [later.id] },
      });
      expect(await ctx.prisma.quote.count({ where: { round: { inquiryId: inquiry.id } } })).toBe(0);
    });

    it('R07-3 截止早于 现在 + inquiry.minDeadlineHours → INQUIRY_DEADLINE_INVALID；正好等于可以', async () => {
      const inquiry = await approved();
      await setInvitees(buyer, inquiry.id, [s.zh.id]);
      let res = await publish(buyer, inquiry.id, at(30 * 60_000), 400);
      expect(res.body).toMatchObject({ code: 'INQUIRY_DEADLINE_INVALID', params: { minHours: 1 } });
      res = await publish(buyer, inquiry.id, at(-HOUR), 400);
      expect(res.body.code).toBe('INQUIRY_DEADLINE_INVALID');
      expect((await publish(buyer, inquiry.id, 'tomorrow', 400)).body.code).toBe('VALIDATION_FAILED');
      await publish(buyer, inquiry.id, at(HOUR), 200);
    });

    it('R07-3 需要 inquiry:publish；数据权限外 404', async () => {
      const inquiry = await approved();
      await setInvitees(buyer, inquiry.id, [s.zh.id]);
      await publish(pd, inquiry.id, at(72 * HOUR), 403);
      await publish(buyer2, inquiry.id, at(72 * HOUR), 404);
    });

    it('R07-4 材料类别绑定的变体不在激活的模板集里 → PPL_VARIANT_NOT_FOUND', async () => {
      const gone = await ctx.prisma.materialCategory.create({
        data: { code: 'TC-GONE', nameZh: '旧变体分类', nameEn: 'Old variant', pplVariantCode: 'PPL-GONE' },
      });
      const inquiry = await createApprovedInquiry(buyer, manager, gone.id);
      await setInvitees(buyer, inquiry.id, [s.zh.id]);
      const res = await publish(buyer, inquiry.id, at(72 * HOUR), 400);
      expect(res.body).toMatchObject({ code: 'PPL_VARIANT_NOT_FOUND', params: { variantCode: 'PPL-GONE' } });
    });
  });

  describe('R07-4 R07-5 发布', () => {
    it('R07-4 冻结模板与变体、每家一条报价单、轮次进入等待报价', async () => {
      const deadline = at(72 * HOUR);
      const detail = await published([s.zh, s.en, s.bi], deadline);
      expect(detail).toMatchObject({
        displayStatus: 'WAITING_QUOTES',
        currentRoundStatus: 'WAITING_QUOTES',
        currentDeadline: deadline.toISOString(),
        currentRound: { status: 'WAITING_QUOTES', publishedAt: START.toISOString() },
      });
      expect(detail.allowedActions).toEqual(['lateInvite', 'remind', 'extendDeadline', 'viewAccessLog']);

      const round = await roundOf(buyer, detail.id);
      // LED-2835 继承上级 LED 绑定的 PPL-LED
      expect(round).toMatchObject({
        status: 'WAITING_QUOTES',
        pplTemplateVersion: 1,
        pplVariantCode: 'PPL-LED',
      });
      const quotes = await ctx.prisma.quote.findMany({
        where: { roundId: round.id },
        include: { supplier: true },
        orderBy: { supplier: { code: 'asc' } },
      });
      expect(quotes.map((q) => [q.supplier.code, q.status, q.invitedAt.toISOString()])).toEqual([
        ['TS-BI', 'INVITED', START.toISOString()],
        ['TS-EN', 'INVITED', START.toISOString()],
        ['TS-ZH', 'INVITED', START.toISOString()],
      ]);
      const publish = (await timeline(detail.id)).find((l) => l.action === 'inquiry.publish');
      expect(publish?.summary).toBe(`${detail.formalNo} · 2026-11-05 09:00 UTC+8 · TS-BI, TS-EN, TS-ZH`);
    });

    it('R07-5 每家一封邀请：按首选语言，发到联系邮箱并抄送；不含项目号和其他供应商', async () => {
      const detail = await published([s.zh, s.en, s.bi], at(72 * HOUR));
      const formalNo = detail.formalNo!;
      const list = await mails(detail.id, 'INVITATION');
      expect(list).toHaveLength(3);
      const bySupplier = new Map(list.map((m) => [m.supplierId, m]));
      const quote = async (x: Supplier) => (await quoteOf(detail.id, x)).id;

      const zh = bySupplier.get(s.zh.id)!;
      expect(zh).toMatchObject({
        language: 'zh-CN',
        toAddresses: ['wang@xingguang.example.com'],
        ccAddresses: ['sales@xingguang.example.com'],
        subject: `询价邀请：${formalNo} 测试询价`,
        bizKey: `INVITATION:${await quote(s.zh)}`,
      });
      expect(zh.text).toContain('王经理，您好');
      expect(zh.text).toContain('示例照明科技有限公司诚邀深圳星光电子参加以下询价');
      expect(zh.text).toContain('询价明细：1 行');
      expect(zh.text).toContain('报价截止：2026-11-05 09:00（北京时间 UTC+8）');
      expect(zh.text).toContain('采购联系人：采购张三（buyer.zhang@example.com）');
      expect(zh.text).toContain(`${process.env.APP_BASE_URL}/portal/quotes/${await quote(s.zh)}`);

      const en = bySupplier.get(s.en.id)!;
      expect(en).toMatchObject({ language: 'en-US', subject: `Request for quotation: ${formalNo} 测试询价` });
      expect(en.text).toContain('Dear Anna Schmidt');
      expect(en.text).toContain('Example Lighting Co., Ltd. invites Euro Optics GmbH');
      expect(en.text).toContain('Quotation deadline: 2026-11-05 09:00 (Beijing Time, UTC+8)');
      expect(en.text).not.toContain('报价截止');

      const bi = bySupplier.get(s.bi.id)!;
      expect(bi.language).toBe('bilingual');
      expect(bi.subject).toBe(`询价邀请：${formalNo} 测试询价 / Request for quotation: ${formalNo} 测试询价`);
      expect(bi.text).toContain('香港驱动');
      expect(bi.text).toContain('HK Drivers Ltd.');
      expect(bi.text.indexOf('报价截止')).toBeLessThan(bi.text.indexOf('Quotation deadline'));

      for (const m of list) {
        expect(m.html).not.toContain(PROJECT_NO);
        expect(m.text).not.toContain(PROJECT_NO);
        expect(m.html).not.toContain(detail.draftNo);
        const others = [s.zh, s.en, s.bi].filter((x) => x.id !== m.supplierId);
        for (const other of others) {
          expect(m.text).not.toContain(other.contactEmail);
          expect(m.text).not.toContain(other.nameZh);
        }
      }
    });

    it('R07-4 材料类别没有绑定变体时冻结主模板 PPL-MASTER', async () => {
      const plain = await createCategory(ctx.prisma, { code: 'TC-PLAIN' });
      const inquiry = await createApprovedInquiry(buyer, manager, plain.id);
      await publishRound(buyer, inquiry.id, [s.zh.id], at(72 * HOUR));
      expect(await roundOf(buyer, inquiry.id)).toMatchObject({
        pplTemplateVersion: 1,
        pplVariantCode: 'PPL-MASTER',
      });
    });

    it('R07-12 不能重复发布；并发发布只有一个成功，报价单和邀请不重复', async () => {
      const detail = await published([s.zh, s.en]);
      let res = await buyer
        .post(`${base(detail.id)}/rounds/1/publish`)
        .send({ deadline: at(96 * HOUR).toISOString() })
        .expect(409);
      expect(res.body.code).toBe('ROUND_INVALID_STATUS');

      const inquiry = await approved();
      await setInvitees(buyer, inquiry.id, [s.zh.id, s.en.id]);
      const send = () =>
        buyer.post(`${base(inquiry.id)}/rounds/1/publish`).send({ deadline: at(72 * HOUR).toISOString() });
      const results = await Promise.all([send(), send()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.body.code).toBe('ROUND_INVALID_STATUS');
      expect(await ctx.prisma.quote.count({ where: { round: { inquiryId: inquiry.id } } })).toBe(2);
      expect(await mails(inquiry.id, 'INVITATION')).toHaveLength(2);
      res = await buyer.get(`${base(inquiry.id)}/rounds/2`).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('R07-7 补充邀请', () => {
    it('R07-7 等待报价时追加：写入名单、建报价单、发邀请；本轮已邀请的跳过，停用的被拒', async () => {
      const detail = await published([s.zh]);
      ctx.clock.advanceHours(1);
      await buyer
        .post(`${base(detail.id)}/rounds/1/late-invite`)
        .send({ supplierIds: [s.zh.id, s.en.id] })
        .expect(200);
      const quotes = await ctx.prisma.quote.findMany({ where: { round: { inquiryId: detail.id } } });
      expect(quotes).toHaveLength(2);
      expect(await mailCount(detail.id, 'INVITATION', s.zh)).toBe(1);
      expect(await mailCount(detail.id, 'INVITATION', s.en)).toBe(1);
      const invitees: InquiryInviteeDto[] = (await buyer.get(`${base(detail.id)}/invitees`).expect(200)).body;
      expect(invitees.map((i) => i.supplier.code)).toEqual(['TS-ZH', 'TS-EN']);

      const res = await buyer
        .post(`${base(detail.id)}/rounds/1/late-invite`)
        .send({ supplierIds: [s.off.id] })
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'INQUIRY_SUPPLIER_NOT_INVITABLE',
        params: { supplierIds: [s.off.id] },
      });
      expect(
        (await timeline(detail.id)).filter((l) => l.action === 'inquiry.lateInvite').map((l) => l.summary),
      ).toEqual([`${detail.formalNo} · + TS-EN`]);
    });

    it('R07-7 发布前、报价完成后不能补充邀请', async () => {
      const inquiry = await approved();
      let res = await buyer
        .post(`${base(inquiry.id)}/rounds/1/late-invite`)
        .send({ supplierIds: [s.zh.id] })
        .expect(409);
      expect(res.body.code).toBe('ROUND_INVALID_STATUS');

      const detail = await published([s.zh]);
      const round = await roundOf(buyer, detail.id);
      await applyRound(round.id, 'close');
      res = await buyer
        .post(`${base(detail.id)}/rounds/1/late-invite`)
        .send({ supplierIds: [s.en.id] })
        .expect(409);
      expect(res.body.code).toBe('ROUND_INVALID_STATUS');
      await pd
        .post(`${base(detail.id)}/rounds/1/late-invite`)
        .send({ supplierIds: [s.en.id] })
        .expect(403);
    });
  });

  describe('R07-8 手动催报', () => {
    it('R07-8 只能选未响应的报价单，每次每家发一封', async () => {
      const detail = await published([s.zh, s.en, s.bi]);
      await setQuoteStatus(detail.id, s.en, 'SUBMITTED');
      await setQuoteStatus(detail.id, s.bi, 'DECLINED');
      const zh = await quoteOf(detail.id, s.zh);
      const en = await quoteOf(detail.id, s.en);
      const remind = (quoteIds: string[], status: number) =>
        buyer
          .post(`${base(detail.id)}/rounds/1/remind`)
          .send({ quoteIds })
          .expect(status);

      const res = await remind([zh.id, en.id], 409);
      expect(res.body).toMatchObject({ code: 'QUOTE_INVALID_STATUS', params: { quoteIds: [en.id] } });
      expect(await mails(detail.id, 'REMINDER')).toHaveLength(0);

      await remind([zh.id], 200);
      await remind([zh.id], 200);
      const list = await mails(detail.id, 'REMINDER');
      expect(list.map((m) => m.supplierId)).toEqual([s.zh.id, s.zh.id]);
      expect(list[0]).toMatchObject({ language: 'zh-CN', subject: `报价提醒：${detail.formalNo} 测试询价` });
      expect(list[0].text).toContain('将于 2026-11-05 09:00（北京时间 UTC+8）截止');
      expect(list[0].text).toContain(`/portal/quotes/${zh.id}`);
      expect((await timeline(detail.id)).filter((l) => l.action === 'inquiry.remind')).toHaveLength(2);

      // 别的询价单的报价单
      const other = await published([s.zh]);
      const otherQuote = await quoteOf(other.id, s.zh);
      await remind([otherQuote.id], 404);
    });

    it('R07-8 需要 inquiry:remind；报价完成后不能催报', async () => {
      const detail = await published([s.zh]);
      const zh = await quoteOf(detail.id, s.zh);
      await pd
        .post(`${base(detail.id)}/rounds/1/remind`)
        .send({ quoteIds: [zh.id] })
        .expect(403);
      await applyRound((await roundOf(buyer, detail.id)).id, 'close');
      const res = await buyer
        .post(`${base(detail.id)}/rounds/1/remind`)
        .send({ quoteIds: [zh.id] })
        .expect(409);
      expect(res.body.code).toBe('ROUND_INVALID_STATUS');
    });
  });

  describe('R07-9 自动催报', () => {
    const job = () => ctx.app.get(AutoReminderJob);

    it('R07-9 截止前 24 小时只给未响应的发一次，再执行不重复', async () => {
      const deadline = at(240 * HOUR);
      const detail = await published([s.zh, s.en, s.bi], deadline);
      await setQuoteStatus(detail.id, s.en, 'SUBMITTED');
      await setQuoteStatus(detail.id, s.bi, 'DECLINED');
      const round = await ctx.prisma.inquiryRound.findFirstOrThrow({ where: { inquiryId: detail.id } });

      ctx.clock.set(new Date(deadline.getTime() - 25 * HOUR));
      await job().run();
      expect(await mails(detail.id, 'REMINDER')).toHaveLength(0);

      const now = new Date(deadline.getTime() - 23 * HOUR);
      ctx.clock.set(now);
      await job().run();
      let list = await mails(detail.id, 'REMINDER');
      expect(list.map((m) => [m.supplierId, m.bizKey])).toEqual([
        [s.zh.id, `REMINDER:AUTO:${round.id}:${s.zh.id}:${deadline.getTime()}`],
      ]);
      expect(
        (await ctx.prisma.inquiryRound.findUniqueOrThrow({ where: { id: round.id } })).autoReminderSentAt,
      ).toEqual(now);

      ctx.clock.advance(20 * 60_000);
      await job().run();
      list = await mails(detail.id, 'REMINDER');
      expect(list).toHaveLength(1);
      const log = (
        await ctx.prisma.auditLog.findMany({ where: { entityId: detail.id, action: 'inquiry.autoRemind' } })
      ).map((l) => [l.actorId, l.summary]);
      expect(log).toEqual([[null, `${detail.formalNo} · TS-ZH`]]);
    });

    it('R07-9 邀请时已在催报窗口内的不催；延期后新的截止前再催一次', async () => {
      // 发布时离截止只有 20 小时：邀请邮件已经写明截止时间，不再自动催
      const soon = await published([s.zh], at(20 * HOUR));
      ctx.clock.set(at(HOUR));
      await job().run();
      expect(await mails(soon.id, 'REMINDER')).toHaveLength(0);
      expect(
        (await ctx.prisma.inquiryRound.findFirstOrThrow({ where: { inquiryId: soon.id } }))
          .autoReminderSentAt,
      ).not.toBeNull();

      ctx.clock.set(START);
      const first = at(240 * HOUR);
      const detail = await published([s.zh], first);
      ctx.clock.set(new Date(first.getTime() - 23 * HOUR));
      await job().run();
      expect(await mails(detail.id, 'REMINDER')).toHaveLength(1);

      // 时钟前进超过 12 小时，会话已过期，重新登录
      const again = await loginAs(ctx, users.buyer);
      const second = new Date(first.getTime() + 48 * HOUR);
      await again
        .put(`${base(detail.id)}/rounds/1/deadline`)
        .send({ deadline: second.toISOString() })
        .expect(200);
      expect(
        (await ctx.prisma.inquiryRound.findFirstOrThrow({ where: { inquiryId: detail.id } }))
          .autoReminderSentAt,
      ).toBeNull();
      ctx.clock.set(new Date(second.getTime() - 23 * HOUR));
      await job().run();
      const list = await mails(detail.id, 'REMINDER');
      expect(list).toHaveLength(2);
      expect(new Set(list.map((m) => m.bizKey)).size).toBe(2);
    });

    it('R07-9 参数为 0 时不发', async () => {
      const key = 'reminder.autoHoursBeforeDeadline';
      await admin.put(`/api/system/params/${key}`).send({ value: 0 }).expect(200);
      const deadline = at(240 * HOUR);
      const detail = await published([s.zh], deadline);
      ctx.clock.set(new Date(deadline.getTime() - 23 * HOUR));
      expect(await job().run()).toEqual({ rounds: 0, reminders: 0 });
      expect(await mails(detail.id, 'REMINDER')).toHaveLength(0);
      ctx.clock.set(START);
      await admin.put(`/api/system/params/${key}`).send({ value: 24 }).expect(200);
    });
  });

  describe('R07-10 延期', () => {
    const extend = (agent: Agent, id: string, deadline: Date, status: number) =>
      agent
        .put(`${base(id)}/rounds/1/deadline`)
        .send({ deadline: deadline.toISOString() })
        .expect(status);

    it('R07-10 新截止要晚于原截止；成功后通知受邀且没有拒绝的供应商', async () => {
      const original = at(72 * HOUR);
      const detail = await published([s.zh, s.en, s.bi], original);
      await setQuoteStatus(detail.id, s.en, 'SUBMITTED');
      await setQuoteStatus(detail.id, s.bi, 'DECLINED');

      let res = await extend(buyer, detail.id, at(48 * HOUR), 400);
      expect(res.body).toMatchObject({ code: 'INQUIRY_DEADLINE_INVALID', params: { minHours: 1 } });
      await extend(buyer, detail.id, original, 400);
      await extend(pd, detail.id, at(120 * HOUR), 403);

      const next = at(120 * HOUR);
      res = await extend(buyer, detail.id, next, 200);
      expect(res.body).toMatchObject({
        currentRoundStatus: 'WAITING_QUOTES',
        currentDeadline: next.toISOString(),
      });
      expect((await roundOf(buyer, detail.id)).deadline).toBe(next.toISOString());

      const list = await mails(detail.id, 'CHANGE');
      expect(list.map((m) => m.supplierId).sort()).toEqual([s.en.id, s.zh.id].sort());
      const zh = list.find((m) => m.supplierId === s.zh.id)!;
      expect(zh.subject).toBe(`截止时间变更：${detail.formalNo} 测试询价`);
      expect(zh.text).toContain(
        '已由 2026-11-05 09:00（北京时间 UTC+8）调整为 2026-11-07 09:00（北京时间 UTC+8）',
      );
      const en = list.find((m) => m.supplierId === s.en.id)!;
      expect(en.text).toContain('changed from 2026-11-05 09:00 (Beijing Time, UTC+8) to 2026-11-07 09:00');
      expect((await timeline(detail.id)).find((l) => l.action === 'inquiry.extendDeadline')?.summary).toBe(
        `${detail.formalNo} · 2026-11-05 09:00 UTC+8 → 2026-11-07 09:00 UTC+8`,
      );
    });

    it('R07-10 报价完成后延期回到等待报价，清空截止标记；新截止还要晚于 现在 + 最小小时数', async () => {
      const original = at(2 * HOUR);
      const detail = await published([s.zh], original);
      const round = await roundOf(buyer, detail.id);
      ctx.clock.set(at(3 * HOUR));
      await applyRound(round.id, 'closeEarly', { data: { quotesClosedAt: at(3 * HOUR), closedEarly: true } });
      let current = await detailOf(buyer, detail.id);
      expect(current).toMatchObject({
        displayStatus: 'QUOTES_CLOSED',
        allowedActions: ['extendDeadline', 'viewAccessLog'],
      });

      // 晚于原截止但早于 现在 + 1 小时
      await extend(buyer, detail.id, at(3.5 * HOUR), 400);
      await extend(buyer, detail.id, at(5 * HOUR), 200);
      current = await detailOf(buyer, detail.id);
      expect(current).toMatchObject({
        displayStatus: 'WAITING_QUOTES',
        currentDeadline: at(5 * HOUR).toISOString(),
      });
      const fresh = await ctx.prisma.inquiryRound.findUniqueOrThrow({ where: { id: round.id } });
      expect(fresh).toMatchObject({ status: 'WAITING_QUOTES', quotesClosedAt: null, closedEarly: false });
    });
  });

  describe('R07-11 发布后取消', () => {
    it('R07-11 报价单全部作废，取消邮件（含原因）只发给没有拒绝的', async () => {
      const detail = await published([s.zh, s.en, s.bi]);
      await setQuoteStatus(detail.id, s.en, 'SUBMITTED');
      await setQuoteStatus(detail.id, s.bi, 'DECLINED');
      expect((await detailOf(manager, detail.id)).allowedActions).toContain('cancel');

      const res = await manager
        .post(`${base(detail.id)}/cancel`)
        .send({ reason: '项目暂停' })
        .expect(200);
      expect(res.body).toMatchObject({
        docStatus: 'CANCELLED',
        displayStatus: 'CANCELLED',
        currentRoundStatus: 'CANCELLED',
        allowedActions: ['viewAccessLog'],
      });
      const quotes = await ctx.prisma.quote.findMany({ where: { round: { inquiryId: detail.id } } });
      expect(quotes.map((q) => q.status)).toEqual(['VOID', 'VOID', 'VOID']);
      expect((await roundOf(buyer, detail.id)).status).toBe('CANCELLED');

      const list = await mails(detail.id, 'CHANGE');
      expect(list.map((m) => m.supplierId).sort()).toEqual([s.en.id, s.zh.id].sort());
      const zh = list.find((m) => m.supplierId === s.zh.id)!;
      expect(zh.subject).toBe(`询价取消：${detail.formalNo} 测试询价`);
      expect(zh.text).toContain('取消原因：项目暂停');
      expect(list.find((m) => m.supplierId === s.en.id)!.text).toContain('Reason: 项目暂停');

      const zhQuote = await quoteOf(detail.id, s.zh);
      const again = await buyer
        .post(`${base(detail.id)}/rounds/1/remind`)
        .send({ quoteIds: [zhQuote.id] })
        .expect(409);
      expect(again.body.code).toBe('INQUIRY_INVALID_STATUS');
    });

    it('R07-11 发布前取消不发邮件；当前轮次评标完成后不能取消', async () => {
      const inquiry = await approved();
      await setInvitees(buyer, inquiry.id, [s.zh.id]);
      await manager
        .post(`${base(inquiry.id)}/cancel`)
        .send({ reason: '不需要了' })
        .expect(200);
      expect(await mails(inquiry.id, 'CHANGE')).toHaveLength(0);

      const detail = await published([s.zh]);
      // M12 之前没有定标接口，直接改库模拟评标完成
      await ctx.prisma.inquiryRound.updateMany({
        where: { inquiryId: detail.id },
        data: { status: 'EVALUATED' },
      });
      await ctx.prisma.inquiry.update({
        where: { id: detail.id },
        data: { currentRoundStatus: 'EVALUATED' },
      });
      expect((await detailOf(manager, detail.id)).allowedActions).not.toContain('cancel');
      const res = await manager
        .post(`${base(detail.id)}/cancel`)
        .send({ reason: '晚了' })
        .expect(409);
      expect(res.body.code).toBe('INQUIRY_INVALID_STATUS');
    });
  });

  describe('R07-12 RoundStateService', () => {
    it('R07-12 表外的流转被拒（ROUND_INVALID_STATUS）；迁移当前轮次时同步询价单的冗余字段', async () => {
      const detail = await published([s.zh]);
      const round = await roundOf(buyer, detail.id);
      for (const event of ['publish', 'open', 'award'] as const) {
        await expect(applyRound(round.id, event)).rejects.toMatchObject({ code: 'ROUND_INVALID_STATUS' });
      }
      // 额外条件不满足：还没到截止时间
      await expect(
        applyRound(round.id, 'close', { where: { deadline: { lte: ctx.clock.now() } } }),
      ).rejects.toMatchObject({ code: 'ROUND_INVALID_STATUS' });

      const closed = await applyRound(round.id, 'close', { audit: { actor: null, summary: 'closed' } });
      expect(closed.status).toBe('QUOTES_CLOSED');
      const inquiry = await ctx.prisma.inquiry.findUniqueOrThrow({ where: { id: detail.id } });
      expect(inquiry).toMatchObject({
        currentRoundStatus: 'QUOTES_CLOSED',
        currentDeadline: round.deadline && new Date(round.deadline),
      });
      expect((await timeline(detail.id)).map((l) => l.action)).toContain('inquiry.close');
      await expect(applyRound(round.id, 'close')).rejects.toMatchObject({ code: 'ROUND_INVALID_STATUS' });
    });
  });

  describe('供应商响应（M07 只有状态字段）', () => {
    it('S-1 只返回状态字段和拒绝原因，不含任何报价内容', async () => {
      const detail = await published([s.zh, s.en, s.bi]);
      await setQuoteStatus(detail.id, s.bi, 'DECLINED');
      const zh = await quoteOf(detail.id, s.zh);
      await ctx.prisma.quote.update({ where: { id: zh.id }, data: { firstViewedAt: at(HOUR) } });

      const { sealed, items: list }: RoundResponsesDto = (
        await buyer.get(`${base(detail.id)}/rounds/1/responses`).expect(200)
      ).body;
      expect(sealed).toBe(true);
      expect(list.map((r) => [r.supplier.code, r.status, r.supplier.portalAccount])).toEqual([
        ['TS-BI', 'DECLINED', 'NONE'],
        ['TS-EN', 'INVITED', 'PENDING'],
        ['TS-ZH', 'INVITED', 'ACTIVE'],
      ]);
      expect(Object.keys(list[0]).sort()).toEqual(
        [
          'declineReason',
          'declineReasonCode',
          'declinedAt',
          'firstViewedAt',
          'id',
          'invitedAt',
          'lastSubmittedAt',
          'respondedAt',
          'status',
          'supplier',
          'versionCount',
        ].sort(),
      );
      expect(list[0]).toMatchObject({
        declineReasonCode: 'LEAD_TIME',
        declineReason: '交期无法满足',
        versionCount: 0,
      });
      expect(list[2]).toMatchObject({ id: zh.id, firstViewedAt: at(HOUR).toISOString(), respondedAt: null });

      await admin.get(`${base(detail.id)}/rounds/1/responses`).expect(200);
      await buyer2.get(`${base(detail.id)}/rounds/1/responses`).expect(404);
      await portal.get(`${base(detail.id)}/rounds/1/responses`).expect(403);
      await buyer.get(`${base(detail.id)}/rounds/9/responses`).expect(404);
    });
  });

  describe('邮件记录', () => {
    it('M07 §5 邮件记录页按询价单号能筛到这张单的全部邮件', async () => {
      const detail = await published([s.zh, s.en]);
      const all = await mails(detail.id);
      // 审批邮件主题里只有草稿号（buyer、manager 都有邮箱），邀请邮件主题里是正式询价号
      expect(all.map((m) => m.type)).toEqual(expect.arrayContaining(['APPROVAL', 'INVITATION']));
      for (const keyword of [detail.formalNo!, detail.draftNo]) {
        const res = await admin.get('/api/system/emails').query({ keyword, pageSize: 100 }).expect(200);
        expect(res.body.items.map((m: { id: string }) => m.id).sort()).toEqual(all.map((m) => m.id).sort());
      }
    });
  });
});
