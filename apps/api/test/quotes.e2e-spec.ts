import {
  PPL_V0,
  type AuditLogDto,
  type PortalQuoteDetailDto,
  type QuoteResponseDto,
  type QuoteVersionDto,
  type QuoteVersionSummaryDto,
  type RoundQuoteDetailDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { FilesService } from '../src/infra/files/files.service';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { addManualLine, createDraftInquiry, publishRound } from './helpers/inquiries';
import {
  columnOf,
  declineQuote,
  editQuoteSheet,
  LED_CELLS,
  ledValues,
  QUOTE_SHEET,
  submitQuote,
} from './helpers/quotes';
import { createTestApp, TestContext } from './helpers/test-app';
import { binaryParser, loadXlsx } from './helpers/xlsx';

const HOUR = 3600_000;
/** 每个用例开始时把测试时钟拨回这里（会话 12 小时过期，用例里前进不超过 12 小时） */
const START = new Date('2026-11-02T01:00:00.000Z');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const ALL_ACTIONS = ['saveDraft', 'submit', 'decline', 'downloadTemplate', 'importExcel'];

type Lines = Record<string, Record<string, unknown>>;

describe('M09 报价填报与版本', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  let buyer: Agent;
  let manager: Agent;
  let admin: Agent;
  /** 三家供应商 A、B、C 各自的门户账号 */
  let portal: Record<'a' | 'b' | 'c', Agent>;
  let s: Record<'a' | 'b' | 'c', Supplier>;
  let category: Record<string, string>;

  const at = (ms: number) => new Date(START.getTime() + ms);
  const base = (quoteId: string) => `/api/portal/quotes/${quoteId}`;

  /** 发布给 A、B、C 的询价：材料类别 LED-2835（冻结 v1 的 PPL-LED，67 列），两行，数量 1000、500 */
  async function published(deadline = at(72 * HOUR)) {
    const draft = await createDraftInquiry(buyer, category['LED-2835'], { title: '灯珠询价' });
    await addManualLine(buyer, draft.id, category['LED-2835'], { nameZh: '灯珠 A', quantity: '1000' });
    await addManualLine(buyer, draft.id, category['LED-2835'], { nameZh: '灯珠 B', quantity: '500' });
    await buyer.post(`/api/inquiries/${draft.id}/submit`).expect(200);
    await manager.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(200);
    const inquiry = await publishRound(buyer, draft.id, [s.a.id, s.b.id, s.c.id], deadline);
    const quotes = await ctx.prisma.quote.findMany({ where: { round: { inquiryId: inquiry.id } } });
    const quoteOf = (supplier: Supplier) => quotes.find((q) => q.supplierId === supplier.id)!.id;
    const lines = await ctx.prisma.inquiryLine.findMany({
      where: { round: { inquiryId: inquiry.id } },
      orderBy: { lineNo: 'asc' },
    });
    return {
      inquiry,
      roundId: quotes[0].roundId,
      a: quoteOf(s.a),
      b: quoteOf(s.b),
      c: quoteOf(s.c),
      l1: lines[0].id,
      l2: lines[1].id,
    };
  }

  /** 两行都填齐必填列：第 1 行含税单价 1.13（× 1000），第 2 行 2.26（× 500），合计 2260.00 */
  function full(
    p: { l1: string; l2: string },
    extra1: Lines[string] = {},
    extra2: Lines[string] = {},
  ): Lines {
    return {
      [p.l1]: ledValues(extra1),
      [p.l2]: ledValues({ unit_price_incl_tax: '2.26', ...extra2 }),
    };
  }

  async function detailOf(agent: Agent, quoteId: string): Promise<PortalQuoteDetailDto> {
    return (await agent.get(base(quoteId)).expect(200)).body;
  }

  async function template(agent: Agent, quoteId: string): Promise<Buffer> {
    return (
      await agent
        .get(`${base(quoteId)}/excel-template`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200)
    ).body as Buffer;
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
    await ctx.prisma.role.create({
      data: {
        code: 'EVAL_NO_AMOUNT',
        nameZh: '评标（无金额）',
        nameEn: 'Evaluator without amounts',
        dataScope: 'ALL',
        permissions: ['inquiry:view', 'inquiry:evaluate'],
        fieldPermissions: [],
      },
    });
    users = {
      buyer: await mk('buyer', { roles: ['BUYER'], name: '采购张三' }),
      manager: await mk('manager', { roles: ['PURCHASE_MANAGER'] }),
      admin: await mk('admin', { roles: ['ADMIN'] }),
      evaluator: await mk('evaluator', { roles: ['EVAL_NO_AMOUNT'] }),
    };
    s = {
      a: await createSupplier(ctx.prisma, { code: 'TS-A', nameZh: '供应商甲' }),
      b: await createSupplier(ctx.prisma, { code: 'TS-B', nameZh: '供应商乙' }),
      c: await createSupplier(ctx.prisma, { code: 'TS-C', nameZh: '供应商丙' }),
    };
    const account = (supplier: Supplier, username: string, name: string) =>
      createUser(ctx.prisma, {
        username,
        name,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: supplier.id,
      });
    users.a = await account(s.a, 'a@supplier.example.com', '甲业务员');
    users.b = await account(s.b, 'b@supplier.example.com', '乙业务员');
    users.c = await account(s.c, 'c@supplier.example.com', '丙业务员');
    buyer = await loginAs(ctx, users.buyer);
    manager = await loginAs(ctx, users.manager);
    admin = await loginAs(ctx, users.admin);
    portal = {
      a: await loginAs(ctx, users.a),
      b: await loginAs(ctx, users.b),
      c: await loginAs(ctx, users.c),
    };
  });

  beforeEach(() => ctx.clock.set(START));

  afterAll(async () => {
    await ctx.close();
  });

  it('R09-2 详情带该轮冻结的模板（激活新版本后不变）、allowedActions；还没有草稿和版本', async () => {
    const p = await published();
    let d = await detailOf(portal.a, p.a);
    expect(d.template).toMatchObject({ version: 1, variantCode: 'PPL-LED' });
    expect(d.template.columns).toHaveLength(67);
    expect(
      d.template.columns
        .filter((c) => c.required)
        .map((c) => c.key)
        .sort(),
    ).toEqual(
      [
        'cct_k',
        'cri_ra',
        'lead_time_days',
        'luminous_flux_lm',
        'power_w',
        'tax_rate',
        'unit_price_incl_tax',
      ].sort(),
    );
    expect(d).toMatchObject({
      draft: null,
      currentVersion: null,
      versionCount: 0,
      allowedActions: ALL_ACTIONS,
    });

    // 激活一个 PPL-LED 多了必填列（品牌）的新版本：已发布的轮次照样用 v1，不填品牌也能提交
    const v2 = {
      ...PPL_V0,
      variants: PPL_V0.variants.map((v) =>
        v.code === 'PPL-LED' ? { ...v, required: [...v.required, 'brand'] } : v,
      ),
    };
    await admin.post('/api/ppl/sets').send({ label: 'v2', definition: v2 }).expect(201);
    await admin.post('/api/ppl/sets/2/activate').expect(200);
    try {
      d = await detailOf(portal.a, p.a);
      expect(d.template.version).toBe(1);
      expect(d.template.columns.find((c) => c.key === 'brand')!.required).toBe(false);
      await submitQuote(portal.a, p.a, full(p));
    } finally {
      await admin.post('/api/ppl/sets/1/activate').expect(200);
    }
  });

  it('R09-3 草稿只校验格式、不校验必填；取值规范化，公式列和未知列不存；source = ONLINE', async () => {
    const p = await published();
    ctx.clock.set(at(HOUR));
    const res = await portal.a
      .put(`${base(p.a)}/draft`)
      .send({
        lines: {
          [p.l1]: {
            unit_price_incl_tax: '1.5',
            tax_rate: 13,
            unit_price_excl_tax: '999',
            certifications: ['CE', 'CE'],
            no_such_key: 'x',
          },
        },
        remark: ' 含运费 ',
      })
      .expect(200);
    const d: PortalQuoteDetailDto = res.body;
    expect(d.status).toBe('INVITED');
    expect(d.draft).toEqual({
      lines: {
        [p.l1]: { unit_price_incl_tax: '1.5000', tax_rate: '13.00', certifications: ['CE'] },
        [p.l2]: {},
      },
      remark: '含运费',
      changeNote: null,
      attachments: [],
      source: 'ONLINE',
      updatedAt: at(HOUR).toISOString(),
    });

    // 格式错误：返回行号与 key（按列顺序），草稿不变
    const bad = await portal.a
      .put(`${base(p.a)}/draft`)
      .send({ lines: { [p.l2]: { unit_price_incl_tax: '1.12345', cct_k: 'abc', payment_terms: 'NOPE' } } })
      .expect(422);
    expect(bad.body).toMatchObject({ code: 'QUOTE_VALUES_INVALID', params: { count: 3 } });
    expect(
      bad.body.details.map((e: { lineNo: number; key: string; code: string }) => [e.lineNo, e.key, e.code]),
    ).toEqual([
      [2, 'cct_k', 'invalid_integer'],
      [2, 'unit_price_incl_tax', 'too_many_decimals'],
      [2, 'payment_terms', 'invalid_option'],
    ]);
    expect((await detailOf(portal.a, p.a)).draft!.lines[p.l1].unit_price_incl_tax).toBe('1.5000');
  });

  it('R09-4 R09-5 提交生成版本：服务端重算公式列（忽略传入值）和合计；再提交是版本 2，respondedAt 只写第一次', async () => {
    const p = await published();
    await portal.a
      .put(`${base(p.a)}/draft`)
      .send({ lines: { [p.l1]: { brand: '草稿' } } })
      .expect(200);
    ctx.clock.set(at(HOUR));
    const d1 = await submitQuote(
      portal.a,
      p.a,
      full(
        p,
        {
          unit_price_excl_tax: '999',
          total_price_incl_tax: '1',
          carton_l_cm: '50',
          carton_w_cm: '40',
          carton_h_cm: '30',
        },
        { total_price_incl_tax: '0.01' },
      ),
      { remark: '含税含运费', changeNote: '首次报价' },
    );
    expect(d1).toMatchObject({
      status: 'SUBMITTED',
      respondedAt: at(HOUR).toISOString(),
      lastSubmittedAt: at(HOUR).toISOString(),
      draft: null,
      versionCount: 1,
      allowedActions: ALL_ACTIONS,
    });
    expect(d1.currentVersion).toMatchObject({
      versionNo: 1,
      source: 'ONLINE',
      totalAmount: '2260.00',
      currency: 'CNY',
      remark: '含税含运费',
      changeNote: '首次报价',
      templateVersion: 1,
      variantCode: 'PPL-LED',
      submittedAt: at(HOUR).toISOString(),
      submittedBy: { name: '甲业务员' },
      attachments: [],
    });
    expect(d1.currentVersion!.lines).toEqual([
      {
        lineId: p.l1,
        lineNo: 1,
        values: expect.objectContaining({
          unit_price_incl_tax: '1.1300',
          tax_rate: '13.00',
          unit_price_excl_tax: '1.0000',
          total_price_incl_tax: '1130.00',
          carton_cbm: '0.0600',
        }),
      },
      {
        lineId: p.l2,
        lineNo: 2,
        values: expect.objectContaining({
          unit_price_incl_tax: '2.2600',
          unit_price_excl_tax: '2.0000',
          total_price_incl_tax: '1130.00',
        }),
      },
    ]);

    ctx.clock.set(at(2 * HOUR));
    const d2 = await submitQuote(portal.a, p.a, full(p, { unit_price_incl_tax: '1.0' }), {
      changeNote: '降价',
    });
    expect(d2).toMatchObject({
      respondedAt: at(HOUR).toISOString(),
      lastSubmittedAt: at(2 * HOUR).toISOString(),
      versionCount: 2,
    });
    expect(d2.currentVersion).toMatchObject({
      versionNo: 2,
      totalAmount: '2130.00',
      changeNote: '降价',
      remark: null,
    });
    const versions: QuoteVersionSummaryDto[] = (await portal.a.get(`${base(p.a)}/versions`).expect(200)).body;
    expect(versions.map((v) => [v.versionNo, v.totalAmount, v.submittedAt])).toEqual([
      [2, '2130.00', at(2 * HOUR).toISOString()],
      [1, '2260.00', at(HOUR).toISOString()],
    ]);
    const v1: QuoteVersionDto = (await portal.a.get(`${base(p.a)}/versions/1`).expect(200)).body;
    expect(v1.lines[0].values.unit_price_incl_tax).toBe('1.1300');
    await portal.a.get(`${base(p.a)}/versions/3`).expect(404);
    const quote = await ctx.prisma.quote.findUniqueOrThrow({
      where: { id: p.a },
      include: { currentVersion: true },
    });
    expect(quote.currentVersion!.versionNo).toBe(2);
  });

  it('R09-4 必填缺失时提交被拒，返回行号和 key，什么都不写', async () => {
    const p = await published();
    const lines = full(p);
    delete lines[p.l2].cct_k;
    const res = await portal.a
      .post(`${base(p.a)}/submit`)
      .send({ lines })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'QUOTE_VALUES_INVALID', params: { count: 1 } });
    expect(res.body.details).toEqual([
      expect.objectContaining({ lineId: p.l2, lineNo: 2, key: 'cct_k', code: 'required' }),
    ]);
    expect(await ctx.prisma.quoteVersion.count({ where: { quoteId: p.a } })).toBe(0);
    expect((await detailOf(portal.a, p.a)).status).toBe('INVITED');
  });

  it('R09-5 同一张报价单并发提交两次：版本号不重复，当前版本是后提交的', async () => {
    const p = await published();
    const [r1, r2] = await Promise.all([
      portal.a.post(`${base(p.a)}/submit`).send({ lines: full(p) }),
      portal.a.post(`${base(p.a)}/submit`).send({ lines: full(p, { unit_price_incl_tax: '1.2' }) }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const versions = await ctx.prisma.quoteVersion.findMany({
      where: { quoteId: p.a },
      orderBy: { versionNo: 'asc' },
    });
    expect(versions.map((v) => v.versionNo)).toEqual([1, 2]);
    expect((await ctx.prisma.quote.findUniqueOrThrow({ where: { id: p.a } })).currentVersionId).toBe(
      versions[1].id,
    );
  });

  it('R09-6 拒绝要选原因并填说明；拒绝后可以重新提交，提交后也能改为拒绝，已拒绝的不能再拒绝', async () => {
    const p = await published();
    const decline = (body: { reasonCode?: string; reason?: string }) =>
      portal.b.post(`${base(p.b)}/decline`).send(body);
    for (const body of [
      { reasonCode: 'LEAD_TIME' },
      { reason: '排产已满' },
      { reasonCode: 'LEAD_TIME', reason: ' ' },
    ]) {
      expect((await decline(body).expect(400)).body.code).toBe('QUOTE_DECLINE_REASON_REQUIRED');
    }
    const res = await decline({ reasonCode: 'NO_SUCH', reason: '排产已满' }).expect(400);
    expect(res.body).toMatchObject({
      code: 'DICT_ITEM_INVALID',
      params: { type: 'decline_reason', code: 'NO_SUCH' },
    });

    ctx.clock.set(at(HOUR));
    let d = await declineQuote(portal.b, p.b, 'LEAD_TIME', '排产已满');
    expect(d).toMatchObject({
      status: 'DECLINED',
      declineReasonCode: 'LEAD_TIME',
      declineReason: '排产已满',
      declinedAt: at(HOUR).toISOString(),
      respondedAt: at(HOUR).toISOString(),
      allowedActions: ['saveDraft', 'submit', 'downloadTemplate', 'importExcel'],
    });
    expect((await decline({ reasonCode: 'OTHER', reason: '再拒绝一次' }).expect(409)).body.code).toBe(
      'QUOTE_INVALID_STATUS',
    );

    ctx.clock.set(at(2 * HOUR));
    d = await submitQuote(portal.b, p.b, full(p));
    expect(d).toMatchObject({
      status: 'SUBMITTED',
      declineReasonCode: null,
      declineReason: null,
      declinedAt: null,
      respondedAt: at(HOUR).toISOString(),
    });

    ctx.clock.set(at(3 * HOUR));
    d = await declineQuote(portal.b, p.b, 'PRICE', '价格做不到');
    expect(d).toMatchObject({ status: 'DECLINED', versionCount: 1, currentVersion: { versionNo: 1 } });
    const responses: QuoteResponseDto[] = (
      await buyer.get(`/api/inquiries/${p.inquiry.id}/rounds/1/responses`).expect(200)
    ).body.items;
    expect(responses.find((r) => r.id === p.b)).toMatchObject({
      status: 'DECLINED',
      declineReasonCode: 'PRICE',
      declineReason: '价格做不到',
      versionCount: 1,
    });
  });

  it('R09-1 越过截止（截止任务没执行，轮次仍是等待报价）后保存草稿、提交、拒绝、下载与导入都返回 QUOTE_DEADLINE_PASSED', async () => {
    const deadline = at(2 * HOUR);
    const p = await published(deadline);
    await portal.a
      .put(`${base(p.a)}/draft`)
      .send({ lines: full(p) })
      .expect(200);
    const xlsx = await template(portal.a, p.a);

    ctx.clock.set(new Date(deadline.getTime() - 1));
    await submitQuote(portal.b, p.b, full(p));

    ctx.clock.set(deadline);
    expect((await ctx.prisma.inquiryRound.findUniqueOrThrow({ where: { id: p.roundId } })).status).toBe(
      'WAITING_QUOTES',
    );
    const passed = { code: 'QUOTE_DEADLINE_PASSED', params: { deadline: deadline.toISOString() } };
    const results = [
      await portal.a
        .put(`${base(p.a)}/draft`)
        .send({ lines: {} })
        .expect(409),
      await portal.a
        .post(`${base(p.a)}/submit`)
        .send({ lines: full(p) })
        .expect(409),
      await portal.a
        .post(`${base(p.a)}/decline`)
        .send({ reasonCode: 'OTHER', reason: '来不及' })
        .expect(409),
      await portal.a.get(`${base(p.a)}/excel-template`).expect(409),
      await portal.a
        .post(`${base(p.a)}/excel-import`)
        .attach('file', xlsx, 'quote.xlsx')
        .expect(409),
      await portal.b
        .post(`${base(p.b)}/submit`)
        .send({ lines: full(p) })
        .expect(409),
    ];
    for (const res of results) expect(res.body).toMatchObject(passed);
    const d = await detailOf(portal.a, p.a);
    expect(d.allowedActions).toEqual([]);
    expect(d.draft).not.toBeNull();
    expect(await ctx.prisma.quoteVersion.count({ where: { quote: { roundId: p.roundId } } })).toBe(1);
  });

  it('R09-1 询价取消后报价单作废：填报一律 QUOTE_INVALID_STATUS，已提交的版本照样能看（P-4）', async () => {
    const p = await published();
    await submitQuote(portal.a, p.a, full(p));
    await manager.post(`/api/inquiries/${p.inquiry.id}/cancel`).send({ reason: '项目暂停' }).expect(200);
    const results = [
      await portal.a
        .put(`${base(p.a)}/draft`)
        .send({ lines: {} })
        .expect(409),
      await portal.a
        .post(`${base(p.a)}/submit`)
        .send({ lines: full(p) })
        .expect(409),
      await portal.a
        .post(`${base(p.a)}/decline`)
        .send({ reasonCode: 'OTHER', reason: '不做了' })
        .expect(409),
      await portal.a.get(`${base(p.a)}/excel-template`).expect(409),
    ];
    for (const res of results) expect(res.body.code).toBe('QUOTE_INVALID_STATUS');
    const d = await detailOf(portal.a, p.a);
    expect(d).toMatchObject({
      status: 'VOID',
      allowedActions: [],
      versionCount: 1,
      currentVersion: { versionNo: 1 },
    });
    await portal.a.get(`${base(p.a)}/versions/1`).expect(200);
  });

  it('R09-8 锁定 Excel：模板预先写入草稿；导入只写草稿（source = EXCEL）；提交后版本来源为 EXCEL；错误文件整表拒绝', async () => {
    const p = await published();
    await portal.a
      .put(`${base(p.a)}/draft`)
      .send({ lines: { [p.l1]: { unit_price_incl_tax: '1.5', brand: '星光' } }, remark: '草稿备注' })
      .expect(200);
    const res = await portal.a
      .get(`${base(p.a)}/excel-template`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('报价单-'));
    const ws = (await loadXlsx(res.body as Buffer)).getWorksheet(QUOTE_SHEET)!;
    expect(ws.getCell(4, columnOf(ws, 'unit_price_incl_tax')).value).toBe(1.5);
    expect(ws.getCell(4, columnOf(ws, 'brand')).value).toBe('星光');
    expect(ws.getCell(5, columnOf(ws, 'unit_price_incl_tax')).value).toBeNull();

    const filled = await editQuoteSheet(res.body as Buffer, {
      4: { ...LED_CELLS, unit_price_incl_tax: 1.5 },
      5: { ...LED_CELLS, unit_price_incl_tax: 2.26 },
    });
    let d: PortalQuoteDetailDto = (
      await portal.a
        .post(`${base(p.a)}/excel-import`)
        .attach('file', filled, 'quote.xlsx')
        .expect(200)
    ).body;
    expect(d).toMatchObject({
      status: 'INVITED',
      versionCount: 0,
      draft: { source: 'EXCEL', remark: '草稿备注' },
    });
    expect(d.draft!.lines[p.l1]).toMatchObject({ unit_price_incl_tax: '1.5000', brand: '星光', cct_k: 3000 });
    expect(d.draft!.lines[p.l2]).toMatchObject({ unit_price_incl_tax: '2.2600', tax_rate: '13.00' });

    d = await submitQuote(portal.a, p.a, d.draft!.lines, { remark: d.draft!.remark });
    expect(d.currentVersion).toMatchObject({
      versionNo: 1,
      source: 'EXCEL',
      totalAmount: '2630.00',
      remark: '草稿备注',
    });

    // 没有草稿时模板写当前版本；清空一个必填单元格 → 整表拒绝，什么都不写
    const again = await template(portal.a, p.a);
    const wrong = await editQuoteSheet(again, { 5: { cct_k: null } });
    const rejected = await portal.a
      .post(`${base(p.a)}/excel-import`)
      .attach('file', wrong, 'quote.xlsx')
      .expect(422);
    expect(rejected.body).toMatchObject({ code: 'EXCEL_ROWS_INVALID', params: { count: 1 } });
    expect(rejected.body.details).toEqual([
      expect.objectContaining({ row: 5, column: '色温(K) / CCT (K)', code: 'required' }),
    ]);
    expect((await detailOf(portal.a, p.a)).draft).toBeNull();

    // 别家报价单的模板导入不了
    const others = await template(portal.b, p.b);
    const mismatch = await portal.a
      .post(`${base(p.a)}/excel-import`)
      .attach('file', others, 'quote.xlsx')
      .expect(422);
    expect(mismatch.body).toMatchObject({ code: 'EXCEL_TEMPLATE_MISMATCH', params: { reason: 'outdated' } });
  });

  it('R09-9 报价附件：最多 10 个、只能挂本供应商上传的 ATTACHMENT；提交后成为版本附件，开标前采购方不能下载（S-3）', async () => {
    const p = await published();
    const upload = async (agent: Agent, kind = 'ATTACHMENT', name = '报价说明.pdf'): Promise<string> =>
      (await agent.post('/api/files').field('kind', kind).attach('file', PDF, name).expect(201)).body.id;
    const mine = await upload(portal.a);
    const others = await upload(portal.b);
    const spec = await upload(portal.a, 'SPEC_DOC', '规格.pdf');
    const draft = (attachmentFileIds: string[]) =>
      portal.a.put(`${base(p.a)}/draft`).send({ attachmentFileIds });

    expect((await draft([others]).expect(403)).body.code).toBe('FILE_ACCESS_DENIED');
    expect((await draft([spec]).expect(400)).body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const tooMany = Array.from({ length: 11 }, (_, i) => `file-${i}`);
    expect((await draft(tooMany).expect(400)).body).toMatchObject({
      code: 'FILE_LIMIT_EXCEEDED',
      params: { max: 10 },
    });
    const d: PortalQuoteDetailDto = (await draft([mine]).expect(200)).body;
    expect(d.draft!.attachments.map((f) => f.id)).toEqual([mine]);
    // 草稿里的附件算被引用，清理任务不删；没挂到任何地方的会被删
    await ctx.app.get(FilesService).cleanupOrphans(at(1000 * HOUR));
    expect(await ctx.prisma.fileObject.count({ where: { id: mine } })).toBe(1);
    expect(await ctx.prisma.fileObject.count({ where: { id: others } })).toBe(0);

    let submitted = await submitQuote(portal.a, p.a, full(p), { attachmentFileIds: [mine] });
    expect(submitted.currentVersion).toMatchObject({ attachmentCount: 1, attachments: [{ id: mine }] });
    await portal.a.get(`/api/files/${mine}/content`).expect(200);
    for (const agent of [portal.b, buyer, manager, admin]) {
      expect((await agent.get(`/api/files/${mine}/content`).expect(403)).body.code).toBe(
        'FILE_ACCESS_DENIED',
      );
    }
    // 上一版的附件可以原样挂到新版本
    submitted = await submitQuote(portal.a, p.a, full(p), { attachmentFileIds: [mine] });
    expect(submitted.currentVersion).toMatchObject({ versionNo: 2, attachments: [{ id: mine }] });
  });

  it('R09-7 采购方开标前只能看状态：响应列表没有报价内容，报价详情与版本接口 QUOTE_SEALED；seal.preOpenViewRoles 例外，金额按 quote.amount 脱敏', async () => {
    const p = await published();
    await submitQuote(portal.a, p.a, full(p, { unit_price_incl_tax: '3.3333' }), { remark: '机密备注' });
    const responses: QuoteResponseDto[] = (
      await buyer.get(`/api/inquiries/${p.inquiry.id}/rounds/1/responses`).expect(200)
    ).body.items;
    const text = JSON.stringify(responses);
    for (const secret of ['3.3333', '3333.30', '机密备注']) expect(text).not.toContain(secret);
    expect(responses.find((r) => r.id === p.a)).toMatchObject({ status: 'SUBMITTED', versionCount: 1 });

    const quoteUrl = `/api/inquiries/${p.inquiry.id}/rounds/1/quotes/${p.a}`;
    for (const agent of [buyer, manager]) {
      for (const url of [quoteUrl, `${quoteUrl}/versions/1`]) {
        expect((await agent.get(url).expect(403)).body.code).toBe('QUOTE_SEALED');
      }
    }
    // 管理员没有 inquiry:evaluate；供应商访问内部接口
    expect((await admin.get(`${quoteUrl}/versions/1`).expect(403)).body.code).toBe('FORBIDDEN');
    await portal.a.get(`${quoteUrl}/versions/1`).expect(403);

    await admin
      .put('/api/system/params/seal.preOpenViewRoles')
      .send({ value: ['PURCHASE_MANAGER', 'EVAL_NO_AMOUNT'] })
      .expect(200);
    try {
      const detail: RoundQuoteDetailDto = (await manager.get(quoteUrl).expect(200)).body;
      expect(detail).toMatchObject({
        status: 'SUBMITTED',
        supplier: { code: 'TS-A' },
        template: { variantCode: 'PPL-LED' },
        currentVersion: { versionNo: 1, totalAmount: '4463.30', remark: '机密备注' },
        versions: [{ versionNo: 1, totalAmount: '4463.30' }],
      });
      expect(JSON.stringify(detail)).not.toContain('draft');
      await manager.get(`${quoteUrl}/versions/2`).expect(404);
      expect((await buyer.get(quoteUrl).expect(403)).body.code).toBe('QUOTE_SEALED');

      const evaluator = await loginAs(ctx, users.evaluator);
      const v1: QuoteVersionDto = (await evaluator.get(`${quoteUrl}/versions/1`).expect(200)).body;
      expect(v1.totalAmount).toBeNull();
      expect(v1.maskedFields).toEqual(
        expect.arrayContaining([
          'totalAmount',
          'unit_price_incl_tax',
          'unit_price_excl_tax',
          'total_price_incl_tax',
        ]),
      );
      expect(v1.lines[0].values).toMatchObject({
        unit_price_incl_tax: null,
        tax_rate: '13.00',
        lead_time_days: 30,
      });
      expect(JSON.stringify(v1)).not.toContain('3.3333');
    } finally {
      await admin.put('/api/system/params/seal.preOpenViewRoles').send({ value: [] }).expect(200);
    }
    expect((await manager.get(quoteUrl).expect(403)).body.code).toBe('QUOTE_SEALED');
  });

  it('R09-10 询价单操作日志记"提交了第 N 版 / 拒绝报价 / 导入 Excel 草稿"，不含金额', async () => {
    const p = await published();
    await submitQuote(portal.a, p.a, full(p, { unit_price_incl_tax: '7.7777' }));
    await submitQuote(portal.a, p.a, full(p, { unit_price_incl_tax: '8.8888' }));
    await declineQuote(portal.b, p.b, 'CAPACITY', '产能不足');
    const filled = await editQuoteSheet(await template(portal.c, p.c), {
      4: { ...LED_CELLS, unit_price_incl_tax: 9.9999 },
      5: LED_CELLS,
    });
    await portal.c
      .post(`${base(p.c)}/excel-import`)
      .attach('file', filled, '丙报价.xlsx')
      .expect(200);

    const logs: AuditLogDto[] = (await buyer.get(`/api/inquiries/${p.inquiry.id}/timeline`).expect(200)).body;
    const quoteLogs = logs.filter((l) => l.action.startsWith('quote.'));
    const no = p.inquiry.formalNo;
    expect(quoteLogs.map((l) => [l.action, l.summary, l.actor?.name])).toEqual([
      ['quote.submit', `${no} · TS-A · v1`, '甲业务员'],
      ['quote.submit', `${no} · TS-A · v2`, '甲业务员'],
      ['quote.decline', `${no} · TS-B · CAPACITY`, '乙业务员'],
      ['quote.importExcel', `${no} · TS-C · 丙报价.xlsx`, '丙业务员'],
    ]);
    const text = JSON.stringify(quoteLogs);
    for (const amount of ['7.7777', '8.8888', '9.9999', '7777.70', '8888.80'])
      expect(text).not.toContain(amount);
  });
});
