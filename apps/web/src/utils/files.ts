import { UPLOAD_KIND_RULES, type AppConfigDto, type UploadKind } from '@quoteflow/shared';

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** el-upload 的 accept 属性，如 ".pdf,.xlsx" */
export function acceptAttr(kind: UploadKind): string {
  return UPLOAD_KIND_RULES[kind].exts.map((e) => `.${e}`).join(',');
}

export function maxUploadMB(kind: UploadKind, limits: AppConfigDto['uploadLimits']): number {
  return UPLOAD_KIND_RULES[kind].maxMB(limits);
}

/** 允许的扩展名，用于提示文字 */
export function allowedExtsText(kind: UploadKind): string {
  return UPLOAD_KIND_RULES[kind].exts.join(', ');
}

/**
 * 上传前预检扩展名和大小（与后端 R02-4 同一份规则；魔数由后端校验）。通过返回 null。
 * 上传限制还没取到时只查扩展名，大小交给后端。
 */
export function checkUpload(
  kind: UploadKind,
  file: { name: string; size: number },
  limits: AppConfigDto['uploadLimits'] | null,
): 'type' | 'size' | null {
  if (!UPLOAD_KIND_RULES[kind].exts.includes(fileExtension(file.name))) return 'type';
  if (limits && file.size > maxUploadMB(kind, limits) * 1024 * 1024) return 'size';
  return null;
}

export type PreviewMode = 'pdf' | 'image' | 'sheet' | 'none';

/** PDF、图片内嵌预览；xlsx 表格预览；其他只能下载（A-17） */
export function previewMode(name: string): PreviewMode {
  const ext = fileExtension(name);
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (ext === 'xlsx') return 'sheet';
  return 'none';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Excel 列名：0 → A，25 → Z，26 → AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
