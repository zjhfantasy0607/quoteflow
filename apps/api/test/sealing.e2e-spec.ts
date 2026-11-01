import type {
  AuditLogDto,
  EmailDetailDto,
  EmailListItemDto,
  InquiryReportRowDto,
  LogisticsReportDto,
  Paginated,
  RoleDto,
  RoundMatrixDto,
  RoundQuoteDetailDto,
  RoundResponsesDto,
  SupplierQuoteItemDto,
  WorkbenchDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { RoundDeadlineJob } from '../src/modules/inquiries/round-deadline.job';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { ledLines, publishLedInquiry, submitQuote, type PublishedLed } from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';
import { binaryParser, loadXlsx, sheetRows } from './helpers/xlsx';

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
 * M11 的比价矩阵、导出与议价线程在 expectQuoteSealed()（要 inquiry:evaluate / inquiry:export）；
 * M14 的合同列表在 internalExits()，合同详情与合同里的报价附件另有兜底用例；
 * M15 的报表、统计与供应商报价记录在 reportExits()（internalExits() 会调用），开标后与 S-4 另有断言；
 * M16 的工作台在 internalExits()（等待报价 / 待开标卡片只有响应家数）
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

  /**
   * 拿不到报价内容：报价详情、版本详情、比价矩阵与导出（M11）、议价线程 403（没有 inquiry:evaluate 的管理员是
   * FORBIDDEN，其余 QUOTE_SEALED）
   */
  async function expectQuoteSealed(agent: Agent, code = 'QUOTE_SEALED'): Promise<void> {
    for (const url of [
      quoteUrl(0),
      `${quoteUrl(0)}/versions/1`,
      quoteUrl(1),
      `${quoteUrl(1)}/versions/1`,
      `${roundUrl()}/matrix`,
      `${roundUrl()}/matrix/export`,
      `/api/quotes/${p.quotes[0]}/negotiation`,
    ]) {
      expect((await agent.get(url).expect(403)).body.code).toBe(code);
    }
    for (const suffix of ['content', 'content?disposition=attachment', 'meta']) {
      expect((await agent.get(`/api/files/${attachmentId}/${suffix}`).expect(403)).body.code).toBe(
        'FILE_ACCESS_DENIED',
      );
    }
  }

  /** 导出的 xlsx 里所有单元格的文字 */
  async function xlsxText(agent: Agent, url: string): Promise<string[]> {
    const res = await agent.get(url).buffer(true).parse(binaryParser).expect(200);
    const wb = await loadXlsx(res.body as Buffer);
    return wb.worksheets.flatMap((ws) =>
      sheetRows(ws)
        .flat()
        .map((cell) => String(cell ?? '')),
    );
  }

  /**
   * M15 报表与统计：询报价单统计里本轮金额密封、物流明细不含未开标的轮次（S-3）、供应商报价记录密封；
   * 有 report:export 的人导出的询报价单统计、物流明细、统计看板也没有报价内容
   */
  async function reportExits(agent: Agent, name: string): Promise<void> {
    const report: Paginated<InquiryReportRowDto> = (await agent.get('/api/reports/inquiries').expect(200))
      .body;
    const row = report.items.find((r) => r.roundId === p.roundId)!;
    expect(row).toMatchObject({
      sealed: true,
      quotedCount: 2,
      minTotal: null,
      maxTotal: null,
      avgTotal: null,
    });
    const logistics: LogisticsReportDto = (await agent.get('/api/reports/logistics').expect(200)).body;
    expect(logistics.items.filter((r) => r.inquiry.id === p.inquiry.id)).toEqual([]);
    const quotes: Paginated<SupplierQuoteItemDto> = (
      await agent.get(`/api/suppliers/${s.a.id}/quotes`).expect(200)
    ).body;
    expect(quotes.items.find((q) => q.id === p.quotes[0])).toMatchObject({ sealed: true, totalAmount: null });
    const pages = [
      '/api/reports/points-summary',
      '/api/reports/points-ledger',
      '/api/stats/projects',
      '/api/stats/response-speed',
      '/api/stats/win-rate',
      '/api/stats/cycle-time',
    ];
    for (const value of [report, logistics, quotes]) expectNoSecrets(value, `${name} reports`);
    for (const url of pages) expectNoSecrets((await agent.get(url).expect(200)).body, `${name} ${url}`);
    if (name === 'buyer') {
      // 采购员没有 report:export
      await agent.get('/api/reports/inquiries/export').expect(403);
      return;
    }
    for (const url of [
      '/api/reports/inquiries/export',
      '/api/reports/logistics/export',
      '/api/stats/export',
    ]) {
      expectNoSecrets(await xlsxText(agent, url), `${name} ${url}`);
    }
  }

  /**
   * 不需要 inquiry:evaluate 的出口：响应列表、询价单详情 / 轮次 / 列表、时间线、合同列表（M14）、报表与统计（M15）、
   * 工作台（M16），有权限时还有系统日志与邮件记录
   */
  async function internalExits(agent: Agent, name: string): Promise<void> {
    await reportExits(agent, name);
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
      '/api/contracts?page=1&pageSize=50',
    ];
    for (const url of pages) expectNoSecrets((await agent.get(url).expect(200)).body, `${name} ${url}`);
    const workbench: WorkbenchDto = (await agent.get('/api/workbench').expect(200)).body;
    // 等待报价时三个角色都在"等待报价"里看到它；截止后只有能开标的主管在"待开标"里看到
    const round = await ctx.prisma.inquiryRound.findUniqueOrThrow({ where: { id: p.roundId } });
    const card = round.status === 'WAITING_QUOTES' ? workbench.waitingQuotes : workbench.toOpen;
    if (round.status === 'QUOTES_CLOSED' && name !== 'manager') expect(card).toBeUndefined();
    else
      expect(card!.items.find((i) => i.id === p.inquiry.id)!.progress).toEqual({ responded: 2, invited: 3 });
    expectNoSecrets(workbench, `${name} workbench`);
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
      createUser(ctx.prisma, {
        username,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: supplier.id,
      });
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
      await portal.a
        .post('/api/files')
        .field('kind', 'ATTACHMENT')
        .attach('file', PDF, '甲报价说明.pdf')
        .expect(201)
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
    const internal = emails.filter(
      (e) => e.userId !== null || e.toAddresses.some((a) => a.endsWith('@example.com')),
    );
    expect(internal.length).toBeGreaterThan(0);
    for (const e of emails) expectNoSecrets([e.subject, e.html, e.text], `email ${e.id}`);
  });

  it('S-1 管理员给自己的角色加上 inquiry:evaluate、inquiry:export 也只得到 QUOTE_SEALED', async () => {
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
      .send(body([...role.permissions, 'inquiry:evaluate', 'inquiry:export']))
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
      const matrix: RoundMatrixDto = (await agents.manager.get(`${roundUrl()}/matrix`).expect(200)).body;
      expect(matrix.suppliers.map((r) => r.totalAmount)).toEqual(['6111.05', '7777.70', null]);
      await agents.manager.get(`${roundUrl()}/matrix/export`).expect(200);
      // M15：询报价单统计跟着放开；物流报价明细仍只含开过标的轮次（S-3）
      const report: Paginated<InquiryReportRowDto> = (
        await agents.manager.get('/api/reports/inquiries').expect(200)
      ).body;
      expect(report.items[0]).toMatchObject({ sealed: false, minTotal: '6111.05', maxTotal: '7777.70' });
      expect((await agents.manager.get('/api/reports/logistics').expect(200)).body.total).toBe(0);
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

  it('S-1 M14 合同也经过 SealService（兜底）：轮次没开过标的合同列表金额为 null、详情 QUOTE_SEALED、报价附件不能经合同访问', async () => {
    // 合同只在定标时生成，所属轮次一定开过标；正常流程造不出这种合同，直接写库验证兜底
    const version = await ctx.prisma.quoteVersion.findFirstOrThrow({ where: { quoteId: p.quotes[0] } });
    const contract = await ctx.prisma.contract.create({
      data: {
        contractNo: 'CT-SEALED-0001',
        inquiryId: p.inquiry.id,
        roundId: p.roundId,
        quoteId: p.quotes[0],
        quoteVersionId: version.id,
        supplierId: s.a.id,
        amount: '6111.05',
        currency: 'CNY',
        snapshot: {},
        createdById: users.buyer.id,
      },
    });
    try {
      for (const [name, agent] of Object.entries(agents)) {
        const list = (await agent.get('/api/contracts?page=1&pageSize=50').expect(200)).body;
        expect(
          list.items.map((c: { contractNo: string; amount: string | null }) => [c.contractNo, c.amount]),
        ).toEqual([['CT-SEALED-0001', null]]);
        expectNoSecrets(list, `${name} contracts`);
        expect((await agent.get(`/api/contracts/${contract.id}`).expect(403)).body.code).toBe('QUOTE_SEALED');
      }
      // 采购员、主管有 contract:view：合同的文件解析器照样拒绝中标版本的报价附件
      for (const agent of [agents.buyer, agents.manager]) {
        expect((await agent.get(`/api/files/${attachmentId}/content`).expect(403)).body.code).toBe(
          'FILE_ACCESS_DENIED',
        );
      }
    } finally {
      await ctx.prisma.contract.delete({ where: { id: contract.id } });
    }
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
    const matrix: RoundMatrixDto = (await agents.buyer.get(`${roundUrl()}/matrix`).expect(200)).body;
    expect(matrix.suppliers.map((r) => [r.supplier.code, r.totalAmount, r.lowestTotal])).toEqual([
      ['TS-A', '6111.05', true],
      ['TS-B', '7777.70', false],
      ['TS-C', null, false],
    ]);
    await agents.buyer.get(`${roundUrl()}/matrix/export`).expect(200);
    await agents.buyer.get(`/api/quotes/${p.quotes[0]}/negotiation`).expect(200);
    // 管理员没有 inquiry:evaluate、quote.amount：响应列表的合计被脱敏，报价详情与附件仍是 403
    const adminList = await responses(agents.admin);
    expect(adminList.sealed).toBe(false);
    expect(adminList.items[0]).toMatchObject({ totalAmount: null, maskedFields: ['totalAmount'] });
    expectNoSecrets(adminList, 'admin responses');
    expect((await agents.admin.get(quoteUrl(0)).expect(403)).body.code).toBe('FORBIDDEN');
    await agents.admin.get(`/api/files/${attachmentId}/content`).expect(403);

    // M15 报表：开标后有金额，物流明细出现本轮；管理员没有 quote.amount，金额与运费为 null
    const report: Paginated<InquiryReportRowDto> = (
      await agents.buyer.get('/api/reports/inquiries').expect(200)
    ).body;
    expect(report.items.find((r) => r.roundId === p.roundId)).toMatchObject({
      sealed: false,
      minTotal: '6111.05',
      maxTotal: '7777.70',
      avgTotal: '6944.38',
    });
    const logistics: LogisticsReportDto = (await agents.buyer.get('/api/reports/logistics').expect(200)).body;
    expect(logistics.items.map((r) => [r.supplier.code, r.lineNo])).toEqual([
      ['TS-A', 1],
      ['TS-A', 2],
      ['TS-B', 1],
      ['TS-B', 2],
    ]);
    const adminReport: Paginated<InquiryReportRowDto> = (
      await agents.admin.get('/api/reports/inquiries').expect(200)
    ).body;
    expect(adminReport.items[0]).toMatchObject({
      sealed: false,
      minTotal: null,
      maskedFields: ['minTotal', 'maxTotal', 'avgTotal'],
    });
    expectNoSecrets(adminReport, 'admin report');
    expectNoSecrets(await xlsxText(agents.admin, '/api/reports/inquiries/export'), 'admin report export');
    const supplierQuotes: Paginated<SupplierQuoteItemDto> = (
      await agents.buyer.get(`/api/suppliers/${s.a.id}/quotes`).expect(200)
    ).body;
    expect(supplierQuotes.items[0]).toMatchObject({ sealed: false, totalAmount: '6111.05' });

    expectNoSecrets(
      (await agents.buyer.get(`/api/inquiries/${p.inquiry.id}/timeline`).expect(200)).body,
      'timeline',
    );
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
    await agents.manager
      .post(`/api/inquiries/${never.inquiry.id}/cancel`)
      .send({ reason: '需求取消' })
      .expect(200);
    const url = `/api/inquiries/${never.inquiry.id}/rounds/1`;
    expect((await agents.manager.get(`${url}/quotes/${never.quotes[0]}`).expect(403)).body.code).toBe(
      'QUOTE_SEALED',
    );
    expect((await agents.manager.get(`${url}/matrix`).expect(403)).body.code).toBe('QUOTE_SEALED');
    expect((await agents.manager.get(`${url}/matrix/export`).expect(403)).body.code).toBe('QUOTE_SEALED');
    const list: RoundResponsesDto = (await agents.manager.get(`${url}/responses`).expect(200)).body;
    expect(list).toMatchObject({ sealed: true, items: [{ status: 'VOID' }] });
    expect(list.items[0]).not.toHaveProperty('totalAmount');
    const report: Paginated<InquiryReportRowDto> = (
      await agents.manager.get('/api/reports/inquiries').expect(200)
    ).body;
    const neverRow = report.items.find((r) => r.inquiry.id === never.inquiry.id);
    expect(neverRow).toMatchObject({
      roundStatus: 'CANCELLED',
      sealed: true,
      quotedCount: 1,
      minTotal: null,
    });
    expectNoSecrets(neverRow, 'report of a cancelled round');
    const logistics: LogisticsReportDto = (await agents.manager.get('/api/reports/logistics').expect(200))
      .body;
    expect(logistics.items.some((r) => r.inquiry.id === never.inquiry.id)).toBe(false);

    // 上一张开过标的询价取消后：报价作废，内容和合计照样能看
    await agents.manager
      .post(`/api/inquiries/${p.inquiry.id}/cancel`)
      .send({ reason: '改用其他方案' })
      .expect(200);
    const opened = await responses(agents.buyer);
    expect(opened.sealed).toBe(false);
    expect(opened.items[0]).toMatchObject({ status: 'VOID', totalAmount: '6111.05' });
    await agents.buyer.get(quoteUrl(0)).expect(200);
    // R11-1 开标后才取消的轮次照样能看比价，但不能再入围
    const matrix: RoundMatrixDto = (await agents.buyer.get(`${roundUrl()}/matrix`).expect(200)).body;
    expect(matrix).toMatchObject({ roundStatus: 'CANCELLED', canShortlist: false });
    expect(matrix.suppliers[0]).toMatchObject({ status: 'VOID', quoted: true, totalAmount: '6111.05' });
    const cancelled = (await agents.buyer.get(`/api/inquiries/${p.inquiry.id}`).expect(200)).body;
    expect(cancelled.allowedActions).toEqual(expect.arrayContaining(['evaluate', 'exportMatrix']));
    expect(cancelled.allowedActions).not.toContain('shortlist');
  });

  it('S-4 R13-5 从未开标就被规格变更作废的轮次永久密封；开过标再变更的旧轮次照样能看', async () => {
    ctx.clock.set(at(8 * HOUR));
    const change = async (id: string, deadline: Date) => {
      await agents.buyer
        .post(`/api/inquiries/${id}/rounds`)
        .send({ changeReason: '显色指数 Ra80 → Ra90', changeSummary: '全部改为 Ra90' })
        .expect(201);
      await agents.buyer
        .post(`/api/inquiries/${id}/rounds/2/publish`)
        .send({ deadline: deadline.toISOString() })
        .expect(200);
    };
    const never = await publishLedInquiry(
      ctx.prisma,
      agents.buyer,
      agents.manager,
      category['LED-2835'],
      [s.a.id, s.b.id],
      at(10 * HOUR),
      '变更前未开标',
    );
    await submitQuote(portal.a, never.quotes[0], ledLines(never, '3.3333', '5.5555'), {
      remark: '甲机密备注',
    });
    await change(never.inquiry.id, at(11 * HOUR));
    const base = `/api/inquiries/${never.inquiry.id}`;
    const url = `${base}/rounds/1`;
    for (const [name, agent] of [
      ['buyer', agents.buyer],
      ['manager', agents.manager],
    ] as const) {
      for (const path of [
        `${url}/quotes/${never.quotes[0]}`,
        `${url}/quotes/${never.quotes[0]}/versions/1`,
        `${url}/matrix`,
        `${url}/matrix/export`,
        `/api/quotes/${never.quotes[0]}/negotiation`,
      ]) {
        expect((await agent.get(path).expect(403)).body.code).toBe('QUOTE_SEALED');
      }
      const list: RoundResponsesDto = (await agent.get(`${url}/responses`).expect(200)).body;
      expect(list).toMatchObject({ sealed: true, items: [{ status: 'VOID' }, { status: 'VOID' }] });
      expect(list.items[0]).not.toHaveProperty('totalAmount');
      for (const page of [
        base,
        `${base}/rounds`,
        url,
        `${base}/rounds/2`,
        `${base}/rounds/2/diff`,
        `${base}/timeline`,
      ]) {
        expectNoSecrets((await agent.get(page).expect(200)).body, `${name} ${page}`);
      }
    }
    // 变更通知等邮件里也没有
    const emails = await ctx.prisma.emailMessage.findMany({ where: { inquiryId: never.inquiry.id } });
    expect(emails.some((e) => e.type === 'CHANGE')).toBe(true);
    for (const e of emails) expectNoSecrets([e.subject, e.html, e.text], `email ${e.id}`);
    // S-6 供应商自己照样能看旧轮次的全部报价（P-4）
    const own = (await portal.a.get(`/api/portal/quotes/${never.quotes[0]}`).expect(200)).body;
    expect(own).toMatchObject({ status: 'VOID', currentVersion: { remark: '甲机密备注' } });

    // 开过标之后才变更：旧轮次的报价和比价照样能看（只读）
    const opened = await publishLedInquiry(
      ctx.prisma,
      agents.buyer,
      agents.manager,
      category['LED-2835'],
      [s.a.id],
      at(9 * HOUR),
      '开标后变更',
    );
    await submitQuote(portal.a, opened.quotes[0], ledLines(opened, '1.1', '2.2'));
    ctx.clock.set(at(9 * HOUR));
    await ctx.app.get(RoundDeadlineJob).run();
    await agents.manager.post(`/api/inquiries/${opened.inquiry.id}/rounds/1/open`).expect(200);
    await change(opened.inquiry.id, at(11 * HOUR));
    const old = `/api/inquiries/${opened.inquiry.id}/rounds/1`;
    const detail: RoundQuoteDetailDto = (
      await agents.buyer.get(`${old}/quotes/${opened.quotes[0]}`).expect(200)
    ).body;
    expect(detail).toMatchObject({ status: 'VOID', currentVersion: { totalAmount: '2200.00' } });
    const matrix: RoundMatrixDto = (await agents.buyer.get(`${old}/matrix`).expect(200)).body;
    expect(matrix).toMatchObject({ roundStatus: 'SUPERSEDED', canShortlist: false });
    const list: RoundResponsesDto = (await agents.buyer.get(`${old}/responses`).expect(200)).body;
    expect(list).toMatchObject({ sealed: false, items: [{ status: 'VOID', totalAmount: '2200.00' }] });
  });
});
