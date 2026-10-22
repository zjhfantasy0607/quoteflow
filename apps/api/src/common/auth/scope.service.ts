import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { AuthUser } from './auth-user';

/** 数据权限（docs/05 §11）：询价单及其派生对象都要叠加 inquiryWhere */
@Injectable()
export class ScopeService {
  inquiryWhere(user: Pick<AuthUser, 'id' | 'dataScope' | 'departmentCode'>): Prisma.InquiryWhereInput {
    if (user.dataScope === 'ALL') return {};
    const self: Prisma.InquiryWhereInput[] = [
      { ownerId: user.id },
      { pdUserId: user.id },
      { createdById: user.id },
    ];
    if (user.dataScope === 'DEPT' && user.departmentCode) {
      return { OR: [{ departmentCode: user.departmentCode }, ...self] };
    }
    return { OR: self };
  }

  /** 与 inquiryWhere 相同的判断，用于已经取出的单据（如找出数据权限覆盖某张单的审批人，R06-8） */
  coversInquiry(
    user: Pick<AuthUser, 'id' | 'dataScope' | 'departmentCode'>,
    inquiry: { ownerId: string; pdUserId: string | null; createdById: string; departmentCode: string | null },
  ): boolean {
    if (user.dataScope === 'ALL') return true;
    if ([inquiry.ownerId, inquiry.pdUserId, inquiry.createdById].includes(user.id)) return true;
    return (
      user.dataScope === 'DEPT' && !!user.departmentCode && inquiry.departmentCode === user.departmentCode
    );
  }
}
