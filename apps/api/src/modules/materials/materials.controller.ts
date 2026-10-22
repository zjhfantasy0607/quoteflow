import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  createMaterialSchema,
  enableStatusSchema,
  materialExportQuerySchema,
  materialListQuerySchema,
  updateMaterialSchema,
  type CreateMaterialInput,
  type EnableStatusInput,
  type ImportResultDto,
  type MaterialDto,
  type MaterialExportQuery,
  type MaterialListQuery,
  type Paginated,
  type UpdateMaterialInput,
} from '@quoteflow/shared';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ClockService } from '../../common/clock/clock.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { inAppTz } from '../../common/time';
import { IMPORT_HARD_LIMIT_BYTES, xlsxFile } from '../../infra/excel/excel-http';
import type { UploadedFileInput } from '../../infra/files/files.service';
import { MaterialCategoriesModule } from '../material-categories/material-categories.controller';
import { MaterialImageResolver } from './material-image.resolver';
import { MaterialsExcelService } from './materials-excel.service';
import { MaterialsService } from './materials.service';

@Controller('materials')
export class MaterialsController {
  constructor(
    private readonly materials: MaterialsService,
    private readonly excel: MaterialsExcelService,
    private readonly clock: ClockService,
  ) {}

  @RequirePermissions('material:view')
  @Get()
  list(@Query(new ZodValidationPipe(materialListQuerySchema)) query: MaterialListQuery): Promise<Paginated<MaterialDto>> {
    return this.materials.list(query);
  }

  // 固定路径写在 :id 前面，否则会被 :id 匹配
  @RequirePermissions('material:import')
  @Get('import-template')
  async template(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const name = user.locale === 'en-US' ? 'Material Import Template.xlsx' : '材料导入模板.xlsx';
    return xlsxFile(res, name, await this.excel.template());
  }

  @RequirePermissions('material:export')
  @Get('export')
  async export(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(materialExportQuerySchema)) query: MaterialExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const day = inAppTz(this.clock.now()).format('YYYYMMDD');
    const name = user.locale === 'en-US' ? `Materials-${day}.xlsx` : `材料库-${day}.xlsx`;
    return xlsxFile(res, name, await this.excel.export(user, query));
  }

  @RequirePermissions('material:view')
  @Get(':id')
  get(@Param('id') id: string): Promise<MaterialDto> {
    return this.materials.get(id);
  }

  @RequirePermissions('material:manage')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createMaterialSchema)) body: CreateMaterialInput,
  ): Promise<MaterialDto> {
    return this.materials.create(user, body);
  }

  @RequirePermissions('material:import')
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_HARD_LIMIT_BYTES, files: 1 } }))
  import(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileInput | undefined): Promise<ImportResultDto> {
    return this.excel.import(user, file);
  }

  @RequirePermissions('material:manage')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMaterialSchema)) body: UpdateMaterialInput,
  ): Promise<MaterialDto> {
    return this.materials.update(user, id, body);
  }

  @RequirePermissions('material:manage')
  @Put(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(enableStatusSchema)) body: EnableStatusInput,
  ): Promise<MaterialDto> {
    return this.materials.setStatus(user, id, body);
  }
}

/** M06 询价行导入它，用 assertSelectable */
@Module({
  imports: [MaterialCategoriesModule],
  controllers: [MaterialsController],
  providers: [MaterialsService, MaterialsExcelService, MaterialImageResolver],
  exports: [MaterialsService],
})
export class MaterialsModule {}
