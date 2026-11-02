import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';

/** main.ts 与 e2e 测试共用的应用配置，保证测试走的是同一条请求链 */
export function configureApp(app: NestExpressApplication, trustProxy = 'loopback'): void {
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.set('trust proxy', trustProxy);
}
