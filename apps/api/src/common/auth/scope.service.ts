import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
}
