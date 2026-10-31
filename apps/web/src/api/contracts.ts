import type {
  ContractDecisionInput,
  ContractDetailDto,
  ContractListItemDto,
  ContractListParams,
  Paginated,
  UpdateContractParams,
} from '@quoteflow/shared';
import { get, post, put } from './http';

/** 合同管理（M14）：每个动作返回最新详情 */
export const contractsApi = {
  list: (query: Partial<ContractListParams>) => get<Paginated<ContractListItemDto>>('/contracts', query),
  /** 404 由页面自己提示 */
  get: (id: string) => get<ContractDetailDto>(`/contracts/${id}`, undefined, { silent: true }),
  update: (id: string, body: UpdateContractParams) => put<ContractDetailDto>(`/contracts/${id}`, body),
  submit: (id: string) => post<ContractDetailDto>(`/contracts/${id}/submit`),
  review: (id: string, body: ContractDecisionInput) =>
    post<ContractDetailDto>(`/contracts/${id}/review`, body),
  approve: (id: string, body: ContractDecisionInput) =>
    post<ContractDetailDto>(`/contracts/${id}/approve`, body),
  signedScan: (id: string, fileId: string) =>
    post<ContractDetailDto>(`/contracts/${id}/signed-scan`, { fileId }),
};
