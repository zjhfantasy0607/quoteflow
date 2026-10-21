import { Global, Injectable, Module } from '@nestjs/common';
import { inAppTz } from '../../common/time';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Client = PrismaService | Prisma.TransactionClient;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** MAT-000001 */
export const formatMaterialCode = (n: number) => `MAT-${pad(n, 6)}`;

/** 业务编号（docs/01 §13）：INSERT ... ON CONFLICT 原子自增，并发安全；日期按 UTC+8 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(key: string, client: Client = this.prisma): Promise<number> {
    return this.nextRange(key, 1, client);
  }

  /** 一次取 count 个连续的号（批量导入用），返回第一个 */
  async nextRange(key: string, count: number, client: Client = this.prisma): Promise<number> {
    const rows = await client.$queryRaw<{ value: number }[]>`
      INSERT INTO "Sequence" ("key", "value") VALUES (${key}, ${count})
      ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + ${count}
      RETURNING "value"`;
    return rows[0].value - count + 1;
  }

  /** 种子数据用：保证计数器至少为 value（下一个号从 value + 1 开始） */
  async ensureAtLeast(key: string, value: number, client: Client = this.prisma): Promise<void> {
    await client.$executeRaw`
      INSERT INTO "Sequence" ("key", "value") VALUES (${key}, ${value})
      ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Sequence"."value", ${value})`;
  }

  /** DR-20261026-0001（每天重新计数） */
  async draftNo(now: Date, client: Client = this.prisma): Promise<string> {
    const day = inAppTz(now).format('YYYYMMDD');
    return `DR-${day}-${pad(await this.next(`DR:${day}`, client), 4)}`;
  }

  /** RFQ-202610-0001（每月重新计数） */
  async formalNo(now: Date, client: Client = this.prisma): Promise<string> {
    const month = inAppTz(now).format('YYYYMM');
    return `RFQ-${month}-${pad(await this.next(`RFQ:${month}`, client), 4)}`;
  }

  /** CT-202611-0001（每月重新计数） */
  async contractNo(now: Date, client: Client = this.prisma): Promise<string> {
    const month = inAppTz(now).format('YYYYMM');
    return `CT-${month}-${pad(await this.next(`CT:${month}`, client), 4)}`;
  }

  /** MAT-000001（全局）。可能和手填的编码撞号，材料模块取号时会跳过已占用的 */
  async materialCode(client: Client = this.prisma): Promise<string> {
    return formatMaterialCode(await this.next('MAT', client));
  }

  /** SUP10001 起（全局） */
  async supplierCode(client: Client = this.prisma): Promise<string> {
    return `SUP${10000 + (await this.next('SUP', client))}`;
  }
}

@Global()
@Module({ providers: [SequenceService], exports: [SequenceService] })
export class SequenceModule {}
