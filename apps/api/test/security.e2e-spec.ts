import { FIELD_PERMISSION_CODES, PERMISSION_CODES } from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { Agent, anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase, TEST_PASSWORD } from './helpers/fixtures';
import {
  ledLines,
  ledValues,
  openRound,
  publishLedInquiry,
  submitQuote,
  type PublishedLed,
} from './helpers/quotes';
import { fillPath, listRoutes, ROUTE_QUERY, type RouteInfo } from './helpers/routes';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
const START = new Date('2026-11-16T01:00:00.000Z');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
/** 供应商乙只存了草稿、从没提交：草稿里的价格和备注任何内部出口都不能出现（买方任何时候都看不到草稿） */
const DRAFT_PRICE = '8.7654';
const DRAFT_REMARK = '乙草稿备注-ZZ';
/** 任何响应里都不能出现的键（内部接口另加 draftValues） */
const SECRET_KEYS = ['passwordHash', 'tokenHash'];
/** 用户上传的文件名带引号和分号（Content-Disposition 注入） */
const NASTY_NAME = '报价 "说明"; v2.pdf';

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

/**
 * M17 §2.1 安全复查（其余条目已有专门用例：密封 sealing、隔离 portal-isolation、CSRF / 登录限流 / 会话失效 auth、
 * 上传魔数 files、全部接口的权限 permission-matrix）：
 * - 走完一张询价的全流程后，用拥有全部功能权限和敏感字段的账号把每个 GET 接口按真实 id 调一遍：都能正常返回，
 *   响应里没有 passwordHash、tokenHash、draftValues，也没有供应商草稿里的内容；门户接口同样没有前两个键
 * - 用户上传的文件名带引号、分号时，下载的 Content-Disposition 不会被截断或注入
 */
describe('M17 安全复查', () => {
  let ctx: TestContext;
  let users: Record<'super' | 'buyer' | 'manager' | 'a' | 'b', User>;
  let agents: Record<'super' | 'buyer' | 'manager' | 'a' | 'b', Agent>;
  let s: Record<'a' | 'b', Supplier>;
  let p: PublishedLed;
  let routes: RouteInfo[];
  let ids: Record<string, string>;

  function concretePath(route: RouteInfo): string {
    const url = fillPath(route.path, ids);
    if (!url) throw new Error(`no id for ${route.path}`);
    return url;
  }

  /** 正常就不是 200 的：PDF 没有表格预览；第 1 轮没有上一轮可比；截止后不能再下载锁定 Excel */
  const NOT_200: Record<string, number> = {
    '/api/files/:id/sheet-preview': 400,
    '/api/inquiries/:id/rounds/:roundNo/diff': 404,
    '/api/portal/quotes/:quoteId/excel-template': 409,
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(START);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    const category = await ctx.prisma.materialCategory.findUniqueOrThrow({ where: { code: 'LED-2835' } });
    await ctx.prisma.role.create({
      data: {
        code: 'SUPER',
        nameZh: '全部权限',
        nameEn: 'All permissions',
        dataScope: 'ALL',
        permissions: [...PERMISSION_CODES],
        fieldPermissions: [...FIELD_PERMISSION_CODES],
      },
    });
    s = {
      a: await createSupplier(ctx.prisma, { code: 'SEC-A', nameZh: '供应商甲' }),
      b: await createSupplier(ctx.prisma, { code: 'SEC-B', nameZh: '供应商乙' }),
    };
    const account = (supplier: Supplier, username: string) =>
      createUser(ctx.prisma, {
        username,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: supplier.id,
      });
    users = {
      super: await createUser(ctx.prisma, {
        username: 'sec.super',
        roles: ['SUPER'],
        email: 'super@example.com',
      }),
      buyer: await createUser(ctx.prisma, {
        username: 'sec.buyer',
        roles: ['BUYER'],
        email: 'buyer@example.com',
      }),
      manager: await createUser(ctx.prisma, { username: 'sec.manager', roles: ['PURCHASE_MANAGER'] }),
      a: await account(s.a, 'a@sec.example.com'),
      b: await account(s.b, 'b@sec.example.com'),
    };
    agents = {} as typeof agents;
    for (const k of Object.keys(users) as (keyof typeof users)[]) agents[k] = await loginAs(ctx, users[k]);

    // 全流程：发布 → 乙存草稿、甲带附件提交 → 开标 → 入围议价 → 成交 → 定标 → 合同
    const deadline = new Date(START.getTime() + 6 * HOUR);
    p = await publishLedInquiry(
      ctx.prisma,
      agents.buyer,
      agents.manager,
      category.id,
      [s.a.id, s.b.id],
      deadline,
    );
    await agents.b
      .put(`/api/portal/quotes/${p.quotes[1]}/draft`)
      .send({ lines: { [p.l1]: ledValues({ unit_price_incl_tax: DRAFT_PRICE }) }, remark: DRAFT_REMARK })
      .expect(200);
    const file = (
      await agents.a
        .post('/api/files')
        .field('kind', 'ATTACHMENT')
        .attach('file', PDF, NASTY_NAME)
        .expect(201)
    ).body;
    await submitQuote(agents.a, p.quotes[0], ledLines(p, '1.11', '2.22'), { attachmentFileIds: [file.id] });
    await openRound(ctx, agents.manager, p, deadline);
    await agents.buyer
      .put(`/api/inquiries/${p.inquiry.id}/rounds/1/shortlist`)
      .send({ quoteIds: [p.quotes[0]] })
      .expect(200);
    const thread = (
      await agents.buyer
        .post(`/api/quotes/${p.quotes[0]}/negotiation/offer`)
        .send({ lines: [{ lineId: p.l1, unitPriceInclTax: '1.05' }] })
        .expect(200)
    ).body;
    await agents.a
      .post(`/api/portal/quotes/${p.quotes[0]}/negotiation/respond`)
      .send({ type: 'ACCEPT', replyToId: thread.messages[thread.messages.length - 1].id })
      .expect(200);
    await agents.manager
      .post(`/api/inquiries/${p.inquiry.id}/rounds/1/award`)
      .send({ quoteId: p.quotes[0] })
      .expect(200);
    // 会话 12 小时过期：开标时拨过了截止时间，重新登录
    for (const k of Object.keys(users) as (keyof typeof users)[]) agents[k] = await loginAs(ctx, users[k]);

    const material = (
      await agents.super
        .post('/api/materials')
        .send({ nameZh: '安全复查材料', spec: 'SPEC', unitCode: 'PCS', categoryId: category.id })
        .expect(201)
    ).body;
    const contract = await ctx.prisma.contract.findFirstOrThrow({ where: { inquiryId: p.inquiry.id } });
    const email = await ctx.prisma.emailMessage.findFirstOrThrow();
    const role = await ctx.prisma.role.findUniqueOrThrow({ where: { code: 'BUYER' } });
    ids = {
      inquiries: p.inquiry.id,
      contracts: contract.id,
      suppliers: s.a.id,
      materials: material.id,
      'material-categories': category.id,
      'system/users': users.buyer.id,
      'system/roles': role.id,
      'system/emails': email.id,
      files: file.id,
      quote: p.quotes[0],
    };
    routes = listRoutes(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('内部接口全部 GET（真实数据）：都能正常返回，响应里没有 passwordHash、tokenHash、draftValues 和供应商草稿内容', async () => {
    const failures: string[] = [];
    const internalGets = routes.filter(
      (r) => r.method === 'GET' && !r.isPublic && r.userTypes.includes('INTERNAL'),
    );
    expect(internalGets.length).toBeGreaterThanOrEqual(70);
    for (const route of internalGets) {
      const url = concretePath(route) + (ROUTE_QUERY[route.path] ?? '');
      const res = await agents.super.get(url).buffer(true);
      const expected = NOT_200[route.path] ?? 200;
      if (res.status !== expected) {
        failures.push(`${url} → ${res.status} ${res.body?.code ?? ''}`);
        continue;
      }
      const type = String(res.headers['content-type'] ?? '');
      if (!type.includes('application/json')) continue;
      const keys = keysOf(res.body);
      for (const k of [...SECRET_KEYS, 'draftValues']) if (keys.has(k)) failures.push(`${url} has key ${k}`);
      const text = JSON.stringify(res.body);
      for (const secret of [DRAFT_PRICE, DRAFT_REMARK])
        if (text.includes(secret)) failures.push(`${url} leaks draft`);
    }
    expect(failures).toEqual([]);
  });

  it('门户接口全部 GET：本供应商都能正常返回，响应里没有 passwordHash、tokenHash', async () => {
    const failures: string[] = [];
    const portalGets = routes.filter((r) => r.method === 'GET' && r.path.startsWith('/api/portal'));
    for (const route of portalGets) {
      const url = concretePath(route);
      const res = await agents.a.get(url).buffer(true);
      if (res.status !== (NOT_200[route.path] ?? 200))
        failures.push(`${url} → ${res.status} ${res.body?.code ?? ''}`);
      else if (String(res.headers['content-type']).includes('application/json')) {
        const keys = keysOf(res.body);
        for (const k of SECRET_KEYS) if (keys.has(k)) failures.push(`${url} has key ${k}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('登录响应、用户列表与详情、门户账号列表不含密码哈希与令牌哈希', async () => {
    const login = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'sec.buyer', password: TEST_PASSWORD })
      .expect(200);
    for (const body of [
      login.body,
      (await agents.super.get('/api/system/users').expect(200)).body,
      (await agents.super.get(`/api/system/users/${users.buyer.id}`).expect(200)).body,
      (await agents.super.get(`/api/suppliers/${s.a.id}/accounts`).expect(200)).body,
    ]) {
      const keys = keysOf(body);
      for (const k of SECRET_KEYS) expect(keys.has(k)).toBe(false);
      expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/);
    }
  });

  it('Content-Disposition：文件名带引号、分号时，filename 被转义、filename* 全部编码，不能拆出新的参数或头部', async () => {
    const file = await ctx.prisma.fileObject.findFirstOrThrow({ where: { originalName: NASTY_NAME } });
    for (const disposition of ['inline', 'attachment']) {
      const res = await agents.buyer
        .get(`/api/files/${file.id}/content?disposition=${disposition}`)
        .expect(200);
      const header = res.headers['content-disposition'] as string;
      expect(header).toMatch(
        new RegExp(`^${disposition}; filename="[^"]*"; filename\\*=UTF-8''[A-Za-z0-9%!._~-]+$`),
      );
      expect(header).toContain(`filename*=UTF-8''${encodeURIComponent(NASTY_NAME)}`);
    }
    // 门户里供应商下载自己的附件同样处理
    const own = await agents.a.get(`/api/files/${file.id}/content?disposition=attachment`).expect(200);
    expect(own.headers['content-disposition']).toContain('filename="__ ____; v2.pdf"');
  });
});
