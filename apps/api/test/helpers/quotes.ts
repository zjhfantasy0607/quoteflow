import type { InquiryDetailDto, PortalQuoteDetailDto } from '@quoteflow/shared';
import type { Worksheet } from 'exceljs';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { RoundDeadlineJob } from '../../src/modules/inquiries/round-deadline.job';
import type { Agent } from './auth';
import { addManualLine, createDraftInquiry, publishRound } from './inquiries';
import type { TestContext } from './test-app';
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

/** publishLedInquiry() 的结果：quotes 按传入的供应商顺序，l1、l2 是两行询价行 */
export interface PublishedLed {
  inquiry: InquiryDetailDto;
  roundId: string;
  quotes: string[];
  l1: string;
  l2: string;
}

/**
 * 建一张材料类别 LED-2835 的询价（冻结 PPL-LED）：两行手工行（数量 1000、500）→ 提交 → 审批 → 发布给 supplierIds。
 * creator 要有 inquiry:create/submit/invite/publish，approver 要有 inquiry:approve
 */
export async function publishLedInquiry(
  prisma: PrismaClient,
  creator: Agent,
  approver: Agent,
  categoryId: string,
  supplierIds: string[],
  deadline: Date,
  title = '灯珠询价',
): Promise<PublishedLed> {
  const draft = await createDraftInquiry(creator, categoryId, { title });
  await addManualLine(creator, draft.id, categoryId, { nameZh: '灯珠 A', quantity: '1000' });
  await addManualLine(creator, draft.id, categoryId, { nameZh: '灯珠 B', quantity: '500' });
  await creator.post(`/api/inquiries/${draft.id}/submit`).expect(200);
  await approver.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(200);
  const inquiry = await publishRound(creator, draft.id, supplierIds, deadline);
  const quotes = await prisma.quote.findMany({ where: { round: { inquiryId: inquiry.id } } });
  const lines = await prisma.inquiryLine.findMany({
    where: { round: { inquiryId: inquiry.id } },
    orderBy: { lineNo: 'asc' },
  });
  return {
    inquiry,
    roundId: quotes[0].roundId,
    quotes: supplierIds.map((id) => quotes.find((q) => q.supplierId === id)!.id),
    l1: lines[0].id,
    l2: lines[1].id,
  };
}

/** 两行都填齐 PPL-LED 必填列，含税单价分别为 price1、price2 */
export function ledLines(p: { l1: string; l2: string }, price1: string, price2: string) {
  return {
    [p.l1]: ledValues({ unit_price_incl_tax: price1 }),
    [p.l2]: ledValues({ unit_price_incl_tax: price2 }),
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

/** 把测试时钟拨到截止时间、执行截止任务，再由 opener（要有 inquiry:open）开标（M10） */
export async function openRound(
  ctx: TestContext,
  opener: Agent,
  p: { inquiry: { id: string } },
  deadline: Date,
): Promise<InquiryDetailDto> {
  ctx.clock.set(deadline);
  await ctx.app.get(RoundDeadlineJob).run();
  return (await opener.post(`/api/inquiries/${p.inquiry.id}/rounds/1/open`).expect(200)).body;
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
