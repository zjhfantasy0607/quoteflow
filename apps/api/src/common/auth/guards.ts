import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserType } from '@quoteflow/shared';
import type { Response } from 'express';
import { AppException } from '../errors/app.exception';
import { requestMeta, type RequestWithUser } from './auth-user';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, USER_TYPES_KEY } from './decorators';
import { buildAuthUser, isUserUsable, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isPublic(reflector: Reflector, ctx: ExecutionContext): boolean {
  return reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]) === true;
}

function allowedUserTypes(reflector: Reflector, ctx: ExecutionContext): UserType[] {
  return reflector.getAllAndOverride<UserType[]>(USER_TYPES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? ['INTERNAL'];
}

/** 非 GET 请求必须带 X-Requested-With（配合 SameSite=Lax 防 CSRF，R01-4），公开接口也校验 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.get('x-requested-with') !== 'XMLHttpRequest') throw new AppException('CSRF_REJECTED');
    return true;
  }
}

/** 从 cookie 解析会话，每次实时加载用户、角色、权限（R01-3、R01-5） */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[this.sessions.cookieName];
    if (!token) throw new AppException('UNAUTHENTICATED');

    const session = await this.sessions.resolve(token);
    if (!session) throw new AppException('UNAUTHENTICATED');
    if (!isUserUsable(session.user)) {
      await this.sessions.revoke(session.id);
      throw new AppException('UNAUTHENTICATED');
    }

    const renewedUntil = await this.sessions.renewIfNeeded(session);
    if (renewedUntil) {
      ctx
        .switchToHttp()
        .getResponse<Response>()
        .cookie(this.sessions.cookieName, token, this.sessions.cookieOptions(renewedUntil));
    }
    req.user = buildAuthUser(session.user, session.id, requestMeta(req));
    return true;
  }
}

/** 用户类型：默认只放行内部用户；@AnyUser / @SupplierOnly 改变规则 */
@Injectable()
export class UserTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (isPublic(this.reflector, ctx)) return true;
    const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user || !allowedUserTypes(this.reflector, ctx).includes(user.userType)) {
      throw new AppException('FORBIDDEN');
    }
    return true;
  }
}

/** 功能权限：内部接口必须声明 @RequirePermissions，漏写时拒绝访问 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (isPublic(this.reflector, ctx)) return true;
    const user = ctx.switchToHttp().getRequest<RequestWithUser>().user!;
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required === undefined) {
      // 供应商接口与通用接口不需要功能权限；内部专用接口漏写装饰器 → 拒绝
      if (allowedUserTypes(this.reflector, ctx).includes('SUPPLIER')) return true;
      this.logger.error(`Missing @RequirePermissions on ${ctx.getClass().name}.${ctx.getHandler().name}`);
      throw new AppException('FORBIDDEN');
    }
    if (!required.every((code) => user.permissions.has(code))) throw new AppException('FORBIDDEN');
    return true;
  }
}
