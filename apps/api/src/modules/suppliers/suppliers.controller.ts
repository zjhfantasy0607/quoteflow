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
  createDictItemSchema,
  createSupplierAccountSchema,
  createSupplierSchema,
  enableStatusSchema,
  supplierExportQuerySchema,
  supplierListQuerySchema,
  updateDictItemSchema,
  updateSupplierSchema,
  userStatusSchema,
  type CreateDictItemInput,
  type CreateSupplierAccountInput,
  type CreateSupplierInput,
  type DictItemDto,
  type EnableStatusInput,
  type ImportResultDto,
  type Paginated,
  type SupplierAccountDto,
  type SupplierDto,
  type SupplierExportQuery,
  type SupplierListQuery,
  type UpdateDictItemInput,
  type UpdateSupplierInput,
  type UserStatusInput,
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
import { SupplierAccountsService } from './supplier-accounts.service';
import { SupplierCategoriesService } from './supplier-categories.service';
import { SuppliersExcelService } from './suppliers-excel.service';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly excel: SuppliersExcelService,
    private readonly accounts: SupplierAccountsService,
    private readonly clock: ClockService,
  ) {}

  @RequirePermissions('supplier:view')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(supplierListQuerySchema)) query: SupplierListQuery,
  ): Promise<Paginated<SupplierDto>> {
    return this.suppliers.list(user, query);
  }

  // 固定路径写在 :id 前面，否则会被 :id 匹配
  @RequirePermissions('supplier:import')
  @Get('import-template')
  async template(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const name = user.locale === 'en-US' ? 'Supplier Import Template.xlsx' : '供应商导入模板.xlsx';
    return xlsxFile(res, name, await this.excel.template());
  }

  @RequirePermissions('supplier:export')
  @Get('export')
  async export(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(supplierExportQuerySchema)) query: SupplierExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const day = inAppTz(this.clock.now()).format('YYYYMMDD');
    const name = user.locale === 'en-US' ? `Suppliers-${day}.xlsx` : `供应商-${day}.xlsx`;
    return xlsxFile(res, name, await this.excel.export(user, query));
  }

  @RequirePermissions('supplier:view')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<SupplierDto> {
    return this.suppliers.get(user, id);
  }

  @RequirePermissions('supplier:manage')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierInput,
  ): Promise<SupplierDto> {
    return this.suppliers.create(user, body);
  }

  @RequirePermissions('supplier:import')
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_HARD_LIMIT_BYTES, files: 1 } }))
  import(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedFileInput | undefined,
  ): Promise<ImportResultDto> {
    return this.excel.import(user, file);
  }

  @RequirePermissions('supplier:manage')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierInput,
  ): Promise<SupplierDto> {
    return this.suppliers.update(user, id, body);
  }

  @RequirePermissions('supplier:manage')
  @Put(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(enableStatusSchema)) body: EnableStatusInput,
  ): Promise<SupplierDto> {
    return this.suppliers.setStatus(user, id, body);
  }

  // ---------- 门户账号（R04-10） ----------

  @RequirePermissions('supplier:view')
  @Get(':id/accounts')
  listAccounts(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<SupplierAccountDto[]> {
    return this.accounts.list(user, id);
  }

  @RequirePermissions('supplier:account')
  @Post(':id/accounts')
  createAccount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createSupplierAccountSchema)) body: CreateSupplierAccountInput,
  ): Promise<SupplierAccountDto> {
    return this.accounts.create(user, id, body);
  }

  @RequirePermissions('supplier:account')
  @Post(':id/accounts/:userId/resend-activation')
  @HttpCode(200)
  resendActivation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<SupplierAccountDto> {
    return this.accounts.resendActivation(user, id, userId);
  }

  @RequirePermissions('supplier:account')
  @Put(':id/accounts/:userId/status')
  setAccountStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(userStatusSchema)) body: UserStatusInput,
  ): Promise<SupplierAccountDto> {
    return this.accounts.setStatus(user, id, userId, body);
  }
}

/** 供应商分类（R04-9）：supplier_category 字典的包装 */
@Controller('supplier-categories')
export class SupplierCategoriesController {
  constructor(private readonly categories: SupplierCategoriesService) {}

  @RequirePermissions('supplier:view')
  @Get()
  list(): Promise<DictItemDto[]> {
    return this.categories.list();
  }

  @RequirePermissions('supplier:category:manage')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDictItemSchema)) body: CreateDictItemInput,
  ): Promise<DictItemDto> {
    return this.categories.create(user, body);
  }

  @RequirePermissions('supplier:category:manage')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDictItemSchema)) body: UpdateDictItemInput,
  ): Promise<DictItemDto> {
    return this.categories.update(user, id, body);
  }
}

/** M07 受邀名单、候选供应商导入它，用 supplierWhere / SuppliersService */
@Module({
  imports: [MaterialCategoriesModule],
  controllers: [SuppliersController, SupplierCategoriesController],
  providers: [SuppliersService, SuppliersExcelService, SupplierAccountsService, SupplierCategoriesService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
