import { Injectable } from '@nestjs/common';
import {
  CREDIT_CODE_PATTERN,
  SUPPLIER_CODE_PATTERN,
  type EnableStatus,
  type ExcelRowError,
  type ImportResultDto,
  type Locale,
  type SupplierExportQuery,
  type SupplierLanguage,
} from '@quoteflow/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { FieldMaskService } from '../../common/auth/field-mask.service';
import { SessionService } from '../../common/auth/session.service';
import { AppException } from '../../common/errors/app.exception';
import type { DictItem, Prisma, Supplier } from '../../generated/prisma/client';
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
import { supplierAuditChanges, SuppliersService } from './suppliers.service';

const SHEET_NAME = '供应商 Suppliers';
const MAX_IMPORT_MB = 10;
const AUDIT_CODES_LIMIT = 200;
const CREATE_CHUNK = 1000;
/** 没有 supplier.contact 字段权限时导出的联系方式（R04-7） */
const MASKED = '******';

/** 标准模板的列（R04-8），表头必须与这里完全一致 */
const COLUMNS: ExcelColumn[] = [
  { key: 'code', header: '供应商编码 / Supplier Code', maxLength: 30, width: 14 },
  { key: 'nameZh', header: '供应商名称 / Supplier Name', required: true, maxLength: 100, width: 30 },
  { key: 'nameEn', header: '英文名称 / English Name', maxLength: 200, width: 34 },
  { key: 'creditCode', header: '统一社会信用代码 / Unified Social Credit Code', maxLength: 50, width: 24 },
  { key: 'category', header: '供应商分类 / Supplier Category', required: true, maxLength: 100, width: 16 },
  { key: 'materialCategories', header: '主营材料分类编码 / Main Category Codes', maxLength: 1000, width: 26 },
  { key: 'contactName', header: '联系人 / Contact Name', required: true, maxLength: 50, width: 14 },
  {
    key: 'contactEmail',
    header: '联系邮箱 / Contact Email',
    required: true,
    type: 'email',
    maxLength: 100,
    width: 28,
  },
  { key: 'contactPhone', header: '联系电话 / Contact Phone', maxLength: 30, width: 16 },
  { key: 'language', header: '首选语言 / Preferred Language', maxLength: 20, width: 14 },
  { key: 'country', header: '国家或地区 / Country or Region', maxLength: 50, width: 14 },
  { key: 'address', header: '地址 / Address', maxLength: 200, width: 30 },
  { key: 'remark', header: '备注 / Remark', maxLength: 1000, width: 24 },
];

/** 导出多这一列（与材料导出一致，待确认事项 B-02）；导入时可以没有，有就按它启用或停用 */
const STATUS_COLUMN: ExcelColumn = {
  key: 'status',
  header: '状态 / Status',
  maxLength: 20,
  width: 10,
  omittable: true,
};

const IMPORT_DEF: ExcelSheetDef = { sheetName: SHEET_NAME, columns: [...COLUMNS, STATUS_COLUMN] };

const STATUS_TEXT: Record<Locale, Record<EnableStatus, string>> = {
  'zh-CN': { ENABLED: '启用', DISABLED: '停用' },
  'en-US': { ENABLED: 'Enabled', DISABLED: 'Disabled' },
};

/** 导出写这三个值，导入时也接受语言代码（R04-8） */
const LANGUAGE_TEXT: Record<SupplierLanguage, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
  bilingual: '中英',
};

function parseStatus(text: string): EnableStatus | null {
  const value = text.trim().toLowerCase();
  if (['启用', 'enabled', 'enable'].includes(value)) return 'ENABLED';
  if (['停用', 'disabled', 'disable'].includes(value)) return 'DISABLED';
  return null;
}

function parseLanguage(text: string): SupplierLanguage | null {
  const value = text.trim().toLowerCase();
  if (['zh-cn', '中文'].includes(value)) return 'zh-CN';
  if (['en-us', 'english', '英文'].includes(value)) return 'en-US';
  if (['bilingual', '中英', '中英文'].includes(value)) return 'bilingual';
  return null;
}

/** 主营分类编码用英文逗号分隔（也容忍中文逗号），去空白、转大写、去重 */
function splitCodes(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，]/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

const header = (key: string) => [...COLUMNS, STATUS_COLUMN].find((c) => c.key === key)!.header;

type ExistingSupplier = Supplier & { materialCategories: { categoryId: string }[] };

/** 通过校验、准备写入的一行 */
interface ImportRow {
  row: number;
  code: string | null;
  data: {
    nameZh: string;
    nameEn: string | null;
    creditCode: string | null;
    categoryCode: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    country: string | null;
    address: string | null;
    remark: string | null;
  };
  /** 为空时：新供应商用中文，已有供应商不变 */
  language: SupplierLanguage | null;
  categoryIds: string[];
  status: EnableStatus | null;
}

interface ValidateContext {
  supplierCategories: DictItem[];
  index: CategoryIndex;
  existingByCode: Map<string, ExistingSupplier>;
  /** 信用代码 → 已占用它的供应商编码 */
  creditCodeOwner: Map<string, string>;
}

@Injectable()
export class SuppliersExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excel: ExcelTemplateService,
    private readonly suppliers: SuppliersService,
    private readonly categories: MaterialCategoriesService,
    private readonly sessions: SessionService,
    private readonly fieldMask: FieldMaskService,
    private readonly audit: AuditService,
  ) {}

  /** 导入模板：表头 + 下拉提示 + 说明页（列出可填的供应商分类和材料分类编码） */
  async template(): Promise<Buffer> {
    const [supplierCategories, index] = await Promise.all([
      this.supplierCategories(),
      this.categories.loadIndex(),
    ]);
    const enabled = supplierCategories.filter((c) => c.status === 'ENABLED');
    const columns = COLUMNS.map((c) => {
      if (c.key === 'category') return { ...c, options: enabled.map((s) => s.code) };
      if (c.key === 'language') return { ...c, options: Object.values(LANGUAGE_TEXT) };
      return c;
    });
    return this.excel.build({
      sheetName: SHEET_NAME,
      columns,
      instructions: this.instructions(enabled, index),
    });
  }

  /** 导出：列同模板另加"状态"，文件改完可以直接导入；没有 supplier.contact 权限时联系方式写成 ******（R04-7） */
  async export(user: AuthUser, query: SupplierExportQuery): Promise<Buffer> {
    const [{ rows, index }, supplierCategories] = await Promise.all([
      this.suppliers.listForExport(query),
      this.supplierCategories(),
    ]);
    const canSeeContact = this.fieldMask.can(user, 'supplier.contact');
    const statusText = STATUS_TEXT[user.locale] ?? STATUS_TEXT['zh-CN'];
    return this.excel.build(
      {
        sheetName: SHEET_NAME,
        columns: [...COLUMNS, STATUS_COLUMN],
        instructions: this.instructions(
          supplierCategories.filter((c) => c.status === 'ENABLED'),
          index,
        ),
      },
      rows.map((s) => ({
        code: s.code,
        nameZh: s.nameZh,
        nameEn: s.nameEn,
        creditCode: s.creditCode,
        category: s.categoryCode,
        materialCategories: s.materialCategories
          .map((m) => m.category.code)
          .sort()
          .join(','),
        contactName: s.contactName,
        contactEmail: canSeeContact ? s.contactEmail : MASKED,
        contactPhone: canSeeContact ? s.contactPhone : MASKED,
        language: LANGUAGE_TEXT[s.preferredLanguage as SupplierLanguage] ?? s.preferredLanguage,
        country: s.country,
        address: s.address,
        remark: s.remark,
        status: statusText[s.status],
      })),
    );
  }

  /**
   * R04-8：编码存在则更新，不存在或为空则新建；分类接受字典编码或中英文名称；首选语言接受代码或"中文/English/中英"；
   * 全部校验通过才写入（R02-9）
   */
  async import(actor: AuthUser, file: UploadedFileInput | undefined): Promise<ImportResultDto> {
    if (!file || file.size === 0) {
      throw new AppException('VALIDATION_FAILED', undefined, [
        { path: 'file', code: 'required', message: 'File is required' },
      ]);
    }
    if (file.size > MAX_IMPORT_MB * 1024 * 1024)
      throw new AppException('FILE_TOO_LARGE', { maxMB: MAX_IMPORT_MB });
    const parsed = await this.excel.parse(IMPORT_DEF, file.buffer);

    const codes = parsed.rows.map((r) => this.text(r, 'code')?.toUpperCase()).filter((c): c is string => !!c);
    const creditCodes = parsed.rows
      .map((r) => this.text(r, 'creditCode')?.toUpperCase())
      .filter((c): c is string => !!c);
    const [supplierCategories, index, existing, owners] = await Promise.all([
      this.supplierCategories(),
      this.categories.loadIndex(),
      this.prisma.supplier.findMany({
        where: { code: { in: codes } },
        include: { materialCategories: true },
      }),
      this.prisma.supplier.findMany({
        where: { creditCode: { in: creditCodes } },
        select: { code: true, creditCode: true },
      }),
    ]);
    const ctx: ValidateContext = {
      supplierCategories,
      index,
      existingByCode: new Map(existing.map((s) => [s.code, s])),
      creditCodeOwner: new Map(owners.map((s) => [s.creditCode!, s.code])),
    };
    const errors = [...parsed.errors];
    const rows = this.validate(parsed.rows, ctx, errors);
    this.excel.assertNoRowErrors(errors);

    try {
      // 5000 行逐条更新可能超过默认的 5 秒事务超时
      return await this.prisma.$transaction(
        async (tx) => {
          const { created, updated } = await this.write(tx, actor, rows, ctx);
          await this.audit.log(
            {
              actor,
              action: 'supplier.import',
              entityType: 'supplier',
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
      // 校验之后被别人抢先用了同一个编码或信用代码
      throw this.suppliers.mapUnique(e);
    }
  }

  private validate(parsedRows: ParsedRow[], ctx: ValidateContext, errors: ExcelRowError[]): ImportRow[] {
    const err = (
      row: number,
      key: string,
      code: string,
      message: string,
      params?: Record<string, string | number>,
    ) => {
      errors.push({ row, column: header(key), code, message, ...(params ? { params } : {}) });
    };
    const categoryByCode = new Map(ctx.index.all().map((c) => [c.code, c]));
    const firstRowOfCode = new Map<string, number>();
    const firstRowOfCreditCode = new Map<string, number>();
    const result: ImportRow[] = [];

    for (const r of parsedRows) {
      const code = this.text(r, 'code')?.toUpperCase() ?? null;
      const before = code ? ctx.existingByCode.get(code) : undefined;
      let ok = true;

      if (code !== null) {
        const first = firstRowOfCode.get(code);
        if (!SUPPLIER_CODE_PATTERN.test(code)) {
          err(r.row, 'code', 'invalid_code', 'Invalid supplier code');
          ok = false;
        } else if (first !== undefined) {
          err(r.row, 'code', 'duplicate_code', 'Duplicate code in file', { row: first });
          ok = false;
        } else {
          firstRowOfCode.set(code, r.row);
        }
      }

      // R04-2：信用代码可空；填写时 18 位、文件内和库里都不能重复（同一个供应商自己的除外）
      const creditCode = this.text(r, 'creditCode')?.toUpperCase() ?? null;
      if (creditCode !== null) {
        const first = firstRowOfCreditCode.get(creditCode);
        const owner = ctx.creditCodeOwner.get(creditCode);
        if (!CREDIT_CODE_PATTERN.test(creditCode)) {
          err(r.row, 'creditCode', 'invalid_credit_code', 'Credit code must be 18 letters or digits');
          ok = false;
        } else if (first !== undefined) {
          err(r.row, 'creditCode', 'duplicate_credit_code', 'Duplicate credit code in file', { row: first });
          ok = false;
        } else if (owner !== undefined && owner !== before?.code) {
          err(r.row, 'creditCode', 'credit_code_taken', 'Credit code is used by another supplier', {
            code: owner,
          });
          ok = false;
        } else {
          firstRowOfCreditCode.set(creditCode, r.row);
        }
      }

      // R04-1：分类新建或改动时必须启用；更新时保持原来的停用分类照常允许
      let categoryCode: string | null = null;
      const categoryText = this.text(r, 'category');
      if (categoryText !== null) {
        const category = this.matchCategory(ctx.supplierCategories, categoryText);
        if (!category) {
          err(r.row, 'category', 'supplier_category_not_found', 'Unknown supplier category');
          ok = false;
        } else if (category.status !== 'ENABLED' && category.code !== before?.categoryCode) {
          err(r.row, 'category', 'supplier_category_disabled', 'Supplier category is disabled');
          ok = false;
        } else {
          categoryCode = category.code;
        }
      }

      // R04-4：新加的主营分类必须有效启用；原有的停用分类可以保留
      const categoryIds: string[] = [];
      const beforeCategoryIds = new Set(before?.materialCategories.map((m) => m.categoryId) ?? []);
      for (const c of splitCodes(this.text(r, 'materialCategories') ?? '')) {
        const category = categoryByCode.get(c);
        if (!category) {
          err(r.row, 'materialCategories', 'main_category_not_found', 'Unknown category code', { code: c });
          ok = false;
        } else if (!ctx.index.isEffectiveEnabled(category.id) && !beforeCategoryIds.has(category.id)) {
          err(r.row, 'materialCategories', 'main_category_disabled', 'Category is disabled', { code: c });
          ok = false;
        } else {
          categoryIds.push(category.id);
        }
      }

      let language: SupplierLanguage | null = null;
      const languageText = this.text(r, 'language');
      if (languageText !== null) {
        language = parseLanguage(languageText);
        if (!language) {
          err(
            r.row,
            'language',
            'invalid_language',
            'Language must be zh-CN / en-US / bilingual or 中文 / English / 中英',
          );
          ok = false;
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
      const contactName = this.text(r, 'contactName');
      const contactEmail = this.text(r, 'contactEmail')?.toLowerCase() ?? null;
      // 必填为空、邮箱格式错误已由 ExcelTemplateService 报错
      if (!ok || nameZh === null || categoryCode === null || contactName === null || contactEmail === null)
        continue;
      result.push({
        row: r.row,
        code,
        data: {
          nameZh,
          nameEn: this.text(r, 'nameEn'),
          creditCode,
          categoryCode,
          contactName,
          contactEmail,
          contactPhone: this.text(r, 'contactPhone'),
          country: this.text(r, 'country'),
          address: this.text(r, 'address'),
          remark: this.text(r, 'remark'),
        },
        language,
        categoryIds,
        status,
      });
    }
    return result;
  }

  private async write(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    rows: ImportRow[],
    ctx: ValidateContext,
  ): Promise<{ created: string[]; updated: string[] }> {
    const updated: string[] = [];
    const disabled: string[] = [];
    const toCreate: ImportRow[] = [];
    for (const r of rows) {
      const before = r.code ? ctx.existingByCode.get(r.code) : undefined;
      if (!before) {
        toCreate.push(r);
        continue;
      }
      const data = {
        ...r.data,
        ...(r.language ? { preferredLanguage: r.language } : {}),
        ...(r.status ? { status: r.status } : {}),
      };
      const beforeIds = before.materialCategories.map((m) => m.categoryId);
      const removed = beforeIds.filter((c) => !r.categoryIds.includes(c));
      const added = r.categoryIds.filter((c) => !beforeIds.includes(c));
      // 内容没变就不写库（导出后原样导入时数据和更新时间都不变），但仍计为"更新"
      if (Object.keys(supplierAuditChanges(before, data)).length > 0) {
        await tx.supplier.update({ where: { id: before.id }, data });
      }
      if (removed.length) {
        await tx.supplierMaterialCategory.deleteMany({
          where: { supplierId: before.id, categoryId: { in: removed } },
        });
      }
      if (added.length) {
        await tx.supplierMaterialCategory.createMany({
          data: added.map((categoryId) => ({ supplierId: before.id, categoryId })),
        });
      }
      if (before.status === 'ENABLED' && r.status === 'DISABLED') disabled.push(before.id);
      updated.push(before.code);
    }
    // R04-6：导入停用的供应商同样立即删除其门户用户的会话
    await this.sessions.revokeAllForSuppliers(disabled, tx);

    const manualCodes = new Set(rows.map((r) => r.code).filter((c): c is string => c !== null));
    const autoCodes = await this.suppliers.allocateCodes(
      tx,
      toCreate.filter((r) => r.code === null).length,
      manualCodes,
    );
    const created = toCreate.map((r) => ({
      ...r.data,
      code: r.code ?? autoCodes.shift()!,
      ccEmails: [],
      preferredLanguage: r.language ?? 'zh-CN',
      status: r.status ?? 'ENABLED',
    }));
    const categoryIdsByCode = new Map(toCreate.map((r, i) => [created[i].code, r.categoryIds]));
    for (let i = 0; i < created.length; i += CREATE_CHUNK) {
      const inserted = await tx.supplier.createManyAndReturn({
        data: created.slice(i, i + CREATE_CHUNK),
        select: { id: true, code: true },
      });
      const links = inserted.flatMap((s) =>
        (categoryIdsByCode.get(s.code) ?? []).map((categoryId) => ({ supplierId: s.id, categoryId })),
      );
      if (links.length) await tx.supplierMaterialCategory.createMany({ data: links });
    }
    return { created: created.map((c) => c.code), updated };
  }

  /** 分类匹配顺序：编码（不区分大小写）→ 中文名 → 英文名（不区分大小写） */
  private matchCategory(categories: DictItem[], text: string): DictItem | undefined {
    const lower = text.toLowerCase();
    return (
      categories.find((c) => c.code.toLowerCase() === lower) ??
      categories.find((c) => c.nameZh === text) ??
      categories.find((c) => c.nameEn.toLowerCase() === lower)
    );
  }

  private text(row: ParsedRow, key: string): string | null {
    const value = row.values[key];
    return value === null || value === undefined ? null : String(value).trim() || null;
  }

  private supplierCategories(): Promise<DictItem[]> {
    return this.prisma.dictItem.findMany({
      where: { typeCode: 'supplier_category' },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    });
  }

  /** 按树的顺序列出有效启用的材料分类 */
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

  private instructions(supplierCategories: DictItem[], index: CategoryIndex): string[] {
    return [
      '填写说明 / Instructions',
      '1. 不要修改表头（名称和顺序都不能改），红色表头的列必填。Do not change the header row (names or order); columns with red headers are required.',
      '2. 供应商编码已存在则更新该供应商；为空或是新编码则新建，为空时自动生成 SUP10001 格式的编码。An existing Supplier Code updates that supplier; a blank or new code creates one (blank codes are generated automatically).',
      '3. 供应商分类填写下面的编码，或中文 / 英文名称。Supplier Category: one of the codes below, or its Chinese / English name.',
      '4. 主营材料分类填写下面列出的启用分类编码，多个用英文逗号分隔，如 PER-HS,PER-BRKT；可以为空。Main Category Codes: enabled category codes listed below, separated by commas (e.g. PER-HS,PER-BRKT); may be blank.',
      '5. 统一社会信用代码可以为空（如海外供应商）；填写时必须是 18 位字母或数字，且不能与其他供应商重复。The Unified Social Credit Code may be blank (e.g. for overseas suppliers); if filled in, it must be 18 letters or digits and unique among suppliers.',
      '6. 首选语言决定发给供应商的邮件语言，填写 中文、English 或 中英（也可以填 zh-CN、en-US、bilingual）；为空时新供应商为中文、已有供应商不变。Preferred Language decides the language of emails to the supplier: 中文, English or 中英 (or zh-CN, en-US, bilingual); if blank, new suppliers use Chinese and existing ones are unchanged.',
      '7. 抄送邮箱不在表格里维护，请在系统里编辑供应商。CC emails are not part of this file; edit them in the system.',
      '8. 导出的文件多一列"状态"（启用 / 停用），改完可以直接导入；没有这一列时新供应商为启用、已有供应商状态不变。Exported files have an extra Status column (Enabled / Disabled) and can be imported directly; without it, new suppliers are enabled and existing ones keep their status.',
      '9. 所有行都校验通过才会导入，有任何错误整个文件都不导入。The file is imported only if every row is valid.',
      '',
      '供应商分类 / Supplier Categories',
      ...supplierCategories.map((c) => `${c.code}  ${c.nameZh} / ${c.nameEn}`),
      '',
      '材料分类 / Categories',
      ...this.selectableCategories(index),
    ];
  }
}
