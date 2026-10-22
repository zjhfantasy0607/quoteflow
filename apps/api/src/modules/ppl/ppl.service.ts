import { Injectable } from '@nestjs/common';
import {
  PPL_MASTER_CODE,
  PplError,
  pplVariants,
  resolveColumns,
  validateDefinition,
  type CreatePplSetInput,
  type PplDefinition,
  type PplResolvedColumn,
  type PplResolvedDto,
  type PplSetDto,
  type PplSetSummaryDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app.exception';
import { Prisma, PplTemplateSet } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

type Client = PrismaService | Prisma.TransactionClient;

/** 模板集的创建（版本号取 max + 1）和激活（互斥）串行执行：事务级 advisory lock */
const PPL_SET_LOCK_SQL = Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(5050001)`;

/** 保存前已经过 validateDefinition()，读出来直接用 */
export function definitionOf(row: PplTemplateSet): PplDefinition {
  return row.definition as unknown as PplDefinition;
}

/** 解析变体的列；shared 抛的 PplError（变体不存在）转成同码的 AppException */
export function resolveVariantColumns(
  definition: PplDefinition,
  variantCode: string | null,
): PplResolvedColumn[] {
  try {
    return resolveColumns(definition, variantCode);
  } catch (e) {
    if (e instanceof PplError) throw new AppException(e.code, { variantCode });
    throw e;
  }
}

function toSummary(row: PplTemplateSet): PplSetSummaryDto {
  const definition = definitionOf(row);
  return {
    version: row.version,
    label: row.label,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    variants: pplVariants(definition).map((v) => ({
      ...v,
      columnCount: resolveColumns(definition, v.code).length,
    })),
  };
}

function toDto(row: PplTemplateSet): PplSetDto {
  return { ...toSummary(row), definition: definitionOf(row) };
}

@Injectable()
export class PplService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PplSetSummaryDto[]> {
    const rows = await this.prisma.pplTemplateSet.findMany({ orderBy: { version: 'desc' } });
    return rows.map(toSummary);
  }

  async get(version: number): Promise<PplSetDto> {
    return toDto(await this.find(version));
  }

  /** 当前激活的版本；M07 发布轮次时冻结它的版本号 */
  async active(client: Client = this.prisma): Promise<{ version: number; definition: PplDefinition } | null> {
    const row = await client.pplTemplateSet.findFirst({ where: { isActive: true } });
    return row ? { version: row.version, definition: definitionOf(row) } : null;
  }

  /** 按版本号取定义，激活别的版本后已冻结的版本照样能取（R05-2） */
  async definition(version: number, client: Client = this.prisma): Promise<PplDefinition> {
    return definitionOf(await this.find(version, client));
  }

  /** version 不传 = 当前激活版本，variantCode 不传 = 主模板 */
  async resolve(version: number | undefined, variantCode: string | undefined): Promise<PplResolvedDto> {
    const row =
      version === undefined
        ? await this.prisma.pplTemplateSet.findFirst({ where: { isActive: true } })
        : await this.prisma.pplTemplateSet.findUnique({ where: { version } });
    if (!row) throw new AppException('PPL_SET_NOT_FOUND', { version: version ?? null });
    const definition = definitionOf(row);
    const code = variantCode ?? PPL_MASTER_CODE;
    return {
      version: row.version,
      variantCode: code,
      groups: definition.groups,
      columns: resolveVariantColumns(definition, code),
    };
  }

  /** R05-1、R05-2：校验通过后保存为新版本（不激活）；已有版本不能修改，只能再建新版本 */
  async create(actor: AuthUser, input: CreatePplSetInput): Promise<PplSetDto> {
    const result = validateDefinition(input.definition);
    if (!result.ok) throw new AppException('PPL_DEFINITION_INVALID', undefined, result.issues);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(PPL_SET_LOCK_SQL);
      const last = await tx.pplTemplateSet.aggregate({ _max: { version: true } });
      const row = await tx.pplTemplateSet.create({
        data: {
          version: (last._max.version ?? 0) + 1,
          label: input.label,
          definition: result.definition as unknown as Prisma.InputJsonValue,
          createdById: actor.id,
        },
      });
      await this.audit.log(
        {
          actor,
          action: 'pplSet.create',
          entityType: 'pplSet',
          entityId: String(row.version),
          summary: `v${row.version} ${row.label}`,
        },
        tx,
      );
      return toDto(row);
    });
  }

  /** R05-2：同一时间只有一个激活版本；已发布的轮次冻结了自己的版本，不受影响。激活已激活的版本不做任何事 */
  async activate(actor: AuthUser, version: number): Promise<PplSetDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(PPL_SET_LOCK_SQL);
      const row = await this.find(version, tx);
      if (row.isActive) return toDto(row);
      await tx.pplTemplateSet.updateMany({ where: { isActive: true }, data: { isActive: false } });
      const activated = await tx.pplTemplateSet.update({ where: { version }, data: { isActive: true } });
      await this.audit.log(
        {
          actor,
          action: 'pplSet.activate',
          entityType: 'pplSet',
          entityId: String(version),
          summary: `v${version} ${row.label}`,
        },
        tx,
      );
      return toDto(activated);
    });
  }

  private async find(version: number, client: Client = this.prisma): Promise<PplTemplateSet> {
    const row = await client.pplTemplateSet.findUnique({ where: { version } });
    if (!row) throw new AppException('PPL_SET_NOT_FOUND', { version });
    return row;
  }
}
