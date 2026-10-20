import { Controller, Get, Global, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { EmailMessage, Prisma } from '@prisma/client';
import {
  emailListQuerySchema,
  type EmailDetailDto,
  type EmailListItemDto,
  type EmailListQuery,
  type Paginated,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { skipTake, toPaginated } from '../../common/pagination';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { inAppTz } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailOutboxJob } from './mail-outbox.job';
import { MailService, MailTransport } from './mail.service';

function toListItem(m: EmailMessage): EmailListItemDto {
  return {
    id: m.id,
    type: m.type,
    language: m.language,
    toAddresses: m.toAddresses,
    ccAddresses: m.ccAddresses,
    subject: m.subject,
    status: m.status,
    attempts: m.attempts,
    lastError: m.lastError,
    sentAt: m.sentAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    supplierId: m.supplierId,
    inquiryId: m.inquiryId,
  };
}

/** 日期区间（含当天，按 UTC+8 解释） */
export function dateRangeWhere(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: inAppTz(from).startOf('day').toDate() } : {}),
    ...(to ? { lt: inAppTz(to).add(1, 'day').startOf('day').toDate() } : {}),
  };
}

@Controller('system/emails')
export class EmailsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('system:email:view')
  @Get()
  async list(@Query(new ZodValidationPipe(emailListQuerySchema)) q: EmailListQuery): Promise<Paginated<EmailListItemDto>> {
    const keyword = q.keyword?.toLowerCase();
    const where: Prisma.EmailMessageWhereInput = {
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.language ? { language: q.language } : {}),
      ...(q.inquiryId ? { inquiryId: q.inquiryId } : {}),
      ...(dateRangeWhere(q.from, q.to) ? { createdAt: dateRangeWhere(q.from, q.to) } : {}),
      ...(keyword
        ? { OR: [{ subject: { contains: keyword, mode: 'insensitive' } }, { toAddresses: { has: keyword } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.emailMessage.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.emailMessage.count({ where }),
    ]);
    return toPaginated(rows.map(toListItem), total, q);
  }

  @RequirePermissions('system:email:view')
  @Get(':id')
  async detail(@Param('id') id: string): Promise<EmailDetailDto> {
    const m = await this.prisma.emailMessage.findUnique({ where: { id } });
    if (!m) throw new AppException('NOT_FOUND');
    return { ...toListItem(m), html: m.html, text: m.text };
  }

  /** 重发：状态改回待发送、尝试次数清零（R02-7） */
  @RequirePermissions('system:email:view')
  @Post(':id/resend')
  @HttpCode(200)
  async resend(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<EmailListItemDto> {
    const m = await this.prisma.emailMessage.findUnique({ where: { id } });
    if (!m) throw new AppException('NOT_FOUND');
    const updated = await this.prisma.emailMessage.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: this.clock.now() },
    });
    await this.audit.log({ actor: user, action: 'email.resend', entityType: 'email', entityId: id, summary: m.subject });
    return toListItem(updated);
  }
}

@Global()
@Module({
  controllers: [EmailsController],
  providers: [MailService, MailTransport, MailOutboxJob],
  exports: [MailService, MailTransport, MailOutboxJob],
})
export class MailModule {}
