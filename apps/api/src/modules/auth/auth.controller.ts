import { Body, Controller, Get, HttpCode, Module, Post, Put, Req, Res } from '@nestjs/common';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordWithTokenSchema,
  updateLocaleSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type MeDto,
  type ResetPasswordWithTokenInput,
  type UpdateLocaleInput,
} from '@quoteflow/shared';
import type { Request, Response } from 'express';
import { requestMeta, type AuthUser } from '../../common/auth/auth-user';
import { AnyUser, CurrentUser, Public } from '../../common/auth/decorators';
import { SessionService } from '../../common/auth/session.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeDto> {
    const { token, expiresAt, me } = await this.auth.login(body, requestMeta(req));
    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions(expiresAt));
    return me;
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.auth.forgotPassword(body, requestMeta(req));
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordWithTokenSchema)) body: ResetPasswordWithTokenInput,
  ): Promise<{ ok: true }> {
    await this.auth.resetPassword(body);
    return { ok: true };
  }

  @AnyUser()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    await this.auth.logout(user);
    res.clearCookie(this.sessions.cookieName, { path: '/' });
    return { ok: true };
  }

  @AnyUser()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }

  @AnyUser()
  @Put('me/locale')
  updateLocale(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateLocaleSchema)) body: UpdateLocaleInput,
  ): Promise<MeDto> {
    return this.auth.updateLocale(user, body.locale);
  }

  @AnyUser()
  @Put('me/password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(user, body);
    return { ok: true };
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
