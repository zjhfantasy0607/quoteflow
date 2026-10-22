/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PPL_V0,
  PplError,
  applyFormulas,
  buildDraftDefaults,
  buildPrefillValues,
  cbm,
  exclTax,
  lineTotal,
  quoteTotal,
  resolveColumns,
  validateDefinition,
  validateQuoteValues,
  type PplDefinition,
  type PplDictLookup,
  type PplResolvedColumn,
} from '.';

const clone = (): PplDefinition => structuredClone(PPL_V0);
const column = (key: string) => {
  const found = PPL_V0.master.columns.find((c) => c.key === key);
  if (!found) throw new Error(key);
  return found;
};
const issuesOf = (def: unknown) => {
  const result = validateDefinition(def);
  return result.ok ? [] : result.issues;
};

describe('v0 定义', () => {
  it('与 docs/ppl-v0.json 内容一致', () => {
    const json = JSON.parse(readFileSync(resolve(__dirname, '../../../../docs/ppl-v0.json'), 'utf8'));
    expect(PPL_V0).toEqual(json);
  });

  it('列数与标记符合 04 §10', () => {
    const cols = PPL_V0.master.columns;
    const count = (pred: (c: (typeof cols)[number]) => boolean) => cols.filter(pred).length;
    expect(cols).toHaveLength(70);
    expect(count((c) => c.source === 'prefill')).toBe(9);
    expect(count((c) => c.source === 'supplier')).toBe(58);
    expect(count((c) => c.source === 'formula')).toBe(3);
    expect(count((c) => c.sensitive === true)).toBe(8);
    expect(count((c) => c.inMatrix === true)).toBe(15);
    expect(count((c) => c.keyField === true)).toBe(9);
    expect(count((c) => c.logistics === true)).toBe(13);
    expect(cols.filter((c) => c.required).map((c) => c.key)).toEqual([
      'unit_price_incl_tax',
      'tax_rate',
      'lead_time_days',
    ]);
  });
});

describe('validateDefinition', () => {
  it('R05-1 v0 校验通过', () => {
    expect(validateDefinition(PPL_V0)).toEqual({ ok: true, definition: PPL_V0 });
  });

  it('R05-1 结构错误带路径返回', () => {
    const def = clone() as unknown as {
      schemaVersion: number;
      master: { columns: Array<Record<string, unknown>> };
    };
    def.schemaVersion = 2;
    def.master.columns[0].type = 'number';
    def.master.columns[1].unknownField = true;
    const paths = issuesOf(def).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['schemaVersion', 'master.columns[0].type', 'master.columns[1]']),
    );
  });

  it('R05-1 重复列 key 报错', () => {
    const def = clone();
    def.master.columns[9].key = 'brand';
    def.master.columns[10].key = 'brand';
    expect(issuesOf(def)).toContainEqual({
      path: 'master.columns[10].key',
      message: 'duplicate column key "brand"',
    });
  });

  it('R05-1 变体排除主模板必填列报错', () => {
    const def = clone();
    def.variants[0].exclude.push('lead_time_days');
    expect(issuesOf(def)).toContainEqual({
      path: 'variants[0].exclude[3]',
      message: 'cannot exclude required column "lead_time_days"',
    });
  });

  it('R05-1 变体排除公式输入列、预填列、公式列报错', () => {
    const def = clone();
    def.variants[1].exclude.push('carton_l_cm', 'spec', 'carton_cbm');
    const messages = issuesOf(def).map((i) => i.message);
    expect(messages).toEqual([
      'cannot exclude formula input "carton_l_cm"',
      'cannot exclude prefill column "spec"',
      'cannot exclude formula column "carton_cbm"',
    ]);
  });

  it('R05-1 预填列缺 prefillFrom 报错', () => {
    const def = clone();
    delete def.master.columns[2].prefillFrom;
    expect(issuesOf(def)).toEqual([
      { path: 'master.columns[2].prefillFrom', message: 'prefill column requires prefillFrom' },
    ]);
  });

  it('R05-1 required 写在公式列上报错', () => {
    const def = clone();
    const index = def.master.columns.findIndex((c) => c.key === 'unit_price_excl_tax');
    def.master.columns[index].required = true;
    expect(issuesOf(def)).toEqual([
      { path: `master.columns[${index}].required`, message: 'required is only allowed on supplier columns' },
    ]);
  });

  it('R05-1 未注册公式、缺公式输入列、缺 precision / dictType、主模板缺核心列', () => {
    const def = clone();
    const cols = def.master.columns;
    const at = (key: string) => cols.findIndex((c) => c.key === key);
    cols[at('carton_cbm')].formula = 'volume';
    delete cols[at('certifications')].dictType;
    delete cols[at('power_w')].precision;
    cols[at('tax_rate')].required = false;
    const messages = issuesOf(def).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'unknown formula "volume"',
        'multiEnum column requires dictType',
        'decimal column requires precision',
        'column "tax_rate" must be a required supplier column',
      ]),
    );

    const noCarton = clone();
    noCarton.master.columns = noCarton.master.columns.filter((c) => c.key !== 'carton_w_cm');
    expect(issuesOf(noCarton).map((i) => i.message)).toContain('formula "cbm" requires column "carton_w_cm"');
  });

  it('R05-1 变体：重复代码、必填列不在变体里、默认值非法', () => {
    const def = clone();
    def.variants.push({ ...def.variants[0], code: 'PPL-LED' });
    def.variants[1].required.push('cct_k', 'spec');
    def.master.columns[def.master.columns.findIndex((c) => c.key === 'tax_rate')].default = '13.123';
    const messages = issuesOf(def).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'duplicate variant code "PPL-LED"',
        'column "cct_k" is not in this variant',
        'only supplier columns can be required, "spec" is prefill',
        'invalid default value',
      ]),
    );
  });
});

describe('resolveColumns', () => {
  it('R05-3 主模板 70 列，null 与 PPL-MASTER 相同', () => {
    expect(resolveColumns(PPL_V0, null)).toHaveLength(70);
    expect(resolveColumns(PPL_V0, 'PPL-MASTER')).toEqual(resolveColumns(PPL_V0, null));
  });

  it('R05-3 PPL-LED 67 列、PPL-PERIPH 66 列，必填合并，顺序与主模板一致', () => {
    const masterOrder = PPL_V0.master.columns.map((c) => c.key);
    for (const [code, size, excluded, required] of [
      [
        'PPL-LED',
        67,
        ['ip_rating', 'color_finish', 'tooling_cost'],
        ['power_w', 'cct_k', 'cri_ra', 'luminous_flux_lm'],
      ],
      ['PPL-PERIPH', 66, ['cct_k', 'cri_ra', 'luminous_flux_lm', 'efficacy_lm_w'], ['material']],
    ] as const) {
      const cols = resolveColumns(PPL_V0, code);
      const keys = cols.map((c) => c.key);
      expect(cols).toHaveLength(size);
      expect(keys).toEqual(masterOrder.filter((k) => !(excluded as readonly string[]).includes(k)));
      expect(cols.filter((c) => c.required).map((c) => c.key)).toEqual(
        masterOrder.filter((k) =>
          ['unit_price_incl_tax', 'tax_rate', 'lead_time_days', ...required].includes(k),
        ),
      );
    }
    // 不修改原定义
    expect(column('power_w').required).toBeUndefined();
  });

  it('R05-3 变体不存在抛 PPL_VARIANT_NOT_FOUND', () => {
    expect(() => resolveColumns(PPL_V0, 'PPL-NOPE')).toThrow(PplError);
    try {
      resolveColumns(PPL_V0, 'PPL-NOPE');
    } catch (e) {
      expect((e as PplError).code).toBe('PPL_VARIANT_NOT_FOUND');
    }
  });
});

describe('公式', () => {
  it('R05-4 exclTax 四舍五入到 4 位', () => {
    expect(exclTax('113.0000', '13')).toBe('100.0000');
    expect(exclTax('0.0850', '13')).toBe('0.0752');
    expect(exclTax('10', '0')).toBe('10.0000');
  });

  it('R05-4 lineTotal 用议价数量覆盖询价行数量', () => {
    const cols = resolveColumns(PPL_V0, null);
    const values = { unit_price_incl_tax: '1.2345', tax_rate: '13.00' };
    expect(applyFormulas(cols, values, { quantity: '1000' }).total_price_incl_tax).toBe('1234.50');
    expect(
      applyFormulas(cols, { ...values, quantity: '10' }, { quantity: '1000' }).total_price_incl_tax,
    ).toBe('12.35');
    expect(lineTotal('0.005', '1')).toBe('0.01');
  });

  it('R05-4 cbm 四舍五入，输入缺失返回空', () => {
    expect(cbm('45.5', '32.3', '28.7')).toBe('0.0422');
    expect(cbm('45.5', '32.3', null)).toBeNull();
    expect(exclTax('113', undefined)).toBeNull();
    expect(lineTotal('abc', '1')).toBeNull();
  });

  it('R05-4 applyFormulas 忽略客户端传来的公式列值，输入不全时去掉公式列', () => {
    const cols = resolveColumns(PPL_V0, null);
    const result = applyFormulas(cols, { unit_price_excl_tax: '999', carton_cbm: '1' }, { quantity: '5' });
    expect(result).toEqual({});
  });

  it('quoteTotal 合计各行含税总价', () => {
    expect(quoteTotal([{ total_price_incl_tax: '1234.50' }, { total_price_incl_tax: '0.25' }, {}])).toBe(
      '1234.75',
    );
    expect(quoteTotal([])).toBe('0.00');
  });
});

describe('validateQuoteValues', () => {
  const cols: PplResolvedColumn[] = resolveColumns(PPL_V0, 'PPL-LED');
  const dict: PplDictLookup = {
    certification: ['CE', 'UL', 'ROHS'],
    payment_terms: ['T30', 'T60'],
    packing_method: ['CARTON'],
    trade_term: ['FOB', 'EXW'],
  };
  const line = { id: 'l1', lineNo: 1, quantity: '1000.0000' };
  const run = (values: Record<string, unknown>, mode: 'draft' | 'submit' = 'draft', allowQuantity = false) =>
    validateQuoteValues(cols, [line], { l1: values }, dict, { mode, allowQuantity });
  const errorsOf = (values: Record<string, unknown>, mode: 'draft' | 'submit' = 'draft') =>
    run(values, mode).errors.map((e) => [e.key, e.code, e.params]);

  it('R05-5 每种类型的合法取值被规范化', () => {
    const { values, errors } = run({
      brand: '  Acme ',
      deviation_note: 'none',
      cct_k: '3000',
      cri_ra: 80,
      power_w: 0.5,
      unit_price_incl_tax: '1.13',
      tax_rate: '13',
      cert_expiry: '2027-02-28',
      rohs: true,
      payment_terms: 'T30',
      certifications: ['CE', 'UL', 'CE'],
    });
    expect(errors).toEqual([]);
    expect(values.l1).toEqual({
      brand: 'Acme',
      deviation_note: 'none',
      cct_k: 3000,
      cri_ra: 80,
      power_w: '0.50',
      unit_price_incl_tax: '1.1300',
      tax_rate: '13.00',
      unit_price_excl_tax: '1.0000',
      total_price_incl_tax: '1130.00',
      cert_expiry: '2027-02-28',
      rohs: true,
      payment_terms: 'T30',
      certifications: ['CE', 'UL'],
    });
  });

  it('R05-5 每种类型的非法取值报错', () => {
    expect(
      errorsOf({
        brand: 'x'.repeat(201),
        deviation_note: 123,
        cct_k: '30.5',
        cri_ra: 101,
        power_w: '1e3',
        unit_price_incl_tax: '-1',
        tax_rate: '101',
        cert_expiry: '2027-02-30',
        rohs: 'yes',
        payment_terms: 'T90',
        certifications: ['CE', 'XX'],
      }),
    ).toEqual([
      ['brand', 'too_long', { max: 200 }],
      ['deviation_note', 'invalid_text', undefined],
      ['power_w', 'invalid_number', undefined],
      ['cct_k', 'invalid_integer', undefined],
      ['cri_ra', 'too_large', { max: 100 }],
      ['certifications', 'invalid_option', { value: 'XX' }],
      ['rohs', 'invalid_bool', undefined],
      ['cert_expiry', 'invalid_date', undefined],
      ['unit_price_incl_tax', 'too_small', { min: 0 }],
      ['tax_rate', 'too_large', { max: 100 }],
      ['payment_terms', 'invalid_option', { value: 'T90' }],
    ]);
  });

  it('R05-5 超过 precision 的小数被拒，不偷偷四舍五入', () => {
    const { errors } = run({ unit_price_incl_tax: '1.23456' });
    expect(errors).toEqual([
      {
        lineId: 'l1',
        lineNo: 1,
        key: 'unit_price_incl_tax',
        code: 'too_many_decimals',
        params: { max: 4 },
        message: 'Line 1 "Unit Price (incl. tax)" allows at most 4 decimal places',
      },
    ]);
  });

  it('R05-5 未知 key、预填列、公式列、被排除的列被丢弃且不报错', () => {
    const { values, errors } = run({
      foo: 'bar',
      spec: 'x',
      quantity: '5',
      unit_price_excl_tax: '9',
      tooling_cost: '100',
    });
    expect(errors).toEqual([]);
    expect(values.l1).toEqual({});
  });

  it('R05-5 议价版本允许写 quantity，并用于计算总价', () => {
    const { values, errors } = run({ unit_price_incl_tax: '2', quantity: '5' }, 'draft', true);
    expect(errors).toEqual([]);
    expect(values.l1).toMatchObject({ quantity: '5.0000', total_price_incl_tax: '10.00' });
  });

  it('R05-5 必填只在提交模式校验（含变体合并的必填）', () => {
    expect(errorsOf({}, 'draft')).toEqual([]);
    expect(errorsOf({}, 'submit').map(([key, code]) => `${key}:${code}`)).toEqual([
      'power_w:required',
      'cct_k:required',
      'cri_ra:required',
      'luminous_flux_lm:required',
      'unit_price_incl_tax:required',
      'tax_rate:required',
      'lead_time_days:required',
    ]);
    expect(errorsOf({ brand: '   ', certifications: [] }, 'submit')).toHaveLength(7);
  });

  it('不在 lines 里的行被丢弃，缺取值的行按空行处理', () => {
    const result = validateQuoteValues(
      cols,
      [line, { id: 'l2', lineNo: 2, quantity: '1' }],
      { lx: {} },
      dict,
      {
        mode: 'draft',
      },
    );
    expect(Object.keys(result.values)).toEqual(['l1', 'l2']);
  });
});

describe('buildDraftDefaults', () => {
  it('取供应商列的默认值并规范化', () => {
    expect(buildDraftDefaults(resolveColumns(PPL_V0, null))).toEqual({ tax_rate: '13.00' });
  });
});

describe('buildPrefillValues', () => {
  const line = {
    lineNo: 2,
    materialCode: 'MAT-000001',
    nameZh: '灯珠 2835',
    nameEn: null,
    categoryNameZh: '2835 灯珠',
    categoryNameEn: '2835 SMD LED',
    spec: '2835 / 0.5W',
    unitNameZh: '个',
    unitNameEn: 'pcs',
    quantity: '1000.0000',
    drawingRef: null,
    currency: 'CNY',
  };

  it('名称类按语言取，英文为空回退中文；空值不写入', () => {
    const cols = resolveColumns(PPL_V0, null);
    expect(buildPrefillValues(cols, line, 'en-US')).toEqual({
      line_no: 2,
      material_code: 'MAT-000001',
      material_name: '灯珠 2835',
      category_name: '2835 SMD LED',
      spec: '2835 / 0.5W',
      unit: 'pcs',
      quantity: '1000.0000',
      currency: 'CNY',
    });
    expect(buildPrefillValues(cols, line, 'zh-CN')).toMatchObject({ category_name: '2835 灯珠', unit: '个' });
  });
});
