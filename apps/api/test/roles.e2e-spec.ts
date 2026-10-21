import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../src/common/auth/decorators';
import type { User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

@Controller('__probe')
class PermissionProbeController {
  /** 故意漏写 @RequirePermissions */
  @Get('no-decorator')
  noDecorator() {
    return { ok: true };
  }

  @RequirePermissions()
  @Get('login-only')
  loginOnly() {
    return { ok: true };
  }
}

describe('M01 角色与权限', () => {
  let ctx: TestContext;
  let admin: Agent;
  let buyerUser: User;

  const roleId = async (code: string) => (await ctx.prisma.role.findUniqueOrThrow({ where: { code } })).id;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [PermissionProbeController] });
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    admin = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['ADMIN'], username: 'admin.t' }));
    buyerUser = await createUser(ctx.prisma, { roles: ['BUYER'], username: 'buyer.t' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('权限目录包含 46 个权限码和 4 个敏感字段', async () => {
    const res = await admin.get('/api/system/permissions').expect(200);
    const codes = (res.body.modules as { permissions: { code: string }[] }[]).flatMap((m) =>
      m.permissions.map((p) => p.code),
    );
    expect(codes).toHaveLength(46);
    expect(res.body.fields).toHaveLength(4);
  });

  it('R01-5 修改角色权限后，已登录用户的下一个请求立即生效', async () => {
    const buyer = await loginAs(ctx, buyerUser);
    await buyer.get('/api/system/users').expect(403);

    const id = await roleId('BUYER');
    const role = (await admin.get(`/api/system/roles/${id}`).expect(200)).body;
    await admin
      .put(`/api/system/roles/${id}`)
      .send({ ...role, description: role.description ?? '', permissions: [...role.permissions, 'system:user:view'] })
      .expect(200);
    await buyer.get('/api/system/users').expect(200);

    await admin.put(`/api/system/roles/${id}`).send({ ...role, description: role.description ?? '' }).expect(200);
    await buyer.get('/api/system/users').expect(403);
  });

  it('新建自定义角色分配三类权限，审计记录权限差异', async () => {
    const created = await admin
      .post('/api/system/roles')
      .send({
        code: 'QC_VIEWER',
        nameZh: '质检查看',
        nameEn: 'QC Viewer',
        dataScope: 'DEPT',
        permissions: ['inquiry:view', 'inquiry:view'],
        fieldPermissions: ['supplier.contact'],
      })
      .expect(201);
    expect(created.body).toMatchObject({ code: 'QC_VIEWER', isPreset: false, permissions: ['inquiry:view'] });

    await admin
      .put(`/api/system/roles/${created.body.id}`)
      .send({
        nameZh: '质检查看',
        nameEn: 'QC Viewer',
        dataScope: 'ALL',
        permissions: ['inquiry:view', 'stats:view'],
        fieldPermissions: [],
      })
      .expect(200);
    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'role.update', entityId: created.body.id },
    });
    expect(log?.detail).toMatchObject({
      permissions: { added: ['stats:view'], removed: [] },
      fieldPermissions: { added: [], removed: ['supplier.contact'] },
    });

    const dup = await admin
      .post('/api/system/roles')
      .send({ code: 'QC_VIEWER', nameZh: 'x', nameEn: 'x', dataScope: 'SELF', permissions: [], fieldPermissions: [] })
      .expect(409);
    expect(dup.body.code).toBe('ROLE_CODE_TAKEN');
  });

  it('R01-7 未知权限码被拒；预置角色不能删除；供应商角色的权限不能修改', async () => {
    const bad = await admin
      .post('/api/system/roles')
      .send({
        code: 'BAD_ROLE',
        nameZh: 'x',
        nameEn: 'x',
        dataScope: 'SELF',
        permissions: ['inquiry:fly'],
        fieldPermissions: [],
      })
      .expect(400);
    expect(bad.body.code).toBe('ROLE_UNKNOWN_PERMISSION');

    const del = await admin.delete(`/api/system/roles/${await roleId('PD')}`).expect(409);
    expect(del.body.code).toBe('ROLE_PRESET_IMMUTABLE');

    const sup = await admin
      .put(`/api/system/roles/${await roleId('SUPPLIER')}`)
      .send({ nameZh: '供应商', nameEn: 'Supplier', dataScope: 'SELF', permissions: ['inquiry:view'], fieldPermissions: [] })
      .expect(409);
    expect(sup.body.code).toBe('ROLE_PRESET_IMMUTABLE');
  });

  it('R01-8 仍有用户的角色不能删除，没有用户的自定义角色可以删除', async () => {
    const role = await admin
      .post('/api/system/roles')
      .send({ code: 'TEMP_ROLE', nameZh: '临时', nameEn: 'Temp', dataScope: 'SELF', permissions: [], fieldPermissions: [] })
      .expect(201);
    const user = await createUser(ctx.prisma, { roles: ['TEMP_ROLE'] });
    const inUse = await admin.delete(`/api/system/roles/${role.body.id}`).expect(409);
    expect(inUse.body.code).toBe('ROLE_IN_USE');

    await ctx.prisma.userRole.deleteMany({ where: { userId: user.id } });
    await admin.delete(`/api/system/roles/${role.body.id}`).expect(200);
  });

  it('R01-10 多个角色时权限取并集，数据范围取最宽', async () => {
    const user = await createUser(ctx.prisma, { roles: ['PD', 'CONTRACT_APPROVER'] });
    const me = (await (await loginAs(ctx, user)).get('/api/auth/me').expect(200)).body;
    expect(me.dataScope).toBe('ALL');
    expect(me.permissions).toEqual(expect.arrayContaining(['inquiry:create', 'contract:approve']));
    expect(me.fieldPermissions).toEqual(['contract.amount', 'quote.amount']);
  });

  it('内部接口漏写 @RequirePermissions 时拒绝访问；写了空参数的只需登录', async () => {
    const res = await admin.get('/api/__probe/no-decorator').expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    const buyer = await loginAs(ctx, buyerUser);
    await buyer.get('/api/__probe/login-only').expect(200);
  });

  it('没有 system:role:manage 不能修改角色', async () => {
    const buyer = await loginAs(ctx, buyerUser);
    await buyer.get('/api/system/roles').expect(403);
    await buyer
      .post('/api/system/roles')
      .send({ code: 'HACK', nameZh: 'x', nameEn: 'x', dataScope: 'ALL', permissions: [], fieldPermissions: [] })
      .expect(403);
  });
});
