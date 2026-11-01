import { Injectable } from '@nestjs/common';
import {
  PORTAL_RECENT_RESULT_DAYS,
  WORKBENCH_CARD_LIMIT,
  type PortalWorkbenchDto,
  type PortalWorkbenchItemDto,
  type WorkbenchCardDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ownQuoteWhere } from '../portal/portal-quotes.service';

const DAY_MS = 24 * 3600_000;
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** 门户只读得到这些字段（P-5） */
const quoteSelect = {
  id: true,
  status: true,
  round: {
    select: {
      roundNo: true,
      status: true,
      deadline: true,
      evaluatedAt: true,
      inquiry: { select: { formalNo: true, title: true } },
    },
  },
} satisfies Prisma.QuoteSelect;
type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof quoteSelect }>;

function toItem(q: QuoteRow, offeredAt: Date | null = null): PortalWorkbenchItemDto {
  return {
    id: q.id,
    inquiry: { formalNo: q.round.inquiry.formalNo!, title: q.round.inquiry.title },
    roundNo: q.round.roundNo,
    roundStatus: q.round.status,
    deadline: iso(q.round.deadline),
    status: q.status,
    offeredAt: iso(offeredAt),
    evaluatedAt: q.status === 'WON' || q.status === 'LOST' ? iso(q.round.evaluatedAt) : null,
  };
}

/**
 * 供应商工作台（M16 §2）：待报价、议价待回复、最近结果。一律在本供应商、已发布轮次的报价单里查（ownQuoteWhere，
 * P-1、P-2），只有门户可见的字段，不含金额（R16-1）
 */
@Injectable()
export class PortalWorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async overview(user: AuthUser): Promise<PortalWorkbenchDto> {
    const own = ownQuoteWhere(user);
    const [pendingQuotes, negotiations, recentResults] = await Promise.all([
      this.pendingQuotes(own),
      this.negotiations(own),
      this.recentResults(own),
    ]);
    return { pendingQuotes, negotiations, recentResults };
  }

  /** 待报价：等待报价的轮次里自己没拒绝的（已提交的截止前还能改），截止早的在前 */
  private async pendingQuotes(
    own: Prisma.QuoteWhereInput,
  ): Promise<WorkbenchCardDto<PortalWorkbenchItemDto>> {
    const where: Prisma.QuoteWhereInput = {
      AND: [own, { status: { in: ['INVITED', 'SUBMITTED'] }, round: { status: 'WAITING_QUOTES' } }],
    };
    const [rows, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        select: quoteSelect,
        orderBy: [{ round: { deadline: 'asc' } }, { id: 'asc' }],
        take: WORKBENCH_CARD_LIMIT,
      }),
      this.prisma.quote.count({ where }),
    ]);
    return { total, items: rows.map((q) => toItem(q)) };
  }

  /** 议价待回复：进行中的议价、最后一条是采购方的方案（OFFER，05 §5 轮到供应商），发得早的在前 */
  private async negotiations(own: Prisma.QuoteWhereInput): Promise<WorkbenchCardDto<PortalWorkbenchItemDto>> {
    const rows = await this.prisma.quote.findMany({
      where: {
        AND: [
          own,
          {
            status: 'EVALUATING',
            shortlisted: true,
            round: { status: 'OPENED' },
            negotiation: { status: 'OPEN' },
          },
        ],
      },
      select: {
        ...quoteSelect,
        negotiation: {
          select: {
            messages: {
              select: { party: true, type: true, createdAt: true },
              orderBy: { seq: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    const waiting = rows
      .map((q) => ({ q, last: q.negotiation?.messages[0] }))
      .filter((r) => r.last?.party === 'BUYER' && r.last.type === 'OFFER')
      .sort(
        (a, b) => a.last!.createdAt.getTime() - b.last!.createdAt.getTime() || a.q.id.localeCompare(b.q.id),
      );
    return {
      total: waiting.length,
      items: waiting.slice(0, WORKBENCH_CARD_LIMIT).map((r) => toItem(r.q, r.last!.createdAt)),
    };
  }

  /** 最近结果：最近 30 天内定标的中标 / 未中标，新的在前 */
  private async recentResults(
    own: Prisma.QuoteWhereInput,
  ): Promise<WorkbenchCardDto<PortalWorkbenchItemDto>> {
    const since = new Date(this.clock.now().getTime() - PORTAL_RECENT_RESULT_DAYS * DAY_MS);
    const where: Prisma.QuoteWhereInput = {
      AND: [own, { status: { in: ['WON', 'LOST'] }, round: { evaluatedAt: { gte: since } } }],
    };
    const [rows, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        select: quoteSelect,
        orderBy: [{ round: { evaluatedAt: 'desc' } }, { id: 'desc' }],
        take: WORKBENCH_CARD_LIMIT,
      }),
      this.prisma.quote.count({ where }),
    ]);
    return { total, items: rows.map((q) => toItem(q)) };
  }
}
