import { ClockService, TestClock } from './clock.service';

describe('ClockService', () => {
  it('TestClock 可以设置与前进', () => {
    const clock = new TestClock(new Date('2026-11-02T00:00:00.000Z'));
    clock.advanceHours(25);
    expect(clock.now().toISOString()).toBe('2026-11-03T01:00:00.000Z');
  });

  it('生产环境禁止平移时钟', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new ClockService().setOffset(1000)).toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
