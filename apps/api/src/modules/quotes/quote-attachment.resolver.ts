import { Injectable, OnModuleInit } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import type { FileObject, Prisma } from '../../generated/prisma/client';
import {
  FileAccessRegistry,
  type FileAccessDecision,
  type FileAccessResolver,
} from '../../infra/files/file-access.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { QUOTE_VERSION_OWNER } from './quote-dto';
import { SealService } from './seal.service';

/** 草稿 JSON 的 attachmentFileIds 里有这个文件（02 §4） */
function draftReferences(fileId: string): Prisma.QuoteWhereInput {
  return { draftValues: { path: ['attachmentFileIds'], array_contains: [fileId] } };
}

/**
 * 报价附件（已提交版本的 Attachment(QUOTE_VERSION) 和草稿里还没提交的）的访问判断（R09-9）：
 * - 供应商：只能访问本供应商报价单的附件（S-6）；
 * - 内部用户：草稿任何时候都看不到（02 §4）；版本附件要有 inquiry:evaluate、数据权限覆盖该询价单，
 *   且该轮开过标或有开标前查看授权（S-3，SealService）。
 * 报价附件的访问不写 FileAccessLog（R08-3 只要求询价附件）
 */
@Injectable()
export class QuoteAttachmentResolver implements FileAccessResolver, OnModuleInit {
  readonly name = 'quoteAttachment';

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly seal: SealService,
    private readonly registry: FileAccessRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(file: FileObject, user: AuthUser): Promise<FileAccessDecision | null> {
    const links = await this.prisma.attachment.findMany({
      where: { ownerType: QUOTE_VERSION_OWNER, fileId: file.id },
      select: { ownerId: true },
    });
    const drafts = await this.prisma.quote.findMany({
      where: draftReferences(file.id),
      select: { supplierId: true },
    });
    if (links.length === 0 && drafts.length === 0) return null;
    const versions = await this.prisma.quoteVersion.findMany({
      where: { id: { in: links.map((l) => l.ownerId) } },
      select: {
        quote: {
          select: {
            supplierId: true,
            round: {
              select: {
                status: true,
                openedAt: true,
                inquiry: {
                  select: { ownerId: true, pdUserId: true, createdById: true, departmentCode: true },
                },
              },
            },
          },
        },
      },
    });

    if (user.userType === 'SUPPLIER') {
      const owners = [...versions.map((v) => v.quote.supplierId), ...drafts.map((d) => d.supplierId)];
      return { allow: !!user.supplierId && owners.includes(user.supplierId) };
    }
    if (!user.permissions.has('inquiry:evaluate')) return { allow: false };
    for (const { quote } of versions) {
      if (!this.scope.coversInquiry(user, quote.round.inquiry)) continue;
      if (await this.seal.canViewQuoteContent(user, quote.round)) return { allow: true };
    }
    return { allow: false };
  }

  /** 草稿里的附件也算被引用，清理任务不能删（供应商可能隔几天才提交） */
  async isReferenced(fileId: string): Promise<boolean> {
    if ((await this.prisma.attachment.count({ where: { ownerType: QUOTE_VERSION_OWNER, fileId } })) > 0)
      return true;
    return (await this.prisma.quote.count({ where: draftReferences(fileId) })) > 0;
  }
}
