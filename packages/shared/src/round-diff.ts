import { Dec } from './decimal';
import type { InquiryFileKind } from './schemas/inquiries';

// 规格对比（M13 R13-6）：新一轮的行按 sourceLineId 对上上一轮的行，比较名称、规格、单位、数量、分类、品牌、图纸编号、备注，
// 标出新增行、删除行、修改的字段和附件增删。采购方与门户共用（门户不比较、不返回备注，P-5）

/** 比较的字段：名称（中英文）、规格、单位、数量、分类、品牌、图纸编号、备注 */
export const ROUND_DIFF_FIELDS = [
  'nameZh',
  'nameEn',
  'spec',
  'unitCode',
  'quantity',
  'category',
  'brand',
  'drawingRef',
  'remark',
] as const;
export type RoundDiffField = (typeof ROUND_DIFF_FIELDS)[number];

export const ROUND_DIFF_CHANGES = ['ADDED', 'REMOVED', 'MODIFIED', 'UNCHANGED'] as const;
export type RoundDiffChange = (typeof ROUND_DIFF_CHANGES)[number];

/** 一条附件挂载：同一个文件（fileId）挂在两轮的同一位置算没变，换了文件算删一个、加一个 */
export interface RoundDiffFile {
  fileId: string;
  originalName: string;
  kind: InquiryFileKind;
}

export interface RoundDiffFilesDto {
  added: RoundDiffFile[];
  removed: RoundDiffFile[];
}

/** 一行的比较字段（门户没有 remark） */
export interface RoundDiffLineValues {
  lineId: string;
  lineNo: number;
  materialCode: string | null;
  nameZh: string;
  nameEn: string | null;
  spec: string;
  /** 字典 unit */
  unitCode: string;
  /** 十进制字符串 */
  quantity: string;
  category: { id: string; code: string; nameZh: string; nameEn: string };
  brand: string | null;
  drawingRef: string | null;
  /** 询价行备注按内部备注处理，门户不返回（P-5、B-25） */
  remark?: string | null;
}

/** diffRounds() 的输入：一行连同来源行和它的附件 */
export interface RoundDiffLineInput extends RoundDiffLineValues {
  /** 复制自上一轮的哪一行；新增的行为 null */
  sourceLineId: string | null;
  files: RoundDiffFile[];
}

export interface RoundDiffLineDto {
  change: RoundDiffChange;
  /** 上一轮的行；新增的行为 null */
  before: RoundDiffLineValues | null;
  /** 本轮的行；删除的行为 null */
  after: RoundDiffLineValues | null;
  /** MODIFIED 时变化的字段，按 ROUND_DIFF_FIELDS 的顺序 */
  changedFields: RoundDiffField[];
  /** 这一行的附件增删；新增行的附件都算新增，删除行的都算删除 */
  files: RoundDiffFilesDto;
}

/** GET /api/inquiries/:id/rounds/:roundNo/diff（与上一轮对比）；门户报价详情第 2 轮起也带它 */
export interface RoundDiffDto {
  roundNo: number;
  previousRoundNo: number;
  changeReason: string | null;
  changeSummary: string | null;
  /** 本轮的行按行号，之后是被删除的行（按上一轮的行号） */
  lines: RoundDiffLineDto[];
  /** 整单附件（规格书）的增删 */
  files: RoundDiffFilesDto;
  summary: Record<RoundDiffChange, number>;
}

export interface RoundDiffRoundInput {
  lines: RoundDiffLineInput[];
  /** 整单附件 */
  files: RoundDiffFile[];
}

const fileKey = (f: RoundDiffFile) => `${f.kind}:${f.fileId}`;

function diffFiles(before: RoundDiffFile[], after: RoundDiffFile[]): RoundDiffFilesDto {
  const had = new Set(before.map(fileKey));
  const has = new Set(after.map(fileKey));
  return {
    added: after.filter((f) => !had.has(fileKey(f))),
    removed: before.filter((f) => !has.has(fileKey(f))),
  };
}

function sameField(field: RoundDiffField, a: RoundDiffLineValues, b: RoundDiffLineValues): boolean {
  if (field === 'quantity') return new Dec(a.quantity).equals(new Dec(b.quantity));
  if (field === 'category') return a.category.id === b.category.id;
  return (a[field] ?? null) === (b[field] ?? null);
}

/**
 * R13-6：current 是新一轮，previous 是上一轮。includeRemark = false（门户）时既不比较也不返回备注，
 * 只改了备注的行算没变
 */
export function diffRounds(
  previous: RoundDiffRoundInput,
  current: RoundDiffRoundInput,
  options: { includeRemark: boolean },
): Pick<RoundDiffDto, 'lines' | 'files' | 'summary'> {
  const fields = ROUND_DIFF_FIELDS.filter((f) => f !== 'remark' || options.includeRemark);
  const values = (line: RoundDiffLineInput): RoundDiffLineValues => {
    const { sourceLineId: _source, files: _files, remark, ...rest } = line;
    return options.includeRemark ? { ...rest, remark: remark ?? null } : rest;
  };
  const byLineNo = (a: RoundDiffLineInput, b: RoundDiffLineInput) => a.lineNo - b.lineNo;
  const previousById = new Map(previous.lines.map((l) => [l.lineId, l]));
  const matched = new Set<string>();
  const lines: RoundDiffLineDto[] = [];

  for (const line of [...current.lines].sort(byLineNo)) {
    const before = line.sourceLineId ? previousById.get(line.sourceLineId) : undefined;
    if (!before) {
      lines.push({
        change: 'ADDED',
        before: null,
        after: values(line),
        changedFields: [],
        files: { added: line.files, removed: [] },
      });
      continue;
    }
    matched.add(before.lineId);
    const changedFields = fields.filter((f) => !sameField(f, before, line));
    const files = diffFiles(before.files, line.files);
    const modified = changedFields.length > 0 || files.added.length > 0 || files.removed.length > 0;
    lines.push({
      change: modified ? 'MODIFIED' : 'UNCHANGED',
      before: values(before),
      after: values(line),
      changedFields,
      files,
    });
  }
  for (const before of [...previous.lines].sort(byLineNo)) {
    if (matched.has(before.lineId)) continue;
    lines.push({
      change: 'REMOVED',
      before: values(before),
      after: null,
      changedFields: [],
      files: { added: [], removed: before.files },
    });
  }

  const summary: Record<RoundDiffChange, number> = { ADDED: 0, REMOVED: 0, MODIFIED: 0, UNCHANGED: 0 };
  for (const l of lines) summary[l.change] += 1;
  return { lines, files: diffFiles(previous.files, current.files), summary };
}
