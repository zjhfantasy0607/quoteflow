import { Body, Controller, Get, Global, Injectable, Logger, Module, Param, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isSystemParamKey,
  SYSTEM_PARAM_KEYS,
  SYSTEM_PARAMS,
  updateParamSchema,
  type AppConfigDto,
  type SystemParamDto,
  type SystemParamKey,
  type SystemParamValue,
  type UpdateParamInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../../common/auth/decorators';
import { AppException } from '../../common/errors/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** 系统参数：数据库没有或数据损坏时回退默认值；修改立即生效（R02-2、R02-3） */
@Injectable()
export class ParamsService {
  private readonly logger = new Logger(ParamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SystemParamKey>(key: K): Promise<SystemParamValue<K>> {
    const def = SYSTEM_PARAMS[key];
    const row = await this.prisma.systemParam.findUnique({ where: { key } });
    if (!row) return def.defaultValue as SystemParamValue<K>;
    const parsed = def.schema.safeParse(row.value);
    if (!parsed.success) {
      this.logger.warn(`System param "${key}" is invalid in the database, using default`);
      return def.defaultValue as SystemParamValue<K>;
    }
    return parsed.data as SystemParamValue<K>;
  }

  async list(): Promise<SystemParamDto[]> {
    const rows = await this.prisma.systemParam.findMany();
    return SYSTEM_PARAM_KEYS.map((key) => {
      const def = SYSTEM_PARAMS[key];
      const row = rows.find((r) => r.key === key);
      const parsed = row ? def.schema.safeParse(row.value) : null;
      return {
        key,
        value: parsed?.success ? parsed.data : def.defaultValue,
        defaultValue: def.defaultValue,
        descZh: def.descZh,
        descEn: def.descEn,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async set(actor: AuthUser, key: string, value: unknown): Promise<SystemParamDto> {
    if (!isSystemParamKey(key)) throw new AppException('NOT_FOUND');
    const parsed = SYSTEM_PARAMS[key].schema.safeParse(value);
    if (!parsed.success) {
      throw new AppException('PARAM_INVALID', { key }, parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })));
    }
    if (key === 'seal.preOpenViewRoles') {
      const codes = parsed.data as string[];
      const found = await this.prisma.role.count({ where: { code: { in: codes } } });
      if (found !== new Set(codes).size) throw new AppException('PARAM_INVALID', { key });
    }
    const before = await this.get(key);
    await this.prisma.$transaction(async (tx) => {
      const json = parsed.data as Prisma.InputJsonValue;
      await tx.systemParam.upsert({
        where: { key },
        create: { key, value: json, updatedById: actor.id },
        update: { value: json, updatedById: actor.id },
      });
      await this.audit.log(
        { actor, action: 'param.update', entityType: 'systemParam', entityId: key, detail: { before, after: json } as Prisma.InputJsonValue },
        tx,
      );
    });
    return (await this.list()).find((p) => p.key === key)!;
  }
}

@Controller()
export class ParamsController {
  constructor(private readonly params: ParamsService) {}

  @RequirePermissions('system:param:manage')
  @Get('system/params')
  list(): Promise<SystemParamDto[]> {
    return this.params.list();
  }

  @RequirePermissions('system:param:manage')
  @Put('system/params/:key')
  update(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(updateParamSchema)) body: UpdateParamInput,
  ): Promise<SystemParamDto> {
    return this.params.set(user, key, body.value);
  }

  /** 登录页、门户顶栏等未登录也需要的配置 */
  @Public()
  @Get('public/app-config')
  async appConfig(): Promise<AppConfigDto> {
    const [company, uploadLimits] = await Promise.all([this.params.get('company.profile'), this.params.get('upload.limits')]);
    return { company, uploadLimits };
  }
}

@Global()
@Module({ controllers: [ParamsController], providers: [ParamsService], exports: [ParamsService] })
export class ParamsModule {}
