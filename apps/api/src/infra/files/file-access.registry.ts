import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import type { FileObject } from '../../generated/prisma/client';

/** 解析器对某个文件的判断；文件不归它管时返回 null */
export interface FileAccessDecision {
  allow: boolean;
  /** 需要写 FileAccessLog 时给出上下文（询价附件、报价附件等） */
  log?: { inquiryId: string | null; supplierId: string | null };
}

/**
 * 各业务模块注册自己的解析器：根据文件被谁引用判断当前用户能否访问（docs/01 §9）。
 * 例如询价附件解析器（M06/M08）、材料图片解析器（M03）、合同附件解析器（M14）。
 */
export interface FileAccessResolver {
  readonly name: string;
  resolve(file: FileObject, user: AuthUser): Promise<FileAccessDecision | null>;
  /** 清理任务用：文件是否还被本模块引用 */
  isReferenced(fileId: string): Promise<boolean>;
}

@Injectable()
export class FileAccessRegistry {
  private readonly resolvers: FileAccessResolver[] = [];

  register(resolver: FileAccessResolver): void {
    if (!this.resolvers.some((r) => r.name === resolver.name)) this.resolvers.push(resolver);
  }

  /**
   * 任一引用方放行即可访问；有引用但都不放行则拒绝；
   * 没有任何引用（刚上传、还没挂到业务对象上）时只有上传者本人可以访问（R02-5）。
   */
  async check(file: FileObject, user: AuthUser): Promise<FileAccessDecision> {
    const decisions: FileAccessDecision[] = [];
    for (const resolver of this.resolvers) {
      const decision = await resolver.resolve(file, user);
      if (decision) decisions.push(decision);
    }
    const allowed = decisions.find((d) => d.allow);
    if (allowed) return allowed;
    if (decisions.length > 0) return { allow: false };
    return { allow: file.uploadedById === user.id };
  }

  async isReferenced(fileId: string): Promise<boolean> {
    for (const resolver of this.resolvers) {
      if (await resolver.isReferenced(fileId)) return true;
    }
    return false;
  }
}
