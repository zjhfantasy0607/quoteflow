import { ERROR_CODES } from '@quoteflow/shared';
import { describe, expect, it } from 'vitest';
import enUS from './en-US';
import zhCN from './zh-CN';

function flatten(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v as object, `${prefix}${k}.`),
  );
}

describe('文案', () => {
  it('zh-CN 与 en-US 的键完全一致', () => {
    expect(flatten(enUS).sort()).toEqual(flatten(zhCN).sort());
  });

  it('每个错误码都有中英翻译', () => {
    for (const code of ERROR_CODES) {
      expect(zhCN.errors[code]).toBeTruthy();
      expect(enUS.errors[code]).toBeTruthy();
    }
  });

  it('文案里没有空字符串', () => {
    for (const messages of [zhCN, enUS]) {
      const values: string[] = [];
      const walk = (o: object) =>
        Object.values(o).forEach((v) => (typeof v === 'string' ? values.push(v) : walk(v as object)));
      walk(messages);
      expect(values.every((v) => v.trim().length > 0)).toBe(true);
    }
  });
});
