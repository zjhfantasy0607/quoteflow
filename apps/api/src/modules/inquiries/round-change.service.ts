import { Injectable } from '@nestjs/common';
import {
  computeChangeRoundActions,
  computeInquiryActions,
  type ChangeRoundInput,
  type InquiryAction,
  type InquiryDetailDto,
  type InquiryRoundBriefDto,
  type InquiryRoundDto,
  type RoundDiffDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { changedFields } from '../../common/audit-diff';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import type { Inquiry, InquiryRound, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryAccessService } from './inquiry-access.service';
import { FILE_ORDER, findDraftRoundNo, loadRoundDiff } from './inquiry-dto';
import { InquiriesService } from './inquiries.service';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * 规格变更的轮次（M13 R13-1、R13-2、R13-6、R13-7、R13-9，05 §3）：轮次列表、新建变更轮次（复制当前轮的询价行与附件挂载）、
 * 保存变更说明、放弃变更、与上一轮的规格对比。变更轮次的行和附件沿用 M06 的接口（isRoundEditable 已放开第 N 轮草稿），
 * 发布（"采购确认"）在 RoundWorkflowService.publish() 的变更分支。写操作都先锁询价单（完成或取消后只读，R12-8）
 */
@Injectable()
export class RoundChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly inquiries: InquiriesService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  /** GET /api/inquiries/:id/rounds：按轮次号，含每轮的行数、报价单数、入围家数 */
  async list(user: AuthUser, inquiryId: string): Promise<InquiryRoundBriefDto[]> {
    await this.access.findOrThrow(this.prisma, user, inquiryId);
    const rounds = await this.prisma.inquiryRound.findMany({
      where: { inquiryId },
      include: { _count: { select: { lines: true, quotes: true } } },
      orderBy: { roundNo: 'asc' },
    });
    const shortlisted = await this.prisma.quote.groupBy({
      by: ['roundId'],
      where: { roundId: { in: rounds.map((r) => r.id) }, shortlisted: true },
      _count: { _all: true },
    });
    const shortlistOf = new Map(shortlisted.map((g) => [g.roundId, g._count._all]));
    return rounds.map((r) => ({
      id: r.id,
      roundNo: r.roundNo,
      status: r.status,
      deadline: iso(r.deadline),
      publishedAt: iso(r.publishedAt),
      openedAt: iso(r.openedAt),
      evaluatedAt: iso(r.evaluatedAt),
      changeReason: r.changeReason,
      changeSummary: r.changeSummary,
      lineCount: r._count.lines,
      quoteCount: r._count.quotes,
      shortlistCount: shortlistOf.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * R13-1：询价单已通过、当前轮次等待报价 / 报价完成 / 开标中，且没有未发布的变更轮次（ROUND_DRAFT_EXISTS）。
   * 新建第 N 轮（DRAFT，截止留空），按行号复制当前轮的询价行（sourceLineId 指向原行）和附件挂载（新的挂载指向同一个文件，
   * 上传人不变）；当前轮在新轮发布前照常进行
   */
  async create(user: AuthUser, inquiryId: string, input: ChangeRoundInput): Promise<InquiryRoundDto> {
    const roundNo = await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.access.lockOrThrow(tx, user, inquiryId);
      const draftRoundNo = await findDraftRoundNo(tx, inquiryId);
      if (draftRoundNo) throw new AppException('ROUND_DRAFT_EXISTS', { roundNo: draftRoundNo });
      this.assertAction(
        computeInquiryActions({ ...inquiry, draftRoundNo }, user.permissions),
        inquiry,
        'createChangeRound',
      );
      const current = await tx.inquiryRound.findUniqueOrThrow({
        where: { inquiryId_roundNo: { inquiryId, roundNo: inquiry.currentRoundNo } },
      });
      const last = await tx.inquiryRound.aggregate({ where: { inquiryId }, _max: { roundNo: true } });
      const roundNo = (last._max.roundNo ?? 0) + 1;
      const now = this.clock.now();
      const round = await tx.inquiryRound.create({
        data: {
          inquiryId,
          roundNo,
          changeReason: input.changeReason ?? null,
          changeSummary: input.changeSummary ?? null,
          createdById: user.id,
          createdAt: now,
        },
      });
      const lines = await tx.inquiryLine.findMany({
        where: { roundId: current.id },
        orderBy: { lineNo: 'asc' },
      });
      const copies = await tx.inquiryLine.createManyAndReturn({
        data: lines.map((l) => ({
          roundId: round.id,
          lineNo: l.lineNo,
          materialId: l.materialId,
          categoryId: l.categoryId,
          materialCode: l.materialCode,
          nameZh: l.nameZh,
          nameEn: l.nameEn,
          spec: l.spec,
          unitCode: l.unitCode,
          quantity: l.quantity,
          brand: l.brand,
          drawingRef: l.drawingRef,
          remark: l.remark,
          sourceLineId: l.id,
          createdAt: now,
        })),
        select: { id: true, sourceLineId: true },
      });
      const copyOf = new Map(copies.map((c) => [c.sourceLineId!, c.id]));
      const files = await tx.inquiryFile.findMany({ where: { roundId: current.id }, orderBy: FILE_ORDER });
      if (files.length > 0) {
        await tx.inquiryFile.createMany({
          data: files.map((f) => ({
            roundId: round.id,
            lineId: f.lineId ? copyOf.get(f.lineId)! : null,
            fileId: f.fileId,
            kind: f.kind,
            sort: f.sort,
            uploadedById: f.uploadedById,
            createdAt: now,
          })),
        });
      }
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.createChangeRound',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `${inquiry.formalNo} · R${roundNo}`,
          detail: {
            roundNo,
            fromRoundNo: current.roundNo,
            lineCount: lines.length,
            fileCount: files.length,
            changeReason: round.changeReason,
            changeSummary: round.changeSummary,
          },
        },
        tx,
      );
      return roundNo;
    });
    return this.inquiries.roundDetail(this.prisma, user, inquiryId, roundNo);
  }

  /** R13-2：变更原因、主要变更内容随时可以保存（发布时才必填）；整体替换，没变化不记日志 */
  async update(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: ChangeRoundInput,
  ): Promise<InquiryRoundDto> {
    await this.prisma.$transaction(async (tx) => {
      const { inquiry, round } = await this.lockDraftRound(tx, user, inquiryId, roundNo, 'editChangeRound');
      const data = { changeReason: input.changeReason ?? null, changeSummary: input.changeSummary ?? null };
      const changes = changedFields(round, data);
      if (Object.keys(changes).length === 0) return;
      await tx.inquiryRound.update({ where: { id: round.id }, data });
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.updateChangeRound',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `${inquiry.formalNo} · R${roundNo}`,
          detail: { roundNo, changes },
        },
        tx,
      );
    });
    return this.inquiries.roundDetail(this.prisma, user, inquiryId, roundNo);
  }

  /** R13-7：物理删除变更草稿（连同行和附件挂载，只在草稿里的文件之后由清理任务删除）；当前轮不受影响 */
  async discard(user: AuthUser, inquiryId: string, roundNo: number): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { inquiry, round } = await this.lockDraftRound(
        tx,
        user,
        inquiryId,
        roundNo,
        'discardChangeRound',
      );
      const lineCount = await tx.inquiryLine.count({ where: { roundId: round.id } });
      const fileCount = await tx.inquiryFile.count({ where: { roundId: round.id } });
      await tx.inquiryRound.delete({ where: { id: round.id } });
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.discardChangeRound',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `${inquiry.formalNo} · R${roundNo}`,
          detail: {
            roundNo,
            lineCount,
            fileCount,
            changeReason: round.changeReason,
            changeSummary: round.changeSummary,
          },
        },
        tx,
      );
    });
    return this.inquiries.detail(this.prisma, user, inquiryId);
  }

  /** R13-6：与上一轮的规格对比（含询价行备注）；第 1 轮没有上一轮，404 */
  async diff(user: AuthUser, inquiryId: string, roundNo: number): Promise<RoundDiffDto> {
    await this.access.findOrThrow(this.prisma, user, inquiryId);
    const diff = await loadRoundDiff(this.prisma, inquiryId, roundNo, { includeRemark: true });
    if (!diff) throw new AppException('NOT_FOUND');
    return diff;
  }

  /** 锁住询价单，取出第 roundNo 轮的变更草稿：不存在 404；已发布（或第 1 轮）ROUND_INVALID_STATUS */
  private async lockDraftRound(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    action: InquiryAction,
  ): Promise<{ inquiry: Inquiry; round: InquiryRound }> {
    const inquiry = await this.access.lockOrThrow(tx, user, inquiryId);
    const round = await tx.inquiryRound.findUnique({ where: { inquiryId_roundNo: { inquiryId, roundNo } } });
    if (!round) throw new AppException('NOT_FOUND');
    if (round.roundNo < 2 || round.status !== 'DRAFT') throw new AppException('ROUND_INVALID_STATUS');
    this.assertAction(computeChangeRoundActions(inquiry, user.permissions), inquiry, action);
    return { inquiry, round };
  }

  /** 功能权限已由守卫检查，这里不符合只可能是状态不对（03 §6） */
  private assertAction(actions: InquiryAction[], inquiry: Inquiry, action: InquiryAction): void {
    if (actions.includes(action)) return;
    throw new AppException(
      inquiry.docStatus === 'APPROVED' ? 'ROUND_INVALID_STATUS' : 'INQUIRY_INVALID_STATUS',
    );
  }
}
