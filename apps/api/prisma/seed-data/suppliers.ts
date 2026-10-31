// 供应商与门户账号（docs/06-种子数据.md §2.8），db:seed 与 e2e 测试共用。
// 只新增缺失的数据，不覆盖管理员已经修改过的内容。
import type { PrismaClient } from '../../src/generated/prisma/client';
import { DEV_PASSWORD } from './base';

interface SeedSupplier {
  code: string;
  nameZh: string;
  nameEn: string;
  categoryCode: string;
  mainCategories: string[];
  language: 'zh-CN' | 'en-US' | 'bilingual';
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  creditCode: string | null;
  /** 国家或地区、地址是虚构的（待确认事项 A-25） */
  country: string;
  address: string;
  enabled: boolean;
  /** 有门户账号（用联系邮箱登录，直接设为启用，跳过激活） */
  account: boolean;
}

export const SEED_SUPPLIERS: SeedSupplier[] = [
  {
    code: 'SUP10001',
    nameZh: '深圳华信光电科技有限公司',
    nameEn: 'Shenzhen Huaxin Optoelectronics Co., Ltd.',
    categoryCode: 'STRATEGIC',
    mainCategories: ['LED'],
    language: 'zh-CN',
    contactName: '陈经理',
    contactEmail: 'sales@huaxin.example.com',
    contactPhone: '0755-8888 0001',
    creditCode: '91440300MA5HX00001',
    country: '中国',
    address: '广东省深圳市宝安区福永街道示例工业区 A3 栋',
    enabled: true,
    account: true,
  },
  {
    code: 'SUP10002',
    nameZh: '上海卓越电子有限公司',
    nameEn: 'Shanghai Zhuoyue Electronics Co., Ltd.',
    categoryCode: 'EXCELLENT',
    mainCategories: ['PER-DRV'],
    language: 'bilingual',
    contactName: '刘工',
    contactEmail: 'bd@zhuoyue.example.com',
    contactPhone: '021-6666 0002',
    creditCode: '91310000MA1ZY00002',
    country: '中国',
    address: '上海市松江区九亭镇示例路 168 号',
    enabled: true,
    account: true,
  },
  {
    code: 'SUP10003',
    nameZh: '江苏新能材料科技有限公司',
    nameEn: 'Jiangsu Xinneng Materials Co., Ltd.',
    categoryCode: 'EXCELLENT',
    mainCategories: ['PER-HS', 'PER-BRKT'],
    language: 'zh-CN',
    contactName: '孙经理',
    contactEmail: 'sales@xinneng.example.com',
    contactPhone: '025-5555 0003',
    creditCode: '91320000MA1XN00003',
    country: '中国',
    address: '江苏省南京市江宁区秣陵街道示例路 66 号',
    enabled: true,
    account: true,
  },
  {
    code: 'SUP10004',
    nameZh: '浙江精工制造有限公司',
    nameEn: 'Zhejiang Jinggong Manufacturing Co., Ltd.',
    categoryCode: 'NORMAL',
    mainCategories: ['PER-BRKT', 'PER-CONN'],
    language: 'zh-CN',
    contactName: '周经理',
    contactEmail: 'info@jinggong.example.com',
    contactPhone: '0571-7777 0004',
    creditCode: '91330000MA2JG00004',
    country: '中国',
    address: '浙江省杭州市余杭区仁和街道示例工业园 18 号',
    enabled: true,
    account: true,
  },
  {
    code: 'SUP10005',
    nameZh: '广州联创光学有限公司',
    nameEn: 'Guangzhou Lianchuang Optics Co., Ltd.',
    categoryCode: 'STRATEGIC',
    mainCategories: ['PER-LENS', 'PER-REFL'],
    language: 'zh-CN',
    contactName: '吴经理',
    contactEmail: 'sales@lianchuang.example.com',
    contactPhone: '020-3333 0005',
    creditCode: '91440100MA5LC00005',
    country: '中国',
    address: '广东省广州市番禺区石碁镇示例路 9 号',
    enabled: true,
    account: true,
  },
  {
    code: 'SUP10006',
    nameZh: '明源照明（香港）有限公司',
    nameEn: 'Bright Source Lighting (HK) Ltd.',
    categoryCode: 'EXCELLENT',
    mainCategories: ['LED', 'PER-DRV'],
    language: 'en-US',
    contactName: 'Kevin Wong',
    contactEmail: 'kevin@brightsource.example.com',
    contactPhone: '+852 2888 0006',
    creditCode: null,
    country: 'Hong Kong, China',
    address: 'Room 1802, 18/F, Example Centre, 88 Example Road, Kwun Tong, Kowloon, Hong Kong',
    enabled: true,
    account: true,
  },
  {
    code: 'SUP10007',
    nameZh: '山东海纳线缆有限公司',
    nameEn: 'Shandong Haina Cable Co., Ltd.',
    categoryCode: 'NORMAL',
    mainCategories: ['PER-WIRE'],
    language: 'zh-CN',
    contactName: '郑经理',
    contactEmail: 'sales@haina.example.com',
    contactPhone: '0531-2222 0007',
    creditCode: '91370000MA3HN00007',
    country: '中国',
    address: '山东省济南市历城区示例路 2008 号',
    enabled: false,
    account: false,
  },
  {
    code: 'SUP10008',
    nameZh: '北欧驱动方案有限公司',
    nameEn: 'Nordic Driver Solutions AB',
    categoryCode: 'NORMAL',
    mainCategories: ['PER-DRV'],
    language: 'en-US',
    contactName: 'Erik Larsson',
    contactEmail: 'erik@nordicdriver.example.com',
    contactPhone: '+46 8 555 0008',
    creditCode: null,
    country: 'Sweden',
    address: 'Examplegatan 12, 111 43 Stockholm, Sweden',
    // 没有门户账号，用来演示"开通门户账号"
    enabled: true,
    account: false,
  },
];

/** 需要先有供应商分类字典、材料分类和 SUPPLIER 角色 */
export async function seedSuppliers(
  prisma: PrismaClient,
  hashPassword: (password: string) => Promise<string>,
): Promise<void> {
  const categories = await prisma.materialCategory.findMany({ select: { id: true, code: true } });
  const categoryId = new Map(categories.map((c) => [c.code, c.id]));
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPPLIER' } });
  const passwordHash = await hashPassword(DEV_PASSWORD);

  for (const s of SEED_SUPPLIERS) {
    const supplier = await prisma.supplier.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        nameZh: s.nameZh,
        nameEn: s.nameEn,
        creditCode: s.creditCode,
        country: s.country,
        address: s.address,
        categoryCode: s.categoryCode,
        contactName: s.contactName,
        contactEmail: s.contactEmail,
        contactPhone: s.contactPhone,
        ccEmails: [],
        preferredLanguage: s.language,
        status: s.enabled ? 'ENABLED' : 'DISABLED',
        materialCategories: {
          create: s.mainCategories.map((code) => ({ categoryId: categoryId.get(code)! })),
        },
      },
      update: {},
    });
    // 已有的供应商只补空着的国家或地区、地址，不覆盖管理员改过的内容
    await prisma.supplier.updateMany({
      where: { id: supplier.id, country: null },
      data: { country: s.country },
    });
    await prisma.supplier.updateMany({
      where: { id: supplier.id, address: null },
      data: { address: s.address },
    });
    if (!s.account) continue;
    const exists = await prisma.user.findUnique({ where: { username: s.contactEmail } });
    if (exists) continue;
    await prisma.user.create({
      data: {
        username: s.contactEmail,
        email: s.contactEmail,
        passwordHash,
        name: s.contactName,
        userType: 'SUPPLIER',
        status: 'ACTIVE',
        locale: s.language === 'en-US' ? 'en-US' : 'zh-CN',
        supplierId: supplier.id,
        roles: { create: [{ roleId: role.id }] },
      },
    });
  }
  // 自动编码从 SUP10009 开始（编码 = SUP + 10000 + 序列值，序列值 8 对应 SUP10008）
  const last = SEED_SUPPLIERS.length;
  await prisma.$executeRaw`
    INSERT INTO "Sequence" ("key", "value") VALUES ('SUP', ${last})
    ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Sequence"."value", ${last})`;
}
