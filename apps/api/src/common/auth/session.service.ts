import { Injectable } from '@nestjs/common';
import { DATA_SCOPE_RANK, type DataScope, type Locale } from '@quoteflow/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';
import { AppConfig } from '../../config/app-config';
import { Prisma } from '../../generated/prisma/client';
import { ParamsService } from '../../infra/params/params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import type { AuthUser, RequestMeta } from './auth-user';

/** 续期最小间隔：距上次续期超过 5 分钟才写库 */
const RENEW_INTERVAL_MS = 5 * 60_000;

export const userWithRolesInclude = {
  roles: { include: { role: true } },
  supplier: { select: { id: true, code: true, nameZh: true, nameEn: true, status: true } },
} satisfies Prisma.UserInclude;

export type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRolesInclude }>;

const sessionInclude = { user: { include: userWithRolesInclude } } satisfies Prisma.SessionInclude;
export type SessionWithUser = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 用户是否可以继续使用系统（停用、未激活、所属供应商停用都不行） */
export function isUserUsable(user: UserWithRoles): boolean {
  if (user.status !== 'ACTIVE') return false;
  if (user.userType === 'SUPPLIER' && user.supplier?.status !== 'ENABLED') return false;
  return true;
}

export function buildAuthUser(user: UserWithRoles, sessionId: string, meta: RequestMeta): AuthUser {
  const roles = user.roles.map((r) => r.role);
  const usableRoles = user.userType === 'SUPPLIER' ? roles : roles.filter((r) => !r.forSupplier);
  let dataScope: DataScope = 'SELF';
  for (const r of usableRoles) {
    if (DATA_SCOPE_RANK[r.dataScope] > DATA_SCOPE_RANK[dataScope]) dataScope = r.dataScope;
  }
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    userType: user.userType,
    locale: user.locale as Locale,
    supplierId: user.supplierId,
    departmentCode: user.departmentCode,
    roleCodes: roles.map((r) => r.code),
    permissions: new Set(usableRoles.flatMap((r) => r.permissions)),
    fieldPermissions: new Set(usableRoles.flatMap((r) => r.fieldPermissions)),
    dataScope,
    sessionId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly params: ParamsService,
    private readonly config: AppConfig,
  ) {}

  get cookieName(): string {
    return this.config.get('SESSION_COOKIE_NAME');
  }

  cookieOptions(expiresAt: Date): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE'),
      path: '/',
      expires: expiresAt,
    };
  }

  async create(userId: string, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    const expiresAt = await this.expiryFrom(now);
    await this.prisma.session.create({
      data: { id: hashToken(token), userId, expiresAt, lastSeenAt: now, ip: meta.ip, userAgent: meta.userAgent },
    });
    return { token, expiresAt };
  }

  /** 按 cookie 中的 token 取会话；不存在或已过期返回 null（过期的顺手删掉） */
  async resolve(token: string): Promise<SessionWithUser | null> {
    const session = await this.prisma.session.findUnique({ where: { id: hashToken(token) }, include: sessionInclude });
    if (!session) return null;
    if (session.expiresAt.getTime() <= this.clock.now().getTime()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    return session;
  }

  /** 滑动续期；续期了就返回新的过期时间（调用方据此刷新 cookie） */
  async renewIfNeeded(session: SessionWithUser): Promise<Date | null> {
    const now = this.clock.now();
    if (now.getTime() - session.lastSeenAt.getTime() < RENEW_INTERVAL_MS) return null;
    const expiresAt = await this.expiryFrom(now);
    await this.prisma.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt } });
    return expiresAt;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeAllForUser(
    userId: string,
    options: { exceptSessionId?: string; client?: Prisma.TransactionClient } = {},
  ): Promise<void> {
    const client = options.client ?? this.prisma;
    await client.session.deleteMany({
      where: { userId, ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}) },
    });
  }

  /** 供应商停用时删除其全部门户用户的会话（R04-6、P-6） */
  async revokeAllForSuppliers(supplierIds: string[], client: Prisma.TransactionClient = this.prisma): Promise<void> {
    if (supplierIds.length === 0) return;
    await client.session.deleteMany({ where: { user: { supplierId: { in: supplierIds } } } });
  }

  private async expiryFrom(now: Date): Promise<Date> {
    const hours = await this.params.get('security.sessionHours');
    return new Date(now.getTime() + hours * 3600_000);
  }
}
