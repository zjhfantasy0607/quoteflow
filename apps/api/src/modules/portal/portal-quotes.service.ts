import { Injectable } from '@nestjs/common';
import {
  PORTAL_QUOTE_TAB_ROUND_STATUSES,
  type InquiryFileKind,
  type Paginated,
  type PortalFileDto,
  type PortalQuoteDetailDto,
  type PortalQuoteListItemDto,
  type PortalQuoteListQuery,
  type SupplierLanguage,
  type SupplierProfileDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { skipTake, toPaginated } from '../../common/pagination';
import type { Prisma } from '../../generated/prisma/client';
import { toFileDto } from '../../infra/files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { loadRound, type RoundRow } from '../inquiries/inquiry-dto';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** 门户只读得到这些字段（P-5）：不 select 项目号、草稿号、负责人以外的内部信息 */
const listSelect = {
  id: true,
  status: true,
  invitedAt: true,
  firstViewedAt: true,
  lastSubmittedAt: true,
  round: {
    select: {
      roundNo: true,
      status: true,
      deadline: true,
      inquiry: { select: { formalNo: true, title: true, currency: true } },
    },
  },
} satisfies Prisma.QuoteSelect;

const detailSelect = {
  id: true,
  status: true,
  invitedAt: true,
  firstViewedAt: true,
  respondedAt: true,
  lastSubmittedAt: true,
  declinedAt: true,
  declineReasonCode: true,
  declineReason: true,
  round: {
    select: {
      roundNo: true,
      status: true,
      deadline: true,
      publishedAt: true,
      changeReason: true,
      changeSummary: true,
      pplTemplateVersion: true,
      pplVariantCode: true,
      inquiry: {
        select: {
          id: true,
          formalNo: true,
          title: true,
          currency: true,
          description: true,
          docStatus: true,
          cancelledAt: true,
          cancelReason: true,
          owner: { select: { name: true, email: true } },
        },
      },
    },
  },
} satisfies Prisma.QuoteSelect;

type FileRow = RoundRow['files'][number];

function toPortalFile(f: FileRow): PortalFileDto {
  return { id: f.id, kind: f.kind as InquiryFileKind, file: toFileDto(f.file) };
}

/**
 * 供应商门户的"我的询价"与企业资料（M08）。一律按当前用户的 supplierId 过滤（05 §7.2 P-1），
 * 只能看到自己有报价单、且所在轮次已发布的（P-2）；别家的报价单和不存在的一样返回 404
 */
@Injectable()
export class PortalQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /** R08-1：待处理 / 评标中 / 已结束；待处理按截止时间先后，其余按邀请时间倒序 */
  async list(user: AuthUser, query: PortalQuoteListQuery): Promise<Paginated<PortalQuoteListItemDto>> {
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    const where: Prisma.QuoteWhereInput = {
      supplierId: supplierOf(user),
      round: {
        publishedAt: { not: null },
        ...(query.tab ? { status: { in: [...PORTAL_QUOTE_TAB_ROUND_STATUSES[query.tab]] } } : {}),
        ...(query.keyword
          ? { inquiry: { OR: [{ formalNo: contains(query.keyword) }, { title: contains(query.keyword) }] } }
          : {}),
      },
    };
    const orderBy: Prisma.QuoteOrderByWithRelationInput[] =
      query.tab === 'pending'
        ? [{ round: { deadline: 'asc' } }, { id: 'asc' }]
        : [{ invitedAt: 'desc' }, { id: 'desc' }];
    const [rows, total] = await Promise.all([
      this.prisma.quote.findMany({ where, select: listSelect, orderBy, ...skipTake(query) }),
      this.prisma.quote.count({ where }),
    ]);
    return toPaginated(
      rows.map((q) => ({
        id: q.id,
        inquiry: {
          formalNo: q.round.inquiry.formalNo!,
          title: q.round.inquiry.title,
          currency: q.round.inquiry.currency,
        },
        roundNo: q.round.roundNo,
        roundStatus: q.round.status,
        deadline: iso(q.round.deadline),
        status: q.status,
        invitedAt: q.invitedAt.toISOString(),
        firstViewedAt: iso(q.firstViewedAt),
        lastSubmittedAt: iso(q.lastSubmittedAt),
      })),
      total,
      query,
    );
  }

  /**
   * 报价单详情（R08-7）：询价信息、轮次（含变更说明）、询价行与附件、我的报价状态。
   * R08-2：没作废的报价单第一次打开时写 firstViewedAt（采购方"供应商响应"里显示"已查看"），只写一次
   */
  async detail(user: AuthUser, quoteId: string): Promise<PortalQuoteDetailDto> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, supplierId: supplierOf(user), round: { publishedAt: { not: null } } },
      select: detailSelect,
    });
    if (!quote) throw new AppException('NOT_FOUND');
    let firstViewedAt = quote.firstViewedAt;
    if (!firstViewedAt && quote.status !== 'VOID') {
      const now = this.clock.now();
      const res = await this.prisma.quote.updateMany({
        where: { id: quote.id, firstViewedAt: null },
        data: { firstViewedAt: now },
      });
      firstViewedAt =
        res.count === 1
          ? now
          : (
              await this.prisma.quote.findUniqueOrThrow({
                where: { id: quote.id },
                select: { firstViewedAt: true },
              })
            ).firstViewedAt;
    }
    const { round } = quote;
    const { inquiry } = round;
    const rows = (await loadRound(this.prisma, inquiry.id, round.roundNo))!;
    const filesOf = (lineId: string | null) =>
      rows.files.filter((f) => f.lineId === lineId).map(toPortalFile);
    const cancelled = inquiry.docStatus === 'CANCELLED';
    return {
      id: quote.id,
      status: quote.status,
      invitedAt: quote.invitedAt.toISOString(),
      firstViewedAt: iso(firstViewedAt),
      respondedAt: iso(quote.respondedAt),
      lastSubmittedAt: iso(quote.lastSubmittedAt),
      declinedAt: iso(quote.declinedAt),
      declineReasonCode: quote.declineReasonCode,
      declineReason: quote.declineReason,
      inquiry: {
        formalNo: inquiry.formalNo!,
        title: inquiry.title,
        currency: inquiry.currency,
        description: inquiry.description,
        buyer: inquiry.owner,
        cancelledAt: cancelled ? iso(inquiry.cancelledAt) : null,
        cancelReason: cancelled ? inquiry.cancelReason : null,
      },
      round: {
        roundNo: round.roundNo,
        status: round.status,
        deadline: iso(round.deadline),
        publishedAt: iso(round.publishedAt),
        changeReason: round.changeReason,
        changeSummary: round.changeSummary,
        pplTemplateVersion: round.pplTemplateVersion,
        pplVariantCode: round.pplVariantCode,
      },
      // 询价行的备注按"内部备注"处理，不给供应商（P-5，B-25）
      lines: rows.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        materialCode: l.materialCode,
        nameZh: l.nameZh,
        nameEn: l.nameEn,
        spec: l.spec,
        unitCode: l.unitCode,
        quantity: l.quantity.toFixed(),
        brand: l.brand,
        drawingRef: l.drawingRef,
        category: { code: l.category.code, nameZh: l.category.nameZh, nameEn: l.category.nameEn },
        files: filesOf(l.id),
      })),
      files: filesOf(null),
      // M09 起由 computePortalQuoteActions() 生成
      allowedActions: [],
    };
  }

  /** 本供应商的企业资料（只读）：不含供应商分类、内部备注、状态（P-5） */
  async profile(user: AuthUser): Promise<SupplierProfileDto> {
    const s = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: supplierOf(user) },
      include: { materialCategories: { include: { category: true } } },
    });
    return {
      code: s.code,
      nameZh: s.nameZh,
      nameEn: s.nameEn,
      creditCode: s.creditCode,
      materialCategories: s.materialCategories
        .map(({ category: c }) => ({ code: c.code, nameZh: c.nameZh, nameEn: c.nameEn }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      contactName: s.contactName,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      ccEmails: s.ccEmails,
      preferredLanguage: s.preferredLanguage as SupplierLanguage,
      country: s.country,
      address: s.address,
    };
  }
}

/** 供应商用户一定挂在某个供应商下；没有的视为无权访问 */
function supplierOf(user: AuthUser): string {
  if (!user.supplierId) throw new AppException('FORBIDDEN');
  return user.supplierId;
}
