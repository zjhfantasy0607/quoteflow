import { Injectable } from '@nestjs/common';
import { QuoteStatus, type QuoteResponseDto, type RoundResponsesDto } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryAccessService } from '../inquiries/inquiry-access.service';
import { portalAccountState } from '../inquiries/inquiry-invitees.service';
import { SealService } from './seal.service';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * "供应商响应"页签（M07 §5、M10 §4）。密封时（SealService，S-1）只 select 状态字段，不读报价取值、草稿和版本内容，
 * 返回里也没有合计的键；开标后（或有开标前查看授权，S-2）另含当前版本的合计，按 quote.amount 脱敏（S-5）
 */
@Injectable()
export class RoundResponsesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly seal: SealService,
    private readonly fieldMask: FieldMaskService,
  ) {}

  async list(user: AuthUser, inquiryId: string, roundNo: number): Promise<RoundResponsesDto> {
    await this.access.findOrThrow(this.prisma, user, inquiryId);
    const round = await this.prisma.inquiryRound.findUnique({
      where: { inquiryId_roundNo: { inquiryId, roundNo } },
      select: { id: true, status: true, openedAt: true },
    });
    if (!round) throw new AppException('NOT_FOUND');
    const sealed = !(await this.seal.canViewQuoteContent(user, round));
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
        currentVersionId: true,
        supplier: {
          select: { id: true, code: true, nameZh: true, nameEn: true, users: { select: { status: true } } },
        },
        _count: { select: { versions: true } },
      },
      orderBy: [{ invitedAt: 'asc' }, { supplier: { code: 'asc' } }],
    });
    const items = rows.map(
      (q): QuoteResponseDto => ({
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
      }),
    );
    if (sealed) return { sealed, items };
    return { sealed, items: await this.withTotals(user, rows, items) };
  }

  /** 只在不密封时调用：读当前版本的合计和币种。拒绝报价的供应商可能之前提交过，旧版本不算它的报价，不显示合计 */
  private async withTotals(
    user: AuthUser,
    rows: { id: string; status: QuoteStatus; currentVersionId: string | null }[],
    items: QuoteResponseDto[],
  ): Promise<QuoteResponseDto[]> {
    const versionIds = rows.filter((q) => q.status !== QuoteStatus.DECLINED && q.currentVersionId).map((q) => q.currentVersionId!);
    const versions = await this.prisma.quoteVersion.findMany({
      where: { id: { in: versionIds } },
      select: { quoteId: true, totalAmount: true, currency: true },
    });
    const byQuote = new Map(versions.map((v) => [v.quoteId, v]));
    return items.map((item) => {
      const v = byQuote.get(item.id);
      const withTotal = { ...item, totalAmount: v?.totalAmount.toFixed(2) ?? null, currency: v?.currency ?? null };
      return this.fieldMask.mask(withTotal, user, 'quote.amount', ['totalAmount']);
    });
  }
}
