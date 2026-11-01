import type {
  ContractStatus,
  InquiryDocStatus,
  NegotiationMsgType,
  NegotiationParty,
  NegotiationStatus,
  Paginated,
  PortalWorkbenchDto,
  QuoteStatus,
  RoundStatus,
  WorkbenchDto,
  InquiryListItemDto,
} from '@quoteflow/shared';
import { seedMaterialCategories } from '../prisma/seed-data/materials';
import type { Supplier, User } from '../src/generated/prisma/client';
import { Agent, loginAs } from './helpers/auth';
import { resetDb } from './helpers/db';
import { createSupplier, createUser, seedBase } from './helpers/fixtures';
import { createTestApp, TestContext } from './helpers/test-app';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-11-20T02:00:00.000Z');
/** 报价合计与议价方案里的独一无二的值：工作台的任何出口都不能出现（R16-1 不显示金额） */
const SECRETS = ['9876.54', '机密目标价 1.23'];

type UserKey = 'buyer' | 'buyer2' | 'pd' | 'manager' | 'approver' | 'admin' | 'deptLead';
type SupplierKey = 'a' | 'b' | 'c';
/** [谁, 消息类型, 几小时前] */
type MessageFx = [NegotiationParty, NegotiationMsgType, number];

interface QuoteFx {
  supplier: SupplierKey;
  status: QuoteStatus;
  shortlisted?: boolean;
  negotiation?: { status: NegotiationStatus; messages: MessageFx[] };
}

interface InquiryFx {
  owner: UserKey;
  createdBy?: UserKey;
  pd?: UserKey;
  docStatus: InquiryDocStatus;
  /** 当前轮次状态，默认 DRAFT */
  roundStatus?: RoundStatus;
  /** 截止：距 NOW 几小时（负数 = 已过） */
  deadlineIn?: number;
  submittedHoursAgo?: number;
  approvedHoursAgo?: number;
  updatedHoursAgo?: number;
  rejectComment?: string;
  evaluatedDaysAgo?: number;
  quotes?: QuoteFx[];
  /** 有的话当前轮是第 2 轮，第 1 轮已作废（报价单 VOID） */
  supersededQuotes?: SupplierKey[];
  contract?: { supplier: SupplierKey; status: ContractStatus; sentHoursAgo: number };
}

/**
 * M16 工作台的固定夹具（直接写库；工作台只读）。buyer、pd 在 PURCHASE 部门，buyer2 在 PURCHASE2；
 * deptLead 是自定义角色（DEPT 数据权限，能审批、开标、审核合同）。供应商 a、b 有门户账号
 */
const FIXTURES: Record<string, InquiryFx> = {
  d1: { owner: 'buyer', docStatus: 'DRAFT', updatedHoursAgo: 2 },
  // PD 建单、负责人 buyer，被驳回过
  d2: {
    owner: 'buyer',
    createdBy: 'pd',
    pd: 'pd',
    docStatus: 'DRAFT',
    updatedHoursAgo: 1,
    rejectComment: '请按季度拆分数量',
  },
  d3: { owner: 'buyer2', docStatus: 'DRAFT', updatedHoursAgo: 3 },
  p1: { owner: 'buyer', docStatus: 'PENDING_APPROVAL', submittedHoursAgo: 5 },
  p2: { owner: 'buyer2', docStatus: 'PENDING_APPROVAL', submittedHoursAgo: 10 },
  r1: { owner: 'buyer', docStatus: 'APPROVED', approvedHoursAgo: 3 },
  // 等待报价 7 张：buyer 两张，buyer2 五张（w7 是第 2 轮）
  w1: {
    owner: 'buyer',
    docStatus: 'APPROVED',
    roundStatus: 'WAITING_QUOTES',
    deadlineIn: 48,
    quotes: [
      { supplier: 'a', status: 'SUBMITTED' },
      { supplier: 'b', status: 'DECLINED' },
      { supplier: 'c', status: 'INVITED' },
    ],
  },
  w2: {
    owner: 'buyer',
    docStatus: 'APPROVED',
    roundStatus: 'WAITING_QUOTES',
    deadlineIn: 24,
    quotes: [
      { supplier: 'a', status: 'INVITED' },
      { supplier: 'b', status: 'INVITED' },
    ],
  },
  w3: {
    owner: 'buyer2',
    docStatus: 'APPROVED',
    roundStatus: 'WAITING_QUOTES',
    deadlineIn: 12,
    quotes: [{ supplier: 'a', status: 'SUBMITTED' }],
  },
  w4: {
    owner: 'buyer2',
    docStatus: 'APPROVED',
    roundStatus: 'WAITING_QUOTES',
    deadlineIn: 36,
    quotes: [{ supplier: 'a', status: 'SUBMITTED' }],
  },
  w5: {
    owner: 'buyer2',
    docStatus: 'APPROVED',
    roundStatus: 'WAITING_QUOTES',
    deadlineIn: 60,
    quotes: [{ supplier: 'a', status: 'SUBMITTED' }],
  },
  w6: {
    owner: 'buyer2',
    docStatus: 'APPROVED',
    roundStatus: 'WAITING_QUOTES',
    deadlineIn: 72,
    quotes: [{ supplier: 'a', status: 'SUBMITTED' }],
  },
  w7: {
    owner: 'buyer2',
    docStatus: 'APPROVED',
    roundStatus: 'WAITING_QUOTES',
    deadlineIn: 6,
    supersededQuotes: ['a', 'b', 'c'],
    quotes: [
      { supplier: 'a', status: 'SUBMITTED' },
      { supplier: 'b', status: 'INVITED' },
    ],
  },
  c1: {
    owner: 'buyer',
    docStatus: 'APPROVED',
    roundStatus: 'QUOTES_CLOSED',
    deadlineIn: -2,
    quotes: [
      { supplier: 'a', status: 'SUBMITTED' },
      { supplier: 'b', status: 'INVITED' },
    ],
  },
  // 开标·议价：a 反提案（等采购方）、b 目标价（等供应商）、c 没入围
  o1: {
    owner: 'buyer',
    docStatus: 'APPROVED',
    roundStatus: 'OPENED',
    deadlineIn: -48,
    quotes: [
      {
        supplier: 'a',
        status: 'EVALUATING',
        shortlisted: true,
        negotiation: {
          status: 'OPEN',
          messages: [
            ['BUYER', 'OFFER', 30],
            ['SUPPLIER', 'COUNTER', 20],
          ],
        },
      },
      {
        supplier: 'b',
        status: 'EVALUATING',
        shortlisted: true,
        negotiation: { status: 'OPEN', messages: [['BUYER', 'OFFER', 10]] },
      },
      { supplier: 'c', status: 'EVALUATING' },
    ],
  },
  // a 拒绝（等采购方，比 o1 等得久）、b 已成交（不算待办）
  o2: {
    owner: 'buyer2',
    docStatus: 'APPROVED',
    roundStatus: 'OPENED',
    deadlineIn: -60,
    quotes: [
      {
        supplier: 'a',
        status: 'EVALUATING',
        shortlisted: true,
        negotiation: {
          status: 'OPEN',
          messages: [
            ['BUYER', 'OFFER', 40],
            ['SUPPLIER', 'REJECT', 25],
          ],
        },
      },
      {
        supplier: 'b',
        status: 'EVALUATING',
        shortlisted: true,
        negotiation: {
          status: 'AGREED',
          messages: [
            ['BUYER', 'OFFER', 30],
            ['SUPPLIER', 'ACCEPT', 28],
          ],
        },
      },
    ],
  },
  // a 反提案后采购方再出价（等供应商 a）、b 已关闭
  o3: {
    owner: 'buyer2',
    docStatus: 'APPROVED',
    roundStatus: 'OPENED',
    deadlineIn: -72,
    quotes: [
      {
        supplier: 'a',
        status: 'EVALUATING',
        shortlisted: true,
        negotiation: {
          status: 'OPEN',
          messages: [
            ['BUYER', 'OFFER', 48],
            ['SUPPLIER', 'COUNTER', 40],
            ['BUYER', 'OFFER', 4],
          ],
        },
      },
      {
        supplier: 'b',
        status: 'EVALUATING',
        shortlisted: true,
        negotiation: {
          status: 'CLOSED',
          messages: [
            ['BUYER', 'OFFER', 30],
            ['BUYER', 'CLOSE', 20],
          ],
        },
      },
    ],
  },
  e1: {
    owner: 'buyer',
    docStatus: 'APPROVED',
    roundStatus: 'EVALUATED',
    deadlineIn: -8 * 24,
    evaluatedDaysAgo: 5,
    quotes: [
      { supplier: 'a', status: 'WON' },
      { supplier: 'b', status: 'LOST' },
    ],
    contract: { supplier: 'a', status: 'PENDING_REVIEW', sentHoursAgo: 2 },
  },
  e2: {
    owner: 'buyer2',
    docStatus: 'APPROVED',
    roundStatus: 'EVALUATED',
    deadlineIn: -12 * 24,
    evaluatedDaysAgo: 10,
    quotes: [
      { supplier: 'a', status: 'LOST' },
      { supplier: 'b', status: 'WON' },
    ],
    contract: { supplier: 'b', status: 'PENDING_APPROVAL', sentHoursAgo: 1 },
  },
  // 40 天前定标：不算"最近结果"；合同已批准
  e3: {
    owner: 'buyer',
    docStatus: 'APPROVED',
    roundStatus: 'EVALUATED',
    deadlineIn: -42 * 24,
    evaluatedDaysAgo: 40,
    quotes: [{ supplier: 'a', status: 'WON' }],
    contract: { supplier: 'a', status: 'APPROVED', sentHoursAgo: 38 * 24 },
  },
  e4: {
    owner: 'buyer',
    docStatus: 'APPROVED',
    roundStatus: 'EVALUATED',
    deadlineIn: -3 * 24,
    evaluatedDaysAgo: 1,
    quotes: [
      { supplier: 'a', status: 'LOST' },
      { supplier: 'b', status: 'WON' },
    ],
    contract: { supplier: 'b', status: 'PENDING_REVIEW', sentHoursAgo: 30 },
  },
  // 等待报价时取消：哪里都不出现
  x1: {
    owner: 'buyer',
    docStatus: 'CANCELLED',
    roundStatus: 'CANCELLED',
    deadlineIn: 24,
    quotes: [
      { supplier: 'a', status: 'VOID' },
      { supplier: 'b', status: 'VOID' },
    ],
  },
};

function expectNoSecrets(value: unknown, where: string): void {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) {
    if (text.includes(secret)) throw new Error(`${where} leaks "${secret}"`);
  }
}

/** 门户响应里不能出现的键（P-5） */
const PORTAL_FORBIDDEN_KEYS = ['projectNo', 'draftNo', 'owner', 'supplier', 'supplierId', 'totalAmount'];

function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

describe('M16 工作台', () => {
  let ctx: TestContext;
  let users: Record<UserKey | 'portalA' | 'portalB', User>;
  let agents: Record<UserKey, Agent>;
  let portal: Record<'a' | 'b', Agent>;
  let s: Record<SupplierKey, Supplier>;
  let category: string;
  /** 夹具 key → 询价单 id、标题 */
  const ids: Record<string, string> = {};
  const title = (key: string) => `工作台夹具 ${key}`;
  const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

  async function seedInquiry(key: string, f: InquiryFx): Promise<void> {
    const owner = users[f.owner];
    const creator = users[f.createdBy ?? f.owner];
    const roundStatus = f.roundStatus ?? 'DRAFT';
    const deadline = f.deadlineIn === undefined ? null : new Date(NOW.getTime() + f.deadlineIn * HOUR);
    const evaluatedAt = f.evaluatedDaysAgo === undefined ? null : ago(f.evaluatedDaysAgo * 24);
    const published = roundStatus !== 'DRAFT';
    const opened = ['OPENED', 'EVALUATED'].includes(roundStatus);
    const currentRoundNo = f.supersededQuotes ? 2 : 1;
    const inquiry = await ctx.prisma.inquiry.create({
      data: {
        draftNo: `DR-WB-${key}`,
        formalNo: f.docStatus === 'DRAFT' || f.docStatus === 'PENDING_APPROVAL' ? null : `RFQ-WB-${key}`,
        projectNo: `PJ-WB-${key}`,
        title: title(key),
        materialCategoryId: category,
        docStatus: f.docStatus,
        currentRoundNo,
        currentRoundStatus: roundStatus,
        currentDeadline: deadline,
        ownerId: owner.id,
        pdUserId: f.pd ? users[f.pd].id : null,
        createdById: creator.id,
        departmentCode: creator.departmentCode,
        lastRejectComment: f.rejectComment ?? null,
        submittedAt: f.submittedHoursAgo === undefined ? null : ago(f.submittedHoursAgo),
        approvedAt:
          f.approvedHoursAgo === undefined ? (published ? ago(100) : null) : ago(f.approvedHoursAgo),
        completedAt: evaluatedAt,
        createdAt: ago(200),
        updatedAt: ago(f.updatedHoursAgo ?? 0),
      },
    });
    ids[key] = inquiry.id;
    const round = async (roundNo: number, status: RoundStatus) =>
      ctx.prisma.inquiryRound.create({
        data: {
          inquiryId: inquiry.id,
          roundNo,
          status,
          deadline,
          publishedAt: published ? ago(100 - roundNo) : null,
          pplTemplateVersion: published ? 1 : null,
          openedAt: opened ? deadline : null,
          evaluatedAt,
          createdById: creator.id,
        },
      });
    if (f.supersededQuotes) {
      const first = await round(1, 'SUPERSEDED');
      for (const supplier of f.supersededQuotes) {
        await ctx.prisma.quote.create({
          data: { roundId: first.id, supplierId: s[supplier].id, status: 'VOID' },
        });
      }
    }
    const current = await round(currentRoundNo, roundStatus);
    for (const q of f.quotes ?? []) {
      const quote = await ctx.prisma.quote.create({
        data: {
          roundId: current.id,
          supplierId: s[q.supplier].id,
          status: q.status,
          invitedAt: ago(99),
          shortlisted: !!q.shortlisted,
        },
      });
      if (['SUBMITTED', 'EVALUATING', 'WON', 'LOST'].includes(q.status)) {
        const version = await ctx.prisma.quoteVersion.create({
          data: {
            quoteId: quote.id,
            versionNo: 1,
            source: 'ONLINE',
            values: { lines: [] },
            totalAmount: '9876.54',
            currency: 'CNY',
            templateVersion: 1,
            variantCode: 'PPL-LED',
            submittedById: users.portalA.id,
            submittedAt: ago(90),
          },
        });
        await ctx.prisma.quote.update({
          where: { id: quote.id },
          data: { currentVersionId: version.id, respondedAt: ago(90), lastSubmittedAt: ago(90) },
        });
        if (f.contract?.supplier === q.supplier)
          await seedContract(key, f.contract, inquiry.id, current.id, quote.id, version.id, q.supplier);
      }
      if (q.negotiation) {
        await ctx.prisma.negotiation.create({
          data: {
            quoteId: quote.id,
            status: q.negotiation.status,
            messages: {
              create: q.negotiation.messages.map(([party, type, hoursAgo], i) => ({
                seq: i + 1,
                party,
                type,
                content: type === 'OFFER' ? '机密目标价 1.23' : '原因',
                createdById: party === 'BUYER' ? owner.id : users.portalA.id,
                createdAt: ago(hoursAgo),
              })),
            },
          },
        });
      }
    }
  }

  async function seedContract(
    key: string,
    c: NonNullable<InquiryFx['contract']>,
    inquiryId: string,
    roundId: string,
    quoteId: string,
    quoteVersionId: string,
    supplier: SupplierKey,
  ): Promise<void> {
    const steps: [string, number][] =
      c.status === 'PENDING_REVIEW'
        ? [['SUBMIT', c.sentHoursAgo]]
        : c.status === 'PENDING_APPROVAL'
          ? [
              ['SUBMIT', c.sentHoursAgo + 5],
              ['REVIEW', c.sentHoursAgo],
            ]
          : [
              ['SUBMIT', c.sentHoursAgo + 10],
              ['REVIEW', c.sentHoursAgo + 5],
              ['APPROVE', c.sentHoursAgo],
            ];
    await ctx.prisma.contract.create({
      data: {
        contractNo: `CT-WB-${key}`,
        inquiryId,
        roundId,
        quoteId,
        quoteVersionId,
        supplierId: s[supplier].id,
        status: c.status,
        amount: '9876.54',
        currency: 'CNY',
        snapshot: {},
        createdById: users.buyer.id,
        // 待审核 / 待批准的合同不能编辑：updatedAt 就是流转时间
        updatedAt: ago(c.sentHoursAgo),
        approvals: {
          create: steps.map(([step, hoursAgo]) => ({
            step,
            action: step === 'SUBMIT' ? 'SUBMIT' : 'APPROVE',
            actorId: users.manager.id,
            createdAt: ago(hoursAgo),
          })),
        },
      },
    });
  }

  async function workbench(agent: Agent): Promise<WorkbenchDto> {
    const body: WorkbenchDto = (await agent.get('/api/workbench').expect(200)).body;
    expectNoSecrets(body, 'workbench');
    return body;
  }

  async function portalWorkbench(agent: Agent): Promise<PortalWorkbenchDto> {
    const body: PortalWorkbenchDto = (await agent.get('/api/portal/workbench').expect(200)).body;
    expectNoSecrets(body, 'portal workbench');
    const keys = keysOf(body);
    for (const key of PORTAL_FORBIDDEN_KEYS) expect(keys.has(key)).toBe(false);
    return body;
  }

  /** 卡片里询价单的夹具 key（按返回顺序） */
  const inquiryKeys = (card: { items: { id: string }[] } | undefined) =>
    card!.items.map((i) => Object.keys(ids).find((k) => ids[k] === i.id));
  const quoteInquiryKeys = (card: { items: { inquiry: { title: string } }[] } | undefined) =>
    card!.items.map((i) => i.inquiry.title.replace(title(''), ''));

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.clock.set(NOW);
    await resetDb(ctx.prisma);
    await seedBase(ctx.prisma);
    await seedMaterialCategories(ctx.prisma);
    category = (await ctx.prisma.materialCategory.findUniqueOrThrow({ where: { code: 'LED-2835' } })).id;
    await ctx.prisma.role.create({
      data: {
        code: 'DEPT_LEAD',
        nameZh: '部门主管',
        nameEn: 'Department Lead',
        dataScope: 'DEPT',
        permissions: ['inquiry:view', 'inquiry:approve', 'inquiry:open', 'contract:view', 'contract:review'],
        fieldPermissions: [],
      },
    });
    const mk = (username: string, roles: string[], departmentCode = 'PURCHASE') =>
      createUser(ctx.prisma, { username, name: username, roles, departmentCode });
    s = {
      a: await createSupplier(ctx.prisma, { code: 'WB-A', nameZh: '供应商甲' }),
      b: await createSupplier(ctx.prisma, { code: 'WB-B', nameZh: '供应商乙' }),
      c: await createSupplier(ctx.prisma, { code: 'WB-C', nameZh: '供应商丙' }),
    };
    const account = (supplier: Supplier, username: string) =>
      createUser(ctx.prisma, {
        username,
        roles: ['SUPPLIER'],
        userType: 'SUPPLIER',
        supplierId: supplier.id,
      });
    users = {
      buyer: await mk('buyer', ['BUYER']),
      buyer2: await mk('buyer2', ['BUYER'], 'PURCHASE2'),
      pd: await mk('pd', ['PD']),
      manager: await mk('manager', ['PURCHASE_MANAGER']),
      approver: await mk('approver', ['CONTRACT_APPROVER']),
      admin: await mk('admin', ['ADMIN'], 'IT'),
      deptLead: await mk('dept.lead', ['DEPT_LEAD']),
      portalA: await account(s.a, 'a@supplier.example.com'),
      portalB: await account(s.b, 'b@supplier.example.com'),
    };
    for (const [key, f] of Object.entries(FIXTURES)) await seedInquiry(key, f);
    agents = {} as Record<UserKey, Agent>;
    for (const key of ['buyer', 'buyer2', 'pd', 'manager', 'approver', 'admin', 'deptLead'] as const) {
      agents[key] = await loginAs(ctx, users[key]);
    }
    portal = { a: await loginAs(ctx, users.portalA), b: await loginAs(ctx, users.portalB) };
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('R16-2 一个接口返回全部卡片：不同角色看到的卡片集合按权限决定', async () => {
    const cards = async (key: UserKey) => Object.keys(await workbench(agents[key]));
    expect(await cards('admin')).toEqual(['waitingQuotes']);
    expect(await cards('pd')).toEqual(['myDrafts', 'waitingQuotes']);
    expect(await cards('buyer')).toEqual(['myDrafts', 'readyToPublish', 'waitingQuotes', 'negotiations']);
    expect(await cards('manager')).toEqual([
      'pendingApproval',
      'myDrafts',
      'readyToPublish',
      'waitingQuotes',
      'toOpen',
      'negotiations',
      'contractsToReview',
    ]);
    expect(await cards('approver')).toEqual(['waitingQuotes', 'contractsToApprove']);
    expect(await cards('deptLead')).toEqual([
      'pendingApproval',
      'waitingQuotes',
      'toOpen',
      'contractsToReview',
    ]);
  });

  it('R16-1 我的草稿：负责人 / 创建人 / PD 是本人（全部数据权限的主管也只看自己的），被驳回的带标识', async () => {
    const buyer = (await workbench(agents.buyer)).myDrafts!;
    expect(buyer.total).toBe(2);
    expect(inquiryKeys(buyer)).toEqual(['d2', 'd1']);
    expect(buyer.items.map((i) => i.rejected)).toEqual([true, false]);
    expect(buyer.items[0]).toMatchObject({
      draftNo: 'DR-WB-d2',
      formalNo: null,
      owner: { id: users.buyer.id },
    });
    const pd = (await workbench(agents.pd)).myDrafts!;
    expect(inquiryKeys(pd)).toEqual(['d2']);
    expect(inquiryKeys((await workbench(agents.buyer2)).myDrafts)).toEqual(['d3']);
    expect((await workbench(agents.manager)).myDrafts).toEqual({ total: 0, items: [] });
    // "查看全部"跳到询价列表的草稿页签 + 只看与我相关，条数一致
    const list: Paginated<InquiryListItemDto> = (
      await agents.buyer.get('/api/inquiries?tab=draft&mine=true').expect(200)
    ).body;
    expect(list.items.map((i) => i.id).sort()).toEqual([ids.d1, ids.d2].sort());
    const all: Paginated<InquiryListItemDto> = (
      await agents.manager.get('/api/inquiries?tab=draft&mine=false').expect(200)
    ).body;
    expect(all.total).toBe(3);
    expect((await agents.manager.get('/api/inquiries?tab=draft&mine=true').expect(200)).body.total).toBe(0);
  });

  it('R16-1 待我审批、待发布、待开标叠加数据权限（SELF / DEPT / ALL），先等的在前', async () => {
    const manager = await workbench(agents.manager);
    expect(inquiryKeys(manager.pendingApproval)).toEqual(['p2', 'p1']);
    expect(manager.pendingApproval!.items[1].submittedAt).toBe(ago(5).toISOString());
    expect(inquiryKeys(manager.readyToPublish)).toEqual(['r1']);
    expect(manager.readyToPublish!.items[0]).toMatchObject({
      formalNo: 'RFQ-WB-r1',
      approvedAt: ago(3).toISOString(),
    });
    expect(inquiryKeys(manager.toOpen)).toEqual(['c1']);
    expect(manager.toOpen!.items[0].progress).toEqual({ responded: 1, invited: 2 });

    // DEPT：只有 PURCHASE 部门的单（p2 在 PURCHASE2）
    const dept = await workbench(agents.deptLead);
    expect(inquiryKeys(dept.pendingApproval)).toEqual(['p1']);
    expect(inquiryKeys(dept.toOpen)).toEqual(['c1']);
    expect(inquiryKeys((await workbench(agents.buyer)).readyToPublish)).toEqual(['r1']);
    expect((await workbench(agents.buyer2)).readyToPublish).toEqual({ total: 0, items: [] });
  });

  it('R16-1 等待报价：按截止时间升序、前 5 条 + 总数，带"已响应 / 受邀"（作废的旧轮次不算）', async () => {
    const manager = (await workbench(agents.manager)).waitingQuotes!;
    expect(manager.total).toBe(7);
    expect(inquiryKeys(manager)).toEqual(['w7', 'w3', 'w2', 'w4', 'w1']);
    const progress = Object.fromEntries(manager.items.map((i) => [i.id, i.progress]));
    expect(progress[ids.w1]).toEqual({ responded: 2, invited: 3 });
    expect(progress[ids.w2]).toEqual({ responded: 0, invited: 2 });
    expect(progress[ids.w7]).toEqual({ responded: 1, invited: 2 });
    expect(manager.items[0]).toMatchObject({
      currentRoundNo: 2,
      currentDeadline: new Date(NOW.getTime() + 6 * HOUR).toISOString(),
    });
    // 其他卡片没有进度、不标驳回
    expect(manager.items.every((i) => !i.rejected)).toBe(true);

    const buyer = (await workbench(agents.buyer)).waitingQuotes!;
    expect(buyer.total).toBe(2);
    expect(inquiryKeys(buyer)).toEqual(['w2', 'w1']);
    expect((await workbench(agents.buyer2)).waitingQuotes!.total).toBe(5);
    expect((await workbench(agents.pd)).waitingQuotes).toEqual({ total: 0, items: [] });
    expect((await workbench(agents.admin)).waitingQuotes!.total).toBe(7);
  });

  it('R16-1 议价待处理：进行中、最后一条来自供应商（拒绝 / 反提案）；已成交、已关闭、等供应商回复的不算', async () => {
    const manager = (await workbench(agents.manager)).negotiations!;
    expect(manager.total).toBe(2);
    expect(manager.items.map((i) => [i.inquiry.title, i.supplier.code, i.lastMessage.type])).toEqual([
      [title('o2'), 'WB-A', 'REJECT'],
      [title('o1'), 'WB-A', 'COUNTER'],
    ]);
    expect(manager.items[1]).toMatchObject({
      inquiry: { id: ids.o1, formalNo: 'RFQ-WB-o1' },
      roundNo: 1,
      lastMessage: { createdAt: ago(20).toISOString() },
    });
    expect((await workbench(agents.buyer)).negotiations!.items.map((i) => i.inquiry.id)).toEqual([ids.o1]);
    expect((await workbench(agents.buyer2)).negotiations!.items.map((i) => i.inquiry.id)).toEqual([ids.o2]);
  });

  it('R16-1 待审核 / 待批准合同：数据权限跟随询价单，先送审的在前，不含合同金额', async () => {
    const manager = (await workbench(agents.manager)).contractsToReview!;
    expect(manager.items.map((c) => [c.contractNo, c.supplier.code, c.submittedAt])).toEqual([
      ['CT-WB-e4', 'WB-B', ago(30).toISOString()],
      ['CT-WB-e1', 'WB-A', ago(2).toISOString()],
    ]);
    expect(manager.items[0]).toMatchObject({
      status: 'PENDING_REVIEW',
      inquiry: { id: ids.e4, formalNo: 'RFQ-WB-e4' },
    });
    for (const item of manager.items) expect(item).not.toHaveProperty('amount');
    expect((await workbench(agents.deptLead)).contractsToReview!.total).toBe(2);
    const approver = (await workbench(agents.approver)).contractsToApprove!;
    expect(approver.items.map((c) => [c.contractNo, c.status, c.submittedAt])).toEqual([
      ['CT-WB-e2', 'PENDING_APPROVAL', ago(1).toISOString()],
    ]);
  });

  it('R16-1 供应商工作台：待报价（截止升序，已拒绝、作废的不算）、议价待回复（最后一条是采购方方案）、最近 30 天结果', async () => {
    const a = await portalWorkbench(portal.a);
    expect(a.pendingQuotes.total).toBe(7);
    expect(quoteInquiryKeys(a.pendingQuotes)).toEqual(['w7', 'w3', 'w2', 'w4', 'w1']);
    expect(a.pendingQuotes.items.map((q) => [q.roundNo, q.status])).toEqual([
      [2, 'SUBMITTED'],
      [1, 'SUBMITTED'],
      [1, 'INVITED'],
      [1, 'SUBMITTED'],
      [1, 'SUBMITTED'],
    ]);
    expect(a.pendingQuotes.items[0]).toMatchObject({
      inquiry: { formalNo: 'RFQ-WB-w7' },
      roundStatus: 'WAITING_QUOTES',
      deadline: new Date(NOW.getTime() + 6 * HOUR).toISOString(),
      offeredAt: null,
      evaluatedAt: null,
    });
    expect(quoteInquiryKeys(a.negotiations)).toEqual(['o3']);
    expect(a.negotiations.items[0]).toMatchObject({ status: 'EVALUATING', offeredAt: ago(4).toISOString() });
    expect(a.recentResults.items.map((q) => [q.inquiry.formalNo, q.status, q.evaluatedAt])).toEqual([
      ['RFQ-WB-e4', 'LOST', ago(24).toISOString()],
      ['RFQ-WB-e1', 'WON', ago(5 * 24).toISOString()],
      ['RFQ-WB-e2', 'LOST', ago(10 * 24).toISOString()],
    ]);

    // b：w1 已拒绝不算；只有 o1 在等它回复
    const b = await portalWorkbench(portal.b);
    expect(quoteInquiryKeys(b.pendingQuotes)).toEqual(['w7', 'w2']);
    expect(b.pendingQuotes.items.map((q) => q.status)).toEqual(['INVITED', 'INVITED']);
    expect(quoteInquiryKeys(b.negotiations)).toEqual(['o1']);
    expect(b.recentResults.items.map((q) => [q.inquiry.formalNo, q.status])).toEqual([
      ['RFQ-WB-e4', 'WON'],
      ['RFQ-WB-e1', 'LOST'],
      ['RFQ-WB-e2', 'WON'],
    ]);

    // 30 天的边界跟着时钟走：e2 定标 10 天前，拨到 20 天后就不再是"最近"（会话 12 小时过期，重新登录）
    ctx.clock.set(new Date(NOW.getTime() + 20 * DAY + HOUR));
    try {
      const later = await loginAs(ctx, users.portalB);
      expect((await portalWorkbench(later)).recentResults.items.map((q) => q.inquiry.formalNo)).toEqual([
        'RFQ-WB-e4',
        'RFQ-WB-e1',
      ]);
    } finally {
      ctx.clock.set(NOW);
    }
  });

  it('R16-1 供应商隔离：供应商工作台只有自己的报价单；供应商访问内部工作台 403，内部用户访问门户工作台 403', async () => {
    for (const [key, agent] of Object.entries(portal) as ['a' | 'b', Agent][]) {
      const body = await portalWorkbench(agent);
      const quoteIds = [
        ...body.pendingQuotes.items,
        ...body.negotiations.items,
        ...body.recentResults.items,
      ].map((q) => q.id);
      const own = await ctx.prisma.quote.count({ where: { id: { in: quoteIds }, supplierId: s[key].id } });
      expect(own).toBe(quoteIds.length);
      expect(quoteIds.length).toBeGreaterThan(0);
    }
    await portal.a.get('/api/workbench').expect(403);
    for (const agent of Object.values(agents)) await agent.get('/api/portal/workbench').expect(403);
  });
});
