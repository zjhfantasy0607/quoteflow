// 演示用的附件内容：一页文字的 PDF、纯色加圆形的 PNG（能通过上传的魔数校验，浏览器里能正常预览）。
import { crc32, deflateSync } from 'node:zlib';

/** 一页 A4 的 PDF，内容是几行英文（标准 Helvetica 字体不含中文） */
export function demoPdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines
    .map((line, i) => `BT /F1 ${i === 0 ? 18 : 12} Tf 72 ${770 - i * 28} Td (${escape(line)}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

type Rgb = [number, number, number];

/** size × size 的 PNG：背景色上画一个浅色圆（示意灯珠、电源等产品图） */
export function demoPng(background: Rgb, foreground: Rgb, size = 160): Buffer {
  const rowLength = size * 3 + 1;
  const raw = Buffer.alloc(rowLength * size);
  const center = size / 2;
  const radius = size * 0.32;
  for (let y = 0; y < size; y += 1) {
    raw[y * rowLength] = 0; // 每行的过滤类型：None
    for (let x = 0; x < size; x += 1) {
      const inside = (x - center) ** 2 + (y - center) ** 2 <= radius ** 2;
      const [r, g, b] = inside ? foreground : background;
      const offset = y * rowLength + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 位深
  header[9] = 2; // 真彩色 RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
