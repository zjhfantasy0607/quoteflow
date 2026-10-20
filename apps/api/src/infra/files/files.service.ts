import { Inject, Injectable } from '@nestjs/common';
import type { FileObject } from '@prisma/client';
import type { FileDto, FileKind, SheetPreviewDto, UploadKind } from '@quoteflow/shared';
import { Workbook } from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { inAppTz } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import { ParamsService } from '../params/params.service';
import { FileAccessRegistry, type FileAccessDecision } from './file-access.registry';
import { extensionOf, fixUploadName, KIND_RULES, resolveMime } from './file-types';
import { STORAGE_DRIVER, type StorageDriver } from './storage';

const PREVIEW_MAX_ROWS = 200;
const PREVIEW_MAX_COLS = 50;
const PREVIEW_MAX_SHEETS = 10;

export function toFileDto(f: FileObject): FileDto {
  return {
    id: f.id,
    originalName: f.originalName,
    mimeType: f.mimeType,
    size: f.size,
    kind: f.kind as FileKind,
    createdAt: f.createdAt.toISOString(),
  };
}

export interface UploadedFileInput {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly params: ParamsService,
    private readonly clock: ClockService,
    private readonly registry: FileAccessRegistry,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** 上传：按类别校验扩展名、魔数、大小，计算 sha256 后落盘（R02-4） */
  async upload(user: AuthUser, file: UploadedFileInput | undefined, kind: UploadKind): Promise<FileDto> {
    if (!file || file.size === 0) throw new AppException('VALIDATION_FAILED', undefined, [{ path: 'file', code: 'required', message: 'File is required' }]);
    const rule = KIND_RULES[kind];
    const maxMB = rule.maxMB(await this.params.get('upload.limits'));
    if (file.size > maxMB * 1024 * 1024) throw new AppException('FILE_TOO_LARGE', { maxMB });

    const name = fixUploadName(file.originalname).slice(0, 200);
    const mime = resolveMime(name, file.buffer, rule.exts);
    if (!mime) throw new AppException('FILE_TYPE_NOT_ALLOWED', { allowed: rule.exts.join(', ') });

    const ext = extensionOf(name);
    const key = `${inAppTz(this.clock.now()).format('YYYY/MM')}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer);
    const created = await this.prisma.fileObject.create({
      data: {
        storageKey: key,
        originalName: name,
        mimeType: mime,
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        kind,
        uploadedById: user.id,
      },
    });
    return toFileDto(created);
  }

  /** 取文件并按访问策略判断；无权访问一律 FILE_ACCESS_DENIED，不存在返回 NOT_FOUND */
  async authorize(user: AuthUser, id: string): Promise<{ file: FileObject; decision: FileAccessDecision }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) throw new AppException('NOT_FOUND');
    const decision = await this.registry.check(file, user);
    if (!decision.allow) throw new AppException('FILE_ACCESS_DENIED');
    return { file, decision };
  }

  stream(file: FileObject): Readable {
    return this.storage.getStream(file.storageKey);
  }

  async logAccess(
    user: AuthUser,
    file: FileObject,
    decision: FileAccessDecision,
    action: 'PREVIEW' | 'DOWNLOAD',
  ): Promise<void> {
    if (!decision.log) return;
    await this.prisma.fileAccessLog.create({
      data: {
        fileId: file.id,
        userId: user.id,
        supplierId: decision.log.supplierId ?? user.supplierId,
        inquiryId: decision.log.inquiryId,
        action,
        ip: user.ip,
        userAgent: user.userAgent,
      },
    });
  }

  /** xlsx 在线预览：每个 sheet 前 200 行 × 50 列（R02-6） */
  async sheetPreview(file: FileObject): Promise<SheetPreviewDto> {
    if (extensionOf(file.originalName) !== 'xlsx') throw new AppException('FILE_TYPE_NOT_ALLOWED', { allowed: 'xlsx' });
    const workbook = new Workbook();
    try {
      await workbook.xlsx.read(this.stream(file));
    } catch {
      throw new AppException('EXCEL_PARSE_FAILED');
    }
    const sheets: SheetPreviewDto['sheets'] = [];
    for (const ws of workbook.worksheets.slice(0, PREVIEW_MAX_SHEETS)) {
      const rows: string[][] = [];
      const rowCount = Math.min(ws.rowCount, PREVIEW_MAX_ROWS);
      const colCount = Math.min(ws.columnCount, PREVIEW_MAX_COLS);
      for (let r = 1; r <= rowCount; r += 1) {
        const row = ws.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= colCount; c += 1) cells.push(row.getCell(c).text ?? '');
        rows.push(cells);
      }
      sheets.push({ name: ws.name, rows, truncated: ws.rowCount > PREVIEW_MAX_ROWS || ws.columnCount > PREVIEW_MAX_COLS });
    }
    return { sheets };
  }

  /** 清理任务：删除 24 小时前上传、仍未被任何业务对象引用的文件 */
  async cleanupOrphans(olderThan: Date): Promise<number> {
    const candidates = await this.prisma.fileObject.findMany({
      where: { createdAt: { lt: olderThan } },
      select: { id: true, storageKey: true },
    });
    let removed = 0;
    for (const f of candidates) {
      if (await this.registry.isReferenced(f.id)) continue;
      await this.prisma.$transaction([
        this.prisma.fileAccessLog.deleteMany({ where: { fileId: f.id } }),
        this.prisma.fileObject.delete({ where: { id: f.id } }),
      ]);
      await this.storage.delete(f.storageKey);
      removed += 1;
    }
    return removed;
  }
}
