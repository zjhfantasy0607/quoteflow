import { Workbook } from 'exceljs';
import { CleanupJob } from '../src/infra/jobs/cleanup.job';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

async function xlsx(): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet('规格');
  ws.addRow(['参数', '值']);
  ws.addRow(['功率', '0.5W']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('M02 文件上传与受控下载', () => {
  let ctx: TestContext;
  let a: Agent;
  let b: Agent;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    a = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
    b = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R02-4 上传 PDF 成功，返回文件信息（中文文件名不乱码）', async () => {
    const res = await a.post('/api/files').field('kind', 'SPEC_DOC').attach('file', PDF, '规格书 PT500.pdf').expect(201);
    expect(res.body).toMatchObject({ originalName: '规格书 PT500.pdf', mimeType: 'application/pdf', kind: 'SPEC_DOC' });
  });

  it('R02-4 扩展名伪装（内容不是 PDF）被魔数拦截', async () => {
    const res = await a
      .post('/api/files')
      .field('kind', 'SPEC_DOC')
      .attach('file', Buffer.from('MZ fake exe content'), 'evil.pdf')
      .expect(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('R02-4 类别不允许的扩展名被拒（产品图只能是图片）', async () => {
    const res = await a.post('/api/files').field('kind', 'PRODUCT_IMAGE').attach('file', PDF, 'a.pdf').expect(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('R02-4 超过系统参数里的大小上限被拒', async () => {
    await ctx.prisma.systemParam.upsert({
      where: { key: 'upload.limits' },
      create: { key: 'upload.limits', value: { specDocMaxMB: 50, imageMaxMB: 1, attachmentMaxMB: 50, imagesPerLine: 10 } },
      update: { value: { specDocMaxMB: 50, imageMaxMB: 1, attachmentMaxMB: 50, imagesPerLine: 10 } },
    });
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]);
    const res = await a.post('/api/files').field('kind', 'PRODUCT_IMAGE').attach('file', big, 'big.png').expect(400);
    expect(res.body).toMatchObject({ code: 'FILE_TOO_LARGE', params: { maxMB: 1 } });
    await ctx.prisma.systemParam.delete({ where: { key: 'upload.limits' } });
  });

  it('R02-5 未被引用的文件只有上传者能读；下载头部正确', async () => {
    const up = await a.post('/api/files').field('kind', 'SPEC_DOC').attach('file', PDF, '规格书.pdf').expect(201);
    const res = await a.get(`/api/files/${up.body.id}/content`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('规格书.pdf')}`);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    const inline = await a.get(`/api/files/${up.body.id}/content?disposition=inline`).expect(200);
    expect(inline.headers['content-disposition']).toMatch(/^inline;/);

    const denied = await b.get(`/api/files/${up.body.id}/content`).expect(403);
    expect(denied.body.code).toBe('FILE_ACCESS_DENIED');
    await b.get(`/api/files/${up.body.id}/meta`).expect(403);
    await a.get('/api/files/nope/meta').expect(404);
  });

  it('R02-6 xlsx 可以表格预览', async () => {
    const up = await a.post('/api/files').field('kind', 'SPEC_DOC').attach('file', await xlsx(), '参数表.xlsx').expect(201);
    const res = await a.get(`/api/files/${up.body.id}/sheet-preview`).expect(200);
    expect(res.body.sheets[0]).toMatchObject({ name: '规格', rows: [['参数', '值'], ['功率', '0.5W']], truncated: false });
  });

  it('清理任务删除 24 小时前上传且未被引用的文件', async () => {
    const up = await a.post('/api/files').field('kind', 'SPEC_DOC').attach('file', PDF, 'old.pdf').expect(201);
    ctx.clock.advanceHours(25);
    const result = await ctx.app.get(CleanupJob).run();
    expect(result.files).toBeGreaterThanOrEqual(1);
    expect(await ctx.prisma.fileObject.findUnique({ where: { id: up.body.id } })).toBeNull();
  });
});
