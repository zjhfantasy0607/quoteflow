import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

/** 文件存储驱动。本期只实现本地磁盘，确定云厂商后再加 S3 兼容驱动（A-20） */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  getStream(key: string): Readable;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(process.cwd(), dir);
  }

  /** 防止 key 里出现 .. 逃出存储目录 */
  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  getStream(key: string): Readable {
    return createReadStream(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
