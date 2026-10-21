import { validateEnv } from './env';

const base = {
  APP_BASE_URL: 'http://127.0.0.1:5173',
  DATABASE_URL: 'postgresql://quoteflow:quoteflow_dev@127.0.0.1:15432/quoteflow',
  MAIL_FROM: 'QuoteFlow <noreply@quoteflow.local>',
  EXCEL_SIGNING_SECRET: 'dev-only-change-me',
  EXCEL_SHEET_PASSWORD: 'quoteflow',
};

describe('validateEnv', () => {
  it('未设置的开关取默认值，而且是布尔值不是字符串', () => {
    const env = validateEnv(base);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.JOBS_ENABLED).toBe(true);
    expect(env.API_PORT).toBe(3000);
    expect(env.SMTP_PORT).toBe(11025);
  });

  it('"true" / "false" 转成布尔值，数字串转成数字', () => {
    const env = validateEnv({ ...base, COOKIE_SECURE: 'true', JOBS_ENABLED: 'false', API_PORT: '3100' });
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.JOBS_ENABLED).toBe(false);
    expect(env.API_PORT).toBe(3100);
  });

  it('缺项或格式错误时列出每一项并拒绝启动', () => {
    const { DATABASE_URL: _omit, ...withoutDb } = base;
    expect(() => validateEnv({ ...withoutDb, APP_BASE_URL: 'not a url', COOKIE_SECURE: 'yes' })).toThrow(
      /APP_BASE_URL[\s\S]*DATABASE_URL[\s\S]*COOKIE_SECURE/,
    );
  });

  it('生产环境必须修改 Excel 签名密钥', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/EXCEL_SIGNING_SECRET/);
    expect(validateEnv({ ...base, NODE_ENV: 'production', EXCEL_SIGNING_SECRET: 'prod-secret-123' }).NODE_ENV).toBe(
      'production',
    );
  });
});
