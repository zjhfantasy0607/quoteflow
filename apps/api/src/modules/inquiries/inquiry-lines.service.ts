import { Injectable } from '@nestjs/common';
import type {
  CreateLineInput,
  InquiryLineDto,
  InquiryRoundDto,
  LinesFromMaterialsInput,
  ReorderLinesInput,
  UpdateLineInput,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { changedFields } from '../../common/audit-diff';
import { AppException } from '../../common/errors/app.exception';
import type { InquiryLine, Material, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DictsService } from '../dicts/dicts.service';
import { CategoryIndex, MaterialCategoriesService } from '../material-categories/material-categories.service';
import { MaterialsService } from '../materials/materials.service';
import { InquiryAccessService } from './inquiry-access.service';
import { loadLine, toInquiryFileDto, toInquiryLineDto } from './inquiry-dto';
import { InquiriesService } from './inquiries.service';

/** 写入询价行的字段（roundId、lineNo 由 append 决定）；Excel 导入也用它 */
export interface LineData {
  materialId: string | null;
  materialCode: string | null;
  nameZh: string;
  nameEn: string | null;
  spec: string;
  unitCode: string;
  categoryId: string;
  /** 规范的十进制字符串 */
  quantity: string;
  brand: string | null;
  drawingRef: string | null;
  remark: string | null;
}

/** 审计比较新旧值时数量用字符串 */
const auditView = (line: InquiryLine) => ({ ...line, quantity: line.quantity.toFixed() });

/** 第 1 轮询价行（R06-2、R06-3）；M13 的变更轮次复用 */
@Injectable()
export class InquiryLinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InquiryAccessService,
    private readonly inquiries: InquiriesService,
    private readonly categories: MaterialCategoriesService,
    private readonly materials: MaterialsService,
    private readonly dicts: DictsService,
    private readonly audit: AuditService,
  ) {}

  async create(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: CreateLineInput,
  ): Promise<InquiryLineDto> {
    const lineId = await this.prisma.$transaction(async (tx) => {
      const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
      const index = await this.categories.loadIndex(tx);
      const data =
        input.source === 'MATERIAL'
          ? await this.materialLineData(tx, index, input.materialId, input)
          : await this.manualLineData(tx, index, input, null);
      const [created] = await this.append(tx, round.id, [data]);
      await this.audit.log(
        {
          actor: user,
          action: 'inquiryLine.create',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `#${created.lineNo} ${created.nameZh}`,
          detail: { roundNo, materialCode: created.materialCode },
        },
        tx,
      );
      return created.id;
    });
    return this.lineDto(lineId);
  }

  /** "从材料库选用"多选：按选择的顺序追加在已有行之后 */
  async createFromMaterials(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: LinesFromMaterialsInput,
  ): Promise<InquiryLineDto[]> {
    const ids = await this.prisma.$transaction(async (tx) => {
      const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
      const index = await this.categories.loadIndex(tx);
      const data: LineData[] = [];
      for (const [i, item] of input.items.entries()) {
        data.push(await this.materialLineData(tx, index, item.materialId, item, `items.${i}.materialId`));
      }
      const created = await this.append(tx, round.id, data);
      await this.audit.log(
        {
          actor: user,
          action: 'inquiryLine.create',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `#${created[0].lineNo}-#${created[created.length - 1].lineNo} (${created.length})`,
          detail: { roundNo, materialCodes: created.map((l) => l.materialCode) },
        },
        tx,
      );
      return created.map((l) => l.id);
    });
    const result: InquiryLineDto[] = [];
    for (const id of ids) result.push(await this.lineDto(id));
    return result;
  }

  /** source 必须与行的来源一致；材料行只能改数量、品牌、图纸编号和备注 */
  async update(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    lineId: string,
    input: UpdateLineInput,
  ): Promise<InquiryLineDto> {
    await this.prisma.$transaction(async (tx) => {
      const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
      const before = await this.findLine(tx, round.id, lineId);
      if ((before.materialId ? 'MATERIAL' : 'MANUAL') !== input.source) {
        throw new AppException('VALIDATION_FAILED', undefined, [
          { path: 'source', code: 'invalid_value', message: 'source does not match the line' },
        ]);
      }
      const index = await this.categories.loadIndex(tx);
      // 材料行的名称、规格、单位、分类取自材料库，不能改（B-14）
      const data: Partial<LineData> =
        input.source === 'MATERIAL'
          ? {
              quantity: input.quantity,
              brand: input.brand ?? null,
              drawingRef: input.drawingRef ?? null,
              remark: input.remark ?? null,
            }
          : await this.manualLineData(tx, index, input, before);
      const changes = changedFields(auditView(before), data);
      if (Object.keys(changes).length > 0) {
        await tx.inquiryLine.update({ where: { id: lineId }, data });
        await this.audit.log(
          {
            actor: user,
            action: 'inquiryLine.update',
            entityType: 'inquiry',
            entityId: inquiryId,
            summary: `#${before.lineNo} ${data.nameZh ?? before.nameZh}`,
            detail: { roundNo, changes },
          },
          tx,
        );
      }
    });
    return this.lineDto(lineId);
  }

  /** 删除后后面的行依次前移（R06-3）；行上的附件挂载一起删除 */
  async remove(user: AuthUser, inquiryId: string, roundNo: number, lineId: string): Promise<InquiryRoundDto> {
    await this.prisma.$transaction(async (tx) => {
      const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
      const line = await this.findLine(tx, round.id, lineId);
      await tx.inquiryLine.delete({ where: { id: lineId } });
      const rest = await tx.inquiryLine.findMany({
        where: { roundId: round.id },
        select: { id: true },
        orderBy: { lineNo: 'asc' },
      });
      await this.renumber(
        tx,
        round.id,
        rest.map((l) => l.id),
      );
      await this.audit.log(
        {
          actor: user,
          action: 'inquiryLine.delete',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `#${line.lineNo} ${line.nameZh}`,
          detail: { roundNo },
        },
        tx,
      );
    });
    return this.inquiries.roundDetail(this.prisma, user, inquiryId, roundNo);
  }

  /** R06-3：lineIds 必须恰好是本轮的全部行，按它的顺序重新编号 */
  async reorder(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    input: ReorderLinesInput,
  ): Promise<InquiryRoundDto> {
    await this.prisma.$transaction(async (tx) => {
      const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
      const lines = await tx.inquiryLine.findMany({ where: { roundId: round.id }, select: { id: true } });
      const current = new Set(lines.map((l) => l.id));
      const sameSet =
        input.lineIds.length === current.size &&
        new Set(input.lineIds).size === current.size &&
        input.lineIds.every((id) => current.has(id));
      if (!sameSet) {
        throw new AppException('VALIDATION_FAILED', undefined, [
          {
            path: 'lineIds',
            code: 'invalid_value',
            message: 'lineIds must list every line of the round once',
          },
        ]);
      }
      await this.renumber(tx, round.id, input.lineIds);
      await this.audit.log(
        {
          actor: user,
          action: 'inquiryLine.reorder',
          entityType: 'inquiry',
          entityId: inquiryId,
          summary: `${input.lineIds.length}`,
          detail: { roundNo },
        },
        tx,
      );
    });
    return this.inquiries.roundDetail(this.prisma, user, inquiryId, roundNo);
  }

  /** 追加在已有行之后，返回新行（按行号）。调用方已锁住询价单，行号不会并发冲突 */
  async append(tx: Prisma.TransactionClient, roundId: string, data: LineData[]): Promise<InquiryLine[]> {
    const start = (await tx.inquiryLine.count({ where: { roundId } })) + 1;
    const rows = await tx.inquiryLine.createManyAndReturn({
      data: data.map((d, i) => ({ ...d, roundId, lineNo: start + i })),
    });
    // createManyAndReturn 不保证返回顺序
    return rows.sort((a, b) => a.lineNo - b.lineNo);
  }

  /**
   * 按给定顺序把行号重排为 1..n。(roundId, lineNo) 有唯一约束且逐行检查，
   * 所以先把本轮行号全部变成负数，再一次写入新行号
   */
  private async renumber(tx: Prisma.TransactionClient, roundId: string, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    await tx.$executeRaw`UPDATE "InquiryLine" SET "lineNo" = -"lineNo" WHERE "roundId" = ${roundId}`;
    const numbers = orderedIds.map((_, i) => i + 1);
    await tx.$executeRaw`
      UPDATE "InquiryLine" AS l SET "lineNo" = v.no
      FROM unnest(${orderedIds}::text[], ${numbers}::int[]) AS v(id, no)
      WHERE l."id" = v.id AND l."roundId" = ${roundId}`;
  }

  /** 从材料库选用：材料必须启用（MATERIAL_DISABLED），它的分类必须有效启用（CATEGORY_DISABLED） */
  private async materialLineData(
    tx: Prisma.TransactionClient,
    index: CategoryIndex,
    materialId: string,
    input: { quantity: string; brand?: string; drawingRef?: string; remark?: string },
    path = 'materialId',
  ): Promise<LineData> {
    const material: Material = await this.materials.assertSelectable(materialId, tx, path);
    index.assertSelectable(material.categoryId, path);
    return {
      materialId: material.id,
      materialCode: material.code,
      nameZh: material.nameZh,
      nameEn: material.nameEn,
      spec: material.spec,
      unitCode: material.unitCode,
      categoryId: material.categoryId,
      quantity: input.quantity,
      brand: input.brand ?? material.brand,
      drawingRef: input.drawingRef ?? null,
      remark: input.remark ?? null,
    };
  }

  /** 手工行：单位必须是启用的字典项，分类必须有效启用；修改时只校验改动了的单位、分类 */
  private async manualLineData(
    tx: Prisma.TransactionClient,
    index: CategoryIndex,
    input: Extract<CreateLineInput, { source: 'MANUAL' }>,
    before: InquiryLine | null,
  ): Promise<LineData> {
    if (input.unitCode !== before?.unitCode) await this.dicts.assertEnabled('unit', input.unitCode, tx);
    if (input.categoryId !== before?.categoryId) index.assertSelectable(input.categoryId);
    return {
      materialId: null,
      materialCode: input.materialCode ?? null,
      nameZh: input.nameZh,
      nameEn: input.nameEn ?? null,
      spec: input.spec,
      unitCode: input.unitCode,
      categoryId: input.categoryId,
      quantity: input.quantity,
      brand: input.brand ?? null,
      drawingRef: input.drawingRef ?? null,
      remark: input.remark ?? null,
    };
  }

  private async findLine(
    tx: Prisma.TransactionClient,
    roundId: string,
    lineId: string,
  ): Promise<InquiryLine> {
    const line = await tx.inquiryLine.findFirst({ where: { id: lineId, roundId } });
    if (!line) throw new AppException('NOT_FOUND');
    return line;
  }

  /** 事务提交后再取（与 InquiriesService.detail 一样不在事务里查） */
  private async lineDto(id: string): Promise<InquiryLineDto> {
    const { line, files } = await loadLine(this.prisma, id);
    return toInquiryLineDto(line, files.map(toInquiryFileDto), await this.categories.loadIndex());
  }
}
