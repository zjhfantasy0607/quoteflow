import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { APP_TZ } from '@quoteflow/shared';
import { ClockService } from '../../common/clock/clock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';

const DAY_MS = 24 * 3600_000;

/** 每天 03:00（UTC+8）清理过期会话、过期或已用的令牌、24 小时未被引用的上传文件 */
@Injectable()
export class CleanupJob {
  private readonly logger = new Logger(CleanupJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly clock: ClockService,
  ) {}

  @Cron('0 0 3 * * *', { name: 'cleanup', timeZone: APP_TZ })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.run();
      this.logger.log(`cleanup: ${JSON.stringify(result)}`);
    } catch (err) {
      this.logger.error(err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  async run(): Promise<{ sessions: number; tokens: number; files: number }> {
    const now = this.clock.now();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const sessions = await this.prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
    const tokens = await this.prisma.userToken.deleteMany({
      where: { OR: [{ expiresAt: { lte: weekAgo } }, { usedAt: { lte: weekAgo } }] },
    });
    const files = await this.files.cleanupOrphans(new Date(now.getTime() - DAY_MS));
    return { sessions: sessions.count, tokens: tokens.count, files };
  }
}

@Module({ providers: [CleanupJob], exports: [CleanupJob] })
export class JobsModule {}
