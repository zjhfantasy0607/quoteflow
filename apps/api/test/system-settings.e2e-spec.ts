import { SequenceService } from '../src/infra/sequences/sequence.service';
import { Agent, anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

describe('M02 数据字典、系统参数、编号、操作日志', () => {
  let ctx: TestContext;
  let admin: Agent;
  let buyer: Agent;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    admin = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['ADMIN'] }));
    buyer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('数据字典', () => {
    it('字典类型列表包含系统类型与字典项数量', async () => {
      const res = await admin.get('/api/system/dict-types').expect(200);
      const unit = res.body.find((t: { code: string }) => t.code === 'unit');
      expect(unit).toMatchObject({ isSystem: true, itemCount: 7 });
    });

    it('R02-1 系统字典类型不能删除，系统字典项不能删除只能停用', async () => {
      const delType = await admin.delete('/api/system/dict-types/unit').expect(409);
      expect(delType.body.code).toBe('DICT_TYPE_SYSTEM');
      const items = (await admin.get('/api/system/dict-types/unit/items').expect(200)).body;
      const pcs = items.find((i: { code: string }) => i.code === 'PCS');
      const delItem = await admin.delete(`/api/system/dict-items/${pcs.id}`).expect(409);
      expect(delItem.body.code).toBe('DICT_TYPE_SYSTEM');
    });

    it('R02-2 新增和停用立即生效：/api/dicts 只返回启用项', async () => {
      const created = await admin
        .post('/api/system/dict-types/unit/items')
        .send({ code: 'PAIR', nameZh: '对', nameEn: 'pair', sort: 20 })
        .expect(201);
      let dicts = (await buyer.get('/api/dicts?types=unit').expect(200)).body;
      expect(dicts.unit.map((i: { code: string }) => i.code)).toContain('PAIR');

      await admin
        .put(`/api/system/dict-items/${created.body.id}`)
        .send({ nameZh: '对', nameEn: 'pair', sort: 20, status: 'DISABLED' })
        .expect(200);
      dicts = (await buyer.get('/api/dicts?types=unit').expect(200)).body;
      expect(dicts.unit.map((i: { code: string }) => i.code)).not.toContain('PAIR');

      const dup = await admin
        .post('/api/system/dict-types/unit/items')
        .send({ code: 'PAIR', nameZh: '对', nameEn: 'pair' })
        .expect(409);
      expect(dup.body.code).toBe('DICT_ITEM_CODE_TAKEN');
    });

    it('自定义字典类型可以新建、改名、连同字典项删除', async () => {
      await admin.post('/api/system/dict-types').send({ code: 'color', nameZh: '颜色', nameEn: 'Color' }).expect(201);
      await admin.post('/api/system/dict-types/color/items').send({ code: 'RED', nameZh: '红', nameEn: 'Red' }).expect(201);
      await admin.put('/api/system/dict-types/color').send({ nameZh: '颜色2', nameEn: 'Colour' }).expect(200);
      await admin.delete('/api/system/dict-types/color').expect(200);
      await admin.get('/api/system/dict-types/color/items').expect(404);
    });

    it('没有 system:dict:manage 不能维护字典', async () => {
      await buyer.get('/api/system/dict-types').expect(403);
      await buyer.post('/api/system/dict-types/unit/items').send({ code: 'X', nameZh: 'x', nameEn: 'x' }).expect(403);
    });
  });

  describe('系统参数', () => {
    it('列表返回全部参数与默认值', async () => {
      const res = await admin.get('/api/system/params').expect(200);
      expect(res.body.map((p: { key: string }) => p.key)).toContain('seal.preOpenViewRoles');
      const hours = res.body.find((p: { key: string }) => p.key === 'security.sessionHours');
      expect(hours).toMatchObject({ value: 12, defaultValue: 12, updatedAt: null });
    });

    it('R02-3 非法值被拒，未知 key 返回 404，密封授权角色必须存在', async () => {
      const bad = await admin.put('/api/system/params/inquiry.minDeadlineHours').send({ value: -1 }).expect(400);
      expect(bad.body.code).toBe('PARAM_INVALID');
      await admin.put('/api/system/params/nope').send({ value: 1 }).expect(404);
      const role = await admin.put('/api/system/params/seal.preOpenViewRoles').send({ value: ['NO_SUCH_ROLE'] }).expect(400);
      expect(role.body.code).toBe('PARAM_INVALID');
    });

    it('R02-2 修改后立即生效并记审计；公共配置未登录也能取', async () => {
      await admin
        .put('/api/system/params/company.profile')
        .send({ value: { nameZh: '测试照明', nameEn: 'Test Lighting', address: '', phone: '' } })
        .expect(200);
      const pub = await anonymous(ctx).get('/api/public/app-config').expect(200);
      expect(pub.body.company.nameZh).toBe('测试照明');
      expect(pub.body.uploadLimits.imagesPerLine).toBe(10);
      const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'param.update', entityId: 'company.profile' } });
      expect(log).not.toBeNull();
    });

    it('没有 system:param:manage 不能看参数', async () => {
      await buyer.get('/api/system/params').expect(403);
    });
  });

  describe('业务编号', () => {
    it('R02-10 并发取号不重复，格式正确，按 UTC+8 的日/月计数', async () => {
      const seq = ctx.app.get(SequenceService);
      const now = new Date('2026-10-31T17:30:00.000Z'); // 北京时间 11-01 01:30
      const nos = await Promise.all(Array.from({ length: 20 }, () => seq.formalNo(now)));
      expect(new Set(nos).size).toBe(20);
      expect(nos.every((n) => /^RFQ-202611-\d{4}$/.test(n))).toBe(true);
      expect(await seq.draftNo(now)).toMatch(/^DR-20261101-0001$/);
      expect(await seq.contractNo(now)).toBe('CT-202611-0001');
      expect(await seq.materialCode()).toBe('MAT-000001');
      expect(await seq.supplierCode()).toBe('SUP10001');
      await seq.ensureAtLeast('SUP', 10);
      expect(await seq.supplierCode()).toBe('SUP10011');
    });
  });

  describe('操作日志', () => {
    it('R02-12 可按动作和对象筛选', async () => {
      const res = await admin.get('/api/system/audit-logs').query({ action: 'param.update' }).expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0]).toMatchObject({ action: 'param.update', actor: { name: expect.any(String) } });
      await buyer.get('/api/system/audit-logs').expect(403);
    });
  });
});
