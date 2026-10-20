import { z } from 'zod';

/** 分页查询参数（docs/03 §1） */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 查询串里的布尔值："true" / "false"。不要用 z.coerce.boolean()（会把 "false" 当成 true） */
export const queryBoolean = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

/** 去掉首尾空白，空串视为未填 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const requiredText = (max: number) => z.string().trim().min(1).max(max);

export const idSchema = z.string().min(1).max(40);
