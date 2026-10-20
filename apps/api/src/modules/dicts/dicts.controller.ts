import { Body, Controller, Delete, Get, Global, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import {
  createDictItemSchema,
  createDictTypeSchema,
  dictQuerySchema,
  updateDictItemSchema,
  updateDictTypeSchema,
  type CreateDictItemInput,
  type CreateDictTypeInput,
  type DictItemDto,
  type DictMapDto,
  type DictQuery,
  type DictTypeDto,
  type UpdateDictItemInput,
  type UpdateDictTypeInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AnyUser, CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DictsService } from './dicts.service';

@Controller('dicts')
export class DictsController {
  constructor(private readonly dicts: DictsService) {}

  @AnyUser()
  @Get()
  list(@Query(new ZodValidationPipe(dictQuerySchema)) query: DictQuery): Promise<DictMapDto> {
    return this.dicts.listEnabled(query.types);
  }
}

@Controller('system')
export class DictsAdminController {
  constructor(private readonly dicts: DictsService) {}

  @RequirePermissions('system:dict:view')
  @Get('dict-types')
  listTypes(): Promise<DictTypeDto[]> {
    return this.dicts.listTypes();
  }

  @RequirePermissions('system:dict:manage')
  @Post('dict-types')
  async createType(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDictTypeSchema)) body: CreateDictTypeInput,
  ): Promise<{ ok: true }> {
    await this.dicts.createType(user, body);
    return { ok: true };
  }

  @RequirePermissions('system:dict:manage')
  @Put('dict-types/:code')
  async updateType(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateDictTypeSchema)) body: UpdateDictTypeInput,
  ): Promise<{ ok: true }> {
    await this.dicts.updateType(user, code, body);
    return { ok: true };
  }

  @RequirePermissions('system:dict:manage')
  @Delete('dict-types/:code')
  @HttpCode(200)
  async deleteType(@CurrentUser() user: AuthUser, @Param('code') code: string): Promise<{ ok: true }> {
    await this.dicts.deleteType(user, code);
    return { ok: true };
  }

  @RequirePermissions('system:dict:view')
  @Get('dict-types/:code/items')
  listItems(@Param('code') code: string): Promise<DictItemDto[]> {
    return this.dicts.listItems(code);
  }

  @RequirePermissions('system:dict:manage')
  @Post('dict-types/:code/items')
  createItem(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(createDictItemSchema)) body: CreateDictItemInput,
  ): Promise<DictItemDto> {
    return this.dicts.createItem(user, code, body);
  }

  @RequirePermissions('system:dict:manage')
  @Put('dict-items/:id')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDictItemSchema)) body: UpdateDictItemInput,
  ): Promise<DictItemDto> {
    return this.dicts.updateItem(user, id, body);
  }

  @RequirePermissions('system:dict:manage')
  @Delete('dict-items/:id')
  @HttpCode(200)
  async deleteItem(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ ok: true }> {
    await this.dicts.deleteItem(user, id);
    return { ok: true };
  }
}

@Global()
@Module({ controllers: [DictsController, DictsAdminController], providers: [DictsService], exports: [DictsService] })
export class DictsModule {}
