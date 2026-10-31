import { describe, expect, it } from 'vitest';
import { amountInChinese } from './rmb';

describe('amountInChinese', () => {
  it('整数金额写"整"，中间的零只写一个', () => {
    expect(amountInChinese('77000.00')).toBe('柒万柒仟元整');
    expect(amountInChinese('10.00')).toBe('壹拾元整');
    expect(amountInChinese('100010.50')).toBe('壹拾万零壹拾元伍角');
    expect(amountInChinese('120000000.00')).toBe('壹亿贰仟万元整');
    expect(amountInChinese('100000001')).toBe('壹亿零壹元整');
    expect(amountInChinese('0.00')).toBe('零元整');
  });

  it('角分：没有角时写"零"，只有分的小额不写"元"', () => {
    expect(amountInChinese('1005.07')).toBe('壹仟零伍元零柒分');
    expect(amountInChinese('3500.4')).toBe('叁仟伍佰元肆角');
    expect(amountInChinese('0.05')).toBe('伍分');
    expect(amountInChinese('78500.30')).toBe('柒万捌仟伍佰元叁角');
  });
});
