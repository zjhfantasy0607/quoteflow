import { Injectable } from '@nestjs/common';
import { RoundStatus } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app.exception';
import { ParamsService } from '../../infra/params/params.service';

/** 判断密封要用的轮次字段 */
export interface SealRound {
  status: RoundStatus;
  openedAt: Date | null;
}

/** 开过标：OPENED / EVALUATED，或开标后才被作废的轮次 */
export function isRoundOpened(round: SealRound): boolean {
  return (
    round.status === RoundStatus.OPENED || round.status === RoundStatus.EVALUATED || round.openedAt !== null
  );
}

/**
 * 开标前密封（05 §7.1、01 §8）：返回报价内容（取值、版本、合计、报价附件、版本备注与变更说明）的地方都经过它。
 * 开过标 → 可看，金额再按 quote.amount 脱敏（S-5）；其余（DRAFT / WAITING_QUOTES / QUOTES_CLOSED，
 * 以及从未开标就被作废的轮次，S-4）→ 只有角色在系统参数 seal.preOpenViewRoles 里的内部用户可看（S-2，默认没有人）。
 * 供应商不经过这里：门户只返回自己的报价（S-6）
 */
@Injectable()
export class SealService {
  constructor(private readonly params: ParamsService) {}

  async canViewQuoteContent(user: AuthUser, round: SealRound): Promise<boolean> {
    if (user.userType !== 'INTERNAL') return false;
    if (isRoundOpened(round)) return true;
    const roles = await this.params.get('seal.preOpenViewRoles');
    return user.roleCodes.some((code) => roles.includes(code));
  }

  /** 与 canViewQuoteContent 相同的判断，只读一次参数，返回逐轮判断的函数（报表一次处理很多轮次时用，M15） */
  async contentVisibility(user: AuthUser): Promise<(round: SealRound) => boolean> {
    if (user.userType !== 'INTERNAL') return () => false;
    const roles = await this.params.get('seal.preOpenViewRoles');
    const preOpen = user.roleCodes.some((code) => roles.includes(code));
    return (round) => preOpen || isRoundOpened(round);
  }

  /** 密封时 QUOTE_SEALED（403） */
  async assertCanViewQuoteContent(user: AuthUser, round: SealRound): Promise<void> {
    if (!(await this.canViewQuoteContent(user, round))) throw new AppException('QUOTE_SEALED');
  }
}
