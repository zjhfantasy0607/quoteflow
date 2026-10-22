import { Injectable } from '@nestjs/common';
import {
  computeInquiryActions,
  INQUIRY_TAB_FILTER,
  isRoundEditable,
  type AuditLogDto,
  type CreateInquiryInput,
  type InquiryApprovalDto,
  type InquiryDetailDto,
  type InquiryListItemDto,
  type InquiryListQuery,
  type InquiryRoundDto,
  type InquiryUserOptionDto,
  type PageQuery,
  type Paginated,
  type UpdateInquiryInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/auth/scope.service';
import { buildAuthUser, userWithRolesInclude } from '../../common/auth/session.service';
import { changedFields } from '../../common/audit-diff';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { skipTake, toPaginated } from '../../common/pagination';
import { inAppTz } from '../../common/time';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { SequenceService } from '../../infra/sequences/sequence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DictsService } from '../dicts/dicts.service';
import { CategoryIndex, MaterialCategoriesService } from '../material-categories/material-categories.service';
import { InquiryAccessService } from './inquiry-access.service';
import {
  inquiryDetailInclude,
  inquiryListInclude,
  loadRound,
  toInquiryListItemDto,
  toInquiryRoundDto,
} from './inquiry-dto';

type Client = PrismaService | Prisma.TransactionClient;

const NO_REQUEST = { ip: null, userAgent: null };

/** 负责人、PD 负责人的候选人：启用的内部用户，经内部角色拥有 inquiry:create */
const assignableUserWhere: Prisma.UserWhereInput = {
  userType: 'INTERNAL',
  status: 'ACTIVE',
  roles: { some: { role: { forSupplier: false, permissions: { has: 'inquiry:create' } } } },
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** 询价单表头、列表、详情、审批记录与操作日志（M06） */
@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly scope: ScopeService,
    private readonly categories: MaterialCategoriesService,
    private readonly dicts: DictsService,
    private readonly sequences: SequenceService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  /** 列表叠加数据权限（R06-10），按创建时间倒序 */
  async list(user: AuthUser, query: InquiryListQuery): Promise<Paginated<InquiryListItemDto>> {
    const index = await this.categories.loadIndex();
    const where: Prisma.InquiryWhereInput = {
      AND: [this.scope.inquiryWhere(user), this.filters(query, index)],
    };
    const [rows, total] = await Promise.all([
      this.prisma.inquiry.findMany({
        where,
        include: inquiryListInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.inquiry.count({ where }),
    ]);
    return toPaginated(
      rows.map((r) => toInquiryListItemDto(r, index)),
      total,
      query,
    );
  }

  /** 待我审批：数据权限覆盖的待审批单据，先提交的在前（05 §11） */
  async pendingApprovals(user: AuthUser, query: PageQuery): Promise<Paginated<InquiryListItemDto>> {
    const index = await this.categories.loadIndex();
    const where: Prisma.InquiryWhereInput = {
      AND: [this.scope.inquiryWhere(user), { docStatus: 'PENDING_APPROVAL' }],
    };
    const [rows, total] = await Promise.all([
      this.prisma.inquiry.findMany({
        where,
        include: inquiryListInclude,
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.inquiry.count({ where }),
    ]);
    return toPaginated(
      rows.map((r) => toInquiryListItemDto(r, index)),
      total,
      query,
    );
  }

  /**
   * 不要在事务里调用：include 的多个关联 Prisma 会并发查询，而事务只有一个连接（pg 已废弃同一连接上的并发查询）。
   * 写操作先提交事务，再用 this.prisma 取最新详情
   */
  async detail(client: Client, user: AuthUser, id: string): Promise<InquiryDetailDto> {
    const row = await client.inquiry.findFirst({
      where: { AND: [{ id }, this.scope.inquiryWhere(user)] },
      include: inquiryDetailInclude,
    });
    if (!row) throw new AppException('NOT_FOUND');
    const round = await client.inquiryRound.findUniqueOrThrow({
      where: { inquiryId_roundNo: { inquiryId: id, roundNo: row.currentRoundNo } },
      include: { _count: { select: { lines: true } } },
    });
    const approvedBy = row.approvedById
      ? await client.user.findUnique({ where: { id: row.approvedById }, select: { id: true, name: true } })
      : null;
    const index = await this.categories.loadIndex(client);
    return {
      ...toInquiryListItemDto(row, index),
      description: row.description,
      createdBy: row.createdBy,
      departmentCode: row.departmentCode,
      lastRejectComment: row.lastRejectComment,
      approvedAt: iso(row.approvedAt),
      approvedBy,
      cancelledAt: iso(row.cancelledAt),
      cancelReason: row.cancelReason,
      completedAt: iso(row.completedAt),
      updatedAt: row.updatedAt.toISOString(),
      currentRound: {
        id: round.id,
        roundNo: round.roundNo,
        status: round.status,
        deadline: iso(round.deadline),
        publishedAt: iso(round.publishedAt),
        lineCount: round._count.lines,
      },
      allowedActions: computeInquiryActions(row, user.permissions),
    };
  }

  /** 轮次详情：询价行（含每行附件）、整单附件、冻结的模板；edit 只在本轮可编辑时出现（I-4） */
  async roundDetail(
    client: Client,
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
  ): Promise<InquiryRoundDto> {
    const inquiry = await this.access.findOrThrow(client, user, inquiryId);
    const round = await loadRound(client, inquiryId, roundNo);
    if (!round) throw new AppException('NOT_FOUND');
    const actions = computeInquiryActions(inquiry, user.permissions).filter(
      (a) => a !== 'edit' || isRoundEditable(inquiry.docStatus, round),
    );
    return toInquiryRoundDto(round, actions, await this.categories.loadIndex(client));
  }

  /** R06-1：生成草稿号，同时建第 1 轮（I-1）；部门取创建人的部门（数据权限 DEPT） */
  async create(user: AuthUser, input: CreateInquiryInput): Promise<InquiryDetailDto> {
    await this.categories.assertSelectable(input.materialCategoryId, this.prisma, 'materialCategoryId');
    await this.dicts.assertEnabled('currency', input.currency);
    const ownerId = input.ownerId ?? user.id;
    if (ownerId !== user.id) await this.assertAssignable(this.prisma, ownerId, 'ownerId');
    if (input.pdUserId) await this.assertAssignable(this.prisma, input.pdUserId, 'pdUserId');
    const id = await this.prisma.$transaction(async (tx) => {
      // 创建时间也取 ClockService（列表按创建日期筛选；演示数据用时钟偏移造历史单据）
      const now = this.clock.now();
      const draftNo = await this.sequences.draftNo(now, tx);
      const created = await tx.inquiry.create({
        data: {
          draftNo,
          projectNo: input.projectNo,
          title: input.title,
          materialCategoryId: input.materialCategoryId,
          currency: input.currency,
          description: input.description ?? null,
          ownerId,
          pdUserId: input.pdUserId,
          createdById: user.id,
          departmentCode: user.departmentCode,
          createdAt: now,
          rounds: { create: { roundNo: 1, createdById: user.id, createdAt: now } },
        },
      });
      await this.audit.log(
        {
          actor: user,
          action: 'inquiry.create',
          entityType: 'inquiry',
          entityId: created.id,
          summary: `${draftNo} ${created.title}`,
          detail: { projectNo: created.projectNo },
        },
        tx,
      );
      return created.id;
    });
    return this.detail(this.prisma, user, id);
  }

  /** R06-4：只有草稿可以改表头；材料类别、币种、负责人只在改动时校验（停用的旧值照常保留） */
  async update(user: AuthUser, id: string, input: UpdateInquiryInput): Promise<InquiryDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.access.lockOrThrow(tx, user, id);
      if (before.docStatus !== 'DRAFT') throw new AppException('INQUIRY_NOT_EDITABLE');
      if (input.materialCategoryId !== before.materialCategoryId) {
        await this.categories.assertSelectable(input.materialCategoryId, tx, 'materialCategoryId');
      }
      if (input.currency !== before.currency) await this.dicts.assertEnabled('currency', input.currency, tx);
      if (input.ownerId !== before.ownerId) await this.assertAssignable(tx, input.ownerId, 'ownerId');
      if (input.pdUserId && input.pdUserId !== before.pdUserId) {
        await this.assertAssignable(tx, input.pdUserId, 'pdUserId');
      }
      const data = {
        projectNo: input.projectNo,
        title: input.title,
        materialCategoryId: input.materialCategoryId,
        currency: input.currency,
        description: input.description ?? null,
        ownerId: input.ownerId,
        pdUserId: input.pdUserId,
      };
      const changes = changedFields(before, data);
      if (Object.keys(changes).length > 0) {
        await tx.inquiry.update({ where: { id }, data });
        await this.audit.log(
          {
            actor: user,
            action: 'inquiry.update',
            entityType: 'inquiry',
            entityId: id,
            summary: `${before.draftNo} ${data.title}`,
            detail: changes,
          },
          tx,
        );
      }
    });
    return this.detail(this.prisma, user, id);
  }

  /** 审批记录，按时间正序（R06-12） */
  async approvals(user: AuthUser, id: string): Promise<InquiryApprovalDto[]> {
    await this.access.findOrThrow(this.prisma, user, id);
    const rows = await this.prisma.inquiryApproval.findMany({
      where: { inquiryId: id },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      comment: r.comment,
      actor: r.actor,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** 该单的操作日志（R06-12）：表头、询价行、附件和状态动作都记在 entityType = inquiry 下 */
  async timeline(user: AuthUser, id: string): Promise<AuditLogDto[]> {
    await this.access.findOrThrow(this.prisma, user, id);
    return this.audit.listForEntity('inquiry', id);
  }

  async userOptions(): Promise<InquiryUserOptionDto[]> {
    const users = await this.prisma.user.findMany({
      where: assignableUserWhere,
      include: { roles: { include: { role: { select: { code: true } } } } },
      orderBy: { username: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      departmentCode: u.departmentCode,
      roleCodes: u.roles.map((r) => r.role.code),
    }));
  }

  /** 负责人、PD 负责人必须是候选人之一（启用的内部用户，有 inquiry:create） */
  private async assertAssignable(client: Client, userId: string, path: string): Promise<void> {
    const user = await client.user.findUnique({ where: { id: userId }, include: userWithRolesInclude });
    const ok =
      !!user &&
      user.userType === 'INTERNAL' &&
      user.status === 'ACTIVE' &&
      buildAuthUser(user, '', NO_REQUEST).permissions.has('inquiry:create');
    if (!ok) {
      throw new AppException('VALIDATION_FAILED', undefined, [
        { path, code: 'invalid_user', message: 'User cannot be assigned to RFQs' },
      ]);
    }
  }

  private filters(query: InquiryListQuery, index: CategoryIndex): Prisma.InquiryWhereInput {
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    const and: Prisma.InquiryWhereInput[] = [];
    if (query.tab) and.push(INQUIRY_TAB_FILTER[query.tab]);
    if (query.keyword) {
      and.push({
        OR: [
          { draftNo: contains(query.keyword) },
          { formalNo: contains(query.keyword) },
          { title: contains(query.keyword) },
          { projectNo: contains(query.keyword) },
        ],
      });
    }
    if (query.projectNo) and.push({ projectNo: { equals: query.projectNo, mode: 'insensitive' } });
    // 材料类别包含下级
    if (query.materialCategoryId) {
      and.push({ materialCategoryId: { in: index.subtreeIds(query.materialCategoryId) } });
    }
    if (query.ownerId) and.push({ ownerId: query.ownerId });
    if (query.from) and.push({ createdAt: { gte: inAppTz(query.from).startOf('day').toDate() } });
    if (query.to) and.push({ createdAt: { lt: inAppTz(query.to).add(1, 'day').startOf('day').toDate() } });
    return { AND: and };
  }
}
