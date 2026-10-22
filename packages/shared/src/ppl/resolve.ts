import type { ErrorCode } from '../errors';
import { PPL_MASTER_CODE, type PplDefinition, type PplResolvedColumn } from './definition';

/** shared 里抛出的 PPL 错误，api 转成同码的 AppException。 */
export class PplError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PplError';
  }
}

/** 主模板加各变体的代码与名称，主模板在前。 */
export function pplVariants(
  definition: PplDefinition,
): Array<{ code: string; nameZh: string; nameEn: string }> {
  const { code, nameZh, nameEn } = definition.master;
  return [
    { code, nameZh, nameEn },
    ...definition.variants.map((v) => ({ code: v.code, nameZh: v.nameZh, nameEn: v.nameEn })),
  ];
}

export function hasPplVariant(definition: PplDefinition, variantCode: string): boolean {
  return variantCode === PPL_MASTER_CODE || definition.variants.some((v) => v.code === variantCode);
}

/**
 * R05-3：变体实际使用的列。保持主模板顺序，排除 exclude，合并 required；
 * null 或 PPL-MASTER 为主模板；变体不存在抛 PPL_VARIANT_NOT_FOUND。
 */
export function resolveColumns(definition: PplDefinition, variantCode: string | null): PplResolvedColumn[] {
  const master = definition.master.columns.map((c) => ({ ...c, required: c.required === true }));
  if (variantCode === null || variantCode === PPL_MASTER_CODE) return master;
  const variant = definition.variants.find((v) => v.code === variantCode);
  if (!variant) throw new PplError('PPL_VARIANT_NOT_FOUND', `PPL variant "${variantCode}" not found`);
  const exclude = new Set(variant.exclude);
  const required = new Set(variant.required);
  return master
    .filter((c) => !exclude.has(c.key))
    .map((c) => (required.has(c.key) ? { ...c, required: true } : c));
}
