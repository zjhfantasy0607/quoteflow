import type { PortalQuoteDetailDto } from '@quoteflow/shared';
import type { Worksheet } from 'exceljs';
import type { Agent } from './auth';
import { loadXlsx } from './xlsx';

/** PPL-LED（灯珠分类）的必填列：主模板的含税单价、税率、交期 + 变体改为必填的 4 列 */
export function ledValues(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    power_w: '0.5',
    cct_k: 3000,
    cri_ra: 80,
    luminous_flux_lm: '60.5',
    unit_price_incl_tax: '1.13',
    tax_rate: '13',
    lead_time_days: 30,
    ...extra,
  };
}

/** 供应商在门户提交报价（M09），返回提交后的详情 */
export async function submitQuote(
  agent: Agent,
  quoteId: string,
  lines: Record<string, Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): Promise<PortalQuoteDetailDto> {
  return (
    await agent
      .post(`/api/portal/quotes/${quoteId}/submit`)
      .send({ lines, ...extra })
      .expect(200)
  ).body;
}

export async function declineQuote(
  agent: Agent,
  quoteId: string,
  reasonCode = 'LEAD_TIME',
  reason = '交期无法满足',
): Promise<PortalQuoteDetailDto> {
  return (await agent.post(`/api/portal/quotes/${quoteId}/decline`).send({ reasonCode, reason }).expect(200))
    .body;
}

/** 锁定 Excel 的"报价 Quote"工作表：第 3 行是列 key，第 4 行起每个询价行一行 */
export const QUOTE_SHEET = '报价 Quote';

/** 列 key → 列号（从 1 开始） */
export function columnOf(ws: Worksheet, key: string): number {
  const keys = ws.getRow(3).values as unknown[];
  const index = keys.indexOf(key);
  if (index < 1) throw new Error(`column ${key} not found`);
  return index;
}

/** 像供应商一样打开下载的模板、改单元格（按行号 → { 列 key: 值 }）、保存 */
export async function editQuoteSheet(
  buffer: Buffer,
  rows: Record<number, Record<string, string | number | null>>,
): Promise<Buffer> {
  const wb = await loadXlsx(buffer);
  const ws = wb.getWorksheet(QUOTE_SHEET)!;
  for (const [row, values] of Object.entries(rows)) {
    for (const [key, value] of Object.entries(values))
      ws.getCell(Number(row), columnOf(ws, key)).value = value;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Excel 里 PPL-LED 必填列的写法（数字列写数字） */
export const LED_CELLS: Record<string, number> = {
  power_w: 0.5,
  cct_k: 3000,
  cri_ra: 80,
  luminous_flux_lm: 60.5,
  unit_price_incl_tax: 1.13,
  tax_rate: 13,
  lead_time_days: 30,
};
