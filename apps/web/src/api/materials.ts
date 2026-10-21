import type {
  CreateCategoryInput,
  CreateMaterialInput,
  EnableStatus,
  ImportResultDto,
  MaterialCategoryDto,
  MaterialCategoryNodeDto,
  MaterialDto,
  MaterialExportQuery,
  MaterialListQuery,
  Paginated,
  UpdateCategoryInput,
  UpdateMaterialInput,
} from '@quoteflow/shared';
import { downloadFile } from '@/utils/download';
import { del, get, http, post, put } from './http';

export const materialCategoriesApi = {
  /** includeDisabled=false 时只返回有效启用的节点 */
  tree: (includeDisabled: boolean) =>
    get<MaterialCategoryNodeDto[]>('/material-categories/tree', { includeDisabled: String(includeDisabled) }),
  create: (body: CreateCategoryInput) => post<MaterialCategoryDto>('/material-categories', body, { silent: true }),
  update: (id: string, body: UpdateCategoryInput) =>
    put<MaterialCategoryDto>(`/material-categories/${id}`, body, { silent: true }),
  setStatus: (id: string, status: EnableStatus) =>
    put<MaterialCategoryDto>(`/material-categories/${id}/status`, { status }),
  remove: (id: string) => del<{ ok: true }>(`/material-categories/${id}`),
};

export const materialsApi = {
  list: (query: Partial<MaterialListQuery>) => get<Paginated<MaterialDto>>('/materials', query),
  get: (id: string) => get<MaterialDto>(`/materials/${id}`),
  create: (body: CreateMaterialInput) => post<MaterialDto>('/materials', body, { silent: true }),
  update: (id: string, body: UpdateMaterialInput) => put<MaterialDto>(`/materials/${id}`, body, { silent: true }),
  setStatus: (id: string, status: EnableStatus) => put<MaterialDto>(`/materials/${id}/status`, { status }),
  /** 导入模板地址（ExcelImportDialog 用链接下载） */
  templateUrl: '/api/materials/import-template',
  /** 错误由 ExcelImportDialog 展示 */
  import: async (file: File): Promise<ImportResultDto> => {
    const form = new FormData();
    form.append('file', file);
    return (await http.post<ImportResultDto>('/materials/import', form, { silent: true })).data;
  },
  export: (query: Partial<MaterialExportQuery>) => downloadFile('/materials/export', query),
};
