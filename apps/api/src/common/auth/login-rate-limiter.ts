import { Injectable } from '@nestjs/common';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../errors/app.exception';

const WINDOW_MS = 60_000;
const LIMIT = 10;

/**
 * 登录、找回密码的限流：同一 IP 每分钟最多 10 次（R01-15）。
 * 单实例内存实现，用 ClockService 计时，测试可控。
 */
@Injectable()
export class LoginRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: ClockService) {}

  /** 记一次尝试，超限时抛 RATE_LIMITED */
  hit(ip: string | null): void {
    const key = ip ?? 'unknown';
    const now = this.clock.now().getTime();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= LIMIT) {
      this.hits.set(key, recent);
      throw new AppException('RATE_LIMITED');
    }
    recent.push(now);
    this.hits.set(key, recent);
  }

  /** 测试用：清空计数 */
  reset(): void {
    this.hits.clear();
  }
}
