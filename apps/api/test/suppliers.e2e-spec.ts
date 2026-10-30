import { seedMaterialCategories } from '../prisma/seed-data/materials';
import { seedSuppliers } from '../prisma/seed-data/suppliers';
import { hashPassword } from '../src/common/auth/password';
import { Agent, anonymous, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase, TEST_PASSWORD } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

describe('M04 供应商', () => {
  let ctx: TestContext;
  let admin: Agent;
  let buyer: Agent;
  let manager: Agent;
  let pd: Agent;
  /** 有 supplier:view、supplier:export，没有 supplier.contact 字段权限 */
  let viewer: Agent;
  let category: Record<string, string>;
  let supplierId: Record<string, string>;

  const body = (extra: Record<string, unknown> = {}) => ({
    nameZh: '测试光电有限公司',
    nameEn: 'Test Optoelectronics Co., Ltd.',
    categoryCode: 'EXCELLENT',
    materialCategoryIds: [category['LED-2835']],
    contactName: '王经理',
    contactEmail: 'wang@test-opto.example.com',
    contactPhone: '0755-1234 5678',
    preferredLanguage: 'zh-CN',
    ...extra,
  });

  async function codes(agent: Agent, query: Record<string, string>): Promise<string[]> {
    const res = await agent
      .get('/api/suppliers')
      .query({ pageSize: '100', ...query })
      .expect(200);
    return res.body.items.map((s: { code: string }) => s.code);
  }

  async function auditActions(entityId: string): Promise<string[]> {
    const rows = await ctx.prisma.auditLog.findMany({
      where: { entityId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => r.action);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await seedSuppliers(ctx.prisma, hashPassword);
    category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    supplierId = Object.fromEntries((await ctx.prisma.supplier.findMany()).map((s) => [s.code, s.id]));
    await ctx.prisma.role.create({
      data: {
        code: 'SUPPLIER_VIEWER',
        nameZh: '供应商查看',
        nameEn: 'Supplier viewer',
        dataScope: 'SELF',
        permissions: ['supplier:view', 'supplier:export'],
        fieldPermissions: [],
      },
    });
    admin = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['ADMIN'] }));
    buyer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
    manager = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['PURCHASE_MANAGER'] }));
    pd = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['PD'] }));
    viewer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['SUPPLIER_VIEWER'] }));
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('R04-5 列表筛选（种子数据）', () => {
    it('按编码排序，带分类、主营分类和语言', async () => {
      const res = await buyer.get('/api/suppliers').expect(200);
      expect(res.body.total).toBe(8);
      expect(res.body.items[0]).toMatchObject({
        code: 'SUP10001',
        nameEn: 'Shenzhen Huaxin Optoelectronics Co., Ltd.',
        categoryCode: 'STRATEGIC',
        materialCategories: [{ code: 'LED', nameZh: '灯珠', effectiveEnabled: true }],
        contactEmail: 'sales@huaxin.example.com',
        creditCode: '91440300MA5HX00001',
        preferredLanguage: 'zh-CN',
        status: 'ENABLED',
      });
      expect(res.body.items[0]).not.toHaveProperty('maskedFields');
      const sup3 = res.body.items.find((s: { code: string }) => s.code === 'SUP10003');
      expect(sup3.materialCategories.map((c: { code: string }) => c.code)).toEqual(['PER-BRKT', 'PER-HS']);
    });

    it('R04-5 按分类过滤，可多选（战略 / 优秀 / 普通）', async () => {
      expect(await codes(buyer, { categoryCodes: 'STRATEGIC' })).toEqual(['SUP10001', 'SUP10005']);
      expect(await codes(buyer, { categoryCodes: 'STRATEGIC,EXCELLENT' })).toEqual([
        'SUP10001',
        'SUP10002',
        'SUP10003',
        'SUP10005',
        'SUP10006',
      ]);
      expect(await codes(buyer, { categoryCodes: 'NORMAL' })).toEqual(['SUP10004', 'SUP10007', 'SUP10008']);
    });

    it('R04-5 按主营材料分类过滤，包含下级', async () => {
      expect(await codes(buyer, { materialCategoryId: category['PER-DRV'] })).toEqual([
        'SUP10002',
        'SUP10006',
        'SUP10008',
      ]);
      // 主营分类是下级（恒流电源）的供应商也在"驱动电源"下面
      const sub = await createSupplier(ctx.prisma, {
        code: 'TS-DRVCC',
        materialCategoryIds: [category['DRV-CC']],
      });
      expect(await codes(buyer, { materialCategoryId: category['PER-DRV'] })).toEqual([
        'SUP10002',
        'SUP10006',
        'SUP10008',
        'TS-DRVCC',
      ]);
      expect(await codes(buyer, { materialCategoryId: category['DRV-CC'] })).toEqual(['TS-DRVCC']);
      expect(await codes(buyer, { materialCategoryId: category.LED })).toEqual(['SUP10001', 'SUP10006']);
      expect(await codes(buyer, { materialCategoryId: 'nope' })).toEqual([]);
      await ctx.prisma.supplier.delete({ where: { id: sub.id } });
    });

    it('R04-5 关键字匹配编码、中英文名称、联系人；按状态过滤；条件可以组合', async () => {
      expect(await codes(buyer, { keyword: 'kevin' })).toEqual(['SUP10006']);
      expect(await codes(buyer, { keyword: 'HUAXIN' })).toEqual(['SUP10001']);
      expect(await codes(buyer, { keyword: '联创' })).toEqual(['SUP10005']);
      expect(await codes(buyer, { keyword: 'sup1000' })).toHaveLength(8);
      expect(await codes(buyer, { status: 'DISABLED' })).toEqual(['SUP10007']);
      expect(await codes(buyer, { categoryCodes: 'NORMAL', status: 'ENABLED' })).toEqual([
        'SUP10004',
        'SUP10008',
      ]);
      await buyer.get('/api/suppliers').query({ status: 'ACTIVE' }).expect(400);
    });
  });

  describe('R04-1 ~ R04-4 新建与编辑', () => {
    it('R04-2 编码留空时自动生成，接着种子数据的 SUP10008；手填编码转大写，重复被拒；自动编码跳过已占用的号', async () => {
      const first = await buyer.post('/api/suppliers').send(body()).expect(201);
      expect(first.body).toMatchObject({
        code: 'SUP10009',
        nameZh: '测试光电有限公司',
        categoryCode: 'EXCELLENT',
        materialCategories: [{ code: 'LED-2835', nameEn: '2835 SMD LED' }],
        contactEmail: 'wang@test-opto.example.com',
        ccEmails: [],
        preferredLanguage: 'zh-CN',
        status: 'ENABLED',
        creditCode: null,
      });
      const manual = await buyer
        .post('/api/suppliers')
        .send(body({ code: ' sup10010 ' }))
        .expect(201);
      expect(manual.body.code).toBe('SUP10010');
      const dup = await buyer
        .post('/api/suppliers')
        .send(body({ code: 'SUP10010' }))
        .expect(409);
      expect(dup.body.code).toBe('SUPPLIER_CODE_TAKEN');
      await buyer
        .post('/api/suppliers')
        .send(body({ code: 'BAD CODE' }))
        .expect(400);
      const auto = await buyer.post('/api/suppliers').send(body()).expect(201);
      expect(auto.body.code).toBe('SUP10011');
      expect(await auditActions(auto.body.id)).toEqual(['supplier.create']);
    });

    it('R04-1 分类必填，必须是启用的 supplier_category 字典项', async () => {
      const missing = await buyer
        .post('/api/suppliers')
        .send(body({ categoryCode: '' }))
        .expect(400);
      expect(missing.body.code).toBe('VALIDATION_FAILED');
      const unknown = await buyer
        .post('/api/suppliers')
        .send(body({ categoryCode: 'VIP' }))
        .expect(400);
      expect(unknown.body).toMatchObject({
        code: 'DICT_ITEM_INVALID',
        params: { type: 'supplier_category', code: 'VIP' },
      });
      // 别的字典的编码也不行
      await buyer
        .post('/api/suppliers')
        .send(body({ categoryCode: 'PCS' }))
        .expect(400);

      const normal = { typeCode_code: { typeCode: 'supplier_category', code: 'NORMAL' } };
      await ctx.prisma.dictItem.update({ where: normal, data: { status: 'DISABLED' } });
      const disabled = await buyer
        .post('/api/suppliers')
        .send(body({ categoryCode: 'NORMAL' }))
        .expect(400);
      expect(disabled.body.code).toBe('DICT_ITEM_INVALID');
      // 已经是停用分类的供应商，编辑时不改分类可以保存
      const res = await buyer
        .put(`/api/suppliers/${supplierId.SUP10004}`)
        .send(body({ categoryCode: 'NORMAL', nameZh: '浙江精工制造有限公司', materialCategoryIds: [] }))
        .expect(200);
      expect(res.body.categoryCode).toBe('NORMAL');
      await ctx.prisma.dictItem.update({ where: normal, data: { status: 'ENABLED' } });
    });

    it('R04-2 信用代码可空；填写时必须是 18 位字母或数字（自动转大写），且唯一', async () => {
      const bad = await buyer
        .post('/api/suppliers')
        .send(body({ creditCode: '9144' }))
        .expect(400);
      expect(bad.body.details[0].path).toBe('creditCode');
      const taken = await buyer
        .post('/api/suppliers')
        .send(body({ creditCode: '91440300MA5HX00001' }))
        .expect(409);
      expect(taken.body.code).toBe('SUPPLIER_CREDIT_CODE_TAKEN');
      const created = await buyer
        .post('/api/suppliers')
        .send(body({ creditCode: '91440300ma5hx09999' }))
        .expect(201);
      expect(created.body.creditCode).toBe('91440300MA5HX09999');
      const moved = await buyer
        .put(`/api/suppliers/${created.body.id}`)
        .send(body({ creditCode: '91310000MA1ZY00002' }))
        .expect(409);
      expect(moved.body.code).toBe('SUPPLIER_CREDIT_CODE_TAKEN');
      const cleared = await buyer
        .put(`/api/suppliers/${created.body.id}`)
        .send(body({ creditCode: '' }))
        .expect(200);
      expect(cleared.body.creditCode).toBeNull();
    });

    it('R04-3 联系人、联系邮箱必填；抄送邮箱最多 5 个；首选语言为 zh-CN / en-US / bilingual', async () => {
      for (const key of ['contactName', 'contactEmail', 'nameZh']) {
        const res = await buyer
          .post('/api/suppliers')
          .send(body({ [key]: '' }))
          .expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      await buyer
        .post('/api/suppliers')
        .send(body({ contactEmail: 'not-an-email' }))
        .expect(400);
      const six = Array.from({ length: 6 }, (_, i) => `cc${i}@example.com`);
      await buyer
        .post('/api/suppliers')
        .send(body({ ccEmails: six }))
        .expect(400);
      await buyer
        .post('/api/suppliers')
        .send(body({ preferredLanguage: 'fr-FR' }))
        .expect(400);

      const res = await buyer
        .post('/api/suppliers')
        .send(
          body({
            contactEmail: 'Wang@Test-Opto.Example.com',
            ccEmails: ['A@x.example.com', 'b@x.example.com'],
            preferredLanguage: 'bilingual',
          }),
        )
        .expect(201);
      expect(res.body).toMatchObject({
        contactEmail: 'wang@test-opto.example.com',
        ccEmails: ['a@x.example.com', 'b@x.example.com'],
        preferredLanguage: 'bilingual',
      });
    });

    it('R04-4 主营材料分类可多选，只能选有效启用的分类；编辑时原有的停用分类可以保留', async () => {
      const multi = await buyer
        .post('/api/suppliers')
        .send(
          body({ materialCategoryIds: [category['PER-LENS'], category['PER-REFL'], category['PER-LENS']] }),
        )
        .expect(201);
      expect(multi.body.materialCategories.map((c: { code: string }) => c.code)).toEqual([
        'PER-LENS',
        'PER-REFL',
      ]);

      const unknown = await buyer
        .post('/api/suppliers')
        .send(body({ materialCategoryIds: [category.LED, 'nope'] }))
        .expect(400);
      expect(unknown.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'materialCategoryIds.1', code: 'not_found' }],
      });

      await ctx.prisma.materialCategory.update({
        where: { id: category['PER-DRV'] },
        data: { status: 'DISABLED' },
      });
      const disabled = await buyer
        .post('/api/suppliers')
        .send(body({ materialCategoryIds: [category['PER-DRV']] }))
        .expect(409);
      expect(disabled.body).toMatchObject({ code: 'CATEGORY_DISABLED', params: { code: 'PER-DRV' } });
      // 上级停用，下级也不能选
      await buyer
        .post('/api/suppliers')
        .send(body({ materialCategoryIds: [category['DRV-CC']] }))
        .expect(409);

      // SUP10008 原来就是 PER-DRV：保留可以，再加停用的下级不行
      const keep = { ...body(), nameZh: '北欧驱动方案有限公司', categoryCode: 'NORMAL' };
      const kept = await buyer
        .put(`/api/suppliers/${supplierId.SUP10008}`)
        .send({ ...keep, materialCategoryIds: [category['PER-DRV'], category['PER-HS']] })
        .expect(200);
      expect(kept.body.materialCategories).toEqual([
        expect.objectContaining({ code: 'PER-DRV', effectiveEnabled: false }),
        expect.objectContaining({ code: 'PER-HS', effectiveEnabled: true }),
      ]);
      await buyer
        .put(`/api/suppliers/${supplierId.SUP10008}`)
        .send({ ...keep, materialCategoryIds: [category['PER-DRV'], category['DRV-CV']] })
        .expect(409);
      // 去掉主营分类
      const removed = await buyer
        .put(`/api/suppliers/${supplierId.SUP10008}`)
        .send({ ...keep, materialCategoryIds: [] })
        .expect(200);
      expect(removed.body.materialCategories).toEqual([]);
      await ctx.prisma.materialCategory.update({
        where: { id: category['PER-DRV'] },
        data: { status: 'ENABLED' },
      });
    });

    it('R04-2 编辑不能改编码；不存在的供应商 404', async () => {
      const created = await buyer
        .post('/api/suppliers')
        .send(body({ code: 'TST-EDIT' }))
        .expect(201);
      const res = await buyer
        .put(`/api/suppliers/${created.body.id}`)
        .send({ ...body({ nameZh: '改过的名称', nameEn: '', preferredLanguage: 'en-US' }), code: 'HACKED' })
        .expect(200);
      expect(res.body).toMatchObject({
        code: 'TST-EDIT',
        nameZh: '改过的名称',
        nameEn: null,
        preferredLanguage: 'en-US',
      });
      await buyer.get(`/api/suppliers/${created.body.id}`).expect(200);
      await buyer.get('/api/suppliers/nope').expect(404);
      await buyer.put('/api/suppliers/nope').send(body()).expect(404);
      await buyer.put('/api/suppliers/nope/status').send({ status: 'DISABLED' }).expect(404);
    });

    it('权限：新建编辑需要 supplier:manage；PD 看不到供应商；供应商用户访问内部接口 403', async () => {
      await viewer.post('/api/suppliers').send(body()).expect(403);
      await viewer
        .put(`/api/suppliers/${supplierId.SUP10001}/status`)
        .send({ status: 'DISABLED' })
        .expect(403);
      await pd.get('/api/suppliers').expect(403);
      await pd.get(`/api/suppliers/${supplierId.SUP10001}`).expect(403);
      const portal = await loginAs(ctx, { username: 'sales@huaxin.example.com' });
      await portal.get('/api/suppliers').expect(403);
      await portal.get('/api/supplier-categories').expect(403);
      await admin.get('/api/suppliers').expect(200);
    });
  });

  describe('R04-7 联系方式脱敏', () => {
    it('R04-7 没有 supplier.contact 字段权限：列表和详情里的联系电话、联系邮箱、抄送邮箱为 null，并给出 maskedFields', async () => {
      await ctx.prisma.supplier.update({
        where: { id: supplierId.SUP10002 },
        data: { ccEmails: ['cc@zhuoyue.example.com'] },
      });
      const list = await viewer.get('/api/suppliers').query({ keyword: 'SUP10002' }).expect(200);
      const detail = await viewer.get(`/api/suppliers/${supplierId.SUP10002}`).expect(200);
      for (const s of [list.body.items[0], detail.body]) {
        expect(s).toMatchObject({
          code: 'SUP10002',
          contactName: '刘工',
          contactEmail: null,
          contactPhone: null,
          ccEmails: null,
          maskedFields: ['contactEmail', 'contactPhone', 'ccEmails'],
        });
      }
      const full = await buyer.get(`/api/suppliers/${supplierId.SUP10002}`).expect(200);
      expect(full.body).toMatchObject({
        contactEmail: 'bd@zhuoyue.example.com',
        contactPhone: '021-6666 0002',
        ccEmails: ['cc@zhuoyue.example.com'],
      });
      expect(full.body).not.toHaveProperty('maskedFields');
    });
  });

  describe('R04-6 启停用', () => {
    it('R04-6 停用供应商：门户用户的会话立即删除，不能再登录；启用后恢复', async () => {
      const portal = await loginAs(ctx, { username: 'sales@xinneng.example.com' });
      await portal.get('/api/auth/me').expect(200);

      const res = await buyer
        .put(`/api/suppliers/${supplierId.SUP10003}/status`)
        .send({ status: 'DISABLED' })
        .expect(200);
      expect(res.body.status).toBe('DISABLED');
      expect(await ctx.prisma.session.count({ where: { user: { supplierId: supplierId.SUP10003 } } })).toBe(
        0,
      );
      await portal.get('/api/auth/me').expect(401);
      const login = await anonymous(ctx)
        .post('/api/auth/login')
        .send({ username: 'sales@xinneng.example.com', password: TEST_PASSWORD })
        .expect(403);
      expect(login.body.code).toBe('AUTH_ACCOUNT_DISABLED');
      // 其他供应商不受影响
      const other = await loginAs(ctx, { username: 'info@jinggong.example.com' });
      await other.get('/api/auth/me').expect(200);

      await buyer.put(`/api/suppliers/${supplierId.SUP10003}/status`).send({ status: 'ENABLED' }).expect(200);
      await loginAs(ctx, { username: 'sales@xinneng.example.com' });
      expect(await auditActions(supplierId.SUP10003)).toEqual(['supplier.disable', 'supplier.enable']);
    });
  });

  describe('R04-12 审计', () => {
    it('R04-12 编辑记录改了哪些字段；联系方式只记字段名，不记具体值', async () => {
      const created = await buyer
        .post('/api/suppliers')
        .send(body({ code: 'TST-AUDIT' }))
        .expect(201);
      await buyer
        .put(`/api/suppliers/${created.body.id}`)
        .send(
          body({
            nameZh: '审计测试有限公司',
            contactEmail: 'secret.person@test-opto.example.com',
            contactPhone: '139 0000 0000',
            materialCategoryIds: [category['PER-HS'], category.LED],
          }),
        )
        .expect(200);
      const log = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: created.body.id, action: 'supplier.update' },
      });
      expect(log.summary).toBe('TST-AUDIT 审计测试有限公司');
      expect(log.detail).toEqual({
        nameZh: ['测试光电有限公司', '审计测试有限公司'],
        contactChanged: ['contactEmail', 'contactPhone'],
        materialCategories: [['LED-2835'], ['PER-HS', 'LED']],
      });
      expect(JSON.stringify(log.detail)).not.toContain('secret.person');
    });
  });

  describe('R04-9 供应商分类', () => {
    it('R04-9 列出全部分类（含停用），按排序号', async () => {
      const res = await buyer.get('/api/supplier-categories').expect(200);
      expect(res.body.map((c: { code: string }) => c.code)).toEqual(['STRATEGIC', 'EXCELLENT', 'NORMAL']);
      expect(res.body[0]).toMatchObject({
        typeCode: 'supplier_category',
        nameZh: '战略供应商',
        nameEn: 'Strategic',
        status: 'ENABLED',
      });
      await pd.get('/api/supplier-categories').expect(403);
    });

    it('R04-9 新增、改名、排序、停用分类（supplier:category:manage）；停用的分类不能再被新选用', async () => {
      await buyer
        .post('/api/supplier-categories')
        .send({ code: 'POTENTIAL', nameZh: '潜在', nameEn: 'Potential' })
        .expect(403);
      const created = await manager
        .post('/api/supplier-categories')
        .send({ code: 'POTENTIAL', nameZh: '潜在供应商', nameEn: 'Potential', sort: 4 })
        .expect(201);
      expect(created.body).toMatchObject({
        typeCode: 'supplier_category',
        code: 'POTENTIAL',
        status: 'ENABLED',
      });
      const dup = await manager
        .post('/api/supplier-categories')
        .send({ code: 'POTENTIAL', nameZh: 'x', nameEn: 'x' })
        .expect(409);
      expect(dup.body.code).toBe('DICT_ITEM_CODE_TAKEN');

      const supplier = await buyer
        .post('/api/suppliers')
        .send(body({ categoryCode: 'POTENTIAL' }))
        .expect(201);

      const renamed = await manager
        .put(`/api/supplier-categories/${created.body.id}`)
        .send({ nameZh: '潜力供应商', nameEn: 'Prospective', sort: 0, status: 'DISABLED' })
        .expect(200);
      expect(renamed.body).toMatchObject({
        code: 'POTENTIAL',
        nameZh: '潜力供应商',
        sort: 0,
        status: 'DISABLED',
      });
      const list = await buyer.get('/api/supplier-categories').expect(200);
      expect(list.body.map((c: { code: string }) => c.code)).toEqual([
        'POTENTIAL',
        'STRATEGIC',
        'EXCELLENT',
        'NORMAL',
      ]);

      await buyer
        .post('/api/suppliers')
        .send(body({ categoryCode: 'POTENTIAL' }))
        .expect(400);
      // 已经用了这个分类的供应商照常显示、照常编辑
      await buyer.get(`/api/suppliers/${supplier.body.id}`).expect(200);
      await buyer
        .put(`/api/suppliers/${supplier.body.id}`)
        .send(body({ categoryCode: 'POTENTIAL' }))
        .expect(200);
      expect(await codes(buyer, { categoryCodes: 'POTENTIAL' })).toEqual([supplier.body.code]);
    });

    it('R04-9 预置的三个分类不可删除；只能改供应商分类，不能借这个接口改别的字典', async () => {
      const strategic = await ctx.prisma.dictItem.findUniqueOrThrow({
        where: { typeCode_code: { typeCode: 'supplier_category', code: 'STRATEGIC' } },
      });
      await manager.delete(`/api/supplier-categories/${strategic.id}`).expect(404);
      const viaDict = await admin.delete(`/api/system/dict-items/${strategic.id}`).expect(409);
      expect(viaDict.body.code).toBe('DICT_TYPE_SYSTEM');

      const unit = await ctx.prisma.dictItem.findUniqueOrThrow({
        where: { typeCode_code: { typeCode: 'unit', code: 'PCS' } },
      });
      await manager
        .put(`/api/supplier-categories/${unit.id}`)
        .send({ nameZh: '个', nameEn: 'pcs', sort: 1, status: 'DISABLED' })
        .expect(404);
      expect((await ctx.prisma.dictItem.findUniqueOrThrow({ where: { id: unit.id } })).status).toBe(
        'ENABLED',
      );
    });
  });
});
