import type {
  CreateDictItemInput,
  CreateSupplierAccountInput,
  CreateSupplierInput,
  DictItemDto,
  EnableStatus,
  ImportResultDto,
  Paginated,
  SupplierAccountDto,
  SupplierDto,
  SupplierExportParams,
  SupplierListParams,
  UpdateDictItemInput,
  UpdateSupplierInput,
} from '@quoteflow/shared';
import { downloadFile } from '@/utils/download';
import { get, http, post, put } from './http';

export const suppliersApi = {
  /** categoryCodes 是逗号分隔的分类编码 */
  list: (query: SupplierListParams) => get<Paginated<SupplierDto>>('/suppliers', query),
  get: (id: string) => get<SupplierDto>(`/suppliers/${id}`),
  create: (body: CreateSupplierInput) => post<SupplierDto>('/suppliers', body, { silent: true }),
  update: (id: string, body: UpdateSupplierInput) =>
    put<SupplierDto>(`/suppliers/${id}`, body, { silent: true }),
  setStatus: (id: string, status: EnableStatus) => put<SupplierDto>(`/suppliers/${id}/status`, { status }),
  /** 导入模板地址（ExcelImportDialog 用链接下载） */
  templateUrl: '/api/suppliers/import-template',
  /** 错误由 ExcelImportDialog 展示 */
  import: async (file: File): Promise<ImportResultDto> => {
    const form = new FormData();
    form.append('file', file);
    return (await http.post<ImportResultDto>('/suppliers/import', form, { silent: true })).data;
  },
  export: (query: SupplierExportParams) => downloadFile('/suppliers/export', query),
};

export const supplierAccountsApi = {
  list: (supplierId: string) => get<SupplierAccountDto[]>(`/suppliers/${supplierId}/accounts`),
  create: (supplierId: string, body: CreateSupplierAccountInput) =>
    post<SupplierAccountDto>(`/suppliers/${supplierId}/accounts`, body, { silent: true }),
  resendActivation: (supplierId: string, userId: string) =>
    post<SupplierAccountDto>(`/suppliers/${supplierId}/accounts/${userId}/resend-activation`),
  setStatus: (supplierId: string, userId: string, status: 'ACTIVE' | 'DISABLED') =>
    put<SupplierAccountDto>(`/suppliers/${supplierId}/accounts/${userId}/status`, { status }),
};

/** 供应商分类（supplier_category 字典，含停用的） */
export const supplierCategoriesApi = {
  list: () => get<DictItemDto[]>('/supplier-categories'),
  create: (body: CreateDictItemInput) => post<DictItemDto>('/supplier-categories', body, { silent: true }),
  update: (id: string, body: UpdateDictItemInput) =>
    put<DictItemDto>(`/supplier-categories/${id}`, body, { silent: true }),
};
