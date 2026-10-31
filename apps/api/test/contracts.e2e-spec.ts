import type { ContractDetailDto, ContractListItemDto, Paginated } from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { ledLines, openRound, publishLedInquiry, submitQuote, type PublishedLed } from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
const START = new Date('2026-12-20T01:00:00.000Z');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
const FIELDS = { deliveryDate: '2027-01-15', deliveryPlace: '深圳宝安工厂', paymentTerms: '货到验收后 30 天付款' };

/**
 * M14 合同管理：甲乙报价、开标，采购主管定标给甲生成合同草稿（甲 1.2 × 1000 + 4.6 × 500 = 3500.00）。
 * 采购员补充条款提交 → 审核驳回 → 再提交 → 审核通过 → 批准驳回 → 再提交 → 审核通过 → 批准 → 上传签字扫描件
 */
describe('M14 合同管理', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  const agents = {} as Record<'buyer' | 'buyer2' | 'manager' | 'approver' | 'admin' | 'deptReviewer' | 'a', Agent>;
  let s: Record<'a' | 'b', Supplier>;
  let p: PublishedLed;
  let id: string;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const url = () => `/api/contracts/${id}`;
  const detail = async (agent: Agent = agents.buyer): Promise<ContractDetailDto> =>
    (await agent.get(url()).expect(200)).body;
  const upload = async (agent: Agent, file: Buffer, name: string, kind = 'ATTACHMENT') =>
    (await agent.post('/api/files').field('kind', kind).attach('file', file, name).expect(201)).body.id as string;
  const mails = (subjectPrefix: string) =>
    ctx.prisma.emailMessage.findMany({
      where: { subject: { startsWith: subjectPrefix } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(START);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    // 另一个部门、按部门看数据的审核人：数据权限覆盖不到这张单，收不到审核请求（R14-5）
    await ctx.prisma.role.create({
      data: {
        code: 'DEPT_REVIEWER',
        nameZh: '部门合同审核',
        nameEn: 'Department reviewer',
        dataScope: 'DEPT',
        permissions: ['contract:view', 'contract:review'],
        fieldPermissions: ['contract.amount'],
      },
    });
    const category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    const mk = (key: string, roles: string[], extra: Record<string, unknown> = {}) =>
      createUser(ctx.prisma, { username: key, name: key, roles, email: `${key}@example.com`, ...extra });
    users = {
      buyer: await mk('buyer', ['BUYER']),
      buyer2: await mk('buyer2', ['BUYER']),
      manager: await mk('manager', ['PURCHASE_MANAGER']),
      approver: await mk('approver', ['CONTRACT_APPROVER'], { departmentCode: 'GM' }),
      admin: await mk('admin', ['ADMIN'], { departmentCode: 'IT' }),
      deptReviewer: await mk('deptreviewer', ['DEPT_REVIEWER'], { departmentCode: 'PRODUCT' }),
    };
    s = {
      a: await createSupplier(ctx.prisma, { code: 'TS-A', nameZh: '供应商甲', contactEmail: 'a@s.example.com' }),
      b: await createSupplier(ctx.prisma, { code: 'TS-B', nameZh: '供应商乙', contactEmail: 'b@s.example.com' }),
    };
    users.a = await createUser(ctx.prisma, {
      username: 'a@supplier.example.com',
      roles: ['SUPPLIER'],
      userType: 'SUPPLIER',
      supplierId: s.a.id,
    });
    const portalB = await createUser(ctx.prisma, {
      username: 'b@supplier.example.com',
      roles: ['SUPPLIER'],
      userType: 'SUPPLIER',
      supplierId: s.b.id,
    });
    for (const key of ['buyer', 'buyer2', 'manager', 'approver', 'admin', 'deptReviewer', 'a'] as const) {
      agents[key] = await loginAs(ctx, users[key]);
    }
    p = await publishLedInquiry(
      ctx.prisma,
      agents.buyer,
      agents.manager,
      category['LED-2835'],
      [s.a.id, s.b.id],
      at(6 * HOUR),
      '合同测试询价',
    );
    ctx.clock.set(at(HOUR));
    await submitQuote(agents.a, p.quotes[0], ledLines(p, '1.2', '4.6'));
    await submitQuote(await loginAs(ctx, portalB), p.quotes[1], ledLines(p, '1.3', '4.8'));
    await openRound(ctx, agents.manager, p, at(6 * HOUR));
    ctx.clock.set(at(7 * HOUR));
    const awarded = (
      await agents.manager
        .post(`/api/inquiries/${p.inquiry.id}/rounds/1/award`)
        .send({ quoteId: p.quotes[0] })
        .expect(200)
    ).body;
    id = awarded.award.contract.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R14-7 数据权限跟随询价单；金额按 contract.amount 脱敏（快照同样处理）；供应商看不到合同', async () => {
    const list: Paginated<ContractListItemDto> = (await agents.buyer.get('/api/contracts').expect(200)).body;
    expect(list.items).toEqual([
      expect.objectContaining({
        id,
        contractNo: 'CT-202612-0001',
        status: 'DRAFT',
        inquiry: { id: p.inquiry.id, formalNo: p.inquiry.formalNo, title: '合同测试询价' },
        supplier: { id: s.a.id, code: 'TS-A', nameZh: '供应商甲', nameEn: null },
        amount: '3500.00',
        currency: 'CNY',
        deliveryDate: null,
      }),
    ]);
    const mine = await detail();
    expect(mine).toMatchObject({
      status: 'DRAFT',
      amount: '3500.00',
      createdBy: { id: users.manager.id },
      allowedActions: ['edit', 'submit'],
      snapshot: {
        inquiry: { formalNo: p.inquiry.formalNo, roundNo: 1 },
        supplier: { code: 'TS-A', contactEmail: 'a@s.example.com' },
        quoteVersion: { versionNo: 1, totalAmount: '3500.00' },
      },
      attachments: [],
      signedScan: null,
    });
    expect(mine.snapshot.quoteVersion.values.lines[0].values.unit_price_incl_tax).toBe('1.2000');

    // SELF 的采购员 2 不是负责人：列表里没有，详情 404，也不能改
    expect((await agents.buyer2.get('/api/contracts').expect(200)).body.items).toEqual([]);
    expect((await agents.buyer2.get(url()).expect(404)).body.code).toBe('NOT_FOUND');
    await agents.buyer2.put(url()).send(FIELDS).expect(404);
    // 管理员：能看，没有 contract.amount
    const admin = await detail(agents.admin);
    expect(admin).toMatchObject({ amount: null, allowedActions: [] });
    expect(admin.maskedFields).toContain('amount');
    expect(admin.snapshot.quoteVersion.totalAmount).toBeNull();
    expect(admin.snapshot.quoteVersion.values.lines[0].values).toMatchObject({
      unit_price_incl_tax: null,
      total_price_incl_tax: null,
      lead_time_days: 30,
    });
    expect(JSON.stringify(admin)).not.toMatch(/3500|1\.2000/);
    const adminList: Paginated<ContractListItemDto> = (await agents.admin.get('/api/contracts').expect(200)).body;
    expect(adminList.items[0]).toMatchObject({ amount: null, maskedFields: ['amount'] });
    // 合同批准人：有 contract.amount、没有 supplier.contact
    const approver = await detail(agents.approver);
    expect(approver).toMatchObject({ amount: '3500.00', allowedActions: [] });
    expect(approver.snapshot.supplier).toMatchObject({ contactEmail: null, contactPhone: null });
    expect(approver.maskedFields).toEqual(['contactEmail', 'contactPhone']);
    // 供应商
    expect((await agents.a.get('/api/contracts').expect(403)).body.code).toBe('FORBIDDEN');
    await agents.a.get(url()).expect(403);

    // 筛选：状态、关键字（合同号 / 询价号 / 供应商）
    const query = async (q: string) =>
      ((await agents.buyer.get(`/api/contracts?${q}`).expect(200)).body as Paginated<ContractListItemDto>).total;
    expect(await query('status=DRAFT')).toBe(1);
    expect(await query('status=APPROVED')).toBe(0);
    expect(await query('keyword=ct-202612')).toBe(1);
    expect(await query(`keyword=${p.inquiry.formalNo}`)).toBe(1);
    expect(await query('keyword=TS-A')).toBe(1);
    expect(await query('keyword=供应商乙')).toBe(0);
    expect(await query(`supplierId=${s.b.id}`)).toBe(0);
  });

  it('R14-2 R14-3 只有草稿能编辑；附件只能是自己上传的、最多 20 个；提交时交付日期、地点、付款方式必填', async () => {
    const missing = await agents.buyer.post(`${url()}/submit`).expect(400);
    expect(missing.body).toMatchObject({
      code: 'CONTRACT_FIELDS_REQUIRED',
      params: { fields: ['deliveryDate', 'deliveryPlace', 'paymentTerms'] },
    });
    const mine = await upload(agents.buyer, PDF, '技术协议.pdf');
    const others = await upload(agents.manager, PDF, '别人的.pdf');
    const spec = await upload(agents.buyer, PDF, '规格书.pdf', 'SPEC_DOC');
    const put = (body: Record<string, unknown>) => agents.buyer.put(url()).send(body);
    expect((await put({ attachmentFileIds: [others] }).expect(403)).body.code).toBe('FILE_ACCESS_DENIED');
    expect((await put({ attachmentFileIds: [spec] }).expect(400)).body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const many = Array.from({ length: 21 }, (_, i) => `f${i}`);
    expect((await put({ attachmentFileIds: many }).expect(400)).body).toMatchObject({
      code: 'FILE_LIMIT_EXCEEDED',
      params: { max: 20 },
    });
    expect((await put({ deliveryDate: '2027-02-30' }).expect(400)).body.code).toBe('VALIDATION_FAILED');
    // 扫描件只能在批准后上传
    expect((await agents.buyer.post(`${url()}/signed-scan`).send({ fileId: mine }).expect(409)).body.code).toBe(
      'CONTRACT_INVALID_STATUS',
    );

    const saved: ContractDetailDto = (
      await put({ ...FIELDS, summary: '灯珠年度框架', remark: '分两批交货', attachmentFileIds: [mine] }).expect(200)
    ).body;
    expect(saved).toMatchObject({
      ...FIELDS,
      summary: '灯珠年度框架',
      remark: '分两批交货',
      attachments: [{ id: mine, originalName: '技术协议.pdf' }],
    });
    // 金额、快照不能改（不在 schema 里，忽略）
    await put({ ...FIELDS, attachmentFileIds: [mine], amount: '1' }).expect(200);
    expect((await detail()).amount).toBe('3500.00');
    await agents.buyer.get(`/api/files/${mine}/content`).expect(200);
    await agents.admin.get(`/api/files/${mine}/content`).expect(200);
    await agents.buyer2.get(`/api/files/${mine}/content`).expect(403);
    await agents.a.get(`/api/files/${mine}/content`).expect(403);
  });

  it('R14-1 R14-4 R14-5 全路径：驳回意见必填、每一步都有审批记录、邮件发给对的人；非法动作被拒', async () => {
    const decide = (agent: Agent, step: 'review' | 'approve', body: Record<string, unknown>) =>
      agent.post(`${url()}/${step}`).send(body);
    let d: ContractDetailDto = (await agents.buyer.post(`${url()}/submit`).expect(200)).body;
    expect(d).toMatchObject({ status: 'PENDING_REVIEW', allowedActions: [] });
    expect((await agents.buyer.put(url()).send(FIELDS).expect(409)).body.code).toBe('CONTRACT_INVALID_STATUS');
    expect((await decide(agents.buyer, 'review', { action: 'APPROVE' }).expect(403)).body.code).toBe('FORBIDDEN');
    expect((await decide(agents.approver, 'approve', { action: 'APPROVE' }).expect(409)).body.code).toBe(
      'CONTRACT_INVALID_STATUS',
    );
    expect((await detail(agents.manager)).allowedActions).toEqual(['review']);
    expect((await decide(agents.manager, 'review', { action: 'REJECT' }).expect(400)).body.code).toBe(
      'CONTRACT_COMMENT_REQUIRED',
    );
    d = (await decide(agents.manager, 'review', { action: 'REJECT', comment: '交付地点写详细' }).expect(200)).body;
    expect(d.status).toBe('DRAFT');

    await agents.buyer.put(url()).send({ ...FIELDS, deliveryPlace: '深圳宝安区福永街道 1 号' }).expect(200);
    await agents.buyer.post(`${url()}/submit`).expect(200);
    d = (await decide(agents.manager, 'review', { action: 'APPROVE' }).expect(200)).body;
    expect(d.status).toBe('PENDING_APPROVAL');
    expect((await decide(agents.manager, 'approve', { action: 'APPROVE' }).expect(403)).body.code).toBe('FORBIDDEN');
    expect((await decide(agents.manager, 'review', { action: 'APPROVE' }).expect(409)).body.code).toBe(
      'CONTRACT_INVALID_STATUS',
    );
    expect((await detail(agents.approver)).allowedActions).toEqual(['approve']);
    expect((await decide(agents.approver, 'approve', { action: 'REJECT' }).expect(400)).body.code).toBe(
      'CONTRACT_COMMENT_REQUIRED',
    );
    d = (await decide(agents.approver, 'approve', { action: 'REJECT', comment: '付款方式改为 60 天' }).expect(200))
      .body;
    expect(d.status).toBe('DRAFT');

    ctx.clock.set(at(8 * HOUR));
    await agents.buyer.put(url()).send({ ...FIELDS, paymentTerms: '货到验收后 60 天付款' }).expect(200);
    await agents.buyer.post(`${url()}/submit`).expect(200);
    await decide(agents.manager, 'review', { action: 'APPROVE', comment: '同意' }).expect(200);
    d = (await decide(agents.approver, 'approve', { action: 'APPROVE' }).expect(200)).body;
    expect(d).toMatchObject({ status: 'APPROVED', paymentTerms: '货到验收后 60 天付款' });
    expect((await detail()).allowedActions).toEqual(['uploadSignedScan']);
    expect(d.approvals.map((a) => [a.step, a.action, a.actor.name, a.comment])).toEqual([
      ['SUBMIT', 'SUBMIT', 'buyer', null],
      ['REVIEW', 'REJECT', 'manager', '交付地点写详细'],
      ['SUBMIT', 'SUBMIT', 'buyer', null],
      ['REVIEW', 'APPROVE', 'manager', null],
      ['APPROVE', 'REJECT', 'approver', '付款方式改为 60 天'],
      ['SUBMIT', 'SUBMIT', 'buyer', null],
      ['REVIEW', 'APPROVE', 'manager', '同意'],
      ['APPROVE', 'APPROVE', 'approver', null],
    ]);

    // R14-5：审核请求只给数据权限覆盖该合同的审核人（部门审核人看不到这张单），批准请求给合同批准人，结果给提交人
    const to = async (prefix: string) => (await mails(prefix)).map((m) => m.toAddresses.join(','));
    expect(await to('合同待审核')).toEqual(['manager@example.com', 'manager@example.com', 'manager@example.com']);
    expect(await to('合同待批准')).toEqual(['approver@example.com', 'approver@example.com']);
    expect(await to('合同被驳回')).toEqual(['buyer@example.com', 'buyer@example.com']);
    expect(await to('合同已批准')).toEqual(['buyer@example.com']);
    const rejected = (await mails('合同被驳回'))[1];
    expect(rejected.text).toContain('合同在合同批准环节被 approver 驳回');
    expect(rejected.text).toContain('驳回意见：付款方式改为 60 天');
    expect(rejected.text).toContain(`/contracts/${id}`);
    for (const m of await ctx.prisma.emailMessage.findMany({ where: { subject: { contains: 'CT-202612-0001' } } }))
      expect(`${m.subject}${m.text}${m.html}`).not.toMatch(/3500/);
  });

  it('R14-6 批准后上传签字扫描件（PDF 或图片，可以替换）；扫描件按合同的数据权限访问', async () => {
    const pdf = await upload(agents.buyer, PDF, '签字合同.pdf');
    const doc = await upload(agents.buyer, DOCX, '签字合同.docx');
    expect((await agents.buyer.post(`${url()}/signed-scan`).send({ fileId: doc }).expect(400)).body.code).toBe(
      'FILE_TYPE_NOT_ALLOWED',
    );
    ctx.clock.set(at(9 * HOUR));
    let d: ContractDetailDto = (await agents.buyer.post(`${url()}/signed-scan`).send({ fileId: pdf }).expect(200))
      .body;
    expect(d).toMatchObject({ signedScan: { id: pdf }, signedAt: at(9 * HOUR).toISOString() });
    const png = await upload(agents.buyer, PNG, '签字合同.png');
    ctx.clock.set(at(10 * HOUR));
    d = (await agents.buyer.post(`${url()}/signed-scan`).send({ fileId: png }).expect(200)).body;
    expect(d).toMatchObject({ status: 'APPROVED', signedScan: { id: png }, signedAt: at(10 * HOUR).toISOString() });
    await agents.approver.get(`/api/files/${png}/content`).expect(200);
    await agents.buyer2.get(`/api/files/${png}/content`).expect(403);
    await agents.a.get(`/api/files/${png}/content`).expect(403);
    expect((await agents.manager.post(`${url()}/signed-scan`).send({ fileId: png }).expect(403)).body.code).toBe(
      'FILE_ACCESS_DENIED',
    );
  });

  it('R14-9 合同的每个动作都记审计，不含金额', async () => {
    const logs = await ctx.prisma.auditLog.findMany({
      where: { entityType: 'contract', entityId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const count = (action: string) => logs.filter((l) => l.action === action).length;
    expect([
      count('contract.update'),
      count('contract.submit'),
      count('contract.review'),
      count('contract.approve'),
      count('contract.signedScan'),
    ]).toEqual([4, 3, 3, 2, 2]);
    expect(logs.find((l) => l.action === 'contract.review')).toMatchObject({
      summary: `CT-202612-0001 · ${p.inquiry.formalNo}`,
      detail: { action: 'REJECT', comment: '交付地点写详细' },
    });
    expect(JSON.stringify(logs)).not.toMatch(/3500/);
  });
});
