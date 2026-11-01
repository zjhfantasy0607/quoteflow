import { Injectable } from '@nestjs/common';
import type {
  StatsCategoryDto,
  StatsCycleTimeDto,
  StatsCycleTimeQuery,
  StatsProjectsDto,
  StatsProjectsQuery,
  StatsResponseSpeedDto,
  StatsResponseSpeedQuery,
  StatsSupplierDto,
  StatsWinRateDto,
  StatsWinRateQuery,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import { ClockService } from '../../common/clock/clock.service';
import { inAppTz } from '../../common/time';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MaterialCategoriesService,
  type CategoryIndex,
} from '../material-categories/material-categories.service';
import {
  aggregateCycleTime,
  aggregateProjects,
  aggregateResponseSpeed,
  aggregateWinRate,
  monthsBetween,
  rangeBounds,
} from './stats-aggregate';

/** 实际使用的日期区间（YYYY-MM-DD） */
export interface StatsRange {
  from: string;
  to: string;
}

/**
 * 统计看板（M15 §3，#13–17）：按口径查出千级的行，交给 stats-aggregate 的纯函数分组计数（R15-1）。
 * 都是询价派生的数据，叠加数据权限（05 §11）；材料分类筛选按询价单表头的分类，包含下级（与询价列表一致）。
 * 只有次数、比率、时长，不含报价金额
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly categories: MaterialCategoriesService,
    private readonly clock: ClockService,
  ) {}

  private currentYear(): number {
    return inAppTz(this.clock.now()).year();
  }

  /** 区间省略的一端：from 取 to 那年（或当年）的 1 月 1 日，to 取 from 那年（或当年）的 12 月 31 日 */
  range(query: { from?: string; to?: string }): StatsRange {
    const year = this.currentYear();
    return {
      from: query.from ?? `${query.to?.slice(0, 4) ?? year}-01-01`,
      to: query.to ?? `${query.from?.slice(0, 4) ?? year}-12-31`,
    };
  }

  /** 数据权限 + 材料分类（含下级） */
  private inquiryWhere(
    user: AuthUser,
    index: CategoryIndex,
    materialCategoryId?: string,
  ): Prisma.InquiryWhereInput {
    const and: Prisma.InquiryWhereInput[] = [this.scope.inquiryWhere(user)];
    if (materialCategoryId) and.push({ materialCategoryId: { in: index.subtreeIds(materialCategoryId) } });
    return { AND: and };
  }

  /** #13、#14：第 1 轮发布在该年的询价单，按月；品类 = 第 1 轮询价行分类的顶级祖先 */
  async projects(user: AuthUser, query: StatsProjectsQuery): Promise<StatsProjectsDto> {
    const year = query.year ?? this.currentYear();
    const index = await this.categories.loadIndex();
    const rounds = await this.prisma.inquiryRound.findMany({
      where: {
        roundNo: 1,
        publishedAt: rangeBounds(`${year}-01-01`, `${year}-12-31`),
        inquiry: this.inquiryWhere(user, index, query.materialCategoryId),
      },
      select: {
        publishedAt: true,
        inquiry: { select: { projectNo: true } },
        lines: { select: { categoryId: true } },
      },
    });
    const result = aggregateProjects(
      year,
      rounds.map((r) => ({
        publishedAt: r.publishedAt!,
        projectNo: r.inquiry.projectNo,
        topCategoryIds: r.lines.flatMap((l) => index.root(l.categoryId)?.id ?? []),
      })),
    );
    const categories = [...result.categories].flatMap(([id, inquiryCount]) => {
      const c = index.get(id);
      return c ? [{ category: toCategory(c), inquiryCount, sort: c.sort }] : [];
    });
    categories.sort(
      (a, b) =>
        b.inquiryCount - a.inquiryCount || a.sort - b.sort || a.category.code.localeCompare(b.category.code),
    );
    return {
      year,
      months: result.months,
      total: result.total,
      categories: categories.map(({ category, inquiryCount }) => ({ category, inquiryCount })),
    };
  }

  /** #15：邀请时间落在区间内的报价单 */
  async responseSpeed(user: AuthUser, query: StatsResponseSpeedQuery): Promise<StatsResponseSpeedDto> {
    const range = this.range(query);
    const index = await this.categories.loadIndex();
    const quotes = await this.prisma.quote.findMany({
      where: {
        invitedAt: rangeBounds(range.from, range.to),
        round: { inquiry: this.inquiryWhere(user, index, query.materialCategoryId) },
        ...(query.supplierCategoryCode ? { supplier: { categoryCode: query.supplierCategoryCode } } : {}),
      },
      select: {
        supplierId: true,
        status: true,
        invitedAt: true,
        respondedAt: true,
        round: { select: { deadline: true } },
      },
    });
    const result = aggregateResponseSpeed(
      quotes.map((q) => ({ ...q, deadline: q.round.deadline })),
      this.clock.now(),
    );
    const suppliers = await this.suppliers([...result.suppliers.keys()]);
    return {
      ...range,
      total: result.total,
      buckets: result.buckets,
      suppliers: suppliers.map((supplier) => ({ supplier, ...result.suppliers.get(supplier.id)! })),
    };
  }

  /** #16：评标完成时间落在区间内的轮次里的报价单 */
  async winRate(user: AuthUser, query: StatsWinRateQuery): Promise<StatsWinRateDto> {
    const range = this.range(query);
    const quotes = await this.prisma.quote.findMany({
      where: {
        round: {
          status: 'EVALUATED',
          evaluatedAt: rangeBounds(range.from, range.to),
          inquiry: this.scope.inquiryWhere(user),
        },
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.supplierCategoryCode ? { supplier: { categoryCode: query.supplierCategoryCode } } : {}),
      },
      select: {
        supplierId: true,
        status: true,
        currentVersionId: true,
        round: { select: { evaluatedAt: true } },
      },
    });
    const result = aggregateWinRate(
      quotes.map((q) => ({
        supplierId: q.supplierId,
        status: q.status,
        quoted: q.currentVersionId !== null,
        evaluatedAt: q.round.evaluatedAt!,
      })),
      monthsBetween(range.from, range.to),
    );
    const suppliers = await this.suppliers([...result.suppliers.keys()]);
    return {
      ...range,
      months: result.months,
      total: result.total,
      suppliers: suppliers.map((supplier) => ({ supplier, ...result.suppliers.get(supplier.id)! })),
    };
  }

  /** #17：完成时间落在区间内的询价单，周期从第 1 轮发布算起 */
  async cycleTime(user: AuthUser, query: StatsCycleTimeQuery): Promise<StatsCycleTimeDto> {
    const range = this.range(query);
    const index = await this.categories.loadIndex();
    const inquiries = await this.prisma.inquiry.findMany({
      where: {
        AND: [
          this.inquiryWhere(user, index, query.materialCategoryId),
          { completedAt: rangeBounds(range.from, range.to) },
        ],
      },
      select: { completedAt: true, rounds: { where: { roundNo: 1 }, select: { publishedAt: true } } },
    });
    const rows = inquiries.flatMap((i) => {
      const publishedAt = i.rounds[0]?.publishedAt;
      return publishedAt && i.completedAt ? [{ publishedAt, completedAt: i.completedAt }] : [];
    });
    return { ...range, ...aggregateCycleTime(rows, monthsBetween(range.from, range.to)) };
  }

  /** 统计里出现的供应商，按编码 */
  private async suppliers(ids: string[]): Promise<StatsSupplierDto[]> {
    if (ids.length === 0) return [];
    return this.prisma.supplier.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, nameZh: true, nameEn: true, categoryCode: true },
      orderBy: { code: 'asc' },
    });
  }
}

function toCategory(c: { id: string; code: string; nameZh: string; nameEn: string }): StatsCategoryDto {
  return { id: c.id, code: c.code, nameZh: c.nameZh, nameEn: c.nameEn };
}
