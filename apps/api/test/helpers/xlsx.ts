import { Workbook, type Worksheet } from 'exceljs';

type Cell = string | number | null;

/** supertest 下载二进制文件：.buffer(true).parse(binaryParser) 后 res.body 是 Buffer */
export function binaryParser(
  res: { on(event: 'data' | 'end', listener: (chunk: Buffer) => void): unknown },
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

export async function buildXlsx(sheetName: string, header: string[], rows: Cell[][]): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function loadXlsx(buffer: Buffer): Promise<Workbook> {
  const wb = new Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

/** 工作表内容转成二维数组（空单元格为 null） */
export function sheetRows(ws: Worksheet): Cell[][] {
  const rows: Cell[][] = [];
  ws.eachRow((row) => {
    const cells: Cell[] = [];
    for (let c = 1; c <= ws.columnCount; c += 1) {
      const v = row.getCell(c).value;
      cells.push(v === null || v === undefined ? null : typeof v === 'number' ? v : String(v));
    }
    rows.push(cells);
  });
  return rows;
}
