import { Injectable } from '@nestjs/common';
import type {
  CreateCategoryInput,
  EnableStatusInput,
  MaterialCategoryDto,
  MaterialCategoryNodeDto,
  UpdateCategoryInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { changedFields } from '../../common/audit-diff';
import { AppException } from '../../common/errors/app.exception';
import { isForeignKeyViolation, isUniqueViolation } from '../../common/errors/prisma-errors';
import { MaterialCategory, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

type Client = PrismaService | Prisma.TransactionClient;

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 整棵分类树的内存索引。分类只有几十到几百个，每次需要时全量读取即可 */
export class CategoryIndex {
  private readonly byId = new Map<string, MaterialCategory>();
  private readonly childrenOf = new Map<string | null, MaterialCategory[]>();
  private readonly effective = new Map<string, boolean>();

  constructor(rows: MaterialCategory[]) {
    const sorted = [...rows].sort((a, b) => a.sort - b.sort || byCode(a.code, b.code));
    for (const row of sorted) {
      this.byId.set(row.id, row);
      const siblings = this.childrenOf.get(row.parentId) ?? [];
      siblings.push(row);
      this.childrenOf.set(row.parentId, siblings);
    }
  }

  get(id: string): MaterialCategory | undefined {
    return this.byId.get(id);
  }

  all(): MaterialCategory[] {
    return [...this.byId.values()];
  }

  /** 同级按 sort、code 排序 */
  children(parentId: string | null): MaterialCategory[] {
    return this.childrenOf.get(parentId) ?? [];
  }

  /** 有效启用 = 自己和所有上级都启用（R03-2）。不支持移动分类，所以树里不会有环 */
  isEffectiveEnabled(id: string): boolean {
    const cached = this.effective.get(id);
    if (cached !== undefined) return cached;
    const row = this.byId.get(id);
    const result =
      row !== undefined && row.status === 'ENABLED' && (row.parentId === null || this.isEffectiveEnabled(row.parentId));
    this.effective.set(id, result);
    return result;
  }

  /**
   * 新选用分类前校验：存在且有效启用，否则 VALIDATION_FAILED（path 指向请求里的字段）/ CATEGORY_DISABLED（R03-2）。
   * 一次要校验多个分类时（供应商主营分类）先 loadIndex() 再逐个调用，只读一次分类表
   */
  assertSelectable(id: string, path = 'categoryId'): MaterialCategory {
    const category = this.byId.get(id);
    if (!category) {
      throw new AppException('VALIDATION_FAILED', undefined, [{ path, code: 'not_found', message: 'Category not found' }]);
    }
    if (!this.isEffectiveEnabled(id)) throw new AppException('CATEGORY_DISABLED', { code: category.code });
    return category;
  }

  /** 自己和全部下级的 id（R03-6） */
  subtreeIds(id: string): string[] {
    if (!this.byId.has(id)) return [];
    const ids: string[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      ids.push(current);
      for (const child of this.children(current)) stack.push(child.id);
    }
    return ids;
  }
}

export function toCategoryDto(c: MaterialCategory, index: CategoryIndex, materialCount: number): MaterialCategoryDto {
  return {
    id: c.id,
    parentId: c.parentId,
    code: c.code,
    nameZh: c.nameZh,
    nameEn: c.nameEn,
    sort: c.sort,
    status: c.status,
    effectiveEnabled: index.isEffectiveEnabled(c.id),
    isPreset: c.isPreset,
    remark: c.remark,
    pplVariantCode: c.pplVariantCode,
    materialCount,
  };
}

@Injectable()
export class MaterialCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async loadIndex(client: Client = this.prisma): Promise<CategoryIndex> {
    return new CategoryIndex(await client.materialCategory.findMany());
  }

  /** 整棵树；默认去掉不是有效启用的节点（连同下级） */
  async tree(includeDisabled: boolean): Promise<MaterialCategoryNodeDto[]> {
    const [index, counts] = await Promise.all([this.loadIndex(), this.materialCounts()]);
    const build = (parentId: string | null): MaterialCategoryNodeDto[] =>
      index
        .children(parentId)
        .filter((c) => includeDisabled || index.isEffectiveEnabled(c.id))
        .map((c) => ({ ...toCategoryDto(c, index, counts.get(c.id) ?? 0), children: build(c.id) }));
    return build(null);
  }

  /**
   * 新选用分类前校验（材料、M04 供应商主营分类、M06 询价行）：存在且有效启用，
   * 否则 VALIDATION_FAILED / CATEGORY_DISABLED（R03-2）
   */
  async assertSelectable(id: string, client: Client = this.prisma, path = 'categoryId'): Promise<MaterialCategory> {
    return (await this.loadIndex(client)).assertSelectable(id, path);
  }

  /** R03-1：code 唯一、创建后不可改；上级必须有效启用 */
  async create(actor: AuthUser, input: CreateCategoryInput): Promise<MaterialCategoryDto> {
    const parentId = input.parentId ?? null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (parentId) await this.assertSelectable(parentId, tx, 'parentId');
        const created = await tx.materialCategory.create({
          data: {
            parentId,
            code: input.code,
            nameZh: input.nameZh,
            nameEn: input.nameEn,
            sort: input.sort,
            remark: input.remark ?? null,
            pplVariantCode: input.pplVariantCode ?? null,
          },
        });
        await this.audit.log(
          {
            actor,
            action: 'materialCategory.create',
            entityType: 'materialCategory',
            entityId: created.id,
            summary: `${created.code} ${created.nameZh}`,
          },
          tx,
        );
        return this.dtoById(tx, created.id);
      });
    } catch (e) {
      if (isUniqueViolation(e, 'code')) throw new AppException('CATEGORY_CODE_TAKEN');
      throw e;
    }
  }

  /** 只改名称、排序、备注、PPL 变体；code 和上级不能改（R03-1） */
  async update(actor: AuthUser, id: string, input: UpdateCategoryInput): Promise<MaterialCategoryDto> {
    const before = await this.find(id);
    const data = {
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      sort: input.sort,
      remark: input.remark ?? null,
      ...(input.pplVariantCode !== undefined ? { pplVariantCode: input.pplVariantCode } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      await tx.materialCategory.update({ where: { id }, data });
      await this.audit.log(
        {
          actor,
          action: 'materialCategory.update',
          entityType: 'materialCategory',
          entityId: id,
          summary: `${before.code} ${data.nameZh}`,
          detail: changedFields(before, data),
        },
        tx,
      );
      return this.dtoById(tx, id);
    });
  }

  /** 停用后它和全部下级都不能被新选用，已有数据照常显示（R03-2） */
  async setStatus(actor: AuthUser, id: string, input: EnableStatusInput): Promise<MaterialCategoryDto> {
    const before = await this.find(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.materialCategory.update({ where: { id }, data: { status: input.status } });
      await this.audit.log(
        {
          actor,
          action: input.status === 'DISABLED' ? 'materialCategory.disable' : 'materialCategory.enable',
          entityType: 'materialCategory',
          entityId: id,
          summary: `${before.code} ${before.nameZh}`,
        },
        tx,
      );
      return this.dtoById(tx, id);
    });
  }

  /** R03-3：没有下级、材料、询价单、询价行、供应商引用才能删除，预置分类也一样 */
  async remove(actor: AuthUser, id: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const category = await tx.materialCategory.findUnique({
          where: { id },
          include: {
            _count: { select: { children: true, materials: true, inquiries: true, inquiryLines: true, suppliers: true } },
          },
        });
        if (!category) throw new AppException('NOT_FOUND');
        const { children, ...refs } = category._count;
        if (children > 0) throw new AppException('CATEGORY_HAS_CHILDREN', { children });
        if (Object.values(refs).some((n) => n > 0)) throw new AppException('CATEGORY_IN_USE', refs);
        await tx.materialCategory.delete({ where: { id } });
        await this.audit.log(
          {
            actor,
            action: 'materialCategory.delete',
            entityType: 'materialCategory',
            entityId: id,
            summary: `${category.code} ${category.nameZh}`,
          },
          tx,
        );
      });
    } catch (e) {
      // 检查之后被并发引用（新建下级、材料等）：外键 RESTRICT 兜底
      if (isForeignKeyViolation(e)) throw new AppException('CATEGORY_IN_USE');
      throw e;
    }
  }

  private async find(id: string): Promise<MaterialCategory> {
    const category = await this.prisma.materialCategory.findUnique({ where: { id } });
    if (!category) throw new AppException('NOT_FOUND');
    return category;
  }

  private async dtoById(client: Client, id: string): Promise<MaterialCategoryDto> {
    const index = await this.loadIndex(client);
    const count = await client.material.count({ where: { categoryId: id } });
    return toCategoryDto(index.get(id)!, index, count);
  }

  private async materialCounts(): Promise<Map<string, number>> {
    const groups = await this.prisma.material.groupBy({ by: ['categoryId'], _count: { _all: true } });
    return new Map(groups.map((g) => [g.categoryId, g._count._all]));
  }
}
