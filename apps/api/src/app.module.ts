import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { ClockModule } from './common/clock/clock.service';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { AppConfigModule } from './config/app-config';
import { HealthModule } from './health/health.controller';
import { AuditModule } from './infra/audit/audit.service';
import { ExcelModule } from './infra/excel/excel-template.service';
import { FilesModule } from './infra/files/files.controller';
import { JobsModule } from './infra/jobs/cleanup.job';
import { MailModule } from './infra/mail/emails.controller';
import { ParamsModule } from './infra/params/params.service';
import { SequenceModule } from './infra/sequences/sequence.service';
import { AuthModule } from './modules/auth/auth.controller';
import { DictsModule } from './modules/dicts/dicts.controller';
import { InquiriesModule } from './modules/inquiries/inquiries.controller';
import { MaterialCategoriesModule } from './modules/material-categories/material-categories.controller';
import { MaterialsModule } from './modules/materials/materials.controller';
import { PortalModule } from './modules/portal/portal.controller';
import { PplModule } from './modules/ppl/ppl.controller';
import { QuotesModule } from './modules/quotes/round-quotes.controller';
import { RolesModule } from './modules/roles/roles.controller';
import { SuppliersModule } from './modules/suppliers/suppliers.controller';
import { UsersModule } from './modules/users/users.controller';
import { PrismaModule } from './prisma/prisma.service';

// 定时任务只在 JOBS_ENABLED 不为 false 时注册（e2e 测试里关闭，改为直接调用 job.run()）
const scheduler = process.env.JOBS_ENABLED === 'false' ? [] : [ScheduleModule.forRoot()];

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ClockModule,
    AuditModule,
    ParamsModule,
    SequenceModule,
    AuthCoreModule,
    FilesModule,
    MailModule,
    ExcelModule,
    JobsModule,
    ...scheduler,
    DictsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    MaterialCategoriesModule,
    MaterialsModule,
    PplModule,
    SuppliersModule,
    InquiriesModule,
    QuotesModule,
    PortalModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
