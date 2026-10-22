import { describe, expect, it } from 'vitest';
import { computeInquiryActions, isRoundEditable, type InquiryActionContext } from '../inquiry-actions';
import { PRESET_ROLES } from '../roles';
import {
  copyLineFilesSchema,
  createInquirySchema,
  createLineSchema,
  quantitySchema,
  rejectInquirySchema,
  updateLineSchema,
} from './inquiries';

const perms = (role: string) => new Set<string>(PRESET_ROLES.find((r) => r.code === role)!.permissions);

const ctx = (
  docStatus: InquiryActionContext['docStatus'],
  currentRoundStatus: InquiryActionContext['currentRoundStatus'] = 'DRAFT',
) => ({
  docStatus,
  currentRoundNo: 1,
  currentRoundStatus,
});

describe('R06-2 数量', () => {
  it('大于 0、最多 4 位小数，输出字符串', () => {
    expect(quantitySchema.parse('200000')).toBe('200000');
    expect(quantitySchema.parse(' 12.5 ')).toBe('12.5');
    expect(quantitySchema.parse(0.0001)).toBe('0.0001');
    expect(quantitySchema.parse('99999999999999.9999')).toBe('99999999999999.9999');
    expect(quantitySchema.parse('0200.50')).toBe('200.5');
  });

  it('0、负数、5 位小数、科学计数法、超过 14 位整数都不行', () => {
    for (const bad of ['0', '0.0000', '-1', '1.23456', '1e3', '', 'abc', '123456789012345', 1e-7]) {
      expect(quantitySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('R06-1 表头', () => {
  it('项目号、标题、材料类别、币种必填；项目号最多 50', () => {
    const ok = createInquirySchema.parse({
      projectNo: ' PJ-1 ',
      title: 'T',
      materialCategoryId: 'c1',
      currency: 'CNY',
    });
    expect(ok).toEqual({
      projectNo: 'PJ-1',
      title: 'T',
      materialCategoryId: 'c1',
      currency: 'CNY',
      pdUserId: null,
    });
    expect(
      createInquirySchema.safeParse({ title: 'T', materialCategoryId: 'c1', currency: 'CNY' }).success,
    ).toBe(false);
    expect(
      createInquirySchema.safeParse({
        projectNo: 'x'.repeat(51),
        title: 'T',
        materialCategoryId: 'c1',
        currency: 'CNY',
      }).success,
    ).toBe(false);
  });

  it('R06-7 驳回意见在 schema 里可以为空（由服务端返回 INQUIRY_REJECT_COMMENT_REQUIRED）', () => {
    expect(rejectInquirySchema.parse({ comment: '  ' })).toEqual({ comment: undefined });
  });
});

describe('R06-2 询价行', () => {
  it('材料行只要材料和数量；手工行名称、规格、单位、分类必填', () => {
    expect(createLineSchema.parse({ source: 'MATERIAL', materialId: 'm1', quantity: '10' })).toMatchObject({
      source: 'MATERIAL',
      materialId: 'm1',
      quantity: '10',
    });
    const manual = {
      source: 'MANUAL',
      nameZh: '灯珠',
      spec: '2835',
      unitCode: 'PCS',
      categoryId: 'c1',
      quantity: 1,
    };
    expect(createLineSchema.parse({ ...manual, materialCode: ' abc-1 ' })).toMatchObject({
      materialCode: 'ABC-1',
    });
    for (const key of ['nameZh', 'spec', 'unitCode', 'categoryId']) {
      expect(createLineSchema.safeParse({ ...manual, [key]: undefined }).success).toBe(false);
    }
  });

  it('更新材料行时不接受材料字段之外的必填项', () => {
    expect(updateLineSchema.parse({ source: 'MATERIAL', quantity: '3', nameZh: 'x' })).toEqual({
      source: 'MATERIAL',
      quantity: '3',
      brand: undefined,
      drawingRef: undefined,
      remark: undefined,
    });
  });

  it('复制到其他行：目标行去重', () => {
    expect(copyLineFilesSchema.parse({ fromLineId: 'a', toLineIds: ['b', 'b', 'c'] }).toLineIds).toEqual([
      'b',
      'c',
    ]);
  });
});

describe('allowedActions（03 §6）', () => {
  it('草稿：PD、采购员可以编辑和提交；采购主管还能取消', () => {
    expect(computeInquiryActions(ctx('DRAFT'), perms('PD'))).toEqual(['edit', 'submit']);
    expect(computeInquiryActions(ctx('DRAFT'), perms('BUYER'))).toEqual(['edit', 'submit']);
    expect(computeInquiryActions(ctx('DRAFT'), perms('PURCHASE_MANAGER'))).toEqual([
      'edit',
      'submit',
      'cancel',
    ]);
  });

  it('待审批：只有采购主管能通过、驳回、取消', () => {
    expect(computeInquiryActions(ctx('PENDING_APPROVAL'), perms('PD'))).toEqual([]);
    expect(computeInquiryActions(ctx('PENDING_APPROVAL'), perms('BUYER'))).toEqual([]);
    expect(computeInquiryActions(ctx('PENDING_APPROVAL'), perms('PURCHASE_MANAGER'))).toEqual([
      'approve',
      'reject',
      'cancel',
    ]);
  });

  it('已通过、未发布：采购主管可以取消；发布后本模块不给取消（M07 扩展）', () => {
    expect(computeInquiryActions(ctx('APPROVED'), perms('PD'))).toEqual([]);
    expect(computeInquiryActions(ctx('APPROVED'), perms('BUYER'))).toEqual([]);
    expect(computeInquiryActions(ctx('APPROVED'), perms('PURCHASE_MANAGER'))).toEqual(['cancel']);
    expect(computeInquiryActions(ctx('APPROVED', 'WAITING_QUOTES'), perms('PURCHASE_MANAGER'))).toEqual([]);
    expect(computeInquiryActions(ctx('CANCELLED', 'CANCELLED'), perms('PURCHASE_MANAGER'))).toEqual([]);
  });

  it('I-4 第 1 轮只在草稿时可以编辑', () => {
    expect(isRoundEditable('DRAFT', { roundNo: 1, status: 'DRAFT' })).toBe(true);
    expect(isRoundEditable('PENDING_APPROVAL', { roundNo: 1, status: 'DRAFT' })).toBe(false);
    expect(isRoundEditable('APPROVED', { roundNo: 1, status: 'DRAFT' })).toBe(false);
  });
});
