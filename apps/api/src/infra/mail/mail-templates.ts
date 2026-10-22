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
  'account.activate': {
    name: string;
    supplier: { nameZh: string; nameEn: string | null };
    username: string;
    link: string;
    expiresAt: Date;
  };
  'approval.request': {
    name: string;
    inquiry: { draftNo: string; projectNo: string; title: string };
    submitterName: string;
    link: string;
  };
  'approval.result': {
    name: string;
    approved: boolean;
    inquiry: { draftNo: string; formalNo: string | null; projectNo: string; title: string };
    approverName: string;
    comment: string | null;
    link: string;
  };
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

/** 供应商门户账号激活（R04-10）：链接 7 天有效、只能用一次 */
const activate: MailTemplate<MailTemplateDataMap['account.activate']> = {
  type: 'ACCOUNT',
  render(lang, d, ctx) {
    const expires = formatMailTime(d.expiresAt, lang);
    if (lang === 'zh-CN') {
      const company = ctx.company.nameZh;
      const supplier = d.supplier.nameZh;
      return {
        subject: `激活您的 ${company} 供应商门户账号`,
        body: `<p>${esc(d.name)}，您好：</p><p>${esc(company)}已为 ${esc(supplier)} 开通 QuoteFlow 供应商门户账号，登录账号为 <strong>${esc(d.username)}</strong>。请在 ${esc(expires)} 前点击下面的按钮设置密码，完成激活后即可登录门户查看询价、在线报价。链接只能使用一次。</p>${button(d.link, '设置密码并激活')}<p>如果链接已过期，请联系采购人员重新发送激活邮件。</p>`,
        text: `${d.name}，您好：\n\n${company}已为 ${supplier} 开通 QuoteFlow 供应商门户账号，登录账号为 ${d.username}。请在 ${expires} 前打开下面的链接设置密码，完成激活后即可登录门户查看询价、在线报价。链接只能使用一次：\n${d.link}\n\n如果链接已过期，请联系采购人员重新发送激活邮件。`,
      };
    }
    const company = ctx.company.nameEn;
    const supplier = d.supplier.nameEn ?? d.supplier.nameZh;
    return {
      subject: `Activate your ${company} supplier portal account`,
      body: `<p>Dear ${esc(d.name)},</p><p>${esc(company)} has created a QuoteFlow supplier portal account for ${esc(supplier)}. Your login is <strong>${esc(d.username)}</strong>. Please set your password before ${esc(expires)} to activate the account; you can then sign in to view inquiries and submit quotations online. The link can be used only once.</p>${button(d.link, 'Set password and activate')}<p>If the link has expired, please ask your purchasing contact to send a new activation email.</p>`,
      text: `Dear ${d.name},\n\n${company} has created a QuoteFlow supplier portal account for ${supplier}. Your login is ${d.username}. Open the link below before ${expires} to set your password and activate the account (single use); you can then sign in to view inquiries and submit quotations online:\n${d.link}\n\nIf the link has expired, please ask your purchasing contact to send a new activation email.`,
    };
  },
};

/** 询价单提交审批（R06-8）：发给有 inquiry:approve 且数据权限覆盖该单的每个审批人 */
const approvalRequest: MailTemplate<MailTemplateDataMap['approval.request']> = {
  type: 'APPROVAL',
  render(lang, d) {
    const { draftNo, projectNo, title } = d.inquiry;
    if (lang === 'zh-CN') {
      return {
        subject: `询价单待审批：${draftNo} ${title}`,
        body: `<p>${esc(d.name)}，您好：</p><p>${esc(d.submitterName)} 提交了询价单，请您审批：</p><ul><li>草稿号：${esc(draftNo)}</li><li>项目号：${esc(projectNo)}</li><li>标题：${esc(title)}</li></ul>${button(d.link, '查看并审批')}`,
        text: `${d.name}，您好：\n\n${d.submitterName} 提交了询价单，请您审批：\n草稿号：${draftNo}\n项目号：${projectNo}\n标题：${title}\n\n查看并审批：${d.link}`,
      };
    }
    return {
      subject: `RFQ pending approval: ${draftNo} ${title}`,
      body: `<p>Dear ${esc(d.name)},</p><p>${esc(d.submitterName)} has submitted an RFQ for your approval:</p><ul><li>Draft No.: ${esc(draftNo)}</li><li>Project No.: ${esc(projectNo)}</li><li>Title: ${esc(title)}</li></ul>${button(d.link, 'Review and approve')}`,
      text: `Dear ${d.name},\n\n${d.submitterName} has submitted an RFQ for your approval:\nDraft No.: ${draftNo}\nProject No.: ${projectNo}\nTitle: ${title}\n\nReview and approve: ${d.link}`,
    };
  },
};

/** 审批结果（R06-8）：发给负责人和创建人；通过时带正式询价号，驳回时带意见 */
const approvalResult: MailTemplate<MailTemplateDataMap['approval.result']> = {
  type: 'APPROVAL',
  render(lang, d) {
    const { draftNo, formalNo, projectNo, title } = d.inquiry;
    const no = formalNo ?? draftNo;
    if (lang === 'zh-CN') {
      const label = d.approved ? '审批意见' : '驳回意见';
      const result = d.approved
        ? `已由 ${d.approverName} 审批通过，正式询价号为 ${formalNo}，可以邀请供应商并发布询价。`
        : `已被 ${d.approverName} 驳回，回到草稿，请按意见修改后重新提交。`;
      return {
        subject: d.approved ? `询价单已审批通过：${no} ${title}` : `询价单被驳回：${no} ${title}`,
        body: `<p>${esc(d.name)}，您好：</p><p>询价单 ${esc(draftNo)}（项目号 ${esc(projectNo)}，${esc(title)}）${esc(result)}</p>${d.comment ? `<p>${label}：${esc(d.comment)}</p>` : ''}${button(d.link, '查看询价单')}`,
        text: `${d.name}，您好：\n\n询价单 ${draftNo}（项目号 ${projectNo}，${title}）${result}${d.comment ? `\n${label}：${d.comment}` : ''}\n\n查看询价单：${d.link}`,
      };
    }
    const result = d.approved
      ? `has been approved by ${d.approverName}. The formal RFQ No. is ${formalNo}; you can now invite suppliers and publish it.`
      : `has been rejected by ${d.approverName} and returned to draft. Please revise it according to the comment and submit it again.`;
    return {
      subject: d.approved ? `RFQ approved: ${no} ${title}` : `RFQ rejected: ${no} ${title}`,
      body: `<p>Dear ${esc(d.name)},</p><p>RFQ ${esc(draftNo)} (Project No. ${esc(projectNo)}, ${esc(title)}) ${esc(result)}</p>${d.comment ? `<p>Comment: ${esc(d.comment)}</p>` : ''}${button(d.link, 'View RFQ')}`,
      text: `Dear ${d.name},\n\nRFQ ${draftNo} (Project No. ${projectNo}, ${title}) ${result}${d.comment ? `\nComment: ${d.comment}` : ''}\n\nView RFQ: ${d.link}`,
    };
  },
};

export const MAIL_TEMPLATES: { [K in MailTemplateKey]: MailTemplate<MailTemplateDataMap[K]> } = {
  'account.resetPassword': resetPassword,
  'account.activate': activate,
  'approval.request': approvalRequest,
  'approval.result': approvalResult,
};
