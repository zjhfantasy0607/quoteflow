import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isFieldPermissionCode,
  isPermissionCode,
  SUPPLIER_ROLE_CODE,
  type CreateRoleInput,
  type RoleDto,
  type UpdateRoleInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

const roleInclude = { _count: { select: { users: true } } } satisfies Prisma.RoleInclude;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function toRoleDto(r: RoleRow): RoleDto {
  return {
    id: r.id,
    code: r.code,
    nameZh: r.nameZh,
    nameEn: r.nameEn,
    description: r.description,
    isPreset: r.isPreset,
    forSupplier: r.forSupplier,
    dataScope: r.dataScope,
    permissions: [...r.permissions].sort(),
    fieldPermissions: [...r.fieldPermissions].sort(),
    userCount: r._count.users,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function diff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  return {
    added: after.filter((p) => !before.includes(p)),
    removed: before.filter((p) => !after.includes(p)),
  };
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({
      include: roleInclude,
      orderBy: [{ isPreset: 'desc' }, { createdAt: 'asc' }],
    });
    return roles.map(toRoleDto);
  }

  async get(id: string): Promise<RoleDto> {
    return toRoleDto(await this.find(id));
  }

  async create(actor: AuthUser, input: CreateRoleInput): Promise<RoleDto> {
    const { permissions, fieldPermissions } = this.normalize(input);
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.role.create({
          data: {
            code: input.code,
            nameZh: input.nameZh,
            nameEn: input.nameEn,
            description: input.description ?? null,
            dataScope: input.dataScope,
            permissions,
            fieldPermissions,
          },
          include: roleInclude,
        });
        await this.audit.log(
          {
            actor,
            action: 'role.create',
            entityType: 'role',
            entityId: created.id,
            summary: created.code,
            detail: { permissions, fieldPermissions, dataScope: input.dataScope },
          },
          tx,
        );
        return created;
      });
      return toRoleDto(role);
    } catch (e) {
      if (isUniqueViolation(e, 'code')) throw new AppException('ROLE_CODE_TAKEN');
      throw e;
    }
  }

  async update(actor: AuthUser, id: string, input: UpdateRoleInput): Promise<RoleDto> {
    const before = await this.find(id);
    const { permissions, fieldPermissions } = this.normalize(input);
    // 供应商角色的权限固定为空（门户接口按用户类型放行）
    if (before.code === SUPPLIER_ROLE_CODE && (permissions.length > 0 || fieldPermissions.length > 0)) {
      throw new AppException('ROLE_PRESET_IMMUTABLE');
    }
    const role = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({
        where: { id },
        data: {
          nameZh: input.nameZh,
          nameEn: input.nameEn,
          description: input.description ?? null,
          dataScope: input.dataScope,
          permissions,
          fieldPermissions,
        },
        include: roleInclude,
      });
      await this.audit.log(
        {
          actor,
          action: 'role.update',
          entityType: 'role',
          entityId: id,
          summary: before.code,
          detail: {
            permissions: diff(before.permissions, permissions),
            fieldPermissions: diff(before.fieldPermissions, fieldPermissions),
            dataScope: { before: before.dataScope, after: input.dataScope },
          },
        },
        tx,
      );
      return updated;
    });
    return toRoleDto(role);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const role = await this.find(id);
    if (role.isPreset) throw new AppException('ROLE_PRESET_IMMUTABLE');
    if (role._count.users > 0) throw new AppException('ROLE_IN_USE');
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.audit.log({ actor, action: 'role.delete', entityType: 'role', entityId: id, summary: role.code }, tx);
    });
  }

  private async find(id: string): Promise<RoleRow> {
    const role = await this.prisma.role.findUnique({ where: { id }, include: roleInclude });
    if (!role) throw new AppException('NOT_FOUND');
    return role;
  }

  /** 去重并校验权限码、字段码（R01-7） */
  private normalize(input: { permissions: string[]; fieldPermissions: string[] }): {
    permissions: string[];
    fieldPermissions: string[];
  } {
    const permissions = [...new Set(input.permissions)];
    const fieldPermissions = [...new Set(input.fieldPermissions)];
    const unknown = [
      ...permissions.filter((p) => !isPermissionCode(p)),
      ...fieldPermissions.filter((f) => !isFieldPermissionCode(f)),
    ];
    if (unknown.length > 0) throw new AppException('ROLE_UNKNOWN_PERMISSION', { codes: unknown });
    return { permissions: permissions.sort(), fieldPermissions: fieldPermissions.sort() };
  }
}
