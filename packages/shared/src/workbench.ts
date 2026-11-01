import type { PermissionChecker } from './inquiry-actions';
import type { PermissionCode } from './permissions';

// 工作台（M16）：采购方按权限显示卡片，供应商固定三张卡片；每张卡片是"数量 + 前几条"

/** 采购方工作台的卡片，按显示顺序（M16 §2） */
export const WORKBENCH_CARDS = [
  'pendingApproval',
  'myDrafts',
  'readyToPublish',
  'waitingQuotes',
  'toOpen',
  'negotiations',
  'contractsToReview',
  'contractsToApprove',
] as const;
export type WorkbenchCardKey = (typeof WORKBENCH_CARDS)[number];

/** 每张卡片所需的功能权限；没有权限的卡片接口不返回 */
export const WORKBENCH_CARD_PERMISSIONS: Record<WorkbenchCardKey, PermissionCode> = {
  pendingApproval: 'inquiry:approve',
  myDrafts: 'inquiry:create',
  readyToPublish: 'inquiry:publish',
  waitingQuotes: 'inquiry:view',
  toOpen: 'inquiry:open',
  negotiations: 'inquiry:evaluate',
  contractsToReview: 'contract:review',
  contractsToApprove: 'contract:approve',
};

/** 当前用户能看到的卡片（按显示顺序） */
export function workbenchCards(perms: PermissionChecker): WorkbenchCardKey[] {
  return WORKBENCH_CARDS.filter((key) => perms.has(WORKBENCH_CARD_PERMISSIONS[key]));
}

/** 供应商工作台的卡片（M16 §2：待报价、议价待回复、最近结果） */
export const PORTAL_WORKBENCH_CARDS = ['pendingQuotes', 'negotiations', 'recentResults'] as const;
export type PortalWorkbenchCardKey = (typeof PORTAL_WORKBENCH_CARDS)[number];

/** 每张卡片列出的条数，其余看"查看全部" */
export const WORKBENCH_CARD_LIMIT = 5;

/** 供应商"最近结果"只列最近多少天内定标的 */
export const PORTAL_RECENT_RESULT_DAYS = 30;
