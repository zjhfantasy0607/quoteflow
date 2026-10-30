import { PPL_V0, resolveColumns } from '@quoteflow/shared';
import { FieldMaskService } from './field-mask.service';

describe('FieldMaskService（R01-11）', () => {
  const mask = new FieldMaskService();
  const supplier = { id: 's1', contactName: '陈经理', contactEmail: 'a@b.com', contactPhone: '138', ccEmails: ['c@d.com'] };

  it('有字段权限时原样返回', () => {
    expect(mask.supplierContact(supplier, { fieldPermissions: new Set(['supplier.contact']) })).toBe(supplier);
  });

  it('没有字段权限时置空并记录 maskedFields，不修改原对象', () => {
    const out = mask.supplierContact(supplier, { fieldPermissions: new Set() });
    expect(out).toEqual({
      id: 's1',
      contactName: '陈经理',
      contactEmail: null,
      contactPhone: null,
      ccEmails: null,
      maskedFields: ['contactEmail', 'contactPhone', 'ccEmails'],
    });
    expect(supplier.contactEmail).toBe('a@b.com');
  });

  it('多次脱敏时合并 maskedFields', () => {
    const first = mask.mask({ a: 1, b: 2 }, { fieldPermissions: new Set() }, 'quote.amount', ['a']);
    const second = mask.mask(first, { fieldPermissions: new Set() }, 'contract.amount', ['b']);
    expect(second.maskedFields).toEqual(['a', 'b']);
  });

  describe('报价金额（S-5）', () => {
    const columns = resolveColumns(PPL_V0, 'PPL-LED');
    const version = {
      versionNo: 1,
      totalAmount: '2260.00',
      lines: [
        { lineId: 'l1', lineNo: 1, values: { unit_price_incl_tax: '1.1300', tax_rate: '13.00', moq: 100 } },
      ],
    };
    const none = { fieldPermissions: new Set<string>() };

    it('有 quote.amount 时原样返回', () => {
      const can = { fieldPermissions: new Set(['quote.amount']) };
      expect(mask.quoteVersion(version, columns, can)).toBe(version);
    });

    it('没有时合计和金额敏感列为 null（PPL-LED 排除了模具费，不在 maskedFields 里），其他列不动', () => {
      const out = mask.quoteVersion(version, columns, none);
      expect(out.totalAmount).toBeNull();
      expect(out.lines[0].values).toMatchObject({ unit_price_incl_tax: null, tax_rate: '13.00', moq: 100 });
      expect(out.maskedFields).toEqual([
        'totalAmount',
        'unit_price_incl_tax',
        'unit_price_excl_tax',
        'total_price_incl_tax',
        'tier1_price',
        'tier2_price',
        'sample_cost',
        'freight_cost',
      ]);
      expect(version.lines[0].values.unit_price_incl_tax).toBe('1.1300');
    });

    it('版本列表的一项（没有 lines）只脱敏合计', () => {
      const out = mask.quoteVersion({ versionNo: 1, totalAmount: '1.00' }, columns, none);
      expect(out).not.toHaveProperty('lines');
      expect(out.totalAmount).toBeNull();
    });
  });
});
