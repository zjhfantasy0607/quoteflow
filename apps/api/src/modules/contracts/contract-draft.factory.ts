import { Injectable, Module } from '@nestjs/common';
import {
  contractSnapshotSchema,
  type ContractSnapshot,
  type InquiryFileKind,
  type QuoteVersionValues,
} from '@quoteflow/shared';
import type { Prisma } from '../../generated/prisma/client';
import { SequenceService } from '../../infra/sequences/sequence.service';
import { FILE_ORDER } from '../inquiries/inquiry-dto';
import { PplModule } from '../ppl/ppl.controller';
import { PplService, resolveVariantColumns } from '../ppl/ppl.service';
import { QUOTE_VERSION_OWNER } from '../quotes/quote-dto';

/** 预填合同付款方式的报价列（字典 payment_terms，04 §9） */
const PAYMENT_TERMS_KEY = 'payment_terms';

const unique = <T>(values: T[]) => [...new Set(values)];

/** 定标事务里要建合同的那张报价单 */
export interface ContractDraftInput {
  inquiryId: string;
  roundId: string;
  quoteId: string;
  /** 定标人（Contract.createdById） */
  actorId: string;
  now: Date;
}

/**
 * 定标时生成合同草稿（M12 R12-5、I-9，合同管理界面在 M14）：在调用方的事务里写一条 Contract(DRAFT)，
 * 合同号 CT-yyyymm-nnnn，金额、币种取中标版本（报价单当前版本，可能是议价成交生成的），付款方式预填中标版本
 * payment_terms 的字典中文名称，快照按 02 §4 冻结询价、询价行、供应商、中标版本、列定义、议价记录和规格附件。
 * 事务只有一个连接，查询依次执行、每次最多带一个关联
 */
@Injectable()
export class ContractDraftFactory {
  constructor(
    private readonly ppl: PplService,
    private readonly sequences: SequenceService,
  ) {}

  async create(
    tx: Prisma.TransactionClient,
    input: ContractDraftInput,
  ): Promise<{ id: string; contractNo: string }> {
    const snapshot = await this.snapshot(tx, input);
    const version = snapshot.quoteVersion;
    const contractNo = await this.sequences.contractNo(input.now, tx);
    const contract = await tx.contract.create({
      data: {
        contractNo,
        inquiryId: input.inquiryId,
        roundId: input.roundId,
        quoteId: input.quoteId,
        quoteVersionId: version.id,
        supplierId: snapshot.supplier.id,
        status: 'DRAFT',
        amount: version.totalAmount,
        currency: version.currency,
        paymentTerms: await this.paymentTerms(tx, version.values),
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        createdById: input.actorId,
        createdAt: input.now,
      },
      select: { id: true, contractNo: true },
    });
    return contract;
  }

  /** 02 §4 Contract.snapshot，写入前按 contractSnapshotSchema 校验 */
  private async snapshot(tx: Prisma.TransactionClient, input: ContractDraftInput): Promise<ContractSnapshot> {
    const inquiry = await tx.inquiry.findUniqueOrThrow({ where: { id: input.inquiryId } });
    const materialCategory = await tx.materialCategory.findUniqueOrThrow({
      where: { id: inquiry.materialCategoryId },
    });
    const owner = await tx.user.findUniqueOrThrow({
      where: { id: inquiry.ownerId },
      select: { id: true, name: true },
    });
    const round = await tx.inquiryRound.findUniqueOrThrow({ where: { id: input.roundId } });
    const quote = await tx.quote.findUniqueOrThrow({ where: { id: input.quoteId } });
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: quote.supplierId } });
    // 评标中的报价单一定提交过（有当前版本）
    const version = await tx.quoteVersion.findUniqueOrThrow({ where: { id: quote.currentVersionId! } });

    const lines = await tx.inquiryLine.findMany({ where: { roundId: round.id }, orderBy: { lineNo: 'asc' } });
    const categories = await tx.materialCategory.findMany({
      where: { id: { in: unique(lines.map((l) => l.categoryId)) } },
    });
    const categoryOf = new Map(categories.map((c) => [c.id, c]));
    const units = await tx.dictItem.findMany({
      where: { typeCode: 'unit', code: { in: unique(lines.map((l) => l.unitCode)) } },
    });
    const unitOf = new Map(units.map((u) => [u.code, u]));
    const codeName = (c: { code: string; nameZh: string; nameEn: string }) => ({
      code: c.code,
      nameZh: c.nameZh,
      nameEn: c.nameEn,
    });

    // 发布时一定冻结了模板（M07）
    const definition = await this.ppl.definition(round.pplTemplateVersion!, tx);
    const attachments = await tx.attachment.findMany({
      where: { ownerType: QUOTE_VERSION_OWNER, ownerId: version.id },
      include: { file: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const negotiation = await tx.negotiation.findUnique({
      where: { quoteId: quote.id },
      select: { id: true },
    });
    const messages = negotiation
      ? await tx.negotiationMessage.findMany({
          where: { negotiationId: negotiation.id },
          orderBy: { seq: 'asc' },
        })
      : [];
    const files = await tx.inquiryFile.findMany({
      where: { roundId: round.id },
      include: { file: true },
      orderBy: FILE_ORDER,
    });
    const lineNoOf = new Map(lines.map((l) => [l.id, l.lineNo]));

    return contractSnapshotSchema.parse({
      capturedAt: input.now.toISOString(),
      inquiry: {
        id: inquiry.id,
        // 只有审批通过（有正式询价号）的询价单才能发布、定标
        formalNo: inquiry.formalNo!,
        projectNo: inquiry.projectNo,
        title: inquiry.title,
        currency: inquiry.currency,
        roundNo: round.roundNo,
        materialCategory: codeName(materialCategory),
        owner,
      },
      lines: lines.map((l) => {
        const unit = unitOf.get(l.unitCode);
        return {
          lineId: l.id,
          lineNo: l.lineNo,
          materialCode: l.materialCode,
          nameZh: l.nameZh,
          nameEn: l.nameEn,
          spec: l.spec,
          unit: unit ? codeName(unit) : { code: l.unitCode, nameZh: l.unitCode, nameEn: l.unitCode },
          quantity: l.quantity.toFixed(),
          category: codeName(categoryOf.get(l.categoryId)!),
        };
      }),
      supplier: {
        id: supplier.id,
        code: supplier.code,
        nameZh: supplier.nameZh,
        nameEn: supplier.nameEn,
        contactName: supplier.contactName,
        contactEmail: supplier.contactEmail,
        contactPhone: supplier.contactPhone,
      },
      quoteVersion: {
        id: version.id,
        versionNo: version.versionNo,
        source: version.source,
        submittedAt: version.submittedAt.toISOString(),
        totalAmount: version.totalAmount.toFixed(2),
        currency: version.currency,
        values: version.values,
        remark: version.remark,
        changeNote: version.changeNote,
        templateVersion: version.templateVersion,
        variantCode: version.variantCode,
        attachments: attachments.map((a) => ({ fileId: a.fileId, originalName: a.file.originalName })),
      },
      columns: resolveVariantColumns(definition, round.pplVariantCode),
      negotiation:
        messages.length > 0
          ? messages.map((m) => ({
              seq: m.seq,
              party: m.party,
              type: m.type,
              lines: m.lines ?? [],
              content: m.content,
              createdAt: m.createdAt.toISOString(),
            }))
          : null,
      files: files.map((f) => ({
        fileId: f.fileId,
        originalName: f.file.originalName,
        kind: f.kind as InquiryFileKind,
        lineNo: f.lineId ? (lineNoOf.get(f.lineId) ?? null) : null,
      })),
    });
  }

  /**
   * 付款方式预填为中标版本 payment_terms 的字典中文名称（合同以中文为准，可在 M14 编辑）；各行不同时按行号顺序
   * 用"；"连接，没填或模板里没有该列时为 null；字典项不存在时保留编码
   */
  private async paymentTerms(
    tx: Prisma.TransactionClient,
    values: QuoteVersionValues,
  ): Promise<string | null> {
    const codes = unique(
      values.lines.flatMap((l) => {
        const v = l.values[PAYMENT_TERMS_KEY];
        return typeof v === 'string' && v ? [v] : [];
      }),
    );
    if (codes.length === 0) return null;
    const items = await tx.dictItem.findMany({ where: { typeCode: 'payment_terms', code: { in: codes } } });
    const nameOf = new Map(items.map((i) => [i.code, i.nameZh]));
    return codes.map((c) => nameOf.get(c) ?? c).join('；');
  }
}

/** 合同（01 §4.1 modules/contracts）：M12 只有定标时生成草稿，列表、详情、流转在 M14 补充 */
@Module({
  imports: [PplModule],
  providers: [ContractDraftFactory],
  exports: [ContractDraftFactory],
})
export class ContractsModule {}
