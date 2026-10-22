import { Injectable } from '@nestjs/common';
import type { CreateDictItemInput, DictItemDto, UpdateDictItemInput } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { DictsService } from '../dicts/dicts.service';

export const SUPPLIER_CATEGORY_TYPE = 'supplier_category';

/**
 * 供应商分类页（R04-9）：supplier_category 字典的专用入口，权限是 supplier:category:manage 而不是 system:dict:manage。
 * 可以新增、改名、排序、停用；没有删除（系统字典的字典项本来就只能停用，预置的三个分类因此不会被删除）
 */
@Injectable()
export class SupplierCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dicts: DictsService,
  ) {}

  /** 含停用的分类（列表筛选、分类标签要显示停用分类的名称） */
  list(): Promise<DictItemDto[]> {
    return this.dicts.listItems(SUPPLIER_CATEGORY_TYPE);
  }

  create(actor: AuthUser, input: CreateDictItemInput): Promise<DictItemDto> {
    return this.dicts.createItem(actor, SUPPLIER_CATEGORY_TYPE, input);
  }

  /** 只能改供应商分类，别的字典项按不存在处理 */
  async update(actor: AuthUser, id: string, input: UpdateDictItemInput): Promise<DictItemDto> {
    const item = await this.prisma.dictItem.findUnique({ where: { id }, select: { typeCode: true } });
    if (item?.typeCode !== SUPPLIER_CATEGORY_TYPE) throw new AppException('NOT_FOUND');
    return this.dicts.updateItem(actor, id, input);
  }
}
