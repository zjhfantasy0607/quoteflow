import { LoginRateLimiter } from '../src/common/auth/login-rate-limiter';
import { MailOutboxJob } from '../src/infra/mail/mail-outbox.job';
import { MailService, MailTransport } from '../src/infra/mail/mail.service';
import { Agent, anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

/** 可控的发送器：fail = true 时抛错 */
const transport = {
  fail: false,
  sent: [] as { toAddresses: string[]; subject: string }[],
  async send(m: { toAddresses: string[]; subject: string }) {
    if (this.fail) throw new Error('SMTP down');
    this.sent.push(m);
  },
};

describe('M02 邮件发件箱与找回密码', () => {
  let ctx: TestContext;
  let admin: Agent;
  let mail: MailService;
  let job: MailOutboxJob;

  beforeAll(async () => {
    ctx = await createTestApp({ overrides: [{ provide: MailTransport, useValue: transport }] });
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    admin = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['ADMIN'] }));
    mail = ctx.app.get(MailService);
    job = ctx.app.get(MailOutboxJob);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    transport.fail = false;
    transport.sent = [];
    await ctx.prisma.emailMessage.deleteMany();
  });

  const enqueue = (bizKey?: string, language: 'zh-CN' | 'en-US' | 'bilingual' = 'zh-CN') =>
    mail.enqueue(ctx.prisma, {
      templateKey: 'account.resetPassword',
      language,
      to: ['Someone@Example.com'],
      cc: ['someone@example.com', 'boss@example.com'],
      data: { name: '<b>张三</b>', link: 'http://x/reset?token=abc', expiresAt: new Date('2026-11-02T09:00:00Z') },
      bizKey,
    });

  it('R02-7 入队即渲染，收件人去重转小写，HTML 转义业务数据', async () => {
    await enqueue();
    const m = await ctx.prisma.emailMessage.findFirstOrThrow();
    expect(m).toMatchObject({ status: 'PENDING', type: 'ACCOUNT', toAddresses: ['someone@example.com'], ccAddresses: ['boss@example.com'] });
    expect(m.html).toContain('&lt;b&gt;张三&lt;/b&gt;');
    expect(m.html).not.toContain('<b>张三</b>');
    expect(m.text).toContain('2026-11-02 17:00（北京时间 UTC+8）');
  });

  it('R02-8 bilingual 主题为"中文 / English"，正文中英两段', async () => {
    await enqueue(undefined, 'bilingual');
    const m = await ctx.prisma.emailMessage.findFirstOrThrow();
    expect(m.subject).toBe('重置 QuoteFlow 账号密码 / Reset your QuoteFlow password');
    expect(m.html).toContain('设置新密码');
    expect(m.html).toContain('Set a new password');
    expect(m.text).toContain('Beijing Time, UTC+8');
  });

  it('R02-7 bizKey 重复时只入队一次', async () => {
    await enqueue('K1');
    await enqueue('K1');
    expect(await ctx.prisma.emailMessage.count()).toBe(1);
  });

  it('R02-7 发送成功标记 SENT', async () => {
    await enqueue();
    const result = await job.run();
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(transport.sent).toHaveLength(1);
    expect((await ctx.prisma.emailMessage.findFirstOrThrow()).status).toBe('SENT');
  });

  it('R02-7 失败按 1/5/15/60 分钟退避重试，第 5 次失败标记 FAILED；重发恢复', async () => {
    await enqueue();
    transport.fail = true;
    const waits = [1, 5, 15, 60];
    for (const minutes of waits) {
      await job.run();
      const m = await ctx.prisma.emailMessage.findFirstOrThrow();
      expect(m.status).toBe('PENDING');
      expect(m.nextAttemptAt.getTime() - ctx.clock.now().getTime()).toBe(minutes * 60_000);
      expect(await job.run()).toEqual({ sent: 0, failed: 0 }); // 未到时间不发
      ctx.clock.advance(minutes * 60_000);
    }
    await job.run();
    const failed = await ctx.prisma.emailMessage.findFirstOrThrow();
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'SMTP down' });

    transport.fail = false;
    await admin.post(`/api/system/emails/${failed.id}/resend`).expect(200);
    await job.run();
    expect((await ctx.prisma.emailMessage.findFirstOrThrow()).status).toBe('SENT');
  });

  it('邮件记录可以筛选与查看正文', async () => {
    await enqueue();
    const list = await admin.get('/api/system/emails').query({ type: 'ACCOUNT', keyword: 'someone@example.com' }).expect(200);
    expect(list.body.total).toBe(1);
    const detail = await admin.get(`/api/system/emails/${list.body.items[0].id}`).expect(200);
    expect(detail.body.html).toContain('<!doctype html>');
  });

  describe('找回密码', () => {
    beforeEach(() => ctx.app.get(LoginRateLimiter).reset());

    it('R02-11 不存在的邮箱也返回成功且不发邮件', async () => {
      await anonymous(ctx).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(200);
      expect(await ctx.prisma.emailMessage.count()).toBe(0);
    });

    it('R02-11 用邮件里的链接重置密码；令牌只能用一次、1 小时过期；旧会话失效', async () => {
      const user = await createUser(ctx.prisma, { email: 'reset.me@example.com', locale: 'en-US' });
      const session = await loginAs(ctx, user);
      await anonymous(ctx).post('/api/auth/forgot-password').send({ email: 'RESET.ME@example.com' }).expect(200);
      const m = await ctx.prisma.emailMessage.findFirstOrThrow();
      expect(m.language).toBe('en-US');
      const token = decodeURIComponent(/token=([^"&\s<]+)/.exec(m.text)![1]);

      const weak = await anonymous(ctx).post('/api/auth/reset-password').send({ token, newPassword: 'weak' }).expect(400);
      expect(weak.body.code).toBe('AUTH_PASSWORD_WEAK');
      await anonymous(ctx).post('/api/auth/reset-password').send({ token, newPassword: 'Brand2New' }).expect(200);
      const again = await anonymous(ctx).post('/api/auth/reset-password').send({ token, newPassword: 'Brand3New' }).expect(400);
      expect(again.body.code).toBe('AUTH_TOKEN_INVALID');

      await session.get('/api/auth/me').expect(401);
      await loginAs(ctx, user, 'Brand2New');

      await anonymous(ctx).post('/api/auth/forgot-password').send({ email: 'reset.me@example.com' }).expect(200);
      const second = await ctx.prisma.emailMessage.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      const token2 = decodeURIComponent(/token=([^"&\s<]+)/.exec(second.text)![1]);
      ctx.clock.advanceHours(2);
      const expired = await anonymous(ctx).post('/api/auth/reset-password').send({ token: token2, newPassword: 'Brand4New' }).expect(400);
      expect(expired.body.code).toBe('AUTH_TOKEN_INVALID');
    });
  });
});
