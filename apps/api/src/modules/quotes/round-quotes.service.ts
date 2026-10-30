import { Injectable } from '@nestjs/common';
import type { QuoteVersionDto, RoundQuoteDetailDto } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryAccessService } from '../inquiries/inquiry-access.service';
import { loadVersion, loadVersionSummaries } from './quote-dto';
import { QuoteSheetService } from './quote-sheet.service';
import { SealService } from './seal.service';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * 采购方查看某家的报价（M10 §4，需要 inquiry:evaluate）：数据权限外 404；开标前 QUOTE_SEALED（S-1，
 * seal.preOpenViewRoles 里的角色例外）；开标后金额按 quote.amount 脱敏（S-5）。草稿任何时候都不返回
 */
@Injectable()
export class RoundQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly seal: SealService,
    private readonly sheet: QuoteSheetService,
    private readonly fieldMask: FieldMaskService,
  ) {}

  async detail(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    quoteId: string,
  ): Promise<RoundQuoteDetailDto> {
    const { round, quote } = await this.find(user, inquiryId, roundNo, quoteId);
    await this.seal.assertCanViewQuoteContent(user, round);
    const template = await this.sheet.template(round);
    const current = quote.currentVersionId
      ? await loadVersion(this.prisma, { id: quote.currentVersionId })
      : null;
    const versions = await loadVersionSummaries(this.prisma, quote.id);
    const mask = <T extends QuoteVersionDto | RoundQuoteDetailDto['versions'][number]>(v: T) =>
      this.fieldMask.quoteVersion(v, template.columns, user);
    return {
      id: quote.id,
      status: quote.status,
      supplier: quote.supplier,
      invitedAt: quote.invitedAt.toISOString(),
      firstViewedAt: iso(quote.firstViewedAt),
      respondedAt: iso(quote.respondedAt),
      lastSubmittedAt: iso(quote.lastSubmittedAt),
      declinedAt: iso(quote.declinedAt),
      declineReasonCode: quote.declineReasonCode,
      declineReason: quote.declineReason,
      template,
      currentVersion: current && mask(current),
      versions: versions.map(mask),
    };
  }

  async version(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    quoteId: string,
    versionNo: number,
  ): Promise<QuoteVersionDto> {
    const { round, quote } = await this.find(user, inquiryId, roundNo, quoteId);
    await this.seal.assertCanViewQuoteContent(user, round);
    const version = await loadVersion(this.prisma, { quoteId_versionNo: { quoteId: quote.id, versionNo } });
    if (!version) throw new AppException('NOT_FOUND');
    const template = await this.sheet.template(round);
    return this.fieldMask.quoteVersion(version, template.columns, user);
  }

  /** 询价单按数据权限取（R06-10），轮次和报价单必须属于它 */
  private async find(user: AuthUser, inquiryId: string, roundNo: number, quoteId: string) {
    await this.access.findOrThrow(this.prisma, user, inquiryId);
    const round = await this.prisma.inquiryRound.findUnique({
      where: { inquiryId_roundNo: { inquiryId, roundNo } },
      select: { id: true, status: true, openedAt: true, pplTemplateVersion: true, pplVariantCode: true },
    });
    if (!round) throw new AppException('NOT_FOUND');
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, roundId: round.id },
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
        supplier: { select: { id: true, code: true, nameZh: true, nameEn: true } },
      },
    });
    if (!quote) throw new AppException('NOT_FOUND');
    return { round, quote };
  }
}
