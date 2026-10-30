import { PPL_V0, resolveColumns, type PortalLineDto } from '@quoteflow/shared';
import { describe, expect, it } from 'vitest';
import {
  defaultValues,
  errorMap,
  formatDecimalInput,
  formatIntInput,
  sheetLines,
  requiredProgress,
  sheetTotal,
  supplierValues,
  validateSheet,
} from './ppl';

const columns = resolveColumns(PPL_V0, 'PPL-PERIPH');
const line = (id: string, lineNo: number, quantity: string): PortalLineDto => ({
  id,
  lineNo,
  materialCode: null,
  nameZh: `透镜 ${lineNo}`,
  nameEn: `Lens ${lineNo}`,
  spec: 'Φ20',
  unitCode: 'PCS',
  quantity,
  brand: null,
  drawingRef: null,
  category: { code: 'PER-LENS', nameZh: '透镜', nameEn: 'Lens' },
  files: [],
});
const unitOf = () => ({ nameZh: '个', nameEn: 'pcs' });
const lines = sheetLines(
  [line('l1', 1, '1000'), line('l2', 2, '500')],
  columns,
  'CNY',
  'en-US',
  unitOf,
);

describe('PPL 表单工具（M09）', () => {
  it('R09-2 预填列取自询价行，名称类按语言取', () => {
    expect(lines[0].prefill).toMatchObject({
      line_no: 1,
      material_name: 'Lens 1',
      category_name: 'Lens',
      unit: 'pcs',
      quantity: '1000',
      currency: 'CNY',
    });
    const zh = sheetLines([line('l1', 1, '1000')], columns, 'CNY', 'zh-CN', unitOf);
    expect(zh[0].prefill).toMatchObject({ material_name: '透镜 1', unit: '个' });
  });

  it('R09-3 新草稿每行用默认值（税率 13）；合计 = 各行含税总价之和', () => {
    const values = defaultValues(columns, lines);
    expect(values).toEqual({ l1: { tax_rate: '13.00' }, l2: { tax_rate: '13.00' } });
    values.l1.unit_price_incl_tax = '1.13';
    values.l2.unit_price_incl_tax = '2.2';
    expect(sheetTotal(columns, lines, values)).toBe('2230.00');
  });

  it('R09-11 校验与后端一致：草稿只校验格式，提交还校验必填，错误按行号、列顺序', () => {
    const values = { l1: { unit_price_incl_tax: '1.123456', tax_rate: '13' }, l2: {} };
    expect(validateSheet(columns, lines, values, {}, 'draft').map((e) => [e.lineNo, e.key, e.code])).toEqual([
      [1, 'unit_price_incl_tax', 'too_many_decimals'],
    ]);
    const errors = validateSheet(columns, lines, values, {}, 'submit');
    expect(errors.map((e) => [e.lineNo, e.key, e.code])).toEqual([
      [1, 'material', 'required'],
      [1, 'unit_price_incl_tax', 'too_many_decimals'],
      [1, 'lead_time_days', 'required'],
      [2, 'material', 'required'],
      [2, 'unit_price_incl_tax', 'required'],
      [2, 'tax_rate', 'required'],
      [2, 'lead_time_days', 'required'],
    ]);
    expect(Object.keys(errorMap(errors).l2)).toEqual([
      'material',
      'unit_price_incl_tax',
      'tax_rate',
      'lead_time_days',
    ]);
  });

  it('必填进度、以版本取值为底时只保留供应商列', () => {
    expect(requiredProgress(columns, { tax_rate: '13.00', material: ' ', unit_price_incl_tax: '1' })).toEqual(
      {
        filled: 2,
        total: 4,
      },
    );
    expect(
      supplierValues(columns, { unit_price_incl_tax: '1.0000', total_price_incl_tax: '1000.00', line_no: 1 }),
    ).toEqual({ unit_price_incl_tax: '1.0000' });
  });

  it('输入框失焦时：小数补足位数（超了不四舍五入），整数字符串转数字', () => {
    expect(formatDecimalInput({ precision: 4 }, ' 1.5 ')).toBe('1.5000');
    expect(formatDecimalInput({ precision: 2 }, '1.234')).toBe('1.234');
    expect(formatDecimalInput({ precision: 2 }, 'abc')).toBe('abc');
    expect(formatIntInput(' 30 ')).toBe(30);
    expect(formatIntInput('3.5')).toBe('3.5');
  });
});
