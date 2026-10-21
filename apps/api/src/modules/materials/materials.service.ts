import { Injectable } from '@nestjs/common';
import {
  UPLOAD_KIND_RULES,
  type CreateMaterialInput,
  type EnableStatusInput,
  type MaterialDto,
  type MaterialExportQuery,
  type MaterialListQuery,
  type Paginated,
  type UpdateMaterialInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { changedFields } from '../../common/audit-diff';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { skipTake, toPaginated } from '../../common/pagination';
import { Material, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { toFileDto } from '../../infra/files/files.service';
import { formatMaterialCode, SequenceService } from '../../infra/sequences/sequence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DictsService } from '../dicts/dicts.service';
import { CategoryIndex, MaterialCategoriesService } from '../material-categories/material-categories.service';

type Client = PrismaService | Prisma.TransactionClient;

export const materialInclude = { category: true, image: true } satisfies Prisma.MaterialInclude;
export type MaterialRow = Prisma.MaterialGetPayload<{ include: typeof materialInclude }>;

export function toMaterialDto(m: MaterialRow, index: CategoryIndex): MaterialDto {
  return {
    id: m.id,
    code: m.code,
    nameZh: m.nameZh,
    nameEn: m.nameEn,
    spec: m.spec,
    unitCode: m.unitCode,
    brand: m.brand,
    remark: m.remark,
    status: m.status,
    category: {
      id: m.category.id,
      code: m.category.code,
      nameZh: m.category.nameZh,
      nameEn: m.category.nameEn,
      effectiveEnabled: index.isEffectiveEnabled(m.category.id),
    },
    image: m.image ? toFileDto(m.image) : null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: MaterialCategoriesService,
    private readonly dicts: DictsService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
  ) {}

  async list(query: MaterialListQuery): Promise<Paginated<MaterialDto>> {
    const index = await this.categories.loadIndex();
    const where = this.where(query, index);
    const [rows, total] = await Promise.all([
      this.prisma.material.findMany({ where, include: materialInclude, orderBy: { code: 'asc' }, ...skipTake(query) }),
      this.prisma.material.count({ where }),
    ]);
    return toPaginated(
      rows.map((m) => toMaterialDto(m, index)),
      total,
      query,
    );
  }

  /** 导出：与列表相同的筛选条件，不分页（R03-8） */
  async listForExport(query: MaterialExportQuery): Promise<MaterialRow[]> {
    const index = await this.categories.loadIndex();
    return this.prisma.material.findMany({
      where: this.where(query, index),
      include: materialInclude,
      orderBy: { code: 'asc' },
    });
  }

  async get(id: string): Promise<MaterialDto> {
    const [row, index] = await Promise.all([this.findRow(id), this.categories.loadIndex()]);
    return toMaterialDto(row, index);
  }

  /** R03-4：编码留空自动生成；单位必须是启用的字典项；分类必须有效启用；图片最多 1 张 */
  async create(actor: AuthUser, input: CreateMaterialInput): Promise<MaterialDto> {
    await this.dicts.assertEnabled('unit', input.unitCode);
    await this.categories.assertSelectable(input.categoryId);
    await this.assertImage(actor, input.imageFileId, null);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const code = input.code ?? (await this.allocateCodes(tx, 1))[0];
        const created = await tx.material.create({
          data: {
            code,
            nameZh: input.nameZh,
            nameEn: input.nameEn ?? null,
            spec: input.spec,
            unitCode: input.unitCode,
            categoryId: input.categoryId,
            brand: input.brand ?? null,
            remark: input.remark ?? null,
            imageFileId: input.imageFileId,
            createdById: actor.id,
          },
          include: materialInclude,
        });
        await this.audit.log(
          { actor, action: 'material.create', entityType: 'material', entityId: created.id, summary: `${code} ${created.nameZh}` },
          tx,
        );
        return toMaterialDto(created, await this.categories.loadIndex(tx));
      });
    } catch (e) {
      if (isUniqueViolation(e, 'code')) throw new AppException('MATERIAL_CODE_TAKEN');
      throw e;
    }
  }

  /** code 不能改。单位、分类只在改动时校验是否可选用：停用的旧值照常保留 */
  async update(actor: AuthUser, id: string, input: UpdateMaterialInput): Promise<MaterialDto> {
    const before = await this.findRow(id);
    if (input.unitCode !== before.unitCode) await this.dicts.assertEnabled('unit', input.unitCode);
    if (input.categoryId !== before.categoryId) await this.categories.assertSelectable(input.categoryId);
    await this.assertImage(actor, input.imageFileId, before.imageFileId);
    const data = {
      nameZh: input.nameZh,
      nameEn: input.nameEn ?? null,
      spec: input.spec,
      unitCode: input.unitCode,
      categoryId: input.categoryId,
      brand: input.brand ?? null,
      remark: input.remark ?? null,
      imageFileId: input.imageFileId,
    };
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.material.update({ where: { id }, data, include: materialInclude });
      await this.audit.log(
        {
          actor,
          action: 'material.update',
          entityType: 'material',
          entityId: id,
          summary: `${before.code} ${data.nameZh}`,
          detail: changedFields(before, data),
        },
        tx,
      );
      return toMaterialDto(updated, await this.categories.loadIndex(tx));
    });
  }

  /** R03-5：停用的材料不能被询价行选用 */
  async setStatus(actor: AuthUser, id: string, input: EnableStatusInput): Promise<MaterialDto> {
    const before = await this.findRow(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.material.update({ where: { id }, data: { status: input.status }, include: materialInclude });
      await this.audit.log(
        {
          actor,
          action: input.status === 'DISABLED' ? 'material.disable' : 'material.enable',
          entityType: 'material',
          entityId: id,
          summary: `${before.code} ${before.nameZh}`,
        },
        tx,
      );
      return toMaterialDto(updated, await this.categories.loadIndex(tx));
    });
  }

  /** 询价行选用材料前校验（M06）：存在且启用，否则 VALIDATION_FAILED / MATERIAL_DISABLED（R03-5） */
  async assertSelectable(id: string, client: Client = this.prisma, path = 'materialId'): Promise<Material> {
    const material = await client.material.findUnique({ where: { id } });
    if (!material) {
      throw new AppException('VALIDATION_FAILED', undefined, [{ path, code: 'not_found', message: 'Material not found' }]);
    }
    if (material.status !== 'ENABLED') throw new AppException('MATERIAL_DISABLED', { code: material.code });
    return material;
  }

  /**
   * 取 count 个未被占用的自动编码。手填过 MAT-000011 这类编码时跳过；
   * reserved 是同一批里手填的编码（导入时用）
   */
  async allocateCodes(tx: Prisma.TransactionClient, count: number, reserved: ReadonlySet<string> = new Set()): Promise<string[]> {
    const codes: string[] = [];
    while (codes.length < count) {
      const need = count - codes.length;
      const first = await this.sequences.nextRange('MAT', need, tx);
      const candidates = Array.from({ length: need }, (_, i) => formatMaterialCode(first + i));
      const taken = await tx.material.findMany({ where: { code: { in: candidates } }, select: { code: true } });
      const takenCodes = new Set(taken.map((m) => m.code));
      codes.push(...candidates.filter((c) => !takenCodes.has(c) && !reserved.has(c)));
    }
    return codes;
  }

  private where(query: MaterialExportQuery, index: CategoryIndex): Prisma.MaterialWhereInput {
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    return {
      ...(query.status ? { status: query.status } : {}),
      // R03-6：按分类筛选包含全部下级
      ...(query.categoryId ? { categoryId: { in: index.subtreeIds(query.categoryId) } } : {}),
      ...(query.keyword
        ? {
            OR: [
              { code: contains(query.keyword) },
              { nameZh: contains(query.keyword) },
              { nameEn: contains(query.keyword) },
              { spec: contains(query.keyword) },
            ],
          }
        : {}),
    };
  }

  /** 只能挂自己上传的 MATERIAL_IMAGE 文件（防止借用别人的文件 id 扩大访问范围）；没换图片时不检查 */
  private async assertImage(actor: AuthUser, fileId: string | null, currentId: string | null): Promise<void> {
    if (!fileId || fileId === currentId) return;
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new AppException('VALIDATION_FAILED', undefined, [
        { path: 'imageFileId', code: 'not_found', message: 'File not found' },
      ]);
    }
    if (file.kind !== 'MATERIAL_IMAGE') {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', { allowed: UPLOAD_KIND_RULES.MATERIAL_IMAGE.exts.join(', ') });
    }
    if (file.uploadedById !== actor.id) throw new AppException('FILE_ACCESS_DENIED');
  }

  private async findRow(id: string): Promise<MaterialRow> {
    const row = await this.prisma.material.findUnique({ where: { id }, include: materialInclude });
    if (!row) throw new AppException('NOT_FOUND');
    return row;
  }
}
