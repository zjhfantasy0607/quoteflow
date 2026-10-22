import { i18n } from '@/i18n';

/** 操作日志的动作名（如 inquiry.approve → system.audit.actions.inquiry_approve）；没有翻译时显示代码 */
export function auditActionLabel(action: string): string {
  const { t, te } = i18n.global;
  const key = `system.audit.actions.${action.replace(/\./g, '_')}`;
  return te(key) ? t(key) : action;
}
