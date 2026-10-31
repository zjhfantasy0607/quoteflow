import { Injectable, OnModuleInit } from '@nestjs/common';
import { NEGOTIATION_MESSAGE_OWNER } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import type { FileObject } from '../../generated/prisma/client';
import {
  FileAccessRegistry,
  type FileAccessDecision,
  type FileAccessResolver,
} from '../../infra/files/file-access.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { SealService } from '../quotes/seal.service';

/**
 * 议价消息附件（Attachment(NEGOTIATION_MESSAGE)，R11-8）的访问判断：
 * - 供应商：只能访问本供应商报价单的议价附件（P-1）；
 * - 内部用户：要有 inquiry:evaluate、数据权限覆盖该询价单，且该轮开过标（议价只在开标后发生，照样经过 SealService）。
 * 不写 FileAccessLog（R08-3 只要求询价附件）
 */
@Injectable()
export class NegotiationAttachmentResolver implements FileAccessResolver, OnModuleInit {
  readonly name = 'negotiationAttachment';

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
      where: { ownerType: NEGOTIATION_MESSAGE_OWNER, fileId: file.id },
      select: { ownerId: true },
    });
    if (links.length === 0) return null;
    const messages = await this.prisma.negotiationMessage.findMany({
      where: { id: { in: links.map((l) => l.ownerId) } },
      select: {
        negotiation: {
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
        },
      },
    });
    const quotes = messages.map((m) => m.negotiation.quote);
    if (user.userType === 'SUPPLIER') {
      return { allow: !!user.supplierId && quotes.some((q) => q.supplierId === user.supplierId) };
    }
    if (!user.permissions.has('inquiry:evaluate')) return { allow: false };
    for (const quote of quotes) {
      if (!this.scope.coversInquiry(user, quote.round.inquiry)) continue;
      if (await this.seal.canViewQuoteContent(user, quote.round)) return { allow: true };
    }
    return { allow: false };
  }

  async isReferenced(fileId: string): Promise<boolean> {
    return (
      (await this.prisma.attachment.count({ where: { ownerType: NEGOTIATION_MESSAGE_OWNER, fileId } })) > 0
    );
  }
}
