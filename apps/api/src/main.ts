import 'reflect-metadata';
import { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/app-config';

const LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(AppConfig);
  app.useLogger(LEVELS.slice(0, LEVELS.indexOf(config.get('LOG_LEVEL')) + 1));
  configureApp(app, config.get('TRUST_PROXY'));
  app.enableShutdownHooks();
  await app.listen(config.get('API_PORT'), config.get('API_HOST'));
}

void bootstrap();
