import { Injectable } from '@nestjs/common';
import {
  UPLOAD_KIND_RULES,
  type AttachInquiryFileInput,
  type CopyLineFilesInput,
  type InquiryFileDto,
  type InquiryRoundDto,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { ParamsService } from '../../infra/params/params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryAccessService } from './inquiry-access.service';
import { FILE_ORDER, toInquiryFileDto } from './inquiry-dto';
import { InquiriesService } from './inquiries.service';

/** 规格书与产品图（R06-5）：先经 /api/files 上传，再挂到整单或某一行 */
@Injectable()
export class InquiryFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly inquiries: InquiriesService,
    private readonly params: ParamsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 规格书可以挂整单或某一行，产品图只能挂在行上、每行最多 imagesPerLine 张；
   * 只能挂自己上传的、类别一致的文件（防止借用别人的文件 id 扩大访问范围）
   */
  async attach(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: AttachInquiryFileInput,
  ): Promise<InquiryFileDto> {
    const { imagesPerLine } = await this.params.get('upload.limits');
    return this.prisma.$transaction(async (tx) => {
      const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
      if (input.kind === 'PRODUCT_IMAGE' && !input.lineId) {
        throw new AppException('VALIDATION_FAILED', undefined, [
          { path: 'lineId', code: 'required', message: 'Product images must be attached to a line' },
        ]);
      }
      const line = input.lineId
        ? await tx.inquiryLine.findFirst({ where: { id: input.lineId, roundId: round.id } })
        : null;
      if (input.lineId && !line) {
        throw new AppException('VALIDATION_FAILED', undefined, [
          { path: 'lineId', code: 'not_found', message: 'Line not found' },
        ]);
      }
      const file = await tx.fileObject.findUnique({ where: { id: input.fileId } });
      if (!file) {
        throw new AppException('VALIDATION_FAILED', undefined, [
          { path: 'fileId', code: 'not_found', message: 'File not found' },
        ]);
      }
      if (file.kind !== input.kind) {
        throw new AppException('FILE_TYPE_NOT_ALLOWED', {
          allowed: UPLOAD_KIND_RULES[input.kind].exts.join(', '),
        });
      }
      if (file.uploadedById !== user.id) throw new AppException('FILE_ACCESS_DENIED');

      const siblings = await tx.inquiryFile.findMany({
        where: { roundId: round.id, lineId: input.lineId },
        select: { kind: true, sort: true },
      });
      if (
        input.kind === 'PRODUCT_IMAGE' &&
        siblings.filter((f) => f.kind === 'PRODUCT_IMAGE').length >= imagesPerLine
      ) {
        throw new AppException('FILE_LIMIT_EXCEEDED', { max: imagesPerLine });
      }
      const created = await tx.inquiryFile.create({
        data: {
          roundId: round.id,
          lineId: input.lineId,
          fileId: file.id,
          kind: input.kind,
          sort: Math.max(0, ...siblings.map((f) => f.sort + 1)),
          uploadedById: user.id,
        },
        include: { file: true },
      });
      await this.audit.log(
        {
          actor: user,
          action: 'inquiryFile.attach',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `${line ? `#${line.lineNo}` : '-'} ${file.originalName}`,
          detail: { roundNo, kind: input.kind, fileId: file.id },
        },
        tx,
      );
      return toInquiryFileDto(created);
    });
  }

  /** 只删除挂载记录；没有任何引用的文件由清理任务删除 */
  async remove(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    inquiryFileId: string,
  ): Promise<{ ok: true }> {
    return this.prisma.$transaction(async (tx) => {
      const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
      const link = await tx.inquiryFile.findFirst({
        where: { id: inquiryFileId, roundId: round.id },
        include: { file: true, line: { select: { lineNo: true } } },
      });
      if (!link) throw new AppException('NOT_FOUND');
      await tx.inquiryFile.delete({ where: { id: link.id } });
      await this.audit.log(
        {
          actor: user,
          action: 'inquiryFile.delete',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `${link.line ? `#${link.line.lineNo}` : '-'} ${link.file.originalName}`,
          detail: { roundNo, kind: link.kind, fileId: link.fileId },
        },
        tx,
      );
      return { ok: true as const };
    });
  }

  /**
   * 复制到其他行（R06-5）：为目标行新增指向同一文件的挂载记录；目标行已经有的同一文件跳过，
   * 复制后产品图超过上限时整个操作拒绝（FILE_LIMIT_EXCEEDED，params.lineNo 是第一个超限的行）
   */
  async copy(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: CopyLineFilesInput,
  ): Promise<InquiryRoundDto> {
    const { imagesPerLine } = await this.params.get('upload.limits');
    await this.prisma.$transaction(async (tx) => {
      const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
      const source = await tx.inquiryLine.findFirst({
        where: { id: input.fromLineId, roundId: round.id },
        include: { files: { orderBy: FILE_ORDER } },
      });
      if (!source) {
        throw new AppException('VALIDATION_FAILED', undefined, [
          { path: 'fromLineId', code: 'not_found', message: 'Line not found' },
        ]);
      }
      const targetIds = input.toLineIds.filter((id) => id !== source.id);
      const targets = await tx.inquiryLine.findMany({
        where: { id: { in: targetIds }, roundId: round.id },
        include: { files: { select: { fileId: true, kind: true, sort: true } } },
        orderBy: { lineNo: 'asc' },
      });
      if (targets.length !== targetIds.length) {
        throw new AppException('VALIDATION_FAILED', undefined, [
          { path: 'toLineIds', code: 'not_found', message: 'Line not found' },
        ]);
      }
      const files = source.files.filter((f) => !input.kind || f.kind === input.kind);
      const data: Prisma.InquiryFileCreateManyInput[] = [];
      for (const target of targets) {
        const existing = new Set(target.files.map((f) => `${f.kind}:${f.fileId}`));
        const added = files.filter((f) => !existing.has(`${f.kind}:${f.fileId}`));
        const images =
          target.files.filter((f) => f.kind === 'PRODUCT_IMAGE').length +
          added.filter((f) => f.kind === 'PRODUCT_IMAGE').length;
        if (images > imagesPerLine) {
          throw new AppException('FILE_LIMIT_EXCEEDED', { max: imagesPerLine, lineNo: target.lineNo });
        }
        const start = Math.max(0, ...target.files.map((f) => f.sort + 1));
        added.forEach((f, i) =>
          data.push({
            roundId: round.id,
            lineId: target.id,
            fileId: f.fileId,
            kind: f.kind,
            sort: start + i,
            uploadedById: user.id,
          }),
        );
      }
      if (data.length > 0) {
        await tx.inquiryFile.createMany({ data });
        await this.audit.log(
          {
            actor: user,
            action: 'inquiryFile.copy',
            entityType: 'inquiry',
            entityId: inquiryId,
            summary: `#${source.lineNo} → ${targets.map((t) => `#${t.lineNo}`).join(', ')}`,
            detail: { roundNo, kind: input.kind ?? null, created: data.length },
          },
          tx,
        );
      }
    });
    return this.inquiries.roundDetail(this.prisma, user, inquiryId, roundNo);
  }
}
