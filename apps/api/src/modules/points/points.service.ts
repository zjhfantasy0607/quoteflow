import { Injectable } from '@nestjs/common';
import {
  QuoteStatus,
  type PointsAdjustInput,
  type PointsLedgerItemDto,
  type PointsRuleCode,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { ParamsService } from '../../infra/params/params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ledgerSelect, PointsLedgerService } from './points-ledger.service';

const HOUR_MS = 3600_000;

/** 一条自动积分 */
export interface PointsAward {
  supplierId: string;
  ruleCode: PointsRuleCode;
  delta: number;
  inquiryId: string;
  roundId: string;
  /** 幂等键：<ruleCode>:<roundId>:<supplierId> */
  bizKey: string;
}

/** 开标结算要用的报价单字段（开标前的状态） */
export interface OpeningQuote {
  supplierId: string;
  status: QuoteStatus;
  invitedAt: Date;
  respondedAt: Date | null;
}

/**
 * 供应商积分的写入（A-10，M10 §2）：规则取系统参数 points.rules。开标结算（R10-4），M12 定标加 WON，
 * M15 的手工调整（R15-3）；积分报表与流水的查询在 PointsLedgerService
 */
@Injectable()
export class PointsService {
  constructor(
    private readonly params: ParamsService,
    private readonly clock: ClockService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: PointsLedgerService,
  ) {}

  /** 在调用方的事务里写入自动积分；bizKey 已存在的跳过（重复结算无副作用），分值为 0 的不写。返回写入条数 */
  async award(tx: Prisma.TransactionClient, entries: PointsAward[]): Promise<number> {
    const now = this.clock.now();
    const data = entries
      .filter((e) => e.delta !== 0)
      .map((e) => ({ ...e, source: 'AUTO' as const, createdAt: now }));
    if (data.length === 0) return 0;
    return (await tx.supplierPointsEntry.createMany({ data, skipDuplicates: true })).count;
  }

  /**
   * R10-4 开标结算：已提交的 +quoteOnTime，其中响应时长（respondedAt − invitedAt）不超过 fastResponseHours 小时的
   * 再 +fastResponse；未响应（INVITED）的 +noResponse（负数）；已拒绝的不加不减
   */
  async settleOpening(
    tx: Prisma.TransactionClient,
    round: { id: string; inquiryId: string },
    quotes: OpeningQuote[],
  ): Promise<number> {
    const rules = await this.params.get('points.rules');
    const entries: PointsAward[] = [];
    for (const q of quotes) {
      const add = (ruleCode: PointsRuleCode, delta: number) =>
        entries.push({
          supplierId: q.supplierId,
          ruleCode,
          delta,
          inquiryId: round.inquiryId,
          roundId: round.id,
          bizKey: `${ruleCode}:${round.id}:${q.supplierId}`,
        });
      if (q.status === QuoteStatus.SUBMITTED) {
        add('QUOTE_ON_TIME', rules.quoteOnTime);
        const responseMs = q.respondedAt ? q.respondedAt.getTime() - q.invitedAt.getTime() : Infinity;
        if (responseMs <= rules.fastResponseHours * HOUR_MS) add('FAST_RESPONSE', rules.fastResponse);
      } else if (q.status === QuoteStatus.INVITED) {
        add('NO_RESPONSE', rules.noResponse);
      }
    }
    return this.award(tx, entries);
  }

  /**
   * R15-3 手工调整：规则 MANUAL、来源 MANUAL，记操作人和备注（必填，POINTS_REMARK_REQUIRED）；审计记分值和备注。
   * 停用的供应商也可以调整（历史积分照样要能更正）。返回新的积分记录
   */
  async adjust(user: AuthUser, supplierId: string, input: PointsAdjustInput): Promise<PointsLedgerItemDto> {
    if (!input.remark) throw new AppException('POINTS_REMARK_REQUIRED');
    const entry = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, code: true, nameZh: true },
      });
      if (!supplier) throw new AppException('NOT_FOUND');
      const created = await tx.supplierPointsEntry.create({
        data: {
          supplierId,
          delta: input.delta,
          ruleCode: 'MANUAL',
          source: 'MANUAL',
          remark: input.remark,
          createdById: user.id,
          createdAt: this.clock.now(),
        },
        select: ledgerSelect,
      });
      await this.audit.log(
        {
          actor: user,
          action: 'supplier.pointsAdjust',
          entityType: 'supplier',
          entityId: supplierId,
          summary: `${supplier.code} ${supplier.nameZh} ${input.delta > 0 ? '+' : ''}${input.delta}`,
          detail: { delta: input.delta, remark: input.remark },
        },
        tx,
      );
      return created;
    });
    return (await this.ledger.toItems([entry]))[0];
  }
}
