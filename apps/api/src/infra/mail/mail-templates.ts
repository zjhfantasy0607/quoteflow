// 邮件模板注册表。各模块在 MailTemplateDataMap 里登记模板数据结构，在 MAIL_TEMPLATES 里登记渲染函数。
import type { EmailType } from '@quoteflow/shared';
import { formatMailTime } from '../../common/time';
import { button, esc, type MailContext, type MailLang, type MailPart } from './mail-layout';

export interface MailTemplate<D> {
  type: EmailType;
  render(lang: MailLang, data: D, ctx: MailContext): MailPart;
}

export interface MailTemplateDataMap {
  'account.resetPassword': { name: string; link: string; expiresAt: Date };
}

export type MailTemplateKey = keyof MailTemplateDataMap;

const resetPassword: MailTemplate<MailTemplateDataMap['account.resetPassword']> = {
  type: 'ACCOUNT',
  render(lang, d) {
    const expires = formatMailTime(d.expiresAt, lang);
    if (lang === 'zh-CN') {
      return {
        subject: '重置 QuoteFlow 账号密码',
        body: `<p>${esc(d.name)}，您好：</p><p>我们收到了重置您 QuoteFlow 账号密码的请求。请在 ${esc(expires)} 前点击下面的按钮设置新密码，链接只能使用一次。</p>${button(d.link, '设置新密码')}<p>如果这不是您本人的操作，请忽略本邮件，您的密码不会改变。</p>`,
        text: `${d.name}，您好：\n\n我们收到了重置您 QuoteFlow 账号密码的请求。请在 ${expires} 前打开下面的链接设置新密码，链接只能使用一次：\n${d.link}\n\n如果这不是您本人的操作，请忽略本邮件，您的密码不会改变。`,
      };
    }
    return {
      subject: 'Reset your QuoteFlow password',
      body: `<p>Dear ${esc(d.name)},</p><p>We received a request to reset the password of your QuoteFlow account. Please set a new password before ${esc(expires)}. The link can be used only once.</p>${button(d.link, 'Set a new password')}<p>If you did not request this, please ignore this email and your password will stay the same.</p>`,
      text: `Dear ${d.name},\n\nWe received a request to reset the password of your QuoteFlow account. Open the link below before ${expires} to set a new password (single use):\n${d.link}\n\nIf you did not request this, please ignore this email and your password will stay the same.`,
    };
  },
};

export const MAIL_TEMPLATES: { [K in MailTemplateKey]: MailTemplate<MailTemplateDataMap[K]> } = {
  'account.resetPassword': resetPassword,
};
