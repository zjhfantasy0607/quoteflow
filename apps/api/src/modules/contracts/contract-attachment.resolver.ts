import { Injectable, OnModuleInit } from '@nestjs/common';
import { CONTRACT_ATTACHMENT_OWNER } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import type { FileObject } from '../../generated/prisma/client';
import {
  FileAccessRegistry,
  type FileAccessDecision,
  type FileAccessResolver,
} from '../../infra/files/file-access.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { QUOTE_VERSION_OWNER } from '../quotes/quote-dto';
import { SealService } from '../quotes/seal.service';

/**
 * 合同的文件（M14）：合同附件（Attachment(CONTRACT)）、签字扫描件，以及中标版本的报价附件（合同详情里展示，
 * 合同批准人没有 inquiry:evaluate 也要能看）。内部用户要有 contract:view、数据权限覆盖合同所属的询价单（R14-7）；
 * 报价附件是报价内容，另外经过 SealService（所属轮次一定开过标，兜底）。供应商看不到合同。访问不写下载日志
 */
@Injectable()
export class ContractAttachmentResolver implements FileAccessResolver, OnModuleInit {
  readonly name = 'contractAttachment';

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
      where: { fileId: file.id, ownerType: { in: [CONTRACT_ATTACHMENT_OWNER, QUOTE_VERSION_OWNER] } },
      select: { ownerType: true, ownerId: true },
    });
    const versionIds = links.filter((l) => l.ownerType === QUOTE_VERSION_OWNER).map((l) => l.ownerId);
    const contracts = await this.prisma.contract.findMany({
      where: {
        OR: [
          { signedScanFileId: file.id },
          {
            id: { in: links.filter((l) => l.ownerType === CONTRACT_ATTACHMENT_OWNER).map((l) => l.ownerId) },
          },
          { quoteVersionId: { in: versionIds } },
        ],
      },
      select: {
        roundId: true,
        quoteVersionId: true,
        inquiry: { select: { ownerId: true, pdUserId: true, createdById: true, departmentCode: true } },
      },
    });
    if (contracts.length === 0) return null;
    if (user.userType !== 'INTERNAL' || !user.permissions.has('contract:view')) return { allow: false };
    for (const c of contracts) {
      if (!this.scope.coversInquiry(user, c.inquiry)) continue;
      if (versionIds.includes(c.quoteVersionId) && !(await this.roundViewable(user, c.roundId))) continue;
      return { allow: true };
    }
    return { allow: false };
  }

  private async roundViewable(user: AuthUser, roundId: string): Promise<boolean> {
    const round = await this.prisma.inquiryRound.findUnique({
      where: { id: roundId },
      select: { status: true, openedAt: true },
    });
    return round !== null && (await this.seal.canViewQuoteContent(user, round));
  }

  /** 报价附件由报价附件解析器负责引用计数，这里只管合同自己的 */
  async isReferenced(fileId: string): Promise<boolean> {
    if ((await this.prisma.attachment.count({ where: { ownerType: CONTRACT_ATTACHMENT_OWNER, fileId } })) > 0)
      return true;
    return (await this.prisma.contract.count({ where: { signedScanFileId: fileId } })) > 0;
  }
}
