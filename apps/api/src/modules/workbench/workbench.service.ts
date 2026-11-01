import { Injectable } from '@nestjs/common';
import {
  INQUIRY_TAB_FILTER,
  WORKBENCH_CARD_LIMIT,
  workbenchCards,
  type ContractStatus,
  type WorkbenchCardDto,
  type WorkbenchCardKey,
  type WorkbenchContractItemDto,
  type WorkbenchDto,
  type WorkbenchInquiryItemDto,
  type WorkbenchNegotiationItemDto,
  type WorkbenchProgressDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { mineWhere } from '../inquiries/inquiries.service';

const iso = (d: Date | null) => d?.toISOString() ?? null;

const supplierBrief = { select: { id: true, code: true, nameZh: true, nameEn: true } } as const;

const inquirySelect = {
  id: true,
  draftNo: true,
  formalNo: true,
  projectNo: true,
  title: true,
  owner: { select: { id: true, name: true } },
  currentRoundNo: true,
  currentDeadline: true,
  submittedAt: true,
  approvedAt: true,
  updatedAt: true,
  lastRejectComment: true,
} satisfies Prisma.InquirySelect;
type InquiryRow = Prisma.InquiryGetPayload<{ select: typeof inquirySelect }>;

interface InquiryCardOptions {
  orderBy: Prisma.InquiryOrderByWithRelationInput[];
  /** 我的草稿：标出被驳回的 */
  rejected?: boolean;
  /** 等待报价、待开标：带本轮响应进度 */
  progress?: boolean;
}

/**
 * 采购方工作台（M16 §2）：按功能权限决定返回哪些卡片（WORKBENCH_CARD_PERMISSIONS），每张卡片叠加数据权限（R16-1）。
 * 只返回单据号、标题、状态、时间和响应家数，不返回任何报价内容和金额（S-1 允许的范围），所以不经过 SealService；
 * 密封测试集照样扫描这个出口（internalExits()）。待办按等得最久的在前
 */
@Injectable()
export class WorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async overview(user: AuthUser): Promise<WorkbenchDto> {
    const loaders: { [K in WorkbenchCardKey]: () => Promise<NonNullable<WorkbenchDto[K]>> } = {
      pendingApproval: () =>
        this.inquiryCard(user, INQUIRY_TAB_FILTER.pending, {
          orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        }),
      myDrafts: () =>
        this.inquiryCard(
          user,
          { AND: [INQUIRY_TAB_FILTER.draft, mineWhere(user)] },
          { orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], rejected: true },
        ),
      readyToPublish: () =>
        this.inquiryCard(user, INQUIRY_TAB_FILTER.ready, { orderBy: [{ approvedAt: 'asc' }, { id: 'asc' }] }),
      waitingQuotes: () =>
        this.inquiryCard(user, INQUIRY_TAB_FILTER.quoting, {
          orderBy: [{ currentDeadline: 'asc' }, { id: 'asc' }],
          progress: true,
        }),
      toOpen: () =>
        this.inquiryCard(user, INQUIRY_TAB_FILTER.closed, {
          orderBy: [{ currentDeadline: 'asc' }, { id: 'asc' }],
          progress: true,
        }),
      negotiations: () => this.negotiations(user),
      contractsToReview: () => this.contracts(user, 'PENDING_REVIEW'),
      contractsToApprove: () => this.contracts(user, 'PENDING_APPROVAL'),
    };
    const cards = await Promise.all(
      workbenchCards(user.permissions).map(async (key) => [key, await loaders[key]()] as const),
    );
    return Object.fromEntries(cards);
  }

  /** 询价单类卡片：条件与询价列表的页签一致（INQUIRY_TAB_FILTER），"查看全部"跳到对应页签 */
  private async inquiryCard(
    user: AuthUser,
    filter: Prisma.InquiryWhereInput,
    options: InquiryCardOptions,
  ): Promise<WorkbenchCardDto<WorkbenchInquiryItemDto>> {
    const where: Prisma.InquiryWhereInput = { AND: [this.scope.inquiryWhere(user), filter] };
    const [rows, total] = await Promise.all([
      this.prisma.inquiry.findMany({
        where,
        select: inquirySelect,
        orderBy: options.orderBy,
        take: WORKBENCH_CARD_LIMIT,
      }),
      this.prisma.inquiry.count({ where }),
    ]);
    const progress = options.progress ? await this.progress(rows) : null;
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        draftNo: r.draftNo,
        formalNo: r.formalNo,
        projectNo: r.projectNo,
        title: r.title,
        owner: r.owner,
        currentRoundNo: r.currentRoundNo,
        currentDeadline: iso(r.currentDeadline),
        submittedAt: iso(r.submittedAt),
        approvedAt: iso(r.approvedAt),
        updatedAt: r.updatedAt.toISOString(),
        // 只有驳回会把单据退回草稿，并且驳回意见必填（05 §1）
        rejected: !!options.rejected && r.lastRejectComment !== null,
        progress: progress?.get(r.id) ?? null,
      })),
    };
  }

  /** 当前轮次的响应进度：已提交或已拒绝 / 受邀家数（作废的报价单不算） */
  private async progress(rows: InquiryRow[]): Promise<Map<string, WorkbenchProgressDto>> {
    if (rows.length === 0) return new Map();
    const rounds = await this.prisma.inquiryRound.findMany({
      where: { OR: rows.map((r) => ({ inquiryId: r.id, roundNo: r.currentRoundNo })) },
      select: { id: true, inquiryId: true },
    });
    const counts = await this.prisma.quote.groupBy({
      by: ['roundId', 'status'],
      where: { roundId: { in: rounds.map((r) => r.id) }, status: { not: 'VOID' } },
      _count: { _all: true },
    });
    return new Map(
      rounds.map((round) => {
        const ofRound = counts.filter((c) => c.roundId === round.id);
        const sum = (list: typeof ofRound) => list.reduce((n, c) => n + c._count._all, 0);
        return [
          round.inquiryId,
          {
            responded: sum(ofRound.filter((c) => c.status === 'SUBMITTED' || c.status === 'DECLINED')),
            invited: sum(ofRound),
          },
        ];
      }),
    );
  }

  /**
   * 议价待处理：进行中（OPEN）的议价、最后一条消息来自供应商（拒绝或反提案，05 §5 轮到采购方）。
   * 只看开标中、已入围的报价单；不返回方案内容和价格
   */
  private async negotiations(user: AuthUser): Promise<WorkbenchCardDto<WorkbenchNegotiationItemDto>> {
    const rows = await this.prisma.negotiation.findMany({
      where: {
        status: 'OPEN',
        quote: {
          status: 'EVALUATING',
          shortlisted: true,
          round: { status: 'OPENED', inquiry: this.scope.inquiryWhere(user) },
        },
      },
      select: {
        quoteId: true,
        messages: { select: { party: true, type: true, createdAt: true }, orderBy: { seq: 'desc' }, take: 1 },
        quote: {
          select: {
            supplier: supplierBrief,
            round: {
              select: { roundNo: true, inquiry: { select: { id: true, formalNo: true, title: true } } },
            },
          },
        },
      },
    });
    const waiting = rows
      .filter((r) => r.messages[0]?.party === 'SUPPLIER')
      .sort(
        (a, b) =>
          a.messages[0].createdAt.getTime() - b.messages[0].createdAt.getTime() ||
          a.quoteId.localeCompare(b.quoteId),
      );
    return {
      total: waiting.length,
      items: waiting.slice(0, WORKBENCH_CARD_LIMIT).map((r) => ({
        quoteId: r.quoteId,
        inquiry: {
          id: r.quote.round.inquiry.id,
          formalNo: r.quote.round.inquiry.formalNo!,
          title: r.quote.round.inquiry.title,
        },
        roundNo: r.quote.round.roundNo,
        supplier: r.quote.supplier,
        lastMessage: { type: r.messages[0].type, createdAt: r.messages[0].createdAt.toISOString() },
      })),
    };
  }

  /**
   * 待审核 / 待批准合同：数据权限跟随询价单（05 §11），不返回合同金额。送审时间取最近一条审批记录；
   * 待审核 / 待批准的合同不能编辑，updatedAt 就是流转的时间，按它排序
   */
  private async contracts(
    user: AuthUser,
    status: ContractStatus,
  ): Promise<WorkbenchCardDto<WorkbenchContractItemDto>> {
    const where: Prisma.ContractWhereInput = { status, inquiry: this.scope.inquiryWhere(user) };
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        select: {
          id: true,
          contractNo: true,
          status: true,
          updatedAt: true,
          inquiry: { select: { id: true, formalNo: true, title: true } },
          supplier: supplierBrief,
          approvals: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: WORKBENCH_CARD_LIMIT,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        contractNo: r.contractNo,
        status: r.status,
        inquiry: { id: r.inquiry.id, formalNo: r.inquiry.formalNo!, title: r.inquiry.title },
        supplier: r.supplier,
        submittedAt: (r.approvals[0]?.createdAt ?? r.updatedAt).toISOString(),
      })),
    };
  }
}
