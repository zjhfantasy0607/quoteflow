import { ContractStatus } from './enums';
import type { PermissionChecker } from './inquiry-actions';
import type { PermissionCode } from './permissions';

/** 合同详情的 allowedActions（03 §6），前端只按它显示按钮 */
export const CONTRACT_ACTIONS = ['edit', 'submit', 'review', 'approve', 'uploadSignedScan'] as const;
export type ContractAction = (typeof CONTRACT_ACTIONS)[number];

/** ContractApproval.step：提交、合同审核、合同批准 */
export const CONTRACT_STEPS = ['SUBMIT', 'REVIEW', 'APPROVE'] as const;
export type ContractStep = (typeof CONTRACT_STEPS)[number];

/**
 * 05 §6 合同状态表：草稿可以编辑、提交审核（contract:edit）；待审核由 contract:review 审核；待批准由 contract:approve 批准；
 * 已批准后可以上传签字扫描件（contract:edit）。动作接口用同一个函数复核（CONTRACT_INVALID_STATUS）
 */
export function computeContractActions(ctx: { status: ContractStatus }, perms: PermissionChecker): ContractAction[] {
  const can = (code: PermissionCode) => perms.has(code);
  const actions: ContractAction[] = [];
  if (ctx.status === ContractStatus.DRAFT && can('contract:edit')) actions.push('edit', 'submit');
  if (ctx.status === ContractStatus.PENDING_REVIEW && can('contract:review')) actions.push('review');
  if (ctx.status === ContractStatus.PENDING_APPROVAL && can('contract:approve')) actions.push('approve');
  if (ctx.status === ContractStatus.APPROVED && can('contract:edit')) actions.push('uploadSignedScan');
  return actions;
}
