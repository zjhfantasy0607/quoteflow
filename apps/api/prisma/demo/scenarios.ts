// 演示场景（docs/06-种子数据.md §3）。单据一律通过 service 方法创建，状态和不变量与真实操作一致。
// 哪个模块完成就在这里补哪个场景：M06 → D1、D2；M09 → D3；M11 → D4。
import type { INestApplicationContext } from '@nestjs/common';
import {
  approveInquirySchema,
  attachInquiryFileSchema,
  createInquirySchema,
  createLineSchema,
  linesFromMaterialsSchema,
  negotiationOfferSchema,
  negotiationRespondSchema,
  publishRoundSchema,
  quoteFormSchema,
  updateInviteesSchema,
  type InquiryFileKind,
} from '@quoteflow/shared';
import type { AuthUser } from '../../src/common/auth/auth-user';
import { buildAuthUser, userWithRolesInclude } from '../../src/common/auth/session.service';
import { ClockService } from '../../src/common/clock/clock.service';
import { inAppTz } from '../../src/common/time';
import { FilesService } from '../../src/infra/files/files.service';
import { InquiriesService } from '../../src/modules/inquiries/inquiries.service';
import { InquiryFilesService } from '../../src/modules/inquiries/inquiry-files.service';
import { InquiryInviteesService } from '../../src/modules/inquiries/inquiry-invitees.service';
import { InquiryLinesService } from '../../src/modules/inquiries/inquiry-lines.service';
import { InquiryWorkflowService } from '../../src/modules/inquiries/inquiry-workflow.service';
import { RoundDeadlineJob } from '../../src/modules/inquiries/round-deadline.job';
import { RoundWorkflowService } from '../../src/modules/inquiries/round-workflow.service';
import { NegotiationsService } from '../../src/modules/negotiations/negotiations.service';
import { PortalQuotesService } from '../../src/modules/portal/portal-quotes.service';
import { QuoteSubmissionService } from '../../src/modules/portal/quote-submission.service';
import { RoundShortlistService } from '../../src/modules/quotes/round-shortlist.service';
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

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** 供应商门户账号（06 §2.8：用户名就是联系邮箱，seed 里已激活） */
async function supplierActor(ctx: DemoContext, supplierCode: string): Promise<AuthUser> {
  const user = await ctx.prisma.user.findFirst({
    where: { supplier: { code: supplierCode }, userType: 'SUPPLIER', status: 'ACTIVE' },
    include: userWithRolesInclude,
  });
  if (!user)
    throw new Error(`seed-demo: portal account of ${supplierCode} not found, run "npm run db:seed" first`);
  return buildAuthUser(user, 'seed-demo', { ip: null, userAgent: null });
}

/** 把时钟拨到"现在 + offsetMs"（负数 = 过去）执行 run，结束后拨回（06 §1） */
async function atOffset<T>(ctx: DemoContext, offsetMs: number, run: () => Promise<T>): Promise<T> {
  const clock = ctx.app.get(ClockService);
  clock.setOffset(offsetMs);
  try {
    return await run();
  } finally {
    clock.setOffset(0);
  }
}

/** D3 两行报价（PPL-PERIPH 的必填列：含税单价、税率、交期、材质） */
function d3Values(prices: [string, string]): Record<string, Record<string, unknown>> {
  const common = {
    tax_rate: '13',
    moq: 5000,
    price_valid_until: '2027-03-31',
    payment_terms: 'NET30',
    sample_lead_days: 7,
    monthly_capacity: 200000,
    warranty_months: 24,
    rohs: true,
    reach: true,
    packing_method: 'CARTON',
    trade_term: 'DAP',
    ship_from: '广州',
  };
  return {
    lens: {
      ...common,
      brand: '联创',
      model: 'LC-L20-60',
      material: 'PC（光学级）',
      unit_price_incl_tax: prices[0],
      lead_time_days: 25,
      pcs_per_carton: 2000,
      carton_l_cm: '40',
      carton_w_cm: '30',
      carton_h_cm: '25',
      carton_gw_kg: '9.5',
    },
    reflector: {
      ...common,
      brand: '联创',
      model: 'LC-R50-24',
      material: '铝（阳极氧化）',
      color_finish: '镜面银',
      unit_price_incl_tax: prices[1],
      lead_time_days: 30,
      pcs_per_carton: 500,
      carton_l_cm: '50',
      carton_w_cm: '40',
      carton_h_cm: '35',
      carton_gw_kg: '12.8',
    },
  };
}

/**
 * D3：PJ-2026-001 / 透镜与反光杯询价，等待报价（与 D1 同一项目，#1 一个项目多次询价）。
 * 三天前建单审批、两天前发布给 SUP10005、SUP10006、SUP10003，截止在 3 天后（北京时间 18:00）；
 * SUP10005 已提交 2 个版本（第 2 版降价），SUP10003 已拒绝（交期），SUP10006 看过但没响应
 */
export async function seedD3(ctx: DemoContext): Promise<string> {
  const { pd, buyer, manager } = ctx.users;
  const deadline = inAppTz(new Date()).add(3, 'day').hour(18).minute(0).second(0).millisecond(0).toDate();
  const inquiry = await atOffset(ctx, -3 * DAY_MS, async () => {
    const created = await ctx.app.get(InquiriesService).create(
      buyer,
      createInquirySchema.parse({
        projectNo: 'PJ-2026-001',
        title: '透镜与反光杯询价',
        materialCategoryId: ctx.category.PER,
        currency: 'CNY',
        description: '配套 2835 灯珠模组（同项目 PJ-2026-001），透镜与反光杯同批交货，送货到深圳宝安工厂。',
        ownerId: buyer.id,
        pdUserId: pd.id,
      }),
    );
    await ctx.app.get(InquiryLinesService).createFromMaterials(
      buyer,
      created.id,
      1,
      linesFromMaterialsSchema.parse({
        items: [
          { materialId: ctx.material['MAT-000003'], quantity: '20000' },
          { materialId: ctx.material['MAT-000004'], quantity: '20000' },
        ],
      }),
    );
    const spec = await upload(
      ctx,
      buyer,
      'SPEC_DOC',
      '透镜与反光杯技术要求.pdf',
      demoPdf([
        'Lens & Reflector Requirements (demo)',
        'Project: PJ-2026-001',
        'Lens: PC optical grade, 60 deg, transmittance > 90%',
        'Reflector: aluminium, anodized, 24 deg',
      ]),
    );
    await ctx.app
      .get(InquiryFilesService)
      .attach(
        buyer,
        created.id,
        1,
        attachInquiryFileSchema.parse({ fileId: spec, kind: 'SPEC_DOC', lineId: null }),
      );
    const workflow = ctx.app.get(InquiryWorkflowService);
    await workflow.submit(buyer, created.id);
    return workflow.approve(manager, created.id, approveInquirySchema.parse({}));
  });

  const suppliers = await ctx.prisma.supplier.findMany({
    where: { code: { in: ['SUP10005', 'SUP10006', 'SUP10003'] } },
    select: { id: true, code: true },
  });
  await atOffset(ctx, -2 * DAY_MS, async () => {
    await ctx.app
      .get(InquiryInviteesService)
      .replace(buyer, inquiry.id, updateInviteesSchema.parse({ supplierIds: suppliers.map((s) => s.id) }));
    await ctx.app.get(RoundWorkflowService).publish(
      buyer,
      inquiry.id,
      1,
      publishRoundSchema.parse({
        deadline: deadline.toISOString(),
      }),
    );
  });

  const quotes = await ctx.prisma.quote.findMany({
    where: { round: { inquiryId: inquiry.id } },
    select: { id: true, supplier: { select: { code: true } } },
  });
  const quoteOf = (code: string) => quotes.find((q) => q.supplier.code === code)!.id;
  const lines = await ctx.prisma.inquiryLine.findMany({
    where: { round: { inquiryId: inquiry.id } },
    orderBy: { lineNo: 'asc' },
    select: { id: true },
  });
  const portal = ctx.app.get(PortalQuotesService);
  const submission = ctx.app.get(QuoteSubmissionService);
  const form = (prices: [string, string], extra: Record<string, string> = {}) => {
    const values = d3Values(prices);
    return quoteFormSchema.parse({
      lines: { [lines[0].id]: values.lens, [lines[1].id]: values.reflector },
      ...extra,
    });
  };

  const lianchuang = await supplierActor(ctx, 'SUP10005');
  const xinneng = await supplierActor(ctx, 'SUP10003');
  const brightSource = await supplierActor(ctx, 'SUP10006');
  await atOffset(ctx, -44 * HOUR_MS, () => portal.detail(lianchuang, quoteOf('SUP10005')));
  await atOffset(ctx, -40 * HOUR_MS, () =>
    submission.submit(
      lianchuang,
      quoteOf('SUP10005'),
      form(['0.45', '1.85'], { remark: '含税含运费，送货到深圳宝安。', changeNote: '首次报价' }),
    ),
  );
  await atOffset(ctx, -30 * HOUR_MS, async () => {
    await portal.detail(xinneng, quoteOf('SUP10003'));
    await submission.decline(xinneng, quoteOf('SUP10003'), {
      reasonCode: 'LEAD_TIME',
      reason: '本月产线已排满，最早 45 天后才能交货，无法满足 30 天交期。',
    });
  });
  await atOffset(ctx, -26 * HOUR_MS, () => portal.detail(brightSource, quoteOf('SUP10006')));
  await atOffset(ctx, -3 * HOUR_MS, () =>
    submission.submit(
      lianchuang,
      quoteOf('SUP10005'),
      form(['0.42', '1.78'], {
        remark: '含税含运费，送货到深圳宝安。',
        changeNote: '原材料价格回落，两款统一下调单价。',
      }),
    ),
  );
  return inquiry.formalNo!;
}

/** D4 两行散热器报价（PPL-PERIPH 的必填列：含税单价、税率、交期、材质） */
function d4Values(prices: [string, string], leadTimeDays: number, brand: string): Record<string, unknown>[] {
  const common = {
    brand,
    material: '压铸铝 ADC12',
    tax_rate: '13',
    lead_time_days: leadTimeDays,
    moq: 3000,
    price_valid_until: '2027-06-30',
    payment_terms: 'NET60',
    sample_lead_days: 10,
    warranty_months: 36,
    rohs: true,
    packing_method: 'CARTON',
    trade_term: 'DAP',
  };
  return [
    { ...common, model: 'HS-80-45', unit_price_incl_tax: prices[0], pcs_per_carton: 100 },
    { ...common, model: 'HS-100-60', unit_price_incl_tax: prices[1], pcs_per_carton: 60 },
  ];
}

/**
 * D4：PJ-2026-003 / 散热器询价，开标·议价中。六天前建单审批、五天前发布给 SUP10003、SUP10004、SUP10006，
 * 三家都报了价（SUP10003 提交了 2 版，第 2 版降价），两天前截止、一天多前开标；入围 SUP10003、SUP10004；
 * 与 SUP10003 议价：采购方发目标价（加量、改表面处理）→ 供应商反提案，等采购方处理
 */
export async function seedD4(ctx: DemoContext): Promise<string> {
  const { pd, buyer, manager } = ctx.users;
  const deadline = inAppTz(new Date())
    .subtract(2, 'day')
    .hour(18)
    .minute(0)
    .second(0)
    .millisecond(0)
    .toDate();
  const inquiry = await atOffset(ctx, -6 * DAY_MS, async () => {
    const created = await ctx.app.get(InquiriesService).create(
      buyer,
      createInquirySchema.parse({
        projectNo: 'PJ-2026-003',
        title: '散热器询价',
        materialCategoryId: ctx.category['PER-HS'],
        currency: 'CNY',
        description: '筒灯与工矿灯配套散热器，表面阳极氧化，需提供盐雾测试报告。',
        ownerId: buyer.id,
        pdUserId: pd.id,
      }),
    );
    const lines = ctx.app.get(InquiryLinesService);
    await lines.createFromMaterials(
      buyer,
      created.id,
      1,
      linesFromMaterialsSchema.parse({
        items: [{ materialId: ctx.material['MAT-000007'], quantity: '10000' }],
      }),
    );
    await lines.create(
      buyer,
      created.id,
      1,
      createLineSchema.parse({
        source: 'MANUAL',
        nameZh: '压铸铝散热器（大）',
        nameEn: 'Die-cast Heat Sink (Large)',
        spec: 'Φ100 × 60mm / ADC12 / 银色阳极氧化',
        unitCode: 'PCS',
        categoryId: ctx.category['PER-HS'],
        quantity: '5000',
      }),
    );
    const workflow = ctx.app.get(InquiryWorkflowService);
    await workflow.submit(buyer, created.id);
    return workflow.approve(manager, created.id, approveInquirySchema.parse({}));
  });

  const suppliers = await ctx.prisma.supplier.findMany({
    where: { code: { in: ['SUP10003', 'SUP10004', 'SUP10006'] } },
    select: { id: true },
  });
  await atOffset(ctx, -5 * DAY_MS, async () => {
    await ctx.app
      .get(InquiryInviteesService)
      .replace(buyer, inquiry.id, updateInviteesSchema.parse({ supplierIds: suppliers.map((s) => s.id) }));
    await ctx.app
      .get(RoundWorkflowService)
      .publish(buyer, inquiry.id, 1, publishRoundSchema.parse({ deadline: deadline.toISOString() }));
  });

  const quotes = await ctx.prisma.quote.findMany({
    where: { round: { inquiryId: inquiry.id } },
    select: { id: true, supplier: { select: { code: true } } },
  });
  const quoteOf = (code: string) => quotes.find((q) => q.supplier.code === code)!.id;
  const lines = await ctx.prisma.inquiryLine.findMany({
    where: { round: { inquiryId: inquiry.id } },
    orderBy: { lineNo: 'asc' },
    select: { id: true },
  });
  const submission = ctx.app.get(QuoteSubmissionService);
  const form = (values: Record<string, unknown>[], extra: Record<string, string> = {}) =>
    quoteFormSchema.parse({ lines: { [lines[0].id]: values[0], [lines[1].id]: values[1] }, ...extra });

  const xinneng = await supplierActor(ctx, 'SUP10003');
  const jinggong = await supplierActor(ctx, 'SUP10004');
  const brightSource = await supplierActor(ctx, 'SUP10006');
  await atOffset(ctx, -4 * DAY_MS, () =>
    submission.submit(
      xinneng,
      quoteOf('SUP10003'),
      form(d4Values(['6.80', '9.50'], 25, '新能'), {
        remark: '含税含运费，送货到深圳宝安。',
        changeNote: '首次报价',
      }),
    ),
  );
  await atOffset(ctx, -4 * DAY_MS + 3 * HOUR_MS, () =>
    submission.submit(jinggong, quoteOf('SUP10004'), form(d4Values(['6.30', '9.80'], 35, '精工'))),
  );
  await atOffset(ctx, -3 * DAY_MS, () =>
    submission.submit(
      brightSource,
      quoteOf('SUP10006'),
      form(d4Values(['7.20', '9.00'], 40, 'Bright Source'), { remark: 'Price incl. VAT, DAP Shenzhen.' }),
    ),
  );
  await atOffset(ctx, -3 * DAY_MS + 5 * HOUR_MS, () =>
    submission.submit(
      xinneng,
      quoteOf('SUP10003'),
      form(d4Values(['6.50', '9.20'], 25, '新能'), {
        remark: '含税含运费，送货到深圳宝安。',
        changeNote: '铝锭价格回落，两款统一下调单价。',
      }),
    ),
  );

  // 截止任务关闭（截止在两天前 18:00），一天多前开标、入围
  await atOffset(ctx, deadline.getTime() - Date.now() + 60_000, () => ctx.app.get(RoundDeadlineJob).run());
  await atOffset(ctx, -DAY_MS - 4 * HOUR_MS, () =>
    ctx.app.get(RoundWorkflowService).open(manager, inquiry.id, 1),
  );
  await atOffset(ctx, -DAY_MS - 3 * HOUR_MS, () =>
    ctx.app.get(RoundShortlistService).save(buyer, inquiry.id, 1, [quoteOf('SUP10003'), quoteOf('SUP10004')]),
  );

  const negotiations = ctx.app.get(NegotiationsService);
  const offered = await atOffset(ctx, -20 * HOUR_MS, () =>
    negotiations.offer(
      buyer,
      quoteOf('SUP10003'),
      negotiationOfferSchema.parse({
        lines: [
          {
            lineId: lines[0].id,
            unitPriceInclTax: '6.00',
            quantity: '12000',
            specNote: '表面处理改为黑色阳极氧化',
          },
          { lineId: lines[1].id, unitPriceInclTax: '8.80' },
        ],
        content: '两款合计订货 17000 件，目标价如下，希望本周内确认。',
      }),
    ),
  );
  await atOffset(ctx, -6 * HOUR_MS, () =>
    negotiations.respond(
      xinneng,
      quoteOf('SUP10003'),
      negotiationRespondSchema.parse({
        type: 'COUNTER',
        replyToId: offered.messages.at(-1)!.id,
        lines: [
          {
            lineId: lines[0].id,
            unitPriceInclTax: '6.20',
            quantity: '12000',
            specNote: '黑色阳极氧化，费用已含在单价内',
          },
          { lineId: lines[1].id, unitPriceInclTax: '9.00' },
        ],
        content: '铝价仍在高位，最低可做到如下价格；第 1 款数量 12000 件可以接受。',
      }),
    ),
  );
  return inquiry.formalNo!;
}
