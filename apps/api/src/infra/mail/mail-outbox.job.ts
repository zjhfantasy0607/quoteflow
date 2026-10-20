import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ClockService } from '../../common/clock/clock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailTransport } from './mail.service';

/** 第 n 次失败后等待的分钟数；第 5 次失败标记 FAILED（R02-7） */
export const RETRY_DELAYS_MINUTES = [1, 5, 15, 60];
export const MAX_ATTEMPTS = 5;
const BATCH = 20;

@Injectable()
export class MailOutboxJob {
  private readonly logger = new Logger(MailOutboxJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MailTransport,
    private readonly clock: ClockService,
  ) {}

  @Interval('mailOutbox', 30_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  /** 发送到期的待发邮件（测试里直接调用） */
  async run(): Promise<{ sent: number; failed: number }> {
    const now = this.clock.now();
    const due = await this.prisma.emailMessage.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    let sent = 0;
    let failed = 0;
    for (const message of due) {
      try {
        await this.transport.send(message);
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: { status: 'SENT', sentAt: this.clock.now(), attempts: { increment: 1 }, lastError: null },
        });
        sent += 1;
      } catch (err) {
        const attempts = message.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        const delay = RETRY_DELAYS_MINUTES[Math.min(attempts, RETRY_DELAYS_MINUTES.length) - 1];
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            attempts,
            lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
            status: giveUp ? 'FAILED' : 'PENDING',
            nextAttemptAt: giveUp ? message.nextAttemptAt : new Date(now.getTime() + delay * 60_000),
          },
        });
        failed += 1;
      }
    }
    return { sent, failed };
  }
}
