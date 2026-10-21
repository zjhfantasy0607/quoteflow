import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { auditListQuerySchema, type AuditListQuery, type AuditLogDto, type Paginated, type UserType } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { RequirePermissions } from '../../common/auth/decorators';
import { skipTake, toPaginated } from '../../common/pagination';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { inAppTz } from '../../common/time';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  /** 操作人；系统任务传 null */
  actor: Pick<AuthUser, 'id' | 'userType' | 'ip'> | null;
  /** 形如 inquiry.approve / role.update */
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  /** 不得包含开标前的报价金额（I-11） */
  detail?: Prisma.InputJsonValue;
  /** 未登录场景（如登录失败）单独传 IP */
  ip?: string | null;
  actorType?: UserType | null;
}

type Client = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, client: Client = this.prisma): Promise<void> {
    await client.auditLog.create({
      data: {
        actorId: entry.actor?.id ?? null,
        actorType: entry.actor?.userType ?? entry.actorType ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary?.slice(0, 500) ?? null,
        detail: entry.detail ?? Prisma.JsonNull,
        ip: entry.actor?.ip ?? entry.ip ?? null,
      },
    });
  }

  async list(q: AuditListQuery): Promise<Paginated<AuditLogDto>> {
    const createdAt: Prisma.DateTimeFilter | undefined =
      q.from || q.to
        ? {
            ...(q.from ? { gte: inAppTz(q.from).startOf('day').toDate() } : {}),
            ...(q.to ? { lt: inAppTz(q.to).add(1, 'day').startOf('day').toDate() } : {}),
          }
        : undefined;
    const where: Prisma.AuditLogWhereInput = {
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPaginated(
      rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        actorType: r.actorType,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        summary: r.summary,
        detail: r.detail,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      q,
    );
  }
}

@Controller('system/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermissions('system:audit:view')
  @Get()
  list(@Query(new ZodValidationPipe(auditListQuerySchema)) q: AuditListQuery): Promise<Paginated<AuditLogDto>> {
    return this.audit.list(q);
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
