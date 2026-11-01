import type {
  FileAccessLogDto,
  InquiryDetailDto,
  PortalQuoteDetailDto,
  PortalQuoteListItemDto,
  QuoteResponseDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { RoundStateService } from '../src/modules/inquiries/round-state.service';
import { Agent, anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase, TEST_PASSWORD } from './helpers/fixtures';
import { addManualLine, createDraftInquiry, publishRound } from './helpers/inquiries';
import { ledValues, submitQuote } from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';
import { binaryParser } from './helpers/xlsx';

const HOUR = 3600_000;
const START = new Date('2026-11-02T01:00:00.000Z');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PROJECT_NO = 'PJ-SECRET-008';
const LINE_REMARK = '内部：目标价 0.15';

/**
 * 门户响应里不能出现的键（05 §7.2 P-5、R08-7）。询价行的内部备注另外按"询价行上没有 remark"检查：
 * M09 起供应商自己报价的备注（版本、草稿的 remark）是可以返回的
 */
const FORBIDDEN_KEYS = [
  'projectNo',
  'draftNo',
  'approvals',
  'lastRejectComment',
  'departmentCode',
  'ownerId',
  'createdBy',
  'createdById',
  'pdUser',
  'pdUserId',
  'approvedBy',
  'draftValues',
  'invitees',
  'categoryCode',
  'supplierId',
];

function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

describe('M08 供应商门户与隔离', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let buyer: Agent;
  let buyer2: Agent;
  let manager: Agent;
  let pd: Agent;
  let admin: Agent;
  /** 供应商 A、B 的门户账号 */
  let portalA: Agent;
  let portalB: Agent;
  let s: Record<'a' | 'b', Supplier>;
  let category: Record<string, string>;
  /** X 只邀请 A，Y 只邀请 B；另有一张没发布的草稿 Z（只用到它的附件） */
  let x: InquiryDetailDto;
  let y: InquiryDetailDto;
  /** X 的整单规格书和第 1 行产品图、Y 的规格书、Z 的规格书 */
  let files: Record<'xSpec' | 'xImage' | 'ySpec' | 'zSpec', string>;

  const upload = async (agent: Agent, kind: string, content: Buffer, name: string): Promise<string> =>
    (await agent.post('/api/files').field('kind', kind).attach('file', content, name).expect(201)).body.id;

  /** 草稿：一行（带内部备注）+ 整单规格书（+ 第 1 行产品图） */
  async function draftWithFiles(title: string, withImage: boolean) {
    const draft = await createDraftInquiry(buyer, category['LED-2835'], { title, projectNo: PROJECT_NO });
    const line = await addManualLine(buyer, draft.id, category['LED-2835'], { remark: LINE_REMARK });
    const spec = await upload(buyer, 'SPEC_DOC', PDF, `${title}-规格书.pdf`);
    await buyer
      .post(`/api/inquiries/${draft.id}/rounds/1/files`)
      .send({ fileId: spec, kind: 'SPEC_DOC' })
      .expect(201);
    let image: string | null = null;
    if (withImage) {
      image = await upload(buyer, 'PRODUCT_IMAGE', PNG, `${title}.png`);
      await buyer
        .post(`/api/inquiries/${draft.id}/rounds/1/files`)
        .send({ fileId: image, kind: 'PRODUCT_IMAGE', lineId: line.id })
        .expect(201);
    }
    return { draft, spec, image };
  }

  async function approve(id: string): Promise<void> {
    await buyer.post(`/api/inquiries/${id}/submit`).expect(200);
    await manager.post(`/api/inquiries/${id}/approve`).send({}).expect(200);
  }

  async function quoteOf(inquiryId: string, supplier: Supplier) {
    return ctx.prisma.quote.findFirstOrThrow({ where: { round: { inquiryId }, supplierId: supplier.id } });
  }

  const content = (agent: Agent, fileId: string, disposition: 'inline' | 'attachment', status: number) =>
    agent.get(`/api/files/${fileId}/content`).query({ disposition }).expect(status);

  async function list(agent: Agent, query: Record<string, string> = {}): Promise<PortalQuoteListItemDto[]> {
    return (await agent.get('/api/portal/quotes').query(query).expect(200)).body.items;
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
      buyer: await mk('buyer', { roles: ['BUYER'], name: '采购张三', email: 'buyer@example.com' }),
      buyer2: await mk('buyer2', { roles: ['BUYER'] }),
      manager: await mk('manager', { roles: ['PURCHASE_MANAGER'] }),
      pd: await mk('pd', { roles: ['PD'] }),
      admin: await mk('admin', { roles: ['ADMIN'] }),
    };
    s = {
      a: await createSupplier(ctx.prisma, { code: 'TS-A', nameZh: '供应商甲' }),
      b: await createSupplier(ctx.prisma, { code: 'TS-B', nameZh: '供应商乙' }),
    };
    const account = (supplier: Supplier, username: string) =>
      createUser(ctx.prisma, {
        username,
        name: `${supplier.nameZh}业务员`,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: supplier.id,
      });
    users.portalA = await account(s.a, 'a@supplier.example.com');
    users.portalB = await account(s.b, 'b@supplier.example.com');

    buyer = await loginAs(ctx, users.buyer);
    buyer2 = await loginAs(ctx, users.buyer2);
    manager = await loginAs(ctx, users.manager);
    pd = await loginAs(ctx, users.pd);
    admin = await loginAs(ctx, users.admin);
    portalA = await loginAs(ctx, users.portalA);
    portalB = await loginAs(ctx, users.portalB);

    const deadline = new Date(START.getTime() + 72 * HOUR);
    const dx = await draftWithFiles('询价甲', true);
    await approve(dx.draft.id);
    x = await publishRound(buyer, dx.draft.id, [s.a.id], deadline);
    const dy = await draftWithFiles('询价乙', false);
    await approve(dy.draft.id);
    y = await publishRound(buyer, dy.draft.id, [s.b.id], deadline);
    const dz = await draftWithFiles('询价丙', false);
    files = { xSpec: dx.spec, xImage: dx.image!, ySpec: dy.spec, zSpec: dz.spec };
  });

  beforeEach(() => ctx.clock.set(START));

  afterAll(async () => {
    await ctx.close();
  });

  it('R08-1 P-1 P-2 列表只含本供应商、已发布的报价单；按页签和关键字筛选', async () => {
    const itemsA = await list(portalA);
    expect(itemsA.map((q) => q.inquiry.title)).toEqual(['询价甲']);
    expect(itemsA[0]).toMatchObject({
      inquiry: { formalNo: x.formalNo, title: '询价甲', currency: 'CNY' },
      roundNo: 1,
      roundStatus: 'WAITING_QUOTES',
      status: 'INVITED',
      deadline: new Date(START.getTime() + 72 * HOUR).toISOString(),
    });
    expect((await list(portalB)).map((q) => q.inquiry.title)).toEqual(['询价乙']);
    expect(await list(portalA, { tab: 'pending' })).toHaveLength(1);
    expect(await list(portalA, { tab: 'evaluating' })).toHaveLength(0);
    expect(await list(portalA, { keyword: x.formalNo!.toLowerCase() })).toHaveLength(1);
    expect(await list(portalA, { keyword: '询价乙' })).toHaveLength(0);
    // 项目号不参与门户搜索（P-5）
    expect(await list(portalA, { keyword: PROJECT_NO })).toHaveLength(0);
    for (const key of FORBIDDEN_KEYS) expect(keysOf(itemsA).has(key)).toBe(false);
  });

  it('R08-5 别家的报价单、不存在的报价单都是 404', async () => {
    const quoteB = await quoteOf(y.id, s.b);
    await portalA.get(`/api/portal/quotes/${quoteB.id}`).expect(404);
    await portalA.get('/api/portal/quotes/no-such-quote').expect(404);
    await portalB.get(`/api/portal/quotes/${quoteB.id}`).expect(200);
  });

  it('R08-7 P-5 详情：询价信息、采购联系人、询价行与附件；没有项目号、草稿号、审批记录、内部备注', async () => {
    const quote = await quoteOf(x.id, s.a);
    const res = await portalA.get(`/api/portal/quotes/${quote.id}`).expect(200);
    const detail: PortalQuoteDetailDto = res.body;
    expect(detail).toMatchObject({
      id: quote.id,
      status: 'INVITED',
      inquiry: {
        formalNo: x.formalNo,
        title: '询价甲',
        currency: 'CNY',
        buyer: { name: '采购张三', email: 'buyer@example.com' },
        cancelledAt: null,
        cancelReason: null,
      },
      round: { roundNo: 1, status: 'WAITING_QUOTES', pplTemplateVersion: 1, pplVariantCode: 'PPL-LED' },
      allowedActions: ['saveDraft', 'submit', 'decline', 'downloadTemplate', 'importExcel'],
    });
    expect(detail.lines).toHaveLength(1);
    for (const line of detail.lines) expect(line).not.toHaveProperty('remark');
    expect(detail.lines[0]).toMatchObject({ lineNo: 1, nameZh: '手工物料', quantity: '100' });
    expect(detail.lines[0].files.map((f) => f.file.id)).toEqual([files.xImage]);
    expect(detail.files.map((f) => f.file.id)).toEqual([files.xSpec]);

    const keys = keysOf(res.body);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key)).toBe(false);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(PROJECT_NO);
    expect(text).not.toContain(x.draftNo);
    expect(text).not.toContain(LINE_REMARK);
    expect(text).not.toContain(s.b.nameZh);
  });

  it('R08-2 首次查看只写一次，采购方在供应商响应里看到', async () => {
    const quote = await quoteOf(x.id, s.a);
    await ctx.prisma.quote.update({ where: { id: quote.id }, data: { firstViewedAt: null } });
    ctx.clock.set(new Date(START.getTime() + HOUR));
    const first = (await portalA.get(`/api/portal/quotes/${quote.id}`).expect(200))
      .body as PortalQuoteDetailDto;
    expect(first.firstViewedAt).toBe(new Date(START.getTime() + HOUR).toISOString());
    ctx.clock.set(new Date(START.getTime() + 2 * HOUR));
    const second = (await portalA.get(`/api/portal/quotes/${quote.id}`).expect(200))
      .body as PortalQuoteDetailDto;
    expect(second.firstViewedAt).toBe(first.firstViewedAt);
    const responses: QuoteResponseDto[] = (
      await buyer.get(`/api/inquiries/${x.id}/rounds/1/responses`).expect(200)
    ).body.items;
    expect(responses[0].firstViewedAt).toBe(first.firstViewedAt);
  });

  it('R08-5 P-3 只能访问自己受邀轮次的附件：别家询价、没发布的询价的附件都是 403', async () => {
    await content(portalA, files.xSpec, 'inline', 200);
    await content(portalA, files.xImage, 'attachment', 200);
    let res = await content(portalA, files.ySpec, 'attachment', 403);
    expect(res.body.code).toBe('FILE_ACCESS_DENIED');
    res = await content(portalA, files.zSpec, 'inline', 403);
    expect(res.body.code).toBe('FILE_ACCESS_DENIED');
    await portalA.get(`/api/files/${files.ySpec}/meta`).expect(403);
    await content(portalB, files.xSpec, 'inline', 403);
  });

  it('R08-3 R08-4 预览和下载各写一条日志（带供应商和询价单），内部用户的访问也记；采购方能查到', async () => {
    await ctx.prisma.fileAccessLog.deleteMany({});
    await content(portalA, files.xSpec, 'inline', 200);
    await content(portalA, files.xImage, 'attachment', 200);
    await content(buyer, files.xSpec, 'attachment', 200);
    // 被拒绝的访问不记
    await content(portalA, files.ySpec, 'attachment', 403);
    // 内部页面自动加载的缩略图不记；供应商带上同样的参数照样记
    await buyer
      .get(`/api/files/${files.xImage}/content`)
      .query({ disposition: 'inline', thumbnail: 'true' })
      .expect(200);
    expect(await ctx.prisma.fileAccessLog.count()).toBe(3);
    await portalA
      .get(`/api/files/${files.xImage}/content`)
      .query({ disposition: 'inline', thumbnail: 'true' })
      .expect(200);
    expect(await ctx.prisma.fileAccessLog.count()).toBe(4);
    await ctx.prisma.fileAccessLog.deleteMany({ where: { fileId: files.xImage, action: 'PREVIEW' } });

    const logs = await ctx.prisma.fileAccessLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => [l.fileId, l.action, l.supplierId, l.inquiryId, l.userId])).toEqual([
      [files.xSpec, 'PREVIEW', s.a.id, x.id, users.portalA.id],
      [files.xImage, 'DOWNLOAD', s.a.id, x.id, users.portalA.id],
      [files.xSpec, 'DOWNLOAD', null, x.id, users.buyer.id],
    ]);

    const page = (await buyer.get(`/api/inquiries/${x.id}/file-access-logs`).expect(200)).body;
    expect(page.total).toBe(3);
    const items: FileAccessLogDto[] = page.items;
    // 新的在前
    expect(items.map((l) => [l.action, l.supplier?.code ?? null, l.user?.name])).toEqual([
      ['DOWNLOAD', null, '采购张三'],
      ['DOWNLOAD', 'TS-A', '供应商甲业务员'],
      ['PREVIEW', 'TS-A', '供应商甲业务员'],
    ]);
    expect(items[2].file).toEqual({ id: files.xSpec, originalName: '询价甲-规格书.pdf' });
    expect((await buyer.get(`/api/inquiries/${y.id}/file-access-logs`).expect(200)).body.total).toBe(0);

    // 需要 inquiry:accessLog；数据权限外 404
    await pd.get(`/api/inquiries/${x.id}/file-access-logs`).expect(403);
    await admin.get(`/api/inquiries/${x.id}/file-access-logs`).expect(403);
    await buyer2.get(`/api/inquiries/${x.id}/file-access-logs`).expect(404);
    expect((await buyer.get(`/api/inquiries/${x.id}`).expect(200)).body.allowedActions).toContain(
      'viewAccessLog',
    );
  });

  it('R08-5 供应商访问内部接口一律 403，内部用户访问门户接口也 403', async () => {
    for (const path of [
      '/api/inquiries',
      `/api/inquiries/${x.id}`,
      `/api/inquiries/${x.id}/rounds/1/responses`,
      `/api/inquiries/${x.id}/file-access-logs`,
      `/api/inquiries/${x.id}/rounds/1/matrix`,
      `/api/inquiries/${x.id}/rounds/1/matrix/export`,
      `/api/quotes/${(await quoteOf(x.id, s.a)).id}/negotiation`,
      '/api/suppliers',
      '/api/system/users',
      '/api/system/emails',
      '/api/workbench',
    ]) {
      await portalA.get(path).expect(403);
    }
    await portalA.put(`/api/inquiries/${x.id}/rounds/1/shortlist`).send({ quoteIds: [] }).expect(403);
    await buyer.get('/api/portal/quotes').expect(403);
    await buyer.get('/api/portal/profile').expect(403);
    await buyer.get('/api/portal/workbench').expect(403);
  });

  it('M16 门户工作台只有本供应商的报价单，不含内部信息', async () => {
    const body = (await portalA.get('/api/portal/workbench').expect(200)).body;
    const keys = keysOf(body);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key)).toBe(false);
    expect(JSON.stringify(body)).not.toContain(PROJECT_NO);
    const ids = [...body.pendingQuotes.items, ...body.negotiations.items, ...body.recentResults.items].map(
      (q: { id: string }) => q.id,
    );
    expect(ids).toContain((await quoteOf(x.id, s.a)).id);
    expect(await ctx.prisma.quote.count({ where: { id: { in: ids }, supplierId: { not: s.a.id } } })).toBe(0);
  });

  it('M11 议价接口同样隔离：别家的报价单 404，内部用户 403；门户的议价线程不含内部信息', async () => {
    const quoteA = await quoteOf(x.id, s.a);
    const url = `/api/portal/quotes/${quoteA.id}/negotiation`;
    const res = await portalA.get(url).expect(200);
    expect(res.body).toMatchObject({ quoteId: quoteA.id, status: null, messages: [], allowedActions: [] });
    const keys = keysOf(res.body);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key)).toBe(false);
    for (const l of res.body.lines) expect(l).not.toHaveProperty('remark');
    expect(JSON.stringify(res.body)).not.toContain(LINE_REMARK);
    await portalB.get(url).expect(404);
    await portalB.post(`${url}/respond`).send({ type: 'ACCEPT', replyToId: 'x' }).expect(404);
    await buyer.get(url).expect(403);
    await manager.post(`${url}/respond`).send({ type: 'ACCEPT', replyToId: 'x' }).expect(403);
  });

  it('M09 报价填报接口同样隔离：别家的报价单一律 404，内部用户 403；带草稿和版本的详情仍不含内部信息', async () => {
    const quoteA = await quoteOf(x.id, s.a);
    const line = await ctx.prisma.inquiryLine.findFirstOrThrow({ where: { round: { inquiryId: x.id } } });
    const lines = { [line.id]: ledValues() };
    const url = `/api/portal/quotes/${quoteA.id}`;
    await submitQuote(portalA, quoteA.id, lines, { remark: '我方备注' });
    await portalA.put(`${url}/draft`).send({ lines, changeNote: '准备降价' }).expect(200);
    await portalA.get(`${url}/excel-template`).buffer(true).parse(binaryParser).expect(200);

    const tries = [
      await portalB.put(`${url}/draft`).send({ lines: {} }),
      await portalB.post(`${url}/submit`).send({ lines }),
      await portalB.post(`${url}/decline`).send({ reasonCode: 'OTHER', reason: '试试' }),
      await portalB.get(`${url}/versions`),
      await portalB.get(`${url}/versions/1`),
      await portalB.get(`${url}/excel-template`),
      await portalB.post(`${url}/excel-import`).attach('file', Buffer.from('x'), 'quote.xlsx'),
    ];
    for (const res of tries) expect(res.status).toBe(404);
    await buyer.put(`${url}/draft`).send({ lines: {} }).expect(403);
    await manager.get(`${url}/versions/1`).expect(403);

    const res = await portalA.get(url).expect(200);
    const detail = res.body as PortalQuoteDetailDto;
    expect(detail.draft).toMatchObject({ changeNote: '准备降价' });
    expect(detail.currentVersion).toMatchObject({ versionNo: 1, remark: '我方备注' });
    const keys = keysOf(res.body);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key)).toBe(false);
    for (const l of detail.lines) expect(l).not.toHaveProperty('remark');
    const text = JSON.stringify(res.body);
    for (const secret of [PROJECT_NO, x.draftNo, LINE_REMARK, s.b.nameZh, s.b.code])
      expect(text).not.toContain(secret);
  });

  it('企业资料只读：本供应商的资料，不含供应商分类、内部备注、状态', async () => {
    await ctx.prisma.supplier.update({ where: { id: s.a.id }, data: { remark: '内部：付款慢' } });
    const res = await portalA.get('/api/portal/profile').expect(200);
    expect(res.body).toMatchObject({ code: 'TS-A', nameZh: '供应商甲', contactEmail: s.a.contactEmail });
    for (const key of ['categoryCode', 'remark', 'status', 'id']) expect(res.body).not.toHaveProperty(key);
    expect(JSON.stringify(res.body)).not.toContain('付款慢');
  });

  it('R08-6 P-4 询价取消后报价单作废，供应商仍能只读查看并下载规格', async () => {
    const draft = await draftWithFiles('询价丁', false);
    await approve(draft.draft.id);
    const w = await publishRound(buyer, draft.draft.id, [s.a.id], new Date(START.getTime() + 72 * HOUR));
    await manager.post(`/api/inquiries/${w.id}/cancel`).send({ reason: '项目暂停' }).expect(200);
    const quote = await quoteOf(w.id, s.a);
    const detail = (await portalA.get(`/api/portal/quotes/${quote.id}`).expect(200))
      .body as PortalQuoteDetailDto;
    expect(detail).toMatchObject({
      status: 'VOID',
      round: { status: 'CANCELLED' },
      inquiry: { cancelReason: '项目暂停' },
      // 作废的报价单打开时不写首次查看（05 §4）
      firstViewedAt: null,
    });
    await content(portalA, draft.spec, 'attachment', 200);
    const closed = await list(portalA, { tab: 'closed' });
    expect(closed.map((q) => q.id)).toContain(quote.id);
    expect((await list(portalA, { tab: 'pending' })).map((q) => q.id)).not.toContain(quote.id);
  });

  it('R08-1 报价完成后进入"评标中"页签', async () => {
    const state = ctx.app.get(RoundStateService);
    const round = await ctx.prisma.inquiryRound.findFirstOrThrow({ where: { inquiryId: y.id } });
    await ctx.prisma.$transaction((tx) => state.apply(tx, round.id, 'close'));
    expect((await list(portalB, { tab: 'evaluating' })).map((q) => q.inquiry.title)).toEqual(['询价乙']);
    expect(await list(portalB, { tab: 'pending' })).toHaveLength(0);
  });

  it('P-6 供应商停用后会话立即失效，也不能再登录', async () => {
    const agent = await loginAs(ctx, users.portalB);
    await agent.get('/api/portal/quotes').expect(200);
    await buyer.put(`/api/suppliers/${s.b.id}/status`).send({ status: 'DISABLED' }).expect(200);
    await agent.get('/api/portal/quotes').expect(401);
    const res = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: users.portalB.username, password: TEST_PASSWORD })
      .expect(403);
    expect(res.body.code).toBe('AUTH_ACCOUNT_DISABLED');
  });
});
