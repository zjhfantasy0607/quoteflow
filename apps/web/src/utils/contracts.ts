import { PPL_QUANTITY_KEY, parseDecimal, type ContractSnapshotDto, type PplValue } from '@quoteflow/shared';

/** 含税单价列（PPL 主模板必有的列，04 §8.1）；含税总价是 PPL_TOTAL_KEY */
export const UNIT_PRICE_KEY = 'unit_price_incl_tax';

type SnapshotLine = ContractSnapshotDto['lines'][number];

/** 合同明细的一行（M14 详情与打印共用）：快照里的询价行 + 中标版本该行的取值 */
export interface ContractLine extends Omit<SnapshotLine, 'quantity'> {
  /** 合同数量：议价成交改过数量时取中标版本里的数量，否则是询价数量 */
  quantity: string;
  inquiryQuantity: string;
  /** 议价成交改了这一行的数量 */
  negotiated: boolean;
  /** 中标版本该行的取值；被脱敏的金额列为 null */
  values: Record<string, PplValue | null>;
}

/** 按行号的合同明细。议价改过的数量只出现在中标版本的取值里（04 §6） */
export function contractLines(snapshot: ContractSnapshotDto): ContractLine[] {
  const valuesOf = new Map(snapshot.quoteVersion.values.lines.map((l) => [l.lineId, l.values]));
  return snapshot.lines.map(({ quantity: inquiryQuantity, ...line }) => {
    const values = valuesOf.get(line.lineId) ?? {};
    const raw = values[PPL_QUANTITY_KEY];
    const dealt = raw === undefined || raw === null || raw === '' ? null : String(raw);
    const dealtDec = dealt === null ? null : parseDecimal(dealt);
    const inquiryDec = parseDecimal(inquiryQuantity);
    return {
      ...line,
      quantity: dealt ?? inquiryQuantity,
      inquiryQuantity,
      negotiated: dealtDec !== null && inquiryDec !== null && !dealtDec.eq(inquiryDec),
      values,
    };
  });
}
