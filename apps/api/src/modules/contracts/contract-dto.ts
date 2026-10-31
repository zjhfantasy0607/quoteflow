import type { ContractListItemDto, ContractSnapshot, ContractSnapshotDto, PplValue } from '@quoteflow/shared';
import type { Prisma } from '../../generated/prisma/client';

export const contractListSelect = {
  id: true,
  contractNo: true,
  status: true,
  amount: true,
  currency: true,
  deliveryDate: true,
  createdAt: true,
  updatedAt: true,
  /** 判断开标前密封用 */
  roundId: true,
  inquiry: { select: { id: true, formalNo: true, title: true } },
  supplier: { select: { id: true, code: true, nameZh: true, nameEn: true } },
} satisfies Prisma.ContractSelect;
export type ContractListRow = Prisma.ContractGetPayload<{ select: typeof contractListSelect }>;

/** Contract.deliveryDate 是 @db.Date（UTC 零点），输出 YYYY-MM-DD */
export const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** 列表项（金额未脱敏，由调用方按 contract.amount 处理） */
export function toContractListItem(row: ContractListRow): ContractListItemDto {
  return {
    id: row.id,
    contractNo: row.contractNo,
    status: row.status,
    // 只有审批通过的询价单才能定标、生成合同
    inquiry: { id: row.inquiry.id, formalNo: row.inquiry.formalNo!, title: row.inquiry.title },
    supplier: row.supplier,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    deliveryDate: dateOnly(row.deliveryDate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * R14-7：快照里的金额按 contract.amount 脱敏——中标版本合计、PPL 里 sensitive 的列、议价价格都置为 null；
 * 供应商联系电话、邮箱按 supplier.contact 脱敏（05 §10）
 */
export function toSnapshotDto(
  snapshot: ContractSnapshot,
  can: { amount: boolean; contact: boolean },
): ContractSnapshotDto {
  const sensitive = new Set(snapshot.columns.filter((c) => c.sensitive).map((c) => c.key));
  const hide = (values: Record<string, PplValue>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, sensitive.has(k) ? null : v]));
  return {
    ...snapshot,
    supplier: can.contact
      ? snapshot.supplier
      : { ...snapshot.supplier, contactEmail: null, contactPhone: null },
    quoteVersion: can.amount
      ? snapshot.quoteVersion
      : {
          ...snapshot.quoteVersion,
          totalAmount: null,
          values: {
            lines: snapshot.quoteVersion.values.lines.map((l) => ({ ...l, values: hide(l.values) })),
          },
        },
    negotiation:
      can.amount || !snapshot.negotiation
        ? snapshot.negotiation
        : snapshot.negotiation.map((m) => ({
            ...m,
            lines: m.lines.map((l) =>
              l.unitPriceInclTax === undefined ? l : { ...l, unitPriceInclTax: null },
            ),
          })),
  };
}
