import type {
  AppConfigDto,
  AuditListQuery,
  AuditLogDto,
  CreateDictItemInput,
  CreatePplSetInput,
  CreateDictTypeInput,
  CreateRoleInput,
  CreateUserInput,
  DictItemDto,
  DictMapDto,
  DictTypeDto,
  EmailDetailDto,
  EmailListItemDto,
  EmailListQuery,
  Paginated,
  PermissionCatalogDto,
  PplActiveVariantsDto,
  PplSetDto,
  PplSetSummaryDto,
  RoleDto,
  SystemParamDto,
  UpdateDictItemInput,
  UpdateDictTypeInput,
  UpdateRoleInput,
  UpdateUserInput,
  UserDto,
  UserListQuery,
} from '@quoteflow/shared';
import { del, get, post, put } from './http';

export const usersApi = {
  list: (query: Partial<UserListQuery>) => get<Paginated<UserDto>>('/system/users', query),
  create: (body: CreateUserInput) => post<UserDto>('/system/users', body, { silent: true }),
  update: (id: string, body: UpdateUserInput) => put<UserDto>(`/system/users/${id}`, body, { silent: true }),
  setStatus: (id: string, status: 'ACTIVE' | 'DISABLED') => put<UserDto>(`/system/users/${id}/status`, { status }),
  resetPassword: (id: string, newPassword: string) =>
    post<{ ok: true }>(`/system/users/${id}/reset-password`, { newPassword }),
};

export const rolesApi = {
  catalog: () => get<PermissionCatalogDto>('/system/permissions'),
  list: () => get<RoleDto[]>('/system/roles'),
  create: (body: CreateRoleInput) => post<RoleDto>('/system/roles', body, { silent: true }),
  update: (id: string, body: UpdateRoleInput) => put<RoleDto>(`/system/roles/${id}`, body, { silent: true }),
  remove: (id: string) => del<{ ok: true }>(`/system/roles/${id}`),
};

export const dictsApi = {
  load: (types: string[]) => get<DictMapDto>('/dicts', { types: types.join(',') }),
};

export const dictAdminApi = {
  types: () => get<DictTypeDto[]>('/system/dict-types'),
  createType: (body: CreateDictTypeInput) => post<{ ok: true }>('/system/dict-types', body, { silent: true }),
  updateType: (code: string, body: UpdateDictTypeInput) =>
    put<{ ok: true }>(`/system/dict-types/${code}`, body, { silent: true }),
  deleteType: (code: string) => del<{ ok: true }>(`/system/dict-types/${code}`),
  items: (typeCode: string) => get<DictItemDto[]>(`/system/dict-types/${typeCode}/items`),
  createItem: (typeCode: string, body: CreateDictItemInput) =>
    post<DictItemDto>(`/system/dict-types/${typeCode}/items`, body, { silent: true }),
  updateItem: (id: string, body: UpdateDictItemInput) =>
    put<DictItemDto>(`/system/dict-items/${id}`, body, { silent: true }),
  deleteItem: (id: string) => del<{ ok: true }>(`/system/dict-items/${id}`),
};

export const paramsApi = {
  list: () => get<SystemParamDto[]>('/system/params'),
  update: (key: string, value: unknown) => put<SystemParamDto>(`/system/params/${key}`, { value }, { silent: true }),
  /** 公司名称、上传限制等公共配置（未登录也能取） */
  appConfig: () => get<AppConfigDto>('/public/app-config', undefined, { silent: true, skipAuthRedirect: true }),
};

export const emailsApi = {
  list: (query: Partial<EmailListQuery>) => get<Paginated<EmailListItemDto>>('/system/emails', query),
  detail: (id: string) => get<EmailDetailDto>(`/system/emails/${id}`),
  resend: (id: string) => post<EmailListItemDto>(`/system/emails/${id}/resend`),
};

export const auditApi = {
  list: (query: Partial<AuditListQuery>) => get<Paginated<AuditLogDto>>('/system/audit-logs', query),
};

export const pplApi = {
  list: () => get<PplSetSummaryDto[]>('/ppl/sets'),
  detail: (version: number) => get<PplSetDto>(`/ppl/sets/${version}`),
  /** 定义校验失败返回 PPL_DEFINITION_INVALID + 逐条问题，由上传对话框展示 */
  create: (body: CreatePplSetInput) => post<PplSetDto>('/ppl/sets', body, { silent: true }),
  activate: (version: number) => post<PplSetDto>(`/ppl/sets/${version}/activate`),
  /** 当前激活版本的主模板与变体（材料分类表单的下拉） */
  activeVariants: () => get<PplActiveVariantsDto>('/ppl/variants'),
};
