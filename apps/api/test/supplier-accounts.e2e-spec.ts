import { seedMaterialCategories } from '../prisma/seed-data/materials';
import { seedSuppliers } from '../prisma/seed-data/suppliers';
import { hashPassword } from '../src/common/auth/password';
import type { User } from '../src/generated/prisma/client';
import { Agent, anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

describe('M04 供应商门户账号与激活', () => {
  let ctx: TestContext;
  let buyer: Agent;
  let pd: Agent;
  /** 有 supplier:view，没有 supplier:account 和 supplier.contact */
  let viewer: Agent;
  let users: Record<'buyer' | 'pd' | 'viewer', User>;
  let supplierId: Record<string, string>;

  /** 时钟前进超过会话有效期（12 小时）后重新登录 */
  async function loginAll(): Promise<void> {
    buyer = await loginAs(ctx, users.buyer);
    pd = await loginAs(ctx, users.pd);
    viewer = await loginAs(ctx, users.viewer);
  }

  /** 最近一封发给 to 的邮件里的激活令牌 */
  async function activationToken(to: string): Promise<string> {
    const mail = await ctx.prisma.emailMessage.findFirstOrThrow({
      where: { toAddresses: { has: to } },
      orderBy: { createdAt: 'desc' },
    });
    return decodeURIComponent(/activate\?token=([^"&\s<]+)/.exec(mail.text)![1]);
  }

  function activate(token: string, newPassword = 'Portal2026') {
    return anonymous(ctx).post('/api/auth/activate').send({ token, newPassword });
  }

  function openAccount(supplierCode: string, email: string, name = '测试联系人') {
    return buyer.post(`/api/suppliers/${supplierId[supplierCode]}/accounts`).send({ email, name });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await seedSuppliers(ctx.prisma, hashPassword);
    supplierId = Object.fromEntries((await ctx.prisma.supplier.findMany()).map((s) => [s.code, s.id]));
    await ctx.prisma.role.create({
      data: {
        code: 'SUPPLIER_VIEWER',
        nameZh: '供应商查看',
        nameEn: 'Supplier viewer',
        dataScope: 'SELF',
        permissions: ['supplier:view'],
        fieldPermissions: [],
      },
    });
    users = {
      buyer: await createUser(ctx.prisma, { roles: ['BUYER'], email: 'buyer.test@example.com' }),
      pd: await createUser(ctx.prisma, { roles: ['PD'] }),
      viewer: await createUser(ctx.prisma, { roles: ['SUPPLIER_VIEWER'] }),
    };
    await loginAll();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('种子数据：有门户账号的供应商可以直接登录门户', async () => {
    const res = await buyer.get(`/api/suppliers/${supplierId.SUP10006}/accounts`).expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        username: 'kevin@brightsource.example.com',
        name: 'Kevin Wong',
        status: 'ACTIVE',
        locale: 'en-US',
        activationExpiresAt: null,
      }),
    ]);
    await loginAs(ctx, { username: 'kevin@brightsource.example.com' });
    expect((await buyer.get(`/api/suppliers/${supplierId.SUP10008}/accounts`).expect(200)).body).toEqual([]);
  });

  it('R04-10 给 SUP10008 开通账号：待激活、角色 SUPPLIER，按供应商首选语言发激活邮件（7 天有效）', async () => {
    const res = await openAccount('SUP10008', ' Erik@NordicDriver.Example.com ', 'Erik Larsson').expect(201);
    const expires = new Date(ctx.clock.now().getTime() + 7 * 24 * 3600_000).toISOString();
    expect(res.body).toMatchObject({
      username: 'erik@nordicdriver.example.com',
      email: 'erik@nordicdriver.example.com',
      name: 'Erik Larsson',
      status: 'PENDING_ACTIVATION',
      locale: 'en-US',
      lastLoginAt: null,
      activationExpiresAt: expires,
    });

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { roles: { include: { role: true } } },
    });
    expect(user).toMatchObject({ userType: 'SUPPLIER', supplierId: supplierId.SUP10008, passwordHash: null });
    expect(user.roles.map((r) => r.role.code)).toEqual(['SUPPLIER']);

    const mail = await ctx.prisma.emailMessage.findFirstOrThrow({ where: { userId: user.id } });
    expect(mail).toMatchObject({
      type: 'ACCOUNT',
      language: 'en-US',
      toAddresses: ['erik@nordicdriver.example.com'],
      supplierId: supplierId.SUP10008,
      status: 'PENDING',
    });
    expect(mail.subject).toBe('Activate your Example Lighting Co., Ltd. supplier portal account');
    expect(mail.text).toContain('Nordic Driver Solutions AB');
    expect(mail.text).toMatch(/\/activate\?token=[^&\s]+&lang=en-US/);
    expect(mail.text).toContain('(Beijing Time, UTC+8)');

    // 激活前不能登录
    await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'erik@nordicdriver.example.com', password: 'x' })
      .expect(401);
  });

  it('R04-11 用激活邮件里的链接设置密码 → 启用，能登录门户；链接只能用一次', async () => {
    const token = await activationToken('erik@nordicdriver.example.com');
    const weak = await activate(token, 'weak').expect(400);
    expect(weak.body.code).toBe('AUTH_PASSWORD_WEAK');
    await activate(token).expect(200); // 密码太弱时链接没有被消耗
    const again = await activate(token, 'Another2026').expect(400);
    expect(again.body.code).toBe('AUTH_TOKEN_INVALID');

    const portal = await loginAs(ctx, { username: 'Erik@NordicDriver.example.com' }, 'Portal2026');
    const me = await portal.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({
      userType: 'SUPPLIER',
      locale: 'en-US',
      supplier: { code: 'SUP10008', nameEn: 'Nordic Driver Solutions AB' },
    });
    await portal.get('/api/suppliers').expect(403);

    const list = await buyer.get(`/api/suppliers/${supplierId.SUP10008}/accounts`).expect(200);
    expect(list.body[0]).toMatchObject({ status: 'ACTIVE', activationExpiresAt: null });
    expect(list.body[0].lastLoginAt).not.toBeNull();
  });

  it('R04-11 无效的令牌返回 AUTH_TOKEN_INVALID；重置密码的令牌不能用来激活', async () => {
    const res = await activate('x'.repeat(43)).expect(400);
    expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
    await activate('short').expect(400);

    await loginAs(ctx, { username: 'kevin@brightsource.example.com' }); // 顺便清空限流计数
    await anonymous(ctx)
      .post('/api/auth/forgot-password')
      .send({ email: 'kevin@brightsource.example.com' })
      .expect(200);
    const mail = await ctx.prisma.emailMessage.findFirstOrThrow({
      where: { toAddresses: { has: 'kevin@brightsource.example.com' } },
    });
    const resetToken = decodeURIComponent(/reset-password\?token=([^"&\s<]+)/.exec(mail.text)![1]);
    expect((await activate(resetToken).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('R04-10 邮箱在全部用户中唯一（不区分大小写），重复返回 SUPPLIER_ACCOUNT_EXISTS', async () => {
    // 已有的门户账号、种子供应商账号、内部用户的邮箱
    for (const email of [
      'ERIK@nordicdriver.example.com',
      'sales@huaxin.example.com',
      'buyer.test@example.com',
    ]) {
      const res = await openAccount('SUP10008', email).expect(409);
      expect(res.body.code).toBe('SUPPLIER_ACCOUNT_EXISTS');
    }
    await openAccount('SUP10008', 'not-an-email').expect(400);
  });

  it('R04-10 供应商必须启用；不存在的供应商 404', async () => {
    const res = await openAccount('SUP10007', 'someone@haina.example.com').expect(409);
    expect(res.body.code).toBe('SUPPLIER_DISABLED');
    await buyer
      .post('/api/suppliers/nope/accounts')
      .send({ email: 'a@b.example.com', name: 'A' })
      .expect(404);
    await buyer.get('/api/suppliers/nope/accounts').expect(404);
  });

  it('R04-10 重发激活邮件使旧链接失效；双语供应商收双语邮件；链接 7 天后过期', async () => {
    const created = await openAccount('SUP10002', 'second@zhuoyue.example.com', '赵工').expect(201);
    const first = await activationToken('second@zhuoyue.example.com');
    const mail = await ctx.prisma.emailMessage.findFirstOrThrow({ where: { userId: created.body.id } });
    expect(mail.language).toBe('bilingual');
    expect(mail.subject).toBe(
      '激活您的 示例照明科技有限公司 供应商门户账号 / Activate your Example Lighting Co., Ltd. supplier portal account',
    );
    expect(mail.text).not.toContain('&lang=');

    ctx.clock.advanceHours(1);
    const resent = await buyer
      .post(`/api/suppliers/${supplierId.SUP10002}/accounts/${created.body.id}/resend-activation`)
      .expect(200);
    expect(resent.body.status).toBe('PENDING_ACTIVATION');
    expect(await ctx.prisma.emailMessage.count({ where: { userId: created.body.id } })).toBe(2);
    const second = await activationToken('second@zhuoyue.example.com');
    expect(second).not.toBe(first);
    expect((await activate(first).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');

    ctx.clock.advanceHours(7 * 24 + 1);
    expect((await activate(second).expect(400)).body.code).toBe('AUTH_TOKEN_INVALID');
    await loginAll();

    // 过期后重发一封新的就能激活
    await buyer
      .post(`/api/suppliers/${supplierId.SUP10002}/accounts/${created.body.id}/resend-activation`)
      .expect(200);
    await activate(await activationToken('second@zhuoyue.example.com')).expect(200);

    // 已激活的账号不能再重发
    const active = await buyer
      .post(`/api/suppliers/${supplierId.SUP10002}/accounts/${created.body.id}/resend-activation`)
      .expect(409);
    expect(active.body.code).toBe('SUPPLIER_ACCOUNT_NOT_PENDING');
  });

  it('R04-6 停用供应商后其账号登录返回 AUTH_ACCOUNT_DISABLED，会话立即失效，也不能激活', async () => {
    const portal = await loginAs(ctx, { username: 'erik@nordicdriver.example.com' }, 'Portal2026');
    const pending = await openAccount('SUP10008', 'pending@nordicdriver.example.com', 'Pending User').expect(
      201,
    );
    const token = await activationToken('pending@nordicdriver.example.com');

    await buyer.put(`/api/suppliers/${supplierId.SUP10008}/status`).send({ status: 'DISABLED' }).expect(200);
    await portal.get('/api/auth/me').expect(401);
    const login = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'erik@nordicdriver.example.com', password: 'Portal2026' })
      .expect(403);
    expect(login.body.code).toBe('AUTH_ACCOUNT_DISABLED');
    const blocked = await activate(token).expect(403);
    expect(blocked.body.code).toBe('AUTH_ACCOUNT_DISABLED');
    const resend = await buyer
      .post(`/api/suppliers/${supplierId.SUP10008}/accounts/${pending.body.id}/resend-activation`)
      .expect(409);
    expect(resend.body.code).toBe('SUPPLIER_DISABLED');

    await buyer.put(`/api/suppliers/${supplierId.SUP10008}/status`).send({ status: 'ENABLED' }).expect(200);
    await loginAs(ctx, { username: 'erik@nordicdriver.example.com' }, 'Portal2026');
    await activate(token).expect(200); // 停用期间链接没有被消耗
  });

  it('账号停用：会话删除、不能登录；启用后设置过密码的恢复启用，没激活过的回到待激活', async () => {
    const accountPath = (userId: string) => `/api/suppliers/${supplierId.SUP10005}/accounts/${userId}`;
    const seeded = await ctx.prisma.user.findUniqueOrThrow({
      where: { username: 'sales@lianchuang.example.com' },
    });
    const portal = await loginAs(ctx, seeded);

    const disabled = await buyer
      .put(`${accountPath(seeded.id)}/status`)
      .send({ status: 'DISABLED' })
      .expect(200);
    expect(disabled.body.status).toBe('DISABLED');
    await portal.get('/api/auth/me').expect(401);
    const login = await anonymous(ctx)
      .post('/api/auth/login')
      .send({ username: 'sales@lianchuang.example.com', password: 'Passw0rd!' })
      .expect(403);
    expect(login.body.code).toBe('AUTH_ACCOUNT_DISABLED');
    const enabled = await buyer
      .put(`${accountPath(seeded.id)}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(enabled.body.status).toBe('ACTIVE');
    await loginAs(ctx, seeded);

    const fresh = await buyer
      .post(`/api/suppliers/${supplierId.SUP10005}/accounts`)
      .send({ email: 'new@lianchuang.example.com', name: '新同事' })
      .expect(201);
    const token = await activationToken('new@lianchuang.example.com');
    await buyer
      .put(`${accountPath(fresh.body.id)}/status`)
      .send({ status: 'DISABLED' })
      .expect(200);
    expect((await activate(token).expect(403)).body.code).toBe('AUTH_ACCOUNT_DISABLED');
    await buyer.post(`${accountPath(fresh.body.id)}/resend-activation`).expect(409);
    const back = await buyer
      .put(`${accountPath(fresh.body.id)}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(back.body.status).toBe('PENDING_ACTIVATION');
    await activate(token).expect(200);

    // 别家供应商的账号按不存在处理
    await buyer
      .put(`/api/suppliers/${supplierId.SUP10001}/accounts/${seeded.id}/status`)
      .send({ status: 'DISABLED' })
      .expect(404);
    await buyer
      .put(`${accountPath(seeded.id)}/status`)
      .send({ status: 'PENDING_ACTIVATION' })
      .expect(400);
  });

  it('权限：查看账号要 supplier:view，开通和管理要 supplier:account；没有 supplier.contact 时账号邮箱脱敏', async () => {
    const list = await viewer.get(`/api/suppliers/${supplierId.SUP10001}/accounts`).expect(200);
    expect(list.body[0]).toMatchObject({
      name: '陈经理',
      username: null,
      email: null,
      status: 'ACTIVE',
      maskedFields: ['username', 'email'],
    });
    await viewer
      .post(`/api/suppliers/${supplierId.SUP10001}/accounts`)
      .send({ email: 'x@huaxin.example.com', name: 'X' })
      .expect(403);
    await viewer
      .put(`/api/suppliers/${supplierId.SUP10001}/accounts/${list.body[0].id}/status`)
      .send({ status: 'DISABLED' })
      .expect(403);
    await pd.get(`/api/suppliers/${supplierId.SUP10001}/accounts`).expect(403);
  });

  it('R04-12 开通、重发激活、启停用账号和激活都记审计，摘要里没有邮箱', async () => {
    const logs = await ctx.prisma.auditLog.findMany({
      where: { action: { startsWith: 'supplierAccount.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(new Set(logs.map((l) => l.action))).toEqual(
      new Set([
        'supplierAccount.create',
        'supplierAccount.resendActivation',
        'supplierAccount.disable',
        'supplierAccount.enable',
      ]),
    );
    expect(logs[0]).toMatchObject({ entityType: 'user', summary: 'SUP10008 Erik Larsson' });
    expect(logs.some((l) => l.summary?.includes('@'))).toBe(false);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.activate' } })).toBe(4);
  });
});
