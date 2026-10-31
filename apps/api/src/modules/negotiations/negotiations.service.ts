import { Injectable } from '@nestjs/common';
import {
  applyFormulas,
  canNegotiate,
  computeBuyerNegotiationActions,
  computeSupplierNegotiationActions,
  Dec,
  hasNegotiationContent,
  NEGOTIATION_ATTACHMENTS_MAX,
  NEGOTIATION_MESSAGE_OWNER,
  negotiationAwaiting,
  negotiationMessageLinesSchema,
  negotiationNextMoves,
  normalizePplValue,
  PPL_QUANTITY_KEY,
  PPL_TEXT_MAX_LENGTH,
  quoteTotal,
  quoteVersionValuesSchema,
  UPLOAD_KIND_RULES,
  type NegotiationAcceptInput,
  type NegotiationAction,
  type NegotiationCloseInput,
  type NegotiationLineInput,
  type NegotiationMessageDto,
  type NegotiationMessageLines,
  type NegotiationMsgType,
  type NegotiationOfferInput,
  type NegotiationParty,
  type NegotiationRespondInput,
  type NegotiationStatus,
  type NegotiationThreadDto,
  type PplValues,
  type QuoteVersionValues,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { toFileDto } from '../../infra/files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { assertInquiryWritable, InquiryAccessService } from '../inquiries/inquiry-access.service';
import { InquiryNoticesService } from '../inquiries/inquiry-notices.service';
import { ownQuoteWhere } from '../portal/portal-quotes.service';
import { QUOTE_VERSION_OWNER } from '../quotes/quote-dto';
import { QuoteSheetService } from '../quotes/quote-sheet.service';
import { SealService } from '../quotes/seal.service';

type Client = PrismaService | Prisma.TransactionClient;

/** 议价覆盖的报价列（05 §5） */
const UNIT_PRICE_KEY = 'unit_price_incl_tax';
const CHANGE_NOTE_KEY = 'change_note';
/** QuoteVersion.totalAmount 是 Decimal(18,2) */
const MAX_TOTAL = new Dec('9999999999999999.99');

const quoteSelect = {
  id: true,
  status: true,
  shortlisted: true,
  currentVersionId: true,
  supplier: true,
  round: {
    select: {
      id: true,
      roundNo: true,
      status: true,
      openedAt: true,
      pplTemplateVersion: true,
      pplVariantCode: true,
      inquiry: { select: { id: true, formalNo: true, title: true, ownerId: true, currency: true } },
    },
  },
} satisfies Prisma.QuoteSelect;
type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof quoteSelect }> & {
  negotiation: { id: string; status: NegotiationStatus } | null;
};

/**
 * 报价单连同议价。议价单独查：同一个 select 里再带反向关联时 Prisma 会并发查询，事务只有一个连接（pg 已废弃
 * 同一连接上的并发查询，见 InquiriesService.detail 的说明）
 */
async function loadQuote(client: Client, where: Prisma.QuoteWhereInput): Promise<QuoteRow | null> {
  const quote = await client.quote.findFirst({ where, select: quoteSelect });
  if (!quote) return null;
  const negotiation = await client.negotiation.findUnique({
    where: { quoteId: quote.id },
    select: { id: true, status: true },
  });
  return { ...quote, negotiation };
}

const lastSelect = {
  id: true,
  seq: true,
  party: true,
  type: true,
  lines: true,
  content: true,
} satisfies Prisma.NegotiationMessageSelect;
type LastMessage = Prisma.NegotiationMessageGetPayload<{ select: typeof lastSelect }>;

/** 加锁后读到的报价单与议价现状 */
interface Locked {
  quote: QuoteRow;
  last: LastMessage | null;
  /** 当前的议价轮次（已发过的 OFFER 数） */
  offers: number;
}

/** 新消息 */
interface NewMessage {
  party: NegotiationParty;
  type: NegotiationMsgType;
  lines?: NegotiationMessageLines;
  content?: string;
  replyToId: string | null;
  attachmentFileIds?: string[];
}

function messageLines(json: Prisma.JsonValue | null): NegotiationMessageLines {
  return json === null ? [] : (json as unknown as NegotiationMessageLines);
}

/**
 * 议价（M11 R11-7 ~ R11-11，05 §5）：采购方发目标价、接受反提案、结束议价；供应商接受、拒绝、反提案。
 * 写操作先锁询价单（采购方 FOR UPDATE、供应商 FOR SHARE，与开标、定标、取消等轮次迁移串行）再锁报价单（FOR UPDATE），
 * 与 M09 QuoteSubmissionService 的加锁顺序一致；锁住后按 05 §5 的轮流表复核。每一步都写审计（不含金额）、给对方发邮件，
 * 成交时以当前版本为底生成 QuoteVersion(source = NEGOTIATION)
 */
@Injectable()
export class NegotiationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly seal: SealService,
    private readonly sheet: QuoteSheetService,
    private readonly notices: InquiryNoticesService,
    private readonly fieldMask: FieldMaskService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  // ---------- 采购方 ----------

  /** GET /api/quotes/:quoteId/negotiation：数据权限外 404，没开标 QUOTE_SEALED；价格按 negotiation.amount 脱敏（R11-10） */
  async thread(user: AuthUser, quoteId: string): Promise<NegotiationThreadDto> {
    const target = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      select: { round: { select: { inquiryId: true } } },
    });
    if (!target) throw new AppException('NOT_FOUND');
    await this.access.findOrThrow(this.prisma, user, target.round.inquiryId);
    const quote = (await loadQuote(this.prisma, { id: quoteId }))!;
    await this.seal.assertCanViewQuoteContent(user, quote.round);
    return this.toThread(quote, {
      maskNegotiation: !this.fieldMask.can(user, 'negotiation.amount'),
      maskQuote: !this.fieldMask.can(user, 'quote.amount'),
      actions: (ctx) => computeBuyerNegotiationActions(ctx, user.permissions),
    });
  }

  /** 采购方发目标价：没有议价时创建（OPEN），成交后再议回到 OPEN（R11-9） */
  async offer(user: AuthUser, quoteId: string, input: NegotiationOfferInput): Promise<NegotiationThreadDto> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForBuyer(tx, user, quoteId);
      this.assertTurn(locked, 'BUYER', 'OFFER');
      const lines = await this.proposalLines(tx, locked.quote, input.lines);
      await this.checkAttachments(tx, user, input.attachmentFileIds);
      const negotiationRound = locked.offers + 1;
      const message = await this.append(tx, user, locked, {
        party: 'BUYER',
        type: 'OFFER',
        lines,
        content: input.content,
        replyToId: locked.last?.id ?? null,
        attachmentFileIds: input.attachmentFileIds,
      });
      await this.notices.negotiationToSupplier(tx, locked.quote.round.inquiry, locked.quote, {
        type: 'OFFER',
        negotiationRound,
      });
      await this.log(tx, user, locked.quote, 'negotiation.offer', negotiationRound, {
        seq: message.seq,
        lineCount: lines.length,
        attachmentCount: input.attachmentFileIds.length,
      });
    });
    return this.thread(user, quoteId);
  }

  /** 采购方接受供应商的反提案（messageId 必须是最近一条 COUNTER）→ 成交 */
  async accept(
    user: AuthUser,
    quoteId: string,
    input: NegotiationAcceptInput,
  ): Promise<NegotiationThreadDto> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForBuyer(tx, user, quoteId);
      this.assertTurn(locked, 'BUYER', 'ACCEPT');
      if (locked.last!.id !== input.messageId) throw new AppException('NEGOTIATION_NOT_YOUR_TURN');
      await this.agree(tx, user, locked, undefined);
    });
    return this.thread(user, quoteId);
  }

  /** 采购方结束议价（终态，之后任何操作 NEGOTIATION_CLOSED） */
  async close(user: AuthUser, quoteId: string, input: NegotiationCloseInput): Promise<NegotiationThreadDto> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForBuyer(tx, user, quoteId);
      this.assertTurn(locked, 'BUYER', 'CLOSE');
      const now = this.clock.now();
      const message = await this.append(tx, user, locked, {
        party: 'BUYER',
        type: 'CLOSE',
        content: input.content,
        replyToId: locked.last?.id ?? null,
      });
      await tx.negotiation.update({
        where: { id: locked.quote.negotiation!.id },
        data: { status: 'CLOSED', closedAt: now },
      });
      await this.notices.negotiationToSupplier(tx, locked.quote.round.inquiry, locked.quote, {
        type: 'CLOSE',
        negotiationRound: locked.offers,
      });
      await this.log(tx, user, locked.quote, 'negotiation.close', locked.offers, { seq: message.seq });
    });
    return this.thread(user, quoteId);
  }

  // ---------- 供应商 ----------

  /** GET /api/portal/quotes/:quoteId/negotiation：只能看自己的报价单（P-1），内容不脱敏（R11-10） */
  async portalThread(user: AuthUser, quoteId: string): Promise<NegotiationThreadDto> {
    const quote = await loadQuote(this.prisma, { id: quoteId, ...ownQuoteWhere(user) });
    if (!quote) throw new AppException('NOT_FOUND');
    return this.toThread(quote, {
      maskNegotiation: false,
      maskQuote: false,
      actions: (ctx) => computeSupplierNegotiationActions(ctx),
    });
  }

  /** 供应商回复采购方的 OFFER（replyToId 必须是它）：ACCEPT 成交；REJECT、COUNTER 原因必填，COUNTER 至少一行 */
  async respond(
    user: AuthUser,
    quoteId: string,
    input: NegotiationRespondInput,
  ): Promise<NegotiationThreadDto> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForSupplier(tx, user, quoteId);
      this.assertTurn(locked, 'SUPPLIER', input.type);
      if (locked.last!.id !== input.replyToId) throw new AppException('NEGOTIATION_NOT_YOUR_TURN');
      if (input.type === 'ACCEPT') {
        await this.agree(tx, user, locked, input);
        return;
      }
      if (!input.content) throw new AppException('NEGOTIATION_REASON_REQUIRED');
      const lines =
        input.type === 'COUNTER' ? await this.proposalLines(tx, locked.quote, input.lines) : undefined;
      await this.checkAttachments(tx, user, input.attachmentFileIds);
      const message = await this.append(tx, user, locked, {
        party: 'SUPPLIER',
        type: input.type,
        lines,
        content: input.content,
        replyToId: locked.last!.id,
        attachmentFileIds: input.attachmentFileIds,
      });
      await this.notices.negotiationToBuyer(tx, locked.quote.round.inquiry, locked.quote, {
        type: input.type,
        negotiationRound: locked.offers,
      });
      await this.log(tx, user, locked.quote, `negotiation.${input.type.toLowerCase()}`, locked.offers, {
        seq: message.seq,
        lineCount: lines?.length ?? 0,
        attachmentCount: input.attachmentFileIds.length,
      });
    });
    return this.portalThread(user, quoteId);
  }

  // ---------- 内部 ----------

  /** 采购方：数据权限外 404；锁询价单（FOR UPDATE）→ 锁报价单 */
  private async lockForBuyer(tx: Prisma.TransactionClient, user: AuthUser, quoteId: string): Promise<Locked> {
    const target = await tx.quote.findUnique({
      where: { id: quoteId },
      select: { round: { select: { inquiryId: true } } },
    });
    if (!target) throw new AppException('NOT_FOUND');
    await this.access.lockOrThrow(tx, user, target.round.inquiryId);
    return this.lockQuote(tx, quoteId);
  }

  /** 供应商：只能是自己的报价单；锁询价单（FOR SHARE）→ 锁报价单。询价完成或取消后只读（R12-8） */
  private async lockForSupplier(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    quoteId: string,
  ): Promise<Locked> {
    const target = await tx.quote.findFirst({
      where: { id: quoteId, ...ownQuoteWhere(user) },
      select: { round: { select: { inquiryId: true } } },
    });
    if (!target) throw new AppException('NOT_FOUND');
    const inquiryId = target.round.inquiryId;
    await tx.$queryRaw`SELECT 1 FROM "Inquiry" WHERE "id" = ${inquiryId} FOR SHARE`;
    assertInquiryWritable(
      await tx.inquiry.findUniqueOrThrow({
        where: { id: inquiryId },
        select: { docStatus: true, currentRoundStatus: true },
      }),
    );
    return this.lockQuote(tx, quoteId);
  }

  private async lockQuote(tx: Prisma.TransactionClient, quoteId: string): Promise<Locked> {
    await tx.$queryRaw`SELECT 1 FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`;
    const quote = (await loadQuote(tx, { id: quoteId }))!;
    const negotiationId = quote.negotiation?.id;
    if (!negotiationId) return { quote, last: null, offers: 0 };
    const last = await tx.negotiationMessage.findFirst({
      where: { negotiationId },
      orderBy: { seq: 'desc' },
      select: lastSelect,
    });
    const offers = await tx.negotiationMessage.count({ where: { negotiationId, type: 'OFFER' } });
    return { quote, last, offers };
  }

  /** 关闭的 → NEGOTIATION_CLOSED；不满足前置条件 → NEGOTIATION_NOT_ALLOWED；不是这一方、这一步 → NEGOTIATION_NOT_YOUR_TURN */
  private assertTurn({ quote, last }: Locked, party: NegotiationParty, type: NegotiationMsgType): void {
    if (quote.negotiation?.status === 'CLOSED') throw new AppException('NEGOTIATION_CLOSED');
    const ctx = {
      roundStatus: quote.round.status,
      quoteStatus: quote.status,
      shortlisted: quote.shortlisted,
    };
    if (!canNegotiate(ctx)) throw new AppException('NEGOTIATION_NOT_ALLOWED');
    const moves = negotiationNextMoves(last);
    if (moves.party !== party || !moves.types.includes(type))
      throw new AppException('NEGOTIATION_NOT_YOUR_TURN');
  }

  /**
   * OFFER / COUNTER 的提案：丢弃什么都没填的行，一行都不剩 NEGOTIATION_EMPTY_OFFER；询价行必须属于本轮；
   * 价格还要符合该轮冻结模板里含税单价列的精度和范围（成交时写进报价取值）
   */
  private async proposalLines(
    tx: Prisma.TransactionClient,
    quote: QuoteRow,
    input: NegotiationLineInput[],
  ): Promise<NegotiationMessageLines> {
    if (!input.some(hasNegotiationContent)) throw new AppException('NEGOTIATION_EMPTY_OFFER');
    const rows = await tx.inquiryLine.findMany({
      where: { roundId: quote.round.id },
      select: { id: true, lineNo: true },
    });
    const lineNo = new Map(rows.map((r) => [r.id, r.lineNo]));
    const template = await this.sheet.template(quote.round, tx);
    const priceColumn = template.columns.find((c) => c.key === UNIT_PRICE_KEY);
    const details: { path: string; code: string; message: string }[] = [];
    input.forEach((line, i) => {
      if (!hasNegotiationContent(line)) return;
      if (!lineNo.has(line.lineId))
        details.push({ path: `lines.${i}.lineId`, code: 'not_found', message: 'Line not found' });
      if (line.unitPriceInclTax !== undefined && priceColumn) {
        const checked = normalizePplValue(priceColumn, line.unitPriceInclTax, null);
        if (!checked.ok)
          details.push({ path: `lines.${i}.unitPriceInclTax`, code: checked.code, message: 'Invalid price' });
      }
    });
    if (details.length > 0) throw new AppException('VALIDATION_FAILED', undefined, details);
    const lines = input
      .filter(hasNegotiationContent)
      .sort((a, b) => lineNo.get(a.lineId)! - lineNo.get(b.lineId)!)
      .map((l) => ({
        lineId: l.lineId,
        ...(l.unitPriceInclTax !== undefined ? { unitPriceInclTax: l.unitPriceInclTax } : {}),
        ...(l.quantity !== undefined ? { quantity: l.quantity } : {}),
        ...(l.specNote !== undefined ? { specNote: l.specNote } : {}),
      }));
    return negotiationMessageLinesSchema.parse(lines);
  }

  /**
   * R11-8：每条消息最多 10 个附件，只能是报价附件类（ATTACHMENT）；内部用户只能挂自己上传的，
   * 供应商只能挂本供应商的人上传的（防止借用别人的文件 id）
   */
  private async checkAttachments(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    fileIds: string[],
  ): Promise<void> {
    if (fileIds.length > NEGOTIATION_ATTACHMENTS_MAX)
      throw new AppException('FILE_LIMIT_EXCEEDED', { max: NEGOTIATION_ATTACHMENTS_MAX });
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
    const own =
      user.userType === 'SUPPLIER'
        ? (await tx.user.count({ where: { id: { in: uploaderIds }, supplierId: user.supplierId } })) ===
          uploaderIds.length
        : uploaderIds.length === 1 && uploaderIds[0] === user.id;
    if (!own) throw new AppException('FILE_ACCESS_DENIED');
  }

  /** 追加一条消息（报价单已锁，seq 不会冲突）；没有议价时先建，成交后再议回到 OPEN */
  private async append(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    locked: Locked,
    message: NewMessage,
  ): Promise<{ id: string; seq: number }> {
    const now = this.clock.now();
    let negotiationId = locked.quote.negotiation?.id;
    if (!negotiationId) {
      negotiationId = (
        await tx.negotiation.create({
          data: { quoteId: locked.quote.id, createdAt: now },
          select: { id: true },
        })
      ).id;
    } else if (message.type === 'OFFER' && locked.quote.negotiation!.status !== 'OPEN') {
      await tx.negotiation.update({ where: { id: negotiationId }, data: { status: 'OPEN' } });
    }
    const created = await tx.negotiationMessage.create({
      data: {
        negotiationId,
        seq: (locked.last?.seq ?? 0) + 1,
        party: message.party,
        type: message.type,
        lines: message.lines ? (message.lines as Prisma.InputJsonValue) : undefined,
        content: message.content ?? null,
        replyToId: message.replyToId,
        createdById: user.id,
        createdAt: now,
      },
      select: { id: true, seq: true },
    });
    const fileIds = message.attachmentFileIds ?? [];
    if (fileIds.length > 0) {
      await tx.attachment.createMany({
        data: fileIds.map((fileId) => ({
          ownerType: NEGOTIATION_MESSAGE_OWNER,
          ownerId: created.id,
          fileId,
          createdById: user.id,
          createdAt: now,
        })),
      });
    }
    return created;
  }

  /**
   * 成交（05 §5、R11-9）：追加 ACCEPT（回复最近一条提案），以当前版本为底按被接受的提案逐行覆盖含税单价、数量
   * （写进取值作为议价数量）、把规格说明追加到 change_note（前缀"议价第 N 轮："），重算公式和合计，生成
   * QuoteVersion(source = NEGOTIATION)（备注、附件沿用当前版本，变更备注取提案的方案说明）；当前版本切到它，议价 → AGREED
   */
  private async agree(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    locked: Locked,
    reply: Pick<NegotiationRespondInput, 'content' | 'attachmentFileIds'> | undefined,
  ): Promise<void> {
    const { quote } = locked;
    const proposal = locked.last!;
    const negotiationRound = locked.offers;
    const party: NegotiationParty = user.userType === 'SUPPLIER' ? 'SUPPLIER' : 'BUYER';
    if (reply) await this.checkAttachments(tx, user, reply.attachmentFileIds);
    const message = await this.append(tx, user, locked, {
      party,
      type: 'ACCEPT',
      content: reply?.content,
      replyToId: proposal.id,
      attachmentFileIds: reply?.attachmentFileIds,
    });

    const template = await this.sheet.template(quote.round, tx);
    const sheetLines = await this.sheet.lines(quote.round.id, quote.round.inquiry.currency, tx);
    const current = await tx.quoteVersion.findUniqueOrThrow({
      where: { id: quote.currentVersionId! },
      select: { id: true, values: true, remark: true },
    });
    const base = new Map(
      (current.values as unknown as QuoteVersionValues).lines.map((l) => [l.lineId, l.values]),
    );
    const proposed = new Map(messageLines(proposal.lines).map((l) => [l.lineId, l]));
    const column = (key: string) => template.columns.find((c) => c.key === key);
    const priceColumn = column(UNIT_PRICE_KEY);
    const noteColumn = column(CHANGE_NOTE_KEY);
    const noteMax = noteColumn?.maxLength ?? PPL_TEXT_MAX_LENGTH.textarea;
    const lines: QuoteVersionValues['lines'] = sheetLines.map((line) => {
      const values: PplValues = { ...base.get(line.id) };
      const p = proposed.get(line.id);
      if (p?.unitPriceInclTax !== undefined && priceColumn) {
        const price = normalizePplValue(priceColumn, p.unitPriceInclTax, null);
        if (price.ok && price.value !== null) values[UNIT_PRICE_KEY] = price.value;
      }
      if (p?.quantity !== undefined) values[PPL_QUANTITY_KEY] = p.quantity;
      if (p?.specNote && noteColumn?.source === 'supplier') {
        const note = `议价第 ${negotiationRound} 轮：${p.specNote}`;
        const before = typeof values[CHANGE_NOTE_KEY] === 'string' ? values[CHANGE_NOTE_KEY] : '';
        // 超长时保留最新的内容
        values[CHANGE_NOTE_KEY] = (before ? `${before}\n${note}` : note).slice(-noteMax);
      }
      return {
        lineId: line.id,
        lineNo: line.lineNo,
        values: applyFormulas(template.columns, values, { quantity: line.quantity }),
      };
    });
    const totalAmount = quoteTotal(lines.map((l) => l.values));
    if (new Dec(totalAmount).greaterThan(MAX_TOTAL)) {
      throw new AppException('QUOTE_VALUES_INVALID', { count: 1 }, [
        {
          lineId: null,
          lineNo: null,
          key: 'total_price_incl_tax',
          code: 'too_large',
          message: 'Total is too large',
        },
      ]);
    }

    const now = this.clock.now();
    const last = await tx.quoteVersion.aggregate({ where: { quoteId: quote.id }, _max: { versionNo: true } });
    const versionNo = (last._max.versionNo ?? 0) + 1;
    const version = await tx.quoteVersion.create({
      data: {
        quoteId: quote.id,
        versionNo,
        source: 'NEGOTIATION',
        values: quoteVersionValuesSchema.parse({ lines }) as Prisma.InputJsonValue,
        totalAmount,
        currency: quote.round.inquiry.currency,
        remark: current.remark,
        changeNote: proposal.content,
        templateVersion: template.version,
        variantCode: template.variantCode,
        negotiationMessageId: message.id,
        submittedById: user.id,
        submittedAt: now,
      },
      select: { id: true },
    });
    const files = await tx.attachment.findMany({
      where: { ownerType: QUOTE_VERSION_OWNER, ownerId: current.id },
      select: { fileId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (files.length > 0) {
      await tx.attachment.createMany({
        data: files.map((f) => ({
          ownerType: QUOTE_VERSION_OWNER,
          ownerId: version.id,
          fileId: f.fileId,
          createdById: user.id,
          createdAt: now,
        })),
      });
    }
    const res = await tx.quote.updateMany({
      where: { id: quote.id, status: 'EVALUATING' },
      data: { currentVersionId: version.id },
    });
    if (res.count !== 1) throw new AppException('NEGOTIATION_NOT_ALLOWED');
    await tx.negotiation.update({
      where: { id: quote.negotiation!.id },
      data: { status: 'AGREED', agreedAt: now },
    });
    await this.notices.negotiationAgreed(tx, quote.round.inquiry, quote, { negotiationRound, versionNo });
    await this.log(tx, user, quote, 'negotiation.accept', negotiationRound, {
      seq: message.seq,
      acceptedSeq: proposal.seq,
      versionNo,
    });
  }

  /** 议价线程：消息（按 seq）、附件、成交生成的版本号、参照行（询价行与当前版本的单价、数量）、allowedActions */
  private async toThread(
    quote: QuoteRow,
    opts: {
      maskNegotiation: boolean;
      maskQuote: boolean;
      actions: (ctx: Parameters<typeof negotiationAwaiting>[0]) => NegotiationAction[];
    },
    client: Client = this.prisma,
  ): Promise<NegotiationThreadDto> {
    const rows = quote.negotiation
      ? await client.negotiationMessage.findMany({
          where: { negotiationId: quote.negotiation.id },
          orderBy: { seq: 'asc' },
          select: {
            ...lastSelect,
            replyToId: true,
            createdAt: true,
            createdBy: { select: { name: true } },
            resultVersion: { select: { versionNo: true } },
          },
        })
      : [];
    const attachments = await client.attachment.findMany({
      where: { ownerType: NEGOTIATION_MESSAGE_OWNER, ownerId: { in: rows.map((r) => r.id) } },
      include: { file: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const sheetLines = await this.sheet.lines(quote.round.id, quote.round.inquiry.currency, client);
    const lineNo = new Map(sheetLines.map((l) => [l.id, l.lineNo]));
    const current = quote.currentVersionId
      ? await client.quoteVersion.findUnique({
          where: { id: quote.currentVersionId },
          select: { versionNo: true, values: true },
        })
      : null;
    const currentValues = new Map(
      ((current?.values as unknown as QuoteVersionValues | undefined)?.lines ?? []).map((l) => [
        l.lineId,
        l.values,
      ]),
    );

    let negotiationRound = 0;
    const messages = rows.map((r): NegotiationMessageDto => {
      if (r.type === 'OFFER') negotiationRound += 1;
      const lines = messageLines(r.lines).map((l) => ({
        lineId: l.lineId,
        lineNo: lineNo.get(l.lineId) ?? 0,
        unitPriceInclTax: opts.maskNegotiation ? null : (l.unitPriceInclTax ?? null),
        quantity: l.quantity ?? null,
        specNote: l.specNote ?? null,
      }));
      return {
        id: r.id,
        seq: r.seq,
        negotiationRound,
        party: r.party,
        type: r.type,
        lines,
        content: r.content,
        replyToId: r.replyToId,
        author: { name: r.createdBy.name },
        createdAt: r.createdAt.toISOString(),
        attachments: attachments.filter((a) => a.ownerId === r.id).map((a) => toFileDto(a.file)),
        resultVersionNo: r.resultVersion?.versionNo ?? null,
        ...(opts.maskNegotiation && lines.length > 0 ? { maskedFields: ['unitPriceInclTax'] } : {}),
      };
    });
    const ctx = {
      roundStatus: quote.round.status,
      quoteStatus: quote.status,
      shortlisted: quote.shortlisted,
      status: quote.negotiation?.status ?? null,
      last: rows.at(-1) ?? null,
    };
    const { supplier } = quote;
    return {
      quoteId: quote.id,
      supplier: { id: supplier.id, code: supplier.code, nameZh: supplier.nameZh, nameEn: supplier.nameEn },
      quoteStatus: quote.status,
      shortlisted: quote.shortlisted,
      status: ctx.status,
      awaiting: negotiationAwaiting(ctx),
      currency: quote.round.inquiry.currency,
      currentVersionNo: current?.versionNo ?? null,
      lines: sheetLines.map((l) => {
        const values = currentValues.get(l.id);
        const price = values?.[UNIT_PRICE_KEY];
        const quantity = values?.[PPL_QUANTITY_KEY];
        return {
          lineId: l.id,
          lineNo: l.lineNo,
          materialCode: l.materialCode,
          nameZh: l.nameZh,
          nameEn: l.nameEn,
          spec: l.spec ?? '',
          unitNameZh: l.unitNameZh ?? '',
          unitNameEn: l.unitNameEn,
          quantity: l.quantity ?? '',
          currentUnitPrice: opts.maskQuote || typeof price !== 'string' ? null : price,
          currentQuantity: typeof quantity === 'string' ? quantity : (l.quantity ?? ''),
        };
      }),
      messages,
      allowedActions: opts.actions(ctx),
      ...(opts.maskQuote ? { maskedFields: ['currentUnitPrice'] } : {}),
    };
  }

  /** R11-11：议价每一步记在询价单的操作日志里，不含金额（I-11） */
  private async log(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    quote: QuoteRow,
    action: string,
    negotiationRound: number,
    detail: Record<string, string | number>,
  ): Promise<void> {
    const { inquiry, roundNo } = quote.round;
    await this.audit.log(
      {
        actor: user,
        action,
        entityType: 'inquiry',
        entityId: inquiry.id,
        summary: [inquiry.formalNo, quote.supplier.code, `#${negotiationRound}`].join(' · '),
        detail: { roundNo, quoteId: quote.id, negotiationRound, ...detail },
      },
      tx,
    );
  }
}
