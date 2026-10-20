import { Global, Injectable, Module } from '@nestjs/common';

/**
 * 业务代码取"现在"的唯一入口（禁止直接 new Date() 取当前时间）。
 * 测试用 TestClock 替换；演示数据脚本可在非生产环境整体平移时钟。
 */
@Injectable()
export class ClockService {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  setOffset(ms: number): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Clock offset is not allowed in production');
    }
    this.offsetMs = ms;
  }
}

/** 可控时钟：固定在某一时刻，可前进 */
export class TestClock extends ClockService {
  private current: Date;

  constructor(start: Date = new Date('2026-11-02T01:00:00.000Z')) {
    super();
    this.current = new Date(start);
  }

  override now(): Date {
    return new Date(this.current);
  }

  set(date: Date | string): void {
    this.current = new Date(date);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceHours(hours: number): void {
    this.advance(hours * 3600_000);
  }
}

@Global()
@Module({
  providers: [ClockService],
  exports: [ClockService],
})
export class ClockModule {}
