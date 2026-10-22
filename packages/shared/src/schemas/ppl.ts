import { z } from 'zod';

/** POST /api/ppl/sets。definition 由服务端 validateDefinition() 校验，失败返回 PPL_DEFINITION_INVALID */
export const createPplSetSchema = z.object({
  label: z.string().trim().min(1).max(100),
  definition: z.unknown(),
});
export type CreatePplSetInput = z.infer<typeof createPplSetSchema>;

/** GET /api/ppl/resolve：version 不传 = 当前激活版本，variant 不传 = 主模板 */
export const resolvePplQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  variant: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase() || undefined)
    .optional(),
});
export type ResolvePplQuery = z.infer<typeof resolvePplQuerySchema>;
