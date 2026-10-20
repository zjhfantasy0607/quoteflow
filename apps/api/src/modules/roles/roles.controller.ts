import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put } from '@nestjs/common';
import {
  createRoleSchema,
  PERMISSION_TREE,
  SENSITIVE_FIELDS,
  updateRoleSchema,
  type CreateRoleInput,
  type PermissionCatalogDto,
  type RoleDto,
  type UpdateRoleInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';

@Controller('system')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermissions('system:role:view')
  @Get('permissions')
  catalog(): PermissionCatalogDto {
    return { modules: PERMISSION_TREE, fields: SENSITIVE_FIELDS };
  }

  @RequirePermissions('system:role:view')
  @Get('roles')
  list(): Promise<RoleDto[]> {
    return this.roles.list();
  }

  @RequirePermissions('system:role:view')
  @Get('roles/:id')
  get(@Param('id') id: string): Promise<RoleDto> {
    return this.roles.get(id);
  }

  @RequirePermissions('system:role:manage')
  @Post('roles')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
  ): Promise<RoleDto> {
    return this.roles.create(user, body);
  }

  @RequirePermissions('system:role:manage')
  @Put('roles/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
  ): Promise<RoleDto> {
    return this.roles.update(user, id, body);
  }

  @RequirePermissions('system:role:manage')
  @Delete('roles/:id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ ok: true }> {
    await this.roles.remove(user, id);
    return { ok: true };
  }
}

@Module({ controllers: [RolesController], providers: [RolesService] })
export class RolesModule {}
