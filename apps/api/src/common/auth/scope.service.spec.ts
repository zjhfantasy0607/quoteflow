import { ScopeService } from './scope.service';

describe('ScopeService.inquiryWhere（R01-10，05 §11）', () => {
  const scope = new ScopeService();
  const self = [{ ownerId: 'u1' }, { pdUserId: 'u1' }, { createdById: 'u1' }];

  it('ALL 不加限制', () => {
    expect(scope.inquiryWhere({ id: 'u1', dataScope: 'ALL', departmentCode: 'PURCHASE' })).toEqual({});
  });

  it('SELF 只看负责人、PD、创建人是自己的', () => {
    expect(scope.inquiryWhere({ id: 'u1', dataScope: 'SELF', departmentCode: 'PURCHASE' })).toEqual({ OR: self });
  });

  it('DEPT 看本部门的，以及自己相关的', () => {
    expect(scope.inquiryWhere({ id: 'u1', dataScope: 'DEPT', departmentCode: 'PURCHASE' })).toEqual({
      OR: [{ departmentCode: 'PURCHASE' }, ...self],
    });
  });

  it('DEPT 但没有部门时退化为 SELF', () => {
    expect(scope.inquiryWhere({ id: 'u1', dataScope: 'DEPT', departmentCode: null })).toEqual({ OR: self });
  });
});
