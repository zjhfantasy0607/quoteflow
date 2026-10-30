import { Injectable } from '@nestjs/common';
import {
  buildDraftDefaults,
  computePortalQuoteActions,
  Dec,
  isQuoteWindowOpen,
  PPL_TOTAL_KEY,
  QUOTE_ATTACHMENTS_MAX,
  quoteDraftValuesSchema,
  quoteTotal,
  quoteVersionValuesSchema,
  UPLOAD_KIND_RULES,
  validateQuoteValues,
  type DeclineQuoteInput,
  type PortalQuoteAction,
  type PortalQuoteActionContext,
  type PortalQuoteDetailDto,
  type PplResolvedColumn,
  type PplResolvedDto,
  type PplValueError,
  type PplValues,
  type QuoteDraftValues,
  type QuoteFormInput,
  type QuoteVersionValues,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { fixUploadName } from '../../infra/files/file-types';
import type { UploadedFileInput } from '../../infra/files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DictsService } from '../dicts/dicts.service';
import {
  PplExcelService,
  type PplDictOption,
  type PplExcelContext,
  type PplExcelLine,
} from '../ppl/ppl-excel.service';
import { draftOf, QUOTE_VERSION_OWNER } from '../quotes/quote-dto';
import { dictLookup, QuoteSheetService } from '../quotes/quote-sheet.service';
import { PortalQuotesService, ownQuoteWhere, supplierOf } from './portal-quotes.service';

type Client = PrismaService | Prisma.TransactionClient;

/** QuoteVersion.totalAmount 是 Decimal(18,2) */
const MAX_TOTAL = new Dec('9999999999999999.99');

const quoteSelect = {
  id: true,
  status: true,
  respondedAt: true,
  currentVersionId: true,
  draftValues: true,
  supplier: { select: { code: true } },
  round: {
    select: {
      id: true,
      roundNo: true,
      status: true,
      deadline: true,
      pplTemplateVersion: true,
      pplVariantCode: true,
      inquiry: { select: { id: true, formalNo: true, currency: true } },
    },
  },
} satisfies Prisma.QuoteSelect;
type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof quoteSelect }>;

/** 报价表：冻结的模板、询价行、枚举列选项 */
interface Sheet {
  template: PplResolvedDto;
  lines: PplExcelLine[];
  options: Record<string, PplDictOption[]>;
}

/**
 * R09-1：动作不允许时的错误码。作废 → QUOTE_INVALID_STATUS；已截止（含轮次已不在等待报价）→ QUOTE_DEADLINE_PASSED；
 * 其余（如已拒绝的再拒绝）→ QUOTE_INVALID_STATUS
 */
function actionError(ctx: PortalQuoteActionContext, now: Date): AppException {
  if (ctx.quoteStatus === 'VOID') return new AppException('QUOTE_INVALID_STATUS');
  if (!isQuoteWindowOpen(ctx, now)) {
    return new AppException('QUOTE_DEADLINE_PASSED', {
      deadline: ctx.deadline ? new Date(ctx.deadline).toISOString() : null,
    });
  }
  return new AppException('QUOTE_INVALID_STATUS');
}

function valuesInvalid(errors: PplValueError[]): AppException {
  return new AppException('QUOTE_VALUES_INVALID', { count: errors.length }, errors);
}

/** 草稿只存供应商填写列（02 §4），公式列提交时由服务端重算 */
function supplierOnly(
  columns: readonly PplResolvedColumn[],
  values: Record<string, PplValues>,
): Record<string, PplValues> {
  const keys = new Set(columns.filter((c) => c.source === 'supplier').map((c) => c.key));
  return Object.fromEntries(
    Object.entries(values).map(([lineId, row]) => [
      lineId,
      Object.fromEntries(Object.entries(row).filter(([key]) => keys.has(key))),
    ]),
  );
}

/**
 * 供应商的报价填报（M09）：保存草稿、提交（生成版本）、拒绝、锁定 Excel 下载与导入。
 * 写操作在事务里先对询价单加共享锁、对报价单加行锁：与截止、延期、取消、开标等轮次状态迁移（RoundStateService
 * 先锁询价单）串行，同一张报价单的写入串行；加锁后再按 ClockService.now() 复核 R09-1，不依赖截止任务是否已执行
 */
@Injectable()
export class QuoteSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: QuoteSheetService,
    private readonly pplExcel: PplExcelService,
    private readonly dicts: DictsService,
    private readonly portal: PortalQuotesService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  /** R09-3：只校验格式（不校验必填），存为草稿（source = ONLINE），整张替换 */
  async saveDraft(user: AuthUser, quoteId: string, input: QuoteFormInput): Promise<PortalQuoteDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const quote = await this.lock(tx, user, quoteId, 'saveDraft');
      const sheet = await this.sheet(tx, quote);
      const { values, errors } = validateQuoteValues(
        sheet.template.columns,
        sheet.lines,
        input.lines,
        dictLookup(sheet.options),
        { mode: 'draft' },
      );
      if (errors.length > 0) throw valuesInvalid(errors);
      await this.checkAttachments(tx, user, input.attachmentFileIds);
      await this.writeDraft(tx, quote.id, {
        lines: supplierOnly(sheet.template.columns, values),
        remark: input.remark,
        changeNote: input.changeNote,
        attachmentFileIds: input.attachmentFileIds,
        source: 'ONLINE',
      });
    });
    return this.portal.detail(user, quoteId);
  }

  /**
   * R09-4、R09-5：完整校验（含必填）→ 服务端重算公式列（忽略传入的公式列值）→ 合计 → 新版本（versionNo + 1，
   * 来源取草稿的来源）→ 当前版本指向它、状态 SUBMITTED、首次响应写 respondedAt、清空拒绝信息和草稿；
   * 附件转成该版本的 Attachment。审计只记版本号，不记金额（R09-10、I-11）
   */
  async submit(user: AuthUser, quoteId: string, input: QuoteFormInput): Promise<PortalQuoteDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const quote = await this.lock(tx, user, quoteId, 'submit');
      const sheet = await this.sheet(tx, quote);
      const { values, errors } = validateQuoteValues(
        sheet.template.columns,
        sheet.lines,
        input.lines,
        dictLookup(sheet.options),
        { mode: 'submit' },
      );
      if (errors.length > 0) throw valuesInvalid(errors);
      const lines: QuoteVersionValues['lines'] = sheet.lines.map((l) => ({
        lineId: l.id,
        lineNo: l.lineNo,
        values: values[l.id],
      }));
      const totalAmount = quoteTotal(lines.map((l) => l.values));
      if (new Dec(totalAmount).greaterThan(MAX_TOTAL)) throw this.totalTooLarge(lines);
      await this.checkAttachments(tx, user, input.attachmentFileIds);

      const now = this.clock.now();
      const last = await tx.quoteVersion.aggregate({
        where: { quoteId: quote.id },
        _max: { versionNo: true },
      });
      const versionNo = (last._max.versionNo ?? 0) + 1;
      const source = draftOf(quote.draftValues)?.source ?? 'ONLINE';
      const version = await tx.quoteVersion.create({
        data: {
          quoteId: quote.id,
          versionNo,
          source,
          values: quoteVersionValuesSchema.parse({ lines }) as Prisma.InputJsonValue,
          totalAmount,
          currency: quote.round.inquiry.currency,
          remark: input.remark ?? null,
          changeNote: input.changeNote ?? null,
          templateVersion: sheet.template.version,
          variantCode: sheet.template.variantCode,
          submittedById: user.id,
          submittedAt: now,
        },
        select: { id: true },
      });
      if (input.attachmentFileIds.length > 0) {
        await tx.attachment.createMany({
          data: input.attachmentFileIds.map((fileId) => ({
            ownerType: QUOTE_VERSION_OWNER,
            ownerId: version.id,
            fileId,
            createdById: user.id,
            createdAt: now,
          })),
        });
      }
      const res = await tx.quote.updateMany({
        where: { id: quote.id, status: { in: ['INVITED', 'SUBMITTED', 'DECLINED'] } },
        data: {
          status: 'SUBMITTED',
          currentVersionId: version.id,
          lastSubmittedAt: now,
          respondedAt: quote.respondedAt ?? now,
          declinedAt: null,
          declineReasonCode: null,
          declineReason: null,
          draftValues: Prisma.DbNull,
          draftUpdatedAt: null,
        },
      });
      if (res.count !== 1) throw new AppException('QUOTE_INVALID_STATUS');
      await this.log(tx, user, quote, 'quote.submit', `v${versionNo}`, {
        versionNo,
        source,
        lineCount: lines.length,
        attachmentCount: input.attachmentFileIds.length,
      });
    });
    return this.portal.detail(user, quoteId);
  }

  /** R09-6：原因编码（字典 decline_reason）和说明必填；已提交的也能改为拒绝，版本历史保留 */
  async decline(user: AuthUser, quoteId: string, input: DeclineQuoteInput): Promise<PortalQuoteDetailDto> {
    if (!input.reasonCode || !input.reason) throw new AppException('QUOTE_DECLINE_REASON_REQUIRED');
    const { reasonCode, reason } = input;
    await this.prisma.$transaction(async (tx) => {
      const quote = await this.lock(tx, user, quoteId, 'decline');
      await this.dicts.assertEnabled('decline_reason', reasonCode, tx);
      const now = this.clock.now();
      const res = await tx.quote.updateMany({
        where: { id: quote.id, status: { in: ['INVITED', 'SUBMITTED'] } },
        data: {
          status: 'DECLINED',
          declinedAt: now,
          declineReasonCode: reasonCode,
          declineReason: reason,
          respondedAt: quote.respondedAt ?? now,
        },
      });
      if (res.count !== 1) throw new AppException('QUOTE_INVALID_STATUS');
      await this.log(tx, user, quote, 'quote.decline', reasonCode, { reasonCode, reason });
    });
    return this.portal.detail(user, quoteId);
  }

  /** R09-8：锁定 Excel，预先写入草稿（没有草稿写当前版本，都没有写列的默认值） */
  async excelTemplate(user: AuthUser, quoteId: string): Promise<{ name: string; buffer: Buffer }> {
    const quote = await this.find(this.prisma, user, quoteId, 'downloadTemplate');
    const sheet = await this.sheet(this.prisma, quote);
    const values =
      draftOf(quote.draftValues)?.lines ??
      (await this.versionValues(quote.currentVersionId)) ??
      Object.fromEntries(sheet.lines.map((l) => [l.id, buildDraftDefaults(sheet.template.columns)]));
    const buffer = await this.pplExcel.build(this.excelContext(quote, sheet), {
      values,
      deadline: quote.round.deadline,
      locale: user.locale,
    });
    const { formalNo } = quote.round.inquiry;
    const { roundNo } = quote.round;
    const name =
      user.locale === 'en-US'
        ? `Quotation-${formalNo}-R${roundNo}.xlsx`
        : `报价单-${formalNo}-第${roundNo}轮.xlsx`;
    return { name, buffer };
  }

  /**
   * R09-8、04 §7.4：校验签名、本单本轮、表头和取值（必填与格式）后整张写入草稿（source = EXCEL），
   * 保留草稿的备注、变更说明和附件；不自动提交。有任何错误整表拒绝，一行都不写
   */
  async importExcel(
    user: AuthUser,
    quoteId: string,
    file: UploadedFileInput | undefined,
  ): Promise<PortalQuoteDetailDto> {
    if (!file || file.size === 0) {
      throw new AppException('VALIDATION_FAILED', undefined, [
        { path: 'file', code: 'required', message: 'File is required' },
      ]);
    }
    // 先确认能导入再解析文件；解析不在事务里做
    const quote = await this.find(this.prisma, user, quoteId, 'importExcel');
    const sheet = await this.sheet(this.prisma, quote);
    const values = await this.pplExcel.parse(this.excelContext(quote, sheet), file.buffer);
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, user, quoteId, 'importExcel');
      const base = draftOf(locked.draftValues) ?? (await this.draftFromVersion(tx, locked.currentVersionId));
      await this.writeDraft(tx, locked.id, {
        ...base,
        lines: supplierOnly(sheet.template.columns, values),
        source: 'EXCEL',
      });
      await this.log(tx, user, locked, 'quote.importExcel', fixUploadName(file.originalname).slice(0, 100), {
        lineCount: sheet.lines.length,
      });
    });
    return this.portal.detail(user, quoteId);
  }

  /** 取本供应商的报价单并复核动作（03 §6）；别家的 404 */
  private async find(
    client: Client,
    user: AuthUser,
    quoteId: string,
    action: PortalQuoteAction,
  ): Promise<QuoteRow> {
    const quote = await client.quote.findFirst({
      where: { id: quoteId, ...ownQuoteWhere(user) },
      select: quoteSelect,
    });
    if (!quote) throw new AppException('NOT_FOUND');
    const now = this.clock.now();
    const ctx = {
      quoteStatus: quote.status,
      roundStatus: quote.round.status,
      deadline: quote.round.deadline,
    };
    if (!computePortalQuoteActions(ctx, now).includes(action)) throw actionError(ctx, now);
    return quote;
  }

  /** 加锁后读最新状态再复核（询价单共享锁 → 报价单行锁，与 RoundStateService 的加锁顺序一致） */
  private async lock(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    quoteId: string,
    action: PortalQuoteAction,
  ): Promise<QuoteRow> {
    const target = await tx.quote.findFirst({
      where: { id: quoteId, supplierId: supplierOf(user) },
      select: { round: { select: { inquiryId: true } } },
    });
    if (!target) throw new AppException('NOT_FOUND');
    await tx.$queryRaw`SELECT 1 FROM "Inquiry" WHERE "id" = ${target.round.inquiryId} FOR SHARE`;
    await tx.$queryRaw`SELECT 1 FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`;
    return this.find(tx, user, quoteId, action);
  }

  private async sheet(client: Client, quote: QuoteRow): Promise<Sheet> {
    const template = await this.sheets.template(quote.round, client);
    const lines = await this.sheets.lines(quote.round.id, quote.round.inquiry.currency, client);
    const options = await this.sheets.dictOptions(template.columns, client);
    return { template, lines, options };
  }

  private excelContext(quote: QuoteRow, sheet: Sheet): PplExcelContext {
    return {
      quoteId: quote.id,
      roundId: quote.round.id,
      formalNo: quote.round.inquiry.formalNo!,
      roundNo: quote.round.roundNo,
      templateVersion: sheet.template.version,
      variantCode: sheet.template.variantCode,
      groups: sheet.template.groups,
      columns: sheet.template.columns,
      lines: sheet.lines,
      dictOptions: sheet.options,
    };
  }

  /**
   * R09-9：每次最多 10 个；只能挂本供应商的人上传的报价附件（ATTACHMENT），防止借用别人的文件 id。
   * 上一版的附件（同一供应商上传的）可以原样再挂到新版本
   */
  private async checkAttachments(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    fileIds: string[],
  ): Promise<void> {
    if (fileIds.length > QUOTE_ATTACHMENTS_MAX)
      throw new AppException('FILE_LIMIT_EXCEEDED', { max: QUOTE_ATTACHMENTS_MAX });
    if (fileIds.length === 0) return;
    const files = await tx.fileObject.findMany({
      where: { id: { in: fileIds } },
      select: { kind: true, uploadedById: true },
    });
    if (files.length !== fileIds.length) {
      throw new AppException('VALIDATION_FAILED', undefined, [
        { path: 'attachmentFileIds', code: 'not_found', message: 'File not found' },
      ]);
    }
    if (files.some((f) => f.kind !== 'ATTACHMENT')) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', {
        allowed: UPLOAD_KIND_RULES.ATTACHMENT.exts.join(', '),
      });
    }
    const uploaderIds = [...new Set(files.map((f) => f.uploadedById ?? ''))];
    const own = await tx.user.count({ where: { id: { in: uploaderIds }, supplierId: supplierOf(user) } });
    if (own !== uploaderIds.length) throw new AppException('FILE_ACCESS_DENIED');
  }

  /** 合计超出 Decimal(18,2) 时报在含税总价最大的那一行（正常报价到不了） */
  private totalTooLarge(lines: QuoteVersionValues['lines']): AppException {
    const total = (l: QuoteVersionValues['lines'][number]) => new Dec(String(l.values[PPL_TOTAL_KEY] ?? 0));
    const worst = lines.reduce((a, b) => (total(b).greaterThan(total(a)) ? b : a));
    return valuesInvalid([
      {
        lineId: worst.lineId,
        lineNo: worst.lineNo,
        key: PPL_TOTAL_KEY,
        code: 'too_large',
        params: { max: MAX_TOTAL.toFixed(2) },
        message: `Line ${worst.lineNo} total is too large`,
      },
    ]);
  }

  private async writeDraft(
    tx: Prisma.TransactionClient,
    quoteId: string,
    draft: QuoteDraftValues,
  ): Promise<void> {
    await tx.quote.update({
      where: { id: quoteId },
      data: {
        draftValues: quoteDraftValuesSchema.parse(draft) as Prisma.InputJsonValue,
        draftUpdatedAt: this.clock.now(),
      },
    });
  }

  /** 当前版本各行的取值（锁定 Excel 预填用；公式列由 Excel 公式计算，不会写进单元格） */
  private async versionValues(versionId: string | null): Promise<Record<string, PplValues> | null> {
    if (!versionId) return null;
    const version = await this.prisma.quoteVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { values: true },
    });
    const { lines } = version.values as unknown as QuoteVersionValues;
    return Object.fromEntries(lines.map((l) => [l.lineId, l.values]));
  }

  /** 没有草稿时以当前版本为底（与页面一致：备注和附件沿用上一版，变更说明每版重写） */
  private async draftFromVersion(
    tx: Prisma.TransactionClient,
    versionId: string | null,
  ): Promise<QuoteDraftValues> {
    if (!versionId) return { lines: {} };
    const version = await tx.quoteVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { remark: true },
    });
    const files = await tx.attachment.findMany({
      where: { ownerType: QUOTE_VERSION_OWNER, ownerId: versionId },
      select: { fileId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      lines: {},
      ...(version.remark ? { remark: version.remark } : {}),
      attachmentFileIds: files.map((f) => f.fileId),
    };
  }

  /** R09-10：记在询价单的操作日志里（采购方能看到"提交了第 N 版 / 拒绝报价 / 导入 Excel 草稿"），不含金额 */
  private async log(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    quote: QuoteRow,
    action: string,
    what: string,
    detail: Record<string, string | number>,
  ): Promise<void> {
    const { inquiry, roundNo } = quote.round;
    await this.audit.log(
      {
        actor: user,
        action,
        entityType: 'inquiry',
        entityId: inquiry.id,
        summary: [inquiry.formalNo, quote.supplier.code, what].join(' · '),
        detail: { roundNo, quoteId: quote.id, ...detail },
      },
      tx,
    );
  }
}
