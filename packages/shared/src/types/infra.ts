import type { EmailStatus, EmailType, FileKind, UserType } from '../enums';

export interface FileDto {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: FileKind;
  createdAt: string;
}

export interface SheetPreviewDto {
  sheets: { name: string; rows: string[][]; truncated: boolean }[];
}

export interface DictTypeDto {
  code: string;
  nameZh: string;
  nameEn: string;
  isSystem: boolean;
  itemCount: number;
}

export interface SystemParamDto {
  key: string;
  value: unknown;
  defaultValue: unknown;
  descZh: string;
  descEn: string;
  updatedAt: string | null;
}

/** GET /api/public/app-config（未登录也能取） */
export interface AppConfigDto {
  company: { nameZh: string; nameEn: string; address: string; phone: string };
  uploadLimits: { specDocMaxMB: number; imageMaxMB: number; attachmentMaxMB: number; imagesPerLine: number };
}

export interface EmailListItemDto {
  id: string;
  type: EmailType;
  language: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  supplierId: string | null;
  inquiryId: string | null;
}

export interface EmailDetailDto extends EmailListItemDto {
  html: string;
  text: string;
}

export interface AuditLogDto {
  id: string;
  actor: { id: string; name: string; username: string } | null;
  actorType: UserType | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

/** 标准 Excel 导入的表头错误（EXCEL_HEADER_MISMATCH 的 details） */
export interface ExcelHeaderErrorDetails {
  expected: string[];
  actual: string[];
  missing: string[];
  extra: string[];
  orderMismatch: boolean;
}

/** 行错误（EXCEL_ROWS_INVALID 的 details 项）。code 用于前端翻译：excel.rowErrors.<code> */
export interface ExcelRowError {
  row: number;
  column: string;
  code: string;
  message: string;
  params?: Record<string, string | number>;
}

/** 导入结果 */
export interface ImportResultDto {
  created: number;
  updated: number;
}
