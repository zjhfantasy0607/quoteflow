import { Injectable } from '@nestjs/common';
import {
  isStrongPassword,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type Locale,
  type LoginInput,
  type MeDto,
  type ResetPasswordWithTokenInput,
} from '@quoteflow/shared';
import type { AuthUser, RequestMeta } from '../../common/auth/auth-user';
import { LoginRateLimiter } from '../../common/auth/login-rate-limiter';
import { hashPassword, verifyPassword } from '../../common/auth/password';
import {
  buildAuthUser,
  SessionService,
  userWithRolesInclude,
  type UserWithRoles,
} from '../../common/auth/session.service';
import { UserTokenService } from '../../common/auth/user-token.service';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { AppConfig } from '../../config/app-config';
import { AuditService } from '../../infra/audit/audit.service';
import { MailService, supplierMailLanguage, userMailLanguage } from '../../infra/mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

export function toMeDto(user: UserWithRoles): MeDto {
  const auth = buildAuthUser(user, '', { ip: null, userAgent: null });
  return {
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      userType: user.userType,
      locale: user.locale as Locale,
      departmentCode: user.departmentCode,
      supplier: user.supplier
        ? { id: user.supplier.id, code: user.supplier.code, nameZh: user.supplier.nameZh, nameEn: user.supplier.nameEn }
        : null,
    },
    roles: user.roles.map(({ role }) => ({ id: role.id, code: role.code, nameZh: role.nameZh, nameEn: role.nameEn })),
    permissions: [...auth.permissions].sort(),
    fieldPermissions: [...auth.fieldPermissions].sort(),
    dataScope: auth.dataScope,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly limiter: LoginRateLimiter,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly tokens: UserTokenService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<{ token: string; expiresAt: Date; me: MeDto }> {
    this.limiter.hit(meta.ip);
    const username = input.username.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { username }, include: userWithRolesInclude });

    if (!(await verifyPassword(input.password, user?.passwordHash))) {
      await this.audit.log({
        actor: null,
        action: 'auth.loginFailed',
        entityType: 'user',
        entityId: user?.id,
        summary: username,
        ip: meta.ip,
      });
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }
    // 走到这里 user 一定存在（verifyPassword 对空 hash 返回 false）
    const u = user!;
    if (u.status === 'DISABLED') throw new AppException('AUTH_ACCOUNT_DISABLED');
    if (u.status === 'PENDING_ACTIVATION') throw new AppException('AUTH_ACCOUNT_NOT_ACTIVATED');
    if (u.userType === 'SUPPLIER' && u.supplier?.status !== 'ENABLED') {
      throw new AppException('AUTH_ACCOUNT_DISABLED');
    }

    const { token, expiresAt } = await this.sessions.create(u.id, meta);
    await this.prisma.user.update({ where: { id: u.id }, data: { lastLoginAt: this.clock.now() } });
    await this.audit.log({
      actor: { id: u.id, userType: u.userType, ip: meta.ip },
      action: 'auth.login',
      entityType: 'user',
      entityId: u.id,
    });
    return { token, expiresAt, me: toMeDto(u) };
  }

  async logout(user: AuthUser): Promise<void> {
    await this.sessions.revoke(user.sessionId);
    await this.audit.log({ actor: user, action: 'auth.logout', entityType: 'user', entityId: user.id });
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userWithRolesInclude });
    return toMeDto(user);
  }

  async updateLocale(user: AuthUser, locale: Locale): Promise<MeDto> {
    await this.prisma.user.update({ where: { id: user.id }, data: { locale } });
    return this.me(user.id);
  }

  async changePassword(user: AuthUser, input: ChangePasswordInput): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(input.oldPassword, row.passwordHash))) {
      throw new AppException('AUTH_OLD_PASSWORD_WRONG');
    }
    if (!isStrongPassword(input.newPassword)) throw new AppException('AUTH_PASSWORD_WEAK');
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.sessions.revokeAllForUser(user.id, { exceptSessionId: user.sessionId, client: tx });
      await this.audit.log({ actor: user, action: 'auth.changePassword', entityType: 'user', entityId: user.id }, tx);
    });
  }

  /** 找回密码：无论邮箱是否存在都返回成功，不泄露账号是否存在（R02-11） */
  async forgotPassword(input: ForgotPasswordInput, meta: RequestMeta): Promise<void> {
    this.limiter.hit(meta.ip);
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username: email }] },
      include: { supplier: { select: { status: true, preferredLanguage: true } } },
    });
    if (!user || user.status !== 'ACTIVE') return;
    if (user.userType === 'SUPPLIER' && user.supplier?.status !== 'ENABLED') return;
    const to = user.email ?? (user.username.includes('@') ? user.username : null);
    if (!to) return;

    await this.prisma.$transaction(async (tx) => {
      const { token, expiresAt } = await this.tokens.issue(user.id, 'RESET_PASSWORD', 1, tx);
      await this.mail.enqueue(tx, {
        templateKey: 'account.resetPassword',
        language: user.supplier ? supplierMailLanguage(user.supplier) : userMailLanguage(user),
        to: [to],
        data: {
          name: user.name,
          link: `${this.config.get('APP_BASE_URL')}/reset-password?token=${encodeURIComponent(token)}`,
          expiresAt,
        },
        userId: user.id,
        supplierId: user.supplierId,
      });
      await this.audit.log(
        { actor: null, action: 'auth.forgotPassword', entityType: 'user', entityId: user.id, ip: meta.ip },
        tx,
      );
    });
  }

  /** 用一次性令牌重置密码：成功后注销该用户全部会话 */
  async resetPassword(input: ResetPasswordWithTokenInput): Promise<void> {
    if (!isStrongPassword(input.newPassword)) throw new AppException('AUTH_PASSWORD_WEAK');
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      const userId = await this.tokens.consume(input.token, 'RESET_PASSWORD', tx);
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.sessions.revokeAllForUser(userId, { client: tx });
      await this.audit.log({ actor: null, action: 'auth.resetPassword', entityType: 'user', entityId: userId }, tx);
    });
  }
}
