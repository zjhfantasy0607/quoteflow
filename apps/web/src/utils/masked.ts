/** 接口对象上的某个字段是否被脱敏（被脱敏的字段值为 null，并列在 maskedFields 里，docs/03 §2） */
export function isMasked(obj: { maskedFields?: string[] } | null | undefined, field: string): boolean {
  return obj?.maskedFields?.includes(field) ?? false;
}
