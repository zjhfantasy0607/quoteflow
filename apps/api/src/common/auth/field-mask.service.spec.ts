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
});
