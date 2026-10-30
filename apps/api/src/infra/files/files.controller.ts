import {
  Controller,
  Get,
  Global,
  Module,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  fileContentQuerySchema,
  uploadFileSchema,
  type FileContentQuery,
  type FileDto,
  type SheetPreviewDto,
  type UploadFileInput,
} from '@quoteflow/shared';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { AnyUser, CurrentUser } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AppConfig } from '../../config/app-config';
import { FileAccessRegistry } from './file-access.registry';
import { contentDisposition } from './file-types';
import { FilesService, toFileDto, type UploadedFileInput } from './files.service';
import { LocalStorageDriver, STORAGE_DRIVER } from './storage';

/** multer 的硬上限；各类别的实际上限由系统参数 upload.limits 决定 */
const HARD_LIMIT_BYTES = 200 * 1024 * 1024;

@AnyUser()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  // 不指定 dest/storage 时 multer 使用内存存储
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_LIMIT_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Body(new ZodValidationPipe(uploadFileSchema)) body: UploadFileInput,
  ): Promise<FileDto> {
    return this.files.upload(user, file, body.kind);
  }

  @Get(':id/meta')
  async meta(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<FileDto> {
    const { file } = await this.files.authorize(user, id);
    return toFileDto(file);
  }

  @Get(':id/content')
  async content(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(fileContentQuerySchema)) query: FileContentQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, decision } = await this.files.authorize(user, id);
    // 内部页面自动加载的缩略图不算预览；供应商的每次访问都记（R08-3）
    if (!(query.thumbnail && user.userType === 'INTERNAL')) {
      await this.files.logAccess(
        user,
        file,
        decision,
        query.disposition === 'inline' ? 'PREVIEW' : 'DOWNLOAD',
      );
    }
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      'Content-Disposition': contentDisposition(query.disposition, file.originalName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(this.files.stream(file));
  }

  @Get(':id/sheet-preview')
  async sheetPreview(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<SheetPreviewDto> {
    const { file, decision } = await this.files.authorize(user, id);
    const preview = await this.files.sheetPreview(file);
    await this.files.logAccess(user, file, decision, 'PREVIEW');
    return preview;
  }
}

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    FileAccessRegistry,
    {
      provide: STORAGE_DRIVER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new LocalStorageDriver(config.get('STORAGE_DIR')),
    },
  ],
  exports: [FilesService, FileAccessRegistry, STORAGE_DRIVER],
})
export class FilesModule {}
