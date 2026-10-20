import { LOCALES, type Locale } from '@quoteflow/shared';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { createI18n } from 'vue-i18n';
import enUS from '@/locales/en-US';
import zhCN, { type MessageSchema } from '@/locales/zh-CN';

const STORAGE_KEY = 'qf_locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // localStorage 不可用时用浏览器语言
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
  missingWarn: false,
  fallbackWarn: false,
});

export function currentLocale(): Locale {
  return i18n.global.locale.value;
}

/**
 * 切换界面语言：只改响应式的 locale，不刷新页面、不重建路由组件，表单内容不会丢（R00-5）。
 * M01 起登录用户还会把语言保存到账号。
 */
export function applyLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  dayjs.locale(locale === 'zh-CN' ? 'zh-cn' : 'en');
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 忽略
  }
}

applyLocale(currentLocale());
