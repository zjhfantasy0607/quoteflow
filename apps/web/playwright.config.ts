import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig } from '@playwright/test';

/**
 * 浏览器主流程（M17 §2.1）：自己起一套 API（3100）和前端（5174），连测试库，不碰开发库、不和 npm run dev 抢端口。
 * 用法：根目录 npm run test:browser（先构建 shared 与 api、清空并 seed 测试库，见 e2e/prepare-db.mjs）。
 * 用本机安装的 Google Chrome（channel: 'chrome'），不下载 Playwright 自带的浏览器（待确认事项 B-73）。
 * 设置 QF_BASE_URL 时对已经在运行的环境跑（如 staging http://127.0.0.1:18080，要求只有基础数据），不再自己起服务
 */
const API_PORT = 3100;
const WEB_PORT = 5174;
const apiDir = fileURLToPath(new URL('../api/', import.meta.url));
const artifacts = fileURLToPath(new URL('./e2e/.artifacts/', import.meta.url));
const external = process.env.QF_BASE_URL;
const apiEnv = external ? {} : parseEnv(readFileSync(`${apiDir}.env`, 'utf8'));

export default defineConfig({
  testDir: './e2e',
  outputDir: `${artifacts}test-results`,
  timeout: 3 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: `${artifacts}report`, open: 'never' }]],
  use: {
    baseURL: external ?? `http://127.0.0.1:${WEB_PORT}`,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: external
    ? []
    : [
        {
          command: 'node dist/main.js',
          cwd: apiDir,
          url: `http://127.0.0.1:${API_PORT}/api/health`,
          timeout: 60_000,
          reuseExistingServer: false,
          env: {
            DATABASE_URL: apiEnv.DATABASE_URL_TEST!,
            API_PORT: String(API_PORT),
            APP_BASE_URL: `http://127.0.0.1:${WEB_PORT}`,
            STORAGE_DIR: `${artifacts}storage`,
            JOBS_ENABLED: 'false',
            MAIL_TRANSPORT: 'log',
            LOG_LEVEL: 'warn',
          },
        },
        {
          command: `npx vite --port ${WEB_PORT} --strictPort`,
          url: `http://127.0.0.1:${WEB_PORT}`,
          timeout: 60_000,
          reuseExistingServer: false,
          env: { QF_API_TARGET: `http://127.0.0.1:${API_PORT}` },
        },
      ],
});
