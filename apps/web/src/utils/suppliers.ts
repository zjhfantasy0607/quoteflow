import type { SupplierLanguage } from '@quoteflow/shared';
import { i18n } from '@/i18n';

/** 文案键里不用连字符，语言代码要转一下 */
const LANGUAGE_KEY: Record<SupplierLanguage, string> = {
  'zh-CN': 'zhCN',
  'en-US': 'enUS',
  bilingual: 'bilingual',
};

/** 供应商首选语言的显示名称（R04-3） */
export function supplierLanguageLabel(language: string): string {
  const key = LANGUAGE_KEY[language as SupplierLanguage];
  return key ? i18n.global.t(`suppliers.languages.${key}`) : language;
}
