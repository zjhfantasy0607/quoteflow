// 敏感字段（字段权限，docs/05-状态机与权限.md §10）。

export const SENSITIVE_FIELDS = [
  {
    code: 'quote.amount',
    labelZh: '报价金额',
    labelEn: 'Quotation amounts',
    descZh: '单价、总价、阶梯价、模具费、样品费、运费及合计',
    descEn: 'Unit prices, totals, tier prices, tooling, sample and freight costs',
  },
  {
    code: 'negotiation.amount',
    labelZh: '议价金额',
    labelEn: 'Negotiation amounts',
    descZh: '目标价与反提案价格',
    descEn: 'Target prices and counter-offer prices',
  },
  {
    code: 'contract.amount',
    labelZh: '合同金额',
    labelEn: 'Contract amounts',
    descZh: '合同金额及快照中的金额',
    descEn: 'Contract amount, including amounts in the snapshot',
  },
  {
    code: 'supplier.contact',
    labelZh: '供应商联系方式',
    labelEn: 'Supplier contacts',
    descZh: '联系电话、联系邮箱、抄送邮箱',
    descEn: 'Contact phone, contact email and CC emails',
  },
] as const;

export type FieldPermissionCode = (typeof SENSITIVE_FIELDS)[number]['code'];

export const FIELD_PERMISSION_CODES: readonly FieldPermissionCode[] = SENSITIVE_FIELDS.map((f) => f.code);

export function isFieldPermissionCode(value: string): value is FieldPermissionCode {
  return (FIELD_PERMISSION_CODES as readonly string[]).includes(value);
}
