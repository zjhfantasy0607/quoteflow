import type { QuoteStatus, RoundStatus } from '@quoteflow/shared';

/** 门户里"我的状态"的显示值（文案在 enums.PortalQuoteStatus），比采购方看到的报价单状态多一个"未报价" */
export type PortalQuoteStatus = QuoteStatus | 'NO_RESPONSE';

/** 已邀请：截止前是"待报价"，截止后（轮次不再是等待报价）是"未报价"（05 §4） */
export function portalQuoteStatus(status: QuoteStatus, roundStatus: RoundStatus): PortalQuoteStatus {
  return status === 'INVITED' && roundStatus !== 'WAITING_QUOTES' ? 'NO_RESPONSE' : status;
}
