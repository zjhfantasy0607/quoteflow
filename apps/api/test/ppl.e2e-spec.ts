import { PPL_V0, type PplDefinition } from '@quoteflow/shared';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

/** v0 改个标签当作新版本的定义 */
function definition(label: string): PplDefinition {
  return { ...structuredClone(PPL_V0), label };
}

describe('M05 PPL 模板集', () => {
  let ctx: TestContext;
  let admin: Agent;
  let buyer: Agent;
  let portal: Agent;

  async function activeVersions(): Promise<number[]> {
    const rows = await ctx.prisma.pplTemplateSet.findMany({ where: { isActive: true } });
    return rows.map((r) => r.version);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    admin = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['ADMIN'] }));
    buyer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
    const supplier = await createSupplier(ctx.prisma);
    portal = await loginAs(
      ctx,
      await createUser(ctx.prisma, { roles: ['SUPPLIER'], userType: 'SUPPLIER', supplierId: supplier.id }),
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('seed：版本 1 为 v0 定义并激活，列表带主模板与变体的列数', async () => {
    const list = (await admin.get('/api/ppl/sets').expect(200)).body;
    expect(list).toEqual([
      expect.objectContaining({
        version: 1,
        label: PPL_V0.label,
        isActive: true,
        variants: [
          { code: 'PPL-MASTER', nameZh: 'PPL 主模板', nameEn: 'PPL Master Template', columnCount: 70 },
          { code: 'PPL-LED', nameZh: '灯珠报价模板', nameEn: 'LED Beads Template', columnCount: 67 },
          { code: 'PPL-PERIPH', nameZh: '灯外设报价模板', nameEn: 'Lamp Peripherals Template', columnCount: 66 },
        ],
      }),
    ]);
    const detail = (await admin.get('/api/ppl/sets/1').expect(200)).body;
    expect(detail.definition).toEqual(PPL_V0);
    expect((await admin.get('/api/ppl/sets/99').expect(404)).body).toMatchObject({
      code: 'PPL_SET_NOT_FOUND',
      params: { version: 99 },
    });
    expect((await admin.get('/api/ppl/sets/abc').expect(404)).body.code).toBe('PPL_SET_NOT_FOUND');
  });

  it('R05-1 定义校验失败返回 PPL_DEFINITION_INVALID 和逐条问题，不建版本', async () => {
    const bad = definition('bad');
    bad.variants[0].exclude.push('lead_time_days');
    delete bad.master.columns[2].prefillFrom;
    const res = await admin.post('/api/ppl/sets').send({ label: '错误的定义', definition: bad }).expect(400);
    expect(res.body.code).toBe('PPL_DEFINITION_INVALID');
    expect(res.body.details).toEqual([
      { path: 'master.columns[2].prefillFrom', message: 'prefill column requires prefillFrom' },
      { path: 'variants[0].exclude[3]', message: 'cannot exclude required column "lead_time_days"' },
    ]);

    const shape = await admin.post('/api/ppl/sets').send({ label: 'x', definition: { schemaVersion: 2 } }).expect(400);
    expect(shape.body.code).toBe('PPL_DEFINITION_INVALID');
    expect(shape.body.details.map((d: { path: string }) => d.path)).toContain('schemaVersion');

    const noLabel = await admin.post('/api/ppl/sets').send({ label: ' ', definition: PPL_V0 }).expect(400);
    expect(noLabel.body.code).toBe('VALIDATION_FAILED');
    expect(await ctx.prisma.pplTemplateSet.count()).toBe(1);
  });

  it('R05-2 新建为下一个版本号、未激活；激活互斥；已冻结的旧版本仍可解析', async () => {
    const created = (
      await admin.post('/api/ppl/sets').send({ label: 'v1 草稿', definition: definition('PPL v1') }).expect(201)
    ).body;
    expect(created).toMatchObject({ version: 2, label: 'v1 草稿', isActive: false });
    expect(created.definition.label).toBe('PPL v1');
    expect(await activeVersions()).toEqual([1]);

    const activated = (await admin.post('/api/ppl/sets/2/activate').expect(200)).body;
    expect(activated).toMatchObject({ version: 2, isActive: true });
    expect(await activeVersions()).toEqual([2]);
    // 再激活一次不做任何事
    await admin.post('/api/ppl/sets/2/activate').expect(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'pplSet.activate' } })).toBe(1);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'pplSet.create', entityId: '2' } })).toBe(1);

    const frozen = (await buyer.get('/api/ppl/resolve?version=1&variant=PPL-LED').expect(200)).body;
    expect(frozen).toMatchObject({ version: 1, variantCode: 'PPL-LED' });
    expect(frozen.columns).toHaveLength(67);
    expect((await buyer.get('/api/ppl/resolve').expect(200)).body.version).toBe(2);

    // 没有修改、删除接口
    await admin.put('/api/ppl/sets/1').send({ label: 'x', definition: PPL_V0 }).expect(404);
    await admin.delete('/api/ppl/sets/1').expect(404);
    await admin.post('/api/ppl/sets/99/activate').expect(404);
  });

  it('R05-2 并发激活不同版本后只有一个激活版本', async () => {
    await admin.post('/api/ppl/sets').send({ label: 'v3', definition: definition('PPL v3') }).expect(201);
    const results = await Promise.all([
      admin.post('/api/ppl/sets/1/activate'),
      admin.post('/api/ppl/sets/3/activate'),
      admin.post('/api/ppl/sets/2/activate'),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await activeVersions()).toHaveLength(1);
  });

  it('R05-3 resolve：默认主模板；变体代码大小写不敏感；不存在的变体 PPL_VARIANT_NOT_FOUND', async () => {
    const master = (await buyer.get('/api/ppl/resolve?version=1').expect(200)).body;
    expect(master.variantCode).toBe('PPL-MASTER');
    expect(master.columns).toHaveLength(70);
    expect(master.groups).toEqual(PPL_V0.groups);
    const periph = (await buyer.get('/api/ppl/resolve?version=1&variant=ppl-periph').expect(200)).body;
    expect(periph.columns).toHaveLength(66);
    expect(periph.columns.find((c: { key: string }) => c.key === 'material').required).toBe(true);

    const missing = await buyer.get('/api/ppl/resolve?version=1&variant=PPL-NOPE').expect(400);
    expect(missing.body).toMatchObject({ code: 'PPL_VARIANT_NOT_FOUND', params: { variantCode: 'PPL-NOPE' } });
    expect((await buyer.get('/api/ppl/resolve?version=99').expect(404)).body.code).toBe('PPL_SET_NOT_FOUND');
    expect((await buyer.get('/api/ppl/resolve?version=abc').expect(400)).body.code).toBe('VALIDATION_FAILED');
  });

  it('权限：查看与管理分别需要 system:ppl:view / manage，resolve 需要 inquiry:view；供应商一律 403', async () => {
    await buyer.get('/api/ppl/sets').expect(403);
    await buyer.get('/api/ppl/sets/1').expect(403);
    await buyer.post('/api/ppl/sets').send({ label: 'x', definition: PPL_V0 }).expect(403);
    await buyer.post('/api/ppl/sets/1/activate').expect(403);
    await portal.get('/api/ppl/sets').expect(403);
    await portal.get('/api/ppl/resolve').expect(403);
    await admin.get('/api/ppl/resolve').expect(200);
  });
});
