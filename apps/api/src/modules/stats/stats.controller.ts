import { Controller, Get, Module, Query, Res, StreamableFile } from '@nestjs/common';
import {
  statsCycleTimeQuerySchema,
  statsExportQuerySchema,
  statsProjectsQuerySchema,
  statsResponseSpeedQuerySchema,
  statsWinRateQuerySchema,
  type StatsCycleTimeDto,
  type StatsCycleTimeQuery,
  type StatsExportQuery,
  type StatsProjectsDto,
  type StatsProjectsQuery,
  type StatsResponseSpeedDto,
  type StatsResponseSpeedQuery,
  type StatsWinRateDto,
  type StatsWinRateQuery,
} from '@quoteflow/shared';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { xlsxFile } from '../../infra/excel/excel-http';
import { MaterialCategoriesModule } from '../material-categories/material-categories.controller';
import { StatsExcelService } from './stats-excel.service';
import { StatsService } from './stats.service';

/** M15 §6：统计看板四个接口与导出（区间省略时取当年，按 UTC+8） */
@Controller('stats')
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    private readonly excel: StatsExcelService,
  ) {}

  @RequirePermissions('stats:view')
  @Get('projects')
  projects(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(statsProjectsQuerySchema)) query: StatsProjectsQuery,
  ): Promise<StatsProjectsDto> {
    return this.stats.projects(user, query);
  }

  @RequirePermissions('stats:view')
  @Get('response-speed')
  responseSpeed(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(statsResponseSpeedQuerySchema)) query: StatsResponseSpeedQuery,
  ): Promise<StatsResponseSpeedDto> {
    return this.stats.responseSpeed(user, query);
  }

  @RequirePermissions('stats:view')
  @Get('win-rate')
  winRate(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(statsWinRateQuerySchema)) query: StatsWinRateQuery,
  ): Promise<StatsWinRateDto> {
    return this.stats.winRate(user, query);
  }

  @RequirePermissions('stats:view')
  @Get('cycle-time')
  cycleTime(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(statsCycleTimeQuerySchema)) query: StatsCycleTimeQuery,
  ): Promise<StatsCycleTimeDto> {
    return this.stats.cycleTime(user, query);
  }

  /** R15-2：导出要 report:export；看不到看板的人不能导出看板数据，所以同时要 stats:view */
  @RequirePermissions('stats:view', 'report:export')
  @Get('export')
  async export(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(statsExportQuerySchema)) query: StatsExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { name, buffer } = await this.excel.export(user, query);
    return xlsxFile(res, name, buffer);
  }
}

/** 统计（01 §4.1 modules/stats）：只读，聚合询价、报价的次数与时长 */
@Module({
  imports: [MaterialCategoriesModule],
  controllers: [StatsController],
  providers: [StatsService, StatsExcelService],
})
export class StatsModule {}
