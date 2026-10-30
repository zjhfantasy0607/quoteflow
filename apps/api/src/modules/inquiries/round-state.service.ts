import { Injectable } from '@nestjs/common';
import { ROUND_TRANSITIONS, type RoundEvent } from '@quoteflow/shared';
import { AppException } from '../../common/errors/app.exception';
import type { InquiryRound, Prisma } from '../../generated/prisma/client';
import { AuditService, type AuditEntry } from '../../infra/audit/audit.service';

export interface RoundTransitionOptions {
  /** 同时写入轮次的其他字段（不含 status） */
  data?: Omit<Prisma.InquiryRoundUpdateManyMutationInput, 'status'>;
  /** 额外的条件（如截止任务的"现在 ≥ 截止"），不满足同样抛 ROUND_INVALID_STATUS */
  where?: Prisma.InquiryRoundWhereInput;
  /**
   * 记一条 inquiry.<事件> 审计（entityType = inquiry）。作为别的动作一部分的迁移
   * （如询价单取消时轮次一起取消）不传，由调用方记自己的审计
   */
  audit?: { actor: AuditEntry['actor']; summary?: string; detail?: Prisma.InputJsonValue };
}

/**
 * 轮次状态的唯一修改入口（02 I-2、05 §3、R07-12）：按 shared 的 ROUND_TRANSITIONS 校验来源状态并做条件更新
 * （防并发），在同一事务里同步 Inquiry.currentRoundStatus / currentDeadline。
 * 迁移前先给询价单加行锁：所有改轮次状态的事务（包括 M10 的截止任务）都在询价单这一行上串行，
 * 补充邀请、催报等"状态不变"的动作先锁询价单再读轮次，读到的状态就是可靠的。
 */
@Injectable()
export class RoundStateService {
  constructor(private readonly audit: AuditService) {}

  async apply(
    tx: Prisma.TransactionClient,
    roundId: string,
    event: RoundEvent,
    options: RoundTransitionOptions = {},
  ): Promise<InquiryRound> {
    const { from, to } = ROUND_TRANSITIONS[event];
    const target = await tx.inquiryRound.findUnique({ where: { id: roundId }, select: { inquiryId: true } });
    if (!target) throw new AppException('NOT_FOUND');
    // 调用方通常已经锁过（InquiryAccessService.lockOrThrow），同一事务里重复加锁不会阻塞
    await tx.$queryRaw`SELECT 1 FROM "Inquiry" WHERE "id" = ${target.inquiryId} FOR UPDATE`;
    const res = await tx.inquiryRound.updateMany({
      where: { AND: [options.where ?? {}, { id: roundId, status: { in: [...from] } }] },
      data: { ...options.data, status: to },
    });
    if (res.count !== 1) throw new AppException('ROUND_INVALID_STATUS');
    const round = await tx.inquiryRound.findUniqueOrThrow({ where: { id: roundId } });
    await tx.inquiry.updateMany({
      where: { id: round.inquiryId, currentRoundNo: round.roundNo },
      data: { currentRoundStatus: round.status, currentDeadline: round.deadline },
    });
    if (options.audit) {
      await this.audit.log(
        {
          actor: options.audit.actor,
          action: `inquiry.${event}`,
          entityType: 'inquiry',
          entityId: round.inquiryId,
          summary: options.audit.summary,
          detail: options.audit.detail,
        },
        tx,
      );
    }
    return round;
  }
}
