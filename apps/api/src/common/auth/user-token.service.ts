import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../errors/app.exception';
import { hashToken } from './session.service';

export type UserTokenPurpose = 'ACTIVATE' | 'RESET_PASSWORD';

type Client = PrismaService | Prisma.TransactionClient;

/** 激活与重置密码的一次性令牌：数据库只存哈希，签发新令牌时作废旧令牌 */
@Injectable()
export class UserTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async issue(
    userId: string,
    purpose: UserTokenPurpose,
    ttlHours: number,
    client: Client = this.prisma,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = this.clock.now();
    await client.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);
    await client.userToken.create({ data: { userId, purpose, tokenHash: hashToken(token), expiresAt } });
    return { token, expiresAt };
  }

  /** 校验并消费令牌，返回用户 id；无效、过期、已用过都抛 AUTH_TOKEN_INVALID */
  async consume(token: string, purpose: UserTokenPurpose, client: Client = this.prisma): Promise<string> {
    const now = this.clock.now();
    const row = await client.userToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt.getTime() <= now.getTime()) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }
    const res = await client.userToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (res.count !== 1) throw new AppException('AUTH_TOKEN_INVALID');
    return row.userId;
  }
}
