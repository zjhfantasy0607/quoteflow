import { Injectable, OnModuleInit } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import type { FileObject } from '../../generated/prisma/client';
import { FileAccessRegistry, type FileAccessDecision, type FileAccessResolver } from '../../infra/files/file-access.registry';
import { PrismaService } from '../../prisma/prisma.service';

/** 材料图片：挂到材料上之后所有内部用户可读，供应商不可读；不记访问日志 */
@Injectable()
export class MaterialImageResolver implements FileAccessResolver, OnModuleInit {
  readonly name = 'materialImage';

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: FileAccessRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(file: FileObject, user: AuthUser): Promise<FileAccessDecision | null> {
    if (!(await this.isReferenced(file.id))) return null;
    return { allow: user.userType === 'INTERNAL' };
  }

  async isReferenced(fileId: string): Promise<boolean> {
    return (await this.prisma.material.count({ where: { imageFileId: fileId } })) > 0;
  }
}
