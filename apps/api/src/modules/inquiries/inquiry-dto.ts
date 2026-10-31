import {
  diffRounds,
  inquiryDisplayStatus,
  type InquiryAction,
  type InquiryFileDto,
  type InquiryFileKind,
  type InquiryLineDto,
  type InquiryListItemDto,
  type InquiryRoundDto,
  type MaterialCategoryBriefDto,
  type RoundDiffDto,
  type RoundDiffFile,
  type RoundDiffRoundInput,
} from '@quoteflow/shared';
import type { InquiryRound, MaterialCategory, Prisma } from '../../generated/prisma/client';
import { toFileDto } from '../../infra/files/files.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CategoryIndex } from '../material-categories/material-categories.service';

type Client = PrismaService | Prisma.TransactionClient;

const userBrief = { select: { id: true, name: true } } as const;

export const inquiryListInclude = {
  materialCategory: true,
  owner: userBrief,
  pdUser: userBrief,
} satisfies Prisma.InquiryInclude;
export type InquiryListRow = Prisma.InquiryGetPayload<{ include: typeof inquiryListInclude }>;

export const inquiryDetailInclude = {
  ...inquiryListInclude,
  createdBy: userBrief,
} satisfies Prisma.InquiryInclude;
export type InquiryDetailRow = Prisma.InquiryGetPayload<{ include: typeof inquiryDetailInclude }>;

const lineWithCategory = { category: true } satisfies Prisma.InquiryLineInclude;
type LineRow = Prisma.InquiryLineGetPayload<{ include: typeof lineWithCategory }>;

const fileWithObject = { file: true } satisfies Prisma.InquiryFileInclude;
type InquiryFileRow = Prisma.InquiryFileGetPayload<{ include: typeof fileWithObject }>;

/** 附件按挂载顺序 */
export const FILE_ORDER: Prisma.InquiryFileOrderByWithRelationInput[] = [{ sort: 'asc' }, { id: 'asc' }];

export type RoundRow = InquiryRound & { lines: LineRow[]; files: InquiryFileRow[] };

/**
 * 轮次连同行（按行号）和附件。常在事务里调用：Prisma 会把同一个 include 里的多个一对多关系并发查询，
 * 而事务只有一个连接（pg 已废弃在同一连接上并发查询），所以分开依次查
 */
export async function loadRound(
  client: Client,
  inquiryId: string,
  roundNo: number,
): Promise<RoundRow | null> {
  const round = await client.inquiryRound.findUnique({
    where: { inquiryId_roundNo: { inquiryId, roundNo } },
  });
  if (!round) return null;
  const lines = await client.inquiryLine.findMany({
    where: { roundId: round.id },
    include: lineWithCategory,
    orderBy: { lineNo: 'asc' },
  });
  const files = await client.inquiryFile.findMany({
    where: { roundId: round.id },
    include: fileWithObject,
    orderBy: FILE_ORDER,
  });
  return { ...round, lines, files };
}

/** 未发布的变更轮次（DRAFT，第 N 轮，05 §3 最多一个）的轮次号；没有为 null */
export async function findDraftRoundNo(client: Client, inquiryId: string): Promise<number | null> {
  const draft = await client.inquiryRound.findFirst({
    where: { inquiryId, status: 'DRAFT', roundNo: { gt: 1 } },
    select: { roundNo: true },
  });
  return draft?.roundNo ?? null;
}

/**
 * R13-6：第 roundNo 轮与上一轮的规格对比；轮次不存在或是第 1 轮时为 null。
 * includeRemark = false（门户）时不比较、不返回询价行备注（P-5）
 */
export async function loadRoundDiff(
  client: Client,
  inquiryId: string,
  roundNo: number,
  options: { includeRemark: boolean },
): Promise<RoundDiffDto | null> {
  if (roundNo < 2) return null;
  const current = await loadRound(client, inquiryId, roundNo);
  const previous = await loadRound(client, inquiryId, roundNo - 1);
  if (!current || !previous) return null;
  const toFile = (f: InquiryFileRow): RoundDiffFile => ({
    fileId: f.fileId,
    originalName: f.file.originalName,
    kind: f.kind as InquiryFileKind,
  });
  const toInput = (round: RoundRow): RoundDiffRoundInput => ({
    lines: round.lines.map((l) => ({
      lineId: l.id,
      lineNo: l.lineNo,
      sourceLineId: l.sourceLineId,
      materialCode: l.materialCode,
      nameZh: l.nameZh,
      nameEn: l.nameEn,
      spec: l.spec,
      unitCode: l.unitCode,
      quantity: l.quantity.toFixed(),
      category: {
        id: l.category.id,
        code: l.category.code,
        nameZh: l.category.nameZh,
        nameEn: l.category.nameEn,
      },
      brand: l.brand,
      drawingRef: l.drawingRef,
      remark: l.remark,
      files: round.files.filter((f) => f.lineId === l.id).map(toFile),
    })),
    files: round.files.filter((f) => f.lineId === null).map(toFile),
  });
  return {
    roundNo,
    previousRoundNo: roundNo - 1,
    changeReason: current.changeReason,
    changeSummary: current.changeSummary,
    ...diffRounds(toInput(previous), toInput(current), options),
  };
}

/** 单行连同附件（同样分开查询） */
export async function loadLine(
  client: Client,
  lineId: string,
): Promise<{ line: LineRow; files: InquiryFileRow[] }> {
  const line = await client.inquiryLine.findUniqueOrThrow({
    where: { id: lineId },
    include: lineWithCategory,
  });
  const files = await client.inquiryFile.findMany({
    where: { lineId },
    include: fileWithObject,
    orderBy: FILE_ORDER,
  });
  return { line, files };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function categoryBrief(c: MaterialCategory, index: CategoryIndex): MaterialCategoryBriefDto {
  return {
    id: c.id,
    code: c.code,
    nameZh: c.nameZh,
    nameEn: c.nameEn,
    effectiveEnabled: index.isEffectiveEnabled(c.id),
  };
}

export function toInquiryListItemDto(row: InquiryListRow, index: CategoryIndex): InquiryListItemDto {
  return {
    id: row.id,
    draftNo: row.draftNo,
    formalNo: row.formalNo,
    projectNo: row.projectNo,
    title: row.title,
    materialCategory: categoryBrief(row.materialCategory, index),
    currency: row.currency,
    docStatus: row.docStatus,
    displayStatus: inquiryDisplayStatus(row.docStatus, row.currentRoundStatus),
    currentRoundNo: row.currentRoundNo,
    currentRoundStatus: row.currentRoundStatus,
    currentDeadline: iso(row.currentDeadline),
    owner: row.owner,
    pdUser: row.pdUser,
    submittedAt: iso(row.submittedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toInquiryFileDto(f: InquiryFileRow): InquiryFileDto {
  return {
    id: f.id,
    kind: f.kind as InquiryFileKind,
    lineId: f.lineId,
    file: toFileDto(f.file),
    createdAt: f.createdAt.toISOString(),
  };
}

/** files 是本行的附件 */
export function toInquiryLineDto(
  line: LineRow,
  files: InquiryFileDto[],
  index: CategoryIndex,
): InquiryLineDto {
  return {
    id: line.id,
    lineNo: line.lineNo,
    materialId: line.materialId,
    materialCode: line.materialCode,
    nameZh: line.nameZh,
    nameEn: line.nameEn,
    spec: line.spec,
    unitCode: line.unitCode,
    // Decimal(18,4) 去掉末尾的 0：200000.0000 → "200000"
    quantity: line.quantity.toFixed(),
    brand: line.brand,
    drawingRef: line.drawingRef,
    remark: line.remark,
    category: categoryBrief(line.category, index),
    files,
  };
}

export function toInquiryRoundDto(
  round: RoundRow,
  allowedActions: InquiryAction[],
  index: CategoryIndex,
): InquiryRoundDto {
  const files = round.files.map(toInquiryFileDto);
  const byLine = new Map<string, InquiryFileDto[]>();
  for (const f of files) {
    if (f.lineId) byLine.set(f.lineId, [...(byLine.get(f.lineId) ?? []), f]);
  }
  return {
    id: round.id,
    roundNo: round.roundNo,
    status: round.status,
    deadline: iso(round.deadline),
    changeReason: round.changeReason,
    changeSummary: round.changeSummary,
    pplTemplateVersion: round.pplTemplateVersion,
    pplVariantCode: round.pplVariantCode,
    publishedAt: iso(round.publishedAt),
    lines: round.lines.map((l) => toInquiryLineDto(l, byLine.get(l.id) ?? [], index)),
    files: files.filter((f) => f.lineId === null),
    allowedActions,
  };
}
