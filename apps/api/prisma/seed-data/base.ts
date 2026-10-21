// 基础数据定义（docs/06-种子数据.md §2），db:seed 与 e2e 测试共用。
// 只新增缺失的数据，不覆盖管理员已经修改过的内容。
import { PRESET_ROLES } from '@quoteflow/shared';
import type { PrismaClient } from '../../src/generated/prisma/client';

export const DEV_PASSWORD = 'Passw0rd!';

export async function seedRoles(prisma: PrismaClient): Promise<void> {
  for (const r of PRESET_ROLES) {
    await prisma.role.upsert({
      where: { code: r.code },
      create: {
        code: r.code,
        nameZh: r.nameZh,
        nameEn: r.nameEn,
        description: r.description,
        isPreset: true,
        forSupplier: r.forSupplier,
        dataScope: r.dataScope,
        permissions: [...r.permissions],
        fieldPermissions: [...r.fieldPermissions],
      },
      // 已存在时只保证预置标记，不覆盖管理员调整过的权限
      update: { isPreset: true, forSupplier: r.forSupplier },
    });
  }
}

type DictSeed = { code: string; nameZh: string; nameEn: string; items: [string, string, string][] };

export const SYSTEM_DICTS: DictSeed[] = [
  {
    code: 'department',
    nameZh: '部门',
    nameEn: 'Department',
    items: [
      ['PURCHASE', '采购部', 'Purchasing'],
      ['PRODUCT', '产品部', 'Product Development'],
      ['GM', '总经办', 'General Management'],
      ['IT', '信息部', 'IT'],
    ],
  },
  {
    code: 'supplier_category',
    nameZh: '供应商分类',
    nameEn: 'Supplier Category',
    items: [
      ['STRATEGIC', '战略供应商', 'Strategic'],
      ['EXCELLENT', '优秀供应商', 'Preferred'],
      ['NORMAL', '普通供应商', 'Standard'],
    ],
  },
  {
    code: 'unit',
    nameZh: '单位',
    nameEn: 'Unit',
    items: [
      ['PCS', '个', 'pcs'],
      ['SET', '套', 'set'],
      ['M', '米', 'm'],
      ['ROLL', '卷', 'roll'],
      ['REEL', '盘', 'reel'],
      ['KG', '千克', 'kg'],
      ['BOX', '盒', 'box'],
    ],
  },
  {
    code: 'currency',
    nameZh: '币种',
    nameEn: 'Currency',
    items: [
      ['CNY', '人民币', 'CNY'],
      ['USD', '美元', 'USD'],
      ['HKD', '港币', 'HKD'],
    ],
  },
  {
    code: 'certification',
    nameZh: '认证',
    nameEn: 'Certification',
    items: [
      ['CE', 'CE 认证', 'CE'],
      ['UL', 'UL 认证', 'UL'],
      ['CCC', 'CCC 认证', 'CCC'],
      ['ETL', 'ETL 认证', 'ETL'],
      ['SAA', 'SAA 认证', 'SAA'],
    ],
  },
  {
    code: 'decline_reason',
    nameZh: '拒绝原因',
    nameEn: 'Decline Reason',
    items: [
      ['CAPACITY', '产能不足', 'Insufficient capacity'],
      ['PRICE', '价格无法满足', 'Price not competitive'],
      ['SPEC', '规格无法满足', 'Cannot meet specification'],
      ['LEAD_TIME', '交期无法满足', 'Cannot meet lead time'],
      ['OTHER', '其他', 'Other'],
    ],
  },
  {
    code: 'payment_terms',
    nameZh: '付款条件',
    nameEn: 'Payment Terms',
    items: [
      ['NET30', '货到验收后 30 天付款', 'Net 30 after acceptance'],
      ['NET60', '货到验收后 60 天付款', 'Net 60 after acceptance'],
      ['PREPAY30', '预付 30%，发货前付清', '30% deposit, balance before shipment'],
      ['LC', '信用证', 'Letter of Credit'],
    ],
  },
  {
    code: 'trade_term',
    nameZh: '贸易条款',
    nameEn: 'Trade Term',
    items: [
      ['EXW', '工厂交货', 'EXW'],
      ['FOB', '离岸价', 'FOB'],
      ['CIF', '到岸价', 'CIF'],
      ['DAP', '目的地交货', 'DAP'],
      ['DDP', '完税后交货', 'DDP'],
    ],
  },
  {
    code: 'packing_method',
    nameZh: '包装方式',
    nameEn: 'Packing Method',
    items: [
      ['CARTON', '纸箱', 'Carton'],
      ['REEL', '卷盘', 'Reel'],
      ['TRAY', '吸塑托盘', 'Blister Tray'],
      ['BAG', '袋装', 'Bag'],
    ],
  },
];

export async function seedDicts(prisma: PrismaClient): Promise<void> {
  for (const type of SYSTEM_DICTS) {
    await prisma.dictType.upsert({
      where: { code: type.code },
      create: { code: type.code, nameZh: type.nameZh, nameEn: type.nameEn, isSystem: true },
      update: { isSystem: true },
    });
    for (const [index, [code, nameZh, nameEn]] of type.items.entries()) {
      await prisma.dictItem.upsert({
        where: { typeCode_code: { typeCode: type.code, code } },
        create: { typeCode: type.code, code, nameZh, nameEn, sort: index + 1 },
        update: {},
      });
    }
  }
}

export const INTERNAL_USERS: {
  username: string;
  name: string;
  role: string;
  department: string;
  email: string;
  locale: 'zh-CN' | 'en-US';
}[] = [
  { username: 'admin', name: '系统管理员', role: 'ADMIN', department: 'IT', email: 'admin@example.com', locale: 'zh-CN' },
  { username: 'pd.wang', name: '王工', role: 'PD', department: 'PRODUCT', email: 'pd.wang@example.com', locale: 'zh-CN' },
  {
    username: 'buyer.zhang',
    name: '张三',
    role: 'BUYER',
    department: 'PURCHASE',
    email: 'buyer.zhang@example.com',
    locale: 'zh-CN',
  },
  { username: 'buyer.li', name: '李四', role: 'BUYER', department: 'PURCHASE', email: 'buyer.li@example.com', locale: 'en-US' },
  {
    username: 'manager.zhang',
    name: '张伟',
    role: 'PURCHASE_MANAGER',
    department: 'PURCHASE',
    email: 'manager.zhang@example.com',
    locale: 'zh-CN',
  },
  {
    username: 'approver.zhao',
    name: '赵六',
    role: 'CONTRACT_APPROVER',
    department: 'GM',
    email: 'approver.zhao@example.com',
    locale: 'zh-CN',
  },
];

export async function seedInternalUsers(
  prisma: PrismaClient,
  hashPassword: (password: string) => Promise<string>,
): Promise<void> {
  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const u of INTERNAL_USERS) {
    const exists = await prisma.user.findUnique({ where: { username: u.username } });
    if (exists) continue;
    const role = await prisma.role.findUniqueOrThrow({ where: { code: u.role } });
    await prisma.user.create({
      data: {
        username: u.username,
        passwordHash,
        name: u.name,
        email: u.email,
        departmentCode: u.department,
        locale: u.locale,
        userType: 'INTERNAL',
        status: 'ACTIVE',
        roles: { create: [{ roleId: role.id }] },
      },
    });
  }
}
