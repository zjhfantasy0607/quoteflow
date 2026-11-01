import type {
  QuoteStatus,
  RoundStatus,
  StatsCycleTimeDto,
  StatsProjectsDto,
  StatsResponseSpeedDto,
  StatsWinRateDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';
import { binaryParser, loadXlsx, sheetRows } from './helpers/xlsx';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-12-15T00:00:00.000Z');

interface QuoteFixture {
  supplier: 'a' | 'b' | 'c';
  status: QuoteStatus;
  /** 邀请后多久首次响应；不填 = 没响应 */
  respondedAfter?: number;
  /** 曾提交过报价（有版本） */
  quoted?: boolean;
}

interface InquiryFixture {
  projectNo: string;
  /** 表头材料类别 */
  header: string;
  /** 第 1 轮询价行的分类 */
  lines: string[];
  publishedAt: string;
  deadline: string;
  roundStatus: RoundStatus;
  /** 评标完成 = 询盘完成 */
  evaluatedAt?: string;
  owner?: 'buyer' | 'manager';
  quotes: QuoteFixture[];
}

/**
 * M15 统计口径（§3、§8）：直接写库造已知邀请、响应、中标、完成时间的夹具（统计只读），断言每个指标的数值与分桶。
 * 当前时间 2026-12-15；I4 还没到截止。
 */
const FIXTURES: Record<string, InquiryFixture> = {
  // 1 月，项目 P-1，灯珠；A 恰好 2 小时、B 恰好 3 天、C 未响应；B 中标；周期 5 天
  i1: {
    projectNo: 'P-1',
    header: 'LED-2835',
    lines: ['LED-2835', 'LED-COB'],
    publishedAt: '2026-01-05T02:00:00Z',
    deadline: '2026-01-08T02:00:00Z',
    roundStatus: 'EVALUATED',
    evaluatedAt: '2026-01-10T02:00:00Z',
    quotes: [
      { supplier: 'a', status: 'LOST', respondedAfter: 2 * HOUR, quoted: true },
      { supplier: 'b', status: 'WON', respondedAfter: 3 * DAY, quoted: true },
      { supplier: 'c', status: 'INVITED' },
    ],
  },
  // 1 月，同一项目 P-1，灯外设（透镜 + 恒流电源，顶级都是 PER）；A 2 小时 1 分钟、C 恰好 24 小时（报过价后拒绝）；
  // A 中标；周期恰好 3 天
  i2: {
    projectNo: 'P-1',
    header: 'PER-LENS',
    lines: ['PER-LENS', 'DRV-CC'],
    publishedAt: '2026-01-20T02:00:00Z',
    deadline: '2026-01-22T02:00:00Z',
    roundStatus: 'EVALUATED',
    evaluatedAt: '2026-01-23T02:00:00Z',
    quotes: [
      { supplier: 'a', status: 'WON', respondedAfter: 2 * HOUR + 60_000, quoted: true },
      { supplier: 'c', status: 'DECLINED', respondedAfter: 24 * HOUR, quoted: true },
    ],
  },
  // UTC 10-31 17:00 = 北京时间 11-01 01:00，归入 11 月；B 3 天 + 1 毫秒、A 未响应；B 中标；周期 11.3 天
  i3: {
    projectNo: 'P-2',
    header: 'LED-COB',
    lines: ['LED-COB'],
    publishedAt: '2026-10-31T17:00:00Z',
    deadline: '2026-11-10T00:00:00Z',
    roundStatus: 'EVALUATED',
    evaluatedAt: '2026-11-12T00:00:00Z',
    quotes: [
      { supplier: 'b', status: 'WON', respondedAfter: 3 * DAY + 1, quoted: true },
      { supplier: 'a', status: 'INVITED' },
    ],
  },
  // 12 月，还没截止：A 没响应（不计）、B 1 小时
  i4: {
    projectNo: 'P-3',
    header: 'PER-DRV',
    lines: ['DRV-CC'],
    publishedAt: '2026-12-10T00:00:00Z',
    deadline: '2026-12-20T00:00:00Z',
    roundStatus: 'WAITING_QUOTES',
    quotes: [
      { supplier: 'a', status: 'INVITED' },
      { supplier: 'b', status: 'SUBMITTED', respondedAfter: HOUR, quoted: true },
    ],
  },
  // 北京时间 2025-12-31 23:59:59，属于 2025 年
  i5: {
    projectNo: 'P-9',
    header: 'LED-2835',
    lines: ['LED-2835'],
    publishedAt: '2025-12-31T15:59:59Z',
    deadline: '2026-01-03T00:00:00Z',
    roundStatus: 'WAITING_QUOTES',
    quotes: [{ supplier: 'a', status: 'SUBMITTED', respondedAfter: HOUR, quoted: true }],
  },
  // 3 月，采购员自己的单，已取消：A 作废前响应过（5 小时，计入）、B 作废时没响应（不计）
  i6: {
    projectNo: 'P-5',
    header: 'PER-LENS',
    lines: ['PER-LENS'],
    publishedAt: '2026-03-01T00:00:00Z',
    deadline: '2026-03-05T00:00:00Z',
    roundStatus: 'CANCELLED',
    owner: 'buyer',
    quotes: [
      { supplier: 'a', status: 'VOID', respondedAfter: 5 * HOUR, quoted: true },
      { supplier: 'b', status: 'VOID' },
    ],
  },
};

describe('M15 统计看板', () => {
  let ctx: TestContext;
  let users: Record<'buyer' | 'manager' | 'pd', User>;
  let agents: Record<'buyer' | 'manager' | 'pd', Agent>;
  let s: Record<'a' | 'b' | 'c', Supplier>;
  let category: Record<string, string>;

  async function seedInquiry(key: string, f: InquiryFixture): Promise<void> {
    const owner = users[f.owner ?? 'manager'];
    const publishedAt = new Date(f.publishedAt);
    const deadline = new Date(f.deadline);
    const evaluatedAt = f.evaluatedAt ? new Date(f.evaluatedAt) : null;
    const inquiry = await ctx.prisma.inquiry.create({
      data: {
        draftNo: `DR-FIX-${key}`,
        formalNo: `RFQ-FIX-${key}`,
        projectNo: f.projectNo,
        title: `统计夹具 ${key}`,
        materialCategoryId: category[f.header],
        docStatus: f.roundStatus === 'CANCELLED' ? 'CANCELLED' : 'APPROVED',
        currentRoundStatus: f.roundStatus,
        currentDeadline: deadline,
        ownerId: owner.id,
        createdById: owner.id,
        completedAt: evaluatedAt,
        rounds: {
          create: {
            roundNo: 1,
            status: f.roundStatus,
            deadline,
            publishedAt,
            openedAt: evaluatedAt ? deadline : null,
            evaluatedAt,
            createdById: owner.id,
            lines: {
              create: f.lines.map((code, i) => ({
                lineNo: i + 1,
                categoryId: category[code],
                nameZh: `物料 ${i + 1}`,
                spec: 'SPEC',
                unitCode: 'PCS',
                quantity: '100',
              })),
            },
          },
        },
      },
      include: { rounds: true },
    });
    for (const q of f.quotes) {
      const respondedAt =
        q.respondedAfter === undefined ? null : new Date(publishedAt.getTime() + q.respondedAfter);
      const quote = await ctx.prisma.quote.create({
        data: {
          roundId: inquiry.rounds[0].id,
          supplierId: s[q.supplier].id,
          status: q.status,
          invitedAt: publishedAt,
          respondedAt,
        },
      });
      if (!q.quoted) continue;
      const version = await ctx.prisma.quoteVersion.create({
        data: {
          quoteId: quote.id,
          versionNo: 1,
          source: 'ONLINE',
          values: { lines: [] },
          totalAmount: '100.00',
          currency: 'CNY',
          templateVersion: 1,
          variantCode: 'PPL-LED',
          submittedById: owner.id,
          submittedAt: respondedAt!,
        },
      });
      await ctx.prisma.quote.update({
        where: { id: quote.id },
        data: {
          currentVersionId: version.id,
          lastSubmittedAt: respondedAt,
          declinedAt: q.status === 'DECLINED' ? respondedAt : null,
        },
      });
    }
  }

  async function get<T>(agent: Agent, url: string): Promise<T> {
    return (await agent.get(url).expect(200)).body as T;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(NOW);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    users = {
      buyer: await createUser(ctx.prisma, { username: 'buyer', roles: ['BUYER'] }),
      manager: await createUser(ctx.prisma, { username: 'manager', roles: ['PURCHASE_MANAGER'] }),
      pd: await createUser(ctx.prisma, { username: 'pd', roles: ['PD'] }),
    };
    s = {
      a: await createSupplier(ctx.prisma, { code: 'TS-A', nameZh: '供应商甲', categoryCode: 'STRATEGIC' }),
      b: await createSupplier(ctx.prisma, { code: 'TS-B', nameZh: '供应商乙', categoryCode: 'EXCELLENT' }),
      c: await createSupplier(ctx.prisma, { code: 'TS-C', nameZh: '供应商丙', categoryCode: 'NORMAL' }),
    };
    for (const [key, f] of Object.entries(FIXTURES)) await seedInquiry(key, f);
    agents = {
      buyer: await loginAs(ctx, users.buyer),
      manager: await loginAs(ctx, users.manager),
      pd: await loginAs(ctx, users.pd),
    };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R15-1 年询盘项目数与品类：按北京时间归月，项目号、顶级分类去重；全年按顶级分类分布；默认当年', async () => {
    const data = await get<StatsProjectsDto>(agents.manager, '/api/stats/projects');
    expect(data.year).toBe(2026);
    const month = (m: string) => data.months.find((x) => x.month === m);
    expect(data.months).toHaveLength(12);
    expect(month('2026-01')).toEqual({
      month: '2026-01',
      inquiryCount: 2,
      projectCount: 1,
      categoryCount: 2,
    });
    expect(month('2026-03')).toEqual({
      month: '2026-03',
      inquiryCount: 1,
      projectCount: 1,
      categoryCount: 1,
    });
    // UTC 2026-10-31 17:00 归入 11 月
    expect(month('2026-10')).toMatchObject({ inquiryCount: 0 });
    expect(month('2026-11')).toEqual({
      month: '2026-11',
      inquiryCount: 1,
      projectCount: 1,
      categoryCount: 1,
    });
    expect(month('2026-12')).toMatchObject({ inquiryCount: 1 });
    expect(data.total).toEqual({ inquiryCount: 5, projectCount: 4, categoryCount: 2 });
    expect(data.categories.map((c) => [c.category.code, c.inquiryCount])).toEqual([
      ['PER', 3],
      ['LED', 2],
    ]);
    const y2025 = await get<StatsProjectsDto>(agents.manager, '/api/stats/projects?year=2025');
    expect(y2025.total.inquiryCount).toBe(1);
    expect(y2025.months[11]).toMatchObject({ month: '2025-12', inquiryCount: 1 });
  });

  it('R15-1 材料分类筛选包含下级（按询价单表头的材料类别）', async () => {
    const led = await get<StatsProjectsDto>(
      agents.manager,
      `/api/stats/projects?materialCategoryId=${category.LED}`,
    );
    expect(led.total).toEqual({ inquiryCount: 2, projectCount: 2, categoryCount: 1 });
    const drv = await get<StatsProjectsDto>(
      agents.manager,
      `/api/stats/projects?materialCategoryId=${category.PER}`,
    );
    expect(drv.total.inquiryCount).toBe(3);
    const cycle = await get<StatsCycleTimeDto>(
      agents.manager,
      `/api/stats/cycle-time?materialCategoryId=${category.LED}`,
    );
    expect(cycle.total).toBe(2);
  });

  it('R15-1 供应商响应速度：分桶含边界（恰好 2 小时 → ≤2 小时，恰好 3 天 → 1–3 天）；截止后未响应计入，未到截止、作废时未响应的不计', async () => {
    const data = await get<StatsResponseSpeedDto>(agents.manager, '/api/stats/response-speed');
    expect(data).toMatchObject({ from: '2026-01-01', to: '2026-12-31', total: 9 });
    expect(Object.fromEntries(data.buckets.map((b) => [b.bucket, b.count]))).toEqual({
      LE_2H: 2,
      H2_8: 2,
      H8_24: 1,
      D1_3: 1,
      GT_3D: 1,
      NO_RESPONSE: 2,
    });
    const row = (code: string) => data.suppliers.find((x) => x.supplier.code === code)!;
    expect(data.suppliers.map((x) => x.supplier.code)).toEqual(['TS-A', 'TS-B', 'TS-C']);
    expect(row('TS-A')).toMatchObject({ invitedCount: 4, respondedCount: 3, responseRate: 0.75 });
    expect(row('TS-A').avgResponseHours).toBeCloseTo((2 + 2 + 1 / 60 + 5) / 3, 6);
    expect(row('TS-B')).toMatchObject({ invitedCount: 3, respondedCount: 3, responseRate: 1 });
    expect(row('TS-C')).toMatchObject({
      invitedCount: 2,
      respondedCount: 1,
      responseRate: 0.5,
      avgResponseHours: 24,
    });
    expect(row('TS-A').supplier).toMatchObject({ nameZh: '供应商甲', categoryCode: 'STRATEGIC' });
  });

  it('R15-1 响应速度的日期区间按北京时间、含首尾两天；供应商分类、材料分类筛选', async () => {
    const nov = await get<StatsResponseSpeedDto>(
      agents.manager,
      '/api/stats/response-speed?from=2026-11-01&to=2026-11-30',
    );
    expect(nov.total).toBe(2);
    expect(nov.buckets.filter((b) => b.count > 0).map((b) => b.bucket)).toEqual(['GT_3D', 'NO_RESPONSE']);
    const oct = await get<StatsResponseSpeedDto>(
      agents.manager,
      '/api/stats/response-speed?from=2026-10-01&to=2026-10-31',
    );
    expect(oct.total).toBe(0);
    const strategic = await get<StatsResponseSpeedDto>(
      agents.manager,
      '/api/stats/response-speed?supplierCategoryCode=STRATEGIC',
    );
    expect(strategic.suppliers.map((x) => x.supplier.code)).toEqual(['TS-A']);
    expect(strategic.total).toBe(4);
    const led = await get<StatsResponseSpeedDto>(
      agents.manager,
      `/api/stats/response-speed?materialCategoryId=${category.LED}`,
    );
    expect(led.total).toBe(5);
    await agents.manager.get('/api/stats/response-speed?from=2026-12-01&to=2026-11-01').expect(400);
  });

  it('R15-1 中选次数与成功率：按评标完成月份，成功率 = 中标 ÷（中标 + 未中标）；每家的受邀、报价、中标与中标率', async () => {
    const data = await get<StatsWinRateDto>(agents.manager, '/api/stats/win-rate');
    expect(data.months).toHaveLength(12);
    expect(data.months[0]).toEqual({
      month: '2026-01',
      winCount: 2,
      participantCount: 3,
      successRate: 2 / 3,
    });
    expect(data.months[10]).toEqual({ month: '2026-11', winCount: 1, participantCount: 1, successRate: 1 });
    expect(data.months[2]).toEqual({ month: '2026-03', winCount: 0, participantCount: 0, successRate: null });
    expect(data.total).toEqual({ winCount: 3, participantCount: 4, successRate: 0.75 });
    expect(
      data.suppliers.map((x) => [x.supplier.code, x.invitedCount, x.quotedCount, x.wonCount, x.winRate]),
    ).toEqual([
      ['TS-A', 3, 2, 1, 0.5],
      ['TS-B', 2, 2, 2, 1],
      ['TS-C', 2, 1, 0, 0],
    ]);
    const onlyA = await get<StatsWinRateDto>(agents.manager, `/api/stats/win-rate?supplierId=${s.a.id}`);
    expect(onlyA.months[0]).toEqual({ month: '2026-01', winCount: 1, participantCount: 2, successRate: 0.5 });
    expect(onlyA.months[10]).toMatchObject({ winCount: 0, participantCount: 0, successRate: null });
    expect(onlyA.suppliers.map((x) => x.supplier.code)).toEqual(['TS-A']);
    const excellent = await get<StatsWinRateDto>(
      agents.manager,
      '/api/stats/win-rate?supplierCategoryCode=EXCELLENT',
    );
    expect(excellent.total).toEqual({ winCount: 2, participantCount: 2, successRate: 1 });
  });

  it('R15-1 询盘周期时效：完成时间落在区间内，周期保留 1 位小数，恰好 3 天归入 ≤3 天；按月平均周期', async () => {
    const data = await get<StatsCycleTimeDto>(agents.manager, '/api/stats/cycle-time');
    expect(data.total).toBe(3);
    expect(data.avgDays).toBeCloseTo((5 + 3 + 11.3) / 3, 6);
    expect(Object.fromEntries(data.buckets.map((b) => [b.bucket, b.count]))).toEqual({
      LE_3D: 1,
      D4_7: 1,
      D8_14: 1,
      D15_30: 0,
      GT_30D: 0,
    });
    expect(data.months[0]).toEqual({ month: '2026-01', count: 2, avgDays: 4 });
    expect(data.months[10]).toEqual({ month: '2026-11', count: 1, avgDays: 11.3 });
    const dec = await get<StatsCycleTimeDto>(agents.manager, '/api/stats/cycle-time?from=2026-12-01');
    expect(dec).toMatchObject({ from: '2026-12-01', to: '2026-12-31', total: 0, avgDays: null });
  });

  it('统计叠加数据权限：采购员（本人）只看到自己的询价单', async () => {
    const projects = await get<StatsProjectsDto>(agents.buyer, '/api/stats/projects');
    expect(projects.total).toEqual({ inquiryCount: 1, projectCount: 1, categoryCount: 1 });
    const response = await get<StatsResponseSpeedDto>(agents.buyer, '/api/stats/response-speed');
    expect(response.total).toBe(1);
    expect(response.suppliers.map((x) => [x.supplier.code, x.invitedCount])).toEqual([['TS-A', 1]]);
    const win = await get<StatsWinRateDto>(agents.buyer, '/api/stats/win-rate');
    expect(win.total.winCount).toBe(0);
  });

  it('权限：没有 stats:view 403；导出要 report:export', async () => {
    for (const path of ['projects', 'response-speed', 'win-rate', 'cycle-time', 'export']) {
      expect((await agents.pd.get(`/api/stats/${path}`).expect(403)).body.code).toBe('FORBIDDEN');
    }
    expect((await agents.buyer.get('/api/stats/export').expect(403)).body.code).toBe('FORBIDDEN');
  });

  it('R15-2 统计导出：一个 xlsx，每张图一个 sheet，数据与接口一致', async () => {
    const res = await agents.manager
      .get('/api/stats/export?from=2026-01-01&to=2026-12-31&year=2026')
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('统计看板'));
    const wb = await loadXlsx(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      '年询盘项目数与品类',
      '供应商响应速度',
      '中选次数与成功率',
      '询盘周期时效',
    ]);
    const projects = sheetRows(wb.getWorksheet('年询盘项目数与品类')!);
    expect(projects.find((r) => r[0] === '2026-01')).toEqual(['2026-01', 2, 1, 2]);
    expect(projects.find((r) => r[0] === '合计')).toEqual(['合计', 5, 4, 2]);
    expect(projects.find((r) => String(r[0]).startsWith('PER'))?.[1]).toBe(3);
    const response = sheetRows(wb.getWorksheet('供应商响应速度')!);
    expect(response.find((r) => r[0] === '≤2 小时')?.slice(0, 2)).toEqual(['≤2 小时', 2]);
    expect(response.find((r) => r[0] === '未响应')?.slice(0, 2)).toEqual(['未响应', 2]);
    expect(response.find((r) => r[0] === 'TS-A')?.slice(0, 6)).toEqual([
      'TS-A',
      '供应商甲',
      '战略供应商',
      4,
      3,
      0.75,
    ]);
    const win = sheetRows(wb.getWorksheet('中选次数与成功率')!);
    expect(win.find((r) => r[0] === '合计')).toEqual(['合计', 3, 4, 0.75, null, null, null]);
    const cycle = sheetRows(wb.getWorksheet('询盘周期时效')!);
    expect(cycle.find((r) => r[0] === '≤3 天')?.slice(0, 2)).toEqual(['≤3 天', 1]);
    expect(cycle.find((r) => r[0] === '2026-11')).toEqual(['2026-11', 1, 11.3]);
  });
});
