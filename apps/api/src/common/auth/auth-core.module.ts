import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FieldMaskService } from './field-mask.service';
import { CsrfGuard, PermissionsGuard, SessionAuthGuard, UserTypeGuard } from './guards';
import { LoginRateLimiter } from './login-rate-limiter';
import { ScopeService } from './scope.service';
import { SessionService } from './session.service';
import { UserTokenService } from './user-token.service';

/**
 * 认证与权限的基础设施。全局守卫按注册顺序执行：
 * CsrfGuard → SessionAuthGuard → UserTypeGuard → PermissionsGuard
 */
@Global()
@Module({
  providers: [
    SessionService,
    ScopeService,
    FieldMaskService,
    LoginRateLimiter,
    UserTokenService,
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: UserTypeGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [SessionService, ScopeService, FieldMaskService, LoginRateLimiter, UserTokenService],
})
export class AuthCoreModule {}
