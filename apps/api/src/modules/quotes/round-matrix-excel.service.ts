import { Injectable } from '@nestjs/common';
import {
  PPL_DECIMAL_TYPES,
  type NegotiationStatus,
  type PplResolvedColumn,
  type PplValue,
  type QuoteStatus,
  type QuoteVersionSource,
} from '@quoteflow/shared';
import { Workbook, type Cell, type CellValue, type Worksheet } from 'exceljs';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { formatAppTime, inAppTz } from '../../common/time';
import type { PplDictOption } from '../ppl/ppl-excel.service';
import { RoundMatrixService, type MatrixBuild } from './round-matrix.service';

type Lang = 'zh-CN' | 'en-US';

/** R11-5：被 quote.amount 脱敏的单元格 */
const MASKED = '***';

const FILL_LOWEST = 'FFE1F3D8';
const FILL_CHANGED = 'FFFFF2CC';
const FILL_HEADER = 'FFF2F3F5';

const TEXT = {
  'zh-CN': {
    summary: '汇总',
    detail: '明细',
    title: (no: string, title: string, round: number) => `比价矩阵 ${no} ${title} 第 ${round} 轮`,
    exportedAt: (time: string) => `导出时间：${time}`,
    legend:
      '绿色：最低价（汇总为含税合计最低，明细为该行含税单价最低）；黄色：与上一版本相比有变化（批注为原值）；*** 表示无权查看',
    summaryHeaders: [
      '供应商编码',
      '供应商名称',
      '状态',
      '含税合计',
      '币种',
      '最长交期（天）',
      '版本数',
      '当前版本',
      '最后提交时间（UTC+8）',
      '变更备注',
      '拒绝原因',
      '入围',
      '议价',
    ],
    detailHeaders: ['行号', '物料编码', '物料名称', '规格', '数量', '单位', '字段'],
    noResponse: '未响应',
    status: {
      INVITED: '已邀请',
      SUBMITTED: '已提交',
      DECLINED: '已拒绝',
      EVALUATING: '评标中',
      WON: '已中标',
      LOST: '未中标',
      VOID: '已作废',
    } satisfies Record<QuoteStatus, string>,
    source: { ONLINE: '在线', EXCEL: 'Excel', NEGOTIATION: '议价成交' } satisfies Record<
      QuoteVersionSource,
      string
    >,
    negotiation: { OPEN: '议价中', AGREED: '已成交', CLOSED: '已关闭' } satisfies Record<
      NegotiationStatus,
      string
    >,
    yes: '是',
    no: '否',
    was: '原值：',
    empty: '（空）',
  },
  'en-US': {
    summary: 'Summary',
    detail: 'Detail',
    title: (no: string, title: string, round: number) => `Comparison Matrix ${no} ${title} Round ${round}`,
    exportedAt: (time: string) => `Exported at: ${time}`,
    legend:
      'Green: lowest (lowest total incl. tax in Summary, lowest unit price incl. tax of the line in Detail); yellow: changed since the previous version (the note shows the old value); *** = no permission',
    summaryHeaders: [
      'Supplier Code',
      'Supplier Name',
      'Status',
      'Total (incl. tax)',
      'Currency',
      'Max Lead Time (days)',
      'Versions',
      'Current Version',
      'Last Submitted (UTC+8)',
      'Change Note',
      'Decline Reason',
      'Shortlisted',
      'Negotiation',
    ],
    detailHeaders: ['Line', 'Material Code', 'Item', 'Specification', 'Quantity', 'Unit', 'Field'],
    noResponse: 'No Response',
    status: {
      INVITED: 'Invited',
      SUBMITTED: 'Submitted',
      DECLINED: 'Declined',
      EVALUATING: 'Evaluating',
      WON: 'Won',
      LOST: 'Lost',
      VOID: 'Void',
    } satisfies Record<QuoteStatus, string>,
    source: { ONLINE: 'Online', EXCEL: 'Excel', NEGOTIATION: 'Negotiated' } satisfies Record<
      QuoteVersionSource,
      string
    >,
    negotiation: { OPEN: 'In Progress', AGREED: 'Agreed', CLOSED: 'Closed' } satisfies Record<
      NegotiationStatus,
      string
    >,
    yes: 'Yes',
    no: 'No',
    was: 'Was: ',
    empty: '(empty)',
  },
};

const pick = (zh: string | null, en: string | null, lang: Lang) => (lang === 'en-US' ? en || zh : zh) ?? '';

/**
 * 比价矩阵导出（M11 R11-5，需要 inquiry:export）：汇总 sheet + 明细 sheet（一个长表：每个询价行按明细列展开，
 * 每家有效报价一列），与页面一致地标出最低价和变更（批注是原值）。数据与 GET .../matrix 完全相同
 * （同样经过数据权限、SealService 和 quote.amount 脱敏），被脱敏的写 "***"。文字按导出人的语言
 */
@Injectable()
export class RoundMatrixExcelService {
  constructor(
    private readonly matrix: RoundMatrixService,
    private readonly clock: ClockService,
  ) {}

  async export(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
  ): Promise<{ name: string; buffer: Buffer }> {
    const lang: Lang = user.locale === 'en-US' ? 'en-US' : 'zh-CN';
    const build = await this.matrix.build(user, inquiryId, roundNo);
    const wb = new Workbook();
    wb.created = this.clock.now();
    this.summarySheet(wb, build, lang);
    this.detailSheet(wb, build, lang);
    const no = build.inquiry.formalNo ?? build.inquiry.draftNo;
    const day = inAppTz(this.clock.now()).format('YYYYMMDD');
    const name =
      lang === 'en-US'
        ? `Comparison-${no}-R${roundNo}-${day}.xlsx`
        : `比价矩阵-${no}-第${roundNo}轮-${day}.xlsx`;
    return { name, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  /** 前两行：标题、导出时间与图例 */
  private heading(ws: Worksheet, build: MatrixBuild, lang: Lang, width: number): void {
    const t = TEXT[lang];
    const { inquiry, dto } = build;
    ws.addRow([t.title(inquiry.formalNo ?? inquiry.draftNo, inquiry.title, dto.roundNo)]).font = {
      bold: true,
      size: 13,
    };
    ws.addRow([`${t.exportedAt(formatAppTime(this.clock.now()))}    ${t.legend}`]).font = {
      color: { argb: 'FF606266' },
    };
    ws.mergeCells(1, 1, 1, width);
    ws.mergeCells(2, 1, 2, width);
    ws.addRow([]);
  }

  private headerRow(ws: Worksheet, values: string[]): void {
    const row = ws.addRow(values);
    row.font = { bold: true };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((cell) => fill(cell, FILL_HEADER));
    ws.views = [{ state: 'frozen', ySplit: row.number, xSplit: 2 }];
  }

  private summarySheet(wb: Workbook, build: MatrixBuild, lang: Lang): void {
    const t = TEXT[lang];
    const ws = wb.addWorksheet(t.summary);
    const widths = [14, 28, 12, 16, 8, 14, 8, 12, 20, 36, 30, 8, 12];
    ws.columns = widths.map((width) => ({ width }));
    this.heading(ws, build, lang, widths.length);
    this.headerRow(ws, t.summaryHeaders);
    const opened = build.dto.roundStatus !== 'WAITING_QUOTES';
    for (const s of build.dto.suppliers) {
      const masked = s.maskedFields?.includes('totalAmount') ?? false;
      const status = s.status === 'INVITED' && opened ? t.noResponse : t.status[s.status];
      const row = ws.addRow([
        s.supplier.code,
        pick(s.supplier.nameZh, s.supplier.nameEn, lang),
        status,
        s.quoted ? (masked ? MASKED : Number(s.totalAmount)) : null,
        s.quoted ? build.dto.currency : null,
        s.maxLeadTimeDays,
        s.versionCount,
        s.currentVersionNo ? `v${s.currentVersionNo} ${t.source[s.currentVersionSource!]}` : null,
        s.lastSubmittedAt ? inAppTz(s.lastSubmittedAt).format('YYYY-MM-DD HH:mm') : null,
        s.changeNote,
        s.status === 'DECLINED' ? [s.declineReasonCode, s.declineReason].filter(Boolean).join(' ') : null,
        s.shortlisted ? t.yes : null,
        s.negotiation ? t.negotiation[s.negotiation.status] : null,
      ]);
      row.alignment = { vertical: 'top', wrapText: true };
      row.getCell(4).numFmt = '#,##0.00';
      if (s.lowestTotal) fill(row.getCell(4), FILL_LOWEST);
    }
  }

  private detailSheet(wb: Workbook, build: MatrixBuild, lang: Lang): void {
    const t = TEXT[lang];
    const ws = wb.addWorksheet(t.detail);
    const quoted = build.dto.suppliers.filter((s) => s.quoted);
    const widths = [6, 14, 22, 24, 10, 8, 22, ...quoted.map(() => 22)];
    ws.columns = widths.map((width) => ({ width }));
    this.heading(ws, build, lang, widths.length);
    this.headerRow(ws, [
      ...t.detailHeaders,
      ...quoted.map((s) => `${s.supplier.code} ${pick(s.supplier.nameZh, s.supplier.nameEn, lang)}`),
    ]);
    const { columns } = build.dto;
    for (const line of build.dto.lines) {
      const first = ws.rowCount + 1;
      for (const column of columns) {
        const row = ws.addRow([
          line.lineNo,
          line.materialCode,
          pick(line.nameZh, line.nameEn, lang),
          line.spec,
          Number(line.quantity),
          pick(line.unitNameZh, line.unitNameEn, lang),
          lang === 'en-US' ? column.labelEn : column.labelZh,
        ]);
        row.alignment = { vertical: 'top', wrapText: true };
        line.quotes.forEach((q, i) => {
          const cell = row.getCell(8 + i);
          const masked = build.maskedKeys.includes(column.key);
          cell.value = masked
            ? MASKED
            : cellValue(column, q.values[column.key] ?? null, build.dictOptions, lang);
          const fmt = numFmt(column);
          if (fmt && !masked) cell.numFmt = fmt;
          if (column.key === 'unit_price_incl_tax' && q.lowestUnitPrice) fill(cell, FILL_LOWEST);
          if (column.key in q.changes) {
            fill(cell, FILL_CHANGED);
            const was = cellValue(column, q.changes[column.key], build.dictOptions, lang);
            cell.note = `${t.was}${was === null ? t.empty : String(was)}`;
          }
        });
      }
      // 询价行信息只在每组第一行显示（合并单元格）
      const last = ws.rowCount;
      if (last > first) for (let c = 1; c <= 6; c++) ws.mergeCells(first, c, last, c);
    }
  }
}

function fill(cell: Cell, argb: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function numFmt(column: PplResolvedColumn): string | undefined {
  if (!PPL_DECIMAL_TYPES.includes(column.type)) return undefined;
  const dp = column.precision ?? 0;
  return dp > 0 ? `#,##0.${'0'.repeat(dp)}` : '#,##0';
}

/** 取值 → 单元格：数字类写数字（只用于显示），枚举写选项名称，是否写"是 / 否" */
function cellValue(
  column: PplResolvedColumn,
  value: PplValue | null,
  options: Record<string, PplDictOption[]>,
  lang: Lang,
): CellValue {
  if (value === null || value === '') return null;
  const name = (code: string) => {
    const option = (options[column.dictType ?? ''] ?? []).find((o) => o.code === code);
    return option ? pick(option.nameZh, option.nameEn, lang) : code;
  };
  switch (column.type) {
    case 'int':
    case 'decimal':
    case 'money':
    case 'percent':
      return typeof value === 'number' ? value : Number(value);
    case 'bool':
      return value === true ? TEXT[lang].yes : TEXT[lang].no;
    case 'enum':
      return name(String(value));
    case 'multiEnum':
      return Array.isArray(value) ? value.map(name).join(', ') : String(value);
    default:
      return String(value);
  }
}
