import { ElMessageBox, type ElMessageBoxOptions } from 'element-plus';
import { i18n } from '@/i18n';

/** 确认框：确定返回 true，取消或关闭返回 false（不抛异常） */
export async function confirmAction(message: string, options: ElMessageBoxOptions = {}): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, i18n.global.t('common.confirmTitle'), {
      type: 'warning',
      confirmButtonText: i18n.global.t('common.actions.confirm'),
      cancelButtonText: i18n.global.t('common.actions.cancel'),
      ...options,
    });
    return true;
  } catch {
    return false;
  }
}

/** 输入框：确定返回输入内容，取消返回 null */
export async function promptText(
  message: string,
  title: string,
  options: ElMessageBoxOptions = {},
): Promise<string | null> {
  try {
    const { value } = await ElMessageBox.prompt(message, title, {
      confirmButtonText: i18n.global.t('common.actions.confirm'),
      cancelButtonText: i18n.global.t('common.actions.cancel'),
      ...options,
    });
    return value;
  } catch {
    return null;
  }
}
