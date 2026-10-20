import { Body, Controller, Get, Post } from '@nestjs/common';
import request from 'supertest';
import { z } from 'zod';
import { Public } from '../src/common/auth/decorators';
import { AppException } from '../src/common/errors/app.exception';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { resetDb } from './helpers/db';
import { createTestApp, TestContext } from './helpers/test-app';

const echoSchema = z.object({ name: z.string().min(1), qty: z.number().positive() });

@Public()
@Controller('__test')
class ProbeController {
  @Post('echo')
  echo(@Body(new ZodValidationPipe(echoSchema)) body: z.infer<typeof echoSchema>) {
    return body;
  }

  @Get('app-error')
  appError() {
    throw new AppException('INQUIRY_NOT_EDITABLE', { status: 'PENDING_APPROVAL' });
  }

  @Get('boom')
  boom() {
    throw new Error('secret internal detail');
  }
}

describe('M00 基座', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [ProbeController] });
    await resetDb(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /api/health 返回数据库状态', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(res.body.time).toBe(ctx.clock.now().toISOString());
  });

  it('R00-4 不存在的路由返回统一的 NOT_FOUND', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('R00-4 zod 校验失败返回 VALIDATION_FAILED 和字段明细', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/__test/echo')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: '', qty: -1 })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const paths = (res.body.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(['name', 'qty']);
  });

  it('校验通过时返回转换后的数据', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/__test/echo')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'x', qty: 2 })
      .expect(201);
    expect(res.body).toEqual({ name: 'x', qty: 2 });
  });

  it('R00-4 格式错误的 JSON 返回 VALIDATION_FAILED', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/__test/echo')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('AppException 的状态码由错误码决定', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/__test/app-error').expect(409);
    expect(res.body).toEqual({
      code: 'INQUIRY_NOT_EDITABLE',
      message: 'INQUIRY_NOT_EDITABLE',
      params: { status: 'PENDING_APPROVAL' },
    });
  });

  it('R00-4 未知异常返回 INTERNAL_ERROR，不暴露内部信息', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/__test/boom').expect(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });
});
