import { describe, expect, it } from 'vitest';
import { diffRounds, type RoundDiffFile, type RoundDiffLineInput } from './round-diff';

const LED = { id: 'c-led', code: 'LED-COB', nameZh: 'COB 灯珠', nameEn: 'COB LED' };
const OTHER = { id: 'c-2835', code: 'LED-2835', nameZh: '2835 灯珠', nameEn: '2835 SMD LED' };
const file = (fileId: string, kind: RoundDiffFile['kind'] = 'SPEC_DOC'): RoundDiffFile => ({
  fileId,
  originalName: `${fileId}.pdf`,
  kind,
});

function line(id: string, lineNo: number, extra: Partial<RoundDiffLineInput> = {}): RoundDiffLineInput {
  return {
    lineId: id,
    lineNo,
    sourceLineId: null,
    materialCode: null,
    nameZh: `灯珠 ${lineNo}`,
    nameEn: null,
    spec: 'COB / 10W / Ra80',
    unitCode: 'PCS',
    quantity: '1000',
    category: LED,
    brand: null,
    drawingRef: null,
    remark: '内部备注',
    files: [],
    ...extra,
  };
}

describe('R13-6 规格对比', () => {
  const previous = {
    lines: [
      line('a1', 1, { files: [file('spec-a'), file('img-a', 'PRODUCT_IMAGE')] }),
      line('a2', 2),
      line('a3', 3, { remark: '旧备注' }),
    ],
    files: [file('whole-1'), file('whole-2')],
  };

  it('按 sourceLineId 匹配：修改的字段、新增行、删除行、附件增删，摘要计数', () => {
    const current = {
      lines: [
        // 第 1 行改规格、数量（同值不同写法不算变）、换了规格书
        line('b1', 1, {
          sourceLineId: 'a1',
          spec: 'COB / 10W / Ra90',
          files: [file('spec-a2'), file('img-a', 'PRODUCT_IMAGE')],
        }),
        // 原第 3 行没变，挪到第 2 行
        line('b2', 2, { sourceLineId: 'a3', nameZh: '灯珠 3', remark: '旧备注', quantity: '1000.00' }),
        // 新增一行
        line('b3', 3, { nameZh: '新灯珠', category: OTHER }),
      ],
      files: [file('whole-1'), file('whole-3')],
    };
    const diff = diffRounds(previous, current, { includeRemark: true });
    expect(diff.lines.map((l) => [l.change, l.after?.lineNo ?? null, l.before?.lineNo ?? null])).toEqual([
      ['MODIFIED', 1, 1],
      ['UNCHANGED', 2, 3],
      ['ADDED', 3, null],
      ['REMOVED', null, 2],
    ]);
    expect(diff.lines[0].changedFields).toEqual(['spec']);
    expect(diff.lines[0].files).toEqual({ added: [file('spec-a2')], removed: [file('spec-a')] });
    expect(diff.lines[2].files.added).toEqual([]);
    expect(diff.lines[2].after).toMatchObject({ nameZh: '新灯珠', category: OTHER, remark: '内部备注' });
    expect(diff.files).toEqual({ added: [file('whole-3')], removed: [file('whole-2')] });
    expect(diff.summary).toEqual({ ADDED: 1, REMOVED: 1, MODIFIED: 1, UNCHANGED: 1 });
  });

  it('单位、分类、品牌、图纸编号、备注都比较；只换附件的行也算修改', () => {
    const current = {
      lines: [
        line('b1', 1, {
          sourceLineId: 'a1',
          unitCode: 'SET',
          category: OTHER,
          brand: '新能',
          drawingRef: 'DWG-2',
        }),
        line('b2', 2, { sourceLineId: 'a2', remark: '改了备注' }),
        line('b3', 3, { sourceLineId: 'a3', remark: '旧备注', files: [file('new-img', 'PRODUCT_IMAGE')] }),
      ],
      files: previous.files,
    };
    const diff = diffRounds(previous, current, { includeRemark: true });
    expect(diff.lines.map((l) => [l.change, l.changedFields])).toEqual([
      ['MODIFIED', ['unitCode', 'category', 'brand', 'drawingRef']],
      ['MODIFIED', ['remark']],
      ['MODIFIED', []],
    ]);
    expect(diff.lines[0].files.removed).toEqual(previous.lines[0].files);
    expect(diff.lines[2].files.added).toEqual([file('new-img', 'PRODUCT_IMAGE')]);
  });

  it('P-5 门户（includeRemark = false）：不比较、不返回备注，只改了备注的行算没变', () => {
    const current = {
      lines: [
        line('b1', 1, { sourceLineId: 'a1', remark: '新备注', files: previous.lines[0].files }),
        line('b2', 2, { sourceLineId: 'a2', quantity: '2000' }),
      ],
      files: previous.files,
    };
    const diff = diffRounds(previous, current, { includeRemark: false });
    expect(diff.lines.map((l) => [l.change, l.changedFields])).toEqual([
      ['UNCHANGED', []],
      ['MODIFIED', ['quantity']],
      ['REMOVED', []],
    ]);
    expect(JSON.stringify(diff)).not.toMatch(/remark|备注/);
  });
});
