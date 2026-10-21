type Detected = 'pdf' | 'png' | 'jpeg' | 'webp' | 'zip' | 'ole';

interface TypeInfo {
  detected: Detected;
  mime: string;
}

/** 扩展名 → 期望的魔数类型与对外的 MIME（以魔数为准，不信任客户端传的 Content-Type） */
const EXTENSIONS: Record<string, TypeInfo> = {
  pdf: { detected: 'pdf', mime: 'application/pdf' },
  png: { detected: 'png', mime: 'image/png' },
  jpg: { detected: 'jpeg', mime: 'image/jpeg' },
  jpeg: { detected: 'jpeg', mime: 'image/jpeg' },
  webp: { detected: 'webp', mime: 'image/webp' },
  xlsx: { detected: 'zip', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  docx: { detected: 'zip', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  zip: { detected: 'zip', mime: 'application/zip' },
  xls: { detected: 'ole', mime: 'application/vnd.ms-excel' },
  doc: { detected: 'ole', mime: 'application/msword' },
};

export function detectMagic(buf: Buffer): Detected | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return 'ole';
  }
  return null;
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 扩展名在允许范围内、且内容魔数与扩展名一致时返回 MIME，否则 null */
export function resolveMime(name: string, buf: Buffer, allowedExts: string[]): string | null {
  const ext = extensionOf(name);
  const info = EXTENSIONS[ext];
  if (!info || !allowedExts.includes(ext)) return null;
  return detectMagic(buf) === info.detected ? info.mime : null;
}

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/** multer 按 latin1 解析 multipart 文件名，中文名会乱码；这里还原成 UTF-8 */
export function fixUploadName(name: string): string {
  if ([...name].some((c) => c.charCodeAt(0) > 0xff)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes(REPLACEMENT_CHAR) ? name : decoded;
}

/** Content-Disposition，兼容中文文件名（RFC 5987） */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
