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
 * 询价附件（规格书、产品图）的访问判断：内部用户有 inquiry:view、且数据权限覆盖任一引用它的询价单即可访问，
 * 不记访问日志。供应商侧（只能访问自己受邀轮次的附件，并记下载日志）在 M08 补充，目前一律拒绝
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
      select: { round: { select: { inquiryId: true } } },
    });
    if (links.length === 0) return null;
    if (user.userType !== 'INTERNAL' || !user.permissions.has('inquiry:view')) return { allow: false };
    const inquiryIds = [...new Set(links.map((l) => l.round.inquiryId))];
    const visible = await this.prisma.inquiry.count({
      where: { AND: [{ id: { in: inquiryIds } }, this.scope.inquiryWhere(user)] },
    });
    return { allow: visible > 0 };
  }

  async isReferenced(fileId: string): Promise<boolean> {
    return (await this.prisma.inquiryFile.count({ where: { fileId } })) > 0;
  }
}
