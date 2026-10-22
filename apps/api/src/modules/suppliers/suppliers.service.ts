import { Injectable } from '@nestjs/common';
import type {
  CreateSupplierInput,
  EnableStatusInput,
  Paginated,
  SupplierDto,
  SupplierExportQuery,
  SupplierLanguage,
  SupplierListQuery,
  UpdateSupplierInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { SessionService } from '../../common/auth/session.service';
import { changedFields } from '../../common/audit-diff';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { skipTake, toPaginated } from '../../common/pagination';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { formatSupplierCode, SequenceService } from '../../infra/sequences/sequence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DictsService } from '../dicts/dicts.service';
import { CategoryIndex, MaterialCategoriesService } from '../material-categories/material-categories.service';

export const supplierInclude = {
  materialCategories: { include: { category: true } },
} satisfies Prisma.SupplierInclude;
export type SupplierRow = Prisma.SupplierGetPayload<{ include: typeof supplierInclude }>;

/** 联系方式（字段权限 supplier.contact，R04-7） */
export const CONTACT_FIELDS = ['contactEmail', 'contactPhone', 'ccEmails'] as const;

const byCode = (a: { code: string }, b: { code: string }) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/** 未脱敏的 DTO；返回给前端前经 SuppliersService.toDto 按字段权限脱敏 */
export function toSupplierDto(s: SupplierRow, index: CategoryIndex): SupplierDto {
  return {
    id: s.id,
    code: s.code,
    nameZh: s.nameZh,
    nameEn: s.nameEn,
    creditCode: s.creditCode,
    categoryCode: s.categoryCode,
    materialCategories: s.materialCategories
      .map(({ category: c }) => ({
        id: c.id,
        code: c.code,
        nameZh: c.nameZh,
        nameEn: c.nameEn,
        effectiveEnabled: index.isEffectiveEnabled(c.id),
      }))
      .sort(byCode),
    contactName: s.contactName,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    ccEmails: s.ccEmails,
    preferredLanguage: s.preferredLanguage as SupplierLanguage,
    country: s.country,
    address: s.address,
    remark: s.remark,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** 列表、导出与 M07 候选供应商共用的筛选条件（R04-5） */
export function supplierWhere(query: SupplierExportQuery, index: CategoryIndex): Prisma.SupplierWhereInput {
  const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.categoryCodes?.length ? { categoryCode: { in: query.categoryCodes } } : {}),
    // 主营材料分类包含全部下级
    ...(query.materialCategoryId
      ? { materialCategories: { some: { categoryId: { in: index.subtreeIds(query.materialCategoryId) } } } }
      : {}),
    ...(query.keyword
      ? {
          OR: [
            { code: contains(query.keyword) },
            { nameZh: contains(query.keyword) },
            { nameEn: contains(query.keyword) },
            { contactName: contains(query.keyword) },
          ],
        }
      : {}),
  };
}

/** 供应商表上的可编辑字段（不含编码、主营分类、状态） */
function supplierData(input: UpdateSupplierInput) {
  return {
    nameZh: input.nameZh,
    nameEn: input.nameEn ?? null,
    creditCode: input.creditCode ?? null,
    categoryCode: input.categoryCode,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone ?? null,
    ccEmails: input.ccEmails,
    preferredLanguage: input.preferredLanguage,
    country: input.country ?? null,
    address: input.address ?? null,
    remark: input.remark ?? null,
  };
}
type SupplierData = ReturnType<typeof supplierData>;

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 审计里的修改明细：联系方式只记字段名、不记具体值（没有 supplier.contact 权限的人也可能看操作日志）；
 * 主营分类记修改前后的编码
 */
export function supplierAuditChanges(
  before: Omit<SupplierRow, 'materialCategories'>,
  data: Partial<SupplierData> & { status?: string },
  categoryCodes?: [string[], string[]],
): Prisma.InputJsonObject {
  const { ccEmails, contactEmail, contactPhone, ...plain } = data;
  const contactChanged = [
    ...(contactEmail !== undefined && contactEmail !== before.contactEmail ? ['contactEmail'] : []),
    ...(contactPhone !== undefined && contactPhone !== before.contactPhone ? ['contactPhone'] : []),
    ...(ccEmails !== undefined && !sameList(ccEmails, before.ccEmails) ? ['ccEmails'] : []),
  ];
  return {
    ...changedFields(before, plain),
    ...(contactChanged.length ? { contactChanged } : {}),
    ...(categoryCodes && !sameList([...categoryCodes[0]].sort(), [...categoryCodes[1]].sort())
      ? { materialCategories: categoryCodes }
      : {}),
  };
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: MaterialCategoriesService,
    private readonly dicts: DictsService,
    private readonly sequences: SequenceService,
    private readonly sessions: SessionService,
    private readonly fieldMask: FieldMaskService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: SupplierListQuery): Promise<Paginated<SupplierDto>> {
    const index = await this.categories.loadIndex();
    const where = supplierWhere(query, index);
    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        include: supplierInclude,
        orderBy: { code: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return toPaginated(
      rows.map((s) => this.toDto(user, s, index)),
      total,
      query,
    );
  }

  /** 导出：与列表相同的筛选条件，不分页 */
  async listForExport(query: SupplierExportQuery): Promise<{ rows: SupplierRow[]; index: CategoryIndex }> {
    const index = await this.categories.loadIndex();
    const rows = await this.prisma.supplier.findMany({
      where: supplierWhere(query, index),
      include: supplierInclude,
      orderBy: { code: 'asc' },
    });
    return { rows, index };
  }

  async get(user: AuthUser, id: string): Promise<SupplierDto> {
    const [row, index] = await Promise.all([this.findRow(id), this.categories.loadIndex()]);
    return this.toDto(user, row, index);
  }

  /** R04-1 ~ R04-4：分类必须启用；编码留空自动生成；主营分类必须有效启用 */
  async create(actor: AuthUser, input: CreateSupplierInput): Promise<SupplierDto> {
    await this.dicts.assertEnabled('supplier_category', input.categoryCode);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const index = await this.categories.loadIndex(tx);
        input.materialCategoryIds.forEach((id, i) => index.assertSelectable(id, `materialCategoryIds.${i}`));
        const code = input.code ?? (await this.allocateCodes(tx, 1))[0];
        const created = await tx.supplier.create({
          data: {
            code,
            ...supplierData(input),
            materialCategories: { create: input.materialCategoryIds.map((categoryId) => ({ categoryId })) },
          },
          include: supplierInclude,
        });
        await this.audit.log(
          {
            actor,
            action: 'supplier.create',
            entityType: 'supplier',
            entityId: created.id,
            summary: `${code} ${created.nameZh}`,
          },
          tx,
        );
        return this.toDto(actor, created, index);
      });
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  /** code 不能改。分类、主营分类只在改动时校验是否可选用：停用的旧值照常保留 */
  async update(actor: AuthUser, id: string, input: UpdateSupplierInput): Promise<SupplierDto> {
    const before = await this.findRow(id);
    if (input.categoryCode !== before.categoryCode)
      await this.dicts.assertEnabled('supplier_category', input.categoryCode);
    const data = supplierData(input);
    const beforeIds = before.materialCategories.map((m) => m.categoryId);
    const added = input.materialCategoryIds.filter((c) => !beforeIds.includes(c));
    const removed = beforeIds.filter((c) => !input.materialCategoryIds.includes(c));
    try {
      return await this.prisma.$transaction(async (tx) => {
        const index = await this.categories.loadIndex(tx);
        input.materialCategoryIds.forEach((c, i) => {
          if (added.includes(c)) index.assertSelectable(c, `materialCategoryIds.${i}`);
        });
        if (removed.length) {
          await tx.supplierMaterialCategory.deleteMany({
            where: { supplierId: id, categoryId: { in: removed } },
          });
        }
        if (added.length) {
          await tx.supplierMaterialCategory.createMany({
            data: added.map((categoryId) => ({ supplierId: id, categoryId })),
          });
        }
        const updated = await tx.supplier.update({ where: { id }, data, include: supplierInclude });
        const codesOf = (ids: string[]) => ids.map((c) => index.get(c)?.code ?? c);
        await this.audit.log(
          {
            actor,
            action: 'supplier.update',
            entityType: 'supplier',
            entityId: id,
            summary: `${before.code} ${data.nameZh}`,
            detail: supplierAuditChanges(before, data, [
              codesOf(beforeIds),
              codesOf(input.materialCategoryIds),
            ]),
          },
          tx,
        );
        return this.toDto(actor, updated, index);
      });
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  /** R04-6：停用后其门户用户的会话立即删除、不能再登录；不能被新邀请（M07）；已有报价单和合同不受影响 */
  async setStatus(actor: AuthUser, id: string, input: EnableStatusInput): Promise<SupplierDto> {
    const before = await this.findRow(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
        where: { id },
        data: { status: input.status },
        include: supplierInclude,
      });
      if (input.status === 'DISABLED') await this.sessions.revokeAllForSuppliers([id], tx);
      await this.audit.log(
        {
          actor,
          action: input.status === 'DISABLED' ? 'supplier.disable' : 'supplier.enable',
          entityType: 'supplier',
          entityId: id,
          summary: `${before.code} ${before.nameZh}`,
        },
        tx,
      );
      return this.toDto(actor, updated, await this.categories.loadIndex(tx));
    });
  }

  /** 按字段权限脱敏联系方式（R04-7） */
  toDto(user: AuthUser, row: SupplierRow, index: CategoryIndex): SupplierDto {
    return this.fieldMask.supplierContact(toSupplierDto(row, index), user);
  }

  /**
   * 取 count 个未被占用的自动编码。手填过 SUP10011 这类编码时跳过；
   * reserved 是同一批里手填的编码（导入时用）
   */
  async allocateCodes(
    tx: Prisma.TransactionClient,
    count: number,
    reserved: ReadonlySet<string> = new Set(),
  ): Promise<string[]> {
    const codes: string[] = [];
    while (codes.length < count) {
      const need = count - codes.length;
      const first = await this.sequences.nextRange('SUP', need, tx);
      const candidates = Array.from({ length: need }, (_, i) => formatSupplierCode(first + i));
      const taken = await tx.supplier.findMany({
        where: { code: { in: candidates } },
        select: { code: true },
      });
      const takenCodes = new Set(taken.map((s) => s.code));
      codes.push(...candidates.filter((c) => !takenCodes.has(c) && !reserved.has(c)));
    }
    return codes;
  }

  /** 编码、信用代码冲突（并发时由唯一约束兜底） */
  mapUnique(e: unknown): unknown {
    if (isUniqueViolation(e, 'code')) return new AppException('SUPPLIER_CODE_TAKEN');
    if (isUniqueViolation(e, 'creditCode')) return new AppException('SUPPLIER_CREDIT_CODE_TAKEN');
    return e;
  }

  private async findRow(id: string): Promise<SupplierRow> {
    const row = await this.prisma.supplier.findUnique({ where: { id }, include: supplierInclude });
    if (!row) throw new AppException('NOT_FOUND');
    return row;
  }
}
