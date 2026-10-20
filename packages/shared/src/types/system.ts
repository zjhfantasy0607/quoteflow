import type { DataScope, EnableStatus, Locale, UserStatus, UserType } from '../enums';
import type { SENSITIVE_FIELDS } from '../field-permissions';
import type { PERMISSION_TREE } from '../permissions';

export interface RoleBriefDto {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
}

/** GET /api/auth/me */
export interface MeDto {
  user: {
    id: string;
    username: string;
    name: string;
    email: string | null;
    userType: UserType;
    locale: Locale;
    departmentCode: string | null;
    supplier: { id: string; code: string; nameZh: string; nameEn: string | null } | null;
  };
  roles: RoleBriefDto[];
  permissions: string[];
  fieldPermissions: string[];
  dataScope: DataScope;
}

export interface UserDto {
  id: string;
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  departmentCode: string | null;
  locale: Locale;
  status: UserStatus;
  roles: RoleBriefDto[];
  lastLoginAt: string | null;
  remark: string | null;
  createdAt: string;
}

export interface RoleDto extends RoleBriefDto {
  description: string | null;
  isPreset: boolean;
  forSupplier: boolean;
  dataScope: DataScope;
  permissions: string[];
  fieldPermissions: string[];
  userCount: number;
  updatedAt: string;
}

/** GET /api/system/permissions */
export interface PermissionCatalogDto {
  modules: typeof PERMISSION_TREE;
  fields: typeof SENSITIVE_FIELDS;
}

export interface DictItemDto {
  id: string;
  typeCode: string;
  code: string;
  nameZh: string;
  nameEn: string;
  sort: number;
  status: EnableStatus;
  remark: string | null;
}

/** GET /api/dicts?types=a,b */
export type DictMapDto = Record<string, DictItemDto[]>;
