import type { Cell, Worksheet } from 'exceljs';
import type { AuthUser } from '../../common/auth/auth-user';

// 统计导出、报表导出共用的版式：标题、说明行（导出时间、筛选条件）、灰底加粗的表头。文字按导出人的账号语言

export type Lang = 'zh-CN' | 'en-US';

export const langOf = (user: Pick<AuthUser, 'locale'>): Lang => (user.locale === 'en-US' ? 'en-US' : 'zh-CN');

/** 双语名称：英文且有英文名时用英文 */
export const pickName = (item: { nameZh: string; nameEn?: string | null }, lang: Lang): string =>
  lang === 'en-US' && item.nameEn ? item.nameEn : item.nameZh;

/** R15-2 被 quote.amount 脱敏的单元格 */
export const MASKED_CELL = '***';

const FILL_HEADER = 'FFF2F3F5';
const NOTE_COLOR = 'FF606266';

export function fillCell(cell: Cell, argb: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** 标题（加粗）+ 说明行（灰字），各占一整行，后面空一行 */
export function sheetHeading(ws: Worksheet, title: string, notes: string[], width: number): void {
  const head = ws.addRow([title]);
  head.font = { bold: true, size: 13 };
  ws.mergeCells(head.number, 1, head.number, width);
  for (const note of notes) {
    const row = ws.addRow([note]);
    row.font = { color: { argb: NOTE_COLOR } };
    ws.mergeCells(row.number, 1, row.number, width);
  }
  ws.addRow([]);
}

/** 表头行；freeze 时冻结表头以上（报表只有一张表，统计每个 sheet 有两张表不冻结） */
export function headerRow(ws: Worksheet, values: string[], freeze = false): void {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.eachCell((cell) => fillCell(cell, FILL_HEADER));
  if (freeze) ws.views = [{ state: 'frozen', ySplit: row.number }];
}
