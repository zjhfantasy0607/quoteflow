import { i18n } from '@/i18n';

/** 设置浏览器标签页标题：页面名 - 系统名（随当前语言） */
export function setPageTitle(titleKey?: string): void {
  const t = i18n.global.t;
  document.title = titleKey ? `${t(titleKey)} - ${t('common.appName')}` : t('common.appName');
}
