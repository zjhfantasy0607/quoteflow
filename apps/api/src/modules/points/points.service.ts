import { Injectable, Module } from '@nestjs/common';
import { QuoteStatus, type PointsRuleCode } from '@quoteflow/shared';
import { ClockService } from '../../common/clock/clock.service';
import type { Prisma } from '../../generated/prisma/client';
import { ParamsService } from '../../infra/params/params.service';

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
 * M15 的手工调整和积分报表也放在 modules/points
 */
@Injectable()
export class PointsService {
  constructor(
    private readonly params: ParamsService,
    private readonly clock: ClockService,
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
}

@Module({
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
