import { z } from 'zod';

// Zod 4 的 .default() 直接给出输出值、不经过 transform，所以默认值写布尔值
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    /** 监听地址：本机开发只听 127.0.0.1；容器里要听 0.0.0.0（只在容器网络里暴露，由 nginx 反代） */
    API_HOST: z.string().min(1).default('127.0.0.1'),
    /**
     * Express 的 trust proxy：哪些上游代理的 X-Forwarded-For 可信（决定 req.ip，登录限流和审计按它记 IP）。
     * 本机开发是 loopback；容器里 nginx 在私有网段，用 uniquelocal；生产按实际反向代理填（docs/交付/部署手册.md）
     */
    TRUST_PROXY: z.string().min(1).default('loopback'),
    APP_BASE_URL: z.url(),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    DATABASE_URL_TEST: z.string().startsWith('postgresql://').optional(),
    SESSION_COOKIE_NAME: z.string().min(1).default('qf_sid'),
    COOKIE_SECURE: bool.default(false),
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_DIR: z.string().min(1).default('./storage'),
    MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('smtp'),
    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().positive().default(11025),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().min(1),
    EXCEL_SIGNING_SECRET: z.string().min(8),
    EXCEL_SHEET_PASSWORD: z.string().min(1),
    JOBS_ENABLED: bool.default(true),
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.EXCEL_SIGNING_SECRET === 'dev-only-change-me'), {
    path: ['EXCEL_SIGNING_SECRET'],
    error: 'must be changed in production',
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
