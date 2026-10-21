import { seedMaterialCategories, seedMaterials } from '../prisma/seed-data/materials';
import { AppException } from '../src/common/errors/app.exception';
import type { User } from '../src/generated/prisma/client';
import { FileAccessRegistry } from '../src/infra/files/file-access.registry';
import { MaterialsService } from '../src/modules/materials/materials.service';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

describe('M03 材料库', () => {
  let ctx: TestContext;
  let admin: Agent;
  let buyer: Agent;
  let pd: Agent;
  let approver: Agent;
  let supplier: Agent;
  let category: Record<string, string>;

  const body = (extra: Record<string, unknown> = {}) => ({
    nameZh: '测试灯珠',
    nameEn: 'Test LED',
    spec: '2835 / 0.2W / 3V',
    unitCode: 'PCS',
    categoryId: category['LED-2835'],
    brand: 'Brand',
    ...extra,
  });

  async function upload(agent: Agent, kind: string, file: Buffer, name: string): Promise<string> {
    return (await agent.post('/api/files').field('kind', kind).attach('file', file, name).expect(201)).body.id;
  }

  async function listCodes(query: string): Promise<string[]> {
    const res = await buyer.get(`/api/materials?pageSize=100&${query}`).expect(200);
    return res.body.items.map((m: { code: string }) => m.code);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await seedMaterials(ctx.prisma);
    category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    admin = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['ADMIN'] }));
    buyer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
    pd = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['PD'] }));
    approver = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['CONTRACT_APPROVER'] }));
    const sup = await ctx.prisma.supplier.create({
      data: { code: 'SUP90001', nameZh: '测试供应商', categoryCode: 'NORMAL', contactName: 'T', contactEmail: 's@example.com' },
    });
    const supplierUser: User = await createUser(ctx.prisma, {
      roles: ['SUPPLIER'],
      userType: 'SUPPLIER',
      supplierId: sup.id,
      username: 's@example.com',
      departmentCode: null,
    });
    supplier = await loginAs(ctx, supplierUser);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('R03-4 新建与编辑', () => {
    it('R03-4 编码留空时自动生成并递增（接着种子数据的 MAT-000010）', async () => {
      const first = await buyer.post('/api/materials').send(body()).expect(201);
      expect(first.body).toMatchObject({
        code: 'MAT-000011',
        nameZh: '测试灯珠',
        unitCode: 'PCS',
        status: 'ENABLED',
        image: null,
        category: { code: 'LED-2835', nameEn: '2835 SMD LED', effectiveEnabled: true },
      });
      const second = await buyer.post('/api/materials').send(body({ code: '' })).expect(201);
      expect(second.body.code).toBe('MAT-000012');
    });

    it('R03-4 手填编码去空白转大写；重复编码被拒；自动编码跳过已被手填占用的号', async () => {
      const manual = await buyer.post('/api/materials').send(body({ code: ' mat-000013 ' })).expect(201);
      expect(manual.body.code).toBe('MAT-000013');
      const dup = await buyer.post('/api/materials').send(body({ code: 'MAT-000013' })).expect(409);
      expect(dup.body.code).toBe('MATERIAL_CODE_TAKEN');
      await buyer.post('/api/materials').send(body({ code: 'BAD CODE' })).expect(400);
      const auto = await buyer.post('/api/materials').send(body()).expect(201);
      expect(auto.body.code).toBe('MAT-000014');
    });

    it('R03-4 名称、规格、单位、分类必填；单位必须是启用的 unit 字典项；分类必须存在', async () => {
      for (const key of ['nameZh', 'spec', 'unitCode', 'categoryId']) {
        const res = await buyer.post('/api/materials').send(body({ [key]: '' })).expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      const unknownUnit = await buyer.post('/api/materials').send(body({ unitCode: 'XX' })).expect(400);
      expect(unknownUnit.body).toMatchObject({ code: 'DICT_ITEM_INVALID', params: { type: 'unit', code: 'XX' } });

      await ctx.prisma.dictItem.update({ where: { typeCode_code: { typeCode: 'unit', code: 'BOX' } }, data: { status: 'DISABLED' } });
      const disabledUnit = await buyer.post('/api/materials').send(body({ unitCode: 'BOX' })).expect(400);
      expect(disabledUnit.body.code).toBe('DICT_ITEM_INVALID');

      const noCategory = await buyer.post('/api/materials').send(body({ categoryId: 'nope' })).expect(400);
      expect(noCategory.body).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'categoryId', code: 'not_found' }] });
    });

    it('R03-4 编辑不能改编码；单位只在改动时校验，停用的旧单位可以保留', async () => {
      const created = await buyer.post('/api/materials').send(body({ code: 'TST-BOX' })).expect(201);
      await ctx.prisma.material.update({ where: { id: created.body.id }, data: { unitCode: 'BOX' } }); // BOX 已停用
      const res = await buyer
        .put(`/api/materials/${created.body.id}`)
        .send({ ...body({ unitCode: 'BOX', nameZh: '改过的名称', nameEn: '' }), code: 'HACKED' })
        .expect(200);
      expect(res.body).toMatchObject({ code: 'TST-BOX', nameZh: '改过的名称', nameEn: null, unitCode: 'BOX' });
      const moved = await buyer
        .put(`/api/materials/${created.body.id}`)
        .send(body({ unitCode: 'BOX', categoryId: category['LED-COB'] }))
        .expect(200);
      expect(moved.body.category.code).toBe('LED-COB');
      await buyer.put(`/api/materials/${created.body.id}`).send(body({ unitCode: 'XX' })).expect(400);
      await buyer.put('/api/materials/nope').send(body()).expect(404);
      await ctx.prisma.dictItem.update({ where: { typeCode_code: { typeCode: 'unit', code: 'BOX' } }, data: { status: 'ENABLED' } });
    });
  });

  describe('R03-4 图片', () => {
    it('R03-4 上传 MATERIAL_IMAGE 后挂到材料上：内部用户都能看，供应商不能看', async () => {
      const fileId = await upload(buyer, 'MATERIAL_IMAGE', PNG, '灯珠.png');
      await pd.get(`/api/files/${fileId}/content`).expect(403); // 还没挂上，只有上传者能看

      const created = await buyer.post('/api/materials').send(body({ code: 'TST-IMG', imageFileId: fileId })).expect(201);
      expect(created.body.image).toMatchObject({ id: fileId, originalName: '灯珠.png', kind: 'MATERIAL_IMAGE' });
      const shown = await pd.get(`/api/files/${fileId}/content?disposition=inline`).expect(200);
      expect(shown.headers['content-type']).toBe('image/png');
      const denied = await supplier.get(`/api/files/${fileId}/content`).expect(403);
      expect(denied.body.code).toBe('FILE_ACCESS_DENIED');
      expect(await ctx.app.get(FileAccessRegistry).isReferenced(fileId)).toBe(true);

      // 换图后旧图不再被引用，由清理任务删除；删掉图片
      const next = await upload(buyer, 'MATERIAL_IMAGE', PNG, 'new.png');
      const replaced = await buyer
        .put(`/api/materials/${created.body.id}`)
        .send(body({ imageFileId: next }))
        .expect(200);
      expect(replaced.body.image.id).toBe(next);
      expect(await ctx.app.get(FileAccessRegistry).isReferenced(fileId)).toBe(false);
      const removed = await buyer.put(`/api/materials/${created.body.id}`).send(body({ imageFileId: null })).expect(200);
      expect(removed.body.image).toBeNull();
    });

    it('R03-4 图片只能用自己上传的 MATERIAL_IMAGE 文件', async () => {
      const pdf = await upload(buyer, 'SPEC_DOC', PDF, 'spec.pdf');
      const wrongKind = await buyer.post('/api/materials').send(body({ imageFileId: pdf })).expect(400);
      expect(wrongKind.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
      const others = await upload(admin, 'MATERIAL_IMAGE', PNG, 'admin.png');
      const notMine = await buyer.post('/api/materials').send(body({ imageFileId: others })).expect(403);
      expect(notMine.body.code).toBe('FILE_ACCESS_DENIED');
      const missing = await buyer.post('/api/materials').send(body({ imageFileId: 'nope' })).expect(400);
      expect(missing.body).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'imageFileId' }] });
    });
  });

  it('R03-5 材料可以停用和启用；停用的材料不能被询价行选用', async () => {
    const created = await buyer.post('/api/materials').send(body({ code: 'TST-STATUS' })).expect(201);
    const service = ctx.app.get(MaterialsService);
    await expect(service.assertSelectable(created.body.id)).resolves.toMatchObject({ code: 'TST-STATUS' });

    const disabled = await buyer.put(`/api/materials/${created.body.id}/status`).send({ status: 'DISABLED' }).expect(200);
    expect(disabled.body.status).toBe('DISABLED');
    const err = await service.assertSelectable(created.body.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('MATERIAL_DISABLED');
    expect(await listCodes('status=DISABLED')).toEqual(['TST-STATUS']);

    await buyer.put(`/api/materials/${created.body.id}/status`).send({ status: 'ENABLED' }).expect(200);
    await expect(service.assertSelectable(created.body.id)).resolves.toBeDefined();
    await buyer.put(`/api/materials/${created.body.id}/status`).send({ status: 'OFF' }).expect(400);
  });

  describe('R03-6 列表筛选', () => {
    it('R03-6 按分类筛选包含所有下级分类', async () => {
      expect(await listCodes(`categoryId=${category['PER-DRV']}`)).toEqual(['MAT-000005', 'MAT-000006']);
      const per = await listCodes(`categoryId=${category.PER}`);
      expect(per).toEqual(expect.arrayContaining(['MAT-000003', 'MAT-000005', 'MAT-000010']));
      expect(per).not.toContain('MAT-000001');
      expect(await listCodes(`categoryId=${category['DRV-CC']}`)).toEqual(['MAT-000005']);
      expect(await listCodes('categoryId=nope')).toEqual([]);
    });

    it('R03-6 关键字匹配编码、中英文名称、规格（不区分大小写）', async () => {
      expect(await listCodes('keyword=mat-000007')).toEqual(['MAT-000007']);
      expect(await listCodes(`keyword=${encodeURIComponent('恒流')}`)).toEqual(['MAT-000005']);
      expect(await listCodes(`keyword=${encodeURIComponent('heat sink')}`)).toEqual(['MAT-000007']);
      expect(await listCodes('keyword=ip67')).toEqual(['MAT-000006']);
      expect(await listCodes(`keyword=ip6&categoryId=${category['PER-CONN']}`)).toEqual(['MAT-000008']);
    });

    it('列表分页并按编码排序；详情不存在返回 404', async () => {
      const page = await buyer.get('/api/materials?page=1&pageSize=2').expect(200);
      expect(page.body).toMatchObject({ page: 1, pageSize: 2 });
      expect(page.body.items.map((m: { code: string }) => m.code)).toEqual(['MAT-000001', 'MAT-000002']);
      expect(page.body.total).toBeGreaterThan(10);
      await buyer.get('/api/materials/nope').expect(404);
    });
  });

  it('R03-9 材料的新建、编辑、启停用都记审计', async () => {
    const logs = await ctx.prisma.auditLog.findMany({ where: { entityType: 'material' } });
    const actions = new Set(logs.map((l) => l.action));
    for (const action of ['create', 'update', 'disable', 'enable']) expect(actions).toContain(`material.${action}`);
    const rename = logs.find((l) => l.action === 'material.update' && l.summary?.startsWith('TST-BOX 改过的名称'));
    expect(rename?.detail).toMatchObject({ nameZh: ['测试灯珠', '改过的名称'], nameEn: ['Test LED', null] });
  });

  it('权限：PD 只能查看；没有 material:view 不能查看；供应商不能访问', async () => {
    const id = (await ctx.prisma.material.findUniqueOrThrow({ where: { code: 'MAT-000001' } })).id;
    await pd.get('/api/materials').expect(200);
    await pd.get(`/api/materials/${id}`).expect(200);
    await pd.post('/api/materials').send(body()).expect(403);
    await pd.put(`/api/materials/${id}`).send(body()).expect(403);
    await pd.put(`/api/materials/${id}/status`).send({ status: 'DISABLED' }).expect(403);
    await approver.get('/api/materials').expect(403);
    await supplier.get('/api/materials').expect(403);
  });
});
