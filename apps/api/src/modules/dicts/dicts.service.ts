import { Injectable } from '@nestjs/common';
import { DictItem, Prisma } from '@prisma/client';
import type {
  CreateDictItemInput,
  CreateDictTypeInput,
  DictItemDto,
  DictMapDto,
  DictTypeDto,
  UpdateDictItemInput,
  UpdateDictTypeInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

export function toDictItemDto(item: DictItem): DictItemDto {
  return {
    id: item.id,
    typeCode: item.typeCode,
    code: item.code,
    nameZh: item.nameZh,
    nameEn: item.nameEn,
    sort: item.sort,
    status: item.status,
    remark: item.remark,
  };
}

@Injectable()
export class DictsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 前端下拉用：只返回启用项，按排序号 */
  async listEnabled(types: string[]): Promise<DictMapDto> {
    const items = await this.prisma.dictItem.findMany({
      where: { typeCode: { in: types }, status: 'ENABLED' },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    });
    const map: DictMapDto = Object.fromEntries(types.map((t) => [t, [] as DictItemDto[]]));
    for (const item of items) map[item.typeCode].push(toDictItemDto(item));
    return map;
  }

  /** 写入引用字典的字段前校验：编码存在且启用，否则 DICT_ITEM_INVALID */
  async assertEnabled(
    typeCode: string,
    code: string | null | undefined,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (!code) return;
    const item = await client.dictItem.findUnique({ where: { typeCode_code: { typeCode, code } } });
    if (!item || item.status !== 'ENABLED') throw new AppException('DICT_ITEM_INVALID', { type: typeCode, code });
  }

  // ---------- 管理（M02） ----------

  async listTypes(): Promise<DictTypeDto[]> {
    const types = await this.prisma.dictType.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
    });
    return types.map((t) => ({
      code: t.code,
      nameZh: t.nameZh,
      nameEn: t.nameEn,
      isSystem: t.isSystem,
      itemCount: t._count.items,
    }));
  }

  async createType(actor: AuthUser, input: CreateDictTypeInput): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.dictType.create({ data: { ...input, isSystem: false } });
        await this.audit.log({ actor, action: 'dict.createType', entityType: 'dictType', entityId: input.code }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppException('DICT_TYPE_CODE_TAKEN');
      throw e;
    }
  }

  async updateType(actor: AuthUser, code: string, input: UpdateDictTypeInput): Promise<void> {
    await this.findType(code);
    await this.prisma.$transaction(async (tx) => {
      await tx.dictType.update({ where: { code }, data: input });
      await this.audit.log({ actor, action: 'dict.updateType', entityType: 'dictType', entityId: code }, tx);
    });
  }

  /** 系统字典类型不可删除；自定义类型连同字典项一起删除（R02-1） */
  async deleteType(actor: AuthUser, code: string): Promise<void> {
    const type = await this.findType(code);
    if (type.isSystem) throw new AppException('DICT_TYPE_SYSTEM');
    await this.prisma.$transaction(async (tx) => {
      await tx.dictItem.deleteMany({ where: { typeCode: code } });
      await tx.dictType.delete({ where: { code } });
      await this.audit.log({ actor, action: 'dict.deleteType', entityType: 'dictType', entityId: code }, tx);
    });
  }

  async listItems(typeCode: string): Promise<DictItemDto[]> {
    await this.findType(typeCode);
    const items = await this.prisma.dictItem.findMany({
      where: { typeCode },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    });
    return items.map(toDictItemDto);
  }

  async createItem(actor: AuthUser, typeCode: string, input: CreateDictItemInput): Promise<DictItemDto> {
    await this.findType(typeCode);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.dictItem.create({
          data: { typeCode, code: input.code, nameZh: input.nameZh, nameEn: input.nameEn, sort: input.sort, remark: input.remark ?? null },
        });
        await this.audit.log(
          { actor, action: 'dict.createItem', entityType: 'dictItem', entityId: item.id, summary: `${typeCode}/${input.code}` },
          tx,
        );
        return toDictItemDto(item);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppException('DICT_ITEM_CODE_TAKEN');
      throw e;
    }
  }

  /** code 创建后不可改；名称、排序、状态、备注可以改，立即生效（R02-1、R02-2） */
  async updateItem(actor: AuthUser, id: string, input: UpdateDictItemInput): Promise<DictItemDto> {
    const before = await this.findItem(id);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.dictItem.update({
        where: { id },
        data: { nameZh: input.nameZh, nameEn: input.nameEn, sort: input.sort, status: input.status, remark: input.remark ?? null },
      });
      await this.audit.log(
        {
          actor,
          action: 'dict.updateItem',
          entityType: 'dictItem',
          entityId: id,
          summary: `${before.typeCode}/${before.code}`,
          detail: { statusBefore: before.status, statusAfter: input.status },
        },
        tx,
      );
      return toDictItemDto(item);
    });
  }

  /** 系统字典的字典项只能停用，不能删除 */
  async deleteItem(actor: AuthUser, id: string): Promise<void> {
    const item = await this.findItem(id);
    const type = await this.findType(item.typeCode);
    if (type.isSystem) throw new AppException('DICT_TYPE_SYSTEM');
    await this.prisma.$transaction(async (tx) => {
      await tx.dictItem.delete({ where: { id } });
      await this.audit.log(
        { actor, action: 'dict.deleteItem', entityType: 'dictItem', entityId: id, summary: `${item.typeCode}/${item.code}` },
        tx,
      );
    });
  }

  private async findType(code: string) {
    const type = await this.prisma.dictType.findUnique({ where: { code } });
    if (!type) throw new AppException('NOT_FOUND');
    return type;
  }

  private async findItem(id: string): Promise<DictItem> {
    const item = await this.prisma.dictItem.findUnique({ where: { id } });
    if (!item) throw new AppException('NOT_FOUND');
    return item;
  }
}
