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
  type MaterialCategoryPplVariantDto,
  type UpdateCategoryInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PplModule } from '../ppl/ppl.controller';
import { MaterialCategoriesService } from './material-categories.service';

@Controller('material-categories')
export class MaterialCategoriesController {
  constructor(private readonly categories: MaterialCategoriesService) {}

  /**
   * 内部用户登录即可读取（待确认事项 B-10）：分类树和数据字典一样是不敏感的基础数据，
   * 材料库、供应商主营分类、询价行、邀请供应商的筛选都要用；供应商用户仍被 UserTypeGuard 拒绝
   */
  @RequirePermissions()
  @Get('tree')
  tree(
    @Query(new ZodValidationPipe(categoryTreeQuerySchema)) query: CategoryTreeQuery,
  ): Promise<MaterialCategoryNodeDto[]> {
    return this.categories.tree(query.includeDisabled);
  }

  /** R05-6 实际生效的 PPL 变体与继承来源 */
  @RequirePermissions('material:view')
  @Get(':id/ppl-variant')
  pplVariant(@Param('id') id: string): Promise<MaterialCategoryPplVariantDto> {
    return this.categories.pplVariant(id);
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
  imports: [PplModule],
  controllers: [MaterialCategoriesController],
  providers: [MaterialCategoriesService],
  exports: [MaterialCategoriesService],
})
export class MaterialCategoriesModule {}
