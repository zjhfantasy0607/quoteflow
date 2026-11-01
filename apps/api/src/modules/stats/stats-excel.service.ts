import { Injectable } from '@nestjs/common';
import type {
  CycleTimeBucket,
  ResponseSpeedBucket,
  StatsCycleTimeDto,
  StatsExportQuery,
  StatsProjectsDto,
  StatsResponseSpeedDto,
  StatsSupplierDto,
  StatsWinRateDto,
} from '@quoteflow/shared';
import { Workbook, type Row } from 'exceljs';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { formatAppTime, inAppTz } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import { headerRow, langOf, pickName, sheetHeading, type Lang } from '../reports/report-sheet';
import { StatsService, type StatsRange } from './stats.service';

const PERCENT = '0.0%';
const ONE_DECIMAL = '0.0';

const TEXT = {
  'zh-CN': {
    file: (day: string) => `统计看板-${day}.xlsx`,
    exportedAt: (time: string) => `导出时间：${time}`,
    filters: (items: string[]) => `筛选条件：${items.length > 0 ? items.join('；') : '无'}`,
    year: (y: number) => `年度 ${y}`,
    range: (label: string, r: StatsRange) => `${label} ${r.from} ~ ${r.to}（北京时间）`,
    materialCategory: (name: string) => `材料分类 ${name}（含下级）`,
    supplierCategory: (name: string) => `供应商分类 ${name}`,
    supplier: (name: string) => `供应商 ${name}`,
    total: '合计',
    projects: {
      sheet: '年询盘项目数与品类',
      title: (y: number) => `年询盘项目数与品类（${y} 年）`,
      headers: ['月份', '询价单数', '项目数', '品类数'],
      categoryHeaders: ['顶级材料分类', '询价单数'],
      note: '按第 1 轮发布时间归月；品类数 = 询价行材料分类的顶级分类种数；一张询价单涉及几个顶级分类就各计一次',
    },
    response: {
      sheet: '供应商响应速度',
      title: '供应商响应速度',
      rangeLabel: '邀请日期',
      headers: ['响应时长', '报价单数', '占比'],
      supplierHeaders: [
        '供应商编码',
        '供应商名称',
        '供应商分类',
        '邀请数',
        '响应数',
        '响应率',
        '平均响应时长（小时）',
      ],
      note: '响应时长 = 首次提交或拒绝 − 邀请；截止时仍未响应的记为未响应；还没截止的、作废时还没响应的不计',
      buckets: {
        LE_2H: '≤2 小时',
        H2_8: '2–8 小时',
        H8_24: '8–24 小时',
        D1_3: '1–3 天',
        GT_3D: '>3 天',
        NO_RESPONSE: '未响应',
      } satisfies Record<ResponseSpeedBucket, string>,
    },
    winRate: {
      sheet: '中选次数与成功率',
      title: '中选次数与成功率',
      rangeLabel: '评标完成日期',
      headers: ['月份', '中标次数', '参与评标报价数', '成功率'],
      supplierHeaders: ['供应商编码', '供应商名称', '供应商分类', '受邀数', '报价数', '中标数', '中标率'],
      note: '成功率 = 中标次数 ÷ 参与评标的报价单数（中标 + 未中标）；中标率 = 中标数 ÷ 报价数',
    },
    cycle: {
      sheet: '询盘周期时效',
      title: '询盘周期时效',
      rangeLabel: '询盘完成日期',
      headers: ['周期', '询价单数', '占比'],
      monthHeaders: ['月份', '完成询价单数', '平均周期（天）'],
      average: '平均周期（天）',
      note: '周期天数 = 询盘完成（定标）− 第 1 轮发布，保留 1 位小数',
      buckets: {
        LE_3D: '≤3 天',
        D4_7: '4–7 天',
        D8_14: '8–14 天',
        D15_30: '15–30 天',
        GT_30D: '>30 天',
      } satisfies Record<CycleTimeBucket, string>,
    },
  },
  'en-US': {
    file: (day: string) => `Statistics-${day}.xlsx`,
    exportedAt: (time: string) => `Exported at: ${time}`,
    filters: (items: string[]) => `Filters: ${items.length > 0 ? items.join('; ') : 'none'}`,
    year: (y: number) => `Year ${y}`,
    range: (label: string, r: StatsRange) => `${label} ${r.from} ~ ${r.to} (Beijing Time)`,
    materialCategory: (name: string) => `Material category ${name} (incl. subcategories)`,
    supplierCategory: (name: string) => `Supplier category ${name}`,
    supplier: (name: string) => `Supplier ${name}`,
    total: 'Total',
    projects: {
      sheet: 'Projects & Categories',
      title: (y: number) => `RFQ Projects & Categories (${y})`,
      headers: ['Month', 'RFQs', 'Projects', 'Categories'],
      categoryHeaders: ['Top-level Material Category', 'RFQs'],
      note: 'By the month round 1 was published; categories = distinct top-level categories of the line items; an RFQ is counted once per top-level category it involves',
    },
    response: {
      sheet: 'Response Speed',
      title: 'Supplier Response Speed',
      rangeLabel: 'Invited',
      headers: ['Response Time', 'Quotations', 'Share'],
      supplierHeaders: [
        'Supplier Code',
        'Supplier Name',
        'Supplier Category',
        'Invited',
        'Responded',
        'Response Rate',
        'Avg. Response Time (h)',
      ],
      note: 'Response time = first submission or decline − invitation; no response by the deadline counts as No Response; not yet due, or void before responding, is excluded',
      buckets: {
        LE_2H: '≤ 2 h',
        H2_8: '2–8 h',
        H8_24: '8–24 h',
        D1_3: '1–3 days',
        GT_3D: '> 3 days',
        NO_RESPONSE: 'No Response',
      } satisfies Record<ResponseSpeedBucket, string>,
    },
    winRate: {
      sheet: 'Awards & Success Rate',
      title: 'Awards & Success Rate',
      rangeLabel: 'Evaluation completed',
      headers: ['Month', 'Awards', 'Evaluated Quotations', 'Success Rate'],
      supplierHeaders: [
        'Supplier Code',
        'Supplier Name',
        'Supplier Category',
        'Invited',
        'Quoted',
        'Won',
        'Win Rate',
      ],
      note: 'Success rate = awards ÷ evaluated quotations (won + lost); win rate = won ÷ quoted',
    },
    cycle: {
      sheet: 'Cycle Time',
      title: 'RFQ Cycle Time',
      rangeLabel: 'Completed',
      headers: ['Cycle', 'RFQs', 'Share'],
      monthHeaders: ['Month', 'Completed RFQs', 'Avg. Cycle (days)'],
      average: 'Avg. Cycle (days)',
      note: 'Cycle = completion (award) − round 1 publication, in days with 1 decimal',
      buckets: {
        LE_3D: '≤ 3 days',
        D4_7: '4–7 days',
        D8_14: '8–14 days',
        D15_30: '15–30 days',
        GT_30D: '> 30 days',
      } satisfies Record<CycleTimeBucket, string>,
    },
  },
};

type Text = (typeof TEXT)[Lang];

/** 筛选条件的显示名 */
interface FilterNames {
  materialCategory: string | null;
  supplierCategory: string | null;
  supplier: string | null;
}

/**
 * 统计导出（R15-2）：一个 xlsx，每张图一个 sheet，写图对应的数据表（与看板接口同一份数据，同样叠加数据权限）。
 * 只有次数、比率、时长，没有金额。文字按导出人的语言
 */
@Injectable()
export class StatsExcelService {
  constructor(
    private readonly stats: StatsService,
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async export(user: AuthUser, query: StatsExportQuery): Promise<{ name: string; buffer: Buffer }> {
    const lang = langOf(user);
    const t = TEXT[lang];
    const names = await this.filterNames(query, lang);
    const exportedAt = t.exportedAt(formatAppTime(this.clock.now()));
    const wb = new Workbook();
    wb.created = this.clock.now();
    const categoryNames = await this.supplierCategoryNames(lang);

    const projects = await this.stats.projects(user, query);
    this.projectsSheet(wb, t, projects, lang, [
      exportedAt,
      t.filters([
        t.year(projects.year),
        ...(names.materialCategory ? [t.materialCategory(names.materialCategory)] : []),
      ]),
      t.projects.note,
    ]);

    const response = await this.stats.responseSpeed(user, query);
    this.responseSheet(wb, t, response, categoryNames, lang, [
      exportedAt,
      t.filters([
        t.range(t.response.rangeLabel, response),
        ...(names.supplierCategory ? [t.supplierCategory(names.supplierCategory)] : []),
        ...(names.materialCategory ? [t.materialCategory(names.materialCategory)] : []),
      ]),
      t.response.note,
    ]);

    const winRate = await this.stats.winRate(user, query);
    this.winRateSheet(wb, t, winRate, categoryNames, lang, [
      exportedAt,
      t.filters([
        t.range(t.winRate.rangeLabel, winRate),
        ...(names.supplier ? [t.supplier(names.supplier)] : []),
        ...(names.supplierCategory ? [t.supplierCategory(names.supplierCategory)] : []),
      ]),
      t.winRate.note,
    ]);

    const cycle = await this.stats.cycleTime(user, query);
    this.cycleSheet(wb, t, cycle, [
      exportedAt,
      t.filters([
        t.range(t.cycle.rangeLabel, cycle),
        ...(names.materialCategory ? [t.materialCategory(names.materialCategory)] : []),
      ]),
      t.cycle.note,
    ]);

    const day = inAppTz(this.clock.now()).format('YYYYMMDD');
    return { name: t.file(day), buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  private projectsSheet(wb: Workbook, t: Text, data: StatsProjectsDto, lang: Lang, notes: string[]): void {
    const ws = wb.addWorksheet(t.projects.sheet);
    ws.columns = [{ width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }];
    sheetHeading(ws, t.projects.title(data.year), notes, 4);
    headerRow(ws, t.projects.headers);
    for (const m of data.months) ws.addRow([m.month, m.inquiryCount, m.projectCount, m.categoryCount]);
    const total = ws.addRow([
      t.total,
      data.total.inquiryCount,
      data.total.projectCount,
      data.total.categoryCount,
    ]);
    total.font = { bold: true };
    ws.addRow([]);
    headerRow(ws, t.projects.categoryHeaders);
    for (const c of data.categories)
      ws.addRow([`${c.category.code} ${pickName(c.category, lang)}`, c.inquiryCount]);
  }

  private responseSheet(
    wb: Workbook,
    t: Text,
    data: StatsResponseSpeedDto,
    categoryNames: Map<string, string>,
    lang: Lang,
    notes: string[],
  ): void {
    const ws = wb.addWorksheet(t.response.sheet);
    ws.columns = [
      { width: 16 },
      { width: 30 },
      { width: 16 },
      { width: 10 },
      { width: 10 },
      { width: 12 },
      { width: 20 },
    ];
    sheetHeading(ws, t.response.title, notes, 7);
    headerRow(ws, t.response.headers);
    for (const b of data.buckets) {
      share(ws.addRow([t.response.buckets[b.bucket], b.count, data.total ? b.count / data.total : null]), 3);
    }
    const total = ws.addRow([t.total, data.total, data.total ? 1 : null]);
    total.font = { bold: true };
    share(total, 3);
    ws.addRow([]);
    headerRow(ws, t.response.supplierHeaders);
    for (const s of data.suppliers) {
      const row = ws.addRow([
        ...supplierCells(s.supplier, categoryNames, lang),
        s.invitedCount,
        s.respondedCount,
        s.responseRate,
        s.avgResponseHours,
      ]);
      share(row, 6);
      row.getCell(7).numFmt = ONE_DECIMAL;
    }
  }

  private winRateSheet(
    wb: Workbook,
    t: Text,
    data: StatsWinRateDto,
    categoryNames: Map<string, string>,
    lang: Lang,
    notes: string[],
  ): void {
    const ws = wb.addWorksheet(t.winRate.sheet);
    ws.columns = [
      { width: 16 },
      { width: 30 },
      { width: 18 },
      { width: 12 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
    ];
    sheetHeading(ws, t.winRate.title, notes, 7);
    headerRow(ws, t.winRate.headers);
    for (const m of data.months)
      share(ws.addRow([m.month, m.winCount, m.participantCount, m.successRate]), 4);
    const total = ws.addRow([
      t.total,
      data.total.winCount,
      data.total.participantCount,
      data.total.successRate,
    ]);
    total.font = { bold: true };
    share(total, 4);
    ws.addRow([]);
    headerRow(ws, t.winRate.supplierHeaders);
    for (const s of data.suppliers) {
      share(
        ws.addRow([
          ...supplierCells(s.supplier, categoryNames, lang),
          s.invitedCount,
          s.quotedCount,
          s.wonCount,
          s.winRate,
        ]),
        7,
      );
    }
  }

  private cycleSheet(wb: Workbook, t: Text, data: StatsCycleTimeDto, notes: string[]): void {
    const ws = wb.addWorksheet(t.cycle.sheet);
    ws.columns = [{ width: 16 }, { width: 16 }, { width: 18 }];
    sheetHeading(ws, t.cycle.title, notes, 3);
    headerRow(ws, t.cycle.headers);
    for (const b of data.buckets) {
      share(ws.addRow([t.cycle.buckets[b.bucket], b.count, data.total ? b.count / data.total : null]), 3);
    }
    const total = ws.addRow([t.total, data.total, data.total ? 1 : null]);
    total.font = { bold: true };
    share(total, 3);
    const average = ws.addRow([t.cycle.average, data.avgDays]);
    average.getCell(2).numFmt = ONE_DECIMAL;
    ws.addRow([]);
    headerRow(ws, t.cycle.monthHeaders);
    for (const m of data.months) ws.addRow([m.month, m.count, m.avgDays]).getCell(3).numFmt = ONE_DECIMAL;
  }

  private async filterNames(query: StatsExportQuery, lang: Lang): Promise<FilterNames> {
    const category = query.materialCategoryId
      ? await this.prisma.materialCategory.findUnique({ where: { id: query.materialCategoryId } })
      : null;
    const supplier = query.supplierId
      ? await this.prisma.supplier.findUnique({ where: { id: query.supplierId } })
      : null;
    const supplierCategory = query.supplierCategoryCode
      ? await this.prisma.dictItem.findUnique({
          where: { typeCode_code: { typeCode: 'supplier_category', code: query.supplierCategoryCode } },
        })
      : null;
    return {
      materialCategory: category
        ? `${category.code} ${pickName(category, lang)}`
        : (query.materialCategoryId ?? null),
      supplier: supplier ? `${supplier.code} ${pickName(supplier, lang)}` : (query.supplierId ?? null),
      supplierCategory: supplierCategory
        ? pickName(supplierCategory, lang)
        : (query.supplierCategoryCode ?? null),
    };
  }

  /** 供应商分类编码 → 名称（停用的也要能显示） */
  private async supplierCategoryNames(lang: Lang): Promise<Map<string, string>> {
    const items = await this.prisma.dictItem.findMany({ where: { typeCode: 'supplier_category' } });
    return new Map(items.map((i) => [i.code, pickName(i, lang)]));
  }
}

function supplierCells(supplier: StatsSupplierDto, categoryNames: Map<string, string>, lang: Lang): string[] {
  return [
    supplier.code,
    pickName(supplier, lang),
    categoryNames.get(supplier.categoryCode) ?? supplier.categoryCode,
  ];
}

/** 比率列按百分比显示（单元格里是 0~1 的原始比率） */
function share(row: Row, col: number): void {
  row.getCell(col).numFmt = PERCENT;
}
