import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { formatAppTime } from '../../common/time';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RoundStateService } from './round-state.service';

/**
 * R10-1 截止任务：每分钟把"等待报价且现在 ≥ 截止"的轮次改为报价完成（quotesClosedAt = 现在）。
 * 经 RoundStateService 条件更新：同一轮被并发处理、刚被延期、提前截止或取消时迁移不成立，跳过即可，重复执行无副作用。
 * 供应商能不能提交只看截止时间（R09-1），不依赖这个任务及时执行
 */
@Injectable()
export class RoundDeadlineJob {
  private readonly logger = new Logger(RoundDeadlineJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly roundState: RoundStateService,
    private readonly clock: ClockService,
  ) {}

  @Interval('roundDeadline', 60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.run();
      if (result.closed > 0) this.logger.log(`roundDeadline: ${JSON.stringify(result)}`);
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  /** 测试里直接调用；返回关闭的轮次数 */
  async run(): Promise<{ closed: number }> {
    const now = this.clock.now();
    const due = await this.prisma.inquiryRound.findMany({
      where: { status: 'WAITING_QUOTES', deadline: { lte: now } },
      select: { id: true },
      orderBy: { deadline: 'asc' },
    });
    let closed = 0;
    for (const { id } of due) {
      try {
        await this.prisma.$transaction((tx) => this.close(tx, id, now));
        closed += 1;
      } catch (err) {
        if (err instanceof AppException && err.code === 'ROUND_INVALID_STATUS') continue;
        // 一轮出错不影响其他轮次，下一分钟再试
        this.logger.error(`roundDeadline ${id}: ${err instanceof Error ? err.stack : String(err)}`);
      }
    }
    return { closed };
  }

  private async close(tx: Prisma.TransactionClient, roundId: string, now: Date): Promise<void> {
    const { roundNo, deadline, inquiry } = await tx.inquiryRound.findUniqueOrThrow({
      where: { id: roundId },
      select: { roundNo: true, deadline: true, inquiry: { select: { formalNo: true } } },
    });
    await this.roundState.apply(tx, roundId, 'close', {
      where: { deadline: { lte: now } },
      data: { quotesClosedAt: now },
      audit: {
        actor: null,
        summary: `${inquiry.formalNo} · ${formatAppTime(deadline!)}`,
        detail: { roundNo, deadline: deadline!.toISOString() },
      },
    });
  }
}
