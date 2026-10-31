import { Injectable } from '@nestjs/common';
import {
  computeInquiryActions,
  type InquiryInviteeDto,
  type InviteeCandidateDto,
  type InviteeCandidatesQuery,
  type InviteeSupplierDto,
  type Paginated,
  type PortalAccountState,
  type UpdateInviteesInput,
  type UserStatus,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { skipTake, toPaginated } from '../../common/pagination';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryIndex, MaterialCategoriesService } from '../material-categories/material-categories.service';
import { supplierWhere, toSupplierDto } from '../suppliers/suppliers.service';
import { InquiryAccessService } from './inquiry-access.service';
import { findDraftRoundNo } from './inquiry-dto';

export const inviteeSupplierInclude = {
  materialCategories: { include: { category: true } },
  users: { select: { status: true } },
} satisfies Prisma.SupplierInclude;
type InviteeSupplierRow = Prisma.SupplierGetPayload<{ include: typeof inviteeSupplierInclude }>;

/** R07-6：有 ACTIVE 的供应商用户才能登录门户 */
export function portalAccountState(users: { status: UserStatus }[]): PortalAccountState {
  if (users.some((u) => u.status === 'ACTIVE')) return 'ACTIVE';
  if (users.some((u) => u.status === 'PENDING_ACTIVATION')) return 'PENDING';
  return users.length > 0 ? 'DISABLED' : 'NONE';
}

/** 不含联系方式，所以不用按 supplier.contact 脱敏 */
export function toInviteeSupplierDto(row: InviteeSupplierRow, index: CategoryIndex): InviteeSupplierDto {
  const s = toSupplierDto(row, index);
  return {
    id: s.id,
    code: s.code,
    nameZh: s.nameZh,
    nameEn: s.nameEn,
    categoryCode: s.categoryCode,
    materialCategories: s.materialCategories,
    preferredLanguage: s.preferredLanguage,
    status: s.status,
    portalAccount: portalAccountState(row.users),
  };
}

/** 本单受邀名单与候选供应商（R07-1、R07-2）。名单是询价单级别的，发布时据此建报价单 */
@Injectable()
export class InquiryInviteesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly categories: MaterialCategoriesService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  async list(user: AuthUser, inquiryId: string): Promise<InquiryInviteeDto[]> {
    await this.access.findOrThrow(this.prisma, user, inquiryId);
    const rows = await this.prisma.inquiryInvitee.findMany({
      where: { inquiryId },
      include: { supplier: { include: inviteeSupplierInclude } },
      orderBy: [{ createdAt: 'asc' }, { supplier: { code: 'asc' } }],
    });
    const adders = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.addedById))] } },
      select: { id: true, name: true },
    });
    const byId = new Map(adders.map((u) => [u.id, u]));
    const index = await this.categories.loadIndex();
    return rows.map((r) => ({
      supplier: toInviteeSupplierDto(r.supplier, index),
      addedBy: byId.get(r.addedById) ?? { id: r.addedById, name: '' },
      addedAt: r.createdAt.toISOString(),
    }));
  }

  /** R07-1：只含启用的供应商；按分类、主营材料分类（含下级）、关键字筛选；已受邀的标记出来 */
  async candidates(
    user: AuthUser,
    inquiryId: string,
    query: InviteeCandidatesQuery,
  ): Promise<Paginated<InviteeCandidateDto>> {
    await this.access.findOrThrow(this.prisma, user, inquiryId);
    const index = await this.categories.loadIndex();
    const where = supplierWhere({ ...query, status: 'ENABLED' }, index);
    const [rows, total, invitees] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        include: inviteeSupplierInclude,
        orderBy: { code: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.supplier.count({ where }),
      this.prisma.inquiryInvitee.findMany({ where: { inquiryId }, select: { supplierId: true } }),
    ]);
    const invited = new Set(invitees.map((i) => i.supplierId));
    return toPaginated(
      rows.map((r) => ({ ...toInviteeSupplierDto(r, index), invited: invited.has(r.id) })),
      total,
      query,
    );
  }

  /**
   * 整体替换（R07-2）：只在 editInvitees 允许时（第 1 轮发布前，或有变更草稿时——只影响新一轮，05 §3）；
   * 新加入的必须是启用的供应商（R04-6），已在名单里、后来停用的可以留着（发布时会被拒，R07-3）
   */
  async replace(user: AuthUser, inquiryId: string, input: UpdateInviteesInput): Promise<InquiryInviteeDto[]> {
    await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.access.lockOrThrow(tx, user, inquiryId);
      const draftRoundNo = await findDraftRoundNo(tx, inquiryId);
      if (!computeInquiryActions({ ...inquiry, draftRoundNo }, user.permissions).includes('editInvitees')) {
        throw new AppException('INQUIRY_NOT_EDITABLE');
      }
      const before = (
        await tx.inquiryInvitee.findMany({ where: { inquiryId }, select: { supplierId: true } })
      ).map((i) => i.supplierId);
      const added = input.supplierIds.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !input.supplierIds.includes(id));
      if (added.length === 0 && removed.length === 0) return;
      const suppliers = await tx.supplier.findMany({
        where: { id: { in: [...added, ...removed] } },
        select: { id: true, code: true, status: true },
      });
      const byId = new Map(suppliers.map((s) => [s.id, s]));
      const notInvitable = added.filter((id) => byId.get(id)?.status !== 'ENABLED');
      if (notInvitable.length > 0) {
        throw new AppException('INQUIRY_SUPPLIER_NOT_INVITABLE', { supplierIds: notInvitable });
      }
      if (removed.length > 0) {
        await tx.inquiryInvitee.deleteMany({ where: { inquiryId, supplierId: { in: removed } } });
      }
      const now = this.clock.now();
      await tx.inquiryInvitee.createMany({
        data: added.map((supplierId) => ({ inquiryId, supplierId, addedById: user.id, createdAt: now })),
      });
      const codes = (ids: string[]) => ids.map((id) => byId.get(id)!.code).join(', ');
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.invitees',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: [
            inquiry.formalNo ?? inquiry.draftNo,
            ...(added.length ? [`+ ${codes(added)}`] : []),
            ...(removed.length ? [`- ${codes(removed)}`] : []),
          ].join(' · '),
          detail: { added, removed, total: input.supplierIds.length },
        },
        tx,
      );
    });
    return this.list(user, inquiryId);
  }
}
