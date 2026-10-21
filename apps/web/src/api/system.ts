import type {
  AppConfigDto,
  AuditListQuery,
  AuditLogDto,
  CreateDictItemInput,
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
