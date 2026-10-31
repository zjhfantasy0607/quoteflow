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
  invitation: SupplierNotice & { deadline: Date; lineCount: number; link: string };
  reminder: SupplierNotice & { deadline: Date; link: string };
  'change.deadline': SupplierNotice & { previousDeadline: Date; deadline: Date; link: string };
  'change.cancel': SupplierNotice & { reason: string };
  opening: SupplierNotice & { openedAt: Date; link: string };
  'negotiation.toSupplier': SupplierNotice & {
    type: 'OFFER' | 'CLOSE';
    negotiationRound: number;
    link: string;
  };
  'negotiation.toBuyer': NegotiationBuyerNotice & { type: 'REJECT' | 'COUNTER' };
  'negotiation.agreed':
    | (SupplierNotice & { audience: 'SUPPLIER'; link: string })
    | (NegotiationBuyerNotice & { audience: 'BUYER' });
}

/** 发给询价负责人的议价通知（M11）：内部邮件也不写金额和议价内容（管理员能在邮件记录里看到正文） */
export interface NegotiationBuyerNotice {
  name: string;
  supplier: { code: string; nameZh: string; nameEn: string | null };
  inquiry: { formalNo: string; title: string };
  negotiationRound: number;
  /** 成交时生成的报价版本号 */
  versionNo?: number;
  link: string;
}

/**
 * 发给供应商的询价通知（M07）：只有正式询价号和标题，不含项目号、其他供应商、任何金额（R07-5）。
 * contactName 是供应商联系人，buyer 是采购联系人（询价负责人）
 */
export interface SupplierNotice {
  contactName: string;
  supplier: { nameZh: string; nameEn: string | null };
  inquiry: { formalNo: string; title: string };
  buyer: { name: string; email: string | null };
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

/** 供应商通知的公共部分：称呼、供应商名称、采购联系人 */
function notice(lang: MailLang, d: SupplierNotice) {
  const { name, email } = d.buyer;
  if (lang === 'zh-CN') {
    const contact = `采购联系人：${name}${email ? `（${email}）` : ''}`;
    return {
      hello: `<p>${esc(d.contactName)}，您好：</p>`,
      helloText: `${d.contactName}，您好：`,
      supplier: d.supplier.nameZh,
      contact: `<p>${esc(contact)}</p>`,
      contactText: contact,
    };
  }
  const contact = `Purchasing contact: ${name}${email ? ` (${email})` : ''}`;
  return {
    hello: `<p>Dear ${esc(d.contactName)},</p>`,
    helloText: `Dear ${d.contactName},`,
    supplier: d.supplier.nameEn ?? d.supplier.nameZh,
    contact: `<p>${esc(contact)}</p>`,
    contactText: contact,
  };
}

/** 询价邀请（R07-4、R07-5）：发布或补充邀请时每家一封，链接直达门户里的报价单 */
const invitation: MailTemplate<MailTemplateDataMap['invitation']> = {
  type: 'INVITATION',
  render(lang, d, ctx) {
    const n = notice(lang, d);
    const { formalNo, title } = d.inquiry;
    const deadline = formatMailTime(d.deadline, lang);
    if (lang === 'zh-CN') {
      const intro = `${ctx.company.nameZh}诚邀${n.supplier}参加以下询价，请在报价截止前登录供应商门户在线报价；如不参与，也请在门户中回复"拒绝报价"。`;
      const noAccount = '如果贵司还没有门户账号或无法登录，请联系采购联系人。';
      return {
        subject: `询价邀请：${formalNo} ${title}`,
        body: `${n.hello}<p>${esc(intro)}</p><ul><li>询价单号：${esc(formalNo)}</li><li>标题：${esc(title)}</li><li>询价明细：${d.lineCount} 行</li><li>报价截止：${esc(deadline)}</li></ul>${button(d.link, '查看询价并报价')}${n.contact}<p>${noAccount}</p>`,
        text: `${n.helloText}\n\n${intro}\n询价单号：${formalNo}\n标题：${title}\n询价明细：${d.lineCount} 行\n报价截止：${deadline}\n\n查看询价并报价：${d.link}\n\n${n.contactText}\n${noAccount}`,
      };
    }
    const intro = `${ctx.company.nameEn} invites ${n.supplier} to quote for the RFQ below. Please sign in to the supplier portal and submit your quotation before the deadline. If you will not quote, please decline it in the portal.`;
    const noAccount =
      'If you do not have a portal account yet or cannot sign in, please contact the purchasing contact.';
    const lines = `${d.lineCount} ${d.lineCount === 1 ? 'line' : 'lines'}`;
    return {
      subject: `Request for quotation: ${formalNo} ${title}`,
      body: `${n.hello}<p>${esc(intro)}</p><ul><li>RFQ No.: ${esc(formalNo)}</li><li>Title: ${esc(title)}</li><li>Items: ${lines}</li><li>Quotation deadline: ${esc(deadline)}</li></ul>${button(d.link, 'View RFQ and quote')}${n.contact}<p>${noAccount}</p>`,
      text: `${n.helloText}\n\n${intro}\nRFQ No.: ${formalNo}\nTitle: ${title}\nItems: ${lines}\nQuotation deadline: ${deadline}\n\nView RFQ and quote: ${d.link}\n\n${n.contactText}\n${noAccount}`,
    };
  },
};

/** 催报（R07-8 手动、R07-9 截止前自动）：只发给还没有提交也没有拒绝的供应商 */
const reminder: MailTemplate<MailTemplateDataMap['reminder']> = {
  type: 'REMINDER',
  render(lang, d) {
    const n = notice(lang, d);
    const { formalNo, title } = d.inquiry;
    const deadline = formatMailTime(d.deadline, lang);
    if (lang === 'zh-CN') {
      const message = `询价 ${formalNo}（${title}）将于 ${deadline}截止，我们还没有收到${n.supplier}的报价或回复。请尽快登录供应商门户报价；如不参与本次报价，也请在门户中回复"拒绝报价"。`;
      return {
        subject: `报价提醒：${formalNo} ${title}`,
        body: `${n.hello}<p>${esc(message)}</p>${button(d.link, '立即报价')}${n.contact}`,
        text: `${n.helloText}\n\n${message}\n\n立即报价：${d.link}\n\n${n.contactText}`,
      };
    }
    const message = `RFQ ${formalNo} (${title}) closes at ${deadline}, and we have not yet received a quotation or reply from ${n.supplier}. Please sign in to the supplier portal and quote as soon as possible. If you will not quote, please decline it in the portal.`;
    return {
      subject: `Quotation reminder: ${formalNo} ${title}`,
      body: `${n.hello}<p>${esc(message)}</p>${button(d.link, 'Quote now')}${n.contact}`,
      text: `${n.helloText}\n\n${message}\n\nQuote now: ${d.link}\n\n${n.contactText}`,
    };
  },
};

/** 延期（R07-10）：发给受邀且没有拒绝的供应商 */
const deadlineChanged: MailTemplate<MailTemplateDataMap['change.deadline']> = {
  type: 'CHANGE',
  render(lang, d) {
    const n = notice(lang, d);
    const { formalNo, title } = d.inquiry;
    const before = formatMailTime(d.previousDeadline, lang);
    const after = formatMailTime(d.deadline, lang);
    if (lang === 'zh-CN') {
      const message = `询价 ${formalNo}（${title}）的报价截止时间已由 ${before}调整为 ${after}。已提交的报价继续有效，截止前仍可修改；还没有报价的，请在新的截止时间前完成。`;
      return {
        subject: `截止时间变更：${formalNo} ${title}`,
        body: `${n.hello}<p>${esc(message)}</p>${button(d.link, '查看询价')}${n.contact}`,
        text: `${n.helloText}\n\n${message}\n\n查看询价：${d.link}\n\n${n.contactText}`,
      };
    }
    const message = `The quotation deadline of RFQ ${formalNo} (${title}) has been changed from ${before} to ${after}. Quotations already submitted remain valid and can still be revised before the deadline; if you have not quoted yet, please do so before the new deadline.`;
    return {
      subject: `Deadline changed: ${formalNo} ${title}`,
      body: `${n.hello}<p>${esc(message)}</p>${button(d.link, 'View RFQ')}${n.contact}`,
      text: `${n.helloText}\n\n${message}\n\nView RFQ: ${d.link}\n\n${n.contactText}`,
    };
  },
};

/** 发布后取消询价（R07-11）：发给受邀且没有拒绝的供应商，带取消原因 */
const cancelled: MailTemplate<MailTemplateDataMap['change.cancel']> = {
  type: 'CHANGE',
  render(lang, d, ctx) {
    const n = notice(lang, d);
    const { formalNo, title } = d.inquiry;
    if (lang === 'zh-CN') {
      const message = `${ctx.company.nameZh}已取消询价 ${formalNo}（${title}），取消原因：${d.reason}`;
      const after = '本询价不再接受报价，贵司提交的报价（如有）已作废，无需再处理。感谢贵司的支持。';
      return {
        subject: `询价取消：${formalNo} ${title}`,
        body: `${n.hello}<p>${esc(message)}</p><p>${after}</p>${n.contact}`,
        text: `${n.helloText}\n\n${message}\n${after}\n\n${n.contactText}`,
      };
    }
    const message = `${ctx.company.nameEn} has cancelled RFQ ${formalNo} (${title}). Reason: ${d.reason}`;
    const after =
      'The RFQ no longer accepts quotations and any quotation you submitted is void; no further action is needed. Thank you for your support.';
    return {
      subject: `RFQ cancelled: ${formalNo} ${title}`,
      body: `${n.hello}<p>${esc(message)}</p><p>${after}</p>${n.contact}`,
      text: `${n.helloText}\n\n${message}\n${after}\n\n${n.contactText}`,
    };
  },
};

/** 开标（R10-5）：只发给进入评标的供应商，不含任何金额、名次或其他供应商的信息 */
const opening: MailTemplate<MailTemplateDataMap['opening']> = {
  type: 'OPENING',
  render(lang, d) {
    const n = notice(lang, d);
    const { formalNo, title } = d.inquiry;
    const time = formatMailTime(d.openedAt, lang);
    if (lang === 'zh-CN') {
      const message = `询价 ${formalNo}（${title}）已于 ${time}开标，${n.supplier}的报价已进入评标阶段。评标期间采购人员可能就报价与贵司进一步沟通，评标结果将另行通知。感谢贵司参与报价。`;
      return {
        subject: `开标通知：${formalNo} ${title}`,
        body: `${n.hello}<p>${esc(message)}</p>${button(d.link, '查看我的报价')}${n.contact}`,
        text: `${n.helloText}\n\n${message}\n\n查看我的报价：${d.link}\n\n${n.contactText}`,
      };
    }
    const message = `RFQ ${formalNo} (${title}) was opened at ${time}, and the quotation from ${n.supplier} is now under evaluation. Our purchasing team may contact you about your quotation during the evaluation, and you will be notified of the result separately. Thank you for your quotation.`;
    return {
      subject: `Bids opened: ${formalNo} ${title}`,
      body: `${n.hello}<p>${esc(message)}</p>${button(d.link, 'View my quotation')}${n.contact}`,
      text: `${n.helloText}\n\n${message}\n\nView my quotation: ${d.link}\n\n${n.contactText}`,
    };
  },
};

/**
 * 议价（05 §5、R11-7）：采购方发目标价或结束议价时通知供应商，链接到门户报价单。不写目标价、方案说明等议价内容，
 * 供应商登录门户查看
 */
const negotiationToSupplier: MailTemplate<MailTemplateDataMap['negotiation.toSupplier']> = {
  type: 'NEGOTIATION',
  render(lang, d, ctx) {
    const n = notice(lang, d);
    const { formalNo, title } = d.inquiry;
    if (lang === 'zh-CN') {
      const offer = d.type === 'OFFER';
      const message = offer
        ? `${ctx.company.nameZh}就询价 ${formalNo}（${title}）向${n.supplier}发起议价第 ${d.negotiationRound} 轮，提出了目标价和方案。请登录供应商门户查看，并选择接受、拒绝或提出反提案。`
        : `${ctx.company.nameZh}已结束询价 ${formalNo}（${title}）与${n.supplier}的议价，议价记录可在供应商门户查看。感谢贵司的配合。`;
      return {
        subject: offer ? `议价通知：${formalNo} ${title}` : `议价结束：${formalNo} ${title}`,
        body: `${n.hello}<p>${esc(message)}</p>${button(d.link, offer ? '查看并回复' : '查看议价记录')}${n.contact}`,
        text: `${n.helloText}

${message}

${offer ? '查看并回复' : '查看议价记录'}：${d.link}

${n.contactText}`,
      };
    }
    const offer = d.type === 'OFFER';
    const message = offer
      ? `${ctx.company.nameEn} has started negotiation round ${d.negotiationRound} with ${n.supplier} on RFQ ${formalNo} (${title}) and proposed target prices and terms. Please sign in to the supplier portal to review them and accept, reject or make a counter-offer.`
      : `${ctx.company.nameEn} has closed the negotiation with ${n.supplier} on RFQ ${formalNo} (${title}). The negotiation history is available in the supplier portal. Thank you for your cooperation.`;
    const action = offer ? 'Review and reply' : 'View negotiation history';
    return {
      subject: offer
        ? `Negotiation request: ${formalNo} ${title}`
        : `Negotiation closed: ${formalNo} ${title}`,
      body: `${n.hello}<p>${esc(message)}</p>${button(d.link, action)}${n.contact}`,
      text: `${n.helloText}

${message}

${action}: ${d.link}

${n.contactText}`,
    };
  },
};

/** 供应商拒绝或反提案（05 §5）：发给询价负责人，链接到询价详情的"议价"页签 */
const negotiationToBuyer: MailTemplate<MailTemplateDataMap['negotiation.toBuyer']> = {
  type: 'NEGOTIATION',
  render(lang, d) {
    const { formalNo, title } = d.inquiry;
    const { code } = d.supplier;
    if (lang === 'zh-CN') {
      const what = d.type === 'COUNTER' ? '提出了反提案' : '拒绝了目标价';
      const message = `${d.supplier.nameZh}（${code}）对询价 ${formalNo}（${title}）议价第 ${d.negotiationRound} 轮的目标价${what}，请及时处理。`;
      return {
        subject: `议价回复：${formalNo} ${title} · ${code}`,
        body: `<p>${esc(d.name)}，您好：</p><p>${esc(message)}</p>${button(d.link, '查看议价')}`,
        text: `${d.name}，您好：

${message}

查看议价：${d.link}`,
      };
    }
    const supplier = d.supplier.nameEn ?? d.supplier.nameZh;
    const what = d.type === 'COUNTER' ? 'made a counter-offer to' : 'rejected';
    const message = `${supplier} (${code}) has ${what} the target prices of negotiation round ${d.negotiationRound} on RFQ ${formalNo} (${title}). Please follow up.`;
    return {
      subject: `Negotiation reply: ${formalNo} ${title} · ${code}`,
      body: `<p>Dear ${esc(d.name)},</p><p>${esc(message)}</p>${button(d.link, 'View negotiation')}`,
      text: `Dear ${d.name},

${message}

View negotiation: ${d.link}`,
    };
  },
};

/** 议价成交（05 §5）：双方各一封，成交内容已生成新的报价版本 */
const negotiationAgreed: MailTemplate<MailTemplateDataMap['negotiation.agreed']> = {
  type: 'NEGOTIATION',
  render(lang, d) {
    const { formalNo, title } = d.inquiry;
    if (d.audience === 'SUPPLIER') {
      const n = notice(lang, d);
      if (lang === 'zh-CN') {
        const message = `询价 ${formalNo}（${title}）与${n.supplier}的议价已成交，成交内容已生成新的报价版本。请登录供应商门户查看议价记录和报价版本，评标结果将另行通知。`;
        return {
          subject: `议价成交：${formalNo} ${title}`,
          body: `${n.hello}<p>${esc(message)}</p>${button(d.link, '查看我的报价')}${n.contact}`,
          text: `${n.helloText}

${message}

查看我的报价：${d.link}

${n.contactText}`,
        };
      }
      const message = `The negotiation with ${n.supplier} on RFQ ${formalNo} (${title}) has been agreed, and a new quotation version has been created from the agreed terms. Please sign in to the supplier portal to view the negotiation history and the quotation versions. You will be notified of the evaluation result separately.`;
      return {
        subject: `Negotiation agreed: ${formalNo} ${title}`,
        body: `${n.hello}<p>${esc(message)}</p>${button(d.link, 'View my quotation')}${n.contact}`,
        text: `${n.helloText}

${message}

View my quotation: ${d.link}

${n.contactText}`,
      };
    }
    const { code } = d.supplier;
    if (lang === 'zh-CN') {
      const message = `询价 ${formalNo}（${title}）与 ${d.supplier.nameZh}（${code}）的议价第 ${d.negotiationRound} 轮已成交，已生成报价第 ${d.versionNo} 版，比价矩阵已显示成交后的报价。`;
      return {
        subject: `议价成交：${formalNo} ${title} · ${code}`,
        body: `<p>${esc(d.name)}，您好：</p><p>${esc(message)}</p>${button(d.link, '查看议价')}`,
        text: `${d.name}，您好：

${message}

查看议价：${d.link}`,
      };
    }
    const supplier = d.supplier.nameEn ?? d.supplier.nameZh;
    const message = `Negotiation round ${d.negotiationRound} with ${supplier} (${code}) on RFQ ${formalNo} (${title}) has been agreed. Quotation version ${d.versionNo} has been created and the comparison matrix now shows the agreed quotation.`;
    return {
      subject: `Negotiation agreed: ${formalNo} ${title} · ${code}`,
      body: `<p>Dear ${esc(d.name)},</p><p>${esc(message)}</p>${button(d.link, 'View negotiation')}`,
      text: `Dear ${d.name},

${message}

View negotiation: ${d.link}`,
    };
  },
};

export const MAIL_TEMPLATES: { [K in MailTemplateKey]: MailTemplate<MailTemplateDataMap[K]> } = {
  'account.resetPassword': resetPassword,
  'account.activate': activate,
  'approval.request': approvalRequest,
  'approval.result': approvalResult,
  invitation,
  reminder,
  'change.deadline': deadlineChanged,
  'change.cancel': cancelled,
  opening,
  'negotiation.toSupplier': negotiationToSupplier,
  'negotiation.toBuyer': negotiationToBuyer,
  'negotiation.agreed': negotiationAgreed,
};
