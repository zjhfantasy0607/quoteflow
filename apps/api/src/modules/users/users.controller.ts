import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import {
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  userListQuerySchema,
  userStatusSchema,
  type CreateUserInput,
  type Paginated,
  type ResetPasswordInput,
  type UpdateUserInput,
  type UserDto,
  type UserListQuery,
  type UserStatusInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller('system/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions('system:user:view')
  @Get()
  list(@Query(new ZodValidationPipe(userListQuerySchema)) query: UserListQuery): Promise<Paginated<UserDto>> {
    return this.users.list(query);
  }

  @RequirePermissions('system:user:view')
  @Get(':id')
  get(@Param('id') id: string): Promise<UserDto> {
    return this.users.get(id);
  }

  @RequirePermissions('system:user:manage')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ): Promise<UserDto> {
    return this.users.create(user, body);
  }

  @RequirePermissions('system:user:manage')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
  ): Promise<UserDto> {
    return this.users.update(user, id, body);
  }

  @RequirePermissions('system:user:manage')
  @Put(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(userStatusSchema)) body: UserStatusInput,
  ): Promise<UserDto> {
    return this.users.setStatus(user, id, body);
  }

  @RequirePermissions('system:user:manage')
  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
  ): Promise<{ ok: true }> {
    await this.users.resetPassword(user, id, body);
    return { ok: true };
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
