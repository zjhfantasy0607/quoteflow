import type { InquiryDetailDto, InquiryLineDto, InquiryRoundDto } from '@quoteflow/shared';
import { seedMaterialCategories, seedMaterials } from '../prisma/seed-data/materials';
import type { User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createCategory, createMaterial, createSupplier, createUser, seedBase } from './helpers/fixtures';
import {
  addManualLine,
  createApprovedInquiry,
  createDraftInquiry,
  manualLineBody,
} from './helpers/inquiries';
import { createTestApp, TestContext } from './helpers/test-app';
import { binaryParser, buildXlsx, loadXlsx, sheetRows } from './helpers/xlsx';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

const SHEET = '询价行 RFQ Lines';
const HEADERS = [
  '物料编码 / Material Code',
  '物料名称 / Material Name',
  '规格型号 / Specification',
  '单位 / Unit',
  '数量 / Quantity',
  '材料分类编码 / Category Code',
  '品牌 / Brand',
  '图纸或规格书编号 / Drawing or Spec No.',
  '备注 / Remark',
];

type Cell = string | number | null;

describe('M06 询价单与审批', () => {
  let ctx: TestContext;
  let users: Record<string, User>;
  /** PD（部门 PRODUCT，数据范围 SELF） */
  let pd: Agent;
  /** 采购员（SELF） */
  let buyer: Agent;
  /** 另一个采购员（SELF），看不到别人的单 */
  let buyer2: Agent;
  /** 采购主管（ALL），审批人 */
  let manager: Agent;
  /** 系统管理员（ALL，只有 inquiry:view） */
  let admin: Agent;
  /** 自定义角色：部门审批人（DEPT），部门 PRODUCT */
  let deptApprover: Agent;
  /** 自定义角色：部门审批人（DEPT），部门 GM，覆盖不到 PD 的单 */
  let gmApprover: Agent;
  let supplier: Agent;
  let category: Record<string, string>;
  let material: Record<string, string>;

  const lineNos = (round: InquiryRoundDto) => round.lines.map((l) => [l.lineNo, l.nameZh]);

  async function roundOf(agent: Agent, id: string): Promise<InquiryRoundDto> {
    return (await agent.get(`/api/inquiries/${id}/rounds/1`).expect(200)).body;
  }

  async function detailOf(agent: Agent, id: string): Promise<InquiryDetailDto> {
    return (await agent.get(`/api/inquiries/${id}`).expect(200)).body;
  }

  async function upload(agent: Agent, kind: string, file: Buffer, name: string): Promise<string> {
    return (await agent.post('/api/files').field('kind', kind).attach('file', file, name).expect(201)).body
      .id;
  }

  async function attach(agent: Agent, id: string, body: Record<string, unknown>, status = 201) {
    return agent.post(`/api/inquiries/${id}/rounds/1/files`).send(body).expect(status);
  }

  async function importLines(agent: Agent, id: string, rows: Cell[][], status: number, header = HEADERS) {
    const file = await buildXlsx(SHEET, header, rows);
    return agent
      .post(`/api/inquiries/${id}/rounds/1/lines/import`)
      .attach('file', file, '询价行.xlsx')
      .expect(status);
  }

  async function approvalMails(inquiryId: string) {
    return ctx.prisma.emailMessage.findMany({
      where: { inquiryId, type: 'APPROVAL' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function timelineActions(agent: Agent, id: string): Promise<string[]> {
    const res = await agent.get(`/api/inquiries/${id}/timeline`).expect(200);
    return res.body.map((r: { action: string }) => r.action);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    await seedMaterials(ctx.prisma);
    category = Object.fromEntries((await ctx.prisma.materialCategory.findMany()).map((c) => [c.code, c.id]));
    material = Object.fromEntries((await ctx.prisma.material.findMany()).map((m) => [m.code, m.id]));
    for (const code of ['DEPT_APPROVER']) {
      await ctx.prisma.role.create({
        data: {
          code,
          nameZh: '部门审批人',
          nameEn: 'Department approver',
          dataScope: 'DEPT',
          permissions: ['inquiry:view', 'inquiry:approve'],
          fieldPermissions: [],
        },
      });
    }
    const mk = (key: string, options: Parameters<typeof createUser>[1]) =>
      createUser(ctx.prisma, { username: key, name: key, ...options });
    users = {
      pd: await mk('pd', { roles: ['PD'], departmentCode: 'PRODUCT', email: 'pd@example.com' }),
      buyer: await mk('buyer', { roles: ['BUYER'], email: 'buyer@example.com' }),
      buyer2: await mk('buyer2', { roles: ['BUYER'], email: 'buyer2@example.com' }),
      manager: await mk('manager', { roles: ['PURCHASE_MANAGER'], email: 'manager@example.com' }),
      manager2: await mk('manager2', {
        roles: ['PURCHASE_MANAGER'],
        email: 'manager2@example.com',
        locale: 'en-US',
      }),
      managerNoMail: await mk('manager.nomail', { roles: ['PURCHASE_MANAGER'], email: null }),
      managerOff: await mk('manager.off', {
        roles: ['PURCHASE_MANAGER'],
        email: 'off@example.com',
        status: 'DISABLED',
      }),
      admin: await mk('admin', { roles: ['ADMIN'], departmentCode: 'IT', email: 'admin@example.com' }),
      deptApprover: await mk('dept', {
        roles: ['DEPT_APPROVER'],
        departmentCode: 'PRODUCT',
        email: 'dept@example.com',
      }),
      gmApprover: await mk('gm', { roles: ['DEPT_APPROVER'], departmentCode: 'GM', email: 'gm@example.com' }),
    };
    pd = await loginAs(ctx, users.pd);
    buyer = await loginAs(ctx, users.buyer);
    buyer2 = await loginAs(ctx, users.buyer2);
    manager = await loginAs(ctx, users.manager);
    admin = await loginAs(ctx, users.admin);
    deptApprover = await loginAs(ctx, users.deptApprover);
    gmApprover = await loginAs(ctx, users.gmApprover);
    const sup = await createSupplier(ctx.prisma, { contactEmail: 'portal@supplier.example.com' });
    supplier = await loginAs(
      ctx,
      await createUser(ctx.prisma, {
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: sup.id,
        username: 'portal@supplier.example.com',
      }),
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('R06-1 建单', () => {
    it('R06-1 生成草稿号 DR-yyyymmdd-nnnn，同时建第 1 轮；负责人默认当前用户，部门取创建人的', async () => {
      const res = await pd
        .post('/api/inquiries')
        .send({
          projectNo: 'PJ-2026-001',
          title: '2835 灯珠年度询价',
          materialCategoryId: category['LED-2835'],
          currency: 'CNY',
          description: '年度框架',
        })
        .expect(201);
      // 测试时钟：2026-11-02 09:00（UTC+8）
      expect(res.body).toMatchObject({
        draftNo: 'DR-20261102-0001',
        formalNo: null,
        projectNo: 'PJ-2026-001',
        title: '2835 灯珠年度询价',
        materialCategory: { code: 'LED-2835', effectiveEnabled: true },
        currency: 'CNY',
        description: '年度框架',
        docStatus: 'DRAFT',
        displayStatus: 'DRAFT',
        currentRoundNo: 1,
        currentRoundStatus: 'DRAFT',
        owner: { id: users.pd.id, name: 'pd' },
        pdUser: null,
        createdBy: { id: users.pd.id, name: 'pd' },
        departmentCode: 'PRODUCT',
        currentRound: { roundNo: 1, status: 'DRAFT', lineCount: 0 },
        allowedActions: ['edit', 'submit'],
      });
      const rounds = await ctx.prisma.inquiryRound.findMany({ where: { inquiryId: res.body.id } });
      expect(rounds.map((r) => [r.roundNo, r.status])).toEqual([[1, 'DRAFT']]);
      expect(await timelineActions(pd, res.body.id)).toEqual(['inquiry.create']);
    });

    it('R06-1 同一项目号可以建多张询价单（#1）', async () => {
      const a = await createDraftInquiry(buyer, category['PER-LENS'], { projectNo: 'PJ-SAME' });
      const b = await createDraftInquiry(buyer, category['PER-REFL'], { projectNo: 'PJ-SAME' });
      expect(a.draftNo).not.toBe(b.draftNo);
      const res = await buyer.get('/api/inquiries').query({ projectNo: 'pj-same' }).expect(200);
      expect(res.body.items.map((i: { id: string }) => i.id).sort()).toEqual([a.id, b.id].sort());
    });

    it('R06-1 必填项、材料类别有效启用、币种字典、负责人与 PD 负责人', async () => {
      const body = { projectNo: 'PJ-X', title: 'T', materialCategoryId: category.LED, currency: 'CNY' };
      const missing = await pd
        .post('/api/inquiries')
        .send({ ...body, title: ' ' })
        .expect(400);
      expect(missing.body.code).toBe('VALIDATION_FAILED');
      await pd
        .post('/api/inquiries')
        .send({ ...body, projectNo: 'P'.repeat(51) })
        .expect(400);

      const off = await createCategory(ctx.prisma, { status: 'DISABLED' });
      const disabled = await pd
        .post('/api/inquiries')
        .send({ ...body, materialCategoryId: off.id })
        .expect(409);
      expect(disabled.body.code).toBe('CATEGORY_DISABLED');
      const currency = await pd
        .post('/api/inquiries')
        .send({ ...body, currency: 'EUR' })
        .expect(400);
      expect(currency.body).toMatchObject({
        code: 'DICT_ITEM_INVALID',
        params: { type: 'currency', code: 'EUR' },
      });

      // 管理员没有 inquiry:create，不能当负责人
      const owner = await pd
        .post('/api/inquiries')
        .send({ ...body, ownerId: users.admin.id })
        .expect(400);
      expect(owner.body.details).toEqual([
        expect.objectContaining({ path: 'ownerId', code: 'invalid_user' }),
      ]);
      const ok = await pd
        .post('/api/inquiries')
        .send({ ...body, ownerId: users.buyer.id, pdUserId: users.pd.id })
        .expect(201);
      expect(ok.body).toMatchObject({ owner: { id: users.buyer.id }, pdUser: { id: users.pd.id } });
    });

    it('负责人候选是启用的、有 inquiry:create 的内部用户', async () => {
      const res = await pd.get('/api/inquiries/user-options').expect(200);
      const names = res.body.map((u: { username: string }) => u.username);
      expect(names).toEqual(expect.arrayContaining(['pd', 'buyer', 'manager']));
      expect(names).not.toContain('admin');
      expect(names).not.toContain('manager.off');
      expect(names).not.toContain('portal@supplier.example.com');
      expect(res.body.find((u: { username: string }) => u.username === 'pd')).toMatchObject({
        departmentCode: 'PRODUCT',
        roleCodes: ['PD'],
      });
      await admin.get('/api/inquiries/user-options').expect(403);
    });

    it('R06-4 草稿可以改表头，记下改了哪些字段', async () => {
      const draft = await createDraftInquiry(pd, category.LED, { title: '旧标题' });
      const res = await pd
        .put(`/api/inquiries/${draft.id}`)
        .send({
          projectNo: draft.projectNo,
          title: '新标题',
          materialCategoryId: category['LED-COB'],
          currency: 'USD',
          ownerId: users.buyer.id,
          pdUserId: users.pd.id,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        title: '新标题',
        materialCategory: { code: 'LED-COB' },
        currency: 'USD',
        owner: { id: users.buyer.id },
        pdUser: { id: users.pd.id },
      });
      const log = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: draft.id, action: 'inquiry.update' },
      });
      expect(Object.keys(log.detail as object).sort()).toEqual(
        ['currency', 'materialCategoryId', 'ownerId', 'pdUserId', 'title'].sort(),
      );
    });
  });

  describe('R06-2 / R06-3 询价行', () => {
    let draft: InquiryDetailDto;

    beforeEach(async () => {
      draft = await createDraftInquiry(pd, category.LED);
    });

    it('R06-2 从材料库选用：复制编码、中英文名、规格、单位、分类、品牌', async () => {
      await ctx.prisma.material.update({ where: { id: material['MAT-000001'] }, data: { brand: '华信' } });
      const res = await pd
        .post(`/api/inquiries/${draft.id}/rounds/1/lines`)
        .send({
          source: 'MATERIAL',
          materialId: material['MAT-000001'],
          quantity: '200000',
          drawingRef: 'DWG-1',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        lineNo: 1,
        materialId: material['MAT-000001'],
        materialCode: 'MAT-000001',
        nameZh: '灯珠 2835',
        nameEn: 'LED 2835',
        spec: '2835 / 0.5W / 6V / 150mA / 6500K',
        unitCode: 'PCS',
        category: { code: 'LED-2835' },
        brand: '华信',
        quantity: '200000',
        drawingRef: 'DWG-1',
        files: [],
      });
      // 填了品牌就用填的
      const own = await pd
        .post(`/api/inquiries/${draft.id}/rounds/1/lines`)
        .send({ source: 'MATERIAL', materialId: material['MAT-000001'], quantity: '1', brand: '指定品牌' })
        .expect(201);
      expect(own.body).toMatchObject({ lineNo: 2, brand: '指定品牌' });
      await ctx.prisma.material.update({ where: { id: material['MAT-000001'] }, data: { brand: null } });
    });

    it('R06-2 停用的材料不能选用（MATERIAL_DISABLED）', async () => {
      const off = await createMaterial(ctx.prisma, { categoryId: category['LED-2835'], status: 'DISABLED' });
      const one = await pd
        .post(`/api/inquiries/${draft.id}/rounds/1/lines`)
        .send({ source: 'MATERIAL', materialId: off.id, quantity: '1' })
        .expect(409);
      expect(one.body).toMatchObject({ code: 'MATERIAL_DISABLED', params: { code: off.code } });
      const many = await pd
        .post(`/api/inquiries/${draft.id}/rounds/1/lines/from-materials`)
        .send({
          items: [
            { materialId: material['MAT-000002'], quantity: '1' },
            { materialId: off.id, quantity: '1' },
          ],
        })
        .expect(409);
      expect(many.body.code).toBe('MATERIAL_DISABLED');
      expect((await roundOf(pd, draft.id)).lines).toEqual([]);
      const unknown = await pd
        .post(`/api/inquiries/${draft.id}/rounds/1/lines`)
        .send({ source: 'MATERIAL', materialId: 'nope', quantity: '1' })
        .expect(400);
      expect(unknown.body.details).toEqual([
        expect.objectContaining({ path: 'materialId', code: 'not_found' }),
      ]);
    });

    it('R06-2 分类必须有效启用（#21）：手工行、材料所属分类停用都被拒', async () => {
      const parent = await createCategory(ctx.prisma, { status: 'DISABLED' });
      const child = await createCategory(ctx.prisma, { parentId: parent.id });
      const manual = await pd
        .post(`/api/inquiries/${draft.id}/rounds/1/lines`)
        .send(manualLineBody(child.id))
        .expect(409);
      expect(manual.body.code).toBe('CATEGORY_DISABLED');
      const m = await createMaterial(ctx.prisma, { categoryId: child.id });
      const fromMaterial = await pd
        .post(`/api/inquiries/${draft.id}/rounds/1/lines`)
        .send({ source: 'MATERIAL', materialId: m.id, quantity: '1' })
        .expect(409);
      expect(fromMaterial.body.code).toBe('CATEGORY_DISABLED');
    });

    it('R06-2 手工行：名称、规格、单位、分类必填，单位必须启用，数量 > 0 且最多 4 位小数', async () => {
      const base = manualLineBody(category['LED-2835']);
      const url = `/api/inquiries/${draft.id}/rounds/1/lines`;
      for (const key of ['nameZh', 'spec', 'unitCode', 'categoryId']) {
        await pd
          .post(url)
          .send({ ...base, [key]: '' })
          .expect(400);
      }
      for (const quantity of ['0', '-1', '1.23456', 'abc']) {
        const res = await pd
          .post(url)
          .send({ ...base, quantity })
          .expect(400);
        expect(res.body.details[0].path).toBe('quantity');
      }
      const unit = await pd
        .post(url)
        .send({ ...base, unitCode: 'BAG' })
        .expect(400);
      expect(unit.body).toMatchObject({ code: 'DICT_ITEM_INVALID', params: { type: 'unit', code: 'BAG' } });
      const ok = await pd
        .post(url)
        .send({ ...base, materialCode: 'cust-01', quantity: '12.5000', nameEn: 'Manual' })
        .expect(201);
      expect(ok.body).toMatchObject({
        materialId: null,
        materialCode: 'CUST-01',
        quantity: '12.5',
        nameEn: 'Manual',
      });
    });

    it('R06-2 材料行只能改数量、品牌、图纸编号、备注；source 与行的来源不一致被拒', async () => {
      const line: InquiryLineDto = (
        await pd
          .post(`/api/inquiries/${draft.id}/rounds/1/lines`)
          .send({ source: 'MATERIAL', materialId: material['MAT-000002'], quantity: '10' })
          .expect(201)
      ).body;
      const url = `/api/inquiries/${draft.id}/rounds/1/lines/${line.id}`;
      const wrong = await pd.put(url).send(manualLineBody(category.LED)).expect(400);
      expect(wrong.body.details[0].path).toBe('source');
      const res = await pd
        .put(url)
        .send({ source: 'MATERIAL', quantity: '20.25', remark: '急', nameZh: '改不了' })
        .expect(200);
      expect(res.body).toMatchObject({ quantity: '20.25', remark: '急', nameZh: 'COB 灯珠', brand: null });

      const manual = await addManualLine(pd, draft.id, category.LED);
      const changed = await pd
        .put(`/api/inquiries/${draft.id}/rounds/1/lines/${manual.id}`)
        .send(manualLineBody(category['LED-3030'], { nameZh: '改名', unitCode: 'SET', quantity: '5' }))
        .expect(200);
      expect(changed.body).toMatchObject({
        nameZh: '改名',
        unitCode: 'SET',
        quantity: '5',
        category: { code: 'LED-3030' },
      });
      const log = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: draft.id, action: 'inquiryLine.update' },
        orderBy: { createdAt: 'desc' },
      });
      expect(Object.keys((log.detail as { changes: object }).changes).sort()).toEqual(
        ['categoryId', 'nameZh', 'quantity', 'unitCode'].sort(),
      );
    });

    it('R06-3 从 1 连续编号；删除后后面的行前移', async () => {
      for (const name of ['A', 'B', 'C', 'D'])
        await addManualLine(pd, draft.id, category.LED, { nameZh: name });
      const before = await roundOf(pd, draft.id);
      expect(lineNos(before)).toEqual([
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
        [4, 'D'],
      ]);
      const res = await pd
        .delete(`/api/inquiries/${draft.id}/rounds/1/lines/${before.lines[1].id}`)
        .expect(200);
      expect(lineNos(res.body)).toEqual([
        [1, 'A'],
        [2, 'C'],
        [3, 'D'],
      ]);
      await pd.delete(`/api/inquiries/${draft.id}/rounds/1/lines/${before.lines[1].id}`).expect(404);
      // 删除后再加的行接在最后
      await addManualLine(pd, draft.id, category.LED, { nameZh: 'E' });
      expect(lineNos(await roundOf(pd, draft.id)).map(([no]) => no)).toEqual([1, 2, 3, 4]);
    });

    it('R06-3 调整顺序后重新编号；lineIds 必须恰好是本轮全部的行', async () => {
      for (const name of ['A', 'B', 'C']) await addManualLine(pd, draft.id, category.LED, { nameZh: name });
      const ids = (await roundOf(pd, draft.id)).lines.map((l) => l.id);
      const url = `/api/inquiries/${draft.id}/rounds/1/lines/order`;
      const res = await pd
        .put(url)
        .send({ lineIds: [ids[2], ids[0], ids[1]] })
        .expect(200);
      expect(lineNos(res.body)).toEqual([
        [1, 'C'],
        [2, 'A'],
        [3, 'B'],
      ]);
      await pd
        .put(url)
        .send({ lineIds: [ids[0], ids[1]] })
        .expect(400);
      await pd
        .put(url)
        .send({ lineIds: [ids[0], ids[0], ids[1]] })
        .expect(400);
      await pd
        .put(url)
        .send({ lineIds: [ids[0], ids[1], 'other'] })
        .expect(400);
      expect(lineNos(await roundOf(pd, draft.id))).toEqual(lineNos(res.body));
    });

    it('R06-3 并发添加行，行号仍然从 1 连续（询价单加了行锁）', async () => {
      const results = await Promise.all(
        ['A', 'B', 'C', 'D', 'E'].map((name) =>
          pd
            .post(`/api/inquiries/${draft.id}/rounds/1/lines`)
            .send(manualLineBody(category.LED, { nameZh: name })),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(results.map((r) => r.body.lineNo).sort()).toEqual([1, 2, 3, 4, 5]);
      expect((await roundOf(pd, draft.id)).lines.map((l) => l.lineNo)).toEqual([1, 2, 3, 4, 5]);
    });

    it('从材料库多选：按选择的顺序追加在已有行之后', async () => {
      await addManualLine(pd, draft.id, category.LED, { nameZh: '手工' });
      const res = await pd
        .post(`/api/inquiries/${draft.id}/rounds/1/lines/from-materials`)
        .send({
          items: [
            { materialId: material['MAT-000003'], quantity: '500' },
            { materialId: material['MAT-000001'], quantity: '200000' },
          ],
        })
        .expect(201);
      expect(res.body.map((l: InquiryLineDto) => [l.lineNo, l.materialCode, l.quantity])).toEqual([
        [2, 'MAT-000003', '500'],
        [3, 'MAT-000001', '200000'],
      ]);
    });
  });

  describe('R06-11 询价行 Excel 导入', () => {
    it('模板表头与 R06-11 一致，说明页列出单位和分类', async () => {
      const res = await pd
        .get('/api/inquiries/lines/import-template')
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      const wb = await loadXlsx(res.body);
      expect(sheetRows(wb.getWorksheet(SHEET)!)[0]).toEqual(HEADERS);
      const help = sheetRows(wb.worksheets[1]).map((r) => r[0]);
      expect(help).toEqual(
        expect.arrayContaining(['PCS  个 / pcs', '    LED-2835  2835 灯珠 / 2835 SMD LED']),
      );
    });

    it('R06-11 匹配到启用材料的取材料库的值，其余按手工行；追加在已有行之后', async () => {
      const draft = await createDraftInquiry(pd, category.LED);
      await addManualLine(pd, draft.id, category.LED, { nameZh: '已有' });
      const off = await createMaterial(ctx.prisma, {
        categoryId: category.LED,
        code: 'TM-OFF',
        status: 'DISABLED',
      });
      const res = await importLines(
        pd,
        draft.id,
        [
          // 只填编码和数量：名称、规格、单位、分类取材料库
          ['mat-000001', null, null, null, 200000, null, null, 'DWG-01', '首批'],
          // 编码匹配时文件里的名称、规格等不用，品牌填了就用填的
          ['MAT-000002', '别的名字', '别的规格', 'SET', '10.5', 'PER', '自选品牌', null, null],
          // 没有编码的手工行
          [null, '手工灯珠', '3030 / 1W', '个', 3000, 'led-3030', null, null, null],
          // 编码匹配不到（或材料已停用）按手工行，编码照原样保留
          [off.code, '停用材料替代', 'X', 'pcs', 1, 'LED', 'B', null, null],
        ],
        200,
      );
      expect(res.body).toEqual({ created: 4, updated: 0 });
      const round = await roundOf(pd, draft.id);
      expect(
        round.lines.map((l) => [
          l.lineNo,
          l.materialId !== null,
          l.materialCode,
          l.nameZh,
          l.unitCode,
          l.quantity,
          l.category.code,
          l.brand,
        ]),
      ).toEqual([
        [1, false, null, '已有', 'PCS', '100', 'LED', null],
        [2, true, 'MAT-000001', '灯珠 2835', 'PCS', '200000', 'LED-2835', null],
        [3, true, 'MAT-000002', 'COB 灯珠', 'PCS', '10.5', 'LED-COB', '自选品牌'],
        [4, false, null, '手工灯珠', 'PCS', '3000', 'LED-3030', null],
        [5, false, 'TM-OFF', '停用材料替代', 'PCS', '1', 'LED', 'B'],
      ]);
      expect(round.lines[1]).toMatchObject({
        drawingRef: 'DWG-01',
        remark: '首批',
        spec: '2835 / 0.5W / 6V / 150mA / 6500K',
      });
      expect(await timelineActions(pd, draft.id)).toContain('inquiryLine.import');
    });

    it('R06-11 有任何错误整表拒绝，逐行提示', async () => {
      const draft = await createDraftInquiry(pd, category.LED);
      const off = await createCategory(ctx.prisma, { code: 'TC-OFF', status: 'DISABLED' });
      const res = await importLines(
        pd,
        draft.id,
        [
          [null, null, '规格', 'PCS', 1, 'LED', null, null, null],
          [null, '名称', '规格', '箱子', 1, 'LED', null, null, null],
          [null, '名称', '规格', 'PCS', 1, off.code, null, null, null],
          [null, '名称', '规格', 'PCS', 1, 'NOPE', null, null, null],
          [null, '名称', '规格', 'PCS', 0, 'LED', null, null, null],
          [null, '名称', '规格', 'PCS', -3, 'LED', null, null, null],
          [null, '名称', '规格', 'PCS', '1.23456', 'LED', null, null, null],
          ['MAT-000001', null, null, null, null, null, null, null, null],
          [null, '名称', '规格', 'PCS', '123456789012345', 'LED', null, null, null],
          [null, '正确的行', '规格', 'PCS', 1, 'LED', null, null, null],
        ],
        422,
      );
      expect(res.body.code).toBe('EXCEL_ROWS_INVALID');
      expect(res.body.details.map((d: { row: number; code: string }) => [d.row, d.code])).toEqual([
        [2, 'required'],
        [3, 'unit_not_found'],
        [4, 'category_disabled'],
        [5, 'category_not_found'],
        [6, 'not_positive'],
        [7, 'not_positive'],
        [8, 'too_many_decimals'],
        [9, 'required'],
        [10, 'too_large'],
      ]);
      expect((await roundOf(pd, draft.id)).lines).toEqual([]);

      const header = await importLines(
        pd,
        draft.id,
        [[null, 'a', 'b', 'PCS', 1, 'LED']],
        422,
        HEADERS.slice(0, 6),
      );
      expect(header.body.code).toBe('EXCEL_HEADER_MISMATCH');
    });
  });

  describe('R06-5 规格书与产品图', () => {
    let draft: InquiryDetailDto;
    let lines: InquiryLineDto[];

    beforeEach(async () => {
      draft = await createDraftInquiry(pd, category.LED);
      lines = [];
      for (const name of ['A', 'B', 'C'])
        lines.push(await addManualLine(pd, draft.id, category.LED, { nameZh: name }));
    });

    it('R06-5 规格书可以挂整单或某一行；产品图只能挂在行上', async () => {
      const spec = await upload(pd, 'SPEC_DOC', PDF, '规格书.pdf');
      const whole = await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC' });
      expect(whole.body).toMatchObject({
        kind: 'SPEC_DOC',
        lineId: null,
        file: { id: spec, originalName: '规格书.pdf' },
      });
      await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC', lineId: lines[0].id });
      const image = await upload(pd, 'PRODUCT_IMAGE', PNG, 'a.png');
      const noLine = await attach(pd, draft.id, { fileId: image, kind: 'PRODUCT_IMAGE' }, 400);
      expect(noLine.body.details).toEqual([expect.objectContaining({ path: 'lineId', code: 'required' })]);
      await attach(pd, draft.id, { fileId: image, kind: 'PRODUCT_IMAGE', lineId: lines[0].id });

      const round = await roundOf(pd, draft.id);
      expect(round.files.map((f) => f.file.originalName)).toEqual(['规格书.pdf']);
      expect(round.lines[0].files.map((f) => [f.kind, f.file.originalName])).toEqual([
        ['SPEC_DOC', '规格书.pdf'],
        ['PRODUCT_IMAGE', 'a.png'],
      ]);
      expect(round.lines[1].files).toEqual([]);
    });

    it('R06-5 只能挂自己上传的、类别一致的文件', async () => {
      const spec = await upload(pd, 'SPEC_DOC', PDF, 's.pdf');
      const wrongKind = await attach(
        pd,
        draft.id,
        { fileId: spec, kind: 'PRODUCT_IMAGE', lineId: lines[0].id },
        400,
      );
      expect(wrongKind.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
      const others = await upload(buyer, 'SPEC_DOC', PDF, 'b.pdf');
      const denied = await attach(pd, draft.id, { fileId: others, kind: 'SPEC_DOC' }, 403);
      expect(denied.body.code).toBe('FILE_ACCESS_DENIED');
      const otherLine = await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC', lineId: 'nope' }, 400);
      expect(otherLine.body.details[0].path).toBe('lineId');
    });

    it('R06-5 每行最多 10 张产品图，第 11 张被拒', async () => {
      for (let i = 1; i <= 10; i += 1) {
        const id = await upload(pd, 'PRODUCT_IMAGE', PNG, `${i}.png`);
        await attach(pd, draft.id, { fileId: id, kind: 'PRODUCT_IMAGE', lineId: lines[0].id });
      }
      const eleventh = await upload(pd, 'PRODUCT_IMAGE', PNG, '11.png');
      const res = await attach(
        pd,
        draft.id,
        { fileId: eleventh, kind: 'PRODUCT_IMAGE', lineId: lines[0].id },
        400,
      );
      expect(res.body).toMatchObject({ code: 'FILE_LIMIT_EXCEEDED', params: { max: 10 } });
      // 规格书不受这个限制，其他行也不受影响
      const spec = await upload(pd, 'SPEC_DOC', PDF, 's.pdf');
      await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC', lineId: lines[0].id });
      await attach(pd, draft.id, { fileId: eleventh, kind: 'PRODUCT_IMAGE', lineId: lines[1].id });
      // 上限是系统参数 upload.limits.imagesPerLine
      await ctx.prisma.systemParam.create({
        data: {
          key: 'upload.limits',
          value: { specDocMaxMB: 50, imageMaxMB: 10, attachmentMaxMB: 50, imagesPerLine: 11 },
        },
      });
      try {
        await attach(pd, draft.id, { fileId: eleventh, kind: 'PRODUCT_IMAGE', lineId: lines[0].id });
      } finally {
        await ctx.prisma.systemParam.delete({ where: { key: 'upload.limits' } });
      }
    });

    it('R06-5 复制到其他行：新增指向同一文件的挂载，目标行已有的跳过；超过上限整体拒绝', async () => {
      const spec = await upload(pd, 'SPEC_DOC', PDF, 's.pdf');
      const img1 = await upload(pd, 'PRODUCT_IMAGE', PNG, '1.png');
      const img2 = await upload(pd, 'PRODUCT_IMAGE', PNG, '2.png');
      await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC', lineId: lines[0].id });
      await attach(pd, draft.id, { fileId: img1, kind: 'PRODUCT_IMAGE', lineId: lines[0].id });
      await attach(pd, draft.id, { fileId: img2, kind: 'PRODUCT_IMAGE', lineId: lines[0].id });
      await attach(pd, draft.id, { fileId: img1, kind: 'PRODUCT_IMAGE', lineId: lines[2].id });

      const url = `/api/inquiries/${draft.id}/rounds/1/files/copy`;
      const res = await pd
        .post(url)
        .send({ fromLineId: lines[0].id, toLineIds: [lines[1].id, lines[2].id, lines[0].id] })
        .expect(200);
      const names = (l: InquiryLineDto) => l.files.map((f) => f.file.originalName);
      expect(res.body.lines.map(names)).toEqual([
        ['s.pdf', '1.png', '2.png'],
        ['s.pdf', '1.png', '2.png'],
        ['1.png', 's.pdf', '2.png'],
      ]);
      const links = await ctx.prisma.inquiryFile.findMany({ where: { fileId: img2 } });
      expect(links).toHaveLength(3);

      // 只复制产品图；目标行复制后超过 10 张时整个操作拒绝
      for (let i = 3; i <= 10; i += 1) {
        const id = await upload(pd, 'PRODUCT_IMAGE', PNG, `${i}.png`);
        await attach(pd, draft.id, { fileId: id, kind: 'PRODUCT_IMAGE', lineId: lines[1].id });
      }
      const extra = await upload(pd, 'PRODUCT_IMAGE', PNG, 'x.png');
      await attach(pd, draft.id, { fileId: extra, kind: 'PRODUCT_IMAGE', lineId: lines[0].id });
      const over = await pd
        .post(url)
        .send({ fromLineId: lines[0].id, toLineIds: [lines[2].id, lines[1].id], kind: 'PRODUCT_IMAGE' })
        .expect(400);
      expect(over.body).toMatchObject({ code: 'FILE_LIMIT_EXCEEDED', params: { max: 10, lineNo: 2 } });
      expect(names((await roundOf(pd, draft.id)).lines[2])).toEqual(['1.png', 's.pdf', '2.png']);
    });

    it('删除挂载只删记录；删行时行上的挂载一起删除', async () => {
      const spec = await upload(pd, 'SPEC_DOC', PDF, 's.pdf');
      const link = (await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC', lineId: lines[0].id })).body;
      await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC', lineId: lines[1].id });
      await pd.delete(`/api/inquiries/${draft.id}/rounds/1/files/${link.id}`).expect(200);
      await pd.delete(`/api/inquiries/${draft.id}/rounds/1/files/${link.id}`).expect(404);
      await pd.delete(`/api/inquiries/${draft.id}/rounds/1/lines/${lines[1].id}`).expect(200);
      expect(await ctx.prisma.inquiryFile.count({ where: { fileId: spec } })).toBe(0);
      expect(await ctx.prisma.fileObject.count({ where: { id: spec } })).toBe(1);
    });

    it('附件访问：数据权限内的内部用户可以预览下载，范围外的和供应商不行', async () => {
      const spec = await upload(pd, 'SPEC_DOC', PDF, 's.pdf');
      await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC' });
      await manager.get(`/api/files/${spec}/content`).expect(200);
      await deptApprover.get(`/api/files/${spec}/content`).expect(200);
      expect((await buyer2.get(`/api/files/${spec}/content`).expect(403)).body.code).toBe(
        'FILE_ACCESS_DENIED',
      );
      await gmApprover.get(`/api/files/${spec}/content`).expect(403);
      await supplier.get(`/api/files/${spec}/content`).expect(403);
    });
  });

  describe('状态流转（05 §1）', () => {
    it('R06-6 没有询价行不能提交（INQUIRY_NO_LINES）；PD 不能审批', async () => {
      const draft = await createDraftInquiry(pd, category.LED);
      expect((await pd.post(`/api/inquiries/${draft.id}/submit`).expect(400)).body.code).toBe(
        'INQUIRY_NO_LINES',
      );
      await addManualLine(pd, draft.id, category.LED);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);
      await pd.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(403);
    });

    it('R06-8 提交审批：给每个有 inquiry:approve 且数据权限覆盖该单的审批人发一封 approval.request', async () => {
      const draft = await createDraftInquiry(pd, category.LED, { title: '审批邮件' });
      await addManualLine(pd, draft.id, category.LED);
      const res = await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);
      expect(res.body).toMatchObject({
        docStatus: 'PENDING_APPROVAL',
        displayStatus: 'PENDING_APPROVAL',
        allowedActions: [],
      });
      expect(res.body.submittedAt).toBe(ctx.clock.now().toISOString());
      const mails = await approvalMails(draft.id);
      // manager、manager2（ALL）和 PRODUCT 部门的部门审批人；GM 部门的、停用的、没有邮箱的收不到
      expect(mails.map((m) => m.toAddresses[0]).sort()).toEqual([
        'dept@example.com',
        'manager2@example.com',
        'manager@example.com',
      ]);
      const zh = mails.find((m) => m.toAddresses[0] === 'manager@example.com')!;
      expect(zh).toMatchObject({
        language: 'zh-CN',
        subject: `询价单待审批：${draft.draftNo} 审批邮件`,
        status: 'PENDING',
      });
      expect(zh.html).toContain(`/inquiries/${draft.id}`);
      expect(mails.find((m) => m.toAddresses[0] === 'manager2@example.com')!).toMatchObject({
        language: 'en-US',
        subject: `RFQ pending approval: ${draft.draftNo} 审批邮件`,
      });
    });

    it('R06-4 提交后表头、询价行、附件都不能再改（INQUIRY_NOT_EDITABLE）', async () => {
      const draft = await createDraftInquiry(pd, category.LED);
      const line = await addManualLine(pd, draft.id, category.LED);
      const spec = await upload(pd, 'SPEC_DOC', PDF, 's.pdf');
      const link = (await attach(pd, draft.id, { fileId: spec, kind: 'SPEC_DOC' })).body;
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);

      const base = `/api/inquiries/${draft.id}/rounds/1`;
      const header = {
        projectNo: 'P',
        title: 'T',
        materialCategoryId: category.LED,
        currency: 'CNY',
        ownerId: users.pd.id,
      };
      const importFile = await buildXlsx(SHEET, HEADERS, [[null, 'a', 'b', 'PCS', 1, 'LED']]);
      // supertest 的请求要在发出时才创建
      const attempts = [
        () => pd.put(`/api/inquiries/${draft.id}`).send(header),
        () => pd.post(`${base}/lines`).send(manualLineBody(category.LED)),
        () =>
          pd
            .post(`${base}/lines/from-materials`)
            .send({ items: [{ materialId: material['MAT-000001'], quantity: '1' }] }),
        () => pd.put(`${base}/lines/${line.id}`).send(manualLineBody(category.LED)),
        () => pd.delete(`${base}/lines/${line.id}`),
        () => pd.put(`${base}/lines/order`).send({ lineIds: [line.id] }),
        () => pd.post(`${base}/files`).send({ fileId: spec, kind: 'SPEC_DOC' }),
        () => pd.delete(`${base}/files/${link.id}`),
        () => pd.post(`${base}/files/copy`).send({ fromLineId: line.id, toLineIds: [line.id] }),
        () => pd.post(`${base}/lines/import`).attach('file', importFile, 'x.xlsx'),
      ];
      for (const attempt of attempts) {
        const res = await attempt();
        expect([res.status, res.body.code]).toEqual([409, 'INQUIRY_NOT_EDITABLE']);
      }
      expect((await roundOf(pd, draft.id)).allowedActions).toEqual([]);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(409);
    });

    it('R06-7 驳回必须填写意见；驳回后回到草稿，带最近一次驳回意见，可以再编辑再提交', async () => {
      const draft = await createDraftInquiry(pd, category.LED, { ownerId: users.buyer.id, title: '驳回' });
      await addManualLine(pd, draft.id, category.LED);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);

      for (const body of [{}, { comment: '   ' }]) {
        const res = await manager.post(`/api/inquiries/${draft.id}/reject`).send(body).expect(400);
        expect(res.body.code).toBe('INQUIRY_REJECT_COMMENT_REQUIRED');
      }
      const before = (await approvalMails(draft.id)).length;
      const rejected = await manager
        .post(`/api/inquiries/${draft.id}/reject`)
        .send({ comment: '数量不对' })
        .expect(200);
      expect(rejected.body).toMatchObject({
        docStatus: 'DRAFT',
        lastRejectComment: '数量不对',
        formalNo: null,
      });
      // 结果发给负责人和创建人
      const results = (await approvalMails(draft.id)).slice(before);
      expect(results.map((m) => m.toAddresses[0]).sort()).toEqual(['buyer@example.com', 'pd@example.com']);
      expect(results[0].subject).toBe(`询价单被驳回：${draft.draftNo} 驳回`);
      expect(results[0].text).toContain('驳回意见：数量不对');

      const again = await detailOf(pd, draft.id);
      expect(again).toMatchObject({ lastRejectComment: '数量不对', allowedActions: ['edit', 'submit'] });
      await addManualLine(pd, draft.id, category.LED, { nameZh: '补一行' });
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);
      await manager.post(`/api/inquiries/${draft.id}/approve`).send({ comment: '同意' }).expect(200);

      const approvals = (await pd.get(`/api/inquiries/${draft.id}/approvals`).expect(200)).body;
      expect(
        approvals.map((a: { action: string; comment: string | null; actor: { name: string } }) => [
          a.action,
          a.comment,
          a.actor.name,
        ]),
      ).toEqual([
        ['SUBMIT', null, 'pd'],
        ['REJECT', '数量不对', 'manager'],
        ['SUBMIT', null, 'pd'],
        ['APPROVE', '同意', 'manager'],
      ]);
    });

    it('R06-7 通过：生成正式询价号 RFQ-yyyymm-nnnn，审批结果发给负责人和创建人', async () => {
      const draft = await createDraftInquiry(pd, category.LED, { ownerId: users.buyer.id, title: '通过' });
      await addManualLine(pd, draft.id, category.LED);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);
      const before = (await approvalMails(draft.id)).length;
      const res = await manager.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(200);
      expect(res.body.formalNo).toMatch(/^RFQ-202611-\d{4}$/);
      expect(res.body).toMatchObject({
        docStatus: 'APPROVED',
        displayStatus: 'READY',
        approvedAt: ctx.clock.now().toISOString(),
        approvedBy: { id: users.manager.id, name: 'manager' },
        currentRoundStatus: 'DRAFT',
      });
      const results = (await approvalMails(draft.id)).slice(before);
      expect(results.map((m) => m.toAddresses[0]).sort()).toEqual(['buyer@example.com', 'pd@example.com']);
      expect(results[0].subject).toBe(`询价单已审批通过：${res.body.formalNo} 通过`);

      // 正式号按月连续
      const next = await createApprovedInquiry(pd, manager, category.LED);
      const n = (no: string) => Number(no.slice(-4));
      expect(n(next.formalNo!)).toBe(n(res.body.formalNo) + 1);
      // 已通过的不能再审批、驳回
      expect((await manager.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(409)).body.code).toBe(
        'INQUIRY_INVALID_STATUS',
      );
      await manager.post(`/api/inquiries/${draft.id}/reject`).send({ comment: 'x' }).expect(409);
    });

    it('R06-7 并发审批只有一次生效，只生成一个正式询价号', async () => {
      const draft = await createDraftInquiry(pd, category.LED);
      await addManualLine(pd, draft.id, category.LED);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);
      const results = await Promise.all([
        manager.post(`/api/inquiries/${draft.id}/approve`).send({}),
        manager.post(`/api/inquiries/${draft.id}/approve`).send({}),
        manager.post(`/api/inquiries/${draft.id}/reject`).send({ comment: '不行' }),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).map((r) => r.body.code)).toEqual([
        'INQUIRY_INVALID_STATUS',
        'INQUIRY_INVALID_STATUS',
      ]);
      const records = await ctx.prisma.inquiryApproval.count({
        where: { inquiryId: draft.id, action: { not: 'SUBMIT' } },
      });
      expect(records).toBe(1);
    });

    it('R06-12 状态动作都记审计，操作日志按时间线返回', async () => {
      const draft = await createDraftInquiry(pd, category.LED);
      await addManualLine(pd, draft.id, category.LED);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);
      await manager.post(`/api/inquiries/${draft.id}/reject`).send({ comment: '再看看' }).expect(200);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);
      await manager.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(200);
      await manager.post(`/api/inquiries/${draft.id}/cancel`).send({ reason: '项目取消' }).expect(200);
      expect(await timelineActions(pd, draft.id)).toEqual([
        'inquiry.create',
        'inquiryLine.create',
        'inquiry.submit',
        'inquiry.reject',
        'inquiry.submit',
        'inquiry.approve',
        'inquiry.cancel',
      ]);
      const res = await pd.get(`/api/inquiries/${draft.id}/timeline`).expect(200);
      expect(res.body[3]).toMatchObject({ actor: { name: 'manager' }, detail: { comment: '再看看' } });
    });

    it('R06-9 取消：原因必填；草稿、待审批、已通过未发布都能取消，第 1 轮一起取消', async () => {
      const draft = await createDraftInquiry(pd, category.LED);
      const res = await manager.post(`/api/inquiries/${draft.id}/cancel`).send({ reason: ' ' }).expect(400);
      expect(res.body.code).toBe('INQUIRY_CANCEL_REASON_REQUIRED');
      // PD、采购员没有 inquiry:cancel
      await pd.post(`/api/inquiries/${draft.id}/cancel`).send({ reason: 'x' }).expect(403);

      const pending = await createDraftInquiry(pd, category.LED);
      await addManualLine(pd, pending.id, category.LED);
      await pd.post(`/api/inquiries/${pending.id}/submit`).expect(200);
      const approved = await createApprovedInquiry(pd, manager, category.LED);

      for (const id of [draft.id, pending.id, approved.id]) {
        const cancelled = await manager
          .post(`/api/inquiries/${id}/cancel`)
          .send({ reason: '需求变化' })
          .expect(200);
        expect(cancelled.body).toMatchObject({
          docStatus: 'CANCELLED',
          displayStatus: 'CANCELLED',
          cancelReason: '需求变化',
          cancelledAt: ctx.clock.now().toISOString(),
          currentRoundStatus: 'CANCELLED',
          currentRound: { status: 'CANCELLED' },
          allowedActions: [],
        });
      }
      // 已取消的不能再取消，也不能提交
      await manager.post(`/api/inquiries/${draft.id}/cancel`).send({ reason: 'x' }).expect(409);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(409);
      // 第 1 轮已发布（M07 起）的取消由 M07 扩展，本模块拒绝
      const published = await createApprovedInquiry(pd, manager, category.LED);
      await ctx.prisma.inquiryRound.updateMany({
        where: { inquiryId: published.id },
        data: { status: 'WAITING_QUOTES' },
      });
      await ctx.prisma.inquiry.update({
        where: { id: published.id },
        data: { currentRoundStatus: 'WAITING_QUOTES' },
      });
      expect(
        (await manager.post(`/api/inquiries/${published.id}/cancel`).send({ reason: 'x' }).expect(409)).body
          .code,
      ).toBe('INQUIRY_INVALID_STATUS');
    });
  });

  describe('R06-10 数据权限', () => {
    let mine: InquiryDetailDto;

    beforeAll(async () => {
      mine = await createDraftInquiry(pd, category.LED, { title: 'PD 的单' });
    });

    it('R06-10 SELF：看不到别人的单（列表不出现，详情、轮次、审批记录、操作日志都是 404，也不能改）', async () => {
      const list = await buyer2.get('/api/inquiries').query({ pageSize: 100 }).expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(mine.id);
      for (const path of ['', '/rounds/1', '/approvals', '/timeline']) {
        await buyer2.get(`/api/inquiries/${mine.id}${path}`).expect(404);
      }
      await buyer2
        .post(`/api/inquiries/${mine.id}/rounds/1/lines`)
        .send(manualLineBody(category.LED))
        .expect(404);
      await buyer2.post(`/api/inquiries/${mine.id}/submit`).expect(404);
      // 成为负责人后就能看到
      await ctx.prisma.inquiry.update({ where: { id: mine.id }, data: { ownerId: users.buyer2.id } });
      await buyer2.get(`/api/inquiries/${mine.id}`).expect(200);
      await ctx.prisma.inquiry.update({ where: { id: mine.id }, data: { ownerId: users.pd.id } });
    });

    it('R06-10 DEPT：看本部门的和自己相关的；ALL 看全部', async () => {
      await deptApprover.get(`/api/inquiries/${mine.id}`).expect(200);
      await gmApprover.get(`/api/inquiries/${mine.id}`).expect(404);
      const all = await admin.get('/api/inquiries').query({ pageSize: 100 }).expect(200);
      expect(all.body.total).toBe(await ctx.prisma.inquiry.count());
      // 管理员只能看，不能建单、改行
      await admin.post('/api/inquiries').send({}).expect(403);
      await admin
        .post(`/api/inquiries/${mine.id}/rounds/1/lines`)
        .send(manualLineBody(category.LED))
        .expect(403);
    });

    it('待我审批只列出数据权限覆盖的待审批单据，先提交的在前', async () => {
      const first = await createDraftInquiry(pd, category.LED, { title: '先' });
      await addManualLine(pd, first.id, category.LED);
      await pd.post(`/api/inquiries/${first.id}/submit`).expect(200);
      ctx.clock.advance(60_000);
      const second = await createDraftInquiry(buyer, category.LED, { title: '后' });
      await addManualLine(buyer, second.id, category.LED);
      await buyer.post(`/api/inquiries/${second.id}/submit`).expect(200);

      const ids = async (agent: Agent) =>
        (
          await agent.get('/api/inquiries/approvals/pending').query({ pageSize: 100 }).expect(200)
        ).body.items.map((i: { id: string }) => i.id);
      const all = await ids(manager);
      expect(all.indexOf(first.id)).toBeLessThan(all.indexOf(second.id));
      // 部门审批人（PRODUCT）只覆盖 PD 建的单
      expect(await ids(deptApprover)).toContain(first.id);
      expect(await ids(deptApprover)).not.toContain(second.id);
      expect(await ids(gmApprover)).toEqual([]);
      await pd.get('/api/inquiries/approvals/pending').expect(403);
    });

    it('供应商访问内部询价接口一律 403', async () => {
      await supplier.get('/api/inquiries').expect(403);
      await supplier.get(`/api/inquiries/${mine.id}`).expect(403);
    });
  });

  describe('列表筛选与页签（05 §2）', () => {
    it('按页签、关键字、材料类别（含下级）、负责人、创建日期筛选', async () => {
      const a = await createDraftInquiry(manager, category['PER-DRV'], {
        projectNo: 'PJ-FILTER',
        title: '驱动筛选',
      });
      ctx.clock.advance(1000);
      const b = await createApprovedInquiry(manager, manager, category['DRV-CC'], { projectNo: 'PJ-FILTER' });
      const ids = async (query: Record<string, string>) =>
        (
          await manager
            .get('/api/inquiries')
            .query({ projectNo: 'PJ-FILTER', pageSize: '100', ...query })
            .expect(200)
        ).body.items.map((i: { id: string }) => i.id);
      expect(await ids({})).toEqual([b.id, a.id]);
      expect(await ids({ tab: 'draft' })).toEqual([a.id]);
      expect(await ids({ tab: 'ready' })).toEqual([b.id]);
      expect(await ids({ tab: 'pending' })).toEqual([]);
      expect(await ids({ keyword: '驱动筛' })).toEqual([a.id]);
      expect(await ids({ keyword: b.formalNo!.toLowerCase() })).toEqual([b.id]);
      expect(await ids({ materialCategoryId: category['PER-DRV'] })).toEqual([b.id, a.id]);
      expect(await ids({ materialCategoryId: category['DRV-CC'] })).toEqual([b.id]);
      expect(await ids({ ownerId: users.buyer.id })).toEqual([]);
      expect(await ids({ from: '2026-11-02', to: '2026-11-02' })).toEqual([b.id, a.id]);
      expect(await ids({ from: '2026-11-03' })).toEqual([]);
      await manager.get('/api/inquiries').query({ tab: 'nope' }).expect(400);
    });
  });

  describe('allowedActions（03 §6）', () => {
    it('草稿、待审批、已通过三种状态对 PD、采购员、采购主管分别返回正确的动作', async () => {
      // 负责人是采购员、PD 负责人是 PD，三个人都能看到这张单
      const draft = await createDraftInquiry(pd, category.LED, {
        ownerId: users.buyer.id,
        pdUserId: users.pd.id,
      });
      const actions = async (agent: Agent) => (await detailOf(agent, draft.id)).allowedActions;
      expect(await actions(pd)).toEqual(['edit', 'submit']);
      expect(await actions(buyer)).toEqual(['edit', 'submit']);
      expect(await actions(manager)).toEqual(['edit', 'submit', 'cancel']);

      await addManualLine(pd, draft.id, category.LED);
      await pd.post(`/api/inquiries/${draft.id}/submit`).expect(200);
      expect(await actions(pd)).toEqual([]);
      expect(await actions(buyer)).toEqual([]);
      expect(await actions(manager)).toEqual(['approve', 'reject', 'cancel']);

      await manager.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(200);
      expect(await actions(pd)).toEqual([]);
      expect(await actions(buyer)).toEqual([]);
      expect(await actions(manager)).toEqual(['cancel']);
      // 轮次详情的 edit 与单据一致
      expect((await roundOf(manager, draft.id)).allowedActions).toEqual(['cancel']);
    });
  });
});
