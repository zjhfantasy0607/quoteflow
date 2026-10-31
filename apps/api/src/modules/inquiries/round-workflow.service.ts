import { Injectable } from '@nestjs/common';
import {
  computeChangeRoundActions,
  computeInquiryActions,
  hasPplVariant,
  NEGOTIATION_AUTO_CLOSE,
  PPL_MASTER_CODE,
  QUOTE_VOIDABLE_STATUSES,
  type ExtendDeadlineInput,
  type InquiryAction,
  type InquiryDetailDto,
  type LateInviteInput,
  type PublishRoundInput,
  type RemindQuotesInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { formatAppTime } from '../../common/time';
import type { Inquiry, InquiryRound, Prisma, Supplier } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { ParamsService } from '../../infra/params/params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MaterialCategoriesService } from '../material-categories/material-categories.service';
import { closeOpenNegotiations } from '../negotiations/close-negotiations';
import { PointsService } from '../points/points.service';
import { PplService } from '../ppl/ppl.service';
import { InquiryAccessService } from './inquiry-access.service';
import { InquiryNoticesService, type NoticeQuote } from './inquiry-notices.service';
import { InquiriesService } from './inquiries.service';
import { RoundStateService } from './round-state.service';

const HOUR_MS = 3600_000;

const codes = (suppliers: { code: string }[]) => suppliers.map((s) => s.code).join(', ');

/**
 * 当前轮次的发布、补充邀请、催报、延期（05 §3、M07 R07-3 ~ R07-10），提前截止与开标（M10 R10-2 ~ R10-5），
 * 规格变更轮次的发布（"采购确认"，M13 R13-3、R13-4）
 */
@Injectable()
export class RoundWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly inquiries: InquiriesService,
    private readonly roundState: RoundStateService,
    private readonly notices: InquiryNoticesService,
    private readonly categories: MaterialCategoriesService,
    private readonly ppl: PplService,
    private readonly points: PointsService,
    private readonly params: ParamsService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  /**
   * 发布：当前轮次（第 1 轮）按 R07-3、R07-4；变更草稿（第 N 轮）走 publishChange()（M13）。
   * R07-3 前置条件：询价单已通过；受邀 ≥ 1 且全部启用；截止 ≥ 现在 + inquiry.minDeadlineHours。
   * R07-4 同一事务：冻结模板集版本与变体、每家一条 Quote(INVITED)、每家一封邀请、轮次 → WAITING_QUOTES
   */
  async publish(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: PublishRoundInput,
  ): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.access.lockOrThrow(tx, user, inquiryId);
      if (roundNo !== locked.currentRoundNo) {
        await this.publishChange(tx, user, locked, roundNo, input);
        return;
      }
      const { inquiry, round } = await this.lockCurrentRound(tx, user, inquiryId, roundNo, 'publish');
      const now = this.clock.now();
      await this.assertDeadline(input, now);
      const suppliers = await this.inviteesToPublish(tx, inquiryId);
      const lineCount = await tx.inquiryLine.count({ where: { roundId: round.id } });
      if (lineCount === 0) throw new AppException('INQUIRY_NO_LINES');
      const template = await this.freezeTemplate(tx, inquiry.materialCategoryId);
      await this.roundState.apply(tx, round.id, 'publish', {
        data: { deadline: input.deadline, ...template, publishedAt: now, publishedById: user.id },
        audit: {
          actor: user,
          summary: [inquiry.formalNo, formatAppTime(input.deadline), codes(suppliers)].join(' · '),
          detail: {
            roundNo,
            deadline: input.deadline.toISOString(),
            supplierIds: suppliers.map((s) => s.id),
            ...template,
          },
        },
      });
      const quotes = await this.createQuotes(tx, round.id, suppliers, now);
      await this.notices.invitation(tx, inquiry, quotes, { deadline: input.deadline, lineCount });
    });
    return this.inquiries.detail(this.prisma, user, inquiryId);
  }

  /**
   * M13 R13-3、R13-4（05 §3）：发布变更草稿（"采购确认"）。前置条件：当前轮等待报价 / 报价完成 / 开标中，变更原因和
   * 变更内容已填（ROUND_CHANGE_REASON_REQUIRED），受邀 ≥ 1 且全部启用，截止有效，至少一行。同一事务：上一轮的报价 → VOID、
   * 进行中的议价关闭（AUTO_CLOSED_BY_CHANGE）、上一轮 → SUPERSEDED；切换 currentRoundNo；冻结当时激活的模板、本轮 → 等待报价；
   * 按当前受邀名单建报价单；上一轮也受邀的供应商收 change.spec（变更原因、内容、新截止），新增的收 invitation；审计
   */
  private async publishChange(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    inquiry: Inquiry,
    roundNo: number,
    input: PublishRoundInput,
  ): Promise<void> {
    const round = await tx.inquiryRound.findUnique({
      where: { inquiryId_roundNo: { inquiryId: inquiry.id, roundNo } },
    });
    if (!round) throw new AppException('NOT_FOUND');
    // 作废的、已发布的旧轮次不能再发布
    if (round.status !== 'DRAFT' || round.roundNo < 2) throw new AppException('ROUND_INVALID_STATUS');
    if (!computeChangeRoundActions(inquiry, user.permissions).includes('publish')) {
      throw new AppException(
        inquiry.docStatus === 'APPROVED' ? 'ROUND_INVALID_STATUS' : 'INQUIRY_INVALID_STATUS',
      );
    }
    if (!round.changeReason || !round.changeSummary) throw new AppException('ROUND_CHANGE_REASON_REQUIRED');
    const now = this.clock.now();
    await this.assertDeadline(input, now);
    const suppliers = await this.inviteesToPublish(tx, inquiry.id);
    const lineCount = await tx.inquiryLine.count({ where: { roundId: round.id } });
    if (lineCount === 0) throw new AppException('INQUIRY_NO_LINES');
    const template = await this.freezeTemplate(tx, inquiry.materialCategoryId);

    const previous = await tx.inquiryRound.findUniqueOrThrow({
      where: { inquiryId_roundNo: { inquiryId: inquiry.id, roundNo: inquiry.currentRoundNo } },
    });
    const previousSuppliers = new Set(
      (await tx.quote.findMany({ where: { roundId: previous.id }, select: { supplierId: true } })).map(
        (q) => q.supplierId,
      ),
    );
    const voided = await tx.quote.updateMany({
      where: { roundId: previous.id, status: { in: [...QUOTE_VOIDABLE_STATUSES] } },
      data: { status: 'VOID' },
    });
    const closedNegotiations = await closeOpenNegotiations(
      tx,
      [previous.id],
      NEGOTIATION_AUTO_CLOSE.change,
      user.id,
      now,
    );
    // 先作废上一轮（此时它还是当前轮次，冗余字段跟着变），再切换当前轮次、发布本轮（冗余字段同步为本轮，I-2）
    await this.roundState.apply(tx, previous.id, 'supersede');
    await tx.inquiry.update({ where: { id: inquiry.id }, data: { currentRoundNo: round.roundNo } });
    await this.roundState.apply(tx, round.id, 'publish', {
      data: { deadline: input.deadline, ...template, publishedAt: now, publishedById: user.id },
    });
    const quotes = await this.createQuotes(tx, round.id, suppliers, now);
    const changed = quotes.filter((q) => previousSuppliers.has(q.supplier.id));
    const invited = quotes.filter((q) => !previousSuppliers.has(q.supplier.id));
    await this.notices.changeSpec(tx, inquiry, changed, {
      roundNo: round.roundNo,
      changeReason: round.changeReason,
      changeSummary: round.changeSummary,
      deadline: input.deadline,
      lineCount,
    });
    await this.notices.invitation(tx, inquiry, invited, { deadline: input.deadline, lineCount });
    await this.audit.log(
      {
        actor: user,
        action: 'inquiry.publishChange',
        entityType: 'inquiry',
        entityId: inquiry.id,
        summary: [
          inquiry.formalNo,
          `R${round.roundNo}`,
          formatAppTime(input.deadline),
          codes(suppliers),
        ].join(' · '),
        detail: {
          roundNo: round.roundNo,
          supersededRoundNo: previous.roundNo,
          deadline: input.deadline.toISOString(),
          supplierIds: suppliers.map((s) => s.id),
          changeSpecQuoteIds: changed.map((q) => q.id),
          invitedQuoteIds: invited.map((q) => q.id),
          voidedQuotes: voided.count,
          closedNegotiations,
          ...template,
        },
      },
      tx,
    );
  }

  /** R07-3：截止 ≥ 现在 + inquiry.minDeadlineHours */
  private async assertDeadline(input: PublishRoundInput, now: Date): Promise<void> {
    const minHours = await this.params.get('inquiry.minDeadlineHours');
    if (input.deadline.getTime() < now.getTime() + minHours * HOUR_MS) {
      throw new AppException('INQUIRY_DEADLINE_INVALID', { minHours });
    }
  }

  /** R07-3：受邀名单（按加入时间、编码）≥ 1 且全部启用 */
  private async inviteesToPublish(tx: Prisma.TransactionClient, inquiryId: string): Promise<Supplier[]> {
    const invitees = await tx.inquiryInvitee.findMany({
      where: { inquiryId },
      include: { supplier: true },
      orderBy: [{ createdAt: 'asc' }, { supplier: { code: 'asc' } }],
    });
    if (invitees.length === 0) throw new AppException('INQUIRY_NO_INVITEES');
    const disabled = invitees.filter((i) => i.supplier.status !== 'ENABLED').map((i) => i.supplierId);
    if (disabled.length > 0)
      throw new AppException('INQUIRY_SUPPLIER_NOT_INVITABLE', { supplierIds: disabled });
    return invitees.map((i) => i.supplier);
  }

  /** R07-7：等待报价时追加启用的供应商：写入名单、建报价单、发邀请；本轮已经邀请过的跳过 */
  async lateInvite(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: LateInviteInput,
  ): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { inquiry, round } = await this.lockCurrentRound(tx, user, inquiryId, roundNo, 'lateInvite');
      const invited = new Set(
        (await tx.quote.findMany({ where: { roundId: round.id }, select: { supplierId: true } })).map(
          (q) => q.supplierId,
        ),
      );
      const ids = input.supplierIds.filter((id) => !invited.has(id));
      const suppliers = await tx.supplier.findMany({ where: { id: { in: ids } }, orderBy: { code: 'asc' } });
      const byId = new Map(suppliers.map((s) => [s.id, s]));
      const notInvitable = ids.filter((id) => byId.get(id)?.status !== 'ENABLED');
      if (notInvitable.length > 0) {
        throw new AppException('INQUIRY_SUPPLIER_NOT_INVITABLE', { supplierIds: notInvitable });
      }
      if (suppliers.length === 0) return;
      const now = this.clock.now();
      await tx.inquiryInvitee.createMany({
        data: suppliers.map((s) => ({ inquiryId, supplierId: s.id, addedById: user.id, createdAt: now })),
        skipDuplicates: true,
      });
      const quotes = await this.createQuotes(tx, round.id, suppliers, now);
      const lineCount = await tx.inquiryLine.count({ where: { roundId: round.id } });
      await this.notices.invitation(tx, inquiry, quotes, { deadline: round.deadline!, lineCount });
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.lateInvite',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `${inquiry.formalNo} · + ${codes(suppliers)}`,
          detail: { roundNo, supplierIds: suppliers.map((s) => s.id) },
        },
        tx,
      );
    });
    return this.inquiries.detail(this.prisma, user, inquiryId);
  }

  /** R07-8：只能选本轮未响应（INVITED）的报价单，每次每家发一封 reminder */
  async remind(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: RemindQuotesInput,
  ): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { inquiry, round } = await this.lockCurrentRound(tx, user, inquiryId, roundNo, 'remind');
      const quotes = await tx.quote.findMany({
        where: { id: { in: input.quoteIds }, roundId: round.id },
        include: { supplier: true },
        orderBy: { supplier: { code: 'asc' } },
      });
      if (quotes.length !== input.quoteIds.length) throw new AppException('NOT_FOUND');
      const responded = quotes.filter((q) => q.status !== 'INVITED').map((q) => q.id);
      if (responded.length > 0) throw new AppException('QUOTE_INVALID_STATUS', { quoteIds: responded });
      await this.notices.reminder(tx, inquiry, quotes, { deadline: round.deadline! });
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.remind',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `${inquiry.formalNo} · ${codes(quotes.map((q) => q.supplier))}`,
          detail: { roundNo, quoteIds: quotes.map((q) => q.id) },
        },
        tx,
      );
    });
    return this.inquiries.detail(this.prisma, user, inquiryId);
  }

  /**
   * R07-10、05 §3：新截止 > max(原截止, 现在 + 最小小时数)；报价完成的轮次回到等待报价，清空截止与自动催报标记；
   * 通知受邀且没有拒绝的供应商
   */
  async extendDeadline(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: ExtendDeadlineInput,
  ): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { inquiry, round } = await this.lockCurrentRound(tx, user, inquiryId, roundNo, 'extendDeadline');
      const now = this.clock.now();
      const minHours = await this.params.get('inquiry.minDeadlineHours');
      const previous = round.deadline!;
      const earliest = Math.max(previous.getTime(), now.getTime() + minHours * HOUR_MS);
      if (input.deadline.getTime() <= earliest)
        throw new AppException('INQUIRY_DEADLINE_INVALID', { minHours });
      await this.roundState.apply(tx, round.id, 'extendDeadline', {
        data: {
          deadline: input.deadline,
          quotesClosedAt: null,
          closedEarly: false,
          autoReminderSentAt: null,
        },
        audit: {
          actor: user,
          summary: `${inquiry.formalNo} · ${formatAppTime(previous)} → ${formatAppTime(input.deadline)}`,
          detail: { roundNo, from: previous.toISOString(), to: input.deadline.toISOString() },
        },
      });
      const quotes = await tx.quote.findMany({
        where: { roundId: round.id, status: { notIn: ['DECLINED', 'VOID'] } },
        include: { supplier: true },
        orderBy: { supplier: { code: 'asc' } },
      });
      await this.notices.deadlineChanged(tx, inquiry, quotes, {
        previousDeadline: previous,
        deadline: input.deadline,
      });
    });
    return this.inquiries.detail(this.prisma, user, inquiryId);
  }

  /**
   * R10-2：等待报价、全部报价单都已响应（已提交或已拒绝）时提前截止，之后供应商不能再改（R09-1）。
   * 供应商提交前会给询价单加共享锁，和这里的行锁互斥，不会出现"检查完又有人改成未响应"
   */
  async closeEarly(user: AuthUser, inquiryId: string, roundNo: number): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { inquiry, round } = await this.lockCurrentRound(tx, user, inquiryId, roundNo, 'closeEarly');
      const pending = await tx.quote.count({ where: { roundId: round.id, status: 'INVITED' } });
      if (pending > 0) throw new AppException('ROUND_NOT_ALL_RESPONDED', { pending });
      await this.roundState.apply(tx, round.id, 'closeEarly', {
        data: { quotesClosedAt: this.clock.now(), closedEarly: true },
        audit: { actor: user, summary: inquiry.formalNo!, detail: { roundNo } },
      });
    });
    return this.inquiries.detail(this.prisma, user, inquiryId);
  }

  /**
   * R10-3 ~ R10-5 开标：只有报价完成的轮次能开。同一事务：轮次 → OPENED（openedAt/By）、已提交的报价 → EVALUATING
   * （未响应、已拒绝的不变）、结算积分、给进入评标的供应商发 opening 邮件、审计（不含金额）。
   * 并发开标两次时第二次读到的已是 OPENED，返回 ROUND_INVALID_STATUS
   */
  async open(user: AuthUser, inquiryId: string, roundNo: number): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { inquiry, round } = await this.lockCurrentRound(tx, user, inquiryId, roundNo, 'open');
      const now = this.clock.now();
      const quotes = await tx.quote.findMany({
        where: { roundId: round.id },
        include: { supplier: true },
        orderBy: { supplier: { code: 'asc' } },
      });
      const submitted = quotes.filter((q) => q.status === 'SUBMITTED');
      await this.roundState.apply(tx, round.id, 'open', {
        data: { openedAt: now, openedById: user.id },
        audit: {
          actor: user,
          summary: [inquiry.formalNo, codes(submitted.map((q) => q.supplier))].filter(Boolean).join(' · '),
          detail: {
            roundNo,
            evaluatingQuoteIds: submitted.map((q) => q.id),
            noResponseQuoteIds: quotes.filter((q) => q.status === 'INVITED').map((q) => q.id),
          },
        },
      });
      await tx.quote.updateMany({
        where: { roundId: round.id, status: 'SUBMITTED' },
        data: { status: 'EVALUATING' },
      });
      await this.points.settleOpening(tx, round, quotes);
      await this.notices.opening(tx, inquiry, submitted, { openedAt: now });
    });
    return this.inquiries.detail(this.prisma, user, inquiryId);
  }

  /**
   * 锁住询价单，取出要操作的轮次并复核动作（03 §6）。只能操作当前轮次（变更草稿的发布见 publishChange()）；
   * 功能权限已由守卫检查，这里不符合只可能是状态不对：单据不是已通过时报 INQUIRY_INVALID_STATUS，否则报轮次状态
   */
  private async lockCurrentRound(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    action: InquiryAction,
  ): Promise<{ inquiry: Inquiry; round: InquiryRound }> {
    const inquiry = await this.access.lockOrThrow(tx, user, inquiryId);
    const round = await tx.inquiryRound.findUnique({ where: { inquiryId_roundNo: { inquiryId, roundNo } } });
    if (!round) throw new AppException('NOT_FOUND');
    if (round.roundNo !== inquiry.currentRoundNo) throw new AppException('ROUND_INVALID_STATUS');
    if (!computeInquiryActions(inquiry, user.permissions).includes(action)) {
      throw new AppException(
        inquiry.docStatus === 'APPROVED' ? 'ROUND_INVALID_STATUS' : 'INQUIRY_INVALID_STATUS',
      );
    }
    return { inquiry, round };
  }

  /**
   * R07-4、04 §2：冻结当前激活的模板集版本和按询价单材料类别解析出的变体（没有绑定 = 主模板 PPL-MASTER）。
   * 分类绑定的变体在激活的版本里已经没有了（B-12）时拒绝发布，由管理员调整分类绑定或模板后再发
   */
  private async freezeTemplate(
    tx: Prisma.TransactionClient,
    materialCategoryId: string,
  ): Promise<{ pplTemplateVersion: number; pplVariantCode: string }> {
    const active = await this.ppl.active(tx);
    if (!active) throw new AppException('PPL_SET_NOT_FOUND', { version: null });
    const { variantCode } = await this.categories.pplVariant(materialCategoryId, tx);
    const code = variantCode ?? PPL_MASTER_CODE;
    if (!hasPplVariant(active.definition, code))
      throw new AppException('PPL_VARIANT_NOT_FOUND', { variantCode: code });
    return { pplTemplateVersion: active.version, pplVariantCode: code };
  }

  /** I-5：每家一条 Quote(INVITED, invitedAt = now)，按 suppliers 的顺序返回 */
  private async createQuotes(
    tx: Prisma.TransactionClient,
    roundId: string,
    suppliers: Supplier[],
    now: Date,
  ): Promise<NoticeQuote[]> {
    await tx.quote.createMany({
      data: suppliers.map((s) => ({
        roundId,
        supplierId: s.id,
        status: 'INVITED',
        invitedAt: now,
        createdAt: now,
      })),
    });
    const rows = await tx.quote.findMany({
      where: { roundId, supplierId: { in: suppliers.map((s) => s.id) } },
      select: { id: true, supplierId: true },
    });
    const bySupplier = new Map(rows.map((q) => [q.supplierId, q.id]));
    return suppliers.map((supplier) => ({ id: bySupplier.get(supplier.id)!, supplier }));
  }
}
