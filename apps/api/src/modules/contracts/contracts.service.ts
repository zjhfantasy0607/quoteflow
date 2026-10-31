import { Injectable } from '@nestjs/common';
import {
  computeContractActions,
  CONTRACT_ATTACHMENT_OWNER,
  CONTRACT_ATTACHMENTS_MAX,
  CONTRACT_SCAN_EXTS,
  UPLOAD_KIND_RULES,
  type ContractAction,
  type ContractDecisionInput,
  type ContractDetailDto,
  type ContractListItemDto,
  type ContractListQuery,
  type ContractSnapshot,
  type ContractStep,
  type Paginated,
  type PermissionCode,
  type SignedScanInput,
  type UpdateContractInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { ScopeService } from '../../common/auth/scope.service';
import { buildAuthUser, userWithRolesInclude } from '../../common/auth/session.service';
import { changedFields } from '../../common/audit-diff';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import { skipTake, toPaginated } from '../../common/pagination';
import { inAppTz } from '../../common/time';
import { AppConfig } from '../../config/app-config';
import type { Contract, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { toFileDto } from '../../infra/files/files.service';
import type { MailTemplateDataMap } from '../../infra/mail/mail-templates';
import { MailService, userMailLanguage } from '../../infra/mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SealService } from '../quotes/seal.service';
import { contractListSelect, dateOnly, toContractListItem, toSnapshotDto } from './contract-dto';

const NO_REQUEST = { ip: null, userAgent: null };
/** R14-3：提交审核时必填的字段 */
const REQUIRED_TO_SUBMIT = ['deliveryDate', 'deliveryPlace', 'paymentTerms'] as const;

type Locked = Contract & {
  inquiry: { id: string; formalNo: string | null; title: string; ownerId: string; pdUserId: string | null };
};

interface Recipient {
  id: string;
  name: string;
  email: string;
  locale: string;
}

/**
 * 合同管理（M14 R14-1 ~ R14-9，05 §6）：列表、详情、编辑（只有草稿）、提交审核 → 合同审核 → 合同批准（驳回回到草稿，
 * 意见必填）、批准后上传签字扫描件。数据权限跟随询价单（R14-7，范围外 404），金额按 contract.amount 脱敏（快照同样处理）。
 * 合同金额与快照是报价内容，照样经过 SealService（合同只在定标时生成，所属轮次一定开过标，这里是兜底）。
 * 写操作先锁合同行（FOR UPDATE），状态用条件更新防并发；审批记录、邮件、审计在同一事务里
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly fieldMask: FieldMaskService,
    private readonly seal: SealService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly config: AppConfig,
  ) {}

  /** 合同的数据权限 = 它所属询价单的数据权限（05 §11） */
  private scoped(user: AuthUser): Prisma.ContractWhereInput {
    return { inquiry: this.scope.inquiryWhere(user) };
  }

  /** 开标前密封：这些轮次里当前用户看不到报价内容的（没开过标，且角色不在 seal.preOpenViewRoles） */
  private async sealedRounds(user: AuthUser, roundIds: string[]): Promise<Set<string>> {
    const rounds = await this.prisma.inquiryRound.findMany({
      where: { id: { in: [...new Set(roundIds)] } },
      select: { id: true, status: true, openedAt: true },
    });
    const sealed = new Set<string>();
    for (const round of rounds) {
      if (!(await this.seal.canViewQuoteContent(user, round))) sealed.add(round.id);
    }
    return sealed;
  }

  /** 关键字匹配合同号、询价号、供应商编码和名称；日期区间是创建日期（按 UTC+8，含当天） */
  async list(user: AuthUser, query: ContractListQuery): Promise<Paginated<ContractListItemDto>> {
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    const and: Prisma.ContractWhereInput[] = [this.scoped(user)];
    if (query.status) and.push({ status: query.status });
    if (query.supplierId) and.push({ supplierId: query.supplierId });
    if (query.keyword) {
      const k = query.keyword;
      and.push({
        OR: [
          { contractNo: contains(k) },
          { inquiry: { formalNo: contains(k) } },
          { supplier: { OR: [{ code: contains(k) }, { nameZh: contains(k) }, { nameEn: contains(k) }] } },
        ],
      });
    }
    if (query.from) and.push({ createdAt: { gte: inAppTz(query.from).startOf('day').toDate() } });
    if (query.to) and.push({ createdAt: { lt: inAppTz(query.to).add(1, 'day').startOf('day').toDate() } });
    const where: Prisma.ContractWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        select: contractListSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.contract.count({ where }),
    ]);
    const sealed = await this.sealedRounds(
      user,
      rows.map((r) => r.roundId),
    );
    return toPaginated(
      rows.map((r) => {
        const item = this.fieldMask.mask(toContractListItem(r), user, 'contract.amount', ['amount']);
        if (!sealed.has(r.roundId)) return item;
        return {
          ...item,
          amount: null,
          maskedFields: [...new Set([...(item.maskedFields ?? []), 'amount'])],
        };
      }),
      total,
      query,
    );
  }

  /** 详情：快照、附件、签字扫描件、审批记录、allowedActions。不在事务里调用 */
  async detail(user: AuthUser, id: string): Promise<ContractDetailDto> {
    const row = await this.prisma.contract.findFirst({
      where: { AND: [{ id }, this.scoped(user)] },
      select: {
        ...contractListSelect,
        deliveryPlace: true,
        paymentTerms: true,
        summary: true,
        remark: true,
        snapshot: true,
        signedScanFileId: true,
        signedAt: true,
        createdById: true,
      },
    });
    if (!row) throw new AppException('NOT_FOUND');
    if ((await this.sealedRounds(user, [row.roundId])).size > 0) throw new AppException('QUOTE_SEALED');
    const attachments = await this.prisma.attachment.findMany({
      where: { ownerType: CONTRACT_ATTACHMENT_OWNER, ownerId: id },
      include: { file: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const signedScan = row.signedScanFileId
      ? await this.prisma.fileObject.findUnique({ where: { id: row.signedScanFileId } })
      : null;
    const approvals = await this.prisma.contractApproval.findMany({
      where: { contractId: id },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const createdBy = await this.prisma.user.findUniqueOrThrow({
      where: { id: row.createdById },
      select: { id: true, name: true },
    });
    const canAmount = this.fieldMask.can(user, 'contract.amount');
    const canContact = this.fieldMask.can(user, 'supplier.contact');
    const dto: ContractDetailDto = {
      ...toContractListItem(row),
      deliveryPlace: row.deliveryPlace,
      paymentTerms: row.paymentTerms,
      summary: row.summary,
      remark: row.remark,
      snapshot: toSnapshotDto(row.snapshot as unknown as ContractSnapshot, {
        amount: canAmount,
        contact: canContact,
      }),
      attachments: attachments.map((a) => toFileDto(a.file)),
      signedScan: signedScan ? toFileDto(signedScan) : null,
      signedAt: row.signedAt?.toISOString() ?? null,
      approvals: approvals.map((a) => ({
        id: a.id,
        step: a.step as ContractStep,
        action: a.action,
        comment: a.comment,
        actor: a.actor,
        createdAt: a.createdAt.toISOString(),
      })),
      createdBy,
      allowedActions: computeContractActions(row, user.permissions),
    };
    const masked = this.fieldMask.mask(dto, user, 'contract.amount', ['amount']);
    return canContact
      ? masked
      : { ...masked, maskedFields: [...(masked.maskedFields ?? []), 'contactEmail', 'contactPhone'] };
  }

  /**
   * R14-2：草稿可以改交付日期、交付地点、付款方式、合同摘要、备注和附件（整份名单，最多 20 个，只能是 ATTACHMENT；
   * 新挂上的只能是自己上传的，已经挂着的别人上传的可以留着）
   */
  async update(user: AuthUser, id: string, input: UpdateContractInput): Promise<ContractDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const contract = await this.lock(tx, user, id, 'edit');
      if (input.attachmentFileIds.length > CONTRACT_ATTACHMENTS_MAX)
        throw new AppException('FILE_LIMIT_EXCEEDED', { max: CONTRACT_ATTACHMENTS_MAX });
      const before = await tx.attachment.findMany({
        where: { ownerType: CONTRACT_ATTACHMENT_OWNER, ownerId: id },
        select: { id: true, fileId: true },
      });
      const had = new Set(before.map((a) => a.fileId));
      const added = input.attachmentFileIds.filter((f) => !had.has(f));
      const removed = before.filter((a) => !input.attachmentFileIds.includes(a.fileId));
      await this.checkFiles(tx, user, added, UPLOAD_KIND_RULES.ATTACHMENT.exts);

      const data = {
        deliveryDate: input.deliveryDate ?? null,
        deliveryPlace: input.deliveryPlace ?? null,
        paymentTerms: input.paymentTerms ?? null,
        summary: input.summary ?? null,
        remark: input.remark ?? null,
      };
      const changes = changedFields({ ...contract, deliveryDate: dateOnly(contract.deliveryDate) }, data);
      if (Object.keys(changes).length === 0 && added.length === 0 && removed.length === 0) return;
      await tx.contract.update({
        where: { id },
        data: {
          ...data,
          deliveryDate: data.deliveryDate ? new Date(`${data.deliveryDate}T00:00:00.000Z`) : null,
        },
      });
      if (removed.length > 0)
        await tx.attachment.deleteMany({ where: { id: { in: removed.map((a) => a.id) } } });
      if (added.length > 0) {
        const now = this.clock.now();
        await tx.attachment.createMany({
          data: added.map((fileId) => ({
            ownerType: CONTRACT_ATTACHMENT_OWNER,
            ownerId: id,
            fileId,
            createdById: user.id,
            createdAt: now,
          })),
        });
      }
      await this.log(tx, user, contract, 'contract.update', {
        changes,
        attachmentsAdded: added.length,
        attachmentsRemoved: removed.length,
      });
    });
    return this.detail(user, id);
  }

  /** R14-3：交付日期、交付地点、付款方式都填了才能提交审核；审核请求发给数据权限覆盖的 contract:review 用户 */
  async submit(user: AuthUser, id: string): Promise<ContractDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const contract = await this.lock(tx, user, id, 'submit');
      const missing = REQUIRED_TO_SUBMIT.filter((f) => !contract[f]);
      if (missing.length > 0) throw new AppException('CONTRACT_FIELDS_REQUIRED', { fields: missing });
      await this.transition(tx, contract, 'DRAFT', 'PENDING_REVIEW');
      await this.record(tx, user, contract, 'SUBMIT', 'SUBMIT', null);
      for (const r of await this.recipients(tx, 'contract:review', contract)) {
        await this.notify(tx, r, contract, 'contract.reviewRequest', { actorName: user.name });
      }
      await this.log(tx, user, contract, 'contract.submit', {});
    });
    return this.detail(user, id);
  }

  /** 合同审核（R14-4）：通过 → 待批准，批准请求发给 contract:approve 用户；驳回（意见必填）→ 草稿，结果发给最近一次的提交人 */
  async review(user: AuthUser, id: string, input: ContractDecisionInput): Promise<ContractDetailDto> {
    await this.decide(user, id, input, 'review', 'REVIEW');
    return this.detail(user, id);
  }

  /** 合同批准（R14-4）：通过 → 已批准；驳回（意见必填）→ 草稿；结果都发给最近一次的提交人 */
  async approve(user: AuthUser, id: string, input: ContractDecisionInput): Promise<ContractDetailDto> {
    await this.decide(user, id, input, 'approve', 'APPROVE');
    return this.detail(user, id);
  }

  /** R14-6：批准后上传签字扫描件（PDF 或图片，自己上传的 ATTACHMENT），可以替换；记录签字时间 */
  async uploadSignedScan(user: AuthUser, id: string, input: SignedScanInput): Promise<ContractDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const contract = await this.lock(tx, user, id, 'uploadSignedScan');
      await this.checkFiles(tx, user, [input.fileId], CONTRACT_SCAN_EXTS);
      await tx.contract.update({
        where: { id },
        data: { signedScanFileId: input.fileId, signedAt: this.clock.now() },
      });
      await this.log(tx, user, contract, 'contract.signedScan', {
        fileId: input.fileId,
        replaced: contract.signedScanFileId,
      });
    });
    return this.detail(user, id);
  }

  private async decide(
    user: AuthUser,
    id: string,
    input: ContractDecisionInput,
    action: Extract<ContractAction, 'review' | 'approve'>,
    step: Extract<ContractStep, 'REVIEW' | 'APPROVE'>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const contract = await this.lock(tx, user, id, action);
      const approved = input.action === 'APPROVE';
      if (!approved && !input.comment) throw new AppException('CONTRACT_COMMENT_REQUIRED');
      const from = step === 'REVIEW' ? 'PENDING_REVIEW' : 'PENDING_APPROVAL';
      const to = !approved ? 'DRAFT' : step === 'REVIEW' ? 'PENDING_APPROVAL' : 'APPROVED';
      await this.transition(tx, contract, from, to);
      const comment = input.comment ?? null;
      await this.record(tx, user, contract, step, input.action, comment);
      if (approved && step === 'REVIEW') {
        for (const r of await this.recipients(tx, 'contract:approve', contract)) {
          await this.notify(tx, r, contract, 'contract.approveRequest', { actorName: user.name });
        }
      } else {
        const submitter = await this.lastSubmitter(tx, contract.id);
        if (submitter) {
          await this.notify(tx, submitter, contract, 'contract.result', {
            actorName: user.name,
            step,
            approved,
            comment,
          });
        }
      }
      await this.log(tx, user, contract, `contract.${action}`, {
        action: input.action,
        ...(comment ? { comment } : {}),
      });
    });
  }

  /**
   * 数据权限外 404；加行锁后读最新数据并复核动作（03 §6：功能权限已由守卫检查，不符合只可能是状态不对）
   */
  private async lock(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    id: string,
    action: ContractAction,
  ): Promise<Locked> {
    const found = await tx.contract.count({ where: { AND: [{ id }, this.scoped(user)] } });
    if (found === 0) throw new AppException('NOT_FOUND');
    await tx.$queryRaw`SELECT 1 FROM "Contract" WHERE "id" = ${id} FOR UPDATE`;
    const contract = await tx.contract.findUniqueOrThrow({
      where: { id },
      include: {
        inquiry: { select: { id: true, formalNo: true, title: true, ownerId: true, pdUserId: true } },
      },
    });
    if (!computeContractActions(contract, user.permissions).includes(action))
      throw new AppException('CONTRACT_INVALID_STATUS');
    return contract;
  }

  /** 05 §6：条件更新防并发 */
  private async transition(
    tx: Prisma.TransactionClient,
    contract: Contract,
    from: Contract['status'],
    to: Contract['status'],
  ): Promise<void> {
    const res = await tx.contract.updateMany({
      where: { id: contract.id, status: from },
      data: { status: to },
    });
    if (res.count !== 1) throw new AppException('CONTRACT_INVALID_STATUS');
  }

  private async record(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    contract: Contract,
    step: ContractStep,
    action: 'SUBMIT' | 'APPROVE' | 'REJECT',
    comment: string | null,
  ): Promise<void> {
    await tx.contractApproval.create({
      data: { contractId: contract.id, step, action, comment, actorId: user.id, createdAt: this.clock.now() },
    });
  }

  /**
   * 文件必须存在、是报价附件类（ATTACHMENT）、是当前用户上传的，扩展名在允许范围内
   * （防止借用别人的文件 id 扩大访问范围，与议价附件 R11-8 一样）
   */
  private async checkFiles(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    fileIds: string[],
    exts: readonly string[],
  ): Promise<void> {
    if (fileIds.length === 0) return;
    const files = await tx.fileObject.findMany({
      where: { id: { in: fileIds } },
      select: { kind: true, uploadedById: true, originalName: true },
    });
    if (files.length !== fileIds.length) {
      throw new AppException('VALIDATION_FAILED', undefined, [
        { path: 'fileId', code: 'not_found', message: 'File not found' },
      ]);
    }
    const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
    if (files.some((f) => f.kind !== 'ATTACHMENT' || !exts.includes(ext(f.originalName))))
      throw new AppException('FILE_TYPE_NOT_ALLOWED', { allowed: exts.join(', ') });
    if (files.some((f) => f.uploadedById !== user.id)) throw new AppException('FILE_ACCESS_DENIED');
  }

  /** R14-5：启用的内部用户中有该权限、且数据权限覆盖该合同（所属询价单）的人；没有邮箱的收不到 */
  private async recipients(
    tx: Prisma.TransactionClient,
    permission: PermissionCode,
    contract: Locked,
  ): Promise<Recipient[]> {
    const inquiry = await tx.inquiry.findUniqueOrThrow({
      where: { id: contract.inquiryId },
      select: { ownerId: true, pdUserId: true, createdById: true, departmentCode: true },
    });
    const users = await tx.user.findMany({
      where: {
        userType: 'INTERNAL',
        status: 'ACTIVE',
        email: { not: null },
        roles: { some: { role: { forSupplier: false, permissions: { has: permission } } } },
      },
      include: userWithRolesInclude,
      orderBy: { username: 'asc' },
    });
    return users
      .filter((u) => {
        const auth = buildAuthUser(u, '', NO_REQUEST);
        return auth.permissions.has(permission) && this.scope.coversInquiry(auth, inquiry);
      })
      .map((u) => ({ id: u.id, name: u.name, email: u.email!, locale: u.locale }));
  }

  /** 最近一次提交审核的人（R14-5 结果发给他）；停用或没有邮箱时为 null */
  private async lastSubmitter(tx: Prisma.TransactionClient, contractId: string): Promise<Recipient | null> {
    const last = await tx.contractApproval.findFirst({
      where: { contractId, step: 'SUBMIT' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { actor: { select: { id: true, name: true, email: true, locale: true, status: true } } },
    });
    const actor = last?.actor;
    if (!actor || actor.status !== 'ACTIVE' || !actor.email) return null;
    return { id: actor.id, name: actor.name, email: actor.email, locale: actor.locale };
  }

  /** 合同邮件只写合同号、询价号、标题和供应商，不写金额（管理员能在邮件记录里看到内部邮件正文） */
  private async notify<K extends 'contract.reviewRequest' | 'contract.approveRequest' | 'contract.result'>(
    tx: Prisma.TransactionClient,
    to: Recipient,
    contract: Locked,
    templateKey: K,
    extra: K extends 'contract.result'
      ? { actorName: string; step: 'REVIEW' | 'APPROVE'; approved: boolean; comment: string | null }
      : { actorName: string },
  ): Promise<void> {
    const supplier = await tx.supplier.findUniqueOrThrow({
      where: { id: contract.supplierId },
      select: { code: true, nameZh: true, nameEn: true },
    });
    await this.mail.enqueue(tx, {
      templateKey,
      language: userMailLanguage(to),
      to: [to.email],
      userId: to.id,
      inquiryId: contract.inquiryId,
      data: {
        name: to.name,
        contractNo: contract.contractNo,
        inquiry: { formalNo: contract.inquiry.formalNo!, title: contract.inquiry.title },
        supplier,
        link: `${this.config.get('APP_BASE_URL')}/contracts/${contract.id}`,
        ...extra,
      } as MailTemplateDataMap[K],
    });
  }

  /** R14-9：合同的每个动作都记审计（entityType = contract），不记金额 */
  private async log(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    contract: Locked,
    action: string,
    detail: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.audit.log(
      {
        actor: user,
        action,
        entityType: 'contract',
        entityId: contract.id,
        summary: `${contract.contractNo} · ${contract.inquiry.formalNo}`,
        detail,
      },
      tx,
    );
  }
}
