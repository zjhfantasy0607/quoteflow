import { Injectable } from '@nestjs/common';
import {
  Dec,
  type InquiryReportQuery,
  type InquiryReportRowDto,
  type LogisticsReportQuery,
  type LogisticsReportRowDto,
  type PageQuery,
  type Paginated,
  type PplColumn,
  type PplValue,
  type QuoteVersionValues,
  type ReportFilterOptionsDto,
  type SupplierQuoteItemDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { ScopeService } from '../../common/auth/scope.service';
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
import { MaterialCategoriesService } from '../material-categories/material-categories.service';
import { PplService } from '../ppl/ppl.service';
import { SealService } from '../quotes/seal.service';

/** 量产交期（v0 与真实模板沿用同样的 key，04 §9），物流明细的最后一列 */
export const LEAD_TIME_KEY = 'lead_time_days';
/** 询报价单统计里被 quote.amount 脱敏的列 */
const TOTAL_FIELDS = ['minTotal', 'maxTotal', 'avgTotal'] as const;

/** 日期区间（含首尾两天，按 UTC+8）→ 时刻条件 */
export function dayRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: appDayStart(from).toDate() } : {}),
    ...(to ? { lt: appDayStart(to).add(1, 'day').toDate() } : {}),
  };
}

const quoteSelect = {
  status: true,
  currentVersionId: true,
  declinedAt: true,
  supplier: { select: { id: true, code: true, nameZh: true, nameEn: true } },
  currentVersion: { select: { totalAmount: true } },
} satisfies Prisma.QuoteSelect;

const roundSelect = {
  id: true,
  roundNo: true,
  status: true,
  openedAt: true,
  publishedAt: true,
  inquiry: {
    select: {
      id: true,
      formalNo: true,
      draftNo: true,
      title: true,
      projectNo: true,
      currency: true,
      materialCategory: { select: { id: true, code: true, nameZh: true, nameEn: true } },
      owner: { select: { id: true, name: true } },
    },
  },
  quotes: { select: quoteSelect },
} satisfies Prisma.InquiryRoundSelect;
type RoundRow = Prisma.InquiryRoundGetPayload<{ select: typeof roundSelect }>;

/** 有效报价：提交过且现在没有拒绝（拒绝前提交过的版本不算，与比价矩阵一致） */
const isQuoted = (q: { currentVersionId: string | null; declinedAt: Date | null }) =>
  q.currentVersionId !== null && q.declinedAt === null;

/**
 * 与报价有关的报表（M15 §4）：询报价单统计、物流报价明细，以及供应商详情的"报价记录"（R15-4）。
 * 都是询价派生的数据，叠加数据权限；金额经过 SealService（开标前密封，S-1 / S-3 / S-4）再按 quote.amount 脱敏（S-5）。
 * 这些出口都在密封测试集 sealing.e2e-spec.ts 里
 */
@Injectable()
export class QuoteReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly fieldMask: FieldMaskService,
    private readonly seal: SealService,
    private readonly categories: MaterialCategoriesService,
    private readonly ppl: PplService,
  ) {}

  /** 两张报表共用的轮次条件：已发布、数据权限、询价号、负责人、材料类别（含下级）、轮次状态、发布日期 */
  private async roundWhere(
    user: AuthUser,
    query: InquiryReportQuery,
  ): Promise<Prisma.InquiryRoundWhereInput[]> {
    const inquiry: Prisma.InquiryWhereInput[] = [this.scope.inquiryWhere(user)];
    if (query.inquiryNo) inquiry.push({ formalNo: { contains: query.inquiryNo, mode: 'insensitive' } });
    if (query.ownerId) inquiry.push({ ownerId: query.ownerId });
    if (query.materialCategoryId) {
      const index = await this.categories.loadIndex();
      inquiry.push({ materialCategoryId: { in: index.subtreeIds(query.materialCategoryId) } });
    }
    const and: Prisma.InquiryRoundWhereInput[] = [
      { publishedAt: dayRange(query.from, query.to) ?? { not: null } },
      { inquiry: { AND: inquiry } },
    ];
    if (query.roundStatus) and.push({ status: query.roundStatus });
    return and;
  }

  /** 询报价单统计：一行是一个已发布的轮次，按发布时间倒序 */
  async inquiries(
    user: AuthUser,
    query: InquiryReportQuery,
    w: ReportWindow,
  ): Promise<ReportRows<InquiryReportRowDto>> {
    const and = await this.roundWhere(user, query);
    if (query.supplierId) and.push({ quotes: { some: { supplierId: query.supplierId } } });
    const where: Prisma.InquiryRoundWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.inquiryRound.findMany({
        where,
        select: roundSelect,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        ...reportSkipTake(w),
      }),
      this.prisma.inquiryRound.count({ where }),
    ]);
    const visible = await this.seal.contentVisibility(user);
    return {
      items: rows.map((r) => this.inquiryRow(r, visible(r), user)),
      total,
      truncated: total > rows.length && w === 'export',
    };
  }

  private inquiryRow(r: RoundRow, visible: boolean, user: AuthUser): InquiryReportRowDto {
    const quoted = r.quotes.filter(isQuoted);
    const totals = quoted.flatMap((q) =>
      q.currentVersion ? [new Dec(q.currentVersion.totalAmount.toFixed(2))] : [],
    );
    const amount = (value: Dec | null) => (visible && value ? value.toFixed(2) : null);
    const winner = r.quotes.find((q) => q.status === 'WON')?.supplier ?? null;
    const row: InquiryReportRowDto = {
      roundId: r.id,
      inquiry: {
        id: r.inquiry.id,
        formalNo: r.inquiry.formalNo ?? r.inquiry.draftNo,
        title: r.inquiry.title,
        projectNo: r.inquiry.projectNo,
      },
      roundNo: r.roundNo,
      roundStatus: r.status,
      materialCategory: r.inquiry.materialCategory,
      currency: r.inquiry.currency,
      invitedCount: r.quotes.length,
      quotedCount: quoted.length,
      minTotal: amount(totals.length > 0 ? Dec.min(...totals) : null),
      maxTotal: amount(totals.length > 0 ? Dec.max(...totals) : null),
      avgTotal: amount(
        totals.length > 0
          ? totals.reduce((sum, v) => sum.plus(v), new Dec(0)).dividedBy(totals.length)
          : null,
      ),
      sealed: !visible,
      winner,
      owner: r.inquiry.owner,
      publishedAt: r.publishedAt!.toISOString(),
    };
    return visible ? this.fieldMask.mask(row, user, 'quote.amount', [...TOTAL_FIELDS]) : row;
  }

  /**
   * 物流报价明细（A-09）：只取开过标的轮次（S-3），每家有效报价的当前版本按询价行展开；列是 PPL 里 logistics: true 的列 +
   * 量产交期。按发布时间倒序、供应商编码、行号
   */
  async logistics(
    user: AuthUser,
    query: LogisticsReportQuery,
    w: ReportWindow,
  ): Promise<ReportRows<LogisticsReportRowDto> & { columns: PplColumn[] }> {
    const and = await this.roundWhere(user, query);
    and.push({ OR: [{ status: { in: ['OPENED', 'EVALUATED'] } }, { openedAt: { not: null } }] });
    const rounds = await this.prisma.inquiryRound.findMany({
      where: { AND: and },
      select: {
        id: true,
        roundNo: true,
        status: true,
        openedAt: true,
        pplTemplateVersion: true,
        inquiry: { select: { id: true, formalNo: true, draftNo: true, title: true, currency: true } },
        lines: {
          select: { id: true, lineNo: true, materialCode: true, nameZh: true, nameEn: true, spec: true },
          orderBy: { lineNo: 'asc' },
        },
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    });
    const visible = await this.seal.contentVisibility(user);
    const open = rounds.filter((r) => visible(r));
    const columns = await this.logisticsColumns(open.map((r) => r.pplTemplateVersion));
    const quotes = await this.prisma.quote.findMany({
      where: {
        roundId: { in: open.map((r) => r.id) },
        currentVersionId: { not: null },
        declinedAt: null,
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      select: {
        id: true,
        roundId: true,
        supplier: { select: { id: true, code: true, nameZh: true, nameEn: true } },
        currentVersion: { select: { versionNo: true, values: true } },
      },
      orderBy: { supplier: { code: 'asc' } },
    });
    const masked = this.fieldMask.can(user, 'quote.amount')
      ? []
      : columns.filter((c) => c.sensitive).map((c) => c.key);
    const quotesOf = new Map<string, typeof quotes>();
    for (const q of quotes) quotesOf.set(q.roundId, [...(quotesOf.get(q.roundId) ?? []), q]);
    const rows: LogisticsReportRowDto[] = [];
    for (const round of open) {
      for (const quote of quotesOf.get(round.id) ?? []) {
        const version = quote.currentVersion!;
        const valuesOf = new Map(
          (version.values as unknown as QuoteVersionValues).lines.map((l) => [l.lineId, l.values]),
        );
        for (const line of round.lines) {
          const values: Record<string, PplValue | null> = {};
          for (const c of columns)
            values[c.key] = masked.includes(c.key) ? null : (valuesOf.get(line.id)?.[c.key] ?? null);
          rows.push({
            id: `${quote.id}:${line.id}`,
            quoteId: quote.id,
            inquiry: {
              id: round.inquiry.id,
              formalNo: round.inquiry.formalNo ?? round.inquiry.draftNo,
              title: round.inquiry.title,
            },
            roundNo: round.roundNo,
            roundStatus: round.status,
            supplier: quote.supplier,
            versionNo: version.versionNo,
            lineNo: line.lineNo,
            materialCode: line.materialCode,
            nameZh: line.nameZh,
            nameEn: line.nameEn,
            spec: line.spec,
            currency: round.inquiry.currency,
            values,
            ...(masked.length > 0 ? { maskedFields: masked } : {}),
          });
        }
      }
    }
    return { columns, ...reportSlice(rows, w) };
  }

  /**
   * 物流列：这些轮次冻结的模板版本 + 当前激活版本里 logistics: true 的主模板列，再加量产交期。新版本在前，
   * 同一个 key 只取一次（04 §9 换模板时语义相同的列沿用 key）
   */
  private async logisticsColumns(versions: (number | null)[]): Promise<PplColumn[]> {
    const active = await this.ppl.active();
    const numbers = [
      ...new Set([active?.version, ...versions].filter((v): v is number => typeof v === 'number')),
    ];
    numbers.sort((a, b) => b - a);
    const seen = new Map<string, PplColumn>();
    for (const version of numbers) {
      const definition = version === active?.version ? active.definition : await this.ppl.definition(version);
      for (const column of definition.master.columns) {
        if ((column.logistics || column.key === LEAD_TIME_KEY) && !seen.has(column.key))
          seen.set(column.key, column);
      }
    }
    // 量产交期放在最后
    const lead = seen.get(LEAD_TIME_KEY);
    seen.delete(LEAD_TIME_KEY);
    return [...seen.values(), ...(lead ? [lead] : [])];
  }

  /** 统计看板与报表的筛选下拉：有 stats:view 或 report:view 才能取 */
  async filterOptions(user: AuthUser): Promise<ReportFilterOptionsDto> {
    if (!user.permissions.has('stats:view') && !user.permissions.has('report:view')) {
      throw new AppException('FORBIDDEN');
    }
    const [owners, suppliers] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          ownedInquiries: {
            some: {
              AND: [this.scope.inquiryWhere(user), { rounds: { some: { publishedAt: { not: null } } } }],
            },
          },
        },
        select: { id: true, name: true },
        orderBy: { username: 'asc' },
      }),
      this.prisma.supplier.findMany({
        select: { id: true, code: true, nameZh: true, nameEn: true, categoryCode: true, status: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    return { owners, suppliers };
  }

  /** R15-4 供应商详情"报价记录"：该供应商参与过的报价单（数据权限内），按邀请时间倒序 */
  async supplierQuotes(
    user: AuthUser,
    supplierId: string,
    page: PageQuery,
  ): Promise<Paginated<SupplierQuoteItemDto>> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) throw new AppException('NOT_FOUND');
    const where: Prisma.QuoteWhereInput = { supplierId, round: { inquiry: this.scope.inquiryWhere(user) } };
    const [rows, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        select: {
          id: true,
          status: true,
          invitedAt: true,
          respondedAt: true,
          lastSubmittedAt: true,
          currentVersionId: true,
          declinedAt: true,
          currentVersion: { select: { totalAmount: true } },
          round: {
            select: {
              roundNo: true,
              status: true,
              openedAt: true,
              inquiry: { select: { id: true, formalNo: true, draftNo: true, title: true, currency: true } },
            },
          },
        },
        orderBy: [{ invitedAt: 'desc' }, { id: 'desc' }],
        ...skipTake(page),
      }),
      this.prisma.quote.count({ where }),
    ]);
    const visible = await this.seal.contentVisibility(user);
    const items = rows.map((q): SupplierQuoteItemDto => {
      const open = visible(q.round);
      const item: SupplierQuoteItemDto = {
        id: q.id,
        inquiry: {
          id: q.round.inquiry.id,
          formalNo: q.round.inquiry.formalNo ?? q.round.inquiry.draftNo,
          title: q.round.inquiry.title,
        },
        roundNo: q.round.roundNo,
        roundStatus: q.round.status,
        status: q.status,
        invitedAt: q.invitedAt.toISOString(),
        respondedAt: q.respondedAt?.toISOString() ?? null,
        lastSubmittedAt: q.lastSubmittedAt?.toISOString() ?? null,
        totalAmount: open && isQuoted(q) && q.currentVersion ? q.currentVersion.totalAmount.toFixed(2) : null,
        currency: q.round.inquiry.currency,
        sealed: !open,
      };
      return open ? this.fieldMask.mask(item, user, 'quote.amount', ['totalAmount']) : item;
    });
    return toPaginated(items, total, page);
  }
}
