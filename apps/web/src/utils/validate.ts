import type { ValidationIssue } from '@quoteflow/shared';
import type { z } from 'zod';
import { i18n } from '@/i18n';

export type FieldErrors = Record<string, string>;

function messageFor(issue: z.core.$ZodIssue): string {
  const t = i18n.global.t;
  switch (issue.code) {
    case 'invalid_type':
      // 需要 safeParse 时传 reportInput，issue 才带 input
      return issue.input === undefined || issue.input === null
        ? t('common.validation.required')
        : t('common.validation.invalid');
    case 'too_small':
      if (issue.origin === 'string' && issue.minimum === 1) return t('common.validation.required');
      if (issue.origin === 'array' && issue.minimum === 1) return t('common.validation.selectOne');
      return t('common.validation.tooSmall', { min: String(issue.minimum) });
    case 'too_big':
      return t('common.validation.tooBig', { max: String(issue.maximum) });
    case 'invalid_format':
      return issue.format === 'email' ? t('common.validation.email') : t('common.validation.format');
    default:
      return t('common.validation.invalid');
  }
}

/** 用 shared 里的 zod schema 校验表单，返回 { 字段路径: 提示 } */
export function zodErrors(schema: z.ZodType, data: unknown): FieldErrors {
  const result = schema.safeParse(data, { reportInput: true });
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) errors[key] = messageFor(issue);
  }
  return errors;
}

/** 把后端 VALIDATION_FAILED 的 details 转成字段提示 */
export function serverFieldErrors(details: unknown): FieldErrors {
  if (!Array.isArray(details)) return {};
  const t = i18n.global.t;
  const errors: FieldErrors = {};
  for (const d of details as ValidationIssue[]) {
    if (d?.path && !errors[d.path]) errors[d.path] = t('common.validation.invalid');
  }
  return errors;
}
