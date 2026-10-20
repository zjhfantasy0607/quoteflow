import { Injectable } from '@nestjs/common';
import type { FieldPermissionCode } from '@quoteflow/shared';
import type { AuthUser } from './auth-user';

export type Masked<T> = T & { maskedFields?: string[] };

/**
 * 字段权限脱敏（docs/05 §10）：没有对应字段码时把这些字段置为 null，并在对象上记录 maskedFields。
 * 供应商用户不经过这里（门户只返回自己的数据）。
 */
@Injectable()
export class FieldMaskService {
  can(user: Pick<AuthUser, 'fieldPermissions'>, code: FieldPermissionCode): boolean {
    return user.fieldPermissions.has(code);
  }

  mask<T extends object>(
    obj: T,
    user: Pick<AuthUser, 'fieldPermissions'>,
    code: FieldPermissionCode,
    keys: readonly (keyof T & string)[],
  ): Masked<T> {
    if (this.can(user, code)) return obj;
    const out = { ...obj } as Record<string, unknown>;
    for (const key of keys) out[key] = null;
    const previous = (out.maskedFields as string[] | undefined) ?? [];
    out.maskedFields = [...new Set([...previous, ...keys])];
    return out as Masked<T>;
  }

  /** 供应商联系方式：联系电话、联系邮箱、抄送邮箱 */
  supplierContact<T extends { contactEmail: unknown; contactPhone: unknown; ccEmails: unknown }>(
    supplier: T,
    user: Pick<AuthUser, 'fieldPermissions'>,
  ): Masked<T> {
    return this.mask(supplier, user, 'supplier.contact', ['contactEmail', 'contactPhone', 'ccEmails']);
  }
}
