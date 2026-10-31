import {
  Body,
  Controller,
  Delete,
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
  approveInquirySchema,
  attachInquiryFileSchema,
  awardRoundSchema,
  cancelInquirySchema,
  copyLineFilesSchema,
  createInquirySchema,
  createLineSchema,
  extendDeadlineSchema,
  inquiryListQuerySchema,
  inviteeCandidatesQuerySchema,
  lateInviteSchema,
  linesFromMaterialsSchema,
  pageQuerySchema,
  publishRoundSchema,
  rejectInquirySchema,
  remindQuotesSchema,
  reorderLinesSchema,
  roundNoSchema,
  updateInquirySchema,
  updateInviteesSchema,
  updateLineSchema,
  type ApproveInquiryInput,
  type AttachInquiryFileInput,
  type AwardRoundInput,
  type AuditLogDto,
  type CancelInquiryInput,
  type CopyLineFilesInput,
  type CreateInquiryInput,
  type CreateLineInput,
  type ExtendDeadlineInput,
  type FileAccessLogDto,
  type ImportResultDto,
  type InquiryApprovalDto,
  type InquiryDetailDto,
  type InquiryFileDto,
  type InquiryInviteeDto,
  type InquiryLineDto,
  type InquiryListItemDto,
  type InquiryListQuery,
  type InquiryRoundDto,
  type InquiryUserOptionDto,
  type InviteeCandidateDto,
  type InviteeCandidatesQuery,
  type LateInviteInput,
  type LinesFromMaterialsInput,
  type PageQuery,
  type Paginated,
  type PublishRoundInput,
  type RejectInquiryInput,
  type RemindQuotesInput,
  type ReorderLinesInput,
  type UpdateInquiryInput,
  type UpdateInviteesInput,
  type UpdateLineInput,
} from '@quoteflow/shared';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IMPORT_HARD_LIMIT_BYTES, xlsxFile } from '../../infra/excel/excel-http';
import type { UploadedFileInput } from '../../infra/files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractsModule } from '../contracts/contract-draft.factory';
import { MaterialCategoriesModule } from '../material-categories/material-categories.controller';
import { MaterialsModule } from '../materials/materials.controller';
import { PointsModule } from '../points/points.service';
import { PplModule } from '../ppl/ppl.controller';
import { AutoReminderJob } from './auto-reminder.job';
import { InquiryAccessService } from './inquiry-access.service';
import { InquiryFileResolver } from './inquiry-file.resolver';
import { InquiryFilesService } from './inquiry-files.service';
import { InquiryInviteesService } from './inquiry-invitees.service';
import { InquiryLinesExcelService } from './inquiry-lines-excel.service';
import { InquiryLinesService } from './inquiry-lines.service';
import { InquiryNoticesService } from './inquiry-notices.service';
import { InquiryWorkflowService } from './inquiry-workflow.service';
import { InquiriesService } from './inquiries.service';
import { RoundAwardService } from './round-award.service';
import { RoundDeadlineJob } from './round-deadline.job';
import { RoundStateService } from './round-state.service';
import { RoundWorkflowService } from './round-workflow.service';

const roundNoPipe = new ZodValidationPipe(roundNoSchema);

/**
 * M06 询价单与审批、M07 邀请与发布、M10 提前截止与开标、M12 定标（docs/modules/M06 §4、M07 §4、M10 §4、M12 §4）。
 * 所有接口叠加数据权限，范围外的单据返回 404；供应商响应与报价查看在 QuotesModule（要经过 SealService）
 */
@Controller('inquiries')
export class InquiriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inquiries: InquiriesService,
    private readonly workflow: InquiryWorkflowService,
    private readonly lines: InquiryLinesService,
    private readonly linesExcel: InquiryLinesExcelService,
    private readonly files: InquiryFilesService,
    private readonly invitees: InquiryInviteesService,
    private readonly rounds: RoundWorkflowService,
    private readonly awards: RoundAwardService,
  ) {}

  @RequirePermissions('inquiry:view')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(inquiryListQuerySchema)) query: InquiryListQuery,
  ): Promise<Paginated<InquiryListItemDto>> {
    return this.inquiries.list(user, query);
  }

  // 固定路径写在 :id 前面
  @RequirePermissions('inquiry:approve')
  @Get('approvals/pending')
  pending(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Paginated<InquiryListItemDto>> {
    return this.inquiries.pendingApprovals(user, query);
  }

  /** 负责人、PD 负责人下拉 */
  @RequirePermissions('inquiry:create')
  @Get('user-options')
  userOptions(): Promise<InquiryUserOptionDto[]> {
    return this.inquiries.userOptions();
  }

  @RequirePermissions('inquiry:create')
  @Get('lines/import-template')
  async template(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const name = user.locale === 'en-US' ? 'RFQ Line Import Template.xlsx' : '询价行导入模板.xlsx';
    return xlsxFile(res, name, await this.linesExcel.template());
  }

  @RequirePermissions('inquiry:create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createInquirySchema)) body: CreateInquiryInput,
  ): Promise<InquiryDetailDto> {
    return this.inquiries.create(user, body);
  }

  @RequirePermissions('inquiry:view')
  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<InquiryDetailDto> {
    return this.inquiries.detail(this.prisma, user, id);
  }

  @RequirePermissions('inquiry:create')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateInquirySchema)) body: UpdateInquiryInput,
  ): Promise<InquiryDetailDto> {
    return this.inquiries.update(user, id, body);
  }

  @RequirePermissions('inquiry:submit')
  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<InquiryDetailDto> {
    return this.workflow.submit(user, id);
  }

  @RequirePermissions('inquiry:approve')
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveInquirySchema)) body: ApproveInquiryInput,
  ): Promise<InquiryDetailDto> {
    return this.workflow.approve(user, id, body);
  }

  @RequirePermissions('inquiry:approve')
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectInquirySchema)) body: RejectInquiryInput,
  ): Promise<InquiryDetailDto> {
    return this.workflow.reject(user, id, body);
  }

  @RequirePermissions('inquiry:cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelInquirySchema)) body: CancelInquiryInput,
  ): Promise<InquiryDetailDto> {
    return this.workflow.cancel(user, id, body);
  }

  @RequirePermissions('inquiry:view')
  @Get(':id/approvals')
  approvals(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<InquiryApprovalDto[]> {
    return this.inquiries.approvals(user, id);
  }

  @RequirePermissions('inquiry:view')
  @Get(':id/timeline')
  timeline(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AuditLogDto[]> {
    return this.inquiries.timeline(user, id);
  }

  /** 规格下载日志（R08-4） */
  @RequirePermissions('inquiry:accessLog')
  @Get(':id/file-access-logs')
  fileAccessLogs(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Paginated<FileAccessLogDto>> {
    return this.inquiries.fileAccessLogs(user, id, query);
  }

  /** 受邀名单 + 门户账号状态（R07-6） */
  @RequirePermissions('inquiry:view')
  @Get(':id/invitees')
  inviteeList(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<InquiryInviteeDto[]> {
    return this.invitees.list(user, id);
  }

  @RequirePermissions('inquiry:invite')
  @Get(':id/invitee-candidates')
  candidates(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(inviteeCandidatesQuerySchema)) query: InviteeCandidatesQuery,
  ): Promise<Paginated<InviteeCandidateDto>> {
    return this.invitees.candidates(user, id, query);
  }

  @RequirePermissions('inquiry:invite')
  @Put(':id/invitees')
  replaceInvitees(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateInviteesSchema)) body: UpdateInviteesInput,
  ): Promise<InquiryInviteeDto[]> {
    return this.invitees.replace(user, id, body);
  }

  @RequirePermissions('inquiry:view')
  @Get(':id/rounds/:roundNo')
  round(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
  ): Promise<InquiryRoundDto> {
    return this.inquiries.roundDetail(this.prisma, user, id, roundNo);
  }

  @RequirePermissions('inquiry:publish')
  @Post(':id/rounds/:roundNo/publish')
  @HttpCode(200)
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(publishRoundSchema)) body: PublishRoundInput,
  ): Promise<InquiryDetailDto> {
    return this.rounds.publish(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:invite')
  @Post(':id/rounds/:roundNo/late-invite')
  @HttpCode(200)
  lateInvite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(lateInviteSchema)) body: LateInviteInput,
  ): Promise<InquiryDetailDto> {
    return this.rounds.lateInvite(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:remind')
  @Post(':id/rounds/:roundNo/remind')
  @HttpCode(200)
  remind(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(remindQuotesSchema)) body: RemindQuotesInput,
  ): Promise<InquiryDetailDto> {
    return this.rounds.remind(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:deadline')
  @Put(':id/rounds/:roundNo/deadline')
  extendDeadline(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(extendDeadlineSchema)) body: ExtendDeadlineInput,
  ): Promise<InquiryDetailDto> {
    return this.rounds.extendDeadline(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:open')
  @Post(':id/rounds/:roundNo/close-early')
  @HttpCode(200)
  closeEarly(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
  ): Promise<InquiryDetailDto> {
    return this.rounds.closeEarly(user, id, roundNo);
  }

  @RequirePermissions('inquiry:open')
  @Post(':id/rounds/:roundNo/open')
  @HttpCode(200)
  open(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
  ): Promise<InquiryDetailDto> {
    return this.rounds.open(user, id, roundNo);
  }

  /** R12-1 ~ R12-9：返回最新详情（含定标结果与合同草稿） */
  @RequirePermissions('inquiry:award')
  @Post(':id/rounds/:roundNo/award')
  @HttpCode(200)
  award(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(awardRoundSchema)) body: AwardRoundInput,
  ): Promise<InquiryDetailDto> {
    return this.awards.award(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:create')
  @Post(':id/rounds/:roundNo/lines')
  createLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(createLineSchema)) body: CreateLineInput,
  ): Promise<InquiryLineDto> {
    return this.lines.create(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:create')
  @Post(':id/rounds/:roundNo/lines/from-materials')
  createFromMaterials(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(linesFromMaterialsSchema)) body: LinesFromMaterialsInput,
  ): Promise<InquiryLineDto[]> {
    return this.lines.createFromMaterials(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:create')
  @Post(':id/rounds/:roundNo/lines/import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_HARD_LIMIT_BYTES, files: 1 } }))
  importLines(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @UploadedFile() file: UploadedFileInput | undefined,
  ): Promise<ImportResultDto> {
    return this.linesExcel.import(user, id, roundNo, file);
  }

  // order 写在 :lineId 前面
  @RequirePermissions('inquiry:create')
  @Put(':id/rounds/:roundNo/lines/order')
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(reorderLinesSchema)) body: ReorderLinesInput,
  ): Promise<InquiryRoundDto> {
    return this.lines.reorder(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:create')
  @Put(':id/rounds/:roundNo/lines/:lineId')
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(updateLineSchema)) body: UpdateLineInput,
  ): Promise<InquiryLineDto> {
    return this.lines.update(user, id, roundNo, lineId, body);
  }

  @RequirePermissions('inquiry:create')
  @Delete(':id/rounds/:roundNo/lines/:lineId')
  removeLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Param('lineId') lineId: string,
  ): Promise<InquiryRoundDto> {
    return this.lines.remove(user, id, roundNo, lineId);
  }

  @RequirePermissions('inquiry:spec')
  @Post(':id/rounds/:roundNo/files')
  attachFile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(attachInquiryFileSchema)) body: AttachInquiryFileInput,
  ): Promise<InquiryFileDto> {
    return this.files.attach(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:spec')
  @Post(':id/rounds/:roundNo/files/copy')
  @HttpCode(200)
  copyFiles(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Body(new ZodValidationPipe(copyLineFilesSchema)) body: CopyLineFilesInput,
  ): Promise<InquiryRoundDto> {
    return this.files.copy(user, id, roundNo, body);
  }

  @RequirePermissions('inquiry:spec')
  @Delete(':id/rounds/:roundNo/files/:inquiryFileId')
  removeFile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roundNo', roundNoPipe) roundNo: number,
    @Param('inquiryFileId') inquiryFileId: string,
  ): Promise<{ ok: true }> {
    return this.files.remove(user, id, roundNo, inquiryFileId);
  }
}

/**
 * 导出给后续模块：InquiryAccessService、RoundStateService（M13 变更轮次）、
 * InquiryNoticesService（M13 的变更通知可以照着加）、InquiryLinesService / InquiryFilesService（M13 复用行与附件）
 */
@Module({
  imports: [MaterialCategoriesModule, MaterialsModule, PplModule, PointsModule, ContractsModule],
  controllers: [InquiriesController],
  providers: [
    InquiryAccessService,
    RoundStateService,
    InquiriesService,
    InquiryWorkflowService,
    InquiryLinesService,
    InquiryLinesExcelService,
    InquiryFilesService,
    InquiryFileResolver,
    InquiryInviteesService,
    InquiryNoticesService,
    RoundWorkflowService,
    RoundAwardService,
    AutoReminderJob,
    RoundDeadlineJob,
  ],
  exports: [
    InquiryAccessService,
    RoundStateService,
    InquiriesService,
    InquiryLinesService,
    InquiryFilesService,
    InquiryNoticesService,
    AutoReminderJob,
    RoundDeadlineJob,
  ],
})
export class InquiriesModule {}
