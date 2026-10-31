import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import {
  contractDecisionSchema,
  contractListQuerySchema,
  signedScanSchema,
  updateContractSchema,
  type ContractDecisionInput,
  type ContractDetailDto,
  type ContractListItemDto,
  type ContractListQuery,
  type Paginated,
  type SignedScanInput,
  type UpdateContractInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PplModule } from '../ppl/ppl.controller';
import { SealService } from '../quotes/seal.service';
import { ContractAttachmentResolver } from './contract-attachment.resolver';
import { ContractDraftFactory } from './contract-draft.factory';
import { ContractsService } from './contracts.service';

const decisionPipe = new ZodValidationPipe(contractDecisionSchema);

/** M14 §4：合同列表、详情、编辑与审批流转；数据权限跟随询价单，范围外 404 */
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @RequirePermissions('contract:view')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(contractListQuerySchema)) query: ContractListQuery,
  ): Promise<Paginated<ContractListItemDto>> {
    return this.contracts.list(user, query);
  }

  @RequirePermissions('contract:view')
  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ContractDetailDto> {
    return this.contracts.detail(user, id);
  }

  @RequirePermissions('contract:edit')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateContractSchema)) body: UpdateContractInput,
  ): Promise<ContractDetailDto> {
    return this.contracts.update(user, id, body);
  }

  @RequirePermissions('contract:edit')
  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ContractDetailDto> {
    return this.contracts.submit(user, id);
  }

  @RequirePermissions('contract:review')
  @Post(':id/review')
  @HttpCode(200)
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(decisionPipe) body: ContractDecisionInput,
  ): Promise<ContractDetailDto> {
    return this.contracts.review(user, id, body);
  }

  @RequirePermissions('contract:approve')
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(decisionPipe) body: ContractDecisionInput,
  ): Promise<ContractDetailDto> {
    return this.contracts.approve(user, id, body);
  }

  @RequirePermissions('contract:edit')
  @Post(':id/signed-scan')
  @HttpCode(200)
  signedScan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(signedScanSchema)) body: SignedScanInput,
  ): Promise<ContractDetailDto> {
    return this.contracts.uploadSignedScan(user, id, body);
  }
}

/**
 * 合同（01 §4.1 modules/contracts）：M12 定标时由 ContractDraftFactory 生成草稿，M14 的列表、详情、编辑与流转。
 * InquiriesModule import 本模块（定标用 ContractDraftFactory），所以这里不能反过来 import InquiriesModule
 */
/**
 * InquiriesModule 要 import 这里（定标时生成合同草稿），所以这里不能 import QuotesModule（它 import 了 InquiriesModule）；
 * SealService 只依赖全局的 ParamsService，在这里单独提供一份
 */
@Module({
  imports: [PplModule],
  controllers: [ContractsController],
  providers: [ContractDraftFactory, ContractsService, ContractAttachmentResolver, SealService],
  exports: [ContractDraftFactory],
})
export class ContractsModule {}
