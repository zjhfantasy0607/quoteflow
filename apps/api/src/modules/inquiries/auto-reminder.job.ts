import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ClockService } from '../../common/clock/clock.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { ParamsService } from '../../infra/params/params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryNoticesService } from './inquiry-notices.service';

const HOUR_MS = 3600_000;

/** 等待报价、已进入"截止前 N 小时"、还没自动催过；已过截止的不再催（截止任务马上会关闭它） */
function dueWhere(now: Date, windowMs: number): Prisma.InquiryRoundWhereInput {
  return {
    status: 'WAITING_QUOTES',
    autoReminderSentAt: null,
    deadline: { gt: now, lte: new Date(now.getTime() + windowMs) },
  };
}

/**
 * R07-9 自动催报：每 10 分钟扫描 dueWhere 的轮次（N = reminder.autoHoursBeforeDeadline，0 表示关闭），
 * 给其中未响应（INVITED）的报价单各发一封 reminder，然后写 autoReminderSentAt。
 * 邀请时已经在催报窗口内的（截止前 N 小时内才发布或补充邀请）不催：邀请邮件里已经写明了截止时间（B-20）。
 * 延期会清空 autoReminderSentAt，所以 bizKey 带上截止时间，新的截止前还会再催一次
 */
@Injectable()
export class AutoReminderJob {
  private readonly logger = new Logger(AutoReminderJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly params: ParamsService,
    private readonly notices: InquiryNoticesService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  @Interval('autoReminder', 10 * 60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.run();
      if (result.rounds > 0) this.logger.log(`autoReminder: ${JSON.stringify(result)}`);
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  /** 测试里直接调用；返回处理的轮次数和发出的催报数 */
  async run(): Promise<{ rounds: number; reminders: number }> {
    const hours = await this.params.get('reminder.autoHoursBeforeDeadline');
    if (hours <= 0) return { rounds: 0, reminders: 0 };
    const now = this.clock.now();
    const windowMs = hours * HOUR_MS;
    const due = await this.prisma.inquiryRound.findMany({
      where: dueWhere(now, windowMs),
      select: { id: true },
      orderBy: { deadline: 'asc' },
    });
    let rounds = 0;
    let reminders = 0;
    for (const { id } of due) {
      const sent = await this.prisma.$transaction((tx) => this.remindRound(tx, id, now, windowMs));
      if (sent !== null) {
        rounds += 1;
        reminders += sent;
      }
    }
    return { rounds, reminders };
  }

  /** 返回发出的催报数；轮次已经不满足条件（被延期、截止、取消或并发处理过）时返回 null */
  private async remindRound(
    tx: Prisma.TransactionClient,
    roundId: string,
    now: Date,
    windowMs: number,
  ): Promise<number | null> {
    const { inquiryId } = await tx.inquiryRound.findUniqueOrThrow({
      where: { id: roundId },
      select: { inquiryId: true },
    });
    // 和延期、取消等动作串行（RoundStateService 同样先锁询价单）
    await tx.$queryRaw`SELECT 1 FROM "Inquiry" WHERE "id" = ${inquiryId} FOR UPDATE`;
    const claimed = await tx.inquiryRound.updateMany({
      where: { id: roundId, ...dueWhere(now, windowMs) },
      data: { autoReminderSentAt: now },
    });
    if (claimed.count !== 1) return null;
    const round = await tx.inquiryRound.findUniqueOrThrow({ where: { id: roundId } });
    const inquiry = await tx.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
    const deadline = round.deadline!;
    const quotes = await tx.quote.findMany({
      where: { roundId, status: 'INVITED', invitedAt: { lt: new Date(deadline.getTime() - windowMs) } },
      include: { supplier: true },
      orderBy: { supplier: { code: 'asc' } },
    });
    if (quotes.length === 0) return 0;
    await this.notices.reminder(
      tx,
      inquiry,
      quotes,
      { deadline },
      (q) => `REMINDER:AUTO:${roundId}:${q.supplier.id}:${deadline.getTime()}`,
    );
    await this.audit.log(
      {
        actor: null,
        action: 'inquiry.autoRemind',
        entityType: 'inquiry',
        entityId: inquiryId,
        summary: `${inquiry.formalNo} · ${quotes.map((q) => q.supplier.code).join(', ')}`,
        detail: { roundNo: round.roundNo, quoteIds: quotes.map((q) => q.id) },
      },
      tx,
    );
    return quotes.length;
  }
}
