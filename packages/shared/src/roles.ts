// 预置角色（docs/05-状态机与权限.md §12），seed 与测试共用。
import type { DataScope } from './enums';
import { FIELD_PERMISSION_CODES, type FieldPermissionCode } from './field-permissions';
import { PERMISSION_CODES, type PermissionCode } from './permissions';

export interface PresetRole {
  code: string;
  nameZh: string;
  nameEn: string;
  description: string;
  forSupplier: boolean;
  dataScope: DataScope;
  permissions: PermissionCode[];
  fieldPermissions: FieldPermissionCode[];
}

const byPrefix = (prefix: string): PermissionCode[] => PERMISSION_CODES.filter((c) => c.startsWith(prefix));

const BUYER_PERMISSIONS: PermissionCode[] = [
  'inquiry:view',
  'inquiry:create',
  'inquiry:spec',
  'inquiry:submit',
  'inquiry:invite',
  'inquiry:publish',
  'inquiry:remind',
  'inquiry:deadline',
  'inquiry:evaluate',
  'inquiry:changeSpec',
  'inquiry:export',
  'inquiry:accessLog',
  'supplier:view',
  'supplier:manage',
  'supplier:import',
  'supplier:export',
  'supplier:account',
  'material:view',
  'material:manage',
  'material:import',
  'material:export',
  'contract:view',
  'contract:edit',
  'stats:view',
  'report:view',
];

export const PRESET_ROLES: readonly PresetRole[] = [
  {
    code: 'ADMIN',
    nameZh: '系统管理员',
    nameEn: 'Administrator',
    description: '维护账号、角色权限、数据字典、系统参数与主数据',
    forSupplier: false,
    dataScope: 'ALL',
    permissions: [
      ...byPrefix('system:'),
      ...byPrefix('supplier:'),
      ...byPrefix('material:'),
      'inquiry:view',
      'contract:view',
      'stats:view',
      'report:view',
      'report:export',
      'points:adjust',
    ],
    fieldPermissions: ['supplier.contact'],
  },
  {
    code: 'PD',
    nameZh: '产品开发',
    nameEn: 'Product Development',
    description: '建询价草稿、上传规格书和产品图、发起规格变更',
    forSupplier: false,
    dataScope: 'SELF',
    permissions: [
      'inquiry:view',
      'inquiry:create',
      'inquiry:spec',
      'inquiry:submit',
      'inquiry:changeSpec',
      'material:view',
    ],
    fieldPermissions: [],
  },
  {
    code: 'BUYER',
    nameZh: '采购员',
    nameEn: 'Buyer',
    description: '建询价、邀请供应商、发布、催报、比价议价、维护供应商与材料',
    forSupplier: false,
    dataScope: 'SELF',
    permissions: BUYER_PERMISSIONS,
    fieldPermissions: [...FIELD_PERMISSION_CODES],
  },
  {
    code: 'PURCHASE_MANAGER',
    nameZh: '采购主管',
    nameEn: 'Purchasing Manager',
    description: '审批询价单、开标、定标、取消询价、审核合同',
    forSupplier: false,
    dataScope: 'ALL',
    permissions: [
      ...BUYER_PERMISSIONS,
      'inquiry:approve',
      'inquiry:open',
      'inquiry:award',
      'inquiry:cancel',
      'contract:review',
      'report:export',
      'points:adjust',
      'supplier:category:manage',
      'material:category:manage',
    ],
    fieldPermissions: [...FIELD_PERMISSION_CODES],
  },
  {
    code: 'CONTRACT_APPROVER',
    nameZh: '合同批准人',
    nameEn: 'Contract Approver',
    description: '批准采购合同',
    forSupplier: false,
    dataScope: 'ALL',
    permissions: ['inquiry:view', 'contract:view', 'contract:approve', 'stats:view', 'report:view'],
    fieldPermissions: ['quote.amount', 'contract.amount'],
  },
  {
    code: 'SUPPLIER',
    nameZh: '供应商',
    nameEn: 'Supplier',
    description: '供应商门户账号（权限固定，按用户类型放行门户接口）',
    forSupplier: true,
    dataScope: 'SELF',
    permissions: [],
    fieldPermissions: [],
  },
];

export const SUPPLIER_ROLE_CODE = 'SUPPLIER';

export const DATA_SCOPE_RANK: Record<DataScope, number> = { SELF: 0, DEPT: 1, ALL: 2 };
