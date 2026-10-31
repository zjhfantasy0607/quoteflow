import { Injectable } from '@nestjs/common';
import { isInquiryReadonly, isRoundEditable } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import { AppException } from '../../common/errors/app.exception';
import type { Inquiry, InquiryRound, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Client = PrismaService | Prisma.TransactionClient;

/** R12-8：询价完成（评标完成）或取消后整单只读 */
export function assertInquiryWritable(inquiry: Pick<Inquiry, 'docStatus' | 'currentRoundStatus'>): void {
  if (isInquiryReadonly(inquiry)) throw new AppException('INQUIRY_COMPLETED_READONLY');
}

/** 按数据权限取询价单（R06-10）：不存在和不在范围内都返回 404，两者不区分 */
@Injectable()
export class InquiryAccessService {
  constructor(private readonly scope: ScopeService) {}

  async findOrThrow(client: Client, user: AuthUser, id: string): Promise<Inquiry> {
    const inquiry = await client.inquiry.findFirst({
      where: { AND: [{ id }, this.scope.inquiryWhere(user)] },
    });
    if (!inquiry) throw new AppException('NOT_FOUND');
    return inquiry;
  }

  /**
   * 修改询价单或它的行、附件、名单、轮次、入围、议价之前用：确认在数据权限内之后给询价单加行锁（SELECT ... FOR UPDATE），
   * 与提交审批等状态动作、其他编辑串行执行；返回加锁后读到的最新数据。
   * 所有修改类接口都经过这里，R12-8 的全局只读在这里统一拦截：询价完成或取消后一律 INQUIRY_COMPLETED_READONLY
   * （加锁后再判断，并发定标时第二次读到的已是评标完成）
   */
  async lockOrThrow(tx: Prisma.TransactionClient, user: AuthUser, id: string): Promise<Inquiry> {
    await this.findOrThrow(tx, user, id);
    await tx.$queryRaw`SELECT 1 FROM "Inquiry" WHERE "id" = ${id} FOR UPDATE`;
    const inquiry = await tx.inquiry.findUniqueOrThrow({ where: { id } });
    assertInquiryWritable(inquiry);
    return inquiry;
  }

  /** 锁住询价单并取出要编辑的轮次（R06-4、I-4）：轮次不存在 404，不能编辑 INQUIRY_NOT_EDITABLE */
  async lockEditableRound(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
  ): Promise<{ inquiry: Inquiry; round: InquiryRound }> {
    const inquiry = await this.lockOrThrow(tx, user, inquiryId);
    const round = await tx.inquiryRound.findUnique({ where: { inquiryId_roundNo: { inquiryId, roundNo } } });
    if (!round) throw new AppException('NOT_FOUND');
    if (!isRoundEditable(inquiry.docStatus, round)) throw new AppException('INQUIRY_NOT_EDITABLE');
    return { inquiry, round };
  }
}
