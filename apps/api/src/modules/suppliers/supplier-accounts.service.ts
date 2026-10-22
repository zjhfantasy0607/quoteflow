import { Injectable } from '@nestjs/common';
import type {
  CreateSupplierAccountInput,
  Locale,
  SupplierAccountDto,
  UserStatusInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { SessionService } from '../../common/auth/session.service';
import { UserTokenService } from '../../common/auth/user-token.service';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { AppConfig } from '../../config/app-config';
import { Prisma, type Supplier, type User } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { MailService, supplierMailLanguage } from '../../infra/mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

type Client = PrismaService | Prisma.TransactionClient;

/** 激活链接 7 天有效（R04-10） */
export const ACTIVATION_TTL_HOURS = 7 * 24;

const accountInclude = {
  // 最近一次发出、还没用过的激活令牌（待激活时显示链接有效期）
  tokens: {
    where: { purpose: 'ACTIVATE', usedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { expiresAt: true },
  },
} satisfies Prisma.UserInclude;
type AccountRow = Prisma.UserGetPayload<{ include: typeof accountInclude }>;

function toAccountDto(u: AccountRow): SupplierAccountDto {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    status: u.status,
    locale: u.locale as Locale,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    activationExpiresAt:
      u.status === 'PENDING_ACTIVATION' && u.tokens[0] ? u.tokens[0].expiresAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

/** 供应商门户账号：开通、重发激活邮件、启停用（R04-10）。激活本身在 AuthService.activate */
@Injectable()
export class SupplierAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserTokenService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly fieldMask: FieldMaskService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async list(actor: AuthUser, supplierId: string): Promise<SupplierAccountDto[]> {
    await this.findSupplier(supplierId);
    const users = await this.prisma.user.findMany({
      where: { supplierId, userType: 'SUPPLIER' },
      include: accountInclude,
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.toDto(actor, u));
  }

  /**
   * R04-10：邮箱在全部用户中唯一，供应商必须启用；建待激活的供应商用户（角色 SUPPLIER），
   * 发激活邮件（语言按供应商首选语言）
   */
  async create(
    actor: AuthUser,
    supplierId: string,
    input: CreateSupplierAccountInput,
  ): Promise<SupplierAccountDto> {
    const supplier = await this.findSupplier(supplierId);
    if (supplier.status !== 'ENABLED') throw new AppException('SUPPLIER_DISABLED');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: 'SUPPLIER' } });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const exists = await tx.user.findFirst({
          where: { OR: [{ username: input.email }, { email: input.email }] },
          select: { id: true },
        });
        if (exists) throw new AppException('SUPPLIER_ACCOUNT_EXISTS');
        const user = await tx.user.create({
          data: {
            username: input.email,
            email: input.email,
            name: input.name,
            userType: 'SUPPLIER',
            status: 'PENDING_ACTIVATION',
            locale: supplier.preferredLanguage === 'en-US' ? 'en-US' : 'zh-CN',
            supplierId,
            roles: { create: [{ roleId: role.id }] },
          },
        });
        await this.sendActivation(tx, supplier, user);
        await this.audit.log(
          {
            actor,
            action: 'supplierAccount.create',
            entityType: 'user',
            entityId: user.id,
            summary: `${supplier.code} ${user.name}`,
          },
          tx,
        );
        return this.dtoById(tx, actor, user.id);
      });
    } catch (e) {
      // 检查之后被并发占用：唯一约束兜底
      if (isUniqueViolation(e, 'username') || isUniqueViolation(e, 'email')) {
        throw new AppException('SUPPLIER_ACCOUNT_EXISTS');
      }
      throw e;
    }
  }

  /** 只有待激活的账号能重发；新链接生效、旧链接作废 */
  async resendActivation(actor: AuthUser, supplierId: string, userId: string): Promise<SupplierAccountDto> {
    const supplier = await this.findSupplier(supplierId);
    const user = await this.findAccount(supplierId, userId);
    if (supplier.status !== 'ENABLED') throw new AppException('SUPPLIER_DISABLED');
    if (user.status !== 'PENDING_ACTIVATION') throw new AppException('SUPPLIER_ACCOUNT_NOT_PENDING');
    return this.prisma.$transaction(async (tx) => {
      await this.sendActivation(tx, supplier, user);
      await this.audit.log(
        {
          actor,
          action: 'supplierAccount.resendActivation',
          entityType: 'user',
          entityId: user.id,
          summary: `${supplier.code} ${user.name}`,
        },
        tx,
      );
      return this.dtoById(tx, actor, user.id);
    });
  }

  /** 停用：删除会话、不能登录；启用：设置过密码的恢复为启用，还没激活过的回到待激活 */
  async setStatus(
    actor: AuthUser,
    supplierId: string,
    userId: string,
    input: UserStatusInput,
  ): Promise<SupplierAccountDto> {
    const supplier = await this.findSupplier(supplierId);
    const user = await this.findAccount(supplierId, userId);
    const status =
      input.status === 'DISABLED' ? 'DISABLED' : user.passwordHash ? 'ACTIVE' : 'PENDING_ACTIVATION';
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status } });
      if (status === 'DISABLED') await this.sessions.revokeAllForUser(userId, { client: tx });
      await this.audit.log(
        {
          actor,
          action: status === 'DISABLED' ? 'supplierAccount.disable' : 'supplierAccount.enable',
          entityType: 'user',
          entityId: userId,
          summary: `${supplier.code} ${user.name}`,
        },
        tx,
      );
      return this.dtoById(tx, actor, userId);
    });
  }

  /** 签发激活令牌（旧令牌作废）并把激活邮件写入发件箱 */
  private async sendActivation(tx: Prisma.TransactionClient, supplier: Supplier, user: User): Promise<void> {
    const { token, expiresAt } = await this.tokens.issue(user.id, 'ACTIVATE', ACTIVATION_TTL_HOURS, tx);
    const language = supplierMailLanguage(supplier);
    // 激活页按邮件语言打开；双语邮件不指定，按浏览器语言
    const lang = language === 'bilingual' ? '' : `&lang=${language}`;
    await this.mail.enqueue(tx, {
      templateKey: 'account.activate',
      language,
      to: [user.email ?? user.username],
      data: {
        name: user.name,
        supplier: { nameZh: supplier.nameZh, nameEn: supplier.nameEn },
        username: user.username,
        link: `${this.config.get('APP_BASE_URL')}/activate?token=${encodeURIComponent(token)}${lang}`,
        expiresAt,
      },
      userId: user.id,
      supplierId: supplier.id,
    });
  }

  /** 登录账号就是邮箱，按 supplier.contact 脱敏（与联系邮箱一致，见待确认事项 B-05） */
  private toDto(actor: AuthUser, row: AccountRow): SupplierAccountDto {
    return this.fieldMask.mask(toAccountDto(row), actor, 'supplier.contact', ['username', 'email']);
  }

  private async dtoById(client: Client, actor: AuthUser, userId: string): Promise<SupplierAccountDto> {
    return this.toDto(
      actor,
      await client.user.findUniqueOrThrow({ where: { id: userId }, include: accountInclude }),
    );
  }

  private async findSupplier(id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new AppException('NOT_FOUND');
    return supplier;
  }

  private async findAccount(supplierId: string, userId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, supplierId, userType: 'SUPPLIER' },
    });
    if (!user) throw new AppException('NOT_FOUND');
    return user;
  }
}
