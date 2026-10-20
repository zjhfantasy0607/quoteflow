import { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { ClockService, TestClock } from '../../src/common/clock/clock.service';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  clock: TestClock;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  controllers?: Type<unknown>[];
  /** 替换某些 provider（如让邮件发送失败的 MailTransport） */
  overrides?: { provide: unknown; useValue: unknown }[];
}

/** 与 main.ts 相同的请求链；时钟换成可控的 TestClock */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const clock = new TestClock();
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(ClockService)
    .useValue(clock);
  for (const o of options.overrides ?? []) {
    builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  await app.init();

  return { app, clock, prisma: app.get(PrismaService), close: () => app.close() };
}
