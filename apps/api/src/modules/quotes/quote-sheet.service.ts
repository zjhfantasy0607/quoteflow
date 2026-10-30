import { Injectable } from '@nestjs/common';
import type { PplColumn, PplDictLookup, PplResolvedDto } from '@quoteflow/shared';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { PplDictOption, PplExcelLine } from '../ppl/ppl-excel.service';
import { PplService, resolveVariantColumns } from '../ppl/ppl.service';

type Client = PrismaService | Prisma.TransactionClient;

/** 枚举列的启用选项 → 取值校验用的编码表 */
export function dictLookup(options: Readonly<Record<string, readonly PplDictOption[]>>): PplDictLookup {
  return Object.fromEntries(Object.entries(options).map(([type, list]) => [type, list.map((o) => o.code)]));
}

/**
 * 报价表的"表头"和"行"：该轮冻结的模板（04 §2）、询价行与预填数据、枚举列的字典选项。
 * 门户填报、锁定 Excel、采购方查看报价共用；可以在事务里调用（查询依次执行）
 */
@Injectable()
export class QuoteSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ppl: PplService,
  ) {}

  /** R09-2：表单列来自该轮发布时冻结的模板版本和变体，激活新版本不影响进行中的轮次 */
  async template(
    round: { pplTemplateVersion: number | null; pplVariantCode: string | null },
    client: Client = this.prisma,
  ): Promise<PplResolvedDto> {
    const { pplTemplateVersion: version, pplVariantCode: variantCode } = round;
    // 发布时一定写入（M07），没有说明数据不完整
    if (version === null || variantCode === null) throw new Error('Round has no frozen PPL template');
    const definition = await this.ppl.definition(version, client);
    return {
      version,
      variantCode,
      groups: definition.groups,
      columns: resolveVariantColumns(definition, variantCode),
    };
  }

  /** 询价行（按行号）与预填列的数据：单位名称取字典（停用的单位也照样显示），币种取询价单 */
  async lines(roundId: string, currency: string, client: Client = this.prisma): Promise<PplExcelLine[]> {
    const lines = await client.inquiryLine.findMany({
      where: { roundId },
      include: { category: true },
      orderBy: { lineNo: 'asc' },
    });
    const units = await client.dictItem.findMany({
      where: { typeCode: 'unit', code: { in: [...new Set(lines.map((l) => l.unitCode))] } },
    });
    const unitOf = new Map(units.map((u) => [u.code, u]));
    return lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      materialCode: l.materialCode,
      nameZh: l.nameZh,
      nameEn: l.nameEn,
      categoryNameZh: l.category.nameZh,
      categoryNameEn: l.category.nameEn,
      spec: l.spec,
      unitNameZh: unitOf.get(l.unitCode)?.nameZh ?? l.unitCode,
      unitNameEn: unitOf.get(l.unitCode)?.nameEn ?? null,
      quantity: l.quantity.toFixed(),
      drawingRef: l.drawingRef,
      currency,
    }));
  }

  /** 供应商填写的枚举列的启用选项（dictType → 选项，按排序号） */
  async dictOptions(
    columns: readonly PplColumn[],
    client: Client = this.prisma,
  ): Promise<Record<string, PplDictOption[]>> {
    const types = [
      ...new Set(columns.filter((c) => c.source === 'supplier' && c.dictType).map((c) => c.dictType!)),
    ];
    const items = await client.dictItem.findMany({
      where: { typeCode: { in: types }, status: 'ENABLED' },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    });
    const options: Record<string, PplDictOption[]> = Object.fromEntries(types.map((t) => [t, []]));
    for (const i of items) options[i.typeCode].push({ code: i.code, nameZh: i.nameZh, nameEn: i.nameEn });
    return options;
  }
}
