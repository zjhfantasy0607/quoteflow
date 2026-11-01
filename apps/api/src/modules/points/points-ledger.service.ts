import { Injectable } from '@nestjs/common';
import {
  POINTS_RULE_CODES,
  type PageQuery,
  type PointsLedgerItemDto,
  type PointsLedgerQuery,
  type PointsRuleCode,
  type PointsSummaryQuery,
  type PointsSummaryRowDto,
  type SupplierPointsDto,
} from '@quoteflow/shared';
import { AppException } from '../../common/errors/app.exception';
import {
  reportSkipTake,
  reportSlice,
  skipTake,
  toPaginated,
  type ReportRows,
  type ReportWindow,
} from '../../common/pagination';
import { appDayStart } from '../../common/time';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Client = PrismaService | Prisma.TransactionClient;

export const ledgerSelect = {
  id: true,
  createdAt: true,
  ruleCode: true,
  delta: true,
  source: true,
  inquiryId: true,
  roundId: true,
  remark: true,
  createdById: true,
  supplier: { select: { id: true, code: true, nameZh: true, nameEn: true } },
} satisfies Prisma.SupplierPointsEntrySelect;
type LedgerRow = Prisma.SupplierPointsEntryGetPayload<{ select: typeof ledgerSelect }>;

/** 日期区间（含首尾两天，按 UTC+8）→ createdAt 条件 */
function createdIn(from?: string, to?: string): Prisma.SupplierPointsEntryWhereInput {
  if (!from && !to) return {};
  return {
    createdAt: {
      ...(from ? { gte: appDayStart(from).toDate() } : {}),
      ...(to ? { lt: appDayStart(to).add(1, 'day').toDate() } : {}),
    },
  };
}

const zeroByRule = (): Record<PointsRuleCode, number> =>
  Object.fromEntries(POINTS_RULE_CODES.map((code) => [code, 0])) as Record<PointsRuleCode, number>;

/**
 * 积分查询（#26，M15 §4、R15-4）：积分记录流水、供应商积分统计、供应商详情的"积分"页签。
 * 积分是供应商主数据的一部分，不按询价单的数据权限过滤（05 §11 只管询价派生对象）；记录里只带关联询价号，不带报价内容
 */
@Injectable()
export class PointsLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** 积分记录流水：供应商、规则、时间区间；按时间倒序 */
  async ledger(query: PointsLedgerQuery, w: ReportWindow): Promise<ReportRows<PointsLedgerItemDto>> {
    const where: Prisma.SupplierPointsEntryWhereInput = {
      ...createdIn(query.from, query.to),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.ruleCode ? { ruleCode: query.ruleCode } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supplierPointsEntry.findMany({
        where,
        select: ledgerSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...reportSkipTake(w),
      }),
      this.prisma.supplierPointsEntry.count({ where }),
    ]);
    return { items: await this.toItems(rows), total, truncated: w === 'export' && total > rows.length };
  }

  /**
   * 供应商积分统计：每家供应商（分类、关键字筛选）的累计积分、区间内积分与按规则分项、最近变动时间。
   * 按区间内积分、累计积分从高到低，再按编码
   */
  async summary(query: PointsSummaryQuery, w: ReportWindow): Promise<ReportRows<PointsSummaryRowDto>> {
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        ...(query.supplierCategoryCode ? { categoryCode: query.supplierCategoryCode } : {}),
        ...(query.keyword
          ? {
              OR: [
                { code: contains(query.keyword) },
                { nameZh: contains(query.keyword) },
                { nameEn: contains(query.keyword) },
              ],
            }
          : {}),
      },
      select: { id: true, code: true, nameZh: true, nameEn: true, categoryCode: true, status: true },
    });
    const ids = suppliers.map((s) => s.id);
    const [totals, period] = await Promise.all([
      this.prisma.supplierPointsEntry.groupBy({
        by: ['supplierId'],
        where: { supplierId: { in: ids } },
        _sum: { delta: true },
        _max: { createdAt: true },
      }),
      this.prisma.supplierPointsEntry.groupBy({
        by: ['supplierId', 'ruleCode'],
        where: { supplierId: { in: ids }, ...createdIn(query.from, query.to) },
        _sum: { delta: true },
      }),
    ]);
    const totalOf = new Map(totals.map((t) => [t.supplierId, t]));
    const byRuleOf = new Map<string, Record<PointsRuleCode, number>>();
    for (const p of period) {
      const byRule = byRuleOf.get(p.supplierId) ?? zeroByRule();
      byRule[p.ruleCode as PointsRuleCode] += p._sum.delta ?? 0;
      byRuleOf.set(p.supplierId, byRule);
    }
    const rows = suppliers.map((supplier): PointsSummaryRowDto => {
      const byRule = byRuleOf.get(supplier.id) ?? zeroByRule();
      return {
        supplier,
        balance: totalOf.get(supplier.id)?._sum.delta ?? 0,
        periodPoints: Object.values(byRule).reduce((sum, v) => sum + v, 0),
        byRule,
        lastChangedAt: totalOf.get(supplier.id)?._max.createdAt?.toISOString() ?? null,
      };
    });
    rows.sort(
      (a, b) =>
        b.periodPoints - a.periodPoints ||
        b.balance - a.balance ||
        a.supplier.code.localeCompare(b.supplier.code),
    );
    return reportSlice(rows, w);
  }

  /** R15-4 供应商详情"积分"：该供应商的积分记录（按时间倒序）与累计积分 */
  async supplierPoints(supplierId: string, page: PageQuery): Promise<SupplierPointsDto> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) throw new AppException('NOT_FOUND');
    const where = { supplierId };
    const [rows, total, balance] = await Promise.all([
      this.prisma.supplierPointsEntry.findMany({
        where,
        select: ledgerSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(page),
      }),
      this.prisma.supplierPointsEntry.count({ where }),
      this.balance(supplierId),
    ]);
    return { ...toPaginated(await this.toItems(rows), total, page), balance };
  }

  async balance(supplierId: string, client: Client = this.prisma): Promise<number> {
    const sum = await client.supplierPointsEntry.aggregate({ where: { supplierId }, _sum: { delta: true } });
    return sum._sum.delta ?? 0;
  }

  /** 补上关联的询价号、轮次号、操作人（积分记录上只存了 id）；三个查询并发，不要在事务里调用 */
  async toItems(rows: LedgerRow[]): Promise<PointsLedgerItemDto[]> {
    const ids = (pick: (r: LedgerRow) => string | null) => [
      ...new Set(rows.map(pick).filter((v): v is string => v !== null)),
    ];
    const [inquiries, rounds, users] = await Promise.all([
      this.prisma.inquiry.findMany({
        where: { id: { in: ids((r) => r.inquiryId) } },
        select: { id: true, formalNo: true },
      }),
      this.prisma.inquiryRound.findMany({
        where: { id: { in: ids((r) => r.roundId) } },
        select: { id: true, roundNo: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids((r) => r.createdById) } },
        select: { id: true, name: true },
      }),
    ]);
    const inquiryOf = new Map(inquiries.map((i) => [i.id, i]));
    const roundOf = new Map(rounds.map((r) => [r.id, r.roundNo]));
    const userOf = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      supplier: r.supplier,
      ruleCode: r.ruleCode as PointsRuleCode,
      delta: r.delta,
      source: r.source,
      inquiry: r.inquiryId ? (inquiryOf.get(r.inquiryId) ?? { id: r.inquiryId, formalNo: null }) : null,
      roundNo: r.roundId ? (roundOf.get(r.roundId) ?? null) : null,
      remark: r.remark,
      createdBy: r.createdById ? (userOf.get(r.createdById) ?? null) : null,
    }));
  }
}
