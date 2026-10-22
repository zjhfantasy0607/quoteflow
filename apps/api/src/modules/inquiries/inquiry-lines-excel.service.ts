import { Injectable } from '@nestjs/common';
import { Dec, QUANTITY_PATTERN, type ExcelRowError, type ImportResultDto } from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app.exception';
import type { DictItem, Material } from '../../generated/prisma/client';
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
import { InquiryAccessService } from './inquiry-access.service';
import { InquiryLinesService, type LineData } from './inquiry-lines.service';

const SHEET_NAME = '询价行 RFQ Lines';
const MAX_IMPORT_MB = 10;

/**
 * 标准模板的列（R06-11），表头必须与这里完全一致。名称、规格、单位、分类在模板里标为必填（红色表头），
 * 但物料编码匹配到启用的材料时取材料库的值，所以解析时不按必填检查，由 validate() 判断
 */
const COLUMNS: ExcelColumn[] = [
  { key: 'materialCode', header: '物料编码 / Material Code', maxLength: 50, width: 18 },
  { key: 'nameZh', header: '物料名称 / Material Name', required: true, maxLength: 100, width: 26 },
  { key: 'spec', header: '规格型号 / Specification', required: true, maxLength: 200, width: 36 },
  { key: 'unit', header: '单位 / Unit', required: true, maxLength: 50, width: 12 },
  { key: 'quantity', header: '数量 / Quantity', required: true, type: 'decimal', precision: 4, width: 14 },
  { key: 'categoryCode', header: '材料分类编码 / Category Code', required: true, maxLength: 30, width: 22 },
  { key: 'brand', header: '品牌 / Brand', maxLength: 100, width: 16 },
  { key: 'drawingRef', header: '图纸或规格书编号 / Drawing or Spec No.', maxLength: 100, width: 22 },
  { key: 'remark', header: '备注 / Remark', maxLength: 1000, width: 30 },
];

/** 只有数量在解析时就按必填检查 */
const PARSE_DEF: ExcelSheetDef = {
  sheetName: SHEET_NAME,
  columns: COLUMNS.map((c) => (c.key === 'quantity' ? c : { ...c, required: false })),
};

const header = (key: string) => COLUMNS.find((c) => c.key === key)!.header;

/** Decimal(18,4) 能存的最大数量 */
const QUANTITY_MAX = '99999999999999.9999';

interface ValidateContext {
  /** 编码 → 启用的材料 */
  materials: Map<string, Material>;
  units: DictItem[];
  index: CategoryIndex;
}

/** 询价行 Excel 导入（R06-11）：追加在已有行之后，全部校验通过才写入 */
@Injectable()
export class InquiryLinesExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excel: ExcelTemplateService,
    private readonly access: InquiryAccessService,
    private readonly lines: InquiryLinesService,
    private readonly categories: MaterialCategoriesService,
    private readonly audit: AuditService,
  ) {}

  async template(): Promise<Buffer> {
    const [units, index] = await Promise.all([this.units(), this.categories.loadIndex()]);
    const enabledUnits = units.filter((u) => u.status === 'ENABLED');
    return this.excel.build({
      sheetName: SHEET_NAME,
      columns: COLUMNS.map((c) =>
        c.key === 'unit' ? { ...c, options: enabledUnits.map((u) => u.code) } : c,
      ),
      instructions: this.instructions(enabledUnits, index),
    });
  }

  async import(
    user: AuthUser,
    inquiryId: string,
    roundNo: number,
    file: UploadedFileInput | undefined,
  ): Promise<ImportResultDto> {
    // 先确认能编辑，不能编辑时不用解析文件
    await this.prisma.$transaction((tx) => this.access.lockEditableRound(tx, user, inquiryId, roundNo));
    if (!file || file.size === 0) {
      throw new AppException('VALIDATION_FAILED', undefined, [
        { path: 'file', code: 'required', message: 'File is required' },
      ]);
    }
    if (file.size > MAX_IMPORT_MB * 1024 * 1024)
      throw new AppException('FILE_TOO_LARGE', { maxMB: MAX_IMPORT_MB });
    const parsed = await this.excel.parse(PARSE_DEF, file.buffer);

    const codes = parsed.rows
      .map((r) => this.text(r, 'materialCode')?.toUpperCase())
      .filter((c): c is string => !!c);
    const [materials, units, index] = await Promise.all([
      this.prisma.material.findMany({ where: { code: { in: codes }, status: 'ENABLED' } }),
      this.units(),
      this.categories.loadIndex(),
    ]);
    const errors = [...parsed.errors];
    const data = this.validate(
      parsed.rows,
      { materials: new Map(materials.map((m) => [m.code, m])), units, index },
      errors,
    );
    this.excel.assertNoRowErrors(errors);

    return this.prisma.$transaction(
      async (tx) => {
        const { round } = await this.access.lockEditableRound(tx, user, inquiryId, roundNo);
        const created = await this.lines.append(tx, round.id, data);
        await this.audit.log(
          {
            actor: user,
            action: 'inquiryLine.import',
            entityType: 'inquiry',
            entityId: inquiryId,
            summary: `created ${created.length}`,
            detail: {
              roundNo,
              file: fixUploadName(file.originalname).slice(0, 200),
              created: created.length,
              fromMaterials: data.filter((d) => d.materialId).length,
            },
          },
          tx,
        );
        return { created: created.length, updated: 0 };
      },
      { timeout: 60_000 },
    );
  }

  /**
   * 物料编码匹配到启用的材料：名称、规格、单位、分类取材料库的值（文件里这几列可以空着，填了也不用），
   * 品牌没填时取材料的品牌；否则按手工行处理，名称、规格、单位、分类必填，编码照原样保留
   */
  private validate(rows: ParsedRow[], ctx: ValidateContext, errors: ExcelRowError[]): LineData[] {
    const err = (
      row: number,
      key: string,
      code: string,
      message: string,
      params?: Record<string, string>,
    ) => {
      errors.push({ row, column: header(key), code, message, ...(params ? { params } : {}) });
    };
    const categoryByCode = new Map(ctx.index.all().map((c) => [c.code, c]));
    const result: LineData[] = [];

    for (const r of rows) {
      const code = this.text(r, 'materialCode')?.toUpperCase() ?? null;
      const material = code ? ctx.materials.get(code) : undefined;
      // 数量的必填、数字格式、小数位已由 ExcelTemplateService 检查，这里查大于 0 和整数位数
      const quantity = this.text(r, 'quantity');
      let ok = quantity !== null;
      if (quantity !== null && (quantity.startsWith('-') || !/[1-9]/.test(quantity))) {
        err(r.row, 'quantity', 'not_positive', 'Quantity must be greater than 0');
        ok = false;
      } else if (quantity !== null && !QUANTITY_PATTERN.test(quantity)) {
        err(r.row, 'quantity', 'too_large', 'Quantity is too large', { max: QUANTITY_MAX });
        ok = false;
      }
      const common = {
        quantity: ok ? new Dec(quantity!).toFixed() : '',
        drawingRef: this.text(r, 'drawingRef'),
        remark: this.text(r, 'remark'),
      };

      if (material) {
        if (!ctx.index.isEffectiveEnabled(material.categoryId)) {
          err(r.row, 'materialCode', 'category_disabled', 'Category of the material is disabled');
          ok = false;
        }
        if (ok) {
          result.push({
            ...common,
            materialId: material.id,
            materialCode: material.code,
            nameZh: material.nameZh,
            nameEn: material.nameEn,
            spec: material.spec,
            unitCode: material.unitCode,
            categoryId: material.categoryId,
            brand: this.text(r, 'brand') ?? material.brand,
          });
        }
        continue;
      }

      const nameZh = this.text(r, 'nameZh');
      const spec = this.text(r, 'spec');
      if (nameZh === null) err(r.row, 'nameZh', 'required', 'Required');
      if (spec === null) err(r.row, 'spec', 'required', 'Required');

      let unitCode: string | null = null;
      const unitText = this.text(r, 'unit');
      if (unitText === null) {
        err(r.row, 'unit', 'required', 'Required');
      } else {
        const unit = this.matchUnit(ctx.units, unitText);
        if (!unit) err(r.row, 'unit', 'unit_not_found', 'Unknown unit');
        else if (unit.status !== 'ENABLED') err(r.row, 'unit', 'unit_disabled', 'Unit is disabled');
        else unitCode = unit.code;
      }

      let categoryId: string | null = null;
      const categoryText = this.text(r, 'categoryCode');
      if (categoryText === null) {
        err(r.row, 'categoryCode', 'required', 'Required');
      } else {
        const category = categoryByCode.get(categoryText.toUpperCase());
        if (!category) err(r.row, 'categoryCode', 'category_not_found', 'Unknown category code');
        else if (!ctx.index.isEffectiveEnabled(category.id))
          err(r.row, 'categoryCode', 'category_disabled', 'Category is disabled');
        else categoryId = category.id;
      }

      if (!ok || nameZh === null || spec === null || unitCode === null || categoryId === null) continue;
      result.push({
        ...common,
        materialId: null,
        materialCode: code,
        nameZh,
        nameEn: null,
        spec,
        unitCode,
        categoryId,
        brand: this.text(r, 'brand'),
      });
    }
    return result;
  }

  /** 单位匹配顺序：编码（不区分大小写）→ 中文名 → 英文名（不区分大小写），与材料导入一致 */
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
    return this.prisma.dictItem.findMany({
      where: { typeCode: 'unit' },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    });
  }

  /** 按树的顺序列出有效启用的分类 */
  private selectableCategories(index: CategoryIndex): string[] {
    const result: string[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const c of index.children(parentId)) {
        if (!index.isEffectiveEnabled(c.id)) continue;
        result.push(`${'    '.repeat(depth)}${c.code}  ${c.nameZh} / ${c.nameEn}`);
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
      "2. 物料编码匹配到材料库里启用的材料时，物料名称、规格型号、单位、材料分类取材料库的值，这几列可以留空；品牌留空时取材料库的品牌。If the Material Code matches an enabled material in the library, its name, specification, unit and category are used (those columns may be left blank); a blank Brand takes the material's brand.",
      '3. 物料编码为空或匹配不到启用的材料时按手工行导入，物料名称、规格型号、单位、材料分类必填，编码照原样保留。Rows without a matching enabled material are imported as manual lines: name, specification, unit and category are required, and the code is kept as entered.',
      '4. 数量必须大于 0，最多 4 位小数。Quantity must be greater than 0, with up to 4 decimal places.',
      '5. 单位填写下面的编码，或中文 / 英文名称；材料分类填写下面列出的启用分类编码。Unit: one of the codes below, or its Chinese / English name. Category Code: one of the enabled category codes listed below.',
      '6. 导入的行追加在已有询价行之后；所有行都校验通过才会导入，有任何错误整个文件都不导入。Imported rows are appended after the existing lines. The file is imported only if every row is valid.',
      '',
      '单位 / Units',
      ...units.map((u) => `${u.code}  ${u.nameZh} / ${u.nameEn}`),
      '',
      '材料分类 / Categories',
      ...this.selectableCategories(index),
    ];
  }
}
