import type { DataScope, Locale, UserType } from '@quoteflow/shared';
import type { Request } from 'express';

/** 当前请求的用户（SessionAuthGuard 每次从数据库实时构建，权限变更立即生效） */
export interface AuthUser {
  id: string;
  username: string;
  name: string;
  userType: UserType;
  locale: Locale;
  supplierId: string | null;
  departmentCode: string | null;
  roleCodes: string[];
  permissions: ReadonlySet<string>;
  fieldPermissions: ReadonlySet<string>;
  dataScope: DataScope;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
}

export type RequestWithUser = Request & { user?: AuthUser };

/** 请求来源信息（登录等未认证场景使用） */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 300) ?? null };
}
