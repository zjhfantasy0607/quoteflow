import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import type { UserType } from '@quoteflow/shared';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, USER_TYPES_KEY } from '../../src/common/auth/decorators';

/** 应用里的一个接口，以及守卫判断用的元数据（与 guards.ts 的读取方式一致：方法上的覆盖类上的） */
export interface RouteInfo {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** 带全局前缀，如 /api/inquiries/:id/submit */
  path: string;
  /** Controller.method */
  handler: string;
  isPublic: boolean;
  userTypes: UserType[];
  /** undefined = 没写 @RequirePermissions */
  permissions: string[] | undefined;
}

const METHODS: Partial<Record<RequestMethod, RouteInfo['method']>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
};

const join = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/');

/** 列出全部 controller 的全部接口 */
export function listRoutes(app: INestApplication, prefix = 'api'): RouteInfo[] {
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype as (new (...args: unknown[]) => object) | null;
      if (!type) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, type) as string | undefined) ?? '';
      for (const name of scanner.getAllMethodNames(type.prototype)) {
        const fn = (type.prototype as Record<string, unknown>)[name] as object;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
        const verb = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
        if (sub === undefined || verb === undefined) continue;
        const pick = <T>(key: string): T | undefined =>
          (Reflect.getMetadata(key, fn) as T | undefined) ??
          (Reflect.getMetadata(key, type) as T | undefined);
        routes.push({
          method: METHODS[verb]!,
          path: join(prefix, base, sub),
          handler: `${type.name}.${name}`,
          isPublic: pick<boolean>(IS_PUBLIC_KEY) === true,
          userTypes: pick<UserType[]>(USER_TYPES_KEY) ?? ['INTERNAL'],
          permissions: pick<string[]>(PERMISSIONS_KEY),
        });
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * 把路径参数换成真实值：轮次号、版本号是 1，字典类型编码是 currency，:quoteId 取 ids.quote，
 * 其余 :id 按资源前缀取（/api/inquiries/:id → ids.inquiries，/api/system/users/:id → ids['system/users']）；
 * 找不到时返回 null（调用方跳过）
 */
export function fillPath(path: string, ids: Record<string, string>): string | null {
  const [, , seg, sub] = path.split('/');
  const resource = seg === 'system' ? `system/${sub}` : seg;
  let missing = false;
  const url = path.replace(/:(\w+)/g, (_, name: string) => {
    if (['roundNo', 'versionNo', 'version'].includes(name)) return '1';
    if (name === 'code') return 'currency';
    const id = name === 'quoteId' ? ids.quote : ids[resource];
    if (!id) missing = true;
    return id ?? '';
  });
  return missing ? null : url;
}

/** 需要查询参数的 GET 接口 */
export const ROUTE_QUERY: Record<string, string> = {
  '/api/dicts': '?types=currency,unit',
  '/api/ppl/resolve': '?version=1&variant=PPL-LED',
};
