import { seedMaterialCategories, seedMaterials } from '../prisma/seed-data/materials';
import { isForeignKeyViolation } from '../src/common/errors/prisma-errors';
import type { MaterialCategory, User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createCategory, createMaterial, createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

interface Node {
  id: string;
  code: string;
  parentId: string | null;
  status: string;
  effectiveEnabled: boolean;
  isPreset: boolean;
  materialCount: number;
  pplVariantCode: string | null;
  children: Node[];
}

function findNode(nodes: Node[], code: string): Node | undefined {
  for (const n of nodes) {
    if (n.code === code) return n;
    const found = findNode(n.children, code);
    if (found) return found;
  }
  return undefined;
}

const codes = (nodes: Node[]) => nodes.map((n) => n.code);

describe('M03 材料分类', () => {
  let ctx: TestContext;
  let admin: Agent;
  let buyer: Agent;
  let approver: Agent;
  let adminUser: User;

  async function tree(agent: Agent = buyer, includeDisabled = true): Promise<Node[]> {
    return (await agent.get(`/api/material-categories/tree?includeDisabled=${includeDisabled}`).expect(200)).body;
  }

  async function categoryId(code: string): Promise<string> {
    return (await ctx.prisma.materialCategory.findUniqueOrThrow({ where: { code } })).id;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await seedMaterials(ctx.prisma);
    adminUser = await createUser(ctx.prisma, { roles: ['ADMIN'] });
    admin = await loginAs(ctx, adminUser);
    buyer = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['BUYER'] }));
    approver = await loginAs(ctx, await createUser(ctx.prisma, { roles: ['CONTRACT_APPROVER'] }));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('预置的灯珠、灯外设分类树完整显示，同级按排序号，节点带有效启用和材料数', async () => {
    const nodes = await tree();
    expect(codes(nodes)).toEqual(['LED', 'PER']);
    const [led, per] = nodes;
    expect(codes(led.children)).toEqual(['LED-2835', 'LED-3030', 'LED-COB']);
    expect(codes(per.children)).toEqual([
      'PER-LENS',
      'PER-REFL',
      'PER-BRKT',
      'PER-DRV',
      'PER-HS',
      'PER-CONN',
      'PER-WIRE',
      'PER-OTHER',
    ]);
    expect(codes(findNode(nodes, 'PER-DRV')!.children)).toEqual(['DRV-CC', 'DRV-CV']);
    expect(led).toMatchObject({ isPreset: true, effectiveEnabled: true, pplVariantCode: 'PPL-LED', materialCount: 0 });
    expect(findNode(nodes, 'LED-2835')).toMatchObject({ materialCount: 1, pplVariantCode: null });
  });

  describe('R03-1 新建与编辑', () => {
    let top: MaterialCategory;

    it('R03-1 可以建三级分类，编码转大写，新建的不是预置分类', async () => {
      const a = await admin
        .post('/api/material-categories')
        .send({ code: 'tst-a', nameZh: '测试 A', nameEn: 'Test A' })
        .expect(201);
      expect(a.body).toMatchObject({ code: 'TST-A', parentId: null, isPreset: false, effectiveEnabled: true, materialCount: 0 });
      const a1 = await admin
        .post('/api/material-categories')
        .send({ parentId: a.body.id, code: 'TST-A1', nameZh: '测试 A1', nameEn: 'Test A1', sort: 2 })
        .expect(201);
      await admin
        .post('/api/material-categories')
        .send({ parentId: a1.body.id, code: 'TST-A1X', nameZh: '测试 A1X', nameEn: 'Test A1X' })
        .expect(201);
      const node = findNode(await tree(), 'TST-A')!;
      expect(codes(node.children)).toEqual(['TST-A1']);
      expect(codes(node.children[0].children)).toEqual(['TST-A1X']);
      top = await ctx.prisma.materialCategory.findUniqueOrThrow({ where: { code: 'TST-A' } });
    });

    it('R03-1 编码唯一、只能是大写字母数字和连字符，中英文名称必填，上级必须存在', async () => {
      const dup = await admin
        .post('/api/material-categories')
        .send({ code: 'TST-A', nameZh: '重复', nameEn: 'Dup' })
        .expect(409);
      expect(dup.body.code).toBe('CATEGORY_CODE_TAKEN');
      await admin.post('/api/material-categories').send({ code: 'TST_B', nameZh: 'b', nameEn: 'b' }).expect(400);
      await admin.post('/api/material-categories').send({ code: 'TST-B', nameZh: 'b', nameEn: ' ' }).expect(400);
      const noParent = await admin
        .post('/api/material-categories')
        .send({ parentId: 'nope', code: 'TST-B', nameZh: 'b', nameEn: 'b' })
        .expect(400);
      expect(noParent.body).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'parentId', code: 'not_found' }] });
    });

    it('R03-1 编辑只改名称、排序、备注，编码和上级不能改', async () => {
      const other = await categoryId('LED');
      const res = await admin
        .put(`/api/material-categories/${top.id}`)
        .send({ nameZh: '测试 A2', nameEn: 'Test A2', sort: 3, remark: '备注', code: 'HACK', parentId: other })
        .expect(200);
      expect(res.body).toMatchObject({ code: 'TST-A', parentId: null, nameZh: '测试 A2', sort: 3, remark: '备注' });
      await admin.put('/api/material-categories/nope').send({ nameZh: 'x', nameEn: 'x' }).expect(404);
    });

    it('PPL 变体：接口接受 pplVariantCode，不传时不修改，传空或 null 时清除', async () => {
      const set = await admin
        .put(`/api/material-categories/${top.id}`)
        .send({ nameZh: '测试 A2', nameEn: 'Test A2', pplVariantCode: 'ppl-test' })
        .expect(200);
      expect(set.body.pplVariantCode).toBe('PPL-TEST');
      const keep = await admin.put(`/api/material-categories/${top.id}`).send({ nameZh: '测试 A2', nameEn: 'Test A2' }).expect(200);
      expect(keep.body.pplVariantCode).toBe('PPL-TEST');
      const clear = await admin
        .put(`/api/material-categories/${top.id}`)
        .send({ nameZh: '测试 A2', nameEn: 'Test A2', pplVariantCode: null })
        .expect(200);
      expect(clear.body.pplVariantCode).toBeNull();
    });
  });

  describe('R03-2 启停用', () => {
    it('R03-2 停用中间节点后，它和全部下级都不能被新选用；已有材料照常显示', async () => {
      const a1 = await categoryId('TST-A1');
      const a1x = await categoryId('TST-A1X');
      const existing = await createMaterial(ctx.prisma, { categoryId: a1x, code: 'TST-M1' });

      const disabled = await admin.put(`/api/material-categories/${a1}/status`).send({ status: 'DISABLED' }).expect(200);
      expect(disabled.body).toMatchObject({ status: 'DISABLED', effectiveEnabled: false });

      const all = await tree();
      expect(findNode(all, 'TST-A')).toMatchObject({ effectiveEnabled: true });
      expect(findNode(all, 'TST-A1X')).toMatchObject({ status: 'ENABLED', effectiveEnabled: false, materialCount: 1 });
      // 默认（includeDisabled=false）连同下级一起去掉
      const enabledOnly = (await buyer.get('/api/material-categories/tree').expect(200)).body as Node[];
      expect(findNode(enabledOnly, 'TST-A')!.children).toEqual([]);
      expect(findNode(enabledOnly, 'TST-A1X')).toBeUndefined();

      const material = { nameZh: '新材料', spec: 'S', unitCode: 'PCS' };
      for (const id of [a1, a1x]) {
        const res = await buyer.post('/api/materials').send({ ...material, categoryId: id }).expect(409);
        expect(res.body.code).toBe('CATEGORY_DISABLED');
      }
      const child = await admin
        .post('/api/material-categories')
        .send({ parentId: a1x, code: 'TST-A1XX', nameZh: 'x', nameEn: 'x' })
        .expect(409);
      expect(child.body.code).toBe('CATEGORY_DISABLED');

      // 已有数据照常显示和编辑（不改分类时允许）
      const shown = await buyer.get(`/api/materials/${existing.id}`).expect(200);
      expect(shown.body.category).toMatchObject({ code: 'TST-A1X', effectiveEnabled: false });
      await buyer
        .put(`/api/materials/${existing.id}`)
        .send({ nameZh: '改名', spec: 'S', unitCode: 'PCS', categoryId: a1x })
        .expect(200);
      const moved = await buyer
        .put(`/api/materials/${existing.id}`)
        .send({ nameZh: '改名', spec: 'S', unitCode: 'PCS', categoryId: a1 })
        .expect(409);
      expect(moved.body.code).toBe('CATEGORY_DISABLED');

      await admin.put(`/api/material-categories/${a1}/status`).send({ status: 'ENABLED' }).expect(200);
      expect(findNode(await tree(), 'TST-A1X')).toMatchObject({ effectiveEnabled: true });
      await buyer.post('/api/materials').send({ ...material, categoryId: a1x, code: 'TST-M2' }).expect(201);
    });
  });

  describe('R03-3 删除', () => {
    it('R03-3 有下级的分类不能删除', async () => {
      const res = await admin.delete(`/api/material-categories/${await categoryId('TST-A')}`).expect(409);
      expect(res.body.code).toBe('CATEGORY_HAS_CHILDREN');
    });

    it('R03-3 有材料的分类不能删除', async () => {
      const res = await admin.delete(`/api/material-categories/${await categoryId('TST-A1X')}`).expect(409);
      expect(res.body).toMatchObject({ code: 'CATEGORY_IN_USE', params: { materials: 2 } });
    });

    it('R03-3 被供应商主营分类、询价单、询价行引用的分类不能删除', async () => {
      const bySupplier = await createCategory(ctx.prisma, { code: 'TST-SUP' });
      await ctx.prisma.supplier.create({
        data: {
          code: 'SUP90001',
          nameZh: '测试供应商',
          categoryCode: 'NORMAL',
          contactName: 'Tester',
          contactEmail: 'sup@example.com',
          materialCategories: { create: [{ categoryId: bySupplier.id }] },
        },
      });
      const byInquiry = await createCategory(ctx.prisma, { code: 'TST-INQ' });
      const byLine = await createCategory(ctx.prisma, { code: 'TST-LINE' });
      await ctx.prisma.inquiry.create({
        data: {
          draftNo: 'DR-TEST-0001',
          projectNo: 'PJ-TEST',
          title: '测试询价',
          materialCategoryId: byInquiry.id,
          ownerId: adminUser.id,
          createdById: adminUser.id,
          rounds: {
            create: [
              {
                roundNo: 1,
                createdById: adminUser.id,
                lines: {
                  create: [{ lineNo: 1, categoryId: byLine.id, nameZh: '行', spec: 'S', unitCode: 'PCS', quantity: '1' }],
                },
              },
            ],
          },
        },
      });

      for (const [category, key] of [
        [bySupplier, 'suppliers'],
        [byInquiry, 'inquiries'],
        [byLine, 'inquiryLines'],
      ] as const) {
        const res = await admin.delete(`/api/material-categories/${category.id}`).expect(409);
        expect(res.body).toMatchObject({ code: 'CATEGORY_IN_USE', params: { [key]: 1 } });
      }
    });

    it('R03-3 预置分类也遵守同样的规则：有下级、有材料的不能删，没有引用的可以删', async () => {
      expect((await admin.delete(`/api/material-categories/${await categoryId('LED')}`).expect(409)).body.code).toBe(
        'CATEGORY_HAS_CHILDREN',
      );
      expect((await admin.delete(`/api/material-categories/${await categoryId('LED-2835')}`).expect(409)).body.code).toBe(
        'CATEGORY_IN_USE',
      );
      const other = await categoryId('PER-OTHER');
      await admin.delete(`/api/material-categories/${other}`).expect(200);
      expect(findNode(await tree(), 'PER-OTHER')).toBeUndefined();
      await admin.delete(`/api/material-categories/${other}`).expect(404);
    });

    it('R03-3 数据库兜底：绕过接口直接删除有下级或被引用的分类会被外键拒绝', async () => {
      for (const code of ['TST-A', 'TST-SUP', 'TST-A1X']) {
        const err = await ctx.prisma.materialCategory.delete({ where: { code } }).catch((e: unknown) => e);
        expect(isForeignKeyViolation(err)).toBe(true);
      }
      expect(await ctx.prisma.supplierMaterialCategory.count()).toBe(1);
    });
  });

  it('R03-9 分类的新建、编辑、启停用、删除都记审计', async () => {
    const logs = await ctx.prisma.auditLog.findMany({ where: { entityType: 'materialCategory' } });
    const actions = new Set(logs.map((l) => l.action));
    for (const action of ['create', 'update', 'disable', 'enable', 'delete']) {
      expect(actions).toContain(`materialCategory.${action}`);
    }
    const rename = logs.find(
      (l) => l.action === 'materialCategory.update' && (l.detail as Record<string, unknown> | null)?.nameZh,
    );
    expect(rename?.detail).toMatchObject({ nameZh: ['测试 A', '测试 A2'], sort: [0, 3], remark: [null, '备注'] });
  });

  it('没有 material:category:manage 只能查看分类树；没有 material:view 不能查看', async () => {
    const id = await categoryId('TST-A');
    await buyer.post('/api/material-categories').send({ code: 'TST-X', nameZh: 'x', nameEn: 'x' }).expect(403);
    await buyer.put(`/api/material-categories/${id}`).send({ nameZh: 'x', nameEn: 'x' }).expect(403);
    await buyer.put(`/api/material-categories/${id}/status`).send({ status: 'DISABLED' }).expect(403);
    await buyer.delete(`/api/material-categories/${id}`).expect(403);
    await approver.get('/api/material-categories/tree').expect(403);
  });
});
