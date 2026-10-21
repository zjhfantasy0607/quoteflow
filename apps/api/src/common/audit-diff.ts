type Scalar = string | number | boolean | null;

/** 审计用：列出有变化的字段 { 字段: [原值, 新值] }；undefined 视为 null */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: { [K in keyof T]?: Scalar | undefined },
): Record<string, [Scalar, Scalar]> {
  const changes: Record<string, [Scalar, Scalar]> = {};
  for (const key of Object.keys(after)) {
    const from = (before[key] ?? null) as Scalar;
    const to = after[key] ?? null;
    if (from !== to) changes[key] = [from, to];
  }
  return changes;
}
