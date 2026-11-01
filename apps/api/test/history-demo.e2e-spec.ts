import type { StatsCycleTimeDto, StatsResponseSpeedDto } from '@quoteflow/shared';
import { HISTORY_PROJECT_PREFIX, seedHistory } from '../prisma/demo/history';
import { demoContext } from '../prisma/demo/scenarios';
import { seedInternalUsers } from '../prisma/seed-data/base';
import { seedMaterialCategories, seedMaterials } from '../prisma/seed-data/materials';
import { seedSuppliers } from '../prisma/seed-data/suppliers';
import { hashPassword } from '../src/common/auth/password';
import { ClockService } from '../src/common/clock/clock.service';
import { inAppTz } from '../src/common/time';
import { loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

const COUNT = 8;
const SPAN_DAYS = 150;

/**
 * R15-5 历史演示数据 H：在测试库上用基础数据跑一遍 seedHistory()（张数少一些），检查 02 §3 的不变量、时间顺序和项目号。
 * H 用时钟偏移造过去的时间（与 db:seed:demo 相同），所以这里换回真实时钟
 */
describe('M15 历史演示数据 H', () => {
  let ctx: TestContext;
  let result: Awaited<ReturnType<typeof seedHistory>>;

  beforeAll(async () => {
    ctx = await createTestApp({ overrides: [{ provide: ClockService, useValue: new ClockService() }] });
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await seedMaterials(ctx.prisma);
    await seedInternalUsers(ctx.prisma, hashPassword);
    await seedSuppliers(ctx.prisma, hashPassword);
    result = await seedHistory(await demoContext(ctx.app), { count: COUNT, spanDays: SPAN_DAYS });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('R15-5 每张都已完成，项目号以 HIST- 开头；满足 I-1 ~ I-3、I-5 ~ I-9', async () => {
    expect(result).toMatchObject({ inquiries: COUNT, contracts: COUNT });
    const inquiries = await ctx.prisma.inquiry.findMany({
      include: {
        rounds: { include: { quotes: { include: { versions: true } } } },
        invitees: true,
        contract: true,
      },
    });
    expect(inquiries).toHaveLength(COUNT);
    const now = Date.now();
    for (const inquiry of inquiries) {
      expect(inquiry.projectNo.startsWith(HISTORY_PROJECT_PREFIX)).toBe(true);
      expect(inquiry).toMatchObject({
        docStatus: 'APPROVED',
        currentRoundNo: 1,
        currentRoundStatus: 'EVALUATED',
      });
      // I-1、I-3
      expect(inquiry.rounds.map((r) => r.roundNo)).toEqual([1]);
      const round = inquiry.rounds[0];
      // I-2
      expect(inquiry.currentDeadline).toEqual(round.deadline);
      expect(round.status).toBe('EVALUATED');
      // 时间顺序：发布 < 截止 ≤ 报价完成 ≤ 开标 ≤ 评标完成 = 询盘完成 < 现在
      const t = (d: Date | null) => d!.getTime();
      expect(t(round.publishedAt)).toBeLessThan(t(round.deadline));
      expect(t(round.deadline)).toBeLessThanOrEqual(t(round.quotesClosedAt));
      expect(t(round.quotesClosedAt)).toBeLessThanOrEqual(t(round.openedAt));
      expect(t(round.openedAt)).toBeLessThanOrEqual(t(round.evaluatedAt));
      expect(inquiry.completedAt).toEqual(round.evaluatedAt);
      expect(t(inquiry.completedAt)).toBeLessThan(now);
      expect(t(round.publishedAt)).toBeGreaterThan(now - (SPAN_DAYS + 1) * 24 * 3600_000);
      // I-5：受邀名单里每家一张报价单
      expect(round.quotes.map((q) => q.supplierId).sort()).toEqual(
        inquiry.invitees.map((i) => i.supplierId).sort(),
      );
      for (const quote of round.quotes) {
        // I-6
        const numbers = quote.versions.map((v) => v.versionNo).sort((a, b) => a - b);
        expect(numbers).toEqual(numbers.map((_, i) => i + 1));
        if (quote.currentVersionId)
          expect(quote.versions.some((v) => v.id === quote.currentVersionId)).toBe(true);
        if (quote.respondedAt) expect(t(quote.respondedAt)).toBeLessThan(t(round.deadline));
        expect(['WON', 'LOST', 'INVITED', 'DECLINED']).toContain(quote.status);
      }
      // I-7、I-8
      expect(round.quotes.filter((q) => q.shortlisted).length).toBeLessThanOrEqual(2);
      const won = round.quotes.filter((q) => q.status === 'WON');
      expect(won).toHaveLength(1);
      // I-9：合同与中标报价对应，已批准
      expect(inquiry.contract).toMatchObject({ quoteId: won[0].id, status: 'APPROVED', roundId: round.id });
    }
  });

  it('R15-5 积分与邮件：每轮开标结算、中标 +5；历史邮件都已标记为已发送', async () => {
    const won = await ctx.prisma.supplierPointsEntry.findMany({ where: { ruleCode: 'WON' } });
    expect(won).toHaveLength(COUNT);
    expect(
      await ctx.prisma.supplierPointsEntry.count({ where: { ruleCode: 'QUOTE_ON_TIME' } }),
    ).toBeGreaterThan(0);
    expect(await ctx.prisma.supplierPointsEntry.count({ where: { ruleCode: 'MANUAL' } })).toBe(4);
    expect(await ctx.prisma.emailMessage.count({ where: { status: 'PENDING' } })).toBe(0);
    expect(result.emails).toBe(await ctx.prisma.emailMessage.count());
  });

  it('统计看板能直接用这些数据：完成的询价都在周期时效里，响应速度有数据', async () => {
    const manager = await ctx.prisma.user.findUniqueOrThrow({ where: { username: 'manager.zhang' } });
    const agent = await loginAs(ctx, manager);
    const from = inAppTz(new Date(Date.now() - (SPAN_DAYS + 5) * 24 * 3600_000)).format('YYYY-MM-DD');
    const to = inAppTz(new Date()).format('YYYY-MM-DD');
    const cycle: StatsCycleTimeDto = (
      await agent.get(`/api/stats/cycle-time?from=${from}&to=${to}`).expect(200)
    ).body;
    expect(cycle.total).toBe(COUNT);
    const speed: StatsResponseSpeedDto = (
      await agent.get(`/api/stats/response-speed?from=${from}&to=${to}`).expect(200)
    ).body;
    expect(speed.total).toBeGreaterThanOrEqual(COUNT * 2);
  });
});
