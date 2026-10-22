import type { EnableStatus, Locale, SupplierLanguage, UserStatus } from '../enums';
import type { MaterialCategoryBriefDto } from './materials';

/** 供应商（列表与详情共用） */
export interface SupplierDto {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string | null;
  creditCode: string | null;
  /** 字典 supplier_category */
  categoryCode: string;
  /** 主营材料分类，按编码排序 */
  materialCategories: MaterialCategoryBriefDto[];
  contactName: string;
  /** 联系邮箱、联系电话、抄送邮箱：没有 supplier.contact 字段权限时为 null，并列在 maskedFields 里（R04-7） */
  contactEmail: string | null;
  contactPhone: string | null;
  ccEmails: string[] | null;
  preferredLanguage: SupplierLanguage;
  country: string | null;
  address: string | null;
  remark: string | null;
  status: EnableStatus;
  createdAt: string;
  updatedAt: string;
  maskedFields?: string[];
}

/** 门户账号（供应商用户） */
export interface SupplierAccountDto {
  id: string;
  /** 登录账号，即邮箱；没有 supplier.contact 字段权限时 username、email 为 null */
  username: string | null;
  email: string | null;
  name: string;
  status: UserStatus;
  locale: Locale;
  lastLoginAt: string | null;
  /** 待激活时，最近一次发出的激活链接的过期时间 */
  activationExpiresAt: string | null;
  createdAt: string;
  maskedFields?: string[];
}
