import request from 'supertest';
import { hashToken } from '../src/common/auth/session.service';
import { LoginRateLimiter } from '../src/common/auth/login-rate-limiter';
import type { User } from '../src/generated/prisma/client';
import { anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase, TEST_PASSWORD } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

describe('M01 认证与会话', () => {
  let ctx: TestContext;
  let buyer: User;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    buyer = await createUser(ctx.prisma, { roles: ['BUYER'], username: 'buyer.a' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => ctx.app.get(LoginRateLimiter).reset());

  it('R01-1 用户不存在和密码错误统一返回 AUTH_INVALID_CREDENTIALS', async () => {
    const wrong = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'buyer.a', password: 'wrong-pass1' })
      .expect(401);
    const unknown = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'wrong-pass1' })
      .expect(401);
    expect(wrong.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(unknown.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('R01-1 登录成功返回当前用户与权限，设置 httpOnly 会话 cookie，数据库只存哈希', async () => {
    const res = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'buyer.a', password: TEST_PASSWORD })
      .expect(200);
    expect(res.body.user).toMatchObject({ username: 'buyer.a', userType: 'INTERNAL' });
    expect(res.body.permissions).toContain('inquiry:view');
    expect(res.body.fieldPermissions).toContain('quote.amount');
    expect(res.body.dataScope).toBe('SELF');

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/qf_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const token = /qf_sid=([^;]+)/.exec(cookie)![1];
    expect(await ctx.prisma.session.findUnique({ where: { id: token } })).toBeNull();
    expect(await ctx.prisma.session.findUnique({ where: { id: hashToken(token) } })).not.toBeNull();
  });

  it('用户名不区分大小写', async () => {
    await anonymous(ctx).post('/api/auth/login').send({ username: 'BUYER.A', password: TEST_PASSWORD }).expect(200);
  });

  it('R01-2 停用账号返回 AUTH_ACCOUNT_DISABLED，未激活账号返回 AUTH_ACCOUNT_NOT_ACTIVATED', async () => {
    const disabled = await createUser(ctx.prisma, { status: 'DISABLED' });
    const pending = await createUser(ctx.prisma, { status: 'PENDING_ACTIVATION' });
    const r1 = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: disabled.username, password: TEST_PASSWORD })
      .expect(403);
    const r2 = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: pending.username, password: TEST_PASSWORD })
      .expect(403);
    expect(r1.body.code).toBe('AUTH_ACCOUNT_DISABLED');
    expect(r2.body.code).toBe('AUTH_ACCOUNT_NOT_ACTIVATED');
  });

  it('R01-3 未登录访问返回 401；登出后会话失效', async () => {
    const res = await anonymous(ctx).get('/api/auth/me').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');

    const agent = await loginAs(ctx, buyer);
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('R01-3 会话超过有效期（默认 12 小时）后返回 401', async () => {
    const agent = await loginAs(ctx, buyer);
    ctx.clock.advanceHours(13);
    await agent.get('/api/auth/me').expect(401);
  });

  it('R01-3 会话 cookie 的有效期是相对的 Max-Age（等于会话有效期），与服务端时钟的绝对时间无关', async () => {
    const res = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'buyer.a', password: TEST_PASSWORD })
      .expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/Max-Age=43200/);
  });

  it('R01-3 有操作时滑动续期并刷新 cookie', async () => {
    const agent = await loginAs(ctx, buyer);
    ctx.clock.advanceHours(6);
    const renewed = await agent.get('/api/auth/me').expect(200);
    expect(String(renewed.headers['set-cookie'])).toMatch(/qf_sid=/);
    ctx.clock.advanceHours(8); // 距登录 14 小时，距续期 8 小时
    await agent.get('/api/auth/me').expect(200);
  });

  it('R01-4 非 GET 请求缺少 X-Requested-With 返回 CSRF_REJECTED（公开接口也一样）', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'buyer.a', password: TEST_PASSWORD })
      .expect(403);
    expect(res.body.code).toBe('CSRF_REJECTED');
  });

  it('R01-12 修改密码：校验原密码和强度，成功后保留当前会话、注销其他会话', async () => {
    const user = await createUser(ctx.prisma);
    const a = await loginAs(ctx, user);
    const b = await loginAs(ctx, user);

    const wrong = await a
      .put('/api/auth/me/password')
      .send({ oldPassword: 'not-it-123', newPassword: 'NewPass123' })
      .expect(400);
    expect(wrong.body.code).toBe('AUTH_OLD_PASSWORD_WRONG');
    const weak = await a
      .put('/api/auth/me/password')
      .send({ oldPassword: TEST_PASSWORD, newPassword: 'short' })
      .expect(400);
    expect(weak.body.code).toBe('AUTH_PASSWORD_WEAK');

    await a.put('/api/auth/me/password').send({ oldPassword: TEST_PASSWORD, newPassword: 'NewPass123' }).expect(200);
    await a.get('/api/auth/me').expect(200);
    await b.get('/api/auth/me').expect(401);
    await loginAs(ctx, user, 'NewPass123');
  });

  it('R01-13 账号语言保存后，再次登录仍是该语言', async () => {
    const user = await createUser(ctx.prisma);
    const agent = await loginAs(ctx, user);
    const res = await agent.put('/api/auth/me/locale').send({ locale: 'en-US' }).expect(200);
    expect(res.body.user.locale).toBe('en-US');
    ctx.app.get(LoginRateLimiter).reset();
    const again = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD })
      .expect(200);
    expect(again.body.user.locale).toBe('en-US');
  });

  it('R01-15 同一 IP 每分钟最多 10 次登录尝试', async () => {
    for (let i = 0; i < 10; i += 1) {
      await anonymous(ctx).post('/api/auth/login').send({ username: 'buyer.a', password: 'bad-pass-1' }).expect(401);
    }
    const blocked = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'buyer.a', password: TEST_PASSWORD })
      .expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    ctx.clock.advance(61_000);
    await anonymous(ctx).post('/api/auth/login').send({ username: 'buyer.a', password: TEST_PASSWORD }).expect(200);
  });

  it('R01-14 登录成功和失败都记审计（失败只记用户名）', async () => {
    await anonymous(ctx).post('/api/auth/login').send({ username: 'ghost', password: 'bad-pass-1' }).expect(401);
    await loginAs(ctx, buyer);
    const failed = await ctx.prisma.auditLog.findFirst({ where: { action: 'auth.loginFailed', summary: 'ghost' } });
    const ok = await ctx.prisma.auditLog.findFirst({ where: { action: 'auth.login', actorId: buyer.id } });
    expect(failed).not.toBeNull();
    expect(ok).not.toBeNull();
  });

  describe('供应商用户', () => {
    let supplierUser: User;
    let supplierId: string;

    beforeAll(async () => {
      const supplier = await ctx.prisma.supplier.create({
        data: {
          code: 'SUP90001',
          nameZh: '测试供应商',
          categoryCode: 'NORMAL',
          contactName: 'Tester',
          contactEmail: 'sup@example.com',
        },
      });
      supplierId = supplier.id;
      supplierUser = await createUser(ctx.prisma, {
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId,
        username: 'sup@example.com',
        departmentCode: null,
      });
    });

    it('供应商可以访问通用接口，访问内部接口返回 403', async () => {
      const agent = await loginAs(ctx, supplierUser);
      const me = await agent.get('/api/auth/me').expect(200);
      expect(me.body.user.supplier).toMatchObject({ code: 'SUP90001' });
      expect(me.body.permissions).toEqual([]);
      await agent.get('/api/dicts?types=unit').expect(200);
      const res = await agent.get('/api/system/users').expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('P-6 供应商停用后会话立即失效，再登录返回 AUTH_ACCOUNT_DISABLED', async () => {
      const agent = await loginAs(ctx, supplierUser);
      await ctx.prisma.supplier.update({ where: { id: supplierId }, data: { status: 'DISABLED' } });
      await agent.get('/api/auth/me').expect(401);
      const res = await anonymous(ctx)
        .post('/api/auth/login')
        .send({ username: supplierUser.username, password: TEST_PASSWORD })
        .expect(403);
      expect(res.body.code).toBe('AUTH_ACCOUNT_DISABLED');
      await ctx.prisma.supplier.update({ where: { id: supplierId }, data: { status: 'ENABLED' } });
    });
  });
});
