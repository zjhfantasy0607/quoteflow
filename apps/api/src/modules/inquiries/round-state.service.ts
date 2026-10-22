import { Injectable } from '@nestjs/common';
import type { RoundStatus } from '@quoteflow/shared';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';

/**
 * 轮次状态的唯一修改入口（02 I-2、05 §3）。M06 只用到"发布前取消"，
 * 发布、截止、开标、定标等迁移由 M07 起在这里补充。
 */
@Injectable()
export class RoundStateService {
  /**
   * 按来源状态做条件更新（防并发），不符合时抛 ROUND_INVALID_STATUS；
   * 迁移的是当前轮次时，在同一事务里同步 Inquiry.currentRoundStatus / currentDeadline。
   */
  async transition(
    tx: Prisma.TransactionClient,
    roundId: string,
    from: RoundStatus[],
    to: RoundStatus,
    data: Omit<Prisma.InquiryRoundUpdateManyMutationInput, 'status'> = {},
  ): Promise<void> {
    const res = await tx.inquiryRound.updateMany({
      where: { id: roundId, status: { in: from } },
      data: { ...data, status: to },
    });
    if (res.count !== 1) throw new AppException('ROUND_INVALID_STATUS');
    const round = await tx.inquiryRound.findUniqueOrThrow({
      where: { id: roundId },
      select: { inquiryId: true, roundNo: true, status: true, deadline: true },
    });
    await tx.inquiry.updateMany({
      where: { id: round.inquiryId, currentRoundNo: round.roundNo },
      data: { currentRoundStatus: round.status, currentDeadline: round.deadline },
    });
  }
}
