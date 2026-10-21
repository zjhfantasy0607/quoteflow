import { Injectable } from '@nestjs/common';
import {
  isStrongPassword,
  type CreateUserInput,
  type Locale,
  type Paginated,
  type ResetPasswordInput,
  type UpdateUserInput,
  type UserDto,
  type UserListQuery,
  type UserStatusInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { hashPassword } from '../../common/auth/password';
import { SessionService } from '../../common/auth/session.service';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { skipTake, toPaginated } from '../../common/pagination';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DictsService } from '../dicts/dicts.service';

const userInclude = { roles: { include: { role: true } } } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    phone: u.phone,
    departmentCode: u.departmentCode,
    locale: u.locale as Locale,
    status: u.status,
    roles: u.roles.map(({ role }) => ({ id: role.id, code: role.code, nameZh: role.nameZh, nameEn: role.nameEn })),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    remark: u.remark,
    createdAt: u.createdAt.toISOString(),
  };
}

/** 内部用户管理（供应商账号在 M04 的供应商模块里维护） */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly dicts: DictsService,
    private readonly audit: AuditService,
  ) {}

  async list(query: UserListQuery): Promise<Paginated<UserDto>> {
    const where: Prisma.UserWhereInput = {
      userType: 'INTERNAL',
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleId ? { roles: { some: { roleId: query.roleId } } } : {}),
      ...(query.keyword
        ? {
            OR: [
              { username: { contains: query.keyword, mode: 'insensitive' } },
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { email: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: userInclude, orderBy: { createdAt: 'asc' }, ...skipTake(query) }),
      this.prisma.user.count({ where }),
    ]);
    return toPaginated(items.map(toUserDto), total, query);
  }

  async get(id: string): Promise<UserDto> {
    return toUserDto(await this.findInternal(id));
  }

  async create(actor: AuthUser, input: CreateUserInput): Promise<UserDto> {
    if (!isStrongPassword(input.password)) throw new AppException('AUTH_PASSWORD_WEAK');
    await this.validate(input);
    const username = input.username.toLowerCase();
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            username,
            passwordHash,
            name: input.name,
            email: input.email?.toLowerCase() ?? null,
            phone: input.phone ?? null,
            departmentCode: input.departmentCode ?? null,
            locale: input.locale,
            remark: input.remark ?? null,
            userType: 'INTERNAL',
            status: 'ACTIVE',
            roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
          },
          include: userInclude,
        });
        await this.audit.log(
          {
            actor,
            action: 'user.create',
            entityType: 'user',
            entityId: created.id,
            summary: username,
            detail: { roles: created.roles.map((r) => r.role.code) },
          },
          tx,
        );
        return created;
      });
      return toUserDto(user);
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput): Promise<UserDto> {
    const before = await this.findInternal(id);
    await this.validate(input);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId: id } });
        const updated = await tx.user.update({
          where: { id },
          data: {
            name: input.name,
            email: input.email?.toLowerCase() ?? null,
            phone: input.phone ?? null,
            departmentCode: input.departmentCode ?? null,
            locale: input.locale,
            remark: input.remark ?? null,
            roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
          },
          include: userInclude,
        });
        await this.audit.log(
          {
            actor,
            action: 'user.update',
            entityType: 'user',
            entityId: id,
            summary: before.username,
            detail: {
              rolesBefore: before.roles.map((r) => r.role.code),
              rolesAfter: updated.roles.map((r) => r.role.code),
            },
          },
          tx,
        );
        return updated;
      });
      return toUserDto(user);
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async setStatus(actor: AuthUser, id: string, input: UserStatusInput): Promise<UserDto> {
    if (id === actor.id) {
      throw new AppException('FORBIDDEN', undefined, undefined, 'You cannot change your own status');
    }
    const before = await this.findInternal(id);
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { status: input.status }, include: userInclude });
      if (input.status === 'DISABLED') await this.sessions.revokeAllForUser(id, { client: tx });
      await this.audit.log(
        {
          actor,
          action: input.status === 'DISABLED' ? 'user.disable' : 'user.enable',
          entityType: 'user',
          entityId: id,
          summary: before.username,
        },
        tx,
      );
      return updated;
    });
    return toUserDto(user);
  }

  async resetPassword(actor: AuthUser, id: string, input: ResetPasswordInput): Promise<void> {
    if (!isStrongPassword(input.newPassword)) throw new AppException('AUTH_PASSWORD_WEAK');
    const before = await this.findInternal(id);
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await this.sessions.revokeAllForUser(id, { client: tx });
      await this.audit.log(
        { actor, action: 'user.resetPassword', entityType: 'user', entityId: id, summary: before.username },
        tx,
      );
    });
  }

  private async findInternal(id: string): Promise<UserRow> {
    const user = await this.prisma.user.findFirst({ where: { id, userType: 'INTERNAL' }, include: userInclude });
    if (!user) throw new AppException('NOT_FOUND');
    return user;
  }

  /** 部门字典有效、角色存在且都是内部角色 */
  private async validate(input: { departmentCode?: string; roleIds: string[] }): Promise<void> {
    await this.dicts.assertEnabled('department', input.departmentCode);
    const roles = await this.prisma.role.findMany({ where: { id: { in: input.roleIds } } });
    if (roles.length !== new Set(input.roleIds).size || roles.some((r) => r.forSupplier)) {
      throw new AppException('VALIDATION_FAILED', undefined, [
        { path: 'roleIds', code: 'invalid_role', message: 'Unknown role or supplier role' },
      ]);
    }
  }

  private mapUnique(e: unknown): unknown {
    if (isUniqueViolation(e, 'username')) return new AppException('USER_USERNAME_TAKEN');
    if (isUniqueViolation(e, 'email')) return new AppException('USER_EMAIL_TAKEN');
    return e;
  }
}
