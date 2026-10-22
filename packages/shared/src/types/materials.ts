import type { EnableStatus } from '../enums';
import type { FileDto } from './infra';

/** 材料分类。effectiveEnabled = 自己和所有上级都启用（R03-2） */
export interface MaterialCategoryDto {
  id: string;
  parentId: string | null;
  code: string;
  nameZh: string;
  nameEn: string;
  sort: number;
  status: EnableStatus;
  effectiveEnabled: boolean;
  isPreset: boolean;
  remark: string | null;
  pplVariantCode: string | null;
  /** 直接挂在本分类下的材料数（不含下级） */
  materialCount: number;
}

/** GET /api/material-categories/tree 的节点，同级按 sort、code 排序 */
export interface MaterialCategoryNodeDto extends MaterialCategoryDto {
  children: MaterialCategoryNodeDto[];
}

/** GET /api/material-categories/:id/ppl-variant（R05-6） */
export interface MaterialCategoryPplVariantDto {
  /** 实际生效的变体代码；null = 主模板（自己和所有上级都没设置） */
  variantCode: string | null;
  /** 继承来源的上级分类；变体是自己设置的、或用主模板时为 null */
  inheritedFrom: { id: string; code: string; nameZh: string; nameEn: string } | null;
}

export interface MaterialCategoryBriefDto {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  effectiveEnabled: boolean;
}

export interface MaterialDto {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string | null;
  spec: string;
  unitCode: string;
  brand: string | null;
  remark: string | null;
  status: EnableStatus;
  category: MaterialCategoryBriefDto;
  image: FileDto | null;
  createdAt: string;
  updatedAt: string;
}
