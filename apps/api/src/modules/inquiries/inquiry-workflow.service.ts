import { Injectable } from '@nestjs/common';
import {
  computeInquiryActions,
  NEGOTIATION_AUTO_CLOSE,
  QUOTE_VOIDABLE_STATUSES,
  ROUND_TRANSITIONS,
  type ApproveInquiryInput,
  type CancelInquiryInput,
  type InquiryAction,
  type InquiryDetailDto,
  type RejectInquiryInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import { buildAuthUser, userWithRolesInclude } from '../../common/auth/session.service';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { AppConfig } from '../../config/app-config';
import type { Inquiry, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { MailService, userMailLanguage } from '../../infra/mail/mail.service';
import { SequenceService } from '../../infra/sequences/sequence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { closeOpenNegotiations } from '../negotiations/close-negotiations';
import { InquiryAccessService } from './inquiry-access.service';
import { InquiryNoticesService } from './inquiry-notices.service';
import { InquiriesService } from './inquiries.service';
import { RoundStateService } from './round-state.service';

const NO_REQUEST = { ip: null, userAgent: null };

interface Recipient {
  id: string;
  name: string;
  email: string;
  locale: string;
}

/** 单据状态流转（05 §1）：提交审批、通过、驳回、取消 */
@Injectable()
export class InquiryWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly inquiries: InquiriesService,
    private readonly roundState: RoundStateService,
    private readonly notices: InquiryNoticesService,
    private readonly scope: ScopeService,
    private readonly sequences: SequenceService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly config: AppConfig,
  ) {}

  /** R06-6：至少 1 行，每行有分类、数量 > 0；R06-8 给每个审批人发 approval.request */
  async submit(user: AuthUser, id: string): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.access.lockOrThrow(tx, user, id);
      this.assertAction(user, inquiry, 'submit');
      const lines = await tx.inquiryLine.findMany({
        where: { round: { inquiryId: id, roundNo: 1 } },
        select: { lineNo: true, categoryId: true, quantity: true },
        orderBy: { lineNo: 'asc' },
      });
      if (lines.length === 0) throw new AppException('INQUIRY_NO_LINES');
      const issues = lines.flatMap((l, i) => [
        ...(l.categoryId
          ? []
          : [{ path: `lines.${i}.categoryId`, code: 'required', message: 'Category is required' }]),
        ...(l.quantity.gt(0)
          ? []
          : [{ path: `lines.${i}.quantity`, code: 'too_small', message: 'Quantity must be greater than 0' }]),
      ]);
      if (issues.length > 0) throw new AppException('VALIDATION_FAILED', undefined, issues);

      const now = this.clock.now();
      const res = await tx.inquiry.updateMany({
        where: { id, docStatus: 'DRAFT' },
        data: { docStatus: 'PENDING_APPROVAL', submittedAt: now },
      });
      if (res.count !== 1) throw new AppException('INQUIRY_INVALID_STATUS');
      await tx.inquiryApproval.create({
        data: { inquiryId: id, action: 'SUBMIT', actorId: user.id, createdAt: now },
      });
      for (const approver of await this.approvers(tx, inquiry)) {
        await this.mail.enqueue(tx, {
          templateKey: 'approval.request',
          language: userMailLanguage(approver),
          to: [approver.email],
          userId: approver.id,
          inquiryId: id,
          data: {
            name: approver.name,
            inquiry: { draftNo: inquiry.draftNo, projectNo: inquiry.projectNo, title: inquiry.title },
            submitterName: user.name,
            link: this.link(id),
          },
        });
      }
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.submit',
          entityType: 'inquiry',
          entityId: id,
          summary: inquiry.draftNo,
        },
        tx,
      );
    });
    return this.inquiries.detail(this.prisma, user, id);
  }

  /** R06-7：生成正式询价号 RFQ-yyyymm-nnnn；结果发给负责人和创建人 */
  async approve(user: AuthUser, id: string, input: ApproveInquiryInput): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.access.lockOrThrow(tx, user, id);
      this.assertAction(user, inquiry, 'approve');
      const now = this.clock.now();
      const formalNo = await this.sequences.formalNo(now, tx);
      const res = await tx.inquiry.updateMany({
        where: { id, docStatus: 'PENDING_APPROVAL' },
        data: { docStatus: 'APPROVED', formalNo, approvedAt: now, approvedById: user.id },
      });
      if (res.count !== 1) throw new AppException('INQUIRY_INVALID_STATUS');
      const comment = input.comment ?? null;
      await tx.inquiryApproval.create({
        data: { inquiryId: id, action: 'APPROVE', comment, actorId: user.id, createdAt: now },
      });
      await this.notifyResult(tx, { ...inquiry, formalNo }, user, true, comment);
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.approve',
          entityType: 'inquiry',
          entityId: id,
          summary: `${inquiry.draftNo} → ${formalNo}`,
          ...(comment ? { detail: { comment } } : {}),
        },
        tx,
      );
    });
    return this.inquiries.detail(this.prisma, user, id);
  }

  /** R06-7：意见必填，回到草稿，编辑页顶部显示最近一次驳回意见 */
  async reject(user: AuthUser, id: string, input: RejectInquiryInput): Promise<InquiryDetailDto> {
    if (!input.comment) throw new AppException('INQUIRY_REJECT_COMMENT_REQUIRED');
    const comment = input.comment;
    await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.access.lockOrThrow(tx, user, id);
      this.assertAction(user, inquiry, 'reject');
      const res = await tx.inquiry.updateMany({
        where: { id, docStatus: 'PENDING_APPROVAL' },
        data: { docStatus: 'DRAFT', lastRejectComment: comment },
      });
      if (res.count !== 1) throw new AppException('INQUIRY_INVALID_STATUS');
      await tx.inquiryApproval.create({
        data: { inquiryId: id, action: 'REJECT', comment, actorId: user.id, createdAt: this.clock.now() },
      });
      await this.notifyResult(tx, inquiry, user, false, comment);
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.reject',
          entityType: 'inquiry',
          entityId: id,
          summary: inquiry.draftNo,
          detail: { comment },
        },
        tx,
      );
    });
    return this.inquiries.detail(this.prisma, user, id);
  }

  /**
   * R06-9、R07-11、05 §1：原因必填；当前轮次评标完成后不能取消。当前轮次和变更草稿轮次一起取消，
   * 这些轮次的报价单 → VOID，进行中的议价关闭（系统 CLOSE 消息 AUTO_CLOSED_BY_CANCEL）；发布过的，
   * 给受邀且没有拒绝的供应商发 change.cancel（含取消原因）
   */
  async cancel(user: AuthUser, id: string, input: CancelInquiryInput): Promise<InquiryDetailDto> {
    if (!input.reason) throw new AppException('INQUIRY_CANCEL_REASON_REQUIRED');
    const reason = input.reason;
    await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.access.lockOrThrow(tx, user, id);
      this.assertAction(user, inquiry, 'cancel');
      const res = await tx.inquiry.updateMany({
        where: {
          id,
          docStatus: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] },
          currentRoundStatus: { not: 'EVALUATED' },
        },
        data: { docStatus: 'CANCELLED', cancelledAt: this.clock.now(), cancelReason: reason },
      });
      if (res.count !== 1) throw new AppException('INQUIRY_INVALID_STATUS');
      const rounds = await tx.inquiryRound.findMany({
        where: { inquiryId: id, status: { in: [...ROUND_TRANSITIONS.cancel.from] } },
        select: { id: true },
        orderBy: { roundNo: 'asc' },
      });
      const roundIds = rounds.map((r) => r.id);
      // 先取出要通知的（作废后就分不出谁拒绝过了）
      const notify = await tx.quote.findMany({
        where: { roundId: { in: roundIds }, status: { in: ['INVITED', 'SUBMITTED', 'EVALUATING'] } },
        include: { supplier: true },
        orderBy: { supplier: { code: 'asc' } },
      });
      const voided = await tx.quote.updateMany({
        where: { roundId: { in: roundIds }, status: { in: [...QUOTE_VOIDABLE_STATUSES] } },
        data: { status: 'VOID' },
      });
      const closedNegotiations = await closeOpenNegotiations(
        tx,
        roundIds,
        NEGOTIATION_AUTO_CLOSE.cancel,
        user.id,
        this.clock.now(),
      );
      for (const round of rounds) await this.roundState.apply(tx, round.id, 'cancel');
      await this.notices.cancelled(tx, inquiry, notify, reason);
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.cancel',
          entityType: 'inquiry',
          entityId: id,
          summary: inquiry.formalNo ?? inquiry.draftNo,
          detail: { reason, voidedQuotes: voided.count, closedNegotiations },
        },
        tx,
      );
    });
    return this.inquiries.detail(this.prisma, user, id);
  }

  /** 按钮显示和接口放行用同一个函数（03 §6）；功能权限已由守卫检查，这里不符合只可能是状态不对 */
  private assertAction(user: AuthUser, inquiry: Inquiry, action: InquiryAction): void {
    if (!computeInquiryActions(inquiry, user.permissions).includes(action)) {
      throw new AppException('INQUIRY_INVALID_STATUS');
    }
  }

  /** R06-8：审批人 = 启用的内部用户中有 inquiry:approve、且数据权限覆盖该单的人（没有邮箱的收不到邮件） */
  private async approvers(tx: Prisma.TransactionClient, inquiry: Inquiry): Promise<Recipient[]> {
    const users = await tx.user.findMany({
      where: {
        userType: 'INTERNAL',
        status: 'ACTIVE',
        email: { not: null },
        roles: { some: { role: { forSupplier: false, permissions: { has: 'inquiry:approve' } } } },
      },
      include: userWithRolesInclude,
      orderBy: { username: 'asc' },
    });
    return users
      .filter((u) => {
        const auth = buildAuthUser(u, '', NO_REQUEST);
        return auth.permissions.has('inquiry:approve') && this.scope.coversInquiry(auth, inquiry);
      })
      .map((u) => ({ id: u.id, name: u.name, email: u.email!, locale: u.locale }));
  }

  /** R06-8：审批结果发给负责人和创建人（同一人只发一封） */
  private async notifyResult(
    tx: Prisma.TransactionClient,
    inquiry: Inquiry,
    approver: AuthUser,
    approved: boolean,
    comment: string | null,
  ): Promise<void> {
    const recipients = await tx.user.findMany({
      where: { id: { in: [inquiry.ownerId, inquiry.createdById] }, status: 'ACTIVE', email: { not: null } },
      select: { id: true, name: true, email: true, locale: true },
      orderBy: { username: 'asc' },
    });
    for (const r of recipients) {
      await this.mail.enqueue(tx, {
        templateKey: 'approval.result',
        language: userMailLanguage(r),
        to: [r.email!],
        userId: r.id,
        inquiryId: inquiry.id,
        data: {
          name: r.name,
          approved,
          inquiry: {
            draftNo: inquiry.draftNo,
            formalNo: inquiry.formalNo,
            projectNo: inquiry.projectNo,
            title: inquiry.title,
          },
          approverName: approver.name,
          comment,
          link: this.link(inquiry.id),
        },
      });
    }
  }

  private link(id: string): string {
    return `${this.config.get('APP_BASE_URL')}/inquiries/${id}`;
  }
}
