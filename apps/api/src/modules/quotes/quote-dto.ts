import type {
  QuoteDraftValues,
  QuoteVersionDto,
  QuoteVersionSummaryDto,
  QuoteVersionValues,
} from '@quoteflow/shared';
import type { FileObject, Prisma } from '../../generated/prisma/client';
import { toFileDto } from '../../infra/files/files.service';
import type { PrismaService } from '../../prisma/prisma.service';

type Client = PrismaService | Prisma.TransactionClient;

/** 报价版本附件的 Attachment.ownerType（R09-4：提交时草稿里的附件转成该版本的附件） */
export const QUOTE_VERSION_OWNER = 'QUOTE_VERSION';

export const versionSummarySelect = {
  id: true,
  versionNo: true,
  source: true,
  totalAmount: true,
  currency: true,
  remark: true,
  changeNote: true,
  submittedAt: true,
  submittedBy: { select: { name: true } },
} satisfies Prisma.QuoteVersionSelect;
type VersionSummaryRow = Prisma.QuoteVersionGetPayload<{ select: typeof versionSummarySelect }>;

const versionSelect = {
  ...versionSummarySelect,
  values: true,
  templateVersion: true,
  variantCode: true,
} satisfies Prisma.QuoteVersionSelect;

/** 各版本的附件文件，按挂载顺序 */
async function versionFiles(client: Client, versionIds: string[]): Promise<Map<string, FileObject[]>> {
  const rows = await client.attachment.findMany({
    where: { ownerType: QUOTE_VERSION_OWNER, ownerId: { in: versionIds } },
    include: { file: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const map = new Map<string, FileObject[]>();
  for (const r of rows) map.set(r.ownerId, [...(map.get(r.ownerId) ?? []), r.file]);
  return map;
}

function toVersionSummaryDto(row: VersionSummaryRow, attachmentCount: number): QuoteVersionSummaryDto {
  return {
    versionNo: row.versionNo,
    source: row.source,
    submittedAt: row.submittedAt.toISOString(),
    submittedBy: { name: row.submittedBy.name },
    totalAmount: row.totalAmount.toFixed(2),
    currency: row.currency,
    remark: row.remark,
    changeNote: row.changeNote,
    attachmentCount,
  };
}

/** 一张报价单的全部版本（R09-7），新的在前 */
export async function loadVersionSummaries(
  client: Client,
  quoteId: string,
): Promise<QuoteVersionSummaryDto[]> {
  const rows = await client.quoteVersion.findMany({
    where: { quoteId },
    select: versionSummarySelect,
    orderBy: { versionNo: 'desc' },
  });
  const files = await versionFiles(
    client,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toVersionSummaryDto(r, files.get(r.id)?.length ?? 0));
}

/** 版本详情连同附件；不存在返回 null。取值写入前已校验（02 §4），读出直接用 */
export async function loadVersion(
  client: Client,
  where: Prisma.QuoteVersionWhereUniqueInput,
): Promise<QuoteVersionDto | null> {
  const row = await client.quoteVersion.findUnique({ where, select: versionSelect });
  if (!row) return null;
  const files = (await versionFiles(client, [row.id])).get(row.id) ?? [];
  return {
    ...toVersionSummaryDto(row, files.length),
    templateVersion: row.templateVersion,
    variantCode: row.variantCode,
    lines: (row.values as unknown as QuoteVersionValues).lines,
    attachments: files.map(toFileDto),
  };
}

/** 读出草稿（写入前已按 quoteDraftValuesSchema 校验） */
export function draftOf(json: Prisma.JsonValue | null): QuoteDraftValues | null {
  return json === null ? null : (json as unknown as QuoteDraftValues);
}
