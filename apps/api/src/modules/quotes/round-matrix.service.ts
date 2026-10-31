import { Injectable } from '@nestjs/common';
import {
  computeInquiryActions,
  Dec,
  negotiationAwaiting,
  parseDecimal,
  PPL_QUANTITY_KEY,
  SHORTLIST_LIMIT,
  type MatrixCellsDto,
  type MatrixLineDto,
  type MatrixSupplierDto,
  type PplResolvedColumn,
  type PplValue,
  type PplValues,
  type QuoteVersionSource,
  type QuoteVersionValues,
  type RoundMatrixDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryAccessService } from '../inquiries/inquiry-access.service';
import type { PplDictOption, PplExcelLine } from '../ppl/ppl-excel.service';
import { QuoteSheetService } from './quote-sheet.service';
import { SealService } from './seal.service';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** 含税单价、交期列（v0 与真实模板沿用同样的 key，04 §9） */
const UNIT_PRICE_KEY = 'unit_price_incl_tax';
const LEAD_TIME_KEY = 'lead_time_days';

const quoteSelect = {
  id: true,
  status: true,
  lastSubmittedAt: true,
  declinedAt: true,
  declineReasonCode: true,
  declineReason: true,
  currentVersionId: true,
  shortlisted: true,
  supplier: { select: { id: true, code: true, nameZh: true, nameEn: true } },
  negotiation: {
    select: {
      status: true,
      messages: { select: { party: true, type: true }, orderBy: { seq: 'desc' }, take: 1 },
      _count: { select: { messages: true } },
    },
  },
  _count: { select: { versions: true } },
} satisfies Prisma.QuoteSelect;
type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof quoteSelect }>;

interface VersionRow {
  id: string;
  quoteId: string;
  versionNo: number;
  source: QuoteVersionSource;
  totalAmount: Prisma.Decimal;
  currency: string;
  changeNote: string | null;
  values: Prisma.JsonValue;
}

/** 比价矩阵连同导出要用的模板信息 */
export interface MatrixBuild {
  dto: RoundMatrixDto;
  inquiry: { formalNo: string | null; draftNo: string; title: string };
  lines: PplExcelLine[];
  dictOptions: Record<string, PplDictOption[]>;
  /** 被脱敏的列 key（不含 totalAmount） */
  maskedKeys: string[];
}

/** 版本里各行的取值，按 lineId */
function valuesByLine(json: Prisma.JsonValue): Map<string, PplValues> {
  const { lines } = json as unknown as QuoteVersionValues;
  return new Map(lines.map((l) => [l.lineId, l.values]));
}

/** 多选的编码顺序不同不算变化 */
function sameValue(a: PplValue | null, b: PplValue | null): boolean {
  const norm = (v: PplValue | null) => (Array.isArray(v) ? [...v].sort() : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** 最小值（并列都算）的下标；可比的不到两家时为空 */
function lowestIndexes(values: (Dec | null)[]): Set<number> {
  const present = values.filter((v): v is Dec => v !== null);
  if (present.length < 2) return new Set();
  const min = Dec.min(...present);
  return new Set(values.flatMap((v, i) => (v !== null && v.equals(min) ? [i] : [])));
}

/**
 * 比价矩阵（M11 R11-1 ~ R11-4）：汇总（每家受邀供应商一行）+ 明细（每个询价行，属性为 inMatrix 列、各家当前版本取值）
 * + 与上一版本的变更。开过标才可用（SealService：没开标 QUOTE_SEALED，seal.preOpenViewRoles 例外，S-2）；
 * 金额按 quote.amount 脱敏，被脱敏时不标最低价、不报金额列的变更（S-5）
 */
@Injectable()
export class RoundMatrixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly seal: SealService,
    private readonly sheet: QuoteSheetService,
    private readonly fieldMask: FieldMaskService,
  ) {}

  async matrix(user: AuthUser, inquiryId: string, roundNo: number): Promise<RoundMatrixDto> {
    return (await this.build(user, inquiryId, roundNo)).dto;
  }

  /** 矩阵与导出共用；导出另外要询价行、字典选项 */
  async build(user: AuthUser, inquiryId: string, roundNo: number): Promise<MatrixBuild> {
    const inquiry = await this.access.findOrThrow(this.prisma, user, inquiryId);
    const round = await this.prisma.inquiryRound.findUnique({
      where: { inquiryId_roundNo: { inquiryId, roundNo } },
      select: {
        id: true,
        roundNo: true,
        status: true,
        openedAt: true,
        pplTemplateVersion: true,
        pplVariantCode: true,
      },
    });
    if (!round) throw new AppException('NOT_FOUND');
    await this.seal.assertCanViewQuoteContent(user, round);

    const template = await this.sheet.template(round);
    const lines = await this.sheet.lines(round.id, inquiry.currency);
    const quotes = await this.prisma.quote.findMany({
      where: { roundId: round.id },
      select: quoteSelect,
      orderBy: [{ invitedAt: 'asc' }, { supplier: { code: 'asc' } }],
    });
    // 有效报价：有当前版本且没有拒绝（拒绝前提交过的版本不算它的报价；提交会清空 declinedAt）
    const quoted = quotes.filter((q) => q.currentVersionId !== null && q.declinedAt === null);
    const current = await this.versions(quoted.map((q) => ({ id: q.currentVersionId! })));
    const currentOf = new Map(current.map((v) => [v.quoteId, v]));
    const previous = await this.versions(
      current.filter((v) => v.versionNo > 1).map((v) => ({ quoteId: v.quoteId, versionNo: v.versionNo - 1 })),
    );
    const previousOf = new Map(previous.map((v) => [v.quoteId, v]));

    const canAmount = this.fieldMask.can(user, 'quote.amount');
    const maskedKeys = canAmount ? [] : template.columns.filter((c) => c.sensitive).map((c) => c.key);
    // 议价改过数量的版本里有 quantity（04 §6），这时明细多一行"数量"
    const hasQuantity = current.some((v) =>
      [...valuesByLine(v.values).values()].some((l) => PPL_QUANTITY_KEY in l),
    );
    const columns = template.columns.filter((c) => c.inMatrix || (hasQuantity && c.key === PPL_QUANTITY_KEY));

    const matrixLines = lines.map((line) =>
      this.line(line, columns, quoted, currentOf, previousOf, maskedKeys, canAmount),
    );
    const totals = lowestIndexes(
      quotes.map((q) => {
        const total = currentOf.get(q.id)?.totalAmount;
        return canAmount && total ? new Dec(total.toFixed(2)) : null;
      }),
    );
    const suppliers = quotes.map((q, i) =>
      this.supplierRow(q, round.status, currentOf.get(q.id) ?? null, totals.has(i), user),
    );
    const canShortlist =
      round.roundNo === inquiry.currentRoundNo &&
      computeInquiryActions(inquiry, user.permissions).includes('shortlist');
    return {
      dto: {
        roundNo: round.roundNo,
        roundStatus: round.status,
        currency: inquiry.currency,
        columns,
        suppliers,
        lines: matrixLines,
        shortlistLimit: SHORTLIST_LIMIT,
        canShortlist,
      },
      inquiry,
      lines,
      dictOptions: await this.sheet.dictOptions(columns),
      maskedKeys,
    };
  }

  /** 按条件之一（版本 id，或报价单 + 版本号）取版本 */
  private async versions(any: Prisma.QuoteVersionWhereInput[]): Promise<VersionRow[]> {
    if (any.length === 0) return [];
    return this.prisma.quoteVersion.findMany({
      where: { OR: any },
      select: {
        id: true,
        quoteId: true,
        versionNo: true,
        source: true,
        totalAmount: true,
        currency: true,
        changeNote: true,
        values: true,
      },
    });
  }

  /** R11-3、R11-4：一个询价行上各家的取值、与上一版本相比变化的列、含税单价最低的标记 */
  private line(
    line: PplExcelLine,
    columns: readonly PplResolvedColumn[],
    quoted: readonly QuoteRow[],
    currentOf: Map<string, VersionRow>,
    previousOf: Map<string, VersionRow>,
    maskedKeys: readonly string[],
    canAmount: boolean,
  ): MatrixLineDto {
    const visible = columns.filter((c) => !maskedKeys.includes(c.key));
    // 数量没被议价改过时就是询价行数量
    const pick = (values: PplValues | undefined, key: string): PplValue | null =>
      values?.[key] ?? (key === PPL_QUANTITY_KEY ? line.quantity : null);
    const cells = quoted.map((q): MatrixCellsDto => {
      const now = valuesByLine(currentOf.get(q.id)!.values).get(line.id);
      const prevVersion = previousOf.get(q.id);
      const before = prevVersion ? valuesByLine(prevVersion.values).get(line.id) : undefined;
      const values: Record<string, PplValue | null> = {};
      for (const c of columns) values[c.key] = maskedKeys.includes(c.key) ? null : pick(now, c.key);
      const changes: Record<string, PplValue | null> = {};
      if (prevVersion) {
        for (const c of visible) {
          const was = pick(before, c.key);
          if (!sameValue(values[c.key], was)) changes[c.key] = was;
        }
      }
      return { quoteId: q.id, values, changes, lowestUnitPrice: false };
    });
    if (canAmount) {
      const lowest = lowestIndexes(cells.map((c) => parseDecimal(c.values[UNIT_PRICE_KEY])));
      for (const i of lowest) cells[i].lowestUnitPrice = true;
    }
    return {
      lineId: line.id,
      lineNo: line.lineNo,
      materialCode: line.materialCode,
      nameZh: line.nameZh,
      nameEn: line.nameEn,
      spec: line.spec ?? '',
      unitNameZh: line.unitNameZh ?? '',
      unitNameEn: line.unitNameEn,
      quantity: line.quantity ?? '',
      quotes: cells,
    };
  }

  /** R11-2：汇总表的一行 */
  private supplierRow(
    q: QuoteRow,
    roundStatus: RoundMatrixDto['roundStatus'],
    version: VersionRow | null,
    lowestTotal: boolean,
    user: AuthUser,
  ): MatrixSupplierDto {
    const leadTimes = version
      ? [...valuesByLine(version.values).values()].flatMap((l) =>
          typeof l[LEAD_TIME_KEY] === 'number' ? [l[LEAD_TIME_KEY]] : [],
        )
      : [];
    const negotiation = q.negotiation;
    const row: MatrixSupplierDto = {
      quoteId: q.id,
      supplier: q.supplier,
      status: q.status,
      quoted: version !== null,
      totalAmount: version?.totalAmount.toFixed(2) ?? null,
      currency: version?.currency ?? null,
      maxLeadTimeDays: leadTimes.length > 0 ? Math.max(...leadTimes) : null,
      versionCount: q._count.versions,
      currentVersionNo: version?.versionNo ?? null,
      currentVersionSource: version?.source ?? null,
      lastSubmittedAt: iso(q.lastSubmittedAt),
      changeNote: version?.changeNote ?? null,
      declineReasonCode: q.declineReasonCode,
      declineReason: q.declineReason,
      shortlisted: q.shortlisted,
      lowestTotal,
      negotiation: negotiation && {
        status: negotiation.status,
        awaiting: negotiationAwaiting({
          roundStatus,
          quoteStatus: q.status,
          shortlisted: q.shortlisted,
          status: negotiation.status,
          last: negotiation.messages[0] ?? null,
        }),
        messageCount: negotiation._count.messages,
      },
    };
    return this.fieldMask.mask(row, user, 'quote.amount', ['totalAmount']);
  }
}
