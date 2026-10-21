import type { User } from '../src/generated/prisma/client';
import { Agent, anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase, TEST_PASSWORD } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

describe('M01 用户管理', () => {
  let ctx: TestContext;
  let adminUser: User;
  let admin: Agent;
  let buyerRoleId: string;
  let pdRoleId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    adminUser = await createUser(ctx.prisma, { roles: ['ADMIN'], username: 'admin.u' });
    admin = await loginAs(ctx, adminUser);
    buyerRoleId = (await ctx.prisma.role.findUniqueOrThrow({ where: { code: 'BUYER' } })).id;
    pdRoleId = (await ctx.prisma.role.findUniqueOrThrow({ where: { code: 'PD' } })).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  const newUser = (overrides: Record<string, unknown> = {}) => ({
    username: 'Zhao.Qian',
    name: '赵钱',
    email: 'Zhao.Qian@Example.com',
    departmentCode: 'PURCHASE',
    roleIds: [buyerRoleId],
    password: 'Start1234',
    ...overrides,
  });

  it('新建用户：用户名和邮箱转小写，可以用新账号登录', async () => {
    const res = await admin.post('/api/system/users').send(newUser()).expect(201);
    expect(res.body).toMatchObject({
      username: 'zhao.qian',
      email: 'zhao.qian@example.com',
      status: 'ACTIVE',
      roles: [{ code: 'BUYER' }],
    });
    expect(res.body).not.toHaveProperty('passwordHash');
    await loginAs(ctx, { username: 'zhao.qian' }, 'Start1234');
  });

  it('新建用户的各种校验', async () => {
    const dupName = await admin.post('/api/system/users').send(newUser({ email: 'other@example.com' })).expect(409);
    expect(dupName.body.code).toBe('USER_USERNAME_TAKEN');

    const dupEmail = await admin.post('/api/system/users').send(newUser({ username: 'another' })).expect(409);
    expect(dupEmail.body.code).toBe('USER_EMAIL_TAKEN');

    const weak = await admin.post('/api/system/users').send(newUser({ username: 'weak1', email: '', password: 'abc' })).expect(400);
    expect(weak.body.code).toBe('AUTH_PASSWORD_WEAK');

    const dept = await admin
      .post('/api/system/users')
      .send(newUser({ username: 'dept1', email: '', departmentCode: 'NOPE' }))
      .expect(400);
    expect(dept.body).toMatchObject({ code: 'DICT_ITEM_INVALID', params: { type: 'department', code: 'NOPE' } });

    const supplierRole = (await ctx.prisma.role.findUniqueOrThrow({ where: { code: 'SUPPLIER' } })).id;
    const role = await admin
      .post('/api/system/users')
      .send(newUser({ username: 'role1', email: '', roleIds: [supplierRole] }))
      .expect(400);
    expect(role.body.code).toBe('VALIDATION_FAILED');
  });

  it('R01-9 至少一个角色；用户名格式校验', async () => {
    const noRole = await admin.post('/api/system/users').send(newUser({ username: 'norole', email: '', roleIds: [] })).expect(400);
    expect(noRole.body.code).toBe('VALIDATION_FAILED');
    const badName = await admin.post('/api/system/users').send(newUser({ username: 'a b', email: '' })).expect(400);
    expect(badName.body.code).toBe('VALIDATION_FAILED');
  });

  it('列表只含内部用户，支持关键字和角色筛选', async () => {
    const list = await admin.get('/api/system/users').query({ keyword: 'zhao', pageSize: 50 }).expect(200);
    expect(list.body.items.map((u: { username: string }) => u.username)).toEqual(['zhao.qian']);
    const byRole = await admin.get('/api/system/users').query({ roleId: buyerRoleId }).expect(200);
    expect(byRole.body.items.every((u: { roles: { code: string }[] }) => u.roles.some((r) => r.code === 'BUYER'))).toBe(
      true,
    );
  });

  it('编辑用户会替换角色并记审计', async () => {
    const user = await createUser(ctx.prisma, { roles: ['BUYER'] });
    const res = await admin
      .put(`/api/system/users/${user.id}`)
      .send({ name: '改名', departmentCode: 'PRODUCT', roleIds: [pdRoleId], locale: 'en-US' })
      .expect(200);
    expect(res.body).toMatchObject({ name: '改名', departmentCode: 'PRODUCT', locale: 'en-US', roles: [{ code: 'PD' }] });
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'user.update', entityId: user.id } });
    expect(log?.detail).toMatchObject({ rolesBefore: ['BUYER'], rolesAfter: ['PD'] });
  });

  it('R01-6 停用用户后其会话立即失效且不能登录；启用后可以登录；不能停用自己', async () => {
    const user = await createUser(ctx.prisma);
    const agent = await loginAs(ctx, user);
    await admin.put(`/api/system/users/${user.id}/status`).send({ status: 'DISABLED' }).expect(200);
    await agent.get('/api/auth/me').expect(401);
    const login = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD })
      .expect(403);
    expect(login.body.code).toBe('AUTH_ACCOUNT_DISABLED');

    await admin.put(`/api/system/users/${user.id}/status`).send({ status: 'ACTIVE' }).expect(200);
    await loginAs(ctx, user);

    await admin.put(`/api/system/users/${adminUser.id}/status`).send({ status: 'DISABLED' }).expect(403);
  });

  it('R01-6 管理员重置密码后旧会话失效，新密码可以登录', async () => {
    const user = await createUser(ctx.prisma);
    const agent = await loginAs(ctx, user);
    await admin.post(`/api/system/users/${user.id}/reset-password`).send({ newPassword: 'Reset2026x' }).expect(200);
    await agent.get('/api/auth/me').expect(401);
    await loginAs(ctx, user, 'Reset2026x');
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'user.resetPassword', entityId: user.id } });
    expect(log).not.toBeNull();
  });

  it('没有用户管理权限的人不能查看或新建', async () => {
    const buyer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
    await buyer.get('/api/system/users').expect(403);
    await buyer.post('/api/system/users').send(newUser({ username: 'x1', email: '' })).expect(403);
  });

  it('供应商用户不会出现在内部用户接口里', async () => {
    const supplier = await ctx.prisma.supplier.create({
      data: { code: 'SUP90002', nameZh: '供应商乙', categoryCode: 'NORMAL', contactName: 'B', contactEmail: 'b@example.com' },
    });
    const supUser = await createUser(ctx.prisma, {
      roles: ['SUPPLIER'],
      userType: 'SUPPLIER',
      supplierId: supplier.id,
      username: 'b@example.com',
    });
    await admin.get(`/api/system/users/${supUser.id}`).expect(404);
  });
});
