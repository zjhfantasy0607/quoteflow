// 演示场景（docs/06-种子数据.md §3）。单据一律通过 service 方法创建，状态和不变量与真实操作一致。
// 哪个模块完成就在这里补哪个场景：M06 → D1、D2；M09 → D3；M11 → D4；M12 → D5；M13 → D6；M14 → D7；
// M15 的历史数据 H 在 history.ts。
import type { INestApplicationContext } from '@nestjs/common';
import {
  approveInquirySchema,
  attachInquiryFileSchema,
  awardRoundSchema,
  changeRoundSchema,
  contractDecisionSchema,
  createInquirySchema,
  createLineSchema,
  linesFromMaterialsSchema,
  negotiationOfferSchema,
  negotiationRespondSchema,
  publishRoundSchema,
  quoteFormSchema,
  updateInviteesSchema,
  updateContractSchema,
  updateLineSchema,
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
import { RoundAwardService } from '../../src/modules/inquiries/round-award.service';
import { RoundChangeService } from '../../src/modules/inquiries/round-change.service';
import { RoundDeadlineJob } from '../../src/modules/inquiries/round-deadline.job';
import { RoundWorkflowService } from '../../src/modules/inquiries/round-workflow.service';
import { NegotiationsService } from '../../src/modules/negotiations/negotiations.service';
import { PortalQuotesService } from '../../src/modules/portal/portal-quotes.service';
import { QuoteSubmissionService } from '../../src/modules/portal/quote-submission.service';
import { ContractsService } from '../../src/modules/contracts/contracts.service';
import { RoundShortlistService } from '../../src/modules/quotes/round-shortlist.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { demoPdf, demoPng } from './demo-files';

export interface DemoContext {
  app: INestApplicationContext;
  prisma: PrismaService;
  users: Record<'pd' | 'buyer' | 'buyerLi' | 'manager' | 'approver', AuthUser>;
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
      buyerLi: await actor('buyer.li'),
      manager: await actor('manager.zhang'),
      approver: await actor('approver.zhao'),
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
export async function supplierActor(ctx: DemoContext, supplierCode: string): Promise<AuthUser> {
  const user = await ctx.prisma.user.findFirst({
    where: { supplier: { code: supplierCode }, userType: 'SUPPLIER', status: 'ACTIVE' },
    include: userWithRolesInclude,
  });
  if (!user)
    throw new Error(`seed-demo: portal account of ${supplierCode} not found, run "npm run db:seed" first`);
  return buildAuthUser(user, 'seed-demo', { ip: null, userAgent: null });
}

/** 把时钟拨到"现在 + offsetMs"（负数 = 过去）执行 run，结束后拨回（06 §1） */
export async function atOffset<T>(ctx: DemoContext, offsetMs: number, run: () => Promise<T>): Promise<T> {
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

/** D5 两行防水连接器报价（PPL-PERIPH 的必填列：含税单价、税率、交期、材质） */
function d5Values(
  prices: [string, string],
  leadTimeDays: number,
  brand: string,
  paymentTerms: string,
): Record<string, unknown>[] {
  const common = {
    brand,
    material: 'PA66 + 硅胶密封圈',
    tax_rate: '13',
    lead_time_days: leadTimeDays,
    moq: 5000,
    price_valid_until: '2027-06-30',
    payment_terms: paymentTerms,
    sample_lead_days: 5,
    warranty_months: 24,
    rohs: true,
    reach: true,
    packing_method: 'BAG',
    trade_term: 'DAP',
  };
  return [
    { ...common, model: 'WC-2P-10A', unit_price_incl_tax: prices[0], pcs_per_carton: 1000 },
    { ...common, model: 'WC-3P-10A', unit_price_incl_tax: prices[1], pcs_per_carton: 800 },
  ];
}

/**
 * D5：PJ-2026-004 / 防水连接器询价，评标完成。十天前建单审批、九天前发布给 SUP10004、SUP10003、SUP10006，
 * SUP10004、SUP10003 报价，SUP10006 拒绝（价格）；五天前截止、四天前开标，入围 SUP10004、SUP10003；
 * 与 SUP10004 议价：目标价 → 接受（成交生成新版本）；两天前采购主管定标 SUP10004，自动生成合同草稿
 */
export async function seedD5(ctx: DemoContext): Promise<string> {
  const { pd, buyer, manager } = ctx.users;
  const deadline = inAppTz(new Date())
    .subtract(5, 'day')
    .hour(18)
    .minute(0)
    .second(0)
    .millisecond(0)
    .toDate();
  const inquiry = await atOffset(ctx, -10 * DAY_MS, async () => {
    const created = await ctx.app.get(InquiriesService).create(
      buyer,
      createInquirySchema.parse({
        projectNo: 'PJ-2026-004',
        title: '防水连接器询价',
        materialCategoryId: ctx.category['PER-CONN'],
        currency: 'CNY',
        description: '户外投光灯与线条灯配套，IP68，需提供盐雾与浸水测试报告。',
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
        items: [{ materialId: ctx.material['MAT-000008'], quantity: '30000' }],
      }),
    );
    await lines.create(
      buyer,
      created.id,
      1,
      createLineSchema.parse({
        source: 'MANUAL',
        nameZh: '防水连接器 3P',
        nameEn: 'Waterproof Connector 3P',
        spec: 'IP68 / 3PIN / 10A',
        unitCode: 'PCS',
        categoryId: ctx.category['PER-CONN'],
        quantity: '10000',
      }),
    );
    const workflow = ctx.app.get(InquiryWorkflowService);
    await workflow.submit(buyer, created.id);
    return workflow.approve(manager, created.id, approveInquirySchema.parse({}));
  });

  const suppliers = await ctx.prisma.supplier.findMany({
    where: { code: { in: ['SUP10004', 'SUP10003', 'SUP10006'] } },
    select: { id: true },
  });
  await atOffset(ctx, -9 * DAY_MS, async () => {
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

  const jinggong = await supplierActor(ctx, 'SUP10004');
  const xinneng = await supplierActor(ctx, 'SUP10003');
  const brightSource = await supplierActor(ctx, 'SUP10006');
  await atOffset(ctx, -8 * DAY_MS, () =>
    submission.submit(
      jinggong,
      quoteOf('SUP10004'),
      form(d5Values(['1.85', '2.60'], 20, '精工', 'NET30'), {
        remark: '含税含运费，送货到深圳宝安；可提供 IP68 浸水测试报告。',
        changeNote: '首次报价',
      }),
    ),
  );
  await atOffset(ctx, -8 * DAY_MS + 4 * HOUR_MS, () =>
    submission.submit(xinneng, quoteOf('SUP10003'), form(d5Values(['1.95', '2.45'], 25, '新能', 'NET60'))),
  );
  await atOffset(ctx, -7 * DAY_MS, () =>
    submission.decline(brightSource, quoteOf('SUP10006'), {
      reasonCode: 'PRICE',
      reason: 'Our connector line is focused on export models; we cannot meet the target price range.',
    }),
  );

  // 截止任务关闭（截止在五天前 18:00），四天前开标、入围
  await atOffset(ctx, deadline.getTime() - Date.now() + 60_000, () => ctx.app.get(RoundDeadlineJob).run());
  await atOffset(ctx, -4 * DAY_MS, () => ctx.app.get(RoundWorkflowService).open(manager, inquiry.id, 1));
  await atOffset(ctx, -4 * DAY_MS + HOUR_MS, () =>
    ctx.app.get(RoundShortlistService).save(buyer, inquiry.id, 1, [quoteOf('SUP10004'), quoteOf('SUP10003')]),
  );

  // 与 SUP10004 议价：目标价 → 接受（成交生成第 2 版）
  const negotiations = ctx.app.get(NegotiationsService);
  const offered = await atOffset(ctx, -3 * DAY_MS, () =>
    negotiations.offer(
      buyer,
      quoteOf('SUP10004'),
      negotiationOfferSchema.parse({
        lines: [{ lineId: lines[0].id, unitPriceInclTax: '1.75' }],
        content: '2P 款年用量 30000 件，希望单价降到 1.75，其余条件不变。',
      }),
    ),
  );
  await atOffset(ctx, -3 * DAY_MS + 5 * HOUR_MS, () =>
    negotiations.respond(
      jinggong,
      quoteOf('SUP10004'),
      negotiationRespondSchema.parse({
        type: 'ACCEPT',
        replyToId: offered.messages.at(-1)!.id,
        content: '同意目标价，交期 20 天不变。',
      }),
    ),
  );

  // 两天前定标：SUP10004 中标、SUP10003 未中标，生成合同草稿，发中标与结果通知
  await atOffset(ctx, -2 * DAY_MS, () =>
    ctx.app
      .get(RoundAwardService)
      .award(
        manager,
        inquiry.id,
        1,
        awardRoundSchema.parse({ quoteId: quoteOf('SUP10004'), comment: '议价后综合价格最低，交期最短。' }),
      ),
  );
  return inquiry.formalNo!;
}

/** D6 两行 COB 报价（PPL-LED 的必填列：功率、色温、显色指数、光通量、含税单价、税率、交期） */
function d6Values(
  rows: { power: string; cct: number; flux: string; price: string }[],
  cri: number,
  leadTimeDays: number,
): Record<string, unknown>[] {
  return rows.map((r) => ({
    power_w: r.power,
    cct_k: r.cct,
    cri_ra: cri,
    luminous_flux_lm: r.flux,
    unit_price_incl_tax: r.price,
    tax_rate: '13',
    lead_time_days: leadTimeDays,
  }));
}

/**
 * D6：PJ-2026-005 / COB 灯珠询价，第 2 轮等待报价。六天前建单审批、五天前发布第 1 轮给 SUP10001、SUP10006、SUP10002，
 * SUP10001、SUP10006 报了价（SUP10002 未响应）；两天前 PD 发起规格变更（显色指数 Ra80 → Ra90，第 2 行功率 15W → 12W，
 * 技术要求换成 V2），采购员确认发布第 2 轮：第 1 轮作废、从未开标所以永久密封，三家收到变更通知；一天前 SUP10001 报了第 2 轮
 */
export async function seedD6(ctx: DemoContext): Promise<string> {
  const { pd, buyer, manager } = ctx.users;
  const at18 = (days: number) =>
    inAppTz(new Date()).add(days, 'day').hour(18).minute(0).second(0).millisecond(0).toDate();
  const led = ctx.category['LED-COB'];
  const inquiry = await atOffset(ctx, -6 * DAY_MS, async () => {
    const created = await ctx.app.get(InquiriesService).create(
      buyer,
      createInquirySchema.parse({
        projectNo: 'PJ-2026-005',
        title: 'COB 灯珠询价',
        materialCategoryId: led,
        currency: 'CNY',
        description: '轨道灯与筒灯用 COB 光源，需提供 LM-80 报告与色容差（≤ 3 SDCM）数据。',
        ownerId: buyer.id,
        pdUserId: pd.id,
      }),
    );
    const lines = ctx.app.get(InquiryLinesService);
    const rows = [
      ['COB 灯珠（中性光）', 'COB LED (Neutral White)', 'COB / 10W / 30V / 300mA / 4000K / Ra80', '20000'],
      ['COB 灯珠（暖白）', 'COB LED (Warm White)', 'COB / 15W / 36V / 420mA / 3000K / Ra80', '8000'],
    ];
    for (const [nameZh, nameEn, spec, quantity] of rows) {
      await lines.create(
        buyer,
        created.id,
        1,
        createLineSchema.parse({
          source: 'MANUAL',
          nameZh,
          nameEn,
          spec,
          unitCode: 'PCS',
          categoryId: led,
          quantity,
        }),
      );
    }
    const spec = await upload(
      ctx,
      buyer,
      'SPEC_DOC',
      'COB 灯珠技术要求 V1.pdf',
      demoPdf(['COB LED Requirements V1 (demo)', 'Project: PJ-2026-005', 'CRI: Ra80', 'SDCM <= 3']),
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
    where: { code: { in: ['SUP10001', 'SUP10006', 'SUP10002'] } },
    select: { id: true },
  });
  await atOffset(ctx, -5 * DAY_MS, async () => {
    await ctx.app
      .get(InquiryInviteesService)
      .replace(buyer, inquiry.id, updateInviteesSchema.parse({ supplierIds: suppliers.map((s) => s.id) }));
    await ctx.app
      .get(RoundWorkflowService)
      .publish(buyer, inquiry.id, 1, publishRoundSchema.parse({ deadline: at18(2).toISOString() }));
  });

  const quoteIdsOf = async (roundNo: number) => {
    const quotes = await ctx.prisma.quote.findMany({
      where: { round: { inquiryId: inquiry.id, roundNo } },
      select: { id: true, supplier: { select: { code: true } } },
    });
    return (code: string) => quotes.find((q) => q.supplier.code === code)!.id;
  };
  const lineIdsOf = async (roundNo: number) =>
    (
      await ctx.prisma.inquiryLine.findMany({
        where: { round: { inquiryId: inquiry.id, roundNo } },
        orderBy: { lineNo: 'asc' },
        select: { id: true },
      })
    ).map((l) => l.id);
  const submission = ctx.app.get(QuoteSubmissionService);
  const form = (lineIds: string[], values: Record<string, unknown>[], extra: Record<string, string> = {}) =>
    quoteFormSchema.parse({ lines: Object.fromEntries(lineIds.map((id, i) => [id, values[i]])), ...extra });

  const huaxin = await supplierActor(ctx, 'SUP10001');
  const brightSource = await supplierActor(ctx, 'SUP10006');
  const round1 = await quoteIdsOf(1);
  const lines1 = await lineIdsOf(1);
  const ra80 = [
    { power: '10', cct: 4000, flux: '1300', price: '6.80' },
    { power: '15', cct: 3000, flux: '1850', price: '9.60' },
  ];
  await atOffset(ctx, -4 * DAY_MS, () =>
    submission.submit(
      huaxin,
      round1('SUP10001'),
      form(lines1, d6Values(ra80, 80, 20), {
        remark: '含税含运费，送货到深圳宝安。',
        changeNote: '首次报价',
      }),
    ),
  );
  await atOffset(ctx, -4 * DAY_MS + 6 * HOUR_MS, () =>
    submission.submit(brightSource, round1('SUP10006'), form(lines1, d6Values(ra80, 80, 30))),
  );

  // 两天前 PD 发起规格变更：两行改为 Ra90，第 2 行功率 15W → 12W，技术要求换成 V2
  await atOffset(ctx, -2 * DAY_MS, async () => {
    const draft = await ctx.app.get(RoundChangeService).create(
      pd,
      inquiry.id,
      changeRoundSchema.parse({
        changeReason: '显色指数 Ra80 → Ra90',
        changeSummary:
          '两款 COB 的显色指数统一提高到 Ra90；第 2 行（暖白）功率由 15W 调整为 12W；技术要求更新为 V2。',
      }),
    );
    const lines = ctx.app.get(InquiryLinesService);
    const specs = ['COB / 10W / 30V / 300mA / 4000K / Ra90', 'COB / 12W / 36V / 330mA / 3000K / Ra90'];
    for (const [i, line] of draft.lines.entries()) {
      await lines.update(
        pd,
        inquiry.id,
        2,
        line.id,
        updateLineSchema.parse({
          source: 'MANUAL',
          nameZh: line.nameZh,
          nameEn: line.nameEn ?? undefined,
          spec: specs[i],
          unitCode: line.unitCode,
          categoryId: line.category.id,
          quantity: line.quantity,
        }),
      );
    }
    const files = ctx.app.get(InquiryFilesService);
    await files.remove(pd, inquiry.id, 2, draft.files[0].id);
    const v2 = await upload(
      ctx,
      pd,
      'SPEC_DOC',
      'COB 灯珠技术要求 V2.pdf',
      demoPdf(['COB LED Requirements V2 (demo)', 'Project: PJ-2026-005', 'CRI: Ra90 (R9 > 50)', 'SDCM <= 3']),
    );
    await files.attach(
      pd,
      inquiry.id,
      2,
      attachInquiryFileSchema.parse({ fileId: v2, kind: 'SPEC_DOC', lineId: null }),
    );
  });
  // 采购员确认发布第 2 轮：第 1 轮作废（从未开标，永久密封），三家都收到变更通知
  await atOffset(ctx, -2 * DAY_MS + 2 * HOUR_MS, () =>
    ctx.app
      .get(RoundWorkflowService)
      .publish(buyer, inquiry.id, 2, publishRoundSchema.parse({ deadline: at18(4).toISOString() })),
  );

  const round2 = await quoteIdsOf(2);
  const lines2 = await lineIdsOf(2);
  const ra90 = [
    { power: '10', cct: 4000, flux: '1250', price: '7.30' },
    { power: '12', cct: 3000, flux: '1450', price: '8.90' },
  ];
  await atOffset(ctx, -DAY_MS, () =>
    submission.submit(
      huaxin,
      round2('SUP10001'),
      form(lines2, d6Values(ra90, 90, 25), {
        remark: '含税含运费，送货到深圳宝安。',
        changeNote: '按 Ra90 规格重新报价，交期 25 天。',
      }),
    ),
  );
  return inquiry.formalNo!;
}

/** D7 两行灯具支架报价（PPL-PERIPH 的必填列：含税单价、税率、交期、材质） */
function d7Values(prices: [string, string], leadTimeDays: number, brand: string): Record<string, unknown>[] {
  const common = {
    brand,
    material: 'SPCC 冷轧钢板',
    tax_rate: '13',
    lead_time_days: leadTimeDays,
    moq: 2000,
    price_valid_until: '2027-06-30',
    payment_terms: 'NET30',
    sample_lead_days: 7,
    warranty_months: 24,
    rohs: true,
    packing_method: 'CARTON',
    trade_term: 'DAP',
  };
  return [
    { ...common, model: 'BK-120-W', unit_price_incl_tax: prices[0], pcs_per_carton: 200 },
    { ...common, model: 'BK-300-B', unit_price_incl_tax: prices[1], pcs_per_carton: 100 },
  ];
}

/**
 * D7：PJ-2026-006 / 灯具支架询价，合同已批准。十五天前建单审批、十四天前发布给 SUP10003、SUP10004，两家都报价；
 * 十天前截止、九天前开标，八天前采购主管定标 SUP10003 生成合同草稿；七天前采购员补充交付与付款条款提交审核，
 * 六天前采购主管审核通过，五天前合同批准人批准
 */
export async function seedD7(ctx: DemoContext): Promise<string> {
  const { pd, buyer, manager, approver } = ctx.users;
  const deadline = inAppTz(new Date())
    .subtract(10, 'day')
    .hour(18)
    .minute(0)
    .second(0)
    .millisecond(0)
    .toDate();
  const bracket = ctx.category['PER-BRKT'];
  const inquiry = await atOffset(ctx, -15 * DAY_MS, async () => {
    const created = await ctx.app.get(InquiriesService).create(
      buyer,
      createInquirySchema.parse({
        projectNo: 'PJ-2026-006',
        title: '灯具支架询价',
        materialCategoryId: bracket,
        currency: 'CNY',
        description: '筒灯与线条灯安装支架，表面喷涂，需提供盐雾测试报告。',
        ownerId: buyer.id,
        pdUserId: pd.id,
      }),
    );
    const lines = ctx.app.get(InquiryLinesService);
    await lines.createFromMaterials(
      buyer,
      created.id,
      1,
      linesFromMaterialsSchema.parse({ items: [{ materialId: ctx.material['MAT-000010'], quantity: '15000' }] }),
    );
    await lines.create(
      buyer,
      created.id,
      1,
      createLineSchema.parse({
        source: 'MANUAL',
        nameZh: '灯具支架（加长）',
        nameEn: 'Lamp Bracket (Long)',
        spec: 'SPCC 1.5mm / 黑色喷涂 / 长 300mm',
        unitCode: 'PCS',
        categoryId: bracket,
        quantity: '5000',
      }),
    );
    const workflow = ctx.app.get(InquiryWorkflowService);
    await workflow.submit(buyer, created.id);
    return workflow.approve(manager, created.id, approveInquirySchema.parse({}));
  });

  const suppliers = await ctx.prisma.supplier.findMany({
    where: { code: { in: ['SUP10003', 'SUP10004'] } },
    select: { id: true },
  });
  await atOffset(ctx, -14 * DAY_MS, async () => {
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
  await atOffset(ctx, -13 * DAY_MS, () =>
    submission.submit(
      xinneng,
      quoteOf('SUP10003'),
      form(d7Values(['3.20', '5.80'], 20, '新能'), { remark: '含税含运费，送货到深圳宝安。' }),
    ),
  );
  await atOffset(ctx, -13 * DAY_MS + 5 * HOUR_MS, () =>
    submission.submit(jinggong, quoteOf('SUP10004'), form(d7Values(['3.35', '5.60'], 25, '精工'))),
  );

  // 截止任务关闭（截止在十天前 18:00），九天前开标，八天前定标 SUP10003
  await atOffset(ctx, deadline.getTime() - Date.now() + 60_000, () => ctx.app.get(RoundDeadlineJob).run());
  await atOffset(ctx, -9 * DAY_MS, () => ctx.app.get(RoundWorkflowService).open(manager, inquiry.id, 1));
  const awarded = await atOffset(ctx, -8 * DAY_MS, () =>
    ctx.app
      .get(RoundAwardService)
      .award(
        manager,
        inquiry.id,
        1,
        awardRoundSchema.parse({ quoteId: quoteOf('SUP10003'), comment: '合计最低，交期 20 天。' }),
      ),
  );

  // 合同：补充交付与付款条款 → 提交审核 → 审核通过 → 批准
  const contractId = awarded.award!.contract!.id;
  const contracts = ctx.app.get(ContractsService);
  await atOffset(ctx, -7 * DAY_MS, async () => {
    await contracts.update(
      buyer,
      contractId,
      updateContractSchema.parse({
        deliveryDate: inAppTz(new Date()).add(23, 'day').format('YYYY-MM-DD'),
        deliveryPlace: '深圳市宝安区福永街道示例工业园 3 栋',
        paymentTerms: '货到验收后 30 天付款',
        summary: '灯具支架 2 款，共 20000 件，分两批交货。',
        remark: '第一批 12000 件，第二批 8000 件。',
      }),
    );
    await contracts.submit(buyer, contractId);
  });
  await atOffset(ctx, -6 * DAY_MS, () =>
    contracts.review(manager, contractId, contractDecisionSchema.parse({ action: 'APPROVE', comment: '条款齐全' })),
  );
  await atOffset(ctx, -5 * DAY_MS, () =>
    contracts.approve(approver, contractId, contractDecisionSchema.parse({ action: 'APPROVE' })),
  );
  return inquiry.formalNo!;
}
