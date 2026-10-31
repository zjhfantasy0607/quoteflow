// 演示数据（docs/06-种子数据.md §3）。只在没有任何询价单时运行；业务单据通过 service 方法创建。
// Nest 的依赖注入要靠装饰器元数据，tsx（esbuild）不生成，所以先用 tsc 编译到 dist-seed 再运行（package.json 的 seed:demo）。
import './demo/demo-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { demoContext, seedD1, seedD2, seedD3, seedD4, seedD5, seedD6, seedD7 } from './demo/scenarios';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    if ((await prisma.inquiry.count()) > 0) {
      console.error('seed-demo: inquiries already exist; run "npm run db:reset" first (resets ALL data)');
      process.exitCode = 1;
      return;
    }
    const ctx = await demoContext(app);
    const d1 = await seedD1(ctx);
    const d2 = await seedD2(ctx);
    const d3 = await seedD3(ctx);
    const d4 = await seedD4(ctx);
    const d5 = await seedD5(ctx);
    const d6 = await seedD6(ctx);
    const d7 = await seedD7(ctx);
    console.log(
      `seed-demo: D1 draft ${d1}, D2 pending approval ${d2}, D3 awaiting quotes ${d3}, D4 negotiating ${d4}, ` +
        `D5 awarded ${d5}, D6 round 2 ${d6}, D7 contract approved ${d7}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
