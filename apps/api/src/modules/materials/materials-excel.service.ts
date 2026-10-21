import { Injectable } from '@nestjs/common';
import {
  MATERIAL_CODE_PATTERN,
  type EnableStatus,
  type ExcelRowError,
  type ImportResultDto,
  type Locale,
  type MaterialExportQuery,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { changedFields } from '../../common/audit-diff';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import type { DictItem, Material, Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infra/audit/audit.service';
import {
  ExcelTemplateService,
  type ExcelColumn,
  type ExcelSheetDef,
  type ParsedRow,
} from '../../infra/excel/excel-template.service';
import { fixUploadName } from '../../infra/files/file-types';
import type { UploadedFileInput } from '../../infra/files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryIndex, MaterialCategoriesService } from '../material-categories/material-categories.service';
import { MaterialsService } from './materials.service';

const SHEET_NAME = '材料 Materials';
const MAX_IMPORT_MB = 10;
const AUDIT_CODES_LIMIT = 200;
const CREATE_CHUNK = 1000;

/** 标准模板的列（R03-7），表头必须与这里完全一致 */
const COLUMNS: ExcelColumn[] = [
  { key: 'code', header: '物料编码 / Material Code', maxLength: 50, width: 18 },
  { key: 'nameZh', header: '物料名称 / Material Name', required: true, maxLength: 100, width: 26 },
  { key: 'nameEn', header: '英文名称 / English Name', maxLength: 100, width: 26 },
  { key: 'spec', header: '规格型号 / Specification', required: true, maxLength: 200, width: 36 },
  { key: 'unit', header: '单位 / Unit', required: true, maxLength: 50, width: 12 },
  { key: 'categoryCode', header: '材料分类编码 / Category Code', required: true, maxLength: 30, width: 22 },
  { key: 'brand', header: '品牌 / Brand', maxLength: 100, width: 16 },
  { key: 'remark', header: '备注 / Remark', maxLength: 1000, width: 30 },
];

/** 导出多这一列（R03-8）；导入时可以没有，有就按它启用或停用 */
const STATUS_COLUMN: ExcelColumn = { key: 'status', header: '状态 / Status', maxLength: 20, width: 12, omittable: true };

const IMPORT_DEF: ExcelSheetDef = { sheetName: SHEET_NAME, columns: [...COLUMNS, STATUS_COLUMN] };

const STATUS_TEXT: Record<Locale, Record<EnableStatus, string>> = {
  'zh-CN': { ENABLED: '启用', DISABLED: '停用' },
  'en-US': { ENABLED: 'Enabled', DISABLED: 'Disabled' },
};

function parseStatus(text: string): EnableStatus | null {
  const value = text.trim().toLowerCase();
  if (['启用', 'enabled', 'enable'].includes(value)) return 'ENABLED';
  if (['停用', 'disabled', 'disable'].includes(value)) return 'DISABLED';
  return null;
}

const header = (key: string) => [...COLUMNS, STATUS_COLUMN].find((c) => c.key === key)!.header;

/** 通过校验、准备写入的一行 */
interface ImportRow {
  row: number;
  code: string | null;
  data: {
    nameZh: string;
    nameEn: string | null;
    spec: string;
    unitCode: string;
    categoryId: string;
    brand: string | null;
    remark: string | null;
  };
  status: EnableStatus | null;
}

@Injectable()
export class MaterialsExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excel: ExcelTemplateService,
    private readonly materials: MaterialsService,
    private readonly categories: MaterialCategoriesService,
    private readonly audit: AuditService,
  ) {}

  /** 导入模板：表头 + 下拉提示 + 说明页（列出可填的单位和分类编码） */
  async template(): Promise<Buffer> {
    const [units, index] = await Promise.all([this.units(), this.categories.loadIndex()]);
    const enabledUnits = units.filter((u) => u.status === 'ENABLED');
    const categoryCodes = this.selectableCategories(index).map((c) => c.code);
    const columns = COLUMNS.map((c) => {
      if (c.key === 'unit') return { ...c, options: enabledUnits.map((u) => u.code) };
      if (c.key === 'categoryCode') return { ...c, options: categoryCodes };
      return c;
    });
    return this.excel.build({ sheetName: SHEET_NAME, columns, instructions: this.instructions(enabledUnits, index) });
  }

  /** 导出：列同模板另加"状态"，文件改完可以直接导入（R03-8） */
  async export(user: AuthUser, query: MaterialExportQuery): Promise<Buffer> {
    const [rows, units, index] = await Promise.all([
      this.materials.listForExport(query),
      this.units(),
      this.categories.loadIndex(),
    ]);
    const statusText = STATUS_TEXT[user.locale] ?? STATUS_TEXT['zh-CN'];
    return this.excel.build(
      {
        sheetName: SHEET_NAME,
        columns: [...COLUMNS, STATUS_COLUMN],
        instructions: this.instructions(
          units.filter((u) => u.status === 'ENABLED'),
          index,
        ),
      },
      rows.map((m) => ({
        code: m.code,
        nameZh: m.nameZh,
        nameEn: m.nameEn,
        spec: m.spec,
        unit: m.unitCode,
        categoryCode: m.category.code,
        brand: m.brand,
        remark: m.remark,
        status: statusText[m.status],
      })),
    );
  }

  /**
   * R03-7：编码存在则更新，不存在或为空则新建；单位接受字典编码或中/英文名称；分类按编码匹配；
   * 全部校验通过才写入（R02-9）
   */
  async import(actor: AuthUser, file: UploadedFileInput | undefined): Promise<ImportResultDto> {
    if (!file || file.size === 0) {
      throw new AppException('VALIDATION_FAILED', undefined, [{ path: 'file', code: 'required', message: 'File is required' }]);
    }
    if (file.size > MAX_IMPORT_MB * 1024 * 1024) throw new AppException('FILE_TOO_LARGE', { maxMB: MAX_IMPORT_MB });
    const parsed = await this.excel.parse(IMPORT_DEF, file.buffer);

    const codes = parsed.rows.map((r) => this.text(r, 'code')?.toUpperCase()).filter((c): c is string => !!c);
    const [units, index, existing] = await Promise.all([
      this.units(),
      this.categories.loadIndex(),
      this.prisma.material.findMany({ where: { code: { in: codes } } }),
    ]);
    const existingByCode = new Map(existing.map((m) => [m.code, m]));
    const errors = [...parsed.errors];
    const rows = this.validate(parsed.rows, { units, index, existingByCode }, errors);
    this.excel.assertNoRowErrors(errors);

    try {
      // 5000 行逐条更新可能超过默认的 5 秒事务超时
      return await this.prisma.$transaction(
        async (tx) => {
          const { created, updated } = await this.write(tx, actor, rows, existingByCode);
          await this.audit.log(
            {
              actor,
              action: 'material.import',
              entityType: 'material',
              summary: `created ${created.length}, updated ${updated.length}`,
              detail: {
                file: fixUploadName(file.originalname).slice(0, 200),
                created: created.length,
                updated: updated.length,
                createdCodes: created.slice(0, AUDIT_CODES_LIMIT),
                updatedCodes: updated.slice(0, AUDIT_CODES_LIMIT),
              },
            },
            tx,
          );
          return { created: created.length, updated: updated.length };
        },
        { timeout: 120_000 },
      );
    } catch (e) {
      // 校验之后被别人抢先用了同一个编码
      if (isUniqueViolation(e, 'code')) throw new AppException('MATERIAL_CODE_TAKEN');
      throw e;
    }
  }

  private validate(
    parsedRows: ParsedRow[],
    ctx: { units: DictItem[]; index: CategoryIndex; existingByCode: Map<string, Material> },
    errors: ExcelRowError[],
  ): ImportRow[] {
    const err = (row: number, key: string, code: string, message: string, params?: Record<string, string | number>) => {
      errors.push({ row, column: header(key), code, message, ...(params ? { params } : {}) });
    };
    const categoryByCode = new Map(ctx.index.all().map((c) => [c.code, c]));
    const firstRowOfCode = new Map<string, number>();
    const result: ImportRow[] = [];

    for (const r of parsedRows) {
      const code = this.text(r, 'code')?.toUpperCase() ?? null;
      const before = code ? ctx.existingByCode.get(code) : undefined;
      let ok = true;

      if (code !== null) {
        const first = firstRowOfCode.get(code);
        if (!MATERIAL_CODE_PATTERN.test(code)) {
          err(r.row, 'code', 'invalid_code', 'Invalid material code');
          ok = false;
        } else if (first !== undefined) {
          err(r.row, 'code', 'duplicate_code', 'Duplicate code in file', { row: first });
          ok = false;
        } else {
          firstRowOfCode.set(code, r.row);
        }
      }

      // 单位、分类：新建或改动时必须可选用；更新时保持原来的停用值照常允许
      let unitCode: string | null = null;
      const unitText = this.text(r, 'unit');
      if (unitText !== null) {
        const unit = this.matchUnit(ctx.units, unitText);
        if (!unit) {
          err(r.row, 'unit', 'unit_not_found', 'Unknown unit');
          ok = false;
        } else if (unit.status !== 'ENABLED' && unit.code !== before?.unitCode) {
          err(r.row, 'unit', 'unit_disabled', 'Unit is disabled');
          ok = false;
        } else {
          unitCode = unit.code;
        }
      }

      let categoryId: string | null = null;
      const categoryText = this.text(r, 'categoryCode');
      if (categoryText !== null) {
        const category = categoryByCode.get(categoryText.toUpperCase());
        if (!category) {
          err(r.row, 'categoryCode', 'category_not_found', 'Unknown category code');
          ok = false;
        } else if (!ctx.index.isEffectiveEnabled(category.id) && category.id !== before?.categoryId) {
          err(r.row, 'categoryCode', 'category_disabled', 'Category is disabled');
          ok = false;
        } else {
          categoryId = category.id;
        }
      }

      let status: EnableStatus | null = null;
      const statusText = this.text(r, 'status');
      if (statusText !== null) {
        status = parseStatus(statusText);
        if (!status) {
          err(r.row, 'status', 'invalid_status', 'Status must be 启用/停用 or Enabled/Disabled');
          ok = false;
        }
      }

      const nameZh = this.text(r, 'nameZh');
      const spec = this.text(r, 'spec');
      // 必填为空已由 ExcelTemplateService 报错
      if (!ok || nameZh === null || spec === null || unitCode === null || categoryId === null) continue;
      result.push({
        row: r.row,
        code,
        data: {
          nameZh,
          nameEn: this.text(r, 'nameEn'),
          spec,
          unitCode,
          categoryId,
          brand: this.text(r, 'brand'),
          remark: this.text(r, 'remark'),
        },
        status,
      });
    }
    return result;
  }

  private async write(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    rows: ImportRow[],
    existingByCode: Map<string, Material>,
  ): Promise<{ created: string[]; updated: string[] }> {
    const updated: string[] = [];
    const toCreate: ImportRow[] = [];
    for (const r of rows) {
      const before = r.code ? existingByCode.get(r.code) : undefined;
      if (!before) {
        toCreate.push(r);
        continue;
      }
      const data = { ...r.data, ...(r.status ? { status: r.status } : {}) };
      // 内容没变就不写库（导出后原样导入时数据和更新时间都不变），但仍计为"更新"
      if (Object.keys(changedFields(before, data)).length > 0) {
        await tx.material.update({ where: { id: before.id }, data });
      }
      updated.push(before.code);
    }

    const manualCodes = new Set(rows.map((r) => r.code).filter((c): c is string => c !== null));
    const autoCodes = await this.materials.allocateCodes(
      tx,
      toCreate.filter((r) => r.code === null).length,
      manualCodes,
    );
    const created = toCreate.map((r) => ({
      ...r.data,
      code: r.code ?? autoCodes.shift()!,
      status: r.status ?? 'ENABLED',
      createdById: actor.id,
    }));
    for (let i = 0; i < created.length; i += CREATE_CHUNK) {
      await tx.material.createMany({ data: created.slice(i, i + CREATE_CHUNK) });
    }
    return { created: created.map((c) => c.code), updated };
  }

  /** 单位匹配顺序：编码（不区分大小写）→ 中文名 → 英文名（不区分大小写） */
  private matchUnit(units: DictItem[], text: string): DictItem | undefined {
    const lower = text.toLowerCase();
    return (
      units.find((u) => u.code.toLowerCase() === lower) ??
      units.find((u) => u.nameZh === text) ??
      units.find((u) => u.nameEn.toLowerCase() === lower)
    );
  }

  private text(row: ParsedRow, key: string): string | null {
    const value = row.values[key];
    return value === null || value === undefined ? null : String(value).trim() || null;
  }

  private units(): Promise<DictItem[]> {
    return this.prisma.dictItem.findMany({ where: { typeCode: 'unit' }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] });
  }

  /** 按树的顺序列出有效启用的分类 */
  private selectableCategories(index: CategoryIndex): { code: string; label: string }[] {
    const result: { code: string; label: string }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const c of index.children(parentId)) {
        if (!index.isEffectiveEnabled(c.id)) continue;
        result.push({ code: c.code, label: `${'    '.repeat(depth)}${c.code}  ${c.nameZh} / ${c.nameEn}` });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return result;
  }

  private instructions(units: DictItem[], index: CategoryIndex): string[] {
    return [
      '填写说明 / Instructions',
      '1. 不要修改表头（名称和顺序都不能改），红色表头的列必填。Do not change the header row (names or order); columns with red headers are required.',
      '2. 物料编码已存在则更新该材料；为空或是新编码则新建，为空时自动生成 MAT-000001 格式的编码。An existing Material Code updates that material; a blank or new code creates one (blank codes are generated automatically).',
      '3. 单位填写下面的编码，或中文 / 英文名称。Unit: one of the codes below, or its Chinese / English name.',
      '4. 材料分类编码只能填写下面列出的启用分类。Category Code: one of the enabled categories listed below.',
      '5. 导出的文件多一列"状态"（启用 / 停用），改完可以直接导入；没有这一列时新材料为启用、已有材料状态不变。Exported files have an extra Status column (Enabled / Disabled) and can be imported directly; without it, new materials are enabled and existing ones keep their status.',
      '6. 所有行都校验通过才会导入，有任何错误整个文件都不导入。The file is imported only if every row is valid.',
      '',
      '单位 / Units',
      ...units.map((u) => `${u.code}  ${u.nameZh} / ${u.nameEn}`),
      '',
      '材料分类 / Categories',
      ...this.selectableCategories(index).map((c) => c.label),
    ];
  }
}
