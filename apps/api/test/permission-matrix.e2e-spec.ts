import { PRESET_ROLES } from '@quoteflow/shared';
import request from 'supertest';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { User } from '../src/generated/prisma/client';
import { Agent, anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { listRoutes, type RouteInfo } from './helpers/routes';
import { createTestApp, TestContext } from './helpers/test-app';

type RoleCode = 'ADMIN' | 'PD' | 'BUYER' | 'PURCHASE_MANAGER' | 'CONTRACT_APPROVER' | 'SUPPLIER';
const INTERNAL_ROLES = ['ADMIN', 'PD', 'BUYER', 'PURCHASE_MANAGER', 'CONTRACT_APPROVER'] as const;

/** 允许匿名访问的接口：登录、激活、找回 / 重置密码、健康检查、前端启动配置。多出任何一个都要先过安全复查 */
const PUBLIC_ROUTES = [
  'POST /api/auth/activate',
  'POST /api/auth/forgot-password',
  'POST /api/auth/login',
  'POST /api/auth/reset-password',
  'GET /api/health',
  'GET /api/public/app-config',
];

/**
 * 写了空的 @RequirePermissions()、在 service 里判断"有其中之一即可"的接口（待确认事项 B-66：统计和报表共用的筛选下拉）
 */
const ANY_OF: Record<string, string[]> = {
  'GET /api/reports/filter-options': ['stats:view', 'report:view'],
};

/** 不放进全量矩阵的接口：登出会让当前会话失效（会话失效另有用例） */
const SKIPPED = new Set(['POST /api/auth/logout']);

const key = (r: Pick<RouteInfo, 'method' | 'path'>) => `${r.method} ${r.path}`;

/** 路径参数换成不存在的值：轮次号、版本号要是数字，其余是 id / 编码 */
function concretePath(path: string): string {
  return path.replace(/:(\w+)/g, (_, name: string) =>
    ['roundNo', 'versionNo', 'version'].includes(name) ? '1' : 'zzmatrix0000000000000000',
  );
}

/**
 * M17 §2.1 权限矩阵：
 * 1. 全量：每个接口 × 每个预置角色（与匿名）。预期按 PRESET_ROLES 的权限推算：缺权限一律 403 FORBIDDEN，
 *    有权限时不会被守卫拦下（不存在的 id 得到 404 / 400 等），任何情况都不能 500；供应商访问任何内部接口 403，
 *    内部用户访问门户接口 403；匿名访问 401；非 GET 请求缺 X-Requested-With 一律 CSRF_REJECTED。
 * 2. 代表性接口：按 05 §12 手写每个模块的代表接口该放行哪些角色（不从代码推算），有权限 200 / 201、无权限 403
 */
describe('M17 权限矩阵', () => {
  let ctx: TestContext;
  let routes: RouteInfo[];
  let users: Record<RoleCode, User>;
  let agents: Record<RoleCode, Agent>;
  let categoryId: string;

  const permissionsOf = (role: RoleCode) =>
    new Set<string>(PRESET_ROLES.find((r) => r.code === role)!.permissions);

  async function call(agent: Agent, route: Pick<RouteInfo, 'method' | 'path'>, body: object = {}) {
    const url = concretePath(route.path);
    switch (route.method) {
      case 'GET':
        return agent.get(url);
      case 'POST':
        return agent.post(url).send(body);
      case 'PUT':
        return agent.put(url).send(body);
      case 'PATCH':
        return agent.patch(url).send(body);
      case 'DELETE':
        return agent.delete(url);
    }
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    categoryId = (await ctx.prisma.materialCategory.findUniqueOrThrow({ where: { code: 'LED-2835' } })).id;
    const supplier = await createSupplier(ctx.prisma, { code: 'PM-S1', nameZh: '矩阵供应商' });
    users = {} as Record<RoleCode, User>;
    agents = {} as Record<RoleCode, Agent>;
    for (const role of INTERNAL_ROLES) {
      users[role] = await createUser(ctx.prisma, { username: `pm.${role.toLowerCase()}`, roles: [role] });
    }
    users.SUPPLIER = await createUser(ctx.prisma, {
      username: 'pm@supplier.example.com',
      roles: ['SUPPLIER'],
      userType: 'SUPPLIER',
      supplierId: supplier.id,
    });
    for (const role of Object.keys(users) as RoleCode[]) agents[role] = await loginAs(ctx, users[role]);
    routes = listRoutes(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('只有登录、激活、找回 / 重置密码、健康检查、前端配置是公开接口；内部接口都声明了所需权限', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(
      routes
        .filter((r) => r.isPublic)
        .map(key)
        .sort(),
    ).toEqual([...PUBLIC_ROUTES].sort());
    const undeclared = routes.filter(
      (r) => !r.isPublic && !r.userTypes.includes('SUPPLIER') && r.permissions === undefined,
    );
    expect(undeclared.map(key)).toEqual([]);
    // 门户接口只给供应商；供应商能访问的非门户接口只有通用接口（会话、字典、文件）
    for (const r of routes.filter((x) => x.path.startsWith('/api/portal')))
      expect(r.userTypes).toEqual(['SUPPLIER']);
    expect(
      routes
        .filter((r) => r.userTypes.includes('SUPPLIER') && !r.path.startsWith('/api/portal'))
        .map((r) => r.path.split('/')[2])
        .filter((v, i, a) => a.indexOf(v) === i),
    ).toEqual(['auth', 'dicts', 'files']);
  });

  it('匿名访问任何非公开接口都是 401；非 GET 请求缺 X-Requested-With 一律 CSRF_REJECTED', async () => {
    const anon = anonymous(ctx);
    const failures: string[] = [];
    for (const route of routes.filter((r) => !r.isPublic)) {
      const res = await call(anon, route);
      if (res.status !== 401 || res.body.code !== 'UNAUTHENTICATED')
        failures.push(`${key(route)} → ${res.status}`);
    }
    // 不带 CSRF 头（已登录也一样）
    for (const route of routes.filter((r) => r.method !== 'GET')) {
      const url = concretePath(route.path);
      const raw = request(ctx.app.getHttpServer());
      const verb = route.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete';
      const res = await raw[verb](url).send({});
      if (res.status !== 403 || res.body.code !== 'CSRF_REJECTED')
        failures.push(`CSRF ${key(route)} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it.each([...INTERNAL_ROLES, 'SUPPLIER'] as RoleCode[])(
    'R01-6 全量矩阵 %s：缺权限 403、有权限不被拦且不 500；内外部接口互不可访问',
    async (role) => {
      const perms = permissionsOf(role);
      const internal = role !== 'SUPPLIER';
      const failures: string[] = [];
      let allowed = 0;
      for (const route of routes.filter((r) => !r.isPublic && !SKIPPED.has(key(r)))) {
        const typeOk = route.userTypes.includes(internal ? 'INTERNAL' : 'SUPPLIER');
        const anyOf = ANY_OF[key(route)];
        const expectAllowed =
          typeOk &&
          (route.permissions ?? []).every((p) => perms.has(p)) &&
          (!anyOf || anyOf.some((p) => perms.has(p)));
        const res = await call(agents[role], route);
        const forbidden = res.status === 403 && res.body.code === 'FORBIDDEN';
        if (res.status >= 500) failures.push(`${key(route)} → ${res.status} ${res.body.code}`);
        else if (expectAllowed && forbidden) failures.push(`${key(route)} should be allowed`);
        else if (!expectAllowed && !forbidden)
          failures.push(`${key(route)} should be 403, got ${res.status}`);
        if (expectAllowed) allowed += 1;
      }
      expect(failures).toEqual([]);
      expect(allowed).toBeGreaterThan(0);
    },
  );

  /** 05 §12 手写：每个代表接口放行哪些角色（其余 403） */
  const ALL_INTERNAL: RoleCode[] = [...INTERNAL_ROLES];
  const REPRESENTATIVE: [string, RoleCode[]][] = [
    ['GET /api/system/users', ['ADMIN']],
    ['GET /api/system/roles', ['ADMIN']],
    ['GET /api/system/dict-types', ['ADMIN']],
    ['GET /api/system/params', ['ADMIN']],
    ['GET /api/ppl/sets', ['ADMIN']],
    ['GET /api/system/emails', ['ADMIN']],
    ['GET /api/system/audit-logs', ['ADMIN']],
    ['GET /api/suppliers', ['ADMIN', 'BUYER', 'PURCHASE_MANAGER']],
    ['GET /api/suppliers/export', ['ADMIN', 'BUYER', 'PURCHASE_MANAGER']],
    ['GET /api/supplier-categories', ['ADMIN', 'BUYER', 'PURCHASE_MANAGER']],
    ['GET /api/materials', ['ADMIN', 'PD', 'BUYER', 'PURCHASE_MANAGER']],
    ['GET /api/materials/export', ['ADMIN', 'BUYER', 'PURCHASE_MANAGER']],
    ['GET /api/material-categories/tree', ALL_INTERNAL],
    ['GET /api/inquiries', ALL_INTERNAL],
    ['GET /api/inquiries/approvals/pending', ['PURCHASE_MANAGER']],
    ['GET /api/inquiries/user-options', ['PD', 'BUYER', 'PURCHASE_MANAGER']],
    ['GET /api/contracts', ['ADMIN', 'BUYER', 'PURCHASE_MANAGER', 'CONTRACT_APPROVER']],
    ['GET /api/stats/projects', ['ADMIN', 'BUYER', 'PURCHASE_MANAGER', 'CONTRACT_APPROVER']],
    ['GET /api/reports/inquiries', ['ADMIN', 'BUYER', 'PURCHASE_MANAGER', 'CONTRACT_APPROVER']],
    ['GET /api/reports/inquiries/export', ['ADMIN', 'PURCHASE_MANAGER']],
    ['GET /api/workbench', ALL_INTERNAL],
    ['GET /api/portal/quotes', ['SUPPLIER']],
    ['GET /api/portal/workbench', ['SUPPLIER']],
    ['GET /api/dicts?types=currency', [...ALL_INTERNAL, 'SUPPLIER']],
    ['GET /api/reports/filter-options', ['ADMIN', 'BUYER', 'PURCHASE_MANAGER', 'CONTRACT_APPROVER']],
    ['GET /api/auth/me', [...ALL_INTERNAL, 'SUPPLIER']],
  ];

  it.each(REPRESENTATIVE)('代表接口 %s：放行的角色 200，其余 403', async (route, allowedRoles) => {
    const [method, path] = route.split(' ') as [RouteInfo['method'], string];
    for (const role of [...INTERNAL_ROLES, 'SUPPLIER'] as RoleCode[]) {
      const res = await call(agents[role], { method, path });
      expect([role, res.status]).toEqual([role, allowedRoles.includes(role) ? 200 : 403]);
    }
  });

  it('代表接口（新建）：新建材料只有 ADMIN、BUYER、PURCHASE_MANAGER 得到 201，新建询价单只有 PD、BUYER、PURCHASE_MANAGER', async () => {
    const material = (role: RoleCode) => ({
      nameZh: `矩阵材料 ${role}`,
      spec: 'SPEC',
      unitCode: 'PCS',
      categoryId,
    });
    const inquiry = (role: RoleCode) => ({
      projectNo: `PJ-PM-${role}`,
      title: `矩阵询价 ${role}`,
      materialCategoryId: categoryId,
      currency: 'CNY',
    });
    const statuses = async (path: string, body: (role: RoleCode) => object) => {
      const out: Partial<Record<RoleCode, number>> = {};
      for (const role of [...INTERNAL_ROLES, 'SUPPLIER'] as RoleCode[]) {
        out[role] = (await call(agents[role], { method: 'POST', path }, body(role))).status;
      }
      return out;
    };
    expect(await statuses('/api/materials', material)).toEqual({
      ADMIN: 201,
      PD: 403,
      BUYER: 201,
      PURCHASE_MANAGER: 201,
      CONTRACT_APPROVER: 403,
      SUPPLIER: 403,
    });
    expect(await statuses('/api/inquiries', inquiry)).toEqual({
      ADMIN: 403,
      PD: 201,
      BUYER: 201,
      PURCHASE_MANAGER: 201,
      CONTRACT_APPROVER: 403,
      SUPPLIER: 403,
    });
  });
});
