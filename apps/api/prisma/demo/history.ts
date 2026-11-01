// 历史演示数据 H（docs/06-种子数据.md §3，M15 R15-5）：过去一年约 60 张已完成的询价，供统计看板和报表使用。
// 和 D1–D7 一样全部通过 service 方法、按当时的时间（时钟偏移）创建，02 §3 的不变量由业务代码保证；
// 项目号一律 HIST- 开头。随机数用固定种子，每次生成的数据相同。
import {
  approveInquirySchema,
  awardRoundSchema,
  contractDecisionSchema,
  createInquirySchema,
  createLineSchema,
  Dec,
  linesFromMaterialsSchema,
  pointsAdjustSchema,
  publishRoundSchema,
  quoteFormSchema,
  updateContractSchema,
  updateInviteesSchema,
} from '@quoteflow/shared';
import type { AuthUser } from '../../src/common/auth/auth-user';
import { inAppTz } from '../../src/common/time';
import { ContractsService } from '../../src/modules/contracts/contracts.service';
import { InquiriesService } from '../../src/modules/inquiries/inquiries.service';
import { InquiryInviteesService } from '../../src/modules/inquiries/inquiry-invitees.service';
import { InquiryLinesService } from '../../src/modules/inquiries/inquiry-lines.service';
import { InquiryWorkflowService } from '../../src/modules/inquiries/inquiry-workflow.service';
import { RoundAwardService } from '../../src/modules/inquiries/round-award.service';
import { RoundDeadlineJob } from '../../src/modules/inquiries/round-deadline.job';
import { RoundWorkflowService } from '../../src/modules/inquiries/round-workflow.service';
import { PointsService } from '../../src/modules/points/points.service';
import { PortalQuotesService } from '../../src/modules/portal/portal-quotes.service';
import { QuoteSubmissionService } from '../../src/modules/portal/quote-submission.service';
import { atOffset, supplierActor, type DemoContext } from './scenarios';

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** 可复现的伪随机数（mulberry32） */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Line {
  nameZh: string;
  nameEn: string;
  spec: string;
  unitCode: string;
}

/** 一种材料：询价行、价格区间（含税单价）、数量区间、PPL 必填的规格取值、会邀请的供应商 */
interface Kind {
  category: string;
  weight: number;
  title: string;
  /** 材料库里的物料；没有就用 manual 当第一行 */
  material?: string;
  /** 第二行（或第一行）用的手工行 */
  manual: Line;
  price: [number, number];
  dp: number;
  quantity: [number, number];
  /** PPL 变体的必填列（PPL-LED：功率、色温、显色、光通量；PPL-PERIPH：材质） */
  spec: Record<string, unknown>;
  packing: string;
  hsCode: string;
  suppliers: string[];
}

const KINDS: Kind[] = [
  {
    category: 'LED-2835',
    weight: 10,
    title: '2835 灯珠询价',
    material: 'MAT-000001',
    manual: {
      nameZh: '2835 灯珠（暖白）',
      nameEn: '2835 SMD LED (Warm White)',
      spec: '2835 / 0.5W / 6V / 150mA / 3000K / Ra80',
      unitCode: 'PCS',
    },
    price: [0.07, 0.12],
    dp: 4,
    quantity: [100_000, 500_000],
    spec: { power_w: '0.5', cct_k: 6500, cri_ra: 80, luminous_flux_lm: '60' },
    packing: 'REEL',
    hsCode: '8541410000',
    suppliers: ['SUP10001', 'SUP10006', 'SUP10002'],
  },
  {
    category: 'LED-3030',
    weight: 5,
    title: '3030 灯珠询价',
    manual: {
      nameZh: '3030 灯珠',
      nameEn: '3030 SMD LED',
      spec: '3030 / 1W / 6V / 150mA / 5000K / Ra80',
      unitCode: 'PCS',
    },
    price: [0.15, 0.25],
    dp: 4,
    quantity: [50_000, 200_000],
    spec: { power_w: '1', cct_k: 5000, cri_ra: 80, luminous_flux_lm: '130' },
    packing: 'REEL',
    hsCode: '8541410000',
    suppliers: ['SUP10001', 'SUP10006'],
  },
  {
    category: 'LED-COB',
    weight: 6,
    title: 'COB 灯珠询价',
    material: 'MAT-000002',
    manual: {
      nameZh: 'COB 灯珠（暖白）',
      nameEn: 'COB LED (Warm White)',
      spec: 'COB / 15W / 36V / 420mA / 3000K / Ra90',
      unitCode: 'PCS',
    },
    price: [6, 9.5],
    dp: 2,
    quantity: [5_000, 30_000],
    spec: { power_w: '10', cct_k: 4000, cri_ra: 80, luminous_flux_lm: '1300' },
    packing: 'TRAY',
    hsCode: '8541410000',
    suppliers: ['SUP10001', 'SUP10006', 'SUP10002'],
  },
  {
    category: 'PER-LENS',
    weight: 6,
    title: '透镜询价',
    material: 'MAT-000003',
    manual: { nameZh: 'PC 透镜 30°', nameEn: 'PC Lens 30°', spec: 'Φ20mm / 30° / PC', unitCode: 'PCS' },
    price: [0.38, 0.6],
    dp: 3,
    quantity: [10_000, 50_000],
    spec: { material: 'PC（光学级）' },
    packing: 'TRAY',
    hsCode: '9001900090',
    suppliers: ['SUP10005', 'SUP10006', 'SUP10003'],
  },
  {
    category: 'PER-REFL',
    weight: 4,
    title: '反光杯询价',
    material: 'MAT-000004',
    manual: {
      nameZh: '铝反光杯（深杯）',
      nameEn: 'Aluminum Reflector (Deep)',
      spec: 'Φ50 × 40mm / 15°',
      unitCode: 'PCS',
    },
    price: [1.6, 2.1],
    dp: 2,
    quantity: [10_000, 40_000],
    spec: { material: '铝（阳极氧化）' },
    packing: 'CARTON',
    hsCode: '9405990000',
    suppliers: ['SUP10005', 'SUP10003'],
  },
  {
    category: 'PER-BRKT',
    weight: 5,
    title: '灯具支架询价',
    material: 'MAT-000010',
    manual: {
      nameZh: '灯具支架（加长）',
      nameEn: 'Lamp Bracket (Long)',
      spec: 'SPCC 1.5mm / 黑色喷涂 / 长 300mm',
      unitCode: 'PCS',
    },
    price: [3, 6],
    dp: 2,
    quantity: [5_000, 20_000],
    spec: { material: 'SPCC 冷轧钢板' },
    packing: 'CARTON',
    hsCode: '7326909000',
    suppliers: ['SUP10003', 'SUP10004', 'SUP10005'],
  },
  {
    category: 'DRV-CC',
    weight: 6,
    title: '恒流驱动电源询价',
    material: 'MAT-000005',
    manual: {
      nameZh: '恒流驱动电源 20W',
      nameEn: 'CC LED Driver 20W',
      spec: 'AC220V / DC27–36V / 600mA / PF>0.9',
      unitCode: 'PCS',
    },
    price: [12, 18],
    dp: 2,
    quantity: [2_000, 10_000],
    spec: { material: '阻燃 PC 外壳' },
    packing: 'CARTON',
    hsCode: '8504409999',
    suppliers: ['SUP10002', 'SUP10006', 'SUP10008'],
  },
  {
    category: 'DRV-CV',
    weight: 3,
    title: '恒压驱动电源询价',
    material: 'MAT-000006',
    manual: {
      nameZh: '恒压驱动电源 60W',
      nameEn: 'CV LED Driver 60W',
      spec: 'AC220V / DC24V / 60W / IP67',
      unitCode: 'PCS',
    },
    price: [25, 40],
    dp: 2,
    quantity: [1_000, 5_000],
    spec: { material: '铝合金外壳' },
    packing: 'CARTON',
    hsCode: '8504409999',
    suppliers: ['SUP10002', 'SUP10006', 'SUP10008'],
  },
  {
    category: 'PER-HS',
    weight: 5,
    title: '散热器询价',
    material: 'MAT-000007',
    manual: {
      nameZh: '压铸铝散热器（大）',
      nameEn: 'Die-cast Heat Sink (Large)',
      spec: 'Φ100 × 60mm / ADC12',
      unitCode: 'PCS',
    },
    price: [6, 10],
    dp: 2,
    quantity: [3_000, 15_000],
    spec: { material: '压铸铝 ADC12' },
    packing: 'CARTON',
    hsCode: '7616999000',
    suppliers: ['SUP10003', 'SUP10004', 'SUP10006'],
  },
  {
    category: 'PER-CONN',
    weight: 5,
    title: '防水连接器询价',
    material: 'MAT-000008',
    manual: {
      nameZh: '防水连接器 3P',
      nameEn: 'Waterproof Connector 3P',
      spec: 'IP68 / 3PIN / 10A',
      unitCode: 'PCS',
    },
    price: [1.8, 2.8],
    dp: 2,
    quantity: [10_000, 40_000],
    spec: { material: 'PA66 + 硅胶密封圈' },
    packing: 'BAG',
    hsCode: '8536690000',
    suppliers: ['SUP10004', 'SUP10003', 'SUP10006'],
  },
  {
    category: 'PER-WIRE',
    weight: 3,
    title: '硅胶线询价',
    material: 'MAT-000009',
    manual: {
      nameZh: '硅胶线 20AWG',
      nameEn: 'Silicone Wire 20AWG',
      spec: '20AWG / 200℃ / 红黑',
      unitCode: 'M',
    },
    price: [2, 3.2],
    dp: 2,
    quantity: [5_000, 20_000],
    spec: { material: '镀锡铜 + 硅胶' },
    packing: 'REEL',
    hsCode: '8544492100',
    suppliers: ['SUP10004', 'SUP10003'],
  },
];

/** 产品项目：一个项目会针对不同材料多次询价（#1） */
const PROJECTS = [
  '筒灯 D 系列',
  '线条灯 L 系列',
  '投光灯 F 系列',
  '工矿灯 H 系列',
  '轨道灯 T 系列',
  '面板灯 P 系列',
  '吸顶灯 C 系列',
  '户外壁灯 W 系列',
  '天花灯 S 系列',
  '洗墙灯 X 系列',
];

/** 响应方式：≤2 小时、2–8 小时、8–24 小时、1–3 天、>3 天（小时区间），或者拒绝、不响应 */
const RESPONSE_HOURS: [number, number][] = [
  [0.2, 2],
  [2.1, 8],
  [8.2, 24],
  [24.5, 72],
  [73, 110],
];
type Response = { kind: 'quote' | 'decline'; hours: number } | { kind: 'none' };

/** 各家的响应习惯（权重：五个时长区间、拒绝、不响应）与报价水平 */
const SUPPLIERS: Record<string, { weights: number[]; factor: number; city: string; trade: string }> = {
  SUP10001: { weights: [45, 35, 12, 5, 0, 1, 2], factor: 0.97, city: '深圳', trade: 'DAP' },
  SUP10002: { weights: [8, 30, 32, 17, 5, 3, 5], factor: 1.01, city: '上海', trade: 'DAP' },
  SUP10003: { weights: [20, 40, 22, 10, 2, 4, 2], factor: 1.0, city: '苏州', trade: 'DAP' },
  SUP10004: { weights: [12, 25, 30, 20, 5, 5, 3], factor: 0.99, city: '宁波', trade: 'FOB' },
  SUP10005: { weights: [35, 40, 15, 5, 0, 2, 3], factor: 0.98, city: '广州', trade: 'DAP' },
  SUP10006: { weights: [10, 28, 30, 17, 5, 5, 5], factor: 1.03, city: 'Hong Kong', trade: 'CIF' },
  // 没开通门户账号，收得到邀请但报不了价（R07-6）
  SUP10008: { weights: [0, 0, 0, 0, 0, 0, 1], factor: 1, city: 'Stockholm', trade: 'CIF' },
};

/** 询盘周期（天）：≤3、4–7、8–14、15–30、>30 天的权重 */
const CYCLES: { range: [number, number]; weight: number }[] = [
  { range: [2, 3], weight: 15 },
  { range: [3.5, 7], weight: 35 },
  { range: [7.5, 14], weight: 30 },
  { range: [14.5, 30], weight: 15 },
  { range: [31, 42], weight: 5 },
];

const PAYMENT_TERMS: Record<string, string> = {
  NET30: '货到验收后 30 天付款',
  NET60: '货到验收后 60 天付款',
};
const AWARD_COMMENTS = [
  '综合价格最低。',
  '价格与交期综合最优。',
  '报价最低，历史交货稳定。',
  '交期更短，质量稳定。',
];

/** 历史数据的项目号前缀（R15-5） */
export const HISTORY_PROJECT_PREFIX = 'HIST-';

export interface HistoryOptions {
  /** 询价单张数，默认 60 */
  count?: number;
  /** 最早一张在多少天前发布，默认 360 */
  spanDays?: number;
  seed?: number;
}

export interface HistoryResult {
  inquiries: number;
  contracts: number;
  emails: number;
}

/**
 * H：过去一年（发布在 spanDays 天前到 25 天前之间，大致均匀分布）、各材料分类的已完成询价。每张单：采购员建单 → 主管审批 →
 * 发布给 2–4 家 → 各家按自己的响应习惯报价、拒绝或不响应 → 截止 → 主管开标 → 定标（多数给最低价）→ 合同提交、审核、批准；
 * 另有几条手工调整积分。历史邮件在当时就已发出，造完后标记为已发送（不再发到 Mailpit）
 */
export async function seedHistory(ctx: DemoContext, options: HistoryOptions = {}): Promise<HistoryResult> {
  const count = options.count ?? 60;
  const spanDays = options.spanDays ?? 360;
  const rand = random(options.seed ?? 20261031);
  const between = (min: number, max: number) => min + (max - min) * rand();
  const pickWeighted = <T>(items: T[], weight: (item: T) => number): T => {
    let r = rand() * items.reduce((sum, i) => sum + weight(i), 0);
    for (const item of items) {
      r -= weight(item);
      if (r < 0) return item;
    }
    return items[items.length - 1];
  };
  const at = <T>(time: number, run: () => Promise<T>) => atOffset(ctx, time - Date.now(), run);
  const { buyer, buyerLi, manager, approver, pd } = ctx.users;

  const suppliers = await ctx.prisma.supplier.findMany({ select: { id: true, code: true } });
  const supplierId = (code: string) => suppliers.find((s) => s.code === code)!.id;
  const portalActors = new Map<string, AuthUser>();
  const actorOf = async (code: string) => {
    if (!portalActors.has(code)) portalActors.set(code, await supplierActor(ctx, code));
    return portalActors.get(code)!;
  };

  const start = Date.now() - spanDays * DAY_MS;
  const end = Date.now() - 25 * DAY_MS;
  const projects: { no: string; name: string; startedAt: number }[] = [];
  const inquiryIds: string[] = [];
  let contracts = 0;

  for (let i = 0; i < count; i++) {
    // 发布时间：分层抽样，落在北京时间工作日上午
    const day = inAppTz(new Date(start + ((i + rand()) * (end - start)) / count));
    const published = day
      .hour(9)
      .minute(Math.floor(between(0, 120)))
      .second(0)
      .millisecond(0)
      .valueOf();
    const kind = pickWeighted(KINDS, (k) => k.weight);
    const owner = rand() < 0.7 ? buyer : buyerLi;

    // 项目：45% 沿用最近 60 天内开始的项目，否则新开一个
    const recent = projects.filter((p) => published - p.startedAt < 60 * DAY_MS);
    let project = recent.length > 0 && rand() < 0.45 ? recent[Math.floor(rand() * recent.length)] : null;
    if (!project) {
      const year = inAppTz(new Date(published)).year();
      const seq = projects.filter((p) => p.no.startsWith(`${HISTORY_PROJECT_PREFIX}${year}-`)).length + 1;
      project = {
        no: `${HISTORY_PROJECT_PREFIX}${year}-${String(seq).padStart(3, '0')}`,
        name: PROJECTS[projects.length % PROJECTS.length],
        startedAt: published,
      };
      projects.push(project);
    }

    // 时间线：周期（定标 − 发布）按权重抽，最近的单子保证 4 天前已经定标
    const cycle = pickWeighted(CYCLES, (c) => c.weight).range;
    const cycleMs = Math.min(between(...cycle) * DAY_MS, Date.now() - 4 * DAY_MS - published);
    const deadline =
      published + Math.min(Math.max(cycleMs * between(0.45, 0.7), 1.2 * DAY_MS), cycleMs - 0.3 * DAY_MS);
    const awarded = published + cycleMs;
    const opened = deadline + (awarded - deadline) * between(0.1, 0.6);
    const created = published - between(1, 4) * DAY_MS;
    const submitted = created + between(1, 4) * HOUR_MS;
    const approved = Math.min(submitted + between(1, 20) * HOUR_MS, published - HOUR_MS);

    const lines: { materialId?: string; manual?: Line; quantity: string }[] = [];
    const quantity = () => String(Math.round(between(...kind.quantity) / 1000) * 1000);
    if (kind.material) lines.push({ materialId: ctx.material[kind.material], quantity: quantity() });
    if (!kind.material || rand() < 0.3) lines.push({ manual: kind.manual, quantity: quantity() });

    const inquiry = await at(created, async () => {
      const draft = await ctx.app.get(InquiriesService).create(
        owner,
        createInquirySchema.parse({
          projectNo: project.no,
          title: `${project.name} · ${kind.title}`,
          materialCategoryId: ctx.category[kind.category],
          currency: 'CNY',
          ownerId: owner.id,
          pdUserId: pd.id,
        }),
      );
      const service = ctx.app.get(InquiryLinesService);
      for (const line of lines) {
        if (line.materialId) {
          await service.createFromMaterials(
            owner,
            draft.id,
            1,
            linesFromMaterialsSchema.parse({
              items: [{ materialId: line.materialId, quantity: line.quantity }],
            }),
          );
        } else {
          await service.create(
            owner,
            draft.id,
            1,
            createLineSchema.parse({
              source: 'MANUAL',
              ...line.manual,
              categoryId: ctx.category[kind.category],
              quantity: line.quantity,
            }),
          );
        }
      }
      return draft;
    });
    inquiryIds.push(inquiry.id);
    const workflow = ctx.app.get(InquiryWorkflowService);
    await at(submitted, () => workflow.submit(owner, inquiry.id));
    await at(approved, () => workflow.approve(manager, inquiry.id, approveInquirySchema.parse({})));

    // 受邀：本类材料的常用供应商，偶尔再加一家别的
    const invited = [...kind.suppliers];
    if (rand() < 0.2) {
      const extra = KINDS[Math.floor(rand() * KINDS.length)].suppliers.find((c) => !invited.includes(c));
      if (extra) invited.push(extra);
    }
    await at(published, async () => {
      await ctx.app
        .get(InquiryInviteesService)
        .replace(owner, inquiry.id, updateInviteesSchema.parse({ supplierIds: invited.map(supplierId) }));
      await ctx.app
        .get(RoundWorkflowService)
        .publish(
          owner,
          inquiry.id,
          1,
          publishRoundSchema.parse({ deadline: new Date(deadline).toISOString() }),
        );
    });

    // 各家的响应：时长超过截止的压到截止前；至少要有一家报价
    const responses = new Map<string, Response>();
    for (const code of invited) {
      const choice = pickWeighted([0, 1, 2, 3, 4, 5, 6], (w) => SUPPLIERS[code].weights[w]);
      if (choice === 6) {
        responses.set(code, { kind: 'none' });
        continue;
      }
      let hours = choice === 5 ? between(1, 48) : between(...RESPONSE_HOURS[choice]);
      const window = (deadline - published) / HOUR_MS - 0.2;
      if (hours >= window) hours = window * between(0.3, 0.9);
      responses.set(code, { kind: choice === 5 ? 'decline' : 'quote', hours });
    }
    if (![...responses.values()].some((r) => r.kind === 'quote')) {
      const code = invited.find((c) => c !== 'SUP10008')!;
      responses.set(code, {
        kind: 'quote',
        hours: Math.min(between(1, 20), (deadline - published) / HOUR_MS / 2),
      });
    }

    const quotes = await ctx.prisma.quote.findMany({
      where: { round: { inquiryId: inquiry.id } },
      select: { id: true, supplier: { select: { code: true } } },
    });
    const quoteOf = (code: string) => quotes.find((q) => q.supplier.code === code)!.id;
    const lineRows = await ctx.prisma.inquiryLine.findMany({
      where: { round: { inquiryId: inquiry.id } },
      orderBy: { lineNo: 'asc' },
      select: { id: true, quantity: true },
    });
    const totals = new Map<string, Dec>();
    const terms = new Map<string, string>();
    const portal = ctx.app.get(PortalQuotesService);
    const submission = ctx.app.get(QuoteSubmissionService);
    for (const [code, response] of responses) {
      if (response.kind === 'none') {
        if (code !== 'SUP10008' && rand() < 0.5) {
          const actor = await actorOf(code);
          await at(published + between(2, 30) * HOUR_MS, () => portal.detail(actor, quoteOf(code)));
        }
        continue;
      }
      const actor = await actorOf(code);
      const respondAt = published + response.hours * HOUR_MS;
      await at(Math.max(published + 60_000, respondAt - between(5, 60) * 60_000), () =>
        portal.detail(actor, quoteOf(code)),
      );
      if (response.kind === 'decline') {
        const reason = pickWeighted(['CAPACITY', 'PRICE', 'LEAD_TIME'], () => 1);
        await at(respondAt, () =>
          submission.decline(actor, quoteOf(code), {
            reasonCode: reason,
            reason: {
              CAPACITY: '近期产能已排满。',
              PRICE: '原材料上涨，无法满足目标价格区间。',
              LEAD_TIME: '交期无法满足。',
            }[reason]!,
          }),
        );
        continue;
      }
      const s = SUPPLIERS[code];
      const paymentTerms = rand() < 0.6 ? 'NET30' : 'NET60';
      terms.set(code, paymentTerms);
      let total = new Dec(0);
      const values = lineRows.map((line) => {
        const price = new Dec(between(...kind.price) * s.factor * between(0.94, 1.06)).toDecimalPlaces(
          kind.dp,
        );
        total = total.plus(price.times(line.quantity.toString()));
        const perCarton = kind.packing === 'REEL' ? 4000 : Math.round(between(1, 10)) * 100;
        return [
          line.id,
          {
            ...kind.spec,
            unit_price_incl_tax: price.toFixed(kind.dp),
            tax_rate: '13',
            lead_time_days: Math.round(between(15, 40)),
            moq: Math.round(between(1, 10)) * 1000,
            payment_terms: paymentTerms,
            rohs: true,
            packing_method: kind.packing,
            pcs_per_carton: perCarton,
            carton_l_cm: String(Math.round(between(30, 60))),
            carton_w_cm: String(Math.round(between(25, 45))),
            carton_h_cm: String(Math.round(between(20, 40))),
            carton_gw_kg: between(6, 18).toFixed(1),
            trade_term: s.trade,
            ship_from: s.city,
            freight_cost: between(80, 600).toFixed(2),
            hs_code: kind.hsCode,
          },
        ] as const;
      });
      totals.set(code, total);
      await at(respondAt, () =>
        submission.submit(actor, quoteOf(code), quoteFormSchema.parse({ lines: Object.fromEntries(values) })),
      );
    }

    // 截止 → 开标 → 定标：七成给合计最低的，其余给另一家报了价的
    await at(deadline + 60_000, () => ctx.app.get(RoundDeadlineJob).run());
    await at(opened, () => ctx.app.get(RoundWorkflowService).open(manager, inquiry.id, 1));
    const ranked = [...totals].sort((a, b) => a[1].comparedTo(b[1]));
    const winner =
      ranked.length > 1 && rand() >= 0.7 ? ranked[1 + Math.floor(rand() * (ranked.length - 1))] : ranked[0];
    const detail = await at(awarded, () =>
      ctx.app.get(RoundAwardService).award(
        manager,
        inquiry.id,
        1,
        awardRoundSchema.parse({
          quoteId: quoteOf(winner[0]),
          comment: AWARD_COMMENTS[Math.floor(rand() * AWARD_COMMENTS.length)],
        }),
      ),
    );

    // 合同：定标后几小时补条款提交，主管审核，合同批准人批准
    const contractId = detail.award!.contract!.id;
    const contractsService = ctx.app.get(ContractsService);
    const filled = awarded + between(2, 8) * HOUR_MS;
    await at(filled, async () => {
      await contractsService.update(
        owner,
        contractId,
        updateContractSchema.parse({
          deliveryDate: inAppTz(new Date(awarded))
            .add(Math.round(between(20, 45)), 'day')
            .format('YYYY-MM-DD'),
          deliveryPlace: '深圳市宝安区福永街道示例工业园 3 栋',
          paymentTerms: PAYMENT_TERMS[terms.get(winner[0])!],
        }),
      );
      await contractsService.submit(owner, contractId);
    });
    const reviewed = filled + between(4, 20) * HOUR_MS;
    await at(reviewed, () =>
      contractsService.review(manager, contractId, contractDecisionSchema.parse({ action: 'APPROVE' })),
    );
    await at(reviewed + between(4, 30) * HOUR_MS, () =>
      contractsService.approve(approver, contractId, contractDecisionSchema.parse({ action: 'APPROVE' })),
    );
    contracts += 1;
  }

  // 几条手工调整积分（R15-3）
  const adjustments: [number, string, number, string][] = [
    [0.8, 'SUP10004', -3, '样品尺寸超差，返工后合格。'],
    [0.55, 'SUP10003', 3, '配合紧急插单，按期交货。'],
    [0.35, 'SUP10006', -2, '第二批交期延误 5 天。'],
    [0.12, 'SUP10001', 2, '年度质量评审优秀。'],
  ];
  for (const [ago, code, delta, remark] of adjustments) {
    await at(Date.now() - ago * spanDays * DAY_MS, () =>
      ctx.app
        .get(PointsService)
        .adjust(manager, supplierId(code), pointsAdjustSchema.parse({ delta, remark })),
    );
  }

  // 历史邮件在当时就已发出：标记为已发送，发送时间 = 入队时间
  const emails = await ctx.prisma.$executeRaw`
    UPDATE "EmailMessage" SET "status" = 'SENT', "sentAt" = "createdAt"
    WHERE "status" = 'PENDING' AND "inquiryId" = ANY(${inquiryIds}::text[])`;
  return { inquiries: inquiryIds.length, contracts, emails };
}
