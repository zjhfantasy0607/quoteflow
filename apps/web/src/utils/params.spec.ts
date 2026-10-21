import { SYSTEM_PARAM_KEYS } from '@quoteflow/shared';
import { describe, expect, it } from 'vitest';
import enUS from '@/locales/en-US';
import zhCN from '@/locales/zh-CN';
import { describeParam, paramI18nKey } from './params';

describe('系统参数表单（由 shared 的 zod schema 推出）', () => {
  it('数字字段带上下限和整数标记', () => {
    expect(describeParam('security.sessionHours')).toEqual([
      { kind: 'number', field: null, min: 1, max: 720, integer: true },
    ]);
    expect(describeParam('upload.limits').map((f) => f.field)).toEqual([
      'specDocMaxMB',
      'imageMaxMB',
      'attachmentMaxMB',
      'imagesPerLine',
    ]);
    expect(describeParam('points.rules')[0]).toEqual({
      kind: 'number',
      field: 'quoteOnTime',
      min: -100,
      max: 100,
      integer: true,
    });
  });

  it('开关、文本、角色列表', () => {
    expect(describeParam('notify.sendResultToLosers')).toEqual([{ kind: 'boolean', field: null }]);
    expect(describeParam('company.profile')[0]).toEqual({ kind: 'text', field: 'nameZh', maxLength: 100 });
    expect(describeParam('seal.preOpenViewRoles')).toEqual([{ kind: 'stringList', field: null }]);
  });

  it('每个参数都能生成表单，并且标题和字段标签中英齐全（新增参数忘了写文案会在这里失败）', () => {
    for (const key of SYSTEM_PARAM_KEYS) {
      const k = paramI18nKey(key);
      for (const messages of [zhCN, enUS]) {
        const titles = messages.system.params.titles as Record<string, string>;
        const fields = messages.system.params.fields as Record<string, Record<string, string>>;
        expect(titles[k], `${key} title`).toBeTruthy();
        for (const f of describeParam(key)) {
          if (f.field) expect(fields[k]?.[f.field], `${key}.${f.field} label`).toBeTruthy();
        }
      }
    }
  });
});
