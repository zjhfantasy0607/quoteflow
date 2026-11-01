import { describe, expect, it } from 'vitest';
import { inquiryListQuerySchema } from './schemas/inquiries';
import { PRESET_ROLES } from './roles';
import { WORKBENCH_CARDS, WORKBENCH_CARD_PERMISSIONS, workbenchCards } from './workbench';

const cardsOf = (code: string) => {
  const role = PRESET_ROLES.find((r) => r.code === code)!;
  return workbenchCards({ has: (p) => (role.permissions as readonly string[]).includes(p) });
};

describe('M16 工作台卡片', () => {
  it('每张卡片都有所需权限，按显示顺序返回', () => {
    expect(Object.keys(WORKBENCH_CARD_PERMISSIONS)).toEqual([...WORKBENCH_CARDS]);
    expect(workbenchCards({ has: () => true })).toEqual([...WORKBENCH_CARDS]);
    expect(workbenchCards({ has: () => false })).toEqual([]);
  });

  it('预置角色看到的卡片集合', () => {
    expect(cardsOf('ADMIN')).toEqual(['waitingQuotes']);
    expect(cardsOf('PD')).toEqual(['myDrafts', 'waitingQuotes']);
    expect(cardsOf('BUYER')).toEqual(['myDrafts', 'readyToPublish', 'waitingQuotes', 'negotiations']);
    expect(cardsOf('PURCHASE_MANAGER')).toEqual([
      'pendingApproval',
      'myDrafts',
      'readyToPublish',
      'waitingQuotes',
      'toOpen',
      'negotiations',
      'contractsToReview',
    ]);
    expect(cardsOf('CONTRACT_APPROVER')).toEqual(['waitingQuotes', 'contractsToApprove']);
    expect(cardsOf('SUPPLIER')).toEqual([]);
  });

  it('询价列表的 mine 只接受 true / false', () => {
    expect(inquiryListQuerySchema.parse({ mine: 'true' }).mine).toBe(true);
    expect(inquiryListQuerySchema.parse({ mine: 'false' }).mine).toBe(false);
    expect(inquiryListQuerySchema.parse({}).mine).toBeUndefined();
    expect(inquiryListQuerySchema.safeParse({ mine: '1' }).success).toBe(false);
  });
});
