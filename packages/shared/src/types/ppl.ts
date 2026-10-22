import type { PplDefinition, PplGroup, PplResolvedColumn } from '../ppl/definition';

/** 主模板或变体，columnCount = 解析后的列数 */
export interface PplVariantSummaryDto {
  code: string;
  nameZh: string;
  nameEn: string;
  columnCount: number;
}

/** GET /api/ppl/sets 的一项，按版本号倒序 */
export interface PplSetSummaryDto {
  version: number;
  label: string;
  isActive: boolean;
  createdAt: string;
  /** 主模板在前 */
  variants: PplVariantSummaryDto[];
}

/** GET /api/ppl/sets/:version */
export interface PplSetDto extends PplSetSummaryDto {
  definition: PplDefinition;
}

/** GET /api/ppl/resolve */
export interface PplResolvedDto {
  version: number;
  variantCode: string;
  groups: PplGroup[];
  columns: PplResolvedColumn[];
}
