import { Injectable } from '@nestjs/common';
import {
  PPL_DECIMAL_TYPES,
  REPORT_EXPORT_LIMIT,
  type EnableStatus,
  type InquiryReportQuery,
  type LogisticsReportQuery,
  type PointsLedgerQuery,
  type PointsRuleCode,
  type PointsSource,
  type PointsSummaryQuery,
  type PplColumn,
  type PplValue,
  type RoundStatus,
} from '@quoteflow/shared';
import { Workbook, type CellValue, type Worksheet } from 'exceljs';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import type { ReportRows } from '../../common/pagination';
import { formatAppTime, inAppTz } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsLedgerService } from '../points/points-ledger.service';
import { QuoteReportsService } from './quote-reports.service';
import { headerRow, langOf, MASKED_CELL, pickName, sheetHeading, type Lang } from './report-sheet';

const MONEY = '#,##0.00';
const TIME = 'YYYY-MM-DD HH:mm';

const TEXT = {
  'zh-CN': {
    exportedAt: (time: string) => `导出时间：${time}（时间均为北京时间 UTC+8）`,
    filters: (items: string[]) => `筛选条件：${items.length > 0 ? items.join('；') : '无'}`,
    truncated: (total: number) => `共 ${total} 行，超过上限，只导出了前 ${REPORT_EXPORT_LIMIT} 行`,
    sealedNote: '"密封"表示该轮次尚未开标，金额不可见；"***"表示没有查看报价金额的权限',
    sealed: '密封',
    filter: {
      inquiryNo: '询价号',
      roundStatus: '状态',
      published: '发布日期',
      supplier: '供应商',
      owner: '负责人',
      materialCategory: '材料类别（含下级）',
      keyword: '关键字',
      supplierCategory: '供应商分类',
      period: '时间区间',
      rule: '规则',
    },
    inquiries: {
      file: '询报价单统计',
      title: '询报价单统计',
      headers: [
        '正式询价号',
        '轮次',
        '标题',
        '项目号',
        '材料类别',
        '状态',
        '受邀家数',
        '有效报价数',
        '最低含税合计',
        '最高含税合计',
        '平均含税合计',
        '币种',
        '中标供应商',
        '负责人',
        '发布时间',
      ],
    },
    logistics: {
      file: '物流报价明细',
      title: '物流报价明细',
      headers: [
        '正式询价号',
        '轮次',
        '供应商编码',
        '供应商名称',
        '版本',
        '行号',
        '物料编码',
        '物料名称',
        '规格',
      ],
      note: '只包含开过标的轮次；每家有效报价的当前版本，一个询价行一行',
    },
    pointsSummary: {
      file: '供应商积分统计',
      title: '供应商积分统计',
      headers: ['供应商编码', '供应商名称', '供应商分类', '状态', '累计积分', '区间内积分'],
      lastChanged: '最近变动时间',
    },
    pointsLedger: {
      file: '积分记录流水',
      title: '积分记录流水',
      headers: [
        '时间',
        '供应商编码',
        '供应商名称',
        '规则',
        '分值',
        '来源',
        '关联询价号',
        '轮次',
        '备注',
        '操作人',
      ],
      system: '系统',
    },
    roundStatus: {
      DRAFT: '未发布',
      WAITING_QUOTES: '等待报价',
      QUOTES_CLOSED: '报价完成',
      OPENED: '开标',
      EVALUATED: '评标完成',
      SUPERSEDED: '已作废',
      CANCELLED: '已取消',
    } satisfies Record<RoundStatus, string>,
    rules: {
      QUOTE_ON_TIME: '准时报价',
      FAST_RESPONSE: '快速响应',
      WON: '中标',
      NO_RESPONSE: '未响应',
      MANUAL: '手工调整',
    } satisfies Record<PointsRuleCode, string>,
    source: { AUTO: '自动', MANUAL: '手工' } satisfies Record<PointsSource, string>,
    status: { ENABLED: '启用', DISABLED: '停用' } satisfies Record<EnableStatus, string>,
    yes: '是',
    no: '否',
  },
  'en-US': {
    exportedAt: (time: string) => `Exported at: ${time} (all times are Beijing Time, UTC+8)`,
    filters: (items: string[]) => `Filters: ${items.length > 0 ? items.join('; ') : 'none'}`,
    truncated: (total: number) =>
      `${total} rows in total; only the first ${REPORT_EXPORT_LIMIT} were exported`,
    sealedNote:
      '"Sealed": the round has not been opened, so amounts are hidden; "***": no permission to view quotation amounts',
    sealed: 'Sealed',
    filter: {
      inquiryNo: 'RFQ No.',
      roundStatus: 'Status',
      published: 'Published',
      supplier: 'Supplier',
      owner: 'Owner',
      materialCategory: 'Material category (incl. subcategories)',
      keyword: 'Keyword',
      supplierCategory: 'Supplier category',
      period: 'Period',
      rule: 'Rule',
    },
    inquiries: {
      file: 'RFQ-Statistics',
      title: 'RFQ Statistics',
      headers: [
        'RFQ No.',
        'Round',
        'Title',
        'Project No.',
        'Material Category',
        'Status',
        'Invited',
        'Valid Quotations',
        'Lowest Total (incl. tax)',
        'Highest Total (incl. tax)',
        'Average Total (incl. tax)',
        'Currency',
        'Awarded Supplier',
        'Owner',
        'Published',
      ],
    },
    logistics: {
      file: 'Logistics-Quotations',
      title: 'Logistics Quotations',
      headers: [
        'RFQ No.',
        'Round',
        'Supplier Code',
        'Supplier Name',
        'Version',
        'Line',
        'Material Code',
        'Item',
        'Specification',
      ],
      note: 'Opened rounds only; the current version of each valid quotation, one row per line item',
    },
    pointsSummary: {
      file: 'Supplier-Points',
      title: 'Supplier Points',
      headers: [
        'Supplier Code',
        'Supplier Name',
        'Supplier Category',
        'Status',
        'Total Points',
        'Points in Period',
      ],
      lastChanged: 'Last Changed',
    },
    pointsLedger: {
      file: 'Points-Ledger',
      title: 'Points Ledger',
      headers: [
        'Time',
        'Supplier Code',
        'Supplier Name',
        'Rule',
        'Points',
        'Source',
        'RFQ No.',
        'Round',
        'Remark',
        'Operator',
      ],
      system: 'System',
    },
    roundStatus: {
      DRAFT: 'Unpublished',
      WAITING_QUOTES: 'Awaiting quotes',
      QUOTES_CLOSED: 'Quotes closed',
      OPENED: 'Opened',
      EVALUATED: 'Evaluation completed',
      SUPERSEDED: 'Superseded',
      CANCELLED: 'Cancelled',
    } satisfies Record<RoundStatus, string>,
    rules: {
      QUOTE_ON_TIME: 'Quoted on time',
      FAST_RESPONSE: 'Fast response',
      WON: 'Won',
      NO_RESPONSE: 'No response',
      MANUAL: 'Manual adjustment',
    } satisfies Record<PointsRuleCode, string>,
    source: { AUTO: 'Automatic', MANUAL: 'Manual' } satisfies Record<PointsSource, string>,
    status: { ENABLED: 'Enabled', DISABLED: 'Disabled' } satisfies Record<EnableStatus, string>,
    yes: 'Yes',
    no: 'No',
  },
};
type Text = (typeof TEXT)[Lang];

const time = (iso: string | null) => (iso ? inAppTz(iso).format(TIME) : null);

/**
 * 报表导出（R15-2，report:export）：当前筛选条件下的全部行，最多 10000 行；数据与列表接口同一份（数据权限、SealService、
 * quote.amount 脱敏都一样），密封的金额写"密封"，被脱敏的写 "***"。文字按导出人的语言
 */
@Injectable()
export class ReportsExcelService {
  constructor(
    private readonly quotes: QuoteReportsService,
    private readonly points: PointsLedgerService,
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /** 一个 sheet 的工作簿：sheet 名是报表名，文件名是 <报表>-<日期>.xlsx */
  private async workbook(
    user: AuthUser,
    report: { file: string; title: string },
    build: (ws: Worksheet, t: Text, lang: Lang) => Promise<void>,
  ): Promise<{ name: string; buffer: Buffer }> {
    const lang = langOf(user);
    const wb = new Workbook();
    wb.created = this.clock.now();
    await build(wb.addWorksheet(report.title), TEXT[lang], lang);
    const day = inAppTz(this.clock.now()).format('YYYYMMDD');
    return { name: `${report.file}-${day}.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  private notes<T>(t: Text, filters: string[], rows: ReportRows<T>, extra: string[] = []): string[] {
    return [
      t.exportedAt(formatAppTime(this.clock.now())),
      t.filters(filters),
      ...extra,
      ...(rows.truncated ? [t.truncated(rows.total)] : []),
    ];
  }

  async inquiries(user: AuthUser, query: InquiryReportQuery): Promise<{ name: string; buffer: Buffer }> {
    const lang = langOf(user);
    return this.workbook(user, TEXT[lang].inquiries, async (ws, t) => {
      const rows = await this.quotes.inquiries(user, query, 'export');
      const headers = t.inquiries.headers;
      ws.columns = [18, 6, 28, 14, 18, 12, 8, 10, 16, 16, 16, 8, 28, 10, 17].map((width) => ({ width }));
      sheetHeading(
        ws,
        t.inquiries.title,
        this.notes(t, await this.quoteFilters(query, t, lang), rows, [t.sealedNote]),
        headers.length,
      );
      headerRow(ws, headers, true);
      for (const r of rows.items) {
        const amount = (value: string | null, key: string) =>
          r.sealed
            ? t.sealed
            : r.maskedFields?.includes(key)
              ? MASKED_CELL
              : value === null
                ? null
                : Number(value);
        const row = ws.addRow([
          r.inquiry.formalNo,
          r.roundNo,
          r.inquiry.title,
          r.inquiry.projectNo,
          `${r.materialCategory.code} ${pickName(r.materialCategory, lang)}`,
          t.roundStatus[r.roundStatus],
          r.invitedCount,
          r.quotedCount,
          amount(r.minTotal, 'minTotal'),
          amount(r.maxTotal, 'maxTotal'),
          amount(r.avgTotal, 'avgTotal'),
          r.currency,
          r.winner ? `${r.winner.code} ${pickName(r.winner, lang)}` : null,
          r.owner.name,
          time(r.publishedAt),
        ]);
        for (const col of [9, 10, 11]) row.getCell(col).numFmt = MONEY;
      }
    });
  }

  async logistics(user: AuthUser, query: LogisticsReportQuery): Promise<{ name: string; buffer: Buffer }> {
    const lang = langOf(user);
    return this.workbook(user, TEXT[lang].logistics, async (ws, t) => {
      const rows = await this.quotes.logistics(user, query, 'export');
      const headers = [
        ...t.logistics.headers,
        ...rows.columns.map((c) => (lang === 'en-US' ? c.labelEn : c.labelZh)),
      ];
      ws.columns = [18, 6, 12, 26, 6, 6, 14, 20, 24, ...rows.columns.map(() => 14)].map((width) => ({
        width,
      }));
      sheetHeading(
        ws,
        t.logistics.title,
        this.notes(t, await this.quoteFilters(query, t, lang), rows, [t.logistics.note, t.sealedNote]),
        headers.length,
      );
      headerRow(ws, headers, true);
      const options = await this.dictNames(rows.columns, lang);
      for (const r of rows.items) {
        const row = ws.addRow([
          r.inquiry.formalNo,
          r.roundNo,
          r.supplier.code,
          pickName(r.supplier, lang),
          r.versionNo,
          r.lineNo,
          r.materialCode,
          pickName(r, lang),
          r.spec,
          ...rows.columns.map((c) =>
            r.maskedFields?.includes(c.key) ? MASKED_CELL : cellValue(c, r.values[c.key] ?? null, options, t),
          ),
        ]);
        rows.columns.forEach((c, i) => {
          const fmt = numFmt(c);
          if (fmt && !r.maskedFields?.includes(c.key))
            row.getCell(t.logistics.headers.length + 1 + i).numFmt = fmt;
        });
      }
    });
  }

  async pointsSummary(user: AuthUser, query: PointsSummaryQuery): Promise<{ name: string; buffer: Buffer }> {
    const lang = langOf(user);
    return this.workbook(user, TEXT[lang].pointsSummary, async (ws, t) => {
      const rows = await this.points.summary(query, 'export');
      const rules = Object.keys(t.rules) as PointsRuleCode[];
      const headers = [
        ...t.pointsSummary.headers,
        ...rules.map((r) => t.rules[r]),
        t.pointsSummary.lastChanged,
      ];
      ws.columns = [12, 30, 14, 8, 10, 10, ...rules.map(() => 10), 17].map((width) => ({ width }));
      const filters = [
        ...(query.keyword ? [`${t.filter.keyword} ${query.keyword}`] : []),
        ...(query.supplierCategoryCode
          ? [
              `${t.filter.supplierCategory} ${await this.supplierCategoryName(query.supplierCategoryCode, lang)}`,
            ]
          : []),
        ...(query.from || query.to ? [`${t.filter.period} ${query.from ?? ''} ~ ${query.to ?? ''}`] : []),
      ];
      sheetHeading(ws, t.pointsSummary.title, this.notes(t, filters, rows), headers.length);
      headerRow(ws, headers, true);
      const categories = await this.supplierCategoryNames(lang);
      for (const r of rows.items) {
        ws.addRow([
          r.supplier.code,
          pickName(r.supplier, lang),
          categories.get(r.supplier.categoryCode) ?? r.supplier.categoryCode,
          t.status[r.supplier.status],
          r.balance,
          r.periodPoints,
          ...rules.map((rule) => r.byRule[rule]),
          time(r.lastChangedAt),
        ]);
      }
    });
  }

  async pointsLedger(user: AuthUser, query: PointsLedgerQuery): Promise<{ name: string; buffer: Buffer }> {
    const lang = langOf(user);
    return this.workbook(user, TEXT[lang].pointsLedger, async (ws, t) => {
      const rows = await this.points.ledger(query, 'export');
      const headers = t.pointsLedger.headers;
      ws.columns = [17, 12, 30, 12, 8, 8, 18, 6, 36, 12].map((width) => ({ width }));
      const filters = [
        ...(query.supplierId
          ? [`${t.filter.supplier} ${await this.supplierName(query.supplierId, lang)}`]
          : []),
        ...(query.ruleCode ? [`${t.filter.rule} ${t.rules[query.ruleCode]}`] : []),
        ...(query.from || query.to ? [`${t.filter.period} ${query.from ?? ''} ~ ${query.to ?? ''}`] : []),
      ];
      sheetHeading(ws, t.pointsLedger.title, this.notes(t, filters, rows), headers.length);
      headerRow(ws, headers, true);
      for (const r of rows.items) {
        const row = ws.addRow([
          time(r.createdAt),
          r.supplier.code,
          pickName(r.supplier, lang),
          t.rules[r.ruleCode],
          r.delta,
          t.source[r.source],
          r.inquiry?.formalNo ?? null,
          r.roundNo,
          r.remark,
          r.createdBy?.name ?? t.pointsLedger.system,
        ]);
        row.alignment = { vertical: 'top', wrapText: true };
      }
    });
  }

  /** 询报价单统计、物流明细的筛选条件说明（id 换成名称） */
  private async quoteFilters(query: InquiryReportQuery, t: Text, lang: Lang): Promise<string[]> {
    const items: string[] = [];
    if (query.inquiryNo) items.push(`${t.filter.inquiryNo} ${query.inquiryNo}`);
    if (query.roundStatus) items.push(`${t.filter.roundStatus} ${t.roundStatus[query.roundStatus]}`);
    if (query.from || query.to) items.push(`${t.filter.published} ${query.from ?? ''} ~ ${query.to ?? ''}`);
    if (query.supplierId)
      items.push(`${t.filter.supplier} ${await this.supplierName(query.supplierId, lang)}`);
    if (query.ownerId) {
      const owner = await this.prisma.user.findUnique({
        where: { id: query.ownerId },
        select: { name: true },
      });
      items.push(`${t.filter.owner} ${owner?.name ?? query.ownerId}`);
    }
    if (query.materialCategoryId) {
      const c = await this.prisma.materialCategory.findUnique({ where: { id: query.materialCategoryId } });
      items.push(
        `${t.filter.materialCategory} ${c ? `${c.code} ${pickName(c, lang)}` : query.materialCategoryId}`,
      );
    }
    return items;
  }

  private async supplierName(id: string, lang: Lang): Promise<string> {
    const s = await this.prisma.supplier.findUnique({
      where: { id },
      select: { code: true, nameZh: true, nameEn: true },
    });
    return s ? `${s.code} ${pickName(s, lang)}` : id;
  }

  /** 供应商分类编码 → 名称（停用的也要能显示） */
  private async supplierCategoryNames(lang: Lang): Promise<Map<string, string>> {
    const items = await this.prisma.dictItem.findMany({ where: { typeCode: 'supplier_category' } });
    return new Map(items.map((i) => [i.code, pickName(i, lang)]));
  }

  private async supplierCategoryName(code: string, lang: Lang): Promise<string> {
    return (await this.supplierCategoryNames(lang)).get(code) ?? code;
  }

  /** 枚举列的字典名称（dictType → 编码 → 名称；停用的选项也要能显示历史取值） */
  private async dictNames(columns: PplColumn[], lang: Lang): Promise<Map<string, Map<string, string>>> {
    const types = [...new Set(columns.flatMap((c) => (c.dictType ? [c.dictType] : [])))];
    const items = await this.prisma.dictItem.findMany({ where: { typeCode: { in: types } } });
    const names = new Map(types.map((type) => [type, new Map<string, string>()]));
    for (const i of items) names.get(i.typeCode)!.set(i.code, pickName(i, lang));
    return names;
  }
}

function numFmt(column: PplColumn): string | undefined {
  if (!PPL_DECIMAL_TYPES.includes(column.type)) return column.type === 'int' ? '#,##0' : undefined;
  const dp = column.precision ?? 0;
  return dp > 0 ? `#,##0.${'0'.repeat(dp)}` : '#,##0';
}

/** 取值 → 单元格：数字类写数字（只用于显示），枚举写名称，是否写"是 / 否" */
function cellValue(
  column: PplColumn,
  value: PplValue | null,
  names: Map<string, Map<string, string>>,
  t: Text,
): CellValue {
  if (value === null || value === '') return null;
  const name = (code: string) => names.get(column.dictType ?? '')?.get(code) ?? code;
  switch (column.type) {
    case 'int':
    case 'decimal':
    case 'money':
    case 'percent':
      return typeof value === 'number' ? value : Number(value);
    case 'bool':
      return value === true ? t.yes : t.no;
    case 'enum':
      return name(String(value));
    case 'multiEnum':
      return Array.isArray(value) ? value.map(name).join(', ') : String(value);
    default:
      return String(value);
  }
}
