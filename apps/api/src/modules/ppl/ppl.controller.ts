import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import {
  createPplSetSchema,
  resolvePplQuerySchema,
  type CreatePplSetInput,
  type PplActiveVariantsDto,
  type PplResolvedDto,
  type PplSetDto,
  type PplSetSummaryDto,
  type ResolvePplQuery,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { AppException } from '../../common/errors/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PplExcelService } from './ppl-excel.service';
import { PplService } from './ppl.service';

/** 路径里的版本号不是正整数时按"版本不存在"处理 */
function parseVersion(raw: string): number {
  const version = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(version) || version < 1) {
    throw new AppException('PPL_SET_NOT_FOUND', { version: raw });
  }
  return version;
}

/** 模板集只能新建和激活，没有修改、删除接口（R05-2） */
@Controller('ppl')
export class PplController {
  constructor(private readonly ppl: PplService) {}

  @RequirePermissions('system:ppl:view')
  @Get('sets')
  list(): Promise<PplSetSummaryDto[]> {
    return this.ppl.list();
  }

  @RequirePermissions('system:ppl:view')
  @Get('sets/:version')
  get(@Param('version') version: string): Promise<PplSetDto> {
    return this.ppl.get(parseVersion(version));
  }

  @RequirePermissions('system:ppl:manage')
  @Post('sets')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPplSetSchema)) body: CreatePplSetInput,
  ): Promise<PplSetDto> {
    return this.ppl.create(user, body);
  }

  @RequirePermissions('system:ppl:manage')
  @Post('sets/:version/activate')
  @HttpCode(200)
  activate(@CurrentUser() user: AuthUser, @Param('version') version: string): Promise<PplSetDto> {
    return this.ppl.activate(user, parseVersion(version));
  }

  /** 当前激活版本的主模板与变体：材料分类表单的"PPL 变体"下拉（能看材料分类的人都要用，不要求 system:ppl:view） */
  @RequirePermissions('material:view')
  @Get('variants')
  variants(): Promise<PplActiveVariantsDto> {
    return this.ppl.activeVariants();
  }

  /** 内部页面用的解析后列定义 */
  @RequirePermissions('inquiry:view')
  @Get('resolve')
  resolve(
    @Query(new ZodValidationPipe(resolvePplQuerySchema)) query: ResolvePplQuery,
  ): Promise<PplResolvedDto> {
    return this.ppl.resolve(query.version, query.variant);
  }
}

/** M03 分类绑定变体、M07 发布冻结版本、M09 报价都用 PplService；M09 的锁定 Excel 下载与导入用 PplExcelService */
@Module({
  controllers: [PplController],
  providers: [PplService, PplExcelService],
  exports: [PplService, PplExcelService],
})
export class PplModule {}
