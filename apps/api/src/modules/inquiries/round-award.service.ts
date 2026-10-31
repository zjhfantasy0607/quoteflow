import { Injectable } from '@nestjs/common';
import {
  computeInquiryActions,
  NEGOTIATION_AUTO_CLOSE,
  type AwardRoundInput,
  type InquiryDetailDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { ParamsService } from '../../infra/params/params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractDraftFactory } from '../contracts/contract-draft.factory';
import { closeOpenNegotiations } from '../negotiations/close-negotiations';
import { PointsService } from '../points/points.service';
import { InquiryAccessService } from './inquiry-access.service';
import { findDraftRoundNo } from './inquiry-dto';
import { InquiryNoticesService } from './inquiry-notices.service';
import { InquiriesService } from './inquiries.service';
import { RoundStateService } from './round-state.service';

/**
 * 定标（M12 R12-1 ~ R12-9，05 §3）：采购主管在评标中（OPENED）的当前轮次指定 1 家评标中的报价中标。同一事务：
 * 合同草稿（快照取定标前的议价记录）→ 关闭进行中的议价（系统 CLOSE 消息 AUTO_CLOSED_BY_AWARD）→ 中标 WON、其余评标中的
 * LOST（未响应、已拒绝不变）→ 轮次 EVALUATED（evaluatedAt、awardedById、awardComment，审计 inquiry.award，不含金额）→
 * Inquiry.completedAt（询盘完成，之后整单只读）→ 积分 WON → award / result 邮件。
 * 先锁询价单：并发定标时第二次读到的已是评标完成，按 R12-8 返回 INQUIRY_COMPLETED_READONLY
 */
@Injectable()
export class RoundAwardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly inquiries: InquiriesService,
    private readonly roundState: RoundStateService,
    private readonly notices: InquiryNoticesService,
    private readonly contracts: ContractDraftFactory,
    private readonly points: PointsService,
    private readonly params: ParamsService,
    private readonly clock: ClockService,
  ) {}

  async award(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: AwardRoundInput,
  ): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.access.lockOrThrow(tx, user, inquiryId);
      const round = await tx.inquiryRound.findUnique({
        where: { inquiryId_roundNo: { inquiryId, roundNo } },
      });
      if (!round) throw new AppException('NOT_FOUND');
      // 有未发布的变更草稿时先发布或放弃变更（B-52）
      const draftRoundNo = await findDraftRoundNo(tx, inquiryId);
      if (draftRoundNo) throw new AppException('ROUND_DRAFT_EXISTS', { roundNo: draftRoundNo });
      // 功能权限已由守卫检查，这里不符合只可能是状态不对（03 §6）
      if (
        round.roundNo !== inquiry.currentRoundNo ||
        !computeInquiryActions(inquiry, user.permissions).includes('award')
      ) {
        throw new AppException(
          inquiry.docStatus === 'APPROVED' ? 'ROUND_INVALID_STATUS' : 'INQUIRY_INVALID_STATUS',
        );
      }
      const quotes = await tx.quote.findMany({
        where: { roundId: round.id },
        include: { supplier: true },
        orderBy: { supplier: { code: 'asc' } },
      });
      const winner = quotes.find((q) => q.id === input.quoteId);
      if (!winner || winner.status !== 'EVALUATING') throw new AppException('AWARD_INVALID_QUOTE');
      const losers = quotes.filter((q) => q.status === 'EVALUATING' && q.id !== winner.id);
      const now = this.clock.now();

      const contract = await this.contracts.create(tx, {
        inquiryId,
        roundId: round.id,
        quoteId: winner.id,
        actorId: user.id,
        now,
      });
      const closedNegotiations = await closeOpenNegotiations(
        tx,
        [round.id],
        NEGOTIATION_AUTO_CLOSE.award,
        user.id,
        now,
      );
      const won = await tx.quote.updateMany({
        where: { id: winner.id, status: 'EVALUATING' },
        data: { status: 'WON' },
      });
      if (won.count !== 1) throw new AppException('AWARD_INVALID_QUOTE');
      await tx.quote.updateMany({
        where: { id: { in: losers.map((q) => q.id) }, status: 'EVALUATING' },
        data: { status: 'LOST' },
      });
      const comment = input.comment ?? null;
      await this.roundState.apply(tx, round.id, 'award', {
        data: { evaluatedAt: now, awardedById: user.id, awardComment: comment },
        audit: {
          actor: user,
          summary: [inquiry.formalNo, winner.supplier.code, contract.contractNo].join(' · '),
          detail: {
            roundNo,
            quoteId: winner.id,
            supplierId: winner.supplierId,
            lostQuoteIds: losers.map((q) => q.id),
            closedNegotiations,
            contractId: contract.id,
            contractNo: contract.contractNo,
            ...(comment ? { comment } : {}),
          },
        },
      });
      await tx.inquiry.update({ where: { id: inquiryId }, data: { completedAt: now } });

      const rules = await this.params.get('points.rules');
      await this.points.award(tx, [
        {
          supplierId: winner.supplierId,
          ruleCode: 'WON',
          delta: rules.won,
          inquiryId,
          roundId: round.id,
          bizKey: `WON:${round.id}:${winner.supplierId}`,
        },
      ]);
      await this.notices.award(tx, inquiry, winner);
      if (await this.params.get('notify.sendResultToLosers')) await this.notices.result(tx, inquiry, losers);
    });
    return this.inquiries.detail(this.prisma, user, inquiryId);
  }
}
