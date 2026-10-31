import { Injectable } from '@nestjs/common';
import { computeInquiryActions, SHORTLIST_LIMIT, type RoundMatrixDto } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryAccessService } from '../inquiries/inquiry-access.service';
import { RoundMatrixService } from './round-matrix.service';

/**
 * 入围名单（M11 R11-6、I-7）：整份替换。每轮最多 2 家，只能选评标中的报价单，已经发过议价消息的不能移出。
 * 先锁询价单（与议价、定标等串行），只能调整当前轮次，且轮次处于开标中（computeInquiryActions 的 shortlist）
 */
@Injectable()
export class RoundShortlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly matrix: RoundMatrixService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  async save(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    quoteIds: string[],
  ): Promise<RoundMatrixDto> {
    await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.access.lockOrThrow(tx, user, inquiryId);
      const round = await tx.inquiryRound.findUnique({
        where: { inquiryId_roundNo: { inquiryId, roundNo } },
        select: { id: true, roundNo: true },
      });
      if (!round) throw new AppException('NOT_FOUND');
      if (
        round.roundNo !== inquiry.currentRoundNo ||
        !computeInquiryActions(inquiry, user.permissions).includes('shortlist')
      ) {
        throw new AppException(
          inquiry.docStatus === 'APPROVED' ? 'ROUND_INVALID_STATUS' : 'INQUIRY_INVALID_STATUS',
        );
      }
      if (quoteIds.length > SHORTLIST_LIMIT)
        throw new AppException('SHORTLIST_LIMIT_EXCEEDED', { max: SHORTLIST_LIMIT });
      const quotes = await tx.quote.findMany({
        where: { roundId: round.id },
        select: {
          id: true,
          status: true,
          shortlisted: true,
          supplier: { select: { code: true } },
          negotiation: { select: { _count: { select: { messages: true } } } },
        },
        orderBy: { supplier: { code: 'asc' } },
      });
      const picked = quoteIds.map((id) => quotes.find((q) => q.id === id));
      if (picked.some((q) => !q || q.status !== 'EVALUATING'))
        throw new AppException('SHORTLIST_INVALID_QUOTE');
      const removed = quotes.filter((q) => q.shortlisted && !quoteIds.includes(q.id));
      if (removed.some((q) => (q.negotiation?._count.messages ?? 0) > 0))
        throw new AppException('SHORTLIST_LOCKED');
      const added = quotes.filter((q) => !q.shortlisted && quoteIds.includes(q.id));
      if (added.length === 0 && removed.length === 0) return;

      await tx.quote.updateMany({
        where: { id: { in: removed.map((q) => q.id) } },
        data: { shortlisted: false, shortlistedAt: null },
      });
      await tx.quote.updateMany({
        where: { id: { in: added.map((q) => q.id) }, status: 'EVALUATING' },
        data: { shortlisted: true, shortlistedAt: this.clock.now() },
      });
      const codes = (list: typeof quotes) => list.map((q) => q.supplier.code);
      const shortlist = quotes.filter((q) => quoteIds.includes(q.id));
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.shortlist',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: [inquiry.formalNo, codes(shortlist).join(', ') || '—'].join(' · '),
          detail: {
            roundNo,
            added: codes(added),
            removed: codes(removed),
            quoteIds: shortlist.map((q) => q.id),
          },
        },
        tx,
      );
    });
    return this.matrix.matrix(user, inquiryId, roundNo);
  }
}
