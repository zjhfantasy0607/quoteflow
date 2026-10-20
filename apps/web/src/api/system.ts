import type {
  CreateRoleInput,
  CreateUserInput,
  DictMapDto,
  Paginated,
  PermissionCatalogDto,
  RoleDto,
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
