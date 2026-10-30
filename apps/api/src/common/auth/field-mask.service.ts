import { Injectable } from '@nestjs/common';
import type { FieldPermissionCode, PplColumn, PplValue } from '@quoteflow/shared';
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

  /**
   * 报价金额（05 §10、S-5）：合计和 PPL 里 sensitive 的列。没有 quote.amount 时合计、每行这些列的值都为 null，
   * maskedFields 记 totalAmount 和这些列的 key。只用于开标后（或有开标前查看授权）的采购方，密封由 SealService 判断
   */
  quoteVersion<
    T extends { totalAmount: string | null; lines?: { values: Record<string, PplValue | null> }[] },
  >(version: T, columns: readonly PplColumn[], user: Pick<AuthUser, 'fieldPermissions'>): Masked<T> {
    if (this.can(user, 'quote.amount')) return version;
    const keys = columns.filter((c) => c.sensitive).map((c) => c.key);
    const hidden = Object.fromEntries(keys.map((key) => [key, null]));
    const masked = this.mask(version, user, 'quote.amount', ['totalAmount']);
    return {
      ...masked,
      ...(version.lines
        ? { lines: version.lines.map((l) => ({ ...l, values: { ...l.values, ...hidden } })) }
        : {}),
      maskedFields: [...new Set([...(masked.maskedFields ?? []), ...keys])],
    };
  }
}
