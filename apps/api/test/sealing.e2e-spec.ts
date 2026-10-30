import type {
  AuditLogDto,
  EmailDetailDto,
  EmailListItemDto,
  Paginated,
  RoleDto,
  RoundQuoteDetailDto,
  RoundResponsesDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { RoundDeadlineJob } from '../src/modules/inquiries/round-deadline.job';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { ledLines, publishLedInquiry, submitQuote, type PublishedLed } from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
/** 会话 12 小时过期：截止设在 6 小时后，用例里前进不超过 12 小时 */
const START = new Date('2026-11-09T01:00:00.000Z');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

/**
 * 报价内容里独一无二的字符串：两家的含税单价、合计（甲 3.3333 × 1000 + 5.5555 × 500 = 6111.05，
 * 乙 4.4444 × 1000 + 6.6666 × 500 = 7777.70）、备注、附件名。开标前任何内部出口都不能出现
 */
const SECRETS = ['3.3333', '5.5555', '4.4444', '6.6666', '6111.05', '7777.7', '甲机密备注', '甲报价说明'];

function expectNoSecrets(value: unknown, where: string): void {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) {
    if (text.includes(secret)) throw new Error(`${where} leaks "${secret}"`);
  }
}

/**
 * 密封测试集（05 §7.1、M10 §6）：一轮 3 家供应商，甲、乙已提交（甲带附件），丙未响应。
 * 开标前用 BUYER、PURCHASE_MANAGER、ADMIN 走一遍所有能拿到报价数据的出口。
 * M11 的比价矩阵与导出、M15 的报表、M16 的工作台各自把新出口补进 internalExits()
 */
describe('M10 密封测试集', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let agents: Record<'buyer' | 'manager' | 'admin', Agent>;
  let portal: Record<'a' | 'b', Agent>;
  let s: Record<'a' | 'b' | 'c', Supplier>;
  let category: Record<string, string>;
  let p: PublishedLed;
  let attachmentId: string;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const roundUrl = () => `/api/inquiries/${p.inquiry.id}/rounds/1`;
  const quoteUrl = (i = 0) => `${roundUrl()}/quotes/${p.quotes[i]}`;

  async function responses(agent: Agent): Promise<RoundResponsesDto> {
    return (await agent.get(`${roundUrl()}/responses`).expect(200)).body;
  }

  /** 拿不到报价内容：报价详情、版本详情 403（没有 inquiry:evaluate 的管理员是 FORBIDDEN，其余 QUOTE_SEALED） */
  async function expectQuoteSealed(agent: Agent, code = 'QUOTE_SEALED'): Promise<void> {
    for (const url of [quoteUrl(0), `${quoteUrl(0)}/versions/1`, quoteUrl(1), `${quoteUrl(1)}/versions/1`]) {
      expect((await agent.get(url).expect(403)).body.code).toBe(code);
    }
    for (const suffix of ['content', 'content?disposition=attachment', 'meta']) {
      expect((await agent.get(`/api/files/${attachmentId}/${suffix}`).expect(403)).body.code).toBe(
        'FILE_ACCESS_DENIED',
      );
    }
  }

  /** 不需要 inquiry:evaluate 的出口：响应列表、询价单详情 / 轮次 / 列表、时间线，有权限时还有系统日志与邮件记录 */
  async function internalExits(agent: Agent, name: string): Promise<void> {
    const list = await responses(agent);
    expect(list.sealed).toBe(true);
    for (const item of list.items) {
      expect(item).not.toHaveProperty('totalAmount');
      expect(item).not.toHaveProperty('currency');
    }
    expect(list.items.map((i) => [i.supplier.code, i.status, i.versionCount])).toEqual([
      ['TS-A', 'SUBMITTED', 1],
      ['TS-B', 'SUBMITTED', 1],
      ['TS-C', 'INVITED', 0],
    ]);
    expectNoSecrets(list, `${name} responses`);
    const pages = [
      `/api/inquiries/${p.inquiry.id}`,
      roundUrl(),
      '/api/inquiries?page=1&pageSize=50',
      `/api/inquiries/${p.inquiry.id}/timeline`,
    ];
    for (const url of pages) expectNoSecrets((await agent.get(url).expect(200)).body, `${name} ${url}`);
  }

  /** 管理员的系统日志与邮件记录（列表和详情） */
  async function adminExits(): Promise<void> {
    const logs: Paginated<AuditLogDto> = (
      await agents.admin.get('/api/system/audit-logs?page=1&pageSize=100').expect(200)
    ).body;
    expect(logs.items.some((l) => l.action === 'quote.submit')).toBe(true);
    expectNoSecrets(logs, 'audit logs');
    const emails: Paginated<EmailListItemDto> = (
      await agents.admin.get('/api/system/emails?page=1&pageSize=100').expect(200)
    ).body;
    expect(emails.items.length).toBeGreaterThan(0);
    expectNoSecrets(emails, 'email list');
    for (const e of emails.items) {
      const detail: EmailDetailDto = (await agents.admin.get(`/api/system/emails/${e.id}`).expect(200)).body;
      expectNoSecrets(detail, `email ${e.id}`);
    }
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
      manager: await mk('manager', ['PURCHASE_MANAGER']),
      admin: await mk('admin', ['ADMIN']),
    };
    s = {
      a: await createSupplier(ctx.prisma, { code: 'TS-A', nameZh: '供应商甲' }),
      b: await createSupplier(ctx.prisma, { code: 'TS-B', nameZh: '供应商乙' }),
      c: await createSupplier(ctx.prisma, { code: 'TS-C', nameZh: '供应商丙' }),
    };
    const account = (supplier: Supplier, username: string) =>
      createUser(ctx.prisma, { username, roles: ['SUPPLIER'], userType: 'SUPPLIER', supplierId: supplier.id });
    users.a = await account(s.a, 'a@supplier.example.com');
    users.b = await account(s.b, 'b@supplier.example.com');
    agents = {
      buyer: await loginAs(ctx, users.buyer),
      manager: await loginAs(ctx, users.manager),
      admin: await loginAs(ctx, users.admin),
    };
    portal = { a: await loginAs(ctx, users.a), b: await loginAs(ctx, users.b) };

    p = await publishLedInquiry(
      ctx.prisma,
      agents.buyer,
      agents.manager,
      category['LED-2835'],
      [s.a.id, s.b.id, s.c.id],
      at(6 * HOUR),
      '密封测试询价',
    );
    attachmentId = (
      await portal.a.post('/api/files').field('kind', 'ATTACHMENT').attach('file', PDF, '甲报价说明.pdf').expect(201)
    ).body.id;
    ctx.clock.set(at(HOUR));
    await submitQuote(portal.a, p.quotes[0], ledLines(p, '3.3333', '5.5555'), {
      remark: '甲机密备注',
      attachmentFileIds: [attachmentId],
    });
    await submitQuote(portal.b, p.quotes[1], ledLines(p, '4.4444', '6.6666'));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('S-1 S-3 开标前（等待报价）BUYER、PURCHASE_MANAGER、ADMIN 都拿不到报价内容', async () => {
    for (const [name, agent] of Object.entries(agents)) await internalExits(agent, name);
    await expectQuoteSealed(agents.buyer);
    await expectQuoteSealed(agents.manager);
    // 管理员没有 inquiry:evaluate
    await expectQuoteSealed(agents.admin, 'FORBIDDEN');
    await adminExits();
  });

  it('S-1 邮件表里的所有邮件（含发给内部用户的审批邮件）正文都没有报价内容', async () => {
    const emails = await ctx.prisma.emailMessage.findMany();
    const internal = emails.filter((e) => e.userId !== null || e.toAddresses.some((a) => a.endsWith('@example.com')));
    expect(internal.length).toBeGreaterThan(0);
    for (const e of emails) expectNoSecrets([e.subject, e.html, e.text], `email ${e.id}`);
  });

  it('S-1 管理员给自己的角色加上 inquiry:evaluate 也只得到 QUOTE_SEALED', async () => {
    const roles: RoleDto[] = (await agents.admin.get('/api/system/roles').expect(200)).body;
    const role = roles.find((r) => r.code === 'ADMIN')!;
    const body = (permissions: string[]) => ({
      nameZh: role.nameZh,
      nameEn: role.nameEn,
      description: role.description ?? undefined,
      dataScope: role.dataScope,
      permissions,
      fieldPermissions: role.fieldPermissions,
    });
    await agents.admin
      .put(`/api/system/roles/${role.id}`)
      .send(body([...role.permissions, 'inquiry:evaluate']))
      .expect(200);
    try {
      await expectQuoteSealed(agents.admin);
      expect((await responses(agents.admin)).sealed).toBe(true);
    } finally {
      await agents.admin.put(`/api/system/roles/${role.id}`).send(body(role.permissions)).expect(200);
    }
  });

  it('S-2 seal.preOpenViewRoles 加入 PURCHASE_MANAGER 后主管开标前能看报价详情与合计；移除后又不可见', async () => {
    const setRoles = (value: string[]) =>
      agents.admin.put('/api/system/params/seal.preOpenViewRoles').send({ value }).expect(200);
    await setRoles(['PURCHASE_MANAGER']);
    try {
      const detail: RoundQuoteDetailDto = (await agents.manager.get(quoteUrl(0)).expect(200)).body;
      expect(detail.currentVersion).toMatchObject({ totalAmount: '6111.05', remark: '甲机密备注' });
      await agents.manager.get(`${quoteUrl(0)}/versions/1`).expect(200);
      await agents.manager.get(`/api/files/${attachmentId}/content`).expect(200);
      const list = await responses(agents.manager);
      expect(list.sealed).toBe(false);
      expect(list.items.map((i) => i.totalAmount)).toEqual(['6111.05', '7777.70', null]);
      // 采购员不在名单里
      await expectQuoteSealed(agents.buyer);
      expect((await responses(agents.buyer)).sealed).toBe(true);
    } finally {
      await setRoles([]);
    }
    await expectQuoteSealed(agents.manager);
    expect((await responses(agents.manager)).sealed).toBe(true);
  });

  it('S-1 截止后（报价完成、未开标）照样密封', async () => {
    ctx.clock.set(at(6 * HOUR));
    expect(await ctx.app.get(RoundDeadlineJob).run()).toEqual({ closed: 1 });
    const detail = (await agents.buyer.get(`/api/inquiries/${p.inquiry.id}`).expect(200)).body;
    expect(detail.currentRoundStatus).toBe('QUOTES_CLOSED');
    for (const [name, agent] of Object.entries(agents)) await internalExits(agent, name);
    await expectQuoteSealed(agents.buyer);
    await expectQuoteSealed(agents.manager);
    await adminExits();
  });

  it('S-5 开标后有 inquiry:evaluate 的人能看报价、合计与附件；审计和开标邮件里仍然没有金额', async () => {
    await agents.manager.post(`${roundUrl()}/open`).expect(200);
    const list = await responses(agents.buyer);
    expect(list.sealed).toBe(false);
    expect(list.items.map((i) => [i.supplier.code, i.status, i.totalAmount, i.currency])).toEqual([
      ['TS-A', 'EVALUATING', '6111.05', 'CNY'],
      ['TS-B', 'EVALUATING', '7777.70', 'CNY'],
      ['TS-C', 'INVITED', null, null],
    ]);
    const detail: RoundQuoteDetailDto = (await agents.buyer.get(quoteUrl(0)).expect(200)).body;
    expect(detail).toMatchObject({ status: 'EVALUATING', currentVersion: { remark: '甲机密备注' } });
    await agents.buyer.get(`/api/files/${attachmentId}/content`).expect(200);
    // 管理员没有 inquiry:evaluate、quote.amount：响应列表的合计被脱敏，报价详情与附件仍是 403
    const adminList = await responses(agents.admin);
    expect(adminList.sealed).toBe(false);
    expect(adminList.items[0]).toMatchObject({ totalAmount: null, maskedFields: ['totalAmount'] });
    expectNoSecrets(adminList, 'admin responses');
    expect((await agents.admin.get(quoteUrl(0)).expect(403)).body.code).toBe('FORBIDDEN');
    await agents.admin.get(`/api/files/${attachmentId}/content`).expect(403);

    expectNoSecrets((await agents.buyer.get(`/api/inquiries/${p.inquiry.id}/timeline`).expect(200)).body, 'timeline');
    const emails = await ctx.prisma.emailMessage.findMany({ where: { type: 'OPENING' } });
    expect(emails).toHaveLength(2);
    for (const e of emails) expectNoSecrets([e.subject, e.html, e.text], `opening ${e.id}`);
  });

  it('S-4 从未开标就被取消的轮次永久密封；开标后才取消的照样能看', async () => {
    ctx.clock.set(at(7 * HOUR));
    const never = await publishLedInquiry(
      ctx.prisma,
      agents.buyer,
      agents.manager,
      category['LED-2835'],
      [s.a.id],
      at(10 * HOUR),
    );
    await submitQuote(portal.a, never.quotes[0], ledLines(never, '3.3333', '5.5555'));
    await agents.manager.post(`/api/inquiries/${never.inquiry.id}/cancel`).send({ reason: '需求取消' }).expect(200);
    const url = `/api/inquiries/${never.inquiry.id}/rounds/1`;
    expect((await agents.manager.get(`${url}/quotes/${never.quotes[0]}`).expect(403)).body.code).toBe(
      'QUOTE_SEALED',
    );
    const list: RoundResponsesDto = (await agents.manager.get(`${url}/responses`).expect(200)).body;
    expect(list).toMatchObject({ sealed: true, items: [{ status: 'VOID' }] });
    expect(list.items[0]).not.toHaveProperty('totalAmount');

    // 上一张开过标的询价取消后：报价作废，内容和合计照样能看
    await agents.manager.post(`/api/inquiries/${p.inquiry.id}/cancel`).send({ reason: '改用其他方案' }).expect(200);
    const opened = await responses(agents.buyer);
    expect(opened.sealed).toBe(false);
    expect(opened.items[0]).toMatchObject({ status: 'VOID', totalAmount: '6111.05' });
    await agents.buyer.get(quoteUrl(0)).expect(200);
  });
});
