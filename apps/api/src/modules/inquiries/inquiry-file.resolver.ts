import { Injectable, OnModuleInit } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import type { FileObject } from '../../generated/prisma/client';
import {
  FileAccessRegistry,
  type FileAccessDecision,
  type FileAccessResolver,
} from '../../infra/files/file-access.registry';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 询价附件（规格书、产品图）的访问判断，预览和下载都写 FileAccessLog（R08-3）：
 * - 内部用户：有 inquiry:view、且数据权限覆盖任一引用它的询价单（日志里 supplierId 为空）；
 * - 供应商：只能访问自己有报价单的轮次的附件（05 §7.2 P-3；报价单只在发布、补充邀请时创建，
 *   作废的旧轮次照样能看，P-4），别的一律 FILE_ACCESS_DENIED（R08-5）
 */
@Injectable()
export class InquiryFileResolver implements FileAccessResolver, OnModuleInit {
  readonly name = 'inquiryFile';

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly registry: FileAccessRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(file: FileObject, user: AuthUser): Promise<FileAccessDecision | null> {
    const links = await this.prisma.inquiryFile.findMany({
      where: { fileId: file.id },
      select: { roundId: true, round: { select: { inquiryId: true } } },
    });
    if (links.length === 0) return null;

    if (user.userType === 'SUPPLIER') {
      if (!user.supplierId) return { allow: false };
      const quote = await this.prisma.quote.findFirst({
        where: {
          supplierId: user.supplierId,
          roundId: { in: [...new Set(links.map((l) => l.roundId))] },
          round: { publishedAt: { not: null } },
        },
        select: { round: { select: { inquiryId: true } } },
      });
      if (!quote) return { allow: false };
      return { allow: true, log: { inquiryId: quote.round.inquiryId, supplierId: user.supplierId } };
    }

    if (!user.permissions.has('inquiry:view')) return { allow: false };
    const visible = await this.prisma.inquiry.findFirst({
      where: {
        AND: [
          { id: { in: [...new Set(links.map((l) => l.round.inquiryId))] } },
          this.scope.inquiryWhere(user),
        ],
      },
      select: { id: true },
    });
    if (!visible) return { allow: false };
    return { allow: true, log: { inquiryId: visible.id, supplierId: null } };
  }

  async isReferenced(fileId: string): Promise<boolean> {
    return (await this.prisma.inquiryFile.count({ where: { fileId } })) > 0;
  }
}
