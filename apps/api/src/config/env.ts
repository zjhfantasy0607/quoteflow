import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    APP_BASE_URL: z.string().url(),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    DATABASE_URL_TEST: z.string().startsWith('postgresql://').optional(),
    SESSION_COOKIE_NAME: z.string().min(1).default('qf_sid'),
    COOKIE_SECURE: bool.default('false'),
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_DIR: z.string().min(1).default('./storage'),
    MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('smtp'),
    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().positive().default(11025),
    SMTP_SECURE: bool.default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().min(1),
    EXCEL_SIGNING_SECRET: z.string().min(8),
    EXCEL_SHEET_PASSWORD: z.string().min(1),
    JOBS_ENABLED: bool.default('true'),
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.EXCEL_SIGNING_SECRET === 'dev-only-change-me') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXCEL_SIGNING_SECRET'],
        message: 'must be changed in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** 供 ConfigModule 使用：校验失败时列出每一项问题并终止启动 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${lines.join('\n')}`);
  }
  return result.data;
}
