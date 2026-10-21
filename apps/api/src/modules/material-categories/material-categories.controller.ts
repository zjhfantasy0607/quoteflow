import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import {
  categoryTreeQuerySchema,
  createCategorySchema,
  enableStatusSchema,
  updateCategorySchema,
  type CategoryTreeQuery,
  type CreateCategoryInput,
  type EnableStatusInput,
  type MaterialCategoryDto,
  type MaterialCategoryNodeDto,
  type UpdateCategoryInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MaterialCategoriesService } from './material-categories.service';

@Controller('material-categories')
export class MaterialCategoriesController {
  constructor(private readonly categories: MaterialCategoriesService) {}

  @RequirePermissions('material:view')
  @Get('tree')
  tree(
    @Query(new ZodValidationPipe(categoryTreeQuerySchema)) query: CategoryTreeQuery,
  ): Promise<MaterialCategoryNodeDto[]> {
    return this.categories.tree(query.includeDisabled);
  }

  @RequirePermissions('material:category:manage')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
  ): Promise<MaterialCategoryDto> {
    return this.categories.create(user, body);
  }

  @RequirePermissions('material:category:manage')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ): Promise<MaterialCategoryDto> {
    return this.categories.update(user, id, body);
  }

  @RequirePermissions('material:category:manage')
  @Put(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(enableStatusSchema)) body: EnableStatusInput,
  ): Promise<MaterialCategoryDto> {
    return this.categories.setStatus(user, id, body);
  }

  @RequirePermissions('material:category:manage')
  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ ok: true }> {
    await this.categories.remove(user, id);
    return { ok: true };
  }
}

/** M04 供应商主营分类、M06 询价行导入它，用 assertSelectable / loadIndex */
@Module({
  controllers: [MaterialCategoriesController],
  providers: [MaterialCategoriesService],
  exports: [MaterialCategoriesService],
})
export class MaterialCategoriesModule {}
