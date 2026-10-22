// 演示场景（docs/06-种子数据.md §3）。单据一律通过 service 方法创建，状态和不变量与真实操作一致。
// 哪个模块完成就在这里补哪个场景：M06 → D1、D2。
import type { INestApplicationContext } from '@nestjs/common';
import {
  attachInquiryFileSchema,
  createInquirySchema,
  createLineSchema,
  linesFromMaterialsSchema,
  type InquiryFileKind,
} from '@quoteflow/shared';
import type { AuthUser } from '../../src/common/auth/auth-user';
import { buildAuthUser, userWithRolesInclude } from '../../src/common/auth/session.service';
import { FilesService } from '../../src/infra/files/files.service';
import { InquiriesService } from '../../src/modules/inquiries/inquiries.service';
import { InquiryFilesService } from '../../src/modules/inquiries/inquiry-files.service';
import { InquiryLinesService } from '../../src/modules/inquiries/inquiry-lines.service';
import { InquiryWorkflowService } from '../../src/modules/inquiries/inquiry-workflow.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { demoPdf, demoPng } from './demo-files';

export interface DemoContext {
  app: INestApplicationContext;
  prisma: PrismaService;
  users: Record<'pd' | 'buyer' | 'manager', AuthUser>;
  category: Record<string, string>;
  material: Record<string, string>;
}

/** 演示账号来自基础数据（06 §2.2），没有时提示先执行 npm run db:seed */
export async function demoContext(app: INestApplicationContext): Promise<DemoContext> {
  const prisma = app.get(PrismaService);
  const actor = async (username: string): Promise<AuthUser> => {
    const user = await prisma.user.findUnique({ where: { username }, include: userWithRolesInclude });
    if (!user) throw new Error(`seed-demo: user "${username}" not found, run "npm run db:seed" first`);
    return buildAuthUser(user, 'seed-demo', { ip: null, userAgent: null });
  };
  const categories = await prisma.materialCategory.findMany({ select: { id: true, code: true } });
  const materials = await prisma.material.findMany({ select: { id: true, code: true } });
  if (materials.length === 0) throw new Error('seed-demo: no materials, run "npm run db:seed" first');
  return {
    app,
    prisma,
    users: {
      pd: await actor('pd.wang'),
      buyer: await actor('buyer.zhang'),
      manager: await actor('manager.zhang'),
    },
    category: Object.fromEntries(categories.map((c) => [c.code, c.id])),
    material: Object.fromEntries(materials.map((m) => [m.code, m.id])),
  };
}

async function upload(
  ctx: DemoContext,
  user: AuthUser,
  kind: InquiryFileKind,
  name: string,
  buffer: Buffer,
): Promise<string> {
  const file = await ctx.app
    .get(FilesService)
    .upload(user, { originalname: name, buffer, size: buffer.length }, kind);
  return file.id;
}

/** D1：PJ-2026-001 / 2835 灯珠年度询价，草稿；PD 建单，负责人 buyer.zhang；MAT-000001 × 200000 + 一行手工行 */
export async function seedD1(ctx: DemoContext): Promise<string> {
  const { pd, buyer } = ctx.users;
  const inquiry = await ctx.app.get(InquiriesService).create(
    pd,
    createInquirySchema.parse({
      projectNo: 'PJ-2026-001',
      title: '2835 灯珠年度询价',
      materialCategoryId: ctx.category['LED-2835'],
      currency: 'CNY',
      description: '2027 年度框架采购，按季度分批交货。',
      ownerId: buyer.id,
      pdUserId: pd.id,
    }),
  );
  const lines = ctx.app.get(InquiryLinesService);
  await lines.createFromMaterials(
    pd,
    inquiry.id,
    1,
    linesFromMaterialsSchema.parse({
      items: [{ materialId: ctx.material['MAT-000001'], quantity: '200000' }],
    }),
  );
  await lines.create(
    pd,
    inquiry.id,
    1,
    createLineSchema.parse({
      source: 'MANUAL',
      nameZh: '2835 灯珠（暖白）',
      nameEn: '2835 SMD LED (Warm White)',
      spec: '2835 / 0.5W / 6V / 150mA / 3000K / Ra80',
      unitCode: 'PCS',
      categoryId: ctx.category['LED-2835'],
      quantity: '50000',
      remark: '色温 3000K，需提供 LM-80 报告',
    }),
  );
  return inquiry.draftNo;
}

/** D2：PJ-2026-002 / 恒流驱动电源询价，待审批；MAT-000005、MAT-000006，带规格书 PDF 和产品图 */
export async function seedD2(ctx: DemoContext): Promise<string> {
  const { pd, buyer } = ctx.users;
  const inquiry = await ctx.app.get(InquiriesService).create(
    pd,
    createInquirySchema.parse({
      projectNo: 'PJ-2026-002',
      title: '恒流驱动电源询价',
      materialCategoryId: ctx.category['PER-DRV'],
      currency: 'CNY',
      description: '配套 2027 款筒灯与线条灯，需通过 CCC 认证。',
      ownerId: buyer.id,
      pdUserId: pd.id,
    }),
  );
  const created = await ctx.app.get(InquiryLinesService).createFromMaterials(
    pd,
    inquiry.id,
    1,
    linesFromMaterialsSchema.parse({
      items: [
        { materialId: ctx.material['MAT-000005'], quantity: '5000' },
        { materialId: ctx.material['MAT-000006'], quantity: '2000' },
      ],
    }),
  );
  const files = ctx.app.get(InquiryFilesService);
  const attach = (fileId: string, kind: InquiryFileKind, lineId: string | null) =>
    files.attach(pd, inquiry.id, 1, attachInquiryFileSchema.parse({ fileId, kind, lineId }));

  const spec = await upload(
    ctx,
    pd,
    'SPEC_DOC',
    '恒流驱动电源规格书.pdf',
    demoPdf([
      'LED Driver Specification (demo)',
      'Project: PJ-2026-002',
      'Input: AC 220V 50/60Hz, PF > 0.9',
      'Output: constant current, see each RFQ line',
      'Certification: CCC',
    ]),
  );
  await attach(spec, 'SPEC_DOC', null);
  const ccSpec = await upload(
    ctx,
    pd,
    'SPEC_DOC',
    'CC 驱动接线图.pdf',
    demoPdf(['CC LED Driver Wiring Diagram (demo)', 'DC 30-42V / 300mA']),
  );
  await attach(ccSpec, 'SPEC_DOC', created[0].id);
  const images: [string, Buffer, string][] = [
    ['恒流电源-正面.png', demoPng([30, 64, 120], [210, 225, 240]), created[0].id],
    ['恒流电源-接线端.png', demoPng([30, 64, 120], [250, 200, 80]), created[0].id],
    ['恒压电源.png', demoPng([60, 90, 60], [220, 235, 220]), created[1].id],
  ];
  for (const [name, buffer, lineId] of images) {
    await attach(await upload(ctx, pd, 'PRODUCT_IMAGE', name, buffer), 'PRODUCT_IMAGE', lineId);
  }

  // 提交审批：给采购主管 manager.zhang 发 approval.request（开发环境进 Mailpit）
  await ctx.app.get(InquiryWorkflowService).submit(pd, inquiry.id);
  return inquiry.draftNo;
}
