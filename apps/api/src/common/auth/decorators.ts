import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionCode, UserType } from '@quoteflow/shared';
import type { AuthUser, RequestWithUser } from './auth-user';

export const IS_PUBLIC_KEY = 'qf:isPublic';
export const USER_TYPES_KEY = 'qf:userTypes';
export const PERMISSIONS_KEY = 'qf:permissions';

/** 不需要登录 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 内部用户和供应商都可以访问（默认只允许内部用户） */
export const AnyUser = () => SetMetadata(USER_TYPES_KEY, ['INTERNAL', 'SUPPLIER'] satisfies UserType[]);

/** 只允许供应商（门户接口） */
export const SupplierOnly = () => SetMetadata(USER_TYPES_KEY, ['SUPPLIER'] satisfies UserType[]);

/**
 * 内部接口必须声明所需权限（全部满足）；只需登录的写空参数 @RequirePermissions()。
 * 内部接口漏写这个装饰器时 PermissionsGuard 会拒绝访问（fail closed）。
 */
export const RequirePermissions = (...codes: PermissionCode[]) => SetMetadata(PERMISSIONS_KEY, codes);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!req.user) throw new Error('CurrentUser used on a route without authentication');
  return req.user;
});
