import { describe, expect, it } from 'vitest';
import {
  FIELD_PERMISSION_CODES,
  PERMISSION_CODES,
  PRESET_ROLES,
  SYSTEM_PARAMS,
  SYSTEM_PARAM_KEYS,
  isStrongPassword,
} from './index';

describe('权限树', () => {
  it('共 46 个权限码且不重复', () => {
    expect(PERMISSION_CODES).toHaveLength(46);
    expect(new Set(PERMISSION_CODES).size).toBe(46);
  });

  it('权限码格式为 模块:动作', () => {
    for (const code of PERMISSION_CODES) expect(code).toMatch(/^[a-z]+(:[a-zA-Z]+)+$/);
  });
});

describe('预置角色', () => {
  it('六个预置角色，权限码和字段码都合法', () => {
    expect(PRESET_ROLES.map((r) => r.code)).toEqual([
      'ADMIN',
      'PD',
      'BUYER',
      'PURCHASE_MANAGER',
      'CONTRACT_APPROVER',
      'SUPPLIER',
    ]);
    for (const role of PRESET_ROLES) {
      for (const p of role.permissions) expect(PERMISSION_CODES).toContain(p);
      for (const f of role.fieldPermissions) expect(FIELD_PERMISSION_CODES).toContain(f);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('采购主管包含采购员的全部权限，并且能审批、开标、定标', () => {
    const buyer = PRESET_ROLES.find((r) => r.code === 'BUYER')!;
    const manager = PRESET_ROLES.find((r) => r.code === 'PURCHASE_MANAGER')!;
    for (const p of buyer.permissions) expect(manager.permissions).toContain(p);
    expect(manager.permissions).toEqual(expect.arrayContaining(['inquiry:approve', 'inquiry:open', 'inquiry:award']));
    expect(buyer.permissions).not.toContain('inquiry:approve');
  });

  it('管理员拥有全部系统权限，供应商角色没有任何权限', () => {
    const admin = PRESET_ROLES.find((r) => r.code === 'ADMIN')!;
    expect(admin.permissions.filter((p) => p.startsWith('system:'))).toHaveLength(11);
    const supplier = PRESET_ROLES.find((r) => r.code === 'SUPPLIER')!;
    expect(supplier.permissions).toEqual([]);
    expect(supplier.forSupplier).toBe(true);
  });
});

describe('系统参数', () => {
  it('每个参数的默认值都能通过自己的校验', () => {
    for (const key of SYSTEM_PARAM_KEYS) {
      const def = SYSTEM_PARAMS[key];
      expect(def.schema.safeParse(def.defaultValue).success).toBe(true);
    }
  });
});

describe('密码规则', () => {
  it('至少 8 位且同时含字母和数字', () => {
    expect(isStrongPassword('Passw0rd!')).toBe(true);
    expect(isStrongPassword('password')).toBe(false);
    expect(isStrongPassword('12345678')).toBe(false);
    expect(isStrongPassword('Pa55')).toBe(false);
  });
});
