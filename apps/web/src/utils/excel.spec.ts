import { beforeAll, describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { importErrorView } from './excel';

describe('标准 Excel 导入的错误展示（R02-9）', () => {
  beforeAll(() => {
    i18n.global.locale.value = 'zh-CN';
  });

  it('R02-9 表头不一致：列出缺少的列、多余的列和顺序问题', () => {
    const view = importErrorView({
      code: 'EXCEL_HEADER_MISMATCH',
      message: 'Header mismatch',
      details: {
        expected: ['名称 / Name', '规格 / Spec'],
        actual: ['规格 / Spec', '单位'],
        missing: ['名称 / Name'],
        extra: ['单位'],
        orderMismatch: true,
      },
    });
    expect(view).toEqual({
      kind: 'header',
      missing: ['名称 / Name'],
      extra: ['单位'],
      orderMismatch: true,
      expected: ['名称 / Name', '规格 / Spec'],
    });
  });

  it('R02-9 行错误：按错误码翻译并带参数，未翻译的显示后端原文，总数取 params.count', () => {
    const view = importErrorView({
      code: 'EXCEL_ROWS_INVALID',
      message: 'Rows invalid',
      params: { count: 250 },
      details: [
        { row: 3, column: '名称 / Name', code: 'required', message: 'Required' },
        { row: 4, column: '单价 / Price', code: 'too_many_decimals', message: 'Too many decimals', params: { max: 4 } },
        { row: 5, column: '分类 / Category', code: 'unknown_category', message: 'Unknown category' },
      ],
    });
    expect(view).toEqual({
      kind: 'rows',
      total: 250,
      rows: [
        { row: 3, column: '名称 / Name', message: '必填' },
        { row: 4, column: '单价 / Price', message: '小数不能超过 4 位' },
        { row: 5, column: '分类 / Category', message: 'Unknown category' },
      ],
    });
  });

  it('其他错误显示错误码的翻译', () => {
    expect(importErrorView({ code: 'EXCEL_TOO_MANY_ROWS', message: 'Too many rows', params: { max: 5000 } })).toEqual({
      kind: 'other',
      message: '数据超过 5000 行，请分批导入',
    });
  });
});
