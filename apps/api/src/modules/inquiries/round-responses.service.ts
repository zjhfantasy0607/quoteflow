import { Injectable } from '@nestjs/common';
import type { QuoteResponseDto } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryAccessService } from './inquiry-access.service';
import { portalAccountState } from './inquiry-invitees.service';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * "供应商响应"页签（M07 §5）。只 select 状态字段（05 §7.1 S-1：开标前采购方只能看到这些），
 * 不读报价取值、草稿和版本内容；M10 接入 SealService 后补开标后的合计
 */
@Injectable()
export class RoundResponsesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
  ) {}

  async list(user: AuthUser, inquiryId: string, roundNo: number): Promise<QuoteResponseDto[]> {
    await this.access.findOrThrow(this.prisma, user, inquiryId);
    const round = await this.prisma.inquiryRound.findUnique({
      where: { inquiryId_roundNo: { inquiryId, roundNo } },
      select: { id: true },
    });
    if (!round) throw new AppException('NOT_FOUND');
    const rows = await this.prisma.quote.findMany({
      where: { roundId: round.id },
      select: {
        id: true,
        status: true,
        invitedAt: true,
        firstViewedAt: true,
        respondedAt: true,
        lastSubmittedAt: true,
        declinedAt: true,
        declineReasonCode: true,
        declineReason: true,
        supplier: {
          select: { id: true, code: true, nameZh: true, nameEn: true, users: { select: { status: true } } },
        },
        _count: { select: { versions: true } },
      },
      orderBy: [{ invitedAt: 'asc' }, { supplier: { code: 'asc' } }],
    });
    return rows.map((q) => ({
      id: q.id,
      supplier: {
        id: q.supplier.id,
        code: q.supplier.code,
        nameZh: q.supplier.nameZh,
        nameEn: q.supplier.nameEn,
        portalAccount: portalAccountState(q.supplier.users),
      },
      status: q.status,
      invitedAt: q.invitedAt.toISOString(),
      firstViewedAt: iso(q.firstViewedAt),
      respondedAt: iso(q.respondedAt),
      lastSubmittedAt: iso(q.lastSubmittedAt),
      declinedAt: iso(q.declinedAt),
      declineReasonCode: q.declineReasonCode,
      declineReason: q.declineReason,
      versionCount: q._count.versions,
    }));
  }
}
